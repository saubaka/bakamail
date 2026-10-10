import { verifyHumanCheck } from "./humanCheck.ts";
import { turnstileFor, verifyPublicTurnstile, type TurnstilePurpose } from "./turnstile.ts";

export type PublicHumanResult = "ok" | "rejected" | "unavailable";

/**
 * 邮箱用户公开入口的人机校验：管理员在面板里启用并验证过 Turnstile 时，
 * 提交的 humanAnswer 是 Turnstile 的结果令牌；否则仍然是内建的四位验证码。
 * 采用哪一种由服务端当前配置决定，浏览器声称什么都不算数。
 */
export async function checkPublicHuman(
  purpose: TurnstilePurpose,
  scope: string,
  identity: string,
  nonce: string,
  answer: string,
  budgetIdentity: string,
  remoteIp: string,
): Promise<PublicHumanResult> {
  if (turnstileFor(purpose)) {
    const result = await verifyPublicTurnstile(purpose, answer, remoteIp, budgetIdentity);
    return result.ok ? "ok" : result.unavailable ? "unavailable" : "rejected";
  }
  return verifyHumanCheck(scope, identity, nonce, answer, budgetIdentity) ? "ok" : "rejected";
}
