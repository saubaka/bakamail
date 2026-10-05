import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { defaultUiConfig } from '../../shared/notificationMotion.ts';
import { createUiConfigClient, applySavedUiConfig, snapshotUiConfig } from '../src/notificationConfig.ts';
import { notificationTimeline, waitForNoticeAnimation } from '../src/notificationTiming.ts';
import { notify, beginProgressNotice, disposeNotifications } from '../src/notifications.ts';
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
test('通知所有动画与清理使用配置快照，不保留独立固定时长', () => {
  const js = source('notifications.ts');
  assert.match(js, /snapshotUiConfig/);
  assert.doesNotMatch(js, /reduced \? 0 : (780|720|160)/);
  const css = source('styles/notifications.css');
  for (const variable of ['notice-enter', 'notice-exit', 'notice-text-out', 'notice-text-in', 'notice-stack']) assert.ok(css.includes(`var(--${variable}`));
});

test('五类独立时间表：0/默认/最长边界，初次文字和退场文字从各自总时长派生', () => {
  const config = defaultUiConfig();
  for (const [index, type] of ['success', 'info', 'warning', 'error', 'loading'].entries()) {
    const key = type as keyof typeof config.notificationMotion.types;
    config.notificationMotion.types[key] = { enterMs: index * 100, exitMs: index * 150, textOutMs: index * 20, textInMs: index * 40 };
    const t = notificationTimeline(config, key);
    assert.equal(t.enterMs, index * 100); assert.equal(t.exitMs, index * 150);
    assert.equal(t.copyDelayMs + t.copyInMs, t.enterMs);
    assert.ok(t.copyOutMs <= t.exitMs);
    assert.equal(t.textOutMs, index * 20); assert.equal(t.textInMs, index * 40);
    assert.ok(Object.values(notificationTimeline(config, key, true)).every(ms => ms === 0));
  }
  config.notificationMotion.types.loading = { enterMs: 3000, exitMs: 3000, textOutMs: 1000, textInMs: 1000 };
  assert.equal(notificationTimeline(config, 'loading').copyDelayMs, 2400);
});

test('动画完成事件按目标/动画名过滤、取消幂等、最长兜底与0ms清理', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] });
  const element = new EventTarget(); let done = 0;
  const job = waitForNoticeAnimation(element, 'exit', 3000, () => done++);
  const event = (name: string) => { const e = new Event('animationend'); Object.defineProperty(e, 'animationName', { value: name }); element.dispatchEvent(e); };
  event('unrelated'); assert.equal(done, 0); ctx.mock.timers.tick(2999); assert.equal(done, 0);
  event('exit'); job.finish(); ctx.mock.timers.tick(50); assert.equal(done, 1);
  waitForNoticeAnimation(element, 'enter', 3000, () => done++); ctx.mock.timers.tick(3048); assert.equal(done, 2);
  const canceled = waitForNoticeAnimation(element, 'canceled', 100, () => done++); canceled.cancel(); ctx.mock.timers.tick(148); assert.equal(done, 2);
  const zero = waitForNoticeAnimation(element, 'zero', 0, () => done++); zero.cancel(); await Promise.resolve(); assert.equal(done, 2);
  waitForNoticeAnimation(element, 'zero', 0, () => done++); await Promise.resolve(); assert.equal(done, 3);
});

test('公共配置请求同源/无重定向、单飞/ETag/边界节流与副本隔离', async () => {
  let count = 0, resolve: (response: Response) => void = () => {};
  const client = createUiConfigClient(async (path, options) => {
    count++; assert.equal(path, '/api/ui-config?schemaVersion=2'); assert.equal(options?.credentials, 'same-origin'); assert.equal(options?.redirect, 'error');
    if (count === 1) return new Promise<Response>(done => { resolve = done; });
    assert.equal(new Headers(options?.headers).get('if-none-match'), '"test-config"');
    return new Response(null, { status: 304 });
  });
  const config = defaultUiConfig(); config.revision = 2; config.notificationMotion.types.info.enterMs = 123;
  const a = client.refresh(true), b = client.refresh(true); assert.equal(a, b); assert.equal(count, 1);
  resolve(Response.json({ ok: true, data: config, error: '' }, { headers: { etag: '"test-config"', 'cache-control': 'no-cache' } }));
  await a; assert.deepEqual(client.snapshot(), config);
  const snapshot = client.snapshot(); snapshot.notificationMotion.types.info.enterMs = 999; assert.equal(client.snapshot().notificationMotion.types.info.enterMs, 123);
  await client.refresh(); assert.equal(count, 1); await client.refresh(true); assert.equal(count, 2); assert.deepEqual(client.snapshot(), config); client.dispose();
});

