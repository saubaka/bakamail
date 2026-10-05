/** Page paths only. The authenticated /api/admin namespace is deliberately unchanged. */
export const LEGACY_ADMIN_BASE = "/bakaadmin";
const reserved = new Set(["admin", "api", "assets", "setup", "login", "register", "password-reset", "mail", "unavailable", "test"]);

/** A literal, single lowercase segment: never accept URLs, encoding or path normalization. */
export function adminPathProblem(value: unknown): string {
  if (typeof value !== "string" || !/^\/[a-z][a-z0-9_-]{2,47}$/.test(value)) return "路径需为 / 开头的 3–48 位小写字母、数字、短横线或下划线，首位为字母";
  if (reserved.has(value.slice(1))) return "该路径与现有页面或接口冲突，请换一个名称";
  return "";
}

export function adminPagePaths(base: string) {
  if (adminPathProblem(base)) throw new TypeError("Invalid admin page base");
  return {
    overview: `${base}/overview`, accounts: `${base}/accounts`, invites: `${base}/invites`,
    mailOps: `${base}/mail-ops`, security: `${base}/security`, admins: `${base}/admins`, system: `${base}/system`,
  };
}

// Browser-only binding; server operations always pass their database-backed base explicitly.
export let ADMIN_LOGIN_PATH = LEGACY_ADMIN_BASE;
export const ADMIN_PAGE_PATHS = {
  overview: `${ADMIN_LOGIN_PATH}/overview`,
  accounts: `${ADMIN_LOGIN_PATH}/accounts`,
  invites: `${ADMIN_LOGIN_PATH}/invites`,
  mailOps: `${ADMIN_LOGIN_PATH}/mail-ops`,
  security: `${ADMIN_LOGIN_PATH}/security`,
  admins: `${ADMIN_LOGIN_PATH}/admins`,
  system: `${ADMIN_LOGIN_PATH}/system`,
};

export function configureAdminPaths(base: string): void {
  if (adminPathProblem(base)) throw new TypeError("Invalid admin page base");
  ADMIN_LOGIN_PATH = base;
  Object.assign(ADMIN_PAGE_PATHS, adminPagePaths(base));
}


/** Accept registered, literal same-origin page paths, never an arbitrary prefix. */
export function safeAdminDestination(value: unknown, allowLogin = false, base = ADMIN_LOGIN_PATH): string {
  const paths = adminPagePaths(base);
  const fallback = paths.overview;
  const pagePaths = new Set<string>(Object.values(paths));
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u0020\u007f]/.test(value) || /%(?![\da-f]{2})/i.test(value)) return fallback;
  try {
    if (/[\\\u0000-\u001f\u007f]/.test(decodeURIComponent(value))) return fallback;
  } catch { return fallback; }
  // No encoded pathname, dot segments, duplicate slashes or unknown child routes.
  const path = value.split(/[?#]/, 1)[0]!;
  if (!pagePaths.has(path) && !(allowLogin && path === base)) return fallback;
  return value;
}

/** Also retire encoded/case variants before static files and the server's SPA fallback. */
export function isRetiredAdminPath(value: string): boolean {
  try {
    const path = decodeURIComponent(new URL(value, "http://route.invalid").pathname).replace(/\\/g, "/");
    return /^\/admin(?:\/|$)/i.test(path);
  } catch { return false; }
}
