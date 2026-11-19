import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { withScrollHold } from "../src/enterMotion.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

type FakeNode = { parentElement: FakeNode | null; overflowY: string; scrollHeight: number; clientHeight: number; dataset: Record<string, string>; children?: FakeNode[]; offsetParent?: FakeNode | null; offsetTop?: number; offsetHeight?: number; clientTop?: number };

function tree(host: Partial<FakeNode>) {
  const body: FakeNode = { parentElement: null, overflowY: "visible", scrollHeight: 0, clientHeight: 0, dataset: {} };
  const scroller: FakeNode = { parentElement: body, overflowY: "auto", scrollHeight: 600, clientHeight: 600, dataset: {}, ...host };
  const card: FakeNode = { parentElement: scroller, overflowY: "visible", scrollHeight: 0, clientHeight: 0, dataset: {}, offsetParent: scroller, offsetTop: 0, offsetHeight: host.offsetHeight ?? 600 };
  scroller.children = [card];
  return { body, scroller, card };
}

function fakeAnimation() {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  return { animation: { finished, effect: { getComputedTiming: () => ({ endTime: 10 }) } } as unknown as Animation, finish };
}

function withDom<T>(body: FakeNode, run: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  g.document = { body };
  g.getComputedStyle = (node: FakeNode) => ({ overflowY: node.overflowY, marginBottom: "0px", paddingBottom: "0px" });
  try { return run(); } finally { g.document = saved.document; g.getComputedStyle = saved.getComputedStyle; }
}

test("入场动画期间，原本放得下的滚动容器暂停纵向滚动，动画结束后恢复", async () => {
  const { body, scroller, card } = tree({});
  const { animation, finish } = fakeAnimation();
  withDom(body, () => withScrollHold(card as unknown as Element, () => animation));
  assert.equal(scroller.dataset.entranceHold, "");
  finish();
  await animation.finished;
  await Promise.resolve();
  assert.equal("entranceHold" in scroller.dataset, false);
});

test("本来就需要滚动的容器不受影响，没有滚动容器时直接放行", () => {
  const { body, scroller, card } = tree({ scrollHeight: 900, clientHeight: 600, offsetHeight: 900 });
  const { animation } = fakeAnimation();
  withDom(body, () => withScrollHold(card as unknown as Element, () => animation));
  assert.equal("entranceHold" in scroller.dataset, false);
  const created = withScrollHold({} as Element, () => animation);
  assert.equal(created, animation);
});

test("只因入场位移多出来的高度也会暂停滚动：按布局高度判断是否放得下", () => {
  const { body, scroller, card } = tree({ scrollHeight: 620, clientHeight: 600, offsetHeight: 600 });
  const { animation } = fakeAnimation();
  withDom(body, () => withScrollHold(card as unknown as Element, () => animation));
  assert.equal(scroller.dataset.entranceHold, "");
});

