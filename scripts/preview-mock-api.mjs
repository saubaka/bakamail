/** Local-only visual QA fixture. No mail server is contacted; simulated sends never leave this process. */
import { createServer } from "node:http";

if (process.env.NODE_ENV === "production") {
  throw new Error("preview-mock-api must never run in production");
}

const simulatedSend = process.env.BAKAMAIL_QA_SEND_OUTCOME === "sent-not-saved";
const failDraftWrites = process.env.BAKAMAIL_QA_DRAFT_FAILURE === "1";
const failFlagWrites = process.env.BAKAMAIL_QA_FLAG_FAILURE === "1";
let failMessageListAfterWrite = false;
let failFolderListAfterWrite = false;
let failSettingsOnce = process.env.BAKAMAIL_QA_SETTINGS_FAILURE === "once";
let failMailAuthOnce = process.env.BAKAMAIL_QA_AUTH_FAILURE === "mail-once";
let failAdminAuthOnce = process.env.BAKAMAIL_QA_AUTH_FAILURE === "admin-once";
let failAdminLogoutOnce = process.env.BAKAMAIL_QA_ADMIN_LOGOUT_FAILURE === "once";
let adminLoggedOut = false;
let failOverviewOnce = process.env.BAKAMAIL_QA_OVERVIEW_FAILURE === "once";
let failAdminUsersOnce = process.env.BAKAMAIL_QA_ADMIN_USERS_FAILURE === "once";
let failQueueOnce = process.env.BAKAMAIL_QA_QUEUE_FAILURE === "once";
let failDomainCheckOnce = process.env.BAKAMAIL_QA_DOMAIN_CHECK_FAILURE === "once";
let failMailLogsOnce = process.env.BAKAMAIL_QA_MAIL_LOGS_FAILURE === "once";
let failSiteSettingsOnce = process.env.BAKAMAIL_QA_SITE_SETTINGS_FAILURE === "once";
let failSiteSettingsSaveOnce = process.env.BAKAMAIL_QA_SITE_SETTINGS_SAVE_FAILURE === "once";
let failRunnerStatusOnce = process.env.BAKAMAIL_QA_RUNNER_STATUS_FAILURE === "once";
let failBackupOnce = process.env.BAKAMAIL_QA_BACKUP_FAILURE === "once";
let failInvitesOnce = process.env.BAKAMAIL_QA_INVITES_FAILURE === "first";
let failInvitesAfterWrite = false;
let failSecurityPolicyOnce = process.env.BAKAMAIL_QA_SECURITY_POLICY_FAILURE === "once";
let failSecurityPolicyAfterSave = false;
let failBlockedOnce = process.env.BAKAMAIL_QA_SECURITY_BLOCKED_FAILURE === "once";
let failBlockedAfterWrite = false;
let failSessionsOnce = process.env.BAKAMAIL_QA_SECURITY_SESSIONS_FAILURE === "once";
let failSessionsAfterWrite = false;
let nextInviteId = 2;
let siteSettingsReads = 0;
const siteSettings = { siteName: "本地模拟站点", announcement: "本地公告", registrationMode: "invite", welcomeMail: "off" };
const securityPolicy = { loginMaxFailures: 8, loginLockMinutes: 20, registerMaxPerHour: 12, globalFailureAlert: 60, registrationMode: "invite" };
const qaHash = "qa-anonymous-fingerprint";
const loginRows = [{ id: 1, scope: "mail-login", identity_hash: qaHash, account: "local@example.test", success: 0, reason: "本地模拟失败", created_at: new Date().toISOString() }];
let blockedRows = process.env.BAKAMAIL_QA_SECURITY_BLOCKED_INITIAL === "1"
  ? [{ identity_hash: qaHash, scope: "mail-login", reason: "本地模拟封禁", created_by: "qa-admin", created_at: new Date().toISOString() }]
  : [];
let adminSessions = [{ id: "qa-session", username: "qa-admin", user_agent: "Local QA", created_at: new Date().toISOString(), last_active_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() }];
let queueReads = 0;
const queueStatsUnavailable = process.env.BAKAMAIL_QA_QUEUE_STATS_UNAVAILABLE === "1";
const denyDomainPermission = process.env.BAKAMAIL_QA_DOMAIN_PERMISSION === "none";
let failContactsReadOnce = process.env.BAKAMAIL_QA_CONTACTS_READ_FAILURE === "once";
let failContactsDeleteOnce = process.env.BAKAMAIL_QA_CONTACTS_DELETE_FAILURE === "once";
const alertOverview = process.env.BAKAMAIL_QA_OVERVIEW_ALERT === "1";
const denyMailAuth = process.env.BAKAMAIL_QA_AUTH_FAILURE === "mail-unauthorized";
const denyAdminAuth = process.env.BAKAMAIL_QA_AUTH_FAILURE === "admin-unauthorized";

