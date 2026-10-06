import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const sheet = (name: string) => postcss.parse(readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8'));
const declarations = (name: string, selector: string, mobile = false) => {
  const found: Record<string, string[]> = {};
  sheet(name).walkRules(selector, rule => {
    if ((rule.parent?.type === 'atrule') !== mobile) return;
    rule.walkDecls(decl => { (found[decl.prop] ??= []).push(decl.value); });
  });
  return found;
};

test('写信入口在手机和桌面共用横向居中对齐，不再让加号独占一行', () => {
  const button = declarations('workspace.css', '.dock-compose');
  assert.deepEqual(button.display, ['flex']);
  assert.deepEqual(button['align-items'], ['center']);
  assert.deepEqual(button['justify-content'], ['center']);
  assert.deepEqual(button.gap, ['10px']);
  assert.deepEqual(declarations('workspace.css', '.dock-menu.is-desktop-sidebar .dock-compose')['justify-content'], ['flex-start']);
});

test('写信弹窗明确高度及可收缩表单行，不依赖不定高度下的零基准flex', () => {
  const dialog = declarations('dialogs.css', 'dialog.modal.compose-dialog');
  assert.deepEqual(dialog.height, ['min(780px,calc(100vh - 32px))', 'min(780px,calc(100dvh - 32px))']);
  const open = declarations('dialogs.css', 'dialog.compose-dialog[open]');
  assert.deepEqual(open.display, ['grid']);
  assert.deepEqual(open['grid-template-rows'], ['auto minmax(0,1fr)']);
  const form = declarations('dialogs.css', '.compose-dialog .compose-form');
  assert.equal(form.flex, undefined);
  assert.deepEqual(form['min-height'], ['0']);
  assert.deepEqual(form['overflow-y'], ['auto']);
});

test('手机弹窗保留旧视口回退、安全区及16px输入，不用最小高度挤出短屏', () => {
  const dialog = declarations('dialogs.css', 'dialog.modal.compose-dialog', true);
  assert.deepEqual(dialog.height, ['min(840px,calc(100vh - 24px))', 'min(840px,calc(100dvh - 24px - env(safe-area-inset-bottom,0px)))']);
  assert.equal(dialog['min-height'], undefined);
  assert.deepEqual(declarations('dialogs.css', '.compose-form :is(input,textarea)', true)['font-size'], ['16px']);
});
