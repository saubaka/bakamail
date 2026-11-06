export const HIGHLIGHT_MS = 480;
export const HIGHLIGHT_EASING = "cubic-bezier(.3,.8,.25,1)";

export type Box = { x: number; y: number; width: number; height: number };

const round = (value: number): number => Math.round(value * 100) / 100;

export function planHighlightMove(from: Box, to: Box): Keyframe[] | null {
  if (Math.abs(from.y - to.y) < 0.5 && Math.abs(from.x - to.x) < 0.5 && Math.abs(from.height - to.height) < 0.5 && Math.abs(from.width - to.width) < 0.5) return null;
  const frame = (box: Box): Keyframe => ({ transform: `translate3d(${round(box.x)}px,${round(box.y)}px,0)`, width: `${round(box.width)}px`, height: `${round(box.height)}px` });
  return [frame(from), frame(to)];
}
