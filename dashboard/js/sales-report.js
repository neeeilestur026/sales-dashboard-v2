/* sales-report.js — A348 · the Sales Daily Report (redesigned), first on the director's dashboard, a private trial.
 *
 * The report is the count: the portal fills what it already logs (work email, PRs, quotations), the person logs a
 * call, visit or result as one line with a link, and the 4:30 report is the numbers on this page plus one line of
 * blocker (A349: the 8:00 huddle card is gone, Neil 21 Oct). A desk day is the normal day; the visit form only shows on a visit day.
 *
 * Numbers: js/sales-report-model.js (pure, tested). Saving: saveProofReport / submitProofReport / getProofReports
 * (FlowAPI 177), secured and director-only while it is a trial — nothing here touches the real call log, the client
 * visits or the quotations. Every change is saved as it is made; if a save fails it is kept on this computer. */

const SR_UI = { me: null, ix: null, day: '', saved: {}, failed: [], backend: true, backendMsg: '', state: null, unsaved: false,
                sent: null, sentState: '', received: null, receivedState: '', weekEmails: {}, weekOffset: 0, feed: 'all',
                showVisitForm: false, chain: Promise.resolve(), timer: 0, back: null, nums: null };

function _srE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _srNowMin() { const d = new Date(); return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes(); }   // Manila, UTC+8
function _srNowIso() { return new Date().toISOString(); }
function _srId(id) { return document.getElementById(id); }

/* ── the draft on this computer (only when a save has not gone through) ───────────────────────── */
function _srDraftKey(day) { return 'hx_sr_draft:' + ((SR_UI.me && SR_UI.me.username) || 'me') + ':' + day; }
function _srDraftGet(day) { try { const v = JSON.parse(localStorage.getItem(_srDraftKey(day)) || 'null'); return v && v.report ? v : null; } catch (e) { return null; } }
function _srDraftPut(day, report) { try { localStorage.setItem(_srDraftKey(day), JSON.stringify({ t: Date.now(), report })); } catch (e) {} }
function _srDraftDrop(day) { try { localStorage.removeItem(_srDraftKey(day)); } catch (e) {} }

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

async function salesReport(id) {
  const el = _srId(id);
  if (!el) return;
  const s = (typeof getSession === 'function' && getSession()) || {};
  const name = String(s.name || s.username || '').trim();
  SR_UI.me = { name, username: String(s.username || ''), first: name.split(/\s+/)[0] || 'You' };
  SR_UI.day = SR_UI.day || flowToday();
  await _srLoad(false);
}

async function _srLoad(fresh) {
  const body = _srId('srBody');
  if (body) body.innerHTML = '<div class="dh-empty">Reading your day…</div>';
  const today = flowToday(), from = srAddDays(today, -42), opt = fresh ? { fresh: true } : {};
  const failed = [];
  const get = (label, action, params) => fetchFlow(action, params || {}, opt)
    .then(r => { if (!r || r.success === false) throw new Error('no'); return r.data; })
    .catch(() => { failed.push(label); return null; });
  const saved = (typeof postFlow === 'function' ? postFlow('getProofReports', { from: srAddDays(today, -42), to: today }) : Promise.reject(new Error('no')))
    .then(r => (r && r.success ? { ok: true, data: r.data || [] } : { ok: false, message: (r && r.message) || '' }))
    .catch(e => ({ ok: false, message: String(e && e.message || '') }));
  /* A350 — the Client Book trial: its clients to link to and the day's changes. Quiet without FlowAPI 178. */
  const book = (typeof postFlow === 'function' ? postFlow('getClientBook', {}) : Promise.reject(new Error('no'))).then(r => (r && r.success ? r : null)).catch(() => null);
  const [quotations, salesOrders, quotationEmails, settings, prs, activity, calls, visits, itineraries, mine, clientBook] = await Promise.all([
    get('quotations', 'getQuotations'), get('sales orders', 'getSalesOrders'), get('quotation emails', 'getQuotationEmails'),
    get('settings', 'getFlowSettings'), get('purchase requests', 'getPricingRequests'),
    get('activity log', 'getActivityLog', { from, to: today }), get('call log', 'getSalesCalls', { from, to: today }),
    get('client visits', 'getClientVisits', { from, to: today }), get('weekly plans', 'getWeeklyItineraries'), saved, book
  ]);
  SR_UI.failed = failed;
  SR_UI.ix = srIndex({ today, quotations, salesOrders, quotationEmails, settings, prs, activity, calls, visits, itineraries, book: clientBook });
  SR_UI.saved = {};
  SR_UI.backend = mine.ok;
  SR_UI.backendMsg = mine.ok ? '' : mine.message;
  (mine.data || []).forEach(r => { if (r && r.date && String(r.user || '').toLowerCase() === SR_UI.me.name.toLowerCase()) SR_UI.saved[r.date] = r; });
  SR_UI.weekEmails = {};
  _srOpenDay(SR_UI.day);
}

/** Show one day: the saved report, or this computer's copy when a save of it did not go through. */
function _srOpenDay(day) {
  clearTimeout(SR_UI.timer);
  SR_UI.day = day;
  SR_UI.weekOffset = 0;
  SR_UI.showVisitForm = false;
  const saved = SR_UI.saved[day], draft = _srDraftGet(day);
  const savedAt = saved && saved.updatedAt ? Date.parse(saved.updatedAt) || 0 : 0;
  SR_UI.state = srFill(draft && draft.t > savedAt ? draft.report : saved ? saved.report : null);
  SR_UI.unsaved = !!(draft && draft.t > savedAt);
  SR_UI.sent = null; SR_UI.sentState = 'loading'; SR_UI.received = null; SR_UI.receivedState = 'loading';
  _srRenderDay();
  _srMail(day);
}

/* ── the mail: the day's sent list, and the inbox for received mail ───────────────────────────── */

async function _srMail(day) {
  let sent = null, sentState = 'error', received = null, receivedState = 'error';
  try {
    const r = typeof apiFetchEmailLogToday === 'function' ? await apiFetchEmailLogToday(undefined, day) : null;
    if (r && r.success !== false && !r.needsSetup) { sent = r.emails || []; sentState = 'ok'; }
    else if (r && r.needsSetup) sentState = 'setup';
  } catch (e) { sentState = 'error'; }
  if (SR_UI.day !== day) return;
  SR_UI.sent = sent; SR_UI.sentState = sentState;
  if (sent) SR_UI.weekEmails[day] = sent;
  _srRefresh();
  /* Received mail: the inbox feed (the person's own mailbox, newest first, up to 250 messages and 60 days back),
     narrowed to the day here. TODO: a date-windowed inbox read on the server, so a busy mailbox loses nothing. */
  const back = Math.round((Date.parse(SR_UI.ix.today) - Date.parse(day)) / 86400000) + 1;
  if (back <= 60 && typeof apiFetchEmailFeed === 'function' && sentState !== 'setup') {
    try {
      const r = await apiFetchEmailFeed('inbox', Math.max(1, back));
      if (r && r.success !== false && Array.isArray(r.emails || r.items || r.messages)) { received = r.emails || r.items || r.messages; receivedState = 'ok'; }
    } catch (e) { receivedState = 'error'; }
  } else if (back > 60) receivedState = 'old';
  else if (sentState === 'setup') receivedState = 'setup';
  if (SR_UI.day !== day) return;
  SR_UI.received = received; SR_UI.receivedState = receivedState;
  _srRefresh();
}

/* ── saving ───────────────────────────────────────────────────────────────────────────────────── */

