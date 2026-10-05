import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { attachSurfaceLines } from '../src/surfaceLines.ts';
const source=(name:string)=>readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8');
test('实线几何实际随尺寸变化、四分段复用、卸载断开观察器且移除SVG',()=>{
  const originalDocument=globalThis.document, originalStyle=globalThis.getComputedStyle, originalObserver=globalThis.ResizeObserver;
  const made:any[]=[];let callback:()=>void=()=>{},disconnected=0,removed=0;
  function node(){const n={attrs:new Map<string,string>(),classList:{add(...values:string[]){n.attrs.set('classes',values.join(' '));}},children:[] as any[],setAttribute(k:string,v:string){n.attrs.set(k,v);},append(child:any){n.children.push(child);},remove(){removed++;}};made.push(n);return n;}
  globalThis.document={createElementNS:()=>node()} as unknown as Document;
  globalThis.getComputedStyle=()=>({borderTopLeftRadius:'22px'}) as CSSStyleDeclaration;
  globalThis.ResizeObserver=class { constructor(fn:()=>void){callback=fn;} observe(){} disconnect(){disconnected++;} } as unknown as typeof ResizeObserver;
  const element={clientWidth:80,clientHeight:42,children:[] as any[],append(x:any){this.children.push(x);},contains(x:any){return this.children.includes(x);}};
  try{
    const stop=attachSurfaceLines(element as unknown as HTMLElement);
    assert.equal(made.length,5); assert.equal(made[0].attrs.get('viewBox'),'0 0 80 42');
    assert.equal(made[1].attrs.get('width'),'77');assert.equal(made[1].attrs.get('rx'),'21');
    assert.equal(attachSurfaceLines(element as unknown as HTMLElement),stop);assert.equal(made.length,5);
    element.clientWidth=120;callback();assert.equal(made[0].attrs.get('viewBox'),'0 0 120 42');
    assert.equal(made[1].attrs.get('width'),'117');assert.equal(made[0].attrs.get('aria-hidden'),'true');
    stop();assert.equal(disconnected,1);assert.equal(removed,1);
  }finally{globalThis.document=originalDocument;globalThis.getComputedStyle=originalStyle;globalThis.ResizeObserver=originalObserver;}
});
test('通知不含下一条按钮，公共宽度相同，背景每层仅微缩1.5%，无选中提示无返回列表',()=>{
  const notice=source('notifications.ts'),css=source('styles/notifications.css'),workspace=source('components/MailWorkspace.vue');
  assert.doesNotMatch(notice,/notification-capsule__next|next.addEventListener/);
  assert.match(notice,/Math.max\(\.\.\.items.map\(item => item.width\)\)/);
  assert.match(css,/stack-depth,0\) \* \.015/);assert.match(notice,/Math.min\(340/);
  assert.doesNotMatch(workspace,/label: '返回列表'/);assert.match(notice,/wrapper.addEventListener\('click'/);
});
test('展开菜单不禁用列表正文；切换先收起，遮罩在开始关闭时撤下',()=>{
  const workspace=source('components/MailWorkspace.vue');
  assert.doesNotMatch(workspace,/:disabled="menuOpen"/);
  assert.match(workspace,/async function showReader\(\)[\s\S]*?await closeMenu\(false\)/);
  assert.match(workspace,/async function showList\(\)[^\n]*await closeMenu\(false\)/);
  assert.match(workspace,/v-if="!isDesktop && menuOpen && !closing"/);assert.match(workspace,/:inert="isDesktop \? undefined : \(!menuOpen \|\| closing\)"/);
  assert.match(workspace,/parentElement\?\.querySelectorAll/);
});
test('模态保持安全边界而视觉遮罩优先消失，所有弹出表面有同一分段线条',()=>{
  const css=source('styles/dashed-accent.css');
  assert.match(css,/is-closing::backdrop[^}]*opacity:0!important[^}]*backdrop-filter:none!important[^}]*transition:none!important/);
  assert.match(source('dialog.ts'),/attachSurfaceLines\(element\)/);assert.match(source('dialog.ts'),/state.lines\?\.\(\)/);
  assert.match(source('themeControls.ts'),/disposeLines=attachSurfaceLines\(popup\)/);
  assert.match(source('components/RecipientField.vue'),/<LineOutline/);
  assert.match(css,/dash-fragment-travel 420ms/);assert.match(css,/stroke-dasharray:none/);
  assert.doesNotMatch(css,/border-style:dashed|outline:[^;]*dashed|stroke-dasharray:5 5/);
  assert.match(source('mail/reader.ts'),/border:1px solid #d9e8f6/);
});
test('品牌留白和版权位置明确，强调为实线非蓝色块，减少动画保持静态可用',()=>{
  const css=source('styles/dashed-accent.css'),workspaceCss=source('styles/workspace.css');
  assert.match(source('components/MailWorkspace.vue'),/workspace-brand[^>]*>bakamail/);
  assert.match(workspaceCss,/bottom: calc\(62px/);assert.match(workspaceCss,/workspace-copyright[^}]*font-size:12px/);
  assert.match(workspaceCss,/dock-menu-in 360ms/);assert.match(workspaceCss,/scale\(\.045,\.03\)/);
  assert.match(css,/\.button\.button--primary/);assert.match(css,/input\[type="checkbox"\]/);
  assert.match(css,/background:var\(--surface\)!important/);assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/border-style:solid!important/);
  assert.match(css,/animation:none!important; transform:none!important; opacity:1/);
});
