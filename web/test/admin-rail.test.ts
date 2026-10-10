import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PAGE_TITLES, RAIL_ITEMS, RAIL_SECTIONS, matchItems, railSections, visibleItems } from "../src/admin/navModel.ts";
import { SEQUENCE_WINDOW_MS, isTypingTarget, resolveShortcut } from "../src/admin/shortcuts.ts";
import { decideSwipe } from "../src/admin/railSwipe.ts";
import { adminRoutes } from "../src/auth/adminRoutes.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const allow = () => true;
const key = (value: string, extra: Partial<Parameters<typeof resolveShortcut>[0]> = {}) =>
  ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, ...extra });

test("导航模型与路由一致：每个菜单项都对应真实后台路由，权限与路由元数据相同，快捷键和路由名不重复", () => {
  const children = adminRoutes.find((route) => route.name === "admin-workspace-root")!.children!;
  const byName = new Map(children.map((route) => [String(route.name), route]));
  for (const item of RAIL_ITEMS) {
    const route = byName.get(item.name);
    assert.ok(route, `${item.name} must be a real route`);
    assert.equal((route!.meta as { permission: string }).permission, item.permission, item.name);
  }
  assert.equal(RAIL_ITEMS.length, children.length, "no route is missing from the menu");
  assert.equal(new Set(RAIL_ITEMS.map((item) => item.shortcut)).size, RAIL_ITEMS.length);
  assert.equal(new Set(RAIL_ITEMS.map((item) => item.name)).size, RAIL_ITEMS.length);
  assert.ok(RAIL_ITEMS.every((item) => /^[a-z]$/.test(item.shortcut) && item.shortcut !== "g"));
  assert.deepEqual(Object.keys(PAGE_TITLES), RAIL_ITEMS.map((item) => item.name));
});

test("菜单扁平：8 个页面一次点击可达，没有说明文字字段；没有权限的页面与空分区被隐藏", () => {
  assert.equal(RAIL_ITEMS.length, 8);
  assert.ok(RAIL_ITEMS.every((item) => !("hint" in item)));
  const everything = railSections(allow);
  assert.deepEqual(everything.map((section) => section.key), RAIL_SECTIONS.map((section) => section.key));
  assert.equal(everything.flatMap((section) => section.items).length, 8);
  const auditor = railSections((permission) => ["mail.account.read", "mail.invite.read", "mail.queue.read", "system.audit.read"].includes(permission));
  const names = auditor.flatMap((section) => section.items.map((item) => item.name));
  assert.ok(!names.includes("admin-admins") && !names.includes("admin-system") && !names.includes("admin-human-check"));
  assert.ok(!auditor.some((section) => section.key === "system"), "a section with no visible page disappears");
  assert.deepEqual(visibleItems(() => false), []);
});

test("跳转面板匹配：名称开头优先于包含，再到关键词；拼音首字母、英文、别名都能命中；空查询列出全部", () => {
  const items = RAIL_ITEMS;
  assert.equal(matchItems(items, "").length, items.length);
  assert.deepEqual(matchItems(items, "yz").map((item) => item.label), ["人机验证"]);
  assert.equal(matchItems(items, "turnstile")[0]!.label, "人机验证");
  assert.equal(matchItems(items, "cloudflare")[0]!.label, "人机验证");
  assert.equal(matchItems(items, "日志")[0]!.label, "运维中心");
  assert.equal(matchItems(items, "账号")[0]!.label, "邮箱账号");
  assert.equal(matchItems(items, "  邀请  ")[0]!.label, "邀请码");
  assert.equal(matchItems(items, "totp")[0]!.label, "安全中心");
  assert.deepEqual(matchItems(items, "zzzz"), []);
  // 名称开头 > 名称包含：“安全”同时是“安全中心”的开头，也是关键词；排在前面的必须是名称开头的项。
  assert.equal(matchItems(items, "安全")[0]!.label, "安全中心");
  // 大小写不敏感
  assert.equal(matchItems(items, "ACCOUNTS")[0]!.label, "邮箱账号");
});

