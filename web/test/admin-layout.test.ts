import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ADMIN_ROLES, passwordProblem, roleProblem } from "../src/auth/passwordRules.ts";
import { confirmDialog, dialogState, promptDialog, settleDialog } from "../src/dialog.ts";
import { stackTableDirective } from "../src/stackTable.ts";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("浏览器端密码规则与服务端一致：长度、纯数字、纯字母、控制字符", () => {
  const server = readFileSync(new URL("../../server/src/security/passwords.ts", import.meta.url), "utf8");
  for (const message of ["密码至少 10 位", "密码过长", "密码不能包含换行或其他控制字符", "密码不能是纯数字", "密码不能是纯字母"]) {
    assert.ok(server.includes(message) && source("auth/passwordRules.ts").includes(message), message);
  }
  assert.equal(passwordProblem("short"), "密码至少 10 位");
  assert.equal(passwordProblem("abc123xyz"), "密码至少 10 位", "9 characters is still too short");
  assert.equal(passwordProblem("abc123xyz0"), "", "10 characters with letters and digits is accepted");
  assert.equal(passwordProblem("1234567890"), "密码不能是纯数字");
  assert.equal(passwordProblem("abcdefghijk"), "密码不能是纯字母");
  assert.equal(passwordProblem("abcdefghi\nj1"), "密码不能包含换行或其他控制字符");
  assert.equal(passwordProblem("a".repeat(201)), "密码过长");
  assert.equal(passwordProblem("Valid-Pass-2026"), "");
  assert.equal(passwordProblem("  spaces are fine 9  "), "", "leading and trailing spaces are part of a password");
  assert.deepEqual([...ADMIN_ROLES], ["superadmin", "admin", "auditor"]);
  assert.equal(roleProblem("admin"), "");
  assert.equal(roleProblem(" auditor "), "");
  assert.match(roleProblem("boss"), /superadmin、admin 或 auditor/);
  assert.match(roleProblem(""), /superadmin/);
});

test("对话框：输入校验函数随弹窗保存，密码原样提交不再去掉首尾空格，普通文字仍去掉首尾空白", () => {
  const dialog = source("components/BakaDialog.vue");
  assert.match(dialog, /const submitted = \(\): string => \(isSecret\.value \? dialogState\.value : dialogState\.value\.trim\(\)\)/);
  assert.match(dialog, /settleDialog\(dialogState\.mode === "prompt" \? submitted\(\) : true\)/);
  assert.match(dialog, /<p v-if="problem" class="dialog-problem" role="status">/);
  assert.match(dialog, /submitted\(\)\.length > 0 && !problem\.value/);
  assert.doesNotMatch(dialog, /settleDialog\([^)]*\.value\.trim\(\)/, "no code path trims the submitted value directly");
  const validate = (value: string): string => (value.length < 3 ? "太短" : "");
  const pending = promptDialog({ title: "t", message: "m", inputType: "password", validate });
  assert.equal(dialogState.validate, validate);
  assert.equal(dialogState.inputType, "password");
  settleDialog("  keep spaces  ");
  return pending.then((value) => {
    assert.equal(value, "  keep spaces  ");
    const next = confirmDialog({ title: "c", message: "m" });
    assert.equal(dialogState.validate, undefined, "a later dialog does not inherit the previous validator");
    settleDialog(true);
    return next;
  });
});

