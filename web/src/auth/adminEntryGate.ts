import { ApiError } from "../api/client.ts";
import { SessionSupersededError } from "./sessionRequests.ts";
import { ADMIN_LOGIN_PATH, safeAdminDestination } from "../../../shared/adminPaths.ts";

export function adminLoginDestination(destination: unknown) {
  return { path: ADMIN_LOGIN_PATH, query: { redirect: safeAdminDestination(destination) } };
}

/** The callback must revalidate server state, not just return the cached identity. */
export async function checkAdminEntry(restore: () => Promise<unknown>, clear: () => void, destination: string) {
  try {
    await restore();
    return true as const;
  } catch (error) {
    if (error instanceof SessionSupersededError) return false as const;
    if (error instanceof ApiError && error.status === 401) {
      clear();
      return adminLoginDestination(destination);
    }
    return { name: "unavailable", query: { redirect: safeAdminDestination(destination) } };
  }
}
