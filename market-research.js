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
  let _filterCounts = { phase_shortlisted: 0, all: 0, favorites: 0 };
  let _totalForCurrentFilter = 0;
  let _page = 0;
  const PAGE_SIZE = 1000;  // Supabase anon REST caps here
  let _activeTiers = new Set(); // empty = all tiers
  let _categories = []; // 6 high-level groups carrying weights
  let _criteria = [];   // sub-criteria, linked via category_id
  let _scores = []; // shortlist scores only
  let _currentMarket = null; // detail view
  let _currentUser = null;
  let _activeFilter = 'phase_shortlisted'; // default to Phase 1 shortlist
  let _searchQuery = '';
  let _viewMode = (typeof localStorage !== 'undefined' && localStorage.getItem('mr_view_mode')) || 'list'; // 'grid' | 'list'

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
      /* Wide variant for the categories editor — multi-column grid */
      #mrRoot .mr-modal.mr-modal-wide { max-width: 1200px; }
      #mrRoot .mr-cat-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
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

      <!-- Phase coverage banner -->
      <div class="mr-phase-banner">
        <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;">
          <div style="flex:1;min-width:240px;">
            <div style="font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;">Pipeline coverage</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
              <span class="mr-phase-chip phase1">📊 Phase 1 · Census shortlist</span>
              <span class="mr-phase-chip phase2">⚙️ Phase 2 · Demographics + Education + Company Concentrations (3 of 7 categories)</span>
              <span class="mr-phase-chip phase3">🔬 Phase 3 · Governance / Economic Activity / Quality of Life / Transit · per-town on demand</span>
            </div>
          </div>
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

        <!-- Search bar -->
        <div class="mr-search-wrap">
          <svg class="mr-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="mr-search-input" id="mrSearchInput" type="text"
                 placeholder="Search by town name or state…"
                 oninput="mrSearch(this.value)">
          <span class="mr-search-clear" id="mrSearchClear" onclick="mrSearch('')" title="Clear">×</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
          <div class="mr-filters" id="mrFilters">
            <button class="mr-filter-btn active" data-filter="phase_shortlisted">🎯 Shortlist <span class="mr-filter-count" id="mrCountShortlist"></span></button>
            <button class="mr-filter-btn" data-filter="all">All <span class="mr-filter-count" id="mrCountAll"></span></button>
            <button class="mr-filter-btn" data-filter="favorites">❤ Favorites <span class="mr-filter-count" id="mrCountFavorites"></span></button>
            <div class="mr-tier-filter">
              <span class="mr-tier-label">Tier:</span>
              <label class="mr-tier-pill" data-tier="1"><input type="checkbox" onchange="mrToggleTier(1, this.checked)"> Tier 1</label>
              <label class="mr-tier-pill" data-tier="2"><input type="checkbox" onchange="mrToggleTier(2, this.checked)"> Tier 2</label>
              <label class="mr-tier-pill" data-tier="3"><input type="checkbox" onchange="mrToggleTier(3, this.checked)"> Tier 3</label>
              <label class="mr-tier-pill" data-tier="4"><input type="checkbox" onchange="mrToggleTier(4, this.checked)"> Tier 4</label>
            </div>
          </div>
          <div class="mr-shortlist-criteria" id="mrShortlistCriteria">
            Shortlist criteria: Town population <strong>5,000–75,000</strong> · Median Household Income <strong id="mrHHIThresholdLabel">≥ $120,000</strong>
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
              <button data-mode="grid" onclick="mrSetViewMode('grid')" title="Grid view">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                Grid
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

    // Filter button wiring — change filter, reset to page 0, re-fetch
    root.querySelectorAll('.mr-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.mr-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _activeFilter = btn.dataset.filter;
        _page = 0;
        _refreshPage();
      });
    });
  }

  // ── Data loading (server-paginated) ─────────────────────
  // Builds the PostgREST query suffix for the current filter + search.
  function _buildFilterQuery() {
    const parts = [];
    if (_activeFilter === 'phase_shortlisted')   parts.push('phase=eq.shortlisted');
    else if (_activeFilter === 'favorites')      parts.push('is_favorite=eq.true');
    // 'all' = no filter
    if (_activeTiers && _activeTiers.size > 0) {
      const tiers = Array.from(_activeTiers).sort().join(',');
      parts.push(`tier=in.(${tiers})`);
    }
    const q = (_searchQuery || '').trim();
    if (q) {
      const safe = q.replace(/[%*]/g, '');
      const enc = encodeURIComponent('*' + safe + '*');
      parts.push(`or=(name.ilike.${enc},state.ilike.${enc})`);
    }
    return parts;
  }

  // Single source-of-truth fetch for the active filter + search + page.
  // Returns total count via Content-Range header (Prefer: count=exact).
  async function _fetchPage() {
    const parts = _buildFilterQuery();
    parts.push('select=*');
    parts.push('order=median_household_income.desc.nullslast,name.asc');
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
    const [shortlist, all, favs] = await Promise.all([
      _fetchCount(['phase=eq.shortlisted']),
      _fetchCount([]),
      _fetchCount(['is_favorite=eq.true']),
    ]);
    _filterCounts = { phase_shortlisted: shortlist, all, favorites: favs };
    // Refresh just the count badges (cheap)
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = (n || 0).toLocaleString(); };
    set('mrCountShortlist', shortlist);
    set('mrCountAll', all);
    set('mrCountFavorites', favs);
  }

  // Load shortlist once for chatbot context. Kept separate from grid pagination.
  async function _loadShortlistForChatbot() {
    try {
      _shortlistFull = await window.supaFetch(
        'market_research_markets',
        '?select=id,name,state,population,median_household_income,median_home_value,nearest_top50_city,is_favorite,thesis&phase=eq.shortlisted&order=median_household_income.desc.nullslast,name.asc&limit=1000'
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
    setCount('mrCountShortlist', _filterCounts.phase_shortlisted);
    setCount('mrCountAll',       _filterCounts.all);
    setCount('mrCountFavorites', _filterCounts.favorites);

    // _markets IS the current page. No client-side filter/search; that's server-side.
    const visible = _markets.slice();

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

    // Sync view-toggle button active state
    document.querySelectorAll('#mrViewToggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === _viewMode);
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
    const header = `
      <div class="mr-page-header">
        <div class="mr-page-count">Showing <strong>${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()}</strong> of <strong>${total.toLocaleString()}</strong></div>
      </div>`;
    const body = _viewMode === 'list' ? _renderListView(visible) : _renderGridView(visible);
    const pager = total > PAGE_SIZE ? _renderPager(pageCount) : '';
    gridEl.innerHTML = header + body + pager;
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
              <th style="width:42px;text-align:center;">#</th>
              <th style="width:30px;"></th>
              <th style="width:16%;">Market</th>
              <th style="width:9%;text-align:right;">Population</th>
              <th style="width:10%;text-align:right;">Median HHI</th>
              <th style="width:11%;">Nearby Metro</th>
              <th style="width:7%;text-align:center;">Score</th>
              <th style="width:6%;text-align:center;">Tier</th>
              <th>Thesis</th>
            </tr>
          </thead>
          <tbody>
            ${visible.map((m, idx) => {
              const scoreNum = m.score != null ? m.score.toFixed(1) : '—';
              const tierLabel = m.tier != null ? `T${m.tier}` : '—';
              const pop = m.population ? parseInt(m.population).toLocaleString() : '—';
              const hhi = m.median_household_income ? '$' + parseInt(m.median_household_income).toLocaleString() : '—';
              const metro = m.nearest_top50_city || '—';
              const rank = startIdx + idx + 1;
              return `
                <tr onclick="mrOpenMarket('${m.id}')">
                  <td style="text-align:center;font-variant-numeric:tabular-nums;font-weight:600;color:#64748b;font-size:12px;">${rank}</td>
                  <td style="text-align:center;">
                    <button class="mr-heart ${m.is_favorite ? 'active' : ''}" title="Favorite"
                            onclick="event.stopPropagation(); mrToggleFavorite('${m.id}')">${m.is_favorite ? '❤' : '♡'}</button>
                  </td>
                  <td>
                    <div class="mr-table-name">${_esc(m.name)}</div>
                  </td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums;color:#475569;">${pop}</td>
                  <td style="text-align:right;font-variant-numeric:tabular-nums;color:#0f172a;font-weight:600;">${hhi}</td>
                  <td style="font-size:12px;color:#475569;">${_esc(metro)}</td>
                  <td style="text-align:center;">
                    <span class="mr-table-score ${_scoreClass(m.score)}">${scoreNum}</span>
                  </td>
                  <td style="text-align:center;">
                    <span class="mr-tier ${_tierClass(m.tier)}">${tierLabel}</span>
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
    _viewMode = mode === 'list' ? 'list' : 'grid';
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
        const scoreNum = (s.value_numeric != null && s.value_numeric !== '') ? Number(s.value_numeric).toFixed(1) : null;
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
        _toast('Recomputing scores…');
        const r = await fetch(`${window.SUPABASE_URL}/functions/v1/market-research-phase3`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + window.SUPABASE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recompute_only: true, limit: 1000 }),
        });
        const data = await r.json();
        if (!r.ok || !data.ok) throw new Error(data.error || ('status ' + r.status));
        _toast(`✓ Recomputed ${data.recomputed} markets`);
        // Refresh data so the list view picks up new scores
        try { await _loadData(); _renderGrid(); } catch {}
        if (_currentMarket) {
          try { await _loadScoresForMarket(_currentMarket.id); _renderDetail(); } catch {}
        }
      } catch (e) {
        _toast('Recompute failed: ' + e.message, true);
      }
    }, 1500); // debounce: coalesce rapid edits
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
    // Derive tier from the rounded display score so 8.0 always = Tier 1
    const tier = score >= 8 ? 1 : score >= 6 ? 2 : score >= 4 ? 3 : 4;
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
  function _manageCriteria() {
    const cats = _categories.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const totalWeight = cats.reduce((s, c) => s + (parseFloat(c.weight) || 0), 0);

    const cards = cats.map(cat => {
      const subs = _criteria.filter(c => c.category_id === cat.id)
        .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
      const pct = totalWeight > 0 ? ((parseFloat(cat.weight) || 0) / totalWeight * 100).toFixed(0) : '—';
      return `
        <div class="mr-cat-card">
          <div class="mr-cat-card-head">
            <div>
              <div class="mr-cat-card-title">${_esc(cat.name)}</div>
            </div>
            <div class="mr-cat-weight-wrap">
              <input type="number" min="0" step="0.1" value="${cat.weight != null ? cat.weight : 1}"
                     onchange="mrSaveCategoryWeight('${cat.id}', this.value)">
              <div class="mr-cat-weight-pct">${pct === '—' ? '' : pct + '%'}</div>
            </div>
          </div>
          <div class="mr-cat-card-body">
            ${subs.length === 0
              ? '<div style="font-size:11px;color:#94a3b8;padding:6px 0;">No sub-criteria.</div>'
              : subs.map(c => {
                  const target = _fmtTarget(c);
                  return `
                    <div class="mr-cat-sub-row">
                      <div class="mr-cat-sub-bullet"></div>
                      <div style="flex:1;min-width:0;">
                        <div class="mr-cat-sub-name">
                          ${_esc(c.name)}
                          ${target ? `<span class="mr-target-chip">🎯 ${_esc(target)}</span>` : ''}
                        </div>
                        ${c.description ? `<div class="mr-cat-sub-desc">${_esc(c.description)}</div>` : ''}
                      </div>
                    </div>`;
                }).join('')}
          </div>
        </div>`;
    }).join('');

    _openModal('Manage Categories & Weights', `
      <p style="font-size:12px;color:#64748b;margin:0 0 14px 0;">
        Weights live on the 6 high-level categories. Higher weight = more influence on the composite score.
        Weights are relative and normalized when ranking is computed. Total: <strong style="color:#0ea5e9;">${totalWeight.toFixed(1)}</strong>
      </p>
      <div class="mr-cat-grid">${cards}</div>
      <div class="mr-modal-actions">
        <button class="mr-btn mr-btn-primary" onclick="mrCloseModal(); mrRecomputeAndRender()">Done</button>
      </div>
    `, { wide: true });
  }
  async function _saveCategoryWeight(id, rawValue) {
    const weight = Math.max(0, parseFloat(rawValue) || 0);
    try {
      await window.supaWrite('market_research_categories', 'PATCH', { weight }, `?id=eq.${id}`);
      const cat = _categories.find(c => c.id === id);
      if (cat) cat.weight = weight;
      _toast(`${cat ? cat.name : 'Category'} weight → ${weight}`);
      _manageCriteria(); // refresh % chips
      if (_currentMarket) _renderScorecard();
      _scheduleRecomputeAll();
    } catch(e) { _toast('Save failed: ' + e.message, true); }
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
      const tier = composite >= 8.0 ? 1 : (composite >= 6.5 ? 2 : (composite >= 5.0 ? 3 : 4));
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
  // Debounce search so typing doesn't fire a query per keystroke
  let _searchTimer = null;
  window.mrSearch = (q) => {
    _searchQuery = q || '';
    const inp = document.getElementById('mrSearchInput');
    if (inp && inp.value !== _searchQuery) inp.value = _searchQuery;
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => { _page = 0; _refreshPage(); }, 220);
  };
  window.mrToggleFavorite = (id)  => _toggleFavorite(id);
  window.mrPageGoto = (p) => { _page = Math.max(0, p); _refreshPage(); };
  window.mrDeepResearch = (id) => _deepResearch(id);
  window.mrDeepResearchCurrent = () => { if (_currentMarket) _deepResearch(_currentMarket.id); };
  window.mrBulkPhase3 = () => _bulkPhase3();
  window.mrBulkPhase3Cancel = () => _bulkPhase3Cancel();
  window.mrEditSource = (criterionId) => {
    const existing = _scores.find(s => s.criterion_id === criterionId);
    const newVal = prompt('Source citation (URL or label):', existing ? (existing.source || '') : '');
    if (newVal == null) return;
    _saveSource(criterionId, newVal).then(() => _renderScorecard());
  };
  window.mrToggleTier = (tier, on) => {
    if (on) _activeTiers.add(tier); else _activeTiers.delete(tier);
    // Sync visual state of the pill
    const lbl = document.querySelector(`.mr-tier-pill[data-tier="${tier}"]`);
    if (lbl) lbl.classList.toggle('active', on);
    _page = 0; _refreshPage();
  };

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
