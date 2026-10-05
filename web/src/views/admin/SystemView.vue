<template>
  <div class="admin-system-grid">
    <NotificationAppearance />
    <section v-motion="{ kind: 'feature' }" class="admin-panel is-wide">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">站点设置</span>
          <h2>名称、公告与欢迎邮件</h2>
          <p>这些内容由 BakaMail 后端保存，不会直接修改 Maddy 配置。</p>
        </div>
        <button class="button button--primary" type="button" :disabled="!settingsLoaded || settingsLoading || saving" @click="save">
          {{ saving ? "保存中…" : "保存设置" }}
        </button>
      </div>
      <p v-if="!settingsLoaded && settingsLoading" class="admin-page-state" role="status">正在读取站点设置…</p>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await loadSettings(); } } }" v-if="settingsError" class="mail-notice" role="alert">
        站点设置读取失败：{{ settingsError }}{{ settingsLoaded ? "；编辑区保留上次读取的数据。" : "；未加载真实设置前禁止保存。" }}
        <button class="button button--soft" type="button" :disabled="settingsLoading || saving" @click="loadSettings">重试读取</button>
      </p>
      <form v-if="settingsLoaded" class="form-grid" @submit.prevent="save">
        <div class="compose-grid__row">
          <label class="field">
            <span class="field__label">站点名称</span>
            <input v-model="settings.siteName" maxlength="80" :disabled="saving || settingsLoading" />
          </label>
          <label class="field">
            <span class="field__label">新账号欢迎邮件</span>
            <select v-theme-control v-model="settings.welcomeMail" :disabled="saving || settingsLoading">
              <option value="off">关闭</option>
              <option value="on">开启</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field__label">全站公告</span>
          <textarea v-model="settings.announcement" rows="4" maxlength="500" :disabled="saving || settingsLoading"></textarea>
        </label>
      </form>
      <p v-capsule-notice v-if="saveError" class="form-error" role="alert">{{ saveError }}</p>
      <p v-if="savedAt" class="admin-page-state">最近确认保存：{{ savedAt }}</p>
    </section>

    <section v-motion="{ kind: 'compact', delay: 60 }" class="admin-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">RUNNER</span>
          <h2>邮局连接方式</h2>
          <p>浏览器只访问 BFF，命令和协议参数不会进入前端。</p>
        </div>
        <span class="badge" :class="runnerLoaded ? (runner.ready ? 'badge--blue' : 'badge--danger') : 'badge--gray'">
          {{ !runnerLoaded ? "未读取" : runner.ready ? "已启用" : "未启用" }}
        </span>
      </div>
      <p class="mail-notice">“已启用”仅表示后端配置了邮局调用方式，不代表容器或邮件协议已通过健康检查。</p>
      <p v-if="!runnerLoaded && runnerLoading" class="admin-page-state" role="status">正在读取运行方式…</p>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await loadRunner(); } } }" v-if="runnerError" class="mail-notice" role="alert">
        运行方式读取失败：{{ runnerError }}{{ runnerLoaded ? "；下方保留上次结果。" : "" }}
        <button class="button button--soft" type="button" :disabled="runnerLoading" @click="loadRunner">重试读取</button>
      </p>
      <dl v-if="runnerLoaded" class="admin-status-list">
        <div><dt>Runner</dt><dd>{{ runner.runner || "—" }}</dd></div>
        <div><dt>邮件域名</dt><dd>{{ domain || "未读取" }}</dd></div>
        <div><dt>邮局主机</dt><dd>{{ mailHost || "未读取" }}</dd></div>
        <div><dt>服务版本</dt><dd>{{ runner.serviceVersion || "—" }}</dd></div>
        <div><dt>Node.js</dt><dd>{{ runner.nodeVersion || "—" }}</dd></div>
      </dl>
    </section>

    <section v-motion="{ kind: 'compact', delay: 100 }" class="admin-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">BACKUP</span>
          <h2>管理数据备份</h2>
          <p>包含管理员元数据、邀请码、审计记录、登录记录、设置和联系人，不包含密码明文。</p>
        </div>
      </div>
      <p class="mail-notice">下载响应禁止缓存；每次下载都会写入审计日志。</p>
      <button class="button button--primary" type="button" :disabled="downloading" @click="downloadBackup">
        {{ downloading ? "正在生成…" : "下载 JSON 备份" }}
      </button>
      <p v-capsule-notice="{ action: { label: '重试读取', run: async () => { await downloadBackup(); } } }" v-if="backupError" class="form-error" role="alert">备份下载失败：{{ backupError }} <button class="button button--soft" type="button" :disabled="downloading" @click="downloadBackup">重试</button></p>
      <p v-if="lastBackup" class="admin-page-state">最近备份生成：{{ lastBackup }}</p>
    </section>

    <section v-motion="{ kind: 'compact', delay: 140 }" class="admin-panel is-wide">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">权限</span>
          <h2>{{ roleLabel }}的有效权限</h2>
          <p>页面入口按此清单显示；最终授权仍由服务端中间件决定。</p>
        </div>
      </div>
      <div class="permission-cloud">
        <span v-for="permission in permissions" :key="permission" class="badge badge--gray">
          {{ permission === "*" ? "全部权限（*）" : permission }}
        </span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ApiError, api, apiDownload, toast } from "../../api";
