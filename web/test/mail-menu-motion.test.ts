import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { planHighlightMove, HIGHLIGHT_MS, HIGHLIGHT_STRETCH_AT } from "../src/mail/highlightMotion.ts";

const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("菜单线条移动：先向目标方向拉长罩住起点和终点，再收缩到目标按钮上", () => {
  const frames = planHighlightMove({ x: 14, y: 100, width: 215, height: 40 }, { x: 14, y: 232, width: 215, height: 40 })!;
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((frame) => frame.offset), [0, HIGHLIGHT_STRETCH_AT, 1]);
  assert.equal(frames[0]!.transform, "translate3d(14px,100px,0)");
  assert.equal(frames[1]!.transform, "translate3d(14px,100px,0)");
  assert.equal(frames[1]!.height, "172px");
  assert.equal(frames[2]!.transform, "translate3d(14px,232px,0)");
  assert.equal(frames[2]!.height, "40px");
  // 向上移动同样成立
  const up = planHighlightMove({ x: 14, y: 232, width: 215, height: 40 }, { x: 14, y: 100, width: 215, height: 40 })!;
  assert.equal(up[1]!.transform, "translate3d(14px,100px,0)");
  assert.equal(up[1]!.height, "172px");
  assert.ok(HIGHLIGHT_MS >= 500, "移动要有看得清的过渡时间");
});

test("起点终点重合时不播放动画；连续点击从中途位置出发也能得到有效动画", () => {
  const box = { x: 14, y: 100, width: 215, height: 40 };
  assert.equal(planHighlightMove(box, { ...box }), null);
  const mid = planHighlightMove({ x: 14, y: 137.4, width: 215, height: 91.2 }, { x: 14, y: 188, width: 215, height: 40 })!;
  assert.equal(mid[0]!.height, "91.2px");
  assert.equal(mid[2]!.transform, "translate3d(14px,188px,0)");
});

test("点击菜单当下就记目标：高亮和文字立即响应，aria-current 仍只跟随真实路由；右侧用后台同款加载动画表示等待", () => {
  const workspace = source("components/MailWorkspace.vue");
  assert.match(workspace, /const pendingPath = ref<string \| null>\(null\);\s*const highlightPath = computed\(\(\) => pendingPath\.value \?\? route\.path\)/);
  assert.match(workspace, /pendingPath\.value = path;\s*try \{\s*await closeMenu\(false\)/);
  assert.match(workspace, /navigating\.value = false; pendingPath\.value = null/);
  assert.match(workspace, /:class="\{ 'is-active': highlightPath === item\.path \}" :data-path="item\.path"/);
  assert.match(workspace, /:aria-current="route\.path === item\.path \? 'page' : undefined"/);
  assert.match(workspace, /<AdminLoader :active="navigationPending" \/>/);
  assert.match(workspace, /watch\(highlightPath, \(\) => \{ pulseNavigationLine\(\); void nextTick\(\(\) => measureNavigationHighlight\(true\)\); \}\)/);
  assert.match(workspace, /planHighlightMove\(from, next\)/);
  const router = source("router.ts");
  assert.match(router, /\(to\.meta\.auth === "admin" \|\| to\.meta\.auth === "mail"\) && to\.fullPath !== from\.fullPath\) beginAdminNavigation/);
});

test("左侧菜单栏与右侧两个大容器同高同位：上下各留与邮件外壳相同的间距", () => {
  const css = source("styles/workspace.css");
  assert.match(css, /\.mail-workspace \{ --rail-w: var\(--workspace-sidebar-width\); \}/);
  assert.match(css, /\.dock-menu\.is-desktop-sidebar \{[^}]*margin:14px 0 12px; height:calc\(100% - 26px\);/);
  assert.match(css, /\.workspace-content \.mail-shell \{[^}]*padding: 14px 24px 12px;/);
});

test("菜单线条始终是同一圈实线：整圈先朝目标移动，停在原地的线条再沿竖线收回；不再重画虚线包围；图标落定弹一下", () => {
  const accent = source("styles/dashed-accent.css");
  assert.match(accent, /\.dock-navigation-highlight \.dash-outline__piece, \.dock-navigation-highlight\.is-line-shifting \.dash-outline__piece \{ animation:none; \}/);
  assert.doesNotMatch(accent, /dock-line-flow/);
  assert.doesNotMatch(source("styles/workspace.css"), /dock-line-flow/);
  const motion = source("mail/highlightMotion.ts");
  assert.match(motion, /停留在原地的线条再沿着竖线收回/);
  assert.match(motion, /不会出现新的虚线包围/);
  assert.equal(HIGHLIGHT_STRETCH_AT, 0.5);
  const css = source("styles/workspace.css");
  assert.match(css, /\.dock-navigation-item\.is-active svg \{ animation: dock-icon-settle 520ms/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.dock-navigation-item\.is-active svg \{ animation: none; \}/);
});

test("线条移动分两段：前沿先到达（后沿留在原处），之后后沿收回；两段缓动不同", () => {
  const frames = planHighlightMove({ x: 14, y: 100, width: 215, height: 40 }, { x: 14, y: 232, width: 215, height: 40 })!;
  assert.ok(frames[0]!.easing && frames[1]!.easing && frames[0]!.easing !== frames[1]!.easing);
  // 前沿（下边）从 140 走到 272；后沿（上边）在中间帧仍停在原处 100
  assert.equal(frames[1]!.transform, "translate3d(14px,100px,0)");
  assert.equal(Number.parseFloat(String(frames[1]!.height)) + 100, 272);
});

test("校验提示出现不再拉高、移动另一侧文本框；提示平滑展开与收起", () => {
  const css = source("styles/theme-controls.css");
  assert.match(css, /#app \.field \{ align-content: start; \}/);
  assert.match(css, /\.themed-field-error \{ overflow: hidden; animation: themed-error-in 240ms/);
  assert.match(css, /\.themed-field-error\.is-leaving \{ animation: themed-error-out 200ms/);
  const code = source("themeControls.ts");
  assert.match(code, /error\.node\.classList\.add\("is-leaving"\); setTimeout\(\(\) => error\.node\.remove\(\), 220\)/);
});

test("设置页不再显示“动效和性能模式选好就生效…”那句说明", () => {
  assert.doesNotMatch(source("views/SettingsView.vue"), /动效和性能模式选好就生效/);
});

test("要播放动画的测量不会被随后的普通测量顶掉（否则线条直接瞬移到目标）", () => {
  const workspace = source("components/MailWorkspace.vue");
  assert.match(workspace, /let animateRequested = false;/);
  assert.match(workspace, /animateRequested = animateRequested \|\| animate === true;/);
  assert.match(workspace, /animate = animateRequested;\s*animateRequested = false;/);
});
