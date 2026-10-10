<template>
  <section v-motion="{ kind: 'feature' }" class="managed-page-card totp-settings" :aria-busy="loading || busy" aria-labelledby="totp-title">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">TWO-STEP</span>
        <h2 id="totp-title">我的二步验证</h2>
        <p>启用后，登录后台除了密码，还要输入验证器应用里的 6 位数字。即使密码泄露，别人也进不了后台。</p>
      </div>
      <span class="badge" :class="state?.enabled ? 'badge--blue' : 'badge--gray'">{{ !state ? "未读取" : state.enabled ? "已启用" : "未启用" }}</span>
    </div>
    <p v-if="loading && !state" class="admin-page-state" role="status">正在读取二步验证状态…</p>
    <p v-if="error" v-capsule-notice class="form-error" role="alert">{{ error }}</p>
    <button v-if="!state && !loading" class="button button--soft" type="button" @click="load">重新读取</button>

    <!-- 刚启用：恢复码只显示这一次 -->
    <div v-if="recoveryCodes.length" class="totp-recovery" role="region" aria-label="恢复码">
      <strong>请现在保存这 {{ recoveryCodes.length }} 个恢复码</strong>
      <p class="totp-note">手机丢失或无法使用验证器时，每个恢复码可以代替动态码登录一次。它们只显示这一次，请存放在密码管理器或其他安全的地方。</p>
      <ul class="totp-codes"><li v-for="item in recoveryCodes" :key="item"><code>{{ item }}</code></li></ul>
      <div class="button-row">
        <button class="button button--soft" type="button" @click="copyRecovery">复制全部</button>
        <button class="button button--primary" type="button" @click="recoveryCodes = []">我已保存</button>
      </div>
    </div>

    <!-- 未启用 -->
    <template v-else-if="state && !state.enabled">
      <button v-if="!setup" v-press-feedback class="button button--primary" type="button" :disabled="busy" @click="begin">启用二步验证</button>
      <form v-else class="form-grid totp-setup" @submit.prevent="confirm">
        <ol class="totp-steps field--wide">
          <li>在手机上打开验证器应用（如 Google Authenticator、Microsoft Authenticator、1Password），选择“手动输入密钥”。</li>
          <li>账号填 <code>{{ username }}</code>，密钥填下面这串（不区分大小写，空格可忽略），类型选“基于时间”。</li>
          <li>输入验证器里显示的 6 位数字，点“确认启用”。</li>
        </ol>
        <div class="field field--wide">
          <span class="field__label">密钥</span>
          <code class="totp-secret">{{ groupedSecret }}</code>
          <div class="button-row">
            <button class="button button--soft" type="button" @click="copy(setup.secret, '密钥已复制')">复制密钥</button>
            <button class="button button--soft" type="button" @click="copy(setup.uri, '配置链接已复制')">复制配置链接</button>
          </div>
        </div>
        <label class="field">
          <span class="field__label">验证器里的 6 位数字</span>
          <input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" :disabled="busy" />
        </label>
        <div class="button-row field--wide">
          <button v-press-feedback="'submit'" class="button button--primary" type="submit" :disabled="busy || code.trim().length !== 6">{{ busy ? "正在确认…" : "确认启用" }}</button>
          <button class="button button--soft" type="button" :disabled="busy" @click="cancel">取消</button>
        </div>
      </form>
    </template>

    <!-- 已启用 -->
    <template v-else-if="state?.enabled">
      <p class="totp-note">登录时需要验证码。剩余可用恢复码 <strong>{{ state.recoveryRemaining }}</strong> 个。<span v-if="state.recoveryRemaining <= 2" class="totp-warn">恢复码快用完了，建议停用后重新启用来生成一批新的。</span></p>
      <form class="form-grid" @submit.prevent="disable">
        <PasswordField v-model="password" label="当前密码" autocomplete="current-password" :wide="false" :disabled="busy" />
        <label class="field">
          <span class="field__label">验证码或恢复码</span>
          <input v-model="code" autocomplete="one-time-code" maxlength="20" placeholder="6 位数字或恢复码" :disabled="busy" />
        </label>
        <div class="button-row field--wide">
          <button class="button button--danger" type="submit" :disabled="busy || !password || code.trim().length < 6">{{ busy ? "正在停用…" : "停用二步验证" }}</button>
        </div>
      </form>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError, api, toast } from "../../api";
