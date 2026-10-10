<template>
  <div class="admin-system-grid hv">
    <section v-motion="{ kind: 'feature' }" class="admin-panel is-wide" :aria-busy="loading || working">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">人机验证</span>
          <h2>Cloudflare Turnstile</h2>
        </div>
        <span class="badge" :class="badge.tone">{{ badge.label }}</span>
      </div>
      <p v-if="loading && !state" class="admin-page-state" role="status">正在读取…</p>
      <p v-if="error" v-capsule-notice class="form-error" role="alert">{{ error }} <button class="button button--soft" type="button" :disabled="loading" @click="load">重试</button></p>
      <p v-if="state?.testingKeys" class="hv-warn" role="status">当前是 Cloudflare 的测试密钥，所有请求都会通过，上线前请换成正式密钥。</p>

      <template v-if="state">
        <div class="hv-section">
          <h3>密钥</h3>
          <form class="form-grid" @submit.prevent="saveKeys">
            <label class="field">
              <span class="field__label">站点密钥（Site Key）</span>
              <input v-model.trim="siteKey" spellcheck="false" autocomplete="off" maxlength="80" placeholder="0x4AAAAAAA…" :disabled="working" />
            </label>
            <PasswordField v-model="secret" label="私有密钥（Secret Key）" autocomplete="off" :wide="false" :placeholder="state.hasSecret ? '已保存，留空则不修改' : '0x4AAAAAAA…'" :disabled="working" />
            <div class="hv-actions field--wide">
              <button v-press-feedback="'submit'" class="button button--primary" type="submit" :disabled="working || !canSaveKeys">{{ busy === "save" ? "正在保存…" : "保存密钥" }}</button>
              <button class="button button--soft" type="button" :disabled="working || !state.hasSecret || dirty" @click="checkSecret">{{ busy === "check" ? "正在检查…" : "检查私有密钥" }}</button>
              <span v-if="secretCheck" class="hv-inline" :class="secretCheck.valid ? 'is-good' : 'is-bad'" role="status">{{ secretCheck.message }}</span>
            </div>
          </form>
        </div>

        <div class="hv-section">
          <div class="hv-section__head">
            <h3>真实验证</h3>
            <span class="badge" :class="state.verified ? 'badge--mint' : 'badge--gray'">{{ state.verified ? "已通过" : "未验证" }}</span>
          </div>
          <p v-if="!canPreview" class="admin-page-state">{{ dirty ? "密钥有未保存的修改。" : "先保存密钥。" }}</p>
          <template v-else>
            <TurnstileWidget ref="widgetRef" v-model:token="previewToken" class="hv-widget" :site-key="state.siteKey" :action="state.panelAction" />
            <div class="hv-actions">
              <button v-press-feedback="'submit'" class="button button--primary" type="button" :disabled="working || previewToken.length < 10" @click="confirmToken">{{ busy === "verify" ? "正在核对…" : "确认这次验证" }}</button>
              <span v-if="state.verified && state.verifiedAt" class="hv-inline">上次通过 {{ formatTime(state.verifiedAt) }}</span>
              <span v-if="verifyMessage" class="hv-inline is-bad" role="alert">{{ verifyMessage }}</span>
            </div>
          </template>
        </div>

        <div class="hv-section">
          <div class="hv-section__head">
            <h3>启用</h3>
            <label class="hv-switch" :class="{ 'is-locked': !state.verified && !state.enabled }">
              <span>{{ state.enabled ? "已启用" : state.verified ? "未启用" : "需先通过真实验证" }}</span>
              <input type="checkbox" :checked="state.enabled" :disabled="working || (!state.verified && !state.enabled)" aria-label="启用 Turnstile" @change="toggleMaster(($event.target as HTMLInputElement).checked)" />
              <span class="hv-switch__track" aria-hidden="true"></span>
            </label>
          </div>
          <ul class="hv-routes">
            <li v-for="route in routes" :key="route.key">
              <span>{{ route.label }}</span>
              <span class="hv-routes__state" :class="{ 'is-on': usesTurnstile(route.key) }">{{ usesTurnstile(route.key) ? "Turnstile" : "内建验证码" }}</span>
              <label class="hv-switch hv-switch--bare">
                <input type="checkbox" :checked="state.scopes[route.key]" :disabled="working" :aria-label="`${route.label}使用 Turnstile`" @change="toggleScope(route.key, ($event.target as HTMLInputElement).checked)" />
                <span class="hv-switch__track" aria-hidden="true"></span>
              </label>
            </li>
            <li class="is-fixed">
              <span>后台登录</span>
              <span class="hv-routes__state">内建验证码</span>
              <span class="hv-routes__fixed">固定</span>
            </li>
          </ul>
          <p v-if="state.autoDisabled" class="hv-warn" role="status">更换密钥后已自动停用，请重新验证。</p>
        </div>
      </template>
    </section>

    <section v-if="state" v-motion="{ kind: 'compact', delay: 60 }" class="admin-panel is-wide">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">运行情况</span>
          <h2>校验统计</h2>
        </div>
        <span class="hv-inline">自服务启动起累计</span>
      </div>
      <dl class="admin-status-list">
        <div><dt>通过</dt><dd>{{ state.stats.passed }}</dd></div>
        <div><dt>被拒绝</dt><dd>{{ state.stats.rejected }}</dd></div>
        <div><dt>Cloudflare 无法访问</dt><dd>{{ state.stats.unavailable }}</dd></div>
        <div><dt>最近一次问题</dt><dd>{{ state.stats.lastError || "—" }}</dd></div>
      </dl>
      <div class="hv-actions">
        <button class="button button--danger" type="button" :disabled="working || (!state.siteKey && !state.hasSecret)" @click="clearAll">{{ busy === "clear" ? "正在清除…" : "清除配置并恢复内建验证码" }}</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApiError, toast } from "../../api";
