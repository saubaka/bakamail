<template>
  <div ref="root" class="range-tabs" role="radiogroup" :aria-label="label" :style="{ '--n': options.length, '--i': activeIndex }" @keydown="onKeydown">
    <span class="range-tabs__indicator" aria-hidden="true"></span>
    <button
      v-for="(option, index) in options"
      :key="option.key"
      class="range-tabs__option"
      :class="{ 'is-active': index === activeIndex }"
      type="button"
      role="radio"
      :aria-checked="index === activeIndex ? 'true' : 'false'"
      :tabindex="index === activeIndex ? 0 : -1"
      :disabled="disabled"
      @click="emit('update:modelValue', option.key)"
    >{{ option.label }}</button>
  </div>
</template>

<script setup lang="ts" generic="K extends string">
import { computed, ref } from "vue";

const props = defineProps<{ modelValue: K; options: { key: K; label: string }[]; label: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: K] }>();
const root = ref<HTMLElement | null>(null);
const activeIndex = computed(() => Math.max(0, props.options.findIndex((option) => option.key === props.modelValue)));

/** 方向键在选项之间移动并选中（单选组的标准键盘操作）。 */
function onKeydown(event: KeyboardEvent): void {
  const last = props.options.length - 1;
  let next = -1;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = activeIndex.value === last ? 0 : activeIndex.value + 1;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = activeIndex.value === 0 ? last : activeIndex.value - 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = last;
  if (next < 0 || props.disabled) return;
  event.preventDefault();
  emit("update:modelValue", props.options[next]!.key);
  root.value?.querySelectorAll<HTMLElement>(".range-tabs__option")[next]?.focus();
}
</script>

<style scoped>
/* 分段选择：一个浅蓝的滑块在选项之间滑动；纯色，无渐变。 */
.range-tabs { position: relative; display: inline-grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); padding: 3px; border: 1px solid var(--line-blue); border-radius: 14px; background: var(--surface-soft, #fbfcfe); isolation: isolate; }
.range-tabs__indicator { position: absolute; z-index: 0; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / var(--n)); border: 1px solid var(--line-blue-strong); border-radius: 11px; background: var(--cloud-blue, #e5effb); transform: translate3d(calc(var(--i) * 100%), 0, 0); transition: transform 360ms var(--spring, cubic-bezier(.2, 1.25, .35, 1)); }
.range-tabs__option { position: relative; z-index: 1; min-width: 64px; min-height: 34px; padding: 0 14px; border: 0; border-radius: 11px; background: transparent; color: var(--text-soft); font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 200ms var(--ease, ease); }
.range-tabs__option:hover:not(:disabled) { color: var(--text); }
.range-tabs__option.is-active { color: var(--graphite-blue, var(--text)); font-weight: 600; }
.range-tabs__option:focus-visible { outline: 2px solid var(--line-blue-strong); outline-offset: 1px; }
.range-tabs__option:disabled { cursor: default; opacity: .6; }
@media (prefers-reduced-motion: reduce) { .range-tabs__indicator, .range-tabs__option { transition: none; } }
</style>
