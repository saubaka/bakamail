import { mkdtempSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-accounts-"));
process.env.SECRET_KEY = "test-secret-key-for-account-tests";
process.env.MADDY_RUNNER = "disabled";

const { createMailbox, listCredentials, maddyRunnerReady, MaddyError, runMaddy } = await import(
  "../src/mail/accounts.ts"
);

test("MADDY_RUNNER=disabled 时账号管理被明确拒绝", async () => {
  assert.equal(maddyRunnerReady(), false);
  await assert.rejects(
    () => createMailbox("someone@saubaka.com", "baka-mail-2026"),
    (error: unknown) => {
      assert.ok(error instanceof MaddyError);
      assert.match(String((error as Error).message), /MADDY_RUNNER=disabled/);
      return true;
    },
  );
});

test("MADDY_RUNNER=disabled 时列出凭据同样被拒绝", async () => {
  await assert.rejects(() => listCredentials());
});

test("runMaddy 在执行之前拒绝零、负数、非整数或超过四次的重试配置", async () => {
  for (const attempts of [0, -1, 1.5, 5, Infinity]) {
    await assert.rejects(runMaddy(["creds", "list"], "", attempts), RangeError);
  }
});

test("maddy 退出码为 0 但配置解析失败时，必须当成失败", async () => {
  // 用一个独立的子进程，因为 MADDY_RUNNER 是启动时读取的
  const script = `
process.env.DATA_DIR = ${JSON.stringify(mkdtempSync(join(tmpdir(), "bakamail-broken-")))};
process.env.SECRET_KEY = "test-secret-key";
process.env.MADDY_RUNNER = "local";
process.env.MADDY_BIN = ${JSON.stringify(joinPath(here, "fixtures", "fake-maddy-broken.sh"))};
process.env.MADDY_DATA_DIR = ${JSON.stringify(mkdtempSync(join(tmpdir(), "bakamail-broken-data-")))};
const { listCredentials, MaddyError } = await import(${JSON.stringify(new URL("../src/mail/accounts.ts", import.meta.url).href)});
try {
  // No stdin here: isolate exit=0 + parser-error from the separately tested EPIPE failure.
  await listCredentials();
  console.log(JSON.stringify({ ok: false, why: "没有抛出异常" }));
} catch (error) {
  console.log(JSON.stringify({
    ok: error instanceof MaddyError,
    message: String(error && error.message || error).slice(0, 120),
  }));
}
`;
  const { execFile } = await import("node:child_process");
  const output = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || String(error)));
      else resolve(stdout.trim());
    });
  });
  const parsed = JSON.parse(output) as { ok: boolean; message?: string };
  assert.equal(parsed.ok, true, `期望 MaddyError，实际：${output}`);
  assert.match(String(parsed.message), /app\.Run failed|失败/);
});

async function failedMailboxCreate(rollbackFails: boolean): Promise<{
  error: string;
  credentials: string;
  accounts: string;
}> {
  const stateDir = mkdtempSync(join(tmpdir(), "bakamail-rollback-state-"));
  const dataDir = mkdtempSync(join(tmpdir(), "bakamail-rollback-data-"));
  const script = `
process.env.DATA_DIR = ${JSON.stringify(dataDir)};
process.env.SECRET_KEY = "test-secret-key";
process.env.MADDY_RUNNER = "local";
process.env.MADDY_BIN = ${JSON.stringify(joinPath(here, "fixtures", "fake-maddy.sh"))};
process.env.MADDY_DATA_DIR = ${JSON.stringify(stateDir)};
process.env.FAKE_MADDY_STATE = ${JSON.stringify(stateDir)};
process.env.FAKE_MADDY_FAIL_IMAP_CREATE = "1";
process.env.FAKE_MADDY_FAIL_CREDS_REMOVE = ${JSON.stringify(rollbackFails ? "1" : "0")};
const { createMailbox } = await import(${JSON.stringify(new URL("../src/mail/accounts.ts", import.meta.url).href)});
const { readFileSync } = await import("node:fs");
let error = "";
try { await createMailbox("partial@saubaka.com", "strong-mail-2026"); }
catch (caught) { error = String(caught && caught.message || caught); }
console.log(JSON.stringify({
  error,
  credentials: readFileSync(${JSON.stringify(joinPath(stateDir, "credentials"))}, "utf8"),
  accounts: readFileSync(${JSON.stringify(joinPath(stateDir, "accounts"))}, "utf8"),
}));
`;
  const { execFile } = await import("node:child_process");
  const output = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || String(error)));
      else resolve(stdout.trim());
    });
  });
  return JSON.parse(output) as { error: string; credentials: string; accounts: string };
}

test("邮箱创建第二步失败时，确认删除刚建的凭据", async () => {
  const result = await failedMailboxCreate(false);
  assert.match(result.error, /forced mailbox creation failure/);
  assert.equal(result.credentials, "");
  assert.equal(result.accounts, "");
});

test("凭据回滚也失败时，明确报告半成品而非假装已清理", async () => {
  const result = await failedMailboxCreate(true);
  assert.match(result.error, /回滚失败.*半成品/);
  assert.match(result.credentials, /partial@saubaka.com/);
  assert.equal(result.accounts, "");
});