import {
  checkTurnstileSecret, clearHumanVerification, loadHumanVerification, saveHumanVerification, verifyTurnstileToken,
  type HumanPurpose, type HumanVerificationState,
} from "../../api/humanVerification";
import PasswordField from "../../components/PasswordField.vue";
import TurnstileWidget from "../../components/TurnstileWidget.vue";
import { confirmDialog } from "../../dialog";

const state = ref<HumanVerificationState | null>(null);
const loading = ref(false);
const busy = ref<"" | "save" | "check" | "verify" | "toggle" | "clear">("");
const working = computed(() => busy.value !== "");
const error = ref("");
const siteKey = ref("");
const secret = ref("");
const previewToken = ref("");
const verifyMessage = ref("");
const secretCheck = ref<{ valid: boolean; message: string } | null>(null);
const widgetRef = ref<InstanceType<typeof TurnstileWidget> | null>(null);

const routes: { key: HumanPurpose; label: string }[] = [
  { key: "login", label: "邮箱登录" },
  { key: "register", label: "注册新邮箱" },
  { key: "password-reset", label: "申请重置密码" },
];

const dirty = computed(() => Boolean(state.value) && (siteKey.value !== state.value!.siteKey || secret.value !== ""));
const canSaveKeys = computed(() => dirty.value && /^[0-9A-Za-z_-]{8,80}$/.test(siteKey.value) && (secret.value !== "" || Boolean(state.value?.hasSecret)));
const canPreview = computed(() => Boolean(state.value?.siteKey && state.value.hasSecret) && !dirty.value);

const badge = computed(() => {
  const s = state.value;
  if (!s) return { label: "未读取", tone: "badge--gray" };
  if (s.enabled && s.verified) return { label: "已启用", tone: "badge--mint" };
  if (s.verified) return { label: "已验证，未启用", tone: "badge--blue" };
  if (s.siteKey && s.hasSecret) return { label: "待验证", tone: "badge--yellow" };
  return { label: "未配置", tone: "badge--gray" };
});

const usesTurnstile = (key: HumanPurpose): boolean => Boolean(state.value?.active.includes(key));
const message = (reason: unknown, fallback: string): string => reason instanceof ApiError ? reason.message : fallback;
const formatTime = (value: string): string => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }); };

function adopt(next: HumanVerificationState): void {
  state.value = next;
  siteKey.value = next.siteKey;
  secret.value = "";
}

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try { adopt(await loadHumanVerification()); }
  catch (reason) { error.value = `人机验证设置读取失败：${message(reason, "请稍后重试")}`; }
  finally { loading.value = false; }
}

async function run<T>(kind: typeof busy.value, task: () => Promise<T>, failure: string): Promise<T | undefined> {
  if (busy.value) return undefined;
  busy.value = kind;
  error.value = "";
  try { return await task(); }
  catch (reason) { error.value = message(reason, failure); return undefined; }
  finally { busy.value = ""; }
}

async function saveKeys(): Promise<void> {
  if (!canSaveKeys.value) return;
  const body: { siteKey: string; secret?: string } = { siteKey: siteKey.value };
  if (secret.value) body.secret = secret.value;
  const next = await run("save", () => saveHumanVerification(body), "保存失败，请稍后重试");
  if (!next) return;
  adopt(next);
  secretCheck.value = null; verifyMessage.value = "";
  toast(next.autoDisabled ? "密钥已保存；原先的启用状态已自动停用，请重新验证" : "密钥已保存，请继续做真实验证");
}

async function checkSecret(): Promise<void> {
  const result = await run("check", () => checkTurnstileSecret(), "检查失败，请稍后重试");
  if (result) secretCheck.value = result;
}

async function confirmToken(): Promise<void> {
  verifyMessage.value = "";
  const next = await run("verify", () => verifyTurnstileToken(previewToken.value), "核对失败，请稍后重试");
  if (next) { adopt(next); toast("真实验证通过，现在可以启用了"); }
  else verifyMessage.value = error.value;
  // 结果令牌只能用一次，无论成败都换新的。
  previewToken.value = "";
  widgetRef.value?.reset();
}

