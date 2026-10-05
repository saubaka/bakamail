import assert from "node:assert/strict";
import test from "node:test";
import { apiQuery, ApiError, setCsrfToken } from "../src/api/client.ts";
import * as mail from "../src/api/mail.ts";
import * as contacts from "../src/api/contacts.ts";
import * as drafts from "../src/api/drafts.ts";
import * as settings from "../src/api/settings.ts";
import * as ops from "../src/api/mailOps.ts";

test("查询参数只编码一次，保留空字符串/零/否，缺省不进入 URL", () => {
  const folder = "项目 / A&B #? + %";
  const path = apiQuery("/api/messages", { folder, before: 0, unseen: false, q: "", missing: undefined, absent: null });
  const parsed = new URL(path, "https://mail.test");
  assert.equal(parsed.pathname, "/api/messages");
  assert.equal(parsed.searchParams.get("folder"), folder);
  assert.equal(parsed.searchParams.get("before"), "0");
  assert.equal(parsed.searchParams.get("unseen"), "0");
  assert.equal(parsed.searchParams.get("q"), "");
  assert.equal(parsed.hash, "");
  assert.equal(parsed.searchParams.has("missing"), false);
  assert.equal(apiQuery("/api/messages", { absent: null }), "/api/messages");
  assert.throws(() => apiQuery("/api/messages?folder=INBOX", {}), TypeError);
  assert.throws(() => apiQuery("https://mail.test/api/messages", {}), TypeError);
  assert.throws(() => apiQuery("/api/messages", { before: NaN }), TypeError);
  assert.throws(() => apiQuery("/api/messages", { bad: [] as unknown as string }), TypeError);
});

test("邮件领域请求的路径、方法、正文和 CSRF 保持后端契约", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: unknown; csrf: string | null }> = [];
  setCsrfToken("mail-test", "mail");
  globalThis.fetch = async (input, options) => {
    calls.push({ path: String(input), method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : null,
      csrf: new Headers(options?.headers).get("x-csrf-token") });
    return Response.json({ ok: true, data: String(input) === "/api/messages" && options?.method === "POST"
      ? { messageId: "mock-only", savedToSent: true } : {}, error: "" });
  };
  try {
    const folder = "项目 / A&B";
    await mail.listFolders();
    await mail.listMessages(folder, "50", 12);
    await mail.readMessage(3, folder);
    await mail.searchMessages({ folder, q: "a+b #?", unseen: true, flagged: false });
    await mail.sendMessage({ to: "qa@mail.test", subject: "only mocked", text: "test", attachments: [] });
    await mail.setMessageFlags(folder, [3, 3], ["\\Seen"], "add");
    await mail.moveMessages(folder, [3], "Archive");
    await mail.deleteMessages(folder, [3], false);
    await mail.createFolder(folder);
    await mail.renameFolder(folder, "new");
    await mail.subscribeFolder(folder, false);
    await mail.emptyFolder(folder);
    await mail.removeFolder(folder);
    assert.deepEqual(calls.map(({ path, method }) => [new URL(path, "https://mail.test").pathname, method]), [
      ["/api/folders", "GET"], ["/api/messages", "GET"], ["/api/messages/3", "GET"], ["/api/search", "GET"],
      ["/api/messages", "POST"], ["/api/messages/flags", "POST"], ["/api/messages/move", "POST"], ["/api/messages/delete", "POST"],
      ["/api/folders", "POST"], ["/api/folders", "PATCH"], ["/api/folders/subscribe", "POST"], ["/api/folders/empty", "POST"], ["/api/folders", "DELETE"],
    ]);
    assert.equal(new URL(calls[1]!.path, "https://mail.test").searchParams.get("folder"), folder);
    const search = new URL(calls[3]!.path, "https://mail.test").searchParams;
    assert.equal(search.get("q"), "a+b #?");
    assert.equal(search.get("unseen"), "1");
    assert.equal(search.has("flagged"), false);
    assert.deepEqual(calls[5]!.body, { folder, uids: [3], flags: ["\\Seen"], mode: "add" });
    assert.equal(calls[0]!.csrf, null);
    assert.ok(calls.slice(4).every((call) => call.csrf === "mail-test"));
    const attachment = new URL(mail.attachmentPath(3, "1.2", folder), "https://mail.test");
    assert.equal(attachment.pathname, "/api/messages/3/attachments/1.2");
    assert.equal(attachment.searchParams.get("folder"), folder);
    assert.ok(calls.every((call) => call.path.startsWith("/api/")));
  } finally { setCsrfToken(""); globalThis.fetch = originalFetch; }
});

