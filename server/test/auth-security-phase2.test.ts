import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-auth-phase2-test-"));
process.env.SECRET_KEY = "isolated-auth-phase2-secret";
process.env.HUMAN_CHECK_TEST_MODE = "1";
process.env.COOKIE_SECURE = "0";
process.env.MIN_FORM_SECONDS = "2";
process.env.MADDY_RUNNER = "disabled";
process.env.BOOTSTRAP_ADMIN = "phase2-admin";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "isolated-test-only-2026";

const { createApp } = await import("../src/app.ts");
const { default: request } = await import("supertest");
const { clientAddress } = await import("../src/security/identity.ts");
const { issueFormToken, consumeFormToken } = await import("../src/security/formToken.ts");
const { db, setSetting } = await import("../src/db.ts");
const { fingerprint, hashToken } = await import("../src/security/identity.ts");
const { issueHumanCheck, verifyHumanCheck } = await import("../src/security/humanCheck.ts");
const { recordLoginAttempt, completeLoginAttempt, reserveLoginAttempt, loginLimitState, failureCount, listBlockedIdentities, unblockIdentity } = await import("../src/security/rateLimit.ts");
const { reserveBudget, SECURITY_BUDGETS, reserveLease, releaseLease } = await import("../src/security/abuse.ts");
const { MailboxSession } = await import("../src/mail/session.ts");
const { createInvite } = await import("../src/admin/invites.ts");
const { dropSession } = await import("../src/mail/registry.ts");
const { verifyAdminCredentials } = await import("../src/admin/accounts.ts");
const { normalizeIp } = await import("../src/security/identity.ts");
const app = createApp({ log: () => undefined });

async function challenge(source: string, admin = true) {
  const response = await request(app).get(admin ? "/api/admin/human-check" : "/api/auth/human-check?purpose=login").set("x-real-ip", source);
  assert.equal(response.status, 200);
  return { humanNonce: response.body.data.nonce, humanAnswer: "ABCD" };
}
const credentials = { username: "phase2-admin", password: "isolated-test-only-2026" };
async function login(source: string, data = credentials) {
  return request(app).post("/api/admin/auth/login").set("x-real-ip", source).send({ ...data, ...await challenge(source) });
}

function ageForm(token: string) {
  db.prepare("update form_tokens set issued_at = issued_at - 3000 where token_hash = ?").run(hashToken(token));
}

test("管理员每次登录必须先通过一次性验证码", async () => {
  const result = await request(app).post("/api/admin/auth/login").send({ username: "phase2-admin", password: "isolated-test-only-2026" });
  assert.equal(result.status, 429);
  assert.equal(result.body.code, "human_required");
});

test("非可信连接不能伪造代理来源", () => {
  assert.equal(clientAddress({ "x-real-ip": "198.51.100.10", "x-forwarded-for": "203.0.113.8" }, "198.51.100.99"), "198.51.100.99");
  assert.equal(clientAddress({ "x-real-ip": "198.51.100.10" }), "unknown");
  assert.equal(normalizeIp("0:0:0:0:0:0:0:1"), "::1");
  assert.equal(normalizeIp("fe80::1%en0"), "");
});

