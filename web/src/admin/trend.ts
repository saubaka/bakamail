/** 趋势图用到的纯函数：坐标轴刻度、平滑曲线、按范围聚合、补间。 */

export type Bucket = { t: number; end: number; passed: number; rejected: number; unavailable: number };
export type TrendRange = "24h" | "7d" | "30d";
export const TREND_RANGES: { key: TrendRange; label: string }[] = [
  { key: "24h", label: "24 小时" },
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
];

type HourPoint = { t: number; passed: number; rejected: number; unavailable: number };
const HOUR = 3_600_000;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * 把每小时的计数按范围聚合：24 小时按小时，7 天按本地时间每 6 小时，30 天按本地日期。
 * 聚合按浏览器的本地时区，所以“每天”和你看到的日期一致。
 */
export function aggregate(points: HourPoint[], range: TrendRange): Bucket[] {
  if (range === "24h") return points.map((point) => ({ ...point, end: point.t + HOUR }));
  const keyOf = (t: number): string => {
    const date = new Date(t);
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return range === "30d" ? day : `${day}-${Math.floor(date.getHours() / 6)}`;
  };
  const buckets: Bucket[] = [];
  let lastKey = "";
  for (const point of points) {
    const key = keyOf(point.t);
    if (key !== lastKey) { buckets.push({ t: point.t, end: point.t + HOUR, passed: 0, rejected: 0, unavailable: 0 }); lastKey = key; }
    const bucket = buckets[buckets.length - 1]!;
    bucket.passed += point.passed; bucket.rejected += point.rejected; bucket.unavailable += point.unavailable;
    bucket.end = point.t + HOUR;
  }
  return buckets;
}

/** 纵轴的上限：取 1、2、5 乘以 10 的幂里不小于数据最大值的那个，最小 4（空数据也有刻度）。 */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

export function yTicks(top: number): number[] {
  return top <= 4 ? [0, 2, 4] : [0, top / 2, top];
}

export type Pt = { x: number; y: number };

/** 单调三次插值（Fritsch–Carlson）：曲线平滑，且不会在两个点之间冲出范围（计数不会画到 0 以下）。 */
export function monotonePath(points: Pt[]): string {
  const n = points.length;
  if (n === 0) return "";
  const f = (value: number): string => String(Math.round(value * 100) / 100);
  if (n === 1) return `M${f(points[0]!.x)} ${f(points[0]!.y)}`;
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]!.x - points[i]!.x);
    slope.push((points[i + 1]!.y - points[i]!.y) / (dx[i] || 1));
  }
  const tangent: number[] = new Array(n).fill(0);
  tangent[0] = slope[0]!;
  tangent[n - 1] = slope[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1]! * slope[i]! <= 0) tangent[i] = 0;
    else {
      const w1 = 2 * dx[i]! + dx[i - 1]!, w2 = dx[i]! + 2 * dx[i - 1]!;
      tangent[i] = (w1 + w2) / (w1 / slope[i - 1]! + w2 / slope[i]!);
    }
  }
  let d = `M${f(points[0]!.x)} ${f(points[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += `C${f(points[i]!.x + h)} ${f(points[i]!.y + tangent[i]! * h)} ${f(points[i + 1]!.x - h)} ${f(points[i + 1]!.y - tangent[i + 1]! * h)} ${f(points[i + 1]!.x)} ${f(points[i + 1]!.y)}`;
  }
  return d;
}

/** 把一组数线性重采样到新的长度，用于切换范围时让旧曲线平滑地变成新曲线。 */
export function resample(values: number[], length: number): number[] {
  if (length <= 0) return [];
  if (values.length === 0) return new Array(length).fill(0);
  if (values.length === 1) return new Array(length).fill(values[0]!);
  if (length === 1) return [values[values.length - 1]!];
  return Array.from({ length }, (_, i) => {
    const position = (i / (length - 1)) * (values.length - 1);
    const low = Math.floor(position), high = Math.min(values.length - 1, low + 1);
    return values[low]! + (values[high]! - values[low]!) * (position - low);
  });
}

export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export function lerpValues(from: number[], to: number[], progress: number): number[] {
  const eased = easeOutCubic(progress);
  return to.map((target, i) => (from[i] ?? 0) + (target - (from[i] ?? 0)) * eased);
}

/** 横轴刻度：最多 max 个，均匀取点（含第一个），返回下标。 */
export function xTickIndexes(count: number, max = 6): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return Array.from(new Set(Array.from({ length: max }, (_, i) => Math.round(i * step))));
}

export function tickLabel(bucket: Bucket, range: TrendRange): string {
  const date = new Date(bucket.t);
  return range === "24h" ? `${pad(date.getHours())}:00` : `${date.getMonth() + 1}/${date.getDate()}`;
}

export function tooltipLabel(bucket: Bucket, range: TrendRange): string {
  const start = new Date(bucket.t), end = new Date(bucket.end);
  const day = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  const clock = (d: Date) => `${pad(d.getHours())}:00`;
  if (range === "30d") return day(start);
  return `${day(start)} ${clock(start)}–${clock(end)}`;
}
