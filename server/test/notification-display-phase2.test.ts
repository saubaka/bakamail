import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultUiConfig, type UiConfig } from '../../shared/notificationMotion.ts';
import { defaultUiConfigV2, upgradeUiConfigV1, projectUiConfigV1, type UiConfigV2 } from '../../shared/notificationDisplay.ts';

const testDirectory = mkdtempSync(join(tmpdir(), 'bakamail-display-phase2-test-'));
process.env.NODE_ENV = 'test'; process.env.DATA_DIR = testDirectory;
process.env.SECRET_KEY = 'isolated-display-config-test-secret'; process.env.COOKIE_SECURE = '0';
process.env.MADDY_RUNNER = 'disabled';
const { createApp } = await import('../src/app.ts');
const { default: request } = await import('supertest');
const { createAdmin } = await import('../src/admin/accounts.ts');
const { createAdminSession, createMailSession } = await import('../src/http/session.ts');
const { db, setSetting } = await import('../src/db.ts');
const app = createApp({ bootstrapAdmin: false, log: () => undefined });
const admin = createAdmin('display-config-test', 'isolated-config-test-password', 'superadmin');
assert.ok(admin.ok); if (!admin.ok) throw new Error('isolated setup');
const session = createAdminSession(admin.id, 'test', 'test');
const cookie = `bm_admin=${session.token}`;
const pubPath = '/api/ui-config?schemaVersion=2', adminPath = '/api/admin/appearance?schemaVersion=2';
const getV2 = async (): Promise<UiConfigV2> => (await request(app).get(adminPath).set('Cookie', cookie)).body.data;
const patch = (body: unknown, path = '/api/admin/appearance') => request(app).patch(path)
  .set('Cookie', cookie).set('x-csrf-token', session.csrfToken).set('content-type', 'application/json').send(body);
const row = () => db.prepare('select schema_version, revision, payload, updated_at from ui_appearance where id=1').get();
const audits = () => db.prepare("select summary from audit_logs where action='appearance.update' order by id").all();
function insert(config: UiConfig | UiConfigV2) {
  db.prepare('insert into ui_appearance(id,schema_version,revision,payload,updated_at) values(1,?,?,?,?)')
    .run(config.schemaVersion, config.revision, JSON.stringify(config), 'isolated-original-timestamp');
}
beforeEach(() => { db.exec("delete from ui_appearance; delete from audit_logs where action='appearance.update'"); });
after(() => { db.close(); rmSync(testDirectory, { recursive: true, force: true }); });
const run = promisify(execFile), project = fileURLToPath(new URL('../..', import.meta.url));

test('v2默认配置管理/匿名可读，旧GET仍v1，读取不插入行或审计', async () => {
  const newer = await request(app).get(pubPath);
  assert.equal(newer.status, 200); assert.deepEqual(newer.body.data, defaultUiConfigV2());
  assert.deepEqual(await getV2(), defaultUiConfigV2());
  assert.deepEqual((await request(app).get('/api/ui-config')).body.data, defaultUiConfig());
  assert.deepEqual((await request(app).get('/api/admin/appearance').set('Cookie', cookie)).body.data, defaultUiConfig());
  assert.equal(row(), undefined); assert.deepEqual(audits(), []);
});

test('v2保存完整五类显示策略与原动画，数据库为v2且旧响应最小投影', async () => {
  const config = defaultUiConfigV2();
  config.notificationDisplay.types = { success: { mode: 'timed', durationMs: 1000 }, info: { mode: 'manual' },
    warning: { mode: 'timed', durationMs: 120000 }, error: { mode: 'timed', durationMs: 10000 },
    loading: { mode: 'timedHide', durationMs: 15000 } };
  config.notificationMotion.types.info.enterMs = 1234;
  const saved = await patch(config);
  assert.equal(saved.status, 200); config.revision++;
  assert.deepEqual(saved.body.data, config); assert.deepEqual(await getV2(), config);
  const stored = row() as { schema_version: number; payload: string };
  assert.equal(stored.schema_version, 2); assert.deepEqual(JSON.parse(stored.payload), config);
  assert.deepEqual((await request(app).get('/api/ui-config')).body.data, projectUiConfigV1(config));
  assert.deepEqual((await request(app).get(pubPath)).body.data, config);
  const summary = JSON.parse((audits()[0] as { summary: string }).summary);
  assert.deepEqual(summary.display.error, ['timed', 10000]);
  assert.deepEqual(summary.display.loading, ['timedHide', 15000]);
});