test("异步管理员 scrypt 校验期间事件循环可响应，未知账号仍有同等哈希工作", async () => {
  for (const username of [credentials.username, "nonexistent-phase2"]) {
    let settled = false;
    const pending = verifyAdminCredentials(username, "isolated-test-only-2026").then((result) => { settled = true; return result; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal((await pending).ok, username === credentials.username);
  }
});

test("邀请猜测有独立预算，拒绝不创建邮箱、不消费邀请码、不记录密码或完整邀请", async () => {
  const source = "198.51.100.159";
  const invited = createInvite({ createdBy: "isolated-test", ttlHours: 24 });
  setSetting("register_max_per_hour", "100"); setSetting("register_max_per_day", "1000");
  try {
    for (let i = 0; i < 6; i++) {
      const issued = await request(app).get("/api/auth/human-check?purpose=register").set("x-real-ip", source);
      assert.equal(issued.status, 200); ageForm(issued.body.data.formToken);
      const result = await request(app).post("/api/auth/register").set("x-real-ip", source).send({
        account: "guessing-test", password: "never-log-this-marker-2026", inviteCode: i === 5 ? invited.code : "guessed-invite-marker",
        humanNonce: issued.body.data.nonce, humanAnswer: "ABCD", formToken: issued.body.data.formToken,
      });
      assert.equal(result.status, i === 5 ? 429 : 400);
      if (i === 5) { assert.equal(result.body.code, "invite_guess_rate_limited"); assert.ok(Number(result.headers["retry-after"]) > 0); }
    }
    assert.equal((db.prepare("select used_at from invites where id = ?").get(invited.id) as { used_at: string | null }).used_at, null);
    const logs = JSON.stringify([db.prepare("select * from login_logs").all(), db.prepare("select * from audit_logs").all()]);
    assert.doesNotMatch(logs, /never-log-this-marker|guessed-invite-marker|ABCD/);
    assert.ok(!logs.includes(invited.code));
  } finally { setSetting("register_max_per_hour", "3"); setSetting("register_max_per_day", "10"); }
});

test("来源恢复命令默认查看，显式恢复留审计且保留历史与预算", async () => {
  const identity = fingerprint("admin-login", "198.51.100.160");
  for (let i = 0; i < 3; i++) recordLoginAttempt("admin-login", identity, "recover-unit", false, "bad-credentials");
  assert.equal(loginLimitState("admin-login", identity).limited, true);
  const rows = db.prepare("select id, reason from login_logs where identity_hash = ?").all(identity);
  const run = promisify(execFile); const cwd = fileURLToPath(new URL("../..", import.meta.url));
  await run(process.execPath, ["scripts/recover-auth-source.mjs", identity], { cwd, env: { ...process.env } });
  assert.equal(loginLimitState("admin-login", identity).limited, true);
  await run(process.execPath, ["scripts/recover-auth-source.mjs", identity, "--apply"], { cwd, env: { ...process.env } });
  assert.equal(loginLimitState("admin-login", identity).limited, false);
  assert.deepEqual(db.prepare("select id, reason from login_logs where identity_hash = ?").all(identity), rows);
  assert.ok(db.prepare("select 1 from audit_logs where action = 'security.recover-source' and target_id = ?").get(identity));
  await assert.rejects(run(process.execPath, ["scripts/recover-auth-source.mjs", "all", "--apply"], { cwd, env: { ...process.env } }));
});

test("旧数据库加列迁移在多个进程同时启动时幂等，历史行不被删除", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const folder = mkdtempSync(join(tmpdir(), "bakamail-auth-migration-"));
  const old = new DatabaseSync(join(folder, "bakamail.db"));
  old.exec(`create table login_logs(id integer primary key, scope text not null, identity_hash text not null,
    account text not null default '', success integer not null, reason text not null default '', created_at text not null);
    create table form_tokens(id integer primary key, purpose text not null, token_hash text not null unique,
    issued_at integer not null, expires_at integer not null, consumed_at text);
    insert into login_logs values(1,'mail-login','historical-source','historical-account',0,'bad','2026-09-01T00:00:00.000Z');`);
  old.close();
  const run = promisify(execFile);
  const results = await Promise.all(Array.from({ length: 4 }, () => run(process.execPath, ["--input-type=module", "-e",
    "const {db}=await import('./server/src/db.ts');process.stdout.write(String(db.prepare('select count(*) as n from login_logs').get().n));db.close();"],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)), env: { ...process.env, DATA_DIR: folder } })));
  assert.ok(results.every((result) => result.stdout === "1"));
  const migrated = new DatabaseSync(join(folder, "bakamail.db"));
  assert.ok((migrated.prepare("pragma table_info(login_logs)").all() as { name: string }[]).some((row) => row.name === "account_hash"));
  assert.ok((migrated.prepare("pragma table_info(form_tokens)").all() as { name: string }[]).some((row) => row.name === "context_hash"));
  migrated.close();
});

test("注册时间必须来自服务端，刚签发令牌不能立即消费", () => {
  const token = issueFormToken("register", 1800, "bound-source");
  assert.equal(consumeFormToken("register", token, "bound-source", 2), false);
});

