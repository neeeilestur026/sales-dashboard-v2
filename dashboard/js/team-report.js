/* team-report.js — A351 · the accounting, lead gen and admin daily reports on the director's dashboard (a trial).
 *
 * One engine, three sections (#acctReport, #lgReport, #adminReport), each mounted with teamReport(id, roleKey). While
 * Neil tries them, each report reads the day of the person he picks ("Whose records") and saves what he types under his
 * own name. The numbers are js/team-report-model.js (pure, tested); the tiles are drawn by the sales report's
 * _srTileHtml so the four reports look alike. Saving is the sales report's store with a kind (FlowAPI 179:
 * saveProofReport / submitProofReport / getProofReports); nothing here writes a real record.
 *
 * A363 (Neil, 22 Oct 2026: the new daily report on each person's own dashboard; the old one is not touched):
 *   · teamReport(id, role) — the director's dashboard: "Whose report" shows that person's OWN report, read only — their
 *     records, the lines they typed, their sent mail and whether they submitted at 4:30. Nothing is typed here any more.
 *   · teamReport(id, role, { own: true }) — the person's own page (my-daily-report.html): their day, saved under their
 *     name (FlowAPI 184 lets each person save and read only their own report).
 * A366 · teamReport(id, role, { view: { name, username, day } }) — the team daily reports page (management, the director):
 *     one person's own report, read only, fixed to them and to the page's date; teamReportShow(role, person, day) moves
 *     it to another person or day. One S per role, ever: its listeners were bound to it (_trWire). */

const TR_UI = {};
let _trSharedP = null;
function _trE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _trNowMin() { const d = new Date(); return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes(); }   // Manila, UTC+8
function _trNowIso() { return new Date().toISOString(); }
function _trName(u) { return String((u && (u.fullName || u.name || u.username)) || '').trim(); }
/* A378 — with nobody in the roster yet the report's own name stands in ("Accounting's mailbox"), never "them's" */
function _trFirst(name, noun) { return String(name || '').split(/\s+/)[0] || noun || 'This person'; }
function _trQ(S, sel) { return S.el.querySelector(sel); }
function _trPickGet(role) { try { return localStorage.getItem('hx_tr_person:' + role) || ''; } catch (e) { return ''; } }
function _trPickPut(role, name) { try { localStorage.setItem('hx_tr_person:' + role, name); } catch (e) {} }
function _trDraftKey(S, day) { return 'hx_tr_draft:' + S.role + ':' + day; }
function _trDraftGet(S, day) { try { const v = JSON.parse(localStorage.getItem(_trDraftKey(S, day)) || 'null'); return v && v.report ? v : null; } catch (e) { return null; } }
function _trDraftPut(S, day, report) { try { localStorage.setItem(_trDraftKey(S, day), JSON.stringify({ t: Date.now(), report })); } catch (e) {} }
function _trDraftDrop(S, day) { try { localStorage.removeItem(_trDraftKey(S, day)); } catch (e) {} }

/** The reads the three sections share with each other and with the sales report: the roster, and the activity log and
 *  settings with the sales report's exact parameters, so fetchFlow answers them from one read. */
function _trShared(own) {
  if (_trSharedP) return _trSharedP;
  const today = flowToday();
  _trSharedP = Promise.all([
    own ? Promise.resolve([]) : typeof apiGetUsers === 'function' ? apiGetUsers().then(r => (r && (r.data || r.users)) || []).catch(() => []) : Promise.resolve([]),
    fetchFlow('getActivityLog', { from: srAddDays(today, -42), to: today }).then(r => (r && r.success !== false ? r.data || [] : null)).catch(() => null),
    fetchFlow('getFlowSettings').then(r => (r && r.data) || {}).catch(() => ({}))
  ]).then(([roster, activity, settings]) => ({ today, roster, activity, settings }));
  return _trSharedP;
}

async function teamReport(id, roleKey, opts) {
  const el = document.getElementById(id), cfg = TR_ROLES[roleKey];
  if (!el || !cfg) return;
  const own = !!(opts && opts.own), view = (opts && opts.view) || null;
  if (view && TR_UI[roleKey] && TR_UI[roleKey].el === el && TR_UI[roleKey].view) return teamReportShow(roleKey, view, view.day);   // A366 — never a second S
  const S = TR_UI[roleKey] = { role: roleKey, cfg, el, head: el.querySelector('[data-tr="head"]'), body: el.querySelector('[data-tr="body"]'), own, ro: !own, myUsername: '',
    view: !!view, viewUser: view ? String(view.username || '') : '', seq: 0,
    me: '', today: '', day: '', person: '', people: [], saved: {}, state: null, chain: Promise.resolve(), feed: 'all', backend: true, backendMsg: '',
    failed: [], queue: null, unsaved: false, nums: null, shared: null, raw: null, ix: null,
    mail: { state: 'none', emails: [] }, weekMail: {}, weekMailFor: '' };
  if (!S.head || !S.body) return;
  S.body.innerHTML = '<div class="dh-empty">Reading the day…</div>';
  const s = (typeof getSession === 'function' && getSession()) || {};
  S.me = String(s.name || s.username || '').trim();
  S.myUsername = String(s.username || '');
  S.shared = await _trShared(own || !!view);
  S.today = S.day = S.shared.today;
  if (own) { S.people = S.me ? [S.me] : []; S.person = S.me; }   // A363 — the person's own day
  else if (view) { S.person = String(view.name || '').trim(); S.people = [S.person]; if (view.day) S.day = view.day; }   // A366 — one person, read only
  else {
    S.people = Array.from(new Set(S.shared.roster.filter(u => String(u.role || '').toLowerCase() === cfg.role).map(_trName).filter(Boolean))).sort();
    const kept = _trPickGet(roleKey);
    S.person = S.people.indexOf(kept) >= 0 ? kept : S.people[0] || '';
  }
  await _trLoad(S);
  _trWire(S);
}

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

/* Saving needs FlowAPI 179. An older FlowAPI ignores `kind`, so it would read the sales report's days as this report's
   and a save would REPLACE the sales report of that day: before 179 nothing is read from or sent to the store, and
   what is typed stays on this computer. */
let _trV179 = null;
function _trHas179() { if (!_trV179) _trV179 = typeof flowVersionAtLeast === 'function' ? flowVersionAtLeast(179).catch(() => false) : Promise.resolve(false); return _trV179; }

