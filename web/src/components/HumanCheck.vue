<template>
  <div class="human-check field--wide">
    <div class="human-check__image">
      <img v-if="image" :src="image" alt="四位人机验证字符" />
      <span v-else class="mail-empty">{{ loading ? "正在获取验证码…" : error || "请刷新验证码" }}</span>
    </div>
    <button
      class="icon-button human-check__refresh"
      type="button"
      aria-label="换一张验证码"
      :disabled="loading || retrySeconds > 0"
      @click="refresh"
    >
      {{ retrySeconds > 0 ? `${retrySeconds}s` : "↻" }}
    </button>
    <label class="field human-check__field">
      <span class="field__label">图中的四位字符</span>
      <input
        v-model="answer"
        autocomplete="off"
        maxlength="4"
        required
        :disabled="loading || !nonce"
      />
    </label>
    <small class="human-check__status" aria-live="polite">{{ error || status }}</small>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError, api } from "../api";

type HumanCheckResponse = {
  nonce: string;
  image: string;
  formToken?: string;
  domain?: string;
  expiresIn?: number;
  minFormSeconds?: number;
};

const props = withDefaults(
  defineProps<{ purpose?: string; admin?: boolean; status?: string }>(),
  { purpose: "login", admin: false, status: "输入图中的四位字符" },
);

const answer = defineModel<string>("answer", { default: "" });
const nonce = defineModel<string>("nonce", { default: "" });
const formToken = defineModel<string>("formToken", { default: "" });
const domain = defineModel<string>("domain", { default: "" });
const formReadyAt = defineModel<number>("formReadyAt", { default: 0 });

const image = ref("");
const loading = ref(false);
const error = ref("");
const retryUntil = ref(0);
const tick = ref(Date.now());
const retrySeconds = computed(() => Math.max(0, Math.ceil((retryUntil.value - tick.value) / 1000)));
let expiresAt = 0;
let timer = 0;
let active = true;
let controller: AbortController | null = null;

function invalidate(): void {
  image.value = ""; nonce.value = ""; answer.value = ""; formToken.value = "";
  formReadyAt.value = 0; expiresAt = 0;
  error.value = "请换一张验证码后再试";
}

async function load(): Promise<void> {
  if (!active || loading.value || retrySeconds.value > 0) return;
  loading.value = true;
  error.value = "";
  image.value = "";
  nonce.value = "";
  answer.value = "";
  formToken.value = "";
  formReadyAt.value = 0;
  controller = new AbortController();
  try {
    const data: HumanCheckResponse = props.admin
      ? await api<HumanCheckResponse>("/api/admin/human-check", { signal: controller.signal })
      : await api<HumanCheckResponse>(
          `/api/auth/human-check?purpose=${props.purpose}`,
          { signal: controller.signal },
        );
    if (!active) return;
    image.value = data.image;
    nonce.value = data.nonce;
    expiresAt = Date.now() + (data.expiresIn ?? 600) * 1000;
    answer.value = "";
    if (data.formToken) formToken.value = data.formToken;
    if (data.formToken) formReadyAt.value = Date.now() + (data.minFormSeconds ?? 2) * 1000;
    if (data.domain) domain.value = data.domain;
  } catch (caught) {
    if (active) {
      const data = caught instanceof ApiError ? caught.data as { retryAfterSeconds?: number } | null : null;
      const seconds = caught instanceof ApiError ? caught.retryAfterSeconds ?? data?.retryAfterSeconds ?? 0 : 0;
      if (seconds > 0) retryUntil.value = Date.now() + seconds * 1000;
      error.value = seconds > 0 ? "验证码请求过于频繁，请等待后再换一张" : "验证码获取失败，请点击换一张重试";
    }
  } finally {
    if (active) loading.value = false;
    controller = null;
  }
}

function refresh(): void {
  void load();
}

defineExpose({ refresh, load, invalidate });
onMounted(() => {
  void load();
  timer = window.setInterval(() => {
    tick.value = Date.now();
    if (expiresAt && tick.value >= expiresAt && nonce.value) {
      nonce.value = ""; answer.value = ""; formToken.value = "";
      error.value = "验证码已过期，请换一张";
    }
  }, 1000);
});
onBeforeUnmount(() => { active = false; controller?.abort(); window.clearInterval(timer); });
</script>

<style scoped>
/* Keep all three controls in one compact row, including narrow auth cards. */
.human-check {
  /* 148px reserves the 44px button, two 8px gaps and an 88px input. */
  grid-template-columns: clamp(72px, calc(100% - 148px), 112px) 44px minmax(0, 1fr);
  align-items: start;
  gap: 7px 8px;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.human-check__field { display: contents; }
.human-check__field > .field__label { grid-column: 1 / -1; grid-row: 1; }

.human-check__image {
  grid-column: 1;
  grid-row: 2;
  display: grid;
  place-items: center;
  height: 48px;
  min-height: 48px;
  box-sizing: border-box;
}
.human-check__image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.human-check__image .mail-empty {
  max-width: 100%;
  padding: 3px;
  font-size: 11px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.human-check__refresh {
  grid-column: 2;
  grid-row: 2;
  align-self: stretch;
  width: 44px;
  height: 48px;
  margin: 0;
  padding: 0;
  border-radius: 13px;
}
/* The captured theme uses !important for global icon-button translation. */
.human-check__refresh:hover,
.human-check__refresh:active,
.human-check__refresh:disabled { transform: none !important; }
.human-check__field input {
  grid-column: 3;
  grid-row: 2;
  width: 100%;
  min-width: 0;
  height: 48px;
  min-height: 48px;
  padding: 10px 8px;
  box-sizing: border-box;
  font-size: 16px;
  letter-spacing: .12em;
}
.human-check__status {
  grid-column: 1 / -1;
  grid-row: 3;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
