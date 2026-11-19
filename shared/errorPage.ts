export type ErrorCopy = { title: string; message: string; retry: boolean };

export const ERROR_COPY: Record<number, ErrorCopy> = {
  400: { title: "请求有问题", message: "这个地址或请求的格式不对，没办法处理。检查一下链接再试。", retry: false },
  403: { title: "没有访问权限", message: "你没有权限打开这个页面。", retry: false },
  404: { title: "找不到这个页面", message: "地址可能输错了，或者这个页面已经不存在。", retry: false },
  405: { title: "不支持这种请求", message: "这个地址不接受当前的请求方式。", retry: false },
  408: { title: "请求超时", message: "等待请求的时间太长了，请再试一次。", retry: true },
  413: { title: "内容太大", message: "提交的内容超过了允许的大小。", retry: false },
  429: { title: "操作太频繁", message: "你操作得有点快，稍等一会儿再试。", retry: true },
  500: { title: "服务出了点问题", message: "服务器遇到了意外情况。请稍后再试，如果一直这样，请联系管理员。", retry: true },
  502: { title: "暂时连不上服务", message: "网页服务没有正常响应，可能正在重启。稍等片刻再试，邮件仍保存在邮局里，不受影响。", retry: true },
  503: { title: "服务暂时不可用", message: "服务正在维护或暂时繁忙，稍后再试。", retry: true },
  504: { title: "服务响应太慢", message: "等了很久也没有得到回应，请稍后再试。", retry: true },
};

export const LOAD_FAILURE_COPY: ErrorCopy = { title: "页面没有加载出来", message: "网络可能不稳定，或者页面刚刚更新过。重新加载一次通常就好了。", retry: true };
export const NOSCRIPT_COPY: ErrorCopy = { title: "需要开启 JavaScript", message: "这个页面需要 JavaScript 才能使用，请在浏览器里开启后刷新。", retry: false };

export const errorCopy = (status: number): ErrorCopy => ERROR_COPY[status] ?? ERROR_COPY[status >= 500 ? 500 : 400]!;
export const isServerError = (status: number): boolean => status >= 500;
export const SUPPORTED_ERROR_STATUSES = Object.keys(ERROR_COPY).map(Number);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const ERROR_LOGO_SVG = '<svg class="ep-logo" viewBox="0 0 128 128" aria-hidden="true" focusable="false"><rect width="128" height="128" rx="36" fill="#eaf4fc"/>'
  + '<rect x="18" y="38" width="92" height="56" rx="28" fill="#ffffff" stroke="#8cc2ee" stroke-width="10"/>'
  + '<path d="M40 55 64 71 88 55" fill="none" stroke="#8cc2ee" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<circle cx="101" cy="39" r="13" fill="#f0a0ba" stroke="#eaf4fc" stroke-width="6"/></svg>';

const ERROR_FAVICON = `data:image/svg+xml,${encodeURIComponent(ERROR_LOGO_SVG.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '))}`;

