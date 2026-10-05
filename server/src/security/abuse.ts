import type { Response, Request, NextFunction } from "express";
import { db } from "../db.ts";
import { clientAddress, fingerprint, randomToken } from "./identity.ts";
import { sendJson } from "../http/kit.ts";

export type BudgetPolicy = { sourceMinute: number; sourceHour: number; globalMinute: number; globalHour: number };
export const SECURITY_BUDGETS = {
  login: { sourceMinute: 20, sourceHour: 100, globalMinute: 200, globalHour: 2000 },
  challenge: { sourceMinute: 6, sourceHour: 30, globalMinute: 120, globalHour: 1000 },
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

/** Reserve before reading the JSON stream, including malformed/oversized submissions. */
export function anonymousRequestBudget(bucket: "login" | "register") {
  return (request: Request, _response: Response, next: NextFunction): void => {
    enforceBudget(bucket, fingerprint("auth-source", clientAddress(request.headers, request.socket.remoteAddress)));
    next();
  };
}

/** A conditional SQLite INSERT reserves all sliding-window budgets atomically across workers. */
export function reserveBudget(bucket: string, identity: string, policy: BudgetPolicy): number {
  const now = Date.now();
  db.prepare("delete from security_budgets where created_ms <= ?").run(now - 3600_000);
  const windows = [
    [identity, 60_000, policy.sourceMinute], [identity, 3600_000, policy.sourceHour],
    [null, 60_000, policy.globalMinute], [null, 3600_000, policy.globalHour],
  ] as const;
  const conditions = windows.map(([source]) => `(select count(*) from security_budgets where bucket = ? ${source === null ? "" : "and identity_hash = ?"} and created_ms > ?) < ?`);
  const args: (string | number)[] = [bucket, identity, now];
  for (const [source, window, limit] of windows) {
    args.push(bucket); if (source !== null) args.push(source); args.push(now - window, limit);
  }
  const result = db.prepare(`insert into security_budgets(bucket, identity_hash, created_ms) select ?, ?, ? where ${conditions.join(" and ")}`).run(...args);
  if (result.changes) return 0;
  let retry = 1;
  for (const [source, window, limit] of windows) {
    const row = db.prepare(`select count(*) as n, min(created_ms) as oldest from security_budgets where bucket = ? ${source === null ? "" : "and identity_hash = ?"} and created_ms > ?`)
      .get(...(source === null ? [bucket, now - window] : [bucket, source, now - window])) as { n: number; oldest: number };
    if (row.n >= limit) retry = Math.max(retry, Math.ceil((row.oldest + window - now) / 1000));
  }
  return retry;
}

export function rejectBudget(response: Response, code: string, seconds: number, message = "请求过于频繁，请稍后再试"): void {
  response.setHeader("retry-after", String(Math.max(1, seconds)));
  sendJson(response, 429, { ok: false, code, error: message, data: { retryAfterSeconds: Math.max(1, seconds) } });
}

/** Global and per-source concurrency plus one registration per normalized account, before any await. */
export function reserveLease(scope: string, identity: string, account: string, globalLimit: number, sourceLimit = 2): string | null {
  const now = Date.now();
  db.prepare("delete from security_leases where expires_ms <= ?").run(now);
  const id = randomToken(18);
  const accountHash = fingerprint(`account:${scope}`, account);
  const result = db.prepare(`insert into security_leases(id, scope, identity_hash, account_hash, expires_ms)
    select ?, ?, ?, ?, ? where
    (select count(*) from security_leases where scope = ?) < ? and
    (select count(*) from security_leases where scope = ? and identity_hash = ?) < ? and
    (select count(*) from security_leases where scope = ? and account_hash = ?) < ?`)
    .run(id, scope, identity, accountHash, now + 120_000, scope, globalLimit, scope, identity, sourceLimit,
      scope, accountHash, scope === "register" ? 1 : globalLimit);
  return result.changes ? id : null;
}

export function releaseLease(id: string): void { db.prepare("delete from security_leases where id = ?").run(id); }

/** Provisioning can span several bounded CLI calls; a live operation renews, a crashed worker expires. */
export function keepLeaseAlive(id: string): () => void {
  const timer = setInterval(() => db.prepare("update security_leases set expires_ms = ? where id = ?").run(Date.now() + 120_000, id), 15_000);
  timer.unref();
  return () => clearInterval(timer);
}
