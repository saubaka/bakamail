import { api } from "./client.ts";
import type { SeoConfig, SeoEffective, SeoReport } from "../../../shared/seo.ts";

export type SeoState = {
  config: SeoConfig;
  revision: number;
  updatedAt: string;
  origin: { value: string; source: "setting" | "env" | "none" };
  envOrigin: string;
  effective: SeoEffective;
  report: SeoReport;
};

const base = "/api/admin/seo";

export const loadSeo = (): Promise<SeoState> => api(base);
export const saveSeo = (config: SeoConfig, revision: number): Promise<SeoState> => api(base, { method: "PUT", body: { ...config, revision } });
export const resetSeo = (): Promise<SeoState> => api(base, { method: "DELETE" });
