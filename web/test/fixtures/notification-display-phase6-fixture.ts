/** Browser-only joint acceptance: real timers/animations, no network, no mailbox writes. */
import { defaultUiConfigV2, type UiConfigV2 } from '../../../shared/notificationDisplay.ts';
import { notify, beginProgressNotice, disposeNotifications, type NoticeDisplayState, type NoticeHandle, type NotificationTone } from '../../src/notifications.ts';
import { openDialog, closeDialog } from '../../src/dialog.ts';
import '../../src/styles/vendor/project1-app.css';
import '../../src/styles/vendor/project1-small-window-theme.css';
import '../../src/styles/mail-overrides.css';
import '../../src/styles/mail-pages.css';
import '../../src/styles/admin.css';
import '../../src/styles/motion.css';
import '../../src/styles/notifications.css';
import '../../src/styles/dialogs.css';
import '../../src/styles/local-theme.css';
import '../../src/styles/dashed-accent.css';

window.fetch = async () => { throw new Error('隔离验收禁止网络请求'); };
window.XMLHttpRequest = class { open() { throw new Error('隔离验收禁止邮件请求'); } } as unknown as typeof XMLHttpRequest;
const controls = document.getElementById('fixture-controls')!, status = document.getElementById('fixture-status')!;
const results = document.getElementById('phase6-results')!, eventOutput = document.getElementById('phase6-events')!;
type Measurement = { label:string; created:number; readable?:number; exit?:number; removed?:number; foregroundMs:number;
  expectedMs:number|null; checkpoints:{at:number;state:NoticeDisplayState}[]; geometry?:unknown; passed?:boolean };
