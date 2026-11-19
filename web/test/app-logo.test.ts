import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ERROR_LOGO_SVG, renderErrorDocument } from "../../shared/errorPage.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("站点 logo（胶囊信封）组件只用主题色：颜色全部来自样式里的令牌，没有写死颜色", () => {
  const logo = source("components/AppLogo.vue");
  assert.match(logo, /<svg class="app-logo" :class="\{ 'is-small': small \}" viewBox="0 0 128 128" aria-hidden="true" focusable="false">/);
  assert.doesNotMatch(logo, /#[0-9a-f]{3,6}|fill="|stroke="/i);
  const css = source("styles/theme/primitives.css");
  assert.match(css, /\.app-logo__bg \{ fill: var\(--blue-100\); \}/);
  assert.match(css, /\.app-logo__body \{ fill: var\(--surface\); stroke: var\(--blue-500\);/);
  assert.match(css, /\.app-logo__dot \{ fill: var\(--pink-500\);/);
});

test("品牌位都放了 logo：首页/初始化品牌、后台侧栏、邮箱顶栏、四个登录类页面、错误页", () => {
  assert.match(source("components/BrandMark.vue"), /<AppLogo class="site-brand__logo" \/>/);
  assert.match(source("components/admin/AdminRail.vue"), /<AppLogo class="admin-rail__logo" small \/>/);
  assert.match(source("components/MailWorkspace.vue"), /<span class="workspace-brand"><AppLogo class="workspace-brand__logo" small \/><span>\{\{ siteInfo\.siteName \}\}<\/span><\/span>/);
  for (const file of ["views/LoginView.vue", "views/RegisterView.vue", "views/PasswordResetView.vue", "views/admin/AdminLoginView.vue"]) {
    assert.match(source(file), /<AppLogo class="login-logo" \/>/, file);
  }
  assert.match(source("components/ErrorPage.vue"), /<AppLogo class="ep-logo" small \/>/);
});

test("服务端错误页站点名前有同款 logo；服务端与静态错误页的图标都是新 logo", () => {
  assert.match(ERROR_LOGO_SVG, /^<svg class="ep-logo" viewBox="0 0 128 128" aria-hidden="true"/);
  assert.match(ERROR_LOGO_SVG, /<circle cx="101" cy="39" r="13" fill="#f0a0ba"/);
  const html = renderErrorDocument({ status: 404, siteName: "示例站" });
  assert.match(html, /<p class="ep-site"><svg class="ep-logo"[\s\S]*?<\/svg>示例站<\/p>/);
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  const staticPage = readFileSync(new URL("../../deploy/error-pages/404.html", import.meta.url), "utf8");
  assert.ok(staticPage.includes(encodeURIComponent('<circle cx="101" cy="39" r="13" fill="#f0a0ba"')), "静态错误页图标为新 logo");
});