test('网络/未知版本/无缓存降级不阻塞页面，保存时迟到的旧请求不能回写', async () => {
  const offline = createUiConfigClient(async () => { throw new Error('offline'); });
  const previous = defaultUiConfig(); previous.revision = 5; previous.notificationMotion.stackMs = 888; offline.applySaved(previous);
  await offline.refresh(true); assert.deepEqual(offline.snapshot(), defaultUiConfig());
  const unknown = createUiConfigClient(async () => Response.json({ ok: true, data: { ...defaultUiConfig(), schemaVersion: 99 } }));
  await unknown.refresh(true); assert.deepEqual(unknown.snapshot(), defaultUiConfig());
  let resolve: (response: Response) => void = () => {};
  const late = createUiConfigClient(() => new Promise<Response>(done => { resolve = done; }));
  const fetching = late.refresh(true); const saved = defaultUiConfig(); saved.revision = 4; saved.notificationMotion.stackMs = 44;
  assert.ok(late.applySaved(saved)); resolve(Response.json({ ok: true, data: defaultUiConfig() })); await fetching;
  assert.deepEqual(late.snapshot(), saved); assert.equal(late.applySaved({}), false); late.dispose(); offline.dispose(); unknown.dispose();
  let requests = 0;
  const fallback = createUiConfigClient(async (_path, options) => { requests++; assert.equal(new Headers(options?.headers).has('if-none-match'), false);
    return Response.json({ ok: true, data: defaultUiConfig() }, { headers: { etag: '"must-not-cache"', 'cache-control': 'no-store' } }); });
  await fallback.refresh(true); await fallback.refresh(true); assert.equal(requests, 2); fallback.dispose();
});

test('配置请求4秒有界超时；超时后忽略传输层迟到的响应', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve: (response: Response) => void = () => {};
  const client = createUiConfigClient(() => new Promise<Response>(done => { resolve = done; }));
  const pending = client.refresh(true); ctx.mock.timers.tick(4000); await pending;
  const late = defaultUiConfig(); late.revision = 10;
  resolve(Response.json({ ok: true, data: late })); await new Promise<void>(done => setImmediate(done));
  assert.deepEqual(client.snapshot(), defaultUiConfig()); client.dispose();
});

