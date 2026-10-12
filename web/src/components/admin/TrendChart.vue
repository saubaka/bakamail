<template>
  <figure class="trend" :class="{ 'is-drawing': drawing, 'is-empty': empty }" :aria-label="label">
    <ul class="trend__legend">
      <li v-for="item in series" :key="item.key">
        <button class="trend__chip" :class="{ 'is-off': hidden.has(item.key) }" type="button" :aria-pressed="hidden.has(item.key) ? 'false' : 'true'" :style="{ '--c': item.color }" @click="toggle(item.key)">
          <i aria-hidden="true"></i>{{ item.label }}<b>{{ totalOf(item.key) }}</b>
        </button>
      </li>
    </ul>

    <div ref="stage" class="trend__stage" tabindex="0" role="group" :aria-label="`${label}，可用左右方向键查看每个时间段`" @keydown="onKeydown" @blur="active = null">
      <svg v-if="width > 0" class="trend__svg" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true" focusable="false">
        <g class="trend__grid">
          <g v-for="tick in ticks" :key="tick.value">
            <line :x1="plot.left" :x2="plot.right" :y1="tick.y" :y2="tick.y" />
            <text :x="plot.left - 8" :y="tick.y + 4" text-anchor="end">{{ tick.value }}</text>
          </g>
        </g>
        <g class="trend__xaxis">
          <text v-for="tick in xTicks" :key="tick.index" :x="tick.x" :y="height - 6" :text-anchor="tick.anchor">{{ tick.label }}</text>
        </g>
        <path v-if="areaPath" class="trend__area" :d="areaPath" :style="{ '--c': series[0]?.color }" :class="{ 'is-off': hidden.has(series[0]?.key ?? '') }" />
        <path v-for="item in series" :key="item.key" class="trend__line" :class="{ 'is-off': hidden.has(item.key) }" :d="paths[item.key]" pathLength="1" :style="{ '--c': item.color }" />
        <g v-if="active !== null && points.length" class="trend__focus">
          <line :x1="points[active]?.x" :x2="points[active]?.x" :y1="plot.top" :y2="plot.bottom" />
          <circle v-for="item in visibleSeries" :key="item.key" :cx="points[active]?.x" :cy="yOf(shown[item.key]?.[active] ?? 0)" r="4.5" :style="{ '--c': item.color }" />
        </g>
        <rect class="trend__hit" :x="plot.left" :y="plot.top" :width="Math.max(0, plot.right - plot.left)" :height="Math.max(0, plot.bottom - plot.top)" @pointermove="onPointer" @pointerdown="onPointer" @pointerleave="active = null" />
      </svg>
      <div v-if="active !== null && tooltip" class="trend__tip" :style="{ left: `${tooltip.x}px` }" role="presentation">
        <strong>{{ tooltip.title }}</strong>
        <span v-for="row in tooltip.rows" :key="row.key" :style="{ '--c': row.color }"><i aria-hidden="true"></i>{{ row.label }}<b>{{ row.value }}</b></span>
      </div>
      <p class="trend__empty" :aria-hidden="empty ? 'false' : 'true'">这段时间没有校验记录</p>
    </div>
    <p class="sr-only" aria-live="polite">{{ spoken }}</p>
  </figure>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { easeOutCubic, monotonePath, niceMax, resample, tickLabel, tooltipLabel, xTickIndexes, yTicks, type Bucket, type TrendRange } from "../../admin/trend.ts";

export type TrendSeries = { key: string; label: string; color: string; values: number[] };

const props = defineProps<{ series: TrendSeries[]; buckets: Bucket[]; range: TrendRange; label: string }>();

const stage = ref<HTMLElement | null>(null);
const width = ref(0);
const hidden = reactive(new Set<string>());
const active = ref<number | null>(null);
const drawing = ref(true);
const shown = reactive<Record<string, number[]>>({});
const shownTop = ref(4);
let resizeObserver: ResizeObserver | null = null;
let frame = 0;
let drawTimer = 0;

const height = computed(() => (width.value < 480 ? 196 : 232));
const plot = computed(() => ({ left: 38, right: Math.max(40, width.value - 14), top: 14, bottom: height.value - 26 }));
const visibleSeries = computed(() => props.series.filter((item) => !hidden.has(item.key)));
const targetTop = computed(() => niceMax(Math.max(0, ...visibleSeries.value.flatMap((item) => item.values))));
const empty = computed(() => visibleSeries.value.every((item) => item.values.every((value) => value === 0)) && props.series.length > 0);
const reduced = (): boolean => typeof document !== "undefined" && (document.documentElement.dataset.motion === "reduce" || document.documentElement.dataset.performance === "low"
  || window.matchMedia("(prefers-reduced-motion: reduce)").matches);

