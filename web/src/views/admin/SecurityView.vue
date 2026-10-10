<template>
  <div>
    <section v-motion="{ kind: 'feature' }" class="managed-page-card">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">SECURITY POLICY</span>
          <h2>登录与注册策略</h2>
          <p>只读角色可以查看当前策略，但不会看到修改和封禁入口。</p>
        </div>
        <button v-if="canWrite" class="button button--primary" type="submit" form="security-policy-form" :disabled="saving || !panels.policy.loaded || panels.policy.loading || Boolean(panels.policy.error)">
          {{ saving ? "保存中…" : "保存策略" }}
        </button>
      </div>
      <p v-if="!panels.policy.loaded && panels.policy.loading" class="admin-page-state" role="status">正在读取安全策略…</p>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await readPolicy(); } } }" v-if="panels.policy.error" class="mail-notice" role="alert">策略读取失败：{{ panels.policy.error }}{{ panels.policy.loaded ? "；当前表单值尚未复核，已暂停编辑。" : "；真实设置未读取前禁止保存。" }} <button class="button button--soft" type="button" :disabled="panels.policy.loading || saving" @click="readPolicy">重试读取</button></p>
      <p v-capsule-notice v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
      <form v-if="panels.policy.loaded" id="security-policy-form" class="form-grid" @submit.prevent="save">
        <div class="admin-form-grid">
          <label class="field">
            <span class="field__label">邮箱登录 · 失败上限</span>
            <input v-theme-control v-model.number="form.loginMaxFailures" type="number" min="3" max="20" required :disabled="!canWrite || saving || panels.policy.loading || Boolean(panels.policy.error)" />
          </label>
          <label class="field">
            <span class="field__label">邮箱登录 · 冷却分钟</span>
            <input v-theme-control v-model.number="form.loginLockMinutes" type="number" min="1" max="180" required :disabled="!canWrite || saving || panels.policy.loading || Boolean(panels.policy.error)" />
          </label>
          <label class="field">
            <span class="field__label">管理员登录 · 失败上限</span>
            <input v-theme-control v-model.number="form.adminLoginMaxFailures" type="number" min="3" max="20" required :disabled="!canWrite || saving || panels.policy.loading || Boolean(panels.policy.error)" />
          </label>
          <label class="field">
            <span class="field__label">管理员登录 · 冷却分钟</span>
            <input v-theme-control v-model.number="form.adminLoginLockMinutes" type="number" min="1" max="180" required :disabled="!canWrite || saving || panels.policy.loading || Boolean(panels.policy.error)" />
          </label>
          <label class="field">
            <span class="field__label">每小时注册上限</span>
            <input v-theme-control v-model.number="form.registerMaxPerHour" type="number" min="1" max="100" required :disabled="!canWrite || saving || panels.policy.loading || Boolean(panels.policy.error)" />
          </label>
          <label class="field">
            <span class="field__label">每 24 小时注册上限</span>
            <input v-theme-control v-model.number="form.registerMaxPerDay" type="number" min="1" max="1000" required :disabled="!canWrite || saving || panels.policy.loading || Boolean(panels.policy.error)" />
          </label>
          <label class="field">
            <span class="field__label">全局告警阈值</span>
            <input v-theme-control v-model.number="form.globalFailureAlert" type="number" min="5" max="10000" required :disabled="!canWrite || saving || panels.policy.loading || Boolean(panels.policy.error)" />
          </label>
          <label class="field">
            <span class="field__label">注册模式</span>
            <select v-theme-control v-model="form.registrationMode" :disabled="!canWrite || saving || panels.policy.loading || Boolean(panels.policy.error)">
              <option value="invite">仅邀请码</option>
              <option value="closed">完全关闭</option>
            </select>
          </label>
        </div>
      </form>
      <p class="mail-notice">
        管理员每次登录都要填验证码；邮箱登录在失败较多时才要求验证码。冷却只针对来源，不会永久锁定账号，填了验证码也不能提前结束冷却。
      </p>
    </section>

    <section v-motion="{ kind: 'compact', delay: 60 }" class="managed-page-card">
      <div class="panel-heading">
        <div><h2>最近登录记录</h2><p>全站最近一小时注册尝试 {{ panels.policy.loaded ? `${recentRegisterAttempts} 次` : "未读取" }}，最近 24 小时 {{ panels.policy.loaded ? `${recentDailyRegisterAttempts} 次` : "未读取" }}；限额按每个来源计算，包含成功和失败请求。</p></div>
        <label class="field admin-inline-filter"><span class="field__label">类型</span><select v-theme-control v-model="loginScope"><option value="all">全部</option><option value="mail-login">邮箱登录</option><option value="admin-login">后台登录</option><option value="register">注册</option></select></label>
      </div>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await readLogins(); } } }" v-if="panels.logins.error" class="mail-notice" role="alert">登录记录读取失败：{{ panels.logins.error }}{{ panels.logins.loaded ? "；下方为上次数据。" : "" }} <button class="button button--soft" type="button" :disabled="panels.logins.loading" @click="readLogins">重试读取</button></p>
      <p v-if="!panels.logins.loaded && panels.logins.loading" class="admin-page-state" role="status">正在读取登录记录…</p>
      <div v-if="panels.logins.loaded" class="table-scroll"><table class="admin-table">
        <thead><tr><th>时间</th><th>类型</th><th>账号</th><th>匿名来源指纹</th><th>结果</th><th>原因</th><th></th></tr></thead>
        <tbody>
          <tr v-for="row in filteredLogins" :key="row.id">
            <td>{{ new Date(row.created_at).toLocaleString("zh-CN") }}</td>
            <td>{{ row.scope }}</td>
            <td>{{ row.account || "—" }}</td>
            <td><code>{{ row.identity_hash }}</code></td>
            <td>{{ row.success ? "成功" : "失败" }}</td>
            <td>{{ row.reason }}</td>
            <td>
              <button v-if="canWrite && !row.success && panels.blocked.loaded && !panels.blocked.error && !blockedHashes.has(row.identity_hash)" class="button button--soft" type="button" :disabled="Boolean(actionBusy)" @click="block(row.identity_hash)">
                {{ actionBusy === `block:${row.identity_hash}` ? "封禁中…" : "封禁来源" }}
              </button>
              <span v-else-if="!row.success && blockedHashes.has(row.identity_hash)">已封禁</span>
              <span v-else-if="canWrite && !row.success && (!panels.blocked.loaded || panels.blocked.error)">封禁状态未读取</span>
            </td>
          </tr>
        </tbody>
      </table></div>
      <p v-if="panels.logins.loaded && !panels.logins.error && filteredLogins.length === 0" class="mail-empty">当前筛选没有登录记录</p>
    </section>

    <section v-motion="{ kind: 'compact', delay: 80 }" class="managed-page-card">
      <div class="panel-heading"><div><h2>来源封禁与冷却</h2><p>包括手动封禁和自动冷却。页面只显示来源的指纹，不显示真实 IP。解除封禁会记入操作日志，但不会重置请求次数限制。</p></div><button class="button button--soft" type="button" :disabled="panels.blocked.loading || Boolean(actionBusy)" @click="readBlocked">{{ panels.blocked.loading ? "读取中…" : "刷新" }}</button></div>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await readBlocked(); } } }" v-if="panels.blocked.error" class="mail-notice" role="alert">封禁列表读取失败：{{ panels.blocked.error }}{{ panels.blocked.loaded ? "；下方保留上次数据。" : "" }} <button class="button button--soft" type="button" :disabled="panels.blocked.loading" @click="readBlocked">重试读取</button></p>
      <p v-if="!panels.blocked.loaded && panels.blocked.loading" class="admin-page-state" role="status">正在读取封禁来源…</p>
      <div v-if="panels.blocked.loaded && blocked.length" class="table-scroll"><table class="admin-table">
        <thead><tr><th>指纹</th><th>类型</th><th>原因</th><th>操作者</th><th>封禁时间</th><th></th></tr></thead>
        <tbody>
          <tr v-for="row in blocked" :key="row.identity_hash">
            <td><code>{{ row.identity_hash }}</code></td>
            <td>{{ row.scope || "未知" }}</td>
            <td>{{ row.reason || "—" }}</td>
            <td>{{ row.created_by || "—" }}</td>
            <td>{{ row.provisional ? "刚刚封禁，待刷新" : new Date(row.created_at).toLocaleString("zh-CN") }}</td>
            <td><button v-if="canWrite" class="button button--soft" type="button" :disabled="Boolean(actionBusy)" @click="unblock(row.identity_hash)">{{ actionBusy === `unblock:${row.identity_hash}` ? "解封中…" : "解封" }}</button></td>
          </tr>
        </tbody>
      </table></div>
      <p v-if="panels.blocked.loaded && !panels.blocked.error && blocked.length === 0" class="mail-empty">当前没有封禁或冷却来源</p>
    </section>

    <section v-motion="{ kind: 'compact', delay: 100 }" class="managed-page-card">
      <div class="panel-heading"><div><h2>操作日志</h2><p>审计记录只读，不提供修改或删除。</p></div><label class="field admin-inline-filter"><span class="field__label">筛选</span><input v-model="auditQuery" type="search" placeholder="操作、对象或摘要" /></label></div>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await readAudits(); } } }" v-if="panels.audits.error" class="mail-notice" role="alert">操作日志读取失败：{{ panels.audits.error }}{{ panels.audits.loaded ? "；下方为上次数据。" : "" }} <button class="button button--soft" type="button" :disabled="panels.audits.loading" @click="readAudits">重试读取</button></p>
      <p v-if="!panels.audits.loaded && panels.audits.loading" class="admin-page-state" role="status">正在读取操作日志…</p>
      <div v-if="panels.audits.loaded" class="table-scroll"><table class="admin-table">
        <thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>摘要</th><th>请求 ID</th></tr></thead>
        <tbody>
          <tr v-for="row in filteredAudits" :key="row.id">
            <td>{{ new Date(row.created_at).toLocaleString("zh-CN") }}</td>
            <td>{{ row.actor }}</td>
            <td>{{ row.action }}</td>
            <td>{{ row.target_id || "—" }}</td>
            <td>{{ row.summary }}</td>
            <td><code>{{ row.request_id || "—" }}</code></td>
          </tr>
        </tbody>
      </table></div>
      <p v-if="panels.audits.loaded && !panels.audits.error && filteredAudits.length === 0" class="mail-empty">当前筛选没有操作日志</p>
    </section>

    <section v-motion="{ kind: 'compact', delay: 140 }" class="managed-page-card">
      <h2>在线后台会话</h2>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await readSessions(); } } }" v-if="panels.sessions.error" class="mail-notice" role="alert">在线会话读取失败：{{ panels.sessions.error }}{{ panels.sessions.loaded ? "；下方保留上次数据。" : "" }} <button class="button button--soft" type="button" :disabled="panels.sessions.loading" @click="readSessions">重试读取</button></p>
      <p v-if="!panels.sessions.loaded && panels.sessions.loading" class="admin-page-state" role="status">正在读取在线会话…</p>
      <div v-if="panels.sessions.loaded && sessions.length" class="table-scroll"><table class="admin-table">
        <thead><tr><th>管理员</th><th>客户端</th><th>建立时间</th><th>最近活动</th><th>到期</th><th></th></tr></thead>
        <tbody>
          <tr v-for="row in sessions" :key="row.id">
            <td>{{ row.username }}</td>
            <td>{{ row.user_agent || "—" }}</td>
            <td>{{ new Date(row.created_at).toLocaleString("zh-CN") }}</td>
            <td>{{ new Date(row.last_active_at).toLocaleString("zh-CN") }}</td>
            <td>{{ new Date(row.expires_at).toLocaleString("zh-CN") }}</td>
            <td>
              <button v-if="canWrite" class="button button--soft" type="button" :disabled="Boolean(actionBusy)" @click="revoke(row.id)">{{ actionBusy === `revoke:${row.id}` ? "下线中…" : "强制下线" }}</button>
            </td>
          </tr>
        </tbody>
      </table></div>
      <p v-if="panels.sessions.loaded && !panels.sessions.error && sessions.length === 0" class="mail-empty">当前没有在线后台会话</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ApiError, api, toast } from "../../api";
