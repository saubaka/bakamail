/** Challenge completion never overrides the server's hard cooldown. */
export function humanCheckReady(nonce: string, answer: string): boolean {
  return Boolean(nonce) && answer.trim().length === 4;
}

export function loginSubmissionState(busy: boolean, seconds: number, humanVisible: boolean, nonce: string, answer: string): {
  disabled: boolean; challengeReady: boolean;
} {
  const challengeReady = humanVisible && humanCheckReady(nonce, answer);
  return { disabled: busy || (humanVisible && !challengeReady) || seconds > 0, challengeReady };
}
