import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { decodeMailCache, writeMailCache, readMailCache, purgeMailCaches, type MailCache } from "../src/mail/localCache.ts";
import { useMailboxStore } from "../src/stores/mailbox.ts";
import { calendarDays, initializeThemeValidation } from "../src/themeControls.ts";
import { createNotificationQueue, type Notification } from "../src/notifications.ts";
import { rowRevealDirective } from "../src/mail/rowReveal.ts";

function storage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null, getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); }, clear: () => data.clear() };
}
function fixture(): MailCache {
  return { version: 1, owner: "qa@example.test", savedAt: Date.now(), folder: "INBOX",
    folders: [{ path: "INBOX", name: "INBOX", specialUse: null, subscribed: true, messages: 1, unseen: 1 }],
    pages: [["INBOX\u000050", { total: 1, nextBefore: null, items: [{ uid: 7, subject: "测试摘要", from: [], to: [], date: null, size: 1, seen: false, flagged: false, answered: false, hasAttachments: false }] }]] };
}
test("本地缓存按邮箱隔离，只保留允许的摘要，丢弃正文/凭证扩展字段", () => {
  const cache = fixture();
  Object.assign(cache.pages[0]![1].items[0]!, { html: "private", password: "private", attachments: ["private"] });
  const target = storage();
  assert.equal(writeMailCache(cache, target), true);
  assert.deepEqual(Object.keys(readMailCache(cache.owner, target)!.pages[0]![1].items[0]!).sort(), ["uid", "subject", "from", "to", "date", "size", "seen", "flagged", "answered", "hasAttachments"].sort());
  assert.equal(readMailCache("someone-else@example.test", target), null);
  assert.equal(decodeMailCache(JSON.stringify(cache), "someone-else@example.test"), null);
});
test("损坏/过期/未来/超大/结构异常缓存均拒绝，存储不可用不会阻断邮箱", () => {
  const cache = fixture();
  assert.equal(decodeMailCache("not-json", cache.owner), null);
  assert.equal(decodeMailCache(JSON.stringify(cache), cache.owner, cache.savedAt + 8 * 86400000), null);
  assert.equal(decodeMailCache(JSON.stringify(cache), cache.owner, cache.savedAt - 120000), null);
  assert.equal(decodeMailCache("x".repeat(2000001), cache.owner), null);
  cache.pages[0]![1].items[0]!.uid = -1;
  assert.equal(decodeMailCache(JSON.stringify(cache), cache.owner), null);
  const unavailable = { getItem() { throw Error("denied"); }, setItem() { throw Error("quota"); } } as unknown as Storage;
  assert.equal(readMailCache(cache.owner, unavailable), null);
  assert.equal(writeMailCache(fixture(), unavailable), false);
});
test("登出清理只清理邮件列表前缀，不删除主题偏好或其他应用数据", () => {
  const target = storage(); writeMailCache(fixture(), target);
  target.setItem("other-app", "keep"); target.setItem("bakamail:motion", "reduce");
  purgeMailCaches(target);
  assert.equal(target.length, 2); assert.equal(target.getItem("other-app"), "keep");
});
test("刷新后的新 store 先还原缓存；失败保留摘要，成功解除写操作限制并更新磁盘", async () => {
  const previousStorage = globalThis.localStorage; const previousFetch = globalThis.fetch;
  const target = storage(); globalThis.localStorage = target;
  const cache = fixture(); writeMailCache(cache, target);
  setActivePinia(createPinia()); const store = useMailboxStore();
  try {
    assert.equal(store.restoreLocal(cache.owner, "50"), true);
    assert.equal(store.cachedOnly, true); assert.equal(store.messages[0]?.uid, 7);
    globalThis.fetch = async () => { throw Error("offline"); };
    await assert.rejects(store.loadMessages("50"));
    assert.equal(store.messages[0]?.uid, 7); assert.equal(store.cachedOnly, true); assert.equal(store.fetchingList, false);
    globalThis.fetch = async () => Response.json({ ok: true, data: { ...cache.pages[0]![1], items: [{ ...cache.pages[0]![1].items[0]!, uid: 8 }] }, error: "" });
    await store.loadMessages("50");
    assert.equal(store.cachedOnly, false); assert.equal(readMailCache(cache.owner, target)?.pages[0]?.[1].items[0]?.uid, 8);
    store.suspend(); assert.equal(store.restoreLocal(cache.owner, "50"), true); assert.equal(store.cachedOnly, true);
    await store.loadMessages("50"); assert.equal(store.cachedOnly, false);
    store.patchMessages("INBOX", [8], { seen: true });
    assert.equal(readMailCache(cache.owner, target)?.pages[0]?.[1].items[0]?.seen, true);
    store.clear(); assert.equal(readMailCache(cache.owner, target), null);
  } finally { globalThis.localStorage = previousStorage; globalThis.fetch = previousFetch; }
});
test("缓存页大小降级截取时保留正确游标，不跨账号复用缓存", () => {
  const previous = globalThis.localStorage; const target = storage(); globalThis.localStorage = target;
  const cache = fixture(); cache.pages[0]![1].items = Array.from({ length: 30 }, (_, i) => ({ ...cache.pages[0]![1].items[0]!, uid: 100 - i }));
  cache.pages[0]![1].total = 30; writeMailCache(cache, target);
  try {
    setActivePinia(createPinia()); const store = useMailboxStore();
    assert.equal(store.restoreLocal(cache.owner, "25"), true); assert.equal(store.messages.length, 25); assert.equal(store.nextBefore, 76);
    assert.equal(store.restoreLocal("another@example.test", "25"), false); assert.equal(store.messages.length, 0);
  } finally { globalThis.localStorage = previous; }
});
test("后台拉取确认 401 后立即移除磁盘摘要，不能用过期缓存继续显示邮件", async () => {
  const previousStorage = globalThis.localStorage; const previousFetch = globalThis.fetch;
  const target = storage(); globalThis.localStorage = target; const cache = fixture(); writeMailCache(cache, target);
  setActivePinia(createPinia()); const store = useMailboxStore();
  try {
    store.restoreLocal(cache.owner, "50");
    globalThis.fetch = async () => Response.json({ ok: false, data: null, error: "会话过期" }, { status: 401 });
    await assert.rejects(store.loadMessages("50"));
    assert.equal(store.messages.length, 0); assert.equal(store.account, ""); assert.equal(readMailCache(cache.owner, target), null);
  } finally { globalThis.localStorage = previousStorage; globalThis.fetch = previousFetch; }
});
test("自建日历按周一排列，正确处理闰年与跨月日期", () => {
  const leap = calendarDays(2024, 1); assert.equal(leap.at(-1), "2024-02-29"); assert.equal(leap.filter(Boolean).length, 29);
  assert.equal(calendarDays(2026, 8)[0], null); assert.equal(calendarDays(2026, 8)[1], "2026-09-01");
  assert.equal(calendarDays(2026, 11).at(-1), "2026-12-31");
});
test("主题内联校验保留原生校验阻断，关联错误说明，修正后清理且不影响已有 ARIA", async () => {
  const previous = globalThis.document; const listeners = new Map<string, (event: unknown) => void>();
  let removed = 0; let inserted = 0; let focused = 0; let prevented = 0;
  const attributes = new Map<string, string>([["aria-describedby", "original-help"]]);
  const input = { closest: () => ({}), after() { inserted++; }, getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key),
    validity: { valueMissing: true, valid: false }, validationMessage: "", classList: { contains: () => false }, isConnected: true, focus() { focused++; } };
  globalThis.document = { addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    createElement: () => ({ className: "", id: "", textContent: "", setAttribute() {}, remove() { removed++; } }) } as unknown as Document;
  try {
    initializeThemeValidation();
    const event = { target: input, preventDefault() { prevented++; } };
    listeners.get("invalid")!(event); listeners.get("invalid")!(event); await Promise.resolve();
    assert.equal(prevented, 2); assert.equal(inserted, 1); assert.equal(focused, 1); assert.equal(attributes.get("aria-invalid"), "true");
    assert.match(attributes.get("aria-describedby")!, /^original-help themed-validation-/);
    input.validity.valid = true; listeners.get("input")!(event);
    assert.equal(removed, 1); assert.equal(attributes.get("aria-describedby"), "original-help"); assert.equal(attributes.has("aria-invalid"), false);
  } finally { globalThis.document = previous; }
});
test("所有下拉框和日期输入都接入自建控件，附件入口与 checkbox 使用主题样式", () => {
  const root = new URL("../src/", import.meta.url);
  const walk = (url: URL): string[] => readdirSync(url, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(new URL(`${entry.name}/`, url)) : entry.name.endsWith(".vue") ? [readFileSync(new URL(entry.name, url), "utf8")] : []);
  const source = walk(root).join("\n");
  for (const tag of source.match(/<select\b[^>]*>|<input\b[^>]*type="(?:date|number)"[^>]*>/g) ?? []) assert.match(tag, /v-theme-control/);
  assert.match(source, /compose-file-input/);
  const css = readFileSync(new URL("../src/styles/theme-controls.css", import.meta.url), "utf8"); assert.match(css, /appearance: none !important/);
});
test("邮件行共享列表观察器，滚入/滚出/重入均可逆，卸载后不接收迟到观察", () => {
  const previousObserver = globalThis.IntersectionObserver; const previousDocument = globalThis.document;
  let callback: (entries: unknown[]) => void = () => {}; let created = 0; let disconnected = 0; let unobserved = 0;
  const root = {}; const classes = new Set<string>(); let offset = "";
  const row = { dataset: {} as Record<string, string>, closest: () => root, contains: () => false, style: { setProperty(_name: string, value: string) { offset = value; } },
    classList: { add(value: string) { classes.add(value); }, toggle(value: string, on: boolean) { if (on) classes.add(value); else classes.delete(value); } } };
  globalThis.document = { activeElement: null } as unknown as Document;
  globalThis.IntersectionObserver = class { constructor(fn: (entries: unknown[]) => void) { callback = fn; created++; } observe() {} unobserve() { unobserved++; } disconnect() { disconnected++; } } as unknown as typeof IntersectionObserver;
  const entry = (visible: boolean, top = 100) => [{ target: row, isIntersecting: visible, intersectionRatio: visible ? .8 : 0, boundingClientRect: { top }, rootBounds: { top: 50 } }];
  try {
    (rowRevealDirective.mounted as Function)(row); assert.equal(created, 1);
    callback(entry(true)); assert.equal(row.dataset.rowReveal, "visible");
    callback(entry(false, 0)); assert.equal(row.dataset.rowReveal, "outside"); assert.equal(offset, "-12px");
    callback(entry(true)); assert.equal(row.dataset.rowReveal, "visible");
    (rowRevealDirective.beforeUnmount as Function)(row); callback(entry(false));
    assert.equal(row.dataset.rowReveal, "visible"); assert.equal(disconnected, 1); assert.equal(unobserved, 1);
  } finally { globalThis.IntersectionObserver = previousObserver; globalThis.document = previousDocument; }
});
test("移动底部菜单等待退场再 SPA 跳转；列表有内部滚动和逐项补入，旧数量线隐藏", () => {
  const css = readFileSync(new URL("../src/styles/workspace.css", import.meta.url), "utf8");
  assert.match(css, /dock-menu-out/); assert.match(css, /overflow-y: auto/); assert.match(css, /mail-count-line \{ display:none/);
  const rows = readFileSync(new URL("../src/components/mail/MessageListPane.vue", import.meta.url), "utf8");
  assert.match(rows, /v-row-reveal/); assert.match(rows, /setTimeout\(fillNext, 26\)/); assert.doesNotMatch(rows, /加载更多<\/button>/);
  const rail = readFileSync(new URL("../src/components/mail/FolderRail.vue", import.meta.url), "utf8"); assert.match(rail, /:disabled="navigationBusy"/);
  const errorView = readFileSync(new URL("../src/views/ServiceUnavailableView.vue", import.meta.url), "utf8"); assert.doesNotMatch(errorView, /location\.(assign|reload|replace)/);
  assert.match(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8"), /emptyOutDir: false/);
});
test("同步通知不被同文字去重，进度结果沿用同一个通知状态", () => {
  const notices: Notification[] = []; const done: Array<() => void> = [];
  const queue = createNotificationQueue((notice, finish) => { notices.push(notice); done.push(finish); });
  const progress = { version: 0, listeners: new Set<() => void>() };
  queue.push({ message: "正在拉取邮件…", tone: "success", progress });
  queue.push({ message: "正在拉取邮件…", tone: "success", progress: { version: 0, listeners: new Set() } });
  Object.assign(progress, { message: "已同步", tone: "success" }); assert.equal(notices[0]?.progress?.message, "已同步");
  done[0]!(); assert.equal(notices.length, 2);
});
