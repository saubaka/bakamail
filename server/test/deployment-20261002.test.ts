import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-proxy-release-"));
process.env.SECRET_KEY = "isolated-release-test-only";
process.env.HUMAN_CHECK_TEST_MODE = "0";
process.env.TRUSTED_PROXY_IPS = "172.18.0.1,::1";
process.env.PUBLIC_ORIGIN = "https://mail.example.test";
process.env.MADDY_RUNNER = "disabled";
const { clientAddress, isTrustedProxyPeer } = await import("../src/security/identity.ts");
const { createApp } = await import("../src/app.ts");
const { default: request } = await import("supertest");

test("Docker 代理只信任明确地址，不信任整段内网或伪造来源", () => {
  assert.equal(isTrustedProxyPeer("::ffff:172.18.0.1"), true);
  assert.equal(isTrustedProxyPeer("172.18.0.2"), false);
  assert.equal(isTrustedProxyPeer("192.168.1.1"), false);
  assert.equal(isTrustedProxyPeer(""), false);
  assert.equal(clientAddress({"x-real-ip": "203.0.113.20"}, "172.18.0.1"), "203.0.113.20");
  assert.equal(clientAddress({"x-real-ip": "203.0.113.20"}, "172.18.0.2"), "172.18.0.2");
});

test("生产 HTTPS Origin 可获取挑战，跨站请求仍拒绝", async () => {
  const app = createApp({bootstrapAdmin:false});
  const valid = await request(app).get("/api/admin/human-check").set("Origin", "https://mail.example.test");
  assert.equal(valid.status, 200);
  assert.ok(valid.body.data.image.startsWith("data:image/"));
  const invalid = await request(app).get("/api/admin/human-check").set("Origin", "https://other.example");
  assert.equal(invalid.status, 403);
  assert.equal(invalid.body.code, "origin_rejected");
});

test("部署包含共享运行模块并保留旧 hashed assets，不打包会话档案", () => {
  const root = new URL("../../", import.meta.url);
  assert.match(readFileSync(new URL("deploy/Dockerfile",root),"utf8"), /COPY shared \.\/shared/);
  assert.doesNotMatch(readFileSync(new URL(".dockerignore",root),"utf8"), /^web\/dist$/m);
  // The operator-specific release script is deliberately not part of public source.
  const releasePath = new URL("scripts/deploy-green.mjs",root);
  if (existsSync(releasePath)) {
    const release = readFileSync(releasePath,"utf8");
    assert.match(release, /docker cp bakamail:\/app\/web\/dist/);
    assert.match(release, /--exclude=\.\/docs\/handoff\/session-visible\.jsonl/);
  }
});

test("发布只允许保留锁定快照，所有 vendor 哈希仍须精确匹配", () => {
  const root = new URL("../../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("web/src/styles/vendor/manifest.json",root),"utf8"));
  for (const entry of manifest.files) {
    assert.equal(createHash("sha256").update(readFileSync(new URL(entry.target,root))).digest("hex"), entry.sha256);
  }
  const output = execFileSync(process.execPath,["scripts/verify-style-contract.mjs"],{
    cwd:fileURLToPath(root),env:{...process.env,BAKAMAIL_PINNED_VENDOR:"1"},encoding:"utf8",stdio:["ignore","pipe","pipe"],
  });
  assert.match(output,/OK: 已校验 3 份/);
});
