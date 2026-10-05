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

const cleanup = new WeakMap<HTMLElement, () => void>();
export const introRevealDirective: Directive<HTMLElement> = {
  mounted(element) {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    cleanup.set(element, attachIntroReveal(element, {
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
    }));
  },
  unmounted(element) { cleanup.get(element)?.(); cleanup.delete(element); },
};