/** Save the day as it stands now. Saves run one after another, so two quick changes never cross. */
function _srSave(opts) {
  const day = SR_UI.day, o = opts || {};
  const report = JSON.parse(JSON.stringify(SR_UI.state));
  _srDraftPut(day, report);
  SR_UI.unsaved = true;
  _srStatus('Saving…', '');
  SR_UI.chain = SR_UI.chain.then(async () => {
    let r;
    const params = { date: day, reportJson: JSON.stringify(report), portalJson: JSON.stringify(_srLiveNumbers()) };
    try {
      if (o.submit) r = await postFlow('submitProofReport', Object.assign(params, { snapshotJson: JSON.stringify(o.snapshot) }));
      else r = await postFlow('saveProofReport', params);
    } catch (e) { r = { success: false, message: String(e && e.message || e) }; }
    if (r && r.success) {
      const prev = SR_UI.saved[day] || {};
      SR_UI.saved[day] = Object.assign({}, prev, { date: day, user: SR_UI.me.name, report, updatedAt: r.updatedAt || _srNowIso(), reportNo: r.reportNo,
        submittedAt: r.submittedAt || prev.submittedAt || '', snapshot: o.submit ? o.snapshot : prev.snapshot || null });
      if (r.givenAt !== undefined && r.givenAt !== '') SR_UI.saved[day].report.am.givenAt = r.givenAt;
      SR_UI.backend = true;
      if (day === SR_UI.day) {
        if (r.givenAt) SR_UI.state.am.givenAt = r.givenAt;
        SR_UI.unsaved = false;
        _srDraftDrop(day);
        _srRefresh();
      }
      return r;
    }
    const msg = r && r.message ? r.message : 'The save did not go through.';
    if (r && r.alreadySubmitted && day === SR_UI.day) {
      SR_UI.saved[day] = Object.assign({}, SR_UI.saved[day] || {}, { submittedAt: r.submittedAt });
      _srRefresh();
    }
    if (day === SR_UI.day) _srStatus(/Unknown action|not a secured action/i.test(msg)
      ? 'Not saved — the FlowAPI update (177) is not pasted yet. Kept on this computer.' : 'Not saved — ' + msg + ' Kept on this computer.', 'bad');
    return r;
  });
  return SR_UI.chain;
}

function _srStatus(text, tone) {
  const el = _srId('srState');
  if (!el) return;
  el.textContent = text;
  el.className = 'sr-state' + (tone ? ' ' + tone : '');
}
function _srSetState() {
  const saved = SR_UI.saved[SR_UI.day];
  if (SR_UI.unsaved) _srStatus('Not saved yet — kept on this computer', 'warn');
  else if (saved && saved.updatedAt) _srStatus('Saved ' + srClock(saved.updatedAt), 'ok');
  else _srStatus('Nothing saved for this day yet', '');
}

/* ── the numbers right now ────────────────────────────────────────────────────────────────────── */

function _srNums() {
  const ix = SR_UI.ix, me = SR_UI.me, day = SR_UI.day, now = _srNowMin(), st = SR_UI.state;
  const dt = srDayType(ix, me, day, st);
  return { dt, portal: srPortalTiles(ix, me, day, SR_UI.sent, now), mine: srMineTiles(ix, me, day, st, now, dt),
           fu: srFollowUps(ix, me, day, st), linked: srLinked(st, day) };
}
function _srLiveNumbers() { const n = SR_UI.nums || _srNums(); return srSnapshot(n.portal, n.mine, SR_UI.day, SR_UI.state); }

/* ── the page ─────────────────────────────────────────────────────────────────────────────────── */

function _srRenderDay() {
  const head = _srId('srHead'), body = _srId('srBody'), ix = SR_UI.ix;
  if (!head || !body || !ix) return;
  const day = SR_UI.day, me = SR_UI.me;
  head.innerHTML =
    '<div class="sr-title"><h2>Sales Daily Report</h2><span class="sr-who">' + _srE(me.name) + '</span></div>' +
    '<div class="dh-actions sr-tools">' +
      '<div class="sr-daypick"><button type="button" class="sr-step" data-step="-1" aria-label="Previous day">‹</button>' +
        '<input type="date" class="sr-date" id="srDate" value="' + day + '" min="' + srAddDays(ix.today, -28) + '" max="' + ix.today + '" aria-label="Report date">' +
        '<button type="button" class="sr-step" data-step="1" aria-label="Next day">›</button></div>' +
      '<div class="sr-seg" role="group" aria-label="Day type"><button type="button" data-daytype="desk">Desk day</button><button type="button" data-daytype="visit">Visit day</button></div>' +
      '<span class="sr-state" id="srState" role="status"></span>' +
      '<button type="button" class="dh-btn" data-print>Print / PDF</button></div>' +
    '<div class="sr-chips" id="srChips"></div>';
  const notes = [];
  if (!SR_UI.backend) notes.push('<div class="dh-banner warn">Saving needs the FlowAPI update (version 177). Until it is pasted, what you log is kept on this computer only.' +
    (SR_UI.backendMsg && !/Unknown action|not a secured action/i.test(SR_UI.backendMsg) ? ' (' + _srE(SR_UI.backendMsg) + ')' : '') + '</div>');
  if (SR_UI.failed.length) notes.push('<div class="dh-banner warn">Could not read: ' + _srE(SR_UI.failed.join(', ')) + '. The numbers that need them may be short — reload the page.</div>');
  if (SR_UI.state.legacy) notes.push('<p class="dh-meta">This day was first filled in with the earlier trial form; what you typed there is kept with the report.</p>');
  body.innerHTML = notes.join('') +
    '<p class="sr-trial">Trial — only you can see this report. Nothing here changes the real call log, visits or quotations.</p>' +

    '<section class="sr-block" aria-labelledby="srNumsH"><h3 id="srNumsH">Today\'s numbers</h3>' +
      '<p class="sr-rowlab ok">The portal fills these</p><div class="sr-tiles" id="srTilesA"></div>' +
      '<p class="sr-rowlab mine">From my log lines</p><div class="sr-tiles" id="srTilesB"></div></section>' +

    '<section class="sr-block sr-two"><div class="sr-col"><h3>Follow-ups due today <span class="sr-count" id="srFuCount"></span></h3><div id="srFu"></div></div>' +
      '<div class="sr-col"><h3>Log a call — one line, right after</h3>' + _srCallForm() + '</div></section>' +

    '<section class="sr-block"><div class="sr-bar"><h3>My log today</h3><div class="sr-quick">' +
      '<button type="button" class="dh-btn" data-new="Quote result">+ Quote result</button>' +
      '<button type="button" class="dh-btn" data-new="Performance call">+ Performance call</button>' +
      '<button type="button" class="dh-btn" data-new="Sales order">+ Sales order</button></div></div>' +
      '<div class="sr-scroll"><table class="sr-table sr-log"><thead><tr><th scope="col">Time</th><th scope="col">Type</th><th scope="col">Company, person, what happened</th>' +
        '<th scope="col">Result</th><th scope="col">Link</th><th scope="col"><span class="sr-sr">Change</span></th></tr></thead><tbody id="srLog"></tbody></table></div></section>' +

    '<section class="sr-block" id="srVisits"></section>' +

    '<section class="sr-block"><div class="sr-bar"><h3>Logged by the portal — you typed none of this</h3><div class="sr-pills" role="group" aria-label="Show">' +
      ['all', 'Emails', 'PRs', 'Quotations', 'Clients'].map(k => '<button type="button" data-feed="' + (k === 'all' ? 'all' : k === 'Emails' ? 'email' : k === 'PRs' ? 'pr' : k === 'Clients' ? 'client' : 'quotation') + '">' + (k === 'all' ? 'All' : k) + '</button>').join('') +
      '</div></div><div id="srFeed"></div><p class="sr-other" id="srOther"></p></section>' +

    '<section class="sr-block sr-reports"><div class="sr-card" id="srPm"></div></section>' +

    '<section class="sr-block"><div class="sr-bar"><h3>This week</h3><div class="sr-weeknav">' +
      '<button type="button" class="sr-step" data-week="-1" aria-label="Previous week">‹</button><span id="srWeekLab"></span>' +
      '<button type="button" class="sr-step" data-week="1" aria-label="Next week">›</button></div></div>' +
      '<div class="sr-scroll"><table class="sr-table sr-week"><thead><tr><th scope="col">Day</th><th scope="col">Emails</th><th scope="col">Calls</th>' +
        '<th scope="col">Follow-ups</th><th scope="col">Quotes sent</th><th scope="col">Booked</th><th scope="col">Report</th></tr></thead><tbody id="srWeek"></tbody></table></div></section>';
  _srWire();
  _srRefresh();
}

