import { Router, type Request, type Response } from "express";
import { accountFailure, type AccountOperation } from "../mail/accountFailure.ts";
import { appVersion, config } from "../config.ts";
import { db, getIntSetting, getSetting, nowIso, setSetting } from "../db.ts";
import {
  appendCookie,
  clearCookie,
  fail,
  ok,
  readJson,
  requestId,
  sendJson,
  sessionCookie,
  parseCookies,
} from "../http/kit.ts";
import {
  ADMIN_COOKIE,
  createAdminSession,
  findAdminSession,
  listAdminSessions,
  revokeAdminSession,
  revokeAdminSessionsFor,
} from "../http/session.ts";
import { requireAdmin, requireCsrf, requirePermission } from "../http/auth.ts";
import { issueHumanCheck } from "../security/humanCheck.ts";
import { clientAddress, fingerprint } from "../security/identity.ts";
import {
  blockIdentity,
  globalFailureCount,
  globalAttemptCount,
  listBlockedIdentities,
  listLoginLogs,
  loginRiskBackoff,
  completeLoginAttempt,
  reserveLoginAttempt,
  failureLimit,
  limitWindowMs,
  unblockIdentity,
} from "../security/rateLimit.ts";
import { listAuditLogs, recordAudit } from "../security/audit.ts";
import {
  countAdmins,
  createAdmin,
  findAdminById,
  hasPermission,
  listAdmins,
  markAdminLogin,
  permissionList,
  setAdminActive,
  setAdminPassword,
  setAdminRole,
  normalizeRole,
  verifyAdminCredentials,
} from "../admin/accounts.ts";
import { checkInvite, createInvite, listInvites, revokeInvite } from "../admin/invites.ts";
import { mailboxStats, queueEntries, statsAvailable } from "../admin/mailstats.ts";
import { hasLocalMailboxData, localMailboxOwners, purgeLocalMailboxData } from "../admin/accountCleanup.ts";
import { domainCheck } from "../admin/domainCheck.ts";
import { parseLogLimit, readMailLogSnapshot, readDockerMailLogs } from "../admin/mailLogs.ts";
import {
  changeMailboxPassword,
  createMailbox,
  listAccounts,
  listCredentials,
  maddyRunnerReady,
  removeMailbox,
  repairMailbox,
  runMaddy,
} from "../mail/accounts.ts";
import { dropSessionsForMailbox } from "../mail/registry.ts";
import { revokeMailSessionsFor } from "../http/session.ts";
import { isValidLocalAccount, normalizeMailboxAccount } from "../mail/session.ts";
import { passwordProblem } from "../security/passwords.ts";
import { registrationLimits } from "../security/registration.ts";
import { admitLogin, rejectLoginBusy } from "../security/loginGuard.ts";
import { anonymousRequestBudget } from "../security/abuse.ts";
import { appearanceRouter } from "./appearance.ts";

export const adminRouter = Router();

const ADMIN_LOGIN_PURPOSE = "admin-login";

adminRouter.get("/human-check", (request, response) => {
  const address = clientAddress(
    request.headers as Record<string, unknown>,
    request.socket.remoteAddress,
  );
  const identity = fingerprint(ADMIN_LOGIN_PURPOSE, address);
  const challenge = issueHumanCheck(ADMIN_LOGIN_PURPOSE, identity, fingerprint("auth-source", address));
  ok(response, {
    nonce: challenge.nonce,
    image: challenge.imageData,
    expiresIn: challenge.expiresIn,
  });
});

