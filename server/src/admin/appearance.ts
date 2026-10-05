import { db, nowIso } from '../db.ts';
import { recordAudit, type AuditInput } from '../security/audit.ts';
import { isUiConfig, NOTIFICATION_TYPES, type UiConfig } from '../../../shared/notificationMotion.ts';
import { applyLegacyMotionEdit, defaultUiConfigV2, normalizeUiConfigV2, projectUiConfigV1,
  type UiConfigV2 } from '../../../shared/notificationDisplay.ts';

export type AppearanceSchemaVersion = 1 | 2;

export class AppearanceError extends Error {
  readonly status: 400 | 409 | 503;
  readonly code: string;
  constructor(status: 400 | 409 | 503, code: string, message: string) {
    super(message); this.name = 'AppearanceError'; this.status = status; this.code = code;
  }
}
const unavailable = () => new AppearanceError(503, 'appearance_unavailable', '通知配置暂时不可读写，请稍后重新读取；当前配置未被覆盖');

/** Absent row is a new installation; corrupt/unsupported rows are NEVER editable defaults. */
export function readAppearanceV2(): UiConfigV2 {
  try {
    const row = db.prepare('select schema_version, revision, payload from ui_appearance where id = 1').get() as
      { schema_version: number; revision: number; payload: string } | undefined;
    if (!row) return defaultUiConfigV2();
    if (Buffer.byteLength(row.payload, 'utf8') > 8192) throw unavailable();
    const parsed: unknown = JSON.parse(row.payload);
    const normalized = normalizeUiConfigV2(parsed);
    if (!normalized || row.schema_version !== (parsed as UiConfig | UiConfigV2).schemaVersion
      || row.revision !== normalized.revision || row.revision < 1) throw unavailable();
    // A valid v1 row is upgraded in memory only. Reads never alter payload/revision/audit.
    return normalized;
  } catch { throw unavailable(); }
}

export function readAppearance(version: AppearanceSchemaVersion = 1): UiConfig | UiConfigV2 {
  const current = readAppearanceV2();
  return version === 2 ? current : projectUiConfigV1(current);
}

export function readPublicAppearance(version: AppearanceSchemaVersion = 1): { config: UiConfig | UiConfigV2; fallback: boolean } {
  try { return { config: readAppearance(version), fallback: false }; }
  catch {
    const defaults = defaultUiConfigV2();
    return { config: version === 2 ? defaults : projectUiConfigV1(defaults), fallback: true };
  }
}

export function saveAppearance(input: unknown, actor: Pick<AuditInput, 'actor' | 'requestId'>): UiConfig | UiConfigV2 {
  const submitted = normalizeUiConfigV2(input), legacy = isUiConfig(input);
  if (!submitted) throw new AppearanceError(400, 'invalid_appearance', '请提交完整的第1或第2版通知配置；显示时长为1–120秒整秒，动画时长为规定范围内的毫秒整数');
  let transaction = false;
  try {
    // Serialized across processes: read revision + write + audit are one atomic unit.
    db.exec('begin immediate'); transaction = true;
    const current = readAppearanceV2();
    if (current.revision !== submitted.revision) throw new AppearanceError(409, 'appearance_conflict', '通知配置已被其他管理员修改，请重新读取后再保存');
    if (submitted.revision === Number.MAX_SAFE_INTEGER) throw new AppearanceError(409, 'appearance_revision_exhausted', '配置版本号已达上限，请联系维护者');
    // Legacy editors can only replace motion. The display policy is taken from the locked row.
    const next = legacy ? applyLegacyMotionEdit(current, input) : submitted;
    if (!next) throw unavailable();
    next.revision++;
    db.prepare(`insert into ui_appearance(id, schema_version, revision, payload, updated_at) values(1, ?, ?, ?, ?)
      on conflict(id) do update set schema_version=excluded.schema_version, revision=excluded.revision,
      payload=excluded.payload, updated_at=excluded.updated_at`).run(next.schemaVersion, next.revision, JSON.stringify(next), nowIso());
    // Compact bounded audit: named timings + finite display modes, never the raw request.
    recordAudit({ ...actor, actorType: 'admin', action: 'appearance.update', targetType: 'ui_appearance',
      summary: JSON.stringify({ keys: ['enterMs', 'exitMs', 'textOutMs', 'textInMs'],
        ...Object.fromEntries(NOTIFICATION_TYPES.map(type => {
          const t = next.notificationMotion.types[type]; return [type, [t.enterMs, t.exitMs, t.textOutMs, t.textInMs]];
        })), stackMs: next.notificationMotion.stackMs,
        display: Object.fromEntries(NOTIFICATION_TYPES.map(type => {
          const policy = next.notificationDisplay.types[type];
          return [type, policy.mode === 'timed' || policy.mode === 'timedHide' ? [policy.mode, policy.durationMs] : [policy.mode]];
        })) }) });
    db.exec('commit'); transaction = false;
    return legacy ? projectUiConfigV1(next) : next;
  } catch (error) {
    if (transaction) db.exec('rollback');
    if (error instanceof AppearanceError) throw error;
    throw unavailable();
  }
}
