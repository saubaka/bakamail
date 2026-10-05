export type MailAddress = { name: string; address: string };

export function replyRecipients(
  message: { from: MailAddress[]; replyTo: MailAddress[]; to: MailAddress[]; cc: MailAddress[] },
  ownAddress: string,
  all: boolean,
): { to: string; cc: string } {
  const own = ownAddress.trim().toLowerCase();
  const seen = new Set<string>();
  const unique = (addresses: MailAddress[]): string[] => addresses.flatMap(({ address }) => {
    const email = address.trim();
    const key = email.toLowerCase();
    if (!key || key === own || seen.has(key)) return [];
    seen.add(key);
    return [email];
  });
  const primary = unique(message.replyTo.length ? message.replyTo : message.from);
  if (!all) return { to: primary.join(", "), cc: "" };
  const originalTo = unique(message.to);
  const cc = unique(message.cc);
  return {
    to: [...primary, ...(!primary.length ? originalTo : [])].join(", "),
    cc: [...(primary.length ? originalTo : []), ...cc].join(", "),
  };
}

export function completeRecipientToken(value: string, email: string): string {
  const separator = value.lastIndexOf(",");
  const prefix = separator < 0 ? "" : `${value.slice(0, separator + 1)} `;
  return `${prefix}${email}`;
}
