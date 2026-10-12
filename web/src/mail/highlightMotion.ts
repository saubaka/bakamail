/**
 * 选中线条的移动：整圈包围线条保持原样，从当前按钮平滑滑到目标按钮（只有位置和大小在变）。
 * 线条不拉长、不分段、不在终点提前出现，全程只有这一圈线。
 * 左侧菜单、文件夹列表、手机底部胶囊和手机展开菜单共用这一套。
 */
export const HIGHLIGHT_MS = 480;
export const HIGHLIGHT_EASING = "cubic-bezier(.3,.8,.25,1)";

export type Box = { x: number; y: number; width: number; height: number };

const round = (value: number): number => Math.round(value * 100) / 100;

/** 返回动画帧；起点和终点几乎重合时返回 null（不需要动画）。 */
export function planHighlightMove(from: Box, to: Box): Keyframe[] | null {
  if (Math.abs(from.y - to.y) < 0.5 && Math.abs(from.x - to.x) < 0.5 && Math.abs(from.height - to.height) < 0.5 && Math.abs(from.width - to.width) < 0.5) return null;
  const frame = (box: Box): Keyframe => ({ transform: `translate3d(${round(box.x)}px,${round(box.y)}px,0)`, width: `${round(box.width)}px`, height: `${round(box.height)}px` });
  return [frame(from), frame(to)];
}