test('合法v1行只在内存升级，读取不改变revision/时间戳，首次保存才写v2', async () => {
  const old = defaultUiConfig(); old.revision = 7; old.notificationMotion.stackMs = 777; insert(old);
  const before = row();
  for (let i = 0; i < 3; i++) assert.deepEqual(await getV2(), upgradeUiConfigV1(old));
  assert.deepEqual(row(), before); assert.deepEqual(audits(), []);
  const saved = await patch(old, '/api/admin/appearance?schemaVersion=1');
  assert.equal(saved.status, 200); assert.equal(saved.body.data.schemaVersion, 1);
  assert.equal(saved.body.data.revision, 8);
  assert.equal((row() as any).schema_version, 2);
  assert.deepEqual((await getV2()).notificationDisplay, defaultUiConfigV2().notificationDisplay);
});

test('旧编辑器只能改动画，保留五类显示策略；旧revision不能覆盖新版', async () => {
  const current = defaultUiConfigV2(); current.revision = 9;
  current.notificationDisplay.types = { success: { mode: 'manual' }, info: { mode: 'timed', durationMs: 1000 },
    warning: { mode: 'manual' }, error: { mode: 'timed', durationMs: 120000 }, loading: { mode: 'timedHide', durationMs: 3000 } };
  insert(current); const legacy = projectUiConfigV1(current); legacy.notificationMotion.stackMs = 111;
  const saved = await patch(legacy); assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data, { ...legacy, revision: 10 });
  assert.deepEqual((await getV2()).notificationDisplay, current.notificationDisplay);
  const before = row(); assert.equal((await patch(legacy)).status, 409);
  assert.deepEqual(row(), before); assert.equal(audits().length, 1);
});

test('版本参数严格拒绝重复/数组/未知参数，PATCH版本必须与完整body一致', async () => {
  for (const query of ['schemaVersion=3', 'schemaVersion=', 'schemaVersion=02', 'schemaVersion=2&schemaVersion=2',
    'schemaVersion[]=2', 'schemaVersion=2&unexpected=1']) {
    assert.equal((await request(app).get('/api/ui-config?' + query)).status, 400, query);
    assert.equal((await request(app).get('/api/admin/appearance?' + query).set('Cookie', cookie)).status, 400, query);
    assert.equal((await patch(defaultUiConfigV2(), '/api/admin/appearance?' + query)).status, 400, query);
  }
  assert.equal((await patch(defaultUiConfig(), adminPath)).status, 400);
  assert.equal((await patch(defaultUiConfigV2(), '/api/admin/appearance?schemaVersion=1')).status, 400);
  for (const bad of ['null', '[]', '{}']) assert.equal((await patch(bad, adminPath)).status, 400);
  assert.equal(row(), undefined); assert.deepEqual(audits(), []);
});

test('v1/v2 ETag隔离，弱标签列表匹配，显示变化即使revision不变也改变v2标签', async () => {
  const current = defaultUiConfigV2(); current.revision = 1; insert(current);
  const old = await request(app).get('/api/ui-config'), newer = await request(app).get(pubPath);
  assert.notEqual(old.headers.etag, newer.headers.etag);
  assert.equal((await request(app).get(pubPath).set('If-None-Match', old.headers.etag)).status, 200);
  assert.equal((await request(app).get('/api/ui-config').set('If-None-Match', newer.headers.etag)).status, 200);
  assert.equal((await request(app).get(pubPath).set('If-None-Match', `"other", W/${newer.headers.etag}`)).status, 304);
  current.notificationDisplay.types.success = { mode: 'manual' };
  db.prepare('update ui_appearance set payload=? where id=1').run(JSON.stringify(current));
  assert.equal((await request(app).get(pubPath).set('If-None-Match', newer.headers.etag)).status, 200);
  assert.equal((await request(app).get('/api/ui-config').set('If-None-Match', old.headers.etag)).status, 304);
});

