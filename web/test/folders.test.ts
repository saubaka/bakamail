import assert from "node:assert/strict";
import test from "node:test";
import { folderLabel, type Folder } from "../src/mail/types.ts";

function folder(path: string, specialUse: string | null): Folder {
  return { path, name: path, specialUse, subscribed: true, messages: 0, unseen: 0 };
}

test("系统文件夹显示中文名，自建文件夹保留原名", () => {
  assert.equal(folderLabel(folder("INBOX", "\\Inbox")), "收件箱");
  assert.equal(folderLabel(folder("Sent", "\\Sent")), "已发送");
  assert.equal(folderLabel(folder("Projects", null)), "Projects");
});
