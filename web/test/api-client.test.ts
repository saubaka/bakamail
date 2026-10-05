import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, api, apiDownload, assertApiPath, setCsrfToken } from "../src/api/client.ts";

test("API 客户端只接受同源 /api/* 路径", () => {
  for (const path of ["/api/mail/messages", "/api/admin/backup", "/api/mail/messages?folder=INBOX"]) {
    assert.doesNotThrow(() => assertApiPath(path));
  }
  for (const path of [
    "https://mail.example.test/api/mail", "//other.example/api/mail", "/admin/backup",
    "/api/", "/api/../admin", "/api/%2e%2e/admin", "/api\\admin", "/api/mail#fragment",
  ]) {
    assert.throws(() => assertApiPath(path), TypeError, path);
  }
});

test("请求使用同源凭据、request-id，并按普通/管理员作用域发送 CSRF", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; options: RequestInit }> = [];
  setCsrfToken("mail-token", "mail");
  setCsrfToken("admin-token", "admin");
  globalThis.fetch = async (input, options) => {
    calls.push({ path: String(input), options: options ?? {} });
    return Response.json({ ok: true, data: { saved: true }, error: "" });
  };
  try {
    await api("/api/mail/preferences", { method: "PATCH", body: { theme: "light" } });
    await api("/api/admin/site-settings", { method: "PATCH", body: { siteName: "BakaMail" } });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.path, "/api/mail/preferences");
    assert.equal(calls[1]?.path, "/api/admin/site-settings");
    for (const { options } of calls) {
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.ok(new Headers(options.headers).get("x-request-id"));
      assert.equal(new Headers(options.headers).get("content-type"), "application/json");
    }
    assert.equal(new Headers(calls[0]?.options.headers).get("x-csrf-token"), "mail-token");
    assert.equal(new Headers(calls[1]?.options.headers).get("x-csrf-token"), "admin-token");
  } finally {
    setCsrfToken("", "mail");
    setCsrfToken("", "admin");
    globalThis.fetch = originalFetch;
  }
});

test("服务端错误和网络错误保留结构化诊断信息", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { ok: false, data: { fieldErrors: { username: "已占用" } }, error: "请稍后重试", code: "rate_limited" },
    { status: 429, headers: { "retry-after": "30", "x-request-id": "server-request" } },
  );
  try {
    await assert.rejects(api("/api/auth/register"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "rate_limited");
      assert.equal(error.requestId, "server-request");
      assert.equal(error.retryAfterSeconds, 30);
      assert.deepEqual(error.data, { fieldErrors: { username: "已占用" } });
      return true;
    });
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(api("/api/auth/me"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.equal(error.code, "network_error");
      assert.ok(error.requestId);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("无效 JSON 响应不能被当成成功", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>bad gateway</html>", { status: 200 });
  try {
    await assert.rejects(api("/api/auth/me"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "invalid_response");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("备份下载走同一请求边界并清理响应文件名", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPath = "";
  globalThis.fetch = async (input, options) => {
    requestedPath = String(input);
    assert.equal(options?.credentials, "same-origin");
    assert.equal(options?.cache, "no-store");
    return new Response("backup", {
      headers: {
        "content-disposition": 'attachment; filename="../bakamail-backup.json"',
        "x-backup-generated-at": "2026-09-25T12:00:00.000Z",
      },
    });
  };
  try {
    const result = await apiDownload("/api/admin/backup");
    assert.equal(requestedPath, "/api/admin/backup");
    assert.equal(result.filename, "bakamail-backup.json");
    assert.equal(result.generatedAt, "2026-09-25T12:00:00.000Z");
    assert.equal(await result.blob.text(), "backup");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("下载接口误返回 SPA 网页时不保存为备份", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>index</html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  try {
    await assert.rejects(apiDownload("/api/admin/backup"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "invalid_response");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
