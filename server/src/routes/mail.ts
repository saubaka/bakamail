import { Router } from "express";
import { config } from "../config.ts";
import { db, nowIso } from "../db.ts";
import { fail, ok, readJson, requestId, MAIL_BODY_LIMIT } from "../http/kit.ts";
import { requireCsrf, requireMail } from "../http/auth.ts";
import { recordAudit } from "../security/audit.ts";
import { addressListProblem, sendMail, senderAddressAllowed, type OutgoingAttachment } from "../mail/sender.ts";
import { TrashUnavailableError, type MailboxSession } from "../mail/session.ts";

export const mailRouter = Router();

/**
 * 只为邮件相关的路径挂登录校验。
 * 如果直接 mailRouter.use(requireMail)，未匹配的 /api/* 也会返回 401 而不是 404。
 */
const MAIL_PATHS = [
  "/folders",
  "/messages",
  "/drafts",
  "/contacts",
  "/settings",
  "/search",
  "/events",
];

mailRouter.use((request, response, next) => {
  const hit = MAIL_PATHS.some(
    (prefix) => request.path === prefix || request.path.startsWith(`${prefix}/`),
  );
  if (!hit) {
    next();
    return;
  }
  requireMail(request, response, next);
});

function mailboxOf(request: { mail?: { sessionRow: { mailbox: string } } }): string {
  return request.mail?.sessionRow.mailbox ?? "";
}

function validFolderName(value: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,60}$/u.test(value);
}

async function existingFolder(session: MailboxSession, path: string) {
  return (await session.folders()).find((folder) => folder.path === path);
}

mailRouter.get("/folders", async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  ok(response, { folders: await session.folders(), account: session.mailbox });
});

mailRouter.post("/folders", requireCsrf, async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const body = await readJson<{ path?: string }>(request);
  const path = String(body.path ?? "").trim();
  if (!validFolderName(path)) {
    fail(response, 400, "文件夹名不合法");
    return;
  }
  try {
    await session.createFolder(path);
  } catch {
    fail(response, 502, "邮局未确认新建文件夹，请刷新核对后再试");
    return;
  }
  recordAudit({
    actorType: "mailbox",
    actor: session.mailbox,
    action: "folder.create",
    targetType: "folder",
    targetId: path,
    requestId: requestId(request),
  });
  ok(response, { created: path });
});

mailRouter.patch("/folders", requireCsrf, async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const body = await readJson<{ path?: string; name?: string }>(request);
  const path = String(body.path ?? "");
  const name = String(body.name ?? "").trim();
  if (!path || !validFolderName(name)) {
    fail(response, 400, "文件夹名不合法");
    return;
  }
  const folder = await existingFolder(session, path);
  if (!folder) return fail(response, 404, "文件夹不存在");
  if (folder.specialUse || path.toUpperCase() === "INBOX") {
    return fail(response, 400, "系统文件夹不能重命名");
  }
  if (path === name) return ok(response, { from: path, to: name });
  await session.renameFolder(path, name);
  recordAudit({
    actorType: "mailbox",
    actor: session.mailbox,
    action: "folder.rename",
    targetType: "folder",
    targetId: path,
    summary: `重命名为 ${name}`,
    requestId: requestId(request),
  });
  ok(response, { from: path, to: name });
});

mailRouter.delete("/folders", requireCsrf, async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const path = String(request.query.path ?? "");
  if (!path) {
    fail(response, 400, "缺少 path");
    return;
  }
  const folder = await existingFolder(session, path);
  if (!folder) return fail(response, 404, "文件夹不存在");
  if (folder.specialUse || path.toUpperCase() === "INBOX") {
    return fail(response, 400, "系统文件夹不能删除");
  }
  await session.deleteFolder(path);
  recordAudit({
    actorType: "mailbox",
    actor: session.mailbox,
    action: "folder.delete",
    targetType: "folder",
    targetId: path,
    requestId: requestId(request),
  });
  ok(response, { deleted: path });
});

mailRouter.post("/folders/empty", requireCsrf, async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const body = await readJson<{ path?: string }>(request);
  const path = String(body.path ?? "");
  if (!path) return fail(response, 400, "缺少 path");
  if (!(await existingFolder(session, path))) return fail(response, 404, "文件夹不存在");
  const removed = await session.emptyFolder(path);
  recordAudit({
    actorType: "mailbox",
    actor: session.mailbox,
    action: "folder.empty",
    targetType: "folder",
    targetId: path,
    summary: `清空 ${removed} 封`,
    requestId: requestId(request),
  });
  ok(response, { removed });
});

