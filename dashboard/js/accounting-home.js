/* ═══════════════════════════════════════════════
   accounting-home.js — Accounting Home page logic
   ═══════════════════════════════════════════════ */

function _acctEsc(s) { return hxEscBlank(s); }

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

function _acctSmBadge(status) { return hxSmBadge(status); }

function _acctSmRenderList(result) {
  const container = document.getElementById('acctSmContainer');
  if (!result || !result.success) {
    container.innerHTML = '<div class="hx-error">Could not load shipments.</div>';
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
  _acctSmRenderRecent();
}

// Comp summary card: the most-recent few shipments, display-only (the full interactive
// list with the timeline lives in the section below).
function _acctSmRenderRecent() {
  const el = document.getElementById('acctSmRecent');
  if (!el) return;
  const rows = _acctSmAll.slice(0, 4);
  if (!rows.length) { el.innerHTML = '<div class="hx-empty">No shipments yet.</div>'; return; }
  el.innerHTML = rows.map(s => {
    const sub = [s.principal, s.mode, (s.eta ? 'ETA ' + s.eta : '')].filter(Boolean).join(', ');
    return `<div class="sm-mini">
      <div>
        <div class="po">${_acctEsc(s.poNo || '—')}</div>
        <div class="sub">${_acctEsc(sub)}</div>
      </div>
      ${_acctSmBadge(s.status)}
    </div>`;
  }).join('');
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
    container.innerHTML = '<div class="hx-empty">No shipments found.</div>';
    return;
  }

  container.innerHTML = rows.map((s, idx) => {
    const docsObj = _acctSmParseDocs(s.documents);
    const docCount = Object.values(docsObj).reduce((n, arr) => n + arr.length, 0);
    return `<div class="sm-row" onclick="_acctSmOpenDetail(${idx})">
      <div class="sm-row-left">
        <div class="sm-row-po">
          ${_acctEsc(s.poNo || '—')}
          ${_acctSmBadge(s.status)}
        </div>
        <div class="sm-row-sub">${_acctEsc(s.principal || '')}${s.item ? ', ' + _acctEsc(s.item) : ''}${s.eta ? ', ETA ' + _acctEsc(s.eta) : ''}</div>
      </div>
      <div class="sm-row-right">
        ${docCount > 0 ? `<span>${docCount} doc${docCount !== 1 ? 's' : ''}</span>` : ''}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
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

  const badgeHtml = _acctSmBadge(s.status);

  document.getElementById('acctSmTlHeader').textContent    = s.shipmentId || s.poNo || '—';
  document.getElementById('acctSmTlSubtitle').textContent  = `PO ${s.poNo || '—'} · ${s.client || '—'}`;
  document.getElementById('acctSmTlStatusBadge').innerHTML = badgeHtml;
  document.getElementById('acctSmTlContent').innerHTML     = '<div class="sm-loading">Loading…</div>';
  document.getElementById('acctSmTlRibbon').innerHTML      = '<div class="sm-tl-ribbon-ph"></div>';
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
        `<div style="padding:2rem;text-align:center;color:var(--hx-red);">${_acctEsc((r && r.message) || 'Failed to load timeline.')}</div>`;
    }
  } catch (err) {
    document.getElementById('acctSmTlContent').innerHTML =
      `<div style="padding:2rem;text-align:center;color:var(--hx-red);">Error: ${_acctEsc(err.message)}</div>`;
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
    const cntColor = allComplete ? 'var(--hx-ok)' : anyDone ? 'var(--hx-warn)' : 'var(--hx-ink-3)';
    const lblColor = allComplete ? 'var(--hx-ink)' : 'var(--hx-ink-2)';
    const numBg    = allComplete ? 'var(--hx-ok-soft)' : 'var(--hx-inset)';
    const numBorder= allComplete ? 'var(--hx-ok-line)' : 'var(--hx-hair)';

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
      <div class="sm-tl-next-up-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="sm-tl-next-up-body">
        <div class="sm-tl-next-up-kicker">All complete</div>
        <div class="sm-tl-next-up-stage"><strong>All ${_SM_LIFECYCLE_STAGES.length} stages done!</strong></div>
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
  const icon   = blocked
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
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
          ${skipReason ? `<span style="color:var(--hx-warn);font-style:italic;font-size:0.64rem;">– ${_acctEsc(skipReason)}</span>` : ''}
        </div>
        ${dateNote ? `<div class="sm-tl-card-date">${dateNote}</div>` : ''}
      </div>
      <div class="sm-tl-card-right">
        ${docs.length > 0 ? `<span class="doc-badge">${docs.length}</span>` : ''}
        ${isBlocked ? '<span class="blocked-icon" title="Prerequisites not yet met">⚠</span>' : ''}
        <span style="font-size:0.7rem;color:var(--hx-ink-3);">${isOpen ? '▾' : '▸'}</span>
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
  // A325 — the timeline's shipment is a dozen header fields; the getShipments row underneath supplies
  // the payment / logistics / cost fields the stages list (the timeline's fresher values win).
  const tlShip = (_acctSmTlData && _acctSmTlData.shipment) || {};
  const ship   = Object.assign({}, _acctSmAll.find(r => r.shipmentId === tlShip.shipmentId) || {}, tlShip);
  let html = '';

  if (meta.description) {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">About this stage</div>
      <div style="font-size:0.76rem;color:var(--hx-ink-2);line-height:1.5;">${_acctEsc(meta.description)}</div>
      ${isAuto && apiStage.autoderivedNote ? `<div style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem;"><span class="auto-badge">AUTO</span><span style="font-size:0.7rem;color:var(--hx-ink-3);">${_acctEsc(apiStage.autoderivedNote)}</span></div>` : ''}
    </div>`;
  }

  if (status === 'skipped' && apiStage.skippedReason) {
    html += `<div class="sm-tl-detail-section">
      <div style="font-size:0.76rem;color:var(--hx-warn);background:var(--hx-warn-soft);border:1px solid var(--hx-warn-line);border-radius:5px;padding:0.4rem 0.6rem;">
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
      if (requires.length > 0) html += `<span style="font-size:0.65rem;color:var(--hx-ink-3);align-self:center;">→ unlocks:</span>`;
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
      // A325 — JSON strings, then HTML-escaped: the browser decodes &#39; back to ' before the handler
      // runs, so a file named "Client's PO.pdf" used to end the '…' string and the click did nothing.
      const viewArgs = _acctEsc(JSON.stringify(String(f.name || ''))) + ',' + _acctEsc(JSON.stringify(String(viewUrl)));
      const thumbImg = thumbUrl
        ? `<img src="${_acctEsc(thumbUrl)}" class="sm-mgmt-doc-thumb" onclick="acctOpenDocViewer(${viewArgs})" alt="Preview">`
        : `<div class="sm-mgmt-doc-thumb" onclick="acctOpenDocViewer(${viewArgs})"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>`;
      html += `<div class="sm-mgmt-doc-file">${thumbImg}<span class="sm-mgmt-doc-name" title="${_acctEsc(f.name)}">${_acctEsc(f.name)}</span><button class="sm-mgmt-doc-btn" onclick="acctOpenDocViewer(${viewArgs})">View ↗</button></div>`;
    });
    html += '</div>';
  } else {
    html += `<div style="font-size:0.73rem;color:var(--hx-ink-3);">No documents attached.</div>`;
  }
  html += '</div>';

  if (status !== 'pending') {
    html += `<div class="sm-tl-detail-section"><div class="sm-tl-section-label">Activity</div><div style="font-size:0.73rem;color:var(--hx-ink-2);line-height:1.55;">`;
    if (apiStage.completedAt || apiStage.completedBy) {
      const verb = status === 'skipped' ? 'Skipped' : 'Completed';
      html += `<div>• ${verb}${apiStage.completedAt ? ' on <strong>' + _acctEsc(apiStage.completedAt) + '</strong>' : ''}${apiStage.completedBy ? ' by <strong>' + _acctEsc(apiStage.completedBy) + '</strong>' : ''}</div>`;
    }
    if (apiStage.notes) {
      html += `<div style="margin-top:0.25rem;padding:0.35rem 0.5rem;background:var(--hx-inset);border-radius:4px;border:1px solid var(--hx-hair);">${_acctEsc(apiStage.notes)}</div>`;
    }
    html += '</div></div>';
  }

  return html;
}