class FakeElement extends EventTarget {
  children: FakeElement[] = []; parentElement: FakeElement | null = null; dataset: Record<string, string> = {};
  attrs = new Map<string, string>(); props = new Map<string, string>(); classes = new Set<string>();
  textContent = ''; tabIndex = -1; inert = false; disabled = false; offsetHeight = 56; hovered = false;
  readonly tag: string;
  constructor(tag = 'div') { super(); this.tag = tag; }
  get className() { return [...this.classes].join(' '); } set className(value: string) { this.classes = new Set(value.split(' ')); }
  classList = { add: (...v: string[]) => v.forEach(x => this.classes.add(x)), remove: (...v: string[]) => v.forEach(x => this.classes.delete(x)),
    toggle: (v: string, on: boolean) => { if (on) this.classes.add(v); else this.classes.delete(v); }, contains: (v: string) => this.classes.has(v) };
  style = { setProperty: (key: string, value: string) => this.props.set(key, value) };
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  append(...nodes: FakeElement[]) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
  contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector: string) { return selector === ':hover' && this.hovered; }
  closest(selector: string) { return selector.includes(this.tag) ? this : null; }
  querySelector() { return null; }
  focus() { (globalThis.document as any).activeElement = this; }
}
function fakeBrowser() {
  const before = { document: globalThis.document, window: globalThis.window, matchMedia: globalThis.matchMedia, MutationObserver: globalThis.MutationObserver, ResizeObserver: globalThis.ResizeObserver };
  const region = new FakeElement(), body = new FakeElement(), root = new FakeElement(); body.append(region);
  const doc = Object.assign(new EventTarget(), { documentElement: root, body, hidden: false, activeElement: null,
    hasFocus: () => true, createElement: (tag: string) => new FakeElement(tag), getElementById: (id: string) => id === 'toast-region' ? region : null, querySelectorAll: () => [] });
  const preferenceCallbacks: (() => void)[] = [];
  const media = Object.assign(new EventTarget(), { matches: false });
  globalThis.document = doc as unknown as Document; globalThis.window = new EventTarget() as unknown as Window & typeof globalThis;
  globalThis.matchMedia = (() => media) as unknown as typeof matchMedia;
  globalThis.MutationObserver = class { callback: () => void; constructor(callback: () => void) { this.callback = callback; } observe(target: unknown) { if (target === root) preferenceCallbacks.push(this.callback); } disconnect() {} } as unknown as typeof MutationObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
  return { region, doc, root, reduce() { root.dataset.motion = 'reduce'; for (const callback of preferenceCallbacks) callback(); },
    restore() { disposeNotifications(); Object.assign(globalThis, before); applySavedUiConfig(defaultUiConfig()); } };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

test('实际通知控制器：预览/全站/进行中快照隔离，退场最长时长不提前移除', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); const browser = fakeBrowser();
  try {
    const saved = defaultUiConfig(); saved.revision = 2; saved.notificationMotion.types.info.enterMs = 100;
    applySavedUiConfig(saved);
    const a = notify('全站提示', 'info')!; const first = browser.region.children[0]!.children[0]!;
    assert.equal(first.props.get('--notice-enter'), '100ms');
    const preview = defaultUiConfig(); preview.notificationMotion.types.error.exitMs = 3000;
    const b = notify('预览错误', 'error', { previewConfig: preview })!;
    assert.deepEqual(snapshotUiConfig(), saved); assert.equal(first.props.get('--notice-enter'), '100ms');
    saved.notificationMotion.types.info.enterMs = 200; applySavedUiConfig(saved);
    assert.equal(first.props.get('--notice-enter'), '100ms');
    b.dismiss(); ctx.mock.timers.tick(2999); assert.equal(browser.region.children.length, 2);
    ctx.mock.timers.tick(49); assert.equal(browser.region.children.length, 1); a.dismiss(); ctx.mock.timers.tick(728); assert.equal(browser.region.children.length, 0);
  } finally { browser.restore(); }
});

test('加载→错误使用目标快照的文字阶段，不重放入场；减少动画立即终结且错误不自动消失', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); const browser = fakeBrowser();
  try {
    const config = defaultUiConfig(); config.notificationMotion.types.loading.enterMs = 100;
    config.notificationMotion.types.error.textOutMs = 900; config.notificationMotion.types.error.textInMs = 800;
    const p = beginProgressNotice('正在测试加载', { previewConfig: config });
    const node = browser.region.children[0]!.children[0]!; const text = node.children[0]!.children[1]!;
    p.finish('测试失败', 'error'); ctx.mock.timers.tick(148); assert.equal(node.dataset.phase, 'text-out'); assert.equal(text.textContent, '正在测试加载');
    assert.equal(node.props.get('--notice-text-out'), '900ms'); ctx.mock.timers.tick(948);
    assert.equal(node.dataset.phase, 'text-in'); assert.equal(text.textContent, '测试失败'); assert.equal(node.attrs.get('aria-busy'), 'false');
    browser.reduce(); await flush(); assert.equal(node.dataset.phase, 'complete'); assert.equal(node.props.get('--notice-exit'), '0ms');
    ctx.mock.timers.tick(20000); assert.equal(browser.region.children.length, 1);
    p.cancel(); await flush(); assert.equal(browser.region.children.length, 0);
  } finally { browser.restore(); }
});

