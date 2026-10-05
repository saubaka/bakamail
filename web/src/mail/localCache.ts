import type { MessagePage } from "../api/mail.ts";
import type { Folder, MessageSummary } from "./types.ts";

const PREFIX = "bakamail:mail-list:v1:";
const MAX_BYTES = 2_000_000;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export type MailCache = { version: 1; owner: string; savedAt: number; folder: string; folders: Folder[]; pages: Array<[string, MessagePage]> };
export function cacheStorage(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }
function validSummary(value: unknown): value is MessageSummary {
  const row = value as MessageSummary;
  return Boolean(row && Number.isSafeInteger(row.uid) && row.uid > 0 && typeof row.subject === "string" && row.subject.length <= 4000
    && [row.from, row.to].every(list => Array.isArray(list) && list.length <= 100 && list.every(item => typeof item.name === "string" && typeof item.address === "string"))
    && (row.date === null || typeof row.date === "string") && Number.isFinite(row.size) && row.size >= 0
    && [row.seen, row.flagged, row.answered, row.hasAttachments].every(item => typeof item === "boolean"));
}
export function decodeMailCache(raw: string | null, owner: string, now = Date.now()): MailCache | null {
  if (!raw || !owner || raw.length > MAX_BYTES) return null;
  try {
    const value = JSON.parse(raw) as MailCache;
    if (value.version !== 1 || value.owner !== owner || !Number.isFinite(value.savedAt)
      || now - value.savedAt > MAX_AGE || value.savedAt > now + 60_000 || typeof value.folder !== "string"
      || !Array.isArray(value.folders) || value.folders.length > 200 || !value.folders.every(folder => folder && typeof folder.path === "string"
        && typeof folder.name === "string" && (folder.specialUse === null || typeof folder.specialUse === "string")
        && typeof folder.subscribed === "boolean" && Number.isSafeInteger(folder.messages) && Number.isSafeInteger(folder.unseen))
      || !Array.isArray(value.pages) || value.pages.length > 12 || !value.pages.every(entry => Array.isArray(entry) && entry.length === 2
        && typeof entry[0] === "string" && entry[0].includes("\u0000") && entry[1] && Array.isArray(entry[1].items)
        && entry[1].items.length <= 500 && entry[1].items.every(validSummary)
        && Number.isSafeInteger(entry[1].total) && entry[1].total >= 0
        && (entry[1].nextBefore === null || Number.isSafeInteger(entry[1].nextBefore)))) return null;
    // Reconstruct the allowed metadata only; never retain arbitrary extra fields/body/credentials.
    return { version: 1, owner, savedAt: value.savedAt, folder: value.folder, folders: value.folders.map(folder => ({
      path: folder.path, name: folder.name, specialUse: folder.specialUse, subscribed: folder.subscribed, messages: folder.messages, unseen: folder.unseen,
    })), pages: value.pages.map(([key, page]) => [key, { total: page.total, nextBefore: page.nextBefore, items: page.items.map(row => ({
      uid: row.uid, subject: row.subject, from: row.from.map(({ name, address }) => ({ name, address })), to: row.to.map(({ name, address }) => ({ name, address })),
      date: row.date, size: row.size, seen: row.seen, flagged: row.flagged, answered: row.answered, hasAttachments: row.hasAttachments,
    })) }]) };
  } catch { return null; }
}
export function readMailCache(owner: string, storage = cacheStorage()): MailCache | null {
  try { return decodeMailCache(storage?.getItem(PREFIX + owner) ?? null, owner); } catch { return null; }
}
export function writeMailCache(value: MailCache, storage = cacheStorage()): boolean {
  try {
    const safe = decodeMailCache(JSON.stringify(value), value.owner);
    if (!safe || !storage) return false;
    const raw = JSON.stringify(safe);
    if (raw.length > MAX_BYTES) return false;
    storage.setItem(PREFIX + value.owner, raw);
    return true;
  } catch { return false; }
}
export function purgeMailCaches(storage = cacheStorage()): void {
  if (!storage) return;
  try { for (let index = storage.length - 1; index >= 0; index--) { const key = storage.key(index); if (key?.startsWith(PREFIX)) storage.removeItem(key); } } catch { /* Storage may be blocked; memory clearing still succeeds. */ }
}
