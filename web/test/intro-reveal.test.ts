import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { attachIntroReveal, type RevealRuntime } from "../src/intro/reveal.ts";

function setup(available = true) {
  const classes = new Set<string>();
  const listeners = new Map<string, () => void>();
  const element = { classList: {
    add: (...values: string[]) => values.forEach(value => classes.add(value)),
    remove: (...values: string[]) => values.forEach(value => classes.delete(value)),
    toggle(value: string, on: boolean) { if (on) classes.add(value); else classes.delete(value); },
  }, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
  removeEventListener: (name: string) => listeners.delete(name) } as unknown as HTMLElement;
  let callback: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
  let preference: (() => void) | undefined;
  let reduced = false; let focused = false; let disconnected = 0; let unwatched = 0;
  const runtime: RevealRuntime = {
    reduced: () => reduced, focusedWithin: () => focused,
    observer(fn) { callback = fn; return available ? { observe() {}, disconnect() { disconnected++; } } : null; },
    onPreferenceChange(fn) { preference = fn; return () => { unwatched++; }; },
  };
  const dispose = attachIntroReveal(element, runtime);
  return { classes, listeners, dispose, enter: () => callback?.([{isIntersecting:true}]), leave: () => callback?.([{isIntersecting:false}]),
    reduce: (value: boolean) => { reduced = value; preference?.(); }, focus: (value: boolean) => { focused = value; },
    counters: () => ({disconnected, unwatched}) };
}

test("滚动入场、退场及再次入场都能更新状态", () => {
  const s = setup();
  assert.equal(s.classes.has("intro-reveal--ready"), true);
  assert.equal(s.classes.has("is-in-view"), false);
  s.enter(); assert.equal(s.classes.has("is-in-view"), true);
  s.leave(); assert.equal(s.classes.has("is-in-view"), false);
  s.enter(); assert.equal(s.classes.has("is-in-view"), true);
  s.dispose();
});
test("减少动画或低性能偏好切换立即显示所有内容，不遗留透明区域", () => {
  const s = setup(); s.reduce(true);
  assert.equal(s.classes.has("intro-reveal--still"), true);
  assert.equal(s.classes.has("is-in-view"), true);
  s.leave(); assert.equal(s.classes.has("is-in-view"), true);
  s.reduce(false); assert.equal(s.classes.has("intro-reveal--still"), false);
  assert.equal(s.classes.has("is-in-view"), false); s.dispose();
});
test("不支持视口观察时保持内容可见，不安装隐藏类", () => {
  const s = setup(false);
  assert.equal(s.classes.size, 0); assert.equal(s.listeners.size, 0); s.dispose();
});
test("键盘焦点不能落在透明控件上，移出焦点后再恢复退场", async () => {
  const s = setup(); s.focus(true); s.listeners.get("focusin")?.();
  s.leave(); assert.equal(s.classes.has("is-in-view"), true);
  s.focus(false); s.listeners.get("focusout")?.(); await Promise.resolve();
  assert.equal(s.classes.has("is-in-view"), false); s.dispose();
});
test("离开页面清理观察器、偏好订阅与焦点事件，迟到回调不能修改页面", () => {
  const s = setup(); s.enter(); s.dispose(); s.enter(); s.reduce(true);
  assert.equal(s.classes.size, 0); assert.equal(s.listeners.size, 0);
  assert.deepEqual(s.counters(), {disconnected:1,unwatched:1});
});
test("介绍页控件不再触发 vendor 无类名控件样式，FAQ 用可收缩列和换行约束", () => {
  const source = readFileSync(new URL("../src/views/IntroView.vue", import.meta.url), "utf8");
  for (const match of source.matchAll(/<(?:button|summary)\b([^>]*)>/g)) assert.match(match[1]!, /class="intro-/);
  const styles = readFileSync(new URL("../src/styles/intro.css", import.meta.url), "utf8");
  assert.match(styles, /\.intro-faq \{[^}]*minmax\(0, 1fr\) minmax\(0, 1\.6fr\)/);
  assert.match(styles, /\.intro-faq-question \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/);
  assert.match(styles, /\.intro-page \.intro-button \{[^}]*background: var\(--surface\);[^}]*background-image: none/);
});
