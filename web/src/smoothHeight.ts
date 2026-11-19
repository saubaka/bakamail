import type { ObjectDirective } from "vue";

export function layoutHeight(node: HTMLElement, entry?: ResizeObserverEntry): number {
  const box = entry?.borderBoxSize?.[0];
  if (box && Number.isFinite(box.blockSize)) return box.blockSize;
  if (typeof getComputedStyle === "function") {
    const style = getComputedStyle(node);
    const height = parseFloat(style.height);
    if (Number.isFinite(height)) {
      if (style.boxSizing === "border-box") return height;
      return height + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    }
  }
  return node.offsetHeight;
}

export function nextFrameWriter(write: (value: number) => void): { push: (value: number) => void; cancel: () => void } {
  let frame = 0;
  let pending = 0;
  return {
    push(value) {
      pending = value;
      if (typeof requestAnimationFrame !== "function") { write(pending); return; }
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; write(pending); });
    },
    cancel() {
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

const observers = new WeakMap<HTMLElement, { observer: ResizeObserver; cancel: () => void }>();
export const smoothHeightDirective: ObjectDirective<HTMLElement> = {
  mounted(el) {
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner || typeof ResizeObserver === "undefined") return;
    el.style.height = `${layoutHeight(inner)}px`;
    const writer = nextFrameWriter((value) => { el.style.height = `${value}px`; });
    const observer = new ResizeObserver(([entry]) => writer.push(layoutHeight(inner, entry)));
    observer.observe(inner); observers.set(el, { observer, cancel: writer.cancel });
  },
  beforeUnmount(el) { const record = observers.get(el); record?.observer.disconnect(); record?.cancel(); observers.delete(el); },
};
