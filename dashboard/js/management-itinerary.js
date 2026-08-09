/* ═══════════════════════════════════════════════
   management-itinerary.js — the week's field plans, for the people who approve them (A216).

   Before this, an approver's entire view of a weekly itinerary was a modal opened from the approvals
   strip, listing seven columns of what a rep INTENDED to do. Once approved it vanished: no way to
   reopen it, no history, no sight of a plan still with the director, and — the part that mattered —
   no way to tell whether any of it happened. The one live week has a rep who logged five client
   visits and never filed a plan at all, and nothing in the system says so anywhere.

   So the page does two jobs at once, which is why it is split down the middle. The rail is the queue
   and the roster: everyone who could have been in the field this week, what state their plan is in,
   ordered so that what YOU can act on is at the top. The pane is one rep's week, day by day, in the
   same shape as their own weekly-itinerary.html — planned stops with what actually happened
   underneath them.

   The join between plan and reality is in itinerary-week.js, deliberately: it is the part that can
   quietly lie, so it is pure and table-tested. Read the header there before changing what "matched"
   means. The short version — an exact link is a fact, a name match is a guess, and the two are never
   added together.
   ═══════════════════════════════════════════════ */

let miSession = null;
let miOffset = 0;              // weeks relative to today
let miModel = null;            // itineraryWeek() result for the shown week
let miAllItins = [];           // every itinerary, for the selected rep's history
let miPick = null;             // the rep whose week fills the pane
let miPhotos = {};             // visitNo → data: URI
let miPhotoDone = {};          // rep → already fetched, so re-renders don't re-fetch
let miSeq = 0;                 // discard a slow week that a faster later click has superseded

const MI_LABEL = { 'needs-you': 'Waiting on you', 'no-plan': 'No plan filed', 'pending': 'Under review',
                   'draft': 'Draft', 'rejected': 'Sent back', 'approved': 'Approved', 'idle': 'Nothing filed' };

function _mie(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }

document.addEventListener('DOMContentLoaded', () => {
  /* hr and admin land here read-only; the Approve/Reject buttons are drawn only for the role whose
     stage the plan is actually sitting at, and the backend enforces the same rule again
     (_ITIN_STAGES, FlowAPI.gs:5874) so a hand-made request cannot get past it either. */
  miSession = requirePerformanceAccess();
  if (!miSession) return;
  renderNavbar('management-itinerary');

  document.getElementById('miPrev').addEventListener('click', () => { miOffset--; miPick = null; miLoad(); });
  document.getElementById('miNext').addEventListener('click', () => { miOffset++; miPick = null; miLoad(); });
  document.getElementById('miThis').addEventListener('click', () => { miOffset = 0; miPick = null; miLoad(); });
  document.getElementById('miRefresh').addEventListener('click', () => miLoad(true));
  document.getElementById('miPrint').addEventListener('click', () => window.print());

  miLoad();
});

function miWeek() { return flowWeekDates(flowToday(), miOffset); }
function miRole() { return String(miSession && miSession.role || '').toLowerCase(); }

