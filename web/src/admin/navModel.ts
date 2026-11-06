export type IconName =
  | "overview" | "accounts" | "invites" | "ops" | "security" | "human" | "admins" | "system" | "seo"
  | "logout" | "mail" | "search" | "panel" | "return"
  | "send" | "alert" | "clock" | "unread" | "chevron";

export type RailBadgeKey = "accounts" | "security";

export type RailItem = {
  name: string;
  label: string;
  icon: IconName;
  permission: string;
  section: "main" | "mail" | "ops" | "security" | "system";
  keywords: string;
  shortcut: string;
  badge?: RailBadgeKey;
};

export const RAIL_SECTIONS: { key: RailItem["section"]; label: string }[] = [
  { key: "main", label: "" },
  { key: "mail", label: "邮箱" },
  { key: "ops", label: "运维" },
  { key: "security", label: "安全" },
  { key: "system", label: "系统" },
];

export const RAIL_ITEMS: RailItem[] = [
  { name: "admin-overview", label: "仪表盘", icon: "overview", permission: "mail.account.read", section: "main", shortcut: "o", keywords: "ybp yb dashboard overview 概览 首页 统计" },
  { name: "admin-accounts", label: "邮箱账号", icon: "accounts", permission: "mail.account.read", section: "mail", shortcut: "a", badge: "accounts", keywords: "yxzh zh accounts mailbox 账号 密码 容量 重置" },
  { name: "admin-invites", label: "邀请码", icon: "invites", permission: "mail.invite.read", section: "mail", shortcut: "i", keywords: "yqm invite code 邀请 注册 开通" },
  { name: "admin-mail-ops", label: "运维中心", icon: "ops", permission: "mail.queue.read", section: "ops", shortcut: "m", keywords: "ywzx ops queue log 队列 日志 域名 自检 邮件运维" },
  { name: "admin-security", label: "安全中心", icon: "security", permission: "system.audit.read", section: "security", shortcut: "s", badge: "security", keywords: "aqzx security audit session 限速 会话 审计 封禁 二步验证 totp" },
  { name: "admin-human-check", label: "人机验证", icon: "human", permission: "system.security.write", section: "security", shortcut: "h", keywords: "rjyz yz turnstile cloudflare captcha 验证码 机器人" },
  { name: "admin-admins", label: "管理员", icon: "admins", permission: "system.admin.write", section: "system", shortcut: "u", keywords: "gly admins administrator 角色 账号" },
  { name: "admin-system", label: "系统设置", icon: "system", permission: "system.admin.write", section: "system", shortcut: "y", keywords: "xtsz sz system settings 备份 路径 入口 通知 公告" },
  { name: "admin-seo", label: "SEO 管理", icon: "seo", permission: "system.seo.write", section: "system", shortcut: "e", keywords: "seo ss sousuo yqyh 搜索 搜索引擎 优化 收录 标题 描述 关键词 站点名 名称 品牌 分享 sitemap robots 百度 谷歌 google" },
];

export const PAGE_TITLES: Record<string, string> = Object.fromEntries(RAIL_ITEMS.map((item) => [item.name, item.label]));

export type RailSection = { key: RailItem["section"]; label: string; items: RailItem[] };

export function railSections(can: (permission: string) => boolean): RailSection[] {
  return RAIL_SECTIONS
    .map((section) => ({ ...section, items: RAIL_ITEMS.filter((item) => item.section === section.key && can(item.permission)) }))
    .filter((section) => section.items.length > 0);
}

export function visibleItems(can: (permission: string) => boolean): RailItem[] {
  return railSections(can).flatMap((section) => section.items);
}

export function matchItems<T extends { label: string; keywords?: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored: { item: T; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const label = item.label.toLowerCase();
    const words = (item.keywords ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.includes(q)) score = 1;
    else if (words.some((word) => word.startsWith(q))) score = 2;
    else if (words.some((word) => word.includes(q))) score = 3;
    if (score >= 0) scored.push({ item, score, order });
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((entry) => entry.item);
}
