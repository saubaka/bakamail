import { config } from "./config.ts";
import { db } from "./db.ts";
import { purgeExpiredChallenges } from "./security/humanCheck.ts";
import { createApp } from "./app.ts";

const app = createApp();

const cleanup = setInterval(() => {
  purgeExpiredChallenges();
  const now = new Date().toISOString();
  db.prepare("update mail_sessions set revoked_at = ? where expires_at < ? and revoked_at is null")
    .run(now, now);
  db.prepare("update admin_sessions set revoked_at = ? where expires_at < ? and revoked_at is null")
    .run(now, now);
}, 10 * 60_000);
cleanup.unref();

const server = app.listen(config.port, config.host, () => {
  console.log(`[bakamail] 监听 http://${config.host}:${config.port}`);
  console.log(`[bakamail] 邮局目标 ${config.mail.host}:${config.mail.imapPort}（发信走 ${config.mail.smtpPort}）`);
  console.log(`[bakamail] 账号管理方式 MADDY_RUNNER=${config.maddy.runner}`);
});

function shutdown(signal: string): void {
  console.log(`[bakamail] 收到 ${signal}，正在停止`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