async function miLoad(fresh) {
  const seq = ++miSeq;
  const week = miWeek();
  if (!week.length) return;
  document.getElementById('miRange').textContent = `${week[0]} – ${week[6]}`;
  document.getElementById('miPane').innerHTML =
    '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  document.getElementById('miRail').innerHTML = '';
  miPhotos = {}; miPhotoDone = {};

  const today = flowToday();
  const opt = fresh ? { fresh: true } : {};
  let itins = [], visits = [], roster = [];
  try {
    /* One itineraries call for everyone, seven visit calls (getClientVisits filters by a single
       date only) — the same shape team-performance.js:117 uses, including skipping days that have
       not happened yet rather than paying for seven certain-empty round trips. */
    const [ir, vr, ro] = await Promise.all([
      fetchFlow('getWeeklyItineraries', {}, opt).then(r => (r && r.data) || []).catch(() => null),
      Promise.all(week.map(d => d > today ? Promise.resolve([])
        : fetchFlow('getClientVisits', { date: d }, opt).then(r => (r && r.data) || []).catch(() => []))),
      /* getUsers, not apiFetchEmailUsers (which team-performance.js uses): that one goes through
         Flask, needs a live server session, and is gated on the email integration being set up —
         it answers "Invalid session" here and the rail silently loses everybody who has no data
         this week. This is the plain user directory, and it is the whole point of the rail: the
         third sales rep filed nothing and logged nothing, so only the roster can show them. */
      (typeof apiGetUsers === 'function'
        ? apiGetUsers().then(r => (r && r.data) || []).catch(() => []) : Promise.resolve([]))
    ]);
    if (seq !== miSeq) return;
    if (ir === null) throw new Error('Could not read the weekly itineraries.');
    itins = ir; visits = vr.reduce((a, b) => a.concat(b), []); roster = ro;
  } catch (e) {
    document.getElementById('miPane').innerHTML =
      `<p style="color:#ef4444;">${_mie(e.message)}</p>`;
    document.getElementById('miKpis').innerHTML = '';
    return;
  }

  miAllItins = itins;
  miModel = itineraryWeek(week, itins, visits, roster, { viewerRole: miRole() });

  // Keep the reader where they were across a Refresh; otherwise open on the first rail card, which
  // the engine has already sorted to be the most useful one.
  if (!miPick || !miModel.reps.some(r => r.rep === miPick)) {
    miPick = miModel.reps.length ? miModel.reps[0].rep : null;
  }

  miRenderAlert();
  miRenderKpis();
  miRenderRail();
  miRenderPane();
}

/* ── the top of the page ────────────────────────────────────────────────────────────────────── */

function miRenderAlert() {
  const t = miModel.totals;
  const host = document.getElementById('miAlert');
  const bits = [];
  if (t.needsYou) {
    bits.push(`<div class="mi-banner warn"><b>${t.needsYou} plan${t.needsYou === 1 ? '' : 's'}
      waiting on you.</b> They are at the top of the list on the left.</div>`);
  }
  if (t.noPlanButVisited) {
    bits.push(`<div class="mi-banner bad"><b>${t.noPlanButVisited} rep${t.noPlanButVisited === 1 ? '' : 's'}
      logged client visits this week without filing a plan.</b>
      ${t.noPlanButVisited === 1 ? 'That week' : 'Those weeks'} went unapproved.</div>`);
  }
  host.innerHTML = bits.join('');
}

function miRenderKpis() {
  const t = miModel.totals;
  const tile = (label, value, detail, spot) =>
    `<div class="kpi${spot ? ' spot' : ''}">
       <div class="top"><span class="l">${_mie(label)}</span></div>
       <div class="v">${_mie(value)}</div>
       <div class="d">${detail || ''}</div>
     </div>`;

  /* "Matched" counts ONLY visits the rep linked to a stop themselves. On today's data that is zero
     and it should be — the visit picker offers Approved plans only (report.js:359) and nothing has
     ever been approved. Showing the name guesses in this tile instead would be a made-up number on
     an executive's screen. */
  document.getElementById('miKpis').innerHTML =
    tile('Plans filed', `${t.plansFiled} of ${t.reps}`,
         t.reps - t.plansFiled ? `${t.reps - t.plansFiled} did not file` : 'everyone filed', true) +
    tile('Planned stops', t.planned, t.missed ? `${t.missed} with no visit logged` : 'all accounted for') +
    tile('Visits logged', t.logged, t.unplanned ? `${t.unplanned} against no plan` : '') +
    tile('Matched to a stop', t.matched, t.likely ? `+ ${t.likely} likely, by name` : 'linked by the rep') +
    tile('Off-plan', t.unplanned, t.dangling ? `${t.dangling} link${t.dangling === 1 ? '' : 's'} broken` : '');
}