const yOf = (value: number): number => plot.value.bottom - (plot.value.bottom - plot.value.top) * (shownTop.value ? value / shownTop.value : 0);
const count = computed(() => props.buckets.length);
const points = computed(() => {
  const n = count.value;
  const step = n > 1 ? (plot.value.right - plot.value.left) / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => ({ x: plot.value.left + i * step }));
});
const paths = computed<Record<string, string>>(() => Object.fromEntries(props.series.map((item) => [
  item.key, monotonePath(points.value.map((point, i) => ({ x: point.x, y: yOf(shown[item.key]?.[i] ?? 0) }))),
])));
const areaPath = computed(() => {
  const first = props.series[0];
  if (!first || points.value.length < 2) return "";
  const line = paths.value[first.key] ?? "";
  return line ? `${line}L${points.value[points.value.length - 1]!.x} ${plot.value.bottom}L${points.value[0]!.x} ${plot.value.bottom}Z` : "";
});
// 刻度数值取目标上限，位置随补间滑动。
const ticks = computed(() => yTicks(targetTop.value).map((value) => ({ value, y: yOf(value) })));
const xTicks = computed(() => xTickIndexes(count.value, width.value < 480 ? 4 : 6).map((index, order, all) => ({
  index, x: points.value[index]?.x ?? 0, label: props.buckets[index] ? tickLabel(props.buckets[index]!, props.range) : "",
  anchor: order === 0 ? "start" : order === all.length - 1 ? "end" : "middle",
})));

const totalOf = (key: string): number => (props.series.find((item) => item.key === key)?.values ?? []).reduce((sum, value) => sum + value, 0);
const toggle = (key: string): void => {
  if (hidden.has(key)) hidden.delete(key);
  else if (visibleSeries.value.length > 1) hidden.add(key); // 至少留一条线
};

const tooltip = computed(() => {
  const index = active.value;
  const bucket = index === null ? undefined : props.buckets[index];
  if (index === null || !bucket) return null;
  const rowsOfSeries = props.series.map((item) => ({ key: item.key, label: item.label, color: item.color, value: item.values[index] ?? 0 }));
  const x = points.value[index]?.x ?? 0;
  const half = 82;
  return { title: tooltipLabel(bucket, props.range), rows: rowsOfSeries, x: Math.min(Math.max(x, half), Math.max(half, width.value - half)) };
});
const spoken = computed(() => (tooltip.value ? `${tooltip.value.title}：${tooltip.value.rows.map((row) => `${row.label} ${row.value} 次`).join("，")}` : ""));

function indexAt(clientX: number): number {
  const box = stage.value?.getBoundingClientRect();
  if (!box || count.value < 2) return 0;
  const ratio = (clientX - box.left - plot.value.left) / (plot.value.right - plot.value.left);
  return Math.min(count.value - 1, Math.max(0, Math.round(ratio * (count.value - 1))));
}
function onPointer(event: PointerEvent): void { active.value = indexAt(event.clientX); }
function onKeydown(event: KeyboardEvent): void {
  const last = count.value - 1;
  if (last < 0) return;
  if (event.key === "ArrowRight") active.value = Math.min(last, (active.value ?? -1) + 1);
  else if (event.key === "ArrowLeft") active.value = Math.max(0, (active.value ?? last + 1) - 1);
  else if (event.key === "Home") active.value = 0;
  else if (event.key === "End") active.value = last;
  else if (event.key === "Escape") active.value = null;
  else return;
  event.preventDefault();
}

/** 把显示值平滑地补间到目标值：数据长度变了（切换范围）先把旧曲线重采样到新长度，线条就是“变形”过去而不是跳变。 */
function animateTo(): void {
  const targets = Object.fromEntries(props.series.map((item) => [item.key, visibleSeries.value.includes(item) ? item.values : item.values.map(() => 0)]));
  const topTarget = targetTop.value;
  window.cancelAnimationFrame(frame);
  // 第一次有数据时直接显示最终形状（线条由 CSS 从左向右画出来），不再叠加一次“从 0 升起”的补间。
  const first = Object.keys(shown).length === 0;
  if (reduced() || width.value === 0 || first) {
    for (const [key, values] of Object.entries(targets)) shown[key] = values.slice();
    shownTop.value = topTarget;
    return;
  }
  const from = Object.fromEntries(Object.entries(targets).map(([key, values]) => [key, resample(shown[key] ?? values.map(() => 0), values.length)]));
  const topFrom = shownTop.value;
  const started = performance.now();
  const duration = 560;
  const step = (now: number): void => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = easeOutCubic(progress);
    for (const [key, values] of Object.entries(targets)) shown[key] = values.map((target, i) => (from[key]![i] ?? 0) + (target - (from[key]![i] ?? 0)) * eased);
    shownTop.value = topFrom + (topTarget - topFrom) * eased;
    if (progress < 1) frame = window.requestAnimationFrame(step);
  };
  frame = window.requestAnimationFrame(step);
}

