<template>
  <div class="admin-shell">
    <button
      class="admin-drawer-backdrop"
      :class="{ 'is-open': menuOpen }"
      type="button"
      tabindex="-1"
      aria-label="关闭后台导航"
      @click="closeMenu()"
    ></button>
    <aside
      id="admin-sidebar"
      ref="sidebarElement"
      class="admin-sidebar"
      :class="{ 'is-open': menuOpen }"
      aria-label="后台导航"
      :inert="isCompact && !menuOpen"
    >
      <router-link class="admin-brand" :to="{ name: 'admin-overview' }">
        <span class="brand-mark"><span class="window-symbol" aria-hidden="true"><i></i><i></i></span></span>
        <span>BakaMail<small>邮局管理</small></span>
      </router-link>
      <nav
        class="admin-nav"
        data-height-accordion="true"
        data-accordion-ready="true"
        aria-label="后台功能分类"
      >
        <section
          v-for="group in visibleGroups"
          :key="group.key"
          class="admin-nav-group"
          :class="{ 'is-open': open[group.key] }"
        >
          <button
            class="admin-nav-group__toggle"
            type="button"
            :aria-expanded="open[group.key] ? 'true' : 'false'"
            @click="toggle(group.key)"
          >
            <span class="icon" aria-hidden="true">{{ group.icon }}</span>
            <span><strong>{{ group.label }}</strong><small>{{ group.hint }}</small></span>
            <span class="icon admin-nav-group__chevron" aria-hidden="true">▾</span>
          </button>
          <div class="admin-nav-group__items">
            <div>
              <router-link
                v-for="item in group.items"
                :key="item.name"
                :to="{ name: item.name }"
                :class="{ 'is-current': $route.name === item.name }"
              >
                <span>{{ item.label }}</span>
                <small>{{ item.hint }}</small>
              </router-link>
            </div>
          </div>
        </section>
      </nav>
      <div class="admin-profile">
        <span class="avatar avatar--small">{{ initial }}</span>
        <span><strong>{{ username }}</strong><small>{{ roleLabel }}</small></span>
        <button class="icon-button icon-button--small" type="button" :disabled="logoutBusy" :aria-label="logoutBusy ? '正在退出' : '退出登录'" @click="logout">↗</button>
      </div>
    </aside>
    <div class="admin-workspace">
      <header class="admin-topbar">
        <button
          ref="menuButton"
          class="icon-button admin-menu-button"
          type="button"
          aria-controls="admin-sidebar"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-label="打开后台导航"
          @click="openMenu"
        >
          ☰
        </button>
        <div class="admin-topbar__title">
          <span class="eyebrow">BAKAMAIL ADMIN</span>
          <h1>{{ currentTitle }}</h1>
        </div>
        <div class="admin-topbar__actions">
          <router-link class="button button--soft" to="/mail">返回邮箱</router-link>
        </div>
      </header>
      <main id="main-content" class="admin-main" tabindex="-1">
        <p v-if="logoutError" ref="logoutErrorElement" class="mail-notice admin-logout-error" role="alert" tabindex="-1">
          {{ logoutError }}
          <button class="button button--soft" type="button" :disabled="logoutBusy" @click="logout">重试退出</button>
        </p>
        <section v-if="loading" class="managed-page-card admin-page-state" aria-live="polite">
          正在恢复管理员会话…
        </section>
        <section v-else-if="permissionDenied" class="managed-page-card admin-access-denied" role="alert">
          <div>
            <span class="soft-icon" aria-hidden="true">!</span>
            <h2>当前角色没有此页面权限</h2>
            <p>导航已按权限隐藏不可用功能；如果角色刚刚发生变化，请重新登录后台。</p>
            <router-link class="button button--primary" :to="firstRoute">返回可用页面</router-link>
          </div>
        </section>
        <router-view v-else v-slot="{ Component, route: childRoute }">
          <transition name="admin-panel" mode="out-in" @before-leave="makePanelInert" @after-enter="focusPanel">
            <div :key="String(childRoute.name)" class="admin-route-panel"><component :is="Component" /></div>
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../../api";
import { SessionSupersededError } from "../../auth/sessionRequests";
import { useAdminSessionStore } from "../../stores/adminSession";
import { ADMIN_LOGIN_PATH, ADMIN_PAGE_PATHS } from "../../../../shared/adminPaths";
import { adminLoginDestination } from "../../auth/adminEntryGate";

const router = useRouter();
const route = useRoute();
const session = useAdminSessionStore();
const menuOpen = ref(false);
const logoutBusy = ref(false);
const logoutError = ref("");
const isCompact = ref(false);
const menuButton = ref<HTMLButtonElement | null>(null);
const sidebarElement = ref<HTMLElement | null>(null);
const logoutErrorElement = ref<HTMLElement | null>(null);
let compactQuery: MediaQueryList | null = null;
// Revalidation still runs in the route guard. Keep the authenticated shell and
// current panel intact while it awaits the server; a revoked identity is cleared.
const loading = computed(() => !session.initialized || !session.me);
const username = computed(() => session.me?.displayName || session.me?.username || "管理员");
const role = computed(() => session.me?.role ?? "auditor");
const initial = computed(() => (username.value[0] ?? "?").toUpperCase());
const roleLabel = computed(
  () => ({ superadmin: "超级管理员", admin: "管理员", auditor: "只读审计" })[role.value] ?? role.value,
);

