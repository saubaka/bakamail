import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, apiUpload, setCsrfToken, type UploadProgress } from "../src/api/client.ts";
import { createPinia, setActivePinia } from "pinia";
import { useComposeStore } from "../src/stores/compose.ts";
import { sendMessage } from "../src/api/mail.ts";

class FakeXHR {
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null, onload: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null; onabort: (() => void) | null = null;
  timeout = 0; withCredentials = true; status = 200;
  responseURL = "https://mail.test/api/messages";
  responseText = JSON.stringify({ ok: true, data: { accepted: true }, error: "" });
  responseHeaders = new Map<string, string>();
  headers = new Map<string, string>(); opens: unknown[][] = []; bodies: unknown[] = []; aborts = 0;
  open(...args: unknown[]) { this.opens.push(args); }
  setRequestHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
  getResponseHeader(name: string) { return this.responseHeaders.get(name.toLowerCase()) ?? null; }
  send(body: unknown) { this.bodies.push(body); }
  abort() { this.aborts += 1; this.onabort?.(); }
  progress(loaded: number, total: number, lengthComputable = true) { this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent); }
  uploaded(loaded: number, total: number, lengthComputable = true) { this.upload.onload?.({ loaded, total, lengthComputable } as ProgressEvent); }
}

async function environment(run: (instances: FakeXHR[], policy: { content: string }) => Promise<void>) {
  const descriptors = new Map(["XMLHttpRequest", "document", "location"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const instances: FakeXHR[] = []; const policy = { content: "connect-src 'self'" };
  class Constructor extends FakeXHR { constructor() { super(); instances.push(this); } }
  for (const [name, value] of [["XMLHttpRequest", Constructor], ["document", { querySelector: () => policy }], ["location", { origin: "https://mail.test" }]] as const) {
    Object.defineProperty(globalThis, name, { value, configurable: true });
  }
  try { await run(instances, policy); }
  finally { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } setCsrfToken(""); setCsrfToken("", "admin"); }
}

test("真实上传事件更新进度，100%/upload load 不代表接口成功，最终 JSON 才确认", async () => environment(async instances => {
  const progress: UploadProgress[] = []; let resolved = false;
  setCsrfToken("mail-csrf"); const controller = new AbortController();
  const pending = apiUpload<{ accepted: boolean }>("/api/messages", { text: "中文", attachments: [] }, { signal: controller.signal, onProgress: value => progress.push(value) }).then(value => { resolved = true; return value; });
  const xhr = instances[0]!;
  assert.deepEqual(xhr.opens, [["POST", "/api/messages", true]]);
  assert.equal(xhr.timeout, 180000); assert.equal(xhr.withCredentials, false);
  assert.equal(xhr.headers.get("x-csrf-token"), "mail-csrf"); assert.ok(xhr.headers.get("x-request-id"));
  assert.equal(xhr.headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(xhr.bodies[0])), { text: "中文", attachments: [] });
  xhr.progress(25, 100); assert.deepEqual(progress.at(-1), { phase: "uploading", loaded: 25, total: 100 });
  xhr.progress(100, 100); xhr.uploaded(100, 100);
  assert.deepEqual(progress.at(-1), { phase: "awaiting-response", loaded: 100, total: 100 });
  await Promise.resolve(); assert.equal(resolved, false);
  const oldProgress = xhr.upload.onprogress!; xhr.onload?.();
  assert.deepEqual(await pending, { accepted: true });
  const events = progress.length; oldProgress({ loaded: 5, total: 100, lengthComputable: true } as ProgressEvent);
  assert.equal(progress.length, events); assert.equal(xhr.upload.onprogress, null);
  controller.abort(); assert.equal(xhr.aborts, 0);
}));

test("总量不可计算不制造百分比；超出总量的进度被限制，观察回调抛错不影响结果", async () => environment(async instances => {
  const values: UploadProgress[] = [];
  const pending = apiUpload("/api/messages", {}, { onProgress: value => { values.push(value); if (value.loaded > 0) throw new Error("UI failed"); } });
  const xhr = instances[0]!; xhr.progress(12, 99, false);
  assert.deepEqual(values.at(-1), { phase: "uploading", loaded: 12, total: null });
  xhr.progress(200, 100); assert.equal(values.at(-1)?.loaded, 100);
  xhr.onload?.(); await pending;
}));

