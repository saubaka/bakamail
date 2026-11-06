import { RAIL_ITEMS } from "./navModel.ts";

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

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true
    || (typeof element.closest === "function" && element.closest("[contenteditable='true']") !== null);
}

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
