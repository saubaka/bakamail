import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const fixtureDir = mkdtempSync(join(tmpdir(), "bakamail-account-failure-"));
process.env.DATA_DIR = fixtureDir;
process.env.SECRET_KEY = "account-failure-projection-only";
process.env.MADDY_RUNNER = "disabled";
const { accountFailure } = await import("../src/mail/accountFailure.ts");
const { MailboxPartialError, MaddyError } = await import("../src/mail/accounts.ts");
after(() => rmSync(fixtureDir, { recursive: true, force: true }));

test("命令失败投影使用固定业务文本，不复制消息、stderr、嵌套错误或伪造状态", () => {
  const secret = "private-password internal.maddy:993 /data/private";
  for (const operation of ["create", "repair", "password", "remove"] as const) {
    for (const error of [new Error(secret), new MaddyError(secret, 1, secret),
      new AggregateError([new Error(secret)], "半成品"), { operation, message: secret }, null]) {
      const failure = accountFailure(operation, error);
      assert.equal(failure.outcome, "unconfirmed");
      assert.equal(failure.code, "mailbox_operation_unconfirmed");
      assert.doesNotMatch(JSON.stringify(failure), /private-password|internal\.maddy|\/data\/private/);
    }
  }
});

test("仅明确且匹配的半成品异常保留半成品恢复建议，不靠异常文本猜测", () => {
  for (const operation of ["create", "repair", "remove"] as const) {
    const error = new MailboxPartialError(operation, [new Error("private-cause")]);
    assert.ok(error instanceof AggregateError);
    const failure = accountFailure(operation, error);
    assert.equal(failure.outcome, "partial");
    assert.equal(failure.code, "mailbox_partial");
    assert.match(failure.message, /半成品.*核对并修复/);
    assert.doesNotMatch(JSON.stringify(failure), /private-cause/);
    assert.equal(accountFailure("password", error).outcome, "unconfirmed");
  }
});
