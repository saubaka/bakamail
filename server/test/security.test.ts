import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-security-"));
process.env.SECRET_KEY = "test-secret-key-for-unit-tests";
process.env.HUMAN_CHECK_TEST_MODE = "0";
process.env.MAIL_DOMAIN = "example.test";

const { issueHumanCheck, verifyHumanCheck, purgeExpiredChallenges } = await import(
  "../src/security/humanCheck.ts"
);
const { hashPassword, verifyPassword, passwordProblem } = await import(
  "../src/security/passwords.ts"
);
const { fingerprint, clientAddress } = await import("../src/security/identity.ts");
const {
  recordLoginAttempt,
  completeLoginAttempt,
  reserveLoginAttempt,
  attemptCount,
  failureCount,
  loginLimitState,
  isIdentityBlocked,
  blockIdentity,
  listBlockedIdentities,
  unblockIdentity,
} = await import("../src/security/rateLimit.ts");
const { issueFormToken, consumeFormToken } = await import("../src/security/formToken.ts");
const { senderAddressAllowed } = await import("../src/mail/sender.ts");

test("发件人限制为本人地址或同域加号别名", () => {
  assert.equal(senderAddressAllowed("baka@example.test", "baka@example.test"), true);
  assert.equal(senderAddressAllowed("baka@example.test", "baka+notice@example.test"), true);
  assert.equal(senderAddressAllowed("baka@example.test", "baka@evil.example"), false);
  assert.equal(senderAddressAllowed("baka@example.test", "other+notice@example.test"), false);
  assert.equal(senderAddressAllowed("baka@example.test", "baka@example.test@evil.example"), false);
});

test("验证码：错误答案被拒绝，正确路径一次性消费", () => {
  const challenge = issueHumanCheck("unit", "target-1", "fp");
  assert.match(challenge.imageData, /^data:image\/png;base64,/);
  const png = Buffer.from(challenge.imageData.split(",")[1] ?? "", "base64");
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(verifyHumanCheck("unit", "target-1", challenge.nonce, "ZZZZ"), false);
  // 已经消费过，即使答案正确也不能再用
  assert.equal(verifyHumanCheck("unit", "target-1", challenge.nonce, "ZZZZ"), false);
});

test("验证码：未知 nonce 直接失败", () => {
  assert.equal(verifyHumanCheck("unit", "target-2", "not-a-nonce", "ABCD"), false);
});

test("验证码：清理过期记录返回数字", () => {
  assert.equal(typeof purgeExpiredChallenges(), "number");
});

test("密码哈希：可验证且盐随机", () => {
  const a = hashPassword("correct horse battery");
  const b = hashPassword("correct horse battery");
  assert.notEqual(a, b);
  assert.equal(verifyPassword(a, "correct horse battery"), true);
  assert.equal(verifyPassword(a, "wrong password here"), false);
  assert.equal(verifyPassword("garbage", "whatever"), false);
});

test("密码强度规则", () => {
  assert.equal(passwordProblem("short"), "密码至少 10 位");
  assert.equal(passwordProblem("1234567890"), "密码不能是纯数字");
  assert.equal(passwordProblem("abcdefghij"), "密码不能是纯字母");
  assert.equal(passwordProblem("baka-mail-2026"), "");
});

test("指纹稳定且不泄露来源地址", () => {
  const one = fingerprint("mail-login", "203.0.113.7");
  assert.equal(one, fingerprint("mail-login", "203.0.113.7"));
  assert.notEqual(one, fingerprint("admin-login", "203.0.113.7"));
  assert.equal(one.includes("203.0.113.7"), false);
});

test("来源地址优先取代理覆盖的真实地址，不信任客户端追加的 XFF 前缀", () => {
  assert.equal(clientAddress({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }, "127.0.0.1"), "10.0.0.1");
  assert.equal(clientAddress({ "x-real-ip": "198.51.100.10" }, "::ffff:127.0.0.1"), "198.51.100.10");
  assert.equal(clientAddress({ "x-real-ip": "198.51.100.10", "x-forwarded-for": "203.0.113.99, 198.51.100.10" }, "::1"), "198.51.100.10");
  assert.equal(clientAddress({ "x-real-ip": "not-an-ip", "x-forwarded-for": "spoofed" }, "127.0.0.1"), "127.0.0.1");
  assert.equal(clientAddress({}, "127.0.0.1"), "127.0.0.1");
});

