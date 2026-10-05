import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { BoundedSerialQueue, CommandExecutionError, MADDY_COMMAND_LIMITS, runBoundedCommand } from "../src/mail/command.ts";

const fixtureDir = mkdtempSync(join(tmpdir(), "bakamail-command-test-"));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const failure = (code: string) => (error: unknown) => error instanceof CommandExecutionError && error.code === code;
const node = (script: string, options: Parameters<typeof runBoundedCommand>[2] = {}) =>
  runBoundedCommand(process.execPath, ["--input-type=module", "-e", script], options);

test("串行队列额度包含正在执行的任务，满额拒绝不会执行，随后按序继续", async () => {
  const queue = new BoundedSerialQueue({ maxPending: 3, waitMs: 1000 });
  const gate = deferred();
  const calls: number[] = [];
  let active = 0, peak = 0;
  const task = (number: number) => queue.run(async () => {
    calls.push(number); active += 1; peak = Math.max(peak, active);
    if (number === 1) await gate.promise;
    active -= 1; return number;
  });
  const first = task(1), second = task(2), third = task(3);
  await assert.rejects(task(4), failure("queue_full"));
  assert.deepEqual(calls, [1]);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second, third]), [1, 2, 3]);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(peak, 1);
  assert.equal(await task(5), 5);
});

test("等待超时移除任务并释放额度，不在旧任务结束后偷偷执行过期任务", async () => {
  const queue = new BoundedSerialQueue({ maxPending: 2, waitMs: 40 });
  const gate = deferred();
  const first = queue.run(async () => { await gate.promise; return "first"; });
  let expiredRan = false;
  const expired = queue.run(async () => { expiredRan = true; });
  await assert.rejects(expired, failure("queue_timeout"));
  const replacement = queue.run(async () => "replacement");
  gate.resolve();
  assert.deepEqual(await Promise.all([first, replacement]), ["first", "replacement"]);
  assert.equal(expiredRan, false);
});

test("任务失败不毒化队列，配置和重试预算有界", async () => {
  const queue = new BoundedSerialQueue();
  const rejected = queue.run(async () => { throw new Error("fixture failure"); });
  const after = queue.run(async () => "next");
  await assert.rejects(rejected, /fixture failure/);
  assert.equal(await after, "next");
  assert.equal(MADDY_COMMAND_LIMITS.maxPending, 32);
  assert.equal(MADDY_COMMAND_LIMITS.attempts, 4);
  for (const value of [0, -1, 1.5, Infinity]) {
    assert.throws(() => new BoundedSerialQueue({ maxPending: value }), RangeError);
    assert.throws(() => new BoundedSerialQueue({ waitMs: value }), RangeError);
  }
});

test("真实子进程完整传递输入、按字节累积多字节输出，非零退出码保留", async () => {
  const result = await node(`import {readFileSync} from "node:fs";
    const input=readFileSync(0,"utf8"); process.stdout.write(input);
    process.stderr.write(Buffer.from([0xe4])); setTimeout(()=>{process.stderr.write(Buffer.from([0xb8,0xad])); process.exitCode=7;},10);`,
  { stdin: "ordinary-fixture-input\n", maxOutputBytes: 64 });
  assert.equal(result.code, 7);
  assert.equal(result.stdout, "ordinary-fixture-input\n");
  assert.equal(result.stderr, "中");
});

test("stdout 与 stderr 共享字节总额度，超额真正终止命令且不返回部分正文", async () => {
  await assert.rejects(node(`process.stdout.write("x".repeat(200)); process.stderr.write("y".repeat(200)); setInterval(()=>{},1000);`,
    { maxOutputBytes: 256, timeoutMs: 2000, killGraceMs: 30 }), failure("output_limit"));
  const next = await node('process.stdout.write("next")');
  assert.equal(next.stdout, "next");
});

test("输入超额和非法额度在启动之前拒绝，不创建标记或泄漏输入", async () => {
  const marker = join(fixtureDir, "must-not-start");
  const script = `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marker)},"started");`;
  await assert.rejects(node(script, { stdin: "secret-fixture".repeat(20), maxStdinBytes: 10 }), error => {
    assert.ok(failure("stdin_limit")(error));
    assert.doesNotMatch(String(error), /secret-fixture/);
    return true;
  });
  for (const timeoutMs of [0, -1, 1.5]) await assert.rejects(node(script, { timeoutMs }), RangeError);
  assert.equal(existsSync(marker), false);
});

test("启动失败和真实输入管道提前关闭不会成为未处理异常，也不阻塞后续任务", async () => {
  await assert.rejects(runBoundedCommand(join(fixtureDir, "missing-private-binary"), []), error => {
    assert.ok(failure("spawn_failed")(error));
    assert.doesNotMatch(String(error), /missing-private-binary/);
    return true;
  });
  await assert.rejects(node("process.stdin.destroy(); process.exit(0);", {
    stdin: "x".repeat(1024 * 1024), maxStdinBytes: 2 * 1024 * 1024,
  }), failure("stdin_failed"));
  assert.equal((await node('process.stdout.write("alive")')).stdout, "alive");
});

async function waitAbsent(pid: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw error; }
    await delay(10);
  }
  throw new Error(`Fixture subprocess ${pid} did not exit`);
}

test("真实命令忽略 TERM 时升级 KILL，进程消失后才允许队列下一个任务", async () => {
  const marker = join(fixtureDir, "stubborn-pid");
  const queue = new BoundedSerialQueue();
  const started = Date.now();
  const task = queue.run(() => node(`import {writeFileSync} from "node:fs";
    process.on("SIGTERM",()=>{}); writeFileSync(${JSON.stringify(marker)},String(process.pid)); setInterval(()=>{},1000);`,
  { timeoutMs: 1000, killGraceMs: 50 }));
  const next = queue.run(async () => {
    assert.ok(existsSync(marker), "the fixture must have installed its TERM handler before timeout");
    const pid = Number(readFileSync(marker, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    await waitAbsent(pid);
    return "next";
  });
  await assert.rejects(task, failure("command_timeout"));
  assert.equal(await next, "next");
  assert.ok(Date.now() - started < 4000);
});

test("POSIX 父进程已退出但后代持有输出管道时，截止仍终止本次进程组", { skip: process.platform === "win32" }, async () => {
  const marker = join(fixtureDir, "descendant-pid");
  const childScript = 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000);';
  await assert.rejects(node(`import {spawn} from "node:child_process"; import {writeFileSync} from "node:fs";
    const child=spawn(process.execPath,["-e",${JSON.stringify(childScript)}],{stdio:["ignore","inherit","inherit"]});
    writeFileSync(${JSON.stringify(marker)},String(child.pid)); process.exit(0);`,
  { timeoutMs: 1000, killGraceMs: 50 }), failure("command_timeout"));
  assert.ok(existsSync(marker));
  const pid = Number(readFileSync(marker, "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  await waitAbsent(pid);
});

test("成功命令清理旧截止计时器，不误伤后来的命令", async () => {
  assert.equal((await node('process.stdout.write("first")', { timeoutMs: 500, killGraceMs: 20 })).stdout, "first");
  const next = await node('setTimeout(()=>process.stdout.write("second"),600)', { timeoutMs: 2000 });
  assert.equal(next.stdout, "second");
});
