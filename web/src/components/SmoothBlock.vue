<template>
  <div ref="outer" class="smooth-block" :style="height === null ? undefined : { height: `${height}px` }">
    <div ref="inner" class="smooth-block__inner"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { layoutHeight, nextFrameWriter } from "../smoothHeight.ts";

const outer = ref<HTMLElement | null>(null);
const inner = ref<HTMLElement | null>(null);
const height = ref<number | null>(null);
let observer: ResizeObserver | null = null;
let cancelWrite: () => void = () => {};

onMounted(() => {
  const node = inner.value;
  if (!node || typeof ResizeObserver === "undefined") return;
  height.value = layoutHeight(node);
  const writer = nextFrameWriter((value) => { height.value = value; });
  cancelWrite = writer.cancel;
  observer = new ResizeObserver(([entry]) => writer.push(layoutHeight(node, entry)));
  observer.observe(node);
});
onBeforeUnmount(() => { observer?.disconnect(); cancelWrite(); });
</script>
