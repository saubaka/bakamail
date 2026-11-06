import { onBeforeUnmount, ref } from "vue";
import { api } from "../api";
import type { RailBadgeKey } from "./navModel";

export type RailBadges = Partial<Record<RailBadgeKey, number>>;

const MIN_GAP_MS = 15_000;
const POLL_MS = 60_000;

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
      const next = await api<RailBadges>("/api/admin/nav-badges", { quiet: true });
      if (active) { badges.value = next; last = Date.now(); }
    } catch { }
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
