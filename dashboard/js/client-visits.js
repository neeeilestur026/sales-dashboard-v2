/* client-visits.js — A369 · client visits, the new itinerary (client-visits.html).
 *
 * Neil, 25 Oct 2026: "create a new client visit page for each sales, they can select their clients and who to visit in
 * their client book"; the director approves first; "in the accounting, the new client visit will be shown so that it
 * will show the estimated travel allowance in the day of the client visit" — how it is worked out set aside for now.
 * One page, a view per role:
 *   sales       their own visits — Needs you · Coming up · Past — and Plan a visit (a client from their Client Book, the
 *               day, where: plant / head office / other, who: the client's people or someone else, the purpose)
 *   director    Waiting (grouped by rep, then day; approve or send back one or many) · Approved · All · Travel week
 *   accounting  the travel week: day · rep · the approved visits · the estimated travel allowance ("To be set")
 *   management  the travel week and every visit, read only
 * The server (FlowAPI 186) checks every action again; this page only offers what it would allow. The weekly itinerary
 * keeps working beside it. The model is js/client-visits-model.js. */
const CV = { me: null, role: '', today: '', plans: [], log: [], book: null, ok: true, seg: '', rep: '', week: '', sel: {}, busy: false, seq: 0, flash: null, send: '1' };

function _cvE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _cvId(id) { return document.getElementById(id); }
function _cvYear() { return String(CV.today).slice(0, 4); }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireClientVisitsAccess === 'function' ? requireClientVisitsAccess() : null;
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('client-visits');
  CV.me = s;
  CV.role = String(s.role || '').toLowerCase();
  CV.today = flowToday();
  CV.week = cvMonday(CV.today);
  CV.seg = { sales: 'upcoming', director: 'waiting', accounting: 'week', management: 'week' }[CV.role] || 'all';
  _cvId('cvLede').textContent = {
    sales: 'Plan visits to your Client Book clients. Each goes to the director to approve.',
    director: 'Visits the reps plan to their clients. Approve them, or send them back with a note.',
    accounting: 'The approved client visits of each day, with the estimated travel allowance.',
    management: 'Every client visit the reps plan, and the approved ones by day. Read only.'
  }[CV.role] || '';
  const ready = typeof flowVersionAtLeast === 'function' ? await flowVersionAtLeast(186).catch(() => false) : false;
  if (!ready) {
    _cvId('cvNotice').innerHTML = '<div class="dh-banner warn">Client visits open here with the next FlowAPI update (version 186). The weekly itinerary works as before meanwhile.</div>';
    _cvId('cvBar').hidden = true;
    _cvId('cvBody').hidden = true;
    return;
  }
  _cvWire();
  await cvLoad();
  const ask = typeof URLSearchParams === 'function' ? new URLSearchParams(location.search).get('visit') : null;
  if (ask && CV.plans.some(v => v.visitPlanNo === ask)) cvDetail(ask);
});

/* ── the reads ────────────────────────────────────────────────────────────────────────────────── */

/** The visits this person may see (the server scopes them), and for a rep their Client Book to plan from. */
async function cvLoad() {
  const seq = ++CV.seq;
  const fail = (e) => ({ success: false, message: String((e && e.message) || e || '') });
  const [r, book] = await Promise.all([
    postFlow('getVisitPlans', {}).catch(fail),
    CV.role === 'sales' ? postFlow('getClientBook', {}).catch(fail) : Promise.resolve(null)
  ]);
  if (seq !== CV.seq) return;
  CV.ok = !!(r && r.success);
  CV.plans = CV.ok ? r.data || [] : [];
  if (CV.role === 'sales') CV.plans = CV.plans.filter(v => String(v.user || '').trim().toLowerCase() === String(CV.me.name || '').trim().toLowerCase());   // the server scopes a rep already
  CV.log = CV.ok ? r.log || [] : [];
  if (CV.ok && r.today) CV.today = r.today;
  CV.book = book && book.success ? book : null;
  Object.keys(CV.sel).forEach(no => { if (!CV.plans.some(v => v.visitPlanNo === no && v.status === 'Pending Director')) delete CV.sel[no]; });
  if (seq === 1 && CV.role === 'sales' && cvSalesBuckets(CV.plans, CV.today).needs.length) CV.seg = 'needs';   // the first read opens on what needs the rep
  cvRender();
}

