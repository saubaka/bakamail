import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createMailDemo, DRAFT_DEMO, MANUAL_HOLD_MS, TYPE_START_MS, typingDuration, type DemoScheduler } from "../src/intro/mailDemo.ts";

function fakeScheduler() {
  let now = 0, id = 0;
  const tasks = new Map<number, { at: number; run: () => void }>();
  const scheduler: DemoScheduler & { advance(ms: number): void; size(): number } = {
    set(run, ms) { tasks.set(++id, { at: now + ms, run }); return id; },
    clear(token) { tasks.delete(token as number); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: [number, { at: number; run: () => void }] | undefined;
        for (const entry of tasks) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        tasks.delete(next[0]); now = next[1].at; next[1].run();
      }
      now = end;
    },
    size: () => tasks.size,
  };
  return scheduler;
}
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("初始：三封示例邮件，欢迎邮件选中且正文保持“喵？”，草稿完整", () => {
  const demo = createMailDemo({ siteName: "示例站", scheduler: fakeScheduler() });
  assert.deepEqual(demo.state.rows.map(row => row.mail.id), ["welcome", "exhibit", "meeting"]);
  assert.equal(demo.state.rows[0]!.mail.subject, "欢迎使用 示例站");
  assert.equal(demo.state.rows[0]!.mail.body, "喵？");
  assert.equal(demo.state.selected, "welcome");
  assert.equal(demo.state.typed, [...DRAFT_DEMO.body].length);
  assert.match(DRAFT_DEMO.body, /写到一半可以先存成草稿，下次打开接着写。/);
});

test("自动播放：新邮件到达→打开→切到草稿逐字输入→保存→回到收件箱，循环时轮换未出现的邮件", () => {
  const clock = fakeScheduler();
  const demo = createMailDemo({ siteName: "示例站", scheduler: clock });
  demo.start();
  clock.advance(1600);
  assert.equal(demo.state.rows[0]!.mail.id, "photos");
  assert.ok(demo.state.rows[0]!.unread && demo.state.rows[0]!.fresh);
  assert.equal(demo.state.rows[0]!.time, "09:44");
  clock.advance(900);
  assert.equal(demo.state.rows.length, 3);
  clock.advance(1000);
  assert.equal(demo.state.selected, "photos");
  assert.equal(demo.state.rows[0]!.unread, false);
  clock.advance(3200);
  assert.equal(demo.state.tab, "draft");
  assert.equal(demo.state.typed, 0); assert.equal(demo.state.saved, false);
  clock.advance(TYPE_START_MS + 200);
  assert.ok(demo.state.typed > 0 && demo.state.typed < [...DRAFT_DEMO.body].length);
  clock.advance(typingDuration(DRAFT_DEMO.body));
  assert.equal(demo.state.typed, [...DRAFT_DEMO.body].length); assert.equal(demo.state.saved, true);
  clock.advance(2600);
  assert.equal(demo.state.tab, "inbox");
  clock.advance(1600);
  assert.equal(demo.state.rows[0]!.mail.id, "meeting");
  assert.equal(demo.state.rows[0]!.time, "09:47");
  demo.dispose(); assert.equal(clock.size(), 0);
});

test("悬停、键盘焦点、页面隐藏、移出视口都会暂停，全部解除后继续", () => {
  const clock = fakeScheduler();
  const demo = createMailDemo({ siteName: "示例站", scheduler: clock });
  demo.start();
  for (const reason of ["hover", "focus", "hidden", "offscreen"] as const) {
    demo.setPaused(reason, true); clock.advance(20000);
    assert.equal(demo.state.rows[0]!.mail.id, "welcome", reason);
    demo.setPaused(reason, false);
  }
  clock.advance(1600);
  assert.equal(demo.state.rows[0]!.mail.id, "photos");
});

test("手动操作立即生效并暂停自动播放一段时间；减少动态时不自动播放、草稿直接完整", () => {
  const clock = fakeScheduler();
  const demo = createMailDemo({ siteName: "示例站", scheduler: clock });
  demo.start();
  demo.chooseMail("meeting");
  assert.equal(demo.state.selected, "meeting");
  clock.advance(MANUAL_HOLD_MS - 1);
  assert.equal(demo.state.rows[0]!.mail.id, "welcome");
  clock.advance(1 + 1600);
  assert.equal(demo.state.rows[0]!.mail.id, "photos");
  demo.chooseTab("draft");
  assert.equal(demo.state.tab, "draft"); assert.equal(demo.state.typed, 0);

  const still = createMailDemo({ siteName: "示例站", scheduler: fakeScheduler() });
  still.setStill(true); still.start();
  still.chooseTab("draft");
  assert.equal(still.state.typed, [...DRAFT_DEMO.body].length); assert.equal(still.state.saved, true);
  assert.deepEqual(still.inspect().timers, ["manual"]);
});

test("演示组件不使用图片，暂停条件接入悬停/键盘焦点/可见性/视口，样式有减少动态的静态版", () => {
  const view = source("components/IntroMailDemo.vue"), css = source("styles/intro.css");
  assert.doesNotMatch(view, /<svg|<img/);
  assert.match(view, /active\.matches\(":focus-visible"\)/);
  assert.match(view, /demo\.setPaused\("hidden", document\.hidden\)/);
  assert.match(view, /new IntersectionObserver\(\(\[entry\]\) => demo\.setPaused\("offscreen"/);
  assert.match(view, /<span class="sr-only">\{\{ draft\.body \}\}<\/span>/);
  assert.match(css, /\.intro-demo-list \{ --row-h: 60px; height: calc\(var\(--row-h\) \* 3\);[^}]*overflow: hidden/);
  assert.match(css, /\.intro-demo\[data-tab="draft"\] \.intro-demo-thumb \{ transform: translateX\(100%\); \}/);
  assert.match(css, /\.intro-demo\.is-still :is\(/);
  assert.match(source("views/IntroView.vue"), /<IntroMailDemo \/>/);
});
