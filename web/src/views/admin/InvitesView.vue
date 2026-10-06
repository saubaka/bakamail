<template>
  <section v-motion="{ kind: 'feature' }" class="managed-page-card" :aria-busy="loading">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">邀请管理</span>
        <h2>邀请码</h2>
        <p>明文邀请码只在创建成功后显示一次，列表只保留不可逆推的前缀。</p>
      </div>
      <button class="button button--soft" type="button" :disabled="loading || creating || Boolean(revokingId)" @click="load">{{ loading ? "刷新中…" : "刷新" }}</button>
    </div>
    <p class="mail-notice">每次成功注册计为使用一次。无限制仅适用于邀请码，验证码与注册安全限制仍然生效。</p>
    <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await load(); } } }" v-if="loadError" class="mail-notice" role="alert">
      邀请码列表读取失败：{{ loadError }}{{ loaded ? "；下方保留上次成功读取的数据，状态可能已变化。" : "；不能据此判断当前没有邀请码。" }}
      <button class="button button--soft" type="button" :disabled="loading || creating || revokingId !== null" @click="load">重试读取</button>
    </p>
    <form v-if="canWrite" class="form-grid" @submit.prevent="create">
      <div class="admin-form-grid invite-create-grid">
        <label class="field">
          <span class="field__label">绑定邮箱（可留空）</span>
          <input v-model="boundAddress" placeholder="newbie" :disabled="creating || loading || revokingId !== null" />
        </label>
        <label class="field">
          <span class="field__label">绑定域名（可留空）</span>
          <input v-model="boundDomain" placeholder="example.test" :disabled="creating || loading || revokingId !== null" />
        </label>
        <div class="invite-limit-field">
          <label class="field">
            <span class="field__label">使用次数</span>
            <select v-theme-control v-model="useMode" :disabled="creating || loading || revokingId !== null">
              <option value="limited">指定上限</option><option value="unlimited">无限制</option>
            </select>
          </label>
          <label v-if="useMode === 'limited'" class="field">
            <span class="field__label">次数上限</span>
            <input v-theme-control v-model.number="maxUses" type="number" min="1" :max="INVITE_MAX_USES" required :disabled="creating || loading || revokingId !== null" />
          </label>
          <p v-else class="invite-field-note">可供多个新邮箱重复使用，直到撤销或到期。</p>
        </div>
        <div class="invite-limit-field">
          <label class="field">
            <span class="field__label">有效期</span>
            <select v-theme-control v-model="expiryMode" :disabled="creating || loading || revokingId !== null">
              <option value="limited">指定小时数</option><option value="unlimited">无限制</option>
            </select>
          </label>
          <label v-if="expiryMode === 'limited'" class="field">
            <span class="field__label">有效期（小时）</span>
            <input v-theme-control v-model.number="ttlHours" type="number" min="1" :max="INVITE_MAX_TTL_HOURS" required :disabled="creating || loading || revokingId !== null" />
          </label>
          <p v-else class="invite-field-note">不会自动到期，仍受使用次数和撤销状态约束。</p>
        </div>
        <label class="field">
          <span class="field__label">备注</span>
          <input v-model="note" :disabled="creating || loading || revokingId !== null" />
        </label>
        <div class="invite-create-action"><button class="button button--primary" type="submit" :disabled="creating || loading || Boolean(revokingId)">{{ creating ? "生成中…" : "生成邀请码" }}</button><small>默认为一次使用、72 小时有效。</small></div>
      </div>
    </form>
    <div v-if="created" class="invite-reveal-card" role="region" aria-label="刚生成的邀请码">
      <span class="eyebrow">新邀请码（只显示这一次）</span>
      <code class="invite-code">{{ created }}</code>
      <button class="button button--soft" type="button" @click="copy">复制</button>
    </div>
    <div class="admin-filter-bar">
      <label class="field">
        <span class="field__label">搜索绑定或创建人</span>
        <input v-model="query" type="search" placeholder="邮箱、域名、创建人或前缀" />
      </label>
      <label class="field">
        <span class="field__label">邀请状态</span>
        <select v-theme-control v-model="statusFilter">
          <option value="all">全部</option>
          <option value="available">可用</option>
          <option value="used">已有成功使用</option>
          <option value="exhausted">次数已用完</option>
          <option value="reserved">名额处理中</option>
          <option value="expired">已过期</option>
          <option value="revoked">已撤销</option>
        </select>
      </label>
    </div>
    <p v-if="loaded" class="invite-overview">本次列表 {{ invites.length }} 枚 <span>成功使用 {{ totalUsed }} 次</span><span v-if="totalReserved">处理中／待核对 {{ totalReserved }} 次</span></p>
    <div v-if="loaded && filteredInvites.length" class="table-scroll invite-table-scroll">
    <table class="admin-table invite-table" aria-label="邀请码使用统计">
      <thead>
        <tr>
          <th>前缀</th>
          <th>绑定</th>
          <th>状态</th>
          <th>使用次数</th>
          <th>创建</th>
          <th>到期</th>
          <th>最近使用／占用</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredInvites" :key="row.id">
          <td data-label="前缀"><code>{{ row.code_hint }}…</code><small v-if="row.note" class="invite-cell-note">{{ row.note }}</small></td>
          <td data-label="绑定">{{ row.bound_address || row.bound_domain || "不限" }}</td>
          <td data-label="状态"><span class="invite-status">{{ statusOf(row) }}</span></td>
          <td data-label="使用次数" class="invite-usage"><strong>{{ row.used_count }} / {{ row.max_uses === null ? "无限制" : row.max_uses }}</strong><small>剩余 {{ remainingOf(row) }}</small><small v-if="row.reserved_count">处理中／待核对 {{ row.reserved_count }} 次</small></td>
          <td data-label="创建人">{{ row.created_by }}</td>
          <td data-label="到期">{{ row.expires_at === null ? "无限制" : short(row.expires_at) }}</td>
          <td data-label="最近使用／占用">{{ row.used_by || "—" }}<small v-if="row.used_at" class="invite-cell-note">{{ short(row.used_at) }}</small></td>
          <td data-label="操作">
            <button
              v-if="canWrite && !row.revoked_at"
              class="button button--soft"
              type="button"
              :disabled="creating || loading || revokingId !== null"
              @click="revoke(row.id)"
            >
              {{ revokingId === row.id ? "撤销中…" : "撤销" }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <p v-if="loading && !loaded" class="admin-page-state" role="status">正在读取邀请码…</p>
    <p v-else-if="loaded && !loadError && filteredInvites.length === 0" class="mail-empty">没有符合条件的邀请码</p>
    <p v-if="lastLoadedAt" class="admin-page-state">最近成功读取：{{ lastLoadedAt }}</p>
    <p v-capsule-notice v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError, api, toast } from "../../api";
