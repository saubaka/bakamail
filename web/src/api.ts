export { ApiError, api, apiDownload, assertApiPath, setCsrfToken } from "./api/client.ts";
export type { ApiResult } from "./api/client.ts";
import { notify, type NoticeOptions, type NotificationTone } from "./notifications.ts";

export type Toast = (message: string, tone?: NotificationTone, options?: NoticeOptions) => void;

export function toast(message: string, tone: NotificationTone = "success", options?: NoticeOptions): void {
  notify(message, tone, options);
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const pad = (input: number): string => String(input).padStart(2, "0");
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
