import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/intro.css", import.meta.url), "utf8");

test("功能介绍卡片的悬停有过渡：上浮用弹性曲线，阴影、背景、边框渐变", () => {
  assert.match(css, /\.intro-features article \{ --card-hover: translate \.6s var\(--spring-soft\), box-shadow \.5s var\(--ease\), background-color \.4s var\(--ease\), border-color \.4s var\(--ease\);[^}]*transition: var\(--card-hover\); \}/);
  assert.match(css, /\.intro-features article:hover \{ translate: 0 -4px;/);
});

test("滚动入场规则不再覆盖卡片的悬停过渡，悬停属性也不继承入场的错峰延迟", () => {
  assert.match(css, /\.intro-reveal--split\.intro-reveal--ready :is\(\.intro-features article, \.intro-faq-card\)\.intro-stagger \{ transition: opacity \.3s var\(--ease\), transform \.45s var\(--ease\), filter \.3s var\(--ease\), var\(--card-hover\); \}/);
  assert.match(css, /\.intro-reveal--split\.intro-reveal--ready :is\(\.intro-features article, \.intro-faq-card\)\.intro-stagger\.is-seen \{ transition: opacity \.9s var\(--ease\) var\(--d, 0ms\), transform \.9s var\(--ease\) var\(--d, 0ms\), filter \.9s var\(--ease\) var\(--d, 0ms\), var\(--card-hover\); \}/);
  assert.match(css, /\.intro-page \.intro-faq-card \{ --card-hover: box-shadow \.5s var\(--ease\);[^}]*transition: var\(--card-hover\);/);
  assert.match(css, /\.intro-reveal--still \.intro-stagger \{[^}]*transition: none !important; \}/, "减少动态时仍然全部关闭");
});
