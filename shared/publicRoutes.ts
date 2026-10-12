/**
 * 站点自己的公开前端页面。服务器只对这些地址返回 200；
 * 其他地址（包括可自定义的后台入口）一律返回 404 状态——页面外壳照样下发，前端自己判断显示什么，
 * 这样后台入口和任意乱写的地址在 HTTP 层面看不出区别，不会因为状态码被人探测出后台路径，
 * 搜索引擎也不会把不存在的网址当成正常页面（避免“软 404”）。
 */
export const PUBLIC_ROUTE_PATHS: readonly string[] = ["/", "/login", "/register", "/password-reset", "/unavailable", "/setup"];

/** 邮箱工作台的所有页面都在 /mail 下面（需要登录，没登录时前端跳转到登录页）。 */
export function isKnownPublicPath(path: string): boolean {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return PUBLIC_ROUTE_PATHS.includes(clean) || clean === "/mail" || clean.startsWith("/mail/");
}
