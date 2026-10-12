import type { Directive } from "vue";
import { stagger } from "../stagger.ts";
import { playCardParts } from "../cardParts.ts";

/**
 * 后台入场：页面里的每张卡片、每一块文字、每一行数据，都在它真正出现的那一刻单独入场，
 * 先后顺序按它们在页面上的位置排队，而不是整个页面一起淡入。
 * 数据是后来才取回的（“没有积压的投递任务”这类提示、表格、表单），同样会在出现时平滑进来，而不是瞬间弹出。
 *
 * 做法：盯着页面容器里新增的元素，认出属于下面几类的，各自播一个很短的透明度加位移动画。
 * 动画只在开始前保持起点（fill: backwards），结束后不留任何效果，不会让线条和文字被重新采样而发虚。
 */

/** 整张卡片：先入场，里面的内容紧接着依次跟上。 */
export const CARD_SELECTOR = ".admin-panel, .managed-page-card, .baka-overview-stat, .invite-reveal-card, .stat-card";

/** 后来才出现的内容块和提示文字。 */
export const BLOCK_SELECTOR = [
  "form.form-grid", ".admin-filter-bar", ".invite-overview", ".admin-status-list", ".hv-section", ".hv-chart",
  "pre.log-block", ".seo-score", ".seo-group", ".seo-preview", ".seo-files", ".seo-switches", ".seo-code",
  ".mail-notice", ".mail-empty", ".admin-page-state", ".field-error", ".form-error", ".hint-line", ".hv-warn", ".hv-inline",
  ".baka-overview__error", ".seo-savebar", ".admin-users-table-scroll", ".table-scroll", ".permission-list",
].join(", ");

/** 一行一行的数据。 */
export const ROW_SELECTOR = [
  "tbody tr", ".check-row", ".hv-routes li", ".seo-check", ".admin-status-list > div", ".baka-overview__system-items > div",
  ".baka-overview__quick-actions > a", ".permission-list > .badge", ".seo-switches li",
].join(", ");

export const ENTRANCE_SELECTOR = `${CARD_SELECTOR}, ${BLOCK_SELECTOR}, ${ROW_SELECTOR}`;

/** 一批里最多同时给多少行加动画，更多的直接出现（几百行的表格不需要逐行动画）。 */
export const MAX_ROWS_PER_BATCH = 40;

/** 总览顶部的统计卡片：一张一张依次入场，每张卡片里的图标、标题、数值、说明再依次跟上。 */
export const STAT_SELECTOR = ".baka-overview-stat";
export const STAT_STEP_MS = 120;
/** 第 index 张统计卡片的等待时间：第一张跟在页面节拍之后，之后每张间隔固定的一步。 */
export function statDelay(base: number, index: number): number {
  return base + index * STAT_STEP_MS;
}

export type EntranceKind = "card" | "block" | "row";
export type EntranceSpec = { duration: number; distance: number; opacityOnly: boolean };

export function specFor(kind: EntranceKind, tag: string): EntranceSpec {
  // 表格行只做透明度：行上的位移在部分浏览器里不生效，也容易让整张表抖动。
  if (tag === "TR") return { duration: 360, distance: 0, opacityOnly: true };
  if (kind === "card") return { duration: 520, distance: 14, opacityOnly: false };
  if (kind === "row") return { duration: 360, distance: 6, opacityOnly: false };
  return { duration: 420, distance: 8, opacityOnly: false };
}

/** 去掉“被同一批里别的候选包含”的元素：卡片整体入场，里面的内容跟着它，不再各播各的。 */
export function dropNested<T>(items: T[], contains: (outer: T, inner: T) => boolean): T[] {
  return items.filter((item) => !items.some((other) => other !== item && contains(other, item)));
}

export function kindOf(element: Element): EntranceKind {
  if (element.matches(CARD_SELECTOR)) return "card";
  if (element.matches(ROW_SELECTOR)) return "row";
  return "block";
}

function reducedMotion(): boolean {
  const root = document.documentElement;
  return root.dataset.motion === "reduce" || root.dataset.performance === "low"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("animate" in Element.prototype);
}

function visible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 && !element.closest("[data-enter='skip'], dialog, .admin-rail");
}

function play(element: HTMLElement, spec: EntranceSpec, delay: number): void {
  const from: Keyframe = spec.opacityOnly ? { opacity: 0 } : { opacity: 0, transform: `translate3d(0, ${spec.distance}px, 0)` };
  const to: Keyframe = spec.opacityOnly ? { opacity: 1 } : { opacity: 1, transform: "none" };
  // backwards：等待期间保持起点，结束后不留任何效果。
  element.animate([from, to], { duration: spec.duration, delay, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
}

/** v-motion 卡片有自己的轮廓线入场，这里只替它排好先后顺序。 */
function scheduleMotionTarget(element: HTMLElement, now: number, delay: number): void {
  element.dataset.motionAssignedAt = String(now);
  element.dataset.motionSlotDelay = String(delay);
}

function playStat(element: HTMLElement, delay: number): void {
  play(element, { duration: 560, distance: 18, opacityOnly: false }, delay);
  playCardParts(element, delay);
}

export function handleAdded(roots: Element[], now = performance.now()): number {
  if (reducedMotion()) return 0;
  const found = new Set<HTMLElement>();
  for (const root of roots) {
    if (!root.isConnected) continue;
    if (root.matches(ENTRANCE_SELECTOR)) found.add(root as HTMLElement);
    for (const element of root.querySelectorAll<HTMLElement>(ENTRANCE_SELECTOR)) found.add(element);
  }
  const ordered = [...found].filter((element) => !element.dataset.entered && visible(element))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const top = dropNested(ordered, (outer, inner) => outer.contains(inner));
  let rows = 0;
  let count = 0;
  let statBase = -1;
  let statIndex = 0;
  // 统计卡片排在前面时，后面的内容从最后一张统计卡片开始出现的时刻起，按正常节拍依次进来。
  let floor = -1;
  let after = 0;
  const slot = (): number => (floor < 0 ? stagger.next(now) : floor + Math.min(after++, 4) * 70);
  for (const element of top) {
    const kind = kindOf(element);
    if (kind === "row" && ++rows > MAX_ROWS_PER_BATCH) continue;
    element.dataset.entered = "1";
    count += 1;
    if (element.matches(STAT_SELECTOR)) {
      if (statBase < 0) statBase = stagger.next(now);
      const delay = statDelay(statBase, statIndex++);
      playStat(element, delay);
      floor = delay + 90; after = 0;
      continue;
    }
    if (element.classList.contains("motion-line-target")) { scheduleMotionTarget(element, now, slot()); continue; }
    const cardDelay = slot();
    play(element, specFor(kind, element.tagName), cardDelay);
    if (kind !== "card") continue;
    // 卡片里的内容在卡片出现之后依次跟上（图标、标题、说明、表单项、按钮……）。
    playCardParts(element, cardDelay);
  }
  return count;
}

/** 盯住一个页面容器：先处理已有的内容，之后每次新增元素都单独入场。返回停止函数。 */
export function attachEntrance(root: HTMLElement): () => void {
  handleAdded([root]);
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver((records) => {
    const added: Element[] = [];
    for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) added.push(node);
    if (added.length) handleAdded(added);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

const disposers = new WeakMap<HTMLElement, () => void>();
export const adminEntranceDirective: Directive<HTMLElement> = {
  mounted(element) { disposers.set(element, attachEntrance(element)); },
  unmounted(element) { disposers.get(element)?.(); disposers.delete(element); },
};
