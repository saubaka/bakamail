import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-installation-test-"));
process.env.NODE_ENV = "test";
process.env.SECRET_KEY = "isolated-installation-secret-for-tests";
process.env.COOKIE_SECURE = "0";
process.env.PUBLIC_ORIGIN = "https://mail.example.test";
process.env.MADDY_RUNNER = "disabled";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "";
const { createApp } = await import("../src/app.ts");
const { db } = await import("../src/db.ts");
const { default: request } = await import("supertest");
const installation = await import("../src/admin/installation.ts");
const { createAdmin, findAdminByUsername } = await import("../src/admin/accounts.ts");
const { createAdminSession, ADMIN_COOKIE } = await import("../src/http/session.ts");
const { verifyPasswordAsync } = await import("../src/security/passwords.ts");
const logs: string[] = [];
const app = createApp({ log: line => logs.push(line) });
const token = readFileSync(installation.setupKeyPath, "utf8");
const origin = process.env.PUBLIC_ORIGIN;
const body = { setupToken: token, username: "first-admin", password: "Isolated-Only-12345", adminBase: "/private-console" };
test.afterEach(() => db.exec("delete from security_budgets; delete from security_leases"));

test("新安装不自动生成管理员或日志明文密码，仅建立受限且稳定的初始化密钥", () => {
  assert.equal(db.prepare("select count(*) as n from admin_users").get()!.n, 0);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(statSync(installation.setupKeyPath).mode & 0o777, 0o600);
  createApp({ log: () => undefined });
  assert.equal(readFileSync(installation.setupKeyPath, "utf8"), token);
  assert.ok(logs.some(line => line.includes("setup.key")));
  assert.ok(logs.every(line => !line.includes(token) && !line.includes(body.password)));
});

test("公开初始化状态没有入口、凭据、协议配置或初始化密钥", async () => {
  const result = await request(app).get("/api/installation?entry=%2Fprivate-console");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { initialized: false });
  assert.equal(result.headers["cache-control"], "no-store");
});

test("同源边界在密钥校验和 JSON 读取之前拒绝跨站初始化", async () => {
  for (const headers of [{ Origin: "https://evil.test" }, { Origin: origin, "Sec-Fetch-Site": "cross-site" }, { Origin: "null" }]) {
    assert.equal((await request(app).post("/api/installation").set(headers).send(body)).status, 403);
  }
  assert.equal(installation.installationInitialized(), false);
});

test("未知参数、类型混淆、缺失参数、无效密钥、弱密码和保留路径均不能创建管理员", async () => {
  const invalid: [Record<string, unknown>, number][] = [
    [{ ...body, surprise: true }, 400], [{ ...body, username: [] }, 400], [{ ...body, password: undefined }, 400],
    [{ ...body, setupToken: "wrong" }, 403], [{ ...body, password: "lettersOnly" }, 400],
    [{ ...body, username: "!!" }, 400], [{ ...body, adminBase: "/mail" }, 400],
    [{ ...body, adminBase: "/api" }, 400], [{ ...body, adminBase: "//evil.test" }, 400],
    [{ ...body, adminBase: "/%61dmin" }, 400], [{ ...body, adminBase: "/ABC" }, 400],
  ];
  for (const [input, status] of invalid) {
    db.exec("delete from security_budgets");
    assert.equal((await request(app).post("/api/installation").set("Origin", origin).send(input)).status, status);
    assert.equal(installation.installationInitialized(), false);
  }
});

test("初始化请求体严格有界，来源请求预算及重试时间在直接 HTTP 调用时生效", async () => {
  assert.equal((await request(app).post("/api/installation").set("Origin", origin).send({ ...body, setupToken: "x".repeat(5000) })).status, 413);
  db.exec("delete from security_budgets");
  for (let i = 0; i < 5; i++) assert.equal((await request(app).post("/api/installation").set("Origin", origin).send({ ...body, setupToken: "invalid" })).status, 403);
  const limited = await request(app).post("/api/installation").set("Origin", origin).send(body);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  assert.equal(installation.installationInitialized(), false);
});

