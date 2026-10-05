import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

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

test("HTML 初始标题统一为 Baka Mail，脚本执行前也不出现旧名称", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.deepEqual([...html.matchAll(/<title>(.*?)<\/title>/g)].map(match => match[1]), ["Baka Mail"]);
});

test("生产路由的全局导航完成钩子为所有页面恢复同一标题并保留会话检查", () => {
  const source = readFileSync(new URL("../src/router.ts", import.meta.url), "utf8");
  const hook = source.match(/router\.afterEach\((\(\) => \{[\s\S]*?\n\})\);/);
  assert.ok(hook, "需要无路由名称分支的全局完成钩子");
  const document = { title: "" };
  let checks = 0;
  const afterEach = runInNewContext(`(${hook[1]})`, {
    document, scheduleSessionCheck: () => { checks++; },
  }) as (route: { name?: string }) => void;
  const routes = ["intro", "login", "register", "password-reset", "unavailable", "not-found",
    "mail", "mail-search", "mail-drafts", "mail-contacts", "mail-settings", "admin-login",
    "admin-overview", "admin-accounts", "admin-invites", "admin-mail-ops", "admin-security",
    "admin-admins", "admin-system", "future-page", undefined];
  for (const name of routes) {
    document.title = "旧标题";
    afterEach({ name });
    assert.equal(document.title, "Baka Mail", name);
  }
  assert.equal(checks, routes.length);
  assert.doesNotMatch(source, /routeTitles/);
});
