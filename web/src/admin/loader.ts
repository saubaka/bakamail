/**
 * 右侧内容区的加载动画：什么时候出现、什么时候收起。
 * - 很快完成的操作不出现（START_DELAY_MS 内结束就当没发生过）；
 * - 一旦出现，至少停留 MIN_SHOW_MS，避免一闪而过；
 * - 容器出现的那一刻立刻开始收起（淡出 FADE_MS），不再额外等待；
 * - 新页面的容器线条要等加载动画完全收起之后才开始画（loaderGate），线条动画和容器线条绝不同时出现。
 */
export const START_DELAY_MS = 140;
export const MIN_SHOW_MS = 360;
export const FADE_MS = 260;

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

let gateUntil = 0;
/** 入场动画的闸门：加载动画还在（或还在淡出）时，新容器的入场要往后推迟这么久。 */
export const loaderGate = {
  delay(now = performance.now()): number { return Math.max(0, gateUntil - now); },
  reset(): void { gateUntil = 0; },
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
  const show = (): void => {
    startTimer = 0;
    if (!busy || visible) return;
    visible = true; shownAt = timers.now();
    gateUntil = shownAt + 60_000; // 显示期间一直关着闸门；真正收起时再改成淡出结束的时刻
    onChange(true);
  };
  const hide = (): void => {
    endTimer = 0;
    if (busy || !visible) return;
    visible = false;
    gateUntil = timers.now() + FADE_MS;
    onChange(false);
  };
  return {
    setBusy(next: boolean): void {
      if (next === busy) return;
      busy = next;
      if (busy) {
        if (endTimer) { timers.clear(endTimer); endTimer = 0; }
        if (visible) gateUntil = timers.now() + 60_000;
        else if (!startTimer) startTimer = timers.set(show, START_DELAY_MS);
        return;
      }
      if (startTimer) { timers.clear(startTimer); startTimer = 0; }
      if (!visible) return;
      const remaining = Math.max(0, MIN_SHOW_MS - (timers.now() - shownAt));
      gateUntil = timers.now() + remaining + FADE_MS;
      if (endTimer) timers.clear(endTimer);
      endTimer = timers.set(hide, remaining);
    },
    dispose(): void {
      if (startTimer) timers.clear(startTimer);
      if (endTimer) timers.clear(endTimer);
      startTimer = 0; endTimer = 0;
      gateUntil = 0;
    },
  };
}
