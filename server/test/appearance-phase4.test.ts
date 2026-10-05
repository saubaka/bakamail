import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'bakamail-appearance-test-'));
process.env.SECRET_KEY = 'isolated-appearance-test-secret';
process.env.COOKIE_SECURE = '0';
process.env.MADDY_RUNNER = 'disabled';
const { createApp } = await import('../src/app.ts');
const { default: request } = await import('supertest');
const { createAdmin } = await import('../src/admin/accounts.ts');
const { createAdminSession, createMailSession } = await import('../src/http/session.ts');
const { db, setSetting } = await import('../src/db.ts');
const run = promisify(execFile);
const project = fileURLToPath(new URL('../..', import.meta.url));
const app = createApp({ bootstrapAdmin: false, log: () => undefined });
const admin = createAdmin('appearance-test', 'isolated-password-2026', 'superadmin');
assert.equal(admin.ok, true);
if (!admin.ok) throw new Error('test setup');
const session = createAdminSession(admin.id, 'test', 'test');
const cookie = `bm_admin=${session.token}`;
const defaults = {
  schemaVersion: 1, revision: 0,
  notificationMotion: {
    types: Object.fromEntries(['success', 'info', 'warning', 'error', 'loading'].map(tone => [tone,
      { enterMs: 780, exitMs: 680, textOutMs: 160, textInMs: 340 }])),
    stackMs: 320,
  },
};

test('匿名UI配置最小默认值与ETag，不包含后台信息', async () => {
  const result = await request(app).get('/api/ui-config');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, defaults);
  assert.ok(result.headers.etag);
  assert.equal(result.headers['cache-control'], 'public, no-cache, must-revalidate');
  assert.equal((await request(app).get('/api/ui-config').set('If-None-Match', result.headers.etag)).status, 304);
  assert.deepEqual((await request(app).get('/api/admin/appearance').set('Cookie', cookie)).body.data, defaults);
});

test('管理读写要求独立后台会话、权限及CSRF', async () => {
  for (const method of ['get', 'patch'] as const) assert.equal((await request(app)[method]('/api/admin/appearance').send(defaults)).status, 401);
  const mail = createMailSession('isolated@example.test', 'test', 'test');
  assert.equal((await request(app).patch('/api/admin/appearance').set('Cookie', `bm_session=${mail.token}`).set('x-csrf-token', mail.csrfToken).send(defaults)).status, 401);
  assert.equal((await request(app).patch('/api/admin/appearance').set('Cookie', cookie).send(defaults)).status, 403);
  const reader = createAdmin('appearance-reader', 'isolated-password-2026', 'auditor');
  assert.ok(reader.ok); if (!reader.ok) return;
  const readSession = createAdminSession(reader.id, 'test', 'test');
  for (const method of ['get', 'patch'] as const) assert.equal((await request(app)[method]('/api/admin/appearance').set('Cookie', `bm_admin=${readSession.token}`).set('x-csrf-token', readSession.csrfToken).send(defaults)).status, 403);
});

const getSaved = async () => (await request(app).get('/api/admin/appearance').set('Cookie', cookie)).body.data;
const patch = (body: unknown) => request(app).patch('/api/admin/appearance').set('Cookie', cookie).set('x-csrf-token', session.csrfToken).set('content-type', 'application/json').send(body);

test('完整保存五类时长与0/最大边界，公开结果最小化，站点字段不受影响', async () => {
  setSetting('site_name', 'private-site-marker');
  const initial = await getSaved();
  const next = structuredClone(initial);
  next.notificationMotion.types.success = { enterMs: 0, exitMs: 3000, textOutMs: 0, textInMs: 1000 };
  next.notificationMotion.types.info.enterMs = 123;
  next.notificationMotion.types.warning.enterMs = 234;
  next.notificationMotion.types.error.enterMs = 345;
  next.notificationMotion.types.loading.enterMs = 456;
  next.notificationMotion.stackMs = 1500;
  const result = await patch(next);
  assert.equal(result.status, 200);
  next.revision++;
  assert.deepEqual(result.body.data, next);
  assert.deepEqual(await getSaved(), next);
  const pub = await request(app).get('/api/ui-config');
  assert.deepEqual(pub.body.data, next);
  assert.doesNotMatch(JSON.stringify(pub.body), /private-site-marker|mailHost|password|session|csrf|smtp|imap|secret|domain/);
  assert.equal((await request(app).get('/api/admin/site-settings').set('Cookie', cookie)).body.data.settings.siteName, 'private-site-marker');
  const audit = db.prepare("select summary from audit_logs where action='appearance.update' order by id desc limit 1").get() as { summary: string };
  const summary = JSON.parse(audit.summary);
  assert.deepEqual(summary.keys, ['enterMs', 'exitMs', 'textOutMs', 'textInMs']);
  assert.deepEqual(summary.loading, [456, 680, 160, 340]);
  assert.ok(audit.summary.length < 500);
});