test("正确后台登录、每次挑战、重放拒绝与 HttpOnly/SameSite Cookie", async () => {
  const source = "198.51.100.101";
  const human = await challenge(source);
  const first = await request(app).post("/api/admin/auth/login").set("x-real-ip", source).send({ ...credentials, ...human });
  assert.equal(first.status, 200);
  assert.match(first.headers["set-cookie"][0], /HttpOnly; SameSite=Lax/);
  assert.equal((await request(app).post("/api/admin/auth/login").set("x-real-ip", source).send(credentials)).body.code, "human_required");
  const replay = await request(app).post("/api/admin/auth/login").set("x-real-ip", source).send({ ...credentials, ...human });
  assert.equal(replay.status, 429);
  assert.equal(replay.body.code, "human_required");
});

test("管理员三次失败后固定冷却，正确验证码不能越过，拒绝不消费挑战或延长冷却", async () => {
  const source = "198.51.100.102";
  for (let index = 0; index < 3; index++) assert.equal((await login(source, { ...credentials, password: "wrong-test-password" })).status, 401);
  const identity = fingerprint("admin-login", source);
  const state = loginLimitState("admin-login", identity);
  assert.equal(state.limit, 3);
  assert.ok(state.retryAfterSeconds <= 1800 && state.retryAfterSeconds > 1790);
  const until = db.prepare("select until_ms from security_cooldowns where identity_hash = ?").get(identity);
  const human = await challenge(source);
  for (let index = 0; index < 2; index++) {
    const response = await request(app).post("/api/admin/auth/login").set("x-real-ip", source).send({ ...credentials, ...human });
    assert.equal(response.body.code, "login_cooldown");
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers["retry-after"]) > 0);
    assert.deepEqual(db.prepare("select until_ms from security_cooldowns where identity_hash = ?").get(identity), until);
  }
  db.prepare("update security_cooldowns set until_ms = ? where identity_hash = ?").run(Date.now() - 1, identity);
  assert.equal((await request(app).post("/api/admin/auth/login").set("x-real-ip", source).send({ ...credentials, ...human })).status, 200);
});

test("换来源攻击同一账号会升级验证，但不永久锁账号；规范化别名计数一致", async () => {
  const originalPing = MailboxSession.prototype.ping;
  let calls = 0;
  MailboxSession.prototype.ping = async () => { calls++; throw Object.assign(new Error("not returned"), { authenticationFailed: true }); };
  try {
    for (let i = 0; i < 3; i++) {
      const result = await request(app).post("/api/auth/login").set("x-real-ip", `198.51.100.${110 + i}`)
        .send({ account: i === 0 ? " Risk-User " : "RISK-USER@saubaka.com", password: "test-only-wrong" });
      assert.equal(result.status, 401);
    }
    const source = "198.51.100.113";
    const result = await request(app).post("/api/auth/login").set("x-real-ip", source)
      .send({ account: "risk-user", password: "test-only-wrong" });
    assert.equal(result.body.code, "human_required");
    assert.equal(calls, 3);
    assert.equal(loginLimitState("mail-login", fingerprint("mail-login", source), "risk-user@saubaka.com").limited, false);
    const verified = await request(app).post("/api/auth/login").set("x-real-ip", source)
      .send({ account: "risk-user", password: "test-only-wrong", ...await challenge(source, false) });
    assert.equal(verified.status, 401);
    assert.equal(calls, 4);
  } finally { MailboxSession.prototype.ping = originalPing; }
});

test("密码喷洒换账号仍累计来源风险；成功只清理相同来源账号", () => {
  const identity = fingerprint("mail-login", "198.51.100.120");
  for (let i = 0; i < 4; i++) recordLoginAttempt("mail-login", identity, `spray-${i}@saubaka.com`, false, "bad-credentials");
  recordLoginAttempt("mail-login", identity, "spray-0@saubaka.com", true, "ok");
  assert.equal(failureCount("mail-login", identity, 60000), 3);
  assert.equal(loginLimitState("mail-login", identity).requireHuman, true);
  recordLoginAttempt("mail-login", identity, "spray-4@saubaka.com", false, "bad-credentials");
  recordLoginAttempt("mail-login", identity, "spray-5@saubaka.com", false, "bad-credentials");
  assert.equal(loginLimitState("mail-login", identity).limited, true);
});

