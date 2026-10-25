// In-game credits dialog. Portals such as CrazyGames run the game inside an iframe, so credits are shown
// as plain text in a modal instead of linking to CREDITS.md (a raw .md link opens a bare text tab or a 404).
const FALLBACK = 'Credits could not be loaded. Models, sounds and textures are used under their original open licences (CC0 / CC-BY); authors are credited in the game files.';

export function bindCreditsModal(root = document) {
  const modal = root.createElement('div');
  modal.id = 'credits-modal';
  modal.className = 'credits-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'credits-title');
  modal.innerHTML = '<div class="credits-card"><header><h2 id="credits-title">CREDITS</h2><button type="button" class="credits-close" aria-label="Close credits">×</button></header><pre class="credits-body" tabindex="0"></pre></div>';
  root.body.appendChild(modal);
  const body = modal.querySelector('.credits-body');
  const closeButton = modal.querySelector('.credits-close');
  let loaded = false, opener = null;

  const load = async () => {
    if (loaded) return;
    body.textContent = 'Loading…';
    try {
      const response = await fetch('CREDITS.md', { cache: 'force-cache' });
      if (!response.ok) throw new Error(String(response.status));
      // Plain text on purpose: no links leave the game frame.
      body.textContent = (await response.text()).replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, '$1');
      loaded = true;
    } catch { body.textContent = FALLBACK; }
  };
  const open = trigger => { opener = trigger || null; modal.hidden = false; load(); closeButton.focus(); };
  const close = () => { if (modal.hidden) return; modal.hidden = true; opener?.focus?.(); opener = null; };

  closeButton.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  // Capture phase so Esc/P close the dialog instead of toggling pause underneath it.
  addEventListener('keydown', e => {
    if (modal.hidden) return;
    const key = e.key.toLowerCase();
    if (key === 'escape' || key === 'p' || key === 'enter') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) close(); }
  }, true);
  root.addEventListener('click', e => {
    const trigger = e.target.closest?.('[data-credits]');
    if (trigger) { e.preventDefault(); open(trigger); }
  });
  return { open, close, element: modal };
}
