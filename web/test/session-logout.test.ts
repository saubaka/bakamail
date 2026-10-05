import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useMailboxStore } from "../src/stores/mailbox.ts";
import { useMessageStore } from "../src/stores/message.ts";
import { useSessionStore } from "../src/stores/session.ts";

test("退出接口暂时失败时保留会话与邮件，不能假装已退出", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const session = useSessionStore();
  const mailbox = useMailboxStore();
  const message = useMessageStore();
  session.mailbox = "me@example.test";
  session.ready = true;
  mailbox.account = "me@example.test";
  message.currentUid = 7;
  globalThis.fetch = async () => Response.json({ ok: false, data: null, error: "模拟服务故障" }, { status: 503 });
  try {
    await assert.rejects(session.logout(), /模拟服务故障/);
    assert.equal(session.ready, true);
    assert.equal(session.mailbox, "me@example.test");
    assert.equal(mailbox.account, "me@example.test");
    assert.equal(message.currentUid, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("退出时服务端已判定会话过期，清空本地敏感状态", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const session = useSessionStore();
  const mailbox = useMailboxStore();
  const message = useMessageStore();
  session.mailbox = "me@example.test";
  session.ready = true;
  mailbox.account = "me@example.test";
  message.currentUid = 7;
  globalThis.fetch = async () => Response.json({ ok: false, data: null, error: "未登录" }, { status: 401 });
  try {
    await session.logout();
    assert.equal(session.ready, false);
    assert.equal(session.mailbox, "");
    assert.equal(mailbox.account, "");
    assert.equal(message.currentUid, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
