import type { Directive } from "vue";

type RevealEntry = { isIntersecting: boolean };
type RevealObserver = { observe(element: HTMLElement): void; disconnect(): void };
export type RevealRuntime = {
  reduced(): boolean;
  focusedWithin(element: HTMLElement): boolean;
  observer(callback: (entries: RevealEntry[]) => void): RevealObserver | null;
  onPreferenceChange(callback: () => void): () => void;
};

/** Visibility is progressive enhancement: missing APIs or reduced motion never hide content. */
export function attachIntroReveal(element: HTMLElement, runtime: RevealRuntime): () => void {
  let intersecting = false;
  let disposed = false;
  function sync(): void {
    if (disposed) return;
    const reduced = runtime.reduced();
    element.classList.toggle("intro-reveal--still", reduced);
    element.classList.toggle("is-in-view", reduced || intersecting || runtime.focusedWithin(element));
  }
  const observer = runtime.observer(([entry]) => {
    if (!entry || disposed) return;
    intersecting = entry.isIntersecting;
    sync();
  });
  if (!observer) return () => {};
  const afterBlur = () => { queueMicrotask(sync); };
  element.classList.add("intro-reveal--ready");
  element.addEventListener("focusin", sync);
  element.addEventListener("focusout", afterBlur);
  const unwatch = runtime.onPreferenceChange(sync);
  sync();
  observer.observe(element);
  return () => {
    disposed = true;
    observer.disconnect();
    unwatch();
    element.removeEventListener("focusin", sync);
    element.removeEventListener("focusout", afterBlur);
    element.classList.remove("intro-reveal--ready", "intro-reveal--still", "is-in-view");
  };
}

/** 区块里每一项文字、卡片各自在进入视野的那一刻入场，同时进来的几项按从上到下依次排队。 */
export const ITEM_STEP_MS = 90;
export const ITEM_MAX_STEPS = 6;
export type ItemEntry = { isIntersecting: boolean; target: HTMLElement };
export type ItemRuntime = {
  reduced(): boolean;
  observer(callback: (entries: ItemEntry[]) => void): RevealObserver | null;
  top(element: HTMLElement): number;
};

/** 同一批进入视野的元素：按位置排好，返回它们各自的等待时间。 */
export function itemDelays(count: number): number[] {
  return Array.from({ length: count }, (_, index) => Math.min(index, ITEM_MAX_STEPS) * ITEM_STEP_MS);
}

export function attachIntroItems(root: HTMLElement, runtime: ItemRuntime): () => void {
  const items = [...root.querySelectorAll<HTMLElement>(".intro-stagger")];
  if (!items.length) return () => {};
  let disposed = false;
  const observer = runtime.observer((entries) => {
    if (disposed) return;
    const entering = entries.filter((entry) => entry.isIntersecting && !entry.target.classList.contains("is-seen"))
      .sort((a, b) => runtime.top(a.target) - runtime.top(b.target));
    const delays = itemDelays(entering.length);
    entering.forEach((entry, index) => {
      entry.target.style.setProperty("--d", `${runtime.reduced() ? 0 : delays[index]}ms`);
      entry.target.classList.add("is-seen");
    });
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      // 完全离开视野才收回，下次进来再入场一遍。
      entry.target.style.setProperty("--d", "0ms");
      entry.target.classList.remove("is-seen");
    }
  });
  if (!observer) return () => {};
  for (const item of items) observer.observe(item);
  return () => {
    disposed = true;
    observer.disconnect();
    for (const item of items) { item.classList.remove("is-seen"); item.style.removeProperty("--d"); }
  };
}

const cleanup = new WeakMap<HTMLElement, () => void>();
export const introRevealDirective: Directive<HTMLElement> = {
  mounted(element) {
    const disposeItems = element.classList.contains("intro-reveal--split") && typeof IntersectionObserver !== "undefined"
      ? attachIntroItems(element, {
        reduced: () => document.documentElement.dataset.motion === "reduce" || document.documentElement.dataset.performance === "low"
          || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        observer: callback => new IntersectionObserver((entries) => callback(entries.map((entry) => ({ isIntersecting: entry.isIntersecting, target: entry.target as HTMLElement }))),
          { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }),
        top: (target) => target.getBoundingClientRect().top,
      })
      : () => {};
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const disposeSection = attachIntroReveal(element, {
      reduced: () => media.matches || document.documentElement.dataset.motion === "reduce"
        || document.documentElement.dataset.performance === "low",
      focusedWithin: target => target.contains(document.activeElement),
      observer: callback => typeof IntersectionObserver === "undefined" ? null
        : new IntersectionObserver(callback, { threshold: 0, rootMargin: "0px 0px -3% 0px" }),
      onPreferenceChange(callback) {
        const observer = new MutationObserver(callback);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion", "data-performance"] });
        if (typeof media.addEventListener === "function") media.addEventListener("change", callback);
        else media.addListener(callback);
        return () => {
          observer.disconnect();
          if (typeof media.removeEventListener === "function") media.removeEventListener("change", callback);
          else media.removeListener(callback);
        };
      },
    });
    cleanup.set(element, () => { disposeSection(); disposeItems(); });
  },
  unmounted(element) { cleanup.get(element)?.(); cleanup.delete(element); },
};
