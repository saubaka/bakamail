import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = mkdtempSync(join(tmpdir(), "bakamail-state-"));
const dataDir = mkdtempSync(join(tmpdir(), "bakamail-data-"));

process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = "test";
process.env.SECRET_KEY = "test-secret-key-for-api-tests";
process.env.BOOTSTRAP_ADMIN = "admin";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "baka-mail-test-2026";
process.env.HUMAN_CHECK_TEST_MODE = "1";
process.env.MIN_FORM_SECONDS = "1";
process.env.COOKIE_SECURE = "0";
process.env.MADDY_RUNNER = "local";
process.env.MADDY_BIN = join(here, "fixtures", "fake-maddy.sh");
process.env.MADDY_DATA_DIR = stateDir;
process.env.MAIL_LOG_SNAPSHOT_PATH = join(stateDir, "mail-log.json");
process.env.FAKE_MADDY_STATE = stateDir;
process.env.MAIL_DOMAIN = "example.test";
// 指向一个必然拒绝连接的端口，让登录失败得又准又快
process.env.MAIL_HOST = "127.0.0.1";
process.env.MAIL_IMAP_PORT = "1";
process.env.LOGIN_MAX_FAILURES = "5";
process.env.REGISTER_MAX_PER_HOUR = "100";
process.env.REGISTER_MAX_PER_DAY = "1000";

const { createApp } = await import("../src/app.ts");
const { createMailSession, findMailSession, MAIL_COOKIE } = await import("../src/http/session.ts");
const { MailboxSession, TrashUnavailableError } = await import("../src/mail/session.ts");
const { putSession, getSession, dropSession } = await import("../src/mail/registry.ts");
const { default: request } = await import("supertest");
const { default: nodemailer } = await import("nodemailer");
const { db, setSetting } = await import("../src/db.ts");
const { fingerprint } = await import("../src/security/identity.ts");
const { recordLoginAttempt, blockIdentity, unblockIdentity, failureCount, globalFailureCount } = await import("../src/security/rateLimit.ts");

const app = createApp({ bootstrapAdmin: true, log: () => undefined });
// These legacy feature tests share one app/source. Dedicated phase2 tests exercise persistent abuse budgets.
test.afterEach(() => db.exec("delete from security_budgets"));
const admin = request.agent(app);
const user = request.agent(app);

