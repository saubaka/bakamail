import { config } from "../config.ts";
import { BoundedSerialQueue, MADDY_COMMAND_LIMITS, runBoundedCommand } from "./command.ts";

export type MaddyResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export class MaddyError extends Error {
  readonly code: number;
  readonly stderr: string;

  constructor(message: string, code: number, stderr: string) {
    super(message);
    this.name = "MaddyError";
    this.code = code;
    this.stderr = stderr;
  }
}

export class MailboxPartialError extends AggregateError {
  readonly operation: "create" | "repair" | "remove";
  constructor(operation: "create" | "repair" | "remove", causes: unknown[]) {
    const messages = {
      create: "创建邮箱失败，且凭据回滚失败；可能是半成品账号，请检查并修复",
      repair: "修复邮箱失败，且凭据回滚失败；可能是半成品账号，请检查并修复",
      remove: "凭据删除已执行，但邮箱删除未确认；可能是半成品账号，请检查并修复",
    };
    super(causes, messages[operation]);
    this.name = "MailboxPartialError";
    this.operation = operation;
  }
}

const queue = new BoundedSerialQueue();

function spawnOnce(command: string, args: string[], stdin: string): Promise<MaddyResult> {
  return runBoundedCommand(command, args, {
    cwd: config.maddy.runner === "local" ? config.maddy.dataDir : undefined,
    env: {
      ...process.env,
      MADDY_HOSTNAME: config.mail.hostname,
      MADDY_DOMAIN: config.mail.domain,
    },
    stdin,
  });
}

function buildInvocation(args: string[]): { command: string; args: string[] } {
  if (config.maddy.runner === "local") {
    return { command: config.maddy.bin, args };
  }
  if (config.maddy.runner === "docker-exec") {
    return { command: "docker", args: ["exec", "-i", config.maddy.container, "maddy", ...args] };
  }
  throw new MaddyError(
    "当前 MADDY_RUNNER=disabled，无法管理账号。生产环境请在 BFF 容器内挂载 maddydata 卷并使用 MADDY_RUNNER=local。",
    -2,
    "",
  );
}

export async function runMaddy(args: string[], stdin = "", attempts = 4): Promise<MaddyResult> {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > MADDY_COMMAND_LIMITS.attempts) {
    throw new RangeError("邮局命令重试次数不合法");
  }
  return queue.run(async () => {
    let last: MaddyResult | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const invocation = buildInvocation(args);
      const result = await spawnOnce(invocation.command, invocation.args, stdin);
      last = result;
      const locked = /database is locked|SQLITE_BUSY/i.test(result.stderr);
      if (result.code === 0 || !locked || attempt === attempts - 1) return result;
      await new Promise((done) => setTimeout(done, 150 * (attempt + 1)));
    }
    return last as MaddyResult;
  });
}

function assertOk(result: MaddyResult, context: string): void {
  const runFailed = /app\.Run failed|invalid .* rule|reason":/i.test(result.stderr);
  if (result.code !== 0 || runFailed) {
    const detail = result.stderr.trim() || result.stdout.trim() || `退出码 ${result.code}`;
    throw new MaddyError(
      `${context} 失败：${detail}`,
      result.code,
      result.stderr,
    );
  }
}

function lines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("table.file:"));
}

export async function listCredentials(): Promise<string[]> {
  const result = await runMaddy(["creds", "list", "--cfg-block", "local_authdb"]);
  assertOk(result, "列出凭据");
  return lines(result.stdout);
}

export async function listAccounts(): Promise<string[]> {
  const result = await runMaddy(["imap-acct", "list", "--cfg-block", "local_mailboxes"]);
  assertOk(result, "列出邮箱账号");
  return lines(result.stdout);
}

export async function credentialExists(address: string): Promise<boolean> {
  const all = await listCredentials();
  return all.includes(address);
}

async function createCredential(address: string, password: string): Promise<void> {
  const credential = await runMaddy(
    ["creds", "create", "--cfg-block", "local_authdb", address],
    `${password}\n`,
  );
  assertOk(credential, `创建凭据 ${address}`);
}

async function removeCredential(address: string): Promise<void> {
  const result = await runMaddy(
    ["creds", "remove", "--cfg-block", "local_authdb", address],
    "y\n",
  );
  assertOk(result, `删除凭据 ${address}`);
}

async function createImapAccount(address: string): Promise<void> {
  const account = await runMaddy([
    "imap-acct",
    "create",
    "--cfg-block",
    "local_mailboxes",
    address,
  ]);
  assertOk(account, `创建邮箱 ${address}`);
}

export async function createMailbox(address: string, password: string): Promise<void> {
  await createCredential(address, password);
  try {
    await createImapAccount(address);
  } catch (error) {
    try {
      await removeCredential(address);
    } catch (rollbackError) {
      throw new MailboxPartialError("create", [error, rollbackError]);
    }
    throw error;
  }
}

export async function repairMailbox(
  address: string,
  password = "",
): Promise<{ repaired: string[] }> {
  const [credentials, accounts] = await Promise.all([listCredentials(), listAccounts()]);
  const hadCredential = credentials.includes(address);
  const hadAccount = accounts.includes(address);
  const repaired: string[] = [];
  if (hadCredential && hadAccount) return { repaired };
  if (!hadCredential) {
    if (!password) throw new MaddyError("缺少用于补建凭据的新密码", -3, "");
    await createCredential(address, password);
    repaired.push("credential");
  }
  if (!hadAccount) {
    try {
      await createImapAccount(address);
      repaired.push("mailbox");
    } catch (error) {
      if (!hadCredential) {
        try {
          await removeCredential(address);
        } catch (rollbackError) {
          throw new MailboxPartialError("repair", [error, rollbackError]);
        }
      }
      throw error;
    }
  }
  return { repaired };
}

export async function changeMailboxPassword(address: string, password: string): Promise<void> {
  const result = await runMaddy(
    ["creds", "password", "--cfg-block", "local_authdb", address],
    `${password}\n`,
  );
  assertOk(result, `重置密码 ${address}`);
}

export async function removeMailbox(address: string): Promise<void> {
  await removeCredential(address);
  try {
    const result = await runMaddy([
      "imap-acct",
      "remove",
      "--cfg-block",
      "local_mailboxes",
      "--yes",
      address,
    ]);
    assertOk(result, `删除邮箱 ${address}`);
  } catch (error) {
    throw new MailboxPartialError("remove", [error]);
  }
}

export function maddyRunnerReady(): boolean {
  return config.maddy.runner !== "disabled";
}
