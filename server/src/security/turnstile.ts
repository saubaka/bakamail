import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { config } from "../config.ts";
import { db, getSetting, nowIso, setSetting } from "../db.ts";
import { enforceBudget } from "./abuse.ts";
import { openWith, sealWith } from "./secretBox.ts";

/**
 * Cloudflare Turnstile 人机验证（只用于邮箱用户的公开入口，管理员登录永远使用内建验证码）。
 *
 * - 站点密钥（site key）是公开的；私有密钥（secret）加密后保存，永远不会返回给浏览器。
 * - 启用前必须用当前这组密钥完成一次真实验证（verifiedFingerprint 与当前密钥一致），
 *   配错的密钥因此不可能直接把用户挡在外面。
 * - Cloudflare 无法访问时关闭放行（返回 unavailable），由管理员在面板里停用即可恢复内建验证码。
 */
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_HOST = "https://challenges.cloudflare.com";
export const TURNSTILE_PURPOSES = ["login", "register", "password-reset"] as const;
export type TurnstilePurpose = (typeof TURNSTILE_PURPOSES)[number];
export const TURNSTILE_NONCE = "turnstile";
const SETTING_KEY = "turnstile";
const SECRET_CONTEXT = "bakamail-turnstile-v1";
const TOKEN_LIMIT = 2048;
const TIMEOUT_MS = 8000;

export type TurnstileStored = {
  enabled: boolean;
  siteKey: string;
  secretSealed: string;
  scopes: Record<TurnstilePurpose, boolean>;
  verifiedFingerprint: string;
  verifiedAt: string;
  updatedAt: string;
};

const EMPTY: TurnstileStored = {
  enabled: false, siteKey: "", secretSealed: "",
  scopes: { login: true, register: true, "password-reset": true },
  verifiedFingerprint: "", verifiedAt: "", updatedAt: "",
};

export function readTurnstile(): TurnstileStored {
  const raw = getSetting(SETTING_KEY, "");
  if (!raw) return { ...EMPTY, scopes: { ...EMPTY.scopes } };
  try {
    const value = JSON.parse(raw) as Partial<TurnstileStored>;
    return {
      enabled: value.enabled === true,
      siteKey: typeof value.siteKey === "string" ? value.siteKey : "",
      secretSealed: typeof value.secretSealed === "string" ? value.secretSealed : "",
      scopes: {
        login: value.scopes?.login !== false,
        register: value.scopes?.register !== false,
        "password-reset": value.scopes?.["password-reset"] !== false,
      },
      verifiedFingerprint: typeof value.verifiedFingerprint === "string" ? value.verifiedFingerprint : "",
      verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : "",
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
  } catch { return { ...EMPTY, scopes: { ...EMPTY.scopes } }; }
}

export function writeTurnstile(next: TurnstileStored): void {
  setSetting(SETTING_KEY, JSON.stringify({ ...next, updatedAt: nowIso() }));
}

export function clearTurnstile(): void {
  db.prepare("delete from app_settings where key = ?").run(SETTING_KEY);
}

export const sealTurnstileSecret = (secret: string): string => sealWith(SECRET_CONTEXT, secret);

export function turnstileSecret(stored = readTurnstile()): string {
  if (!stored.secretSealed) return "";
  try { return openWith(SECRET_CONTEXT, stored.secretSealed); } catch { return ""; }
}

/** 站点密钥加私有密钥的指纹：任何一个变动，之前的验证结果就不再有效。 */
export function keyFingerprint(siteKey: string, secret: string): string {
  return createHmac("sha256", config.secretKey).update(`turnstile|${siteKey}|${secret}`).digest("hex");
}

export function isVerified(stored = readTurnstile()): boolean {
  const secret = turnstileSecret(stored);
  return Boolean(stored.siteKey && secret && stored.verifiedFingerprint === keyFingerprint(stored.siteKey, secret));
}

/** 公开入口此刻是否真的使用 Turnstile：已启用、通过过真实验证、该入口没有被单独关闭。 */
export function turnstileFor(purpose: TurnstilePurpose): { siteKey: string } | null {
  const stored = readTurnstile();
  if (!stored.enabled || !stored.scopes[purpose] || !isVerified(stored)) return null;
  return { siteKey: stored.siteKey };
}

/** 页面内容安全策略只在保存过站点密钥时放行 challenges.cloudflare.com。 */
export function turnstileConfigured(): boolean {
  return Boolean(readTurnstile().siteKey);
}

/** Cloudflare 公布的测试密钥永远通过或永远失败；它们的响应没有 action。 */
export function isTestingSecret(secret: string): boolean {
  return /^[123]x0{20,}AA$/.test(secret);
}

export const SITE_KEY_PATTERN = /^[0-9A-Za-z_-]{8,80}$/;
export const SECRET_PATTERN = /^[0-9A-Za-z_-]{8,160}$/;

// ---- 运行统计（进程内，重启后清零；只用于面板展示，不参与任何判断） ----
export const turnstileStats = { passed: 0, rejected: 0, unavailable: 0, lastError: "", lastAt: "" };

export type VerifyOutcome = {
  ok: boolean;
  /** Cloudflare 没有给出结论（网络、超时、非预期响应），不是用户的问题。 */
  unavailable: boolean;
  errors: string[];
};

type SiteverifyBody = { success?: boolean; "error-codes"?: string[]; action?: string; hostname?: string };

/** 把 token 交给 Cloudflare 校验。expectedAction 为空表示不检查 action（面板里的密钥检查）。 */
export async function siteverify(secret: string, token: string, remoteIp: string, expectedAction: string): Promise<VerifyOutcome & { raw?: SiteverifyBody }> {
  if (typeof token !== "string" || token.length < 1 || token.length > TOKEN_LIMIT) return { ok: false, unavailable: false, errors: ["missing-input-response"] };
  const form = new URLSearchParams({ secret, response: token });
  // IPv6 来源在限流里已折叠成 /64 前缀，不是合法地址；remoteip 可选，不合法就不传。
  if (remoteIp && isIP(remoteIp)) form.set("remoteip", remoteIp);
  let body: SiteverifyBody;
  try {
    const reply = await globalThis.fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!reply.ok && reply.status >= 500) throw new Error(`HTTP ${reply.status}`);
    body = (await reply.json()) as SiteverifyBody;
  } catch (error) {
    return { ok: false, unavailable: true, errors: [error instanceof Error ? error.name : "network-error"] };
  }
  const errors = Array.isArray(body["error-codes"]) ? body["error-codes"].filter((item) => typeof item === "string").slice(0, 6) : [];
  if (body.success !== true) return { ok: false, unavailable: false, errors, raw: body };
  if (expectedAction && !isTestingSecret(secret) && body.action !== expectedAction) {
    return { ok: false, unavailable: false, errors: ["action-mismatch"], raw: body };
  }
  return { ok: true, unavailable: false, errors: [], raw: body };
}