adminRouter.post("/auth/login", anonymousRequestBudget("login"), async (request, response) => {
  const body = await readJson<{
    username?: string;
    password?: string;
    humanNonce?: string;
    humanAnswer?: string;
  }>(request);
  const address = clientAddress(
    request.headers as Record<string, unknown>,
    request.socket.remoteAddress,
  );
  const identity = fingerprint(ADMIN_LOGIN_PURPOSE, address);
  const username = String(body.username ?? "").trim().toLowerCase().slice(0, 200);
  if (!admitLogin(ADMIN_LOGIN_PURPOSE, identity, username, fingerprint("auth-source", address),
    String(body.humanNonce ?? ""), String(body.humanAnswer ?? ""), response)) return;
  const password = String(body.password ?? "");
  if (!username || !password || password.length > 200) { fail(response, 400, "请输入有效的账号名和密码"); return; }
  const attemptId = reserveLoginAttempt(ADMIN_LOGIN_PURPOSE, identity, username);
  if (attemptId === null) { rejectLoginBusy(response); return; }
  let success = false;
  try {
  await loginRiskBackoff(ADMIN_LOGIN_PURPOSE, identity, username);
  const verified = await verifyAdminCredentials(username, password);
  if (!verified.ok) {
    completeLoginAttempt(attemptId, false, "bad-credentials");
    if (globalFailureCount(15 * 60_000) >= getIntSetting("global_failure_alert", config.security.globalFailureAlert)) {
      recordAudit({
        actorType: "system",
        action: "admin-login.global-threshold",
        summary: "后台登录失败全局阈值告警",
        identityHash: identity,
      });
    }
    fail(response, 401, verified.reason);
    return;
  }

  const created = createAdminSession(
    verified.admin.id,
    identity,
    String(request.headers["user-agent"] ?? ""),
  );
  const previous = findAdminSession(parseCookies(request)[ADMIN_COOKIE] ?? "");
  if (previous) revokeAdminSession(previous.id);
  markAdminLogin(verified.admin.id);
  success = true;
  recordAudit({
    actorType: "admin",
    actor: verified.admin.username,
    action: "admin.login",
    summary: `角色 ${verified.admin.role}`,
    requestId: requestId(request),
    identityHash: identity,
  });
  appendCookie(
    response,
    sessionCookie(ADMIN_COOKIE, created.token, config.session.adminIdleMinutes * 60),
  );
  ok(response, {
    username: verified.admin.username,
    role: verified.admin.role,
    permissions: permissionList(verified.admin.role),
    csrfToken: created.csrfToken,
    expiresAt: created.expiresAt,
  });
  } finally { completeLoginAttempt(attemptId, success, success ? "ok" : "interrupted"); }
});

adminRouter.post("/auth/logout", requireAdmin, requireCsrf, (request, response) => {
  const context = request.admin;
  if (context) revokeAdminSession(context.sessionRow.id);
  clearCookie(response, ADMIN_COOKIE);
  ok(response, { loggedOut: true });
});

adminRouter.get("/auth/me", requireAdmin, (request, response) => {
  const context = request.admin;
  if (!context) return;
  ok(response, {
    username: context.admin.username,
    displayName: context.admin.display_name,
    role: context.role,
    permissions: permissionList(context.role),
    csrfToken: context.sessionRow.csrf_token,
    runner: config.maddy.runner,
    statsAvailable: statsAvailable(),
  });
});

adminRouter.use(requireAdmin, requireCsrf);
adminRouter.use(appearanceRouter);

// ---- 概览 ----

adminRouter.get("/overview", requirePermission("mail.account.read"), async (_request, response) => {
  const stats = mailboxStats();
  const queue = queueEntries();
  ok(response, {
    accounts: stats.length,
    messages: stats.reduce((sum, item) => sum + item.messages, 0),
    unseen: stats.reduce((sum, item) => sum + item.unseen, 0),
    queueLength: queue.length,
    recentFailures: globalFailureCount(24 * 60 * 60 * 1000),
    loginFailures15m: globalFailureCount(15 * 60 * 1000),
    failureAlertThreshold: config.security.globalFailureAlert,
    statsAvailable: statsAvailable(),
    maddyRunner: config.maddy.runner,
  });
});

// ---- 邮箱账号 ----

