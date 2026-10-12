/**
 * 左侧菜单选中线条的移动：整个包围线条先朝目标方向移动（前沿先到目标按钮，后沿的线条停留在原地，
 * 两侧的竖线被拉长连着），到位之后，停留在原地的线条再沿着竖线收回到现在的位置。
 * 全程都是同一圈实线在伸缩，不会出现新的虚线包围。
 */
export const HIGHLIGHT_MS = 640;
export const HIGHLIGHT_EASING = "linear";
export const HIGHLIGHT_STRETCH_AT = 0.5;
const LEAD_EASING = "cubic-bezier(.22,.8,.28,1)";
const TRAIL_EASING = "cubic-bezier(.55,0,.25,1)";

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
    { ...frame(from), offset: 0, easing: LEAD_EASING },
    { ...frame({ x: left, y: top, width: right - left, height: bottom - top }), offset: HIGHLIGHT_STRETCH_AT, easing: TRAIL_EASING },
    { ...frame(to), offset: 1 },
  ];
}
