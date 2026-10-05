import { db, isoOffset, nowIso } from "../db.ts";
import { hashToken, randomToken } from "../security/identity.ts";

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
};

export function createInvite(input: {
  boundAddress?: string;
  boundDomain?: string;
  note?: string;
  createdBy: string;
  ttlHours?: number;
}): { code: string; id: number; expiresAt: string } {
  const code = randomToken(15);
  const ttlHours = Math.min(Math.max(input.ttlHours ?? 72, 1), 24 * 30);
  const expiresAt = isoOffset(ttlHours * 60 * 60 * 1000);
  const result = db
    .prepare(
      `insert into invites
         (code_hash, code_hint, bound_address, bound_domain, note, created_by, created_at, expires_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hashToken(code),
      code.slice(0, 4).toUpperCase(),
      (input.boundAddress ?? "").trim().toLowerCase(),
      (input.boundDomain ?? "").trim().toLowerCase(),
      (input.note ?? "").slice(0, 200),
      input.createdBy,
      nowIso(),
      expiresAt,
    );
  return { code, id: Number(result.lastInsertRowid), expiresAt };
}

export function listInvites(limit = 100): unknown[] {
  return db
    .prepare(
      `select id, code_hint, bound_address, bound_domain, note, created_by, created_at,
              expires_at, used_at, used_by, revoked_at
       from invites order by id desc limit ?`,
    )
    .all(limit);
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
  if (invite.used_at) return { ok: false, reason: "邀请码已被使用" };
  if (new Date(invite.expires_at).getTime() <= Date.now()) return { ok: false, reason: "邀请码已过期" };
  if (invite.bound_address && invite.bound_address !== account.toLowerCase()) {
    return { ok: false, reason: "该邀请码只能用于指定的邮箱地址" };
  }
  if (invite.bound_domain) {
    const domain = account.split("@")[1] ?? "";
    if (domain !== invite.bound_domain) return { ok: false, reason: "该邀请码只能用于指定域名" };
  }
  return { ok: true, invite };
}

/** Claim once, synchronously, before provisioning awaits. A second request cannot pass the same invite. */
export function consumeInvite(id: number, usedBy: string): string | null {
  const claimedAt = nowIso();
  const result = db.prepare(`update invites set used_at = ?, used_by = ?
    where id = ? and used_at is null and revoked_at is null and expires_at > ?`)
    .run(claimedAt, usedBy, id, claimedAt);
  return Number(result.changes ?? 0) === 1 ? claimedAt : null;
}

/** Only a confirmed clean provisioning failure may release this exact claim. */
export function releaseInviteClaim(id: number, usedBy: string, claimedAt: string): boolean {
  const result = db.prepare(`update invites set used_at = null, used_by = ''
    where id = ? and used_by = ? and used_at = ? and revoked_at is null`)
    .run(id, usedBy, claimedAt);
  return Number(result.changes ?? 0) === 1;
}

export function revokeInvite(id: number): boolean {
  const result = db
    .prepare("update invites set revoked_at = ? where id = ? and used_at is null and revoked_at is null")
    .run(nowIso(), id);
  return Number(result.changes ?? 0) > 0;
}
