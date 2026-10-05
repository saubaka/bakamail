<template>
  <div>
    <section v-motion="{ kind: 'feature' }" class="managed-page-card" :aria-busy="loading">
      <header class="admin-users-heading">
        <h2>管理员</h2>
        <button class="button button--soft" type="button" :disabled="loading || busy" @click="load">
          {{ loading ? "读取中…" : "刷新列表" }}
        </button>
      </header>
      <p class="mail-notice">
        后台账号与邮箱密码完全分离：即使某个邮箱密码泄露，也拿不到管理权限。
      </p>
      <p v-if="loadError" class="form-error" role="alert">
        {{ loadError }}<span v-if="admins.length">下方保留的是上次成功读取的列表。</span>
        <button class="button button--soft" type="button" :disabled="loading || busy" @click="load">重试</button>
      </p>
      <form class="form-grid" @submit.prevent="create">
        <div class="admin-user-form-row">
          <label class="field">
            <span class="field__label">账号</span>
            <input v-model="form.username" autocomplete="off" required :disabled="busy || loading" />
          </label>
          <PasswordField v-model="form.password" label="初始密码" autocomplete="new-password" :wide="false" required :disabled="busy || loading" />
          <label class="field">
            <span class="field__label">角色</span>
            <select v-theme-control v-model="form.role" :disabled="busy || loading">
              <option value="superadmin">超级管理员</option>
              <option value="admin">管理员</option>
              <option value="auditor">只读审计</option>
            </select>
          </label>
          <button class="button button--primary" type="submit" :disabled="busy || loading">
            {{ creating ? "创建中…" : "新建管理员" }}
          </button>
        </div>
      </form>
      <p v-if="hint" v-capsule-notice class="field-error" role="alert">{{ hint }}</p>
      <p v-if="loading && !admins.length" class="admin-page-state" role="status">正在读取管理员列表…</p>
      <p v-else-if="!loading && !loadError && !admins.length" class="admin-page-state">尚无管理员账号。</p>
      <div v-if="admins.length" class="admin-users-table-scroll" role="region" aria-label="管理员列表" tabindex="0">
        <table class="table">
          <thead><tr><th>账号</th><th>角色</th><th>状态</th><th>最近登录</th><th><span class="sr-only">操作</span></th></tr></thead>
          <tbody>
            <tr v-for="row in admins" :key="row.id">
              <td><span class="admin-users-cell-label">账号</span>{{ row.username }}</td>
              <td><span class="admin-users-cell-label">角色</span>{{ row.role }}</td>
              <td><span class="admin-users-cell-label">状态</span>{{ row.is_active ? "启用" : "禁用" }}</td>
              <td><span class="admin-users-cell-label">最近登录</span>{{ row.last_login_at ? new Date(row.last_login_at).toLocaleString("zh-CN") : "—" }}</td>
              <td class="table__actions">
                <button class="button button--soft" type="button" :disabled="busy || loading" @click="setRole(row.id, row.role)">
                  改角色
                </button>
                <button class="button button--soft" type="button" :disabled="busy || loading" @click="toggleActive(row.id, !row.is_active)">
                  {{ row.is_active ? "禁用" : "启用" }}
                </button>
                <button class="button button--soft" type="button" :disabled="busy || loading" @click="resetPassword(row.id)">改密码</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section v-motion="{ kind: 'compact', delay: 60 }" class="managed-page-card">
      <h2>我的权限</h2>
      <div class="check-row"><span class="badge">角色 {{ me.role }}</span></div>
      <ul>
        <li v-for="code in me.permissions" :key="code">{{ code }}</li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ApiError, toast } from "../../api";
import {
  changeAdminRole, createAdminUser, listAdminUsers, resetAdminUserPassword, setAdminUserActive,
} from "../../api/admin.ts";
import type { AdminRole, AdminRow } from "../../api/admin.ts";
import PasswordField from "../../components/PasswordField.vue";
import { confirmDialog, promptDialog } from "../../dialog";
import { useAdminSessionStore } from "../../stores/adminSession";