let adminCsrf = "";
async function adminLoginBody(username: string, password: string) {
  const challenge = await request(app).get("/api/admin/human-check");
  assert.equal(challenge.status, 200);
  return { username, password, humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD" };
}
const contractSession = createMailSession("contract@example.test", "test-fingerprint", "api-test");
const mockMailbox = new MailboxSession(contractSession.id, "contract@example.test", "not-used");
const folderRows = [
  { path: "INBOX", name: "INBOX", delimiter: "/", specialUse: "\\Inbox", subscribed: true, messages: 2, unseen: 1 },
  { path: "Projects", name: "Projects", delimiter: "/", specialUse: null, subscribed: true, messages: 0, unseen: 0 },
];
const folderCalls: string[] = [];
mockMailbox.folders = async () => folderRows;
mockMailbox.renameFolder = async (path, name) => { folderCalls.push(`rename:${path}:${name}`); };
mockMailbox.deleteFolder = async (path) => { folderCalls.push(`delete:${path}`); };
mockMailbox.emptyFolder = async (path) => { folderCalls.push(`empty:${path}`); return 2; };
mockMailbox.attachment = async (_folder, _uid, _part) => ({
  filename: "unsafe.svg", contentType: "image/svg+xml", content: Buffer.from("<svg></svg>"),
});
putSession(mockMailbox);

function mailRequest(method: "get" | "post" | "patch" | "delete", path: string) {
  return request(app)[method](path)
    .set("Cookie", `${MAIL_COOKIE}=${contractSession.token}`)
    .set("x-csrf-token", contractSession.csrfToken);
}

function fakeCredentials(): string[] {
  try {
    return readFileSync(join(stateDir, "credentials"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|")[0] ?? "");
  } catch {
    return [];
  }
}

function fakeAccounts(): string[] {
  try {
    return readFileSync(join(stateDir, "accounts"), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

test("health 可用", async () => {
  const response = await request(app).get("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.status, "ok");
  assert.deepEqual(Object.keys(response.body.data), ["status"]);
  assert.equal(response.headers["content-security-policy"], "connect-src 'self'");
});

test("畸形 JSON 与非对象 JSON 返回稳定 400，不回显请求内容", async () => {
  for (const raw of ['{"password":"private-marker",', "null", "[]", "42", '"secret"']) {
    const response = await mailRequest("post", "/api/contacts")
      .set("content-type", "application/json").send(raw);
    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.ok(["invalid_json", "invalid_body"].includes(response.body.code));
    assert.equal(response.headers["cache-control"], "no-store");
    assert.doesNotMatch(JSON.stringify(response.body), /private-marker|SyntaxError|secret/);
  }
});

test("非 JSON 和压缩内容拒绝为 415，空请求体仍允许", async () => {
  for (const contentType of ["text/plain", "application/json; charset=iso-8859-1"]) {
    const response = await mailRequest("post", "/api/contacts").set("content-type", contentType).send("{}");
    assert.equal(response.status, 415);
    assert.equal(response.body.code, "unsupported_body_type");
    assert.equal(response.headers.connection, "close");
  }
  const compressed = await mailRequest("post", "/api/contacts")
    .set("content-encoding", "gzip").send({});
  assert.equal(compressed.status, 415);
  // The business validator, not the JSON decoder, rejects missing contact fields.
  const empty = await mailRequest("post", "/api/contacts");
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, undefined);
});

test("表单请求超过 64 KiB 得到可读 413，邮件草稿不误用表单额度", async () => {
  const text = "x".repeat(64 * 1024);
  const rejected = await mailRequest("post", "/api/contacts").send({ note: text });
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.code, "payload_too_large");
  assert.equal(rejected.headers.connection, "close");
  const saved = await mailRequest("post", "/api/drafts").send({ payload: { text } });
  assert.equal(saved.status, 200);
  assert.equal((await mailRequest("get", "/api/drafts")).body.data.drafts.find((row: { id: string }) => row.id === saved.body.data.id).text, text);
  await mailRequest("delete", `/api/drafts/${saved.body.data.id}`);
});

test("同一请求使用稳定安全编号，内部异常与日志不泄漏原始内容", async () => {
  const logs: string[] = [];
  const isolatedApp = createApp({ bootstrapAdmin: false, log: line => logs.push(line) });
  const original = mockMailbox.folders;
  mockMailbox.folders = async () => { throw Object.assign(new Error("password=secret-marker\ninternal.maddy:993"), { responseText: "mail-body-secret" }); };
  try {
    const response = await request(isolatedApp).get("/api/folders")
      .set("Cookie", `${MAIL_COOKIE}=${contractSession.token}`).set("x-request-id", "qa-safe-id:1");
    assert.equal(response.status, 500);
    assert.equal(response.headers["x-request-id"], "qa-safe-id:1");
    assert.match(logs.join(" "), /request-id=qa-safe-id:1/);
    assert.doesNotMatch(logs.join(" ") + JSON.stringify(response.body), /secret-marker|internal\.maddy|mail-body-secret/);
    const unsafe = await request(isolatedApp).get("/api/health").set("x-request-id", "space injected");
    assert.match(unsafe.headers["x-request-id"], /^[a-f0-9-]{36}$/);
  } finally { mockMailbox.folders = original; }
});

test("文件夹与搜索失败不将 IMAP 原始错误下发", async () => {
  const create = mockMailbox.createFolder;
  const search = mockMailbox.search;
  const leak = new Error("AUTH token-secret internal.maddy:993 /data/private");
  mockMailbox.createFolder = async () => { throw leak; };
  mockMailbox.search = async () => { throw leak; };
  try {
    const created = await mailRequest("post", "/api/folders").send({ path: "Privacy QA" });
    const searched = await mailRequest("get", "/api/search?q=test");
    for (const response of [created, searched]) {
      assert.equal(response.status, 502);
      assert.doesNotMatch(JSON.stringify(response.body), /token-secret|internal\.maddy|\/data\/private/);
    }
  } finally { mockMailbox.createFolder = create; mockMailbox.search = search; }
});

test("SMTP 原始失败不会进入前端或审计，传输始终关闭", async () => {
  const original = nodemailer.createTransport;
  let closed = 0;
  nodemailer.createTransport = (() => ({
    sendMail: async () => { throw new Error("ECONNREFUSED smtp-secret internal.maddy:465"); },
    close: () => { closed += 1; },
  })) as typeof original;
  try {
    const response = await mailRequest("post", "/api/messages").send({ to: "self@example.test", text: "test" });
    assert.equal(response.status, 502);
    assert.match(response.body.error, /无法连接邮局/);
    assert.doesNotMatch(JSON.stringify(response.body), /smtp-secret|internal\.maddy/);
    const audit = db.prepare("select summary, request_id from audit_logs where action = 'mail.send-failed' order by id desc limit 1").get() as { summary: string; request_id: string };
    assert.equal(audit.summary, "network");
    assert.equal(audit.request_id, response.headers["x-request-id"]);
    assert.equal(closed, 1);
  } finally { nodemailer.createTransport = original; }
});

test("SMTP 已接受后查找或写回已发送失败仍返回确认成功，不泄漏 IMAP 错误", async () => {
  const original = nodemailer.createTransport;
  const find = mockMailbox.findSpecial;
  const append = mockMailbox.append;
  let sends = 0;
  nodemailer.createTransport = (() => ({
    sendMail: async () => { sends += 1; return { messageId: "<qa-confirmed@example.test>", accepted: ["self@example.test"] }; },
    close: () => {},
  })) as typeof original;
  try {
    for (const stage of ["find", "append"]) {
      mockMailbox.findSpecial = async () => { if (stage === "find") throw new Error("private-find-error"); return "Sent"; };
      mockMailbox.append = async () => { throw new Error("private-append-error internal.maddy"); };
      const response = await mailRequest("post", "/api/messages").send({ to: "self@example.test", text: "test" });
      assert.equal(response.status, 200);
      assert.equal(response.body.data.messageId, "<qa-confirmed@example.test>");
      assert.equal(response.body.data.savedToSent, false);
      assert.match(response.body.data.saveError, /已接受/);
      assert.doesNotMatch(JSON.stringify(response.body), /private-|internal\.maddy/);
      const audit = db.prepare("select summary from audit_logs where action = 'mail.save-sent-failed' order by id desc limit 1").get() as { summary: string };
      assert.doesNotMatch(audit.summary, /private-|internal\.maddy/);
    }
    assert.equal(sends, 2);
  } finally { nodemailer.createTransport = original; mockMailbox.findSpecial = find; mockMailbox.append = append; }
});

test("不请求写回时不伪报已保存，邮件额度允许超过 64 KiB 的合法正文", async () => {
  const original = nodemailer.createTransport;
  const find = mockMailbox.findSpecial;
  nodemailer.createTransport = (() => ({
    sendMail: async () => ({ messageId: "<qa-nosent@example.test>", accepted: ["self@example.test"] }),
    close: () => {},
  })) as typeof original;
  mockMailbox.findSpecial = async () => { throw new Error("must not look up Sent"); };
  try {
    const response = await mailRequest("post", "/api/messages")
      .send({ to: "self@example.test", text: "x".repeat(70 * 1024), saveToSent: false });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.savedToSent, false);
    assert.equal(response.body.data.saveError, "");
  } finally { nodemailer.createTransport = original; mockMailbox.findSpecial = find; }
});

test("未知接口返回 404 且结构统一", async () => {
  const response = await request(app).get("/api/nope");
  assert.equal(response.status, 404);
  assert.equal(response.body.ok, false);
  assert.equal(typeof response.body.error, "string");
});

test("未登录访问邮箱接口返回 401", async () => {
  const response = await request(app).get("/api/folders");
  assert.equal(response.status, 401);
});

test("文件夹操作拒绝系统文件夹和非法新名称", async () => {
  const invalid = await mailRequest("patch", "/api/folders")
    .send({ path: "Projects", name: "../bad" });
  assert.equal(invalid.status, 400);
  const systemRename = await mailRequest("patch", "/api/folders")
    .send({ path: "INBOX", name: "New Inbox" });
  assert.equal(systemRename.status, 400);
  const systemDelete = await mailRequest("delete", "/api/folders?path=INBOX");
  assert.equal(systemDelete.status, 400);
  const missing = await mailRequest("post", "/api/folders/empty").send({ path: "Missing" });
  assert.equal(missing.status, 404);
  assert.deepEqual(folderCalls, []);
});

test("设置写入先完整校验，错误值不会部分保存", async () => {
  const rejected = await mailRequest("patch", "/api/settings")
    .send({ density: "compact", pageSize: "9999" });
  assert.equal(rejected.status, 400);
  const unknown = await mailRequest("patch", "/api/settings")
    .send({ density: "compact", extra: "ignored-before" });
  assert.equal(unknown.status, 400);
  const nonString = await mailRequest("patch", "/api/settings")
    .send({ signature: { unexpected: true } });
  assert.equal(nonString.status, 400);
  const empty = await mailRequest("patch", "/api/settings").send({});
  assert.equal(empty.status, 400);
  const read = await mailRequest("get", "/api/settings");
  assert.equal(read.body.data.settings.density, undefined);
});

test("设置写入中途 SQLite 失败会整体回滚，不留下前面字段", async () => {
  db.exec(`create trigger reject_settings_second_field before insert on user_settings
    when NEW.owner = 'contract@example.test' and NEW.key = 'pageSize'
    begin select raise(abort, 'test settings fault'); end`);
  try {
    const response = await mailRequest("patch", "/api/settings")
      .send({ density: "compact", pageSize: "25" });
    assert.equal(response.status, 500);
    const read = await mailRequest("get", "/api/settings");
    assert.equal(read.status, 200);
    assert.equal(read.body.data.settings.density, undefined);
    assert.equal(read.body.data.settings.pageSize, undefined);
  } finally {
    db.exec("drop trigger reject_settings_second_field");
  }
  const accepted = await mailRequest("patch", "/api/settings")
    .send({ density: "compact", pageSize: "25" });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.saved, true);
  const read = await mailRequest("get", "/api/settings");
  assert.equal(read.body.data.settings.density, "compact");
  assert.equal(read.body.data.settings.pageSize, "25");
});

test("恶意附件请求 inline 仍强制下载且禁止缓存", async () => {
  const response = await mailRequest("get", "/api/messages/1/attachments/1?inline=1");
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-disposition"]), /^attachment;/);
  assert.equal(response.headers["content-type"], "application/octet-stream");
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.match(String(response.headers["content-security-policy"]), /sandbox/);
});

test("普通删除找不到垃圾箱时返回冲突，不记录成功", async () => {
  const originalRemove = mockMailbox.remove;
  mockMailbox.remove = async () => { throw new TrashUnavailableError(); };
  try {
    const response = await mailRequest("post", "/api/messages/delete")
      .send({ folder: "INBOX", uids: [1], permanent: false });
    assert.equal(response.status, 409);
    assert.equal(response.body.ok, false);
    assert.match(response.body.error, /没有被删除/);
  } finally {
    mockMailbox.remove = originalRemove;
  }
});

test("联系人新增及重复保存返回服务器确认的完整条目和同一编号", async () => {
  const first = await mailRequest("post", "/api/contacts")
    .send({ name: "A".repeat(90), email: "CONTACT-QA@EXAMPLE.TEST", note: "N".repeat(220) });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.saved, "contact-qa@example.test");
  const contact = first.body.data.contact;
  assert.ok(Number.isSafeInteger(contact.id) && contact.id > 0);
  assert.deepEqual(Object.keys(contact).sort(), ["email", "id", "name", "note"]);
  assert.equal(contact.name.length, 80);
  assert.equal(contact.note.length, 200);
  const updated = await mailRequest("post", "/api/contacts")
    .send({ name: "已更新", email: "contact-qa@example.test", note: "确认内容" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.contact.id, contact.id);
  assert.deepEqual(updated.body.data.contact, { id: contact.id, name: "已更新", email: "contact-qa@example.test", note: "确认内容" });
});

test("联系人修改返回数据库真实条目，冲突不会覆盖已有联系人", async () => {
  const first = await mailRequest("post", "/api/contacts").send({ name: "修改前", email: "patch-qa@example.test", note: "" });
  const id = first.body.data.contact.id;
  const patched = await mailRequest("patch", `/api/contacts/${id}`)
    .send({ name: "修改后", email: "NEW-PATCH-QA@EXAMPLE.TEST", note: "新备注" });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.updated, String(id));
  assert.deepEqual(patched.body.data.contact, { id, name: "修改后", email: "new-patch-qa@example.test", note: "新备注" });
  const conflict = await mailRequest("patch", `/api/contacts/${id}`)
    .send({ name: "不应保存", email: "contact-qa@example.test", note: "" });
  assert.equal(conflict.status, 409);
  const list = await mailRequest("get", "/api/contacts");
  assert.equal(list.body.data.contacts.find((row: { id: number }) => row.id === id).name, "修改后");
});

test("联系人读取、修改、删除按邮箱隔离，非法删除编号被拒绝", async () => {
  const own = await mailRequest("post", "/api/contacts").send({ name: "私有", email: "private-qa@example.test", note: "" });
  const id = own.body.data.contact.id;
  const other = createMailSession("other-contact@example.test", "other-contact-fingerprint", "contact-test");
  putSession(new MailboxSession(other.id, "other-contact@example.test", "not-used"));
  const otherRequest = (method: "get" | "patch" | "delete", path: string) => request(app)[method](path)
    .set("Cookie", `${MAIL_COOKIE}=${other.token}`).set("x-csrf-token", other.csrfToken);
  const list = await otherRequest("get", "/api/contacts");
  assert.deepEqual(list.body.data.contacts, []);
  const patch = await otherRequest("patch", `/api/contacts/${id}`).send({ name: "越权", email: "private-qa@example.test", note: "" });
  assert.equal(patch.status, 404);
  assert.equal((await otherRequest("delete", `/api/contacts/${id}`)).status, 200);
  const stillOwned = await mailRequest("get", "/api/contacts");
  assert.equal(stillOwned.body.data.contacts.find((row: { id: number }) => row.id === id).name, "私有");
  for (const invalid of ["0", "-1", "NaN", "1.2", "9007199254740992"]) {
    assert.equal((await mailRequest("delete", `/api/contacts/${invalid}`)).status, 400);
  }
  assert.equal((await mailRequest("delete", `/api/contacts/${id}`)).status, 200);
  const after = await mailRequest("get", "/api/contacts");
  assert.equal(after.body.data.contacts.some((row: { id: number }) => row.id === id), false);
});

test("联系人保存仍要求普通账号 CSRF，不因响应契约变化放宽权限", async () => {
  const rejected = await request(app).post("/api/contacts")
    .set("Cookie", `${MAIL_COOKIE}=${contractSession.token}`)
    .send({ name: "不得保存", email: "csrf-contact@example.test", note: "" });
  assert.equal(rejected.status, 403);
  const list = await mailRequest("get", "/api/contacts");
  assert.equal(list.body.data.contacts.some((row: { email: string }) => row.email === "csrf-contact@example.test"), false);
});

test("发送未确认标记随本人草稿保存和读回，不暴露给其他账号", async () => {
  const saved = await mailRequest("post", "/api/drafts").send({ payload: { to: "qa@example.test", text: "本地草稿", deliveryUnconfirmed: true } });
  assert.equal(saved.status, 200);
  const id = saved.body.data.id;
  const read = await mailRequest("get", "/api/drafts");
  const draft = read.body.data.drafts.find((item: { id: string }) => item.id === id);
  assert.equal(draft.deliveryUnconfirmed, true);
  assert.equal(draft.text, "本地草稿");
  const other = createMailSession("draft-other@example.test", "draft-other", "test");
  putSession(new MailboxSession(other.id, "draft-other@example.test", "never-used"));
  const hidden = await request(app).get("/api/drafts").set("Cookie", `${MAIL_COOKIE}=${other.token}`);
  assert.equal(hidden.body.data.drafts.some((item: { id: string }) => item.id === id), false);
  await mailRequest("delete", `/api/drafts/${id}`);
});

test("后台登录成功并拿到权限清单", async () => {
  const response = await admin
    .post("/api/admin/auth/login")
    .send(await adminLoginBody("admin", "baka-mail-test-2026"));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.role, "superadmin");
  assert.ok(response.body.data.permissions.includes("*"));
  adminCsrf = response.body.data.csrfToken;
  assert.ok(adminCsrf.length > 10);
});

test("邮局日志经后台鉴权、严格参数和快照校验返回，不把故障报成空日志", async () => {
  assert.equal((await request(app).get("/api/admin/logs/mail")).status, 401);
  assert.equal((await mailRequest("get", "/api/admin/logs/mail")).status, 401);
  assert.equal((await admin.get("/api/admin/logs/mail?lines=NaN")).status, 400);
  assert.equal((await admin.get("/api/admin/logs/mail?lines=100&lines=200")).status, 400);
  const missing = await admin.get("/api/admin/logs/mail");
  assert.equal(missing.status, 200);
  assert.equal(missing.body.data.available, false);
  writeFileSync(process.env.MAIL_LOG_SNAPSHOT_PATH!, JSON.stringify({ version: 1,
    container: "maddy", source: "docker-logs", capturedAt: new Date().toISOString(),
    truncated: false, lines: ["delivery accepted", "token=must-not-be-returned"] }));
  const logs = await admin.get("/api/admin/logs/mail?lines=10");
  assert.equal(logs.status, 200);
  assert.equal(logs.body.data.available, true);
  assert.equal(logs.body.data.source, "snapshot");
  assert.equal(logs.body.data.stale, false);
  assert.equal(JSON.stringify(logs.body).includes("must-not-be-returned"), false);
  assert.match(logs.headers["cache-control"], /no-store/);
  writeFileSync(process.env.MAIL_LOG_SNAPSHOT_PATH!, "invalid");
  assert.equal((await admin.get("/api/admin/logs/mail")).status, 502);
});

test("后台登录失败不泄露账号是否存在", async () => {
  const unknown = await request(app)
    .post("/api/admin/auth/login")
    .send(await adminLoginBody("no-such-admin", "whatever-long"));
  const wrongPassword = await request(app)
    .post("/api/admin/auth/login")
    .send(await adminLoginBody("admin", "definitely-wrong"));
  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknown.body.error, wrongPassword.body.error);
});

