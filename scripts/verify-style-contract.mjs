import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptsDir, "..");
const manifestPath = join(root, "web/src/styles/vendor/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function lineCount(buffer) {
  let count = 0;
  for (const byte of buffer) if (byte === 10) count += 1;
  return count;
}

for (const entry of manifest.files) {
  const target = join(root, entry.target);
  if (!existsSync(target)) {
    failures.push(`${entry.id}: 缺少快照 ${entry.target}`);
    continue;
  }

  const targetBuffer = readFileSync(target);
  const targetHash = sha256(targetBuffer);
  const targetLines = lineCount(targetBuffer);
  if (targetHash !== entry.sha256) {
    failures.push(`${entry.id}: 快照 SHA-256 不一致，期望 ${entry.sha256}，实际 ${targetHash}`);
  }
  if (targetLines !== entry.lines) {
    failures.push(`${entry.id}: 行数不一致，期望 ${entry.lines}，实际 ${targetLines}`);
  }

  const source = resolve(root, entry.source);
  if (existsSync(source)) {
    const sourceHash = sha256(readFileSync(source));
    if (sourceHash !== targetHash) {
      // Releases use the immutable, hash-verified snapshot, not a sibling project's later edits.
      // Normal development remains strict so upstream drift is not silently ignored.
      if (process.env.BAKAMAIL_PINNED_VENDOR === "1") {
        console.warn(`WARN: ${entry.id}: 上级源文件已更新，本次发布保留 manifest 锁定快照`);
      } else failures.push(`${entry.id}: 快照与当前文件夹 1 源文件不一致`);
    }
  }
}

const mainSource = readFileSync(join(root, "web/src/main.ts"), "utf8");
const requiredImports = [
  './styles/vendor/project1-app.css',
  './styles/vendor/project1-small-window-theme.css',
  './styles/mail-overrides.css',
  './styles/mail-pages.css',
  './styles/admin.css',
  './styles/motion.css',
];
let previousIndex = -1;
for (const stylesheet of requiredImports) {
  const index = mainSource.indexOf(stylesheet);
  if (index === -1) failures.push(`main.ts 缺少样式导入 ${stylesheet}`);
  if (index !== -1 && index < previousIndex) failures.push(`main.ts 样式导入顺序错误：${stylesheet}`);
  previousIndex = Math.max(previousIndex, index);
}

const featureFiles = ["mail-overrides.css", "mail-pages.css", "admin.css", "motion.css"];
for (const file of featureFiles) {
  const featureStyles = readFileSync(join(root, "web/src/styles", file), "utf8");
  const hardcodedColors = featureStyles.match(/#[\da-f]{3,8}\b|rgba?\(/gi) ?? [];
  if (hardcodedColors.length > 0) {
    failures.push(`${file} 出现 ${hardcodedColors.length} 个硬编码颜色，请改用项目 1 令牌`);
  }
}

const runtimeBase = readFileSync(join(root, "web/src/styles/app.css"));
const authoritativeBase = readFileSync(join(root, "web/src/styles/vendor/project1-app.css"));
if (!runtimeBase.equals(authoritativeBase)) {
  failures.push("web/src/styles/app.css 与项目 1 正式基座快照不一致");
}

if (failures.length > 0) {
  console.error("FAIL: 项目 1 样式合同未通过");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`OK: 已校验 ${manifest.files.length} 份项目 1 CSS 快照`);
for (const entry of manifest.files) {
  console.log(`  ${entry.id}: ${entry.lines} 行 / ${entry.sha256}`);
}
console.log("OK: 正式基座 → 小窗最终主题 → BakaMail 增量样式的导入顺序正确");
console.log(`OK: ${featureFiles.length} 份 BakaMail 增量样式没有自建硬编码颜色`);
