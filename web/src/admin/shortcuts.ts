import { RAIL_ITEMS } from "./navModel.ts";

/** 连按 `g` 再按页面字母的等待时间。 */
export const SEQUENCE_WINDOW_MS = 1200;

export type ShortcutKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
};

export type ShortcutResult =
  | { type: "palette"; armedUntil: 0 }
  | { type: "arm"; armedUntil: number }
  | { type: "go"; name: string; armedUntil: 0 }
  | { type: "none"; armedUntil: number };

/** 正在输入文字时，单个字母键不能触发快捷键。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true
    || (typeof element.closest === "function" && element.closest("[contenteditable='true']") !== null);
}

/**
 * 纯函数，便于测试：
 * - Ctrl/⌘ + K 在任何位置都打开跳转面板；
 * - 不在输入框里时，`g` 之后 1.2 秒内按页面字母直达该页；
 * - 其他任何按键取消等待，带修饰键的组合不会被当作单字母快捷键。
 */
export function resolveShortcut(
  event: ShortcutKeyEvent,
  can: (permission: string) => boolean,
  armedUntil: number,
  now: number,
): ShortcutResult {
  if (event.isComposing) return { type: "none", armedUntil: 0 };
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key === "k") return { type: "palette", armedUntil: 0 };
  if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return { type: "none", armedUntil: 0 };
  if (key === "Shift") return { type: "none", armedUntil };
  const armed = armedUntil > now;
  if (armed) {
    const item = RAIL_ITEMS.find((candidate) => candidate.shortcut === key && can(candidate.permission));
    if (item && !event.shiftKey) return { type: "go", name: item.name, armedUntil: 0 };
    return { type: "none", armedUntil: 0 };
  }
  if (key === "g" && !event.shiftKey) return { type: "arm", armedUntil: now + SEQUENCE_WINDOW_MS };
  return { type: "none", armedUntil: 0 };
}
