import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { config } from "../config.ts";
import { withMailAbort, withMailDeadline } from "./deadline.ts";

type SessionTimeouts = { connectionTimeoutMs?: number; authenticationTimeoutMs?: number };

/**
 * 容器内连的是 maddymail 这个别名，证书却是给 mail.example.test 签的。
 * 直接连别名会因主机名校验失败而拒绝连接；指定 servername 让 TLS 用
 * 真实主机名做 SNI 与证书校验，既连得上又不用关闭校验。
 */
function tlsOptions(): { rejectUnauthorized: boolean; servername: string } {
  return {
    rejectUnauthorized: config.mail.tlsRejectUnauthorized,
    servername: config.mail.hostname,
  };
}

/** 可被停止标记打断的等待，避免关闭会话时被退避睡眠拖住 */
function sleepInterruptibly(ms: number, isStopping: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const step = 100;
    let waited = 0;
    const tick = (): void => {
      if (isStopping() || waited >= ms) {
        resolve();
        return;
      }
      waited += step;
      setTimeout(tick, step);
    };
    setTimeout(tick, step);
  });
}

export type MailEvent =
  | { type: "exists"; folder: string; count: number }
  | { type: "expunge"; folder: string }
  | { type: "state"; status: "connected" | "reconnecting" | "closed" };

export type SessionFolder = {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  subscribed: boolean;
  messages: number;
  unseen: number;
};

export class TrashUnavailableError extends Error {
  constructor() {
    super("无法找到可用的已删除文件夹；邮件没有被删除");
    this.name = "TrashUnavailableError";
  }
}

/** An ordinary delete must never silently become an irreversible IMAP delete. */
export function requireTrashDestination(folder: string, trash: string | null): string {
  if (!trash || trash === folder) throw new TrashUnavailableError();
  return trash;
}

export type SessionMessageSummary = {
  uid: number;
  seq: number;
  subject: string;
  from: { name: string; address: string }[];
  to: { name: string; address: string }[];
  date: string | null;
  size: number;
  flags: string[];
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
};

export type SessionAttachment = {
  part: string;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
};

export type SessionMessageDetail = SessionMessageSummary & {
  cc: { name: string; address: string }[];
  replyTo: { name: string; address: string }[];
  text: string;
  html: string | null;
  messageId: string | null;
  references: string[];
  headers: Record<string, string>;
  attachments: SessionAttachment[];
  raw: Buffer;
};

function parsedAddresses(value: AddressObject | AddressObject[] | undefined): { name: string; address: string }[] {
  const objects = Array.isArray(value) ? value : value ? [value] : [];
  return objects.flatMap((object) => object.value)
    .flatMap((item) => item.group ?? [item])
    .filter((item) => Boolean(item.address))
    .map((item) => ({ name: item.name, address: item.address! }));
}

function splitAddress(value: string | undefined): { name: string; address: string }[] {
  if (!value) return [];
  return value
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = chunk.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
      if (match) return { name: match[1]?.trim() ?? "", address: match[2]?.trim() ?? "" };
      return { name: "", address: chunk };
    });
}

function firstHeader(headers: Map<string, unknown>, key: string): string {
  const raw = headers.get(key);
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "text" in raw) {
    return String((raw as { text: unknown }).text);
  }
  return "";
}

/**
 * 一条已登录的邮箱会话。
 *
 * 密码只存在内存里，不落库——这是规划里明确的要求，
 * 代价是服务重启后所有邮箱会话需要重新登录。
 */
export class MailboxSession {
  readonly id: string;
  readonly mailbox: string;
  private readonly password: string;
  private client: ImapFlow | null = null;
  /**
   * 单独一条连接专门跑 IDLE。
   * 如果和命令共用一条连接，IDLE 期间后续命令会被阻塞（IMAP 协议限制），
   * 界面就会卡在加载状态。
   */
  private idleClient: ImapFlow | null = null;
  private connecting: Promise<void> | null = null;
  private readonly connectingClients = new Set<ImapFlow>();
  private readonly connectionTimeoutMs: number;
  private readonly authenticationTimeoutMs: number;
  private idleTask: Promise<void> | null = null;
  private stopping = false;
  private readonly shutdown = new AbortController();
  private opQueue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(event: MailEvent) => void>();
  private cachedFolders: SessionFolder[] = [];

