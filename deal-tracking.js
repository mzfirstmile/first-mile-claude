/* ============================================================
   Deal Tracking Module — deal-tracking.js
   External IIFE module (same pattern as initiatives.js)
   Loaded via <script src="deal-tracking.js"> in index.html
   Called via window.dealTrackingInit() from switchView()

   Data: Supabase `deal_tracking` (written by the `deal-intake`
   edge function when a colleague emails a prospective deal to
   aiassistant@firstmilecap.com, or from the "+ Log Deal" modal).
   ============================================================ */
(function () {
  'use strict';

  let _inited = false;
  let _deals = [];
  let _filter = 'all';
  let _current = null;
  let _sort = { key: 'created_at', dir: 'desc' };

  const STATUSES = ['new', 'reviewing', 'pursuing', 'passed', 'stale'];
  const STATUS_LABEL = { new: 'New', reviewing: 'Reviewing', pursuing: 'Pursuing', passed: 'Passed', stale: 'Stale' };
  const STATUS_COLOR = { new: '#0ea5e9', reviewing: '#8b5cf6', pursuing: '#059669', passed: '#94a3b8', stale: '#f59e0b' };
  const REC_COLOR = { Pursue: '#059669', Review: '#f59e0b', Pass: '#ef4444' };
  const TIER_COLOR = { 1: '#059669', 2: '#0ea5e9', 3: '#f59e0b', 4: '#ef4444' };

  // ── CSS ──────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('dt-css')) return;
    const s = document.createElement('style');
    s.id = 'dt-css';
    s.textContent = `
      #dtRoot { color:#1e293b; }
      #dtRoot .dt-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
      #dtRoot .dt-head h2 { margin:0; font-size:22px; font-weight:700; }
      #dtRoot .dt-head p { margin:4px 0 0; color:#64748b; font-size:14px; max-width:720px; }
      #dtRoot .dt-btn { border:1px solid #e2e8f0; background:#fff; color:#1e293b; border-radius:8px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; }
      #dtRoot .dt-btn:hover { border-color:#0ea5e9; color:#0ea5e9; }
      #dtRoot .dt-btn.primary { background:linear-gradient(135deg,#0ea5e9,#0369a1); color:#fff; border:none; }
      #dtRoot .dt-btn.primary:hover { filter:brightness(1.05); color:#fff; }
      #dtRoot .dt-btn:disabled { opacity:.6; cursor:default; }
      #dtRoot .dt-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:18px 0; }
      #dtRoot .dt-kpi { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; }
      #dtRoot .dt-kpi .v { font-size:24px; font-weight:700; }
      #dtRoot .dt-kpi .l { font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:.04em; margin-top:2px; }
      #dtRoot .dt-chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
      #dtRoot .dt-chip { border:1px solid #e2e8f0; background:#fff; border-radius:20px; padding:5px 12px; font-size:13px; cursor:pointer; color:#475569; }
      #dtRoot .dt-chip.active { background:#1e293b; color:#fff; border-color:#1e293b; }
      #dtRoot .dt-chip b { margin-left:4px; opacity:.7; }
      #dtRoot table.dt-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
      #dtRoot table.dt-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#64748b; padding:10px 12px; background:#f8fafc; border-bottom:1px solid #e2e8f0; cursor:pointer; white-space:nowrap; user-select:none; }
      #dtRoot table.dt-table th.num, #dtRoot table.dt-table td.num { text-align:right; }
      #dtRoot table.dt-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13.5px; vertical-align:middle; }
      #dtRoot table.dt-table tr.row { cursor:pointer; }
      #dtRoot table.dt-table tr.row:hover td { background:#f0f9ff; }
      #dtRoot .dt-name { font-weight:600; color:#0f172a; }
      #dtRoot .dt-sub { color:#64748b; font-size:12px; margin-top:2px; }
      #dtRoot .pill { display:inline-block; padding:2px 9px; border-radius:10px; font-size:11.5px; font-weight:700; color:#fff; white-space:nowrap; }
      #dtRoot .tierpill { display:inline-block; min-width:22px; text-align:center; padding:1px 6px; border-radius:8px; font-size:11px; font-weight:700; color:#fff; }
      #dtRoot select.dt-status { border:1px solid #e2e8f0; border-radius:8px; padding:4px 8px; font-size:12.5px; background:#fff; cursor:pointer; }
      #dtRoot .dt-empty { text-align:center; color:#64748b; padding:48px 16px; background:#fff; border:1px dashed #e2e8f0; border-radius:12px; }
      /* detail */
      #dtRoot .dt-back { background:none; border:none; color:#0ea5e9; font-size:14px; cursor:pointer; padding:0; margin-bottom:12px; }
      #dtRoot .dt-detail-head { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:18px 22px; display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; }
      #dtRoot .dt-detail-head h2 { margin:0 0 6px; font-size:22px; }
      #dtRoot .dt-meta { color:#64748b; font-size:13px; }
      #dtRoot .dt-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      #dtRoot .dt-report { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:22px 26px; margin-top:16px; }
      #dtRoot .dt-report h3 { margin-top:18px; }
      #dtRoot .dt-report table td, #dtRoot .dt-report table th { font-size:13.5px !important; }
      #dtRoot details.dt-raw { margin-top:16px; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:12px 18px; }
      #dtRoot details.dt-raw pre { white-space:pre-wrap; font-size:12.5px; color:#334155; max-height:360px; overflow:auto; }
      #dtRoot textarea.dt-notes { width:100%; min-height:80px; border:1px solid #e2e8f0; border-radius:8px; padding:10px; font:inherit; font-size:13.5px; margin-top:8px; }
      /* modal */
      .dt-overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); z-index:9000; display:flex; align-items:center; justify-content:center; }
      .dt-modal { background:#fff; border-radius:14px; width:min(720px,94vw); padding:22px 26px; box-shadow:0 20px 60px rgba(0,0,0,.25); }
      .dt-modal h3 { margin:0 0 6px; }
      .dt-modal p { margin:0 0 12px; color:#64748b; font-size:13.5px; }
      .dt-modal textarea, .dt-modal input { width:100%; border:1px solid #e2e8f0; border-radius:8px; padding:10px; font:inherit; font-size:13.5px; box-sizing:border-box; }
      .dt-modal textarea { min-height:220px; }
      .dt-modal .row { display:flex; gap:10px; margin-bottom:10px; }
      .dt-modal .foot { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
      .dt-spin { display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,.5); border-top-color:#fff; border-radius:50%; animation:dtspin .8s linear infinite; vertical-align:-2px; margin-right:6px; }
      @keyframes dtspin { to { transform:rotate(360deg); } }
    `;
    document.head.appendChild(s);
  }

  // ── Helpers ──────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt$ = (n) => (n == null || isNaN(Number(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const fmt$k = (n) => { if (n == null || isNaN(Number(n))) return '—'; const v = Number(n); return v >= 1e6 ? '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + v; };
  const fmtN = (n, d = 0) => (n == null || isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d }));
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const tierPill = (t) => (t ? `<span class="tierpill" style="background:${TIER_COLOR[t] || '#94a3b8'}">T${t}</span>` : '<span class="tierpill" style="background:#cbd5e1">—</span>');
  const recPill = (r) => (r ? `<span class="pill" style="background:${REC_COLOR[r] || '#94a3b8'}">${esc(r)}</span>` : '<span class="pill" style="background:#cbd5e1">—</span>');
  const statusSel = (d) => `<select class="dt-status" onclick="event.stopPropagation()" onchange="dtSetStatus('${d.id}', this.value)" style="border-color:${STATUS_COLOR[d.status] || '#e2e8f0'}">${STATUSES.map((s) => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>`;
  function _toast(msg, isErr) {
    if (typeof window.showToast === 'function' && !isErr) { window.showToast(msg); return; }
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${isErr ? '#b91c1c' : '#1e293b'};color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.15);max-width:420px`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), isErr ? 5000 : 2500);
  }
  function _root() { return document.getElementById('dtRoot'); }

  // ── Data ─────────────────────────────────────────────────
  async function _load() {
    _deals = await window.supaFetch('deal_tracking', '?select=id,created_at,updated_at,source,submitted_by,submitted_by_name,email_subject,deal_name,address,city,state,asset_type,deal_type,sf,units,asking_price,price_psf,noi,cap_rate,occupancy_pct,market_id,market_name,market_distance_mi,market_score_res,market_tier_res,market_score_office,market_tier_office,market_rank_office,market_rank_res,scoring_view,opportunity_score,opportunity_tier,recommendation,status,notes,replied_at&order=created_at.desc&limit=1000');
  }
  async function _loadOne(id) {
    const rows = await window.supaFetch('deal_tracking', `?select=*&id=eq.${id}`);
    return rows[0] || null;
  }
  async function _callIntake(body) {
    const r = await fetch(`${window.SUPABASE_URL}/functions/v1/deal-intake`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + window.SUPABASE_KEY, apikey: window.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `deal-intake ${r.status}`);
    return j;
  }

  // ── List view ────────────────────────────────────────────
  function _filtered() {
    let rows = _filter === 'all' ? _deals.slice() : _deals.filter((d) => d.status === _filter);
    const k = _sort.key, dir = _sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let x = a[k], y = b[k];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      if (typeof x === 'string' && typeof y === 'string' && !/_at$/.test(k)) return x.localeCompare(y) * dir;
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
    return rows;
  }

  function _renderList() {
    const root = _root(); if (!root) return;
    const counts = { all: _deals.length }; STATUSES.forEach((s) => (counts[s] = _deals.filter((d) => d.status === s).length));
    const scored = _deals.filter((d) => d.opportunity_score != null);
    const avg = scored.length ? (scored.reduce((a, d) => a + Number(d.opportunity_score), 0) / scored.length).toFixed(1) : '—';
    const pursue = _deals.filter((d) => d.recommendation === 'Pursue').length;
    const thirty = _deals.filter((d) => Date.now() - new Date(d.created_at) < 30 * 864e5).length;
    const rows = _filtered();
    const th = (label, key, cls = '') => `<th class="${cls}" onclick="dtSort('${key}')">${label}${_sort.key === key ? (_sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;

    root.innerHTML = `
      <div class="dt-head">
        <div>
          <h2>Deal Tracking</h2>
          <p>Prospective deals emailed to <b>aiassistant@firstmilecap.com</b> are logged here automatically, matched to the nearest town in Market Research, scored, and the sender gets an opportunity report back. You can also paste a deal below.</p>
        </div>
        <div class="dt-actions">
          <button class="dt-btn" onclick="dtRefresh()">↻ Refresh</button>
          <button class="dt-btn primary" onclick="dtOpenLogModal()">+ Log Deal</button>
        </div>
      </div>
      <div class="dt-kpis">
        <div class="dt-kpi"><div class="v">${_deals.length}</div><div class="l">Deals logged</div></div>
        <div class="dt-kpi"><div class="v">${thirty}</div><div class="l">Last 30 days</div></div>
        <div class="dt-kpi"><div class="v" style="color:#059669">${pursue}</div><div class="l">Recommended pursue</div></div>
        <div class="dt-kpi"><div class="v">${counts.pursuing}</div><div class="l">Actively pursuing</div></div>
        <div class="dt-kpi"><div class="v">${avg}</div><div class="l">Avg. opportunity score</div></div>
      </div>
      <div class="dt-chips">
        <span class="dt-chip ${_filter === 'all' ? 'active' : ''}" onclick="dtFilter('all')">All<b>${counts.all}</b></span>
        ${STATUSES.map((s) => `<span class="dt-chip ${_filter === s ? 'active' : ''}" onclick="dtFilter('${s}')">${STATUS_LABEL[s]}<b>${counts[s]}</b></span>`).join('')}
      </div>
      ${rows.length ? `<table class="dt-table">
        <thead><tr>
          ${th('Deal', 'deal_name')}${th('Asset', 'asset_type')}${th('Price', 'asking_price', 'num')}${th('Cap', 'cap_rate', 'num')}${th('Market match', 'market_name')}${th('Opp. score', 'opportunity_score', 'num')}${th('Rec.', 'recommendation')}${th('Submitted', 'created_at')}${th('Status', 'status')}
        </tr></thead>
        <tbody>${rows.map((d) => `
          <tr class="row" onclick="dtOpen('${d.id}')">
            <td><div class="dt-name">${esc(d.deal_name || d.email_subject || 'Untitled deal')}</div><div class="dt-sub">${esc([d.address, d.city, d.state].filter(Boolean).join(', '))}</div></td>
            <td>${esc(d.asset_type || '—')}${d.sf ? `<div class="dt-sub">${fmtN(d.sf)} SF</div>` : d.units ? `<div class="dt-sub">${fmtN(d.units)} units</div>` : ''}</td>
            <td class="num">${fmt$k(d.asking_price)}${d.price_psf ? `<div class="dt-sub">${fmt$(d.price_psf)}/SF</div>` : ''}</td>
            <td class="num">${d.cap_rate != null ? Number(d.cap_rate).toFixed(2) + '%' : '—'}</td>
            <td>${d.market_name ? `${esc(d.market_name)} <span class="dt-sub" style="display:inline">${d.market_distance_mi != null ? Number(d.market_distance_mi).toFixed(1) + ' mi' : ''}</span><div class="dt-sub">Office ${tierPill(d.market_tier_office)} ${d.market_score_office ?? '—'} &nbsp; Res ${tierPill(d.market_tier_res)} ${d.market_score_res ?? '—'}</div>` : '<span style="color:#94a3b8">no match</span>'}</td>
            <td class="num"><b style="font-size:15px">${d.opportunity_score != null ? Number(d.opportunity_score).toFixed(1) : '—'}</b> ${tierPill(d.opportunity_tier)}<div class="dt-sub">${d.scoring_view || ''} view</div></td>
            <td>${recPill(d.recommendation)}</td>
            <td>${fmtDate(d.created_at)}<div class="dt-sub">${esc(d.submitted_by_name || d.submitted_by || d.source || '')}</div></td>
            <td>${statusSel(d)}</td>
          </tr>`).join('')}</tbody>
      </table>` : `<div class="dt-empty">No deals ${_filter === 'all' ? 'logged yet' : 'with status "' + STATUS_LABEL[_filter] + '"'}.<br><br>Forward a deal email to <b>aiassistant@firstmilecap.com</b> or click <b>+ Log Deal</b>.</div>`}
    `;
  }

  // ── Detail view ──────────────────────────────────────────
  async function _openDeal(id, fromHistory) {
    const root = _root(); if (!root) return;
    root.innerHTML = '<div style="padding:40px;color:#64748b">Loading deal…</div>';
    const d = await _loadOne(id);
    if (!d) { _toast('Deal not found', true); _backToList(); return; }
    _current = d;
    if (!fromHistory && window.pushSubNav) window.pushSubNav('dealtracking', id, 'deal=' + id);
    _renderDetail();
  }

  function _renderDetail() {
    const d = _current, root = _root(); if (!d || !root) return;
    const a = d.assessment || {};
    root.innerHTML = `
      <button class="dt-back" onclick="dtBack()">← Back to Deal Tracking</button>
      <div class="dt-detail-head">
        <div>
          <h2>${esc(d.deal_name || d.email_subject || 'Untitled deal')}</h2>
          <div class="dt-meta">${esc([d.address, d.city, d.state, d.zip].filter(Boolean).join(', ') || 'No address')} · ${esc(d.asset_type || '—')} · ${esc(d.deal_type || '—')}</div>
          <div class="dt-meta" style="margin-top:4px">Submitted ${fmtDate(d.created_at)} by ${esc(d.submitted_by_name || d.submitted_by || d.source)}${d.email_subject ? ` · <i>${esc(d.email_subject)}</i>` : ''}${d.replied_at ? ' · report emailed' : ''}</div>
          <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            ${recPill(d.recommendation)}
            <span><b style="font-size:18px">${d.opportunity_score != null ? Number(d.opportunity_score).toFixed(1) : '—'}</b> <span style="color:#64748b">/ 10</span> ${tierPill(d.opportunity_tier)} <span class="dt-meta">${d.scoring_view || ''} view</span></span>
            ${d.market_id ? `<a href="#marketresearch&market=${d.market_id}" style="color:#0ea5e9;font-size:13.5px">📍 ${esc(d.market_name)} in Market Research ↗</a>` : ''}
          </div>
        </div>
        <div class="dt-actions" style="align-items:flex-start">
          ${statusSel(d)}
          <button class="dt-btn" id="dtRescoreBtn" onclick="dtRescore('${d.id}', false)" title="Re-run market match + assessment using the stored deal facts">↻ Re-score</button>
          <button class="dt-btn" onclick="dtRescore('${d.id}', true)" title="Re-extract facts from the original text, then re-score">↻ Re-extract</button>
          <button class="dt-btn" onclick="dtEmailReport('${d.id}')">✉ Email report</button>
          <button class="dt-btn" onclick="dtDelete('${d.id}')" style="color:#b91c1c">Delete</button>
        </div>
      </div>
      <div class="dt-report">${d.report_html || `<p style="color:#64748b">No report generated yet.${a.summary ? ' ' + esc(a.summary) : ''}</p>`}</div>
      <details class="dt-raw"><summary style="cursor:pointer;font-weight:600">Notes</summary>
        <textarea class="dt-notes" placeholder="Internal notes (saved on blur)…" onblur="dtSaveNotes('${d.id}', this.value)">${esc(d.notes || '')}</textarea>
      </details>
      <details class="dt-raw"><summary style="cursor:pointer;font-weight:600">Original submission</summary><pre>${esc(d.raw_text || '(none)')}</pre></details>
      <details class="dt-raw"><summary style="cursor:pointer;font-weight:600">Extracted facts (JSON)</summary><pre>${esc(JSON.stringify(d.extracted || {}, null, 2))}</pre></details>
    `;
  }

  function _backToList(fromHistory) {
    _current = null;
    if (!fromHistory && window.subNavBack) { if (window.subNavBack('dealtracking')) return; }
    if (window.replaceSubNav) window.replaceSubNav('dealtracking');
    _renderList();
  }

  // ── Log Deal modal ───────────────────────────────────────
  function _openLogModal() {
    const u = window.currentUser || {};
    const ov = document.createElement('div'); ov.className = 'dt-overlay'; ov.id = 'dtLogOverlay';
    ov.innerHTML = `<div class="dt-modal">
      <h3>Log a prospective deal</h3>
      <p>Paste the broker email, OM summary, or your own notes. Claude extracts the facts, matches the nearest researched town, scores it and writes the report — same as emailing aiassistant@.</p>
      <div class="row"><input id="dtLogSubject" placeholder="Subject / deal name (optional)"><input id="dtLogFrom" placeholder="Submitted by" value="${esc(u.email || '')}"></div>
      <textarea id="dtLogText" placeholder="e.g. JLL is marketing 1 & 25 Deforest Ave, Summit NJ — 287,400 SF two-building Class A office, 91% leased, T12 NOI $7.7M, guidance $100M…"></textarea>
      <div class="foot"><button class="dt-btn" onclick="dtCloseLogModal()">Cancel</button><button class="dt-btn primary" id="dtLogGo" onclick="dtSubmitLog()">Score it</button></div>
    </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) _closeLogModal(); });
    document.body.appendChild(ov);
    setTimeout(() => document.getElementById('dtLogText')?.focus(), 50);
  }
  function _closeLogModal() { document.getElementById('dtLogOverlay')?.remove(); }
  async function _submitLog() {
    const text = document.getElementById('dtLogText').value.trim();
    if (text.length < 20) { _toast('Paste more detail about the deal first', true); return; }
    const btn = document.getElementById('dtLogGo'); btn.disabled = true; btn.innerHTML = '<span class="dt-spin"></span>Scoring… (~30s)';
    try {
      const u = window.currentUser || {};
      const r = await _callIntake({ text, subject: document.getElementById('dtLogSubject').value.trim() || null, from: document.getElementById('dtLogFrom').value.trim() || u.email || null, from_name: u.name || null, source: 'manual', force: true });
      _closeLogModal();
      await _load();
      if (r.deal_id) _openDeal(r.deal_id); else _renderList();
      _toast('Deal logged and scored');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Score it';
      _toast('Intake failed: ' + e.message, true);
    }
  }

  // ── Actions ──────────────────────────────────────────────
  async function _setStatus(id, status) {
    try {
      await window.supaWrite('deal_tracking', 'PATCH', { status, updated_at: new Date().toISOString() }, `?id=eq.${id}`);
      const d = _deals.find((x) => x.id === id); if (d) d.status = status;
      if (_current && _current.id === id) { _current.status = status; _renderDetail(); } else _renderList();
      _toast('Status → ' + STATUS_LABEL[status]);
    } catch (e) { _toast('Failed: ' + e.message, true); }
  }
  async function _saveNotes(id, notes) {
    try { await window.supaWrite('deal_tracking', 'PATCH', { notes, updated_at: new Date().toISOString() }, `?id=eq.${id}`); if (_current) _current.notes = notes; } catch (e) { _toast('Failed to save notes: ' + e.message, true); }
  }
  async function _rescore(id, reextract) {
    const btn = document.getElementById('dtRescoreBtn'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="dt-spin" style="border-color:rgba(0,0,0,.2);border-top-color:#0ea5e9"></span>Scoring…'; }
    try {
      await _callIntake({ dealId: id, reextract: !!reextract });
      await _load();
      _current = await _loadOne(id); _renderDetail();
      _toast(reextract ? 'Re-extracted and re-scored' : 'Re-scored');
    } catch (e) { _toast('Re-score failed: ' + e.message, true); if (btn) { btn.disabled = false; btn.textContent = '↻ Re-score'; } }
  }
  async function _emailReport(id) {
    const d = _current && _current.id === id ? _current : await _loadOne(id);
    if (!d?.report_html) { _toast('No report to send', true); return; }
    const u = window.currentUser || {};
    const to = prompt('Send the opportunity report to (comma-separated emails):', d.submitted_by || u.email || '');
    if (!to) return;
    const sig = `<p>Thank you,<br>First Mile AI Assistant</p><p>362 Fifth Avenue, 9th Floor<br>New York, NY 10001<br>(201) 549-9232 (text enabled)<br><a href="https://firstmilecap.com">FirstMileCap.com</a></p><img src="https://admin.firstmilecap.com/assets/First_Mile_Capital_Logo_RGB.png" alt="First Mile Capital" style="width:200px;margin-top:8px;">`;
    try {
      const r = await fetch(`${window.SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + window.SUPABASE_KEY, apikey: window.SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.split(',').map((s) => s.trim()).filter(Boolean), subject: `Opportunity Report — ${d.deal_name || 'Prospective deal'}`, body: `<p>Opportunity report for <b>${esc(d.deal_name || '')}</b>, requested by ${esc(u.name || u.email || 'the team')}.</p>` + d.report_html + '<br>' + sig, bodyType: 'HTML', sentBy: u.email || 'deal-tracking' }),
      });
      if (!r.ok) throw new Error(await r.text());
      await window.supaWrite('deal_tracking', 'PATCH', { replied_at: new Date().toISOString() }, `?id=eq.${id}`);
      _toast('Report emailed to ' + to);
    } catch (e) { _toast('Send failed: ' + e.message, true); }
  }
  async function _delete(id) {
    if (!confirm('Delete this deal from Deal Tracking? This cannot be undone.')) return;
    try { await window.supaWrite('deal_tracking', 'DELETE', null, `?id=eq.${id}`); await _load(); _backToList(); _toast('Deal deleted'); } catch (e) { _toast('Delete failed: ' + e.message, true); }
  }

  // ── Public API ───────────────────────────────────────────
  window.dtOpen = (id) => _openDeal(id);
  window.dtBack = () => _backToList();
  window.dtFilter = (f) => { _filter = f; _renderList(); };
  window.dtSort = (k) => { if (_sort.key === k) _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc'; else _sort = { key: k, dir: k === 'deal_name' || k === 'market_name' || k === 'asset_type' ? 'asc' : 'desc' }; _renderList(); };
  window.dtRefresh = async () => { try { await _load(); _current ? (_current = await _loadOne(_current.id), _renderDetail()) : _renderList(); _toast('Refreshed'); } catch (e) { _toast(e.message, true); } };
  window.dtSetStatus = _setStatus;
  window.dtSaveNotes = _saveNotes;
  window.dtRescore = _rescore;
  window.dtEmailReport = _emailReport;
  window.dtDelete = _delete;
  window.dtOpenLogModal = _openLogModal;
  window.dtCloseLogModal = _closeLogModal;
  window.dtSubmitLog = _submitLog;

  window.dealTrackingInit = async function () {
    _injectCSS();
    const root = _root(); if (!root) return;
    if (!_inited) {
      _inited = true;
      if (window.registerSubNav) window.registerSubNav('dealtracking', (sub) => { if (sub) _openDeal(sub, true); else _backToList(true); });
    }
    root.innerHTML = '<div style="padding:40px;color:#64748b">Loading deals…</div>';
    try {
      await _load();
      const deep = window.getHashParam && window.getHashParam('deal');
      if (deep) { _openDeal(deep, true); return; }
      if (_current) { _current = await _loadOne(_current.id); if (_current) { _renderDetail(); return; } }
      _renderList();
    } catch (e) {
      root.innerHTML = `<div class="dt-empty">Could not load Deal Tracking: ${esc(e.message)}<br><br><small>Has <code>migration/create-deal-tracking.sql</code> been run?</small></div>`;
    }
  };
})();
