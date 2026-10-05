import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { folderLabel, folderPathLabel, type Folder } from "../src/mail/types.ts";
import { smoothHeightDirective } from "../src/smoothHeight.ts";
import { pressFeedbackDirective, submitPressFrames } from "../src/pressFeedback.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function folder(path: string, name: string, specialUse: string | null = null): Folder { return { path, name, specialUse, subscribed: true, messages: 0, unseen: 0 }; }
test("搜索与菜单统一系统文件夹中文名称，自建文件夹与结果来源按真实路径映射", () => {
  const folders = [folder("INBOX", "INBOX"), folder("Sent", "Sent", "\\Sent"), folder("Drafts", "Drafts", "\\Drafts"), folder("Archive", "Archive", "\\Archive"), folder("Junk", "Junk", "\\Junk"), folder("Trash", "Trash", "\\Trash"), folder("project/notes", "项目笔记"), folder("work/Sent", "Sent")];
  assert.deepEqual(folders.map(folderLabel), ["收件箱", "已发送", "草稿", "归档", "垃圾邮件", "已删除", "项目笔记", "Sent"]);
  assert.equal(folderPathLabel("project/notes", folders), "项目笔记");
  assert.equal(folderPathLabel("Archive", folders), "归档");
  assert.equal(folderPathLabel("unknown", folders), "unknown");
  const search = source("src/views/SearchView.vue");
  assert.match(search, /folderLabel\(folder\)/); assert.match(search, /folderPathLabel\(resultFolder.value, folders.value\)/);
  assert.match(search, /folder: resultFolder.value, uid: String\(uid\)/);
});
test("菜单以圆点缩放展开，仅动画 transform/opacity，360ms 入场、240ms退场及260ms保护计时一致", () => {
  const css = source("src/styles/workspace.css");
  assert.match(css, /dock-menu-in 360ms/); assert.match(css, /dock-menu-out 240ms/);
  for (const name of ["dock-menu-in", "dock-menu-out"]) {
    const line = css.split("\n").find(value => value.startsWith(`@keyframes ${name}`))!;
    assert.doesNotMatch(line, /border-radius|filter|width|height|background/);
  }
  assert.match(source("src/components/MailWorkspace.vue"), /reduced\(\) \? 0 : 260/);
  assert.doesNotMatch(source("src/components/mail/FolderRail.vue"), /v-motion/);
});
test("批量操作不再条件插入，展开与收回同时改变列表空间并隐藏不可聚焦控件", () => {
  const rows = source("src/components/mail/MessageListPane.vue");
  assert.doesNotMatch(rows, /v-if="selectedUids.length > 0" class="mail-toolbar"/);
  assert.match(rows, /class="mail-bulk-slot"/); assert.match(rows, /:inert="selectedUids.length === 0"/);
  const css = source("src/styles/workspace.css"); assert.match(css, /grid-template-rows: 0fr/); assert.match(css, /mail-bulk-slot.is-open \{ grid-template-rows: 1fr/);
});
test("空条件使用统一水滴通知，日期提示位于搜索按钮之前，旧结果在请求中保留", () => {
  const search = source("src/views/SearchView.vue");
  assert.match(search, /toast\("请至少填写一个关键词、日期或状态条件", "warning"\)/);
  assert.doesNotMatch(search, /error.value = "请至少填写/);
  assert.ok(search.indexOf("如起始/截止日期未选择，则默认不约束时间范围") < search.indexOf('class="button button--primary mail-search-submit'));
  assert.doesNotMatch(search, /<div v-if="busy" class="mail-empty"/);
  assert.match(search, /if \(await searchStore.run\(input\)\)/); assert.match(search, /resultsRevision.value\+\+/);
});
test("结果高度观察更新且卸载清理，减少动画由 CSS 降级", () => {
  const previous = globalThis.ResizeObserver; let callback = () => {}; let disconnected = 0; let height = 90;
  const inner = { getBoundingClientRect: () => ({ height }) };
  const element = { firstElementChild: inner, style: { height: "" } };
  globalThis.ResizeObserver = class { constructor(fn: () => void) { callback = fn; } observe(target: unknown) { assert.equal(target, inner); } disconnect() { disconnected++; } } as unknown as typeof ResizeObserver;
  try {
    (smoothHeightDirective.mounted as Function)(element); assert.equal(element.style.height, "90px");
    height = 240; callback(); assert.equal(element.style.height, "240px");
    (smoothHeightDirective.beforeUnmount as Function)(element); assert.equal(disconnected, 1);
  } finally { globalThis.ResizeObserver = previous; }
  assert.match(source("src/styles/search-motion.css"), /prefers-reduced-motion/);
});
test("提交按钮快速回弹与滑光状态播放，卸载取消动画并清理状态", () => {
  const previousDocument = globalThis.document; const previousMedia = globalThis.matchMedia;
  let click = () => {}; let cancelled = 0; const classes = new Set<string>();
  const element = { classList: { add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value) },
    addEventListener(_name: string, listener: () => void) { click = listener; }, removeEventListener() {},
    animate(frames: unknown, options: KeyframeAnimationOptions) { assert.deepEqual(frames, submitPressFrames); assert.equal(options.duration, 240); return { cancel() { cancelled++; } }; } };
  try {
    globalThis.document = { documentElement: { dataset: {} } } as unknown as Document;
    globalThis.matchMedia = (() => ({ matches: false })) as unknown as typeof matchMedia;
    (pressFeedbackDirective.mounted as Function)(element, { value: "submit" }); click(); assert.equal(classes.has("is-action-pressing"), true);
    (pressFeedbackDirective.beforeUnmount as Function)(element); assert.equal(cancelled, 1); assert.equal(classes.size, 0);
  } finally { globalThis.document = previousDocument; globalThis.matchMedia = previousMedia; }
  for (const view of ["SearchView", "LoginView"]) assert.match(source(`src/views/${view}.vue`), /v-press-feedback="'submit'"/);
});
