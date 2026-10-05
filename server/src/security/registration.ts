import { config } from "../config.ts";
import { db, getIntSetting, nowIso } from "../db.ts";
import { attemptCount } from "./rateLimit.ts";

export const REGISTER_REASON_MAX_LENGTH = 500;
export const REGISTER_REASON_MAX_LINKS = 2;

/** Optional for invite holders; never render or log the submitted content as markup. */
export function registrationReasonProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") return "申请理由格式不正确";
  if (value.length > REGISTER_REASON_MAX_LENGTH) return "申请理由最多 500 个字符";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return "申请理由含有不支持的控制字符";
  const links = value.match(/(?:[a-z][a-z\d+.-]{1,20}:\/\/|mailto:|www\.)[^\s<>]+/gi) ?? [];
  return links.length > REGISTER_REASON_MAX_LINKS ? "申请理由最多包含 2 个链接" : null;
}

export function registrationLimits(): { perHour: number; perDay: number } {
  return {
    perHour: Math.min(100, Math.max(1, getIntSetting("register_max_per_hour", config.security.registerMaxPerHour))),
    perDay: Math.min(1000, Math.max(1, getIntSetting("register_max_per_day", config.security.registerMaxPerDay))),
  };
}

/** One SQLite statement reserves both sliding-window budgets before any external await. */
export function reserveRegistrationAttempt(identity: string, account: string):
  | { attemptId: number; limited: false }
  | { limited: true; window: "hour" | "day"; retryAfterSeconds: number } {
  const now = Date.now();
  const limits = registrationLimits();
  const result = db.prepare(`insert into login_logs (scope, identity_hash, account, success, reason, created_at)
    select 'register', ?, ?, 0, 'pending', ? where
    (select count(*) from login_logs where scope = 'register' and identity_hash = ? and created_at >= ?) < ?
    and (select count(*) from login_logs where scope = 'register' and identity_hash = ? and created_at >= ?) < ?`)
    .run(identity, account.slice(0, 200), nowIso(), identity, new Date(now - 3600_000).toISOString(), limits.perHour,
      identity, new Date(now - 86400_000).toISOString(), limits.perDay);
  if (result.changes) return { attemptId: Number(result.lastInsertRowid), limited: false };
  const daily = attemptCount("register", identity, 86400_000) >= limits.perDay;
  let retryAfterSeconds = 1;
  for (const [windowMs, cap] of [[3600_000, limits.perHour], [86400_000, limits.perDay]]) {
    const row = db.prepare("select count(*) as n, min(created_at) as oldest from login_logs where scope = 'register' and identity_hash = ? and created_at >= ?")
      .get(identity, new Date(now - windowMs!).toISOString()) as { n: number; oldest: string };
    if (row.n >= cap!) retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((new Date(row.oldest).getTime() + windowMs! - now) / 1000));
  }
  return { limited: true, window: daily ? "day" : "hour", retryAfterSeconds };
}
