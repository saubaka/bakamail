import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-seo-test-"));
process.env.SECRET_KEY = "isolated-seo-secret-value";
process.env.HUMAN_CHECK_TEST_MODE = "1";
process.env.COOKIE_SECURE = "0";
process.env.MADDY_RUNNER = "disabled";
process.env.MAIL_DOMAIN = "example.test";
process.env.BOOTSTRAP_ADMIN = "seo-root";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "isolated-test-only-2026";
process.env.PUBLIC_ORIGIN = "";

const { createApp } = await import("../src/app.ts");
const { default: request } = await import("./support/loopback-request.ts");
const { db, setSetting } = await import("../src/db.ts");
const { createAdmin } = await import("../src/admin/accounts.ts");
const { createAdminSession } = await import("../src/http/session.ts");
const { projectRoot } = await import("../src/config.ts");
const { renderSpaPage } = await import("../src/seo/page.ts");
const { defaultSeoConfig, INTRO_FAQ } = await import("../../shared/seo.ts");

const app = createApp({ log: () => undefined });
const indexHtml = readFileSync(join(projectRoot, "web", "index.html"), "utf8");
const hasDist = existsSync(join(projectRoot, "web", "dist", "index.html"));

let counter = 0;
async function superadmin() {
  const source = `203.0.113.${150 + (counter += 1)}`;
  const agent = request.agent(app);
  const challenge = await agent.get("/api/admin/human-check").set("x-real-ip", source);
  const signed = await agent.post("/api/admin/auth/login").set("x-real-ip", source)
    .send({ username: "seo-root", password: "isolated-test-only-2026", humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD" });
  assert.equal(signed.status, 200);
  return { agent, csrf: signed.body.data.csrfToken as string };
}
const full = (patch: Record<string, unknown>, revision: number) => ({ ...defaultSeoConfig(), ...patch, revision });
const auditActions = () => (db.prepare("select action, summary from audit_logs where action like 'seo.%' order by id").all() as { action: string; summary: string }[]);
const page = (path: string) => {
  const headers: Record<string, string> = {};
  const html = renderSpaPage(indexHtml, { path }, { setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; } });
  return { html, headers };
};

test("未配置时：站点信息是默认值，robots.txt 允许抓取首页，没有规范网址所以没有站点地图", async () => {
  const info = await request(app).get("/api/site-info");
  assert.equal(info.status, 200);
  assert.deepEqual(info.body.data, {
    siteName: "Baka Mail", tagline: "自建邮局的网页端", title: "Baka Mail - 自建邮局的网页邮箱",
    description: info.body.data.description,
  });
  assert.match(info.body.data.description, /^Baka Mail是给自建 Maddy 邮局用的网页邮箱/);
  assert.equal(info.headers["x-robots-tag"], "noindex, nofollow");
  assert.equal(info.headers["cache-control"], "no-store");
  const robots = await request(app).get("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(String(robots.headers["content-type"]), /^text\/plain/);
  assert.equal(robots.text, "User-agent: *\nDisallow: /api/\n");
  const sitemap = await request(app).get("/sitemap.xml");
  assert.equal(sitemap.status, 404);
  assert.equal(sitemap.headers["cache-control"], "no-store");
  assert.equal((await request(app).get("/api/health")).headers["x-robots-tag"], "noindex, nofollow");
  assert.equal(info.body.data.siteName === "Baka Mail" && auditActions().length, 0);
});

test("接口权限：未登录 401；没有 system.seo.write 的管理员 403；缺少 CSRF 403", async () => {
  for (const method of ["get", "put", "delete"] as const) assert.equal((await request(app)[method]("/api/admin/seo").send({})).status, 401, method);
  const plain = createAdmin("seo-plain-admin", "isolated-password-2026", "admin");
  assert.ok(plain.ok); if (!plain.ok) return;
  const session = createAdminSession(plain.id, "test", "test");
  const asPlain = (method: "get" | "put" | "delete") => request(app)[method]("/api/admin/seo").set("Cookie", `bm_admin=${session.token}`).set("x-csrf-token", session.csrfToken).send(full({}, 0));
  for (const method of ["get", "put", "delete"] as const) assert.equal((await asPlain(method)).status, 403, method);
  const { agent } = await superadmin();
  assert.equal((await agent.get("/api/admin/seo")).status, 200);
  assert.equal((await agent.put("/api/admin/seo").send(full({}, 0))).status, 403, "PUT 缺少 CSRF");
  assert.equal((await agent.delete("/api/admin/seo")).status, 403, "DELETE 缺少 CSRF");
});

test("读取返回已保存配置、生效值、评分和规范网址来源；没有网址时评分提示", async () => {
  const { agent } = await superadmin();
  const view = (await agent.get("/api/admin/seo")).body.data;
  assert.equal(view.revision, 0);
  assert.deepEqual(view.config, defaultSeoConfig());
  assert.deepEqual(view.origin, { value: "", source: "none" });
  assert.equal(view.envOrigin, "");
  assert.equal(view.effective.title, "Baka Mail - 自建邮局的网页邮箱");
  assert.equal(view.report.checks.find((check: { id: string }) => check.id === "canonical").level, "fail");
});

test("保存校验：缺少版本号、非法字段、非法值、超大请求都被拒绝且不改动配置", async () => {
  const { agent, csrf } = await superadmin();
  const put = (body: unknown) => agent.put("/api/admin/seo").set("x-csrf-token", csrf).send(body as object);
  assert.equal((await put({ ...defaultSeoConfig() })).status, 400, "没有 revision");
  assert.equal((await put(full({}, -1))).status, 400);
  assert.equal((await put({ ...full({}, 0), revision: "0" })).status, 400);
  assert.equal((await put([])).status, 400);
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ siteName: "" }, /站点名称不能为空/], [{ siteName: "<b>" }, /不能包含/], [{ siteName: "字".repeat(31) }, /最多 30/],
    [{ canonicalOrigin: "http://mail.example.com" }, /https/], [{ canonicalOrigin: "https://mail.example.com/x" }, /不要带路径/],
    [{ ogImage: "/logo.svg" }, /png/], [{ themeColor: "red" }, /#RRGGBB/], [{ twitterCard: "player" }, /summary/],
    [{ keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }, /最多 20/], [{ verification: { google: "short" } }, /格式不对/],
    [{ indexHome: "yes" }, /开或关/], [{ unknownField: 1 }, /不支持的字段/],
  ];
  for (const [patch, message] of bad) {
    const response = await put(full(patch, 0));
    assert.equal(response.status, 400, JSON.stringify(patch));
    assert.match(response.body.error, message, JSON.stringify(patch));
  }
  assert.equal((await put({ ...full({}, 0), description: "字".repeat(20000) })).status, 413);
  const view = (await agent.get("/api/admin/seo")).body.data;
  assert.equal(view.revision, 0);
  assert.equal(auditActions().length, 0, "拒绝的请求不写审计");
});

