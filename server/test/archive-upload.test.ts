import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
// @ts-expect-error Deployment helper is intentionally plain Node ESM.
import { uploadArchiveByExec } from "../../scripts/upload-archive.mjs";

const destination = "/root/mail/backups/bakamail-20260926T010101Z/release.tar.gz";

test("SSH 分块上传逐块核对偏移，完整哈希通过才替换发布包并保留 SFTP 残包", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakamail-upload-"));
  const actual = join(dir, "release.tar.gz");
  writeFileSync(actual, "old incomplete upload", { mode: 0o600 });
  const bytes = Buffer.alloc(55_000, 0x42);
  const commands: string[] = [];
  const digest = uploadArchiveByExec(bytes, destination, (command: string) => {
    commands.push(command);
    const result = spawnSync("sh", ["-c", command.replaceAll(destination, actual)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });
  assert.equal(digest, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(readFileSync(actual), bytes);
  assert.equal(readFileSync(actual + ".sftp-failed", "utf8"), "old incomplete upload");
  assert.equal(statSync(actual).mode & 0o777, 0o600);
  assert.equal(existsSync(actual + ".exec-part"), false);
  assert.ok(commands.length > 3);
  assert.ok(commands.every((command) => command.length < 24_000));
  assert.throws(() => uploadArchiveByExec(bytes, "/root/mail/bakamail/deploy/bakamail.env", () => {}), /目标/);
});

test("传输内容损坏时禁止晋升部分包，不覆盖现有发布包", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakamail-upload-corrupt-"));
  const actual = join(dir, "release.tar.gz");
  writeFileSync(actual, "original", { mode: 0o600 });
  assert.throws(() => uploadArchiveByExec(Buffer.from("new release"), destination, (command: string) => {
    if (command.includes("hashlib")) appendFileSync(actual + ".exec-part", "bad");
    const result = spawnSync("sh", ["-c", command.replaceAll(destination, actual)], { encoding: "utf8" });
    if (result.status !== 0) throw new Error("remote verification failed");
  }), /verification failed/);
  assert.equal(readFileSync(actual, "utf8"), "original");
  assert.equal(existsSync(actual + ".sftp-failed"), false);
});
