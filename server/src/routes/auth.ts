import { Router } from "express";
import { config } from "../config.ts";
import { db, getSetting, getIntSetting } from "../db.ts";
import {
  appendCookie,
  clearCookie,
  fail,
  ok,
  parseCookies,
  readJson,
  requestId,
  sendJson,
  sessionCookie,
} from "../http/kit.ts";
import { MAIL_COOKIE, createMailSession, findMailSession, revokeMailSession, revokeMailSessionsFor } from "../http/session.ts";
import { requireCsrf, requireMail } from "../http/auth.ts";
import { issueHumanCheck, verifyHumanCheck } from "../security/humanCheck.ts";
import { issueFormToken, consumeFormToken } from "../security/formToken.ts";
import { clientAddress, fingerprint } from "../security/identity.ts";
import { attemptCount, completeLoginAttempt, globalFailureCount, isIdentityBlocked, recordLoginAttempt, reserveLoginAttempt, loginRiskBackoff } from "../security/rateLimit.ts";
import { admitLogin, rejectLoginBusy } from "../security/loginGuard.ts";
import { enforceBudget, reserveLease, releaseLease, rejectBudget, keepLeaseAlive, anonymousRequestBudget } from "../security/abuse.ts";
import { recordAudit } from "../security/audit.ts";
import { MailboxSession, isValidLocalAccount, normalizeMailboxAccount } from "../mail/session.ts";
import { dropSession, dropSessionsForMailbox, liveSessionCount, putSession } from "../mail/registry.ts";
import { changeMailboxPassword, createMailbox, listAccounts, listCredentials, maddyRunnerReady } from "../mail/accounts.ts";
import { checkInvite, consumeInvite, releaseInviteClaim, completeInviteClaim, retainInviteClaim } from "../admin/invites.ts";
import { passwordProblem } from "../security/passwords.ts";
import { registrationReasonProblem, reserveRegistrationAttempt } from "../security/registration.ts";
import { isMailServiceFailure } from "../mail/authFailure.ts";

export const authRouter = Router();

const HUMAN_PURPOSES = new Set(["login", "register", "password-reset"]);

authRouter.get("/human-check", (request, response) => {
  const purposeRaw = String(request.query.purpose ?? "login");
  const purpose = HUMAN_PURPOSES.has(purposeRaw) ? purposeRaw : "login";
  const address = clientAddress(
    request.headers as Record<string, unknown>,
    request.socket.remoteAddress,
  );
  const identity = fingerprint(`mail-${purpose}`, address);
  const budgetIdentity = fingerprint("auth-source", address);
  // Reserve the cheaper token before rendering a PNG; both issuance budgets are independently enforced.
  const formToken = purpose === "register" ? issueFormToken("register", 1800, identity) : "";
  const challenge = issueHumanCheck(`mail-${purpose}`, identity, budgetIdentity);
  ok(response, {
    purpose,
    domain: config.mail.domain,
    nonce: challenge.nonce,
    image: challenge.imageData,
    expiresIn: challenge.expiresIn,
    formToken,
    minFormSeconds: config.security.minFormSeconds,
  });
});

type LoginBody = {
  account?: string;
  password?: string;
  humanNonce?: string;
  humanAnswer?: string;
};

