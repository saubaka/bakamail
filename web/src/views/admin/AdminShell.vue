<template>
  <div class="admin-shell has-rail" :class="{ 'is-collapsed': railCollapsed }" :inert="paletteOpen">
    <button
      class="admin-drawer-backdrop"
      :class="{ 'is-open': menuOpen }"
      type="button"
      tabindex="-1"
      aria-label="关闭后台导航"
      @click="closeMenu()"
    ></button>
    <AdminRail
      ref="railElement"
      :sections="sections"
      :current="String(route.name ?? '')"
      :badges="badges"
      :collapsed="railCollapsed"
      :open="menuOpen"
      :compact="isCompact"
      :username="username"
      :role-label="roleLabel"
      :initial="initial"
      :logout-busy="logoutBusy"
      @toggle-collapse="toggleCollapsed"
      @palette="openPalette"
      @logout="logout"
      @navigate="onRailNavigate"
    />
    <div class="admin-workspace" :inert="menuOpen && isCompact">
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
          <AdminIcon name="panel" :size="20" />
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
    <AdminCommandPalette v-model:open="paletteOpen" :entries="paletteEntries" @run="runPaletteEntry" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../../api";
import { SessionSupersededError } from "../../auth/sessionRequests";
import { useAdminSessionStore } from "../../stores/adminSession";
import { ADMIN_LOGIN_PATH } from "../../../../shared/adminPaths";
import { adminLoginDestination } from "../../auth/adminEntryGate";
import AdminRail from "../../components/admin/AdminRail.vue";
import AdminIcon from "../../components/admin/AdminIcon.vue";
import AdminCommandPalette, { type PaletteEntry } from "../../components/admin/AdminCommandPalette.vue";
import { PAGE_TITLES, RAIL_SECTIONS, railSections } from "../../admin/navModel";
import { resolveShortcut } from "../../admin/shortcuts";
import { decideSwipe } from "../../admin/railSwipe";
import { useRailBadges } from "../../admin/useRailBadges";

const router = useRouter();
const route = useRoute();
const session = useAdminSessionStore();
const menuOpen = ref(false);
const paletteOpen = ref(false);
const logoutBusy = ref(false);
const logoutError = ref("");
const isCompact = ref(false);
const collapsed = ref(readCollapsed());
const menuButton = ref<HTMLButtonElement | null>(null);
const railElement = ref<InstanceType<typeof AdminRail> | null>(null);
const logoutErrorElement = ref<HTMLElement | null>(null);
let compactQuery: MediaQueryList | null = null;
let armedUntil = 0;
let touchStart: { x: number; y: number } | null = null;
const { badges, start: startBadges, refresh: refreshBadges } = useRailBadges();

// Revalidation still runs in the route guard. Keep the authenticated shell and
// current panel intact while it awaits the server; a revoked identity is cleared.
const loading = computed(() => !session.initialized || !session.me);
const username = computed(() => session.me?.displayName || session.me?.username || "管理员");
const role = computed(() => session.me?.role ?? "auditor");
const initial = computed(() => (username.value[0] ?? "?").toUpperCase());
const roleLabel = computed(
  () => ({ superadmin: "超级管理员", admin: "管理员", auditor: "只读审计" })[role.value] ?? role.value,
);

const sections = computed(() => railSections((permission) => session.can(permission)));
const flatItems = computed(() => sections.value.flatMap((section) => section.items));
const railCollapsed = computed(() => collapsed.value && !isCompact.value);

const paletteEntries = computed<PaletteEntry[]>(() => {
  const labelOf = (key: string) => RAIL_SECTIONS.find((section) => section.key === key)?.label ?? "";
  const entries: PaletteEntry[] = flatItems.value.map((item) => ({
    id: `page:${item.name}`,
    label: item.label,
    icon: item.icon,
    keywords: item.keywords,
    group: labelOf(item.section),
    shortcut: `g ${item.shortcut}`,
  }));
  entries.push({ id: "action:mail", label: "返回邮箱", icon: "mail", keywords: "fhyx mail inbox back 邮件 收件箱" });
  if (!isCompact.value) entries.push({ id: "action:rail", label: collapsed.value ? "展开侧栏" : "收起侧栏", icon: "panel", keywords: "cl sidebar rail collapse expand 菜单 折叠" });
  entries.push({ id: "action:logout", label: "退出登录", icon: "logout", keywords: "tcdl logout signout 退出 注销", danger: true });
  return entries;
});

