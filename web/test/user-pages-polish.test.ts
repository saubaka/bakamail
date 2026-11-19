import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pinLeavingItem } from "../src/listMotion.ts";

const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("左侧菜单栏是一张独立的圆角卡片：四周细线、大圆角、柔和阴影，与右侧容器同一套卡片样式", () => {
  const css = source("styles/workspace.css");
  const sidebar = rule(css, ".dock-menu.is-desktop-sidebar");
  assert.match(sidebar, /border: 1px solid var\(--card-line\); border-radius: var\(--r-xl\); background: var\(--surface\); box-shadow: var\(--shadow-1\)/);
  assert.match(rule(source("styles/mail.css"), ".mail-pane"), /border: 1px solid var\(--card-line\); border-radius: var\(--r-xl\); background: var\(--surface\); box-shadow: var\(--shadow-1\)/);
});

test("工具页卡片高度由内容决定，不再被基座的 264px 最小高度撑高；编辑联系人的卡片与列表等宽", () => {
  const css = source("styles/mail-pages.css");
  assert.match(css, /\.mail-utility-shell \.managed-page-card \{ min-height: 0; height: auto; \}/);
  assert.doesNotMatch(css, /min-height: 264px/);
  assert.match(css, /\.contact-editor-panel \{ max-width: none; \}/);
});

test("搜索表单：关键词独占一行，其余四项整齐排成一行，窄屏依次变成两列和一列", () => {
  const css = source("styles/mail-pages.css");
  assert.match(css, /\.mail-search-form \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.mail-search-query \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /@media \(max-width: 980px\) \{\s*\.mail-search-form \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  const narrow = css.slice(css.indexOf("@media (max-width: 560px) {"));
  assert.match(narrow, /^@media \(max-width: 560px\) \{[\s\S]*?\.mail-search-form, \.settings-grid, \.detail-grid \{ grid-template-columns: 1fr; \}/);
});

test("选择框、日期框与输入框同高同圆角同字号，聚焦样式一致；手机上输入框字号 16px 避免 iOS 自动放大", () => {
  const css = source("styles/theme-controls.css");
  assert.match(css, /\.themed-control \{[^}]*min-height: 44px; padding: 0 14px; border: 1\.5px solid var\(--line\); border-radius: var\(--r-m\);[^}]*font-size: 14px;/);
  const fields = source("styles/theme/primitives.css");
  assert.match(fields, /min-height: 44px; padding: 10px 14px; border: 1\.5px solid var\(--line\); border-radius: var\(--r-m\);[^}]*font-size: 14px;/);
  assert.match(css, /\.themed-control:focus-visible \{ border-color: var\(--blue-400\); outline: none; box-shadow: var\(--ring\); \}/);
  assert.match(fields, /:focus, \.form-stack textarea:focus \{ border-color: var\(--blue-400\); background: var\(--surface\); box-shadow: var\(--ring\); \}/);
  assert.match(css, /@media \(max-width: 900px\) \{[^}]*textarea, select\),\s*#app \.field \.themed-control \{ font-size: 16px; \}/);
});

test("联系人、草稿、设置：列表增减和提示出现都平滑过渡，不再瞬间跳动；卡片滚动时入场出场", () => {
  const contacts = source("views/ContactsView.vue");
  const drafts = source("views/DraftsView.vue");
  const settings = source("views/SettingsView.vue");
  const search = source("views/SearchView.vue");
  for (const view of [contacts, drafts]) {
    assert.match(view, /<SmoothBlock>/);
    assert.match(view, /<transition-group name="card-list"[^>]*@before-leave="pinLeavingItem"/);
    assert.match(view, /v-scroll-reveal/);
    assert.match(view, /<transition name="card-list-swap">/);
  }
  assert.match(settings, /<SmoothBlock>[\s\S]*<transition-group name="card-list-swap"/);
  assert.match(search, /<button v-for="item in results" :key="item\.uid" v-scroll-reveal/);
  for (const view of [contacts, drafts, settings, search]) assert.doesNotMatch(view, /reversible: false/);
  assert.match(drafts, /drafts\.value = drafts\.value\.filter\(\(item\) => item\.id !== id\)/);
  assert.match(drafts, /loading && drafts\.length === 0/);
});

test("联系人点编辑：把编辑区带到眼前并聚焦名字框（页面在滚动容器里，不是 window）", () => {
  const view = source("views/ContactsView.vue");
  assert.match(view, /revealInScroller\(editorPanel\.value, nameInput\.value\)/);
  assert.doesNotMatch(view, /window\.scrollTo/);
  assert.match(source("listMotion.ts"), /scroller\.scrollTo\(/);
});

test("写信和打开草稿的意图只用一次：从地址里去掉，关闭写信窗口后刷新不会再次弹出", () => {
  const view = source("views/MailView.vue");
  assert.match(view, /const \{ draft: _draft, compose: _compose, to: _to, \.\.\.rest \} = route\.query;/);
  assert.match(view, /router\.replace\(\{ name: route\.name \?\? "mail", query: rest \}\)/);
});

test("邮件阅读区有入场动画，入场只做淡入上浮，不画线", () => {
  assert.match(source("components/mail/MessageReaderPane.vue"), /<section v-motion="\{ kind: 'compact', delay: 160 \}" class="mail-pane mail-pane--reader"/);
  assert.doesNotMatch(source("motion.ts"), /createElementNS|motion-outline|strokeDashoffset/);
  assert.match(source("enterMotion.ts"), /translate3d\(0, \$\{distance\}px, 0\)/);
});

test("离开的卡片先固定在原位置再淡出，其余卡片才能平滑补位", () => {
  const style: Record<string, string> = {};
  const element = { offsetTop: 40, offsetLeft: 12, offsetWidth: 300, offsetHeight: 120, style } as unknown as Element;
  pinLeavingItem(element);
  assert.deepEqual(style, { position: "absolute", top: "40px", left: "12px", width: "300px", height: "120px", margin: "0" });
});

test("滚动入场指令已注册，减少动画时所有新增过渡关闭", () => {
  assert.match(source("main.ts"), /\.directive\("scroll-reveal", scrollRevealDirective\)/);
  const css = source("styles/mail-pages.css");
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^@]*\.smooth-block, \[data-scroll-reveal\]/);
  assert.match(css, /data-motion="reduce"\], \[data-performance="low"\]\) :is\(\.smooth-block, \[data-scroll-reveal\]/);
});

