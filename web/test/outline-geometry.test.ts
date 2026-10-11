import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyOutline, computeOutline, type OutlineInput } from "../src/outlineGeometry.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const near = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} expected ${expected}, got ${actual}`);

const cases: OutlineInput[] = [];
for (const border of [0, 1, 2]) for (const radius of [0, 12, 16, 26, 28]) for (const stroke of [1, 1.1, 1.2, 1.25]) {
  cases.push({ clientWidth: 622, clientHeight: 276, border: { left: border, top: border, right: border, bottom: border }, radius, stroke });
}
cases.push({ clientWidth: 300, clientHeight: 120, border: { left: 1, top: 2, right: 3, bottom: 4 }, radius: 20, stroke: 1.2 });

test("线条外沿恰好贴着元素外沿：四边都没有缝隙，背景不会在线条外面多出一圈", () => {
  for (const input of cases) {
    const g = computeOutline(input);
    const half = input.stroke / 2;
    // 边框盒就是 SVG 的坐标系；中心线内缩半个线宽，所以外沿正好落在 0 和 viewWidth/viewHeight 上。
    near(g.rect.x - half, 0, "left edge");
    near(g.rect.y - half, 0, "top edge");
    near(g.rect.x + g.rect.width + half, g.viewWidth, "right edge");
    near(g.rect.y + g.rect.height + half, g.viewHeight, "bottom edge");
    near(g.viewWidth, input.clientWidth + input.border.left + input.border.right, "view width is the border box");
    near(g.viewHeight, input.clientHeight + input.border.top + input.border.bottom, "view height is the border box");
  }
});

test("SVG 向外扩出边框宽度，覆盖整个边框盒；没有边框时与内边距盒完全一致", () => {
  const withBorder = computeOutline({ clientWidth: 300, clientHeight: 120, border: { left: 1, top: 2, right: 3, bottom: 4 }, radius: 20, stroke: 1.2 });
  assert.deepEqual([withBorder.left, withBorder.top, withBorder.extraWidth, withBorder.extraHeight], [-1, -2, 4, 6]);
  const plain = computeOutline({ clientWidth: 300, clientHeight: 120, border: { left: 0, top: 0, right: 0, bottom: 0 }, radius: 20, stroke: 1.2 });
  assert.deepEqual([plain.left === 0, plain.top === 0, plain.extraWidth, plain.extraHeight], [true, true, 0, 0]);
});

test("圆角：线条外半径等于元素的圆角，转角处背景同样不外露；极小或圆形元素不会出现负半径", () => {
  for (const radius of [12, 16, 26, 28]) for (const stroke of [1, 1.2, 1.25]) {
    const g = computeOutline({ clientWidth: 400, clientHeight: 200, border: { left: 1, top: 1, right: 1, bottom: 1 }, radius, stroke });
    near(g.rect.rx + stroke / 2, radius, `outer radius for ${radius}/${stroke}`);
  }
  assert.equal(computeOutline({ clientWidth: 100, clientHeight: 40, border: { left: 0, top: 0, right: 0, bottom: 0 }, radius: 0, stroke: 1.2 }).rect.rx, 0);
  assert.equal(computeOutline({ clientWidth: 100, clientHeight: 40, border: { left: 0, top: 0, right: 0, bottom: 0 }, radius: 0.2, stroke: 1.2 }).rect.rx, 0, "radius smaller than half a stroke clamps to zero");
  const pill = computeOutline({ clientWidth: 100, clientHeight: 40, border: { left: 0, top: 0, right: 0, bottom: 0 }, radius: 999, stroke: 1.2 });
  near(pill.rect.rx, (40 - 1.2) / 2, "a pill clamps to half the short side");
  const tiny = computeOutline({ clientWidth: 0, clientHeight: 0, border: { left: 0, top: 0, right: 0, bottom: 0 }, radius: 28, stroke: 1.2 });
  assert.ok(tiny.viewWidth >= 1 && tiny.viewHeight >= 1 && tiny.rect.width >= 0 && tiny.rect.height >= 0 && tiny.rect.rx >= 0);
});