test('所有层级未知/缺失键、非整数、越界、非数值和错误版本全拒绝且无部分保存', async () => {
  const current = await getSaved();
  const invalid: unknown[] = [null, [], {}, { ...current, extra: 1 }, { ...current, revision: -1 },
    { ...current, revision: '1' }, { ...current, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...current, schemaVersion: 2 }];
  for (const mutate of [
    (x: any) => { delete x.notificationMotion.types.info; },
    (x: any) => { x.notificationMotion.types.unexpected = {}; },
    (x: any) => { x.notificationMotion.extra = true; },
    (x: any) => { x.notificationMotion.types.success.extra = true; },
    (x: any) => { delete x.notificationMotion.types.success.textInMs; },
  ]) { const x = structuredClone(current); mutate(x); invalid.push(x); }
  for (const tone of ['success', 'info', 'warning', 'error', 'loading']) {
    for (const [key, max] of Object.entries({ enterMs: 3000, exitMs: 3000, textOutMs: 1000, textInMs: 1000 })) {
      for (const value of [-1, max + 1, 1.5, '10', null, true, NaN, Infinity]) {
        const x = structuredClone(current); x.notificationMotion.types[tone][key] = value; invalid.push(x);
      }
    }
  }
  for (const value of [-1, 1501, 0.5, '320', null]) { const x = structuredClone(current); x.notificationMotion.stackMs = value; invalid.push(x); }
  const count = db.prepare("select count(*) as n from audit_logs where action='appearance.update'").get();
  for (const body of invalid) {
    const result = await patch(body === null ? 'null' : body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(await getSaved(), current);
  }
  assert.deepEqual(db.prepare("select count(*) as n from audit_logs where action='appearance.update'").get(), count);
});

test('超大请求、无效JSON/UTF8和非JSON类型拒绝，配置保持完整', async () => {
  const current = await getSaved();
  for (const [raw, status] of [['{"invalid":"' + 'x'.repeat(9000) + '"}', 413], ['{"x":NaN}', 400], ['{"x":1e9999}', 400]] as const) {
    assert.equal((await patch(raw).set('content-type', 'application/json')).status, status);
  }
  assert.equal((await patch('not-json').set('content-type', 'text/plain')).status, 415);
  assert.equal((await patch(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]))).status, 400);
  assert.deepEqual(await getSaved(), current);
});

test('撤销会话或停用管理员立即拒绝写入，普通admin也没有系统写权限', async () => {
  for (const role of ['superadmin', 'admin'] as const) {
    const account = createAdmin(`appearance-${role}`, 'isolated-password-2026', role);
    assert.ok(account.ok); if (!account.ok) continue;
    const active = createAdminSession(account.id, 'test', 'test');
    const send = () => request(app).patch('/api/admin/appearance').set('Cookie', `bm_admin=${active.token}`).set('x-csrf-token', active.csrfToken).send(defaults);
    if (role === 'admin') assert.equal((await send()).status, 403);
    db.prepare('update admin_users set is_active=0 where id=?').run(account.id);
    assert.equal((await send()).status, 401);
    db.prepare('update admin_users set is_active=1 where id=?').run(account.id);
    db.prepare("update admin_sessions set revoked_at='2026-09-30' where id=?").run(active.id);
    assert.equal((await send()).status, 401);
  }
});