test("缺少 CSRF 令牌的写操作被拒绝", async () => {
  const response = await admin.patch("/api/admin/security").send({ loginMaxFailures: 6 });
  assert.equal(response.status, 403);
});

test("带上 CSRF 令牌后可以修改安全策略", async () => {
  const response = await admin
    .patch("/api/admin/security")
    .set("x-csrf-token", adminCsrf)
    .send({ loginMaxFailures: 6, globalFailureAlert: 80 });
  assert.equal(response.status, 200);
  const read = await admin.get("/api/admin/security");
  assert.equal(read.body.data.loginMaxFailures, 6);
  assert.equal(read.body.data.globalFailureAlert, 80);
});

test("管理员可列出并解封匿名来源，操作留有审计记录", async () => {
  const identityHash = "a".repeat(32);
  const invalid = await admin
    .post("/api/admin/login-logs/block")
    .set("x-csrf-token", adminCsrf)
    .send({ identityHash: "not-a-fingerprint" });
  assert.equal(invalid.status, 400);

  const blocked = await admin
    .post("/api/admin/login-logs/block")
    .set("x-csrf-token", adminCsrf)
    .send({ identityHash, reason: "单测" });
  assert.equal(blocked.status, 200);
  const list = await admin.get("/api/admin/blocked-identities");
  assert.equal(list.status, 200);
  assert.ok(list.body.data.identities.some((row: { identity_hash: string }) => row.identity_hash === identityHash));

  const noCsrf = await admin
    .post("/api/admin/blocked-identities/unblock")
    .send({ identityHash });
  assert.equal(noCsrf.status, 403);
  const unblocked = await admin
    .post("/api/admin/blocked-identities/unblock")
    .set("x-csrf-token", adminCsrf)
    .send({ identityHash });
  assert.equal(unblocked.status, 200);
  const listAfter = await admin.get("/api/admin/blocked-identities");
  assert.equal(listAfter.body.data.identities.some((row: { identity_hash: string }) => row.identity_hash === identityHash), false);
  const audit = await admin.get("/api/admin/audit-logs?limit=20");
  assert.ok(audit.body.data.logs.some((row: { action: string; target_id: string }) =>
    row.action === "security.unblock-identity" && row.target_id === identityHash));
});

test("强制下线只影响目标会话，在线列表不再显示它", async () => {
  const before = await admin.get("/api/admin/sessions");
  const existing = new Set((before.body.data.sessions as { id: string }[]).map((row) => row.id));
  const anotherAdmin = request.agent(app);
  const login = await anotherAdmin
    .post("/api/admin/auth/login")
    .send(await adminLoginBody("admin", "baka-mail-test-2026"));
  assert.equal(login.status, 200);
  const during = await admin.get("/api/admin/sessions");
  const target = (during.body.data.sessions as { id: string }[]).find((row) => !existing.has(row.id));
  assert.ok(target);
  const revoked = await admin
    .post(`/api/admin/sessions/${target.id}/revoke`)
    .set("x-csrf-token", adminCsrf);
  assert.equal(revoked.status, 200);
  const after = await admin.get("/api/admin/sessions");
  assert.equal((after.body.data.sessions as { id: string }[]).some((row) => row.id === target.id), false);
  assert.equal((await anotherAdmin.get("/api/admin/auth/me")).status, 401);
  const repeated = await admin
    .post(`/api/admin/sessions/${target.id}/revoke`)
    .set("x-csrf-token", adminCsrf);
  assert.equal(repeated.status, 404);
});

test("创建邀请码", async () => {
  const response = await admin
    .post("/api/admin/invites")
    .set("x-csrf-token", adminCsrf)
    .send({ note: "单测邀请码", ttlHours: 24 });
  assert.equal(response.status, 200);
  assert.ok(response.body.data.code.length >= 16);
  assert.equal(response.body.data.code.length > 0, true);
});

