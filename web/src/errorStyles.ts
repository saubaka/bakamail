import { ERROR_PAGE_CSS } from "../../shared/errorPage.ts";

export function ensureErrorStyles(doc: Pick<Document, "getElementById" | "createElement" | "head"> = document): void {
  if (doc.getElementById("bm-error-css")) return;
  const style = doc.createElement("style");
  style.id = "bm-error-css";
  style.textContent = ERROR_PAGE_CSS;
  doc.head.appendChild(style);
}
