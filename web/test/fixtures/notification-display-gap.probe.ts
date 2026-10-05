import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { defaultUiConfigV2 } from '../../../shared/notificationDisplay.ts';
import { notify, beginProgressNotice } from '../../src/notifications.ts';
import { createNotificationDisplayProbeDom, flushNotificationDisplayProbe } from './notification-display-dom.ts';

/**
 * Four original gap regressions, now green and imported by the formal phase 3 test entry.
 * Also runnable explicitly with node --test; no skip/todo and no temporary v1 type cast.
 */
function setup(ctx: TestContext) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  ctx.mock.method(performance, 'now', () => Date.now());
  return createNotificationDisplayProbeDom();
}

test('成功胶囊按配置显示1秒，而不是固定最少5.2秒', async ctx => {
  const dom = setup(ctx);
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.success = { mode: 'timed', durationMs: 1000 };
    notify('显示时长探针', 'success', { previewConfig: config });
    await flushNotificationDisplayProbe();
    ctx.mock.timers.tick(999); await flushNotificationDisplayProbe(); assert.equal(dom.region.children.length, 1);
    ctx.mock.timers.tick(1); await flushNotificationDisplayProbe(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('普通错误可按配置1秒关闭，不强制永久显示', async ctx => {
  const dom = setup(ctx);
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
    notify('普通错误探针', 'error', { previewConfig: config });
    await flushNotificationDisplayProbe(); ctx.mock.timers.tick(1000); await flushNotificationDisplayProbe();
    assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('加载结果按警告配置显示8秒，不再固定3.2秒', async ctx => {
  const dom = setup(ctx);
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.warning = { mode: 'timed', durationMs: 8000 };
    const progress = beginProgressNotice('等待结果探针', { previewConfig: config });
    await flushNotificationDisplayProbe(); progress.finish('同步待重试', 'warning'); await flushNotificationDisplayProbe();
    ctx.mock.timers.tick(3200); await flushNotificationDisplayProbe(); assert.equal(dom.region.children.length, 1);
    ctx.mock.timers.tick(4800); await flushNotificationDisplayProbe(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('加载可定时收起且任务结果之后仍显示', async ctx => {
  const dom = setup(ctx);
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 1000 };
    const progress = beginProgressNotice('慢任务探针', { previewConfig: config });
    await flushNotificationDisplayProbe(); ctx.mock.timers.tick(1000); await flushNotificationDisplayProbe();
    assert.equal(dom.region.children.length, 0);
    progress.finish('任务结果仍应显示'); await flushNotificationDisplayProbe(); assert.equal(dom.region.children.length, 1);
  } finally { dom.restore(); }
});
