<template>
  <div class="admin-system-grid hv-grid">
    <section v-motion="{ kind: 'feature' }" class="admin-panel is-wide hv-hero" :aria-busy="loading || working">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">HUMAN CHECK</span>
          <h2>人机验证</h2>
          <p>用 Cloudflare Turnstile 保护邮箱用户的登录、注册和重置密码，减少脚本批量尝试。</p>
        </div>
        <span class="badge" :class="badge.tone">{{ badge.label }}</span>
      </div>
      <p v-if="loading && !state" class="admin-page-state" role="status">正在读取人机验证设置…</p>
      <p v-if="error" v-capsule-notice class="form-error" role="alert">{{ error }} <button class="button button--soft" type="button" :disabled="loading" @click="load">重试</button></p>
      <template v-if="state">
        <ol class="hv-steps" aria-label="设置进度">
          <li v-for="(step, index) in steps" :key="step.title" :class="step.status">
            <span class="hv-steps__node" aria-hidden="true">
              <svg v-if="step.status === 'is-done'" viewBox="0 0 16 16"><path d="m3.5 8.4 3 3 6-6.6" /></svg>
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span><strong>{{ step.title }}</strong><small>{{ step.hint }}</small></span>
          </li>
        </ol>
        <p class="hv-lock">
          <span class="hv-lock__mark" aria-hidden="true">✓</span>
          <span><strong>后台登录始终使用内建验证码</strong>，不依赖 Cloudflare。这里的设置即使填错，也不会让管理员进不了后台；邮箱用户被挡住时，来这里停用即可立刻恢复。</span>
        </p>
        <p v-if="state.testingKeys" class="hv-warn" role="status">当前使用的是 Cloudflare 的测试密钥：任何人和脚本都会通过验证，只适合试流程。上线前请换成正式密钥。</p>
      </template>
    </section>

    <section v-if="state" v-motion="{ kind: 'compact', delay: 40 }" class="admin-panel hv-keys">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">第 1 步</span>
          <h2>填写密钥</h2>
          <p>在 Cloudflare 的 Turnstile 页面添加站点，域名填 <code>{{ host }}</code>，把两个密钥复制到这里。</p>
        </div>
        <span class="badge" :class="state.hasSecret && state.siteKey ? 'badge--blue' : 'badge--gray'">{{ state.hasSecret && state.siteKey ? "已保存" : "未保存" }}</span>
      </div>
      <form class="form-grid" @submit.prevent="saveKeys">
        <label class="field field--wide">
          <span class="field__label">站点密钥（Site Key）</span>
          <input v-model.trim="siteKey" spellcheck="false" autocomplete="off" maxlength="80" placeholder="0x4AAAAAAA…" :disabled="working" />
        </label>
        <PasswordField v-model="secret" label="私有密钥（Secret Key）" autocomplete="off" :placeholder="state.hasSecret ? '已保存，留空表示不修改' : '0x4AAAAAAA…'" :disabled="working" />
        <p class="hv-note field--wide">私有密钥保存后会加密存放，页面和接口都不会再显示它。更换任何一个密钥，都需要重新完成第 2 步的验证。</p>
        <div class="button-row field--wide">
          <button v-press-feedback="'submit'" class="button button--primary" type="submit" :disabled="working || !canSaveKeys">{{ busy === 'save' ? "正在保存…" : "保存密钥" }}</button>
          <button class="button button--soft" type="button" :disabled="working || !state.hasSecret || dirty" @click="checkSecret">检查私有密钥</button>
        </div>
      </form>
      <p v-if="secretCheck" class="hv-result" :class="secretCheck.valid ? 'is-good' : 'is-bad'" role="status">{{ secretCheck.message }}</p>
    </section>

    <section v-if="state" v-motion="{ kind: 'compact', delay: 80 }" class="admin-panel hv-verify">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">第 2 步</span>
          <h2>做一次真实验证</h2>
          <p>下面是真正的验证组件。完成后点“用这次结果确认”，服务器会向 Cloudflare 核对，通过才允许启用。</p>
        </div>
        <span class="badge" :class="state.verified ? 'badge--mint' : 'badge--gray'">{{ state.verified ? "已通过" : "未验证" }}</span>
      </div>
      <p v-if="!canPreview" class="admin-page-state">{{ dirty ? "密钥有未保存的修改，请先保存。" : "先在左侧保存站点密钥和私有密钥。" }}</p>
      <template v-else>
        <TurnstileWidget ref="widgetRef" v-model:token="previewToken" :site-key="state.siteKey" :action="state.panelAction" />
        <div class="button-row">
          <button v-press-feedback="'submit'" class="button button--primary" type="button" :disabled="working || previewToken.length < 10" @click="confirmToken">{{ busy === 'verify' ? "正在核对…" : "用这次结果确认" }}</button>
          <span v-if="state.verified && state.verifiedAt" class="hv-note">上次通过：{{ formatTime(state.verifiedAt) }}</span>
        </div>
        <p v-if="verifyMessage" class="hv-result is-bad" role="alert">{{ verifyMessage }}</p>
      </template>
    </section>

    <section v-if="state" v-motion="{ kind: 'compact', delay: 120 }" class="admin-panel is-wide hv-entries">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">第 3 步</span>
          <h2>启用和适用入口</h2>
          <p>启用后，下面打开的入口会用 Turnstile 代替图片验证码。每个入口可以单独开关。</p>
        </div>
        <label class="hv-master" :class="{ 'is-on': state.enabled, 'is-locked': !state.verified && !state.enabled }">
          <input type="checkbox" :checked="state.enabled" :disabled="working || (!state.verified && !state.enabled)" @change="toggleMaster(($event.target as HTMLInputElement).checked)" />
          <span class="hv-master__switch" aria-hidden="true"></span>
          <span>{{ state.enabled ? "已启用" : "启用 Turnstile" }}</span>
        </label>
      </div>
      <p v-if="!state.verified && !state.enabled" class="hv-note">完成第 2 步后才能启用。</p>
      <ul class="hv-routes">
        <li v-for="route in routes" :key="route.key" :class="{ 'is-using': usesTurnstile(route.key) }">
          <label class="hv-route__switch">
            <input type="checkbox" :checked="state.scopes[route.key]" :disabled="working" :aria-label="`${route.label}使用 Turnstile`" @change="toggleScope(route.key, ($event.target as HTMLInputElement).checked)" />
            <span class="hv-route__track" aria-hidden="true"></span>
          </label>
          <span class="hv-route__text"><strong>{{ route.label }}</strong><small>{{ route.hint }}</small></span>
          <span class="badge" :class="usesTurnstile(route.key) ? 'badge--mint' : 'badge--gray'">{{ usesTurnstile(route.key) ? "Turnstile" : "内建验证码" }}</span>
        </li>
        <li class="is-fixed">
          <span class="hv-route__lock" aria-hidden="true">🔒</span>
          <span class="hv-route__text"><strong>后台登录</strong><small>固定使用内建验证码，不能改成 Turnstile</small></span>
          <span class="badge badge--gray">内建验证码</span>
        </li>
      </ul>
      <p v-if="state.autoDisabled" class="hv-warn" role="status">更换密钥后已自动停用。请重新完成验证再启用。</p>
    </section>

    <section v-if="state" v-motion="{ kind: 'compact', delay: 160 }" class="admin-panel hv-stats">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">运行情况</span>
          <h2>最近的校验结果</h2>
          <p>从服务上次启动起累计，重启后清零。</p>
        </div>
      </div>
      <dl class="admin-status-list">
        <div><dt>通过</dt><dd>{{ state.stats.passed }}</dd></div>
        <div><dt>被拒绝</dt><dd>{{ state.stats.rejected }}</dd></div>
        <div><dt>Cloudflare 无法访问</dt><dd>{{ state.stats.unavailable }}</dd></div>
        <div><dt>最近一次问题</dt><dd>{{ state.stats.lastError || "—" }}</dd></div>
      </dl>
      <p class="hv-note">“无法访问”不是用户的错，也不会计入登录失败。如果持续出现，请检查服务器能否访问 challenges.cloudflare.com，或先停用。</p>
    </section>

    <section v-if="state" v-motion="{ kind: 'compact', delay: 200 }" class="admin-panel hv-danger">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">恢复</span>
          <h2>清除配置</h2>
          <p>删除已保存的密钥并恢复内建验证码，邮箱入口立即生效。</p>
        </div>
      </div>
      <button class="button button--danger" type="button" :disabled="working || (!state.siteKey && !state.hasSecret)" @click="clearAll">{{ busy === 'clear' ? "正在清除…" : "清除并恢复内建验证码" }}</button>
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
const host = typeof location === "undefined" ? "" : location.hostname;

