import { Router } from "express";
import { db } from "../db.ts";
import { fail, ok, readJson, requestId } from "../http/kit.ts";
import { requirePermission } from "../http/auth.ts";
import { enforceBudget } from "../security/abuse.ts";
import { recordAudit } from "../security/audit.ts";
import {
  SECRET_PATTERN, SITE_KEY_PATTERN, TURNSTILE_PURPOSES, clearTurnstile, explainErrors, isTestingSecret, isVerified,
  keyFingerprint, readTurnstile, sealTurnstileSecret, siteverify, turnstileSecret, turnstileStats, writeTurnstile,
  type TurnstilePurpose,
} from "../security/turnstile.ts";
import { fingerprint } from "../security/identity.ts";

/**
 * 邮箱用户入口的 Cloudflare Turnstile 管理。挂在后台路由的 requireAdmin + requireCsrf 之后，
 * 读写都需要 system.security.write。管理员登录不使用 Turnstile，所以这里配错也不会把管理员挡在外面。
 */
export const humanVerificationRouter = Router();
const guard = requirePermission("system.security.write");
const PANEL_ACTION = "admin-test";

function view() {
  const stored = readTurnstile();
  const secret = turnstileSecret(stored);
  const verified = isVerified(stored);
  return {
    enabled: stored.enabled,
    siteKey: stored.siteKey,
    hasSecret: Boolean(secret),
    scopes: stored.scopes,
    verified,
    verifiedAt: verified ? stored.verifiedAt : "",
    updatedAt: stored.updatedAt,
    // 此刻真正生效的入口（已启用、已验证、入口未被单独关闭）。
    active: stored.enabled && verified ? TURNSTILE_PURPOSES.filter((item) => stored.scopes[item]) : [],
    testingKeys: Boolean(secret) && isTestingSecret(secret),
    panelAction: PANEL_ACTION,
    stats: { ...turnstileStats },
  };
}

function budget(request: import("express").Request): void {
  enforceBudget("admin-turnstile", fingerprint("admin-turnstile", String(request.admin!.admin.id)));
}

humanVerificationRouter.get("/human-verification", guard, (_request, response) => { ok(response, view()); });

humanVerificationRouter.put("/human-verification", guard, async (request, response) => {
  const body = await readJson<Record<string, unknown>>(request, { maxBytes: 4096 });
  const allowed = new Set(["siteKey", "secret", "scopes", "enabled"]);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowed.has(key))) {
    fail(response, 400, "人机验证设置包含不支持的字段"); return;
  }
  const stored = readTurnstile();
  const next = { ...stored, scopes: { ...stored.scopes } };
  const changes: string[] = [];

  if ("siteKey" in body) {
    const value = String(body.siteKey ?? "").trim();
    if (!SITE_KEY_PATTERN.test(value)) { fail(response, 400, "站点密钥（Site Key）格式不对，请从 Cloudflare 完整复制"); return; }
    if (value !== stored.siteKey) { next.siteKey = value; changes.push("站点密钥"); }
  }
  if ("secret" in body && String(body.secret ?? "") !== "") {
    const value = String(body.secret).trim();
    if (!SECRET_PATTERN.test(value)) { fail(response, 400, "私有密钥（Secret Key）格式不对，请从 Cloudflare 完整复制"); return; }
    next.secretSealed = sealTurnstileSecret(value);
    changes.push("私有密钥");
  }
  if ("scopes" in body) {
    const scopes = body.scopes as Record<string, unknown> | null;
    if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)
      || Object.keys(scopes).some((key) => !(TURNSTILE_PURPOSES as readonly string[]).includes(key))
      || Object.values(scopes).some((value) => typeof value !== "boolean")) {
      fail(response, 400, "适用入口只能设置登录、注册和重置密码"); return;
    }
    for (const key of TURNSTILE_PURPOSES) {
      const value = (scopes as Partial<Record<TurnstilePurpose, boolean>>)[key];
      if (typeof value === "boolean" && value !== next.scopes[key]) { next.scopes[key] = value; changes.push(`入口 ${key}=${value}`); }
    }
  }
  if ("enabled" in body && typeof body.enabled !== "boolean") { fail(response, 400, "enabled 必须是布尔值"); return; }

  const secret = turnstileSecret(next);
  const keysChanged = next.siteKey !== stored.siteKey || next.secretSealed !== stored.secretSealed;
  const verified = Boolean(next.siteKey && secret && next.verifiedFingerprint === keyFingerprint(next.siteKey, secret));
  let autoDisabled = false;
  let enabled = "enabled" in body ? body.enabled === true : stored.enabled;
  if (enabled && !(next.siteKey && secret)) { fail(response, 409, "请先填写并保存站点密钥和私有密钥"); return; }
  if (enabled && !verified) {
    if ("enabled" in body && body.enabled === true) { fail(response, 409, "这组密钥还没有通过真实验证。请先保存密钥，在下方完成一次验证，再启用。"); return; }
    // 已启用期间换了密钥：旧的验证结果不再适用，先自动停用，避免用没验证过的密钥把用户挡在外面。
    enabled = false; autoDisabled = true;
  }
  if (enabled && !TURNSTILE_PURPOSES.some((key) => next.scopes[key])) { fail(response, 400, "至少需要保留一个适用入口"); return; }
  if (enabled !== stored.enabled) changes.push(enabled ? "启用" : "停用");
  next.enabled = enabled;
  if (keysChanged) { next.verifiedFingerprint = ""; next.verifiedAt = ""; }

  db.exec("begin immediate");
  try { writeTurnstile(next); db.exec("commit"); } catch (error) { db.exec("rollback"); throw error; }
  recordAudit({ actorType: "admin", actor: request.admin!.admin.username, action: "human-verification.update",
    summary: `${changes.join("、") || "无变化"}${autoDisabled ? "；因更换密钥自动停用" : ""}`, requestId: requestId(request) });
  ok(response, { ...view(), autoDisabled });
});

