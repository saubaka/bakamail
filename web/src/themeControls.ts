import type { ObjectDirective } from "vue";
import { attachSurfaceLines } from './surfaceLines.ts';

type NativeControl = HTMLSelectElement | HTMLInputElement;
type Controller = { sync(): void; destroy(): void };
const controls = new WeakMap<NativeControl, Controller>();
let nextId = 0;
export function calendarDays(year: number, month: number): Array<string | null> {
  const pad = (value: number) => String(value).padStart(2, "0");
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  return [...Array<null>(leading).fill(null), ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`)];
}

function enhance(native: NativeControl): Controller {
  if (native.tagName === "INPUT" && (native as HTMLInputElement).type === "number") return enhanceNumber(native as HTMLInputElement);
  const isSelect = native.tagName === "SELECT";
  const select = native as HTMLSelectElement;
  const input = native as HTMLInputElement;
  const id = `themed-control-${++nextId}`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "themed-control";
  trigger.id = id;
  trigger.setAttribute("aria-haspopup", isSelect ? "listbox" : "dialog");
  if (isSelect) trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${id}-popup`);
  const label = native.closest("label")?.querySelector<HTMLElement>(".field__label") ?? native.labels?.[0];
  if (label) {
    if (!label.id) label.id = `${id}-label`;
    trigger.setAttribute("aria-labelledby", `${label.id} ${id}-value`);
  } else trigger.setAttribute("aria-label", native.getAttribute("aria-label") ?? (isSelect ? "选择选项" : "选择日期"));
  const text = document.createElement("span");
  text.id = `${id}-value`;
  const arrow = document.createElement("span");
  arrow.className = "themed-control__arrow";
  arrow.setAttribute("aria-hidden", "true");
  trigger.append(text, arrow);
  native.classList.add("themed-native-state");
  native.setAttribute("aria-hidden", "true");
  native.tabIndex = -1;
  native.after(trigger);
  let popup: HTMLDivElement | null = null;
  let disposeLines: (() => void) | undefined;
  let shownMonth = new Date();
  let typed = "";
  let typedAt = 0;
  let destroyed = false;

  function close(focus = false) {
    disposeLines?.(); disposeLines=undefined;
    popup?.remove(); popup = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    if (focus && !destroyed) trigger.focus({ preventScroll: true });
  }
  function outside(event: Event) { if (!popup?.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); }
  function onScroll(event: Event) { if (!popup?.contains(event.target as Node)) close(); }
  function onResize() { close(); }
  function sync() {
    if (destroyed) return;
    text.textContent = isSelect ? select.selectedOptions[0]?.textContent ?? "请选择" : input.value || "选择日期";
    trigger.disabled = native.disabled;
    if (native.disabled) close();
  }
  function choose(value: string) {
    native.value = value;
    // Preserve Vue v-model, its .number modifier, and existing application handlers.
    if (!isSelect) native.dispatchEvent(new Event("input", { bubbles: true }));
    native.dispatchEvent(new Event("change", { bubbles: true }));
    sync(); close(true);
  }
  function makeButton(label: string, action: () => void, className = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.className = className;
    button.addEventListener("click", action); return button;
  }
  function renderCalendar() {
    if (!popup) return;
    popup.replaceChildren();
    const header = document.createElement("div"); header.className = "themed-calendar__header";
    const move = (amount: number) => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + amount, 1); renderCalendar(); popup?.querySelector<HTMLButtonElement>(`[aria-label="${amount < 0 ? "上个月" : "下个月"}"]`)?.focus(); };
    const previous = makeButton("‹", () => move(-1)); previous.setAttribute("aria-label", "上个月");
    const next = makeButton("›", () => move(1)); next.setAttribute("aria-label", "下个月");
    const title = document.createElement("span"); title.textContent = `${shownMonth.getFullYear()} 年 ${shownMonth.getMonth() + 1} 月`; title.setAttribute("aria-live", "polite");
    header.append(previous, title, next); popup.append(header);
    const grid = document.createElement("div"); grid.className = "themed-calendar__grid";
    for (const day of ["一", "二", "三", "四", "五", "六", "日"]) { const span = document.createElement("span"); span.textContent = day; span.className = "themed-calendar__weekday"; grid.append(span); }
    for (const date of calendarDays(shownMonth.getFullYear(), shownMonth.getMonth())) {
      if (!date) { grid.append(document.createElement("span")); continue; }
      const button = makeButton(String(Number(date.slice(-2))), () => choose(date), "themed-calendar__day");
      button.setAttribute("aria-label", date);
      button.setAttribute("aria-pressed", String(date === input.value));
      button.disabled = Boolean(input.min && date < input.min || input.max && date > input.max);
      grid.append(button);
    }
    popup.append(grid, makeButton("清除日期", () => choose(""), "themed-calendar__clear"));
    if(popup.isConnected) disposeLines=attachSurfaceLines(popup);
  }
  function open() {
    if (trigger.disabled || popup) return;
    popup = document.createElement("div"); popup.id = `${id}-popup`;
    popup.className = isSelect ? "themed-popup themed-options" : "themed-popup themed-calendar";
    popup.setAttribute("role", isSelect ? "listbox" : "dialog");
    popup.setAttribute("aria-label", label?.textContent?.trim() ?? (isSelect ? "选择选项" : "选择日期"));
    if (isSelect) {
      for (const option of Array.from(select.options)) {
        const button = makeButton(option.textContent ?? "", () => choose(option.value), "themed-option");
        button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(option.selected));
        button.disabled = option.disabled || Boolean(option.closest("optgroup")?.disabled);
        popup.append(button);
      }
    } else {
      const value = input.value ? new Date(`${input.value}T12:00:00`) : new Date();
      shownMonth = Number.isNaN(value.getTime()) ? new Date() : value; renderCalendar();
    }
    document.body.append(popup);
    disposeLines=attachSurfaceLines(popup);
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, isSelect ? 180 : 292), window.innerWidth - 24);
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const upward = below < 240 && above > below;
    popup.style.maxHeight = `${Math.max(80, Math.min(360, upward ? above : below))}px`;
    if (upward) popup.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    else popup.style.top = `${rect.bottom + 6}px`;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    popup.addEventListener("keydown", keyboard);
    (popup.querySelector<HTMLButtonElement>('[aria-selected="true"], [aria-pressed="true"]') ?? popup.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    if (!popup && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); open(); return; }
    if (!popup) return;
    const buttons = Array.from(popup.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === "ArrowDown") next += isSelect ? 1 : 7;
    else if (event.key === "ArrowUp") next -= isSelect ? 1 : 7;
    else if (event.key === "ArrowRight" && !isSelect) next++;
    else if (event.key === "ArrowLeft" && !isSelect) next--;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (isSelect && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      typed = Date.now() - typedAt > 600 ? event.key : typed + event.key; typedAt = Date.now();
      const found = buttons.findIndex(button => button.textContent?.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()));
      if (found >= 0) next = found;
    } else return;
    event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  }
  function click(event: MouseEvent) { event.preventDefault(); if (popup) close(); else open(); }
  trigger.addEventListener("click", click);
  trigger.addEventListener("keydown", keyboard);
  native.addEventListener("change", sync);
  sync(); queueMicrotask(sync);
  return { sync, destroy() { destroyed = true; close(); trigger.remove(); native.removeEventListener("change", sync); trigger.removeEventListener("click", click); trigger.removeEventListener("keydown", keyboard); } };
}
function enhanceNumber(input: HTMLInputElement): Controller {
  const row = document.createElement("span"); row.className = "themed-number-stepper";
  input.parentElement?.classList.add("themed-number-field");
  const label = input.closest("label")?.querySelector(".field__label")?.textContent?.trim() ?? "数值";
  const buttons = [-1, 1].map(direction => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = direction < 0 ? "−" : "+";
    button.setAttribute("aria-label", `${direction < 0 ? "减少" : "增加"}${label}`);
    button.addEventListener("click", event => {
      event.preventDefault();
      try { if (direction < 0) input.stepDown(); else input.stepUp(); } catch { return; }
      input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    }); return button;
  });
  row.append(...buttons); input.after(row);
  function sync() { for (const button of buttons) button.disabled = input.disabled || input.readOnly; }
  sync();
  return { sync, destroy() { row.remove(); input.parentElement?.classList.remove("themed-number-field"); } };
}
export const themedControlDirective: ObjectDirective<NativeControl> = {
  mounted(native) { controls.set(native, enhance(native)); },
  updated(native) { queueMicrotask(() => controls.get(native)?.sync()); },
  beforeUnmount(native) { controls.get(native)?.destroy(); controls.delete(native); },
};

