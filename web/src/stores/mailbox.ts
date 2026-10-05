import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { listFolders, listMessages, type MessagePage } from "../api/mail.ts";
import { folderLabel, type Folder, type MessageSummary } from "../mail/types.ts";
import { ApiError } from "../api.ts";
import { purgeMailCaches, readMailCache, writeMailCache } from "../mail/localCache.ts";

/** Folder pages survive route changes, but never a mailbox-account change. */
export const useMailboxStore = defineStore("mailbox", () => {
  const account = ref("");
  const folders = ref<Folder[]>([]);
  const currentFolder = ref("INBOX");
  const messages = ref<MessageSummary[]>([]);
  const nextBefore = ref<number | null>(null);
  const total = ref(0);
  const selectedUids = ref<number[]>([]);
  const loadingList = ref(false);
  const fetchingList = ref(false);
  const cachedOnly = ref(false);
  const restoredLocal = ref(false);
  const snapshots = new Map<string, MessagePage>();
  let listGeneration = 0;
  let folderGeneration = 0;
  let refreshFlight: { generation: number; folder: string; pageSize: string; promise: Promise<boolean> } | undefined;

  function persist(): void {
    if (!account.value) return;
    writeMailCache({ version: 1, owner: account.value, savedAt: Date.now(), folder: currentFolder.value,
      folders: folders.value, pages: [...snapshots.entries()].slice(-12).map(([key, page]) => [key, { ...page, items: page.items.slice(0, 500),
        nextBefore: page.items.length > 500 ? page.items[499]!.uid : page.nextBefore }]) });
  }
  /** Called only after server authentication. Local storage is not an identity source. */
  function restoreLocal(owner: string, pageSize: string): boolean {
    if (!owner) return false;
    if (account.value && account.value !== owner) clear();
    account.value = owner;
    if (snapshots.size) {
      restoredLocal.value = showSnapshot(currentFolder.value, pageSize);
      cachedOnly.value = restoredLocal.value;
      return restoredLocal.value;
    }
    const cache = readMailCache(owner);
    if (!cache) return false;
    folders.value = cache.folders;
    currentFolder.value = cache.folders.some(folder => folder.path === cache.folder) ? cache.folder : "INBOX";
    cache.pages.forEach(([key, page]) => snapshots.set(key, page));
    restoredLocal.value = showSnapshot(currentFolder.value, pageSize);
    cachedOnly.value = restoredLocal.value;
    return restoredLocal.value;
  }

  const currentFolderMeta = computed(() => folders.value.find((folder) => folder.path === currentFolder.value));
  const currentFolderLabel = computed(() => currentFolderMeta.value ? folderLabel(currentFolderMeta.value) : currentFolder.value);
  const canManageFolder = computed(() => Boolean(
    currentFolderMeta.value &&
    !currentFolderMeta.value.specialUse &&
    currentFolderMeta.value.path.toUpperCase() !== "INBOX",
  ));

  function cacheKey(folder: string, pageSize: string): string {
    return `${folder}\u0000${pageSize}`;
  }

  function showSnapshot(folder: string, pageSize: string): boolean {
    let snapshot = snapshots.get(cacheKey(folder, pageSize));
    if (!snapshot) {
      const fallback = [...snapshots].find(([key]) => key.startsWith(`${folder}\u0000`))?.[1];
      if (fallback) {
        const count = Number(pageSize) || 50;
        snapshot = { ...fallback, items: fallback.items.slice(0, count), nextBefore: fallback.items.length > count ? fallback.items[count - 1]!.uid : fallback.nextBefore };
        snapshots.set(cacheKey(folder, pageSize), snapshot);
      }
    }
    messages.value = snapshot?.items ?? [];
    nextBefore.value = snapshot?.nextBefore ?? null;
    total.value = snapshot?.total ?? 0;
    return Boolean(snapshot);
  }

  function clear(): void {
    purgeMailCaches();
    listGeneration += 1;
    folderGeneration += 1;
    account.value = "";
    folders.value = [];
    currentFolder.value = "INBOX";
    messages.value = [];
    nextBefore.value = null;
    total.value = 0;
    selectedUids.value = [];
    loadingList.value = false;
    fetchingList.value = false;
    snapshots.clear();
    cachedOnly.value = false;
    restoredLocal.value = false;
  }

  async function loadFolders(): Promise<void> {
    const generation = ++folderGeneration;
    const data = await listFolders();
    if (generation !== folderGeneration) return;
    if (account.value && account.value !== data.account) clear();
    folders.value = data.folders;
    account.value = data.account;
    persist();
  }

  /** Apply a confirmed folder write before any follow-up read can fail or arrive late. */
  function acknowledgeFolderCreated(path: string): void {
    folderGeneration += 1;
    if (!folders.value.some((folder) => folder.path === path)) {
      folders.value = [...folders.value, {
        path, name: path.split("/").at(-1) ?? path, specialUse: null,
        subscribed: false, messages: 0, unseen: 0,
      }];
    }
    persist();
  }

  function acknowledgeFolderRenamed(from: string, to: string, pageSize: string): void {
    folderGeneration += 1;
    folders.value = folders.value.map((folder) => folder.path === from
      ? { ...folder, path: to, name: to.split("/").at(-1) ?? to }
      : folder);
    for (const key of snapshots.keys()) {
      if (key.startsWith(`${from}\u0000`) || key.startsWith(`${to}\u0000`)) snapshots.delete(key);
    }
    if (currentFolder.value === from) selectFolder(to, pageSize);
    persist();
  }

  function acknowledgeFolderSubscription(path: string, subscribed: boolean): void {
    folderGeneration += 1;
    folders.value = folders.value.map((folder) => folder.path === path
      ? { ...folder, subscribed }
      : folder);
    persist();
  }

  function acknowledgeFolderEmptied(path: string, pageSize: string): void {
    folderGeneration += 1;
    folders.value = folders.value.map((folder) => folder.path === path
      ? { ...folder, messages: 0, unseen: 0 }
      : folder);
    for (const key of snapshots.keys()) if (key.startsWith(`${path}\u0000`)) snapshots.delete(key);
    if (currentFolder.value === path) selectFolder(path, pageSize);
    persist();
  }

  function acknowledgeFolderDeleted(path: string, pageSize: string): void {
    folderGeneration += 1;
    folders.value = folders.value.filter((folder) => folder.path !== path);
    for (const key of snapshots.keys()) if (key.startsWith(`${path}\u0000`)) snapshots.delete(key);
    if (currentFolder.value === path) selectFolder("INBOX", pageSize);
    persist();
  }

  /** Keep snapshots across routes, but ignore any request from the old workbench. */
  function suspend(): void {
    persist();
    listGeneration += 1;
    folderGeneration += 1;
    loadingList.value = false;
    fetchingList.value = false;
  }

  function selectFolder(path: string, pageSize: string): void {
    listGeneration += 1;
    loadingList.value = false;
    fetchingList.value = false;
    currentFolder.value = path;
    selectedUids.value = [];
    showSnapshot(path, pageSize);
    cachedOnly.value = messages.value.length > 0;
    persist();
  }

  function loadMessages(pageSize: string, reset = true): Promise<boolean> {
    // SSE expunge/exists and a confirmed write can request the same page at once.
    // Join that read instead of invalidating it and misreporting cancellation as failure.
    if (reset && refreshFlight?.generation === listGeneration && refreshFlight.folder === currentFolder.value && refreshFlight.pageSize === pageSize) return refreshFlight.promise;
    const promise = readMessagePage(pageSize, reset);
    if (reset) {
      const flight = { generation: listGeneration, folder: currentFolder.value, pageSize, promise };
      refreshFlight = flight;
      void promise.then(() => { if (refreshFlight === flight) refreshFlight = undefined; }, () => { if (refreshFlight === flight) refreshFlight = undefined; });
    }
    return promise;
  }

  async function readMessagePage(pageSize: string, reset = true): Promise<boolean> {
    if (!reset && fetchingList.value) return false;
    const before = reset ? null : nextBefore.value;
    if (!reset && before === null) return false;
    const generation = ++listGeneration;
    const folder = currentFolder.value;
    const cached = reset && showSnapshot(folder, pageSize);
    loadingList.value = !cached;
    fetchingList.value = true;
    try {
      const data = await listMessages(folder, pageSize, before);
      if (generation !== listGeneration || folder !== currentFolder.value) return false;
      const page = {
        items: reset ? data.items : [...messages.value, ...data.items],
        nextBefore: data.nextBefore,
        total: data.total,
      };
      snapshots.set(cacheKey(folder, pageSize), page);
      if (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value!);
      messages.value = page.items;
      nextBefore.value = page.nextBefore;
      total.value = page.total;
      cachedOnly.value = false;
      persist();
      return true;
    } catch (error) {
      if (generation === listGeneration && folder === currentFolder.value) {
        if (error instanceof ApiError && error.status === 401) clear();
        throw error;
      }
      return false;
    } finally {
      if (generation === listGeneration) {
        loadingList.value = false;
        fetchingList.value = false;
      }
    }
  }

  function toggleSelect(uid: number): void {
    selectedUids.value = selectedUids.value.includes(uid)
      ? selectedUids.value.filter((item) => item !== uid)
      : [...selectedUids.value, uid];
  }

  /** Apply an acknowledged write to every page-size snapshot, then ignore older in-flight reads. */
  function patchMessages(folder: string, uids: number[], patch: Partial<Pick<MessageSummary, "seen" | "flagged">>): void {
    const ids = new Set(uids);
    if (ids.size === 0) return;
    const update = (items: MessageSummary[]): MessageSummary[] =>
      items.map((item) => ids.has(item.uid) ? { ...item, ...patch } : item);
    for (const [key, page] of snapshots) {
      if (key.startsWith(`${folder}\u0000`)) page.items = update(page.items);
    }
    if (currentFolder.value === folder) {
      listGeneration += 1;
      loadingList.value = false;
      fetchingList.value = false;
      messages.value = update(messages.value);
    }
    persist();
  }

  /** A successful move/delete must not resurrect rows from a cached or late list response. */
  function removeMessages(folder: string, uids: number[]): void {
    const ids = new Set(uids);
    if (ids.size === 0) return;
    for (const [key, page] of snapshots) {
      if (!key.startsWith(`${folder}\u0000`)) continue;
      page.items = page.items.filter((item) => !ids.has(item.uid));
      page.total = Math.max(0, page.total - ids.size);
    }
    if (currentFolder.value === folder) {
      listGeneration += 1;
      loadingList.value = false;
      fetchingList.value = false;
      messages.value = messages.value.filter((item) => !ids.has(item.uid));
      total.value = Math.max(0, total.value - ids.size);
      selectedUids.value = selectedUids.value.filter((uid) => !ids.has(uid));
    }
    persist();
  }

  return {
    account, folders, currentFolder, messages, nextBefore, total, selectedUids, loadingList, fetchingList, cachedOnly, restoredLocal,
    currentFolderMeta, currentFolderLabel, canManageFolder,
    clear, suspend, loadFolders, selectFolder, loadMessages, toggleSelect, patchMessages, removeMessages, restoreLocal,
    acknowledgeFolderCreated, acknowledgeFolderRenamed, acknowledgeFolderSubscription,
    acknowledgeFolderEmptied, acknowledgeFolderDeleted,
  };
});
