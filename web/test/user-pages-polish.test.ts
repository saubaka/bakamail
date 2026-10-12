import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pinLeavingItem } from "../src/listMotion.ts";

const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("左侧菜单栏四周有线：上下两条横线通过右侧圆角与竖线连成一体", () => {
  const css = source("styles/workspace.css");
  const sidebar = rule(css, ".dock-menu.is-desktop-sidebar");
  assert.match(sidebar, /border:1px solid var\(--line-blue\); border-left:0; border-radius:0 24px 24px 0/);
  assert.doesNotMatch(sidebar, /border-right:1px solid var\(--line-blue\); border-radius:0;/);
});

test("工具页卡片高度由内容决定，不再被基座的 264px 最小高度撑高；编辑联系人的卡片与列表等宽", () => {
  const css = source("styles/mail-pages.css");
  assert.match(css, /\.mail-utility-shell \.managed-page-card \{[^}]*min-height: 0; height: auto;/);
  assert.match(css, /\.mail-utility-shell \.managed-page-card:hover \{ transform: none; \}/);
  assert.match(css, /\.contact-editor-panel \{ max-width: none; \}/);
});

test("搜索表单：关键词独占一行，其余四项整齐排成一行，窄屏依次变成两列和一列", () => {
  const css = source("styles/mail-pages.css");
  const tail = css.slice(css.indexOf("用户端工具页"));
  assert.match(tail, /\.mail-search-form \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
  assert.match(tail, /\.mail-search-query \{ grid-column: 1 \/ -1; \}/);
  assert.match(tail, /@media \(max-width: 980px\) \{\s*\.mail-search-form \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(tail, /@media \(max-width: 560px\) \{\s*\.mail-search-form \{ grid-template-columns: 1fr; \}/);
});

test("选择框、日期框与输入框同高同圆角同字号，聚焦样式一致；手机上输入框字号 16px 避免 iOS 自动放大", () => {
  const css = source("styles/theme-controls.css");
  assert.match(css, /#app \.field \.themed-control \{ min-height: 48px; padding: 11px 13px; border-radius: 13px; font-size: 13px; \}/);
  assert.match(css, /#app \.themed-control:focus-visible \{ border-color: var\(--line-blue-strong\); outline: 1px solid var\(--line-blue-strong\); outline-offset: 3px; \}/);
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
  // 工具页的主卡片不再 reversible:false，滚动出视野后也有出场动画
  for (const view of [contacts, drafts, settings, search]) assert.doesNotMatch(view, /reversible: false/);
  // 删除草稿后本地先移除，不整页换成“正在读取”
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

test("邮件阅读区有入场动画，且与列表一样不显示外轮廓", () => {
  assert.match(source("components/mail/MessageReaderPane.vue"), /<section v-motion="\{ kind: 'compact', delay: 160 \}" class="mail-pane mail-pane--reader"/);
  assert.match(source("styles/workspace.css"), /\.mail-pane--reader > \.motion-outline \{ display: none; \}/);
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
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.smooth-block, \[data-scroll-reveal\]/);
  assert.match(css, /data-motion="reduce"\], \[data-performance="low"\]\) :is\(\.smooth-block, \[data-scroll-reveal\]/);
});
