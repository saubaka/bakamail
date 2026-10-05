import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useMessageStore } from "../src/stores/message.ts";
import type { MessageDetail } from "../src/mail/types.ts";

function message(uid: number): MessageDetail {
  return {
    uid, subject: `邮件 ${uid}`, from: [], to: [], cc: [], replyTo: [], references: [],
    date: null, size: 0, seen: false, flagged: false, answered: false,
    hasAttachments: false, text: `正文 ${uid}`, html: null, attachments: [], headers: {},
  };
}

function reply(uid: number): Response {
  return Response.json({ ok: true, data: message(uid), error: "" });
}

test("先打开的邮件迟到时不能覆盖后来打开的邮件", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMessageStore();
  let finishFirst: ((response: Response) => void) | undefined;
  globalThis.fetch = (input) => String(input).includes("/messages/1?")
    ? new Promise<Response>((resolve) => { finishFirst = resolve; })
    : Promise.resolve(reply(2));
  try {
    const first = store.open(1, "INBOX");
    assert.equal(store.loading, true);
    assert.equal((await store.open(2, "INBOX"))?.uid, 2);
    finishFirst?.(reply(1));
    assert.equal(await first, null);
    assert.equal(store.detail?.uid, 2);
    assert.equal(store.loading, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("清空阅读器会作废正在读取的正文", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMessageStore();
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = () => new Promise<Response>((resolve) => { finish = resolve; });
  try {
    const pending = store.open(7, "INBOX");
    store.clear();
    finish?.(reply(7));
    assert.equal(await pending, null);
    assert.equal(store.detail, null);
    assert.equal(store.currentUid, null);
    assert.equal(store.loading, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("失败后清除当前邮件，且只能更新匹配的正文", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMessageStore();
  globalThis.fetch = async () => reply(3);
  try {
    await store.open(3, "INBOX");
    store.patch(3, "Archive", { seen: true });
    assert.equal(store.detail?.seen, false);
    store.patch(3, "INBOX", { seen: true });
    assert.equal(store.detail?.seen, true);
    globalThis.fetch = async () => Response.json({ ok: false, data: null, error: "读取失败" }, { status: 503 });
    await assert.rejects(store.open(4, "INBOX"), /读取失败/);
    assert.equal(store.detail, null);
    assert.equal(store.currentUid, null);
    assert.equal(store.loading, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