test("保存成功：版本号递增、生效值立即更新、站点信息和 robots/sitemap 同步变化，审计只记录改了哪些项", async () => {
  const { agent, csrf } = await superadmin();
  const put = (body: object) => agent.put("/api/admin/seo").set("x-csrf-token", csrf).send(body);
  const saved = await put(full({
    siteName: "某某邮箱", tagline: "我的邮局", homeTitle: "某某邮箱 - 靠谱的网页邮箱", description: "这是我自己写的首页描述，用来说明站点是做什么的，给谁用，足够具体也足够简短，方便搜索结果展示。",
    keywords: ["邮箱", "webmail", "邮箱"], canonicalOrigin: "https://MAIL.example.com/",
    verification: { google: '<meta name="google-site-verification" content="verifyCODE12345" />', baidu: "" },
  }, 0));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const view = saved.body.data;
  assert.equal(view.revision, 1);
  assert.equal(view.config.canonicalOrigin, "https://mail.example.com");
  assert.deepEqual(view.config.keywords, ["邮箱", "webmail"]);
  assert.equal(view.config.verification.google, "verifyCODE12345");
  assert.equal(view.origin.source, "setting");
  assert.equal(view.effective.ogImageUrl, "https://mail.example.com/og-image.png");
  assert.ok(view.updatedAt.length > 10);
  const info = (await request(app).get("/api/site-info")).body.data;
  assert.equal(info.siteName, "某某邮箱");
  assert.equal(info.title, "某某邮箱 - 靠谱的网页邮箱");
  assert.equal(info.tagline, "我的邮局");
  const robots = (await request(app).get("/robots.txt")).text;
  assert.ok(robots.endsWith("Sitemap: https://mail.example.com/sitemap.xml\n"), robots);
  const sitemap = await request(app).get("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.match(String(sitemap.headers["content-type"]), /^application\/xml/);
  assert.match(sitemap.text, /<loc>https:\/\/mail\.example\.com\/<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  const audit = auditActions().filter((entry) => entry.action === "seo.update");
  assert.equal(audit.length, 1);
  for (const key of ["siteName", "tagline", "homeTitle", "description", "keywords", "canonicalOrigin", "verification.google"]) assert.ok(audit[0]!.summary.includes(key), key);
  assert.ok(!audit[0]!.summary.includes("verifyCODE12345") && !audit[0]!.summary.includes("某某邮箱"), "审计不记录具体内容");
});

test("并发保护：旧版本号保存返回 409 且不覆盖；用新版本号可以继续保存；无变化的保存也记录审计并递增版本", async () => {
  const { agent, csrf } = await superadmin();
  const put = (body: object) => agent.put("/api/admin/seo").set("x-csrf-token", csrf).send(body);
  const current = (await agent.get("/api/admin/seo")).body.data;
  const stale = await put({ ...current.config, siteName: "过期的修改", revision: current.revision - 1 });
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /已被其他管理员修改/);
  assert.equal((await agent.get("/api/admin/seo")).body.data.config.siteName, "某某邮箱");
  const again = await put({ ...current.config, revision: current.revision });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.revision, current.revision + 1);
  assert.ok(auditActions().some((entry) => entry.summary === "保存（无变化）"));
});

