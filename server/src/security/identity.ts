import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { config } from "../config.ts";

/**
 * 用 HMAC 把作用域 + 来源地址折叠成一个不可逆指纹。
 * 限流、审计、封禁都只保存这个指纹，不直接落 IP。
 */
export function fingerprint(scope: string, address: string): string {
  return createHmac("sha256", config.secretKey)
    .update(`${scope}|${address}`)
    .digest("hex")
    .slice(0, 32);
}

export function hashToken(token: string): string {
  return createHmac("sha256", config.secretKey).update(`token|${token}`).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 1Panel overwrites X-Real-IP; Docker may translate the loopback peer into its bridge gateway. */
export function clientAddress(
  headers: Record<string, unknown>,
  socketAddress?: string,
): string {
  const peer = normalizeIp(socketAddress ?? "");
  if (!isTrustedProxyPeer(peer)) return peer || "unknown";
  const real = headers["x-real-ip"];
  if (typeof real === "string" && normalizeIp(real.trim())) return normalizeIp(real.trim());
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const last = forwarded.split(",").at(-1)?.trim();
    if (last && normalizeIp(last)) return normalizeIp(last);
  }
  return peer || "unknown";
}

export function normalizeIp(value: string): string {
  if (value.startsWith("::ffff:") && isIP(value.slice(7)) === 4) return value.slice(7);
  if (!isIP(value)) return "";
  // WHATWG URL serialization canonicalizes equivalent IPv6 spellings.
  if (isIP(value) !== 6) return value;
  try { return new URL(`http://[${value}]/`).hostname.slice(1, -1); } catch { return ""; }
}

export function isLoopbackPeer(value: string): boolean {
  return value === "::1" || /^127\./.test(value) && isIP(value) === 4;
}

export function isTrustedProxyPeer(value: string): boolean {
  const peer = normalizeIp(value);
  if (!peer) return false;
  return config.trustLoopbackProxy && isLoopbackPeer(peer)
    || config.trustedProxyIps.some(address => normalizeIp(address) === peer);
}
