import { reactive } from "vue";

/**
 * 后台页面切换的“进行中”状态。路由守卫要等服务端确认身份后才会真正切换页面，
 * 这段时间菜单仍应立刻响应：高亮点击的目标，并显示顶部加载线。
 */
export const navigationState = reactive({ pending: "", pendingPath: "" });

export function beginAdminNavigation(name: unknown, fullPath: string): void {
  navigationState.pending = typeof name === "string" ? name : "";
  navigationState.pendingPath = fullPath;
}

export function clearAdminNavigation(): void {
  navigationState.pending = "";
  navigationState.pendingPath = "";
}
