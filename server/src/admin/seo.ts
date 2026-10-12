import { config } from "../config.ts";
import { db, getSetting, nowIso, setSetting } from "../db.ts";
import { recordAudit } from "../security/audit.ts";
import {
  VERIFICATION_KEYS, defaultSeoConfig, evaluateSeo, normalizeOrigin, parseSeoConfig, resolveSeo,
  type SeoConfig, type SeoEffective, type SeoReport,
} from "../../../shared/seo.ts";

/** 站点 SEO 配置存在 app_settings 的 seo 一项里（JSON）。读取永远不会失败：损坏或缺失时按默认值提供页面。 */
const KEY = "seo";

export type SeoStored = { config: SeoConfig; revision: number; updatedAt: string };

export class SeoConflictError extends Error {
  constructor() { super("SEO 设置已被其他管理员修改，请重新读取后再保存"); this.name = "SeoConflictError"; }
}

export function readSeo(): SeoStored {
  const fresh = { config: defaultSeoConfig(), revision: 0, updatedAt: "" };
  const raw = getSetting(KEY, "");
  if (!raw) return fresh;
  try {
    const value = JSON.parse(raw) as { config?: unknown; revision?: unknown; updatedAt?: unknown };
    const revision = Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 ? (value.revision as number) : 0;
    const parsed = parseSeoConfig(value.config);
    return {
      config: parsed.ok ? parsed.config : defaultSeoConfig(),
      revision,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
  } catch { return fresh; }
}

/** 最终采用的规范网址：先看后台设置，再看服务器环境里的 PUBLIC_ORIGIN。 */
export function resolveOrigin(stored: SeoConfig = readSeo().config): { value: string; source: "setting" | "env" | "none" } {
  if (stored.canonicalOrigin) return { value: stored.canonicalOrigin, source: "setting" };
  const env = normalizeOrigin(config.publicOrigin);
  if (env.ok && env.origin) return { value: env.origin, source: "env" };
  return { value: "", source: "none" };
}

export function currentSeo(): { stored: SeoStored; origin: ReturnType<typeof resolveOrigin>; effective: SeoEffective } {
  const stored = readSeo();
  const origin = resolveOrigin(stored.config);
  return { stored, origin, effective: resolveSeo(stored.config, origin.value) };
}

export type SeoView = {
  config: SeoConfig; revision: number; updatedAt: string;
  origin: ReturnType<typeof resolveOrigin>;
  /** 服务器环境里 PUBLIC_ORIGIN 规范化后的值；后台清空“规范网址”后就会回到它。 */
  envOrigin: string;
  effective: SeoEffective; report: SeoReport;
};

function envOrigin(): string {
  const env = normalizeOrigin(config.publicOrigin);
  return env.ok ? env.origin : "";
}

export function seoView(): SeoView {
  const { stored, origin, effective } = currentSeo();
  return { config: stored.config, revision: stored.revision, updatedAt: stored.updatedAt, origin, envOrigin: envOrigin(), effective, report: evaluateSeo(stored.config, origin.value) };
}

function changedKeys(before: SeoConfig, after: SeoConfig): string[] {
  const names: string[] = [];
  for (const key of Object.keys(before) as (keyof SeoConfig)[]) {
    if (key === "verification") {
      for (const sub of VERIFICATION_KEYS) if (before.verification[sub] !== after.verification[sub]) names.push(`verification.${sub}`);
    } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) names.push(key);
  }
  return names;
}

/** revision 必须等于当前值才能写入；读取、比较、写入和审计在同一个事务里。 */
export function writeSeo(next: SeoConfig, expectedRevision: number | null, actor: { name: string; requestId: string }, action = "seo.update"): SeoStored {
  db.exec("begin immediate");
  try {
    const current = readSeo();
    if (expectedRevision !== null && expectedRevision !== current.revision) throw new SeoConflictError();
    const changes = changedKeys(current.config, next);
    const stored: SeoStored = { config: next, revision: current.revision + 1, updatedAt: nowIso() };
    setSetting(KEY, JSON.stringify(stored));
    recordAudit({
      actorType: "admin", actor: actor.name, action, targetType: "seo", requestId: actor.requestId,
      summary: changes.length ? `修改：${changes.join("、")}` : "保存（无变化）",
    });
    db.exec("commit");
    return stored;
  } catch (error) { db.exec("rollback"); throw error; }
}
