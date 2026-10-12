import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-error-pages-test-"));
process.env.SECRET_KEY = "isolated-error-pages-secret";
process.env.COOKIE_SECURE = "0";
process.env.MADDY_RUNNER = "disabled";
process.env.MAIL_DOMAIN = "example.test";

const { createApp, createErrorHandler } = await import("../src/app.ts");
const { default: request } = await import("./support/loopback-request.ts");
const { wantsHtml, sendErrorPage } = await import("../src/http/errorPage.ts");
const { projectRoot } = await import("../src/config.ts");
const express = (await import("express")).default;
const { RequestBodyError } = await import("../src/http/kit.ts");

const hasDist = existsSync(join(projectRoot, "web", "dist", "index.html"));
const app = createApp({ bootstrapAdmin: false, log: () => undefined });
const HTML = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };

test("什么时候给网页：地址栏打开的页面请求才给网页，脚本、图片和接口请求不给", () => {
  const h = (headers: Record<string, string>) => ({ headers });
  assert.equal(wantsHtml(h({ accept: "text/html,application/xhtml+xml" })), true);
  assert.equal(wantsHtml(h({ accept: "*/*" })), false);
  assert.equal(wantsHtml(h({})), false);
  assert.equal(wantsHtml(h({ accept: "application/json" })), false);
  assert.equal(wantsHtml(h({ accept: "text/html", "sec-fetch-dest": "document" })), true);
  assert.equal(wantsHtml(h({ accept: "text/html", "sec-fetch-dest": "iframe" })), true);
  for (const dest of ["script", "image", "style", "empty", "font"]) assert.equal(wantsHtml(h({ accept: "text/html,*/*", "sec-fetch-dest": dest })), false, dest);
});

test("找不到的文件：浏览器打开得到统一风格的 404 页，脚本请求仍是简短纯文本；两者都不缓存、不收录、不回显路径", async () => {
  const page = await request(app).get("/wp-login.php?probe=<script>alert(1)</script>").set(HTML);
  assert.equal(page.status, 404);
  assert.match(String(page.headers["content-type"]), /^text\/html/);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.headers["x-robots-tag"], "noindex, nofollow");
  assert.match(page.text, /<title>404 找不到这个页面 - /);
  assert.match(page.text, /<h1 class="ep-title" id="ep-title">找不到这个页面<\/h1>/);
  assert.doesNotMatch(page.text, /wp-login|probe|alert\(1\)|<script/i, "不回显请求内容，也没有脚本");
  assert.doesNotMatch(page.text, /错误编号/, "404 不显示编号");
  const script = await request(app).get("/assets/missing-chunk.js").set({ accept: "*/*", "sec-fetch-dest": "script" });
  assert.equal(script.status, 404);
  assert.match(String(script.headers["content-type"]), /^text\/plain/);
  assert.equal(script.text, "Not Found");
  const bare = await request(app).get("/missing.css");
  assert.equal(bare.text, "Not Found");
  assert.equal(bare.headers["cache-control"], "no-store");
});

test("已退役的旧后台地址：浏览器打开得到同样的统一 404 页，没有任何后台线索；其他请求仍是纯文本", async () => {
  for (const path of ["/admin", "/admin/login", "/ADMIN/accounts", "/admin/old.js"]) {
    const page = await request(app).get(path).set(HTML);
    assert.equal(page.status, 404, path);
    assert.match(page.text, /找不到这个页面/, path);
    assert.doesNotMatch(page.text, /bakaadmin|index\.html|<script|admin/i, path);
    assert.equal(page.headers["location"], undefined);
    const plain = await request(app).get(path);
    assert.equal(plain.status, 404);
    assert.equal(plain.text, "Not Found");
  }
});

test("接口的 404 仍是 JSON，不被换成网页", async () => {
  const response = await request(app).get("/api/nope").set(HTML);
  assert.equal(response.status, 404);
  assert.match(String(response.headers["content-type"]), /^application\/json/);
  assert.equal(response.body.ok, false);
});