test('v2沿用独立后台会话/系统写权限/CSRF，普通邮箱和普通管理员不能修改', async () => {
  assert.equal((await request(app).get(adminPath)).status, 401);
  assert.equal((await request(app).patch(adminPath).send(defaultUiConfigV2())).status, 401);
  const mail = createMailSession('display-isolated@example.test', 'test', 'test');
  assert.equal((await request(app).patch(adminPath).set('Cookie', `bm_session=${mail.token}`)
    .set('x-csrf-token', mail.csrfToken).send(defaultUiConfigV2())).status, 401);
  assert.equal((await request(app).patch(adminPath).set('Cookie', cookie).send(defaultUiConfigV2())).status, 403);
  for (const role of ['admin', 'auditor'] as const) {
    const account = createAdmin(`display-${role}`, 'isolated-config-test-password', role); assert.ok(account.ok); if (!account.ok) throw new Error('setup');
    const active = createAdminSession(account.id, 'test', 'test');
    for (const method of ['get', 'patch'] as const) assert.equal((await request(app)[method](adminPath)
      .set('Cookie', `bm_admin=${active.token}`).set('x-csrf-token', active.csrfToken).send(defaultUiConfigV2())).status, 403);
    db.prepare('update admin_users set is_active=0 where id=?').run(account.id);
    assert.equal((await request(app).get(adminPath).set('Cookie', `bm_admin=${active.token}`)).status, 401);
    db.prepare('update admin_users set is_active=1 where id=?').run(account.id);
    db.prepare("update admin_sessions set revoked_at='isolated-revoked' where id=?").run(active.id);
    assert.equal((await request(app).get(adminPath).set('Cookie', `bm_admin=${active.token}`)).status, 401);
  }
  assert.equal(row(), undefined);
});

test('五类策略错误模式/边界/非整秒/缺失或多余字段全部拒绝且不部分写入', async () => {
  const current = defaultUiConfigV2(); current.revision = 1; insert(current); const before = row();
  for (const type of ['success', 'info', 'warning', 'error', 'loading'] as const) {
    const mode = type === 'loading' ? 'timedHide' : 'timed';
    for (const policy of [null, {}, { mode: 'unknown' }, { mode, durationMs: 0 }, { mode, durationMs: 120001 },
      { mode, durationMs: 1500 }, { mode, durationMs: '1000' }, { mode, durationMs: 1000, extra: true },
      type === 'loading' ? { mode: 'manual' } : { mode: 'untilSettled' },
      type === 'loading' ? { mode: 'untilSettled', durationMs: 1000 } : { mode: 'manual', durationMs: 1000 }]) {
      const bad: any = structuredClone(current); bad.notificationDisplay.types[type] = policy;
      assert.equal((await patch(bad)).status, 400, JSON.stringify(policy)); assert.deepEqual(row(), before);
    }
    const bad: any = structuredClone(current); delete bad.notificationDisplay.types[type];
    assert.equal((await patch(bad)).status, 400);
  }
  for (const mutate of [(x: any) => { x.notificationDisplay.extra = true; },
    (x: any) => { x.notificationDisplay.types.other = { mode: 'manual' }; },
    (x: any) => { x.schemaVersion = 99; }]) {
    const bad = structuredClone(current); mutate(bad); assert.equal((await patch(bad)).status, 400);
  }
  assert.equal((await patch('{"extra":"' + 'x'.repeat(9000) + '"}', adminPath)).status, 413);
  assert.equal((await patch('{', adminPath)).status, 400);
  assert.deepEqual(row(), before); assert.deepEqual(audits(), []);
});

