import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory, createRouter } from "vue-router";
import { adminPathProblem, adminPagePaths, configureAdminPaths, safeAdminDestination, LEGACY_ADMIN_BASE } from "../../shared/adminPaths.ts";
import { createAdminRoutes } from "../src/auth/adminRoutes.ts";

test("自定义路径严格限制为无碰撞的单层字面路径", () => {
  for (const base of ["/my-console", "/admin_2026", "/abc"]) assert.equal(adminPathProblem(base), "");
  for (const base of ["/admin", "/mail", "/api", "/setup", "/assets", "/login", "/test", "/ABCD", "/a", "/123", "/foo/bar", "/foo/", "/foo?bar", "/foo%20bar", "//evil.test", "/foo\\bar", null]) assert.ok(adminPathProblem(base), String(base));
});

test("动态路由保留名称和权限，回跳严格绑定当前已保存路径而不是静态默认值", () => {
  const base = "/private-console";
  configureAdminPaths(base);
  try {
    const router = createRouter({ history: createMemoryHistory(), routes: [...createAdminRoutes(base), { path: "/:pathMatch(.*)*", name: "not-found", component: {} }] });
    assert.equal(router.resolve(base).name, "admin-login");
    assert.equal(router.resolve(base).meta.auth, undefined);
    for (const path of Object.values(adminPagePaths(base))) {
      assert.equal(router.resolve(path).meta.auth, "admin");
      assert.ok(router.resolve(path).meta.permission);
      assert.equal(safeAdminDestination(path), path);
    }
    assert.equal(router.resolve({ name: "admin-system" }).path, `${base}/system`);
    assert.equal(router.resolve(`${LEGACY_ADMIN_BASE}/system`).name, "not-found");
    assert.equal(safeAdminDestination(`${LEGACY_ADMIN_BASE}/system`), `${base}/overview`);
    assert.equal(safeAdminDestination(`${base}/system?tab=theme#display`), `${base}/system?tab=theme#display`);
    assert.equal(safeAdminDestination(`${base}/%73ystem`), `${base}/overview`);
  } finally { configureAdminPaths(LEGACY_ADMIN_BASE); }
});
