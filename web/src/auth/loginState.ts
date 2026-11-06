export const TURNSTILE_NONCE = "turnstile";

export function humanCheckReady(nonce: string, answer: string): boolean {
  const value = answer.trim();
  if (nonce === TURNSTILE_NONCE) return value.length >= 10 && value.length <= 2048;
  return Boolean(nonce) && value.length === 4;
}

export function loginSubmissionState(busy: boolean, seconds: number, humanVisible: boolean, nonce: string, answer: string): {
  disabled: boolean; challengeReady: boolean;
} {
  const challengeReady = humanVisible && humanCheckReady(nonce, answer);
  return { disabled: busy || (humanVisible && !challengeReady) || seconds > 0, challengeReady };
}
