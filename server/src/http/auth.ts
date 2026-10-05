import type { NextFunction, Request, Response } from "express";
import {
  ADMIN_COOKIE,
  MAIL_COOKIE,
  findAdminSession,
  findMailSession,
  type AdminSessionRow,
} from "./session.ts";
import { fail, parseCookies } from "./kit.ts";
import { getSession } from "../mail/registry.ts";
import type { MailboxSession } from "../mail/session.ts";
import { findAdminById, hasPermission, type AdminRole, type AdminUser } from "../admin/accounts.ts";

export type MailContext = {
  sessionRow: ReturnType<typeof findMailSession> & object;
  session: MailboxSession;
};

export type AdminContext = {
  sessionRow: AdminSessionRow;
  admin: AdminUser;
  role: AdminRole;
};

declare module "express-serve-static-core" {
  interface Request {
    mail?: MailContext;
    admin?: AdminContext;
  }
}

export function requireMail(request: Request, response: Response, next: NextFunction): void {
  const cookies = parseCookies(request);
  const row = findMailSession(cookies[MAIL_COOKIE] ?? "");
  if (!row) {
    fail(response, 401, "登录已失效，请重新登录");
    return;
  }
  const session = getSession(row.id);
  if (!session) {
    // 进程重启后内存里的 IMAP 连接与密码都没了，必须重新登录
    fail(response, 401, "服务已重启，请重新登录");
    return;
  }
  request.mail = { sessionRow: row, session };
  next();
}

export function requireCsrf(request: Request, response: Response, next: NextFunction): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  const context = request.mail ?? request.admin;
  const expected = context?.sessionRow.csrf_token ?? "";
  const provided = request.header("x-csrf-token") ?? "";
  if (!expected || provided !== expected) {
    fail(response, 403, "CSRF 校验失败，请刷新页面重试");
    return;
  }
  next();
}

export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  const cookies = parseCookies(request);
  const row = findAdminSession(cookies[ADMIN_COOKIE] ?? "");
  if (!row) {
    fail(response, 401, "后台登录已失效，请重新登录");
    return;
  }
  const admin = findAdminById(row.admin_id);
  if (!admin || !admin.is_active) {
    fail(response, 401, "管理员账号不可用");
    return;
  }
  request.admin = { sessionRow: row, admin, role: admin.role };
  next();
}

export function requirePermission(code: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const context = request.admin;
    if (!context) {
      fail(response, 401, "需要后台登录");
      return;
    }
    if (!hasPermission(context.role, code)) {
      fail(response, 403, "当前角色没有该权限");
      return;
    }
    next();
  };
}
