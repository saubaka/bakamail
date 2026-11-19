<template>
  <div ref="root" class="intro-demo" :data-tab="state.tab" :class="{ 'is-still': state.still }"
    @pointerenter="hover(true)" @pointerleave="hover(false)" @focusin="syncFocus" @focusout="focusOut">
    <div class="intro-window-bar">
      <span class="intro-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>示例邮件</span>
      <span class="intro-demo-tag">界面示例</span>
    </div>
    <div class="intro-window-body">
      <div class="intro-demo-tabs" role="group" aria-label="切换示例">
        <span class="intro-demo-thumb" aria-hidden="true"></span>
        <button class="intro-demo-tab" type="button" :aria-pressed="state.tab === 'inbox'" @click="demo.chooseTab('inbox')">
          收件箱<Transition name="intro-badge"><span v-if="unread" class="intro-demo-badge">{{ unread }}</span></Transition>
        </button>
        <button class="intro-demo-tab" type="button" :aria-pressed="state.tab === 'draft'" @click="demo.chooseTab('draft')">草稿箱</button>
      </div>
      <div class="intro-demo-stage">
        <section class="intro-demo-panel" :class="{ 'is-active': state.tab === 'inbox' }" :inert="state.tab !== 'inbox'" aria-label="收件箱示例">
          <TransitionGroup tag="ul" name="intro-mail" class="intro-demo-list">
            <li v-for="row in state.rows" :key="row.mail.id" class="intro-demo-item">
              <button class="intro-demo-row" type="button" :aria-pressed="state.selected === row.mail.id"
                :class="{ 'is-unread': row.unread, 'is-fresh': row.fresh }" @click="demo.chooseMail(row.mail.id)">
                <span class="intro-demo-avatar" :data-tone="row.mail.tone" aria-hidden="true">{{ initial(row.mail.sender) }}</span>
                <span class="intro-demo-row-main">
                  <span class="intro-demo-row-top"><span class="intro-demo-sender">{{ row.mail.sender }}</span><span class="intro-demo-time">{{ row.time }}</span></span>
                  <span class="intro-demo-subject">{{ row.mail.subject }}</span>
                </span>
                <span class="intro-demo-unread" aria-hidden="true"></span>
              </button>
            </li>
          </TransitionGroup>
          <div class="intro-demo-reader">
            <Transition name="intro-read" mode="out-in">
              <div :key="reading.id" class="intro-demo-letter">
                <p class="intro-demo-letter-subject">{{ reading.subject }}</p>
                <p class="intro-demo-letter-meta">来自 {{ reading.sender }}</p>
                <p class="intro-demo-letter-body">{{ reading.body }}</p>
              </div>
            </Transition>
          </div>
        </section>
        <section class="intro-demo-panel intro-demo-compose" :class="{ 'is-active': state.tab === 'draft', 'is-saved': state.saved }" :inert="state.tab !== 'draft'" aria-label="草稿箱示例">
          <div class="intro-demo-field"><span class="intro-demo-label">收件人</span><span class="intro-demo-chip">{{ draft.to }}</span></div>
          <div class="intro-demo-field"><span class="intro-demo-label">主题</span><span>{{ draft.subject }}</span></div>
          <div class="intro-demo-draft">
            <p class="intro-demo-draft-text"><span class="sr-only">{{ draft.body }}</span><span aria-hidden="true">{{ typedText }}<span class="intro-demo-caret"></span></span></p>
            <span class="intro-demo-attach"><span class="intro-demo-attach-name">{{ draft.attachment }}</span><span class="intro-demo-attach-size">{{ draft.size }}</span></span>
          </div>
          <div class="intro-demo-foot">
            <span class="intro-demo-status"><span class="intro-demo-status-dot" aria-hidden="true"></span>{{ state.saved ? '草稿已保存' : '正在输入…' }}</span>
            <span class="intro-demo-send" aria-hidden="true">发送</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { siteInfo } from "../siteInfo";
import { createMailDemo, demoMails, DRAFT_DEMO } from "../intro/mailDemo";

const demo = createMailDemo({ siteName: siteInfo.siteName });
const state = demo.state;
const draft = DRAFT_DEMO;
const root = ref<HTMLElement>();
const unread = computed(() => state.rows.filter(row => row.unread).length);
const reading = computed(() => demoMails(siteInfo.siteName).find(mail => mail.id === state.selected) ?? state.rows[0]!.mail);
const typedText = computed(() => [...draft.body].slice(0, state.typed).join(""));
const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? "";

function hover(on: boolean) { demo.setPaused("hover", on); }
function keyboardFocusInside() {
  const active = document.activeElement;
  return Boolean(active && root.value?.contains(active) && active.matches(":focus-visible"));
}
function syncFocus() { demo.setPaused("focus", keyboardFocusInside()); }
function focusOut() { queueMicrotask(syncFocus); }

let stop = () => {};
onMounted(() => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const html = document.documentElement;
  const still = () => demo.setStill(media.matches || html.dataset.motion === "reduce" || html.dataset.performance === "low");
  const visibility = () => demo.setPaused("hidden", document.hidden);
  const preferences = new MutationObserver(still);
  preferences.observe(html, { attributes: true, attributeFilter: ["data-motion", "data-performance"] });
  if (typeof media.addEventListener === "function") media.addEventListener("change", still); else media.addListener(still);
  document.addEventListener("visibilitychange", visibility);
  const viewport = typeof IntersectionObserver === "undefined" ? undefined
    : new IntersectionObserver(([entry]) => demo.setPaused("offscreen", !entry?.isIntersecting), { threshold: 0.35 });
  if (viewport && root.value) { demo.setPaused("offscreen", true); viewport.observe(root.value); }
  still(); visibility(); demo.start();
  stop = () => {
    preferences.disconnect(); viewport?.disconnect();
    if (typeof media.removeEventListener === "function") media.removeEventListener("change", still); else media.removeListener(still);
    document.removeEventListener("visibilitychange", visibility);
  };
});
onBeforeUnmount(() => { stop(); demo.dispose(); });
</script>
