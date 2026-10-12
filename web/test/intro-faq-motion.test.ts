import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INTRO_FAQ } from "../../shared/seo.ts";
import { faqFrames, faqTextFrames, FAQ_OPEN_MS, FAQ_CLOSE_MS } from "../src/intro/faq.ts";
import { attachIntroItems, itemDelays, ITEM_MAX_STEPS, ITEM_STEP_MS, type ItemEntry, type ItemRuntime } from "../src/intro/reveal.ts";

const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("常见问题是三条真正常见的问题，各有回答，旧的“示例窗口”问题已移除", () => {
  assert.equal(INTRO_FAQ.length, 3);
  assert.deepEqual(INTRO_FAQ.map((item) => item.question), ["我怎么开通邮箱？", "忘记密码了怎么办？", "我的邮件安全吗？"]);
  for (const item of INTRO_FAQ) assert.ok(item.answer.length >= 30 && item.question.endsWith("？"));
  assert.ok(!JSON.stringify(INTRO_FAQ).includes("示例窗口"));
  assert.equal(INTRO_FAQ[0].link.to, "/register");
  assert.equal(INTRO_FAQ[1].link.to, "/password-reset");
});

test("回答展开是高度加透明度的“拉出来”，收起是收回去；文字随之落下", () => {
  const open = faqFrames(true, 0, 120);
  assert.equal(open.duration, FAQ_OPEN_MS);
  assert.deepEqual(open.frames, [{ height: "0px", opacity: 0 }, { height: "120px", opacity: 1 }]);
  const close = faqFrames(false, 120, 0);
  assert.equal(close.duration, FAQ_CLOSE_MS);
  assert.deepEqual(close.frames, [{ height: "120px", opacity: 1 }, { height: "0px", opacity: 0 }]);
  assert.ok(FAQ_CLOSE_MS < FAQ_OPEN_MS);
  // 连点时从当前高度接着走，不会从 0 重来
  assert.equal(faqFrames(true, 40, 120).frames[0]!.height, "40px");
  assert.equal(faqTextFrames(true)[0]!.opacity, 0);
  assert.equal(faqTextFrames(false)[1]!.opacity, 0);
});

test("首页模板：问答用带回答容器的 details，点击由脚本接管，不再直接出现", () => {
  const view = source("views/IntroView.vue");
  assert.match(view, /<summary class="intro-faq-trigger" @click\.prevent="toggleFaq\(/);
  assert.match(view, /<div class="intro-faq-answer"><p>\{\{ item\.answer \}\}/);
  assert.match(view, /import \{ toggleFaq \} from "\.\.\/intro\/faq"/);
  const css = source("styles/intro.css");
  assert.match(css, /\.intro-faq-answer \{ overflow: hidden; \}/);
  assert.match(css, /details\[open\]:not\(\[data-closing\]\) \.intro-faq-plus/);
  assert.doesNotMatch(css, /intro-answer-arrive/);
});

function fakeRuntime() {
  const classes = new Map<string, Set<string>>();
  const vars = new Map<string, string>();
  const make = (id: string, top: number) => ({ id, top, classList: { contains: (v: string) => classes.get(id)?.has(v) ?? false, add: (v: string) => { (classes.get(id) ?? classes.set(id, new Set()).get(id)!).add(v); }, remove: (v: string) => classes.get(id)?.delete(v) },
    style: { setProperty: (k: string, v: string) => vars.set(`${id}${k}`, v), removeProperty: (k: string) => vars.delete(`${id}${k}`) } });
  const items = [make("a", 30), make("b", 10), make("c", 20)];
  const root = { querySelectorAll: () => items } as unknown as HTMLElement;
  let callback: (entries: ItemEntry[]) => void = () => undefined; let disconnected = 0; let reduced = false;
  const runtime: ItemRuntime = { reduced: () => reduced, observer: (fn) => { callback = fn; return { observe() {}, disconnect() { disconnected += 1; } }; }, top: (el) => (el as unknown as { top: number }).top };
  const entry = (item: ReturnType<typeof make>, isIntersecting: boolean): ItemEntry => ({ isIntersecting, target: item as unknown as HTMLElement });
  return { items, root, runtime, classes, vars, entry, fire: (entries: ItemEntry[]) => callback(entries), disconnected: () => disconnected, setReduced: (v: boolean) => { reduced = v; } };
}

test("每一项文字和卡片各自入场：同时进来的按位置依次排队，离开视野后收回，再进来重新入场", () => {
  assert.deepEqual(itemDelays(3), [0, ITEM_STEP_MS, 2 * ITEM_STEP_MS]);
  assert.equal(itemDelays(20)[19], ITEM_MAX_STEPS * ITEM_STEP_MS);
  const f = fakeRuntime();
  const dispose = attachIntroItems(f.root, f.runtime);
  f.fire(f.items.map((item) => f.entry(item, true)));
  assert.equal(f.vars.get("b--d"), "0ms");
  assert.equal(f.vars.get("c--d"), `${ITEM_STEP_MS}ms`);
  assert.equal(f.vars.get("a--d"), `${2 * ITEM_STEP_MS}ms`);
  assert.ok(f.items.every((item) => f.classes.get(item.id)!.has("is-seen")));
  f.fire([f.entry(f.items[0]!, false)]);
  assert.equal(f.classes.get("a")!.has("is-seen"), false);
  f.fire([f.entry(f.items[0]!, true)]);
  assert.ok(f.classes.get("a")!.has("is-seen"));
  dispose();
  assert.equal(f.disconnected(), 1);
  assert.equal(f.classes.get("b")!.has("is-seen"), false);
});

test("减少动画时入场不排队；首页样式让每一项自己淡入，问答卡片起点更低更明显", () => {
  const f = fakeRuntime(); f.setReduced(true);
  attachIntroItems(f.root, f.runtime);
  f.fire(f.items.map((item) => f.entry(item, true)));
  assert.ok(f.items.every((item) => f.vars.get(`${item.id}--d`) === "0ms"));
  const css = source("styles/intro.css");
  assert.match(css, /\.intro-stagger\.is-seen \{ opacity: 1; transform: none;[^}]*transition-delay: var\(--d, 0ms\)/);
  assert.match(css, /\.intro-faq-card\.intro-stagger \{ transform: translate3d\(0, 40px, 0\) scale\(\.96\)/);
  assert.doesNotMatch(css, /is-in-view \.intro-stagger/);
  assert.match(css, /data-motion=reduce\], \[data-performance=low\]\) \.intro-reveal--split \.intro-stagger \{ opacity: 1 !important/);
});
