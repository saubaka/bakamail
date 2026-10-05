import { api } from "../api/client.ts";
import { adminPathProblem } from "../../../shared/adminPaths.ts";

export type EntrySettings = { adminBase: string; revision: number };
export type InstallationStatus = { initialized: boolean; entry?: EntrySettings };

export async function readInstallation(path: string, signal?: AbortSignal): Promise<InstallationStatus> {
  const candidate = `/${path.split("/")[1] ?? ""}`;
  const query = adminPathProblem(candidate) ? "" : `?entry=${encodeURIComponent(candidate)}`;
  const status = await api<InstallationStatus>(`/api/installation${query}`, { signal });
  if (typeof status.initialized !== "boolean" || (status.entry &&
    (adminPathProblem(status.entry.adminBase) || !Number.isSafeInteger(status.entry.revision)
      || status.entry.adminBase !== candidate))) throw new Error("初始化状态响应不合法");
  return status;
}
