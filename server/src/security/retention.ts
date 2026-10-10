import { db } from "../db.ts";

const DAY = 86_400_000;
export const RETENTION = { sessionDays: 30, loginLogDays: 90 } as const;

/**
 * 定期清理已失效的会话和过旧的登录记录，防止数据库被慢速攻击长期撑大。
 * 操作审计日志不在这里清理：它是管理员需要长期保留的记录。
 */
export function pruneExpiredRecords(now = Date.now()): { sessions: number; loginLogs: number } {
  const sessionCutoff = new Date(now - RETENTION.sessionDays * DAY).toISOString();
  const logCutoff = new Date(now - RETENTION.loginLogDays * DAY).toISOString();
  const count = (result: { changes: number | bigint }) => Number(result.changes);
  const sessions =
    count(db.prepare("delete from mail_sessions where revoked_at is not null and revoked_at < ?").run(sessionCutoff)) +
    count(db.prepare("delete from admin_sessions where revoked_at is not null and revoked_at < ?").run(sessionCutoff));
  const loginLogs = count(db.prepare("delete from login_logs where created_at < ?").run(logCutoff));
  return { sessions, loginLogs };
}
