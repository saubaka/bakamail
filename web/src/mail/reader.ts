export type AuthenticationCheck = { name: string; result: string; label: string };
export function authenticationChecks(headers: Record<string, string>): AuthenticationCheck[] {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const auth = normalized['authentication-results'] ?? '';
  return ['SPF', 'DKIM', 'DMARC'].map(name => {
    const values = [...auth.matchAll(new RegExp(`\\b${name}\\s*=\\s*([a-z]+)\\b`, 'gi'))].map(match => match[1]!.toLowerCase());
    if (name === 'SPF' && !values.length) {
      const spf = normalized['received-spf']?.match(/^\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/i);
      if (spf) values.push(spf[1]!.toLowerCase());
    }
    const result = values.find(value => value !== 'pass') ?? values[0] ?? 'unknown';
    const label = result === 'pass' ? '通过' : ['fail', 'softfail'].includes(result) ? '未通过' : ['temperror', 'permerror'].includes(result) ? '验证异常' : '未确认';
    return { name, result, label };
  });
}
export function authenticationSummary(checks: AuthenticationCheck[]): string {
  if (checks.some(check => ['fail', 'softfail', 'temperror', 'permerror'].includes(check.result))) return '安全认证 · 需留意';
  const count = checks.filter(check => check.result === 'pass').length;
  return count === 3 ? '安全认证 · 全部通过' : count ? `安全认证 · ${count}/3 通过` : '安全认证 · 未确认';
}
/** Mail-authored scripts are stripped; the reader remains an opaque-origin sandbox. */
export function sanitizeReaderHtml(source: string, allowRemote: boolean): { html: string; blocked: number } {
  if (!source) return { html: '', blocked: 0 };
  const doc = new DOMParser().parseFromString(source, 'text/html');
  for (const node of doc.querySelectorAll('script, iframe, object, embed, form, base, meta, link, audio, video, source')) node.remove();
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || attribute.name.toLowerCase() === 'nonce' || (['href', 'src', 'xlink:href'].includes(attribute.name) && /^\s*javascript:/i.test(attribute.value))) element.removeAttribute(attribute.name);
    }
  }
  let blocked = 0;
  for (const image of doc.querySelectorAll('img')) {
    image.removeAttribute('srcset');
    const src = image.getAttribute('src') ?? '';
    if (!allowRemote && /^(?:https?:)?\/\//i.test(src)) {
      const placeholder = doc.createElement('span');
      placeholder.className = 'baka-blocked-image';
      placeholder.setAttribute('role', 'img');
      placeholder.setAttribute('aria-label', '远程图片已隐藏');
      placeholder.setAttribute('style', 'display:block;box-sizing:border-box;max-width:100%;padding:16px;margin:8px 0;border:1px solid #d9e8f6;border-radius:10px;color:#6c7d91;background:#f7f9fc;font-size:12px;');
      placeholder.textContent = image.getAttribute('alt') || '远程图片已隐藏';
      image.replaceWith(placeholder);
      blocked++;
    }
  }
  return { html: doc.body.innerHTML, blocked };
}
/**
 * 页面由服务端下发带 nonce 的内容安全策略时，srcdoc 框架会继承它，框架里的脚本必须使用同一个 nonce。
 * 没有页面 nonce（例如本地开发服务器）时退回到每个框架自己的随机令牌。邮件作者拿不到这个值：
 * 邮件里的脚本和 nonce 属性都会被净化掉，框架内也没有别的脚本。
 */
export function pageScriptNonce(): string {
  if (typeof document === 'undefined') return '';
  const nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
  return /^[A-Za-z0-9+/]{16,64}={0,2}$/.test(nonce) ? nonce : '';
}
export function readerFrameDocument(html: string, allowRemote: boolean, scrollToken?: string, scriptNonce = scrollToken): string {
  if (scrollToken && !/^[a-f0-9]{48}$/.test(scrollToken)) throw new Error('Invalid reader scroll token');
  if (scriptNonce && !/^[A-Za-z0-9+/]{16,64}={0,2}$|^[a-f0-9]{48}$/.test(scriptNonce)) throw new Error('Invalid reader script nonce');
  const csp = `default-src 'none'; img-src data: cid:${allowRemote ? ' https: http:' : ''}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'${scrollToken ? `; script-src 'nonce-${scriptNonce}'` : ''}`;
  // This sole first-party script reports geometry only. No mail text, URLs, storage, or actions.
  const bridge = scrollToken ? `<script nonce="${scriptNonce}">(()=>{let pending=false;const report=()=>{pending=false;parent.postMessage({type:'bakamail-reader-scroll',token:'${scrollToken}',position:{top:Math.max(0,scrollY),height:innerHeight,total:Math.max(innerHeight,document.documentElement.scrollHeight)}},'*')};addEventListener('scroll',()=>{if(!pending){pending=true;requestAnimationFrame(report)}},{passive:true});addEventListener('load',report)})();</script>` : '';
  const reduced = typeof document !== 'undefined' && (document.documentElement.dataset.motion === 'reduce' || document.documentElement.dataset.performance === 'low');
  return `<!doctype html><html${reduced ? ' data-motion="reduce"' : ''}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
    body { margin:0; padding:8px 4px 24px; color:#354052; font:14px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; overflow-wrap:anywhere; }
    img { max-width:100%; height:auto; } body > :not(style) { animation:baka-reader-content 240ms ease-out both; }
    body > :nth-child(2) { animation-delay:25ms; } body > :nth-child(3) { animation-delay:50ms; }
    @keyframes baka-reader-content { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
    @media(prefers-reduced-motion:reduce) { body > * { animation:none!important; } } html[data-motion="reduce"] body > * { animation:none!important; }
  </style></head><body>${html}${bridge}</body></html>`;
}