import { confirmDialog } from "../../dialog";
import { useAdminSessionStore } from "../../stores/adminSession";

type LoginRow = {
  id: number;
  scope: string;
  identity_hash: string;
  account: string;
  success: number;
  reason: string;
  created_at: string;
};
type AuditRow = {
  id: number;
  actor: string;
  action: string;
  target_id: string;
  summary: string;
  request_id: string;
  created_at: string;
};
type SessionRow = {
  id: string;
  username: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
};
type BlockedRow = {
  identity_hash: string;
  scope: string;
  reason: string;
  created_by: string;
  created_at: string;
  provisional?: boolean;
};
type Policy = {
  loginMaxFailures: number;
  loginLockMinutes: number;
  adminLoginMaxFailures: number;
  adminLoginLockMinutes: number;
  registerMaxPerHour: number;
  registerMaxPerDay: number;
  globalFailureAlert: number;
  registrationMode: string;
  recentRegisterAttempts?: number;
  recentDailyRegisterAttempts?: number;
};
type PanelKey = "policy" | "logins" | "audits" | "sessions" | "blocked";
type PanelState = { loaded: boolean; loading: boolean; error: string };
const newPanel = (): PanelState => ({ loaded: false, loading: false, error: "" });

const form = reactive({
  loginMaxFailures: 5,
  loginLockMinutes: 15,
  adminLoginMaxFailures: 3,
  adminLoginLockMinutes: 30,
  registerMaxPerHour: 10,
  registerMaxPerDay: 10,
  globalFailureAlert: 50,
  registrationMode: "invite",
});
const logins = ref<LoginRow[]>([]);
const audits = ref<AuditRow[]>([]);
const sessions = ref<SessionRow[]>([]);
const blocked = ref<BlockedRow[]>([]);
const adminSession = useAdminSessionStore();
const canWrite = computed(() => adminSession.can("system.security.write"));
const saving = ref(false);
const panels = reactive<Record<PanelKey, PanelState>>({
  policy: newPanel(), logins: newPanel(), audits: newPanel(), sessions: newPanel(), blocked: newPanel(),
});
const actionBusy = ref("");
const actionError = ref("");
const recentRegisterAttempts = ref(0);
const recentDailyRegisterAttempts = ref(0);
const loginScope = ref("all");
const auditQuery = ref("");
const locallyBlocked = ref<string[]>([]);
const blockedHashes = computed(() => new Set([...blocked.value.map((row) => row.identity_hash), ...locallyBlocked.value]));
let active = true;
const filteredLogins = computed(() =>
  loginScope.value === "all" ? logins.value : logins.value.filter((row) => row.scope === loginScope.value),
);
const filteredAudits = computed(() => {
  const needle = auditQuery.value.trim().toLowerCase();
  if (!needle) return audits.value;
  return audits.value.filter((row) => [row.actor, row.action, row.target_id, row.summary, row.request_id].some((value) => String(value).toLowerCase().includes(needle)));
});

