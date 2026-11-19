import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { defaultUiConfigV2 } from '../../shared/notificationDisplay.ts';
import { notify } from '../src/notifications.ts';
import { createNotificationDisplayProbeDom, flushNotificationDisplayProbe as flush } from './fixtures/notification-display-dom.ts';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
function setup(ctx: TestContext) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); ctx.mock.method(performance, 'now', () => Date.now());
  return createNotificationDisplayProbeDom({ reduced: true });
}
function manual() {
  const config = defaultUiConfigV2();
  for (const type of Object.values(config.notificationMotion.types)) Object.assign(type, { enterMs: 0, exitMs: 0, textOutMs: 0, textInMs: 0 });
  for (const type of ['success', 'info', 'warning', 'error'] as const) config.notificationDisplay.types[type] = { mode: 'manual' };
  config.notificationMotion.stackMs = 0; return config;
}
type Probe = EventTarget & { classes: Set<string>; props: Map<string, string> };
function pointer(target: EventTarget, type: string, y: number) {
  const event = new Event(type);
  Object.defineProperties(event, { pointerId: { value: 1 }, clientY: { value: y }, button: { value: 0 } });
  target.dispatchEvent(event);
}

test('胶囊宽度按实际内容测量，不再按字数估算；关闭按钮不会被挤到第二行', () => {
  const source = read('notifications.ts'), css = read('styles/notifications.css');
  assert.doesNotMatch(source, /message\.length \* 9/);
  assert.match(source, /const CAPSULE_MIN_WIDTH = 220, CAPSULE_MAX_WIDTH = 380;/);
  assert.match(source, /node\.classList\.add\('is-measuring'\); const value = node\.offsetWidth;/);
  assert.match(css, /\.notification-capsule\.is-measuring \{ width: max-content !important; \}/);
  assert.match(css, /\.notification-capsule\.is-measuring \.notification-capsule__text \{ flex: none; white-space: nowrap; \}/);
  assert.match(css, /\.notification-capsule__dot \{ position: relative; flex: 0 0 8px; width: 8px; height: 8px;/);
  assert.doesNotMatch(css, /flex-wrap: wrap/);
});

test('文字切换时在旧文字淡出阶段就调整宽度，单行内容过渡中不折行', () => {
  const source = read('notifications.ts'), css = read('styles/notifications.css');
  assert.match(source, /naturalWidth\(\) - textWidth\(text, text\.textContent \?\? ''\) \+ textWidth\(text, content\)[\s\S]*?node\.dataset\.phase = 'text-out'/);
  assert.match(source, /node\.classList\.remove\('is-content-arriving', 'is-one-line'\)/);
  assert.match(css, /\.notification-capsule\.is-one-line \.notification-capsule__text \{ overflow: hidden; white-space: nowrap; \}/);
  assert.match(css, /\.notification-stack-card \{[^}]*width var\(--notice-stack\) var\(--spring-soft\)/);
});

test('类型只用圆点区分，错误比警告更深；背景卡片切到前面时正文渐显', () => {
  const css = read('styles/notifications.css');
  assert.match(css, /\.notification-capsule--error \{ --notice-dot: var\(--bad-ink\); --notice-halo: var\(--bad-bg\); \}/);
  assert.match(css, /\.notification-capsule--warning \{ --notice-dot: var\(--warn\); --notice-halo: var\(--warn-bg\); \}/);
  assert.match(css, /\.notification-stack-card \.notification-capsule__body \{ transition: opacity var\(--notice-stack\) var\(--ease\)/);
  assert.match(css, /\.notification-stack-card\.is-exiting\.is-background \{ z-index: auto !important; \}/);
  assert.match(css, /\.notification-stack-card \.notification-capsule\.is-leaving \{ animation: notification-drop-out/);
});

test('关闭后面的通知时原地淡出，不跳到最前面', async ctx => {
  const dom = setup(ctx);
  try {
    const config = manual();
    const back = notify('后面的通知', 'info', { previewConfig: config })!;
    notify('最前面的通知', 'success', { previewConfig: config }); await flush();
    const [backWrapper, frontWrapper] = dom.region.children as unknown as Probe[];
    assert.ok(backWrapper!.classes.has('is-background'));
    back.dismiss();
    assert.ok(backWrapper!.classes.has('is-exiting') && backWrapper!.classes.has('is-background'));
    assert.ok(!frontWrapper!.classes.has('is-background'));
    await flush(); assert.equal(dom.region.children.length, 1);
  } finally { dom.restore(); }
});

test('向上拖动超过阈值关闭，轻拖松手弹回；拖动时暂停计时，拖动后的点击不轮换', async ctx => {
  const dom = setup(ctx);
  try {
    const config = manual();
    const handle = notify('向上滑动关闭', 'info', { previewConfig: config })!; await flush();
    const wrapper = dom.region.children[0] as unknown as Probe;
    pointer(wrapper, 'pointerdown', 100); pointer(wrapper, 'pointermove', 97);
    assert.ok(!wrapper.classes.has('is-dragging'));
    pointer(wrapper, 'pointermove', 90); pointer(wrapper, 'pointermove', 60);
    assert.ok(wrapper.classes.has('is-dragging'));
    assert.equal(wrapper.props.get('--drag-y'), '-40px');
    assert.ok(handle.inspect().pauseReasons.includes('drag'));
    pointer(wrapper, 'pointerup', 60); await flush();
    assert.equal(dom.region.children.length, 0);

    notify('后面', 'warning', { previewConfig: config });
    notify('轻拖弹回', 'info', { previewConfig: config }); await flush();
    const [back, front] = dom.region.children as unknown as Probe[];
    pointer(front!, 'pointerdown', 100); pointer(front!, 'pointermove', 92); pointer(front!, 'pointerup', 92);
    assert.ok(!front!.classes.has('is-dragging'));
    assert.equal(front!.props.get('--drag-y'), '0px');
    front!.dispatchEvent(new Event('click'));
    assert.ok(!front!.classes.has('is-background') && back!.classes.has('is-background'));
    pointer(front!, 'pointerdown', 100); front!.dispatchEvent(new Event('click'));
    assert.ok(front!.classes.has('is-background') && !back!.classes.has('is-background'));
  } finally { dom.restore(); }
});
