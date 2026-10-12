<template>
  <div class="ep-page">
    <main id="main-content" class="ep-main" tabindex="-1">
      <section class="ep-card" :class="{ 'ep--server': server }" aria-labelledby="ep-title">
        <span class="ep-logo" v-html="logo"></span>
        <p class="ep-site">{{ siteInfo.siteName }}</p>
        <p v-if="status" class="ep-code" aria-hidden="true"><span v-for="(digit, index) in digits" :key="index" :style="{ '--i': index }">{{ digit }}</span></p>
        <h1 id="ep-title" class="ep-title">{{ shownTitle }}</h1>
        <p class="ep-message">{{ shownMessage }}</p>
        <div v-if="showHome || canRetry" class="ep-actions">
          <router-link v-if="showHome" class="ep-button" to="/">返回首页</router-link>
          <button v-if="canRetry" class="ep-link" type="button" @click="emit('retry')">{{ retryLabel }}</button>
        </div>
      </section>
    </main>
    <footer class="ep-footer"><p>© {{ year }} saubaka. BakaMail.</p></footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ERROR_LOGO_SVG, LOAD_FAILURE_COPY, errorCopy, isServerError } from "../../../shared/errorPage";
import { ensureErrorStyles } from "../errorStyles";
import { siteInfo } from "../siteInfo";

const props = withDefaults(defineProps<{
  /** 状态码；不传表示不是 HTTP 错误（例如页面加载失败）。 */
  status?: number;
  title?: string;
  message?: string;
  /** 显示“重试”按钮，点击时触发 retry 事件。 */
  retryable?: boolean;
  retryLabel?: string;
  showHome?: boolean;
}>(), { status: undefined, title: "", message: "", retryable: undefined, retryLabel: "重试", showHome: true });
const emit = defineEmits<{ retry: [] }>();

ensureErrorStyles();
const logo = ERROR_LOGO_SVG;
const year = new Date().getFullYear();
const copy = computed(() => (props.status ? errorCopy(props.status) : LOAD_FAILURE_COPY));
const shownTitle = computed(() => props.title || copy.value.title);
const shownMessage = computed(() => props.message || copy.value.message);
const digits = computed(() => [...String(props.status ?? "")]);
const server = computed(() => props.status === undefined || isServerError(props.status));
const canRetry = computed(() => props.retryable ?? false);
</script>
