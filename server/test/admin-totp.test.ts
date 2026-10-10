import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-totp-test-"));
process.env.SECRET_KEY = "isolated-totp-secret-value";
process.env.HUMAN_CHECK_TEST_MODE = "1";
process.env.COOKIE_SECURE = "0";
process.env.MADDY_RUNNER = "disabled";
process.env.MAIL_DOMAIN = "example.test";
process.env.BOOTSTRAP_ADMIN = "totp-root";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "isolated-test-only-2026";

const { createApp } = await import("../src/app.ts");
const { default: request } = await import("supertest");
const { db } = await import("../src/db.ts");
const totp = await import("../src/admin/totp.ts");
const { createAdmin, findAdminByUsername } = await import("../src/admin/accounts.ts");
const app = createApp({ log: () => undefined });

const ROOT = { username: "totp-root", password: "isolated-test-only-2026" };
const SECOND = { username: "totp-second", password: "second-admin-pass-2026" };
assert.equal(createAdmin(SECOND.username, SECOND.password, "admin").ok, true);

const nowStep = () => Math.floor(Date.now() / 1000 / totp.TOTP_PERIOD);
const code = (secret: string, step = nowStep()) => totp.totpAt(totp.base32Decode(secret), step);

async function captcha(source: string) {
  const response = await request(app).get("/api/admin/human-check").set("x-real-ip", source);
  assert.equal(response.status, 200);
  return { humanNonce: response.body.data.nonce, humanAnswer: "ABCD" };
}
/** 第一步：账号 + 密码 + 图形验证码。 */
async function step1(source: string, who = ROOT, password = who.password) {
  return request(app).post("/api/admin/auth/login").set("x-real-ip", source)
    .send({ username: who.username, password, ...await captcha(source) });
}
function step2(source: string, ticket: string, value: string) {
  return request(app).post("/api/admin/auth/login/totp").set("x-real-ip", source).send({ ticket, code: value });
}
/** 无二步验证的普通登录，得到带 Cookie 的会话。 */
async function session(source: string, who = ROOT) {
  const agent = request.agent(app);
  const signed = await agent.post("/api/admin/auth/login").set("x-real-ip", source).send({ username: who.username, password: who.password, ...await captcha(source) });
  assert.equal(signed.status, 200);
  return { agent, csrf: signed.body.data.csrfToken as string };
}

test("TOTP 与 RFC 6238 官方测试向量一致（SHA-1，取 6 位）", () => {
  const secret = Buffer.from("12345678901234567890");
  for (const [seconds, expected] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]] as const) {
    assert.equal(totp.totpAt(secret, Math.floor(seconds / 30)), expected, `T=${seconds}`);
  }
});

test("动态码允许前后各一个时间片，更早或更晚的不接受，已用过的时间片不能重放", () => {
  const secret = Buffer.from("12345678901234567890"), now = 1_700_000_000_000, step = Math.floor(now / 1000 / 30);
  assert.equal(totp.matchTotp(secret, totp.totpAt(secret, step), 0, now), step);
  assert.equal(totp.matchTotp(secret, totp.totpAt(secret, step - 1), 0, now), step - 1);
  assert.equal(totp.matchTotp(secret, totp.totpAt(secret, step + 1), 0, now), step + 1);
  assert.equal(totp.matchTotp(secret, totp.totpAt(secret, step - 2), 0, now), null);
  assert.equal(totp.matchTotp(secret, totp.totpAt(secret, step + 2), 0, now), null);
  assert.equal(totp.matchTotp(secret, totp.totpAt(secret, step), step, now), null, "same step must not be accepted twice");
  assert.equal(totp.matchTotp(secret, "12345", 0, now), null);
  assert.equal(totp.matchTotp(secret, "abcdef", 0, now), null);
});

