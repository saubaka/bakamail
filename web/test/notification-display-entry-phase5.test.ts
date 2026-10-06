import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { defaultUiConfigV2 } from '../../shared/notificationDisplay.ts';
import { applySavedUiConfig, createUiConfigClient, initializeUiConfig } from '../src/notificationConfig.ts';
import { capsuleFeedbackDirective, type CapsuleFeedbackOptions } from '../src/capsuleFeedback.ts';
import { notify, type NoticeOptions } from '../src/notifications.ts';
import { toast } from '../src/api.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNotificationDisplayProbeDom, flushNotificationDisplayProbe as flush } from './fixtures/notification-display-dom.ts';
const hooks = capsuleFeedbackDirective as unknown as Record<'mounted' | 'updated' | 'beforeUnmount', (el: HTMLElement, binding: { value?: CapsuleFeedbackOptions }) => void>;

test('指令定时隐藏保留表单说明与原字段ARIA、同文更新不补时、清空/卸载可再次显示', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); ctx.mock.method(performance, 'now', () => Date.now());
  const dom = createNotificationDisplayProbeDom();
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 }; applySavedUiConfig(config);
    const form = document.createElement('form'), el = document.createElement('p'), input = document.createElement('input');
    form.setAttribute('aria-describedby', 'existing'); input.setAttribute('aria-describedby', 'field-error'); input.setAttribute('aria-invalid', 'true');
    el.textContent = '字段相关失败'; form.append(el, input); document.body.append(form);
    hooks.mounted(el, {}); await flush(); ctx.mock.timers.tick(850); hooks.updated(el, {}); await flush();
    ctx.mock.timers.tick(150); await flush(); assert.equal(dom.region.children.length, 0);
    assert.equal(el.getAttribute('aria-hidden'), null); assert.equal(el.textContent, '字段相关失败');
    assert.equal(form.getAttribute('aria-describedby'), `existing ${el.id}`); assert.equal(input.getAttribute('aria-describedby'), 'field-error'); assert.equal(input.getAttribute('aria-invalid'), 'true');
    el.textContent = ''; hooks.updated(el, {}); await flush(); el.textContent = '字段相关失败'; hooks.updated(el, {}); await flush();
    assert.equal(dom.region.children.length, 1);
    hooks.updated(el, {}); hooks.beforeUnmount(el, {}); await flush(); assert.equal(dom.region.children.length, 0);
    assert.equal(form.getAttribute('aria-describedby'), 'existing'); form.remove();
  } finally { dom.restore(); }
});

test('指令依据实际tone重映射；卸载/外部中止立即清理，迟到更新不复活', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); const dom = createNotificationDisplayProbeDom({ reduced: false });
  try {
    const el = document.createElement('p'); el.textContent = '状态提示'; document.body.append(el);
    const controller = new AbortController(); hooks.mounted(el, { value: { tone: 'info', signal: controller.signal } }); await flush();
    assert.equal(dom.region.children[0]?.children[0]?.dataset.motionType, 'info');
    hooks.updated(el, { value: { tone: 'warning', signal: controller.signal } }); await flush();
    assert.equal(dom.region.children.length, 1); assert.equal(dom.region.children[0]?.children[0]?.dataset.motionType, 'warning');
    controller.abort(); assert.equal(dom.region.children.length, 0); hooks.updated(el, { value: { tone: 'warning', signal: controller.signal } });
    hooks.beforeUnmount(el, {}); await flush(); ctx.mock.timers.tick(10000); await flush(); assert.equal(dom.region.children.length, 0); el.remove();
  } finally { dom.restore(); }
});