test("未知地址返回真正的 404 状态（页面外壳照常下发，前端显示 404 页）；公开页面是 200；后台入口与任意乱写的地址无法区分", async () => {
  if (!hasDist) return; // 只有源码的检出可以没有构建产物。
  for (const path of ["/", "/login", "/register", "/password-reset", "/unavailable", "/setup", "/mail", "/mail/search", "/login/"]) {
    const response = await request(app).get(path).set(HTML);
    assert.equal(response.status, 200, path);
    assert.match(response.text, /<div id="app"><\/div>/, path);
  }
  const statuses = new Set<number>();
  const bodies = new Set<string>();
  for (const path of ["/nope", "/bakaadmin", "/bakaadmin/overview", "/x/y/z", "/mailx", "/some-secret-entry"]) {
    const response = await request(app).get(path).set(HTML);
    statuses.add(response.status);
    assert.match(response.text, /<div id="app"><\/div>/, `${path} 仍然下发页面外壳，前端据此显示内容`);
    assert.equal(response.headers["x-robots-tag"], "noindex, nofollow", path);
    assert.equal(response.headers["cache-control"], "no-cache, must-revalidate");
    assert.match(String(response.headers["content-security-policy"]), /script-src 'self' 'nonce-/);
    bodies.add(response.text.replace(/nonce="[^"]+"/g, "").replace(/nonce-[A-Za-z0-9+/=]+/g, "").replace(/<title>[^<]*<\/title>/, ""));
  }
  assert.deepEqual([...statuses], [404], "后台入口和乱写的地址状态码相同");
  assert.equal(bodies.size, 1, "页面外壳完全相同，无法通过响应内容区分");
});

test("页面外壳里备好了脚本加载失败的兜底：模板、无脚本提示，首页和其他页面分别是正文和“需要开启 JavaScript”", async () => {
  if (!hasDist) return;
  const home = (await request(app).get("/").set(HTML)).text;
  const login = (await request(app).get("/login").set(HTML)).text;
  for (const html of [home, login]) {
    assert.match(html, /<template id="bm-fatal"><style>/);
    assert.match(html, /页面没有加载出来/);
    assert.match(html, /function showFatal\(\)/);
    assert.doesNotMatch(html, /<script>/, "每个内联脚本都带 nonce");
  }
  assert.match(home, /<noscript><main><h1>/, "首页的无脚本内容是给抓取工具看的正文");
  assert.doesNotMatch(home, /需要开启 JavaScript/);
  assert.match(login, /<head>[\s\S]*<noscript><style>[\s\S]*<\/style><\/noscript>\s*<\/head>/, "样式放在 head 的 noscript 里");
  assert.match(login, /<body>[\s\S]*<noscript><div class="ep-page">[\s\S]*需要开启 JavaScript/);
  assert.doesNotMatch(login, /<noscript><main>/);
});

test("异常出口：浏览器页面请求返回 500 错误页（带错误编号，不泄漏异常内容）；接口、脚本请求仍返回 JSON；4xx 异常保留原状态码", async () => {
  const logs: string[] = [];
  const harness = express();
  harness.get("/boom", () => { throw new Error("password=hunter2 imap://secret.internal:993"); });
  harness.get("/api/boom", () => { throw new Error("secret detail"); });
  harness.get("/bad-uri", () => { throw Object.assign(new Error("Failed to decode param"), { status: 400 }); });
  harness.get("/odd-status", () => { throw Object.assign(new Error("x"), { status: 999 }); });
  harness.get("/body", () => { throw new RequestBodyError(413, "too_large", "请求内容过大"); });
  harness.use(createErrorHandler((message) => { logs.push(message); }));

  const page = await request(harness).get("/boom").set({ ...HTML, "x-request-id": "req-12345" });
  assert.equal(page.status, 500);
  assert.match(String(page.headers["content-type"]), /^text\/html/);
  assert.match(page.text, /<title>500 服务出了点问题/);
  assert.match(page.text, /错误编号 <code>req-12345<\/code>/);
  assert.doesNotMatch(page.text, /hunter2|secret|imap|boom|Error:/i);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.headers["x-robots-tag"], "noindex, nofollow");
  assert.ok(logs.some((line) => line.includes("request-id=req-12345")) && logs.every((line) => !/hunter2|secret/.test(line)));

  for (const [path, headers] of [["/api/boom", HTML], ["/boom", { accept: "*/*" }], ["/boom", { accept: "text/html", "sec-fetch-dest": "script" }]] as const) {
    const response = await request(harness).get(path).set(headers);
    assert.equal(response.status, 500, path);
    assert.match(String(response.headers["content-type"]), /^application\/json/, path);
    assert.deepEqual(response.body, { ok: false, data: null, error: "服务器内部错误" });
  }
  const badUri = await request(harness).get("/bad-uri").set(HTML);
  assert.equal(badUri.status, 400);
  assert.match(badUri.text, /请求有问题/);
  assert.equal((await request(harness).get("/odd-status").set(HTML)).status, 500, "不合法的状态码退回 500");
  const body = await request(harness).get("/body").set(HTML);
  assert.equal(body.status, 413);
  assert.match(String(body.headers["content-type"]), /^application\/json/, "请求体错误保持原有的 JSON 约定");
});

test("统一出口的响应头：429 和 503 带建议等待时间，页面里的秒数向上取整", async () => {
  const harness = express();
  harness.get("/limited", (request, response) => { sendErrorPage(request, response, 429, { retryAfter: 4.2 }); });
  harness.get("/down", (request, response) => { sendErrorPage(request, response, 503, { retryAfter: 30 }); });
  harness.get("/plain", (request, response) => { sendErrorPage(request, response, 502); });
  const limited = await request(harness).get("/limited").set(HTML);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "5");
  assert.match(limited.text, /请大约等待 5 秒后再试/);
  const down = await request(harness).get("/down");
  assert.equal(down.status, 503);
  assert.equal(down.headers["retry-after"], "30");
  const plain = await request(harness).get("/plain");
  assert.equal(plain.status, 502);
  assert.equal(plain.headers["retry-after"], undefined);
  assert.match(plain.text, /暂时连不上服务/);
});
