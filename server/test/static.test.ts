import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-static-"));
process.env.SECRET_KEY = "test-secret-key-for-static-tests";

const { looksLikeAssetPath, createApp } = await import("../src/app.ts");
const { default: request } = await import("supertest");
const { projectRoot } = await import("../src/config.ts");

test("静态资源路径识别：带扩展名的走资源分支", () => {
  for (const path of [
    "/assets/index-DI519D65.js",
    "/assets/index-NOYP50pm.css",
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/assets/MailView-CLF1nDru.css",
  ]) {
    assert.equal(looksLikeAssetPath(path), true, `${path} 应判定为静态资源`);
  }
});

test("静态资源路径识别：前端路由不当作资源", () => {
  for (const path of ["/", "/login", "/mail", "/register", "/bakaadmin", "/bakaadmin/overview"]) {
    assert.equal(looksLikeAssetPath(path), false, `${path} 应判定为前端路由`);
  }
});

test("旧后台地址在静态资源与 SPA 回退之前返回无指引的 404", async () => {
  const app = createApp({ bootstrapAdmin: false, log: () => undefined });
  for (const path of ["/admin", "/admin/", "/admin/login", "/admin/overview", "/ADMIN/accounts", "/%61dmin/login", "/admin/old.js"]) {
    const response = await request(app).get(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers["location"], undefined);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.text, "Not Found");
    assert.doesNotMatch(response.text, /bakaadmin|index\.html|<script/i);
  }
  assert.equal((await request(app).get("/api/admin/auth/me")).status, 401);
  // A source-only checkout need not have run the frontend build yet.
  if (existsSync(join(projectRoot, "web", "dist", "index.html"))) {
    const entry = await request(app).get("/bakaadmin");
    assert.equal(entry.status, 200);
    assert.match(entry.text, /<div id="app"><\/div>/);
  }
});

test("页面响应带完整内容安全策略，nonce 每次不同且与内联脚本一致", async () => {
  if (!existsSync(join(projectRoot, "web", "dist", "index.html"))) return; // A source-only checkout need not have built the frontend.
  const app = createApp({ bootstrapAdmin: false, log: () => undefined });
  const first = await request(app).get("/login");
  const second = await request(app).get("/login");
  for (const response of [first, second]) {
    const policy = String(response.headers["content-security-policy"]);
    const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
    assert.ok(nonce && nonce.length >= 20, "policy must carry a nonce");
    // 内联脚本使用同一个 nonce；带 src 的模块脚本不带 nonce，由 'self' 放行。
    assert.match(response.text, new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, "\\$&")}">`));
    assert.doesNotMatch(response.text, /<script>/);
    for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "connect-src 'self'"]) {
      assert.ok(policy.split("; ").includes(directive), directive);
    }
    assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*unsafe-inline/);
    assert.equal(response.headers["cache-control"], "no-cache, must-revalidate");
  }
  const a = /nonce-([^']+)'/.exec(String(first.headers["content-security-policy"]))?.[1];
  const b = /nonce-([^']+)'/.exec(String(second.headers["content-security-policy"]))?.[1];
  assert.notEqual(a, b);
  // 接口响应不受页面策略影响，仍保持仅同源连接。
  assert.equal((await request(app).get("/api/health")).headers["content-security-policy"], "connect-src 'self'");
});
