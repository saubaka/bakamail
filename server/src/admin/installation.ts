import { constants, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, fstatSync, fchmodSync, linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";
import { db, nowIso } from "../db.ts";
import { adminPathProblem, LEGACY_ADMIN_BASE } from "../../../shared/adminPaths.ts";
import { hashPasswordAsync, passwordProblem } from "../security/passwords.ts";
import { recordAudit, type AuditInput } from "../security/audit.ts";

export type EntrySettings = { adminBase: string; revision: number };
type InstallationRow = EntrySettings & { initialized: number; retired: string };
export const setupKeyPath = join(config.dataDir, "setup.key");

db.exec(`create table if not exists installation (
  id integer primary key check(id=1), initialized integer not null check(initialized in (0,1)),
  admin_base text not null, revision integer not null check(revision>=0), retired text not null
)`);
db.prepare("insert or ignore into installation(id,initialized,admin_base,revision,retired) values(1,0,?,0,'[]')").run(LEGACY_ADMIN_BASE);

function readRow(): InstallationRow {
  const row = db.prepare("select initialized,admin_base as adminBase,revision,retired from installation where id=1").get() as InstallationRow;
  if (!row || adminPathProblem(row.adminBase) || !Number.isSafeInteger(row.revision)) throw new Error("Invalid installation settings");
  return row;
}

/** Upgrade existing databases once, including installs with disabled admins; never reopen setup. */
export function installationInitialized(): boolean {
  db.prepare(`update installation set initialized=1 where id=1 and initialized=0
    and exists(select 1 from admin_users)`).run();
  return readRow().initialized === 1;
}

export function entrySettings(): EntrySettings {
  const { adminBase, revision } = readRow();
  return { adminBase, revision };
}

/** Only an exact candidate matches. The root status response never discloses the saved entry. */
export function resolveAdminEntry(candidate: unknown): EntrySettings | null {
  if (!installationInitialized() || typeof candidate !== "string" || adminPathProblem(candidate)) return null;
  const saved = entrySettings();
  return candidate === saved.adminBase ? saved : null;
}

export function retiredInstallationPath(url: string): boolean {
  let path: string;
  try { path = decodeURIComponent(new URL(url, "http://route.invalid").pathname).replace(/\\/g, "/").toLowerCase(); }
  catch { return false; }
  const saved = readRow();
  const retired: unknown = JSON.parse(saved.retired);
  if (!Array.isArray(retired) || retired.some(base => typeof base !== "string" || adminPathProblem(base))) throw new Error("Invalid retired entry settings");
  return retired.some(base => base !== saved.adminBase && (path === base || path.startsWith(`${base}/`)));
}

function setupToken(): string {
  const fd = openSync(setupKeyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("Invalid setup key file");
    if (stat.mode & 0o077) fchmodSync(fd, 0o600);
    const token = readFileSync(fd, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid setup key");
    return token;
  } finally { closeSync(fd); }
}

/** Atomic, stable key shared by workers. No token or credential is printed into logs. */
export function prepareInstallation(log: (message: string) => void): void {
  if (installationInitialized()) return;
  const temporary = join(config.dataDir, `.setup-${process.pid}-${randomBytes(8).toString('hex')}.key`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, randomBytes(32).toString("base64url"));
    fsyncSync(fd);
    // link publishes a fully written file atomically, and never replaces another worker's key.
    try { linkSync(temporary, setupKeyPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally { closeSync(fd); unlinkSync(temporary); }
  setupToken();
  log(`首次初始化尚未完成，请在网页填写 ${setupKeyPath} 中的初始化密钥；完成后该密钥失效。`);
}

export class InstallationError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function initializeInstallation(body: Record<string, unknown>, audit: Omit<AuditInput, "action">): Promise<EntrySettings> {
  if (installationInitialized()) throw new InstallationError(409, "初始化已完成，不能重复创建管理员");
  const allowed = ["setupToken", "username", "password", "adminBase"];
  if (Object.keys(body).length !== allowed.length || Object.keys(body).some(key => !allowed.includes(key)) || allowed.some(key => typeof body[key] !== "string")) {
    throw new InstallationError(400, "初始化参数不完整或包含未知字段");
  }
  const token = body.setupToken as string;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (token.length > 100 || !timingSafeEqual(digest(token), digest(setupToken()))) throw new InstallationError(403, "初始化密钥无效");
  const username = (body.username as string).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,49}$/.test(username)) throw new InstallationError(400, "账号名需为 3–50 位小写字母、数字、下划线、点或短横线");
  const problem = passwordProblem(body.password as string) || adminPathProblem(body.adminBase);
  if (problem) throw new InstallationError(400, problem);
  const passwordHash = await hashPasswordAsync(body.password as string);
  // No await inside the transaction: simultaneous requests/processes can claim only once.
  db.exec("begin immediate");
  try {
    if (installationInitialized()) throw new InstallationError(409, "初始化已完成，不能重复创建管理员");
    db.prepare(`insert into admin_users(username,display_name,password_hash,role,is_active,created_at)
      values(?,'初始管理员',?,'superadmin',1,?)`).run(username, passwordHash, nowIso());
    const adminBase = body.adminBase as string;
    db.prepare("update installation set initialized=1,admin_base=?,revision=1,retired=? where id=1")
      .run(adminBase, JSON.stringify(adminBase === LEGACY_ADMIN_BASE ? [] : [LEGACY_ADMIN_BASE]));
    recordAudit({ ...audit, actorType: "system", action: "installation.complete", actor: username,
      targetType: "installation", summary: "网页初始化完成，首位超级管理员已创建" });
    db.exec("commit");
  } catch (error) { db.exec("rollback"); throw error; }
  // The permanent marker is authoritative, even if a crash/permission issue prevents key removal.
  try { unlinkSync(setupKeyPath); } catch { /* A consumed key never reopens setup. */ }
  return entrySettings();
}

export function updateEntrySettings(body: Record<string, unknown>, audit: Omit<AuditInput, "action">): EntrySettings {
  if (Object.keys(body).length !== 2 || Object.keys(body).some(key => !["adminBase", "revision"].includes(key))
    || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new InstallationError(400, "入口设置参数不合法");
  const problem = adminPathProblem(body.adminBase);
  if (problem) throw new InstallationError(400, problem);
  db.exec("begin immediate");
  try {
    if (!installationInitialized()) throw new InstallationError(409, "请先完成初始化");
    const current = readRow();
    if (body.revision !== current.revision) throw new InstallationError(409, "入口已由其他管理员修改，请重新读取后再保存");
    if (current.adminBase !== body.adminBase) {
      const retired = JSON.parse(current.retired) as string[];
      if (!retired.includes(current.adminBase)) retired.push(current.adminBase);
      if (retired.length > 512) throw new InstallationError(400, "历史入口数量达到安全上限，请联系部署者处理");
      db.prepare("update installation set admin_base=?,revision=revision+1,retired=? where id=1")
        .run(body.adminBase as string, JSON.stringify(retired));
      recordAudit({ ...audit, action: "admin.entry.update", targetType: "installation", summary: `管理员页面入口从 ${current.adminBase} 改为 ${body.adminBase}` });
    }
    db.exec("commit");
    return entrySettings();
  } catch (error) { db.exec("rollback"); throw error; }
}
