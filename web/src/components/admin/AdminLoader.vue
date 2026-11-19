<template>
  <div class="admin-loader" :class="{ 'is-visible': visible }" aria-hidden="true">
    <div class="admin-loader__card">
      <svg class="admin-loader__art" viewBox="0 0 120 120" fill="none" stroke-linecap="round" stroke-linejoin="round" focusable="false">
        <circle class="admin-loader__ring" cx="60" cy="60" r="46" />
        <circle class="admin-loader__orbit" cx="60" cy="60" r="46" pathLength="100" />
        <g class="admin-loader__dots">
          <circle cx="46" cy="60" r="4.5" />
          <circle cx="60" cy="60" r="4.5" />
          <circle cx="74" cy="60" r="4.5" />
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { FADE_MS, createLoader } from "../../admin/loader.ts";

const props = defineProps<{ active: boolean }>();
const visible = ref(false);
const controller = createLoader((next) => { visible.value = next; });
watch(() => props.active, (busy) => controller.setBusy(busy), { immediate: true });
let restoreTimer = 0;
const root = typeof document === "undefined" ? null : document.documentElement;
watch(visible, (shown) => {
  window.clearTimeout(restoreTimer);
  if (shown) root?.setAttribute("data-route-loading", "");
  else restoreTimer = window.setTimeout(() => root?.removeAttribute("data-route-loading"), FADE_MS);
});
onBeforeUnmount(() => { window.clearTimeout(restoreTimer); root?.removeAttribute("data-route-loading"); controller.dispose(); });
</script>

<style scoped>
.admin-loader { position: fixed; z-index: 70; inset: 0 0 0 var(--rail-w, 0px); display: grid; place-items: center; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity var(--t-std) var(--ease), visibility 0s linear var(--t-std), left var(--t-soft) var(--spring-soft); }
.admin-loader.is-visible { opacity: 1; visibility: visible; transition: opacity var(--t-std) var(--ease), visibility 0s, left var(--t-soft) var(--spring-soft); }
.admin-loader__card { display: grid; place-items: center; width: 92px; height: 92px; border: 1px solid var(--line); border-radius: var(--r-xl); background: var(--glass); box-shadow: var(--shadow-2); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); transform: translate3d(0, 14px, 0) scale(.9); filter: blur(4px); transition: transform .6s var(--spring-soft), filter var(--t-std) var(--ease); }
.admin-loader.is-visible .admin-loader__card { transform: none; filter: none; }
.admin-loader__art { width: 72px; height: 72px; overflow: visible; }
.admin-loader__ring { stroke: var(--blue-100); stroke-width: 6; }
.admin-loader__orbit { stroke: var(--blue-500); stroke-width: 6; stroke-linecap: round; stroke-dasharray: 22 78; transform-origin: 60px 60px; animation: loader-orbit 1.4s linear infinite; }
.admin-loader__dots circle { fill: var(--blue-400); transform-box: fill-box; transform-origin: center; animation: loader-dot 1s var(--ease) infinite; }
.admin-loader__dots circle:nth-child(2) { animation-delay: .12s; }
.admin-loader__dots circle:nth-child(3) { animation-delay: .24s; }
@keyframes loader-orbit { to { transform: rotate(360deg); } }
@keyframes loader-dot { 0%, 100% { opacity: .35; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-4px); } }
@media (max-width: 900px) { .admin-loader { left: 0; } }
@media (prefers-reduced-motion: reduce) {
  .admin-loader, .admin-loader.is-visible, .admin-loader__card { transition: opacity 120ms linear; }
  .admin-loader__orbit, .admin-loader__dots circle { animation: none; }
}
</style>
