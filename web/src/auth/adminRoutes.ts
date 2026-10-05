import type { RouteRecordRaw } from "vue-router";
import { ADMIN_LOGIN_PATH } from "../../../shared/adminPaths.ts";

export const adminRoutes: RouteRecordRaw[] = [
  { path: ADMIN_LOGIN_PATH, name: "admin-login", component: () => import("../views/admin/AdminLoginView.vue") },
  {
    path: ADMIN_LOGIN_PATH,
    meta: { auth: "admin" },
    component: () => import("../views/admin/AdminShell.vue"),
    // No empty child: /bakaadmin belongs exclusively to the login record above.
    children: [
      { path: "overview", name: "admin-overview", meta: { permission: "mail.account.read" }, component: () => import("../views/admin/OverviewView.vue") },
      { path: "accounts", name: "admin-accounts", meta: { permission: "mail.account.read" }, component: () => import("../views/admin/AccountsView.vue") },
      { path: "invites", name: "admin-invites", meta: { permission: "mail.invite.read" }, component: () => import("../views/admin/InvitesView.vue") },
      { path: "mail-ops", name: "admin-mail-ops", meta: { permission: "mail.queue.read" }, component: () => import("../views/admin/MailOpsView.vue") },
      { path: "security", name: "admin-security", meta: { permission: "system.audit.read" }, component: () => import("../views/admin/SecurityView.vue") },
      { path: "admins", name: "admin-admins", meta: { permission: "system.admin.write" }, component: () => import("../views/admin/AdminsView.vue") },
      { path: "system", name: "admin-system", meta: { permission: "system.admin.write" }, component: () => import("../views/admin/SystemView.vue") },
    ],
  },
];
