import { defineStore } from "pinia";
import { ref } from "vue";
import { readMessage } from "../api/mail.ts";
import type { MessageDetail } from "../mail/types.ts";

/** The reader owns only the active message; folder pages live in useMailboxStore. */
export const useMessageStore = defineStore("message", () => {
  const currentUid = ref<number | null>(null);
  const currentFolder = ref("");
  const detail = ref<MessageDetail | null>(null);
  const loading = ref(false);
  let generation = 0;

  function isCurrent(uid: number, folder: string): boolean {
    return currentUid.value === uid && currentFolder.value === folder;
  }

  function clear(): void {
    generation += 1;
    currentUid.value = null;
    currentFolder.value = "";
    detail.value = null;
    loading.value = false;
  }

  async function open(uid: number, folder: string): Promise<MessageDetail | null> {
    const requestGeneration = ++generation;
    currentUid.value = uid;
    currentFolder.value = folder;
    detail.value = null;
    loading.value = true;
    try {
      const data = await readMessage(uid, folder);
      if (requestGeneration !== generation || !isCurrent(uid, folder)) return null;
      detail.value = data;
      return data;
    } catch (error) {
      if (requestGeneration !== generation || !isCurrent(uid, folder)) return null;
      currentUid.value = null;
      currentFolder.value = "";
      throw error;
    } finally {
      if (requestGeneration === generation) loading.value = false;
    }
  }

  function patch(uid: number, folder: string, changes: Partial<Pick<MessageDetail, "seen" | "flagged">>): void {
    if (!isCurrent(uid, folder) || !detail.value) return;
    Object.assign(detail.value, changes);
  }

  return { currentUid, currentFolder, detail, loading, isCurrent, clear, open, patch };
});
