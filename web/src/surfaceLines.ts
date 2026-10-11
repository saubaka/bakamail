import { applyOutline } from './outlineGeometry.ts';
const NS = 'http://www.w3.org/2000/svg';
const surfaces = new WeakMap<HTMLElement, { svg: SVGSVGElement; dispose: () => void; measure: () => void }>();
/** A bounded, pointer-transparent four-part outline. Geometry is measured, never mail data. */
export function attachSurfaceLines(element: HTMLElement): () => void {
  const existing = surfaces.get(element);
  if (existing) { if (!element.contains(existing.svg)) element.append(existing.svg); existing.measure(); return existing.dispose; }
  const svg = document.createElementNS(NS,'svg');
  svg.classList.add('dash-outline'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('focusable','false');
  const pieces = Array.from({length:4},(_,part) => {
    const rect = document.createElementNS(NS,'rect'); rect.classList.add('dash-outline__piece',`dash-part-${part}`);
    rect.setAttribute('vector-effect','non-scaling-stroke'); svg.append(rect); return rect;
  });
  element.append(svg);
  function measure() {
    // 宿主 span 铺满父元素的内边距盒，边框和圆角属于父元素；弹窗等直接挂载的元素就是自己。
    const reference = element.classList?.contains('line-outline-host') ? (element.parentElement ?? element) : element;
    applyOutline(svg, pieces, reference, element, 1.25);
  }
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
  observer?.observe(element); measure();
  const dispose = () => { observer?.disconnect(); svg.remove(); surfaces.delete(element); };
  surfaces.set(element,{svg,dispose,measure}); return dispose;
}