adminRouter.get("/accounts", requirePermission("mail.account.read"), async (_request, response) => {
  let credentials: string[];
  let accounts: string[];
  try {
    [credentials, accounts] = await Promise.all([listCredentials(), listAccounts()]);
  } catch {
    fail(response, 502, "无法读取邮局账号列表，请稍后重试；现有账号未发生变化");
    return;
  }
  const stats = new Map(mailboxStats().map((item) => [item.mailbox, item]));
  const rows = [] as {
    mailbox: string;
    hasCredential: boolean;
    hasMailbox: boolean;
    messages: number;
    unseen: number;
    folders: number;
    broken: boolean;
    needsCleanup: boolean;
  }[];
  const localOwners = new Set(localMailboxOwners());
  const all = new Set([...credentials, ...accounts, ...localOwners]);
  for (const mailbox of [...all].sort()) {
    const stat = stats.get(mailbox);
    const hasCredential = credentials.includes(mailbox);
    const hasMailbox = accounts.includes(mailbox);
    const needsCleanup = !hasCredential && !hasMailbox && localOwners.has(mailbox);
    rows.push({
      mailbox,
      hasCredential,
      hasMailbox,
      messages: stat?.messages ?? 0,
      unseen: stat?.unseen ?? 0,
      folders: stat?.folders.length ?? 0,
      // 只有凭据或只有邮箱都是坏状态：前者登不进，后者没有密码
      broken: hasCredential !== hasMailbox || needsCleanup,
      needsCleanup,
    });
  }
  ok(response, { accounts: rows, statsAvailable: statsAvailable() });
});

function reportAccountFailure(request: Request, response: Response, operation: AccountOperation,
  account: string, error: unknown, revokedSessions?: number): void {
  const failure = accountFailure(operation, error);
  recordAudit({
    actorType: "admin", actor: request.admin?.admin.username ?? "",
    action: `admin.account.${operation}-failed`, targetType: "mailbox", targetId: account,
    summary: `${failure.code}; outcome=${failure.outcome}${revokedSessions === undefined ? "" : `; revoked=${revokedSessions}`}`,
    requestId: requestId(request),
  });
  sendJson(response, 502, { ok: false, code: failure.code, error: failure.message,
    data: { account, outcome: failure.outcome, requiresAdminReview: true,
      ...(revokedSessions === undefined ? {} : { revokedSessions }) } });
}

adminRouter.post("/accounts", requirePermission("mail.account.write"), async (request, response) => {
  const body = await readJson<{ account?: string; password?: string }>(request);
  const account = normalizeMailboxAccount(String(body.account ?? ""), config.mail.domain);
  const password = String(body.password ?? "");
  if (!isValidLocalAccount(account, config.mail.domain)) {
    fail(response, 400, `账号名需为 3-50 位小写字母、数字、下划线、点或短横线，域名 ${config.mail.domain}`);
    return;
  }
  const weak = passwordProblem(password);
  if (weak) {
    fail(response, 400, weak);
    return;
  }
  try {
    await createMailbox(account, password);
  } catch (error) {
    reportAccountFailure(request, response, "create", account, error);
    return;
  }
  recordAudit({
    actorType: "admin",
    actor: request.admin?.admin.username ?? "",
    action: "admin.account.create",
    targetType: "mailbox",
    targetId: account,
    requestId: requestId(request),
  });
  ok(response, { created: account });
});

