/**
 * 错误页面：文案、样式和 HTML 都集中在这里。
 * 服务器返回的错误页、前端的 404/不可用页、脚本加载失败的兜底页、给反向代理用的静态 502/504 页共用同一份，
 * 外观不会各画各的。全部是纯函数，不依赖运行环境；页面不含脚本，只靠链接重试。
 */

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

/** 脚本没能加载或页面运行出错时显示，不对应真实的 HTTP 状态。 */
export const LOAD_FAILURE_COPY: ErrorCopy = { title: "页面没有加载出来", message: "网络可能不稳定，或者页面刚刚更新过。重新加载一次通常就好了。", retry: true };
/** 页面需要脚本才能使用，浏览器关闭了脚本时显示。 */
export const NOSCRIPT_COPY: ErrorCopy = { title: "需要开启 JavaScript", message: "这个页面需要 JavaScript 才能使用，请在浏览器里开启后刷新。", retry: false };

export const errorCopy = (status: number): ErrorCopy => ERROR_COPY[status] ?? ERROR_COPY[status >= 500 ? 500 : 400]!;
/** 5xx 用偏暖的数字颜色，4xx 用主题浅蓝。 */
export const isServerError = (status: number): boolean => status >= 500;
export const SUPPORTED_ERROR_STATUSES = Object.keys(ERROR_COPY).map(Number);

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** 与 web/public/logo.svg 相同的标志（去掉了标题和尺寸属性），内联后页面不依赖任何外部文件。 */
export const ERROR_LOGO_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect width="40" height="40" rx="13" fill="#e5effb"/>'
  + '<g transform="rotate(-2 20 20)" fill="#fff" fill-opacity=".42" stroke="#bed8ef" stroke-width="1.5">'
  + '<path d="M14.333 11.25H14.333A3.417 3.417 0 0 1 17.75 14.667V24.5A4.25 4.25 0 0 1 13.5 28.75H12.667A3.417 3.417 0 0 1 9.25 25.333V16.333A5.083 5.083 0 0 1 14.333 11.25Z"/>'
  + '<path d="M25.667 11.25H25.667A5.083 5.083 0 0 1 30.75 16.333V25.333A3.417 3.417 0 0 1 27.333 28.75H26.5A4.25 4.25 0 0 1 22.25 24.5V14.667A3.417 3.417 0 0 1 25.667 11.25Z" transform="translate(0 2) rotate(3 26.5 20)"/></g></svg>';

/** 图标内联成数据地址：后端挂掉时反向代理返回的静态页也能带上图标，不再向服务请求。 */
const ERROR_FAVICON = `data:image/svg+xml,${encodeURIComponent(ERROR_LOGO_SVG.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '))}`;

