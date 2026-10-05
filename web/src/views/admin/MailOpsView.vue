<template>
  <div>
    <section v-motion="{ kind: 'feature' }" class="managed-page-card">
      <div class="panel-heading">
        <div><span class="eyebrow">DELIVERY</span><h2>出站队列</h2><p>只展示 BFF 从邮局数据卷读取到的队列项，不在浏览器拼接邮局命令。</p></div>
        <button class="button button--soft" type="button" :disabled="loading" @click="loadAll">{{ loading ? "正在采样…" : "重新采样" }}</button>
      </div>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await loadQueue(); } } }" v-if="queueError" class="mail-notice" role="alert">
        队列读取失败：{{ queueError }}{{ queueLoaded ? "；下方保留上次成功采样的结果。" : "" }}
        <button class="button button--soft" type="button" :disabled="queueLoading" @click="loadQueue">重试队列</button>
      </p>
      <p v-if="!queueLoaded && queueLoading" class="admin-page-state" role="status">正在读取出站队列…</p>
      <p v-else-if="!queueLoaded && !queueError" class="admin-page-state">尚未读取队列。</p>
      <p v-if="queueLoaded && !queueStatsAvailable" class="mail-notice">邮局统计数据卷未确认可用；当前队列结果需要到服务器核对，空列表不能视为没有积压。</p>
      <p v-if="queueLoaded && queue.length === 0 && queueStatsAvailable" class="mail-empty">{{ queueError ? "上次成功采样时没有积压；当前状态未知" : "没有积压的投递任务" }}</p>
      <div v-if="queueLoaded && queue.length > 0" class="table-scroll"><table class="admin-table">
        <thead><tr><th>队列项</th><th>大小</th><th>写入时间</th></tr></thead>
        <tbody>
          <tr v-for="item in queue" :key="item.id">
            <td>{{ item.id }}</td>
            <td>{{ formatSize(item.size) }}</td>
            <td>{{ new Date(item.modifiedAt).toLocaleString("zh-CN") }}</td>
          </tr>
        </tbody>
      </table></div>
      <p v-if="queueSampledAt" class="admin-page-state">最近成功采样：{{ queueSampledAt }}</p>
    </section>

    <section v-motion="{ kind: 'compact', delay: 60 }" class="managed-page-card">
      <div class="panel-heading"><div><h2>域名与证书自检</h2><p>逐项检查 DNS、TLS 与常用邮件端口。</p></div><button v-if="canCheckDomain" class="button button--soft" type="button" :disabled="checksLoading" @click="loadChecks">{{ checksLoading ? "检查中…" : "重新检查" }}</button></div>
      <p v-if="!canCheckDomain" class="mail-notice">当前管理员没有域名自检权限。</p>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await loadChecks(); } } }" v-else-if="checksError" class="mail-notice" role="alert">自检失败：{{ checksError }}{{ checksLoaded ? "；下方保留上次结果。" : "" }} <button class="button button--soft" type="button" :disabled="checksLoading" @click="loadChecks">重试自检</button></p>
      <p v-if="canCheckDomain && !checksLoaded && checksLoading" class="admin-page-state" role="status">正在检查域名与证书…</p>
      <div v-for="check in canCheckDomain ? checks : []" :key="check.key" class="check-row">
        <span class="badge" :class="`badge--${check.status}`">{{ check.label }}</span>
        <span>{{ check.detail }}</span>
      </div>
      <p v-if="canCheckDomain && checksLoaded && checks.length === 0" class="mail-empty">自检未返回检查项，请核对服务配置。</p>
      <p v-if="checksSampledAt" class="admin-page-state">最近成功检查：{{ checksSampledAt }}</p>
    </section>

    <section v-motion="{ kind: 'compact', delay: 100 }" class="managed-page-card">
      <div class="panel-heading">
        <div><h2>投递日志</h2><p>页面隐藏时暂停自动刷新，避免后台持续请求。</p></div>
        <div class="mail-log-actions">
          <button class="button button--soft" type="button" :disabled="logsLoading" @click="loadLogs">{{ logsLoading ? '读取中…' : '刷新日志' }}</button>
          <button class="button button--soft" type="button" :disabled="!logsAvailable" @click="copyLogs">复制诊断片段</button>
        </div>
      </div>
      <div class="admin-log-filters">
        <label class="field"><span class="field__label">行数</span><select v-theme-control v-model.number="lineLimit" @change="loadLogs"><option :value="100">100</option><option :value="200">200</option><option :value="500">500</option><option :value="1000">1000</option></select></label>
        <label class="field"><span class="field__label">关键字</span><input v-model="logQuery" type="search" placeholder="状态码、地址或错误摘要" /></label>
        <label class="check-field"><input v-model="autoRefresh" type="checkbox" />每 30 秒自动刷新</label>
      </div>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await loadLogs(); } } }" v-if="logsError" class="mail-notice" role="alert">日志读取失败：{{ logsError }}{{ logsLoaded ? "；保留上次结果。" : "" }} <button class="button button--soft" type="button" :disabled="logsLoading" @click="loadLogs">重试日志</button></p>
      <p v-if="!logsLoaded && logsLoading" class="admin-page-state" role="status">正在读取投递日志…</p>
      <p v-if="logsLoaded && !logsAvailable" class="mail-notice">{{ logsHint || "当前没有可用的容器日志。" }}</p>
      <p v-capsule-notice="{ tone: logsStale ? 'warning' : 'info' }" v-if="logsLoaded && logsAvailable && logsHint" class="mail-notice" :role="logsStale ? 'alert' : 'status'">{{ logsHint }}</p>
      <pre v-if="logsLoaded && logsAvailable" class="mail-body__text log-block">{{ filteredLogLines.join("\n") || "没有匹配的日志" }}</pre>
      <p v-if="logsSampledAt" class="admin-page-state">日志采样时间：{{ logsSampledAt }}{{ logsTruncated ? ' · 部分超长或更早日志已截断' : '' }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ApiError, formatSize, toast } from "../../api";
