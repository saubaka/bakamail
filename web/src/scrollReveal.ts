import type { ObjectDirective } from "vue";
import { scrollParentOf } from "./listMotion.ts";

/**
 * 滚动时卡片的入场与出场：进入视野时从下方（或上方）浮入，完全离开视野后淡出，滚回来再入场。
 * 状态放在 data-scroll-reveal 里，不碰 Vue 管理的 class；没有 IntersectionObserver 时保持可见。
 */
type Group = { observer: IntersectionObserver; items: Set<HTMLElement> };
const groups = new WeakMap<Element, Group>();
const owners = new WeakMap<HTMLElement, Element>();
export const REVEAL_ROOT_KEY = "viewport";
const viewportRoot = {} as Element;

export const scrollRevealDirective: ObjectDirective<HTMLElement> = {
  mounted(el) {
    el.dataset.scrollReveal = "visible";
    if (typeof IntersectionObserver === "undefined") return;
    const scroller = scrollParentOf(el);
    const key: Element = scroller ?? viewportRoot;
    let group = groups.get(key);
    if (!group) {
      const items = new Set<HTMLElement>();
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const item = entry.target as HTMLElement;
          if (!items.has(item)) continue;
          const above = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
          item.style.setProperty("--reveal-offset", above ? "-14px" : "14px");
          item.dataset.scrollReveal = entry.isIntersecting || item.contains(document.activeElement) ? "visible" : "outside";
        }
      }, { root: scroller, threshold: [0], rootMargin: "0px" });
      group = { observer, items };
      groups.set(key, group);
    }
    group.items.add(el);
    group.observer.observe(el);
    owners.set(el, key);
  },
  beforeUnmount(el) {
    const key = owners.get(el);
    const group = key && groups.get(key);
    if (group) {
      group.observer.unobserve(el);
      group.items.delete(el);
      if (!group.items.size) { group.observer.disconnect(); groups.delete(key); }
    }
    owners.delete(el);
  },
};
