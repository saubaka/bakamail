import { defineStore } from "pinia";
import { ApiError, api, setCsrfToken } from "../api.ts";
import { useMailboxStore } from "./mailbox.ts";
import { useMessageStore } from "./message.ts";
import { useRealtimeStore } from "./realtime.ts";
import { useSearchStore } from "./search.ts";
import { SessionRequests } from "../auth/sessionRequests.ts";
import { useContactStore } from "./contacts.ts";
import { useComposeStore } from "./compose.ts";
import { usePreferenceStore } from "./preferences.ts";

type SessionResponse = {
  mailbox: string;
  domain: string;
  csrfToken: string;
  expiresAt: string;
  liveConnections: number;
  maxMessageBytes: number;
};

const requests = new WeakMap<object, SessionRequests<SessionResponse>>();
function runtime(store: object): SessionRequests<SessionResponse> {
  let value = requests.get(store);
  if (!value) { value = new SessionRequests(); requests.set(store, value); }
  return value;
}

export const useSessionStore = defineStore("mail-session", {
  state: () => ({
    mailbox: "",
    domain: "",
    expiresAt: "",
    liveConnections: 0,
    maxMessageBytes: 33_554_432,
    ready: false,
    loading: false,
  }),
  actions: {
    async restore(force = false): Promise<void> {
      const request = runtime(this);
      if (this.ready && !force && !request.pending) return;
      this.loading = true;
      await request.run((signal) => api<SessionResponse>("/api/auth/me", { signal }), (data) => {
        this.mailbox = data.mailbox;
        this.domain = data.domain;
        this.expiresAt = data.expiresAt;
        this.liveConnections = data.liveConnections;
        this.maxMessageBytes = data.maxMessageBytes;
        setCsrfToken(data.csrfToken);
        this.ready = true;
      }, () => { this.loading = false; }, force);
    },
    clear(): void {
      runtime(this).invalidate();
      setCsrfToken("");
      useRealtimeStore().stop();
      useMailboxStore().clear();
      useMessageStore().clear();
      useSearchStore().clear();
      useContactStore().clear();
      useComposeStore().clear();
      usePreferenceStore().clear();
      this.$reset();
    },
    async logout(all = false): Promise<void> {
      const generation = runtime(this).generation;
      try {
        await api(all ? "/api/auth/logout-all" : "/api/auth/logout", { method: "POST" });
      } catch (error) {
        // An expired session is already logged out; a transient server failure is not.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      if (runtime(this).generation === generation) this.clear();
    },
  },
});
