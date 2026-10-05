import { checkServerIdentity, connect, type PeerCertificate } from "node:tls";

export type CertificateResult = {
  key: "certificate"; label: string; status: "ok" | "warn" | "fail" | "unknown"; detail: string;
};

export function assessCertificate(
  hostname: string, certificate: PeerCertificate, authorized: boolean, now = Date.now(),
): CertificateResult {
  const result = (status: CertificateResult["status"], detail: string): CertificateResult => ({
    key: "certificate", label: "TLS 证书", status, detail,
  });
  const expires = Date.parse(certificate.valid_to ?? "");
  const starts = Date.parse(certificate.valid_from ?? "");
  if (!Number.isFinite(expires) || !Number.isFinite(starts)) return result("unknown", "无法读取完整证书有效期");
  if (starts > now) return result("fail", "证书尚未生效，请核对证书和服务器时间");
  if (expires <= now) return result("fail", `证书已过期：${certificate.valid_to}`);
  if (checkServerIdentity(hostname, certificate)) return result("fail", `证书不适用于 ${hostname}`);
  if (!authorized) return result("fail", "证书信任链校验失败，请检查证书颁发者与完整中间证书链");
  const remaining = expires - now;
  const days = Math.floor(remaining / 86_400_000);
  return result(remaining > 14 * 86_400_000 ? "ok" : "warn",
    `${hostname} 信任链及主机名校验通过；到期 ${certificate.valid_to}（${days ? `剩余 ${days} 天` : "剩余不足 1 天"}）`);
}

/** Diagnostic handshake only: no credentials or IMAP commands are sent. */
export function certificateCheck(hostname: string, host: string, port: number, ca?: string): Promise<CertificateResult> {
  return new Promise((resolve) => {
    let finished = false;
    const socket = connect({ host, port, servername: hostname, rejectUnauthorized: false, ...(ca ? { ca } : {}) });
    const done = (result: CertificateResult): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    // A wall-clock bound also covers slow handshakes that repeatedly emit bytes.
    const timer = setTimeout(() => done({ key: "certificate", label: "TLS 证书", status: "unknown", detail: "证书检查连接超时" }), 8000);
    socket.once("secureConnect", () => {
      try { done(assessCertificate(hostname, socket.getPeerCertificate(), socket.authorized)); }
      catch { done({ key: "certificate", label: "TLS 证书", status: "unknown", detail: "证书信息无法校验" }); }
    });
    socket.once("error", () => done({ key: "certificate", label: "TLS 证书", status: "unknown", detail: "无法建立证书检查连接" }));
    socket.once("close", () => {
      if (!finished) done({ key: "certificate", label: "TLS 证书", status: "unknown", detail: "证书检查连接提前关闭" });
    });
  });
}
