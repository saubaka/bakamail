import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { api, onApiActivity } from "../src/api/client.ts";
import { FINISH_HOLD_MS, GRACE_MS, START_DELAY_MS, TRICKLE_CEILING, nextProgress } from "../src/admin/progressLine.ts";
import { beginAdminNavigation, clearAdminNavigation, navigationState } from "../src/admin/navigationState.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("界面请求在途数量实时通知，成功、失败、取消都会归还；quiet 的后台刷新不计入", async () => {
  const originalFetch = globalThis.fetch;
  const seen: number[] = [];
  const stop = onApiActivity((count) => seen.push(count));
  let release: (() => void) | undefined;
  try {
    globalThis.fetch = (() => new Promise<Response>((resolve) => { release = () => resolve(Response.json({ ok: true, data: 1, error: "" })); })) as typeof fetch;
    const pending = api("/api/admin/overview");
    assert.deepEqual(seen, [1], "counted as soon as the request starts");
    release!();
    await pending;
    assert.deepEqual(seen, [1, 0]);

    seen.length = 0;
    globalThis.fetch = (async () => Response.json({ ok: true, data: {}, error: "" })) as typeof fetch;
    await api("/api/admin/nav-badges", { quiet: true });
    assert.deepEqual(seen, [], "quiet requests never touch the counter");

    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    await assert.rejects(api("/api/admin/overview"));
    assert.deepEqual(seen, [1, 0], "a failed request is still released");

    seen.length = 0;
    const controller = new AbortController();
    globalThis.fetch = ((_: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
    const aborted = api("/api/admin/overview", { signal: controller.signal });
    controller.abort();
    await assert.rejects(aborted);
    assert.deepEqual(seen, [1, 0], "an aborted request is released too");
  } finally {
    stop();
    globalThis.fetch = originalFetch;
  }
  // 取消订阅之后不再通知
  seen.length = 0;
  globalThis.fetch = (async () => Response.json({ ok: true, data: {}, error: "" })) as typeof fetch;
  try { await api("/api/admin/overview"); } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(seen, []);
});

test("加载线进度：先快后慢、单调不减、永远到不了 100%，由完成动作补满", () => {
  let value = 0.16;
  const trail: number[] = [];
  for (let i = 0; i < 80; i += 1) { const next = nextProgress(value); assert.ok(next >= value, "never goes backwards"); value = next; trail.push(value); }
  assert.ok(value < 1 && value <= TRICKLE_CEILING + 1e-9);
  assert.ok(trail[0]! - 0.16 > trail[20]! - trail[19]!, "early steps are larger than late steps");
  assert.equal(nextProgress(TRICKLE_CEILING), TRICKLE_CEILING);
  assert.equal(nextProgress(0.99), TRICKLE_CEILING, "the crawl never goes past the ceiling; only finishing fills the line");
  assert.ok(START_DELAY_MS >= 50 && START_DELAY_MS <= 200, "quick actions do not flash the line");
  assert.ok(GRACE_MS > 0 && FINISH_HOLD_MS > 0);
});

test("页面切换的进行中状态：开始时记下目标，清除后恢复为空", () => {
  clearAdminNavigation();
  assert.equal(navigationState.pending, "");
  beginAdminNavigation("admin-security", "/bakaadmin/security");
  assert.deepEqual({ ...navigationState }, { pending: "admin-security", pendingPath: "/bakaadmin/security" });
  beginAdminNavigation(undefined, "/bakaadmin/x");
  assert.equal(navigationState.pending, "", "a route without a name highlights nothing");
  clearAdminNavigation();
  assert.deepEqual({ ...navigationState }, { pending: "", pendingPath: "" });
});

test("路由守卫：先有一个同步守卫立即记下目标；成功的导航清除，被取代的不清；身份校验仍然每次都做", () => {
  const router = source("router.ts");
  const syncGuard = router.indexOf("router.beforeEach((to, from) => {");
  const asyncGuard = router.indexOf("router.beforeEach(async (to, from) => {");
  assert.ok(syncGuard > 0 && asyncGuard > syncGuard, "the synchronous guard is registered first");
  assert.match(router, /if \(to\.meta\.auth === "admin" && to\.fullPath !== from\.fullPath\) beginAdminNavigation\(to\.name, to\.fullPath\)/);
  assert.match(router, /router\.afterEach\(\(_to, _from, failure\) => \{\s*if \(!failure \|\| !isNavigationFailure\(failure, NavigationFailureType\.cancelled\)\) clearAdminNavigation\(\);/);
  assert.match(router, /router\.onError\(\(error\) => \{\s*clearAdminNavigation\(\);/);
  // 每次后台页面切换仍然向服务端强制校验身份。
  assert.match(router, /checkAdminEntry\(\(\) => session\.restore\(true\)/);
  // 入口路径只在后台页面之间切换、且一分钟内已确认过时才复用，其他情况照旧检查。
  assert.match(router, /const ENTRY_RECHECK_MS = 60_000/);
  assert.match(router, /to\.meta\.auth === "admin" && from\.meta\.auth === "admin" && installationReady\s*\n?\s*&& Date\.now\(\) - entryCheckedAt < ENTRY_RECHECK_MS/);
  assert.match(router, /if \(!reuseEntryCheck && to\.name !== "unavailable"/);
  assert.match(router, /entryCheckedAt = Date\.now\(\)/);
});

test("外壳：菜单跟随目标页立即高亮，顶部加载线覆盖校验等待和页面请求，新页面入场动画不被提前截断", () => {
  const shell = source("views/admin/AdminShell.vue");
  assert.match(shell, /:pending="navigationState\.pending"/);
  assert.match(shell, /<AdminProgressLine :active="busy" \/>/);
  assert.match(shell, /Boolean\(navigationState\.pending\) \|\| requestsInFlight\.value > 0/);
  assert.match(shell, /onApiActivity\(/);
  assert.match(shell, /:aria-busy="busy \? 'true' : 'false'"/);
  assert.match(shell, /name="admin-panel" mode="out-in" :duration="\{ enter: 700, leave: 140 \}"/);
  const rail = source("components/admin/AdminRail.vue");
  assert.match(rail, /const active = computed\(\(\) => props\.pending \|\| props\.current\)/);
  assert.match(rail, /'is-current': active === item\.name/);
  assert.match(source("admin/useRailBadges.ts"), /\{ quiet: true \}/);
});

test("加载线与入场动画样式：纯色、只用令牌、减少动画时关闭，且不改变既有的面板过渡规则", () => {
  const css = source("styles/admin.css");
  const block = css.slice(css.indexOf("顶部加载线"));
  assert.doesNotMatch(block, /gradient/i);
  assert.doesNotMatch(block, /#[\da-f]{3,8}\b|rgba?\(/i);
  assert.match(block, /\.admin-progress__bar \{[^}]*background: var\(--blue-600\)/);
  assert.match(block, /@keyframes admin-rise/);
  assert.match(block, /\.admin-panel-enter-active > \* > \* \{ animation: admin-rise/);
  assert.match(block, /html\[data-motion="reduce"\] \.admin-panel-enter-active > \* > \*/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.admin-panel-enter-active \{ transition: opacity 180ms/);
  const component = source("components/admin/AdminProgressLine.vue");
  assert.doesNotMatch(component, /requestAnimationFrame\(/, "the line must not depend on animation frames");
  assert.match(component, /GRACE_MS/);
  assert.match(component, /aria-hidden="true"/);
});
