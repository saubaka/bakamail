import { ApiError } from "../api/client.ts";
import { SessionSupersededError } from "./sessionRequests.ts";

/** The server is authoritative: cached identity alone never grants entry. */
export async function checkMailEntry(restore: () => Promise<void>, clear: () => void,
  publicPage: boolean, destination: string): Promise<true | false | { name: string; query: Record<string, string> }> {
  try {
    await restore();
    return true;
  } catch (error) {
    if (error instanceof SessionSupersededError) return false;
    if (error instanceof ApiError && error.status === 401) {
      clear();
      return publicPage ? true : { name: "intro", query: { redirect: destination, reason: "session" } };
    }
    return { name: "unavailable", query: { redirect: destination } };
  }
}

export function safeMailDestination(value: unknown): string {
  const path = typeof value === "string" ? value : "";
  return /^\/mail(?:\/|\?|$)/.test(path) && !/[\\\r\n]/.test(path) ? path : "/mail";
}
