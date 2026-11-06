import { db } from "../db.ts";
import { pruneTurnstileStats } from "./turnstile.ts";

const DAY = 86_400_000;
export const RETENTION = { sessionDays: 30, loginLogDays: 90 } as const;

export function pruneExpiredRecords(now = Date.now()): { sessions: number; loginLogs: number; turnstileStats: number } {
  const sessionCutoff = new Date(now - RETENTION.sessionDays * DAY).toISOString();
  const logCutoff = new Date(now - RETENTION.loginLogDays * DAY).toISOString();
  const count = (result: { changes: number | bigint }) => Number(result.changes);
  const sessions =
    count(db.prepare("delete from mail_sessions where revoked_at is not null and revoked_at < ?").run(sessionCutoff)) +
    count(db.prepare("delete from admin_sessions where revoked_at is not null and revoked_at < ?").run(sessionCutoff));
  const loginLogs = count(db.prepare("delete from login_logs where created_at < ?").run(logCutoff));
  db.prepare("delete from admin_login_tickets where expires_ms < ?").run(now);
  return { sessions, loginLogs, turnstileStats: pruneTurnstileStats(now) };
}
