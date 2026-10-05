import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createMemoryHistory, createRouter } from 'vue-router';
import { adminRoutes } from '../src/auth/adminRoutes.ts';
import { workspaceRouteKey } from '../src/auth/workspaceRouteKey.ts';
const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('后台所有子路由共享同一个shell key，独立登录/公开页仍不同', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: adminRoutes });
  const keys = ['overview','accounts','invites','mail-ops','security','admins','system']
    .map(name => workspaceRouteKey(router.resolve(`/bakaadmin/${name}`)));
  assert.deepEqual([...new Set(keys)], ['admin-workspace']);
  assert.equal(workspaceRouteKey(router.resolve('/bakaadmin')), 'admin-login');
  assert.equal(workspaceRouteKey({ meta: { auth: 'mail' }, name: 'mail-search', path: '/mail/search' }), 'mail-workspace');
  assert.equal(workspaceRouteKey({ meta: {}, name: 'intro', path: '/' }), 'intro');
  assert.match(source('App.vue'), /:key="workspaceRouteKey\(route\)"/);
});

test('会话重验证不卸载已验证的后台面板，仍保持每次服务端鉴权', () => {
  const shell = source('views/admin/AdminShell.vue');
  assert.match(shell, /const loading = computed\(\(\) => !session.initialized \|\| !session.me\)/);
  assert.doesNotMatch(shell, /const loading = computed\(\(\) => session.loading/);
  assert.match(source('router.ts'), /checkAdminEntry\(\(\) => session.restore\(true\)/);
  assert.match(shell, /name="admin-panel" mode="out-in"/);
  assert.match(shell, /class="admin-route-panel"/);
  assert.match(shell, /\.inert = true/);
});

test('桌面菜单允许过渡中改选，旧请求不能清除新导航busy，移动端保留收起互斥', () => {
  const mail = source('components/MailWorkspace.vue');
  assert.match(mail, /class="dock-navigation-item"[^>]*:disabled="!isDesktop && navigationBusy"/);
  assert.match(mail, /if \(!isDesktop.value && navigationBusy.value\) return/);
  assert.match(mail, /const generation = \+\+navigationGeneration/);
  assert.match(mail, /if \(generation !== navigationGeneration\) return/);
  assert.match(mail, /if \(generation === navigationGeneration\) navigating.value = false/);
  assert.match(mail, /if \(!element.isConnected \|\| element.classList.contains\('mail-panel-leave-active'\)\) return/);
  assert.doesNotMatch(mail, /location\.(reload|assign|replace)/);
});

test('后台面板动效仅transform/opacity且减少动画可用，菜单没有整页动画', () => {
  const css = source('styles/admin.css');
  assert.match(css, /\.admin-panel-enter-active \{ transition: opacity 180ms/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /\.admin-shell[^}]*animation:/);
});
