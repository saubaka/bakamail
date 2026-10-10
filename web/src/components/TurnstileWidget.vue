<template>
  <div class="ts-box" :class="`is-${state}`" :data-state="state">
    <div class="ts-box__stage">
      <div ref="mount" class="ts-box__mount" :class="{ 'is-hidden': state === 'error' }"></div>
      <div v-if="state === 'loading'" class="ts-box__skeleton" aria-hidden="true"></div>
      <div v-if="state === 'error'" class="ts-box__failure" role="alert">
        <span class="ts-box__mark ts-box__mark--warn" aria-hidden="true">!</span>
        <span>{{ message }}</span>
        <button v-if="needsReload" class="button button--soft" type="button" @click="reloadPage">刷新页面</button>
        <button v-else class="button button--soft" type="button" @click="retry">重试</button>
      </div>
    </div>
    <p class="ts-box__status" role="status" aria-live="polite">
      <span class="ts-box__mark" aria-hidden="true">
        <svg v-if="state === 'verified'" viewBox="0 0 16 16"><path d="m3.5 8.4 3 3 6-6.6" /></svg>
        <i v-else-if="state === 'loading'" class="ts-box__spinner"></i>
        <i v-else class="ts-box__dot"></i>
      </span>
      <span>{{ statusText }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CSP_BLOCKED, loadTurnstile, turnstileErrorText, type TurnstileApi } from "../auth/turnstileLoader";

const props = withDefaults(defineProps<{ siteKey: string; action?: string }>(), { action: "" });
const token = defineModel<string>("token", { default: "" });
const emit = defineEmits<{ state: [value: WidgetState] }>();

type WidgetState = "loading" | "ready" | "verified" | "expired" | "error";
const state = ref<WidgetState>("loading");
const message = ref("");
const needsReload = ref(false);
const mount = ref<HTMLElement | null>(null);
let api: TurnstileApi | null = null;
let widgetId = "";
let active = true;

const statusText = computed(() => ({
  loading: "正在加载人机验证…",
  ready: "请完成上方的人机验证",
  verified: "人机验证已通过",
  expired: "验证已过期，正在重新验证…",
  error: "验证组件暂时无法使用",
})[state.value]);

function setState(next: WidgetState): void {
  state.value = next;
  emit("state", next);
}

function remove(): void {
  if (api && widgetId) { try { api.remove(widgetId); } catch { /* the widget may already be gone */ } }
  widgetId = "";
}

async function render(): Promise<void> {
  remove();
  token.value = "";
  message.value = "";
  needsReload.value = false;
  setState("loading");
  try {
    api = await loadTurnstile();
    if (!active) return;
    await nextTick();
    if (!mount.value || !props.siteKey) return;
    widgetId = api.render(mount.value, {
      sitekey: props.siteKey,
      action: props.action || undefined,
      theme: "light",
      size: "flexible",
      language: "zh-cn",
      retry: "auto",
      "refresh-expired": "auto",
      callback: (value) => { if (!active) return; token.value = value; setState("verified"); },
      "expired-callback": () => { if (!active) return; token.value = ""; setState("expired"); },
      "timeout-callback": () => { if (!active) return; token.value = ""; setState("ready"); },
      "before-interactive-callback": () => { if (active) setState("ready"); },
      "error-callback": (code) => {
        if (!active) return;
        token.value = "";
        message.value = turnstileErrorText(code);
        setState("error");
      },
    });
    // 无需交互的验证会很快直接通过；否则等 before-interactive 回调切换状态。
    if (state.value === "loading") setState("ready");
  } catch (reason) {
    if (!active) return;
    needsReload.value = reason instanceof Error && reason.message === CSP_BLOCKED;
    message.value = needsReload.value
      ? "这个页面打开时还没有放行 Cloudflare，请刷新一次页面"
      : "无法连接 Cloudflare，请检查网络或稍后重试";
    setState("error");
  }
}

function retry(): void { void render(); }
function reloadPage(): void { window.location.reload(); }

/** 令牌只能使用一次：提交失败或需要重新验证时调用。 */
function reset(): void {
  token.value = "";
  if (api && widgetId) {
    try { api.reset(widgetId); setState("ready"); return; } catch { /* fall through to a full render */ }
  }
  void render();
}

watch(() => [props.siteKey, props.action], () => { void render(); });
onMounted(() => { void render(); });
onBeforeUnmount(() => { active = false; remove(); });
defineExpose({ reset, retry });
</script>

<style scoped>
/* 组件本身没有外框和底色：Cloudflare 的验证框自带边框，再包一层卡片只会重复。 */
.ts-box { display: grid; gap: 8px; min-width: 0; animation: ts-arrive 240ms var(--ease, ease) both; }
.ts-box__stage { position: relative; min-height: 65px; }
.ts-box__mount { width: 100%; min-height: 65px; transition: opacity 200ms var(--ease, ease); }
.ts-box__mount.is-hidden { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
.ts-box__skeleton { position: absolute; inset: 0; border: 1px solid var(--line-blue, #dfe9f1); border-radius: 6px; background: #eef3f7; animation: ts-pulse 1.2s ease-in-out infinite; }
.ts-box__failure { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 65px; padding: 8px 0; color: var(--text-soft); font-size: 13px; line-height: 1.6; }
.ts-box__failure > span:nth-child(2) { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }
.ts-box__status { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--text-soft); font-size: 12px; line-height: 1.6; transition: color 200ms var(--ease, ease); }
.ts-box.is-verified .ts-box__status { color: #2c7a5a; }
.ts-box.is-error .ts-box__status { color: #a24c4c; }
.ts-box__mark { display: inline-grid; place-items: center; flex: 0 0 16px; width: 16px; height: 16px; }
.ts-box__mark--warn { border-radius: 50%; background: #fbe3e3; color: #b05252; font-size: 11px; font-weight: 700; }
.ts-box__mark svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.ts-box__mark svg path { stroke-dasharray: 16; stroke-dashoffset: 16; animation: ts-check 300ms 60ms var(--ease, ease) forwards; }
.ts-box__dot { width: 7px; height: 7px; border-radius: 50%; background: #9bc9e5; }
.ts-box.is-expired .ts-box__dot { background: #e0b96a; }
.ts-box__spinner { width: 13px; height: 13px; border: 2px solid #d5e5f0; border-top-color: #7fb7d8; border-radius: 50%; animation: ts-spin 800ms linear infinite; }
@keyframes ts-arrive { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes ts-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
@keyframes ts-spin { to { transform: rotate(360deg); } }
@keyframes ts-check { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ts-box, .ts-box__skeleton, .ts-box__spinner, .ts-box__mark svg path { animation: none; }
  .ts-box__mark svg path { stroke-dashoffset: 0; }
  .ts-box__mount, .ts-box__status { transition: none; }
}
:global(html[data-motion="reduce"]) .ts-box, :global(html[data-motion="reduce"]) .ts-box__skeleton, :global(html[data-motion="reduce"]) .ts-box__spinner, :global(html[data-motion="reduce"]) .ts-box__mark svg path { animation: none; }
:global(html[data-motion="reduce"]) .ts-box__mark svg path { stroke-dashoffset: 0; }
</style>
