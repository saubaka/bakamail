<template>
  <section class="mail-pane mail-pane--reader" aria-label="邮件正文">
    <div v-if="loading" class="reader-loading-placeholder" aria-hidden="true"><span></span><span></span><span></span></div>
    <div v-else-if="!detail" class="mail-empty">选择一封邮件，开始阅读</div>
    <div v-else :key="`${currentFolder}:${detail.uid}`" class="reader-content">
      <header class="mail-reader__head">
        <h2 class="mail-reader__subject reader-arrive">{{ detail.subject || '无主题' }}</h2>
        <div class="reader-sender reader-arrive" style="--reader-delay:30ms">
          <div><strong>{{ detail.from[0]?.name || '发件人' }}</strong><span>{{ detail.from.map(item => item.address).join(', ') || '未知地址' }}</span></div>
          <time :datetime="detail.date || undefined">{{ detail.date ? new Date(detail.date).toLocaleString('zh-CN') : '' }}</time>
        </div>
        <div class="reader-information reader-arrive" style="--reader-delay:50ms">
          <button class="reader-subtle" type="button" :aria-expanded="showDetails" :aria-controls="detailsId" @click="showDetails = !showDetails">{{ showDetails ? '收起详情' : '收件详情' }} <span aria-hidden="true">{{ showDetails ? '−' : '+' }}</span></button>
          <button class="reader-security" type="button" :aria-expanded="showSecurity" :aria-controls="securityId" @click="showSecurity = !showSecurity"><span aria-hidden="true">◇</span> {{ securitySummary }} <span aria-hidden="true">{{ showSecurity ? '−' : '+' }}</span></button>
        </div>
        <div class="reader-expand" :class="{ 'is-open': showDetails }" :inert="!showDetails" :aria-hidden="!showDetails"><div class="reader-expand-clip">
          <dl :id="detailsId" class="reader-details">
            <dt>收件人</dt><dd>{{ detail.to.map(item => item.address).join(', ') || '未提供' }}</dd>
            <template v-if="detail.cc.length"><dt>抄送</dt><dd>{{ detail.cc.map(item => item.address).join(', ') }}</dd></template>
            <template v-if="detail.replyTo.length"><dt>回复地址</dt><dd>{{ detail.replyTo.map(item => item.address).join(', ') }}</dd></template>
            <dt>大小</dt><dd>{{ formatSize(detail.size) }}</dd>
          </dl>
        </div></div>
        <div class="reader-expand" :class="{ 'is-open': showSecurity }" :inert="!showSecurity" :aria-hidden="!showSecurity"><div class="reader-expand-clip">
          <div :id="securityId" class="reader-security-details">
            <div v-for="check in securityChecks" :key="check.name"><span>{{ check.name }}</span><strong>{{ check.label }}</strong></div>
            <p>认证结果仅供参考，不代表邮件内容可信。</p>
          </div>
        </div></div>
        <nav class="mail-reader__actions reader-arrive" aria-label="邮件操作" style="--reader-delay:70ms">
          <button class="button button--soft mail-reader__back" type="button" @click="emit('back')">返回列表</button>
          <button v-press-feedback class="button button--primary" type="button" @click="emit('reply', 'reply')">回复</button>
          <button v-press-feedback class="button button--soft" type="button" @click="emit('reply', 'reply-all')">回复全部</button>
          <button v-press-feedback class="button button--soft" type="button" @click="emit('reply', 'forward')">转发</button>
          <button class="button button--soft reader-more-toggle" type="button" :aria-expanded="showMore" :aria-controls="moreId" @click="showMore = !showMore">更多 <span aria-hidden="true">{{ showMore ? '−' : '+' }}</span></button>
        </nav>
        <div class="reader-expand" :class="{ 'is-open': showMore }" :inert="!showMore" :aria-hidden="!showMore"><div class="reader-expand-clip">
          <div :id="moreId" class="reader-more-actions" role="group" aria-label="更多邮件操作">
            <button class="button button--soft" type="button" :disabled="actionBusy" @click="emit('flag')">{{ detail.flagged ? '取消星标' : '加星标' }}</button>
            <button class="button button--soft" type="button" :disabled="actionBusy" @click="emit('archive')">归档</button>
            <button class="button button--soft" type="button" :disabled="actionBusy" @click="emit('remove')">删除</button>
            <button class="button button--soft" type="button" :aria-pressed="showRaw" @click="showRaw = !showRaw">{{ showRaw ? '看排版' : '看源码' }}</button>
            <a class="button button--soft" :href="`/api/messages/${detail.uid}/raw?folder=${encodeURIComponent(currentFolder)}`">下载 .eml</a>
          </div>
        </div></div>
      </header>
      <div class="mail-body">
        <Transition name="reader-notice" appear @after-leave="approveImages">
          <div v-if="blockedImages > 0 && !mediaApproving" class="reader-media-notice" :data-message-key="messageKey"><div class="reader-notice-clip">
            <div class="mail-notice"><div><strong>远程图片已隐藏</strong><span>共 {{ blockedImages }} 张，加载可能向发件方透露访问记录。</span></div>
              <button v-if="remoteImages !== 'block'" v-press-feedback class="button button--soft" type="button" @click="mediaApproving = true">本次显示</button>
              <span v-else class="reader-policy-note">已按隐私设置拦截</span>
            </div>
          </div></div>
        </Transition>
        <pre v-if="showRaw || !detail.html" class="mail-body__text reader-arrive" style="--reader-delay:90ms">{{ detail.text }}</pre>
        <iframe v-else :key="frameHtml" ref="bodyFrame" class="mail-body__frame reader-arrive" :class="{ 'is-media-loaded': frameLoaded && allowImages }" style="--reader-delay:90ms" title="邮件 HTML 正文" tabindex="0" sandbox="allow-scripts" referrerpolicy="no-referrer" :srcdoc="frameHtml" @load="frameLoaded = true"></iframe>
      </div>
      <div v-if="detail.attachments.length" class="mail-attachments reader-arrive" style="--reader-delay:110ms">
        <a v-for="file in detail.attachments" :key="file.part" class="mail-attachment" :href="attachmentPath(detail.uid, file.part, currentFolder)"><span>{{ file.filename }}</span><span class="mail-flag">{{ formatSize(file.size) }}</span></a>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, useId, watch } from 'vue';