test("匹配排序的四档优先级：名称开头、名称包含、关键词开头、关键词包含；同档保持原顺序", () => {
  const items = [
    { label: "含关键词", keywords: "xxabc" },       // 关键词包含 → 第 4 档
    { label: "关键词开头", keywords: "abcd" },      // 关键词开头 → 第 3 档
    { label: "名称里有 abc", keywords: "" },        // 名称包含 → 第 2 档
    { label: "abc 开头", keywords: "" },            // 名称开头 → 第 1 档
    { label: "另一个含关键词", keywords: "yyabc" },  // 关键词包含 → 第 4 档，排在上一个之后
  ];
  assert.deepEqual(matchItems(items, "abc").map((item) => item.label), ["abc 开头", "名称里有 abc", "关键词开头", "含关键词", "另一个含关键词"]);
  assert.deepEqual(matchItems(items, "zzz"), []);
});

test("快捷键：Ctrl/⌘+K 随处可用；g 加字母直达；输入框内、带修饰键、超时、权限不足都不触发", () => {
  const now = 10_000;
  assert.deepEqual(resolveShortcut(key("k", { ctrlKey: true }), allow, 0, now), { type: "palette", armedUntil: 0 });
  assert.deepEqual(resolveShortcut(key("K", { metaKey: true }), allow, 0, now), { type: "palette", armedUntil: 0 });
  const input = { tagName: "INPUT" } as unknown as EventTarget;
  assert.equal(resolveShortcut(key("k", { ctrlKey: true, target: input }), allow, 0, now).type, "palette", "the palette shortcut works inside inputs too");
  const armed = resolveShortcut(key("g"), allow, 0, now);
  assert.deepEqual(armed, { type: "arm", armedUntil: now + SEQUENCE_WINDOW_MS });
  assert.deepEqual(resolveShortcut(key("a"), allow, armed.armedUntil, now + 300), { type: "go", name: "admin-accounts", armedUntil: 0 });
  assert.equal(resolveShortcut(key("a"), allow, armed.armedUntil, now + SEQUENCE_WINDOW_MS + 1).type, "none", "armed window expired");
  assert.equal(resolveShortcut(key("a"), allow, 0, now).type, "none", "a single letter does nothing");
  assert.equal(resolveShortcut(key("g", { target: input }), allow, 0, now).type, "none");
  assert.equal(resolveShortcut(key("g", { target: { tagName: "TEXTAREA" } as unknown as EventTarget }), allow, 0, now).type, "none");
  assert.equal(resolveShortcut(key("g", { ctrlKey: true }), allow, 0, now).type, "none");
  assert.equal(resolveShortcut(key("g", { altKey: true }), allow, 0, now).type, "none");
  assert.equal(resolveShortcut(key("G", { shiftKey: true }), allow, 0, now).type, "none");
  assert.equal(resolveShortcut(key("g", { isComposing: true }), allow, 0, now).type, "none");
  // 第二个键不是页面字母：取消等待
  assert.deepEqual(resolveShortcut(key("z"), allow, armed.armedUntil, now + 100), { type: "none", armedUntil: 0 });
  // 没有权限的页面不能直达
  const noSecurityWrite = (permission: string) => permission !== "system.security.write";
  assert.equal(resolveShortcut(key("h"), noSecurityWrite, armed.armedUntil, now + 100).type, "none");
  assert.equal(resolveShortcut(key("h"), allow, armed.armedUntil, now + 100).type, "go");
  // Shift 本身不取消等待（为输入大写字母预留）
  assert.equal(resolveShortcut(key("Shift", { shiftKey: true }), allow, armed.armedUntil, now + 100).armedUntil, armed.armedUntil);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget), false);
  assert.equal(isTypingTarget(null), false);
});