test("并发初始化仅创建一位超级管理员，密码异步哈希，提交与审计原子完成", async () => {
  const responses = await Promise.all([
    request(app).post("/api/installation").set("Origin", origin).send(body),
    request(app).post("/api/installation").set("Origin", origin).send(body),
  ]);
  assert.equal(responses.filter(result => result.status === 200).length, 1);
  assert.ok(responses.some(result => result.status === 429 || result.status === 409));
  assert.equal(db.prepare("select count(*) as n from admin_users").get()!.n, 1);
  const admin = findAdminByUsername(body.username)!;
  assert.equal(admin.role, "superadmin");
  assert.equal(await verifyPasswordAsync(admin.password_hash, body.password), true);
  assert.notEqual(admin.password_hash, body.password);
  assert.deepEqual(installation.entrySettings(), { adminBase: body.adminBase, revision: 1 });
  assert.equal(existsSync(installation.setupKeyPath), false);
  assert.equal(db.prepare("select count(*) as n from audit_logs where action='installation.complete'").get()!.n, 1);
});

test("完成后不能重放初始化或生成新密钥，普通状态响应不公开自定义入口", async () => {
  assert.equal((await request(app).post("/api/installation").set("Origin", origin).send(body)).status, 409);
  assert.deepEqual((await request(app).get("/api/installation")).body.data, { initialized: true });
  assert.deepEqual((await request(app).get(`/api/installation?entry=${encodeURIComponent(body.adminBase)}`)).body.data,
    { initialized: true, entry: { adminBase: body.adminBase, revision: 1 } });
  assert.deepEqual((await request(app).get("/api/installation?entry=%2Fwrong-entry")).body.data, { initialized: true });
  createApp({ log: line => logs.push(line) });
  assert.equal(existsSync(installation.setupKeyPath), false);
});

function auth(username: string, role: "superadmin" | "admin" | "auditor" = "superadmin") {
  let user = findAdminByUsername(username);
  if (!user) { const result = createAdmin(username, "Isolated-Test-56789", role); assert.equal(result.ok, true); user = findAdminByUsername(username)!; }
  const session = createAdminSession(user.id, "test-source", "installation-tests");
  return { cookie: `${ADMIN_COOKIE}=${session.token}`, csrf: session.csrfToken };
}

test("后台路径读写要求管理员、超级管理员权限、CSRF 和同源，邮箱身份不能替代", async () => {
  assert.equal((await request(app).get("/api/admin/entry-settings")).status, 401);
  assert.equal((await request(app).patch("/api/admin/entry-settings").send({ adminBase: "/new-console", revision: 1 })).status, 401);
  for (const role of ["admin", "auditor"] as const) {
    const session = auth(`role-${role}`, role);
    assert.equal((await request(app).get("/api/admin/entry-settings").set("Cookie", session.cookie)).status, 403);
    assert.equal((await request(app).patch("/api/admin/entry-settings").set("Cookie", session.cookie).set("X-CSRF-Token", session.csrf).send({ adminBase: "/new-console", revision: 1 })).status, 403);
  }
  const session = auth(body.username);
  assert.equal((await request(app).patch("/api/admin/entry-settings").set("Cookie", session.cookie).send({ adminBase: "/new-console", revision: 1 })).status, 403);
  assert.equal((await request(app).patch("/api/admin/entry-settings").set("Cookie", session.cookie).set("X-CSRF-Token", session.csrf).set("Origin", "https://evil.test").send({ adminBase: "/new-console", revision: 1 })).status, 403);
  assert.deepEqual((await request(app).get("/api/admin/entry-settings").set("Cookie", session.cookie)).body.data, installation.entrySettings());
});

test("入口校验不允许未知键、非法 revision、嵌套路径、编码、保留项或外站 URL", async () => {
  const session = auth(body.username);
  for (const input of [
    { adminBase: "/new-console", revision: 1, extra: 1 }, { adminBase: "/new-console", revision: "1" },
    { adminBase: "/new-console", revision: -1 }, { adminBase: "/admin", revision: 1 },
    { adminBase: "/new/console", revision: 1 }, { adminBase: "https://evil.test", revision: 1 },
    { adminBase: "/new-console/", revision: 1 }, { adminBase: "/n%65w", revision: 1 },
  ]) assert.equal((await request(app).patch("/api/admin/entry-settings").set("Cookie", session.cookie).set("X-CSRF-Token", session.csrf).send(input)).status, 400);
  assert.equal(installation.entrySettings().revision, 1);
});

