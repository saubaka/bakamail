export type ApiResult<T> =
  | { ok: true; data: T; error: "" }
  | { ok: false; data: unknown; error: string; code?: string };

type ErrorDetails = { code?: string; requestId?: string; retryAfterSeconds?: number };

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly code: string;
  readonly requestId: string;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number, data: unknown, details: ErrorDetails = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.code = details.code ?? (status === 0 ? "network_error" : "http_error");
    this.requestId = details.requestId ?? "";
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
  }
}

type ApiOptions = { method?: string; body?: unknown; signal?: AbortSignal };
export type UploadProgress = { phase: "uploading" | "awaiting-response"; loaded: number; total: number | null };
type UploadOptions = { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void };
export type QueryValue = string | number | boolean | null | undefined;

/** A query is data, never a path fragment. Preserve 0/false and omit only absent values. */
export function apiQuery(path: string, values: Record<string, QueryValue>): string {
  assertApiPath(path);
  if (path.includes("?")) throw new TypeError("查询参数必须由统一编码器生成");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (!["string", "number", "boolean"].includes(typeof value)
      || (typeof value === "number" && !Number.isFinite(value))) throw new TypeError("查询参数格式不正确");
    query.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}
const csrfTokens = { mail: "", admin: "" };
const apiBase = "https://bakamail.invalid";

export function setCsrfToken(token: string, scope: "mail" | "admin" = "mail"): void {
  csrfTokens[scope] = token;
}

/** Reject URLs that could leave this origin or normalize outside /api/*. */
export function assertApiPath(path: string): void {
  if (!path.startsWith("/api/") || path.startsWith("//") || path.includes("\\") || path.includes("#")) {
    throw new TypeError("浏览器请求只能使用同源 /api/* 路径");
  }
  const parsed = new URL(path, apiBase);
  if (parsed.origin !== apiBase || !parsed.pathname.startsWith("/api/") || parsed.pathname === "/api/") {
    throw new TypeError("浏览器请求只能使用同源 /api/* 路径");
  }
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function requestHeaders(path: string, method: string, hasBody: boolean, requestId: string): Record<string, string> {
  const headers: Record<string, string> = { "x-request-id": requestId };
  if (hasBody) headers["content-type"] = "application/json";
  const csrfToken = path.startsWith("/api/admin/") ? csrfTokens.admin : csrfTokens.mail;
  if (csrfToken && method !== "GET" && method !== "HEAD") headers["x-csrf-token"] = csrfToken;
  return headers;
}

function responseDetails(response: Response, requestId: string, code?: string): ErrorDetails {
  const seconds = Number(response.headers.get("retry-after"));
  return {
    code,
    requestId: response.headers.get("x-request-id") || requestId,
    retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
  };
}

async function request(path: string, options: ApiOptions = {}): Promise<{ response: Response; requestId: string }> {
  assertApiPath(path);
  const method = (options.method ?? "GET").toUpperCase();
  if ((method === "GET" || method === "HEAD") && options.body !== undefined) {
    throw new TypeError(`${method} 请求不能包含请求体`);
  }
  const requestId = newRequestId();
  const headers = requestHeaders(path, method, options.body !== undefined, requestId);
  try {
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { response, requestId };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError("网络连接失败，请稍后重试", 0, null, { code: "network_error", requestId });
  }
}

async function readEnvelope<T>(response: Response, requestId: string): Promise<ApiResult<T>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`服务返回了非 JSON 响应（HTTP ${response.status}）`, response.status, null,
      responseDetails(response, requestId, "invalid_response"));
  }
  if (!payload || typeof payload !== "object" || !("ok" in payload) ||
      typeof payload.ok !== "boolean" || !("data" in payload) ||
      !("error" in payload) || typeof payload.error !== "string") {
    throw new ApiError(`服务响应格式不正确（HTTP ${response.status}）`, response.status, null,
      responseDetails(response, requestId, "invalid_response"));
  }
  return payload as ApiResult<T>;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { response, requestId } = await request(path, options);
  const payload = await readEnvelope<T>(response, requestId);
  if (!response.ok || !payload.ok) {
    throw new ApiError(payload.error || `请求失败（HTTP ${response.status}）`, response.status, payload.data,
      responseDetails(response, requestId, !payload.ok ? payload.code : undefined));
  }
  return payload.data;
}

/** Progress transport is only enabled with an explicitly enforced same-origin connect policy. */
function canObserveUpload(): boolean {
  if (typeof XMLHttpRequest === "undefined" || typeof document === "undefined" || typeof location === "undefined") return false;
  const policy = document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content ?? "";
  const directive = policy.split(";").map(value => value.trim().split(/\s+/))
    .find(tokens => tokens[0]?.toLowerCase() === "connect-src");
  return directive?.length === 2 && directive[1] === "'self'";
}

