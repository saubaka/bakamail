import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(here, "..", "..");
export const appVersion: string = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = readDotEnv(join(projectRoot, ".env"));

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fileEnv[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const value = Number.parseInt(env(key, ""), 10);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = env(key, "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

const dataDirRaw = env("DATA_DIR", "./data");
if (envBool("HUMAN_CHECK_TEST_MODE", false) && process.env.NODE_ENV !== "test") {
  throw new Error("HUMAN_CHECK_TEST_MODE requires NODE_ENV=test");
}
const dataDir = isAbsolute(dataDirRaw) ? dataDirRaw : join(projectRoot, dataDirRaw);
mkdirSync(dataDir, { recursive: true });

/** 密钥必须跨重启稳定，否则会话与限流指纹全部失效。 */
function resolveSecretKey(): string {
  const fromEnv = env("SECRET_KEY", "");
  if (fromEnv && fromEnv !== "change-me-to-a-long-random-string") return fromEnv;
  const keyFile = join(dataDir, "secret.key");
  if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim();
  const generated = randomBytes(48).toString("base64url");
  writeFileSync(keyFile, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  host: env("HOST", "127.0.0.1"),
  port: envInt("PORT", 8790),
  dataDir,

  secretKey: resolveSecretKey(),

  /**
   * 生产环境走 HTTPS，Cookie 必须带 Secure；本地开发用 http://127.0.0.1
   * 时浏览器（和测试客户端）不会回传 Secure Cookie，所以允许关掉。
   */
  cookieSecure: envBool("COOKIE_SECURE", true),
  /** Only loopback reverse proxies may supply client-address headers; disable for direct access. */
  trustLoopbackProxy: envBool("TRUST_LOOPBACK_PROXY", true),
  /** Exact, operator-verified proxy peers; never trust an entire private subnet. */
  trustedProxyIps: env("TRUSTED_PROXY_IPS", "").split(",").map(value => value.trim()).filter(Boolean),
  publicOrigin: env("PUBLIC_ORIGIN", ""),

  mail: {
    host: env("MAIL_HOST", "127.0.0.1"),
    /** 邮局自己的主机名，maddy 配置里的 $(hostname) 用它 */
    hostname: env("MAIL_HOSTNAME", `mail.${env("MAIL_DOMAIN", "example.test")}`),
    imapPort: envInt("MAIL_IMAP_PORT", 993),
    smtpPort: envInt("MAIL_SMTP_PORT", 465),
    smtpAltPort: envInt("MAIL_SMTP_ALT_PORT", 587),
    domain: env("MAIL_DOMAIN", "example.test"),
    tlsRejectUnauthorized: envBool("MAIL_TLS_REJECT_UNAUTHORIZED", true),
    /** maddy 单封上限 32 MiB，实测 SIZE 33554432 */
    maxMessageBytes: 33_554_432,
  },

  maddy: {
    runner: env("MADDY_RUNNER", "disabled") as "local" | "docker-exec" | "disabled",
    bin: env("MADDY_BIN", "/usr/local/bin/maddy"),
    dataDir: env("MADDY_DATA_DIR", "/data"),
    container: env("MADDY_CONTAINER", "maddy"),
    logSnapshotPath: env("MAIL_LOG_SNAPSHOT_PATH", ""),
  },

  session: {
    mailDays: envInt("MAIL_SESSION_DAYS", 7),
    adminIdleMinutes: envInt("ADMIN_SESSION_IDLE_MINUTES", 30),
  },

  security: {
    loginMaxFailures: envInt("LOGIN_MAX_FAILURES", 5),
    loginLockMinutes: envInt("LOGIN_LOCK_MINUTES", 15),
    adminLoginMaxFailures: envInt("ADMIN_LOGIN_MAX_FAILURES", 3),
    adminLoginLockMinutes: envInt("ADMIN_LOGIN_LOCK_MINUTES", 30),
    registerMaxPerHour: envInt("REGISTER_MAX_PER_HOUR", 3),
    registerMaxPerDay: envInt("REGISTER_MAX_PER_DAY", 10),
    globalFailureAlert: envInt("GLOBAL_FAILURE_ALERT", 50),
    humanCheckTtlSeconds: Math.min(600, Math.max(60, envInt("HUMAN_CHECK_TTL_SECONDS", 600))),
    minFormSeconds: Math.min(60, Math.max(1, envInt("MIN_FORM_SECONDS", 2))),
    /**
     * 只给自动化测试用：开启后任意 4 位答案都通过，但仍然强制
     * nonce 匹配、TTL 有效、一次性消费。生产环境绝不能打开。
     */
    humanCheckTestMode: envBool("HUMAN_CHECK_TEST_MODE", false),
  },

  bootstrap: {
    admin: env("BOOTSTRAP_ADMIN", "admin"),
    password: env("BOOTSTRAP_ADMIN_PASSWORD", ""),
  },
} as const;

export type Config = typeof config;