export const ERROR_PAGE_CSS = `
.ep-body,.ep-page{box-sizing:border-box;margin:0;min-height:100vh;min-height:100svh;display:flex;flex-direction:column;background:#f8f6f7;color:#5a5458;font-family:system-ui,-apple-system,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
.ep-page{position:relative;z-index:1}
.ep-main{flex:1;display:grid;place-items:center;padding:48px 24px 32px;min-width:0}
.ep-main:focus{outline:none}
.ep-card{position:relative;box-sizing:border-box;width:min(440px,100%);padding:34px 34px 30px;overflow:hidden;border:1px solid #ebe6e9;border-radius:26px;background:#fff;box-shadow:0 2px 6px rgba(150,130,140,.08),0 18px 44px rgba(150,130,140,.14);text-align:center;animation:ep-rise .9s cubic-bezier(.22,1,.36,1) both}
.ep-site{display:flex;align-items:center;justify-content:center;gap:8px;margin:0;font-size:13px;font-weight:600;letter-spacing:.02em;color:#8a8387}
.ep-logo{--logo-size:26px;display:block;flex:none;width:26px;height:26px}
.ep-code{display:flex;justify-content:center;margin:6px 0 0;font-size:clamp(64px,19vw,92px);font-weight:650;line-height:1.05;letter-spacing:-.025em;color:#a8d2f3;user-select:none;font-variant-numeric:tabular-nums}
.ep--server .ep-code{color:#f6c3d4}
.ep-code span{display:inline-block;animation:ep-digit .9s cubic-bezier(.22,1,.36,1) both;animation-delay:calc(.1s + var(--i,0)*.07s)}
.ep-title{margin:4px 0 8px;font-size:23px;line-height:1.35;font-weight:650;letter-spacing:.01em;color:#5a5458;animation:ep-fade .9s cubic-bezier(.22,1,.36,1) .2s both}
.ep-message{max-width:340px;margin:0 auto;text-wrap:balance;font-size:14px;line-height:1.75;color:#8a8387;overflow-wrap:anywhere;animation:ep-fade .9s cubic-bezier(.22,1,.36,1) .25s both}
.ep-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:26px;animation:ep-fade .9s cubic-bezier(.22,1,.36,1) .3s both}
.ep-button,.ep-link{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 22px;border:1px solid #ece8ea;border-radius:999px;font:inherit;font-size:14px;font-weight:600;color:#5a5458;text-decoration:none;cursor:pointer;transition:transform .45s cubic-bezier(.34,1.56,.64,1),background-color .2s cubic-bezier(.22,1,.36,1),box-shadow .45s cubic-bezier(.22,1,.36,1)}
.ep-button{border-color:transparent;background:#c1dff6;box-shadow:0 3px 0 #a8d2f3}
.ep-link{background:#fff}
.ep-actions>.ep-link:only-child{border-color:transparent;background:#c1dff6;box-shadow:0 3px 0 #a8d2f3}
.ep-button:hover,.ep-actions>.ep-link:only-child:hover{transform:translateY(-1px);background:#a8d2f3}
.ep-link:hover{transform:translateY(-1px);box-shadow:0 1px 2px rgba(150,130,140,.06),0 8px 24px rgba(150,130,140,.08)}
.ep-button:active,.ep-link:active{transform:translateY(2px) scale(.98)}
.ep-button:focus-visible,.ep-link:focus-visible{outline:2px solid #a8d2f3;outline-offset:3px}
.ep-meta{margin:22px 0 0;font-size:12px;color:#a29ba0;overflow-wrap:anywhere;animation:ep-fade .9s cubic-bezier(.22,1,.36,1) .35s both}
.ep-meta code{font:12px ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace;color:#5a5458}
.ep-footer{flex:none;padding:0 24px 24px;text-align:center;font-size:12px;line-height:1.7;color:#a29ba0}
.ep-footer p{margin:0}
@keyframes ep-rise{from{opacity:0;transform:translate3d(0,20px,0) scale(.98)}to{opacity:1;transform:none}}
@keyframes ep-digit{from{opacity:0;transform:translate3d(0,20px,0) scale(.9)}to{opacity:1;transform:none}}
@keyframes ep-fade{from{opacity:0;transform:translate3d(0,8px,0)}to{opacity:1;transform:none}}
@media (max-width:480px){.ep-main{padding:32px 16px 24px}.ep-card{padding:30px 22px 26px}.ep-title{font-size:21px}.ep-actions .ep-button,.ep-actions .ep-link{flex:1 1 140px}}
@media (prefers-reduced-motion:reduce){.ep-card,.ep-code span,.ep-title,.ep-message,.ep-actions,.ep-meta{animation:none!important}.ep-button,.ep-link{transition:none!important}}
`.trim();

const EMBEDDED_BODY_CSS = "body{margin:0;background:#f8f6f7}";

