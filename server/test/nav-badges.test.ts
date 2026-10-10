import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-badges-test-"));
process.env.SECRET_KEY = "isolated-badges-secret-value";
process.env.HUMAN_CHECK_TEST_MODE = "1";
process.env.COOKIE_SECURE = "0";
process.env.MADDY_RUNNER = "disabled";
process.env.MAIL_DOMAIN = "example.test";
process.env.BOOTSTRAP_ADMIN = "badge-root";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "isolated-test-only-2026";

const { createApp } = await import("../src/app.ts");
const { default: request } = await import("supertest");
const { db, setSetting } = await import("../src/db.ts");
const { createAdmin } = await import("../src/admin/accounts.ts");
const { pendingPasswordResets, railBadges } = await import("../src/admin/navBadges.ts");
const { recordLoginAttempt } = await import("../src/security/rateLimit.ts");
const app = createApp({ log: () => undefined });
assert.equal(createAdmin("badge-auditor", "auditor-pass-2026-xx", "auditor").ok, true);

let counter = 0;
async function login(username: string, password: string) {
  const source = `203.0.113.${150 + (counter += 1)}`;
  const agent = request.agent(app);
  const challenge = await agent.get("/api/admin/human-check").set("x-real-ip", source);
  const signed = await agent.post("/api/admin/auth/login").set("x-real-ip", source)
    .send({ username, password, humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD" });
  assert.equal(signed.status, 200);
  return agent;
}
const audit = (action: string, target: string, at: string) =>
  db.prepare("insert into audit_logs (actor_type, actor, action, target_type, target_id, summary, created_at) values ('x','x',?,'mailbox',?,'',?)").run(action, target, at);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 24 * 60 * 60_000;

test("没有任何待处理事项时不返回角标；未登录一律 401", async () => {
  assert.equal((await request(app).get("/api/admin/nav-badges")).status, 401);
  const agent = await login("badge-root", "isolated-test-only-2026");
  const reply = await agent.get("/api/admin/nav-badges");
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.data, {});
});

test("待处理重置申请：同一邮箱只算一次，管理员之后重置过的不再算，过期申请不算，账号名与完整邮箱视为同一个", () => {
  audit("mailbox.password-reset-request", "alice", ago(2 * 60_000));
  audit("mailbox.password-reset-request", "alice", ago(60_000));
  audit("mailbox.password-reset-request", "bob@example.test", ago(3 * 60 * 60_000));
  audit("mailbox.password-reset-request", "carol", ago(2 * DAY));
  audit("mailbox.password-reset-request", "old-timer", ago(9 * DAY));
  assert.equal(pendingPasswordResets(), 3, "alice, bob and carol are pending; the 9 day old request is ignored");
  // 管理员在申请之后重置了 carol（记录里是完整邮箱）和 bob
  audit("admin.account.password", "carol@example.test", ago(DAY));
  audit("admin.account.password", "BOB", ago(60 * 60_000));
  assert.equal(pendingPasswordResets(), 1, "only alice is still waiting");
  // 重置发生在申请之前，不算已处理
  audit("admin.account.password", "alice", ago(5 * 60_000));
  assert.equal(pendingPasswordResets(), 1, "a reset older than the latest request does not clear it");
  audit("admin.account.password", "alice", ago(10_000));
  assert.equal(pendingPasswordResets(), 0);
});

test("角标数字上限 99；三种角色都有账号读取权限所以都能看到，没有任何权限的角色什么也看不到", async () => {
  for (let i = 0; i < 130; i += 1) audit("mailbox.password-reset-request", `user${i}`, ago(1000 + i));
  const root = await login("badge-root", "isolated-test-only-2026");
  assert.equal((await root.get("/api/admin/nav-badges")).body.data.accounts, 99);
  const auditor = await login("badge-auditor", "auditor-pass-2026-xx");
  assert.equal((await auditor.get("/api/admin/nav-badges")).body.data.accounts, 99);
  // 权限检查是兜底：没有 mail.account.read / system.audit.read 的角色不会通过角标得知任何数字。
  assert.deepEqual(railBadges("nobody" as never), {});
});

test("安全角标：最近 15 分钟的登录失败达到告警阈值才出现，低于阈值不出现", () => {
  db.prepare("delete from login_logs").run();
  setSetting("global_failure_alert", "5");
  for (let i = 0; i < 4; i += 1) recordLoginAttempt("mail-login", `src-${i}`, `a${i}@example.test`, false, "bad-credentials");
  assert.equal(railBadges("superadmin").security, undefined, "below the threshold");
  recordLoginAttempt("mail-login", "src-9", "z@example.test", false, "bad-credentials");
  assert.equal(railBadges("superadmin").security, 5);
  assert.equal(railBadges("auditor").security, 5, "audit permission is enough to see the alert");
  assert.equal(railBadges("nobody" as never).security, undefined);
});