import { formatSize } from '../../api';
import { attachmentPath } from '../../api/mail';
import { authenticationChecks, authenticationSummary, pageScriptNonce, readerFrameDocument, sanitizeReaderHtml } from '../../mail/reader';
import type { MessageDetail } from '../../mail/types';
import { validScrollPosition, type ScrollPosition } from '../../mail/scrollIntent';
const props = defineProps<{ detail: MessageDetail | null; loading: boolean; actionBusy: boolean; currentFolder: string; remoteImages: string }>();
const emit = defineEmits<{ back: []; reply: [kind: 'reply' | 'reply-all' | 'forward']; flag: []; archive: []; remove: []; readScroll: [position: ScrollPosition] }>();
const id = useId();
const detailsId = `${id}-details`, securityId = `${id}-security`, moreId = `${id}-more`;
const showRaw = ref(false), showDetails = ref(false), showSecurity = ref(false), showMore = ref(false);
const allowImages = ref(false), mediaApproving = ref(false), frameLoaded = ref(false);
const bodyFrame = ref<HTMLIFrameElement | null>(null);
const messageKey = computed(() => `${props.currentFolder}:${props.detail?.uid}`);
watch(() => [props.currentFolder, props.detail?.uid, props.remoteImages], () => {
  showRaw.value = showDetails.value = showSecurity.value = showMore.value = mediaApproving.value = false;
  allowImages.value = props.remoteImages === 'allow';
}, { immediate: true });
const securityChecks = computed(() => authenticationChecks(props.detail?.headers ?? {}));
const securitySummary = computed(() => authenticationSummary(securityChecks.value));
const safeContent = computed(() => sanitizeReaderHtml(props.detail?.html ?? '', allowImages.value));
const blockedImages = computed(() => safeContent.value.blocked);
const frameDocument = computed(() => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return { token, html: readerFrameDocument(safeContent.value.html, allowImages.value, token, pageScriptNonce() || token) };
});
const frameHtml = computed(() => frameDocument.value.html);
function receiveScroll(event: MessageEvent) {
  if (!bodyFrame.value || event.source !== bodyFrame.value.contentWindow || event.origin !== 'null') return;
  const data = event.data;
  if (!data || data.type !== 'bakamail-reader-scroll' || data.token !== frameDocument.value.token || !validScrollPosition(data.position)) return;
  emit('readScroll', data.position);
}
onMounted(() => window.addEventListener('message', receiveScroll));
onBeforeUnmount(() => window.removeEventListener('message', receiveScroll));
watch(frameHtml, () => { frameLoaded.value = false; }, { flush: 'sync' });
function approveImages(element: Element) {
  // Only explicit per-message approval can load remote resources, after the notice leaves.
  if (!mediaApproving.value || props.remoteImages === 'block' || element.getAttribute('data-message-key') !== messageKey.value) return;
  allowImages.value = true;
  void nextTick(() => bodyFrame.value?.focus({ preventScroll: true }));
}
</script>
