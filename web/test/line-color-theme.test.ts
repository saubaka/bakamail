import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const styles = new URL("../src/styles/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, styles), "utf8");
const theme = read("local-theme.css");
const hex = (css: string, name: string) => css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1].toLowerCase();

function contrast(a: string, b: string): number {
  const lum = (value: string) => {
    const channels = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("所有线条（含键盘聚焦环）共用仪表盘统计卡片的线色", () => {
  assert.equal(hex(theme, "--line-blue"), "#dceaf7");
  assert.match(theme, /--line-blue-strong:\s*var\(--line-blue\);/);
  assert.match(theme, /--focus-line:\s*var\(--line-blue\);/);
  assert.match(theme, /:focus-visible \{ outline-color: var\(--focus-line\) !important; \}/);
});

test("路由切换时由脚本聚焦的主体容器不画聚焦环，避免整块内容外出现一圈粗线", () => {
  assert.match(theme, /#main-content:focus, #main-content:focus-visible[^{]*\{ outline: none !important; \}/);
});

test("错误和危险操作用浅色的可爱红，文字在各浅底上对比度不低于 4.5:1", () => {
  const text = hex(theme, "--danger-700")!;
  assert.equal(text, "#b04560");
  for (const name of ["--danger-100", "--danger-200"]) assert.ok(contrast(text, hex(theme, name)!) >= 4.5, name);
  assert.ok(contrast(text, "#ffffff") >= 4.5);
  assert.match(theme, /\.button--danger \{ background: var\(--danger-100\) !important; \}/);
});

test("项目自己的样式里不再有旧的深色线条和深红：侧栏强调条、开关边线、危险按钮、聚焦以外的深蓝线", () => {
  const admin = read("admin.css");
  assert.match(admin, /\.admin-rail__indicator::before \{[^}]*background: var\(--line-blue-strong\); \}/);
  assert.doesNotMatch(admin, /\.button--danger \{[^}]*background: var\(--danger-700\)/);
  assert.match(admin, /\.admin-rail__badge\.is-alert \{ background: var\(--danger-200\); color: var\(--danger-700\); \}/);
  for (const file of ["components/admin/ToggleSwitch.vue", "views/admin/HumanVerificationView.vue"]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /#8fc2e1/, file);
  }
  const own = readdirSync(styles).filter((name) => name.endsWith(".css")).filter((name) => name !== "app.css");
  for (const name of own) assert.doesNotMatch(read(name), /#a04440|#a24c4c|#cf7777|#d98e8e/i, name);
  for (const file of ["views/admin/SeoView.vue", "components/TurnstileWidget.vue"]) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), /#a24c4c|#cf7777|#d98e8e|#b05252/i, file);
  }
  assert.ok(join("a", "b"));
});
