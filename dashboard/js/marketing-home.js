/* marketing-home.js — B2B industrial marketing workspace on the FlowAPI generic store.
   Leads · Campaigns · Content · Enablement · Events · Co-Marketing + a KPI scorecard vs the
   job's targets and a task-rhythm checklist. Marketing (+admin) edit; director/management read-only. */

let mSession = null;
let mCanEdit = false;
let mData = { leads: [], campaigns: [], content: [], enablement: [], events: [], principal: [], metrics: [] };
let mActiveTab = 'leads';

// ── Per-entity UI config: columns (table), fields (form), select options ──
const IND = ['Cement', 'Mining', 'Power', 'Oil & Gas', 'Shipyard', 'Semiconductor', 'Other'];
const VERT = ['Cement', 'Mining', 'Power', 'Oil & Gas', 'Shipyard', 'Semiconductor', 'General'];
const MKTG_UI = {
  leads: {
    label: 'Leads', icon: '🎯', title: 'Lead Pipeline (Marketing-Qualified Leads)',
    cols: [['date', 'Date'], ['company', 'Company'], ['contact', 'Contact'], ['industry', 'Industry'], ['source', 'Source'], ['status', 'Status'], ['soNo', 'Deal (SO)']],
    fields: [
      ['date', 'Date', 'date'], ['status', 'Status', 'select', ['New', 'Nurturing', 'MQL', 'Handed Off', 'Converted', 'Lost']],
      ['company', 'Company *', 'text'], ['contact', 'Contact person', 'text'],
      ['email', 'Email', 'text'], ['phone', 'Phone', 'text'],
      ['industry', 'Industry', 'select', IND], ['source', 'Source', 'select', ['LinkedIn', 'Email', 'Google', 'Website', 'Event', 'Referral', 'Other']],
      ['soNo', 'Converted deal — SO No (optional)', 'text'], ['notes', 'Notes', 'textarea', null, 'full'],
    ], required: ['company'], badge: 'status',
  },
  campaigns: {
    label: 'Campaigns', icon: '📣', title: 'Campaigns & ROI',
    cols: [['name', 'Campaign'], ['channel', 'Channel'], ['status', 'Status'], ['startDate', 'Start'], ['budget', 'Budget (MDF)', 'money'], ['leads', 'Leads', 'num'], ['mqls', 'MQLs', 'num']],
    fields: [
      ['name', 'Campaign name *', 'text'], ['channel', 'Channel', 'select', ['LinkedIn', 'Email', 'Google', 'Event', 'Multi']],
      ['status', 'Status', 'select', ['Planned', 'Active', 'Paused', 'Completed']], ['startDate', 'Start date', 'date'], ['endDate', 'End date', 'date'],
      ['budget', 'Budget / MDF (₱)', 'number'], ['spend', 'Spend (₱)', 'number'],
      ['leads', 'Leads generated', 'number'], ['mqls', 'MQLs', 'number'], ['notes', 'Notes', 'textarea', null, 'full'],
    ], required: ['name'], badge: 'status',
  },
  content: {
    label: 'Content', icon: '📝', title: 'Content Calendar & Library',
    cols: [['date', 'Date'], ['title', 'Title'], ['type', 'Type'], ['vertical', 'Vertical'], ['status', 'Status'], ['link', 'Link', 'link']],
    fields: [
      ['date', 'Date', 'date'], ['title', 'Title *', 'text'],
      ['type', 'Type', 'select', ['One-pager', 'Case Study', 'Application Guide', 'Whitepaper', 'Newsletter', 'LinkedIn Post', 'Spec Sheet', 'Comparison', 'Presentation']],
      ['vertical', 'Vertical', 'select', VERT], ['channel', 'Channel', 'text'],
      ['status', 'Status', 'select', ['Idea', 'Draft', 'Review', 'Published']], ['link', 'Link (URL)', 'text'],
      ['notes', 'Notes', 'textarea', null, 'full'],
    ], required: ['title'], badge: 'status',
  },
  enablement: {
    label: 'Enablement', icon: '🧰', title: 'Sales Enablement Library',
    cols: [['name', 'Asset'], ['category', 'Category'], ['vertical', 'Vertical'], ['status', 'Status'], ['lastUpdated', 'Last Updated'], ['link', 'Link', 'link']],
    fields: [
      ['name', 'Asset name *', 'text'],
      ['category', 'Category', 'select', ['Deck', 'Capability Statement', 'Battle Card', 'Objection Guide', 'Comparison Sheet', 'Proposal Template', 'Brochure']],
      ['vertical', 'Vertical', 'select', VERT], ['status', 'Status', 'select', ['Current', 'Needs Update', 'Archived']],
      ['link', 'Link (URL)', 'text'], ['notes', 'Notes', 'textarea', null, 'full'],
    ], required: ['name'], badge: 'status',
  },
  events: {
    label: 'Events', icon: '📅', title: 'Trade Shows & Events',
    cols: [['name', 'Event'], ['type', 'Type'], ['date', 'Date'], ['location', 'Location'], ['status', 'Status'], ['leadsCaptured', 'Leads', 'num']],
    fields: [
      ['name', 'Event name *', 'text'], ['type', 'Type', 'select', ['Trade Show', 'Seminar', 'Demo', 'Sponsorship']],
      ['date', 'Date', 'date'], ['location', 'Location', 'text'],
      ['status', 'Status', 'select', ['Planned', 'Confirmed', 'Done', 'Cancelled']], ['budget', 'Budget (₱)', 'number'],
      ['leadsCaptured', 'Leads captured', 'number'], ['notes', 'Notes', 'textarea', null, 'full'],
    ], required: ['name'], badge: 'status',
  },
  principal: {
    label: 'Co-Marketing', icon: '🤝', title: 'Principal Co-Marketing (MDF)',
    cols: [['principal', 'Principal'], ['activity', 'Activity'], ['date', 'Date'], ['status', 'Status'], ['mdfRequested', 'MDF Req.', 'money'], ['mdfApproved', 'MDF Appr.', 'money']],
    fields: [
      ['principal', 'Principal', 'select', ['Powerteam', 'CEJN', 'RAD Torque', 'SPX', 'Other']], ['activity', 'Activity *', 'text'],
      ['date', 'Date', 'date'], ['status', 'Status', 'select', ['Planned', 'Requested', 'Approved', 'Done']],
      ['mdfRequested', 'MDF requested (₱)', 'number'], ['mdfApproved', 'MDF approved (₱)', 'number'],
      ['notes', 'Notes', 'textarea', null, 'full'],
    ], required: ['activity'], badge: 'status',
  },
};
const ENTITY_ORDER = ['leads', 'campaigns', 'content', 'enablement', 'events', 'principal'];

