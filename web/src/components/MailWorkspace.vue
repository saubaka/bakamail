<template>
  <div class="mail-workspace" :class="{ 'is-desktop-layout': isDesktop, 'is-desktop-sidebar-expanded': isDesktop && desktopSidebarExpanded }" :data-navigation-mode="isDesktop ? 'desktop' : 'mobile'" :data-panel-direction="panelDirection" @keydown="handleKey">
    <header class="workspace-header">
      <button
        v-if="isDesktop"
        ref="desktopSidebarToggle"
        class="desktop-sidebar-toggle"
        type="button"
        aria-controls="mail-navigation-panel"
        :aria-expanded="desktopSidebarExpanded"
        :aria-label="desktopSidebarExpanded ? '折叠邮箱菜单' : '展开邮箱菜单'"
        @click="toggleDesktopSidebar"
      >
        <svg class="desktop-sidebar-toggle-icon" :class="{ 'is-expanded': desktopSidebarExpanded }" viewBox="0 0 24 24" aria-hidden="true">
          <path class="desktop-sidebar-toggle-icon__top" d="M5 7h14" />
          <path class="desktop-sidebar-toggle-icon__middle" d="M5 12h14" />
          <path class="desktop-sidebar-toggle-icon__bottom" d="M5 17h14" />
        </svg>
      </button>
      <span class="workspace-brand" aria-label="BakaMail">bakamail</span>
      <span v-if="isDesktop" class="workspace-header-spacer" aria-hidden="true"></span>
    </header>
    <button v-if="!isDesktop && menuOpen && !closing" class="dock-backdrop" type="button" aria-label="关闭悬浮菜单" tabindex="-1" @click="closeMenu()" />
    <div class="workspace-body">
      <section
        v-show="isDesktop || menuOpen"
        id="mail-navigation-panel"
        ref="panel"
        class="dock-menu"
        :inert="isDesktop ? undefined : (!menuOpen || closing)"
        :class="{ 'is-closing': !isDesktop && closing, 'is-desktop-sidebar': isDesktop }"
        :style="isDesktop ? undefined : panelStyle"
        :role="isDesktop ? 'complementary' : 'dialog'"
        :aria-modal="!isDesktop && menuOpen ? 'true' : undefined"
        aria-label="邮箱菜单"
        @animationend="finishClose"
      >
        <LineOutline v-if="!isDesktop" />
        <header v-if="!isDesktop" class="dock-menu-heading"><span>邮箱菜单</span><button ref="closeButton" class="dock-close" type="button" aria-label="关闭悬浮菜单" @click="closeMenu()">×</button></header>
        <div class="dock-menu-scroll">
          <button v-press-feedback class="dock-compose" type="button" :disabled="navigationBusy" :title="collapsedTitle('写邮件')" @click="compose">
            <span class="dock-compose-icon" aria-hidden="true">＋</span><span class="desktop-sidebar-label">写邮件</span>
          </button>
          <nav ref="navigationList" class="dock-navigation" aria-label="邮箱功能">
            <span class="dock-navigation-highlight" :class="{ 'is-line-shifting': lineShifting, 'is-ready': navigationHighlight.ready }" aria-hidden="true" :style="navigationHighlightStyle"><LineOutline /></span>
            <button v-for="item in mailNavigation" :key="item.path" class="dock-navigation-item" type="button" :aria-current="route.path === item.path ? 'page' : undefined" :disabled="!isDesktop && navigationBusy" :title="collapsedTitle(item.label)" @click="navigate(item.path)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.icon" /></svg><span class="desktop-sidebar-label">{{ item.label }}</span>
            </button>
          </nav>
          <button
            v-if="isDesktop"
            class="desktop-folder-trigger"
            :class="{ 'is-hidden': desktopSidebarExpanded }"
            type="button"
            aria-controls="mail-folder-host"
            :aria-label="collapsedFolderLabel"
            :aria-hidden="desktopSidebarExpanded ? 'true' : undefined"
            :tabindex="desktopSidebarExpanded ? -1 : undefined"
            :disabled="!isDesktop && navigationBusy"
            title="文件夹"
            @click="openDesktopFolders"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>
            <span v-if="folderUnreadLabel" class="desktop-folder-count" aria-hidden="true">{{ folderUnreadLabel }}</span>
          </button>
          <div
            id="mail-folder-host"
            class="dock-folder-host"
            :inert="isDesktop && !desktopSidebarExpanded ? true : undefined"
            :aria-hidden="isDesktop && !desktopSidebarExpanded ? 'true' : undefined"
          />
        </div>
        <footer class="dock-account">
          <div class="dock-account-identity">
            <span class="dock-account-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M5 21v-2a7 7 0 0 1 14 0v2" /></svg></span>
            <div class="dock-account-copy"><span>{{ actions?.liveLabel.value ?? '邮箱工具' }}</span><strong>{{ session.mailbox }}</strong></div>
          </div>
          <button class="dock-signout" type="button" :disabled="navigationBusy || logoutBusy || actions?.logoutBusy.value" :title="collapsedTitle('退出登录')" aria-label="退出登录" @click="logout">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></svg><span class="desktop-sidebar-label">退出</span>
          </button>
        </footer>
      </section>
      <div class="workspace-content" :inert="!isDesktop && menuOpen && !closing" :aria-busy="navigationBusy" @scroll.capture="captureScroll">
        <router-view v-slot="{ Component, route: childRoute }">
          <transition name="mail-panel" @before-enter="beginPanelTransition" @after-enter="finishPanelTransition" @enter-cancelled="cancelPanelTransition" @before-leave="makePanelInert">
            <div :key="String(childRoute.name)" class="workspace-route-panel"><component :is="Component" /></div>
          </transition>
        </router-view>
      </div>
    </div>
    <footer class="workspace-copyright">© {{ new Date().getFullYear() }} BakaMail · 由 Saubaka 开发</footer>
    <span class="workspace-route-status" role="status" aria-live="polite" aria-atomic="true">{{ routeAnnouncement }}</span>
    <button v-if="!isDesktop && dockHidden && !menuOpen" class="dock-reveal" type="button" aria-label="显示邮箱导航" @click="revealDock"><span aria-hidden="true"></span></button>
    <nav v-if="!isDesktop" class="mail-bottom-dock" :class="{ 'is-scroll-hidden': dockHidden && !menuOpen }" :inert="dockHidden && !menuOpen" :aria-hidden="dockHidden && !menuOpen" aria-label="邮箱底部导航" @focusin="revealDock">
      <span class="dock-active-pill" :class="{ 'is-line-shifting': lineShifting }" aria-hidden="true" :style="{ transform: `translateX(${dockIndex * 84}px)` }"><LineOutline /></span>
      <button ref="menuTrigger" class="dock-item" type="button" aria-controls="mail-navigation-panel" :aria-expanded="menuOpen" @click="menuOpen ? closeMenu() : openMenu()">菜单</button>
      <button class="dock-item" :class="{ 'is-current': dockIndex === 1 }" type="button" :disabled="navigationBusy" @click="showList">列表</button>
      <button class="dock-item" :class="{ 'is-current': dockIndex === 2 }" type="button" :disabled="navigationBusy" @click="showReader">正文</button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError, toast } from "../api";