test("邀请码只能撤销一次，重复操作不会伪报成功", async () => {
  const created = await admin
    .post("/api/admin/invites")
    .set("x-csrf-token", adminCsrf)
    .send({ note: "撤销单测", ttlHours: 24 });
  const id = created.body.data.id as number;
  const first = await admin
    .post(`/api/admin/invites/${id}/revoke`)
    .set("x-csrf-token", adminCsrf);
  assert.equal(first.status, 200);
  const second = await admin
    .post(`/api/admin/invites/${id}/revoke`)
    .set("x-csrf-token", adminCsrf);
  assert.equal(second.status, 404);
  const list = await admin.get("/api/admin/invites");
  assert.ok(list.body.data.invites.some((row: { id: number; revoked_at: string | null }) =>
    row.id === id && Boolean(row.revoked_at)));
});

async function inviteCode(address = "newbie@example.test"): Promise<string> {
  const response = await admin
    .post("/api/admin/invites")
    .set("x-csrf-token", adminCsrf)
    .send({ boundAddress: address, ttlHours: 24 });
  return response.body.data.code as string;
}

async function registerPayload(
  code: string,
  overrides: Record<string, unknown> = {},
  account = "newbie",
  address = "",
) {
  const challengeRequest = request(app).get("/api/auth/human-check?purpose=register");
  if (address) challengeRequest.set("x-real-ip", address);
  const challenge = await challengeRequest;
  assert.equal(challenge.status, 200);
  // Test-only clock aging instead of waiting or trusting the forged client elapsedMs.
  if (overrides.elapsedMs !== 50) db.prepare("update form_tokens set issued_at = issued_at - 5000 where token_hash = ?")
    .run((await import("../src/security/identity.ts")).hashToken(challenge.body.data.formToken));
  return {
    inviteCode: code,
    account,
    password: "baka-mail-2026",
    confirmPassword: "baka-mail-2026",
    humanNonce: challenge.body.data.nonce as string,
    humanAnswer: "ABCD",
    formToken: challenge.body.data.formToken as string,
    elapsedMs: 5000,
    ...overrides,
  };
}

test("邀请制注册：蜜罐字段被拒", async () => {
  const code = await inviteCode();
  const response = await request(app)
    .post("/api/auth/register")
    .send(await registerPayload(code, { website: "http://spam.example" }));
  assert.equal(response.status, 400);
  assert.equal(fakeCredentials().includes("newbie@example.test"), false);
});

test("邀请制注册：提交过快被拒", async () => {
  const code = await inviteCode();
  const response = await request(app)
    .post("/api/auth/register")
    .send(await registerPayload(code, { elapsedMs: 50 }));
  assert.equal(response.status, 400);
});

test("邀请制注册：表单令牌不可复用", async () => {
  const code = await inviteCode();
  const payload = await registerPayload(code);
  const first = await request(app).post("/api/auth/register").send(payload);
  const second = await request(app).post("/api/auth/register").send(payload);
  assert.equal(first.status, 200);
  assert.equal(second.status, 400);
  assert.match(String(second.body.error), /表单|邀请码/);
});

test("邀请制注册：无效邀请码被拒", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .send(await registerPayload("not-a-real-invite-code"));
  assert.equal(response.status, 400);
  assert.match(String(response.body.error), /邀请码无效/);
});

test("注册成功后凭据与邮箱都被创建（cred+imap-acct 两条命令）", async () => {
  assert.equal(fakeCredentials().includes("newbie@example.test"), true);
  assert.equal(fakeAccounts().includes("newbie@example.test"), true);
});

test("邀请码用过一次后失效", async () => {
  const code = await inviteCode("second@example.test");
  const first = await request(app)
    .post("/api/auth/register")
    .send(await registerPayload(code, {}, "second"));
  assert.equal(first.status, 200);
  const again = await request(app)
    .post("/api/auth/register")
    .send(await registerPayload(code, {}, "second"));
  assert.equal(again.status, 400);
  assert.match(String(again.body.error), /邀请码无效/);
});

test("后台账号列表能看出凭据与邮箱是否成对", async () => {
  const response = await admin.get("/api/admin/accounts");
  assert.equal(response.status, 200);
  const rows = response.body.data.accounts as { mailbox: string; broken: boolean }[];
  const newbie = rows.find((row) => row.mailbox === "newbie@example.test");
  assert.ok(newbie);
  assert.equal(newbie?.broken, false);
});

test("邮局列表失败时后台不把现有账号误报为空", async () => {
  process.env.FAKE_MADDY_FAIL_LIST = "1";
  try {
    const response = await admin.get("/api/admin/accounts");
    assert.equal(response.status, 502);
    assert.equal(response.body.ok, false);
    assert.match(String(response.body.error), /无法读取邮局账号列表/);
  } finally {
    delete process.env.FAKE_MADDY_FAIL_LIST;
  }
});

test("后台可以修复只有凭据或只有邮箱的半成品账号", async () => {
  appendFileSync(join(stateDir, "credentials"), "credential-only@example.test|existing-pass-2026\n");
  const mailboxRepair = await admin
    .post("/api/admin/accounts/repair")
    .set("x-csrf-token", adminCsrf)
    .send({ account: "credential-only@example.test", confirm: true });
  assert.equal(mailboxRepair.status, 200);
  assert.deepEqual(mailboxRepair.body.data.repaired, ["mailbox"]);
  assert.ok(fakeAccounts().includes("credential-only@example.test"));

  appendFileSync(join(stateDir, "accounts"), "mailbox-only@example.test\n");
  const credentialRepair = await admin
    .post("/api/admin/accounts/repair")
    .set("x-csrf-token", adminCsrf)
    .send({
      account: "mailbox-only@example.test",
      password: "repaired-mail-2026",
      confirm: true,
    });
  assert.equal(credentialRepair.status, 200);
  assert.deepEqual(credentialRepair.body.data.repaired, ["credential"]);
  assert.ok(fakeCredentials().includes("mailbox-only@example.test"));
});

test("后台重置邮箱密码：需要显式确认，成功后写入新密码", async () => {
  const withoutConfirm = await admin
    .post("/api/admin/accounts/password")
    .set("x-csrf-token", adminCsrf)
    .send({ account: "newbie@example.test", password: "rotated-mail-2026" });
  assert.equal(withoutConfirm.status, 400);

  const confirmed = await admin
    .post("/api/admin/accounts/password")
    .set("x-csrf-token", adminCsrf)
    .send({ account: "newbie@example.test", password: "rotated-mail-2026", confirm: true });
  assert.equal(confirmed.status, 200);
  const stored = readFileSync(join(stateDir, "credentials"), "utf8");
  assert.match(stored, /newbie@example\.test\|rotated-mail-2026/);
});

test("后台重置密码会写审计日志", async () => {
  const response = await admin.get("/api/admin/audit-logs");
  const logs = response.body.data.logs as { action: string }[];
  assert.ok(logs.some((entry) => entry.action === "admin.account.password"));
});

test("弱密码被拒绝", async () => {
  const response = await admin
    .post("/api/admin/accounts/password")
    .set("x-csrf-token", adminCsrf)
    .send({ account: "newbie@example.test", password: "12345678", confirm: true });
  assert.equal(response.status, 400);
  assert.match(String(response.body.error), /密码/);
});

test("后台删除账号会同时清掉凭据与邮箱", async () => {
  const response = await admin
    .post("/api/admin/accounts/remove")
    .set("x-csrf-token", adminCsrf)
    .send({ account: "newbie@example.test", confirm: true });
  assert.equal(response.status, 200);
  assert.equal(fakeCredentials().includes("newbie@example.test"), false);
  assert.equal(fakeAccounts().includes("newbie@example.test"), false);
});

test("邮箱登录失败会被计数", async () => {
  const originalPing = MailboxSession.prototype.ping;
  MailboxSession.prototype.ping = async () => { throw Object.assign(new Error("private IMAP refusal"), { authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED" }); };
  try {
  for (let i = 0; i < 3; i += 1) {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ account: "me@example.test", password: "wrong-password-1" });
    assert.equal(response.status, 401);
  }
  const logs = await admin.get("/api/admin/login-logs");
  const failures = (logs.body.data.logs as { scope: string; success: number }[]).filter(
    (entry) => entry.scope === "mail-login" && entry.success === 0,
  );
  assert.ok(failures.length >= 3);
  } finally { MailboxSession.prototype.ping = originalPing; }
});

test("连续失败达到阈值后要求人机校验，未通过则 429", async () => {
  const originalPing = MailboxSession.prototype.ping;
  MailboxSession.prototype.ping = async () => { throw Object.assign(new Error("private IMAP refusal"), { authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED" }); };
  try {
  for (let i = 0; i < 6; i += 1) {
    await request(app)
      .post("/api/auth/login")
      .send({ account: "me@example.test", password: "wrong-password-1" });
  }
  const response = await request(app)
    .post("/api/auth/login")
    .send({ account: "me@example.test", password: "wrong-password-1" });
  assert.equal(response.status, 429);
  assert.equal(response.body.data.requireHuman, true);
  assert.equal(response.body.code, "human_required");
  } finally { MailboxSession.prototype.ping = originalPing; }
});

test("真实连接拒绝重复登录均返回 503，不误计密码失败、不触发验证码、不遗留预算", async () => {
  const address = "198.51.100.71";
  const identity = fingerprint("mail-login", address);
  const globalBefore = globalFailureCount(60000);
  for (let count = 0; count < 8; count++) {
    const response = await request(app).post("/api/auth/login").set("x-real-ip", address)
      .send({ account: "service-fault-qa", password: "not-a-real-password" });
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "mail_unavailable");
    assert.equal(response.headers["retry-after"], "5");
    assert.equal(response.body.data.retryAfterSeconds, 5);
    assert.equal(response.body.data.requireHuman, undefined);
    assert.doesNotMatch(JSON.stringify(response.body), /127\.0\.0\.1|ECONNREFUSED|stack|not-a-real-password/);
  }
  assert.equal(failureCount("mail-login", identity, 60000), 0);
  assert.equal(globalFailureCount(60000), globalBefore);
  const rows = db.prepare("select reason from login_logs where scope = 'mail-login' and identity_hash = ?").all(identity) as { reason: string }[];
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row) => row.reason === "mail-unavailable"));
});

