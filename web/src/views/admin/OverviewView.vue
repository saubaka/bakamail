<template>
  <div class="baka-overview">
    <section v-motion="{ kind: 'feature' }" class="admin-panel baka-overview__intro" aria-labelledby="overview-title">
      <div>
        <p class="baka-overview__eyebrow">BAKAMAIL · 管理概览</p>
        <h2 id="overview-title">运行摘要</h2>
        <p>从这里查看当前统计、登录防护和常用管理入口。</p>
      </div>
      <button class="button button--soft" type="button" :disabled="loading" @click="loadOverview">
        {{ loading ? "正在刷新…" : "刷新数据" }}
      </button>
    </section>

    <p v-if="error" class="mail-notice baka-overview__error" role="alert">
      {{ error }}<span v-if="overview">下方保留的是上次成功加载的数据。</span>
      <button class="button button--soft" type="button" :disabled="loading" @click="loadOverview">重试</button>
    </p>
    <p v-if="!overview && loading" class="admin-page-state" role="status">正在读取运行摘要…</p>

    <div v-if="overview" class="baka-overview__stats" aria-label="运行统计">
      <article
        v-for="metric in metrics"
        :key="metric.title"
        class="baka-overview-stat"
        :class="{ 'is-alert': metric.alert, 'is-unavailable': !metric.available }"
      >
        <span class="baka-overview-stat__icon" aria-hidden="true">{{ metric.icon }}</span>
        <div>
          <small>{{ metric.title }}</small>
          <strong>{{ metric.available ? metric.value : "未提供" }}</strong>
          <span class="baka-overview-stat__hint">{{ metric.hint }}</span>
        </div>
      </article>
    </div>

    <div v-if="overview" class="baka-overview__details">
      <section v-motion="{ kind: 'compact', delay: 60 }" class="admin-panel baka-overview-panel" aria-labelledby="overview-system-title">
        <div class="baka-overview-panel__heading">
          <div>
            <p class="baka-overview__eyebrow">系统信息</p>
            <h3 id="overview-system-title">统计与安全</h3>
          </div>
          <span class="baka-overview__status" :class="{ 'is-alert': alertReached }">
            {{ error ? "上次数据" : alertReached ? "需要关注" : "已更新" }}
          </span>
        </div>
        <div class="baka-overview__system-items">
          <div>
            <span>邮件统计</span>
            <strong>{{ overview.statsAvailable ? "可用" : "未提供" }}</strong>
            <small>{{ overview.statsAvailable ? "来自当前邮局数据卷" : "当前实例未挂载统计数据卷" }}</small>
          </div>
          <div>
            <span>邮局操作方式</span>
            <strong>{{ runnerLabel }}</strong>
            <small>此项不代表投递健康检查</small>
          </div>
          <div>
            <span>登录防护</span>
            <strong>{{ alertReached ? "达到告警阈值" : "未达到告警阈值" }}</strong>
            <small>过去 15 分钟失败 {{ overview.loginFailures15m }} 次，阈值 {{ overview.failureAlertThreshold }} 次</small>
          </div>
        </div>
        <p v-if="!overview.statsAvailable" class="mail-notice">统计不可用不等于邮箱没有账号或邮件，请到服务器核对数据卷挂载。</p>
      </section>

      <section v-motion="{ kind: 'compact', delay: 100 }" class="admin-panel baka-overview-panel" aria-labelledby="overview-actions-title">
        <div class="baka-overview-panel__heading">
          <div>
            <p class="baka-overview__eyebrow">快捷操作</p>
            <h3 id="overview-actions-title">前往管理</h3>
          </div>
        </div>
        <div class="baka-overview__quick-actions">
          <router-link v-for="action in quickActions" :key="action.to.name" :to="action.to">
            <span aria-hidden="true">{{ action.icon }}</span>
            {{ action.label }}
            <span class="baka-overview__arrow" aria-hidden="true">↗</span>
          </router-link>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { api } from "../../api";
import { useAdminSessionStore } from "../../stores/adminSession";
import { ADMIN_PAGE_PATHS } from "../../../../shared/adminPaths";

type Overview = {
  accounts: number;
  messages: number;
  unseen: number;
  queueLength: number;
  recentFailures: number;
  loginFailures15m: number;
  failureAlertThreshold: number;
  statsAvailable: boolean;
  maddyRunner: string;
};

const session = useAdminSessionStore();
const overview = ref<Overview | null>(null);
const error = ref("");
const loading = ref(false);
let mounted = true;

const alertReached = computed(() => Boolean(
  overview.value && overview.value.failureAlertThreshold > 0 &&
  overview.value.loginFailures15m >= overview.value.failureAlertThreshold,
));
const runnerLabel = computed(() => {
  if (overview.value?.maddyRunner === "docker-exec") return "Docker 容器";
  if (overview.value?.maddyRunner === "local") return "本机";
  if (overview.value?.maddyRunner === "disabled") return "未启用";
  return "未说明";
});
const metrics = computed(() => {
  const data = overview.value;
  if (!data) return [];
  return [
    { title: "邮箱账号", value: data.accounts, hint: "账号总数", icon: "☺", available: data.statsAvailable, alert: false },
    { title: "邮件总数", value: data.messages, hint: "全部文件夹合计", icon: "✉", available: data.statsAvailable, alert: false },
    { title: "未读邮件", value: data.unseen, hint: "所有账号合计", icon: "•", available: data.statsAvailable, alert: false },
    { title: "出站队列", value: data.queueLength, hint: "待投递任务", icon: "↗", available: data.statsAvailable, alert: false },
    { title: "15 分钟失败", value: data.loginFailures15m, hint: `告警阈值 ${data.failureAlertThreshold}`, icon: "!", available: true, alert: alertReached.value },
    { title: "24 小时失败", value: data.recentFailures, hint: "登录与注册失败", icon: "◷", available: true, alert: false },
  ];
});
const quickActions = computed(() => [
  { to: { name: 'admin-accounts' }, label: "邮箱账号", icon: "☺", permission: "mail.account.read" },
  { to: { name: 'admin-invites' }, label: "邀请码", icon: "✦", permission: "mail.invite.read" },
  { to: { name: 'admin-mail-ops' }, label: "邮件运维", icon: "✉", permission: "mail.queue.read" },
  { to: { name: 'admin-security' }, label: "安全中心", icon: "◇", permission: "system.audit.read" },
].filter((action) => session.can(action.permission)));

async function loadOverview(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const next = await api<Overview>("/api/admin/overview");
    if (mounted) overview.value = next;
  } catch (caught) {
    if (mounted) error.value = caught instanceof Error ? caught.message : "加载失败";
  } finally {
    if (mounted) loading.value = false;
  }
}

onMounted(() => { void loadOverview(); });
onUnmounted(() => { mounted = false; });
</script>