async function _trLoad(S) {
  const failed = [];
  S.v179 = await _trHas179();
  const get = (label, action, params) => fetchFlow(action, params || {}).then(r => { if (!r || r.success === false) throw new Error('no'); return r.data; })
    .catch(() => { failed.push(label); return null; });
  const jobs = { saved: !S.v179 ? Promise.resolve({ ok: false, message: '' }) : postFlow('getProofReports', Object.assign({ kind: S.role, from: srAddDays(S.today, -42), to: S.today }, S.view ? { user: S.person } : {}))
    .then(r => (r && r.success ? { ok: true, data: r.data || [] } : { ok: false, message: (r && r.message) || '' }))
    .catch(e => ({ ok: false, message: String(e && e.message || '') })) };
  if (S.role === 'accounting') { jobs.ar = get('receivables', 'getARAging'); jobs.clients = get('clients', 'getClients'); }
  if (S.role === 'leadgen') jobs.lgData = get('lead gen records', 'getLeadgen');
  if (S.role === 'admin') { jobs.prs = get('purchase requests', 'getPricingRequests'); jobs.pos = get('purchase orders', 'getPurchaseOrders'); jobs.sos = get('sales orders', 'getSalesOrders');
                            jobs.suppliers = get('suppliers', 'getSuppliers'); }
  const keys = Object.keys(jobs), vals = await Promise.all(keys.map(k => jobs[k])), got = {};
  keys.forEach((k, i) => { got[k] = vals[i]; });
  if (S.shared.activity === null && S.role !== 'leadgen') failed.push('activity log');
  S.failed = failed;
  S.raw = { today: S.today, activity: S.shared.activity || [], settings: S.shared.settings, ar: got.ar, prs: got.prs, pos: got.pos, sos: got.sos,
            clients: got.clients, suppliers: got.suppliers, lgData: got.lgData };
  S.backend = got.saved.ok;
  S.backendMsg = got.saved.ok ? '' : got.saved.message;
  S.savedRows = got.saved.data || [];
  _trPickSaved(S);
  await _trOpenDay(S, S.day);
}
/** A363 — the saved days of the person being read (each person's own report). Again on every "Whose report" change. */
function _trPickSaved(S) {
  S.saved = {};
  (S.savedRows || []).forEach(r => { if (r && r.date && r.kind === S.role && _srSame(r.user, S.person)) S.saved[r.date] = r; });
}

/** The reads that follow the person and the day: lead gen's counts and follow-ups, and the person's live queue. */
async function _trPersonLoad(S) {
  let counts = null, follow = [];
  if (S.role === 'leadgen' && S.person) {
    const r = await Promise.all([
      fetchFlow('getLeadgenCounts', { user: S.person, date: S.day }).catch(() => null),
      fetchFlow('getLeadgenFollowups', { date: S.day }).then(x => (x && x.data) || []).catch(() => [])]);
    counts = r[0] && r[0].success !== false ? r[0] : null;
    follow = r[1];
    if (!counts && S.failed.indexOf('lead gen counts') < 0) S.failed.push('lead gen counts');
  }
  S.ix = trIndex(Object.assign({}, S.raw, { lgCounts: counts, lgFollowups: follow }));
  _trQueueLoad(S);
  _trMailLoad(S);
}

/* A352 — the person's sent mail for the day (a director may read another login's sent mail; /api/email/today). */
function _trUsername(S, who) { if (S.own) return S.myUsername; if (S.view) return S.viewUser; const u = S.shared.roster.find(x => _trName(x) === who); return (u && u.username) || ''; }
function _trMailRead(S, who, day) {
  const un = _trUsername(S, who);
  if (!un || typeof apiFetchEmailLogToday !== 'function') return Promise.resolve({ state: 'none', emails: [] });
  return apiFetchEmailLogToday(un, day).then(r => (r && r.needsSetup ? { state: 'setup', emails: [] } : r && r.success !== false ? { state: 'ok', emails: r.emails || [] } : { state: 'error', emails: [] }))
    .catch(() => ({ state: 'error', emails: [] }));
}
async function _trMailLoad(S) {
  if (!S.cfg.mail) return;
  const who = S.person, day = S.day;
  S.mail = { state: 'loading', emails: [] };
  const m = await _trMailRead(S, who, day);
  if (S.person !== who || S.day !== day) return;
  S.mail = m;
  if (S.weekMailFor === who && m.state === 'ok') S.weekMail[day] = m.emails;
  _trRefresh(S);
}
/** The week's mail column: one read per past day of the week, three at a time; an unreadable day shows "—". */
async function _trWeekMail(S, days) {
  if (!S.cfg.mail || S.weekBusy || !days.length) return;
  if (S.mail.state === 'setup' || S.mail.state === 'none') { days.forEach(d => { S.weekMail[d] = null; }); _trRenderWeek(S); return; }
  S.weekBusy = true;
  const who = S.person;
  for (let i = 0; i < days.length; i += 3) {
    await Promise.all(days.slice(i, i + 3).map(d => _trMailRead(S, who, d).then(m => { if (S.person === who) S.weekMail[d] = m.state === 'ok' ? m.emails : null; })));
  }
  S.weekBusy = false;
  if (S.person === who) _trRefresh(S);   // A371 — the earlier days' mail also numbers today's collection follow-ups
}
async function _trQueueLoad(S) {
  const who = S.person, day = S.day;
  S.queue = null;
  if (!who || day !== S.today || typeof flowComputeActions !== 'function') { S.queue = []; return; }
  const u = S.own ? { username: S.myUsername } : S.view ? { username: S.viewUser } : S.shared.roster.find(x => _trName(x) === who) || {};
  let items = [];
  try { items = await flowComputeActions({ role: S.cfg.role, name: who, username: u.username || '' }); } catch (e) { items = []; }
  if (S.person !== who || S.day !== day) return;
  S.queue = trQueue(items);
  _trRenderQueue(S);
}

async function _trOpenDay(S, day) {
  const seq = S.seq = (S.seq || 0) + 1;                    // A366 — a slower open of an earlier person or day is dropped
  S.day = day;
  if (S.weekMailFor !== S.person) { S.weekMail = {}; S.weekMailFor = S.person; }
  const saved = S.saved[day], draft = S.ro ? null : _trDraftGet(S, day);   // another person's day is never this computer's draft
  const savedAt = saved && saved.updatedAt ? Date.parse(saved.updatedAt) || 0 : 0;
  S.state = trFill(draft && draft.t > savedAt ? draft.report : saved ? saved.report : null, S.role, S.person);
  S.unsaved = !!(draft && draft.t > savedAt);
  S.body.innerHTML = '<div class="dh-empty">Reading ' + _trE(_trFirst(S.person, S.cfg.noun)) + '\'s day…</div>';
  await _trPersonLoad(S);
  if (seq !== S.seq) return;
  _trRender(S);
}
/** A366 — the team daily reports page: the same report, now another person (their saved days read afresh) or day. */
async function teamReportShow(roleKey, person, day) {
  const S = TR_UI[roleKey];
  if (!S || !S.view || !person) return;
  const name = String(person.name || '').trim();
  if (_srSame(S.person, name)) { if (day && day !== S.day) await _trOpenDay(S, day); return; }
  const seq = S.seq = (S.seq || 0) + 1;
  S.person = name; S.people = [name]; S.viewUser = String(person.username || ''); S.weekMail = {}; S.weekMailFor = '';
  S.body.innerHTML = '<div class="dh-empty">Reading ' + _trE(_trFirst(name, S.cfg.noun)) + '\'s report…</div>';
  const r = S.v179 && typeof postFlow === 'function' ? await postFlow('getProofReports', { kind: S.role, from: srAddDays(S.today, -42), to: S.today, user: name }).catch(() => null) : null;
  if (seq !== S.seq) return;
  S.backend = !!(r && r.success); S.backendMsg = r && !r.success ? String(r.message || '') : '';
  S.savedRows = (r && r.success && r.data) || [];
  _trPickSaved(S);
  await _trOpenDay(S, day || S.day);
}