test('同revision v1/v2并发保存只有一个成功，不丢失赢家策略', async () => {
  const current = defaultUiConfigV2(); current.revision = 1; current.notificationDisplay.types.info = { mode: 'manual' }; insert(current);
  const modern = structuredClone(current); modern.notificationDisplay.types.success = { mode: 'manual' };
  const legacy = projectUiConfigV1(current); legacy.notificationMotion.stackMs = 66;
  const results = await Promise.all([patch(legacy), patch(modern)]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  assert.equal((await getV2()).revision, 2); assert.equal(audits().length, 1);
  assert.deepEqual((await getV2()).notificationDisplay, results[0].status === 200 ? current.notificationDisplay : modern.notificationDisplay);
});

test('跨进程v1/v2竞争由数据库串行保护；重新启动完整读取且不二次迁移', async () => {
  const current = defaultUiConfigV2(); current.revision = 1; current.notificationDisplay.types.error = { mode: 'timed', durationMs: 2000 }; insert(current);
  const modern = structuredClone(current); modern.notificationDisplay.types.loading = { mode: 'timedHide', durationMs: 6000 };
  const script = `const {saveAppearance}=await import('./server/src/admin/appearance.ts');const {db}=await import('./server/src/db.ts');
    try{process.stdout.write(JSON.stringify({status:200,data:saveAppearance(JSON.parse(process.argv[1]),{actor:'isolated-display-race'})}));}
    catch(e){process.stdout.write(JSON.stringify({status:e.status}));}finally{db.close();}`;
  const outputs = await Promise.all([projectUiConfigV1(current), modern].map(value => run(process.execPath,
    ['--input-type=module', '-e', script, JSON.stringify(value)], { cwd: project, env: { ...process.env }, timeout: 10000 })));
  assert.deepEqual(outputs.map(x => JSON.parse(x.stdout).status).sort(), [200, 409]);
  const expected = await getV2(), before = row();
  for (let i = 0; i < 2; i++) {
    const child = await run(process.execPath, ['--input-type=module', '-e',
      `const {readAppearanceV2}=await import('./server/src/admin/appearance.ts');const {db}=await import('./server/src/db.ts');process.stdout.write(JSON.stringify(readAppearanceV2()));db.close();`],
    { cwd: project, env: { ...process.env }, timeout: 10000 });
    assert.deepEqual(JSON.parse(child.stdout), expected);
  }
  assert.deepEqual(row(), before); assert.equal(audits().length, 1);
  assert.deepEqual(expected.notificationDisplay, JSON.parse(outputs[0].stdout).status === 200 ? current.notificationDisplay : modern.notificationDisplay);
});

test('审计失败回滚整个v2更新，版本耗尽拒绝保存', async () => {
  const current = defaultUiConfigV2(); current.revision = 1; insert(current); const before = row();
  db.exec("create trigger display_audit_failure before insert on audit_logs when NEW.action='appearance.update' begin select raise(ABORT,'isolated-only'); end");
  try { assert.equal((await patch(current)).status, 503); assert.deepEqual(row(), before); assert.deepEqual(audits(), []); }
  finally { db.exec('drop trigger display_audit_failure'); }
  current.revision = Number.MAX_SAFE_INTEGER;
  db.prepare('update ui_appearance set revision=?,payload=? where id=1').run(current.revision, JSON.stringify(current));
  const exhausted = row(); assert.equal((await patch(current)).status, 409); assert.deepEqual(row(), exhausted);
});

test('损坏/未知版本/字段不匹配：两版公开不可缓存回退，后台503且不能覆盖原行', async () => {
  const current = defaultUiConfigV2(); current.revision = 1; insert(current);
  for (const payload of ['not-json', '{}', 'x'.repeat(9000), JSON.stringify({ ...current, schemaVersion: 99 }),
    JSON.stringify({ ...current, revision: 2 }), JSON.stringify(projectUiConfigV1(current))]) {
    db.prepare('update ui_appearance set payload=? where id=1').run(payload); const before = row();
    for (const version of [1, 2]) {
      const result = await request(app).get(`/api/ui-config?schemaVersion=${version}`).set('If-None-Match', '*');
      assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers.etag, undefined);
      assert.deepEqual(result.body.data, version === 1 ? defaultUiConfig() : defaultUiConfigV2());
    }
    assert.equal((await request(app).get(adminPath).set('Cookie', cookie)).status, 503);
    assert.equal((await patch(current)).status, 503); assert.deepEqual(row(), before);
  }
  assert.deepEqual(audits(), []);
});

