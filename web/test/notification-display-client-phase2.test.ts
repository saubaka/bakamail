import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultUiConfig } from '../../shared/notificationMotion.ts';
import { defaultUiConfigV2, projectUiConfigV1, upgradeUiConfigV1 } from '../../shared/notificationDisplay.ts';
import { createUiConfigClient } from '../src/notificationConfig.ts';

test('新客户端请求v2并提供完整快照与旧动画投影，两个快照互不影响', async () => {
  const saved = defaultUiConfigV2(); saved.revision = 3;
  saved.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 4000 };
  let captured: { path: unknown; init?: RequestInit } | undefined;
  const client = createUiConfigClient(async (path, init) => {
    captured = { path, init };
    return Response.json({ ok: true, data: saved }, { headers: { etag: '"v2-test"', 'cache-control': 'no-cache' } });
  });
  try {
    await client.refresh(true);
    assert.equal(captured?.path, '/api/ui-config?schemaVersion=2'); assert.equal(captured?.init?.credentials, 'same-origin');
    assert.equal(captured?.init?.redirect, 'error'); assert.equal(captured?.init?.cache, 'no-store');
    assert.deepEqual(client.snapshotV2(), saved); assert.deepEqual(client.snapshot(), projectUiConfigV1(saved));
    const snapshot = client.snapshotV2(); snapshot.notificationDisplay.types.success = { mode: 'manual' };
    const legacy = client.snapshot(); legacy.notificationMotion.stackMs = 0;
    assert.deepEqual(client.snapshotV2(), saved);
  } finally { client.dispose(); }
});

test('旧服务合法v1响应在内存升级，未知/缺失/损坏v2整份回退独立默认', async () => {
  const legacy = defaultUiConfig(); legacy.revision = 4; legacy.notificationMotion.stackMs = 444;
  const broken = defaultUiConfigV2(); (broken.notificationDisplay.types as any).error = { mode: 'timed', durationMs: 1 };
  for (const value of [legacy, { ...legacy, schemaVersion: 99 }, { ...legacy, schemaVersion: 2 }, broken]) {
    const client = createUiConfigClient(async () => Response.json({ ok: true, data: value }));
    try { await client.refresh(true); assert.deepEqual(client.snapshotV2(), value === legacy ? upgradeUiConfigV1(legacy) : defaultUiConfigV2()); }
    finally { client.dispose(); }
  }
});

test('新版保存应用完整策略，旧动画保存保留已知显示策略，不接受非法保存', () => {
  const client = createUiConfigClient(); const saved = defaultUiConfigV2(); saved.revision = 7;
  saved.notificationDisplay.types.error = { mode: 'timed', durationMs: 1000 };
  try {
    assert.equal(client.applySaved(saved), true); saved.notificationDisplay.types.error = { mode: 'manual' };
    const known = client.snapshotV2(), legacy = projectUiConfigV1(known); legacy.revision++; legacy.notificationMotion.stackMs = 0;
    assert.equal(client.applySaved(legacy), true);
    assert.deepEqual(client.snapshotV2().notificationDisplay, known.notificationDisplay);
    assert.equal(client.snapshotV2().revision, legacy.revision); assert.equal(client.snapshotV2().notificationMotion.stackMs, 0);
    const before = client.snapshotV2(); assert.equal(client.applySaved({ ...before, schemaVersion: 99 }), false);
    assert.deepEqual(client.snapshotV2(), before);
  } finally { client.dispose(); }
});

test('v2单飞/边界节流/ETag复用，304不丢失完整显示配置', async () => {
  let release!: () => void, calls = 0; const headers: Headers[] = [];
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const saved = defaultUiConfigV2(); saved.revision = 5; saved.notificationDisplay.types.info = { mode: 'manual' };
  const client = createUiConfigClient(async (_path, init) => {
    calls++; headers.push(new Headers(init?.headers));
    if (calls > 1) return new Response(null, { status: 304 });
    await barrier; return Response.json({ ok: true, data: saved }, { headers: { etag: '"v2-etag"' } });
  });
  try {
    const first = client.refresh(true); assert.equal(client.refresh(true), first); assert.equal(calls, 1); release(); await first;
    await client.refresh(); assert.equal(calls, 1);
    await client.refresh(true); assert.equal(calls, 2); assert.equal(headers[1].get('If-None-Match'), '"v2-etag"');
    assert.deepEqual(client.snapshotV2(), saved);
  } finally { client.dispose(); }
});

test('no-store降级响应不缓存ETag，网络错误/未缓存304安全回退', async () => {
  const requests: Headers[] = []; let calls = 0; const saved = defaultUiConfigV2(); saved.revision = 2;
  const client = createUiConfigClient(async (_path, init) => {
    calls++; requests.push(new Headers(init?.headers));
    if (calls === 1) return Response.json({ ok: true, data: saved }, { headers: { etag: '"uncacheable"', 'cache-control': 'no-store' } });
    if (calls === 2) return new Response(null, { status: 304 });
    throw new Error('isolated offline');
  });
  try {
    await client.refresh(true); assert.deepEqual(client.snapshotV2(), saved);
    await client.refresh(true); assert.equal(requests[1].has('If-None-Match'), false); assert.deepEqual(client.snapshotV2(), defaultUiConfigV2());
    client.applySaved(saved); await client.refresh(true); assert.deepEqual(client.snapshotV2(), defaultUiConfigV2());
  } finally { client.dispose(); }
});

test('迟到请求不覆盖保存或卸载后的快照；取消时仍有有界清理', async () => {
  for (const dispose of [false, true]) {
    let release!: (response: Response) => void, signal: AbortSignal | undefined;
    const client = createUiConfigClient(async (_path, init) => {
      signal = init?.signal ?? undefined; return new Promise<Response>(resolve => { release = resolve; });
    });
    const old = defaultUiConfigV2(); old.revision = 1;
    const saved = defaultUiConfigV2(); saved.revision = 9; saved.notificationDisplay.types.warning = { mode: 'manual' };
    try {
      const pending = client.refresh(true); client.applySaved(saved); if (dispose) client.dispose();
      assert.equal(signal?.aborted, true); release(Response.json({ ok: true, data: old })); await pending;
      assert.deepEqual(client.snapshotV2(), saved);
    } finally { client.dispose(); }
  }
});

test('请求四秒有界超时并取消，不允许永不返回的fetch阻塞配置读取', async () => {
  let signal: AbortSignal | undefined;
  const client = createUiConfigClient(async (_path, init) => {
    signal = init?.signal ?? undefined; return new Promise<Response>(() => {});
  });
  const started = performance.now();
  try {
    await client.refresh(true); const elapsed = performance.now() - started;
    assert.ok(elapsed >= 3900 && elapsed < 10000, String(elapsed)); assert.equal(signal?.aborted, true);
    assert.deepEqual(client.snapshotV2(), defaultUiConfigV2());
  } finally { client.dispose(); }
});