test("桌面端：搜索、草稿、联系人、设置整页是一个大容器，上下边界与邮箱页两个大容器、左侧菜单栏同高同位", () => {
  for (const view of ["views/SearchView.vue", "views/DraftsView.vue", "views/ContactsView.vue", "views/SettingsView.vue"]) {
    assert.match(source(view), /<div v-motion="\{ kind: 'feature' \}" class="mail-utility-page">\s*<main id="main-content" class="page-shell mail-utility-shell"/);
  }
  const css = source("styles/workspace.css");
  const tail = css.slice(css.indexOf("@media (min-width: 901px) {"));
  assert.match(tail, /\.workspace-route-panel:has\(> \.mail-utility-page\) \{[^}]*padding: 12px 22px 12px; overflow: hidden;/);
  assert.match(tail, /\.mail-utility-page \{ position: relative; width: 100%; max-width: 1552px; height: 100%;[^}]*border-radius: var\(--r-xl\)/);
  assert.match(css, /\.workspace-content \.mail-shell \{[^}]*padding: 12px 22px 12px;/);
  assert.match(css, /\.dock-menu\.is-desktop-sidebar \{[^}]*height: calc\(100% - 26px\);[^}]*margin: 12px 0 14px 12px;/);
  assert.match(tail, /overflow-y: auto;/);
  assert.match(tail, /\.admin-panel \+ \.admin-panel,[\s\S]*box-shadow: inset 0 1px 0 var\(--line\);/);
  assert.match(tail, /\.search-result-content \.mail-result-list \{ max-height: none; overflow: visible; \}/);
});
