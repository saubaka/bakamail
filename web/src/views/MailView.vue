<template>
  <div class="mail-view-canvas">

    <Teleport to="#mail-folder-host" defer>
      <FolderRail
        :folders="folders"
        :current-folder="currentFolder"
        :current-folder-label="currentFolderLabel"
        :current-folder-meta="currentFolderMeta"
        :can-manage-folder="canManageFolder"
        :folder-busy="folderBusy || mailbox.cachedOnly || fetchingList"
        :navigation-busy="folderBusy"
        @create="createFolder"
        @select="selectFromMenu"
        @rename="renameFolder"
        @subscription="toggleFolderSubscription"
        @empty="emptyCurrentFolder"
        @remove="deleteCurrentFolder"
      />
    </Teleport>
    <main id="main-content" class="mail-shell" :class="shellClass" tabindex="-1">
      <MessageListPane
        :messages="messages"
        :current-uid="currentUid"
        :selected-uids="selectedUids"
        :current-folder-label="currentFolderLabel"
        :total="total"
        :loading="loadingList"
        :refreshing="fetchingList"
        :action-busy="actionBusy || mailbox.cachedOnly || fetchingList"
        :local-cache="mailbox.cachedOnly"
        :next-before="nextBefore"
        :time-format="mailSettings.timeFormat"
        :sync-error="pageError"
        @mark="markSelected"
        @archive="moveSelected('Archive')"
        @remove="deleteSelected()"
        @select="toggleSelect"
        @open="openMessage"
        @more="loadMore"
        @refresh="refreshAll"
      />

      <MessageReaderPane
        :detail="detail"
        :loading="loadingDetail"
        :action-busy="actionBusy"
        :current-folder="currentFolder"
        :remote-images="mailSettings.remoteImages"
        @back="mobileView = 'list'"
        @reply="(kind) => { if (detail) openCompose(detail, kind); }"
        @flag="toggleFlag"
        @archive="() => { if (detail) void moveSelected('Archive', [detail.uid]); }"
        @remove="() => { if (detail) void deleteSelected([detail.uid]); }"
        @read-scroll="(position) => workspace?.reportScroll(position, 'reader')"
      />
    </main>

    <ComposeDialog
      ref="composeDialog"
      :account="account"
      :signature="mailSettings.signature"
      :contacts="contacts"
      @sent="handleSent"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { beginProgressNotice, notify, type NoticeHandle } from "../notifications";
import { storeToRefs } from "pinia";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { workspaceKey, type WorkbenchActions } from "../mail/workspace";
import ComposeDialog from "../components/mail/ComposeDialog.vue";
import FolderRail from "../components/mail/FolderRail.vue";
import MessageListPane from "../components/mail/MessageListPane.vue";
import MessageReaderPane from "../components/mail/MessageReaderPane.vue";
import { ApiError, toast } from "../api";
import { SessionSupersededError } from "../auth/sessionRequests";
import { createFolder as createMailFolder, renameFolder as renameMailFolder, subscribeFolder,
  emptyFolder, removeFolder, moveMessages, deleteMessages, setMessageFlags } from "../api/mail";
import { confirmDialog, promptDialog } from "../dialog";
import { folderLabel, type MessageDetail } from "../mail/types";
import { useMailboxStore } from "../stores/mailbox";
import { useMessageStore } from "../stores/message";
import { useRealtimeStore } from "../stores/realtime";
import { useSessionStore } from "../stores/session";
import { useContactStore } from "../stores/contacts";
import { usePreferenceStore } from "../stores/preferences";

