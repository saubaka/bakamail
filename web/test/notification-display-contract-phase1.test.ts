import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultUiConfig, isUiConfig, NOTIFICATION_TYPES } from '../../shared/notificationMotion.ts';
import {
  defaultNotificationDisplay, isNotificationDisplay, copyNotificationDisplay,
  NOTIFICATION_DISPLAY_DURATION_LIMITS, DEFAULT_TIMED_DISPLAY_MS,
  defaultUiConfigV2, isUiConfigV2, copyUiConfigV2, upgradeUiConfigV1,
  normalizeUiConfigV2, projectUiConfigV1, applyLegacyMotionEdit,
} from '../../shared/notificationDisplay.ts';

const resultTypes = ['success', 'info', 'warning', 'error'] as const;

test('显示默认值完整覆盖五类，显示时间与动画字段独立', () => {
  const display = defaultNotificationDisplay();
  assert.deepEqual(Object.keys(display.types), NOTIFICATION_TYPES);
  assert.deepEqual(display, { types: {
    success: { mode: 'timed', durationMs: 5000 }, info: { mode: 'timed', durationMs: 6000 },
    warning: { mode: 'timed', durationMs: 8000 }, error: { mode: 'manual' }, loading: { mode: 'untilSettled' },
  } });
  assert.ok(isNotificationDisplay(display));
  assert.deepEqual(DEFAULT_TIMED_DISPLAY_MS, { success: 5000, info: 6000, warning: 8000, error: 10000, loading: 15000 });
  assert.equal(JSON.stringify(display).includes('enterMs'), false);
});

test('定时边界1秒/120秒和全部中间整数秒，对五类均有效', () => {
  assert.deepEqual(NOTIFICATION_DISPLAY_DURATION_LIMITS, { minMs: 1000, maxMs: 120000, stepMs: 1000 });
  for (let seconds = 1; seconds <= 120; seconds++) {
    const display = defaultNotificationDisplay();
    for (const type of resultTypes) display.types[type] = { mode: 'timed', durationMs: seconds * 1000 };
    display.types.loading = { mode: 'timedHide', durationMs: seconds * 1000 };
    assert.ok(isNotificationDisplay(display), `${seconds}秒`);
  }
});

test('普通错误可定时，普通反馈可手动，加载可等待结束或定时收起', () => {
  const display = defaultNotificationDisplay();
  for (const type of resultTypes) display.types[type] = { mode: 'manual' };
  assert.ok(isNotificationDisplay(display));
  display.types.error = { mode: 'timed', durationMs: 10000 };
  display.types.loading = { mode: 'timedHide', durationMs: 15000 };
  assert.ok(isNotificationDisplay(display));
});

test('拒绝错误类型混用加载策略、加载混用普通策略及未知模式', () => {
  for (const type of NOTIFICATION_TYPES) {
    const modes = type === 'loading' ? ['timed', 'manual', 'unknown', '', null] : ['timedHide', 'untilSettled', 'unknown', '', null];
    for (const mode of modes) {
      const input = defaultNotificationDisplay() as any;
      input.types[type] = { mode, ...(mode === 'timed' || mode === 'timedHide' ? { durationMs: 1000 } : {}) };
      assert.equal(isNotificationDisplay(input), false, `${type}/${mode}`);
    }
  }
});

test('五类都拒绝0、负值、分数秒、越界、NaN、无限数和隐式转换', () => {
  const values: unknown[] = [0, -0, -1000, 999, 1001, 1500, 1000.5, 120001, 121000,
    Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, '1000', null, undefined, true, [], {}];
  for (const type of NOTIFICATION_TYPES) for (const durationMs of values) {
    const input = defaultNotificationDisplay() as any;
    input.types[type] = { mode: type === 'loading' ? 'timedHide' : 'timed', durationMs };
    assert.equal(isNotificationDisplay(input), false, `${type}/${String(durationMs)}`);
  }
});

test('非计时策略拒绝残留durationMs，计时策略必须有durationMs', () => {
  for (const type of NOTIFICATION_TYPES) {
    const input = defaultNotificationDisplay() as any;
    input.types[type] = { mode: type === 'loading' ? 'untilSettled' : 'manual', durationMs: 1000 };
    assert.equal(isNotificationDisplay(input), false);
    input.types[type] = { mode: type === 'loading' ? 'timedHide' : 'timed' };
    assert.equal(isNotificationDisplay(input), false);
  }
});

