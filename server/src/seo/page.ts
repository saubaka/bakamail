import type { Request, Response } from "express";
import { currentSeo } from "../admin/seo.ts";
import {
  escapeHtml, renderHomeHead, renderNoscript, renderPrivateHead, renderRobotsTxt, renderSitemapXml, safeJson, siteInfoOf,
} from "../../../shared/seo.ts";
import { renderLoadFailureTemplate, renderNoscriptRequired } from "../../../shared/errorPage.ts";

export function renderSpaPage(html: string, request: Pick<Request, "path">, response: Pick<Response, "setHeader">): string {
  const { effective } = currentSeo();
  const home = request.path === "/";
  const indexable = home && effective.indexHome;
  const title = home ? effective.title : effective.siteName;
  const head = home ? renderHomeHead(effective) : renderPrivateHead(effective);
  if (!indexable) response.setHeader("x-robots-tag", "noindex, nofollow");

  const info = `<script id="bm-site" type="application/json">${safeJson(siteInfoOf(effective))}</script>`;
  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/\s*<meta name="robots"[^>]*>/, "")
    .replace(/\s*<meta name="theme-color"[^>]*>/, "")
    .replace("</head>", `    ${head}\n    ${info}\n${home ? "" : `    ${renderNoscriptRequired(new Date().getFullYear()).head}\n`}  </head>`);
  const year = new Date().getFullYear();
  const fallback = home ? renderNoscript(effective, year) : renderNoscriptRequired(year).body;
  out = out.replace('<div id="app"></div>', `${fallback}\n    ${renderLoadFailureTemplate(year)}\n    <div id="app"></div>`);
  return out;
}

export function robotsTxt(): string { return renderRobotsTxt(currentSeo().effective); }

export function sitemapXml(): string | null {
  const { effective, stored } = currentSeo();
  return renderSitemapXml(effective, stored.updatedAt);
}

export function publicSiteInfo() { return siteInfoOf(currentSeo().effective); }