const router = useRouter();
const workspace = inject(workspaceKey);
const route = useRoute();
const session = useSessionStore();
const mailbox = useMailboxStore();
const message = useMessageStore();
const realtime = useRealtimeStore();
const contactStore = useContactStore();
const preferenceStore = usePreferenceStore();
const {
  account, folders, currentFolder, messages, nextBefore, total, selectedUids, loadingList, fetchingList,
  currentFolderMeta, currentFolderLabel, canManageFolder,
} = storeToRefs(mailbox);
const { currentUid, detail, loading: loadingDetail } = storeToRefs(message);
const { status: realtimeStatus, mailStatus } = storeToRefs(realtime);
const { contacts } = storeToRefs(contactStore);
const actionBusy = ref(false);
const logoutBusy = ref(false);
const pageError = ref("");
const sendNotice = ref("");
const folderBusy = ref(false);
const mobileView = ref<"folders" | "list" | "reader">("list");
const composeDialog = ref<InstanceType<typeof ComposeDialog> | null>(null);
const { settings: mailSettings } = storeToRefs(preferenceStore);
let workbenchActive = true;
const noticeScope = new AbortController();
let entryNotice: ReturnType<typeof beginProgressNotice> | undefined;
let readNotice: ReturnType<typeof beginProgressNotice> | undefined;
let errorNotice: NoticeHandle | undefined;
watch(pageError, error => {
  errorNotice?.dismiss(); errorNotice = undefined;
  if (error && workbenchActive) errorNotice = notify(error, 'warning', { signal: noticeScope.signal, action: { label: '重新同步', run: async () => { if (!workbenchActive) return; await refreshAll(); if (pageError.value) throw new Error('同步仍未完成，请稍后重试。'); } } });
});
watch(mobileView, value => { if (workspace) workspace.view.value = value === "reader" ? "reader" : "list"; });
watch(() => workspace?.view.value, value => { if (value) mobileView.value = value; });

const SHELL_CLASS: Record<string, boolean> = {};
const shellClass = computed(() => ({
  ...SHELL_CLASS,
  "is-reading": mobileView.value === "reader",
  "is-folders": mobileView.value === "folders",
  "is-compact": mailSettings.value.density === "compact",
}));
const liveLabel = computed(() => {
  if (realtimeStatus.value === "polling") return "定时更新";
  if (realtimeStatus.value === "reconnecting") return "实时连接重试中";
  if (realtimeStatus.value === "connecting") return "正在连接";
  if (realtimeStatus.value === "connected" && mailStatus.value === "reconnecting") return "邮局重连中";
  if (realtimeStatus.value === "connected" && mailStatus.value === "closed") return "邮局连接已关闭";
  if (realtimeStatus.value === "connected") return "实时更新";
  return "未连接";
});

async function loadSettings(): Promise<void> {
  await preferenceStore.load();
}

async function loadFolders(): Promise<void> {
  await mailbox.loadFolders();
}

async function loadMessages(reset = true): Promise<boolean> {
  try {
    const folder = currentFolder.value;
    let refreshed = await mailbox.loadMessages(mailSettings.value.pageSize, reset);
    // A confirmed write can invalidate an earlier read; retry/join its successor, not a failed mutation.
    if (!refreshed && reset && workbenchActive && folder === currentFolder.value) refreshed = await mailbox.loadMessages(mailSettings.value.pageSize, true);
    if (refreshed) pageError.value = "";
    return refreshed;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      session.clear();
      await router.replace({ name: "intro", query: { reason: "session", redirect: route.fullPath } });
      return false;
    }
    pageError.value = error instanceof ApiError ? error.message : "读取邮件列表失败";
    return false;
  }
}

async function loadMore(): Promise<void> {
  await loadMessages(false);
}

function clearReader(): void {
  readNotice?.cancel();
  message.clear();
}

async function selectFolder(path: string): Promise<void> {
  clearReader();
  mailbox.selectFolder(path, mailSettings.value.pageSize);
  mobileView.value = "list";
  await loadMessages(true);
}
async function selectFromMenu(path: string): Promise<void> { await workspace?.closeMenu(); await selectFolder(path); }