/* ── save ─────────────────────────────────────────────────────────────────────────────────────── */

function _trSave(S, opts) {
  if (S.ro) return S.chain;                                // A363 — another person's report is read, never written
  const day = S.day, o = opts || {};
  S.state.person = S.person;
  const report = JSON.parse(JSON.stringify(S.state));
  _trDraftPut(S, day, report);
  S.unsaved = true;
  _trStatus(S, 'Saving…', '');
  S.chain = S.chain.then(async () => {
    let r;
    const params = { kind: S.role, date: day, reportJson: JSON.stringify(report), portalJson: JSON.stringify(_trLiveNumbers(S)) };
    if (!S.v179) {
      if (day === S.day) _trStatus(S, 'Not saved — the FlowAPI update (' + (S.own ? '184' : '179') + ') is not pasted yet. Kept on this computer.', 'bad');
      return { success: false, message: 'FlowAPI 179 is needed.' };
    }
    try {
      if (o.submit) r = await postFlow('submitProofReport', Object.assign(params, { snapshotJson: JSON.stringify(o.snapshot) }));
      else r = await postFlow('saveProofReport', params);
    } catch (e) { r = { success: false, message: String(e && e.message || e) }; }
    if (r && r.success) {
      const prev = S.saved[day] || {};
      S.saved[day] = Object.assign({}, prev, { date: day, user: S.me, report, updatedAt: r.updatedAt || _trNowIso(), reportNo: r.reportNo,
        submittedAt: r.submittedAt || prev.submittedAt || '', snapshot: o.submit ? o.snapshot : prev.snapshot || null });
      S.backend = true;
      if (day === S.day) { S.unsaved = false; _trDraftDrop(S, day); _trRefresh(S); }
      return r;
    }
    const msg = r && r.message ? r.message : 'The save did not go through.';
    if (r && r.alreadySubmitted && day === S.day) { S.saved[day] = Object.assign({}, S.saved[day] || {}, { submittedAt: r.submittedAt }); _trRefresh(S); }
    if (day === S.day) _trStatus(S, /Unknown action|not a secured action|one of: sales/i.test(msg)
      ? 'Not saved — the FlowAPI update (' + (S.own ? '184' : '179') + ') is not pasted yet. Kept on this computer.' : 'Not saved — ' + msg + ' Kept on this computer.', 'bad');
    return r;
  });
  return S.chain;
}
function _trStatus(S, text, tone) {
  const el = _trQ(S, '[data-state]');
  if (!el) return;
  el.textContent = text;
  el.className = 'sr-state' + (tone ? ' ' + tone : '');
}
function _trSetState(S) {
  const saved = S.saved[S.day];
  if (S.ro) { _trStatus(S, saved && saved.updatedAt ? 'Last saved ' + srClock(saved.updatedAt) : 'Nothing saved for this day', ''); return; }
  if (S.unsaved) _trStatus(S, 'Not saved yet — kept on this computer', 'warn');
  else if (saved && saved.updatedAt) _trStatus(S, 'Saved ' + srClock(saved.updatedAt), 'ok');
  else _trStatus(S, 'Nothing saved for this day yet', '');
}

/* ── the numbers right now ────────────────────────────────────────────────────────────────────── */

function _trNums(S) {
  const t = trTiles(S.role, S.ix, S.person, S.day, _trNowMin());
  const mail = S.cfg.mail ? trMail(S.role, S.ix, S.mail.emails, S.state.mailMarks, S.state.mailPrs, S.state.mailArs) : [];
  if (S.cfg.mail && S.cfg.mail.ar) trFollowUps(mail, S.day, trCollectEarlier(S.ix, S.day, S.saved, S.weekMail));   // A371 — which follow-up each one is
  return { portal: (S.cfg.mail ? trMailTiles(S.role, mail, S.mail.state) : []).concat(t.portal), weekly: t.weekly, mail,
           mine: trMineTiles(S.role, S.state, S.day), linked: trLinked(S.role, S.state, S.day) };
}
function _trLiveNumbers(S) { const n = S.nums || _trNums(S); return trSnapshot(n.portal.concat(n.weekly), n.mine, S.day, S.person); }

/* ── the page ─────────────────────────────────────────────────────────────────────────────────── */

function _trHeadHtml(S) {
  const opts = S.people.length ? S.people.map(p => '<option' + (p === S.person ? ' selected' : '') + '>' + _trE(p) + '</option>').join('')
    : '<option value="">No ' + _trE(S.cfg.noun.toLowerCase()) + ' login yet</option>';
  return '<div class="sr-title"><h2>' + (S.own ? 'My daily report' : _trE(S.cfg.title)) + '</h2>' + (S.own ? '<span class="sr-who">' + _trE(S.me) + '</span>' : '<span class="sr-chip">Read only</span>') + '</div>' +
    '<div class="dh-actions sr-tools">' +
      (S.own || S.view ? '' : '<label class="tr-pick"><span>Whose report</span><select class="sr-in" data-person aria-label="Whose report to read">' + opts + '</select></label>') +
      (S.view ? '<span class="sr-who">' + _trE(S.person) + ' · ' + _trE(srDayLong(S.day)) + '</span>'   // A366 — the page's date stepper owns the day
        : '<div class="sr-daypick"><button type="button" class="sr-step" data-step="-1" aria-label="Previous day">‹</button>' +
        '<input type="date" class="sr-date" data-date value="' + S.day + '" min="' + srAddDays(S.today, -28) + '" max="' + S.today + '" aria-label="Report date">' +
        '<button type="button" class="sr-step" data-step="1" aria-label="Next day">›</button></div>') +
      '<span class="sr-state" data-state role="status"></span></div>' +
    '<div class="sr-chips" data-chips></div>';
}
function _trBodyHtml(S) {
  const who = _trFirst(S.person, S.cfg.noun), notes = [];
  if (!S.backend) notes.push('<div class="dh-banner warn">' + (S.ro ? 'Each person\'s saved report needs the FlowAPI update (version ' + (S.view ? '185' : '184') + ') before it can be read here.' : 'Saving needs the FlowAPI update (version ' + (S.own ? '184' : '179') + '). Until it is pasted, what you type is kept on this computer only.') +
    (S.backendMsg && !/Unknown action|not a secured action|one of: sales/i.test(S.backendMsg) ? ' (' + _trE(S.backendMsg) + ')' : '') + '</div>');
  if (S.failed.length) notes.push('<div class="dh-banner warn">Could not read: ' + _trE(S.failed.join(', ')) + '. The numbers that need them may be short — reload the page.</div>');
  if (!S.person) notes.push('<div class="dh-banner warn">There is no ' + _trE(S.cfg.noun.toLowerCase()) + ' login in the roster, so there are no records to count yet.</div>');
  return notes.join('') +
    '<p class="sr-trial">' + (S.own ? 'Your new daily report. Only you and the director see it, and your old daily report still works as before. Nothing here changes a real record.'
      : 'Read only — ' + _trE(S.person || 'nobody') + '\'s own report: their records, the lines they typed, their sent mail and whether they submitted at 4:30.') + '</p>' +
    '<section class="sr-block"><h3>' + (S.day === S.today ? 'Today\'s' : _trE(srDayLong(S.day)) + ' —') + ' numbers</h3>' +
      '<p class="sr-rowlab ok">The portal fills these — ' + _trE(S.person || 'no one') + '\'s records</p><div class="sr-tiles" data-tiles="portal"></div>' +
      (S.cfg.weekly ? '<p class="sr-rowlab ok">This week so far</p><div class="sr-tiles" data-tiles="weekly"></div>' : '') +
      '<p class="sr-rowlab mine">From the typed lines</p><div class="sr-tiles" data-tiles="mine"></div></section>' +
    (S.day === S.today ? '<section class="sr-block"><h3>Waiting on ' + _trE(who) + ' now</h3><p class="dh-meta">' + _trE(who) + '\'s own home-page list, read live.</p><div data-queue></div></section>' : '') +
    (S.cfg.mail ? '<section class="sr-block"><div class="sr-bar"><h3>Emails sent — ' + _trE(who) + '\'s mailbox</h3>' +
      (S.cfg.mail.ar ? '<div class="sr-pills" role="group" aria-label="Sort the emails" data-mailsorts></div>' : '') + '</div><p class="dh-meta">' + _trE(S.cfg.mail.help) +
      (S.ro ? '' : ' Press a button to correct one; your choice is kept with the report.') + '</p><div data-mail></div></section>' : '') +
    '<section class="sr-block"><div class="sr-bar"><h3>' + (S.ro ? _trE(who) + '\'s log' : 'My log') + '</h3>' + (S.ro ? '' : '<div class="sr-quick">' +
      S.cfg.lines.map(x => '<button type="button" class="dh-btn" data-new="' + _trE(x.type) + '">+ ' + _trE(x.type) + '</button>').join('') + '</div>') + '</div>' +
      '<p class="sr-help">' + _trE(S.cfg.typedNote) + '</p>' +
      '<div class="sr-scroll"><table class="sr-table sr-log"><thead><tr><th scope="col">Time</th><th scope="col">Type</th><th scope="col">What happened</th>' +
        '<th scope="col">Result</th><th scope="col">Link</th><th scope="col"><span class="sr-sr">Change</span></th></tr></thead><tbody data-log></tbody></table></div></section>' +
    '<section class="sr-block"><div class="sr-bar"><h3>Logged by the portal — ' + _trE(who) + ' typed none of this</h3><div class="sr-pills" role="group" aria-label="Show" data-pills></div></div>' +
      '<div data-feedlist></div></section>' +
    '<section class="sr-block sr-reports"><div class="sr-card" data-pm></div></section>' +
    '<section class="sr-block"><h3>This week</h3><div class="sr-scroll"><table class="sr-table sr-week"><thead data-weekhead></thead><tbody data-week></tbody></table></div></section>';
}
function _trRender(S) {
  S.head.innerHTML = _trHeadHtml(S);
  S.body.innerHTML = _trBodyHtml(S);
  _trRefresh(S);
  _trRenderQueue(S);
}