/** 公开入口使用：先占用来源额度，再校验，并更新进程内统计。 */
export async function verifyPublicTurnstile(purpose: TurnstilePurpose, token: string, remoteIp: string, budgetIdentity: string): Promise<VerifyOutcome> {
  enforceBudget("human-verify", budgetIdentity);
  const stored = readTurnstile();
  const secret = turnstileSecret(stored);
  if (!secret) return { ok: false, unavailable: true, errors: ["not-configured"] };
  const result = await siteverify(secret, token, remoteIp, purpose);
  turnstileStats.lastAt = nowIso();
  if (result.ok) turnstileStats.passed += 1;
  else if (result.unavailable) { turnstileStats.unavailable += 1; turnstileStats.lastError = result.errors.join(",").slice(0, 80); }
  else { turnstileStats.rejected += 1; turnstileStats.lastError = result.errors.join(",").slice(0, 80); }
  return result;
}

/** 面板里的可读解释；未知代码原样返回，便于排查。 */
export function explainErrors(errors: string[]): string {
  const known: Record<string, string> = {
    "invalid-input-secret": "私有密钥无效，请回 Cloudflare 复制完整的 Secret Key。",
    "missing-input-secret": "还没有保存私有密钥。",
    "invalid-input-response": "验证结果无效或已使用过，请重新完成一次验证。",
    "missing-input-response": "没有收到验证结果。",
    "timeout-or-duplicate": "验证结果已过期或已被使用，请重新验证。",
    "action-mismatch": "验证结果不属于这个入口，请刷新页面重试。",
    "bad-request": "发给 Cloudflare 的请求格式不对。",
    "internal-error": "Cloudflare 暂时出错，请稍后重试。",
    "TimeoutError": "连接 Cloudflare 超时，请检查服务器能否访问 challenges.cloudflare.com。",
    "AbortError": "连接 Cloudflare 超时，请检查服务器能否访问 challenges.cloudflare.com。",
  };
  return errors.map((item) => known[item] ?? item).join("；") || "未知原因";
}