async function refreshPanel<T>(key: PanelKey, path: string, apply: (value: T) => void): Promise<boolean> {
  const state = panels[key];
  if (state.loading) return false;
  state.loading = true;
  state.error = "";
  try {
    const data = await api<T>(path);
    if (!active) return false;
    apply(data);
    state.loaded = true;
    return true;
  } catch (caught) {
    if (active) state.error = caught instanceof Error ? caught.message : "读取失败";
    return false;
  } finally {
    if (active) state.loading = false;
  }
}

function readPolicy(): Promise<boolean> {
  return refreshPanel<Policy>("policy", "/api/admin/security", (data) => {
    Object.assign(form, {
      loginMaxFailures: data.loginMaxFailures,
      loginLockMinutes: data.loginLockMinutes,
      adminLoginMaxFailures: data.adminLoginMaxFailures,
      adminLoginLockMinutes: data.adminLoginLockMinutes,
      registerMaxPerHour: data.registerMaxPerHour,
      registerMaxPerDay: data.registerMaxPerDay,
      globalFailureAlert: data.globalFailureAlert,
      registrationMode: data.registrationMode,
    });
    recentRegisterAttempts.value = Number(data.recentRegisterAttempts ?? 0);
    recentDailyRegisterAttempts.value = Number(data.recentDailyRegisterAttempts ?? 0);
  });
}
function readLogins(): Promise<boolean> {
  return refreshPanel<{ logs: LoginRow[] }>("logins", "/api/admin/login-logs?limit=50", (data) => { logins.value = data.logs; });
}
function readAudits(): Promise<boolean> {
  return refreshPanel<{ logs: AuditRow[] }>("audits", "/api/admin/audit-logs?limit=50", (data) => { audits.value = data.logs; });
}
function readSessions(): Promise<boolean> {
  return refreshPanel<{ sessions: SessionRow[] }>("sessions", "/api/admin/sessions", (data) => { sessions.value = data.sessions; });
}
function readBlocked(): Promise<boolean> {
  return refreshPanel<{ identities: BlockedRow[] }>("blocked", "/api/admin/blocked-identities", (data) => {
    blocked.value = data.identities;
    locallyBlocked.value = [];
  });
}
async function loadAll(): Promise<void> {
  await Promise.all([readPolicy(), readLogins(), readAudits(), readSessions(), readBlocked()]);
}

