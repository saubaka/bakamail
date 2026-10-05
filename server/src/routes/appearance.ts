import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { AppearanceError, readAppearance, readPublicAppearance, saveAppearance, type AppearanceSchemaVersion } from '../admin/appearance.ts';
import { ok, readJson, requestId, sendJson } from '../http/kit.ts';
import { requirePermission } from '../http/auth.ts';

export const appearanceRouter = Router();
export const uiConfigRouter = Router();
function reject(response: Response, error: unknown): void {
  if (!(error instanceof AppearanceError)) throw error;
  sendJson(response, error.status, { ok: false, data: null, error: error.message, code: error.code });
}

/** Exact URL parameter parsing rejects duplicates/arrays instead of accepting ambiguous versions. */
function requestedVersion(request: Request): AppearanceSchemaVersion | undefined {
  const params = new URL(request.originalUrl, 'http://localhost').searchParams;
  const values = params.getAll('schemaVersion');
  if ([...params.keys()].some(key => key !== 'schemaVersion') || values.length > 1
    || (values.length === 1 && values[0] !== '1' && values[0] !== '2')) {
    throw new AppearanceError(400, 'unsupported_appearance_version', '通知配置版本参数只支持单个schemaVersion=1或2');
  }
  return values.length ? Number(values[0]) as AppearanceSchemaVersion : undefined;
}

// Mounted AFTER the existing requireAdmin + requireCsrf middleware.
appearanceRouter.get('/appearance', requirePermission('system.admin.write'), (request, response) => {
  try { ok(response, readAppearance(requestedVersion(request) ?? 1)); } catch (error) { reject(response, error); }
});
appearanceRouter.patch('/appearance', requirePermission('system.admin.write'), async (request, response) => {
  try {
    const version = requestedVersion(request);
    const body = await readJson(request, { maxBytes: 8192 });
    if (version !== undefined && body.schemaVersion !== version) {
      throw new AppearanceError(400, 'appearance_version_mismatch', '请求版本与通知配置内容不一致');
    }
    ok(response, saveAppearance(body, { actor: request.admin?.admin.username, requestId: requestId(request) }));
  }
  catch (error) { reject(response, error); }
});

uiConfigRouter.get('/ui-config', (request, response) => {
  let version: AppearanceSchemaVersion;
  try { version = requestedVersion(request) ?? 1; } catch (error) { reject(response, error); return; }
  const { config, fallback } = readPublicAppearance(version);
  // Hash content as well as revision, avoiding collisions with fallback/restore states.
  const etag = `"ui-${createHash('sha256').update(JSON.stringify(config)).digest('hex')}"`;
  if (!fallback) {
    response.setHeader('etag', etag);
    response.setHeader('cache-control', 'public, no-cache, must-revalidate');
    const matches = request.header('if-none-match')?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*');
    if (matches) { response.status(304).end(); return; }
  }
  // Never cache a degraded fallback or return 304 for it: editors must recheck server state.
  response.status(200).setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', fallback ? 'no-store' : 'public, no-cache, must-revalidate');
  response.end(JSON.stringify({ ok: true, data: config, error: '' }));
});