const session = useAdminSessionStore();
const admins = ref<AdminRow[]>([]);
const hint = ref("");
const loadError = ref("");
const loading = ref(false);
const creating = ref(false);
const actionBusy = ref("");
const busy = computed(() => creating.value || Boolean(actionBusy.value));
const form = reactive<{ username: string; password: string; role: AdminRole }>({
  username: "", password: "", role: "auditor",
});
const me = computed(() => session.me ?? { role: "auditor", permissions: [] as string[] });

function isAdminRole(value: string): value is AdminRole {
  return value === "superadmin" || value === "admin" || value === "auditor";
}

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    const data = await listAdminUsers();
    admins.value = data.admins;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : "管理员列表读取失败";
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  if (busy.value || loading.value) return;
  creating.value = true;
  hint.value = "";
  try {
    await createAdminUser({ ...form });
    form.username = "";
    form.password = "";
    toast("管理员已创建");
    await load();
  } catch (error) {
    hint.value = error instanceof ApiError ? error.message : "创建失败";
  } finally {
    creating.value = false;
  }
}

async function setRole(id: number, current: string): Promise<void> {
  if (busy.value || loading.value) return;
  actionBusy.value = `role:${id}`;
  try {
    const next = await promptDialog({
      title: "修改管理员角色",
      message: "可用角色：superadmin（超级管理员）、admin（管理员）、auditor（只读审计）。",
      fieldLabel: "新角色",
      initialValue: current,
      confirmLabel: "更新角色",
    });
    if (!next) return;
    if (!isAdminRole(next)) {
      toast("角色只能是 superadmin、admin 或 auditor", "error");
      return;
    }
    await changeAdminRole(id, next);
    toast("角色已更新");
    await load();
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "角色更新失败", "error");
  } finally {
    actionBusy.value = "";
  }
}

async function toggleActive(id: number, active: boolean): Promise<void> {
  if (busy.value || loading.value) return;
  actionBusy.value = `active:${id}`;
  try {
    if (!active && !(await confirmDialog({
      title: "停用管理员",
      message: "该管理员的全部后台会话会立即失效，之后无法登录，直到再次启用。",
      confirmLabel: "停用并下线",
      tone: "danger",
    }))) return;
    await setAdminUserActive(id, active);
    toast(active ? "已启用" : "已禁用并强制下线");
    await load();
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "状态更新失败", "error");
  } finally {
    actionBusy.value = "";
  }
}

async function resetPassword(id: number): Promise<void> {
  if (busy.value || loading.value) return;
  actionBusy.value = `password:${id}`;
  try {
    const password = await promptDialog({
      title: "重置管理员密码",
      message: "更新后会吊销该管理员现有的全部后台会话。",
      fieldLabel: "新密码",
      placeholder: "至少 10 位，不能是纯数字或纯字母",
      inputType: "password",
      confirmLabel: "更新并下线",
      tone: "danger",
    });
    if (!password) return;
    await resetAdminUserPassword(id, password);
    toast("密码已更新并吊销该账号会话");
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "更新失败", "error");
  } finally {
    actionBusy.value = "";
  }
}

onMounted(load);
</script>

<style scoped>
.admin-users-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.admin-user-form-row {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
  width: 100%;
}

.admin-user-form-row > * {
  min-width: 0;
}

.admin-users-table-scroll {
  max-width: 100%;
  overflow-x: auto;
}

.table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  font-size: 13px;
}

.table th,
.table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.admin-users-cell-label {
  display: none;
}

.table__actions {
  display: flex;
  gap: 6px;
}

@media (max-width: 700px) {
  .admin-user-form-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-user-form-row > .button {
    width: 100%;
  }

  .admin-users-table-scroll {
    overflow-x: visible;
  }

  .table {
    min-width: 0;
  }

  .table thead {
    display: none;
  }

  .table tbody,
  .table tr,
  .table td {
    display: block;
    width: 100%;
  }

  .table tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }

  .table td {
    min-width: 0;
    padding: 0;
    border: 0;
    overflow-wrap: anywhere;
  }

  .admin-users-cell-label {
    display: block;
    margin-bottom: 3px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .table__actions {
    grid-column: 1 / -1;
    flex-wrap: wrap;
    margin-top: 4px;
  }
}
</style>
