import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { api, onApiActivity } from "../src/api/client.ts";
import { FADE_MS, MIN_SHOW_MS, START_DELAY_MS, createLoader, loaderGate, type LoaderTimers } from "../src/admin/loader.ts";
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

function fakeTimers() {
  let clock = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: LoaderTimers = {
    now: () => clock,
    set(run, ms) { const id = nextId++; pending.set(id, { at: clock + ms, run }); return id; },
    clear(id) { pending.delete(id); },
  };
  const advance = (ms: number) => {
    const target = clock + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      clock = due[1].at;
      due[1].run();
    }
    clock = target;
  };
  return { timers, advance };
}

test("加载动画时机：很快完成的操作不出现；出现后至少停留；容器出现立刻收起，不再额外等待", () => {
  const events: boolean[] = [];
  const { timers, advance } = fakeTimers();
  const loader = createLoader((visible) => events.push(visible), timers);
  // 快速完成：在出现之前就结束，什么都不发生。
  loader.setBusy(true); advance(START_DELAY_MS - 20); loader.setBusy(false); advance(2000);
  assert.deepEqual(events, []);
  // 正常加载：延迟之后出现；结束得太早时停留到最短时间再收起。
  loader.setBusy(true); advance(START_DELAY_MS + 1);
  assert.deepEqual(events, [true]);
  advance(100); loader.setBusy(false);
  advance(MIN_SHOW_MS - 150); assert.deepEqual(events, [true], "出现不久就结束时，停留到最短时间才收起");
  advance(200); assert.deepEqual(events, [true, false]);
  // 加载足够久之后结束：容器出现的那一刻立刻收起，没有额外缓冲。
  events.length = 0;
  loader.setBusy(true); advance(START_DELAY_MS + 1); advance(MIN_SHOW_MS + 500);
  loader.setBusy(false); advance(1);
  assert.deepEqual(events, [true, false], "不再等待缓冲期");
  // 收起前又忙起来：不收起也不重新出现。
  events.length = 0;
  loader.setBusy(true); advance(START_DELAY_MS + 1); advance(MIN_SHOW_MS);
  loader.setBusy(false); loader.setBusy(true); advance(2000);
  assert.deepEqual(events, [true], "没有收起再出现");
  loader.setBusy(false); advance(5);
  assert.deepEqual(events, [true, false]);
  loader.dispose();
  assert.ok(START_DELAY_MS >= 80 && START_DELAY_MS <= 250, "快速操作不会闪一下动画");
  assert.ok(MIN_SHOW_MS >= 300 && FADE_MS >= 200);
});

test("入场闸门：加载动画显示期间和淡出期间，新容器的入场往后推；收起完成后恢复；没出现过就不推迟", () => {
  const { timers, advance } = fakeTimers();
  const events: boolean[] = [];
  loaderGate.reset();
  const loader = createLoader((visible) => events.push(visible), timers);
  assert.equal(loaderGate.delay(timers.now()), 0, "没有加载动画时不推迟");
  loader.setBusy(true); advance(START_DELAY_MS - 20); loader.setBusy(false); advance(10);
  assert.equal(loaderGate.delay(timers.now()), 0, "出现前就结束，不推迟");
  loader.setBusy(true); advance(START_DELAY_MS + 1);
  assert.ok(loaderGate.delay(timers.now()) > 10_000, "显示期间闸门关着");
  advance(MIN_SHOW_MS + 100); loader.setBusy(false);
  const gate = loaderGate.delay(timers.now());
  assert.ok(gate > 0 && gate <= FADE_MS + 1, `结束后推迟到淡出完成：${gate}`);
  advance(2); assert.deepEqual(events, [true, false]);
  advance(FADE_MS + 5);
  assert.equal(loaderGate.delay(timers.now()), 0, "淡出完成后恢复");
  loader.dispose();
});