  constructor(id: string, mailbox: string, password: string, timeouts: SessionTimeouts = {}) {
    this.id = id;
    this.mailbox = mailbox;
    this.password = password;
    // Optional shorter limits support isolated transport tests; callers cannot raise production budgets.
    this.connectionTimeoutMs = Math.min(15_000, Math.max(1, timeouts.connectionTimeoutMs ?? 15_000));
    this.authenticationTimeoutMs = Math.min(20_000, Math.max(1, timeouts.authenticationTimeoutMs ?? 20_000));
  }

  onEvent(listener: (event: MailEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 只给 SMTP 发信使用：nodemailer 需要原始密码。
   * 返回值不会写进日志，也不落库。
   */
  revealPassword(): string {
    return this.password;
  }

  emit(event: MailEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个订阅者报错不影响其他订阅者
      }
    }
  }

  /** 同一会话上的 IMAP 操作串行执行，避免抢占 mailbox lock。 */
  private run<T>(job: () => Promise<T>): Promise<T> {
    const attempt = async (): Promise<T> => {
      if (this.stopping) throw new Error("邮箱会话已关闭");
      try {
        return await job();
      } catch (error) {
        if (this.stopping) throw error;
        // 连接被对端断掉时，丢弃旧连接重试一次；其余错误直接抛出
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        if (!/Command failed|Connection not available|Not connected|ECONNRESET|socket|Closed/i.test(message)) {
          throw error;
        }
        if (this.client) this.closeClient(this.client);
        this.client = null;
        return job();
      }
    };
    const next = this.opQueue.then(attempt, attempt);
    this.opQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return withMailAbort(() => next, this.shutdown.signal);
  }

