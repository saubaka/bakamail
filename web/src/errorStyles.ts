import { ERROR_PAGE_CSS } from "../../shared/errorPage.ts";

/** 错误页的样式与服务器返回的错误页是同一份（shared/errorPage.ts），第一次用到时放进页面。 */
export function ensureErrorStyles(doc: Pick<Document, "getElementById" | "createElement" | "head"> = document): void {
  if (doc.getElementById("bm-error-css")) return;
  const style = doc.createElement("style");
  style.id = "bm-error-css";
  style.textContent = ERROR_PAGE_CSS;
  doc.head.appendChild(style);
}