/* ── the rail ───────────────────────────────────────────────────────────────────────────────── */

function miRenderRail() {
  const host = document.getElementById('miRail');
  if (!miModel.reps.length) {
    host.innerHTML = '<div class="mi-empty">Nobody was in the field this week.</div>';
    return;
  }
  host.innerHTML = miModel.reps.map(r => {
    const c = r.counts;
    const line = r.itinerary
      ? `${c.planned} planned · ${c.logged} logged`
      : (c.logged ? `${c.logged} visit${c.logged === 1 ? '' : 's'}, no plan` : 'nothing this week');
    return `<button class="mi-who${r.rep === miPick ? ' on' : ''}" data-rep="${_mie(r.rep)}">
        <span class="n"><span class="dot d-${r.bucket}"></span>${_mie(r.rep)}</span>
        <span class="s b-${r.bucket}">${_mie(MI_LABEL[r.bucket])}</span>
        <span class="c">${_mie(line)}</span>
      </button>`;
  }).join('');

  host.querySelectorAll('.mi-who').forEach(b => b.addEventListener('click', () => {
    miPick = b.getAttribute('data-rep');
    miRenderRail(); miRenderPane();
  }));
}

/* ── one rep's week ─────────────────────────────────────────────────────────────────────────── */

function miRenderPane() {
  const host = document.getElementById('miPane');
  const r = miModel.reps.find(x => x.rep === miPick);
  if (!r) { host.innerHTML = '<div class="mi-empty">Pick someone on the left.</div>'; return; }

  host.innerHTML = miPaneHead(r) + miBanner(r) + miObjectives(r) +
                   r.days.map(d => miDay(r, d)).join('') + miStrays(r) + miHistory(r);

  const ap = host.querySelector('#miApprove');
  if (ap) ap.addEventListener('click', () => miDecide('approveWeeklyItinerary', r));
  const rj = host.querySelector('#miReject');
  if (rj) rj.addEventListener('click', () => miDecide('rejectWeeklyItinerary', r));
  host.querySelectorAll('[data-week]').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault(); miJumpToWeek(a.getAttribute('data-week'));
  }));

  miLoadPhotos(r);
}

function miPaneHead(r) {
  const acts = r.needsYou
    ? `<div class="acts no-print">
         <button class="btn btn-sm btn-primary" id="miApprove">Approve</button>
         <button class="btn btn-sm btn-secondary" id="miReject">Send back</button>
       </div>` : '';
  const c = r.counts;
  /* The likely count sits in the subtitle in words, never beside the matched figure as if it were
     the same kind of thing. */
  const likely = c.likely ? ` · <span title="Matched by company name, not by the rep — a guess">${c.likely} likely by name</span>` : '';
  return `<div class="mi-panehead">
      <div>
        <h2>${_mie(r.rep)}</h2>
        <div class="mi-note">
          <span class="mi-chip b-${r.bucket}">${_mie(r.itinerary ? r.status : MI_LABEL[r.bucket])}</span>
          ${r.itinerary ? `<b>${_mie(r.itinerary.itineraryNo)}</b> · ` : ''}
          ${c.planned} planned · ${c.logged} logged · <b>${c.matched} matched</b>${likely}
        </div>
      </div>
      ${acts}
    </div>`;
}

