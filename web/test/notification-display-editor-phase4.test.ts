import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyUiConfigV2, defaultUiConfigV2 } from '../../shared/notificationDisplay.ts';
import { createNotificationAppearanceEditor } from '../src/admin/notificationAppearanceEditor.ts';

function fixture() {
  let stored = defaultUiConfigV2(), failure: unknown = null, invalid: unknown = undefined;
  const calls: { path: string; method?: string; body?: unknown }[] = [], applied: unknown[] = [], feedback: string[] = [];
  const editor = createNotificationAppearanceEditor({
    request: async (path, options) => {
      calls.push({ path, method: options.method, body: options.body });
      if (failure) throw failure;
      if (invalid !== undefined) return invalid;
      if (options.method === 'PATCH') { stored = copyUiConfigV2(options.body!); stored.revision++; }
      const result = copyUiConfigV2(stored);
      return { notificationDisplay: result.notificationDisplay, notificationMotion: result.notificationMotion, revision: result.revision, schemaVersion: result.schemaVersion };
    }, apply: config => applied.push(config), feedback: message => feedback.push(message),
  });
  return { editor, calls, applied, feedback, config: () => copyUiConfigV2(stored), setConfig: (config: typeof stored) => { stored = config; },
    fail: (error: unknown) => { failure = error; }, invalid: (value: unknown) => { invalid = value; } };
}
test('管理读取显式v2且严格完整，初始未读取不可编辑、保存或预览草稿', async () => {
  const f = fixture(); assert.equal(f.editor.state.blocked, true); await f.editor.save(); assert.equal(f.calls.length, 0);
  await f.editor.load(); assert.equal(f.calls[0]?.path, '/api/admin/appearance?schemaVersion=2');
  assert.equal(f.editor.state.blocked, false); assert.equal(f.editor.dirty.value, false); assert.equal(f.editor.valid.value, true);
  assert.deepEqual(f.editor.candidate(), f.config()); f.editor.dispose();
});
test('五类秒数1/120边界转换毫秒，空值/小数/字符串/非有限数均不能保存', async () => {
  const f = fixture(); await f.editor.load();
  for (const type of ['success', 'info', 'warning', 'error', 'loading'] as const) {
    f.editor.mode(type, true);
    for (const seconds of [1, 120]) { f.editor.state.seconds[type] = seconds; assert.equal(f.editor.valid.value, true);
      assert.equal((f.editor.candidate().notificationDisplay.types[type] as { durationMs: number }).durationMs, seconds * 1000); }
    for (const bad of ['', '2', 0, 121, 1.5, NaN, Infinity]) {
      f.editor.state.seconds[type] = bad; assert.equal(f.editor.valid.value, false); await f.editor.save();
      assert.equal(f.calls.filter(call => call.method).length, 0);
    }
    f.editor.state.seconds[type] = 3;
  }
  f.editor.dispose();
});
test('模式切换记住草稿秒数，manual/untilSettled提交严格省略duration', async () => {
  const f = fixture(); await f.editor.load();
  for (const type of ['error', 'loading'] as const) {
    f.editor.mode(type, true); f.editor.state.seconds[type] = 37;
    f.editor.mode(type, false); assert.deepEqual(f.editor.candidate().notificationDisplay.types[type], { mode: type === 'loading' ? 'untilSettled' : 'manual' });
    f.editor.mode(type, true); assert.equal((f.editor.candidate().notificationDisplay.types[type] as { durationMs: number }).durationMs, 37000);
  } f.editor.dispose();
});
test('显示/动画预设与恢复彼此独立，撤销同时恢复已保存完整版本', async () => {
  const f = fixture(); await f.editor.load(); f.editor.state.draft.notificationMotion.types.info.enterMs = 1234;
  f.editor.displayPreset('quick'); assert.equal(f.editor.state.draft.notificationMotion.types.info.enterMs, 1234);
  assert.deepEqual(f.editor.candidate().notificationDisplay.types.info, { mode: 'timed', durationMs: 4000 });
  const display = f.editor.candidate().notificationDisplay;
  f.editor.motionPreset('quick'); f.editor.motionPreset('default'); assert.deepEqual(f.editor.candidate().notificationDisplay, display);
  f.editor.displayPreset('default'); assert.equal(f.editor.state.draft.notificationMotion.stackMs, 320);
  f.editor.undo(); assert.deepEqual(f.editor.candidate(), f.config()); assert.equal(f.editor.dirty.value, false); f.editor.dispose();
});
test('完整同revision提交显示和动画，确认后才应用全局，返回顺序不同仍可验证', async () => {
  const f = fixture(); await f.editor.load(); f.editor.state.seconds.success = 1; f.editor.state.draft.notificationMotion.stackMs = 999;
  await f.editor.save(); assert.equal(f.calls[1]?.path, '/api/admin/appearance?schemaVersion=2');
  assert.equal((f.calls[1]?.body as { schemaVersion: number }).schemaVersion, 2);
  assert.equal(f.config().notificationMotion.stackMs, 999); assert.deepEqual(f.config().notificationDisplay.types.success, { mode: 'timed', durationMs: 1000 });
  assert.equal(f.applied.length, 2); assert.equal(f.editor.state.saved?.revision, 1); assert.equal(f.editor.dirty.value, false); f.editor.dispose();
});
test('503/403/未知/v1管理响应不成为默认编辑表单，恢复才能正常读取', async () => {
  for (const bad of [new Error('503'), { status: 403 }, { schemaVersion: 99 }, { schemaVersion: 1, revision: 0, notificationMotion: defaultUiConfigV2().notificationMotion }]) {
    const f = fixture(); if (bad instanceof Error || 'status' in bad) f.fail(bad); else f.invalid(bad);
    await f.editor.load(); assert.equal(f.editor.state.saved, null); assert.equal(f.editor.state.blocked, true); await f.editor.save();
    assert.equal(f.calls.filter(call => call.method).length, 0); assert.equal(f.applied.length, 0);
    f.fail(null); f.invalid(undefined); await f.editor.load(); assert.equal(f.editor.state.blocked, false); f.editor.dispose();
  }
});
test('409保留完整草稿，重新读必须人工选择；保留只换revision，不自动PATCH', async () => {
  const f = fixture(); await f.editor.load(); f.editor.state.seconds.info = 19; f.editor.state.draft.notificationMotion.stackMs = 777;
  f.fail({ status: 409 }); await f.editor.save(); assert.equal(f.editor.state.blocked, true); assert.equal(f.editor.state.seconds.info, 19);
  const remote = f.config(); remote.revision = 8; remote.notificationMotion.stackMs = 555; f.setConfig(remote); f.fail(null);
  await f.editor.load(); assert.equal(f.editor.state.incoming?.revision, 8); assert.equal(f.editor.state.blocked, true);
  assert.equal(f.editor.state.draft.notificationMotion.stackMs, 777); assert.equal(f.editor.state.seconds.info, 19);
  await f.editor.save(); assert.equal(f.calls.filter(call => call.method).length, 1);
  f.editor.review(true); assert.equal(f.editor.state.draft.revision, 8); assert.equal(f.editor.state.draft.notificationMotion.stackMs, 777);
  assert.equal(f.editor.state.saved?.notificationMotion.stackMs, 555); assert.equal(f.editor.state.blocked, false);
  assert.equal(f.calls.filter(call => call.method).length, 1);
  await f.editor.save(); assert.equal(f.config().revision, 9); assert.equal(f.config().notificationMotion.stackMs, 777); f.editor.dispose();
});
test('不确定保存不重试，读回后可明确放弃草稿，非法草稿恢复期间也保持', async () => {
  const f = fixture(); await f.editor.load(); f.editor.state.seconds.success = '';
  f.fail(new Error('读故障')); await f.editor.load(); assert.equal(f.editor.state.seconds.success, '');
  f.fail(null); await f.editor.load(); assert.ok(f.editor.state.incoming); assert.equal(f.editor.state.seconds.success, '');
  f.editor.review(false); assert.equal(f.editor.state.seconds.success, 5);
  f.editor.state.seconds.success = 2; f.fail(new Error('网络中断')); await f.editor.save(); await f.editor.save();
  assert.equal(f.calls.filter(call => call.method).length, 1); assert.equal(f.editor.state.seconds.success, 2);
  f.fail(null); await f.editor.load(); f.editor.review(false); assert.equal(f.editor.dirty.value, false); f.editor.dispose();
});
test('合法却未确认同一草稿/版本的保存回复也阻止再次保存', async () => {
  const f = fixture(); await f.editor.load(); f.editor.state.seconds.success = 2;
  const wrong = f.config(); wrong.revision = 1; f.invalid(wrong); await f.editor.save();
  assert.equal(f.editor.state.blocked, true); assert.equal(f.editor.state.seconds.success, 2); assert.equal(f.applied.length, 1); f.editor.dispose();
});
test('读/写单飞与卸载AbortSignal：迟到结果不能恢复编辑、写全局或发通知', async () => {
  let resolve!: (value: unknown) => void, calls = 0, applied = 0, feedback = 0, signal: AbortSignal | undefined;
  const editor = createNotificationAppearanceEditor({ request: (_path, options) => { calls++; signal = options.signal; return new Promise(done => { resolve = done; }); },
    apply: () => applied++, feedback: () => feedback++ });
  const reading = editor.load(); await editor.load(); assert.equal(calls, 1); editor.dispose(); assert.equal(signal?.aborted, true);
  resolve(defaultUiConfigV2()); await reading; assert.equal(applied, 0); assert.equal(feedback, 0); assert.equal(editor.state.saved, null);
  await editor.load(); await editor.save(); assert.equal(calls, 1);
});

