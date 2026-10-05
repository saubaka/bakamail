import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  symlinkSync, chmodSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { syncBakagit, sourceFiles, sourceTrees, publicTemplates } from '../sync-bakagit.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'bakamail-source-mirror-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true })); // Only this freshly created temporary fixture.
  const put = (path, content = `fixture ${path}\n`) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  for (const tree of sourceTrees) { mkdirSync(join(root, tree), { recursive: true }); put(`${tree}/example.ts`); }
  for (const path of [...sourceFiles, ...Object.values(publicTemplates)]) put(path);
  return { root, put, mirror: join(root, 'bakagit') };
}

test('pure export: sources and public templates, not dependencies/DB/secrets/history/builds', t => {
  const f = fixture(t);
  for (const path of ['.env', '.env.local', 'data/private.db', 'node_modules/x/index.js',
    'web/dist/index.html', 'docs/handoff/conversation.md', 'docs/handoff/session-visible.jsonl',
    'docs/screenshots/private.png', 'scripts/export-visible-session.mjs', 'scripts/qa-green-account.mjs']) f.put(path);
  const result = syncBakagit(f.root);
  assert.ok(result.files > sourceFiles.length);
  assert.equal(readFileSync(join(f.mirror, 'README.md'), 'utf8'), readFileSync(join(f.root, publicTemplates['README.md']), 'utf8'));
  for (const path of ['.env', '.env.local', 'data', 'node_modules', 'web/dist', 'docs/handoff',
    'docs/screenshots', 'scripts/export-visible-session.mjs', 'scripts/qa-green-account.mjs']) assert.equal(existsSync(join(f.mirror, path)), false);
  assert.equal(syncBakagit(f.root, { check: true }).updated, 0);
});

test('idempotent sync, source updates and executable permissions', t => {
  const f = fixture(t);
  chmodSync(join(f.root, '启动BakaMail.command'), 0o755);
  syncBakagit(f.root);
  const before = statSync(join(f.mirror, '.bakagit-manifest.json')).mtimeMs;
  assert.equal(syncBakagit(f.root).updated, 0);
  assert.equal(statSync(join(f.mirror, '.bakagit-manifest.json')).mtimeMs, before);
  assert.ok(statSync(join(f.mirror, '启动BakaMail.command')).mode & 0o111);
  f.put('web/src/example.ts', 'updated\n');
  assert.throws(() => syncBakagit(f.root, { check: true }), /未同步/);
  assert.equal(syncBakagit(f.root).updated, 1);
  assert.equal(readFileSync(join(f.mirror, 'web/src/example.ts'), 'utf8'), 'updated\n');
});

test('prune only unchanged managed files; .git and nonmanaged files survive', t => {
  const f = fixture(t);
  syncBakagit(f.root);
  f.put('bakagit/.git/config', 'repository metadata');
  unlinkSync(join(f.root, 'shared/example.ts'));
  assert.equal(syncBakagit(f.root).removed, 1);
  assert.equal(readFileSync(join(f.mirror, '.git/config'), 'utf8'), 'repository metadata');
  f.put('bakagit/unmanaged.txt', 'user content');
  assert.throws(() => syncBakagit(f.root), /未管理文件/);
  assert.equal(readFileSync(join(f.mirror, 'unmanaged.txt'), 'utf8'), 'user content');
});

test('mirror independent edit blocks all writes before preflight completes', t => {
  const f = fixture(t);
  syncBakagit(f.root);
  f.put('bakagit/shared/example.ts', 'user edit');
  f.put('web/src/example.ts', 'new source');
  assert.throws(() => syncBakagit(f.root), /独立修改/);
  assert.notEqual(readFileSync(join(f.mirror, 'web/src/example.ts'), 'utf8'), 'new source');
  unlinkSync(join(f.root, 'shared/example.ts'));
  assert.throws(() => syncBakagit(f.root), /独立修改/);
  assert.equal(readFileSync(join(f.mirror, 'shared/example.ts'), 'utf8'), 'user edit');
});

test('reject symlink target and source, never follow links', t => {
  const f = fixture(t);
  const external = mkdtempSync(join(tmpdir(), 'bakamail-mirror-external-test-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  symlinkSync(external, f.mirror);
  assert.throws(() => syncBakagit(f.root), /拒绝链接/);
  unlinkSync(f.mirror);
  symlinkSync(join(f.root, '.env.example'), join(f.root, 'shared/link.ts'));
  assert.throws(() => syncBakagit(f.root), /符号链接/);
});

test('reject unknown source artifacts and mirror runtime contamination', t => {
  const f = fixture(t);
  f.put('web/src/private.sqlite-wal', 'private data');
  assert.throws(() => syncBakagit(f.root), /未批准文件/);
  assert.equal(existsSync(f.mirror), false);
  unlinkSync(join(f.root, 'web/src/private.sqlite-wal'));
  syncBakagit(f.root);
  f.put('bakagit/node_modules/example.js');
  assert.throws(() => syncBakagit(f.root, { check: true }), /禁止目录/);
});

test('reject suspicious key content without printing it', t => {
  const f = fixture(t);
  const fake = 'ghp' + '_' + 'Z'.repeat(35);
  f.put('shared/example.ts', `export const value = '${fake}';`);
  assert.throws(() => syncBakagit(f.root), error => error.message.includes('疑似密钥') && !error.message.includes(fake));
});

test('reject malformed/traversal manifest without deleting any file', t => {
  const f = fixture(t);
  syncBakagit(f.root);
  f.put('bakagit/.bakagit-manifest.json', JSON.stringify({ schemaVersion: 1, files: { '../.env': { sha256: 'a'.repeat(64) } } }));
  assert.throws(() => syncBakagit(f.root), /无效路径/);
  assert.ok(existsSync(join(f.mirror, 'shared/example.ts')));
});

test('cannot recursively export the release mirror', t => {
  const f = fixture(t);
  syncBakagit(f.root);
  assert.throws(() => syncBakagit(f.mirror), /当前目录是发布镜像/);
});

test('parent release excludes nested mirror and local rules mandate sync/check', () => {
  const root = new URL('../../', import.meta.url);
  // Template fixture files deliberately need not contain project-specific prose.
  const agents = readFileSync(new URL('AGENTS.md', root), 'utf8');
  assert.match(agents, /EVERY change/);
  assert.match(agents, /npm run sync:bakagit/);
  assert.match(agents, /npm run check:bakagit/);
  assert.match(readFileSync(new URL('.dockerignore', root), 'utf8'), /^bakagit$/m);
  assert.match(readFileSync(new URL('scripts/deploy-green.mjs', root), 'utf8'), /--exclude=\.\/bakagit/);
});

test('project versions, lockfile and Chinese changelog agree; publication rules are retained', () => {
  const root = new URL('../../', import.meta.url);
  const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
  const version = json('package.json').version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const lock = json('package-lock.json');
  assert.equal(lock.version, version);
  for (const workspace of ['', 'server', 'web']) assert.equal(lock.packages[workspace].version, version);
  for (const workspace of ['server', 'web']) assert.equal(json(`${workspace}/package.json`).version, version);
  assert.ok(sourceFiles.includes('CHANGELOG.md'));
  const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8');
  assert.ok(changelog.startsWith(`# 版本变更记录\n\n## v${version} · `));
  assert.match(changelog, /^- .*简体中文/m);
  const agents = readFileSync(new URL('AGENTS.md', root), 'utf8');
  assert.match(agents, /vX\.Y\.Z/);
  assert.match(agents, /简体中文/);
  assert.match(agents, /授权/);
});