/** 用一个明显无效的结果令牌问 Cloudflare：返回“密钥无效”说明私有密钥不对，返回“结果无效”说明密钥被接受了。 */
humanVerificationRouter.post("/human-verification/check-secret", guard, async (request, response) => {
  budget(request);
  const secret = turnstileSecret();
  if (!secret) { fail(response, 409, "还没有保存私有密钥"); return; }
  const result = await siteverify(secret, "bakamail-secret-check", "", "");
  if (result.unavailable) { fail(response, 502, explainErrors(result.errors)); return; }
  const rejectedSecret = result.errors.some((code) => code === "invalid-input-secret" || code === "missing-input-secret");
  ok(response, { valid: !rejectedSecret, message: rejectedSecret ? explainErrors(result.errors) : "Cloudflare 接受了这个私有密钥。" });
});

/** 用面板里渲染出的真实组件结果令牌做一次完整校验；通过后才允许启用。 */
humanVerificationRouter.post("/human-verification/verify", guard, async (request, response) => {
  budget(request);
  const body = await readJson<{ token?: unknown }>(request, { maxBytes: 4096 });
  const stored = readTurnstile();
  const secret = turnstileSecret(stored);
  if (!stored.siteKey || !secret) { fail(response, 409, "请先保存站点密钥和私有密钥"); return; }
  const result = await siteverify(secret, typeof body.token === "string" ? body.token : "", "", PANEL_ACTION);
  if (result.unavailable) { fail(response, 502, explainErrors(result.errors)); return; }
  if (!result.ok) { fail(response, 400, explainErrors(result.errors)); return; }
  writeTurnstile({ ...stored, verifiedFingerprint: keyFingerprint(stored.siteKey, secret), verifiedAt: new Date().toISOString() });
  recordAudit({ actorType: "admin", actor: request.admin!.admin.username, action: "human-verification.verified",
    summary: "完成一次真实验证", requestId: requestId(request) });
  ok(response, view());
});

humanVerificationRouter.delete("/human-verification", guard, (request, response) => {
  clearTurnstile();
  recordAudit({ actorType: "admin", actor: request.admin!.admin.username, action: "human-verification.clear",
    summary: "清除 Turnstile 配置，邮箱入口恢复内建验证码", requestId: requestId(request) });
  ok(response, view());
});