/** Redraw everything that follows from the numbers, without touching what the person is typing in. */
function _srRefresh() {
  if (!SR_UI.ix || !_srId('srTilesA')) return;
  const n = _srNums();
  SR_UI.nums = n;
  const day = SR_UI.day, saved = SR_UI.saved[day] || {}, st = SR_UI.state;
  const dateIn = _srId('srDate');
  if (dateIn && dateIn.value !== day) dateIn.value = day;
  document.querySelectorAll('#srHead [data-daytype]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-daytype') === n.dt.type)));
  const back = document.querySelector('#srHead [data-step="-1"]'), fwd = document.querySelector('#srHead [data-step="1"]');
  if (fwd) fwd.disabled = day >= SR_UI.ix.today;
  if (back) back.disabled = day <= srAddDays(SR_UI.ix.today, -28);
  _srSetState();

  const chip = (t, tone) => '<span class="sr-chip' + (tone ? ' ' + tone : '') + '">' + _srE(t) + '</span>';
  const isToday = day === SR_UI.ix.today, now = _srNowMin();
  _srId('srChips').innerHTML =
    (n.dt.type === 'desk' ? chip('Desk day — no visit booked (normal)', '')
      : chip(n.dt.planned.length ? 'Visit day — ' + n.dt.planned.length + ' visit' + (n.dt.planned.length === 1 ? '' : 's') + ' booked' : 'Visit day — set by you, none in the plan', 'mine')) +
    (saved.submittedAt ? chip('4:30 report submitted ' + srClock(saved.submittedAt), 'ok') : chip('4:30 report due', !isToday || now >= 16 * 60 + 30 ? 'red' : '')) +
    chip('Log lines with a link: ' + n.linked.linked + ' of ' + n.linked.total, n.linked.total && n.linked.linked < n.linked.total ? 'watch' : '');

  _srId('srTilesA').innerHTML = n.portal.map(_srTileHtml).join('');
  _srId('srTilesB').innerHTML = n.mine.map(_srTileHtml).join('');
  document.querySelectorAll('#srBody .sr-bar-track > i[data-w]').forEach(i => { if (i.style && i.style.setProperty) i.style.setProperty('--sr-w', i.getAttribute('data-w')); });
  const fuDone = n.fu.filter(x => x.done).length;
  _srId('srFuCount').textContent = fuDone + ' of ' + n.fu.length + ' done';
  _srId('srFu').innerHTML = n.fu.length ? '<ul class="sr-fu">' + n.fu.map(_srFuHtml).join('') + '</ul>'
    : '<p class="dh-empty">No follow-ups fall due today. A quotation is due on day 3, 7 and 14 after it was sent.</p>';
  _srRefreshLinkSelect();
  _srId('srLog').innerHTML = _srLogRows();
  /* What holds a form is redrawn only when its shape changes, and never under the person's cursor. */
  /* A351 — only a FIELD being typed in holds a redraw back; the Submit button just clicked kept the 4:30 card on "Due". */
  const typingIn = (el) => { const a = document.activeElement; return !!(el && a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '')); };
  const vKey = [n.dt.type, SR_UI.showVisitForm, (st.visits || []).length, n.dt.planned.length, (SR_UI.sent || []).length].join('|');
  const vBox = _srId('srVisits');
  if (vBox.dataset.key !== vKey && !typingIn(vBox)) { vBox.dataset.key = vKey; vBox.innerHTML = _srVisitsHtml(n.dt); }
  _srRenderFeed();
  if (!typingIn(_srId('srPm'))) _srId('srPm').innerHTML = _srPmHtml(n, saved);
  _srRenderWeek();
}

function _srTileHtml(t) {
  const st = { ok: 'on pace', watch: 'watch', red: 'red', none: '', nr: 'not counted' }[t.status] || '';
  return '<button type="button" class="sr-tile s-' + t.status + '" data-rec="' + t.key + '">' +
    '<span class="l">' + _srE(t.label) + '</span><span class="v">' + _srE(t.text) + '</span>' +
    (t.bar !== null && t.bar !== undefined ? '<span class="sr-bar-track" aria-hidden="true"><i data-w="' + Math.max(0, Math.min(1, t.bar)).toFixed(3) + '"></i></span>' : '<span class="sr-bar-none" aria-hidden="true"></span>') +
    '<span class="t">' + _srE(t.target) + '</span>' + (st ? '<span class="st">' + st + '</span>' : '') + '</button>';
}

function _srFuHtml(x) {
  return '<li class="' + (x.done ? 'done' : '') + '"><span class="who"><b>' + _srE(x.client) + '</b><span class="sr-sub">' + _srRef(x.ref) + ' · ' + _srE(srMoney(x.value)) + '</span></span>' +
    '<span class="sr-daytag">Day ' + x.step + '</span>' +
    (x.done ? '<span class="sr-called">' + (x.by.kind === 'Call' ? 'Called ✓' : 'Emailed ✓') + (x.by.result ? ' — ' + _srE(x.by.result) : '') + '</span>'
            : '<button type="button" class="btn-sm primary" data-logcall="' + _srE(x.ref) + '">Log call</button>') + '</li>';
}

