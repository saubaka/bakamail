/** Production router/components, simulated transports only. No real accounts or API fallback. */
import { isUiConfig } from '../../../shared/notificationMotion.ts';
import { copyUiConfigV2, defaultUiConfigV2, isUiConfigV2, applyLegacyMotionEdit, projectUiConfigV1 } from '../../../shared/notificationDisplay.ts';
import { adminPathProblem } from '../../../shared/adminPaths.ts';
const fixtureEntry = location.href;
// Router replaces the visible path. Keep Vite full reloads on the mock entry, not production /index.
import.meta.hot?.on('vite:beforeFullReload', () => { history.replaceState(null, '', fixtureEntry); });
const initial = new URL(location.href).searchParams;
let entrySettings = { adminBase: initial.get('entry') ?? '/bakaadmin', revision: 0 };
let authenticated = initial.get("admin") === "1";
let mailAuthenticated = initial.get("mail") === "1";
let failRestore = false;
let readOnly = initial.get("role") === "auditor";
let loginCalls = 0;
let rejectChallenge = false;
let challengeCalls = 0;
let mailLoginCalls = 0;
let appearance = defaultUiConfigV2();
let failAppearanceRead = false, failPublicConfig = initial.get('offline') === '1';
let corruptAppearance = false, loseSaveReply = false;
let appearanceWrites = 0, publicReads = 0;
const navigationDelay = initial.get('navigationDelay') === '1';
const timingEvents: { at: number; event: string; name: string; type?: string; revision?: string }[] = [];
for (const name of ['animationstart', 'animationend', 'transitionstart', 'transitionend']) document.addEventListener(name, event => {
  const target = event.target as HTMLElement;
  if (!target.closest('.notification-stack-card')) return;
  if (timingEvents.length >= 300) timingEvents.shift();
  timingEvents.push({ at: Math.round(performance.now()), event: event.type, name: (event as AnimationEvent).animationName ?? (event as TransitionEvent).propertyName,
    type: target.closest<HTMLElement>('.notification-capsule')?.dataset.motionType, revision: target.closest<HTMLElement>('.notification-capsule')?.dataset.configRevision });
});
let policy = { loginMaxFailures: 5, loginLockMinutes: 15, adminLoginMaxFailures: 3, adminLoginLockMinutes: 30,
  registerMaxPerHour: 3, registerMaxPerDay: 10, globalFailureAlert: 50, registrationMode: "invite" };
const csrf = "isolated-admin-entry-csrf";
const member = () => ({ username: "qa-admin", displayName: "隔离验收", role: readOnly ? "auditor" : "superadmin",
  permissions: readOnly ? ["system.audit.read"] : ["*"], csrfToken: csrf, runner: "disabled", statsAvailable: false });
const ok = (data: unknown) => Response.json({ ok: true, data, error: "" });
const fail = (status: number, error: string) => Response.json({ ok: false, data: null, error }, { status });

const controls = document.createElement("details");
controls.setAttribute("aria-label", "隔离验收控制");
controls.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2000;max-width:310px;padding:8px;border:1px solid #d8e8f7;border-radius:12px;background:white;font:12px system-ui;";
const summary = document.createElement('summary'); summary.textContent = '隔离验收工具'; summary.style.cursor = 'pointer'; controls.append(summary);
const state = document.createElement("span");
state.style.cssText = "width:100%;color:#354052";
function sync() { state.textContent = `隔离模拟 · 管理员${authenticated ? "已登录" : "未登录"} · 配置版本 ${appearance.revision} / 保存 ${appearanceWrites} / 公开读取 ${publicReads} · 登录 ${loginCalls} · 邮箱 ${mailLoginCalls} · 挑战 ${challengeCalls}`; }
function control(label: string, action: () => void) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label;
  button.style.cssText = "border:1px solid #d8e8f7;border-radius:8px;padding:5px;margin:3px;background:white;cursor:pointer";
  button.onclick = () => { action(); sync(); }; controls.append(button);
}
controls.append(state);
control("模拟会话过期", () => { authenticated = false; });
control("下次会话读取故障", () => { failRestore = true; });
control("切换只读角色", () => { readOnly = !readOnly; });
control("切换普通邮箱会话", () => { mailAuthenticated = !mailAuthenticated; });
control("下次验证码限流", () => { rejectChallenge = true; });
control('配置读取故障开关', () => { failAppearanceRead = !failAppearanceRead; });
control('配置无效版本开关', () => { corruptAppearance = !corruptAppearance; });
control('下次保存成功但回复丢失', () => { loseSaveReply = true; });
control('公开配置断网开关', () => { failPublicConfig = !failPublicConfig; });
control('公开配置重新校验', async () => { const { uiConfigClient } = await import('../../src/notificationConfig'); await uiConfigClient.refresh(true); });
control('另一个管理员修改配置', () => { appearance.revision++; appearance.notificationMotion.stackMs = 555; });
control('重新进入系统设置', async () => { const { router } = await import('../../src/router'); await router.push(`${entrySettings.adminBase}/overview`); await router.push(`${entrySettings.adminBase}/system`); });
control('另一个管理员修改后台入口', () => { entrySettings = { adminBase: '/other-console', revision: entrySettings.revision + 1 }; });
control('切换减少动画', async () => { const { applyMotionPreferences } = await import('../../src/motion'); applyMotionPreferences(document.documentElement.dataset.motion === 'reduce' ? 'system' : 'reduce', 'normal', false); });
control('输出动画诊断', () => { const output = document.getElementById('motion-fixture-output') ?? document.createElement('pre'); output.id = 'motion-fixture-output';
  output.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:60vw;max-height:150px;overflow:auto;z-index:2001;background:white;font-size:10px';
  output.textContent = JSON.stringify({ config: appearance, timingEvents }); document.body.append(output); });
