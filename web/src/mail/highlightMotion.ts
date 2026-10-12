/**
 * 左侧菜单选中线条的移动：从当前位置出发，先向目标方向拉长（把起点和终点一起罩住），再收缩到目标按钮上，
 * 像一滴水从一个按钮流到另一个按钮；线条本身的绘制动画在样式里同步进行。
 */
export const HIGHLIGHT_MS = 620;
export const HIGHLIGHT_EASING = "cubic-bezier(.3,.8,.25,1)";
export const HIGHLIGHT_STRETCH_AT = 0.42;

export type Box = { x: number; y: number; width: number; height: number };

const round = (value: number): number => Math.round(value * 100) / 100;

/** 返回动画帧；起点和终点几乎重合时返回 null（不需要动画）。 */
export function planHighlightMove(from: Box, to: Box): Keyframe[] | null {
  if (Math.abs(from.y - to.y) < 0.5 && Math.abs(from.x - to.x) < 0.5 && Math.abs(from.height - to.height) < 0.5 && Math.abs(from.width - to.width) < 0.5) return null;
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y + from.height, to.y + to.height);
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x + from.width, to.x + to.width);
  const frame = (box: Box): Keyframe => ({ transform: `translate3d(${round(box.x)}px,${round(box.y)}px,0)`, width: `${round(box.width)}px`, height: `${round(box.height)}px` });
  return [
    { ...frame(from), offset: 0 },
    { ...frame({ x: left, y: top, width: right - left, height: bottom - top }), offset: HIGHLIGHT_STRETCH_AT },
    { ...frame(to), offset: 1 },
  ];
}
