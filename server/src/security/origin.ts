import type { Request, Response, NextFunction } from "express";
import { config } from "../config.ts";
import { sendJson } from "../http/kit.ts";

/** Browser login/registration CSRF boundary. Non-browser clients with no Origin remain rate-limited. */
export function requireSameOrigin(request: Request, response: Response, next: NextFunction): void {
  const origin = request.headers.origin;
  const expected = config.publicOrigin || `${request.protocol}://${request.get("host")}`;
  if (request.headers["sec-fetch-site"] === "cross-site" || origin !== undefined && origin !== expected) {
    sendJson(response, 403, { ok: false, code: "origin_rejected", data: null, error: "请从本站页面提交请求" }); return;
  }
  next();
}
