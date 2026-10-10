import { db, getIntSetting, nowIso } from "../db.ts";
import { config } from "../config.ts";
import { fingerprint } from "./identity.ts";
import { reserveLease, releaseLease } from "./abuse.ts";

export type LoginScope = "mail-login" | "admin-login" | "register" | "password-reset";

export function recordLoginAttempt(
  scope: LoginScope,
  identityHash: string,
  account: string,
  success: boolean,
  reason = "",
): number {
  const result = db.prepare(
    `insert into login_logs (scope, identity_hash, account, success, reason, created_at, account_hash)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    scope,
    identityHash,
    account.slice(0, 200),
    success ? 1 : 0,
    reason.slice(0, 200),
    nowIso(),
    fingerprint(`account:${scope}`, account.trim().toLowerCase()),
  );
  if (scope === "mail-login" || scope === "admin-login") loginLimitState(scope, identityHash);
  return Number(result.lastInsertRowid);
}

/** Reserve the request budget before awaiting external work, then finalize the same log row. */
export function completeLoginAttempt(id: number, success: boolean, reason: string): void {
  db.prepare("update login_logs set success = ?, reason = ? where id = ? and reason = 'pending'")
    .run(success ? 1 : 0, reason.slice(0, 200), id);
  releaseLease(`login:${id}`);
  const row = db.prepare("select scope, identity_hash from login_logs where id = ?").get(id) as { scope: LoginScope; identity_hash: string } | undefined;
  if (row && (row.scope === "mail-login" || row.scope === "admin-login")) loginLimitState(row.scope, row.identity_hash);
}

export function failureCount(
  scope: LoginScope,
  identityHash: string,
  windowMs: number,
): number {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = db
    .prepare(
      `select count(*) as n from login_logs
       where scope = ? and identity_hash = ? and success = 0 and created_at > ?
         and reason not in ('pending', 'busy', 'mail-unavailable', 'interrupted', 'locked', 'human-required', 'rate-limited', 'blocked', 'admin-unblocked')
         and id > coalesce((select max(s.id) from login_logs s where s.scope = login_logs.scope
           and s.identity_hash = login_logs.identity_hash and s.account = login_logs.account and s.success = 1), 0)`,
    )
    .get(scope, identityHash, since) as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Persisted reservation bounds expensive work even when several BFF workers share SQLite. */
export function reserveLoginAttempt(scope: "mail-login" | "admin-login", identityHash: string, account: string): number | null {
  db.exec("begin immediate");
  try {
    db.prepare("update login_logs set reason = 'interrupted' where reason = 'pending' and scope in ('mail-login','admin-login') and created_at < ?")
      .run(new Date(Date.now() - 120_000).toISOString());
    const state = loginLimitState(scope, identityHash, account);
    if (state.limited) { db.exec("commit"); return null; }
    // 只看来源自己的失败记录：已经在猜密码的来源只能使用部分名额；后台留 1 个、邮箱留 2 个给其他人。
    // 不能用“账号被别处猜过”来判断，否则攻击者乱猜管理员账号，真正的管理员也会被当成可疑来源。
    const suspicious = state.failures > 0;
    const lease = reserveLease(scope, identityHash, account, scope === "admin-login" ? 4 : 8, 2,
      scope === "admin-login" ? 1 : 2, suspicious);
    if (!lease) { db.exec("commit"); return null; }
    const id = recordLoginAttempt(scope, identityHash, account, false, "pending");
    db.prepare("update security_leases set id = ? where id = ?").run(`login:${id}`, lease);
    db.exec("commit"); return id;
  } catch (error) { db.exec("rollback"); throw error; }
}

export function attemptCount(
  scope: LoginScope,
  identityHash: string,
  windowMs: number,
): number {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = db
    .prepare(
      `select count(*) as n from login_logs
       where scope = ? and identity_hash = ? and created_at >= ?`,
    )
    .get(scope, identityHash, since) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function globalFailureCount(windowMs: number): number {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = db
    .prepare("select count(*) as n from login_logs where success = 0 and reason not in ('pending', 'busy', 'mail-unavailable', 'interrupted', 'locked', 'human-required', 'rate-limited', 'blocked') and created_at >= ?")
    .get(since) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function globalAttemptCount(scope: LoginScope, windowMs: number): number {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = db.prepare("select count(*) as n from login_logs where scope = ? and created_at >= ?")
    .get(scope, since) as { n: number };
  return row.n;
}

export type LimitState = {
  limited: boolean;
  failures: number;
  limit: number;
  retryAfterSeconds: number;
  requireHuman: boolean;
  accountFailures: number;
};

export function limitWindowMs(scope: LoginScope = "mail-login"): number {
  const minutes = Math.min(
    180,
    Math.max(1, scope === "admin-login" ? getIntSetting("admin_login_lock_minutes", config.security.adminLoginLockMinutes) : getIntSetting("login_lock_minutes", config.security.loginLockMinutes)),
  );
  return minutes * 60_000;
}

export function failureLimit(scope: LoginScope = "mail-login"): number {
  return Math.min(
    20,
    Math.max(3, scope === "admin-login" ? getIntSetting("admin_login_max_failures", config.security.adminLoginMaxFailures) : getIntSetting("login_max_failures", config.security.loginMaxFailures)),
  );
}

/** Only a source is hard-cooled. Account-wide risk escalates verification, never locks a victim account. */
export function loginLimitState(scope: LoginScope, identityHash: string, account = ""): LimitState {
  db.prepare("delete from security_cooldowns where until_ms < ?").run(Date.now() - 86400_000);
  const windowMs = limitWindowMs(scope);
  const limit = failureLimit(scope);
  const old = db.prepare("select until_ms from security_cooldowns where scope = ? and identity_hash = ?")
    .get(scope, identityHash) as { until_ms: number } | undefined;
  const now = Date.now();
  const windowStart = Math.max(now - windowMs, old && old.until_ms <= now ? old.until_ms : 0);
  const failures = failureCount(scope, identityHash, now - windowStart);
  let until = old?.until_ms ?? 0;
  if (until <= now && failures >= limit) {
    until = now + windowMs;
    db.prepare(`insert into security_cooldowns(scope, identity_hash, until_ms) values (?, ?, ?)
      on conflict(scope, identity_hash) do update set until_ms = excluded.until_ms where security_cooldowns.until_ms <= ?`)
      .run(scope, identityHash, until, now);
  }
  const risk = account ? db.prepare(`select count(*) as n from login_logs where scope = ? and account_hash = ?
    and success = 0 and reason in ('bad-credentials','bad','账号或密码错误') and created_at >= ?`)
    .get(scope, fingerprint(`account:${scope}`, account.trim().toLowerCase()), new Date(now - windowMs).toISOString()) as { n: number } : { n: 0 };
  const retryAfterSeconds = Math.max(0, Math.ceil((until - now) / 1000));
  return { limited: retryAfterSeconds > 0, failures, limit, retryAfterSeconds,
    requireHuman: scope === "admin-login" || failures >= 3 || risk.n >= 3, accountFailures: risk.n };
}

export function isIdentityBlocked(identityHash: string): boolean {
  const row = db
    .prepare("select 1 as hit from blocked_identities where identity_hash = ?")
    .get(identityHash);
  return Boolean(row);
}

export function blockIdentity(identityHash: string, reason: string, createdBy: string): void {
  db.prepare(
    `insert into blocked_identities (identity_hash, reason, created_by, created_at)
     values (?, ?, ?, ?)
     on conflict(identity_hash) do update set reason = excluded.reason`,
  ).run(identityHash, reason.slice(0, 200), createdBy, nowIso());
}

export type BlockedIdentity = {
  identity_hash: string;
  reason: string;
  created_by: string;
  created_at: string;
  scope: string;
};

export function listBlockedIdentities(limit = 100): BlockedIdentity[] {
  const explicit = db
    .prepare(
      `select b.identity_hash, b.reason, b.created_by, b.created_at,
              coalesce((select l.scope from login_logs l
                        where l.identity_hash = b.identity_hash
                        order by l.id desc limit 1), '') as scope
       from blocked_identities b order by b.created_at desc limit ?`,
    )
    .all(limit) as BlockedIdentity[];
  const temporary = db.prepare(`select scope, identity_hash, until_ms from security_cooldowns
    where until_ms > ? and identity_hash not in (select identity_hash from blocked_identities)
    order by until_ms desc limit ?`).all(Date.now(), limit) as { scope: LoginScope; identity_hash: string; until_ms: number }[];
  return [...explicit, ...temporary.map((row) => ({ scope: row.scope, identity_hash: row.identity_hash,
    reason: `自动冷却至 ${new Date(row.until_ms).toISOString()}`, created_by: "system",
    created_at: new Date(row.until_ms - limitWindowMs(row.scope)).toISOString() }))].slice(0, limit);
}

export function unblockIdentity(identityHash: string): boolean {
  const result = db.prepare("delete from blocked_identities where identity_hash = ?").run(identityHash);
  const cooldown = db.prepare("update security_cooldowns set until_ms = ? where identity_hash = ? and until_ms > ?").run(Date.now(), identityHash, Date.now());
  // Administrative recovery resets source failures, not another source's account risk or request budgets.
  if (result.changes) {
    const scopes = db.prepare("select distinct scope from login_logs where identity_hash = ? and scope in ('mail-login','admin-login')").all(identityHash) as { scope: string }[];
    for (const row of scopes) db.prepare(`insert into security_cooldowns(scope, identity_hash, until_ms) values (?, ?, ?)
      on conflict(scope, identity_hash) do update set until_ms = excluded.until_ms`).run(row.scope, identityHash, Date.now());
  }
  return Number(result.changes ?? 0) + Number(cooldown.changes ?? 0) > 0;
}

/** Captcha-cleared account risk adds a bounded non-blocking delay while holding the expensive-work slot. */
export async function loginRiskBackoff(scope: LoginScope, identity: string, account: string): Promise<void> {
  const risk = loginLimitState(scope, identity, account).accountFailures;
  if (risk >= 3) await new Promise<void>((resolve) => setTimeout(resolve, Math.min(400, risk * 50)));
}

export function listLoginLogs(limit = 100, offset = 0): unknown[] {
  return db
    .prepare(
      `select id, scope, identity_hash, account, success, reason, created_at
       from login_logs order by id desc limit ? offset ?`,
    )
    .all(limit, offset);
}
