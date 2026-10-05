import { defineStore } from "pinia";
import { ApiError, api, setCsrfToken } from "../api.ts";
import { SessionRequests } from "../auth/sessionRequests.ts";

type AdminMe = {
  username: string;
  displayName: string;
  role: "superadmin" | "admin" | "auditor";
  permissions: string[];
  csrfToken: string;
  runner: string;
  statsAvailable: boolean;
};

const requests = new WeakMap<object, SessionRequests<AdminMe>>();
function runtime(store: object): SessionRequests<AdminMe> {
  let value = requests.get(store);
  if (!value) { value = new SessionRequests(); requests.set(store, value); }
  return value;
}

export const useAdminSessionStore = defineStore("admin-session", {
  state: () => ({
    me: null as AdminMe | null,
    initialized: false,
    loading: false,
  }),
  getters: {
    can: (state) => (permission: string): boolean =>
      Boolean(state.me?.permissions.includes("*") || state.me?.permissions.includes(permission)),
  },
  actions: {
    async restore(force = false): Promise<AdminMe> {
      const request = runtime(this);
      if (this.me && !force && !request.pending) return this.me;
      this.loading = true;
      return request.run((signal) => api<AdminMe>("/api/admin/auth/me", { signal }), (me) => {
        this.me = me;
        this.initialized = true;
        setCsrfToken(me.csrfToken, "admin");
      }, () => {
        this.loading = false;
        this.initialized = true;
      }, force);
    },
    clear(): void {
      runtime(this).invalidate();
      this.me = null;
      this.initialized = true;
      this.loading = false;
      setCsrfToken("", "admin");
    },
    async logout(): Promise<void> {
      const generation = runtime(this).generation;
      try {
        await api("/api/admin/auth/logout", { method: "POST" });
      } catch (error) {
        // An expired or revoked session is already logged out. Transient failures are not.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      if (runtime(this).generation === generation) this.clear();
    },
  },
});
