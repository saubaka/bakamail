<template>
  <div>
    <main id="main-content" class="page-shell mail-utility-shell" tabindex="-1">
      <section v-motion="{ kind: 'feature', reversible: false }" class="admin-panel mail-tool-panel">
        <div class="section-heading mail-tool-heading">
          <div><span class="eyebrow">PREFERENCES</span><h1>邮箱设置</h1><p>这些偏好由 BakaMail 保存，不会直接写入邮局核心。</p></div>
          <button class="button button--primary" type="button" :disabled="saving || !settingsLoaded" @click="save">{{ saving ? "正在保存…" : "保存设置" }}</button>
        </div>
        <div class="settings-grid">
          <label class="field">
            <span class="field__label">列表密度</span>
            <select v-theme-control v-model="form.density" :disabled="saving || !settingsLoaded"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select>
          </label>
          <label class="field">
            <span class="field__label">每页邮件数</span>
            <select v-theme-control v-model="form.pageSize" :disabled="saving || !settingsLoaded"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select>
          </label>
          <label class="field">
            <span class="field__label">时间格式</span>
            <select v-theme-control v-model="form.timeFormat" :disabled="saving || !settingsLoaded"><option value="24h">24 小时</option><option value="12h">12 小时</option></select>
          </label>
          <label class="field">
            <span class="field__label">远程图片</span>
            <select v-theme-control v-model="form.remoteImages" :disabled="saving || !settingsLoaded"><option value="ask">每次询问</option><option value="block">始终阻止</option><option value="allow">始终显示</option></select>
          </label>
          <label class="field">
            <span class="field__label">动效</span>
            <select v-theme-control v-model="motion" @change="updateLocalMotion"><option value="system">跟随系统</option><option value="reduce">减少动态效果</option></select>
          </label>
          <label class="field">
            <span class="field__label">性能模式</span>
            <select v-theme-control v-model="performanceMode" @change="updateLocalMotion"><option value="normal">标准效果</option><option value="low">低性能（减少动画与模糊）</option></select>
          </label>
          <label class="field settings-signature">
            <span class="field__label">邮件签名</span>
            <textarea v-model="form.signature" rows="6" maxlength="2000" :disabled="saving || !settingsLoaded" placeholder="发送新邮件时可插入的签名"></textarea>
          </label>
        </div>
        <p class="mail-notice">动效和性能模式选择后立即生效，仅保存在当前浏览器；其他邮箱偏好点击“保存设置”后由 BakaMail 后端保存。</p>
        <p v-if="loading" class="mail-notice" role="status">正在读取邮箱设置…</p>
        <p v-if="error" v-capsule-notice class="field-error" role="alert">{{ error }}</p>
        <button v-if="error && !settingsLoaded" class="button button--soft" type="button" :disabled="loading" @click="load">{{ loading ? "正在重试…" : "重试读取设置" }}</button>
      </section>

      <section v-motion="{ kind: 'compact', delay: 90 }" class="admin-panel mail-tool-panel account-session-card">
        <div>
          <span class="eyebrow">CURRENT SESSION</span>
          <h2>当前会话</h2>
          <dl class="detail-grid">
            <div><dt>邮箱</dt><dd>{{ session.mailbox }}</dd></div>
            <div><dt>会话到期</dt><dd>{{ expiresLabel }}</dd></div>
            <div><dt>邮局连接</dt><dd>{{ session.liveConnections }} 条</dd></div>
            <div><dt>单封上限</dt><dd>{{ formatSize(session.maxMessageBytes) }}</dd></div>
          </dl>
        </div>
        <div class="danger-zone">
          <div><strong>退出所有设备</strong><p>吊销这个邮箱的全部网页登录会话，并断开当前 BFF 邮局连接。</p></div>
          <button class="button button--danger" type="button" :disabled="logoutAllBusy" @click="logoutAll">{{ logoutAllBusy ? "正在退出…" : "退出所有设备" }}</button>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, formatSize, toast } from "../api";
import { SessionSupersededError } from "../auth/sessionRequests";
import { DEFAULT_MAIL_PREFERENCES, type MailPreferences } from "../api/settings";
import { confirmDialog } from "../dialog";
import { applyMotionPreferences, currentMotionPreferences, type MotionPreference, type PerformancePreference } from "../motion";
import { useSessionStore } from "../stores/session";
import { usePreferenceStore } from "../stores/preferences";

const router = useRouter();
const session = useSessionStore();
const preferences = usePreferenceStore();
const saving = ref(false);
const logoutAllBusy = ref(false);
const loading = ref(false);
const settingsLoaded = ref(false);
const error = ref("");
const motion = ref<MotionPreference>(currentMotionPreferences().motion);
const performanceMode = ref<PerformancePreference>(currentMotionPreferences().performance);
const form = reactive<MailPreferences>({ ...DEFAULT_MAIL_PREFERENCES });
let active = true;
const expiresLabel = computed(() => session.expiresAt ? new Date(session.expiresAt).toLocaleString("zh-CN") : "—");

function updateLocalMotion(): void {
  applyMotionPreferences(motion.value, performanceMode.value);
}

async function load(): Promise<void> {
  if (!active || !session.mailbox || preferences.owner !== session.mailbox.toLowerCase()) return;
  const current = preferences.context();
  loading.value = true;
  settingsLoaded.value = false;
  error.value = "";
  try {
    if (!(await preferences.load()) || !active || !preferences.isCurrent(current)) return;
    Object.assign(form, preferences.settings);
    settingsLoaded.value = true;
  } catch (reason) {
    if (!active || !preferences.isCurrent(current)) return;
    if (reason instanceof ApiError && reason.status === 401) {
      await router.replace({ name: "intro", query: { reason: "session", redirect: "/mail/settings" } });
      return;
    }
    error.value = reason instanceof ApiError ? reason.message : "设置暂时无法读取，请重试";
  } finally {
    if (active && preferences.isCurrent(current)) loading.value = false;
  }
}

async function save(): Promise<void> {
  if (saving.value || !settingsLoaded.value) return;
  const current = preferences.context();
  saving.value = true;
  error.value = "";
  try {
    if (await preferences.save({ ...form }) && active && preferences.isCurrent(current)) toast("设置已保存");
  } catch (reason) {
    if (active && preferences.isCurrent(current)) {
      settingsLoaded.value = false;
      error.value = reason instanceof ApiError ? reason.message : "保存结果未确认，请重新读取后核对";
    }
  } finally {
    if (active && preferences.isCurrent(current)) saving.value = false;
  }
}

async function logoutAll(): Promise<void> {
  if (logoutAllBusy.value) return;
  logoutAllBusy.value = true;
  error.value = "";
  try {
    if (!(await confirmDialog({
      title: "退出全部设备",
      message: "这个邮箱的全部网页登录会话都会立即失效，之后需要重新输入密码。",
      confirmLabel: "全部退出",
      tone: "danger",
    }))) return;
    await session.logout(true);
    await router.push("/");
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "退出所有设备失败，请重试";
  } finally {
    logoutAllBusy.value = false;
  }
}

onMounted(async () => {
  try {
    await session.restore();
    if (!active) return;
  } catch (reason) {
    if (reason instanceof SessionSupersededError) return;
    if (reason instanceof ApiError && reason.status === 401) await router.replace({ name: "intro", query: { reason: "session", redirect: "/mail/settings" } });
    else error.value = reason instanceof ApiError ? reason.message : "会话暂时无法确认，请稍后重试";
    return;
  }
  preferences.bindOwner(session.mailbox);
  await load();
});

onBeforeUnmount(() => {
  active = false;
  preferences.suspend();
});
</script>
