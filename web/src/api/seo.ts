import { api } from "./client.ts";
import type { SeoConfig, SeoEffective, SeoReport } from "../../../shared/seo.ts";

export type SeoState = {
  config: SeoConfig;
  revision: number;
  updatedAt: string;
  /** 服务器最终采用的规范网址及来源：后台设置、服务器环境（PUBLIC_ORIGIN）或没有。 */
  origin: { value: string; source: "setting" | "env" | "none" };
  /** 服务器环境里的公开地址（PUBLIC_ORIGIN）；清空“规范网址”后会回到它。 */
  envOrigin: string;
  effective: SeoEffective;
  report: SeoReport;
};

const base = "/api/admin/seo";

export const loadSeo = (): Promise<SeoState> => api(base);
export const saveSeo = (config: SeoConfig, revision: number): Promise<SeoState> => api(base, { method: "PUT", body: { ...config, revision } });
export const resetSeo = (): Promise<SeoState> => api(base, { method: "DELETE" });
