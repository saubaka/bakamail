<template>
  <div class="intro-page">
    <a class="skip-link" href="#main-content">跳到项目介绍</a>
    <header class="intro-header">
      <router-link class="intro-brand" to="/" aria-label="BakaMail 首页"><BrandMark subtitle="给来信留一扇小窗" /></router-link>
      <nav class="intro-nav" aria-label="项目导航">
        <a href="#about">认识邮局</a><a href="#developer">开发者</a><a href="#voices">用户评价</a>
      </nav>
    </header>

    <main id="main-content" class="intro-main" tabindex="-1">
      <p v-if="route.query.reason === 'session' && !signedIn" class="intro-session-note" role="status">还没有登录，或登录已过期。重新登录后，就能继续使用邮箱。</p>
      <section class="intro-hero" aria-labelledby="intro-title">
        <div v-intro-reveal class="intro-hero-copy">
          <span class="intro-project-name">BakaMail</span>
          <h1 id="intro-title">自己的邮局，<br />轻一点。</h1>
          <p class="intro-lead">一扇安静的小窗口，装下你的来信、想法和日常。<br class="intro-desktop-break" />收发、整理、寻找，让邮件回到简单的样子。</p>
          <div class="intro-actions">
            <router-link class="intro-button" :to="entry">{{ signedIn ? '打开我的邮箱' : '登录我的邮箱' }}<span aria-hidden="true">↗</span></router-link>
            <router-link v-if="!signedIn" class="intro-text-link" to="/register">我有邀请码</router-link>
            <a v-else class="intro-text-link" href="#about">再了解一点</a>
          </div>
          <p class="intro-entry-note">{{ signedIn ? '登录状态已由服务器确认' : '邀请制开通 · 支持申请重置密码' }}</p>
        </div>
        <div v-intro-reveal class="intro-window" aria-label="邮箱交互示意，不读取真实邮件">
          <div class="intro-window-bar"><span class="intro-window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>一封给今天的信</span><span class="intro-demo-tag">交互示意</span></div>
          <div class="intro-window-body">
            <div class="intro-demo-tabs" role="group" aria-label="切换邮箱示意">
              <button class="intro-demo-tab" type="button" :aria-pressed="demo === 'inbox'" @click="demo = 'inbox'">收件箱<span>1</span></button>
              <button class="intro-demo-tab" type="button" :aria-pressed="demo === 'draft'" @click="demo = 'draft'">草稿箱</button>
            </div>
            <div class="intro-letter-scene" :class="{ 'is-open': opened }">
              <svg class="intro-postal-path" viewBox="0 0 380 220" aria-hidden="true"><path d="M20 155C75 210 75 40 153 70S312 182 353 46" /><circle cx="353" cy="46" r="5" /></svg>
              <div class="intro-envelope" aria-hidden="true"><div class="intro-envelope-paper"><span>Dear you,</span><i></i><i></i><b>愿今天，有好消息。</b></div><div class="intro-envelope-pocket"></div><div class="intro-envelope-seal">B</div></div>
            </div>
            <div class="intro-demo-copy" aria-live="polite">
              <span>{{ demo === 'inbox' ? '来自 BakaMail 的第一封信' : '留给明天的一个想法' }}</span>
              <p>{{ demo === 'inbox' ? '不急，慢慢读。重要的来信，值得一个安静的位置。' : '还没写完也没关系。存成草稿，灵感回来时继续。' }}</p>
            </div>
            <button class="intro-open-letter" type="button" :aria-pressed="opened" @click="opened = !opened">{{ opened ? '收好这封信' : '打开这封信' }}<span aria-hidden="true">{{ opened ? '−' : '+' }}</span></button>
          </div>
          <span class="intro-postmark" aria-hidden="true">BAKA<br />POST</span>
        </div>
      </section>

      <section id="about" v-intro-reveal class="intro-about" aria-labelledby="about-title">
        <div class="intro-section-heading"><p class="intro-kicker">认识 BakaMail</p><h2 id="about-title">少一点打扰，<br />多一点自己的空间。</h2></div>
        <div class="intro-about-detail"><p class="intro-body-copy">BakaMail 是为自建邮局打造的网页邮箱。把真实的邮件服务，放进一个轻盈、清楚、顺手的界面里。无需安装客户端，打开浏览器就能开始。</p>
          <div class="intro-features">
            <article><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="7" width="24" height="18" rx="4" /><path d="m5 9 11 9L27 9" /></svg><h3>来信，各就各位</h3><p>文件夹、搜索、联系人和草稿，收发之外，整理也轻松。</p></article>
            <article><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 27 8v8c0 7-11 13-11 13S5 23 5 16V8Z" /><path d="m11 16 4 4 7-8" /></svg><h3>入口，认真守护</h3><p>邀请制开通，登录验证与重试限制，后台管理各有边界。</p></article>
            <article><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="5" width="21" height="17" rx="3" /><rect x="20" y="13" width="10" height="16" rx="2" /><path d="M8 27h9M12 22v5" /></svg><h3>小屏，也很从容</h3><p>从桌面到手机，熟悉的小窗口，保留一样清晰的阅读体验。</p></article>
          </div>
        </div>
      </section>

      <section id="developer" v-intro-reveal class="intro-developer" aria-labelledby="developer-title">
        <div class="intro-developer-monogram" aria-hidden="true">S<span>✳</span></div>
        <div><p class="intro-kicker">项目开发者</p><h2 id="developer-title">由 saubaka 打造</h2><p>喜欢轻盈的界面，也在意每一次真实的使用。<br />让自建服务不只能够运行，也能被舒服地使用。</p></div>
        <div class="intro-developer-note"><span>写给使用者</span><p>“把复杂留在幕后，<br />把简单留给你。”</p><span>— saubaka</span></div>
      </section>

      <section id="voices" v-intro-reveal class="intro-voices" aria-labelledby="voices-title">
        <div class="intro-voices-heading"><div><p class="intro-kicker">用户评价</p><h2 id="voices-title">听听来信之外的声音。</h2></div><p>以下为版式示例，非真实用户评价。<br />真实反馈收集后再替换。</p></div>
        <div class="intro-quotes">
          <figure v-for="voice in voices" :key="voice.name"><blockquote>{{ voice.quote }}</blockquote><figcaption><span class="intro-quote-avatar" aria-hidden="true">{{ voice.icon }}</span><span>{{ voice.name }}<small>示例评价 · {{ voice.role }}</small></span></figcaption></figure>
        </div>
      </section>

      <section v-intro-reveal class="intro-faq" aria-labelledby="faq-title"><div><p class="intro-kicker">开始之前</p><h2 id="faq-title">几个小问题。</h2></div><div class="intro-faq-items">
        <details class="intro-faq-card"><summary class="intro-faq-trigger"><span class="intro-faq-question">怎么开通自己的邮箱？</span><span class="intro-faq-plus" aria-hidden="true">+</span></summary><p>本站采用邀请制。收到管理员提供的邀请码后，前往开通页面，使用账号名与密码注册。没有邀请码时，请先联系邀请你的管理员。</p></details>
        <details class="intro-faq-card"><summary class="intro-faq-trigger"><span class="intro-faq-question">忘记密码了怎么办？</span><span class="intro-faq-plus" aria-hidden="true">+</span></summary><p>可以在登录页申请重置密码。申请由管理员核对和处理，不会通过未经验证的网页操作直接改动你的密码。<router-link to="/password-reset">申请重置密码</router-link></p></details>
        <details class="intro-faq-card"><summary class="intro-faq-trigger"><span class="intro-faq-question">这个演示窗口会读取我的邮件吗？</span><span class="intro-faq-plus" aria-hidden="true">+</span></summary><p>不会。介绍页的信封与邮件内容只是本地界面示意。登录邮箱后才会通过本站后端访问你的真实邮件，浏览器不直接连接邮局核心。</p></details>
      </div></section>

      <section v-intro-reveal class="intro-closing" aria-labelledby="closing-title"><span aria-hidden="true">✉</span><h2 id="closing-title">下一封好消息，<br />在自己的小窗里相见。</h2><router-link class="intro-button" :to="entry">{{ signedIn ? '进入邮箱' : '去登录邮箱' }}<span aria-hidden="true">↗</span></router-link></section>
    </main>
    <footer class="intro-footer"><div><strong>BakaMail</strong><p>给来信留一扇小窗。</p></div><div class="intro-footer-links"><router-link to="/">项目介绍</router-link><router-link to="/password-reset">重置密码</router-link></div><p>© {{ year }} saubaka. BakaMail.<br /><span>邮件服务基于 Maddy · 第三方项目版权归原作者所有</span></p></footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import BrandMark from "../components/BrandMark.vue";
import { useSessionStore } from "../stores/session";
import { safeMailDestination } from "../auth/entryGate";
import { introRevealDirective as vIntroReveal } from "../intro/reveal";

const route = useRoute();
const session = useSessionStore();
const signedIn = computed(() => session.ready && Boolean(session.mailbox));
const entry = computed(() => signedIn.value ? safeMailDestination(route.query.redirect) : { name: "login", query: { redirect: safeMailDestination(route.query.redirect) } });
const demo = ref("inbox");
const opened = ref(false);
const year = new Date().getFullYear();
const voices = [
  { name: "日常收信者", role: "简洁体验", icon: "来", quote: "希望打开邮箱时，先看到信，而不是一堆不需要的东西。" },
  { name: "灵感记录者", role: "草稿体验", icon: "写", quote: "把还没写完的想法留在草稿里，下次回来，接着写。" },
  { name: "自建爱好者", role: "管理体验", icon: "管", quote: "自己的邮局，也值得一个清楚、顺手的管理入口。" },
];
</script>
