/* ============================================================
   Active Initiatives Module — initiatives.js
   External IIFE module (same pattern as exec-v2.js)
   Loaded via <script src="initiatives.js"> in index.html
   Called via window.initiativesInit() from switchView()
   ============================================================ */
(function () {
  'use strict';

  let _inited = false;
  let _initiatives = [];
  let _entries = [];
  let _members = [];
  let _currentInitiative = null; // detail view
  let _currentUser = null;

  // ── CSS ──────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('init-css')) return;
    const style = document.createElement('style');
    style.id = 'init-css';
    style.textContent = `
      /* ── Card Grid ─────────────────────────── */
      #initRoot .init-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
        gap: 20px;
        margin-top: 20px;
      }
      #initRoot .init-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 24px;
        cursor: pointer;
        transition: box-shadow .2s, border-color .2s;
        position: relative;
      }
      #initRoot .init-card:hover {
        box-shadow: 0 4px 16px rgba(0,0,0,.08);
        border-color: #0ea5e9;
      }
      #initRoot .init-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
      }
      #initRoot .init-card-title {
        font-size: 17px;
        font-weight: 600;
        color: #1e293b;
        margin: 0;
        border-bottom: none;
        padding: 0;
      }
      #initRoot .init-status {
        font-size: 11px;
        font-weight: 600;
        padding: 3px 10px;
        border-radius: 20px;
        text-transform: uppercase;
        letter-spacing: .5px;
        white-space: nowrap;
      }
      #initRoot .init-status.active   { background: #dcfce7; color: #166534; }
      #initRoot .init-status.on_hold  { background: #fef3c7; color: #92400e; }
      #initRoot .init-status.completed{ background: #dbeafe; color: #1e40af; }
      #initRoot .init-status.archived { background: #f1f5f9; color: #64748b; }

      #initRoot .init-card-summary {
        font-size: 13px;
        color: #64748b;
        line-height: 1.5;
        margin-bottom: 16px;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      #initRoot .init-card-meta {
        display: flex;
        gap: 16px;
        font-size: 12px;
        color: #94a3b8;
      }
      #initRoot .init-card-meta span { display: flex; align-items: center; gap: 4px; }

      /* ── Header Bar ────────────────────────── */
      #initRoot .init-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      #initRoot .init-header h2 {
        font-size: 22px;
        font-weight: 600;
        color: #1e293b;
        margin: 0;
      }
      #initRoot .init-filters {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      #initRoot .init-filter-btn {
        padding: 6px 14px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #fff;
        font-size: 13px;
        cursor: pointer;
        color: #64748b;
        transition: all .15s;
      }
      #initRoot .init-filter-btn.active,
      #initRoot .init-filter-btn:hover {
        background: #0ea5e9;
        color: #fff;
        border-color: #0ea5e9;
      }
      #initRoot .init-add-btn {
        padding: 8px 18px;
        background: #0ea5e9;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background .15s;
      }
      #initRoot .init-add-btn:hover { background: #0284c7; }

      /* ── Detail View ───────────────────────── */
      #initRoot .init-detail { display: none; }
      #initRoot .init-detail.show { display: block; }
      #initRoot .init-list.hidden { display: none; }

      #initRoot .init-back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: #64748b;
        cursor: pointer;
        margin-bottom: 16px;
        padding: 4px 0;
        border: none;
        background: none;
        transition: color .15s;
      }
      #initRoot .init-back:hover { color: #0ea5e9; }

      #initRoot .init-detail-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 24px;
      }
      #initRoot .init-detail-title {
        font-size: 24px;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 6px 0;
        border-bottom: none;
        padding: 0;
      }
      #initRoot .init-detail-summary {
        font-size: 14px;
        color: #64748b;
        line-height: 1.6;
        max-width: 700px;
      }
      #initRoot .init-detail-actions {
        display: flex;
        gap: 8px;
      }
      #initRoot .init-detail-actions button {
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all .15s;
      }
      #initRoot .init-btn-outline {
        background: #fff;
        border: 1px solid #e2e8f0;
        color: #475569;
      }
      #initRoot .init-btn-outline:hover { border-color: #0ea5e9; color: #0ea5e9; }
      #initRoot .init-btn-primary {
        background: #0ea5e9;
        border: 1px solid #0ea5e9;
        color: #fff;
      }
      #initRoot .init-btn-primary:hover { background: #0284c7; }

      /* ── Tabs ───────────────────────────────── */
      #initRoot .init-tabs {
        display: flex;
        gap: 0;
        border-bottom: 2px solid #e2e8f0;
        margin-bottom: 24px;
      }
      #initRoot .init-tab {
        padding: 10px 20px;
        font-size: 13px;
        font-weight: 600;
        color: #94a3b8;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -2px;
        transition: all .15s;
        background: none;
        border-top: none;
        border-left: none;
        border-right: none;
      }
      #initRoot .init-tab.active {
        color: #0ea5e9;
        border-bottom-color: #0ea5e9;
      }
      #initRoot .init-tab:hover:not(.active) { color: #475569; }

      #initRoot .init-tab-panel { display: none; }
      #initRoot .init-tab-panel.show { display: block; }

      /* ── Activity Timeline ─────────────────── */
      #initRoot .init-timeline {
        position: relative;
        padding-left: 32px;
      }
      #initRoot .init-timeline::before {
        content: '';
        position: absolute;
        left: 11px;
        top: 0;
        bottom: 0;
        width: 2px;
        background: #e2e8f0;
      }
      #initRoot .init-entry {
        position: relative;
        margin-bottom: 20px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 16px 20px;
      }
      #initRoot .init-entry::before {
        content: '';
        position: absolute;
        left: -25px;
        top: 20px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 2px solid #fff;
        box-shadow: 0 0 0 2px #e2e8f0;
      }
      #initRoot .init-entry.type-email::before    { background: #3b82f6; box-shadow: 0 0 0 2px #93c5fd; }
      #initRoot .init-entry.type-note::before     { background: #8b5cf6; box-shadow: 0 0 0 2px #c4b5fd; }
      #initRoot .init-entry.type-milestone::before { background: #f59e0b; box-shadow: 0 0 0 2px #fcd34d; }
      #initRoot .init-entry.type-document::before  { background: #10b981; box-shadow: 0 0 0 2px #6ee7b7; }
      #initRoot .init-entry.type-task::before      { background: #ef4444; box-shadow: 0 0 0 2px #fca5a5; }

      #initRoot .init-entry-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      #initRoot .init-entry-type {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .8px;
        padding: 2px 8px;
        border-radius: 4px;
      }
      .type-email .init-entry-type    { background: #dbeafe; color: #1d4ed8; }
      .type-note .init-entry-type     { background: #ede9fe; color: #6d28d9; }
      .type-milestone .init-entry-type{ background: #fef3c7; color: #92400e; }
      .type-document .init-entry-type { background: #d1fae5; color: #065f46; }
      .type-task .init-entry-type     { background: #fee2e2; color: #991b1b; }

      #initRoot .init-entry-date {
        font-size: 12px;
        color: #94a3b8;
      }
      #initRoot .init-entry-title {
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 6px;
      }
      #initRoot .init-entry-content {
        font-size: 13px;
        color: #475569;
        line-height: 1.6;
        white-space: pre-wrap;
      }
      #initRoot .init-entry-meta {
        font-size: 12px;
        color: #94a3b8;
        margin-top: 8px;
      }
      #initRoot .init-entry .pin-badge {
        position: absolute;
        top: -6px;
        right: 12px;
        background: #f59e0b;
        color: #fff;
        font-size: 9px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 700;
      }

      /* ── Milestones ────────────────────────── */
      #initRoot .init-milestones {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #initRoot .init-milestone-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 18px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      #initRoot .init-milestone-check {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        transition: all .15s;
      }
      #initRoot .init-milestone-check.done {
        background: #10b981;
        border-color: #10b981;
        color: #fff;
      }
      #initRoot .init-milestone-info { flex: 1; }
      #initRoot .init-milestone-title {
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }
      #initRoot .init-milestone-title.done { text-decoration: line-through; color: #94a3b8; }
      #initRoot .init-milestone-due {
        font-size: 12px;
        color: #94a3b8;
        margin-top: 2px;
      }

      /* ── Team Panel ────────────────────────── */
      #initRoot .init-team-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #initRoot .init-team-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      #initRoot .init-team-person {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #initRoot .init-team-avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: #0ea5e9;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
        flex-shrink: 0;
      }
      #initRoot .init-team-name {
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }
      #initRoot .init-team-email {
        font-size: 12px;
        color: #94a3b8;
      }
      #initRoot .init-team-role {
        font-size: 11px;
        font-weight: 600;
        padding: 3px 10px;
        border-radius: 20px;
        text-transform: uppercase;
        letter-spacing: .5px;
      }
      #initRoot .init-team-role.owner  { background: #fef3c7; color: #92400e; }
      #initRoot .init-team-role.member { background: #dbeafe; color: #1e40af; }
      #initRoot .init-team-role.viewer { background: #f1f5f9; color: #64748b; }

      /* ── Modal ──────────────────────────────── */
      #initRoot .init-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.4);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #initRoot .init-modal {
        background: #fff;
        border-radius: 14px;
        padding: 28px 32px;
        width: 520px;
        max-width: 90vw;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 20px 40px rgba(0,0,0,.15);
      }
      #initRoot .init-modal h3 {
        font-size: 18px;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 20px 0;
      }
      #initRoot .init-modal label {
        font-size: 13px;
        font-weight: 600;
        color: #475569;
        display: block;
        margin-bottom: 6px;
      }
      #initRoot .init-modal input,
      #initRoot .init-modal textarea,
      #initRoot .init-modal select {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        font-size: 14px;
        margin-bottom: 16px;
        font-family: inherit;
        box-sizing: border-box;
      }
      #initRoot .init-modal textarea { min-height: 100px; resize: vertical; }
      #initRoot .init-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 8px;
      }

      /* ── Empty state ────────────────────────── */
      #initRoot .init-empty {
        text-align: center;
        padding: 60px 20px;
        color: #94a3b8;
      }
      #initRoot .init-empty-icon {
        font-size: 48px;
        margin-bottom: 12px;
      }
      #initRoot .init-empty h3 {
        font-size: 18px;
        color: #475569;
        margin: 0 0 8px 0;
      }
      #initRoot .init-empty p {
        font-size: 14px;
        max-width: 400px;
        margin: 0 auto;
      }

      /* ── Misc ───────────────────────────────── */
      #initRoot .init-count-badge {
        font-size: 12px;
        background: #f1f5f9;
        color: #64748b;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 6px;
      }

      /* ── Overview Dashboard ────────────────── */
      #initRoot .init-overview { display: flex; flex-direction: column; gap: 24px; }

      #initRoot .init-stats-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 14px;
      }
      #initRoot .init-stat-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 18px 20px;
        text-align: center;
      }
      #initRoot .init-stat-value {
        font-size: 28px;
        font-weight: 700;
        color: #1e293b;
        line-height: 1.1;
      }
      #initRoot .init-stat-label {
        font-size: 12px;
        color: #94a3b8;
        margin-top: 4px;
        text-transform: uppercase;
        letter-spacing: .5px;
        font-weight: 600;
      }
      #initRoot .init-stat-card.accent {
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        border-color: transparent;
      }
      #initRoot .init-stat-card.accent .init-stat-value,
      #initRoot .init-stat-card.accent .init-stat-label { color: #fff; }

      /* AI Summary */
      #initRoot .init-ai-summary {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 24px 28px;
        position: relative;
      }
      #initRoot .init-ai-summary::before {
        content: 'AI Summary';
        position: absolute;
        top: -10px;
        left: 20px;
        background: linear-gradient(135deg, #8b5cf6, #6d28d9);
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        padding: 3px 12px;
        border-radius: 6px;
        text-transform: uppercase;
        letter-spacing: .8px;
      }
      #initRoot .init-ai-narrative {
        font-size: 14px;
        line-height: 1.7;
        color: #334155;
        margin-top: 4px;
      }
      #initRoot .init-ai-narrative strong { color: #1e293b; }

      /* Milestone Progress */
      #initRoot .init-progress-section {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 22px 28px;
      }
      #initRoot .init-progress-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
      }
      #initRoot .init-progress-header h4 {
        font-size: 15px;
        font-weight: 700;
        color: #1e293b;
        margin: 0;
      }
      #initRoot .init-progress-pct {
        font-size: 14px;
        font-weight: 700;
        color: #0ea5e9;
      }
      #initRoot .init-progress-bar {
        width: 100%;
        height: 10px;
        background: #f1f5f9;
        border-radius: 5px;
        overflow: hidden;
        margin-bottom: 16px;
      }
      #initRoot .init-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #10b981, #0ea5e9);
        border-radius: 5px;
        transition: width .6s ease;
      }
      #initRoot .init-progress-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #initRoot .init-progress-item {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        color: #475569;
      }
      #initRoot .init-progress-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      #initRoot .init-progress-dot.done { background: #10b981; }
      #initRoot .init-progress-dot.pending { background: #e2e8f0; }
      #initRoot .init-progress-dot.overdue { background: #ef4444; }
      #initRoot .init-progress-item .due {
        margin-left: auto;
        font-size: 11px;
        color: #94a3b8;
      }
      #initRoot .init-progress-item .due.overdue { color: #ef4444; font-weight: 600; }

      /* Visual Timeline */
      #initRoot .init-visual-timeline {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 22px 28px;
      }
      #initRoot .init-visual-timeline h4 {
        font-size: 15px;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 16px 0;
      }
      #initRoot .init-vt-track {
        position: relative;
        height: 60px;
        background: #f8fafc;
        border-radius: 8px;
        overflow: hidden;
        margin-bottom: 12px;
      }
      #initRoot .init-vt-bar {
        position: absolute;
        top: 8px;
        height: 12px;
        border-radius: 6px;
        opacity: .85;
      }
      #initRoot .init-vt-bar.emails { background: #3b82f6; top: 8px; }
      #initRoot .init-vt-bar.notes { background: #8b5cf6; top: 26px; }
      #initRoot .init-vt-bar.milestones { background: #f59e0b; top: 44px; }
      #initRoot .init-vt-marker {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: #ef4444;
        z-index: 2;
      }
      #initRoot .init-vt-marker::after {
        content: 'Today';
        position: absolute;
        top: -18px;
        left: -14px;
        font-size: 9px;
        font-weight: 700;
        color: #ef4444;
        text-transform: uppercase;
      }
      #initRoot .init-vt-legend {
        display: flex;
        gap: 20px;
        font-size: 11px;
        color: #94a3b8;
      }
      #initRoot .init-vt-legend span {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #initRoot .init-vt-legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        display: inline-block;
      }
      #initRoot .init-vt-dates {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #94a3b8;
        margin-bottom: 4px;
      }

      /* Key Decisions / Open Items boxes */
      #initRoot .init-two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      @media (max-width: 900px) { #initRoot .init-two-col { grid-template-columns: 1fr; } }
      #initRoot .init-info-box {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 20px 24px;
      }
      #initRoot .init-info-box h4 {
        font-size: 14px;
        font-weight: 700;
        color: #1e293b;
        margin: 0 0 12px 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #initRoot .init-info-box ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      #initRoot .init-info-box li {
        font-size: 13px;
        color: #475569;
        padding: 6px 0;
        border-bottom: 1px solid #f1f5f9;
        line-height: 1.5;
      }
      #initRoot .init-info-box li:last-child { border-bottom: none; }

      /* ── Deal Table (key metrics visual) ─── */
      #initRoot .init-deal-section {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 22px 28px;
        position: relative;
      }
      #initRoot .init-deal-section::before {
        content: 'Key Analysis';
        position: absolute;
        top: -10px;
        left: 20px;
        background: linear-gradient(135deg, #0ea5e9, #0284c7);
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        padding: 3px 12px;
        border-radius: 6px;
        text-transform: uppercase;
        letter-spacing: .8px;
      }
      #initRoot .init-deal-title {
        font-size: 16px;
        font-weight: 700;
        color: #1e293b;
        margin: 4px 0 14px 0;
      }
      #initRoot .init-deal-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      #initRoot .init-deal-table th {
        text-align: left;
        font-size: 11px;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: .5px;
        padding: 8px 12px;
        border-bottom: 2px solid #e2e8f0;
        background: #f8fafc;
      }
      #initRoot .init-deal-table td {
        padding: 10px 12px;
        border-bottom: 1px solid #f1f5f9;
        color: #334155;
      }
      #initRoot .init-deal-table tr.highlight td {
        background: #f0f9ff;
        font-weight: 600;
        color: #0c4a6e;
      }
      #initRoot .init-deal-table tr:last-child td { border-bottom: none; }

      #initRoot .init-deal-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid #e2e8f0;
      }
      #initRoot .init-deal-stat {
        flex: 1 1 140px;
        background: #f8fafc;
        border-radius: 8px;
        padding: 10px 14px;
        text-align: center;
      }
      #initRoot .init-deal-stat-val {
        font-size: 16px;
        font-weight: 700;
        color: #0ea5e9;
      }
      #initRoot .init-deal-stat-lbl {
        font-size: 10px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: .4px;
        margin-top: 2px;
      }

      /* ── Compact Stats Bar ─────────────────── */
      #initRoot .init-stats-bar {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      #initRoot .init-stat-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 13px;
        color: #475569;
      }
      #initRoot .init-stat-chip strong {
        color: #1e293b;
        font-weight: 700;
      }

      /* ── Docs Tab ──────────────────────────── */
      #initRoot .init-docs-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 14px;
      }
      #initRoot .init-doc-card {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 16px 18px;
        transition: border-color .15s, box-shadow .15s;
      }
      #initRoot .init-doc-card:hover {
        border-color: #0ea5e9;
        box-shadow: 0 2px 8px rgba(0,0,0,.06);
      }
      #initRoot .init-doc-icon {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
      }
      #initRoot .init-doc-icon.xlsx { background: #dcfce7; }
      #initRoot .init-doc-icon.pdf  { background: #fee2e2; }
      #initRoot .init-doc-icon.doc  { background: #dbeafe; }
      #initRoot .init-doc-icon.pptx { background: #fef3c7; }
      #initRoot .init-doc-icon.img  { background: #ede9fe; }
      #initRoot .init-doc-icon.other{ background: #f1f5f9; }
      #initRoot .init-doc-info { flex: 1; min-width: 0; }
      #initRoot .init-doc-name {
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #initRoot .init-doc-desc {
        font-size: 12px;
        color: #64748b;
        margin-top: 3px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      #initRoot .init-doc-meta {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 6px;
        display: flex;
        gap: 10px;
      }
    `;
    document.head.appendChild(style);
  }

  // ── HTML skeleton ────────────────────────────────────────
  function _injectHTML() {
    const root = document.getElementById('initRoot');
    if (!root) return;
    root.innerHTML = `
      <!-- List View -->
      <div class="init-list" id="initListView">
        <div class="init-header">
          <div>
            <h2>Active Initiatives</h2>
            <p style="font-size:13px;color:#94a3b8;margin:4px 0 0 0">Track projects, communications, and milestones</p>
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <div class="init-filters" id="initFilters">
              <button class="init-filter-btn active" data-filter="all">All</button>
              <button class="init-filter-btn" data-filter="active">Active</button>
              <button class="init-filter-btn" data-filter="on_hold">On Hold</button>
              <button class="init-filter-btn" data-filter="completed">Completed</button>
            </div>
            <button class="init-add-btn" onclick="initNewProject()">+ New Initiative</button>
          </div>
        </div>
        <div class="init-grid" id="initGrid"></div>
      </div>

      <!-- Detail View -->
      <div class="init-detail" id="initDetailView">
        <button class="init-back" onclick="initBackToList()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Initiatives
        </button>
        <div class="init-detail-header">
          <div>
            <h2 class="init-detail-title" id="initDetailTitle"></h2>
            <p class="init-detail-summary" id="initDetailSummary"></p>
          </div>
          <div class="init-detail-actions">
            <button class="init-btn-outline" onclick="initEditProject()">Edit</button>
            <button class="init-btn-primary" onclick="initAddEntry()">+ Add Entry</button>
          </div>
        </div>

        <div class="init-tabs" id="initTabs">
          <button class="init-tab active" data-tab="overview">Overview</button>
          <button class="init-tab" data-tab="activity">Activity</button>
          <button class="init-tab" data-tab="milestones">Milestones</button>
          <button class="init-tab" data-tab="docs">Docs</button>
          <button class="init-tab" data-tab="team">Team</button>
        </div>

        <div class="init-tab-panel show" id="initPanelOverview">
          <div class="init-overview" id="initOverview"></div>
        </div>
        <div class="init-tab-panel" id="initPanelActivity">
          <div class="init-timeline" id="initTimeline"></div>
        </div>
        <div class="init-tab-panel" id="initPanelMilestones">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <span style="font-size:14px;font-weight:600;color:#475569;">Milestones</span>
            <button class="init-btn-primary" onclick="initAddMilestone()" style="padding:6px 14px;font-size:12px;">+ Add Milestone</button>
          </div>
          <div class="init-milestones" id="initMilestonesList"></div>
        </div>
        <div class="init-tab-panel" id="initPanelDocs">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <span style="font-size:14px;font-weight:600;color:#475569;">Documents</span>
            <button class="init-btn-primary" onclick="initAddDoc()" style="padding:6px 14px;font-size:12px;">+ Add Document</button>
          </div>
          <div class="init-docs-grid" id="initDocsList"></div>
        </div>
        <div class="init-tab-panel" id="initPanelTeam">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <span style="font-size:14px;font-weight:600;color:#475569;">Team Members</span>
            <button class="init-btn-primary" onclick="initAddMember()" style="padding:6px 14px;font-size:12px;">+ Add Member</button>
          </div>
          <div class="init-team-list" id="initTeamList"></div>
        </div>
      </div>

      <!-- Modal placeholder -->
      <div id="initModalArea"></div>
    `;

    // Tab switching
    root.querySelectorAll('.init-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        root.querySelectorAll('.init-tab').forEach(t => t.classList.remove('active'));
        root.querySelectorAll('.init-tab-panel').forEach(p => p.classList.remove('show'));
        tab.classList.add('active');
        root.querySelector(`#initPanel${_capitalize(tab.dataset.tab)}`).classList.add('show');
      });
    });

    // Filter buttons
    root.querySelectorAll('.init-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.init-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _renderGrid(btn.dataset.filter);
      });
    });
  }

  function _capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ── Data loading ─────────────────────────────────────────
  async function _loadData() {
    _currentUser = window.currentUser;
    const email = _currentUser?.email;
    const isAdmin = _currentUser?.isAdmin || _currentUser?.is_admin;

    // Load all initiatives (we'll filter client-side by membership)
    const [initiatives, members, entries] = await Promise.all([
      window.supaFetch('initiatives', '?select=*&order=updated_at.desc'),
      window.supaFetch('initiative_members', '?select=*'),
      window.supaFetch('initiative_entries', '?select=*&order=created_at.desc')
    ]);

    _members = members || [];

    // Filter initiatives to only those the user is a member of (or admin sees all)
    if (isAdmin) {
      _initiatives = initiatives || [];
    } else {
      const myInitIds = new Set(
        _members.filter(m => m.email === email).map(m => m.initiative_id)
      );
      _initiatives = (initiatives || []).filter(i => myInitIds.has(i.id));
    }

    _entries = entries || [];
  }

  // ── Render card grid ─────────────────────────────────────
  function _renderGrid(filter = 'all') {
    const grid = document.getElementById('initGrid');
    if (!grid) return;

    let list = _initiatives;
    if (filter !== 'all') list = list.filter(i => i.status === filter);

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="init-empty" style="grid-column:1/-1;">
          <div class="init-empty-icon">📋</div>
          <h3>${filter === 'all' ? 'No initiatives yet' : 'No ' + filter.replace('_', ' ') + ' initiatives'}</h3>
          <p>${filter === 'all' ? 'Create your first initiative to start tracking projects and communications.' : 'Try a different filter or create a new initiative.'}</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = list.map(init => {
      const memberCount = _members.filter(m => m.initiative_id === init.id).length;
      const entryCount = _entries.filter(e => e.initiative_id === init.id).length;
      const latestEntry = _entries.find(e => e.initiative_id === init.id);
      const daysAgo = latestEntry
        ? Math.floor((Date.now() - new Date(latestEntry.created_at)) / 86400000)
        : Math.floor((Date.now() - new Date(init.created_at)) / 86400000);
      const lastActivity = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : daysAgo + 'd ago';

      return `
        <div class="init-card" onclick="initOpenProject('${init.id}')">
          <div class="init-card-header">
            <h3 class="init-card-title">${_esc(init.name)}</h3>
            <span class="init-status ${init.status}">${init.status.replace('_', ' ')}</span>
          </div>
          <div class="init-card-summary">${_esc(init.summary || 'No summary')}</div>
          <div class="init-card-meta">
            <span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              ${memberCount} member${memberCount !== 1 ? 's' : ''}
            </span>
            <span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              ${entryCount} entries
            </span>
            <span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${lastActivity}
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Detail view ──────────────────────────────────────────
  function _openProject(id) {
    _currentInitiative = _initiatives.find(i => i.id === id);
    if (!_currentInitiative) return;

    document.getElementById('initListView').classList.add('hidden');
    const detail = document.getElementById('initDetailView');
    detail.classList.add('show');

    document.getElementById('initDetailTitle').textContent = _currentInitiative.name;
    document.getElementById('initDetailSummary').textContent = _currentInitiative.summary || '';

    // Reset to overview tab (default landing)
    document.querySelectorAll('#initRoot .init-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#initRoot .init-tab-panel').forEach(p => p.classList.remove('show'));
    document.querySelector('#initRoot .init-tab[data-tab="overview"]').classList.add('active');
    document.getElementById('initPanelOverview').classList.add('show');

    _renderOverview();
    _renderTimeline();
    _renderMilestones();
    _renderDocs();
    _renderTeam();

    // Push history for back button
    history.pushState({ view: 'initiatives', project: id }, '', '#initiatives&project=' + id);
  }

  function _backToList() {
    _currentInitiative = null;
    document.getElementById('initListView').classList.remove('hidden');
    document.getElementById('initDetailView').classList.remove('show');
    history.pushState({ view: 'initiatives' }, '', '#initiatives');
  }

  // ── Timeline rendering ───────────────────────────────────
  function _renderTimeline() {
    const el = document.getElementById('initTimeline');
    if (!el || !_currentInitiative) return;

    const entries = _entries
      .filter(e => e.initiative_id === _currentInitiative.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (entries.length === 0) {
      el.innerHTML = `
        <div class="init-empty">
          <div class="init-empty-icon">💬</div>
          <h3>No activity yet</h3>
          <p>Add notes, link emails, or track milestones to build the project timeline.</p>
        </div>
      `;
      return;
    }

    el.innerHTML = entries.map(entry => {
      const date = new Date(entry.created_at);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const meta = entry.metadata || {};
      let extraMeta = '';
      if (entry.entry_type === 'email') {
        const dir = meta.direction === 'sent' ? '→' : '←';
        extraMeta = `<div class="init-entry-meta">${dir} ${_esc(meta.from || '')} → ${_esc((meta.to || []).join(', '))}</div>`;
      }
      if (entry.entry_type === 'task') {
        const done = meta.completed ? '✅' : '⬜';
        extraMeta = `<div class="init-entry-meta">${done} Assigned to: ${_esc(meta.assignee || 'Unassigned')}${meta.due_date ? ' · Due: ' + meta.due_date : ''}</div>`;
      }

      return `
        <div class="init-entry type-${entry.entry_type}">
          ${entry.is_pinned ? '<span class="pin-badge">📌 Pinned</span>' : ''}
          <div class="init-entry-header">
            <span class="init-entry-type">${entry.entry_type}</span>
            <span class="init-entry-date">${dateStr} at ${timeStr}</span>
          </div>
          ${entry.title ? `<div class="init-entry-title">${_esc(entry.title)}</div>` : ''}
          <div class="init-entry-content">${_esc(entry.content || '')}</div>
          ${extraMeta}
        </div>
      `;
    }).join('');
  }

  // ── Milestones rendering ─────────────────────────────────
  function _renderMilestones() {
    const el = document.getElementById('initMilestonesList');
    if (!el || !_currentInitiative) return;

    const milestones = _entries
      .filter(e => e.initiative_id === _currentInitiative.id && e.entry_type === 'milestone')
      .sort((a, b) => {
        const aDate = a.metadata?.due_date || '9999';
        const bDate = b.metadata?.due_date || '9999';
        return aDate.localeCompare(bDate);
      });

    if (milestones.length === 0) {
      el.innerHTML = `
        <div class="init-empty" style="padding:30px;">
          <h3 style="font-size:15px;">No milestones yet</h3>
          <p style="font-size:13px;">Add key dates and deliverables to track progress.</p>
        </div>
      `;
      return;
    }

    el.innerHTML = milestones.map(m => {
      const done = m.metadata?.completed;
      const dueDate = m.metadata?.due_date
        ? new Date(m.metadata.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'No due date';
      return `
        <div class="init-milestone-row">
          <div class="init-milestone-check ${done ? 'done' : ''}" onclick="initToggleMilestone('${m.id}')">
            ${done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </div>
          <div class="init-milestone-info">
            <div class="init-milestone-title ${done ? 'done' : ''}">${_esc(m.title || 'Untitled')}</div>
            <div class="init-milestone-due">${dueDate}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Team rendering ───────────────────────────────────────
  function _renderTeam() {
    const el = document.getElementById('initTeamList');
    if (!el || !_currentInitiative) return;

    const team = _members.filter(m => m.initiative_id === _currentInitiative.id);

    if (team.length === 0) {
      el.innerHTML = `
        <div class="init-empty" style="padding:30px;">
          <h3 style="font-size:15px;">No team members</h3>
          <p style="font-size:13px;">Add members to control who can see this initiative.</p>
        </div>
      `;
      return;
    }

    el.innerHTML = team.map(m => {
      const initials = m.email.split('@')[0].substring(0, 2).toUpperCase();
      const name = _emailToName(m.email);
      return `
        <div class="init-team-row">
          <div class="init-team-person">
            <div class="init-team-avatar">${initials}</div>
            <div>
              <div class="init-team-name">${_esc(name)}</div>
              <div class="init-team-email">${_esc(m.email)}</div>
            </div>
          </div>
          <span class="init-team-role ${m.role}">${m.role}</span>
        </div>
      `;
    }).join('');
  }

  // ── Docs tab rendering ───────────────────────────────────
  function _renderDocs() {
    const el = document.getElementById('initDocsList');
    if (!el || !_currentInitiative) return;

    const docs = _entries
      .filter(e => e.initiative_id === _currentInitiative.id && e.entry_type === 'document')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (docs.length === 0) {
      el.innerHTML = `
        <div class="init-empty" style="grid-column:1/-1;padding:40px;">
          <div class="init-empty-icon">📄</div>
          <h3 style="font-size:15px;">No documents yet</h3>
          <p style="font-size:13px;">Add documents, spreadsheets, or files to keep everything in one place.</p>
        </div>
      `;
      return;
    }

    el.innerHTML = docs.map(doc => {
      const meta = doc.metadata || {};
      const filename = meta.filename || doc.title || 'Untitled';
      const ext = _getFileExt(filename);
      const icon = _fileIcon(ext);
      const iconClass = _fileIconClass(ext);
      const date = new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const source = meta.source || '';
      const desc = doc.content && doc.content !== 'key_metrics' ? doc.content : doc.title || '';

      return `
        <div class="init-doc-card">
          <div class="init-doc-icon ${iconClass}">${icon}</div>
          <div class="init-doc-info">
            <div class="init-doc-name" title="${_esc(filename)}">${_esc(filename)}</div>
            ${desc ? `<div class="init-doc-desc">${_esc(desc)}</div>` : ''}
            <div class="init-doc-meta">
              <span>${date}</span>
              ${source ? `<span>${_esc(source)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function _getFileExt(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function _fileIcon(ext) {
    const icons = {
      xlsx: '📊', xls: '📊', csv: '📊',
      pdf: '📕',
      doc: '📘', docx: '📘',
      pptx: '📙', ppt: '📙',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️',
      zip: '📦', rar: '📦',
    };
    return icons[ext] || '📄';
  }

  function _fileIconClass(ext) {
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['doc', 'docx'].includes(ext)) return 'doc';
    if (['pptx', 'ppt'].includes(ext)) return 'pptx';
    if (['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return 'img';
    return 'other';
  }

  // ── CRUD: Add Document ──────────────────────────────────
  async function _addDoc() {
    if (!_currentInitiative) return;
    _showModal('Add Document', `
      <label>Document Name / Filename</label>
      <input id="initDocName" placeholder="e.g. Buyout_Analysis_v2.xlsx" />
      <label>Description</label>
      <textarea id="initDocDesc" placeholder="Brief description of the document..." style="min-height:70px;"></textarea>
      <label>Source</label>
      <input id="initDocSource" placeholder="e.g. PowerFlex, AI Assistant, Newmark" />
    `, async () => {
      const filename = document.getElementById('initDocName').value.trim();
      const desc = document.getElementById('initDocDesc').value.trim();
      const source = document.getElementById('initDocSource').value.trim();
      if (!filename) return alert('Document name is required');

      const ext = _getFileExt(filename);
      await window.supaWrite('initiative_entries', 'POST', {
        initiative_id: _currentInitiative.id,
        entry_type: 'document',
        title: filename,
        content: desc || null,
        metadata: { filename, type: ext || 'unknown', source: source || null },
        created_by: _currentUser?.email || 'mz@firstmilecap.com'
      });

      await window.supaWrite('initiatives', 'PATCH', {
        updated_at: new Date().toISOString()
      }, `?id=eq.${_currentInitiative.id}`);

      _closeModal();
      await _loadData();
      _renderDocs();
      _renderTimeline();
      _toast('Document added');
    });
  }

  // ── Overview Dashboard rendering ──────────────────────────
  function _renderOverview() {
    const el = document.getElementById('initOverview');
    if (!el || !_currentInitiative) return;
    const ci = _currentInitiative;
    const initId = ci.id;

    // Gather stats
    const projectEntries = _entries.filter(e => e.initiative_id === initId);
    const emails = projectEntries.filter(e => e.entry_type === 'email');
    const notes = projectEntries.filter(e => e.entry_type === 'note' && e.content !== 'key_metrics');
    const docs = projectEntries.filter(e => e.entry_type === 'document');
    const milestones = projectEntries.filter(e => e.entry_type === 'milestone');
    const tasks = projectEntries.filter(e => e.entry_type === 'task');
    const team = _members.filter(m => m.initiative_id === initId);
    const completedMs = milestones.filter(m => m.metadata?.completed);
    const msPct = milestones.length > 0 ? Math.round((completedMs.length / milestones.length) * 100) : 0;

    // Date range
    const allDates = projectEntries.map(e => new Date(e.created_at)).sort((a, b) => a - b);
    const startDate = allDates[0] || new Date();
    const endDate = allDates[allDates.length - 1] || new Date();
    const daysActive = Math.max(1, Math.ceil((endDate - startDate) / 86400000));

    // Owner
    const owner = team.find(m => m.role === 'owner');
    const ownerName = owner ? _emailToName(owner.email) : 'Unassigned';

    // Generate AI narrative
    const narrative = _generateNarrative(ci, { emails, notes, docs, milestones, completedMs, tasks, team, daysActive, startDate, endDate });

    // Find key_metrics entry (deal table)
    const metricsEntry = projectEntries.find(e => e.content === 'key_metrics' && e.metadata?.type === 'deal_table');
    const dealHTML = metricsEntry ? _buildDealTable(metricsEntry.metadata) : '';

    // Pinned notes (excluding key_metrics)
    const pinnedNotes = projectEntries.filter(e => e.is_pinned && e.content !== 'key_metrics');

    // Open items
    const openMs = milestones.filter(m => !m.metadata?.completed);
    const openTasks = tasks.filter(t => !t.metadata?.completed);

    // Visual timeline
    const vtHTML = _buildVisualTimeline(projectEntries.filter(e => e.content !== 'key_metrics'), startDate, endDate);

    el.innerHTML = `
      <!-- 1. AI Summary — FIRST -->
      <div class="init-ai-summary">
        <div class="init-ai-narrative">${narrative}</div>
      </div>

      <!-- 2. Key Deal Visual / Table — project-specific -->
      ${dealHTML}

      <!-- 3. Compact Stats Bar -->
      <div class="init-stats-bar">
        <div class="init-stat-chip"><strong>${emails.length}</strong> emails</div>
        <div class="init-stat-chip"><strong>${docs.length}</strong> docs</div>
        <div class="init-stat-chip"><strong>${team.length}</strong> team</div>
        <div class="init-stat-chip"><strong>${daysActive}d</strong> active</div>
        <div class="init-stat-chip">Lead: <strong>${_esc(ownerName.split(' ')[0])}</strong></div>
        <div class="init-stat-chip" style="${msPct === 100 ? 'background:#dcfce7;border-color:#86efac;' : msPct > 0 ? 'background:#dbeafe;border-color:#93c5fd;' : ''}">
          <strong>${completedMs.length}/${milestones.length}</strong> milestones
        </div>
      </div>

      <!-- 4. Milestone Progress + Open Items side by side -->
      <div class="init-two-col">
        <div class="init-progress-section">
          <div class="init-progress-header">
            <h4>Milestones</h4>
            <span class="init-progress-pct">${msPct}%</span>
          </div>
          <div class="init-progress-bar">
            <div class="init-progress-fill" style="width:${msPct}%"></div>
          </div>
          <div class="init-progress-items">
            ${milestones.map(m => {
              const done = m.metadata?.completed;
              const dueDate = m.metadata?.due_date;
              const isOverdue = !done && dueDate && new Date(dueDate + 'T23:59:59') < new Date();
              const dueFmt = dueDate ? new Date(dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
              const dotClass = done ? 'done' : isOverdue ? 'overdue' : 'pending';
              const dueClass = isOverdue ? 'overdue' : '';
              return `<div class="init-progress-item">
                <span class="init-progress-dot ${dotClass}"></span>
                <span style="${done ? 'text-decoration:line-through;color:#94a3b8;' : ''}">${_esc(m.title)}</span>
                <span class="due ${dueClass}">${done ? 'Done' : dueFmt ? (isOverdue ? 'Overdue' : dueFmt) : ''}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="init-info-box">
          <h4>Key Context</h4>
          <ul>
            ${pinnedNotes.length > 0 ? pinnedNotes.map(n => `<li>${_esc(n.content || n.title || 'Note')}</li>`).join('') : `<li style="color:#94a3b8;">No pinned notes yet</li>`}
            ${openMs.length > 0 || openTasks.length > 0 ? '<li style="border-top:1px solid #e2e8f0;padding-top:10px;margin-top:4px;font-weight:600;color:#1e293b;">Open Items</li>' : ''}
            ${openMs.map(m => `<li>→ ${_esc(m.title)}${m.metadata?.due_date ? ' <span style="color:#94a3b8;font-size:11px;">(due ' + m.metadata.due_date + ')</span>' : ''}</li>`).join('')}
            ${openTasks.map(t => `<li>→ ${_esc(t.title)}</li>`).join('')}
          </ul>
        </div>
      </div>

      <!-- 5. Activity Timeline -->
      ${vtHTML}
    `;
  }

  // ── Deal Table Builder ──────────────────────────────────
  function _buildDealTable(meta) {
    if (!meta || !meta.columns || !meta.rows) return '';
    const highlightIdx = meta.highlight_row ?? -1;

    let tableRows = meta.rows.map((row, i) => {
      const cls = i === highlightIdx ? ' class="highlight"' : '';
      return `<tr${cls}>${row.map(cell => `<td>${_esc(cell)}</td>`).join('')}</tr>`;
    }).join('');

    let statsHTML = '';
    if (meta.summary_stats && meta.summary_stats.length > 0) {
      statsHTML = `<div class="init-deal-stats">
        ${meta.summary_stats.map(s => `
          <div class="init-deal-stat">
            <div class="init-deal-stat-val">${_esc(s.value)}</div>
            <div class="init-deal-stat-lbl">${_esc(s.label)}</div>
          </div>
        `).join('')}
      </div>`;
    }

    return `
      <div class="init-deal-section">
        <div class="init-deal-title">${_esc(meta.table_title || 'Analysis')}</div>
        <table class="init-deal-table">
          <thead><tr>${meta.columns.map(c => `<th>${_esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${statsHTML}
      </div>
    `;
  }

  // ── AI Narrative Generator ──────────────────────────────
  function _generateNarrative(init, data) {
    const { emails, notes, docs, milestones, completedMs, tasks, team, daysActive, startDate, endDate } = data;
    const ownerMember = team.find(m => m.role === 'owner');
    const ownerName = ownerMember ? _emailToName(ownerMember.email).split(' ')[0] : 'The team';
    const totalEntries = emails.length + notes.length + docs.length + milestones.length + tasks.length;
    const msPct = milestones.length > 0 ? Math.round((completedMs.length / milestones.length) * 100) : 0;

    // Build contextual sentences
    let parts = [];

    // Opening — status + age
    if (init.status === 'active') {
      parts.push(`<strong>${_esc(init.name)}</strong> is an active initiative that has been running for <strong>${daysActive} days</strong>.`);
    } else if (init.status === 'completed') {
      parts.push(`<strong>${_esc(init.name)}</strong> has been completed after ${daysActive} days of activity.`);
    } else {
      parts.push(`<strong>${_esc(init.name)}</strong> is currently <strong>${init.status.replace('_', ' ')}</strong>, with ${daysActive} days of tracked activity.`);
    }

    // Summary context
    if (init.summary) {
      parts.push(init.summary);
    }

    // Activity volume
    if (emails.length > 0) {
      const sent = emails.filter(e => e.metadata?.direction === 'sent').length;
      const received = emails.length - sent;
      parts.push(`The communication log includes <strong>${emails.length} emails</strong> (${sent} sent, ${received} received)${docs.length > 0 ? ` and <strong>${docs.length} document${docs.length > 1 ? 's' : ''}</strong>` : ''}.`);
    }

    // Milestone progress
    if (milestones.length > 0) {
      if (msPct === 100) {
        parts.push(`All <strong>${milestones.length} milestones</strong> have been completed.`);
      } else if (msPct > 0) {
        const openMs = milestones.filter(m => !m.metadata?.completed);
        const nextMs = openMs.sort((a, b) => (a.metadata?.due_date || '9999').localeCompare(b.metadata?.due_date || '9999'))[0];
        parts.push(`<strong>${completedMs.length} of ${milestones.length}</strong> milestones are complete (${msPct}%). Next up: <strong>${_esc(nextMs?.title || 'TBD')}</strong>${nextMs?.metadata?.due_date ? ' (due ' + nextMs.metadata.due_date + ')' : ''}.`);

        // Overdue warning
        const overdue = openMs.filter(m => m.metadata?.due_date && new Date(m.metadata.due_date + 'T23:59:59') < new Date());
        if (overdue.length > 0) {
          parts.push(`<span style="color:#ef4444;font-weight:600;">⚠ ${overdue.length} milestone${overdue.length > 1 ? 's are' : ' is'} past due.</span>`);
        }
      }
    }

    // Team
    parts.push(`${ownerName} is leading this initiative with a team of <strong>${team.length}</strong>.`);

    return parts.join(' ');
  }

  // ── Visual Timeline Chart ───────────────────────────────
  function _buildVisualTimeline(entries, startDate, endDate) {
    // Extend end date slightly for padding
    const padEnd = new Date(Math.max(endDate.getTime(), Date.now()) + 86400000 * 3);
    const padStart = new Date(startDate.getTime() - 86400000);
    const totalMs = padEnd - padStart;
    const pct = (d) => Math.min(100, Math.max(0, ((d - padStart) / totalMs) * 100));

    // Group entries by type and date
    const emails = entries.filter(e => e.entry_type === 'email');
    const nonEmails = entries.filter(e => e.entry_type === 'note' || e.entry_type === 'document');
    const milestones = entries.filter(e => e.entry_type === 'milestone');

    // Build date clusters for bars
    const buildBars = (items, color, row) => {
      if (items.length === 0) return '';
      // Cluster items within 12hrs of each other
      const sorted = [...items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      let bars = '';
      let clusterStart = new Date(sorted[0].created_at);
      let clusterEnd = clusterStart;
      for (let i = 1; i <= sorted.length; i++) {
        const cur = i < sorted.length ? new Date(sorted[i].created_at) : null;
        if (cur && (cur - clusterEnd) < 43200000) { // 12hrs
          clusterEnd = cur;
        } else {
          const left = pct(clusterStart);
          const width = Math.max(2, pct(new Date(clusterEnd.getTime() + 3600000)) - left);
          bars += `<div class="init-vt-bar" style="left:${left}%;width:${width}%;background:${color};top:${row}px;"></div>`;
          if (cur) { clusterStart = cur; clusterEnd = cur; }
        }
      }
      return bars;
    };

    // Today marker
    const todayPct = pct(new Date());
    const todayMarker = todayPct > 0 && todayPct < 100 ? `<div class="init-vt-marker" style="left:${todayPct}%"></div>` : '';

    // Milestone markers (diamonds)
    const msMarkers = milestones.map(m => {
      const d = m.metadata?.due_date ? new Date(m.metadata.due_date + 'T12:00:00') : new Date(m.created_at);
      const left = pct(d);
      const done = m.metadata?.completed;
      const color = done ? '#10b981' : '#f59e0b';
      return `<div style="position:absolute;left:${left}%;top:40px;transform:translateX(-50%) rotate(45deg);width:10px;height:10px;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px ${color};z-index:1;"></div>`;
    }).join('');

    const startFmt = padStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endFmt = padEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return `
      <div class="init-visual-timeline">
        <h4>Activity Timeline</h4>
        <div class="init-vt-dates"><span>${startFmt}</span><span>${endFmt}</span></div>
        <div class="init-vt-track">
          ${buildBars(emails, '#3b82f6', 8)}
          ${buildBars(nonEmails, '#8b5cf6', 26)}
          ${msMarkers}
          ${todayMarker}
        </div>
        <div class="init-vt-legend">
          <span><span class="init-vt-legend-dot" style="background:#3b82f6;"></span> Emails</span>
          <span><span class="init-vt-legend-dot" style="background:#8b5cf6;"></span> Notes & Docs</span>
          <span><span class="init-vt-legend-dot" style="background:#f59e0b;border-radius:0;transform:rotate(45deg);"></span> Milestones</span>
          <span><span style="display:inline-block;width:8px;height:8px;border-left:2px solid #ef4444;"></span> Today</span>
        </div>
      </div>
    `;
  }

  // ── Modal helpers ────────────────────────────────────────
  function _showModal(title, bodyHTML, onSave) {
    const area = document.getElementById('initModalArea');
    area.innerHTML = `
      <div class="init-modal-overlay" onclick="if(event.target===this)initCloseModal()">
        <div class="init-modal">
          <h3>${title}</h3>
          ${bodyHTML}
          <div class="init-modal-actions">
            <button class="init-btn-outline" onclick="initCloseModal()">Cancel</button>
            <button class="init-btn-primary" id="initModalSave">Save</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('initModalSave').addEventListener('click', onSave);
  }

  function _closeModal() {
    document.getElementById('initModalArea').innerHTML = '';
  }

  // ── CRUD: New Initiative ─────────────────────────────────
  async function _newProject() {
    _showModal('New Initiative', `
      <label>Name</label>
      <input id="initNewName" placeholder="e.g. Gimlet/Spotify Buyout Analysis" />
      <label>Summary</label>
      <textarea id="initNewSummary" placeholder="Brief description of the project scope and goals..."></textarea>
      <label>Status</label>
      <select id="initNewStatus">
        <option value="active">Active</option>
        <option value="on_hold">On Hold</option>
      </select>
    `, async () => {
      const name = document.getElementById('initNewName').value.trim();
      const summary = document.getElementById('initNewSummary').value.trim();
      const status = document.getElementById('initNewStatus').value;
      if (!name) return alert('Name is required');

      const email = _currentUser?.email || 'mz@firstmilecap.com';
      const [created] = await window.supaWrite('initiatives', 'POST', {
        name, summary, status, created_by: email
      });

      // Add creator as owner
      await window.supaWrite('initiative_members', 'POST', {
        initiative_id: created.id,
        email: email,
        role: 'owner'
      });

      _closeModal();
      await _loadData();
      _renderGrid();
      _toast('Initiative created');
    });
  }

  // ── CRUD: Edit Initiative ────────────────────────────────
  async function _editProject() {
    if (!_currentInitiative) return;
    const c = _currentInitiative;
    _showModal('Edit Initiative', `
      <label>Name</label>
      <input id="initEditName" value="${_esc(c.name)}" />
      <label>Summary</label>
      <textarea id="initEditSummary">${_esc(c.summary || '')}</textarea>
      <label>Status</label>
      <select id="initEditStatus">
        <option value="active" ${c.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="on_hold" ${c.status === 'on_hold' ? 'selected' : ''}>On Hold</option>
        <option value="completed" ${c.status === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="archived" ${c.status === 'archived' ? 'selected' : ''}>Archived</option>
      </select>
    `, async () => {
      const name = document.getElementById('initEditName').value.trim();
      const summary = document.getElementById('initEditSummary').value.trim();
      const status = document.getElementById('initEditStatus').value;
      if (!name) return alert('Name is required');

      await window.supaWrite('initiatives', 'PATCH', {
        name, summary, status, updated_at: new Date().toISOString()
      }, `?id=eq.${c.id}`);

      _closeModal();
      await _loadData();
      _currentInitiative = _initiatives.find(i => i.id === c.id);
      document.getElementById('initDetailTitle').textContent = name;
      document.getElementById('initDetailSummary').textContent = summary;
      _renderGrid();
      _toast('Initiative updated');
    });
  }

  // ── CRUD: Add Entry ──────────────────────────────────────
  async function _addEntry() {
    if (!_currentInitiative) return;
    _showModal('Add Entry', `
      <label>Type</label>
      <select id="initEntryType" onchange="initEntryTypeChanged()">
        <option value="note">Note</option>
        <option value="email">Email Reference</option>
        <option value="milestone">Milestone</option>
        <option value="task">Task</option>
        <option value="document">Document</option>
      </select>
      <label>Title</label>
      <input id="initEntryTitle" placeholder="Brief title" />
      <label>Content / Details</label>
      <textarea id="initEntryContent" placeholder="Enter details..."></textarea>
      <div id="initEntryExtra"></div>
    `, async () => {
      const entry_type = document.getElementById('initEntryType').value;
      const title = document.getElementById('initEntryTitle').value.trim();
      const content = document.getElementById('initEntryContent').value.trim();
      const email = _currentUser?.email || 'mz@firstmilecap.com';
      let metadata = {};

      if (entry_type === 'milestone') {
        const due = document.getElementById('initEntryDue')?.value;
        if (due) metadata.due_date = due;
        metadata.completed = false;
      }
      if (entry_type === 'task') {
        const assignee = document.getElementById('initEntryAssignee')?.value;
        const due = document.getElementById('initEntryDue')?.value;
        if (assignee) metadata.assignee = assignee;
        if (due) metadata.due_date = due;
        metadata.completed = false;
      }

      await window.supaWrite('initiative_entries', 'POST', {
        initiative_id: _currentInitiative.id,
        entry_type, title, content, metadata,
        created_by: email
      });

      // Update initiative timestamp
      await window.supaWrite('initiatives', 'PATCH', {
        updated_at: new Date().toISOString()
      }, `?id=eq.${_currentInitiative.id}`);

      _closeModal();
      await _loadData();
      _renderTimeline();
      _renderMilestones();
      _toast('Entry added');
    });
  }

  // ── CRUD: Add Milestone ──────────────────────────────────
  async function _addMilestone() {
    if (!_currentInitiative) return;
    _showModal('Add Milestone', `
      <label>Milestone Name</label>
      <input id="initMsName" placeholder="e.g. Submit buyout proposal" />
      <label>Due Date</label>
      <input id="initMsDue" type="date" />
    `, async () => {
      const title = document.getElementById('initMsName').value.trim();
      const due = document.getElementById('initMsDue').value;
      if (!title) return alert('Name is required');

      await window.supaWrite('initiative_entries', 'POST', {
        initiative_id: _currentInitiative.id,
        entry_type: 'milestone',
        title,
        metadata: { due_date: due || null, completed: false },
        created_by: _currentUser?.email || 'mz@firstmilecap.com'
      });

      await window.supaWrite('initiatives', 'PATCH', {
        updated_at: new Date().toISOString()
      }, `?id=eq.${_currentInitiative.id}`);

      _closeModal();
      await _loadData();
      _renderMilestones();
      _renderTimeline();
      _toast('Milestone added');
    });
  }

  // ── CRUD: Toggle Milestone ───────────────────────────────
  async function _toggleMilestone(entryId) {
    const entry = _entries.find(e => e.id === entryId);
    if (!entry) return;
    const meta = { ...(entry.metadata || {}) };
    meta.completed = !meta.completed;
    if (meta.completed) meta.completed_at = new Date().toISOString();

    await window.supaWrite('initiative_entries', 'PATCH', {
      metadata: meta
    }, `?id=eq.${entryId}`);

    await _loadData();
    _renderMilestones();
    _renderTimeline();
    _toast(meta.completed ? 'Milestone completed' : 'Milestone reopened');
  }

  // ── CRUD: Add Member ─────────────────────────────────────
  async function _addMember() {
    if (!_currentInitiative) return;
    _showModal('Add Team Member', `
      <label>Email</label>
      <input id="initMemberEmail" placeholder="e.g. rc@firstmilecap.com" type="email" />
      <label>Role</label>
      <select id="initMemberRole">
        <option value="member">Member</option>
        <option value="owner">Owner</option>
        <option value="viewer">Viewer</option>
      </select>
    `, async () => {
      const email = document.getElementById('initMemberEmail').value.trim().toLowerCase();
      const role = document.getElementById('initMemberRole').value;
      if (!email) return alert('Email is required');

      // Check for duplicates
      const existing = _members.find(m => m.initiative_id === _currentInitiative.id && m.email === email);
      if (existing) return alert('This person is already a member');

      await window.supaWrite('initiative_members', 'POST', {
        initiative_id: _currentInitiative.id,
        email, role
      });

      _closeModal();
      await _loadData();
      _renderTeam();
      _renderGrid();
      _toast('Member added');
    });
  }

  // ── Entry type changed (modal dynamic fields) ────────────
  window.initEntryTypeChanged = function () {
    const type = document.getElementById('initEntryType').value;
    const extra = document.getElementById('initEntryExtra');
    if (type === 'milestone' || type === 'task') {
      let html = '<label>Due Date</label><input id="initEntryDue" type="date" />';
      if (type === 'task') {
        html += '<label>Assignee Email</label><input id="initEntryAssignee" placeholder="e.g. rc@firstmilecap.com" />';
      }
      extra.innerHTML = html;
    } else {
      extra.innerHTML = '';
    }
  };

  // ── Helpers ──────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  const KNOWN_NAMES = {
    'mz@firstmilecap.com': 'Morris Zeitouni',
    'rc@firstmilecap.com': 'Richard Chera',
    'ty@firstmilecap.com': 'Toby Yedid',
    'src@cacq.com': 'Stanley Chera',
    'rz@firstmilecap.com': 'Rasheq Zarif',
    'aiassistant@firstmilecap.com': 'AI Assistant',
    'apauluhn@firstmilecap.com': 'Adara Pauluhn',
    'smittal@firstmilecap.com': 'Samarth Mitta'
  };

  function _emailToName(email) {
    if (KNOWN_NAMES[email]) return KNOWN_NAMES[email];
    const local = email.split('@')[0];
    return local.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function _toast(msg) {
    // Use existing toast if available in parent app
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
      return;
    }
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.15);';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // ── Public API (called from onclick handlers) ────────────
  window.initOpenProject = function (id) { _openProject(id); };
  window.initBackToList = function () { _backToList(); };
  window.initNewProject = function () { _newProject(); };
  window.initEditProject = function () { _editProject(); };
  window.initAddEntry = function () { _addEntry(); };
  window.initAddMilestone = function () { _addMilestone(); };
  window.initToggleMilestone = function (id) { _toggleMilestone(id); };
  window.initAddMember = function () { _addMember(); };
  window.initAddDoc = function () { _addDoc(); };
  window.initCloseModal = function () { _closeModal(); };

  // ── Main init (called by switchView) ─────────────────────
  window.initiativesInit = async function () {
    if (_inited) {
      // Refresh data on re-visit
      await _loadData();
      _renderGrid();
      return;
    }
    _inited = true;
    _injectCSS();
    _injectHTML();
    try {
      await _loadData();
      _renderGrid();
    } catch (e) {
      console.error('Initiatives init failed:', e);
      const root = document.getElementById('initRoot');
      if (root) root.innerHTML = '<p style="color:red;padding:20px;">Failed to load initiatives: ' + e.message + '</p>';
    }
  };

  // Handle popstate for back button
  window.addEventListener('popstate', function (e) {
    if (e.state?.view === 'initiatives' && !e.state?.project) {
      _backToList();
    }
  });

})();