async function openMessage(uid: number): Promise<void> {
  if (mailbox.cachedOnly || fetchingList.value) { toast("正在核对邮箱，请稍后打开邮件", "warning"); return; }
  const folder = currentFolder.value;
  const mailboxAccount = account.value;
  mobileView.value = "reader";
  readNotice?.cancel();
  const notice = readNotice = beginProgressNotice('正在读取邮件…', { signal: noticeScope.signal });
  try {
    const data = await message.open(uid, folder);
    if (!data || folder !== currentFolder.value) { notice.cancel(); return; }
    notice.finish('邮件已打开');
    pageError.value = "";
    if (!data.seen) {
      try {
        await setFlags(folder, [uid], ["\\Seen"], "add");
        if (account.value !== mailboxAccount) return;
        mailbox.patchMessages(folder, [uid], { seen: true });
        if (workbenchActive) {
          void loadFolders().catch(() => {
            if (workbenchActive && account.value === mailboxAccount && folder === currentFolder.value) {
              pageError.value = "邮件已标为已读，但文件夹未读数刷新失败；请手动刷新。";
            }
          });
        }
        if (!message.isCurrent(uid, folder) || folder !== currentFolder.value) return;
        message.patch(uid, folder, { seen: true });
      } catch {
        if (message.isCurrent(uid, folder) && folder === currentFolder.value) {
          pageError.value = "邮件已打开，但自动标记已读失败；可返回列表手动标记。";
        }
      }
    }
  } catch (error) {
    notice.cancel();
    if (workbenchActive && folder === currentFolder.value) {
      notify(error instanceof ApiError ? error.message : '读取邮件失败，请重试', 'error', { signal: noticeScope.signal, action: { label: '重试读取', run: async () => { if (workbenchActive && folder === currentFolder.value) await openMessage(uid); } } });
    }
  }
}

async function setFlags(folder: string, uids: number[], flags: string[], mode: "add" | "remove" | "set"): Promise<void> {
  await setMessageFlags(folder, uids, flags, mode);
}

async function markSelected(read: boolean): Promise<void> {
  if (actionBusy.value || mailbox.cachedOnly || fetchingList.value) return;
  const folder = currentFolder.value;
  const mailboxAccount = account.value;
  const uids = [...selectedUids.value];
  if (uids.length === 0) return;
  actionBusy.value = true;
  try {
    await setFlags(folder, uids, ["\\Seen"], read ? "add" : "remove");
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "标记邮件失败，请重试", "error");
    return;
  } finally {
    actionBusy.value = false;
  }
  if (account.value !== mailboxAccount) return;
  mailbox.patchMessages(folder, uids, { seen: read });
  if (!workbenchActive) return;
  if (folder === currentFolder.value) selectedUids.value = [];
  const refreshed = await refreshAfterMessageWrite(folder);
  if (!workbenchActive || account.value !== mailboxAccount) return;
  toast(refreshed ? (read ? "已标记为已读" : "已标记为未读") : "标记已完成，但邮箱刷新失败；当前状态已保留", refreshed ? "success" : "warning");
}

async function refreshAfterMessageWrite(folder: string): Promise<boolean> {
  const refreshCurrentList = folder === currentFolder.value;
  const [listResult, folderResult] = await Promise.allSettled([
    refreshCurrentList ? loadMessages(true) : Promise.resolve(true),
    loadFolders(),
  ]);
  if (!workbenchActive) return false;
  const listOk = !refreshCurrentList || folder !== currentFolder.value || (listResult.status === "fulfilled" && listResult.value);
  const foldersOk = folderResult.status === "fulfilled";
  if (!foldersOk) {
    const reason = folderResult.reason;
    pageError.value = reason instanceof ApiError ? `邮件操作已完成，文件夹统计刷新失败：${reason.message}` : "邮件操作已完成，但文件夹统计刷新失败";
  } else if (!listOk && !pageError.value) {
    pageError.value = "邮件操作已完成，但列表刷新失败";
  }
  return listOk && foldersOk;
}

