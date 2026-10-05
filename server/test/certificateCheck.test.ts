import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type PeerCertificate } from "node:tls";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { assessCertificate, certificateCheck } from "../src/admin/certificateCheck.ts";

const now = Date.now();
const certificate = (remainingDays = 30, hostname = "mail.test"): PeerCertificate => ({
  subject: { CN: hostname }, subjectaltname: `DNS:${hostname}`,
  valid_from: new Date(now - 86_400_000).toUTCString(),
  valid_to: new Date(now + remainingDays * 86_400_000).toUTCString(),
} as PeerCertificate);

test("证书只有可信、主机名匹配且有效时才能显示正常", () => {
  assert.equal(assessCertificate("mail.test", certificate(), true, now).status, "ok");
  const untrusted = assessCertificate("mail.test", certificate(), false, now);
  assert.equal(untrusted.status, "fail");
  assert.match(untrusted.detail, /信任链/);
  const mismatch = assessCertificate("other.test", certificate(), true, now);
  assert.equal(mismatch.status, "fail");
  assert.match(mismatch.detail, /不适用于/);
  assert.equal(assessCertificate("mail.test", certificate(-1), true, now).status, "fail");
  assert.equal(assessCertificate("mail.test", { ...certificate(), valid_from: new Date(now + 86400000).toUTCString() }, true, now).status, "fail");
  assert.equal(assessCertificate("mail.test", { ...certificate(), valid_to: "unknown" }, true, now).status, "unknown");
});

test("即将到期和不足一天的有效证书是警告，不误报为过期", () => {
  assert.equal(assessCertificate("mail.test", certificate(10), true, now).status, "warn");
  const hours = assessCertificate("mail.test", certificate(0.5), true, now);
  assert.equal(hours.status, "warn");
  assert.match(hours.detail, /不足 1 天/);
});

test("真实 TLS 握手区分不可信证书、受信任测试 CA 与主机名不符", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bakamail-tls-test-"));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
      "-subj", "/CN=mail.test", "-addext", "subjectAltName=DNS:mail.test", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")], { stdio: "pipe" });
    const cert = readFileSync(join(directory, "cert.pem"), "utf8");
    server = createServer({ key: readFileSync(join(directory, "key.pem")), cert }, (socket) => { socket.on("error", () => undefined); });
    server.on("tlsClientError", () => undefined);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const untrusted = await certificateCheck("mail.test", "127.0.0.1", address.port);
    assert.equal(untrusted.status, "fail");
    assert.match(untrusted.detail, /信任链/);
    assert.equal((await certificateCheck("mail.test", "127.0.0.1", address.port, cert)).status, "ok");
    const mismatch = await certificateCheck("other.test", "127.0.0.1", address.port, cert);
    assert.equal(mismatch.status, "fail");
    assert.match(mismatch.detail, /不适用于/);
  } finally {
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("证书握手提前关闭不会悬挂或误报正常", async () => {
  const server = createTcpServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await certificateCheck("mail.test", "127.0.0.1", address.port);
    assert.equal(result.status, "unknown");
    assert.match(result.detail, /连接/);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
