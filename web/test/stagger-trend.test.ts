import assert from "node:assert/strict";
import test from "node:test";
import { createStagger } from "../src/stagger.ts";
import { aggregate, niceMax, yTicks, monotonePath, resample, lerpValues, xTickIndexes } from "../src/admin/trend.ts";
import { childDelay, dropNested, specFor, CHILD_MAX_STEPS, CHILD_START_MS, CHILD_STEP_MS } from "../src/admin/entrance.ts";

test("依次入场：同一批每个晚一步，超过上限不再变长，停一会儿后从头开始", () => {
  const s = createStagger(70, 3, 180);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => s.next(1000 + i)), [0, 70, 140, 210, 210, 210]);
  assert.equal(s.next(1000 + 5 + 181), 0);
  assert.equal(s.next(1000 + 5 + 181 + 50), 70);
  s.reset();
  assert.equal(s.next(0), 0);
});

test("卡片内容在卡片之后依次跟上，嵌套的候选只算最外层，表格行只做透明度", () => {
  assert.equal(childDelay(100, 0), 100 + CHILD_START_MS);
  assert.equal(childDelay(0, 99), CHILD_START_MS + CHILD_MAX_STEPS * CHILD_STEP_MS);
  const items = [{ id: "a", in: ["b", "c"] }, { id: "b", in: [] }, { id: "c", in: [] }, { id: "d", in: [] }];
  const top = dropNested(items, (outer, inner) => outer.in.includes(inner.id));
  assert.deepEqual(top.map((item) => item.id), ["a", "d"]);
  assert.equal(specFor("row", "TR").opacityOnly, true);
  assert.equal(specFor("card", "SECTION").opacityOnly, false);
});

const hour = 3_600_000;
const day = new Date(2026, 9, 1, 0, 0, 0).getTime();
const points = Array.from({ length: 48 }, (_, i) => ({ t: day + i * hour, passed: 1, rejected: i % 2, unavailable: 0 }));

test("趋势聚合：24 小时逐小时，7 天每 6 小时，30 天按本地日期，总数不丢", () => {
  const sum = (key: "passed" | "rejected") => (list: { passed: number; rejected: number }[]) => list.reduce((n, b) => n + b[key], 0);
  assert.equal(aggregate(points, "24h").length, 48);
  const six = aggregate(points, "7d");
  assert.equal(six.length, 8);
  assert.equal(sum("passed")(six), 48);
  const days = aggregate(points, "30d");
  assert.equal(days.length, 2);
  assert.equal(sum("rejected")(days), 24);
  assert.equal(days[0]!.end, day + 24 * hour);
});

test("趋势坐标：刻度取整、空数据也有刻度、曲线不冲出范围、补间端点准确", () => {
  assert.equal(niceMax(0), 4);
  assert.equal(niceMax(NaN), 4);
  assert.equal(niceMax(37), 50);
  assert.equal(niceMax(100), 100);
  assert.deepEqual(yTicks(4), [0, 2, 4]);
  assert.deepEqual(yTicks(50), [0, 25, 50]);
  assert.equal(monotonePath([]), "");
  assert.equal(monotonePath([{ x: 1, y: 2 }]), "M1 2");
  const path = monotonePath([{ x: 0, y: 100 }, { x: 10, y: 0 }, { x: 20, y: 100 }, { x: 30, y: 100 }]);
  const ys = [...path.matchAll(/(?:C|,|\s)(-?\d+(?:\.\d+)?)\s(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  assert.ok(ys.every((y) => y >= 0 && y <= 100), `曲线 y 超出范围：${path}`);
  assert.deepEqual(resample([0, 10], 3), [0, 5, 10]);
  assert.deepEqual(lerpValues([0, 10], [10, 20], 0), [0, 10]);
  assert.deepEqual(lerpValues([0, 10], [10, 20], 1), [10, 20]);
  const ticks = xTickIndexes(24, 6);
  assert.ok(ticks.length <= 6 && ticks[0] === 0);
});
