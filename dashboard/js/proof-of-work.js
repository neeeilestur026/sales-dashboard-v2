/* proof-of-work.js — A347 · the Sales daily report with proof, first on the director's dashboard (a private trial).
 *
 * The form from Neil's pack (Hi-ESCORP_Proof_of_Work_Sales.pdf, "daily report with proof", and the filled sample's
 * "during the day — what I log"): the 8:00 huddle lines, the day's log, what the portal logged by itself, the 4:30
 * lines and the Friday lines. The person types a few lines a day and gives each one its reference; the grey lines
 * are filled by the portal from their own records (js/proof-of-work-model.js), and each grey line opens the records
 * behind it.
 *
 * Saving: saveProofReport / getProofReports (FlowAPI 176), secured and director-only while it is a trial, so nobody
 * else sees it. What is typed is also kept as a draft on this computer until it is saved — so nothing is lost if the
 * backend is not pasted yet or a save fails. */

const POW_UI = { me: null, ix: null, day: '', saved: {}, failed: [], mail: {}, backend: true, backendMsg: '', timer: 0, state: null, unsaved: false, nums: null, back: null };
const POW_TYPES = ['Visit', 'Presentation', 'Call', 'Follow-up', 'Performance call', 'Quote result', 'Sales order', 'Other'];
const POW_STATUS = { ok: 'on target', watch: 'watch', red: 'red', none: '', nr: 'not recorded yet' };

