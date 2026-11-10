/* ============================================================
   Rasheq Module — rasheq.js
   External IIFE module (same pattern as deal-tracking.js)
   Loaded via <script src="rasheq.js"> in index.html
   Called via window.rasheqInit() from switchView()

   Workspace for Rasheq Zarif with six tabs (submodules):
   General · HR · PTO · Travel · Expense Reimbursements · Benefits.
   Each tab is a placeholder for now — fill in its render function.

   Navigation: tab switches use the app's subnav protocol
   (pushSubNav / registerSubNav), so each tab has its own URL
   (#rasheq&tab=pto) and browser Back/Forward move between tabs.
   General is the default and has no &tab= param.
   ============================================================ */
(function () {
  'use strict';

  const TABS = [
    { key: 'general',  label: 'General',               icon: '🏠', blurb: 'Overview, announcements and quick links.' },
    { key: 'hr',       label: 'HR',                    icon: '👥', blurb: 'Policies, handbook, onboarding and employee records.' },
    { key: 'pto',      label: 'PTO',                   icon: '🌴', blurb: 'Time-off balances, requests and the team calendar.' },
    { key: 'travel',   label: 'Travel',                icon: '✈️', blurb: 'Trip requests, bookings and travel policy.' },
    { key: 'expenses', label: 'Expense Reimbursements', icon: '🧾', blurb: 'Submit receipts and track reimbursement status.' },
    { key: 'benefits', label: 'Benefits',              icon: '💙', blurb: 'Health, retirement and other benefit plans.' },
  ];
  const DEFAULT_TAB = 'general';

  let _inited = false;
  let _tab = DEFAULT_TAB;

  function _isTab(k) { return TABS.some(t => t.key === k); }

  // ── CSS ──────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('rz-css')) return;
    const s = document.createElement('style');
    s.id = 'rz-css';
    s.textContent = `
      #rzRoot { color:#1e293b; }
      #rzRoot .rz-head h2 { margin:0; font-size:22px; font-weight:700; }
      #rzRoot .rz-head p { margin:4px 0 0; color:#64748b; font-size:14px; max-width:720px; }
      #rzRoot .rz-tabs { display:flex; flex-wrap:wrap; gap:4px; margin-top:20px; border-bottom:1px solid #e2e8f0; }
      #rzRoot .rz-tab { flex:0 0 auto; border:none; background:none; padding:10px 14px; font-size:14px;
        font-weight:600; color:#64748b; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px;
        white-space:nowrap; font-family:inherit; }
      #rzRoot .rz-tab:hover { color:#1e293b; }
      #rzRoot .rz-tab.active { color:#6d28d9; border-bottom-color:#6d28d9; }
      #rzRoot .rz-tab:focus-visible { outline:2px solid #8b5cf6; outline-offset:-2px; border-radius:6px 6px 0 0; }
      #rzRoot .rz-panel { margin-top:20px; }
      #rzRoot .rz-panel h3 { margin:0; font-size:18px; font-weight:700; }
      #rzRoot .rz-panel > p { margin:4px 0 0; color:#64748b; font-size:14px; }
      #rzRoot .rz-empty { margin-top:16px; border:1px dashed #cbd5e1; border-radius:12px; padding:40px 24px;
        text-align:center; color:#64748b; background:#f8fafc; }
      #rzRoot .rz-empty .rz-empty-icon { font-size:28px; line-height:1; margin-bottom:10px; }
      #rzRoot .rz-empty h4 { margin:0 0 6px; font-size:15px; color:#1e293b; }
      #rzRoot .rz-empty p { margin:0; font-size:14px; }
    `;
    document.head.appendChild(s);
  }

  // ── Render ───────────────────────────────────────────────
  function _renderShell() {
    const root = document.getElementById('rzRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="rz-head">
        <h2>Rasheq</h2>
        <p>Personal workspace — HR, time off, travel, expenses and benefits.</p>
      </div>
      <div class="rz-tabs" role="tablist" aria-label="Rasheq sections">
        ${TABS.map(t => `
          <button class="rz-tab" role="tab" id="rz-tab-${t.key}" data-tab="${t.key}"
            aria-controls="rz-panel" onclick="rasheqShowTab('${t.key}')">${_esc(t.label)}</button>`).join('')}
      </div>
      <div class="rz-panel" id="rz-panel" role="tabpanel"></div>
    `;
    root.querySelector('.rz-tabs').addEventListener('keydown', _onTabKey);
  }

  function _renderTab() {
    const root = document.getElementById('rzRoot');
    if (!root) return;
    root.querySelectorAll('.rz-tab').forEach(b => {
      const on = b.dataset.tab === _tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    const panel = document.getElementById('rz-panel');
    if (!panel) return;
    panel.setAttribute('aria-labelledby', 'rz-tab-' + _tab);
    const t = TABS.find(x => x.key === _tab);
    panel.innerHTML = `
      <h3>${_esc(t.label)}</h3>
      <p>${_esc(t.blurb)}</p>
      <div class="rz-empty">
        <div class="rz-empty-icon" aria-hidden="true">${t.icon}</div>
        <h4>Nothing here yet</h4>
        <p>The ${_esc(t.label)} section is ready to be built out.</p>
      </div>
    `;
  }

  // Arrow-key navigation across the tab strip (standard tablist behaviour).
  function _onTabKey(e) {
    const i = TABS.findIndex(t => t.key === _tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    _showTab(TABS[n].key);
    const btn = document.getElementById('rz-tab-' + TABS[n].key);
    if (btn) btn.focus();
  }

  // ── Tab switching + history ──────────────────────────────
  function _showTab(key, fromHistory) {
    if (!_isTab(key)) key = DEFAULT_TAB;
    if (key === _tab && document.querySelector('#rzRoot .rz-tab.active')) return;
    _tab = key;
    _renderTab();
    if (fromHistory || !window.pushSubNav) return;
    // Every tab click is its own history entry (General = plain #rasheq), so Back walks
    // through the tabs in the order they were visited.
    if (key === DEFAULT_TAB) window.pushSubNav('rasheq', null);
    else window.pushSubNav('rasheq', key, 'tab=' + key);
  }

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Public API ───────────────────────────────────────────
  window.rasheqShowTab = (k) => _showTab(k);

  if (window.registerSubNav) {
    // Browser Back/Forward (or a pasted #rasheq&tab=… link) → show that tab.
    window.registerSubNav('rasheq', (sub) => _showTab(sub || DEFAULT_TAB, true));
  }

  window.rasheqInit = function () {
    if (!_inited) {
      _injectCSS();
      _inited = true;
    }
    // Deep link: #rasheq&tab=pto opens straight on that tab.
    const fromHash = window.getHashParam ? window.getHashParam('tab') : null;
    _tab = _isTab(fromHash) ? fromHash : DEFAULT_TAB;
    _renderShell();
    _renderTab();
    if (_tab !== DEFAULT_TAB && window.pushSubNav && !(history.state && history.state.sub === _tab)) {
      // Record the deep-linked tab on the current entry so Back/Forward stay consistent.
      history.replaceState({ view: 'rasheq', sub: _tab }, '', '#rasheq&tab=' + _tab);
    }
  };

  // This script loads after the hash router runs, so on a hard refresh of #rasheq
  // switchView's init call was a no-op. Render now if the view is already showing.
  const view = document.getElementById('view-rasheq');
  if (view && view.classList.contains('show')) window.rasheqInit();
})();
