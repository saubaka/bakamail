import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { setCsrfToken } from "../src/api/client.ts";
import { loadSeo, resetSeo, saveSeo } from "../src/api/seo.ts";
import { RAIL_ITEMS } from "../src/admin/navModel.ts";
import { adminRoutes } from "../src/auth/adminRoutes.ts";
import { applySiteInfo, pageTitleFor, readInjectedSiteInfo, refreshSiteInfo, siteInfo } from "../src/siteInfo.ts";
import { defaultSeoConfig, evaluateSeo } from "../../shared/seo.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const view = source("views/admin/SeoView.vue");
const template = view.slice(0, view.indexOf("<script setup"));
const style = view.slice(view.indexOf("<style scoped>"));

test("菜单、路由、权限和图标：SEO 管理在系统分区，只有 system.seo.write 能看到，快捷键 g e", () => {
  const item = RAIL_ITEMS.find((entry) => entry.name === "admin-seo")!;
  assert.deepEqual({ label: item.label, section: item.section, permission: item.permission, shortcut: item.shortcut, icon: item.icon },
    { label: "SEO 管理", section: "system", permission: "system.seo.write", shortcut: "e", icon: "seo" });
  const children = adminRoutes.find((route) => route.name === "admin-workspace-root")!.children!;
  const route = children.find((entry) => entry.name === "admin-seo")!;
  assert.equal(route.path, "seo");
  assert.equal((route.meta as { permission: string }).permission, "system.seo.write");
  assert.match(source("components/admin/AdminIcon.vue"), /\n  seo: \[/);
  const server = readFileSync(new URL("../../server/src/routes/seo.ts", import.meta.url), "utf8");
  assert.match(server, /requirePermission\("system\.seo\.write"\)/);
});

test("评分里的每一项都能点到对应的输入框，输入框 id 真实存在于页面里", () => {
  const ids = evaluateSeo(defaultSeoConfig(), "https://mail.example.com").checks.map((check) => check.id);
  const mapping = runInNewContext(`(${view.match(/const fieldFor: Record<string, string> = (\{[\s\S]*?\});/)![1]})`) as Record<string, string>;
  for (const id of ids) {
    assert.ok(id in mapping, `评分项 ${id} 需要对应输入框`);
    assert.ok(template.includes(`id="${mapping[id]}"`) || template.includes(`:id="\`${mapping[id]}\`"`) || mapping[id] === "seo-verify-google", `${mapping[id]} 必须存在`);
  }
  for (const id of ["seo-verify-google"]) assert.match(template, /:id="`seo-verify-\$\{item\.key\}`"/);
});

test("页面所有按钮都声明了 type，只有“保存”是提交按钮；回车提交走同一个保存流程", () => {
  const buttons = [...template.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(buttons.length >= 8);
  for (const tag of buttons) assert.match(tag, /type="(button|submit)"/, tag);
  assert.equal(buttons.filter((tag) => /type="submit"/.test(tag)).length, 1);
  assert.match(template, /<form class="admin-page-stack seo" novalidate[^>]*@submit\.prevent="save"/);
});

test("保存栏：未保存提示、放弃修改、恢复默认（带确认）、冲突后重新读取；离开页面和关闭窗口前提醒", () => {
  for (const text of ["有未保存的修改", "放弃修改", "恢复默认", "重新读取"]) assert.ok(view.includes(text), text);
  assert.match(view, /onBeforeRouteLeave\(async \(\) => !dirty\.value \|\| \(await confirmDialog\(/);
  assert.match(view, /addEventListener\("beforeunload", beforeUnload\)/);
  assert.match(view, /removeEventListener\("beforeunload", beforeUnload\)/);
  assert.match(view, /title: "恢复默认设置"[\s\S]*tone: "danger"/);
  assert.match(view, /reason\.status === 409/);
  assert.match(view, /applySiteInfo\(siteInfoOf\(next\.effective\)\);\s*document\.title = siteInfo\.siteName;/);
  assert.match(view, /const canSave = computed\(\(\) => dirty\.value && parsed\.value\.ok && !busy\.value\)/);
});

test("样式：没有渐变和写死的未知颜色变量，窄屏单列，保存栏吸底，减少动画时无过渡", () => {
  assert.doesNotMatch(style, /gradient/i);
  assert.match(style, /\.seo-savebar \{[^}]*position: sticky; bottom: 14px/);
  assert.match(style, /@media \(max-width: 700px\)[\s\S]*\.seo-fields \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(style, /@media \(max-width: 900px\) \{ \.seo-groups, \.seo-files \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  assert.match(style, /prefers-reduced-motion: reduce/);
  assert.equal(style.split("{").length, style.split("}").length, "大括号配对");
  assert.match(template, /class="admin-page-stack seo"/);
});

test("固定内容不受 SEO 设置影响，系统设置里不再有没用的站点名输入框", () => {
  const system = source("views/admin/SystemView.vue");
  assert.doesNotMatch(system, /settings\.siteName|siteName:|<span class="field__label">站点名称<\/span>/);
  assert.match(system, /公告与欢迎邮件/);
  assert.match(template, /页面底部的开源仓库链接和版权标记固定显示/);
});

test("接口封装：读取、保存带版本号、恢复默认；方法和路径与服务端一致", async () => {
  const original = globalThis.fetch;
  const calls: { path: string; method: string; body: Record<string, unknown> | null; csrf: string | null }[] = [];
  setCsrfToken("seo-csrf", "admin");
  globalThis.fetch = async (input, options) => {
    calls.push({ path: String(input), method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : null, csrf: new Headers(options?.headers).get("x-csrf-token") });
    return Response.json({ ok: true, data: { revision: 4 }, error: "" });
  };
  try {
    await loadSeo();
    await saveSeo({ ...defaultSeoConfig(), siteName: "某某邮箱" }, 3);
    await resetSeo();
  } finally { globalThis.fetch = original; }
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), ["GET /api/admin/seo", "PUT /api/admin/seo", "DELETE /api/admin/seo"]);
  assert.equal(calls[1]!.body!.siteName, "某某邮箱");
  assert.equal(calls[1]!.body!.revision, 3);
  assert.equal(calls[1]!.csrf, "seo-csrf");
  assert.equal(calls[0]!.csrf, null);
});

test("站点信息：读取页面里的 JSON；格式不对、缺字段或为空时忽略并保留当前值；名称改变后标题立即变化", async () => {
  applySiteInfo({ siteName: "Baka Mail", tagline: "自建邮局的网页端", title: "Baka Mail - 自建邮局的网页邮箱", description: "描述" });
  const doc = (text: string | null) => ({ getElementById: () => (text === null ? null : { textContent: text }) }) as unknown as Document;
  assert.equal(readInjectedSiteInfo(doc(null)), false);
  assert.equal(readInjectedSiteInfo(doc("{坏的")), false);
  assert.equal(readInjectedSiteInfo(doc(JSON.stringify({ siteName: "", tagline: "t", title: "t", description: "d" }))), false);
  assert.equal(readInjectedSiteInfo(doc(JSON.stringify({ siteName: "x", tagline: "t", title: "t" }))), false);
  assert.equal(siteInfo.siteName, "Baka Mail", "失败的读取不改动当前值");
  assert.equal(readInjectedSiteInfo(doc(JSON.stringify({ siteName: "某某邮箱", tagline: "我的邮局", title: "某某邮箱 - 首页", description: "d" }))), true);
  assert.deepEqual({ ...siteInfo }, { siteName: "某某邮箱", tagline: "我的邮局", title: "某某邮箱 - 首页", description: "d" });
  assert.equal(pageTitleFor("intro"), "某某邮箱 - 首页");
  for (const name of ["login", "mail", "admin-seo", undefined, null]) assert.equal(pageTitleFor(name), "某某邮箱");
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true, data: { siteName: "接口名", tagline: "t", title: "接口名 - 首页", description: "d" }, error: "" });
  try { assert.equal(await refreshSiteInfo(), true); } finally { globalThis.fetch = original; }
  assert.equal(siteInfo.siteName, "接口名");
  globalThis.fetch = async () => { throw new Error("offline"); };
  try { assert.equal(await refreshSiteInfo(), false); } finally { globalThis.fetch = original; }
  globalThis.fetch = async () => Response.json({ ok: false, data: null, error: "x" }, { status: 500 });
  try { assert.equal(await refreshSiteInfo(), false); } finally { globalThis.fetch = original; }
  assert.equal(siteInfo.siteName, "接口名", "失败的刷新保留现有名称");
  applySiteInfo({ siteName: "Baka Mail", tagline: "自建邮局的网页端", title: "Baka Mail - 自建邮局的网页邮箱", description: "描述" });
});

test("品牌名：登录、注册、重置、404、邮箱页头、邮箱侧栏和后台侧栏都读取站点名；固定版权行保持原样", () => {
  assert.match(source("components/BrandMark.vue"), /\{\{ title \?\? siteInfo\.siteName \}\}/);
  for (const file of ["views/LoginView.vue", "views/admin/AdminLoginView.vue"]) {
    assert.match(source(file), /<span class="login-product-name">\{\{ siteInfo\.siteName \}\}<\/span>/, file);
    assert.match(source(file), /了解 \{\{ siteInfo\.siteName \}\}/, file);
    assert.match(source(file), /© \{\{ year \}\} saubaka · BakaMail/, `${file} 的版权行固定`);
  }
  assert.match(source("components/ErrorPage.vue"), /<p class="ep-site">\{\{ siteInfo\.siteName \}\}<\/p>/);
  assert.match(source("components/ErrorPage.vue"), /© \{\{ year \}\} saubaka\. BakaMail\./);
  assert.match(source("components/MailPageHeader.vue"), /<span>\{\{ siteInfo\.siteName \}\}<small>/);
  assert.match(source("components/admin/AdminRail.vue"), /\{\{ siteInfo\.siteName \}\}<\/span>/);
  assert.match(source("components/MailWorkspace.vue"), /© \{\{ new Date\(\)\.getFullYear\(\) \}\} BakaMail<\/footer>/);
});

test("首页：品牌、标题文案、示例邮件、页脚品牌都用站点名；功能介绍和常见问题来自共用数据；没有写死的旧名称", () => {
  const intro = source("views/IntroView.vue");
  const body = intro.slice(0, intro.indexOf("<script setup"));
  const fixed = "© {{ year }} saubaka. BakaMail.";
  const withoutFixed = body.replace(fixed, "");
  assert.doesNotMatch(withoutFixed, /BakaMail/, "除固定版权行外没有写死的名称");
  assert.match(body, /v-for="\(feature, index\) in features"/);
  assert.match(body, /v-for="\(item, index\) in faq"/);
  assert.match(intro, /const features = INTRO_FEATURES;/);
  assert.match(intro, /const faq = INTRO_FAQ;/);
  assert.match(body, /\{\{ siteInitial \}\}/);
});