/** Redraw everything that follows from the numbers, without touching what is being typed. */
function _trRefresh(S) {
  if (!S.ix || !_trQ(S, '[data-tiles="portal"]')) return;
  const n = S.nums = _trNums(S), saved = S.saved[S.day] || {};
  const dateIn = _trQ(S, '[data-date]');
  if (dateIn && dateIn.value !== S.day) dateIn.value = S.day;
  const back = _trQ(S, '[data-step="-1"]'), fwd = _trQ(S, '[data-step="1"]');
  if (fwd) fwd.disabled = S.day >= S.today;
  if (back) back.disabled = S.day <= srAddDays(S.today, -28);
  _trSetState(S);
  const chip = (t, tone) => '<span class="sr-chip' + (tone ? ' ' + tone : '') + '">' + _trE(t) + '</span>';
  const late = S.day < S.today || _trNowMin() >= 16 * 60 + 30;
  _trQ(S, '[data-chips]').innerHTML = (saved.submittedAt ? chip('4:30 report submitted ' + srClock(saved.submittedAt), 'ok') : chip('4:30 report due', late ? 'red' : '')) +
    (n.linked.total ? chip('Lines with a link: ' + n.linked.linked + ' of ' + n.linked.total, n.linked.linked < n.linked.total ? 'watch' : '') : '');
  const tile = typeof _srTileHtml === 'function' ? _srTileHtml : (t) => '<button type="button" class="sr-tile" data-rec="' + t.key + '">' + _trE(t.label + ' ' + t.text) + '</button>';
  _trQ(S, '[data-tiles="portal"]').innerHTML = n.portal.map(tile).join('');
  if (_trQ(S, '[data-tiles="weekly"]')) _trQ(S, '[data-tiles="weekly"]').innerHTML = n.weekly.map(tile).join('');
  _trQ(S, '[data-tiles="mine"]').innerHTML = n.mine.map(tile).join('');
  S.el.querySelectorAll('.sr-bar-track > i[data-w]').forEach(i => { if (i.style && i.style.setProperty) i.style.setProperty('--sr-w', i.getAttribute('data-w')); });
  _trQ(S, '[data-log]').innerHTML = _trLogRows(S);
  if (_trQ(S, '[data-mail]')) _trQ(S, '[data-mail]').innerHTML = _trMailHtml(S, n.mail);
  if (_trQ(S, '[data-mailsorts]')) _trQ(S, '[data-mailsorts]').innerHTML = [['time', 'By time'], ['customer', 'Collection follow-ups by customer']].map(([k, l]) =>
    '<button type="button" data-mailsort="' + k + '" aria-pressed="' + ((S.mailSort || 'time') === k) + '">' + _trE(l) + '</button>').join('');   // A371
  _trRenderFeed(S);
  /* Never redrawn under a field being typed in; a focused button (Submit, just clicked) is no reason to wait. */
  const pm = _trQ(S, '[data-pm]'), a = document.activeElement;
  if (!(a && pm.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || ''))) pm.innerHTML = _trPmHtml(S, n, saved);
  _trRenderWeek(S);
}

function _trRenderQueue(S) {
  const box = _trQ(S, '[data-queue]');
  if (!box) return;
  box.innerHTML = _trQueueHtml(S);
}
function _trQueueHtml(S) {
  if (S.queue === null) return '<p class="dh-empty">Reading ' + _trE(_trFirst(S.person, S.cfg.noun)) + '\'s list…</p>';
  const tone = { urgent: 'red', warn: 'watch', info: '', ok: 'ok' };
  const rows = S.queue.map(q => '<li><span class="sr-chip ' + (tone[q.tone] || '') + '">' + _trE(q.tone === 'urgent' ? 'Urgent' : q.tone === 'warn' ? 'Overdue' : q.tone === 'ok' ? 'Ready' : 'To do') + '</span>' +
    '<a href="' + _trE(q.link) + '">' + _trE(q.text) + '</a><span class="amt">' + (q.amt ? _trE(srMoney(q.amt)) : '') + '</span></li>').join('');
  const fu = S.role === 'leadgen' ? S.ix.lg.followups.slice(0, 12) : [];
  return (rows ? '<ul class="tr-queue">' + rows + '</ul>' : '<p class="dh-empty">Nothing waiting on ' + _trE(_trFirst(S.person, S.cfg.noun)) + ' right now.</p>') +
    (fu.length ? '<h4 class="tr-sub">Follow-ups due today' + (S.ix.lg.followups.length > fu.length ? ' (first ' + fu.length + ' of ' + S.ix.lg.followups.length + ')' : '') + '</h4><ul class="tr-queue">' +
      fu.map(f => '<li><span class="sr-chip">' + _trE(f.stage || 'Follow-up') + '</span><span>' + _trE([f.name, f.company].filter(Boolean).join(', ')) +
        '<span class="sr-sub">' + _trE(f.action || '') + (f.overdue > 0 ? ' — ' + f.overdue + ' day' + (f.overdue === 1 ? '' : 's') + ' late' : '') + '</span></span><span></span></li>').join('') + '</ul>' : '');
}