const currentTitle = computed(() => PAGE_TITLES[String(route.name)] ?? "后台");
const requiredPermission = computed(() => String(route.meta.permission ?? ""));
const permissionDenied = computed(
  () => Boolean(requiredPermission.value && session.initialized && !session.can(requiredPermission.value)),
);
const firstRoute = computed(() => {
  const first = flatItems.value[0]?.name;
  return first ? { name: first } : { name: "admin-login" };
});

function readCollapsed(): boolean {
  try { return localStorage.getItem("bakamail-admin-rail") === "collapsed"; } catch { return false; }
}
function toggleCollapsed(): void {
  collapsed.value = !collapsed.value;
  try { localStorage.setItem("bakamail-admin-rail", collapsed.value ? "collapsed" : "expanded"); } catch { /* optional */ }
}

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
  railElement.value?.focusFirst();
}

async function closeMenu(returnFocus = true): Promise<void> {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  await nextTick();
  if (returnFocus) menuButton.value?.focus();
}

/** 点了菜单里的链接：手机抽屉随即收起，焦点交给下面的页面。 */
function onRailNavigate(): void {
  if (isCompact.value) void closeMenu(false);
}

function openPalette(): void {
  menuOpen.value = false;
  paletteOpen.value = true;
}

function runPaletteEntry(id: string): void {
  if (id.startsWith("page:")) { void router.push({ name: id.slice(5) }); return; }
  if (id === "action:mail") void router.push("/mail");
  else if (id === "action:rail") toggleCollapsed();
  else if (id === "action:logout") void logout();
}

function modalOpen(): boolean {
  return Boolean(document.querySelector("dialog[open], .modal[open]"));
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && menuOpen.value) { void closeMenu(); return; }
  if (loading.value || permissionDenied.value || paletteOpen.value || modalOpen()) return;
  const result = resolveShortcut(event, (permission) => session.can(permission), armedUntil, Date.now());
  armedUntil = result.armedUntil;
  if (result.type === "palette") { event.preventDefault(); openPalette(); }
  else if (result.type === "go") {
    event.preventDefault();
    if (route.name !== result.name) void router.push({ name: result.name });
  }
}

function onTouchStart(event: TouchEvent): void {
  const point = event.touches[0];
  touchStart = isCompact.value && event.touches.length === 1 && point ? { x: point.clientX, y: point.clientY } : null;
}
function onTouchEnd(event: TouchEvent): void {
  const start = touchStart;
  touchStart = null;
  const point = event.changedTouches[0];
  if (!start || !point || paletteOpen.value) return;
  const decision = decideSwipe(start, { x: point.clientX, y: point.clientY }, menuOpen.value);
  if (decision === "open") void openMenu();
  else if (decision === "close") void closeMenu(false);
}

function makePanelInert(element: Element): void {
  (element as HTMLElement).inert = true;
}
function focusPanel(element: Element): void {
  if (element.isConnected) document.getElementById('main-content')?.focus({ preventScroll: true });
}

watch(
  () => route.name,
  () => {
    const wasOpen = menuOpen.value;
    menuOpen.value = false;
    void refreshBadges();
    if (wasOpen) void nextTick(() => document.getElementById("main-content")?.focus());
  },
);

// 会话由路由守卫或本组件恢复都可能先完成，所以只看“身份已就绪”这个结果，就绪后才开始取角标。
watch(() => session.me, (me) => { if (me) startBadges(); }, { immediate: true });

watch(() => menuOpen.value && isCompact.value, (locked) => document.body.classList.toggle("admin-rail-open", locked));

onMounted(async () => {
  document.body.classList.add("admin-body");
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  compactQuery = window.matchMedia("(max-width: 900px)");
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
  document.body.classList.remove("admin-body", "admin-rail-open");
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("touchstart", onTouchStart);
  window.removeEventListener("touchend", onTouchEnd);
  compactQuery?.removeEventListener("change", syncCompact);
});
</script>
