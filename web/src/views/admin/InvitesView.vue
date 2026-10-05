<template>
  <section v-motion="{ kind: 'feature' }" class="managed-page-card" :aria-busy="loading">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">INVITATIONS</span>
        <h2>邀请码</h2>
        <p>明文邀请码只在创建成功后显示一次，列表只保留不可逆推的前缀。</p>
      </div>
      <button class="button button--soft" type="button" :disabled="loading || creating || Boolean(revokingId)" @click="load">{{ loading ? "刷新中…" : "刷新" }}</button>
    </div>
    <p class="mail-notice">注册只认邀请码。可以绑定目标邮箱地址，也可以只限定域名。</p>
    <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await load(); } } }" v-if="loadError" class="mail-notice" role="alert">
      邀请码列表读取失败：{{ loadError }}{{ loaded ? "；下方保留上次成功读取的数据，状态可能已变化。" : "；不能据此判断当前没有邀请码。" }}
      <button class="button button--soft" type="button" :disabled="loading || creating || revokingId !== null" @click="load">重试读取</button>
    </p>
    <form v-if="canWrite" class="form-grid" @submit.prevent="create">
      <div class="admin-form-grid">
        <label class="field">
          <span class="field__label">绑定邮箱（可留空）</span>
          <input v-model="boundAddress" placeholder="newbie" :disabled="creating || loading || revokingId !== null" />
        </label>
        <label class="field">
          <span class="field__label">绑定域名（可留空）</span>
          <input v-model="boundDomain" placeholder="saubaka.com" :disabled="creating || loading || revokingId !== null" />
        </label>
        <label class="field">
          <span class="field__label">有效期（小时）</span>
          <input v-theme-control v-model.number="ttlHours" type="number" min="1" max="720" required :disabled="creating || loading || revokingId !== null" />
        </label>
        <label class="field">
          <span class="field__label">备注</span>
          <input v-model="note" :disabled="creating || loading || revokingId !== null" />
        </label>
        <button class="button button--primary" type="submit" :disabled="creating || loading || Boolean(revokingId)">{{ creating ? "生成中…" : "生成邀请码" }}</button>
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
          <option value="used">已使用</option>
          <option value="expired">已过期</option>
          <option value="revoked">已撤销</option>
        </select>
      </label>
    </div>
    <div v-if="loaded && filteredInvites.length" class="table-scroll">
    <table class="admin-table">
      <thead>
        <tr>
          <th>前缀</th>
          <th>绑定</th>
          <th>状态</th>
          <th>创建</th>
          <th>到期</th>
          <th>使用</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredInvites" :key="row.id">
          <td>{{ row.code_hint }}…</td>
          <td>{{ row.bound_address || row.bound_domain || "不限" }}</td>
          <td>{{ statusOf(row) }}</td>
          <td>{{ row.created_by }}</td>
          <td>{{ short(row.expires_at) }}</td>
          <td>{{ row.used_by || "—" }}</td>
          <td>
            <button
              v-if="canWrite && statusKey(row) === 'available'"
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

type Invite = {
  id: number;
  code_hint: string;
  bound_address: string;
  bound_domain: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string;
  revoked_at: string | null;
};

const invites = ref<Invite[]>([]);
const session = useAdminSessionStore();
const canWrite = computed(() => session.can("mail.invite.write"));
const boundAddress = ref("");
const boundDomain = ref("");
const ttlHours = ref(72);
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

function short(value: string): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function statusOf(row: Invite): string {
  return ({ available: "可用", used: "已使用", expired: "已过期", revoked: "已撤销" })[statusKey(row)];
}

function statusKey(row: Invite): "available" | "used" | "expired" | "revoked" {
  if (row.revoked_at) return "revoked";
  if (row.used_at) return "used";
  if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  return "available";
}

const filteredInvites = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return invites.value.filter((row) => {
    if (statusFilter.value !== "all" && statusKey(row) !== statusFilter.value) return false;
    if (!needle) return true;
    return [row.code_hint, row.bound_address, row.bound_domain, row.created_by, row.used_by]
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
  creating.value = true;
  actionError.value = "";
  try {
    const data = await api<{ code: string; id: number }>("/api/admin/invites", {
      method: "POST",
      body: {
        boundAddress: boundAddress.value,
        boundDomain: boundDomain.value,
        ttlHours: ttlHours.value,
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
</style>
