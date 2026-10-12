import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sourceFiles } from "../../scripts/sync-bakagit.mjs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const text = (path: string) => read(path).toString("utf8");

test("logo 是纯矢量 SVG：有 viewBox、没有位图或外部引用、没有脚本", () => {
  const svg = text("public/logo.svg");
  assert.match(svg, /<svg [^>]*viewBox="0 0 40 40"/);
  assert.doesNotMatch(svg, /<image|<script|<foreignObject|href=|url\(|data:/i);
  assert.match(svg, /<title>Baka Mail<\/title>/);
});

test("页面声明 SVG 图标、ico 兜底和 iOS 主屏图标，且文件都存在", () => {
  const html = text("index.html");
  for (const href of ["/logo.svg", "/favicon.ico", "/apple-touch-icon.png"]) {
    assert.ok(html.includes(`href="${href}"`), href);
    assert.ok(read(`public${href}`).length > 0, href);
  }
  assert.match(html, /rel="icon" href="\/logo\.svg" type="image\/svg\+xml"/);
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
});

test("iOS 主屏图标是 180x180 不透明 RGB：没有透明像素，系统裁圆角时不会出现黑边", () => {
  const png = read("public/apple-touch-icon.png");
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
  assert.equal(png[25], 2, "颜色类型 2 = RGB，没有 alpha 通道");
});

test("favicon.ico 含 16、32、48 三个尺寸的 PNG 图像", () => {
  const ico = read("public/favicon.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const sizes = [0, 1, 2].map((i) => ico[6 + i * 16]);
  assert.deepEqual(sizes, [16, 32, 48]);
  for (let i = 0; i < 3; i++) {
    const offset = ico.readUInt32LE(6 + i * 16 + 12);
    assert.equal(ico.subarray(offset + 1, offset + 4).toString("latin1"), "PNG");
  }
});

test("README 顶部展示 logo，公开镜像包含这些文件", () => {
  const readme = readFileSync(new URL("../../docs/github/README.md", import.meta.url), "utf8");
  assert.match(readme, /<img src="web\/public\/logo\.svg"/);
  for (const file of ["web/public/logo.svg", "web/public/favicon.ico", "web/public/apple-touch-icon.png", "web/public/og-image.png"]) {
    assert.ok(sourceFiles.includes(file), file);
  }
});

test("默认分享图是 1200×630 不透明 PNG，不含文字（站点名可以随意修改而不会和图片对不上）", () => {
  const png = read("public/og-image.png");
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(png[25], 2, "RGB，没有透明通道");
  assert.ok(png.length < 100 * 1024, "远小于社交平台 1MB 的上限");
});
