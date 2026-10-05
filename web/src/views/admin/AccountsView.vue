<template>
  <section v-motion="{ kind: 'feature' }" class="managed-page-card">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">MAILBOXES</span>
        <h2>邮箱账号</h2>
        <p>凭据与邮箱必须成对存在；半成品账号可修复，已无邮局账号但仍有本地数据时可清理残留。</p>
      </div>
      <button class="button button--soft" type="button" :disabled="loading" @click="load">刷新</button>
    </div>
    <form v-if="canWrite" class="form-grid" @submit.prevent="create">
      <div class="compose-grid__row">
        <label class="field">
          <span class="field__label">账号名</span>
          <input v-model="newAccount" placeholder="例如 baka" :disabled="creating" required />
        </label>
        <PasswordField v-model="newPassword" label="初始密码" autocomplete="new-password" :wide="false" :disabled="creating" required />
        <button class="button button--primary" type="submit" :disabled="creating">{{ creating ? "正在创建…" : "新建账号" }}</button>
      </div>
    </form>
    <p v-if="hint" v-capsule-notice class="field-error" role="alert">{{ hint }}</p>
    <p v-if="loadError" v-capsule-notice class="field-error" role="alert">{{ loadError }}{{ accounts.length ? "；下方保留的是上次成功读取的列表" : "" }}</p>
    <div class="admin-filter-bar">
      <label class="field">
        <span class="field__label">搜索账号</span>
        <input v-model="query" type="search" placeholder="输入邮箱或账号名" />
      </label>
      <label class="field">
        <span class="field__label">账号状态</span>
        <select v-theme-control v-model="statusFilter">
          <option value="all">全部</option>
          <option value="healthy">正常</option>
          <option value="broken">需要修复</option>
        </select>
      </label>
    </div>
    <div class="table-scroll">
    <table class="admin-table">
      <thead>
        <tr>
          <th>邮箱地址</th>
          <th>凭据</th>
          <th>邮箱数据</th>
          <th>邮件</th>
          <th>未读</th>
          <th>文件夹</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredAccounts" :key="row.mailbox" :class="{ 'is-warning-row': row.broken }">
          <td>{{ row.mailbox }}</td>
          <td><span class="badge" :class="row.hasCredential ? 'badge--blue' : 'badge--danger'">{{ row.hasCredential ? "有" : "缺" }}</span></td>
          <td><span class="badge" :class="row.hasMailbox ? 'badge--blue' : 'badge--danger'">{{ row.hasMailbox ? "有" : "缺" }}</span></td>
          <td>{{ row.messages }}</td>
          <td>{{ row.unseen }}</td>
          <td>{{ row.folders }}</td>
          <td class="table__actions">
            <button v-if="row.broken && !row.needsCleanup && canWrite" class="button button--soft" type="button" @click="repair(row)">修复</button>
            <button v-if="canWrite && row.hasCredential && row.hasMailbox" class="button button--soft" type="button" @click="resetPassword(row.mailbox)">重置密码</button>
            <button v-if="canWrite" class="button button--soft" type="button" @click="remove(row)">{{ row.needsCleanup ? "清理残留" : "删除" }}</button>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <p v-if="loading" class="mail-empty">正在读取邮箱账号…</p>
    <p v-else-if="!loadError && filteredAccounts.length === 0" class="mail-empty">没有符合条件的账号</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApiError, api, toast } from "../../api";
import PasswordField from "../../components/PasswordField.vue";
import { promptDialog } from "../../dialog";
import { useAdminSessionStore } from "../../stores/adminSession";

type Row = {
  mailbox: string;
  hasCredential: boolean;
  hasMailbox: boolean;
  messages: number;
  unseen: number;
  folders: number;
  broken: boolean;
  needsCleanup: boolean;
};

