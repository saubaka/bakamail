<template>
  <div>
    <main id="main-content" class="page-shell mail-utility-shell" tabindex="-1">
      <section v-motion="{ kind: 'compact', reversible: false }" class="admin-panel mail-tool-panel contact-editor-panel">
        <div class="panel-heading"><div><span class="eyebrow">ADDRESS BOOK</span><h1>联系人</h1><p>保存常用地址，写邮件时可以快速带入。</p></div></div>
        <form class="form-grid" @submit.prevent="save">
          <label class="field">
            <span class="field__label">名字</span>
            <input v-model="form.name" maxlength="80" :disabled="busy" />
          </label>
          <label class="field">
            <span class="field__label">邮箱地址</span>
            <input v-model="form.email" type="email" required autocomplete="email" :disabled="busy" />
          </label>
          <label class="field field--wide">
            <span class="field__label">备注</span>
            <textarea v-model="form.note" rows="3" maxlength="200" :disabled="busy"></textarea>
          </label>
          <p v-if="error" v-capsule-notice class="field-error field--wide" role="alert">{{ error }}</p>
          <div class="button-row field--wide">
            <button class="button button--primary" type="submit" :disabled="busy">{{ saving ? "保存中…" : form.id ? "保存修改" : "新增联系人" }}</button>
            <button v-if="form.id" class="button button--soft" type="button" :disabled="busy" @click="reset">取消编辑</button>
          </div>
        </form>
      </section>

      <section v-motion="{ kind: 'feature', delay: 80 }" class="admin-panel mail-tool-panel">
        <div class="mail-contact-toolbar">
          <label class="field">
            <span class="field__label">筛选联系人</span>
            <input v-model="query" type="search" placeholder="名字或邮箱" />
          </label>
          <span class="badge badge--blue">{{ filtered.length }} 位</span>
        </div>
        <p v-if="removeError" class="mail-notice" role="alert">{{ removeError }}</p>
        <p v-if="loadError" class="mail-notice" role="alert">
          {{ loadError }}<span v-if="contacts.length">下方是本机保留的列表，可能尚未同步。</span>
          <button class="button button--soft" type="button" :disabled="loading || busy" @click="initialize">重试读取</button>
        </p>
        <div v-if="loading && contacts.length === 0" class="mail-empty">正在读取联系人…</div>
        <div v-else-if="filtered.length === 0 && !loadError" class="mail-empty">没有符合条件的联系人</div>
        <div v-else-if="filtered.length > 0" class="contact-grid">
          <article v-for="contact in filtered" :key="contact.id" class="managed-page-card contact-card">
            <span class="avatar avatar--small">{{ (contact.name || contact.email)[0]?.toUpperCase() }}</span>
            <div class="contact-card__copy">
              <strong>{{ contact.name || "未命名联系人" }}</strong>
              <a :href="`mailto:${contact.email}`">{{ contact.email }}</a>
              <small v-if="contact.note">{{ contact.note }}</small>
            </div>
            <div class="contact-card__actions">
              <button class="button button--primary" type="button" @click="compose(contact.email)">写邮件</button>
              <button class="button button--soft" type="button" :disabled="busy" @click="edit(contact)">编辑</button>
              <button class="button button--danger" type="button" :disabled="busy" @click="remove(contact)">{{ removingId === contact.id ? "处理中…" : "删除" }}</button>
            </div>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { ApiError, toast } from "../api";
import { SessionSupersededError } from "../auth/sessionRequests";
import type { Contact } from "../api/contacts";
import { confirmDialog } from "../dialog";
import { useSessionStore } from "../stores/session";
import { useContactStore } from "../stores/contacts";

