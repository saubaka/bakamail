import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const read=(file:string)=>readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8');
test('所有通知走同一完整CSS边框，不再测量/裁剪水滴的SVG描边',()=>{
  const source=read('notifications.ts');
  assert.doesNotMatch(source,/attachSurfaceLines|disposeLines|createElementNS|viewBox/);
  for(const caller of ['notify','beginProgressNotice']) assert.match(source,new RegExp(`export function ${caller}`));
  assert.match(source,/displayNotification\(\{ message, tone, options \}\)/);
  assert.match(source,/message, tone: 'info', progress, options/);
  assert.match(source,/text.textContent = content/);
});
test('入场/完成/退场/背景同一实线无透明覆盖、无phase SVG门控',()=>{
  const theme=read('styles/dashed-accent.css'),css=read('styles/notifications.css');
  const root=postcss.parse(theme);
  const rules=root.nodes.filter(node=>node.type==='rule'&&node.selector==='.notification-stack-card .notification-capsule');
  assert.equal(rules.length,1);
  const rule=rules[0]; assert.equal(rule?.type,'rule');
  if(rule?.type==='rule') assert.ok(rule.nodes.some(n=>n.type==='decl'&&n.prop==='border'&&n.value==='1px solid var(--line-blue-strong)'));
  assert.doesNotMatch(theme,/notification-capsule[^{}]*\{[^}]*border-color:transparent|notification-capsule[^{}]*> \.dash-outline/);
  assert.match(css,/border-radius: 28px/);
  assert.match(css,/notification-capsule\.is-leaving/);
  assert.match(css,/is-background \.notification-capsule/);
  assert.match(css,/prefers-reduced-motion: ?reduce/);
});
test('堆叠高度不使用缩放中的视觉尺寸，保留安全文本/焦点/取消逻辑',()=>{
  const source=read('notifications.ts');
  assert.match(source,/Math.max\(56, node.offsetHeight\)/);
  assert.doesNotMatch(source,/node.getBoundingClientRect\(\)/);
  assert.match(source,/body.inert = index > 0/);
  assert.match(source,/wrapper.inert = true/);
  assert.match(source,/notice.progress\?\.listeners.delete\(applyProgress\)/);
  assert.doesNotMatch(source,/innerHTML/);
});
