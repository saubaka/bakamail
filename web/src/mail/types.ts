export type Folder = {
  path: string;
  name: string;
  specialUse: string | null;
  subscribed: boolean;
  messages: number;
  unseen: number;
};

export type MessageSummary = {
  uid: number;
  subject: string;
  from: { name: string; address: string }[];
  to: { name: string; address: string }[];
  date: string | null;
  size: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
};

export type MessageDetail = MessageSummary & {
  cc: { name: string; address: string }[];
  replyTo: { name: string; address: string }[];
  references: string[];
  text: string;
  html: string | null;
  attachments: { part: string; filename: string; size: number; contentType: string }[];
  headers: Record<string, string>;
};

export function folderLabel(folder: Folder): string {
  const specialNames: Record<string, string> = {
    "\\Inbox": "收件箱",
    "\\Sent": "已发送",
    "\\Drafts": "草稿",
    "\\Junk": "垃圾邮件",
    "\\Trash": "已删除",
    "\\Archive": "归档",
  };
  if (folder.path.toUpperCase() === "INBOX") return "收件箱";
  return folder.specialUse ? specialNames[folder.specialUse] ?? folder.name : folder.name;
}

export function folderPathLabel(path: string, folders: Folder[]): string {
  const folder = folders.find(item => item.path === path);
  return folder ? folderLabel(folder) : path.toUpperCase() === "INBOX" ? "收件箱" : path;
}