/* ── the page ─────────────────────────────────────────────────────────────────────────────────── */

function cvRender() {
  const notes = [];
  if (CV.flash) notes.push('<div class="dh-banner ' + (CV.flash.ok ? 'ok' : 'bad') + '" role="status">' + _cvE(CV.flash.text) + '</div>');
  if (!CV.ok) notes.push('<div class="dh-banner bad">Could not read the visits. Reload the page.</div>');
  if (CV.role === 'sales' && !CV.book) notes.push('<div class="dh-banner warn">Your Client Book could not be read, so no visit can be planned just now. Reload the page.</div>');
  _cvId('cvNotice').innerHTML = notes.join('');
  _cvId('cvActions').innerHTML = CV.role === 'sales'
    ? '<a class="dh-btn" href="weekly-itinerary.html">Weekly itinerary</a><button type="button" class="dh-btn primary" data-plan' + (cvClients(CV.book, CV.me).length ? '' : ' disabled title="Add a client to your Client Book first"') + '>Plan a visit</button>'
    : '';
  _cvId('cvSeg').innerHTML = cvSegments().map(s => '<button type="button" class="cv-segb' + (s.key === CV.seg ? ' on' : '') + '" role="tab" aria-selected="' + (s.key === CV.seg) + '" data-seg="' + s.key + '">' +
    _cvE(s.label) + (s.n === undefined ? '' : ' <span class="n">' + s.n + '</span>') + '</button>').join('');
  _cvId('cvSeg').hidden = cvSegments().length < 2;
  _cvId('cvTools').innerHTML = cvToolsHtml();
  _cvId('cvBody').innerHTML = cvBodyHtml();
  cvBulkRender();
}

/** The segments of this person's view, with their counts. */
function cvSegments() {
  const p = CV.plans;
  if (CV.role === 'sales') {
    const b = cvSalesBuckets(p, CV.today);
    return [{ key: 'needs', label: 'Needs you', n: b.needs.length }, { key: 'upcoming', label: 'Coming up', n: b.upcoming.length }, { key: 'past', label: 'Past', n: b.past.length }];
  }
  if (CV.role === 'director') {
    return [{ key: 'waiting', label: 'Waiting', n: p.filter(v => v.status === 'Pending Director').length }, { key: 'approved', label: 'Approved', n: p.filter(v => v.status === 'Approved').length },
            { key: 'all', label: 'All', n: p.length }, { key: 'week', label: 'Travel week' }];
  }
  if (CV.role === 'management') return [{ key: 'week', label: 'Travel week' }, { key: 'all', label: 'All visits', n: p.length }];
  return [{ key: 'week', label: 'Travel week' }];
}

/** Over the list: the rep filter (when there is more than one rep), the week stepper on the travel week. */
function cvToolsHtml() {
  const out = [];
  if (CV.seg === 'week') {
    out.push('<div class="cv-week" role="group" aria-label="Week"><button type="button" class="cv-step" data-week="-7" aria-label="Week before">‹</button>' +
      '<span class="cv-wlabel">' + _cvE(cvWeekLabel(CV.week)) + '</span><button type="button" class="cv-step" data-week="7" aria-label="Week after">›</button>' +
      (CV.week === cvMonday(CV.today) ? '' : '<button type="button" class="dh-btn sm" data-week="now">This week</button>') + '</div>');
  }
  const reps = CV.role === 'sales' ? [] : cvReps(CV.plans);
  if (reps.length > 1) {
    out.push('<label class="cv-rep"><span class="cv-vh">Rep</span><select class="cv-in" data-rep aria-label="Rep"><option value="">Every rep</option>' +
      reps.map(u => '<option' + (u === CV.rep ? ' selected' : '') + '>' + _cvE(u) + '</option>').join('') + '</select></label>');
  }
  return out.join('');
}

function _cvMineRep(list) { return CV.rep ? list.filter(v => String(v.user || '').toLowerCase() === CV.rep.toLowerCase()) : list; }

