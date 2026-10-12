import { Router } from "express";
import { SeoConflictError, seoView, writeSeo } from "../admin/seo.ts";
import { fail, ok, readJson, requestId } from "../http/kit.ts";
import { requirePermission } from "../http/auth.ts";
import { defaultSeoConfig, parseSeoConfig } from "../../../shared/seo.ts";

/** 站点 SEO 管理。挂在后台路由的 requireAdmin + requireCsrf 之后，读写都需要 system.seo.write。 */
export const seoRouter = Router();
const guard = requirePermission("system.seo.write");

seoRouter.get("/seo", guard, (_request, response) => { ok(response, seoView()); });

seoRouter.put("/seo", guard, async (request, response) => {
  const body = await readJson<Record<string, unknown>>(request, { maxBytes: 16384 });
  if (!body || typeof body !== "object" || Array.isArray(body)) { fail(response, 400, "SEO 设置格式不对"); return; }
  const { revision, ...rest } = body;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) { fail(response, 400, "缺少设置版本号，请刷新页面后重试"); return; }
  const parsed = parseSeoConfig(rest);
  if (!parsed.ok) { fail(response, 400, parsed.message); return; }
  try {
    writeSeo(parsed.config, revision, { name: request.admin!.admin.username, requestId: requestId(request) });
  } catch (error) {
    if (error instanceof SeoConflictError) { fail(response, 409, error.message); return; }
    throw error;
  }
  ok(response, seoView());
});

/** 恢复默认：站点名回到 Baka Mail，其余全部回到自动。不要求版本号，因为这是明确的整体重置。 */
seoRouter.delete("/seo", guard, (request, response) => {
  writeSeo(defaultSeoConfig(), null, { name: request.admin!.admin.username, requestId: requestId(request) }, "seo.reset");
  ok(response, seoView());
});
