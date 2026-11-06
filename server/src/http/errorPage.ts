import type { Request, Response } from "express";
import { currentSeo } from "../admin/seo.ts";
import { renderErrorDocument } from "../../../shared/errorPage.ts";
import { requestId } from "./kit.ts";

export function wantsHtml(request: Pick<Request, "headers">): boolean {
  const destination = String(request.headers["sec-fetch-dest"] ?? "");
  if (destination) return destination === "document" || destination === "iframe";
  const accept = String(request.headers.accept ?? "");
  return /text\/html/i.test(accept);
}

export function sendErrorPage(request: Request, response: Response, status: number, extra: { retryAfter?: number } = {}): void {
  let siteName = "";
  try { siteName = currentSeo().effective.siteName; } catch { }
  if (extra.retryAfter) response.setHeader("retry-after", String(Math.ceil(extra.retryAfter)));
  response.status(status);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-robots-tag", "noindex, nofollow");
  response.type("html").send(renderErrorDocument({ status, siteName, requestId: requestId(request), retryAfter: extra.retryAfter }));
}
