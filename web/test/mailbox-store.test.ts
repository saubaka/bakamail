import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useMailboxStore } from "../src/stores/mailbox.ts";
import type { MessageSummary } from "../src/mail/types.ts";

function message(uid: number): MessageSummary {
  return {
    uid, subject: `邮件 ${uid}`, from: [], to: [], date: null, size: 0,
    seen: false, flagged: false, answered: false, hasAttachments: false,
  };
}

function reply(data: unknown): Response {
  return Response.json({ ok: true, data, error: "" });
}

test("切回文件夹时先显示缓存，再用服务端结果更新", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  let inboxVersion = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("folder=INBOX")) {
      inboxVersion += 1;
      return reply({ items: [message(inboxVersion)], nextBefore: null, total: 1 });
    }
    return reply({ items: [message(9)], nextBefore: null, total: 1 });
  };
  try {
    assert.equal(await store.loadMessages("50"), true);
    store.selectFolder("Archive", "50");
    assert.deepEqual(store.messages.map((row) => row.uid), []);
    assert.equal(await store.loadMessages("50"), true);
    store.selectFolder("INBOX", "50");
    assert.deepEqual(store.messages.map((row) => row.uid), [1]);
    assert.equal(await store.loadMessages("50"), true);
    assert.deepEqual(store.messages.map((row) => row.uid), [2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("旧文件夹的迟到响应不能覆盖新文件夹", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  let finishInbox: ((response: Response) => void) | undefined;
  globalThis.fetch = (input) => {
    if (String(input).includes("folder=INBOX")) {
      return new Promise<Response>((resolve) => { finishInbox = resolve; });
    }
    return Promise.resolve(reply({ items: [message(9)], nextBefore: null, total: 1 }));
  };
  try {
    const oldLoad = store.loadMessages("50");
    store.selectFolder("Archive", "50");
    assert.equal(await store.loadMessages("50"), true);
    finishInbox?.(reply({ items: [message(1)], nextBefore: null, total: 1 }));
    assert.equal(await oldLoad, false);
    assert.equal(store.currentFolder, "Archive");
    assert.deepEqual(store.messages.map((row) => row.uid), [9]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("缓存同步期间禁止用旧游标加载下一页", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  let calls = 0;
  let finishRefresh: ((response: Response) => void) | undefined;
  globalThis.fetch = () => {
    calls += 1;
    if (calls === 1) return Promise.resolve(reply({ items: [message(1)], nextBefore: 10, total: 2 }));
    return new Promise<Response>((resolve) => { finishRefresh = resolve; });
  };
  try {
    await store.loadMessages("50");
    const refresh = store.loadMessages("50");
    assert.equal(store.fetchingList, true);
    assert.equal(store.loadingList, false);
    assert.equal(await store.loadMessages("50", false), false);
    assert.equal(calls, 2);
    finishRefresh?.(reply({ items: [message(2)], nextBefore: null, total: 1 }));
    assert.equal(await refresh, true);
    assert.equal(store.fetchingList, false);
    assert.deepEqual(store.messages.map((row) => row.uid), [2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("更换邮箱账号后清空前一账号的邮件快照", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  let owner = "first@saubaka.com";
  globalThis.fetch = async (input) => String(input) === "/api/folders"
    ? reply({ account: owner, folders: [] })
    : reply({ items: [message(1)], nextBefore: null, total: 1 });
  try {
    await store.loadFolders();
    await store.loadMessages("50");
    store.toggleSelect(1);
    owner = "second@saubaka.com";
    await store.loadFolders();
    assert.equal(store.account, owner);
    assert.equal(store.currentFolder, "INBOX");
    assert.deepEqual(store.messages, []);
    assert.deepEqual(store.selectedUids, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("退出或离开工作台后，迟到的文件夹响应不能写回旧账号", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  let finish: ((response: Response) => void) | undefined;
  globalThis.fetch = () => new Promise<Response>((resolve) => { finish = resolve; });
  try {
    const pending = store.loadFolders();
    store.clear();
    finish?.(reply({ account: "old@saubaka.com", folders: [{ path: "INBOX", name: "INBOX" }] }));
    await pending;
    assert.equal(store.account, "");
    assert.deepEqual(store.folders, []);

    const pendingAfterRouteChange = store.loadFolders();
    store.suspend();
    finish?.(reply({ account: "old@saubaka.com", folders: [{ path: "INBOX", name: "INBOX" }] }));
    await pendingAfterRouteChange;
    assert.equal(store.account, "");
    assert.deepEqual(store.folders, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("已确认的标记覆盖不同页大小的快照，并压住写入前发起的迟到刷新", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  let calls = 0;
  let finishOldRefresh: ((response: Response) => void) | undefined;
  globalThis.fetch = () => {
    calls += 1;
    if (calls <= 2) return Promise.resolve(reply({ items: [message(7)], nextBefore: null, total: 1 }));
    return new Promise<Response>((resolve) => { finishOldRefresh = resolve; });
  };
  try {
    await store.loadMessages("50");
    await store.loadMessages("25");
    const oldRefresh = store.loadMessages("50");
    store.patchMessages("INBOX", [7], { seen: true });
    assert.equal(store.messages[0]?.seen, true);
    finishOldRefresh?.(reply({ items: [message(7)], nextBefore: null, total: 1 }));
    assert.equal(await oldRefresh, false);
    store.selectFolder("Archive", "50");
    store.selectFolder("INBOX", "25");
    assert.equal(store.messages[0]?.seen, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("已移动的邮件从当前列表和旧文件夹快照移除，旧请求不能使它复活", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  let calls = 0;
  let finishOldRefresh: ((response: Response) => void) | undefined;
  globalThis.fetch = () => {
    calls += 1;
    if (calls === 1) return Promise.resolve(reply({ items: [message(7), message(8)], nextBefore: null, total: 2 }));
    return new Promise<Response>((resolve) => { finishOldRefresh = resolve; });
  };
  try {
    await store.loadMessages("50");
    store.toggleSelect(7);
    const oldRefresh = store.loadMessages("50");
    store.removeMessages("INBOX", [7]);
    assert.deepEqual(store.messages.map((row) => row.uid), [8]);
    assert.equal(store.total, 1);
    assert.deepEqual(store.selectedUids, []);
    finishOldRefresh?.(reply({ items: [message(7), message(8)], nextBefore: null, total: 2 }));
    assert.equal(await oldRefresh, false);
    store.selectFolder("Archive", "50");
    store.selectFolder("INBOX", "50");
    assert.deepEqual(store.messages.map((row) => row.uid), [8]);
    assert.equal(store.total, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("文件夹改名确认后即使旧刷新迟到，也保留新名称并清除旧邮件快照", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  let finishOldFolders: ((response: Response) => void) | undefined;
  const oldFolders = [
    { path: "INBOX", name: "INBOX", specialUse: "\\Inbox", subscribed: true, messages: 0, unseen: 0 },
    { path: "Work", name: "Work", specialUse: null, subscribed: true, messages: 1, unseen: 0 },
  ];
  let folderReads = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/folders") {
      folderReads += 1;
      if (folderReads === 1) return reply({ account: "user@saubaka.com", folders: oldFolders });
      return new Promise<Response>((resolve) => { finishOldFolders = resolve; });
    }
    return reply({ items: [message(7)], nextBefore: null, total: 1 });
  };
  try {
    await store.loadFolders();
    store.selectFolder("Work", "50");
    await store.loadMessages("50");
    const staleRead = store.loadFolders();
    store.acknowledgeFolderRenamed("Work", "Projects", "50");
    assert.equal(store.currentFolder, "Projects");
    assert.deepEqual(store.messages, []);
    assert.equal(store.folders.some((folder) => folder.path === "Work"), false);
    assert.equal(store.folders.some((folder) => folder.path === "Projects"), true);
    finishOldFolders?.(reply({ account: "user@saubaka.com", folders: oldFolders }));
    await staleRead;
    assert.equal(store.currentFolder, "Projects");
    assert.equal(store.folders.some((folder) => folder.path === "Work"), false);
    store.selectFolder("Work", "50");
    assert.deepEqual(store.messages, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("文件夹写入确认后本地列表立即反映创建、订阅、清空和删除", async () => {
  const originalFetch = globalThis.fetch;
  setActivePinia(createPinia());
  const store = useMailboxStore();
  globalThis.fetch = async (input) => String(input) === "/api/folders"
    ? reply({ account: "user@saubaka.com", folders: [
      { path: "INBOX", name: "INBOX", specialUse: "\\Inbox", subscribed: true, messages: 0, unseen: 0 },
    ] })
    : reply({ items: [message(7)], nextBefore: null, total: 1 });
  try {
    await store.loadFolders();
    store.acknowledgeFolderCreated("Work");
    assert.equal(store.folders.find((folder) => folder.path === "Work")?.messages, 0);
    store.acknowledgeFolderSubscription("Work", false);
    assert.equal(store.folders.find((folder) => folder.path === "Work")?.subscribed, false);
    store.selectFolder("Work", "50");
    await store.loadMessages("50");
    store.acknowledgeFolderEmptied("Work", "50");
    assert.deepEqual(store.messages, []);
    assert.equal(store.total, 0);
    store.acknowledgeFolderDeleted("Work", "50");
    assert.equal(store.currentFolder, "INBOX");
    assert.equal(store.folders.some((folder) => folder.path === "Work"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