async function save(): Promise<void> {
  if (!canWrite.value || !panels.policy.loaded || panels.policy.loading || panels.policy.error || saving.value) return;
  saving.value = true;
  actionError.value = "";
  try {
    await api("/api/admin/security", { method: "PATCH", body: { ...form } });
    if (!active) return;
    const refreshed = await readPolicy();
    if (active) toast(refreshed ? "策略已保存" : "策略已保存，但重新读取失败；请核对当前设置", refreshed ? "success" : "warning");
  } catch (caught) {
    if (active) {
      actionError.value = caught instanceof ApiError ? caught.message : "保存失败";
      toast(actionError.value, "error");
    }
  } finally {
    if (active) saving.value = false;
  }
}

async function block(identityHash: string): Promise<void> {
  if (!canWrite.value || actionBusy.value || !panels.blocked.loaded || panels.blocked.loading || panels.blocked.error || blockedHashes.value.has(identityHash)) return;
  actionBusy.value = `block:${identityHash}`;
  actionError.value = "";
  try {
    if (!(await confirmDialog({
      title: "封禁登录来源",
      message: "这个来源将被禁止继续登录。页面上不会显示它的真实 IP。",
      confirmLabel: "确认封禁",
      tone: "danger",
    }))) return;
    await api("/api/admin/login-logs/block", {
      method: "POST",
      body: { identityHash, reason: "管理员在后台封禁" },
    });
    if (!active) return;
    locallyBlocked.value = [...locallyBlocked.value, identityHash];
    blocked.value = [{
      identity_hash: identityHash,
      scope: logins.value.find((row) => row.identity_hash === identityHash)?.scope ?? "—",
      reason: "详情待刷新",
      created_by: "—",
      created_at: new Date().toISOString(),
      provisional: true,
    }, ...blocked.value];
    const refreshed = await Promise.all([readBlocked(), readLogins(), readAudits()]);
    if (active) toast(refreshed.every(Boolean) ? "已封禁该来源指纹" : "已封禁来源，但部分列表刷新失败；请重试读取", refreshed.every(Boolean) ? "success" : "warning");
  } catch (caught) {
    if (active) {
      actionError.value = caught instanceof ApiError ? caught.message : "封禁失败";
      toast(actionError.value, "error");
    }
  } finally {
    if (active) actionBusy.value = "";
  }
}

