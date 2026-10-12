import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bakamail-seo-env-test-"));
process.env.SECRET_KEY = "isolated-seo-env-secret";
process.env.HUMAN_CHECK_TEST_MODE = "1";
process.env.COOKIE_SECURE = "0";
process.env.MADDY_RUNNER = "disabled";
process.env.MAIL_DOMAIN = "example.test";
process.env.BOOTSTRAP_ADMIN = "seo-env-root";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "isolated-test-only-2026";
process.env.PUBLIC_ORIGIN = "https://mail.env-origin.example";

const { createApp } = await import("../src/app.ts");
const { default: request } = await import("./support/loopback-request.ts");
const { defaultSeoConfig } = await import("../../shared/seo.ts");
const { resolveOrigin } = await import("../src/admin/seo.ts");

const app = createApp({ log: () => undefined });

async function login() {
  const agent = request.agent(app);
  const challenge = await agent.get("/api/admin/human-check").set("x-real-ip", "203.0.113.201");
  const signed = await agent.post("/api/admin/auth/login").set("x-real-ip", "203.0.113.201")
    .send({ username: "seo-env-root", password: "isolated-test-only-2026", humanNonce: challenge.body.data.nonce, humanAnswer: "ABCD" });
  assert.equal(signed.status, 200);
  return { agent, csrf: signed.body.data.csrfToken as string };
}

test("没有在后台填写规范网址时，使用服务器环境里的 PUBLIC_ORIGIN：robots、站点地图、页面都带上它", async () => {
  const robots = (await request(app).get("/robots.txt")).text;
  assert.ok(robots.endsWith("Sitemap: https://mail.env-origin.example/sitemap.xml\n"), robots);
  const sitemap = await request(app).get("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.ok(sitemap.text.includes("<loc>https://mail.env-origin.example/</loc>"));
  const { agent } = await login();
  const view = (await agent.get("/api/admin/seo")).body.data;
  assert.deepEqual(view.origin, { value: "https://mail.env-origin.example", source: "env" });
  assert.equal(view.envOrigin, "https://mail.env-origin.example");
  assert.equal(view.report.checks.find((check: { id: string }) => check.id === "canonical").level, "pass");
});

test("后台填写的规范网址优先于环境值；清空后回到环境值；环境值不合法时被忽略", async () => {
  const { agent, csrf } = await login();
  const put = (body: object) => agent.put("/api/admin/seo").set("x-csrf-token", csrf).send(body);
  let view = (await agent.get("/api/admin/seo")).body.data;
  const set = await put({ ...view.config, canonicalOrigin: "https://www.override.example", revision: view.revision });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.data.origin, { value: "https://www.override.example", source: "setting" });
  assert.equal(set.body.data.envOrigin, "https://mail.env-origin.example", "接口总是返回环境值，前端清空后才知道会回到什么");
  assert.ok((await request(app).get("/robots.txt")).text.includes("https://www.override.example/sitemap.xml"));
  const cleared = await put({ ...set.body.data.config, canonicalOrigin: "", revision: set.body.data.revision });
  assert.deepEqual(cleared.body.data.origin, { value: "https://mail.env-origin.example", source: "env" });
  view = cleared.body.data;
  assert.deepEqual(resolveOrigin(defaultSeoConfig()), { value: "https://mail.env-origin.example", source: "env" });
});
