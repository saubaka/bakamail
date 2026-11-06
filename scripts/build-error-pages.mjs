import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_COPY, renderErrorDocument } from "../shared/errorPage.ts";

export const STATIC_ERROR_STATUSES = [403, 404, 500, 503];
export const STATIC_ERROR_YEAR = 2026;

export const staticErrorPages = () => ({
  ...Object.fromEntries(STATIC_ERROR_STATUSES.map((status) => [`${status}.html`, renderErrorDocument({ status, year: STATIC_ERROR_YEAR })])),
  "unreachable.html": renderErrorDocument({ status: 503, copy: ERROR_COPY[502], year: STATIC_ERROR_YEAR }),
});

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
