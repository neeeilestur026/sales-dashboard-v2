/* ═══════════════════════════════════════════════
   weekly-itinerary.js — a rep's planned client visits for a Mon–Sun week (A190).

   The week is laid out as one block per day rather than a single long table: a rep filling in
   Tuesday should not have to count rows to find where Tuesday ends, and an approver reading it
   wants to see the shape of the week at a glance.

   THE APPROVAL ORDER IS DIRECTOR FIRST, THEN MANAGEMENT — the reverse of payment requests. The
   backend owns that order (_ITIN_STAGES in FlowAPI.gs); this file only reflects whatever status
   comes back, so the two can never disagree about who is next.

   Editing is locked the moment a plan leaves Draft/Rejected. That is deliberate: an approver
   signs off on a specific set of visits, and letting the rows change underneath an approval would
   make the sign-off meaningless. Reopening clears BOTH approval stamps and starts the chain again.
   ═══════════════════════════════════════════════ */

let wiSession = null;
let wiOffset = 0;              // weeks relative to today's week
let wiRecord = null;           // the itinerary for the shown week, or null when none exists yet
let wiRows = [];               // {seq, day, date, plannedTime, company, personToMeet, cityArea, purpose, agenda, expectedOutcome}
let wiSeq = 0;
let wiAll = [];                // this rep's itineraries, for the history table

const WI_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function _wie(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }

document.addEventListener('DOMContentLoaded', () => {
  wiSession = requireSales();
  if (!wiSession) return;
  renderNavbar('weekly-itinerary');

  document.getElementById('wiPrev').addEventListener('click', () => { wiOffset--; wiLoad(); });
  document.getElementById('wiNext').addEventListener('click', () => { wiOffset++; wiLoad(); });
  document.getElementById('wiThis').addEventListener('click', () => { wiOffset = 0; wiLoad(); });
  document.getElementById('wiSaveBtn').addEventListener('click', () => wiSave(false));
  document.getElementById('wiSubmitBtn').addEventListener('click', wiSubmit);
  document.getElementById('wiReviseBtn').addEventListener('click', wiRevise);

  wiLoad();
});

function wiWeek() { return flowWeekDates(flowToday(), wiOffset); }

function wiStatus() { return wiRecord ? String(wiRecord.status || 'Draft') : 'Draft'; }
/** Draft and Rejected are the only editable states — mirrors _itinEditable on the server. */
function wiEditable() { const s = wiStatus(); return s === 'Draft' || s === 'Rejected' || s === ''; }

async function wiLoad() {
  const week = wiWeek();
  if (!week.length) return;
  document.getElementById('wiRange').textContent = `${week[0]} – ${week[6]}`;

  wiRecord = null; wiRows = []; wiSeq = 0;
  try {
    const r = await fetchFlow('getWeeklyItineraries', { user: wiSession.name });
    wiAll = (r && r.data) || [];
    wiRecord = wiAll.filter(x => x.weekStart === week[0])[0] || null;
  } catch (e) {
    wiAll = [];
    // The backend may not carry itineraries yet (FlowAPI below v105) — show an empty planner
    // rather than an error, so the page is still usable the moment the backend catches up.
  }

  if (wiRecord) {
    document.getElementById('wiObjectives').value = wiRecord.objectives || '';
    document.getElementById('wiNotes').value = wiRecord.notes || '';
    wiRows = (wiRecord.items || []).map(it => Object.assign({}, it));
    wiSeq = wiRows.reduce((m, r2) => Math.max(m, Number(r2.seq) || 0), 0);
  } else {
    document.getElementById('wiObjectives').value = '';
    document.getElementById('wiNotes').value = '';
  }

  wiRenderChrome();
  wiRenderDays();
  wiRenderHistory();
}

