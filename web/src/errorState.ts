import { reactive } from "vue";

/**
 * 页面运行中遇到无法继续的错误（路由模块加载失败、组件渲染抛出异常）时记下来，由 App.vue 显示统一风格的错误页。
 * 下一次成功的导航会清除它，不强制刷新整页，也不丢弃正在编辑的内容。
 */
export const fatalError = reactive({ active: false, reason: "" });

const CHUNK_FAILURE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export const isChunkLoadFailure = (error: unknown): boolean => CHUNK_FAILURE.test(error instanceof Error ? error.message : String(error ?? ""));

export function reportFatal(reason: string): void {
  fatalError.active = true;
  fatalError.reason = reason.slice(0, 200);
}

export function clearFatal(): void {
  fatalError.active = false;
  fatalError.reason = "";
}
