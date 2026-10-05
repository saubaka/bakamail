import { MailDeadlineError, MailSessionClosedError } from "./deadline.ts";

const transportCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "ESOCKET",
  "CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT", "NOCONNECTION", "CLOSEDAFTERCONNECTTLS", "CLOSEDAFTERCONNECTTEXT",
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT",
]);

/** Positive transport evidence only; do not trust free-form error messages or expose them to clients. */
export function isMailServiceFailure(error: unknown): boolean {
  if (error instanceof MailDeadlineError || error instanceof MailSessionClosedError) return true;
  if (!error || typeof error !== "object") return false;
  const details = error as { code?: unknown; serverResponseCode?: unknown };
  const code = typeof details.code === "string" ? details.code.toUpperCase() : "";
  const response = typeof details.serverResponseCode === "string" ? details.serverResponseCode.toUpperCase() : "";
  return transportCodes.has(code) || /^ERR_(?:TLS|SSL)_/.test(code) || ["UNAVAILABLE", "SERVERBUG", "CONTACTADMIN"].includes(response);
}
