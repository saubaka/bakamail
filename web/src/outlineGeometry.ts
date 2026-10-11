/**
 * 卡片、弹窗、浮层的轮廓线几何。
 *
 * 线条必须“镶嵌”在元素最外沿：线条外沿与元素的外沿（边框盒）重合，圆角也一致，
 * 这样元素自己的背景不会在线条外面多出一圈。绝对定位的 SVG 默认以“内边距盒”为参照，
 * 会落在边框里面，所以要按边框宽度向外扩，再把线宽的一半内缩。
 */
export type OutlineInput = {
  /** 轮廓线 SVG 所在的定位参照盒（内边距盒）尺寸，不含边框。 */
  clientWidth: number;
  clientHeight: number;
  /** 需要覆盖的元素的四条边框宽度。 */
  border: { left: number; top: number; right: number; bottom: number };
  /** 需要覆盖的元素的圆角（外半径）。 */
  radius: number;
  /** 线宽，CSS 像素（线条使用 non-scaling-stroke）。 */
  stroke: number;
};

export type OutlineGeometry = {
  /** 边框盒尺寸，用作 SVG 的 viewBox。 */
  viewWidth: number;
  viewHeight: number;
  /** SVG 相对定位参照盒（内边距盒）的偏移，以及相对 100% 额外增加的宽高。 */
  left: number;
  top: number;
  extraWidth: number;
  extraHeight: number;
  rect: { x: number; y: number; width: number; height: number; rx: number };
};

export function computeOutline(input: OutlineInput): OutlineGeometry {
  const { border, stroke } = input;
  const half = stroke / 2;
  const viewWidth = Math.max(1, input.clientWidth + border.left + border.right);
  const viewHeight = Math.max(1, input.clientHeight + border.top + border.bottom);
  // 线条中心线内缩半个线宽，外沿恰好贴着元素外沿；外半径 = 中心线半径 + 半个线宽。
  const rx = Math.max(0, Math.min(input.radius - half, (viewWidth - stroke) / 2, (viewHeight - stroke) / 2));
  return {
    viewWidth,
    viewHeight,
    left: -border.left,
    top: -border.top,
    extraWidth: border.left + border.right,
    extraHeight: border.top + border.bottom,
    rect: {
      x: half,
      y: half,
      width: Math.max(0, viewWidth - stroke),
      height: Math.max(0, viewHeight - stroke),
      rx,
    },
  };
}

const px = (value: string): number => Number.parseFloat(value) || 0;

/**
 * 读取真实样式并把几何写到 SVG 上。
 * @param svg 轮廓线 SVG
 * @param shapes 需要按同一几何设置的 rect
 * @param reference 轮廓线要贴合其外沿的元素（取边框和圆角）
 * @param container SVG 的定位参照元素（取内边距盒尺寸）；省略时与 reference 相同
 * @param fallbackStroke 读不到线宽时的默认值
 */
export function applyOutline(
  svg: SVGSVGElement,
  shapes: SVGRectElement[],
  reference: HTMLElement,
  container: HTMLElement = reference,
  fallbackStroke = 1.2,
): void {
  const style = getComputedStyle(reference);
  const first = shapes[0];
  const measuredStroke = first ? px(getComputedStyle(first).strokeWidth) : 0;
  const geometry = computeOutline({
    clientWidth: container.clientWidth,
    clientHeight: container.clientHeight,
    border: { left: px(style.borderLeftWidth), top: px(style.borderTopWidth), right: px(style.borderRightWidth), bottom: px(style.borderBottomWidth) },
    radius: px(style.borderTopLeftRadius),
    stroke: measuredStroke > 0 ? measuredStroke : fallbackStroke,
  });
  svg.setAttribute("viewBox", `0 0 ${geometry.viewWidth} ${geometry.viewHeight}`);
  // 百分比相对定位参照盒的实际（含小数）尺寸，替换元素也会按它撑开；不用整数的 clientWidth 以免右、下边缘短一截。
  svg.style.left = `${geometry.left}px`;
  svg.style.top = `${geometry.top}px`;
  svg.style.right = "auto";
  svg.style.bottom = "auto";
  svg.style.width = `calc(100% + ${geometry.extraWidth}px)`;
  svg.style.height = `calc(100% + ${geometry.extraHeight}px)`;
  for (const shape of shapes) {
    shape.setAttribute("x", String(geometry.rect.x));
    shape.setAttribute("y", String(geometry.rect.y));
    shape.setAttribute("width", String(geometry.rect.width));
    shape.setAttribute("height", String(geometry.rect.height));
    shape.setAttribute("rx", String(geometry.rect.rx));
    shape.setAttribute("ry", String(geometry.rect.rx));
  }
}
