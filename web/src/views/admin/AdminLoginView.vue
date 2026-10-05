<template>
  <main id="main-content" class="auth-shell">
    <BrandMark auth subtitle="管理后台" />
    <section v-motion="{ kind: 'feature', reversible: false }" class="auth-card card" aria-labelledby="admin-login-title">
      <span class="soft-icon soft-icon--blue auth-icon" aria-hidden="true">⚙</span>
      <span class="eyebrow">ADMIN</span>
      <h1 id="admin-login-title">进入管理后台</h1>
      <form class="form-grid auth-form" novalidate @submit.prevent="submit">
        <label class="field field--wide">
          <span class="field__label">管理员账号</span>
          <input v-model="username" autocomplete="username" autocapitalize="none" spellcheck="false" />
        </label>
        <PasswordField v-model="password" />
        <HumanCheck
          v-if="humanVisible"
          ref="humanRef"
          v-model:nonce="humanNonce"
          v-model:answer="humanAnswer"
          admin
        />
        <p v-if="hint" v-capsule-notice class="field-error field--wide">{{ hint }}</p>
        <p v-if="lockedSeconds > 0" class="hint-line field--wide">请等待冷却结束。验证码不能提前解除冷却。</p>
        <button v-press-feedback="'submit'" class="button button--primary action-submit field--wide" type="submit" :disabled="submission.disabled" :aria-busy="busy">
          {{ busy ? "正在验证…" : lockedSeconds > 0 ? `${lockedSeconds} 秒后可重试` : "登录后台" }}
        </button>
      </form>
      <p class="hint-line"><router-link to="/login">返回邮箱登录</router-link></p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { probeLoginSession } from "../../auth/sessionProbe";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BrandMark from "../../components/BrandMark.vue";
import HumanCheck from "../../components/HumanCheck.vue";
import PasswordField from "../../components/PasswordField.vue";
import { ApiError, api, setCsrfToken } from "../../api";
import { loginSubmissionState } from "../../auth/loginState";
import { useAdminSessionStore } from "../../stores/adminSession";
import { safeAdminDestination } from "../../../../shared/adminPaths";

const router = useRouter();
const route = useRoute();
const session = useAdminSessionStore();
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
