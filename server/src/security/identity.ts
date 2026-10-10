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

/**
 * 一个 IPv6 用户通常拥有整段 /64。限流若按完整地址计数，攻击者在自己的段内换地址
 * 就能无限制地制造“新来源”。因此对全球单播 IPv6 只保留前 64 位作为来源标识。
 * 回环、IPv4 映射和链路本地地址保持原样；这个值只用于限流和审计指纹。
 */
export function rateLimitSource(address: string): string {
  if (isIP(address) !== 6 || address === "::1") return address;
  const groups = expandIpv6(address);
  if (!groups) return address;
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return address;
  return `${groups.slice(0, 4).map((value) => value.toString(16)).join(":")}::/64`;
}

function expandIpv6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => part === "" ? [] : part.split(":").map((value) => Number.parseInt(value, 16));
  const head = parse(halves[0]!), tail = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array<number>(halves.length === 2 ? missing : 0).fill(0), ...tail];
  return groups.length === 8 && groups.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff) ? groups : null;
}

/** 1Panel overwrites X-Real-IP; Docker may translate the loopback peer into its bridge gateway. */
export function clientAddress(
  headers: Record<string, unknown>,
  socketAddress?: string,
): string {
  const peer = normalizeIp(socketAddress ?? "");
  if (!isTrustedProxyPeer(peer)) return peer ? rateLimitSource(peer) : "unknown";
  const real = headers["x-real-ip"];
  if (typeof real === "string" && normalizeIp(real.trim())) return rateLimitSource(normalizeIp(real.trim()));
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const last = forwarded.split(",").at(-1)?.trim();
    if (last && normalizeIp(last)) return rateLimitSource(normalizeIp(last));
  }
  return peer ? rateLimitSource(peer) : "unknown";
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