import { readMailQueue, checkMailDomain, readMailLogs, type DomainCheck as CheckItem, type QueueItem } from "../../api/mailOps";
import { useAdminSessionStore } from "../../stores/adminSession";

const queue = ref<QueueItem[]>([]);
const session = useAdminSessionStore();
const canCheckDomain = computed(() => session.can("mail.domain.check"));
const queueLoaded = ref(false);
const queueLoading = ref(false);
const queueError = ref("");
const queueStatsAvailable = ref(false);
const queueSampledAt = ref("");
const checks = ref<CheckItem[]>([]);
const checksLoaded = ref(false);
const checksLoading = ref(false);
const checksError = ref("");
const checksSampledAt = ref("");
const logLines = ref<string[]>([]);
const logsLoaded = ref(false);
const logsLoading = ref(false);
const logsError = ref("");
const logsSampledAt = ref("");
const logsStale = ref(false);
const logsTruncated = ref(false);
const logsAvailable = ref(false);
const logsHint = ref("");
const lineLimit = ref(200);
const logQuery = ref("");
const autoRefresh = ref(false);
const loading = ref(false);
let refreshTimer = 0;
let logsRequest = 0;
let active = true;
const failureMessage = (caught: unknown): string =>
  caught instanceof ApiError && caught.status === 403 ? "权限不足，请联系有权限的管理员" :
  caught instanceof Error ? caught.message : "请求失败";
const filteredLogLines = computed(() => {
  const needle = logQuery.value.trim().toLowerCase();
  return needle ? logLines.value.filter((line) => line.toLowerCase().includes(needle)) : logLines.value;
});

async function loadQueue(): Promise<void> {
  if (queueLoading.value) return;
  queueLoading.value = true;
  queueError.value = "";
  try {
    const data = await readMailQueue();
    if (!active) return;
    queue.value = data.entries;
    queueStatsAvailable.value = data.statsAvailable;
    queueLoaded.value = true;
    queueSampledAt.value = new Date().toLocaleString("zh-CN");
  } catch (caught) {
    if (active) queueError.value = failureMessage(caught);
  } finally {
    if (active) queueLoading.value = false;
  }
}

async function loadChecks(): Promise<void> {
  if (!canCheckDomain.value || checksLoading.value) return;
  checksLoading.value = true;
  checksError.value = "";
  try {
    const data = await checkMailDomain();
    if (!active) return;
    checks.value = data.checks;
    checksLoaded.value = true;
    checksSampledAt.value = new Date().toLocaleString("zh-CN");
  } catch (caught) {
    if (active) checksError.value = failureMessage(caught);
  } finally {
    if (active) checksLoading.value = false;
  }
}

async function loadLogs(): Promise<void> {
  const request = ++logsRequest;
  logsLoading.value = true;
  logsError.value = "";
  try {
    const data = await readMailLogs(lineLimit.value);
    if (!active || request !== logsRequest) return;
    logsAvailable.value = data.available;
    logsHint.value = data.hint ?? "";
    logLines.value = data.lines;
    logsLoaded.value = true;
    logsSampledAt.value = data.capturedAt ? new Date(data.capturedAt).toLocaleString("zh-CN") : "";
    logsStale.value = data.stale ?? false;
    logsTruncated.value = data.truncated ?? false;
  } catch (caught) {
    if (active && request === logsRequest) logsError.value = failureMessage(caught);
  } finally {
    if (active && request === logsRequest) logsLoading.value = false;
  }
}

async function loadAll(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    await Promise.all([loadQueue(), loadChecks(), loadLogs()]);
  } finally {
    if (active) loading.value = false;
  }
}

function updateTimer(): void {
  window.clearInterval(refreshTimer);
  refreshTimer = 0;
  if (!autoRefresh.value || document.hidden) return;
  refreshTimer = window.setInterval(() => void loadAll(), 30_000);
}

function onVisibility(): void {
  updateTimer();
  if (!document.hidden && autoRefresh.value) void loadAll();
}

async function copyLogs(): Promise<void> {
  try {
    await navigator.clipboard.writeText(filteredLogLines.value.join("\n"));
    toast("诊断片段已复制");
  } catch {
    toast("浏览器未允许复制，请手动选择日志", "warning");
  }
}

watch(autoRefresh, updateTimer);

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibility);
  void loadAll();
});

onBeforeUnmount(() => {
  active = false;
  window.clearInterval(refreshTimer);
  document.removeEventListener("visibilitychange", onVisibility);
});
</script>

<style scoped>
.log-block {
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-size: 12px;
}

.admin-log-filters {
  display: grid;
  grid-template-columns: 130px minmax(220px, 1fr) auto;
  gap: 12px;
  align-items: end;
  margin-bottom: 14px;
}

@media (max-width: 720px) {
  .admin-log-filters {
    grid-template-columns: 1fr;
  }
}

.badge--ok {
  background: var(--state-success-100);
  color: var(--state-success-700);
}

.badge--warn {
  background: var(--state-warning-100);
  color: var(--state-warning-700);
}

.badge--fail {
  background: var(--danger-100);
  color: var(--danger-700);
}
</style>
