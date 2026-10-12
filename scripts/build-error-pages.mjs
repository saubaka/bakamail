/**
 * 生成给反向代理用的静态错误页（后端挂掉时，502/503/504 由代理自己返回，应用来不及渲染）。
 * 用法：node scripts/build-error-pages.mjs          写入 deploy/error-pages/
 *       node scripts/build-error-pages.mjs --check  只检查文件是否与生成结果一致
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderErrorDocument } from "../shared/errorPage.ts";

export const STATIC_ERROR_STATUSES = [500, 502, 503, 504];
/** 静态页没有脚本，年份固定；跨年后重新运行本脚本即可。 */
export const STATIC_ERROR_YEAR = 2026;

export const staticErrorPages = () => Object.fromEntries(
  STATIC_ERROR_STATUSES.map((status) => [`${status}.html`, renderErrorDocument({ status, year: STATIC_ERROR_YEAR })]),
);

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "error-pages");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  if (!check) mkdirSync(target, { recursive: true });
  for (const [name, html] of Object.entries(staticErrorPages())) {
    const path = join(target, name);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === html) continue;
    stale += 1;
    if (!check) writeFileSync(path, html);
  }
  console.log(check ? (stale ? `有 ${stale} 个静态错误页与生成结果不一致` : "静态错误页与生成结果一致") : `已写入静态错误页（更新 ${stale} 个）`);
  if (check && stale) process.exitCode = 1;
}
