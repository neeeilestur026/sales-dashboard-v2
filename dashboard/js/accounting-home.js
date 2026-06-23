/* ═══════════════════════════════════════════════
   accounting-home.js — Accounting Home page logic
   ═══════════════════════════════════════════════ */

function _acctEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

document.addEventListener('DOMContentLoaded', () => {
  const session = requireAccounting();
  if (!session) return;

  renderNavbar('accounting-home');
  document.getElementById('greeting').innerHTML = getGreeting(session.name);

  // Set app links
  setAppLink('mroLink', '/mro');
  setAppLink('miLink', '/mi');
  setAppLink('inventoryLink', 'flow-inventory.html');

  // Load shipments
  fetchFromAPI({ action: 'getShipments' }, { noCache: true })
    .then(r => _acctSmRenderList(r))
    .catch(() => _acctSmRenderList(null));
});

function setAppLink(elementId, url) {
  const el = document.getElementById(elementId);
  if (!el) return;

  if (url && url !== 'undefined' && url !== '') {
    el.href = url;
  } else {
    el.removeAttribute('href');
    el.classList.add('btn-secondary');
    el.classList.remove('btn-primary');
    el.textContent = 'Not Configured';
    el.style.pointerEvents = 'none';
  }
}

// ═══════════════════════════════════════════════
// Shipment Monitoring (read-only)
// ═══════════════════════════════════════════════

let _acctSmAll = [];

function _acctSmRenderList(result) {
  const container = document.getElementById('acctSmContainer');
  if (!result || !result.success) {
    container.innerHTML = '<div style="padding:1rem;color:#ef4444;">Could not load shipments.</div>';
    document.getElementById('acctSmSummary').textContent = 'Error loading';
    return;
  }
  _acctSmAll = result.data || [];

  const total     = _acctSmAll.length;
  const inTransit = _acctSmAll.filter(s => s.status === 'In Transit').length;
  const arrived   = _acctSmAll.filter(s => s.status === 'Arrived').length;
  document.getElementById('acctSmSummary').textContent =
    total + ' shipments · ' + inTransit + ' in transit · ' + arrived + ' arrived';

  _acctSmRender('All');
}

