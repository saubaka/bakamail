import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useComposeStore } from "../src/stores/compose.ts";
import { useSessionStore } from "../src/stores/session.ts";

const envelope = (data: unknown) => Response.json({ ok: true, data, error: "" });
const failed = () => Response.json({ ok: false, data: null, error: "模拟故障" }, { status: 503 });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function setup() { setActivePinia(createPinia()); const store = useComposeStore(); store.bindOwner("qa@example.test"); store.open(); return store; }

test("并发草稿保存只新建一次；旧保存完成后最新修改沿用确认编号", async () => {
  const original = globalThis.fetch; const store = setup(); const firstResponse = deferred<Response>();
  const calls: unknown[] = [];
  globalThis.fetch = async (_path, options) => { calls.push(JSON.parse(String(options?.body))); return calls.length === 1 ? firstResponse.promise : envelope({ id: "draft-one" }); };
  try {
    store.compose.text = "第一版";
    const first = store.persistDraft();
    const second = store.persistDraft();
    const third = store.persistDraft();
    assert.equal(calls.length, 1);
    store.compose.text = "最新修改";
    firstResponse.resolve(envelope({ id: "draft-one" }));
    assert.deepEqual(await Promise.all([first, second, third]), [true, true, true]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(item => (item as { id?: string }).id), [undefined, "draft-one"]);
    assert.equal((calls[1] as { payload: { text: string } }).payload.text, "最新修改");
    assert.equal(store.dirty, false);
    assert.equal(store.savingDraft, false);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("新撰写不能覆盖现有内容，关闭后迟到保存不能改写下一封的编号或状态", async () => {
  const original = globalThis.fetch; const store = setup(); const response = deferred<Response>();
  globalThis.fetch = async () => response.promise;
  try {
    store.compose.text = "不能丢失";
    assert.equal(store.open(undefined, "reply", "another@example.test"), false);
    assert.equal(store.compose.text, "不能丢失");
    const saving = store.persistDraft();
    store.finishClose(); store.open(undefined, "reply", "new@example.test");
    response.resolve(envelope({ id: "old-draft" }));
    assert.equal(await saving, false);
    assert.equal(store.draftId, "");
    assert.equal(store.compose.to, "new@example.test");
    assert.equal(store.savingDraft, false);
    assert.equal(store.hint, "");
  } finally { store.clear(); globalThis.fetch = original; }
});

test("清空已保存草稿全部内容仍保存空更新，而非保留旧正文", async () => {
  const original = globalThis.fetch; const store = setup(); const payloads: { payload: { text: string } }[] = [];
  globalThis.fetch = async (_path, options) => { payloads.push(JSON.parse(String(options?.body))); return envelope({ id: "empty-update" }); };
  try {
    store.compose.text = "旧正文"; await store.persistDraft();
    store.compose.text = "";
    assert.equal(store.hasContent(), false);
    assert.equal(await store.persistDraft(), true);
    assert.equal(payloads.length, 2);
    assert.equal(payloads[1]?.payload.text, "");
    assert.equal(store.dirty, false);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("保存失败保留输入，重试恢复；附件从不进入草稿正文", async () => {
  const original = globalThis.fetch; const store = setup(); let failure = true; let body: { payload?: unknown } = {};
  globalThis.fetch = async (_path, options) => { body = JSON.parse(String(options?.body)); return failure ? failed() : envelope({ id: "recovered" }); };
  try {
    store.compose.text = "保留输入";
    store.compose.attachments = [{ filename: "keep.txt", contentType: "text/plain", contentBase64: "a2VlcA==" }];
    assert.equal(await store.persistDraft(), false);
    assert.equal(store.compose.text, "保留输入"); assert.equal(store.compose.attachments.length, 1);
    assert.equal(store.dirty, true); assert.match(store.hint, /模拟故障/);
    failure = false; assert.equal(await store.persistDraft(), true);
    assert.equal(Object.hasOwn(body.payload as object, "attachments"), false);
    assert.equal(store.dirty, false); assert.equal(store.hint, "");
  } finally { store.clear(); globalThis.fetch = original; }
});

test("换账号后的迟到保存不写回；旧组件卸载不清空新组件状态", async () => {
  const original = globalThis.fetch; const store = setup(); const response = deferred<Response>();
  globalThis.fetch = async () => response.promise;
  try {
    const oldSurface = store.attach(); store.bindOwner("qa@example.test"); store.open();
    store.compose.text = "旧账号"; const saving = store.persistDraft();
    const newSurface = store.attach(); store.bindOwner("new@example.test"); store.open(); store.compose.text = "新账号";
    store.detach(oldSurface);
    response.resolve(envelope({ id: "old-account-draft" }));
    assert.equal(await saving, false); assert.equal(store.compose.text, "新账号"); assert.equal(store.owner, "new@example.test");
    assert.equal(store.draftId, ""); store.detach(newSurface); assert.equal(store.owner, "");
  } finally { store.clear(); globalThis.fetch = original; }
});

test("打开草稿的迟到响应不能覆盖随后打开的新邮件", async () => {
  const original = globalThis.fetch; const store = setup(); store.finishClose(); const response = deferred<Response>(); let signal: AbortSignal | undefined;
  globalThis.fetch = async (_path, options) => { signal = options?.signal ?? undefined; return response.promise; };
  try {
    const opening = store.openDraft("old");
    assert.equal(store.openingDraft, true);
    assert.equal(store.open(undefined, "reply", "new@example.test"), true);
    assert.equal(signal?.aborted, true);
    response.resolve(envelope({ drafts: [{ id: "old", to: "old@example.test", text: "旧草稿" }] }));
    assert.equal(await opening, false); assert.equal(store.compose.to, "new@example.test");
    assert.equal(store.compose.text, ""); assert.equal(store.draftId, ""); assert.equal(store.openingDraft, false);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("草稿载入失败可重试，载入成功不误触发自动保存", async () => {
  const original = globalThis.fetch; const store = setup(); store.finishClose(); let fail = true; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return fail ? failed() : envelope({ drafts: [{ id: "loaded", text: "内容", references: ["ref"] }] }); };
  try {
    assert.equal(await store.openDraft("loaded"), false); assert.equal(store.isOpen, false);
    fail = false; assert.equal(await store.openDraft("loaded"), true);
    assert.equal(store.dirty, false); assert.equal(store.draftId, "loaded"); assert.equal(store.compose.text, "内容");
    assert.equal(store.savingDraft, false); assert.equal(calls, 2);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("发送等待草稿但固定提交内容，重复发送不发第二次请求", async () => {
  const original = globalThis.fetch; const store = setup(); const draft = deferred<Response>(); const sent = deferred<Response>();
  const calls: { path: string; body: unknown }[] = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path: String(path), body: options?.body ? JSON.parse(String(options.body)) : null });
    if (String(path) === "/api/drafts") return draft.promise;
    if (String(path) === "/api/messages") return sent.promise;
    return envelope({ deleted: "saved" });
  };
  try {
    store.compose.to = "self@example.test"; store.compose.text = "发送快照";
    const saving = store.persistDraft(); const sending = store.send();
    assert.equal(await store.send(), null);
    store.compose.text = "等待时程序修改";
    draft.resolve(envelope({ id: "saved" })); await saving; await turn();
    assert.equal((calls.find(call => call.path === "/api/messages")?.body as { text: string }).text, "发送快照");
    sent.resolve(envelope({ messageId: "test", savedToSent: true }));
    const result = await sending; assert.equal(result?.notice, "");
    assert.equal(calls.filter(call => call.path === "/api/messages").length, 1);
    assert.equal(calls.filter(call => call.path === "/api/drafts/saved").length, 1);
    assert.equal(store.isOpen, false); assert.equal(store.compose.text, ""); assert.equal(store.sending, false);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("发送失败保留正文和附件；接受后 Sent/草稿清理失败不重新发送", async () => {
  const original = globalThis.fetch; const store = setup(); let stage = 0; let sends = 0;
  globalThis.fetch = async path => {
    if (String(path) === "/api/messages") { sends += 1; return stage === 0 ? failed() : envelope({ messageId: "accepted", savedToSent: false }); }
    return failed();
  };
  try {
    store.compose.text = "保留"; store.compose.attachments = [{ filename: "qa.txt", contentType: "text/plain", contentBase64: "eA==" }];
    store.draftId = "cleanup-fails";
    assert.equal(await store.send(), null); assert.equal(store.isOpen, true);
    assert.equal(store.compose.text, "保留"); assert.equal(store.compose.attachments.length, 1);
    assert.equal(store.deliveryUnconfirmed, true);
    assert.equal(await store.send(), null);
    assert.equal(sends, 1);
    store.allowSendRetry();
    stage = 1; const result = await store.send();
    assert.match(result?.notice ?? "", /不要直接重发/); assert.match(result?.notice ?? "", /草稿清理失败/);
    assert.equal(sends, 2); assert.equal(await store.send(), null); assert.equal(sends, 2);
    assert.equal(store.compose.attachments.length, 0);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("等待保存期间退出不发送旧内容；发送期间换账号不删除新账号草稿或关闭新邮件", async () => {
  const original = globalThis.fetch; const store = setup(); const pending = deferred<Response>(); let sends = 0; let deletes = 0;
  globalThis.fetch = async (path, options) => {
    if (String(path) === "/api/messages") { sends += 1; return pending.promise; }
    if (options?.method === "DELETE") { deletes += 1; return envelope({}); }
    return pending.promise;
  };
  try {
    store.compose.text = "旧内容"; const saving = store.persistDraft(); const waitingSend = store.send();
    store.clear(); pending.resolve(envelope({ id: "old" })); await saving;
    assert.equal(await waitingSend, null); assert.equal(sends, 0);
    const sentResponse = deferred<Response>();
    globalThis.fetch = async (_path, options) => { if (options?.method === "DELETE") { deletes += 1; return envelope({}); } sends += 1; return sentResponse.promise; };
    store.bindOwner("qa@example.test"); store.open(); store.draftId = "old-draft"; const sent = store.send();
    store.bindOwner("new@example.test"); store.open(); store.compose.text = "新内容"; store.draftId = "new-draft";
    sentResponse.resolve(envelope({ messageId: "old-accepted", savedToSent: true }));
    assert.equal(await sent, null); assert.equal(deletes, 0); assert.equal(store.compose.text, "新内容");
    assert.equal(store.draftId, "new-draft"); assert.equal(store.isOpen, true);
  } finally { store.clear(); globalThis.fetch = original; }
});

test("附件后选覆盖先选，旧读取不释放新读取锁，读取中不能发送", async () => {
  const store = setup(); const old = deferred<string>(); const fresh = deferred<string>(); let oldSignal: AbortSignal | undefined;
  try {
    const first = store.selectFiles([new File(["old"], "old.txt")], async (_file, signal) => { oldSignal = signal; return old.promise; });
    const second = store.selectFiles([new File(["fresh"], "fresh.txt")], async () => fresh.promise);
    assert.equal(oldSignal?.aborted, true); assert.equal(await store.send(), null);
    old.resolve("b2xk"); assert.equal(await first, false); assert.equal(store.readingAttachments, true);
    fresh.resolve("ZnJlc2g="); assert.equal(await second, true);
    assert.equal(store.compose.attachments[0]?.filename, "fresh.txt"); assert.equal(store.readingAttachments, false);
  } finally { store.clear(); }
});

test("关闭/换账号作废附件读取；超限或读取失败保留之前附件", async () => {
  const store = setup(); const pending = deferred<string>(); let signal: AbortSignal | undefined;
  try {
    const reading = store.selectFiles([new File(["late"], "late.txt")], async (_file, value) => { signal = value; return pending.promise; });
    store.finishClose(); store.open(); pending.resolve("bGF0ZQ==");
    assert.equal(signal?.aborted, true); assert.equal(await reading, false); assert.deepEqual(store.compose.attachments, []);
    store.compose.attachments = [{ filename: "retained", contentType: "text/plain", contentBase64: "eA==" }];
    assert.equal(await store.selectFiles([{ size: 33_554_433 } as File], async () => ""), false);
    assert.match(store.hint, /超过/); assert.equal(store.compose.attachments[0]?.filename, "retained");
    assert.equal(await store.selectFiles([new File(["x"], "bad.txt")], async () => { throw new Error("read failed"); }), false);
    assert.equal(store.compose.attachments[0]?.filename, "retained"); assert.equal(store.readingAttachments, false);
  } finally { store.clear(); }
});

test("确认退出清理撰写正文/附件，503 不清理；离开提示包含读取及发送状态", async () => {
  const original = globalThis.fetch; const store = setup(); const session = useSessionStore(); session.mailbox = store.owner; session.ready = true;
  globalThis.fetch = async () => failed();
  try {
    store.readingAttachments = true;
    assert.equal(store.needsLeaveWarning, true);
    store.readingAttachments = false;
    store.sending = true;
    assert.equal(store.needsLeaveWarning, true);
    store.sending = false;
    store.compose.text = "敏感正文"; assert.equal(store.needsLeaveWarning, true);
    await assert.rejects(session.logout(), /模拟故障/); assert.equal(store.compose.text, "敏感正文");
    globalThis.fetch = async () => envelope({}); await session.logout();
    assert.equal(store.owner, ""); assert.equal(store.isOpen, false); assert.equal(store.compose.text, ""); assert.equal(store.needsLeaveWarning, false);
  } finally { store.clear(); globalThis.fetch = original; }
});
