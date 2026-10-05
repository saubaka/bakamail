/** Real Vue directive/runtime and activation client. All data/config/tasks are disposable mocks. */
import { createApp, defineComponent, h, onBeforeUnmount, ref, withDirectives } from 'vue';
import { createRouter, createMemoryHistory, RouterView, RouterLink } from 'vue-router';
import { defaultUiConfigV2, copyUiConfigV2, isUiConfigV2, projectUiConfigV1 } from '../../../shared/notificationDisplay.ts';
import { capsuleFeedbackDirective } from '../../src/capsuleFeedback';
import { notify, disposeNotifications, type NoticeHandle } from '../../src/notifications';
import { initializeUiConfig, uiConfigClient, snapshotUiConfigV2, applySavedUiConfig } from '../../src/notificationConfig';
import { openDialog, closeDialog } from '../../src/dialog';
import '../../src/styles/vendor/project1-app.css';
import '../../src/styles/vendor/project1-small-window-theme.css';
import '../../src/styles/mail-overrides.css';
import '../../src/styles/mail-pages.css';
import '../../src/styles/notifications.css';
import '../../src/styles/dialogs.css';
import '../../src/styles/local-theme.css';
import '../../src/styles/dashed-accent.css';

// Label only disposable tabs, so a human can distinguish native activation targets.
const clientLabel=new URLSearchParams(location.search).get('client');
if(clientLabel==='A'||clientLabel==='B')document.title=`BakaMail 隔离配置 ${clientLabel}`;

let server = defaultUiConfigV2(), offline = false, legacy = false, reads = 0, writes = 0;
const channel = new BroadcastChannel('bakamail-disposable-phase5-config');
channel.onmessage = event => { if (event.data === 'request') channel.postMessage(server);
  else if (isUiConfigV2(event.data) && event.data.revision >= server.revision) server = copyUiConfigV2(event.data); };
channel.postMessage('request');
window.fetch = async input => {
  if (String(input) !== '/api/ui-config?schemaVersion=2') throw new Error('隔离验收禁止真实网络请求');
  reads++; if (offline) throw new Error('模拟公开配置断网');
  return Response.json({ ok: true, data: legacy ? projectUiConfigV1(server) : server });
};
window.XMLHttpRequest = class { open() { throw new Error('隔离验收禁止发送邮件'); } } as unknown as typeof XMLHttpRequest;
const handles: NoticeHandle[] = [], events: unknown[] = [];
const log = (event: string, extra:Record<string,unknown>={}) => { events.push({ at: Math.round(performance.now()), event,...extra }); if (events.length > 50) events.shift(); };
for (const name of ['focus','blur']) window.addEventListener(name,event=>log(name,{trusted:event.isTrusted,hasFocus:document.hasFocus(),hidden:document.hidden}));
document.addEventListener('visibilitychange',event=>log('visibilitychange',{trusted:event.isTrusted,hasFocus:document.hasFocus(),hidden:document.hidden}));
const publish = () => { server.revision++; for (const tone of ['success','info','warning','error'] as const) server.notificationDisplay.types[tone] = { mode:'timed', durationMs:1000 };
  server.notificationDisplay.types.loading = { mode:'timedHide', durationMs:1000 }; writes++; applySavedUiConfig(server); channel.postMessage(server); log('mock-save'); };
