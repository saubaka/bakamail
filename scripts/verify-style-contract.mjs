import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webSrc = join(root, "web/src");
const stylesDir = join(webSrc, "styles");
const tokensPath = join(stylesDir, "theme/tokens.css");
const failures = [];

export const THEME_TOKENS = {
  "--bg": "#f8f6f7", "--bg-2": "#f2eff1", "--bg-top": "#fcfbfb", "--surface": "#ffffff", "--surface-2": "#faf8f9", "--chip": "#f2eff1",
  "--line": "#ece8ea", "--line-2": "#e1dcdf", "--card-line": "#ebe6e9", "--ink": "#5a5458", "--ink-2": "#8a8387", "--ink-3": "#a29ba0",
  "--blue-50": "#f6fafe", "--blue-100": "#eaf4fc", "--blue-200": "#d9ecfa", "--blue-300": "#c1dff6", "--blue-400": "#a8d2f3", "--blue-500": "#8cc2ee",
  "--pink-50": "#fef7fa", "--pink-100": "#fdeef3", "--pink-200": "#fadbe5", "--pink-300": "#f6c3d4", "--pink-500": "#f0a0ba",
  "--warn": "#f6b3c8", "--warn-bg": "#fef4f7", "--bad-bg": "#fdeaf0", "--bad-ink": "#c9718f",
  "--r-xl": "26px", "--r-l": "20px", "--r-m": "14px", "--r-s": "10px", "--r-pill": "999px",
  "--ease": "cubic-bezier(.22, 1, .36, 1)", "--spring": "cubic-bezier(.34, 1.56, .64, 1)",
};

export const LEGACY_TOKENS = [
  "--text", "--text-soft", "--text-faint", "--graphite-blue", "--line-blue", "--line-blue-strong", "--focus-line", "--border", "--border-strong",
  "--silver-mist", "--fog-white", "--cloud-blue", "--sunny-blue", "--petal-pink", "--canvas", "--surface-soft", "--blue-050", "--blue-600",
  "--action-blue", "--action-blue-hover", "--action-blue-ink", "--danger-100", "--danger-200", "--danger-300", "--danger-700",
  "--state-success-100", "--state-success-700", "--state-warning-100", "--state-warning-700", "--radius-sm", "--radius-md", "--radius-lg",
  "--radius-xl", "--radius-card", "--radius-control", "--radius-panel", "--radius-pill", "--shadow-xs", "--shadow-sm", "--shadow-md", "--shadow-float",
  "--gray-100", "--gray-300", "--gray-600", "--mint-100", "--mint-700", "--yellow-100", "--yellow-700", "--purple-100", "--purple-500", "--pink-400", "--pink-700",
];

export const LEGACY_SELECTORS = ["motion-outline", "dash-outline", "line-outline-host", "motion-line-target", "is-outline-ready", "window-symbol--loading"];

export const IMPORT_ORDER = [
  "./styles/theme/tokens.css",
  "./styles/theme/base.css",
  "./styles/theme/primitives.css",
  "./styles/mail.css",
  "./styles/mail-pages.css",
  "./styles/admin.css",
  "./styles/intro.css",
  "./styles/login.css",
  "./styles/workspace.css",
  "./styles/notifications.css",
  "./styles/theme-controls.css",
  "./styles/search-motion.css",
  "./styles/reader.css",
  "./styles/dialogs.css",
  "./styles/theme/motion.css",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function styleSources() {
  const sources = [];
  for (const path of walk(webSrc)) {
    if (path.endsWith(".css")) sources.push({ path, css: readFileSync(path, "utf8") });
    else if (path.endsWith(".vue")) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) sources.push({ path, css: match[1] });
    }
  }
  return sources;
}

const tokens = existsSync(tokensPath) ? readFileSync(tokensPath, "utf8") : "";
if (!tokens) failures.push("缺少 web/src/styles/theme/tokens.css");
for (const [name, value] of Object.entries(THEME_TOKENS)) {
  const match = tokens.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) failures.push(`tokens.css 缺少 ${name}`);
  else if (match[1].trim().toLowerCase() !== value) failures.push(`tokens.css 的 ${name} 应为 ${value}，实际 ${match[1].trim()}`);
}

if (existsSync(join(stylesDir, "vendor"))) failures.push("web/src/styles/vendor 已退役，不应再存在");
const main = readFileSync(join(webSrc, "main.ts"), "utf8");
const imports = [...main.matchAll(/^import "(\.\/styles\/[^"]+)";$/gm)].map((match) => match[1]);
if (JSON.stringify(imports) !== JSON.stringify(IMPORT_ORDER)) failures.push(`main.ts 样式导入顺序应为：${IMPORT_ORDER.join(" → ")}`);

const sources = styleSources();
let checked = 0;
for (const { path, css } of sources) {
  checked += 1;
  const name = relative(root, path);
  if (path !== tokensPath) {
    const colors = css.match(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) ?? [];
    if (colors.length) failures.push(`${name} 出现 ${colors.length} 个写死的颜色，请改用 tokens.css 的令牌`);
  }
  for (const legacy of LEGACY_TOKENS) if (css.includes(`var(${legacy})`) || css.includes(`var(${legacy},`)) failures.push(`${name} 仍引用旧令牌 ${legacy}`);
  for (const selector of LEGACY_SELECTORS) if (css.includes(`.${selector}`)) failures.push(`${name} 仍有旧线条样式 .${selector}`);
  const open = (css.match(/{/g) ?? []).length;
  const close = (css.match(/}/g) ?? []).length;
  if (open !== close) failures.push(`${name} 大括号不配对`);
}

if (failures.length > 0) {
  console.error("FAIL: 主题样式合同未通过");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`OK: 主题令牌与参考面板一致（${Object.keys(THEME_TOKENS).length} 项）`);
console.log(`OK: 样式导入顺序正确，已无旧基座快照`);
console.log(`OK: ${checked} 份样式没有写死颜色、旧令牌或旧线条样式`);