const measurements:Measurement[] = [], events:unknown[] = [];
const watched:{handle:Pick<NoticeHandle,'inspect'>;record:Measurement;last:string;at:number;state:NoticeDisplayState}[] = [];
let scope = new AbortController(), running = false, sequence = 0;
const now = () => Math.round(performance.now());
function log(event:string, extra:Record<string,unknown>={}) { events.push({at:now(),event,...extra}); if(events.length>450)events.shift(); eventOutput.textContent=JSON.stringify(events); }
function config(motion:'zero'|'default'|'maximum'='default', dwell=1000) {
  const value=defaultUiConfigV2(); value.revision=60;
  for(const type of ['success','info','warning','error'] as const)value.notificationDisplay.types[type]={mode:'timed',durationMs:dwell};
  value.notificationDisplay.types.loading={mode:'timedHide',durationMs:dwell};
  if(motion!=='default') {
    for(const type of ['success','info','warning','error','loading'] as const)value.notificationMotion.types[type]={enterMs:motion==='zero'?0:3000,exitMs:motion==='zero'?0:3000,textOutMs:motion==='zero'?0:1000,textInMs:motion==='zero'?0:1000};
    value.notificationMotion.stackMs=motion==='zero'?0:1500;
  }
  return value;
}
function track<T extends Pick<NoticeHandle,'inspect'>>(label:string,handle:T|undefined,expectedMs:number|null):T {
  if(!handle)throw new Error('没有生成通知');
  const at=now(), state=handle.inspect(), record:Measurement={label,created:at,foregroundMs:0,expectedMs,checkpoints:[]};
  measurements.push(record);watched.push({handle,record,last:'',at,state});return handle;
}
function geometry() {
  const node=document.querySelector<HTMLElement>('.notification-stack-card:not(.is-background) .notification-capsule');if(!node)return;
  const box=node.getBoundingClientRect(),css=getComputedStyle(node),text=node.querySelector('.notification-capsule__text');
  return {viewport:[innerWidth,innerHeight],scrollWidth:document.documentElement.scrollWidth,rect:{x:box.x,y:box.y,width:box.width,height:box.height,right:box.right},
    radii:[css.borderTopLeftRadius,css.borderTopRightRadius,css.borderBottomRightRadius,css.borderBottomLeftRadius],
    borders:[css.borderTopStyle,css.borderRightStyle,css.borderBottomStyle,css.borderLeftStyle],textOpacity:text?getComputedStyle(text).opacity:null};
}
const sampling=setInterval(()=>{
  const at=now();
  for(const item of watched){
    const state=item.handle.inspect();
    if(['capsule','complete'].includes(item.state.phase)&&item.state.pauseReasons.length===0)item.record.foregroundMs+=at-item.at;
    const key=JSON.stringify([state.type,state.phase,state.pauseReasons]);
    if(key!==item.last){item.last=key;item.record.checkpoints.push({at,state});
      // A background card is settled early; it is not yet a readable foreground sample.
      if(['capsule','complete'].includes(state.phase)&&!state.pauseReasons.some(reason=>reason==='background'||reason==='stack')&&!item.record.readable){item.record.readable=at;item.record.geometry=geometry();}
      if(state.phase==='exit'&&!item.record.exit)item.record.exit=at;
      if(state.phase==='disposed'&&!item.record.removed){item.record.removed=at;const expected=item.record.expectedMs;
        item.record.passed=expected===null||Math.abs(item.record.foregroundMs-expected)<=160;}
    }
    item.at=at;item.state=state;
  }
  results.textContent=JSON.stringify({running,viewport:[innerWidth,innerHeight],hasFocus:document.hasFocus(),hidden:document.hidden,
    cards:document.querySelectorAll('.notification-stack-card').length,measurements},null,2);
},20);
function waitFor(predicate:()=>boolean,timeout=35000):Promise<void>{
  const signal=scope.signal;
  return new Promise((resolve,reject)=>{let token:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{if(token!==undefined)clearTimeout(token);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new Error('验收已清理'));};
    if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});
    const start=performance.now();const poll=()=>{
      if(predicate()){cleanup();return resolve();}if(performance.now()-start>timeout){cleanup();return reject(new Error('测量等待超时；检查页面焦点/悬停'));}
      token=setTimeout(poll,20);};poll();});
}
function delay(ms:number):Promise<void>{
  const signal=scope.signal;
  return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(token);reject(new Error('验收已清理'));};
    const token=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});});
}
async function single(label:string,tone:NotificationTone,value:UiConfigV2,expected:number|null){
  const handle=track(label,notify(`${label} · 真实阅读计时`,'info'===tone?'info':tone,{previewConfig:value,signal:scope.signal}),expected);
  if(expected===null){await waitFor(()=>handle.inspect().phase==='capsule');await delay(2200);log('manual-still-visible',{label,state:handle.inspect()});handle.dismiss();}
  await waitFor(()=>handle.inspect().phase==='disposed',expected===120000?150000:35000);
}
async function suite(){
  if(running)return;running=true;status.textContent='短时矩阵运行中：不要让鼠标/键盘焦点停在通知上。';
  try{
    for(const motion of ['zero','default','maximum'] as const)for(const tone of ['success','info','warning','error'] as const)
      await single(`${motion}-${tone}-1s`,tone,config(motion),1000);
    for(const tone of ['success','info','warning'] as const){const value=defaultUiConfigV2(),policy=value.notificationDisplay.types[tone];await single(`default-${tone}-dwell`,tone,value,policy.mode==='timed'?policy.durationMs:null);}
    const manual=defaultUiConfigV2();await single('default-manual-error','error',manual,null);
    for(const tone of ['success','error'] as const){
      const progress=track(`timed-hide-${tone}`,beginProgressNotice(`慢任务：收起后${tone}`,{previewConfig:config(),signal:scope.signal}),null) as ReturnType<typeof beginProgressNotice>;
      await waitFor(()=>progress.inspect().phase==='hidden');log('waiting-hidden-business-pending',{tone,state:progress.inspect()});
      progress.update('收起后更新不会复活等待');await delay(300);log('hidden-update',{state:progress.inspect()});progress.finish(`慢任务${tone}结果`,tone);
      await waitFor(()=>progress.inspect().phase==='disposed');
    }
    const progress=track('continuous-updates',beginProgressNotice('连续更新0',{previewConfig:config(),signal:scope.signal}),null) as ReturnType<typeof beginProgressNotice>;
    await waitFor(()=>progress.inspect().phase==='capsule');
    for(let index=1;index<=3;index++){await delay(180);progress.update(`连续更新${index}`);await waitFor(()=>progress.inspect().phase==='capsule');log('update-remainder',{index,state:progress.inspect()});}
    await waitFor(()=>progress.inspect().phase==='hidden');progress.finish('连续更新只初始化一次结果时钟');await waitFor(()=>progress.inspect().phase==='disposed');
    status.textContent='短时矩阵完成';log('suite-complete');
  }catch(error){status.textContent=String(error);log('suite-failed',{error:String(error)});}finally{running=false;}
}
function button(label:string,run:()=>void){const node=document.createElement('button');node.className='btn btn-secondary';node.type='button';node.textContent=label;node.addEventListener('click',run);controls.append(node);}
button('开始短时矩阵',()=>void suite());
button('实际120秒验收',()=>{if(running)return;running=true;status.textContent='120秒实际浏览器计时中';void single('real-120s','info',config('zero',120000),120000).then(()=>{status.textContent='120秒完成';log('120s-complete');}).catch(error=>log('120s-failed',{error:String(error)})).finally(()=>running=false);});
button('三条堆叠与轮换',()=>{const value=config('default',8000);for(const tone of ['success','info','warning'] as const)track(`stack-${tone}-${++sequence}`,notify(`堆叠${tone} · 背景不扣时间`,tone,{previewConfig:value,signal:scope.signal}),null);});
button('等待任务手动收起',()=>{const value=config();value.notificationDisplay.types.loading={mode:'untilSettled'};const p=track('manual-waiting',beginProgressNotice('手动收起等待不取消任务',{previewConfig:value,signal:scope.signal}),null) as ReturnType<typeof beginProgressNotice>;
  void waitFor(()=>p.inspect().phase==='hidden').then(()=>{log('manual-hide-business-pending');p.update('不复活等待');p.finish('手动收起后的成功结果');}).catch(error=>log('waiting-test-canceled',{error:String(error)}));});
