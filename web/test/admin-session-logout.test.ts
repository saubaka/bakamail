import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { setCsrfToken } from "../src/api.ts";
import { useAdminSessionStore } from "../src/stores/adminSession.ts";

function seededSession() {
  setActivePinia(createPinia());
  const session = useAdminSessionStore();
  session.me = {
    username: "qa-admin", displayName: "界面验收", role: "superadmin",
    permissions: ["*"], csrfToken: "admin-qa-csrf",
    runner: "disabled", statsAvailable: false,
  };
  session.initialized = true;
  setCsrfToken("admin-qa-csrf", "admin");
  return session;
}

test("管理员退出遇到 503 时保留会话和 CSRF，允许重试", async () => {
  const originalFetch = globalThis.fetch;
  const session = seededSession();
  let attempts = 0;
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), "/api/admin/auth/logout");
    assert.equal(new Headers(options?.headers).get("x-csrf-token"), "admin-qa-csrf");
    attempts += 1;
    if (attempts === 1) return Response.json({ ok: false, data: null, error: "模拟服务故障" }, { status: 503 });
    return Response.json({ ok: true, data: { loggedOut: true }, error: "" });
  };
  try {
    await assert.rejects(session.logout(), /模拟服务故障/);
    assert.equal(session.me?.username, "qa-admin");
    assert.equal(session.can("system.admin.write"), true);
    await session.logout();
    assert.equal(attempts, 2);
    assert.equal(session.me, null);
  } finally {
    session.clear();
    globalThis.fetch = originalFetch;
  }
});

test("管理员退出返回 401 时按已失效会话清理本地状态", async () => {
  const originalFetch = globalThis.fetch;
  const session = seededSession();
  globalThis.fetch = async () => Response.json({ ok: false, data: null, error: "未登录" }, { status: 401 });
  try {
    await session.logout();
    assert.equal(session.me, null);
    assert.equal(session.can("system.admin.write"), false);
  } finally {
    session.clear();
    globalThis.fetch = originalFetch;
  }
});
