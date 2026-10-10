/** Marker the server sends instead of a captcha nonce when Cloudflare Turnstile is in use. */
export const TURNSTILE_NONCE = "turnstile";

/** Challenge completion never overrides the server's hard cooldown. */
export function humanCheckReady(nonce: string, answer: string): boolean {
  const value = answer.trim();
  // Turnstile result tokens are long opaque strings; the built-in captcha is exactly four characters.
  if (nonce === TURNSTILE_NONCE) return value.length >= 10 && value.length <= 2048;
  return Boolean(nonce) && value.length === 4;
}

export function loginSubmissionState(busy: boolean, seconds: number, humanVisible: boolean, nonce: string, answer: string): {
  disabled: boolean; challengeReady: boolean;
} {
  const challengeReady = humanVisible && humanCheckReady(nonce, answer);
  return { disabled: busy || (humanVisible && !challengeReady) || seconds > 0, challengeReady };
}
