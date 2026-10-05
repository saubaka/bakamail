import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { certificateCheck } from "./certificateCheck.ts";
import { config } from "../config.ts";
import { dkimKeyPath } from "./mailstats.ts";

export type CheckResult = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
};

function normalizeDkimRecord(record: string): string {
  return record
    .replace(/["\s]/g, "")
    .replace(/^v=DKIM1;/i, "")
    .replace(/^k=rsa;/i, "")
    .replace(/^p=/i, "");
}

export async function domainCheck(domain = config.mail.domain, hostname = `mail.${domain}`): Promise<CheckResult[]> {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const results: CheckResult[] = [];

  try {
    const mx = await resolver.resolveMx(domain);
    const targets = mx.map((entry) => entry.exchange.replace(/\.$/, ""));
    const ok = targets.includes(hostname);
    results.push({
      key: "mx",
      label: "MX 记录",
      status: ok ? "ok" : targets.length > 0 ? "warn" : "fail",
      detail: targets.length > 0 ? targets.join(", ") : "没有 MX 记录",
    });
  } catch (error) {
    results.push({
      key: "mx",
      label: "MX 记录",
      status: "fail",
      detail: error instanceof Error ? error.message : "查询失败",
    });
  }

  try {
    const txt = await resolver.resolveTxt(domain);
    const flat = txt.map((chunks) => chunks.join(""));
    const spf = flat.find((entry) => entry.toLowerCase().startsWith("v=spf1")) ?? "";
    results.push({
      key: "spf",
      label: "SPF",
      status: spf ? (spf.includes("-all") ? "ok" : "warn") : "fail",
      detail: spf || "没有 SPF 记录",
    });
  } catch {
    results.push({ key: "spf", label: "SPF", status: "fail", detail: "没有 SPF 记录" });
  }

  try {
    const dmarc = await resolver.resolveTxt(`_dmarc.${domain}`);
    const flat = dmarc.map((chunks) => chunks.join(""));
    const record = flat.find((entry) => entry.toLowerCase().startsWith("v=dmarc1")) ?? "";
    results.push({
      key: "dmarc",
      label: "DMARC",
      status: record ? "ok" : "fail",
      detail: record || "没有 DMARC 记录",
    });
  } catch {
    results.push({ key: "dmarc", label: "DMARC", status: "fail", detail: "没有 DMARC 记录" });
  }

  try {
    const dnsTxt = await resolver.resolveTxt(`default._domainkey.${domain}`);
    const record = dnsTxt.map((chunks) => chunks.join("")).join("");
    const dnsPart = normalizeDkimRecord(record);
    const keyFile = dkimKeyPath(domain);
    const dnsFile = keyFile.replace(/\.key$/, ".dns");
    let status: CheckResult["status"] = record ? "ok" : "fail";
    let detail = record ? "已发布 default 选择器" : "没有 DKIM 记录";
    if (record && existsSync(dnsFile)) {
      const localPart = normalizeDkimRecord(readFileSync(dnsFile, "utf8"));
      const digest = (value: string): string =>
        createHash("md5").update(value).digest("hex").slice(0, 12);
      const same = digest(dnsPart) === digest(localPart);
      status = same ? "ok" : "fail";
      detail = same
        ? `DNS 公钥与本地密钥一致（${digest(localPart)}）`
        : `DNS 公钥与本地密钥不一致（DNS ${digest(dnsPart)} / 本地 ${digest(localPart)}）`;
    } else if (record && existsSync(keyFile)) {
      detail = "已发布 default 选择器（本地缺少 .dns 文件，未做逐字节比对）";
    }
    results.push({ key: "dkim", label: "DKIM", status, detail });
  } catch {
    results.push({ key: "dkim", label: "DKIM", status: "fail", detail: "没有 DKIM 记录" });
  }

  results.push(await certificateCheck(hostname, config.mail.host === "maddymail" ? hostname : config.mail.host, config.mail.imapPort));
  results.push(await portCheck(hostname));
  return results;
}

async function portCheck(hostname: string): Promise<CheckResult> {
  const net = await import("node:net");
  const ports = [25, 465, 587, 993];
  const reachable: number[] = [];
  await Promise.all(
    ports.map(
      (port) =>
        new Promise<void>((resolve) => {
          const socket = net.connect({ host: hostname, port, timeout: 5000 }, () => {
            reachable.push(port);
            socket.destroy();
            resolve();
          });
          socket.on("error", () => resolve());
          socket.on("timeout", () => {
            socket.destroy();
            resolve();
          });
        }),
    ),
  );
  reachable.sort((a, b) => a - b);
  return {
    key: "ports",
    label: "对外端口",
    status: reachable.length === ports.length ? "ok" : reachable.length > 0 ? "warn" : "fail",
    detail:
      reachable.length > 0
        ? `可达 ${reachable.join(", ")}${reachable.length < ports.length ? `（缺 ${ports.filter((p) => !reachable.includes(p)).join(", ")}）` : ""}`
        : "25 / 465 / 587 / 993 均不可达",
  };
}
