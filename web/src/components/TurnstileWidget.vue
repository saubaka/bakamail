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
.ts-box {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--line-blue, #dfe9f1);
  border-radius: 18px;
  background: linear-gradient(145deg, #fff, #f4faff);
  box-shadow: inset 0 1px 0 #fff, 0 6px 18px rgba(83, 117, 143, .06);
  transition: border-color 220ms var(--ease, ease), box-shadow 260ms var(--ease, ease), background 220ms var(--ease, ease);
  animation: ts-arrive 280ms var(--ease, ease) both;
}
.ts-box.is-verified { border-color: #a9dcc6; background: linear-gradient(145deg, #fff, #f0faf5); box-shadow: inset 0 1px 0 #fff, 0 0 0 4px rgba(150, 215, 188, .14); }
.ts-box.is-error { border-color: #efc4c4; background: linear-gradient(145deg, #fff, #fff6f6); }
.ts-box__stage { position: relative; min-height: 65px; border-radius: 12px; overflow: hidden; }
.ts-box__mount { width: 100%; min-height: 65px; transition: opacity 200ms var(--ease, ease); }
.ts-box__mount.is-hidden { opacity: 0; pointer-events: none; position: absolute; inset: 0; }
.ts-box__skeleton {
  position: absolute; inset: 0; border-radius: 12px;
  background: linear-gradient(100deg, #eef5fa 30%, #f9fcfe 50%, #eef5fa 70%) 0 0 / 220% 100%;
  animation: ts-shimmer 1.4s linear infinite;
}
.ts-box__failure { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 65px; padding: 8px 4px; color: var(--text-soft); font-size: 13px; line-height: 1.6; }
.ts-box__failure > span:nth-child(2) { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }
.ts-box__status { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--text-soft); font-size: 12px; line-height: 1.6; }
.ts-box__mark { display: inline-grid; place-items: center; flex: 0 0 18px; width: 18px; height: 18px; }
.ts-box__mark--warn { border-radius: 50%; background: #fbe3e3; color: #b05252; font-size: 12px; font-weight: 700; }
.ts-box__mark svg { width: 18px; height: 18px; padding: 2px; border-radius: 50%; background: #d6f0e4; fill: none; stroke: #2f8f67; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ts-box__mark svg path { stroke-dasharray: 16; stroke-dashoffset: 16; animation: ts-check 320ms 80ms var(--ease, ease) forwards; }
.ts-box__dot { width: 8px; height: 8px; border-radius: 50%; background: #9bc9e5; }
.ts-box.is-expired .ts-box__dot { background: #e8c78a; }
.ts-box__spinner { width: 14px; height: 14px; border: 2px solid #cfe3f0; border-top-color: #7fb7d8; border-radius: 50%; animation: ts-spin 800ms linear infinite; }
@keyframes ts-arrive { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@keyframes ts-shimmer { to { background-position: -220% 0; } }
@keyframes ts-spin { to { transform: rotate(360deg); } }
@keyframes ts-check { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ts-box, .ts-box__skeleton, .ts-box__spinner, .ts-box__mark svg path { animation: none; }
  .ts-box__mark svg path { stroke-dashoffset: 0; }
  .ts-box, .ts-box__mount { transition: none; }
}
:global(html[data-motion="reduce"]) .ts-box, :global(html[data-motion="reduce"]) .ts-box__skeleton, :global(html[data-motion="reduce"]) .ts-box__spinner, :global(html[data-motion="reduce"]) .ts-box__mark svg path { animation: none; }
:global(html[data-motion="reduce"]) .ts-box__mark svg path { stroke-dashoffset: 0; }
</style>
