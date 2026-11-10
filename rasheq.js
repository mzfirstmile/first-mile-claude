/* ============================================================
   Rasheq Module — rasheq.js
   External IIFE module (same pattern as deal-tracking.js)
   Loaded via <script src="rasheq.js"> in index.html
   Called via window.rasheqInit() from switchView()

   Placeholder workspace for Rasheq Zarif. Add features here.
   ============================================================ */
(function () {
  'use strict';

  let _inited = false;

  // ── CSS ──────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('rz-css')) return;
    const s = document.createElement('style');
    s.id = 'rz-css';
    s.textContent = `
      #rzRoot { color:#1e293b; }
      #rzRoot .rz-head h2 { margin:0; font-size:22px; font-weight:700; }
      #rzRoot .rz-head p { margin:4px 0 0; color:#64748b; font-size:14px; max-width:720px; }
      #rzRoot .rz-empty { margin-top:24px; border:1px dashed #cbd5e1; border-radius:12px; padding:48px 24px;
        text-align:center; color:#64748b; background:#f8fafc; }
      #rzRoot .rz-empty h3 { margin:0 0 6px; font-size:16px; color:#1e293b; }
      #rzRoot .rz-empty p { margin:0; font-size:14px; }
    `;
    document.head.appendChild(s);
  }

  // ── Render ───────────────────────────────────────────────
  function _render() {
    const root = document.getElementById('rzRoot');
    if (!root) return;
    const user = window.currentUser;
    const first = user && user.name ? user.name.split(' ')[0] : '';
    root.innerHTML = `
      <div class="rz-head">
        <h2>Rasheq</h2>
        <p>Personal workspace module.</p>
      </div>
      <div class="rz-empty">
        <h3>Nothing here yet${first ? ', ' + _esc(first) : ''}</h3>
        <p>This module is ready to be built out.</p>
      </div>
    `;
  }

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Init ─────────────────────────────────────────────────
  window.rasheqInit = function () {
    if (!_inited) {
      _injectCSS();
      _inited = true;
    }
    _render();
  };

  // This script loads after the hash router runs, so on a hard refresh of #rasheq
  // switchView's init call was a no-op. Render now if the view is already showing.
  const view = document.getElementById('view-rasheq');
  if (view && view.classList.contains('show')) window.rasheqInit();
})();