mailRouter.post("/folders/subscribe", requireCsrf, async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const body = await readJson<{ path?: string; subscribe?: boolean }>(request);
  const path = String(body.path ?? "");
  if (!path) return fail(response, 400, "缺少 path");
  if (!(await existingFolder(session, path))) return fail(response, 404, "文件夹不存在");
  await session.subscribeFolder(path, body.subscribe !== false);
  ok(response, { path, subscribe: body.subscribe !== false });
});

mailRouter.get("/messages", async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const folder = String(request.query.folder ?? "INBOX");
  const limit = Number.parseInt(String(request.query.limit ?? "50"), 10) || 50;
  const beforeRaw = Number.parseInt(String(request.query.before ?? ""), 10);
  const before = Number.isFinite(beforeRaw) ? beforeRaw : null;
  const result = await session.messages(folder, { limit, beforeSeq: before });
  ok(response, { folder, ...result });
});

mailRouter.get("/messages/:uid", async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const uid = Number.parseInt(request.params.uid ?? "", 10);
  const folder = String(request.query.folder ?? "INBOX");
  const detail = await session.message(folder, uid);
  if (!detail) {
    fail(response, 404, "邮件不存在");
    return;
  }
  const { raw, ...rest } = detail;
  ok(response, { ...rest, rawSize: raw.length });
});

mailRouter.get("/messages/:uid/raw", async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const uid = Number.parseInt(request.params.uid ?? "", 10);
  const folder = String(request.query.folder ?? "INBOX");
  const detail = await session.message(folder, uid);
  if (!detail) {
    fail(response, 404, "邮件不存在");
    return;
  }
  response.setHeader("content-type", "message/rfc822");
  response.setHeader("cache-control", "private, no-store");
  response.setHeader(
    "content-disposition",
    `attachment; filename="message-${uid}.eml"`,
  );
  response.end(detail.raw);
});

mailRouter.get("/messages/:uid/attachments/:part", async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const uid = Number.parseInt(request.params.uid ?? "", 10);
  const part = String(request.params.part ?? "1");
  const folder = String(request.query.folder ?? "INBOX");
  const file = await session.attachment(folder, uid, part);
  if (!file) {
    fail(response, 404, "附件不存在");
    return;
  }
  const contentType = (file.contentType || "application/octet-stream").split(";")[0]!.toLowerCase();
  const inline = request.query.inline === "1" &&
    new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]).has(contentType);
  response.setHeader("content-type", inline ? contentType : "application/octet-stream");
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("content-security-policy", "sandbox; default-src 'none'");
  response.setHeader("content-length", String(file.content.length));
  const safeName = encodeURIComponent(file.filename);
  response.setHeader(
    "content-disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${safeName}`,
  );
  response.end(file.content);
});

type SendBody = {
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  from?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename?: string; contentType?: string; contentBase64?: string }[];
  saveToSent?: boolean;
};

function asList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(",");
  return list.map((item) => item.trim()).filter(Boolean);
}

