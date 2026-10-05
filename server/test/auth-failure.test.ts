import test from "node:test";
import assert from "node:assert/strict";
import { isMailServiceFailure } from "../src/mail/authFailure.ts";
import { MailDeadlineError, MailSessionClosedError } from "../src/mail/deadline.ts";

test("明确网络/TLS/截止故障与暂不可用响应识别为服务故障，即使认证库附带失败标记", () => {
  for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "CONNECT_TIMEOUT", "GREETING_TIMEOUT",
    "NoConnection", "ClosedAfterConnectTLS", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]) {
    assert.equal(isMailServiceFailure({ code, authenticationFailed: true }), true, code);
  }
  assert.equal(isMailServiceFailure(new MailDeadlineError("fixture")), true);
  assert.equal(isMailServiceFailure(new MailSessionClosedError()), true);
  assert.equal(isMailServiceFailure({ serverResponseCode: "UNAVAILABLE", authenticationFailed: true }), true);
});

test("错误密码与未知异常仍按拒绝处理，不靠消息文本猜测、不解析错误正文", () => {
  assert.equal(isMailServiceFailure({ serverResponseCode: "AUTHENTICATIONFAILED", authenticationFailed: true }), false);
  for (const error of [new Error("ECONNREFUSED"), { code: "AUTH_FAILED", message: "timeout" }, { code: 503 }, null, "unavailable"]) {
    assert.equal(isMailServiceFailure(error), false);
  }
});