async function moveSelected(target: string, uids?: number[]): Promise<void> {
  if (actionBusy.value || mailbox.cachedOnly || fetchingList.value) return;
  const folder = currentFolder.value;
  const mailboxAccount = account.value;
  const list = [...(uids ?? selectedUids.value)];
  if (list.length === 0) return;
  actionBusy.value = true;
  try {
    await moveMessages(folder, list, target);
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "移动邮件失败，请重试", "error");
    return;
  } finally {
    actionBusy.value = false;
  }
  if (account.value !== mailboxAccount) return;
  mailbox.removeMessages(folder, list);
  if (!workbenchActive) return;
  if (folder === currentFolder.value && currentUid.value !== null && list.includes(currentUid.value)) {
    clearReader();
    mobileView.value = "list";
  }
  const refreshed = await refreshAfterMessageWrite(folder);
  if (!workbenchActive || account.value !== mailboxAccount) return;
  if (refreshed) toast(target === 'Archive' ? '已归档' : `已移动到 ${target}`);
}

async function deleteSelected(uids?: number[]): Promise<void> {
  if (actionBusy.value || mailbox.cachedOnly || fetchingList.value) return;
  const folder = currentFolder.value;
  const mailboxAccount = account.value;
  const permanent = currentFolderMeta.value?.specialUse === "\\Trash" || folder === "Trash";
  const list = [...(uids ?? selectedUids.value)];
  if (list.length === 0) return;
  actionBusy.value = true;
  try {
    if (permanent && !(await confirmDialog({
      title: "彻底删除邮件",
      message: `将永久删除 ${list.length} 封邮件，删除后无法恢复。`,
      confirmLabel: "彻底删除",
      tone: "danger",
    }))) return;
    await deleteMessages(folder, list, permanent);
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "删除邮件失败，请重试", "error");
    return;
  } finally {
    actionBusy.value = false;
  }
  if (account.value !== mailboxAccount) return;
  mailbox.removeMessages(folder, list);
  if (!workbenchActive) return;
  if (folder === currentFolder.value && currentUid.value !== null && list.includes(currentUid.value)) {
    clearReader();
    mobileView.value = "list";
  }
  const refreshed = await refreshAfterMessageWrite(folder);
  if (!workbenchActive || account.value !== mailboxAccount) return;
  const label = permanent ? "已彻底删除" : "已移入垃圾箱";
  if (refreshed) toast(label);
}

async function toggleFlag(): Promise<void> {
  if (actionBusy.value) return;
  const active = detail.value;
  if (!active) return;
  const folder = currentFolder.value;
  const mailboxAccount = account.value;
  const next = !active.flagged;
  actionBusy.value = true;
  try {
    await setFlags(folder, [active.uid], ["\\Flagged"], next ? "add" : "remove");
    if (account.value !== mailboxAccount) return;
    mailbox.patchMessages(folder, [active.uid], { flagged: next });
    if (detail.value?.uid !== active.uid || folder !== currentFolder.value) return;
    message.patch(active.uid, folder, { flagged: next });
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "星标操作失败，请重试", "error");
  } finally {
    actionBusy.value = false;
  }
}

function toggleSelect(uid: number): void {
  mailbox.toggleSelect(uid);
}

function openCompose(source?: MessageDetail, kind: "reply" | "reply-all" | "forward" = "reply", initialTo = ""): void {
  sendNotice.value = "";
  composeDialog.value?.open(source, kind, initialTo);
}

async function openDraft(id: string): Promise<void> {
  await composeDialog.value?.openDraft(id);
}

async function handleSent(notice: string): Promise<void> {
  sendNotice.value = ''; // Compose already publishes the delivery notice; do not duplicate it.
  const [listResult, folderResult] = await Promise.allSettled([loadMessages(true), loadFolders()]);
  if (listResult.status !== "fulfilled" || !listResult.value || folderResult.status !== "fulfilled") {
    pageError.value = "邮件已发送，但邮箱刷新失败；可手动刷新确认最新状态。";
  }
}

