import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-isolation-test-"));
process.env.SECRET_KEY = "isolated-rate-limit-secret";
process.env.HUMAN_CHECK_TEST_MODE = "1";
process.env.COOKIE_SECURE = "0";
process.env.MADDY_RUNNER = "disabled";
process.env.MAIL_DOMAIN = "example.test";
process.env.BOOTSTRAP_ADMIN = "isolation-admin";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "isolated-test-only-2026";

const { createApp } = await import("../src/app.ts");
const { default: request } = await import("supertest");
const { db } = await import("../src/db.ts");
const { clientAddress, rateLimitSource } = await import("../src/security/identity.ts");
const { reserveBudget, SECURITY_BUDGETS, reserveLease, releaseLease } = await import("../src/security/abuse.ts");
const { recordLoginAttempt, reserveLoginAttempt, completeLoginAttempt } = await import("../src/security/rateLimit.ts");
const { entrySettings } = await import("../src/admin/installation.ts");
const { passwordProblem } = await import("../src/security/passwords.ts");
const { pruneExpiredRecords } = await import("../src/security/retention.ts");
const { createInvite } = await import("../src/admin/invites.ts");
const { createMailSession, MAIL_COOKIE } = await import("../src/http/session.ts");
const { putSession } = await import("../src/mail/registry.ts");
const { MailboxSession } = await import("../src/mail/session.ts");
const app = createApp({ log: () => undefined });

const credentials = { username: "isolation-admin", password: "isolated-test-only-2026" };
async function adminChallenge(source: string) {
  const response = await request(app).get("/api/admin/human-check").set("x-real-ip", source);
  assert.equal(response.status, 200);
  return { humanNonce: response.body.data.nonce, humanAnswer: "ABCD" };
}
async function adminLogin(source: string, password = credentials.password) {
  return request(app).post("/api/admin/auth/login").set("x-real-ip", source)
    .send({ username: credentials.username, password, ...await adminChallenge(source) });
}

test("来源按 IPv6 /64 归并：同一段内换地址不能制造新来源，不同段互不影响", () => {
  const a = clientAddress({ "x-real-ip": "2001:db8:1:2::1" }, "127.0.0.1");
  const b = clientAddress({ "x-real-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" }, "127.0.0.1");
  const c = clientAddress({ "x-real-ip": "2001:db8:1:3::1" }, "127.0.0.1");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a, "2001:db8:1:2::/64");
  // IPv4、回环、IPv4 映射地址保持原样，不受归并影响。
  assert.equal(rateLimitSource("198.51.100.9"), "198.51.100.9");
  assert.equal(rateLimitSource("::1"), "::1");
  assert.equal(clientAddress({ "x-real-ip": "198.51.100.10" }, "::ffff:127.0.0.1"), "198.51.100.10");
  // 缩写写法与完整写法得到同一个来源。
  assert.equal(rateLimitSource("2001:0db8:0001:0002:0000:0000:0000:0001"), rateLimitSource("2001:db8:1:2::1"));
});

test("大量低用量来源制造的全站压力不会拒绝新的正常用户，用量偏高的来源仍被全站上限约束", () => {
  const policy = SECURITY_BUDGETS.login;
  // 250 个来源各发一次，超过旧版 200 次/分钟的全站上限。
  for (let i = 0; i < 250; i++) assert.equal(reserveBudget("login", `flood-${i}`, policy), 0, `source ${i}`);
  // 之后第一次出现的正常用户照常通过。
  assert.equal(reserveBudget("login", "innocent-user", policy), 0);
  assert.equal(reserveBudget("login", "innocent-user", policy), 0);
  // 但一个自己就在高频请求的来源（超过低用量门槛）会被全站上限拦住。
  const heavy = "heavy-source";
  let denied = 0;
  for (let i = 0; i < 10; i++) if (reserveBudget("login", heavy, policy) > 0) denied++;
  assert.ok(denied > 0, "heavy source must still be limited by the global ceiling");
});

test("一个来源用尽自己的额度，只拒绝它自己", () => {
  const policy = SECURITY_BUDGETS.login;
  for (let i = 0; i < policy.sourceMinute; i++) assert.equal(reserveBudget("login-iso", "attacker", policy), 0);
  assert.ok(reserveBudget("login-iso", "attacker", policy) > 0);
  assert.equal(reserveBudget("login-iso", "bystander-1", policy), 0);
  assert.equal(reserveBudget("login-iso", "bystander-2", policy), 0);
});

