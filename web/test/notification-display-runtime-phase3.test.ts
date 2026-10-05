import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { defaultUiConfigV2 } from '../../shared/notificationDisplay.ts';
import { applySavedUiConfig } from '../src/notificationConfig.ts';
import { notify, beginProgressNotice, disposeNotifications, type NotificationTone } from '../src/notifications.ts';
import { createNotificationDisplayProbeDom, flushNotificationDisplayProbe as flush } from './fixtures/notification-display-dom.ts';
function setup(ctx: TestContext, reduced = true) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); ctx.mock.method(performance, 'now', () => Date.now());
  return createNotificationDisplayProbeDom({ reduced });
}
function animations() {
  const config = defaultUiConfigV2();
  for (const type of Object.values(config.notificationMotion.types)) Object.assign(type, { enterMs: 0, exitMs: 0, textOutMs: 0, textInMs: 0 });
  config.notificationMotion.stackMs = 0; return config;
}
function ended(element: EventTarget, name: string, transition = false) {
  const event = new Event(transition ? 'transitionend' : 'animationend');
  Object.defineProperty(event, transition ? 'propertyName' : 'animationName', { value: name }); element.dispatchEvent(event);
}

test('四类结果1秒/120秒/手动边界都真实影响DOM，文字长短不改时长', async ctx => {
  const dom = setup(ctx);
  try {
    for (const tone of ['success', 'info', 'warning', 'error'] as NotificationTone[]) {
      for (const ms of [1000, 120000]) {
        const config = animations(); config.notificationDisplay.types[tone] = { mode: 'timed', durationMs: ms };
        notify('很长的反馈'.repeat(100), tone, { previewConfig: config }); await flush();
        ctx.mock.timers.tick(ms - 1); await flush(); assert.equal(dom.region.children.length, 1);
        ctx.mock.timers.tick(1); await flush(); assert.equal(dom.region.children.length, 0);
      }
      const config = animations(); config.notificationDisplay.types[tone] = { mode: 'manual' };
      const handle = notify('手动处理', tone, { previewConfig: config })!; await flush();
      ctx.mock.timers.tick(300000); assert.equal(dom.region.children.length, 1); assert.equal(handle.inspect().remainingMs, null);
      handle.dismiss(); await flush(); assert.equal(dom.region.children.length, 0);
    }
  } finally { dom.restore(); }
});

test('全局v2直接生效，通知创建时快照与后续保存/预览隔离；重复调用不补时间', async ctx => {
  const dom = setup(ctx);
  try {
    const config = animations(); config.revision = 11; config.notificationDisplay.types.info = { mode: 'timed', durationMs: 1000 };
    applySavedUiConfig(config); const first = notify('去重提示', 'info')!; await flush(); ctx.mock.timers.tick(850);
    const changed = structuredClone(config); changed.revision++; changed.notificationDisplay.types.info = { mode: 'manual' }; applySavedUiConfig(changed);
    const duplicate = notify('去重提示', 'info')!; assert.equal(dom.region.children.length, 1);
    assert.equal(duplicate.inspect().remainingMs, 150); assert.equal(first.inspect().revision, 11);
    ctx.mock.timers.tick(150); await flush(); assert.equal(dom.region.children.length, 0);
    const next = notify('新提示', 'info')!; await flush(); assert.equal(next.inspect().revision, 12); assert.equal(next.inspect().remainingMs, null);
    ctx.mock.timers.tick(120000); assert.equal(dom.region.children.length, 1);
    next.dismiss(); await flush();
  } finally { dom.restore(); }
});

