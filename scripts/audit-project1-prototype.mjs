import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prototypePath = join(root, "web/src/styles/vendor/project1-prototype.css");
const formalPath = join(root, "web/src/styles/vendor/project1-app.css");
const ledgerPath = join(root, "docs/project1-prototype-ledger.jsonl");

function context(rule) {
  const parents = [];
  for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule") parents.unshift(`@${parent.name} ${parent.params}`.trim());
  }
  return parents.join(" | ");
}

function declarations(rule) {
  return rule.nodes
    .filter((node) => node.type === "decl")
    .map((node) => [node.prop, node.value, node.important]);
}

function fingerprint(rule) {
  return createHash("sha256")
    .update(JSON.stringify([context(rule), rule.selector, declarations(rule)]))
    .digest("hex");
}

function inventory() {
  const formal = postcss.parse(readFileSync(formalPath, "utf8"), { from: formalPath });
  const prototype = postcss.parse(readFileSync(prototypePath, "utf8"), { from: prototypePath });
  const formalRules = new Map();
  formal.walkRules((rule) => {
    const key = JSON.stringify([context(rule), rule.selector]);
    const fingerprints = formalRules.get(key) ?? new Set();
    fingerprints.add(fingerprint(rule));
    formalRules.set(key, fingerprints);
  });
  const rows = [];
  prototype.walkRules((rule) => {
    const key = JSON.stringify([context(rule), rule.selector]);
    const matches = formalRules.get(key);
    const hash = fingerprint(rule);
    const formalMatch = matches?.has(hash) ? "identical" : matches ? "selector-only" : "none";
    rows.push({
      id: `P${String(rows.length + 1).padStart(3, "0")}`,
      line: rule.source.start.line,
      context: context(rule),
      selector: rule.selector,
      fingerprint: hash,
      formalMatch,
    });
  });
  return rows;
}

const current = inventory();
if (process.argv.includes("--seed")) {
  for (const row of current) {
    const covered = row.formalMatch === "identical";
    process.stdout.write(`${JSON.stringify({
      ...row,
      decision: covered ? "formal-covered" : "pending",
      evidence: covered ? "正式基座同上下文、选择器和声明完全一致；已按运行时顺序导入" : "",
    })}\n`);
  }
  process.exit(0);
}

const ledger = readFileSync(ledgerPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const decisions = new Set(["formal-covered", "bakamail-adapted", "not-applicable", "pending"]);
const failures = [];
if (ledger.length !== current.length) failures.push(`台账 ${ledger.length} 条，原型 CSS ${current.length} 条`);
for (let index = 0; index < current.length; index += 1) {
  const expected = current[index];
  const actual = ledger[index];
  if (!actual) break;
  for (const field of ["id", "line", "context", "selector", "fingerprint", "formalMatch"]) {
    if (actual[field] !== expected[field]) failures.push(`${expected.id} ${field} 与 CSS 快照不一致`);
  }
  if (!decisions.has(actual.decision)) failures.push(`${expected.id} 决策值无效`);
  if (actual.decision !== "pending" && !actual.evidence) failures.push(`${expected.id} 已决策但缺少证据`);
  if (actual.decision === "formal-covered" && actual.formalMatch !== "identical") {
    failures.push(`${expected.id} 不能仅凭相同选择器声称已由正式层完整覆盖`);
  }
}

const counts = Object.fromEntries([...decisions].map((decision) => [decision, 0]));
for (const row of ledger) if (Object.hasOwn(counts, row.decision)) counts[row.decision] += 1;
process.stdout.write(`项目 1 原型 CSS：${current.length} 条规则；${JSON.stringify(counts)}\n`);
if (failures.length) {
  for (const failure of failures.slice(0, 30)) process.stderr.write(`FAIL: ${failure}\n`);
  process.exit(1);
}
if (process.argv.includes("--strict") && counts.pending > 0) {
  process.stderr.write(`未完成：${counts.pending} 条原型规则仍需人工判定\n`);
  process.exit(1);
}
if (counts.pending > 0) {
  process.stdout.write(`待审计 ${counts.pending} 条；运行 npm run audit:prototype 查看严格验收结果\n`);
}
