import { reactive } from "vue";

export const navigationState = reactive({ pending: "", pendingPath: "" });

export function beginAdminNavigation(name: unknown, fullPath: string): void {
  navigationState.pending = typeof name === "string" ? name : "";
  navigationState.pendingPath = fullPath;
}

export function clearAdminNavigation(): void {
  navigationState.pending = "";
  navigationState.pendingPath = "";
}
