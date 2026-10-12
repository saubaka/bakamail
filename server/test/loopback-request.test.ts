import assert from "node:assert/strict";
import test from "node:test";
import request from "./support/loopback-request.ts";

// 测试服务器必须只监听 127.0.0.1：通配监听会和同一台电脑上别的程序在同一端口共存，请求可能被别人应答。
const seen = (calls: string[]) => (req: { socket: { localAddress?: string } }, res: { end: (body: string) => void }) => {
  calls.push(String(req.socket.localAddress));
  res.end("ok");
};

test("request(app) 的临时服务器只绑定 127.0.0.1", async () => {
  const calls: string[] = [];
  const response = await request(seen(calls)).get("/");
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["127.0.0.1"]);
});

test("request.agent(app) 同样只绑定 127.0.0.1，且可重复请求", async () => {
  const calls: string[] = [];
  const agent = request.agent(seen(calls));
  assert.equal((await agent.get("/")).status, 200);
  assert.equal((await agent.get("/again")).status, 200);
  assert.deepEqual(calls, ["127.0.0.1", "127.0.0.1"]);
});

test("并行请求各自拿到独立端口，互不干扰", async () => {
  const calls: string[] = [];
  const handler = seen(calls);
  const results = await Promise.all(Array.from({ length: 8 }, () => request(handler).get("/")));
  assert.deepEqual(results.map((r) => r.status), Array(8).fill(200));
  assert.equal(calls.length, 8);
});
