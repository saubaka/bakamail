<template>
  <div>
    <main id="main-content" class="page-shell mail-utility-shell" tabindex="-1">
      <section v-motion="{ kind: 'feature', reversible: false }" class="admin-panel mail-tool-panel">
        <div class="section-heading mail-tool-heading">
          <div>
            <span class="eyebrow">SEARCH</span>
            <h1>搜索邮件</h1>
            <p>按主题、发件人或收件人搜索，也可以叠加状态和日期条件。</p>
          </div>
          <router-link class="button button--soft" to="/mail">返回邮箱</router-link>
        </div>

        <form class="mail-search-form" @submit.prevent="search">
          <label class="field mail-search-query">
            <span class="field__label">关键词</span>
            <input v-model="form.q" type="search" placeholder="主题、发件人或收件人" />
          </label>
          <label class="field">
            <span class="field__label">文件夹</span>
            <select v-theme-control v-model="form.folder">
              <option v-for="folder in folders" :key="folder.path" :value="folder.path">{{ folderLabel(folder) }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">起始日期</span>
            <input v-theme-control v-model="form.since" type="date" />
          </label>
          <label class="field">
            <span class="field__label">截止日期</span>
            <input v-theme-control v-model="form.before" type="date" />
          </label>
          <div class="mail-search-flags">
            <label><input v-model="form.unseen" type="checkbox" /> 仅未读</label>
            <label><input v-model="form.flagged" type="checkbox" /> 仅星标</label>
          </div>
          <p class="mail-search-date-hint">如起始/截止日期未选择，则默认不约束时间范围</p>
          <button v-press-feedback="'submit'" class="button button--primary mail-search-submit action-submit" type="submit" :disabled="busy" :aria-busy="busy">
            <span class="action-submit__spinner" aria-hidden="true" /><span>{{ busy ? "正在搜索…" : "开始搜索" }}</span>
          </button>
        </form>
        <p v-if="error" v-capsule-notice class="field-error" role="alert">{{ error }}</p>
      </section>

      <div class="search-result-slot" :class="{ 'is-open': busy || searched }" :inert="!busy && !searched" :aria-hidden="!busy && !searched"><div class="search-result-clip">
      <section class="admin-panel mail-tool-panel search-result-panel" :aria-busy="busy">
        <div class="panel-heading">
          <div><h2>搜索结果</h2><p>{{ searched ? `找到 ${results.length} 封邮件` : "输入至少一个搜索条件" }}</p></div>
          <span v-if="busy" class="search-update-state" role="status">{{ searched ? '正在更新结果…' : '正在查找邮件…' }}</span>
        </div>
        <p v-if="searched" class="hint-line">当前结果来自 {{ resultFolderName }}；更改条件后请重新搜索。</p>
        <div v-smooth-height class="search-result-flow"><div class="search-result-size"><transition name="search-copy">
        <div :key="resultsRevision" class="search-result-content">
        <div v-if="!searched" class="mail-empty">正在查找邮件…</div>
        <div v-else-if="results.length === 0" class="mail-empty">没有找到符合条件的邮件</div>
        <div v-else class="mail-result-list">
          <button v-for="item in results" :key="item.uid" class="mail-result-card" type="button" @click="open(item.uid)">
            <span class="mail-result-card__head">
              <strong>{{ item.subject || "（无主题）" }}</strong>
              <time>{{ formatDate(item.date) }}</time>
            </span>
            <span>{{ fromLabel(item) }}</span>
            <span class="mail-result-card__meta">
              <i v-if="!item.seen" class="status-pill status-pill--published">未读</i>
              <i v-if="item.flagged" class="status-pill">星标</i>
              <i v-if="item.hasAttachments" class="status-pill">附件</i>
              <small>{{ formatSize(item.size) }}</small>
            </span>
          </button>
        </div>
        </div></transition></div></div>
      </section>
      </div></div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { ApiError, formatDate, formatSize, toast } from "../api";
import { SessionSupersededError } from "../auth/sessionRequests";
import { listFolders } from "../api/mail";
import { folderLabel, folderPathLabel, type Folder, type MessageSummary } from "../mail/types";
import { smoothHeightDirective as vSmoothHeight } from "../smoothHeight";
import { useSessionStore } from "../stores/session";
import { useSearchStore } from "../stores/search";

const router = useRouter();
const session = useSessionStore();
const folders = ref<Folder[]>([]);
const searchStore = useSearchStore();
searchStore.clear();
const { loading: busy } = storeToRefs(searchStore);
const results = shallowRef<MessageSummary[]>([]);
const resultFolder = ref("");
const searched = ref(false);
const error = ref("");
const resultsRevision = ref(0);
const resultFolderName = computed(() => folderPathLabel(resultFolder.value, folders.value));
const form = reactive({ q: "", folder: "INBOX", since: "", before: "", unseen: false, flagged: false });
watch(() => searchStore.searched, value => {
  if (!value) { results.value = []; resultFolder.value = ""; searched.value = false; }
}, { flush: "sync" });

function fromLabel(message: MessageSummary): string {
  const first = message.from[0];
  return first ? first.name || first.address : "（无发件人）";
}

async function search(): Promise<void> {
  if (busy.value) return;
  const input = { folder: form.folder, q: form.q.trim() || undefined, since: form.since || undefined,
    before: form.before || undefined, unseen: form.unseen, flagged: form.flagged };
  if (!input.q && !input.since && !input.before && !input.unseen && !input.flagged) {
    error.value = "";
    toast("请至少填写一个关键词、日期或状态条件", "warning");
    return;
  }
  error.value = "";
  try {
    if (await searchStore.run(input)) {
      // Commit displayed data, its source folder and transition key in one render.
      results.value = [...searchStore.results];
      resultFolder.value = searchStore.resultFolder;
      searched.value = true;
      resultsRevision.value++;
    }
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "搜索失败，请稍后再试";
  }
}

async function open(uid: number): Promise<void> {
  if (!resultFolder.value || !results.value.some(item => item.uid === uid)) return;
  await router.push({ name: "mail", query: { folder: resultFolder.value, uid: String(uid) } });
}

onMounted(async () => {
  try {
    await session.restore();
    const data = await listFolders();
    folders.value = data.folders;
  } catch (reason) {
    if (reason instanceof SessionSupersededError) return;
    if (reason instanceof ApiError && reason.status === 401) await router.replace({ name: "intro", query: { reason: "session", redirect: "/mail/search" } });
    else error.value = reason instanceof ApiError ? reason.message : "文件夹暂时无法读取，请稍后重试";
  }
});
onBeforeUnmount(() => searchStore.clear());
</script>
