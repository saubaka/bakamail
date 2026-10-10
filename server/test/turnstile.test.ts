import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-turnstile-test-"));
process.env.SECRET_KEY = "isolated-turnstile-secret-value";
process.env.HUMAN_CHECK_TEST_MODE = "1";
process.env.COOKIE_SECURE = "0";
process.env.MADDY_RUNNER = "disabled";
process.env.MAIL_DOMAIN = "example.test";
process.env.BOOTSTRAP_ADMIN = "ts-root";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "isolated-test-only-2026";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { createApp } = await import("../src/app.ts");
const { default: request } = await import("supertest");
const { db } = await import("../src/db.ts");
const turnstile = await import("../src/security/turnstile.ts");
const app = createApp({ log: () => undefined });

const SITE = "0x4AAAAAAAtestSiteKey01";
const SECRET = "0x4AAAAAAAtestSecretKey-0123456789abcdef";
type Call = { url: string; params: URLSearchParams };
let calls: Call[] = [];
let behaviour: (params: URLSearchParams) => unknown = () => ({ success: true, action: "admin-test", hostname: "example.test", "error-codes": [] });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const params = new URLSearchParams(String(init?.body ?? ""));
  calls.push({ url: String(input), params });
  const value = behaviour(params);
  if (value instanceof Error) throw value;
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

let adminCounter = 0;
async function admin() {
  const source = `203.0.113.${100 + (adminCounter += 1)}`; // 每次换一个来源，避免触发同一来源的验证码额度。
  const agent = request.agent(app);
  const challenge = await agent.get("/api/admin/human-check").set("x-real-ip", source);
  const signed = await agent.post("/api/admin/auth/login").set("x-real-ip", source)
    .send({ username: "ts-root", password: "isolated-test-only-2026", humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD" });
  assert.equal(signed.status, 200);
  return { agent, csrf: signed.body.data.csrfToken as string };
}
const resetBody = (token: string) => ({ account: "someone@example.test", humanNonce: "turnstile", humanAnswer: token });
const echoAction = (action: string) => (params: URLSearchParams) =>
  params.get("secret") === SECRET && params.get("response")?.startsWith("good")
    ? { success: true, action, hostname: "example.test", "error-codes": [] }
    : { success: false, "error-codes": ["invalid-input-response"] };

test("未配置时一切照旧：入口仍发内建验证码，面板读到空配置，不调用 Cloudflare", async () => {
  calls = [];
  const issued = await request(app).get("/api/auth/human-check?purpose=register").set("x-real-ip", "198.51.100.1");
  assert.equal(issued.status, 200);
  assert.match(issued.body.data.image, /^data:image\/png;base64,/);
  assert.equal(issued.body.data.provider, undefined);
  const { agent } = await admin();
  const view = await agent.get("/api/admin/human-verification");
  assert.equal(view.status, 200);
  assert.deepEqual({ ...view.body.data, stats: undefined, scopes: undefined }, {
    enabled: false, siteKey: "", hasSecret: false, scopes: undefined, verified: false, verifiedAt: "", updatedAt: "",
    active: [], testingKeys: false, panelAction: "admin-test", stats: undefined,
  });
  assert.equal(calls.length, 0);
});

test("面板接口需要登录、CSRF 和安全写权限；未登录一律 401", async () => {
  assert.equal((await request(app).get("/api/admin/human-verification")).status, 401);
  assert.equal((await request(app).put("/api/admin/human-verification").send({})).status, 401);
  const { agent } = await admin();
  assert.equal((await agent.put("/api/admin/human-verification").send({ siteKey: SITE })).status, 403, "missing CSRF token");
});

test("保存密钥：格式校验、私有密钥只存密文且永不返回、必须先验证才能启用", async () => {
  const { agent, csrf } = await admin();
  const put = (body: unknown) => agent.put("/api/admin/human-verification").set("x-csrf-token", csrf).send(body as object);
  assert.equal((await put({ siteKey: "短" })).status, 400);
  assert.equal((await put({ siteKey: SITE, secret: "has space in it 123" })).status, 400);
  assert.equal((await put({ unknown: 1 })).status, 400);
  assert.equal((await put({ enabled: true })).status, 409, "no keys yet");
  const saved = await put({ siteKey: SITE, secret: SECRET });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.hasSecret, true);
  assert.equal(saved.body.data.verified, false);
  assert.equal(JSON.stringify(saved.body).includes(SECRET), false);
  assert.equal(JSON.stringify((await agent.get("/api/admin/human-verification")).body).includes(SECRET), false);
  // 数据库里不是明文
  const row = db.prepare("select value from app_settings where key = 'turnstile'").get() as { value: string };
  assert.equal(row.value.includes(SECRET), false);
  assert.equal(row.value.includes("0123456789abcdef"), false);
  // 没通过真实验证不能启用
  const early = await put({ enabled: true });
  assert.equal(early.status, 409);
  assert.match(early.body.error, /真实验证/);
  assert.equal(turnstile.readTurnstile().enabled, false);
});

test("检查私有密钥：Cloudflare 报密钥无效时明确提示，接受时通过；网络故障给 502 且不改配置", async () => {
  const { agent, csrf } = await admin();
  const check = () => agent.post("/api/admin/human-verification/check-secret").set("x-csrf-token", csrf);
  calls = [];
  behaviour = () => ({ success: false, "error-codes": ["invalid-input-response"] });
  const accepted = await check();
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.valid, true);
  assert.equal(calls[0]!.params.get("secret"), SECRET);
  behaviour = () => ({ success: false, "error-codes": ["invalid-input-secret"] });
  const rejected = await check();
  assert.equal(rejected.body.data.valid, false);
  assert.match(rejected.body.data.message, /私有密钥无效/);
  behaviour = () => new Error("connect ETIMEDOUT");
  assert.equal((await check()).status, 502);
});

