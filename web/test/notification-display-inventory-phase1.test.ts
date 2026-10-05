import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Site = { file: string; line: number; kind: 'toast' | 'notify' | 'progress' | 'directive'; tone: string };

test('胶囊清单识别真实调用和Vue指令，排除上传回调与函数声明', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/inventory-notification-display.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const sites = JSON.parse(result.stdout) as Site[];
  assert.ok(sites.length > 0);
  assert.ok(sites.every(site => site.file.startsWith('web/src/') && site.line > 0));
  assert.equal(sites.some(site => site.file === 'web/src/api/client.ts'), false, '上传局部notify不是胶囊');
  assert.ok(sites.some(site => site.file.endsWith('PasswordResetView.vue') && site.kind === 'directive'));
  assert.ok(sites.some(site => site.file.endsWith('ComposeDialog.vue') && site.kind === 'directive'));
  assert.ok(sites.some(site => site.file.endsWith('MailView.vue') && site.kind === 'progress' && site.tone === 'loading'));
  assert.ok(sites.some(site => site.file === 'web/src/notifications.ts' && site.kind === 'notify'));
  assert.equal(sites.some(site => site.file === 'web/src/notifications.ts' && site.kind === 'progress'), false, '声明不是调用');
  const unique = new Set(sites.map(site => `${site.file}:${site.line}:${site.kind}`));
  assert.equal(unique.size, sites.length);
});