mailRouter.post("/messages", requireCsrf, async (request, response) => {
  const context = request.mail;
  if (!context) return;
  const session = context.session;
  const body = await readJson<SendBody>(request, { maxBytes: MAIL_BODY_LIMIT });

  const account = session.mailbox;
  const from = String(body.from ?? account).trim().toLowerCase() || account;
  // maddy 侧 authorize_sender + user_to_email 只允许本人地址；加号别名归到本人
  if (!senderAddressAllowed(account, from)) {
    fail(response, 400, "发件人必须是当前登录账号");
    return;
  }

  const to = asList(body.to);
  const cc = asList(body.cc);
  const bcc = asList(body.bcc);
  // 抄送 / 密送可以为空，只有填了才校验
  const problem =
    addressListProblem(to) ||
    (cc.length > 0 ? addressListProblem(cc) : "") ||
    (bcc.length > 0 ? addressListProblem(bcc) : "");
  if (problem) {
    fail(response, 400, problem);
    return;
  }

  const attachments: OutgoingAttachment[] = [];
  let attachmentBytes = 0;
  for (const item of body.attachments ?? []) {
    const content = Buffer.from(String(item.contentBase64 ?? ""), "base64");
    attachmentBytes += content.length;
    attachments.push({
      filename: String(item.filename ?? "attachment"),
      contentType: item.contentType,
      content,
    });
  }

  const text = String(body.text ?? "");
  const html = body.html ? String(body.html) : undefined;
  const estimated = (text.length + (html?.length ?? 0)) * 2 + attachmentBytes;
  if (estimated > config.mail.maxMessageBytes) {
    fail(response, 413, "邮件超过邮局 32 MiB 上限，请减少附件");
    return;
  }

  const outcome = await sendMail(account, session.revealPassword(), {
    from,
    to,
    cc,
    bcc,
    subject: String(body.subject ?? "(无主题)"),
    text,
    html,
    attachments,
    inReplyTo: body.inReplyTo,
    references: body.references,
  });

  if (!outcome.ok) {
    recordAudit({
      actorType: "mailbox",
      actor: account,
      action: "mail.send-failed",
      targetType: "message",
      summary: outcome.category,
      requestId: requestId(request),
    });
    const hint: Record<string, string> = {
      auth: "邮局拒绝了认证，请重新登录后再试",
      "recipient-rejected": "收件人被邮局拒绝",
      "too-large": "邮件超过邮局 32 MiB 上限",
      timeout: "连接邮局超时",
      network: "无法连接邮局",
      unknown: "发送失败",
    };
    fail(response, 502, `${hint[outcome.category] ?? "发送失败"}；发送结果未确认，请核对后再试`);
    return;
  }

  let saveError = "";
  let savedToSent = false;
  if (body.saveToSent !== false) {
    let sent = "";
    try {
      sent = (await session.findSpecial("\\Sent")) ?? "Sent";
      if (outcome.raw.length === 0) throw new Error("发送结果没有返回原始邮件内容");
      await session.append(sent, outcome.raw, ["\\Seen"]);
      savedToSent = true;
    } catch {
      // SMTP acceptance remains confirmed even if folder lookup or IMAP APPEND fails.
      saveError = "邮局已接受邮件，但未能确认保存到已发送，请勿重复发送";
      recordAudit({
        actorType: "mailbox",
        actor: account,
        action: "mail.save-sent-failed",
        targetType: "folder",
        targetId: sent,
        summary: saveError.slice(0, 200),
        requestId: requestId(request),
      });
    }
  }

  recordAudit({
    actorType: "mailbox",
    actor: account,
    action: "mail.send",
    targetType: "message",
    targetId: outcome.messageId,
    summary: `发往 ${to.join(", ")}`,
    requestId: requestId(request),
  });
  ok(response, {
    messageId: outcome.messageId,
    accepted: outcome.accepted,
    savedToSent,
    saveError,
    rawSize: outcome.raw.length,
  });
});

mailRouter.post("/messages/flags", requireCsrf, async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const body = await readJson<{
    folder?: string;
    uids?: number[];
    flags?: string[];
    mode?: "add" | "remove" | "set";
  }>(request);
  const folder = String(body.folder ?? "INBOX");
  const uids = (body.uids ?? []).map(Number).filter(Number.isFinite);
  const flags = (body.flags ?? ["\\Seen"]).filter((flag) => /^\\?[A-Za-z]+$/.test(flag));
  if (uids.length === 0 || flags.length === 0) {
    fail(response, 400, "缺少 uids 或 flags");
    return;
  }
  await session.setFlags(folder, uids, flags, body.mode ?? "add");
  ok(response, { updated: uids.length });
});

mailRouter.post("/messages/move", requireCsrf, async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const body = await readJson<{ folder?: string; uids?: number[]; target?: string }>(request);
  const uids = (body.uids ?? []).map(Number).filter(Number.isFinite);
  const target = String(body.target ?? "");
  if (uids.length === 0 || !target) {
    fail(response, 400, "缺少 uids 或 target");
    return;
  }
  await session.move(String(body.folder ?? "INBOX"), uids, target);
  recordAudit({
    actorType: "mailbox",
    actor: session.mailbox,
    action: "message.move",
    targetType: "folder",
    targetId: target,
    summary: `移动 ${uids.length} 封`,
    requestId: requestId(request),
  });
  ok(response, { moved: uids.length });
});

