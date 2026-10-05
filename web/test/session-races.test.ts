import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { api } from "../src/api/client.ts";
import { SessionSupersededError } from "../src/auth/sessionRequests.ts";
import { useSessionStore } from "../src/stores/session.ts";
import { useAdminSessionStore } from "../src/stores/adminSession.ts";
import { useSearchStore } from "../src/stores/search.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const envelope = (data: unknown) => Response.json({ ok: true, data, error: "" });
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const mail = (name: string) => ({ mailbox: `${name}@example.test`, domain: "example.test",
  csrfToken: `csrf-${name}`, expiresAt: "2099-01-01", liveConnections: 1, maxMessageBytes: 1000 });
const admin = (name: string) => ({ username: name, displayName: name, role: "admin",
  permissions: ["mail.account.read"], csrfToken: `csrf-${name}`, runner: "disabled", statsAvailable: false });

for (const scope of ["mail", "admin"] as const) {
  const mePath = scope === "mail" ? "/api/auth/me" : "/api/admin/auth/me";
  const logoutPath = scope === "mail" ? "/api/auth/logout" : "/api/admin/auth/logout";
  const data = scope === "mail" ? mail : admin;
  function setup() {
    setActivePinia(createPinia());
    return scope === "mail" ? useSessionStore() : useAdminSessionStore();
  }
  const identity = (store: ReturnType<typeof setup>) => "mailbox" in store ? store.mailbox : store.me?.username;

  test(`${scope}: 并发恢复共享一个请求，503 不被等待者吞掉，随后可重试`, async () => {
    const original = globalThis.fetch;
    const session = setup();
    const response = deferred<Response>();
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return response.promise; };
    try {
      const first = session.restore();
      const second = session.restore();
      const results = Promise.allSettled([first, second]);
      await turn();
      assert.equal(calls, 1);
      assert.equal(session.loading, true);
      response.resolve(Response.json({ ok: false, data: null, error: "暂不可用" }, { status: 503 }));
      for (const result of await results) {
        assert.equal(result.status, "rejected");
        if (result.status === "rejected") assert.equal(result.reason.status, 503);
      }
      assert.equal(session.loading, false);
      globalThis.fetch = async () => envelope(data("new"));
      await session.restore();
      assert.match(String(identity(session)), /^new/);
    } finally { session.clear(); globalThis.fetch = original; }
  });

  test(`${scope}: 确认退出立即取消旧读取，迟到响应不能恢复身份或 CSRF`, async () => {
    const original = globalThis.fetch;
    const session = setup();
    const response = deferred<Response>();
    let signal: AbortSignal | undefined;
    let csrf = "unset";
    globalThis.fetch = async (path, options) => {
      if (String(path) === mePath) { signal = options?.signal ?? undefined; return response.promise; }
      if (String(path) === logoutPath) return envelope({ loggedOut: true });
      csrf = new Headers(options?.headers).get("x-csrf-token") ?? "";
      return envelope({});
    };
    try {
      const restoring = session.restore();
      const canceled = assert.rejects(restoring, SessionSupersededError);
      await turn();
      await session.logout();
      await canceled; // fetch intentionally ignores abort and has not settled yet.
      assert.equal(signal?.aborted, true);
      assert.equal(session.loading, false);
      response.resolve(envelope(data("old")));
      await turn();
      assert.ok(!identity(session));
      await api(scope === "mail" ? "/api/contacts" : "/api/admin/accounts", { method: "POST", body: {} });
      assert.equal(csrf, "");
    } finally { session.clear(); globalThis.fetch = original; }
  });

  test(`${scope}: 强制恢复作废旧请求，旧 finally 不结束新请求的加载状态`, async () => {
    const original = globalThis.fetch;
    const session = setup();
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    let calls = 0;
    globalThis.fetch = async () => (++calls === 1 ? old.promise : fresh.promise);
    try {
      const first = session.restore();
      const canceled = assert.rejects(first, SessionSupersededError);
      await turn();
      const second = session.restore(true);
      await canceled;
      assert.equal(session.loading, true);
      old.resolve(envelope(data("old")));
      await turn();
      assert.equal(session.loading, true);
      assert.ok(!identity(session));
      fresh.resolve(envelope(data("new")));
      await second;
      assert.equal(session.loading, false);
      assert.match(String(identity(session)), /^new/);
    } finally { session.clear(); globalThis.fetch = original; }
  });

  test(`${scope}: 新身份建立后迟到的旧退出响应不清空新身份`, async () => {
    const original = globalThis.fetch;
    const session = setup();
    const response = deferred<Response>();
    let csrf = "";
    globalThis.fetch = async (path, options) => {
      if (String(path) === logoutPath) return response.promise;
      if (String(path) === mePath) return envelope(data("new"));
      csrf = new Headers(options?.headers).get("x-csrf-token") ?? "";
      return envelope({});
    };
    try {
      const exiting = session.logout();
      await turn();
      session.clear(); // same boundary used after a successful new login.
      await session.restore();
      response.resolve(envelope({ loggedOut: true }));
      await exiting;
      assert.match(String(identity(session)), /^new/);
      await api(scope === "mail" ? "/api/contacts" : "/api/admin/accounts", { method: "POST", body: {} });
      assert.equal(csrf, "csrf-new");
    } finally { session.clear(); globalThis.fetch = original; }
  });

  test(`${scope}: 不同 Pinia 实例不共享恢复或取消状态`, async () => {
    const original = globalThis.fetch;
    const first = setup();
    const second = setup();
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    let calls = 0;
    globalThis.fetch = async () => (++calls === 1 ? firstResponse.promise : secondResponse.promise);
    try {
      const firstRead = first.restore();
      const canceled = assert.rejects(firstRead, SessionSupersededError);
      const secondRead = second.restore();
      await turn();
      first.clear();
      await canceled;
      assert.equal(second.loading, true);
      secondResponse.resolve(envelope(data("second")));
      await secondRead;
      firstResponse.resolve(envelope(data("first")));
      await turn();
      assert.ok(!identity(first));
      assert.match(String(identity(second)), /^second/);
    } finally { first.clear(); second.clear(); globalThis.fetch = original; }
  });
}

test("邮箱身份清理也作废搜索结果，失败退出仍由原回归保护", () => {
  setActivePinia(createPinia());
  const session = useSessionStore();
  const search = useSearchStore();
  search.resultFolder = "INBOX";
  search.searched = true;
  session.clear();
  assert.equal(search.resultFolder, "");
  assert.equal(search.searched, false);
});
