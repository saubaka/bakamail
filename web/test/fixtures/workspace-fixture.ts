// Vite-only acceptance harness: ALL transports are mocked; never touches a real mailbox.
import { createApp, h, nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import App from '../../src/App.vue';
import MailWorkspace from '../../src/components/MailWorkspace.vue';
import MailView from '../../src/views/MailView.vue';
import ContactsView from '../../src/views/ContactsView.vue';
import SearchView from '../../src/views/SearchView.vue';
import SettingsView from '../../src/views/SettingsView.vue';
import DraftsView from '../../src/views/DraftsView.vue';
import { pinia } from '../../src/stores/pinia';
import { useSessionStore } from '../../src/stores/session';
import { checkMailEntry } from '../../src/auth/entryGate';
import { beginProgressNotice, initializeNotifications, notify } from '../../src/notifications';
import { defaultUiConfigV2 } from '../../../shared/notificationDisplay';
import { applySavedUiConfig } from '../../src/notificationConfig';
import { applyMotionPreferences, currentMotionPreferences, initializeMotionPreferences, motionDirective } from '../../src/motion';
import { initializeThemeValidation, themedControlDirective } from '../../src/themeControls';
import { capsuleFeedbackDirective } from '../../src/capsuleFeedback';
import { pressFeedbackDirective } from '../../src/pressFeedback';
import { confirmDialog } from '../../src/dialog';
import { installNavigationContinuity } from './navigation-continuity';
import { installComposeViewportFixture } from './compose-viewport-fixture';
import '../../src/styles/vendor/project1-app.css';
import '../../src/styles/vendor/project1-small-window-theme.css';
import '../../src/styles/mail-overrides.css';
import '../../src/styles/mail-pages.css';
import '../../src/styles/admin.css';
import '../../src/styles/motion.css';
import '../../src/styles/workspace.css';
import '../../src/styles/notifications.css';
import '../../src/styles/theme-controls.css';
import '../../src/styles/search-motion.css';
import '../../src/styles/reader.css';
import '../../src/styles/dialogs.css';
import '../../src/styles/local-theme.css';
import '../../src/styles/dashed-accent.css';
installComposeViewportFixture();
let failNext = false;
const navigationDelay = new URLSearchParams(location.search).get('navigationDelay') === '1';
let failReadNext = false, slowReadNext = false;
const sample = Array.from({length:48}, (_,i) => ({uid:48-i,subject:`示例邮件 ${48-i} · 阅读与排版${(48-i)%7===0?' · 长主题与窄屏换行验收'.repeat(5):''}`,from:[{name:'示例团队',address:'hello@example.test'}],to:[{name:'阅读者',address:'reader@example.test'}],date:'2026-09-27T03:20:00Z',size:4096,seen:i%3!==0,flagged:false,answered:false,hasAttachments:false}));
const pages: Record<string, typeof sample> = { INBOX:[...sample], Archive:[] };
// Bounded fixture-only observation evidence. Never installed in the shipped app.
const rowObservations: unknown[] = [];
const NativeIntersectionObserver = window.IntersectionObserver;
window.IntersectionObserver = class extends NativeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    super((entries, observer) => {
      for(const entry of entries) if(entry.target.classList.contains('mail-row')) {
        rowObservations.push({uid:entry.target.getAttribute('data-uid'),intersects:entry.isIntersecting,ratio:entry.intersectionRatio,top:entry.boundingClientRect.top});
      }
      if(rowObservations.length>3000) rowObservations.splice(0,rowObservations.length-3000);
      callback(entries,observer);
    },options);
  }
};
const streams: MockStream[] = [];
class MockStream {
  listeners = new Map<string, ((e: Event)=>void)[]>(); onerror = null;
  constructor(){ streams.push(this); setTimeout(()=>this.emit('ready'),20); }
  addEventListener(type:string,listener:(e:Event)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  emit(type:string){ this.listeners.get(type)?.forEach(fn=>fn(new MessageEvent(type,{data:'{}'}))); }
  close(){ this.listeners.clear(); }
}
window.EventSource = MockStream as unknown as typeof EventSource;
window.XMLHttpRequest = class { open(){throw new Error('隔离验收禁止实际发送');} } as unknown as typeof XMLHttpRequest;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin), path=url.pathname, method=init?.method??'GET';
  const payload = typeof init?.body==='string' ? JSON.parse(init.body) : {};
  const reading=/^\/api\/messages\/\d+$/.test(path);
  const slow=reading&&slowReadNext, failed=reading&&failReadNext;
  if(reading){slowReadNext=false;failReadNext=false;}
  // Intentionally allow an old delayed response to resolve after AbortSignal:
  // the production read generation check must reject it, not this mock.
  await new Promise(resolve=>setTimeout(resolve,slow?1500:path==='/api/auth/me'&&navigationDelay?350:path==='/api/messages'||reading?220:25));
  if(failed) return new Response(JSON.stringify({ok:false,data:null,error:'隔离示例：正文读取失败'}),{status:503});
  let data: unknown = {};
  if(path==='/api/auth/me') data={mailbox:'reader@example.test',domain:'example.test',csrfToken:'fixture-only',expiresAt:'2099-01-01T00:00:00Z',liveConnections:1,maxMessageBytes:33554432};
  else if(path==='/api/folders') data={account:'reader@example.test',folders:['INBOX','Archive'].map(path=>({path,name:path,specialUse:path==='Archive'?'\\Archive':null,subscribed:true,messages:pages[path]!.length,unseen:pages[path]!.filter(m=>!m.seen).length}))};
  else if(path==='/api/settings') data={settings:{remoteImages:'ask',pageSize:'50'}};
  else if(path==='/api/contacts') data={contacts:[]};
  else if(path==='/api/drafts') data=method==='POST'?{id:'fixture-draft-1'}:{drafts:[]};
  else if(path.startsWith('/api/drafts/')) data={};
  else if(path==='/api/messages'&&method==='GET') {
    if(failNext){failNext=false;return new Response(JSON.stringify({ok:false,data:null,error:'示例：邮件操作已完成，但列表刷新失败'}),{status:503});}
    const items=pages[url.searchParams.get('folder')??'INBOX']??[]; data={items,nextBefore:null,total:items.length};
  } else if(/^\/api\/messages\/\d+$/.test(path)) {
    const original=pages[url.searchParams.get('folder')??'INBOX']!.find(m=>m.uid===Number(path.split('/').at(-1)))!;
    data={...original,cc:[],replyTo:[],references:[],text:'这是一封本地示例邮件。',html:`<h3>给阅读留一点空间</h3>${'<p>示例段落：更长的正文应在阅读区域内部滚动。向下专注阅读，向上回看时重新出现导航。</p>'.repeat(32)}`,attachments:[],headers:{'authentication-results':'mx.example.test; spf=pass; dkim=pass; dmarc=pass'}};
  } else if(path==='/api/messages/move') {
    const moved=pages[payload.folder]!.filter(m=>payload.uids.includes(m.uid));
    pages[payload.folder]=pages[payload.folder]!.filter(m=>!payload.uids.includes(m.uid));
    pages[payload.target]=[...(pages[payload.target]??[]),...moved];
    setTimeout(()=>streams.forEach(s=>s.emit('expunge')),1);
  } else if(path==='/api/messages/flags') {
    pages[payload.folder]=pages[payload.folder]!.map(m=>payload.uids.includes(m.uid)?{...m,
      seen:payload.flags?.includes('\\Seen')?payload.mode!=='remove':m.seen,
      flagged:payload.flags?.includes('\\Flagged')?payload.mode!=='remove':m.flagged}:m);
    data={};
  }
  else throw new Error(`隔离验收阻止未模拟请求：${method} ${path}`);
  return new Response(JSON.stringify({ok:true,data,error:''}),{status:200,headers:{'content-type':'application/json'}});
};
document.addEventListener('click',event=>{if((event.target as Element)?.closest('a[href^="/api/"]'))event.preventDefault();},true);
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',redirect:'/mail'},{path:'/mail',component:MailWorkspace,meta:{auth:'mail'},children:[{path:'',name:'mail',component:MailView},{path:'contacts',name:'contacts',component:ContactsView},{path:'search',name:'search',component:SearchView},{path:'settings',name:'settings',component:SettingsView},{path:'drafts',name:'drafts',component:DraftsView}]}]});
// Same forced server-session gate as production; the endpoint above is fully mocked.
router.beforeEach(to => {
  if (to.meta.auth !== 'mail') return true;
  const session = useSessionStore(pinia);
  return checkMailEntry(() => session.restore(true), () => session.clear(), false, to.fullPath);
});
initializeMotionPreferences(); initializeThemeValidation(); initializeNotifications();
async function runReadAcceptance(event: MouseEvent) {
  const control=event.currentTarget as HTMLButtonElement;
  const output=document.querySelector('#fixture-read-acceptance')!;
  let initial: (string | undefined)[] = [];
  const results: unknown[]=[];
  const waitFor=async(check:()=>boolean)=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw new Error('等待可见状态超时');await new Promise(resolve=>setTimeout(resolve,30));}};
  const inspect=()=>{
    const body=document.querySelector('.mail-pane--list .mail-pane__body')!.getBoundingClientRect();
    const rows=Array.from(document.querySelectorAll<HTMLElement>('.mail-row'));
    const visible=rows.filter(r=>{const box=r.getBoundingClientRect();return box.bottom>body.top+2&&box.top<body.bottom-2;});
    return {uids:rows.map(r=>r.dataset.uid),visible:visible.map(r=>({uid:r.dataset.uid,state:r.dataset.rowReveal,opacity:getComputedStyle(r).opacity})),scrollTop:document.querySelector('.mail-pane--list .mail-pane__body')!.scrollTop};
  };
  control.disabled=true; output.textContent='运行中';
  try {
    // The production list intentionally fills rows one by one. Do not capture a partial UID baseline.
    await waitFor(()=>document.querySelectorAll('.mail-row').length === pages.INBOX!.length
      && !document.querySelector('.mail-pane--list .mail-pane__head')!.textContent?.includes('同步中'));
    initial=Array.from(document.querySelectorAll<HTMLElement>('.mail-row')).map(r=>r.dataset.uid);
    const ids=initial.slice(0,20).map(Number);
    if(ids.length<20)throw new Error('至少需要20封示例邮件，请重新打开夹具');
    for(const uid of [...ids,...Array(10).fill(ids.at(-1))]) {
      const row=document.querySelector<HTMLElement>(`.mail-row[data-uid="${uid}"]`)!;
      row.scrollIntoView({block:'nearest',behavior:'instant'});
      await waitFor(()=>getComputedStyle(row).opacity==='1');
      const subject=row.querySelector('.mail-row__subject')!.textContent;
      await waitFor(()=>!document.querySelector('.mail-pane--list .mail-pane__head')!.textContent?.includes('同步中'));
      row.querySelector<HTMLButtonElement>('.mail-row__open')!.click();
      await nextTick(); // Same-UID repeats must await the new reader, not old HTML.
      if(!row.classList.contains('is-current')) {
        await waitFor(()=>!document.querySelector('.mail-pane--list .mail-pane__head')!.textContent?.includes('同步中'));
        row.querySelector<HTMLButtonElement>('.mail-row__open')!.click(); await nextTick();
      }
      await waitFor(()=>document.querySelector('.mail-pane--reader h2')?.textContent===subject&&!row.classList.contains('is-unread'));
      await waitFor(()=>inspect().visible.every(r=>Number(r.opacity)>.99));
      const state=inspect();
      if(JSON.stringify(state.uids)!==JSON.stringify(initial))throw new Error('UID 数量/顺序变化');
      results.push({uid,...state});
    }
    output.textContent=JSON.stringify({ok:true,width:innerWidth,expanded:document.querySelector('.mail-workspace')!.classList.contains('is-desktop-sidebar-expanded'),opens:20,repeats:10,results});
  } catch(error) { output.textContent=JSON.stringify({ok:false,error:String(error),results,state:inspect()}); }
  finally {control.disabled=false;}
}
const controls = () => h('div',{class:'fixture-controls'},[
  h('span','隔离示例 · 无真实邮箱操作'),
  h('button',{onClick:()=>{const config=defaultUiConfigV2();for(const tone of ['success','info','warning','error'] as const)config.notificationDisplay.types[tone]={mode:'timed',durationMs:1000};applySavedUiConfig(config);}},'通知显示1秒'),
  h('button',{onClick:runReadAcceptance},'连续读信验收'),
  h('button',{onClick:()=>{slowReadNext=true;}},'下次慢正文'),
  h('button',{onClick:()=>{failReadNext=true;}},'下次正文失败'),
  h('button',{onClick:()=>streams.forEach(s=>s.emit('expunge'))},'模拟列表回写'),
  h('button',{onClick:()=>document.querySelector('.mail-pane--list .mail-pane__body')?.scrollTo({top:1800,behavior:'smooth'})},'列表中部'),
  h('button',{onClick:()=>document.querySelector('.mail-pane--list .mail-pane__body')?.scrollTo({top:0,behavior:'smooth'})},'列表顶部'),
  h('button',{onClick:()=>{
    const body=document.querySelector('.mail-pane--list .mail-pane__body');
    document.querySelector('#fixture-row-evidence')!.textContent=JSON.stringify({uids:pages.INBOX.map(m=>m.uid),scrollTop:body?.scrollTop,filled:document.querySelector('.mail-pane--list')?.getAttribute('data-filled'),rows:Array.from(document.querySelectorAll<HTMLElement>('.mail-row')).map(row=>({uid:row.dataset.uid,state:row.dataset.rowReveal,classes:row.className,top:row.getBoundingClientRect().top,bottom:row.getBoundingClientRect().bottom,opacity:getComputedStyle(row).opacity,display:getComputedStyle(row).display,visibility:getComputedStyle(row).visibility,focused:row.contains(document.activeElement)})),observations:rowObservations});
  }},'记录列表诊断'),
  h('button',{onClick:()=>{notify('示例通知一：同步完成','success');notify('示例通知二：待核对','warning');notify('示例通知三：可以重试','error',{action:{label:'重试示例',run:()=>{notify('重试示例完成','success');}}});}},'通知堆叠'),
  h('button',{onClick:()=>{failNext=true;notify('下一次列表同步将模拟失败','warning');}},'模拟同步失败'),
  h('button',{onClick:()=>void confirmDialog({title:'确认示例',message:'这是隔离确认窗口，用于检查内边距和文字换行。'.repeat(5),requiredText:'测试'})},'确认示例'),
  h('button',{onClick:()=>{const prefs=currentMotionPreferences();applyMotionPreferences(prefs.motion==='reduce'?'system':'reduce',prefs.performance,false);}},'切换减少动画'),
  h('button',{onClick:()=>notify('这是一条较长的示例错误，文字在胶囊内部滚动，关闭按钮和点击轮换仍然可用。'.repeat(25),'error')},'长通知'),
  h('button',{onClick:()=>{const progress=beginProgressNotice('正在拉取邮件…');setTimeout(()=>progress.finish('示例刷新已完成'),1200);}},'刷新通知'),
  h('button',{onClick:()=>router.back()},'页面后退'),
  h('button',{onClick:()=>router.forward()},'页面前进'),
]);
const fixtureApp=createApp({render:()=>h('div',[controls(),h('output',{id:'fixture-row-evidence',hidden:true}),h('output',{id:'fixture-read-acceptance'}),h(App)])}).use(pinia).use(router).directive('motion',motionDirective).directive('press-feedback',pressFeedbackDirective).directive('capsule-notice',capsuleFeedbackDirective).directive('theme-control',themedControlDirective);
void router.replace('/mail').then(()=>{fixtureApp.mount('#app'); installNavigationContinuity(router, 'mail');});
const style=document.createElement('style');style.textContent='#fixture-read-acceptance{position:fixed;right:0;top:55px;z-index:50;max-width:300px;max-height:22px;overflow:hidden;font-size:10px;background:var(--fog-white)}.fixture-controls{position:fixed;top:6px;right:8px;max-width:min(450px,calc(50vw - 70px));z-index:50;display:flex;gap:8px;padding:4px;align-items:center;font-size:11px;background:var(--fog-white);overflow-x:auto;white-space:nowrap;scrollbar-width:none}.fixture-controls::-webkit-scrollbar{display:none}.fixture-controls button{flex-shrink:0}@media(max-width:560px){.fixture-controls>span{display:none}}';document.head.append(style);