mailRouter.post("/messages/delete", requireCsrf, async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const body = await readJson<{ folder?: string; uids?: number[]; permanent?: boolean }>(request);
  const folder = String(body.folder ?? "INBOX");
  const uids = (body.uids ?? []).map(Number).filter(Number.isFinite);
  if (uids.length === 0) {
    fail(response, 400, "缺少 uids");
    return;
  }
  try {
    await session.remove(folder, uids, body.permanent === true);
  } catch (error) {
    if (error instanceof TrashUnavailableError) {
      fail(response, 409, error.message);
      return;
    }
    throw error;
  }
  recordAudit({
    actorType: "mailbox",
    actor: session.mailbox,
    action: body.permanent ? "message.delete-permanent" : "message.trash",
    targetType: "folder",
    targetId: folder,
    summary: `${uids.length} 封`,
    requestId: requestId(request),
  });
  ok(response, { deleted: uids.length, permanent: body.permanent === true });
});

mailRouter.get("/search", async (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  const folder = String(request.query.folder ?? "INBOX");
  const q = String(request.query.q ?? "").trim();
  const query: Record<string, unknown> = {};
  if (q) query.or = [{ subject: q }, { from: q }, { to: q }];
  if (request.query.unseen === "1") query.seen = false;
  if (request.query.seen === "1") query.seen = true;
  if (request.query.flagged === "1") query.flagged = true;
  const since = String(request.query.since ?? "");
  if (since) query.since = new Date(since);
  const before = String(request.query.before ?? "");
  if (before) query.before = new Date(before);
  if (Object.keys(query).length === 0) {
    fail(response, 400, "请至少给出一个搜索条件");
    return;
  }
  try {
    const uids = await session.search(folder, query);
    const items = await session.summariesByUid(folder, uids);
    ok(response, { folder, matched: items.length, items });
  } catch {
    fail(response, 502, "邮局搜索暂不可用，请稍后重试");
  }
});

// ---- 草稿 ----

mailRouter.get("/drafts", (request, response) => {
  const owner = mailboxOf(request);
  const rows = db
    .prepare("select id, payload, created_at, updated_at from drafts where owner = ? order by updated_at desc limit 100")
    .all(owner) as { id: string; payload: string }[];
  ok(response, {
    drafts: rows.map((row) => ({ id: row.id, ...(JSON.parse(row.payload) as object) })),
  });
});

mailRouter.post("/drafts", requireCsrf, async (request, response) => {
  const owner = mailboxOf(request);
  const body = await readJson<{ id?: string; payload?: unknown }>(request, { maxBytes: MAIL_BODY_LIMIT });
  const id = String(body.id ?? "") || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify(body.payload ?? {});
  const existing = db.prepare("select id from drafts where id = ? and owner = ?").get(id, owner);
  if (existing) {
    db.prepare("update drafts set payload = ?, updated_at = ? where id = ?").run(
      payload,
      nowIso(),
      id,
    );
  } else {
    db.prepare(
      "insert into drafts (id, owner, payload, created_at, updated_at) values (?, ?, ?, ?, ?)",
    ).run(id, owner, payload, nowIso(), nowIso());
  }
  ok(response, { id });
});

mailRouter.delete("/drafts/:id", requireCsrf, (request, response) => {
  const owner = mailboxOf(request);
  db.prepare("delete from drafts where id = ? and owner = ?").run(String(request.params.id ?? ""), owner);
  ok(response, { deleted: request.params.id });
});

// ---- 通讯录 ----

mailRouter.get("/contacts", (request, response) => {
  const owner = mailboxOf(request);
  ok(response, {
    contacts: db
      .prepare(
        "select id, name, email, note, created_at, updated_at from contact_entries where owner = ? order by name collate nocase",
      )
      .all(owner),
  });
});

mailRouter.post("/contacts", requireCsrf, async (request, response) => {
  const owner = mailboxOf(request);
  const body = await readJson<{ name?: string; email?: string; note?: string }>(request);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(response, 400, "邮箱格式不正确");
    return;
  }
  db.prepare(
    `insert into contact_entries (owner, name, email, note, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(owner, email) do update set name = excluded.name, note = excluded.note,
       updated_at = excluded.updated_at`,
  ).run(owner, String(body.name ?? "").slice(0, 80), email, String(body.note ?? "").slice(0, 200), nowIso(), nowIso());
  const contact = db.prepare("select id, name, email, note from contact_entries where owner = ? and email = ?")
    .get(owner, email);
  ok(response, { saved: email, contact });
});