function miBanner(r) {
  const it = r.itinerary;
  if (!it) {
    return r.counts.logged
      ? `<div class="mi-banner bad"><b>No plan was ever filed for this week</b>, but
           ${r.counts.logged} client visit${r.counts.logged === 1 ? ' was' : 's were'} logged.
           Nothing below was approved by anyone.</div>`
      : `<div class="mi-banner info">No plan filed and no visits logged this week.</div>`;
  }
  if (r.status === 'Pending Director') {
    return `<div class="mi-banner warn">Waiting for the <b>director</b>. Management reviews it after that.</div>`;
  }
  if (r.status === 'Pending Management') {
    return `<div class="mi-banner warn">The director approved this${it.dirApprovedBy ? ' — ' + _mie(it.dirApprovedBy) : ''}
      on ${_mie(flowDate(it.dirApprovedAt) || it.dirApprovedAt || '—')} — now waiting for <b>management</b>.</div>`;
  }
  if (r.status === 'Approved') {
    return `<div class="mi-banner good">Approved by ${_mie(it.dirApprovedBy || 'the director')}
      on ${_mie(flowDate(it.dirApprovedAt) || '—')}, then ${_mie(it.mgmtApprovedBy || 'management')}
      on ${_mie(flowDate(it.mgmtApprovedAt) || '—')}.</div>`;
  }
  if (r.status === 'Rejected') {
    return `<div class="mi-banner bad">Sent back${it.approvalNote ? ' — ' + _mie(it.approvalNote) : ''}.
      The rep has to edit it and submit it again.</div>`;
  }
  return `<div class="mi-banner info">Still a draft — the rep has not submitted it for approval.
    ${it.approvalNote ? _mie(it.approvalNote) : ''}</div>`;
}

function miObjectives(r) {
  const it = r.itinerary;
  if (!it || (!it.objectives && !it.notes)) return '';
  return `<div class="mi-note" style="margin-bottom:.9rem;">
    ${it.objectives ? `<div><b>Objectives:</b> ${_mie(it.objectives)}</div>` : ''}
    ${it.notes ? `<div><b>Notes:</b> ${_mie(it.notes)}</div>` : ''}</div>`;
}

function miDay(r, d) {
  const quiet = !d.planned.length && !d.visits.length;
  return `<div class="mi-day${quiet ? ' quiet' : ''}">
    <div class="mi-dayhead">
      <span class="d">${_mie(d.day)}</span><span class="dt">${_mie(d.date)}</span>
      <span class="n">${d.planned.length} planned · ${d.visits.length} logged</span>
    </div>
    ${quiet ? '<div class="mi-empty">Nothing planned, nothing logged.</div>'
            : miPlannedTable(d) + miVisitTable(d)}
  </div>`;
}

