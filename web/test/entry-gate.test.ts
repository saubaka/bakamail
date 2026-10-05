import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/api/client.ts";
import { SessionSupersededError } from "../src/auth/sessionRequests.ts";
import { checkMailEntry, safeMailDestination } from "../src/auth/entryGate.ts";

test("根地址先检查服务器会话，匿名仍展示介绍页，已登录也展示介绍页", async () => {
  let checked = 0;
  let cleared = 0;
  assert.equal(await checkMailEntry(async () => { checked++; }, () => { cleared++; }, true, "/"), true);
  assert.equal(await checkMailEntry(async () => { checked++; throw new ApiError("未登录", 401, null); }, () => { cleared++; }, true, "/"), true);
  assert.equal(checked, 2);
  assert.equal(cleared, 1);
});
test("无会话和过期会话都返回介绍页，保留邮箱目的地", async () => {
  for (const message of ["未登录", "会话已过期"]) {
    let cleared = false;
    const result = await checkMailEntry(async () => { throw new ApiError(message, 401, null); }, () => { cleared = true; }, false, "/mail/search?q=hello");
    assert.deepEqual(result, { name: "intro", query: { reason: "session", redirect: "/mail/search?q=hello" } });
    assert.equal(cleared, true);
  }
});
test("网络及服务故障不伪报退出，不清除已有身份", async () => {
  for (const status of [0, 429, 503]) {
    let cleared = false;
    assert.deepEqual(await checkMailEntry(async () => { throw new ApiError("暂不可用", status, null); }, () => { cleared = true; }, true, "/"), { name: "unavailable", query: { redirect: "/" } });
    assert.equal(cleared, false);
  }
});
test("旧会话请求取消不导航，不清理新身份", async () => {
  assert.equal(await checkMailEntry(async () => { throw new SessionSupersededError(); }, () => { throw Error("不得清理"); }, false, "/mail"), false);
});
test("登录目的地只允许本站邮箱路由", () => {
  for (const value of ["//evil.test", "https://evil.test", "/mailicious", "/mail\\evil", ["/mail"], null]) assert.equal(safeMailDestination(value), "/mail");
  for (const value of ["/mail", "/mail/search?q=hi", "/mail/drafts"]) assert.equal(safeMailDestination(value), value);
});
