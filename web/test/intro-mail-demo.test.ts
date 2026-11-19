import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createMailDemo, demoCode, DEMO_MAILS, DRAFT_DEMO, MANUAL_HOLD_MS, spacedCode, TYPE_START_MS, typingDuration, type DemoScheduler } from "../src/intro/mailDemo.ts";

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

test("初始：Microsoft、Google、OpenAI 三封英文验证码邮件，第一封选中并显示验证码，草稿完整", () => {
  const demo = createMailDemo({ scheduler: fakeScheduler() });
  assert.deepEqual(demo.state.rows.map(row => row.mail.sender), ["Microsoft", "Google", "OpenAI"]);
  for (const mail of DEMO_MAILS) assert.match(mail.subject + mail.note, /^[\x20-\x7e]+$/, "邮件内容为英文");
  assert.ok(DEMO_MAILS.every(mail => /code/i.test(mail.subject)));
  assert.deepEqual(demo.state.rows.map(row => row.code), ["739154", "582104", "482913"]);
  assert.equal(demo.state.selected, "microsoft-0");
  assert.equal(demo.state.reading.code, "739154");
  assert.equal(spacedCode("739154"), "739 154");
  for (const mail of DEMO_MAILS) { assert.match(mail.mark.viewBox, /^0 0 \d+ \d+$/); assert.match(mail.mark.d, /^M[\d.\s]/); assert.doesNotMatch(mail.mark.d, /#|fill/); }
  assert.equal(demo.state.typed, [...DRAFT_DEMO.body].length);
  assert.match(DRAFT_DEMO.body, /写到一半可以先存成草稿，下次打开接着写。/);
});

test("自动播放：最旧的发件人发来新验证码→打开→切到草稿逐字输入→保存→回到收件箱，三家轮流", () => {
  const clock = fakeScheduler();
  const demo = createMailDemo({ scheduler: clock });
  demo.start();
  clock.advance(1600);
  assert.equal(demo.state.rows[0]!.mail.id, "openai");
  assert.equal(demo.state.rows[0]!.code, demoCode(1));
  assert.match(demo.state.rows[0]!.code, /^\d{6}$/);
  assert.ok(demo.state.rows[0]!.unread && demo.state.rows[0]!.fresh);
  assert.equal(demo.state.rows[0]!.time, "09:44");
  clock.advance(900);
  assert.deepEqual(demo.state.rows.map(row => row.mail.id), ["openai", "microsoft", "google"]);
  assert.equal(new Set(demo.state.rows.map(row => row.key)).size, 3);
  clock.advance(1000);
  assert.equal(demo.state.selected, "openai-1");
  assert.equal(demo.state.reading.code, demoCode(1));
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
  assert.equal(demo.state.rows[0]!.mail.id, "google");
  assert.equal(demo.state.rows[0]!.time, "09:47");
  assert.notEqual(demo.state.rows[0]!.code, "582104");
  demo.dispose(); assert.equal(clock.size(), 0);
});

test("悬停、键盘焦点、页面隐藏、移出视口都会暂停，全部解除后继续", () => {
  const clock = fakeScheduler();
  const demo = createMailDemo({ scheduler: clock });
  demo.start();
  for (const reason of ["hover", "focus", "hidden", "offscreen"] as const) {
    demo.setPaused(reason, true); clock.advance(20000);
    assert.equal(demo.state.rows[0]!.mail.id, "microsoft", reason);
    demo.setPaused(reason, false);
  }
  clock.advance(1600);
  assert.equal(demo.state.rows[0]!.mail.id, "openai");
});

test("手动操作立即生效并暂停自动播放一段时间；减少动态时不自动播放、草稿直接完整", () => {
  const clock = fakeScheduler();
  const demo = createMailDemo({ scheduler: clock });
  demo.start();
  demo.chooseMail("openai-0");
  assert.equal(demo.state.selected, "openai-0");
  assert.equal(demo.state.reading.mail.sender, "OpenAI");
  clock.advance(MANUAL_HOLD_MS - 1);
  assert.equal(demo.state.rows[0]!.mail.id, "microsoft");
  clock.advance(1 + 1600);
  assert.equal(demo.state.rows[0]!.mail.id, "openai");
  demo.chooseTab("draft");
  assert.equal(demo.state.tab, "draft"); assert.equal(demo.state.typed, 0);

  const still = createMailDemo({ scheduler: fakeScheduler() });
  still.setStill(true); still.start();
  still.chooseTab("draft");
  assert.equal(still.state.typed, [...DRAFT_DEMO.body].length); assert.equal(still.state.saved, true);
  assert.deepEqual(still.inspect().timers, ["manual"]);
});

test("演示组件不使用图片文件，发件人头像为跟随主题色的单色图形，暂停条件接入悬停/键盘焦点/可见性/视口，样式有减少动态的静态版", () => {
  const view = source("components/IntroMailDemo.vue"), css = source("styles/intro.css");
  assert.doesNotMatch(view, /<img/);
  assert.match(view, /<span class="intro-demo-avatar" :data-tone="row\.mail\.tone" aria-hidden="true"><svg class="intro-demo-mark" :viewBox="row\.mail\.mark\.viewBox" focusable="false"><path :d="row\.mail\.mark\.d" fill="currentColor" \/><\/svg><\/span>/);
  assert.doesNotMatch(view, /fill="#/);
  assert.match(css, /\.intro-demo-avatar \{[^}]*color: var\(--ink\);/);
  assert.match(view, /active\.matches\(":focus-visible"\)/);
  assert.match(view, /demo\.setPaused\("hidden", document\.hidden\)/);
  assert.match(view, /new IntersectionObserver\(\(\[entry\]\) => demo\.setPaused\("offscreen"/);
  assert.match(view, /<span class="sr-only">\{\{ draft\.body \}\}<\/span>/);
  assert.match(view, /class="intro-demo-subject" lang="en"/);
  assert.match(view, /class="intro-demo-code" :aria-label="`验证码 \$\{state\.reading\.code\}`"/);
  assert.match(css, /\.intro-demo-code \{[^}]*font-family: var\(--font-mono\)/);
  assert.match(css, /\.intro-demo-list \{ --row-h: 60px; height: calc\(var\(--row-h\) \* 3\);[^}]*overflow: hidden/);
  assert.match(css, /\.intro-demo\[data-tab="draft"\] \.intro-demo-thumb \{ transform: translateX\(100%\); \}/);
  assert.match(css, /\.intro-demo\.is-still :is\(/);
  assert.match(source("views/IntroView.vue"), /<IntroMailDemo \/>/);
});
