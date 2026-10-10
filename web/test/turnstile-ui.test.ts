import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TURNSTILE_NONCE, humanCheckReady, loginSubmissionState } from "../src/auth/loginState.ts";
import { turnstileErrorText, TURNSTILE_ORIGIN, TURNSTILE_SCRIPT } from "../src/auth/turnstileLoader.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("人机验证就绪判断：内建验证码必须正好四位，Turnstile 需要长令牌，空 nonce 永不就绪", () => {
  assert.equal(humanCheckReady("abc", "AB12"), true);
  assert.equal(humanCheckReady("abc", "AB1"), false);
  assert.equal(humanCheckReady("", "AB12"), false);
  assert.equal(humanCheckReady(TURNSTILE_NONCE, ""), false);
  assert.equal(humanCheckReady(TURNSTILE_NONCE, "AB12"), false, "a four character answer is not a Turnstile token");
  assert.equal(humanCheckReady(TURNSTILE_NONCE, "x".repeat(2049)), false);
  assert.equal(humanCheckReady(TURNSTILE_NONCE, "0.abcdefghijklmnop-token"), true);
  assert.equal(humanCheckReady("", "0.abcdefghijklmnop-token"), false);
  assert.equal(loginSubmissionState(false, 0, true, TURNSTILE_NONCE, "").disabled, true);
  assert.equal(loginSubmissionState(false, 0, true, TURNSTILE_NONCE, "0.abcdefghijklmnop-token").disabled, false);
  assert.equal(loginSubmissionState(false, 9, true, TURNSTILE_NONCE, "0.abcdefghijklmnop-token").disabled, true, "cooldown still wins");
});

test("Turnstile 脚本只从 challenges.cloudflare.com 加载，且只在组件需要时才请求", () => {
  assert.equal(TURNSTILE_ORIGIN, "https://challenges.cloudflare.com");
  assert.equal(TURNSTILE_SCRIPT, "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
  // 页面入口和公共模块不预先加载，加载只发生在 loadTurnstile() 里。
  assert.doesNotMatch(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /cloudflare/i);
  assert.doesNotMatch(source("main.ts"), /turnstile/i);
  const loader = source("auth/turnstileLoader.ts");
  assert.match(loader, /securitypolicyviolation/);
  assert.match(loader, /pending = null/, "a failed load must not be cached");
  assert.equal([...loader.matchAll(/https:\/\/[a-z.]+/g)].every(([host]) => host === TURNSTILE_ORIGIN), true);
});

test("错误代码给出可读解释，未知代码原样保留便于排查", () => {
  assert.match(turnstileErrorText("110200"), /域名/);
  assert.match(turnstileErrorText("110100"), /站点密钥/);
  assert.match(turnstileErrorText("600010"), /600010/);
  assert.match(turnstileErrorText("999999"), /999999/);
  assert.match(turnstileErrorText(), /重试/);
});

test("验证码组件：由服务端响应决定采用 Turnstile，后台登录永远忽略它；令牌一次一换", () => {
  const human = source("components/HumanCheck.vue");
  assert.match(human, /!props\.admin && data\.provider === "turnstile"/);
  assert.match(human, /<TurnstileWidget[\s\S]*v-model:token="answer"[\s\S]*:action="purpose"/);
  assert.match(human, /widgetRef\.value\?\.reset\(\)/);
  const admin = source("views/admin/AdminLoginView.vue");
  assert.doesNotMatch(admin, /Turnstile/i);
  assert.match(admin, /<HumanCheck[^>]*\badmin\b/);
  // 令牌失效后的重置路径：提交失败调用 invalidate()/refresh() 都会让组件换新令牌。
  assert.match(human, /defineExpose\(\{ refresh, load, invalidate \}\)/);
});

test("组件在 CSP 拦截时提示刷新页面，并清理组件与计时，不使用 eval 或外部样式", () => {
  const widget = source("components/TurnstileWidget.vue");
  assert.match(widget, /CSP_BLOCKED/);
  assert.match(widget, /刷新页面/);
  assert.match(widget, /onBeforeUnmount\(\(\) => \{ active = false; remove\(\); \}\)/);
  assert.match(widget, /prefers-reduced-motion: reduce/);
  assert.match(widget, /html\[data-motion="reduce"\]/);
  assert.doesNotMatch(widget, /eval\(|new Function|innerHTML/);
  assert.match(widget, /theme: "light"/);
  assert.match(widget, /language: "zh-cn"/);
});

test("后台人机验证面板：路由需要安全写权限，入口在安全分组，密钥输入不从接口回填", () => {
  const routes = source("auth/adminRoutes.ts");
  assert.match(routes, /path: "human-check", name: "admin-human-check", meta: \{ permission: "system\.security\.write" \}/);
  const model = source("admin/navModel.ts");
  assert.match(model, /name: "admin-human-check", label: "人机验证"[^}]*permission: "system\.security\.write"[^}]*section: "security"/);
  const view = source("views/admin/HumanVerificationView.vue");
  // 后台登录一行固定显示内建验证码，且不提供开关。
  assert.match(view, /<li class="is-fixed">\s*<span>后台登录<\/span>\s*<span class="hv-routes__state">内建验证码<\/span>\s*<span class="hv-routes__fixed">固定<\/span>/);
  // 私有密钥框只用本地输入；adopt() 在每次读取或保存后清空它，永远不用接口数据回填。
  assert.match(view, /function adopt\([\s\S]*secret\.value = "";/);
  assert.doesNotMatch(view, /secret\.value = (next|state)/);
  assert.match(view, /confirmDialog\(\{\s*title: "启用 Turnstile"/);
  assert.match(view, /title: "清除人机验证配置"[\s\S]*tone: "danger"/);
  assert.match(view, /v-model:token="previewToken"[\s\S]*:action="state\.panelAction"/);
  // 未通过真实验证前，总开关不可用。
  assert.match(view, /:disabled="busy \|\| \(!state\.verified && !state\.enabled\)"|:disabled="working \|\| \(!state\.verified && !state\.enabled\)"/);
  assert.doesNotMatch(view, /localStorage|sessionStorage/);
});

test("管理接口客户端只访问同源 /api/admin/human-verification", () => {
  const client = source("api/humanVerification.ts");
  assert.equal([...client.matchAll(/"(\/api\/[^"`]*)"|`(\/api\/[^`]*)`|\$\{base\}/g)].length > 0, true);
  assert.match(client, /const base = "\/api\/admin\/human-verification"/);
  assert.doesNotMatch(client, /https?:\/\//);
});

test("人机验证面板与组件是纯色扁平样式：没有渐变，复选框用 !important 真正隐藏，不再重复套卡片", () => {
  for (const file of ["views/admin/HumanVerificationView.vue", "components/TurnstileWidget.vue"]) {
    assert.doesNotMatch(source(file), /gradient/i, file);
  }
  const view = source("views/admin/HumanVerificationView.vue");
  assert.match(view, /\.hv-switch > input \{ position: absolute !important;/);
  // 面板不再使用步骤条、提示卡和每行一张卡片的写法。
  assert.doesNotMatch(view, /hv-steps|hv-lock|hv-note/);
  const widget = source("components/TurnstileWidget.vue");
  assert.match(widget, /\.ts-box__skeleton \{[^}]*animation: ts-pulse/);
  assert.doesNotMatch(widget, /background-position|ts-shimmer/);
});
