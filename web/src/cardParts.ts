/**
 * 卡片入场后，里面的内容（图标、标题、说明、数值、表单项、按钮……）按从上到下的顺序依次跟上。
 * 所有卡片共用这一套：后台、登录注册、设置、联系人、草稿等页面的卡片都走这里。
 */
export const PARTS_START_MS = 110;
export const PARTS_STEP_MS = 70;
export const PARTS_MAX_STEPS = 8;
export const PARTS_MAX_COUNT = 24;
export const PART_DURATION_MS = 420;

/** 本身就是一个“整体”的元素，不再往里拆。 */
const UNIT_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "SMALL", "STRONG", "EM", "LABEL", "BUTTON", "A", "UL", "OL", "DL", "TABLE", "PRE",
  "SVG", "IMG", "INPUT", "SELECT", "TEXTAREA", "CANVAS", "FIGURE", "BLOCKQUOTE", "CODE", "TIME",
]);
/** 带背景的小图标、头像、徽标、状态标签：整体入场，不拆开里面的图形。 */
const UNIT_CLASS = /(^|[\s_-])(icon|logo|avatar|badge|pill|chip|status|tag|button|table-scroll|toggle|switch|seo-preview|hv-chart|range-tabs|field|check-row|permission-list|log-block|eyebrow)([\s_-]|$)/;
/** 自己会入场的东西（外轮廓、嵌套的卡片、对话框），不在这里重复处理。 */
const SKIP_CLASS = /(^|\s)(motion-outline|motion-line-target|admin-panel|managed-page-card|baka-overview-stat|login-card|auth-card)(\s|$)/;

export type PartNode = {
  tagName: string;
  className?: unknown;
  children: ArrayLike<PartNode>;
  childNodes: ArrayLike<{ nodeType: number; textContent: string | null }>;
  hidden?: boolean;
};

function classText(node: PartNode): string {
  const value = node.className as unknown;
  if (typeof value === "string") return value;
  if (value && typeof (value as { baseVal?: unknown }).baseVal === "string") return (value as { baseVal: string }).baseVal;
  return "";
}

function hasOwnText(node: PartNode): boolean {
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i]!;
    if (child.nodeType === 3 && (child.textContent ?? "").trim() !== "") return true;
  }
  return false;
}

function isUnit(node: PartNode): boolean {
  if (UNIT_TAGS.has(node.tagName.toUpperCase())) return true;
  if (UNIT_CLASS.test(classText(node))) return true;
  return node.children.length === 0 || hasOwnText(node);
}

/**
 * 按文档顺序找出卡片里的内容单元：能整体入场的元素直接取，纯容器继续往里找。
 * isShown 用来跳过没有显示出来的元素；最多取 PARTS_MAX_COUNT 个。
 */
export function collectCardParts<T extends PartNode>(card: T, isShown: (node: T) => boolean = () => true, max = PARTS_MAX_COUNT): T[] {
  const parts: T[] = [];
  const visit = (node: T): void => {
    for (let i = 0; i < node.children.length && parts.length < max; i += 1) {
      const child = node.children[i] as T;
      if (child.hidden || SKIP_CLASS.test(classText(child)) || child.tagName.toUpperCase() === "DIALOG") continue;
      if (!isShown(child)) continue;
      if (isUnit(child)) parts.push(child);
      else visit(child);
    }
  };
  visit(card);
  return parts;
}

/** 第 index 个内容单元相对卡片开始入场的等待时间。 */
export function partOffset(index: number): number {
  return PARTS_START_MS + Math.min(index, PARTS_MAX_STEPS) * PARTS_STEP_MS;
}

function isRendered(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** 让卡片里的内容依次入场；baseDelay 是卡片自己开始入场的等待时间。返回处理了多少个单元。 */
export function playCardParts(card: HTMLElement, baseDelay = 0): number {
  if (card.closest("[data-card-parts='off'], .mail-pane")) return 0;
  const parts = collectCardParts(card, isRendered);
  parts.forEach((part, index) => {
    part.dataset.entered = "1";
    const scale = /(^|[\s_-])(icon|logo|avatar)([\s_-]|$)/.test(classText(part));
    const from: Keyframe = scale ? { opacity: 0, transform: "translate3d(0, 6px, 0) scale(.72)" } : { opacity: 0, transform: "translate3d(0, 8px, 0)" };
    part.animate([from, { opacity: 1, transform: "none" }], {
      duration: PART_DURATION_MS, delay: baseDelay + partOffset(index), easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards",
    });
  });
  return parts.length;
}
