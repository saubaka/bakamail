import type { ComputedRef, InjectionKey, Ref, ShallowRef } from "vue";
import type { ScrollPosition } from './scrollIntent';

export type WorkbenchActions = {
  compose: () => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  liveLabel: ComputedRef<string>;
  logoutBusy: Ref<boolean>;
  readerAvailable?: ComputedRef<boolean>;
};

export const workspaceKey: InjectionKey<{
  actions: ShallowRef<WorkbenchActions | null>;
  view: Ref<"list" | "reader">;
  isDesktop: Readonly<Ref<boolean>>;
  desktopSidebarExpanded: Readonly<Ref<boolean>>;
  setDesktopSidebarExpanded: (expanded: boolean) => void;
  openMenu: () => void;
  closeMenu: () => Promise<void>;
  reportScroll: (position: ScrollPosition, source: string) => void;
}> = Symbol("mail-workspace");

export const mailNavigation = [
  { path: "/mail", label: "邮箱", icon: "M4 5h16v14H4z M4 12h4l2 3h4l2-3h4" },
  { path: "/mail/search", label: "搜索", icon: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13 M16 16l5 5" },
  { path: "/mail/drafts", label: "草稿", icon: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h4" },
  { path: "/mail/contacts", label: "联系人", icon: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-2a8 8 0 0 1 16 0v2" },
  { path: "/mail/settings", label: "设置", icon: "M4 7h16 M4 17h16 M9 4v6 M15 14v6" },
] as const;

export function navigationIndex(path: string): number {
  const index = mailNavigation.findIndex(item => item.path === path);
  return index < 0 ? 0 : index;
}

export type PanelNavigationDirection = "forward" | "backward" | "neutral";

export function panelNavigationDirection(fromPath: string, toPath: string): PanelNavigationDirection {
  const from = mailNavigation.findIndex(item => item.path === fromPath);
  const to = mailNavigation.findIndex(item => item.path === toPath);
  if (from < 0 || to < 0 || from === to) return "neutral";
  return to > from ? "forward" : "backward";
}