const RHYTHM = {
  Daily: ['Monitor & respond to inquiries (website, LinkedIn, Facebook, email)', 'Manage social posting schedule & engagement', 'Work on active content projects', 'Coordinate with sales on immediate material needs'],
  Weekly: ['Publish 2-3 professional LinkedIn posts', 'Send or prepare email campaign / newsletter', 'Review lead-gen campaign performance & adjust', 'Attend sales team meeting', 'Hand off MQLs to Lead Gen Specialist'],
  Monthly: ['Produce 1-2 substantial content pieces', 'Run 1 targeted lead-gen campaign', 'Compile & present monthly marketing report', 'Coordinate with 1 principal on co-marketing', 'Review & refresh sales enablement materials'],
  Quarterly: ['Plan / coordinate a trade show or event', 'Competitive analysis of other distributors', 'Review marketing strategy & propose improvements', 'Performance review with Director'],
};

// ── Boot ──
document.addEventListener('DOMContentLoaded', async () => {
  mSession = requireMarketingAccess();
  if (!mSession) return;
  mCanEdit = mSession.role === 'marketing' || mSession.role === 'admin';
  renderNavbar('marketing-home');
  const ms = document.getElementById('monthSel');
  ms.value = new Date().toISOString().slice(0, 7);
  ms.addEventListener('change', render);
  if (!mCanEdit) {
    document.getElementById('roTag').style.display = '';
    document.getElementById('metricsBtn').style.display = 'none';
  }
  document.getElementById('metricsBtn').addEventListener('click', openMetModal);
  buildTabs();
  await loadAll();
});