const groups = [
  {
    key: "overview",
    icon: "⌂",
    label: "概览",
    hint: "运行摘要与告警",
    items: [
      { name: "admin-overview", label: "仪表盘", hint: "运行摘要与告警", permission: "mail.account.read" },
    ],
  },
  {
    key: "accounts",
    icon: "☺",
    label: "邮箱管理",
    hint: "账号与邀请制开通",
    items: [
      { name: "admin-accounts", label: "邮箱账号", hint: "账号、容量与密码", permission: "mail.account.read" },
      { name: "admin-invites", label: "邀请码", hint: "邀请制开通入口", permission: "mail.invite.read" },
    ],
  },
  {
    key: "operations",
    icon: "✉",
    label: "邮件运维",
    hint: "队列、日志与域名",
    items: [
      { name: "admin-mail-ops", label: "运维中心", hint: "队列、日志与域名自检", permission: "mail.queue.read" },
    ],
  },
  {
    key: "security",
    icon: "◇",
    label: "安全",
    hint: "策略、会话与审计",
    items: [
      { name: "admin-security", label: "安全中心", hint: "限速、日志与会话", permission: "system.audit.read" },
    ],
  },
  {
    key: "system",
    icon: "⚙",
    label: "系统",
    hint: "管理员与运行设置",
    items: [
      { name: "admin-admins", label: "管理员", hint: "角色与账号", permission: "system.admin.write" },
      { name: "admin-system", label: "系统设置", hint: "运行、备份与权限", permission: "system.admin.write" },
    ],
  },
];

const visibleGroups = computed(() =>
  groups
    .map((group) => ({ ...group, items: group.items.filter((item) => session.can(item.permission)) }))
    .filter((group) => group.items.length > 0),
);

const open = reactive<Record<string, boolean>>({});

function groupForRoute(name: string): string {
  return groups.find((group) => group.items.some((item) => item.name === name))?.key ?? "overview";
}

function persistOpen(key: string): void {
  try {
    localStorage.setItem("bakamail-admin-nav-open", key);
  } catch {
    // localStorage is optional.
  }
}

function toggle(key: string): void {
  const willOpen = !open[key];
  for (const group of groups) open[group.key] = false;
  open[key] = willOpen;
  if (willOpen) persistOpen(key);
}

const titles: Record<string, string> = {
  "admin-overview": "仪表盘",
  "admin-accounts": "邮箱账号",
  "admin-invites": "邀请码",
  "admin-mail-ops": "邮件运维",
  "admin-security": "安全",
  "admin-admins": "管理员",
  "admin-system": "系统设置",
};
const currentTitle = computed(() => titles[String(route.name)] ?? "后台");
const requiredPermission = computed(() => String(route.meta.permission ?? ""));
const permissionDenied = computed(
  () => Boolean(requiredPermission.value && session.initialized && !session.can(requiredPermission.value)),
);
const firstRoute = computed(() => {
  const first = visibleGroups.value[0]?.items[0]?.name;
  return first ? { name: first } : { name: "admin-login" };
});

async function logout(): Promise<void> {
  if (logoutBusy.value) return;
  logoutBusy.value = true;
  logoutError.value = "";
  try {
    await session.logout();
    await router.replace(ADMIN_LOGIN_PATH);
  } catch (error) {
    logoutError.value = error instanceof ApiError
      ? `退出失败：${error.message}。管理员会话仍保留，请重试。`
      : "退出失败，管理员会话仍保留，请重试。";
    await nextTick();
    logoutErrorElement.value?.focus();
  } finally {
    logoutBusy.value = false;
  }
}

function syncCompact(event: MediaQueryListEvent | MediaQueryList): void {
  isCompact.value = event.matches;
  if (!event.matches) menuOpen.value = false;
}

async function openMenu(): Promise<void> {
  menuOpen.value = true;
  await nextTick();
  sidebarElement.value?.querySelector<HTMLElement>("a, button")?.focus();
}

async function closeMenu(returnFocus = true): Promise<void> {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  await nextTick();
  if (returnFocus) menuButton.value?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && menuOpen.value) void closeMenu();
}

function makePanelInert(element: Element): void {
  (element as HTMLElement).inert = true;
}
function focusPanel(element: Element): void {
  if (element.isConnected) document.getElementById('main-content')?.focus({ preventScroll: true });
}

watch(
  () => route.name,
  (name) => {
    const wasOpen = menuOpen.value;
    const key = groupForRoute(String(name ?? ""));
    for (const group of groups) open[group.key] = group.key === key;
    persistOpen(key);
    menuOpen.value = false;
    if (wasOpen) void nextTick(() => document.getElementById("main-content")?.focus());
  },
  { immediate: true },
);

onMounted(async () => {
  document.body.classList.add("admin-body");
  window.addEventListener("keydown", onKeydown);
  compactQuery = window.matchMedia("(max-width: 1180px)");
  syncCompact(compactQuery);
  compactQuery.addEventListener("change", syncCompact);
  try {
    await session.restore();
  } catch (reason) {
    if (reason instanceof SessionSupersededError) return;
    if (reason instanceof ApiError && reason.status === 401) {
      session.clear();
      await router.replace(adminLoginDestination(route.fullPath));
    } else {
      await router.replace({ name: "unavailable", query: { redirect: route.fullPath } });
    }
  }
});

onBeforeUnmount(() => {
  document.body.classList.remove("admin-body");
  window.removeEventListener("keydown", onKeydown);
  compactQuery?.removeEventListener("change", syncCompact);
});
</script>