/* the call form: one line, right after the call. A356 — the company and the person can be picked from the Client Book. */
function _srCallForm() {
  return '<form class="sr-form" id="srCallForm" autocomplete="off">' +
    '<div class="sr-grid2"><label>Company<input type="text" class="sr-in" name="company" list="srBookCos" required placeholder="Type, or pick from the Client Book"></label>' +
      '<label>Person and position<input type="text" class="sr-in" name="person" list="srBookPeople" placeholder="R. Cruz, maintenance planner"></label></div>' +
    '<datalist id="srBookCos">' + _srBookCosHtml() + '</datalist><datalist id="srBookPeople"></datalist>' +
    '<p class="sr-help sr-callhint" id="srCallHint" aria-live="polite"></p>' +
    '<fieldset class="sr-results"><legend>Result</legend>' +
      SR_CALL_RESULTS.map(r => '<label class="sr-pill' + (r === 'Booked' ? ' goal' : '') + '"><input type="radio" name="result" value="' + r + '"' + (r === 'Reached' ? ' checked' : '') + '>' +
        '<span>' + (r === 'Call back' ? 'Call back on…' : r) + '</span></label>').join('') + '</fieldset>' +
    '<div class="sr-grid2"><label>Next step date<input type="date" class="sr-in" name="nextDate"></label>' +
      '<label>Link to<select class="sr-in" name="link" id="srCallLink"></select></label></div>' +
    '<label>What happened (one line)<input type="text" class="sr-in" name="note" maxlength="200" placeholder="Decision on 3 Nov"></label>' +
    '<div class="sr-formfoot"><span class="sr-help">Log within 15 minutes of the call. The time is set when you save.</span>' +
      '<button type="submit" class="btn-sm primary">Log call</button></div></form>';
}
/** A356 — the Client Book's companies to pick from, the person's own first; each shows its labels. */
function _srBookCosHtml() {
  if (!SR_UI.ix || !SR_UI.ix.book) return '';
  return srBookClients(SR_UI.ix, SR_UI.me).map(c => '<option value="' + _srE(c.company) + '">' +
    _srE([c.tier, c.sector, c.accreditation, c.status, c.owner && !_srSame(c.owner, SR_UI.me.name) ? c.owner + '\'s client' : ''].filter(Boolean).join(' · ')) + '</option>').join('');
}
/** What the Client Book says about the company and person typed: the client's labels, and the contact's numbers. */
function _srCallHintHtml(r, company) {
  if (!r.client) return _srS(company).length >= 3 && SR_UI.ix.book.clients.length ? 'Not in the Client Book.' : '';
  const c = r.client, p = r.contact;
  return '<span class="sr-chip mine">Client Book</span> ' + _srE([c.tier, c.sector, c.accreditation, c.status].filter(Boolean).join(' · ')) +
    (r.people.length && !p ? ' — ' + r.people.length + ' contact' + (r.people.length === 1 ? '' : 's') + ' to pick from' : '') +
    (p ? '<span class="sr-sub">' + _srE(srContactLabel(p)) + ': ' + _srE((p.phones || []).concat(p.emails || []).join(' · ') || 'no number on file') + '</span>' : '');
}
/** Typing or picking the company or the person: fill the person list, link the call to the client, show what is on file. */
function _srCallLookup(f, changed) {
  if (!f || !SR_UI.ix) return;
  const r = srCallLookup(SR_UI.ix, SR_UI.me, f.elements.company.value, f.elements.person.value);
  if (changed === 'company') {
    const dl = _srId('srBookPeople');
    if (dl) dl.innerHTML = r.people.map(p => '<option value="' + _srE(srContactLabel(p) || (p.emails || [])[0] || (p.phones || [])[0]) + '">' +
      _srE((p.primary ? 'Main contact · ' : '') + ((p.phones || [])[0] || (p.emails || [])[0] || '')) + '</option>').join('');
    const sel = f.elements.link, cur = sel ? sel.value : '';
    if (r.link && sel && (!cur || cur === 'none|' || f.dataset.autolink)) {
      const v = 'client|' + r.link.linkId;
      if (Array.prototype.some.call(sel.options, o => o.value === v)) { sel.value = v; f.dataset.autolink = '1'; }
    } else if (!r.link && sel && f.dataset.autolink) { sel.value = 'none|'; delete f.dataset.autolink; }
  }
  const hint = _srId('srCallHint');
  if (hint) hint.innerHTML = _srCallHintHtml(r, f.elements.company.value);
}
function _srLinkOptionsHtml(selected, selectedLabel) {
  const o = srLinkOptions(SR_UI.ix, SR_UI.me, SR_UI.day, SR_UI.sent, SR_UI.received);
  const opt = (type, x) => '<option value="' + type + '|' + _srE(x.id) + '"' + (selected === type + '|' + x.id ? ' selected' : '') + '>' + _srE(x.label) + '</option>';
  /* A line's own link stays on offer even when it is not in today's lists (a DR number, a client PO, yesterday's email),
     so editing a line never drops its link without the person choosing to. */
  const listed = Object.keys(o).some(type => o[type].some(x => selected === type + '|' + x.id));
  const own = selected && selected.indexOf('none|') !== 0 && !listed
    ? '<option value="' + _srE(selected) + '" selected>' + _srE('Keep: ' + (selectedLabel || selected.split('|')[1])) + '</option>' : '';
  return own + '<option value="none|">No link (new contact)</option>' +
    (o.quotation.length ? '<optgroup label="My open quotations">' + o.quotation.map(x => opt('quotation', x)).join('') + '</optgroup>' : '') +
    (o.pr.length ? '<optgroup label="My recent PRs">' + o.pr.map(x => opt('pr', x)).join('') + '</optgroup>' : '') +
    (o.client.length ? '<optgroup label="Clients (Client Book)">' + o.client.map(x => opt('client', x)).join('') + '</optgroup>' : '') +
    (o.email.length ? '<optgroup label="Today\'s emails">' + o.email.map(x => opt('email', x)).join('') + '</optgroup>' : '');
}
function _srRefreshLinkSelect() {
  const cos = _srId('srBookCos');
  if (cos) cos.innerHTML = _srBookCosHtml();
  const sel = _srId('srCallLink');
  if (!sel || document.activeElement === sel) return;
  const keep = sel.value;
  sel.innerHTML = _srLinkOptionsHtml(keep);
  if (keep && Array.prototype.some.call(sel.options, o => o.value === keep)) sel.value = keep;
}
function _srLinkLabel(value) {
  const [type, id] = String(value || 'none|').split('|');
  if (!id) return { linkType: 'none', linkId: '', linkLabel: '' };
  const o = srLinkOptions(SR_UI.ix, SR_UI.me, SR_UI.day, SR_UI.sent, SR_UI.received);
  const hit = (o[type] || []).find(x => x.id === id);
  return { linkType: type, linkId: id, linkLabel: hit ? hit.label : id };
}

/* my log today: the lines, then the calls and visits already in the portal (grey) */
function _srLogRows() {
  const day = SR_UI.day, lines = (SR_UI.state.lines || []).filter(l => flowDate(l.loggedAt) === day).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const rows = lines.map(l => {
    const link = l.linkType && l.linkType !== 'none' && l.linkId
      ? '<span class="sr-link">' + (l.linkType === 'quotation' || l.linkType === 'pr' ? _srRef(l.linkId)
          : l.linkType === 'client' ? '<a href="director-client-book.html?client=' + encodeURIComponent(l.linkId) + '">' + _srE(l.linkLabel || l.linkId) + '</a>' : _srE(l.linkLabel || l.linkId)) + '</span>'
      : (l.voidedAt ? '—' : '<button type="button" class="sr-nolink" data-addlink="' + l.id + '">No link — add one</button>');
    return '<tr class="' + (l.voidedAt ? 'void' : '') + '"><td class="tm">' + _srE(srClock(l.loggedAt)) + '</td><td>' + _srE(l.type) + '</td>' +
      '<td><b>' + _srE(l.company || '—') + '</b>' + (l.person ? ' · ' + _srE(l.person) : '') + (l.note ? '<span class="sr-sub">' + _srE(l.note) + '</span>' : '') +
        (l.voidedAt ? '<span class="sr-sub">Voided ' + _srE(srClock(l.voidedAt)) + ': ' + _srE(l.voidReason) + '</span>' : '') +
        (l.editedAt && !l.voidedAt ? '<span class="sr-sub">Edited ' + _srE(srClock(l.editedAt)) + ': ' + _srE(l.editReason) + '</span>' : '') + '</td>' +
      '<td>' + _srE(l.result || '—') + (l.reason ? '<span class="sr-sub">' + _srE(l.reason) + '</span>' : '') + (l.nextDate ? '<span class="sr-sub">next ' + _srE(l.nextDate) + '</span>' : '') + '</td>' +
      '<td>' + link + '</td><td class="act">' + (l.voidedAt ? '' : '<button type="button" class="sr-mini" data-edit="' + l.id + '">Edit</button><button type="button" class="sr-mini" data-void="' + l.id + '">Void</button>') + '</td></tr>';
  });
  const grey = srCallLog(SR_UI.ix, SR_UI.me, day).map(c => ({ c, type: 'Call' })).concat(srVisitLog(SR_UI.ix, SR_UI.me, day).map(c => ({ c, type: 'Visit' })))
    .map(({ c, type }) => '<tr class="grey"><td class="tm">' + _srE(c.time || '—') + '</td><td>' + type + '</td><td><b>' + _srE(c.company || '—') + '</b>' + (c.person ? ' · ' + _srE(c.person) : '') +
      (c.note ? '<span class="sr-sub">' + _srE(c.note) + '</span>' : '') + '</td><td>' + _srE(c.result || '—') + '</td><td><span class="sr-tag">' + _srE(c.ref) + ' · in the portal\'s log</span></td><td></td></tr>');
  return rows.concat(grey).join('') || '<tr><td colspan="6" class="dh-empty">No lines yet today. Log each call, result or visit as one line, right after.</td></tr>';
}