test("不收录：robots.txt 整站禁止、站点地图 404、页面带 noindex；恢复后重新放开", async () => {
  const { agent, csrf } = await superadmin();
  const current = (await agent.get("/api/admin/seo")).body.data;
  const off = await agent.put("/api/admin/seo").set("x-csrf-token", csrf).send({ ...current.config, indexHome: false, revision: current.revision });
  assert.equal(off.status, 200);
  assert.equal((await request(app).get("/robots.txt")).text, "User-agent: *\nDisallow: /\n");
  assert.equal((await request(app).get("/sitemap.xml")).status, 404);
  const home = page("/");
  assert.match(home.html, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.equal(home.headers["x-robots-tag"], "noindex, nofollow");
  const on = await agent.put("/api/admin/seo").set("x-csrf-token", csrf).send({ ...off.body.data.config, indexHome: true, revision: off.body.data.revision });
  assert.equal(on.status, 200);
  assert.match(page("/").html, /content="index, follow, max-image-preview:large/);
});

test("首页页面：标题、描述、规范网址、分享卡片、结构化数据和无脚本正文都来自当前设置，旧名称不再出现", () => {
  const { html, headers } = page("/");
  assert.equal(headers["x-robots-tag"], undefined, "可收录的首页没有 noindex 响应头");
  assert.match(html, /<title>某某邮箱 - 靠谱的网页邮箱<\/title>/);
  assert.equal([...html.matchAll(/<title>/g)].length, 1);
  assert.doesNotMatch(html, /<title>Baka Mail<\/title>/);
  for (const expected of [
    '<meta name="description" content="这是我自己写的首页描述', '<link rel="canonical" href="https://mail.example.com/" />', '<meta property="og:site_name" content="某某邮箱" />',
    '<meta property="og:image" content="https://mail.example.com/og-image.png" />', '<meta name="google-site-verification" content="verifyCODE12345" />', "<noscript>",
  ]) assert.ok(html.includes(expected), expected);
  assert.equal([...html.matchAll(/name="robots"/g)].length, 1, "原来的 noindex 标签被替换，不重复");
  assert.equal([...html.matchAll(/name="theme-color"/g)].length, 1);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
  assert.equal(ld["@graph"][0].name, "某某邮箱");
  assert.deepEqual(ld["@graph"][2].mainEntity.map((item: { name: string }) => item.name), INTRO_FAQ.map((item) => item.question));
  const site = JSON.parse(html.match(/<script id="bm-site" type="application\/json">([\s\S]*?)<\/script>/)![1]!);
  assert.deepEqual(site, { siteName: "某某邮箱", tagline: "我的邮局", title: "某某邮箱 - 靠谱的网页邮箱", description: site.description });
  const noscript = html.match(/<noscript>[\s\S]*<\/noscript>/)![0];
  assert.match(noscript, /<h1>某某邮箱<\/h1>/);
  assert.ok(noscript.includes("https://github.com/saubaka/bakamail") && noscript.includes("© ") && noscript.includes("saubaka. BakaMail."), "开源和版权标记固定");
  assert.ok(html.indexOf("<noscript>") < html.indexOf('<div id="app"></div>'));
});

test("其他页面：标题是站点名，一律 noindex 并带响应头，不输出描述、规范网址、分享卡片或结构化数据", () => {
  for (const path of ["/login", "/register", "/password-reset", "/mail", "/mail/search", "/setup", "/some-admin-entry/overview", "/unavailable"]) {
    const { html, headers } = page(path);
    assert.match(html, /<title>某某邮箱<\/title>/, path);
    assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/, path);
    assert.equal(headers["x-robots-tag"], "noindex, nofollow", path);
    assert.doesNotMatch(html, /rel="canonical"|og:title|name="description"|ld\+json/, path);
    assert.ok(html.includes("需要开启 JavaScript") && !html.includes("<noscript><main>"), `${path} 的无脚本内容只是提示，不是首页正文`);
    assert.ok(html.includes('id="bm-site"'), `${path} 也带站点信息，品牌名才会正确`);
  }
});

test("恶意内容不会破坏页面：描述里的脚本结束标记、引号和尖括号在头部、结构化数据和站点信息里都被转义", async () => {
  const { agent, csrf } = await superadmin();
  const current = (await agent.get("/api/admin/seo")).body.data;
  const evil = '</script><img src=x onerror=alert(1)> "引号" & \'单引号\'';
  const saved = await agent.put("/api/admin/seo").set("x-csrf-token", csrf)
    .send({ ...current.config, description: evil, homeTitle: evil, tagline: '</script>"&', siteName: 'A"B&C', revision: current.revision });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const { html } = page("/");
  assert.doesNotMatch(html, /<img src=x/);
  const withoutData = html.replace(/<script (?:id="bm-site" type="application\/json"|type="application\/ld\+json")>[\s\S]*?<\/script>/g, "");
  assert.equal([...withoutData.matchAll(/<\/script>/g)].length, [...withoutData.matchAll(/<script/g)].length, "页面自己的脚本标签成对，没有被提前结束");
  assert.match(html, /<title>&lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(html.includes('content="A&quot;B&amp;C"'));
  JSON.parse(html.match(/<script id="bm-site" type="application\/json">([\s\S]*?)<\/script>/)![1]!);
  JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
});

test("恢复默认：站点名回到 Baka Mail，其余清空，版本号继续递增，记录审计；不需要版本号", async () => {
  const { agent, csrf } = await superadmin();
  const before = (await agent.get("/api/admin/seo")).body.data;
  const reset = await agent.delete("/api/admin/seo").set("x-csrf-token", csrf);
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.body.data.config, defaultSeoConfig());
  assert.equal(reset.body.data.revision, before.revision + 1);
  assert.equal((await request(app).get("/api/site-info")).body.data.siteName, "Baka Mail");
  assert.ok(auditActions().some((entry) => entry.action === "seo.reset"));
  assert.match(page("/").html, /<title>Baka Mail - 自建邮局的网页邮箱<\/title>/);
});

test("存储损坏时页面和接口仍可用：按默认值提供，管理端可以保存覆盖", async () => {
  setSetting("seo", "{这不是 JSON");
  assert.equal((await request(app).get("/api/site-info")).body.data.siteName, "Baka Mail");
  assert.match(page("/").html, /<title>Baka Mail - /);
  const { agent, csrf } = await superadmin();
  const view = (await agent.get("/api/admin/seo")).body.data;
  assert.equal(view.revision, 0);
  assert.deepEqual(view.config, defaultSeoConfig());
  const saved = await agent.put("/api/admin/seo").set("x-csrf-token", csrf).send({ ...view.config, siteName: "修复后", revision: 0 });
  assert.equal(saved.status, 200);
  setSetting("seo", JSON.stringify({ config: { ...defaultSeoConfig(), siteName: "<b>" }, revision: 3, updatedAt: "" }));
  assert.equal((await request(app).get("/api/site-info")).body.data.siteName, "Baka Mail", "存储里的非法值被忽略");
});

test("已构建前端时：首页和其他页面的真实响应带上设置的标题和 noindex，CSP 随页面下发，页面自己的脚本仍带 nonce", async () => {
  if (!hasDist) return; // 只有源码的检出可以没有构建产物。
  setSetting("seo", JSON.stringify({ config: { ...defaultSeoConfig(), siteName: "构建后检查", canonicalOrigin: "https://mail.example.com" }, revision: 9, updatedAt: "2026-10-12T00:00:00.000Z" }));
  const home = await request(app).get("/");
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>构建后检查 - 自建邮局的网页邮箱<\/title>/);
  assert.match(home.text, /rel="canonical" href="https:\/\/mail\.example\.com\/"/);
  assert.equal(home.headers["x-robots-tag"], undefined);
  assert.match(String(home.headers["content-security-policy"]), /script-src 'self' 'nonce-/);
  assert.doesNotMatch(home.text, /<script>/, "每个无属性的内联脚本都带 nonce");
  const login = await request(app).get("/login");
  assert.match(login.text, /<title>构建后检查<\/title>/);
  assert.equal(login.headers["x-robots-tag"], "noindex, nofollow");
  assert.equal((await request(app).get("/login?x=1")).headers["x-robots-tag"], "noindex, nofollow");
});