async function refreshAfterFolderWrite(refreshList: boolean): Promise<boolean> {
  const [folderResult, listResult] = await Promise.allSettled([
    loadFolders(),
    refreshList ? loadMessages(true) : Promise.resolve(true),
  ]);
  if (!workbenchActive) return false;
  const foldersOk = folderResult.status === "fulfilled";
  const listOk = listResult.status === "fulfilled" && listResult.value;
  if (!foldersOk || !listOk) {
    pageError.value = "文件夹操作已完成，但邮箱刷新失败；当前操作结果已保留，可手动刷新。";
  }
  return foldersOk && listOk;
}
async function prepareFolderAction(): Promise<boolean> {
  if (folderBusy.value || mailbox.cachedOnly || fetchingList.value) return false;
  await workspace?.closeMenu();
  return workbenchActive && !folderBusy.value && !mailbox.cachedOnly && !fetchingList.value;
}
async function createFolder(): Promise<void> {
  if (!await prepareFolderAction()) return;
  const mailboxAccount = account.value;
  const name = await promptDialog({
    title: "新建文件夹",
    message: "输入一个便于识别的文件夹名称。最终是否可创建由邮局服务确认。",
    fieldLabel: "文件夹名称",
    placeholder: "例如 项目归档",
    confirmLabel: "创建文件夹",
  });
  if (!name || !workbenchActive || account.value !== mailboxAccount) return;
  folderBusy.value = true;
  try {
    await createMailFolder(name.trim());
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "创建失败", "error");
    folderBusy.value = false;
    return;
  }
  if (!workbenchActive || account.value !== mailboxAccount) {
    folderBusy.value = false;
    return;
  }
  mailbox.acknowledgeFolderCreated(name.trim());
  const refreshed = await refreshAfterFolderWrite(false);
  if (workbenchActive && account.value === mailboxAccount) {
    toast(refreshed ? "文件夹已创建" : "文件夹已创建，但刷新失败；新文件夹已保留", refreshed ? "success" : "warning");
  }
  folderBusy.value = false;
}

async function renameFolder(): Promise<void> {
  if (!canManageFolder.value || !await prepareFolderAction()) return;
  const from = currentFolder.value;
  const mailboxAccount = account.value;
  const name = await promptDialog({
    title: "重命名文件夹",
    message: "新名称会同步到邮局中的文件夹。",
    fieldLabel: "新名称",
    initialValue: currentFolderMeta.value?.name ?? from,
    confirmLabel: "重命名",
  });
  if (!name || name.trim() === from || !workbenchActive || account.value !== mailboxAccount) return;
  folderBusy.value = true;
  try {
    await renameMailFolder(from, name.trim());
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "重命名失败", "error");
    folderBusy.value = false;
    return;
  }
  if (workbenchActive && account.value === mailboxAccount) {
    mailbox.acknowledgeFolderRenamed(from, name.trim(), mailSettings.value.pageSize);
    clearReader();
    const refreshed = await refreshAfterFolderWrite(true);
    if (workbenchActive && account.value === mailboxAccount) {
      toast(refreshed ? "文件夹已重命名" : "文件夹已重命名，但刷新失败；新名称已保留", refreshed ? "success" : "warning");
    }
  }
  folderBusy.value = false;
}

