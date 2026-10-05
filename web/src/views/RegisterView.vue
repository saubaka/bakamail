<template>
  <main id="main-content" class="auth-shell">
    <BrandMark auth subtitle="邀请制开通" />
    <section v-motion="{ kind: 'feature', reversible: false }" class="auth-card card" aria-labelledby="register-title">
      <span class="soft-icon soft-icon--blue auth-icon" aria-hidden="true">✎</span>
      <span class="eyebrow">INVITE ONLY</span>
      <h1 id="register-title">用邀请码开通邮箱</h1>
      <form class="form-grid auth-form" novalidate @submit.prevent="submit">
        <label class="field field--wide">
          <span class="field__label">邀请码</span>
          <input v-model="inviteCode" autocomplete="off" spellcheck="false" />
        </label>
        <label class="field field--wide">
          <span class="field__label">账号名</span>
          <div class="field-inline">
            <input
              v-model="account"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="小写字母开头，3-50 位"
            />
            <span class="field-suffix">@{{ domain }}</span>
          </div>
        </label>
        <PasswordField v-model="password" label="密码" autocomplete="new-password" />
        <ul class="password-rules field--wide" aria-label="密码规则">
          <li :class="{ 'is-valid': password.length >= 10 }">至少 10 位</li>
          <li :class="{ 'is-valid': hasLetter }">包含字母</li>
          <li :class="{ 'is-valid': hasNonLetter }">包含数字或符号</li>
          <li :class="{ 'is-valid': passwordMatches }">两次输入一致</li>
        </ul>
        <PasswordField v-model="confirmPassword" label="再输一次密码" autocomplete="new-password" />
        <label class="field field--wide">
          <span class="field__label">申请理由（可选）</span>
          <textarea v-model="reason" rows="3" maxlength="500" :disabled="busy" :aria-describedby="reasonError ? 'register-reason-help register-reason-error' : 'register-reason-help'" :aria-invalid="Boolean(reasonError)" />
          <span id="register-reason-help" class="hint-line">{{ reason.length }}/500 字符，最多 2 个链接。请勿填写密码或其他敏感信息。</span>
          <span v-if="reasonError" id="register-reason-error" class="field-error" role="alert">{{ reasonError }}</span>
        </label>
        <HumanCheck
          ref="humanRef"
          v-model:nonce="humanNonce"
          v-model:answer="humanAnswer"
          v-model:formToken="formToken"
          v-model:formReadyAt="formReadyAt"
          v-model:domain="domain"
          purpose="register"
        />
        <!-- 蜜罐字段：正常用户看不见也不会填 -->
        <label class="honeypot" aria-hidden="true">
          <span>网址</span>
          <input v-model="website" tabindex="-1" autocomplete="off" />
        </label>
        <p v-if="hint" v-capsule-notice class="field-error field--wide">{{ hint }}</p>
        <button class="button button--primary field--wide" type="submit" :disabled="busy || lockedSeconds > 0 || !challengeReady">
          {{ busy ? "正在提交…" : lockedSeconds > 0 ? `${Math.ceil(lockedSeconds / 60)} 分钟后可重试` : "提交申请" }}
        </button>
      </form>
      <p class="hint-line"><router-link to="/login">返回登录</router-link></p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import BrandMark from "../components/BrandMark.vue";
import HumanCheck from "../components/HumanCheck.vue";
import PasswordField from "../components/PasswordField.vue";
import { ApiError, api, toast } from "../api";
import { humanCheckReady } from "../auth/loginState";

const router = useRouter();
const inviteCode = ref("");
const account = ref("");
const password = ref("");
const confirmPassword = ref("");
const humanNonce = ref("");
const humanAnswer = ref("");
const formToken = ref("");
const formReadyAt = ref(0);
const website = ref("");
const reason = ref("");
const reasonError = ref("");
const hint = ref("");
const busy = ref(false);
const domain = ref("");
const humanRef = ref<InstanceType<typeof HumanCheck> | null>(null);
const openedAt = ref(Date.now());
const retryUntil = ref(0);
const tick = ref(Date.now());
const lockedSeconds = computed(() => Math.max(0, Math.ceil((retryUntil.value - tick.value) / 1000)));
let timer = 0;
const hasLetter = computed(() => /[a-z]/i.test(password.value));
const hasNonLetter = computed(() => /[^a-z]/i.test(password.value));
const passwordMatches = computed(() => password.value.length > 0 && password.value === confirmPassword.value);
const challengeReady = computed(() => Boolean(formToken.value) && tick.value >= formReadyAt.value && humanCheckReady(humanNonce.value, humanAnswer.value));

async function submit(): Promise<void> {
  if (busy.value || lockedSeconds.value > 0 || !challengeReady.value) return;
  busy.value = true;
  hint.value = "";
  reasonError.value = "";
  try {
    await api("/api/auth/register", {
      method: "POST",
      body: {
        inviteCode: inviteCode.value.trim(),
        account: account.value.trim(),
        password: password.value,
        confirmPassword: confirmPassword.value,
        humanNonce: humanNonce.value,
        humanAnswer: humanAnswer.value,
        formToken: formToken.value,
        elapsedMs: Date.now() - openedAt.value,
        website: website.value,
        reason: reason.value,
      },
    });
    toast("邮箱已开通，请返回登录");
    await router.push("/login");
  } catch (error) {
    hint.value = error instanceof ApiError ? error.message : "提交失败，请稍后再试";
    if (error instanceof ApiError) {
      const data = error.data as { fieldErrors?: { reason?: string }; retryAfterSeconds?: number } | null;
      reasonError.value = data?.fieldErrors?.reason ?? "";
      const seconds = error.retryAfterSeconds ?? data?.retryAfterSeconds ?? 0;
      if (seconds > 0) retryUntil.value = Date.now() + seconds * 1000;
    }
    openedAt.value = Date.now();
    if (!lockedSeconds.value && !(error instanceof ApiError && error.code === "registration_closed")) humanRef.value?.refresh();
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  openedAt.value = Date.now();
  timer = window.setInterval(() => { tick.value = Date.now(); }, 1000);
});
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<style scoped>
.field-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-inline input {
  flex: 1;
}

.field-suffix {
  color: var(--text-soft);
  font-size: 13px;
}

.honeypot {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.hint-line {
  margin: 14px 0 0;
  text-align: center;
  color: var(--text-soft);
  font-size: 12px;
}
</style>
