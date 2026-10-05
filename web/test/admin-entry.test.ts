import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryHistory, createRouter } from "vue-router";
import { ADMIN_LOGIN_PATH, ADMIN_PAGE_PATHS, isRetiredAdminPath, safeAdminDestination } from "../../shared/adminPaths.ts";
import { adminRoutes } from "../src/auth/adminRoutes.ts";
import { checkAdminEntry } from "../src/auth/adminEntryGate.ts";
import { ApiError } from "../src/api/client.ts";
import { SessionSupersededError } from "../src/auth/sessionRequests.ts";

const matcher = createRouter({ history: createMemoryHistory(), routes: [
  ...adminRoutes,
  { path: "/:pathMatch(.*)*", name: "not-found", component: {} },
] });

test("唯一管理员登录入口与后台子页准确匹配，根入口不继承后台鉴权", () => {
  assert.equal(matcher.resolve(ADMIN_LOGIN_PATH).name, "admin-login");
  assert.equal(matcher.resolve(ADMIN_LOGIN_PATH).meta.auth, undefined);
  for (const path of Object.values(ADMIN_PAGE_PATHS)) {
    const result = matcher.resolve(path);
    assert.equal(result.meta.auth, "admin", path);
    assert.equal(result.matched.length, 2, path);
    assert.ok(result.meta.permission, path);
  }
  assert.equal(matcher.resolve({ name: "admin-system" }).path, ADMIN_PAGE_PATHS.system);
});

test("旧后台路由无别名/重定向，未登记的新后台路径也不能显示登录", () => {
  for (const path of ["/admin", "/admin/login", "/admin/overview", "/bakaadmin/login", "/bakaadmin/unknown"]) {
    const result = matcher.resolve(path);
    assert.equal(result.name, "not-found", path);
    assert.equal(result.meta.auth, undefined);
    assert.equal(result.redirectedFrom, undefined);
  }
});

test("后台回跳只接受已登记路径，保留合法查询与锚点", () => {
  for (const path of Object.values(ADMIN_PAGE_PATHS)) assert.equal(safeAdminDestination(path), path);
  const deep = `${ADMIN_PAGE_PATHS.security}?tab=sessions#active`;
  assert.equal(safeAdminDestination(deep), deep);
  assert.equal(safeAdminDestination(`${ADMIN_LOGIN_PATH}?redirect=%2Fbakaadmin%2Fsystem`, true), `${ADMIN_LOGIN_PATH}?redirect=%2Fbakaadmin%2Fsystem`);
  assert.equal(safeAdminDestination(ADMIN_LOGIN_PATH), ADMIN_PAGE_PATHS.overview);
});

test("拒绝外站、前缀伪装、未知页、编码路径、点段、控制字符和非字符串回跳", () => {
  for (const value of [
    "https://evil.test/bakaadmin/system", "//evil.test", "/admin/system", "/bakaadminister/system",
    "/bakaadmin/login", "/bakaadmin/unknown", "/bakaadmin/overview/", "/bakaadmin//overview",
    "/bakaadmin/%6fverview", "/bakaadmin/../mail", "/bakaadmin/overview?bad=%ZZ",
    "/bakaadmin/overview?bad=%0A", "/bakaadmin/overview?bad=%5c", "/bakaadmin/overview\\evil",
    "/bakaadmin/overview\n", ["/bakaadmin/system"], null, undefined,
  ]) assert.equal(safeAdminDestination(value), ADMIN_PAGE_PATHS.overview, String(value));
});

test("停用旧页面路径时不影响管理 API 或相似名字", () => {
  for (const value of ["/admin", "/admin/login?q=1", "/ADMIN/security", "/%61dmin/login", "/admin%2flogin", "/foo/../admin/overview"]) assert.equal(isRetiredAdminPath(value), true, value);
  for (const value of [ADMIN_LOGIN_PATH, "/api/admin/auth/me", "/administrator", "/mail/admin"]) assert.equal(isRetiredAdminPath(value), false, value);
});

test("匿名与过期后台会话清理独立管理员身份并保留新地址目的地", async () => {
  for (const message of ["未登录", "会话过期"]) {
    let cleared = 0;
    const destination = `${ADMIN_PAGE_PATHS.system}?tab=theme`;
    assert.deepEqual(await checkAdminEntry(async () => { throw new ApiError(message, 401, null); }, () => { cleared++; }, destination), {
      path: ADMIN_LOGIN_PATH, query: { redirect: destination },
    });
    assert.equal(cleared, 1);
  }
});

test("后台会话成功、故障和被新会话取代分开处理", async () => {
  const clear = () => { throw Error("不得清除现有会话"); };
  assert.equal(await checkAdminEntry(async () => ({}), clear, ADMIN_PAGE_PATHS.accounts), true);
  for (const status of [0, 429, 503]) {
    assert.deepEqual(await checkAdminEntry(async () => { throw new ApiError("暂不可用", status, null); }, clear, ADMIN_PAGE_PATHS.accounts), {
      name: "unavailable", query: { redirect: ADMIN_PAGE_PATHS.accounts },
    });
  }
  assert.equal(await checkAdminEntry(async () => { throw new SessionSupersededError(); }, clear, ADMIN_PAGE_PATHS.accounts), false);
});

test("真实后台跳转与登录恢复使用统一回跳，不再残留旧页面字符串", () => {
  const files = ["router.ts", "views/admin/AdminLoginView.vue", "views/admin/AdminShell.vue", "views/admin/OverviewView.vue", "views/ServiceUnavailableView.vue"];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /["']\/admin(?:\/|["'])/, file);
  }
  const router = readFileSync(new URL("../src/router.ts", import.meta.url), "utf8");
  assert.match(router, /checkAdminEntry\(\(\) => session\.restore\(true\)/);
  const login = readFileSync(new URL("../src/views/admin/AdminLoginView.vue", import.meta.url), "utf8");
  assert.match(login, /router\.push\(safeAdminDestination\(route\.query\.redirect\)\)/);
  assert.match(login, /router\.replace\(safeAdminDestination\(route\.query\.redirect\)\)/);
});
