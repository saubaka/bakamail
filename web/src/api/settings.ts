import { api } from "./client.ts";

export type MailPreferences = {
  density: "comfortable" | "compact";
  pageSize: "25" | "50" | "100";
  timeFormat: "24h" | "12h";
  remoteImages: "ask" | "block" | "allow";
  signature: string;
};

export const DEFAULT_MAIL_PREFERENCES: Readonly<MailPreferences> = Object.freeze({
  density: "comfortable", pageSize: "50", timeFormat: "24h", remoteImages: "ask", signature: "",
});

/** Validate server values at the browser boundary; never adopt arbitrary settings or invalid enum values. */
export function normalizeMailPreferences(raw: Record<string, string>): MailPreferences {
  return {
    density: raw.density === "compact" ? "compact" : "comfortable",
    pageSize: raw.pageSize === "25" || raw.pageSize === "100" ? raw.pageSize : "50",
    timeFormat: raw.timeFormat === "12h" ? "12h" : "24h",
    remoteImages: raw.remoteImages === "block" || raw.remoteImages === "allow" ? raw.remoteImages : "ask",
    signature: typeof raw.signature === "string" ? raw.signature.slice(0, 2000) : "",
  };
}

export function readMailSettings(signal?: AbortSignal): Promise<{ settings: Record<string, string> }> {
  return api("/api/settings", { signal });
}
export function saveMailSettings(settings: Partial<MailPreferences>): Promise<{ saved: boolean }> {
  return api("/api/settings", { method: "PATCH", body: settings });
}