test('0ms、提前取消、作用域卸载清理，背景通知不可交互且共享堆叠时间', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] }); const browser = fakeBrowser();
  try {
    const config = defaultUiConfig(); config.notificationMotion.stackMs = 777;
    for (const timing of Object.values(config.notificationMotion.types)) for (const key of Object.keys(timing)) (timing as any)[key] = 0;
    const scope = new AbortController();
    const p = beginProgressNotice('立即完成', { previewConfig: config, signal: scope.signal }); p.finish('已完成'); await flush();
    const first = browser.region.children[0]!; assert.equal(first.children[0]!.dataset.phase, 'complete');
    const notice = notify('第二条', 'info', { previewConfig: config, signal: scope.signal })!; await flush();
    assert.equal(first.children[0]!.children[0]!.inert, true); assert.equal(first.props.get('--notice-stack'), '777ms');
    notice.dismiss(); await flush(); assert.equal(browser.region.children.length, 1);
    const early = beginProgressNotice('早退', { previewConfig: config, signal: scope.signal }); early.cancel(); await flush(); assert.equal(browser.region.children.length, 1);
    scope.abort(); assert.equal(browser.region.children.length, 0); ctx.mock.timers.tick(5000); await flush(); assert.equal(browser.region.children.length, 0);
  } finally { browser.restore(); }
});

test('加载中的文字更新实际使用loading时长；进行中文字切换时完成也不丢最终结果', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); const browser = fakeBrowser();
  try {
    const config = defaultUiConfig(); config.notificationMotion.types.loading = { enterMs: 0, exitMs: 700, textOutMs: 600, textInMs: 800 };
    const p = beginProgressNotice('初始加载', { previewConfig: config }); await flush();
    const node = browser.region.children[0]!.children[0]!;
    p.update('正在整理'); assert.equal(node.props.get('--notice-text-out'), '600ms'); assert.equal(node.props.get('--notice-text-in'), '800ms');
    p.finish('最终完成'); ctx.mock.timers.tick(648); assert.equal(node.attrs.get('aria-busy'), 'true');
    ctx.mock.timers.tick(848); assert.equal(node.dataset.phase, 'text-out'); assert.equal(node.props.get('--notice-text-out'), '160ms');
    ctx.mock.timers.tick(208); ctx.mock.timers.tick(388);
    assert.equal(node.children[0]!.children[1]!.textContent, '最终完成'); assert.equal(node.dataset.phase, 'complete'); assert.equal(node.attrs.get('aria-busy'), 'false');
    p.update('迟到更新'); assert.equal(node.dataset.phase, 'complete'); p.cancel(); ctx.mock.timers.tick(728);
  } finally { browser.restore(); }
});

test('前景停留计时不被重复激活重置；隐藏时暂停，恢复只使用剩余时间', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); const browser = fakeBrowser();
  ctx.mock.method(performance, 'now', () => Date.now());
  try {
    const config = defaultUiConfig(); config.notificationMotion.types.info.enterMs = 0; config.notificationMotion.types.info.exitMs = 0;
    notify('计时测试', 'info', { previewConfig: config }); await flush();
    ctx.mock.timers.tick(2000); browser.doc.dispatchEvent(new Event('visibilitychange'));
    ctx.mock.timers.tick(1000); browser.doc.hidden = true; browser.doc.dispatchEvent(new Event('visibilitychange'));
    ctx.mock.timers.tick(10000); assert.equal(browser.region.children.length, 1);
    browser.doc.hidden = false; browser.doc.dispatchEvent(new Event('visibilitychange'));
    // v1 previews upgrade to the v2 info default of 6s, not the old fixed 5.2s.
    ctx.mock.timers.tick(2999); assert.equal(browser.region.children.length, 1);
    ctx.mock.timers.tick(1); await flush(); assert.equal(browser.region.children.length, 0);
  } finally { browser.restore(); }
});
test('后台主题设置是独立面板，完整五类字段、预览和冲突防覆盖', () => {
  assert.match(source('views/admin/SystemView.vue'), /NotificationAppearance/);
  const ui = source('components/admin/NotificationAppearance.vue');
  assert.match(ui, /撤销未保存编辑/); assert.match(ui, /恢复显示默认/); assert.match(ui, /恢复动画默认/);
  assert.match(source('admin/notificationAppearancePreview.ts'), /previewConfig/);
  assert.match(source('admin/notificationAppearanceEditor.ts'), /409/);
});