test("后台登录额度独立于邮箱登录：邮箱登录刷满额度不影响同一来源的管理员", () => {
  db.prepare("delete from security_budgets").run();
  const source = "shared-nat-source";
  for (let i = 0; i < SECURITY_BUDGETS.login.sourceMinute; i++) assert.equal(reserveBudget("login", source, SECURITY_BUDGETS.login), 0);
  assert.ok(reserveBudget("login", source, SECURITY_BUDGETS.login) > 0);
  assert.equal(reserveBudget("admin-login", source, SECURITY_BUDGETS["admin-login"]), 0);
});

test("同一来源猜错后台密码被冷却后，其他来源的管理员仍能正常登录，账号不会被锁", async () => {
  const attacker = "203.0.113.50";
  for (let i = 0; i < 3; i++) assert.equal((await adminLogin(attacker, "wrong-password-value")).status, 401);
  const cooled = await adminLogin(attacker, "wrong-password-value");
  assert.equal(cooled.status, 429);
  assert.equal(cooled.body.code, "login_cooldown");
  // 管理员从别的地址登录，不受影响。
  const admin = await adminLogin("203.0.113.51");
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.username, "isolation-admin");
  // 另一个正常来源的登录请求也不受这个攻击者影响。
  assert.equal((await adminLogin("203.0.113.52")).status, 200);
});

test("多个来源的并发校验不会让干净来源拿不到名额：已有失败记录的来源最多占三个后台名额", () => {
  const dirty = ["lease-dirty-a", "lease-dirty-b"];
  for (const source of dirty) recordLoginAttempt("admin-login", source, "someone", false, "bad-credentials");
  const taken = [
    reserveLoginAttempt("admin-login", dirty[0]!, "lease-account-1"),
    reserveLoginAttempt("admin-login", dirty[0]!, "lease-account-2"),
    reserveLoginAttempt("admin-login", dirty[1]!, "lease-account-3"),
  ];
  assert.ok(taken.every((id) => id !== null));
  // 可疑来源想占第四个名额会被拒绝……
  assert.equal(reserveLoginAttempt("admin-login", dirty[1]!, "lease-account-4"), null);
  // ……这个名额留给没有失败记录的管理员。
  const clean = reserveLoginAttempt("admin-login", "lease-clean-admin", "lease-account-5");
  assert.ok(clean !== null);
  for (const id of [...taken, clean]) completeLoginAttempt(id!, false, "interrupted");
});

test("租约预留只在调用方声明可疑时生效，注册等其他场景保持原行为", () => {
  const ids = Array.from({ length: 4 }, (_, i) => reserveLease("unit-lease", `source-${i}`, `account-${i}`, 4, 2, 1, false));
  assert.ok(ids.every(Boolean));
  for (const id of ids) releaseLease(id!);
  const suspicious = Array.from({ length: 4 }, (_, i) => reserveLease("unit-lease", `source-${i}`, `account-${i}`, 4, 2, 1, true));
  assert.equal(suspicious.filter(Boolean).length, 3);
  for (const id of suspicious) if (id) releaseLease(id);
});

test("后台路径探测限流：只计猜错，猜错过多的来源连正确答案也拿不到，其他来源不受影响", async () => {
  const base = entrySettings().adminBase;
  const probe = (source: string, entry: string) => request(app).get(`/api/installation?entry=${encodeURIComponent(entry)}`).set("x-real-ip", source);
  // 正常管理员反复打开自己的路径，不消耗额度。
  for (let i = 0; i < 40; i++) assert.equal((await probe("198.51.100.201", base)).body.data.entry?.adminBase, base);
  // 不像后台路径的地址（如 /login）不计数。
  for (let i = 0; i < 40; i++) assert.equal((await probe("198.51.100.202", "/login")).status, 200);
  // 猜错 20 次之后被冷却。
  const guesser = "198.51.100.203";
  for (let i = 0; i < SECURITY_BUDGETS["entry-probe"].sourceMinute; i++) assert.equal((await probe(guesser, `/guess-${i}x`)).status, 200);
  const limited = await probe(guesser, "/another-guess");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "entry_probe_rate_limited");
  // 冷却期内即使猜对了也只得到 429，限流不会变成探测器。
  const correct = await probe(guesser, base);
  assert.equal(correct.status, 429);
  assert.equal(correct.body.data?.entry, undefined);
  // 其他来源不受影响。
  assert.equal((await probe("198.51.100.204", base)).body.data.entry.adminBase, base);
});

test("新密码不能包含换行等控制字符，避免被截断后绕过长度和强度规则", () => {
  assert.notEqual(passwordProblem("ab\n12345678"), "");
  assert.notEqual(passwordProblem("aaaaaaaaaa\n1"), "");
  assert.notEqual(passwordProblem("valid-password\u0000x"), "");
  assert.equal(passwordProblem("valid-password-1"), "");
});