test("请求预算先预占，成功完成仍计入申请次数且不重复记行", () => {
  const identity = fingerprint("request-budget-" + Math.random(), "10.1.1.4");
  const id = recordLoginAttempt("register", identity, "test@example.test", false, "pending");
  assert.equal(attemptCount("register", identity, 60_000), 1);
  completeLoginAttempt(id, true, "created");
  assert.equal(attemptCount("register", identity, 60_000), 1);
  assert.equal(failureCount("register", identity, 60_000), 0);
});

test("登录限速：按请求方计数并触发锁定", () => {
  const identity = fingerprint("test-scope-" + Math.random(), "10.1.1.1");
  for (let i = 0; i < 4; i += 1) {
    recordLoginAttempt("mail-login", identity, "me@example.test", false, "bad");
  }
  assert.equal(failureCount("mail-login", identity, 60_000), 4);
  assert.equal(loginLimitState("mail-login", identity).limited, false);
  recordLoginAttempt("mail-login", identity, "me@example.test", false, "bad");
  const state = loginLimitState("mail-login", identity);
  assert.equal(state.limited, true);
  assert.ok(state.retryAfterSeconds > 0);
});

test("登录限速：成功记录不参与失败计数", () => {
  const identity = fingerprint("test-scope-" + Math.random(), "10.1.1.2");
  recordLoginAttempt("mail-login", identity, "me@example.test", true, "ok");
  assert.equal(failureCount("mail-login", identity, 60_000), 0);
});

test("成功登录重置同来源同作用域的此前失败，不删除审计历史", () => {
  const identity = fingerprint("login-reset-" + Math.random(), "10.1.1.5");
  for (let i = 0; i < 5; i++) {
    recordLoginAttempt("mail-login", identity, "one", false, "bad");
    recordLoginAttempt("admin-login", identity, "admin", false, "bad");
  }
  assert.equal(loginLimitState("mail-login", identity).limited, true);
  recordLoginAttempt("mail-login", identity, "one", true, "ok");
  assert.equal(failureCount("mail-login", identity, 60000), 0);
  assert.equal(loginLimitState("mail-login", identity).limited, true);
  assert.equal(loginLimitState("admin-login", identity).limited, true);
  assert.equal(attemptCount("mail-login", identity, 60000), 6);
  recordLoginAttempt("mail-login", identity, "one", false, "new-failure");
  assert.equal(failureCount("mail-login", identity, 60000), 1);
});

test("密码校验预算原子预占、有界并发，待完成及繁忙不冒充密码失败", () => {
  const identity = fingerprint("inflight-login-" + Math.random(), "10.1.1.6");
  const ids = Array.from({ length: 2 }, () => reserveLoginAttempt("mail-login", identity, "one"));
  assert.ok(ids.every((id) => typeof id === "number"));
  assert.equal(reserveLoginAttempt("mail-login", identity, "one"), null);
  assert.equal(failureCount("mail-login", identity, 60000), 0);
  recordLoginAttempt("mail-login", identity, "one", false, "busy");
  assert.equal(failureCount("mail-login", identity, 60000), 0);
  completeLoginAttempt(ids[0]!, false, "bad-credentials");
  assert.equal(failureCount("mail-login", identity, 60000), 1);
  assert.ok(reserveLoginAttempt("mail-login", identity, "one"));
});

test("封禁指纹后 isIdentityBlocked 为真", () => {
  const identity = fingerprint("block-scope-" + Math.random(), "10.1.1.3");
  assert.equal(isIdentityBlocked(identity), false);
  blockIdentity(identity, "单测", "tester");
  assert.equal(isIdentityBlocked(identity), true);
  assert.ok(listBlockedIdentities().some((row) => row.identity_hash === identity));
  assert.equal(unblockIdentity(identity), true);
  assert.equal(isIdentityBlocked(identity), false);
  assert.equal(unblockIdentity(identity), false);
});

test("表单令牌一次性且可校验", () => {
  const token = issueFormToken("unit-form");
  assert.equal(consumeFormToken("unit-form", token), true);
  assert.equal(consumeFormToken("unit-form", token), false);
  assert.equal(consumeFormToken("unit-form", "unknown-token"), false);
});
