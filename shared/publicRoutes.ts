export const PUBLIC_ROUTE_PATHS: readonly string[] = ["/", "/login", "/register", "/password-reset", "/unavailable", "/setup"];

export function isKnownPublicPath(path: string): boolean {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return PUBLIC_ROUTE_PATHS.includes(clean) || clean === "/mail" || clean.startsWith("/mail/");
}
