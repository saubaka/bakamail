import { api } from "./client.ts";
export type DraftPayload = {
  to?: string; cc?: string; bcc?: string; subject?: string; text?: string;
  mode?: "new" | "reply" | "reply-all" | "forward"; inReplyTo?: string; references?: string[];
  deliveryUnconfirmed?: boolean;
};
export type Draft = DraftPayload & { id: string };
function draftPath(id: string): string {
  if (!id || id === "." || id === ".." || id.length > 200 || /[\u0000-\u001f]/.test(id)) throw new TypeError("草稿编号不正确");
  return `/api/drafts/${encodeURIComponent(id)}`;
}
export function listDrafts(signal?: AbortSignal): Promise<{ drafts: Draft[] }> {
  return api("/api/drafts", { signal });
}
export function saveDraft(payload: DraftPayload, id?: string): Promise<{ id: string }> {
  if (id !== undefined) draftPath(id);
  return api("/api/drafts", { method: "POST", body: { id, payload } });
}
export function deleteDraft(id: string): Promise<void> {
  return api(draftPath(id), { method: "DELETE" });
}