import { confirmDialog } from "../../dialog";
import { useAdminSessionStore } from "../../stores/adminSession";
import { INVITE_MAX_USES, INVITE_MAX_TTL_HOURS, inviteLimitsProblem, inviteStatus, inviteRemaining, type InviteSummary as Invite } from '../../../../shared/invitePolicy.ts';

const invites = ref<Invite[]>([]);
const session = useAdminSessionStore();
const canWrite = computed(() => session.can("mail.invite.write"));
const boundAddress = ref("");
const boundDomain = ref("");
const ttlHours = ref(72);
const maxUses = ref(1);
const useMode = ref('limited');
const expiryMode = ref('limited');
const note = ref("");
const created = ref("");
const createdId = ref<number | null>(null);
const loading = ref(false);
const loaded = ref(false);
const loadError = ref("");
const lastLoadedAt = ref("");
const creating = ref(false);
const revokingId = ref<number | null>(null);
const actionError = ref("");
const query = ref("");
const statusFilter = ref("all");
let active = true;
const totalUsed = computed(() => invites.value.reduce((sum, row) => sum + row.used_count, 0));
const totalReserved = computed(() => invites.value.reduce((sum, row) => sum + row.reserved_count, 0));

function short(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function statusOf(row: Invite): string {
  return ({ available: row.used_count ? '可继续使用' : '可用', exhausted: '次数已用完', reserved: '名额处理中', expired: '已过期', revoked: '已撤销' })[statusKey(row)];
}

const statusKey = inviteStatus;
function remainingOf(row: Invite): string { const remaining = inviteRemaining(row); return remaining === null ? '无限制' : `${remaining} 次`; }

const filteredInvites = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return invites.value.filter((row) => {
    if (statusFilter.value === 'used' ? row.used_count === 0 : statusFilter.value !== 'all' && statusKey(row) !== statusFilter.value) return false;
    if (!needle) return true;
    return [row.code_hint, row.bound_address, row.bound_domain, row.created_by, row.used_by, row.note]
      .some((value) => value.toLowerCase().includes(needle));
  });
});

async function load(): Promise<boolean> {
  if (loading.value) return false;
  loading.value = true;
  loadError.value = "";
  try {
    const data = await api<{ invites: Invite[] }>("/api/admin/invites");
    if (!active) return false;
    invites.value = data.invites;
    loaded.value = true;
    lastLoadedAt.value = new Date().toLocaleString("zh-CN");
    return true;
  } catch (caught) {
    if (active) loadError.value = caught instanceof Error ? caught.message : "邀请码读取失败";
    return false;
  } finally {
    if (active) loading.value = false;
  }
}

