/** Vite-only real motion/read-clock harness. Never contacts production or mail services. */
import { defaultUiConfigV2 } from '../../../shared/notificationDisplay.ts';
import { notify, beginProgressNotice, disposeNotifications, type NoticeDisplayState } from '../../src/notifications.ts';
import '../../src/styles/vendor/project1-app.css';
import '../../src/styles/vendor/project1-small-window-theme.css';
import '../../src/styles/mail-overrides.css';
import '../../src/styles/mail-pages.css';
import '../../src/styles/admin.css';
import '../../src/styles/motion.css';
import '../../src/styles/notifications.css';
import '../../src/styles/theme-controls.css';
import '../../src/styles/local-theme.css';
import '../../src/styles/dashed-accent.css';

const controls = document.getElementById('fixture-controls')!, output = document.getElementById('fixture-evidence')!;
const status = document.getElementById('fixture-status')!;
const records: unknown[] = [], tracked: { label: string; inspect: () => NoticeDisplayState; last: string }[] = [];
const timers = new Set<ReturnType<typeof setTimeout>>(); let scope = new AbortController();
let pending: ReturnType<typeof beginProgressNotice> | undefined;
window.fetch = async () => { throw new Error('隔离通知验收禁止网络请求'); };
function record(event: unknown) { records.push(event); if (records.length > 160) records.shift(); output.textContent = JSON.stringify(records); }
function track(label: string, handle: { inspect: () => NoticeDisplayState } | undefined) {
  if (!handle) return; tracked.push({ label, inspect: handle.inspect, last: '' });
  record({ label, event: 'created', at: Math.round(performance.now()), config: handle.inspect() });
}
function config() {
  const value = defaultUiConfigV2(); value.revision = 33;
  for (const type of ['success', 'info', 'warning', 'error'] as const) value.notificationDisplay.types[type] = { mode: 'timed', durationMs: 1000 };
  value.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 1000 }; return value;
}
function button(label: string, run: () => void) {
  const node = document.createElement('button'); node.className = 'btn btn-secondary'; node.type = 'button'; node.textContent = label;
  node.addEventListener('click', run); controls.append(node);
}
function later(run: () => void, ms: number) { const timer = setTimeout(() => { timers.delete(timer); run(); }, ms); timers.add(timer); }
button('成功 · 1秒', () => track('success', notify('操作已完成 · 停留一秒', 'success', { previewConfig: config(), signal: scope.signal })));
button('错误 · 1秒', () => track('error', notify('普通错误也按设置关闭', 'error', { previewConfig: config(), signal: scope.signal })));
button('加载收起后成功', () => {
  const p = beginProgressNotice('慢任务等待 · 一秒后收起', { previewConfig: config(), signal: scope.signal }); track('hidden-success', p);
  later(() => p.finish('等待已经收起，成功结果仍显示'), 3600);
});
button('加载收起后失败', () => {
  const p = beginProgressNotice('慢任务等待 · 一秒后收起', { previewConfig: config(), signal: scope.signal }); track('hidden-error', p);
  later(() => p.finish('等待已经收起，错误结果仍显示', 'error'), 3600);
});
button('出场期间完成', () => {
  const p = beginProgressNotice('结果将于加载出场期间到达', { previewConfig: config(), signal: scope.signal }); track('exit-race', p);
  later(() => p.finish('出场后只显示一条最终结果'), 1950);
});
button('三条堆叠 · 2秒', () => {
  const value = config(); for (const type of ['success', 'info', 'warning'] as const) value.notificationDisplay.types[type] = { mode: 'timed', durationMs: 2000 };
  for (const type of ['success', 'info', 'warning'] as const) track(`stack-${type}`, notify(`堆叠${type} · 点击卡片轮换，后台不扣时间`, type, { previewConfig: value, signal: scope.signal }));
});
button('手动错误 · 长文字', () => {
  const value = config(); value.notificationDisplay.types.error = { mode: 'manual' };
  track('manual', notify('需手动关闭的错误。'.repeat(9), 'error', { previewConfig: value, signal: scope.signal }));
});
button('等待任务 · 手动收起', () => {
  const value = config(); value.notificationDisplay.types.loading = { mode: 'untilSettled' };
  pending?.cancel(); pending = beginProgressNotice('可手动关闭等待，业务任务仍继续', { previewConfig: value, signal: scope.signal }); track('manual-loading', pending);
});
button('更新等待文字', () => pending?.update('新进度不会重新打开已收起的等待卡片'));
button('完成等待任务', () => pending?.finish('手动收起后的结果仍然显示'));
button('重试按钮 · 执行时暂停', () => {
  const value = config(); value.notificationDisplay.types.warning = { mode: 'timed', durationMs: 2000 };
  track('action', notify('两秒警告，重试需要三秒', 'warning', { previewConfig: value, signal: scope.signal,
    action: { label: '重试', run: () => new Promise<void>((_resolve, reject) => later(() => reject(new Error('模拟重试失败，普通错误停留一秒')), 3000)) } }));
});
button('减少动画切换', () => { document.documentElement.dataset.motion = document.documentElement.dataset.motion === 'reduce' ? 'system' : 'reduce'; });
function clear() { scope.abort(); pending = undefined; disposeNotifications(); timers.forEach(timer => clearTimeout(timer)); timers.clear(); scope = new AbortController(); }
button('清理通知和任务', clear);
for (const name of ['animationstart', 'animationend', 'transitionend']) document.addEventListener(name, event => {
  if (!(event.target as Element).closest('.notification-stack-card')) return;
  record({ event: name, name: (event as AnimationEvent).animationName ?? (event as TransitionEvent).propertyName, at: Math.round(performance.now()) });
});
let frame = 0;
function observe() {
  for (const item of [...tracked]) {
    const state = item.inspect(), signature = JSON.stringify([state.phase, state.type, state.pauseReasons]);
    if (signature !== item.last) { item.last = signature; record({ label: item.label, event: 'state', at: Math.round(performance.now()), ...state }); }
    if (state.phase === 'disposed') tracked.splice(tracked.indexOf(item), 1);
  }
  status.textContent = `可见卡片 ${document.querySelectorAll('.notification-stack-card').length} · 页面${document.hidden ? '隐藏' : '可见'} · 焦点${document.hasFocus() ? '激活' : '未激活'} · ${document.documentElement.dataset.motion === 'reduce' ? '减少动画' : '正常动画'}`;
  frame = requestAnimationFrame(observe);
}
observe(); window.addEventListener('beforeunload', () => { cancelAnimationFrame(frame); clear(); });
