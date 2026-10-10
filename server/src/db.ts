import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { config } from "./config.ts";

export const db = new DatabaseSync(join(config.dataDir, "bakamail.db"));

db.exec("pragma busy_timeout = 5000");
/*
 * 把库切换到 WAL 需要独占锁，而且 SQLite 不会为这条语句等待 busy_timeout：
 * 多个进程同时启动并首次转换同一个库时，其中一些会直接报 database is locked。
 * 已经是 WAL 的库不会触发；这里只在锁冲突时做有上限的短重试，其他错误照常抛出。
 */
function enableWal(): void {
  for (let attempt = 0; ; attempt += 1) {
    try { db.exec("pragma journal_mode = wal"); return; }
    catch (error) {
      if (attempt >= 60 || !/locked|busy/i.test(error instanceof Error ? error.message : String(error))) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 + (attempt % 5) * 15);
    }
  }
}
enableWal();
db.exec("pragma foreign_keys = on");

/** 建表语句全部幂等，启动时执行一次即可。 */
db.exec(`
create table if not exists admin_users (
  id integer primary key autoincrement,
  username text not null unique,
  display_name text not null default '',
  password_hash text not null,
  role text not null default 'admin',
  is_active integer not null default 1,
  created_at text not null,
  last_login_at text
);

create table if not exists admin_sessions (
  id text primary key,
  admin_id integer not null references admin_users(id),
  token_hash text not null unique,
  csrf_token text not null,
  fingerprint text not null default '',
  user_agent text not null default '',
  created_at text not null,
  last_active_at text not null,
  expires_at text not null,
  revoked_at text
);
create index if not exists ix_admin_sessions_admin on admin_sessions(admin_id, revoked_at);

create table if not exists mail_sessions (
  id text primary key,
  mailbox text not null,
  token_hash text not null unique,
  csrf_token text not null,
  fingerprint text not null default '',
  user_agent text not null default '',
  created_at text not null,
  last_active_at text not null,
  expires_at text not null,
  revoked_at text
);
create index if not exists ix_mail_sessions_mailbox on mail_sessions(mailbox, revoked_at);

create table if not exists login_logs (
  id integer primary key autoincrement,
  scope text not null,
  identity_hash text not null,
  account text not null default '',
  success integer not null,
  reason text not null default '',
  created_at text not null
);
create index if not exists ix_login_logs_identity on login_logs(scope, identity_hash, created_at);
create index if not exists ix_login_logs_created on login_logs(created_at);

create table if not exists audit_logs (
  id integer primary key autoincrement,
  actor_type text not null default '',
  actor text not null default '',
  action text not null,
  target_type text not null default '',
  target_id text not null default '',
  summary text not null default '',
  request_id text not null default '',
  identity_hash text not null default '',
  created_at text not null
);
create index if not exists ix_audit_logs_created on audit_logs(created_at);

create table if not exists human_challenges (
  id integer primary key autoincrement,
  purpose text not null,
  target_key text not null default '',
  nonce text not null,
  digest text not null,
  issued_at integer not null,
  expires_at integer not null,
  consumed_at text,
  fingerprint text not null default ''
);
create index if not exists ix_human_challenges_lookup on human_challenges(purpose, target_key, nonce);

create table if not exists invites (
  id integer primary key autoincrement,
  code_hash text not null unique,
  code_hint text not null,
  bound_address text not null default '',
  bound_domain text not null default '',
  note text not null default '',
  created_by text not null default '',
  created_at text not null,
  expires_at text not null,
  used_at text,
  used_by text not null default '',
  revoked_at text
);

create table if not exists blocked_identities (
  identity_hash text primary key,
  reason text not null default '',
  created_by text not null default '',
  created_at text not null
);

create table if not exists form_tokens (
  id integer primary key autoincrement,
  purpose text not null,
  token_hash text not null unique,
  issued_at integer not null,
  expires_at integer not null,
  consumed_at text
);
create index if not exists ix_form_tokens_lookup on form_tokens(purpose, token_hash);

create table if not exists contact_entries (
  id integer primary key autoincrement,
  owner text not null,
  name text not null default '',
  email text not null,
  note text not null default '',
  created_at text not null,
  updated_at text not null
);
create unique index if not exists ix_contact_owner_email on contact_entries(owner, email);

create table if not exists drafts (
  id text primary key,
  owner text not null,
  payload text not null,
  created_at text not null,
  updated_at text not null
);
create index if not exists ix_drafts_owner on drafts(owner, updated_at);

create table if not exists user_settings (
  owner text not null,
  key text not null,
  value text not null,
  updated_at text not null,
  primary key (owner, key)
);

create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at text not null
);
`);

