import { config } from "../config.ts";
import { db, getIntSetting } from "../db.ts";
import { globalFailureCount } from "../security/rateLimit.ts";
import { hasPermission, type AdminRole } from "./accounts.ts";

export type RailBadges = { accounts?: number; security?: number };

const REQUEST_WINDOW_MS = 7 * 24 * 60 * 60_000;
const REQUEST_LIMIT = 500;
const CAP = 99;

const localPart = (address: string): string => {
  const lower = address.trim().toLowerCase();
  const suffix = `@${config.mail.domain.toLowerCase()}`;
  return lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : lower;
};

export function pendingPasswordResets(now = Date.now()): number {
  const since = new Date(now - REQUEST_WINDOW_MS).toISOString();
  const requests = db.prepare(
    `select target_id as target, max(created_at) as last from audit_logs
     where action = 'mailbox.password-reset-request' and created_at >= ?
     group by target_id order by last desc limit ?`,
  ).all(since, REQUEST_LIMIT) as { target: string; last: string }[];
  if (!requests.length) return 0;
  const handled = new Map<string, string>();
  const resets = db.prepare(
    `select target_id as target, max(created_at) as last from audit_logs
     where action = 'admin.account.password' and created_at >= ? group by target_id`,
  ).all(since) as { target: string; last: string }[];
  for (const row of resets) {
    const key = localPart(row.target);
    if ((handled.get(key) ?? "") < row.last) handled.set(key, row.last);
  }
  const pending = new Set<string>();
  for (const row of requests) {
    const key = localPart(row.target);
    if (!key) continue;
    if ((handled.get(key) ?? "") < row.last) pending.add(key);
  }
  return pending.size;
}

export function railBadges(role: AdminRole, now = Date.now()): RailBadges {
  const badges: RailBadges = {};
  if (hasPermission(role, "mail.account.read")) {
    const pending = pendingPasswordResets(now);
    if (pending > 0) badges.accounts = Math.min(CAP, pending);
  }
  if (hasPermission(role, "system.audit.read")) {
    const failures = globalFailureCount(15 * 60_000);
    if (failures >= getIntSetting("global_failure_alert", config.security.globalFailureAlert)) badges.security = Math.min(CAP, failures);
  }
  return badges;
}
