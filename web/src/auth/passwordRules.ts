/**
 * 密码规则的浏览器端镜像，与服务端 `server/src/security/passwords.ts` 的 `passwordProblem` 保持一致，
 * 用来在提交前就告诉管理员哪里不符合；服务端仍然是最终裁判，这里只是提前提示。
 */
export function passwordProblem(password: string): string {
  if (password.length < 10) return "密码至少 10 位";
  if (password.length > 200) return "密码过长";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(password)) return "密码不能包含换行或其他控制字符";
  if (/^\d+$/.test(password)) return "密码不能是纯数字";
  if (/^[a-zA-Z]+$/.test(password)) return "密码不能是纯字母";
  return "";
}

export const ADMIN_ROLES = ["superadmin", "admin", "auditor"] as const;

export function roleProblem(value: string): string {
  return (ADMIN_ROLES as readonly string[]).includes(value.trim()) ? "" : "角色只能是 superadmin、admin 或 auditor";
}