test("真实验证：令牌被 Cloudflare 接受且 action 对得上才算通过；失败、过期、网络故障都不算", async () => {
  const { agent, csrf } = await admin();
  const verify = (token: unknown) => agent.post("/api/admin/human-verification/verify").set("x-csrf-token", csrf).send({ token } as object);
  calls = [];
  behaviour = echoAction("admin-test");
  assert.equal((await verify("bad-token")).status, 400);
  assert.equal((await verify("")).status, 400);
  assert.equal((await verify("x".repeat(3000))).status, 400);
  assert.equal(calls.length, 1, "empty and oversized tokens never reach Cloudflare");
  assert.equal(turnstile.isVerified(), false);
  behaviour = echoAction("login"); // 令牌来自别的入口
  assert.equal((await verify("good-1")).status, 400);
  assert.equal(turnstile.isVerified(), false);
  behaviour = () => new Error("fetch failed");
  assert.equal((await verify("good-2")).status, 502);
  assert.equal(turnstile.isVerified(), false);
  behaviour = echoAction("admin-test");
  const passed = await verify("good-3");
  assert.equal(passed.status, 200);
  assert.equal(passed.body.data.verified, true);
  assert.equal(calls.at(-1)!.params.get("response"), "good-3");
  assert.equal(calls.at(-1)!.params.get("secret"), SECRET);
});

test("通过验证后才能启用；换密钥会自动停用并要求重新验证；入口开关可单独关闭", async () => {
  const { agent, csrf } = await admin();
  const put = (body: unknown) => agent.put("/api/admin/human-verification").set("x-csrf-token", csrf).send(body as object);
  assert.equal((await put({ enabled: true, scopes: { login: false, register: false, "password-reset": false } })).status, 400, "needs at least one entry");
  assert.equal((await put({ scopes: { admin: true } })).status, 400, "admin login is never configurable");
  const on = await put({ enabled: true });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body.data.active, ["login", "register", "password-reset"]);
  const partial = await put({ scopes: { "password-reset": false } });
  assert.deepEqual(partial.body.data.active, ["login", "register"]);
  await put({ scopes: { "password-reset": true } });
  // 换站点密钥：自动停用，验证结果作废
  const swapped = await put({ siteKey: "0x4AAAAAAAotherSiteKey2" });
  assert.equal(swapped.status, 200);
  assert.equal(swapped.body.data.enabled, false);
  assert.equal(swapped.body.data.autoDisabled, true);
  assert.equal(swapped.body.data.verified, false);
  assert.equal((await put({ enabled: true })).status, 409);
  // 换回原来的站点密钥并不会恢复验证结果：指纹按“当前这组密钥”算，需要重新验证。
  await put({ siteKey: SITE });
  assert.equal(turnstile.isVerified(), false);
  behaviour = echoAction("admin-test");
  await agent.post("/api/admin/human-verification/verify").set("x-csrf-token", csrf).send({ token: "good-again" });
  assert.equal((await put({ enabled: true })).body.data.enabled, true);
});