test("来源短窗及全站预算预约是原子的，拒绝请求不增加状态或延长窗口", () => {
  const policy = { sourceMinute: 2, sourceHour: 4, globalMinute: 3, globalHour: 5 };
  assert.equal(reserveBudget("unit-request", "a", policy), 0);
  assert.equal(reserveBudget("unit-request", "a", policy), 0);
  const wait = reserveBudget("unit-request", "a", policy);
  assert.ok(wait > 0 && wait <= 60);
  assert.equal(reserveBudget("unit-request", "b", policy), 0);
  assert.ok(reserveBudget("unit-request", "c", policy) > 0);
  assert.equal((db.prepare("select count(*) as n from security_budgets where bucket = 'unit-request'").get() as { n: number }).n, 3);
  db.prepare("update security_budgets set created_ms = created_ms - 60001 where bucket = 'unit-request'").run();
  assert.equal(reserveBudget("unit-request", "a", policy), 0);
});

test("验证码签发洪泛被独立预算拦截，不继续生成 PNG 或新增挑战", async () => {
  const source = "198.51.100.121";
  for (let index = 0; index < 6; index++) assert.equal((await request(app).get("/api/admin/human-check").set("x-real-ip", source)).status, 200);
  const before = (db.prepare("select count(*) as n from human_challenges").get() as { n: number }).n;
  const denied = await request(app).get("/api/auth/human-check?purpose=login").set("x-real-ip", source);
  assert.equal(denied.body.code, "challenge_rate_limited");
  assert.ok(Number(denied.headers["retry-after"]) > 0);
  assert.equal((db.prepare("select count(*) as n from human_challenges").get() as { n: number }).n, before);
});

test("验证码与表单令牌绑定来源、用途、TTL 并原子消费", () => {
  const human = issueHumanCheck("context-purpose", "source-a", "unit-context");
  assert.equal(verifyHumanCheck("wrong-purpose", "source-a", human.nonce, "ABCD"), false);
  assert.equal(verifyHumanCheck("context-purpose", "source-b", human.nonce, "ABCD"), false);
  assert.equal(verifyHumanCheck("context-purpose", "source-a", human.nonce, "ABCD"), true);
  assert.equal(verifyHumanCheck("context-purpose", "source-a", human.nonce, "ABCD"), false);
  const expired = issueHumanCheck("context-purpose", "source-a", "unit-context");
  db.prepare("update human_challenges set expires_at = ? where nonce = ?").run(Math.floor(Date.now() / 1000) - 1, expired.nonce);
  assert.equal(verifyHumanCheck("context-purpose", "source-a", expired.nonce, "ABCD"), false);
  const token = issueFormToken("register", 1800, "unit-source"); ageForm(token);
  assert.equal(consumeFormToken("wrong-purpose", token, "unit-source", 2), false);
  assert.equal(consumeFormToken("register", token, "wrong-source", 2), false);
  assert.equal(consumeFormToken("register", token, "unit-source", 2), true);
  assert.equal(consumeFormToken("register", token, "unit-source", 2), false);
  const expiredToken = issueFormToken("register", 1800, "unit-source");
  db.prepare("update form_tokens set expires_at = ? where token_hash = ?").run(Date.now() - 1, hashToken(expiredToken));
  assert.equal(consumeFormToken("register", expiredToken, "unit-source", 0), false);
});

test("验证码猜解与表单令牌签发也有独立短窗和长窗", () => {
  for (let index = 0; index < 15; index++) assert.equal(verifyHumanCheck("unit", "verify-flood", "unknown", "ABCD"), false);
  assert.throws(() => verifyHumanCheck("unit", "verify-flood", "unknown", "ABCD"), { code: "human_verify_rate_limited" });
  for (let index = 0; index < 6; index++) issueFormToken("unit", 1800, "form-flood");
  assert.throws(() => issueFormToken("unit", 1800, "form-flood"), { code: "form_token_rate_limited" });
  for (let index = 0; index < 30; index++) {
    db.prepare("delete from security_budgets where bucket = 'challenge' and identity_hash = 'hour-flood' and created_ms > ?").run(Date.now() - 60_000);
    const result = reserveBudget("challenge", "hour-flood", SECURITY_BUDGETS.challenge);
    assert.equal(result, 0);
    db.prepare("update security_budgets set created_ms = ? where bucket = 'challenge' and identity_hash = 'hour-flood' and created_ms > ?").run(Date.now() - 120_000, Date.now() - 60_000);
  }
  assert.ok(reserveBudget("challenge", "hour-flood", SECURITY_BUDGETS.challenge) > 3000);
});

