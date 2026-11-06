import { reactive } from "vue";
import { SEO_DEFAULT_SITE_NAME, SEO_DEFAULT_TAGLINE, defaultDescription, defaultTitle, type SiteInfo } from "../../shared/seo.ts";

const fallback = (): SiteInfo => ({
  siteName: SEO_DEFAULT_SITE_NAME,
  tagline: SEO_DEFAULT_TAGLINE,
  title: defaultTitle(SEO_DEFAULT_SITE_NAME),
  description: defaultDescription(SEO_DEFAULT_SITE_NAME),
});

export const siteInfo = reactive<SiteInfo>(fallback());

function valid(value: unknown): value is SiteInfo {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["siteName", "tagline", "title", "description"].every((key) => typeof item[key] === "string" && (item[key] as string).length > 0);
}

export function applySiteInfo(value: unknown): boolean {
  if (!valid(value)) return false;
  siteInfo.siteName = value.siteName;
  siteInfo.tagline = value.tagline;
  siteInfo.title = value.title;
  siteInfo.description = value.description;
  return true;
}

export function readInjectedSiteInfo(doc: Pick<Document, "getElementById"> = document): boolean {
  const node = doc.getElementById("bm-site");
  if (!node?.textContent) return false;
  try { return applySiteInfo(JSON.parse(node.textContent)); } catch { return false; }
}

export async function refreshSiteInfo(): Promise<boolean> {
  try {
    const response = await fetch("/api/site-info", { headers: { accept: "application/json" }, credentials: "same-origin" });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: boolean; data?: unknown };
    return body.ok === true && applySiteInfo(body.data);
  } catch { return false; }
}

export function pageTitleFor(routeName: unknown): string {
  return routeName === "intro" ? siteInfo.title : siteInfo.siteName;
}

export function initializeSiteInfo(): void {
  if (!readInjectedSiteInfo()) void refreshSiteInfo().then((applied) => { if (applied && typeof document !== "undefined") document.title = siteInfo.siteName; });
}