function miPlannedTable(d) {
  if (!d.planned.length) return '<div class="mi-sect">Planned</div><div class="mi-empty">No stops planned for this day.</div>';
  return `<div class="mi-sect">Planned</div><div style="overflow-x:auto;"><table class="mi-table">
    <thead><tr>
      <th style="width:70px;">Time</th><th style="width:15%;">Company</th><th style="width:12%;">Person to meet</th>
      <th style="width:11%;">City / area</th><th style="width:13%;">Purpose</th>
      <th style="width:16%;">Agenda</th><th style="width:16%;">Expected outcome</th><th style="width:92px;">Happened?</th>
    </tr></thead>
    <tbody>${d.planned.map(it => `<tr>
      <td>${_mie(iwTime12(it.plannedTime) || '—')}</td>
      <td class="k">${_mie(it.company || '—')}</td>
      <td>${_mie(it.personToMeet || '—')}</td>
      <td>${_mie(it.cityArea || '—')}</td>
      <td>${_mie(it.purpose || '')}</td>
      <td>${_mie(it.agenda || '')}</td>
      <td>${_mie(it.expectedOutcome || '')}</td>
      <td>${miStopTag(it)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/** What happened to a planned stop. The three answers are visually distinct on purpose. */
function miStopTag(it) {
  if (!it.match) return '<span class="mi-tag miss">Not logged</span>';
  const when = it.match.date && it.match.date !== it.date ? ` on ${_mie(it.match.date)}` : '';
  if (it.match.kind === 'exact') return `<span class="mi-tag exact">✓ Visited${when}</span>`;
  return `<span class="mi-tag likely" title="Matched on the company name only — the rep did not link this visit to the stop">~ Likely${when}</span>`;
}

function miVisitTable(d) {
  if (!d.visits.length) return '<div class="mi-sect">Logged</div><div class="mi-empty">No visits logged for this day.</div>';
  return `<div class="mi-sect">Logged</div><div style="overflow-x:auto;"><table class="mi-table">
    <thead><tr>
      <th style="width:70px;">Time</th><th style="width:15%;">Company</th><th style="width:12%;">Person visited</th>
      <th style="width:11%;">City / address</th><th style="width:14%;">Agenda</th>
      <th style="width:22%;">Summary</th><th style="width:92px;">Against plan</th><th style="width:56px;">Photo</th>
    </tr></thead>
    <tbody>${d.visits.map(v => `<tr>
      <td>${_mie(iwTime12(v.time) || '—')}</td>
      <td class="k">${_mie(v.company || '—')}</td>
      <td>${_mie(v.personVisited || '—')}</td>
      <td>${_mie(v.cityAddress || '—')}</td>
      <td>${_mie(v.agenda || '')}</td>
      <td>${_mie(v.summaryOfAgenda || '')}</td>
      <td>${miVisitTag(v)}</td>
      <td data-miphoto="${_mie(v.visitNo)}">${miPhotoCell(v)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function miVisitTag(v) {
  if (!v.match) return '<span class="mi-tag unpl">Off plan</span>';
  if (v.match.kind === 'exact') return '<span class="mi-tag exact">✓ Planned</span>';
  if (v.match.kind === 'likely') return '<span class="mi-tag likely" title="Matched on the company name only">~ Likely</span>';
  if (v.match.kind === 'duplicate') return '<span class="mi-tag dang" title="A second visit logged against the same planned stop">Duplicate</span>';
  /* A revise deletes and re-appends every item row, so a dropped stop orphans visits already logged
     against it. Saying so beats quietly reclassifying the visit as unplanned. */
  return `<span class="mi-tag dang" title="Points at ${_mie(v.match.ref)}, which is not in the current plan">Stop deleted</span>`;
}

/** Stops the rep dated outside their own week — they belong to no day card, so they get their own. */
function miStrays(r) {
  if (!r.strays.length) return '';
  return `<div class="mi-banner warn"><b>${r.strays.length} planned stop${r.strays.length === 1 ? '' : 's'}
    dated outside this week</b> (${r.strays.map(s => _mie(s.date || 'no date')).join(', ')}) —
    counted above but shown on no day.</div>`;
}

function miHistory(r) {
  const rows = miAllItins.filter(x => iwKey(x.user) === iwKey(r.rep))
    .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart))).slice(0, 12);
  if (!rows.length) return '';
  return `<div class="mi-sect" style="padding-left:0;margin-top:1rem;">${_mie(r.rep)}'s previous weeks</div>
    <div style="overflow-x:auto;"><table class="flow-table">
    <thead><tr><th>Week</th><th>Status</th><th class="num">Planned stops</th>
      <th>Director</th><th>Management</th><th>Note</th></tr></thead>
    <tbody>${rows.map(x => `<tr>
      <td><a href="#" data-week="${_mie(x.weekStart)}">${_mie(x.weekStart)} – ${_mie(x.weekEnd)}</a></td>
      <td>${_mie(x.status || 'Draft')}</td>
      <td class="num">${(x.items || []).length}</td>
      <td>${_mie(x.dirApprovedBy || '—')}</td>
      <td>${_mie(x.mgmtApprovedBy || '—')}</td>
      <td style="color:var(--text-muted);font-size:.76rem;">${_mie(x.approvalNote || '')}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/** Jump the whole page to the week a history row names, keeping the same rep selected. */
function miJumpToWeek(weekStart) {
  // Walk rather than compute: flowWeekDates owns what a week boundary is, and a second copy of that
  // arithmetic here is how the two would drift apart.
  for (let d = -260; d <= 260; d++) {
    if (flowWeekDates(flowToday(), d)[0] === weekStart) { miOffset = d; miLoad(); return; }
  }
  flowMsg('miMsg', `That week (${weekStart}) is outside the five years this page can step to.`, false);
}

/* ── photos ─────────────────────────────────────────────────────────────────────────────────── */

function miPhotoCell(v) {
  if (!v.photoDocId) return '<span style="color:#b45309;font-size:.7rem;" title="No photo on this visit">—</span>';
  const src = miPhotos[String(v.visitNo)];
  if (!src) return '<span style="color:var(--text-muted,#64748b);font-size:.7rem;">📷</span>';
  return `<img class="mi-photo" src="${src}" alt="Visit photo" loading="lazy"
    onclick="miZoom('${_mie(v.visitNo)}')">`;
}

/* Every photo is a Drive round trip returned as base64 (getVisitPhotos, FlowAPI.gs:5689), so they
   are fetched only for the rep on screen, only for days that actually have one, and only once. */
async function miLoadPhotos(r) {
  if (miPhotoDone[r.rep]) { miPatchPhotos(r); return; }
  const days = r.days.filter(d => d.visits.some(v => v.photoDocId)).map(d => d.date);
  if (!days.length) { miPhotoDone[r.rep] = true; return; }
  miPhotoDone[r.rep] = true;
  const seq = miSeq;
  try {
    const packs = await Promise.all(days.map(d =>
      fetchFlow('getVisitPhotos', { date: d, user: r.rep })
        .then(x => (x && x.data) || []).catch(() => [])));
    if (seq !== miSeq || miPick !== r.rep) return;
    packs.forEach(p => p.forEach(ph => {
      miPhotos[String(ph.visitNo)] = 'data:' + (ph.mimeType || 'image/jpeg') + ';base64,' + ph.base64;
    }));
    miPatchPhotos(r);
  } catch (e) { miPhotoDone[r.rep] = false; }
}

/** Patch only the photo cells — re-rendering the pane would throw away the reader's scroll position
    halfway down a seven-day week. */
function miPatchPhotos(r) {
  document.querySelectorAll('[data-miphoto]').forEach(td => {
    const no = td.getAttribute('data-miphoto');
    const v = r.visits.find(x => String(x.visitNo) === no);
    if (v) td.innerHTML = miPhotoCell(v);
  });
}

function miZoom(visitNo) {
  const src = miPhotos[String(visitNo)];
  if (!src) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:4000;display:flex;' +
                     'align-items:center;justify-content:center;padding:2rem;cursor:zoom-out;';
  el.innerHTML = `<img src="${src}" alt="Visit photo" style="max-width:100%;max-height:100%;border-radius:8px;">`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

/* ── approving ──────────────────────────────────────────────────────────────────────────────── */

async function miDecide(action, r) {
  if (!r.itinerary) return;
  const approve = action === 'approveWeeklyItinerary';
  let reason = '';
  if (approve) {
    if (!confirm(`Approve ${r.rep}'s plan for ${r.itinerary.weekStart} – ${r.itinerary.weekEnd}` +
                 ` (${r.counts.planned} planned stop${r.counts.planned === 1 ? '' : 's'})?`)) return;
  } else {
    reason = prompt('Send this plan back to the rep. What needs changing?', '');
    if (reason === null) return;
  }
  const btn = document.getElementById(approve ? 'miApprove' : 'miReject');
  if (btn) { btn.disabled = true; btn.textContent = approve ? 'Approving…' : 'Sending back…'; }
  try {
    const res = await postFlow(action, { itineraryNo: r.itinerary.itineraryNo, reason });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not record that.');
    flowMsg('miMsg', res.message || (approve ? 'Approved.' : 'Sent back.'), true);
    await miLoad(true);          // fresh: the decision must not be read back out of the 60s cache
  } catch (e) {
    flowMsg('miMsg', e.message, false);
    if (btn) { btn.disabled = false; btn.textContent = approve ? 'Approve' : 'Send back'; }
  }
}
