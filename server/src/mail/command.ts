import { spawn } from "node:child_process";

export const MADDY_COMMAND_LIMITS = Object.freeze({
  maxPending: 32, queueWaitMs: 30_000, commandMs: 15_000, killGraceMs: 1000,
  outputBytes: 2 * 1024 * 1024, stdinBytes: 64 * 1024, attempts: 4,
});

export type CommandFailureCode = "queue_full" | "queue_timeout" | "command_timeout" |
  "output_limit" | "stdin_limit" | "stdin_failed" | "spawn_failed";

export class CommandExecutionError extends Error {
  readonly code: CommandFailureCode;
  constructor(code: CommandFailureCode) {
    const messages: Record<CommandFailureCode, string> = {
      queue_full: "邮局命令排队已满，请稍后核对再试",
      queue_timeout: "等待邮局命令超时，本次排队任务未执行",
      command_timeout: "邮局命令执行超时，操作结果未确认",
      output_limit: "邮局命令输出超过额度，操作结果未确认",
      stdin_limit: "邮局命令输入超过额度，本次命令未执行",
      stdin_failed: "邮局命令输入未完成，操作结果未确认",
      spawn_failed: "邮局命令启动失败，操作结果未确认",
    };
    super(messages[code]);
    this.name = "CommandExecutionError";
    this.code = code;
  }
}

type WaitingJob = { deadline: number; timer: ReturnType<typeof setTimeout> | null;
  start: () => Promise<void>; expire: () => void };

/** Count active + waiting jobs. Expired closures are removed, never executed later. */
export class BoundedSerialQueue {
  private active = false;
  private waiting: WaitingJob[] = [];
  private readonly maxPending: number;
  private readonly waitMs: number;
  constructor(options: { maxPending?: number; waitMs?: number } = {}) {
    this.maxPending = options.maxPending ?? MADDY_COMMAND_LIMITS.maxPending;
    this.waitMs = options.waitMs ?? MADDY_COMMAND_LIMITS.queueWaitMs;
    for (const value of [this.maxPending, this.waitMs]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("命令队列额度配置不合法");
    }
  }
  run<T>(job: () => Promise<T>): Promise<T> {
    if (this.waiting.length + Number(this.active) >= this.maxPending) {
      return Promise.reject(new CommandExecutionError("queue_full"));
    }
    return new Promise<T>((resolve, reject) => {
      let work: (() => Promise<T>) | undefined = job;
      const entry: WaitingJob = {
        deadline: Date.now() + this.waitMs, timer: null,
        expire: () => { work = undefined; reject(new CommandExecutionError("queue_timeout")); },
        start: async () => {
          const task = work; work = undefined;
          if (!task) return;
          try { resolve(await task()); } catch (error) { reject(error); }
        },
      };
      entry.timer = setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index === -1) return;
        this.waiting.splice(index, 1);
        entry.expire();
      }, this.waitMs);
      this.waiting.push(entry);
      this.pump();
    });
  }
  private pump(): void {
    if (this.active) return;
    const next = this.waiting.shift();
    if (!next) return;
    if (next.timer) clearTimeout(next.timer);
    if (Date.now() >= next.deadline) { next.expire(); this.pump(); return; }
    this.active = true;
    void next.start().finally(() => { this.active = false; this.pump(); });
  }
}

export type CommandResult = { code: number; stdout: string; stderr: string };
type CommandOptions = {
  cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string;
  timeoutMs?: number; killGraceMs?: number; maxOutputBytes?: number; maxStdinBytes?: number;
};

/** No shell. On POSIX, signal only the new process group belonging to this invocation. */
export function runBoundedCommand(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? MADDY_COMMAND_LIMITS.commandMs;
  const graceMs = options.killGraceMs ?? MADDY_COMMAND_LIMITS.killGraceMs;
  const outputLimit = options.maxOutputBytes ?? MADDY_COMMAND_LIMITS.outputBytes;
  const stdinLimit = options.maxStdinBytes ?? MADDY_COMMAND_LIMITS.stdinBytes;
  for (const value of [timeoutMs, graceMs, outputLimit, stdinLimit]) {
    if (!Number.isSafeInteger(value) || value <= 0) return Promise.reject(new RangeError("命令资源额度配置不合法"));
  }
  const stdin = options.stdin ?? "";
  if (Buffer.byteLength(stdin) > stdinLimit) return Promise.reject(new CommandExecutionError("stdin_limit"));
  return new Promise((resolve, reject) => {
    const processGroup = process.platform !== "win32";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env,
        detached: processGroup, stdio: ["pipe", "pipe", "pipe"], shell: false });
    } catch { reject(new CommandExecutionError("spawn_failed")); return; }
    let failure: CommandExecutionError | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let bytes = 0;
    let closed = false;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    function signal(value: NodeJS.Signals): void {
      try {
        if (processGroup && child.pid && child.pid > 0) process.kill(-child.pid, value);
        else child.kill(value);
      } catch { /* ESRCH is expected if the command has already exited. */ }
    }
    function stop(code: CommandFailureCode): void {
      if (closed || failure) return;
      failure = new CommandExecutionError(code);
      // Do not retain partial protocol output after any uncertain execution failure.
      stdout.length = 0; stderr.length = 0;
      child.stdin?.destroy();
      signal("SIGTERM");
      killTimer = setTimeout(() => signal("SIGKILL"), graceMs);
    }
    const deadline = setTimeout(() => stop("command_timeout"), timeoutMs);
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (failure || closed) return;
      bytes += chunk.length;
      if (bytes > outputLimit) { stop("output_limit"); return; }
      target.push(Buffer.from(chunk));
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.stdin?.on("error", () => { if (stdin) stop("stdin_failed"); });
    child.on("error", () => stop("spawn_failed"));
    child.once("close", code => {
      closed = true;
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      // A descendant may have closed its pipes but ignored TERM. Kill the owned group before releasing the queue.
      if (failure) { signal("SIGKILL"); reject(failure); }
      else resolve({ code: code ?? -1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    try { child.stdin?.end(stdin || undefined); } catch { stop("stdin_failed"); }
  });
}