/** A352 — the day's sent mail: each email, whether it counts and why, and a button to correct it. */
function _trMailHtml(S, rows) {
  const who = _trFirst(S.person, S.cfg.noun), st = S.mail.state, cfg = S.cfg.mail;
  if (st === 'loading') return '<p class="dh-empty">Reading ' + _trE(who) + '\'s sent mail…</p>';
  if (st === 'setup') return '<p class="dh-empty">' + _trE(who) + '\'s mailbox is not connected to the portal, so their emails cannot be counted. Type them in My log meanwhile.</p>';
  if (st === 'none') return '<p class="dh-empty">There is no login to read a mailbox for.</p>';
  if (st === 'error') return '<p class="dh-empty">Could not read ' + _trE(who) + '\'s sent mail just now.</p>';
  if (!rows.length) return '<p class="dh-empty">No emails sent on this day.</p>';
  /* A365 — the PR an email is linked to (from its subject, or picked); a price request without one waits for it */
  const prLine = (r) => !cfg.pr ? '' : r.pr ? '<span class="sr-sub">PR <a href="flow-pricing-request.html?pr=' + encodeURIComponent(r.pr) + '">' + _trE(r.pr) + '</a>' + (r.prHow === 'subject' ? ' — from the subject' : '') + '</span>'
    : r.needsPr ? '<span class="sr-sub"><span class="sr-chip watch">Needs its PR to count</span></span>' : '';
  /* A371 — the receivable an email is linked to (picked, or the customer's past-due one), and which follow-up it is */
  const arLine = (r) => !cfg.ar ? '' : (r.ar ? '<span class="sr-sub">Receivable <a href="flow-ar-aging.html">' + _trE(r.ar) + '</a>' + (r.arHow === 'guess' ? ' — the customer\'s past-due one' : '') + '</span>' : '') +
    (r.fu ? '<span class="sr-sub tr-fu' + (r.fu.n > 1 || r.reply ? ' more' : '') + '">' + _trE(trFollowUpText(r)) + '</span>' : '');
  const btns = (r) => !r.id || S.ro ? '<span></span>' : '<span class="tr-mailbtns"><button type="button" class="sr-mini' + (r.price ? ' on' : '') + '" data-mailmark="' + _trE(r.id) + '">' + _trE(r.price ? cfg.none : 'Count as ' + cfg.tag.toLowerCase()) + '</button>' +
    (cfg.pr ? '<button type="button" class="sr-mini" data-mailpr="' + _trE(r.id) + '">' + (r.pr ? 'Change PR' : 'Link a PR') + '</button>' : '') +
    (cfg.ar ? '<button type="button" class="sr-mini" data-mailar="' + _trE(r.id) + '">' + (r.arHow === 'picked' ? 'Change receivable' : 'Link a receivable') + '</button>' : '') + '</span>';
  const li = (r) => '<li class="' + (r.counted ? 'on' : '') + '"><span class="tm">' + _trE(r.time || '—') + '</span>' +
    '<span class="x"><b>' + _trE(r.subject || '(no subject)') + '</b><span class="sr-sub">to ' + _trE(r.to) + (r.org ? ' — ' + _trE(r.org) : '') + (r.ref && !cfg.pr && !cfg.ar ? ' · ' + _trE(r.ref) : '') + '</span>' + prLine(r) + arLine(r) +
      '<span class="sr-sub">' + (r.counted ? '<span class="sr-chip ok">' + _trE(cfg.tag) + '</span> ' : '') + _trE(r.marked ? (r.price ? 'counted by you' : 'not counted, by you') : r.why) + '</span></span>' +
    btns(r) + '</li>';
  if (cfg.ar && S.mailSort === 'customer') return trMailGroups(rows).map(g => '<h4 class="tr-sub">' + _trE(g.label) + ' <span class="sr-dim">' + g.rows.length + ' email' + (g.rows.length === 1 ? '' : 's') + '</span></h4>' +
    '<ul class="sr-feed tr-mail">' + g.rows.map(li).join('') + '</ul>').join('');
  return '<ul class="sr-feed tr-mail">' + rows.map(li).join('') + '</ul>';
}

/** A line's link: the record's own page when it has one. */
function _trLinkHtml(l) {
  const id = encodeURIComponent(l.linkId), lab = _trE(l.linkLabel || l.linkId);
  const href = l.linkType === 'pr' ? 'flow-pricing-request.html?pr=' + id : l.linkType === 'po' ? 'flow-purchase-orders.html' : l.linkType === 'so' ? 'director-sales-orders.html'
    : l.linkType === 'ar' ? 'flow-ar-aging.html' : '';
  return href ? '<a href="' + href + '">' + lab + '</a>' : lab;
}
function _trLogRows(S) {
  const rows = trDayLines(S.state, S.day).map(l => {
    const link = l.linkType && l.linkType !== 'none' && l.linkId ? '<span class="sr-link">' + _trLinkHtml(l) + '</span>' : '—';
    return '<tr class="' + (l.voidedAt ? 'void' : '') + '"><td class="tm">' + _trE(srClock(l.loggedAt)) + '</td><td>' + _trE(l.type) + '</td>' +
      '<td><b>' + _trE(l.what || '—') + '</b>' + (l.note ? '<span class="sr-sub">' + _trE(l.note) + '</span>' : '') +
        (l.voidedAt ? '<span class="sr-sub">Voided ' + _trE(srClock(l.voidedAt)) + ': ' + _trE(l.voidReason) + '</span>' : '') +
        (l.editedAt && !l.voidedAt ? '<span class="sr-sub">Edited ' + _trE(srClock(l.editedAt)) + ': ' + _trE(l.editReason) + '</span>' : '') + '</td>' +
      '<td>' + _trE(l.result || '—') + (l.nextDate ? '<span class="sr-sub">next ' + _trE(l.nextDate) + '</span>' : '') + '</td>' +
      '<td>' + link + '</td><td class="act">' + (l.voidedAt || S.ro ? '' : '<button type="button" class="sr-mini" data-edit="' + l.id + '">Edit</button><button type="button" class="sr-mini" data-void="' + l.id + '">Void</button>') + '</td></tr>';
  });
  return rows.join('') || '<tr><td colspan="6" class="dh-empty">' + (S.ro ? 'No lines typed on this day.' : 'No lines yet. Type each one as it happens; the time is set when you save.') + '</td></tr>';
}