test('数据库暂时不可读不提供可编辑默认值，恢复后配置与业务标记保留', async () => {
  const current = defaultUiConfigV2(); current.revision = 1; insert(current);
  setSetting('site_name', 'isolated-private-site');
  db.prepare('insert into drafts(id,owner,payload,created_at,updated_at) values(?,?,?,?,?)')
    .run('display-marker', 'isolated@example.test', 'keep-display-draft', 'test', 'test');
  db.exec('alter table ui_appearance rename to isolated_display_unavailable');
  try {
    assert.deepEqual((await request(app).get(pubPath)).body.data, defaultUiConfigV2());
    assert.equal((await request(app).get(adminPath).set('Cookie', cookie)).status, 503);
    assert.equal((await patch(current)).status, 503);
  } finally { db.exec('alter table isolated_display_unavailable rename to ui_appearance'); }
  assert.equal((await patch(current)).status, 200);
  const pub = await request(app).get(pubPath);
  assert.doesNotMatch(JSON.stringify(pub.body), /isolated-private-site|password|csrf|smtp|imap|secret/);
  assert.equal((db.prepare("select value from app_settings where key='site_name'").get() as any).value, 'isolated-private-site');
  assert.equal((db.prepare("select payload from drafts where id='display-marker'").get() as any).payload, 'keep-display-draft');
});

