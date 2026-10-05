#!/usr/bin/env node
/**
 * 真实链路自检：对着一台已经登录过的邮局，把收发信、整理、删除全跑一遍。
 *
 * 用法（开发机）：
 *   BAKAMAIL_BASE=http://127.0.0.1:8790 \
 *   BAKAMAIL_ACCOUNT=bakamail-verify \
 *   BAKAMAIL_PASSWORD=... \
 *   node scripts/verify-live.mjs
 *
 * 为了证明「发信走 submission、写回已发送」这条链路是通的，脚本会真的
 * 发一封邮件给自己，然后轮询收件箱把它取回来。
 */

const base = process.env.BAKAMAIL_BASE ?? "http://127.0.0.1:8790";
const account = process.env.BAKAMAIL_ACCOUNT ?? "";
const password = process.env.BAKAMAIL_PASSWORD ?? "";

if (!account || !password) {
  console.error("需要 BAKAMAIL_ACCOUNT 与 BAKAMAIL_PASSWORD");
  process.exit(2);
}
if (process.env.BAKAMAIL_ALLOW_TEST_WRITES !== account) {
  console.error("此脚本会真实发送、移动并删除测试邮件；必须设置 BAKAMAIL_ALLOW_TEST_WRITES 为已获准使用的专用测试账号。");
  process.exit(2);
}

let cookie = "";
let csrf = "";
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(path, options = {}) {
  const headers = { origin: new URL(base).origin, "user-agent": "BakaMail dedicated acceptance", ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (csrf) headers["x-csrf-token"] = csrf;
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
  }
  let payload = null;
  const text = await response.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { status: response.status, payload, text, headers: response.headers };
}

const marker = `BakaMail 自检 ${new Date().toISOString()}`;
const attachmentText = "BakaMail dedicated acceptance attachment\n";
let mailbox = "";
const eventTypes = new Set();
const eventController = new AbortController();
let eventTask = null;
let eventError = "";

async function watchEvents() {
  try {
    const response = await fetch(`${base}/api/events`, {
      headers: { cookie, origin: new URL(base).origin }, signal: eventController.signal,
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!eventController.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        if (event) eventTypes.add(event);
      }
    }
  } catch (error) {
    if (!eventController.signal.aborted) eventError = error.message;
  }
}

