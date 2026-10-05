import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";

const MAX_BYTES = 2_500_000;
const MAX_LINES = 2000;
const SENSITIVE = /password|passwd|credential|secret|token|authorization|\bauth\b|\b(?:body|subject|message-data)\s*[:=]/i;
export function redactLogLine(line: string): string {
  return SENSITIVE.test(line) ? "[含认证或邮件内容的日志已隐藏]" : line.slice(0, 1000);
}

export function parseLogLimit(value: unknown): number | null {
  if (value === undefined) return 200;
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 10 && limit <= MAX_LINES ? limit : null;
}

export type MailLogResult = {
  available: boolean; lines: string[]; capturedAt?: string;
  source?: "snapshot" | "docker-logs"; stale?: boolean; truncated?: boolean; hint?: string;
};

/** Same file handle for validation and bounded reading; never follow a substituted symlink. */
export async function readMailLogSnapshot(path: string, container: string, limit: number, now = Date.now()): Promise<MailLogResult> {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { available: false, lines: [], hint: "尚未生成邮局日志快照，请检查服务器日志采集任务。" };
    }
    throw new Error("无法安全读取邮局日志快照");
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("日志快照格式或大小异常");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_BYTES) throw new Error("日志快照超过读取限制");
    const data = JSON.parse(buffer.subarray(0, size).toString("utf8"));
    const captured = typeof data.capturedAt === "string" ? Date.parse(data.capturedAt) : NaN;
    if (data.version !== 1 || data.container !== container || data.source !== "docker-logs"
      || !Number.isFinite(captured) || captured > now + 5000
      || typeof data.truncated !== "boolean" || !Array.isArray(data.lines) || data.lines.length > MAX_LINES
      || data.lines.some((line: unknown) => typeof line !== "string" || line.length > 1000)) {
      throw new Error("日志快照校验失败");
    }
    const stale = now - captured > 120_000;
    return {
      available: true, lines: data.lines.slice(-limit).map(redactLogLine),
      capturedAt: new Date(captured).toISOString(), source: "snapshot", stale, truncated: data.truncated,
      hint: stale ? "日志采样已超过两分钟未更新，以下为历史快照，请检查采集任务。" : "服务器每分钟采样一次，最多保留最近 2000 行。",
    };
  } finally { await file.close(); }
}

/** Legacy docker-exec deployments: bounded duration/output and explicit failures. */
export function readDockerMailLogs(container: string, limit: number): Promise<MailLogResult> {
  return new Promise((resolve, reject) => {
    execFile("docker", ["logs", "--timestamps", "--tail", String(limit), container],
      { timeout: 8000, maxBuffer: MAX_BYTES, encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) { reject(new Error("无法读取邮局容器日志")); return; }
        // Docker sends application stderr separately; snapshot mode preserves its original ordering.
        const lines = `${stdout}\n${stderr}`.split("\n").filter(Boolean);
        resolve({ available: true, lines: lines.slice(-limit).map(redactLogLine),
          capturedAt: new Date().toISOString(), source: "docker-logs", stale: false,
          truncated: lines.length > limit, hint: "日志中的认证信息已隐藏。" });
      });
  });
}
