import { db, isoOffset, nowIso } from "../db.ts";
import { hashToken, randomToken } from "../security/identity.ts";
import { inviteLimitsProblem, type InviteSummary } from '../../../shared/invitePolicy.ts';

export type InviteRow = {
  id: number;
  code_hash: string;
  code_hint: string;
  bound_address: string;
  bound_domain: string;
  note: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string;
  revoked_at: string | null;
  max_uses: number | null;
  used_count: number;
  reserved_count: number;
};

export function createInvite(input: {
  boundAddress?: string;
  boundDomain?: string;
  note?: string;
  createdBy: string;
  ttlHours?: number | null;
  maxUses?: number | null;
}): { code: string; id: number; expiresAt: string | null; maxUses: number | null } {
  const problem = inviteLimitsProblem(input);
  if (problem) throw new Error(problem);
  const code = randomToken(15);
  const ttlHours = input.ttlHours === undefined ? 72 : input.ttlHours;
  const maxUses = input.maxUses === undefined ? 1 : input.maxUses;
  const expiresAt = ttlHours === null ? null : isoOffset(ttlHours * 60 * 60 * 1000);
  const result = db
    .prepare(
      `insert into invites
         (code_hash, code_hint, bound_address, bound_domain, note, created_by, created_at, expires_at, max_uses)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hashToken(code),
      code.slice(0, 4).toUpperCase(),
      (input.boundAddress ?? "").trim().toLowerCase(),
      (input.boundDomain ?? "").trim().toLowerCase(),
      (input.note ?? "").slice(0, 200),
      input.createdBy,
      nowIso(),
      expiresAt ?? '', // Empty sentinel keeps the legacy NOT NULL schema and rollback compatible.
      maxUses,
    );
  return { code, id: Number(result.lastInsertRowid), expiresAt, maxUses };
}

export function listInvites(limit = 100): InviteSummary[] {
  return db
    .prepare(
      `select id, code_hint, bound_address, bound_domain, note, created_by, created_at,
              nullif(expires_at, '') as expires_at, used_at, used_by, revoked_at,
              max_uses, used_count, reserved_count
       from invites order by id desc limit ?`,
    )
    .all(limit) as InviteSummary[];
}

export type InviteCheck =
  | { ok: true; invite: InviteRow }
  | { ok: false; reason: string };

export function checkInvite(code: string, account: string): InviteCheck {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return { ok: false, reason: "邀请码不能为空" };
  const invite = db
    .prepare("select * from invites where code_hash = ? limit 1")
    .get(hashToken(trimmed)) as InviteRow | undefined;
  if (!invite) return { ok: false, reason: "邀请码无效" };
  if (invite.revoked_at) return { ok: false, reason: "邀请码已被撤销" };
  if (invite.max_uses !== null && invite.used_count + invite.reserved_count >= invite.max_uses) return { ok: false, reason: "邀请码使用名额已用完或正在处理" };
  if (invite.expires_at && (!Number.isFinite(Date.parse(invite.expires_at)) || Date.parse(invite.expires_at) <= Date.now())) return { ok: false, reason: "邀请码已过期" };
  if (invite.bound_address && invite.bound_address !== account.toLowerCase()) {
    return { ok: false, reason: "该邀请码只能用于指定的邮箱地址" };
  }
  if (invite.bound_domain) {
    const domain = account.split("@")[1] ?? "";
    if (domain !== invite.bound_domain) return { ok: false, reason: "该邀请码只能用于指定域名" };
  }
  return { ok: true, invite };
}

/** Reserve a slot atomically across processes; never count an in-flight mailbox as successful. */
export function consumeInvite(id: number, usedBy: string): string | null {
  const token = randomToken(24), claimedAt = nowIso();
  db.exec('begin immediate');
  try {
    const result = db.prepare(`update invites set reserved_count = reserved_count + 1
      where id = ? and revoked_at is null and (expires_at = '' or expires_at > ?)
      and (max_uses is null or used_count + reserved_count < max_uses)
      and (bound_address = '' or bound_address = ?)
      and (bound_domain = '' or bound_domain = ?)`)
      .run(id, claimedAt, usedBy.toLowerCase(), usedBy.split('@')[1]?.toLowerCase() ?? '');
    if (!result.changes) { db.exec('commit'); return null; }
    db.prepare("insert into invite_claims (token, invite_id, account, claimed_at, state) values (?, ?, ?, ?, 'pending')")
      .run(token, id, usedBy, claimedAt);
    db.exec('commit'); return token;
  } catch (error) { db.exec('rollback'); throw error; }
}

/** Only a confirmed clean provisioning failure may release this exact claim. */
export function releaseInviteClaim(id: number, usedBy: string, token: string): boolean {
  return finishClaim(id, usedBy, token, false);
}

export function completeInviteClaim(id: number, usedBy: string, token: string): boolean {
  return finishClaim(id, usedBy, token, true);
}

function finishClaim(id: number, usedBy: string, token: string, completed: boolean): boolean {
  db.exec('begin immediate');
  try {
    const claim = db.prepare("select token from invite_claims where token = ? and invite_id = ? and account = ? and state = 'pending'")
      .get(token, id, usedBy);
    if (!claim) { db.exec('commit'); return false; }
    if (completed) {
      const result = db.prepare(`update invites set reserved_count = reserved_count - 1,
        used_count = used_count + 1, used_at = ?, used_by = ? where id = ? and reserved_count > 0`)
        .run(nowIso(), usedBy, id);
      if (!result.changes) throw Error('Invalid invite reservation');
      db.prepare("update invite_claims set state = 'completed' where token = ?").run(token);
    } else {
      const result = db.prepare('update invites set reserved_count = reserved_count - 1 where id = ? and reserved_count > 0').run(id);
      if (!result.changes) throw Error('Invalid invite reservation');
      db.prepare('delete from invite_claims where token = ?').run(token);
    }
    db.exec('commit'); return true;
  } catch (error) { db.exec('rollback'); throw error; }
}

/** No TTL auto-release: an interrupted/partial provision may already have created an account. */
export function retainInviteClaim(id: number, usedBy: string, token: string): void {
  db.exec('begin immediate');
  try {
    const changed = db.prepare("update invite_claims set state = 'unconfirmed' where token = ? and invite_id = ? and account = ? and state = 'pending'")
      .run(token, id, usedBy);
    if (changed.changes) db.prepare('update invites set used_at = ?, used_by = ? where id = ?').run(nowIso(), usedBy, id);
    db.exec('commit');
  } catch (error) { db.exec('rollback'); throw error; }
}

export function revokeInvite(id: number): boolean {
  const result = db
    .prepare("update invites set revoked_at = ? where id = ? and revoked_at is null")
    .run(nowIso(), id);
  return Number(result.changes ?? 0) > 0;
}