async function unblock(identityHash: string): Promise<void> {
  if (!canWrite.value || actionBusy.value || panels.blocked.loading) return;
  actionBusy.value = `unblock:${identityHash}`;
  actionError.value = "";
  try {
    if (!(await confirmDialog({
      title: "解除来源封禁",
      message: "解除后，这个来源的封禁或冷却会结束，但验证码和请求次数限制仍然有效。",
      confirmLabel: "确认解封",
    }))) return;
    await api("/api/admin/blocked-identities/unblock", { method: "POST", body: { identityHash } });
    if (!active) return;
    blocked.value = blocked.value.filter((row) => row.identity_hash !== identityHash);
    locallyBlocked.value = locallyBlocked.value.filter((hash) => hash !== identityHash);
    const refreshed = await Promise.all([readBlocked(), readAudits()]);
    if (active) toast(refreshed.every(Boolean) ? "已解除来源封禁" : "已解封来源，但部分列表刷新失败；请重试读取", refreshed.every(Boolean) ? "success" : "warning");
  } catch (caught) {
    if (active) {
      actionError.value = caught instanceof ApiError ? caught.message : "解封失败";
      toast(actionError.value, "error");
    }
  } finally {
    if (active) actionBusy.value = "";
  }
}

async function revoke(id: string): Promise<void> {
  if (!canWrite.value || actionBusy.value || panels.sessions.loading) return;
  actionBusy.value = `revoke:${id}`;
  actionError.value = "";
  try {
    if (!(await confirmDialog({
      title: "强制下线会话",
      message: "对应管理员会话会立即失效，需要重新登录后台。",
      confirmLabel: "强制下线",
      tone: "danger",
    }))) return;
    await api(`/api/admin/sessions/${id}/revoke`, { method: "POST" });
    if (!active) return;
    sessions.value = sessions.value.filter((row) => row.id !== id);
    const refreshed = await Promise.all([readSessions(), readAudits()]);
    if (active) toast(refreshed.every(Boolean) ? "已强制下线" : "会话已下线，但部分列表刷新失败；请重试读取", refreshed.every(Boolean) ? "success" : "warning");
  } catch (caught) {
    if (active) {
      actionError.value = caught instanceof ApiError ? caught.message : "下线失败";
      toast(actionError.value, "error");
    }
  } finally {
    if (active) actionBusy.value = "";
  }
}

onMounted(() => { void loadAll(); });
onBeforeUnmount(() => { active = false; });
</script>

<style scoped>
.admin-inline-filter {
  width: min(280px, 100%);
}
</style>
