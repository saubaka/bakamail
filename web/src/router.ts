import { createRouter, createWebHistory } from "vue-router";
import { useAdminSessionStore } from "./stores/adminSession";
import { pinia } from "./stores/pinia";
import { useSessionStore } from "./stores/session";
import { checkMailEntry } from "./auth/entryGate";
import { createAdminRoutes } from "./auth/adminRoutes";
import { checkAdminEntry } from "./auth/adminEntryGate";
import { readInstallation } from "./auth/installation";
import { configureAdminPaths } from "../../shared/adminPaths";

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

router.beforeEach(async (to) => {
  // Fail closed on unavailable status, never render a fresh admin form on assumed defaults.
  if (to.name !== "unavailable" && (!installationReady || to.name === "setup" || to.meta.auth === "admin" || to.name === "not-found" || to.name === "admin-login")) {
    try {
      const status = await readInstallation(to.path, AbortSignal.timeout(15_000));
      if (!status.initialized) return to.name === "setup" ? true : { name: "setup", replace: true };
      installationReady = true;
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

router.afterEach(() => {
  document.title = "Baka Mail";
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
