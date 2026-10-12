import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/views/IntroView.vue", import.meta.url), "utf8");
const links = source.match(/<div class="intro-footer-links">([\s\S]*?)<\/div>/)?.[1] ?? "";

test("页尾在“项目介绍”右侧提供开源仓库链接，并在新标签页安全打开", () => {
  const labels = [...links.matchAll(/>([^<]+)<\/(?:a|router-link)>/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["项目介绍", "开源仓库", "重置密码"]);
  const anchor = links.match(/<a [^>]*>开源仓库<\/a>/)?.[0] ?? "";
  assert.match(anchor, /href="https:\/\/github\.com\/saubaka\/bakamail"/);
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="noopener noreferrer"/);
});
