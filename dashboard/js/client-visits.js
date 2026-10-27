/* client-visits.js — A369 · client visits, the new itinerary (client-visits.html).
 *
 * Neil, 25 Oct 2026: "create a new client visit page for each sales, they can select their clients and who to visit in
 * their client book"; the director approves first. One page, a view per role:
 *   sales       their own visits — Needs you · Coming up · Past — and Plan a visit (a client from their Client Book, the
 *               day, where: plant / head office / other, who: the client's people or someone else, the purpose)
 *   director    Waiting (grouped by rep, then day; approve or send back one or many) · Approved · All · the week
 *   accounting  the week of approved visits
 *   management  the week and every visit, read only
 * A370 — Neil, 25 Oct 2026: "the new plan a visit can add multiple companies to visit in a day": the form takes a day and
 * up to 10 companies, saved all or none (FlowAPI 187; before it, one company at a time as in A369).
 * The week view is js/client-visits-week.js, loaded only for the director, accounting and management (never a rep).
 * The server (FlowAPI 186) checks every action again; this page only offers what it would allow. The weekly itinerary
 * keeps working beside it. The model is js/client-visits-model.js. */
const CV = { me: null, role: '', today: '', plans: [], log: [], book: null, ok: true, seg: '', rep: '', week: '', sel: {}, busy: false, seq: 0, flash: null, send: '1', v187: false, stopN: 0 };

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
  if (CV.role !== 'sales') await cvLoadWeek();
  _cvId('cvLede').textContent = Object.assign({
    sales: 'Plan visits to your Client Book clients. Each goes to the director to approve.',
    director: 'Visits the reps plan to their clients. Approve them, or send them back with a note.'
  }, typeof CV_WEEK !== 'undefined' ? CV_WEEK.lede : {})[CV.role] || '';
  const ready = typeof flowVersionAtLeast === 'function' ? await flowVersionAtLeast(186).catch(() => false) : false;
  if (!ready) {
    _cvId('cvNotice').innerHTML = '<div class="dh-banner warn">Client visits open here with the next FlowAPI update (version 186). The weekly itinerary works as before meanwhile.</div>';
    _cvId('cvBar').hidden = true;
    _cvId('cvBody').hidden = true;
    return;
  }
  CV.v187 = await flowVersionAtLeast(187).catch(() => false);   // A370 — several companies in one day
  _cvWire();
  await cvLoad();
  const ask = typeof URLSearchParams === 'function' ? new URLSearchParams(location.search).get('visit') : null;
  if (ask && CV.plans.some(v => v.visitPlanNo === ask)) cvDetail(ask);
  if (typeof hxDeepLink === 'function') hxDeepLink(() => { if (document.querySelector('#cvActions [data-plan]')) cvPlanDlg(null); });   // A378 — the + button, where the page offers planning
});

/* ── the reads ────────────────────────────────────────────────────────────────────────────────── */

/** The week view (js/client-visits-week.js), for every role but sales. Resolves either way: without it the page still
 *  works and says the week could not be opened. */
function cvLoadWeek() {
  if (typeof cvWeekHtml === 'function') return Promise.resolve(true);
  return new Promise(done => {
    const sc = document.createElement('script');
    sc.src = 'js/client-visits-week.js';
    sc.onload = () => done(true);
    sc.onerror = () => done(false);
    (document.head || document.body).appendChild(sc);
  });
}

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
  const week = typeof CV_WEEK !== 'undefined' ? [CV_WEEK.seg] : [];
  if (CV.role === 'director') {
    return [{ key: 'waiting', label: 'Waiting', n: p.filter(v => v.status === 'Pending Director').length }, { key: 'approved', label: 'Approved', n: p.filter(v => v.status === 'Approved').length },
            { key: 'all', label: 'All', n: p.length }].concat(week);
  }
  if (CV.role === 'management') return week.concat([{ key: 'all', label: 'All visits', n: p.length }]);
  return week;
}

