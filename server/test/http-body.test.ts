import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { Agent, createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test, { after } from "node:test";

const fixtureDir = mkdtempSync(join(tmpdir(), "bakamail-http-body-"));
process.env.DATA_DIR = fixtureDir;
process.env.SECRET_KEY = "body-parser-isolated-unit-test";
const { readJson, RequestBodyError, sendJson, requestId } = await import("../src/http/kit.ts");
after(() => rmSync(fixtureDir, { recursive: true, force: true }));

function incoming(chunks: Buffer[], headers: Record<string, string> = { "content-type": "application/json" }) {
  const stream = Readable.from(chunks);
  Object.assign(stream, { headers });
  return stream as unknown as IncomingMessage;
}

test("JSON 总额度按 UTF-8 字节累计，边界值通过，不只检查单个块", async () => {
  const raw = Buffer.from('{"x":"中"}');
  const read = incoming([raw.subarray(0, 7), raw.subarray(7)]);
  assert.deepEqual(await readJson(read, { maxBytes: raw.length }), { x: "中" });
  const oversized = incoming([raw.subarray(0, 7), raw.subarray(7)]);
  await assert.rejects(readJson(oversized, { maxBytes: raw.length - 1 }), error =>
    error instanceof RequestBodyError && error.status === 413 && error.closeConnection);
  assert.equal(oversized.destroyed, false, "rejection must not destroy the transport before its reply");
  oversized.destroy();
});

test("Content-Length 超额在读取之前拒绝，非法额度是内部配置错误", async () => {
  const read = incoming([Buffer.from("{}")], { "content-type": "application/json", "content-length": "100" });
  await assert.rejects(readJson(read, { maxBytes: 10 }), error => error instanceof RequestBodyError && error.status === 413);
  assert.equal(read.readableLength, 0);
  assert.equal(read.destroyed, false);
  read.destroy();
  const empty = incoming([]);
  for (const maxBytes of [0, -1, 1.5, 49 * 1024 * 1024]) await assert.rejects(readJson(empty, { maxBytes }), RangeError);
  empty.destroy();
});

test("无效 UTF-8 不能经替换字符绕过 JSON 验证，空体无需内容类型", async () => {
  const malformed = incoming([Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])]);
  await assert.rejects(readJson(malformed), error => error instanceof RequestBodyError && error.code === "invalid_json");
  assert.deepEqual(await readJson(incoming([], {})), {});
  assert.deepEqual(await readJson(incoming([Buffer.from("{}")], { "content-type": 'Application/JSON; charset="UTF-8"' })), {});
});

test("请求编号只允许安全有界字符，同一请求每次取值一致", () => {
  for (const supplied of ["a".repeat(65), "unsafe\nvalue", "unsafe value", ""]) {
    const read = incoming([], { "x-request-id": supplied });
    const id = requestId(read);
    assert.match(id, /^[a-f0-9-]{36}$/);
    assert.equal(requestId(read), id);
    read.destroy();
  }
  const read = incoming([], { "x-request-id": "valid-test:2026._-" });
  assert.equal(requestId(read), "valid-test:2026._-");
  read.destroy();
});

test("真实回环 HTTP：声明超额和分块超额都先得到 JSON 413，再关闭连接", async () => {
  let reads = 0;
  const directAgent = new Agent();
  const server = createServer(async (request, response) => {
    try {
      await readJson(request, { maxBytes: 16 });
      reads += 1;
      sendJson(response, 200, { ok: true });
    } catch (error) {
      assert.ok(error instanceof RequestBodyError);
      if (error.closeConnection) response.setHeader("connection", "close");
      sendJson(response, error.status, { ok: false, data: null, code: error.code, error: error.message });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const declared of [true, false]) {
      const result = await new Promise<{ status: number; connection: string | undefined; body: string }>((resolve, reject) => {
        const client = httpRequest({ agent: directAgent, hostname: "127.0.0.1", port: address.port, method: "POST",
          headers: { "content-type": "application/json", ...(declared ? { "content-length": "1000000" } : {}) } }, response => {
          const chunks: Buffer[] = [];
          response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => {
            resolve({ status: response.statusCode ?? 0, connection: response.headers.connection, body: Buffer.concat(chunks).toString() });
            client.destroy();
          });
          response.on("error", reject);
        });
        client.on("error", reject);
        client.setTimeout(2000, () => client.destroy(new Error("413 did not arrive before the rest of the body")));
        client.write('{"text":"' + "x".repeat(24));
        // Intentionally never end/send the remaining body: rejection must be prompt.
      });
      assert.equal(result.status, 413);
      assert.equal(result.connection, "close");
      assert.equal(JSON.parse(result.body).code, "payload_too_large");
    }
    assert.equal(reads, 0);
  } finally {
    directAgent.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
