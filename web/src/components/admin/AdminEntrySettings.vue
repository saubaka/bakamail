<template>
  <section v-motion="{ kind: 'feature' }" class="admin-panel is-wide" aria-labelledby="entry-settings-title">
    <div class="panel-heading"><div><span class="eyebrow">后台入口</span><h2 id="entry-settings-title">自定义管理员路径</h2><p>修改后旧地址立即停用，会话和邮局账号不变；页面无刷新切换到新地址。</p></div></div>
    <p v-if="loading" class="admin-page-state" role="status">正在读取入口设置…</p>
    <form v-if="loaded" class="form-grid" @submit.prevent="save">
      <label class="field field--wide"><span class="field__label">后台路径</span><input v-model="draft" maxlength="49" autocomplete="off" autocapitalize="none" spellcheck="false" :disabled="loading || saving || uncertain" aria-describedby="entry-settings-help" /><small id="entry-settings-help">使用 / 开头的单层路径，3–48 位小写字母、数字、短横线或下划线，首位字母。请在保存后更新书签。</small></label>
      <p class="hint-line">当前已保存入口：<a :href="savedUrl" @click.prevent="router.push(saved!.adminBase)">{{ savedUrl }}</a></p>
      <button v-press-feedback="'submit'" type="submit" class="button button--primary" :disabled="loading || saving || uncertain || draft === saved?.adminBase" :aria-busy="saving">{{ saving ? "正在保存…" : "保存后台路径" }}</button>
    </form>
    <p v-if="error" v-capsule-notice class="form-error" role="alert">{{ error }}</p>
    <button v-if="!loaded || error" class="button button--soft" type="button" :disabled="loading || saving" @click="load">重新读取已保存入口</button>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, toast } from "../../api";
import { adminPathProblem } from "../../../../shared/adminPaths";
import { installAdminRoutes } from "../../router";
import type { EntrySettings } from "../../auth/installation";
const router = useRouter();
const route = useRoute();
const saved = ref<EntrySettings | null>(null);
const draft = ref("");
const loading = ref(false);
const saving = ref(false);
const loaded = ref(false);
const uncertain = ref(false);
const error = ref("");
const savedUrl = computed(() => saved.value ? `${window.location.origin}${saved.value.adminBase}` : "");
let active = true;
let controller: AbortController | undefined;
async function requestSettings(method = "GET", body?: unknown): Promise<EntrySettings> {
  controller = new AbortController();
  const timer = setTimeout(() => controller?.abort(), 15_000);
  try {
    const result = await api<EntrySettings>("/api/admin/entry-settings", { method, body, signal: controller.signal });
    if (adminPathProblem(result.adminBase) || !Number.isSafeInteger(result.revision)) throw new Error("入口设置响应不合法");
    return result;
  } finally { clearTimeout(timer); }
}
async function followPath(result: EntrySettings): Promise<void> {
  const currentName = route.name;
  installAdminRoutes(result.adminBase);
  if (typeof currentName === "string" && currentName.startsWith("admin-")) await router.replace({ name: currentName, query: route.query, hash: route.hash });
}
async function load(): Promise<void> {
  if (loading.value || saving.value) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await requestSettings();
    if (!active) return;
    saved.value = result; draft.value = result.adminBase; loaded.value = true; uncertain.value = false;
    await followPath(result);
  } catch (caught) { if (active) error.value = caught instanceof Error ? caught.message : "读取失败"; }
  finally { if (active) loading.value = false; }
}
async function save(): Promise<void> {
  if (!saved.value || saving.value || loading.value || uncertain.value) return;
  error.value = adminPathProblem(draft.value);
  if (error.value) return;
  saving.value = true;
  try {
    const result = await requestSettings("PATCH", { adminBase: draft.value, revision: saved.value.revision });
    if (!active) return;
    saved.value = result; draft.value = result.adminBase;
    await followPath(result);
    toast("后台路径已保存，请更新书签");
  } catch (caught) {
    if (active) { uncertain.value = true; error.value = `${caught instanceof Error ? caught.message : "保存失败"}；请重新读取并核对后再保存。`; }
  } finally { if (active) saving.value = false; }
}
onMounted(() => { void load(); });
onBeforeUnmount(() => { active = false; controller?.abort(); });
</script>
