/** Page paths only. The authenticated /api/admin namespace is deliberately unchanged. */
export const ADMIN_LOGIN_PATH = "/bakaadmin";
export const ADMIN_PAGE_PATHS = {
  overview: `${ADMIN_LOGIN_PATH}/overview`,
  accounts: `${ADMIN_LOGIN_PATH}/accounts`,
  invites: `${ADMIN_LOGIN_PATH}/invites`,
  mailOps: `${ADMIN_LOGIN_PATH}/mail-ops`,
  security: `${ADMIN_LOGIN_PATH}/security`,
  admins: `${ADMIN_LOGIN_PATH}/admins`,
  system: `${ADMIN_LOGIN_PATH}/system`,
} as const;

const pagePaths = new Set<string>(Object.values(ADMIN_PAGE_PATHS));

/** Accept registered, literal same-origin page paths, never an arbitrary prefix. */
export function safeAdminDestination(value: unknown, allowLogin = false): string {
  const fallback = ADMIN_PAGE_PATHS.overview;
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u0020\u007f]/.test(value) || /%(?![\da-f]{2})/i.test(value)) return fallback;
  try {
    if (/[\\\u0000-\u001f\u007f]/.test(decodeURIComponent(value))) return fallback;
  } catch { return fallback; }
  // No encoded pathname, dot segments, duplicate slashes or unknown child routes.
  const path = value.split(/[?#]/, 1)[0]!;
  if (!pagePaths.has(path) && !(allowLogin && path === ADMIN_LOGIN_PATH)) return fallback;
  return value;
}

/** Also retire encoded/case variants before static files and the server's SPA fallback. */
export function isRetiredAdminPath(value: string): boolean {
  try {
    const path = decodeURIComponent(new URL(value, "http://route.invalid").pathname).replace(/\\/g, "/");
    return /^\/admin(?:\/|$)/i.test(path);
  } catch { return false; }
}