test('hover/focus/hidden/blur分别暂停，不能解除另一个原因；恢复仅剩150ms', async ctx => {
  const dom = setup(ctx);
  try {
    const config = animations(); config.notificationDisplay.types.success = { mode: 'timed', durationMs: 1000 };
    const handle = notify('暂停集合', 'success', { previewConfig: config })!; await flush();
    const wrapper = dom.region.children[0]!; ctx.mock.timers.tick(850);
    wrapper.dispatchEvent(new Event('mouseenter')); dom.document.activeElement = wrapper; wrapper.dispatchEvent(new Event('focusin'));
    dom.document.hidden = true; dom.document.focused = false; dom.document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(handle.inspect().pauseReasons.sort(), ['blur', 'focus', 'hidden', 'hover']);
    ctx.mock.timers.tick(10000); wrapper.dispatchEvent(new Event('mouseleave'));
    dom.document.hidden = false; dom.document.dispatchEvent(new Event('visibilitychange')); ctx.mock.timers.tick(10000);
    dom.document.focused = true; dom.window.dispatchEvent(new Event('focus')); ctx.mock.timers.tick(10000);
    assert.equal(handle.inspect().remainingMs, 150); assert.deepEqual(handle.inspect().pauseReasons, ['focus']);
    dom.document.activeElement = null; wrapper.dispatchEvent(new Event('focusout')); await flush();
    ctx.mock.timers.tick(149); assert.equal(dom.region.children.length, 1); ctx.mock.timers.tick(1); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('三条堆叠轮换不扣后台/移动时间，transform结束才恢复原剩余500ms', async ctx => {
  const dom = setup(ctx, false);
  try {
    const config = animations(); config.notificationMotion.stackMs = 400;
    config.notificationDisplay.types.success = { mode: 'timed', durationMs: 1000 }; config.notificationDisplay.types.info = { mode: 'manual' };
    const first = notify('第一条', 'success', { previewConfig: config })!; await flush(); const wrapper = dom.region.children[0]!;
    ctx.mock.timers.tick(500); const second = notify('第二条', 'info', { previewConfig: config })!;
    notify('第三条', 'info', { previewConfig: config }); await flush();
    assert.equal(wrapper.children[0]!.children[0]!.inert, true); ctx.mock.timers.tick(10000);
    assert.equal(first.inspect().remainingMs, 500); wrapper.dispatchEvent(new Event('click')); wrapper.dispatchEvent(new Event('click'));
    assert.ok(first.inspect().pauseReasons.includes('stack')); assert.equal(wrapper.children[0]!.children[0]!.inert, false);
    ended(wrapper, 'opacity', true); ctx.mock.timers.tick(399); assert.equal(first.inspect().remainingMs, 500);
    ended(wrapper, 'transform', true); assert.equal(first.inspect().pauseReasons.length, 0);
    ctx.mock.timers.tick(499); assert.equal(first.inspect().phase, 'capsule'); ctx.mock.timers.tick(1); await flush();
    assert.equal(first.inspect().phase, 'disposed'); assert.equal(dom.region.children.length, 2);
    second.dismiss(); disposeNotifications(); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('最长入场/文字/出场与阅读计时分离，动画事件完成后才开始结果阅读', async ctx => {
  const dom = setup(ctx, false);
  try {
    const config = defaultUiConfigV2();
    config.notificationMotion.types.loading.enterMs = 3000;
    config.notificationMotion.types.error = { enterMs: 3000, exitMs: 3000, textOutMs: 1000, textInMs: 1000 };
    config.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
    const progress = beginProgressNotice('慢入场', { previewConfig: config }); progress.finish('普通错误', 'error');
    const node = dom.region.children[0]!.children[0]!, text = node.children[0]!.children[1]!;
    ctx.mock.timers.tick(2999); assert.equal(progress.inspect().phase, 'enter'); assert.equal(text.textContent, '慢入场');
    ended(node, 'wrong'); assert.equal(progress.inspect().phase, 'enter'); ended(node, 'notification-drop-in');
    assert.equal(progress.inspect().phase, 'text-out'); assert.equal(progress.inspect().remainingMs, null);
    ctx.mock.timers.tick(999); ended(text, 'notification-word-out'); assert.equal(progress.inspect().phase, 'text-in');
    ctx.mock.timers.tick(999); ended(text, 'notification-word-in'); assert.equal(progress.inspect().remainingMs, 1000);
    assert.equal(node.dataset.phase, 'complete'); assert.equal(node.attrs.get('aria-busy'), 'false'); assert.equal(text.attrs.get('role'), 'alert');
    ctx.mock.timers.tick(999); assert.equal(node.dataset.phase, 'complete'); ctx.mock.timers.tick(1); assert.equal(node.dataset.phase, 'exit');
    ctx.mock.timers.tick(2999); assert.equal(dom.region.children.length, 1); ended(node, 'notification-drop-out'); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('连续进度文字更新保持原加载剩余时间，终态只重置一次并使用创建快照', async ctx => {
  const dom = setup(ctx);
  try {
    const config = animations(); config.revision = 4; config.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 1000 };
    config.notificationDisplay.types.warning = { mode: 'timed', durationMs: 8000 };
    const progress = beginProgressNotice('开始', { previewConfig: config }); await flush(); ctx.mock.timers.tick(700);
    progress.update('第一阶段'); progress.update('最后进度'); await flush(); assert.equal(progress.inspect().remainingMs, 300);
    ctx.mock.timers.tick(299); progress.finish('待重试', 'warning'); await flush(); assert.equal(progress.inspect().remainingMs, 8000);
    config.notificationDisplay.types.warning = { mode: 'manual' }; applySavedUiConfig(config);
    progress.finish('不能覆盖', 'error'); progress.update('陈旧进度');
    ctx.mock.timers.tick(7999); assert.equal(dom.region.children.length, 1); assert.equal(progress.inspect().revision, 4);
    ctx.mock.timers.tick(1); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('loading untilSettled长等待不收起，结束采用可定时error结果策略', async ctx => {
  const dom = setup(ctx);
  try {
    const config = animations(); config.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
    const p = beginProgressNotice('等待业务', { previewConfig: config }); await flush(); ctx.mock.timers.tick(300000);
    assert.equal(dom.region.children.length, 1); assert.equal(p.inspect().remainingMs, null);
    p.finish('业务失败', 'error'); await flush(); ctx.mock.timers.tick(1000); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('结果在loading出场期间到达：先完成出场，再重新入场，只出现一条结果', async ctx => {
  const dom = setup(ctx, false);
  try {
    const config = animations(); config.notificationMotion.types.loading.exitMs = 700;
    config.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 1000 };
    config.notificationDisplay.types.success = { mode: 'timed', durationMs: 1000 };
    const p = beginProgressNotice('等待慢任务', { previewConfig: config }); await flush(); ctx.mock.timers.tick(1000);
    assert.equal(p.inspect().phase, 'exit'); p.finish('任务成功'); assert.equal(dom.region.children.length, 1);
    ctx.mock.timers.tick(748); await flush(); assert.equal(dom.region.children.length, 1);
    const node = dom.region.children[0]!.children[0]!;
    assert.equal(node.children[0]!.children[1]!.textContent, '任务成功'); assert.equal(p.inspect().type, 'success'); assert.equal(p.inspect().phase, 'complete');
    assert.equal(node.attrs.get('aria-busy'), 'false'); ctx.mock.timers.tick(1000); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('手动关闭等待不取消任务，隐藏期间更新不重显，终态仍能重显后手动关闭', async ctx => {
  const dom = setup(ctx);
  try {
    const config = animations(); const p = beginProgressNotice('手动收起', { previewConfig: config }); await flush();
    dom.region.children[0]!.children[0]!.children[0]!.children.at(-1)!.dispatchEvent(new Event('click')); await flush();
    assert.equal(dom.region.children.length, 0); assert.equal(p.inspect().phase, 'hidden'); p.update('继续进行'); await flush(); assert.equal(dom.region.children.length, 0);
    p.finish('完成后重新显示', 'error'); await flush(); assert.equal(dom.region.children.length, 1); assert.equal(p.inspect().remainingMs, null);
    dom.region.children[0]!.dispatchEvent(new Event('keydown')); // Other keys cannot dismiss.
    dom.region.children[0]!.children[0]!.children[0]!.children.at(-1)!.dispatchEvent(new Event('click')); await flush();
    p.finish('迟到结果'); ctx.mock.timers.tick(120000); assert.equal(dom.region.children.length, 0); assert.equal(p.inspect().phase, 'disposed');
  } finally { dom.restore(); }
});

test('隐藏pending任务取消/作用域中止/全局卸载后迟到结果不复活且不清其他通知', async ctx => {
  const dom = setup(ctx);
  try {
    for (const mode of ['cancel', 'abort', 'dispose']) {
      const config = animations(); config.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 1000 };
      const scope = new AbortController(), p = beginProgressNotice('等待清理', { previewConfig: config, signal: scope.signal });
      await flush(); ctx.mock.timers.tick(1000); await flush(); assert.equal(dom.region.children.length, 0);
      const other = notify('另一个通知', 'error', { previewConfig: config })!; await flush();
      if (mode === 'cancel') p.cancel(); else if (mode === 'abort') scope.abort(); else disposeNotifications();
      p.finish('不能复活'); p.update('不能复活'); await flush(); ctx.mock.timers.tick(10000);
      assert.equal(dom.region.children.length, mode === 'dispose' ? 0 : 1); assert.equal(p.inspect().phase, 'disposed');
      other.dismiss(); await flush();
    }
  } finally { dom.restore(); }
});

test('async action执行独立暂停并拒绝重复调用；失败error继承策略，原通知继续剩余时间', async ctx => {
  const dom = setup(ctx);
  try {
    const config = animations(); config.notificationDisplay.types.warning = { mode: 'timed', durationMs: 1000 };
    config.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
    let reject!: (error: Error) => void, calls = 0;
    const handle = notify('可重试警告', 'warning', { previewConfig: config,
      action: { label: '重试', run: () => { calls++; return new Promise<void>((_resolve, fail) => { reject = fail; }); } } })!;
    await flush(); ctx.mock.timers.tick(700); const wrapper = dom.region.children[0]!, action = wrapper.children[0]!.children[0]!.children[2]!;
    action.dispatchEvent(new Event('click')); action.dispatchEvent(new Event('click')); assert.equal(calls, 1); assert.equal(action.disabled, true);
    assert.ok(handle.inspect().pauseReasons.includes('action')); ctx.mock.timers.tick(10000); assert.equal(handle.inspect().remainingMs, 300);
    reject(new Error('重试失败')); await flush(); assert.equal(action.disabled, false); assert.equal(dom.region.children.length, 2);
    ctx.mock.timers.tick(1000); await flush(); assert.equal(dom.region.children.length, 1);
    ctx.mock.timers.tick(299); assert.equal(handle.inspect().phase, 'capsule'); ctx.mock.timers.tick(1); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('动态减少动画立即完成阶段但不缩短阅读时长；最长兜底后也完整读一秒', async ctx => {
  const dom = setup(ctx, false);
  try {
    const config = animations(); config.notificationMotion.types.success.enterMs = 3000;
    config.notificationDisplay.types.success = { mode: 'timed', durationMs: 1000 };
    const first = notify('动态减少动画', 'success', { previewConfig: config })!; ctx.mock.timers.tick(2000);
    dom.media.matches = true; dom.media.dispatchEvent(new Event('change')); await flush(); assert.equal(first.inspect().remainingMs, 1000);
    ctx.mock.timers.tick(999); assert.equal(dom.region.children.length, 1); ctx.mock.timers.tick(1); await flush(); assert.equal(dom.region.children.length, 0);
    dom.media.matches = false; dom.root.dataset.motion = 'system';
    const fallback = notify('没有animationend时', 'success', { previewConfig: config })!;
    ctx.mock.timers.tick(3047); assert.equal(fallback.inspect().phase, 'enter'); ctx.mock.timers.tick(1); assert.equal(fallback.inspect().remainingMs, 1000);
    ctx.mock.timers.tick(1000); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('取消早于入场/已完成结果，signal已中止及卸载都清理且不遗留节点', async ctx => {
  const dom = setup(ctx, false);
  try {
    const config = defaultUiConfigV2(), scope = new AbortController(); scope.abort();
    notify('不能显示', 'info', { signal: scope.signal }); const aborted = beginProgressNotice('不能显示', { signal: scope.signal }); aborted.finish('不能显示');
    assert.equal(dom.region.children.length, 0);
    const early = beginProgressNotice('正在入场', { previewConfig: config }); early.cancel(); await flush(); assert.equal(dom.region.children.length, 0);
    const late = beginProgressNotice('已经完成', { previewConfig: config }); late.finish('已完成'); late.cancel(); await flush();
    ctx.mock.timers.tick(120000); assert.equal(dom.region.children.length, 0);
    const controller = new AbortController(); notify('卸载', 'info', { signal: controller.signal }); controller.abort();
    ctx.mock.timers.tick(120000); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('中央源码没有字数/3200ms/Date计时/补1秒，保持安全文字和持久例外兼容', () => {
  const source = readFileSync(new URL('../src/notifications.ts', import.meta.url), 'utf8');
  assert.match(source, /snapshotUiConfigV2/); assert.doesNotMatch(source, /Date\.now|5200|14000|3200|Math\.max\(1000/);
  assert.doesNotMatch(source, /currentTone === 'error'\) return|innerHTML/);
  assert.match(source, /readTimer\.reset\(duration/); assert.match(source, /progressOwners\.delete/);
});
