import { api, apiQuery } from "./client.ts";
export type QueueItem = { id: string; size: number; modifiedAt: string };
export type DomainCheck = { key: string; label: string; status: "ok" | "warn" | "fail" | "unknown"; detail: string };
export type MailLogs = {
  available: boolean; lines: string[]; hint?: string; capturedAt?: string;
  stale?: boolean; truncated?: boolean; source?: "snapshot" | "docker-logs";
};
export function readMailQueue(signal?: AbortSignal): Promise<{ entries: QueueItem[]; statsAvailable: boolean }> {
  return api("/api/admin/queue", { signal });
}
export function checkMailDomain(signal?: AbortSignal): Promise<{ checks: DomainCheck[]; statsAvailable: boolean }> {
  return api("/api/admin/domain-check", { signal });
}
export function readMailLogs(lines = 200, signal?: AbortSignal): Promise<MailLogs> {
  if (!Number.isInteger(lines) || lines < 10 || lines > 2000) throw new TypeError("日志条数须为 10–2000 的整数");
  return api(apiQuery("/api/admin/logs/mail", { lines }), { signal });
}