adminRouter.post(
  "/accounts/repair",
  requirePermission("mail.account.write"),
  async (request, response) => {
    const body = await readJson<{ account?: string; password?: string; confirm?: boolean }>(request);
    const account = normalizeMailboxAccount(String(body.account ?? ""), config.mail.domain);
    if (body.confirm !== true || !isValidLocalAccount(account, config.mail.domain)) {
      fail(response, 400, "修复账号需要有效邮箱地址和显式确认");
      return;
    }
    let credentials: string[], accounts: string[];
    try {
      [credentials, accounts] = await Promise.all([listCredentials(), listAccounts()]);
    } catch (error) {
      reportAccountFailure(request, response, "repair", account, error);
      return;
    }
    const missingCredential = !credentials.includes(account);
    const missingMailbox = !accounts.includes(account);
    if (!missingCredential && !missingMailbox) {
      ok(response, { account, repaired: [] as string[] });
      return;
    }
    if (missingCredential) {
      const weak = passwordProblem(String(body.password ?? ""));
      if (weak) {
        fail(response, 400, weak);
        return;
      }
    }
    try {
      const result = await repairMailbox(account, String(body.password ?? ""));
      recordAudit({
        actorType: "admin",
        actor: request.admin?.admin.username ?? "",
        action: "admin.account.repair",
        targetType: "mailbox",
        targetId: account,
        summary: `补建 ${result.repaired.join(", ") || "无需修复"}`,
        requestId: requestId(request),
      });
      ok(response, { account, ...result });
    } catch (error) {
      reportAccountFailure(request, response, "repair", account, error);
    }
  },
);

adminRouter.post(
  "/accounts/password",
  requirePermission("mail.account.write"),
  async (request, response) => {
    const body = await readJson<{ account?: string; password?: string; confirm?: boolean }>(request);
    const account = String(body.account ?? "").trim().toLowerCase();
    if (body.confirm !== true) {
      fail(response, 400, "重置密码需要显式确认");
      return;
    }
    if (!isValidLocalAccount(account, config.mail.domain)) {
      fail(response, 400, "需要有效的本域邮箱地址");
      return;
    }
    const weak = passwordProblem(String(body.password ?? ""));
    if (weak) {
      fail(response, 400, weak);
      return;
    }
    try {
      await changeMailboxPassword(account, String(body.password ?? ""));
    } catch (error) {
      // The command may have changed the password before the transport failed.
      // Never leave old authenticated connections active when the outcome is uncertain.
      const revoked = revokeMailSessionsFor(account);
      await dropSessionsForMailbox(account);
      reportAccountFailure(request, response, "password", account, error, revoked);
      return;
    }
    const revoked = revokeMailSessionsFor(account);
    await dropSessionsForMailbox(account);
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "admin.account.password",
      targetType: "mailbox",
      targetId: account,
      summary: `已重置密码并强制下线 ${revoked} 个会话`,
      requestId: requestId(request),
    });
    ok(response, { account, revokedSessions: revoked });
  },
);

adminRouter.post(
  "/accounts/remove",
  requirePermission("mail.account.write"),
  async (request, response) => {
    const body = await readJson<{ account?: string; confirm?: boolean }>(request);
    const account = String(body.account ?? "").trim().toLowerCase();
    if (body.confirm !== true || !isValidLocalAccount(account, config.mail.domain)) {
      fail(response, 400, "删除账号需要显式确认");
      return;
    }
    let revoked = 0;
    let alreadyAbsent = false;
    try {
      const [beforeCredentials, beforeAccounts] = await Promise.all([listCredentials(), listAccounts()]);
      alreadyAbsent = !beforeCredentials.includes(account) && !beforeAccounts.includes(account);
      if (alreadyAbsent && !hasLocalMailboxData(account)) {
        fail(response, 404, "账号及关联数据不存在");
        return;
      }
      /*
       * 先断掉这个账号的在线连接再删账号。
       * maddy 在账号仍被 IMAP 会话占用时可能跳过删除（而且退出码是 0），
       * 顺序反了就会留下「凭据没了、邮箱还在」的半成品。
       */
      revoked = revokeMailSessionsFor(account);
      await dropSessionsForMailbox(account);
      if (!alreadyAbsent) {
        await new Promise((done) => setTimeout(done, 300));
        await removeMailbox(account);
      }
      const [afterCredentials, afterAccounts] = await Promise.all([listCredentials(), listAccounts()]);
      if (afterCredentials.includes(account) || afterAccounts.includes(account)) {
        throw new Error("邮局仍有该账号，禁止清理 BFF 数据");
      }
    } catch (error) {
      reportAccountFailure(request, response, "remove", account, error, revoked);
      return;
    }
    let purged: Record<string, number>;
    try {
      purged = purgeLocalMailboxData(account);
    } catch {
      try {
        recordAudit({
          actorType: "admin", actor: request.admin?.admin.username ?? "",
          action: "admin.account.remove-data-failed", targetType: "mailbox", targetId: account,
          summary: "邮局账号已不存在；BFF 关联数据清理未确认，需要按原地址重试删除",
          requestId: requestId(request),
        });
      } catch { /* The database may itself be unavailable; keep the HTTP outcome explicit. */ }
      sendJson(response, 502, { ok: false, code: "account_data_cleanup_failed",
        error: "邮局账号已移除，但关联数据清理未确认；请刷新列表后对原地址重试删除",
        data: { account, outcome: "mailbox_removed_data_pending", requiresAdminReview: true,
          revokedSessions: revoked } });
      return;
    }
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "admin.account.remove",
      targetType: "mailbox",
      targetId: account,
      summary: `强制下线 ${revoked} 个会话；清理 BFF 关联数据 ${Object.values(purged).reduce((a, b) => a + b, 0)} 行`,
      requestId: requestId(request),
    });
    ok(response, { removed: account, alreadyAbsent, purged });
  },
);

