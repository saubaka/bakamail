import { config } from "../config.ts";
import { db, isoOffset, nowIso } from "../db.ts";
import { hashToken, randomToken } from "../security/identity.ts";

export type MailSessionRow = {
  id: string;
  mailbox: string;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
};

export type AdminSessionRow = {
  id: string;
  admin_id: number;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
};

export const MAIL_COOKIE = "bm_session";
export const ADMIN_COOKIE = "bm_admin";

export function createMailSession(
  mailbox: string,
  fingerprintValue: string,
  userAgent: string,
): { id: string; token: string; csrfToken: string; expiresAt: string } {
  const id = randomToken(18);
  const token = randomToken(32);
  const csrfToken = randomToken(18);
  const expiresAt = isoOffset(config.session.mailDays * 24 * 60 * 60 * 1000);
  db.prepare(
    `insert into mail_sessions
       (id, mailbox, token_hash, csrf_token, fingerprint, user_agent, created_at, last_active_at, expires_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    mailbox,
    hashToken(token),
    csrfToken,
    fingerprintValue,
    userAgent.slice(0, 200),
    nowIso(),
    nowIso(),
    expiresAt,
  );
  return { id, token, csrfToken, expiresAt };
}

export function findMailSession(token: string): MailSessionRow | undefined {
  if (!token) return undefined;
  const row = db
    .prepare(
      `select id, mailbox, csrf_token, expires_at, revoked_at from mail_sessions
       where token_hash = ? limit 1`,
    )
    .get(hashToken(token)) as MailSessionRow | undefined;
  if (!row || row.revoked_at) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  db.prepare("update mail_sessions set last_active_at = ? where id = ?").run(nowIso(), row.id);
  return row;
}

export function revokeMailSession(id: string): void {
  db.prepare("update mail_sessions set revoked_at = ? where id = ?").run(nowIso(), id);
}

export function revokeMailSessionsFor(mailbox: string): number {
  const result = db
    .prepare("update mail_sessions set revoked_at = ? where mailbox = ? and revoked_at is null")
    .run(nowIso(), mailbox);
  return Number(result.changes ?? 0);
}

export function listMailSessions(mailbox: string): unknown[] {
  return db
    .prepare(
      `select id, mailbox, fingerprint, user_agent, created_at, last_active_at, expires_at, revoked_at
       from mail_sessions where mailbox = ? order by last_active_at desc limit 50`,
    )
    .all(mailbox);
}

export function createAdminSession(
  adminId: number,
  fingerprintValue: string,
  userAgent: string,
): { id: string; token: string; csrfToken: string; expiresAt: string } {
  const id = randomToken(18);
  const token = randomToken(32);
  const csrfToken = randomToken(18);
  const expiresAt = isoOffset(config.session.adminIdleMinutes * 60 * 1000);
  db.prepare(
    `insert into admin_sessions
       (id, admin_id, token_hash, csrf_token, fingerprint, user_agent, created_at, last_active_at, expires_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    adminId,
    hashToken(token),
    csrfToken,
    fingerprintValue,
    userAgent.slice(0, 200),
    nowIso(),
    nowIso(),
    expiresAt,
  );
  return { id, token, csrfToken, expiresAt };
}

/** 后台会话按空闲时间续期，超过空闲上限即失效。 */
export function findAdminSession(token: string): AdminSessionRow | undefined {
  if (!token) return undefined;
  const row = db
    .prepare(
      `select id, admin_id, csrf_token, expires_at, revoked_at from admin_sessions
       where token_hash = ? limit 1`,
    )
    .get(hashToken(token)) as AdminSessionRow | undefined;
  if (!row || row.revoked_at) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  db.prepare("update admin_sessions set last_active_at = ?, expires_at = ? where id = ?").run(
    nowIso(),
    isoOffset(config.session.adminIdleMinutes * 60 * 1000),
    row.id,
  );
  return row;
}

export function revokeAdminSession(id: string): boolean {
  const result = db
    .prepare("update admin_sessions set revoked_at = ? where id = ? and revoked_at is null")
    .run(nowIso(), id);
  return Number(result.changes ?? 0) > 0;
}

export function revokeAdminSessionsFor(adminId: number): number {
  const result = db
    .prepare("update admin_sessions set revoked_at = ? where admin_id = ? and revoked_at is null")
    .run(nowIso(), adminId);
  return Number(result.changes ?? 0);
}

export function listAdminSessions(): unknown[] {
  return db
    .prepare(
      `select s.id, s.admin_id, u.username, s.fingerprint, s.user_agent, s.created_at,
              s.last_active_at, s.expires_at, s.revoked_at
       from admin_sessions s join admin_users u on u.id = s.admin_id
       where s.revoked_at is null and s.expires_at > ?
       order by s.last_active_at desc limit 100`,
    )
    .all(nowIso());
}