function cvBodyHtml() {
  if (!CV.ok) return '<p class="cv-empty">Nothing to show yet.</p>';
  if (CV.seg === 'week') return cvWeekHtml();
  if (CV.role === 'sales') {
    const b = cvSalesBuckets(CV.plans, CV.today), list = b[CV.seg] || [];
    const empty = { needs: 'Nothing needs you. A visit sent back, a draft, or an approved visit to mark done shows here.',
                    upcoming: CV.book && cvClients(CV.book, CV.me).length ? 'No visits coming up. Press Plan a visit to add one.' : 'No visits coming up. Add a client to your Client Book, then plan a visit to it.',
                    past: 'No past visits yet.' }[CV.seg];
    return list.length ? cvByDay(list).map(g => cvDayHtml(g, false)).join('') : '<p class="cv-empty">' + _cvE(empty) + '</p>';
  }
  if (CV.seg === 'waiting') {
    const list = _cvMineRep(CV.plans.filter(v => v.status === 'Pending Director'));
    if (!list.length) return '<p class="cv-empty">No visits are waiting for you.</p>';
    return cvByRep(list).map(r => {
      const nos = r.days.reduce((a, d) => a.concat(d.items.map(v => v.visitPlanNo)), []), all = nos.every(no => CV.sel[no]);
      return '<section class="cv-rgroup" aria-label="' + _cvE(r.user) + '"><h2 class="cv-rhead"><span>' + _cvE(r.user) + '</span><span class="cv-rn">' + nos.length + ' waiting</span>' +
        '<button type="button" class="cv-link" data-pickall="' + _cvE(nos.join(',')) + '">' + (all ? 'Clear' : 'Select all') + '</button></h2>' +
        r.days.map(g => cvDayHtml(g, true)).join('') + '</section>';
    }).join('');
  }
  const list = _cvMineRep(CV.seg === 'approved' ? CV.plans.filter(v => v.status === 'Approved') : CV.plans);
  const sorted = CV.seg === 'approved' ? cvSortUp(list) : cvSort(list);
  return sorted.length ? cvByDay(sorted).map(g => cvDayHtml(g, false, true)).join('') : '<p class="cv-empty">' + (CV.seg === 'approved' ? 'No approved visits.' : 'No visits yet.') + '</p>';
}

/** One day: its date, then its visits. `pick` adds the director's checkboxes; `who` names the rep on each. */
function cvDayHtml(g, pick, who) {
  const tag = g.day === CV.today ? ' <span class="cv-today">Today</span>' : g.day === cvAddDays(CV.today, 1) ? ' <span class="cv-today soft">Tomorrow</span>' : '';
  return '<div class="cv-day"><h3 class="cv-dhead">' + _cvE(cvDayLabel(g.day, _cvYear())) + tag + '</h3><div class="cv-list" role="list">' +
    g.items.map(v => cvRowHtml(v, pick, who || (CV.role !== 'sales' && !pick))).join('') + '</div></div>';
}

/** One visit: the time and company with its status; where, and who. */
function cvRowHtml(v, pick, who) {
  const st = cvStatus(v), place = v.location === 'Other' ? cvTown(v.address) || 'Other' : v.location + (cvTown(v.address) ? ' · ' + cvTown(v.address) : '');
  const people = cvPeople(v);
  const box = pick ? '<label class="cv-pick"><input type="checkbox" data-pick="' + _cvE(v.visitPlanNo) + '"' + (CV.sel[v.visitPlanNo] ? ' checked' : '') + ' aria-label="Choose the visit to ' + _cvE(v.company) + '"></label>' : '';
  return '<div class="cv-item' + (v.status === 'Cancelled' ? ' off' : '') + '" role="listitem">' + box +
    '<button type="button" class="cv-row" data-open="' + _cvE(v.visitPlanNo) + '">' +
    '<span class="cv-r1"><span class="cv-time">' + _cvE(cvClock(v.time) || 'Any time') + '</span><span class="cv-co">' + _cvE(v.company) + '</span><span class="cv-badge ' + st.tone + '">' + _cvE(st.text) + '</span></span>' +
    '<span class="cv-r2">' + _cvE([place, people].filter(Boolean).join(' · ')) + '</span>' +
    (who ? '<span class="cv-r3">' + _cvE(v.user) + '</span>' : '') +
    (v.status === 'Rejected' && v.decisionNote ? '<span class="cv-r3 bad">Sent back: ' + _cvE(v.decisionNote) + '</span>' : '') +
    (CV.role === 'sales' && v.status === 'Approved' && v.date <= CV.today ? '<span class="cv-r3 act">Mark it done once you have been, with a line on how it went</span>' : '') + '</button></div>';
}