control('关闭动画诊断', () => document.getElementById('motion-fixture-output')?.remove());
sync(); document.body.append(controls);

window.fetch = async (input, options) => {
  const raw = String(input);
  // Deliberately no native fetch fallback, even for an unexpected endpoint.
  if (!raw.startsWith("/api/")) throw new Error("隔离验收禁止非模拟网络请求");
  const url = new URL(raw, location.origin), path = url.pathname;
  if (path === '/api/installation') return ok({ initialized: true,
    ...(url.searchParams.get('entry') === entrySettings.adminBase ? { entry: { ...entrySettings } } : {}) });
  if (path === '/api/ui-config') {
    publicReads++; sync(); if (failPublicConfig) throw new Error('模拟公开配置断网');
    const version = url.searchParams.get('schemaVersion') === '2' ? 2 : 1;
    const data = version === 2 ? copyUiConfigV2(appearance) : projectUiConfigV1(appearance);
    const etag = `"fixture-ui-v${version}-${appearance.revision}"`;
    if (new Headers(options?.headers).get('if-none-match') === etag) return new Response(null, { status: 304 });
    return Response.json({ ok: true, data, error: '' }, { headers: { etag, 'cache-control': 'public, no-cache' } });
  }
  if (path === "/api/auth/human-check" || path === "/api/admin/human-check") {
    challengeCalls++; sync();
    if (rejectChallenge) {
      rejectChallenge = false;
      return Response.json({ ok: false, code: "challenge_rate_limited", error: "请求过于频繁", data: { retryAfterSeconds: 10 } }, { status: 429, headers: { "Retry-After": "10" } });
    }
    // A placeholder, not a solvable captcha or security bypass. Real challenge tests use the isolated BFF.
    return ok({ nonce: `fixture-display-${challengeCalls}`, image: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="176" height="56"><rect width="176" height="56" fill="#f7f9fc"/><text x="88" y="33" text-anchor="middle" fill="#354052" font-size="14">隔离挑战展示</text></svg>')}`,
      expiresIn: 600, domain: "example.test", formToken: "fixture-form-display", minFormSeconds: 2 });
  }
  if (path === "/api/auth/login" && options?.method === "POST") {
    mailLoginCalls++; sync();
    return Response.json({ ok: false, code: "login_cooldown", data: { retryAfterSeconds: 10 },
      error: "隔离冷却模拟：请等待冷却结束后再试，验证码不能提前解除冷却" }, { status: 429, headers: { "Retry-After": "10" } });
  }
  if (path === "/api/auth/me") return mailAuthenticated
    ? ok({ mailbox: "fixture@example.test", csrfToken: "isolated-mail-csrf", expiresAt: new Date(Date.now() + 3600000).toISOString() })
    : fail(401, "模拟普通邮箱未登录");
  if (path === "/api/admin/auth/login" && options?.method === "POST") {
    loginCalls++;
    const body = JSON.parse(String(options.body));
    if (body.username !== "qa-admin" || body.password !== "fixture-only") { sync(); return fail(401, "账号或密码错误"); }
    authenticated = true; sync(); return ok(member());
  }
  if (path === "/api/admin/auth/me") {
    if (navigationDelay) await new Promise(resolve => setTimeout(resolve, 350));
    if (failRestore) { failRestore = false; return fail(503, "模拟会话读取故障"); }
    return authenticated ? ok(member()) : fail(401, "模拟管理员未登录或过期");
  }
  if (!authenticated) return fail(401, "模拟管理员未登录或过期");
  if (path === '/api/admin/entry-settings') {
    if (readOnly) return fail(403, '模拟角色无入口设置权限');
    if (options?.method === 'PATCH') {
      if (new Headers(options.headers).get('x-csrf-token') !== csrf) return fail(403, '模拟 CSRF 拒绝');
      const body = JSON.parse(String(options.body));
      if (body.revision !== entrySettings.revision) return fail(409, '入口已被修改，请重新读取');
      const problem = adminPathProblem(body.adminBase);
      if (problem) return fail(400, problem);
      if (body.adminBase !== entrySettings.adminBase) entrySettings = { adminBase: body.adminBase, revision: entrySettings.revision + 1 };
    }
    return ok({ ...entrySettings });
  }
  if (path === '/api/admin/appearance') {
    if (readOnly) return fail(403, '模拟角色没有系统写权限');
    if (failAppearanceRead) return fail(503, '模拟通知配置读取失败，禁止覆盖');
    if (corruptAppearance) return ok({ ...appearance, schemaVersion: 99 });
    if (options?.method === 'PATCH') {
      if (new Headers(options.headers).get('x-csrf-token') !== csrf) return fail(403, '模拟CSRF拒绝');
      const input: unknown = JSON.parse(String(options.body));
      if (!isUiConfig(input) && !isUiConfigV2(input)) return fail(400, '模拟完整配置校验失败');
      if (input.revision !== appearance.revision) return Response.json({ ok: false, data: null, error: '配置版本冲突', code: 'appearance_conflict' }, { status: 409 });
      appearance = isUiConfigV2(input) ? copyUiConfigV2(input) : applyLegacyMotionEdit(appearance, input)!;
      appearance.revision++; appearanceWrites++; sync();
      if (loseSaveReply) { loseSaveReply = false; throw new Error('模拟保存回复丢失'); }
    }
    return ok(url.searchParams.get('schemaVersion') === '2' ? copyUiConfigV2(appearance) : projectUiConfigV1(appearance));
  }
  if (path === "/api/admin/auth/logout" && options?.method === "POST") {
    if (new Headers(options.headers).get("x-csrf-token") !== csrf) return fail(403, "模拟 CSRF 拒绝");
    authenticated = false; sync(); return ok({ loggedOut: true });
  }
  if (path === "/api/admin/overview") return ok({ accounts: 0, messages: 0, unseen: 0, queueLength: 0, recentFailures: 0, loginFailures15m: 0, failureAlertThreshold: 10, statsAvailable: false, maddyRunner: "disabled" });
  if (path === "/api/admin/accounts") return ok({ accounts: [], statsAvailable: false });
  if (path === "/api/admin/invites") return ok({ invites: [] });
  if (path === '/api/admin/admins') return ok({ admins: [{ id: 1, username: 'qa-admin', role: 'superadmin', is_active: 1, created_at: '2026-10-05T00:00:00Z' }] });
  if (path === "/api/admin/site-settings") return ok({ settings: { siteName: "隔离预览", announcement: "", registrationMode: "invite", welcomeMail: "off" }, domain: "example.test", mailHost: "不提供内部主机" });
  if (path === "/api/admin/runner-status") return ok({ runner: "disabled", ready: false, serviceVersion: "fixture", nodeVersion: "fixture" });
  if (path === "/api/admin/security") {
    if (options?.method === "PATCH") policy = { ...policy, ...JSON.parse(String(options.body)) };
    return ok(policy);
  }
  if (path === "/api/admin/login-logs" || path === "/api/admin/audit-logs") return ok({ logs: [] });
  if (path === "/api/admin/sessions") return ok({ sessions: [] });
  if (path === "/api/admin/blocked-identities") return ok({ identities: [] });
  throw new Error(`隔离验收没有模拟接口：${path}`);
};

const { router } = await import("../../src/router");
await router.replace(initial.get("page") ?? entrySettings.adminBase);
await import("../../src/main");
if (navigationDelay) {
  const { installNavigationContinuity } = await import('./navigation-continuity');
  installNavigationContinuity(router, 'admin');
}