test("审计员角色不能执行写操作", async () => {
  const created = await admin
    .post("/api/admin/admins")
    .set("x-csrf-token", adminCsrf)
    .send({ username: "watcher", password: "watcher-pass-2026", role: "auditor" });
  assert.equal(created.status, 200);

  const watcher = request.agent(app);
  const login = await watcher
    .post("/api/admin/auth/login")
    .send(await adminLoginBody("watcher", "watcher-pass-2026"));
  assert.equal(login.status, 200);
  const watcherCsrf = login.body.data.csrfToken as string;

  const read = await watcher.get("/api/admin/audit-logs");
  assert.equal(read.status, 200);
  assert.equal((await watcher.get("/api/admin/blocked-identities")).status, 200);

  const forbiddenUnblock = await watcher
    .post("/api/admin/blocked-identities/unblock")
    .set("x-csrf-token", watcherCsrf)
    .send({ identityHash: "a".repeat(32) });
  assert.equal(forbiddenUnblock.status, 403);

  const write = await watcher
    .post("/api/admin/invites")
    .set("x-csrf-token", watcherCsrf)
    .send({ note: "auditor 不该能建邀请码" });
  assert.equal(write.status, 403);
});

test("普通管理员可管理邮箱但不能创建超级管理员", async () => {
  const created = await admin
    .post("/api/admin/admins")
    .set("x-csrf-token", adminCsrf)
    .send({ username: "operator", password: "operator-pass-2026", role: "admin" });
  assert.equal(created.status, 200);

  const operator = request.agent(app);
  const login = await operator
    .post("/api/admin/auth/login")
    .send(await adminLoginBody("operator", "operator-pass-2026"));
  assert.equal(login.status, 200);
  const permissions = login.body.data.permissions as string[];
  assert.ok(permissions.includes("mail.account.write"));
  assert.ok(!permissions.includes("system.admin.write"));

  const mailboxList = await operator.get("/api/admin/accounts");
  assert.equal(mailboxList.status, 200);
  const adminList = await operator.get("/api/admin/admins");
  assert.equal(adminList.status, 403);
  const promotion = await operator
    .post("/api/admin/admins")
    .set("x-csrf-token", login.body.data.csrfToken as string)
    .send({ username: "rogue-owner", password: "rogue-owner-pass-2026", role: "superadmin" });
  assert.equal(promotion.status, 403);
});

test("被禁用的管理员登录与未知账号使用相同错误", async () => {
  const listed = await admin.get("/api/admin/admins");
  const operator = (listed.body.data.admins as { id: number; username: string }[]).find(
    (entry) => entry.username === "operator",
  );
  assert.ok(operator);
  const disabled = await admin
    .patch(`/api/admin/admins/${operator.id}`)
    .set("x-csrf-token", adminCsrf)
    .send({ active: false });
  assert.equal(disabled.status, 200);

  const disabledLogin = await request(app)
    .post("/api/admin/auth/login")
    .send(await adminLoginBody("operator", "operator-pass-2026"));
  const unknownLogin = await request(app)
    .post("/api/admin/auth/login")
    .send(await adminLoginBody("no-such-operator", "operator-pass-2026"));
  assert.equal(disabledLogin.status, 401);
  assert.equal(unknownLogin.status, 401);
  assert.equal(disabledLogin.body.error, unknownLogin.body.error);
});

test("不能停用或降权最后一个超级管理员", async () => {
  const listed = await admin.get("/api/admin/admins");
  const owner = (listed.body.data.admins as { id: number; username: string }[]).find(
    (entry) => entry.username === "admin",
  );
  assert.ok(owner);

  const disable = await admin
    .patch(`/api/admin/admins/${owner.id}`)
    .set("x-csrf-token", adminCsrf)
    .send({ active: false });
  assert.equal(disable.status, 409);

  const demote = await admin
    .patch(`/api/admin/admins/${owner.id}`)
    .set("x-csrf-token", adminCsrf)
    .send({ role: "admin" });
  assert.equal(demote.status, 409);
});

test("管理员更新先完整校验再写入，未知角色被拒绝", async () => {
  const listed = await admin.get("/api/admin/admins");
  const watcher = (listed.body.data.admins as { id: number; username: string; role: string }[]).find(
    (entry) => entry.username === "watcher",
  );
  assert.ok(watcher);
  const invalid = await admin
    .patch(`/api/admin/admins/${watcher.id}`)
    .set("x-csrf-token", adminCsrf)
    .send({ role: "owner", password: "123" });
  assert.equal(invalid.status, 400);
  const after = await admin.get("/api/admin/admins");
  const unchanged = (after.body.data.admins as { id: number; username: string; role: string }[]).find(
    (entry) => entry.username === "watcher",
  );
  assert.equal(unchanged?.role, "auditor");
});

test("备份下载禁止缓存且使用附件响应", async () => {
  const response = await admin.get("/api/admin/backup");
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(String(response.headers["content-disposition"]), /attachment; filename=/);
  assert.ok(response.body.generatedAt);
  assert.equal(response.headers["x-backup-generated-at"], response.body.generatedAt);
  assert.ok(Array.isArray(response.body.settings));
});

test("域名自检返回完整的检查项", async () => {
  const response = await admin.get("/api/admin/domain-check");
  assert.equal(response.status, 200);
  const checks = response.body.data.checks as { key: string }[];
  for (const key of ["mx", "spf", "dmarc", "dkim", "certificate", "ports"]) {
    assert.ok(checks.some((item) => item.key === key), `缺少检查项 ${key}`);
  }
});

test("注册小时限额读取后台策略，成功记录也占预算", async () => {
  const address = "198.51.100.31";
  const identity = fingerprint("register", address);
  setSetting("register_max_per_hour", "2");
  recordLoginAttempt("register", identity, "qa1@example.test", true, "created");
  recordLoginAttempt("register", identity, "qa2@example.test", true, "created");
  try {
    const response = await request(app).post("/api/auth/register")
      .set("x-real-ip", address).send({ account: "qa3" });
    assert.equal(response.status, 429);
    assert.equal(response.headers["retry-after"], "3600");
    assert.equal(fakeCredentials().includes("qa3@example.test"), false);
  } finally {
    setSetting("register_max_per_hour", "100");
  }
});

test("注册失败请求预占预算，并发请求不能绕过小时限额", async () => {
  setSetting("register_max_per_hour", "2");
  try {
    const responses = await Promise.all([1, 2, 3].map(() => request(app).post("/api/auth/register")
      .set("x-real-ip", "198.51.100.32").send({ account: "qa", website: "honeypot" })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [400, 400, 429]);
  } finally {
    setSetting("register_max_per_hour", "100");
  }
});

test("24 小时注册预算包含过去小时外的成功及失败，不计更旧请求", async () => {
  const address = "198.51.100.61";
  const identity = fingerprint("register", address);
  setSetting("register_max_per_day", "2");
  const old = recordLoginAttempt("register", identity, "old@example.test", true, "created");
  db.prepare("update login_logs set created_at = ? where id = ?").run(new Date(Date.now() - 25 * 3600_000).toISOString(), old);
  const outsideHour = recordLoginAttempt("register", identity, "prior@example.test", true, "created");
  db.prepare("update login_logs set created_at = ? where id = ?").run(new Date(Date.now() - 2 * 3600_000).toISOString(), outsideHour);
  try {
    const first = await request(app).post("/api/auth/register").set("x-real-ip", address)
      .send({ account: "daily-qa", website: "honeypot" });
    assert.equal(first.status, 400);
    const second = await request(app).post("/api/auth/register").set("x-real-ip", address)
      .send({ account: "daily-qa", website: "honeypot" });
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers["retry-after"]) > 0 && Number(second.headers["retry-after"]) <= 86400);
    assert.equal(second.body.data.window, "day");
    assert.equal(fakeCredentials().includes("daily-qa@example.test"), false);
  } finally { setSetting("register_max_per_day", "1000"); }
});