// ---- 邀请码 ----

adminRouter.get("/invites", requirePermission("mail.invite.read"), (_request, response) => {
  ok(response, { invites: listInvites() });
});

adminRouter.post("/invites", requirePermission("mail.invite.write"), async (request, response) => {
  const body = await readJson<{
    boundAddress?: string;
    boundDomain?: string;
    note?: string;
    ttlHours?: number;
  }>(request);
  const boundAddress = normalizeMailboxAccount(String(body.boundAddress ?? ""), config.mail.domain);
  const invite = createInvite({
    boundAddress: String(body.boundAddress ?? "").trim() ? boundAddress : "",
    boundDomain: String(body.boundDomain ?? "").trim().toLowerCase(),
    note: String(body.note ?? ""),
    createdBy: request.admin?.admin.username ?? "",
    ttlHours: Number(body.ttlHours ?? 72),
  });
  recordAudit({
    actorType: "admin",
    actor: request.admin?.admin.username ?? "",
    action: "invite.create",
    targetType: "invite",
    targetId: String(invite.id),
    summary: boundAddress ? `绑定 ${boundAddress}` : "未绑定地址",
    requestId: requestId(request),
  });
  ok(response, invite);
});

adminRouter.post(
  "/invites/:id/revoke",
  requirePermission("mail.invite.write"),
  (request, response) => {
    if (!revokeInvite(Number(request.params.id))) {
      fail(response, 404, "邀请码不存在或已不可撤销");
      return;
    }
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "invite.revoke",
      targetType: "invite",
      targetId: String(request.params.id),
      requestId: requestId(request),
    });
    ok(response, { revoked: request.params.id });
  },
);

adminRouter.post(
  "/invites/check",
  requirePermission("mail.invite.read"),
  async (request, response) => {
    const body = await readJson<{ code?: string; account?: string }>(request);
    const result = checkInvite(
      String(body.code ?? ""),
      normalizeMailboxAccount(String(body.account ?? ""), config.mail.domain),
    );
    ok(response, result);
  },
);

// ---- 队列与日志 ----

adminRouter.get("/queue", requirePermission("mail.queue.read"), (_request, response) => {
  ok(response, { entries: queueEntries(), statsAvailable: statsAvailable() });
});

