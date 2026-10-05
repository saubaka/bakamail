import assert from "node:assert/strict";
import test from "node:test";
import { openDialog, closeDialog } from "../src/dialog.ts";

test("弹窗重复关闭共享计时器；重新打开作废旧关闭和旧入场回调", () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalRaf = globalThis.requestAnimationFrame;
  const frames: FrameRequestCallback[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  } });
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  const classes = new Set<string>(); let closed = 0; let opened = 0;
  const element = { open: false, classList: { add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value) },
    showModal() { this.open = true; opened += 1; }, close() { this.open = false; closed += 1; } };
  const dialog = element as unknown as HTMLDialogElement;
  try {
    openDialog(dialog); closeDialog(dialog); closeDialog(dialog);
    assert.equal(timers.size, 1);
    const oldClose = [...timers.values()][0]!;
    frames[0]!(0); assert.equal(classes.has("is-present"), false);
    openDialog(dialog); assert.equal(timers.size, 0);
    frames[1]!(0); assert.equal(classes.has("is-present"), true); assert.equal(classes.has("is-closing"), false);
    oldClose(); assert.equal(element.open, true); assert.equal(closed, 0); assert.equal(opened, 1);
    closeDialog(dialog); const finalClose = [...timers.values()][0]!; finalClose();
    assert.equal(element.open, false); assert.equal(closed, 1);
    openDialog(dialog); frames[2]!(0); assert.equal(opened, 2); assert.equal(classes.has("is-present"), true);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    globalThis.requestAnimationFrame = originalRaf;
  }
});