test("每日注册预算在外部工作前原子预占，并发失败请求也不能穿透", async () => {
  setSetting("register_max_per_day", "2");
  try {
    const responses = await Promise.all(Array.from({ length: 12 }, () => request(app)
      .post("/api/auth/register").set("x-real-ip", "198.51.100.62").send({ account: "daily-race", website: "bot" })));
    assert.equal(responses.filter((response) => response.status === 400).length, 2);
    assert.equal(responses.filter((response) => response.status === 429).length, 10);
    assert.ok(responses.filter((response) => response.status === 429).every((response) => ["registration_rate_limited", "register_rate_limited"].includes(response.body.code)));
  } finally { setSetting("register_max_per_day", "1000"); }
});

test("注册理由校验返回字段错误，不调用邮局创建账号", async () => {
  const before = fakeCredentials();
  for (const reason of ["中".repeat(501), "https://a.test www.b.test ftp://c.test", { body: "not-string" }]) {
    const response = await request(app).post("/api/auth/register").set("x-real-ip", "198.51.100.63")
      .send({ account: "reason-qa", reason });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "invalid_registration_reason");
    assert.ok(response.body.data.fieldErrors.reason);
  }
  assert.deepEqual(fakeCredentials(), before);
});

test("关闭注册即使有效邀请码也不能建号，不消费邀请码；重新开启可完成注册", async () => {
  const code = await inviteCode("closed-qa@example.test");
  const payload = await registerPayload(code, {}, "closed-qa");
  setSetting("registration_mode", "closed");
  try {
    const blocked = await request(app).post("/api/auth/register").send(payload);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "registration_closed");
    assert.equal(fakeCredentials().includes("closed-qa@example.test"), false);
    assert.equal(fakeAccounts().includes("closed-qa@example.test"), false);
    setSetting("registration_mode", "invite");
    const opened = await request(app).post("/api/auth/register").send(payload);
    assert.equal(opened.status, 200);
    assert.equal(fakeCredentials().includes("closed-qa@example.test"), true);
    assert.equal(fakeAccounts().includes("closed-qa@example.test"), true);
  } finally { setSetting("registration_mode", "invite"); }
});

test("后台可配置每日预算并读取真实全站统计，非法字段不会部分保存", async () => {
  const before = (await admin.get("/api/admin/security")).body.data;
  try {
    const saved = await admin.patch("/api/admin/security").set("x-csrf-token", adminCsrf)
      .send({ registerMaxPerDay: 23 });
    assert.equal(saved.status, 200);
    const policy = (await admin.get("/api/admin/security")).body.data;
    assert.equal(policy.registerMaxPerDay, 23);
    assert.ok(policy.recentRegisterAttempts > 0);
    assert.ok(policy.recentDailyRegisterAttempts >= policy.recentRegisterAttempts);
    for (const invalid of [0, 1001, 1.5, "20", null]) {
      const rejected = await admin.patch("/api/admin/security").set("x-csrf-token", adminCsrf)
        .send({ loginMaxFailures: 19, registerMaxPerDay: invalid });
      assert.equal(rejected.status, 400);
      const unchanged = (await admin.get("/api/admin/security")).body.data;
      assert.equal(unchanged.loginMaxFailures, before.loginMaxFailures);
      assert.equal(unchanged.registerMaxPerDay, 23);
    }
    for (const invalid of [{ unknown: 10 }, { registrationMode: "public" }]) {
      assert.equal((await admin.patch("/api/admin/security").set("x-csrf-token", adminCsrf).send(invalid)).status, 400);
    }
  } finally { setSetting("register_max_per_day", "1000"); }
});