test('显示契约拒绝非对象、缺类、额外键、数组和原型继承必填字段', () => {
  for (const value of [null, undefined, [], true, 'display', 1, {}, { types: [] }]) assert.equal(isNotificationDisplay(value), false);
  const extra = defaultNotificationDisplay() as any;
  extra.unknown = 1; assert.equal(isNotificationDisplay(extra), false);
  delete extra.unknown; extra.types.unknown = { mode: 'manual' }; assert.equal(isNotificationDisplay(extra), false);
  delete extra.types.unknown;
  for (const type of NOTIFICATION_TYPES) {
    const missing = defaultNotificationDisplay() as any;
    delete missing.types[type]; assert.equal(isNotificationDisplay(missing), false);
    const nested = defaultNotificationDisplay() as any;
    nested.types[type].unknown = 1; assert.equal(isNotificationDisplay(nested), false);
    const inherited = defaultNotificationDisplay() as any;
    inherited.types[type] = Object.create(inherited.types[type]); assert.equal(isNotificationDisplay(inherited), false);
  }
});

test('显示契约不忽略未知symbol或非枚举自有字段', () => {
  const symbolic = defaultNotificationDisplay();
  Object.defineProperty(symbolic.types.success, Symbol('unknown'), { value: 1 });
  assert.equal(isNotificationDisplay(symbolic), false);
  const hidden = defaultNotificationDisplay();
  Object.defineProperty(hidden, 'unknown', { value: 1 });
  assert.equal(isNotificationDisplay(hidden), false);
});

test('默认值与复制不共享五类策略对象，预览编辑不污染默认表', () => {
  const a = defaultNotificationDisplay(), b = defaultNotificationDisplay(), c = copyNotificationDisplay(a);
  for (const type of NOTIFICATION_TYPES) {
    assert.notEqual(a.types[type], b.types[type]); assert.notEqual(a.types[type], c.types[type]);
  }
  assert.notEqual(a.types, c.types);
  a.types.success = { mode: 'timed', durationMs: 120000 };
  c.types.loading = { mode: 'timedHide', durationMs: 1000 };
  assert.deepEqual(b, defaultNotificationDisplay());
  assert.deepEqual(DEFAULT_TIMED_DISPLAY_MS.success, 5000);
  assert.ok(Object.isFrozen(DEFAULT_TIMED_DISPLAY_MS));
  assert.ok(Object.isFrozen(NOTIFICATION_DISPLAY_DURATION_LIMITS));
});

test('v2默认契约有效且旧v1校验器不被悄悄放宽', () => {
  const config = defaultUiConfigV2();
  assert.equal(config.schemaVersion, 2); assert.equal(config.revision, 0);
  assert.deepEqual(config.notificationMotion, defaultUiConfig().notificationMotion);
  assert.ok(isUiConfigV2(config));
  assert.equal(isUiConfig(config), false); assert.equal(defaultUiConfig().schemaVersion, 1);
});

test('v1纯升级保留revision与每类自定义动画，输入冻结也不被写入', () => {
  const old = defaultUiConfig(); old.revision = 42; old.notificationMotion.stackMs = 911;
  for (const [index, type] of NOTIFICATION_TYPES.entries()) {
    old.notificationMotion.types[type] = { enterMs: index * 400, exitMs: index * 500, textOutMs: index * 100, textInMs: index * 150 };
    Object.freeze(old.notificationMotion.types[type]);
  }
  Object.freeze(old.notificationMotion.types); Object.freeze(old.notificationMotion); Object.freeze(old);
  const upgraded = upgradeUiConfigV1(old)!;
  assert.ok(isUiConfigV2(upgraded)); assert.equal(upgraded.revision, 42);
  assert.deepEqual(upgraded.notificationMotion, old.notificationMotion);
  assert.deepEqual(upgraded.notificationDisplay, defaultNotificationDisplay());
  assert.equal(Object.hasOwn(old, 'notificationDisplay'), false);
  assert.notEqual(upgraded.notificationMotion, old.notificationMotion);
  assert.notEqual(upgraded.notificationMotion.types.success, old.notificationMotion.types.success);
});

test('损坏v1、混合版本与未来版本不能升级成可编辑默认值', () => {
  for (const value of [null, {}, defaultUiConfigV2(), { ...defaultUiConfig(), schemaVersion: 99 },
    { ...defaultUiConfig(), revision: -1 }, { ...defaultUiConfig(), notificationDisplay: defaultNotificationDisplay() },
    { ...defaultUiConfig(), notificationMotion: {} }]) assert.equal(upgradeUiConfigV1(value), null);
});

