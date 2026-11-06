import type { ObjectDirective } from "vue";
type Group = { observer: IntersectionObserver; rows: Set<HTMLElement> };
const groups = new WeakMap<Element, Group>();
const owners = new WeakMap<HTMLElement, Element>();
export const rowRevealDirective: ObjectDirective<HTMLElement> = {
  mounted(el) {
    el.dataset.rowReveal = "visible";
    const root = el.closest(".mail-pane__body");
    if (!root || typeof IntersectionObserver === "undefined") return;
    let group = groups.get(root);
    if (!group) {
      group = { rows: new Set(), observer: new IntersectionObserver(entries => {
        for (const entry of entries) {
          const row = entry.target as HTMLElement;
          if (!group?.rows.has(row)) continue;
          const visible = entry.isIntersecting;
          row.style.setProperty("--row-offset", entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? "-12px" : "12px");
          row.dataset.rowReveal = visible || row.contains(document.activeElement) ? "visible" : "outside";
        }
      }, { root, threshold: [0], rootMargin: "0px" }) };
      groups.set(root, group);
    }
    group.rows.add(el); group.observer.observe(el); owners.set(el, root);
  },
  beforeUnmount(el) {
    const root = owners.get(el); const group = root && groups.get(root);
    if (group) { group.observer.unobserve(el); group.rows.delete(el); if (!group.rows.size) { group.observer.disconnect(); groups.delete(root!); } }
    owners.delete(el);
  },
};
