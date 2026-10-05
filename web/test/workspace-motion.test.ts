import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNotificationQueue, type Notification } from "../src/notifications.ts";
import { allowsPressMotion, pressFeedbackDirective, pressFrames } from "../src/pressFeedback.ts";
import { mailNavigation, navigationIndex, panelNavigationDirection } from "../src/mail/workspace.ts";

test("邮箱五个页面的强调块索引稳定，未知路径安全回到邮箱", () => {
  mailNavigation.forEach((item, index) => assert.equal(navigationIndex(item.path), index));
  assert.equal(navigationIndex("/mail/unknown"), 0);
  assert.equal(new Set(mailNavigation.map(item => item.path)).size, 5);
});
test("右侧面板根据菜单顺序确定前后方向，未知路径保持中性", () => {
  assert.equal(panelNavigationDirection("/mail", "/mail/contacts"), "forward");
  assert.equal(panelNavigationDirection("/mail/settings", "/mail/search"), "backward");
  assert.equal(panelNavigationDirection("/mail/search", "/mail/search"), "neutral");
  assert.equal(panelNavigationDirection("/mail/unknown", "/mail"), "neutral");
});
test("右侧面板仅使用合成友好的过渡，并为减少动画保留静态完成态", () => {
  const css = readFileSync(new URL("../src/styles/workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.workspace-route-panel \{[^}]*grid-area:1\/1[^}]*overflow:auto/);
  assert.match(css, /\.mail-panel-enter-active \{[^}]*opacity[^}]*transform[^}]*filter/);
  assert.match(css, /\.mail-panel-leave-active \{[^}]*pointer-events:none[^}]*opacity[^}]*transform[^}]*filter/);
  assert.match(css, /data-panel-direction="forward"[^}]*translate3d\(18px,0,0\)/);
  assert.match(css, /data-panel-direction="backward"[^}]*translate3d\(-18px,0,0\)/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.mail-panel-enter-from,\.mail-panel-leave-to \{ opacity:1; filter:none; transform:none!important; \}/);
  assert.doesNotMatch(css.match(/\.mail-panel-enter-active \{[^}]*\}/)?.[0] ?? "", /(?:width|height|left|top):/);
});
test("登录点击动画有按下及回弹，减少动态和低性能偏好不会播放", () => {
  assert.equal(pressFrames[0]?.transform, "scale(1)");
  assert.equal(pressFrames.at(-1)?.transform, "scale(1)");
  assert.ok(pressFrames.some(frame => frame.transform === "scale(.965)"));
  assert.equal(allowsPressMotion({}, false), true);
  assert.equal(allowsPressMotion({ motion: "reduce" }, false), false);
  assert.equal(allowsPressMotion({ performance: "low" }, false), false);
  assert.equal(allowsPressMotion({}, true), false);
  const login = readFileSync(new URL("../src/views/LoginView.vue", import.meta.url), "utf8");
  assert.match(login, /<button v-press-feedback="'submit'" class="button login-submit/);
});
test("点击反馈指令实际监听 click、播放动画且卸载时取消和清理", () => {
  const originalDocument = globalThis.document;
  const originalMatchMedia = globalThis.matchMedia;
  let listener: (() => void) | undefined;
  let played = 0; let cancelled = 0; let removed = 0;
  const element = {
    addEventListener(name: string, fn: () => void) { assert.equal(name, "click"); listener = fn; },
    removeEventListener(name: string, fn: () => void) { assert.equal(name, "click"); assert.equal(fn, listener); removed++; },
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      assert.deepEqual(frames, pressFrames); assert.equal(options.duration, 360); played++;
      return { cancel() { cancelled++; } };
    },
  };
  try {
    globalThis.document = { documentElement: { dataset: { motion: "system", performance: "normal" } } } as unknown as Document;
    globalThis.matchMedia = (() => ({ matches: false })) as unknown as typeof matchMedia;
    (pressFeedbackDirective.mounted as Function)(element);
    listener!(); listener!();
    assert.equal(played, 2); assert.equal(cancelled, 1);
    (pressFeedbackDirective.beforeUnmount as Function)(element);
    assert.equal(cancelled, 2); assert.equal(removed, 1);
  } finally {
    globalThis.document = originalDocument;
    globalThis.matchMedia = originalMatchMedia;
  }
});
test("通知逐条播放，不覆盖上一条；重复通知去重，完成回调幂等", () => {
  const notices: Notification[] = [];
  const finish: Array<() => void> = [];
  const queue = createNotificationQueue((notice, done) => { notices.push(notice); finish.push(done); });
  queue.push({ message: "已登录", tone: "success" });
  queue.push({ message: "已登录", tone: "success" });
  queue.push({ message: "刷新失败", tone: "error" });
  queue.push({ message: "刷新失败", tone: "error" });
  queue.push({ message: "设置已保存", tone: "success" });
  assert.equal(notices.length, 1);
  finish[0]!(); finish[0]!();
  assert.equal(notices.length, 2);
  assert.equal(notices[1]?.tone, "error");
  finish[1]!();
  assert.equal(notices[2]?.message, "设置已保存");
  finish[2]!();
  queue.push({ message: "已登录", tone: "success" });
  assert.equal(notices.length, 4);
});
test("邮件子页面使用持久工作区，桌面侧栏与移动胶囊共用导航且不恢复旧页头", () => {
  const app = readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
  assert.match(app, /:key="workspaceRouteKey\(route\)"/);
  const routeKey = readFileSync(new URL("../src/auth/workspaceRouteKey.ts", import.meta.url), "utf8");
  assert.match(routeKey, /route.meta.auth === 'mail'.*return 'mail-workspace'/);
  const mail = readFileSync(new URL("../src/views/MailView.vue", import.meta.url), "utf8");
  assert.doesNotMatch(mail, /class="mail-toolbar"/);
  assert.match(mail, /Teleport to="#mail-folder-host" defer/);
  for (const view of ["SearchView", "DraftsView", "ContactsView", "SettingsView"]) {
    const text = readFileSync(new URL(`../src/views/${view}.vue`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /MailPageHeader/);
  }
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  assert.match(workspace, /aria-controls="mail-navigation-panel"/);
  assert.match(workspace, /v-show="isDesktop \|\| menuOpen"/);
  assert.match(workspace, /v-if="!isDesktop" class="mail-bottom-dock"/);
  assert.match(workspace, /is-desktop-sidebar/);
  assert.match(workspace, /await closeMenu\(false\)/);
  assert.match(workspace, /if \(generation !== navigationGeneration\) return/);
  assert.match(workspace, /if \(route.path !== path \|\| isDesktop.value\) await router.push\(path\)/);
  assert.match(workspace, /event.key === "Escape"/);
  assert.match(workspace, /<transition name="mail-panel"/);
  assert.match(workspace, /@before-leave="makePanelInert"/);
  assert.match(workspace, /element\.setAttribute\("inert", ""\)/);
  assert.match(workspace, /routeAnnouncement/);
  assert.doesNotMatch(workspace, /mode="out-in"/);
});
test("通知仅安全插入文本，替换右下角定位，具有完整向下进出关键帧", () => {
  const source = readFileSync(new URL("../src/notifications.ts", import.meta.url), "utf8");
  assert.match(source, /text.textContent = notice.message/);
  assert.doesNotMatch(source, /innerHTML/);
  const css = readFileSync(new URL("../src/styles/notifications.css", import.meta.url), "utf8");
  assert.match(css, /#toast-region \{ position: fixed; inset: 0/);
  assert.match(css, /notification-drop-in/);
  assert.match(css, /calc\(100svh \+ 40px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