async function toggleMaster(enabled: boolean): Promise<void> {
  if (enabled && !(await confirmDialog({
    title: "启用 Turnstile",
    message: "启用后，打开了的邮箱入口会改用 Cloudflare 人机验证；后台登录不受影响。如果用户遇到问题，可以随时回到这里停用。",
    confirmLabel: "启用",
  }))) { state.value = state.value ? { ...state.value } : state.value; return; }
  const next = await run("toggle", () => saveHumanVerification({ enabled }), "操作失败，请稍后重试");
  if (next) { adopt(next); toast(enabled ? "Turnstile 已启用" : "已停用，邮箱入口恢复内建验证码"); }
  else if (state.value) state.value = { ...state.value };
}

async function toggleScope(key: HumanPurpose, value: boolean): Promise<void> {
  const next = await run("toggle", () => saveHumanVerification({ scopes: { [key]: value } }), "操作失败，请稍后重试");
  if (next) adopt(next);
  else if (state.value) state.value = { ...state.value };
}

async function clearAll(): Promise<void> {
  if (!(await confirmDialog({
    title: "清除人机验证配置",
    message: "将删除已保存的站点密钥和私有密钥，邮箱入口恢复使用内建验证码。之后要再用 Turnstile，需要重新填写并验证。",
    confirmLabel: "清除",
    tone: "danger",
  }))) return;
  const next = await run("clear", () => clearHumanVerification(), "清除失败，请稍后重试");
  if (next) { adopt(next); secretCheck.value = null; verifyMessage.value = ""; toast("已清除，邮箱入口使用内建验证码"); }
}

onMounted(() => { void load(); });
</script>

<style scoped>
.hv h3 { margin: 0; font-size: 14px; font-weight: 600; }
.hv-section { margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--line-blue); }
.hv-section__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.hv-section > h3 { margin-bottom: 14px; }
.hv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 4px; }
.hv-section > .hv-widget + .hv-actions { margin-top: 14px; }
.hv-inline { color: var(--text-soft); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.hv-inline.is-good { color: #2c7a5a; }
.hv-inline.is-bad { color: var(--danger-700, #a24c4c); }
.hv-warn { margin: 0 0 4px; color: #8a6a24; font-size: 13px; line-height: 1.7; }
.hv-widget { max-width: 420px; }
.hv-switch { position: relative; display: inline-flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text-soft); font-size: 13px; }
.hv-switch.is-locked { cursor: not-allowed; opacity: .6; }
/* 全局样式会覆盖原生复选框，必须 !important 才能真正藏起来（安全设置卡同理）。 */
.hv-switch > input { position: absolute !important; width: 1px !important; height: 1px !important; margin: 0 !important; padding: 0 !important; opacity: 0 !important; pointer-events: none !important; }
.hv-switch__track { position: relative; flex: 0 0 auto; width: 44px; height: 26px; border: 1px solid var(--line-blue); border-radius: 999px; background: #e9eff4; transition: background 180ms var(--ease, ease), border-color 180ms var(--ease, ease); }
.hv-switch__track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(72, 105, 131, .25); transition: transform 220ms var(--spring, ease); }
.hv-switch > input:checked + .hv-switch__track { border-color: #8fc2e1; background: #a8d0f4; }
.hv-switch > input:checked + .hv-switch__track::after { transform: translateX(18px); }
.hv-switch > input:focus-visible + .hv-switch__track { outline: 3px solid rgba(143, 198, 232, .4); outline-offset: 2px; }
.hv-switch > input:disabled + .hv-switch__track { opacity: .6; }
.hv-routes { margin: 0; padding: 0; list-style: none; }
.hv-routes li { display: grid; grid-template-columns: minmax(0, 1fr) auto 44px; align-items: center; gap: 16px; min-height: 48px; border-top: 1px solid var(--line-blue); font-size: 14px; }
.hv-routes li:first-child { border-top: 0; }
.hv-routes__state { color: var(--text-soft); font-size: 12px; text-align: right; }
.hv-routes__state.is-on { color: #2c7a5a; font-weight: 600; }
.hv-routes__fixed { color: var(--text-soft); font-size: 12px; text-align: center; }
.hv-routes li.is-fixed > span:first-child { color: var(--text-soft); }
.hv .admin-status-list { margin-bottom: 16px; }
@media (max-width: 700px) {
  .hv-routes li { grid-template-columns: minmax(0, 1fr) 44px; }
  .hv-routes li > .hv-routes__state { grid-column: 1; grid-row: 2; text-align: left; margin-top: -10px; padding-bottom: 8px; }
  .hv-routes li > .hv-switch, .hv-routes li > .hv-routes__fixed { grid-column: 2; grid-row: 1 / span 2; }
  .hv-actions .button { flex: 1 1 auto; }
}
@media (prefers-reduced-motion: reduce) { .hv-switch__track, .hv-switch__track::after { transition: none; } }
</style>