test("保存自定义路径停用旧路径及编码/大小写变体，接口与原会话不改，旧 revision 拒绝覆盖", async () => {
  const session = auth(body.username);
  const response = await request(app).patch("/api/admin/entry-settings").set("Origin", origin).set("Cookie", session.cookie).set("X-CSRF-Token", session.csrf).send({ adminBase: "/new-console", revision: 1 });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { adminBase: "/new-console", revision: 2 });
  assert.equal((await request(app).patch("/api/admin/entry-settings").set("Cookie", session.cookie).set("X-CSRF-Token", session.csrf).send({ adminBase: "/stale-console", revision: 1 })).status, 409);
  for (const path of ["/private-console", "/private-console/system", "/PRIVATE-CONSOLE/system", "/%70rivate-console/overview", "/bakaadmin"]) {
    const retired = await request(app).get(path);
    assert.equal(retired.status, 404, path);
    assert.equal(retired.text, "Not Found");
    assert.equal(retired.headers["location"], undefined);
  }
  assert.equal((await request(app).get("/api/admin/auth/me").set("Cookie", session.cookie)).status, 200);
  assert.equal(installation.resolveAdminEntry("/private-console"), null);
  assert.deepEqual(installation.resolveAdminEntry("/new-console"), { adminBase: "/new-console", revision: 2 });
  const audit = db.prepare("select summary from audit_logs where action='admin.entry.update'").all();
  assert.equal(audit.length, 1);
  assert.ok(audit.every(row => !String(row.summary).includes(body.password) && !String(row.summary).includes(token)));
});

test("入口保存跨独立进程重启保留，重复同路径不变 revision，历史路径可恢复且旧地址继续停用", async () => {
  const code = `const m=await import('./server/src/admin/installation.ts'); console.log(JSON.stringify({ initialized:m.installationInitialized(), entry:m.entrySettings() }));`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: new URL("../../", import.meta.url), env: process.env, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { initialized: true, entry: { adminBase: "/new-console", revision: 2 } });
  assert.deepEqual(installation.updateEntrySettings({ adminBase: "/new-console", revision: 2 }, {}), { adminBase: "/new-console", revision: 2 });
  installation.updateEntrySettings({ adminBase: "/private-console", revision: 2 }, {});
  assert.equal(installation.retiredInstallationPath("/private-console/system"), false);
  assert.equal(installation.retiredInstallationPath("/new-console/system"), true);
});

test("即使管理员全部被删除，永久初始化标记也不会重新开放建号", async () => {
  db.exec("delete from admin_sessions; delete from admin_users");
  assert.equal(installation.installationInitialized(), true);
  createApp({ log: () => undefined });
  assert.equal(existsSync(installation.setupKeyPath), false);
  assert.equal((await request(app).post("/api/installation").set("Origin", origin).send(body)).status, 409);
});

test("旧安装含禁用管理员时自动关闭初始化，保留原入口与密码/权限/现有数据", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakamail-upgrade-test-"));
  const code = `
    const {db}=await import('./server/src/db.ts');
    db.prepare("insert into admin_users(username,display_name,password_hash,role,is_active,created_at) values('legacy','Original','unmodified','auditor',0,'before')").run();
    const {createApp}=await import('./server/src/app.ts'); createApp({log:()=>{}});
    const m=await import('./server/src/admin/installation.ts');
    console.log(JSON.stringify({initialized:m.installationInitialized(),entry:m.entrySettings(),admin:db.prepare('select username,password_hash,role,is_active from admin_users').get()}));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: new URL("../../", import.meta.url), env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { initialized: true, entry: { adminBase: "/bakaadmin", revision: 0 },
    admin: { username: "legacy", password_hash: "unmodified", role: "auditor", is_active: 0 } });
  assert.equal(existsSync(join(dir, "setup.key")), false);
});
