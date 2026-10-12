/**
 * 右侧内容区的加载动画：什么时候出现、什么时候收起。
 * - 很快完成的操作不出现（START_DELAY_MS 内结束就当没发生过）；
 * - 页面切换完成后新页面会立刻发自己的数据请求：给“结束”留一小段缓冲（GRACE_MS），两段等待合并成一次，不闪烁；
 * - 一旦出现，至少停留 MIN_SHOW_MS，避免一闪而过。
 */
export const START_DELAY_MS = 140;
export const GRACE_MS = 260;
export const MIN_SHOW_MS = 520;

export type LoaderTimers = {
  now(): number;
  set(callback: () => void, ms: number): number;
  clear(handle: number): void;
};

export const realTimers: LoaderTimers = {
  now: () => performance.now(),
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (handle) => window.clearTimeout(handle),
};

export type LoaderController = {
  /** 外部的“正在忙”状态变化时调用。 */
  setBusy(busy: boolean): void;
  dispose(): void;
};

export function createLoader(onChange: (visible: boolean) => void, timers: LoaderTimers = realTimers): LoaderController {
  let visible = false;
  let shownAt = 0;
  let startTimer = 0;
  let endTimer = 0;
  let busy = false;
  const show = (): void => { startTimer = 0; if (!busy || visible) return; visible = true; shownAt = timers.now(); onChange(true); };
  const hide = (): void => { endTimer = 0; if (busy || !visible) return; visible = false; onChange(false); };
  return {
    setBusy(next: boolean): void {
      if (next === busy) return;
      busy = next;
      if (busy) {
        if (endTimer) { timers.clear(endTimer); endTimer = 0; }
        if (!visible && !startTimer) startTimer = timers.set(show, START_DELAY_MS);
        return;
      }
      if (startTimer) { timers.clear(startTimer); startTimer = 0; }
      if (!visible) return;
      const remaining = Math.max(GRACE_MS, MIN_SHOW_MS - (timers.now() - shownAt));
      if (endTimer) timers.clear(endTimer);
      endTimer = timers.set(hide, remaining);
    },
    dispose(): void {
      if (startTimer) timers.clear(startTimer);
      if (endTimer) timers.clear(endTimer);
      startTimer = 0; endTimer = 0;
    },
  };
}