test('普通action失败子通知继承scope，执行中暂停且禁重复，离开不改变已经开始的业务', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); ctx.mock.method(performance, 'now', () => Date.now());
  const dom = createNotificationDisplayProbeDom();
  try {
    const controller = new AbortController(); let reject!: (error: Error) => void, calls = 0;
    const parent = notify('重试', 'error', { signal: controller.signal, action: { label: '重试', run: () => { calls++; return new Promise<void>((_r, fail) => { reject = fail; }); } } })!;
    await flush(); const button = dom.region.children[0]!.children[0]!.children[0]!.children[2]!;
    button.dispatchEvent(new Event('click')); button.dispatchEvent(new Event('click')); assert.equal(calls, 1); assert.ok(parent.inspect().pauseReasons.includes('action'));
    reject(new Error('重试失败')); await flush(); assert.equal(dom.region.children.length, 2);
    controller.abort(); assert.equal(dom.region.children.length, 0); assert.equal(calls, 1);
    const second = new AbortController(); let resolve!: () => void;
    notify('已开始', 'error', { signal: second.signal, action: { label: '执行', run: () => new Promise<void>(r => { resolve = r; }) } }); await flush();
    dom.region.children[0]!.children[0]!.children[0]!.children[2]!.dispatchEvent(new Event('click'));
    second.abort(); resolve(); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('另一新版本客户端激活立即读取新revision，SPA节流仍保留；断网回默认且旧投影不泄漏display', async () => {
  const dom = createNotificationDisplayProbeDom(); let server = defaultUiConfigV2(), offline = false, calls = 0;
  const fetcher: typeof fetch = async () => { calls++; if (offline) throw new Error('offline'); return Response.json({ ok: true, data: server }); };
  const current = createUiConfigClient(fetcher), other = createUiConfigClient(fetcher);
  const dispose = initializeUiConfig(other);
  try {
    await other.refresh(); await current.refresh(true); const old = other.snapshotV2();
    server = structuredClone(server); server.revision = 4; server.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
    current.applySaved(server); await other.refresh(); assert.equal(other.snapshotV2().revision, 0);
    dom.window.dispatchEvent(new Event('focus')); await other.refresh(); assert.equal(other.snapshotV2().revision, 4); assert.equal(current.snapshotV2().revision, 4); assert.equal(old.revision, 0);
    assert.equal('notificationDisplay' in other.snapshot(), false);
    const before = calls; dom.document.hidden = true; dom.window.dispatchEvent(new Event('focus')); assert.equal(calls, before);
    offline = true; dom.document.hidden = false; dom.document.dispatchEvent(new Event('visibilitychange')); await other.refresh();
    assert.deepEqual(other.snapshotV2(), defaultUiConfigV2());
    dispose(); const after = calls; dom.window.dispatchEvent(new Event('focus')); dom.document.dispatchEvent(new Event('visibilitychange')); await flush(); assert.equal(calls, after);
  } finally { dispose(); current.dispose(); dom.restore(); }
});

test('相同文字仅在相同scope去重，已中止scope不得获得别人的句柄', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); ctx.mock.method(performance, 'now', () => Date.now());
  const dom = createNotificationDisplayProbeDom();
  try {
    const a = new AbortController(), b = new AbortController();
    notify('同一错误', 'error', { signal: a.signal }); await flush();
    notify('同一错误', 'error', { signal: b.signal }); await flush();
    assert.equal(dom.region.children.length, 2);
    a.abort(); assert.equal(dom.region.children.length, 1);
    assert.equal(notify('同一错误', 'error', { signal: a.signal }), undefined);
    notify('同一错误', 'error', { signal: b.signal }); assert.equal(dom.region.children.length, 1);
    b.abort(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});

test('只有明确的发送未确认原因覆盖定时策略，普通错误仍为1秒', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); ctx.mock.method(performance, 'now', () => Date.now());
  const dom = createNotificationDisplayProbeDom();
  try {
    const config = defaultUiConfigV2(); config.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
    applySavedUiConfig(config);
    const ordinary = notify('普通发送错误', 'error')!; await flush();
    assert.equal(ordinary.inspect().remainingMs, 1000); ctx.mock.timers.tick(1000); await flush();
    const critical = notify('发送结果未确认', 'error', { manualReason: 'delivery-unconfirmed' } as NoticeOptions)!;
    await flush(); assert.equal(critical.inspect().remainingMs, null); ctx.mock.timers.tick(120000);
    assert.equal(dom.region.children.length, 1); critical.dismiss(); await flush();
    const invalid = notify('无理由不得常驻', 'error', { manualReason: 'arbitrary' } as unknown as NoticeOptions)!;
    await flush(); assert.equal(invalid.inspect().remainingMs, 1000);
  } finally { dom.restore(); }
});

test('全入口不再允许无理由persistent；保留发送锁、人工确认和列表重试', () => {
  const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  assert.doesNotMatch(read('views/MailView.vue'), /persistent\s*:/);
  assert.match(read('components/mail/ComposeDialog.vue'), /manualReason:\s*'delivery-unconfirmed'/);
  assert.match(read('components/mail/ComposeDialog.vue'), /deliveryUnconfirmed.*确认|确认发送结果/);
  assert.match(read('components/mail/MessageListPane.vue'), /syncError/);
  assert.match(read('views/admin/MailOpsView.vue'), /tone: logsStale \? 'warning' : 'info'/);
  const inventory = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/inventory-notification-display.mjs', import.meta.url)), '--summary'], { encoding: 'utf8' });
  assert.equal(inventory.status, 0, inventory.stderr);
  const sites = JSON.parse(inventory.stdout);
  // v0.3.0 adds one invite-limit validation feedback, still routed through the central capsule.
  assert.equal(sites.files.length, 25); assert.equal(sites.total, 112); assert.deepEqual(sites.persistent, []);
  assert.equal(sites.manualExceptions.length, 1);
  assert.equal(sites.manualExceptions[0].file, 'web/src/components/mail/ComposeDialog.vue');
  assert.equal(sites.manualExceptions[0].manualReason, 'delivery-unconfirmed');
});

test('toast包装四类反馈继承全局1秒，重大例外不能误用于成功通知', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); ctx.mock.method(performance, 'now', () => Date.now());
  const dom = createNotificationDisplayProbeDom();
  try {
    const config = defaultUiConfigV2();
    for (const tone of ['success', 'info', 'warning', 'error'] as const) config.notificationDisplay.types[tone] = { mode: 'timed', durationMs: 1000 };
    applySavedUiConfig(config);
    for (const tone of ['success', 'info', 'warning', 'error'] as const) {
      toast(`普通${tone}`, tone); await flush(); assert.equal(dom.region.children.length, 1);
      ctx.mock.timers.tick(999); await flush(); assert.equal(dom.region.children.length, 1);
      ctx.mock.timers.tick(1); await flush(); assert.equal(dom.region.children.length, 0);
    }
    const nonError = notify('非错误不允许借用例外', 'success', { manualReason: 'delivery-unconfirmed' })!;
    await flush(); assert.equal(nonError.inspect().remainingMs, 1000);
    ctx.mock.timers.tick(1000); await flush(); assert.equal(dom.region.children.length, 0);
  } finally { dom.restore(); }
});