import { useMailboxStore } from "../stores/mailbox";
import { useSessionStore } from "../stores/session";
import { mailNavigation, navigationIndex, panelNavigationDirection, workspaceKey, type PanelNavigationDirection, type WorkbenchActions } from "../mail/workspace";
import {
  MAIL_DESKTOP_QUERY,
  MAIL_WIDE_QUERY,
  compactUnreadCount,
  readDesktopSidebarPreference,
  resolveDesktopSidebarExpanded,
  writeDesktopSidebarPreference,
  type DesktopSidebarPreference,
} from "../mail/navigationLayout";
import { createDockScrollIntent, type ScrollPosition } from '../mail/scrollIntent';
import LineOutline from './LineOutline.vue';
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const mailbox = useMailboxStore();
const actions = shallowRef<WorkbenchActions | null>(null);
const view = ref<"list" | "reader">("list");
const initialPreference = readDesktopSidebarPreference();
const initialDesktop = typeof window !== "undefined" && window.matchMedia(MAIL_DESKTOP_QUERY).matches;
const initialWide = typeof window !== "undefined" && window.matchMedia(MAIL_WIDE_QUERY).matches;
const isDesktop = ref(initialDesktop);
const desktopSidebarPreference = ref<DesktopSidebarPreference | null>(initialPreference);
const desktopSidebarExpanded = ref(resolveDesktopSidebarExpanded(initialWide, initialPreference));
const dockHidden = ref(false);
const scrollIntent = createDockScrollIntent();
const scrollIds = new WeakMap<Element, number>(); let nextScrollId = 0;
function revealDock() { scrollIntent.reset(); dockHidden.value = false; }
function reportScroll(position: ScrollPosition, source: string) { if (!isDesktop.value && !menuOpen.value) dockHidden.value = scrollIntent.update(source, position); }
function captureScroll(event: Event) {
  const element = event.target as HTMLElement;
  if (!(element instanceof HTMLElement) || element.scrollHeight <= element.clientHeight) return;
  if (!scrollIds.has(element)) scrollIds.set(element, ++nextScrollId);
  reportScroll({ top: Math.max(0,element.scrollTop), height:element.clientHeight, total:element.scrollHeight }, `surface:${scrollIds.get(element)}`);
}
async function showReader() {
  revealDock();
  await closeMenu(false);
  if (!actions.value?.readerAvailable?.value) { toast('请先从列表选择一封邮件', 'warning'); return; }
  view.value = 'reader';
}
const menuOpen = ref(false);
const closing = ref(false);
const navigating = ref(false);
let navigationGeneration = 0;
const transitioning = ref(false);
const navigationBusy = computed(() => navigating.value || transitioning.value);
const logoutBusy = ref(false);
const menuTrigger = ref<HTMLButtonElement | null>(null);
const desktopSidebarToggle = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const navigationList = ref<HTMLElement | null>(null);
const menuLeft = ref(16);
const menuWidth = ref(360);
const origin = ref(44);
const selectedIndex = computed(() => navigationIndex(route.path));
const dockIndex = computed(() => menuOpen.value || route.path !== "/mail" ? 0 : view.value === "reader" ? 2 : 1);
const lineShifting = ref(false);
const navigationHighlight = ref({ x: 0, y: 0, width: 0, height: 0, ready: false });
const navigationHighlightStyle = computed(() => ({
  width: `${navigationHighlight.value.width}px`,
  height: `${navigationHighlight.value.height}px`,
  transform: `translate3d(${navigationHighlight.value.x}px,${navigationHighlight.value.y}px,0)`,
}));
const panelDirection = ref<PanelNavigationDirection>("neutral");
const routeAnnouncement = ref("");
const folderUnreadCount = computed(() => mailbox.folders.reduce((total, folder) => total + Math.max(0, Math.floor(folder.unseen || 0)), 0));
const folderUnreadLabel = computed(() => compactUnreadCount(folderUnreadCount.value));
const collapsedFolderLabel = computed(() => folderUnreadCount.value > 0 ? `展开文件夹，${folderUnreadCount.value} 封未读` : "展开文件夹");
let lineTimer: ReturnType<typeof setTimeout> | undefined;
let lineFrame = 0;
let navigationMeasureFrame = 0;
let folderFocusFrame = 0;
let navigationResizeObserver: ResizeObserver | undefined;
function pulseNavigationLine() {
  clearTimeout(lineTimer); cancelAnimationFrame(lineFrame); lineShifting.value=false;
  if(reduced()) return;
  lineFrame=requestAnimationFrame(()=>{lineShifting.value=true;lineTimer=setTimeout(()=>{lineShifting.value=false;},440);});
}
function measureNavigationHighlight() {
  cancelAnimationFrame(navigationMeasureFrame);
  navigationMeasureFrame = requestAnimationFrame(() => {
    const list = navigationList.value;
    const current = list?.querySelector<HTMLElement>('.dock-navigation-item[aria-current="page"]');
    if (!list || !current || current.offsetWidth === 0 || current.offsetHeight === 0) {
      navigationHighlight.value = { ...navigationHighlight.value, ready: false };
      return;
    }
    navigationHighlight.value = {
      x: current.offsetLeft,
      y: current.offsetTop,
      width: current.offsetWidth,
      height: current.offsetHeight,
      ready: true,
    };
  });
}
function scheduleNavigationHighlight() { void nextTick(measureNavigationHighlight); }
watch([dockIndex,selectedIndex], () => { pulseNavigationLine(); scheduleNavigationHighlight(); });
watch(desktopSidebarExpanded, () => { pulseNavigationLine(); scheduleNavigationHighlight(); });
const panelStyle = computed(() => ({ left: `${menuLeft.value}px`, width: `${menuWidth.value}px`, "--menu-origin-x": `${origin.value}px` }));
let resolveClose: (() => void) | undefined;
let closeFlight: Promise<void> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let overflowBefore = "";
let bodyScrollLocked = false;
let desktopQuery: MediaQueryList | undefined;
let wideQuery: MediaQueryList | undefined;
let pendingFolderFocus = false;
function focusMain(scope?: Element) {
  if (pendingFolderFocus) {
    pendingFolderFocus = false;
    scheduleFolderFocus();
    return;
  }
  const target = scope?.querySelector<HTMLElement>("#main-content")
    ?? document.querySelector<HTMLElement>('.workspace-route-panel:not(.mail-panel-leave-active) #main-content');
  target?.focus({ preventScroll: true });
}
function reduced() { const root = document.documentElement; return root.dataset.motion === "reduce" || root.dataset.performance === "low" || matchMedia("(prefers-reduced-motion: reduce)").matches; }
function openMenu() {
  revealDock();
  if (isDesktop.value) { setDesktopSidebarExpanded(true); return; }
  if (menuOpen.value || navigationBusy.value) return;
  const rect = menuTrigger.value?.getBoundingClientRect();
  const center = rect ? rect.left + rect.width / 2 : innerWidth / 2 - 84;
  menuWidth.value = Math.min(360, innerWidth - 32);
  menuLeft.value = Math.max(16, Math.min(innerWidth - menuWidth.value - 16, center - menuWidth.value / 2));
  origin.value = center - menuLeft.value;
  menuOpen.value = true;
  void nextTick(() => requestAnimationFrame(() => { measureNavigationHighlight(); closeButton.value?.focus(); }));
}
function finishClose(event?: AnimationEvent) {
  if (event && (event.target !== panel.value || event.animationName !== "dock-menu-out")) return;
  if (!closing.value) return;
  clearTimeout(closeTimer);
  menuOpen.value = false; closing.value = false;
  resolveClose?.(); resolveClose = undefined; closeFlight = undefined;
}
function lockBodyScroll() {
  if (bodyScrollLocked) return;
  overflowBefore = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  bodyScrollLocked = true;
}
function unlockBodyScroll() {
  if (!bodyScrollLocked) return;
  document.body.style.overflow = overflowBefore;
  bodyScrollLocked = false;
}
function resetFloatingMenuForViewport() {
  const activeInside = panel.value?.contains(document.activeElement);
  clearTimeout(closeTimer);
  menuOpen.value = false;
  closing.value = false;
  resolveClose?.();
  resolveClose = undefined;
  closeFlight = undefined;
  unlockBodyScroll();
  if (activeInside) void nextTick(() => menuTrigger.value?.focus({ preventScroll: true }));
}
function setDesktopSidebarExpanded(expanded: boolean) {
  desktopSidebarExpanded.value = expanded;
  desktopSidebarPreference.value = expanded ? "expanded" : "collapsed";
  writeDesktopSidebarPreference(expanded);
}
function toggleDesktopSidebar() {
  setDesktopSidebarExpanded(!desktopSidebarExpanded.value);
  void nextTick(() => desktopSidebarToggle.value?.focus({ preventScroll: true }));
}
function scheduleFolderFocus(attempt = 0) {
  cancelAnimationFrame(folderFocusFrame);
  folderFocusFrame = requestAnimationFrame(() => {
    const host = document.getElementById("mail-folder-host");
    const target = host?.querySelector<HTMLElement>('.folder-item[aria-current="page"]')
      ?? host?.querySelector<HTMLElement>(".folder-item")
      ?? host?.querySelector<HTMLElement>("button");
    if (target) target.focus({ preventScroll: true });
    else if (attempt < 2) scheduleFolderFocus(attempt + 1);
  });
}
async function openDesktopFolders() {
  setDesktopSidebarExpanded(true);
  const changingRoute = route.path !== "/mail";
  if (changingRoute) {
    pendingFolderFocus = true;
    try { await navigate("/mail"); }
    catch (error) { pendingFolderFocus = false; throw error; }
  }
  await nextTick();
  if (!changingRoute) scheduleFolderFocus();
}
function collapsedTitle(label: string) {
  return isDesktop.value && !desktopSidebarExpanded.value ? label : undefined;
}
function syncResponsiveNavigation() {
  if (!desktopQuery || !wideQuery) return;
  const nextDesktop = desktopQuery.matches;
  const changedMode = nextDesktop !== isDesktop.value;
  isDesktop.value = nextDesktop;
  if (desktopSidebarPreference.value === null) {
    desktopSidebarExpanded.value = resolveDesktopSidebarExpanded(wideQuery.matches, null);
  }
  if (changedMode) resetFloatingMenuForViewport();
  scheduleNavigationHighlight();
}
async function closeMenu(restoreFocus = true): Promise<void> {
  if (!menuOpen.value) return;
  if (!closeFlight) {
    closeFlight = new Promise<void>(resolve => { resolveClose = resolve; });
    closing.value = true;
    closeTimer = setTimeout(() => finishClose(), reduced() ? 0 : 260);
  }
  await closeFlight;
  if (restoreFocus) await nextTick(() => menuTrigger.value?.focus());
}
async function navigate(path: string) {
  if (!isDesktop.value && navigationBusy.value) return;
  if (path !== "/mail") pendingFolderFocus = false;
  const generation = ++navigationGeneration;
  navigating.value = true;
  try {
    await closeMenu(false);
    if (generation !== navigationGeneration) return;
    if (route.path !== path || isDesktop.value) await router.push(path);
    else focusMain();
  } finally {
    if (generation === navigationGeneration) navigating.value = false;
  }
}
function beginPanelTransition() { transitioning.value = true; }
function makePanelInert(element: Element) {
  element.setAttribute("inert", "");
  (element as HTMLElement).inert = true;
}
function finishPanelTransition(element: Element) {
  if (!element.isConnected || element.classList.contains('mail-panel-leave-active')) return;
  transitioning.value = false;
  const label = mailNavigation.find(item => item.path === route.path)?.label ?? "邮箱";
  routeAnnouncement.value = `${label}页面已打开`;
  focusMain(element);
}
function cancelPanelTransition() { transitioning.value = false; }
async function showList() { revealDock(); await closeMenu(false); if (route.path !== "/mail") await navigate("/mail"); view.value = "list"; }
async function compose() {
  const restoreToMobileTrigger = !isDesktop.value;
  await closeMenu(false);
  if (restoreToMobileTrigger) menuTrigger.value?.focus({ preventScroll: true });
  if (actions.value) actions.value.compose();
  else await router.push({ path: "/mail", query: { compose: "new" } });
}
async function logout() {
  if (logoutBusy.value) return;
  await closeMenu(false);
  if (actions.value) { await actions.value.logout(); return; }
  logoutBusy.value = true;
  try { await session.logout(); await router.push("/"); }
  catch (error) { toast(error instanceof ApiError ? error.message : "退出失败，请重试", "error"); }
  finally { logoutBusy.value = false; }
}
function handleKey(event: KeyboardEvent) {
  if (!menuOpen.value || closing.value) return;
  if (event.key === "Escape") { event.preventDefault(); void closeMenu(); return; }
  if (event.key !== "Tab" || isDesktop.value) return;
  const items = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]') ?? []),...(menuTrigger.value?.parentElement?.querySelectorAll<HTMLElement>('button:not(:disabled)')??[])].filter(el => el.getClientRects().length > 0);
  const first = items[0]; const last = items.at(-1);
  if (!items.includes(document.activeElement as HTMLElement)) { event.preventDefault(); first?.focus(); }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
