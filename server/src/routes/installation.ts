import { Router } from "express";
import { entrySettings, resolveAdminEntry, installationInitialized, initializeInstallation, updateEntrySettings } from "../admin/installation.ts";
import { requireAdmin, requireCsrf, requirePermission } from "../http/auth.ts";
import { requireSameOrigin } from "../security/origin.ts";
import { clientAddress, fingerprint } from "../security/identity.ts";
import { enforceBudget, peekBudget, reserveLease, releaseLease, rejectBudget, SecurityBudgetError, SECURITY_BUDGETS } from "../security/abuse.ts";
import { adminPathProblem } from "../../../shared/adminPaths.ts";
import { ok, readJson, requestId } from "../http/kit.ts";

export const installationRouter = Router();
installationRouter.get("/installation", (request, response) => {
  const initialized = installationInitialized();
  const candidate = request.query.entry;
  // 只对“看起来像后台路径”的猜测限流，且只计失败：正常管理员打开自己的路径不会被消耗。
  // 已经猜错过多的来源在冷却期内连正确的答案也拿不到，因此限流不会变成猜路径的探测器。
  const probing = initialized && typeof candidate === "string" && !adminPathProblem(candidate);
  const identity = fingerprint("entry-probe", clientAddress(request.headers, request.socket.remoteAddress));
  if (probing) {
    const wait = peekBudget("entry-probe", identity, SECURITY_BUDGETS["entry-probe"]);
    if (wait) throw new SecurityBudgetError("entry_probe_rate_limited", wait);
  }
  const entry = initialized ? resolveAdminEntry(candidate) : null;
  if (probing && !entry) enforceBudget("entry-probe", identity);
  ok(response, { initialized, ...(entry ? { entry } : {}) });
});
installationRouter.post("/installation", requireSameOrigin, (request, _response, next) => {
  enforceBudget("initialize", fingerprint("setup-source", clientAddress(request.headers, request.socket.remoteAddress)));
  next();
}, async (request, response) => {
  const identity = fingerprint("setup-source", clientAddress(request.headers, request.socket.remoteAddress));
  const body = await readJson<Record<string, unknown>>(request, { maxBytes: 4096 });
  const lease = reserveLease("initialize", identity, "first-admin", 2, 1);
  if (!lease) { rejectBudget(response, "initialization_busy", 1, "初始化请求正在处理中，请稍后再试"); return; }
  try { ok(response, await initializeInstallation(body, { requestId: requestId(request), identityHash: identity })); }
  finally { releaseLease(lease); }
});

export const entrySettingsRouter = Router();
entrySettingsRouter.use("/entry-settings", requireAdmin, requireCsrf, requirePermission("system.admin.write"));
entrySettingsRouter.get("/entry-settings", (_request, response) => { ok(response, entrySettings()); });
entrySettingsRouter.patch("/entry-settings", requireSameOrigin, async (request, response) => {
  const body = await readJson<Record<string, unknown>>(request, { maxBytes: 1024 });
  ok(response, updateEntrySettings(body, { actorType: "admin", actor: request.admin!.admin.username, requestId: requestId(request) }));
});
