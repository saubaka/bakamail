import { db, nowIso } from "../db.ts";

export type AuditInput = {
  actorType?: string;
  actor?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  summary?: string;
  requestId?: string;
  identityHash?: string;
};

export function recordAudit(input: AuditInput): void {
  db.prepare(
    `insert into audit_logs
       (actor_type, actor, action, target_type, target_id, summary, request_id, identity_hash, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.actorType ?? "",
    input.actor ?? "",
    input.action,
    input.targetType ?? "",
    input.targetId ?? "",
    (input.summary ?? "").slice(0, 500),
    input.requestId ?? "",
    input.identityHash ?? "",
    nowIso(),
  );
}

export function listAuditLogs(limit = 100, offset = 0): unknown[] {
  return db
    .prepare(
      `select id, actor_type, actor, action, target_type, target_id, summary, request_id,
              identity_hash, created_at
       from audit_logs order by id desc limit ? offset ?`,
    )
    .all(limit, offset);
}