test("上传错误保留结构化 HTTP 字段、关联编号和限流等待，不被 100% 伪装成成功", async () => environment(async instances => {
  setCsrfToken("admin-token", "admin");
  const pending = apiUpload("/api/admin/example", {});
  const xhr = instances[0]!; xhr.responseURL = "https://mail.test/api/admin/example";
  assert.equal(xhr.headers.get("x-csrf-token"), "admin-token");
  xhr.uploaded(100, 100); xhr.status = 429;
  xhr.responseText = JSON.stringify({ ok: false, data: { fieldErrors: { to: "错误" } }, error: "请等待", code: "rate_limited" });
  xhr.responseHeaders.set("retry-after", "30"); xhr.responseHeaders.set("x-request-id", "server-id");
  xhr.onload?.();
  await assert.rejects(pending, error => {
    assert.ok(error instanceof ApiError); assert.equal(error.status, 429); assert.equal(error.code, "rate_limited");
    assert.equal(error.retryAfterSeconds, 30); assert.equal(error.requestId, "server-id");
    assert.deepEqual(error.data, { fieldErrors: { to: "错误" } }); return true;
  });
}));

test("服务器提前拒绝时不伪造上传结束阶段", async () => environment(async instances => {
  const values: UploadProgress[] = [];
  const pending = apiUpload("/api/messages", {}, { onProgress: value => values.push(value) });
  const xhr = instances[0]!; xhr.status = 401;
  xhr.responseText = JSON.stringify({ ok: false, data: null, error: "未登录" }); xhr.onload?.();
  await assert.rejects(pending, error => error instanceof ApiError && error.status === 401);
  assert.ok(values.every(value => value.phase === "uploading"));
}));

test("超时、网络中断及取消不自动重试，全部清理事件并明确结果未确认", async () => environment(async instances => {
  for (const [event, code] of [["ontimeout", "upload_timeout"], ["onerror", "upload_network_error"], ["onabort", "upload_aborted"]] as const) {
    const pending = apiUpload("/api/messages", {}); const xhr = instances.at(-1)!;
    xhr[event]?.(); await assert.rejects(pending, error => error instanceof ApiError && error.code === code && /未确认/.test(error.message));
    assert.equal(xhr.onload, null); assert.equal(xhr.upload.onload, null); assert.equal(xhr.bodies.length, 1);
  }
  const controller = new AbortController(); const pending = apiUpload("/api/messages", {}, { signal: controller.signal });
  const xhr = instances.at(-1)!; controller.abort();
  await assert.rejects(pending, error => error instanceof ApiError && error.code === "upload_aborted");
  assert.equal(xhr.aborts, 1); assert.equal(xhr.bodies.length, 1);
  const preCanceled = new AbortController(); preCanceled.abort();
  await assert.rejects(apiUpload("/api/messages", {}, { signal: preCanceled.signal }));
  assert.equal(instances.at(-1)?.bodies.length, 0);
}));

test("重定向和非 JSON/无效信封均拒绝确认发送，不读取外部响应为成功", async () => environment(async instances => {
  for (const destination of ["https://other.test/api/messages", "https://mail.test/elsewhere", "https://mail.test/api/another"]) {
    const pending = apiUpload("/api/messages", {}); const xhr = instances.at(-1)!;
    xhr.responseURL = destination; xhr.onload?.();
    await assert.rejects(pending, error => error instanceof ApiError && error.code === "unexpected_redirect");
  }
  for (const payload of ["<html>bad gateway</html>", JSON.stringify({ ok: true, data: {} })]) {
    const pending = apiUpload("/api/messages", {}); const xhr = instances.at(-1)!; xhr.responseText = payload; xhr.onload?.();
    await assert.rejects(pending, error => error instanceof ApiError && error.code === "invalid_response");
  }
}));

test("无仅同源策略时不启用 XHR；回退仍拒绝重定向并只给不可计算进度", async () => environment(async (instances, policy) => {
  const original = globalThis.fetch; const values: UploadProgress[] = [];
  globalThis.fetch = async (_path, options) => {
    assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "same-origin");
    return Response.json({ ok: true, data: { saved: true }, error: "" });
  };
  try {
    for (const content of ["", "connect-src *", "connect-src *; connect-src 'self'", "connect-src 'self' https://other.test"]) {
      policy.content = content; assert.deepEqual(await apiUpload("/api/messages", {}, { onProgress: value => values.push(value) }), { saved: true });
    }
    assert.equal(instances.length, 0); assert.ok(values.every(value => value.total === null));
  } finally { globalThis.fetch = original; }
}));