/** Keep browser constraint validation, replace only its unstyleable tooltip. */
export function initializeThemeValidation(): void {
  const errors = new WeakMap<HTMLInputElement, { node: HTMLSpanElement; previous: string | null }>();
  let focusing = false;
  function clear(input: HTMLInputElement) {
    const error = errors.get(input); if (!error) return;
    error.node.remove(); errors.delete(input);
    const descriptions = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && id !== error.node.id);
    if (descriptions.length) input.setAttribute("aria-describedby", descriptions.join(" ")); else input.removeAttribute("aria-describedby");
    if (error.previous === null) input.removeAttribute("aria-invalid"); else input.setAttribute("aria-invalid", error.previous);
  }
  document.addEventListener("invalid", event => {
    const input = event.target as HTMLInputElement;
    if (!input.closest("#app")) return;
    event.preventDefault();
    if (!errors.has(input)) {
      const node = document.createElement("span"); node.className = "themed-field-error"; node.id = `themed-validation-${++nextId}`; node.setAttribute("role", "alert");
      errors.set(input, { node, previous: input.getAttribute("aria-invalid") });
      input.after(node);
      input.setAttribute("aria-describedby", `${input.getAttribute("aria-describedby") ?? ""} ${node.id}`.trim());
      input.setAttribute("aria-invalid", "true");
    }
    errors.get(input)!.node.textContent = input.validity.valueMissing ? "请填写这一项" : input.validationMessage || "请检查填写内容";
    if (!focusing) {
      focusing = true;
      queueMicrotask(() => {
        focusing = false;
        const target = input.classList.contains("themed-native-state") ? input.parentElement?.querySelector<HTMLButtonElement>(".themed-control") : input;
        if (input.isConnected) target?.focus();
      });
    }
  }, true);
  for (const type of ["input", "change"]) document.addEventListener(type, event => {
    const input = event.target as HTMLInputElement;
    if (input.validity?.valid) clear(input);
  });
}