test("重置申请的每小时三次限额包含成功请求", async () => {
  const address = "198.51.100.33";
  for (let count = 0; count < 3; count += 1) {
    const challenge = await request(app).get("/api/auth/human-check?purpose=password-reset").set("x-real-ip", address);
    const response = await request(app).post("/api/auth/password-reset").set("x-real-ip", address)
      .send({ account: "qa@example.test", humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD" });
    assert.equal(response.status, 200);
  }
  const limited = await request(app).post("/api/auth/password-reset").set("x-real-ip", address).send({ account: "qa@example.test" });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "3600");
});

test("后台封禁的注册和重置来源不能继续提交", async () => {
  const address = "198.51.100.34";
  for (const [scope, path] of [["register", "/api/auth/register"], ["password-reset", "/api/auth/password-reset"]] as const) {
    const identity = fingerprint(scope, address);
    blockIdentity(identity, "单测", "tester");
    try {
      const response = await request(app).post(path).set("x-real-ip", address).send({ account: "qa" });
      assert.equal(response.status, 403);
    } finally {
      unblockIdentity(identity);
    }
  }
});

test("同一未绑定邀请码并发注册时只能创建一个账号", async () => {
  const created = await admin.post("/api/admin/invites").set("x-csrf-token", adminCsrf)
    .send({ ttlHours: 24, note: "并发单测" });
  const code = created.body.data.code as string;
  const a = await registerPayload(code, {}, "invite-race-a", "198.51.100.181");
  const b = await registerPayload(code, {}, "invite-race-b", "198.51.100.182");
  const responses = await Promise.all([a, b].map((payload, index) => request(app).post("/api/auth/register")
    .set("x-real-ip", `198.51.100.${181 + index}`).send(payload)));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(fakeCredentials().filter((address) => address.startsWith("invite-race-")).length, 1);
  assert.equal(fakeAccounts().filter((address) => address.startsWith("invite-race-")).length, 1);
});

test("注册失败确认账号已回滚后恢复邀请码，允许使用新表单重试", async () => {
  const code = await inviteCode("invite-retry@example.test");
  process.env.FAKE_MADDY_FAIL_IMAP_CREATE = "1";
  try {
    const response = await request(app).post("/api/auth/register")
      .send(await registerPayload(code, {}, "invite-retry"));
  assert.equal(response.status, 502);
  assert.match(String(response.body.error), /邀请码已恢复/);
  assert.equal(response.body.code, "mailbox_create_failed");
  assert.deepEqual(response.body.data, { inviteRestored: true, requiresAdminReview: false });
  assert.doesNotMatch(JSON.stringify(response.body), /forced mailbox creation failure/);
    assert.equal(fakeCredentials().includes("invite-retry@example.test"), false);
  } finally {
    delete process.env.FAKE_MADDY_FAIL_IMAP_CREATE;
  }
  const retried = await request(app).post("/api/auth/register")
    .send(await registerPayload(code, {}, "invite-retry"));
  assert.equal(retried.status, 200);
});

test("已有邮箱被拒绝时不消耗邀请码", async () => {
  const created = await admin.post("/api/admin/invites").set("x-csrf-token", adminCsrf).send({ ttlHours: 24 });
  const code = created.body.data.code as string;
  const existing = await request(app).post("/api/auth/register").send(await registerPayload(code, {}, "invite-retry"));
  assert.equal(existing.status, 409);
  const next = await request(app).post("/api/auth/register").send(await registerPayload(code, {}, "invite-fresh"));
  assert.equal(next.status, 200);
});

test("并发邮箱登录在外部认证前预占预算，繁忙拒绝不算密码失败", async () => {
  const address = "198.51.100.65";
  const identity = fingerprint("mail-login", address);
  const originalPing = MailboxSession.prototype.ping;
  let active = 0, peak = 0, rejected = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  MailboxSession.prototype.ping = async () => {
    active += 1; peak = Math.max(peak, active);
    await gate;
    active -= 1;
    throw new Error("本地模拟认证失败");
  };
  setSetting("login_max_failures", "3");
  const tasks = Array.from({ length: 16 }, () => request(app).post("/api/auth/login")
    .set("x-real-ip", address).send({ account: "qa-concurrent", password: "test-pass-2026" })
    .then((response) => { if (response.status === 429) rejected += 1; return response; }));
  try {
    const deadline = Date.now() + 5000;
    while (rejected < 14 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(rejected, 14);
    assert.equal(peak, 2);
    release();
    const responses = await Promise.all(tasks);
    assert.equal(responses.filter((response) => response.status === 401).length, 2);
    const busy = responses.filter((response) => response.status === 429);
    assert.ok(busy.every((response) => response.body.code === "login_busy" && response.headers["retry-after"] === "5"));
    assert.equal(failureCount("mail-login", identity, 60000), 2);
  } finally {
    release();
    await Promise.allSettled(tasks);
    MailboxSession.prototype.ping = originalPing;
    setSetting("login_max_failures", "5");
  }
});

test("硬冷却中的验证码不得触发邮箱密码校验，重复请求不延长冷却", async () => {
  const address = "198.51.100.66";
  const identity = fingerprint("mail-login", address);
  for (let i = 0; i < 5; i++) recordLoginAttempt("mail-login", identity, "qa-replay", false, "bad");
  const challenge = await request(app).get("/api/auth/human-check?purpose=login").set("x-real-ip", address);
  const originalPing = MailboxSession.prototype.ping;
  let calls = 0;
  MailboxSession.prototype.ping = async () => { calls += 1; throw new Error("本地模拟认证失败"); };
  try {
    const payload = { account: "qa-replay", password: "wrong-pass-2026", humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD" };
    const first = await request(app).post("/api/auth/login").set("x-real-ip", address).send(payload);
    assert.equal(first.status, 429);
    assert.equal(first.body.code, "login_cooldown");
    const replay = await request(app).post("/api/auth/login").set("x-real-ip", address).send(payload);
    assert.equal(replay.status, 429);
    assert.equal(replay.body.data.requireHuman, true);
    assert.ok(Number(replay.headers["retry-after"]) > 0);
    assert.equal(calls, 0);
    assert.equal(replay.body.data.retryAfterSeconds, first.body.data.retryAfterSeconds);
  } finally { MailboxSession.prototype.ping = originalPing; }
});

test("后台硬冷却不能被正确凭据与验证码绕过，到期后恢复并正常退出", async () => {
  const address = "198.51.100.67";
  const identity = fingerprint("admin-login", address);
  for (let i = 0; i < 5; i++) recordLoginAttempt("admin-login", identity, "admin", false, "bad");
  const challenge = await request(app).get("/api/admin/human-check").set("x-real-ip", address);
  const tester = request.agent(app);
  const login = await tester.post("/api/admin/auth/login").set("x-real-ip", address).send({
    username: "admin", password: "baka-mail-test-2026", humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD",
  });
  assert.equal(login.status, 429);
  assert.equal(login.body.code, "login_cooldown");
  db.prepare("update login_logs set created_at = ? where identity_hash = ?").run(new Date(Date.now() - 31 * 60_000).toISOString(), identity);
  db.prepare("update security_cooldowns set until_ms = ? where identity_hash = ?").run(Date.now() - 1, identity);
  const restored = await tester.post("/api/admin/auth/login").set("x-real-ip", address).send({
    username: "admin", password: "baka-mail-test-2026", humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD",
  });
  assert.equal(restored.status, 200);
  assert.equal(failureCount("admin-login", identity, 60000), 0);
  assert.equal((await tester.post("/api/admin/auth/logout").set("x-csrf-token", restored.body.data.csrfToken)).status, 200);
});

async function withFakeFailures<T>(flags: Record<string, string>, action: () => Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(flags).map(key => [key, process.env[key]]));
  Object.assign(process.env, flags);
  try { return await action(); }
  finally { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

const privateCommandDetail = "private-cli-password internal.maddy:993 /data/private\nAUTH private-token";
function assertSafeAccountFailure(response: { status: number; body: any; headers: Record<string, string> },
  operation: string, account: string, outcome: "partial" | "unconfirmed") {
  assert.equal(response.status, 502);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, outcome === "partial" ? "mailbox_partial" : "mailbox_operation_unconfirmed");
  assert.equal(response.body.data.account, account);
  assert.equal(response.body.data.outcome, outcome);
  assert.equal(response.body.data.requiresAdminReview, true);
  assert.doesNotMatch(JSON.stringify(response.body), /private-cli-password|private-token|internal\.maddy|\/data\/private/);
  const audit = db.prepare("select summary, request_id from audit_logs where action = ? and target_id = ? order by id desc limit 1")
    .get(`admin.account.${operation}-failed`, account) as { summary: string; request_id: string };
  assert.equal(audit.request_id, response.headers["x-request-id"]);
  assert.match(audit.summary, new RegExp(`outcome=${outcome}`));
  assert.doesNotMatch(audit.summary, /private-cli-password|private-token|internal\.maddy/);
  assert.equal(response.headers["cache-control"], "no-store");
}

test("后台创建的干净回滚与半成品失败均安全返回，半成品不会伪报已清理", async () => {
  for (const partial of [false, true]) {
    const account = `qa-admin-create-${partial ? "partial" : "clean"}@example.test`;
    const response = await withFakeFailures({ FAKE_MADDY_FAIL_IMAP_CREATE: "1",
      FAKE_MADDY_FAIL_CREDS_REMOVE: partial ? "1" : "0", FAKE_MADDY_FAIL_DETAIL: privateCommandDetail }, () =>
      admin.post("/api/admin/accounts").set("x-csrf-token", adminCsrf)
        .send({ account, password: "test-create-pass-2026" }).then(response => response));
    assertSafeAccountFailure(response, "create", account, partial ? "partial" : "unconfirmed");
    assert.equal(fakeCredentials().includes(account), partial);
    assert.equal(fakeAccounts().includes(account), false);
    if (partial) assert.match(response.body.error, /半成品.*修复/);
    await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf).send({ account, confirm: true });
  }
});

test("后台修复预检失败与回滚失败不泄漏命令原文，权限及失败审计保留", async () => {
  const preflightAccount = "qa-repair-preflight@example.test";
  const preflight = await withFakeFailures({ FAKE_MADDY_FAIL_LIST: "1", FAKE_MADDY_FAIL_DETAIL: privateCommandDetail }, () =>
    admin.post("/api/admin/accounts/repair").set("x-csrf-token", adminCsrf)
      .send({ account: preflightAccount, password: "test-repair-pass-2026", confirm: true }).then(response => response));
  assertSafeAccountFailure(preflight, "repair", preflightAccount, "unconfirmed");
  assert.equal(fakeCredentials().includes(preflightAccount), false);
  const partialAccount = "qa-repair-partial@example.test";
  const partial = await withFakeFailures({ FAKE_MADDY_FAIL_IMAP_CREATE: "1", FAKE_MADDY_FAIL_CREDS_REMOVE: "1",
    FAKE_MADDY_FAIL_DETAIL: privateCommandDetail }, () =>
    admin.post("/api/admin/accounts/repair").set("x-csrf-token", adminCsrf)
      .send({ account: partialAccount, password: "test-repair-pass-2026", confirm: true }).then(response => response));
  assertSafeAccountFailure(partial, "repair", partialAccount, "partial");
  assert.equal(fakeCredentials().includes(partialAccount), true);
  assert.equal(fakeAccounts().includes(partialAccount), false);
  await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf).send({ account: partialAccount, confirm: true });
});

test("密码实际写入后命令报错，仍吊销目标全部会话并保留其他账号与草稿", async () => {
  const account = "qa-password-uncertain@example.test";
  assert.equal((await admin.post("/api/admin/accounts").set("x-csrf-token", adminCsrf)
    .send({ account, password: "test-old-pass-2026" })).status, 200);
  const first = createMailSession(account, "qa-password-test", "fixture");
  const second = createMailSession(account, "qa-password-test", "fixture");
  const other = createMailSession("qa-password-other@example.test", "qa-password-test", "fixture");
  let closed = 0;
  for (const row of [first, second, other]) {
    const mailbox = new MailboxSession(row.id, row === other ? "qa-password-other@example.test" : account, "not-real");
    mailbox.close = async () => { if (row !== other) closed += 1; };
    putSession(mailbox);
  }
  db.prepare("insert into drafts (id, owner, payload, created_at, updated_at) values (?, ?, '{}', ?, ?)")
    .run("qa-reset-preserve-draft", account, new Date().toISOString(), new Date().toISOString());
  try {
    const response = await withFakeFailures({ FAKE_MADDY_FAIL_PASSWORD_AFTER_WRITE: "1", FAKE_MADDY_FAIL_DETAIL: privateCommandDetail }, () =>
      admin.post("/api/admin/accounts/password").set("x-csrf-token", adminCsrf)
        .send({ account, password: "test-new-pass-2026", confirm: true }).then(response => response));
    assertSafeAccountFailure(response, "password", account, "unconfirmed");
    assert.equal(response.body.data.revokedSessions, 2);
    assert.match(response.body.error, /现有会话已下线/);
    assert.match(readFileSync(join(stateDir, "credentials"), "utf8"), /qa-password-uncertain@example\.test\|test-new-pass-2026/);
    assert.equal(closed, 2);
    for (const row of [first, second]) { assert.equal(findMailSession(row.token), undefined); assert.equal(getSession(row.id), undefined); }
    assert.ok(findMailSession(other.token));
    assert.ok(getSession(other.id));
    assert.ok(db.prepare("select id from drafts where id = ? and owner = ?").get("qa-reset-preserve-draft", account));
    assert.equal((db.prepare("select count(*) as count from audit_logs where action = 'admin.account.password' and target_id = ?")
      .get(account) as { count: number }).count, 0);
  } finally {
    await Promise.all([first, second, other].map(row => dropSession(row.id)));
    db.prepare("delete from drafts where id = ?").run("qa-reset-preserve-draft");
    await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf).send({ account, confirm: true });
  }
});

