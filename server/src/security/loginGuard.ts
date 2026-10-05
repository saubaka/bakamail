import type { Response } from "express";
import { sendJson } from "../http/kit.ts";
import { isIdentityBlocked, loginLimitState, recordLoginAttempt } from "./rateLimit.ts";
import { verifyHumanCheck } from "./humanCheck.ts";
import { rejectBudget } from "./abuse.ts";

export function admitLogin(scope: "mail-login" | "admin-login", identity: string, account: string,
  budgetIdentity: string, nonce: string, answer: string, response: Response): boolean {
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
  const passed = verifyHumanCheck(scope, identity, nonce, answer, budgetIdentity);
  if (passed) return true;
  recordLoginAttempt(scope, identity, account, false, nonce ? "human" : "human-required");
  // Do not generate an expensive new image as part of a rejected POST.
  response.setHeader("retry-after", "0");
  sendJson(response, 429, { ok: false, code: "human_required", error: "请完成新的四位验证码后再试",
    data: { requireHuman: true, retryAfterSeconds: 0 } }); return false;
}

export function rejectLoginBusy(response: Response): void {
  rejectBudget(response, "login_busy", 5, "登录校验正在进行，请稍后重试");
}
