import type { Directive, DirectiveBinding } from "vue";
import { ENTER_EASING, ENTER_MS, enterFrames, withScrollHold } from "./enterMotion.ts";
import { stagger } from "./stagger.ts";
import { playCardParts } from "./cardParts.ts";
import { loaderGate } from "./admin/loader.ts";

type MotionKind = "feature" | "compact" | "control";
type MotionOptions = {
  kind?: MotionKind;
  delay?: number;
  reversible?: boolean;
};

type MotionRecord = {
  observer: IntersectionObserver | null;
  resizeObserver: ResizeObserver | null;
  animations: Animation[];
  duration: number;
  delayTimer: number;
  disabled: boolean;
  version: number;
  startedAt: number;
};

const records = new WeakMap<HTMLElement, MotionRecord>();
const mountedElements = new Set<HTMLElement>();
let preferencesInitialized = false;

export type MotionPreference = "system" | "reduce";
export type PerformancePreference = "normal" | "low";

export function currentMotionPreferences(): {
  motion: MotionPreference;
  performance: PerformancePreference;
} {
  return {
    motion: document.documentElement.dataset.motion === "reduce" ? "reduce" : "system",
    performance: document.documentElement.dataset.performance === "low" ? "low" : "normal",
  };
}

function reducedMotion(): boolean {
  return (
    document.documentElement.dataset.motion === "reduce" ||
    document.documentElement.dataset.performance === "low" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !("animate" in Element.prototype)
  );
}

function settleInstantly(element: HTMLElement): void {
  const record = records.get(element);
  if (record) {
    window.clearTimeout(record.delayTimer);
    record.version += 1;
    record.disabled = true;
    for (const animation of record.animations) animation.cancel();
  }
  element.classList.remove("is-motion-active");
  element.classList.add("is-revealed");
  element.dataset.motionState = "settled";
}

function resumeMotion(element: HTMLElement): void {
  const record = records.get(element);
  if (!record?.disabled) return;
  record.disabled = false;
  for (const animation of record.animations) animation.cancel();
}

function releaseEffects(record: MotionRecord): void {
  for (const animation of record.animations) animation.cancel();
}

function prepare(record: MotionRecord, forward: boolean): void {
  for (const animation of record.animations) {
    animation.playbackRate = forward ? 1 : -1;
    if (!forward && animation.playState === "idle") animation.currentTime = record.duration;
    if (forward && animation.playState === "idle") animation.currentTime = 0;
  }
}

function syncMountedMotion(): void {
  for (const element of mountedElements) {
    if (reducedMotion()) settleInstantly(element);
    else resumeMotion(element);
  }
}

export function applyMotionPreferences(
  motion: MotionPreference,
  performance: PerformancePreference,
  persist = true,
): void {
  const root = document.documentElement;
  root.dataset.motion = motion;
  root.dataset.performance = performance;
  if (persist) {
    try {
      localStorage.setItem("bakamail-motion", motion);
      localStorage.setItem("bakamail-performance", performance);
    } catch {
    }
  }
  syncMountedMotion();
}

function optionsOf(binding: DirectiveBinding<MotionOptions | MotionKind | undefined>): Required<MotionOptions> {
  if (typeof binding.value === "string") {
    return { kind: binding.value, delay: 0, reversible: false };
  }
  return {
    kind: binding.value?.kind ?? "compact",
    delay: Math.max(0, Math.min(1200, binding.value?.delay ?? 0)),
    reversible: false,
  };
}

function entranceDelay(element: HTMLElement): number {
  const own = Number(element.dataset.motionDelay ?? 0);
  const now = performance.now();
  const assignedAt = Number(element.dataset.motionAssignedAt ?? 0);
  const gate = loaderGate.delay(now);
  if (assignedAt > 0) return own + gate + (now - assignedAt < 1500 ? Number(element.dataset.motionSlotDelay ?? 0) : 0);
  return own + gate + stagger.next(now);
}