test("非法路径或循环正文在创建 XHR 前拒绝，不能离开同源 API", async () => environment(async instances => {
  for (const path of ["https://other.test/api/messages", "//other.test/api/messages", "/api/../login", "/api\\messages"]) {
    await assert.rejects(apiUpload(path, {}), TypeError);
  }
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  await assert.rejects(apiUpload("/api/messages", cyclic), TypeError);
  assert.equal(instances.length, 0);
}));

test("撰写进度到 100% 后仍锁定发送，最终确认后才关闭并清空进度", async () => environment(async instances => {
  setActivePinia(createPinia()); const store = useComposeStore(); store.bindOwner("qa@example.test"); store.open(); store.compose.text = "测试内容";
  try {
    const pending = store.send(); const xhr = instances[0]!;
    xhr.progress(30, 100); assert.deepEqual(store.sendProgress, { phase: "uploading", loaded: 30, total: 100 });
    xhr.uploaded(100, 100); await Promise.resolve();
    assert.equal(store.sending, true); assert.equal(store.isOpen, true); assert.equal(await store.send(), null);
    xhr.responseText = JSON.stringify({ ok: true, data: { messageId: "mock-only", savedToSent: true }, error: "" }); xhr.onload?.();
    assert.ok(await pending); assert.equal(store.sending, false); assert.equal(store.isOpen, false); assert.equal(store.sendProgress, null);
  } finally { store.clear(); }
}));

test("旧账号上传事件与回复不能修改新邮件的进度或关闭新窗口", async () => environment(async instances => {
  setActivePinia(createPinia()); const store = useComposeStore(); store.bindOwner("first@example.test"); store.open();
  try {
    const old = store.send(); const first = instances[0]!;
    store.bindOwner("second@example.test"); store.open(); const fresh = store.send(); const second = instances[1]!;
    second.progress(12, 100); first.progress(90, 100); first.uploaded(100, 100);
    assert.deepEqual(store.sendProgress, { phase: "uploading", loaded: 12, total: 100 });
    first.responseText = JSON.stringify({ ok: true, data: { messageId: "old", savedToSent: true }, error: "" }); first.onload?.();
    assert.equal(await old, null); assert.equal(store.isOpen, true); assert.equal(store.sending, true);
    second.responseText = JSON.stringify({ ok: true, data: { messageId: "new", savedToSent: true }, error: "" }); second.onload?.();
    assert.ok(await fresh);
  } finally { store.clear(); }
}));

test("断线结果未确认禁止直接重发，保存/重新打开草稿保留警告，显式解锁后才允许重试", async () => environment(async instances => {
  const original = globalThis.fetch;
  setActivePinia(createPinia()); const store = useComposeStore(); store.bindOwner("qa@example.test"); store.open(); store.compose.text = "保留正文";
  let payload: Record<string, unknown> = {};
  globalThis.fetch = async (path, options) => {
    if (options?.method === "POST") { payload = JSON.parse(String(options.body)).payload; return Response.json({ ok: true, data: { id: "uncertain" }, error: "" }); }
    return Response.json({ ok: true, data: String(path) === "/api/drafts" ? { drafts: [{ id: "uncertain", ...payload }] } : {}, error: "" });
  };
  try {
    const first = store.send(); const xhr = instances[0]!; xhr.uploaded(100, 100); xhr.onerror?.();
    assert.equal(await first, null); assert.equal(store.deliveryUnconfirmed, true); assert.equal(store.compose.text, "保留正文");
    assert.equal(await store.send(), null); assert.equal(instances.length, 1);
    assert.equal(await store.persistDraft(), true); assert.equal(payload.deliveryUnconfirmed, true);
    store.finishClose(); assert.equal(await store.openDraft("uncertain"), true);
    assert.equal(store.deliveryUnconfirmed, true); assert.match(store.hint, /未确认/); assert.equal(await store.send(), null);
    store.allowSendRetry(); assert.equal(store.deliveryUnconfirmed, false);
    const second = store.send(); const retry = instances[1]!;
    retry.responseText = JSON.stringify({ ok: true, data: { messageId: "retry", savedToSent: true }, error: "" }); retry.onload?.();
    assert.ok(await second); assert.equal(store.isOpen, false);
  } finally { store.clear(); globalThis.fetch = original; }
}));

test("JSON 信封成功但缺少发送确认字段时仍视为未知结果，不冒充已发送", async () => environment(async instances => {
  const pending = sendMessage({ to: "qa@example.test", text: "x", subject: "x" }); const xhr = instances[0]!;
  xhr.onload?.(); await assert.rejects(pending, error => error instanceof ApiError && error.code === "invalid_response");
}));