async function toggleFolderSubscription(): Promise<void> {
  if (!await prepareFolderAction()) return;
  const folder = currentFolderMeta.value;
  if (!folder) return;
  const mailboxAccount = account.value;
  folderBusy.value = true;
  try {
    await subscribeFolder(folder.path, !folder.subscribed);
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "订阅操作失败", "error");
    folderBusy.value = false;
    return;
  }
  if (workbenchActive && account.value === mailboxAccount) {
    mailbox.acknowledgeFolderSubscription(folder.path, !folder.subscribed);
    const refreshed = await refreshAfterFolderWrite(false);
    if (workbenchActive && account.value === mailboxAccount) {
      const label = folder.subscribed ? "已取消订阅" : "已订阅文件夹";
      toast(refreshed ? label : `${label}，但刷新失败；当前状态已保留`, refreshed ? "success" : "warning");
    }
  }
  folderBusy.value = false;
}

async function emptyCurrentFolder(): Promise<void> {
  if (!await prepareFolderAction()) return;
  const folder = currentFolderMeta.value;
  if (!folder || folder.messages === 0) return;
  const mailboxAccount = account.value;
  if (!(await confirmDialog({
    title: "清空文件夹",
    message: `将永久删除“${folderLabel(folder)}”中的 ${folder.messages} 封邮件，无法恢复。`,
    confirmLabel: "永久清空",
    tone: "danger",
    requiredText: folder.path,
  }))) return;
  if (!workbenchActive || account.value !== mailboxAccount) return;
  folderBusy.value = true;
  let removed: number;
  try {
    const result = await emptyFolder(folder.path);
    removed = result.removed;
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "清空失败", "error");
    folderBusy.value = false;
    return;
  }
  if (workbenchActive && account.value === mailboxAccount) {
    mailbox.acknowledgeFolderEmptied(folder.path, mailSettings.value.pageSize);
    clearReader();
    const refreshed = await refreshAfterFolderWrite(true);
    if (workbenchActive && account.value === mailboxAccount) {
      const label = `已清空 ${removed} 封邮件`;
      toast(refreshed ? label : `${label}，但刷新失败；当前列表已清空`, refreshed ? "success" : "warning");
    }
  }
  folderBusy.value = false;
}

async function deleteCurrentFolder(): Promise<void> {
  if (!await prepareFolderAction()) return;
  const folder = currentFolderMeta.value;
  if (!folder || !canManageFolder.value) return;
  const mailboxAccount = account.value;
  if (!(await confirmDialog({
    title: "删除文件夹",
    message: `将删除“${folder.path}”及其中的邮件，无法恢复。`,
    confirmLabel: "删除文件夹",
    tone: "danger",
    requiredText: folder.path,
  }))) return;
  if (!workbenchActive || account.value !== mailboxAccount) return;
  folderBusy.value = true;
  try {
    await removeFolder(folder.path);
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "删除失败", "error");
    folderBusy.value = false;
    return;
  }
  if (workbenchActive && account.value === mailboxAccount) {
    mailbox.acknowledgeFolderDeleted(folder.path, mailSettings.value.pageSize);
    clearReader();
    const refreshed = await refreshAfterFolderWrite(true);
    if (workbenchActive && account.value === mailboxAccount) {
      toast(refreshed ? "文件夹已删除" : "文件夹已删除，但刷新失败；已返回收件箱", refreshed ? "success" : "warning");
    }
  }
  folderBusy.value = false;
}

async function refreshAll(): Promise<void> {
  try {
    const [folderResult, listResult] = await Promise.allSettled([loadFolders(), loadMessages(true)]);
    if (folderResult.status === "fulfilled" && listResult.status === "fulfilled" && listResult.value) {
      pageError.value = "";
      toast("已刷新");
    } else if (!pageError.value) {
      pageError.value = folderResult.status === "rejected" && folderResult.reason instanceof ApiError
        ? folderResult.reason.message : "刷新失败";
    }
  } catch (error) {
    pageError.value = error instanceof ApiError ? error.message : "刷新失败";
  }
}

async function logout(): Promise<void> {
  if (logoutBusy.value) return;
  if (!(await composeDialog.value?.confirmLeave() ?? true)) return;
  logoutBusy.value = true;
  try {
    await session.logout();
    await router.push("/");
  } catch (error) {
    toast(error instanceof ApiError ? error.message : "退出失败，请重试", "error");
  } finally {
    logoutBusy.value = false;
  }
}