async function loadAll() {
  try {
    const res = await fetchFlow('getMarketing');
    mData = Object.assign({ leads: [], campaigns: [], content: [], enablement: [], events: [], principal: [], metrics: [] }, (res && res.data) || {});
    render();
  } catch (e) {
    flash(e.message, false);
  }
}

function _month() { return document.getElementById('monthSel').value; }
function _inMonth(d) { return d && flowDate(d).slice(0, 7) === _month(); }

// ── KPI scorecard ──
function render() {
  renderKpis();
  buildTabs();
  renderPanel(mActiveTab);
}

function renderKpis() {
  const m = _month();
  const L = mData.leads, C = mData.content, CM = mData.campaigns, P = mData.principal, EN = mData.enablement;
  const reachedMQL = s => ['MQL', 'Handed Off', 'Converted'].includes(s);
  const mqls = L.filter(l => _inMonth(l.date) && reachedMQL(l.status)).length;
  const conv = L.filter(l => _inMonth(l.date) && (l.status === 'Converted' || (l.soNo && String(l.soNo).trim()))).length;
  const pieces = C.filter(c => _inMonth(c.date) && c.status === 'Published' && c.type !== 'LinkedIn Post').length;
  const liPosts = C.filter(c => _inMonth(c.date) && c.status === 'Published' && c.type === 'LinkedIn Post').length;
  const emails = C.filter(c => _inMonth(c.date) && c.status === 'Published' && c.type === 'Newsletter').length +
    CM.filter(c => _inMonth(c.startDate) && c.channel === 'Email').length;
  const enaTotal = EN.length, enaCurrent = EN.filter(e => e.status === 'Current').length;
  const enaPct = enaTotal ? Math.round(enaCurrent / enaTotal * 100) : 100;
  const coMkt = P.filter(p => _inMonth(p.date)).length;
  const thisVisits = flowNum((mData.metrics.find(x => x.month === m) || {}).websiteVisits);
  const prevM = _prevMonth(m);
  const prevVisits = flowNum((mData.metrics.find(x => x.month === prevM) || {}).websiteVisits);
  const traffic = prevVisits > 0 ? ((thisVisits - prevVisits) / prevVisits * 100) : null;

  const tiles = [
    kpiTile('MQLs generated', mqls, 15, 30, '15-30 / mo', true, '🎯'),
    kpiTile('Leads → closed deals', conv, 5, 10, '5-10 / mo', true, '💰'),
    kpiTile('Content pieces', pieces, 4, 8, '4-8 / mo', false, '📝'),
    kpiTile('LinkedIn posts', liPosts, 8, 12, '8-12 / mo', false, '💼'),
    kpiTile('Email campaigns', emails, 2, 4, '2-4 / mo', false, '✉️'),
    kpiTilePct('Enablement current', enaPct, 100, '100%', '🧰'),
    kpiTile('Co-marketing', coMkt, 1, Infinity, '1+ / mo', false, '🤝'),
    kpiTileTraffic(traffic, thisVisits),
  ];
  document.getElementById('kpis').innerHTML = tiles.join('');
}

