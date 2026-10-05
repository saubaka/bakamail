import { copyUiConfig, isUiConfig } from '../../shared/notificationMotion.ts';
import { copyUiConfigV2, defaultUiConfigV2, isUiConfigV2, normalizeUiConfigV2, projectUiConfigV1 } from '../../shared/notificationDisplay.ts';

/** One public request per boundary, never per notification. No browser persistence of config/credentials. */
export function createUiConfigClient(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let current = defaultUiConfigV2(), etag = '', generation = 0, lastCheck = -Infinity;
  let flight: Promise<void> | null = null, controller: AbortController | null = null;
  function applySaved(value: unknown): boolean {
    if (isUiConfigV2(value)) current = copyUiConfigV2(value);
    else if (isUiConfig(value)) {
      // The existing motion editor receives v1 projections. Do not reset known display policies.
      const motion = copyUiConfig(value);
      current = { ...copyUiConfigV2(current), revision: motion.revision, notificationMotion: motion.notificationMotion };
    } else return false;
    generation++; controller?.abort(); etag = ''; return true;
  }
  function refresh(force = false): Promise<void> {
    if (flight) return flight;
    if (!force && Date.now() - lastCheck < 10000) return Promise.resolve();
    lastCheck = Date.now(); const version = generation;
    const abort = new AbortController(); controller = abort;
    let timeout: ReturnType<typeof setTimeout>;
    const request = async () => {
      const response = await fetcher('/api/ui-config?schemaVersion=2', {
        credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: abort.signal,
        headers: etag ? { 'If-None-Match': etag } : {},
      });
      if (response.status === 304) { if (!etag) throw new Error('Unexpected 304'); return; }
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true
        || !('data' in payload)) throw new Error('Unsupported UI config');
      // Valid v1 replies from an older service can be upgraded; corrupt/unknown versions cannot.
      const normalized = normalizeUiConfigV2(payload.data);
      if (!normalized) throw new Error('Unsupported UI config');
      if (generation === version && !abort.signal.aborted) {
        current = normalized;
        etag = response.headers.get('cache-control')?.includes('no-store') ? '' : response.headers.get('etag') ?? '';
      }
    };
    flight = Promise.race([request(), new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => { abort.abort(); reject(new Error('UI config timeout')); }, 4000);
    })]).catch(() => {
      // Network/version failures use independent defaults, never block rendering or cause a notice-fetch loop.
      if (version === generation) { current = defaultUiConfigV2(); etag = ''; }
    }).finally(() => { clearTimeout(timeout); if (controller === abort) controller = null; flight = null; });
    return flight;
  }
  return {
    // Compatibility projection; new runtime/editor consume complete snapshotV2.
    snapshot: () => projectUiConfigV1(current), snapshotV2: () => copyUiConfigV2(current), refresh, applySaved,
    dispose() { generation++; controller?.abort(); etag = ''; },
  };
}

export const uiConfigClient = createUiConfigClient();
export const snapshotUiConfig = () => uiConfigClient.snapshot();
export const snapshotUiConfigV2 = () => uiConfigClient.snapshotV2();
export const applySavedUiConfig = (value: unknown) => uiConfigClient.applySaved(value);
export function initializeUiConfig(client = uiConfigClient): () => void {
  const activate = () => { if (!document.hidden) void client.refresh(true); };
  // Reactivation revalidates even within the ordinary SPA throttle.
  const focus = () => { if (!document.hidden) void client.refresh(true); };
  document.addEventListener('visibilitychange', activate);
  window.addEventListener('focus', focus);
  void client.refresh(true);
  return () => { document.removeEventListener('visibilitychange', activate); window.removeEventListener('focus', focus); client.dispose(); };
}