provide(workspaceKey, { actions, view, isDesktop, desktopSidebarExpanded, setDesktopSidebarExpanded, openMenu, closeMenu: () => closeMenu(false), reportScroll });
watch([menuOpen, isDesktop], ([open, desktop]) => { if (open && !desktop) lockBodyScroll(); else unlockBodyScroll(); });
watch(() => route.path, (nextPath, previousPath) => {
  panelDirection.value = panelNavigationDirection(previousPath, nextPath);
  revealDock();
  view.value = "list";
  if (menuOpen.value) void closeMenu(false);
});
onMounted(() => {
  desktopQuery = window.matchMedia(MAIL_DESKTOP_QUERY);
  wideQuery = window.matchMedia(MAIL_WIDE_QUERY);
  syncResponsiveNavigation();
  desktopQuery.addEventListener("change", syncResponsiveNavigation);
  wideQuery.addEventListener("change", syncResponsiveNavigation);
  if (typeof ResizeObserver !== "undefined") {
    navigationResizeObserver = new ResizeObserver(measureNavigationHighlight);
    if (navigationList.value) navigationResizeObserver.observe(navigationList.value);
  }
  window.addEventListener("resize", measureNavigationHighlight, { passive: true });
  scheduleNavigationHighlight();
});
onBeforeUnmount(() => {
  clearTimeout(closeTimer);
  clearTimeout(lineTimer);
  cancelAnimationFrame(lineFrame);
  cancelAnimationFrame(navigationMeasureFrame);
  cancelAnimationFrame(folderFocusFrame);
  pendingFolderFocus = false;
  desktopQuery?.removeEventListener("change", syncResponsiveNavigation);
  wideQuery?.removeEventListener("change", syncResponsiveNavigation);
  navigationResizeObserver?.disconnect();
  window.removeEventListener("resize", measureNavigationHighlight);
  resolveClose?.();
  unlockBodyScroll();
});
</script>
