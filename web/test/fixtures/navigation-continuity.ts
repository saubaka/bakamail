/** Local-only DOM/rAF evidence for the real shells. No server, credentials or mail writes. */
import type { Router } from 'vue-router';
import { nextTick } from 'vue';

export function installNavigationContinuity(router: Router, kind: 'admin' | 'mail'): void {
  const control = document.createElement('button');
  control.type = 'button'; control.textContent = '菜单连续性验收';
  control.style.cssText = 'position:fixed;right:16px;bottom:90px;z-index:2100;padding:8px;background:white;border:1px solid #d8e8f7;border-radius:10px';
  const output = document.createElement('output'); output.id = 'navigation-continuity-evidence'; output.hidden = true;
  document.body.append(control, output);
  control.onclick = async () => {
    control.disabled = true;
    const shellSelector = kind === 'admin' ? '.admin-shell' : '.mail-workspace';
    const sidebarSelector = kind === 'admin' ? '#admin-sidebar' : '#mail-navigation-panel';
    const shell = document.querySelector(shellSelector), sidebar = document.querySelector(sidebarSelector);
    const documentRoot = document.getElementById('app');
    const viewport = { width: innerWidth, height: innerHeight, motion: document.documentElement.dataset.motion };
    if (!shell || !sidebar) { output.textContent = JSON.stringify({ ok: false, reason: 'missing shell' }); control.disabled = false; return; }
    let frames = 0, absentFrames = 0, replacements = 0, shellAnimationFrames = 0, disabledFrames = 0;
    let frame = 0, previous = performance.now(), maxFrameGapMs = 0;
    const samples: unknown[] = [];
    const changes: unknown[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node === sidebar || (node instanceof Element && node.contains(sidebar))) replacements++;
      }
    });
    observer.observe(documentRoot!, { childList: true, subtree: true });
    const sample = (time: number) => {
      frames++; maxFrameGapMs = Math.max(maxFrameGapMs, time - previous); previous = time;
      const same = shell === document.querySelector(shellSelector) && sidebar === document.querySelector(sidebarSelector) && sidebar.isConnected;
      if (!same) absentFrames++;
      if (shell.className.includes('baka-route-')) shellAnimationFrames++;
      const disabled = sidebar.querySelectorAll('.dock-navigation-item:disabled').length;
      if (disabled) disabledFrames++;
      if (samples.length < 1000) samples.push({ time: Math.round(time), route: router.currentRoute.value.path, same, disabled, shellClass: shell.className });
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    try {
      const paths = kind === 'admin'
        ? ['/bakaadmin/accounts', '/bakaadmin/invites', '/bakaadmin/system', '/bakaadmin/admins']
        : ['/mail/search', '/mail/contacts', '/mail/drafts', '/mail/settings'];
      for (const path of paths) {
        await router.push(path); await nextTick(); await pause(400);
        changes.push({ path, shellSame: shell === document.querySelector(shellSelector), sidebarSame: sidebar === document.querySelector(sidebarSelector),
          documentSame: documentRoot === document.getElementById('app'), panels: document.querySelectorAll(kind === 'admin' ? '.admin-route-panel' : '.workspace-route-panel').length });
      }
      // Exercise actual mail menu click handlers while the preceding transition is still running.
      let latestIntent = true;
      let currentPageIntent = true;
      if (kind === 'mail') {
        const buttons = Array.from(sidebar.querySelectorAll<HTMLButtonElement>('.dock-navigation-item'));
        buttons.find(b => b.textContent?.trim() === '搜索')?.click();
        await pause(40);
        buttons.find(b => b.textContent?.trim() === '联系人')?.click();
        await pause(40);
        buttons.find(b => b.textContent?.trim() === '草稿')?.click();
        await pause(40);
        buttons.find(b => b.textContent?.trim() === '设置')?.click();
        await pause(850);
        latestIntent = router.currentRoute.value.path === '/mail/settings';
        // Clicking the already-active page must cancel an older pending destination too.
        buttons.find(b => b.textContent?.trim() === '搜索')?.click();
        await pause(40);
        buttons.find(b => b.textContent?.trim() === '设置')?.click();
        await pause(850);
        currentPageIntent = router.currentRoute.value.path === '/mail/settings';
      }
      const panels = document.querySelectorAll(kind === 'admin' ? '.admin-route-panel' : '.workspace-route-panel').length;
      output.textContent = JSON.stringify({ ok: absentFrames === 0 && replacements === 0 && shellAnimationFrames === 0 && disabledFrames === 0 && latestIntent && currentPageIntent && panels === 1,
        kind, viewport, frames, absentFrames, replacements, shellAnimationFrames, disabledFrames, latestIntent, currentPageIntent, panels,
        maxFrameGapMs: Math.round(maxFrameGapMs), changes, samples });
    } catch (error) { output.textContent = JSON.stringify({ ok: false, error: String(error) }); }
    finally { cancelAnimationFrame(frame); observer.disconnect(); control.disabled = false; }
  };
}