function play(record: MotionRecord, forward: boolean, element: HTMLElement): void {
  if (record.disabled || !forward) return;
  if (reducedMotion()) {
    settleInstantly(element);
    return;
  }
  if (element.dataset.motionState === "settled" || element.dataset.motionState === "drawing") return;
  window.clearTimeout(record.delayTimer);
  const version = ++record.version;
  const run = (): void => {
    if (record.disabled || record.version !== version) return;
    if (reducedMotion()) {
      settleInstantly(element);
      return;
    }
    element.classList.add("is-motion-active");
    element.dataset.motionState = "drawing";
    record.startedAt = performance.now();
    prepare(record, true);
    for (const animation of record.animations) animation.play();
    if (element.dataset.motionKind !== "control") playCardParts(element, 0);
    const anchor = record.animations[0];
    anchor.finished
      .then(() => {
        if (record.disabled || record.version !== version) return;
        element.classList.remove("is-motion-active");
        element.classList.add("is-revealed");
        element.dataset.motionState = "settled";
        releaseEffects(record);
      })
      .catch(() => undefined);
  };
  const delay = entranceDelay(element);
  withScrollHold(element, () => record.animations, delay);
  record.delayTimer = window.setTimeout(run, delay);
}

export function settleStalledMotion(now = performance.now()): number {
  let settled = 0;
  for (const element of mountedElements) {
    const state = element.dataset.motionState;
    if (state !== "drawing" && state !== "reversing") continue;
    const record = records.get(element);
    if (!record || record.disabled || now - record.startedAt < record.duration + 400) continue;
    for (const animation of record.animations) {
      try { animation.finish(); } catch { }
    }
    settled += 1;
  }
  return settled;
}

export function initializeMotionPreferences(): void {
  const root = document.documentElement;
  let savedMotion: MotionPreference = "system";
  let savedPerformance: PerformancePreference = "normal";
  try {
    savedMotion = localStorage.getItem("bakamail-motion") === "reduce" ? "reduce" : "system";
    savedPerformance = localStorage.getItem("bakamail-performance") === "low" ? "low" : "normal";
  } catch {
  }
  applyMotionPreferences(savedMotion, savedPerformance, false);
  root.dataset.componentMotionStyle = "soft";
  root.dataset.componentMotionSoftness = "light";
  root.dataset.componentMotionDuration = "620";
  root.classList.remove("motion-preparing");
  root.classList.add("is-motion-ready");
  if (!preferencesInitialized) {
    preferencesInitialized = true;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onSystemMotionChange = (): void => syncMountedMotion();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") settleStalledMotion(); });
    window.addEventListener("focus", () => { settleStalledMotion(); });
    if (typeof media.addEventListener === "function") media.addEventListener("change", onSystemMotionChange);
    else media.addListener(onSystemMotionChange);
  }
}

export const motionDirective: Directive<HTMLElement, MotionOptions | MotionKind | undefined> = {
  mounted(element, binding) {
    const options = optionsOf(binding);
    mountedElements.add(element);
    element.classList.add("motion-enter-target");
    element.dataset.motionKind = options.kind;
    element.dataset.motionState = "idle";
    element.dataset.motionDelay = String(options.delay);

    const duration = options.kind === "feature" ? ENTER_MS : options.kind === "control" ? 520 : 760;
    const animations = withScrollHold(element, () => [
      element.animate(enterFrames({ distance: options.kind === "control" ? 8 : 20, blur: options.kind !== "control" }), { duration, easing: ENTER_EASING, fill: "both" }),
    ]);
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }

    const record: MotionRecord = {
      observer: null,
      resizeObserver: null,
      animations,
      duration,
      delayTimer: 0,
      disabled: false,
      version: 0,
      startedAt: 0,
    };
    records.set(element, record);

    if (typeof ResizeObserver !== "undefined") {
      let shown = false;
      record.resizeObserver = new ResizeObserver(([entry]) => {
        const visible = entry.contentRect.width > 0 || entry.contentRect.height > 0;
        if (visible && !shown && element.dataset.motionState === "idle" && !record.disabled) withScrollHold(element, () => record.animations, 1500);
        shown = visible;
      });
      record.resizeObserver.observe(element);
    }
    if ("IntersectionObserver" in window) {
      record.observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) play(record, true, element);
        },
        { threshold: 0.08, rootMargin: "0px 0px -6%" },
      );
      record.observer.observe(element);
    } else {
      play(record, true, element);
    }
    if (reducedMotion()) settleInstantly(element);
  },
  unmounted(element) {
    mountedElements.delete(element);
    const record = records.get(element);
    if (!record) return;
    window.clearTimeout(record.delayTimer);
    record.version += 1;
    record.observer?.disconnect();
    record.resizeObserver?.disconnect();
    for (const animation of record.animations) animation.cancel();
    records.delete(element);
  },
};
