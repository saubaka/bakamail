export type ScrollPosition = { top: number; height: number; total: number };
export function validScrollPosition(value: unknown): value is ScrollPosition {
  if (!value || typeof value !== 'object') return false;
  const p = value as ScrollPosition;
  return [p.top,p.height,p.total].every(n => Number.isFinite(n) && n >= 0 && n < 10000000) && p.height > 0 && p.total >= p.height;
}
/** Downward reading hides chrome; upward review, top, and end-of-content reveal it. */
export function createDockScrollIntent() {
  let source = '', last = 0, distance = 0, direction = 0, hidden = false;
  return {
    reset() { source = ''; distance = direction = 0; hidden = false; },
    update(key: string, p: ScrollPosition): boolean {
      if (!validScrollPosition(p)) return hidden;
      if (p.top <= 10 || p.top + p.height >= p.total - 16) { source = key; last = p.top; distance = direction = 0; return hidden = false; }
      if (source !== key) { source = key; last = p.top; distance = direction = 0; return hidden; }
      const delta = p.top - last; last = p.top;
      if (Math.abs(delta) < 1) return hidden;
      const nextDirection = Math.sign(delta);
      distance = nextDirection === direction ? distance + Math.abs(delta) : Math.abs(delta); direction = nextDirection;
      if (direction > 0 && distance >= 32) hidden = true;
      if (direction < 0 && distance >= 18) hidden = false;
      return hidden;
    },
  };
}
