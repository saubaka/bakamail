<template>
  <div class="login-page">
    <main id="main-content" class="login-main" tabindex="-1">
      <section v-motion="{ kind: 'feature', reversible: false }" class="login-card card" aria-labelledby="login-title">
        <header class="login-heading">
          <span class="login-logo" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none"><rect x="5" y="9" width="30" height="23" rx="5" /><path d="m7 12 10 8a5 5 0 0 0 6 0l10-8M7 29l8-8m18 8-8-8" /></svg>
          </span>
          <span class="login-product-name">BakaMail</span>
          <h1 id="login-title">登录邮箱</h1>
          <p>让每一封来信，都有自己的位置。</p>
        </header>
        <form class="form-grid auth-form login-form" novalidate @submit.prevent="submit">
        <label class="field field--wide">
          <span class="field__label">账号名或完整邮箱</span>
          <input
            v-model="account"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            placeholder="例如 me 或 me@saubaka.com"
          />
        </label>
        <div class="login-password-group field--wide">
          <PasswordField v-model="password" />
          <router-link class="login-forgot" to="/password-reset">忘记密码</router-link>
        </div>
        <HumanCheck
          v-if="humanVisible"
          ref="humanRef"
          v-model:nonce="humanNonce"
          v-model:answer="humanAnswer"
          purpose="login"
        />
        <p v-if="hint" v-capsule-notice class="field-error field--wide" role="alert">{{ hint }}</p>
        <p v-if="lockedSeconds > 0" class="hint-line field--wide">请等待冷却结束。验证码不能提前解除冷却。</p>
        <button v-press-feedback="'submit'" class="button login-submit action-submit field--wide" type="submit" :disabled="submission.disabled" :aria-busy="busy">
          <span class="action-submit__spinner" aria-hidden="true" /><span>{{ busy ? "正在登录…" : lockedSeconds > 0 ? `${lockedSeconds} 秒后可重试` : "登录" }}</span>
        </button>
        </form>
        <div class="login-invitation">
          <span>收到邀请码？</span>
          <router-link to="/register">用邀请码开通邮箱<span aria-hidden="true">↗</span></router-link>
        </div>
        <nav class="login-secondary-nav" aria-label="其他入口">
          <router-link to="/">了解 BakaMail</router-link>
        </nav>
      </section>
    </main>
    <footer class="login-footer">
      <p>© {{ year }} saubaka · BakaMail</p>
      <span>给来信留一扇小窗。</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import HumanCheck from "../components/HumanCheck.vue";
import PasswordField from "../components/PasswordField.vue";
import { ApiError, api, setCsrfToken, toast } from "../api";
import { useSessionStore } from "../stores/session";
import { loginSubmissionState } from "../auth/loginState";
import { probeLoginSession } from "../auth/sessionProbe";
import { safeMailDestination } from "../auth/entryGate";

const router = useRouter();
const route = useRoute();
const session = useSessionStore();
const year = new Date().getFullYear();
const account = ref("");
const password = ref("");
const humanNonce = ref("");
const humanAnswer = ref("");
const humanVisible = ref(false);
const busy = ref(false);
const hint = ref("");
const humanRef = ref<InstanceType<typeof HumanCheck> | null>(null);
const retryUntil = ref(0);
const tick = ref(Date.now());
const lockedSeconds = computed(() => Math.max(0, Math.ceil((retryUntil.value - tick.value) / 1000)));
const submission = computed(() => loginSubmissionState(busy.value, lockedSeconds.value, humanVisible.value, humanNonce.value, humanAnswer.value));
let timer = 0;
watch(lockedSeconds, (seconds, previous) => {
  if (!seconds && previous > 0 && humanVisible.value && !humanNonce.value) humanRef.value?.refresh();
});

async function submit(): Promise<void> {
  if (submission.value.disabled) return;
  busy.value = true;
  hint.value = "";
  try {
    const data = await api<{ mailbox: string; csrfToken: string }>("/api/auth/login", {
      method: "POST",
      body: {
        account: account.value,
        password: password.value,
        humanNonce: humanNonce.value,
        humanAnswer: humanAnswer.value,
      },
    });
    session.clear();
    setCsrfToken(data.csrfToken);
    toast(`已登录 ${data.mailbox}`);
    const redirect = String(route.query.redirect ?? "");
    await router.push(safeMailDestination(redirect));
  } catch (error) {
    if (error instanceof ApiError) {
      hint.value = error.message;
      const data = error.data as
        | { requireHuman?: boolean; humanNonce?: string; humanImage?: string; retryAfterSeconds?: number }
        | null;
      const wasVisible = humanVisible.value;
      const seconds = error.retryAfterSeconds ?? data?.retryAfterSeconds ?? 0;
      if (seconds > 0) retryUntil.value = Date.now() + seconds * 1000;
      if (data?.requireHuman) {
        humanVisible.value = true;
      }
      if (humanVisible.value) {
        humanRef.value?.invalidate();
        humanNonce.value = "";
        humanAnswer.value = "";
        if (wasVisible && !seconds) humanRef.value?.refresh();
      }
    } else {
      hint.value = "登录失败，请稍后再试";
    }
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  timer = window.setInterval(() => { tick.value = Date.now(); }, 1000);
  try {
    if (await probeLoginSession("mail")) await router.replace(safeMailDestination(route.query.redirect));
  } catch {
    await router.replace({ name: "unavailable", query: { redirect: route.fullPath } });
  }
});

onBeforeUnmount(() => window.clearInterval(timer));
</script>
