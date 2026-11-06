import type { Directive } from "vue";

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