test("入场动画的三个入口都经过滚动保护，样式里有对应的暂停规则", () => {
  assert.match(source("motion.ts"), /withScrollHold\(element, \(\) => \[/);
  assert.match(source("motion.ts"), /withScrollHold\(element, \(\) => record\.animations, delay\)/);
  assert.match(source("motion.ts"), /new ResizeObserver\(\(\[entry\]\) => \{/);
  assert.match(source("admin/entrance.ts"), /withScrollHold\(element, \(\) => element\.animate/);
  assert.match(source("cardParts.ts"), /withScrollHold\(part, \(\) => part\.animate/);
  assert.match(source("styles/theme/base.css"), /\[data-entrance-hold\] \{ overflow-y: hidden !important; \}/);
});

test("通知胶囊伸缩和换字时正文不出现滚动条；输入框过长文字以省略号收尾", () => {
  assert.match(source("styles/notifications.css"), /\.notification-capsule:is\(\[data-phase="enter"\], \[data-phase="exit"\], \[data-phase="text-out"\], \[data-phase="text-in"\]\) \.notification-capsule__text \{ overflow-y: hidden; \}/);
  assert.match(source("styles/theme/base.css"), /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\) \{ text-overflow: ellipsis; \}/);
});

test("窄屏不被撑宽：管理卡片单列可收缩，自检详情可断行，标题旁筛选框可换行", () => {
  const primitives = source("styles/theme/primitives.css");
  assert.match(primitives, /\.check-row > span:not\(\.badge\) \{ min-width: 0; overflow-wrap: anywhere; \}/);
  assert.match(source("styles/admin.css"), /\.panel-heading:has\(> \.admin-inline-filter\) \{ flex-wrap: wrap; \}/);
  for (const file of ["views/admin/AdminsView.vue", "views/admin/AccountsView.vue"]) {
    assert.doesNotMatch(source(file), /placeholder: "至少 10 位，不能是纯数字或纯字母"/);
    assert.match(source(file), /不能是纯数字或纯字母/);
  }
  assert.match(source("views/admin/SeoView.vue"), /placeholder="留空使用内置图片"/);
  assert.doesNotMatch(source("components/admin/SeoPreview.vue"), /<img src="\/logo\.svg"/);
});

test("平滑高度在下一帧合并写入，避免在尺寸观察回调里同步改布局", async () => {
  const { nextFrameWriter } = await import("../src/smoothHeight.ts");
  const g = globalThis as Record<string, unknown>;
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  const queue: Array<() => void> = [];
  g.requestAnimationFrame = (cb: () => void) => { queue.push(cb); return queue.length; };
  g.cancelAnimationFrame = () => { queue.length = 0; };
  try {
    const written: number[] = [];
    const writer = nextFrameWriter((value) => written.push(value));
    writer.push(100); writer.push(120);
    assert.deepEqual(written, []);
    assert.equal(queue.length, 1);
    queue.shift()!();
    assert.deepEqual(written, [120]);
    writer.push(90); writer.cancel(); queue.shift()?.();
    assert.deepEqual(written, [120]);
  } finally { g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf; }
  assert.match(readFileSync(new URL("../src/components/SmoothBlock.vue", import.meta.url), "utf8"), /nextFrameWriter\(\(value\) => \{ height\.value = value; \}\)/);
});

test("保留的图像与主题协调：验证码用主题色、趋势图空状态不画零线且主系列在最上层", () => {
  const captcha = readFileSync(new URL("../../server/src/security/humanCheck.ts", import.meta.url), "utf8");
  assert.match(captcha, /const INK: Rgba = \[90, 84, 88\];/);
  assert.match(captcha, /const PAPER: Rgba = \[255, 255, 255\];/);
  const trend = source("components/admin/TrendChart.vue");
  assert.match(trend, /\.is-empty \.trend__line, \.is-empty \.trend__area \{ opacity: 0; \}/);
  assert.match(trend, /v-for="item in \[\.\.\.series\]\.reverse\(\)"/);
});

test("图标规格统一、快捷操作不逐字换行、SEO 动态提示移到说明", () => {
  const workspace = source("styles/workspace.css");
  assert.doesNotMatch(workspace, /stroke-width: 1\.7/);
  assert.match(workspace, /\.dock-navigation-item svg \{ flex: none; width: 20px; height: 20px;/);
  const admin = source("styles/admin.css");
  assert.match(admin, /\.baka-overview__quick-actions \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 140px\), 1fr\)\);/);
  assert.match(source("views/admin/OverviewView.vue"), /<span class="baka-overview__label">\{\{ action\.label \}\}<\/span>/);
  assert.match(source("styles/theme/base.css"), /p, li, dd, small, figcaption \{ text-wrap: pretty; \}/);
  const seo = source("views/admin/SeoView.vue");
  assert.match(seo, /placeholder="留空自动生成"/);
  assert.doesNotMatch(seo, /:placeholder="autoTitle"/);
});