test("启用后：注册、登录、重置密码入口改用 Turnstile，不再生成图片；令牌由服务端校验", async () => {
  calls = [];
  for (const purpose of ["register", "login", "password-reset"]) {
    const issued = await request(app).get(`/api/auth/human-check?purpose=${purpose}`).set("x-real-ip", "198.51.100.7");
    assert.equal(issued.status, 200, purpose);
    assert.equal(issued.body.data.provider, "turnstile");
    assert.equal(issued.body.data.siteKey, SITE);
    assert.equal(issued.body.data.nonce, "turnstile");
    assert.equal(issued.body.data.image, "");
    assert.equal(JSON.stringify(issued.body).includes(SECRET), false);
  }
  assert.ok((await request(app).get("/api/auth/human-check?purpose=register").set("x-real-ip", "198.51.100.8")).body.data.formToken, "register keeps its fill-time token");
  assert.equal(calls.length, 0, "issuing a widget never calls Cloudflare");

  behaviour = echoAction("password-reset");
  const good = await request(app).post("/api/auth/password-reset").set("x-real-ip", "198.51.100.20").send(resetBody("good-reset-1"));
  assert.equal(good.status, 200);
  assert.equal(good.body.data.accepted, true);
  const call = calls.at(-1)!;
  assert.equal(call.url, turnstile.SITEVERIFY_URL);
  assert.equal(call.params.get("secret"), SECRET);
  assert.equal(call.params.get("response"), "good-reset-1");
  assert.equal(call.params.get("remoteip"), "198.51.100.20");

  const bad = await request(app).post("/api/auth/password-reset").set("x-real-ip", "198.51.100.21").send(resetBody("rejected-token"));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "人机校验未通过");
  // 旧的四位验证码答案在 Turnstile 模式下无效
  const legacy = await request(app).post("/api/auth/password-reset").set("x-real-ip", "198.51.100.22").send({ account: "a@example.test", humanNonce: "whatever", humanAnswer: "ABCD" });
  assert.equal(legacy.status, 400);
  // 令牌来自别的入口（action 对不上）
  behaviour = echoAction("register");
  assert.equal((await request(app).post("/api/auth/password-reset").set("x-real-ip", "198.51.100.23").send(resetBody("good-wrong-form"))).status, 400);
});

test("注册入口：先校验 Turnstile 令牌，再检查邀请码；不通过或服务不可用时都不会走到邀请码检查", async () => {
  const { hashToken } = await import("../src/security/identity.ts");
  const attempt = async (source: string, token: string) => {
    const issued = await request(app).get("/api/auth/human-check?purpose=register").set("x-real-ip", source);
    assert.equal(issued.body.data.provider, "turnstile");
    db.prepare("update form_tokens set issued_at = issued_at - 3000 where token_hash = ?").run(hashToken(issued.body.data.formToken));
    return request(app).post("/api/auth/register").set("x-real-ip", source).send({
      account: "turnstile-probe", password: "Probe-Password-2026!", inviteCode: "not-a-real-invite",
      humanNonce: issued.body.data.nonce, humanAnswer: token, formToken: issued.body.data.formToken,
    });
  };
  behaviour = echoAction("register");
  const rejected = await attempt("198.51.100.60", "rejected-token");
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "人机校验未通过");
  const passed = await attempt("198.51.100.61", "good-register");
  assert.equal(passed.status, 400);
  assert.match(passed.body.error, /邀请码无效/, "a valid token proceeds to the invite check");
  behaviour = () => new Error("fetch failed");
  const down = await attempt("198.51.100.62", "good-register-2");
  assert.equal(down.status, 503);
  assert.match(down.body.error, /暂时不可用/);
});

