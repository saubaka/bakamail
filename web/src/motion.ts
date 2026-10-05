import type { Directive, DirectiveBinding } from "vue";

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
};

const records = new WeakMap<HTMLElement, MotionRecord>();
const mountedElements = new Set<HTMLElement>();
const SVG_NS = "http://www.w3.org/2000/svg";
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
  for (const animation of record.animations) {
    animation.playbackRate = 1;
    animation.pause();
    animation.currentTime = record.duration;
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
      // Browser storage is optional; the current page still honors the selection.
    }
  }
  syncMountedMotion();
}

function optionsOf(binding: DirectiveBinding<MotionOptions | MotionKind | undefined>): Required<MotionOptions> {
  if (typeof binding.value === "string") {
    return { kind: binding.value, delay: 0, reversible: true };
  }
  return {
    kind: binding.value?.kind ?? "compact",
    delay: Math.max(0, Math.min(1200, binding.value?.delay ?? 0)),
    reversible: binding.value?.reversible ?? true,
  };
}

function createOutline(element: HTMLElement): { outline: SVGSVGElement; path: SVGRectElement } {
  const outline = document.createElementNS(SVG_NS, "svg");
  outline.classList.add("motion-outline");
  outline.setAttribute("aria-hidden", "true");
  outline.setAttribute("focusable", "false");
  outline.setAttribute("preserveAspectRatio", "none");

  const path = document.createElementNS(SVG_NS, "rect");
  path.classList.add("motion-outline__path");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  path.setAttribute("pathLength", "1");
  path.style.setProperty("--motion-path-length", "1");
  outline.append(path);
  element.prepend(outline);
  return { outline, path };
}

function configureGeometry(element: HTMLElement, outline: SVGSVGElement, path: SVGRectElement): void {
  const width = Math.max(1, element.clientWidth);
  const height = Math.max(1, element.clientHeight);
  const radius = Math.max(0, Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0);
  const inset = 0.75;
  outline.setAttribute("viewBox", `0 0 ${width} ${height}`);
  path.setAttribute("x", String(inset));
  path.setAttribute("y", String(inset));
  path.setAttribute("width", String(Math.max(0, width - inset * 2)));
  path.setAttribute("height", String(Math.max(0, height - inset * 2)));
  path.setAttribute("rx", String(Math.min(radius, width / 2, height / 2)));
  path.setAttribute("ry", String(Math.min(radius, width / 2, height / 2)));
}

function play(record: MotionRecord, forward: boolean, element: HTMLElement): void {
  if (record.disabled) return;
  if (reducedMotion()) {
    settleInstantly(element);
    return;
  }
  window.clearTimeout(record.delayTimer);
  const version = ++record.version;
  const run = (): void => {
    if (record.disabled || record.version !== version) return;
    if (reducedMotion()) {
      settleInstantly(element);
      return;
    }
    element.classList.add("is-motion-active");
    element.dataset.motionState = forward ? "drawing" : "reversing";
    for (const animation of record.animations) {
      animation.playbackRate = forward ? 1 : -1;
      animation.play();
    }
    const anchor = record.animations[0];
    anchor.finished
      .then(() => {
        if (record.disabled || record.version !== version) return;
        element.classList.remove("is-motion-active");
        element.classList.toggle("is-revealed", forward);
        element.dataset.motionState = forward ? "settled" : "idle";
      })
      .catch(() => undefined);
  };
  record.delayTimer = window.setTimeout(run, forward ? Number(element.dataset.motionDelay ?? 0) : 0);
}

export function initializeMotionPreferences(): void {
  const root = document.documentElement;
  let savedMotion: MotionPreference = "system";
  let savedPerformance: PerformancePreference = "normal";
  try {
    savedMotion = localStorage.getItem("bakamail-motion") === "reduce" ? "reduce" : "system";
    savedPerformance = localStorage.getItem("bakamail-performance") === "low" ? "low" : "normal";
  } catch {
    // Local storage is optional.
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
    if (typeof media.addEventListener === "function") media.addEventListener("change", onSystemMotionChange);
    else media.addListener(onSystemMotionChange);
  }
}

export const motionDirective: Directive<HTMLElement, MotionOptions | MotionKind | undefined> = {
  mounted(element, binding) {
    const options = optionsOf(binding);
    mountedElements.add(element);
    element.classList.add("motion-line-target");
    element.dataset.motionKind = options.kind;
    element.dataset.motionState = "idle";
    element.dataset.motionDelay = String(options.delay);
    element.dataset.motionOutline = "true";

    const { outline, path } = createOutline(element);
    configureGeometry(element, outline, path);
    element.classList.add("is-outline-ready");

    const duration = options.kind === "feature" ? 620 : options.kind === "control" ? 360 : 500;
    const timing: KeyframeAnimationOptions = {
      duration,
      easing: "cubic-bezier(.2,.78,.22,1)",
      fill: "both",
    };
    const animations = [
      path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], timing),
      outline.animate(
        [
          { opacity: 0.2, filter: "blur(.7px)", transform: "scale(.988)" },
          { opacity: 1, filter: "blur(0)", transform: "scale(1)" },
        ],
        timing,
      ),
      element.animate(
        [
          { opacity: 0, transform: "translate3d(0, 8px, 0) scale(.992)" },
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        ],
        timing,
      ),
    ];
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
    };
    records.set(element, record);

    if ("ResizeObserver" in window) {
      record.resizeObserver = new ResizeObserver(() => configureGeometry(element, outline, path));
      record.resizeObserver.observe(element);
    }

    if ("IntersectionObserver" in window) {
      record.observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) play(record, true, element);
          else if (options.reversible && element.dataset.motionState !== "idle") play(record, false, element);
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
