import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const admin = source("views/admin/AdminLoginView.vue");
const ordinary = source("views/LoginView.vue");

test("管理员登录复用普通登录的卡片、排版、信封图标与独立页脚", () => {
  for (const name of ["login-page", "login-main", "login-card card", "login-heading", "login-product-name", "form-grid auth-form login-form", "login-secondary-nav", "login-footer"]) {
    assert.ok(admin.includes(`class="${name}"`), name);
    assert.ok(ordinary.includes(`class="${name}"`), name);
  }
  const logo = (text: string) => text.match(/<span class="login-logo"[\s\S]*?<\/span>/)?.[0];
  assert.ok(logo(ordinary));
  assert.equal(logo(admin), logo(ordinary));
  assert.match(admin, /<\/main>\s*<footer class="login-footer">/);
  assert.match(admin, /© \{\{ year \}\} saubaka · BakaMail/);
  assert.doesNotMatch(admin, /BrandMark|auth-shell|auth-card|eyebrow|⚙|>ADMIN</);
});

test("管理员保留明确身份文案、独立认证与每次验证码，不新增注册或邮箱重置入口", () => {
  assert.match(admin, /id="admin-login-title">登录后台</);
  assert.match(admin, /管理员账号/);
  assert.match(admin, /const humanVisible = ref\(true\)/);
  assert.match(admin, /<HumanCheck[\s\S]*?\sadmin\s*\/>/);
  assert.match(admin, /"\/api\/admin\/auth\/login"/);
  assert.match(admin, /setCsrfToken\(data.csrfToken, "admin"\)/);
  assert.match(admin, /safeAdminDestination\(route.query.redirect\)/);
  assert.doesNotMatch(admin, /to="\/(?:register|password-reset)"|location\.reload|window\.location/);
});

test("管理员登录按钮复用普通登录点击及加载反馈，保留禁用和冷却状态", () => {
  assert.match(admin, /v-press-feedback="'submit'" class="button login-submit action-submit field--wide"/);
  assert.match(admin, /class="action-submit__spinner" aria-hidden="true"/);
  assert.match(admin, /:disabled="submission.disabled" :aria-busy="busy"/);
  assert.match(admin, /lockedSeconds > 0[\s\S]*?秒后可重试/);
  assert.match(admin, /v-capsule-notice class="field-error field--wide" role="alert"/);
});
