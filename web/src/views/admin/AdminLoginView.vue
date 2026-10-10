<template>
  <div class="login-page">
    <main id="main-content" class="login-main" tabindex="-1">
      <section v-motion="{ kind: 'feature', reversible: false }" class="login-card card" aria-labelledby="admin-login-title">
        <header class="login-heading">
          <span class="login-logo" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none"><rect x="5" y="9" width="30" height="23" rx="5" /><path d="m7 12 10 8a5 5 0 0 0 6 0l10-8M7 29l8-8m18 8-8-8" /></svg>
          </span>
          <span class="login-product-name">BakaMail</span>
          <h1 id="admin-login-title">登录后台</h1>
          <p>请使用管理员账号登录。</p>
        </header>
        <form class="form-grid auth-form login-form" novalidate @submit.prevent="submit">
          <label class="field field--wide">
            <span class="field__label">管理员账号</span>
            <input v-model="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="请输入管理员账号" />
          </label>
          <PasswordField v-model="password" />
          <HumanCheck
            v-if="humanVisible"
            ref="humanRef"
            v-model:nonce="humanNonce"
            v-model:answer="humanAnswer"
            admin
          />
          <p v-if="hint" v-capsule-notice class="field-error field--wide" role="alert">{{ hint }}</p>
          <p v-if="lockedSeconds > 0" class="hint-line field--wide">请等待冷却结束。验证码不能提前解除冷却。</p>
          <button v-press-feedback="'submit'" class="button login-submit action-submit field--wide" type="submit" :disabled="submission.disabled" :aria-busy="busy">
            <span class="action-submit__spinner" aria-hidden="true" /><span>{{ busy ? "正在登录…" : lockedSeconds > 0 ? `${lockedSeconds} 秒后可重试` : "登录后台" }}</span>
          </button>
        </form>
        <nav class="login-secondary-nav" aria-label="其他入口">
          <router-link to="/login">返回邮箱登录</router-link>
          <router-link to="/">了解 BakaMail</router-link>
        </nav>
      </section>
    </main>
    <footer class="login-footer">
      <p>© {{ year }} saubaka · BakaMail</p>
      <span>自建邮局的网页端。</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { probeLoginSession } from "../../auth/sessionProbe";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import HumanCheck from "../../components/HumanCheck.vue";
import PasswordField from "../../components/PasswordField.vue";
import { ApiError, api, setCsrfToken } from "../../api";
import { loginSubmissionState } from "../../auth/loginState";
import { useAdminSessionStore } from "../../stores/adminSession";
import { safeAdminDestination } from "../../../../shared/adminPaths";

const router = useRouter();
const route = useRoute();
const session = useAdminSessionStore();
const year = new Date().getFullYear();
const username = ref("");
const password = ref("");
const humanNonce = ref("");
const humanAnswer = ref("");
const humanVisible = ref(true);
const hint = ref("");
const busy = ref(false);
const humanRef = ref<InstanceType<typeof HumanCheck> | null>(null);
const retryUntil = ref(0);
const tick = ref(Date.now());
const lockedSeconds = computed(() => Math.max(0, Math.ceil((retryUntil.value - tick.value) / 1000)));
const submission = computed(() => loginSubmissionState(busy.value, lockedSeconds.value, humanVisible.value, humanNonce.value, humanAnswer.value));
let timer = 0;
watch(lockedSeconds, (seconds, previous) => {
  if (!seconds && previous > 0 && !humanNonce.value) humanRef.value?.refresh();
});

async function submit(): Promise<void> {
  if (submission.value.disabled) return;
  busy.value = true;
  hint.value = "";
  try {
    const data = await api<{ csrfToken: string; role: string }>("/api/admin/auth/login", {
      method: "POST",
      body: {
        username: username.value,
        password: password.value,
        humanNonce: humanNonce.value,
        humanAnswer: humanAnswer.value,
      },
    });
    session.clear();
    setCsrfToken(data.csrfToken, "admin");
    await router.push(safeAdminDestination(route.query.redirect));
  } catch (error) {
    if (error instanceof ApiError) {
      hint.value = error.message;
      const payload = error.data as { requireHuman?: boolean; humanNonce?: string; retryAfterSeconds?: number } | null;
      const seconds = error.retryAfterSeconds ?? payload?.retryAfterSeconds ?? 0;
      if (seconds > 0) retryUntil.value = Date.now() + seconds * 1000;
      humanNonce.value = "";
      humanAnswer.value = "";
      humanRef.value?.invalidate();
      if (!seconds && error.code !== "source_blocked") humanRef.value?.refresh();
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
    if (await probeLoginSession("admin")) await router.replace(safeAdminDestination(route.query.redirect));
  } catch {
    await router.replace({ name: "unavailable", query: { redirect: route.fullPath } });
  }
});

onBeforeUnmount(() => window.clearInterval(timer));
</script>

<style scoped>
.hint-line {
  margin: 14px 0 0;
  text-align: center;
  color: var(--text-soft);
  font-size: 12px;
}
</style>
