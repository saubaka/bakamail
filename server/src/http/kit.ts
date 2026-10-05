import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";

export type Json = Record<string, unknown> | unknown[] | null;

export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

export function ok(response: ServerResponse, data: unknown = {}): void {
  sendJson(response, 200, { ok: true, data, error: "" });
}

export function fail(response: ServerResponse, status: number, error: string): void {
  sendJson(response, status, { ok: false, data: null, error });
}

export function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key && value.length <= 512) {
      try { out[key] = decodeURIComponent(value); } catch { /* malformed cookies are unauthenticated */ }
    }
  }
  return out;
}

export type CookieOptions = {
  maxAgeSeconds?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
};

export function buildCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false && config.cookieSecure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

/** 会话 Cookie 的属性只在这里定义一次。 */
export function sessionCookie(
  name: string,
  token: string,
  maxAgeSeconds: number,
  path = "/",
): string {
  return buildCookie(name, token, { maxAgeSeconds, path, httpOnly: true, sameSite: "Lax" });
}

export function appendCookie(response: ServerResponse, cookie: string): void {
  const existing = response.getHeader("set-cookie");
  if (!existing) response.setHeader("set-cookie", [cookie]);
  else if (Array.isArray(existing)) response.setHeader("set-cookie", [...existing, cookie]);
  else response.setHeader("set-cookie", [String(existing), cookie]);
}

export function clearCookie(response: ServerResponse, name: string, path = "/"): void {
  appendCookie(
    response,
    buildCookie(name, "", { path, maxAgeSeconds: 0, httpOnly: true, sameSite: "Lax" }),
  );
}

export const FORM_BODY_LIMIT = 64 * 1024;
// Base64 attachments need more space than the decoded 32 MiB mail limit.
export const MAIL_BODY_LIMIT = 48 * 1024 * 1024;

export class RequestBodyError extends Error {
  readonly status: 400 | 413 | 415;
  readonly code: string;
  readonly closeConnection: boolean;
  constructor(
    status: 400 | 413 | 415,
    code: string,
    message: string,
    closeConnection = false,
  ) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
    this.code = code;
    this.closeConnection = closeConnection;
  }
}

export async function readJson<T = Record<string, unknown>>(
  request: IncomingMessage,
  options: { maxBytes?: number } = {},
): Promise<T> {
  const limit = options.maxBytes ?? FORM_BODY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAIL_BODY_LIMIT) {
    throw new RangeError("请求体额度配置不合法");
  }
  const tooLarge = () => {
    request.pause();
    return new RequestBodyError(413, "payload_too_large", "请求内容过大，请减少附件或表单内容", true);
  };
  const declaredSize = request.headers["content-length"];
  if (typeof declaredSize === "string" && Number(declaredSize) > limit) throw tooLarge();

  const chunks: Buffer[] = [];
  let size = 0;
  // The default async iterator destroys the request on early exit, losing the 413 response.
  // Keep it alive until the error boundary flushes its response and closes the connection.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.length;
    if (size > limit) throw tooLarge();
    if (buffer.length > 0 && size === buffer.length) {
      const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
      const charset = contentType.match(/(?:^|;)\s*charset\s*=\s*"?([^;"\s]+)"?/i)?.[1];
      const encoding = String(request.headers["content-encoding"] ?? "identity").trim().toLowerCase();
      if (contentType.split(";")[0]?.trim() !== "application/json"
        || (charset !== undefined && charset !== "utf-8" && charset !== "utf8")
        || encoding !== "identity") {
        request.pause();
        throw new RequestBodyError(415, "unsupported_body_type", "请求内容必须是 UTF-8 JSON，不支持压缩请求体", true);
      }
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)).trim();
  } catch {
    throw new RequestBodyError(400, "invalid_json", "请求内容不是有效的 UTF-8 JSON");
  }
  if (!raw) return {} as T;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestBodyError(400, "invalid_json", "请求 JSON 格式不正确");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestBodyError(400, "invalid_body", "请求 JSON 必须是对象");
  }
  return value as T;
}

const requestIds = new WeakMap<IncomingMessage, string>();
export function requestId(request: IncomingMessage): string {
  const existing = requestIds.get(request);
  if (existing) return existing;
  const header = request.headers["x-request-id"];
  const id = typeof header === "string" && /^[a-zA-Z0-9._:-]{1,64}$/.test(header)
    ? header : randomUUID();
  requestIds.set(request, id);
  return id;
}

export function headerString(request: IncomingMessage, key: string): string {
  const value = request.headers[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}
