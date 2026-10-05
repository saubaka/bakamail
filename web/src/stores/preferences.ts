import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError } from "../api/client.ts";
import { DEFAULT_MAIL_PREFERENCES, normalizeMailPreferences, readMailSettings,
  saveMailSettings, type MailPreferences } from "../api/settings.ts";

type Context = { owner: string; generation: number };

/** One account-owned confirmed preference snapshot shared by Settings and MailView. */
export const usePreferenceStore = defineStore("mail-preferences", () => {
  const owner = ref("");
  const settings = ref<MailPreferences>({ ...DEFAULT_MAIL_PREFERENCES });
  const loaded = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const stale = ref(false);
  const loadError = ref("");
  let generation = 0;
  let readGeneration = 0;
  let controller: AbortController | null = null;

  function context(): Context { return { owner: owner.value, generation }; }
  function isCurrent(value: Context): boolean {
    return Boolean(value.owner) && value.owner === owner.value && value.generation === generation;
  }
  function suspend(): void {
    readGeneration += 1;
    controller?.abort();
    controller = null;
    loading.value = false;
  }
  function clear(): void {
    generation += 1;
    suspend();
    owner.value = "";
    settings.value = { ...DEFAULT_MAIL_PREFERENCES };
    loaded.value = false;
    saving.value = false;
    stale.value = false;
    loadError.value = "";
  }
  function bindOwner(mailbox: string): void {
    const normalized = mailbox.trim().toLowerCase();
    if (normalized === owner.value) return;
    clear();
    owner.value = normalized;
  }
  function requireOwner(): Context {
    const current = context();
    if (!current.owner) throw new ApiError("请先登录邮箱", 401, null);
    return current;
  }

  async function load(): Promise<boolean> {
    const current = requireOwner();
    // Never let a pre-write read replace a confirmed write with older values.
    if (saving.value) return false;
    suspend();
    const read = readGeneration;
    const signal = new AbortController();
    controller = signal;
    loading.value = true;
    loadError.value = "";
    try {
      const data = await readMailSettings(signal.signal);
      if (!isCurrent(current) || read !== readGeneration) return false;
      if (!data || !data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) {
        throw new ApiError("设置响应格式不正确", 200, null, { code: "invalid_response" });
      }
      settings.value = normalizeMailPreferences(data.settings);
      loaded.value = true;
      stale.value = false;
      return true;
    } catch (error) {
      if (!isCurrent(current) || read !== readGeneration) return false;
      stale.value = true;
      loadError.value = error instanceof ApiError ? error.message : "设置暂时无法读取，请稍后重试";
      throw error;
    } finally {
      if (isCurrent(current) && read === readGeneration) { controller = null; loading.value = false; }
    }
  }

  async function save(input: MailPreferences): Promise<boolean> {
    const current = requireOwner();
    if (!loaded.value) throw new ApiError("请先读取邮箱设置", 409, null);
    if (stale.value) throw new ApiError("设置状态待核对，请重新读取后再保存", 409, null);
    if (saving.value) throw new ApiError("设置正在保存，请稍候", 409, null);
    const payload = { ...input };
    saving.value = true;
    suspend();
    try {
      const result = await saveMailSettings(payload);
      if (!isCurrent(current)) return false;
      if (!result || result.saved !== true) {
        throw new ApiError("设置保存结果未确认，请重新读取后核对", 200, null, { code: "invalid_response" });
      }
      settings.value = normalizeMailPreferences(payload);
      loaded.value = true;
      stale.value = false;
      loadError.value = "";
      return true;
    } catch (error) {
      if (!isCurrent(current)) return false;
      stale.value = true;
      throw error;
    } finally {
      if (isCurrent(current)) saving.value = false;
    }
  }

  return { owner, settings, loaded, loading, saving, stale, loadError,
    context, isCurrent, bindOwner, suspend, clear, load, save };
});
