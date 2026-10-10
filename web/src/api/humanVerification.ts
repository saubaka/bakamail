import { api } from "./client.ts";

export type HumanPurpose = "login" | "register" | "password-reset";

export type HumanVerificationState = {
  enabled: boolean;
  siteKey: string;
  hasSecret: boolean;
  scopes: Record<HumanPurpose, boolean>;
  verified: boolean;
  verifiedAt: string;
  updatedAt: string;
  /** Entries that use Turnstile right now (enabled, verified and not switched off individually). */
  active: HumanPurpose[];
  testingKeys: boolean;
  panelAction: string;
  stats: { passed: number; rejected: number; unavailable: number; lastError: string; lastAt: string };
  autoDisabled?: boolean;
};

const base = "/api/admin/human-verification";

export const loadHumanVerification = (): Promise<HumanVerificationState> => api(base);

export const saveHumanVerification = (body: {
  siteKey?: string; secret?: string; enabled?: boolean; scopes?: Partial<Record<HumanPurpose, boolean>>;
}): Promise<HumanVerificationState> => api(base, { method: "PUT", body });

export const checkTurnstileSecret = (): Promise<{ valid: boolean; message: string }> =>
  api(`${base}/check-secret`, { method: "POST" });

export const verifyTurnstileToken = (token: string): Promise<HumanVerificationState> =>
  api(`${base}/verify`, { method: "POST", body: { token } });

export const clearHumanVerification = (): Promise<HumanVerificationState> => api(base, { method: "DELETE" });
