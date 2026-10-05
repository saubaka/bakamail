import { defineStore } from "pinia";
import { ref } from "vue";

type StreamStatus = "stopped" | "connecting" | "connected" | "reconnecting" | "polling";
type MailStatus = "unknown" | "connected" | "reconnecting" | "closed";

export type RealtimeStream = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  onerror: ((event: Event) => void) | null;
  close(): void;
};

export type RealtimeRuntime = {
  now: () => number;
  createStream: (url: string) => RealtimeStream;
  setInterval: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  isHidden: () => boolean;
  onVisibilityChange: (callback: () => void) => () => void;
};

const defaultRuntime: RealtimeRuntime = {
  now: () => Date.now(),
  createStream: (url) => new EventSource(url),
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  clearInterval: (timer) => globalThis.clearInterval(timer),
  isHidden: () => document.hidden,
  onVisibilityChange: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
};

/** One live mail stream per mounted workbench; no mail data is kept in this store. */
export const useRealtimeStore = defineStore("realtime", () => {
  const status = ref<StreamStatus>("stopped");
  const mailStatus = ref<MailStatus>("unknown");
  const lastEventAt = ref<number | null>(null);
  const lastRefreshAt = ref<number | null>(null);
  const lastError = ref("");
  let runtime: RealtimeRuntime = defaultRuntime;
  let stream: RealtimeStream | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let removeVisibilityListener: (() => void) | null = null;
  let refresh: (() => Promise<void>) | null = null;
  let generation = 0;
  let refreshing = false;
  let refreshQueued = false;
  let missedWhileHidden = false;

  function stopFallback(): void {
    if (fallbackTimer !== null) runtime.clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  function stop(): void {
    generation += 1;
    stream?.close();
    stream = null;
    if (watchdogTimer !== null) runtime.clearInterval(watchdogTimer);
    watchdogTimer = null;
    stopFallback();
    removeVisibilityListener?.();
    removeVisibilityListener = null;
    refresh = null;
    refreshing = false;
    refreshQueued = false;
    missedWhileHidden = false;
    status.value = "stopped";
    mailStatus.value = "unknown";
    lastEventAt.value = null;
    lastRefreshAt.value = null;
    lastError.value = "";
  }

  function queueRefresh(): void {
    if (!refresh || status.value === "stopped") return;
    if (runtime.isHidden()) {
      missedWhileHidden = true;
      return;
    }
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    const currentGeneration = generation;
    const action = refresh;
    refreshing = true;
    void action().then(() => {
      if (currentGeneration !== generation) return;
      lastRefreshAt.value = runtime.now();
      lastError.value = "";
    }).catch((error: unknown) => {
      if (currentGeneration !== generation) return;
      lastError.value = error instanceof Error ? error.message : "实时刷新失败";
    }).finally(() => {
      if (currentGeneration !== generation) return;
      refreshing = false;
      if (refreshQueued) {
        refreshQueued = false;
        queueRefresh();
      }
    });
  }

  function startFallback(): void {
    if (fallbackTimer !== null || status.value === "stopped") return;
    status.value = "polling";
    queueRefresh();
    fallbackTimer = runtime.setInterval(queueRefresh, 30_000);
  }

  function markHealthy(): void {
    lastEventAt.value = runtime.now();
    stopFallback();
    status.value = "connected";
  }

  function start(onRefresh: () => Promise<void>, customRuntime: RealtimeRuntime = defaultRuntime): void {
    stop();
    runtime = customRuntime;
    refresh = onRefresh;
    const currentGeneration = generation;
    lastEventAt.value = runtime.now();
    status.value = "connecting";
    removeVisibilityListener = runtime.onVisibilityChange(() => {
      if (currentGeneration !== generation || runtime.isHidden()) return;
      if (missedWhileHidden || status.value === "polling") {
        missedWhileHidden = false;
        queueRefresh();
      }
    });
    try {
      stream = runtime.createStream("/api/events");
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : "实时连接失败";
      startFallback();
    }
    if (stream) {
      const healthy = () => {
        if (currentGeneration !== generation) return false;
        markHealthy();
        return true;
      };
      stream.addEventListener("ready", healthy);
      stream.addEventListener("ping", healthy);
      stream.addEventListener("exists", () => { if (healthy()) queueRefresh(); });
      stream.addEventListener("expunge", () => { if (healthy()) queueRefresh(); });
      stream.addEventListener("state", (event) => {
        if (currentGeneration !== generation) return;
        lastEventAt.value = runtime.now();
        try {
          const state = JSON.parse((event as MessageEvent).data) as { status?: MailStatus };
          if (state.status === "connected" || state.status === "reconnecting" || state.status === "closed") {
            mailStatus.value = state.status;
          }
        } catch { /* A malformed state event does not make the transport stale. */ }
      });
      stream.onerror = () => {
        if (currentGeneration !== generation) return;
        status.value = "reconnecting";
        if (runtime.now() - (lastEventAt.value ?? 0) > 60_000) startFallback();
      };
    }
    watchdogTimer = runtime.setInterval(() => {
      if (currentGeneration !== generation) return;
      if (runtime.now() - (lastEventAt.value ?? 0) > 60_000) startFallback();
    }, 15_000);
  }

  return { status, mailStatus, lastEventAt, lastRefreshAt, lastError, start, stop };
});
