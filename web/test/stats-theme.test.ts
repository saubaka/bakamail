import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IMPORT_ORDER, LEGACY_TOKENS, THEME_TOKENS } from "../../scripts/verify-style-contract.mjs";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const read = (path: string) => readFileSync(join(src, path), "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const styleBlocks = () => walk(src).flatMap((path) => {
  if (path.endsWith(".css")) return [{ path, css: readFileSync(path, "utf8") }];
  if (!path.endsWith(".vue")) return [];
  return [...readFileSync(path, "utf8").matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => ({ path, css: match[1]! }));
});
const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("配色、圆角、缓动取自参考面板：浅灰字、浅蓝、白偏粉，四档圆角和同一组缓动", () => {
  const tokens = read("styles/theme/tokens.css");
  for (const [name, value] of Object.entries(THEME_TOKENS)) assert.match(tokens, new RegExp(`${name}: ${value.replace(/[().]/g, "\\$&")};`), name);
  assert.match(tokens, /--shadow-1: 0 1px 2px rgba\(150, 130, 140, \.06\), 0 8px 24px rgba\(150, 130, 140, \.08\);/);
  assert.match(tokens, /--shadow-2: 0 2px 6px rgba\(150, 130, 140, \.08\), 0 18px 44px rgba\(150, 130, 140, \.14\);/);
});

test("旧样式完全退役：没有旧基座快照、旧令牌、旧描边线条组件，样式只按约定顺序加载", () => {
  assert.equal(existsSync(join(src, "styles/vendor")), false);
  for (const gone of ["styles/app.css", "styles/local-theme.css", "styles/dashed-accent.css", "styles/mail-overrides.css", "styles/motion.css", "components/LineOutline.vue", "surfaceLines.ts", "outlineGeometry.ts", "components/MailPageHeader.vue"]) {
    assert.equal(existsSync(join(src, gone)), false, gone);
  }
  const imports = [...read("main.ts").matchAll(/^import "(\.\/styles\/[^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, IMPORT_ORDER);
  for (const { path, css } of styleBlocks()) {
    if (!path.endsWith("tokens.css")) assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, path);
    for (const legacy of LEGACY_TOKENS) assert.ok(!css.includes(`var(${legacy})`) && !css.includes(`var(${legacy},`), `${path} ${legacy}`);
    assert.doesNotMatch(css, /\.(motion-outline|dash-outline|line-outline-host|motion-line-target)\b/, path);
  }
  for (const path of walk(src).filter((file) => /\.(ts|vue)$/.test(file))) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /LineOutline|attachSurfaceLines|applyOutline|motion-outline/, path);
  }
});

test("胶囊菜单沿用项目 1 的灵动岛：白色磨砂胶囊、细线、浮起阴影，选中项是浅蓝实心滑块并用弹性曲线移动", () => {
  const css = read("styles/workspace.css");
  const dock = rule(css, ".mail-bottom-dock");
  for (const piece of ["border: 1px solid var(--line)", "border-radius: var(--r-pill)", "background: var(--glass)", "box-shadow: var(--shadow-2)", "backdrop-filter: blur(14px) saturate(1.3)", "animation: dock-island-up 1s var(--spring-soft)"]) assert.ok(dock.includes(piece), piece);
  assert.match(rule(css, ".mail-bottom-dock.is-scroll-hidden"), /opacity: 0; scale: \.9; translate: -50% 26px; filter: blur\(4px\);/);
  assert.match(rule(css, ".dock-item"), /height: 40px; padding: 0 16px; border: 0; border-radius: 20px;[^}]*font-size: 14px; font-weight: 600;/);
  assert.match(rule(css, ".dock-active-pill"), /border-radius: 20px; background: var\(--blue-100\)/);
  assert.match(read("mail/highlightMotion.ts"), /HIGHLIGHT_MS = 700/);
  assert.match(read("enterMotion.ts"), /SPRING_SOFT = "linear\(0, \.0202/);
  assert.match(read("styles/theme/tokens.css"), /--spring-soft: linear\(0, \.0202/);
  const admin = read("styles/admin.css");
  assert.match(rule(admin, ".admin-rail__indicator"), /border-radius: 20px; background: var\(--blue-100\)/);
  assert.match(rule(admin, ".admin-rail__indicator.is-ready"), /transform var\(--t-soft\) var\(--spring-soft\)/);
});

test("卡片、磁贴、按钮与入场动画沿用参考面板：白卡细线柔影，磁贴悬停上浮，入场淡入上浮带轻微模糊", () => {
  const primitives = read("styles/theme/primitives.css");
  assert.match(rule(primitives, ".card, .admin-panel, .managed-page-card"), /border: 1px solid var\(--card-line\); border-radius: var\(--r-xl\); background: var\(--surface\); box-shadow: var\(--shadow-1\);/);
  assert.match(rule(primitives, ".button--primary"), /background: var\(--blue-300\); color: var\(--ink\); box-shadow: var\(--shadow-btn\);/);
  assert.match(rule(primitives, ".button--danger"), /background: var\(--bad-bg\); color: var\(--bad-ink\);/);
  const admin = read("styles/admin.css");
  assert.match(rule(admin, ".baka-overview-stat:hover"), /translate: 0 -3px; background: var\(--surface\); box-shadow: var\(--shadow-1\);/);
  assert.match(rule(admin, ".baka-overview-stat:hover .baka-overview-stat__icon"), /transform: rotate\(-8deg\) scale\(1\.08\);/);
  const enter = read("enterMotion.ts");
  assert.match(enter, /ENTER_EASING = "cubic-bezier\(\.22,1,\.36,1\)"/);
  assert.match(enter, /scale\(\.98\)/);
  assert.match(enter, /blur\(6px\)/);
  const base = read("styles/theme/base.css");
  assert.match(base, /\.app-orbs i:nth-child\(1\) \{[^}]*background: var\(--blue-200\); \}/);
  assert.match(base, /\.app-orbs i:nth-child\(2\) \{[^}]*background: var\(--pink-200\);/);
  assert.match(read("App.vue"), /<div class="app-orbs" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/div>/);
  assert.match(read("styles/theme/motion.css"), /html\[data-motion="reduce"\] \.app-orbs i \{ animation: none !important; \}/);
});

test("界面里没有从左到右的横向渐变（用户偏好），进度条和评分条用纯色", () => {
  for (const { path, css } of styleBlocks()) {
    for (const match of css.matchAll(/linear-gradient\((\d+)deg/g)) {
      const angle = Number(match[1]);
      const decorative = /::after|shimmer|glint|search-cancel/.test(css.slice(Math.max(0, match.index! - 260), match.index));
      if (!decorative) assert.ok(angle === 180 || angle === 145 || angle === 215, `${path} 出现 ${angle}deg 横向渐变`);
    }
  }
  assert.match(rule(read("styles/theme/primitives.css"), ".progress span"), /background: var\(--blue-400\);/);
});