function wiRenderChrome() {
  const st = wiStatus();
  const cls = st === 'Approved' ? 'approved' : st === 'Rejected' ? 'rejected'
            : st.indexOf('Pending') === 0 ? 'pending' : 'draft';
  document.getElementById('wiStatusChip').innerHTML =
    `<span class="wiStatus ${cls}">${_wie(st)}</span>`;

  const editable = wiEditable();
  document.getElementById('wiSaveBtn').style.display = editable ? '' : 'none';
  document.getElementById('wiSubmitBtn').style.display = editable ? '' : 'none';
  document.getElementById('wiReviseBtn').style.display = (!editable && st !== 'Approved') || st === 'Approved' ? '' : 'none';
  ['wiObjectives', 'wiNotes'].forEach(id => { document.getElementById(id).disabled = !editable; });

  // Say where the plan actually stands, in the order the approvals happen.
  const b = document.getElementById('wiBanner');
  if (!wiRecord) { b.innerHTML = ''; return; }
  if (st === 'Pending Director') {
    b.innerHTML = `<div class="wiBanner warn">Waiting for the <strong>director</strong> to approve. Management reviews it after that.</div>`;
  } else if (st === 'Pending Management') {
    b.innerHTML = `<div class="wiBanner warn">The director approved this on ${_wie(wiRecord.dirApprovedAt || '')} — now waiting for <strong>management</strong>.</div>`;
  } else if (st === 'Approved') {
    b.innerHTML = `<div class="wiBanner good">Approved by ${_wie(wiRecord.dirApprovedBy || 'the director')} then ${_wie(wiRecord.mgmtApprovedBy || 'management')}. Log each visit against its planned stop from your daily report.</div>`;
  } else if (st === 'Rejected') {
    b.innerHTML = `<div class="wiBanner bad">Sent back${wiRecord.approvalNote ? ' — ' + _wie(wiRecord.approvalNote) : ''}. Edit the plan and submit it again.</div>`;
  } else {
    b.innerHTML = wiRecord.approvalNote
      ? `<div class="wiBanner warn">${_wie(wiRecord.approvalNote)}</div>` : '';
  }
}