/** The travel week: one row per day per rep, the approved visits, and the day's estimated travel allowance. */
function cvWeekHtml() {
  const rows = cvWeekRows(CV.plans, CV.week, CV.rep), total = cvWeekTotal(rows);
  const note = '<p class="cv-note">How the estimated travel allowance is worked out is not decided yet, so each day says To be set. Visits cancelled after approval are struck through and not counted.</p>';
  if (!rows.length) return '<p class="cv-empty">No approved client visits in this week.</p>' + note;
  const body = rows.map(r => '<tr><th scope="row" class="cv-wday">' + _cvE(cvDayLabel(r.day, _cvYear())) + '</th><td class="cv-wrep">' + _cvE(r.user) + '</td><td class="cv-wvis"><ul>' +
    r.visits.map(v => '<li' + (v.status === 'Cancelled' ? ' class="off"' : '') + '><button type="button" class="cv-link" data-open="' + _cvE(v.visitPlanNo) + '">' + _cvE(v.company) + '</button>' +
      '<span class="cv-sub">' + _cvE([cvClock(v.time), cvTown(v.address)].filter(Boolean).join(' · ')) + (v.status === 'Cancelled' ? ' · cancelled' : v.status === 'Done' ? ' · done' : '') + '</span></li>').join('') +
    '</ul></td><td class="cv-west' + (r.estimate.set ? '' : ' unset') + '" data-label="Estimated travel allowance">' + _cvE(r.estimate.text) + '</td></tr>').join('');
  return '<div class="cv-tablewrap"><table class="cv-table"><caption class="cv-vh">Approved client visits, ' + _cvE(cvWeekLabel(CV.week)) + '</caption>' +
    '<thead><tr><th scope="col">Day</th><th scope="col">Rep</th><th scope="col">Approved visits</th><th scope="col" class="cv-west">Estimated travel allowance</th></tr></thead><tbody>' + body + '</tbody>' +
    '<tfoot><tr><th scope="row" colspan="3">Week total</th><td class="cv-west' + (total.set ? '' : ' unset') + '">' + _cvE(total.text) + '</td></tr></tfoot></table></div>' + note;
}

/** The director's bar for the visits chosen: approve them all, or send them back with one note. */
function cvBulkRender() {
  const bar = _cvId('cvBulk'), nos = Object.keys(CV.sel);
  if (!bar) return;
  bar.hidden = !(CV.role === 'director' && CV.seg === 'waiting' && nos.length);
  bar.innerHTML = bar.hidden ? '' : '<span class="cv-bn">' + nos.length + ' chosen</span><button type="button" class="dh-btn" data-bulk="clear">Clear</button>' +
    '<button type="button" class="dh-btn" data-bulk="reject">Send back…</button><button type="button" class="dh-btn primary" data-bulk="approve">Approve ' + nos.length + '</button>';
}

/* ── one visit ────────────────────────────────────────────────────────────────────────────────── */

function cvFind(no) { return CV.plans.filter(v => v.visitPlanNo === no)[0] || null; }

