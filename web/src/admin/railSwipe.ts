/** 手机上滑动开合抽屉：只看起止位置，水平为主、距离足够才算。 */
export const EDGE_PX = 24;
export const MIN_DISTANCE_PX = 64;

export function decideSwipe(
  start: { x: number; y: number },
  end: { x: number; y: number },
  drawerOpen: boolean,
): "open" | "close" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  if (!drawerOpen) return dx > 0 && start.x <= EDGE_PX ? "open" : null;
  return dx < 0 ? "close" : null;
}
