import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { authenticationChecks, authenticationSummary, readerFrameDocument, sanitizeReaderHtml } from '../src/mail/reader.ts';
const source = (name: string) => readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8');
test('正文认证归并：全部通过、部分、失败及缺失均不伪报可信',()=>{
  assert.equal(authenticationSummary(authenticationChecks({'Authentication-Results':'mx; SPF=pass; DKIM=pass; DMARC=pass'})),'安全认证 · 全部通过');
  assert.equal(authenticationSummary(authenticationChecks({'received-spf':'Pass (sender verified)'})),'安全认证 · 1/3 通过');
  assert.equal(authenticationSummary(authenticationChecks({})),'安全认证 · 未确认');
  const checks=authenticationChecks({'authentication-results':'mx; spf=pass; dkim=fail; dmarc=temperror'});
  assert.deepEqual(checks.map(check=>check.label),['通过','未通过','验证异常']);
  assert.equal(authenticationSummary(checks),'安全认证 · 需留意');
});
test('正文认证的重复/冲突结果保守处理，neutral不会误判通过',()=>{
  assert.equal(authenticationChecks({'authentication-results':'spf=pass; spf=fail'})[0]?.result,'fail');
  assert.equal(authenticationChecks({'authentication-results':'spf=neutral; dkim=none'})[0]?.label,'未确认');
  assert.equal(authenticationChecks({'authentication-results':'spf=passive'})[0]?.label,'未确认');
});
test('正文 iframe 禁止邮件脚本，隔离自有滚动桥并保留 CSP 和远程资源授权',()=>{
  const frame=readerFrameDocument('<p>示例</p>',false);
  assert.match(frame,/default-src 'none'/);assert.match(frame,/img-src data: cid:;/);assert.doesNotMatch(frame,/img-src[^;]*https:/);
  assert.match(readerFrameDocument('<p>示例</p>',true),/img-src data: cid: https: http:/);
  const component=source('components/mail/MessageReaderPane.vue');
  assert.match(component,/sandbox="allow-scripts"/);assert.match(component,/referrerpolicy="no-referrer"/);
  assert.doesNotMatch(component,/allow-same-origin/);
  assert.match(component,/event.source !== bodyFrame.value.contentWindow/);assert.match(component,/event.origin !== 'null'/);
  assert.match(component,/data.token !== frameDocument.value.token/);
  assert.deepEqual(sanitizeReaderHtml('',false),{html:'',blocked:0});
});
test('媒体授权等待提示出场，严格拦截无授权入口，切换邮件清除一次授权',()=>{
  const component=source('components/mail/MessageReaderPane.vue');
  assert.match(component,/@after-leave="approveImages"/);assert.match(component,/@click="mediaApproving = true"/);
  assert.match(component,/v-if="remoteImages !== 'block'"/);assert.match(component,/props.remoteImages === 'block'/);
  assert.match(component,/props.detail\?\.uid/);assert.match(component,/allowImages.value = props.remoteImages === 'allow'/);
  assert.match(component,/@load="frameLoaded = true"/);assert.match(component,/'is-media-loaded': frameLoaded && allowImages/);
});
test('正文伸展、短时分组入场、折叠可访问性与减少动画规则齐全',()=>{
  const css=source('styles/reader.css'), component=source('components/mail/MessageReaderPane.vue');
  assert.match(css,/mail-body__frame[^}]*flex:1 0 220px/);assert.match(css,/padding:18px 24px 24px/);
  assert.match(css,/reader-arrive 240ms/);assert.match(css,/reader-media-arrive 280ms/);assert.match(css,/prefers-reduced-motion/);
  assert.match(component,/:inert="!showSecurity"/);assert.match(component,/:aria-expanded="showSecurity"/);
  assert.doesNotMatch(component,/class="mail-badges"/);
  assert.match(readerFrameDocument('',false),/prefers-reduced-motion/);
  assert.match(source('styles/workspace.css'),/body:has\(\.mail-workspace\) \{ padding-bottom: 0; \}/);
});
test('远程图片净化为自建占位而非破图，协议相对链接、srcset和事件属性被处理',()=>{
  const originalParser=globalThis.DOMParser;
  const attrs=new Map([['src','//example.test/pixel.png'],['srcset','https://example.test/2.png 2x'],['onload','unsafe()'],['alt','示例图片']]);
  let replacement: any;
  const image={ get attributes(){return [...attrs].map(([name,value])=>({name,value}));},getAttribute:(name:string)=>attrs.get(name)??null,removeAttribute:(name:string)=>attrs.delete(name),replaceWith:(node:unknown)=>{replacement=node;} };
  const doc={body:{innerHTML:'sanitized'},querySelectorAll:(selector:string)=>selector==='*'||selector==='img'?[image]:[],createElement:()=>({className:'',textContent:'',attributes:new Map(),setAttribute(name:string,value:string){this.attributes.set(name,value);}})};
  globalThis.DOMParser=class {parseFromString(){return doc;}} as unknown as typeof DOMParser;
  try {
    const blocked=sanitizeReaderHtml('fixture',false);
    assert.equal(blocked.blocked,1);assert.equal(attrs.has('srcset'),false);assert.equal(attrs.has('onload'),false);
    assert.equal(replacement.className,'baka-blocked-image');assert.equal(replacement.textContent,'示例图片');assert.equal(replacement.attributes.get('role'),'img');
    replacement=undefined;assert.equal(sanitizeReaderHtml('fixture',true).blocked,0);assert.equal(replacement,undefined);
  } finally { globalThis.DOMParser=originalParser; }
});
