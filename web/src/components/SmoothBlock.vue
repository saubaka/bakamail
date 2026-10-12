<template>
  <div ref="outer" class="smooth-block" :style="height === null ? undefined : { height: `${height}px` }">
    <div ref="inner" class="smooth-block__inner"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/** 内容高度变化时，外框用过渡跟着变，下方的内容平滑让位，而不是瞬间跳动。 */
const outer = ref<HTMLElement | null>(null);
const inner = ref<HTMLElement | null>(null);
const height = ref<number | null>(null);
let observer: ResizeObserver | null = null;

onMounted(() => {
  const node = inner.value;
  if (!node || typeof ResizeObserver === "undefined") return;
  height.value = node.getBoundingClientRect().height;
  observer = new ResizeObserver(() => { height.value = node.getBoundingClientRect().height; });
  observer.observe(node);
});
onBeforeUnmount(() => observer?.disconnect());
</script>
