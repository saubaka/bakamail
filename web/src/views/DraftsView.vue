<template>
  <div>
    <main id="main-content" class="page-shell mail-utility-shell" tabindex="-1">
      <section v-motion="{ kind: 'feature', reversible: false }" class="admin-panel mail-tool-panel">
        <div class="section-heading mail-tool-heading">
          <div><span class="eyebrow">DRAFTS</span><h1>草稿</h1><p>继续编辑尚未发送的内容，或清理不再需要的草稿。</p></div>
          <router-link class="button button--primary" :to="{ name: 'mail', query: { compose: 'new' } }">写新邮件</router-link>
        </div>
        <p v-if="error" v-capsule-notice class="field-error" role="alert">{{ error }}</p>
        <div v-if="loading" class="mail-empty">正在读取草稿…</div>
        <div v-else-if="drafts.length === 0" class="mail-empty">还没有保存的草稿</div>
        <div v-else class="draft-grid">
          <article v-for="draft in drafts" :key="draft.id" class="managed-page-card draft-card">
            <div>
              <span class="eyebrow">{{ draft.to || "尚未填写收件人" }}</span>
              <h2>{{ draft.subject || "（无主题）" }}</h2>
              <p>{{ preview(draft.text) }}</p>
            </div>
            <div class="button-row">
              <button class="button button--primary" type="button" @click="edit(draft.id)">继续编辑</button>
              <button class="button button--danger" type="button" @click="remove(draft.id)">删除</button>
            </div>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, toast } from "../api";
import { SessionSupersededError } from "../auth/sessionRequests";
import { listDrafts, deleteDraft, type Draft } from "../api/drafts";
import { confirmDialog } from "../dialog";
import { useSessionStore } from "../stores/session";

const router = useRouter();
const session = useSessionStore();
const drafts = ref<Draft[]>([]);
const loading = ref(true);
const error = ref("");

function preview(value = ""): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 180) : "这封草稿还没有正文";
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await listDrafts();
    drafts.value = data.drafts;
  } finally {
    loading.value = false;
  }
}

async function edit(id: string): Promise<void> {
  await router.push({ name: "mail", query: { draft: id } });
}

async function remove(id: string): Promise<void> {
  if (!(await confirmDialog({
    title: "删除草稿",
    message: "这封草稿会从 BakaMail 中永久删除，此操作无法撤销。",
    confirmLabel: "删除草稿",
    tone: "danger",
  }))) return;
  try {
    await deleteDraft(id);
    await load();
    toast("草稿已删除");
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "删除失败";
  }
}

onMounted(async () => {
  try {
    await session.restore();
    await load();
  } catch (reason) {
    if (reason instanceof SessionSupersededError) return;
    if (reason instanceof ApiError && reason.status === 401) await router.replace({ name: "intro", query: { reason: "session", redirect: "/mail/drafts" } });
    else error.value = reason instanceof ApiError ? reason.message : "草稿暂时无法读取，请稍后重试";
  }
});
</script>