/* client visits: a slim card on a desk day, the visit form on a visit day */
function _srVisitsHtml(dt) {
  const visits = (SR_UI.state.visits || []).filter(v => flowDate(v.loggedAt) === SR_UI.day);
  const list = visits.length ? '<ul class="sr-visits">' + visits.map(v => '<li><b>' + _srE(v.time || srClock(v.loggedAt)) + ' ' + _srE(v.company) + '</b>' + (v.person ? ' · ' + _srE(v.person) : '') +
    '<span class="sr-sub">' + _srE([v.asked && 'Asked: ' + v.asked, v.result, v.recapSubject && 'Recap: ' + v.recapSubject].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>' : '';
  if (dt.type === 'desk' && !SR_UI.showVisitForm) {
    return '<div class="sr-desk"><p><b>Client visits</b> — none booked today. A normal desk day. Nothing to fill here.</p>' +
      '<button type="button" class="dh-btn" data-unplanned>Log an unplanned visit</button></div>' + list;
  }
  const plan = dt.planned.map(p => '<option value="' + _srE(p.ref) + '">' + _srE([p.time, p.company, p.person].filter(Boolean).join(' · ')) + '</option>').join('');
  const recaps = (SR_UI.sent || []).map(e => '<option value="' + _srE(e.messageId) + '">' + _srE(srClock(e.sentAt) + ' — ' + (e.subject || '(no subject)')) + '</option>').join('');
  return '<h3>Client visits' + (dt.planned.length ? ' <span class="sr-count">' + dt.planned.length + ' booked</span>' : '') + '</h3>' + list +
    '<form class="sr-form" id="srVisitForm" autocomplete="off"><div class="sr-grid3">' +
      '<label>Time of visit<input type="time" class="sr-in" name="time"></label>' +
      '<label>Person visited<input type="text" class="sr-in" name="person"></label>' +
      '<label>Company<input type="text" class="sr-in" name="company" required></label>' +
      '<label>City / address<input type="text" class="sr-in" name="city"></label>' +
      '<label>Against the plan<select class="sr-in" name="planItem"><option value="">Unplanned visit</option>' + plan + '</select></label>' +
      '<label>Result<select class="sr-in" name="result">' + SR_VISIT_RESULTS.map(r => '<option>' + r + '</option>').join('') + '</select></label></div>' +
    '<label>What they asked<input type="text" class="sr-in" name="asked" placeholder="1&quot; torque wrench, sockets, nut splitter"></label>' +
    '<label>Summary<input type="text" class="sr-in" name="summary"></label>' +
    '<label>Recap email<select class="sr-in" name="recap"><option value="">No recap email yet</option>' + recaps + '</select></label>' +
    '<div class="sr-formfoot"><span class="sr-help">The visit photo is attached when this goes live; the trial does not store photos.</span>' +
      '<button type="submit" class="btn-sm primary">Save visit</button></div></form>';
}

/* the portal's own feed */
function _srRenderFeed() {
  const box = _srId('srFeed');
  if (!box) return;
  document.querySelectorAll('#srBody [data-feed]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-feed') === SR_UI.feed)));
  const items = srPortalFeed(SR_UI.ix, SR_UI.me, SR_UI.day, SR_UI.sent, SR_UI.received).filter(x => SR_UI.feed === 'all' || x.kind === SR_UI.feed);
  const booked = SR_UI.state.bookings || [];
  const mailNote = SR_UI.sentState === 'loading' ? 'Reading your mailbox…'
    : SR_UI.sentState === 'setup' ? 'Your mailbox is not connected to the portal, so emails cannot be listed.'
    : SR_UI.sentState === 'error' ? 'Could not read your sent mail just now.'
    : SR_UI.receivedState === 'ok' ? '' : SR_UI.receivedState === 'loading' ? 'Reading received mail…'
    : SR_UI.receivedState === 'old' ? 'Received mail is only read for the last 60 days.' : 'Received mail could not be read; only sent mail is shown.';
  box.innerHTML = (items.length ? '<ul class="sr-feed">' + items.map(x => '<li><span class="tm">' + _srE(x.time || '—') + '</span><span class="sr-type t-' + x.kind + '">' +
      (x.kind === 'email' ? 'Email' : x.kind === 'pr' ? 'PR' : x.kind === 'client' ? 'Client' : 'Quotation') + '</span><span class="x">' + (x.ref ? _srRef(x.ref) + ' ' : '') + _srE(x.text) +
      (x.client ? ' · <a href="director-client-book.html?client=' + encodeURIComponent(x.client.no) + '">' + _srE(x.client.company) + '</a>' : '') + '</span>' +   // A358
      (x.kind === 'email' && x.sent && x.id ? '<button type="button" class="sr-mini' + (booked.indexOf(x.id) >= 0 ? ' on' : '') + '" data-book="' + _srE(x.id) + '">' + (booked.indexOf(x.id) >= 0 ? 'Booking ✓' : 'Mark as a booking') + '</button>' : '<span></span>') +
      '</li>').join('') + '</ul>' : '<p class="dh-empty">Nothing for this filter on this day.</p>') + (mailNote ? '<p class="dh-meta">' + _srE(mailNote) + '</p>' : '');
  const o = srOtherActivity(SR_UI.ix, SR_UI.me, SR_UI.day);
  _srId('srOther').textContent = 'Other portal activity today: Inventory ' + o.inventory + ' · PDFs ' + o.pdfs + ' · Tasks ' + o.tasks + ' (not part of the sales report)';
}

/* the two reports */
function _srPmHtml(n, saved) {
  const st = SR_UI.state, live = {};
  n.portal.concat(n.mine).forEach(t => { live[t.key] = t.text; });
  const sub = saved.submittedAt, snap = sub && saved.snapshot ? saved.snapshot : null;
  const val = (k) => (snap && snap[k] ? snap[k].text : live[k] || '—');
  const nums = [['Emails', 'emailsSent'], ['Calls', 'calls'], ['Follow-ups', 'followUps'], ['RFQs', 'rfqs'], ['Quotes', 'quotesSent'], ['Booked', 'booked']];
  return '<div class="sr-cardhead"><h3>4:30 report</h3><span class="sr-chip ' + (sub ? 'ok' : '') + '">' + (sub ? 'Submitted ' + _srE(srClock(sub)) : 'Due') + '</span></div>' +
    '<dl class="sr-nums">' + nums.map(([l, k]) => '<div><dt>' + l + '</dt><dd>' + _srE(val(k)) + '</dd></div>').join('') + '</dl>' +
    (sub ? '<p class="sr-help">These are the numbers as submitted; editing a line now does not change them.' + (saved.report && saved.report.pm && saved.report.pm.blocker ? ' Blocker: ' + _srE(saved.report.pm.blocker) : '') + '</p>'
         : '<label class="sr-line">Blocker or help needed (one line — or "no blocker")<input type="text" class="sr-in" id="srBlocker" maxlength="200" value="' + _srE(st.pm.blocker) + '" placeholder="no blocker"></label>' +
           '<div class="sr-formfoot"><span class="sr-help">Submitting fixes every number on this page for the day.</span><button type="button" class="btn-sm primary" data-submitpm>Submit 4:30 report</button></div>');
}

