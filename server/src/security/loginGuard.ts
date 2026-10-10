import type { Response } from "express";
import { sendJson } from "../http/kit.ts";
import { isIdentityBlocked, loginLimitState, recordLoginAttempt } from "./rateLimit.ts";
import { verifyHumanCheck } from "./humanCheck.ts";
import { checkPublicHuman } from "./publicHuman.ts";
import { rejectBudget } from "./abuse.ts";

/** 管理员登录（admin-login）永远使用内建验证码；只有邮箱登录会在启用后改用 Turnstile。 */
export async function admitLogin(scope: "mail-login" | "admin-login", identity: string, account: string,
  budgetIdentity: string, nonce: string, answer: string, response: Response, remoteIp = ""): Promise<boolean> {
  if (isIdentityBlocked(identity)) {
    sendJson(response, 403, { ok: false, code: "source_blocked", data: null, error: "该来源已被禁止登录，请联系管理员" }); return false;
  }
  const state = loginLimitState(scope, identity, account);
  if (state.limited) {
    response.setHeader("retry-after", String(state.retryAfterSeconds));
    sendJson(response, 429, { ok: false, code: "login_cooldown", error: "失败次数过多，请等待冷却结束后再试；验证码不能提前解除冷却",
      data: { requireHuman: state.requireHuman, retryAfterSeconds: state.retryAfterSeconds } }); return false;
  }
  if (!state.requireHuman) return true;
  let passed: boolean;
  if (scope === "admin-login") passed = verifyHumanCheck(scope, identity, nonce, answer, budgetIdentity);
  else {
    const result = await checkPublicHuman("login", scope, identity, nonce, answer, budgetIdentity, remoteIp);
    if (result === "unavailable") {
      // 人机验证服务不可用不是用户的错，不计入登录失败。
      sendJson(response, 503, { ok: false, code: "human_unavailable", error: "人机验证服务暂时不可用，请稍后再试", data: { requireHuman: true, retryAfterSeconds: 0 } });
      return false;
    }
    passed = result === "ok";
  }
  if (passed) return true;
  recordLoginAttempt(scope, identity, account, false, nonce ? "human" : "human-required");
  // Do not generate an expensive new image as part of a rejected POST.
  response.setHeader("retry-after", "0");
  sendJson(response, 429, { ok: false, code: "human_required", error: "请完成新的人机验证后再试",
    data: { requireHuman: true, retryAfterSeconds: 0 } }); return false;
}

export function rejectLoginBusy(response: Response): void {
  rejectBudget(response, "login_busy", 5, "登录校验正在进行，请稍后重试");
}
