import { copyUiConfigV2, type UiConfigV2 } from '../../../shared/notificationDisplay.ts';
import { beginProgressNotice, notify, type NoticeDisplayState, type NotificationTone } from '../notifications.ts';
import { notificationLabels } from './notificationAppearanceEditor.ts';

export type PreviewRow = NoticeDisplayState & { id: number; label: string };
/** Local simulations only. Real handles supply the reading clock, never a second countdown. */
export function createNotificationAppearancePreview(sample: (rows: PreviewRow[]) => void) {
  let controller = new AbortController(), disposed = false, nextId = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const tracked: { id: number; label: string; inspect: () => NoticeDisplayState }[] = [];
  const pending = new Set<ReturnType<typeof beginProgressNotice>>();
  let poll: ReturnType<typeof setTimeout> | undefined;
  function emit() { sample(tracked.map(row => ({ id: row.id, label: row.label, ...row.inspect() }))); }
  function observe() {
    poll = undefined; if (disposed) return; emit();
    if (tracked.some(row => row.inspect().phase !== 'disposed')) poll = setTimeout(observe, 200);
  }
  function track(label: string, handle: { inspect: () => NoticeDisplayState } | undefined) {
    if (!handle) return;
    tracked.push({ id: ++nextId, label, inspect: handle.inspect }); emit();
    if (poll === undefined) poll = setTimeout(observe, 200);
  }
  function later(run: () => void, ms: number) {
    const token = setTimeout(() => { timers.delete(token); if (!disposed) run(); }, ms); timers.add(token);
  }
  function clear() {
    controller.abort(); pending.forEach(task => task.cancel()); pending.clear();
    controller = new AbortController(); timers.forEach(token => clearTimeout(token)); timers.clear();
    if (poll !== undefined) clearTimeout(poll); poll = undefined; tracked.length = 0; emit();
  }
  function prepare() { if (disposed) return false; if (tracked.length >= 12) clear(); return true; }
  function result(config: UiConfigV2, tone: NotificationTone, long = false) {
    if (!prepare()) return;
    const previewConfig = copyUiConfigV2(config), signal = controller.signal;
    track(long ? '长文字与重试' : notificationLabels[tone], notify(long
      ? '仅预览：这是一条长通知，可以关闭、轮换或重试。长文字应在窄屏换行并保持完整圆角；重试模拟失败，不访问邮箱、不发邮件。'
      : `仅预览 · ${notificationLabels[tone]}通知`, tone, { previewConfig, signal,
      ...(long ? { action: { label: '重试预览', run: async () => { throw new Error('模拟重试失败：错误也使用当前预览显示策略'); } } } : {}) }));
  }
  function progress(config: UiConfigV2, tone?: 'success' | 'error', afterHide = false) {
    if (!prepare()) return;
    const value = copyUiConfigV2(config), policy = value.notificationDisplay.types.loading;
    if (afterHide && policy.mode !== 'timedHide') return;
    const task = beginProgressNotice('仅预览 · 正在加载…', { previewConfig: value, signal: controller.signal });
    pending.add(task); track(afterHide ? '收起后结果' : tone ? `加载→${notificationLabels[tone]}` : '等待任务', task);
    later(() => task.update('仅预览 · 正在整理内容…'), value.notificationMotion.types.loading.enterMs + 400);
    if (tone) {
      const ms = afterHide && policy.mode === 'timedHide'
        ? value.notificationMotion.types.loading.enterMs + policy.durationMs + value.notificationMotion.types.loading.exitMs
          + value.notificationMotion.types.loading.textOutMs + value.notificationMotion.types.loading.textInMs + 1500
        : value.notificationMotion.types.loading.enterMs + 1600;
      later(() => { pending.delete(task); task.finish(tone === 'success' ? '仅预览 · 加载完成' : '仅预览 · 加载失败，请重试', tone); }, ms);
    }
  }
  function finishWaiting() {
    pending.forEach(task => task.finish('仅预览 · 手动模拟任务完成', 'success')); pending.clear(); emit();
  }
  function stack(config: UiConfigV2) { for (const tone of ['success', 'warning', 'info'] as const) result(config, tone); }
  function dispose() { if (disposed) return; clear(); disposed = true; }
  return { result, progress, finishWaiting, stack, clear, dispose };
}