async function waitForEvent(type, timeout) {
  const deadline = Date.now() + timeout;
  while (!eventTypes.has(type) && !eventError && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  record(`公网 SSE ${type}`, eventTypes.has(type), eventError);
}

async function main() {
  const login = await call("/api/auth/login", {
    method: "POST",
    body: { account, password },
  });
  if (!login.payload?.ok) {
    record("登录", false, login.payload?.error ?? `HTTP ${login.status}`);
    return;
  }
  csrf = login.payload.data.csrfToken;
  mailbox = login.payload.data.mailbox;
  record("登录", true, mailbox);
  eventTask = watchEvents();
  await waitForEvent("ready", 10_000);

  const folders = await call("/api/folders");
  const list = folders.payload?.data?.folders ?? [];
  const sentFolder = list.find((item) => item.specialUse === "\\Sent")?.path ?? "Sent";
  const archiveFolder = list.find((item) => item.specialUse === "\\Archive")?.path ?? "Archive";
  const trashFolder = list.find((item) => item.specialUse === "\\Trash")?.path ?? "Trash";
  record("读取文件夹", list.length > 0, list.map((item) => item.path).join(", "));
  record(
    "识别特殊文件夹",
    list.some((item) => item.specialUse),
    list
      .filter((item) => item.specialUse)
      .map((item) => `${item.path}=${item.specialUse}`)
      .join(", ") || "没有任何文件夹带 special-use",
  );

  const send = await call("/api/messages", {
    method: "POST",
    body: {
      to: mailbox,
      subject: marker,
      text: `这是一封来自 BakaMail 自检脚本的邮件。\n时间：${new Date().toISOString()}\n如果这封邮件出现在收件箱，说明发信与投递都通了。`,
      attachments: [{filename:"bakamail-qa.txt",contentType:"text/plain",contentBase64:Buffer.from(attachmentText).toString("base64")}],
    },
  });
  record(
    "发信（走 465 submission）",
    Boolean(send.payload?.ok),
    send.payload?.error ??
      `${send.payload?.data?.messageId ?? ""} 原始长度=${send.payload?.data?.rawSize ?? 0}`,
  );
  if (!send.payload?.ok) return;
  record(
    "后端写回已发送",
    send.payload?.data?.savedToSent === true,
    send.payload?.data?.saveError || "写回成功",
  );

  // 发信成功后应当用 IMAP APPEND 写回 Sent
  let sentCopy = null;
  const sentDeadline = Date.now() + 15_000;
  while (Date.now() < sentDeadline && !sentCopy) {
    const page = await call(`/api/messages?folder=${encodeURIComponent(sentFolder)}&limit=10`);
    sentCopy = (page.payload?.data?.items ?? []).find((item) => item.subject === marker) ?? null;
    if (!sentCopy) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  record("已发送文件夹写入副本", Boolean(sentCopy), sentCopy ? `uid=${sentCopy.uid}` : "15 秒内没有出现");

  let target = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !target) {
    const page = await call("/api/messages?folder=INBOX&limit=20");
    const items = page.payload?.data?.items ?? [];
    target = items.find((item) => item.subject === marker) ?? null;
    if (!target) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  record("收件箱收到该邮件", Boolean(target), target ? `uid=${target.uid}` : "60 秒内没有出现");
  if (!target) return;
  await waitForEvent("exists", 10_000);

  const detail = await call(`/api/messages/${target.uid}?folder=INBOX`);
  const body = detail.payload?.data?.text ?? "";
  record("读取正文", body.includes("BakaMail 自检脚本"), `${body.length} 字符`);
  const attachment = detail.payload?.data?.attachments?.find(item => item.filename === "bakamail-qa.txt");
  record("附件元数据", Boolean(attachment));
  if (attachment) {
    const file = await call(`/api/messages/${target.uid}/attachments/${encodeURIComponent(attachment.part)}?folder=INBOX&inline=1`);
    record("附件下载字节一致", file.status === 200 && file.text === attachmentText);
    record("文本附件不能内联执行且不缓存", /^attachment;/.test(file.headers.get("content-disposition") ?? "")
      && file.headers.get("cache-control")?.includes("no-store") === true
      && file.headers.get("content-security-policy")?.includes("sandbox") === true);
  }
  const raw = await call(`/api/messages/${target.uid}/raw?folder=INBOX`);
  record("原始邮件下载", raw.status === 200 && raw.text.includes("bakamail-qa.txt")
    && raw.headers.get("content-type")?.includes("message/rfc822") === true
    && /^attachment;/.test(raw.headers.get("content-disposition") ?? ""));

  const seen = await call("/api/messages/flags", {
    method: "POST",
    body: { folder: "INBOX", uids: [target.uid], flags: ["\\Flagged"], mode: "add" },
  });
  record("加星标", Boolean(seen.payload?.ok));

  const moved = await call("/api/messages/move", {
    method: "POST",
    body: { folder: "INBOX", uids: [target.uid], target: archiveFolder },
  });
  record("移动到归档", Boolean(moved.payload?.ok), moved.payload?.error ?? "");

  const search = await call(`/api/search?folder=${encodeURIComponent(archiveFolder)}&q=${encodeURIComponent(marker)}`);
  const matched = search.payload?.data?.items ?? [];
  record("搜索归档", matched.length > 0, `命中 ${matched.length} 封`);

  const uidInArchive = matched.find((item) => item.subject === marker)?.uid;
  if (uidInArchive) {
    const trashed = await call("/api/messages/delete", {
      method: "POST",
      body: { folder: archiveFolder, uids: [uidInArchive], permanent: false },
    });
    record("移入垃圾箱", Boolean(trashed.payload?.ok), trashed.payload?.error ?? "");

    // UIDs are scoped to each mailbox. Never reuse the Archive UID in Trash.
    const trashPage = await call(`/api/messages?folder=${encodeURIComponent(trashFolder)}&limit=20`);
    const trashCopy = (trashPage.payload?.data?.items ?? []).find((item) => item.subject === marker);
    record("垃圾箱中的测试副本", Boolean(trashCopy));
    if (trashCopy) {
      const purge = await call("/api/messages/delete", {
        method: "POST",
        body: { folder: trashFolder, uids: [trashCopy.uid], permanent: true },
      });
      record("彻底删除", Boolean(purge.payload?.ok), purge.payload?.error ?? "");
    }
  }

  const temporaryFolder = `QA-${Date.now()}`;
  const renamedFolder = `${temporaryFolder}-renamed`;
  const create = await call("/api/folders", { method: "POST", body: { path: temporaryFolder } });
  record("新建测试文件夹", Boolean(create.payload?.ok));
  if (create.payload?.ok) {
    const rename = await call("/api/folders", { method: "PATCH", body: { path: temporaryFolder, name: renamedFolder } });
    record("重命名测试文件夹", Boolean(rename.payload?.ok));
    const activeFolder = rename.payload?.ok ? renamedFolder : temporaryFolder;
    const subscribe = await call("/api/folders/subscribe", { method: "POST", body: { path: activeFolder, subscribe: true } });
    const folderPage = await call("/api/folders");
    record("订阅状态由邮局返回", Boolean(subscribe.payload?.ok) && folderPage.payload?.data?.folders?.some((row) => row.path === activeFolder && row.subscribed));
    if (sentCopy) {
      const moveCopy = await call("/api/messages/move", { method: "POST", body: { folder: sentFolder, uids: [sentCopy.uid], target: activeFolder } });
      record("测试副本移动到自建文件夹", Boolean(moveCopy.payload?.ok));
      if (moveCopy.payload?.ok) {
        const empty = await call("/api/folders/empty", { method: "POST", body: { path: activeFolder } });
        record("清空仅含测试邮件的文件夹", Boolean(empty.payload?.ok) && empty.payload?.data?.removed === 1);
      }
    }
    const remove = await call(`/api/folders?path=${encodeURIComponent(activeFolder)}`, { method: "DELETE" });
    record("删除自建测试文件夹", Boolean(remove.payload?.ok));
  }

  const draft = await call("/api/drafts", { method: "POST", body: { payload: { to: mailbox, subject: marker, text: "测试草稿" } } });
  const draftId = draft.payload?.data?.id;
  const draftList = await call("/api/drafts");
  record("草稿写入和读取", Boolean(draftId) && draftList.payload?.data?.drafts?.some((row) => row.id === draftId));
  if (draftId) {
    const remove = await call(`/api/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
    record("删除测试草稿", Boolean(remove.payload?.ok));
  }
  const contact = await call("/api/contacts", { method: "POST", body: { name: "测试自身", email: mailbox, note: marker } });
  const contactList = await call("/api/contacts");
  const contactRow = contactList.payload?.data?.contacts?.find((row) => row.email === mailbox && row.note === marker);
  record("联系人写入和读取", Boolean(contact.payload?.ok) && Boolean(contactRow));
  if (contactRow) {
    const update = await call(`/api/contacts/${contactRow.id}`, { method: "PATCH", body: { name: "测试自身已更新", email: mailbox, note: marker } });
    record("修改测试联系人", Boolean(update.payload?.ok));
    const remove = await call(`/api/contacts/${contactRow.id}`, { method: "DELETE" });
    record("删除测试联系人", Boolean(remove.payload?.ok));
  }
  const settings = await call("/api/settings", { method: "PATCH", body: { density: "compact", pageSize: "25" } });
  const readSettings = await call("/api/settings");
  record("专用账号偏好写入和回读", Boolean(settings.payload?.ok) && readSettings.payload?.data?.settings?.pageSize === "25");
  await waitForEvent("ping", 30_000);
}

main()
  .catch((error) => {
    record("执行异常", false, error instanceof Error ? error.message : String(error));
  })
  .finally(async () => {
    eventController.abort();
    if (eventTask) await eventTask;
    if (cookie && csrf) {
      try {
        const logout = await call("/api/auth/logout", { method: "POST" });
        record("退出登录", Boolean(logout.payload?.ok) || logout.status === 401);
      } catch { record("退出登录", false, "请检查测试账号会话"); }
    }
    const failed = results.filter((item) => !item.ok);
    console.log(`\n合计 ${results.length} 项，失败 ${failed.length} 项`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
