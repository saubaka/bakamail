import { ApiError, api } from "../api/client.ts";

/** Only a definitive 401 means logged out; network/server errors must reach the retry page. */
export async function probeLoginSession(scope: "mail" | "admin"): Promise<boolean> {
  try {
    await api(scope === "mail" ? "/api/auth/me" : "/api/admin/auth/me");
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}
