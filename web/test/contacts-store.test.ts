import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useContactStore } from "../src/stores/contacts.ts";
import { useSessionStore } from "../src/stores/session.ts";
import type { Contact } from "../src/api/contacts.ts";

const row = (id = 1, name = "旧名字"): Contact => ({ id, name, email: `qa${id}@example.test`, note: "备注" });
const envelope = (data: unknown) => Response.json({ ok: true, data, error: "" });
const failure = () => Response.json({ ok: false, data: null, error: "暂不可用" }, { status: 503 });
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function setup() {
  setActivePinia(createPinia());
  const store = useContactStore();
  store.bindOwner("first@example.test");
  return store;
}

test("联系人后发读取拥有加载状态，旧列表不能覆盖新结果", async () => {
  const original = globalThis.fetch;
  const store = setup();
  const old = deferred<Response>();
  const fresh = deferred<Response>();
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? old.promise : fresh.promise);
  try {
    const first = store.load();
    const second = store.load();
    old.resolve(envelope({ contacts: [row(1)] }));
    assert.equal(await first, false);
    assert.equal(store.loading, true);
    fresh.resolve(envelope({ contacts: [row(2)] }));
    assert.equal(await second, true);
    assert.deepEqual(store.contacts, [row(2)]);
    assert.equal(store.loading, false);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("保存成功立即采用服务器完整条目，回读 503 不丢失确认结果", async () => {
  const original = globalThis.fetch;
  const store = setup();
  store.contacts = [row(1)];
  const confirmed = { id: 29, name: "服务器名字", email: "normalized@example.test", note: "服务器备注" };
  globalThis.fetch = async (_input, options) => options?.method === "POST" ? envelope({ saved: confirmed.email, contact: confirmed }) : failure();
  try {
    assert.equal(await store.save({ name: "请求名字", email: "NORMALIZED@example.test", note: "请求备注" }), true);
    assert.deepEqual(store.contacts.find((item) => item.id === 29), confirmed);
    await assert.rejects(store.load(), /暂不可用/);
    assert.equal(store.contacts.length, 2);
    assert.deepEqual(store.contacts.find((item) => item.id === 29), confirmed);
    assert.equal(store.stale, true);
    assert.equal(store.loadError, "暂不可用");
  } finally { store.clear(); globalThis.fetch = original; }
});

test("保存确认覆盖同一编号；请求前快照不能覆盖修改，提交后输入变化不改变请求", async () => {
  const original = globalThis.fetch;
  const store = setup();
  store.contacts = [row(1)];
  const old = deferred<Response>();
  let body: unknown;
  const confirmed = row(1, "服务器修改");
  globalThis.fetch = async (_path, options) => {
    if (options?.method === "PATCH") { body = JSON.parse(String(options.body)); return envelope({ contact: confirmed }); }
    return old.promise;
  };
  try {
    const reading = store.load();
    const input = { name: "提交名字", email: confirmed.email, note: "提交备注" };
    const saving = store.save(input, 1);
    input.name = "提交后修改";
    assert.equal(await saving, true);
    old.resolve(envelope({ contacts: [row(1)] }));
    assert.equal(await reading, false);
    assert.deepEqual(body, { name: "提交名字", email: confirmed.email, note: "提交备注" });
    assert.deepEqual(store.contacts, [confirmed]);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("删除成功后旧读取与回读失败都不能恢复联系人", async () => {
  const original = globalThis.fetch;
  const store = setup();
  store.contacts = [row(1), row(2)];
  const old = deferred<Response>();
  let reads = 0;
  globalThis.fetch = async (_path, options) => options?.method === "DELETE"
    ? envelope({ deleted: "1" }) : (++reads === 1 ? old.promise : failure());
  try {
    const reading = store.load();
    assert.equal(await store.remove(1), true);
    old.resolve(envelope({ contacts: [row(1), row(2)] }));
    assert.equal(await reading, false);
    await assert.rejects(store.load(), /暂不可用/);
    assert.deepEqual(store.contacts, [row(2)]);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("保存/删除失败保留联系人，不乐观提交错误结果", async () => {
  const original = globalThis.fetch;
  const store = setup();
  store.contacts = [row(1)];
  globalThis.fetch = async () => failure();
  try {
    await assert.rejects(store.save({ name: "新", email: "new@example.test", note: "" }, 1), /暂不可用/);
    assert.deepEqual(store.contacts, [row(1)]);
    assert.equal(store.saving, false);
    await assert.rejects(store.remove(1), /暂不可用/);
    assert.deepEqual(store.contacts, [row(1)]);
    assert.equal(store.removingId, null);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("写操作串行，写入中不发可能返回提交前数据的读取", async () => {
  const original = globalThis.fetch;
  const store = setup();
  const response = deferred<Response>();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return response.promise; };
  try {
    const saving = store.save({ name: "新", email: "new@example.test", note: "" });
    await assert.rejects(store.save({ name: "重复", email: "new@example.test", note: "" }), /正在进行/);
    await assert.rejects(store.remove(1), /正在进行/);
    assert.equal(await store.load(), false);
    assert.equal(calls, 1);
    response.resolve(envelope({ contact: row(3) }));
    assert.equal(await saving, true);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("换账号作废旧读取及旧写入，不污染新账号或释放新写入锁", async () => {
  const original = globalThis.fetch;
  const store = setup();
  const readingResponse = deferred<Response>();
  const oldWrite = deferred<Response>();
  const newWrite = deferred<Response>();
  let writes = 0;
  globalThis.fetch = async (_path, options) => options?.method === "POST"
    ? (++writes === 1 ? oldWrite.promise : newWrite.promise) : readingResponse.promise;
  try {
    const oldContext = store.context();
    const reading = store.load();
    const writing = store.save({ name: "旧账号", email: "old@example.test", note: "" });
    store.bindOwner("second@example.test");
    assert.equal(store.isCurrent(oldContext), false);
    assert.deepEqual(store.contacts, []);
    const current = store.save({ name: "新账号", email: "new@example.test", note: "" });
    oldWrite.resolve(envelope({ contact: row(1) }));
    readingResponse.resolve(envelope({ contacts: [row(1)] }));
    assert.equal(await writing, false);
    assert.equal(await reading, false);
    assert.equal(store.saving, true);
    assert.deepEqual(store.contacts, []);
    newWrite.resolve(envelope({ contact: row(2) }));
    assert.equal(await current, true);
    assert.deepEqual(store.contacts, [row(2)]);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("同账号退出后重新绑定也作废旧确认上下文，退出 503 不清理联系人", async () => {
  const original = globalThis.fetch;
  const store = setup();
  const session = useSessionStore();
  session.mailbox = store.owner;
  session.ready = true;
  store.contacts = [row(1)];
  const current = store.context();
  globalThis.fetch = async () => failure();
  try {
    await assert.rejects(session.logout(), /暂不可用/);
    assert.equal(store.isCurrent(current), true);
    assert.deepEqual(store.contacts, [row(1)]);
    globalThis.fetch = async () => envelope({ loggedOut: true });
    await session.logout();
    assert.equal(store.owner, "");
    assert.deepEqual(store.contacts, []);
    store.bindOwner("first@example.test");
    assert.equal(store.isCurrent(current), false);
  } finally { session.clear(); globalThis.fetch = original; }
});

test("离开页面可保留同账号缓存，但作废读取不恢复加载或清空写入结果", async () => {
  const original = globalThis.fetch;
  const store = setup();
  store.contacts = [row(1)];
  const response = deferred<Response>();
  globalThis.fetch = async () => response.promise;
  try {
    const reading = store.load();
    store.suspend();
    assert.equal(store.loading, false);
    response.resolve(envelope({ contacts: [] }));
    assert.equal(await reading, false);
    assert.deepEqual(store.contacts, [row(1)]);
    assert.equal(store.owner, "first@example.test");
  } finally { store.clear(); globalThis.fetch = original; }
});