function kpiTile(label, val, lo, hi, target, top, icon) {
  const met = val >= lo;
  const pill = top ? '<span class="pill pill-top">HIGHEST</span>' : `<span class="pill ${met ? 'pill-met' : 'pill-below'}">${met ? 'on target' : 'below'}</span>`;
  return `<div class="kpi${top ? ' hero-kpi' : ''}">${pill}<div class="l">${icon} ${flowEsc(label)}</div><div class="v">${val}</div><div class="t">Target ${target}</div></div>`;
}
function kpiTilePct(label, val, lo, target, icon) {
  const met = val >= lo;
  return `<div class="kpi"><span class="pill ${met ? 'pill-met' : 'pill-below'}">${met ? 'on target' : 'below'}</span><div class="l">${icon} ${flowEsc(label)}</div><div class="v">${val}%</div><div class="t">Target ${target}</div></div>`;
}
function kpiTileTraffic(pct, visits) {
  const has = pct !== null;
  const met = has && pct >= 5;
  const pill = has ? `<span class="pill ${met ? 'pill-met' : 'pill-below'}">${met ? 'on target' : 'below'}</span>` : '';
  const v = has ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' : '—';
  return `<div class="kpi">${pill}<div class="l">🌐 Website traffic MoM</div><div class="v">${v}</div><div class="t">Target +5-10% · ${visits ? visits.toLocaleString() + ' visits' : 'enter monthly metrics'}</div></div>`;
}
function _prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── Tabs ──
function buildTabs() {
  const tabs = ENTITY_ORDER.map(k => {
    const u = MKTG_UI[k];
    return `<div class="mkt-tab ${mActiveTab === k ? 'active' : ''}" data-tab="${k}">${u.icon} ${u.label}<span class="cnt">${(mData[k] || []).length}</span></div>`;
  }).join('') + `<div class="mkt-tab ${mActiveTab === 'rhythm' ? 'active' : ''}" data-tab="rhythm">🗓 Task Rhythm</div>`;
  const el = document.getElementById('tabs');
  el.innerHTML = tabs;
  el.querySelectorAll('.mkt-tab').forEach(t => t.addEventListener('click', () => { mActiveTab = t.getAttribute('data-tab'); render(); }));
}

function renderPanel(tab) {
  const host = document.getElementById('panels');
  if (tab === 'rhythm') { host.innerHTML = rhythmHtml(); wireRhythm(); return; }
  const u = MKTG_UI[tab];
  const rows = (mData[tab] || []).slice().sort((a, b) => (flowDate(b.date || b.startDate || b.lastUpdated) || '').localeCompare(flowDate(a.date || a.startDate || a.lastUpdated) || ''));
  const statuses = (u.fields.find(f => f[0] === 'status') || [])[3] || [];
  host.innerHTML = `<div class="mkt-panel active"><div class="panel-card">
    <div class="panel-toolbar">
      <h3>${u.icon} ${flowEsc(u.title)}</h3>
      <input type="text" id="pSearch" placeholder="Search…">
      ${statuses.length ? `<select id="pStatus"><option value="">All statuses</option>${statuses.map(s => `<option>${s}</option>`).join('')}</select>` : ''}
      <span class="spacer"></span>
      ${mCanEdit ? `<button class="btn btn-sm btn-primary" id="pAdd">+ Add ${u.label.replace(/s$/, '')}</button>` : ''}
    </div>
    <div id="pBody" style="overflow-x:auto;"></div>
  </div></div>`;
  const reRender = () => renderRows(tab, rows);
  document.getElementById('pSearch').addEventListener('input', reRender);
  if (document.getElementById('pStatus')) document.getElementById('pStatus').addEventListener('change', reRender);
  if (mCanEdit) document.getElementById('pAdd').addEventListener('click', () => openRecModal(tab, null));
  renderRows(tab, rows);
}

function renderRows(tab, rows) {
  const u = MKTG_UI[tab];
  const q = (document.getElementById('pSearch').value || '').trim().toLowerCase();
  const st = document.getElementById('pStatus') ? document.getElementById('pStatus').value : '';
  const filtered = rows.filter(r => {
    if (st && r.status !== st) return false;
    if (q) return JSON.stringify(r).toLowerCase().includes(q);
    return true;
  });
  const body = document.getElementById('pBody');
  if (!filtered.length) { body.innerHTML = '<div class="dr-empty">No records yet.</div>'; return; }
  const th = u.cols.map(c => `<th${(c[2] === 'num' || c[2] === 'money') ? ' class="num"' : ''}>${c[1]}</th>`).join('');
  const trs = filtered.map(r => {
    const tds = u.cols.map(c => cell(r, c)).join('');
    const acts = mCanEdit
      ? `<td style="white-space:nowrap;"><button class="mkt-act" data-edit="${r.rowIndex}">Edit</button> <button class="mkt-act" data-del="${r.rowIndex}">✕</button></td>`
      : '<td></td>';
    return `<tr>${tds}${acts}</tr>`;
  }).join('');
  body.innerHTML = `<table class="flow-table"><thead><tr>${th}<th></th></tr></thead><tbody>${trs}</tbody></table>`;
  body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openRecModal(tab, b.getAttribute('data-edit'))));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delRecord(tab, b.getAttribute('data-del'))));
}

