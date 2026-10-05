import { db } from "../db.ts";

const OWNED_TABLES = [
  ["drafts", "owner"],
  ["contact_entries", "owner"],
  ["user_settings", "owner"],
  ["mail_sessions", "mailbox"],
] as const;

export function localMailboxOwners(): string[] {
  return (db.prepare(`
    select owner as mailbox from drafts
    union select owner as mailbox from contact_entries
    union select owner as mailbox from user_settings
    union select mailbox from mail_sessions
  `).all() as { mailbox: string }[]).map((row) => row.mailbox);
}

export function hasLocalMailboxData(mailbox: string): boolean {
  return OWNED_TABLES.some(([table, column]) => {
    const row = db.prepare(`select 1 as found from ${table} where ${column} = ? limit 1`)
      .get(mailbox) as { found: number } | undefined;
    return Boolean(row);
  });
}

/** Only after Maddy absence is confirmed; keep audit/login-attempt history. */
export function purgeLocalMailboxData(mailbox: string): Record<string, number> {
  const deleted: Record<string, number> = {};
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [table, column] of OWNED_TABLES) {
      deleted[table] = Number(db.prepare(`delete from ${table} where ${column} = ?`).run(mailbox).changes);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return deleted;
}