import PasswordField from "../PasswordField.vue";
import { confirmDialog } from "../../dialog";
import { useAdminSessionStore } from "../../stores/adminSession";

type State = { enabled: boolean; pending: boolean; recoveryRemaining: number };
const session = useAdminSessionStore();
const username = computed(() => session.me?.username ?? "");
const state = ref<State | null>(null);
const setup = ref<{ secret: string; uri: string } | null>(null);
const recoveryCodes = ref<string[]>([]);
const code = ref("");
const password = ref("");
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const groupedSecret = computed(() => (setup.value?.secret ?? "").replace(/(.{4})/g, "$1 ").trim());
let active = true;

const message = (reason: unknown, fallback: string): string => reason instanceof ApiError ? reason.message : fallback;

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const next = await api<State>("/api/admin/auth/totp");
    if (active) state.value = next;
  } catch (reason) {
    if (active) error.value = message(reason, "二步验证状态读取失败");
  } finally {
    if (active) loading.value = false;
  }
}

async function begin(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const data = await api<{ secret: string; uri: string }>("/api/admin/auth/totp/setup", { method: "POST" });
    if (active) { setup.value = data; code.value = ""; }
  } catch (reason) {
    if (active) error.value = message(reason, "无法开始启用，请稍后重试");
  } finally {
    if (active) busy.value = false;
  }
}

function cancel(): void {
  setup.value = null;
  code.value = "";
  error.value = "";
}

async function confirm(): Promise<void> {
  if (busy.value || code.value.trim().length !== 6) return;
  busy.value = true;
  error.value = "";
  try {
    const data = await api<{ recoveryCodes: string[] }>("/api/admin/auth/totp/enable", { method: "POST", body: { code: code.value.trim() } });
    if (!active) return;
    recoveryCodes.value = data.recoveryCodes;
    setup.value = null;
    code.value = "";
    toast("二步验证已启用，请保存恢复码");
    await load();
  } catch (reason) {
    if (active) error.value = message(reason, "启用失败，请稍后重试");
  } finally {
    if (active) busy.value = false;
  }
}

async function disable(): Promise<void> {
  if (busy.value) return;
  if (!(await confirmDialog({
    title: "停用二步验证",
    message: "停用后，登录后台只需要密码，现有恢复码也会作废。确定要停用吗？",
    confirmLabel: "停用",
    tone: "danger",
  }))) return;
  busy.value = true;
  error.value = "";
  try {
    await api("/api/admin/auth/totp/disable", { method: "POST", body: { password: password.value, code: code.value.trim() } });
    if (!active) return;
    password.value = "";
    code.value = "";
    toast("二步验证已停用");
    await load();
  } catch (reason) {
    if (active) error.value = message(reason, "停用失败，请稍后重试");
  } finally {
    if (active) busy.value = false;
  }
}

async function copy(text: string, done: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("浏览器不允许复制，请手动选择文字", "warning");
  }
}
const copyRecovery = (): Promise<void> => copy(recoveryCodes.value.join("\n"), "恢复码已复制");

onMounted(() => { void load(); });
onBeforeUnmount(() => { active = false; password.value = ""; code.value = ""; recoveryCodes.value = []; setup.value = null; });
</script>

<style scoped>
.totp-steps { margin: 0 0 4px; padding-left: 20px; line-height: 1.9; color: var(--text-soft); font-size: 13px; }
.totp-steps code, .totp-note code { padding: 1px 6px; border-radius: var(--radius-sm); background: var(--surface-soft); }
.totp-secret { display: block; padding: 12px 14px; border: 1px solid var(--line-blue); border-radius: var(--radius-sm); background: var(--surface-soft); font-size: 15px; letter-spacing: .08em; overflow-wrap: anywhere; user-select: all; }
.totp-note { margin: 0 0 14px; color: var(--text-soft); font-size: 13px; line-height: 1.8; }
.totp-warn { display: block; margin-top: 4px; color: var(--state-warning-700, inherit); }
.totp-recovery { display: grid; gap: 10px; margin: 14px 0; padding: 18px; border: 1px solid var(--line-blue); border-radius: var(--radius-card); background: var(--surface-soft); }
.totp-codes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; margin: 0; padding: 0; list-style: none; }
.totp-codes code { font-size: 15px; letter-spacing: .06em; }
@media (max-width: 520px) { .totp-codes { grid-template-columns: minmax(0, 1fr); } }
</style>