test('v2严格拒绝坏版本、revision、动画、显示及额外顶层键', () => {
  const mutations: ((value: any) => void)[] = [
    value => { value.schemaVersion = 1; }, value => { value.schemaVersion = 99; },
    value => { value.revision = -1; }, value => { value.revision = 1.5; },
    value => { value.revision = Number.MAX_SAFE_INTEGER + 1; }, value => { value.revision = '1'; },
    value => { value.notificationMotion.stackMs = 1501; }, value => { value.notificationMotion.types.loading.enterMs = 3001; },
    value => { value.notificationDisplay.types.error = { mode: 'timed', durationMs: 0 }; },
    value => { delete value.notificationDisplay; }, value => { delete value.notificationMotion; },
    value => { value.unknown = 1; },
  ];
  for (const mutate of mutations) { const value = defaultUiConfigV2(); mutate(value); assert.equal(isUiConfigV2(value), false); }
  for (const value of [null, [], {}, true]) assert.equal(isUiConfigV2(value), false);
});

test('v2复制深度隔离显示与动画，规范化键顺序稳定', () => {
  const original = defaultUiConfigV2(); original.revision = 4;
  original.notificationDisplay.types.error = { mode: 'timed', durationMs: 9000 };
  const copied = copyUiConfigV2(original);
  assert.deepEqual(copied, original);
  copied.notificationMotion.types.success.enterMs = 3000;
  copied.notificationDisplay.types.error = { mode: 'manual' };
  assert.equal(original.notificationMotion.types.success.enterMs, 780);
  assert.deepEqual(original.notificationDisplay.types.error, { mode: 'timed', durationMs: 9000 });
  const shuffled = { notificationDisplay: original.notificationDisplay, notificationMotion: original.notificationMotion,
    revision: original.revision, schemaVersion: 2 as const };
  assert.equal(JSON.stringify(copyUiConfigV2(shuffled)), JSON.stringify(copyUiConfigV2(original)));
});

test('v2投影给旧浏览器仅含v1字段，动画和revision不丢失', () => {
  const config = defaultUiConfigV2(); config.revision = 7; config.notificationMotion.types.loading.exitMs = 2333;
  const legacy = projectUiConfigV1(config);
  assert.ok(isUiConfig(legacy)); assert.equal(legacy.schemaVersion, 1); assert.equal(legacy.revision, 7);
  assert.equal(Object.hasOwn(legacy, 'notificationDisplay'), false);
  assert.deepEqual(legacy.notificationMotion, config.notificationMotion);
  legacy.notificationMotion.types.loading.exitMs = 1;
  assert.equal(config.notificationMotion.types.loading.exitMs, 2333);
});

test('版本规范化只接受有效v1/v2并复制，不把坏数据替换为默认配置', () => {
  const legacy = defaultUiConfig(), current = defaultUiConfigV2(); current.revision = 8;
  assert.deepEqual(normalizeUiConfigV2(legacy), upgradeUiConfigV1(legacy));
  const normalized = normalizeUiConfigV2(current)!;
  assert.deepEqual(normalized, current); assert.notEqual(normalized.notificationDisplay, current.notificationDisplay);
  for (const invalid of [{ ...current, schemaVersion: 3 }, { ...current, notificationDisplay: {} }, null, {}]) {
    assert.equal(normalizeUiConfigV2(invalid), null);
  }
});

test('旧编辑器只替换动画，保留五类显示策略，不增加revision或写输入', () => {
  const current = defaultUiConfigV2(); current.revision = 12;
  current.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 1000 };
  current.notificationDisplay.types.error = { mode: 'timed', durationMs: 2000 };
  const before = structuredClone(current), legacy = projectUiConfigV1(current);
  legacy.notificationMotion.types.success.enterMs = 2999;
  const edit = applyLegacyMotionEdit(current, legacy)!;
  assert.ok(isUiConfigV2(edit)); assert.equal(edit.revision, 12);
  assert.deepEqual(edit.notificationDisplay, before.notificationDisplay);
  assert.equal(edit.notificationMotion.types.success.enterMs, 2999);
  assert.deepEqual(current, before);
  edit.notificationDisplay.types.success = { mode: 'manual' };
  assert.deepEqual(current.notificationDisplay.types.success, { mode: 'timed', durationMs: 5000 });
});

test('旧编辑器的版本冲突、坏配置或v2冒充v1都拒绝且当前值不变', () => {
  const current = defaultUiConfigV2(); current.revision = 10;
  const stale = projectUiConfigV1(current); stale.revision = 9;
  const before = structuredClone(current);
  for (const invalid of [stale, { ...stale, revision: 11 }, { ...stale, revision: 10, unknown: 1 }, current, null, {}]) {
    assert.equal(applyLegacyMotionEdit(current, invalid), null);
    assert.deepEqual(current, before);
  }
});