function _trRenderFeed(S) {
  const items = trFeed(S.ix, S.person, S.day), mods = Array.from(new Set(items.map(x => x.module)));
  if (S.feed !== 'all' && mods.indexOf(S.feed) < 0) S.feed = 'all';
  _trQ(S, '[data-pills]').innerHTML = ['all'].concat(mods).map(m => '<button type="button" data-feed="' + _trE(m) + '" aria-pressed="' + (S.feed === m) + '">' +
    _trE(m === 'all' ? 'All' : m) + '</button>').join('');
  const shown = items.filter(x => S.feed === 'all' || x.module === S.feed);
  _trQ(S, '[data-feedlist]').innerHTML = shown.length ? '<ul class="sr-feed">' + shown.map(x => '<li><span class="tm">' + _trE(x.time || '—') + '</span>' +
    '<span class="sr-type">' + _trE(x.module) + '</span><span class="x">' + (x.ref ? '<b>' + _trE(x.ref) + '</b> ' : '') + _trE(x.action) + (x.text ? ' — ' + _trE(x.text) : '') + '</span>' +
    '<span class="amt">' + (x.amount ? _trE(srMoney(x.amount)) : '') + '</span></li>').join('') + '</ul>'
    : '<p class="dh-empty">' + (S.ix.activity.length || S.role === 'leadgen' ? 'Nothing logged for ' + _trE(_trFirst(S.person, S.cfg.noun)) + ' on this day.' : 'The activity log could not be read.') + '</p>';
}

function _trPmHtml(S, n, saved) {
  const live = {};
  n.portal.concat(n.weekly).concat(n.mine).forEach(t => { live[t.key] = t.text; });
  const sub = saved.submittedAt, snap = sub && saved.snapshot ? saved.snapshot : null;
  const val = (k) => (snap && snap[k] ? snap[k].text : live[k] || '—');
  const nums = n.portal.slice(0, 6).map(t => [t.label, t.key]);
  return '<div class="sr-cardhead"><h3>4:30 report</h3><span class="sr-chip ' + (sub ? 'ok' : '') + '">' + (sub ? 'Submitted ' + _trE(srClock(sub)) : 'Due') + '</span></div>' +
    '<dl class="sr-nums">' + nums.map(([l, k]) => '<div><dt>' + _trE(l) + '</dt><dd>' + _trE(val(k)) + '</dd></div>').join('') + '</dl>' +
    (sub ? '<p class="sr-help">These are the numbers as submitted' + (snap && snap.person ? ' (' + _trE(snap.person) + '\'s records)' : '') + '; editing a line now does not change them.' +
           (saved.report && saved.report.pm && saved.report.pm.blocker ? ' Blocker: ' + _trE(saved.report.pm.blocker) : '') + '</p>'
         : S.ro ? '<p class="sr-help">Not submitted yet — these are the numbers right now.' + (S.state.pm && S.state.pm.blocker ? ' Blocker so far: ' + _trE(S.state.pm.blocker) : '') + '</p>'
         : '<label class="sr-line">Blocker or help needed (one line — or "no blocker")<input type="text" class="sr-in" data-blocker maxlength="200" value="' + _trE(S.state.pm.blocker) + '" placeholder="no blocker"></label>' +
           '<div class="sr-formfoot"><span class="sr-help">Submitting fixes every number on this report for the day.</span><button type="button" class="btn-sm primary" data-submitpm>Submit 4:30 report</button></div>');
}

function _trRenderWeek(S) {
  const saved = Object.assign({}, S.saved, { [S.day]: Object.assign({}, S.saved[S.day] || {}, { report: S.state }) });
  const w = trWeek(S.role, S.ix, S.person, S.day, saved, S.weekMail);
  _trQ(S, '[data-weekhead]').innerHTML = '<tr><th scope="col">Day</th>' + w.heads.map(h => '<th scope="col">' + _trE(h) + '</th>').join('') + '<th scope="col">Report</th></tr>';
  const td = (v, tone) => '<td class="' + (tone || '') + '">' + v + '</td>';
  _trQ(S, '[data-week]').innerHTML = w.rows.map(r => {
    const lab = '<th scope="row"' + (r.day === S.day ? ' class="cur"' : '') + '>' + srDow(r.day) + ' ' + Number(r.day.slice(8)) + '</th>';
    if (r.future) return '<tr class="future">' + lab + '<td colspan="' + (w.heads.length + 1) + '">—</td></tr>';
    return '<tr>' + lab + r.vals.map(v => td(v === null ? '—' : v === 'loading' ? '<span class="sr-dim">…</span>' : v)).join('') +
      td(r.report.state === 'done' ? '✓ ' + _trE(r.report.time) : r.report.state === 'due' ? 'due' : '—', r.report.state === 'done' ? 'ok' : r.report.state === 'due' ? 'watch' : '') + '</tr>';
  }).join('') + '<tr class="total"><th scope="row">Week</th>' + w.totals.map(v => td(v === null ? '—' : v)).join('') + td(w.reports + ' of ' + w.reportDays) + '</tr>';
  if (S.cfg.mail && S.mail.state !== 'loading') _trWeekMail(S, w.days.filter(d => d <= S.today && S.weekMail[d] === undefined));
}

/* ── what the person does (A363: on the director's dashboard, only reading) ───────────────────── */

function _trWire(S) {
  if (S.el.dataset.wired) return;
  S.el.dataset.wired = '1';
  S.el.addEventListener('click', ev => {
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    if (S.ro && !b.hasAttribute('data-step') && !b.hasAttribute('data-rec') && !b.hasAttribute('data-feed') && !b.hasAttribute('data-mailsort')) return;   // A363 — reading, not writing
    if (b.hasAttribute('data-step')) _trStep(S, Number(b.getAttribute('data-step')));
    else if (b.hasAttribute('data-rec')) _trRecordsOpen(S, b.getAttribute('data-rec'), b);
    else if (b.hasAttribute('data-new')) _trLineDialog(S, b.getAttribute('data-new'), null, b);
    else if (b.hasAttribute('data-edit')) _trLineDialog(S, null, b.getAttribute('data-edit'), b);
    else if (b.hasAttribute('data-void')) _trVoidDialog(S, b.getAttribute('data-void'), b);
    else if (b.hasAttribute('data-feed')) { S.feed = b.getAttribute('data-feed'); _trRenderFeed(S); }
    else if (b.hasAttribute('data-submitpm')) _trSubmitPm(S);
    else if (b.hasAttribute('data-mailmark')) _trMailMark(S, b.getAttribute('data-mailmark'));
    else if (b.hasAttribute('data-mailpr')) _trMailPrDialog(S, b.getAttribute('data-mailpr'), b);   // A365
    else if (b.hasAttribute('data-mailar')) _trMailArDialog(S, b.getAttribute('data-mailar'), b);   // A371
    else if (b.hasAttribute('data-mailsort')) { S.mailSort = b.getAttribute('data-mailsort'); _trRefresh(S); }
  });
  S.el.addEventListener('change', ev => {
    const t = ev.target;
    if (!t) return;
    if (t.hasAttribute('data-person')) { S.person = t.value; _trPickPut(S.role, S.person); _trPickSaved(S); _trOpenDay(S, S.day); }
    else if (t.hasAttribute('data-date')) {
      const d = t.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= S.today && d >= srAddDays(S.today, -28)) _trOpenDay(S, d); else t.value = S.day;
    } else if (t.hasAttribute('data-blocker') && !S.ro) { S.state.pm.blocker = t.value.trim(); _trSave(S); }
  });
  S.el.addEventListener('input', ev => {
    const t = ev.target;
    if (t && t.hasAttribute && t.hasAttribute('data-blocker')) { S.state.pm.blocker = t.value.trim(); t.removeAttribute('aria-invalid'); }
  });
}
/** Count an email the guess missed, or stop counting one it got wrong. Kept with the day's report. */
function _trMailMark(S, id) {
  const row = ((S.nums && S.nums.mail) || []).find(r => r.id === id);
  if (!row) return;
  S.state.mailMarks = S.state.mailMarks || {};
  S.state.mailMarks[id] = !row.price;   // A365 — whether it IS a price request; whether it counts also needs its PR
  _trRefresh(S);
  _trSave(S);
}
/** A365 — link a sent email to a PR: the ones being sourced or priced first, then the last 90 days'. Choosing the PR its
 *  subject already names keeps nothing extra; "No PR" takes even the subject's off. */
