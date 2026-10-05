import type { ObjectDirective } from "vue";

const observers = new WeakMap<HTMLElement, ResizeObserver>();
/** One bounded result region changes height; its old content stays readable while fetching. */
export const smoothHeightDirective: ObjectDirective<HTMLElement> = {
  mounted(el) {
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner || typeof ResizeObserver === "undefined") return;
    const update = () => { el.style.height = `${inner.getBoundingClientRect().height}px`; };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(inner); observers.set(el, observer);
  },
  beforeUnmount(el) { observers.get(el)?.disconnect(); observers.delete(el); },
};