test("滑动手势：只在左边缘向右滑才打开，打开后向左滑关闭；竖向滚动、距离不足、反方向都忽略", () => {
  assert.equal(decideSwipe({ x: 8, y: 300 }, { x: 140, y: 310 }, false), "open");
  assert.equal(decideSwipe({ x: 60, y: 300 }, { x: 200, y: 300 }, false), null, "must start at the edge");
  assert.equal(decideSwipe({ x: 8, y: 300 }, { x: 40, y: 300 }, false), null, "too short");
  assert.equal(decideSwipe({ x: 8, y: 300 }, { x: 100, y: 480 }, false), null, "mostly vertical");
  assert.equal(decideSwipe({ x: 8, y: 300 }, { x: -80, y: 300 }, false), null, "wrong direction");
  assert.equal(decideSwipe({ x: 250, y: 300 }, { x: 100, y: 305 }, true), "close");
  assert.equal(decideSwipe({ x: 250, y: 300 }, { x: 330, y: 300 }, true), null);
  assert.equal(decideSwipe({ x: 250, y: 300 }, { x: 200, y: 300 }, true), null, "too short to close");
});

test("侧栏结构：新组件取代折叠分组，无说明文字、无 v-html，图标是统一的静态形状", () => {
  const shell = source("views/admin/AdminShell.vue");
  assert.match(shell, /<AdminRail/);
  assert.match(shell, /<AdminCommandPalette/);
  assert.doesNotMatch(shell, /admin-nav-group|accordion|persistOpen|groupForRoute/);
  assert.match(shell, /matchMedia\("\(max-width: 900px\)"\)/);
  assert.match(shell, /:inert="menuOpen && isCompact"/);
  assert.match(shell, /decideSwipe/);
  assert.match(shell, /resolveShortcut/);
  const rail = source("components/admin/AdminRail.vue");
  assert.match(rail, /id="admin-sidebar"/);
  assert.match(rail, /aria-keyshortcuts/);
  assert.match(rail, /ArrowDown/);
  assert.doesNotMatch(rail, /<small[^>]*>\{\{ *item\.hint/);
  for (const file of ["components/admin/AdminRail.vue", "components/admin/AdminIcon.vue", "components/admin/AdminCommandPalette.vue"]) {
    assert.doesNotMatch(source(file), /v-html|innerHTML/, file);
  }
  // 路由、导航和页面标题只有一个数据源。
  assert.doesNotMatch(shell, /label: "安全中心"|hint:/);
});

test("侧栏样式：纯色、只用项目令牌、减少动画时关闭过渡，抽屉背景不透明且锁定页面滚动", () => {
  const css = source("styles/admin.css");
  const start = css.indexOf("后台侧栏：纯色");
  assert.ok(start > 0);
  const block = css.slice(start);
  assert.doesNotMatch(block, /gradient/i);
  assert.doesNotMatch(block, /#[\da-f]{3,8}\b|rgba?\(/i);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(block, /html\[data-motion="reduce"\] \.admin-rail__indicator\.is-ready/);
  assert.match(block, /\.admin-rail__indicator\.is-ready \{ transition: transform/);
  assert.match(block, /body\.admin-rail-open \{ overflow: hidden; \}/);
  assert.match(block, /@media \(max-width: 900px\)/);
  assert.match(block, /background: var\(--surface\);/);
  assert.doesNotMatch(css, /max-width: 1180px/, "the old wide breakpoint is gone");
  assert.doesNotMatch(css, /\.admin-sidebar|admin-nav-group/, "old sidebar selectors removed from the feature stylesheet");
});

test("角标：读取失败保留旧值，只在页面可见时轮询，卸载时停止", () => {
  const badges = source("admin/useRailBadges.ts");
  assert.match(badges, /document\.hidden/);
  assert.match(badges, /visibilitychange/);
  assert.match(badges, /onBeforeUnmount\(stop\)/);
  assert.match(badges, /catch \{ \/\* 角标是辅助信息/);
  assert.match(badges, /\/api\/admin\/nav-badges/);
});
