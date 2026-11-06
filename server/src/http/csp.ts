import { randomBytes } from "node:crypto";

export function newCspNonce(): string {
  return randomBytes(18).toString("base64");
}

export function pageCsp(nonce: string, options: { turnstile?: boolean } = {}): string {
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

export function withNonce(html: string, nonce: string): string {
  return html.replace(/<script>/g, `<script nonce="${nonce}">`);
}
