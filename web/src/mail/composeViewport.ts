/** Keyboard/address-bar geometry only; no account data or global viewport policy. */
export function composeVisibleViewport(layoutHeight: number, height: number, offsetTop: number): { height: number; top: number } | null {
  if (![layoutHeight, height, offsetTop].every(Number.isFinite) || layoutHeight <= 0 || height <= 0) return null;
  const visibleHeight = Math.min(height, layoutHeight);
  return { height: visibleHeight, top: Math.min(Math.max(0, offsetTop), layoutHeight - visibleHeight) };
}

export function bindComposeViewport(element: HTMLDialogElement, host: Window = window): (preserveGeometry?: boolean) => void {
  const viewport = host.visualViewport;
  let frame: number | null = null;
  let active = true;
  let previousHeight = 0;
  const clear = () => {
    element.removeAttribute('data-compose-viewport');
    element.style.removeProperty('--compose-visible-height');
    element.style.removeProperty('--compose-visible-top');
    previousHeight = 0;
  };
  const update = () => {
    frame = null;
    if (!active) return;
    if (host.innerWidth > 900 || !viewport) { clear(); return; }
    // Preserve native pinch zoom/panning rather than shrinking the form as it zooms.
    if (Math.abs(viewport.scale - 1) > .01) return;
    const layoutHeight = Math.max(host.innerHeight, host.document.documentElement.clientHeight);
    const visible = composeVisibleViewport(layoutHeight, viewport.height, viewport.offsetTop);
    if (!visible) return;
    element.setAttribute('data-compose-viewport', '');
    element.style.setProperty('--compose-visible-height', `${visible.height}px`);
    element.style.setProperty('--compose-visible-top', `${visible.top}px`);
    if (previousHeight !== visible.height) {
      const form = element.querySelector<HTMLElement>('.compose-form');
      const focused = host.document.activeElement;
      if (form && focused && form.contains(focused)) {
        const field = focused.getBoundingClientRect(), bounds = form.getBoundingClientRect();
        if (field.bottom > bounds.bottom - 12) form.scrollTop += field.bottom - bounds.bottom + 12;
        else if (field.top < bounds.top + 12) form.scrollTop -= bounds.top + 12 - field.top;
      }
    }
    previousHeight = visible.height;
  };
  const schedule = () => { if (frame === null && active) frame = host.requestAnimationFrame(update); };
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  host.addEventListener('resize', schedule);
  update();
  return (preserveGeometry = false) => {
    active = false;
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    host.removeEventListener('resize', schedule);
    if (frame !== null) host.cancelAnimationFrame(frame);
    if (!preserveGeometry) clear();
  };
}
