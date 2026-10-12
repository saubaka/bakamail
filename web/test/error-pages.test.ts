import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ERROR_COPY, ERROR_PAGE_CSS, LOAD_FAILURE_COPY, NOSCRIPT_COPY, SUPPORTED_ERROR_STATUSES, errorCopy, isServerError,
  renderErrorCard, renderErrorDocument, renderLoadFailureTemplate, renderNoscriptRequired,
} from "../../shared/errorPage.ts";
import { PUBLIC_ROUTE_PATHS, isKnownPublicPath } from "../../shared/publicRoutes.ts";
import { clearFatal, fatalError, isChunkLoadFailure, reportFatal } from "../src/errorState.ts";
import { ensureErrorStyles } from "../src/errorStyles.ts";
import { staticErrorPages, STATIC_ERROR_STATUSES } from "../../scripts/build-error-pages.mjs";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const root = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("每个常见状态码都有简体中文标题和说明；5xx 偏暖色，4xx 浅蓝；未知状态码按大类回退", () => {
  assert.deepEqual([...SUPPORTED_ERROR_STATUSES].sort(), [400, 403, 404, 405, 408, 413, 429, 500, 502, 503, 504]);
  for (const status of SUPPORTED_ERROR_STATUSES) {
    const copy = ERROR_COPY[status]!;
    assert.match(copy.title, /[一-鿿]/, String(status));
    assert.match(copy.message, /[一-鿿]/, String(status));
    assert.ok(copy.title.length <= 12 && copy.message.length <= 60, `${status} 文案要简短`);
    assert.equal(isServerError(status), status >= 500);
  }
  assert.equal(errorCopy(418), ERROR_COPY[400]);
  assert.equal(errorCopy(599), ERROR_COPY[500]);
  assert.equal(errorCopy(404).retry, false, "找不到页面不提供重试");
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(errorCopy(status).retry, true, String(status));
  assert.match(ERROR_COPY[502]!.message, /邮件仍保存在邮局里/);
});

test("卡片：大数字逐位拆开做入场动画；站点名、错误编号经过转义；编号只在服务器错误时显示且格式受限", () => {
  const html = renderErrorCard({ status: 502, siteName: '某"某<b>邮箱', requestId: "abc-123:xyz" });
  assert.match(html, /<p class="ep-code" aria-hidden="true"><span style="--i:0">5<\/span><span style="--i:1">0<\/span><span style="--i:2">2<\/span><\/p>/);
  assert.ok(html.includes("某&quot;某&lt;b&gt;邮箱") && !html.includes("<b>"));
  assert.match(html, /错误编号 <code>abc-123:xyz<\/code>/);
  assert.match(html, /class="ep-card ep--server"/);
  assert.doesNotMatch(renderErrorCard({ status: 404, requestId: "abc" }), /错误编号/);
  assert.doesNotMatch(renderErrorCard({ status: 500, requestId: '"><script>alert(1)</script>' }), /错误编号|<script/);
  assert.doesNotMatch(renderErrorCard({ status: 500, requestId: "x".repeat(65) }), /错误编号/);
  assert.doesNotMatch(renderErrorCard({ status: 404 }), /ep--server/);
});

test("卡片按钮：返回首页始终有；重试只在可重试时有；等待秒数向上取整；加载失败页没有大数字", () => {
  assert.match(renderErrorCard({ status: 404 }), /<a class="ep-button" href="\/">返回首页<\/a>/);
  assert.doesNotMatch(renderErrorCard({ status: 404 }), /ep-link/);
  assert.match(renderErrorCard({ status: 503 }), /<a class="ep-link" href="">重试<\/a>/);
  assert.match(renderErrorCard({ status: 429, retryAfter: 4.2 }), /请大约等待 5 秒后再试。/);
  assert.doesNotMatch(renderErrorCard({ status: 429, retryAfter: 0 }), /请大约等待/);
  assert.doesNotMatch(renderErrorCard({ status: 503, showHome: false }), /返回首页/);
  const failure = renderErrorCard({ copy: LOAD_FAILURE_COPY, showHome: false });
  assert.doesNotMatch(failure, /ep-code/);
  assert.match(failure, /页面没有加载出来/);
  assert.match(renderErrorCard({ status: 503, retryHref: "/status?a=1&b=2" }), /href="\/status\?a=1&amp;b=2"/);
});