function cell(r, c) {
  const [key, , type] = c;
  let v = r[key];
  if (type === 'money') return `<td class="num">${flowMoney(flowNum(v), 'PHP')}</td>`;
  if (type === 'num') return `<td class="num">${v ? flowNum(v) : '—'}</td>`;
  if (type === 'link') return `<td>${v ? `<a href="${flowEsc(v)}" target="_blank" class="link-btn">open</a>` : '—'}</td>`;
  if (key === 'date' || key === 'startDate' || key === 'lastUpdated') return `<td style="white-space:nowrap;">${flowEsc(flowDate(v) || v || '—')}</td>`;
  if (key === 'status') return `<td>${statusBadge(v)}</td>`;
  if (key === 'soNo') return `<td>${v ? `<span class="mkt-badge b-good">${flowEsc(v)}</span>` : '—'}</td>`;
  return `<td>${flowEsc(v || '—')}</td>`;
}

function statusBadge(s) {
  const k = String(s || '').toLowerCase();
  let cls = 'b-new';
  if (['mql', 'converted', 'current', 'done', 'published', 'approved', 'completed', 'confirmed'].includes(k)) cls = 'b-good';
  else if (['nurturing', 'needs update', 'review', 'requested', 'active', 'planned', 'draft'].includes(k)) cls = 'b-warm';
  else if (['handed off', 'idea'].includes(k)) cls = 'b-info';
  else if (['lost', 'cancelled', 'archived'].includes(k)) cls = 'b-bad';
  return `<span class="mkt-badge ${cls}">${flowEsc(s || '—')}</span>`;
}

