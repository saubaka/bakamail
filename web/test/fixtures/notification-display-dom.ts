import { disposeNotifications } from '../../src/notifications.ts';
import { applySavedUiConfig } from '../../src/notificationConfig.ts';
import { defaultUiConfigV2 } from '../../../shared/notificationDisplay.ts';

/** Isolated DOM for timer probes. Never mounts Vue, requests an API, or opens a real mailbox. */
class ProbeElement extends EventTarget {
  readonly tag: string;
  constructor(tag = 'div') { super(); this.tag = tag; }
  children: ProbeElement[] = [];
  parentElement: ProbeElement | null = null;
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  props = new Map<string, string>();
  attrs = new Map<string, string>();
  textContent = '';
  tabIndex = -1;
  inert = false;
  disabled = false;
  offsetHeight = 56;
  hovered = false;
  get className() { return [...this.classes].join(' '); }
  set className(value: string) { this.classes = new Set(value.split(' ')); }
  classList = {
    add: (...names: string[]) => names.forEach(name => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, enabled: boolean) => { if (enabled) this.classes.add(name); else this.classes.delete(name); },
  };
  style = { setProperty: (key: string, value: string) => this.props.set(key, value) };
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  getAttribute(key: string) { return this.attrs.get(key) ?? null; }
  removeAttribute(key: string) { this.attrs.delete(key); }
  get id() { return this.attrs.get('id') ?? ''; }
  set id(value: string) { this.attrs.set('id', value); }
  get isConnected(): boolean { return this === (globalThis.document?.body as unknown) || Boolean(this.parentElement?.isConnected); }
  cloneNode(deep = false): ProbeElement {
    const copy = new ProbeElement(this.tag); copy.textContent = this.textContent; copy.attrs = new Map(this.attrs);
    if (deep) copy.append(...this.children.map(child => child.cloneNode(true))); return copy;
  }
  querySelectorAll(selector: string): ProbeElement[] { return this.children.flatMap(child => [ ...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector) ]); }
  append(...nodes: ProbeElement[]) {
    for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null;
  }
  contains(node: unknown): boolean { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector: string) { return selector === ':hover' && this.hovered; }
  closest(selector: string): ProbeElement | null { return selector.split(',').includes(this.tag) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelector(_selector: string) { return null; }
  focus() { (globalThis.document as unknown as { activeElement: unknown }).activeElement = this; }
}

export function createNotificationDisplayProbeDom(options: { reduced?: boolean } = {}) {
  const previous = { document: globalThis.document, window: globalThis.window, matchMedia: globalThis.matchMedia,
    MutationObserver: globalThis.MutationObserver, ResizeObserver: globalThis.ResizeObserver };
  const body = new ProbeElement(), region = new ProbeElement(), root = new ProbeElement();
  // Remove animation time from the probe, leaving only the requested reading duration.
  root.dataset.motion = options.reduced === false ? 'system' : 'reduce'; body.append(region);
  const document = Object.assign(new EventTarget(), { documentElement: root, body, hidden: false, focused: true, activeElement: null as ProbeElement | null,
    hasFocus: (): boolean => document.focused, createElement: (tag: string) => new ProbeElement(tag), getElementById: (id: string) => id === 'toast-region' ? region : null,
    querySelectorAll: () => [] });
  globalThis.document = document as unknown as Document;
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis;
  const media = Object.assign(new EventTarget(), { matches: options.reduced !== false });
  globalThis.matchMedia = (() => media) as unknown as typeof matchMedia;
  globalThis.MutationObserver = class { observe() {} disconnect() {} } as unknown as typeof MutationObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
  return { region, document, root, media, window: globalThis.window, restore() { disposeNotifications(); Object.assign(globalThis, previous); applySavedUiConfig(defaultUiConfigV2()); } };
}

export async function flushNotificationDisplayProbe() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