test("独立页面：完整文档、不收录、不含脚本和外部地址、图标内联、带固定版权行；标题带状态码", () => {
  const html = renderErrorDocument({ status: 404, siteName: "某某邮箱", year: 2031 });
  assert.match(html, /^<!doctype html>\n<html lang="zh-CN">/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(html, /<title>404 找不到这个页面 - 某某邮箱<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/);
  assert.match(html, /© 2031 saubaka\. BakaMail\./);
  assert.doesNotMatch(html, /<script|javascript:|onerror=|onclick=/i);
  assert.doesNotMatch(html, /(?:src|href)="https?:/i, "没有任何外部地址");
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.match(html, /<main class="ep-main" id="main-content">/);
  assert.equal([...html.matchAll(/<h1/g)].length, 1);
});

test("样式：不含渐变；关闭动画偏好生效；窄屏收紧；大括号配对；动画只用 transform 和 opacity", () => {
  assert.doesNotMatch(ERROR_PAGE_CSS, /gradient/i);
  assert.match(ERROR_PAGE_CSS, /@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none!important/);
  assert.match(ERROR_PAGE_CSS, /@media \(max-width:480px\)/);
  assert.equal(ERROR_PAGE_CSS.split("{").length, ERROR_PAGE_CSS.split("}").length);
  for (const frames of ERROR_PAGE_CSS.matchAll(/@keyframes [\w-]+\{([\s\S]*?\}\})/g)) assert.doesNotMatch(frames[1]!, /width|height|top|left|margin|padding/);
  assert.match(ERROR_PAGE_CSS, /\.ep-button:focus-visible,\.ep-link:focus-visible\{outline:/);
});

test("脚本关闭和脚本加载失败的兜底：提示文案准确，模板里自带样式", () => {
  const noscript = renderNoscriptRequired(2026);
  assert.match(noscript.head, /^<noscript><style>[\s\S]*<\/style><\/noscript>$/, "样式在 head 的 noscript 里，符合规范");
  assert.doesNotMatch(noscript.body, /<style/, "body 里的 noscript 不放 style");
  assert.ok(noscript.body.includes(NOSCRIPT_COPY.title) && noscript.body.includes("© 2026 saubaka. BakaMail."));
  assert.doesNotMatch(noscript.body, /返回首页/, "需要脚本的页面不提供首页链接，避免循环");
  const template = renderLoadFailureTemplate(2026);
  assert.match(template, /^<template id="bm-fatal"><style>/);
  assert.ok(template.includes(LOAD_FAILURE_COPY.title) && !template.includes("<script"));
  assert.doesNotMatch(template, /返回首页/);
});

test("给反向代理用的静态错误页与生成结果完全一致：403/404/500/503 加一个“连不上服务”页，且不含后台路径；配置示例引用了全部页面，502/504 改成 503 透传", () => {
  assert.deepEqual(STATIC_ERROR_STATUSES, [403, 404, 500, 503]);
  assert.deepEqual(Object.keys(staticErrorPages()).sort(), ["403.html", "404.html", "500.html", "503.html", "unreachable.html"]);
  const unreachable = staticErrorPages()["unreachable.html"]!;
  assert.match(unreachable, /<title>503 暂时连不上服务<\/title>/);
  assert.match(unreachable, /暂时连不上服务[\s\S]*邮件仍保存在邮局里，不受影响/);
  assert.match(unreachable, /<span style="--i:0">5<\/span><span style="--i:1">0<\/span><span style="--i:2">3<\/span>/, "显示的数字和返回的状态一致，都是 503");
  for (const [name, html] of Object.entries(staticErrorPages())) {
    assert.equal(root(`deploy/error-pages/${name}`), html, `${name} 需要重新运行 node scripts/build-error-pages.mjs`);
    assert.doesNotMatch(html, /bakaadmin|\/admin|request|错误编号/i, name);
    const copyStatus = name === "unreachable.html" ? 502 : Number(name.slice(0, 3));
    if (ERROR_COPY[copyStatus]!.retry) assert.match(html, /<a class="ep-link" href="">重试<\/a>/, `${name} 靠链接重试，不需要脚本`);
    else assert.doesNotMatch(html, /<a class="ep-link"/, `${name} 不可重试，不显示重试`);
  }
  const conf = root("deploy/error-pages/openresty.conf.example");
  for (const status of STATIC_ERROR_STATUSES) assert.ok(conf.includes(`error_page ${status} /_bakamail_errors/${status}.html;`), String(status));
  assert.ok(conf.includes("error_page 502 504 =503 /_bakamail_errors/unreachable.html;"), "502/504 改成 503，避免被 Cloudflare 换成纯文本页");
  assert.match(conf, /Cloudflare/);
  assert.doesNotMatch(conf, /error_page 50[24] \/_bakamail_errors\/50[24]\.html/);
  assert.match(conf, /location \^~ \/_bakamail_errors\/ \{\s*internal;/);
  assert.match(conf, /proxy_intercept_errors/);
});

test("公开页面清单：只有站点自己的页面返回 200，其他地址（包括任意后台路径）都是 404；与前端路由表一致", () => {
  for (const path of ["/", "/login", "/register", "/password-reset", "/unavailable", "/setup", "/mail", "/mail/", "/mail/search", "/mail/drafts", "/login/"]) {
    assert.equal(isKnownPublicPath(path), true, path);
  }
  for (const path of ["/nope", "/bakaadmin", "/bakaadmin/overview", "/admin", "/mailx", "/mail-ops", "/loginx", "//", "/index.html", "/a/b/c"]) {
    assert.equal(isKnownPublicPath(path), false, path);
  }
  const router = source("router.ts");
  const topLevel = [...router.matchAll(/^\s{4}\{ path: "(\/[^"]*)"/gm)].map((match) => match[1]!).filter((path) => !path.includes(":"));
  for (const path of topLevel) assert.equal(isKnownPublicPath(path), true, `路由 ${path} 必须在公开页面清单里`);
  for (const path of PUBLIC_ROUTE_PATHS) assert.ok(path === "/" || topLevel.includes(path), `清单里的 ${path} 必须是真实路由`);
});

test("页面加载失败的判断：只认动态导入失败的几种浏览器提示，普通错误不算", () => {
  for (const message of ["Failed to fetch dynamically imported module: https://x/assets/a.js", "error loading dynamically imported module", "Importing a module script failed.", "Unable to preload CSS for /assets/a.css"]) {
    assert.equal(isChunkLoadFailure(new Error(message)), true, message);
  }
  for (const value of [new Error("Cannot read properties of undefined"), new TypeError("x is not a function"), "network", null, undefined]) assert.equal(isChunkLoadFailure(value), false);
  assert.equal(isChunkLoadFailure("Failed to fetch dynamically imported module"), true, "字符串也能识别");
  clearFatal();
  assert.equal(fatalError.active, false);
  reportFatal("x".repeat(500));
  assert.equal(fatalError.active, true);
  assert.equal(fatalError.reason.length, 200);
  clearFatal();
  assert.deepEqual({ ...fatalError }, { active: false, reason: "" });
});

test("错误页样式只放进页面一次", () => {
  const nodes = new Map<string, { id: string; textContent: string }>();
  const doc = {
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElement: () => ({ id: "", textContent: "" }),
    head: { appendChild: (node: { id: string; textContent: string }) => { nodes.set(node.id, node); } },
  } as unknown as Document;
  ensureErrorStyles(doc);
  ensureErrorStyles(doc);
  ensureErrorStyles(doc);
  assert.equal(nodes.size, 1);
  assert.equal(nodes.get("bm-error-css")!.textContent, ERROR_PAGE_CSS);
});

test("前端页面：404 和暂时无法连接都用统一的错误页组件；不可用页仍用路由重试，不整页刷新", () => {
  assert.match(source("views/NotFoundView.vue"), /<ErrorPage :status="404" \/>/);
  const unavailable = source("views/ServiceUnavailableView.vue");
  assert.match(unavailable, /<ErrorPage[\s\S]*?:status="503"[\s\S]*?retryable[\s\S]*?:show-home="false"[\s\S]*?@retry="retry"/);
  assert.match(unavailable, /void router\.replace\(destination\.value\)/);
  assert.doesNotMatch(unavailable, /location\.(assign|reload|replace)/);
  const page = source("components/ErrorPage.vue");
  assert.match(page, /import \{ ERROR_LOGO_SVG, LOAD_FAILURE_COPY, errorCopy, isServerError \} from "\.\.\/\.\.\/\.\.\/shared\/errorPage"/);
  assert.match(page, /<p>© \{\{ year \}\} saubaka\. BakaMail\.<\/p>/);
  assert.match(page, /class="ep-logo" v-html="logo"/, "只有写死的标志常量使用 v-html");
  assert.equal([...page.matchAll(/v-html/g)].length, 1);
});

test("全局错误边界：只有渲染阶段出错才换成错误页；路由文件加载失败才提示；成功切换页面自动恢复；只有用户点按钮才整页重载", () => {
  const app = source("App.vue");
  assert.match(app, /<ErrorPage v-if="fatalError\.active" retryable retry-label="重新加载" :show-home="false" @retry="reload" \/>/);
  assert.match(app, /new Set\(\["render function", "setup function", "component update"\]\)/);
  assert.match(app, /if \(!RENDER_STAGES\.has\(info\)\) return true;/);
  assert.match(app, /watch\(\(\) => route\.fullPath, \(\) => \{ if \(fatalError\.active\) clearFatal\(\); \}\)/);
  assert.equal([...app.matchAll(/location\.reload/g)].length, 1);
  assert.match(app, /function reload\(\): void \{ window\.location\.reload\(\); \}/);
  const router = source("router.ts");
  assert.match(router, /if \(isChunkLoadFailure\(error\)\) reportFatal\("route chunk load failed"\)/);
  assert.match(source("main.ts"), /\(window as unknown as \{ __bmFatal\?: \(\) => void \}\)\.__bmFatal\?\.\(\)/);
});

test("index.html 的兜底：重试后脚本仍然失败、或很久没有渲染出内容时，取出服务器下发的提示；样式文件失败不触发", () => {
  const html = root("web/index.html");
  assert.match(html, /function showFatal\(\)/);
  assert.match(html, /document\.getElementById\("bm-fatal"\)/);
  assert.match(html, /if \(node\.tagName === "SCRIPT"\) showFatal\(\);/);
  assert.match(html, /app\.childElementCount > 0\) return;/);
  assert.match(html, /setTimeout\(showFatal, 20000\)/);
  assert.match(html, /window\.__bmFatal = showFatal;/);
});
