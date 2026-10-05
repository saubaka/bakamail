// Standalone Vite-only fixture. No mailbox API requests, writes, or real message data.
import { createApp, ref } from 'vue/dist/vue.esm-bundler.js';
import Reader from '../../src/components/mail/MessageReaderPane.vue';
import { pressFeedbackDirective } from '../../src/pressFeedback';
import '../../src/styles/vendor/project1-app.css';
import '../../src/styles/vendor/project1-small-window-theme.css';
import '../../src/styles/mail-overrides.css';
import '../../src/styles/mail-pages.css';
import '../../src/styles/workspace.css';
import '../../src/styles/reader.css';
import '../../src/styles/local-theme.css';
// Even a mistaken download click in this fixture must not reach a real mailbox UID.
document.getElementById('reader-fixture')!.addEventListener('click', event => {
  if ((event.target as Element)?.closest('a[href^="/api/"]')) event.preventDefault();
}, true);
const html = `<h3>给阅读留一点空间</h3><p>你好，</p><p>这是一封仅用于本地界面验收的示例邮件，不连接真实邮箱，也不会发送任何邮件。</p><p>重要的信息放在前面；其余操作在需要时展开。希望新的阅读界面让你更专注于内容。</p><img src="http://127.0.0.1:5190/test/fixtures/reader-media.svg" alt="示例淡蓝色媒体" width="480" height="100"><p>祝你今天顺利。<br>示例团队</p>`;
const original = { uid:1,subject:'让每一封邮件，都更好读一点',from:[{name:'示例团队',address:'hello@example.test'}],to:[{name:'阅读者',address:'reader@example.test'}],date:'2026-09-27T03:20:00Z',size:4096,seen:true,flagged:false,answered:false,hasAttachments:false,cc:[],replyTo:[],references:[],text:'你好，\n这是一封本地排版示例邮件。\n\n邮件正文应该充分利用阅读区域，并保留适当的呼吸感。\n\n示例团队',html,attachments:[],headers:{'authentication-results':'mx.example.test; spf=pass; dkim=pass; dmarc=pass'} };
createApp({ components:{Reader}, setup(){ const detail=ref(original), policy=ref('ask');return { detail,policy, reset(){detail.value={...original,uid:detail.value.uid+1}}, plain(){detail.value={...original,uid:detail.value.uid+1,html:null}}, long(){detail.value={...original,uid:detail.value.uid+1,html:`<h3>长邮件排版示例</h3>${'<p>示例段落：更长的正文应在阅读区域内部滚动，底部保留适当留白，不遮挡导航。</p>'.repeat(30)}`}}, missing(){detail.value={...original,uid:detail.value.uid+1,headers:{}}} }; },
  template:`<div class="fixture-controls" style="position:fixed;top:0;left:0;right:0;z-index:100;background:var(--fog-white);display:flex;gap:8px;padding:6px 12px;font-size:11px;flex-wrap:wrap"><span>本地示例 · 无邮箱请求</span><button @click="reset">重置示例</button><button @click="plain">纯文本</button><button @click="long">长正文</button><button @click="missing">缺少认证</button><button @click="policy = policy === 'block' ? 'ask' : 'block'">{{policy === 'block' ? '恢复询问' : '严格拦截'}}</button></div><div class="mail-workspace"><main class="workspace-content"><div class="mail-view-canvas"><div class="mail-shell is-reading" style="padding-top:54px"><section class="mail-pane mail-pane--list"><div class="mail-pane__head">示例收件箱</div><div class="mail-empty">仅用于组件排版验收</div></section><Reader :detail="detail" :loading="false" :action-busy="false" current-folder="INBOX" :remote-images="policy" /></div></div></main><div class="mail-bottom-dock"><button class="dock-item">菜单</button><button class="dock-item">列表</button><button class="dock-item is-current">正文</button></div></div>`
}).directive('press-feedback',pressFeedbackDirective).mount('#reader-fixture');
