export const MAIL_DESKTOP_MIN_WIDTH = 901;
export const MAIL_WIDE_MIN_WIDTH = 1180;
export const MAIL_DESKTOP_QUERY = `(min-width: ${MAIL_DESKTOP_MIN_WIDTH}px)`;
export const MAIL_WIDE_QUERY = `(min-width: ${MAIL_WIDE_MIN_WIDTH}px)`;
export const MAIL_SIDEBAR_PREFERENCE_KEY = "bakamail.desktop-sidebar";

export type DesktopSidebarPreference = "expanded" | "collapsed";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function workspaceModeForWidth(width: number): "mobile" | "desktop" {
  return width >= MAIL_DESKTOP_MIN_WIDTH ? "desktop" : "mobile";
}

export function compactUnreadCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  const normalized = Math.floor(count);
  return normalized > 99 ? "99+" : String(normalized);
}

export function readDesktopSidebarPreference(
  storage?: PreferenceStorage,
): DesktopSidebarPreference | null {
  try {
    const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    if (!target) return null;
    const value = target.getItem(MAIL_SIDEBAR_PREFERENCE_KEY);
    return value === "expanded" || value === "collapsed" ? value : null;
  } catch {
    return null;
  }
}

export function resolveDesktopSidebarExpanded(
  isWide: boolean,
  preference: DesktopSidebarPreference | null,
): boolean {
  if (preference) return preference === "expanded";
  return isWide;
}

export function writeDesktopSidebarPreference(
  expanded: boolean,
  storage?: PreferenceStorage,
): void {
  try {
    const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    if (!target) return;
    target.setItem(MAIL_SIDEBAR_PREFERENCE_KEY, expanded ? "expanded" : "collapsed");
  } catch {
    // Storage can be unavailable in private/restricted contexts. The in-memory state remains usable.
  }
}