/** 页面外观。颜色取自站点主题：雾白底、浅蓝描边、石墨蓝文字；动画在“减少动画”时全部关闭。 */
export const ERROR_PAGE_CSS = `
.ep-body,.ep-page{box-sizing:border-box;margin:0;min-height:100vh;min-height:100svh;display:flex;flex-direction:column;background:#F7F9FC;color:#354052;font-family:ui-rounded,"Microsoft YaHei UI","PingFang SC","Noto Sans CJK SC",system-ui,-apple-system,sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
.ep-page{position:relative;z-index:1}
.ep-main{flex:1;display:grid;place-items:center;padding:48px 24px 32px;min-width:0}
.ep-main:focus{outline:none}
.ep-card{box-sizing:border-box;width:min(440px,100%);padding:34px 36px 30px;border:1px solid #dceaf7;border-radius:26px;background:#fff;text-align:center;animation:ep-rise .45s cubic-bezier(.2,.8,.2,1) both}
.ep-logo{display:block;width:56px;height:56px;margin:0 auto;animation:ep-pop .55s cubic-bezier(.2,1.25,.35,1) .03s both}
.ep-logo svg{display:block;width:100%;height:100%}
.ep-site{margin:10px 0 0;font-size:13px;font-weight:600;letter-spacing:.025em;color:#667085}
.ep-code{display:flex;justify-content:center;margin:6px 0 0;font-size:clamp(64px,19vw,92px);font-weight:650;line-height:1.05;letter-spacing:.02em;color:#bed8ef;user-select:none}
.ep--server .ep-code{color:#efc8c5}
.ep-code span{display:inline-block;animation:ep-digit .5s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(.1s + var(--i,0)*.06s)}
.ep-title{margin:4px 0 8px;font-size:24px;line-height:1.35;font-weight:650;letter-spacing:-.02em;color:#354052;animation:ep-fade .4s ease .2s both}
.ep-message{max-width:340px;margin:0 auto;font-size:14px;line-height:1.75;color:#667085;overflow-wrap:anywhere;animation:ep-fade .4s ease .25s both}
.ep-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:26px;animation:ep-fade .4s ease .3s both}
.ep-button,.ep-link{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border:1px solid #bed8ef;border-radius:13px;font:inherit;font-size:14px;font-weight:600;color:#354052;text-decoration:none;cursor:pointer;transition:transform 180ms ease,background 180ms ease,border-color 180ms ease,box-shadow 180ms ease}
.ep-button{background:#E5EFFB}
.ep-link{background:#fff;border-color:#dceaf7}
.ep-actions>.ep-link:only-child{background:#E5EFFB;border-color:#bed8ef}
.ep-button:hover,.ep-link:hover{transform:translateY(-2px);background:#d9e9fa;box-shadow:0 1px 2px rgba(61,82,110,.06)}
.ep-button:active,.ep-link:active{transform:translateY(0) scale(.98)}
.ep-button:focus-visible,.ep-link:focus-visible{outline:2px solid #bed8ef;outline-offset:3px}
.ep-meta{margin:22px 0 0;font-size:12px;color:#667085;overflow-wrap:anywhere;animation:ep-fade .4s ease .35s both}
.ep-meta code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#354052}
.ep-footer{flex:none;padding:0 24px 24px;text-align:center;font-size:11px;line-height:1.7;color:#667085}
.ep-footer p{margin:0}
@keyframes ep-rise{from{opacity:0;transform:translate3d(0,14px,0) scale(.985)}to{opacity:1;transform:none}}
@keyframes ep-pop{from{opacity:0;transform:scale(.7) rotate(-6deg)}to{opacity:1;transform:none}}
@keyframes ep-digit{from{opacity:0;transform:translate3d(0,18px,0)}to{opacity:1;transform:none}}
@keyframes ep-fade{from{opacity:0;transform:translate3d(0,6px,0)}to{opacity:1;transform:none}}
@media (max-width:480px){.ep-main{padding:32px 20px 24px}.ep-card{padding:30px 24px 26px}.ep-title{font-size:22px}.ep-actions .ep-button,.ep-actions .ep-link{flex:1 1 140px}}
@media (prefers-reduced-motion:reduce){.ep-card,.ep-logo,.ep-code span,.ep-title,.ep-message,.ep-actions,.ep-meta{animation:none!important}.ep-button,.ep-link{transition:none!important}}
`.trim();

/** 嵌进应用页面时（样式文件可能也没加载），去掉浏览器默认的页边距并铺上主题底色。 */
const EMBEDDED_BODY_CSS = "body{margin:0;background:#F7F9FC}";