function _trMailPrDialog(S, id, back) {
  const row = ((S.nums && S.nums.mail) || []).find(r => r.id === id);
  if (!row) return;
  const ch = trPrChoices(S.ix), cur = row.pr, all = ch.open.concat(ch.recent);
  const opt = (o) => '<option value="' + _trE(o.id) + '"' + (o.id === cur ? ' selected' : '') + '>' + _trE(o.label) + '</option>';
  _trDialog(S, row.pr ? 'Change the PR' : 'Link a PR', '"' + (row.subject || '(no subject)') + '" — to ' + row.to,
    '<form class="sr-form"><label>Purchase request<select class="sr-in" name="pr"><option value=""' + (cur ? '' : ' selected') + '>No PR</option>' +
      (cur && !all.some(o => o.id === cur) ? '<option value="' + _trE(cur) + '" selected>' + _trE(cur + (row.prHow === 'subject' ? ' (from the subject)' : '')) + '</option>' : '') +
      (ch.open.length ? '<optgroup label="Being sourced or priced">' + ch.open.map(opt).join('') + '</optgroup>' : '') +
      (ch.recent.length ? '<optgroup label="Other PRs, last 90 days">' + ch.recent.map(opt).join('') + '</optgroup>' : '') + '</select></label>' +
    '<p class="sr-help">' + (row.price ? 'A price request to a supplier counts only once it is linked to its PR.' : 'Linking this email to a PR keeps it with that PR; it changes no count.') + '</p>' +
    '<div class="sr-formfoot"><span></span><button type="submit" class="btn-sm primary">Save</button></div></form>', back,
    (form) => {
      const v = String(form.elements.pr.value || '').trim().toUpperCase();
      S.state.mailPrs = S.state.mailPrs || {};
      if (v === row.subjPr) delete S.state.mailPrs[id]; else S.state.mailPrs[id] = v;
      _trClose(); _trRefresh(S); _trSave(S);
    });
}
/** A371 — link a sent email to a receivable: the open ones, past due first. A linked email counts as a collection
 *  follow-up and is numbered with that customer's others; "No receivable" takes even the guessed one off. */
function _trMailArDialog(S, id, back) {
  const row = ((S.nums && S.nums.mail) || []).find(r => r.id === id);
  if (!row) return;
  const open = trLinkOptions('accounting', S.ix).ar, cur = row.ar;
  const past = open.filter(o => o.due && o.due < S.ix.today), rest = open.filter(o => !(o.due && o.due < S.ix.today));
  const opt = (o) => '<option value="' + _trE(o.id) + '"' + (o.id === cur ? ' selected' : '') + '>' + _trE(o.label) + '</option>';
  _trDialog(S, row.arHow === 'picked' ? 'Change the receivable' : 'Link a receivable', '"' + (row.subject || '(no subject)') + '" — to ' + row.to,
    '<form class="sr-form"><label>Receivable<select class="sr-in" name="ar"><option value=""' + (cur ? '' : ' selected') + '>No receivable</option>' +
      (cur && !open.some(o => o.id === cur) ? '<option value="' + _trE(cur) + '" selected>' + _trE(cur) + '</option>' : '') +
      (past.length ? '<optgroup label="Past due">' + past.map(opt).join('') + '</optgroup>' : '') +
      (rest.length ? '<optgroup label="Not due yet">' + rest.map(opt).join('') + '</optgroup>' : '') + '</select></label>' +
    '<p class="sr-help">A linked email counts as a collection follow-up, and is numbered with that customer\'s other follow-ups.</p>' +
    '<div class="sr-formfoot"><span></span><button type="submit" class="btn-sm primary">Save</button></div></form>', back,
    (form) => {
      S.state.mailArs = S.state.mailArs || {};
      S.state.mailArs[id] = String(form.elements.ar.value || '').trim();
      _trClose(); _trRefresh(S); _trSave(S);
    });
}
function _trStep(S, dir) {
  const d = srAddDays(S.day, dir);
  if (d > S.today || d < srAddDays(S.today, -28)) return;
  _trOpenDay(S, d);
}
function _trSubmitPm(S) {
  const bl = _trQ(S, '[data-blocker]');
  if (bl) S.state.pm.blocker = bl.value.trim();
  if (!S.state.pm.blocker) { if (bl) { bl.focus(); bl.setAttribute('aria-invalid', 'true'); } _trStatus(S, 'Type one line of blocker — or "no blocker" — first.', 'bad'); return; }
  const n = _trNums(S), snap = trSnapshot(n.portal.concat(n.weekly), n.mine, S.day, S.person);
  snap.at = _trNowIso();
  _trSave(S, { submit: true, snapshot: snap });
}

/* ── dialogs: a new or edited line, a void, the records behind a tile ─────────────────────────── */

