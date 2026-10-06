<template>
  <dialog ref="dialogRef" class="modal compose-dialog" aria-labelledby="compose-title" @cancel.prevent="close">
    <div class="modal__header">
      <h2 id="compose-title">{{ title }}</h2>
      <button class="icon-button" type="button" aria-label="关闭" :disabled="sending || closing" @click="close">×</button>
    </div>
    <form class="form-grid compose-form" @submit.prevent="send">
      <RecipientField id="compose-to" v-model="compose.to" label="收件人（多个用逗号分隔）" :contacts="contacts" :disabled="inputLocked" required wide />
      <div class="compose-grid__row">
        <RecipientField id="compose-cc" v-model="compose.cc" label="抄送" :contacts="contacts" :disabled="inputLocked" />
        <RecipientField id="compose-bcc" v-model="compose.bcc" label="密送" :contacts="contacts" :disabled="inputLocked" />
      </div>
      <label class="field field--wide">
        <span class="field__label">主题</span>
        <input v-model="compose.subject" :disabled="inputLocked" />
      </label>
      <label class="field field--wide">
        <span class="field__label">正文</span>
        <textarea v-model="compose.text" :disabled="inputLocked"></textarea>
      </label>
      <div class="field field--wide">
        <span class="field__label">附件（单封上限 32 MiB）</span>
        <input ref="fileInput" class="compose-file-input" type="file" multiple :disabled="inputLocked" tabindex="-1" aria-hidden="true" @change="pickFiles" />
        <button v-press-feedback class="button button--soft" type="button" :disabled="inputLocked" @click="fileInput?.click()">＋ 选择附件</button>
      </div>
      <p v-if="store.isOpen && hint && !deliveryUnconfirmed" v-capsule-notice class="field-error field--wide" role="alert">{{ hint }}</p>
      <p v-if="store.isOpen && deliveryUnconfirmed" v-capsule-notice="{ manualReason: 'delivery-unconfirmed' }" class="field-error field--wide" role="alert">发送结果未确认。请先核对“已发送”或管理员记录，不要直接重发。</p>
      <p class="compose-save-state field--wide" role="status">{{ sending ? sendStatus : deliveryUnconfirmed ? "发送结果未确认 · 请核对已发送或管理员记录，勿直接重发。" : readingAttachments ? "正在读取附件，完成前暂不能发送…" : draftStatus }}</p>
      <div v-if="sending && sendProgress?.phase === 'uploading'" class="progress field--wide" role="progressbar" aria-label="邮件数据上传进度" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="uploadPercent ?? undefined" :aria-valuetext="uploadPercent === null ? '进度不可计算' : `${uploadPercent}%`">
        <span v-if="uploadPercent !== null" :style="{ width: `${uploadPercent}%` }"></span>
      </div>
      <div class="button-row button-row--end">
        <button class="button button--soft" type="button" :disabled="inputLocked || savingDraft" @click="saveDraft">{{ savingDraft ? "正在存草稿…" : "存草稿" }}</button>
        <button v-if="deliveryUnconfirmed" class="button button--soft" type="button" :disabled="inputLocked" @click="confirmSendRetry">核对后允许重试</button>
        <button class="button button--primary" type="submit" :disabled="inputLocked || readingAttachments || deliveryUnconfirmed">
          {{ sending ? "正在发送…" : "发送" }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import RecipientField from "../RecipientField.vue";
import { toast } from "../../api";
import { closeDialog, confirmDialog, openDialog } from "../../dialog";
import type { MessageDetail } from "../../mail/types";
import { useComposeStore } from "../../stores/compose";
import { bindComposeViewport } from "../../mail/composeViewport";

type ReplyMode = "reply" | "reply-all" | "forward";
type Contact = { name: string; email: string };
const props = defineProps<{ account: string; signature: string; contacts: Contact[] }>();
const emit = defineEmits<{ sent: [notice: string] }>();
const store = useComposeStore();
const surface = store.attach();
const { compose } = store;
const { title, hint, sending, sendProgress, deliveryUnconfirmed, openingDraft, readingAttachments, savingDraft, draftStatus } = storeToRefs(store);
const uploadPercent = computed(() => sendProgress.value?.total ? Math.min(100, Math.max(0, Math.floor(sendProgress.value.loaded / sendProgress.value.total * 100))) : null);
const sendStatus = computed(() => {
  const progress = sendProgress.value;
  if (!progress) return "正在准备邮件并等待当前草稿保存…";
  if (progress.phase === "awaiting-response") return "邮件数据已上传，正在等待邮局确认；此时尚未确认发送成功。";
  if (progress.total === null) return "正在上传邮件数据（含附件），浏览器未提供可计算的进度…";
  return `邮件数据（含附件）上传：${uploadPercent.value}%`;
});
const dialogRef = ref<HTMLDialogElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const closing = ref(false);
const inputLocked = computed(() => sending.value || openingDraft.value || closing.value);
let active = true;
let filePickVersion = 0;
let closingVersion = 0;
let closeFlight: Promise<boolean> | null = null;
let releaseViewport: ((preserveGeometry?: boolean) => void) | null = null;

watch(() => props.account, (account) => {
  closingVersion += 1;
  closeFlight = null;
  closing.value = false;
  store.bindOwner(account);
}, { immediate: true, flush: "sync" });
watch(() => store.isOpen, (isOpen) => {
  // Freeze the measured bounds during the short exit instead of jumping below the keyboard.
  releaseViewport?.(!isOpen); releaseViewport = null;
  if (isOpen && dialogRef.value) releaseViewport = bindComposeViewport(dialogRef.value);
  if (!isOpen) { filePickVersion += 1; closeDialog(dialogRef.value); }
}, { flush: "sync" });

function open(source?: MessageDetail, kind: ReplyMode = "reply", initialTo = ""): void {
  if (store.open(source, kind, initialTo, props.signature)) {
    filePickVersion += 1;
    if (fileInput.value) fileInput.value.value = "";
  }
  if (!store.isOpen) return;
  openDialog(dialogRef.value);
  dialogRef.value?.querySelector<HTMLInputElement>("#compose-to")?.focus();
}

function closeFlow(leaving: boolean): Promise<boolean> {
  if (closeFlight) return closeFlight;
  if (!store.isOpen) return Promise.resolve(true);
  if (sending.value) return Promise.resolve(false);
  if (openingDraft.value) { store.finishClose(); closeDialog(dialogRef.value); return Promise.resolve(true); }
  const current = store.context();
  const ticket = ++closingVersion;
  closing.value = true;
  closeFlight = (async () => {
    store.clearDraftTimer();
    if (store.dirty && (store.hasContent() || store.draftId)) {
      const saved = await store.persistDraft();
      if (!active || !store.isCurrent(current) || sending.value) return false;
      if (!saved && !(await confirmDialog({
        title: "草稿尚未保存",
        message: leaving ? "保存失败。离开会丢失本次修改，仍要离开吗？" : "保存失败。现在关闭会丢失本次修改，仍要关闭吗？",
        confirmLabel: leaving ? "放弃修改并离开" : "放弃修改", tone: "danger",
      }))) return false;
      if (!active || !store.isCurrent(current) || sending.value) return false;
    }
    if ((readingAttachments.value || compose.attachments.length > 0) && !(await confirmDialog({
      title: leaving ? "附件不会保存在草稿中" : "附件尚未保存",
      message: readingAttachments.value ? "附件仍在读取。关闭将取消读取，附件不会保存在草稿中。" : leaving ? "离开后需要重新添加附件。" : "草稿只保存正文和收件信息。关闭后需要重新添加附件。",
      confirmLabel: leaving ? "离开并移除附件" : "关闭并移除附件", tone: "danger",
    }))) return false;
    if (!active || !store.isCurrent(current) || sending.value) return false;
    store.finishClose();
    closeDialog(dialogRef.value);
    return true;
  })().finally(() => {
    if (ticket === closingVersion) { closing.value = false; closeFlight = null; }
  });
  return closeFlight;
}
async function close(): Promise<void> { await closeFlow(false); }
async function confirmLeave(): Promise<boolean> { return closeFlow(true); }

async function pickFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const ticket = ++filePickVersion;
  const current = store.context();
  const selected = await store.selectFiles(Array.from(input.files ?? []));
  if (active && ticket === filePickVersion && store.isCurrent(current) && !selected) input.value = "";
}
async function saveDraft(): Promise<void> {
  if (inputLocked.value || savingDraft.value) return;
  const current = store.context();
  if (await store.persistDraft() && active && store.isCurrent(current) && store.draftId) toast("草稿已保存");
}
async function openDraft(id: string): Promise<void> {
  const pending = store.openDraft(id);
  const current = store.context();
  if (store.isOpen) openDialog(dialogRef.value);
  const opened = await pending;
  if (!active || !store.isCurrent(current)) return;
  if (!opened && !store.isOpen) { closeDialog(dialogRef.value); toast(store.hint || "草稿无法读取，请重试", "warning"); }
  if (opened && fileInput.value) fileInput.value.value = "";
}
async function send(): Promise<void> {
  if (closing.value) return;
  const result = await store.send();
  if (!result || !active || !store.isCurrent(result.context)) return;
  closeDialog(dialogRef.value);
  toast(result.notice || "邮件已交给邮局，并写入“已发送”", result.notice ? "warning" : "success");
  emit("sent", result.notice);
}
async function confirmSendRetry(): Promise<void> {
  if (!deliveryUnconfirmed.value || inputLocked.value) return;
  const current = store.context();
  if (!(await confirmDialog({ title: "确认发送结果", message: "仅在核对已发送或管理员记录、确认没有投递后重试。重复发送可能让收件人收到多封邮件。", confirmLabel: "已确认未发送，允许重试", tone: "danger" }))) return;
  if (active && store.isCurrent(current)) store.allowSendRetry();
}
function warnBeforeUnload(event: BeforeUnloadEvent): void {
  if (!store.needsLeaveWarning) return;
  event.preventDefault();
  event.returnValue = "";
}
onMounted(() => {
  window.addEventListener("beforeunload", warnBeforeUnload);
  if (store.isOpen && dialogRef.value) releaseViewport = bindComposeViewport(dialogRef.value);
});
onBeforeUnmount(() => {
  active = false;
  releaseViewport?.(); releaseViewport = null;
  filePickVersion += 1;
  closingVersion += 1;
  store.detach(surface);
  window.removeEventListener("beforeunload", warnBeforeUnload);
});
defineExpose({ open, openDraft, confirmLeave });
</script>
