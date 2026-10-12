import type { Request, Response } from "express";
import { currentSeo } from "../admin/seo.ts";
import { renderErrorDocument } from "../../../shared/errorPage.ts";
import { requestId } from "./kit.ts";

/** 浏览器地址栏打开的页面请求才返回网页；脚本、图片和接口请求仍返回简短纯文本或 JSON。 */
export function wantsHtml(request: Pick<Request, "headers">): boolean {
  const destination = String(request.headers["sec-fetch-dest"] ?? "");
  if (destination) return destination === "document" || destination === "iframe";
  const accept = String(request.headers.accept ?? "");
  return /text\/html/i.test(accept);
}

/**
 * 返回统一风格的错误页。不回显请求路径或任何用户输入，只带一个错误编号方便排查；
 * 不缓存，不收录。
 */
export function sendErrorPage(request: Request, response: Response, status: number, extra: { retryAfter?: number } = {}): void {
  let siteName = "";
  try { siteName = currentSeo().effective.siteName; } catch { /* 站点名读不到时不影响错误页 */ }
  if (extra.retryAfter) response.setHeader("retry-after", String(Math.ceil(extra.retryAfter)));
  response.status(status);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-robots-tag", "noindex, nofollow");
  response.type("html").send(renderErrorDocument({ status, siteName, requestId: requestId(request), retryAfter: extra.retryAfter }));
}
