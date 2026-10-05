import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-registration-"));
process.env.SECRET_KEY = "registration-tests-only";
const { registrationReasonProblem } = await import("../src/security/registration.ts");

test("邀请注册理由允许不填及正常多行文字，长度边界由后端判断", () => {
  assert.equal(registrationReasonProblem(undefined), null);
  assert.equal(registrationReasonProblem(""), null);
  assert.equal(registrationReasonProblem("收取个人邮件\n不填写敏感信息"), null);
  assert.equal(registrationReasonProblem("中".repeat(500)), null);
  assert.match(registrationReasonProblem("中".repeat(501))!, /500/);
  for (const invalid of [null, {}, [], 123, "bad\u0000reason"]) {
    assert.ok(registrationReasonProblem(invalid));
  }
});

test("理由中每个显式链接均占额度，https www ftp 和 mailto 不可绕过", () => {
  assert.equal(registrationReasonProblem("https://www.example.com https://b.example.com"), null);
  assert.match(registrationReasonProblem("https://a.example.com www.b.example.com ftp://c.example.com")!, /2 个链接/);
  assert.match(registrationReasonProblem("mailto:a@example.com mailto:b@example.com mailto:c@example.com")!, /2 个链接/);
  assert.match(registrationReasonProblem("HTTPS://a.example.com\nWWW.b.example.com\nFTP://c.example.com")!, /2 个链接/);
});
