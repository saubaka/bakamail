<template>
  <section v-motion="{ kind: 'compact', delay: 100 }" class="mail-pane mail-pane--list" aria-label="邮件列表" :data-source="localCache ? 'local-cache' : 'server'" :data-filled="filled">
    <div class="mail-pane__head">
      <span class="mail-pane__title">{{ currentFolderLabel }} · {{ total }} 封</span>
      <span class="eyebrow">{{ selectedUids.length > 0 ? `已选 ${selectedUids.length}` : "" }}</span>
      <span v-if="localCache" class="eyebrow" role="status">本地摘要 · {{ refreshing ? '后台同步中…' : '等待同步' }}</span>
      <span v-else-if="refreshing && !loading" class="eyebrow" role="status">同步中…</span>
    </div>
    <div class="mail-bulk-slot" :class="{ 'is-open': selectedUids.length > 0 }" :inert="selectedUids.length === 0" :aria-hidden="selectedUids.length === 0">
      <div class="mail-bulk-clip"><div class="mail-toolbar mail-bulk-actions" role="group" aria-label="所选邮件操作">
      <button class="button button--soft" type="button" :disabled="actionBusy" @click="emit('mark', true)">标已读</button>
      <button class="button button--soft" type="button" :disabled="actionBusy" @click="emit('mark', false)">标未读</button>
      <button class="button button--soft" type="button" :disabled="actionBusy" @click="emit('archive')">归档</button>
      <button class="button button--soft" type="button" :disabled="actionBusy" @click="emit('remove')">删除</button>
      </div></div>
    </div>
    <div v-if="syncError" class="mail-sync-recovery" role="status">
      <span>同步尚未确认 · 已保留当前列表</span>
      <button class="button button--soft" type="button" :disabled="refreshing" @click="emit('refresh')">重新同步</button>
    </div>
    <div ref="scrollBody" class="mail-pane__body" @scroll.passive="onScroll">
      <div v-if="loading" class="mail-empty">正在加载…</div>
      <div v-else-if="messages.length === 0" class="mail-empty">这里还没有邮件</div>
      <div v-else class="mail-list">
        <div
          v-for="message in shownMessages"
          :key="message.uid"
          :data-uid="message.uid"
          v-row-reveal
          class="mail-row"
          :class="{ 'is-unread': !message.seen, 'is-current': message.uid === currentUid }"
          @contextmenu.prevent="emit('select', message.uid)"
        >
          <input
            class="mail-row__check"
            type="checkbox"
            :checked="selectedUids.includes(message.uid)"
            :aria-label="`选择邮件：${message.subject || '无主题'}`"
            @change="emit('select', message.uid)"
          />
          <button class="mail-row__open" type="button" :aria-label="`打开邮件：${message.subject || '无主题'}`" @click="emit('open', message.uid)">
            <span class="mail-row__line">
              <span class="mail-row__from">{{ message.from[0]?.name || message.from[0]?.address || "(无发件人)" }}</span>
              <span class="mail-row__date">{{ displayDate(message.date) }}</span>
            </span>
            <span class="mail-row__line"><span class="mail-row__subject">{{ message.subject }}</span></span>
            <span class="mail-row__marks">
              <span v-if="!message.seen" class="mail-dot" aria-label="未读"></span>
              <span v-if="message.flagged" class="mail-flag">星标</span>
              <span v-if="message.hasAttachments" class="mail-flag">附件</span>
              <span v-if="message.answered" class="mail-flag">已回复</span>
              <span class="mail-row__preview">{{ formatSize(message.size) }}</span>
            </span>
          </button>
        </div>
        <p v-if="nextBefore" class="mail-list-end" role="status">{{ refreshing ? "正在读取更早的邮件…" : "继续向下滚动，查看更早的邮件" }}</p>
      </div>
    </div>
    <div class="mail-count-line" :style="{ '--loaded-width': `${Math.min(100, shownMessages.length / Math.max(total, messages.length, 1) * 100)}%` }" aria-hidden="true" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { rowRevealDirective as vRowReveal } from "../../mail/rowReveal";
import { formatDate, formatSize } from "../../api";
import type { MessageSummary } from "../../mail/types";

const props = defineProps<{
  messages: MessageSummary[];
  currentUid: number | null;
  selectedUids: number[];
  currentFolderLabel: string;
  total: number;
  loading: boolean;
  refreshing: boolean;
  actionBusy: boolean;
  localCache: boolean;
  nextBefore: number | null;
  timeFormat: string;
  syncError?: string;
}>();

const emit = defineEmits<{
  mark: [read: boolean];
  archive: [];
  remove: [];
  select: [uid: number];
  open: [uid: number];
  more: [];
  refresh: [];
}>();
const scrollBody = ref<HTMLElement | null>(null);
const filled = ref(0);
const shownMessages = computed(() => props.messages.slice(0, filled.value));
let fillTimer: ReturnType<typeof setTimeout> | undefined;
let oldUids: number[] = [];
function fillNext() {
  const reduced = document.documentElement.dataset.motion === "reduce" || document.documentElement.dataset.performance === "low" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  filled.value = reduced ? props.messages.length : Math.min(props.messages.length, filled.value + 1);
  if (filled.value < props.messages.length) fillTimer = setTimeout(fillNext, 26);
}
watch(() => [props.currentFolderLabel, props.messages.map(message => message.uid).join(",")], (value, previous) => {
  clearTimeout(fillTimer);
  const ids = props.messages.map(message => message.uid);
  const prefixUnchanged = previous?.[0] === value[0] && oldUids.length > 0 && oldUids.every((uid, index) => ids[index] === uid);
  if (!prefixUnchanged) { filled.value = 0; void nextTick(() => { if (scrollBody.value) scrollBody.value.scrollTop = 0; }); }
  else filled.value = Math.min(filled.value, ids.length);
  oldUids = ids;
  if (filled.value < ids.length) fillNext();
}, { immediate: true });
function onScroll() {
  const body = scrollBody.value;
  if (body && props.nextBefore && !props.refreshing && filled.value === props.messages.length && body.scrollHeight - body.scrollTop - body.clientHeight < 120) emit("more");
}
onBeforeUnmount(() => clearTimeout(fillTimer));

function displayDate(value: string | null): string {
  if (props.timeFormat !== "12h" || !value) return formatDate(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() !== new Date().toDateString()) return formatDate(value);
  return date.toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit", hour12: true });
}
</script>
