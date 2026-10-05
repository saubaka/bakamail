import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { defaultUiConfigV2 } from '../../shared/notificationDisplay.ts';
import { createNotificationAppearancePreview, type PreviewRow } from '../src/admin/notificationAppearancePreview.ts';
import { notify } from '../src/notifications.ts';
import { snapshotUiConfigV2 } from '../src/notificationConfig.ts';
import { createNotificationDisplayProbeDom, flushNotificationDisplayProbe as flush } from './fixtures/notification-display-dom.ts';
function setup(ctx: TestContext, reduced = true) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); ctx.mock.method(performance, 'now', () => Date.now());
  const dom = createNotificationDisplayProbeDom({ reduced }); let rows: PreviewRow[] = [];
  const preview = createNotificationAppearancePreview(next => { rows = next; });
  return { dom, preview, rows: () => rows, restore: () => { preview.dispose(); dom.restore(); } };
}
test('预览四类真实1秒计时，不改变全局且退出诊断来自真实handle', async ctx => {
  const f = setup(ctx);
  try {
    const global = snapshotUiConfigV2();
    for (const tone of ['success', 'info', 'warning', 'error'] as const) {
      const config = defaultUiConfigV2(); config.revision = 12; config.notificationDisplay.types[tone] = { mode: 'timed', durationMs: 1000 };
      f.preview.result(config, tone); await flush(); ctx.mock.timers.tick(200); await flush();
      assert.equal(f.rows().at(-1)?.revision, 12); assert.equal(f.rows().at(-1)?.remainingMs, 800);
      ctx.mock.timers.tick(800); await flush(); ctx.mock.timers.tick(200); await flush();
      assert.equal(f.dom.region.children.length, 0); assert.equal(f.rows().at(-1)?.phase, 'disposed');
    }
    assert.deepEqual(snapshotUiConfigV2(), global);
  } finally { f.restore(); }
});
test('预览手动错误长期保持；真实hover原因和暂停剩余显示，clear不清普通通知', async ctx => {
  const f = setup(ctx);
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
    notify('正式提示不属于预览', 'warning');
    f.preview.result(config, 'error'); await flush(); ctx.mock.timers.tick(200);
    f.dom.region.children.at(-1)!.dispatchEvent(new Event('mouseenter')); ctx.mock.timers.tick(2000); await flush();
    assert.equal(f.rows().at(-1)?.remainingMs, 800); assert.ok(f.rows().at(-1)?.pauseReasons.includes('hover'));
    f.preview.clear(); assert.equal(f.rows().length, 0); assert.equal(f.dom.region.children.length, 1);
    config.notificationDisplay.types.error = { mode: 'manual' }; f.preview.result(config, 'error'); await flush();
    ctx.mock.timers.tick(120000); await flush(); assert.equal(f.rows().at(-1)?.remainingMs, null); assert.equal(f.dom.region.children.length, 2);
  } finally { f.restore(); }
});
test('加载收起后显示真实隐藏诊断，模拟终态重新显示且手动完成不重复', async ctx => {
  const f = setup(ctx);
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 1000 };
    config.notificationDisplay.types.success = { mode: 'timed', durationMs: 1000 };
    f.preview.progress(config, 'success', true); await flush(); ctx.mock.timers.tick(1000); await flush(); ctx.mock.timers.tick(200); await flush();
    assert.equal(f.dom.region.children.length, 0); assert.equal(f.rows().at(-1)?.phase, 'hidden');
    f.preview.finishWaiting(); await flush(); assert.equal(f.dom.region.children.length, 1);
    ctx.mock.timers.tick(200); assert.equal(f.rows().at(-1)?.type, 'success'); assert.equal(f.rows().at(-1)?.remainingMs, 800);
    ctx.mock.timers.tick(5000); await flush(); ctx.mock.timers.tick(200); assert.equal(f.dom.region.children.length, 0);
    assert.equal(f.rows().at(-1)?.phase, 'disposed');
  } finally { f.restore(); }
});
test('加载→失败、untilSettled等待与堆叠背景时钟都是生产行为', async ctx => {
  const f = setup(ctx);
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
    f.preview.progress(config, 'error'); await flush(); ctx.mock.timers.tick(2380); await flush(); ctx.mock.timers.tick(200);
    assert.equal(f.rows().at(-1)?.type, 'error'); ctx.mock.timers.tick(1000); await flush();
    f.preview.clear(); f.preview.progress(config); await flush(); ctx.mock.timers.tick(120000); await flush();
    assert.equal(f.rows().at(-1)?.remainingMs, null); assert.equal(f.dom.region.children.length, 1);
    f.preview.clear(); f.preview.stack(config); await flush(); ctx.mock.timers.tick(200);
    assert.equal(f.rows().length, 3); assert.equal(f.rows()[0]?.remainingMs, 5000); assert.ok(f.rows()[0]?.pauseReasons.includes('background'));
  } finally { f.restore(); }
});
test('清理/卸载中止所有预览与模拟任务，迟到结果不复活，有限诊断避免无限增长', async ctx => {
  const f = setup(ctx);
  try {
    f.preview.progress(defaultUiConfigV2(), 'success'); await flush(); f.preview.clear();
    ctx.mock.timers.tick(10000); await flush(); assert.equal(f.dom.region.children.length, 0); assert.equal(f.rows().length, 0);
    for (let i = 0; i < 13; i++) f.preview.result(defaultUiConfigV2(), 'error');
    await flush(); assert.equal(f.rows().length, 1); assert.equal(f.dom.region.children.length, 1);
    f.preview.dispose(); ctx.mock.timers.tick(300000); await flush(); assert.equal(f.dom.region.children.length, 0);
    f.preview.result(defaultUiConfigV2(), 'success'); f.preview.progress(defaultUiConfigV2()); assert.equal(f.dom.region.children.length, 0);
  } finally { f.restore(); }
});

test('收起后结果模拟等待包含最长文字动画，不能在文字切换暂停期间过早结束', async ctx => {
  const f = setup(ctx, false);
  try {
    const config = defaultUiConfigV2();
    for (const timing of Object.values(config.notificationMotion.types)) Object.assign(timing, { enterMs: 0, exitMs: 0, textOutMs: 0, textInMs: 0 });
    Object.assign(config.notificationMotion.types.loading, { textOutMs: 1000, textInMs: 1000 });
    config.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 1000 };
    f.preview.progress(config, 'success', true); await flush();
    ctx.mock.timers.tick(400); await flush(); ctx.mock.timers.tick(1048); await flush();
    ctx.mock.timers.tick(1048); await flush(); ctx.mock.timers.tick(600); await flush(); ctx.mock.timers.tick(200); await flush();
    assert.equal(f.dom.region.children.length, 0); assert.equal(f.rows().at(-1)?.phase, 'hidden');
    ctx.mock.timers.tick(1204); await flush(); ctx.mock.timers.tick(200); await flush();
    assert.equal(f.dom.region.children.length, 1); assert.equal(f.rows().at(-1)?.type, 'success');
  } finally { f.restore(); }
});