const Entry = defineComponent({ setup() {
  const hint = ref(''), tone = ref<'error'|'info'|'warning'>('error'), draft = ref('本地未保存草稿'), modal = ref<HTMLDialogElement>(), critical = ref(false);
  const scope = new AbortController();
  onBeforeUnmount(() => scope.abort());
  const button = (label: string, click: () => void) => h('button',{class:'button button--soft',type:'button',onClick:click},label);
  return () => h('section',{class:'card',style:'padding:24px;margin:24px 0'},[
    h('h2','表单、异步重试与 SPA'), h('form', { onSubmit:(e:Event)=>e.preventDefault() },[
      h('label',{class:'field'},[h('span',{class:'field__label'},'未保存草稿'),h('input',{value:draft.value,onInput:(e:Event)=>draft.value=(e.target as HTMLInputElement).value})]),
      h('div',{class:'button-row'},[
        button('普通错误',()=>{tone.value='error';hint.value='模拟字段/登录错误：请检查输入，通知结束后说明仍保留。';log('directive-error');}),
        button('日志提示',()=>{tone.value='info';hint.value='模拟日志状态：已采样，没有新的记录。';}),
        button('日志警告',()=>{tone.value='warning';hint.value='模拟日志状态：保留上次采样，当前连接待核对。';}),
        button('清空提示',()=>{hint.value='';}),
        button('异步重试',()=>{const handle=notify('可重试的普通错误','error',{signal:scope.signal,action:{label:'重试模拟',run:async()=>{
          await new Promise(resolve=>setTimeout(resolve,1200));log('mock-business-finished');throw new Error('模拟重试失败');}}});if(handle)handles.push(handle);}),
        button('打开发送未确认弹窗',()=>{critical.value=true;openDialog(modal.value);}),
      ]),
      hint.value ? withDirectives(h('p',{role:tone.value==='info'?'status':'alert',class:'field-error'},hint.value),[[capsuleFeedbackDirective,{tone:tone.value,signal:scope.signal}]]) : null,
    ]),
    h('dialog',{ref:modal,class:'modal',style:'max-width:480px;padding:24px',onCancel:(e:Event)=>{e.preventDefault();critical.value=false;closeDialog(modal.value);}},[
      h('h2','发送结果未确认（仅模拟）'),h('p','关闭胶囊不会解除发送锁；必须核对后人工确认。'),
      critical.value ? withDirectives(h('p',{role:'alert',class:'field-error'},'发送结果未确认。请先核对已发送或管理员记录，勿直接重发。'),[[capsuleFeedbackDirective,{manualReason:'delivery-unconfirmed',signal:scope.signal}]]) : null,
      h('button',{class:'button',disabled:true},'发送已锁定'),button('关闭模拟弹窗',()=>{critical.value=false;closeDialog(modal.value);}),
    ]),
  ]);
} });
const router = createRouter({history:createMemoryHistory(),routes:[{path:'/',component:Entry},{path:'/other',component:{render:()=>h('section',{class:'card',style:'padding:24px;margin:24px 0'},[h('h2','另一个 SPA 面板'),h('p','旧节点已卸载，不应残留或复活通知。')])}}]});
const Root = defineComponent({ setup() {
  const diagnostic = ref('');
  const sampler = setInterval(()=>{diagnostic.value=JSON.stringify({client:snapshotUiConfigV2(),serverRevision:server.revision,reads,writes,offline,legacy,
    handles:handles.map(handle=>handle.inspect()),events},null,2);},200);
  onBeforeUnmount(()=>clearInterval(sampler));
  return ()=>h('main',{id:'main-content',tabindex:-1,style:'max-width:880px;margin:96px auto 24px;padding:20px'},[
    h('h1',{style:'font-size:24px'},'BakaMail · 全入口隔离验收'),h('p','仅模拟数据。真实主题、指令与通知，不创建账号、不发送邮件。'),
    h('div',{class:'button-row'},[
      h('button',{class:'button',onClick:publish},'模拟保存所有类型1秒'),
      h('button',{class:'button',onClick:()=>{const handle=notify('配置快照提示','info');if(handle)handles.push(handle);}},'普通快照提示'),
      h('button',{class:'button',onClick:()=>{offline=!offline;}},'切换断网'),
      h('button',{class:'button',onClick:()=>{legacy=!legacy;}},'切换旧版本响应'),
      h('button',{class:'button',onClick:()=>void uiConfigClient.refresh(true)},'重新校验公开配置'),
      h('button',{class:'button',onClick:()=>window.dispatchEvent(new Event('focus'))},'模拟标签激活事件'),
      h('button',{class:'button',onClick:()=>disposeNotifications()},'关闭所有模拟通知'),
      h(RouterLink,{to:'/',class:'button'},()=> '表单面板'),h(RouterLink,{to:'/other',class:'button'},()=> '切换 SPA 面板'),
    ]),h(RouterView),h('details',[h('summary','配置与生命周期诊断'),h('pre',{id:'phase5-evidence',style:'white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px'},diagnostic.value)]),
  ]);
} });
await router.replace('/'); const disposeConfig = initializeUiConfig();
const app=createApp(Root).use(router);app.mount('#fixture-app');
window.addEventListener('pagehide',()=>{app.unmount();disposeConfig();disposeNotifications();channel.close();},{once:true});
