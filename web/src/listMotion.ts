/**
 * 列表项增减时的动画辅助：
 * - 离开的卡片先固定在原位置再淡出，其余卡片用 FLIP 平滑补位，而不是瞬间跳动；
 * - 工具页的滚动容器是 .workspace-route-panel，不是 window，滚到编辑区要找对容器。
 */
export function pinLeavingItem(el: Element): void {
  const item = el as HTMLElement;
  const { offsetTop, offsetLeft, offsetWidth, offsetHeight } = item;
  Object.assign(item.style, { position: "absolute", top: `${offsetTop}px`, left: `${offsetLeft}px`, width: `${offsetWidth}px`, height: `${offsetHeight}px`, margin: "0" });
}

export function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

function reducedMotion(): boolean {
  const root = document.documentElement;
  return root.dataset.motion === "reduce" || root.dataset.performance === "low" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 把元素顶部带到可视区域（在它所在的滚动容器里），并把焦点交给 focusTarget。 */
export function revealInScroller(element: HTMLElement, focusTarget?: HTMLElement | null): void {
  const scroller = scrollParentOf(element);
  const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
  if (scroller) {
    const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior });
  } else {
    window.scrollTo({ top: 0, behavior });
  }
  focusTarget?.focus({ preventScroll: true });
}