/** A visit in full, with what this person may do to it. */
function cvDetail(no) {
  const v = cvFind(no);
  if (!v) return;
  const st = cvStatus(v), can = cvCan(v, CV.me, CV.today);
  const fact = (k, val) => val ? '<div class="cv-fact"><dt>' + _cvE(k) + '</dt><dd>' + val + '</dd></div>' : '';
  const people = (v.contacts || []).map(c => _cvE(c.name) + (c.position ? ' <span class="cv-sub">' + _cvE(c.position) + '</span>' : '')).concat(v.someoneElse ? [_cvE(v.someoneElse) + ' <span class="cv-sub">someone else</span>'] : []);
  const btns = [];
  if (can.edit) btns.push('<button type="button" class="dh-btn" data-act="edit">Edit</button>');
  if (can.cancel) btns.push('<button type="button" class="dh-btn" data-act="cancel">Cancel visit…</button>');
  if (can.done) btns.push('<button type="button" class="dh-btn primary" data-act="done">Mark done…</button>');
  if (can.send) btns.push('<button type="button" class="dh-btn primary" data-act="send">Send to the director</button>');
  if (can.decide) btns.push('<button type="button" class="dh-btn" data-act="reject">Send back…</button>', '<button type="button" class="dh-btn primary" data-act="approve">Approve</button>');
  const hist = cvLogLines(CV.log, v.visitPlanNo);
  cvOpenDlg('<div class="cv-dtop"><h3 id="cvDlgTitle">' + _cvE(v.company) + '</h3><span class="cv-badge ' + st.tone + '">' + _cvE(st.text) + '</span></div>' +
    '<p class="cv-dmeta">' + _cvE([cvDayLabel(v.date, _cvYear()), cvClock(v.time) || 'any time', v.visitPlanNo, CV.role === 'sales' ? '' : v.user].filter(Boolean).join(' · ')) + '</p>' +
    (v.status === 'Rejected' && v.decisionNote ? '<div class="dh-banner bad">Sent back by ' + _cvE(v.decidedBy || 'the director') + ': ' + _cvE(v.decisionNote) + '</div>' : '') +
    '<dl class="cv-facts">' + fact('Where', _cvE(v.location) + '<span class="cv-sub">' + _cvE(v.address) + '</span>') + fact('Who', people.join('<br>')) + fact('Purpose', _cvE(v.purpose)) +
    fact('How it went', _cvE(v.result)) + fact('Cancelled', v.cancelReason ? _cvE(v.cancelReason) + ' <span class="cv-sub">' + _cvE(v.cancelledBy) + '</span>' : '') +
    (CV.role === 'accounting' || CV.role === 'management' || CV.role === 'director' ? fact('Estimated travel allowance', '<span class="cv-unset">' + _cvE(cvTravelEstimate([v]).text) + '</span>') : '') + '</dl>' +
    (hist.length ? '<h4 class="cv-h4">History</h4><ol class="cv-hist">' + hist.map(h => '<li><span>' + _cvE(h.text) + '</span><span class="cv-sub">' + _cvE([h.by, typeof flowDate === 'function' ? flowDate(h.at) : h.at.slice(0, 10)].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ol>' : '') +
    '<div class="cv-msg" id="cvMsg" role="alert"></div><div class="modal-actions"><button type="button" class="dh-btn" data-act="close">Close</button>' + btns.join('') + '</div>', { no: v.visitPlanNo });
}

/** A short form for a reason, a result or a note: cancel, done, or send back (one visit or the chosen ones). */
function cvAskDlg(kind, nos) {
  const t = { cancel: ['Cancel the visit', 'Why is it cancelled?', 'Cancel visit', 300], done: ['Mark the visit done', 'How did it go? One line.', 'Mark done', 300],
              reject: [nos.length > 1 ? 'Send back ' + nos.length + ' visits' : 'Send the visit back', 'What should the rep change?', 'Send back', 500] }[kind];
  cvOpenDlg('<form class="cv-form" data-ask="' + kind + '" data-nos="' + _cvE(nos.join(',')) + '"><h3 id="cvDlgTitle">' + _cvE(t[0]) + '</h3>' +
    '<label class="cv-fl">' + _cvE(t[1]) + '<textarea class="cv-in" name="text" rows="3" maxlength="' + t[3] + '" required></textarea></label>' +
    '<div class="cv-msg" id="cvMsg" role="alert"></div><div class="modal-actions"><button type="button" class="dh-btn" data-act="close">Back</button><button type="submit" class="dh-btn primary">' + _cvE(t[2]) + '</button></div></form>');
}

/* ── planning a visit ─────────────────────────────────────────────────────────────────────────── */

/** The plan form, empty or filled from a visit being changed. */
function cvPlanDlg(v) {
  const clients = cvClients(CV.book, CV.me);
  if (!clients.length) return;
  const cur = v ? v.clientNo : clients[0].clientNo;
  const opts = clients.map(c => '<option value="' + _cvE(c.clientNo) + '"' + (c.clientNo === cur ? ' selected' : '') + '>' + _cvE(c.company) + '</option>').join('');
  const known = v && !clients.some(c => c.clientNo === v.clientNo) ? '<option value="" selected>' + _cvE(v.company) + ' — no longer in your Client Book</option>' : '';
  cvOpenDlg('<form class="cv-form" id="cvPlan" data-no="' + _cvE(v ? v.visitPlanNo : '') + '"><h3 id="cvDlgTitle">' + (v ? 'Change the visit' : 'Plan a visit') + '</h3>' +
    (v && (v.status === 'Approved' || v.status === 'Pending Director') ? '<div class="dh-banner warn">A change sends the visit back to the director' + (v.status === 'Approved' ? ', and it stops counting as approved until they approve it again.' : '.') + '</div>' : '') +
    '<label class="cv-fl">Client<select class="cv-in" name="client" required>' + known + opts + '</select></label>' +
    '<div class="cv-grid2"><label class="cv-fl">Day<input type="date" class="cv-in" name="date" required min="' + _cvE(CV.today) + '" max="' + _cvE(cvAddDays(CV.today, CV_AHEAD)) + '" value="' + _cvE(v ? v.date : cvAddDays(CV.today, 1)) + '"></label>' +
    '<label class="cv-fl"><span>Time <span class="cv-opt">optional</span></span><input type="time" class="cv-in" name="time" value="' + _cvE(v ? v.time : '') + '"></label></div>' +
    '<fieldset class="cv-fs"><legend>Where</legend><div id="cvWhere"></div></fieldset>' +
    '<fieldset class="cv-fs"><legend>Who to visit</legend><div id="cvWho"></div>' +
    '<label class="cv-fl"><span>Someone else <span class="cv-opt">name and position</span></span><input type="text" class="cv-in" name="someoneElse" maxlength="120" value="' + _cvE(v ? v.someoneElse : '') + '"></label></fieldset>' +
    '<label class="cv-fl"><span>Purpose <span class="cv-opt">optional</span></span><textarea class="cv-in" name="purpose" rows="2" maxlength="500">' + _cvE(v ? v.purpose : '') + '</textarea></label>' +
    '<div class="cv-msg" id="cvMsg" role="alert"></div><div class="modal-actions"><button type="button" class="dh-btn" data-act="close">Cancel</button>' +
    (v && v.status !== 'Draft' && v.status !== 'Rejected' ? '<button type="submit" class="dh-btn primary" data-send="1">Save and send to the director</button>'
      : '<button type="submit" class="dh-btn" data-send="0">Save as draft</button><button type="submit" class="dh-btn primary" data-send="1">Send to the director</button>') + '</div></form>');
  cvPlanFill(v);
}

/** Where and who for the chosen client: the places it can be visited at, and its people. */
function cvPlanFill(v) {
  const form = _cvId('cvPlan');
  if (!form) return;
  const client = cvClients(CV.book, CV.me).filter(c => c.clientNo === form.elements.client.value)[0];
  const places = cvPlaces(client), keep = v && client && v.clientNo === client.clientNo;
  const pick = keep && places.some(p => p.loc === v.location && p.ok) ? v.location : cvDefaultPlace(client);
  _cvId('cvWhere').innerHTML = !client ? '<p class="cv-sub">Choose a client first.</p>' : places.map(p => '<label class="cv-place' + (p.ok ? '' : ' off') + '">' +
    '<input type="radio" name="location" value="' + p.loc + '"' + (p.loc === pick ? ' checked' : '') + (p.ok ? '' : ' disabled') + '>' +
    '<span class="cv-pl">' + _cvE(p.loc) + '</span><span class="cv-sub">' + _cvE(p.loc === 'Other' ? 'Type the address below' : p.ok ? p.addr : p.why) + '</span></label>').join('') +
    '<label class="cv-fl cv-other"' + (pick === 'Other' ? '' : ' hidden') + '>Address<textarea class="cv-in" name="address" rows="2" maxlength="300">' + _cvE(keep && v.location === 'Other' ? v.address : '') + '</textarea></label>';
  const chosen = {};
  if (keep) (v.contacts || []).forEach(c => { chosen[c.id] = true; });
  const people = (client && client.contacts) || [];
  _cvId('cvWho').innerHTML = !client ? '' : people.length ? '<div class="cv-people">' + people.map(c => '<label class="cv-person"><input type="checkbox" name="who" value="' + _cvE(c.id) + '"' + (chosen[c.id] ? ' checked' : '') + '>' +
    '<span>' + _cvE(c.name || 'No name') + (c.position ? ' <span class="cv-sub">' + _cvE(c.position) + '</span>' : '') + '</span></label>').join('') + '</div>'
    : '<p class="cv-sub">No contact people are saved for this client yet. Type who you will visit under Someone else, or add them in the Client Book.</p>';
}

/** Read the plan form, then save it (and send it, when asked). */
async function cvPlanSubmit(form, send) {
  const el = form.elements, client = cvClients(CV.book, CV.me).filter(c => c.clientNo === el.client.value)[0];
  const loc = form.querySelector('input[name="location"]:checked');
  const ids = Array.prototype.map.call(form.querySelectorAll('input[name="who"]:checked'), x => x.value);
  const r = cvPlanParams({ visitPlanNo: form.getAttribute('data-no'), date: el.date.value, time: el.time.value, location: loc ? loc.value : '',
                           address: el.address ? el.address.value : '', contactIds: ids, someoneElse: el.someoneElse.value, purpose: el.purpose.value }, client, CV.today);
  if (r.error) return cvMsg(r.error);
  if (send) r.params.send = true;
  await cvDo('saveVisitPlan', r.params, send ? 'Sent to the director.' : 'Saved as a draft.');
}

/* ── doing things ─────────────────────────────────────────────────────────────────────────────── */

/** Post one action; on success close the dialog, say so, and read the visits again. */
async function cvDo(action, params, said) {
  if (CV.busy) return null;
  CV.busy = true;
  cvMsg('Saving…', 'wait');
  const r = await postFlow(action, params).catch(e => ({ success: false, message: String((e && e.message) || e) }));
  CV.busy = false;
  if (!r || !r.success) { cvMsg((r && r.message) || 'That did not go through. Try again.'); return r; }
  cvCloseDlg();
  CV.flash = { ok: true, text: said || r.message || 'Saved.' };
  if (action === 'decideVisitPlans') CV.sel = {};
  await cvLoad();
  const land = r.visitPlanNo || params.visitPlanNo || (params.visitPlanNos ? JSON.parse(params.visitPlanNos)[0] : '');
  if (CV.role === 'sales' && land) {   // the rep sees the visit where it now is
    const b = cvSalesBuckets(CV.plans, CV.today), seg = ['needs', 'upcoming', 'past'].filter(k => b[k].some(v => v.visitPlanNo === land))[0];
    if (seg && seg !== CV.seg) { CV.seg = seg; cvRender(); }
  }
  return r;
}

function cvMsg(text, tone) { const m = _cvId('cvMsg'); if (m) { m.textContent = text || ''; m.className = 'cv-msg' + (tone ? ' ' + tone : text ? ' bad' : ''); } }

function cvOpenDlg(html, data) {
  const dlg = _cvId('cvDlg'), ov = _cvId('cvOverlay');
  dlg.innerHTML = html;
  dlg.setAttribute('data-no', (data && data.no) || '');
  ov.classList.add('open');
  const first = dlg.querySelector && dlg.querySelector('textarea, select, input:not([type="radio"]):not([type="checkbox"]), [data-act="close"]');
  if (first && first.focus) first.focus();
}
function cvCloseDlg() { const ov = _cvId('cvOverlay'); if (ov) ov.classList.remove('open'); const d = _cvId('cvDlg'); if (d) d.innerHTML = ''; }

function _cvWire() {
  _cvId('cvSeg').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-seg]');
    if (!b) return;
    CV.seg = b.getAttribute('data-seg'); CV.flash = null;
    cvRender();
  });
  _cvId('cvTools').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-week]');
    if (!b) return;
    const w = b.getAttribute('data-week');
    CV.week = w === 'now' ? cvMonday(CV.today) : cvAddDays(CV.week, Number(w));
    cvRender();
  });
  _cvId('cvTools').addEventListener('change', (ev) => { if (ev.target.hasAttribute('data-rep')) { CV.rep = ev.target.value; cvRender(); } });
  _cvId('cvActions').addEventListener('click', (ev) => { if (ev.target.closest('[data-plan]')) cvPlanDlg(null); });
  _cvId('cvBody').addEventListener('click', (ev) => {
    const all = ev.target.closest('[data-pickall]');
    if (all) {
      const nos = all.getAttribute('data-pickall').split(','), on = !nos.every(no => CV.sel[no]);
      nos.forEach(no => { if (on) CV.sel[no] = true; else delete CV.sel[no]; });
      return cvRender();
    }
    const o = ev.target.closest('[data-open]');
    if (o) cvDetail(o.getAttribute('data-open'));
  });
  _cvId('cvBody').addEventListener('change', (ev) => {
    const no = ev.target.getAttribute && ev.target.getAttribute('data-pick');
    if (!no) return;
    if (ev.target.checked) CV.sel[no] = true; else delete CV.sel[no];
    cvBulkRender();
  });
  _cvId('cvBulk').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-bulk]');
    if (!b) return;
    const k = b.getAttribute('data-bulk'), nos = Object.keys(CV.sel);
    if (k === 'clear') { CV.sel = {}; return cvRender(); }
    if (k === 'reject') return cvAskDlg('reject', nos);
    cvOpenDlg('<h3 id="cvDlgTitle">Approve ' + nos.length + ' visit' + (nos.length === 1 ? '' : 's') + '?</h3><p class="cv-sub">They count for the travel allowance once approved.</p>' +
      '<div class="cv-msg" id="cvMsg" role="alert"></div><div class="modal-actions"><button type="button" class="dh-btn" data-act="close">Back</button><button type="button" class="dh-btn primary" data-act="approveall">Approve</button></div>');
  });
  const ov = _cvId('cvOverlay'), dlg = _cvId('cvDlg');
  ov.addEventListener('click', (ev) => { if (ev.target === ov) cvCloseDlg(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) cvCloseDlg(); });
  dlg.addEventListener('click', (ev) => {
    const sb = ev.target.closest('button[type="submit"]');
    if (sb) CV.send = sb.getAttribute('data-send') || '1';   // which button sent the form, where the browser has no event.submitter
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.getAttribute('data-act'), no = dlg.getAttribute('data-no'), v = cvFind(no);
    if (act === 'close') return cvCloseDlg();
    if (act === 'edit' && v) return cvPlanDlg(v);
    if (act === 'send' && v) return cvDo('submitVisitPlans', { visitPlanNos: JSON.stringify([no]) }, 'Sent to the director.');
    if (act === 'approve' && v) return cvDo('decideVisitPlans', { visitPlanNos: JSON.stringify([no]), decision: 'approve' }, 'Approved.');
    if (act === 'approveall') { const nos = Object.keys(CV.sel); return cvDo('decideVisitPlans', { visitPlanNos: JSON.stringify(nos), decision: 'approve' }, nos.length + ' approved.'); }
    if ((act === 'cancel' || act === 'done' || act === 'reject') && v) return cvAskDlg(act, [no]);
  });
  dlg.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.name === 'client') return cvPlanFill(null);
    if (t.name === 'location') { const o = dlg.querySelector('.cv-other'); if (o) o.hidden = t.value !== 'Other'; }
  });
  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target, sub = ev.submitter;
    if (form.id === 'cvPlan') return cvPlanSubmit(form, (sub ? sub.getAttribute('data-send') : CV.send) !== '0');
    const kind = form.getAttribute('data-ask'), nos = String(form.getAttribute('data-nos') || '').split(',').filter(Boolean), text = form.elements.text.value.trim();
    if (!text) return cvMsg('Say a word first.');
    if (kind === 'cancel') return cvDo('cancelVisitPlan', { visitPlanNo: nos[0], reason: text }, 'Visit cancelled.');
    if (kind === 'done') return cvDo('markVisitPlanDone', { visitPlanNo: nos[0], result: text }, 'Marked done.');
    if (kind === 'reject') return cvDo('decideVisitPlans', { visitPlanNos: JSON.stringify(nos), decision: 'reject', note: text }, nos.length > 1 ? nos.length + ' sent back.' : 'Sent back.');
  });
}