adminRouter.get("/logs/mail", requirePermission("mail.queue.read"), async (request, response) => {
  const lines = parseLogLimit(request.query.lines);
  if (lines === null) { fail(response, 400, "日志条数须为 10–2000 的整数"); return; }
  if (config.maddy.logSnapshotPath) {
    try { ok(response, await readMailLogSnapshot(config.maddy.logSnapshotPath, config.maddy.container, lines)); }
    catch { fail(response, 502, "日志快照读取失败，请检查服务器采集任务与快照文件"); }
    return;
  }
  if (config.maddy.runner !== "docker-exec") {
    ok(response, {
      available: false,
      hint: "尚未配置邮局日志快照，请由服务器部署日志采集任务。",
      lines: [] as string[],
    });
    return;
  }
  try { ok(response, await readDockerMailLogs(config.maddy.container, lines)); }
  catch { fail(response, 502, "邮局容器日志读取失败"); }
});

adminRouter.get(
  "/domain-check",
  requirePermission("mail.domain.check"),
  async (_request, response) => {
    ok(response, { checks: await domainCheck(), statsAvailable: statsAvailable() });
  },
);

// ---- 安全与审计 ----

adminRouter.get("/audit-logs", requirePermission("system.audit.read"), (request, response) => {
  const limit = Math.min(Number(request.query.limit ?? 100), 500);
  const offset = Math.max(Number(request.query.offset ?? 0), 0);
  ok(response, { logs: listAuditLogs(limit, offset) });
});

adminRouter.get("/login-logs", requirePermission("system.audit.read"), (request, response) => {
  const limit = Math.min(Number(request.query.limit ?? 100), 500);
  const offset = Math.max(Number(request.query.offset ?? 0), 0);
  ok(response, { logs: listLoginLogs(limit, offset) });
});

adminRouter.post(
  "/login-logs/block",
  requirePermission("system.security.write"),
  async (request, response) => {
    const body = await readJson<{ identityHash?: string; reason?: string }>(request);
    const identityHash = String(body.identityHash ?? "");
    if (!/^[a-f0-9]{32}$/.test(identityHash)) {
      fail(response, 400, "无效的来源指纹");
      return;
    }
    blockIdentity(identityHash, String(body.reason ?? "管理员手动封禁"), request.admin?.admin.username ?? "");
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "security.block-identity",
      targetType: "identity",
      targetId: identityHash,
      requestId: requestId(request),
    });
    ok(response, { blocked: identityHash });
  },
);

adminRouter.get("/blocked-identities", requirePermission("system.audit.read"), (_request, response) => {
  ok(response, { identities: listBlockedIdentities() });
});

adminRouter.post(
  "/blocked-identities/unblock",
  requirePermission("system.security.write"),
  async (request, response) => {
    const body = await readJson<{ identityHash?: string }>(request);
    const identityHash = String(body.identityHash ?? "");
    if (!/^[a-f0-9]{32}$/.test(identityHash)) {
      fail(response, 400, "无效的来源指纹");
      return;
    }
    if (!unblockIdentity(identityHash)) {
      fail(response, 404, "封禁记录不存在或已解除");
      return;
    }
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "security.unblock-identity",
      targetType: "identity",
      targetId: identityHash,
      requestId: requestId(request),
    });
    ok(response, { unblocked: identityHash });
  },
);

adminRouter.get("/security", requirePermission("system.audit.read"), (_request, response) => {
  ok(response, {
    loginMaxFailures: failureLimit("mail-login"),
    loginLockMinutes: limitWindowMs("mail-login") / 60_000,
    adminLoginMaxFailures: failureLimit("admin-login"),
    adminLoginLockMinutes: limitWindowMs("admin-login") / 60_000,
    registerMaxPerHour: registrationLimits().perHour,
    registerMaxPerDay: registrationLimits().perDay,
    globalFailureAlert: getIntSetting(
      "global_failure_alert",
      config.security.globalFailureAlert,
    ),
    registrationMode: getSetting("registration_mode", "invite"),
    recentRegisterAttempts: globalAttemptCount("register", 60 * 60 * 1000),
    recentDailyRegisterAttempts: globalAttemptCount("register", 24 * 60 * 60 * 1000),
  });
});

