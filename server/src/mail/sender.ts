import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { config } from "../config.ts";

export type OutgoingAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type OutgoingMessage = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: OutgoingAttachment[];
  inReplyTo?: string;
  references?: string[];
};

export type SendOutcome =
  | { ok: true; messageId: string; accepted: string[]; raw: Buffer }
  | { ok: false; category: SendFailure; detail: string };

export type SendFailure =
  | "auth"
  | "recipient-rejected"
  | "too-large"
  | "timeout"
  | "network"
  | "unknown";

function classify(error: unknown): SendFailure {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/EAUTH|Invalid login|authentication/i.test(message)) return "auth";
  if (/ETIMEDOUT|timeout|Greeting never received/i.test(message)) return "timeout";
  if (/ECONN|ENOTFOUND|EHOSTUNREACH|EPIPE|socket hang up/i.test(message)) return "network";
  if (/552|Message size|too large|exceeds/i.test(message)) return "too-large";
  if (/5\d\d|recipient|RCPT/i.test(message)) return "recipient-rejected";
  return "unknown";
}

/** 发信必须走 submission（465 / 587），25 只收信。 */
export async function sendMail(
  account: string,
  password: string,
  message: OutgoingMessage,
): Promise<SendOutcome> {
  const transportOptions: SMTPTransport.Options = {
    host: config.mail.host,
    port: config.mail.smtpPort,
    secure: config.mail.smtpPort === 465,
    requireTLS: config.mail.smtpPort !== 465,
    auth: { user: account, pass: password },
    tls: {
      rejectUnauthorized: config.mail.tlsRejectUnauthorized,
      // 容器内连的是 maddymail 别名，证书给的是 mail.saubaka.com
      servername: config.mail.hostname,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  };
  const transporter = nodemailer.createTransport(transportOptions);

  try {
    /*
     * 自己先把邮件编译成原始 MIME。
     * nodemailer 7 的 sendMail 结果里不再带 info.message，
     * 而写回「已发送」必须是逐字节相同的原始邮件，所以在这里构建一次，
     * 再用 raw + envelope 投递。
     */
    const raw = await new MailComposer({
      from: message.from,
      to: message.to,
      cc: message.cc && message.cc.length > 0 ? message.cc : undefined,
      bcc: message.bcc && message.bcc.length > 0 ? message.bcc : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
      inReplyTo: message.inReplyTo,
      references: message.references,
    })
      .compile()
      .build();

    const info = await transporter.sendMail({
      envelope: {
        from: message.from,
        to: [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])],
      },
      raw,
    });
    return {
      ok: true,
      messageId: info.messageId ?? "",
      accepted: (info.accepted as Array<string | { address: string }> ?? []).map((entry) =>
        typeof entry === "string" ? entry : entry.address,
      ),
      raw,
    };
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, category: classify(error), detail: detail.slice(0, 400) };
  } finally {
    transporter.close();
  }
}

export function addressListProblem(addresses: string[]): string {
  if (addresses.length === 0) return "至少需要一个收件人";
  for (const address of addresses) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return `地址格式不正确：${address}`;
  }
  return "";
}

/** 发件人仅能使用本人地址，或同一域名下的本人加号别名。 */
export function senderAddressAllowed(account: string, candidate: string): boolean {
  const [accountLocal, accountDomain, ...accountRest] = account.toLowerCase().split("@");
  const [candidateLocal, candidateDomain, ...candidateRest] = candidate.toLowerCase().split("@");
  if (!accountLocal || !accountDomain || accountRest.length > 0) return false;
  if (!candidateLocal || candidateDomain !== accountDomain || candidateRest.length > 0) return false;
  return candidateLocal === accountLocal || candidateLocal.startsWith(`${accountLocal}+`);
}
