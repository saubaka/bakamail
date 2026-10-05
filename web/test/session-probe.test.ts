import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api/client.ts";
import { probeLoginSession } from "../src/auth/sessionProbe.ts";

test("两个登录入口只将 401 当作未登录，成功探测使用各自接口", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  let status = 401;
  globalThis.fetch = async (input) => {
    paths.push(String(input));
    return Response.json(status === 200 ? { ok: true, data: {}, error: "" } : { ok: false, error: "未登录" }, { status });
  };
  try {
    assert.equal(await probeLoginSession("mail"), false);
    assert.equal(await probeLoginSession("admin"), false);
    status = 200;
    assert.equal(await probeLoginSession("mail"), true);
    assert.equal(await probeLoginSession("admin"), true);
    assert.deepEqual(paths, ["/api/auth/me", "/api/admin/auth/me", "/api/auth/me", "/api/admin/auth/me"]);
  } finally { globalThis.fetch = original; }
});

test("登录探测 503 不吞掉错误，服务恢复后可重新探测", async () => {
  const original = globalThis.fetch;
  let status = 503;
  globalThis.fetch = async () => Response.json(status === 200
    ? { ok: true, data: {}, error: "" } : { ok: false, error: "暂不可用" }, { status });
  try {
    for (const scope of ["mail", "admin"] as const) {
      await assert.rejects(probeLoginSession(scope), (error) => error instanceof ApiError && error.status === 503);
    }
    status = 200;
    assert.equal(await probeLoginSession("mail"), true);
  } finally { globalThis.fetch = original; }
});

test("登录探测网络异常仍为故障，不伪报退出", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  try {
    for (const scope of ["mail", "admin"] as const) {
      await assert.rejects(probeLoginSession(scope), (error) => error instanceof ApiError && error.status === 0);
    }
  } finally { globalThis.fetch = original; }
});
