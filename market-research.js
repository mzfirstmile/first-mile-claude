/* ============================================================
   Market Research Module — market-research.js
   External IIFE module (same pattern as initiatives.js / exec-v2.js)
   Loaded via <script src="market-research.js"> in index.html
   Called via window.marketResearchInit() from switchView()
   ============================================================ */
(function () {
  'use strict';

  let _inited = false;
  let _markets = [];
  let _criteria = [];
  let _scores = []; // [{market_id, criterion_id, value_numeric, value_text, ...}]
  let _currentMarket = null; // detail view
  let _currentUser = null;
  let _activeFilter = 'all';

  // ── CSS ──────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('mr-css')) return;
    const style = document.createElement('style');
    style.id = 'mr-css';
    style.textContent = `
      #mrRoot { padding: 24px 28px; }
      #mrRoot h2 { margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #1e293b; }
      #mrRoot .mr-subtitle { font-size: 13px; color: #94a3b8; margin: 0; }

      /* Dropbox source banner */
      #mrRoot .mr-dropbox-banner {
        display: flex; gap: 12px; align-items: flex-start;
        padding: 12px 16px;
        background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px;
        margin-bottom: 20px;
      }

      /* Header */
      #mrRoot .mr-header {
        display: flex; justify-content: space-between; align-items: flex-start;
        flex-wrap: wrap; gap: 14px; margin-bottom: 20px;
      }
      #mrRoot .mr-actions { display: flex; gap: 8px; align-items: center; }
      #mrRoot .mr-btn {
        font-size: 12px; padding: 7px 14px; border: 1px solid #cbd5e1;
        background: #fff; color: #1e293b; border-radius: 8px; cursor: pointer;
        font-weight: 500; transition: background .15s;
      }
      #mrRoot .mr-btn:hover { background: #f1f5f9; }
      #mrRoot .mr-btn-primary {
        background: #0ea5e9; color: #fff; border-color: #0ea5e9;
      }
      #mrRoot .mr-btn-primary:hover { background: #0284c7; }
      #mrRoot .mr-btn-ghost {
        border: none; background: transparent; color: #64748b;
        padding: 6px 10px; font-size: 12px;
      }
      #mrRoot .mr-btn-ghost:hover { color: #1e293b; }

      /* Filters */
      #mrRoot .mr-filters { display: flex; gap: 6px; flex-wrap: wrap; }
      #mrRoot .mr-filter-btn {
        font-size: 12px; padding: 6px 12px; border: 1px solid #e2e8f0;
        background: #fff; color: #64748b; border-radius: 16px; cursor: pointer;
        transition: all .15s;
      }
      #mrRoot .mr-filter-btn:hover { border-color: #94a3b8; color: #1e293b; }
      #mrRoot .mr-filter-btn.active {
        background: #0ea5e9; color: #fff; border-color: #0ea5e9;
      }
      #mrRoot .mr-filter-btn .mr-filter-count {
        margin-left: 6px; font-weight: 600; opacity: .7;
      }

      /* Sort dropdown */
      #mrRoot select.mr-sort {
        font-size: 12px; padding: 6px 10px; border: 1px solid #e2e8f0;
        background: #fff; color: #64748b; border-radius: 6px; cursor: pointer;
      }

      /* ── Card Grid (list view) ─────────────────────── */
      #mrRoot .mr-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 18px;
        margin-top: 18px;
      }
      #mrRoot .mr-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 20px;
        cursor: pointer;
        transition: box-shadow .15s, border-color .15s, transform .15s;
        position: relative;
        display: flex; flex-direction: column; gap: 10px;
      }
      #mrRoot .mr-card:hover {
        box-shadow: 0 4px 16px rgba(0,0,0,.08);
        border-color: #0ea5e9;
        transform: translateY(-1px);
      }
      #mrRoot .mr-card-row {
        display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;
      }
      #mrRoot .mr-card-title {
        font-size: 16px; font-weight: 600; color: #1e293b; margin: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #mrRoot .mr-card-state {
        font-size: 11px; color: #94a3b8; font-weight: 500; margin-top: 2px;
      }
      #mrRoot .mr-card-thesis {
        font-size: 12px; color: #64748b; line-height: 1.45;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* Score badge — 1-10 rating, color-graded */
      #mrRoot .mr-score {
        display: flex; flex-direction: column; align-items: center;
        min-width: 56px; padding: 6px 8px;
        border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0;
      }
      #mrRoot .mr-score-num {
        font-size: 22px; font-weight: 700; line-height: 1; color: #0f172a;
      }
      #mrRoot .mr-score-label {
        font-size: 9px; color: #94a3b8; text-transform: uppercase;
        letter-spacing: .5px; margin-top: 2px;
      }
      #mrRoot .mr-score.s8plus  .mr-score-num { color: #15803d; }
      #mrRoot .mr-score.s6to8   .mr-score-num { color: #65a30d; }
      #mrRoot .mr-score.s4to6   .mr-score-num { color: #ca8a04; }
      #mrRoot .mr-score.sUnder4 .mr-score-num { color: #b91c1c; }

      /* Tier pill — 1-4 */
      #mrRoot .mr-tier {
        font-size: 10px; font-weight: 700; padding: 3px 9px;
        border-radius: 14px; letter-spacing: .5px; text-transform: uppercase;
        display: inline-block;
      }
      #mrRoot .mr-tier.t1 { background: #dcfce7; color: #166534; }
      #mrRoot .mr-tier.t2 { background: #dbeafe; color: #1e40af; }
      #mrRoot .mr-tier.t3 { background: #fef3c7; color: #92400e; }
      #mrRoot .mr-tier.t4 { background: #f1f5f9; color: #64748b; }
      #mrRoot .mr-tier.tnone { background: #f8fafc; color: #cbd5e1; border: 1px dashed #cbd5e1; }

      /* Status pill */
      #mrRoot .mr-status {
        font-size: 10px; font-weight: 600; padding: 3px 9px;
        border-radius: 14px; text-transform: uppercase; letter-spacing: .5px;
      }
      #mrRoot .mr-status.researching     { background: #f1f5f9; color: #475569; }
      #mrRoot .mr-status.shortlisted     { background: #fef3c7; color: #92400e; }
      #mrRoot .mr-status.active_sourcing { background: #dcfce7; color: #166534; }
      #mrRoot .mr-status.on_hold         { background: #fee2e2; color: #991b1b; }
      #mrRoot .mr-status.passed          { background: #f1f5f9; color: #94a3b8; }

      /* Empty state */
      #mrRoot .mr-empty {
        text-align: center; padding: 60px 20px; color: #94a3b8;
        background: #fff; border: 2px dashed #e2e8f0; border-radius: 12px;
        margin-top: 24px;
      }
      #mrRoot .mr-empty h3 { color: #475569; font-size: 16px; margin: 0 0 8px 0; }
      #mrRoot .mr-empty p { font-size: 13px; margin: 0 0 16px 0; }
      #mrRoot .mr-empty .mr-empty-actions { display: flex; gap: 8px; justify-content: center; }

      /* ── Detail View ─────────────────────────────────── */
      #mrRoot .mr-detail { display: none; }
      #mrRoot .mr-detail.show { display: block; }
      #mrRoot .mr-list.hidden { display: none; }

      #mrRoot .mr-back {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 13px; color: #64748b; background: none; border: none;
        cursor: pointer; padding: 0; margin-bottom: 18px;
      }
      #mrRoot .mr-back:hover { color: #1e293b; }

      #mrRoot .mr-detail-header {
        display: flex; justify-content: space-between; align-items: flex-start;
        gap: 16px; flex-wrap: wrap; margin-bottom: 20px;
      }
      #mrRoot .mr-detail-title { font-size: 26px; font-weight: 700; color: #0f172a; margin: 0; }
      #mrRoot .mr-detail-meta { display: flex; gap: 10px; align-items: center; margin-top: 8px; flex-wrap: wrap; }

      /* Top metrics row in detail */
      #mrRoot .mr-detail-metrics {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px; margin-bottom: 24px;
      }
      #mrRoot .mr-metric-card {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
        padding: 14px 16px;
      }
      #mrRoot .mr-metric-label {
        font-size: 11px; color: #94a3b8; text-transform: uppercase;
        letter-spacing: .5px; margin-bottom: 6px;
      }
      #mrRoot .mr-metric-value { font-size: 20px; font-weight: 700; color: #1e293b; }

      /* Scorecard table */
      #mrRoot .mr-scorecard {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
        margin-bottom: 24px; overflow: hidden;
      }
      #mrRoot .mr-scorecard-header {
        padding: 14px 18px; display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #e2e8f0; background: #f8fafc;
      }
      #mrRoot .mr-scorecard-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: #1e293b; }
      #mrRoot .mr-scorecard table { width: 100%; border-collapse: collapse; }
      #mrRoot .mr-scorecard th {
        padding: 10px 16px; text-align: left; font-size: 11px;
        font-weight: 600; color: #64748b; text-transform: uppercase;
        letter-spacing: .5px; background: #fafbfc;
        border-bottom: 1px solid #e2e8f0;
      }
      #mrRoot .mr-scorecard td {
        padding: 12px 16px; font-size: 13px; color: #1e293b;
        border-bottom: 1px solid #f1f5f9;
      }
      #mrRoot .mr-scorecard tr:last-child td { border-bottom: none; }
      #mrRoot .mr-scorecard input.mr-cell-input {
        font: inherit; padding: 4px 8px; border: 1px solid transparent;
        background: transparent; width: 100%; border-radius: 4px;
        color: #1e293b;
      }
      #mrRoot .mr-scorecard input.mr-cell-input:hover  { border-color: #cbd5e1; background: #fafbfc; }
      #mrRoot .mr-scorecard input.mr-cell-input:focus  { outline: none; border-color: #0ea5e9; background: #fff; }
      #mrRoot .mr-scorecard .mr-cell-source {
        font-size: 11px; color: #94a3b8; margin-top: 2px;
      }

      /* Narrative blocks */
      #mrRoot .mr-narrative {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
        padding: 18px 20px; margin-bottom: 18px;
      }
      #mrRoot .mr-narrative h4 {
        margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #1e293b;
        text-transform: uppercase; letter-spacing: .5px;
      }
      #mrRoot .mr-narrative .mr-narrative-body {
        font-size: 13px; line-height: 1.55; color: #475569; white-space: pre-wrap;
      }
      #mrRoot .mr-narrative textarea {
        width: 100%; min-height: 90px; font: inherit; padding: 10px;
        border: 1px solid #e2e8f0; border-radius: 6px; resize: vertical;
        color: #1e293b; line-height: 1.5;
      }
      #mrRoot .mr-narrative textarea:focus { outline: none; border-color: #0ea5e9; }
      #mrRoot .mr-narrative .mr-narrative-actions {
        display: flex; gap: 6px; margin-top: 10px;
      }

      /* Modal */
      #mrRoot .mr-modal-overlay {
        position: fixed; inset: 0; background: rgba(15,23,42,.5);
        display: none; align-items: center; justify-content: center;
        z-index: 9999; padding: 24px;
      }
      #mrRoot .mr-modal-overlay.show { display: flex; }
      #mrRoot .mr-modal {
        background: #fff; border-radius: 12px; max-width: 520px; width: 100%;
        max-height: 90vh; overflow-y: auto; padding: 24px;
      }
      #mrRoot .mr-modal h3 { margin: 0 0 16px 0; font-size: 17px; font-weight: 700; color: #1e293b; }
      #mrRoot .mr-modal label {
        display: block; font-size: 12px; font-weight: 600; color: #475569;
        margin-bottom: 4px; margin-top: 12px;
      }
      #mrRoot .mr-modal input, #mrRoot .mr-modal select, #mrRoot .mr-modal textarea {
        width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1;
        border-radius: 6px; font-size: 13px; color: #1e293b;
        background: #fff; font-family: inherit;
      }
      #mrRoot .mr-modal input:focus, #mrRoot .mr-modal select:focus, #mrRoot .mr-modal textarea:focus {
        outline: none; border-color: #0ea5e9;
      }
      #mrRoot .mr-modal textarea { min-height: 90px; resize: vertical; }
      #mrRoot .mr-modal .mr-modal-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      #mrRoot .mr-modal-actions {
        display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px;
      }

      /* Toast */
      #mrRoot .mr-toast {
        position: fixed; bottom: 30px; right: 30px; padding: 12px 18px;
        background: #1e293b; color: #fff; border-radius: 8px; font-size: 13px;
        z-index: 10000; opacity: 0; transition: opacity .2s;
      }
      #mrRoot .mr-toast.show { opacity: 1; }
      #mrRoot .mr-toast.error { background: #b91c1c; }
    `;
    document.head.appendChild(style);
  }

  // ── HTML scaffold ────────────────────────────────────────
  function _injectHTML() {
    const root = document.getElementById('mrRoot');
    if (!root) return;
    root.innerHTML = `
      <!-- Dropbox source banner — shown across both list and detail views -->
      <div class="mr-dropbox-banner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;color:#1e293b;font-weight:600;margin-bottom:2px;">Source folder: <span style="color:#0ea5e9;font-family:'SF Mono','Monaco',monospace;font-weight:500;">First Mile Prop Dropbox / 1.4 Special Projects / Market Research - Claude</span></div>
          <div style="font-size:12px;color:#64748b;line-height:1.45;">Criteria definitions, research links, and source datasets live here. Drop new files into that folder and Claude will pull them in to update this list (criteria, market scores, and notes).</div>
          <div style="font-size:12px;color:#0369a1;line-height:1.45;margin-top:6px;font-weight:500;">↻ Rankings will be updated as new research information and sources are added to the Dropbox folder.</div>
        </div>
      </div>

      <!-- List View -->
      <div class="mr-list" id="mrListView">
        <div class="mr-header">
          <div>
            <h2>Market Research</h2>
            <p class="mr-subtitle">Target US markets &amp; cities for real estate acquisition</p>
          </div>
          <div class="mr-actions">
            <button class="mr-btn" onclick="mrManageCriteria()">⚙ Criteria</button>
            <button class="mr-btn mr-btn-primary" onclick="mrNewMarket()">+ New Market</button>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div class="mr-filters" id="mrFilters">
            <button class="mr-filter-btn active" data-filter="all">All <span class="mr-filter-count" id="mrCountAll"></span></button>
            <button class="mr-filter-btn" data-filter="researching">Researching <span class="mr-filter-count" id="mrCountResearching"></span></button>
            <button class="mr-filter-btn" data-filter="shortlisted">Shortlisted <span class="mr-filter-count" id="mrCountShortlisted"></span></button>
            <button class="mr-filter-btn" data-filter="active_sourcing">Active Sourcing <span class="mr-filter-count" id="mrCountActive"></span></button>
            <button class="mr-filter-btn" data-filter="on_hold">On Hold <span class="mr-filter-count" id="mrCountHold"></span></button>
            <button class="mr-filter-btn" data-filter="passed">Passed <span class="mr-filter-count" id="mrCountPassed"></span></button>
          </div>
          <select class="mr-sort" id="mrSort" onchange="mrChangeSort(this.value)">
            <option value="score_desc">Sort: Score (high → low)</option>
            <option value="tier_asc">Sort: Tier (1 → 4)</option>
            <option value="name_asc">Sort: Name (A → Z)</option>
            <option value="updated_desc">Sort: Recently updated</option>
          </select>
        </div>

        <div id="mrGrid"></div>
      </div>

      <!-- Detail View -->
      <div class="mr-detail" id="mrDetailView">
        <button class="mr-back" onclick="mrBackToList()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Markets
        </button>

        <div class="mr-detail-header">
          <div>
            <h2 class="mr-detail-title" id="mrDetailTitle"></h2>
            <div class="mr-detail-meta" id="mrDetailMeta"></div>
          </div>
          <div class="mr-actions">
            <button class="mr-btn" onclick="mrEditMarket()">Edit Market</button>
            <button class="mr-btn" onclick="mrDeleteMarket()" style="color:#b91c1c;">Delete</button>
          </div>
        </div>

        <div class="mr-detail-metrics" id="mrDetailMetrics"></div>

        <div class="mr-narrative">
          <h4>Investment Thesis</h4>
          <div id="mrThesisDisplay"></div>
        </div>

        <div class="mr-narrative">
          <h4>Executive Summary</h4>
          <div id="mrSummaryDisplay"></div>
        </div>

        <div class="mr-scorecard">
          <div class="mr-scorecard-header">
            <h3>Criteria Scorecard</h3>
            <button class="mr-btn-ghost" onclick="mrManageCriteria()">Edit criteria definitions</button>
          </div>
          <div id="mrScorecardBody"></div>
        </div>

        <div class="mr-narrative">
          <h4>Notes</h4>
          <div id="mrNotesDisplay"></div>
        </div>
      </div>

      <!-- Modal placeholder -->
      <div class="mr-modal-overlay" id="mrModalOverlay" onclick="if(event.target === this) mrCloseModal()">
        <div class="mr-modal" id="mrModalContent"></div>
      </div>

      <!-- Toast -->
      <div class="mr-toast" id="mrToast"></div>
    `;

    // Filter button wiring
    root.querySelectorAll('.mr-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.mr-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _activeFilter = btn.dataset.filter;
        _renderGrid();
      });
    });
  }

  // ── Data loading ─────────────────────────────────────────
  async function _loadData() {
    _currentUser = window.currentUser;
    const [markets, criteria, scores] = await Promise.all([
      window.supaFetch('market_research_markets', '?select=*&order=tier.asc.nullslast,score.desc.nullslast,name.asc'),
      window.supaFetch('market_research_criteria', '?select=*&order=sort_order.asc,name.asc'),
      window.supaFetch('market_research_scores', '?select=*'),
    ]);
    _markets = markets || [];
    _criteria = criteria || [];
    _scores = scores || [];
  }

  // ── Helpers ──────────────────────────────────────────────
  function _scoreClass(score) {
    if (score == null) return '';
    if (score >= 8) return 's8plus';
    if (score >= 6) return 's6to8';
    if (score >= 4) return 's4to6';
    return 'sUnder4';
  }
  function _tierClass(tier) {
    if (tier == null) return 'tnone';
    return 't' + tier;
  }
  function _esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  function _statusLabel(s) {
    return ({ researching:'Researching', shortlisted:'Shortlisted', active_sourcing:'Active Sourcing', on_hold:'On Hold', passed:'Passed' })[s] || s;
  }
  function _toast(msg, isError) {
    const t = document.getElementById('mrToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }
  function _fmtNum(v, type) {
    if (v == null || v === '') return '—';
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    if (type === 'percent')  return n.toFixed(1) + '%';
    if (type === 'currency') return '$' + n.toLocaleString();
    if (type === 'rating_1_10') return n.toFixed(1) + '/10';
    if (type === 'rating_1_5')  return n.toFixed(1) + '/5';
    if (Math.abs(n) >= 1000) return n.toLocaleString();
    return n.toString();
  }

  // ── Grid render ──────────────────────────────────────────
  function _renderGrid() {
    const gridEl = document.getElementById('mrGrid');
    if (!gridEl) return;

    // Counts for filter chips
    const counts = { all: _markets.length, researching: 0, shortlisted: 0, active_sourcing: 0, on_hold: 0, passed: 0 };
    _markets.forEach(m => { if (counts[m.status] != null) counts[m.status]++; });
    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    setCount('mrCountAll', counts.all);
    setCount('mrCountResearching', counts.researching);
    setCount('mrCountShortlisted', counts.shortlisted);
    setCount('mrCountActive', counts.active_sourcing);
    setCount('mrCountHold', counts.on_hold);
    setCount('mrCountPassed', counts.passed);

    // Filter
    let visible = _activeFilter === 'all' ? _markets.slice() : _markets.filter(m => m.status === _activeFilter);

    // Sort
    const sortSel = document.getElementById('mrSort');
    const sortMode = sortSel ? sortSel.value : 'score_desc';
    visible.sort((a, b) => {
      if (sortMode === 'score_desc') return ((b.score ?? -1) - (a.score ?? -1)) || a.name.localeCompare(b.name);
      if (sortMode === 'tier_asc')   return ((a.tier ?? 99) - (b.tier ?? 99)) || ((b.score ?? -1) - (a.score ?? -1));
      if (sortMode === 'name_asc')   return a.name.localeCompare(b.name);
      if (sortMode === 'updated_desc') return (b.updated_at || '').localeCompare(a.updated_at || '');
      return 0;
    });

    if (visible.length === 0) {
      gridEl.innerHTML = `
        <div class="mr-empty">
          <h3>${_markets.length === 0 ? 'No markets yet' : 'No markets match this filter'}</h3>
          <p>${_markets.length === 0 ? 'Start by defining your evaluation criteria, then add your first target market.' : 'Try a different filter or add a new market.'}</p>
          <div class="mr-empty-actions">
            ${_criteria.length === 0 ? '<button class="mr-btn" onclick="mrManageCriteria()">⚙ Define Criteria</button>' : ''}
            <button class="mr-btn mr-btn-primary" onclick="mrNewMarket()">+ New Market</button>
          </div>
        </div>`;
      return;
    }

    gridEl.innerHTML = `<div class="mr-grid">` + visible.map(m => {
      const tierLabel = m.tier != null ? `Tier ${m.tier}` : 'Untiered';
      const scoreNum = m.score != null ? m.score.toFixed(1) : '—';
      const stateBits = [m.state, m.msa].filter(Boolean).join(' · ');
      const pop = m.population ? `Pop: ${parseInt(m.population).toLocaleString()}` : '';
      const stateLine = [stateBits, pop].filter(Boolean).join(' · ');
      return `
        <div class="mr-card" onclick="mrOpenMarket('${m.id}')">
          <div class="mr-card-row">
            <div style="min-width:0;flex:1;">
              <h3 class="mr-card-title">${_esc(m.name)}</h3>
              ${stateLine ? `<div class="mr-card-state">${_esc(stateLine)}</div>` : ''}
            </div>
            <div class="mr-score ${_scoreClass(m.score)}">
              <div class="mr-score-num">${scoreNum}</div>
              <div class="mr-score-label">Score</div>
            </div>
          </div>
          <div class="mr-card-row">
            <span class="mr-tier ${_tierClass(m.tier)}">${tierLabel}</span>
            <span class="mr-status ${m.status}">${_statusLabel(m.status)}</span>
          </div>
          ${m.thesis ? `<div class="mr-card-thesis">${_esc(m.thesis)}</div>` : ''}
        </div>`;
    }).join('') + `</div>`;
  }

  // ── Detail render ────────────────────────────────────────
  function _openMarket(id) {
    _currentMarket = _markets.find(m => m.id === id);
    if (!_currentMarket) return;
    document.getElementById('mrListView').classList.add('hidden');
    document.getElementById('mrDetailView').classList.add('show');
    _renderDetail();
  }
  function _backToList() {
    _currentMarket = null;
    document.getElementById('mrListView').classList.remove('hidden');
    document.getElementById('mrDetailView').classList.remove('show');
  }
  function _renderDetail() {
    const m = _currentMarket;
    if (!m) return;
    document.getElementById('mrDetailTitle').textContent = m.name;

    const stateBits = [m.state, m.msa].filter(Boolean).join(' · ');
    document.getElementById('mrDetailMeta').innerHTML = `
      ${stateBits ? `<span style="font-size:13px;color:#64748b;">${_esc(stateBits)}</span>` : ''}
      <span class="mr-status ${m.status}">${_statusLabel(m.status)}</span>
    `;

    // Top metric cards
    document.getElementById('mrDetailMetrics').innerHTML = `
      <div class="mr-metric-card">
        <div class="mr-metric-label">Score (1-10)</div>
        <div class="mr-metric-value" style="color:${m.score >= 8 ? '#15803d' : (m.score >= 6 ? '#65a30d' : (m.score >= 4 ? '#ca8a04' : (m.score != null ? '#b91c1c' : '#cbd5e1')))};">${m.score != null ? m.score.toFixed(1) : '—'}</div>
      </div>
      <div class="mr-metric-card">
        <div class="mr-metric-label">Tier</div>
        <div class="mr-metric-value"><span class="mr-tier ${_tierClass(m.tier)}" style="font-size:13px;">${m.tier != null ? 'Tier ' + m.tier : 'Untiered'}</span></div>
      </div>
      ${m.population ? `
      <div class="mr-metric-card">
        <div class="mr-metric-label">Population</div>
        <div class="mr-metric-value">${parseInt(m.population).toLocaleString()}</div>
      </div>` : ''}
    `;

    // Thesis / Summary / Notes — click-to-edit
    _renderNarrative('mrThesisDisplay', m.thesis, 'thesis', 'Add investment thesis…');
    _renderNarrative('mrSummaryDisplay', m.summary, 'summary', 'Add executive summary…');
    _renderNarrative('mrNotesDisplay', m.notes, 'notes', 'Add internal notes…');

    // Scorecard
    _renderScorecard();
  }
  function _renderNarrative(elId, value, field, placeholder) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (value && value.trim()) {
      el.innerHTML = `<div class="mr-narrative-body" onclick="mrEditNarrative('${field}')" style="cursor:pointer;">${_esc(value)}</div>`;
    } else {
      el.innerHTML = `<div style="font-size:13px;color:#94a3b8;cursor:pointer;" onclick="mrEditNarrative('${field}')">${placeholder}</div>`;
    }
  }
  function _renderScorecard() {
    const m = _currentMarket;
    const bodyEl = document.getElementById('mrScorecardBody');
    if (!bodyEl) return;

    if (_criteria.length === 0) {
      bodyEl.innerHTML = `
        <div style="padding:32px 20px;text-align:center;color:#94a3b8;font-size:13px;">
          No criteria defined yet.<br>
          <button class="mr-btn mr-btn-primary" onclick="mrManageCriteria()" style="margin-top:12px;">⚙ Define Criteria</button>
        </div>`;
      return;
    }
    const scoreByCriterion = {};
    _scores.filter(s => s.market_id === m.id).forEach(s => { scoreByCriterion[s.criterion_id] = s; });

    bodyEl.innerHTML = `
      <table>
        <thead>
          <tr>
            <th style="width:35%;">Criterion</th>
            <th style="width:35%;">Value</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          ${_criteria.filter(c => c.is_active !== false).map(c => {
            const s = scoreByCriterion[c.id] || {};
            const v = c.value_type === 'text' ? (s.value_text || '') : (s.value_numeric != null ? s.value_numeric : '');
            return `
              <tr>
                <td>
                  <div style="font-weight:500;">${_esc(c.name)}</div>
                  ${c.description ? `<div style="font-size:11px;color:#94a3b8;">${_esc(c.description)}</div>` : ''}
                </td>
                <td>
                  <input class="mr-cell-input" type="${c.value_type === 'text' ? 'text' : 'number'}" step="0.01"
                         value="${_esc(v)}"
                         onchange="mrSaveScore('${c.id}', '${c.value_type}', this.value)"
                         placeholder="${c.value_type === 'percent' ? '%' : (c.value_type === 'currency' ? '$' : (c.value_type === 'rating_1_10' ? '1-10' : ''))}">
                </td>
                <td>
                  <input class="mr-cell-input" type="text"
                         value="${_esc(s.source || '')}"
                         onchange="mrSaveSource('${c.id}', this.value)"
                         placeholder="${_esc(c.source_note || 'Source / note')}">
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  // ── Modal helpers ────────────────────────────────────────
  function _openModal(title, bodyHTML) {
    const overlay = document.getElementById('mrModalOverlay');
    document.getElementById('mrModalContent').innerHTML = `<h3>${_esc(title)}</h3>${bodyHTML}`;
    overlay.classList.add('show');
  }
  function _closeModal() {
    const overlay = document.getElementById('mrModalOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  // ── CRUD: Markets ────────────────────────────────────────
  async function _newMarket() {
    _openModal('New Target Market', `
      <label>Market name *</label>
      <input id="mrNewName" placeholder="e.g. Phoenix, AZ">
      <div class="mr-modal-row">
        <div>
          <label>State</label>
          <input id="mrNewState" placeholder="AZ" maxlength="2" style="text-transform:uppercase;">
        </div>
        <div>
          <label>MSA / CBSA</label>
          <input id="mrNewMsa" placeholder="Phoenix-Mesa-Chandler">
        </div>
      </div>
      <div class="mr-modal-row">
        <div>
          <label>Population</label>
          <input id="mrNewPop" type="number" placeholder="e.g. 1645000">
        </div>
        <div>
          <label>Status</label>
          <select id="mrNewStatus">
            <option value="researching">Researching</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="active_sourcing">Active Sourcing</option>
            <option value="on_hold">On Hold</option>
            <option value="passed">Passed</option>
          </select>
        </div>
      </div>
      <div class="mr-modal-row">
        <div>
          <label>Score (1-10)</label>
          <input id="mrNewScore" type="number" step="0.1" min="1" max="10" placeholder="—">
        </div>
        <div>
          <label>Tier (1-4)</label>
          <select id="mrNewTier">
            <option value="">— Untiered —</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
            <option value="4">Tier 4</option>
          </select>
        </div>
      </div>
      <label>Investment thesis (optional)</label>
      <textarea id="mrNewThesis" placeholder="Why this market — short rationale"></textarea>
      <div class="mr-modal-actions">
        <button class="mr-btn" onclick="mrCloseModal()">Cancel</button>
        <button class="mr-btn mr-btn-primary" onclick="mrSaveNewMarket()">Create Market</button>
      </div>
    `);
  }
  async function _saveNewMarket() {
    const name = document.getElementById('mrNewName').value.trim();
    if (!name) { _toast('Market name is required', true); return; }
    const state = (document.getElementById('mrNewState').value || '').trim().toUpperCase() || null;
    const msa = (document.getElementById('mrNewMsa').value || '').trim() || null;
    const popVal = document.getElementById('mrNewPop').value;
    const population = popVal ? parseInt(popVal) : null;
    const status = document.getElementById('mrNewStatus').value;
    const scoreVal = document.getElementById('mrNewScore').value;
    const score = scoreVal ? parseFloat(scoreVal) : null;
    const tierVal = document.getElementById('mrNewTier').value;
    const tier = tierVal ? parseInt(tierVal) : null;
    const thesis = (document.getElementById('mrNewThesis').value || '').trim() || null;
    try {
      await window.supaWrite('market_research_markets', 'POST', {
        name, state, msa, population, status, score, tier, thesis,
        created_by: _currentUser?.email || null,
      });
      _closeModal();
      await _loadData();
      _renderGrid();
      _toast('Market created');
    } catch(e) { _toast('Error: ' + e.message, true); }
  }

  async function _editMarket() {
    const m = _currentMarket;
    if (!m) return;
    _openModal('Edit Market', `
      <label>Market name</label>
      <input id="mrEditName" value="${_esc(m.name)}">
      <div class="mr-modal-row">
        <div>
          <label>State</label>
          <input id="mrEditState" value="${_esc(m.state || '')}" maxlength="2" style="text-transform:uppercase;">
        </div>
        <div>
          <label>MSA / CBSA</label>
          <input id="mrEditMsa" value="${_esc(m.msa || '')}">
        </div>
      </div>
      <div class="mr-modal-row">
        <div>
          <label>Population</label>
          <input id="mrEditPop" type="number" value="${m.population || ''}">
        </div>
        <div>
          <label>Status</label>
          <select id="mrEditStatus">
            ${['researching','shortlisted','active_sourcing','on_hold','passed'].map(s =>
              `<option value="${s}" ${m.status === s ? 'selected' : ''}>${_statusLabel(s)}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="mr-modal-row">
        <div>
          <label>Score (1-10)</label>
          <input id="mrEditScore" type="number" step="0.1" min="1" max="10" value="${m.score != null ? m.score : ''}">
        </div>
        <div>
          <label>Tier</label>
          <select id="mrEditTier">
            <option value="" ${m.tier == null ? 'selected' : ''}>— Untiered —</option>
            ${[1,2,3,4].map(t => `<option value="${t}" ${m.tier === t ? 'selected' : ''}>Tier ${t}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="mr-modal-actions">
        <button class="mr-btn" onclick="mrCloseModal()">Cancel</button>
        <button class="mr-btn mr-btn-primary" onclick="mrSaveEditMarket()">Save</button>
      </div>
    `);
  }
  async function _saveEditMarket() {
    const m = _currentMarket;
    if (!m) return;
    const patch = {
      name: document.getElementById('mrEditName').value.trim(),
      state: (document.getElementById('mrEditState').value || '').trim().toUpperCase() || null,
      msa: (document.getElementById('mrEditMsa').value || '').trim() || null,
      population: document.getElementById('mrEditPop').value ? parseInt(document.getElementById('mrEditPop').value) : null,
      status: document.getElementById('mrEditStatus').value,
      score: document.getElementById('mrEditScore').value ? parseFloat(document.getElementById('mrEditScore').value) : null,
      tier: document.getElementById('mrEditTier').value ? parseInt(document.getElementById('mrEditTier').value) : null,
    };
    try {
      await window.supaWrite('market_research_markets', 'PATCH', patch, `?id=eq.${m.id}`);
      _closeModal();
      await _loadData();
      _currentMarket = _markets.find(x => x.id === m.id);
      _renderDetail();
      _renderGrid();
      _toast('Saved');
    } catch(e) { _toast('Error: ' + e.message, true); }
  }
  async function _deleteMarket() {
    const m = _currentMarket;
    if (!m) return;
    if (!confirm(`Delete market "${m.name}"? Scores for this market will also be removed.`)) return;
    try {
      await window.supaWrite('market_research_markets', 'DELETE', null, `?id=eq.${m.id}`);
      await _loadData();
      _backToList();
      _renderGrid();
      _toast('Market deleted');
    } catch(e) { _toast('Error: ' + e.message, true); }
  }

  async function _editNarrative(field) {
    const m = _currentMarket;
    if (!m) return;
    const label = ({ thesis: 'Investment Thesis', summary: 'Executive Summary', notes: 'Notes' })[field];
    const cur = m[field] || '';
    _openModal(label, `
      <textarea id="mrNarrativeArea" style="min-height:200px;">${_esc(cur)}</textarea>
      <div class="mr-modal-actions">
        <button class="mr-btn" onclick="mrCloseModal()">Cancel</button>
        <button class="mr-btn mr-btn-primary" onclick="mrSaveNarrative('${field}')">Save</button>
      </div>
    `);
    setTimeout(() => document.getElementById('mrNarrativeArea')?.focus(), 50);
  }
  async function _saveNarrative(field) {
    const m = _currentMarket;
    if (!m) return;
    const val = (document.getElementById('mrNarrativeArea').value || '').trim() || null;
    try {
      await window.supaWrite('market_research_markets', 'PATCH', { [field]: val }, `?id=eq.${m.id}`);
      m[field] = val;
      _closeModal();
      _renderDetail();
      _toast('Saved');
    } catch(e) { _toast('Error: ' + e.message, true); }
  }

  // ── Scorecard inline saves ──────────────────────────────
  async function _saveScore(criterionId, valueType, rawValue) {
    const m = _currentMarket;
    if (!m) return;
    const trimmed = (rawValue || '').toString().trim();
    const patch = { market_id: m.id, criterion_id: criterionId, updated_by: _currentUser?.email || null };
    if (valueType === 'text') {
      patch.value_text = trimmed || null;
      patch.value_numeric = null;
    } else {
      patch.value_numeric = trimmed ? parseFloat(trimmed) : null;
      patch.value_text = null;
    }
    try {
      // Upsert via Prefer: resolution=merge-duplicates
      const url = '?on_conflict=market_id,criterion_id';
      await window.supaWrite('market_research_scores', 'POST', patch, url, {
        Prefer: 'resolution=merge-duplicates,return=representation'
      });
      // Update local cache
      const existing = _scores.find(s => s.market_id === m.id && s.criterion_id === criterionId);
      if (existing) Object.assign(existing, patch);
      else _scores.push({ id: crypto.randomUUID(), ...patch });
    } catch(e) { _toast('Save failed: ' + e.message, true); }
  }
  async function _saveSource(criterionId, rawValue) {
    const m = _currentMarket;
    if (!m) return;
    const val = (rawValue || '').trim() || null;
    const existing = _scores.find(s => s.market_id === m.id && s.criterion_id === criterionId);
    try {
      if (existing && existing.id && !existing.id.startsWith('temp')) {
        await window.supaWrite('market_research_scores', 'PATCH', { source: val }, `?id=eq.${existing.id}`);
        existing.source = val;
      } else {
        await window.supaWrite('market_research_scores', 'POST', {
          market_id: m.id, criterion_id: criterionId, source: val, updated_by: _currentUser?.email || null
        }, '?on_conflict=market_id,criterion_id', { Prefer: 'resolution=merge-duplicates,return=representation' });
      }
    } catch(e) { _toast('Save failed: ' + e.message, true); }
  }

  // ── Criteria management ────────────────────────────────
  function _manageCriteria() {
    _openModal('Manage Criteria', `
      <p style="font-size:12px;color:#64748b;margin:0 0 12px 0;">
        Criteria appear as rows in every market's scorecard. Adjust the list and value types here.
      </p>
      <div id="mrCriteriaList" style="margin-bottom:16px;">
        ${_criteria.length === 0
          ? '<p style="font-size:13px;color:#94a3b8;text-align:center;padding:20px;">No criteria yet. Add your first below.</p>'
          : _criteria.map(c => `
            <div style="display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid #f1f5f9;">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:500;color:#1e293b;">${_esc(c.name)}</div>
                <div style="font-size:11px;color:#94a3b8;">${_esc(c.value_type)}${c.description ? ' · ' + _esc(c.description) : ''}</div>
              </div>
              <button class="mr-btn-ghost" onclick="mrDeleteCriterion('${c.id}', '${_esc(c.name).replace(/'/g, "\\'")}')" title="Delete" style="color:#b91c1c;">×</button>
            </div>`).join('')}
      </div>
      <h4 style="font-size:13px;color:#1e293b;margin:18px 0 8px 0;">Add new criterion</h4>
      <label>Name *</label>
      <input id="mrNewCriterionName" placeholder="e.g. Population Growth 5-yr">
      <label>Description (optional)</label>
      <input id="mrNewCriterionDesc" placeholder="Short description of what this measures">
      <div class="mr-modal-row">
        <div>
          <label>Value type</label>
          <select id="mrNewCriterionType">
            <option value="number">Number</option>
            <option value="percent">Percent (%)</option>
            <option value="currency">Currency ($)</option>
            <option value="rating_1_10">Rating 1-10</option>
            <option value="rating_1_5">Rating 1-5</option>
            <option value="text">Text</option>
            <option value="boolean">Yes / No</option>
          </select>
        </div>
        <div>
          <label>Typical source</label>
          <input id="mrNewCriterionSource" placeholder="BLS, Census, CoStar…">
        </div>
      </div>
      <div class="mr-modal-actions">
        <button class="mr-btn" onclick="mrCloseModal()">Done</button>
        <button class="mr-btn mr-btn-primary" onclick="mrAddCriterion()">+ Add Criterion</button>
      </div>
    `);
  }
  async function _addCriterion() {
    const name = document.getElementById('mrNewCriterionName').value.trim();
    if (!name) { _toast('Name is required', true); return; }
    const description = (document.getElementById('mrNewCriterionDesc').value || '').trim() || null;
    const value_type = document.getElementById('mrNewCriterionType').value;
    const source_note = (document.getElementById('mrNewCriterionSource').value || '').trim() || null;
    const sort_order = (_criteria.length + 1) * 10;
    try {
      await window.supaWrite('market_research_criteria', 'POST', { name, description, value_type, source_note, sort_order });
      await _loadData();
      _manageCriteria(); // refresh the modal
      if (_currentMarket) _renderScorecard();
      else _renderGrid();
      _toast('Criterion added');
    } catch(e) { _toast('Error: ' + e.message, true); }
  }
  async function _deleteCriterion(id, name) {
    if (!confirm(`Delete criterion "${name}"? All values for it across all markets will be removed.`)) return;
    try {
      await window.supaWrite('market_research_criteria', 'DELETE', null, `?id=eq.${id}`);
      await _loadData();
      _manageCriteria();
      if (_currentMarket) _renderScorecard();
      else _renderGrid();
      _toast('Criterion deleted');
    } catch(e) { _toast('Error: ' + e.message, true); }
  }

  // ── Sort handler ───────────────────────────────────────
  function _changeSort() { _renderGrid(); }

  // ── Public API ─────────────────────────────────────────
  window.mrOpenMarket     = (id) => _openMarket(id);
  window.mrBackToList     = ()    => _backToList();
  window.mrNewMarket      = ()    => _newMarket();
  window.mrSaveNewMarket  = ()    => _saveNewMarket();
  window.mrEditMarket     = ()    => _editMarket();
  window.mrSaveEditMarket = ()    => _saveEditMarket();
  window.mrDeleteMarket   = ()    => _deleteMarket();
  window.mrEditNarrative  = (f)   => _editNarrative(f);
  window.mrSaveNarrative  = (f)   => _saveNarrative(f);
  window.mrSaveScore      = (c, t, v) => _saveScore(c, t, v);
  window.mrSaveSource     = (c, v) => _saveSource(c, v);
  window.mrManageCriteria = ()    => _manageCriteria();
  window.mrAddCriterion   = ()    => _addCriterion();
  window.mrDeleteCriterion= (id, name) => _deleteCriterion(id, name);
  window.mrChangeSort     = ()    => _changeSort();
  window.mrCloseModal     = ()    => _closeModal();

  // ── Main init ──────────────────────────────────────────
  window.marketResearchInit = async function () {
    if (_inited) {
      try { await _loadData(); _renderGrid(); } catch(e) { console.error(e); }
      return;
    }
    _inited = true;
    _injectCSS();
    _injectHTML();
    try {
      await _loadData();
      _renderGrid();
    } catch(e) {
      console.error('Market Research init failed:', e);
      const root = document.getElementById('mrRoot');
      if (root) root.innerHTML = '<p style="color:#b91c1c;padding:24px;">Failed to load: ' + e.message + '</p>';
    }
  };
})();
