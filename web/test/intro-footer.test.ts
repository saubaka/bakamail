import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SEO_REPOSITORY_URL } from "../../shared/seo.ts";

const source = readFileSync(new URL("../src/views/IntroView.vue", import.meta.url), "utf8");
const footer = source.match(/<footer class="intro-footer">([\s\S]*?)<\/footer>/)?.[1] ?? "";
const links = footer.match(/<div class="intro-footer-links">([\s\S]*?)<\/div>/)?.[1] ?? "";

test("页尾在“项目介绍”右侧提供开源仓库链接，并在新标签页安全打开", () => {
  const labels = [...links.matchAll(/>([^<]+)<\/(?:a|router-link)>/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["项目介绍", "开源仓库", "重置密码"]);
  const anchor = links.match(/<a [^>]*>开源仓库<\/a>/)?.[0] ?? "";
  assert.match(anchor, /:href="repositoryUrl"/);
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="noopener noreferrer"/);
  assert.equal(SEO_REPOSITORY_URL, "https://github.com/saubaka/bakamail");
  assert.match(source, /const repositoryUrl = SEO_REPOSITORY_URL;/);
});

test("开源标记和版权标记是固定内容：不读取站点名、副标题或任何 SEO 设置，也不能被条件隐藏", () => {
  assert.match(footer, /<p>© \{\{ year \}\} saubaka\. BakaMail\.<br \/><span>邮件服务基于 Maddy，第三方项目版权归原作者所有。<\/span><\/p>/);
  const fixed = footer.slice(footer.indexOf('<div class="intro-footer-links">'));
  assert.doesNotMatch(fixed, /siteInfo|tagline|v-if|v-show|display\s*:\s*none/, "固定部分不引用可配置内容，也没有条件渲染");
  // 可配置的只有页脚左侧的品牌名和副标题。
  assert.match(footer, /<div><strong>\{\{ siteInfo\.siteName \}\}<\/strong><p>\{\{ siteInfo\.tagline \}\}<\/p><\/div>/);
});
