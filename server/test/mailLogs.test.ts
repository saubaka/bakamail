import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseLogLimit, readMailLogSnapshot, redactLogLine } from "../src/admin/mailLogs.ts";

const container = "maddy";
const now = Date.now();
const sample = () => ({ version: 1, container, source: "docker-logs", capturedAt: new Date(now).toISOString(), truncated: false, lines: ["delivery accepted", "password=hidden", "delivery complete"] });

test("日志条数必须是单一有界整数；敏感日志整行隐藏", () => {
  assert.equal(parseLogLimit(undefined), 200);
  assert.equal(parseLogLimit("2000"), 2000);
  for (const value of ["9", "2001", "NaN", "100.1", "1e3", ["100"], "", "-10"]) assert.equal(parseLogLimit(value), null);
  assert.equal(redactLogLine("smtp password=foo"), "[含认证或邮件内容的日志已隐藏]");
  assert.equal(redactLogLine("x".repeat(1200)).length, 1000);
  assert.equal(redactLogLine("x".repeat(1100) + " token=secret"), "[含认证或邮件内容的日志已隐藏]");
});

test("只读快照保留采样时间、尾部条数、脱敏与过期状态", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bakamail-log-unit-"));
  const path = join(directory, "maddy.json");
  try {
    writeFileSync(path, JSON.stringify(sample()), { mode: 0o600 });
    const result = await readMailLogSnapshot(path, container, 2, now);
    assert.equal(result.available, true);
    assert.equal(result.source, "snapshot");
    assert.equal(result.capturedAt, new Date(now).toISOString());
    assert.deepEqual(result.lines, ["[含认证或邮件内容的日志已隐藏]", "delivery complete"]);
    assert.equal(result.stale, false);
    const stale = await readMailLogSnapshot(path, container, 10, now + 121000);
    assert.equal(stale.stale, true);
    assert.match(stale.hint!, /历史快照/);
    assert.equal((await readMailLogSnapshot(join(directory, "missing.json"), container, 10)).available, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("日志读取拒绝错误身份、未来时间、损坏、过大文件与符号链接", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bakamail-log-invalid-"));
  const path = join(directory, "maddy.json");
  try {
    for (const data of ["broken", JSON.stringify({ ...sample(), container: "other" }),
      JSON.stringify({ ...sample(), capturedAt: new Date(now + 6000).toISOString() }),
      JSON.stringify({ ...sample(), lines: [123] }), JSON.stringify({ ...sample(), lines: ["x".repeat(1001)] }),
      JSON.stringify({ ...sample(), lines: Array(2001).fill("line") }), "x".repeat(2500001)]) {
      writeFileSync(path, data);
      await assert.rejects(readMailLogSnapshot(path, container, 10, now));
    }
    writeFileSync(path, JSON.stringify(sample()));
    const link = join(directory, "link.json");
    symlinkSync(path, link);
    await assert.rejects(readMailLogSnapshot(link, container, 10, now));
    await assert.rejects(readMailLogSnapshot(directory, container, 10, now));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("服务器采集器的脱敏、截断与失败保留行为", () => {
  const output = execFileSync("python3", ["-B", "server/test/fixtures/test-mail-log-export.py"], { encoding: "utf8" });
  assert.match(output, /exporter checks passed/);
});
