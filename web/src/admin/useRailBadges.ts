import { onBeforeUnmount, ref } from "vue";
import { api } from "../api";
import type { RailBadgeKey } from "./navModel";

export type RailBadges = Partial<Record<RailBadgeKey, number>>;

const MIN_GAP_MS = 15_000;
const POLL_MS = 60_000;

/**
 * 侧栏角标：进入后台时读取一次，之后只在页面可见时每分钟刷新，路由切换时按最短间隔补刷。
 * 读取失败时保留上一次的数字，不打扰用户。
 */
export function useRailBadges() {
  const badges = ref<RailBadges>({});
  let timer = 0;
  let last = 0;
  let inflight = false;
  let active = false;

  async function refresh(force = false): Promise<void> {
    if (!active || inflight || (typeof document !== "undefined" && document.hidden)) return;
    if (!force && Date.now() - last < MIN_GAP_MS) return;
    inflight = true;
    try {
      const next = await api<RailBadges>("/api/admin/nav-badges");
      if (active) { badges.value = next; last = Date.now(); }
    } catch { /* 角标是辅助信息，失败时保留旧值 */ }
    finally { inflight = false; }
  }

  const onVisible = (): void => { if (!document.hidden) void refresh(); };

  function start(): void {
    if (active) return;
    active = true;
    void refresh(true);
    timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }

  function stop(): void {
    active = false;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  }

  onBeforeUnmount(stop);
  return { badges, start, stop, refresh };
}
