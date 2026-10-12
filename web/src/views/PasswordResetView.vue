<template>
  <div class="login-page">
    <main id="main-content" class="login-main" tabindex="-1">
      <section v-motion="{ kind: 'feature', reversible: false }" class="login-card card" aria-labelledby="reset-title">
        <header class="login-heading">
          <span class="login-logo" aria-hidden="true">
            <svg viewBox="0 0 40 40" fill="none"><rect x="5" y="9" width="30" height="23" rx="5" /><path d="m7 12 10 8a5 5 0 0 0 6 0l10-8M7 29l8-8m18 8-8-8" /></svg>
          </span>
          <span class="login-product-name">{{ siteInfo.siteName }}</span>
          <h1 id="reset-title">申请重置密码</h1>
          <p>提交后由管理员处理，提示不会透露账号是否存在。</p>
        </header>
        <form v-if="!accepted" class="form-grid auth-form login-form" novalidate @submit.prevent="submit">
          <label class="field field--wide">
            <span class="field__label">账号名或完整邮箱</span>
            <input
              v-model="account"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="邮箱账号名或完整邮箱地址"
            />
          </label>
          <HumanCheck ref="humanRef" v-model:nonce="nonce" v-model:answer="answer" purpose="password-reset" />
          <p v-if="hint" v-capsule-notice class="field-error field--wide" role="alert">{{ hint }}</p>
          <p v-if="lockedSeconds > 0" class="hint-line field--wide">请等待冷却结束。验证码不能提前解除冷却。</p>
          <button v-press-feedback="'submit'" class="button login-submit action-submit field--wide" type="submit" :disabled="submission.disabled" :aria-busy="busy">
            <span class="action-submit__spinner" aria-hidden="true" /><span>{{ busy ? "正在提交…" : lockedSeconds > 0 ? lockedLabel : "提交申请" }}</span>
          </button>
        </form>
        <div v-else class="content-state">
          <span class="soft-icon soft-icon--blue" aria-hidden="true">✓</span>
          <strong>申请已记录</strong>
          <p>如果这个账号存在，管理员会为它设置新密码。</p>
        </div>
        <div class="login-invitation">
          <span>想起密码了？</span>
          <router-link to="/login">返回登录<span aria-hidden="true">↗</span></router-link>
        </div>
        <nav class="login-secondary-nav" aria-label="其他入口">
          <router-link to="/">了解 {{ siteInfo.siteName }}</router-link>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import HumanCheck from "../components/HumanCheck.vue";
import { ApiError, api } from "../api";
import { siteInfo } from "../siteInfo";
import { loginSubmissionState } from "../auth/loginState";

const year = new Date().getFullYear();
const account = ref("");
const nonce = ref("");
const answer = ref("");
const hint = ref("");
const busy = ref(false);
const accepted = ref(false);
const humanRef = ref<InstanceType<typeof HumanCheck> | null>(null);
const retryUntil = ref(0);
const tick = ref(Date.now());
const lockedSeconds = computed(() => Math.max(0, Math.ceil((retryUntil.value - tick.value) / 1000)));
const lockedLabel = computed(() => (lockedSeconds.value >= 120 ? `${Math.ceil(lockedSeconds.value / 60)} 分钟后可重试` : `${lockedSeconds.value} 秒后可重试`));
// 验证码一直显示：和登录页相同，提交按钮在验证码填好之前、忙碌或冷却期间保持不可用。
const submission = computed(() => loginSubmissionState(busy.value, lockedSeconds.value, true, nonce.value, answer.value));
let timer = 0;
watch(lockedSeconds, (seconds, previous) => {
  if (!seconds && previous > 0 && !nonce.value) humanRef.value?.refresh();
});

async function submit(): Promise<void> {
  if (submission.value.disabled) return;
  busy.value = true;
  hint.value = "";
  try {
    await api("/api/auth/password-reset", { method: "POST", body: { account: account.value, humanNonce: nonce.value, humanAnswer: answer.value } });
    accepted.value = true;
  } catch (error) {
    if (error instanceof ApiError) {
      hint.value = error.message;
      const seconds = error.retryAfterSeconds ?? 0;
      if (seconds > 0) retryUntil.value = Date.now() + seconds * 1000;
      humanRef.value?.invalidate();
      nonce.value = "";
      answer.value = "";
      if (!seconds) humanRef.value?.refresh();
    } else {
      hint.value = "提交失败，请稍后再试";
    }
  } finally {
    busy.value = false;
  }
}

onMounted(() => { timer = window.setInterval(() => { tick.value = Date.now(); }, 1000); });
onBeforeUnmount(() => window.clearInterval(timer));
</script>
