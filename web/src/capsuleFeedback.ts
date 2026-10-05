import type { ObjectDirective } from 'vue';
import { notify, type NoticeOptions, type NotificationTone } from './notifications.ts';
export type CapsuleFeedbackOptions = NoticeOptions & { tone?: NotificationTone };
type Source = { signature: string; controller: AbortController; defaultTone: NotificationTone; options?: CapsuleFeedbackOptions; outerSignal?: AbortSignal;
  unlink?: () => void; form?: HTMLFormElement };
const published = new WeakMap<HTMLElement, Source>();
let nextId = 0;

/** Durable description survives a timed capsule; field validation stays independently associated. */
function publish(el: HTMLElement, state: Source) {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('button').forEach(button => button.remove());
  const text = copy.textContent?.trim() ?? '';
  const tone = state.options?.tone ?? state.defaultTone;
  const signature = JSON.stringify([text, tone, state.options?.manualReason, state.options?.action?.label]);
  el.classList.add('capsule-feedback-source'); el.removeAttribute('aria-hidden');
  el.removeAttribute('role'); el.setAttribute('aria-live', 'off'); // Only capsule announces; source remains a description.
  if (state.signature === signature && state.outerSignal === state.options?.signal) return;
  state.unlink?.(); state.controller.abort();
  state.controller = new AbortController(); state.signature = signature;
  const local = state.controller;
  const abort = () => local.abort(), outerSignal = state.outerSignal = state.options?.signal;
  if (outerSignal?.aborted) abort(); else outerSignal?.addEventListener('abort', abort, { once: true });
  state.unlink = () => outerSignal?.removeEventListener('abort', abort);
  const action = state.options?.action;
  if (text) notify(text, tone, { ...state.options, signal: local.signal,
    ...(action ? { action: { label: action.label, run: async () => {
      if (!el.isConnected || local.signal.aborted) return;
      await state.options?.action?.run();
    } } } : {}) });
}
export const capsuleFeedbackDirective: ObjectDirective<HTMLElement, CapsuleFeedbackOptions | undefined> = {
  mounted(el, binding) {
    const state: Source = { signature: '', controller: new AbortController(), defaultTone: el.getAttribute('role') === 'status' ? 'info' : 'error', options: binding.value };
    if (!el.id) el.id = `capsule-feedback-${++nextId}`;
    state.form = el.closest('form') ?? undefined;
    if (state.form) {
      const descriptions = new Set((state.form.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
      descriptions.add(el.id); state.form.setAttribute('aria-describedby', [...descriptions].join(' '));
    }
    published.set(el, state); publish(el, state);
  },
  updated(el, binding) {
    const state = published.get(el); if (!state) return;
    state.options = binding.value;
    queueMicrotask(() => { if (el.isConnected && published.get(el) === state) publish(el, state); });
  },
  beforeUnmount(el) {
    const state = published.get(el); if (!state) return;
    published.delete(el); state.unlink?.(); state.controller.abort();
    if (state.form) {
      const descriptions = (state.form.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== el.id);
      if (descriptions.length) state.form.setAttribute('aria-describedby', descriptions.join(' '));
      else state.form.removeAttribute('aria-describedby');
    }
  },
};