  private async ensureClient(): Promise<ImapFlow> {
    if (this.stopping) throw new Error("邮箱会话已关闭");
    if (this.client?.usable) return this.client;
    if (this.connecting) {
      await this.connecting;
      if (this.client?.usable) return this.client;
    }
    this.connecting = (async () => {
      const client = new ImapFlow({
        host: config.mail.host,
        port: config.mail.imapPort,
        secure: true,
        auth: { user: this.mailbox, pass: this.password },
        tls: tlsOptions(),
        logger: false,
        disableAutoIdle: true,
        // Let our deadline close the transport and return a stable MailDeadlineError first.
        connectionTimeout: this.connectionTimeoutMs + 1000,
        greetingTimeout: this.connectionTimeoutMs + 1000,
        socketTimeout: 30_000,
      });
      client.on("error", () => {
        if (!this.stopping) this.emit({ type: "state", status: "reconnecting" });
      });
      client.on("close", () => {
        if (this.client === client) this.client = null;
        if (!this.stopping) this.emit({ type: "state", status: "closed" });
      });
      await this.connectClient(client, () => {
        this.client = client;
        this.emit({ type: "state", status: "connected" });
      });
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
    if (!this.client) throw new Error("无法建立 IMAP 连接");
    return this.client;
  }

  private async ensureIdleClient(): Promise<ImapFlow> {
    if (this.stopping) throw new Error("邮箱会话已关闭");
    if (this.idleClient?.usable) return this.idleClient;
    const client = new ImapFlow({
      host: config.mail.host,
      port: config.mail.imapPort,
      secure: true,
      auth: { user: this.mailbox, pass: this.password },
      tls: tlsOptions(),
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: this.connectionTimeoutMs + 1000,
      greetingTimeout: this.connectionTimeoutMs + 1000,
    });
    client.on("error", () => { /* IDLE loop owns retry/error state; do not let EventEmitter throw. */ });
    client.on("exists", (data: { path: string; count: number }) => {
      if (!this.stopping) this.emit({ type: "exists", folder: data.path, count: data.count });
    });
    client.on("expunge", (data: { path: string }) => {
      if (!this.stopping) this.emit({ type: "expunge", folder: data.path });
    });
    client.on("close", () => {
      if (this.idleClient === client) this.idleClient = null;
    });
    await this.connectClient(client, () => { this.idleClient = client; });
    if (this.stopping || !client.usable) throw new Error("邮箱会话已关闭");
    return client;
  }

  private closeClient(client: ImapFlow): void {
    try { client.close(); } catch { /* Teardown cannot keep an HTTP request pending. */ }
  }

  private async connectClient(client: ImapFlow, activate: () => void): Promise<void> {
    this.connectingClients.add(client);
    try {
      await withMailDeadline(async () => {
        if (this.stopping) throw new Error("邮箱会话已关闭");
        await client.connect();
      }, this.connectionTimeoutMs, () => this.closeClient(client), "邮局连接超时", this.shutdown.signal);
      if (this.stopping || !client.usable) throw new Error("邮箱会话已关闭或连接不可用");
      // Transfer ownership synchronously before removing the connecting entry: close() must always find it.
      activate();
    } catch (error) {
      this.closeClient(client);
      throw error;
    } finally {
      this.connectingClients.delete(client);
    }
  }

  async ping(): Promise<void> {
    return withMailDeadline(() => this.run(async () => {
      const client = await this.ensureClient();
      await client.noop();
    }), this.authenticationTimeoutMs, () => { void this.close(); }, "邮局登录校验超时", this.shutdown.signal);
  }

  async folders(): Promise<SessionFolder[]> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const listed = await client.list({ statusQuery: { messages: true, unseen: true } });
      this.cachedFolders = listed.map((entry) => ({
        path: entry.path,
        name: entry.name,
        delimiter: entry.delimiter ?? "/",
        specialUse: entry.specialUse ?? null,
        subscribed: entry.subscribed !== false,
        messages: entry.status?.messages ?? 0,
        unseen: entry.status?.unseen ?? 0,
      }));
      return this.cachedFolders;
    });
  }

  async createFolder(path: string): Promise<void> {
    return this.run(async () => {
      const client = await this.ensureClient();
      await client.mailboxCreate(path);
    });
  }

  async renameFolder(path: string, next: string): Promise<void> {
    return this.run(async () => {
      const client = await this.ensureClient();
      await client.mailboxRename(path, next);
    });
  }

  async deleteFolder(path: string): Promise<void> {
    return this.run(async () => {
      const client = await this.ensureClient();
      await client.mailboxDelete(path);
    });
  }

  async subscribeFolder(path: string, subscribe: boolean): Promise<void> {
    return this.run(async () => {
      const client = await this.ensureClient();
      if (subscribe) await client.mailboxSubscribe(path);
      else await client.mailboxUnsubscribe(path);
    });
  }

  async emptyFolder(path: string): Promise<number> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const lock = await client.getMailboxLock(path);
      try {
        if (!client.mailbox || client.mailbox.exists === 0) return 0;
        const total = client.mailbox.exists;
        await client.messageDelete(`1:${total}`, { uid: false });
        return total;
      } finally {
        lock.release();
      }
    });
  }

  async messages(
    folder: string,
    options: { limit: number; beforeSeq?: number | null },
  ): Promise<{ items: SessionMessageSummary[]; nextBefore: number | null; total: number }> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const lock = await client.getMailboxLock(folder);
      try {
        const exists = client.mailbox ? Number(client.mailbox.exists) : 0;
        if (exists === 0) return { items: [], nextBefore: null, total: 0 };
        const limit = Math.min(Math.max(options.limit, 1), 200);
        const end = Math.min(options.beforeSeq ?? exists, exists);
        const start = Math.max(1, end - limit + 1);
        const items: SessionMessageSummary[] = [];
        for await (const message of client.fetch(`${start}:${end}`, {
          uid: true,
          envelope: true,
          flags: true,
          size: true,
          bodyStructure: true,
        })) {
          items.push(toSummary(message));
        }
        items.sort((a, b) => b.seq - a.seq);
        return { items, nextBefore: start > 1 ? start - 1 : null, total: exists };
      } finally {
        lock.release();
      }
    });
  }

  async message(folder: string, uid: number): Promise<SessionMessageDetail | null> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const lock = await client.getMailboxLock(folder);
      try {
        const message = await client.fetchOne(
          String(uid),
          { uid: true, envelope: true, flags: true, size: true, source: true },
          { uid: true },
        );
        if (!message) return null;
        const source = message.source ?? Buffer.alloc(0);
        const parsed = await simpleParser(source);
        const headers = new Map<string, unknown>();
        for (const [key, value] of parsed.headers) headers.set(key.toLowerCase(), value);
        const attachments: SessionAttachment[] = parsed.attachments.map((item, index) => ({
          part: String(index + 1),
          filename: item.filename ?? `附件-${index + 1}`,
          contentType: item.contentType,
          size: item.size ?? 0,
          contentId: item.contentId ?? null,
        }));
        return {
          ...toSummary(message),
          cc: parsedAddresses(parsed.cc),
          replyTo: parsedAddresses(parsed.replyTo),
          text: parsed.text ?? "",
          html: typeof parsed.html === "string" ? parsed.html : null,
          messageId: parsed.messageId ?? firstHeader(headers, "message-id") ?? null,
          references: (() => {
            const raw = firstHeader(headers, "references");
            return raw ? raw.split(/\s+/).filter(Boolean) : [];
          })(),
          headers: Object.fromEntries(
            [
              "from",
              "to",
              "cc",
              "subject",
              "date",
              "message-id",
              "reply-to",
              "list-unsubscribe",
              "authentication-results",
              "received-spf",
              "dkim-signature",
            ].map((key) => [key, firstHeader(headers, key)]),
          ),
          attachments,
          raw: source,
        };
      } finally {
        lock.release();
      }
    });
  }

  async attachment(folder: string, uid: number, part: string): Promise<{
    filename: string;
    contentType: string;
    content: Buffer;
  } | null> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const lock = await client.getMailboxLock(folder);
      try {
        const message = await client.fetchOne(
          String(uid),
          { uid: true, source: true },
          { uid: true },
        );
        if (!message || !message.source) return null;
        const parsed = await simpleParser(message.source);
        const index = Number.parseInt(part, 10) - 1;
        const item = parsed.attachments[index];
        if (!item) return null;
        return {
          filename: item.filename ?? `attachment-${part}`,
          contentType: item.contentType,
          content: item.content,
        };
      } finally {
        lock.release();
      }
    });
  }

  async setFlags(
    folder: string,
    uids: number[],
    flags: string[],
    mode: "add" | "remove" | "set",
  ): Promise<void> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const lock = await client.getMailboxLock(folder);
      try {
        const range = uids;
        if (mode === "add") await client.messageFlagsAdd(range, flags, { uid: true });
        else if (mode === "remove") await client.messageFlagsRemove(range, flags, { uid: true });
        else await client.messageFlagsSet(range, flags, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async move(folder: string, uids: number[], target: string): Promise<void> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageMove(uids, target, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async remove(folder: string, uids: number[], permanent: boolean): Promise<void> {
    return this.run(async () => {
      const client = await this.ensureClient();
      if (!permanent) {
        const trash = requireTrashDestination(folder, await this.findSpecial("\\Trash"));
        const lock = await client.getMailboxLock(folder);
        try {
          await client.messageMove(uids, trash, { uid: true });
        } finally {
          lock.release();
        }
        return;
      }
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageDelete(uids, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async append(folder: string, content: Buffer, flags: string[] = []): Promise<void> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const result = await client.append(folder, content, flags);
      if (result === false) throw new Error(`写入 ${folder} 失败`);
    });
  }

  async search(folder: string, query: Record<string, unknown>): Promise<number[]> {
    return this.run(async () => {
      const client = await this.ensureClient();
      const lock = await client.getMailboxLock(folder);
      try {
        const result = await client.search(query, { uid: true });
        return Array.isArray(result) ? result.slice(-400) : [];
      } finally {
        lock.release();
      }
    });
  }

  /** 按 UID 批量取摘要（搜索结果用） */
  async summariesByUid(folder: string, uids: number[]): Promise<SessionMessageSummary[]> {
    if (uids.length === 0) return [];
    return this.run(async () => {
      const client = await this.ensureClient();
      const lock = await client.getMailboxLock(folder);
      try {
        const items: SessionMessageSummary[] = [];
        for await (const message of client.fetch(
          uids,
          { uid: true, envelope: true, flags: true, size: true, bodyStructure: true },
          { uid: true },
        )) {
          items.push(toSummary(message));
        }
        items.sort((a, b) => b.uid - a.uid);
        return items;
      } finally {
        lock.release();
      }
    });
  }

  async findSpecial(specialUse: string): Promise<string | null> {
    const folders = this.cachedFolders.length > 0 ? this.cachedFolders : await this.folders();
    const hit = folders.find((folder) => folder.specialUse === specialUse);
    return hit?.path ?? null;
  }

  /** IDLE 长连接：收到变化就通知订阅者，断线自动退避重连。 */
  startIdle(): void {
    if (this.idleTask || this.stopping) return;
    this.idleTask = (async () => {
      let backoff = 1000;
      while (!this.stopping) {
        try {
          const client = await this.ensureIdleClient();
          if (this.stopping) break;
          backoff = 1000;
          const lock = await client.getMailboxLock("INBOX");
          try {
            if (this.stopping) break;
            emitExists(client, this);
            await client.idle();
          } finally {
            lock.release();
          }
        } catch {
          if (this.stopping) break;
          this.emit({ type: "state", status: "reconnecting" });
          if (this.idleClient) this.closeClient(this.idleClient);
          this.idleClient = null;
          await sleepInterruptibly(backoff, () => this.stopping);
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
    })();
  }

  async close(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.shutdown.abort();
    const task = this.idleTask;
    this.idleTask = null;
    // Cancel pending connections too. LOGOUT can queue behind a stalled command indefinitely.
    const clients = new Set(this.connectingClients);
    if (this.client) clients.add(this.client);
    if (this.idleClient) clients.add(this.idleClient);
    this.client = null;
    this.idleClient = null;
    this.connectingClients.clear();
    for (const client of clients) this.closeClient(client);
    // 最多等 2 秒，绝不把请求卡在 IDLE 结束上
    if (task) {
      await withMailDeadline(() => task, 2000, () => {}, "等待邮箱连接结束超时").catch(() => undefined);
    }
    this.emit({ type: "state", status: "closed" });
  }
}

function emitExists(client: ImapFlow, session: MailboxSession): void {
  const mailbox = client.mailbox;
  if (!mailbox) return;
  const path = typeof mailbox.path === "string" ? mailbox.path : "INBOX";
  session.emit({ type: "exists", folder: path, count: Number(mailbox.exists ?? 0) });
}

type RawMessage = {
  uid?: number;
  seq?: number;
  size?: number;
  flags?: Set<string>;
  envelope?: {
    subject?: string;
    date?: Date;
    from?: { name?: string; address?: string }[];
    to?: { name?: string; address?: string }[];
  };
  bodyStructure?: { childNodes?: unknown[]; disposition?: string; type?: string };
};

function toSummary(message: RawMessage): SessionMessageSummary {
  const flags = message.flags ?? new Set<string>();
  const envelope = message.envelope ?? {};
  return {
    uid: Number(message.uid ?? 0),
    seq: Number(message.seq ?? 0),
    subject: envelope.subject ?? "(无主题)",
    from: (envelope.from ?? []).map((item) => ({
      name: item.name ?? "",
      address: item.address ?? "",
    })),
    to: (envelope.to ?? []).map((item) => ({
      name: item.name ?? "",
      address: item.address ?? "",
    })),
    date: envelope.date ? new Date(envelope.date).toISOString() : null,
    size: Number(message.size ?? 0),
    flags: [...flags],
    seen: flags.has("\\Seen"),
    flagged: flags.has("\\Flagged"),
    answered: flags.has("\\Answered"),
    hasAttachments: hasAttachmentNode(message.bodyStructure),
  };
}

function hasAttachmentNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const record = node as { disposition?: string; childNodes?: unknown[] };
  if (typeof record.disposition === "string" && /attachment/i.test(record.disposition)) return true;
  if (Array.isArray(record.childNodes)) return record.childNodes.some(hasAttachmentNode);
  return false;
}

export function normalizeMailboxAccount(input: string, domain: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed}@${domain}`;
}

export function isValidLocalAccount(account: string, domain: string): boolean {
  if (!account.endsWith(`@${domain}`)) return false;
  const local = account.slice(0, account.length - domain.length - 1);
  return /^[a-z0-9][a-z0-9_.-]{2,49}$/.test(local);
}
