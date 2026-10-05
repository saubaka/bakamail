import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 管理员密码哈希。
 *
 * 规划里写的是 argon2id；实现改用 Node 内置的 scrypt，原因是 argon2 需要原生
 * 编译依赖，而本项目的部署原则是不引入原生依赖（SQLite 也走 node:sqlite）。
 * scrypt 同样是内存硬函数，配合下面的参数足以对抗离线爆破。
 */
const N = 1 << 15;
const r = 8;
const p = 1;
const KEY_LEN = 32;
// scrypt 需要 128 * N * r 字节，默认 maxmem 32 MiB 不够
const MAX_MEM = 96 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
  return ["scrypt", N, r, p, salt.toString("base64"), derived.toString("base64")].join("$");
}

export function verifyPassword(stored: string, password: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const nRaw = parts[1] ?? "";
  const rRaw = parts[2] ?? "";
  const pRaw = parts[3] ?? "";
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (expected.length === 0) return false;
  const derived = scryptSync(password.normalize("NFKC"), salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: MAX_MEM,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** 密码强度：至少 10 位，且不是纯数字或纯字母。 */
export function passwordProblem(password: string): string {
  if (password.length < 10) return "密码至少 10 位";
  if (password.length > 200) return "密码过长";
  if (/^\d+$/.test(password)) return "密码不能是纯数字";
  if (/^[a-zA-Z]+$/.test(password)) return "密码不能是纯字母";
  return "";
}

/** Login uses the bounded libuv work queue, never scryptSync on the event loop. */
export async function verifyPasswordAsync(stored: string, password: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || password.length > 200) return false;
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (expected.length !== KEY_LEN || Number(parts[1]) !== N || Number(parts[2]) !== r || Number(parts[3]) !== p) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, { N, r, p, maxmem: MAX_MEM }, (error, result) => error ? reject(error) : resolve(result));
  });
  return timingSafeEqual(derived, expected);
}
