import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { planHighlightMove, HIGHLIGHT_MS } from "../src/mail/highlightMotion.ts";

const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("菜单线条移动：整圈线条原样平移，大小不变，不拉长、不分段，终点不会提前出现线条", () => {
  const frames = planHighlightMove({ x: 14, y: 100, width: 215, height: 40 }, { x: 14, y: 232, width: 215, height: 40 })!;
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.transform, "translate3d(14px,100px,0)");
  assert.equal(frames[0]!.height, "40px");
  assert.equal(frames[1]!.transform, "translate3d(14px,232px,0)");
  assert.equal(frames[1]!.height, "40px");
  // 向上移动同样是两帧平移
  const up = planHighlightMove({ x: 14, y: 232, width: 215, height: 40 }, { x: 14, y: 100, width: 215, height: 40 })!;
  assert.equal(up.length, 2);
  assert.ok(HIGHLIGHT_MS >= 400, "移动要有看得清的过渡时间");
});

test("起点终点重合时不播放动画；连续点击从中途位置出发也能得到有效动画", () => {
  const box = { x: 14, y: 100, width: 215, height: 40 };
  assert.equal(planHighlightMove(box, { ...box }), null);
  const mid = planHighlightMove({ x: 14, y: 137.4, width: 215, height: 40 }, { x: 14, y: 188, width: 215, height: 40 })!;
  assert.equal(mid[0]!.transform, "translate3d(14px,137.4px,0)");
  assert.equal(mid[1]!.transform, "translate3d(14px,188px,0)");
});

test("点击菜单当下就记目标：高亮和文字立即响应，aria-current 仍只跟随真实路由；右侧用后台同款加载动画表示等待", () => {
  const workspace = source("components/MailWorkspace.vue");
  assert.match(workspace, /const pendingPath = ref<string \| null>\(null\);\s*const highlightPath = computed\(\(\) => pendingPath\.value \?\? route\.path\)/);
  assert.match(workspace, /pendingPath\.value = path;\s*try \{\s*await closeMenu\(false\)/);
  assert.match(workspace, /navigating\.value = false; pendingPath\.value = null/);
  assert.match(workspace, /:class="\{ 'is-active': highlightPath === item\.path \}" :data-path="item\.path"/);
  assert.match(workspace, /:aria-current="route\.path === item\.path \? 'page' : undefined"/);
  assert.match(workspace, /<AdminLoader :active="navigationPending" \/>/);
  assert.match(workspace, /watch\(highlightPath, \(\) => \{ void nextTick\(\(\) => highlightMover\.measure\(true\)\); \}\)/);
  assert.match(workspace, /useMovingOutline\(\{\s*container: navigationList,\s*highlight: highlightElement/);
  const router = source("router.ts");
  assert.match(router, /\(to\.meta\.auth === "admin" \|\| to\.meta\.auth === "mail"\) && to\.fullPath !== from\.fullPath\) beginAdminNavigation/);
});

test("左侧菜单栏与右侧两个大容器同高同位：上下各留与邮件外壳相同的间距", () => {
  const css = source("styles/workspace.css");
  assert.match(css, /\.mail-workspace \{ --rail-w: var\(--workspace-sidebar-width\); \}/);
  assert.match(css, /\.dock-menu\.is-desktop-sidebar \{[^}]*margin:14px 0 12px; height:calc\(100% - 26px\);/);
  assert.match(css, /\.workspace-content \.mail-shell \{[^}]*padding: 14px 24px 12px;/);
});

test("会移动的选中线条始终是同一圈实线：只平移，不重画，没有虚线和碎片动画；图标落定弹一下", () => {
  const accent = source("styles/dashed-accent.css");
  assert.match(accent, /\.dock-navigation-highlight \.dash-outline__piece, \.folder-highlight \.dash-outline__piece, \.dock-active-pill \.dash-outline__piece \{ animation:none; \}/);
  assert.doesNotMatch(accent, /dock-line-flow/);
  const motion = source("mail/highlightMotion.ts");
  assert.match(motion, /不拉长、不分段、不在终点提前出现/);
  const css = source("styles/workspace.css");
  assert.match(css, /\.dock-navigation-item\.is-active svg \{ animation: dock-icon-settle 520ms/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.dock-navigation-item\.is-active svg \{ animation: none; \}/);
  // 目标按钮被点中后不显示悬停框，终点处不会先冒出一个框
  assert.match(css, /\.dock-navigation-item\.is-active:hover \{ outline: none; box-shadow: none; transform: none; \}/);
});

test("桌面左侧菜单、文件夹列表、手机底部胶囊、手机展开菜单共用同一套滑动线条", () => {
  const workspace = source("components/MailWorkspace.vue");
  const folders = source("components/mail/FolderRail.vue");
  const mover = source("mail/useMovingOutline.ts");
  // 手机胶囊
  assert.match(workspace, /const dockPill = useMovingOutline\(\{\s*container: dockElement,\s*highlight: pillElement,\s*targetSelector: \(\) => `\.dock-item\[data-dock-index="\$\{dockIndex\.value\}"\]`/);
  assert.match(workspace, /watch\(dockIndex, \(\) => \{ void nextTick\(\(\) => dockPill\.measure\(true\)\); \}\)/);
  assert.match(workspace, /<span ref="pillElement" class="dock-active-pill"/);
  // 文件夹列表（桌面侧栏和手机展开菜单里的都是它）
  assert.match(folders, /<span ref="highlight" class="folder-highlight"/);
  assert.match(folders, /useMovingOutline\(\{\s*container: tree,\s*highlight,\s*targetSelector: \(\) => `\.folder-item\[data-path="\$\{quote\(props\.currentFolder\)\}"\]`/);
  assert.match(folders, /watch\(\(\) => props\.currentFolder, \(\) => \{ void nextTick\(\(\) => outline\.measure\(true\)\); \}\)/);
  const css = source("styles/workspace.css");
  assert.match(css, /\.folder-tree \.folder-item\.is-current, \.folder-tree \.folder-item\.is-current:hover \{ background: transparent !important; border-color: transparent !important; outline: none !important;/);
  assert.match(css, /\.dock-active-pill \{ position: absolute; left: 0; top: 0; width: 0; height: 0;[^}]*transition: opacity 160ms ease;/);
  // 要播放动画的测量不会被随后的普通测量顶掉；按真实盒子（含小数）量，并除掉容器缩放
  assert.match(mover, /animateRequested = animateRequested \|\| animate === true;/);
  assert.match(mover, /scaleX = container\.offsetWidth \? containerRect\.width \/ container\.offsetWidth : 1/);
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