import { useAdminSessionStore } from "../../stores/adminSession";
import NotificationAppearance from '../../components/admin/NotificationAppearance.vue';

type SiteSettings = {
  siteName: string;
  announcement: string;
  registrationMode: string;
  welcomeMail: string;
};

type RunnerStatus = {
  runner: string;
  ready: boolean;
  serviceVersion: string;
  nodeVersion: string;
};

const session = useAdminSessionStore();
const settings = reactive<SiteSettings>({
  siteName: "BakaMail",
  announcement: "",
  registrationMode: "invite",
  welcomeMail: "off",
});
const runner = reactive<RunnerStatus>({ runner: "", ready: false, serviceVersion: "", nodeVersion: "" });
const domain = ref("");
const mailHost = ref("");
const settingsLoaded = ref(false);
const settingsLoading = ref(false);
const settingsError = ref("");
const runnerLoaded = ref(false);
const runnerLoading = ref(false);
const runnerError = ref("");
const saving = ref(false);
const downloading = ref(false);
const lastBackup = ref("");
const backupError = ref("");
const saveError = ref("");
const savedAt = ref("");
let active = true;
const permissions = computed(() => session.me?.permissions ?? []);
const roleLabel = computed(
  () => ({ superadmin: "超级管理员", admin: "管理员", auditor: "只读审计" })[session.me?.role ?? "auditor"],
);

async function loadSettings(): Promise<void> {
  if (settingsLoading.value || saving.value) return;
  settingsLoading.value = true;
  settingsError.value = "";
  try {
    const site = await api<{ settings: SiteSettings; domain: string; mailHost: string }>("/api/admin/site-settings");
    if (!active) return;
    Object.assign(settings, site.settings);
    domain.value = site.domain;
    mailHost.value = site.mailHost;
    settingsLoaded.value = true;
  } catch (caught) {
    if (active) settingsError.value = caught instanceof Error ? caught.message : "站点设置读取失败";
  } finally {
    if (active) settingsLoading.value = false;
  }
}

async function loadRunner(): Promise<void> {
  if (runnerLoading.value) return;
  runnerLoading.value = true;
  runnerError.value = "";
  try {
    const status = await api<RunnerStatus>("/api/admin/runner-status");
    if (!active) return;
    Object.assign(runner, status);
    runnerLoaded.value = true;
  } catch (caught) {
    if (active) runnerError.value = caught instanceof Error ? caught.message : "运行方式读取失败";
  } finally {
    if (active) runnerLoading.value = false;
  }
}

async function save(): Promise<void> {
  if (!settingsLoaded.value || settingsLoading.value || saving.value) return;
  saving.value = true;
  saveError.value = "";
  try {
    await api("/api/admin/site-settings", {
      method: "PATCH",
      body: {
        siteName: settings.siteName,
        announcement: settings.announcement,
        welcomeMail: settings.welcomeMail,
      },
    });
    if (!active) return;
    savedAt.value = new Date().toLocaleString("zh-CN");
    toast("系统设置已保存");
  } catch (caught) {
    if (active) saveError.value = caught instanceof ApiError && caught.status === 0
      ? "网络中断，无法确认是否已保存；请核对设置后再重试"
      : caught instanceof Error ? caught.message : "保存失败";
  } finally {
    if (active) saving.value = false;
  }
}

async function downloadBackup(): Promise<void> {
  if (downloading.value) return;
  downloading.value = true;
  backupError.value = "";
  try {
    const { blob, filename, generatedAt } = await apiDownload("/api/admin/backup");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (active) {
      const generatedTime = generatedAt ? new Date(generatedAt) : null;
      lastBackup.value = generatedTime && !Number.isNaN(generatedTime.getTime())
        ? generatedTime.toLocaleString("zh-CN")
        : "服务未提供生成时间";
      toast("备份已生成并开始下载");
    }
  } catch (caught) {
    if (active) backupError.value = caught instanceof Error ? caught.message : "备份失败";
  } finally {
    if (active) downloading.value = false;
  }
}

onMounted(() => { void Promise.all([loadSettings(), loadRunner()]); });
onBeforeUnmount(() => { active = false; });
</script>
