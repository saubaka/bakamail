import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { readFileSync } from 'node:fs';
import { useMailboxStore } from '../src/stores/mailbox.ts';
import { createNotificationStack } from '../src/notifications.ts';
import { createDockScrollIntent, validScrollPosition } from '../src/mail/scrollIntent.ts';
import { readerFrameDocument } from '../src/mail/reader.ts';
const source = (file:string)=>readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8');
const reply=(data:unknown)=>Response.json({ok:true,data,error:''});
test('归档后手动刷新与SSE刷新合并，同一请求两个调用均成功而非误报失败',async()=>{
  const before=globalThis.fetch;setActivePinia(createPinia());const store=useMailboxStore();let calls=0;let done:(r:Response)=>void=()=>{};
  globalThis.fetch=()=>{calls++;return new Promise<Response>(resolve=>{done=resolve;});};
  try {
    store.removeMessages('INBOX',[1]);
    const manual=store.loadMessages('50'), realtime=store.loadMessages('50');assert.equal(calls,1);
    done(reply({items:[],nextBefore:null,total:0}));assert.deepEqual(await Promise.all([manual,realtime]),[true,true]);
    const next=store.loadMessages('50');assert.equal(calls,2);done(reply({items:[],nextBefore:null,total:0}));assert.equal(await next,true);
  }finally{globalThis.fetch=before;}
});
test('并发读取的真实失败仍会拒绝且允许重试，切换文件夹不复用旧请求',async()=>{
  const before=globalThis.fetch;setActivePinia(createPinia());const store=useMailboxStore();let calls=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)throw new Error('network unavailable');return reply({items:[],nextBefore:null,total:0});};
  try{const a=store.loadMessages('50'),b=store.loadMessages('50');const results=await Promise.allSettled([a,b]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1);store.selectFolder('Archive','50');assert.equal(await store.loadMessages('50'),true);assert.equal(calls,2);}finally{globalThis.fetch=before;}
});
test('胶囊堆叠新通知置前，点击轮换原前景回到背景，关闭幂等不丢其他通知',()=>{
  const changes:string[][]=[];const stack=createNotificationStack<string>(items=>changes.push([...items]));
  stack.add('a');stack.add('b');stack.add('c');assert.deepEqual(stack.items,['c','b','a']);stack.cycle();assert.deepEqual(stack.items,['b','a','c']);stack.remove('a');stack.remove('a');assert.deepEqual(stack.items,['b','c']);stack.cycle();assert.deepEqual(stack.items,['c','b']);assert.ok(changes.length>3);
});
test('滚动意图有方向阈值，上下边界和反向回看恢复导航，非法消息不改变状态',()=>{
  const tracker=createDockScrollIntent();const p=(top:number)=>({top,height:400,total:2000});
  assert.equal(tracker.update('reader',p(0)),false);assert.equal(tracker.update('reader',p(12)),false);assert.equal(tracker.update('reader',p(50)),true);assert.equal(tracker.update('reader',p(42)),true);assert.equal(tracker.update('reader',p(24)),false);
  assert.equal(tracker.update('reader',p(100)),true);assert.equal(tracker.update('reader',p(1590)),false);assert.equal(validScrollPosition({top:Infinity,height:10,total:20}),false);assert.equal(validScrollPosition({top:1,height:0,total:3}),false);tracker.reset();assert.equal(tracker.update('reader',p(0)),false);
});
test('隔离正文只注入带随机nonce的自有滚动脚本，消息不包含正文/链接且来源与token验证',()=>{
  const token='a'.repeat(48), html=readerFrameDocument('<p>示例正文</p>',false,token);
  assert.match(html,new RegExp(`script-src 'nonce-${token}'`));assert.match(html,new RegExp(`script nonce="${token}"`));assert.match(html,/parent.postMessage/);assert.match(html,/requestAnimationFrame/);assert.doesNotMatch(html,/script-src 'unsafe-inline'|allow-same-origin/);assert.throws(()=>readerFrameDocument('',false,'bad-token'));
  const reader=source('components/mail/MessageReaderPane.vue');assert.match(reader,/validScrollPosition\(data.position\)/);assert.match(reader,/window.removeEventListener\('message', receiveScroll\)/);
});
test('弹窗具有留白/内部滚动，读取提示与重试在胶囊内，未选择正文不显示残留错误',()=>{
  const css=source('styles/dialogs.css');assert.match(css,/compose-form[^}]*overflow-y:auto/);assert.match(css,/padding:20px 24px 24px/);assert.match(css,/dialog.baka-confirm-dialog\[open\] \{ display:block/);
  const mail=source('views/MailView.vue');assert.doesNotMatch(mail,/class="mail-page-error/);assert.match(mail,/beginProgressNotice\('正在读取邮件…', \{ signal: noticeScope.signal \}\)/);assert.match(mail,/label: '重新同步'/);
  const workspace=source('components/MailWorkspace.vue');assert.match(workspace,/请先从列表选择一封邮件/);assert.match(workspace,/workspace-copyright/);assert.match(workspace,/:inert="dockHidden && !menuOpen"/);
});
test('异步错误反馈全面接入胶囊，必要的字段校验和危险操作确认不被移除',()=>{
  for(const view of ['Login','Register','PasswordReset','Search','Drafts','Contacts','Settings'])assert.match(source(`views/${view}View.vue`),/v-capsule-notice/);
  for(const view of ['Accounts','Admins','AdminLogin','Invites','Security','System','MailOps'])assert.match(source(`views/admin/${view}View.vue`),/v-capsule-notice/);
  const notice=source('notifications.ts');assert.match(notice,/body.inert = index > 0/);assert.match(notice,/action.disabled = true/);assert.match(notice,/region.showPopover/);assert.match(source('components/BakaDialog.vue'),/requiredText/);
});
