import { defineStore } from "pinia";
import { ref } from "vue";
import { searchMessages, type SearchInput } from "../api/mail.ts";
import type { MessageSummary } from "../mail/types.ts";

/** Results own their folder: an edited form must never change the meaning of an old UID. */
export const useSearchStore = defineStore("mail-search", () => {
  const results = ref<MessageSummary[]>([]);
  const resultFolder = ref("");
  const searched = ref(false);
  const loading = ref(false);
  let generation = 0;
  let controller: AbortController | null = null;

  function clear(): void {
    generation += 1;
    controller?.abort();
    controller = null;
    results.value = [];
    resultFolder.value = "";
    searched.value = false;
    loading.value = false;
  }

  async function run(input: SearchInput): Promise<boolean> {
    const request = ++generation;
    controller?.abort();
    controller = new AbortController();
    const folder = input.folder;
    loading.value = true;
    try {
      const data = await searchMessages({ ...input }, controller.signal);
      if (request !== generation) return false;
      results.value = data.items;
      resultFolder.value = folder;
      searched.value = true;
      return true;
    } catch (error) {
      if (request !== generation) return false;
      throw error;
    } finally {
      if (request === generation) { controller = null; loading.value = false; }
    }
  }

  function target(uid: number): { folder: string; uid: string } {
    if (!resultFolder.value || !results.value.some((row) => row.uid === uid)) throw new TypeError("搜索结果已失效，请重新搜索");
    return { folder: resultFolder.value, uid: String(uid) };
  }
  return { results, resultFolder, searched, loading, run, target, clear };
});