test("多来源并发邮件校验只占八个全站槽，拒绝不触达邮局；完成后释放", async () => {
  const originalPing = MailboxSession.prototype.ping;
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  MailboxSession.prototype.ping = async () => { calls++; await gate; throw Object.assign(new Error("mock rejection"), { authenticationFailed: true }); };
  let rejected = 0;
  const pending = Array.from({ length: 12 }, (_, i) => request(app).post("/api/auth/login").set("x-real-ip", `198.51.100.${130 + i}`)
    .send({ account: `concurrent-${i}`, password: "isolated-wrong" }).then((result) => { if (result.status === 429) rejected++; return result; }));
  try {
    const deadline = Date.now() + 3000;
    while (rejected < 4 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(rejected, 4); assert.equal(calls, 8);
    release();
    const results = await Promise.all(pending);
    assert.equal(results.filter((result) => result.body.code === "login_busy").length, 4);
    assert.equal((db.prepare("select count(*) as n from security_leases where scope = 'mail-login'").get() as { n: number }).n, 0);
  } finally { release(); await Promise.allSettled(pending); MailboxSession.prototype.ping = originalPing; }
});

test("管理员校验全站四槽与同来源两槽，过期预约可回收且不冒充错误密码", () => {
  const ids = Array.from({ length: 4 }, (_, i) => reserveLoginAttempt("admin-login", `unit-admin-source-${i}`, "phase2-admin"));
  assert.ok(ids.every((id) => id !== null));
  assert.equal(reserveLoginAttempt("admin-login", "unit-admin-next", "phase2-admin"), null);
  db.prepare("update security_leases set expires_ms = ? where scope = 'admin-login'").run(Date.now() - 1);
  db.prepare("update login_logs set created_at = ? where scope = 'admin-login' and reason = 'pending'").run(new Date(Date.now() - 120001).toISOString());
  const next = reserveLoginAttempt("admin-login", "unit-admin-next", "phase2-admin"); assert.ok(next);
  assert.equal(failureCount("admin-login", "unit-admin-source-0", 600000), 0);
  completeLoginAttempt(next!, true, "ok");
  for (const id of ids) completeLoginAttempt(id!, false, "interrupted");
});

test("注册跨来源同账号去重、全站四槽和断线后租约清理", () => {
  const first = reserveLease("register", "reg-a", "same@saubaka.com", 4, 1); assert.ok(first);
  assert.equal(reserveLease("register", "reg-b", "same@saubaka.com", 4, 1), null);
  const others = Array.from({ length: 3 }, (_, i) => reserveLease("register", `reg-${i}`, `different-${i}`, 4, 1));
  assert.ok(others.every(Boolean)); assert.equal(reserveLease("register", "reg-extra", "extra", 4, 1), null);
  for (const id of [first, ...others]) releaseLease(id!);
  const stale = reserveLease("register", "stale-reg", "same@saubaka.com", 4, 1); assert.ok(stale);
  db.prepare("update security_leases set expires_ms = ? where id = ?").run(Date.now() - 1, stale);
  const restored = reserveLease("register", "restored-reg", "same@saubaka.com", 4, 1); assert.ok(restored); releaseLease(restored!);
});

test("匿名跨站提交/验证码获取拒绝，本站和无 Origin 的限流客户端保持兼容", async () => {
  for (const path of ["/api/auth/login", "/api/auth/register", "/api/admin/auth/login"]) {
    const rejected = await request(app).post(path).set("Origin", "https://evil.example").send({ password: "not-returned" });
    assert.equal(rejected.status, 403); assert.equal(rejected.body.code, "origin_rejected");
  }
  assert.equal((await request(app).get("/api/admin/human-check").set("sec-fetch-site", "cross-site")).status, 403);
  const local = await request(app).get("/api/admin/human-check").set("Host", "localhost:5191").set("Origin", "http://localhost:5191").set("x-real-ip", "198.51.100.150");
  assert.equal(local.status, 200);
});

test("注册伪造 elapsedMs 与跨来源令牌均失败，邀请码不被消费", async () => {
  const invited = createInvite({ createdBy: "isolated-test", ttlHours: 24 });
  const source = "198.51.100.151";
  const human = await request(app).get("/api/auth/human-check?purpose=register").set("x-real-ip", source);
  const payload = { inviteCode: invited.code, account: "isolated-form", password: "isolated-password-2026", humanNonce: human.body.data.nonce,
    humanAnswer: "ABCD", formToken: human.body.data.formToken, elapsedMs: 99999999 };
  const tooFast = await request(app).post("/api/auth/register").set("x-real-ip", source).send(payload);
  assert.equal(tooFast.status, 400); assert.match(tooFast.body.error, /表单|过快/);
  const otherHuman = await request(app).get("/api/auth/human-check?purpose=register").set("x-real-ip", source);
  ageForm(otherHuman.body.data.formToken);
  const crossSource = await request(app).post("/api/auth/register").set("x-real-ip", "198.51.100.152").send({ ...payload, formToken: otherHuman.body.data.formToken });
  assert.equal(crossSource.status, 400);
  assert.equal((db.prepare("select used_at from invites where id = ?").get(invited.id) as { used_at: string | null }).used_at, null);
});

test("后台策略独立保存、非法变更不部分提交，自动冷却可授权解除并保留日志", async () => {
  const source = "198.51.100.153";
  const human = await challenge(source);
  const agent = request.agent(app);
  const signed = await agent.post("/api/admin/auth/login").set("x-real-ip", source).send({ ...credentials, ...human });
  assert.equal(signed.status, 200);
  const csrf = signed.body.data.csrfToken;
  assert.equal((await agent.patch("/api/admin/security").send({ adminLoginMaxFailures: 4 })).status, 403);
  assert.equal((await agent.patch("/api/admin/security").set("x-csrf-token", csrf).send({ adminLoginMaxFailures: 4, adminLoginLockMinutes: 12 })).status, 200);
  let settings = (await agent.get("/api/admin/security")).body.data;
  assert.equal(settings.loginMaxFailures, 5); assert.equal(settings.adminLoginMaxFailures, 4); assert.equal(settings.adminLoginLockMinutes, 12);
  assert.equal((await agent.patch("/api/admin/security").set("x-csrf-token", csrf).send({ adminLoginMaxFailures: 8, adminLoginLockMinutes: 0 })).status, 400);
  settings = (await agent.get("/api/admin/security")).body.data;
  assert.equal(settings.adminLoginMaxFailures, 4);
  setSetting("admin_login_max_failures", "3"); setSetting("admin_login_lock_minutes", "30");
  const identity = fingerprint("mail-login", "198.51.100.154");
  for (let i = 0; i < 5; i++) recordLoginAttempt("mail-login", identity, "cooldown-test", false, "bad-credentials");
  assert.ok(listBlockedIdentities().some((row) => row.identity_hash === identity));
  const before = db.prepare("select reason from login_logs where identity_hash = ?").all(identity);
  assert.equal((await agent.post("/api/admin/blocked-identities/unblock").set("x-csrf-token", csrf).send({ identityHash: identity })).status, 200);
  assert.deepEqual(db.prepare("select reason from login_logs where identity_hash = ?").all(identity), before);
  assert.equal(loginLimitState("mail-login", identity).limited, false);
});

test("再次登录轮换当前浏览器会话，旧 Cookie 失效而不吊销别的浏览器", async () => {
  const source = "198.51.100.155";
  const agent = request.agent(app);
  const other = await login("198.51.100.156"); assert.equal(other.status, 200);
  const first = await agent.post("/api/admin/auth/login").set("x-real-ip", source).send({ ...credentials, ...await challenge(source) });
  const oldCookie = first.headers["set-cookie"][0].split(";")[0];
  assert.equal((await agent.post("/api/admin/auth/login").set("x-real-ip", source).send({ ...credentials, ...await challenge(source) })).status, 200);
  assert.equal((await request(app).get("/api/admin/auth/me").set("Cookie", oldCookie)).status, 401);
  assert.equal((await agent.get("/api/admin/auth/me")).status, 200);
  assert.equal((await request(app).get("/api/admin/auth/me").set("Cookie", other.headers["set-cookie"][0].split(";")[0])).status, 200);
});

test("冷却与预算跨 BFF 进程重启保持；测试验证码旁路在非测试环境启动失败", async () => {
  const run = promisify(execFile);
  const identity = fingerprint("mail-login", "198.51.100.157");
  for (let i = 0; i < 5; i++) recordLoginAttempt("mail-login", identity, "restart-test", false, "bad-credentials");
  const policy = { sourceMinute: 1, sourceHour: 1, globalMinute: 10, globalHour: 10 };
  assert.equal(reserveBudget("restart-budget", "restart-source", policy), 0);
  const code = `const {loginLimitState}=await import('./server/src/security/rateLimit.ts');const {reserveBudget}=await import('./server/src/security/abuse.ts');process.stdout.write(JSON.stringify({limited:loginLimitState('mail-login','${identity}').limited,wait:reserveBudget('restart-budget','restart-source',${JSON.stringify(policy)})}));`;
  const result = await run(process.execPath, ["--input-type=module", "-e", code], { cwd: fileURLToPath(new URL("../..", import.meta.url)), env: { ...process.env } });
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.limited, true); assert.ok(parsed.wait > 0);
  await assert.rejects(run(process.execPath, ["--input-type=module", "-e", "await import('./server/src/config.ts')"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), env: { ...process.env, NODE_ENV: "production" },
  }), (error: any) => { assert.match(error.stderr, /requires NODE_ENV=test/); return true; });
});