adminRouter.patch(
  "/security",
  requirePermission("system.security.write"),
  async (request, response) => {
    const body = await readJson<Record<string, unknown>>(request);
    const numeric: [string, string, number, number][] = [
      ["loginMaxFailures", "login_max_failures", 3, 20],
      ["loginLockMinutes", "login_lock_minutes", 1, 180],
      ["adminLoginMaxFailures", "admin_login_max_failures", 3, 20],
      ["adminLoginLockMinutes", "admin_login_lock_minutes", 1, 180],
      ["registerMaxPerHour", "register_max_per_hour", 1, 100],
      ["registerMaxPerDay", "register_max_per_day", 1, 1000],
      ["globalFailureAlert", "global_failure_alert", 5, 10_000],
    ];
    const allowed = new Set([...numeric.map(([name]) => name), "registrationMode"]);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowed.has(key))) {
      fail(response, 400, "安全策略包含不支持的字段");
      return;
    }
    for (const [name, , min, max] of numeric) {
      if (!(name in body)) continue;
      const value = body[name];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        fail(response, 400, `${name} 必须是 ${min}–${max} 范围内的整数`);
        return;
      }
    }
    if ("registrationMode" in body && body.registrationMode !== "closed" && body.registrationMode !== "invite") {
      fail(response, 400, "注册模式必须为 invite 或 closed");
      return;
    }
    db.exec("begin immediate");
    try {
      for (const [name, key] of numeric) if (name in body) setSetting(key, String(body[name]));
      if ("registrationMode" in body) setSetting("registration_mode", String(body.registrationMode));
      db.exec("commit");
    } catch (error) { db.exec("rollback"); throw error; }
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "security.update",
      summary: JSON.stringify(body).slice(0, 200),
      requestId: requestId(request),
    });
    ok(response, { saved: true });
  },
);

adminRouter.get("/sessions", requirePermission("system.audit.read"), (_request, response) => {
  ok(response, { sessions: listAdminSessions() });
});

adminRouter.post(
  "/sessions/:id/revoke",
  requirePermission("system.security.write"),
  (request, response) => {
    if (!revokeAdminSession(String(request.params.id))) {
      fail(response, 404, "会话不存在或已下线");
      return;
    }
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "admin.session.revoke",
      targetType: "admin-session",
      targetId: String(request.params.id),
      requestId: requestId(request),
    });
    ok(response, { revoked: request.params.id });
  },
);

// ---- 管理员账号 ----

adminRouter.get("/admins", requirePermission("system.admin.write"), (request, response) => {
  ok(response, {
    admins: listAdmins(),
    currentRole: request.admin?.role ?? "auditor",
  });
});

adminRouter.post("/admins", requirePermission("system.admin.write"), async (request, response) => {
  const body = await readJson<{
    username?: string;
    password?: string;
    role?: string;
    displayName?: string;
  }>(request);
  if (body.role && !["superadmin", "admin", "auditor"].includes(body.role)) {
    fail(response, 400, "未知管理员角色");
    return;
  }
  const created = createAdmin(
    String(body.username ?? ""),
    String(body.password ?? ""),
    normalizeRole(String(body.role ?? "auditor")),
    String(body.displayName ?? ""),
  );
  if (!created.ok) {
    fail(response, 400, created.error);
    return;
  }
  recordAudit({
    actorType: "admin",
    actor: request.admin?.admin.username ?? "",
    action: "admin.create",
    targetType: "admin",
    targetId: String(body.username ?? ""),
    summary: `角色 ${body.role ?? "auditor"}`,
    requestId: requestId(request),
  });
  ok(response, { id: created.id });
});

