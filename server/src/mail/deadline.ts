export class MailDeadlineError extends Error {
  readonly code = "MAIL_TIMEOUT";
  constructor(message: string) {
    super(message);
    this.name = "MailDeadlineError";
  }
}

export class MailSessionClosedError extends Error {
  readonly code = "MAIL_SESSION_CLOSED";
  constructor() { super("邮箱会话已关闭"); this.name = "MailSessionClosedError"; }
}

/** Do not rely on a third-party connect/command promise settling when its socket is destroyed. */
export async function withMailAbort<T>(job: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new MailSessionClosedError();
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new MailSessionClosedError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw new MailSessionClosedError();
      return job();
    }), cancelled]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** Stop the real transport before releasing its request budget; observe late rejections. */
export async function withMailDeadline<T>(job: () => Promise<T>, ms: number, abort: () => void, message: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Queue our stable error before the client's close-induced error can win the race.
      reject(new MailDeadlineError(message));
      try { abort(); } catch { /* The deadline must still settle if transport teardown throws. */ }
    }, ms);
  });
  try {
    return await Promise.race([signal ? withMailAbort(job, signal) : Promise.resolve().then(job), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
