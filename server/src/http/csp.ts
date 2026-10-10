import { randomBytes } from "node:crypto";

/** 每次页面响应一个新的随机值；既用于页面自己的内联脚本，也用于邮件阅读框架里的几何脚本。 */
export function newCspNonce(): string {
  return randomBytes(18).toString("base64");
}

/**
 * 页面级内容安全策略。
 *
 * - 脚本只允许本站文件和带 nonce 的内联脚本，禁止 eval 与外部脚本。
 * - 邮件正文放在 srcdoc 沙箱框架里，srcdoc 会继承这份策略，所以 img-src 需要放行 http/https，
 *   由框架自己更严格的策略（默认拦截远程图片，只有用户本次同意才放行）进一步收紧；
 *   框架里的脚本必须使用同一个 nonce，否则会被继承的策略拦截。
 * - 保存过 Turnstile 站点密钥后，script-src、frame-src、connect-src 额外放行 challenges.cloudflare.com（仅此一个主机）。
 * - style-src 保留 'unsafe-inline'：界面大量使用内联样式变量，且样式注入无法执行脚本。
 */
export function pageCsp(nonce: string, options: { turnstile?: boolean } = {}): string {
  // 只有管理员保存过 Turnstile 站点密钥时，才放行 Cloudflare 的脚本、框架和校验连接。
  const cloudflare = options.turnstile ? " https://challenges.cloudflare.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${cloudflare}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:",
    "font-src 'self' data:",
    `connect-src 'self'${cloudflare}`,
    `frame-src 'self'${cloudflare}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** 只给没有属性的内联 <script> 加 nonce；带 src 的模块脚本由 'self' 放行。 */
export function withNonce(html: string, nonce: string): string {
  return html.replace(/<script>/g, `<script nonce="${nonce}">`);
}