const message = {
  uid: 7,
  seq: 1,
  subject: "周末一起看展吗？",
  from: [{ name: "小树", address: "alice@example.test" }],
  to: [{ name: "我", address: "me@example.test" }, { name: "小鹿", address: "friend@example.test" }],
  cc: [{ name: "小海", address: "team@example.test" }],
  replyTo: [],
  date: new Date().toISOString(),
  size: 1860,
  flags: [],
  seen: false,
  flagged: false,
  answered: false,
  hasAttachments: false,
  text: "周末好呀，天气不错，一起去看展吧。\n\n小树",
  html: process.env.BAKAMAIL_QA_HTML_MESSAGE === "1"
    ? '<p>本地 HTML 阅读测试</p><img src="https://example.invalid/tracking.png" alt="测试图"><script>window.qaShouldNotRun = true</script>'
    : null,
  headers: { "message-id": "<visual-qa@example.test>" },
  references: [],
  attachments: [],
};
let mailboxMessages = [message];

const folder = { path: "INBOX", name: "INBOX", specialUse: "\\Inbox", subscribed: true, messages: 1, unseen: 1 };
let folderRows = [folder];
if (process.env.BAKAMAIL_QA_FOLDER_REFRESH_FAILURE === "after-write") {
  folderRows.push({ path: "Work", name: "Work", specialUse: null, subscribed: true, messages: 1, unseen: 1 });
}
let contacts = [
  { id: 1, name: "小树", email: "alice@example.test", note: "" },
  { id: 2, name: "小鹿", email: "friend@example.test", note: "" },
];
let invites = [{
  id: 1, code_hint: "QA01", bound_address: "", bound_domain: "example.test", note: "本地预览",
  created_by: "qa-admin", created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 72 * 3600000).toISOString(),
  used_at: null, used_by: "", revoked_at: null,
}];
const data = (value) => ({ ok: true, data: value, error: "" });

createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  let payload;
  if (path === "/api/auth/me") {
    if (denyMailAuth) {
      response.statusCode = 401;
      payload = { ok: false, data: null, error: "未登录" };
    } else if (failMailAuthOnce) {
      failMailAuthOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟邮箱会话接口故障" };
    } else payload = data({ mailbox: "me@example.test", domain: "example.test", csrfToken: "visual-qa-only", expiresAt: new Date(Date.now() + 3600000).toISOString(), liveConnections: 0, maxMessageBytes: 33554432 });
  }
  else if (path === "/api/admin/auth/me") {
    if (denyAdminAuth || adminLoggedOut) {
      response.statusCode = 401;
      payload = { ok: false, data: null, error: "未登录" };
    } else if (failAdminAuthOnce) {
      failAdminAuthOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟管理员会话接口故障" };
    } else payload = data({ username: "qa-admin", displayName: "界面验收", role: "superadmin", permissions: denyDomainPermission ? ["mail.queue.read"] : ["*"], csrfToken: "visual-qa-admin-only", runner: "disabled", statsAvailable: false });
  }
  else if (path === "/api/admin/auth/logout" && request.method === "POST") {
    if (failAdminLogoutOnce) {
      failAdminLogoutOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟管理员退出故障" };
    } else {
      adminLoggedOut = true;
      payload = data({ loggedOut: true });
    }
  }
  else if (path === "/api/admin/overview") {
    if (failOverviewOnce) {
      failOverviewOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟概览读取故障" };
    } else payload = data({
      accounts: 0, messages: 0, unseen: 0, queueLength: 0,
      recentFailures: alertOverview ? 14 : 4,
      loginFailures15m: alertOverview ? 12 : 2,
      failureAlertThreshold: 10,
      statsAvailable: false, maddyRunner: "disabled",
    });
  }
  else if (path === "/api/admin/accounts") payload = data({ accounts: [{ mailbox: "alice@example.test", hasCredential: true, hasMailbox: true, messages: 1, unseen: 0, folders: 4, broken: false }], statsAvailable: false });
  else if (path === "/api/admin/admins") {
    if (request.method === "GET" && failAdminUsersOnce) {
      failAdminUsersOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟管理员列表读取故障" };
    } else payload = data({
      admins: [
        { id: 1, username: "qa-admin", role: "superadmin", is_active: 1, last_login_at: new Date().toISOString() },
        { id: 2, username: "review-auditor", role: "auditor", is_active: 0, last_login_at: null },
      ],
      currentRole: "superadmin",
    });
  }
  else if (path === "/api/admin/queue") {
    queueReads += 1;
    if (failQueueOnce || (process.env.BAKAMAIL_QA_QUEUE_FAILURE === "second" && queueReads === 2)) {
      failQueueOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟队列读取故障" };
    } else payload = data({ entries: [], statsAvailable: !queueStatsUnavailable });
  }
  else if (path === "/api/admin/domain-check") {
    if (failDomainCheckOnce) {
      failDomainCheckOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟域名自检故障" };
    } else payload = data({ checks: [{ key: "mx", label: "MX", status: "ok", detail: "本地模拟检查通过" }], statsAvailable: true });
  }
  else if (path === "/api/admin/logs/mail") {
    if (failMailLogsOnce) {
      failMailLogsOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟日志读取故障" };
    } else payload = data({ available: false, lines: [], hint: "本地预览不提供容器日志" });
  }
  else if (path === "/api/admin/site-settings") {
    if (request.method === "PATCH") {
      if (failSiteSettingsSaveOnce) {
        failSiteSettingsSaveOnce = false;
        response.statusCode = 503;
        response.end(JSON.stringify({ ok: false, data: null, error: "模拟站点设置保存故障" }));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += chunk.toString(); });
      request.on("end", () => {
        try {
          const next = JSON.parse(body);
          for (const key of ["siteName", "announcement", "welcomeMail"]) {
            if (typeof next[key] === "string") siteSettings[key] = next[key];
          }
          response.end(JSON.stringify(data({ saved: true })));
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ ok: false, data: null, error: "模拟设置格式错误" }));
        }
      });
      return;
    }
    siteSettingsReads += 1;
    if (failSiteSettingsOnce || (process.env.BAKAMAIL_QA_SITE_SETTINGS_FAILURE === "second" && siteSettingsReads === 2)) {
      failSiteSettingsOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟站点设置读取故障" };
    } else payload = data({ settings: siteSettings, domain: "example.test", mailHost: "mail.example.test" });
  }
  else if (path === "/api/admin/runner-status") {
    if (failRunnerStatusOnce) {
      failRunnerStatusOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟运行方式读取故障" };
    } else payload = data({ runner: "docker-exec", ready: true, serviceVersion: "0.1.0", nodeVersion: "v24-local" });
  }
  else if (path === "/api/admin/backup") {
    if (failBackupOnce) {
      failBackupOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟备份生成故障" };
    } else {
      const generatedAt = new Date().toISOString();
      response.setHeader("content-disposition", 'attachment; filename="bakamail-local-qa.json"');
      response.setHeader("x-backup-generated-at", generatedAt);
      response.end(JSON.stringify({ generatedAt, note: "仅本地模拟数据" }));
      return;
    }
  }
  else if (path === "/api/admin/security" && request.method === "GET") {
    if (failSecurityPolicyOnce || failSecurityPolicyAfterSave) {
      failSecurityPolicyOnce = false;
      failSecurityPolicyAfterSave = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟安全策略读取故障" };
    } else payload = data({ ...securityPolicy, recentRegisterAttempts: 2 });
  }
  else if (path === "/api/admin/security" && request.method === "PATCH") {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      try {
        Object.assign(securityPolicy, JSON.parse(body));
        if (process.env.BAKAMAIL_QA_SECURITY_POLICY_FAILURE === "after-save") failSecurityPolicyAfterSave = true;
        response.end(JSON.stringify(data({ saved: true })));
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, data: null, error: "模拟安全策略格式错误" }));
      }
    });
    return;
  }
  else if (path === "/api/admin/login-logs" && request.method === "GET") payload = data({ logs: loginRows });
  else if (path === "/api/admin/audit-logs" && request.method === "GET") payload = data({ logs: [] });
  else if (path === "/api/admin/blocked-identities" && request.method === "GET") {
    if (failBlockedOnce || failBlockedAfterWrite) {
      failBlockedOnce = false;
      failBlockedAfterWrite = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟封禁列表读取故障" };
    } else payload = data({ identities: blockedRows });
  }
  else if (path === "/api/admin/login-logs/block" && request.method === "POST") {
    blockedRows = [{ identity_hash: qaHash, scope: "mail-login", reason: "本地模拟封禁", created_by: "qa-admin", created_at: new Date().toISOString() }];
    if (process.env.BAKAMAIL_QA_SECURITY_BLOCKED_FAILURE === "after-block") failBlockedAfterWrite = true;
    payload = data({ blocked: qaHash });
  }
  else if (path === "/api/admin/blocked-identities/unblock" && request.method === "POST") {
    blockedRows = [];
    if (process.env.BAKAMAIL_QA_SECURITY_BLOCKED_FAILURE === "after-unblock") failBlockedAfterWrite = true;
    payload = data({ unblocked: qaHash });
  }
  else if (path === "/api/admin/sessions" && request.method === "GET") {
    if (failSessionsOnce || failSessionsAfterWrite) {
      failSessionsOnce = false;
      failSessionsAfterWrite = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟在线会话读取故障" };
    } else payload = data({ sessions: adminSessions });
  }
  else if (/^\/api\/admin\/sessions\/[^/]+\/revoke$/.test(path) && request.method === "POST") {
    adminSessions = adminSessions.filter((row) => row.id !== path.split("/")[4]);
    if (process.env.BAKAMAIL_QA_SECURITY_SESSIONS_FAILURE === "after-revoke") failSessionsAfterWrite = true;
    payload = data({ revoked: true });
  }
  else if (path === "/api/admin/invites" && request.method === "GET") {
    if (failInvitesOnce || failInvitesAfterWrite) {
      failInvitesOnce = false;
      failInvitesAfterWrite = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟邀请码列表读取故障" };
    } else payload = data({ invites });
  }
  else if (path === "/api/admin/invites" && request.method === "POST") {
    const id = nextInviteId++;
    const code = `LOCAL-QA-${id}-ONLY`;
    const expiresAt = new Date(Date.now() + 72 * 3600000).toISOString();
    invites = [{
      id, code_hint: code.slice(0, 4), bound_address: "", bound_domain: "", note: "本地预览",
      created_by: "qa-admin", created_at: new Date().toISOString(), expires_at: expiresAt,
      used_at: null, used_by: "", revoked_at: null,
    }, ...invites];
    if (process.env.BAKAMAIL_QA_INVITES_FAILURE === "after-create") failInvitesAfterWrite = true;
    payload = data({ code, id, expiresAt });
  }
  else if (/^\/api\/admin\/invites\/\d+\/revoke$/.test(path) && request.method === "POST") {
    const id = Number(path.split("/")[4]);
    const invite = invites.find((row) => row.id === id && !row.revoked_at && !row.used_at);
    if (!invite) {
      response.statusCode = 404;
      payload = { ok: false, data: null, error: "邀请码不存在或已不可撤销" };
    } else {
      invite.revoked_at = new Date().toISOString();
      if (process.env.BAKAMAIL_QA_INVITES_FAILURE === "after-revoke") failInvitesAfterWrite = true;
      payload = data({ revoked: id });
    }
  }
  else if (["/api/folders", "/api/folders/subscribe", "/api/folders/empty"].includes(path) && request.method !== "GET") {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      try {
        const input = body ? JSON.parse(body) : {};
        const selectedPath = input.path ?? new URL(request.url, "http://127.0.0.1").searchParams.get("path");
        let result;
        if (path === "/api/folders" && request.method === "POST") {
          folderRows.push({ path: selectedPath, name: selectedPath, specialUse: null, subscribed: false, messages: 0, unseen: 0 });
          result = { created: selectedPath };
        } else if (path === "/api/folders" && request.method === "PATCH") {
          folderRows = folderRows.map((row) => row.path === selectedPath ? { ...row, path: input.name, name: input.name } : row);
          result = { from: selectedPath, to: input.name };
        } else if (path === "/api/folders" && request.method === "DELETE") {
          folderRows = folderRows.filter((row) => row.path !== selectedPath);
          result = { deleted: selectedPath };
        } else if (path === "/api/folders/subscribe") {
          folderRows = folderRows.map((row) => row.path === selectedPath ? { ...row, subscribed: input.subscribe } : row);
          result = { path: selectedPath, subscribe: input.subscribe };
        } else if (path === "/api/folders/empty") {
          result = { removed: mailboxMessages.length };
          mailboxMessages = [];
          folderRows = folderRows.map((row) => row.path === selectedPath ? { ...row, messages: 0, unseen: 0 } : row);
        } else throw new Error("unsupported local folder operation");
        if (process.env.BAKAMAIL_QA_FOLDER_REFRESH_FAILURE === "after-write") {
          failFolderListAfterWrite = true;
          if (request.method === "PATCH" || request.method === "DELETE" || path.endsWith("/empty")) failMessageListAfterWrite = true;
        }
        response.end(JSON.stringify(data(result)));
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ ok: false, data: null, error: "模拟文件夹格式错误" }));
      }
    });
    return;
  }
  else if (path === "/api/folders") {
    if (failFolderListAfterWrite) {
      failFolderListAfterWrite = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟写入后文件夹读取故障" };
    } else payload = data({ account: "me@example.test", folders: folderRows.map((row) => row.path === "INBOX"
      ? { ...row, messages: mailboxMessages.length, unseen: mailboxMessages.filter((item) => !item.seen).length }
      : row) });
  }
  else if (path === "/api/settings") {
    if (request.method === "GET" && failSettingsOnce) {
      failSettingsOnce = false;
      response.statusCode = 502;
      payload = { ok: false, data: null, error: "模拟设置读取故障" };
    } else payload = data({ settings: { density: "comfortable", pageSize: "50", timeFormat: "24h", remoteImages: "ask", signature: "" } });
  }
  else if (path === "/api/contacts" && request.method === "GET") {
    if (failContactsReadOnce) {
      failContactsReadOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟联系人列表读取失败" };
    } else payload = data({ contacts });
  }
  else if (path === "/api/contacts") payload = data({ contacts });
  else if (/^\/api\/contacts\/\d+$/.test(path) && request.method === "DELETE") {
    if (failContactsDeleteOnce) {
      failContactsDeleteOnce = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟联系人删除失败" };
    } else {
      const id = Number(path.slice(path.lastIndexOf("/") + 1));
      contacts = contacts.filter((contact) => contact.id !== id);
      payload = data({ deleted: id });
    }
  }
  else if (path === "/api/messages") {
    if (request.method === "POST") {
      if (simulatedSend) {
        payload = data({ messageId: "<simulated@example.test>", accepted: ["alice@example.test"], savedToSent: false, saveError: "simulated write-back failure" });
      } else {
        response.statusCode = 409;
        payload = { ok: false, data: null, error: "视觉预览不能发送真实邮件" };
      }
    } else if (failMessageListAfterWrite) {
      failMessageListAfterWrite = false;
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟写入后邮件列表读取故障" };
    } else payload = data({ items: mailboxMessages, nextBefore: null, total: mailboxMessages.length });
  } else if (path === "/api/messages/7") {
    if (mailboxMessages.length) payload = data(message);
    else {
      response.statusCode = 404;
      payload = { ok: false, data: null, error: "邮件已移动或删除" };
    }
  }
  else if (path === "/api/drafts" && request.method === "POST") {
    if (failDraftWrites) {
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟草稿保存失败" };
    } else payload = data({ id: "visual-qa-draft" });
  }
  else if (path === "/api/drafts") payload = data({ drafts: [] });
  else if (path === "/api/events") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    response.write('event: ready\ndata: {"mailbox":"me@example.test"}\n\n');
    const timer = setInterval(() => response.write(`event: ping\ndata: {"at":${Date.now()}}\n\n`), 15000);
    request.on("close", () => clearInterval(timer));
    return;
  } else if (path === "/api/messages/flags") {
    if (failFlagWrites) {
      response.statusCode = 503;
      payload = { ok: false, data: null, error: "模拟标记失败" };
    } else {
      let body = "";
      request.on("data", (chunk) => { body += chunk.toString(); });
      request.on("end", () => {
        try {
          const input = JSON.parse(body);
          if (input.flags?.includes("\\Seen")) message.seen = input.mode === "add";
          if (input.flags?.includes("\\Flagged")) message.flagged = input.mode === "add";
          if (process.env.BAKAMAIL_QA_MESSAGE_REFRESH_FAILURE === "after-flag") failMessageListAfterWrite = true;
          response.end(JSON.stringify(data({ updated: true })));
        } catch {
          response.statusCode = 400;
          response.end(JSON.stringify({ ok: false, data: null, error: "模拟标记格式错误" }));
        }
      });
      return;
    }
  }
  else if ((path === "/api/messages/move" || path === "/api/messages/delete") && request.method === "POST") {
    mailboxMessages = [];
    const action = path === "/api/messages/move" ? "move" : "delete";
    if (process.env.BAKAMAIL_QA_MESSAGE_REFRESH_FAILURE === `after-${action}`) failMessageListAfterWrite = true;
    payload = data(action === "move" ? { moved: 1 } : { deleted: 1, permanent: false });
  }
  else {
    response.statusCode = 404;
    payload = { ok: false, data: null, error: "视觉预览没有此接口" };
  }
  response.end(JSON.stringify(payload));
}).listen(8790, "127.0.0.1", () => {
  process.stdout.write("Visual QA mock API: http://127.0.0.1:8790\n");
});
