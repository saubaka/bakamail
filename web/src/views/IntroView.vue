<template>
  <div class="intro-page">
    <a class="skip-link" href="#main-content">跳到项目介绍</a>
    <header class="intro-header">
      <router-link class="intro-brand" to="/" :aria-label="`${siteInfo.siteName} 首页`"><BrandMark :subtitle="siteInfo.tagline" /></router-link>
      <nav class="intro-nav" aria-label="项目导航">
        <a href="#about">功能介绍</a><a href="#faq">常见问题</a>
      </nav>
    </header>

    <main id="main-content" class="intro-main" tabindex="-1">
      <p v-if="route.query.reason === 'session' && !signedIn" class="intro-session-note" role="status">你还没有登录，或者登录已经过期。请重新登录后继续使用。</p>
      <section class="intro-hero" aria-labelledby="intro-title">
        <div v-intro-reveal class="intro-hero-copy intro-reveal--split">
          <span class="intro-project-name intro-stagger" style="--i: 0">{{ siteInfo.siteName }}</span>
          <h1 id="intro-title" class="intro-stagger" style="--i: 1">高性能邮局方案！</h1>
          <p class="intro-lead intro-stagger" style="--i: 2">{{ siteInfo.siteName }}是 Maddy 的网页端，开浏览器就能收发邮件，不用装客户端。</p>
          <div class="intro-actions intro-stagger" style="--i: 3">
            <router-link class="intro-button" :to="entry">{{ signedIn ? '进入邮箱' : '登录邮箱' }}<span aria-hidden="true">↗</span></router-link>
            <router-link v-if="!signedIn" class="intro-text-link" to="/register">我有邀请码</router-link>
            <a v-else class="intro-text-link" href="#about">了解更多</a>
          </div>
          <p class="intro-entry-note intro-stagger" style="--i: 4">{{ signedIn ? '你已登录' : '需要邀请码才能注册，忘记密码可以提交重置申请' }}</p>
        </div>
        <div v-intro-reveal class="intro-window" aria-label="邮箱界面示例，不读取真实邮件">
          <div class="intro-window-bar"><span class="intro-window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>示例邮件</span><span class="intro-demo-tag">界面示例</span></div>
          <div class="intro-window-body">
            <div class="intro-demo-tabs" role="group" aria-label="切换示例">
              <button class="intro-demo-tab" type="button" :aria-pressed="demo === 'inbox'" @click="demo = 'inbox'">收件箱<span>1</span></button>
              <button class="intro-demo-tab" type="button" :aria-pressed="demo === 'draft'" @click="demo = 'draft'">草稿箱</button>
            </div>
            <div class="intro-letter-scene" :class="{ 'is-open': opened }">
              <svg class="intro-postal-path" viewBox="0 0 380 220" aria-hidden="true"><path d="M20 155C75 210 75 40 153 70S312 182 353 46" /><circle cx="353" cy="46" r="5" /></svg>
              <div class="intro-envelope" aria-hidden="true"><div class="intro-envelope-paper"><span>你好，</span><i></i><i></i><b>欢迎使用 {{ siteInfo.siteName }}。</b></div><div class="intro-envelope-pocket"></div><div class="intro-envelope-seal">{{ siteInitial }}</div></div>
            </div>
            <div class="intro-demo-copy" aria-live="polite">
              <span>{{ demo === 'inbox' ? `欢迎使用 ${siteInfo.siteName}` : '还没写完的邮件' }}</span>
              <p>{{ demo === 'inbox' ? '喵？' : '写到一半可以先存成草稿，下次打开接着写。' }}</p>
            </div>
            <button class="intro-open-letter" type="button" :aria-pressed="opened" @click="opened = !opened">{{ opened ? '收起邮件' : '展开邮件' }}<span aria-hidden="true">{{ opened ? '−' : '+' }}</span></button>
          </div>
          <span class="intro-postmark" aria-hidden="true">BAKA<br />POST</span>
        </div>
      </section>

      <section id="about" v-intro-reveal class="intro-about intro-reveal--split" aria-labelledby="about-title">
        <div class="intro-section-heading intro-stagger" style="--i: 0"><p class="intro-kicker">功能介绍</p><h2 id="about-title">一个简单直接的<br />网页邮箱。</h2></div>
        <div class="intro-about-detail"><p class="intro-body-copy intro-stagger" style="--i: 1">{{ siteInfo.siteName }}对接你自己部署的 Maddy 邮件服务。浏览器只和本站通信，不会直接连接邮件服务器。</p>
          <div class="intro-features">
            <article v-for="(feature, index) in features" :key="feature.title" class="intro-stagger" :style="{ '--i': index + 2 }"><svg viewBox="0 0 32 32" aria-hidden="true"><template v-if="index === 0"><rect x="4" y="7" width="24" height="18" rx="4" /><path d="m5 9 11 9L27 9" /></template><template v-else-if="index === 1"><path d="M16 3 27 8v8c0 7-11 13-11 13S5 23 5 16V8Z" /><path d="m11 16 4 4 7-8" /></template><template v-else><rect x="2" y="5" width="21" height="17" rx="3" /><rect x="20" y="13" width="10" height="16" rx="2" /><path d="M8 27h9M12 22v5" /></template></svg><h3>{{ feature.title }}</h3><p>{{ feature.text }}</p></article>
          </div>
        </div>
      </section>

      <section id="faq" v-intro-reveal class="intro-faq intro-reveal--split" aria-labelledby="faq-title"><div class="intro-stagger" style="--i: 0"><p class="intro-kicker">开始之前</p><h2 id="faq-title">常见问题</h2></div><div class="intro-faq-items">
        <details v-for="(item, index) in faq" :key="item.question" class="intro-faq-card intro-stagger" :style="{ '--i': index + 1 }"><summary class="intro-faq-trigger" @click.prevent="toggleFaq(($event.currentTarget as HTMLElement).parentElement as HTMLDetailsElement)"><span class="intro-faq-question">{{ item.question }}</span><span class="intro-faq-plus" aria-hidden="true">+</span></summary><div class="intro-faq-answer"><p>{{ item.answer }}<router-link v-if="'link' in item" :to="item.link.to">{{ item.link.label }}</router-link></p></div></details>
      </div></section>

      <section v-intro-reveal class="intro-closing intro-reveal--split" aria-labelledby="closing-title"><span class="intro-stagger" style="--i: 0" aria-hidden="true">✉</span><h2 id="closing-title" class="intro-stagger" style="--i: 1">已经有账号了？<br />直接登录。</h2><router-link class="intro-button intro-stagger" style="--i: 2" :to="entry">{{ signedIn ? '进入邮箱' : '登录邮箱' }}<span aria-hidden="true">↗</span></router-link></section>
    </main>
    <footer class="intro-footer"><div><strong>{{ siteInfo.siteName }}</strong><p>{{ siteInfo.tagline }}</p></div><div class="intro-footer-links"><router-link to="/">项目介绍</router-link><a :href="repositoryUrl" target="_blank" rel="noopener noreferrer">Github</a><router-link to="/password-reset">重置密码</router-link></div><p>© {{ year }} saubaka. BakaMail.<br /><span>邮件服务基于 Maddy，第三方项目版权归原作者所有。</span></p></footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import BrandMark from "../components/BrandMark.vue";
import { siteInfo } from "../siteInfo";
import { INTRO_FAQ, INTRO_FEATURES, SEO_REPOSITORY_URL } from "../../../shared/seo";
import { useSessionStore } from "../stores/session";
import { safeMailDestination } from "../auth/entryGate";
import { introRevealDirective as vIntroReveal } from "../intro/reveal";
import { toggleFaq } from "../intro/faq";

const route = useRoute();
const session = useSessionStore();
const signedIn = computed(() => session.ready && Boolean(session.mailbox));
const entry = computed(() => signedIn.value ? safeMailDestination(route.query.redirect) : { name: "login", query: { redirect: safeMailDestination(route.query.redirect) } });
const demo = ref("inbox");
const opened = ref(false);
const year = new Date().getFullYear();
const features = INTRO_FEATURES;
const faq = INTRO_FAQ;
// 开源仓库链接和版权标记写死在页脚里，站点名、副标题等任何设置都不会改动它们。
const repositoryUrl = SEO_REPOSITORY_URL;
const siteInitial = computed(() => [...siteInfo.siteName][0]?.toUpperCase() ?? "B");
</script>
