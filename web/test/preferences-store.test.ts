import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { DEFAULT_MAIL_PREFERENCES, normalizeMailPreferences } from "../src/api/settings.ts";
import { usePreferenceStore } from "../src/stores/preferences.ts";
import { useSessionStore } from "../src/stores/session.ts";

const envelope = (data: unknown) => Response.json({ ok: true, data, error: "" });
const failure = (status = 503) => Response.json({ ok: false, data: null, error: "设置暂不可用" }, { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function setup(owner = "first@example.test") {
  setActivePinia(createPinia());
  const store = usePreferenceStore();
  store.bindOwner(owner);
  return store;
}

test("偏好在 API 边界白名单化，未设置或非法枚举只采用安全默认值", () => {
  assert.deepEqual(normalizeMailPreferences({}), DEFAULT_MAIL_PREFERENCES);
  assert.deepEqual(normalizeMailPreferences({ density: "compact", pageSize: "25", timeFormat: "12h",
    remoteImages: "allow", signature: "已确认", ignored: "not-shown" }),
  { density: "compact", pageSize: "25", timeFormat: "12h", remoteImages: "allow", signature: "已确认" });
  assert.deepEqual(normalizeMailPreferences({ density: "invalid", pageSize: "999", timeFormat: "other",
    remoteImages: "open", signature: "x".repeat(2100) }).signature.length, 2000);
  assert.equal(normalizeMailPreferences({ density: "invalid", pageSize: "999" }).pageSize, "50");
});

test("后发读取拥有结果和加载状态，先发迟到结果不能覆盖", async () => {
  const original = globalThis.fetch;
  const store = setup();
  const first = deferred<Response>(), second = deferred<Response>();
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? first.promise : second.promise);
  try {
    const old = store.load();
    const fresh = store.load();
    first.resolve(envelope({ settings: { pageSize: "25" } }));
    assert.equal(await old, false);
    assert.equal(store.loading, true);
    second.resolve(envelope({ settings: { pageSize: "100", density: "compact" } }));
    assert.equal(await fresh, true);
    assert.equal(store.settings.pageSize, "100");
    assert.equal(store.settings.density, "compact");
    assert.equal(store.loading, false);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("切换账号与同账号退出重入均作废迟到读取，不泄漏前账号偏好", async () => {
  const original = globalThis.fetch;
  const store = setup();
  const old = deferred<Response>(), fresh = deferred<Response>();
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? old.promise : fresh.promise);
  try {
    const first = store.load();
    store.bindOwner("second@example.test");
    assert.deepEqual(store.settings, DEFAULT_MAIL_PREFERENCES);
    const second = store.load();
    fresh.resolve(envelope({ settings: { signature: "第二账号签名", remoteImages: "block" } }));
    assert.equal(await second, true);
    old.resolve(envelope({ settings: { signature: "第一账号秘密签名" } }));
    assert.equal(await first, false);
    assert.equal(store.settings.signature, "第二账号签名");
    store.clear();
    store.bindOwner("second@example.test");
    assert.deepEqual(store.settings, DEFAULT_MAIL_PREFERENCES);
    assert.equal(store.loaded, false);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("保存前必须读到本人设置，重复保存不发第二次请求", async () => {
  const original = globalThis.fetch;
  const store = setup();
  let calls = 0;
  const saveResponse = deferred<Response>();
  globalThis.fetch = async (_path, options) => {
    calls += 1;
    if (options?.method === "PATCH") return saveResponse.promise;
    return envelope({ settings: { pageSize: "50" } });
  };
  try {
    await assert.rejects(store.save({ ...DEFAULT_MAIL_PREFERENCES }), /请先读取/);
    assert.equal(calls, 0);
    assert.equal(await store.load(), true);
    const first = store.save({ ...store.settings, pageSize: "25" });
    await assert.rejects(store.save({ ...store.settings, pageSize: "100" }), /正在保存/);
    assert.equal(calls, 2);
    saveResponse.resolve(envelope({ saved: true }));
    assert.equal(await first, true);
    assert.equal(store.settings.pageSize, "25");
  } finally { store.clear(); globalThis.fetch = original; }
});

test("确认写入按提交时快照更新共享偏好，旧 GET 和写入期间 GET 不覆盖它", async () => {
  const original = globalThis.fetch;
  const store = setup();
  const read = deferred<Response>(), save = deferred<Response>();
  let reads = 0, writes = 0;
  let sent: unknown;
  globalThis.fetch = async (_path, options) => {
    if (options?.method === "PATCH") { writes += 1; sent = JSON.parse(String(options.body)); return save.promise; }
    reads += 1;
    return reads === 1 ? envelope({ settings: { pageSize: "50" } }) : read.promise;
  };
  try {
    assert.equal(await store.load(), true);
    const stale = store.load();
    const input = { ...store.settings, pageSize: "25" as const, signature: "已提交签名" };
    const writing = store.save(input);
    input.signature = "提交后编辑";
    assert.equal(await store.load(), false);
    assert.equal(reads, 2);
    assert.equal(writes, 1);
    save.resolve(envelope({ saved: true }));
    assert.equal(await writing, true);
    read.resolve(envelope({ settings: { pageSize: "100", signature: "旧服务端读取" } }));
    assert.equal(await stale, false);
    assert.deepEqual(sent, { ...DEFAULT_MAIL_PREFERENCES, pageSize: "25", signature: "已提交签名" });
    assert.equal(store.settings.pageSize, "25");
    assert.equal(store.settings.signature, "已提交签名");
  } finally { store.clear(); globalThis.fetch = original; }
});

test("保存失败保留已确认偏好，未知成功信封不冒充已保存，允许重新读取核对", async () => {
  const original = globalThis.fetch;
  const store = setup();
  let mode = "read";
  globalThis.fetch = async (_path, options) => options?.method === "PATCH"
    ? mode === "failure" ? failure() : envelope({})
    : envelope({ settings: { pageSize: mode === "reread" ? "25" : "50" } });
  try {
    assert.equal(await store.load(), true);
    mode = "failure";
    await assert.rejects(store.save({ ...store.settings, pageSize: "25" }), /设置暂不可用/);
    assert.equal(store.settings.pageSize, "50");
    assert.equal(store.stale, true);
    await assert.rejects(store.save({ ...store.settings, pageSize: "100" }), /重新读取后再保存/);
    mode = "invalid";
    assert.equal(await store.load(), true);
    await assert.rejects(store.save({ ...store.settings, pageSize: "25" }), /未确认/);
    assert.equal(store.settings.pageSize, "50");
    assert.equal(store.stale, true);
    mode = "reread";
    assert.equal(await store.load(), true);
    assert.equal(store.settings.pageSize, "25");
    assert.equal(store.stale, false);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("读取 503 保留上次确认值并标过期；畸形成功数据不覆盖", async () => {
  const original = globalThis.fetch;
  const store = setup();
  let mode = "success";
  globalThis.fetch = async () => mode === "success" ? envelope({ settings: { signature: "已确认" } })
    : mode === "fault" ? failure() : envelope({ settings: null });
  try {
    assert.equal(await store.load(), true);
    mode = "fault";
    await assert.rejects(store.load(), /设置暂不可用/);
    assert.equal(store.settings.signature, "已确认");
    assert.equal(store.stale, true);
    assert.equal(store.loadError, "设置暂不可用");
    mode = "invalid";
    await assert.rejects(store.load(), /响应格式不正确/);
    assert.equal(store.settings.signature, "已确认");
  } finally { store.clear(); globalThis.fetch = original; }
});

test("保存中换账号作废旧确认，旧回复既不更新新账号也不释放新账号保存锁", async () => {
  const original = globalThis.fetch;
  const store = setup();
  const old = deferred<Response>(), fresh = deferred<Response>();
  let saves = 0;
  globalThis.fetch = async (_path, options) => options?.method === "PATCH"
    ? (++saves === 1 ? old.promise : fresh.promise)
    : envelope({ settings: { pageSize: "50" } });
  try {
    await store.load();
    const first = store.save({ ...store.settings, signature: "第一账号" });
    store.bindOwner("second@example.test");
    await store.load();
    const second = store.save({ ...store.settings, signature: "第二账号" });
    old.resolve(envelope({ saved: true }));
    assert.equal(await first, false);
    assert.equal(store.saving, true);
    fresh.resolve(envelope({ saved: true }));
    assert.equal(await second, true);
    assert.equal(store.settings.signature, "第二账号");
  } finally { store.clear(); globalThis.fetch = original; }
});

test("会话确认清理同时清除偏好和 CSRF，503 退出失败保留偏好", async () => {
  const original = globalThis.fetch;
  setActivePinia(createPinia());
  const preferences = usePreferenceStore();
  const session = useSessionStore();
  preferences.bindOwner("first@example.test");
  globalThis.fetch = async (_path, options) => options?.method === "POST" ? failure() : envelope({ settings: { signature: "私有签名" } });
  try {
    await preferences.load();
    await assert.rejects(session.logout(), /设置暂不可用/);
    assert.equal(preferences.settings.signature, "私有签名");
    session.clear();
    assert.equal(preferences.owner, "");
    assert.deepEqual(preferences.settings, DEFAULT_MAIL_PREFERENCES);
    assert.equal(preferences.loaded, false);
  } finally { session.clear(); globalThis.fetch = original; }
});