authRouter.post("/login", anonymousRequestBudget("login"), async (request, response) => {
  const body = await readJson<LoginBody>(request);
  const address = clientAddress(
    request.headers as Record<string, unknown>,
    request.socket.remoteAddress,
  );
  const identity = fingerprint("mail-login", address);
  const account = normalizeMailboxAccount(String(body.account ?? ""), config.mail.domain);
  const password = String(body.password ?? "");
  if (!admitLogin("mail-login", identity, account, fingerprint("auth-source", address),
    String(body.humanNonce ?? ""), String(body.humanAnswer ?? ""), response)) return;

  // Existing mailboxes may predate the stricter new-account naming policy (e.g. "me").
  const local = account.endsWith(`@${config.mail.domain}`) ? account.slice(0, -config.mail.domain.length - 1) : "";
  if (!/^[a-z0-9][a-z0-9_.+-]{0,63}$/.test(local) || !password || password.length > 200) {
    recordLoginAttempt("mail-login", identity, account, false, "missing");
    fail(response, 400, "请输入账号名和密码");
    return;
  }

  const attemptId = reserveLoginAttempt("mail-login", identity, account);
  if (attemptId === null) {
    rejectLoginBusy(response);
    return;
  }
  let attemptSuccess = false;
  let attemptReason = "interrupted";
  let finalized = false;
  try {
    await loginRiskBackoff("mail-login", identity, account);
    const sessionId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const mailboxSession = new MailboxSession(sessionId, account, password);
    try {
      await mailboxSession.ping();
    } catch (error) {
      await mailboxSession.close().catch(() => undefined);
      if (isMailServiceFailure(error)) {
        attemptReason = "mail-unavailable";
        completeLoginAttempt(attemptId, false, attemptReason);
        finalized = true;
        response.setHeader("retry-after", "5");
        sendJson(response, 503, { ok: false, code: "mail_unavailable", data: { retryAfterSeconds: 5 },
          error: "邮局暂时不可用，请稍后重试；本次不计入密码失败次数" });
        return;
      }
      attemptReason = "bad-credentials";
      completeLoginAttempt(attemptId, false, attemptReason);
      finalized = true;
      const alertThreshold = getIntSetting("global_failure_alert", config.security.globalFailureAlert);
      if (globalFailureCount(15 * 60_000) >= alertThreshold) {
        recordAudit({
          actorType: "system",
          action: "login.global-threshold",
          summary: `15 分钟内全站登录失败超过 ${alertThreshold} 次`,
          identityHash: identity,
        });
      }
      fail(response, 401, "账号或密码错误");
      return;
    }
    const created = createMailSession(account, identity, String(request.headers["user-agent"] ?? ""));
    const previous = findMailSession(readMailCookie(request));
    if (previous) { revokeMailSession(previous.id); await dropSession(previous.id); }
    const realSession = new MailboxSession(created.id, account, password);
    putSession(realSession);
    realSession.startIdle();
    await mailboxSession.close().catch(() => undefined);
    attemptSuccess = true;
    attemptReason = "ok";
    recordAudit({
      actorType: "mailbox", actor: account, action: "mailbox.login", summary: "邮箱登录成功",
      requestId: requestId(request), identityHash: identity,
    });
    appendCookie(response, sessionCookie(MAIL_COOKIE, created.token, config.session.mailDays * 24 * 60 * 60));
    ok(response, { mailbox: account, csrfToken: created.csrfToken, expiresAt: created.expiresAt });
  } finally {
    if (!finalized) completeLoginAttempt(attemptId, attemptSuccess, attemptReason);
  }
});

authRouter.post("/logout", requireMail, requireCsrf, async (request, response) => {
  const context = request.mail;
  if (context) {
    revokeMailSession(context.sessionRow.id);
    await dropSession(context.sessionRow.id);
  }
  clearCookie(response, MAIL_COOKIE);
  ok(response, { loggedOut: true });
});

authRouter.post("/logout-all", requireMail, requireCsrf, async (request, response) => {
  const context = request.mail;
  const mailbox = context?.sessionRow.mailbox ?? "";
  const revoked = revokeMailSessionsFor(mailbox);
  const dropped = await dropSessionsForMailbox(mailbox);
  recordAudit({
    actorType: "mailbox",
    actor: mailbox,
    action: "mailbox.logout-all",
    summary: `吊销 ${revoked} 个会话，断开 ${dropped} 条连接`,
    requestId: requestId(request),
  });
  clearCookie(response, MAIL_COOKIE);
  ok(response, { revoked, dropped });
});

