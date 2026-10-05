import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { useRealtimeStore, type RealtimeRuntime, type RealtimeStream } from "../src/stores/realtime.ts";

function fixture() {
  let now = 0;
  let hidden = false;
  let nextTimer = 0;
  let visibilityChange: (() => void) | null = null;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const listeners = new Map<string, Array<(event: Event) => void>>();
  const stream: RealtimeStream = {
    onerror: null,
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) ?? []), callback]);
    },
    close() {},
  };
  const runtime: RealtimeRuntime = {
    now: () => now,
    createStream: () => stream,
    setInterval: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: (timer) => { timers.delete(timer as unknown as number); },
    isHidden: () => hidden,
    onVisibilityChange: (callback) => {
      visibilityChange = callback;
      return () => { visibilityChange = null; };
    },
  };
  return {
    runtime,
    stream,
    timers,
    setNow(value: number) { now = value; },
    setHidden(value: boolean) { hidden = value; visibilityChange?.(); },
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) listener(new Event(type));
    },
    tick(delay: number) {
      for (const timer of [...timers.values()]) if (timer.delay === delay) timer.callback();
    },
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("exists 和 expunge 都刷新，但并发事件只排队一次", async () => {
  setActivePinia(createPinia());
  const store = useRealtimeStore();
  const env = fixture();
  let count = 0;
  let finishFirst: (() => void) | undefined;
  store.start(() => {
    count += 1;
    if (count === 1) return new Promise<void>((resolve) => { finishFirst = resolve; });
    return Promise.resolve();
  }, env.runtime);
  env.emit("ready");
  assert.equal(store.status, "connected");
  env.emit("exists");
  env.emit("expunge");
  env.emit("exists");
  assert.equal(count, 1);
  finishFirst?.();
  await flush();
  assert.equal(count, 2);
  store.stop();
  assert.equal(env.timers.size, 0);
});

test("心跳超时进入轮询，心跳恢复后停止轮询", async () => {
  setActivePinia(createPinia());
  const store = useRealtimeStore();
  const env = fixture();
  let count = 0;
  store.start(async () => { count += 1; }, env.runtime);
  env.setNow(61_000);
  env.tick(15_000);
  assert.equal(store.status, "polling");
  assert.equal(count, 1);
  assert.equal([...env.timers.values()].filter((timer) => timer.delay === 30_000).length, 1);
  env.emit("ping");
  assert.equal(store.status, "connected");
  assert.equal([...env.timers.values()].filter((timer) => timer.delay === 30_000).length, 0);
  store.stop();
});

test("后台标签页错过事件后，重新可见时只补一次刷新", async () => {
  setActivePinia(createPinia());
  const store = useRealtimeStore();
  const env = fixture();
  let count = 0;
  store.start(async () => { count += 1; }, env.runtime);
  env.setHidden(true);
  env.emit("exists");
  env.emit("expunge");
  assert.equal(count, 0);
  env.setHidden(false);
  await flush();
  assert.equal(count, 1);
  store.stop();
});

test("停止后旧流迟到的事件不能恢复状态或触发刷新", () => {
  setActivePinia(createPinia());
  const store = useRealtimeStore();
  const env = fixture();
  let count = 0;
  store.start(async () => { count += 1; }, env.runtime);
  store.stop();
  env.emit("ready");
  env.emit("exists");
  assert.equal(store.status, "stopped");
  assert.equal(count, 0);
  assert.equal(env.timers.size, 0);
});