test('真实本机HTTP：v2后台保存→两客户端读取/304→旧编辑保留→冲突和故障恢复', async () => {
  const { createUiConfigClient } = await import('../../web/src/notificationConfig.ts');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`, statuses: number[] = [];
  const clients = [0, 1].map(() => createUiConfigClient(async (path, init) => {
    const response = await fetch(origin + String(path), init); statuses.push(response.status); return response;
  }));
  try {
    const current = defaultUiConfigV2(); current.notificationDisplay.types.error = { mode: 'timed', durationMs: 3000 };
    const saved = await fetch(origin + adminPath, { method: 'PATCH', headers: { Cookie: cookie,
      'x-csrf-token': session.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify(current) });
    assert.equal(saved.status, 200); const expected: UiConfigV2 = (await saved.json()).data;
    await Promise.all(clients.map(client => client.refresh(true)));
    clients.forEach(client => assert.deepEqual(client.snapshotV2(), expected));
    await clients[1].refresh(true); assert.equal(statuses.at(-1), 304);
    const legacy = projectUiConfigV1(expected); legacy.notificationMotion.stackMs = 123;
    assert.equal((await patch(legacy)).status, 200); assert.equal((await patch(expected)).status, 409);
    await clients[0].refresh(true); assert.deepEqual(clients[0].snapshotV2().notificationDisplay, expected.notificationDisplay);
    const healthy = row() as any; db.prepare('update ui_appearance set payload=? where id=1').run('isolated-corrupt');
    try { await clients[1].refresh(true); assert.deepEqual(clients[1].snapshotV2(), defaultUiConfigV2()); }
    finally { db.prepare('update ui_appearance set payload=? where id=1').run(healthy.payload); }
    await clients[1].refresh(true); assert.deepEqual(clients[1].snapshotV2(), await getV2());
  } finally { clients.forEach(client => client.dispose()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('阶段4真实编辑器→本机BFF完整v2保存→公开新通知快照；冲突读回须明确审阅', async () => {
  const { createNotificationAppearanceEditor } = await import('../../web/src/admin/notificationAppearanceEditor.ts');
  const { createUiConfigClient } = await import('../../web/src/notificationConfig.ts');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const client = createUiConfigClient((path, init) => fetch(origin + String(path), init));
  let writes = 0;
  const editor = createNotificationAppearanceEditor({ request: async (path, options) => {
    if (options.method) writes++;
    const response = await fetch(origin + path, { method: options.method ?? 'GET', signal: options.signal,
      headers: { Cookie: cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error), { status: response.status });
    return payload.data;
  }, apply: config => { client.applySaved(config); }, feedback: () => undefined });
  try {
    await editor.load(); assert.equal(editor.state.blocked, false);
    editor.state.seconds.success = 1; editor.mode('error', true); editor.state.seconds.error = 120;
    editor.mode('loading', true); editor.state.seconds.loading = 3; editor.state.draft.notificationMotion.stackMs = 444;
    await editor.save(); assert.equal(editor.state.blocked, false); assert.equal(writes, 1);
    const expected = editor.candidate(); await client.refresh(true);
    assert.deepEqual(client.snapshotV2(), expected); assert.deepEqual(await getV2(), expected);
    assert.equal((row() as { schema_version: number }).schema_version, 2);
    const other = await getV2(); other.notificationMotion.stackMs = 555; assert.equal((await patch(other)).status, 200);
    editor.state.seconds.success = 7; await editor.save(); assert.equal(editor.state.blocked, true); assert.equal(writes, 2);
    await editor.load(); assert.ok(editor.state.incoming); assert.equal(editor.state.seconds.success, 7); assert.equal(writes, 2);
    editor.review(false); assert.equal(editor.state.draft.notificationMotion.stackMs, 555); assert.equal(editor.dirty.value, false);
    assert.equal(editor.state.seconds.success, 1); assert.equal(writes, 2);
  } finally { editor.dispose(); client.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('阶段6真实HTTP保存→公开客户端→中央DOM实时时钟，收起不取消任务且后续结果遵从快照', async () => {
  const { createUiConfigClient, applySavedUiConfig } = await import('../../web/src/notificationConfig.ts');
  const { notify, beginProgressNotice } = await import('../../web/src/notifications.ts');
  const { createNotificationDisplayProbeDom, flushNotificationDisplayProbe: flush } = await import('../../web/test/fixtures/notification-display-dom.ts');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const client = createUiConfigClient((path, init) => fetch(origin + String(path), init));
  const dom = createNotificationDisplayProbeDom();
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const until = async (predicate: () => boolean) => {
    const start = performance.now(); while (!predicate()) { assert.ok(performance.now() - start < 6000, '真实中央计时不得死等'); await sleep(10); }
  };
  try {
    const value = defaultUiConfigV2();
    for (const tone of ['success','info','warning','error'] as const) value.notificationDisplay.types[tone] = { mode:'timed',durationMs:1000 };
    value.notificationDisplay.types.loading = { mode:'timedHide',durationMs:1000 };
    const saved = await fetch(origin + adminPath, { method:'PATCH', headers:{Cookie:cookie,'x-csrf-token':session.csrfToken,'content-type':'application/json'},body:JSON.stringify(value) });
    assert.equal(saved.status,200); const expected:UiConfigV2 = (await saved.json()).data;
    await client.refresh(true); applySavedUiConfig(client.snapshotV2());
    const notice = notify('HTTP保存后的普通错误','error')!; await flush();
    assert.equal(notice.inspect().revision,expected.revision); assert.equal(dom.region.children.length,1);
    await sleep(300); const wrapper=dom.region.children[0]!; wrapper.dispatchEvent(new Event('mouseenter'));
    const remainder=notice.inspect().remainingMs!; assert.ok(remainder>500 && remainder<900);
    await sleep(450); assert.equal(notice.inspect().remainingMs,remainder);
    wrapper.dispatchEvent(new Event('mouseleave')); const resumed=performance.now();
    await until(()=>notice.inspect().phase==='disposed');
    assert.ok(Math.abs(performance.now()-resumed-remainder)<250); assert.equal(dom.region.children.length,0);
    const progress=beginProgressNotice('真实计时收起等待');await flush();
    await until(()=>progress.inspect().phase==='hidden');progress.update('提示隐藏期间任务继续');
    await sleep(40);assert.equal(dom.region.children.length,0);
    // A later admin save cannot alter this pending task's captured result policy.
    const changed=client.snapshotV2();changed.notificationDisplay.types.error={mode:'manual'};
    const reply=await patch(changed);assert.equal(reply.status,200);await client.refresh(true);applySavedUiConfig(client.snapshotV2());
    progress.finish('旧任务结果仍为一秒','error');await flush();
    assert.equal(progress.inspect().revision,expected.revision);assert.equal(dom.region.children.length,1);
    const resultStart=performance.now();await until(()=>progress.inspect().phase==='disposed');
    assert.ok(Math.abs(performance.now()-resultStart-1000)<250);assert.equal(dom.region.children.length,0);
    const next=notify('保存后的新错误采用手动','error')!;await flush();assert.equal(next.inspect().remainingMs,null);assert.equal(next.inspect().revision,expected.revision+1);
    next.dismiss();await flush();assert.equal(dom.region.children.length,0);
  } finally { dom.restore();client.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
