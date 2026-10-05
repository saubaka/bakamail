import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const login = readFileSync(new URL("../src/views/LoginView.vue", import.meta.url), "utf8");
const intro = readFileSync(new URL("../src/views/IntroView.vue", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/login.css", import.meta.url), "utf8");

test("登录页去除外部品牌，采用稳定的 SVG Logo 和卡片外版权", () => {
  assert.doesNotMatch(login, /BrandMark|>✉</);
  assert.match(login, /class="login-logo"[\s\S]*?<svg viewBox="0 0 40 40"/);
  assert.match(login, /<\/main>\s*<footer class="login-footer">/);
  assert.match(login, /© \{\{ year \}\} saubaka · BakaMail/);
});

test("辅助入口保持完整，分别放在密码行、邀请区和次级导航", () => {
  assert.match(login, /class="login-forgot" to="\/password-reset"/);
  assert.match(login, /class="login-invitation"[\s\S]*?to="\/register"/);
  assert.match(login, /<nav class="login-secondary-nav"[\s\S]*?to="\/"[\s\S]*?<\/nav>/);
  assert.doesNotMatch(login, /管理员后台|\/admin\/login|\/bakaadmin/);
  assert.doesNotMatch(intro, /管理员入口|\/admin\/login|\/bakaadmin/);
  assert.match(login, /purpose="login"/);
  assert.match(login, /:disabled="submission.disabled"/);
});

test("介绍页页头不再有登录按钮，正文登录入口仍保留", () => {
  const header = intro.match(/<header class="intro-header">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.doesNotMatch(header, /intro-button|:to="entry"/);
  assert.match(intro, /class="intro-button" :to="entry"/);
});

test("登录样式隔离、窄屏可重排且尊重减少动画偏好", () => {
  assert.match(css, /width: min\(432px, 100%\)/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-motion="reduce"/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
