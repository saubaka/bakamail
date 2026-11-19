import { reactive } from "vue";

export type DemoTab = "inbox" | "draft";
export type DemoTone = "blue" | "pink" | "warm";
export type DemoMail = { id: string; sender: string; tone: DemoTone; subject: string; body: string };
export type DemoRow = { mail: DemoMail; time: string; unread: boolean; fresh: boolean };
export type DemoScheduler = { set(callback: () => void, ms: number): unknown; clear(token: unknown): void };
export type DemoPause = "hover" | "focus" | "hidden" | "offscreen" | "manual";

export const DEMO_VISIBLE_ROWS = 3;
export const DRAFT_DEMO = { to: "小树", subject: "周末计划", body: "小树：\n写到一半可以先存成草稿，下次打开接着写。", attachment: "照片.zip", size: "2.4 MB" } as const;
export const TYPE_START_MS = 520;
export const TYPE_STEP_MS = 70;
export const TYPE_PAUSE_MS = 220;
export const MANUAL_HOLD_MS = 9000;

export function demoMails(siteName: string): DemoMail[] {
  return [
    { id: "welcome", sender: siteName, tone: "blue", subject: `欢迎使用 ${siteName}`, body: "喵？" },
    { id: "exhibit", sender: "小树", tone: "pink", subject: "周末一起看展吗？", body: "周六下午有空吗？听说新开的插画展很好看。" },
    { id: "meeting", sender: "阿岚", tone: "warm", subject: "例会改到周三", body: "这周例会挪到周三上午十点，地点不变。" },
    { id: "photos", sender: "妈妈", tone: "pink", subject: "照片都发你啦", body: "上次出去玩拍的照片都在附件里，记得备份一下。" },
  ];
}

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

export function createMailDemo(options: { siteName: string; scheduler?: DemoScheduler }) {
  const scheduler = options.scheduler ?? browserScheduler;
  const mails = demoMails(options.siteName);
  let minutes = 9 * 60 + 41;
  const state = reactive({
    tab: "inbox" as DemoTab,
    rows: [
      { mail: mails[0]!, time: clock(minutes), unread: false, fresh: false },
      { mail: mails[1]!, time: "09:12", unread: false, fresh: false },
      { mail: mails[2]!, time: "昨天", unread: false, fresh: false },
    ] as DemoRow[],
    selected: mails[0]!.id,
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
    const present = new Set(state.rows.map(row => row.mail.id));
    const next = mails.find(mail => !present.has(mail.id));
    if (!next) return;
    minutes += 3;
    state.rows.unshift({ mail: next, time: clock(minutes), unread: true, fresh: true });
    later("trim", 900, () => { state.rows.splice(DEMO_VISIBLE_ROWS); });
    later("fresh", 1800, () => { for (const row of state.rows) row.fresh = false; });
  }
  function open(id: string) {
    const row = state.rows.find(item => item.mail.id === id);
    if (!row) return;
    state.selected = id; row.unread = false;
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
    { wait: () => 1900, run: () => { const first = state.rows[0]; if (first) open(first.mail.id); } },
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
    chooseMail(id: string) {
      pauses.add("manual"); later("manual", MANUAL_HOLD_MS, () => { pauses.delete("manual"); schedule(); });
      open(id); if (step === 1) step = 2; schedule();
    },
    dispose() { disposed = true; for (const token of timers.values()) scheduler.clear(token); timers.clear(); },
    inspect: () => ({ step, pauses: [...pauses], timers: [...timers.keys()] }),
  };
}
