import type { Directive } from "vue";

/**
 * 窄屏时表格改成“每行一张卡片”：给每个单元格补上列名（data-label），样式用它在值前面显示列名。
 * 已经自带 data-label 的单元格保持不动；表头里只给读屏用的列（如“操作”）也会取到文字。
 */
function label(table: HTMLTableElement): void {
  table.classList.add("is-stackable");
  const heads = Array.from(table.querySelectorAll("thead th")).map((cell) => (cell.textContent ?? "").trim());
  for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
    Array.from(row.children).forEach((cell, index) => {
      const name = heads[index];
      if (name && !cell.hasAttribute("data-label")) cell.setAttribute("data-label", name);
    });
  }
}

export const stackTableDirective: Directive<HTMLTableElement> = {
  mounted: label,
  updated: label,
};
