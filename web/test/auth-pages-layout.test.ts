import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const markup = (name: string) => { const text = source(name); return text.slice(0, text.indexOf("<script setup")); };

test("忘记密码页沿用登录页的结构：同一套页面、卡片、logo、标题、提交按钮、次要入口和页脚", () => {
  const reset = markup("views/PasswordResetView.vue");
  const login = markup("views/LoginView.vue");
  for (const part of ['class="login-page"', 'class="login-main"', "login-card card", 'class="login-heading"', 'class="login-logo"', 'class="login-product-name"',
    "login-submit action-submit", 'v-press-feedback="\'submit\'"', 'class="login-invitation"', 'class="login-secondary-nav"', 'class="login-footer"', "action-submit__spinner"]) {
    assert.ok(reset.includes(part), `忘记密码页缺少 ${part}`);
    assert.ok(login.includes(part), `登录页缺少 ${part}`);
  }
  assert.doesNotMatch(reset, /BrandMark|auth-shell|auth-icon/);
  // logo 的图形与登录页完全相同
  const svg = (text: string) => /<svg viewBox="0 0 40 40"[\s\S]*?<\/svg>/.exec(text)?.[0];
  assert.equal(svg(reset), svg(login));
});

test("忘记密码页沿用登录页的逻辑：忙碌/冷却/验证码未填时按钮不可用，冷却倒计时与验证码刷新，失败后重置验证码", () => {
  const text = source("views/PasswordResetView.vue");
  assert.match(text, /loginSubmissionState\(busy\.value, lockedSeconds\.value, true, nonce\.value, answer\.value\)/);
  assert.match(text, /error\.retryAfterSeconds/);
  assert.match(text, /retryUntil\.value = Date\.now\(\) \+ seconds \* 1000/);
  assert.match(text, /humanRef\.value\?\.invalidate\(\)/);
  assert.match(text, /humanRef\.value\?\.refresh\(\)/);
  assert.match(text, /watch\(lockedSeconds/);
  assert.match(text, /clearInterval\(timer\)/);
  assert.match(text, /\/api\/auth\/password-reset/);
  assert.match(text, /purpose="password-reset"/);
});

test("邀请码开通页只复刻登录页的 logo 与标题位置，表单和其余内容不变", () => {
  const register = markup("views/RegisterView.vue");
  const login = markup("views/LoginView.vue");
  assert.match(register, /<header class="login-heading">[\s\S]*?class="login-logo"[\s\S]*?class="login-product-name">\{\{ siteInfo\.siteName \}\}<\/span>[\s\S]*?<h1 id="register-title">[^<]+<\/h1>\s*<p>/);
  const svg = (text: string) => /<svg viewBox="0 0 40 40"[\s\S]*?<\/svg>/.exec(text)?.[0];
  assert.equal(svg(register), svg(login));
  assert.doesNotMatch(register, /BrandMark|auth-icon|INVITE ONLY/);
  assert.match(register, /class="auth-card card"/);
  assert.match(register, /purpose="register"/);
  assert.match(register, /v-model:formReadyAt="formReadyAt"/);
});

test("登录、后台登录、忘记密码页脚用开源仓库导向文字和链接，不再出现“自建邮局的网页端”，样式与首页页脚链接一致", () => {
  const note = source("components/RepositoryNote.vue");
  assert.match(note, /本项目已开源：<a :href="repositoryUrl" target="_blank" rel="noopener noreferrer">开源仓库<\/a>/);
  assert.match(note, /SEO_REPOSITORY_URL/);
  for (const view of ["views/LoginView.vue", "views/admin/AdminLoginView.vue", "views/PasswordResetView.vue"]) {
    const text = source(view);
    assert.match(text, /<RepositoryNote \/>/, `${view} 页脚缺少开源仓库`);
    assert.match(text, /import RepositoryNote from/);
    assert.doesNotMatch(text, /自建邮局的网页端/);
  }
  const css = source("styles/login.css");
  assert.match(css, /\.login-footer a \{ color: inherit; text-decoration: none; \}/);
  assert.match(css, /\.login-page a:hover \{ text-decoration: underline;/);
});