adminRouter.patch(
  "/admins/:id",
  requirePermission("system.admin.write"),
  async (request, response) => {
    const id = Number(request.params.id);
    const body = await readJson<{ role?: string; active?: boolean; password?: string }>(request);
    const target = findAdminById(id);
    if (!target) {
      fail(response, 404, "管理员不存在");
      return;
    }
    if (body.role && !["superadmin", "admin", "auditor"].includes(body.role)) {
      fail(response, 400, "未知管理员角色");
      return;
    }
    if (body.password) {
      const problem = passwordProblem(String(body.password));
      if (problem) {
        fail(response, 400, problem);
        return;
      }
    }
    const removesLastSuperadmin =
      target.role === "superadmin" &&
      target.is_active === 1 &&
      countAdmins("superadmin") <= 1 &&
      (body.active === false || (body.role !== undefined && body.role !== "superadmin"));
    if (removesLastSuperadmin) {
      fail(response, 409, "不能停用或降权最后一个超级管理员");
      return;
    }
    if (body.role) setAdminRole(id, normalizeRole(body.role));
    if (typeof body.active === "boolean") {
      setAdminActive(id, body.active);
      if (!body.active) revokeAdminSessionsFor(id);
    }
    if (body.password) {
      setAdminPassword(id, String(body.password));
      revokeAdminSessionsFor(id);
    }
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "admin.update",
      targetType: "admin",
      targetId: String(id),
      summary: JSON.stringify({ role: body.role, active: body.active, password: Boolean(body.password) }),
      requestId: requestId(request),
    });
    ok(response, { updated: id });
  },
);

// ---- 系统 ----

adminRouter.get(
  "/site-settings",
  requirePermission("system.admin.write"),
  (_request, response) => {
    ok(response, {
      settings: {
        siteName: getSetting("site_name", "BakaMail"),
        announcement: getSetting("announcement", ""),
        registrationMode: getSetting("registration_mode", "invite"),
        welcomeMail: getSetting("welcome_mail", "off"),
      },
      domain: config.mail.domain,
      mailHost: config.mail.host,
    });
  },
);

adminRouter.patch(
  "/site-settings",
  requirePermission("system.admin.write"),
  async (request, response) => {
    const body = await readJson<Record<string, string>>(request);
    const allowed: Record<string, string> = {
      siteName: "site_name",
      announcement: "announcement",
      welcomeMail: "welcome_mail",
    };
    for (const [key, column] of Object.entries(allowed)) {
      if (typeof body[key] === "string") setSetting(column, String(body[key]).slice(0, 500));
    }
    recordAudit({
      actorType: "admin",
      actor: request.admin?.admin.username ?? "",
      action: "settings.update",
      summary: JSON.stringify(body).slice(0, 200),
      requestId: requestId(request),
    });
    ok(response, { saved: true });
  },
);

adminRouter.get("/backup", requirePermission("system.admin.write"), (request, response) => {
  const dump = {
    generatedAt: nowIso(),
    admins: db
      .prepare("select id, username, display_name, role, is_active, created_at, last_login_at from admin_users")
      .all(),
    invites: listInvites(1000),
    auditLogs: listAuditLogs(1000, 0),
    loginLogs: listLoginLogs(1000, 0),
    settings: db.prepare("select key, value, updated_at from app_settings").all(),
    contacts: db.prepare("select * from contact_entries").all(),
  };
  recordAudit({
    actorType: "admin",
    actor: request.admin?.admin.username ?? "",
    action: "system.backup",
    requestId: requestId(request),
  });
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-backup-generated-at", dump.generatedAt);
  response.setHeader(
    "content-disposition",
    `attachment; filename="bakamail-backup-${dump.generatedAt.slice(0, 10)}.json"`,
  );
  response.end(JSON.stringify(dump, null, 2));
});

adminRouter.get("/permissions", requireAdmin, (request, response) => {
  const role = request.admin?.role ?? "auditor";
  ok(response, { role, permissions: permissionList(role), has: (code: string) => hasPermission(role, code) });
});

adminRouter.get("/runner-status", requirePermission("mail.account.read"), (_request, response) => {
  ok(response, {
    runner: config.maddy.runner,
    ready: maddyRunnerReady(),
    serviceVersion: appVersion,
    nodeVersion: process.version,
  });
});
