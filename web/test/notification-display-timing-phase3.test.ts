import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationDisplayTimer, type NotificationDisplayClock } from '../src/notificationDisplayTiming.ts';
import { waitForNoticeTransition } from '../src/notificationTiming.ts';

function clock() {
  let time = 0, id = 0, scheduled = 0;
  const jobs = new Map<number, { deadline: number; callback: () => void }>();
  const source: NotificationDisplayClock = { now: () => time,
    setTimeout(callback, ms) { const token = ++id; scheduled++; jobs.set(token, { deadline: time + ms, callback }); return token; },
    clearTimeout(token) { jobs.delete(token as number); } };
  return { source, jobs, get scheduled() { return scheduled; },
    tick(ms: number) {
      const end = time + ms;
      while (jobs.size) {
        const next = [...jobs].sort((a, b) => a[1].deadline - b[1].deadline)[0]!;
        if (next[1].deadline > end) break;
        time = next[1].deadline; jobs.delete(next[0]); next[1].callback();
      }
      time = end;
    } };
}

test('单调可注入计时：多暂停原因并集，最后解除后精确恢复不足一秒', () => {
  const c = clock(); let expired = 0; const timer = createNotificationDisplayTimer(() => expired++, c.source);
  timer.setReasons(['enter']); timer.reset(1000); c.tick(5000); assert.equal(timer.inspect().remainingMs, 1000);
  timer.setReasons([]); c.tick(750); timer.setReasons(['hover', 'focus']);
  c.tick(10000); timer.setReasons(['focus']); c.tick(10000);
  assert.equal(expired, 0); assert.equal(timer.inspect().remainingMs, 250); assert.equal(c.jobs.size, 0);
  timer.setReasons([]); c.tick(249); assert.equal(expired, 0); c.tick(1); assert.equal(expired, 1);
  timer.setReasons(['hidden']); timer.setReasons([]); c.tick(10000); assert.equal(expired, 1); timer.dispose();
});

test('重复激活不重置倒计时或重建timer；同一时间仅有一个预约', () => {
  const c = clock(); let expired = 0; const timer = createNotificationDisplayTimer(() => expired++, c.source);
  timer.reset(120000); c.tick(119950);
  for (let i = 0; i < 10; i++) timer.setReasons([]);
  assert.equal(c.scheduled, 1); assert.equal(c.jobs.size, 1); assert.equal(timer.inspect().remainingMs, 50);
  timer.setReasons(['background']); timer.setReasons(['background']); assert.equal(c.jobs.size, 0);
  timer.setReasons([]); assert.equal(c.jobs.size, 1); c.tick(50); assert.equal(expired, 1);
});

test('切换显示策略独立重置，manual无timer；dispose幂等并阻止再次启动', () => {
  const c = clock(); let expired = 0; const timer = createNotificationDisplayTimer(() => expired++, c.source);
  timer.reset(1000); c.tick(900); timer.setReasons(['text']); timer.reset(8000);
  assert.equal(timer.inspect().remainingMs, 8000); assert.equal(c.jobs.size, 0);
  timer.setReasons([]); c.tick(7999); assert.equal(expired, 0);
  timer.reset(null); assert.equal(timer.inspect().remainingMs, null); c.tick(999999); assert.equal(expired, 0);
  timer.reset(1000); timer.dispose(); timer.dispose(); timer.reset(1000); timer.setReasons([]);
  c.tick(10000); assert.equal(c.jobs.size, 0); assert.equal(expired, 0); assert.equal(timer.inspect().disposed, true);
});

test('系统日期调整不影响注入的单调时钟；暂停时原预约被取消', ctx => {
  ctx.mock.timers.enable({ apis: ['Date'] }); const c = clock(); let expired = 0;
  const timer = createNotificationDisplayTimer(() => expired++, c.source); timer.reset(1000);
  ctx.mock.timers.setTime(999999999999); c.tick(200); timer.setReasons(['hidden']);
  ctx.mock.timers.setTime(1); c.tick(100000); assert.equal(timer.inspect().remainingMs, 800);
  timer.setReasons([]); c.tick(800); assert.equal(expired, 1);
});

test('取消后的旧timeout即使迟到也不能清零新策略或重复触发到期', () => {
  let time = 0, expired = 0; const callbacks: (() => void)[] = [];
  const source: NotificationDisplayClock = { now: () => time,
    setTimeout(callback) { callbacks.push(callback); return callbacks.length; }, clearTimeout() {} };
  const timer = createNotificationDisplayTimer(() => expired++, source);
  timer.reset(1000); time = 500; timer.reset(2000); callbacks[0]!();
  assert.equal(timer.inspect().remainingMs, 2000); assert.equal(expired, 0);
  timer.setReasons(['hover']); callbacks[1]!(); assert.equal(timer.inspect().remainingMs, 2000); assert.equal(expired, 0);
  timer.setReasons([]); time = 2500; callbacks[2]!(); callbacks[2]!(); assert.equal(expired, 1);
  timer.dispose(); callbacks[0]!(); assert.equal(expired, 1);
});

test('堆叠transform终态事件优先，其他属性不结束暂停；最长兜底/取消/0ms均有界', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] }); const wrapper = new EventTarget(); let completed = 0;
  const event = (propertyName: string) => { const e = new Event('transitionend'); Object.defineProperty(e, 'propertyName', { value: propertyName }); wrapper.dispatchEvent(e); };
  const first = waitForNoticeTransition(wrapper, 1500, () => completed++);
  event('opacity'); assert.equal(completed, 0); event('transform'); first.finish(); assert.equal(completed, 1);
  waitForNoticeTransition(wrapper, 1500, () => completed++); ctx.mock.timers.tick(1547); assert.equal(completed, 1);
  ctx.mock.timers.tick(1); assert.equal(completed, 2);
  const canceled = waitForNoticeTransition(wrapper, 100, () => completed++); canceled.cancel(); event('transform'); ctx.mock.timers.tick(148); assert.equal(completed, 2);
  const zero = waitForNoticeTransition(wrapper, 0, () => completed++); zero.cancel(); await Promise.resolve(); assert.equal(completed, 2);
  waitForNoticeTransition(wrapper, 0, () => completed++); await Promise.resolve(); assert.equal(completed, 3);
});
