import assert from "node:assert/strict";
import test from "node:test";
import {
  changeAdminRole, createAdminUser, listAdminUsers, resetAdminUserPassword, resetAdminUserTotp, setAdminUserActive,
} from "../src/api/admin.ts";
import { setCsrfToken } from "../src/api/client.ts";

test("管理员账号请求只走统一客户端，变更携带管理员 CSRF", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: unknown; csrf: string | null }> = [];
  setCsrfToken("admin-test-token", "admin");
  globalThis.fetch = async (input, options) => {
    calls.push({
      path: String(input),
      method: options?.method ?? "GET",
      body: options?.body ? JSON.parse(String(options.body)) : null,
      csrf: new Headers(options?.headers).get("x-csrf-token"),
    });
    return Response.json({ ok: true, data: { admins: [], currentRole: "superadmin", id: 2 }, error: "" });
  };
  try {
    await listAdminUsers();
    await createAdminUser({ username: "qa-admin", password: "test-password-123", role: "auditor" });
    await changeAdminRole(2, "admin");
    await setAdminUserActive(2, false);
    await resetAdminUserPassword(2, "new-password-123");
    await resetAdminUserTotp(2);
    assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
      ["/api/admin/admins", "GET"],
      ["/api/admin/admins", "POST"],
      ["/api/admin/admins/2", "PATCH"],
      ["/api/admin/admins/2", "PATCH"],
      ["/api/admin/admins/2", "PATCH"],
      ["/api/admin/admins/2", "PATCH"],
    ]);
    assert.equal(calls[0]?.csrf, null);
    assert.deepEqual(calls.slice(1).map(({ csrf }) => csrf), Array(5).fill("admin-test-token"));
    assert.deepEqual(calls[2]?.body, { role: "admin" });
    assert.deepEqual(calls[3]?.body, { active: false });
    assert.deepEqual(calls[4]?.body, { password: "new-password-123" });
    assert.deepEqual(calls[5]?.body, { resetTotp: true });
  } finally {
    setCsrfToken("", "admin");
    globalThis.fetch = originalFetch;
  }
});

test("无效管理员 ID 在发出请求前被拒绝", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("不应发出网络请求"); };
  try {
    for (const id of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      assert.throws(() => changeAdminRole(id, "auditor"), TypeError);
      assert.throws(() => setAdminUserActive(id, false), TypeError);
      assert.throws(() => resetAdminUserPassword(id, "password"), TypeError);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
