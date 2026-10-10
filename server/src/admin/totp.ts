import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db, nowIso } from "../db.ts";
import { hashToken } from "../security/identity.ts";
import { openWith, sealWith } from "../security/secretBox.ts";

/** 后台二步验证（TOTP，RFC 6238：HMAC-SHA1、6 位、30 秒）。兼容常见的验证器应用。 */
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
const WINDOW = 1; // 接受前后各一个时间片，容忍手机与服务器的少量时钟偏差。
export const TICKET_TTL_MS = 5 * 60_000;
export const TICKET_MAX_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

const equal = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** 返回命中的时间片；没有命中返回 null。`afterStep` 之前（含）的时间片不接受，防止同一个码被重放。 */
export function matchTotp(secret: Buffer, code: string, afterStep: number, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowMs / 1000 / TOTP_PERIOD);
  let matched: number | null = null;
  for (let step = current - WINDOW; step <= current + WINDOW; step += 1) {
    // 不提前退出：每个窗口都比较，避免用耗时差异猜测哪一个时间片命中。
    if (equal(totpAt(secret, step), code) && step > afterStep) matched = step;
  }
  return matched;
}

// ---- 密钥落库前加密：数据库文件泄露本身不足以还原二步验证密钥 ----
const SECRET_CONTEXT = "bakamail-admin-totp-v1";
export const sealSecret = (base32: string): string => sealWith(SECRET_CONTEXT, base32);
export const openSecret = (sealed: string): string => openWith(SECRET_CONTEXT, sealed);

type Row = { admin_id: number; secret: string; enabled: number; last_step: number };

export function totpState(adminId: number): { enabled: boolean; pending: boolean; recoveryRemaining: number } {
  const row = db.prepare("select enabled from admin_totp where admin_id = ?").get(adminId) as { enabled: number } | undefined;
  const remaining = db.prepare("select count(*) as n from admin_recovery_codes where admin_id = ? and used_at is null").get(adminId) as { n: number };
  return { enabled: row?.enabled === 1, pending: row?.enabled === 0, recoveryRemaining: row?.enabled === 1 ? remaining.n : 0 };
}

export function totpEnabled(adminId: number): boolean { return totpState(adminId).enabled; }

/** 重新生成待确认的密钥；已启用时拒绝，必须先停用。 */
export function beginTotpSetup(adminId: number, username: string): { secret: string; uri: string } | null {
  if (totpEnabled(adminId)) return null;
  const secret = base32Encode(randomBytes(20));
  db.prepare(`insert into admin_totp (admin_id, secret, enabled, last_step, created_at) values (?, ?, 0, 0, ?)
    on conflict(admin_id) do update set secret = excluded.secret, enabled = 0, last_step = 0, created_at = excluded.created_at, enabled_at = null`)
    .run(adminId, sealSecret(secret), nowIso());
  const label = encodeURIComponent(`BakaMail:${username}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=BakaMail&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}` };
}

function generateRecoveryCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = () => Array.from({ length: 5 }, () => alphabet[randomInt(0, alphabet.length)]).join("");
  return `${pick()}-${pick()}`;
}
const recoveryHash = (code: string): string => hashToken(`recovery|${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`);

/** 用待确认密钥生成的当前验证码确认后才真正启用，并一次性生成恢复码（只显示这一次）。 */
export function confirmTotpSetup(adminId: number, code: string): string[] | null {
  const row = db.prepare("select * from admin_totp where admin_id = ? and enabled = 0").get(adminId) as Row | undefined;
  if (!row) return null;
  const step = matchTotp(base32Decode(openSecret(row.secret)), code, 0);
  if (step === null) return null;
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  db.exec("begin immediate");
  try {
    db.prepare("update admin_totp set enabled = 1, last_step = ?, enabled_at = ? where admin_id = ?").run(step, nowIso(), adminId);
    db.prepare("delete from admin_recovery_codes where admin_id = ?").run(adminId);
    const insert = db.prepare("insert into admin_recovery_codes (admin_id, code_hash) values (?, ?)");
    for (const value of codes) insert.run(adminId, recoveryHash(value));
    db.exec("commit");
  } catch (error) { db.exec("rollback"); throw error; }
  return codes;
}

