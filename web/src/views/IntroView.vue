<template>
  <div class="intro-page">
    <a class="skip-link" href="#main-content">跳到项目介绍</a>
    <header class="intro-header">
      <router-link class="intro-brand" to="/" aria-label="BakaMail 首页"><BrandMark subtitle="自建邮局的网页端" /></router-link>
      <nav class="intro-nav" aria-label="项目导航">
        <a href="#about">功能介绍</a><a href="#developer">开发者</a><a href="#faq">常见问题</a>
      </nav>
    </header>

    <main id="main-content" class="intro-main" tabindex="-1">
      <p v-if="route.query.reason === 'session' && !signedIn" class="intro-session-note" role="status">你还没有登录，或者登录已经过期。请重新登录后继续使用。</p>
      <section class="intro-hero" aria-labelledby="intro-title">
        <div v-intro-reveal class="intro-hero-copy">
          <span class="intro-project-name">BakaMail</span>
          <h1 id="intro-title">自己的邮局，<br />网页上就能用。</h1>
          <p class="intro-lead">BakaMail 是给自建邮局用的网页邮箱。<br class="intro-desktop-break" />打开浏览器就能收发邮件、整理文件夹、搜索旧邮件，不用安装客户端。</p>
          <div class="intro-actions">
            <router-link class="intro-button" :to="entry">{{ signedIn ? '进入邮箱' : '登录邮箱' }}<span aria-hidden="true">↗</span></router-link>
            <router-link v-if="!signedIn" class="intro-text-link" to="/register">我有邀请码</router-link>
            <a v-else class="intro-text-link" href="#about">了解更多</a>
          </div>
          <p class="intro-entry-note">{{ signedIn ? '你已登录' : '需要邀请码才能注册，忘记密码可以提交重置申请' }}</p>
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
              <div class="intro-envelope" aria-hidden="true"><div class="intro-envelope-paper"><span>你好，</span><i></i><i></i><b>欢迎使用 BakaMail。</b></div><div class="intro-envelope-pocket"></div><div class="intro-envelope-seal">B</div></div>
            </div>
            <div class="intro-demo-copy" aria-live="polite">
              <span>{{ demo === 'inbox' ? '欢迎使用 BakaMail' : '还没写完的邮件' }}</span>
              <p>{{ demo === 'inbox' ? '这是一封示例邮件，只用来演示界面。登录之前，这里不会读取任何真实邮件。' : '写到一半可以先存成草稿，下次打开接着写。' }}</p>
            </div>
            <button class="intro-open-letter" type="button" :aria-pressed="opened" @click="opened = !opened">{{ opened ? '收起邮件' : '展开邮件' }}<span aria-hidden="true">{{ opened ? '−' : '+' }}</span></button>
          </div>
          <span class="intro-postmark" aria-hidden="true">BAKA<br />POST</span>
        </div>
      </section>

      <section id="about" v-intro-reveal class="intro-about" aria-labelledby="about-title">
        <div class="intro-section-heading"><p class="intro-kicker">功能介绍</p><h2 id="about-title">一个简单直接的<br />网页邮箱。</h2></div>
        <div class="intro-about-detail"><p class="intro-body-copy">BakaMail 对接你自己部署的 Maddy 邮件服务。浏览器只和本站通信，不会直接连接邮件服务器。</p>
          <div class="intro-features">
            <article><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="7" width="24" height="18" rx="4" /><path d="m5 9 11 9L27 9" /></svg><h3>收发和整理</h3><p>可以收发邮件、管理文件夹，也支持搜索、联系人和草稿。</p></article>
            <article><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 27 8v8c0 7-11 13-11 13S5 23 5 16V8Z" /><path d="m11 16 4 4 7-8" /></svg><h3>注册和登录有限制</h3><p>新用户需要邀请码。登录要填验证码，连续输错会被暂时限制，管理后台和普通登录分开。</p></article>
            <article><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="5" width="21" height="17" rx="3" /><rect x="20" y="13" width="10" height="16" rx="2" /><path d="M8 27h9M12 22v5" /></svg><h3>手机上也能用</h3><p>页面会按屏幕宽度调整，在手机和电脑上都能正常阅读、回复邮件。</p></article>
          </div>
        </div>
      </section>

      <section id="developer" v-intro-reveal class="intro-developer" aria-labelledby="developer-title">
        <div class="intro-developer-monogram" aria-hidden="true">S<span>✳</span></div>
        <div><p class="intro-kicker">开发者</p><h2 id="developer-title">saubaka</h2><p>BakaMail 是我自己开发和维护的项目。自建邮局能正常收发之后，我想让它用起来也顺手，就做了这个网页端。</p></div>
        <div class="intro-developer-note"><span>使用说明</span><p>需要邀请码，或者遇到问题，请联系本站管理员。</p></div>
      </section>

      <section id="faq" v-intro-reveal class="intro-faq" aria-labelledby="faq-title"><div><p class="intro-kicker">开始之前</p><h2 id="faq-title">常见问题</h2></div><div class="intro-faq-items">
        <details class="intro-faq-card"><summary class="intro-faq-trigger"><span class="intro-faq-question">怎么开通邮箱？</span><span class="intro-faq-plus" aria-hidden="true">+</span></summary><p>本站需要邀请码才能注册。拿到管理员给你的邀请码后，到注册页填写账号名和密码就可以了。没有邀请码的话，请先联系管理员。</p></details>
        <details class="intro-faq-card"><summary class="intro-faq-trigger"><span class="intro-faq-question">忘记密码怎么办？</span><span class="intro-faq-plus" aria-hidden="true">+</span></summary><p>在登录页提交重置申请，管理员核对后会帮你处理。网页上不能直接修改密码。<router-link to="/password-reset">申请重置密码</router-link></p></details>
        <details class="intro-faq-card"><summary class="intro-faq-trigger"><span class="intro-faq-question">页面上的示例窗口会读取我的邮件吗？</span><span class="intro-faq-plus" aria-hidden="true">+</span></summary><p>不会。介绍页里的信封和邮件都只是页面上的示例。登录以后，才会通过本站服务读取你的真实邮件，浏览器不会直接连接邮件服务器。</p></details>
      </div></section>

      <section v-intro-reveal class="intro-closing" aria-labelledby="closing-title"><span aria-hidden="true">✉</span><h2 id="closing-title">已经有账号了？<br />直接登录。</h2><router-link class="intro-button" :to="entry">{{ signedIn ? '进入邮箱' : '登录邮箱' }}<span aria-hidden="true">↗</span></router-link></section>
    </main>
    <footer class="intro-footer"><div><strong>BakaMail</strong><p>自建邮局的网页端。</p></div><div class="intro-footer-links"><router-link to="/">项目介绍</router-link><router-link to="/password-reset">重置密码</router-link></div><p>© {{ year }} saubaka. BakaMail.<br /><span>邮件服务基于 Maddy，第三方项目版权归原作者所有。</span></p></footer>
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
</script>