async function refreshFromEvent(): Promise<void> {
  if (!workbenchActive) return;
  try {
    await Promise.all([loadFolders(), mailbox.loadMessages(mailSettings.value.pageSize, true)]);
  } catch (error) {
    if (workbenchActive) pageError.value = error instanceof ApiError ? error.message : "邮件状态刷新失败";
    if (workbenchActive && error instanceof ApiError && error.status === 401) {
      session.clear();
      await router.replace({ name: "intro", query: { reason: "session", redirect: route.fullPath } });
    }
    throw error;
  }
}

onMounted(async () => {
  if (workspace) workspace.actions.value = workbenchActions;
  try {
    await session.restore();
    if (!workbenchActive) return;
    mailbox.restoreLocal(session.mailbox, mailSettings.value.pageSize);
    const initialFolder = typeof route.query.folder === "string" ? route.query.folder : "";
    if (initialFolder) mailbox.selectFolder(initialFolder, mailSettings.value.pageSize);
    entryNotice = beginProgressNotice(undefined, { signal: noticeScope.signal });
    contactStore.bindOwner(session.mailbox);
    preferenceStore.bindOwner(session.mailbox);
    await loadFolders();
    void contactStore.load().catch(() => {
      if (workbenchActive) toast("联系人暂时无法读取，仍可手动输入收件地址", "warning");
    });
    await loadSettings().catch(() => {
      if (workbenchActive) toast("偏好设置暂时无法读取，已使用上次确认的设置或默认显示", "warning");
    });
    if (!workbenchActive) return;
    const requestedFolder = typeof route.query.folder === "string" ? route.query.folder : "";
    if (requestedFolder && folders.value.some((item) => item.path === requestedFolder)) {
      mailbox.selectFolder(requestedFolder, mailSettings.value.pageSize);
    }
    const loaded = await loadMessages(true);
    entryNotice.finish(loaded ? `邮件已同步 · ${total.value} 封` : "同步暂未完成，已保留本地列表", loaded ? "success" : "warning");
    if (!workbenchActive) return;
    const requestedUid = Number.parseInt(String(route.query.uid ?? ""), 10);
    if (Number.isFinite(requestedUid)) await openMessage(requestedUid);
    if (!workbenchActive) return;
    if (typeof route.query.draft === "string") await openDraft(route.query.draft);
    else if (route.query.compose === "new") {
      openCompose(undefined, "reply", typeof route.query.to === "string" ? route.query.to : "");
    }
    realtime.start(refreshFromEvent);
  } catch (error) {
    entryNotice?.finish("暂时无法拉取邮件，已保留本地列表", "warning");
    if (error instanceof SessionSupersededError) return;
    if (!workbenchActive) return;
    if (error instanceof ApiError && error.status === 401) await router.replace({ name: "intro", query: { reason: "session", redirect: route.fullPath } });
    else pageError.value = error instanceof ApiError ? error.message : "邮箱暂时无法加载，请重试";
  }
});

onBeforeUnmount(() => {
  noticeScope.abort();
  entryNotice?.cancel();
  readNotice?.cancel();
  errorNotice?.dismiss();
  if (workspace?.actions.value === workbenchActions) workspace.actions.value = null;
  workbenchActive = false;
  realtime.stop();
  preferenceStore.suspend();
  mailbox.suspend();
  message.clear();
});

onBeforeRouteLeave(() => composeDialog.value?.confirmLeave() ?? true);

const workbenchActions: WorkbenchActions = { compose: () => openCompose(), refresh: refreshAll, logout, liveLabel, logoutBusy, readerAvailable: computed(() => currentUid.value !== null) };
</script>

<style scoped>
.mail-row__line input[type="checkbox"] {
  margin: 0;
}
</style>