test("多个独立 SQLite 连接竞争同一预算和一次性挑战，仅限额内预约/一次消费", async () => {
  const run = promisify(execFile);
  const cwd = fileURLToPath(new URL("../..", import.meta.url));
  const policy = { sourceMinute: 3, sourceHour: 3, globalMinute: 3, globalHour: 3 };
  const args = ["--input-type=module", "-e", `const {reserveBudget}=await import('./server/src/security/abuse.ts');process.stdout.write(String(reserveBudget('cross-worker','shared',${JSON.stringify(policy)})));`];
  const results = await Promise.all(Array.from({ length: 6 }, () => run(process.execPath, args, { cwd, env: { ...process.env } })));
  assert.equal(results.filter((row) => row.stdout === "0").length, 3);
  const human = issueHumanCheck("cross-worker", "bound-context", "cross-worker-source");
  const token = issueFormToken("cross-worker", 1800, "bound-context");
  const consume = ["--input-type=module", "-e", `const {verifyHumanCheck}=await import('./server/src/security/humanCheck.ts');const {consumeFormToken}=await import('./server/src/security/formToken.ts');process.stdout.write(JSON.stringify({human:verifyHumanCheck('cross-worker','bound-context','${human.nonce}','ABCD'),token:consumeFormToken('cross-worker','${token}','bound-context')}));`];
  const consumed = await Promise.all(Array.from({ length: 4 }, () => run(process.execPath, consume, { cwd, env: { ...process.env } })));
  const parsed = consumed.map((row) => JSON.parse(row.stdout));
  assert.equal(parsed.filter((row) => row.human).length, 1); assert.equal(parsed.filter((row) => row.token).length, 1);
});

