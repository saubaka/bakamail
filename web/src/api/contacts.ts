import { api } from "./client.ts";
export type Contact = { id: number; name: string; email: string; note: string };
export type ContactInput = Omit<Contact, "id">;
function contactPath(id: number): string {
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError("联系人编号不正确");
  return `/api/contacts/${id}`;
}
export function listContacts(signal?: AbortSignal): Promise<{ contacts: Contact[] }> {
  return api("/api/contacts", { signal });
}
export function saveContact(input: ContactInput, id?: number | null): Promise<{ contact: Contact }> {
  return api(id == null ? "/api/contacts" : contactPath(id), { method: id == null ? "POST" : "PATCH", body: input });
}
export function deleteContact(id: number): Promise<void> {
  return api(contactPath(id), { method: "DELETE" });
}
