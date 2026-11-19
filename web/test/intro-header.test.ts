import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/intro.css", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/views/IntroView.vue", import.meta.url), "utf8");

test("首页顶部导航始终固定在顶部，下方有由下往上逐渐模糊的遮罩", () => {
  assert.match(css, /\.intro-header \{ position: sticky; top: 0; z-index: 40;/);
  assert.match(css, /\.intro-header::before, \.intro-header::after \{ content: ""; position: absolute; z-index: -1; top: 0; left: 50%; width: 100vw;[^}]*pointer-events: none; \}/);
  assert.match(css, /\.intro-header::before \{[^}]*backdrop-filter: blur\(3px\);[^}]*mask-image: linear-gradient\(to bottom, var\(--ink\) 62%, transparent\);/);
  assert.match(css, /\.intro-header::before \{[^}]*color-mix\(in srgb, var\(--bg-top\) 94%, transparent\) 0%/, "没有模糊时（减少动态）底色遮罩也足够遮住下方文字");
  assert.match(css, /\.intro-header::after \{[^}]*backdrop-filter: blur\(12px\);[^}]*mask-image: linear-gradient\(to bottom, var\(--ink\) 30%, transparent\);/);
  assert.doesNotMatch(css, /linear-gradient\(to right|linear-gradient\(90deg/, "不用从左到右的渐变");
  assert.match(css, /\.intro-about \{[^}]*scroll-margin-top: 72px;/);
  assert.match(css, /\.intro-faq \{[^}]*scroll-margin-top: 84px;/);
});

test("功能介绍和常见问题是普通文字链接，没有胶囊容器，窄屏也显示", () => {
  const nav = css.match(/\.intro-nav \{([^}]*)\}/)![1]!;
  assert.doesNotMatch(nav, /border|background|box-shadow|padding|border-radius/);
  const link = css.match(/\.intro-nav a \{([^}]*)\}/)![1]!;
  assert.doesNotMatch(link, /background|padding|border-radius/);
  assert.match(css, /\.intro-nav a:hover \{ color: var\(--ink\); text-decoration: underline;/);
  assert.doesNotMatch(css, /\.intro-nav \{ display: none; \}/);
  assert.match(view, /<nav class="intro-nav" aria-label="项目导航">\s*<a href="#about">功能介绍<\/a><a href="#faq">常见问题<\/a>/);
});
