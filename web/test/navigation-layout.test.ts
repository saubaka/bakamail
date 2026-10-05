import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAIL_DESKTOP_QUERY,
  MAIL_SIDEBAR_PREFERENCE_KEY,
  MAIL_WIDE_QUERY,
  compactUnreadCount,
  readDesktopSidebarPreference,
  resolveDesktopSidebarExpanded,
  workspaceModeForWidth,
  writeDesktopSidebarPreference,
} from "../src/mail/navigationLayout.ts";

test("邮箱导航在 900/901 像素边界明确切换，宽桌面默认展开", () => {
  assert.equal(MAIL_DESKTOP_QUERY, "(min-width: 901px)");
  assert.equal(MAIL_WIDE_QUERY, "(min-width: 1180px)");
  assert.equal(workspaceModeForWidth(900), "mobile");
  assert.equal(workspaceModeForWidth(901), "desktop");
  assert.equal(resolveDesktopSidebarExpanded(false, null), false);
  assert.equal(resolveDesktopSidebarExpanded(true, null), true);
});

test("折叠态文件夹未读数会压缩显示且拒绝无效值", () => {
  assert.equal(compactUnreadCount(0), "");
  assert.equal(compactUnreadCount(-3), "");
  assert.equal(compactUnreadCount(Number.NaN), "");
  assert.equal(compactUnreadCount(7.9), "7");
  assert.equal(compactUnreadCount(100), "99+");
});

test("桌面侧栏的人工选择覆盖默认值并安全持久化", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert.equal(readDesktopSidebarPreference(storage), null);
  writeDesktopSidebarPreference(false, storage);
  assert.equal(values.get(MAIL_SIDEBAR_PREFERENCE_KEY), "collapsed");
  assert.equal(readDesktopSidebarPreference(storage), "collapsed");
  assert.equal(resolveDesktopSidebarExpanded(true, "collapsed"), false);
  writeDesktopSidebarPreference(true, storage);
  assert.equal(readDesktopSidebarPreference(storage), "expanded");
  assert.equal(resolveDesktopSidebarExpanded(false, "expanded"), true);
});

test("受限或损坏的本地存储不会阻止邮箱工作区启动", () => {
  const broken = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  assert.equal(readDesktopSidebarPreference(broken), null);
  assert.doesNotThrow(() => writeDesktopSidebarPreference(true, broken));
  const invalid = { getItem: () => "other", setItem: () => undefined };
  assert.equal(readDesktopSidebarPreference(invalid), null);
});

test("跨断点会关闭浮动菜单并释放移动端专属遮罩、焦点陷阱和滚动锁", () => {
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  assert.match(workspace, /v-if="!isDesktop && menuOpen && !closing"/);
  assert.match(workspace, /:inert="!isDesktop && menuOpen && !closing"/);
  assert.match(workspace, /event\.key !== "Tab" \|\| isDesktop\.value/);
  assert.match(workspace, /if \(changedMode\) resetFloatingMenuForViewport\(\)/);
  assert.match(workspace, /unlockBodyScroll\(\)/);
  assert.match(workspace, /removeEventListener\("change", syncResponsiveNavigation\)/);
});

test("桌面只渲染左侧菜单，移动端只渲染底部胶囊并共用唯一文件夹宿主", () => {
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/workspace.css", import.meta.url), "utf8");
  assert.match(workspace, /v-show="isDesktop \|\| menuOpen"/);
  assert.match(workspace, /v-if="!isDesktop" class="mail-bottom-dock"/);
  assert.match(workspace, /aria-controls="mail-navigation-panel"/);
  assert.equal(workspace.match(/id="mail-folder-host"/g)?.length, 1);
  assert.match(workspace, /await router\.push\(path\)/);
  assert.doesNotMatch(workspace, /location\.(?:assign|reload|replace)/);
  assert.match(workspace, /:aria-busy="navigationBusy"/);
  assert.match(css, /--workspace-sidebar-width:72px/);
  assert.match(css, /--workspace-sidebar-width:244px/);
  assert.match(css, /grid-template-columns:var\(--workspace-sidebar-width\) minmax\(0,1fr\)/);
});

test("桌面菜单开关具备状态、控制关系和键盘焦点，收起后图标保留文字提示", () => {
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  assert.match(workspace, /:aria-expanded="desktopSidebarExpanded"/);
  assert.match(workspace, /:aria-label="desktopSidebarExpanded \? '折叠邮箱菜单' : '展开邮箱菜单'"/);
  assert.match(workspace, /function collapsedTitle\(label: string\)/);
  assert.match(workspace, /desktopSidebarToggle\.value\?\.focus/);
  assert.match(workspace, /setDesktopSidebarExpanded\(!desktopSidebarExpanded\.value\)/);
});

