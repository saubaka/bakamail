import { reactive } from "vue";

export type DemoTab = "inbox" | "draft";
export type DemoTone = "blue" | "pink" | "warm";
export type DemoMark = { viewBox: string; d: string };
export type DemoMail = { id: string; sender: string; tone: DemoTone; mark: DemoMark; subject: string; note: string };
export type DemoRow = { key: string; mail: DemoMail; code: string; time: string; unread: boolean; fresh: boolean };
export type DemoScheduler = { set(callback: () => void, ms: number): unknown; clear(token: unknown): void };
export type DemoPause = "hover" | "focus" | "hidden" | "offscreen" | "manual";

export const DEMO_VISIBLE_ROWS = 3;
export const DRAFT_DEMO = { to: "小树", subject: "周末计划", body: "小树：\n写到一半可以先存成草稿，下次打开接着写。", attachment: "照片.zip", size: "2.4 MB" } as const;
export const TYPE_START_MS = 520;
export const TYPE_STEP_MS = 70;
export const TYPE_PAUSE_MS = 220;
export const MANUAL_HOLD_MS = 9000;

export const SENDER_MARKS: Record<"microsoft" | "google" | "openai", DemoMark> = {
  microsoft: { viewBox: "0 0 23 23", d: "M1 1h10v10H1zM12 1h10v10H12zM1 12h10v10H1zM12 12h10v10H12z" },
  google: { viewBox: "0 0 48 48", d: "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5zM46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65zM10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19zM24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" },
  openai: { viewBox: "0 0 24 24", d: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" },
};

export const DEMO_MAILS: readonly DemoMail[] = [
  { id: "microsoft", sender: "Microsoft", tone: "blue", mark: SENDER_MARKS.microsoft, subject: "Microsoft account security code", note: "Use this code to verify your account." },
  { id: "google", sender: "Google", tone: "pink", mark: SENDER_MARKS.google, subject: "Your Google verification code", note: "Don't share this code with anyone." },
  { id: "openai", sender: "OpenAI", tone: "warm", mark: SENDER_MARKS.openai, subject: "Your OpenAI verification code", note: "This code expires in 10 minutes." },
];
export const INITIAL_CODES = ["739154", "582104", "482913"] as const;

export function demoCode(seed: number): string {
  let value = (seed * 2654435761 + 97531) >>> 0;
  value ^= value >>> 13; value = Math.imul(value, 1274126177) >>> 0;
  return String(100000 + (value % 900000));
}
export const spacedCode = (code: string) => code.replace(/(\d{3})(?=\d)/, "$1 ");

export function typingDuration(text: string): number {
  let total = TYPE_START_MS;
  for (const char of text) total += TYPE_STEP_MS + (/[，。！？：\n]/.test(char) ? TYPE_PAUSE_MS : 0);
  return total;
}

const clock = (minutes: number) => {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
};

const browserScheduler: DemoScheduler = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: token => clearTimeout(token as ReturnType<typeof setTimeout>),
};

export function createMailDemo(options: { scheduler?: DemoScheduler } = {}) {
  const scheduler = options.scheduler ?? browserScheduler;
  let minutes = 9 * 60 + 41, sequence = 0;
  const initial: DemoRow[] = DEMO_MAILS.map((mail, index) => ({ key: `${mail.id}-0`, mail, code: INITIAL_CODES[index]!,
    time: [clock(minutes), "09:12", "昨天"][index]!, unread: false, fresh: false }));
  const state = reactive({
    tab: "inbox" as DemoTab,
    rows: initial,
    selected: initial[0]!.key,
    reading: { ...initial[0]! } as DemoRow,
    typed: [...DRAFT_DEMO.body].length,
    saved: true,
    still: false,
  });
  const pauses = new Set<DemoPause>();
  const timers = new Map<string, unknown>();
  let step = 0, disposed = false, started = false;

  function later(key: string, ms: number, run: () => void) {
    cancel(key);
    timers.set(key, scheduler.set(() => { timers.delete(key); if (!disposed) run(); }, ms));
  }
  function cancel(key: string) {
    if (!timers.has(key)) return;
    scheduler.clear(timers.get(key)); timers.delete(key);
  }

  function arrive() {
    const oldest = state.rows.at(-1);
    if (!oldest) return;
    minutes += 3; sequence += 1;
    state.rows.unshift({ key: `${oldest.mail.id}-${sequence}`, mail: oldest.mail, code: demoCode(sequence), time: clock(minutes), unread: true, fresh: true });
    later("trim", 900, () => { state.rows.splice(DEMO_VISIBLE_ROWS); });
    later("fresh", 1800, () => { for (const row of state.rows) row.fresh = false; });
  }
  function open(key: string) {
    const row = state.rows.find(item => item.key === key);
    if (!row) return;
    state.selected = key; row.unread = false; state.reading = { ...row };
  }
  function type() {
    const text = [...DRAFT_DEMO.body];
    if (state.typed >= text.length) { later("type", 480, () => { state.saved = true; }); return; }
    const char = text[state.typed]!;
    later("type", TYPE_STEP_MS + (/[，。！？：\n]/.test(char) ? TYPE_PAUSE_MS : 0), () => { state.typed += 1; type(); });
  }
  function showTab(tab: DemoTab) {
    const changed = state.tab !== tab;
    state.tab = tab;
    if (tab !== "draft" || !changed) return;
    if (state.still) { cancel("type"); state.typed = [...DRAFT_DEMO.body].length; state.saved = true; return; }
    state.typed = 0; state.saved = false;
    later("type", TYPE_START_MS, type);
  }

  const steps: { wait: () => number; run: () => void }[] = [
    { wait: () => 1600, run: arrive },
    { wait: () => 1900, run: () => { const first = state.rows[0]; if (first) open(first.key); } },
    { wait: () => 3200, run: () => showTab("draft") },
    { wait: () => typingDuration(DRAFT_DEMO.body) + 2600, run: () => showTab("inbox") },
  ];
  function schedule() {
    cancel("step");
    if (disposed || !started || state.still || pauses.size) return;
    const current = steps[step]!;
    later("step", current.wait(), () => {
      step = (step + 1) % steps.length;
      current.run();
      schedule();
    });
  }

  return {
    state,
    start() { started = true; schedule(); },
    setPaused(reason: DemoPause, paused: boolean) {
      const had = pauses.has(reason);
      if (paused) pauses.add(reason); else pauses.delete(reason);
      if (had !== paused) schedule();
    },
    setStill(still: boolean) {
      if (state.still === still) return;
      state.still = still;
      if (still) {
        cancel("type"); cancel("fresh"); cancel("trim");
        state.rows.splice(DEMO_VISIBLE_ROWS);
        for (const row of state.rows) row.fresh = false;
        state.typed = [...DRAFT_DEMO.body].length; state.saved = true;
      }
      schedule();
    },
    chooseTab(tab: DemoTab) {
      pauses.add("manual"); later("manual", MANUAL_HOLD_MS, () => { pauses.delete("manual"); schedule(); });
      if (tab === "inbox" && step === 3) step = 0;
      if (tab === "draft" && step < 3) step = 3;
      showTab(tab); schedule();
    },
    chooseMail(key: string) {
      pauses.add("manual"); later("manual", MANUAL_HOLD_MS, () => { pauses.delete("manual"); schedule(); });
      open(key); if (step === 1) step = 2; schedule();
    },
    dispose() { disposed = true; for (const token of timers.values()) scheduler.clear(token); timers.clear(); },
    inspect: () => ({ step, pauses: [...pauses], timers: [...timers.keys()] }),
  };
}
