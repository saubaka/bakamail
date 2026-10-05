import assert from "node:assert/strict";
import test from "node:test";
import { readFileBase64 } from "../src/mail/attachments.ts";

test("附件读取取消真实 reader，并移除迟到回调；成功和失败都清理监听", async () => {
  const original = globalThis.FileReader;
  const readers: FakeReader[] = [];
  class FakeReader {
    static LOADING = 1;
    readyState = 0; result: string | null = null; aborted = false;
    onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null;
    constructor() { readers.push(this); }
    readAsDataURL() { this.readyState = 1; }
    abort() { this.aborted = true; this.readyState = 2; this.onabort?.(); }
  }
  globalThis.FileReader = FakeReader as unknown as typeof FileReader;
  try {
    const controller = new AbortController();
    const first = readFileBase64(new File(["x"], "x.txt"), controller.signal);
    const rejected = assert.rejects(first, { name: "AbortError" }); controller.abort(); await rejected;
    assert.equal(readers[0]?.aborted, true); assert.equal(readers[0]?.onload, null);
    const successfulSignal = new AbortController(); const second = readFileBase64(new File(["x"], "x.txt"), successfulSignal.signal);
    const successful = readers[1]!; successful.result = "data:text/plain;base64,eA=="; successful.readyState = 2; successful.onload?.();
    assert.equal(await second, "eA=="); successfulSignal.abort(); assert.equal(successful.aborted, false);
    assert.equal(successful.onload, null);
    const third = readFileBase64(new File(["x"], "x.txt"), new AbortController().signal);
    readers[2]!.onerror?.(); await assert.rejects(third, /读取附件失败/); assert.equal(readers[2]?.onerror, null);
  } finally { globalThis.FileReader = original; }
});