const routes: { key: HumanPurpose; label: string; hint: string }[] = [
  { key: "login", label: "邮箱登录", hint: "连续输错几次后才会出现验证" },
  { key: "register", label: "注册新邮箱", hint: "每次申请都需要验证" },
  { key: "password-reset", label: "申请重置密码", hint: "每次申请都需要验证" },
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

const steps = computed(() => {
  const s = state.value!;
  const saved = Boolean(s.siteKey && s.hasSecret);
  const rows = [
    { title: "填写密钥", hint: "站点密钥和私有密钥", done: saved },
    { title: "真实验证", hint: "确认密钥和域名都正确", done: s.verified },
    { title: "启用", hint: "邮箱入口开始使用", done: s.enabled && s.verified },
  ];
  const firstOpen = rows.findIndex((row) => !row.done);
  return rows.map((row, index) => ({ ...row, status: row.done ? "is-done" : index === firstOpen ? "is-current" : "is-todo" }));
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
.hv-grid .hv-hero { display: grid; gap: 16px; }
.hv-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 0; padding: 0; list-style: none; counter-reset: none; }
.hv-steps li { position: relative; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 4px 12px 4px 0; }
.hv-steps li:not(:last-child)::after { content: ""; position: absolute; left: 44px; right: 8px; top: 50%; height: 2px; border-radius: 2px; background: #e1ecf4; transform-origin: left; }
.hv-steps li.is-done:not(:last-child)::after { background: linear-gradient(90deg, #a9d7f0, #c5e7f8); animation: hv-line 420ms var(--ease, ease) both; }
.hv-steps li > span:last-child { position: relative; z-index: 1; display: grid; min-width: 0; padding-right: 8px; background: transparent; }
.hv-steps strong { font-size: 14px; }
.hv-steps small { color: var(--text-soft); font-size: 11px; line-height: 1.5; }
.hv-steps__node { position: relative; z-index: 1; display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 30px; border: 1px solid #c9deec; border-radius: 50%; background: #fff; color: var(--text-soft); font-size: 13px; font-weight: 700; transition: background 220ms var(--ease, ease), border-color 220ms var(--ease, ease), box-shadow 260ms var(--ease, ease), transform 260ms var(--spring, ease); }
.hv-steps .is-current .hv-steps__node { border-color: #8fc2e1; color: #3f7ea6; box-shadow: 0 0 0 5px rgba(175, 218, 244, .2); }
.hv-steps .is-done .hv-steps__node { border-color: #a6d9c3; background: #e6f6ee; }
.hv-steps .is-todo { opacity: .7; }
.hv-steps__node svg { width: 16px; height: 16px; fill: none; stroke: #2f8f67; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.hv-steps__node svg path { stroke-dasharray: 16; stroke-dashoffset: 16; animation: hv-check 320ms 60ms var(--ease, ease) forwards; }
.hv-lock { display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 12px 14px; border: 1px solid #cfe4f1; border-radius: 16px; background: linear-gradient(145deg, #fff, #f1f9ff); color: var(--text-soft); font-size: 13px; line-height: 1.75; }
.hv-lock strong { color: var(--text); }
.hv-lock__mark { display: grid; place-items: center; flex: 0 0 22px; width: 22px; height: 22px; margin-top: 2px; border-radius: 50%; background: #d9eefa; color: #3f7ea6; font-size: 12px; font-weight: 700; }
.hv-warn { margin: 0; padding: 10px 14px; border: 1px solid #f0dcae; border-radius: 14px; background: #fffaf0; color: #8a6a24; font-size: 13px; line-height: 1.7; }
.hv-note { margin: 0; color: var(--text-soft); font-size: 12px; line-height: 1.8; }
.hv-result { margin: 12px 0 0; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; animation: hv-arrive 240ms var(--ease, ease) both; }
.hv-result.is-good { border: 1px solid #bfe3d1; background: #f0faf5; color: #2c7a5a; }
.hv-result.is-bad { border: 1px solid #efc9c9; background: #fff6f6; color: #a24c4c; }
.hv-keys code, .hv-hero code { padding: 1px 6px; border-radius: var(--radius-sm, 8px); background: var(--surface-soft, #f4f8fb); }
.hv-verify { display: grid; align-content: start; gap: 14px; }
.hv-verify .panel-heading { margin-bottom: 4px; }
.hv-master { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 600; white-space: nowrap; }
.hv-master.is-locked { cursor: not-allowed; opacity: .55; }
.hv-master > input, .hv-route__switch > input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.hv-master__switch, .hv-route__track { position: relative; display: block; width: 46px; height: 27px; border: 1px solid #c7dce9; border-radius: 999px; background: #edf3f7; box-shadow: inset 0 2px 5px rgba(82, 112, 136, .09); transition: border-color 180ms var(--ease, ease), background 190ms var(--ease, ease), box-shadow 190ms var(--ease, ease); }
.hv-master__switch::after, .hv-route__track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 19px; height: 19px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(72, 105, 131, .18); transition: transform 230ms var(--spring, ease); }
.hv-master > input:checked + .hv-master__switch, .hv-route__switch > input:checked + .hv-route__track { border-color: #9bc9e5; background: linear-gradient(90deg, #a9d7f0, #c5e7f8); box-shadow: inset 0 1px 4px rgba(80, 137, 174, .1), 0 0 0 4px rgba(175, 218, 244, .13); }
.hv-master > input:checked + .hv-master__switch::after, .hv-route__switch > input:checked + .hv-route__track::after { transform: translateX(19px); }
.hv-master > input:focus-visible + .hv-master__switch, .hv-route__switch > input:focus-visible + .hv-route__track { outline: 3px solid rgba(143, 198, 232, .35); outline-offset: 3px; }
.hv-master > input:disabled + .hv-master__switch, .hv-route__switch > input:disabled + .hv-route__track { opacity: .6; }
.hv-routes { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.hv-routes li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid #dfe9f1; border-radius: 18px; background: linear-gradient(145deg, #fff, #f6fbff); transition: border-color 200ms var(--ease, ease), background 200ms var(--ease, ease), box-shadow 220ms var(--ease, ease); }
.hv-routes li.is-using { border-color: #b9e0cf; background: linear-gradient(145deg, #fff, #f2fbf7); }
.hv-routes li.is-fixed { border-style: dashed; background: #fafcfd; }
.hv-route__text { display: grid; gap: 2px; min-width: 0; }
.hv-route__text small { color: var(--text-soft); font-size: 12px; line-height: 1.6; }
.hv-route__switch { position: relative; display: block; cursor: pointer; }
.hv-route__lock { display: grid; place-items: center; width: 46px; font-size: 16px; }
.hv-stats dl { margin-bottom: 12px; }
@keyframes hv-line { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes hv-check { to { stroke-dashoffset: 0; } }
@keyframes hv-arrive { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (max-width: 700px) {
  .hv-steps { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .hv-steps li:not(:last-child)::after { display: none; }
  .hv-routes li { grid-template-columns: auto minmax(0, 1fr); }
  .hv-routes li > .badge { grid-column: 2; justify-self: start; }
  .hv-master { white-space: normal; }
}
@media (prefers-reduced-motion: reduce) {
  .hv-steps li.is-done:not(:last-child)::after, .hv-steps__node svg path, .hv-result { animation: none; }
  .hv-steps__node svg path { stroke-dashoffset: 0; }
  .hv-master__switch, .hv-master__switch::after, .hv-route__track, .hv-route__track::after, .hv-routes li, .hv-steps__node { transition: none; }
}
:global(html[data-motion="reduce"]) .hv-steps li.is-done:not(:last-child)::after, :global(html[data-motion="reduce"]) .hv-steps__node svg path, :global(html[data-motion="reduce"]) .hv-result { animation: none; }
:global(html[data-motion="reduce"]) .hv-steps__node svg path { stroke-dashoffset: 0; }
</style>
