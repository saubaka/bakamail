/** 顶部加载线：开始后先快后慢地爬向 92%，完成时补满再淡出，不依赖真实进度。 */
export const TRICKLE_CEILING = 0.92;
export const START_DELAY_MS = 100;
export const FINISH_HOLD_MS = 320;
/** 活动暂时停下后等多久才收尾；期间又有新的请求就接着走。 */
export const GRACE_MS = 250;

export function nextProgress(current: number): number {
  const next = current + (TRICKLE_CEILING - current) * 0.12;
  return Math.min(TRICKLE_CEILING, Math.max(current, next));
}
