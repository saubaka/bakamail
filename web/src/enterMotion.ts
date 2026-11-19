export const ENTER_EASING = "cubic-bezier(.22,1,.36,1)";
export const ENTER_MS = 900;
export const SPRING_SOFT = "linear(0, .0202, .0714, .1431, .2297, .3195, .4099, .4974, .5796, .6549, .7223, .7815, .8341, .8771, .9129, .9421, .9654, .9836, .9974, 1.0078, 1.0147, 1.0192, 1.0218, 1.0228, 1.0227, 1.0218, 1.0202, 1.0184, 1.0164, 1.0143, 1.0123, 1.0103, 1.0086, 1.0069, 1.0055, 1.0042, 1.0032, 1.0023, 1.0016, 1.001, 1.0005, 1.0002, .9999, .9997, 1)";

export type EnterOptions = { distance?: number; blur?: boolean; scale?: boolean };

export function enterFrames({ distance = 20, blur = true, scale = true }: EnterOptions = {}): Keyframe[] {
  const transform = distance === 0 && !scale ? "none" : `translate3d(0, ${distance}px, 0)${scale ? " scale(.98)" : ""}`;
  const from: Keyframe = { opacity: 0, transform };
  const to: Keyframe = { opacity: 1, transform: "none" };
  if (blur) { from.filter = "blur(6px)"; to.filter = "blur(0px)"; }
  return [from, to];
}

let springSupport: boolean | null = null;
export function springSoftEasing(fallback = ENTER_EASING): string {
  if (springSupport === null) {
    springSupport = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("transition-timing-function", "linear(0, 1)");
  }
  return springSupport ? SPRING_SOFT : fallback;
}

const scrollHolds = new Map<HTMLElement, number>();
let fitCache: Map<HTMLElement, boolean> | null = null;

function scrollHost(element: Element): HTMLElement | null {
  if (typeof getComputedStyle !== "function" || typeof document === "undefined") return null;
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function layoutBottom(host: HTMLElement): number {
  let bottom = 0;
  for (const node of Array.from(host.children ?? [])) {
    const child = node as HTMLElement;
    if (typeof child.offsetHeight !== "number" || child.offsetParent === null) continue;
    const top = child.offsetParent === host ? child.offsetTop : child.offsetTop - host.offsetTop - host.clientTop;
    bottom = Math.max(bottom, top + child.offsetHeight + (parseFloat(getComputedStyle(child).marginBottom) || 0));
  }
  return bottom + (parseFloat(getComputedStyle(host).paddingBottom) || 0);
}

function contentFits(host: HTMLElement): boolean {
  if (!fitCache) {
    fitCache = new Map();
    queueMicrotask(() => { fitCache = null; });
  }
  let fits = fitCache.get(host);
  if (fits === undefined) {
    fits = host.scrollHeight <= host.clientHeight + 1 || layoutBottom(host) <= host.clientHeight + 1;
    fitCache.set(host, fits);
  }
  return fits;
}

export function withScrollHold<T extends Animation | Animation[]>(element: Element, create: () => T, waitMs = 0): T {
  const host = scrollHost(element);
  const hold = host !== null && (scrollHolds.has(host) || contentFits(host));
  const created = create();
  if (!host || !hold) return created;
  const animations = (Array.isArray(created) ? created : [created]).filter((animation): animation is Animation => Boolean(animation));
  if (!animations.length) return created;
  scrollHolds.set(host, (scrollHolds.get(host) ?? 0) + animations.length);
  host.dataset.entranceHold = "";
  for (const animation of animations) {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (scrollHolds.get(host) ?? 1) - 1;
      if (left > 0) { scrollHolds.set(host, left); return; }
      scrollHolds.delete(host);
      delete host.dataset.entranceHold;
    };
    animation.finished.then(release, release);
    const end = Number(animation.effect?.getComputedTiming().endTime);
    setTimeout(release, (Number.isFinite(end) ? end : 1500) + waitMs + 600);
  }
  return created;
}