button('最长动画连续更新',()=>{
  const value=config('maximum');value.notificationDisplay.types.loading={mode:'untilSettled'};
  const p=track('maximum-text-progress',beginProgressNotice('最长入场及文字动画',{previewConfig:value,signal:scope.signal}),null);
  void waitFor(()=>p.inspect().phase==='capsule').then(async()=>{p.update('最长文字切换仍暂停阅读');await waitFor(()=>p.inspect().phase==='capsule');
    p.finish('最长文字动画后的错误结果','error');await waitFor(()=>p.inspect().phase==='disposed');log('maximum-progress-complete');}).catch(error=>log('maximum-progress-canceled',{error:String(error)}));
});
button('长文字手动提示',()=>{const value=config();value.notificationDisplay.types.info={mode:'manual'};track('long-manual',notify('这是仅用于隔离验收的长文字，完整边框与换行不会被计时影响。'.repeat(6),'info',{previewConfig:value,signal:scope.signal}),null);});
button('异步重试',()=>track('action',notify('重试执行时暂停阅读时间','error',{previewConfig:config('default',2000),signal:scope.signal,action:{label:'模拟重试',run:async()=>{await delay(2500);log('mock-action-finished');throw new Error('普通重试失败，继承错误显示设置');}}}),null));
const dialog=document.createElement('dialog');dialog.className='modal';dialog.style.cssText='max-width:480px;padding:24px';
dialog.innerHTML='<h2>隔离确认弹窗</h2><p>原安全确认保持独立。通知处于弹窗portal内。</p><label>确认文字<input aria-label="模拟确认文字" /></label>';
const dialogClose=document.createElement('button');dialogClose.className='btn btn-secondary';dialogClose.textContent='关闭隔离弹窗';dialogClose.addEventListener('click',()=>closeDialog(dialog));dialog.append(dialogClose);document.body.append(dialog);
button('弹窗内提示',()=>{openDialog(dialog);const value=config();value.notificationDisplay.types.warning={mode:'manual'};track('modal',notify('弹窗内手动警告 · 键盘关闭及焦点回落','warning',{previewConfig:value,signal:scope.signal}),null);});
button('切换减少动画',()=>{document.documentElement.dataset.motion=document.documentElement.dataset.motion==='reduce'?'system':'reduce';});
function clear(){scope.abort();disposeNotifications();scope=new AbortController();closeDialog(dialog);running=false;log('scope-unmounted',{cards:document.querySelectorAll('.notification-stack-card').length});}
button('模拟卸载并清理',clear);
for(const name of ['animationstart','animationend','transitionend'])document.addEventListener(name,event=>{if((event.target as Element).closest('.notification-stack-card'))log(name,{name:(event as AnimationEvent).animationName??(event as TransitionEvent).propertyName});});
for(const name of ['focus','blur'])window.addEventListener(name,event=>log(name,{trusted:event.isTrusted,hasFocus:document.hasFocus(),hidden:document.hidden}));
document.addEventListener('visibilitychange',event=>log('visibilitychange',{trusted:event.isTrusted,hasFocus:document.hasFocus(),hidden:document.hidden}));
window.addEventListener('pagehide',()=>{clearInterval(sampling);clear();},{once:true});
