import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowRevealDirective } from '../src/mail/rowReveal.ts';

function harness() {
  const oldDocument = globalThis.document, oldObserver = globalThis.IntersectionObserver;
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  let callback: (entries: unknown[]) => void = () => {};
  const root = {};
  let focused = false;
  const row = { dataset: {}, closest: () => root, contains: () => focused,
    style: { setProperty() {} }, setAttribute: (k: string, v: string) => attributes.set(k, v),
    classList: { add: (k: string) => classes.add(k), toggle: (k: string, v: boolean) => v ? classes.add(k) : classes.delete(k) } };
  globalThis.document = { activeElement: null } as unknown as Document;
  globalThis.IntersectionObserver = class { constructor(fn: typeof callback) { callback = fn; } observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
  const emit = (ratio: number) => callback([{ target: row, isIntersecting: ratio > 0, intersectionRatio: ratio, boundingClientRect: { top: 100 }, rootBounds: { top: 50 } }]);
  return { row, classes, emit, focus(value: boolean) { focused = value; }, restore() { (rowRevealDirective.beforeUnmount as Function)(row); globalThis.document = oldDocument; globalThis.IntersectionObserver = oldObserver; } };
}

test('Vue 选中/已读 patchClass 不能抹掉行可见性状态', () => {
  const h = harness();
  try {
    (rowRevealDirective.mounted as Function)(h.row); h.emit(.8);
    h.classes.clear(); // Vue replaces className when is-current/is-unread changes.
    assert.equal((h.row.dataset as Record<string, string>).rowReveal, 'visible');
  } finally { h.restore(); }
});

test('观察回调迟到/缺失时内容默认可见，没有观察器也不会隐藏', () => {
  const h = harness();
  try {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    (rowRevealDirective.mounted as Function)(h.row);
    assert.equal((h.row.dataset as Record<string, string>).rowReveal, 'visible');
  } finally { h.restore(); }
});

test('完全滚出才隐藏，焦点保护与滚回恢复不依赖 Vue 类名', () => {
  const h = harness();
  try {
    (rowRevealDirective.mounted as Function)(h.row);
    assert.equal((h.row.dataset as Record<string, string>).rowReveal, 'visible');
    h.emit(0); assert.equal((h.row.dataset as Record<string, string>).rowReveal, 'outside');
    h.focus(true); h.emit(0); assert.equal((h.row.dataset as Record<string, string>).rowReveal, 'visible');
    h.focus(false); h.emit(.01); h.classes.clear();
    assert.equal((h.row.dataset as Record<string, string>).rowReveal, 'visible');
  } finally { h.restore(); }
});

test('卸载后旧观察不能改变新状态或重新隐藏行', () => {
  const h = harness();
  try {
    (rowRevealDirective.mounted as Function)(h.row); h.emit(.8);
    (rowRevealDirective.beforeUnmount as Function)(h.row); h.emit(0);
    assert.equal((h.row.dataset as Record<string, string>).rowReveal, 'visible');
  } finally { h.restore(); }
});

test('选中样式保留 opacity/transform 过渡，减少动画的终态覆盖离场属性', () => {
  const accent = readFileSync(new URL('../src/styles/dashed-accent.css',import.meta.url),'utf8');
  assert.match(accent, /\.mail-list \.mail-row\.is-current[^}]+transition:opacity[^}]+transform[^}]+filter/);
  const css = readFileSync(new URL('../src/styles/workspace.css',import.meta.url),'utf8');
  assert.match(css,/\.mail-list \.mail-row \{ opacity: 1/);
  assert.match(css,/\.mail-list \.mail-row__line[^}]+min-width:0/);
  assert.match(css,/\.mail-list \.mail-row__subject[^}]+min-width:0; flex:1/);
  assert.match(css,/\[data-row-reveal="outside"\]:not\(:focus-within\)/);
  assert.match(css,/@media[^}]*prefers-reduced-motion[\s\S]*\[data-row-reveal="outside"\]:not\(:focus-within\)[^}]+animation:none/);
});

test('阈值边缘仍在列表内的卡片不因不足15%而消失', () => {
  const h = harness();
  try {
    (rowRevealDirective.mounted as Function)(h.row); h.emit(.05);
    assert.equal((h.row.dataset as Record<string, string>).rowReveal, 'visible');
  } finally { h.restore(); }
});