export type ErrorCardOptions = {
  /** 显示的状态码；没有时不显示大数字（例如脚本加载失败）。 */
  status?: number;
  copy?: ErrorCopy;
  siteName?: string;
  requestId?: string;
  /** 429 / 503 的建议等待秒数。 */
  retryAfter?: number;
  /** 重试链接的地址；不填则刷新当前页。 */
  retryHref?: string;
  homeHref?: string;
  showHome?: boolean;
};

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** 页面中间那张卡片的 HTML，不含 <html> 外壳，可以放进 <template> 或页面里。 */
export function renderErrorCard(options: ErrorCardOptions): string {
  const status = options.status;
  const copy = options.copy ?? (status ? errorCopy(status) : LOAD_FAILURE_COPY);
  const server = status === undefined || isServerError(status);
  const digits = status === undefined ? "" : `<p class="ep-code" aria-hidden="true">${[...String(status)].map((digit, index) => `<span style="--i:${index}">${digit}</span>`).join("")}</p>`;
  const wait = options.retryAfter && Number.isFinite(options.retryAfter) && options.retryAfter > 0 ? `请大约等待 ${Math.ceil(options.retryAfter)} 秒后再试。` : "";
  // 错误编号只对服务器内部的错误有用；找不到页面这类情况不显示，避免干扰。
  const id = server && options.requestId && REQUEST_ID.test(options.requestId) ? `<p class="ep-meta">错误编号 <code>${escapeHtml(options.requestId)}</code></p>` : "";
  const retry = copy.retry ? `<a class="ep-link" href="${escapeHtml(options.retryHref ?? "")}">重试</a>` : "";
  const home = options.showHome === false ? "" : `<a class="ep-button" href="${escapeHtml(options.homeHref ?? "/")}">返回首页</a>`;
  return `<section class="ep-card${server ? " ep--server" : ""}" aria-labelledby="ep-title">`
    + `<span class="ep-logo">${ERROR_LOGO_SVG}</span>`
    + (options.siteName ? `<p class="ep-site">${escapeHtml(options.siteName)}</p>` : "")
    + digits
    + `<h1 class="ep-title" id="ep-title">${escapeHtml(copy.title)}</h1>`
    + `<p class="ep-message">${escapeHtml(copy.message)}${wait ? ` ${wait}` : ""}</p>`
    + (home || retry ? `<div class="ep-actions">${home}${retry}</div>` : "")
    + id
    + `</section>`;
}

export const ERROR_FOOTER = (year: number): string => `<footer class="ep-footer"><p>© ${year} saubaka. BakaMail.</p></footer>`;

/** 完整的独立页面（服务器直接返回，或存成静态文件给反向代理用）。 */
export function renderErrorDocument(options: ErrorCardOptions & { year?: number; title?: string }): string {
  const status = options.status;
  const copy = options.copy ?? (status ? errorCopy(status) : LOAD_FAILURE_COPY);
  const year = options.year ?? new Date().getFullYear();
  const pageTitle = options.title ?? `${status ? `${status} ` : ""}${copy.title}${options.siteName ? ` - ${options.siteName}` : ""}`;
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n`
    + `<meta name="robots" content="noindex, nofollow" />\n<meta name="color-scheme" content="light" />\n<meta name="theme-color" content="#F7F9FC" />\n`
    + `<title>${escapeHtml(pageTitle)}</title>\n<link rel="icon" href="${ERROR_FAVICON}" />\n<style>${ERROR_PAGE_CSS}</style>\n</head>\n`
    + `<body class="ep-body">\n<main class="ep-main" id="main-content">${renderErrorCard(options)}</main>\n${ERROR_FOOTER(year)}\n</body>\n</html>\n`;
}

/**
 * 浏览器关闭脚本时，普通页面显示的提示。样式放在 <head> 里的 <noscript>（规范允许），提示本身放在 <body> 里的 <noscript>；
 * 两段要分别插进页面。
 */
export function renderNoscriptRequired(year: number): { head: string; body: string } {
  return {
    head: `<noscript><style>${ERROR_PAGE_CSS}${EMBEDDED_BODY_CSS}</style></noscript>`,
    body: `<noscript><div class="ep-page"><main class="ep-main">${renderErrorCard({ copy: NOSCRIPT_COPY, showHome: false })}</main>${ERROR_FOOTER(year)}</div></noscript>`,
  };
}

/** 前端脚本没有加载起来时的兜底：放在 <template> 里，由页面里的小脚本在需要时取出来显示。 */
export function renderLoadFailureTemplate(year: number): string {
  return `<template id="bm-fatal"><style>${ERROR_PAGE_CSS}${EMBEDDED_BODY_CSS}</style><div class="ep-page"><main class="ep-main">${renderErrorCard({ copy: LOAD_FAILURE_COPY, showHome: false })}</main>${ERROR_FOOTER(year)}</div></template>`;
}
