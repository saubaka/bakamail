import { reactive } from "vue";

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
