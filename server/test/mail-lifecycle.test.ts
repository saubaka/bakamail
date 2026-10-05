import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTcpServer, type Socket, type Server } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import { spawnSync } from "node:child_process";
import { MailDeadlineError, withMailDeadline } from "../src/mail/deadline.ts";

const directory = mkdtempSync(join(tmpdir(), "bakamail-lifecycle-"));
process.env.DATA_DIR = directory;
process.env.SECRET_KEY = "lifecycle-tests-only";
const { config } = await import("../src/config.ts");
const { MailboxSession } = await import("../src/mail/session.ts");
const { putSession, getSession, dropSession, dropSessionsForMailbox } = await import("../src/mail/registry.ts");
after(() => rmSync(directory, { recursive: true, force: true }));

async function until(predicate: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("fixture observation timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withServer(server: Server, sockets: Set<Socket>, job: () => Promise<void>): Promise<void> {
  const previous = { host: config.mail.host, port: config.mail.imapPort, reject: config.mail.tlsRejectUnauthorized };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  config.mail.host = "127.0.0.1";
  config.mail.imapPort = address.port;
  config.mail.tlsRejectUnauthorized = false; // Self-signed loopback fixture only, never deployed configuration.
  try { await job(); } finally {
    config.mail.host = previous.host;
    config.mail.imapPort = previous.port;
    config.mail.tlsRejectUnauthorized = previous.reject;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function track(socket: Socket, sockets: Set<Socket>): void {
  sockets.add(socket);
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
}

test("IMAP TLS 连接超时会关闭真实 TCP 对端，不偷偷重连", async () => {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createTcpServer((socket) => { connections += 1; track(socket, sockets); socket.resume(); });
  await withServer(server, sockets, async () => {
    const session = new MailboxSession("tls-stall", "qa@local.test", "not-real", { connectionTimeoutMs: 150, authenticationTimeoutMs: 500 });
    const started = Date.now();
    await assert.rejects(session.ping(), MailDeadlineError);
    assert.ok(Date.now() - started < 1500);
    await until(() => connections === 1 && sockets.size === 0);
    await session.close();
    assert.equal(connections, 1);
  });
});

test("连接尚未完成时关闭会话会取消请求，后续操作不创建新连接", async () => {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createTcpServer((socket) => { connections += 1; track(socket, sockets); socket.resume(); });
  await withServer(server, sockets, async () => {
    const session = new MailboxSession("cancel-connecting", "qa@local.test", "not-real");
    const rejection = assert.rejects(session.ping());
    await until(() => sockets.size === 1);
    const started = Date.now();
    await session.close();
    await rejection;
    await until(() => sockets.size === 0);
    assert.ok(Date.now() - started < 1000);
    await assert.rejects(session.folders(), /会话已关闭/);
    assert.equal(connections, 1);
  });
});

test("关闭会话同时取消正在连接的 IDLE，不再发重连状态或创建第二条连接", async () => {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createTcpServer((socket) => { connections += 1; track(socket, sockets); socket.resume(); });
  await withServer(server, sockets, async () => {
    const session = new MailboxSession("cancel-idle", "qa@local.test", "not-real");
    const states: string[] = [];
    session.onEvent((event) => { if (event.type === "state") states.push(event.status); });
    session.startIdle();
    await until(() => sockets.size === 1);
    await session.close();
    await until(() => sockets.size === 0);
    session.startIdle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(states, ["closed"]);
    assert.equal(connections, 1);
  });
});

function imapFixture(stallNoop: boolean): { server: Server; sockets: Set<Socket>; commands: string[] } {
  const key = join(directory, "fixture.key");
  const cert = join(directory, "fixture.crt");
  const generated = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key,
    "-out", cert, "-days", "1", "-subj", "/CN=local.test"], { encoding: "utf8" });
  assert.equal(generated.status, 0);
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const server = createTlsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (socket) => {
    track(socket, sockets);
    // PREAUTH is only a loopback protocol fixture: no production credentials or mail server is involved.
    socket.write("* PREAUTH [CAPABILITY IMAP4rev1] fixture ready\r\n");
    let buffer = "";
    socket.on("data", (bytes) => {
      buffer += bytes.toString();
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [tag, verb] = line.split(" ");
        commands.push(verb);
        if (verb === "LOGOUT" || (verb === "NOOP" && stallNoop)) continue;
        if (verb === "CAPABILITY") socket.write("* CAPABILITY IMAP4rev1\r\n");
        if (verb === "LIST") socket.write('* LIST (\\Noselect) "/" ""\r\n');
        socket.write(`${tag} OK fixture\r\n`);
      }
    });
  });
  server.on("tlsClientError", () => {});
  return { server, sockets, commands };
}

