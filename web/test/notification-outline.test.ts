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
test('通知是磨砂白胶囊：浅粉细边、柔和阴影、胶囊圆角，进出场为胶囊伸缩并保留减少动画',()=>{
  const css=read('styles/notifications.css');
  const root=postcss.parse(css);
  const rule=root.nodes.find(node=>node.type==='rule'&&node.selector==='.notification-capsule');
  assert.ok(rule&&rule.type==='rule');
  const decls=Object.fromEntries((rule as postcss.Rule).nodes.filter((n):n is postcss.Declaration=>n.type==='decl').map(n=>[n.prop,n.value]));
  assert.equal(decls.border,'1px solid var(--pink-300)');
  assert.equal(decls['border-radius'],'var(--r-pill)');
  assert.equal(decls.background,'var(--glass)');
  assert.equal(decls['box-shadow'],'var(--shadow-2)');
  assert.match(decls.animation??'',/notification-drop-in .*var\(--spring-soft\)/);
  assert.doesNotMatch(css,/dash-outline|line-blue|border-radius: 65%/);
  assert.match(css,/@keyframes notification-drop-in \{[\s\S]*?width: 52px[\s\S]*?width: 100%/);
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