test("右侧加载动画与容器线条绝不同时出现：显示期间旧内容淡出，入场被闸门推迟，恢复会话时没有容器卡片", () => {
  const motion = readFileSync(new URL("../src/motion.ts", import.meta.url), "utf8");
  const entrance = readFileSync(new URL("../src/admin/entrance.ts", import.meta.url), "utf8");
  const loaderView = readFileSync(new URL("../src/components/admin/AdminLoader.vue", import.meta.url), "utf8");
  const shell = source("views/admin/AdminShell.vue");
  assert.match(motion, /const gate = loaderGate\.delay\(now\);/);
  assert.match(motion, /return own \+ gate \+ stagger\.next\(now\)/);
  assert.match(entrance, /const gate = loaderGate\.delay\(now\);/);
  assert.match(entrance, /const cardDelay = slot\(\) \+ gate;/);
  assert.match(entrance, /playStat\(element, delay \+ gate\)/);
  assert.match(loaderView, /setAttribute\("data-route-loading", ""\)/);
  assert.match(loaderView, /removeAttribute\("data-route-loading"\), FADE_MS\)/);
  assert.match(source("styles/admin.css"), /html\[data-route-loading\] \.admin-route-panel \{ opacity: 0;/);
  assert.match(source("styles/workspace.css"), /html\[data-route-loading\] \.workspace-route-panel:not\(\.mail-panel-leave-active\) \{ opacity: 0;/);
  assert.doesNotMatch(shell, /<section v-if="loading" class="managed-page-card admin-page-state"/);
  assert.match(shell, /<p v-if="loading" class="sr-only" role="status" aria-live="polite">正在恢复管理员会话…<\/p>/);
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
  // v0.9.8: 邮箱页面切换也走同一个同步守卫，右侧同样显示加载动画
  assert.match(router, /\(to\.meta\.auth === "admin" \|\| to\.meta\.auth === "mail"\) && to\.fullPath !== from\.fullPath\) beginAdminNavigation\(to\.name, to\.fullPath\)/);
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

test("外壳：菜单跟随目标页立即高亮，右侧加载动画只覆盖容器未加载好（校验等待、恢复会话），新页面各块依次入场而不是整体入场", () => {
  const shell = source("views/admin/AdminShell.vue");
  assert.match(shell, /:pending="navigationState\.pending"/);
  assert.match(shell, /<AdminLoader :active="busy" \/>/);
  // v0.9.1: 只在右侧容器还没加载好时显示，页面内数据请求在途不再触发。
  assert.match(shell, /Boolean\(navigationState\.pending\) \|\| loading\.value/);
  assert.doesNotMatch(shell, /onApiActivity|requestsInFlight/);
  assert.match(shell, /:aria-busy="busy \? 'true' : 'false'"/);
  assert.match(shell, /name="admin-panel" mode="out-in" :duration="\{ enter: 0, leave: 140 \}"/);
  assert.match(shell, /<div :key="String\(childRoute\.name\)" v-admin-entrance class="admin-route-panel">/);
  const rail = source("components/admin/AdminRail.vue");
  assert.match(rail, /const active = computed\(\(\) => props\.pending \|\| props\.current\)/);
  assert.match(rail, /'is-current': active === item\.name/);
  assert.match(source("admin/useRailBadges.ts"), /\{ quiet: true \}/);
});

test("加载动画与入场样式：线条图形、淡浅蓝、只用令牌、减少动画时关闭；样式里不再有整页入场规则和顶部粗线", () => {
  const css = source("styles/admin.css");
  assert.doesNotMatch(css, /admin-progress|@keyframes admin-rise|admin-panel-enter/, "整页入场和顶部加载线的规则都已移除");
  assert.match(css, /\.admin-panel-leave-active \{ pointer-events: none/);
  const component = source("components/admin/AdminLoader.vue");
  const style = component.slice(component.indexOf("<style scoped>"));
  assert.doesNotMatch(style, /gradient/i);
  assert.doesNotMatch(style.replace("var(--blue-300, #a8d0f4)", ""), /#[\da-f]{3,8}\b/i, "颜色只用主题令牌（白色半透明的磨砂底除外）");
  assert.match(style, /stroke: var\(--line-blue-strong\)/);
  assert.match(style, /@keyframes loader-orbit/);
  assert.match(style, /@keyframes loader-draw/);
  assert.match(style, /left: var\(--rail-w, 0px\)/, "在右侧内容区正中，不是整个窗口的中间");
  assert.match(style, /pointer-events: none/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  assert.match(component, /aria-hidden="true"/);
  assert.doesNotMatch(component, /requestAnimationFrame\(/);
  assert.match(component, /createLoader\(/);
});
