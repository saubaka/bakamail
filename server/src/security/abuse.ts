import type { Response, Request, NextFunction } from "express";
import { db } from "../db.ts";
import { clientAddress, fingerprint, randomToken } from "./identity.ts";
import { sendJson } from "../http/kit.ts";

export type BudgetPolicy = { sourceMinute: number; sourceHour: number; globalMinute: number; globalHour: number };
export const SECURITY_BUDGETS = {
  initialize: { sourceMinute: 5, sourceHour: 20, globalMinute: 20, globalHour: 100 },
  login: { sourceMinute: 20, sourceHour: 100, globalMinute: 200, globalHour: 2000 },
  "admin-login": { sourceMinute: 10, sourceHour: 60, globalMinute: 100, globalHour: 1000 },
  challenge: { sourceMinute: 6, sourceHour: 30, globalMinute: 120, globalHour: 1000 },
  "challenge-admin": { sourceMinute: 6, sourceHour: 30, globalMinute: 60, globalHour: 500 },
  "human-verify-admin": { sourceMinute: 15, sourceHour: 60, globalMinute: 100, globalHour: 800 },
  "admin-turnstile": { sourceMinute: 10, sourceHour: 60, globalMinute: 60, globalHour: 300 },
  "admin-totp": { sourceMinute: 8, sourceHour: 40, globalMinute: 80, globalHour: 400 },
  "entry-probe": { sourceMinute: 20, sourceHour: 100, globalMinute: 200, globalHour: 1000 },
  "form-token": { sourceMinute: 6, sourceHour: 30, globalMinute: 60, globalHour: 500 },
  "human-verify": { sourceMinute: 15, sourceHour: 60, globalMinute: 200, globalHour: 1500 },
  register: { sourceMinute: 6, sourceHour: 100, globalMinute: 30, globalHour: 100 },
  "invite-guess": { sourceMinute: 5, sourceHour: 15, globalMinute: 30, globalHour: 100 },
} satisfies Record<string, BudgetPolicy>;

export class SecurityBudgetError extends Error {
  code: string;
  seconds: number;
  constructor(code: string, seconds: number) { super("请求过于频繁，请稍后再试"); this.code = code; this.seconds = seconds; }
}

export function enforceBudget(bucket: keyof typeof SECURITY_BUDGETS, identity: string): void {
  const seconds = reserveBudget(bucket, identity, SECURITY_BUDGETS[bucket]);
  if (seconds) throw new SecurityBudgetError(`${bucket.replaceAll("-", "_")}_rate_limited`, seconds);
}

export function anonymousRequestBudget(bucket: "login" | "admin-login" | "register") {
  return (request: Request, _response: Response, next: NextFunction): void => {
    enforceBudget(bucket, fingerprint("auth-source", clientAddress(request.headers, request.socket.remoteAddress)));
    next();
  };
}

export function reserveBudget(bucket: string, identity: string, policy: BudgetPolicy): number {
  const now = Date.now();
  db.prepare("delete from security_budgets where created_ms <= ?").run(now - 3600_000);
  const windows = [
    { ms: 60_000, limit: policy.sourceMinute, global: false },
    { ms: 3600_000, limit: policy.sourceHour, global: false },
    { ms: 60_000, limit: policy.globalMinute, global: true, own: policy.sourceMinute },
    { ms: 3600_000, limit: policy.globalHour, global: true, own: policy.sourceHour },
  ] as const;
  const light = (own: number) => Math.max(2, Math.ceil(own / 4));
  const ownCount = "(select count(*) from security_budgets where bucket = ? and identity_hash = ? and created_ms > ?)";
  const allCount = "(select count(*) from security_budgets where bucket = ? and created_ms > ?)";
  const conditions: string[] = [];
  const args: (string | number)[] = [bucket, identity, now];
  for (const window of windows) {
    const since = now - window.ms;
    if (!window.global) {
      conditions.push(`${ownCount} < ?`);
      args.push(bucket, identity, since, window.limit);
    } else {
      conditions.push(`(${allCount} < ? or ${ownCount} < ?)`);
      args.push(bucket, since, window.limit, bucket, identity, since, light(window.own));
    }
  }
  const result = db.prepare(`insert into security_budgets(bucket, identity_hash, created_ms) select ?, ?, ? where ${conditions.join(" and ")}`).run(...args);
  if (result.changes) return 0;
  let retry = 1;
  for (const window of windows) {
    const since = now - window.ms;
    const own = db.prepare(`select count(*) as n, min(created_ms) as oldest from security_budgets where bucket = ? and identity_hash = ? and created_ms > ?`)
      .get(bucket, identity, since) as { n: number; oldest: number };
    if (!window.global) {
      if (own.n >= window.limit) retry = Math.max(retry, Math.ceil((own.oldest + window.ms - now) / 1000));
      continue;
    }
    if (own.n < light(window.own)) continue;
    const all = db.prepare(`select count(*) as n, min(created_ms) as oldest from security_budgets where bucket = ? and created_ms > ?`)
      .get(bucket, since) as { n: number; oldest: number };
    if (all.n >= window.limit) retry = Math.max(retry, Math.ceil((all.oldest + window.ms - now) / 1000));
  }
  return retry;
}

export function peekBudget(bucket: string, identity: string, policy: BudgetPolicy): number {
  const now = Date.now();
  let retry = 0;
  for (const [ms, limit] of [[60_000, policy.sourceMinute], [3600_000, policy.sourceHour]] as const) {
    const row = db.prepare("select count(*) as n, min(created_ms) as oldest from security_budgets where bucket = ? and identity_hash = ? and created_ms > ?")
      .get(bucket, identity, now - ms) as { n: number; oldest: number };
    if (row.n >= limit) retry = Math.max(retry, Math.ceil((row.oldest + ms - now) / 1000), 1);
  }
  return retry;
}

export function rejectBudget(response: Response, code: string, seconds: number, message = "请求过于频繁，请稍后再试"): void {
  response.setHeader("retry-after", String(Math.max(1, seconds)));
  sendJson(response, 429, { ok: false, code, error: message, data: { retryAfterSeconds: Math.max(1, seconds) } });
}

export function reserveLease(scope: string, identity: string, account: string, globalLimit: number, sourceLimit = 2,
  reservedForClean = 0, suspicious = false): string | null {
  const now = Date.now();
  db.prepare("delete from security_leases where expires_ms <= ?").run(now);
  const id = randomToken(18);
  const accountHash = fingerprint(`account:${scope}`, account);
  const poolLimit = suspicious ? Math.max(1, globalLimit - reservedForClean) : globalLimit;
  const result = db.prepare(`insert into security_leases(id, scope, identity_hash, account_hash, expires_ms)
    select ?, ?, ?, ?, ? where
    (select count(*) from security_leases where scope = ?) < ? and
    (select count(*) from security_leases where scope = ? and identity_hash = ?) < ? and
    (select count(*) from security_leases where scope = ? and account_hash = ?) < ?`)
    .run(id, scope, identity, accountHash, now + 120_000, scope, poolLimit, scope, identity, sourceLimit,
      scope, accountHash, scope === "register" ? 1 : globalLimit);
  return result.changes ? id : null;
}

export function releaseLease(id: string): void { db.prepare("delete from security_leases where id = ?").run(id); }

export function keepLeaseAlive(id: string): () => void {
  const timer = setInterval(() => db.prepare("update security_leases set expires_ms = ? where id = ?").run(Date.now() + 120_000, id), 15_000);
  timer.unref();
  return () => clearInterval(timer);
}