/** Observes request-body transmission, not mail delivery. Never retries a POST. */
export async function apiUpload<T>(path: string, body: unknown, options: UploadOptions = {}): Promise<T> {
  assertApiPath(path);
  const notify = (value: UploadProgress) => {
    try { options.onProgress?.(value); } catch { /* UI observers cannot change a network result. */ }
  };
  if (!canObserveUpload()) {
    notify({ phase: "uploading", loaded: 0, total: null });
    // Keep redirect:error and honest indeterminate progress in non-browser/unsupported environments.
    const { response, requestId } = await request(path, { method: "POST", body, signal: options.signal });
    const payload = await readEnvelope<T>(response, requestId);
    if (!response.ok || !payload.ok) throw new ApiError(payload.error || `请求失败（HTTP ${response.status}）`, response.status, payload.data,
      responseDetails(response, requestId, !payload.ok ? payload.code : undefined));
    return payload.data;
  }
  // Serialization is done before creating a request: cyclic/invalid bodies never start uploading.
  const serialized = JSON.stringify(body);
  const requestId = newRequestId();
  const expectedUrl = new URL(path, location.origin).href;
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let last: UploadProgress = { phase: "uploading", loaded: 0, total: null };
    const cleanup = () => {
      options.signal?.removeEventListener("abort", cancel);
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      xhr.upload.onprogress = xhr.upload.onload = null;
    };
    const fail = (error: unknown, abort = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (abort) { try { xhr.abort(); } catch { /* Preserve the original terminal outcome. */ } }
      reject(error);
    };
    const uncertain = (message: string, code: string) => new ApiError(message, 0, null, { code, requestId });
    const cancel = () => fail(uncertain("发送连接已中断，结果尚未确认；请先核对发送记录，勿直接重发。", "upload_aborted"), true);
    const progress = (event: ProgressEvent, phase: UploadProgress["phase"]) => {
      if (settled) return;
      const total = event.lengthComputable && Number.isFinite(event.total) && event.total > 0 ? event.total : null;
      const loaded = Number.isFinite(event.loaded) && event.loaded >= 0 ? event.loaded : last.loaded;
      last = { phase, loaded: total === null ? loaded : Math.min(loaded, total), total };
      notify(last);
    };
    xhr.upload.onprogress = event => progress(event, "uploading");
    // Upload load (not loadend) is successful transmission; errors must never announce completion.
    xhr.upload.onload = event => progress(event, "awaiting-response");
    xhr.onerror = () => fail(uncertain("网络连接中断，发送结果未确认；请先核对发送记录，勿直接重发。", "upload_network_error"));
    xhr.ontimeout = () => fail(uncertain("请求超时，发送结果未确认；请先核对发送记录，勿直接重发。", "upload_timeout"));
    xhr.onabort = () => fail(uncertain("发送连接已中断，结果未确认；请先核对发送记录，勿直接重发。", "upload_aborted"));
    xhr.onload = () => {
      if (settled) return;
      if (xhr.responseURL !== expectedUrl) {
        fail(uncertain("接口地址发生变化，发送结果未确认；请先核对发送记录。", "unexpected_redirect"));
        return;
      }
      if (xhr.status < 200 || xhr.status > 599) {
        fail(uncertain("没有收到有效回复，发送结果未确认；请先核对发送记录。", "upload_network_error"));
        return;
      }
      // A server may reject before reading the body. Only upload.onload proves transmission completed.
      settled = true;
      cleanup();
      try {
      const headers = new Headers();
      for (const name of ["retry-after", "x-request-id", "content-type"]) {
        const value = xhr.getResponseHeader(name);
        if (value) headers.set(name, value);
      }
      const response = new Response(xhr.responseText || null, { status: xhr.status, headers });
      void readEnvelope<T>(response, requestId).then(payload => {
        if (!response.ok || !payload.ok) throw new ApiError(payload.error || `请求失败（HTTP ${response.status}）`, response.status, payload.data,
          responseDetails(response, requestId, !payload.ok ? payload.code : undefined));
        resolve(payload.data);
      }).catch(reject);
      } catch {
        reject(new ApiError("服务回复格式无效，发送结果未确认。", xhr.status, null, { code: "invalid_response", requestId }));
      }
    };
    try {
      if (options.signal?.aborted) { cancel(); return; }
      xhr.open("POST", path, true);
      xhr.timeout = 180_000;
      xhr.withCredentials = false; // Same-origin cookies still apply; do not opt into cross-origin credentials.
      for (const [name, value] of Object.entries(requestHeaders(path, "POST", true, requestId))) xhr.setRequestHeader(name, value);
      xhr.setRequestHeader("cache-control", "no-cache");
      options.signal?.addEventListener("abort", cancel, { once: true });
      notify(last);
      xhr.send(serialized);
    } catch (error) { fail(error, true); }
  });
}

/** Files use the same same-origin and request-id contract as JSON APIs. */
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string; generatedAt: string | null }> {
  const { response, requestId } = await request(path);
  if (!response.ok) {
    const payload = await readEnvelope<unknown>(response, requestId);
    throw new ApiError(payload.error || `下载失败（HTTP ${response.status}）`, response.status, payload.data,
      responseDetails(response, requestId, !payload.ok ? payload.code : undefined));
  }
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    throw new ApiError("服务返回了网页，未生成可下载文件", response.status, null,
      responseDetails(response, requestId, "invalid_response"));
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const rawName = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? "bakamail-backup.json";
  const filename = rawName.replaceAll("\\", "/").split("/").pop() || "bakamail-backup.json";
  return { blob: await response.blob(), filename, generatedAt: response.headers.get("x-backup-generated-at") };
}
