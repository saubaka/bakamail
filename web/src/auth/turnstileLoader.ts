export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

export type TurnstileRenderOptions = {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "flexible" | "compact";
  language?: string;
  retry?: "auto" | "never";
  "refresh-expired"?: "auto" | "manual" | "never";
  callback?: (token: string) => void;
  "error-callback"?: (code?: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
};

export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
};

declare global { interface Window { turnstile?: TurnstileApi } }

export const CSP_BLOCKED = "csp-blocked";
let pending: Promise<TurnstileApi> | null = null;

export function loadTurnstile(timeoutMs = 15_000): Promise<TurnstileApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending) return pending;
  pending = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    const onViolation = (event: SecurityPolicyViolationEvent): void => {
      if (event.blockedURI.startsWith(TURNSTILE_ORIGIN)) settle(new Error(CSP_BLOCKED));
    };
    document.addEventListener("securitypolicyviolation", onViolation);
    const settle = (error?: Error): void => {
      document.removeEventListener("securitypolicyviolation", onViolation);
      window.clearTimeout(timer);
      if (error || !window.turnstile) {
        script.remove();
        pending = null;
        reject(error ?? new Error("turnstile unavailable"));
        return;
      }
      resolve(window.turnstile);
    };
    const timer = window.setTimeout(() => settle(new Error("timeout")), timeoutMs);
    script.onload = () => settle();
    script.onerror = () => settle(new Error("blocked"));
    document.head.appendChild(script);
  });
  return pending;
}

export function turnstileErrorText(code?: string): string {
  if (!code) return "人机验证出错，请点击重试";
  if (code === "110200") return "此域名不在站点密钥允许的域名列表里";
  if (/^1101[0-9]{2}$|^1100[0-9]{2}$/.test(code)) return "站点密钥无效，请联系管理员";
  if (/^(105|106|600|300)/.test(code)) return `验证未通过（${code}），请点击重试`;
  if (/^(4|5)00/.test(code)) return `网络不稳定（${code}），请点击重试`;
  return `人机验证出错（${code}），请点击重试`;
}