const accounts = ref<Row[]>([]);
const session = useAdminSessionStore();
const canWrite = computed(() => session.can("mail.account.write"));
const newAccount = ref("");
const newPassword = ref("");
const hint = ref("");
const loadError = ref("");
const loading = ref(false);
const creating = ref(false);
const query = ref("");
const statusFilter = ref("all");
const filteredAccounts = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return accounts.value.filter((row) => {
    if (needle && !row.mailbox.toLowerCase().includes(needle)) return false;
    if (statusFilter.value === "healthy" && row.broken) return false;
    if (statusFilter.value === "broken" && !row.broken) return false;
    return true;
  });
});

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await api<{ accounts: Row[] }>("/api/admin/accounts");
    accounts.value = [...data.accounts].sort((a, b) => Number(b.broken) - Number(a.broken));
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : "账号读取失败";
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  hint.value = "";
  try {
    await api("/api/admin/accounts", {
      method: "POST",
      body: { account: newAccount.value, password: newPassword.value },
    });
    newAccount.value = "";
    newPassword.value = "";
    toast("账号已创建");
    await load();
  } catch (error) {
    hint.value = error instanceof ApiError ? error.message : "创建失败";
  } finally {
    creating.value = false;
  }
}

async function repair(row: Row): Promise<void> {
  let password = "";
  if (!row.hasCredential) {
    password = (await promptDialog({
      title: "补建登录凭据",
      message: `${row.mailbox} 已有邮箱数据但缺少登录凭据。设置新密码后即可恢复登录。`,
      fieldLabel: "新密码",
      placeholder: "至少 10 位，不能是纯数字或纯字母",
      inputType: "password",
      confirmLabel: "补建凭据",
      tone: "danger",
    })) ?? "";
    if (!password) return;
  } else {
    const confirmed = await promptDialog({
      title: "补建邮箱结构",
      message: `${row.mailbox} 已有登录凭据但缺少邮箱数据。请输入完整邮箱地址确认补建。`,
      fieldLabel: "完整邮箱地址",
      requiredText: row.mailbox,
      confirmLabel: "补建邮箱",
      tone: "danger",
    });
    if (confirmed !== row.mailbox) return;
  }
  try {
    const result = await api<{ repaired: string[] }>("/api/admin/accounts/repair", {
      method: "POST",
      body: { account: row.mailbox, password, confirm: true },
    });
    toast(`账号已修复：${result.repaired.join("、") || "状态已正常"}`);
    await load();
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "修复失败", "error");
  }
}

async function resetPassword(mailbox: string): Promise<void> {
  const password = await promptDialog({
    title: "重置邮箱密码",
    message: `为 ${mailbox} 设置新密码。成功后，该邮箱的全部网页登录会话会被强制下线。`,
    fieldLabel: "新密码",
    placeholder: "至少 10 位，不能是纯数字或纯字母",
    inputType: "password",
    confirmLabel: "重置并下线",
    tone: "danger",
  });
  if (!password) return;
  try {
    const data = await api<{ revokedSessions: number }>("/api/admin/accounts/password", {
      method: "POST",
      body: { account: mailbox, password, confirm: true },
    });
    toast(`已重置密码，强制下线 ${data.revokedSessions} 个会话`);
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "重置失败", "error");
  }
}

async function remove(row: Row): Promise<void> {
  const mailbox = row.mailbox;
  const confirmed = await promptDialog({
    title: row.needsCleanup ? "清理账号残留" : "删除邮箱账号",
    message: row.needsCleanup
      ? `${mailbox} 的邮局账号已不存在。清理它在 BakaMail 中留下的草稿、联系人、偏好和会话记录，无法撤销。`
      : `${mailbox} 的登录凭据、邮箱邮件及 BakaMail 中的草稿、联系人和偏好都会被移除，且无法撤销。`,
    fieldLabel: "输入完整邮箱地址",
    requiredText: mailbox,
    confirmLabel: row.needsCleanup ? "清理残留" : "永久删除",
    tone: "danger",
  });
  if (confirmed !== mailbox) return;
  try {
    await api("/api/admin/accounts/remove", {
      method: "POST",
      body: { account: mailbox, confirm: true },
    });
    toast(row.needsCleanup ? "账号残留数据已清理" : "账号及关联数据已删除");
    await load();
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "删除失败", "error");
  }
}

onMounted(load);
</script>

<style scoped>
.table__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
