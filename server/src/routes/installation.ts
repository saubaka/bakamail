import { Router } from "express";
import { entrySettings, resolveAdminEntry, installationInitialized, initializeInstallation, updateEntrySettings } from "../admin/installation.ts";
import { requireAdmin, requireCsrf, requirePermission } from "../http/auth.ts";
import { requireSameOrigin } from "../security/origin.ts";
import { clientAddress, fingerprint } from "../security/identity.ts";
import { enforceBudget, reserveLease, releaseLease, rejectBudget } from "../security/abuse.ts";
import { ok, readJson, requestId } from "../http/kit.ts";

export const installationRouter = Router();
installationRouter.get("/installation", (request, response) => {
  const initialized = installationInitialized();
  const entry = initialized ? resolveAdminEntry(request.query.entry) : null;
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
