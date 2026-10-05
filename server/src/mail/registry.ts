import { MailboxSession } from "./session.ts";
import { withMailDeadline } from "./deadline.ts";

/**
 * 已登录邮箱会话的内存注册表。
 *
 * 密码与 IMAP 连接都不落库，所以进程重启后这里会清空：
 * 数据库里的会话行还在，但取不到连接，接口会要求重新登录。
 */
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
  // Closing N sessions must not multiply the HTTP deadline by N.
  await Promise.all(targets.map((session) => withTimeout(session.close(), 3000)));
  return targets.length;
}

/** 会话关闭再慢也不能卡住 HTTP 请求 */
function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return withMailDeadline(() => promise, ms, () => {}, "等待会话关闭超时").catch(() => undefined);
}

export function liveSessionCount(): number {
  return sessions.size;
}