test("所有设置密码或角色的弹窗都带校验", () => {
  const accounts = source("views/admin/AccountsView.vue");
  assert.equal(accounts.match(/validate: passwordProblem/g)?.length, 2, "reset password and rebuild credential");
  const admins = source("views/admin/AdminsView.vue");
  assert.match(admins, /validate: passwordProblem,\s*\n\s*confirmLabel: "更新并下线"/);
  assert.match(admins, /validate: roleProblem/);
  assert.match(source("components/admin/AdminEntrySettings.vue"), /Boolean\(draftProblem\)/);
  assert.match(source("components/admin/AdminEntrySettings.vue"), /<p v-if="draftProblem" class="field-error/);
});

type FakeCell = { attrs: Map<string, string>; textContent?: string; hasAttribute(n: string): boolean; setAttribute(n: string, v: string): void };
const cell = (text = "", label?: string): FakeCell => {
  const attrs = new Map<string, string>(); if (label) attrs.set("data-label", label);
  return { attrs, textContent: text, hasAttribute: (n) => attrs.has(n), setAttribute: (n, v) => { attrs.set(n, v); } };
};

test("堆叠表格指令：按表头给每个单元格补列名，保留已有的 data-label，重新渲染后新行也会补上", () => {
  const heads = ["邮箱", "状态", " 操作 "].map((t) => ({ textContent: t }));
  const rows = [[cell("a"), cell("b"), cell("c")], [cell("x", "自带"), cell("y"), cell("z")]];
  const classes = new Set<string>();
  const table = {
    classList: { add: (c: string) => classes.add(c) },
    querySelectorAll: (selector: string) => selector === "thead th" ? heads : selector === "tbody tr" ? rows.map((children) => ({ children })) : [],
  } as unknown as HTMLTableElement;
  stackTableDirective.mounted!(table, {} as never, {} as never, null as never);
  assert.ok(classes.has("is-stackable"));
  assert.deepEqual(rows[0]!.map((c) => c.attrs.get("data-label")), ["邮箱", "状态", "操作"]);
  assert.equal(rows[1]![0]!.attrs.get("data-label"), "自带", "existing labels are kept");
  rows.push([cell("n1"), cell("n2"), cell("n3")]);
  stackTableDirective.updated!(table, {} as never, {} as never, null as never);
  assert.deepEqual(rows[2]!.map((c) => c.attrs.get("data-label")), ["邮箱", "状态", "操作"]);
  // 多出来的单元格（表头没有对应列）不会被写成 undefined
  rows.push([cell("1"), cell("2"), cell("3"), cell("extra")]);
  stackTableDirective.updated!(table, {} as never, {} as never, null as never);
  assert.equal(rows[3]![3]!.attrs.has("data-label"), false);
});

test("页面版式规则：多卡片页面有统一间距，管理卡片按内容定高，窄屏表格堆叠，按钮不再被拉伸", () => {
  const css = source("styles/admin.css");
  const tail = css.slice(css.indexOf("后台页面版式：卡片间距"));
  assert.match(tail, /\.admin-page-stack \{ display: grid; gap: 20px;/);
  assert.match(tail, /\.admin-route-panel \{ display: grid; gap: 20px;/);
  assert.match(tail, /\.admin-main \.managed-page-card \{ grid-template-rows: none; grid-auto-rows: auto; align-content: start; min-height: 0; height: auto; \}/);
  assert.match(tail, /\.admin-main :is\(\.form-grid, \.managed-page-card, \.admin-panel\) > \.button \{ justify-self: start;/);
  assert.match(tail, /\.admin-main \.compose-grid__row > \.button \{[^}]*height: 48px/);
  assert.match(tail, /\.admin-table td \.button \{ min-height: 34px;/);
  assert.match(tail, /\.baka-confirm-dialog \.app-system-dialog__field \{ margin-bottom: 0; \}/);
  assert.match(css, /@media \(max-width: 700px\) \{\s*\n\s*\.table-scroll:has\(> \.is-stackable\)/);
  assert.match(css, /\.is-stackable td::before \{ content: attr\(data-label\)/);
  assert.doesNotMatch(tail, /gradient/i);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/i);
  for (const view of ["MailOpsView", "SecurityView", "AdminsView"]) {
    assert.match(source(`views/admin/${view}.vue`), /^<template>\n  <div class="admin-page-stack">/, view);
  }
  assert.equal((source("views/admin/SecurityView.vue").match(/<table v-stack-table class="admin-table">/g) ?? []).length, 4);
  assert.match(source("views/admin/AccountsView.vue"), /<table v-stack-table class="admin-table">/);
  assert.match(source("main.ts"), /\.directive\("stack-table", stackTableDirective\)/);
});

test("邀请码表格：短内容不换行、只有长文字格子折行；撤销只给还能使用的邀请码", () => {
  const invites = source("views/admin/InvitesView.vue");
  assert.match(invites, /\.invite-table td \{ vertical-align:middle; white-space:nowrap;/);
  assert.match(invites, /td\[data-label="绑定"\][^{]*\{ min-width:140px; max-width:240px; white-space:normal; overflow-wrap:anywhere; \}/);
  assert.match(invites, /v-if="canWrite && \(statusKey\(row\) === 'available' \|\| statusKey\(row\) === 'reserved'\)"/);
  assert.doesNotMatch(invites, /!row\.revoked_at"/);
});

test("概览与账号页：用统一的线性图标代替符号字符；修复提示显示中文而不是内部英文标识", () => {
  const overview = source("views/admin/OverviewView.vue");
  assert.doesNotMatch(overview, /icon: "[☺✉•↗!◷✦◇]"/);
  assert.doesNotMatch(overview, /<span class="baka-overview__arrow" aria-hidden="true">↗/);
  assert.match(overview, /<AdminIcon :name="metric\.icon"/);
  assert.match(overview, /<AdminIcon name="chevron"/);
  const accounts = source("views/admin/AccountsView.vue");
  assert.match(accounts, /repairedNames: Record<string, string> = \{ credential: "登录凭据", mailbox: "邮箱数据" \}/);
  assert.match(accounts, /repaired\.map\(\(part\) => repairedNames\[part\] \?\? part\)/);
  const icon = source("components/admin/AdminIcon.vue");
  for (const name of ["send", "alert", "clock", "unread", "chevron"]) assert.match(icon, new RegExp(`${name}: \\[`), name);
});
