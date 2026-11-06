import { ApiError, api } from "../api/client.ts";

export async function probeLoginSession(scope: "mail" | "admin"): Promise<boolean> {
  try {
    await api(scope === "mail" ? "/api/auth/me" : "/api/admin/auth/me");
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}