test("Cloudflare 无法访问时关闭放行并返回 503，且不计入失败；没有令牌不调用 Cloudflare", async () => {
  calls = [];
  behaviour = () => new Error("getaddrinfo ENOTFOUND challenges.cloudflare.com");
  const down = await request(app).post("/api/auth/password-reset").set("x-real-ip", "198.51.100.30").send(resetBody("good-x"));
  assert.equal(down.status, 503);
  assert.match(down.body.error, /暂时不可用/);
  const before = calls.length;
  const empty = await request(app).post("/api/auth/password-reset").set("x-real-ip", "198.51.100.31").send(resetBody(""));
  assert.equal(empty.status, 400);
  assert.equal(calls.length, before, "empty token is rejected locally");
});

test("邮箱登录入口：失败达到阈值后改要 Turnstile；服务不可用返回 503 而不是计入登录失败", async () => {
  const { recordLoginAttempt } = await import("../src/security/rateLimit.ts");
  const { fingerprint } = await import("../src/security/identity.ts");
  const source = "198.51.100.40";
  const identity = fingerprint("mail-login", source);
  const account = "nobody@example.test";
  for (let i = 0; i < 3; i += 1) recordLoginAttempt("mail-login", identity, account, false, "bad-credentials");
  const failures = () => (db.prepare("select count(*) as n from login_logs where scope = 'mail-login' and identity_hash = ? and success = 0").get(identity) as { n: number }).n;
  const login = (extra: object = {}) => request(app).post("/api/auth/login").set("x-real-ip", source)
    .send({ account, password: "wrong-password-1", ...extra });
  calls = [];
  const needHuman = await login();
  assert.equal(needHuman.status, 429);
  assert.equal(needHuman.body.code, "human_required");
  assert.equal(calls.length, 0, "no token, no Cloudflare call");
  const counted = failures();
  behaviour = () => new Error("fetch failed");
  const down = await login({ humanNonce: "turnstile", humanAnswer: "good-login" });
  assert.equal(down.status, 503);
  assert.equal(down.body.code, "human_unavailable");
  assert.equal(failures(), counted, "an outage must not count against the user");
  behaviour = echoAction("login");
  const rejected = await login({ humanNonce: "turnstile", humanAnswer: "rejected-token" });
  assert.equal(rejected.status, 429);
  assert.equal(rejected.body.code, "human_required");
  assert.equal(failures(), counted + 1, "a rejected token counts like a failed captcha");
  // 通过的令牌放行到后面的账号密码校验（此处邮件服务未接入，不会是 human_required）
  const through = await login({ humanNonce: "turnstile", humanAnswer: "good-login-ok" });
  assert.notEqual(through.body.code, "human_required");
  assert.notEqual(through.body.code, "human_unavailable");
  assert.equal(calls.at(-1)!.params.get("response"), "good-login-ok");
});

test("管理员登录永远使用内建验证码：即使 Turnstile 已启用，后台验证码接口和登录都不变", async () => {
  calls = [];
  behaviour = () => new Error("must not be called for admin");
  const issued = await request(app).get("/api/admin/human-check").set("x-real-ip", "203.0.113.60");
  assert.equal(issued.status, 200);
  assert.match(issued.body.data.image, /^data:image\/png;base64,/);
  assert.equal(issued.body.data.provider, undefined);
  const signed = await request(app).post("/api/admin/auth/login").set("x-real-ip", "203.0.113.60")
    .send({ username: "ts-root", password: "isolated-test-only-2026", humanNonce: issued.body.data.nonce, humanAnswer: "ABCD" });
  assert.equal(signed.status, 200);
  assert.equal(calls.length, 0, "admin login never talks to Cloudflare");
  // 把 Turnstile 令牌当作后台验证码答案也不会被接受（不走 Cloudflare）
  const fake = await request(app).post("/api/admin/auth/login").set("x-real-ip", "203.0.113.61")
    .send({ username: "ts-root", password: "isolated-test-only-2026", humanNonce: "turnstile", humanAnswer: "good-token-value" });
  assert.notEqual(fake.status, 200);
  assert.equal(calls.length, 0);
});

