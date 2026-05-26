/* ============================================================
   Market Research Module — market-research.js
   External IIFE module (same pattern as initiatives.js / exec-v2.js)
   Loaded via <script src="market-research.js"> in index.html
   Called via window.marketResearchInit() from switchView()
   ============================================================ */
(function () {
  'use strict';

  let _inited = false;
  let _markets = [];          // current page only (server-paginated)
  let _shortlistFull = [];    // full shortlist (≤ 1k) loaded once, used by the chatbot
  let _filterCounts = { all: 0, favorites: 0 };
  let _totalForCurrentFilter = 0;
  let _page = 0;
  const PAGE_SIZE = 500;   // bigger default page — still pages with controls visible at top/bottom
  let _activeTiers = new Set(); // empty = no tier filter; full list shown (sorted by score desc so T1 surfaces first)
  let _categories = []; // 6 high-level groups carrying weights
  let _criteria = [];   // sub-criteria, linked via category_id
  let _scores = []; // shortlist scores only
  let _currentMarket = null; // detail view
  let _currentUser = null;
  let _activeFilter = 'all'; // 'all' | 'favorites'; tier multi-select drives the real filter
  let _searchQuery = '';
  let _activeState = '';   // '' = any state ; otherwise 2-letter state code (NJ, NY, ...)
  let _activeMetro = '';   // '' = any metro ; otherwise nearest_top50_city value
  let _stateOptions = [];  // cached distinct states ['CA','NJ',...]
  let _metroOptions = [];  // cached distinct nearest_top50_city values
  let _mapInstance = null;
  let _markerCluster = null;
  let _mapLeafletLoaded = false;
  let _mapBounds = null;          // { north, south, east, west } when user has zoomed/panned past the initial CONUS view
  let _mapBoundsSettling = false; // suppresses moveend during programmatic fitBounds on initial render
  let _addressPin = null;         // { lat, lng, label } when user searched an address (Nominatim hit)
  const _ADDRESS_RADIUS_MILES = 60; // "surrounding markets" window — matches the metro overlay radius
  let _showTier4 = (typeof localStorage !== 'undefined' && localStorage.getItem('mr_show_tier4') === '1'); // checkbox: render T4 dots on the map
  // Asset class — 'residential' or 'office'. Drives which score/tier/target/weight
  // columns get used everywhere (list, map, modals, sort, filter). Persisted to localStorage.
  // Defaults to 'office' on first visit (per Morris 2026-05-26).
  // One-time migration: stale 'residential' from before the default flip gets
  // reset to 'office'. Bumping MR_DEFAULT_VERSION re-applies the migration.
  const MR_DEFAULT_VERSION = '2';
  try {
    if (typeof localStorage !== 'undefined'
        && localStorage.getItem('mr_default_version') !== MR_DEFAULT_VERSION) {
      localStorage.setItem('mr_view_type', 'office');
      localStorage.setItem('mr_default_version', MR_DEFAULT_VERSION);
    }
  } catch (_) {}
  let _viewType = (typeof localStorage !== 'undefined' && localStorage.getItem('mr_view_type')) || 'office';
  if (!['residential', 'office'].includes(_viewType)) _viewType = 'office';
  function _scoreCol() { return _viewType === 'office' ? 'office_score' : 'score'; }
  function _tierCol()  { return _viewType === 'office' ? 'office_tier'  : 'tier';  }
  let _msaGeoJson = null;         // cached CBSA GeoJSON once fetched (per-session)
  let _msaLayer = null;           // Leaflet layer reference so we can remove on re-init
  let _scorecardView = null;      // detail-page scorecard: 'residential' | 'office' (defaults to page toggle)
  let _viewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('mr_view_mode')) || 'list'; // 'list' | 'map'
  // Migrate legacy 'grid' to 'list'
  if (_viewMode === 'grid') _viewMode = 'list';

  // ── CSS ──────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('mr-css')) return;
    const style = document.createElement('style');
    style.id = 'mr-css';
    style.textContent = `
      /* Let market-research breathe to the full viewport — override the
         default .manage-view 1400px cap so the split list+map view has room
         for the Thesis column without horizontal scroll. */
      #view-marketresearch { max-width: none !important; padding: 0 !important; }
      #mrRoot { padding: 16px 20px; max-width: none; }
      #mrRoot h2 { margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #1e293b; }
      #mrRoot .mr-subtitle { font-size: 13px; color: #94a3b8; margin: 0; }

      /* Dropbox source banner */
      #mrRoot .mr-dropbox-banner {
        display: flex; gap: 12px; align-items: flex-start;
        padding: 12px 16px;
        background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px;
        margin-bottom: 14px;
      }

      /* Update Rankings CTA banner */
      #mrRoot .mr-rerank-cta {
        display: flex; align-items: center; gap: 16px;
        padding: 18px 22px;
        background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
        border: 1px solid #fde68a; border-radius: 10px;
        margin-bottom: 24px;
      }
      #mrRoot .mr-rerank-icon {
        flex-shrink: 0; width: 44px; height: 44px; border-radius: 22px;
        background: #f59e0b; color: #fff; display: flex; align-items: center;
        justify-content: center;
      }
      #mrRoot .mr-rerank-title {
        font-size: 15px; font-weight: 700; color: #78350f; margin-bottom: 3px;
      }
      #mrRoot .mr-rerank-desc {
        font-size: 12px; color: #92400e; line-height: 1.5;
      }
      #mrRoot .mr-rerank-btn {
        flex-shrink: 0; font-size: 13px; font-weight: 700;
        padding: 12px 22px !important; background: #d97706 !important;
        border-color: #d97706 !important; box-shadow: 0 2px 6px rgba(217,119,6,.3);
      }
      #mrRoot .mr-rerank-btn:hover { background: #b45309 !important; border-color: #b45309 !important; }
      #mrRoot .mr-rerank-btn:disabled { opacity: 0.7; cursor: wait; }

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

      /* View toggle (grid / list) */
      #mrRoot .mr-view-toggle {
        display: inline-flex; border: 1px solid #e2e8f0; border-radius: 6px;
        overflow: hidden; background: #fff;
      }
      #mrRoot .mr-view-toggle button {
        background: #fff; border: none; padding: 6px 10px; cursor: pointer;
        color: #94a3b8; display: flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 500; transition: background .15s;
      }
      #mrRoot .mr-view-toggle button:hover { background: #f8fafc; color: #1e293b; }
      #mrRoot .mr-view-toggle button.active {
        background: #0ea5e9; color: #fff;
      }
      #mrRoot .mr-view-toggle button + button { border-left: 1px solid #e2e8f0; }
      #mrRoot .mr-view-toggle button.active + button,
      #mrRoot .mr-view-toggle button + button.active { border-left-color: #0ea5e9; }

      /* ── List view (table) ────────────────────────── */
      #mrRoot .mr-table-wrap {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
        margin-top: 18px; overflow: hidden;
      }
      #mrRoot .mr-table {
        width: 100%; border-collapse: collapse;
      }
      #mrRoot .mr-table thead th {
        padding: 12px 14px; text-align: left; font-size: 11px;
        font-weight: 600; color: #64748b; text-transform: uppercase;
        letter-spacing: .5px; background: #fafbfc;
        border-bottom: 1px solid #e2e8f0; white-space: nowrap;
      }
      #mrRoot .mr-table tbody td {
        padding: 8px 10px; font-size: 13px; color: #1e293b;
        border-bottom: 1px solid #f1f5f9; vertical-align: top;
      }
      #mrRoot .mr-table thead th {
        padding: 10px 10px !important;
      }
      #mrRoot .mr-table tbody tr {
        cursor: pointer; transition: background .12s;
      }
      #mrRoot .mr-table tbody tr:hover { background: #f8fafc; }
      #mrRoot .mr-table tbody tr:last-child td { border-bottom: none; }
      #mrRoot .mr-table .mr-table-name {
        font-weight: 600; color: #1e293b;
      }
      #mrRoot .mr-view-on-map {
        display: inline-block; font-size: 10px; color: #94a3b8;
        margin-top: 2px; cursor: pointer; font-weight: 400;
        text-decoration: none;
      }
      #mrRoot .mr-view-on-map:hover { color: #0369a1; text-decoration: underline; }
      #mrRoot .mr-table .mr-table-state {
        font-size: 11px; color: #94a3b8; font-weight: 500; margin-top: 2px;
      }
      #mrRoot .mr-table .mr-table-thesis {
        font-size: 12px; color: #64748b; line-height: 1.4;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden;
      }
      #mrRoot .mr-table .mr-table-score {
        font-weight: 700; font-size: 16px;
      }
      #mrRoot .mr-table .mr-table-score.s8plus  { color: #15803d; }
      #mrRoot .mr-table .mr-table-score.s6to8   { color: #65a30d; }
      #mrRoot .mr-table .mr-table-score.s4to6   { color: #ca8a04; }
      #mrRoot .mr-table .mr-table-score.sUnder4 { color: #b91c1c; }

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
      /* Wide variant for the categories editor — 4-column grid → 7 cards in 2 rows */
      #mrRoot .mr-modal.mr-modal-wide { max-width: 1280px; }
      #mrRoot .mr-cat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
      }
      #mrRoot .mr-cat-card {
        border: 1px solid #e2e8f0; border-radius: 10px;
        background: #fff; overflow: hidden; display: flex; flex-direction: column;
      }
      #mrRoot .mr-cat-card .mr-cat-card-head {
        display: grid; grid-template-columns: 1fr auto; gap: 10px;
        align-items: center; padding: 10px 12px;
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        border-bottom: 1px solid #e2e8f0;
      }
      #mrRoot .mr-cat-card .mr-cat-card-title {
        font-size: 12px; font-weight: 700; color: #0f172a;
        text-transform: uppercase; letter-spacing: 0.4px;
        line-height: 1.25;
      }
      #mrRoot .mr-cat-card .mr-cat-card-sub {
        font-size: 10px; color: #94a3b8; margin-top: 2px;
      }
      #mrRoot .mr-cat-card .mr-cat-weight-wrap {
        display: flex; flex-direction: column; align-items: center;
      }
      #mrRoot .mr-cat-card .mr-cat-weight-wrap input {
        width: 70px; padding: 5px 6px; border: 1px solid #cbd5e1;
        border-radius: 6px; font-size: 14px; text-align: center;
        color: #0f172a; font-weight: 700; background: #fff;
      }
      #mrRoot .mr-cat-card .mr-cat-weight-pct {
        font-size: 9px; color: #94a3b8; font-weight: 600;
        margin-top: 2px;
      }
      #mrRoot .mr-cat-card .mr-cat-card-body {
        padding: 6px 12px 10px 12px; flex: 1;
      }
      #mrRoot .mr-cat-card .mr-cat-sub-row {
        padding: 6px 0; border-top: 1px solid #f1f5f9;
        display: flex; align-items: flex-start; gap: 8px;
      }
      #mrRoot .mr-cat-card .mr-cat-sub-row:first-child { border-top: none; }
      #mrRoot .mr-cat-card .mr-cat-sub-bullet {
        width: 5px; height: 5px; border-radius: 50%;
        background: #94a3b8; margin-top: 7px; flex: none;
      }
      #mrRoot .mr-cat-card .mr-cat-sub-name {
        font-size: 12px; font-weight: 500; color: #1e293b;
        display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
      }
      #mrRoot .mr-cat-card .mr-cat-sub-desc {
        font-size: 10px; color: #94a3b8; margin-top: 1px;
        line-height: 1.4;
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

      /* Search bar */
      #mrRoot .mr-search-wrap {
        position: relative; margin: 12px 0 14px 0;
        max-width: 540px;
      }
      #mrRoot .mr-search-input {
        width: 100%; padding: 9px 36px 9px 36px;
        border: 1px solid #e2e8f0; border-radius: 10px;
        font-size: 14px; color: #1e293b; background: #fff;
        font-family: inherit; outline: none;
      }
      #mrRoot .mr-search-input:focus { border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14,165,233,0.12); }
      #mrRoot .mr-search-icon {
        position: absolute; top: 50%; left: 12px;
        transform: translateY(-50%); color: #94a3b8; pointer-events: none;
      }
      #mrRoot .mr-search-clear {
        position: absolute; top: 50%; right: 12px;
        transform: translateY(-50%); font-size: 18px;
        color: #94a3b8; cursor: pointer; display: none;
        width: 20px; height: 20px; line-height: 18px; text-align: center;
        border-radius: 50%;
      }
      #mrRoot .mr-search-clear:hover { background: #f1f5f9; color: #475569; }
      #mrRoot .mr-search-input:not(:placeholder-shown) + .mr-search-clear { display: block; }

      /* Page header + pager */
      #mrRoot .mr-page-header {
        display: flex; justify-content: space-between; align-items: center;
        margin: 14px 0 10px 0;
        font-size: 12px; color: #64748b;
      }
      #mrRoot .mr-page-count strong { color: #0f172a; font-weight: 700; }
      #mrRoot .mr-pager {
        display: flex; justify-content: center; align-items: center;
        gap: 16px; margin: 20px 0 8px 0;
      }
      #mrRoot .mr-pager-btn {
        background: #fff; border: 1px solid #e2e8f0;
        padding: 7px 14px; border-radius: 8px;
        font-size: 13px; color: #1e293b; cursor: pointer;
        font-weight: 500;
      }
      #mrRoot .mr-pager-btn:hover:not([disabled]) {
        background: #f1f5f9; border-color: #cbd5e1;
      }
      #mrRoot .mr-pager-btn[disabled] {
        opacity: 0.4; cursor: not-allowed;
      }
      #mrRoot .mr-pager-info {
        font-size: 13px; color: #64748b;
      }
      #mrRoot .mr-pager-info strong { color: #0f172a; font-weight: 700; }

      /* Shortlist criteria subtext */
      #mrRoot .mr-shortlist-criteria {
        font-size: 11px; color: #64748b;
        margin-top: 8px; line-height: 1.4;
      }
      #mrRoot .mr-shortlist-criteria strong {
        color: #0f172a; font-weight: 600;
      }
      /* Tier filter pills */
      #mrRoot .mr-tier-filter {
        display: inline-flex; align-items: center; gap: 6px;
        margin-left: 8px; padding-left: 12px;
        border-left: 1px solid #e2e8f0;
      }
      #mrRoot .mr-tier-label {
        font-size: 11px; color: #94a3b8; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.5px;
        margin-right: 2px;
      }
      #mrRoot .mr-tier-pill {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 4px 10px; border-radius: 14px;
        background: #fff; border: 1px solid #e2e8f0;
        font-size: 12px; color: #475569; cursor: pointer;
        user-select: none; font-weight: 500;
      }
      #mrRoot .mr-tier-pill:hover { background: #f8fafc; border-color: #cbd5e1; }
      #mrRoot .mr-tier-pill input { margin: 0; cursor: pointer; }
      #mrRoot .mr-tier-pill.active { background: #0ea5e9; border-color: #0284c7; color: #fff; font-weight: 600; }
      #mrRoot .mr-tier-pill.active:hover { background: #0284c7; }
      /* Manage Criteria modal — tabbed redesign */
      #mrRoot .mr-tab-row {
        display: flex; align-items: center; gap: 8px;
        margin-bottom: 12px; padding-bottom: 12px;
        border-bottom: 1px solid #e2e8f0;
      }
      #mrRoot .mr-tab {
        background: #f8fafc; border: 1px solid #e2e8f0;
        padding: 8px 18px; font-size: 13px; font-weight: 600; color: #475569;
        border-radius: 8px; cursor: pointer; transition: all .15s;
      }
      #mrRoot .mr-tab:hover { background: #f1f5f9; }
      #mrRoot .mr-tab.active {
        background: #0ea5e9; color: #fff; border-color: #0284c7;
        box-shadow: 0 1px 3px rgba(2,132,199,0.3);
      }
      #mrRoot .mr-tab-total {
        font-size: 12px; color: #64748b; padding-right: 6px;
      }
      #mrRoot .mr-modal-hint {
        font-size: 12px; color: #64748b; margin: 0 0 14px 0;
        background: #f8fafc; border: 1px solid #e2e8f0;
        border-radius: 8px; padding: 8px 12px;
      }
      /* Full-screen loader during heavy recompute */
      #mrFullLoader {
        position: fixed; inset: 0; z-index: 10000;
        display: none; align-items: center; justify-content: center;
      }
      #mrFullLoader .mr-loader-backdrop {
        position: absolute; inset: 0; background: rgba(15,23,42,0.55);
        backdrop-filter: blur(2px);
      }
      #mrFullLoader .mr-loader-card {
        position: relative; background: #fff; padding: 28px 36px;
        border-radius: 14px; box-shadow: 0 16px 40px rgba(0,0,0,0.2);
        text-align: center; max-width: 420px; min-width: 320px;
      }
      #mrFullLoader .mr-loader-spinner {
        width: 36px; height: 36px; margin: 0 auto 14px auto;
        border: 3px solid #e2e8f0; border-top-color: #0ea5e9;
        border-radius: 50%; animation: mrSpin 0.7s linear infinite;
      }
      #mrFullLoader .mr-loader-msg {
        font-size: 14px; font-weight: 600; color: #0f172a; line-height: 1.4;
      }
      #mrFullLoader .mr-loader-hint {
        font-size: 12px; color: #64748b; margin-top: 8px;
      }
      @keyframes mrSpin { to { transform: rotate(360deg); } }
      /* Stacked weight bar (Manage Criteria modal) */
      #mrRoot .mr-wbar-label {
        font-size: 10px; color: #94a3b8; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
      }
      #mrRoot .mr-wbar {
        display: flex; width: 100%; height: 28px;
        border-radius: 8px; overflow: hidden;
        border: 1px solid #e2e8f0;
      }
      #mrRoot .mr-wbar-seg {
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 600; color: #fff;
        cursor: pointer; transition: opacity .15s, filter .15s;
        min-width: 0;
      }
      #mrRoot .mr-wbar-seg:hover { filter: brightness(1.1); }
      #mrRoot .mr-wbar-legend {
        display: flex; flex-wrap: wrap; gap: 6px 14px;
        margin: 10px 0 16px 0; font-size: 11px; color: #64748b;
      }
      #mrRoot .mr-wbar-legend-item {
        display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
        transition: color .15s;
      }
      #mrRoot .mr-wbar-legend-item:hover { color: #0ea5e9; }
      #mrRoot .mr-wbar-swatch {
        width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0;
      }
      #mrRoot .mr-wbar-legend-val { color: #94a3b8; font-weight: 500; }
      /* Criterion row inside category card */
      #mrRoot .mr-crit-row {
        padding: 10px 0; border-bottom: 1px solid #f1f5f9;
      }
      #mrRoot .mr-crit-row:last-child { border-bottom: none; }
      #mrRoot .mr-crit-row-disabled {
        opacity: 0.45; background: #fafafa;
      }
      #mrRoot .mr-crit-row-disabled .mr-crit-inputs,
      #mrRoot .mr-crit-row-disabled .mr-crit-desc {
        opacity: 0.6;
      }
      #mrRoot .mr-crit-toggle {
        display: inline-flex; align-items: center; gap: 6px;
        cursor: pointer; user-select: none;
      }
      #mrRoot .mr-crit-toggle input[type="checkbox"] {
        width: 14px; height: 14px; cursor: pointer; margin: 0;
        accent-color: #0ea5e9;
      }
      #mrRoot .mr-crit-name {
        font-size: 13px; font-weight: 600; color: #1e293b;
        display: flex; align-items: center; gap: 6px;
      }
      #mrRoot .mr-crit-unit {
        font-size: 10px; color: #94a3b8; font-weight: 500;
        background: #f1f5f9; padding: 1px 6px; border-radius: 4px;
      }
      #mrRoot .mr-crit-desc {
        font-size: 11px; color: #64748b; margin-top: 2px;
        line-height: 1.4;
      }
      #mrRoot .mr-crit-inputs {
        display: flex; align-items: center; gap: 6px; margin-top: 8px;
        flex-wrap: wrap;
      }
      #mrRoot .mr-crit-inputs label {
        font-size: 11px; font-weight: 600; color: #64748b;
        margin-left: 4px;
      }
      #mrRoot .mr-crit-inputs label:first-child { margin-left: 0; }
      #mrRoot .mr-crit-inputs input {
        width: 80px; padding: 4px 6px; border: 1px solid #d1d5db;
        border-radius: 6px; font-size: 12px;
      }
      #mrRoot .mr-crit-inputs input:focus {
        outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 2px rgba(14,165,233,0.1);
      }
      #mrRoot .mr-other-hint-inline {
        font-size: 10px; color: #7c3aed; font-weight: 600;
        background: #f3e8ff; border: 1px solid #ddd6fe;
        padding: 2px 6px; border-radius: 4px; cursor: help;
      }
      #mrRoot .mr-other-hint {
        font-size: 10px; color: #7c3aed; font-weight: 600;
        margin: -2px 0 6px 0; padding: 2px 8px;
        background: #f3e8ff; border-radius: 4px; display: inline-block;
      }
      /* Asset-class toggle (Residential / Office) */
      #mrRoot .mr-asset-toggle {
        display: inline-flex; gap: 0; margin-left: 8px;
        border: 1px solid #d1d5db; border-radius: 8px; overflow: hidden;
        vertical-align: middle;
      }
      #mrRoot .mr-asset-toggle button {
        background: #fff; border: none; padding: 4px 12px;
        font-size: 12px; font-weight: 600; cursor: pointer; color: #475569;
      }
      #mrRoot .mr-asset-toggle button:hover { background: #f1f5f9; }
      #mrRoot .mr-asset-toggle button.active { background: #0ea5e9; color: #fff; }
      #mrRoot .mr-tier-pill.mr-tier-pill-col {
        flex-direction: column; align-items: center; gap: 2px; padding: 5px 10px;
      }
      #mrRoot .mr-tier-pill-row { display: inline-flex; align-items: center; gap: 4px; }
      #mrRoot .mr-tier-pill-range { font-size: 10px; font-weight: 600; opacity: 0.85; line-height: 1; }
      #mrRoot .mr-tier-pill.active .mr-tier-pill-range { color: #fff !important; opacity: 0.92; }

      /* State + Metro geographic dropdown filters */
      #mrRoot .mr-geo-filter {
        display: inline-flex; align-items: center; gap: 8px; margin-left: 8px;
        padding-left: 12px; border-left: 1px solid #e2e8f0;
      }
      #mrRoot .mr-geo-select {
        font-size: 12px; padding: 5px 26px 5px 10px;
        border: 1px solid #cbd5e1; border-radius: 6px; background: #fff;
        color: #0f172a; cursor: pointer; min-width: 140px;
        appearance: none; -webkit-appearance: none; -moz-appearance: none;
        background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 9px center;
        transition: border-color .12s, box-shadow .12s;
      }
      #mrRoot .mr-geo-select:hover { border-color: #94a3b8; }
      #mrRoot .mr-geo-select:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14,165,233,.15); }
      #mrRoot .mr-geo-select.is-active {
        background-color: #ecfeff; border-color: #0ea5e9; color: #0c4a6e; font-weight: 600;
      }
      #mrRoot .mr-geo-clear {
        font-size: 11px; padding: 5px 10px; border: 1px solid #fecaca;
        border-radius: 6px; background: #fef2f2; color: #b91c1c; cursor: pointer;
      }
      #mrRoot .mr-geo-clear:hover { background: #fee2e2; }

      /* Split list+map layout — map gets a bigger pane (42%) now that the
         list's Market column has been tightened. */
      #mrRoot .mr-split {
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(420px, 42%);
        gap: 16px; align-items: flex-start;
      }
      #mrRoot .mr-split-list { min-width: 0; overflow-x: auto; }
      #mrRoot .mr-split-map {
        position: sticky; top: 12px;
        height: calc(100vh - 200px);
        min-height: 420px;
        max-height: 720px;
        border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;
        background: #f0f4f8;
      }
      #mrRoot .mr-split-map > #mrMap { width: 100%; height: 100%; }
      @media (max-width: 1280px) {
        #mrRoot .mr-split { grid-template-columns: minmax(0, 1fr) minmax(360px, 38%); }
      }
      @media (max-width: 1100px) {
        #mrRoot .mr-split { grid-template-columns: 1fr; }
        #mrRoot .mr-split-map { position: relative; height: 420px; top: auto; }
      }

      /* Phase coverage banner */
      #mrRoot .mr-phase-banner {
        background: #f8fafc; border: 1px solid #e2e8f0;
        border-radius: 10px; padding: 14px 16px;
        margin: 0 0 14px 0;
      }
      #mrRoot .mr-phase-chip {
        display: inline-block; padding: 4px 10px;
        border-radius: 12px; font-size: 11px; font-weight: 600;
        background: #fff; border: 1px solid #e2e8f0;
        color: #475569;
      }
      #mrRoot .mr-phase-chip.phase1 { background: #f0f9ff; border-color: #bae6fd; color: #075985; }
      #mrRoot .mr-phase-chip.phase2 { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
      #mrRoot .mr-phase-chip.phase3 { background: #fff7ed; border-color: #fed7aa; color: #9a3412; }

      /* Deep Research button (table row) */
      #mrRoot .mr-deep-btn {
        font-size: 11px; padding: 4px 10px;
        background: #fff; color: #9a3412;
        border: 1px solid #fed7aa; border-radius: 6px;
        cursor: pointer; font-weight: 600; white-space: nowrap;
      }
      #mrRoot .mr-deep-btn:hover { background: #fff7ed; border-color: #fb923c; }
      /* Prominent Deep Research button (detail header) */
      #mrRoot .mr-btn-deep {
        background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%);
        color: #fff; border: none;
        padding: 9px 18px; border-radius: 8px;
        font-weight: 700; font-size: 13px;
        cursor: pointer; box-shadow: 0 1px 3px rgba(234,88,12,0.3);
        transition: transform .12s, box-shadow .12s;
      }
      #mrRoot .mr-btn-deep:hover {
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(234,88,12,0.4);
        background: linear-gradient(135deg, #c2410c 0%, #9a3412 100%);
      }

      /* Heart toggle */
      #mrRoot .mr-heart {
        cursor: pointer; padding: 4px; line-height: 1;
        border-radius: 4px; transition: transform .12s;
        color: #cbd5e1; font-size: 18px;
        background: none; border: none;
      }
      #mrRoot .mr-heart:hover { color: #ef4444; transform: scale(1.15); }
      #mrRoot .mr-heart.active { color: #ef4444; }

      /* Chatbot at the top */
      #mrRoot .mr-chat {
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        border-radius: 12px;
        padding: 16px 18px;
        margin-bottom: 16px;
        color: #e2e8f0;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      #mrRoot .mr-chat-header {
        display: flex; align-items: center; gap: 10px;
        font-size: 13px; font-weight: 600;
        color: #cbd5e1; margin-bottom: 10px;
      }
      #mrRoot .mr-chat-header .mr-chat-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.2);
      }
      #mrRoot .mr-chat-row {
        display: flex; gap: 8px;
      }
      #mrRoot .mr-chat-input {
        flex: 1;
        background: #0f172a;
        border: 1px solid #334155;
        color: #e2e8f0;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
        font-family: inherit;
        outline: none;
      }
      #mrRoot .mr-chat-input:focus { border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,0.15); }
      #mrRoot .mr-chat-input::placeholder { color: #64748b; }
      #mrRoot .mr-chat-send {
        background: #0ea5e9; color: #fff;
        border: none; padding: 0 18px;
        border-radius: 8px; font-weight: 600;
        font-size: 13px; cursor: pointer;
      }
      #mrRoot .mr-chat-send:hover { background: #0284c7; }
      #mrRoot .mr-chat-send:disabled { background: #475569; cursor: not-allowed; }
      #mrRoot .mr-chat-suggestions {
        display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px;
      }
      #mrRoot .mr-chat-chip {
        background: rgba(255,255,255,0.08); color: #cbd5e1;
        border: 1px solid #334155; padding: 4px 10px;
        border-radius: 16px; font-size: 11px; cursor: pointer;
      }
      #mrRoot .mr-chat-chip:hover { background: rgba(56,189,248,0.15); border-color: #38bdf8; color: #e0f2fe; }
      #mrRoot .mr-chat-output {
        margin-top: 14px; background: rgba(255,255,255,0.04);
        border: 1px solid #1e293b; border-radius: 8px;
        padding: 14px 16px; font-size: 13px; line-height: 1.55;
        color: #e2e8f0; max-height: 420px; overflow-y: auto;
        white-space: pre-wrap; display: none;
      }
      #mrRoot .mr-chat-output.show { display: block; }
      #mrRoot .mr-chat-output .mr-chat-q {
        font-size: 11px; color: #38bdf8; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.3px;
        margin-bottom: 6px;
      }
      #mrRoot .mr-chat-output .mr-chat-a {
        color: #e2e8f0;
      }
      #mrRoot .mr-chat-loading {
        display: inline-flex; gap: 4px; align-items: center;
        color: #94a3b8; font-size: 12px; font-style: italic;
      }

      /* Grouped scorecard — bolder category separators */
      #mrRoot .mr-scorecard table { border-collapse: separate; border-spacing: 0; }
      #mrRoot .mr-cat-header {
        font-size: 12px; font-weight: 800;
        color: #0f172a; text-transform: uppercase;
        letter-spacing: 0.7px;
        padding: 18px 14px 12px 14px;
        background: linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%);
        border-top: 4px solid #0ea5e9;
        border-bottom: 1px solid #cbd5e1;
        position: relative;
      }
      #mrRoot .mr-cat-header:first-child { border-top: 4px solid #0ea5e9; }
      /* Different accent color per category */
      #mrRoot .mr-cat-header[data-cat="demographics"]          { border-top-color: #0ea5e9; }
      #mrRoot .mr-cat-header[data-cat="company_concentrations"]{ border-top-color: #8b5cf6; }
      #mrRoot .mr-cat-header[data-cat="governance"]            { border-top-color: #f59e0b; }
      #mrRoot .mr-cat-header[data-cat="economic_activity"]     { border-top-color: #ec4899; }
      #mrRoot .mr-cat-header[data-cat="education"]             { border-top-color: #14b8a6; }
      #mrRoot .mr-cat-header[data-cat="quality_of_life"]       { border-top-color: #22c55e; }
      #mrRoot .mr-cat-header[data-cat="transit"]               { border-top-color: #f97316; }
      /* Add extra breathing room after each category's last row */
      #mrRoot .mr-scorecard tbody > tr:has(.mr-cat-header) { box-shadow: 0 -10px 0 #fff; }
      #mrRoot .mr-target-chip {
        display: inline-block;
        background: #f1f5f9; color: #475569;
        font-size: 10px; font-weight: 600;
        padding: 2px 8px; border-radius: 4px;
        margin-left: 6px; white-space: nowrap;
      }
      /* Score chip beside the actual value */
      #mrRoot .mr-score-chip {
        display: inline-block;
        background: #e0f2fe; color: #075985;
        font-size: 11px; font-weight: 700;
        padding: 2px 8px; border-radius: 10px;
        white-space: nowrap;
      }
      #mrRoot .mr-score-chip.s8plus  { background: #dcfce7; color: #166534; }
      #mrRoot .mr-score-chip.s6to8   { background: #fef3c7; color: #92400e; }
      #mrRoot .mr-score-chip.s4to6   { background: #fed7aa; color: #9a3412; }
      #mrRoot .mr-score-chip.sUnder4 { background: #fee2e2; color: #991b1b; }
      /* Source cell — clickable link + edit pencil */
      #mrRoot .mr-source-cell {
        display: flex; align-items: center; gap: 6px; min-width: 0;
      }
      #mrRoot .mr-source-link {
        color: #0ea5e9; text-decoration: underline;
        font-size: 12px; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; flex: 1; min-width: 0;
      }
      #mrRoot .mr-source-link:hover { color: #0284c7; }
      #mrRoot .mr-source-text {
        font-size: 12px; color: #475569;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        flex: 1; min-width: 0;
      }
      #mrRoot .mr-source-placeholder {
        font-size: 12px; color: #94a3b8; font-style: italic;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        flex: 1; min-width: 0;
      }
      #mrRoot .mr-source-edit {
        background: none; border: none; cursor: pointer;
        color: #94a3b8; padding: 2px 4px; border-radius: 4px;
        font-size: 12px; flex: none;
      }
      #mrRoot .mr-source-edit:hover { background: #f1f5f9; color: #0ea5e9; }
    `;
    document.head.appendChild(style);
  }

  // ── Category labels ──────────────────────────────────────
  const _CAT_LABELS = {
    demographics: 'Demographics',
    governance: 'Governance & Barriers to Entry',
    economic_activity: 'Economic Activity',
    education: 'Education',
    quality_of_life: 'Quality of Life',
    transit: 'Transit & Access',
    company_concentrations: 'Company Concentrations',
  };
  const _CAT_ORDER = ['demographics', 'company_concentrations', 'governance', 'economic_activity', 'education', 'quality_of_life', 'transit'];
  // Which categories Phase 2 can score programmatically. Others require Phase 3.
  const _PHASE2_CATEGORIES = new Set(['demographics', 'education', 'company_concentrations']);
  const _PHASE3_CATEGORIES = new Set(['governance', 'economic_activity', 'quality_of_life', 'transit']);

  // For Phase 2 criteria we can derive the actual measured value from the
  // market row at render time. Phase 3 criteria pull value from value_text.
  const _PHASE2_VALUE_FROM_MARKET = {
    'Median Household Income':         (m) => m.median_household_income ? '$' + Number(m.median_household_income).toLocaleString() : null,
    'Median Single-Family Home Price': (m) => m.median_home_value ? '$' + Number(m.median_home_value).toLocaleString() : null,
    'Town Population':                 (m) => m.population ? Number(m.population).toLocaleString() : null,
  };

  function _fmtTarget(c) {
    if (c.target_label) return c.target_label;
    if (c.target_min != null && c.target_max != null) {
      return _fmtVal(c.target_min, c.target_unit) + '–' + _fmtVal(c.target_max, c.target_unit);
    }
    if (c.target_min != null) return '≥ ' + _fmtVal(c.target_min, c.target_unit);
    if (c.target_max != null) return '≤ ' + _fmtVal(c.target_max, c.target_unit);
    return '';
  }
  // Extract a clickable URL from a source string ("US Census ACS 2022 5-yr (data.census.gov)" → "https://data.census.gov")
  function _extractSourceUrl(s) {
    if (!s) return null;
    const m1 = s.match(/https?:\/\/[^\s)\]"']+/);
    if (m1) return m1[0].replace(/[.,;]+$/, '');
    const m2 = s.match(/\(([a-z0-9][\w.-]*\.[a-z]{2,})\)/i);
    if (m2) return 'https://' + m2[1];
    const m3 = s.match(/([a-z0-9][\w-]*\.(?:com|org|gov|net|io|co|us|edu))/i);
    if (m3) return 'https://' + m3[1];
    return null;
  }

  function _fmtVal(v, unit) {
    const n = Number(v);
    if (unit === '$') {
      if (n >= 1e6) return '$' + (n/1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M';
      if (n >= 1e3) return '$' + (n/1e3).toFixed(0) + 'k';
      return '$' + n.toLocaleString();
    }
    if (unit === '%') return n + '%';
    if (unit === 'count') return n.toLocaleString();
    if (unit === 'miles') return n + ' mi';
    if (unit === 'minutes') return n + ' min';
    if (unit === 'years') return n + ' yrs';
    if (unit === 'parks/10k') return n + ' parks/10k';
    return n.toString();
  }

  // ── HTML scaffold ────────────────────────────────────────
  function _injectHTML() {
    const root = document.getElementById('mrRoot');
    if (!root) return;
    root.innerHTML = `
      <!-- Chatbot at the top — ask questions about rankings -->
      <div class="mr-chat">
        <div class="mr-chat-header">
          <span class="mr-chat-dot"></span>
          Ask about the rankings
        </div>
        <div class="mr-chat-row">
          <input class="mr-chat-input" id="mrChatInput" type="text"
                 placeholder="e.g. Which towns score highest on schools and commute? Why is Greenwich ranked above Westport?"
                 onkeydown="if(event.key==='Enter'){mrChatSubmit();}">
          <button class="mr-chat-send" id="mrChatSend" onclick="mrChatSubmit()">Ask</button>
        </div>
        <div class="mr-chat-suggestions">
          <span class="mr-chat-chip" onclick="mrChatSuggest('Which 5 towns rank highest overall and why?')">Top 5 towns</span>
          <span class="mr-chat-chip" onclick="mrChatSuggest('Compare Greenwich, Scarsdale and Short Hills across all criteria.')">Compare 3 towns</span>
          <span class="mr-chat-chip" onclick="mrChatSuggest('Which towns best satisfy the Economic Activity criteria?')">Economic Activity leaders</span>
          <span class="mr-chat-chip" onclick="mrChatSuggest('Which criteria do most towns fail on?')">Common gaps</span>
        </div>
        <div class="mr-chat-output" id="mrChatOutput"></div>
      </div>

      <!-- List View -->
      <div class="mr-list" id="mrListView">
        <div class="mr-header">
          <div>
            <h2>Market Research</h2>
            <p class="mr-subtitle">
              Target US markets &amp; cities for real estate acquisition ·
              <span class="mr-asset-toggle" id="mrAssetToggle">
                <button data-view="office" onclick="mrSetViewType('office')">🏢 Office</button>
                <button data-view="residential" onclick="mrSetViewType('residential')">🏠 Residential</button>
              </span>
            </p>
          </div>
          <div class="mr-actions">
            <button class="mr-btn" onclick="mrManageCriteria()">⚙ Criteria</button>
            <button class="mr-btn mr-btn-primary" onclick="mrNewMarket()">+ New Market</button>
          </div>
        </div>

        <!-- Search bar -->
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin: 8px 0 4px 0;">
          <div class="mr-search-wrap" style="flex:1; min-width:320px; margin:0;">
            <svg class="mr-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="mr-search-input" id="mrSearchInput" type="text"
                   placeholder="Search by town name, state, or full address (street, city, zip…)"
                   oninput="mrSearch(this.value)"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();mrSearchEnter(this.value);}">
            <span class="mr-search-clear" id="mrSearchClear" onclick="mrSearch('')" title="Clear">×</span>
          </div>
          <label id="mrShowTier4Wrap" style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#475569; white-space:nowrap; user-select:none; padding:6px 10px; border:1px solid #e2e8f0; border-radius:8px; background:#fff;">
            <input type="checkbox" id="mrShowTier4" onchange="mrToggleShowTier4(this.checked)" style="margin:0;" ${_showTier4 ? 'checked' : ''}>
            Show Tier 4 on map (grey)
          </label>
        </div>
        <div id="mrAddressHint" style="font-size:11px;color:#94a3b8;margin:-2px 0 4px 4px;display:none;">
          📍 <span id="mrAddressHintText"></span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
          <div class="mr-filters" id="mrFilters">
            <button class="mr-filter-btn active" data-filter="all" style="display:none;">All <span class="mr-filter-count" id="mrCountAll"></span></button>
            <button class="mr-filter-btn" data-filter="favorites">❤ Favorites <span class="mr-filter-count" id="mrCountFavorites"></span></button>
            <div class="mr-tier-filter">
              <span class="mr-tier-label">Tier:</span>
              <label class="mr-tier-pill mr-tier-pill-col" data-tier="1">
                <span class="mr-tier-pill-row"><input type="checkbox" onchange="mrToggleTier(1, this.checked)"> Tier 1</span>
                <span class="mr-tier-pill-range" style="color:#15803d;">≥ 8.5</span>
              </label>
              <label class="mr-tier-pill mr-tier-pill-col" data-tier="2">
                <span class="mr-tier-pill-row"><input type="checkbox" onchange="mrToggleTier(2, this.checked)"> Tier 2</span>
                <span class="mr-tier-pill-range" style="color:#1e40af;">7.0–8.4</span>
              </label>
              <label class="mr-tier-pill mr-tier-pill-col" data-tier="3">
                <span class="mr-tier-pill-row"><input type="checkbox" onchange="mrToggleTier(3, this.checked)"> Tier 3</span>
                <span class="mr-tier-pill-range" style="color:#b45309;">4.0–6.9</span>
              </label>
              <label class="mr-tier-pill mr-tier-pill-col" data-tier="4">
                <span class="mr-tier-pill-row"><input type="checkbox" onchange="mrToggleTier(4, this.checked)"> Tier 4</span>
                <span class="mr-tier-pill-range" style="color:#64748b;">&lt; 4.0</span>
              </label>
            </div>
            <div class="mr-geo-filter">
              <select id="mrStateFilter" class="mr-geo-select" onchange="mrSetGeoFilter('state', this.value)">
                <option value="">All states</option>
              </select>
              <select id="mrMetroFilter" class="mr-geo-select" onchange="mrSetGeoFilter('metro', this.value)">
                <option value="">All nearby metros</option>
              </select>
              <button class="mr-geo-clear" id="mrGeoClear" onclick="mrClearGeoFilters()" style="display:none;" title="Clear state + metro">× Clear</button>
            </div>
          </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <select class="mr-sort" id="mrSort" onchange="mrChangeSort(this.value)">
              <option value="score_desc">Sort: Score (high → low)</option>
              <option value="tier_asc">Sort: Tier (1 → 4)</option>
              <option value="name_asc">Sort: Name (A → Z)</option>
              <option value="updated_desc">Sort: Recently updated</option>
            </select>
            <div class="mr-view-toggle" id="mrViewToggle">
              <button data-mode="map" onclick="mrSetViewMode('map')" title="Map view">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                Map
              </button>
              <button data-mode="list" onclick="mrSetViewMode('list')" title="List view">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                List
              </button>
            </div>
          </div>
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
            <button class="mr-btn mr-btn-deep" id="mrDetailDeepBtn" onclick="mrDeepResearchCurrent()">
              🔬 Deep Research
            </button>
            <button class="mr-btn" onclick="mrExportPDF()" title="Export this market's full scorecard + thesis to a PDF">📄 Export PDF</button>
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
            <span class="mr-asset-toggle" id="mrScorecardToggle" style="margin-left:auto;">
              <button data-view="office" onclick="mrSetScorecardView('office')">🏢 Office</button>
              <button data-view="residential" onclick="mrSetScorecardView('residential')">🏠 Residential</button>
            </span>
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

    // Filter button wiring — change filter, reset to page 0, re-fetch.
    // Clicking an already-active filter toggles back to 'all' so chips like
    // Favorites can be unselected (the 'all' chip itself is display:none).
    root.querySelectorAll('.mr-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const clicked = btn.dataset.filter;
        const newFilter = (_activeFilter === clicked && clicked !== 'all') ? 'all' : clicked;
        root.querySelectorAll('.mr-filter-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.filter === newFilter);
        });
        _activeFilter = newFilter;
        _page = 0;
        _refreshPage();
      });
    });
  }

  // ── Data loading (server-paginated) ─────────────────────
  // Builds the PostgREST query suffix for the current filter + search.
  function _buildFilterQuery() {
    const parts = [];
    const q = (_searchQuery || '').trim();
    // When the user searches an address, _addressPin is set and _mapBounds is
    // a box around the pin — so the name ILIKE on the raw address text would
    // never match. Skip the text filter in that case; geographic bounds do the
    // filtering instead.
    const isNameSearching = q.length > 0 && !_addressPin;
    const hasTierFilter = _activeTiers && _activeTiers.size > 0;
    // Favorites chip always constrains when active; tier multi-select is the
    // primary surface for filtering the scored universe.
    if (_activeFilter === 'favorites') parts.push('is_favorite=eq.true');
    if (hasTierFilter) {
      const tiers = Array.from(_activeTiers).sort().join(',');
      parts.push(`${_tierCol()}=in.(${tiers})`);
    }
    if (isNameSearching) {
      const safe = q.replace(/[%*]/g, '');
      const enc = encodeURIComponent('*' + safe + '*');
      parts.push(`or=(name.ilike.${enc},state.ilike.${enc})`);
    }
    if (_activeState) {
      parts.push(`state=eq.${encodeURIComponent(_activeState)}`);
    }
    if (_activeMetro) {
      parts.push(`nearest_top50_city=eq.${encodeURIComponent(_activeMetro)}`);
    }
    if (_mapBounds) {
      // Narrow to the visible map viewport — set as user zooms/pans the map.
      parts.push(`latitude=gte.${_mapBounds.south}`);
      parts.push(`latitude=lte.${_mapBounds.north}`);
      parts.push(`longitude=gte.${_mapBounds.west}`);
      parts.push(`longitude=lte.${_mapBounds.east}`);
    }
    return parts;
  }

  // Geographic filter is "active" when at least one of state/metro is set.
  // Toggles sort order from default (HHI desc) to Score desc (per user spec).
  function _geoFilterActive() { return Boolean(_activeState || _activeMetro); }

  // Single source-of-truth fetch for the active filter + search + page.
  // Returns total count via Content-Range header (Prefer: count=exact).
  async function _fetchPage() {
    const parts = _buildFilterQuery();
    parts.push('select=*');
    // Always sort by composite Score descending — T1 surfaces at the top of
    // the list. HHI is the tiebreaker, then alpha by name.
    parts.push(`order=${_scoreCol()}.desc.nullslast,median_household_income.desc.nullslast,name.asc`);
    const offset = _page * PAGE_SIZE;
    parts.push(`offset=${offset}`);
    parts.push(`limit=${PAGE_SIZE}`);
    const url = `${window.SUPABASE_URL}/rest/v1/market_research_markets?` + parts.join('&');
    const r = await fetch(url, {
      headers: {
        apikey: window.SUPABASE_KEY,
        Authorization: 'Bearer ' + window.SUPABASE_KEY,
        Prefer: 'count=exact',
      },
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0,200)}`);
    const rows = await r.json();
    const cr = r.headers.get('content-range') || '';
    const total = parseInt((cr.split('/')[1] || '0'), 10) || 0;
    return { rows, total };
  }

  // Quick count-only HEAD query for filter-chip badges.
  async function _fetchCount(filterParts) {
    const parts = filterParts.slice();
    parts.push('select=id');
    parts.push('limit=1');
    const url = `${window.SUPABASE_URL}/rest/v1/market_research_markets?` + parts.join('&');
    const r = await fetch(url, {
      headers: {
        apikey: window.SUPABASE_KEY,
        Authorization: 'Bearer ' + window.SUPABASE_KEY,
        Prefer: 'count=exact',
      },
    });
    const cr = r.headers.get('content-range') || '';
    return parseInt((cr.split('/')[1] || '0'), 10) || 0;
  }

  async function _loadFilterCounts() {
    const [all, favs] = await Promise.all([
      _fetchCount([]),
      _fetchCount(['is_favorite=eq.true']),
    ]);
    _filterCounts = { all, favorites: favs };
    // Refresh just the count badges (cheap)
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = (n || 0).toLocaleString(); };
    set('mrCountAll', all);
    set('mrCountFavorites', favs);
  }

  // Load the scored T1-T3 set once for chatbot context (~1k rows, fits Supabase cap).
  async function _loadShortlistForChatbot() {
    try {
      _shortlistFull = await window.supaFetch(
        'market_research_markets',
        '?select=id,name,state,population,median_household_income,median_home_value,nearest_top50_city,is_favorite,thesis&tier=in.(1,2,3)&order=score.desc.nullslast,name.asc&limit=1000'
      ) || [];
    } catch (e) { _shortlistFull = []; }
  }

  async function _loadData() {
    _currentUser = window.currentUser;
    const [categories, criteria, paged] = await Promise.all([
      window.supaFetch('market_research_categories', '?select=*&order=sort_order.asc,name.asc'),
      window.supaFetch('market_research_criteria', '?select=*&order=sort_order.asc,name.asc'),
      _fetchPage(),
    ]);
    _categories = categories || [];
    _criteria = criteria || [];
    _scores = []; // populated per-market in _openMarket; bulk-load capped at 1000 rows
    _markets = paged.rows;
    _totalForCurrentFilter = paged.total;
    _loadFilterCounts();
    _loadShortlistForChatbot();
    _loadGeoFilterOptions();
  }

  // Load scores for a specific market (used by detail view).
  async function _loadScoresForMarket(marketId) {
    try {
      const rows = await window.supaFetch('market_research_scores', `?select=*&market_id=eq.${marketId}&limit=1000`);
      _scores = rows || [];
    } catch (e) { _scores = []; }
  }

  // Refresh just the grid (filter/search/page changed)
  async function _refreshPage() {
    try {
      const paged = await _fetchPage();
      _markets = paged.rows;
      _totalForCurrentFilter = paged.total;
      _renderGrid();
    } catch (e) {
      _toast('Load failed: ' + e.message, true);
    }
  }

  // Re-fetch and re-render ONLY the list portion, leaving the map untouched.
  // Used by the map-bounds → list sync so panning doesn't reset the map.
  async function _refreshListOnly() {
    try {
      const paged = await _fetchPage();
      _markets = paged.rows;
      _totalForCurrentFilter = paged.total;
      const listContainer = document.querySelector('.mr-split-list');
      const total = _totalForCurrentFilter || 0;
      // Update the "Showing X–Y of Z" header in place (exists in BOTH split and full-map views).
      const firstIdx = total ? (_page * PAGE_SIZE) + 1 : 0;
      const lastIdx = Math.min(total, (_page + 1) * PAGE_SIZE);
      const pageCountEl = document.querySelector('.mr-page-count');
      if (pageCountEl) {
        const suffix = _addressPin
          ? ` <span style="color:#b91c1c;font-weight:600;">· 📍 Within ${_ADDRESS_RADIUS_MILES}mi of ${_esc((_addressPin.label || '').split(',').slice(0,3).join(','))}</span> <button onclick="mrClearAddressSearch()" style="margin-left:8px;background:#fee2e2;border:1px solid #fecaca;color:#991b1b;border-radius:6px;padding:2px 10px;font-size:11px;cursor:pointer;">× Clear</button>`
          : _mapBounds
            ? ` <span style="color:#0369a1;font-weight:600;">· Filtered by map view</span> <button onclick="mrClearMapBounds()" style="margin-left:8px;background:#e0f2fe;border:1px solid #bae6fd;color:#075985;border-radius:6px;padding:2px 10px;font-size:11px;cursor:pointer;">× Clear</button>`
            : '';
        pageCountEl.innerHTML = `Showing <strong>${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()}</strong> of <strong>${total.toLocaleString()}</strong>${suffix}`;
      }
      // In full-map view there's no list pane to update — bail out without
      // rebuilding the grid, otherwise the map would be destroyed/recreated
      // (which resets the user's zoom — that's the "glitching out" bug).
      if (!listContainer) return;
      const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const pager = total > PAGE_SIZE ? _renderPager(pageCount) : '';
      const listInner = _renderListView(_markets);
      listContainer.innerHTML = pager + listInner + pager;
    } catch (e) {
      _toast('Load failed: ' + e.message, true);
    }
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

    // Chip counts come from server (_loadFilterCounts) — independent of current page
    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = (n || 0).toLocaleString(); };
    setCount('mrCountAll',       _filterCounts.all);
    setCount('mrCountFavorites', _filterCounts.favorites);

    // _markets IS the current page. No client-side filter/search; that's server-side.
    const visible = _markets.slice();

    // Sort
    const sortSel = document.getElementById('mrSort');
    const sortMode = sortSel ? sortSel.value : 'score_desc';
    const aScore = (m) => _viewType === 'office' ? (m.office_score ?? -1) : (m.score ?? -1);
    const aTier  = (m) => _viewType === 'office' ? (m.office_tier ?? 99) : (m.tier ?? 99);
    const aHHI   = (m) => m.median_household_income ?? -1;
    visible.sort((a, b) => {
      // Tiebreaker chain must match the rank_{view} SQL: score DESC → HHI DESC → name ASC
      if (sortMode === 'score_desc') return (aScore(b) - aScore(a)) || (aHHI(b) - aHHI(a)) || a.name.localeCompare(b.name);
      if (sortMode === 'tier_asc')   return (aTier(a) - aTier(b)) || (aScore(b) - aScore(a)) || (aHHI(b) - aHHI(a));
      if (sortMode === 'name_asc')   return a.name.localeCompare(b.name);
      if (sortMode === 'updated_desc') return (b.updated_at || '').localeCompare(a.updated_at || '');
      return 0;
    });

    // Sync view-toggle button active state
    document.querySelectorAll('#mrViewToggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === _viewMode);
    });
    // Sync asset-type toggle (Residential / Office)
    document.querySelectorAll('#mrAssetToggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === _viewType);
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

    const total = _totalForCurrentFilter || 0;
    const firstIdx = total ? (_page * PAGE_SIZE) + 1 : 0;
    const lastIdx = Math.min(total, (_page + 1) * PAGE_SIZE);
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const boundsPill = _addressPin
      ? ` <span style="color:#b91c1c;font-weight:600;">· 📍 Within ${_ADDRESS_RADIUS_MILES}mi of ${_esc((_addressPin.label || '').split(',').slice(0,3).join(','))}</span> <button onclick="mrClearAddressSearch()" style="margin-left:8px;background:#fee2e2;border:1px solid #fecaca;color:#991b1b;border-radius:6px;padding:2px 10px;font-size:11px;cursor:pointer;">× Clear</button>`
      : _mapBounds
        ? ` <span style="color:#0369a1;font-weight:600;">· Filtered by map view</span> <button onclick="mrClearMapBounds()" style="margin-left:8px;background:#e0f2fe;border:1px solid #bae6fd;color:#075985;border-radius:6px;padding:2px 10px;font-size:11px;cursor:pointer;">× Clear</button>`
        : '';
    const header = `
      <div class="mr-page-header">
        <div class="mr-page-count">Showing <strong>${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()}</strong> of <strong>${total.toLocaleString()}</strong>${boundsPill}</div>
      </div>`;
    let body, pager = '';
    if (_viewMode === 'map') {
      body = _renderMapShell({ full: true });
    } else {
      // Split view: list on left, map sticky on right
      const listInner = _renderListView(visible);
      pager = total > PAGE_SIZE ? _renderPager(pageCount) : '';
      body = `
        <div class="mr-split">
          <div class="mr-split-list">${pager}${listInner}${pager}</div>
          <div class="mr-split-map">${_renderMapShell({ full: false })}</div>
        </div>`;
      pager = '';
    }
    gridEl.innerHTML = header + body + pager;
    // Map is rendered in BOTH the split (default) and full views
    _initMap();
  }

  function _renderMapShell(opts) {
    const full = opts && opts.full;
    const wrapStyle = full
      ? 'position:relative;height:640px;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;background:#f0f4f8;'
      : 'position:relative;width:100%;height:100%;';
    return `
      <div id="mrMapContainer" style="${wrapStyle}">
        <div id="mrMap" style="width:100%;height:100%;"></div>
        <div id="mrMapLegend" style="position:absolute;bottom:12px;right:12px;background:rgba(255,255,255,0.95);padding:10px 14px;border-radius:8px;font-size:11px;color:#475569;box-shadow:0 1px 3px rgba(0,0,0,0.1);z-index:1000;">
          <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">Tier</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;"></span> Tier 1</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b;"></span> Tier 2</div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#3b82f6;"></span> Tier 3</div>
          <div id="mrLegendT4Row" style="display:${_showTier4 ? 'flex' : 'none'};align-items:center;gap:6px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8;opacity:0.7;"></span> Tier 4</div>
        </div>
      </div>
    `;
  }

  // Lazy-load Leaflet from CDN
  async function _ensureLeaflet() {
    if (_mapLeafletLoaded && window.L) return;
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
      const clusterCss = document.createElement('link');
      clusterCss.rel = 'stylesheet';
      clusterCss.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
      clusterCss.setAttribute('data-leaflet', '1');
      document.head.appendChild(clusterCss);
      const clusterCssDefault = document.createElement('link');
      clusterCssDefault.rel = 'stylesheet';
      clusterCssDefault.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css';
      clusterCssDefault.setAttribute('data-leaflet', '1');
      document.head.appendChild(clusterCssDefault);
    }
    if (!window.L) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Leaflet failed to load'));
        document.head.appendChild(s);
      });
    }
    if (!window.L.markerClusterGroup) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('MarkerCluster failed to load'));
        document.head.appendChild(s);
      });
    }
    _mapLeafletLoaded = true;
  }

  async function _initMap() {
    try {
      await _ensureLeaflet();
      const L = window.L;
      const mapEl = document.getElementById('mrMap');
      if (!mapEl) return;
      // Always rebuild — _renderGrid replaces innerHTML
      if (_mapInstance) { try { _mapInstance.remove(); } catch {} _mapInstance = null; }
      _mapInstance = L.map(mapEl).setView([39.5, -98.35], 4); // US center
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap contributors'
      }).addTo(_mapInstance);
      _markerCluster = L.markerClusterGroup({ maxClusterRadius: 50, disableClusteringAtZoom: 10 });
      _mapInstance.addLayer(_markerCluster);

      // Metro overlay — derive centroids per nearest_top50_city from the
      // markets themselves (no external GeoJSON needed; Census TIGERweb is
      // WAF-blocked from edge functions). Draws a 60-mile radius circle +
      // label at each metro's center of mass, matching the Big Four /
      // Wealth-Mgmt 60mi criterion radius.
      (async () => {
        try {
          if (_msaLayer && _mapInstance) { try { _mapInstance.removeLayer(_msaLayer); } catch(_) {} }
          // Normalize metro label — "New York" and "New York, NY" should merge.
          // Strip trailing ", XX" state-code so groups collapse cleanly.
          const normalizeMetro = (s) => {
            if (!s) return '';
            return String(s).replace(/,\s*[A-Z]{2}\s*$/, '').trim();
          };
          const metros = new Map(); // canonical metro -> { lats[], lngs[], displayName }
          for (const m of withCoords) {
            const raw = m.nearest_top50_city;
            const key = normalizeMetro(raw);
            if (!key) continue;
            if (!metros.has(key)) metros.set(key, { lats: [], lngs: [], displayName: key });
            const g = metros.get(key);
            g.lats.push(parseFloat(m.latitude));
            g.lngs.push(parseFloat(m.longitude));
          }
          const layerGroup = L.layerGroup();
          for (const [name, g] of metros) {
            if (g.lats.length < 2) continue; // need at least 2 markets to anchor a metro
            const avgLat = g.lats.reduce((a, b) => a + b, 0) / g.lats.length;
            const avgLng = g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length;
            const circle = L.circle([avgLat, avgLng], {
              radius: 60 * 1609.34, // 60 miles in meters
              color: '#0ea5e9', weight: 2.5, opacity: 0.85,
              fillColor: '#0ea5e9', fillOpacity: 0.08,
              interactive: true,
            });
            circle.bindTooltip(`${g.displayName} (${g.lats.length} markets)`, { sticky: true, direction: 'top', opacity: 0.92 });
            layerGroup.addLayer(circle);
            // Always-visible center label
            const labelIcon = L.divIcon({
              className: 'mr-metro-label',
              html: `<div style="font-size:11px;font-weight:700;color:#075985;background:rgba(255,255,255,0.85);border:1px solid #bae6fd;padding:1px 6px;border-radius:8px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.05);">${g.displayName}</div>`,
              iconSize: null, iconAnchor: [0, 0],
            });
            const labelMarker = L.marker([avgLat, avgLng], { icon: labelIcon, interactive: false, keyboard: false });
            layerGroup.addLayer(labelMarker);
          }
          _msaLayer = layerGroup;
          _msaLayer.addTo(_mapInstance);
          if (_markerCluster) _markerCluster.bringToFront && _markerCluster.bringToFront();
          console.log(`[mr] Metro overlay: ${metros.size} top-50 cities`);
        } catch (e) {
          console.warn('[mr] Metro overlay failed:', e.message || e);
        }
      })();

      // Fetch the full filtered set (paginated — PostgREST anon caps each call
      // at 1000 rows, so loop with offset until we have everything).
      const parts = _buildFilterQuery();
      parts.push('select=id,name,state,population,median_household_income,latitude,longitude,score,tier,office_score,office_tier');
      const baseUrl = `${window.SUPABASE_URL}/rest/v1/market_research_markets?` + parts.join('&');
      const PAGE = 1000;
      const rows = [];
      for (let offset = 0; offset < 10000; offset += PAGE) {
        const pageUrl = `${baseUrl}&limit=${PAGE}&offset=${offset}`;
        const r = await fetch(pageUrl, {
          headers: { apikey: window.SUPABASE_KEY, Authorization: 'Bearer ' + window.SUPABASE_KEY }
        });
        const chunk = await r.json();
        if (!Array.isArray(chunk) || chunk.length === 0) break;
        rows.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      const withCoords = rows.filter(m => m.latitude != null && m.longitude != null);
      const withoutCoords = rows.filter(m => m.latitude == null || m.longitude == null);

      // Tier 4 markers are hidden by default — toggled on via the "Show Tier 4 on map" checkbox
      const tierColor = { 1: '#22c55e', 2: '#f59e0b', 3: '#3b82f6', 4: '#94a3b8' };
      for (const m of withCoords) {
        const mTier = _viewType === 'office' ? m.office_tier : m.tier;
        if (mTier == null) continue;
        if (mTier === 4 && !_showTier4) continue;
        const color = tierColor[mTier] || '#94a3b8';
        // T4 markers render slightly smaller + lower opacity so they don't visually dominate
        const sz = mTier === 4 ? 10 : 14;
        const op = mTier === 4 ? 0.7 : 1;
        const icon = L.divIcon({
          className: 'mr-marker',
          html: `<div style="background:${color};width:${sz}px;height:${sz}px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.2);opacity:${op};"></div>`,
          iconSize: [sz, sz],
          iconAnchor: [sz/2, sz/2],
        });
        const marker = L.marker([m.latitude, m.longitude], { icon, title: m.name });
        const tierLabel = mTier ? `Tier ${mTier}` : '';
        const _ms = _viewType === 'office' ? m.office_score : m.score;
        const scoreLabel = _ms != null ? `Score ${_ms}` : '';
        marker.bindPopup(
          `<div style="font-size:13px;min-width:160px;">
            <div style="font-weight:700;color:#0f172a;font-size:14px;">${_esc(m.name)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Pop ${m.population ? Number(m.population).toLocaleString() : '?'} · HHI ${m.median_household_income ? '$' + Number(m.median_household_income).toLocaleString() : '?'}</div>
            <div style="margin-top:6px;color:#475569;">${scoreLabel} · ${tierLabel}</div>
            <button onclick="mrOpenMarket('${m.id}'); return false;" style="margin-top:8px;background:#0ea5e9;color:#fff;border:none;padding:4px 10px;border-radius:5px;font-size:12px;cursor:pointer;">Open detail →</button>
          </div>`
        );
        _markerCluster.addLayer(marker);
      }
      // If the user searched an address, center on the pin + draw a radius
      // circle. Otherwise, fit to the visible markers (defaulting to the
      // contiguous lower-48 even when HI/AK markers exist).
      if (_addressPin && isFinite(_addressPin.lat) && isFinite(_addressPin.lng)) {
        _mapBoundsSettling = true;
        // Radius circle (60mi dashed red — matches the address-pin color)
        L.circle([_addressPin.lat, _addressPin.lng], {
          radius: _ADDRESS_RADIUS_MILES * 1609.34,
          color: '#dc2626', weight: 2, opacity: 0.55, dashArray: '6,5',
          fillColor: '#dc2626', fillOpacity: 0.04,
          interactive: false,
        }).addTo(_mapInstance);
        // Address pin
        const pinIcon = L.divIcon({
          className: 'mr-address-pin',
          html: `<div style="width:18px;height:18px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.45);"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const pinMarker = L.marker([_addressPin.lat, _addressPin.lng], { icon: pinIcon, zIndexOffset: 2000 });
        pinMarker.bindPopup(
          `<div style="font-size:13px;max-width:240px;">
            <div style="font-weight:700;margin-bottom:4px;color:#dc2626;">📍 Searched address</div>
            <div style="color:#475569;line-height:1.4;">${_esc(_addressPin.label)}</div>
            <div style="color:#94a3b8;margin-top:6px;font-size:11px;">Showing markets within ${_ADDRESS_RADIUS_MILES} miles</div>
          </div>`
        );
        pinMarker.addTo(_mapInstance);
        // Zoom level 9 ≈ ~60 mile radius visible — fits the dashed circle nicely
        _mapInstance.setView([_addressPin.lat, _addressPin.lng], 9, { animate: false });
        setTimeout(() => { _mapBoundsSettling = false; }, 600);
      } else if (withCoords.length > 0) {
        // Loose contiguous-US bbox (drops HI, AK, PR/territories)
        const inCONUS = m => (m.latitude >= 24.5 && m.latitude <= 49.5
                              && m.longitude >= -125 && m.longitude <= -66);
        const conus = withCoords.filter(inCONUS);
        const fitTo = conus.length > 0 ? conus : withCoords;
        const bounds = L.latLngBounds(fitTo.map(m => [m.latitude, m.longitude]));
        _mapBoundsSettling = true;
        // Tight fit — no padding, no buffer rendering of Canada/Mexico
        _mapInstance.fitBounds(bounds, { padding: [0, 0] });
        // Release the moveend lock after leaflet settles
        setTimeout(() => { _mapBoundsSettling = false; }, 600);
      }

      // After the map settles, link viewport changes to the list filter.
      // Debounce so panning doesn't fire a query on every pixel.
      let moveTimer = null;
      _mapInstance.on('moveend', () => {
        if (_mapBoundsSettling) return;
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
          const b = _mapInstance.getBounds();
          // Treat "showing whole US" as no filter to avoid spurious refetches
          const span = b.getNorth() - b.getSouth();
          if (span > 20) {
            if (_mapBounds) { _mapBounds = null; _page = 0; _refreshListOnly(); }
            return;
          }
          _mapBounds = {
            north: b.getNorth().toFixed(4),
            south: b.getSouth().toFixed(4),
            east:  b.getEast().toFixed(4),
            west:  b.getWest().toFixed(4),
          };
          _page = 0;
          _refreshListOnly();
        }, 300);
      });
    } catch (e) {
      console.warn('[mr] map init failed:', e);
    }
  }

  // Compact pager: « Prev   Page 3 of 260   Next »
  function _renderPager(pageCount) {
    const cur = _page + 1; // 1-indexed for display
    const canPrev = _page > 0;
    const canNext = _page < pageCount - 1;
    return `
      <div class="mr-pager">
        <button class="mr-pager-btn" ${canPrev ? '' : 'disabled'} onclick="mrPageGoto(${_page - 1})">‹ Prev</button>
        <span class="mr-pager-info">Page <strong>${cur.toLocaleString()}</strong> of <strong>${pageCount.toLocaleString()}</strong></span>
        <button class="mr-pager-btn" ${canNext ? '' : 'disabled'} onclick="mrPageGoto(${_page + 1})">Next ›</button>
      </div>`;
  }

  function _renderGridView(visible) {
    return `<div class="mr-grid">` + visible.map(m => {
      const tierLabel = m.tier != null ? `Tier ${m.tier}` : 'Untiered';
      const scoreNum = m.score != null ? m.score.toFixed(1) : '—';
      const popLine = m.population ? `Pop ${parseInt(m.population).toLocaleString()}` : '';
      const hhiLine = m.median_household_income ? `HHI $${parseInt(m.median_household_income).toLocaleString()}` : '';
      const metro = m.nearest_top50_city ? `Metro: ${m.nearest_top50_city}` : '';
      const stateLine = [popLine, hhiLine, metro].filter(Boolean).join(' · ');
      return `
        <div class="mr-card" onclick="mrOpenMarket('${m.id}')">
          <div class="mr-card-row">
            <div style="min-width:0;flex:1;">
              <h3 class="mr-card-title">${_esc(m.name)}</h3>
              ${stateLine ? `<div class="mr-card-state">${_esc(stateLine)}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
              <button class="mr-heart ${m.is_favorite ? 'active' : ''}" title="Favorite"
                      onclick="event.stopPropagation(); mrToggleFavorite('${m.id}')">${m.is_favorite ? '❤' : '♡'}</button>
              <div class="mr-score ${_scoreClass(m.score)}">
                <div class="mr-score-num">${scoreNum}</div>
                <div class="mr-score-label">Score</div>
              </div>
            </div>
          </div>
          <div class="mr-card-row">
            <span class="mr-tier ${_tierClass(m.tier)}">${tierLabel}</span>
            ${m.phase === 'shortlisted' ? '<span class="mr-status shortlisted">🎯 Shortlist</span>' : ''}
          </div>
          ${m.thesis ? `<div class="mr-card-thesis">${_esc(m.thesis)}</div>` : ''}
        </div>`;
    }).join('') + `</div>`;
  }

  function _renderListView(visible) {
    const startIdx = (_page || 0) * PAGE_SIZE; // for rank numbers across pages
    return `
      <div class="mr-table-wrap">
        <table class="mr-table">
          <thead>
            <tr>
              <th style="width:36px;text-align:center;">#</th>
              <th style="width:26px;"></th>
              <th style="width:13%;">Market</th>
              <th style="width:9%;text-align:right;">Population</th>
              <th style="width:10%;text-align:right;">Median HHI</th>
              <th style="width:12%;">Nearby Metro</th>
              <th style="width:9%;text-align:center;">${_viewType === 'office' ? '🏢 Office Score' : '🏠 Residential Score'}</th>
              <th style="width:8%;text-align:center;">${_viewType === 'office' ? 'Office Tier' : 'Residential Tier'}</th>
              <th>Thesis</th>
            </tr>
          </thead>
          <tbody>
            ${visible.map((m, idx) => {
              const mScore = _viewType === 'office' ? m.office_score : m.score;
              const mTier  = _viewType === 'office' ? m.office_tier  : m.tier;
              const scoreNum = mScore != null ? mScore.toFixed(1) : '—';
              const tierLabel = mTier != null ? `T${mTier}` : '—';
              const pop = m.population ? parseInt(m.population).toLocaleString() : '—';
              const hhi = m.median_household_income ? '$' + parseInt(m.median_household_income).toLocaleString() : '—';
              const metro = m.nearest_top50_city || '—';
              // Persistent global rank — survives search/filter so user always
              // sees the market's true ranking, not its position in the result list.
              const mRank = _viewType === 'office' ? m.rank_office : m.rank_residential;
              const rank = mRank != null ? mRank : (startIdx + idx + 1);
              return `
                <tr onclick="mrOpenMarket('${m.id}')">
                  <td style="text-align:center;font-variant-numeric:tabular-nums;font-weight:600;color:#64748b;font-size:12px;">${rank}</td>
                  <td style="text-align:center;">
                    <button class="mr-heart ${m.is_favorite ? 'active' : ''}" title="Favorite"
                            onclick="event.stopPropagation(); mrToggleFavorite('${m.id}')">${m.is_favorite ? '❤' : '♡'}</button>
                  </td>
                  <td>
                    <div class="mr-table-name">${_esc(m.name)}</div>
                    ${m.latitude != null && m.longitude != null
                      ? `<a class="mr-view-on-map" onclick="event.stopPropagation(); mrViewOnMap(${m.latitude}, ${m.longitude}, '${_esc(m.name)}')">view on map</a>`
                      : ''}
                  </td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums;color:#475569;">${pop}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums;color:#0f172a;font-weight:600;">${hhi}</td>
                  <td style="font-size:12px;color:#475569;">${_esc(metro)}</td>
                  <td style="text-align:center;">
                    <span class="mr-table-score ${_scoreClass(mScore)}">${scoreNum}</span>
                  </td>
                  <td style="text-align:center;">
                    <span class="mr-tier ${_tierClass(mTier)}">${tierLabel}</span>
                  </td>
                  <td>
                    ${m.thesis ? `<div class="mr-table-thesis">${_esc(m.thesis)}</div>` : '<span style="color:#cbd5e1;">—</span>'}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function _setViewMode(mode) {
    _viewMode = (mode === 'map') ? 'map' : 'list';
    try { localStorage.setItem('mr_view_mode', _viewMode); } catch(_) {}
    _renderGrid();
  }

  // ── Detail render ────────────────────────────────────────
  async function _openMarket(id) {
    // Look in current page first; if not present (different page), fetch by id
    _currentMarket = _markets.find(m => m.id === id) ||
                     _shortlistFull.find(m => m.id === id);
    if (!_currentMarket) {
      try {
        const rows = await window.supaFetch('market_research_markets', `?select=*&id=eq.${id}&limit=1`);
        _currentMarket = (rows && rows[0]) || null;
      } catch (e) { /* swallow */ }
    }
    if (!_currentMarket) return;
    // Load this market's scores (per-market avoids 1000-row PostgREST cap)
    await _loadScoresForMarket(id);
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

    // Top metric cards — show BOTH Residential and Office score/tier
    const scoreColor = (s) => s >= 8 ? '#15803d' : (s >= 6 ? '#65a30d' : (s >= 4 ? '#ca8a04' : (s != null ? '#b91c1c' : '#cbd5e1')));
    document.getElementById('mrDetailMetrics').innerHTML = `
      <div class="mr-metric-card">
        <div class="mr-metric-label">🏠 Residential Score</div>
        <div class="mr-metric-value" style="color:${scoreColor(m.score)};">${m.score != null ? m.score.toFixed(1) : '—'}</div>
        <div style="font-size:11px;margin-top:4px;"><span class="mr-tier ${_tierClass(m.tier)}">${m.tier != null ? 'Tier ' + m.tier : 'Untiered'}</span> ${m.rank_residential != null ? `<span style="color:#94a3b8;margin-left:4px;">· #${m.rank_residential.toLocaleString()}</span>` : ''}</div>
      </div>
      <div class="mr-metric-card">
        <div class="mr-metric-label">🏢 Office Score</div>
        <div class="mr-metric-value" style="color:${scoreColor(m.office_score)};">${m.office_score != null ? m.office_score.toFixed(1) : '—'}</div>
        <div style="font-size:11px;margin-top:4px;"><span class="mr-tier ${_tierClass(m.office_tier)}">${m.office_tier != null ? 'Tier ' + m.office_tier : 'Untiered'}</span> ${m.rank_office != null ? `<span style="color:#94a3b8;margin-left:4px;">· #${m.rank_office.toLocaleString()}</span>` : ''}</div>
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
    // Resolve scorecard view — defaults to the page-level asset class
    if (_scorecardView == null) _scorecardView = _viewType || 'residential';
    const view = _scorecardView;
    // Sync toggle button active state
    document.querySelectorAll('#mrScorecardToggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });

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

    // Group criteria by category, render section headers between groups
    const active = _criteria.filter(c => c.is_active !== false);
    const byCat = {};
    active.forEach(c => {
      const cat = c.category || 'uncategorized';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(c);
    });
    const orderedCats = _CAT_ORDER.filter(c => byCat[c]).concat(
      Object.keys(byCat).filter(c => !_CAT_ORDER.includes(c))
    );
    let bodyHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:38%;">Criterion</th>
            <th style="width:30%;">Value</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>`;
    orderedCats.forEach(cat => {
      const rows = byCat[cat].slice().sort((a,b) => (a.sort_order||0) - (b.sort_order||0) || a.name.localeCompare(b.name));
      const catObj = _categories.find(c => c.slug === cat) || {};
      const catWeight = catObj.weight != null ? catObj.weight : 1;
      const phaseTag = _PHASE2_CATEGORIES.has(cat)
        ? '<span style="font-size:10px;font-weight:600;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;padding:1px 7px;border-radius:8px;">⚙️ Phase 2 scored</span>'
        : '<span style="font-size:10px;font-weight:600;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;padding:1px 7px;border-radius:8px;">🔬 Phase 3 (deep research)</span>';
      bodyHtml += `
        <tr><td colspan="3" class="mr-cat-header" data-cat="${_esc(cat)}">
          <span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${_esc(_CAT_LABELS[cat] || cat)}
            <span style="font-size:10px;font-weight:600;color:#0ea5e9;background:#e0f2fe;padding:2px 8px;border-radius:8px;">weight ${catWeight}</span>
            ${phaseTag}
          </span>
        </td></tr>`;
      rows.forEach(c => {
        const s = scoreByCriterion[c.id] || {};
        // Display value priority:
        //   1. value_text (Phase 3 stores actual data here, e.g. "Aaa/AAA Moody's")
        //   2. derived from market columns for the 3 Phase 2 criteria where we have raw data
        //   3. nothing (placeholder)
        // The 0-10 score (value_numeric) is always shown as a small chip beside the value.
        let displayValue = s.value_text || '';
        if (!displayValue && _PHASE2_VALUE_FROM_MARKET[c.name]) {
          displayValue = _PHASE2_VALUE_FROM_MARKET[c.name](m) || '';
        }
        // Use the view-specific 0-10 score column
        const scoreVal = view === 'office' ? s.value_numeric_office : s.value_numeric;
        const scoreNum = (scoreVal != null && scoreVal !== '') ? Number(scoreVal).toFixed(1) : null;
        const target = _fmtTarget(c);
        // Always cite a source. If no score yet for a Phase 3 criterion, show suggested source.
        const SOURCE_SUGGESTIONS = {
          governance: 'Pending Phase 3 — local zoning + Moody\'s/S&P ratings',
          economic_activity: 'Pending Phase 3 — Fortune 1000, LinkedIn execs, AirNav',
          quality_of_life: 'Pending Phase 3 — FBI UCR, Niche.com, GreatSchools',
          transit: 'Pending Phase 3 — Google Maps drive time, transit rail',
          demographics: 'US Census ACS 2022 5-yr',
          education: 'US Census ACS 2022 5-yr',
          company_concentrations: 'Big_Four_and_Wealth_Mgmt_Within_60mi.xlsx',
        };
        const placeholder = SOURCE_SUGGESTIONS[c.category] || (c.source_note || 'Source / note');
        const effectiveSource = s.source || '';
        bodyHtml += `
          <tr>
            <td>
              <div style="font-weight:500;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                ${_esc(c.name)}
                ${target ? `<span class="mr-target-chip" title="Target">🎯 ${_esc(target)}</span>` : ''}
              </div>
              ${c.description ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${_esc(c.description)}</div>` : ''}
            </td>
            <td>
              ${displayValue
                ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                     <span style="font-size:13px;font-weight:600;color:#0f172a;">${_esc(displayValue)}</span>
                     ${scoreNum != null ? `<span class="mr-score-chip ${_scoreClass(parseFloat(scoreNum))}">${scoreNum}/10</span>` : ''}
                   </div>`
                : (scoreNum != null
                    ? `<span class="mr-score-chip ${_scoreClass(parseFloat(scoreNum))}">${scoreNum}/10</span>`
                    : `<span style="color:#cbd5e1;font-size:12px;">—</span>`)}
            </td>
            <td>
              ${(() => {
                // Prefer sources[] array; fall back to legacy single source string
                let list = Array.isArray(s.sources) && s.sources.length > 0
                  ? s.sources
                  : (s.source ? [s.source] : []);
                if (list.length === 0) {
                  return `<span class="mr-source-placeholder">${_esc(placeholder)}</span>`;
                }
                return list.map(src => {
                  const url = _extractSourceUrl(src);
                  if (url) {
                    return `<div><a href="${_esc(url)}" target="_blank" rel="noopener" class="mr-source-link" title="${_esc(src)}">${_esc(src)}</a></div>`;
                  }
                  return `<div><span class="mr-source-text">${_esc(src)}</span></div>`;
                }).join('');
              })()}
            </td>
          </tr>`;
      });
    });
    bodyHtml += `</tbody></table>`;
    bodyEl.innerHTML = bodyHtml;
  }

  // ── Chatbot — Claude API call with markets/criteria/scores context ──
  async function _chatSubmit() {
    const input = document.getElementById('mrChatInput');
    const out = document.getElementById('mrChatOutput');
    const btn = document.getElementById('mrChatSend');
    if (!input || !out || !btn) return;
    const q = (input.value || '').trim();
    if (!q) return;
    // Same key chain as Phase 3
    const BUILD_INJECTED_KEY = '__CLAUDE_API_KEY__';
    const apiKey = (BUILD_INJECTED_KEY.indexOf('__CLAUDE') === -1)
      ? BUILD_INJECTED_KEY
      : window.CLAUDE_API_KEY;
    if (!apiKey) { out.classList.add('show'); out.innerHTML = '<div class="mr-chat-q">Error</div><div class="mr-chat-a">Claude API key not configured.</div>'; return; }

    // Build context for Claude — current markets, criteria (grouped), and any scores
    const criteriaByCat = {};
    _criteria.filter(c => c.is_active !== false).forEach(c => {
      const cat = c.category || 'uncategorized';
      (criteriaByCat[cat] = criteriaByCat[cat] || []).push({
        name: c.name,
        description: c.description || null,
        target: _fmtTarget(c) || null,
        weight: c.weight != null ? c.weight : 1,
      });
    });
    const scoresByMarket = {};
    _scores.forEach(s => {
      const cName = (_criteria.find(c => c.id === s.criterion_id) || {}).name;
      if (!cName) return;
      (scoresByMarket[s.market_id] = scoresByMarket[s.market_id] || {})[cName] =
        s.value_numeric != null ? s.value_numeric : (s.value_text || null);
    });
    // Chatbot context = the shortlist (≤ ~1k towns) rather than the 100-row
    // visible page or the full 26k universe.
    const ctxSource = (_shortlistFull && _shortlistFull.length) ? _shortlistFull : _markets;
    const marketSummaries = ctxSource.map(m => ({
      id: m.id, name: m.name, state: m.state,
      population: m.population,
      median_household_income: m.median_household_income,
      median_home_value: m.median_home_value,
      nearest_top50_city: m.nearest_top50_city,
      is_favorite: m.is_favorite || false,
      thesis: m.thesis || null,
      scores: scoresByMarket[m.id] || null,
    }));

    const systemPrompt = `You are a research analyst helping First Mile Capital evaluate small affluent towns as real-estate acquisition markets.

You have access to:
1. CRITERIA — 6 categories of evaluation criteria (Demographics, Governance/Barriers, Economic Activity, Education, Quality of Life, Transit). Each criterion has a target threshold.
2. MARKETS — a list of candidate towns with their state, MSA, population, status, thesis, and any scored values.

Answer the user's question concisely (under 250 words unless the question is broad). When you reference specific towns or criteria, name them exactly. If the data doesn't contain enough info to answer, say so plainly and suggest what would need to be filled in.

CRITERIA (grouped by category):
${JSON.stringify(criteriaByCat, null, 2)}

MARKETS:
${JSON.stringify(marketSummaries, null, 2)}`;

    out.classList.add('show');
    out.innerHTML = `<div class="mr-chat-q">You asked</div><div class="mr-chat-a" style="margin-bottom:12px;">${_esc(q)}</div><div class="mr-chat-loading">Thinking…</div>`;
    btn.disabled = true; btn.textContent = '…';

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{ role: 'user', content: q }],
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`API ${r.status}: ${err.slice(0, 200)}`);
      }
      const data = await r.json();
      const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      out.innerHTML = `<div class="mr-chat-q">You asked</div><div class="mr-chat-a" style="margin-bottom:12px;">${_esc(q)}</div><div class="mr-chat-q">Claude says</div><div class="mr-chat-a">${_esc(answer || '(no response)')}</div>`;
    } catch (e) {
      out.innerHTML = `<div class="mr-chat-q">Error</div><div class="mr-chat-a">${_esc(String(e))}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Ask';
      input.value = '';
    }
  }

  function _chatSuggest(text) {
    const input = document.getElementById('mrChatInput');
    if (!input) return;
    input.value = text;
    input.focus();
  }

  // ── Phase 3 bulk runner (cloud edge function, batched) ──
  let _bulkP3Cancel = false;
  async function _bulkPhase3() {
    const btn = document.getElementById('mrBulkP3Btn');
    const label = document.getElementById('mrBulkP3BtnLabel');
    const HARD_CAP_USD = 25;
    const WARN_AT_USD = 12;
    const BATCH = 20;
    const CONCURRENCY = 8;

    // Confirm
    if (!confirm('Run Phase 3 deep research on every Tier-1 town (~484, skipping done).\n\nProjected cost: ~$19 at ~$0.04/town.\nHard stop: $25. Continue?')) return;

    _bulkP3Cancel = false;
    btn.disabled = true;
    label.textContent = 'Starting…';

    // Open a status modal that updates in place
    _openModal('🔬 Bulk Phase 3 — Tier 1', `
      <div id="mrBulkP3Status" style="font-size:13px;color:#475569;line-height:1.55;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;">
        Initialising…
      </div>
      <div id="mrBulkP3Log" style="margin-top:10px;max-height:280px;overflow-y:auto;font-size:11px;color:#475569;font-family:'SF Mono',monospace;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;"></div>
      <div class="mr-modal-actions">
        <button class="mr-btn" onclick="mrBulkPhase3Cancel()" style="color:#b91c1c;">Cancel</button>
        <button class="mr-btn" onclick="mrCloseModal()">Close window (run continues server-side)</button>
      </div>
    `, { wide: true });
    const statusEl = document.getElementById('mrBulkP3Status');
    const logEl = document.getElementById('mrBulkP3Log');
    const log = (msg) => { if (logEl) { logEl.innerHTML += `<div>${_esc(msg)}</div>`; logEl.scrollTop = logEl.scrollHeight; } };

    let totalProcessed = 0;
    let totalRows = 0;
    let totalCost = 0;
    let batches = 0;
    const t0 = Date.now();

    while (!_bulkP3Cancel) {
      batches++;
      const startBatch = Date.now();
      if (statusEl) statusEl.innerHTML = `Batch ${batches} — processed <strong>${totalProcessed}</strong> towns · scores written <strong>${totalRows}</strong> · spent <strong>$${totalCost.toFixed(3)}</strong>`;
      log(`▶ Batch ${batches} starting…`);
      try {
        const r = await fetch(`${window.SUPABASE_URL}/functions/v1/market-research-phase3`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + window.SUPABASE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier_filter: [1],
            limit: BATCH,
            concurrency: CONCURRENCY,
            skip_already_done: true,
            max_cost_usd: 25,
          }),
        });
        const data = await r.json();
        if (!r.ok || !data.ok) {
          log(`✗ Batch ${batches} failed: ${data.error || r.status}`);
          break;
        }
        totalProcessed += data.processed || 0;
        totalRows += data.score_rows_written || 0;
        totalCost += data.cost_usd || 0;
        const elapsed = ((Date.now() - startBatch) / 1000).toFixed(1);
        log(`✓ Batch ${batches}: +${data.processed} towns, +${data.score_rows_written} rows, +$${(data.cost_usd || 0).toFixed(3)}, ${elapsed}s · remaining: ${data.remaining_in_filter}`);
        if (data.errors && data.errors.length > 0) {
          for (const e of data.errors.slice(0, 3)) log(`  ⚠ ${e.name || e.market_id}: ${e.error}`);
          if (data.errors.length > 3) log(`  ⚠ …and ${data.errors.length - 3} more errors`);
        }
        // Budget check — warn at $8, hard stop at $20
        if (totalCost >= HARD_CAP_USD) {
          log(`🛑 Hard cap reached ($${totalCost.toFixed(2)} ≥ $${HARD_CAP_USD}). Stopping.`);
          alert(`Bulk Phase 3 stopped: cost reached $${totalCost.toFixed(2)}, exceeding the $${HARD_CAP_USD} hard cap. ${totalProcessed} towns processed.`);
          break;
        }
        if (totalCost >= WARN_AT_USD) {
          const proj = data.remaining_in_filter > 0 ? totalCost * (1 + data.remaining_in_filter / Math.max(1, totalProcessed)) : totalCost;
          if (proj > 25) {
            const ok = confirm(`Mid-run check: spent $${totalCost.toFixed(2)} so far on ${totalProcessed} towns. Projecting ~$${proj.toFixed(2)} total if we finish all ${data.remaining_in_filter} remaining. Continue?`);
            if (!ok) { log('User stopped at mid-run check.'); break; }
          }
        }
        // Stop if no more
        if ((data.processed || 0) === 0 || (data.remaining_in_filter ?? 0) <= 0) {
          log(`✓ Done. No more towns to process in this filter.`);
          break;
        }
      } catch (e) {
        log(`✗ Batch ${batches} error: ${String(e).slice(0, 200)}`);
        break;
      }
    }

    const wall = ((Date.now() - t0) / 60000).toFixed(1);
    if (statusEl) {
      statusEl.innerHTML = `<strong style="color:${_bulkP3Cancel ? '#b91c1c' : '#166534'};">${_bulkP3Cancel ? 'Cancelled' : '✓ Complete'}.</strong> ${totalProcessed} towns, ${totalRows} score rows, $${totalCost.toFixed(3)} spent, ${wall} min.`;
    }
    btn.disabled = false;
    label.textContent = 'Run on Tier 1';
    // Refresh data so the grid + counts reflect new scores
    try { await _loadData(); _renderGrid(); } catch {}
  }
  function _bulkPhase3Cancel() {
    _bulkP3Cancel = true;
  }

  // ── Auto-recompute all scores (debounced) ───────────────
  // Triggered when category weights change OR criteria are added/edited/removed.
  // Calls the edge function in recompute_only mode — pure DB math, no Claude.
  let _recomputeTimer = null;
  function _scheduleRecomputeAll() {
    clearTimeout(_recomputeTimer);
    _recomputeTimer = setTimeout(async () => {
      try {
        _toast('Recomputing Residential + Office scores…');
        // Single SQL that computes BOTH composites at once, using each
        // view's category weights + each row's value_numeric / value_numeric_office.
        // Composite recompute. Per-view AVG excludes criteria where the
      // corresponding is_active_{view} flag is false — those criteria don't
      // factor into that view's category mean. Each view independently.
      const sql = `WITH cat_means AS (
          SELECT s.market_id, c.category_id,
                 AVG(CASE WHEN c.is_active_residential IS NOT FALSE THEN s.value_numeric ELSE NULL END) AS mean_res,
                 AVG(CASE WHEN c.is_active_office      IS NOT FALSE THEN s.value_numeric_office ELSE NULL END) AS mean_off
          FROM market_research_scores s
          JOIN market_research_criteria c ON c.id = s.criterion_id
          WHERE c.category_id IS NOT NULL
          GROUP BY s.market_id, c.category_id
        ),
        composites AS (
          SELECT cm.market_id,
                 SUM(cm.mean_res * cat.weight)        / NULLIF(SUM(CASE WHEN cm.mean_res IS NOT NULL THEN cat.weight ELSE 0 END), 0)        AS comp_res,
                 SUM(cm.mean_off * cat.weight_office) / NULLIF(SUM(CASE WHEN cm.mean_off IS NOT NULL THEN cat.weight_office ELSE 0 END), 0) AS comp_off
          FROM cat_means cm JOIN market_research_categories cat ON cat.id = cm.category_id
          GROUP BY cm.market_id
        )
        UPDATE market_research_markets m SET
          score        = ROUND(c.comp_res::numeric, 1),
          tier         = CASE WHEN c.comp_res >= 8.5 THEN 1 WHEN c.comp_res >= 7.0 THEN 2 WHEN c.comp_res >= 4.0 THEN 3 WHEN c.comp_res IS NOT NULL THEN 4 ELSE m.tier END,
          office_score = ROUND(c.comp_off::numeric, 1),
          office_tier  = CASE WHEN c.comp_off >= 8.5 THEN 1 WHEN c.comp_off >= 7.0 THEN 2 WHEN c.comp_off >= 4.0 THEN 3 WHEN c.comp_off IS NOT NULL THEN 4 ELSE m.office_tier END,
          updated_at = now()
        FROM composites c WHERE m.id = c.market_id`;
        const _runSql = async (q) => {
          const resp = await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: { apikey: window.SUPABASE_KEY, Authorization: 'Bearer ' + window.SUPABASE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q }),
          });
          if (!resp.ok) throw new Error('status ' + resp.status);
        };
        await _runSql(sql);
        await _runSql(`WITH rr AS (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC NULLS LAST, median_household_income DESC NULLS LAST, name ASC) AS r FROM market_research_markets WHERE score IS NOT NULL) UPDATE market_research_markets m SET rank_residential = rr.r FROM rr WHERE m.id = rr.id`);
        await _runSql(`WITH ro AS (SELECT id, ROW_NUMBER() OVER (ORDER BY office_score DESC NULLS LAST, median_household_income DESC NULLS LAST, name ASC) AS r FROM market_research_markets WHERE office_score IS NOT NULL) UPDATE market_research_markets m SET rank_office = ro.r FROM ro WHERE m.id = ro.id`);
        _toast('✓ Recomputed all markets (Residential + Office)');
        try { await _loadData(); _renderGrid(); } catch {}
        if (_currentMarket) {
          try { await _loadScoresForMarket(_currentMarket.id); _renderDetail(); } catch {}
        }
      } catch (e) {
        _toast('Recompute failed: ' + e.message, true);
      }
    }, 1500);
  }

  // Pull every score for a market, recompute weighted composite + tier,
  // PATCH market.score / market.tier. Mirrors the edge function logic so
  // the browser-side per-town research updates the composite immediately.
  async function _recomputeMarketComposite(marketId) {
    // Use cached categories/criteria if loaded; otherwise fetch
    let cats = _categories;
    if (!cats || cats.length === 0) {
      cats = await window.supaFetch('market_research_categories', '?select=*');
    }
    const crits = (_criteria && _criteria.length)
      ? _criteria
      : await window.supaFetch('market_research_criteria', '?select=*');
    const catOfCrit = new Map(crits.map(c => [c.id, c.category_id]));
    const weightOfCat = new Map(cats.map(c => [c.id, parseFloat(c.weight || 1)]));
    // Fetch scores for this market
    const scores = await window.supaFetch(
      'market_research_scores',
      `?select=value_numeric,criterion_id&market_id=eq.${marketId}&limit=1000`
    );
    const byCat = new Map();
    for (const s of (scores || [])) {
      if (s.value_numeric == null) continue;
      const catId = catOfCrit.get(s.criterion_id);
      if (!catId) continue;
      if (!byCat.has(catId)) byCat.set(catId, []);
      byCat.get(catId).push(parseFloat(s.value_numeric));
    }
    let weightedSum = 0, totalWeight = 0;
    for (const [catId, subs] of byCat) {
      if (subs.length === 0) continue;
      const mean = subs.reduce((a, b) => a + b, 0) / subs.length;
      const w = weightOfCat.get(catId) ?? 1;
      weightedSum += mean * w;
      totalWeight += w;
    }
    if (totalWeight === 0) return;
    const composite = weightedSum / totalWeight;
    const score = Math.round(composite * 10) / 10;
    // Tier bands — Tier 1 stays tight (≥8.5); Tier 3 widened (4.0–6.9) so it
    // captures the broader $100k-HHI shortlist additions and isn't near-empty.
    const tier = score >= 8.5 ? 1 : score >= 7.0 ? 2 : score >= 4.0 ? 3 : 4;
    await window.supaWrite('market_research_markets', 'PATCH', { score, tier }, `?id=eq.${marketId}`);
  }

  // ── Phase 3: Deep Research per town ─────────────────────
  // Calls Claude (sonnet-4-6) to score the 4 Phase 3 categories using its
  // training knowledge + the Research Websites list as citation sources.
  // Writes results to market_research_scores + recomputes composite Score/Tier.
  const _RESEARCH_SOURCES = [
    { label: 'CBRE Insights', url: 'https://www.cbre.com/insights' },
    { label: 'JLL Market Outlook (US)', url: 'https://www.jll.com/en-us/insights/market-outlook' },
    { label: 'JLL Market Dynamics', url: 'https://www.jll.com/en-us/insights/market-dynamics' },
    { label: 'JLL Cities Insights', url: 'https://www.jll.com/en-us/insights/cities' },
    { label: 'JLL Capital Flows', url: 'https://www.jll.com/en-us/insights/capital-flows' },
    { label: 'Newmark Insights', url: 'https://www.nmrk.com/insights' },
    { label: 'Walker Dunlop Suite', url: 'https://suite.walkerdunlop.com/' },
    { label: 'Savills Impacts', url: 'https://impacts.savills.com/' },
    { label: 'Challenger Gray (job cuts / CEO turnover / workplace)', url: 'https://www.challengergray.com/blog/' },
    { label: 'St Louis Fed — On the Economy', url: 'https://www.stlouisfed.org/on-the-economy' },
    { label: 'Niche.com town/neighborhood grades', url: 'https://www.niche.com/places-to-live/' },
    { label: 'GreatSchools.org', url: 'https://www.greatschools.org/' },
    { label: 'FBI Uniform Crime Reporting', url: 'https://crime-data-explorer.fr.cloud.gov/' },
    { label: 'US Census ACS', url: 'https://data.census.gov/' },
  ];

  // ── PDF export ────────────────────────────────────────────
  // One-click "Save as PDF" of the active market. Builds a clean, fixed-width
  // PDF document FROM THE UNDERLYING DATA (thesis, summary, scores, metrics)
  // with fully inline styles — does NOT screenshot the live UI (that caused
  // unpredictable clipping because the detail view inherits a wide parent
  // layout). Uses html2pdf.bundle (html2canvas + jsPDF) loaded lazily.
  async function _ensureHtml2Pdf() {
    if (window.html2pdf) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load html2pdf'));
      document.head.appendChild(s);
    });
  }
  function _pdfMetricCard(label, value) {
    return `
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 12px;">
        <div style="font-size:9px; color:#64748b; letter-spacing:0.05em; text-transform:uppercase; font-weight:700;">${_esc(label)}</div>
        <div style="font-size:16px; font-weight:700; color:#0f172a; margin-top:2px;">${value || '—'}</div>
      </div>
    `;
  }
  function _pdfScoreChip(scoreNum) {
    if (scoreNum == null) return '<span style="color:#cbd5e1; font-size:10px;">—</span>';
    const n = parseFloat(scoreNum);
    let bg = '#fee2e2', fg = '#991b1b';
    if (n >= 7) { bg = '#dcfce7'; fg = '#166534'; }
    else if (n >= 4) { bg = '#fef3c7'; fg = '#92400e'; }
    return `<span style="display:inline-block; background:${bg}; color:${fg}; font-size:10px; font-weight:700; padding:2px 7px; border-radius:6px;">${scoreNum}</span>`;
  }
  async function _exportMarketPDF() {
    if (!_currentMarket) { _toast('Open a market first', true); return; }
    const m = _currentMarket;
    _toast('Generating PDF…');
    try { await _ensureHtml2Pdf(); }
    catch (e) { _toast('Could not load PDF library', true); return; }

    const view = _scorecardView || _viewType || 'residential';
    const scoreByCriterion = {};
    _scores.filter(s => s.market_id === m.id).forEach(s => { scoreByCriterion[s.criterion_id] = s; });

    const tierLabel = m.tier ? `Tier ${m.tier}` : '';
    const scoreLabel = (m.score != null) ? Number(m.score).toFixed(1) : '—';
    const offScore = (m.office_score != null) ? Number(m.office_score).toFixed(1) : '—';
    const dateLabel = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    let html = `
      <!-- Brand header -->
      <div style="display:flex; justify-content:space-between; align-items:flex-end; padding-bottom:14px; border-bottom:2px solid #0ea5e9; margin-bottom:20px;">
        <div>
          <div style="font-size:10px; color:#64748b; letter-spacing:0.08em; text-transform:uppercase; font-weight:700;">First Mile Capital · Market Research</div>
          <div style="font-size:24px; font-weight:700; color:#0f172a; margin-top:4px; line-height:1.15;">${_esc(m.name)}</div>
          <div style="font-size:11px; color:#475569; margin-top:4px;">
            ${_esc(m.state || '')}${m.nearest_top50_city ? ' · Metro: ' + _esc(m.nearest_top50_city) : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px; color:#64748b;">${_esc(dateLabel)}</div>
          <div style="margin-top:6px; white-space:nowrap;">
            <span style="display:inline-block; background:#0ea5e9; color:#fff; font-size:11px; font-weight:700; padding:3px 10px; border-radius:6px;">Score ${scoreLabel}</span>
            ${tierLabel ? `<span style="display:inline-block; margin-left:4px; background:#0f172a; color:#fff; font-size:11px; font-weight:700; padding:3px 10px; border-radius:6px;">${_esc(tierLabel)}</span>` : ''}
          </div>
        </div>
      </div>

      <!-- Key metrics 2x2 (flexbox — html2canvas has poor CSS Grid support) -->
      <div style="margin-bottom:18px;">
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1;">${_pdfMetricCard('Population', m.population ? Number(m.population).toLocaleString() : '—')}</div>
          <div style="flex:1;">${_pdfMetricCard('Median Household Income', m.median_household_income ? '$' + Number(m.median_household_income).toLocaleString() : '—')}</div>
        </div>
        <div style="display:flex; gap:10px;">
          <div style="flex:1;">${_pdfMetricCard('Median Home Value', m.median_home_value ? '$' + Number(m.median_home_value).toLocaleString() : '—')}</div>
          <div style="flex:1;">${_pdfMetricCard('Office Score · Tier', offScore + (m.office_tier ? ' · T' + m.office_tier : ''))}</div>
        </div>
      </div>
    `;

    if (m.summary) {
      html += `
        <div style="background:#f8fafc; border-left:3px solid #0ea5e9; padding:10px 14px; margin-bottom:14px; border-radius:0 6px 6px 0; page-break-inside:avoid;">
          <div style="font-size:10px; color:#64748b; letter-spacing:0.05em; text-transform:uppercase; font-weight:700; margin-bottom:4px;">Executive Summary</div>
          <div style="font-size:12px; color:#1e293b; line-height:1.5;">${_esc(m.summary)}</div>
        </div>`;
    }

    if (m.thesis) {
      html += `
        <div style="margin-bottom:18px; page-break-inside:avoid;">
          <div style="font-size:11px; color:#64748b; letter-spacing:0.05em; text-transform:uppercase; font-weight:700; margin-bottom:6px;">Investment Thesis</div>
          <div style="font-size:12px; color:#1e293b; line-height:1.55; white-space:pre-wrap;">${_esc(m.thesis)}</div>
        </div>`;
    }

    // Scorecard grouped by category
    const active = _criteria.filter(c => c.is_active !== false);
    const byCat = {};
    active.forEach(c => {
      const cat = c.category || 'uncategorized';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(c);
    });
    const orderedCats = _CAT_ORDER.filter(c => byCat[c]).concat(
      Object.keys(byCat).filter(c => !_CAT_ORDER.includes(c))
    );

    html += `
      <div style="margin-top:6px;">
        <div style="font-size:11px; color:#64748b; letter-spacing:0.05em; text-transform:uppercase; font-weight:700; margin-bottom:10px;">
          Criteria Scorecard (${view === 'office' ? 'Office' : 'Residential'} view)
        </div>
    `;
    orderedCats.forEach(cat => {
      const rows = byCat[cat].slice().sort((a,b) => (a.sort_order||0) - (b.sort_order||0) || a.name.localeCompare(b.name));
      const catObj = _categories.find(c => c.slug === cat) || {};
      const catWeight = catObj.weight != null ? catObj.weight : 1;
      const isPhase2 = _PHASE2_CATEGORIES.has(cat);
      const phaseLabel = isPhase2 ? 'Phase 2' : 'Phase 3';
      const phaseBg = isPhase2 ? '#f0fdf4' : '#fff7ed';
      const phaseFg = isPhase2 ? '#166534' : '#9a3412';
      const phaseBorder = isPhase2 ? '#bbf7d0' : '#fed7aa';

      html += `
        <div style="page-break-inside:avoid; margin-bottom:12px; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden;">
          <div style="background:#f8fafc; padding:7px 12px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:13px; font-weight:700; color:#0f172a;">${_esc(_CAT_LABELS[cat] || cat)}</span>
            <span style="white-space:nowrap;">
              <span style="font-size:9px; font-weight:600; color:#0369a1; background:#e0f2fe; padding:2px 7px; border-radius:8px;">weight ${catWeight}</span>
              <span style="font-size:9px; font-weight:600; color:${phaseFg}; background:${phaseBg}; border:1px solid ${phaseBorder}; padding:2px 7px; border-radius:8px; margin-left:4px;">${phaseLabel}</span>
            </span>
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:11px;">
      `;
      rows.forEach(c => {
        const s = scoreByCriterion[c.id] || {};
        let displayValue = s.value_text || '';
        if (!displayValue && _PHASE2_VALUE_FROM_MARKET[c.name]) {
          displayValue = _PHASE2_VALUE_FROM_MARKET[c.name](m) || '';
        }
        const scoreVal = view === 'office' ? s.value_numeric_office : s.value_numeric;
        const scoreNum = (scoreVal != null && scoreVal !== '') ? Number(scoreVal).toFixed(1) : null;
        const target = _fmtTarget(c);
        const source = s.source || '';
        html += `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:6px 10px; vertical-align:top; width:36%;">
              <div style="font-weight:600; color:#0f172a; font-size:11px; line-height:1.3;">${_esc(c.name)}</div>
              ${target ? `<div style="font-size:9px; color:#94a3b8; margin-top:1px;">Target: ${_esc(target)}</div>` : ''}
            </td>
            <td style="padding:6px 8px; vertical-align:top; width:9%; text-align:center;">${_pdfScoreChip(scoreNum)}</td>
            <td style="padding:6px 10px; vertical-align:top; width:30%; font-size:10px; color:#334155; line-height:1.35;">${displayValue ? _esc(displayValue) : '<span style="color:#cbd5e1;">—</span>'}</td>
            <td style="padding:6px 10px; vertical-align:top; width:25%; font-size:9px; color:#64748b; line-height:1.35; word-break:break-word;">${source ? _esc(source) : '<span style="color:#cbd5e1;">—</span>'}</td>
          </tr>
        `;
      });
      html += `</table></div>`;
    });
    html += `</div>`;

    // Footer
    html += `
      <div style="margin-top:18px; padding-top:10px; border-top:1px solid #e2e8f0; text-align:center; font-size:9px; color:#94a3b8;">
        First Mile Capital · admin.firstmilecap.com · Generated ${_esc(dateLabel)}
      </div>
    `;

    // Off-screen wrapper. CRITICAL: position:absolute + left:-10000px (NOT
    // position:fixed) so the element stays in the document flow and actually
    // gets painted — html2canvas needs that to render content. Fixed
    // positioning with negative top produced a blank PDF.
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: absolute !important;
      left: -10000px !important;
      top: 0 !important;
      width: 776px !important;
      box-sizing: border-box !important;
      padding: 24px 28px !important;
      background: #ffffff !important;
      color: #0f172a !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 12px !important;
      line-height: 1.5 !important;
      visibility: visible !important;
      opacity: 1 !important;
      z-index: -1 !important;
    `;
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
    // Let layout settle before snapshot (longer wait for paint completion)
    await new Promise(r => setTimeout(r, 200));

    const safeName = (m.name || 'market').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const filename = `FMC_Market_${safeName}_${new Date().toISOString().slice(0,10)}.pdf`;

    // wrapper total width including padding = 776px
    const opt = {
      margin: [0.4, 0.4, 0.5, 0.4],
      filename,
      image: { type: 'jpeg', quality: 0.95 },
      // NOTE: do NOT pass scrollX/scrollY/x/y — those override the element's
      // bounding rect, which is at left:-10000px. Result was a 3KB blank PDF
      // because html2canvas was capturing the empty area at (0,0). Let it
      // read the wrapper's rect itself.
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 776,
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait', compress: true },
      pagebreak: { mode: ['css', 'legacy'] },
    };

    try {
      await window.html2pdf().set(opt).from(wrapper).save();
      _toast('PDF saved');
    } catch (e) {
      console.error('[mr] PDF export failed:', e);
      _toast('PDF export failed: ' + (e.message || e), true);
    } finally {
      wrapper.remove();
    }
  }

  async function _deepResearch(id) {
    // Key chain: build-time substituted (deployed) → config.js (local dev)
    const BUILD_INJECTED_KEY = '__CLAUDE_API_KEY__';
    const apiKey = (BUILD_INJECTED_KEY.indexOf('__CLAUDE') === -1)
      ? BUILD_INJECTED_KEY
      : window.CLAUDE_API_KEY;
    if (!apiKey) { _toast('Claude API key not configured', true); return; }
    const m = _markets.find(x => x.id === id) || _shortlistFull.find(x => x.id === id);
    if (!m) {
      // Fetch the row
      try {
        const rows = await window.supaFetch('market_research_markets', `?select=*&id=eq.${id}&limit=1`);
        if (rows && rows[0]) _currentMarket = rows[0];
      } catch (e) {}
    }
    const market = m || _currentMarket;
    if (!market) { _toast('Market not found', true); return; }

    // Filter to Phase 3 sub-criteria only — the categories Phase 2 can't reach.
    const phase3Cats = new Set(['governance', 'economic_activity', 'quality_of_life', 'transit']);
    const phase3Crits = (_criteria || []).filter(c => phase3Cats.has(c.category) && c.is_active !== false);

    const town = `${market.name}`;
    const pop = market.population ? market.population.toLocaleString() : '?';
    const hhi = market.median_household_income ? `$${market.median_household_income.toLocaleString()}` : '?';
    const home = market.median_home_value ? `$${market.median_home_value.toLocaleString()}` : '?';
    const metro = market.nearest_top50_city || '?';

    // Build modal w/ loading state
    _openModal(`🔬 Deep Research — ${town}`, `
      <p style="font-size:12px;color:#64748b;margin:0 0 8px 0;">
        Researching <strong>${_esc(town)}</strong> against ${phase3Crits.length} Phase 3 sub-criteria across Governance, Economic Activity, Quality of Life, and Transit.
      </p>
      <div id="mrDeepStatus" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:13px;color:#475569;line-height:1.6;">
        <span class="mr-chat-loading">Calling Claude (sonnet-4-6)… expect ~15-30s</span>
      </div>
      <div id="mrDeepResults" style="display:none;margin-top:14px;"></div>
      <div class="mr-modal-actions">
        <button class="mr-btn" onclick="mrCloseModal()">Close</button>
      </div>
    `);

    const status = document.getElementById('mrDeepStatus');

    // System prompt — give Claude the criteria + sources + town context.
    const sourceList = _RESEARCH_SOURCES.map(s => `- ${s.label}: ${s.url}`).join('\n');
    const critList = phase3Crits.map(c => {
      const t = c.target_label || (c.target_min != null || c.target_max != null
        ? `${c.target_min ?? ''}${c.target_max != null ? '–' + c.target_max : ''} ${c.target_unit || ''}`
        : '');
      return `- "${c.name}" (${c.category}) — target: ${t || 'qualitative'}. ${c.description || ''}`;
    }).join('\n');

    const systemPrompt = `You are a real estate market research analyst for First Mile Capital. Your job is to score a specific US town against 4 categories of evaluation criteria that require web/qualitative research (the kind Census data alone can't answer): Governance & Barriers to Entry, Economic Activity, Quality of Life, and Transit & Access.

For each sub-criterion below, return:
- A 1–10 score (1 = far below target, 10 = meets or exceeds target).
- A brief value (≤ 60 chars) summarizing the data point (e.g. "Top 5% nationally", "AA+ rating", "Walking distance to Metro-North").
- A sources array — 1 to 3 authoritative citations. Prefer URLs from the Research Websites list. Multiple sources are encouraged when more than one body of data supports the score (e.g. FBI UCR + Niche.com for crime).

If you genuinely don't have a reliable answer, set score=null and value="insufficient data". Don't invent numbers.

Sub-criteria to score:
${critList}

Authoritative research sources to cite (use these where possible):
${sourceList}

Return STRICT JSON in this exact shape, with no commentary outside the JSON:
{
  "scores": [
    {"criterion_name": "<exact name from list>", "score": <0-10 or null>, "value": "<short value>", "sources": ["<URL or label>", "<optional 2nd>", "<optional 3rd>"]}
  ],
  "thesis": "<2-3 paragraph investment thesis — why this town fits or doesn't fit FM's affluent-town acquisition strategy>",
  "summary": "<one sentence executive summary, max 200 chars>"
}`;

    const userPrompt = `Town: ${town}
Population: ${pop}
Median Household Income: ${hhi}
Median Home Value: ${home}
Nearest Top-50 Metro: ${metro}

Research this town now and produce the scoring JSON.`;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 400)}`);
      const data = await r.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

      // Extract JSON from the response — Claude may wrap it in markdown
      let jsonStr = text.trim();
      const m1 = jsonStr.match(/```json\s*([\s\S]*?)\s*```/i);
      if (m1) jsonStr = m1[1];
      else {
        const m2 = jsonStr.match(/\{[\s\S]*\}/);
        if (m2) jsonStr = m2[0];
      }
      const parsed = JSON.parse(jsonStr);

      // Match criterion names → ids, write scores
      const byName = new Map(phase3Crits.map(c => [c.name.toLowerCase().trim(), c]));
      const scoreRows = [];
      let scoredCount = 0, skippedCount = 0;
      for (const s of (parsed.scores || [])) {
        const crit = byName.get((s.criterion_name || '').toLowerCase().trim());
        if (!crit) continue;
        if (s.score == null || s.score === '') { skippedCount++; continue; }
        const sc = Math.max(0, Math.min(10, parseFloat(s.score)));
        if (!Number.isFinite(sc)) { skippedCount++; continue; }
        // Accept either sources[] (new) or source (legacy single string)
        let srcs = Array.isArray(s.sources) ? s.sources.filter(Boolean) : (s.source ? [s.source] : []);
        scoreRows.push({
          market_id: market.id,
          criterion_id: crit.id,
          value_numeric: Math.round(sc * 10) / 10,
          value_text: s.value || null,
          source: srcs[0] || null,    // back-compat
          sources: srcs,
          updated_by: 'phase3_claude',
        });
        scoredCount++;
      }

      // Wipe prior phase3 scores for this market + insert
      const SU = window.SUPABASE_URL;
      const SK = window.SUPABASE_KEY;
      const H = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
      await fetch(`${SU}/rest/v1/market_research_scores?market_id=eq.${market.id}&updated_by=eq.phase3_claude`, { method: 'DELETE', headers: H });
      if (scoreRows.length > 0) {
        const r2 = await fetch(`${SU}/rest/v1/market_research_scores`, { method: 'POST', headers: H, body: JSON.stringify(scoreRows) });
        if (!r2.ok) throw new Error(`Score insert ${r2.status}: ${(await r2.text()).slice(0, 200)}`);
      }
      // Update market thesis + summary
      if (parsed.thesis || parsed.summary) {
        await window.supaWrite('market_research_markets', 'PATCH', {
          thesis: parsed.thesis || null,
          summary: parsed.summary || null,
        }, `?id=eq.${market.id}`);
        if (market.id === (_currentMarket && _currentMarket.id)) {
          _currentMarket.thesis = parsed.thesis;
          _currentMarket.summary = parsed.summary;
        }
      }

      // Render summary in modal
      const resEl = document.getElementById('mrDeepResults');
      status.innerHTML = `<strong style="color:#166534;">✓ Research complete.</strong> Scored <strong>${scoredCount}</strong> sub-criteria${skippedCount ? `, skipped ${skippedCount} (insufficient data)` : ''}.`;
      resEl.style.display = 'block';
      resEl.innerHTML = `
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.4px;">Summary</div>
          <div style="font-size:13px;color:#0f172a;margin-top:4px;">${_esc(parsed.summary || '')}</div>
        </div>
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.4px;">Thesis</div>
          <div style="font-size:13px;color:#1e293b;line-height:1.55;margin-top:4px;white-space:pre-wrap;">${_esc(parsed.thesis || '')}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.4px;">Scored criteria</div>
          <div style="font-size:12px;color:#475569;line-height:1.7;margin-top:4px;">
            ${(parsed.scores || []).map(s => {
              const sc = s.score == null ? '—' : (Math.round(s.score * 10) / 10);
              const src = s.source ? `<span style="color:#94a3b8;">[${_esc(s.source.length > 70 ? s.source.slice(0,70)+'…' : s.source)}]</span>` : '';
              return `<div><strong>${_esc(s.criterion_name)}</strong>: ${sc}/10 — ${_esc(s.value || '')} ${src}</div>`;
            }).join('')}
          </div>
        </div>`;

      // Recompute composite Score / Tier using ALL stored scores (P2 + P3)
      try { await _recomputeMarketComposite(market.id); } catch (e) { /* swallow */ }

      // Refresh data so scorecard re-renders with new scores
      await _loadData();
      if (_currentMarket) {
        _currentMarket = _markets.find(x => x.id === market.id) || (await (async () => {
          const rows = await window.supaFetch('market_research_markets', `?select=*&id=eq.${market.id}&limit=1`);
          return rows && rows[0];
        })());
        _renderDetail();
      } else {
        _renderGrid();
      }
    } catch (e) {
      status.innerHTML = `<strong style="color:#b91c1c;">✗ Research failed.</strong><br>${_esc(String(e).slice(0, 400))}`;
    }
  }

  // ── Favorite toggle ─────────────────────────────────────
  async function _toggleFavorite(id) {
    const m = _markets.find(x => x.id === id);
    if (!m) return;
    const newVal = !m.is_favorite;
    // Optimistic update
    m.is_favorite = newVal;
    _renderGrid();
    try {
      await window.supaWrite('market_research_markets', 'PATCH', { is_favorite: newVal }, `?id=eq.${id}`);
    } catch (e) {
      // Revert on failure
      m.is_favorite = !newVal;
      _renderGrid();
      _toast('Save failed: ' + e.message, true);
    }
  }

  // ── Modal helpers ────────────────────────────────────────
  function _openModal(title, bodyHTML, opts) {
    const overlay = document.getElementById('mrModalOverlay');
    const content = document.getElementById('mrModalContent');
    content.innerHTML = `<h3>${_esc(title)}</h3>${bodyHTML}`;
    // Toggle wide variant per call
    content.classList.toggle('mr-modal-wide', !!(opts && opts.wide));
    overlay.classList.add('show');
  }
  function _closeModal() {
    const overlay = document.getElementById('mrModalOverlay');
    if (overlay) overlay.classList.remove('show');
    const content = document.getElementById('mrModalContent');
    if (content) content.classList.remove('mr-modal-wide');
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
  // Weights live on the 6 categories; criteria are read-only definitions
  // surfaced beneath each category panel.
  // Track which view's inputs are shown in the modal. Defaults to the
  // page-level asset class so users land in the view they were just browsing.
  let _criteriaModalView = null;
  // Stable color palette for the 7 categories (used by the weight bar).
  // Keyed by category name so adding/removing/reordering categories doesn't shift.
  const _CAT_COLORS = {
    'Demographics':              '#888780',
    'Company Concentrations':    '#7F77DD',
    'Governance & Barriers to Entry': '#D4537E',
    'Transit & Access':          '#1D9E75',
    'Economic Activity':         '#D85A30',
    'Education':                 '#BA7517',
    'Quality of Life':           '#378ADD',
  };
  const _CAT_FALLBACK_COLORS = ['#94a3b8', '#a78bfa', '#f472b6', '#5eead4', '#fb923c', '#fbbf24', '#60a5fa'];
  function _catColor(name, idx) {
    return _CAT_COLORS[name] || _CAT_FALLBACK_COLORS[idx % _CAT_FALLBACK_COLORS.length];
  }

  function _manageCriteria() {
    if (_criteriaModalView == null) _criteriaModalView = _viewType;
    const tab = _criteriaModalView; // 'residential' | 'office'
    const wCol = tab === 'office' ? 'weight_office' : 'weight';
    const minCol = tab === 'office' ? 'target_min_office' : 'target_min';
    const maxCol = tab === 'office' ? 'target_max_office' : 'target_max';

    const cats = _categories.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const totalWeight = cats.reduce((s, c) => s + (parseFloat(c[wCol]) || 0), 0);
    const tabIcon = tab === 'office' ? '🏢' : '🏠';
    const tabLabel = tab === 'office' ? 'Office' : 'Residential';
    const otherLabel = tab === 'office' ? 'Residential' : 'Office';
    const accent = tab === 'office' ? '#7c3aed' : '#0ea5e9';

    // Build the stacked weight bar (segments + legend)
    const barSegs = cats.map((cat, i) => {
      const w = parseFloat(cat[wCol]) || 0;
      const pct = totalWeight > 0 ? (w / totalWeight) * 100 : 0;
      const color = _catColor(cat.name, i);
      const label = pct >= 7 ? Math.round(pct) + '%' : '';
      return `<div class="mr-wbar-seg" style="background:${color};width:${pct}%;" onclick="mrScrollToCat('${cat.id}')" title="${_esc(cat.name)} · weight ${w.toFixed(1)} · ${pct.toFixed(0)}%">${label}</div>`;
    }).join('');
    const legend = cats.map((cat, i) => {
      const w = parseFloat(cat[wCol]) || 0;
      const color = _catColor(cat.name, i);
      return `<span class="mr-wbar-legend-item" onclick="mrScrollToCat('${cat.id}')"><span class="mr-wbar-swatch" style="background:${color};"></span>${_esc(cat.name)} <span class="mr-wbar-legend-val">· ${w.toFixed(1)}</span></span>`;
    }).join('');
    const weightBar = `
      <div class="mr-wbar-label">Weight distribution · click any segment to jump to that category</div>
      <div class="mr-wbar">${barSegs}</div>
      <div class="mr-wbar-legend">${legend}</div>`;

    const cards = cats.map((cat, i) => {
      const subs = _criteria.filter(c => c.category_id === cat.id)
        .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
      const w = cat[wCol] != null ? cat[wCol] : (cat.weight != null ? cat.weight : 1);
      const wOther = tab === 'office' ? cat.weight : cat.weight_office;
      const pct = totalWeight > 0 ? ((parseFloat(w) || 0) / totalWeight * 100).toFixed(0) : '—';
      const wDiff = wOther != null && String(wOther) !== String(w);
      const color = _catColor(cat.name, i);
      return `
        <div class="mr-cat-card" id="mr-cat-${cat.id}" style="border-top:3px solid ${color};">
          <div class="mr-cat-card-head">
            <div>
              <div class="mr-cat-card-title">${_esc(cat.name)}</div>
            </div>
            <div class="mr-cat-weight-wrap">
              <input type="number" min="0" step="0.1" value="${w}"
                     oninput="mrSaveCategoryWeight('${cat.id}', this.value, '${tab}')">
              <div class="mr-cat-weight-pct">${pct === '—' ? '' : pct + '%'}</div>
            </div>
          </div>
          ${wDiff ? `<div class="mr-other-hint">${otherLabel}: ${wOther}</div>` : ''}
          <div class="mr-cat-card-body">
            ${subs.length === 0
              ? '<div style="font-size:11px;color:#94a3b8;padding:6px 0;">No sub-criteria.</div>'
              : subs.map(c => {
                  const labelCol = tab === 'office' ? 'target_label_office' : 'target_label';
                  const tMin = c[minCol] != null ? c[minCol] : (c.target_min != null ? c.target_min : '');
                  const tMax = c[maxCol] != null ? c[maxCol] : (c.target_max != null ? c.target_max : '');
                  const tLabel = c[labelCol] != null ? c[labelCol] : (c.target_label || '');
                  const oMin = tab === 'office' ? c.target_min : c.target_min_office;
                  const oMax = tab === 'office' ? c.target_max : c.target_max_office;
                  const oLabel = tab === 'office' ? c.target_label : c.target_label_office;
                  const sameMin = oMin == null || String(oMin) === String(tMin);
                  const sameMax = oMax == null || String(oMax) === String(tMax);
                  const sameLabel = oLabel == null || String(oLabel) === String(tLabel);
                  const unit = c.target_unit || '';
                  // Decide which inputs to render. A criterion is:
                  //   qualitative: no numeric min/max anywhere → single Target text input
                  //   range:       both min & max meaningful (e.g., Town Population)
                  //   min-only:    "≥ X is better" (e.g., Median HHI ≥ $200k)
                  //   max-only:    "≤ X is better" (e.g., Commute ≤ 45 min)
                  // Use the criterion's RESIDENTIAL definition as the source of truth
                  // for which inputs are relevant; both views keep the same shape.
                  const hasMinR = c.target_min != null;
                  const hasMaxR = c.target_max != null;
                  const isQualitative = !hasMinR && !hasMaxR;
                  const showMin = hasMinR || (hasMaxR === false && hasMinR === false); // also show in true-blank case below
                  const showMax = hasMaxR;
                  const minInput = `
                    <label>Min</label>
                    <input type="number" step="any" value="${tMin}" placeholder="—"
                           onchange="mrSaveCriterionTarget('${c.id}', 'target_min', this.value, '${tab}')">
                    ${!sameMin ? `<span class="mr-other-hint-inline" title="${otherLabel}: ${oMin}">${otherLabel.charAt(0)}: ${oMin}</span>` : ''}`;
                  const maxInput = `
                    <label>Max</label>
                    <input type="number" step="any" value="${tMax}" placeholder="—"
                           onchange="mrSaveCriterionTarget('${c.id}', 'target_max', this.value, '${tab}')">
                    ${!sameMax ? `<span class="mr-other-hint-inline" title="${otherLabel}: ${oMax}">${otherLabel.charAt(0)}: ${oMax}</span>` : ''}`;
                  const inputsRow = isQualitative
                    ? `<div class="mr-crit-inputs">
                         <label>Target</label>
                         <input type="text" value="${_esc(tLabel)}" placeholder="e.g. Top 20% nationally"
                                style="flex:1;min-width:160px;width:auto;"
                                onchange="mrSaveCriterionLabel('${c.id}', this.value, '${tab}')">
                         ${!sameLabel ? `<span class="mr-other-hint-inline" title="${otherLabel}: ${_esc(oLabel || '—')}">${otherLabel.charAt(0)}: ${_esc(oLabel || '—')}</span>` : ''}
                       </div>`
                    : `<div class="mr-crit-inputs">
                         ${hasMinR ? minInput : ''}
                         ${hasMaxR ? maxInput : ''}
                       </div>`;
                  const displayName = (tab === 'office' && c.name_office) ? c.name_office : c.name;
                  const activeCol = tab === 'office' ? 'is_active_office' : 'is_active_residential';
                  const isActive = c[activeCol] !== false; // default true if null
                  const dimClass = isActive ? '' : ' mr-crit-row-disabled';
                  return `
                    <div class="mr-crit-row${dimClass}">
                      <div class="mr-crit-name">
                        <label class="mr-crit-toggle" title="Include in ${tabLabel} score">
                          <input type="checkbox" ${isActive ? 'checked' : ''}
                                 onchange="mrSaveCriterionActive('${c.id}', this.checked, '${tab}')">
                          <span>${_esc(displayName)}</span>
                        </label>
                        ${unit ? `<span class="mr-crit-unit">${_esc(unit)}</span>` : ''}
                      </div>
                      ${c.description ? `<div class="mr-crit-desc">${_esc(c.description)}</div>` : ''}
                      ${inputsRow}
                    </div>`;
                }).join('')}
          </div>
        </div>`;
    }).join('');

    const copyButton = ''; // Removed: bulk overwrite was too easy to fire accidentally

    _openModal(`Manage Categories &amp; Criteria — ${tabIcon} ${tabLabel}`, `
      <div class="mr-tab-row">
        <button class="mr-tab ${tab === 'office' ? 'active' : ''}" onclick="mrSetCriteriaModalView('office')">🏢 Office</button>
        <button class="mr-tab ${tab === 'residential' ? 'active' : ''}" onclick="mrSetCriteriaModalView('residential')">🏠 Residential</button>
        <div style="flex:1;"></div>
        <span class="mr-tab-total">Total weight: <strong style="color:${accent};">${totalWeight.toFixed(1)}</strong></span>
        <button class="mr-btn mr-btn-primary" onclick="mrFinishCriteriaEdit()" style="padding:6px 18px;">Done</button>
      </div>
      ${weightBar}
      <p class="mr-modal-hint">
        Editing <strong>${tabIcon} ${tabLabel}</strong> values. Switch to <strong>${otherLabel}</strong> at any time — your changes save instantly.
        Where ${otherLabel} differs, you'll see a small hint chip next to the input.
      </p>
      <div class="mr-cat-grid">${cards}</div>
      <div class="mr-modal-actions">
        <button class="mr-btn mr-btn-primary" onclick="mrFinishCriteriaEdit()">Done</button>
      </div>
    `, { wide: true });
  }
  // Called when user clicks Done in the Manage Criteria modal. If they edited
  // anything, fire the dual-composite recompute behind a full-screen loader.
  async function _finishCriteriaEdit() {
    if (!_criteriaDirty) { _closeModal(); return; }
    _criteriaDirty = false;
    _closeModal();
    _showFullScreenLoader('Recalculating all market scores based on adjusted criteria and weights…');
    // Flush pending debounced PATCHes so the recompute SQL sees latest values
    await _flushAllPendingPatches();
    try {
      // STEP 1: Re-score per-criterion 0-10 values based on current targets.
      // Only touches Phase 2 rows that have a raw_value parsed. Phase 3 (Claude)
      // scores stay as-is. Town Population uses tent function (same score in
      // both views). Commute uses ≤target_max scoring. All other target_min-
      // only criteria use linear `min(10, raw/target*10)` per view.
      // Re-score per-criterion 0-10 values. raw_value > 0 skips sentinel rows
      // (Tenant Sector Diversity, etc., where value_text is qualitative and
      // raw_value was set to -1 during backfill).
      const perCritSql = `
        UPDATE market_research_scores s
        SET
          value_numeric = CASE
            WHEN c.name = 'Town Population' AND s.raw_value > 0 THEN
              CASE
                WHEN s.raw_value < 5000 OR s.raw_value > 75000 THEN 0
                WHEN s.raw_value <= 25000 THEN ROUND(LEAST(10, (s.raw_value - 5000)/2000.0)::numeric, 1)
                WHEN s.raw_value <= 50000 THEN 10
                ELSE ROUND(GREATEST(0, (75000 - s.raw_value)/2500.0)::numeric, 1)
              END
            WHEN c.name = 'Commute to Major Metro' AND s.raw_value > 0 THEN
              CASE
                WHEN s.raw_value <= 45 THEN 10
                WHEN s.raw_value >= 120 THEN 0
                ELSE ROUND((10 - (s.raw_value - 45)/7.5)::numeric, 1)
              END
            WHEN c.target_min IS NOT NULL AND c.target_max IS NULL AND s.raw_value > 0 AND c.target_min > 0 THEN
              LEAST(10, ROUND((s.raw_value / c.target_min * 10)::numeric, 1))
            ELSE s.value_numeric
          END,
          value_numeric_office = CASE
            WHEN c.name = 'Town Population' AND s.raw_value > 0 THEN
              CASE
                WHEN s.raw_value < 5000 OR s.raw_value > 75000 THEN 0
                WHEN s.raw_value <= 25000 THEN ROUND(LEAST(10, (s.raw_value - 5000)/2000.0)::numeric, 1)
                WHEN s.raw_value <= 50000 THEN 10
                ELSE ROUND(GREATEST(0, (75000 - s.raw_value)/2500.0)::numeric, 1)
              END
            WHEN c.name = 'Commute to Major Metro' AND s.raw_value > 0 THEN
              CASE
                WHEN s.raw_value <= 45 THEN 10
                WHEN s.raw_value >= 120 THEN 0
                ELSE ROUND((10 - (s.raw_value - 45)/7.5)::numeric, 1)
              END
            WHEN c.target_min_office IS NOT NULL AND c.target_max_office IS NULL AND s.raw_value > 0 AND c.target_min_office > 0 THEN
              LEAST(10, ROUND((s.raw_value / c.target_min_office * 10)::numeric, 1))
            ELSE s.value_numeric_office
          END
        FROM market_research_criteria c
        WHERE s.criterion_id = c.id
          AND s.updated_by IN ('phase2_auto', 'phase2_commute')`;
      const r0 = await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: { apikey: window.SUPABASE_KEY, Authorization: 'Bearer ' + window.SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: perCritSql }),
      });
      if (!r0.ok) throw new Error('per-criterion re-score failed: ' + r0.status);
      const sql = `WITH cat_means AS (
        SELECT s.market_id, c.category_id, AVG(s.value_numeric) AS mean_res, AVG(s.value_numeric_office) AS mean_off
        FROM market_research_scores s JOIN market_research_criteria c ON c.id = s.criterion_id
        WHERE c.category_id IS NOT NULL GROUP BY s.market_id, c.category_id
      ),
      composites AS (
        SELECT cm.market_id,
          SUM(cm.mean_res * cat.weight) / NULLIF(SUM(CASE WHEN cm.mean_res IS NOT NULL THEN cat.weight ELSE 0 END), 0) AS comp_res,
          SUM(cm.mean_off * cat.weight_office) / NULLIF(SUM(CASE WHEN cm.mean_off IS NOT NULL THEN cat.weight_office ELSE 0 END), 0) AS comp_off
        FROM cat_means cm JOIN market_research_categories cat ON cat.id = cm.category_id
        GROUP BY cm.market_id
      )
      UPDATE market_research_markets m SET
        score = ROUND(c.comp_res::numeric, 1),
        tier  = CASE WHEN c.comp_res >= 8.5 THEN 1 WHEN c.comp_res >= 7.0 THEN 2 WHEN c.comp_res >= 4.0 THEN 3 WHEN c.comp_res IS NOT NULL THEN 4 ELSE m.tier END,
        office_score = ROUND(c.comp_off::numeric, 1),
        office_tier  = CASE WHEN c.comp_off >= 8.5 THEN 1 WHEN c.comp_off >= 7.0 THEN 2 WHEN c.comp_off >= 4.0 THEN 3 WHEN c.comp_off IS NOT NULL THEN 4 ELSE m.office_tier END,
        updated_at = now()
      FROM composites c WHERE m.id = c.market_id`;
      const runSql = async (q) => {
        const resp = await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: { apikey: window.SUPABASE_KEY, Authorization: 'Bearer ' + window.SUPABASE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
        });
        if (!resp.ok) throw new Error('status ' + resp.status);
      };
      await runSql(sql);
      // Recompute persistent rank columns AFTER composites settle (separate
      // requests — multi-statement in one exec_sql call can silently truncate).
      await runSql(`WITH rr AS (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC NULLS LAST, median_household_income DESC NULLS LAST, name ASC) AS r FROM market_research_markets WHERE score IS NOT NULL) UPDATE market_research_markets m SET rank_residential = rr.r FROM rr WHERE m.id = rr.id`);
      await runSql(`WITH ro AS (SELECT id, ROW_NUMBER() OVER (ORDER BY office_score DESC NULLS LAST, median_household_income DESC NULLS LAST, name ASC) AS r FROM market_research_markets WHERE office_score IS NOT NULL) UPDATE market_research_markets m SET rank_office = ro.r FROM ro WHERE m.id = ro.id`);
      try { await _loadData(); _renderGrid(); } catch {}
      if (_currentMarket) {
        try { await _loadScoresForMarket(_currentMarket.id); _renderDetail(); } catch {}
      }
      _toast('✓ All markets re-scored');
    } catch (e) {
      _toast('Recompute failed: ' + e.message, true);
    } finally {
      _hideFullScreenLoader();
    }
  }
  function _showFullScreenLoader(msg) {
    let el = document.getElementById('mrFullLoader');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mrFullLoader';
      el.innerHTML = `
        <div class="mr-loader-backdrop"></div>
        <div class="mr-loader-card">
          <div class="mr-loader-spinner"></div>
          <div class="mr-loader-msg" id="mrLoaderMsg"></div>
          <div class="mr-loader-hint">This usually takes 5-15 seconds</div>
        </div>`;
      document.body.appendChild(el);
    }
    document.getElementById('mrLoaderMsg').textContent = msg;
    el.style.display = 'flex';
  }
  function _hideFullScreenLoader() {
    const el = document.getElementById('mrFullLoader');
    if (el) el.style.display = 'none';
  }
  // Switch the modal tab without closing — just re-render
  function _setCriteriaModalView(v) {
    if (!['residential', 'office'].includes(v)) return;
    _criteriaModalView = v;
    _manageCriteria();
  }
  // Bulk copy: residential → office for all categories + criteria
  async function _copyResidentialToOffice() {
    if (!confirm('Copy all Residential weights + target values into Office? This overwrites any Office-specific values.')) return;
    try {
      _toast('Copying Residential → Office…');
      const sql = `
        UPDATE market_research_categories SET weight_office = weight;
        UPDATE market_research_criteria SET target_min_office = target_min, target_max_office = target_max;
      `;
      // Run as two separate statements (the wrapper appends ") t" so multi-statement
      // doesn't run cleanly via the SELECT path — use the EXECUTE fallback)
      const r = await fetch(`${window.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: { apikey: window.SUPABASE_KEY, Authorization: 'Bearer ' + window.SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
      if (!r.ok) throw new Error('status ' + r.status);
      // Refresh local cache
      _categories.forEach(c => { c.weight_office = c.weight; });
      _criteria.forEach(c => { c.target_min_office = c.target_min; c.target_max_office = c.target_max; });
      _toast('✓ Copied Residential → Office');
      _manageCriteria();
      _scheduleRecomputeAll();
    } catch (e) { _toast('Copy failed: ' + e.message, true); }
  }
  // Debounce the modal re-render so arrow-click sequences on number inputs
  // don't keep destroying input focus mid-edit.
  let _modalRerenderTimer = null;
  function _scheduleModalRerender(delay = 600) {
    clearTimeout(_modalRerenderTimer);
    _modalRerenderTimer = setTimeout(() => { _manageCriteria(); }, delay);
  }
  // Tracks whether the user edited anything during this modal session.
  // Recompute is deferred until they click Done (or close the modal) so
  // we don't re-score the whole universe on every keystroke.
  let _criteriaDirty = false;

  // Per-cell save debouncer. Cache updates happen SYNCHRONOUSLY in the handler
  // so the modal's debounced re-render always reads the latest user value.
  // The actual PATCH is debounced 400ms per (entity, column) so rapid arrow
  // ratcheting only fires one network request per cell — no out-of-order races.
  // Tracks pending debounced saves. Each entry: { timer, fire }.
  const _saveTimers = new Map();
  function _debouncePatch(key, fn, delay = 400) {
    const prev = _saveTimers.get(key);
    if (prev) clearTimeout(prev.timer);
    const wrapped = async () => {
      _saveTimers.delete(key);
      await fn();
    };
    _saveTimers.set(key, { timer: setTimeout(wrapped, delay), fire: wrapped });
  }
  async function _flushAllPendingPatches() {
    const entries = [...(_saveTimers.values())];
    _saveTimers.clear();
    for (const e of entries) clearTimeout(e.timer);
    // Fire them all in parallel and wait
    await Promise.all(entries.map(e => e.fire().catch(() => {})));
  }

  // Update the small % chip + total weight + stacked-bar segment in place,
  // WITHOUT re-rendering the whole modal (which would nuke the input the user
  // is mid-clicking on).
  function _refreshWeightChipsInPlace() {
    const cats = _categories.slice();
    const tab = _criteriaModalView || 'residential';
    const wCol = tab === 'office' ? 'weight_office' : 'weight';
    const total = cats.reduce((s, c) => s + (parseFloat(c[wCol]) || 0), 0);
    // Update total chip
    const totalEl = document.querySelector('.mr-tab-total strong');
    if (totalEl) totalEl.textContent = total.toFixed(1);
    // Update each card's % chip
    document.querySelectorAll('.mr-cat-card').forEach((card) => {
      const id = (card.id || '').replace('mr-cat-', '');
      const cat = cats.find(c => c.id === id);
      if (!cat) return;
      const w = parseFloat(cat[wCol]) || 0;
      const pctEl = card.querySelector('.mr-cat-weight-pct');
      if (pctEl) pctEl.textContent = total > 0 ? Math.round(w / total * 100) + '%' : '';
    });
    // Update stacked-bar segments by width
    const bar = document.querySelector('.mr-wbar');
    if (bar) {
      const segs = bar.querySelectorAll('.mr-wbar-seg');
      // Segments are in the same order as cats (sorted by sort_order)
      const ordered = cats.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      segs.forEach((seg, i) => {
        const cat = ordered[i];
        if (!cat) return;
        const w = parseFloat(cat[wCol]) || 0;
        const pct = total > 0 ? (w / total) * 100 : 0;
        seg.style.width = pct + '%';
        seg.textContent = pct >= 7 ? Math.round(pct) + '%' : '';
      });
    }
  }

  function _saveCategoryWeight(id, rawValue, view = 'residential') {
    const weight = Math.max(0, parseFloat(rawValue) || 0);
    const col = view === 'office' ? 'weight_office' : 'weight';
    const cat = _categories.find(c => c.id === id);
    if (cat) cat[col] = weight;
    _criteriaDirty = true;
    _refreshWeightChipsInPlace(); // surgical update — no innerHTML reset
    _debouncePatch('cat:' + id + ':' + col, async () => {
      try {
        await window.supaWrite('market_research_categories', 'PATCH', { [col]: weight }, `?id=eq.${id}`);
      } catch (e) { _toast('Save failed: ' + e.message, true); }
    });
  }
  function _saveCriterionTarget(id, kind, rawValue, view = 'residential') {
    const v = rawValue === '' ? null : parseFloat(rawValue);
    const col = view === 'office' ? `${kind}_office` : kind;
    const c = _criteria.find(x => x.id === id);
    if (c) c[col] = v;
    _criteriaDirty = true;
    _debouncePatch('crit:' + id + ':' + col, async () => {
      try {
        await window.supaWrite('market_research_criteria', 'PATCH', { [col]: v }, `?id=eq.${id}`);
      } catch (e) { _toast('Save failed: ' + e.message, true); }
    });
  }
  function _saveCriterionActive(id, isActive, view = 'residential') {
    const col = view === 'office' ? 'is_active_office' : 'is_active_residential';
    const c = _criteria.find(x => x.id === id);
    if (c) c[col] = !!isActive;
    _criteriaDirty = true;
    _refreshWeightChipsInPlace();
    // Re-render needed to update the disabled visual state, but debounced
    // to avoid focus loss while user is clicking
    clearTimeout(_modalRerenderTimer);
    _modalRerenderTimer = setTimeout(() => _manageCriteria(), 400);
    _debouncePatch('crit:' + id + ':' + col, async () => {
      try {
        await window.supaWrite('market_research_criteria', 'PATCH', { [col]: isActive }, `?id=eq.${id}`);
      } catch (e) { _toast('Save failed: ' + e.message, true); }
    });
  }
  function _saveCriterionLabel(id, rawValue, view = 'residential') {
    const v = (rawValue || '').trim() || null;
    const col = view === 'office' ? 'target_label_office' : 'target_label';
    const c = _criteria.find(x => x.id === id);
    if (c) c[col] = v;
    _criteriaDirty = true;
    _debouncePatch('crit:' + id + ':' + col, async () => {
      try {
        await window.supaWrite('market_research_criteria', 'PATCH', { [col]: v }, `?id=eq.${id}`);
      } catch (e) { _toast('Save failed: ' + e.message, true); }
    });
  }
  // Legacy criterion-level weight setter kept for back-compat — no-op for now.
  async function _saveCriterionWeight(id, rawValue) {
    return _saveCategoryWeight(id, rawValue);
  }
  async function _addCriterion() {
    const name = document.getElementById('mrNewCriterionName').value.trim();
    if (!name) { _toast('Name is required', true); return; }
    const description = (document.getElementById('mrNewCriterionDesc').value || '').trim() || null;
    const value_type = document.getElementById('mrNewCriterionType').value;
    const weight = parseFloat(document.getElementById('mrNewCriterionWeight').value) || 1;
    const source_note = (document.getElementById('mrNewCriterionSource').value || '').trim() || null;
    const sort_order = (_criteria.length + 1) * 10;
    try {
      await window.supaWrite('market_research_criteria', 'POST', { name, description, value_type, weight, source_note, sort_order });
      await _loadData();
      _manageCriteria(); // refresh the modal
      if (_currentMarket) _renderScorecard();
      else _renderGrid();
      _toast('Criterion added');
      _scheduleRecomputeAll();
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
      _scheduleRecomputeAll();
    } catch(e) { _toast('Error: ' + e.message, true); }
  }

  // Refresh local UI after weight tweaks — doesn't recompute server-side rankings,
  // that's the job of "Update Rankings" button.
  async function _recomputeAndRender() {
    await _loadData();
    if (_currentMarket) {
      _currentMarket = _markets.find(m => m.id === _currentMarket.id) || _currentMarket;
      _renderDetail();
    } else {
      _renderGrid();
    }
  }

  // ── Weighted re-ranking ─────────────────────────────────
  // For each criterion, normalize values across markets to a 0-10 scale:
  //   • rating_1_10 / rating_1_5 → linear rescale to 0-10
  //   • percent / number / currency → min-max rescaled to 0-10 across the populated markets
  //   • text / boolean → ignored (no numeric value to weight)
  // Then composite = SUM(weight × normalized) / SUM(weight). Markets with no
  // scores at all keep their existing score+tier (manual entries preserved).
  // Tier buckets: ≥8.0=1, ≥6.5=2, ≥5.0=3, <5.0=4.
  function _computeWeightedRankings() {
    const numericCriteria = _criteria.filter(c =>
      ['rating_1_10', 'rating_1_5', 'percent', 'number', 'currency'].includes(c.value_type)
      && (parseFloat(c.weight) || 0) > 0
    );
    if (numericCriteria.length === 0) {
      return { updates: [], note: 'No weighted numeric criteria configured.' };
    }

    // Build value matrix: market_id → {criterion_id → numeric value}
    const valByMkt = {};
    _markets.forEach(m => { valByMkt[m.id] = {}; });
    _scores.forEach(s => {
      if (s.value_numeric != null && valByMkt[s.market_id]) {
        valByMkt[s.market_id][s.criterion_id] = parseFloat(s.value_numeric);
      }
    });

    // Min/max per criterion for normalization
    const ranges = {}; // criterion_id → {min, max}
    numericCriteria.forEach(c => {
      const vals = _markets.map(m => valByMkt[m.id][c.id]).filter(v => v != null && !isNaN(v));
      if (vals.length === 0) return;
      ranges[c.id] = { min: Math.min(...vals), max: Math.max(...vals) };
    });

    const normalize = (val, c) => {
      if (val == null || isNaN(val)) return null;
      if (c.value_type === 'rating_1_10') return Math.max(0, Math.min(10, val));
      if (c.value_type === 'rating_1_5')  return Math.max(0, Math.min(10, val * 2));
      const r = ranges[c.id];
      if (!r || r.max === r.min) return 5; // single value or constant → neutral
      return ((val - r.min) / (r.max - r.min)) * 10; // 0-10
    };

    const totalWeight = numericCriteria.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0);
    const updates = [];

    _markets.forEach(m => {
      let sumWeighted = 0;
      let sumWeightUsed = 0;
      let used = 0;
      numericCriteria.forEach(c => {
        const raw = valByMkt[m.id][c.id];
        const norm = normalize(raw, c);
        if (norm == null) return;
        const w = parseFloat(c.weight) || 0;
        sumWeighted += norm * w;
        sumWeightUsed += w;
        used++;
      });
      if (used === 0 || sumWeightUsed === 0) return; // skip — preserve manual entry
      let composite = sumWeighted / sumWeightUsed;        // 0-10
      composite = Math.max(1, Math.min(10, composite));   // clamp to seeding bounds
      composite = Math.round(composite * 10) / 10;        // 1 decimal place
      // Tier bands (unified across recompute paths) — T1 tight at ≥8.5
      const tier = composite >= 8.5 ? 1 : (composite >= 6.5 ? 2 : (composite >= 4.5 ? 3 : 4));
      // Only push update if value changed (avoid noisy writes)
      if (m.score !== composite || m.tier !== tier) {
        updates.push({ id: m.id, name: m.name, score: composite, tier, prevScore: m.score, prevTier: m.tier });
      }
    });

    return { updates, totalWeight, criteriaUsed: numericCriteria.length };
  }

  async function _applyComputedRankings(updates) {
    if (!updates || updates.length === 0) return;
    // Bulk PATCH each market — Supabase REST doesn't support batch PATCH by id
    // so we issue parallel requests (small set, fast enough)
    await Promise.all(updates.map(u =>
      window.supaWrite('market_research_markets', 'PATCH', { score: u.score, tier: u.tier }, `?id=eq.${u.id}`)
    ));
  }

  // ── Update Rankings button — pulls Dropbox + recomputes ─
  async function _updateRankings() {
    const btn = document.getElementById('mrRerankBtn');
    const label = document.getElementById('mrRerankBtnLabel');
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Working…';

    let dropboxStatus = 'skipped';
    try {
      // 1. Dropbox sync — server-side edge function pulls latest files into market_research_sources
      try {
        if (label) label.textContent = 'Pulling Dropbox…';
        const url = `${window.SUPABASE_URL}/functions/v1/dropbox-sync-market-research`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${window.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const j = await res.json();
          dropboxStatus = `${j.synced || 0} new file(s)`;
        } else {
          const t = await res.text();
          dropboxStatus = `skipped (${res.status})`;
          console.warn('Dropbox sync skipped:', t);
        }
      } catch(e) {
        dropboxStatus = 'skipped (network)';
        console.warn('Dropbox sync error:', e);
      }

      // 2. Reload data (criteria weights, scores, any new markets from sync)
      if (label) label.textContent = 'Recomputing…';
      await _loadData();

      // 3. Compute weighted composite scores + tiers
      const result = _computeWeightedRankings();
      if (result.updates.length === 0) {
        _toast(`No ranking changes · Dropbox: ${dropboxStatus}`);
      } else {
        await _applyComputedRankings(result.updates);
        await _loadData();
        _toast(`Updated ${result.updates.length} market(s) · Dropbox: ${dropboxStatus}`);
      }

      // 4. Re-render whatever view is active
      if (_currentMarket) {
        _currentMarket = _markets.find(m => m.id === _currentMarket.id) || _currentMarket;
        _renderDetail();
      } else {
        _renderGrid();
      }
    } catch(e) {
      _toast('Error: ' + e.message, true);
      console.error(e);
    } finally {
      if (btn) btn.disabled = false;
      if (label) label.textContent = 'Update Rankings';
    }
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
  window.mrSaveCriterionTarget = _saveCriterionTarget;
  window.mrSaveCriterionLabel = _saveCriterionLabel;
  window.mrSaveCriterionActive = _saveCriterionActive;
  window.mrSetCriteriaModalView = _setCriteriaModalView;
  window.mrSetScorecardView = (v) => {
    if (!['residential', 'office'].includes(v)) return;
    if (_scorecardView === v) return;
    _scorecardView = v;
    _renderScorecard();
  };
  window.mrCopyResidentialToOffice = _copyResidentialToOffice;
  window.mrFinishCriteriaEdit = _finishCriteriaEdit;
  window.mrViewOnMap = (lat, lng, name) => {
    if (!_mapInstance) return;
    _mapBoundsSettling = true;
    _mapInstance.setView([lat, lng], 11, { animate: true });
    setTimeout(() => { _mapBoundsSettling = false; }, 700);
    // Brief popup at the location
    if (window.L) {
      const popup = window.L.popup({ closeButton: true, autoClose: true, closeOnClick: true })
        .setLatLng([lat, lng])
        .setContent(`<strong>${name}</strong><br><span style="font-size:11px;color:#64748b;">Centered on map</span>`)
        .openOn(_mapInstance);
      setTimeout(() => { try { _mapInstance.closePopup(popup); } catch(_) {} }, 3500);
    }
  };
  window.mrScrollToCat = (catId) => {
    const el = document.getElementById('mr-cat-' + catId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Brief flash to confirm landing
    el.style.transition = 'box-shadow 0.2s';
    el.style.boxShadow = '0 0 0 3px rgba(14,165,233,0.35)';
    setTimeout(() => { el.style.boxShadow = ''; }, 900);
  };
  window.mrAddCriterion   = ()    => _addCriterion();
  window.mrDeleteCriterion= (id, name) => _deleteCriterion(id, name);
  window.mrChangeSort     = ()    => _changeSort();
  window.mrSetViewMode    = (m)   => _setViewMode(m);
  window.mrSaveCriterionWeight = (id, v) => _saveCriterionWeight(id, v);
  window.mrSaveCategoryWeight  = (id, v) => _saveCategoryWeight(id, v);
  window.mrRecomputeAndRender  = ()  => _recomputeAndRender();
  window.mrUpdateRankings = ()    => _updateRankings();
  window.mrCloseModal     = ()    => _closeModal();
  window.mrChatSubmit     = ()    => _chatSubmit();
  window.mrChatSuggest    = (t)   => _chatSuggest(t);
  // ── Address search (Nominatim, free OSM geocoder, CORS-enabled) ──
  function _looksLikeAddress(q) {
    if (!q) return false;
    // A number in the query → almost certainly an address (street # or zip).
    // Pure town/state queries don't have digits.
    return /\d/.test(q);
  }
  async function _geocodeAddress(q) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&addressdetails=0&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) return null;
      const j = await r.json();
      if (!Array.isArray(j) || j.length === 0) return null;
      const hit = j[0];
      const lat = parseFloat(hit.lat), lng = parseFloat(hit.lon);
      if (!isFinite(lat) || !isFinite(lng)) return null;
      return { lat, lng, label: hit.display_name || q };
    } catch (e) {
      console.warn('[mr] geocode failed:', e);
      return null;
    }
  }
  function _applyAddressBounds(pin) {
    // Bounding box around the pin matching the dashed radius circle.
    const latDelta = _ADDRESS_RADIUS_MILES / 69;
    const lngDelta = _ADDRESS_RADIUS_MILES / (69 * Math.max(0.1, Math.cos(pin.lat * Math.PI / 180)));
    _mapBounds = {
      north: (pin.lat + latDelta).toFixed(4),
      south: (pin.lat - latDelta).toFixed(4),
      east:  (pin.lng + lngDelta).toFixed(4),
      west:  (pin.lng - lngDelta).toFixed(4),
    };
  }
  function _updateAddressHint(text) {
    const wrap = document.getElementById('mrAddressHint');
    const t = document.getElementById('mrAddressHintText');
    if (!wrap || !t) return;
    if (text) { t.textContent = text; wrap.style.display = 'block'; }
    else { wrap.style.display = 'none'; }
  }
  function _syncShowTier4Checkbox() {
    const cb = document.getElementById('mrShowTier4');
    if (cb && cb.checked !== _showTier4) cb.checked = _showTier4;
    const row = document.getElementById('mrLegendT4Row');
    if (row) row.style.display = _showTier4 ? 'flex' : 'none';
  }
  async function _doAddressSearch(q) {
    _updateAddressHint('Looking up address…');
    const pin = await _geocodeAddress(q);
    if (!pin) {
      _addressPin = null;
      _updateAddressHint('Couldn\'t find that address — try adding city/state, or check spelling.');
      _toast('Address not found', true);
      return;
    }
    _addressPin = pin;
    _applyAddressBounds(pin);
    // Auto-show T4 so all nearby markets surface around the pin
    if (!_showTier4) {
      _showTier4 = true;
      try { localStorage.setItem('mr_show_tier4', '1'); } catch(_) {}
    }
    _updateAddressHint(`Showing markets within ${_ADDRESS_RADIUS_MILES} mi of ${pin.label}`);
    _page = 0;
    _refreshPage();
    _syncShowTier4Checkbox();
  }
  // Debounce search so typing doesn't fire a query per keystroke
  let _searchTimer = null;
  window.mrSearch = (q) => {
    const next = q || '';
    const prev = _searchQuery;
    _searchQuery = next;
    const inp = document.getElementById('mrSearchInput');
    if (inp && inp.value !== _searchQuery) inp.value = _searchQuery;
    clearTimeout(_searchTimer);
    // Empty input → clear any active address pin + bounds and refresh
    if (!_searchQuery.trim()) {
      _addressPin = null;
      _mapBounds = null;
      _updateAddressHint('');
      _page = 0;
      _refreshPage();
      return;
    }
    // Address-looking input → wait for Enter (Nominatim politeness + clearer UX).
    // Don't fire address geocode on every keystroke.
    if (_looksLikeAddress(_searchQuery)) {
      _updateAddressHint('Press Enter to search this address');
      // If we had a name-based filter active from a prior search, clear text-only filter
      // but keep the active address pin until Enter or explicit clear.
      return;
    }
    // Name search path — clear any previous address pin/bounds first
    if (_addressPin) { _addressPin = null; _mapBounds = null; _updateAddressHint(''); }
    _searchTimer = setTimeout(() => { _page = 0; _refreshPage(); }, 220);
  };
  window.mrSearchEnter = (q) => {
    const v = (q || '').trim();
    if (!v) return;
    if (_looksLikeAddress(v)) {
      _searchQuery = v;
      _doAddressSearch(v);
    } else {
      _searchQuery = v;
      _addressPin = null; _mapBounds = null; _updateAddressHint('');
      _page = 0; _refreshPage();
    }
  };
  window.mrClearAddressSearch = () => {
    _addressPin = null;
    _mapBounds = null;
    _searchQuery = '';
    const inp = document.getElementById('mrSearchInput');
    if (inp) inp.value = '';
    _updateAddressHint('');
    _page = 0;
    _refreshPage();
  };
  window.mrToggleShowTier4 = (on) => {
    _showTier4 = !!on;
    try { localStorage.setItem('mr_show_tier4', _showTier4 ? '1' : '0'); } catch(_) {}
    // Re-render to add/remove T4 markers on the map
    _renderGrid();
  };
  window.mrToggleFavorite = (id)  => _toggleFavorite(id);
  window.mrPageGoto = (p) => { _page = Math.max(0, p); _refreshPage(); };
  window.mrDeepResearch = (id) => _deepResearch(id);
  window.mrDeepResearchCurrent = () => { if (_currentMarket) _deepResearch(_currentMarket.id); };
  window.mrExportPDF = () => _exportMarketPDF();
  window.mrBulkPhase3 = () => _bulkPhase3();
  window.mrBulkPhase3Cancel = () => _bulkPhase3Cancel();
  window.mrEditSource = (criterionId) => {
    const existing = _scores.find(s => s.criterion_id === criterionId);
    const newVal = prompt('Source citation (URL or label):', existing ? (existing.source || '') : '');
    if (newVal == null) return;
    _saveSource(criterionId, newVal).then(() => _renderScorecard());
  };
  window.mrSetViewType = (vt) => {
    if (!['residential', 'office'].includes(vt)) return;
    if (_viewType === vt) return;
    _viewType = vt;
    try { localStorage.setItem('mr_view_type', vt); } catch(_) {}
    _page = 0;
    _refreshPage();
  };
  window.mrClearMapBounds = () => {
    _mapBounds = null;
    _page = 0;
    // Reset map to CONUS view
    if (_mapInstance) {
      _mapBoundsSettling = true;
      _mapInstance.setView([39.5, -98.35], 4);
      setTimeout(() => { _mapBoundsSettling = false; }, 600);
    }
    _refreshListOnly();
  };
  window.mrToggleTier = (tier, on) => {
    if (on) _activeTiers.add(tier); else _activeTiers.delete(tier);
    // Sync visual state of the pill
    const lbl = document.querySelector(`.mr-tier-pill[data-tier="${tier}"]`);
    if (lbl) lbl.classList.toggle('active', on);
    _page = 0; _refreshPage();
  };
  // ── State + Metro geographic filters ──
  window.mrSetGeoFilter = (kind, value) => {
    if (kind === 'state') _activeState = value || '';
    else if (kind === 'metro') _activeMetro = value || '';
    _syncGeoUI();
    _page = 0; _refreshPage();
  };
  window.mrClearGeoFilters = () => {
    _activeState = ''; _activeMetro = '';
    const s = document.getElementById('mrStateFilter');
    const m = document.getElementById('mrMetroFilter');
    if (s) s.value = '';
    if (m) m.value = '';
    _syncGeoUI();
    _page = 0; _refreshPage();
  };

  // Toggle the active styling on the dropdowns + show/hide Clear button.
  function _syncGeoUI() {
    const s = document.getElementById('mrStateFilter');
    const m = document.getElementById('mrMetroFilter');
    const c = document.getElementById('mrGeoClear');
    if (s) s.classList.toggle('is-active', Boolean(_activeState));
    if (m) m.classList.toggle('is-active', Boolean(_activeMetro));
    if (c) c.style.display = (_activeState || _activeMetro) ? '' : 'none';
  }

  // Populate the State + Metro <select> dropdowns from distinct DB values.
  // Cheap: 805 shortlist + 25k universe → we only pull distinct (state) and
  // distinct (nearest_top50_city) once per session.
  async function _loadGeoFilterOptions() {
    if (_stateOptions.length && _metroOptions.length) {
      _renderGeoOptions(); return;
    }
    try {
      // Pull a wide slice of just (state, nearest_top50_city) — small payload.
      const r = await fetch(
        `${window.SUPABASE_URL}/rest/v1/market_research_markets?` +
        `select=state,nearest_top50_city&limit=30000`,
        {
          headers: {
            apikey: window.SUPABASE_KEY,
            Authorization: 'Bearer ' + window.SUPABASE_KEY,
          },
        }
      );
      if (!r.ok) throw new Error(`Supabase ${r.status}`);
      const rows = await r.json();
      const stateSet = new Set();
      const metroSet = new Set();
      for (const row of rows) {
        if (row.state) stateSet.add(row.state);
        if (row.nearest_top50_city) metroSet.add(row.nearest_top50_city);
      }
      _stateOptions = Array.from(stateSet).sort();
      _metroOptions = Array.from(metroSet).sort();
    } catch (e) {
      console.warn('[geo-filters] could not load options:', e);
      _stateOptions = [];
      _metroOptions = [];
    }
    _renderGeoOptions();
  }

  function _renderGeoOptions() {
    const s = document.getElementById('mrStateFilter');
    const m = document.getElementById('mrMetroFilter');
    if (s) {
      const cur = s.value;
      s.innerHTML = '<option value="">All states</option>'
        + _stateOptions.map(st => `<option value="${st}">${st}</option>`).join('');
      s.value = cur;
    }
    if (m) {
      const cur = m.value;
      m.innerHTML = '<option value="">All nearby metros</option>'
        + _metroOptions.map(mt => `<option value="${mt}">${mt}</option>`).join('');
      m.value = cur;
    }
    _syncGeoUI();
  }

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
