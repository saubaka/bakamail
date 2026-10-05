import { ApiError, api, apiUpload, apiQuery, type UploadProgress } from "./client.ts";
import type { Folder, MessageDetail, MessageSummary } from "../mail/types.ts";

export type MessagePage = { items: MessageSummary[]; nextBefore: number | null; total: number };
export type SearchInput = { folder: string; q?: string; since?: string; before?: string; unseen?: boolean; flagged?: boolean };
export type SendInput = {
  to: string; cc?: string; bcc?: string; subject: string; text: string;
  attachments?: { filename: string; contentType: string; contentBase64: string }[];
  inReplyTo?: string; references?: string[];
};
export type SendResult = { messageId: string; savedToSent: boolean; saveError?: string; rawSize?: number };
export type FlagsMode = "add" | "remove" | "set";
const requestOptions = (signal?: AbortSignal) => ({ signal });

function uidPath(uid: number): string {
  if (!Number.isSafeInteger(uid) || uid < 1) throw new TypeError("邮件编号不正确");
  return `/api/messages/${uid}`;
}
function checkedUids(uids: number[]): number[] {
  if (!uids.length) throw new TypeError("请先选择邮件");
  for (const uid of uids) uidPath(uid);
  return [...new Set(uids)];
}

export function listFolders(signal?: AbortSignal): Promise<{ folders: Folder[]; account: string }> {
  return api("/api/folders", requestOptions(signal));
}
export function listMessages(folder: string, limit: string | number, before?: number | null, signal?: AbortSignal): Promise<MessagePage> {
  return api(apiQuery("/api/messages", { folder, limit, before }), requestOptions(signal));
}
export function readMessage(uid: number, folder: string, signal?: AbortSignal): Promise<MessageDetail> {
  return api(apiQuery(uidPath(uid), { folder }), requestOptions(signal));
}
export function searchMessages(input: SearchInput, signal?: AbortSignal): Promise<{ items: MessageSummary[] }> {
  return api(apiQuery("/api/search", { ...input, unseen: input.unseen || undefined, flagged: input.flagged || undefined }), requestOptions(signal));
}
export async function sendMessage(input: SendInput, onProgress?: (progress: UploadProgress) => void): Promise<SendResult> {
  const result = await apiUpload<SendResult>("/api/messages", input, { onProgress });
  if (!result || typeof result.messageId !== "string" || typeof result.savedToSent !== "boolean") {
    throw new ApiError("发送回复不完整，结果未确认；请先核对发送记录。", 200, null, { code: "invalid_response" });
  }
  return result;
}
export function setMessageFlags(folder: string, uids: number[], flags: string[], mode: FlagsMode): Promise<void> {
  return api("/api/messages/flags", { method: "POST", body: { folder, uids: checkedUids(uids), flags, mode } });
}
export function moveMessages(folder: string, uids: number[], target: string): Promise<void> {
  return api("/api/messages/move", { method: "POST", body: { folder, uids: checkedUids(uids), target } });
}
export function deleteMessages(folder: string, uids: number[], permanent: boolean): Promise<void> {
  return api("/api/messages/delete", { method: "POST", body: { folder, uids: checkedUids(uids), permanent } });
}
export function createFolder(path: string): Promise<void> {
  return api("/api/folders", { method: "POST", body: { path } });
}
export function renameFolder(path: string, name: string): Promise<void> {
  return api("/api/folders", { method: "PATCH", body: { path, name } });
}
export function subscribeFolder(path: string, subscribe: boolean): Promise<void> {
  return api("/api/folders/subscribe", { method: "POST", body: { path, subscribe } });
}
export function emptyFolder(path: string): Promise<{ removed: number }> {
  return api("/api/folders/empty", { method: "POST", body: { path } });
}
export function removeFolder(path: string): Promise<void> {
  return api(apiQuery("/api/folders", { path }), { method: "DELETE" });
}
/** Download links remain same-origin BFF endpoints; no service host is exposed. */
export function attachmentPath(uid: number, part: string, folder: string): string {
  if (!/^\d+(?:\.\d+)*$/.test(part) || part.length > 80) throw new TypeError("附件编号不正确");
  return apiQuery(`${uidPath(uid)}/attachments/${encodeURIComponent(part)}`, { folder });
}
