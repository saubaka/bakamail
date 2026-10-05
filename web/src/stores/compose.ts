import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { ApiError, type UploadProgress } from "../api/client.ts";
import { listDrafts, saveDraft, deleteDraft, type DraftPayload } from "../api/drafts.ts";
import { sendMessage, type SendInput, type SendResult } from "../api/mail.ts";
import { replyRecipients } from "../mail/recipients.ts";
import { readFileBase64 } from "../mail/attachments.ts";
import type { MessageDetail } from "../mail/types.ts";

type ComposeMode = "new" | "reply" | "reply-all" | "forward";
type Context = { owner: string; generation: number };
const initialStatus = "内容修改后会自动保存为草稿；附件不会随草稿保存。";
const empty = () => ({ to: "", cc: "", bcc: "", subject: "", text: "",
  attachments: [] as NonNullable<SendInput["attachments"]>, inReplyTo: "", references: [] as string[] });

export const useComposeStore = defineStore("mail-compose", () => {
  const owner = ref("");
  const compose = reactive(empty());
  const mode = ref<ComposeMode>("new");
  const isOpen = ref(false);
  const sending = ref(false);
  const sendProgress = ref<UploadProgress | null>(null);
  const deliveryUnconfirmed = ref(false);
  const openingDraft = ref(false);
  const savingDraft = ref(false);
  const readingAttachments = ref(false);
  const hint = ref("");
  const draftId = ref("");
  const draftStatus = ref(initialStatus);
  const lastSavedSnapshot = ref("");
  let generation = 0;
  let surfaceVersion = 0;
  let fileVersion = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loadController: AbortController | null = null;
  let fileController: AbortController | null = null;
  let saveFlight: { generation: number; promise: Promise<boolean> } | null = null;

  const title = computed(() => mode.value === "reply" ? "回复" : mode.value === "reply-all" ? "回复全部" : mode.value === "forward" ? "转发" : "写邮件");
  function snapshot(): string {
    return JSON.stringify({ to: compose.to, cc: compose.cc, bcc: compose.bcc,
      subject: compose.subject, text: compose.text, mode: mode.value,
      inReplyTo: compose.inReplyTo, references: compose.references,
      ...(deliveryUnconfirmed.value ? { deliveryUnconfirmed: true } : {}) });
  }
  function hasContent(): boolean { return [compose.to, compose.cc, compose.bcc, compose.subject, compose.text].some(value => value.trim().length > 0); }
  const dirty = computed(() => snapshot() !== lastSavedSnapshot.value);
  const needsLeaveWarning = computed(() => isOpen.value && (dirty.value || compose.attachments.length > 0 || savingDraft.value || sending.value || readingAttachments.value));
  function context(): Context { return { owner: owner.value, generation }; }
  function isCurrent(value: Context): boolean { return Boolean(value.owner) && owner.value === value.owner && generation === value.generation; }
  function clearDraftTimer(): void { if (timer !== null) clearTimeout(timer); timer = null; }
  function resetContent(): void {
    generation += 1;
    fileVersion += 1;
    clearDraftTimer();
    loadController?.abort(); fileController?.abort();
    loadController = fileController = null;
    saveFlight = null;
    isOpen.value = false;
    sending.value = openingDraft.value = savingDraft.value = readingAttachments.value = false;
    sendProgress.value = null;
    deliveryUnconfirmed.value = false;
    Object.assign(compose, empty());
    mode.value = "new";
    draftId.value = "";
    hint.value = "";
    draftStatus.value = initialStatus;
    lastSavedSnapshot.value = snapshot();
  }
  function clear(): void { resetContent(); owner.value = ""; }
  function attach(): number { surfaceVersion += 1; clear(); return surfaceVersion; }
  function detach(surface: number): void { if (surface === surfaceVersion) clear(); }
  function bindOwner(mailbox: string): void {
    const normalized = mailbox.trim().toLowerCase();
    if (normalized === owner.value) return;
    clear(); owner.value = normalized;
  }
  function queueDraftSave(): void {
    clearDraftTimer();
    if (!isOpen.value || sending.value || openingDraft.value || (!hasContent() && !draftId.value)) return;
    draftStatus.value = "尚未保存的修改…";
    timer = setTimeout(() => { timer = null; void persistDraft(); }, 1500);
  }
  watch(snapshot, () => { if (isOpen.value && dirty.value) queueDraftSave(); }, { flush: "sync" });

  function open(source?: MessageDetail, kind: Exclude<ComposeMode, "new"> = "reply", initialTo = "", signature = ""): boolean {
    if (!owner.value) return false;
    if (isOpen.value && !openingDraft.value) { hint.value = "请先保存或关闭当前邮件，再打开另一封。"; return false; }
    resetContent();
    mode.value = source ? kind : "new";
    const recipients = source && kind !== "forward" ? replyRecipients(source, owner.value, kind === "reply-all") : { to: initialTo, cc: "" };
    compose.to = recipients.to; compose.cc = recipients.cc;
    compose.subject = source ? kind === "forward" ? `转发：${source.subject}` : /^(Re:|回复：)/.test(source.subject) ? source.subject : `Re: ${source.subject}` : "";
    const quoted = source ? `\n\n----- 原邮件 -----\n发件人：${source.from.map(item => item.address).join(", ")}\n时间：${source.date ?? ""}\n\n${source.text}` : "";
    compose.text = signature ? `${source ? "\n\n" : ""}--\n${signature}${quoted}` : quoted;
    compose.inReplyTo = source?.headers["message-id"] ?? "";
    compose.references = source ? [...new Set([...source.references, source.headers["message-id"]].filter(Boolean))] : [];
    lastSavedSnapshot.value = snapshot();
    isOpen.value = true;
    return true;
  }

  async function openDraft(id: string): Promise<boolean> {
    if (!open()) return false;
    const current = context();
    openingDraft.value = true;
    draftStatus.value = "正在读取草稿…";
    loadController = new AbortController();
    try {
      const data = await listDrafts(loadController.signal);
      if (!isCurrent(current)) return false;
      const draft = data.drafts.find(item => item.id === id);
      if (!draft) throw new Error("草稿不存在或已经删除");
      draftId.value = draft.id;
      for (const key of ["to", "cc", "bcc", "subject", "text", "inReplyTo"] as const) compose[key] = draft[key] ?? "";
      compose.references = [...(draft.references ?? [])];
      mode.value = draft.mode ?? "new";
      deliveryUnconfirmed.value = draft.deliveryUnconfirmed === true;
      if (deliveryUnconfirmed.value) hint.value = "这封邮件之前的发送结果未确认；请先核对发送记录，勿直接重发。";
      lastSavedSnapshot.value = snapshot();
      draftStatus.value = "草稿已保存；附件需重新添加。";
      return true;
    } catch (error) {
      if (!isCurrent(current)) return false;
      hint.value = error instanceof Error ? error.message : "草稿读取失败";
      isOpen.value = false;
      return false;
    } finally {
      if (isCurrent(current)) { loadController = null; openingDraft.value = false; }
    }
  }

  async function persistDraft(): Promise<boolean> {
    clearDraftTimer();
    const current = context();
    if (!isCurrent(current) || !isOpen.value || sending.value || openingDraft.value) return false;
    // All waiters re-check the flight; only one can create the next write after it settles.
    while (saveFlight?.generation === generation) {
      await saveFlight.promise;
      if (!isCurrent(current) || sending.value || !isOpen.value) return false;
    }
    const value = snapshot();
    if ((value === lastSavedSnapshot.value && draftId.value) || (!hasContent() && !draftId.value)) return true;
    savingDraft.value = true;
    draftStatus.value = "正在保存草稿…";
    const flight = { generation, promise: Promise.resolve(false) };
    saveFlight = flight;
    flight.promise = (async () => {
      try {
        const data = await saveDraft(JSON.parse(value) as DraftPayload, draftId.value || undefined);
        if (!isCurrent(current)) return false;
        draftId.value = data.id;
        lastSavedSnapshot.value = value;
        draftStatus.value = "草稿已保存；附件需重新添加。";
        if (!deliveryUnconfirmed.value) hint.value = "";
        if (isOpen.value && snapshot() !== value) queueDraftSave();
        return true;
      } catch (error) {
        if (!isCurrent(current)) return false;
        draftStatus.value = "自动保存失败，请检查网络后重试。";
        hint.value = error instanceof ApiError ? error.message : "草稿保存失败";
        return false;
      } finally {
        if (isCurrent(current) && saveFlight === flight) { saveFlight = null; savingDraft.value = false; }
      }
    })();
    return flight.promise;
  }

  async function selectFiles(files: File[], read = readFileBase64): Promise<boolean> {
    if (!isOpen.value || sending.value || openingDraft.value) return false;
    const current = context();
    const fileRead = ++fileVersion;
    fileController?.abort();
    fileController = new AbortController();
    readingAttachments.value = false;
    if (files.reduce((sum, file) => sum + file.size, 0) > 33_554_432) {
      hint.value = "附件超过邮局 32 MiB 上限";
      fileController = null;
      return false;
    }
    readingAttachments.value = true;
    const controller = fileController;
    try {
      const attachments = await Promise.all(files.map(async file => ({ filename: file.name,
        contentType: file.type || "application/octet-stream", contentBase64: await read(file, controller.signal) })));
      if (!isCurrent(current) || fileRead !== fileVersion) return false;
      compose.attachments = attachments;
      hint.value = "";
      return true;
    } catch {
      controller.abort();
      if (!isCurrent(current) || fileRead !== fileVersion) return false;
      hint.value = "读取附件失败，请重新选择；此前附件未被移除。";
      return false;
    } finally {
      if (isCurrent(current) && fileRead === fileVersion) { readingAttachments.value = false; fileController = null; }
    }
  }

  function finishClose(): void { resetContent(); }
  function allowSendRetry(): void {
    if (!isOpen.value || sending.value || openingDraft.value) return;
    deliveryUnconfirmed.value = false; hint.value = "";
  }
  async function send(): Promise<{ outcome: SendResult; notice: string; context: Context } | null> {
    if (!isOpen.value || sending.value || openingDraft.value || readingAttachments.value || deliveryUnconfirmed.value) return null;
    const current = context();
    const payload: SendInput = { to: compose.to, cc: compose.cc, bcc: compose.bcc,
      subject: compose.subject, text: compose.text, attachments: compose.attachments.map(item => ({ ...item })),
      inReplyTo: compose.inReplyTo || undefined, references: [...compose.references] };
    sending.value = true;
    sendProgress.value = null;
    clearDraftTimer();
    hint.value = "";
    let outcome: SendResult;
    try {
      if (saveFlight?.generation === generation) await saveFlight.promise;
      if (!isCurrent(current)) return null;
      outcome = await sendMessage(payload, progress => {
        if (isCurrent(current) && sending.value) sendProgress.value = progress;
      });
    } catch (error) {
      if (!isCurrent(current)) return null;
      deliveryUnconfirmed.value = !(error instanceof ApiError) || error.status < 400 || error.status >= 500 || error.code === "invalid_response";
      hint.value = `${error instanceof ApiError ? error.message : "发送请求未能完成"}${deliveryUnconfirmed.value ? " 请先核对“已发送”或管理员记录，确认未投递后再重试。" : ""}`;
      sending.value = false;
      sendProgress.value = null;
      queueDraftSave();
      return null;
    }
    // A send may have committed. Never retry it or perform cleanup with a newer account's cookie.
    if (!isCurrent(current)) return null;
    let cleanupFailed = false;
    if (draftId.value) {
      try { await deleteDraft(draftId.value); } catch { cleanupFailed = true; }
    }
    if (!isCurrent(current)) return null;
    const notice = [!outcome.savedToSent ? "邮局已接受邮件，但未能写入“已发送”；不要直接重发，请联系管理员查看发送记录。" : "",
      cleanupFailed ? "邮件已交给邮局，但草稿清理失败；请到草稿列表手动删除，勿重复发送。" : ""].filter(Boolean).join(" ");
    finishClose();
    return { outcome, notice, context: context() };
  }
  return { owner, compose, mode, title, isOpen, sending, sendProgress, deliveryUnconfirmed, openingDraft, savingDraft, readingAttachments,
    hint, draftId, draftStatus, lastSavedSnapshot, dirty, needsLeaveWarning,
    context, isCurrent, bindOwner, clear, attach, detach, open, openDraft, persistDraft, selectFiles,
    hasContent, clearDraftTimer, finishClose, allowSendRetry, send };
});