test("桌面折叠态提供文件夹入口，并在展开和路由就绪后聚焦真实文件夹", () => {
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  assert.match(workspace, /v-if="isDesktop"[\s\S]*:class="\{ 'is-hidden': desktopSidebarExpanded \}"/);
  assert.match(workspace, /aria-controls="mail-folder-host"/);
  assert.match(workspace, /:aria-label="collapsedFolderLabel"/);
  assert.match(workspace, /folderUnreadCount/);
  assert.match(workspace, /setDesktopSidebarExpanded\(true\)[\s\S]*await navigate\("\/mail"\)[\s\S]*await nextTick\(\)[\s\S]*scheduleFolderFocus\(\)/);
  assert.match(workspace, /querySelector<HTMLElement>\('\.folder-item\[aria-current="page"\]'\)[\s\S]*querySelector<HTMLElement>\("\.folder-item"\)[\s\S]*querySelector<HTMLElement>\("button"\)/);
  assert.match(workspace, /if \(pendingFolderFocus\)[\s\S]*pendingFolderFocus = false;[\s\S]*scheduleFolderFocus\(\)/);
});

test("桌面选中轮廓按真实按钮几何移动，并在侧栏变形和窗口变化时重新测量", () => {
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/workspace.css", import.meta.url), "utf8");
  assert.match(workspace, /ref="navigationList"/);
  assert.match(workspace, /querySelector<HTMLElement>\('\.dock-navigation-item\[aria-current="page"\]'\)/);
  assert.match(workspace, /x: current\.offsetLeft[\s\S]*y: current\.offsetTop[\s\S]*width: current\.offsetWidth[\s\S]*height: current\.offsetHeight/);
  assert.match(workspace, /new ResizeObserver\(measureNavigationHighlight\)/);
  assert.match(workspace, /watch\(desktopSidebarExpanded,[\s\S]*scheduleNavigationHighlight\(\)/);
  assert.doesNotMatch(workspace, /selectedIndex \* 44/);
  assert.match(css, /\.dock-navigation-highlight \{[^}]*will-change:transform[^}]*transition:transform 420ms/);
  assert.doesNotMatch(css.match(/\.dock-navigation-highlight \{[^}]*\}/)?.[0] ?? "", /transition:[^;}]*width/);
  assert.match(css, /\.dock-navigation-highlight\.is-ready \{ opacity:1; \}/);
});

test("折叠入口与文件夹内容使用可逆过渡，隐藏内容不会进入键盘顺序", () => {
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/workspace.css", import.meta.url), "utf8");
  assert.match(workspace, /:tabindex="desktopSidebarExpanded \? -1 : undefined"/);
  assert.match(workspace, /:inert="isDesktop && !desktopSidebarExpanded \? true : undefined"/);
  assert.match(css, /\.desktop-folder-trigger\.is-hidden \{[^}]*visibility:hidden[^}]*pointer-events:none/);
  assert.match(css, /not\(\.is-desktop-sidebar-expanded\) \.dock-folder-host \{[^}]*max-height:0[^}]*visibility:hidden[^}]*pointer-events:none/);
  assert.doesNotMatch(css, /not\(\.is-desktop-sidebar-expanded\) \.dock-folder-host \{ display:none/);
});

test("文件夹接入继续复用原有管理事件与破坏性操作确认", () => {
  const mailView = readFileSync(new URL("../src/views/MailView.vue", import.meta.url), "utf8");
  for (const event of ["create", "select", "rename", "subscription", "empty", "remove"]) {
    assert.match(mailView, new RegExp(`@${event}=`));
  }
  assert.match(mailView, /async function createFolder/);
  assert.match(mailView, /async function renameFolder/);
  assert.ok((mailView.match(/confirmDialog\(/g)?.length ?? 0) >= 3);
  assert.ok((mailView.match(/requiredText: folder\.path/g)?.length ?? 0) >= 2);
});

test("窄桌面手动展开侧栏时搜索表单会重排，不产生面板内横向滚动", () => {
  const css = readFileSync(new URL("../src/styles/workspace.css", import.meta.url), "utf8");
  assert.match(css, /@media \(min-width: 901px\) and \(max-width: 1179px\)/);
  assert.match(css, /\.mail-workspace\.is-desktop-sidebar-expanded \.mail-search-form \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.match(css, /\.mail-workspace\.is-desktop-sidebar-expanded \.mail-search-query \{ grid-column:1 \/ -1; \}/);
});

test("移动端工作区保持单列网格，右侧内容不会因侧栏隐藏而高度坍缩", () => {
  const css = readFileSync(new URL("../src/styles/workspace.css", import.meta.url), "utf8");
  const mobile = css.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(mobile, /\.workspace-body \{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.doesNotMatch(mobile, /\.workspace-body \{ display:block; \}/);
});

test("移动端从悬浮菜单写信前先把焦点交回可见菜单按钮", () => {
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  assert.match(workspace, /const restoreToMobileTrigger = !isDesktop\.value;[\s\S]*await closeMenu\(false\);[\s\S]*menuTrigger\.value\?\.focus/);
});