test("Base32 往返一致；密钥加密存储可还原，被篡改或格式不对时拒绝", () => {
  const bytes = Buffer.from(Array.from({ length: 20 }, (_, i) => i * 13 % 256));
  assert.deepEqual(totp.base32Decode(totp.base32Encode(bytes)), bytes);
  assert.deepEqual(totp.base32Decode("jbsw y3dp-ehpk 3pxp"), totp.base32Decode("JBSWY3DPEHPK3PXP"));
  const sealed = totp.sealSecret("JBSWY3DPEHPK3PXP");
  assert.equal(totp.openSecret(sealed), "JBSWY3DPEHPK3PXP");
  assert.doesNotMatch(sealed, /JBSWY3DP/);
  assert.notEqual(totp.sealSecret("JBSWY3DPEHPK3PXP"), sealed, "each seal uses a fresh IV");
  const parts = sealed.split(".");
  assert.throws(() => totp.openSecret([parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join(".")));
  assert.throws(() => totp.openSecret("v2.a.b.c"));
});

test("启用二步验证前登录行为不变；启用必须用待确认密钥生成的当前动态码，错误码不会启用", async () => {
  const { agent, csrf } = await session("203.0.113.10");
  assert.deepEqual((await agent.get("/api/admin/auth/totp")).body.data, { enabled: false, pending: false, recoveryRemaining: 0 });
  // 没有 CSRF 令牌不能操作
  assert.equal((await agent.post("/api/admin/auth/totp/setup")).status, 403);
  const setup = await agent.post("/api/admin/auth/totp/setup").set("x-csrf-token", csrf);
  assert.equal(setup.status, 200);
  const secret = setup.body.data.secret as string;
  assert.match(setup.body.data.uri, /^otpauth:\/\/totp\/BakaMail%3Atotp-root\?secret=[A-Z2-7]{32}&issuer=BakaMail&algorithm=SHA1&digits=6&period=30$/);
  // 库里是加密后的，不是明文。
  const stored = db.prepare("select secret, enabled from admin_totp where admin_id = ?").get(findAdminByUsername("totp-root")!.id) as { secret: string; enabled: number };
  assert.equal(stored.enabled, 0);
  assert.ok(!stored.secret.includes(secret));
  assert.deepEqual((await agent.get("/api/admin/auth/totp")).body.data, { enabled: false, pending: true, recoveryRemaining: 0 });
  // 未确认之前，登录仍是单步。
  assert.equal((await step1("203.0.113.11")).body.data.totpRequired, undefined);
  // 错误的码不启用
  const wrong = await agent.post("/api/admin/auth/totp/enable").set("x-csrf-token", csrf).send({ code: "000000" === code(secret) ? "111111" : "000000" });
  assert.equal(wrong.status, 400);
  assert.equal(totp.totpEnabled(findAdminByUsername("totp-root")!.id), false);
  const enabled = await agent.post("/api/admin/auth/totp/enable").set("x-csrf-token", csrf).send({ code: code(secret) });
  assert.equal(enabled.status, 200);
  const recovery = enabled.body.data.recoveryCodes as string[];
  assert.equal(recovery.length, 10);
  assert.ok(recovery.every((value) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(value)) && new Set(recovery).size === 10);
  assert.deepEqual((await agent.get("/api/admin/auth/totp")).body.data, { enabled: true, pending: false, recoveryRemaining: 10 });
  // 恢复码只存哈希
  assert.equal(JSON.stringify(db.prepare("select code_hash from admin_recovery_codes").all()).includes(recovery[0]!.replace("-", "")), false);
  // 已启用时不能直接重新生成密钥（防止被盗会话悄悄换掉第二因素）
  assert.equal((await agent.post("/api/admin/auth/totp/setup").set("x-csrf-token", csrf)).status, 409);
  // 保存供后续测试使用
  (globalThis as { __totp?: { secret: string; recovery: string[] } }).__totp = { secret, recovery };
});

test("启用后登录分两步：密码正确只得到票据、没有会话；动态码正确才发会话；密码错误不泄露是否启用", async () => {
  const { secret } = (globalThis as { __totp?: { secret: string } }).__totp!;
  const source = "203.0.113.20";
  // 密码错误：与未启用时完全一样的 401，不透露二步验证状态
  const bad = await step1(source, ROOT, "wrong-password-value");
  assert.equal(bad.status, 401);
  assert.equal(bad.body.data, null);
  const first = await step1("203.0.113.21");
  assert.equal(first.status, 200);
  assert.equal(first.body.data.totpRequired, true);
  assert.equal(first.headers["set-cookie"], undefined, "no session before the second factor");
  assert.equal(first.body.data.csrfToken, undefined);
  assert.ok(String(first.body.data.ticket).length >= 40);
  // 票据本身不能当会话用
  assert.equal((await request(app).get("/api/admin/auth/me").set("Cookie", `bm_admin=${first.body.data.ticket}`)).status, 401);
  // 动态码错误：401，票据仍可继续试
  assert.equal((await step2("203.0.113.21", first.body.data.ticket, "123456" === code(secret) ? "654321" : "123456")).status, 401);
  // 动态码已在上一条测试里（启用时）使用过同一个时间片，不能重放
  assert.equal((await step2("203.0.113.21", first.body.data.ticket, code(secret))).status, 401);
  // 清除“已用时间片”后（模拟过了一个时间片），正确的码通过
  db.prepare("update admin_totp set last_step = ? where admin_id = ?").run(nowStep() - 3, findAdminByUsername("totp-root")!.id);
  const done = await step2("203.0.113.21", first.body.data.ticket, code(secret));
  assert.equal(done.status, 200);
  assert.equal(done.body.data.username, "totp-root");
  const cookie = String(done.headers["set-cookie"]).split(";")[0]!;
  assert.equal((await request(app).get("/api/admin/auth/me").set("Cookie", cookie)).status, 200);
  // 同一个码不能再次使用……
  assert.equal((await step2("203.0.113.21", first.body.data.ticket, code(secret))).status, 401);
  // ……并且票据本身也只能用一次：即使动态码本身有效（把已用时间片清掉），用过的票据也不能再换会话。
  db.prepare("update admin_totp set last_step = ? where admin_id = ?").run(nowStep() - 3, findAdminByUsername("totp-root")!.id);
  assert.equal((await step2("203.0.113.21", first.body.data.ticket, code(secret))).status, 401);
  // 审计里记录了二步验证登录，且不含任何密钥或码
  const audit = db.prepare("select summary from audit_logs where action = 'admin.login' order by id desc limit 1").get() as { summary: string };
  assert.match(audit.summary, /二步验证（动态码）/);
  assert.equal(JSON.stringify(db.prepare("select summary from audit_logs").all()).includes(secret), false);
});

test("票据绑定签发来源，过期或次数用尽后失效，不同来源拿到的票据互不影响", async () => {
  const { secret } = (globalThis as { __totp?: { secret: string } }).__totp!;
  const ticket = (await step1("203.0.113.30")).body.data.ticket as string;
  db.prepare("update admin_totp set last_step = ? where admin_id = ?").run(nowStep() - 3, findAdminByUsername("totp-root")!.id);
  // 别的来源拿不到这张票据对应的会话（也不会消耗它）
  assert.equal((await step2("203.0.113.31", ticket, code(secret))).status, 401);
  // 过期票据
  db.prepare("update admin_login_tickets set expires_ms = ? where token_hash = ?").run(Date.now() - 1, (await import("../src/security/identity.ts")).hashToken(ticket));
  assert.equal((await step2("203.0.113.30", ticket, code(secret))).status, 401);
  // 次数上限（单元级：避免被来源冷却先拦住）
  const id = findAdminByUsername("totp-root")!.id, identity = "ticket-unit-source";
  const token = totp.issueLoginTicket(id, identity);
  for (let i = 0; i < totp.TICKET_MAX_ATTEMPTS; i++) assert.equal(totp.checkTicket(token, identity).ok, true);
  assert.deepEqual(totp.checkTicket(token, identity), { ok: false, reason: "too-many" });
  assert.deepEqual(totp.checkTicket(token, identity), { ok: false, reason: "invalid" });
});

test("恢复码只能用一次，用后只剩下其余恢复码", async () => {
  const { recovery } = (globalThis as { __totp?: { recovery: string[] } }).__totp!;
  const ticket = (await step1("203.0.113.40")).body.data.ticket as string;
  const used = recovery[0]!;
  const done = await step2("203.0.113.40", ticket, used.toUpperCase());
  assert.equal(done.status, 200);
  assert.match((db.prepare("select summary from audit_logs where action = 'admin.login' order by id desc limit 1").get() as { summary: string }).summary, /恢复码/);
  const again = (await step1("203.0.113.41")).body.data.ticket as string;
  assert.equal((await step2("203.0.113.41", again, used)).status, 401);
  assert.equal(totp.totpState(findAdminByUsername("totp-root")!.id).recoveryRemaining, 9);
  assert.equal((await step2("203.0.113.41", again, recovery[1]!.replace("-", ""))).status, 200);
});

test("一个来源猜错动态码被冷却后，其他来源的管理员仍能完成登录，被猜的账号也没有被锁", async () => {
  const { secret } = (globalThis as { __totp?: { secret: string } }).__totp!;
  db.prepare("update admin_totp set last_step = ? where admin_id = ?").run(nowStep() - 3, findAdminByUsername("totp-root")!.id);
  const attacker = "203.0.113.50";
  const ticket = (await step1(attacker)).body.data.ticket as string;
  const wrong = "123456" === code(secret) ? "654321" : "123456";
  for (let i = 0; i < 3; i++) assert.equal((await step2(attacker, ticket, wrong)).status, 401);
  const cooled = await step2(attacker, ticket, code(secret));
  assert.equal(cooled.status, 429, "a cooled-down source cannot succeed even with the right code");
  assert.equal(cooled.body.code, "login_cooldown");
  // 真正的管理员从别的来源登录，完全不受影响
  const adminTicket = (await step1("203.0.113.51")).body.data.ticket as string;
  const done = await step2("203.0.113.51", adminTicket, code(secret));
  assert.equal(done.status, 200);
});

test("没有启用二步验证的其他管理员登录完全不变，管理员列表显示各自状态", async () => {
  const plain = await step1("203.0.113.60", SECOND);
  assert.equal(plain.status, 200);
  assert.equal(plain.body.data.totpRequired, undefined);
  assert.equal(plain.body.data.username, "totp-second");
  assert.ok(plain.headers["set-cookie"], "a plain admin still gets a session immediately");
});

test("停用必须同时提供当前密码和动态码；停用后恢复单步登录且恢复码作废", async () => {
  const { secret } = (globalThis as { __totp?: { secret: string } }).__totp!;
  const id = findAdminByUsername("totp-root")!.id;
  // 先用恢复码登录拿到一个会话（动态码此时处于已用时间片）
  const ticket = (await step1("203.0.113.70")).body.data.ticket as string;
  const recovery = (globalThis as { __totp?: { recovery: string[] } }).__totp!.recovery;
  const signed = await request.agent(app).post("/api/admin/auth/login/totp").set("x-real-ip", "203.0.113.70").send({ ticket, code: recovery[2]! });
  assert.equal(signed.status, 200);
  const cookie = String(signed.headers["set-cookie"]).split(";")[0]!, csrf = signed.body.data.csrfToken as string;
  const call = (body: object) => request(app).post("/api/admin/auth/totp/disable").set("Cookie", cookie).set("x-csrf-token", csrf).set("x-real-ip", "203.0.113.71").send(body);
  db.prepare("update admin_totp set last_step = ? where admin_id = ?").run(nowStep() - 3, id);
  assert.equal((await call({ password: "wrong-password-value", code: code(secret) })).status, 401);
  assert.equal((await call({ password: ROOT.password, code: "000000" === code(secret) ? "111111" : "000000" })).status, 401);
  assert.equal((await call({ code: code(secret) })).status, 401);
  assert.equal(totp.totpEnabled(id), true);
  assert.equal((await call({ password: ROOT.password, code: code(secret) })).status, 200);
  assert.equal(totp.totpEnabled(id), false);
  assert.equal((db.prepare("select count(*) as n from admin_recovery_codes where admin_id = ?").get(id) as { n: number }).n, 0);
  assert.equal((await step1("203.0.113.72")).body.data.totpRequired, undefined);
});

test("超级管理员可以重置别人的二步验证（并让对方会话失效），不能这样重置自己；普通管理员无权", async () => {
  const second = findAdminByUsername(SECOND.username)!;
  // 直接为第二位管理员启用二步验证
  const setup = totp.beginTotpSetup(second.id, second.username)!;
  assert.ok(totp.confirmTotpSetup(second.id, code(setup.secret)));
  assert.equal(totp.totpEnabled(second.id), true);
  const secondTicket = (await step1("203.0.113.80", SECOND)).body.data;
  assert.equal(secondTicket.totpRequired, true);
  const { agent, csrf } = await session("203.0.113.81", ROOT);
  const list = await agent.get("/api/admin/admins");
  assert.equal(list.body.data.admins.find((row: { username: string }) => row.username === "totp-second").totp_enabled, 1);
  assert.equal(list.body.data.admins.find((row: { username: string }) => row.username === "totp-root").totp_enabled, 0);
  // 不能用这个接口重置自己
  assert.equal((await agent.patch(`/api/admin/admins/${findAdminByUsername("totp-root")!.id}`).set("x-csrf-token", csrf).send({ resetTotp: true })).status, 400);
  const reset = await agent.patch(`/api/admin/admins/${second.id}`).set("x-csrf-token", csrf).send({ resetTotp: true });
  assert.equal(reset.status, 200);
  assert.equal(totp.totpEnabled(second.id), false);
  assert.equal((await db.prepare("select count(*) as n from admin_login_tickets where admin_id = ?").get(second.id) as { n: number }).n, 0);
  assert.equal((await step1("203.0.113.82", SECOND)).body.data.totpRequired, undefined);
  assert.match((db.prepare("select summary from audit_logs where action = 'admin.update' order by id desc limit 1").get() as { summary: string }).summary, /"resetTotp":true/);
  // 普通管理员没有权限
  const plain = request.agent(app);
  const login = await plain.post("/api/admin/auth/login").set("x-real-ip", "203.0.113.83").send({ username: SECOND.username, password: SECOND.password, ...await captcha("203.0.113.83") });
  assert.equal((await plain.patch(`/api/admin/admins/${findAdminByUsername("totp-root")!.id}`).set("x-csrf-token", login.body.data.csrfToken).send({ resetTotp: true })).status, 403);
});

test("管理二步验证的接口有独立的次数限制，且不影响其他来源", async () => {
  const { agent, csrf } = await session("203.0.113.90", SECOND);
  const hit = () => agent.post("/api/admin/auth/totp/enable").set("x-csrf-token", csrf).set("x-real-ip", "203.0.113.91").send({ code: "000000" });
  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) statuses.push((await hit()).status);
  assert.ok(statuses.includes(429), `expected a 429 in ${statuses}`);
  assert.equal(statuses[0], 400);
  // 同一个管理员换一个来源，不受那个来源的限流影响
  const elsewhere = await agent.post("/api/admin/auth/totp/enable").set("x-csrf-token", csrf).set("x-real-ip", "203.0.113.92").send({ code: "000000" });
  assert.equal(elsewhere.status, 400);
});
