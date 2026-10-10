<template>
  <main id="main-content" class="auth-shell">
    <BrandMark auth subtitle="首次初始化" />
    <section v-motion="{ kind: 'feature', reversible: false }" class="auth-card card setup-card" aria-labelledby="setup-title">
      <span class="eyebrow">WELCOME</span>
      <h1 id="setup-title">初始化 Baka Mail</h1>
      <p class="hint-line">创建第一个超级管理员，并设置后台页面的路径。已经初始化过的站点不会重复创建。</p>
      <form class="form-grid auth-form" @submit.prevent="submit">
        <label class="field field--wide">
          <span class="field__label">初始化密钥</span>
          <input v-model="setupToken" type="password" autocomplete="off" required :disabled="busy" aria-describedby="setup-key-help" />
          <small id="setup-key-help">密钥在服务器数据目录的 setup.key 文件里，初始化完成后自动失效。</small>
        </label>
        <label class="field field--wide">
          <span class="field__label">管理员账号名</span>
          <input v-model="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="50" :disabled="busy" />
        </label>
        <PasswordField v-model="password" autocomplete="new-password" label="管理员密码" required :disabled="busy" />
        <PasswordField v-model="confirmation" autocomplete="new-password" label="再次输入密码" required :disabled="busy" />
        <p class="hint-line field--wide">密码至少 10 位，不能只有字母或只有数字。这个账号只用来管理 Baka Mail，不会创建邮箱。</p>
        <label class="field field--wide">
          <span class="field__label">管理员后台路径</span>
          <input v-model="adminBase" placeholder="/my-console" required maxlength="49" autocomplete="off" autocapitalize="none" spellcheck="false" :disabled="busy" aria-describedby="setup-entry-help" />
          <small id="setup-entry-help">路径只能有一层，以小写字母开头，可以包含数字、短横线和下划线。请把它加入书签，以后可以在后台修改。</small>
        </label>
        <p v-if="hint" v-capsule-notice class="field-error field--wide" role="alert">{{ hint }}</p>
        <button v-press-feedback="'submit'" class="button button--primary action-submit field--wide" type="submit" :disabled="busy" :aria-busy="busy">{{ busy ? "正在初始化…" : "完成初始化" }}</button>
      </form>
      <p class="hint-line">邮件服务的连接信息在服务器环境里配置。浏览器只访问本站接口，不会直接连接邮件服务器。</p>
    </section>
    <footer class="auth-copyright">© {{ new Date().getFullYear() }} Baka Mail</footer>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import BrandMark from "../components/BrandMark.vue";
import PasswordField from "../components/PasswordField.vue";
import { api, toast } from "../api";
import { adminPathProblem } from "../../../shared/adminPaths";
import { finishInstallation } from "../router";
import type { EntrySettings } from "../auth/installation";
const router = useRouter();
const setupToken = ref("");
const username = ref("");
const password = ref("");
const confirmation = ref("");
const adminBase = ref("");
const busy = ref(false);
const hint = ref("");
let active = true;
let controller: AbortController | undefined;
async function submit(): Promise<void> {
  if (busy.value) return;
  hint.value = adminPathProblem(adminBase.value);
  if (hint.value) return;
  if (password.value !== confirmation.value) { hint.value = "两次输入的密码不一致"; return; }
  busy.value = true;
  controller = new AbortController();
  const timer = setTimeout(() => controller?.abort(), 15_000);
  try {
    const result = await api<EntrySettings>("/api/installation", { method: "POST", signal: controller.signal,
      body: { setupToken: setupToken.value, username: username.value, password: password.value, adminBase: adminBase.value } });
    if (!active) return;
    password.value = confirmation.value = setupToken.value = "";
    finishInstallation(result.adminBase);
    toast("初始化完成。请记下后台地址，然后登录。");
    await router.replace(result.adminBase);
  } catch (error) {
    if (active) hint.value = error instanceof Error ? `${error.message}；如无法确认是否完成，请打开你设置的后台地址核对，不要删除数据库重试。` : "初始化失败，请稍后重试";
  } finally { clearTimeout(timer); if (active) busy.value = false; }
}
onBeforeUnmount(() => { active = false; controller?.abort(); password.value = confirmation.value = setupToken.value = ""; });
</script>

<style scoped>
.setup-card { width: min(100%, 620px); }
.setup-card h1 { font-size: clamp(1.65rem, 3.2vw, 2.15rem); line-height: 1.35; margin-block: 16px; }
.setup-card .auth-form { gap: 16px; }
.setup-card small { line-height: 1.7; overflow-wrap: anywhere; }
.setup-card .hint-line { line-height: 1.75; }
.auth-copyright { margin-top: 24px; color: var(--text-soft); font-size: 12px; line-height: 1.7; }
</style>