async function create(): Promise<void> {
  if (!canWrite.value || creating.value || loading.value || revokingId.value !== null) return;
  const limits = { ttlHours: expiryMode.value === 'unlimited' ? null : ttlHours.value,
    maxUses: useMode.value === 'unlimited' ? null : maxUses.value };
  const problem = inviteLimitsProblem(limits);
  if (problem) { toast(problem, 'error'); return; }
  creating.value = true;
  actionError.value = "";
  try {
    const data = await api<{ code: string; id: number }>("/api/admin/invites", {
      method: "POST",
      body: {
        boundAddress: boundAddress.value,
        boundDomain: boundDomain.value,
        ...limits,
        note: note.value,
      },
    });
    if (!active) return;
    created.value = data.code;
    createdId.value = data.id;
    const refreshed = await load();
    if (active) toast(refreshed ? "邀请码已生成，请现在复制并妥善保存" : "邀请码已生成，但列表刷新失败；请先复制邀请码，再重试读取", refreshed ? "success" : "warning");
  } catch (caught) {
    if (active) {
      actionError.value = caught instanceof ApiError ? caught.message : "创建失败";
      toast(actionError.value, "error");
    }
  } finally {
    if (active) creating.value = false;
  }
}

async function copy(): Promise<void> {
  if (!created.value) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("浏览器不支持剪贴板写入");
    await navigator.clipboard.writeText(created.value);
    toast("已复制邀请码");
  } catch {
    toast("复制失败，请手动选择邀请码", "error");
  }
}

async function revoke(id: number): Promise<void> {
  if (!canWrite.value || creating.value || loading.value || revokingId.value !== null) return;
  revokingId.value = id;
  actionError.value = "";
  try {
    if (!(await confirmDialog({
      title: "撤销邀请码",
      message: "撤销后，这枚邀请码将无法再用于注册；已经创建的邮箱不会受到影响。",
      confirmLabel: "撤销邀请码",
      tone: "danger",
    }))) return;
    await api(`/api/admin/invites/${id}/revoke`, { method: "POST" });
    if (!active) return;
    // The write has succeeded even if the following list refresh fails.
    invites.value = invites.value.map((row) => row.id === id ? { ...row, revoked_at: new Date().toISOString() } : row);
    if (createdId.value === id) {
      created.value = "";
      createdId.value = null;
    }
    const refreshed = await load();
    if (active) toast(refreshed ? "邀请码已撤销" : "邀请码已撤销，但列表刷新失败；请重试读取", refreshed ? "success" : "warning");
  } catch (caught) {
    if (active) {
      actionError.value = caught instanceof ApiError ? caught.message : "撤销失败";
      toast(actionError.value, "error");
    }
  } finally {
    if (active) revokingId.value = null;
  }
}

onMounted(() => { void load(); });
onBeforeUnmount(() => { active = false; });
</script>

<style scoped>
.invite-reveal-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  margin: 18px 0;
  padding: 18px;
  border: 1px solid var(--silver-mist);
  border-radius: var(--radius-card);
  background: var(--surface-soft);
}

.invite-reveal-card > .button {
  justify-self: start;
}

.invite-code {
  display: block;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--silver-mist);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-size: 15px;
  overflow-wrap: anywhere;
}
.invite-create-grid { grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; gap:18px 22px; padding:20px 0; border-block:1px solid var(--line-blue); }
.invite-limit-field { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; min-width:0; align-items:start; }
.invite-create-grid .field { margin:0; gap:8px; }
.invite-create-action { align-self:end; display:flex; align-items:center; flex-wrap:wrap; gap:12px; }
.invite-create-action small,.invite-field-note { color:var(--text-soft); font-size:12px; line-height:1.7; }
.invite-field-note { margin:24px 0 0; }
.invite-overview { display:flex; flex-wrap:wrap; gap:8px 20px; margin:12px 0 16px; color:var(--text-soft); font-size:12px; }
.invite-status { display:inline-flex; padding:5px 9px; border:1px solid var(--line-blue); border-radius:var(--radius-pill); background:transparent; }
.invite-table-scroll { max-width:100%; }
.invite-table td { vertical-align:top; max-width:240px; white-space:normal; overflow-wrap:anywhere; line-height:1.7; }
.invite-table code { white-space:nowrap; }
.invite-usage strong { font-weight:600; white-space:nowrap; }
.invite-usage small,.invite-cell-note { display:block; color:var(--text-soft); font-size:11px; line-height:1.7; margin-top:3px; }
@media(max-width:1100px) { .invite-create-grid { grid-template-columns:minmax(0,1fr); } }
@media(max-width:680px) {
  .invite-table,.invite-table tbody { display:block; width:100%; }
  .invite-table thead { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
  .invite-table tr { display:grid; grid-template-columns:minmax(0,1fr); padding:14px 0; border-top:1px solid var(--line-blue); }
  .invite-table td { display:grid; grid-template-columns:88px minmax(0,1fr); gap:6px 10px; max-width:none; min-width:0; padding:7px 2px; border:0; }
  .invite-table td::before { content:attr(data-label); color:var(--text-soft); font-size:11px; align-self:center; }
  .invite-table td > small { grid-column:2; margin:0; }
  .invite-table td > .button,.invite-table td > .invite-status { justify-self:start; }
  .invite-table td > code { justify-self:start; }
}
@media(max-width:380px) { .invite-limit-field { grid-template-columns:minmax(0,1fr); }.invite-field-note { margin:0; } }
</style>
