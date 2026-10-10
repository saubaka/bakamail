import { config } from "../config.ts";
import { db, nowIso } from "../db.ts";
import { hashPassword, passwordProblem, verifyPasswordAsync } from "../security/passwords.ts";

export type AdminRole = "superadmin" | "admin" | "auditor";

export type AdminUser = {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: AdminRole;
  is_active: number;
  created_at: string;
  last_login_at: string | null;
};

const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  superadmin: ["*"],
  admin: [
    "mail.account.read",
    "mail.account.write",
    "mail.invite.read",
    "mail.invite.write",
    "mail.queue.read",
    "mail.queue.retry",
    "mail.domain.check",
    "system.audit.read",
  ],
  auditor: [
    "mail.account.read",
    "mail.invite.read",
    "mail.queue.read",
    "mail.domain.check",
    "system.audit.read",
  ],
};

// 未知账号也执行同等成本的密码校验，避免从响应时间猜测管理员账号是否存在。
const DUMMY_ADMIN_HASH = hashPassword("bakamail-nonexistent-admin-placeholder");

export function normalizeRole(value: string): AdminRole {
  if (value === "superadmin" || value === "auditor" || value === "admin") return value;
  return "auditor";
}

export function hasPermission(role: AdminRole, code: string): boolean {
  const grants = ROLE_PERMISSIONS[role] ?? [];
  return grants.includes("*") || grants.includes(code);
}

export function permissionList(role: AdminRole): string[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function listAdmins(): (Omit<AdminUser, "password_hash"> & { totp_enabled: number })[] {
  return db
    .prepare(
      `select id, username, display_name, role, is_active, created_at, last_login_at,
              coalesce((select enabled from admin_totp where admin_id = admin_users.id), 0) as totp_enabled
       from admin_users order by id`,
    )
    .all() as (Omit<AdminUser, "password_hash"> & { totp_enabled: number })[];
}

export function findAdminByUsername(username: string): AdminUser | undefined {
  return db
    .prepare("select * from admin_users where username = ? limit 1")
    .get(username.trim().toLowerCase()) as AdminUser | undefined;
}

export function findAdminById(id: number): AdminUser | undefined {
  return db.prepare("select * from admin_users where id = ? limit 1").get(id) as
    | AdminUser
    | undefined;
}

export function countAdmins(role?: AdminRole): number {
  const row = role
    ? (db
        .prepare("select count(*) as n from admin_users where role = ? and is_active = 1")
        .get(role) as { n: number })
    : (db.prepare("select count(*) as n from admin_users").get() as { n: number });
  return row?.n ?? 0;
}

export type CreateAdminResult = { ok: true; id: number } | { ok: false; error: string };

export function createAdmin(
  username: string,
  password: string,
  role: AdminRole,
  displayName = "",
): CreateAdminResult {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,49}$/.test(normalized)) {
    return { ok: false, error: "账号名需为 3-50 位小写字母、数字、下划线、点或短横线" };
  }
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  if (findAdminByUsername(normalized)) return { ok: false, error: "该管理员账号已存在" };
  const result = db
    .prepare(
      `insert into admin_users (username, display_name, password_hash, role, is_active, created_at)
       values (?, ?, ?, ?, 1, ?)`,
    )
    .run(normalized, displayName.slice(0, 80), hashPassword(password), role, nowIso());
  return { ok: true, id: Number(result.lastInsertRowid) };
}

export function setAdminPassword(id: number, password: string): string {
  const problem = passwordProblem(password);
  if (problem) return problem;
  db.prepare("update admin_users set password_hash = ? where id = ?").run(
    hashPassword(password),
    id,
  );
  return "";
}

export function setAdminActive(id: number, active: boolean): void {
  db.prepare("update admin_users set is_active = ? where id = ?").run(active ? 1 : 0, id);
}

export function setAdminRole(id: number, role: AdminRole): void {
  db.prepare("update admin_users set role = ? where id = ?").run(role, id);
}

export function markAdminLogin(id: number): void {
  db.prepare("update admin_users set last_login_at = ? where id = ?").run(nowIso(), id);
}

export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<{ ok: true; admin: AdminUser } | { ok: false; reason: string }> {
  const admin = findAdminByUsername(username);
  const passwordMatches = await verifyPasswordAsync(admin?.password_hash ?? DUMMY_ADMIN_HASH, password);
  // Re-read activity/hash after awaiting: admin revocation/password changes win over an in-flight login.
  const current = admin ? findAdminById(admin.id) : undefined;
  if (!current || !current.is_active || current.password_hash !== admin?.password_hash || !passwordMatches) return { ok: false, reason: "账号或密码错误" };
  return { ok: true, admin: current };
}

/**
 * 只在库里一个管理员都没有时创建引导账号。
 * 仅供显式设置引导密码的隔离测试；正式新安装使用网页初始化。
 */
export function ensureBootstrapAdmin(log: (message: string) => void): void {
  if (countAdmins() > 0) return;
  if (process.env.NODE_ENV !== "test" || !config.bootstrap.password) return;
  const username = config.bootstrap.admin || "admin";
  const password = config.bootstrap.password;
  const created = createAdmin(username, password, "superadmin", "初始管理员");
  if (!created.ok) {
    log(`引导管理员创建失败：${created.error}`);
    return;
  }
  log(`已创建测试引导管理员 ${username}`);
}