let _trDlg = { S: null, back: null, onSubmit: null };
function _trOverlay() {
  let ov = document.getElementById('trOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay sr-overlay';
  ov.id = 'trOverlay';
  ov.innerHTML = '<div class="flow-modal sr-modal" role="dialog" aria-modal="true" aria-labelledby="trDlgTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', ev => {
    if (ev.target === ov) { _trClose(); return; }
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (b && b.hasAttribute('data-close')) _trClose();
  });
  ov.addEventListener('submit', ev => { ev.preventDefault(); if (typeof _trDlg.onSubmit === 'function') _trDlg.onSubmit(ev.target); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && ov.classList.contains('open')) _trClose(); });
  return ov;
}
function _trDialog(S, title, sub, inner, back, onSubmit) {
  const ov = _trOverlay(), box = ov.querySelector('.sr-modal');
  _trDlg = { S, back: back || null, onSubmit: onSubmit || null };
  box.innerHTML = '<header class="sr-mhead"><div><h3 id="trDlgTitle">' + _trE(title) + '</h3>' + (sub ? '<p class="dh-meta">' + _trE(sub) + '</p>' : '') + '</div>' +
    '<button type="button" class="dh-btn" data-close>Close</button></header>' + inner;
  ov.classList.add('open');
  document.body.classList.add('sr-open');
  box.scrollTop = 0;
  const first = box.querySelector('input, select, textarea') || box.querySelector('[data-close]');
  if (first && first.focus) first.focus();
}
function _trClose() {
  const ov = document.getElementById('trOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('sr-open');
  const back = _trDlg.back;
  _trDlg = { S: null, back: null, onSubmit: null };
  if (back && back.focus) back.focus();
}

/** The form for one typed line: what, the record it is about, the result, the next date, one line of what happened. */
function _trLineFields(S, x, v) {
  const linkVal = v.linkType && v.linkType !== 'none' ? v.linkType + '|' + v.linkId : '';
  let link = '';
  if (x.link) {
    const list = trLinkOptions(S.role, S.ix)[x.link] || [];
    const listed = list.some(o => linkVal === x.link + '|' + o.id);
    link = '<label>Linked to<select class="sr-in" name="link"><option value="none|">No record</option>' +
      (linkVal && !listed ? '<option value="' + _trE(linkVal) + '" selected>' + _trE('Keep: ' + (v.linkLabel || v.linkId)) + '</option>' : '') +
      list.map(o => '<option value="' + x.link + '|' + _trE(o.id) + '"' + (linkVal === x.link + '|' + o.id ? ' selected' : '') + '>' + _trE(o.label) + '</option>').join('') + '</select></label>';
  }
  const what = x.whatChoices
    ? '<label>' + _trE(x.what) + '<select class="sr-in" name="what">' + x.whatChoices.map(c => '<option' + (v.what === c ? ' selected' : '') + '>' + _trE(c) + '</option>').join('') + '</select></label>'
    : '<label>' + _trE(x.what) + '<input type="text" class="sr-in" name="what" maxlength="120" value="' + _trE(v.what) + '"' + (x.type === 'Other task' ? ' required' : '') + '></label>';
  const pills = x.results.length ? '<fieldset class="sr-results"><legend>Result</legend>' + x.results.map(r => '<label class="sr-pill"><input type="radio" name="result" value="' + _trE(r) + '"' +
    ((v.result || x.results[0]) === r ? ' checked' : '') + '><span>' + _trE(r) + '</span></label>').join('') + '</fieldset>' : '';
  return '<div class="sr-grid2">' + what + (link || '<span></span>') + '</div>' + pills +
    (x.next ? '<label>Next step date<input type="date" class="sr-in" name="nextDate" value="' + _trE(v.nextDate) + '"></label>' : '') +
    '<label>What happened (one line)<input type="text" class="sr-in" name="note" maxlength="200" value="' + _trE(v.note) + '"></label>';
}
function _trLineDialog(S, type, editId, back) {
  const line = editId ? S.state.lines.find(l => l.id === editId) : null;
  const t = line ? line.type : type, x = S.cfg.lines.find(y => y.type === t) || (line && (S.cfg.retired || []).find(y => y.type === t));   // A365 — a retired type's old line stays editable
  if (!x) return;
  const v = line || {};
  let fields = _trLineFields(S, x, v);
  if (line) fields += '<label>Why are you changing it?<input type="text" class="sr-in" name="why" required placeholder="Wrong account"></label>';
  _trDialog(S, line ? 'Edit the line' : t, line ? 'The line keeps what it said before, and why it changed.' : S.cfg.title + ' — one line, right after.',
    '<form class="sr-form">' + fields + '<div class="sr-formfoot"><span></span><button type="submit" class="btn-sm primary">' + (line ? 'Save the change' : 'Log it') + '</button></div></form>', back,
    (form) => {
      const el = form.elements, val = (k) => (el[k] ? String(el[k].value || '').trim() : '');
      const result = el.result && el.result.length !== undefined && el.result[0] ? ((Array.prototype.find.call(el.result, r => r.checked) || {}).value || '') : val('result');
      let link = { linkType: 'none', linkId: '', linkLabel: '' };
      if (el.link) {
        const [lt, id] = String(el.link.value || 'none|').split('|');
        if (line && el.link.value === (line.linkType + '|' + line.linkId)) link = { linkType: line.linkType, linkId: line.linkId, linkLabel: line.linkLabel };
        else if (id) { const hit = (trLinkOptions(S.role, S.ix)[lt] || []).find(o => o.id === id); link = { linkType: lt, linkId: id, linkLabel: hit ? hit.label : id, company: hit ? hit.company : '' }; }
      }
      const f = Object.assign({ type: t, what: val('what') || (x.fill && link.company) || '', result, note: val('note'), nextDate: val('nextDate') }, link);
      delete f.company;
      if (!f.what && !f.note && !f.linkId) { if (el.what && el.what.focus) el.what.focus(); return; }
      if (line) { const r = trEditLine(line, f, val('why'), _trNowIso()); if (r.error) { if (el.why) el.why.focus(); return; } }
      else S.state.lines.push(trNewLine(S.role, f, S.me, _trNowIso()));
      _trClose(); _trRefresh(S); _trSave(S);
    });
}
function _trVoidDialog(S, id, back) {
  const line = S.state.lines.find(l => l.id === id);
  if (!line) return;
  _trDialog(S, 'Void this line', 'The line stays on the report, struck through, with your reason. Nothing is deleted.',
    '<form class="sr-form"><p class="sr-help">' + _trE(srClock(line.loggedAt) + ' · ' + line.type + ' · ' + (line.what || '')) + '</p>' +
    '<label>Why is it void?<input type="text" class="sr-in" name="why" required placeholder="Logged twice"></label>' +
    '<div class="sr-formfoot"><span></span><button type="submit" class="btn-sm primary">Void the line</button></div></form>', back,
    (form) => {
      const r = trVoidLine(line, String(form.elements.why.value || '').trim(), _trNowIso());
      if (r.error) return;
      _trClose(); _trRefresh(S); _trSave(S);
    });
}
function _trRecordsOpen(S, key, back) {
  const n = S.nums || _trNums(S), t = n.portal.concat(n.weekly).concat(n.mine).find(x => x.key === key);
  if (!t) return;
  const rows = (t.items || []).map(it => '<li><span class="tm">' + _trE(it.time || '') + '</span><span class="x">' + (it.ref ? '<b>' + _trE(it.ref) + '</b> ' : '') + _trE(it.what || '') +
    (it.result ? '<span class="sr-sub">' + _trE(it.result) + '</span>' : '') + '</span><span class="amt">' + (it.value ? _trE(srMoney(it.value)) : '') + '</span><span></span></li>').join('');
  const lgNote = S.role === 'leadgen' && key.indexOf('m_') !== 0 ? 'Counted by the lead gen home from ' + (S.person || 'the person') + '\'s records; open the lead gen home for the list.' : '';
  _trDialog(S, t.label, srDayLong(S.day) + ' — ' + (key.indexOf('m_') === 0 ? 'typed lines' : (S.person || 'no one') + '\'s records'),
    '<div class="sr-rec"><p><span class="sr-chip ' + _trE(t.status) + '">' + _trE(t.text) + '</span> <span class="dh-meta">' + _trE(t.target) + '</span></p>' +
    (lgNote ? '<p class="dh-meta">' + _trE(lgNote) + '</p>' : '') + (rows ? '<ul class="sr-items">' + rows + '</ul>' : lgNote ? '' : '<p class="dh-empty">No records.</p>') + '</div>', back, null);
}
