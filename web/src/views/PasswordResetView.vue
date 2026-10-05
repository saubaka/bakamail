<template>
  <main id="main-content" class="auth-shell">
    <BrandMark auth subtitle="密码重置申请" />
    <section v-motion="{ kind: 'feature', reversible: false }" class="auth-card card" aria-labelledby="reset-title">
      <span class="soft-icon soft-icon--blue auth-icon" aria-hidden="true">↺</span>
      <span class="eyebrow">PASSWORD RESET</span>
      <h1 id="reset-title">申请重置密码</h1>
      <p class="auth-description">提交后管理员会在后台处理。无论账号是否存在，页面都会返回相同结果。</p>
      <form v-if="!accepted" class="form-grid auth-form" @submit.prevent="submit">
        <label class="field field--wide">
          <span class="field__label">账号名或完整邮箱</span>
          <input v-model="account" autocomplete="username" autocapitalize="none" spellcheck="false" required />
        </label>
        <HumanCheck ref="humanRef" v-model:nonce="nonce" v-model:answer="answer" purpose="password-reset" />
        <p v-if="hint" v-capsule-notice class="field-error field--wide" role="alert">{{ hint }}</p>
        <button class="button button--primary field--wide" type="submit" :disabled="busy || !challengeReady">{{ busy ? "正在提交…" : "提交申请" }}</button>
      </form>
      <div v-else class="content-state">
        <span class="soft-icon soft-icon--blue" aria-hidden="true">✓</span>
        <strong>申请已记录</strong>
        <p>如果账号存在，管理员可以在后台为它设置新密码。</p>
      </div>
      <p class="hint-line"><router-link to="/login">返回登录</router-link></p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import BrandMark from "../components/BrandMark.vue";
import HumanCheck from "../components/HumanCheck.vue";
import { ApiError, api } from "../api";
import { humanCheckReady } from "../auth/loginState";

const account = ref("");
const nonce = ref("");
const answer = ref("");
const hint = ref("");
const busy = ref(false);
const accepted = ref(false);
const challengeReady = computed(() => humanCheckReady(nonce.value, answer.value));
const humanRef = ref<InstanceType<typeof HumanCheck> | null>(null);

async function submit(): Promise<void> {
  if (busy.value || !challengeReady.value) return;
  busy.value = true;
  hint.value = "";
  try {
    await api("/api/auth/password-reset", { method: "POST", body: { account: account.value, humanNonce: nonce.value, humanAnswer: answer.value } });
    accepted.value = true;
  } catch (reason) {
    hint.value = reason instanceof ApiError ? reason.message : "提交失败，请稍后再试";
    humanRef.value?.refresh();
  } finally {
    busy.value = false;
  }
}
</script>
