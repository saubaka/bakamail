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