export function nowIso(): string {
  return new Date().toISOString();
}

// Additive migrations preserve accounts, invites, cookies and historical logs.
db.exec("begin immediate");
try {
for (const [table, column, declaration] of [
  ["form_tokens", "context_hash", "text not null default ''"],
  ["login_logs", "account_hash", "text not null default ''"],
] as const) {
  const columns = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
  if (!columns.some((row) => row.name === column)) db.exec(`alter table ${table} add column ${column} ${declaration}`);
}
// Migrate legacy one-shot codes once. Never reopen a used/revoked/expired invitation.
const inviteColumns = db.prepare('pragma table_info(invites)').all() as { name: string }[];
if (!inviteColumns.some(row => row.name === 'used_count')) {
  db.exec(`alter table invites add column used_count integer not null default 0 check(used_count >= 0);
    update invites set used_count = 1 where used_at is not null;`);
}
if (!inviteColumns.some(row => row.name === 'max_uses')) {
  db.exec('alter table invites add column max_uses integer default 1 check(max_uses is null or max_uses between 1 and 1000000)');
}
if (!inviteColumns.some(row => row.name === 'reserved_count')) {
  db.exec('alter table invites add column reserved_count integer not null default 0 check(reserved_count >= 0)');
}
db.exec(`
create table if not exists invite_claims (
  token text primary key,
  invite_id integer not null references invites(id) on delete cascade,
  account text not null,
  claimed_at text not null,
  state text not null check(state in ('pending', 'completed', 'unconfirmed'))
);
create index if not exists ix_invite_claims_invite on invite_claims(invite_id, state);
create index if not exists ix_login_logs_account on login_logs(scope, account_hash, created_at);
create table if not exists security_cooldowns (
  scope text not null, identity_hash text not null, until_ms integer not null,
  primary key(scope, identity_hash)
);
create index if not exists ix_security_cooldown_expiry on security_cooldowns(until_ms);
create table if not exists security_budgets (
  id integer primary key, bucket text not null, identity_hash text not null,
  created_ms integer not null
);
create index if not exists ix_security_budget_source on security_budgets(bucket, identity_hash, created_ms);
create index if not exists ix_security_budget_global on security_budgets(bucket, created_ms);
create table if not exists security_leases (
  id text primary key, scope text not null, identity_hash text not null,
  account_hash text not null, expires_ms integer not null
);
create index if not exists ix_security_leases_scope on security_leases(scope, expires_ms);
create table if not exists admin_totp (
  admin_id integer primary key references admin_users(id) on delete cascade,
  secret text not null,
  enabled integer not null default 0 check(enabled in (0, 1)),
  last_step integer not null default 0,
  created_at text not null,
  enabled_at text
);
create table if not exists admin_recovery_codes (
  id integer primary key autoincrement,
  admin_id integer not null references admin_users(id) on delete cascade,
  code_hash text not null unique,
  used_at text
);
create index if not exists ix_admin_recovery_admin on admin_recovery_codes(admin_id, used_at);
create table if not exists admin_login_tickets (
  id integer primary key autoincrement,
  admin_id integer not null references admin_users(id) on delete cascade,
  token_hash text not null unique,
  identity_hash text not null,
  expires_ms integer not null,
  attempts integer not null default 0
);
create index if not exists ix_admin_login_tickets_expiry on admin_login_tickets(expires_ms);
create table if not exists ui_appearance (
  id integer primary key check(id = 1),
  schema_version integer not null,
  revision integer not null check(revision > 0),
  payload text not null,
  updated_at text not null
);
`);
db.exec("commit");
} catch (error) { db.exec("rollback"); throw error; }

export function isoOffset(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function getSetting(key: string, fallback = ""): string {
  const row = db.prepare("select value from app_settings where key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `insert into app_settings (key, value, updated_at) values (?, ?, ?)
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, nowIso());
}

export function getIntSetting(key: string, fallback: number): number {
  const value = Number.parseInt(getSetting(key, ""), 10);
  return Number.isFinite(value) ? value : fallback;
}