watch(() => [props.series.map((item) => item.values.join(",")).join("|"), [...hidden].join(","), props.buckets.length], animateTo);
watch(() => props.range, () => { active.value = null; });

function measure(): void { width.value = Math.floor(stage.value?.clientWidth ?? 0); }
onMounted(async () => {
  measure();
  resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { const before = width.value; measure(); if (before === 0) animateTo(); });
  if (stage.value) resizeObserver?.observe(stage.value);
  await nextTick();
  animateTo();
  // 第一次出现时线条从左向右画出来。
  drawTimer = window.setTimeout(() => { drawing.value = false; }, reduced() ? 0 : 1300);
});
onBeforeUnmount(() => { resizeObserver?.disconnect(); window.cancelAnimationFrame(frame); window.clearTimeout(drawTimer); });
</script>

<style scoped>
.trend { --c-grid: var(--line-blue); margin: 0; min-width: 0; }
.trend__legend { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
.trend__chip { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 12px; border: 1px solid var(--line-blue); border-radius: 12px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: opacity 220ms var(--ease, ease), border-color 200ms var(--ease, ease), background 200ms var(--ease, ease); }
.trend__chip i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); transition: transform 240ms var(--spring, ease); }
.trend__chip b { margin-left: 2px; font-weight: 600; font-variant-numeric: tabular-nums; }
.trend__chip:hover { border-color: var(--line-blue-strong); background: var(--surface-soft, #fbfcfe); }
.trend__chip.is-off { opacity: .5; }
.trend__chip.is-off i { transform: scale(.6); }
.trend__chip:focus-visible, .trend__stage:focus-visible { outline: 2px solid var(--line-blue-strong); outline-offset: 2px; }
.trend__stage { position: relative; min-width: 0; border-radius: 16px; }
.trend__svg { display: block; overflow: visible; }
.trend__grid line { stroke: var(--c-grid); stroke-width: 1; shape-rendering: crispEdges; }
.trend__grid text, .trend__xaxis text { fill: var(--text-soft); font-size: 11px; font-variant-numeric: tabular-nums; }
.trend__line { fill: none; stroke: var(--c); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; transition: opacity 260ms var(--ease, ease); }
.trend__line.is-off { opacity: 0; }
.trend__area { fill: var(--c); opacity: .1; stroke: none; transition: opacity 260ms var(--ease, ease); }
.trend__area.is-off { opacity: 0; }
.is-drawing .trend__line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: trend-draw 1100ms cubic-bezier(.4, .1, .2, 1) forwards; }
.is-drawing .trend__line:nth-of-type(2) { animation-delay: 120ms; }
.is-drawing .trend__line:nth-of-type(3) { animation-delay: 240ms; }
.is-drawing .trend__area { animation: trend-fade 900ms ease 500ms backwards; }
@keyframes trend-draw { to { stroke-dashoffset: 0; } }
@keyframes trend-fade { from { opacity: 0; } }
.trend__hit { fill: transparent; cursor: crosshair; }
.trend__focus line { stroke: var(--line-blue-strong); stroke-width: 1; stroke-dasharray: 3 4; }
.trend__focus circle { fill: var(--surface); stroke: var(--c); stroke-width: 2.2; }
.trend__tip { position: absolute; top: 6px; z-index: 3; display: grid; gap: 4px; min-width: 150px; max-width: 220px; padding: 10px 12px; border: 1px solid var(--line-blue); border-radius: 12px; background: rgba(255, 255, 255, .94); box-shadow: 0 8px 24px rgba(91, 130, 169, .14); font-size: 12px; pointer-events: none; transform: translateX(-50%); animation: trend-tip 160ms var(--ease, ease); }
.trend__tip strong { font-size: 12px; font-weight: 600; }
.trend__tip span { display: flex; align-items: center; gap: 7px; color: var(--text-soft); }
.trend__tip span i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.trend__tip span b { margin-left: auto; color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
@keyframes trend-tip { from { opacity: 0; transform: translateX(-50%) translateY(4px); } }
.trend__empty { position: absolute; left: 50%; top: 50%; margin: 0; padding: 6px 14px; border: 1px solid var(--line-blue); border-radius: 999px; background: rgba(255, 255, 255, .9); color: var(--text-soft); font-size: 12px; opacity: 0; transform: translate(-50%, -50%); transition: opacity 360ms var(--ease, ease); pointer-events: none; }
.is-empty .trend__empty { opacity: 1; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) {
  .is-drawing .trend__line, .is-drawing .trend__area, .trend__tip { animation: none; }
  .is-drawing .trend__line { stroke-dasharray: none; stroke-dashoffset: 0; }
  .trend__line, .trend__area, .trend__chip, .trend__chip i, .trend__empty { transition: none; }
}
</style>
