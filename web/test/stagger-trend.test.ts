import assert from "node:assert/strict";
import test from "node:test";
import { createStagger } from "../src/stagger.ts";
import { aggregate, niceMax, yTicks, monotonePath, resample, lerpValues, xTickIndexes } from "../src/admin/trend.ts";
import { dropNested, specFor, statDelay, STAT_STEP_MS, STAT_SELECTOR, ENTRANCE_SELECTOR } from "../src/admin/entrance.ts";
import { collectCardParts, partOffset, PARTS_START_MS, PARTS_STEP_MS, PARTS_MAX_STEPS, type PartNode } from "../src/cardParts.ts";

test("依次入场：同一批每个晚一步，超过上限不再变长，停一会儿后从头开始", () => {
  const s = createStagger(70, 3, 180);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => s.next(1000 + i)), [0, 70, 140, 210, 210, 210]);
  assert.equal(s.next(1000 + 5 + 181), 0);
  assert.equal(s.next(1000 + 5 + 181 + 50), 70);
  s.reset();
  assert.equal(s.next(0), 0);
});

test("嵌套的候选只算最外层，表格行只做透明度", () => {
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

type Fake = PartNode & { children: Fake[]; hidden?: boolean };
const el = (tagName: string, className = "", children: Fake[] = [], text = ""): Fake => ({
  tagName, className, children,
  childNodes: [...(text ? [{ nodeType: 3, textContent: text }] : []), ...children.map(() => ({ nodeType: 1, textContent: null }))],
});
const names = (parts: Fake[]) => parts.map((part) => `${part.tagName}${part.className ? "." + part.className : ""}`);

test("总览统计卡片一张一张依次入场，间隔肉眼可分辨", () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => statDelay(70, i)), [70, 70 + STAT_STEP_MS, 70 + 2 * STAT_STEP_MS, 70 + 3 * STAT_STEP_MS]);
  assert.ok(STAT_STEP_MS >= 100);
  assert.ok(ENTRANCE_SELECTOR.includes(STAT_SELECTOR));
});

test("卡片内容单元：统计卡片按图标、标题、数值、说明的顺序，纯容器往里找", () => {
  const stat = el("ARTICLE", "baka-overview-stat", [
    el("SPAN", "baka-overview-stat__icon", [el("SVG")]),
    el("DIV", "", [el("SMALL", "", [], "邮箱账号"), el("STRONG", "", [], "未提供"), el("SPAN", "baka-overview-stat__hint", [], "账号总数")]),
  ]);
  assert.deepEqual(names(collectCardParts(stat)), ["SPAN.baka-overview-stat__icon", "SMALL", "STRONG", "SPAN.baka-overview-stat__hint"]);
});

test("卡片内容单元：跳过外轮廓和嵌套卡片、隐藏元素与对话框，表单项、按钮、表格各算一个，数量有上限", () => {
  const card = el("SECTION", "admin-panel", [
    el("SVG", "motion-outline"),
    el("HEADER", "", [el("H2", "", [], "标题"), el("P", "", [], "说明")]),
    el("FORM", "form-grid", [el("LABEL", "", [el("INPUT")], "名称"), el("LABEL", "", [el("INPUT")], "地址"), el("DIV", "actions", [el("BUTTON", "button", [], "保存")])]),
    el("DIV", "table-scroll", [el("TABLE", "", [el("TR")])]),
    el("SECTION", "admin-panel", [el("P", "", [], "嵌套卡片自己入场")]),
    Object.assign(el("P", "", [], "隐藏"), { hidden: true }),
    el("DIALOG", "", [el("P", "", [], "对话框")]),
  ]);
  assert.deepEqual(names(collectCardParts(card)), ["H2", "P", "LABEL", "LABEL", "BUTTON.button", "DIV.table-scroll"]);
  assert.deepEqual(names(collectCardParts(card, (node) => node.tagName !== "P")), ["H2", "LABEL", "LABEL", "BUTTON.button", "DIV.table-scroll"]);
  const many = el("SECTION", "managed-page-card", Array.from({ length: 60 }, () => el("P", "", [], "文字")));
  assert.equal(collectCardParts(many).length, 24);
  assert.equal(collectCardParts(many, () => true, 5).length, 5);
});

test("内容单元的等待时间：先等卡片出现，之后按固定节拍，超过上限不再变长", () => {
  assert.equal(partOffset(0), PARTS_START_MS);
  assert.equal(partOffset(3), PARTS_START_MS + 3 * PARTS_STEP_MS);
  assert.equal(partOffset(99), PARTS_START_MS + PARTS_MAX_STEPS * PARTS_STEP_MS);
});