test("登录总时限涵盖已连通 TLS 后卡住的 NOOP，超时后真实连接释放", async () => {
  const fixture = imapFixture(true);
  await withServer(fixture.server, fixture.sockets, async () => {
    const session = new MailboxSession("noop-stall", "qa@local.test", "not-real", { connectionTimeoutMs: 1000, authenticationTimeoutMs: 350 });
    await assert.rejects(session.ping(), (error) => error instanceof MailDeadlineError && error.message === "邮局登录校验超时");
    assert.ok(fixture.commands.includes("NOOP"));
    await until(() => fixture.sockets.size === 0);
    await assert.rejects(session.ping(), /会话已关闭/);
  });
});

test("已连通会话关闭不等待无响应 LOGOUT，关闭后操作被拒绝", async () => {
  const fixture = imapFixture(false);
  await withServer(fixture.server, fixture.sockets, async () => {
    const session = new MailboxSession("healthy-close", "qa@local.test", "not-real");
    await session.ping();
    const started = Date.now();
    await session.close();
    await until(() => fixture.sockets.size === 0);
    assert.ok(Date.now() - started < 1000);
    assert.equal(fixture.commands.includes("LOGOUT"), false);
    await assert.rejects(session.folders(), /会话已关闭/);
  });
});

test("关闭会话立即取消正在执行与排队的操作，不等待底层命令返回", async () => {
  const fixture = imapFixture(true);
  await withServer(fixture.server, fixture.sockets, async () => {
    const session = new MailboxSession("queued-close", "qa@local.test", "not-real");
    const ping = assert.rejects(session.ping());
    await until(() => fixture.commands.includes("NOOP"));
    const listCount = fixture.commands.filter((verb) => verb === "LIST").length;
    const queued = assert.rejects(session.folders(), /会话已关闭/);
    const started = Date.now();
    await session.close();
    await Promise.all([ping, queued]);
    await until(() => fixture.sockets.size === 0);
    assert.ok(Date.now() - started < 1000);
    assert.equal(fixture.commands.filter((verb) => verb === "LIST").length, listCount);
  });
});

test("连接状态回调中关闭会话不会遗留刚激活的连接或开始后续命令", async () => {
  const fixture = imapFixture(false);
  await withServer(fixture.server, fixture.sockets, async () => {
    const session = new MailboxSession("activation-close", "qa@local.test", "not-real");
    const states: string[] = [];
    session.onEvent((event) => {
      if (event.type !== "state") return;
      states.push(event.status);
      if (event.status === "connected") void session.close();
    });
    await assert.rejects(session.ping(), /会话已关闭/);
    await until(() => fixture.sockets.size === 0);
    assert.deepEqual(states, ["connected", "closed"]);
    assert.equal(fixture.commands.includes("NOOP"), false);
  });
});

test("截止任务成功不触发迟到关闭；超时关闭抛错也不丢失稳定错误", async () => {
  let aborted = 0;
  assert.equal(await withMailDeadline(async () => 42, 20, () => { aborted += 1; }, "expired"), 42);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(aborted, 0);
  await assert.rejects(withMailDeadline(() => new Promise(() => {}), 20, () => { throw new Error("close failed"); }, "expired"), MailDeadlineError);
});

test("账号的多个会话并行关闭并提前全部移出注册表，不影响其他账号", async () => {
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ids = ["parallel-close-a", "parallel-close-b", "parallel-close-c"];
  for (const id of ids) {
    const session = new MailboxSession(id, "parallel@local.test", "not-real");
    session.close = async () => { started.push(id); await gate; };
    putSession(session);
  }
  const other = new MailboxSession("other-account", "other@local.test", "not-real");
  putSession(other);
  const closing = dropSessionsForMailbox("parallel@local.test");
  try {
    await until(() => started.length === 3);
    assert.ok(ids.every((id) => !getSession(id)));
    assert.equal(getSession(other.id), other);
    release();
    assert.equal(await closing, 3);
  } finally { release(); await closing; await dropSession(other.id); }
});
