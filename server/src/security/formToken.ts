import { db, nowIso } from "../db.ts";
import { hashToken, randomToken } from "./identity.ts";
import { enforceBudget } from "./abuse.ts";

/**
 * 一次性表单令牌：页面加载时下发，提交时必须原样带回。
 * 绑定用途/来源并以服务端时间检查填写耗时；不代替验证码或请求预算。
 */
export function issueFormToken(purpose: string, ttlSeconds = 1800, contextHash = ""): string {
  enforceBudget("form-token", contextHash);
  const token = randomToken(24);
  const now = Date.now();
  db.prepare("delete from form_tokens where expires_at < ?").run(now);
  db.prepare(
    `insert into form_tokens (purpose, token_hash, issued_at, expires_at, context_hash) values (?, ?, ?, ?, ?)`,
  ).run(purpose, hashToken(token), now, now + ttlSeconds * 1000, contextHash);
  db.prepare(
    `delete from form_tokens where purpose = ? and id not in (
       select id from form_tokens where purpose = ? order by id desc limit 500
     )`,
  ).run(purpose, purpose);
  return token;
}

export function consumeFormToken(purpose: string, token: string, contextHash = "", minAgeSeconds = 0): boolean {
  if (!token) return false;
  const row = db
    .prepare(
      `update form_tokens set consumed_at = ? where purpose = ? and token_hash = ?
       and context_hash = ? and consumed_at is null returning id, issued_at, expires_at`,
    )
    .get(nowIso(), purpose, hashToken(token.slice(0, 200)), contextHash) as { id: number; issued_at: number; expires_at: number } | undefined;
  if (!row) return false;
  return row.expires_at > Date.now() && Date.now() - row.issued_at >= minAgeSeconds * 1000;
}
