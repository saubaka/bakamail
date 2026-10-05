import { MailboxPartialError } from "./accounts.ts";

export type AccountOperation = "create" | "repair" | "password" | "remove";

/** Safe business outcome only. Never copy a CLI message, stderr, stack, or nested cause. */
export function accountFailure(operation: AccountOperation, error: unknown): {
  code: string; message: string; outcome: "partial" | "unconfirmed";
} {
  const partial = error instanceof MailboxPartialError && error.operation === operation;
  if (partial) {
    const label = operation === "remove" ? "删除" : operation === "repair" ? "修复" : "创建";
    return {
      code: "mailbox_partial",
      outcome: "partial",
      message: `${label}未完成，账号可能是半成品；请刷新账号列表核对并修复，不要直接重复提交`,
    };
  }
  const messages: Record<AccountOperation, string> = {
    create: "邮局未确认创建结果，请刷新账号列表核对后再试",
    repair: "邮局未确认修复结果，请刷新账号列表核对后再试",
    password: "密码重置结果未确认；该账号现有会话已下线，请管理员核对，勿重复提交",
    remove: "邮局未确认删除结果；该账号现有会话已下线，请刷新账号列表核对并修复",
  };
  return { code: "mailbox_operation_unconfirmed", outcome: "unconfirmed", message: messages[operation] };
}