/** 校验第二因素：先试 6 位动态码（含防重放），再试恢复码（一次性）。返回使用的方式。 */
export function verifySecondFactor(adminId: number, input: string): "totp" | "recovery" | null {
  const row = db.prepare("select * from admin_totp where admin_id = ? and enabled = 1").get(adminId) as Row | undefined;
  if (!row) return null;
  const value = input.trim();
  if (/^\d{6}$/.test(value)) {
    const step = matchTotp(base32Decode(openSecret(row.secret)), value, row.last_step);
    if (step === null) return null;
    // 条件更新保证并发提交同一个码时只有一个成功。
    const result = db.prepare("update admin_totp set last_step = ? where admin_id = ? and last_step < ?").run(step, adminId, step);
    return result.changes ? "totp" : null;
  }
  if (/^[a-z0-9]{5}-?[a-z0-9]{5}$/i.test(value)) {
    const result = db.prepare("update admin_recovery_codes set used_at = ? where admin_id = ? and code_hash = ? and used_at is null")
      .run(nowIso(), adminId, recoveryHash(value));
    return result.changes ? "recovery" : null;
  }
  return null;
}

export function disableTotp(adminId: number): boolean {
  db.exec("begin immediate");
  try {
    const removed = db.prepare("delete from admin_totp where admin_id = ?").run(adminId);
    db.prepare("delete from admin_recovery_codes where admin_id = ?").run(adminId);
    db.prepare("delete from admin_login_tickets where admin_id = ?").run(adminId);
    db.exec("commit");
    return Number(removed.changes) > 0;
  } catch (error) { db.exec("rollback"); throw error; }
}

// ---- 登录票据：密码和验证码都通过之后才签发，绑定来源、5 分钟有效、最多试 5 次、只能用一次 ----
export function issueLoginTicket(adminId: number, identityHash: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("delete from admin_login_tickets where expires_ms < ?").run(now);
  // 每个管理员同时只保留最近的 3 张，避免票据堆积。
  db.prepare(`delete from admin_login_tickets where admin_id = ? and id not in
    (select id from admin_login_tickets where admin_id = ? order by id desc limit 2)`).run(adminId, adminId);
  db.prepare("insert into admin_login_tickets (admin_id, token_hash, identity_hash, expires_ms) values (?, ?, ?, ?)")
    .run(adminId, hashToken(token), identityHash, now + TICKET_TTL_MS);
  return token;
}

export type TicketLookup = { ok: true; adminId: number; id: number } | { ok: false; reason: "invalid" | "expired" | "too-many" };

/** 取出票据并计一次尝试；超过次数或过期时销毁。成功使用后由调用方 consumeTicket。 */
export function checkTicket(token: string, identityHash: string): TicketLookup {
  const row = db.prepare("select id, admin_id, identity_hash, expires_ms, attempts from admin_login_tickets where token_hash = ?")
    .get(hashToken(String(token).slice(0, 100))) as { id: number; admin_id: number; identity_hash: string; expires_ms: number; attempts: number } | undefined;
  if (!row || row.identity_hash !== identityHash) return { ok: false, reason: "invalid" };
  if (row.expires_ms < Date.now()) { db.prepare("delete from admin_login_tickets where id = ?").run(row.id); return { ok: false, reason: "expired" }; }
  const attempts = row.attempts + 1;
  if (attempts > TICKET_MAX_ATTEMPTS) { db.prepare("delete from admin_login_tickets where id = ?").run(row.id); return { ok: false, reason: "too-many" }; }
  db.prepare("update admin_login_tickets set attempts = ? where id = ?").run(attempts, row.id);
  return { ok: true, adminId: row.admin_id, id: row.id };
}

export function consumeTicket(id: number): boolean {
  return Number(db.prepare("delete from admin_login_tickets where id = ?").run(id).changes) > 0;
}
