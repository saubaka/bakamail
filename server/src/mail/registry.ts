import { MailboxSession } from "./session.ts";
import { withMailDeadline } from "./deadline.ts";

const sessions = new Map<string, MailboxSession>();

export function putSession(session: MailboxSession): void {
  sessions.set(session.id, session);
}

export function getSession(id: string): MailboxSession | undefined {
  return sessions.get(id);
}

export async function dropSession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  await withTimeout(session.close(), 3000);
}

export async function dropSessionsForMailbox(mailbox: string): Promise<number> {
  const targets = [...sessions.values()].filter((session) => session.mailbox === mailbox);
  for (const session of targets) sessions.delete(session.id);
  await Promise.all(targets.map((session) => withTimeout(session.close(), 3000)));
  return targets.length;
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return withMailDeadline(() => promise, ms, () => {}, "等待会话关闭超时").catch(() => undefined);
}

export function liveSessionCount(): number {
  return sessions.size;
}