mailRouter.patch("/contacts/:id", requireCsrf, async (request, response) => {
  const owner = mailboxOf(request);
  const body = await readJson<{ name?: string; email?: string; note?: string }>(request);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(response, 400, "邮箱格式不正确");
  }
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail(response, 400, "联系人编号不正确");
  const duplicate = db.prepare("select id from contact_entries where owner = ? and email = ? and id != ?")
    .get(owner, email, id);
  if (duplicate) return fail(response, 409, "该邮箱已经在通讯录中");
  const result = db.prepare(
    "update contact_entries set name = ?, email = ?, note = ?, updated_at = ? where id = ? and owner = ?",
  ).run(String(body.name ?? "").slice(0, 80), email, String(body.note ?? "").slice(0, 200), nowIso(), id, owner);
  if (result.changes === 0) return fail(response, 404, "联系人不存在");
  const contact = db.prepare("select id, name, email, note from contact_entries where owner = ? and id = ?")
    .get(owner, id);
  ok(response, { updated: request.params.id, contact });
});

mailRouter.delete("/contacts/:id", requireCsrf, (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail(response, 400, "联系人编号不正确");
  const owner = mailboxOf(request);
  db.prepare("delete from contact_entries where id = ? and owner = ?").run(
    id,
    owner,
  );
  ok(response, { deleted: request.params.id });
});

// ---- 设置 ----

const ALLOWED_SETTINGS = new Set([
  "density",
  "pageSize",
  "timeFormat",
  "showPreview",
  "remoteImages",
  "desktopNotifications",
  "notificationSound",
  "signature",
  "language",
]);

const SETTING_OPTIONS: Record<string, readonly string[]> = {
  density: ["comfortable", "compact"],
  pageSize: ["25", "50", "100"],
  timeFormat: ["24h", "12h"],
  showPreview: ["true", "false"],
  remoteImages: ["ask", "block", "allow"],
  desktopNotifications: ["true", "false"],
  notificationSound: ["true", "false"],
  language: ["zh-CN", "en"],
};

mailRouter.get("/settings", (request, response) => {
  const owner = mailboxOf(request);
  const rows = db
    .prepare("select key, value from user_settings where owner = ?")
    .all(owner) as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  ok(response, { settings });
});

mailRouter.patch("/settings", requireCsrf, async (request, response) => {
  const owner = mailboxOf(request);
  const body = await readJson<Record<string, string>>(request);
  if (Object.keys(body).length === 0) return fail(response, 400, "请提供要保存的设置");
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_SETTINGS.has(key)) return fail(response, 400, "设置字段不合法");
    if (typeof value !== "string"
      || (key === "signature" ? value.length > 2000 : !SETTING_OPTIONS[key]?.includes(value))) {
      return fail(response, 400, `${key} 设置值不合法`);
    }
  }
  const upsert = db.prepare(
      `insert into user_settings (owner, key, value, updated_at) values (?, ?, ?, ?)
       on conflict(owner, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    );
  const updatedAt = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, value] of Object.entries(body)) upsert.run(owner, key, value, updatedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  ok(response, { saved: true });
});

// ---- SSE 事件流 ----

mailRouter.get("/events", (request, response) => {
  const session = request.mail?.session;
  if (!session) return;
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("cache-control", "no-cache, no-transform");
  response.setHeader("connection", "keep-alive");
  response.setHeader("x-accel-buffering", "no");
  response.flushHeaders();

  const send = (event: string, data: unknown): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send("ready", { mailbox: session.mailbox });

  const unsubscribe = session.onEvent((event) => {
    if (event.type === "exists") send("exists", event);
    else if (event.type === "expunge") send("expunge", event);
    else send("state", event);
  });

  const heartbeat = setInterval(() => {
    // 用真实事件而不是注释：浏览器需要能感知“这条流还活着”，
    // 前端据此判断要不要退回轮询（例如反向代理开了缓冲时）。
    send("ping", { at: Date.now() });
  }, 25_000);

  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    response.end();
  });
});
