/** Nested pages replace only their panel, never the authenticated navigation shell. */
export function workspaceRouteKey(route: { meta: { auth?: unknown }; name?: unknown; path: string }): string {
  if (route.meta.auth === 'mail') return 'mail-workspace';
  if (route.meta.auth === 'admin') return 'admin-workspace';
  return String(route.name ?? route.path);
}
