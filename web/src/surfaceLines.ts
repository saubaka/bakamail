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
    const width = Math.max(1,element.clientWidth), height = Math.max(1,element.clientHeight);
    const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 12;
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    pieces.forEach(rect => { rect.setAttribute('x','1.5');rect.setAttribute('y','1.5');rect.setAttribute('width',String(Math.max(0,width-3)));rect.setAttribute('height',String(Math.max(0,height-3)));rect.setAttribute('rx',String(Math.min(radius,width/2,height/2))); });
  }
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
  observer?.observe(element); measure();
  const dispose = () => { observer?.disconnect(); svg.remove(); surfaces.delete(element); };
  surfaces.set(element,{svg,dispose,measure}); return dispose;
}