test('两个管理员同时保存同一revision只允许一个成功，旧ETag失效与弱ETag列表匹配', async () => {
  const initial = await getSaved();
  const oldTag = (await request(app).get('/api/ui-config')).headers.etag;
  const another = createAdmin('appearance-second', 'isolated-password-2026', 'superadmin');
  assert.ok(another.ok); if (!another.ok) return;
  const second = createAdminSession(another.id, 'test', 'test');
  const results = await Promise.all([
    patch({ ...initial, notificationMotion: { ...initial.notificationMotion, stackMs: 1 } }),
    request(app).patch('/api/admin/appearance').set('Cookie', `bm_admin=${second.token}`).set('x-csrf-token', second.csrfToken)
      .send({ ...initial, notificationMotion: { ...initial.notificationMotion, stackMs: 2 } }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(results.find(r => r.status === 409)?.body.code, 'appearance_conflict');
  assert.equal((await getSaved()).revision, initial.revision + 1);
  const fresh = await request(app).get('/api/ui-config').set('If-None-Match', oldTag);
  assert.equal(fresh.status, 200); assert.notEqual(fresh.headers.etag, oldTag);
  const cached = await request(app).get('/api/ui-config').set('If-None-Match', `"other", W/${fresh.headers.etag}`);
  assert.equal(cached.status, 304); assert.equal(cached.text, '');
});

test('BFF新进程重启从同一临时库读取已保存配置，无需邮局或账号凭据', async () => {
  const current = await getSaved();
  const child = await run(process.execPath, ['--input-type=module', '-e', `
    const {createApp}=await import('./server/src/app.ts');
    const {db}=await import('./server/src/db.ts');
    const server=createApp({bootstrapAdmin:false,log:()=>{}}).listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));
    try { const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/ui-config');
      process.stdout.write(JSON.stringify({status:r.status,body:await r.json()})); }
    finally { await new Promise(r=>server.close(r));db.close(); }
  `], { cwd: project, env: { ...process.env }, timeout: 10000 });
  const output = JSON.parse(child.stdout);
  assert.equal(output.status, 200); assert.deepEqual(output.body.data, current);
});

test('跨进程并发保存由BEGIN IMMEDIATE保护，一个成功一个冲突', async () => {
  const current = await getSaved();
  const script = `const {saveAppearance}=await import('./server/src/admin/appearance.ts');
    const {db}=await import('./server/src/db.ts');
    try {process.stdout.write(JSON.stringify({status:200,data:saveAppearance(JSON.parse(process.argv[1]),{actor:'isolated-concurrency-test'})}));}
    catch(e){process.stdout.write(JSON.stringify({status:e.status,code:e.code}));}finally{db.close();}`;
  const outputs = await Promise.all([11, 22].map(stackMs => run(process.execPath, ['--input-type=module', '-e', script,
    JSON.stringify({ ...current, notificationMotion: { ...current.notificationMotion, stackMs } })], { cwd: project, env: { ...process.env }, timeout: 10000 })));
  assert.deepEqual(outputs.map(x => JSON.parse(x.stdout).status).sort(), [200, 409]);
  assert.equal((await getSaved()).revision, current.revision + 1);
});

test('审计写失败时整个更新回滚，无部分配置或版本变化', async () => {
  const current = await getSaved();
  db.exec("create trigger appearance_audit_failure before insert on audit_logs when NEW.action='appearance.update' begin select raise(ABORT, 'isolated-test-only'); end");
  try {
    const result = await patch(current);
    assert.equal(result.status, 503); assert.equal(result.body.code, 'appearance_unavailable');
    assert.deepEqual(await getSaved(), current);
  } finally { db.exec('drop trigger appearance_audit_failure'); }
});

test('损坏或不兼容持久数据：公开无缓存默认回退，管理员503拒绝保存且保留原数据', async () => {
  const original = db.prepare('select * from ui_appearance where id=1').get() as { payload: string; schema_version: number; revision: number };
  for (const payload of ['not-json', JSON.stringify({ ...await getSaved(), schemaVersion: 99 }), '{}', 'x'.repeat(9000)]) {
    db.prepare('update ui_appearance set payload=? where id=1').run(payload);
    try {
      const publicResult = await request(app).get('/api/ui-config').set('If-None-Match', '*');
      assert.equal(publicResult.status, 200); assert.deepEqual(publicResult.body.data, defaults);
      assert.equal(publicResult.headers['cache-control'], 'no-store'); assert.equal(publicResult.headers.etag, undefined);
      const adminRead = await request(app).get('/api/admin/appearance').set('Cookie', cookie);
      assert.equal(adminRead.status, 503); assert.equal(adminRead.body.data, null);
      assert.equal((await patch(defaults)).status, 503);
      assert.equal((db.prepare('select payload from ui_appearance where id=1').get() as { payload: string }).payload, payload);
    } finally { db.prepare('update ui_appearance set payload=? where id=1').run(original.payload); }
  }
  db.prepare('update ui_appearance set schema_version=99 where id=1').run();
  try { assert.equal((await request(app).get('/api/admin/appearance').set('Cookie', cookie)).status, 503); }
  finally { db.prepare('update ui_appearance set schema_version=? where id=1').run(original.schema_version); }
});

test('数据库读取失败不把默认值交给管理员编辑，也不能自动覆盖', async () => {
  db.exec('alter table ui_appearance rename to isolated_appearance_unavailable');
  try {
    assert.deepEqual((await request(app).get('/api/ui-config')).body.data, defaults);
    assert.equal((await request(app).get('/api/admin/appearance').set('Cookie', cookie)).status, 503);
    assert.equal((await patch(defaults)).status, 503);
  } finally { db.exec('alter table isolated_appearance_unavailable rename to ui_appearance'); }
});

test('共享校验拒绝NaN/Infinity并返回独立默认对象，未知版本可被后续客户端安全识别', async () => {
  const { isUiConfig, defaultUiConfig } = await import('../../shared/notificationMotion.ts');
  for (const bad of [NaN, Infinity, -Infinity]) {
    const value = defaultUiConfig(); value.notificationMotion.types.loading.textInMs = bad;
    assert.equal(isUiConfig(value), false);
  }
  const value = defaultUiConfig(); value.notificationMotion.types.info.enterMs = 12;
  assert.deepEqual(defaultUiConfig(), defaults);
  assert.equal(isUiConfig({ ...defaults, schemaVersion: 99 }), false);
});

test('旧库增量迁移保留站点字段/草稿，重复启动不插入默认值或覆盖配置', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const folder = mkdtempSync(join(tmpdir(), 'bakamail-appearance-migration-'));
  const old = new DatabaseSync(join(folder, 'bakamail.db'));
  old.exec(`create table app_settings(key text primary key,value text not null,updated_at text not null);
    insert into app_settings values('site_name','historical-private-site','2026-09-01');
    create table drafts(id text primary key,owner text not null,payload text not null,created_at text not null,updated_at text not null);
    insert into drafts values('historical-draft','isolated@example.test','keep-draft','2026-09-01','2026-09-01');`);
  old.close();
  for (let i = 0; i < 2; i++) {
    const child = await run(process.execPath, ['--input-type=module', '-e', `
      const {db}=await import('./server/src/db.ts'); const {readAppearance}=await import('./server/src/admin/appearance.ts');
      process.stdout.write(JSON.stringify(readAppearance()));db.close();`], { cwd: project, env: { ...process.env, DATA_DIR: folder }, timeout: 10000 });
    assert.deepEqual(JSON.parse(child.stdout), defaults);
  }
  const migrated = new DatabaseSync(join(folder, 'bakamail.db'));
  assert.equal((migrated.prepare("select value from app_settings where key='site_name'").get() as { value: string }).value, 'historical-private-site');
  assert.equal((migrated.prepare('select payload from drafts').get() as { payload: string }).payload, 'keep-draft');
  assert.equal((migrated.prepare('select count(*) as n from ui_appearance').get() as { n: number }).n, 0);
  migrated.close();
});

test('阶段六真实本机HTTP：后台保存到公开读取到前端时间表，跨客户端304/冲突/故障回退联动', async () => {
  const { createUiConfigClient } = await import('../../web/src/notificationConfig.ts');
  const { notificationTimeline } = await import('../../web/src/notificationTiming.ts');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const statuses: number[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, '/api/ui-config?schemaVersion=2');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    const response = await fetch(origin + String(input), init); statuses.push(response.status); return response;
  };
  const first = createUiConfigClient(fetcher), second = createUiConfigClient(fetcher);
  const original = await getSaved();
  try {
    await Promise.all([first.refresh(true), second.refresh(true)]);
    assert.deepEqual(first.snapshot(), original);
    const captured = first.snapshot();
    const next = structuredClone(original);
    next.notificationMotion.types.info = { enterMs: 0, exitMs: 3000, textOutMs: 1000, textInMs: 0 };
    next.notificationMotion.types.loading.enterMs = 456;
    next.notificationMotion.stackMs = 1500;
    const saved = await fetch(origin + '/api/admin/appearance', { method: 'PATCH',
      headers: { Cookie: cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify(next) });
    assert.equal(saved.status, 200);
    const payload = await saved.json(); assert.equal(first.applySaved(payload.data), true);
    assert.deepEqual(captured, original); // existing notification snapshot remains independent
    await second.refresh(true); assert.deepEqual(second.snapshot(), payload.data);
    assert.deepEqual(notificationTimeline(second.snapshot(), 'info', false), {
      enterMs: 0, exitMs: 3000, textOutMs: 1000, textInMs: 0, stackMs: 1500, copyDelayMs: 0, copyInMs: 0, copyOutMs: 540,
    });
    await second.refresh(true); assert.equal(statuses.at(-1), 304);
    const stale = await fetch(origin + '/api/admin/appearance', { method: 'PATCH',
      headers: { Cookie: cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify(original) });
    assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'appearance_conflict');
    const row = db.prepare('select payload from ui_appearance where id=1').get() as { payload: string };
    db.prepare('update ui_appearance set payload=? where id=1').run('isolated-corrupt-config');
    try {
      await second.refresh(true); assert.deepEqual(second.snapshot(), defaults);
      assert.equal((await request(app).get('/api/admin/appearance').set('Cookie', cookie)).status, 503);
    } finally { db.prepare('update ui_appearance set payload=? where id=1').run(row.payload); }
    await second.refresh(true); assert.deepEqual(second.snapshot(), payload.data);
  } finally {
    first.dispose(); second.dispose();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