type Fake = { attrs: Record<string, string>; style: Record<string, string>; setAttribute(name: string, value: string): void };
const fake = (): Fake => ({ attrs: {}, style: {}, setAttribute(name, value) { this.attrs[name] = value; } });

test("applyOutline 读取真实边框、圆角和线宽，写入 viewBox、位置和每个 rect；宿主模式用父元素的边框", () => {
  const originalGetComputedStyle = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
  const styles = new Map<unknown, Record<string, string>>();
  (globalThis as { getComputedStyle: unknown }).getComputedStyle = (element: unknown) => styles.get(element) ?? {};
  try {
    const card = { clientWidth: 622, clientHeight: 276 } as unknown as HTMLElement;
    styles.set(card, { borderLeftWidth: "1px", borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderTopLeftRadius: "26px" });
    const svg = fake(), a = fake(), b = fake();
    styles.set(a, { strokeWidth: "1.25" });
    applyOutline(svg as unknown as SVGSVGElement, [a, b] as unknown as SVGRectElement[], card, card, 1.2);
    assert.equal(svg.attrs.viewBox, "0 0 624 278");
    assert.deepEqual([svg.style.left, svg.style.top, svg.style.right, svg.style.bottom], ["-1px", "-1px", "auto", "auto"]);
    assert.equal(svg.style.width, "calc(100% + 2px)");
    assert.equal(svg.style.height, "calc(100% + 2px)");
    for (const rect of [a, b]) {
      assert.deepEqual([rect.attrs.x, rect.attrs.y, rect.attrs.width, rect.attrs.height], ["0.625", "0.625", "622.75", "276.75"]);
      assert.equal(rect.attrs.rx, "25.375");
      assert.equal(rect.attrs.ry, "25.375");
    }
    // 读不到线宽时使用传入的默认值。
    const c = fake();
    styles.set(c, { strokeWidth: "" });
    applyOutline(fake() as unknown as SVGSVGElement, [c] as unknown as SVGRectElement[], card, card, 1.2);
    assert.equal(c.attrs.x, "0.6");
    // 宿主：尺寸取宿主（父元素的内边距盒），边框和圆角取父元素。
    const parent = {} as HTMLElement;
    styles.set(parent, { borderLeftWidth: "2px", borderTopWidth: "2px", borderRightWidth: "2px", borderBottomWidth: "2px", borderTopLeftRadius: "20px" });
    const host = { clientWidth: 200, clientHeight: 80 } as unknown as HTMLElement;
    const hostSvg = fake(), piece = fake();
    styles.set(piece, { strokeWidth: "1.25" });
    applyOutline(hostSvg as unknown as SVGSVGElement, [piece] as unknown as SVGRectElement[], parent, host, 1.25);
    assert.equal(hostSvg.attrs.viewBox, "0 0 204 84");
    assert.equal(hostSvg.style.left, "-2px");
    assert.equal(piece.attrs.rx, "19.375");
  } finally {
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = originalGetComputedStyle;
  }
});