test("草稿、联系人、设置及运维领域模块保持请求正文与权限作用域", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: unknown; csrf: string | null }> = [];
  setCsrfToken("mail-test"); setCsrfToken("admin-test", "admin");
  globalThis.fetch = async (input, options) => {
    calls.push({ path: String(input), method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : null,
      csrf: new Headers(options?.headers).get("x-csrf-token") });
    return Response.json({ ok: true, data: { available: true, source: "snapshot", capturedAt: "2026-09-26T02:49:01.488Z", stale: true, lines: ["sample"] }, error: "" });
  };
  try {
    await contacts.listContacts();
    await contacts.saveContact({ name: "QA", email: "qa@mail.test", note: "test" });
    await contacts.saveContact({ name: "QA", email: "qa@mail.test", note: "updated" }, 2);
    await contacts.deleteContact(2);
    await drafts.listDrafts();
    await drafts.saveDraft({ to: "qa@mail.test", text: "body" }, "qa/草稿? #");
    await drafts.deleteDraft("qa/草稿? #");
    await settings.readMailSettings();
    await settings.saveMailSettings({ pageSize: "25" });
    await ops.readMailQueue(); await ops.checkMailDomain();
    const logs = await ops.readMailLogs(100);
    assert.equal(logs.capturedAt, "2026-09-26T02:49:01.488Z");
    assert.equal(logs.stale, true);
    assert.equal(calls[2]!.path, "/api/contacts/2");
    assert.equal(calls[2]!.method, "PATCH");
    assert.deepEqual(calls[5]!.body, { id: "qa/草稿? #", payload: { to: "qa@mail.test", text: "body" } });
    assert.equal(calls[6]!.path, "/api/drafts/qa%2F%E8%8D%89%E7%A8%BF%3F%20%23");
    assert.deepEqual(calls[8]!.body, { pageSize: "25" });
    assert.deepEqual(calls.slice(9).map((call) => call.path), ["/api/admin/queue", "/api/admin/domain-check", "/api/admin/logs/mail?lines=100"]);
    assert.ok(calls.filter((call) => call.method !== "GET").every((call) => call.csrf === "mail-test"));
  } finally { setCsrfToken(""); setCsrfToken("", "admin"); globalThis.fetch = originalFetch; }
});

test("领域模块拒绝错误编号和路径，服务端错误与取消不被吞掉", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, options) => {
    calls += 1;
    if (options?.signal?.aborted) throw new DOMException("cancelled", "AbortError");
    return Response.json({ ok: false, data: null, error: "暂时不可用" }, { status: 503 });
  };
  try {
    assert.throws(() => mail.readMessage(0, "INBOX"), TypeError);
    assert.throws(() => mail.moveMessages("INBOX", [], "Archive"), TypeError);
    assert.throws(() => contacts.deleteContact(NaN), TypeError);
    assert.throws(() => drafts.deleteDraft(".."), TypeError);
    assert.throws(() => ops.readMailLogs(2001), TypeError);
    assert.throws(() => mail.attachmentPath(1, "../bad", "INBOX"), TypeError);
    assert.equal(calls, 0);
    await assert.rejects(mail.listFolders(), (error: unknown) => error instanceof ApiError && error.status === 503);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(mail.readMessage(1, "INBOX", controller.signal), { name: "AbortError" });
  } finally { globalThis.fetch = originalFetch; }
});
