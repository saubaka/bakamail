import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.ts";

export type MailboxStat = {
  mailbox: string;
  folders: { name: string; messages: number; specialUse: string | null }[];
  messages: number;
  unseen: number;
};

export type QueueEntry = { id: string; size: number; modifiedAt: string };

function imapsqlPath(): string {
  return join(config.maddy.dataDir, "imapsql.db");
}

/** maddy 数据目录是否可读（生产环境挂载 maddydata 卷后为真） */
export function statsAvailable(): boolean {
  return existsSync(imapsqlPath());
}

/**
 * 直接只读打开 maddy 的 imapsql.db 取统计。
 * 只读连接不会干扰 maddy 的写入；这也是 QUOTA 扩展缺失时的替代方案。
 */
export function mailboxStats(): MailboxStat[] {
  if (!statsAvailable()) return [];
  const db = new DatabaseSync(imapsqlPath(), { readOnly: true });
  try {
    const rows = db
      .prepare(
        `select u.username as mailbox, m.name as name, m.specialuse as specialuse,
                coalesce(m.msgsCount, 0) as messages, m.id as mboxId
         from mboxes m join users u on u.id = m.uid
         order by u.username, m.name`,
      )
      .all() as {
      mailbox: string;
      name: string;
      specialuse: string | null;
      messages: number;
      mboxId: number;
    }[];

    const unseenRows = db
      .prepare("select mboxId, count(*) as n from msgs where seen = 0 group by mboxId")
      .all() as { mboxId: number; n: number }[];
    const unseenByMbox = new Map(unseenRows.map((row) => [row.mboxId, row.n]));

    const byMailbox = new Map<string, MailboxStat>();
    for (const row of rows) {
      const entry =
        byMailbox.get(row.mailbox) ??
        ({ mailbox: row.mailbox, folders: [], messages: 0, unseen: 0 } satisfies MailboxStat);
      const unseen = unseenByMbox.get(row.mboxId) ?? 0;
      entry.folders.push({
        name: row.name,
        messages: row.messages,
        specialUse: row.specialuse,
      });
      entry.messages += row.messages;
      entry.unseen += unseen;
      byMailbox.set(row.mailbox, entry);
    }
    return [...byMailbox.values()].sort((a, b) => a.mailbox.localeCompare(b.mailbox));
  } finally {
    db.close();
  }
}

/** 出站投递队列，目录为空即没有积压 */
export function queueEntries(): QueueEntry[] {
  const dir = join(config.maddy.dataDir, "remote_queue");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => {
    const info = statSync(join(dir, name));
    return { id: name, size: info.size, modifiedAt: info.mtime.toISOString() };
  });
}

export function dkimKeyPath(domain: string): string {
  return join(config.maddy.dataDir, "dkim_keys", `${domain}_default.key`);
}
