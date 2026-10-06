/** null removes only this invite's limit; registration security budgets stay active. */
export const INVITE_MAX_USES = 1_000_000;
export const INVITE_MAX_TTL_HOURS = 720;
export type InviteLimits = { maxUses: number | null; ttlHours: number | null };
export type InviteSummary = {
  id: number; code_hint: string; bound_address: string; bound_domain: string; note: string;
  created_by: string; created_at: string; expires_at: string | null;
  used_at: string | null; used_by: string; revoked_at: string | null;
  max_uses: number | null; used_count: number; reserved_count: number;
};

export function inviteLimitsProblem(input: { maxUses?: unknown; ttlHours?: unknown }): string | null {
  if (input.maxUses !== undefined && input.maxUses !== null
    && (typeof input.maxUses !== 'number' || !Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > INVITE_MAX_USES)) {
    return '使用次数须为 1–1000000 的整数，或选择无限制';
  }
  if (input.ttlHours !== undefined && input.ttlHours !== null
    && (typeof input.ttlHours !== 'number' || !Number.isInteger(input.ttlHours) || input.ttlHours < 1 || input.ttlHours > INVITE_MAX_TTL_HOURS)) {
    return '有效期须为 1–720 小时的整数，或选择无限制';
  }
  return null;
}

export function inviteStatus(row: Pick<InviteSummary, 'revoked_at' | 'expires_at' | 'max_uses' | 'used_count' | 'reserved_count'>,
  now = Date.now()): 'available' | 'exhausted' | 'reserved' | 'expired' | 'revoked' {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= now)) return 'expired';
  if (row.max_uses !== null && row.used_count >= row.max_uses) return 'exhausted';
  if (row.max_uses !== null && row.used_count + row.reserved_count >= row.max_uses) return 'reserved';
  return 'available';
}

export function inviteRemaining(row: Pick<InviteSummary, 'max_uses' | 'used_count' | 'reserved_count'>): number | null {
  return row.max_uses === null ? null : Math.max(0, row.max_uses - row.used_count - row.reserved_count);
}
