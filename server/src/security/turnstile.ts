import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { config } from "../config.ts";
import { db, getSetting, nowIso, setSetting } from "../db.ts";
import { enforceBudget } from "./abuse.ts";
import { openWith, sealWith } from "./secretBox.ts";

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

export function keyFingerprint(siteKey: string, secret: string): string {
  return createHmac("sha256", config.secretKey).update(`turnstile|${siteKey}|${secret}`).digest("hex");
}

export function isVerified(stored = readTurnstile()): boolean {
  const secret = turnstileSecret(stored);
  return Boolean(stored.siteKey && secret && stored.verifiedFingerprint === keyFingerprint(stored.siteKey, secret));
}

export function turnstileFor(purpose: TurnstilePurpose): { siteKey: string } | null {
  const stored = readTurnstile();
  if (!stored.enabled || !stored.scopes[purpose] || !isVerified(stored)) return null;
  return { siteKey: stored.siteKey };
}

export function turnstileConfigured(): boolean {
  return Boolean(readTurnstile().siteKey);
}

export function isTestingSecret(secret: string): boolean {
  return /^[123]x0{20,}AA$/.test(secret);
}

export const SITE_KEY_PATTERN = /^[0-9A-Za-z_-]{8,80}$/;
export const SECRET_PATTERN = /^[0-9A-Za-z_-]{8,160}$/;

export const turnstileStats = { passed: 0, rejected: 0, unavailable: 0, lastError: "", lastAt: "" };

const HOUR = 3_600_000;
export const TURNSTILE_STATS_RETENTION_DAYS = 35;
export const TURNSTILE_RANGES = { "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR } as const;
export type TurnstileRange = keyof typeof TURNSTILE_RANGES;
export type TurnstileOutcome = "passed" | "rejected" | "unavailable";

export function recordTurnstileOutcome(outcome: TurnstileOutcome, now = Date.now()): void {
  const hour = Math.floor(now / HOUR) * HOUR;
  const column = outcome;
  db.prepare(`insert into turnstile_stats (hour_ms, ${column}) values (?, 1)
    on conflict(hour_ms) do update set ${column} = ${column} + 1`).run(hour);
}

export type TurnstilePoint = { t: number; passed: number; rejected: number; unavailable: number };

export function turnstileSeries(range: TurnstileRange, now = Date.now()): { range: TurnstileRange; points: TurnstilePoint[]; totals: Omit<TurnstilePoint, "t"> } {
  const span = TURNSTILE_RANGES[range];
  const last = Math.floor(now / HOUR) * HOUR;
  const first = last - (span / HOUR - 1) * HOUR;
  const rows = db.prepare("select hour_ms, passed, rejected, unavailable from turnstile_stats where hour_ms >= ? and hour_ms <= ?").all(first, last) as
    { hour_ms: number; passed: number; rejected: number; unavailable: number }[];
  const byHour = new Map(rows.map((row) => [row.hour_ms, row]));
  const points: TurnstilePoint[] = [];
  const totals = { passed: 0, rejected: 0, unavailable: 0 };
  for (let t = first; t <= last; t += HOUR) {
    const row = byHour.get(t);
    const point = { t, passed: row?.passed ?? 0, rejected: row?.rejected ?? 0, unavailable: row?.unavailable ?? 0 };
    totals.passed += point.passed; totals.rejected += point.rejected; totals.unavailable += point.unavailable;
    points.push(point);
  }
  return { range, points, totals };
}

export function pruneTurnstileStats(now = Date.now()): number {
  const cutoff = now - TURNSTILE_STATS_RETENTION_DAYS * 24 * HOUR;
  return Number(db.prepare("delete from turnstile_stats where hour_ms < ?").run(cutoff).changes);
}

export type VerifyOutcome = {
  ok: boolean;
  unavailable: boolean;
  errors: string[];
};

type SiteverifyBody = { success?: boolean; "error-codes"?: string[]; action?: string; hostname?: string };

export async function siteverify(secret: string, token: string, remoteIp: string, expectedAction: string): Promise<VerifyOutcome & { raw?: SiteverifyBody }> {
  if (typeof token !== "string" || token.length < 1 || token.length > TOKEN_LIMIT) return { ok: false, unavailable: false, errors: ["missing-input-response"] };
  const form = new URLSearchParams({ secret, response: token });
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

export async function verifyPublicTurnstile(purpose: TurnstilePurpose, token: string, remoteIp: string, budgetIdentity: string): Promise<VerifyOutcome> {
  enforceBudget("human-verify", budgetIdentity);
  const stored = readTurnstile();
  const secret = turnstileSecret(stored);
  if (!secret) return { ok: false, unavailable: true, errors: ["not-configured"] };
  const result = await siteverify(secret, token, remoteIp, purpose);
  turnstileStats.lastAt = nowIso();
  if (result.ok) { turnstileStats.passed += 1; recordTurnstileOutcome("passed"); }
  else if (result.unavailable) { turnstileStats.unavailable += 1; turnstileStats.lastError = result.errors.join(",").slice(0, 80); recordTurnstileOutcome("unavailable"); }
  else { turnstileStats.rejected += 1; turnstileStats.lastError = result.errors.join(",").slice(0, 80); recordTurnstileOutcome("rejected"); }
  return result;
}

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