test("普通登录成功轮换会话、不连接真实邮局，邮局故障仍消耗请求预算但不是密码失败", async () => {
  const original = { ping: MailboxSession.prototype.ping, startIdle: MailboxSession.prototype.startIdle, close: MailboxSession.prototype.close };
  MailboxSession.prototype.ping = async () => undefined;
  MailboxSession.prototype.startIdle = () => undefined;
  MailboxSession.prototype.close = async () => undefined;
  const source = "198.51.100.158";
  const agent = request.agent(app);
  const data = { account: "session-good", password: "isolated-only-2026" };
  try {
    const first = await agent.post("/api/auth/login").set("x-real-ip", source).send(data); assert.equal(first.status, 200);
    const cookie = first.headers["set-cookie"][0].split(";")[0];
    assert.equal((await agent.post("/api/auth/login").set("x-real-ip", source).send(data)).status, 200);
    assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie)).status, 401);
    assert.equal((await agent.get("/api/auth/me")).status, 200);
    const identity = fingerprint("mail-login", source);
    MailboxSession.prototype.ping = async () => { throw Object.assign(new Error("private connection error"), { code: "ECONNREFUSED" }); };
    for (let i = 0; i < 18; i++) assert.equal((await request(app).post("/api/auth/login").set("x-real-ip", source).send(data)).body.code, "mail_unavailable");
    assert.equal((await request(app).post("/api/auth/login").set("x-real-ip", source).send(data)).body.code, "login_rate_limited");
    assert.equal(failureCount("mail-login", identity, 60000), 0);
  } finally {
    const rows = db.prepare("select id from mail_sessions where mailbox = 'session-good@saubaka.com'").all() as { id: string }[];
    for (const row of rows) await dropSession(row.id);
    Object.assign(MailboxSession.prototype, original);
  }
});
