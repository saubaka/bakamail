/**
 * 生成给反向代理用的静态错误页（后端挂掉时 502/503/504 由代理自己返回，应用来不及渲染；代理自己拦截的 403/404 也一样）。
 * 用法：node scripts/build-error-pages.mjs          写入 deploy/error-pages/
 *       node scripts/build-error-pages.mjs --check  只检查文件是否与生成结果一致
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_COPY, renderErrorDocument } from "../shared/errorPage.ts";

/**
 * 403、404 是代理自己返回的（例如拦截规则）；500、503 是后端出问题时代理返回的。
 * 502、504（后端连不上或超时）不直接返回：站点放在 Cloudflare 之类的服务后面时，它们会把 502/504 换成自己的纯文本页，
 * 所以改成返回 503 加 unreachable.html（外观和文案是“暂时连不上服务”），503 会原样透传。
 */
export const STATIC_ERROR_STATUSES = [403, 404, 500, 503];
/** 静态页没有脚本，年份固定；跨年后重新运行本脚本即可。 */
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
