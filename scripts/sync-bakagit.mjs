/** Local source-only export. No network, dependencies, database or environment reads. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, mkdirSync, copyFileSync,
  chmodSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceTrees = ['server/src', 'server/test', 'web/src', 'web/test', 'shared', 'scripts/test'];
export const sourceFiles = [
  'package.json', 'package-lock.json', 'CHANGELOG.md', '.gitignore', '.dockerignore', '.env.example',
  'server/package.json', 'server/tsconfig.json', 'web/package.json', 'web/tsconfig.json',
  'web/vite.config.ts', 'web/index.html', '启动BakaMail.command',
  'deploy/Dockerfile', 'deploy/docker-compose.yml', 'deploy/bakamail.env.example',
  'deploy/export-mail-logs.py', 'deploy/mail-log-export.cron',
  'docs/project1-prototype-ledger.jsonl',
  'scripts/audit-project1-prototype.mjs',
  'scripts/inventory-notification-display.mjs', 'scripts/preview-mock-api.mjs',
  'scripts/recover-auth-source.mjs', 'scripts/start-local.mjs',
  'scripts/sync-project1-styles.sh', 'scripts/upload-archive.mjs',
  'scripts/verify-css-parity.sh', 'scripts/verify-live.mjs',
  'scripts/verify-no-protocol-leak.sh', 'scripts/verify-style-contract.mjs',
  'scripts/sync-bakagit.mjs',
];
export const publicTemplates = {
  'README.md': 'docs/github/README.md',
  'AGENTS.md': 'docs/github/AGENTS.md',
  '本地启动说明.md': 'docs/github/local-start.md',
};
const manifestName = '.bakagit-manifest.json';
const skippedNames = new Set(['.DS_Store']);
const forbiddenDirectories = new Set(['node_modules', 'dist', 'data', 'backups', 'coverage',
  '.cache', '.vite', '__pycache__', 'bakagit', '.git']);
const sourceExtensions = /\.(?:ts|vue|mjs|js|css|html|json|sh|py|svg)$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.includes('\\') &&
    path.split('/').every(part => part && part !== '.' && part !== '..') && !path.startsWith('/');
}
function forbidden(path) {
  const parts = path.split('/'), name = parts.at(-1);
  return !safePath(path) || parts.some(part => forbiddenDirectories.has(part)) ||
    (name.startsWith('.env') && name !== '.env.example') ||
    (name.endsWith('.env') && !name.endsWith('.env.example')) ||
    /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(name) ||
    /\.(?:log|pem|key|p12|pfx|zip|tar|gz|pyc)$/i.test(name) ||
    /^(?:id_rsa|id_ed25519|credentials|bakamail-admin-password\.txt)$/i.test(name);
}
function assertPlain(path, directory = false) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`拒绝链接或非普通${directory ? '目录' : '文件'}：${path}`);
  }
  return stat;
}
function ensureParent(root, path) {
  let current = root;
  for (const part of path.split('/').slice(0, -1)) {
    current = join(current, part);
    if (!existsSync(current)) mkdirSync(current);
    assertPlain(current, true);
  }
}
function scan(root, prefix = '', ignoreGit = false) {
  assertPlain(join(root, prefix), true);
  const files = [];
  for (const item of readdirSync(join(root, prefix)).sort()) {
    if (!prefix && ignoreGit && item === '.git') continue; // Never inspect/change repository metadata.
    const path = prefix ? `${prefix}/${item}` : item;
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) throw new Error(`拒绝符号链接：${path}`);
    if (stat.isDirectory()) {
      if (forbidden(path)) throw new Error(`禁止目录：${path}`);
      files.push(...scan(root, path, ignoreGit));
    } else if (stat.isFile()) files.push(path);
    else throw new Error(`拒绝非普通文件：${path}`);
  }
  return files;
}

export function syncBakagit(project, { check = false } = {}) {
  project = resolve(project);
  assertPlain(project, true);
  if (existsSync(join(project, manifestName))) throw new Error('当前目录是发布镜像；请在原开发项目执行同步。');
  const target = join(project, 'bakagit');
  if (existsSync(target)) assertPlain(target, true);
  const expected = new Map();
  const add = (destination, source) => {
    if (forbidden(destination)) throw new Error(`禁止发布：${destination}`);
    // Validate every ancestor, not only the leaf, to prevent copying through links.
    let current = project;
    for (const part of source.split('/').slice(0, -1)) { current = join(current, part); assertPlain(current, true); }
    const path = join(project, source), stat = assertPlain(path);
    const bytes = readFileSync(path);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{20,}/.test(bytes.toString('utf8'))) {
      throw new Error(`疑似密钥内容，拒绝发布（不打印内容）：${source}`);
    }
    expected.set(destination, { source, sha256: digest(bytes), executable: Boolean(stat.mode & 0o111) });
  };
  for (const tree of sourceTrees) {
    for (const path of scan(project, tree)) {
      if (skippedNames.has(path.split('/').at(-1))) continue;
      if (forbidden(path) || !sourceExtensions.test(path)) throw new Error(`源码树内存在未批准文件：${path}`);
      add(path, path);
    }
  }
  for (const path of sourceFiles) add(path, path);
  for (const [destination, source] of Object.entries(publicTemplates)) add(destination, source);
  let previous = {};
  if (existsSync(join(target, manifestName))) {
    assertPlain(join(target, manifestName));
    const manifest = JSON.parse(readFileSync(join(target, manifestName), 'utf8'));
    if (manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
      throw new Error('无效同步清单，请人工检查，不会重置。');
    }
    previous = manifest.files;
    for (const [path, entry] of Object.entries(previous)) {
      if (forbidden(path) || path === manifestName || !/^[a-f0-9]{64}$/.test(entry?.sha256)) {
        throw new Error('清单包含无效路径/哈希，停止。');
      }
    }
  }
  const changes = [], stale = [];
  // Preflight everything before copying/pruning. Unknown files are never silently uploaded or removed.
  if (existsSync(target)) for (const path of scan(target, '', true)) {
    if (path === manifestName) continue;
    if (forbidden(path)) throw new Error(`镜像含禁止文件，请移出后再同步：${path}`);
    const next = expected.get(path), old = previous[path];
    const actual = digest(readFileSync(join(target, path)));
    if (!next && !old) throw new Error(`镜像内有未管理文件，请先审阅：${path}`);
    if (actual !== next?.sha256 && actual !== old?.sha256) throw new Error(`镜像文件被独立修改，请人工合并：${path}`);
    if (!next) stale.push(path);
  }
  for (const [path, entry] of expected) {
    const file = join(target, path);
    if (!existsSync(file) || digest(readFileSync(file)) !== entry.sha256 || Boolean(lstatSync(file).mode & 0o111) !== entry.executable) changes.push(path);
  }
  const files = Object.fromEntries([...expected].sort(([a], [b]) => a.localeCompare(b)));
  const manifest = `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`;
  const manifestChanged = !existsSync(join(target, manifestName)) || readFileSync(join(target, manifestName), 'utf8') !== manifest;
  if (check) {
    if (changes.length || stale.length || manifestChanged) throw new Error(`镜像未同步：更新 ${changes.length}、移除 ${stale.length}；请运行 npm run sync:bakagit`);
  } else {
    if (!existsSync(target)) mkdirSync(target);
    for (const path of changes) {
      ensureParent(target, path);
      copyFileSync(join(project, expected.get(path).source), join(target, path));
      chmodSync(join(target, path), expected.get(path).executable ? 0o755 : 0o644);
    }
    // Only unchanged old source files recorded by this script may be removed; never recursive deletion.
    for (const path of stale) unlinkSync(join(target, path));
    if (manifestChanged) {
      const temp = join(target, `${manifestName}.next`);
      writeFileSync(temp, manifest, { flag: 'wx', mode: 0o644 });
      renameSync(temp, join(target, manifestName));
    }
  }
  return { files: expected.size, updated: changes.length, removed: stale.length, check };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('用法：node scripts/sync-bakagit.mjs [--check]');
    const result = syncBakagit(resolve(dirname(fileURLToPath(import.meta.url)), '..'), { check: process.argv.includes('--check') });
    console.log(`OK: bakagit ${result.check ? '一致性检查' : '同步'}通过；${result.files} 个源码/配置文件，更新 ${result.updated}，移除 ${result.removed}。未操作 Git 或远端。`);
  } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
