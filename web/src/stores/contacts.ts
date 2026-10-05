import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError } from "../api/client.ts";
import { deleteContact, listContacts, saveContact, type Contact, type ContactInput } from "../api/contacts.ts";

type ContactContext = { owner: string; version: number };

/** Account-owned address book shared by the editor and recipient completion. */
export const useContactStore = defineStore("mail-contacts", () => {
  const owner = ref("");
  const contacts = ref<Contact[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const loadError = ref("");
  const stale = ref(false);
  const saving = ref(false);
  const removingId = ref<number | null>(null);
  let version = 0;
  let readVersion = 0;
  let controller: AbortController | null = null;

  function context(): ContactContext { return { owner: owner.value, version }; }
  function isCurrent(value: ContactContext): boolean {
    return Boolean(value.owner) && value.owner === owner.value && value.version === version;
  }
  function suspend(): void {
    readVersion += 1;
    controller?.abort();
    controller = null;
    loading.value = false;
  }
  function clear(): void {
    version += 1;
    suspend();
    owner.value = "";
    contacts.value = [];
    loaded.value = false;
    loadError.value = "";
    stale.value = false;
    saving.value = false;
    removingId.value = null;
  }
  function bindOwner(mailbox: string): void {
    const normalized = mailbox.trim().toLowerCase();
    if (normalized === owner.value) return;
    clear();
    owner.value = normalized;
  }
  function requireOwner(): ContactContext {
    const value = context();
    if (!value.owner) throw new ApiError("请先登录邮箱", 401, null);
    return value;
  }
  function requireIdle(): void {
    if (saving.value || removingId.value !== null) throw new ApiError("联系人操作正在进行，请稍候", 409, null);
  }

  async function load(): Promise<boolean> {
    const current = requireOwner();
    // A pre-commit GET must never be applied after the write. The caller retries after completion.
    if (saving.value || removingId.value !== null) return false;
    suspend();
    const read = readVersion;
    controller = new AbortController();
    loading.value = true;
    loadError.value = "";
    try {
      const data = await listContacts(controller.signal);
      if (!isCurrent(current) || read !== readVersion) return false;
      contacts.value = data.contacts;
      loaded.value = true;
      stale.value = false;
      return true;
    } catch (error) {
      if (!isCurrent(current) || read !== readVersion) return false;
      stale.value = true;
      loadError.value = error instanceof ApiError ? error.message : "联系人暂时无法读取，请稍后重试";
      throw error;
    } finally {
      if (isCurrent(current) && read === readVersion) { controller = null; loading.value = false; }
    }
  }

  async function save(input: ContactInput, id: number | null = null): Promise<boolean> {
    const current = requireOwner();
    requireIdle();
    saving.value = true;
    suspend();
    // Own the payload; edits after submission cannot change a confirmed result.
    const payload = { ...input };
    try {
      const { contact } = await saveContact(payload, id);
      if (!isCurrent(current)) return false;
      suspend();
      contacts.value = [...contacts.value.filter((row) => row.id !== contact.id), contact]
        .sort((left, right) => left.name.localeCompare(right.name));
      stale.value = true;
      return true;
    } catch (error) {
      if (!isCurrent(current)) return false;
      throw error;
    } finally {
      if (isCurrent(current)) saving.value = false;
    }
  }

  async function remove(id: number): Promise<boolean> {
    const current = requireOwner();
    requireIdle();
    removingId.value = id;
    suspend();
    try {
      await deleteContact(id);
      if (!isCurrent(current)) return false;
      suspend();
      contacts.value = contacts.value.filter((row) => row.id !== id);
      stale.value = true;
      return true;
    } catch (error) {
      if (!isCurrent(current)) return false;
      throw error;
    } finally {
      if (isCurrent(current)) removingId.value = null;
    }
  }
  return { owner, contacts, loading, loaded, loadError, stale, saving, removingId,
    context, isCurrent, bindOwner, clear, suspend, load, save, remove };
});
