import test from "node:test";
import assert from "node:assert/strict";
import { loginSubmissionState, humanCheckReady } from "../src/auth/loginState.ts";

test("硬冷却、未完成验证码与提交中均不能放行", () => {
  assert.equal(loginSubmissionState(false, 0, false, "", "").disabled, false);
  assert.equal(loginSubmissionState(false, 30, false, "", "").disabled, true);
  assert.equal(loginSubmissionState(false, 30, true, "nonce", "ABC").disabled, true);
  assert.equal(loginSubmissionState(false, 30, true, "nonce", "ABCD").disabled, true);
  assert.equal(loginSubmissionState(true, 30, true, "nonce", "ABCD").disabled, true);
  assert.equal(loginSubmissionState(false, 5, false, "nonce", "ABCD").disabled, true);
  assert.equal(loginSubmissionState(false, 30, true, "", "ABCD").disabled, true);
});

test("服务故障等待不能用验证码绕过；等待结束仍要求完成有效挑战", () => {
  assert.equal(loginSubmissionState(false, 5, true, "nonce", "ABCD").disabled, true);
  assert.equal(loginSubmissionState(false, 0, true, "nonce", "ABCD").disabled, false);
  assert.equal(loginSubmissionState(false, 0, true, "", "ABCD").disabled, true);
  assert.equal(loginSubmissionState(false, 0, true, "nonce", "").disabled, true);
  assert.equal(loginSubmissionState(false, 5, true, "nonce", "ABCD").disabled, true);
});

test("验证码刷新或失败后空 nonce 不可提交，四位输入不能替代后端挑战", () => {
  assert.equal(humanCheckReady("", "ABCD"), false);
  assert.equal(humanCheckReady("nonce", "ABC"), false);
  assert.equal(humanCheckReady("nonce", "ABCD"), true);
  assert.equal(humanCheckReady("nonce", ""), false);
});
