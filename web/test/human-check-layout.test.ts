import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const component = source("components/HumanCheck.vue");
const css = component.split("<style scoped>")[1]?.split("</style>")[0] ?? "";
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("四种认证入口共用紧凑验证码组件，不修改上游主题快照", () => {
  for (const view of ["views/LoginView.vue", "views/RegisterView.vue", "views/PasswordResetView.vue", "views/admin/AdminLoginView.vue"]) {
    assert.match(source(view), /<HumanCheck[\s>]/);
  }
  assert.match(css, /grid-template-columns: clamp\(72px, calc\(100% - 148px\), 112px\) 44px minmax\(0, 1fr\)/);
  assert.match(rule(".human-check__field"), /display: contents/);
  assert.match(rule(".human-check__field > .field__label"), /grid-row: 1/);
});

test("验证码、换码按钮、输入框共享第二行的 48px 高度，图片完整等比显示", () => {
  for (const selector of [".human-check__image", ".human-check__refresh", ".human-check__field input"]) {
    assert.match(rule(selector), /grid-row: 2/);
    assert.match(rule(selector), /(?:^|\s)height: 48px/);
  }
  assert.match(rule(".human-check__refresh"), /width: 44px/);
  assert.match(css, /\.human-check__refresh:hover,[\s\S]*?\.human-check__refresh:disabled\s*\{ transform: none !important; \}/);
  assert.match(rule(".human-check__image img"), /object-fit: contain/);
  assert.match(rule(".human-check__field input"), /min-width: 0/);
  assert.match(rule(".human-check__field input"), /font-size: 16px/);
  assert.match(rule(".human-check__status"), /overflow-wrap: anywhere/);
});

test("紧凑样式保留标签、换码禁用预算和错误提示，未改验证码安全交互", () => {
  assert.match(component, /<label class="field human-check__field">[\s\S]*?<input[\s\S]*?<\/label>/);
  assert.match(component, /aria-label="换一张验证码"/);
  assert.match(component, /:disabled="loading \|\| retrySeconds > 0"/);
  assert.match(component, /:disabled="loading \|\| !nonce"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /controller\?\.abort\(\)/);
});
