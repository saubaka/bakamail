/** Opt-in DOM acceptance: layout viewport stays tall while a simulated visual viewport shrinks.
 * This is NOT a real phone/soft-keyboard acceptance claim. All mail transports remain mocked.
 */
export function installComposeViewportFixture(): void {
  if (new URLSearchParams(location.search).get('keyboard') !== '1') return;
  let keyboard = false;
  class FixtureViewport extends EventTarget {
    get height() { return keyboard ? Math.min(370, innerHeight) : innerHeight; }
    get width() { return innerWidth; }
    get offsetTop() { return keyboard ? 40 : 0; }
    get offsetLeft() { return 0; }
    get scale() { return 1; }
  }
  const viewport = new FixtureViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => viewport });
  new MutationObserver(() => {
    const form = document.querySelector('.compose-dialog .compose-form');
    if (!form || form.querySelector('[data-fixture-keyboard]')) return;
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'button button--soft field--wide';
    toggle.dataset.fixtureKeyboard = '';
    toggle.textContent = '模拟软键盘（非真机）';
    toggle.addEventListener('click', () => {
      keyboard = !keyboard;
      toggle.textContent = keyboard ? '恢复可见区域（非真机）' : '模拟软键盘（非真机）';
      viewport.dispatchEvent(new Event('resize'));
    });
    form.prepend(toggle);
  }).observe(document.body, { childList: true, subtree: true });
}