/* the week */
function _srRenderWeek() {
  const tb = _srId('srWeek');
  if (!tb) return;
  const base = srAddDays(SR_UI.day, SR_UI.weekOffset * 7);
  const w = srWeek(SR_UI.ix, SR_UI.me, base, Object.assign({}, SR_UI.saved, { [SR_UI.day]: Object.assign({}, SR_UI.saved[SR_UI.day] || {}, { report: SR_UI.state }) }), SR_UI.weekEmails);
  _srId('srWeekLab').textContent = 'Week of ' + srDayLong(w.days[0]).replace(/^\w+ /, '');
  const prev = document.querySelector('#srBody [data-week="-1"]'), next = document.querySelector('#srBody [data-week="1"]');
  if (prev) prev.disabled = w.days[0] <= srAddDays(SR_UI.ix.today, -35);
  if (next) next.disabled = w.days[6] >= SR_UI.ix.today;
  const td = (v, tone) => '<td class="' + (tone || '') + '">' + v + '</td>';
  const noMail = SR_UI.sentState === 'setup';   // "…" only while a day's mail is being read; "—" when it cannot be
  const mailCell = (r) => (r.emails !== null ? r.emails : noMail || SR_UI.weekEmails[r.day] === null ? '—' : '<span class="sr-dim">…</span>');
  tb.innerHTML = w.rows.map(r => {
    const lab = '<th scope="row"' + (r.day === SR_UI.day ? ' class="cur"' : '') + '>' + srDow(r.day) + ' ' + Number(r.day.slice(8)) + '</th>';
    if (r.future) return '<tr class="future">' + lab + '<td colspan="6">—</td></tr>';
    return '<tr>' + lab + td(mailCell(r), r.emailTone) + td(r.calls, r.callTone) +
      td(r.fuDue ? r.fuDone + ' of ' + r.fuDue : '—', r.fuDue ? (r.fuDone === r.fuDue ? 'ok' : 'red') : '') + td(r.quotes) + td(r.booked) +
      td(r.report.state === 'done' ? '✓ ' + _srE(r.report.time) : r.report.state === 'due' ? 'due' : '—', r.report.state === 'done' ? 'ok' : r.report.state === 'due' ? 'watch' : '') + '</tr>';
  }).join('') + '<tr class="total"><th scope="row">Week</th>' +
    td(w.totals.emails === null ? (noMail ? '—' : '…') : w.totals.emails + ' / ' + w.totals.emailsTarget) + td(w.totals.calls + ' / ' + w.totals.callsTarget) +
    td(w.totals.fuDue ? w.totals.fuDone + ' of ' + w.totals.fuDue : '—') + td(w.totals.quotes + ' / ' + w.totals.quotesTarget) + td(w.totals.booked) +
    td(w.totals.reports + ' of ' + w.totals.reportDays) + '</tr>';
  _srWeekMail(w.days.filter(d => d <= SR_UI.ix.today && SR_UI.weekEmails[d] === undefined));
}
/** One sent-mail read per past day of the shown week, three at a time; a day that cannot be read shows "…" no more. */
let _srWeekBusy = false;
async function _srWeekMail(days) {
  if (_srWeekBusy || !days.length || typeof apiFetchEmailLogToday !== 'function' || SR_UI.sentState === 'setup') return;
  _srWeekBusy = true;
  for (let i = 0; i < days.length; i += 3) {
    await Promise.all(days.slice(i, i + 3).map(d => apiFetchEmailLogToday(undefined, d)
      .then(r => { SR_UI.weekEmails[d] = r && r.success !== false && !r.needsSetup ? (r.emails || []) : null; })
      .catch(() => { SR_UI.weekEmails[d] = null; })));
  }
  _srWeekBusy = false;
  _srRenderWeek();
}

/* ── what the person does ─────────────────────────────────────────────────────────────────────── */

function _srWire() {
  const head = _srId('srHead'), body = _srId('srBody');
  if (!head.dataset.wired) {
    head.dataset.wired = '1';
    head.addEventListener('click', ev => {
      const b = ev.target.closest ? ev.target.closest('button') : null;
      if (!b) return;
      if (b.hasAttribute('data-step')) _srStep(Number(b.getAttribute('data-step')));
      else if (b.hasAttribute('data-daytype')) _srSetDayType(b.getAttribute('data-daytype'));
      else if (b.hasAttribute('data-print')) _srPrint();
    });
    head.addEventListener('change', ev => {
      if (ev.target && ev.target.id === 'srDate') {
        const d = ev.target.value;
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= SR_UI.ix.today && d >= srAddDays(SR_UI.ix.today, -28)) _srOpenDay(d);
        else ev.target.value = SR_UI.day;
      }
    });
  }
  if (body.dataset.wired) return;
  body.dataset.wired = '1';
  body.addEventListener('click', ev => {
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    if (b.hasAttribute('data-rec')) _srRecordsOpen(b.getAttribute('data-rec'), b);
    else if (b.hasAttribute('data-logcall')) _srPrefillCall(b.getAttribute('data-logcall'));
    else if (b.hasAttribute('data-new')) _srLineDialog(b.getAttribute('data-new'), null, b);
    else if (b.hasAttribute('data-edit')) _srLineDialog(null, b.getAttribute('data-edit'), b);
    else if (b.hasAttribute('data-void')) _srVoidDialog(b.getAttribute('data-void'), b);
    else if (b.hasAttribute('data-addlink')) _srLinkDialog(b.getAttribute('data-addlink'), b);
    else if (b.hasAttribute('data-unplanned')) { SR_UI.showVisitForm = true; _srRefresh(); const f = _srId('srVisitForm'); if (f && f.elements.time.focus) f.elements.time.focus(); }
    else if (b.hasAttribute('data-feed')) { SR_UI.feed = b.getAttribute('data-feed'); _srRenderFeed(); }
    else if (b.hasAttribute('data-book')) _srToggleBooking(b.getAttribute('data-book'));
    else if (b.hasAttribute('data-submitpm')) _srSubmitPm();
    else if (b.hasAttribute('data-week')) { SR_UI.weekOffset += Number(b.getAttribute('data-week')); _srRenderWeek(); }
  });
  body.addEventListener('submit', ev => {
    ev.preventDefault();
    if (ev.target.id === 'srCallForm') _srLogCall(ev.target);
    else if (ev.target.id === 'srVisitForm') _srSaveVisit(ev.target);
  });
  body.addEventListener('change', ev => {
    const t = ev.target;
    if (t && t.id === 'srBlocker') _srOneLine(t);
    if (t && t.id === 'srCallLink' && t.form) delete t.form.dataset.autolink;   // A356 — a link chosen by hand stays
  });
  body.addEventListener('input', ev => {           // the one-line answers live in the report as they are typed; saved on change
    const t = ev.target;
    if (t && t.form && t.form.id === 'srCallForm' && (t.name === 'company' || t.name === 'person')) _srCallLookup(t.form, t.name);   // A356
    if (t && t.id === 'srBlocker') { SR_UI.state.pm.blocker = t.value.trim(); t.removeAttribute('aria-invalid'); }
  });
}

function _srStep(dir) {
  const today = SR_UI.ix.today, d = srAddDays(SR_UI.day, dir);
  if (d > today || d < srAddDays(today, -28)) return;
  _srOpenDay(d);
}
function _srSetDayType(type) {
  const dt = srDayType(SR_UI.ix, SR_UI.me, SR_UI.day, Object.assign({}, SR_UI.state, { dayTypeOverridden: false }));
  SR_UI.state.dayType = type;
  SR_UI.state.dayTypeOverridden = type !== dt.auto;
  if (type === 'desk') SR_UI.showVisitForm = false;
  _srRefresh();
  _srSave();
}
function _srOneLine(input) {
  SR_UI.state.pm.blocker = input.value.trim();
  _srSave();
}
function _srSubmitPm() {
  const bl = _srId('srBlocker');
  if (bl) SR_UI.state.pm.blocker = bl.value.trim();
  if (!SR_UI.state.pm.blocker) { if (bl) { bl.focus(); bl.setAttribute('aria-invalid', 'true'); } _srStatus('Type one line of blocker — or "no blocker" — first.', 'bad'); return; }
  const n = _srNums();
  const snap = srSnapshot(n.portal, n.mine, SR_UI.day, SR_UI.state);
  snap.at = _srNowIso();
  _srSave({ submit: true, snapshot: snap });
}
function _srToggleBooking(id) {
  const list = SR_UI.state.bookings, i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.push(id);
  _srRefresh();
  _srSave();
}