// ── Add / Edit modal ──
function openRecModal(entity, rowIndex) {
  const u = MKTG_UI[entity];
  const rec = rowIndex ? (mData[entity] || []).find(r => String(r.rowIndex) === String(rowIndex)) : null;
  document.getElementById('recEntity').value = entity;
  document.getElementById('recRowIndex').value = rec ? rec.rowIndex : '';
  document.getElementById('recModalTitle').textContent = (rec ? 'Edit ' : 'Add ') + u.label.replace(/s$/, '');
  document.getElementById('recForm').innerHTML = u.fields.map(f => fieldHtml(f, rec)).join('');
  document.getElementById('recFormMsg').style.display = 'none';
  document.getElementById('recModal').classList.add('open');
}
function fieldHtml(f, rec) {
  const [key, label, type, opts, span] = f;
  const v = rec ? (rec[key] != null ? rec[key] : '') : (key === 'date' ? flowToday() : '');
  const cls = span === 'full' ? ' class="full"' : '';
  let input;
  if (type === 'select') input = `<select data-key="${key}">${(opts || []).map(o => `<option${String(v) === o ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
  else if (type === 'textarea') input = `<textarea data-key="${key}">${flowEsc(v)}</textarea>`;
  else input = `<input type="${type}" data-key="${key}" value="${flowEsc(v)}">`;
  return `<div${cls}><label>${flowEsc(label)}</label>${input}</div>`;
}
function closeRecModal() { document.getElementById('recModal').classList.remove('open'); }

async function submitRecord() {
  const entity = document.getElementById('recEntity').value;
  const u = MKTG_UI[entity];
  const rec = {};
  document.querySelectorAll('#recForm [data-key]').forEach(el => { rec[el.getAttribute('data-key')] = el.value.trim ? el.value.trim() : el.value; });
  for (const r of (u.required || [])) {
    if (!rec[r]) { formErr(MKTG_UI[entity].fields.find(f => f[0] === r)[1].replace(' *', '') + ' is required.'); return; }
  }
  const ri = document.getElementById('recRowIndex').value;
  if (ri) rec.rowIndex = ri;
  const btn = document.getElementById('recSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow('saveMarketingRecord', { entity, record: JSON.stringify(rec) });
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    closeRecModal();
    flash('Saved.', true);
    await loadAll();
  } catch (e) { formErr(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

async function delRecord(entity, rowIndex) {
  if (!confirm('Delete this record?')) return;
  try {
    const res = await postFlow('deleteMarketingRecord', { entity, rowIndex });
    if (!res || !res.success) throw new Error((res && res.message) || 'Delete failed.');
    flash('Deleted.', true);
    await loadAll();
  } catch (e) { flash(e.message, false); }
}

// ── Monthly metrics ──
function openMetModal() {
  const m = _month();
  const rec = mData.metrics.find(x => x.month === m) || {};
  document.getElementById('metMonthLabel').textContent = m;
  document.getElementById('metVisits').value = rec.websiteVisits || '';
  document.getElementById('metFollowers').value = rec.linkedinFollowers || '';
  document.getElementById('metNotes').value = rec.notes || '';
  document.getElementById('metMsg').style.display = 'none';
  document.getElementById('metModal').classList.add('open');
}
function closeMetModal() { document.getElementById('metModal').classList.remove('open'); }
async function submitMetrics() {
  const rec = {
    month: _month(),
    websiteVisits: flowNum(document.getElementById('metVisits').value),
    linkedinFollowers: flowNum(document.getElementById('metFollowers').value),
    notes: document.getElementById('metNotes').value.trim(),
  };
  const btn = document.getElementById('metSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow('saveMarketingRecord', { entity: 'metrics', record: JSON.stringify(rec) });
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    closeMetModal();
    flash('Monthly metrics saved.', true);
    await loadAll();
  } catch (e) { const mm = document.getElementById('metMsg'); mm.style.display = 'block'; mm.textContent = e.message; mm.style.color = '#b45309'; }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

// ── Task rhythm (personal checklist, localStorage per ISO period) ──
function _periodKey(cad) {
  const d = new Date();
  if (cad === 'Daily') return d.toISOString().slice(0, 10);
  if (cad === 'Monthly') return d.toISOString().slice(0, 7);
  if (cad === 'Quarterly') return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1);
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + week;
}
function _rhythmState() { try { return JSON.parse(localStorage.getItem('mktgRhythm') || '{}'); } catch (e) { return {}; } }
function rhythmHtml() {
  const state = _rhythmState();
  const cols = Object.keys(RHYTHM).map(cad => {
    const pk = _periodKey(cad);
    const items = RHYTHM[cad].map((t, i) => {
      const id = cad + '|' + pk + '|' + i;
      const done = !!state[id];
      return `<label class="${done ? 'done' : ''}"><input type="checkbox" data-rid="${id}"${done ? ' checked' : ''}>${flowEsc(t)}</label>`;
    }).join('');
    return `<div class="rhythm-col"><h4>${cad}</h4>${items}</div>`;
  }).join('');
  return `<div class="mkt-panel active"><div class="panel-card">
    <div class="panel-toolbar"><h3>🗓 Task Rhythm</h3><span class="spacer"></span><span style="font-size:0.74rem;color:var(--text-muted,#64748b);">Personal checklist — resets each period</span></div>
    <div class="rhythm-grid">${cols}</div>
  </div></div>`;
}
function wireRhythm() {
  document.querySelectorAll('#panels input[data-rid]').forEach(cb => cb.addEventListener('change', () => {
    const state = _rhythmState();
    state[cb.getAttribute('data-rid')] = cb.checked;
    localStorage.setItem('mktgRhythm', JSON.stringify(state));
    cb.closest('label').classList.toggle('done', cb.checked);
  }));
}

// ── helpers ──
function formErr(msg) { const m = document.getElementById('recFormMsg'); m.style.display = 'block'; m.textContent = msg; m.style.color = '#b45309'; }
function flash(text, ok) { const m = document.getElementById('msg'); m.style.display = 'block'; m.textContent = text; m.style.color = ok ? '#0f766e' : '#b45309'; setTimeout(() => { m.style.display = 'none'; }, 4000); }