test('后台五类显示编辑与动画独立，真实预览不强制persistent且保持版本保护', () => {
  const source = readFileSync(new URL('../src/components/admin/NotificationAppearance.vue', import.meta.url), 'utf8');
  assert.match(source, /显示与关闭（秒）/);
  assert.match(source, /timedHide/);
  assert.match(source, /剩余前景/);
  assert.doesNotMatch(source, /persistent:\s*true/);
});

test('管理读/写15秒有界超时，不响应的传输也会解锁状态且迟到回复不能覆盖草稿', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve!: (value: unknown) => void, stall = true, signal: AbortSignal | undefined, writes = 0;
  const editor = createNotificationAppearanceEditor({ request: (_path, options) => {
    signal = options.signal; if (options.method) writes++;
    return stall ? new Promise(done => { resolve = done; }) : Promise.resolve(defaultUiConfigV2());
  }, apply: () => undefined, feedback: () => undefined });
  const savedRevision = () => editor.state.saved?.revision;
  const reading = editor.load(); ctx.mock.timers.tick(15000); await reading;
  assert.equal(signal?.aborted, true); assert.equal(editor.state.loading, false); assert.equal(editor.state.blocked, true);
  resolve(defaultUiConfigV2()); await Promise.resolve(); assert.equal(editor.state.saved, null);
  stall = false; await editor.load(); editor.state.seconds.success = 3; stall = true;
  const saving = editor.save(); await editor.save(); assert.equal(writes, 1);
  ctx.mock.timers.tick(15000); await saving; assert.equal(editor.state.saving, false); assert.equal(editor.state.blocked, true);
  const late = defaultUiConfigV2(); late.revision = 1; late.notificationDisplay.types.success = { mode: 'timed', durationMs: 3000 };
  resolve(late); await Promise.resolve(); assert.equal(savedRevision(), 0); assert.equal(editor.state.seconds.success, 3);
  await editor.save(); assert.equal(writes, 1); editor.dispose();
});

test('保存期间重复请求被阻止，卸载立即中止等待且不会应用迟到成功', async () => {
  let stall = false, resolve!: (value: unknown) => void, writes = 0, applied = 0, feedback = 0;
  const editor = createNotificationAppearanceEditor({ request: async (_path, options) => {
    if (options.method) writes++;
    if (stall) return new Promise(done => { resolve = done; }); return defaultUiConfigV2();
  }, apply: () => applied++, feedback: () => feedback++ });
  await editor.load(); editor.state.seconds.success = 2; stall = true;
  const saving = editor.save(); await editor.save(); assert.equal(writes, 1); editor.dispose(); await saving;
  const late = defaultUiConfigV2(); late.revision = 1; late.notificationDisplay.types.success = { mode: 'timed', durationMs: 2000 };
  resolve(late); await Promise.resolve(); assert.equal(applied, 1); assert.equal(feedback, 0); assert.equal(editor.state.saved?.revision, 0);
});
