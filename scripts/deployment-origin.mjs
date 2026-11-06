export function deploymentOrigin(value) {
  if (typeof value !== 'string' || !value) throw Error('Missing configured PUBLIC_ORIGIN');
  let url;
  try { url = new URL(value); } catch { throw Error('Invalid configured PUBLIC_ORIGIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || value !== url.origin) throw Error('PUBLIC_ORIGIN must be a canonical HTTPS origin');
  return url.origin;
}

export const deploymentOriginProbe = `console.log(process.env.PUBLIC_ORIGIN || "")`;