function acctSmFilter(status, btn) {
  document.querySelectorAll('.sm-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _acctSmRender(status);
}

function _acctSmRender(filter) {
  const container = document.getElementById('acctSmContainer');
  const rows = filter === 'All' ? _acctSmAll : _acctSmAll.filter(s => s.status === filter);

  if (!rows.length) {
    container.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text-muted,#64748b);">No shipments found.</div>';
    return;
  }

  const statusColor = { Pending: '#f59e0b', 'In Transit': '#3b82f6', Arrived: '#22c55e', Delivered: '#8b5cf6', Cancelled: '#ef4444' };

  container.innerHTML = rows.map((s, idx) => {
    const color = statusColor[s.status] || '#64748b';
    const docsObj = _acctSmParseDocs(s.documents);
    const docCount = Object.values(docsObj).reduce((n, arr) => n + arr.length, 0);
    return `<div class="sm-row" onclick="_acctSmOpenDetail(${idx})">
      <div class="sm-row-left">
        <div class="sm-row-po">
          ${_acctEsc(s.poNo || '—')}
          <span style="margin-left:0.4rem;font-size:0.7rem;font-weight:600;padding:0.1rem 0.5rem;border-radius:10px;background:${color}22;color:${color};border:1px solid ${color}44;">${_acctEsc(s.status)}</span>
        </div>
        <div class="sm-row-sub">${_acctEsc(s.principal || '')}${s.item ? ' · ' + s.item : ''}${s.eta ? ' · ETA: ' + s.eta : ''}</div>
      </div>
      <div class="sm-row-right">
        ${docCount > 0 ? `<span style="font-size:0.7rem;color:var(--text-muted,#64748b);">📎 ${docCount} doc${docCount !== 1 ? 's' : ''}</span>` : ''}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text-muted,#64748b);"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
  }).join('');
}

function _acctSmParseDocs(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch(e) { return {}; }
}

function _acctSmGetFilteredRows() {
  const active = document.querySelector('#acctSmBody .sm-filter-btn.active');
  const filter = active ? active.textContent.trim() : 'All';
  return filter === 'All' ? _acctSmAll : _acctSmAll.filter(s => s.status === filter);
}

// ── Timeline Detail ──────────────────────────────────────────

let _acctSmTlData         = null;
let _acctSmTlCurrentStage = '';
let _acctSmTlOpenPhases   = new Set();

async function _acctSmOpenDetail(idx) {
  const s = _acctSmGetFilteredRows()[idx];
  if (!s) return;

  _acctSmTlData         = null;
  _acctSmTlCurrentStage = '';
  _acctSmTlOpenPhases   = new Set();

  const statusColor = { Pending: '#f59e0b', 'In Transit': '#3b82f6', Arrived: '#22c55e', Delivered: '#8b5cf6', Cancelled: '#ef4444' };
  const color = statusColor[s.status] || '#64748b';
  const badgeHtml = `<span style="font-size:0.72rem;font-weight:600;padding:0.1rem 0.5rem;border-radius:10px;background:${color}22;color:${color};border:1px solid ${color}44;">${_acctEsc(s.status)}</span>`;

  document.getElementById('acctSmTlHeader').textContent    = s.shipmentId || s.poNo || '—';
  document.getElementById('acctSmTlSubtitle').textContent  = `PO ${s.poNo || '—'} · ${s.client || '—'}`;
  document.getElementById('acctSmTlStatusBadge').innerHTML = badgeHtml;
  document.getElementById('acctSmTlContent').innerHTML     = '<div style="padding:3rem;text-align:center;">Loading…</div>';
  document.getElementById('acctSmTlRibbon').innerHTML      = '<div style="height:52px;"></div>';
  document.getElementById('acctSmOverlay').style.display   = 'block';

  try {
    const r = await fetchFromAPI({ action: 'getShipmentTimeline', shipmentId: s.shipmentId });
    if (r && r.success) {
      _acctSmTlData = r;
      const apiMap = {};
      r.timeline.forEach(st => { apiMap[st.key] = st; });
      let activated = false;
      for (let pi = 0; pi < _SM_PHASES.length; pi++) {
        if (_SM_PHASES[pi].stages.some(k => !['done','skipped'].includes((apiMap[k] || {}).status))) {
          _acctSmTlOpenPhases.add(pi); activated = true; break;
        }
      }
      if (!activated) _acctSmTlOpenPhases.add(_SM_PHASES.length - 1);
      _acctSmTlRender();
    } else {
      document.getElementById('acctSmTlContent').innerHTML =
        `<div style="padding:2rem;text-align:center;color:#ef4444;">${_acctEsc((r && r.message) || 'Failed to load timeline.')}</div>`;
    }
  } catch (err) {
    document.getElementById('acctSmTlContent').innerHTML =
      `<div style="padding:2rem;text-align:center;color:#ef4444;">Error: ${_acctEsc(err.message)}</div>`;
  }
}

function acctSmClose() {
  document.getElementById('acctSmOverlay').style.display = 'none';
  _acctSmTlData = null; _acctSmTlCurrentStage = ''; _acctSmTlOpenPhases = new Set();
}

function _acctSmTlRender() {
  if (!_acctSmTlData || !_acctSmTlData.timeline) return;

  const apiMap = {};
  _acctSmTlData.timeline.forEach(st => { apiMap[st.key] = st; });

  let nextKey = null;
  for (const def of _SM_LIFECYCLE_STAGES) {
    if (!['done','skipped'].includes((apiMap[def.key] || {}).status)) { nextKey = def.key; break; }
  }

  document.getElementById('acctSmTlRibbon').innerHTML = _acctSmTlRenderRibbon(apiMap);

  let html = _acctSmTlRenderNextUp(apiMap, nextKey);

  _SM_PHASES.forEach((phase, pi) => {
    const phaseDefs    = _SM_LIFECYCLE_STAGES.filter(def => phase.stages.includes(def.key));
    const phaseDone    = phaseDefs.filter(def => (apiMap[def.key] || {}).status === 'done').length;
    const phaseSkipped = phaseDefs.filter(def => (apiMap[def.key] || {}).status === 'skipped').length;
    const phaseTotal   = phaseDefs.length;
    const allComplete  = (phaseDone + phaseSkipped) === phaseTotal;
    const anyDone      = (phaseDone + phaseSkipped) > 0;
    const isOpen       = _acctSmTlOpenPhases.has(pi);

    const hdrState = allComplete ? 'done' : isOpen ? 'open' : anyDone ? 'partial' : 'pending';
    const cntColor = allComplete ? '#22c55e' : anyDone ? '#f59e0b' : 'var(--text-muted,#64748b)';
    const lblColor = allComplete ? 'var(--text-primary,#f1f5f9)' : 'var(--text-secondary,#94a3b8)';
    const numBg    = allComplete ? 'rgba(34,197,94,0.15)' : '#e2e8f0';
    const numBorder= allComplete ? 'rgba(34,197,94,0.5)' : '#e2e8f0';

    html += `<div class="sm-tl-phase-wrap" id="acctSmPhase${pi}">
      <div class="sm-tl-phase-hdr ${hdrState}" onclick="_acctSmTlTogglePhase(${pi})" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter'||event.key===' ')_acctSmTlTogglePhase(${pi})">
        <div class="sm-tl-phase-left">
          <div class="sm-tl-phase-num" style="background:${numBg};color:${cntColor};border:1px solid ${numBorder};">
            ${allComplete ? '✓' : _SM_PHASE_ICONS[pi]}
          </div>
          <span class="sm-tl-phase-name" style="color:${lblColor};">Phase ${pi + 1}: ${_acctEsc(phase.name)}</span>
        </div>
        <div class="sm-tl-phase-right">
          <span class="sm-tl-phase-cnt" style="color:${cntColor};">${phaseDone}/${phaseTotal}</span>
          <span class="sm-tl-phase-chevron">${isOpen ? '▾' : '▸'}</span>
        </div>
      </div>`;

    if (isOpen) {
      const bodyState = allComplete ? 'done' : anyDone ? 'partial' : '';
      html += `<div class="sm-tl-phase-body ${bodyState}">`;
      phaseDefs.forEach(def => {
        html += _acctSmTlRenderStageRow(def, apiMap[def.key] || { status: 'pending', docs: [] }, nextKey, apiMap);
      });
      html += '</div>';
    }
    html += '</div>';
  });

  document.getElementById('acctSmTlContent').innerHTML = html;
}

function _acctSmTlTogglePhase(pi) {
  if (_acctSmTlOpenPhases.has(pi)) _acctSmTlOpenPhases.delete(pi); else _acctSmTlOpenPhases.add(pi);
  _acctSmTlRender();
}

function _acctSmTlToggleStage(key) {
  _acctSmTlCurrentStage = (_acctSmTlCurrentStage === key) ? '' : key;
  _acctSmTlRender();
}

function _acctSmTlScrollToPhase(pi) {
  _acctSmTlOpenPhases.add(pi);
  _acctSmTlRender();
  const el = document.getElementById('acctSmPhase' + pi);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _acctSmTlScrollToStage(key) {
  const pi = _SM_PHASES.findIndex(p => p.stages.includes(key));
  if (pi >= 0) _acctSmTlOpenPhases.add(pi);
  _acctSmTlCurrentStage = key;
  _acctSmTlRender();
  const el = document.getElementById('acctSmCard_' + key);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _acctSmTlRenderRibbon(apiMap) {
  const total     = _SM_LIFECYCLE_STAGES.length;
  const totalDone = _SM_LIFECYCLE_STAGES.filter(d => ['done','skipped'].includes((apiMap[d.key]||{}).status)).length;

  let html = '<div class="sm-tl-ribbon" role="tablist">';
  _SM_PHASES.forEach((phase, pi) => {
    const defs    = _SM_LIFECYCLE_STAGES.filter(d => phase.stages.includes(d.key));
    const done    = defs.filter(d => ['done','skipped'].includes((apiMap[d.key]||{}).status)).length;
    const allDone = done === defs.length;
    const partial = done > 0 && !allDone;
    const pct     = Math.round(done / defs.length * 100);
    const cls     = allDone ? 'done' : partial ? 'partial' : '';
    html += `<button class="sm-tl-ribbon-seg ${cls}" onclick="_acctSmTlScrollToPhase(${pi})" role="tab" tabindex="0"
      title="Phase ${pi+1}: ${_acctEsc(phase.name)} — ${done}/${defs.length}">
      <div class="sm-tl-ribbon-fill" style="width:${pct}%"></div>
      <span class="sm-tl-ribbon-icon">${_SM_PHASE_ICONS[pi]}</span>
      <span class="sm-tl-ribbon-label">${_acctEsc(phase.name)}</span>
      <span class="sm-tl-ribbon-count">${done}/${defs.length}</span>
    </button>`;
  });
  html += '</div>';
  html += `<div class="sm-tl-ribbon-overall">${totalDone} / ${total} stages complete</div>`;
  return html;
}

function _acctSmTlRenderNextUp(apiMap, nextKey) {
  if (!nextKey) {
    return `<div class="sm-tl-next-up done">
      <div class="sm-tl-next-up-icon">🎉</div>
      <div class="sm-tl-next-up-body">
        <div class="sm-tl-next-up-kicker">All complete</div>
        <div class="sm-tl-next-up-stage"><strong>All 21 stages done!</strong></div>
        <div class="sm-tl-next-up-sub">This shipment has completed all lifecycle stages.</div>
      </div>
    </div>`;
  }
  const def  = _SM_LIFECYCLE_STAGES.find(d => d.key === nextKey);
  if (!def) return '';
  const meta     = (_SM_STAGE_META && _SM_STAGE_META[nextKey]) || {};
  const requires = meta.requires || [];
  const blocked  = requires.some(rk => !['done','skipped'].includes((apiMap[rk]||{}).status));
  const phaseIdx = _SM_PHASES.findIndex(p => p.stages.includes(nextKey));
  const phaseLabel = phaseIdx >= 0 ? `Phase ${phaseIdx+1}: ${_SM_PHASES[phaseIdx].name}` : '';
  const ownerCls = _SM_OWNER_BADGE_CLASS[def.owner] || 'sm-owner-admin';
  const icon   = blocked ? '⚠️' : '➡️';
  const cls    = blocked ? 'blocked' : '';
  const kicker = blocked ? 'Waiting on prerequisites' : 'Next up';
  return `<div class="sm-tl-next-up ${cls}" role="status">
    <div class="sm-tl-next-up-icon">${icon}</div>
    <div class="sm-tl-next-up-body">
      <div class="sm-tl-next-up-kicker">${kicker}</div>
      <div class="sm-tl-next-up-stage">
        <strong>${_acctEsc(def.label)}</strong>
        <span class="sm-owner-badge ${ownerCls}">${_acctEsc(def.owner)}</span>
        ${def.autoDerive ? '<span class="auto-badge">AUTO</span>' : ''}
      </div>
      <div class="sm-tl-next-up-sub">${phaseLabel}${blocked ? ' — prerequisites not yet met (advisory)' : ''}</div>
    </div>
  </div>`;
}

function _acctSmTlRenderStageRow(def, apiStage, nextKey, apiMap) {
  const status    = apiStage.status || 'pending';
  const isAuto    = apiStage.autoderived || false;
  const docs      = apiStage.docs || [];
  const isOpen    = _acctSmTlCurrentStage === def.key;
  const globalIdx = _SM_LIFECYCLE_STAGES.indexOf(def);
  const meta      = (_SM_STAGE_META && _SM_STAGE_META[def.key]) || {};
  const requires  = meta.requires || [];
  const isBlocked = status === 'pending' && requires.some(rk => !['done','skipped'].includes((apiMap[rk]||{}).status));
  const isNext    = def.key === nextKey;

  let cardState, dotState;
  if (status === 'done')         { cardState = 'done';    dotState = 'done';    }
  else if (status === 'skipped') { cardState = 'skipped'; dotState = 'skipped'; }
  else if (isBlocked)            { cardState = 'blocked'; dotState = 'blocked'; }
  else if (isNext)               { cardState = 'next';    dotState = 'next';    }
  else                           { cardState = 'pending'; dotState = 'pending'; }

  const dotContent = status === 'done' ? '✓' : status === 'skipped' ? '–' : isBlocked ? '!' : (globalIdx + 1);
  const dateNote   = status !== 'pending' && apiStage.completedAt
    ? `${_acctEsc(apiStage.completedAt)}${apiStage.completedBy ? ' · ' + _acctEsc(apiStage.completedBy) : ''}` : '';
  const skipReason = status === 'skipped' && apiStage.skippedReason ? apiStage.skippedReason : '';
  const ownerCls   = _SM_OWNER_BADGE_CLASS[def.owner] || 'sm-owner-admin';

  return `<div class="sm-tl-card ${cardState}${isOpen ? ' open' : ''}" id="acctSmCard_${def.key}">
    <div class="sm-tl-card-hdr" onclick="_acctSmTlToggleStage('${def.key}')" role="button" tabindex="0"
         onkeydown="if(event.key==='Enter'||event.key===' ')_acctSmTlToggleStage('${def.key}')">
      <div class="sm-tl-card-dot ${dotState}">${dotContent}</div>
      <div class="sm-tl-card-main">
        <div class="sm-tl-card-label">${_acctEsc(def.label)}</div>
        <div class="sm-tl-card-meta">
          <span class="sm-owner-badge ${ownerCls}">${_acctEsc(def.owner)}</span>
          ${isAuto ? '<span class="auto-badge">AUTO</span>' : ''}
          ${skipReason ? `<span style="color:#f59e0b;font-style:italic;font-size:0.64rem;">– ${_acctEsc(skipReason)}</span>` : ''}
        </div>
        ${dateNote ? `<div class="sm-tl-card-date">${dateNote}</div>` : ''}
      </div>
      <div class="sm-tl-card-right">
        ${docs.length > 0 ? `<span class="doc-badge">${docs.length}</span>` : ''}
        ${isBlocked ? '<span class="blocked-icon" title="Prerequisites not yet met">⚠</span>' : ''}
        <span style="font-size:0.7rem;color:var(--text-muted,#64748b);">${isOpen ? '▾' : '▸'}</span>
      </div>
    </div>
    ${isOpen ? `<div class="sm-tl-detail">${_acctSmTlStageDetail(def, apiStage, apiMap)}</div>` : ''}
  </div>`;
}

function _acctSmTlStageDetail(def, apiStage, apiMap) {
  const status = apiStage.status || 'pending';
  const docs   = apiStage.docs   || [];
  const isAuto = apiStage.autoderived || false;
  const meta   = (_SM_STAGE_META && _SM_STAGE_META[def.key]) || {};
  const ship   = (_acctSmTlData && _acctSmTlData.shipment) || {};
  let html = '';

  if (meta.description) {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">About this stage</div>
      <div style="font-size:0.76rem;color:var(--text-secondary,#94a3b8);line-height:1.5;">${_acctEsc(meta.description)}</div>
      ${isAuto && apiStage.autoderivedNote ? `<div style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem;"><span class="auto-badge">AUTO</span><span style="font-size:0.7rem;color:var(--text-muted,#64748b);">${_acctEsc(apiStage.autoderivedNote)}</span></div>` : ''}
    </div>`;
  }

  if (status === 'skipped' && apiStage.skippedReason) {
    html += `<div class="sm-tl-detail-section">
      <div style="font-size:0.76rem;color:#f59e0b;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25);border-radius:5px;padding:0.4rem 0.6rem;">
        <strong>Skip reason:</strong> ${_acctEsc(apiStage.skippedReason)}
      </div>
    </div>`;
  }

  if (meta.fields && meta.fields.length > 0) {
    html += `<div class="sm-tl-detail-section"><div class="sm-tl-section-label">Fields at this stage</div><table class="sm-tl-fields">`;
    meta.fields.forEach(f => {
      let val = ship[f.field];
      if (val === undefined || val === null || val === '') val = ship[f.field.replace(/([A-Z])/g, '_$1').toLowerCase()];
      const hasVal = val !== undefined && val !== null && String(val).trim() !== '';
      let displayVal = hasVal ? _acctEsc(String(val)) : '';
      if (hasVal && f.format === 'currency' && !isNaN(parseFloat(val))) {
        displayVal = '₱ ' + parseFloat(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      html += `<tr><td class="fl">${_acctEsc(f.label)}</td><td class="${hasVal ? 'fv' : 'fv empty'}">${hasVal ? displayVal : '— not yet set —'}</td></tr>`;
    });
    html += '</table></div>';
  }

  const requires = meta.requires || [];
  const unlocks  = meta.unlocks  || [];
  if (requires.length > 0 || unlocks.length > 0) {
    html += `<div class="sm-tl-detail-section"><div class="sm-tl-section-label">Stage dependencies <span style="font-size:0.6rem;font-weight:400;font-style:italic;text-transform:none;letter-spacing:0;">(advisory)</span></div><div class="sm-dep-chips">`;
    requires.forEach(rk => {
      const rDef = _SM_LIFECYCLE_STAGES.find(d => d.key === rk);
      if (!rDef) return;
      const rSt = (apiMap[rk] || {}).status || 'pending';
      const cls  = rSt === 'done' ? 'done' : rSt === 'skipped' ? 'skipped' : 'blocked';
      const icon = rSt === 'done' ? '✓' : rSt === 'skipped' ? '–' : '○';
      html += `<span class="sm-dep-chip ${cls}" onclick="_acctSmTlScrollToStage('${rk}')" tabindex="0" role="button" onkeydown="if(event.key==='Enter')_acctSmTlScrollToStage('${rk}')">${icon} ${_acctEsc(rDef.label)}</span>`;
    });
    if (unlocks.length > 0) {
      if (requires.length > 0) html += `<span style="font-size:0.65rem;color:var(--text-muted,#64748b);align-self:center;">→ unlocks:</span>`;
      unlocks.forEach(uk => {
        const uDef = _SM_LIFECYCLE_STAGES.find(d => d.key === uk);
        if (!uDef) return;
        const uSt = (apiMap[uk] || {}).status || 'pending';
        const cls = uSt === 'done' ? 'done' : uSt === 'skipped' ? 'skipped' : '';
        html += `<span class="sm-dep-chip ${cls}" onclick="_acctSmTlScrollToStage('${uk}')" tabindex="0" role="button" onkeydown="if(event.key==='Enter')_acctSmTlScrollToStage('${uk}')">↓ ${_acctEsc(uDef.label)}</span>`;
      });
    }
    html += '</div></div>';
  }

  html += `<div class="sm-tl-detail-section"><div class="sm-tl-section-label">Documents${def.docLabel ? ` <span style="font-size:0.6rem;font-weight:400;font-style:italic;text-transform:none;letter-spacing:0;">· Expected: ${_acctEsc(def.docLabel)}</span>` : ''}</div>`;
  if (docs.length) {
    html += '<div>';
    docs.forEach(f => {
      const viewUrl  = f.url || f.driveUrl || '';
      const thumbUrl = f.thumbnailUrl || f.previewUrl || '';
      const thumbImg = thumbUrl
        ? `<img src="${_acctEsc(thumbUrl)}" class="sm-mgmt-doc-thumb" onclick="acctOpenDocViewer('${_acctEsc(f.name)}','${_acctEsc(viewUrl)}')" alt="Preview">`
        : `<div class="sm-mgmt-doc-thumb" onclick="acctOpenDocViewer('${_acctEsc(f.name)}','${_acctEsc(viewUrl)}')" style="display:flex;align-items:center;justify-content:center;cursor:pointer;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`;
      html += `<div class="sm-mgmt-doc-file">${thumbImg}<span class="sm-mgmt-doc-name" title="${_acctEsc(f.name)}">${_acctEsc(f.name)}</span><button class="sm-mgmt-doc-btn" onclick="acctOpenDocViewer('${_acctEsc(f.name)}','${_acctEsc(viewUrl)}')">View ↗</button></div>`;
    });
    html += '</div>';
  } else {
    html += `<div style="font-size:0.73rem;color:var(--text-muted,#64748b);">No documents attached.</div>`;
  }
  html += '</div>';

  if (status !== 'pending') {
    html += `<div class="sm-tl-detail-section"><div class="sm-tl-section-label">Activity</div><div style="font-size:0.73rem;color:var(--text-secondary,#94a3b8);line-height:1.55;">`;
    if (apiStage.completedAt || apiStage.completedBy) {
      const verb = status === 'skipped' ? 'Skipped' : 'Completed';
      html += `<div>• ${verb}${apiStage.completedAt ? ' on <strong>' + _acctEsc(apiStage.completedAt) + '</strong>' : ''}${apiStage.completedBy ? ' by <strong>' + _acctEsc(apiStage.completedBy) + '</strong>' : ''}</div>`;
    }
    if (apiStage.notes) {
      html += `<div style="margin-top:0.25rem;padding:0.35rem 0.5rem;background:#f8fafc;border-radius:4px;border:1px solid #e2e8f0;">${_acctEsc(apiStage.notes)}</div>`;
    }
    html += '</div></div>';
  }

  return html;
}