authRouter.get("/me", requireMail, async (request, response) => {
  const context = request.mail;
  if (!context) return;
  ok(response, {
    mailbox: context.sessionRow.mailbox,
    domain: config.mail.domain,
    csrfToken: context.sessionRow.csrf_token,
    expiresAt: context.sessionRow.expires_at,
    liveConnections: liveSessionCount(),
    maxMessageBytes: config.mail.maxMessageBytes,
  });
});

type RegisterBody = {
  inviteCode?: string;
  account?: string;
  password?: string;
  confirmPassword?: string;
  humanNonce?: string;
  humanAnswer?: string;
  formToken?: string;
  elapsedMs?: number;
  website?: string;
  reason?: string;
};

authRouter.post("/register", anonymousRequestBudget("register"), async (request, response) => {
  const body = await readJson<RegisterBody>(request);
  const address = clientAddress(
    request.headers as Record<string, unknown>,
    request.socket.remoteAddress,
  );
  const identity = fingerprint("register", address);
  // 人机校验的 target 必须与 GET /human-check 时用的一致，否则永远匹配不上
  const humanIdentity = fingerprint("mail-register", address);
  const requestedAccount = normalizeMailboxAccount(String(body.account ?? ""), config.mail.domain);

  if (isIdentityBlocked(identity)) {
    recordLoginAttempt("register", identity, requestedAccount, false, "blocked");
    fail(response, 403, "该来源已被禁止注册，请联系管理员");
    return;
  }
  if (getSetting("registration_mode", "invite") !== "invite") {
    recordLoginAttempt("register", identity, requestedAccount, false, "registration-closed");
    sendJson(response, 403, { ok: false, code: "registration_closed", data: null,
      error: "管理员已关闭注册，请稍后再试或联系管理员" });
    return;
  }
  const reservation = reserveRegistrationAttempt(identity, requestedAccount);
  if (reservation.limited) {
    response.setHeader("retry-after", String(reservation.retryAfterSeconds));
    sendJson(response, 429, { ok: false, code: "registration_rate_limited",
      data: { retryAfterSeconds: reservation.retryAfterSeconds, window: reservation.window },
      error: reservation.window === "day" ? "该来源 24 小时注册额度已用完，请稍后再试" : "注册请求过于频繁，请稍后再试" });
    return;
  }
  const attemptId = reservation.attemptId;
  let attemptReason = "rejected";
  response.once("finish", () => completeLoginAttempt(attemptId, response.statusCode < 400, attemptReason));
  response.once("close", () => completeLoginAttempt(attemptId, false, "interrupted"));

  // 蜜罐字段：正常用户看不到也不会填
  if (String(body.website ?? "").trim() !== "") {
    attemptReason = "honeypot";
    fail(response, 400, "请求被拒绝");
    return;
  }
  const reasonProblem = registrationReasonProblem(body.reason);
  if (reasonProblem) {
    attemptReason = "reason-invalid";
    sendJson(response, 400, { ok: false, code: "invalid_registration_reason",
      data: { fieldErrors: { reason: reasonProblem } }, error: reasonProblem });
    return;
  }
  // 填写耗时下限：脚本往往瞬间提交
  if (!consumeFormToken("register", String(body.formToken ?? ""), humanIdentity, config.security.minFormSeconds)) {
    attemptReason = "form-token";
    fail(response, 400, "表单已失效或提交过快，请换一张验证码后重新填写");
    return;
  }
  if (
    !verifyHumanCheck(
      "mail-register",
      humanIdentity,
      String(body.humanNonce ?? ""),
      String(body.humanAnswer ?? ""),
      fingerprint("auth-source", address),
    )
  ) {
    attemptReason = "human";
    fail(response, 400, "人机校验未通过");
    return;
  }

  const inviteCode = String(body.inviteCode ?? "");
  enforceBudget("invite-guess", identity);
  const invite = checkInvite(inviteCode, requestedAccount);
  if (!invite.ok) {
    attemptReason = "invite";
    fail(response, 400, "邀请码无效或无法用于此申请");
    return;
  }
  if (!isValidLocalAccount(requestedAccount, config.mail.domain)) {
    attemptReason = "account-format";
    fail(response, 400, "账号名需为 3-50 位小写字母、数字、下划线、点或短横线");
    return;
  }
  const password = String(body.password ?? "");
  if (password !== String(body.confirmPassword ?? password)) {
    attemptReason = "password-mismatch";
    fail(response, 400, "两次输入的密码不一致");
    return;
  }
  const weak = passwordProblem(password);
  if (weak) {
    attemptReason = "weak-password";
    fail(response, 400, weak);
    return;
  }
  if (!maddyRunnerReady()) {
    attemptReason = "runner-unavailable";
    fail(response, 503, "当前实例未开启账号管理能力");
    return;
  }

  const lease = reserveLease("register", identity, requestedAccount, 4, 1);
  if (!lease) { attemptReason = "busy"; rejectBudget(response, "registration_busy", 5, "注册正在处理，请勿重复提交"); return; }
  const stopHeartbeat = keepLeaseAlive(lease);
  try {

  let existingCredentials: string[];
  let existingAccounts: string[];
  try {
    [existingCredentials, existingAccounts] = await Promise.all([listCredentials(), listAccounts()]);
  } catch {
    attemptReason = "preflight-unavailable";
    fail(response, 503, "邮局账号状态暂时无法确认，请稍后重试");
    return;
  }
  if (existingCredentials.includes(requestedAccount) || existingAccounts.includes(requestedAccount)) {
    attemptReason = "account-exists";
    fail(response, 409, "该邮箱地址不可注册，请使用其他账号名");
    return;
  }
  // Preflight awaits the mail service; a policy change during that wait must still prevent provisioning.
  if (getSetting("registration_mode", "invite") !== "invite") {
    attemptReason = "registration-closed";
    sendJson(response, 403, { ok: false, code: "registration_closed", data: null,
      error: "管理员已关闭注册，请稍后再试或联系管理员" });
    return;
  }
  const claimedAt = consumeInvite(invite.invite.id, requestedAccount);
  if (!claimedAt) {
    attemptReason = "invite-claimed";
    fail(response, 409, "邀请码正在使用或已失效，请联系管理员");
    return;
  }
  try {
    await createMailbox(requestedAccount, password);
  } catch (error) {
    attemptReason = "provision";
    let released = false;
    try {
      const [credentials, accounts] = await Promise.all([listCredentials(), listAccounts()]);
      if (!credentials.includes(requestedAccount) && !accounts.includes(requestedAccount)) {
        released = releaseInviteClaim(invite.invite.id, requestedAccount, claimedAt);
      }
    } catch { /* Fail closed: do not reuse an invite if partial account state is unknown. */ }
    if (!released) {
      try { retainInviteClaim(invite.invite.id, requestedAccount, claimedAt); } catch { /* The reserved slot remains fail-closed. */ }
    }
    const code = released ? "mailbox_create_failed" : "mailbox_create_unconfirmed";
    recordAudit({ actorType: "invite", actor: requestedAccount, action: "mailbox.create-failed",
      targetType: "mailbox", targetId: requestedAccount,
      summary: `${code}; invite-restored=${released}`, requestId: requestId(request), identityHash: identity });
    sendJson(response, 502, { ok: false, code,
      data: { inviteRestored: released, requiresAdminReview: !released },
      error: released ? "邮局建号失败；邀请码已恢复，可稍后重试"
        : "邮局建号结果未确认；邀请码已保留，请管理员核对账号状态，勿重复提交" });
    return;
  }

  // Mailbox creation has completed. Never release its slot even if the bookkeeping write fails.
  try {
    if (!completeInviteClaim(invite.invite.id, requestedAccount, claimedAt)) throw Error('Invite completion unconfirmed');
  } catch {
    attemptReason = 'invite-completion-unconfirmed';
    recordAudit({ actorType: 'invite', actor: requestedAccount, action: 'mailbox.create-unconfirmed',
      targetType: 'mailbox', targetId: requestedAccount, summary: 'mailbox-created; invite-count-unconfirmed',
      requestId: requestId(request), identityHash: identity });
    sendJson(response, 502, { ok: false, code: 'mailbox_create_unconfirmed',
      data: { inviteRestored: false, requiresAdminReview: true },
      error: '邮箱已创建，但邀请码计数未确认；请联系管理员核对，勿重复提交' });
    return;
  }
  attemptReason = "created";
  recordAudit({
    actorType: "invite",
    actor: requestedAccount,
    action: "mailbox.create",
    targetType: "mailbox",
    targetId: requestedAccount,
    summary: `通过邀请码注册（${invite.invite.code_hint}…）`,
    requestId: requestId(request),
    identityHash: identity,
  });
  ok(response, { mailbox: requestedAccount, created: true });
  } finally { stopHeartbeat(); releaseLease(lease); }
});

