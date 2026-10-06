import test from 'node:test';
import assert from 'node:assert/strict';
import { bindComposeViewport, composeVisibleViewport } from '../src/mail/composeViewport.ts';

class Events {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(name: string, callback: () => void) { const set = this.listeners.get(name) ?? new Set(); set.add(callback); this.listeners.set(name, set); }
  removeEventListener(name: string, callback: () => void) { this.listeners.get(name)?.delete(callback); }
  emit(name: string) { this.listeners.get(name)?.forEach(callback => callback()); }
  count() { return [...this.listeners.values()].reduce((total, set) => total + set.size, 0); }
}
function harness(hasViewport = true) {
  const viewport = Object.assign(new Events(), { height: 844, offsetTop: 0, scale: 1 });
  const frames = new Map<number, FrameRequestCallback>(); let id = 0;
  const host = Object.assign(new Events(), { innerWidth: 390, innerHeight: 844,
    visualViewport: hasViewport ? viewport : null,
    document: { documentElement: { clientHeight: 844 }, activeElement: null },
    requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (key: number) => { frames.delete(key); },
  });
  const properties = new Map<string, string>(), attributes = new Set<string>();
  const element = { setAttribute: (key: string) => attributes.add(key), removeAttribute: (key: string) => attributes.delete(key),
    style: { setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key) },
    querySelector: () => null,
  } as unknown as HTMLDialogElement;
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); };
  return { viewport, host, element, properties, attributes, frames, flush };
}
test('可见区域约束高度和偏移，非法或零高度不压缩写信窗口', () => {
  assert.deepEqual(composeVisibleViewport(844, 370, 200), { height: 370, top: 200 });
  assert.deepEqual(composeVisibleViewport(844, 1000, 10), { height: 844, top: 0 });
  assert.deepEqual(composeVisibleViewport(844, 370, 800), { height: 370, top: 474 });
  assert.deepEqual(composeVisibleViewport(844, 370, -20), { height: 370, top: 0 });
  for (const height of [0, -1, NaN, Infinity]) assert.equal(composeVisibleViewport(844, height, 0), null);
});
test('软键盘只缩小visualViewport时跟随高度，帧合并且关闭卸载移除监听', () => {
  const h = harness(); const stop = bindComposeViewport(h.element, h.host as unknown as Window);
  assert.equal(h.properties.get('--compose-visible-height'), '844px');
  h.viewport.height = 370; h.viewport.offsetTop = 40;
  h.viewport.emit('resize'); h.viewport.emit('scroll'); h.host.emit('resize');
  assert.equal(h.frames.size, 1); h.flush();
  assert.equal(h.properties.get('--compose-visible-height'), '370px');
  assert.equal(h.properties.get('--compose-visible-top'), '40px');
  h.viewport.emit('resize'); stop(true);
  assert.equal(h.frames.size, 0); assert.equal(h.viewport.count(), 0); assert.equal(h.host.count(), 0);
  assert.equal(h.properties.get('--compose-visible-height'), '370px', '退场保留最后的几何，避免关闭时跳动');
  stop(); assert.equal(h.properties.size, 0); assert.equal(h.attributes.size, 0);
});
test('桌面和无visualViewport回退原生布局，缩放不重排，异常测量不覆盖有效高度', () => {
  const h = harness(); const stop = bindComposeViewport(h.element, h.host as unknown as Window);
  h.viewport.scale = 2; h.viewport.height = 100; h.viewport.emit('resize'); h.flush();
  assert.equal(h.properties.get('--compose-visible-height'), '844px');
  h.viewport.scale = 1; h.viewport.height = 0; h.viewport.emit('resize'); h.flush();
  assert.equal(h.properties.get('--compose-visible-height'), '844px');
  h.host.innerWidth = 1280; h.host.emit('resize'); h.flush(); assert.equal(h.properties.size, 0); stop();
  const legacy = harness(false); const clear = bindComposeViewport(legacy.element, legacy.host as unknown as Window);
  assert.equal(legacy.attributes.size, 0); clear(); assert.equal(legacy.host.count(), 0);
});
test('键盘高度改变只滚动自身表单，露出当前编辑字段且不改变焦点', () => {
  const h = harness();
  const field = { getBoundingClientRect: () => ({ top: 250, bottom: 400 }) };
  const form = { scrollTop: 0, contains: (el: unknown) => el === field,
    getBoundingClientRect: () => ({ top: 100, bottom: 300 }),
  };
  Object.assign(h.host.document, { activeElement: field });
  Object.assign(h.element, { querySelector: () => form });
  const stop = bindComposeViewport(h.element, h.host as unknown as Window);
  assert.equal(form.scrollTop, 112);
  assert.equal(h.host.document.activeElement, field);
  Object.assign(field, { getBoundingClientRect: () => ({ top: 80, bottom: 120 }) });
  h.viewport.height = 370; h.viewport.emit('resize'); h.flush();
  assert.equal(form.scrollTop, 80); assert.equal(h.host.document.activeElement, field);
  stop();
});