function _powE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _powNowMin() { const d = new Date(); return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes(); }   // Manila, UTC+8
function _powShift(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function _powBlank() {
  return { v: 1, huddle: { booked: { n: '', proof: '' }, plan: '', blocker: '' }, log: [],
           eod: { visits: { n: '', proof: '' }, follow: { n: '', proof: '' }, carry: '' },
           week: { slots: { n: '', proof: '' }, missed: '', fix: '', owner: '', by: '' } };
}
/** A saved or drafted report laid over a blank one, so a field added later never reads as undefined. */
function _powFill(r) {
  const o = r || {};
  const merge = (x, y) => {
    Object.keys(x).forEach(k => {
      if (!y || y[k] === undefined || k === 'log') return;
      x[k] = (x[k] && typeof x[k] === 'object') ? merge(x[k], y[k]) : String(y[k]);
    });
    return x;
  };
  const b = merge(_powBlank(), o);
  b.log = Array.isArray(o.log) ? o.log.map(l => ({ time: String(l.time || ''), type: String(l.type || ''), what: String(l.what || ''),
                                                   result: String(l.result || ''), ref: String(l.ref || '') })) : [];
  return b;
}

/* ── the draft on this computer (a per-viewer convenience; the portal is the record) ────────────── */
function _powDraftKey(day) { return 'hx_pow_draft:' + ((POW_UI.me && POW_UI.me.username) || 'me') + ':' + day; }
function _powDraftGet(day) { try { const v = JSON.parse(localStorage.getItem(_powDraftKey(day)) || 'null'); return v && v.report ? v : null; } catch (e) { return null; } }
function _powDraftPut(day, report) { try { localStorage.setItem(_powDraftKey(day), JSON.stringify({ t: Date.now(), report })); } catch (e) {} }
function _powDraftDrop(day) { try { localStorage.removeItem(_powDraftKey(day)); } catch (e) {} }

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

async function proofOfWork(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const s = (typeof getSession === 'function' && getSession()) || {};
  const name = String(s.name || s.username || '').trim();
  POW_UI.me = { name, username: String(s.username || ''), first: name.split(/\s+/)[0] || 'You' };
  POW_UI.day = POW_UI.day || flowToday();
  _powControls();
  await _powLoad(false);
}

async function _powLoad(fresh) {
  const body = document.getElementById('powBody');
  if (body) body.innerHTML = '<div class="dh-empty">Reading your day…</div>';
  const today = flowToday(), from = _powShift(today, -42), opt = fresh ? { fresh: true } : {};
  const failed = [];
  const get = (label, action, params) => fetchFlow(action, params || {}, opt)
    .then(r => { if (!r || r.success === false) throw new Error('no'); return r.data; })
    .catch(() => { failed.push(label); return null; });
  const saved = (typeof postFlow === 'function' ? postFlow('getProofReports', { from: _powShift(today, -35), to: today }) : Promise.reject(new Error('no')))
    .then(r => (r && r.success ? { ok: true, data: r.data || [] } : { ok: false, message: (r && r.message) || '' }))
    .catch(e => ({ ok: false, message: String(e && e.message || '') }));
  const [quotations, salesOrders, quotationEmails, settings, prs, activity, calls, visits, itineraries, leads, mine] = await Promise.all([
    get('quotations', 'getQuotations'), get('sales orders', 'getSalesOrders'), get('quotation emails', 'getQuotationEmails'),
    get('settings', 'getFlowSettings'), get('purchase requests', 'getPricingRequests'),
    get('activity log', 'getActivityLog', { from, to: today }), get('calls', 'getSalesCalls', { from, to: today }),
    get('client visits', 'getClientVisits', { from, to: today }), get('weekly plans', 'getWeeklyItineraries'),
    get('Lead Gen presentations', 'getLeadgen', { entity: 'leads' }), saved
  ]);
  POW_UI.failed = failed;
  POW_UI.ix = powIndex({ today, quotations, salesOrders, quotationEmails, settings, prs, activity, calls, visits, itineraries,
                         leads: (leads && leads.leads) || [] });
  POW_UI.saved = {};
  POW_UI.backend = mine.ok;
  POW_UI.backendMsg = mine.ok ? '' : mine.message;
  (mine.data || []).forEach(r => { if (r && r.date && String(r.user || '').toLowerCase() === POW_UI.me.name.toLowerCase()) POW_UI.saved[r.date] = r; });
  POW_UI.mail = {};
  _powOpenDay(POW_UI.day);
}

/* ── the controls ─────────────────────────────────────────────────────────────────────────────── */

function _powControls() {
  const ctl = document.getElementById('powCtl');
  if (!ctl) return;
  ctl.innerHTML =
    '<div class="dh-pow-day"><button type="button" class="dh-pow-step" data-step="-1" aria-label="Previous working day">‹</button>' +
      '<span class="dh-pow-dlab" id="powDay"></span>' +
      '<button type="button" class="dh-pow-step" data-step="1" aria-label="Next working day">›</button></div>' +
    '<button type="button" class="dh-chip" data-today>Today</button>' +
    '<span class="dh-pow-state" id="powState" role="status"></span>' +
    '<button type="button" class="btn-sm primary" id="powSave" data-save>Save report</button>';
  ctl.addEventListener('click', ev => {
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (!b) return;
    if (b.hasAttribute('data-step')) _powStep(Number(b.getAttribute('data-step')));
    else if (b.hasAttribute('data-today')) _powOpenDay(flowToday());
    else if (b.hasAttribute('data-save')) _powSave();
  });
}

/** One working day back or forward, never past today and never more than four weeks back. */
function _powStep(dir) {
  const today = flowToday(), floor = _powShift(today, -28);
  let d = POW_UI.day;
  do { d = _powShift(d, dir); } while (powDow(d) === 'Sat' || powDow(d) === 'Sun');
  if (d > today || d < floor) return;
  _powOpenDay(d);
}

/** Show one day: the newer of the saved report and this computer's draft. */
function _powOpenDay(day) {
  clearTimeout(POW_UI.timer);
  POW_UI.day = day;
  const saved = POW_UI.saved[day], draft = _powDraftGet(day);
  const savedAt = saved && saved.updatedAt ? Date.parse(saved.updatedAt) || 0 : 0;
  POW_UI.state = _powFill(draft && draft.t > savedAt ? draft.report : saved ? saved.report : null);
  POW_UI.unsaved = !!(draft && draft.t > savedAt);
  _powRender();
}

function _powSetState() {
  const el = document.getElementById('powState'), saved = POW_UI.saved[POW_UI.day];
  if (!el) return;
  if (POW_UI.unsaved) el.textContent = 'Not saved yet — kept on this computer';
  else if (saved) el.textContent = 'Saved ' + powClock(saved.updatedAt) + (saved.reportNo ? ', ' + saved.reportNo : '');
  else el.textContent = 'Nothing saved for this day';
  el.className = 'dh-pow-state' + (POW_UI.unsaved ? ' warn' : saved ? ' ok' : '');
}

/* ── the form ─────────────────────────────────────────────────────────────────────────────────── */

function _powNums() {
  const ix = POW_UI.ix, me = POW_UI.me, day = POW_UI.day, now = _powNowMin();
  return { m: powMorning(ix, me, day), e: powEvening(ix, me, day, now), w: powWeek(ix, me, day, now) };
}
const _powPick = (list, key) => list.find(n => n.key === key);

function _powRender() {
  const body = document.getElementById('powBody'), ix = POW_UI.ix;
  if (!body || !ix) return;
  const day = POW_UI.day, me = POW_UI.me, nums = _powNums();
  POW_UI.nums = nums;
  const lab = document.getElementById('powDay');
  if (lab) lab.textContent = powDayLong(day) + (day === ix.today ? ' (today)' : '');
  const back = document.querySelector('#powCtl [data-step="-1"]'), fwd = document.querySelector('#powCtl [data-step="1"]');
  if (fwd) fwd.disabled = day >= ix.today;
  if (back) back.disabled = day <= _powShift(ix.today, -28);
  _powSetState();

  const notes = [];
  if (!POW_UI.backend) notes.push('<div class="dh-banner warn">Saving needs the FlowAPI update (version 176). Until it is pasted, what you type is kept on this computer only.' +
    (POW_UI.backendMsg && !/Unknown action|not a secured action/i.test(POW_UI.backendMsg) ? ' (' + _powE(POW_UI.backendMsg) + ')' : '') + '</div>');
  if (POW_UI.failed.length) notes.push('<div class="dh-banner warn">Could not read: ' + _powE(POW_UI.failed.join(', ')) + '. The grey lines that need them may be short — reload the page.</div>');

  const m = nums.m, e = nums.e, w = nums.w;
  const plan = _powPick(m, 'booked'), inPlan = plan.items.filter(i => i.counted).length, inDraft = plan.items.length - inPlan;
  const planHint = plan.items.length
    ? 'Your weekly plan shows ' + inPlan + ' for today' + (inDraft ? ' (and ' + inDraft + ' in a draft plan)' : '') + '.'
    : 'Nothing in your weekly plan for today.';
  const vd = _powPick(e, 'visitsDone').value;

  body.innerHTML = notes.join('') +
    '<p class="dh-pow-who"><span><b>Name</b> ' + _powE(me.name) + '</span><span><b>Date</b> ' + _powE(powDayLong(day)) + '</span>' +
      '<span class="dh-pow-trial">Trial — only you can see this report</span></p>' +
    '<p class="dh-note">Type a few lines a day and give each one its reference. Grey lines are filled by the portal; press one to see the records behind it.</p>' +

    '<section class="dh-pow-block"><h3>8:00 huddle</h3>' +
      _powSheet([
        _powRowYou('Visits / presentations booked today', 'huddle.booked', 'The client accepted the invite, or replied to confirm', planHint, plan.items.length ? 'booked' : ''),
        _powRowPortal(_powPick(m, 'followDue'), 'Portal → Pipeline'),
        _powRowPortal(_powPick(m, 'rfqWaiting'), 'Portal → PR list'),
        _powRowPortal(_powPick(m, 'openQuotes'), 'Portal → Quotations')
      ]) +
      _powLine('Today\'s plan — one line', 'huddle.plan', 'Plant A at 10:00 with the torque kit; Plant B at 14:00') +
      _powLine('One blocker, and the help you need', 'huddle.blocker', 'Or "no blocker"') +
      '<p class="dh-pow-says" id="powSays8"></p></section>' +

    '<section class="dh-pow-block"><h3>During the day — what I log</h3>' +
      '<p class="dh-meta">One line each, right after. The reference is what makes a line easy to check: a quotation or PR number, an email subject and time, a DR number.</p>' +
      '<div class="dh-pow-scroll"><table class="dh-pow-table dh-pow-log"><thead><tr><th scope="col">Time</th><th scope="col">Type</th>' +
        '<th scope="col">Client, person, subject</th><th scope="col">Result</th><th scope="col">Reference</th><th scope="col"><span class="dh-pow-sr">Remove</span></th></tr></thead>' +
        '<tbody id="powLog">' + _powLogRows() + '</tbody></table></div>' +
      '<button type="button" class="dh-btn" data-addline>Add a line</button></section>' +

    '<section class="dh-pow-block"><h3>What the portal logged by itself — you typed none of this</h3>' +
      '<div id="powAuto">' + _powAutoList(powAuto(ix, me, day)) + '</div><p class="dh-meta" id="powMailNote">Reading your sent mail…</p></section>' +

    '<section class="dh-pow-block"><h3>4:30 report</h3>' +
      _powSheet([
        _powRowYou('Visits / presentations done', 'eod.visits', 'Same-day email to the client (what we discussed, next step) + gate pass photo (field) or the meeting invite (online)',
                   'The portal has ' + vd + ' client visit' + (vd === 1 ? '' : 's') + ' logged for you this day.', vd ? 'visitsDone' : ''),
        _powRowPortal(_powPick(e, 'rfqs'), 'portal fills it'),
        _powRowPortal(_powPick(e, 'quotesSent'), 'portal fills it'),
        _powRowYou('Follow-ups done', 'eod.follow', 'Follow-up email, or a call note with the result',
                   'The portal sees ' + _powPick(e, 'followDone').text + ' from your calls and chase emails.', 'followDone', '3 of 3')
      ]) +
      _powLine('What carries over to tomorrow, and why', 'eod.carry', 'Plant A\'s PR — the user sends the cylinder stroke by 10:00') +
      '<p class="dh-pow-says" id="powSays430"></p></section>' +

    '<section class="dh-pow-block"><h3>Friday — weekly lines <span class="dh-meta">week of ' + _powE(powDayLong(w.days[0])) + '</span></h3>' +
      '<div class="dh-pow-scroll"><table class="dh-pow-table dh-pow-sheet"><thead><tr><th scope="col">Number</th><th scope="col">Week</th><th scope="col">Target</th>' +
        '<th scope="col">Status</th><th scope="col">Who fills it</th></tr></thead><tbody id="powWeek">' + _powWeekRows() + '</tbody></table></div>' +
      '<div class="dh-pow-grid4">' + _powLine('What I missed, and why', 'week.missed', '') + _powLine('Next week\'s fix', 'week.fix', '') +
        _powLine('Owner', 'week.owner', '') + _powLine('By when', 'week.by', 'Fri 16:00') + '</div>' +
      '<p class="dh-pow-says" id="powReading"></p></section>' +

    '<section class="dh-pow-block dh-pow-refs"><h3>How to write a reference</h3><ul>' +
      '<li><b>Quotation:</b> the quote number from the portal.</li><li><b>PR:</b> the PR number from the portal.</li>' +
      '<li><b>Email:</b> subject + time sent (the portal logs it).</li><li><b>Visit:</b> plant + time + the same-day email to the client.</li>' +
      '<li><b>Slot:</b> plant + date + time, and "accepted" or the reply email.</li><li><b>Supplier PO:</b> PO number + supplier.</li></ul></section>';

  _powSays();
  if (!body.dataset.wired) {
    body.dataset.wired = '1';
    body.addEventListener('input', _powOnInput);
    body.addEventListener('change', _powOnInput);
    body.addEventListener('click', ev => {
      const b = ev.target.closest ? ev.target.closest('button') : null;
      if (!b) return;
      if (b.hasAttribute('data-addline')) { POW_UI.state.log.push({ time: '', type: '', what: '', result: '', ref: '' }); _powRedrawLog(true); _powTouch(); }
      else if (b.hasAttribute('data-rmline')) { POW_UI.state.log.splice(Number(b.getAttribute('data-rmline')), 1); _powRedrawLog(false); _powTouch(); }
      else if (b.hasAttribute('data-rec')) _powRecordsOpen(b.getAttribute('data-rec'), b);
    });
  }
  _powMail(day);
}

function _powSheet(rows) {
  return '<div class="dh-pow-scroll"><table class="dh-pow-table dh-pow-sheet"><thead><tr><th scope="col">Number</th><th scope="col">Today</th>' +
    '<th scope="col">Proof — the reference</th><th scope="col">Who fills it</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}
function _powGet(path) { return path.split('.').reduce((o, k) => (o == null ? '' : o[k]), POW_UI.state); }
function _powIn(path, cls, ph, label) {
  return '<input type="text" class="dh-pow-in' + (cls ? ' ' + cls : '') + '" data-k="' + path + '" value="' + _powE(_powGet(path)) + '"' +
    (ph ? ' placeholder="' + _powE(ph) + '"' : '') + ' aria-label="' + _powE(label) + '">';
}
/** A line the person fills: the number and its proof, with what the portal sees beside it as a hint. */
function _powRowYou(label, path, proofPh, hint, recKey, nPh) {
  return '<tr><th scope="row">' + _powE(label) + (hint ? '<span class="dh-pow-sub">' + _powE(hint) +
      (recKey ? ' <button type="button" class="dh-pow-link" data-rec="' + recKey + '">See them</button>' : '') + '</span>' : '') + '</th>' +
    '<td>' + _powIn(path + '.n', 'n', nPh || '0', label + ', today') + '</td>' +
    '<td>' + _powIn(path + '.proof', '', proofPh, label + ', proof') + '</td><td class="who">You</td></tr>';
}
/** A grey line: the portal's number for this person, which opens the records behind it. */
function _powRowPortal(n, where) {
  const val = n.status === 'nr'
    ? '<span class="dh-pow-nrv">not recorded yet</span>'
    : '<button type="button" class="dh-pow-grey" data-rec="' + n.key + '">' + _powE(n.text) + '</button>' +
      (POW_STATUS[n.status] ? '<span class="dh-pow-st s-' + n.status + '">' + POW_STATUS[n.status] + '</span>' : '');
  return '<tr class="grey"><th scope="row">' + _powE(n.label) + (n.extra ? '<span class="dh-pow-sub">' + _powE(n.extra) + '</span>' : '') + '</th>' +
    '<td>' + val + '</td><td class="dh-pow-where">' + _powE(n.status === 'nr' ? n.notRecorded : where) + '</td><td class="who">Portal</td></tr>';
}
function _powLine(label, path, ph) {
  return '<label class="dh-pow-line"><span>' + _powE(label) + '</span>' + _powIn(path, '', ph, label) + '</label>';
}

/* the day's log: the calls and visits already logged in the portal (grey), then the lines typed here */
function _powLogRows() {
  const portal = powLog(POW_UI.ix, POW_UI.me, POW_UI.day).map(l => '<tr class="grey"><td class="tm">' + _powE(l.time || '—') + '</td><td>' + _powE(l.type) + '</td>' +
    '<td><b>' + _powE(l.client) + '</b>' + (l.person ? ', ' + _powE(l.person) : '') + (l.what ? '<span class="dh-pow-sub">' + _powE(l.what) + '</span>' : '') + '</td>' +
    '<td>' + _powE(l.result || '—') + '</td><td class="ref">' + _powE(l.ref) + '<span class="dh-pow-tag">logged in the portal</span>' +
    (l.photo ? '<span class="dh-pow-tag">photo on file</span>' : '') + '</td><td></td></tr>');
  const typed = POW_UI.state.log.map((l, i) => {
    const n = 'Line ' + (i + 1) + ', ';
    return '<tr>' +
      '<td><input type="time" class="dh-pow-in tm" data-li="' + i + '" data-f="time" value="' + _powE(l.time) + '" aria-label="' + n + 'time"></td>' +
      '<td><select class="dh-pow-in" data-li="' + i + '" data-f="type" aria-label="' + n + 'type"><option value="">Type…</option>' +
        POW_TYPES.map(t => '<option' + (t === l.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></td>' +
      '<td><input type="text" class="dh-pow-in" data-li="' + i + '" data-f="what" value="' + _powE(l.what) + '" placeholder="Plant A, R. Cruz, torque wrench" aria-label="' + n + 'client, person, subject"></td>' +
      '<td><input type="text" class="dh-pow-in" data-li="' + i + '" data-f="result" value="' + _powE(l.result) + '" placeholder="RFQ promised 29 Oct" aria-label="' + n + 'result"></td>' +
      '<td><input type="text" class="dh-pow-in" data-li="' + i + '" data-f="ref" value="' + _powE(l.ref) + '" placeholder="Q-1042, PR-0318, email subject + time" aria-label="' + n + 'reference"></td>' +
      '<td><button type="button" class="dh-pow-rm" data-rmline="' + i + '" aria-label="Remove line ' + (i + 1) + '">Remove</button></td></tr>';
  });
  const rows = portal.concat(typed);
  return rows.length ? rows.join('') : '<tr><td colspan="6" class="dh-empty">No lines yet. Add one for each visit, call, presentation or result.</td></tr>';
}
function _powRedrawLog(focusLast) {
  const tb = document.getElementById('powLog');
  if (!tb) return;
  tb.innerHTML = _powLogRows();
  _powRedrawWeek(true);
  if (focusLast) { const last = tb.querySelector('tr:last-child input[data-f="time"]'); if (last && last.focus) last.focus(); }
}

/* the Friday lines: the week's own numbers from the portal, the person's from their daily lines */
function _powWeekSums() {
  const w = POW_UI.nums.w, out = { visits: 0, followDone: 0, followDue: 0, perf: 0, days: 0 };
  w.days.forEach(d => {
    const r = d === POW_UI.day ? POW_UI.state : (POW_UI.saved[d] ? _powFill(POW_UI.saved[d].report) : null);
    if (!r) return;
    out.days++;
    out.visits += Number(r.eod.visits.n) || 0;
    const f = /^\s*(\d+)\s*(?:of|\/)\s*(\d+)/i.exec(String(r.eod.follow.n || ''));
    if (f) { out.followDone += Number(f[1]); out.followDue += Number(f[2]); }
    else if (/^\s*\d+\s*$/.test(String(r.eod.follow.n || ''))) { out.followDone += Number(r.eod.follow.n); out.followDue += Number(r.eod.follow.n); }
    out.perf += r.log.filter(l => l.type === 'Performance call').length;
  });
  return out;
}
function _powWeekRows() {
  const w = POW_UI.nums.w, cfg = POW_UI.ix.cfg, sum = _powWeekSums(), row = (k) => _powPick(w.rows, k);
  const st = (s) => (POW_STATUS[s] && s !== 'nr' ? '<span class="dh-pow-st s-' + s + '">' + POW_STATUS[s] + '</span>' : '');
  const yours = (label, text, target, status) => '<tr><th scope="row">' + _powE(label) + '</th><td class="wk">' + _powE(text) + '</td><td>' + _powE(target) + '</td>' +
    '<td>' + st(status) + '</td><td class="who">Sum of your daily lines</td></tr>';
  const portal = (n, who) => '<tr class="grey"><th scope="row">' + _powE(n.label) + '</th><td class="wk">' +
    (n.status === 'nr' ? '<span class="dh-pow-nrv">not recorded yet</span>' : '<button type="button" class="dh-pow-grey" data-rec="w:' + n.key + '">' + _powE(n.text) + '</button>') + '</td>' +
    '<td>' + _powE(n.target) + '</td><td>' + st(n.status) + '</td><td class="who">' + _powE(who || 'Portal') + '</td></tr>';
  const ended = w.nowEnded;
  return [
    yours('Visits / presentations done', String(sum.visits), cfg.powVisitsWeek + ' a week',
          sum.visits >= cfg.powVisitsWeek ? 'ok' : (ended && sum.visits < cfg.powVisitsWeekRed) ? 'red' : sum.days ? 'watch' : 'none'),
    portal(row('rfqs')), portal(row('prsReturned')), portal(row('quotes')), portal(row('within48')),
    yours('Follow-ups done', sum.followDone + ' of ' + sum.followDue, 'all due, with a result', sum.followDue ? (sum.followDone >= sum.followDue ? 'ok' : 'red') : 'none'),
    yours('Performance calls', String(sum.perf), '1 per delivery', 'none'),
    portal(row('soMonth'), 'Accounting matches'), portal(row('open')),
    '<tr><th scope="row">My slots confirmed for next week</th><td>' + _powIn('week.slots.n', 'n', '0', 'Slots confirmed for next week') + '</td>' +
      '<td>' + cfg.powSlotsWeek + ' of ' + cfg.powSlotsWeek + ' by Fri 16:00</td><td colspan="2">' +
      _powIn('week.slots.proof', '', 'Plant + date + time, and "accepted" or the reply email', 'Slots, proof') + '</td></tr>'
  ].join('');
}
/** Redraw the Friday lines when a daily line they add up changes — but never under the person's cursor. */
function _powRedrawWeek(force) {
  const tb = document.getElementById('powWeek');
  if (!tb) return;
  if (!force && document.activeElement && tb.contains(document.activeElement)) return;
  tb.innerHTML = _powWeekRows();
}

/** The week's rows with the person's own lines (visits, follow-ups) as they added them up, not as the portal logged them. */
function _powWeekAsTyped() {
  const w = POW_UI.nums.w, cfg = POW_UI.ix.cfg, sum = _powWeekSums();
  const rows = w.rows.map(r => {
    if (r.key === 'visits') return Object.assign({}, r, { value: sum.visits, text: String(sum.visits),
      status: sum.visits >= cfg.powVisitsWeek ? 'ok' : (w.nowEnded && sum.visits < cfg.powVisitsWeekRed) ? 'red' : 'watch' });
    if (r.key === 'follow') return Object.assign({}, r, { value: sum.followDone, text: sum.followDone + ' of ' + sum.followDue,
      status: sum.followDone >= sum.followDue ? 'ok' : 'red', items: [] });
    return r;
  });
  return Object.assign({}, w, { rows });
}

function _powSays() {
  const st = POW_UI.state, n = POW_UI.nums, a = document.getElementById('powSays8'), b = document.getElementById('powSays430');
  const rd = document.getElementById('powReading');
  if (rd) rd.innerHTML = '<b>Reading it:</b> ' + _powE(powReading(POW_UI.me, _powWeekAsTyped(), POW_UI.ix));
  if (a) a.innerHTML = '<b>At the huddle:</b> ' + _powE(powSaysMorning(n.m, POW_UI.ix.cfg, { booked: st.huddle.booked.n, plan: st.huddle.plan, blocker: st.huddle.blocker }));
  if (b) b.innerHTML = '<b>At the huddle:</b> ' + _powE(powSaysEvening(n.e, { visits: st.eod.visits.n, follow: st.eod.follow.n, carry: st.eod.carry }));
}

/* ── typing, the draft, saving ────────────────────────────────────────────────────────────────── */

function _powOnInput(ev) {
  const t = ev.target;
  if (!t || !POW_UI.state || !t.hasAttribute) return;
  if (t.hasAttribute('data-k')) {
    const path = t.getAttribute('data-k').split('.'), last = path.pop();
    const obj = path.reduce((o, k) => o[k], POW_UI.state);
    obj[last] = t.value;
  } else if (t.hasAttribute('data-li')) {
    const l = POW_UI.state.log[Number(t.getAttribute('data-li'))];
    if (l) l[t.getAttribute('data-f')] = t.value;
  } else return;
  _powTouch();
}
function _powTouch() {
  POW_UI.unsaved = true;
  _powSetState();
  _powSays();
  clearTimeout(POW_UI.timer);
  const day = POW_UI.day, report = POW_UI.state;
  POW_UI.timer = setTimeout(() => { _powDraftPut(day, report); if (day === POW_UI.day) _powRedrawWeek(false); }, 400);
}

/** The portal's numbers as they stood when the report was saved, kept beside it. */
function _powSnapshot() {
  const n = POW_UI.nums, out = {};
  n.m.concat(n.e).forEach(x => { out[x.key] = x.text; });
  n.w.rows.forEach(x => { out['week.' + x.key] = x.text; });
  return out;
}

async function _powSave() {
  const btn = document.getElementById('powSave'), day = POW_UI.day, report = POW_UI.state;
  if (!report || !btn) return;
  clearTimeout(POW_UI.timer);
  _powDraftPut(day, report);
  btn.disabled = true; btn.textContent = 'Saving…';
  let r;
  try { r = await postFlow('saveProofReport', { date: day, reportJson: JSON.stringify(report), portalJson: JSON.stringify(_powSnapshot()) }); }
  catch (e) { r = { success: false, message: String(e && e.message || e) }; }
  btn.disabled = false; btn.textContent = 'Save report';
  if (r && r.success) {
    POW_UI.saved[day] = { date: day, user: POW_UI.me.name, report: JSON.parse(JSON.stringify(report)), updatedAt: r.updatedAt || new Date().toISOString(), reportNo: r.reportNo };
    POW_UI.backend = true;
    _powDraftDrop(day);
    if (day === POW_UI.day) { POW_UI.unsaved = false; _powSetState(); }
    return;
  }
  const msg = r && r.message ? r.message : 'The save did not go through.';
  const el = document.getElementById('powState');
  if (el && day === POW_UI.day) {
    el.textContent = /Unknown action|not a secured action/i.test(msg)
      ? 'Not saved — the FlowAPI update (176) is not pasted yet. Kept on this computer.'
      : 'Not saved — ' + msg + ' Kept on this computer.';
    el.className = 'dh-pow-state bad';
  }
}

/* ── the portal's own log, with the sent mail ─────────────────────────────────────────────────── */

function _powAutoList(lines) {
  if (!lines.length) return '<p class="dh-empty">Nothing logged by the portal for this day.</p>';
  return '<ul class="dh-pow-auto">' + lines.map(a => '<li><span class="tm">' + _powE(a.time || '—') + '</span><span class="k">' + _powE(a.kind) + '</span>' +
    '<span class="x">' + (a.ref ? _powRef(a.ref) + ' ' : '') + _powE(a.text) + (a.amount ? ' — ' + _powE(powMoney(a.amount)) : '') + '</span></li>').join('') + '</ul>';
}

/** The person's sent mail for the day (IMAP, read live through Flask), folded into the portal's own log. */
async function _powMail(day) {
  const me = POW_UI.me, note = () => document.getElementById('powMailNote');
  let r = POW_UI.mail[day];
  if (!r && typeof apiFetchEmailLogToday === 'function') {
    try { r = await apiFetchEmailLogToday(me.name, day); } catch (e) { r = { success: false }; }
    POW_UI.mail[day] = r;
  }
  if (POW_UI.day !== day) return;   // the day moved on while the mailbox answered
  const n = note();
  if (!r || r.success === false) { if (n) n.textContent = 'Could not read your sent mail just now.'; return; }
  if (r.needsSetup) { if (n) n.textContent = 'Your mailbox is not connected to the portal, so sent emails cannot be listed here.'; return; }
  const emails = r.emails || [], box = document.getElementById('powAuto');
  if (box) box.innerHTML = _powAutoList(powWithEmails(powAuto(POW_UI.ix, me, day), emails));
  if (n) n.textContent = emails.length + ' sent email' + (emails.length === 1 ? '' : 's') + ' from your mailbox are included.';
}

/* ── the records behind a grey line ───────────────────────────────────────────────────────────── */

function _powOverlay() {
  let ov = document.getElementById('powOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay dh-pow-overlay';
  ov.id = 'powOverlay';
  ov.innerHTML = '<div class="flow-modal dh-pow-modal" role="dialog" aria-modal="true" aria-labelledby="powTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', ev => {
    if (ev.target === ov) { _powClose(); return; }
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (b && b.hasAttribute('data-pow-close')) _powClose();
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && ov.classList.contains('open')) _powClose(); });
  return ov;
}
function _powRecordsOpen(key, back) {
  const n = POW_UI.nums, isWeek = key.indexOf('w:') === 0, k = isWeek ? key.slice(2) : key;
  const num = isWeek ? _powPick(n.w.rows, k) : (_powPick(n.m, k) || _powPick(n.e, k));
  if (!num) return;
  POW_UI.back = back || null;
  const ov = _powOverlay(), box = ov.querySelector('.dh-pow-modal');
  box.innerHTML = '<header class="dh-pow-mhead"><div><h3 id="powTitle">' + _powE(num.label) + '</h3><p class="dh-meta">' +
      _powE((isWeek ? 'Week of ' + powDayLong(n.w.days[0]) : powDayLong(POW_UI.day)) + ' — ' + POW_UI.me.name) + '</p></div>' +
    '<div class="dh-pow-mnav"><button type="button" class="dh-btn" data-pow-close>Close</button></div></header>' + _powRecords(num);
  ov.classList.add('open');
  document.body.classList.add('dh-pow-open');
  box.scrollTop = 0;
  const c = box.querySelector('[data-pow-close]');
  if (c && c.focus) c.focus();
}
function _powClose() {
  const ov = document.getElementById('powOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('dh-pow-open');
  if (POW_UI.back && POW_UI.back.focus) POW_UI.back.focus();
}

/** A record number as a link to its page, when it has one. */
function _powRef(ref) {
  const r = String(ref || ''), ix = POW_UI.ix;
  if (/^PR-\d/.test(r)) return '<a href="flow-pricing-request.html?pr=' + encodeURIComponent(r) + '">' + _powE(r) + '</a>';
  if (ix && ix.qByNo[r]) return '<a href="flow-quotations.html?review=' + encodeURIComponent(r) + '">' + _powE(r) + '</a>';
  if (/^ITIN-/.test(r)) return '<a href="management-itinerary.html">' + _powE(r) + '</a>';
  return '<b>' + _powE(r) + '</b>';
}

function _powRecords(n) {
  const head = '<div class="dh-pow-rechead"><span class="dh-pow-st s-' + n.status + '">' + _powE(n.text) + '</span>' +
               (n.target ? '<span class="dh-meta">Target: ' + _powE(n.target) + '</span>' : '') + '</div>' +
               (n.note ? '<p class="dh-meta">' + _powE(n.note) + '</p>' : '');
  const rows = (n.items || []).map(it => _powItem(n.key, it)).join('');
  const extra = n.unmatched && n.unmatched.length
    ? '<p class="dh-meta">Sales orders this month that match no rep (' + n.unmatched.length + '):</p><ul class="dh-pow-items">' + n.unmatched.map(it => _powItem('so', it)).join('') + '</ul>' : '';
  return '<div class="dh-pow-rec">' + head + (rows ? '<ul class="dh-pow-items">' + rows + '</ul>' : '<p class="dh-empty">No records.</p>') + extra + '</div>';
}

function _powItem(key, it) {
  const bits = [];
  if (it.day) bits.push(powDow(it.day));
  if (it.date && !it.day) bits.push(it.date);
  if (it.time) bits.push(it.time);
  const when = '<span class="tm">' + _powE(bits.join(' ')) + '</span>';   // always present, so the grid keeps its columns
  const who = [it.client, it.person].filter(Boolean).map(_powE).join(', ');
  let tail = '';
  if (key === 'followDue' || key === 'followDone' || key === 'follow') {
    if (it.done === true) tail = '<span class="dh-pow-st s-ok">' + (it.overdue ? 'overdue, chased' : 'done') + '</span>';
    else if (it.done === false) tail = '<span class="dh-pow-st s-red">not done</span>';
    else if (it.overdue) tail = '<span class="dh-pow-st s-none">overdue, not counted</span>';
    else if (it.carried) tail = '<span class="dh-pow-st s-red">due since the last working day</span>';
  }
  if (it.counted === false) tail = '<span class="dh-pow-st s-none">' + _powE(it.planStatus || 'draft') + ', not counted</span>';
  if (key === 'within48' || it.ok !== undefined) tail = '<span class="dh-pow-st s-' + (it.ok ? 'ok' : 'watch') + '">' + (it.ok ? 'within 48 h' : 'over 48 h') + '</span>';
  const proof = (it.proof || []).map(p => '<span class="dh-pow-tag">' + _powE(p.kind + (p.time ? ' ' + p.time : '') + (p.ref && p.kind !== 'Email' ? ' ' + p.ref : '') + (p.kind === 'Email' ? ' "' + p.ref + '"' : '')) + '</span>').join('');
  return '<li>' + when + '<span class="x">' + _powRef(it.ref) + (who ? ' ' + who : '') +
    (it.what ? '<span class="dh-pow-sub">' + _powE(it.what) + '</span>' : '') +
    (it.result ? '<span class="dh-pow-sub">' + _powE(it.result) + '</span>' : '') + proof + '</span>' +
    '<span class="amt">' + (it.value ? _powE(powMoney(it.value)) : '') + '</span>' + (tail || '<span></span>') + '</li>';
}