function _srPrefillCall(qno) {
  const f = _srId('srCallForm'), q = SR_UI.ix.qByNo[qno];
  if (!f || !q) return;
  f.elements.company.value = q.customer || '';
  _srRefreshLinkSelect();
  _srCallLookup(f, 'company');
  f.elements.link.value = 'quotation|' + qno;
  delete f.dataset.autolink;
  f.dataset.followup = qno;
  if (f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
  if (f.elements.person.focus) f.elements.person.focus();
}
function _srLogCall(f) {
  const company = f.elements.company.value.trim();
  if (!company) { f.elements.company.focus(); return; }
  const result = (Array.prototype.find.call(f.elements.result, r => r.checked) || {}).value || 'Reached';
  const link = _srLinkLabel(f.elements.link.value);
  const book = srCallLookup(SR_UI.ix, SR_UI.me, company, '');   // A356 — a Client Book company is saved as the book spells it
  const line = srNewLine(Object.assign({ type: 'Call', company: book.client ? book.client.company : company, person: f.elements.person.value.trim(), note: f.elements.note.value.trim(),
                                         result, nextDate: f.elements.nextDate.value }, link), SR_UI.me.name, _srNowIso());
  SR_UI.state.lines.push(line);
  f.reset();
  delete f.dataset.followup;
  delete f.dataset.autolink;
  if (_srId('srBookPeople')) _srId('srBookPeople').innerHTML = '';
  if (_srId('srCallHint')) _srId('srCallHint').innerHTML = '';
  _srRefresh();
  _srSave();
}
function _srSaveVisit(f) {
  const el = f.elements, company = el.company.value.trim();
  if (!company) { el.company.focus(); return; }
  const now = _srNowIso(), recap = el.recap.value, mail = (SR_UI.sent || []).find(e => e.messageId === recap);
  const visit = { id: 'V' + Date.now().toString(36), time: el.time.value, person: el.person.value.trim(), company, city: el.city.value.trim(),
                  asked: el.asked.value.trim(), summary: el.summary.value.trim(), planItem: el.planItem.value, recapEmailId: recap,
                  recapSubject: mail ? mail.subject || '' : '', result: el.result.value, loggedAt: now };
  SR_UI.state.visits.push(visit);
  SR_UI.state.lines.push(srNewLine({ type: 'Visit', company, person: visit.person, note: visit.asked || visit.summary, result: visit.result,
    linkType: recap ? 'email' : 'none', linkId: recap, linkLabel: mail ? 'Recap: ' + (mail.subject || '') : '' }, SR_UI.me.name, now));
  SR_UI.showVisitForm = false;
  _srRefresh();
  _srSave();
}

/* ── dialogs: a new or edited line, a void, a link ────────────────────────────────────────────── */

function _srOverlay() {
  let ov = _srId('srOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay sr-overlay';
  ov.id = 'srOverlay';
  ov.innerHTML = '<div class="flow-modal sr-modal" role="dialog" aria-modal="true" aria-labelledby="srDlgTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', ev => {
    if (ev.target === ov) { _srClose(); return; }
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (b && b.hasAttribute('data-close')) _srClose();
  });
  ov.addEventListener('submit', ev => { ev.preventDefault(); if (typeof SR_UI.onSubmit === 'function') SR_UI.onSubmit(ev.target); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && ov.classList.contains('open')) _srClose(); });
  return ov;
}
function _srDialog(title, sub, inner, back, onSubmit) {
  const ov = _srOverlay(), box = ov.querySelector('.sr-modal');
  SR_UI.back = back || null;
  SR_UI.onSubmit = onSubmit || null;
  box.innerHTML = '<header class="sr-mhead"><div><h3 id="srDlgTitle">' + _srE(title) + '</h3>' + (sub ? '<p class="dh-meta">' + _srE(sub) + '</p>' : '') + '</div>' +
    '<button type="button" class="dh-btn" data-close>Close</button></header>' + inner;
  ov.classList.add('open');
  document.body.classList.add('sr-open');
  box.scrollTop = 0;
  const first = box.querySelector('input, select, textarea') || box.querySelector('[data-close]');
  if (first && first.focus) first.focus();
}
function _srClose() {
  const ov = _srId('srOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('sr-open');
  SR_UI.onSubmit = null;
  if (SR_UI.back && SR_UI.back.focus) SR_UI.back.focus();
}

/** + Quote result / + Performance call / + Sales order, and Edit on any line. */
function _srLineDialog(type, editId, back) {
  const line = editId ? SR_UI.state.lines.find(l => l.id === editId) : null;
  const t = line ? line.type : type, v = line || {};
  const linkVal = v.linkType && v.linkType !== 'none' ? v.linkType + '|' + v.linkId : '';
  const own = srLinkOptions(SR_UI.ix, SR_UI.me, SR_UI.day, SR_UI.sent, SR_UI.received);
  const quoteSel = '<label>Quotation<select class="sr-in" name="link" required><option value="">Choose…</option>' +
    own.quotation.map(x => '<option value="quotation|' + _srE(x.id) + '"' + (linkVal === 'quotation|' + x.id ? ' selected' : '') + '>' + _srE(x.label) + '</option>').join('') + '</select></label>';
  const pills = (name, list, cur) => '<fieldset class="sr-results"><legend>Result</legend>' + list.map(r => '<label class="sr-pill"><input type="radio" name="' + name + '" value="' + r + '"' +
    ((cur || list[0]) === r ? ' checked' : '') + '><span>' + r + '</span></label>').join('') + '</fieldset>';
  let fields;
  if (t === 'Quote result') {
    fields = quoteSel + pills('result', ['Won', 'Lost'], v.result) +
      '<label>If lost, why<select class="sr-in" name="reason"><option value="">—</option>' + SR_LOST_REASONS.map(r => '<option' + (v.reason === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></label>' +
      '<label>What happened (one line)<input type="text" class="sr-in" name="note" value="' + _srE(v.note) + '"></label>' +
      '<p class="sr-help">In the trial this line does not change the quotation. When it goes live, Lost closes the quotation and Won waits for its sales order.</p>';
  } else if (t === 'Performance call') {
    fields = '<div class="sr-grid2"><label>Company<input type="text" class="sr-in" name="company" list="srBookCos" required value="' + _srE(v.company) + '"></label>' +
      '<label>Person and position<input type="text" class="sr-in" name="person" value="' + _srE(v.person) + '"></label></div>' +
      pills('result', ['OK', 'Problem'], v.result) +
      '<div class="sr-grid2"><label>DR no.<input type="text" class="sr-in" name="dr" value="' + _srE(v.linkType === 'dr' ? v.linkId : '') + '" placeholder="DR-0207"></label>' +
      '<label>If a problem, owner<input type="text" class="sr-in" name="reason" value="' + _srE(v.reason) + '" placeholder="Who fixes it"></label></div>' +
      '<label>What happened (one line)<input type="text" class="sr-in" name="note" value="' + _srE(v.note) + '" placeholder="Pump working, next shutdown in Feb"></label>' +
      '<p class="sr-help">A performance call is made 7 days after a delivery.</p>';
  } else if (t === 'Sales order') {
    fields = '<div class="sr-grid2"><label>Company<input type="text" class="sr-in" name="company" list="srBookCos" required value="' + _srE(v.company) + '"></label>' +
      '<label>Client PO no.<input type="text" class="sr-in" name="result" required value="' + _srE(v.result) + '" placeholder="4500-0000"></label></div>' +
      '<div class="sr-grid2"><label>Amount (₱)<input type="text" class="sr-in" inputmode="decimal" name="reason" value="' + _srE(v.reason) + '" placeholder="186400"></label>' +
      '<label>Client PO email<select class="sr-in" name="link"><option value="none|">No email linked</option>' +
        own.email.map(x => '<option value="client_po|' + _srE(x.id) + '"' + (linkVal === 'client_po|' + x.id ? ' selected' : '') + '>' + _srE(x.label) + '</option>').join('') + '</select></label></div>' +
      '<label>What happened (one line)<input type="text" class="sr-in" name="note" value="' + _srE(v.note) + '"></label>';
  } else {
    fields = '<div class="sr-grid2"><label>Company<input type="text" class="sr-in" name="company" list="srBookCos" required value="' + _srE(v.company) + '"></label>' +
      '<label>Person and position<input type="text" class="sr-in" name="person" value="' + _srE(v.person) + '"></label></div>' +
      '<div class="sr-grid2"><label>Result<input type="text" class="sr-in" name="result" value="' + _srE(v.result) + '"></label>' +
      '<label>Next step date<input type="date" class="sr-in" name="nextDate" value="' + _srE(v.nextDate) + '"></label></div>' +
      '<label>Link to<select class="sr-in" name="link">' + _srLinkOptionsHtml(linkVal, v.linkLabel) + '</select></label>' +
      '<label>What happened (one line)<input type="text" class="sr-in" name="note" value="' + _srE(v.note) + '"></label>';
  }
  if (line) fields += '<label>Why are you changing it?<input type="text" class="sr-in" name="why" required placeholder="Wrong company"></label>';
  _srDialog(line ? 'Edit the line' : t, line ? 'The line keeps what it said before, and why it changed.' : 'One line, right after.',
    '<form class="sr-form">' + fields + '<div class="sr-formfoot"><span></span><button type="submit" class="btn-sm primary">' + (line ? 'Save the change' : 'Log it') + '</button></div></form>', back,
    (form) => {
      const el = form.elements, val = (k) => (el[k] ? String(el[k].value || '').trim() : '');
      const radio = el.result && el.result.length !== undefined && el.result[0] && el.result[0].type === 'radio' ? ((Array.prototype.find.call(el.result, r => r.checked) || {}).value || '') : val('result');
      let link = { linkType: 'none', linkId: '', linkLabel: '' };
      if (el.link) link = el.link.value === linkVal && line ? { linkType: line.linkType, linkId: line.linkId, linkLabel: line.linkLabel } : _srLinkLabel(el.link.value);
      if (t === 'Performance call' && val('dr')) link = { linkType: 'dr', linkId: val('dr'), linkLabel: val('dr') };
      if (t === 'Sales order' && el.link && el.link.value.indexOf('client_po|') === 0) {
        const id = el.link.value.slice(10), hit = own.email.find(x => x.id === id);
        link = { linkType: 'client_po', linkId: id, linkLabel: hit ? hit.label : id };
      }
      const q = t === 'Quote result' && link.linkId ? SR_UI.ix.qByNo[link.linkId] : null;
      const fields2 = { type: t, company: q ? q.customer : val('company'), person: val('person'), note: val('note'), result: radio, reason: val('reason'), nextDate: val('nextDate') };
      Object.assign(fields2, link);
      if (line) {
        const r = srEditLine(line, fields2, val('why'), _srNowIso());
        if (r.error) { if (el.why) el.why.focus(); return; }
      } else SR_UI.state.lines.push(srNewLine(fields2, SR_UI.me.name, _srNowIso()));
      _srClose();
      _srRefresh();
      _srSave();
    });
}
function _srVoidDialog(id, back) {
  const line = SR_UI.state.lines.find(l => l.id === id);
  if (!line) return;
  _srDialog('Void this line', 'The line stays on the report, struck through, with your reason. Nothing is deleted.',
    '<form class="sr-form"><p class="sr-help">' + _srE(srClock(line.loggedAt) + ' · ' + line.type + ' · ' + (line.company || '')) + '</p>' +
    '<label>Why is it void?<input type="text" class="sr-in" name="why" required placeholder="Logged twice"></label>' +
    '<div class="sr-formfoot"><span></span><button type="submit" class="btn-sm primary">Void the line</button></div></form>', back,
    (form) => {
      const r = srVoidLine(line, String(form.elements.why.value || '').trim(), _srNowIso());
      if (r.error) return;
      _srClose(); _srRefresh(); _srSave();
    });
}
function _srLinkDialog(id, back) {
  const line = SR_UI.state.lines.find(l => l.id === id);
  if (!line) return;
  _srDialog('Add a link', 'A link is what makes a line easy to check: the quotation, PR or email it is about.',
    '<form class="sr-form"><label>Link to<select class="sr-in" name="link">' + _srLinkOptionsHtml('') + '</select></label>' +
    '<label>Or a DR number<input type="text" class="sr-in" name="dr" placeholder="DR-0207"></label>' +
    '<div class="sr-formfoot"><span></span><button type="submit" class="btn-sm primary">Add the link</button></div></form>', back,
    (form) => {
      const dr = String(form.elements.dr.value || '').trim();
      const link = dr ? { linkType: 'dr', linkId: dr, linkLabel: dr } : _srLinkLabel(form.elements.link.value);
      if (!link.linkId) return;
      srAddLink(line, link.linkType, link.linkId, link.linkLabel, _srNowIso());
      _srClose(); _srRefresh(); _srSave();
    });
}

/* ── the records behind a tile ────────────────────────────────────────────────────────────────── */

function _srRecordsOpen(key, back) {
  const n = SR_UI.nums, t = n.portal.concat(n.mine).find(x => x.key === key);
  if (!t) return;
  const rows = (t.items || []).map(it => {
    const when = [it.day && it.day !== SR_UI.day ? srDow(it.day) : '', it.date && !it.day ? it.date : '', it.time].filter(Boolean).join(' ');
    const tail = it.done === true ? '<span class="sr-chip ok">' + _srE(it.by && it.by.kind === 'Call' ? 'Called' : 'Emailed') + '</span>'
      : it.done === false ? '<span class="sr-chip red">not done</span>' : it.ok !== undefined ? '<span class="sr-chip ' + (it.ok ? 'ok' : 'watch') + '">' + (it.ok ? 'within 48 h' : 'over 48 h') + '</span>'
      : it.grey ? '<span class="sr-tag">in the portal\'s log</span>' : '';
    return '<li><span class="tm">' + _srE(when) + '</span><span class="x">' + (it.ref ? _srRef(it.ref) + ' ' : '') + _srE([it.client, it.person].filter(Boolean).join(', ')) +
      (it.what ? '<span class="sr-sub">' + _srE(it.what) + '</span>' : '') + (it.result ? '<span class="sr-sub">' + _srE(it.result) + '</span>' : '') +
      (it.step ? '<span class="sr-sub">Day ' + it.step + ' after ' + _srE(it.sent) + '</span>' : '') + '</span>' +
      '<span class="amt">' + (it.value ? _srE(srMoney(it.value)) : '') + '</span>' + (tail || '<span></span>') + '</li>';
  }).join('');
  _srDialog(t.label, srDayLong(SR_UI.day) + ' — ' + SR_UI.me.name,
    '<div class="sr-rec"><p><span class="sr-chip ' + _srE(t.status) + '">' + _srE(t.text) + '</span> <span class="dh-meta">' + _srE(t.target) + '</span></p>' +
    (t.note ? '<p class="dh-meta">' + _srE(t.note) + '</p>' : '') + (rows ? '<ul class="sr-items">' + rows + '</ul>' : '<p class="dh-empty">No records.</p>') + '</div>', back, null);
}

/** A record number as a link to its page, when it has one. */
function _srRef(ref) {
  const r = String(ref || ''), ix = SR_UI.ix;
  if (/^PR-\d/.test(r)) return '<a href="flow-pricing-request.html?pr=' + encodeURIComponent(r) + '">' + _srE(r) + '</a>';
  if (ix && ix.qByNo[r]) return '<a href="flow-quotations.html?review=' + encodeURIComponent(r) + '">' + _srE(r) + '</a>';
  return '<b>' + _srE(r) + '</b>';
}

/** Print only this report (the browser's print, which also saves a PDF). */
function _srPrint() {
  if (!document.body || !document.body.classList) return;
  document.body.classList.add('sr-print');
  const done = () => { document.body.classList.remove('sr-print'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}