export type ErrorCardOptions = {
  status?: number;
  copy?: ErrorCopy;
  siteName?: string;
  requestId?: string;
  retryAfter?: number;
  retryHref?: string;
  homeHref?: string;
  showHome?: boolean;
};

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function renderErrorCard(options: ErrorCardOptions): string {
  const status = options.status;
  const copy = options.copy ?? (status ? errorCopy(status) : LOAD_FAILURE_COPY);
  const server = status === undefined || isServerError(status);
  const digits = status === undefined ? "" : `<p class="ep-code" aria-hidden="true">${[...String(status)].map((digit, index) => `<span style="--i:${index}">${digit}</span>`).join("")}</p>`;
  const wait = options.retryAfter && Number.isFinite(options.retryAfter) && options.retryAfter > 0 ? `请大约等待 ${Math.ceil(options.retryAfter)} 秒后再试。` : "";
  const id = server && options.requestId && REQUEST_ID.test(options.requestId) ? `<p class="ep-meta">错误编号 <code>${escapeHtml(options.requestId)}</code></p>` : "";
  const retry = copy.retry ? `<a class="ep-link" href="${escapeHtml(options.retryHref ?? "")}">重试</a>` : "";
  const home = options.showHome === false ? "" : `<a class="ep-button" href="${escapeHtml(options.homeHref ?? "/")}">返回首页</a>`;
  return `<section class="ep-card${server ? " ep--server" : ""}" aria-labelledby="ep-title">`
    + (options.siteName ? `<p class="ep-site">${ERROR_LOGO_SVG}${escapeHtml(options.siteName)}</p>` : "")
    + digits
    + `<h1 class="ep-title" id="ep-title">${escapeHtml(copy.title)}</h1>`
    + `<p class="ep-message">${escapeHtml(copy.message)}${wait ? ` ${wait}` : ""}</p>`
    + (home || retry ? `<div class="ep-actions">${home}${retry}</div>` : "")
    + id
    + `</section>`;
}

export const ERROR_FOOTER = (year: number): string => `<footer class="ep-footer"><p>© ${year} saubaka. BakaMail.</p></footer>`;

export function renderErrorDocument(options: ErrorCardOptions & { year?: number; title?: string }): string {
  const status = options.status;
  const copy = options.copy ?? (status ? errorCopy(status) : LOAD_FAILURE_COPY);
  const year = options.year ?? new Date().getFullYear();
  const pageTitle = options.title ?? `${status ? `${status} ` : ""}${copy.title}${options.siteName ? ` - ${options.siteName}` : ""}`;
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n`
    + `<meta name="robots" content="noindex, nofollow" />\n<meta name="color-scheme" content="light" />\n<meta name="theme-color" content="#F8F6F7" />\n`
    + `<title>${escapeHtml(pageTitle)}</title>\n<link rel="icon" href="${ERROR_FAVICON}" />\n<style>${ERROR_PAGE_CSS}</style>\n</head>\n`
    + `<body class="ep-body">\n<main class="ep-main" id="main-content">${renderErrorCard(options)}</main>\n${ERROR_FOOTER(year)}\n</body>\n</html>\n`;
}

export function renderNoscriptRequired(year: number): { head: string; body: string } {
  return {
    head: `<noscript><style>${ERROR_PAGE_CSS}${EMBEDDED_BODY_CSS}</style></noscript>`,
    body: `<noscript><div class="ep-page"><main class="ep-main">${renderErrorCard({ copy: NOSCRIPT_COPY, showHome: false })}</main>${ERROR_FOOTER(year)}</div></noscript>`,
  };
}

export function renderLoadFailureTemplate(year: number): string {
  return `<template id="bm-fatal"><style>${ERROR_PAGE_CSS}${EMBEDDED_BODY_CSS}</style><div class="ep-page"><main class="ep-main">${renderErrorCard({ copy: LOAD_FAILURE_COPY, showHome: false })}</main>${ERROR_FOOTER(year)}</div></template>`;
}
