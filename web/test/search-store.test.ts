import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useSearchStore } from "../src/stores/search.ts";
import { useSessionStore } from "../src/stores/session.ts";

const response = (uid: number) => Response.json({ ok: true, data: { items: [{ uid, subject: "test" }] }, error: "" });

test("搜索结果固定在请求时的文件夹，不跟随随后编辑的表单", async () => {
  setActivePinia(createPinia());
  const store = useSearchStore();
  const originalFetch = globalThis.fetch;
  let finish: (response: Response) => void = () => {};
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  try {
    const input = { folder: "Archive", q: "test" };
    const pending = store.run(input);
    input.folder = "INBOX";
    finish(response(7));
    assert.equal(await pending, true);
    assert.deepEqual(store.target(7), { folder: "Archive", uid: "7" });
    assert.throws(() => store.target(9), TypeError);
  } finally { globalThis.fetch = originalFetch; }
});

test("后发搜索和清理作废旧请求，迟到结果不能覆盖或复活", async () => {
  setActivePinia(createPinia());
  const store = useSearchStore();
  const originalFetch = globalThis.fetch;
  const pending: Array<{ finish: (response: Response) => void; signal?: AbortSignal | null }> = [];
  globalThis.fetch = (_input, options) => new Promise((resolve) => pending.push({ finish: resolve, signal: options?.signal }));
  try {
    const first = store.run({ folder: "INBOX", q: "one" });
    const second = store.run({ folder: "Archive", q: "two" });
    assert.equal(pending[0]!.signal?.aborted, true);
    pending[1]!.finish(response(2));
    assert.equal(await second, true);
    pending[0]!.finish(response(1));
    assert.equal(await first, false);
    assert.deepEqual(store.target(2), { folder: "Archive", uid: "2" });
    const late = store.run({ folder: "Trash", q: "three" });
    store.clear();
    pending[2]!.finish(response(3));
    assert.equal(await late, false);
    assert.deepEqual(store.results, []);
    assert.equal(store.loading, false);
    assert.throws(() => store.target(3), TypeError);
  } finally { globalThis.fetch = originalFetch; }
});

test("失败保留上次结果及文件夹；确认退出后清空搜索状态", async () => {
  setActivePinia(createPinia());
  const store = useSearchStore();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response(1);
  try {
    await store.run({ folder: "Archive", q: "test" });
    globalThis.fetch = async () => Response.json({ ok: false, data: null, error: "读取失败" }, { status: 503 });
    await assert.rejects(store.run({ folder: "INBOX", q: "new" }), /读取失败/);
    assert.deepEqual(store.target(1), { folder: "Archive", uid: "1" });
    assert.equal(store.loading, false);
    globalThis.fetch = async () => Response.json({ ok: true, data: { loggedOut: true }, error: "" });
    await useSessionStore().logout();
    assert.deepEqual(store.results, []);
    assert.equal(store.searched, false);
  } finally { globalThis.fetch = originalFetch; }
});
