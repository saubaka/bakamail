import { verifyHumanCheck } from "./humanCheck.ts";
import { turnstileFor, verifyPublicTurnstile, type TurnstilePurpose } from "./turnstile.ts";

export type PublicHumanResult = "ok" | "rejected" | "unavailable";

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