/** Over the list: the rep filter (when there is more than one rep), and the week view's own stepper. */
function cvToolsHtml() {
  const out = [];
  if (CV.seg === 'week' && typeof cvWeekToolsHtml === 'function') out.push(cvWeekToolsHtml());
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
  if (CV.seg === 'week') return typeof cvWeekHtml === 'function' ? cvWeekHtml() : '<p class="cv-empty">This view could not be opened. Reload the page.</p>';
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

/** One day: its date, then its visits. `pick` adds the director's checkboxes (and, A370, a way to choose the whole day);
 *  `who` names the rep on each. A rep can add a company to a day still to come. */
function cvDayHtml(g, pick, who) {
  const tag = g.day === CV.today ? ' <span class="cv-today">Today</span>' : g.day === cvAddDays(CV.today, 1) ? ' <span class="cv-today soft">Tomorrow</span>' : '';
  const nos = g.items.map(v => v.visitPlanNo);
  const act = pick && nos.length > 1 ? '<button type="button" class="cv-link cv-dact" data-pickall="' + _cvE(nos.join(',')) + '">' + (nos.every(no => CV.sel[no]) ? 'Clear the day' : 'Choose the day') + '</button>'
    : CV.role === 'sales' && CV.seg !== 'past' && g.day >= CV.today && cvClients(CV.book, CV.me).length ? '<button type="button" class="cv-link cv-dact" data-addday="' + _cvE(g.day) + '">Add a company to this day</button>' : '';
  return '<div class="cv-day"><h3 class="cv-dhead">' + _cvE(cvDayLabel(g.day, _cvYear())) + tag + act + '</h3><div class="cv-list" role="list">' +
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
    fact('Same day', cvSameDay(v).map(x => '<button type="button" class="cv-link" data-open="' + _cvE(x.visitPlanNo) + '">' + _cvE(x.company) + '</button> <span class="cv-sub cv-in-line">' + _cvE([cvClock(x.time), cvStatus(x).text].filter(Boolean).join(' · ')) + '</span>').join('<br>')) +
    fact('How it went', _cvE(v.result)) + fact('Cancelled', v.cancelReason ? _cvE(v.cancelReason) + ' <span class="cv-sub">' + _cvE(v.cancelledBy) + '</span>' : '') +
    (CV.role !== 'sales' && typeof cvWeekFact === 'function' ? cvWeekFact(v, fact) : '') + '</dl>' +
    (hist.length ? '<h4 class="cv-h4">History</h4><ol class="cv-hist">' + hist.map(h => '<li><span>' + _cvE(h.text) + '</span><span class="cv-sub">' + _cvE([h.by, typeof flowDate === 'function' ? flowDate(h.at) : h.at.slice(0, 10)].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ol>' : '') +
    '<div class="cv-msg" id="cvMsg" role="alert"></div><div class="modal-actions"><button type="button" class="dh-btn" data-act="close">Close</button>' + btns.join('') + '</div>', { no: v.visitPlanNo });
}

/** A370 — the rep's other visits that day (not cancelled), in time order: the rest of the day's itinerary. */
function cvSameDay(v) {
  return cvSortUp(CV.plans.filter(x => x.visitPlanNo !== v.visitPlanNo && x.date === v.date && x.status !== 'Cancelled' && String(x.user || '').toLowerCase() === String(v.user || '').toLowerCase()));
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

/** The plan form: a day and the companies to visit that day (A370: several in one go from FlowAPI 187), or one visit
 *  being changed. `day` fills the day, for "Add a company to this day" on the list. */
function cvPlanDlg(v, day) {
  const clients = cvClients(CV.book, CV.me);
  if (!clients.length) return;
  const many = !v && CV.v187;
  cvOpenDlg('<form class="cv-form" id="cvPlan" data-no="' + _cvE(v ? v.visitPlanNo : '') + '"><h3 id="cvDlgTitle">' + (v ? 'Change the visit' : many ? 'Plan a day of visits' : 'Plan a visit') + '</h3>' +
    (v && (v.status === 'Approved' || v.status === 'Pending Director') ? '<div class="dh-banner warn">A change sends the visit back to the director' + (v.status === 'Approved' ? ', and it stops counting as approved until they approve it again.' : '.') + '</div>' : '') +
    '<label class="cv-fl cv-dayf">Day<input type="date" class="cv-in" name="date" required min="' + _cvE(CV.today) + '" max="' + _cvE(cvAddDays(CV.today, CV_AHEAD)) + '" value="' + _cvE(v ? v.date : day || cvAddDays(CV.today, 1)) + '"></label>' +
    '<div class="cv-stops one" id="cvStops">' + cvStopHtml(v, clients, v ? v.clientNo : clients[0].clientNo) + '</div>' +
    (many ? '<button type="button" class="dh-btn cv-addstop" data-act="addstop">Add another company</button>' : '') +
    '<div class="cv-msg" id="cvMsg" role="alert"></div><div class="modal-actions"><button type="button" class="dh-btn" data-act="close">Cancel</button>' +
    (v && v.status !== 'Draft' && v.status !== 'Rejected' ? '<button type="submit" class="dh-btn primary" data-send="1">Save and send to the director</button>'
      : '<button type="submit" class="dh-btn" data-send="0">Save as draft</button><button type="submit" class="dh-btn primary" data-send="1">Send to the director</button>') + '</div></form>');
  const first = _cvId('cvStops') && _cvId('cvStops').querySelector ? _cvId('cvStops').querySelector('.cv-stop') : null;
  cvPlanFill(first, v);
}

/** One company of the plan: its client, the time, where, who and the purpose. Each block's radio buttons are named
 *  for it alone, so several blocks sit in one form. */
function cvStopHtml(v, clients, cur) {
  const k = ++CV.stopN;
  const opts = clients.map(c => '<option value="' + _cvE(c.clientNo) + '"' + (c.clientNo === cur ? ' selected' : '') + '>' + _cvE(c.company) + '</option>').join('');
  const known = v && !clients.some(c => c.clientNo === v.clientNo) ? '<option value="" selected>' + _cvE(v.company) + ' — no longer in your Client Book</option>' : '';
  return '<fieldset class="cv-stop" data-stop="' + k + '"><legend><span class="cv-stopn">Visit 1</span><button type="button" class="cv-link cv-rmstop" data-act="rmstop">Remove</button></legend><p class="cv-stoperr" role="alert"></p>' +
    '<div class="cv-grid2"><label class="cv-fl">Client<select class="cv-in" name="client" required>' + known + opts + '</select></label>' +
    '<label class="cv-fl"><span>Time <span class="cv-opt">optional</span></span><input type="time" class="cv-in" name="time" value="' + _cvE(v ? v.time : '') + '"></label></div>' +
    '<fieldset class="cv-fs"><legend>Where</legend><div class="cv-where"></div></fieldset>' +
    '<fieldset class="cv-fs"><legend>Who to visit</legend><div class="cv-who"></div>' +
    '<label class="cv-fl"><span>Someone else <span class="cv-opt">name and position</span></span><input type="text" class="cv-in" name="someoneElse" maxlength="120" value="' + _cvE(v ? v.someoneElse : '') + '"></label></fieldset>' +
    '<label class="cv-fl"><span>Purpose <span class="cv-opt">optional</span></span><textarea class="cv-in" name="purpose" rows="2" maxlength="500">' + _cvE(v ? v.purpose : '') + '</textarea></label></fieldset>';
}

/** Another company for the day: the first client not already in the form, its block filled, the numbers redone. */
function cvAddStop() {
  const box = _cvId('cvStops');
  if (!box) return;
  const blocks = box.querySelectorAll('.cv-stop');
  if (blocks.length >= CV_DAY_MAX) return cvMsg('Plan up to ' + CV_DAY_MAX + ' companies in one day.');
  const clients = cvClients(CV.book, CV.me), used = {};
  Array.prototype.forEach.call(blocks, b => { const sel = b.querySelector('select[name="client"]'); if (sel) used[sel.value] = true; });
  const next = (clients.filter(c => !used[c.clientNo])[0] || clients[0]).clientNo;
  box.insertAdjacentHTML('beforeend', cvStopHtml(null, clients, next));
  const all = box.querySelectorAll('.cv-stop'), added = all[all.length - 1];
  cvPlanFill(added, null);
  cvRenumber();
  cvMsg('');
  const sel = added && added.querySelector('select[name="client"]');
  if (sel && sel.focus) sel.focus();
  if (added && added.scrollIntoView) added.scrollIntoView({ block: 'nearest' });
}
/** "Visit 1", "Visit 2", … and the Remove links only while there is more than one. */
function cvRenumber() {
  const box = _cvId('cvStops');
  if (!box) return;
  const blocks = box.querySelectorAll('.cv-stop');
  Array.prototype.forEach.call(blocks, (b, i) => { const n = b.querySelector('.cv-stopn'), e = b.querySelector('.cv-stoperr'); if (n) n.textContent = 'Visit ' + (i + 1); if (e) e.textContent = ''; b.classList.remove('bad'); });
  box.classList.toggle('one', blocks.length < 2);
}

/** Where and who for a block's client: the places it can be visited at, and its people. */
function cvPlanFill(stop, v) {
  if (!stop) return;
  const sel = stop.querySelector('select[name="client"]'), k = stop.getAttribute('data-stop');
  const client = cvClients(CV.book, CV.me).filter(c => c.clientNo === (sel && sel.value))[0];
  const places = cvPlaces(client), keep = v && client && v.clientNo === client.clientNo;
  const pick = keep && places.some(p => p.loc === v.location && p.ok) ? v.location : cvDefaultPlace(client);
  stop.querySelector('.cv-where').innerHTML = !client ? '<p class="cv-sub">Choose a client first.</p>' : places.map(p => '<label class="cv-place' + (p.ok ? '' : ' off') + '">' +
    '<input type="radio" name="location-' + k + '" value="' + p.loc + '"' + (p.loc === pick ? ' checked' : '') + (p.ok ? '' : ' disabled') + '>' +
    '<span class="cv-pl">' + _cvE(p.loc) + '</span><span class="cv-sub">' + _cvE(p.loc === 'Other' ? 'Type the address below' : p.ok ? p.addr : p.why) + '</span></label>').join('') +
    '<label class="cv-fl cv-other"' + (pick === 'Other' ? '' : ' hidden') + '>Address<textarea class="cv-in" name="address" rows="2" maxlength="300">' + _cvE(keep && v.location === 'Other' ? v.address : '') + '</textarea></label>';
  const chosen = {};
  if (keep) (v.contacts || []).forEach(c => { chosen[c.id] = true; });
  const people = (client && client.contacts) || [];
  stop.querySelector('.cv-who').innerHTML = !client ? '' : people.length ? '<div class="cv-people">' + people.map(c => '<label class="cv-person"><input type="checkbox" name="who" value="' + _cvE(c.id) + '"' + (chosen[c.id] ? ' checked' : '') + '>' +
    '<span>' + _cvE(c.name || 'No name') + (c.position ? ' <span class="cv-sub">' + _cvE(c.position) + '</span>' : '') + '</span></label>').join('') + '</div>'
    : '<p class="cv-sub">No contact people are saved for this client yet. Type who you will visit under Someone else, or add them in the Client Book.</p>';
}

/** One block of the form, as values. */
function cvReadStop(b) {
  const val = (sel) => { const x = b.querySelector(sel); return x ? x.value : ''; };
  const loc = b.querySelector('input[type="radio"]:checked');
  return { clientNo: val('select[name="client"]'), time: val('input[name="time"]'), location: loc ? loc.value : '', address: val('textarea[name="address"]'),
           contactIds: Array.prototype.map.call(b.querySelectorAll('input[name="who"]:checked'), x => x.value), someoneElse: val('input[name="someoneElse"]'), purpose: val('textarea[name="purpose"]') };
}

/** Read the plan form, then save it (and send it, when asked): one visit, or the day's companies all at once. */
async function cvPlanSubmit(form, send) {
  const blocks = Array.prototype.slice.call(form.querySelectorAll('.cv-stop')), stops = blocks.map(cvReadStop), no = form.getAttribute('data-no');
  const byNo = {};
  cvClients(CV.book, CV.me).forEach(c => { byNo[c.clientNo] = c; });
  const date = form.elements.date.value, err = (b) => b.querySelector('.cv-stoperr');
  const mark = (n, text) => { const b = blocks[n - 1]; if (!b) return; b.classList.add('bad'); if (err(b)) err(b).textContent = text; if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); };
  blocks.forEach(b => { b.classList.remove('bad'); if (err(b)) err(b).textContent = ''; });
  if (no || !CV.v187) {   // a change to one visit, or a new one before FlowAPI 187
    const r = cvPlanParams(Object.assign({}, stops[0], { visitPlanNo: no, date }), byNo[stops[0].clientNo], CV.today, CV.plans);
    if (r.error) return cvMsg(r.error);
    if (send) r.params.send = true;
    return cvDo('saveVisitPlan', r.params, send ? 'Sent to the director.' : 'Saved as a draft.');
  }
  const r = cvDayParams(date, stops, byNo, CV.today, CV.plans);
  if (r.error) { if (r.stop) mark(r.stop, r.error); return cvMsg(r.error); }
  if (send) r.params.send = true;
  const n = stops.length;
  const res = await cvDo('saveVisitPlan', r.params, n === 1 ? (send ? 'Sent to the director.' : 'Saved as a draft.') : n + ' visits ' + (send ? 'sent to the director.' : 'saved as drafts.'));
  if (res && !res.success && res.stop) mark(res.stop, res.message);
  return res;
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
    const add = ev.target.closest('[data-addday]');
    if (add) return cvPlanDlg(null, add.getAttribute('data-addday'));
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
    cvOpenDlg('<h3 id="cvDlgTitle">Approve ' + nos.length + ' visit' + (nos.length === 1 ? '' : 's') + '?</h3><p class="cv-sub">Accounting sees them once they are approved.</p>' +
      '<div class="cv-msg" id="cvMsg" role="alert"></div><div class="modal-actions"><button type="button" class="dh-btn" data-act="close">Back</button><button type="button" class="dh-btn primary" data-act="approveall">Approve</button></div>');
  });
  const ov = _cvId('cvOverlay'), dlg = _cvId('cvDlg');
  ov.addEventListener('click', (ev) => { if (ev.target === ov) cvCloseDlg(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) cvCloseDlg(); });
  dlg.addEventListener('click', (ev) => {
    const sb = ev.target.closest('button[type="submit"]');
    if (sb) CV.send = sb.getAttribute('data-send') || '1';   // which button sent the form, where the browser has no event.submitter
    const o = ev.target.closest('[data-open]');
    if (o) return cvDetail(o.getAttribute('data-open'));
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.getAttribute('data-act'), no = dlg.getAttribute('data-no'), v = cvFind(no);
    if (act === 'close') return cvCloseDlg();
    if (act === 'addstop') return cvAddStop();
    if (act === 'rmstop') { const blk = b.closest('.cv-stop'); if (blk) blk.remove(); return cvRenumber(); }
    if (act === 'edit' && v) return cvPlanDlg(v);
    if (act === 'send' && v) return cvDo('submitVisitPlans', { visitPlanNos: JSON.stringify([no]) }, 'Sent to the director.');
    if (act === 'approve' && v) return cvDo('decideVisitPlans', { visitPlanNos: JSON.stringify([no]), decision: 'approve' }, 'Approved.');
    if (act === 'approveall') { const nos = Object.keys(CV.sel); return cvDo('decideVisitPlans', { visitPlanNos: JSON.stringify(nos), decision: 'approve' }, nos.length + ' approved.'); }
    if ((act === 'cancel' || act === 'done' || act === 'reject') && v) return cvAskDlg(act, [no]);
  });
  dlg.addEventListener('change', (ev) => {
    const t = ev.target;
    const blk = t.closest && t.closest('.cv-stop');
    if (t.name === 'client') { if (blk) { blk.classList.remove('bad'); const e = blk.querySelector('.cv-stoperr'); if (e) e.textContent = ''; } return cvPlanFill(blk, null); }
    if (/^location-/.test(t.name) && blk) { const o = blk.querySelector('.cv-other'); if (o) o.hidden = t.value !== 'Other'; }
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