type PasswordResetBody = { account?: string; humanNonce?: string; humanAnswer?: string };

authRouter.post("/password-reset", async (request, response) => {
  const body = await readJson<PasswordResetBody>(request);
  const address = clientAddress(
    request.headers as Record<string, unknown>,
    request.socket.remoteAddress,
  );
  const identity = fingerprint("password-reset", address);
  const humanIdentity = fingerprint("mail-password-reset", address);
  const account = normalizeMailboxAddress(String(body.account ?? ""));
  const limitPerHour = 3;
  if (isIdentityBlocked(identity)) {
    recordLoginAttempt("password-reset", identity, account, false, "blocked");
    fail(response, 403, "该来源已被禁止申请，请联系管理员");
    return;
  }
  if (attemptCount("password-reset", identity, 60 * 60_000) >= limitPerHour) {
    recordLoginAttempt("password-reset", identity, account, false, "rate-limited");
    response.setHeader("retry-after", "3600");
    fail(response, 429, "申请过于频繁，请稍后再试");
    return;
  }
  const attemptId = recordLoginAttempt("password-reset", identity, account, false, "pending");
  let attemptReason = "human";
  response.once("finish", () => completeLoginAttempt(attemptId, response.statusCode < 400, attemptReason));
  if (
    !verifyHumanCheck(
      "mail-password-reset",
      humanIdentity,
      String(body.humanNonce ?? ""),
      String(body.humanAnswer ?? ""),
    )
  ) {
    fail(response, 400, "人机校验未通过");
    return;
  }
  attemptReason = "requested";
  recordAudit({
    actorType: "mailbox",
    actor: account,
    action: "mailbox.password-reset-request",
    targetType: "mailbox",
    targetId: account,
    summary: "用户申请重置密码，等待管理员处理",
    requestId: requestId(request),
    identityHash: identity,
  });
  // 不返回账号是否存在，避免枚举
  ok(response, { accepted: true });
});

function normalizeMailboxAddress(input: string): string {
  return input.trim().toLowerCase().slice(0, 200);
}

/** 管理后台改密码后强制该账号重新登录 */
export async function forceMailboxRelogin(mailbox: string): Promise<number> {
  const revoked = revokeMailSessionsFor(mailbox);
  await dropSessionsForMailbox(mailbox);
  return revoked;
}

export async function changePasswordAndRevoke(mailbox: string, password: string): Promise<void> {
  await changeMailboxPassword(mailbox, password);
  await forceMailboxRelogin(mailbox);
  db.prepare("delete from drafts where owner = ?").run(mailbox);
}

export function sessionCookieFor(token: string): string {
  return sessionCookie(MAIL_COOKIE, token, config.session.mailDays * 24 * 60 * 60);
}

export function readMailCookie(request: Parameters<typeof parseCookies>[0]): string {
  return parseCookies(request)[MAIL_COOKIE] ?? "";
}