const router = useRouter();
const session = useSessionStore();
const contactStore = useContactStore();
const { contacts, saving } = storeToRefs(contactStore);
const query = ref("");
const initializing = ref(true);
const initializationError = ref("");
const loading = computed(() => initializing.value || contactStore.loading);
const loadError = computed(() => initializationError.value || contactStore.loadError);
const error = ref("");
const removeError = ref("");
const confirmingId = ref<number | null>(null);
const removingId = computed(() => contactStore.removingId ?? confirmingId.value);
const busy = computed(() => saving.value || removingId.value !== null);
let active = true;
let initializationVersion = 0;
const form = reactive<{ id: number | null; name: string; email: string; note: string }>({
  id: null,
  name: "",
  email: "",
  note: "",
});
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return needle
    ? contacts.value.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(needle))
    : contacts.value;
});

function reset(): void {
  Object.assign(form, { id: null, name: "", email: "", note: "" });
  error.value = "";
}

function edit(contact: Contact): void {
  Object.assign(form, contact);
  window.scrollTo({ top: 0, behavior: document.documentElement.dataset.motion === "reduce" ? "auto" : "smooth" });
}

async function save(): Promise<void> {
  if (busy.value) return;
  const current = contactStore.context();
  const id = form.id;
  error.value = "";
  initializationError.value = "";
  try {
    const payload = { name: form.name.trim(), email: form.email.trim(), note: form.note.trim() };
    if (!(await contactStore.save(payload, id)) || !active || !contactStore.isCurrent(current)) return;
    toast(id ? "联系人已更新" : "联系人已添加");
    reset();
    // Reading is separate from the confirmed write. Its failure must not restore old data/input.
    await contactStore.load().catch(() => undefined);
  } catch (reason) {
    if (active && contactStore.isCurrent(current)) error.value = reason instanceof ApiError ? reason.message : "保存失败";
  }
}

async function remove(contact: Contact): Promise<void> {
  if (busy.value) return;
  const current = contactStore.context();
  confirmingId.value = contact.id;
  removeError.value = "";
  initializationError.value = "";
  try {
    if (!(await confirmDialog({
      title: "删除联系人",
      message: `确定删除 ${contact.name || contact.email}？邮件本身不会受到影响。`,
      confirmLabel: "删除联系人",
      tone: "danger",
    }))) return;
    if (!active || !contactStore.isCurrent(current)) return;
    if (!(await contactStore.remove(contact.id)) || !active || !contactStore.isCurrent(current)) return;
    if (form.id === contact.id) reset();
    toast("联系人已删除");
    await contactStore.load().catch(() => undefined);
  } catch (reason) {
    if (active && contactStore.isCurrent(current)) removeError.value = reason instanceof ApiError ? reason.message : "删除失败，请重试";
  } finally {
    if (active && contactStore.isCurrent(current)) confirmingId.value = null;
  }
}

async function compose(email: string): Promise<void> {
  await router.push({ name: "mail", query: { compose: "new", to: email } });
}

async function initialize(): Promise<void> {
  const request = ++initializationVersion;
  initializing.value = true;
  initializationError.value = "";
  try {
    await session.restore();
    if (!active || request !== initializationVersion) return;
    contactStore.bindOwner(session.mailbox);
    await contactStore.load();
  } catch (reason) {
    if (!active || request !== initializationVersion || reason instanceof SessionSupersededError) return;
    if (reason instanceof ApiError && reason.status === 401) {
      session.clear();
      await router.replace({ name: "intro", query: { reason: "session", redirect: "/mail/contacts" } });
    } else initializationError.value = reason instanceof ApiError ? reason.message : "联系人暂时无法读取，请稍后重试";
  } finally {
    if (active && request === initializationVersion) initializing.value = false;
  }
}

watch(() => session.mailbox, (mailbox, previous) => {
  contactStore.bindOwner(mailbox);
  reset();
  query.value = "";
  removeError.value = "";
  confirmingId.value = null;
  initializationError.value = "";
  if (previous && previous !== mailbox) { initializationVersion += 1; initializing.value = false; }
}, { immediate: true, flush: "sync" });
onMounted(initialize);
onBeforeUnmount(() => { active = false; initializationVersion += 1; });
</script>
