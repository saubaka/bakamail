import { reactive } from "vue";
import { attachSurfaceLines } from './surfaceLines.ts';

/**
 * 复刻基座的弹窗动效契约。
 *
 * app.css 里 dialog.modal 默认 opacity:0，必须补上 .is-present 才会显形，
 * 关闭前要先挂 .is-closing 播退场动画。少了这两步弹窗就是「打开了但看不见」。
 */

const CLOSE_MS = 260;
const lifecycles = new WeakMap<HTMLDialogElement, { version: number; timer: number | null; lines?: () => void }>();
function lifecycle(element: HTMLDialogElement) {
  let state = lifecycles.get(element);
  if (!state) { state = { version: 0, timer: null }; lifecycles.set(element, state); }
  return state;
}

export type DialogTone = "default" | "danger";
export type DialogMode = "confirm" | "prompt";

export type DialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  fieldLabel?: string;
  placeholder?: string;
  initialValue?: string;
  inputType?: "text" | "password";
  requiredText?: string;
};

export const dialogState = reactive({
  open: false,
  mode: "confirm" as DialogMode,
  title: "",
  message: "",
  confirmLabel: "确认",
  cancelLabel: "取消",
  tone: "default" as DialogTone,
  fieldLabel: "",
  placeholder: "",
  value: "",
  inputType: "text" as "text" | "password",
  requiredText: "",
});

let resolver: ((value: boolean | string | null) => void) | null = null;

function requestDialog(mode: DialogMode, options: DialogOptions): Promise<boolean | string | null> {
  if (resolver) resolver(mode === "prompt" ? null : false);
  Object.assign(dialogState, {
    open: true,
    mode,
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel ?? (mode === "prompt" ? "继续" : "确认"),
    cancelLabel: options.cancelLabel ?? "取消",
    tone: options.tone ?? "default",
    fieldLabel: options.fieldLabel ?? "",
    placeholder: options.placeholder ?? "",
    value: options.initialValue ?? "",
    inputType: options.inputType ?? "text",
    requiredText: options.requiredText ?? "",
  });
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

export async function confirmDialog(options: DialogOptions): Promise<boolean> {
  return Boolean(await requestDialog("confirm", options));
}

export async function promptDialog(options: DialogOptions): Promise<string | null> {
  const result = await requestDialog("prompt", options);
  return typeof result === "string" ? result : null;
}

export function settleDialog(value: boolean | string | null): void {
  const resolve = resolver;
  resolver = null;
  dialogState.open = false;
  resolve?.(value);
}

export function openDialog(element: HTMLDialogElement | null | undefined): void {
  if (!element) return;
  const state = lifecycle(element);
  const version = ++state.version;
  if (state.timer !== null) window.clearTimeout(state.timer);
  state.timer = null;
  element.classList.remove("is-closing");
  if (!element.open) element.showModal();
  if (typeof document !== 'undefined') state.lines = attachSurfaceLines(element);
  requestAnimationFrame(() => {
    if (state.version === version && element.open) element.classList.add("is-present");
  });
}

export function closeDialog(element: HTMLDialogElement | null | undefined): void {
  if (!element || !element.open) return;
  const state = lifecycle(element);
  if (state.timer !== null) return;
  const version = ++state.version;
  element.classList.remove("is-present");
  element.classList.add("is-closing");
  state.timer = window.setTimeout(() => {
    if (state.version !== version) return;
    state.timer = null;
    element.classList.remove("is-closing");
    if (element.open) element.close();
    state.lines?.(); state.lines=undefined;
  }, CLOSE_MS);
}