function wiRenderDays() {
  const week = wiWeek();
  const editable = wiEditable();
  const host = document.getElementById('wiDays');
  host.className = editable ? '' : 'wiLocked';

  host.innerHTML = week.map((date, i) => {
    const rows = wiRows.filter(r => r.date === date)
      .sort((a, b) => String(a.plannedTime || '').localeCompare(String(b.plannedTime || '')));
    return `<div class="wiDay">
      <div class="wiDayHead">
        <span class="d">${WI_DAYS[i]}</span><span class="dt">${_wie(date)}</span>
        <span class="n">${rows.length} planned visit${rows.length === 1 ? '' : 's'}</span>
      </div>
      <div style="overflow-x:auto;">
        <table class="wiTable">
          <thead><tr>
            <th style="width:76px;">Time</th><th style="width:15%;">Company</th><th style="width:13%;">Person to meet</th>
            <th style="width:12%;">City / area</th><th style="width:15%;">Purpose</th>
            <th style="width:17%;">Agenda</th><th style="width:17%;">Expected outcome</th><th style="width:30px;"></th>
          </tr></thead>
          <tbody>${rows.length ? rows.map(r => wiRowHtml(r)).join('')
            : `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);font-size:0.78rem;padding:0.6rem;">Nothing planned for this day.</td></tr>`}</tbody>
        </table>
      </div>
      <div style="padding:0.45rem 0.6rem;">
        <button class="btn btn-sm btn-secondary wiAddRow" data-date="${_wie(date)}">+ Add a visit</button>
      </div>
    </div>`;
  }).join('');

  host.querySelectorAll('.wiAddRow').forEach(b =>
    b.addEventListener('click', () => wiAddRow(b.getAttribute('data-date'))));
  host.querySelectorAll('[data-field]').forEach(el =>
    el.addEventListener('input', () => {
      const row = wiRows.find(r => String(r.seq) === el.getAttribute('data-seq'));
      if (row) row[el.getAttribute('data-field')] = el.value;
    }));
  host.querySelectorAll('.wiDel').forEach(b =>
    b.addEventListener('click', () => { wiRows = wiRows.filter(r => String(r.seq) !== b.getAttribute('data-seq')); wiRenderDays(); }));
}

function wiRowHtml(r) {
  const f = (name, val, ph) =>
    `<input data-seq="${r.seq}" data-field="${name}" value="${_wie(val || '')}" placeholder="${ph || ''}">`;
  return `<tr>
    <td><input type="time" data-seq="${r.seq}" data-field="plannedTime" value="${_wie(r.plannedTime || '')}"></td>
    <td>${f('company', r.company, 'Company')}</td>
    <td>${f('personToMeet', r.personToMeet, 'Who')}</td>
    <td>${f('cityArea', r.cityArea, 'City / area')}</td>
    <td>${f('purpose', r.purpose, 'Why go')}</td>
    <td>${f('agenda', r.agenda, 'What to cover')}</td>
    <td>${f('expectedOutcome', r.expectedOutcome, 'What good looks like')}</td>
    <td><button class="wiDel" data-seq="${r.seq}" title="Remove">✕</button></td>
  </tr>`;
}

function wiAddRow(date) {
  const week = wiWeek();
  wiRows.push({ seq: ++wiSeq, day: WI_DAYS[week.indexOf(date)] || '', date,
                plannedTime: '', company: '', personToMeet: '', cityArea: '',
                purpose: '', agenda: '', expectedOutcome: '' });
  wiRenderDays();
}

/** Rows worth saving — a row with nothing in it is noise on an approver's screen. */
function wiFilled() {
  return wiRows.filter(r => [r.company, r.personToMeet, r.cityArea, r.purpose, r.agenda, r.expectedOutcome]
    .some(v => String(v || '').trim()));
}

async function wiSave(quiet) {
  const week = wiWeek();
  const btn = document.getElementById('wiSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await postFlow('saveWeeklyItinerary', {
      weekStart: week[0], weekEnd: week[6],
      objectives: document.getElementById('wiObjectives').value.trim(),
      notes: document.getElementById('wiNotes').value.trim(),
      items: JSON.stringify(wiFilled()),
    });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not save.');
    if (!quiet) flowMsg('wiMsg', 'Draft saved.', true);
    await wiLoad();
    return true;
  } catch (e) {
    flowMsg('wiMsg', e.message, false);
    return false;
  } finally { btn.disabled = false; btn.textContent = 'Save draft'; }
}

async function wiSubmit() {
  const filled = wiFilled();
  // Refuse here as well as on the server so the rep is told before a round trip.
  if (!filled.length) { flowMsg('wiMsg', 'Add at least one planned visit before submitting.', false); return; }
  if (!confirm(`Submit this week's plan (${filled.length} planned visit${filled.length === 1 ? '' : 's'}) for approval?\n\nThe director reviews it first, then management. You will not be able to edit it while it is under review.`)) return;

  // Always save first: submitting a plan that still has unsaved edits would send the approver an
  // older version than the one on screen.
  if (!await wiSave(true)) return;

  const btn = document.getElementById('wiSubmitBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const r = await postFlow('submitWeeklyItinerary', { itineraryNo: wiRecord && wiRecord.itineraryNo });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not submit.');
    flowMsg('wiMsg', r.message, true);
    await wiLoad();
  } catch (e) { flowMsg('wiMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Submit for approval'; }
}

async function wiRevise() {
  if (!wiRecord) return;
  const reason = prompt('Reopening clears the approvals already given and sends the plan back through the director and then management.\n\nWhy are you reopening it?', '');
  if (reason === null) return;
  try {
    const r = await postFlow('reviseWeeklyItinerary', { itineraryNo: wiRecord.itineraryNo, reason });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not reopen.');
    flowMsg('wiMsg', r.message, true);
    await wiLoad();
  } catch (e) { flowMsg('wiMsg', e.message, false); }
}

function wiRenderHistory() {
  const host = document.getElementById('wiHistory');
  const rows = wiAll.slice().sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart))).slice(0, 12);
  if (!rows.length) { host.innerHTML = '<p style="color:var(--text-muted);">No itineraries yet.</p>'; return; }
  host.innerHTML = `<table class="flow-table">
    <thead><tr><th>Week</th><th>Status</th><th class="num">Planned visits</th><th>Director</th><th>Management</th><th>Note</th></tr></thead>
    <tbody>${rows.map(r => {
      const st = String(r.status || 'Draft');
      const cls = st === 'Approved' ? 'approved' : st === 'Rejected' ? 'rejected'
                : st.indexOf('Pending') === 0 ? 'pending' : 'draft';
      return `<tr>
        <td>${_wie(r.weekStart)} – ${_wie(r.weekEnd)}</td>
        <td><span class="wiStatus ${cls}">${_wie(st)}</span></td>
        <td class="num">${(r.items || []).length}</td>
        <td>${_wie(r.dirApprovedBy || '—')}</td>
        <td>${_wie(r.mgmtApprovedBy || '—')}</td>
        <td style="color:var(--text-muted);font-size:0.78rem;">${_wie(r.approvalNote || '')}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}
