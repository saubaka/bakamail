<template>
  <div class="admin-progress" :class="{ 'is-visible': visible, 'is-idle': idle }" aria-hidden="true">
    <div class="admin-progress__bar" :style="{ '--p': progress }"></div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { FINISH_HOLD_MS, GRACE_MS, START_DELAY_MS, TRICKLE_CEILING, nextProgress } from "../../admin/progressLine.ts";

const props = defineProps<{ active: boolean }>();
const visible = ref(false);
const idle = ref(true);
const progress = ref(0);
let startTimer = 0;
let trickleTimer = 0;
let hideTimer = 0;
let finishing = false;

function begin(): void {
  // 上一次的淡出还没结束就又开始了：取消淡出，沿用当前这条线继续走。
  window.clearTimeout(hideTimer);
  finishing = false;
  if (visible.value) {
    window.clearInterval(trickleTimer);
    idle.value = false;
    progress.value = Math.min(progress.value, TRICKLE_CEILING);
    trickleTimer = window.setInterval(() => { progress.value = nextProgress(progress.value); }, 150);
    return;
  }
  if (startTimer) return;
  // 很快完成的操作不闪一下线条。
  startTimer = window.setTimeout(async () => {
    startTimer = 0;
    idle.value = true;
    progress.value = 0;
    visible.value = true;
    await nextTick();
    void document.documentElement.offsetWidth; // 先让起点生效，再开始过渡；不依赖 requestAnimationFrame
    if (!visible.value || finishing) return;
    idle.value = false;
    progress.value = 0.16;
    trickleTimer = window.setInterval(() => { progress.value = nextProgress(progress.value); }, 150);
  }, START_DELAY_MS);
}

function finish(): void {
  window.clearTimeout(startTimer);
  startTimer = 0;
  if (!visible.value) return;
  window.clearInterval(trickleTimer);
  finishing = true;
  idle.value = false;
  progress.value = 1;
  hideTimer = window.setTimeout(() => { finishing = false; visible.value = false; idle.value = true; progress.value = 0; }, FINISH_HOLD_MS);
}

// 页面切换完成后，新页面会立刻发自己的数据请求：给“结束”留一小段缓冲，两段等待合并成一条线，不回退、不闪烁。
let graceTimer = 0;
watch(() => props.active, (on) => {
  window.clearTimeout(graceTimer);
  graceTimer = 0;
  if (on) begin();
  else graceTimer = window.setTimeout(() => { graceTimer = 0; finish(); }, GRACE_MS);
}, { immediate: true });
onBeforeUnmount(() => {
  window.clearTimeout(graceTimer);
  window.clearTimeout(startTimer);
  window.clearTimeout(hideTimer);
  window.clearInterval(trickleTimer);
});
</script>
