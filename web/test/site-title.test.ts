import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { applySiteInfo, pageTitleFor } from "../src/siteInfo.ts";

test("所有页面不再显示开发者署名后缀，共用邮箱页脚保留年份与项目版权", () => {
  const walk = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".vue")) {
        assert.doesNotMatch(readFileSync(path, "utf8"), /·\s*由\s*Saubaka\s*开发/i, path.pathname);
      }
    }
  };
  walk(new URL("../src/", import.meta.url));
  const workspace = readFileSync(new URL("../src/components/MailWorkspace.vue", import.meta.url), "utf8");
  assert.match(workspace, /<footer class="workspace-copyright">© \{\{ new Date\(\)\.getFullYear\(\) \}\} BakaMail<\/footer>/);
});

test("HTML 初始标题为默认的 Baka Mail（服务端会换成后台设置的站点名），脚本执行前也不出现旧名称", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.deepEqual([...html.matchAll(/<title>(.*?)<\/title>/g)].map(match => match[1]), ["Baka Mail"]);
});

test("生产路由的全局导航完成钩子按站点信息设置标题：首页用 SEO 标题，其余页面用站点名，并保留会话检查", () => {
  const source = readFileSync(new URL("../src/router.ts", import.meta.url), "utf8");
  const hook = source.match(/router\.afterEach\((\(to\) => \{[\s\S]*?\n\})\);/);
  assert.ok(hook, "需要无路由名称分支的全局完成钩子");
  const document = { title: "" };
  let checks = 0;
  const afterEach = runInNewContext(`(${hook[1]})`, {
    document, scheduleSessionCheck: () => { checks++; }, pageTitleFor,
  }) as (route: { name?: string }) => void;
  const routes = ["intro", "login", "register", "password-reset", "unavailable", "not-found",
    "mail", "mail-search", "mail-drafts", "mail-contacts", "mail-settings", "admin-login",
    "admin-overview", "admin-accounts", "admin-invites", "admin-mail-ops", "admin-security",
    "admin-human-check", "admin-admins", "admin-system", "admin-seo", "future-page", undefined];
  assert.equal(applySiteInfo({ siteName: "Baka Mail", tagline: "自建邮局的网页端", title: "Baka Mail - 自建邮局的网页邮箱", description: "描述" }), true);
  for (const name of routes) {
    document.title = "旧标题";
    afterEach({ name });
    assert.equal(document.title, name === "intro" ? "Baka Mail - 自建邮局的网页邮箱" : "Baka Mail", String(name));
  }
  assert.equal(checks, routes.length);
  // 站点名改掉以后，所有页面的标题立刻跟着变。
  applySiteInfo({ siteName: "某某邮箱", tagline: "t", title: "某某邮箱 - 自建邮局的网页邮箱", description: "d" });
  afterEach({ name: "login" }); assert.equal(document.title, "某某邮箱");
  afterEach({ name: "intro" }); assert.equal(document.title, "某某邮箱 - 自建邮局的网页邮箱");
  assert.doesNotMatch(source, /routeTitles/);
  assert.doesNotMatch(source, /document\.title = "Baka Mail"/, "标题不再写死");
});

test("首页没有开发者栏：导航只剩功能介绍和常见问题，且每个导航锚点都对应页面里真实存在的区块", () => {
  const intro = readFileSync(new URL("../src/views/IntroView.vue", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/intro.css", import.meta.url), "utf8");
  assert.doesNotMatch(intro, /开发者|id="developer"|developer-title|intro-developer/);
  assert.doesNotMatch(css, /intro-developer/, "its styles are gone too");
  const nav = intro.match(/<nav class="intro-nav"[^>]*>([\s\S]*?)<\/nav>/)![1]!;
  const anchors = [...nav.matchAll(/href="#([a-z-]+)"/g)].map((match) => match[1]!);
  assert.deepEqual(anchors, ["about", "faq"]);
  for (const anchor of anchors) assert.match(intro, new RegExp(`<section id="${anchor}"`), `#${anchor} must exist`);
  assert.equal(css.split("{").length, css.split("}").length, "stylesheet braces stay balanced");
});
