#!/usr/bin/env node
// Exact source recovery; no passwords, sessions, invites or mailboxes are changed.
const args = process.argv.slice(2);
const identity = args[0] ?? "";
const apply = args[1] === "--apply";
if (!/^[a-f0-9]{32}$/.test(identity) || args.length > 2 || args[1] && !apply) {
  console.error("用法：node scripts/recover-auth-source.mjs <32位来源指纹> [--apply]");
  process.exit(2);
}
const { db } = await import("../server/src/db.ts");
const { unblockIdentity } = await import("../server/src/security/rateLimit.ts");
const { recordAudit } = await import("../server/src/security/audit.ts");
const blocked = Boolean(db.prepare("select 1 from blocked_identities where identity_hash = ?").get(identity));
const cooldowns = db.prepare("select scope, until_ms from security_cooldowns where identity_hash = ? and until_ms > ?").all(identity, Date.now());
console.log(JSON.stringify({ identity, blocked, cooldowns }, null, 2));
if (apply) {
  const recovered = unblockIdentity(identity);
  if (recovered) recordAudit({ actorType: "system", actor: "local-console", action: "security.recover-source",
    targetType: "identity", targetId: identity, summary: "解除指定来源封禁/冷却，保留请求预算及历史记录" });
  console.log(recovered ? "指定来源已恢复；请求预算、验证码及新的失败限速仍有效" : "该来源没有正在生效的封禁或冷却");
}
db.close();