test("定期清理只删除已失效的会话和过期登录记录，不动审计日志与仍有效的数据", () => {
  const old = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const recent = new Date().toISOString();
  db.prepare("insert into login_logs (scope, identity_hash, account, success, reason, created_at) values ('mail-login','prune-old','a',0,'bad',?)").run(old);
  db.prepare("insert into login_logs (scope, identity_hash, account, success, reason, created_at) values ('mail-login','prune-new','a',0,'bad',?)").run(recent);
  db.prepare("insert into mail_sessions (id, mailbox, token_hash, csrf_token, created_at, last_active_at, expires_at, revoked_at) values ('prune-old-session','m@example.test','prune-h1','c',?,?,?,?)").run(old, old, old, old);
  db.prepare("insert into mail_sessions (id, mailbox, token_hash, csrf_token, created_at, last_active_at, expires_at) values ('prune-live-session','m@example.test','prune-h2','c',?,?,?)").run(recent, recent, new Date(Date.now() + 86_400_000).toISOString());
  db.prepare("insert into audit_logs (actor_type, actor, action, created_at) values ('system','x','prune.test',?)").run(old);
  const result = pruneExpiredRecords();
  assert.ok(result.loginLogs >= 1 && result.sessions >= 1);
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  assert.equal(count("select count(*) as n from login_logs where identity_hash = 'prune-old'"), 0);
  assert.equal(count("select count(*) as n from login_logs where identity_hash = 'prune-new'"), 1);
  assert.equal(count("select count(*) as n from mail_sessions where id = 'prune-old-session'"), 0);
  assert.equal(count("select count(*) as n from mail_sessions where id = 'prune-live-session'"), 1);
  assert.equal(count("select count(*) as n from audit_logs where action = 'prune.test'"), 1);
});

test("邀请码检查接口不返回查询用的哈希", async () => {
  const login = await adminLogin("198.51.100.210");
  assert.equal(login.status, 200);
  const agent = request.agent(app);
  const signed = await agent.post("/api/admin/auth/login").set("x-real-ip", "198.51.100.211")
    .send({ ...credentials, ...await adminChallenge("198.51.100.211") });
  const invite = createInvite({ createdBy: "isolation-admin" });
  const checked = await agent.post("/api/admin/invites/check").set("x-csrf-token", signed.body.data.csrfToken).send({ code: invite.code, account: "new@example.test" });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.data.ok, true);
  assert.equal(checked.body.data.invite.id, invite.id);
  assert.equal("code_hash" in checked.body.data.invite, false);
  assert.equal(JSON.stringify(checked.body).includes("code_hash"), false);
});

test("草稿有数量和大小上限：达到上限后不能再新建，已有草稿仍可更新；超大内容被拒绝", async () => {
  const mailbox = "draft-quota@example.test";
  const session = createMailSession(mailbox, "quota-fingerprint", "quota-test");
  putSession(new MailboxSession(session.id, mailbox, "never-used"));
  const send = (body: unknown) => request(app).post("/api/drafts").set("Cookie", `${MAIL_COOKIE}=${session.token}`)
    .set("x-csrf-token", session.csrfToken).send(body as object);
  const now = new Date().toISOString();
  const insert = db.prepare("insert into drafts (id, owner, payload, created_at, updated_at) values (?, ?, '{}', ?, ?)");
  for (let i = 0; i < 99; i++) insert.run(`quota-${i}`, mailbox, now, now);
  const last = await send({ payload: { text: "第 100 封" } });
  assert.equal(last.status, 200);
  const overflow = await send({ payload: { text: "第 101 封" } });
  assert.equal(overflow.status, 409);
  assert.match(overflow.body.error, /草稿最多保存 100 封/);
  const update = await send({ id: last.body.data.id, payload: { text: "改写已有草稿" } });
  assert.equal(update.status, 200);
  const tooLarge = await send({ id: last.body.data.id, payload: { text: "x".repeat(600 * 1024) } });
  assert.equal(tooLarge.status, 413);
  // 别的账号的额度不受这个账号影响。
  const other = createMailSession("draft-quota-other@example.test", "quota-other", "quota-test");
  putSession(new MailboxSession(other.id, "draft-quota-other@example.test", "never-used"));
  const fine = await request(app).post("/api/drafts").set("Cookie", `${MAIL_COOKIE}=${other.token}`).set("x-csrf-token", other.csrfToken).send({ payload: { text: "正常" } });
  assert.equal(fine.status, 200);
});