test("删除仅完成凭据阶段时明确半成品和已下线，不伪报完整删除", async () => {
  const account = "qa-remove-partial@example.test";
  assert.equal((await admin.post("/api/admin/accounts").set("x-csrf-token", adminCsrf)
    .send({ account, password: "test-delete-pass-2026" })).status, 200);
  const row = createMailSession(account, "qa-remove-test", "fixture");
  db.prepare("insert into user_settings (owner, key, value, updated_at) values (?, 'density', 'compact', ?)")
    .run(account, new Date().toISOString());
  const mailbox = new MailboxSession(row.id, account, "not-real");
  let closed = 0;
  mailbox.close = async () => { closed += 1; };
  putSession(mailbox);
  try {
    const response = await withFakeFailures({ FAKE_MADDY_FAIL_IMAP_REMOVE: "1", FAKE_MADDY_FAIL_DETAIL: privateCommandDetail }, () =>
      admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf).send({ account, confirm: true }).then(response => response));
    assertSafeAccountFailure(response, "remove", account, "partial");
    assert.equal(response.body.data.revokedSessions, 1);
    assert.equal(closed, 1);
    assert.equal(findMailSession(row.token), undefined);
    assert.equal(getSession(row.id), undefined);
    assert.equal(fakeCredentials().includes(account), false);
    assert.equal(fakeAccounts().includes(account), true);
    assert.ok(db.prepare("select key from user_settings where owner = ?").get(account));
    assert.equal((db.prepare("select count(*) as count from audit_logs where action = 'admin.account.remove' and target_id = ?")
      .get(account) as { count: number }).count, 0);
  } finally { await dropSession(row.id); }
  const cleaned = await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf).send({ account, confirm: true });
  assert.equal(cleaned.status, 200);
  assert.equal(fakeAccounts().includes(account), false);
  assert.equal(db.prepare("select key from user_settings where owner = ?").get(account), undefined);
});

test("管理员删除成功后清理目标账号的 BFF 私有数据，保留其他账号数据", async () => {
  const target = "qa-purge-target@example.test";
  const other = "qa-purge-other@example.test";
  const stamp = new Date().toISOString();
  assert.equal((await admin.post("/api/admin/accounts").set("x-csrf-token", adminCsrf)
    .send({ account: target, password: "test-purge-pass-2026" })).status, 200);
  for (const [account, suffix] of [[target, "target"], [other, "other"]]) {
    db.prepare("insert into drafts (id, owner, payload, created_at, updated_at) values (?, ?, '{}', ?, ?)")
      .run(`qa-purge-${suffix}`, account, stamp, stamp);
    db.prepare("insert into contact_entries (owner, name, email, note, created_at, updated_at) values (?, '', ?, '', ?, ?)")
      .run(account, account, stamp, stamp);
    db.prepare("insert into user_settings (owner, key, value, updated_at) values (?, 'density', 'compact', ?)")
      .run(account, stamp);
    createMailSession(account, "qa-purge-test", "fixture");
  }
  try {
    const removed = await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf)
      .send({ account: target, confirm: true });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.removed, target);
    assert.equal(removed.body.data.alreadyAbsent, false);
    assert.equal(fakeCredentials().includes(target), false);
    assert.equal(fakeAccounts().includes(target), false);
    for (const [table, column] of [["drafts", "owner"], ["contact_entries", "owner"],
      ["user_settings", "owner"], ["mail_sessions", "mailbox"]]) {
      const sql = `select count(*) as count from ${table} where ${column} = ?`;
      assert.equal((db.prepare(sql).get(target) as { count: number }).count, 0);
      assert.equal((db.prepare(sql).get(other) as { count: number }).count, 1);
    }
    assert.equal((await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf)
      .send({ account: target, confirm: true })).status, 404);
  } finally {
    db.prepare("delete from drafts where owner = ?").run(other);
    db.prepare("delete from contact_entries where owner = ?").run(other);
    db.prepare("delete from user_settings where owner = ?").run(other);
    db.prepare("delete from mail_sessions where mailbox = ?").run(other);
  }
});

test("邮箱已删而 BFF 清理失败时不伪报成功，残留在后台可见并可重试", async () => {
  const account = "qa-purge-retry@example.test";
  const stamp = new Date().toISOString();
  assert.equal((await admin.post("/api/admin/accounts").set("x-csrf-token", adminCsrf)
    .send({ account, password: "test-purge-pass-2026" })).status, 200);
  db.prepare("insert into drafts (id, owner, payload, created_at, updated_at) values (?, ?, '{}', ?, ?)")
    .run("qa-purge-retry", account, stamp, stamp);
  db.prepare("insert into user_settings (owner, key, value, updated_at) values (?, 'density', 'compact', ?)")
    .run(account, stamp);
  db.exec(`create trigger qa_purge_retry_fault before delete on user_settings
    when OLD.owner = 'qa-purge-retry@example.test'
    begin select raise(abort, 'private-sql-fault'); end`);
  try {
    const failed = await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf)
      .send({ account, confirm: true });
    assert.equal(failed.status, 502);
    assert.equal(failed.body.code, "account_data_cleanup_failed");
    assert.equal(failed.body.data.outcome, "mailbox_removed_data_pending");
    assert.doesNotMatch(JSON.stringify(failed.body), /private-sql-fault/);
    assert.equal(fakeCredentials().includes(account), false);
    assert.equal(fakeAccounts().includes(account), false);
    assert.ok(db.prepare("select id from drafts where owner = ?").get(account));
    const rows = (await admin.get("/api/admin/accounts")).body.data.accounts as
      { mailbox: string; needsCleanup: boolean; broken: boolean }[];
    assert.deepEqual(rows.find((row) => row.mailbox === account),
      { mailbox: account, hasCredential: false, hasMailbox: false,
        messages: 0, unseen: 0, folders: 0, broken: true, needsCleanup: true });
  } finally {
    db.exec("drop trigger if exists qa_purge_retry_fault");
  }
  const retried = await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf)
    .send({ account, confirm: true });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.alreadyAbsent, true);
  assert.equal(db.prepare("select id from drafts where owner = ?").get(account), undefined);
  assert.equal(db.prepare("select key from user_settings where owner = ?").get(account), undefined);
  const rows = (await admin.get("/api/admin/accounts")).body.data.accounts as { mailbox: string }[];
  assert.equal(rows.some((row) => row.mailbox === account), false);
});

test("密码重置和删除拒绝非法或外域目标，不调用账号管理或吊销其他会话", async () => {
  const credentials = readFileSync(join(stateDir, "credentials"), "utf8");
  const accounts = readFileSync(join(stateDir, "accounts"), "utf8");
  const row = createMailSession("qa-validation-other@example.test", "qa-validation", "fixture");
  try {
    for (const account of ["qa@outside.test", "-bad@example.test", "bad\ncontrol@example.test", "--flag", "ab@example.test"]) {
      for (const action of ["password", "remove"]) {
        const response = await admin.post(`/api/admin/accounts/${action}`).set("x-csrf-token", adminCsrf)
          .send({ account, password: "test-valid-pass-2026", confirm: true });
        assert.equal(response.status, 400);
      }
    }
    assert.equal(readFileSync(join(stateDir, "credentials"), "utf8"), credentials);
    assert.equal(readFileSync(join(stateDir, "accounts"), "utf8"), accounts);
    assert.ok(findMailSession(row.token));
  } finally { db.prepare("delete from mail_sessions where id = ?").run(row.id); }
});

test("注册回滚未确认保留邀请码并要求人工核对，不泄漏 CLI 或密码", async () => {
  const account = "qa-register-partial";
  const mailbox = `${account}@example.test`;
  const code = await inviteCode(mailbox);
  const response = await withFakeFailures({ FAKE_MADDY_FAIL_IMAP_CREATE: "1", FAKE_MADDY_FAIL_CREDS_REMOVE: "1",
    FAKE_MADDY_FAIL_DETAIL: privateCommandDetail }, async () =>
    request(app).post("/api/auth/register").send(await registerPayload(code, {}, account)));
  assert.equal(response.status, 502);
  assert.equal(response.body.code, "mailbox_create_unconfirmed");
  assert.deepEqual(response.body.data, { inviteRestored: false, requiresAdminReview: true });
  assert.match(response.body.error, /邀请码已保留.*勿重复提交/);
  assert.doesNotMatch(JSON.stringify(response.body), /private-cli-password|private-token|internal\.maddy|baka-mail-2026/);
  assert.equal(fakeCredentials().includes(mailbox), true);
  assert.equal(fakeAccounts().includes(mailbox), false);
  const invite = db.prepare("select used_at from invites where used_by = ? order by id desc limit 1").get(mailbox) as { used_at: string };
  assert.ok(invite.used_at);
  const audit = db.prepare("select summary, request_id from audit_logs where action = 'mailbox.create-failed' and target_id = ? order by id desc limit 1")
    .get(mailbox) as { summary: string; request_id: string };
  assert.match(audit.summary, /mailbox_create_unconfirmed; invite-restored=false/);
  assert.equal(audit.request_id, response.headers["x-request-id"]);
  assert.doesNotMatch(audit.summary, /private-cli-password|private-token/);
  await admin.post("/api/admin/accounts/remove").set("x-csrf-token", adminCsrf).send({ account: mailbox, confirm: true });
});