test("Cloudflare 公布的测试密钥响应没有 action，仍可通过；真实密钥缺少 action 一律拒绝", async () => {
  const testing = "1x0000000000000000000000000000000AA";
  assert.equal(turnstile.isTestingSecret(testing), true);
  assert.equal(turnstile.isTestingSecret("0x4AAAAAAAtestSecretKey-0123456789abcdef"), false);
  behaviour = () => ({ success: true, "error-codes": [] });
  assert.equal((await turnstile.siteverify(testing, "tok", "", "login")).ok, true);
  assert.equal((await turnstile.siteverify(SECRET, "tok", "", "login")).ok, false);
  assert.deepEqual((await turnstile.siteverify(SECRET, "tok", "", "login")).errors, ["action-mismatch"]);
  assert.equal((await turnstile.siteverify(SECRET, "tok", "2001:db8:1:2::/64", "")).ok, true);
  assert.equal(calls.at(-1)!.params.get("remoteip"), null, "collapsed IPv6 prefixes are not valid addresses and are not sent");
});

test("即使库里是“已启用”，只要当前这组密钥没验证过，入口也不会使用 Turnstile", async () => {
  const stored = turnstile.readTurnstile();
  try {
    assert.equal(turnstile.turnstileFor("register")?.siteKey, SITE, "precondition: enabled and verified");
    turnstile.writeTurnstile({ ...stored, enabled: true, verifiedFingerprint: "stale-or-forged" });
    assert.equal(turnstile.turnstileFor("register"), null);
    const issued = await request(app).get("/api/auth/human-check?purpose=register").set("x-real-ip", "198.51.100.95");
    assert.equal(issued.body.data.provider, undefined);
    assert.match(issued.body.data.image, /^data:image\/png;base64,/);
    turnstile.writeTurnstile({ ...stored, enabled: false });
    assert.equal(turnstile.turnstileFor("register"), null, "disabled means built-in");
  } finally { turnstile.writeTurnstile(stored); }
  assert.equal(turnstile.turnstileFor("register")?.siteKey, SITE);
});

test("页面策略：保存过站点密钥才放行 challenges.cloudflare.com，且只放行这一个主机", async () => {
  const { pageCsp } = await import("../src/http/csp.ts");
  const plain = pageCsp("abc");
  assert.doesNotMatch(plain, /cloudflare/);
  const withCf = pageCsp("abc", { turnstile: true });
  for (const directive of ["script-src", "frame-src", "connect-src"]) {
    assert.match(withCf, new RegExp(`${directive}[^;]*https://challenges\\.cloudflare\\.com`), directive);
  }
  assert.equal((withCf.match(/cloudflare/g) ?? []).length, 3);
  assert.doesNotMatch(withCf, /unsafe-eval|script-src[^;]*unsafe-inline|\*/);
  if (!existsSync(join(projectRoot, "web", "dist", "index.html"))) return;
  assert.match(String((await request(app).get("/login")).headers["content-security-policy"]), /challenges\.cloudflare\.com/);
  const { agent, csrf } = await admin();
  await agent.delete("/api/admin/human-verification").set("x-csrf-token", csrf);
  assert.doesNotMatch(String((await request(app).get("/login")).headers["content-security-policy"]), /cloudflare/);
});

test("清除配置后入口恢复内建验证码，审计记录不含任何密钥", async () => {
  const issued = await request(app).get("/api/auth/human-check?purpose=password-reset").set("x-real-ip", "198.51.100.90");
  assert.equal(issued.body.data.provider, undefined);
  assert.match(issued.body.data.image, /^data:image\/png;base64,/);
  const logs = JSON.stringify(db.prepare("select action, summary from audit_logs where action like 'human-verification.%'").all());
  assert.match(logs, /human-verification\.update/);
  assert.match(logs, /human-verification\.verified/);
  assert.match(logs, /human-verification\.clear/);
  assert.equal(logs.includes(SECRET), false);
  assert.equal(logs.includes("0123456789abcdef"), false);
});
