import { NavigationFailureType, createRouter, createWebHistory, isNavigationFailure } from "vue-router";
import { beginAdminNavigation, clearAdminNavigation } from "./admin/navigationState";
import { useAdminSessionStore } from "./stores/adminSession";
import { pinia } from "./stores/pinia";
import { useSessionStore } from "./stores/session";
import { checkMailEntry } from "./auth/entryGate";
import { createAdminRoutes } from "./auth/adminRoutes";
import { checkAdminEntry } from "./auth/adminEntryGate";
import { readInstallation } from "./auth/installation";
import { configureAdminPaths } from "../../shared/adminPaths";
import { pageTitleFor } from "./siteInfo";
import { isChunkLoadFailure, reportFatal } from "./errorState";

let installationReady = false;
let configuredAdminBase = "";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "intro", component: () => import("./views/IntroView.vue") },
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
    { path: "/register", name: "register", component: () => import("./views/RegisterView.vue") },
    { path: "/password-reset", name: "password-reset", component: () => import("./views/PasswordResetView.vue") },
    { path: "/unavailable", name: "unavailable", component: () => import("./views/ServiceUnavailableView.vue") },
    { path: "/setup", name: "setup", component: () => import("./views/SetupView.vue") },
    { path: "/mail", meta: { auth: "mail" }, component: () => import("./components/MailWorkspace.vue"), children: [
      { path: "", name: "mail", component: () => import("./views/MailView.vue") },
      { path: "search", name: "mail-search", component: () => import("./views/SearchView.vue") },
      { path: "drafts", name: "mail-drafts", component: () => import("./views/DraftsView.vue") },
      { path: "contacts", name: "mail-contacts", component: () => import("./views/ContactsView.vue") },
      { path: "settings", name: "mail-settings", component: () => import("./views/SettingsView.vue") },
    ] },
    { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("./views/NotFoundView.vue") },
  ],
});

export function installAdminRoutes(base: string): void {
  if (configuredAdminBase === base) return;
  configureAdminPaths(base);
  if (router.hasRoute("admin-login")) router.removeRoute("admin-login");
  if (router.hasRoute("admin-workspace-root")) router.removeRoute("admin-workspace-root");
  for (const record of createAdminRoutes(base)) router.addRoute(record);
  configuredAdminBase = base;
}

export function finishInstallation(base: string): void {
  installationReady = true;
  installAdminRoutes(base);
}

// 第一个守卫是同步的：点击菜单的那一刻就记下目标，菜单高亮和右侧加载动画立刻响应（后台和邮箱都一样），
// 服务端校验（下面的守卫）要几百毫秒到几秒，期间右侧保留旧页面。
router.beforeEach((to, from) => {
  if ((to.meta.auth === "admin" || to.meta.auth === "mail") && to.fullPath !== from.fullPath) beginAdminNavigation(to.name, to.fullPath);
  return true;
});

/** 后台页面之间切换时，入口路径最多每分钟向服务端确认一次；身份校验仍然每次都做。 */
const ENTRY_RECHECK_MS = 60_000;
let entryCheckedAt = 0;

router.beforeEach(async (to, from) => {
  const reuseEntryCheck = to.meta.auth === "admin" && from.meta.auth === "admin" && installationReady
    && Date.now() - entryCheckedAt < ENTRY_RECHECK_MS;
  // Fail closed on unavailable status, never render a fresh admin form on assumed defaults.
  if (!reuseEntryCheck && to.name !== "unavailable" && (!installationReady || to.name === "setup" || to.meta.auth === "admin" || to.name === "not-found" || to.name === "admin-login")) {
    try {
      const status = await readInstallation(to.path, AbortSignal.timeout(15_000));
      if (!status.initialized) return to.name === "setup" ? true : { name: "setup", replace: true };
      installationReady = true;
      entryCheckedAt = Date.now();
      if (status.entry && status.entry.adminBase !== configuredAdminBase) {
        installAdminRoutes(status.entry.adminBase);
        return { path: to.fullPath, replace: true };
      }
      if (to.name === "setup") return { name: "intro", replace: true };
      if ((to.meta.auth === "admin" || to.name === "admin-login") && !status.entry) return { name: "not-found", params: { pathMatch: to.path.slice(1).split("/") }, replace: true };
    } catch {
      return { name: "unavailable", query: { redirect: to.fullPath }, replace: true };
    }
  }
  if (to.meta.auth === "mail" || to.name === "intro") {
    const session = useSessionStore(pinia);
    const result = await checkMailEntry(() => session.restore(true), () => session.clear(), to.name === "intro", to.fullPath);
    if (result !== true) return result;
  }
  if (to.meta.auth === "admin") {
    const session = useAdminSessionStore(pinia);
    return checkAdminEntry(() => session.restore(true), () => session.clear(), to.fullPath);
  }
  return true;
});

router.onError((error) => {
  clearAdminNavigation();
  // 页面文件没能加载（网络中断，或刚发布过新版本）：显示统一风格的提示，由用户决定何时重新加载。
  if (isChunkLoadFailure(error)) reportFatal("route chunk load failed");
});

// 成功完成的导航一定是最新的一次；被新导航取代（cancelled）的不清，新导航自己会设置。
router.afterEach((_to, _from, failure) => {
  if (!failure || !isNavigationFailure(failure, NavigationFailureType.cancelled)) clearAdminNavigation();
});

router.afterEach((to) => {
  document.title = pageTitleFor(to.name);
  scheduleSessionCheck();
});

let sessionTimer: ReturnType<typeof setTimeout> | undefined;
async function recheckSession(): Promise<void> {
  const current = router.currentRoute.value;
  if (current.meta.auth !== "mail") return;
  const session = useSessionStore(pinia);
  const result = await checkMailEntry(() => session.restore(true), () => session.clear(), false, current.fullPath);
  // A navigation in flight owns its own guard; never redirect a newer page.
  if (router.currentRoute.value !== current || result === false) return;
  if (result !== true) await router.replace(result);
  else scheduleSessionCheck();
}
function scheduleSessionCheck(): void {
  clearTimeout(sessionTimer);
  if (router.currentRoute.value.meta.auth !== "mail") return;
  const expires = Date.parse(useSessionStore(pinia).expiresAt);
  const delay = Number.isFinite(expires) ? Math.max(1000, Math.min(30_000, expires - Date.now() + 100)) : 30_000;
  sessionTimer = setTimeout(() => { void recheckSession(); }, delay);
}
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => { void recheckSession(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void recheckSession();
  });
}
