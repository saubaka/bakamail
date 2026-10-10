import { api } from "./client.ts";

export type AdminRole = "superadmin" | "admin" | "auditor";

export type AdminRow = {
  id: number;
  username: string;
  role: AdminRole;
  is_active: number;
  last_login_at: string | null;
  totp_enabled: number;
};

function adminPath(id: number): string {
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError("管理员 ID 不正确");
  return `/api/admin/admins/${id}`;
}

export function listAdminUsers(): Promise<{ admins: AdminRow[]; currentRole: AdminRole }> {
  return api("/api/admin/admins");
}

export function createAdminUser(input: { username: string; password: string; role: AdminRole }): Promise<{ id: number }> {
  return api("/api/admin/admins", { method: "POST", body: input });
}

export function changeAdminRole(id: number, role: AdminRole): Promise<void> {
  return api(adminPath(id), { method: "PATCH", body: { role } });
}

export function setAdminUserActive(id: number, active: boolean): Promise<void> {
  return api(adminPath(id), { method: "PATCH", body: { active } });
}

/** 设备丢失时由超级管理员代为重置别人的二步验证；对方会话同时失效。 */
export function resetAdminUserTotp(id: number): Promise<void> {
  return api(adminPath(id), { method: "PATCH", body: { resetTotp: true } });
}

export function resetAdminUserPassword(id: number, password: string): Promise<void> {
  return api(adminPath(id), { method: "PATCH", body: { password } });
}