test("两套轮廓线都使用共享几何：不再写死向内缩的固定值，宿主取父元素的边框", () => {
  const motion = source("motion.ts");
  assert.match(motion, /applyOutline\(outline, \[path\], element, element, 1\.2\)/);
  assert.doesNotMatch(motion, /const inset = 0\.75|path\.setAttribute\("x"/);
  const lines = source("surfaceLines.ts");
  assert.match(lines, /applyOutline\(svg, pieces, reference, element, 1\.25\)/);
  assert.match(lines, /line-outline-host'\) \? \(element\.parentElement \?\? element\) : element/);
  assert.doesNotMatch(lines, /setAttribute\('x','1\.5'\)/);
  // 每一处生成 SVG 轮廓线的代码都必须走共享几何，防止以后再出现一套内缩的实现。
  for (const file of ["motion.ts", "surfaceLines.ts"]) assert.match(source(file), /from "\.\/outlineGeometry\.ts"|from '\.\/outlineGeometry\.ts'/, file);
});

test("被裁剪的容器（弹窗等 overflow 非 visible）：线条只画在内边距盒内，圆角用内圆角，不再向外伸到会被切掉的边框区域", () => {
  for (const radius of [16, 22, 26]) for (const stroke of [1.1, 1.25]) {
    const g = computeOutline({ clientWidth: 502, clientHeight: 380, border: { left: 1, top: 1, right: 1, bottom: 1 }, radius, stroke, clipped: true });
    assert.deepEqual([g.left, g.top, g.extraWidth, g.extraHeight], [0, 0, 0, 0], "stays inside the padding box");
    assert.equal(g.viewWidth, 502);
    assert.equal(g.viewHeight, 380);
    near(g.rect.x + g.rect.width + stroke / 2, 502, "flush with the padding box edge");
    near(g.rect.rx + stroke / 2, radius - 1, "outer radius equals the inner radius of the padding box");
  }
  // 没有边框时两种模式完全相同
  const a = computeOutline({ clientWidth: 300, clientHeight: 100, border: { left: 0, top: 0, right: 0, bottom: 0 }, radius: 20, stroke: 1.2, clipped: true });
  const b = computeOutline({ clientWidth: 300, clientHeight: 100, border: { left: 0, top: 0, right: 0, bottom: 0 }, radius: 20, stroke: 1.2 });
  assert.deepEqual(a, b);
});

test("applyOutline 按 overflow 判断是否被裁剪，并给元素打上背景收回的标记", () => {
  const original = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
  const styles = new Map<unknown, Record<string, string>>();
  (globalThis as { getComputedStyle: unknown }).getComputedStyle = (element: unknown) => styles.get(element) ?? {};
  try {
    const border = { borderLeftWidth: "1px", borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderTopLeftRadius: "22px" };
    const scroller = { clientWidth: 502, clientHeight: 380, dataset: {} as Record<string, string> } as unknown as HTMLElement;
    styles.set(scroller, { ...border, overflowX: "auto", overflowY: "auto" });
    const svgA = fake(), rectA = fake();
    styles.set(rectA, { strokeWidth: "1.25" });
    applyOutline(svgA as unknown as SVGSVGElement, [rectA] as unknown as SVGRectElement[], scroller, scroller, 1.25);
    assert.equal(svgA.attrs.viewBox, "0 0 502 380");
    assert.equal(svgA.style.left, "0px");
    assert.equal(svgA.style.width, "calc(100% + 0px)");
    assert.equal((scroller as unknown as { dataset: Record<string, string> }).dataset.outlineBox, "padding");
    assert.equal(rectA.attrs.rx, "20.375", "22 - 1 border - 0.625 half stroke");
    const visible = { clientWidth: 502, clientHeight: 380, dataset: {} as Record<string, string> } as unknown as HTMLElement;
    styles.set(visible, { ...border, overflowX: "visible", overflowY: "visible" });
    const svgB = fake(), rectB = fake();
    styles.set(rectB, { strokeWidth: "1.25" });
    applyOutline(svgB as unknown as SVGSVGElement, [rectB] as unknown as SVGRectElement[], visible, visible, 1.25);
    assert.equal(svgB.attrs.viewBox, "0 0 504 382");
    assert.equal((visible as unknown as { dataset: Record<string, string> }).dataset.outlineBox, "border");
    // 一个方向裁剪也算裁剪
    const half = { clientWidth: 100, clientHeight: 50, dataset: {} as Record<string, string> } as unknown as HTMLElement;
    styles.set(half, { ...border, overflowX: "visible", overflowY: "hidden" });
    applyOutline(fake() as unknown as SVGSVGElement, [fake()] as unknown as SVGRectElement[], half, half, 1.25);
    assert.equal((half as unknown as { dataset: Record<string, string> }).dataset.outlineBox, "padding");
  } finally {
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = original;
  }
});

test("样式：被裁剪的元素把背景收回到内边距盒，且不会被后面的 background 简写覆盖", () => {
  const css = source("styles/dashed-accent.css");
  assert.match(css, /\[data-outline-box="padding"\] \{ background-clip: padding-box !important; \}/);
});
