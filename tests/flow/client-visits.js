/* A369 — the Client visits page (client-visits.html: js/client-visits-model.js + js/client-visits.js + css/client-visits.css).
 *
 * Run:  node tests/flow/client-visits.js
 *
 * Neil, 25 Oct 2026: each rep plans visits to their own Client Book clients and picks who to visit; the director
 * approves first; accounting sees the approved visits with the day's estimated travel allowance, its formula "set aside
 * first … just put it there"; the weekly itinerary stays. On a small world worked out by hand (today Tuesday 27 Oct):
 *   1 · the model: days, words, the buckets, who may do what, the places, the form's checks, the estimate ("To be set")
 *   2 · the page per role: what it reads, what it shows, and the buttons it offers (the server checks them again)
 *   3 · what it posts
 *   4 · before FlowAPI 186
 *   5 · the guard, both navbars, the bell
 *   6 · the sheet: tokens only, scoped under body.dh; no hex, emoji or inline style anywhere
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');

const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

/* The model and the week view in one context, as the director's, accounting's and management's pages load them. */
const M = vm.createContext({ console, Math, JSON, Date });
['js/client-visits-model.js', 'js/client-visits-week.js'].forEach(f => vm.runInContext(fs.readFileSync(D + f, 'utf8'), M, { filename: f }));
const TODAY = '2026-10-27';
const G = 'Gerald Lucena', K = 'Kim Reyes';
const V = (no, o) => Object.assign({ visitPlanNo: no, date: '2026-10-28', time: '09:30', user: G, clientNo: 'CB-1', company: 'Philcement Corporation', location: 'Plant',
  address: 'Brgy. Bigte, Norzagaray, Bulacan', contacts: [{ id: 'P1', name: 'Ana Cruz', position: 'Purchasing' }], someoneElse: '', purpose: 'Hose audit',
  status: 'Approved', decision: 'Approved', decisionNote: '', travelEstimate: null, travelEstimateBasis: '' }, o);
const PLANS = [
  V('VP-1'),
  V('VP-2', { status: 'Pending Director', decision: '', date: '2026-10-29', time: '', company: 'Zeta Mining', clientNo: 'CB-2', location: 'Head office', address: '12F Tower, Ortigas, Pasig', contacts: [], someoneElse: 'The plant manager' }),
  V('VP-3', { status: 'Draft', decision: '', date: '2026-10-30' }),
  V('VP-4', { status: 'Rejected', decision: 'Rejected', decisionNote: 'Go on Thursday', date: '2026-10-29', company: 'Back Co' }),
  V('VP-5', { status: 'Cancelled', decision: 'Approved', date: '2026-10-28', time: '14:00', company: 'Off Co', cancelReason: 'Plant shutdown' }),
  V('VP-6', { user: K, status: 'Pending Director', decision: '', date: '2026-10-28', company: 'Kim Client Co', clientNo: 'CB-9' }),
  V('VP-7', { status: 'Done', date: '2026-10-26', result: 'Met Ana; RFQ next week' }),
  V('VP-8', { status: 'Approved', date: '2026-10-27', company: 'Today Co' }),
  V('VP-9', { user: K, status: 'Approved', date: '2026-11-04', company: 'Next Week Co' }),
  V('VP-10', { status: 'Cancelled', decision: '', date: '2026-10-28', company: 'Never Approved Co' })
];
const LOG = [
  { logNo: 'L1', visitPlanNo: 'VP-1', kind: 'created', from: '', to: 'Draft', note: '', by: G, at: '2026-10-25T01:00:00.000Z' },
  { logNo: 'L2', visitPlanNo: 'VP-1', kind: 'sent', from: 'Draft', to: 'Pending Director', note: '', by: G, at: '2026-10-25T02:00:00.000Z' },
  { logNo: 'L3', visitPlanNo: 'VP-1', kind: 'approved', from: 'Pending Director', to: 'Approved', note: '', by: 'Neil Estur', at: '2026-10-25T03:00:00.000Z' },
  { logNo: 'L4', visitPlanNo: 'VP-4', kind: 'sent back', from: 'Pending Director', to: 'Rejected', note: 'Go on Thursday', by: 'Neil Estur', at: '2026-10-26T03:00:00.000Z' }
];
const BOOK = { success: true, clients: [
  { clientNo: 'CB-1', company: 'Philcement Corporation', owner: G, siteAddress: 'Brgy. Bigte, Norzagaray, Bulacan', headOfficeAddress: '', archivedAt: '',
    contacts: [{ id: 'P1', name: 'Ana Cruz', position: 'Purchasing' }, { id: 'P2', name: 'Ben', position: '' }] },
  { clientNo: 'CB-2', company: 'Zeta Mining', owner: G, siteAddress: '', headOfficeAddress: '12F Tower, Ortigas, Pasig', archivedAt: '', contacts: [] },
  { clientNo: 'CB-3', company: 'Gone Co', owner: G, siteAddress: 'X', archivedAt: '2026-10-01T00:00:00.000Z', contacts: [] },
  { clientNo: 'CB-9', company: 'Kim Client Co', owner: K, siteAddress: 'Calaca, Batangas', archivedAt: '', contacts: [] }] };

/* ── 1 · the model ─────────────────────────────────────────────────────────────────────────── */
sec('1 · the model');
eq('the travel week starts on Monday', [M.cvMonday('2026-10-27'), M.cvMonday('2026-10-26'), M.cvMonday('2026-11-01')], ['2026-10-26', '2026-10-26', '2026-10-26']);
eq('days, weeks and times in words', [M.cvDayLabel('2026-10-27', '2026'), M.cvDayLabel('2027-01-04', '2026'), M.cvWeekLabel('2026-10-26'), M.cvClock('09:30'), M.cvClock('14:05'), M.cvClock('')],
   ['Tue 27 Oct', 'Mon 4 Jan 2027', '26 Oct – 1 Nov 2026', '9:30 AM', '2:05 PM', '']);
eq('the town, and who', [M.cvTown('Brgy. Bigte, Norzagaray, Bulacan'), M.cvPeople(PLANS[1]), M.cvPeople(PLANS[0])], ['Norzagaray, Bulacan', 'The plant manager', 'Ana Cruz']);
eq('the statuses in words', PLANS.slice(0, 7).map(v => M.cvStatus(v).text), ['Approved', 'With the director', 'Draft', 'Sent back', 'Cancelled', 'With the director', 'Done']);
eq('accounting sees approved, done, and cancelled after approval — never a draft, a pending one, or one cancelled before approval',
   PLANS.filter(M.cvForAccounting).map(v => v.visitPlanNo), ['VP-1', 'VP-5', 'VP-7', 'VP-8', 'VP-9']);
{
  const mine = PLANS.filter(v => v.user === G), b = M.cvSalesBuckets(mine, TODAY);
  eq('a rep\'s three lists: needs them (draft, sent back, approved and its day here), coming up, past',
     [b.needs.map(v => v.visitPlanNo), b.upcoming.map(v => v.visitPlanNo), b.past.map(v => v.visitPlanNo)],
     [['VP-8', 'VP-4', 'VP-3'], ['VP-1', 'VP-2'], ['VP-10', 'VP-5', 'VP-7']]);
}
{
  const me = { role: 'sales', name: G }, kim = { role: 'sales', name: K }, dir = { role: 'director', name: 'Neil Estur' }, acct = { role: 'accounting', name: 'Ana' };
  const c = (v, who) => { const x = M.cvCan(v, who, TODAY); return Object.keys(x).filter(k => x[k]).join(','); };
  eq('who may do what (the server checks again)', [c(PLANS[2], me), c(PLANS[3], me), c(PLANS[0], me), c(PLANS[7], me), c(PLANS[6], me), c(PLANS[1], dir), c(PLANS[0], dir), c(PLANS[0], kim), c(PLANS[0], acct), c(PLANS[4], me)],
     ['edit,send,cancel', 'edit,send,cancel', 'edit,cancel', 'edit,cancel,done', '', 'cancel,decide', 'cancel', '', '', '']);
}
eq('the places: the plant and the head office from the Client Book, or Other', M.cvPlaces(BOOK.clients[0]).map(p => [p.loc, p.ok, p.why]),
   [['Plant', true, ''], ['Head office', false, 'No head office address in the Client Book'], ['Other', true, '']]);
eq('  the first that can be chosen is picked', [M.cvDefaultPlace(BOOK.clients[0]), M.cvDefaultPlace(BOOK.clients[1]), M.cvDefaultPlace({})], ['Plant', 'Head office', 'Other']);
eq('a rep chooses from their own live clients, A to Z', M.cvClients(BOOK, { name: G }).map(c => c.clientNo), ['CB-1', 'CB-2']);
{
  const f = { date: '2026-10-29', time: '10:00', location: 'Plant', contactIds: ['P1', 'P2'], someoneElse: '', purpose: ' Audit ' };
  eq('the form sends what the server needs (the address only for Other)', M.cvPlanParams(f, BOOK.clients[0], TODAY),
     { params: { clientNo: 'CB-1', date: '2026-10-29', time: '10:00', location: 'Plant', contactIds: '["P1","P2"]', someoneElse: '', purpose: 'Audit' } });
  eq('  Other carries the typed address, and an edit its number', M.cvPlanParams(Object.assign({}, f, { location: 'Other', address: 'Warehouse 3', visitPlanNo: 'VP-3' }), BOOK.clients[0], TODAY).params,
     { clientNo: 'CB-1', date: '2026-10-29', time: '10:00', location: 'Other', contactIds: '["P1","P2"]', someoneElse: '', purpose: 'Audit', address: 'Warehouse 3', visitPlanNo: 'VP-3' });
  const err = (o, cl) => M.cvPlanParams(Object.assign({}, f, o), cl === undefined ? BOOK.clients[0] : cl, TODAY).error;
  eq('  and says what is missing first', [err({}, null), err({ date: '' }), err({ date: '2026-10-26' }), err({ date: '2027-01-28' }), err({ time: '9am' }), err({ location: 'Head office' }), err({ location: 'Other', address: ' ' }), err({ contactIds: [], someoneElse: '' })],
     ['Choose the client.', 'Choose the day of the visit.', 'The day has passed; choose today or a later day.', 'A visit can be planned up to 92 days ahead.', 'The time must be like 09:30.',
      'No head office address in the Client Book. Add it there, or choose Other and type the address.', 'Type the address of the visit.', 'Choose who you will visit, or type someone else.']);
  ok('  someone else alone is enough', !err({ contactIds: [], someoneElse: 'The guard' }));
}
eq('the estimate: To be set while there is no rule; a day with nothing live says so', [M.cvTravelEstimate([PLANS[0]]).text, M.cvTravelEstimate([PLANS[4]]).text, M.cvTravelEstimate([]).text], ['To be set', '—', '—']);
eq('  once the visits carry an estimate, the day is their sum; a cancelled visit never counts; one without keeps it To be set',
   [M.cvTravelEstimate([V('a', { travelEstimate: 1000 }), V('b', { travelEstimate: 250 }), V('c', { status: 'Cancelled', travelEstimate: 999 })]).text, M.cvTravelEstimate([V('a', { travelEstimate: 1000 }), V('b')]).text],
   ['₱1,250.00', 'To be set']);
{
  const rows = M.cvWeekRows(PLANS, '2026-10-26', '');
  eq('the travel week: a row per day per rep, the visits accounting sees, in time order', rows.map(r => [r.day, r.user, r.visits.map(v => v.visitPlanNo), r.estimate.text]),
     [['2026-10-26', G, ['VP-7'], 'To be set'], ['2026-10-27', G, ['VP-8'], 'To be set'], ['2026-10-28', G, ['VP-1', 'VP-5'], 'To be set']]);
  eq('  the week total, and one rep at a time', [M.cvWeekTotal(rows).text, M.cvWeekRows(PLANS, '2026-10-26', K).length, M.cvWeekRows(PLANS, '2026-11-02', K).map(r => r.visits[0].visitPlanNo)], ['To be set', 0, ['VP-9']]);
}
eq('grouped by rep, then day, for the director', M.cvByRep(PLANS.filter(v => v.status === 'Pending Director')).map(r => [r.user, r.days.map(d => d.day)]), [[G, ['2026-10-29']], [K, ['2026-10-28']]]);
eq('the history in words, oldest first', M.cvLogLines(LOG, 'VP-1').map(l => l.text), ['Planned', 'Sent to the director', 'Approved']);
eq('  a send-back keeps its note', M.cvLogLines(LOG, 'VP-4').map(l => l.text), ['Sent back: Go on Thursday']);

/* ── 2 · the page per role ─────────────────────────────────────────────────────────────────── */
async function boot(role, o) {
  o = o || {};
  const name = { sales: G, director: 'Neil Estur', accounting: 'Ana Acct', management: 'Mia Mgmt' }[role] || 'X';
  const p = page(role === 'sales' ? ['js/client-visits-model.js', 'js/client-visits.js'] : ['js/client-visits-model.js', 'js/client-visits-week.js', 'js/client-visits.js'], 'client-visits.html', { username: role, name, role });
  p.run('var __made = [], __ce = document.createElement; document.createElement = function (t) { __made.push(t); return __ce(t); };');
  p.ctx.__plans = o.plans || PLANS; p.ctx.__book = o.book || BOOK; p.ctx.__v = o.v || 186; p.ctx.__fail = o.fail || {};
  p.run(`requireClientVisitsAccess = function () { return __session; };
    flowToday = function () { return "${TODAY}"; };
    flowVersionAtLeast = function (n) { return Promise.resolve(n <= __v); };
    var __posts = [];
    postFlow = function (a, p) { __posts.push({ a: a, p: p });
      if (__fail[a]) return Promise.resolve({ success: false, message: __fail[a] });
      if (a === 'getVisitPlans') return Promise.resolve({ success: true, data: JSON.parse(JSON.stringify(__plans)), log: ${JSON.stringify(LOG)}, today: "${TODAY}" });
      if (a === 'getClientBook') return Promise.resolve(JSON.parse(JSON.stringify(__book)));
      return Promise.resolve({ success: true, message: 'ok' }); };`);
  await p.boot();
  for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r));
  p.posts = () => p.run('__posts.map(function (x) { return x.a; })');
  return p;
}
const opens = (h) => (h.match(/data-open="([^"]+)"/g) || []).map(x => x.slice(11, -1));

(async () => {
  sec('2 · the page per role');
  {
    const s = await boot('sales');
    eq('a rep: reads their visits and their Client Book, privately', s.posts().sort(), ['getClientBook', 'getVisitPlans']);
    ok('  and keeps only their own, whatever comes back', s.run('CV.plans.every(function (v) { return v.user === "Gerald Lucena"; })') && s.run('CV.plans.length') === 8);
    ok('  it opens on what needs them, with the three counts', s.run('CV.seg') === 'needs' && /data-seg="needs">Needs you <span class="n">3<\/span>/.test(s.els.cvSeg.innerHTML) &&
       /Coming up <span class="n">2<\/span>/.test(s.els.cvSeg.innerHTML) && /Past <span class="n">3<\/span>/.test(s.els.cvSeg.innerHTML), s.els.cvSeg.innerHTML);
    const b = s.els.cvBody.innerHTML;
    eq('  needs them: today\'s approved visit to mark done, the one sent back, the draft', opens(b), ['VP-8', 'VP-4', 'VP-3']);
    ok('  a day heads its visits, with Today', /<h3 class="cv-dhead">Tue 27 Oct <span class="cv-today">Today<\/span><\/h3>/.test(b), b.slice(0, 300));
    ok('  a row: the time, the company, the status; where and who; the director\'s note when sent back',
       /<span class="cv-time">9:30 AM<\/span><span class="cv-co">Back Co<\/span><span class="cv-badge bad">Sent back<\/span>/.test(b) && /<span class="cv-r2">Plant · Norzagaray, Bulacan · Ana Cruz<\/span>/.test(b) && /Sent back: Go on Thursday/.test(b), b);
    ok('  Plan a visit is on, beside the weekly itinerary; no checkboxes, no rep names', /data-plan>Plan a visit<\/button>/.test(s.els.cvActions.innerHTML) && /href="weekly-itinerary\.html"/.test(s.els.cvActions.innerHTML) && !/data-pick/.test(b) && !/cv-r3">Gerald/.test(b));
    s.run('CV.seg = "upcoming"; cvRender();');
    eq('  coming up, earliest first', opens(s.els.cvBody.innerHTML), ['VP-1', 'VP-2']);
    ok('  a visit with no time says any time; the head office shows its town', /<span class="cv-time">Any time<\/span><span class="cv-co">Zeta Mining<\/span><span class="cv-badge mid">With the director<\/span>/.test(s.els.cvBody.innerHTML) &&
       /Head office · Ortigas, Pasig · The plant manager/.test(s.els.cvBody.innerHTML));
    s.run('CV.seg = "past"; cvRender();');
    ok('  past: a cancelled visit is struck through', /<div class="cv-item off" role="listitem">/.test(s.els.cvBody.innerHTML) && opens(s.els.cvBody.innerHTML).join() === 'VP-10,VP-5,VP-7');
    s.run('cvDetail("VP-3")');
    const d = s.els.cvDlg.innerHTML;
    ok('a draft opens with Edit, Cancel and Send to the director', /data-act="edit">Edit/.test(d) && /data-act="cancel">Cancel visit…/.test(d) && /data-act="send">Send to the director/.test(d) && !/data-act="approve"/.test(d) && !/data-act="done"/.test(d), d);
    ok('  where, who, the purpose; no estimate for the rep', /<dt>Where<\/dt><dd>Plant<span class="cv-sub">Brgy\. Bigte, Norzagaray, Bulacan<\/span>/.test(d) && /<dt>Who<\/dt><dd>Ana Cruz <span class="cv-sub">Purchasing<\/span>/.test(d) && /Hose audit/.test(d) && !/Estimated travel allowance/.test(d));
    s.run('cvDetail("VP-8")');
    ok('  today\'s approved visit offers Mark done', /data-act="done">Mark done…/.test(s.els.cvDlg.innerHTML) && !/data-act="send"/.test(s.els.cvDlg.innerHTML));
    s.run('cvDetail("VP-1")');
    ok('  and an approved one carries its history', /<ol class="cv-hist"><li><span>Planned<\/span>/.test(s.els.cvDlg.innerHTML) && /Approved<\/span><span class="cv-sub">Neil Estur/.test(s.els.cvDlg.innerHTML));
    s.run('cvPlanDlg(null)');
    const f = s.els.cvDlg.innerHTML;
    ok('Plan a visit: my live clients only, the day from today to 92 days ahead, an optional time, where, who, the purpose, and two ways to save',
       /<option value="CB-1" selected>Philcement Corporation<\/option><option value="CB-2">Zeta Mining<\/option><\/select>/.test(f) && !/Gone Co|Kim Client/.test(f) &&
       /name="date" required min="2026-10-27" max="2027-01-27" value="2026-10-28"/.test(f) && /name="time" value=""/.test(f) && /<legend>Where<\/legend><div id="cvWhere">/.test(f) &&
       /<legend>Who to visit<\/legend>/.test(f) && /name="someoneElse"/.test(f) && /data-send="0">Save as draft/.test(f) && /data-send="1">Send to the director/.test(f), f);
    s.els.cvPlan = { elements: { client: { value: 'CB-1' } } }; s.els.cvWhere = { innerHTML: '' }; s.els.cvWho = { innerHTML: '' };
    s.run('cvPlanFill(null)');
    ok('  where: the plant with its address, the head office off with why, and Other', /<input type="radio" name="location" value="Plant" checked><span class="cv-pl">Plant<\/span><span class="cv-sub">Brgy\. Bigte, Norzagaray, Bulacan<\/span>/.test(s.els.cvWhere.innerHTML) &&
       /<label class="cv-place off"><input type="radio" name="location" value="Head office" disabled><span class="cv-pl">Head office<\/span><span class="cv-sub">No head office address in the Client Book<\/span>/.test(s.els.cvWhere.innerHTML) &&
       /value="Other"/.test(s.els.cvWhere.innerHTML) && /<label class="cv-fl cv-other" hidden>Address/.test(s.els.cvWhere.innerHTML), s.els.cvWhere.innerHTML);
    ok('  who: a box per contact person', /<input type="checkbox" name="who" value="P1"><span>Ana Cruz <span class="cv-sub">Purchasing<\/span>/.test(s.els.cvWho.innerHTML) && /value="P2"><span>Ben<\/span>/.test(s.els.cvWho.innerHTML));
    s.els.cvPlan.elements.client.value = 'CB-2';
    s.run('cvPlanFill(null)');
    ok('  a client with no people says to type someone else; only a head office: it is picked', /No contact people are saved for this client yet/.test(s.els.cvWho.innerHTML) && /value="Head office" checked/.test(s.els.cvWhere.innerHTML) && /value="Plant" disabled/.test(s.els.cvWhere.innerHTML));
    s.run('cvPlanDlg(CV.plans.filter(function (v) { return v.visitPlanNo === "VP-1"; })[0])');
    ok('changing an approved visit warns it goes back to the director, and saves only by sending', /A change sends the visit back to the director, and it stops counting as approved/.test(s.els.cvDlg.innerHTML) &&
       /data-send="1">Save and send to the director/.test(s.els.cvDlg.innerHTML) && !/Save as draft/.test(s.els.cvDlg.innerHTML));
    const none = await boot('sales', { book: { success: true, clients: [] }, plans: [] });
    ok('a rep with no clients: Plan a visit is off, and the empty list says how to start', /data-plan disabled title="Add a client to your Client Book first"/.test(none.els.cvActions.innerHTML) &&
       none.run('CV.seg = "upcoming"; cvRender(); document.getElementById("cvBody").innerHTML').indexOf('Add a client to your Client Book, then plan a visit to it.') >= 0);
    const nob = await boot('sales', { fail: { getClientBook: 'denied' } });
    ok('  the Client Book unreadable: it says so', /Your Client Book could not be read/.test(nob.els.cvNotice.innerHTML));
  }
  {
    const d = await boot('director');
    eq('the director: reads every visit, and no Client Book', d.posts(), ['getVisitPlans']);
    ok('  opens on Waiting, with Approved, All and the travel week', d.run('CV.seg') === 'waiting' && /Waiting <span class="n">2<\/span>/.test(d.els.cvSeg.innerHTML) && /Approved <span class="n">3<\/span>/.test(d.els.cvSeg.innerHTML) &&
       /All <span class="n">10<\/span>/.test(d.els.cvSeg.innerHTML) && /data-seg="week">Travel week<\/button>/.test(d.els.cvSeg.innerHTML));
    const w = d.els.cvBody.innerHTML;
    ok('  waiting: by rep, a box per visit, Select all per rep', /<h2 class="cv-rhead"><span>Gerald Lucena<\/span><span class="cv-rn">1 waiting<\/span><button type="button" class="cv-link" data-pickall="VP-2">Select all<\/button>/.test(w) &&
       /<h2 class="cv-rhead"><span>Kim Reyes<\/span>/.test(w) && /data-pick="VP-2"/.test(w) && /data-pick="VP-6"/.test(w) && w.indexOf('Gerald Lucena') < w.indexOf('Kim Reyes'), w);
    ok('  the rep filter lists the reps', /<option value="">Every rep<\/option><option>Gerald Lucena<\/option><option>Kim Reyes<\/option>/.test(d.els.cvTools.innerHTML));
    ok('  no bar until something is chosen', d.els.cvBulk.hidden === true);
    d.run('CV.sel = { "VP-2": true, "VP-6": true }; cvRender();');
    ok('  two chosen: Approve 2 and Send back…', d.els.cvBulk.hidden === false && /<span class="cv-bn">2 chosen<\/span>/.test(d.els.cvBulk.innerHTML) && /data-bulk="approve">Approve 2/.test(d.els.cvBulk.innerHTML) && /data-bulk="reject">Send back…/.test(d.els.cvBulk.innerHTML) &&
       /data-pick="VP-2" checked/.test(d.els.cvBody.innerHTML) && /data-pickall="VP-2">Clear/.test(d.els.cvBody.innerHTML));
    d.run('CV.rep = "Kim Reyes"; cvRender();');
    eq('  the filter narrows to one rep', opens(d.els.cvBody.innerHTML), ['VP-6']);
    d.run('CV.rep = ""; cvDetail("VP-2")');
    ok('  a waiting visit opens with Approve, Send back and Cancel, and the estimate To be set', /data-act="approve">Approve/.test(d.els.cvDlg.innerHTML) && /data-act="reject">Send back…/.test(d.els.cvDlg.innerHTML) &&
       /data-act="cancel"/.test(d.els.cvDlg.innerHTML) && !/data-act="edit"/.test(d.els.cvDlg.innerHTML) && /<dt>Estimated travel allowance<\/dt><dd><span class="cv-unset">To be set<\/span>/.test(d.els.cvDlg.innerHTML));
    d.run('cvAskDlg("reject", ["VP-2", "VP-6"])');
    ok('  sending back asks for a note (required)', /<h3 id="cvDlgTitle">Send back 2 visits<\/h3>/.test(d.els.cvDlg.innerHTML) && /What should the rep change\?<textarea class="cv-in" name="text" rows="3" maxlength="500" required>/.test(d.els.cvDlg.innerHTML));
    d.run('CV.seg = "approved"; cvRender();');
    ok('  approved: the rep named on each row', opens(d.els.cvBody.innerHTML).join() === 'VP-8,VP-1,VP-9' && /<span class="cv-r3">Kim Reyes<\/span>/.test(d.els.cvBody.innerHTML));
  }
  {
    const a = await boot('accounting');
    eq('accounting: reads only the visits, no Client Book', a.posts(), ['getVisitPlans']);
    ok('  one view, so no segments: the travel week, this week', a.run('CV.seg') === 'week' && a.els.cvSeg.hidden === true && /<span class="cv-wlabel">26 Oct – 1 Nov 2026<\/span>/.test(a.els.cvTools.innerHTML) && !/This week/.test(a.els.cvTools.innerHTML));
    const t = a.els.cvBody.innerHTML;
    ok('  the table: Day · Rep · Approved visits · Estimated travel allowance', /<th scope="col">Day<\/th><th scope="col">Rep<\/th><th scope="col">Approved visits<\/th><th scope="col" class="cv-west">Estimated travel allowance<\/th>/.test(t), t.slice(0, 400));
    eq('  a row per day per rep, the visits accounting may see', (t.match(/<th scope="row" class="cv-wday">[^<]+/g) || []).map(x => x.replace(/.*>/, '')), ['Mon 26 Oct', 'Tue 27 Oct', 'Wed 28 Oct']);
    ok('  each day To be set, and the week total too', (t.match(/<td class="cv-west unset" data-label="Estimated travel allowance">To be set<\/td>/g) || []).length === 3 && /<th scope="row" colspan="3">Week total<\/th><td class="cv-west unset">To be set<\/td>/.test(t));
    ok('  a visit cancelled after approval is struck through and said; one never approved is not there', /<li class="off"><button type="button" class="cv-link" data-open="VP-5">Off Co<\/button><span class="cv-sub">2:00 PM · Norzagaray, Bulacan · cancelled<\/span>/.test(t) &&
       !/Never Approved Co|Zeta Mining|Kim Client Co/.test(t));
    ok('  and the note: how it is worked out is not decided yet', /How the estimated travel allowance is worked out is not decided yet/.test(t));
    a.run('CV.week = "2026-11-02"; cvRender();');
    ok('  next week: Kim\'s approved visit, and This week to come back', /Next Week Co/.test(a.els.cvBody.innerHTML) && /data-week="now">This week/.test(a.els.cvTools.innerHTML));
    a.run('CV.week = "2026-11-09"; cvRender();');
    ok('  a week with none says so', /No approved client visits in this week\./.test(a.els.cvBody.innerHTML));
    a.run('cvDetail("VP-1")');
    ok('  a visit opens read only, with its estimate To be set', !/data-act="(edit|cancel|send|approve|reject|done)"/.test(a.els.cvDlg.innerHTML) && /data-act="close">Close/.test(a.els.cvDlg.innerHTML) && /To be set/.test(a.els.cvDlg.innerHTML));
    ok('  no Plan a visit', a.els.cvActions.innerHTML === '');
  }
  {
    const m = await boot('management');
    ok('management: the travel week and every visit', m.run('CV.seg') === 'week' && /data-seg="week">Travel week/.test(m.els.cvSeg.innerHTML) && /All visits <span class="n">10<\/span>/.test(m.els.cvSeg.innerHTML) && m.els.cvSeg.hidden === false);
    m.run('CV.seg = "all"; cvRender(); cvDetail("VP-2");');
    ok('  read only: no buttons on any visit, no boxes, no bar', opens(m.els.cvBody.innerHTML).length === 10 && !/data-pick/.test(m.els.cvBody.innerHTML) && !/data-act="(edit|cancel|send|approve|reject|done)"/.test(m.els.cvDlg.innerHTML) && m.els.cvBulk.hidden === true);
  }

  sec('3 · what it posts');
  {
    const d = await boot('director');
    d.run('CV.sel = { "VP-2": true, "VP-6": true };');
    await d.run('cvDo("decideVisitPlans", { visitPlanNos: JSON.stringify(Object.keys(CV.sel)), decision: "approve" }, "2 approved.")');
    const posted = d.run('__posts.filter(function (x) { return x.a === "decideVisitPlans"; })[0].p');
    eq('the director approves the chosen in one post', posted, { visitPlanNos: '["VP-2","VP-6"]', decision: 'approve' });
    ok('  then reads the visits again, says so, and clears the choice', d.posts().slice(-2).join() === 'decideVisitPlans,getVisitPlans' && /<div class="dh-banner ok" role="status">2 approved\.<\/div>/.test(d.els.cvNotice.innerHTML) && d.run('Object.keys(CV.sel).length') === 0);
    const f = await boot('director', { fail: { decideVisitPlans: 'Visit VP-2 is Approved, not waiting for you. Nothing was changed.' } });
    await f.run('cvDo("decideVisitPlans", { visitPlanNos: "[\\"VP-2\\"]", decision: "approve" }, "Approved.")');
    ok('  a refusal leaves the page as it was (no flash, no second read)', f.posts().join() === 'getVisitPlans,decideVisitPlans' && !/dh-banner ok/.test(f.els.cvNotice.innerHTML));
    const s = await boot('sales');
    const form = { getAttribute: () => '', elements: { client: { value: 'CB-1' }, date: { value: '2026-10-29' }, time: { value: '10:00' }, address: { value: '' }, someoneElse: { value: '' }, purpose: { value: 'Audit' } },
                   querySelector: () => ({ value: 'Plant' }), querySelectorAll: () => [{ value: 'P2' }] };
    s.ctx.__form = form;
    await s.run('cvPlanSubmit(__form, true)');
    eq('a rep\'s plan, sent to the director', s.run('__posts.filter(function (x) { return x.a === "saveVisitPlan"; })[0].p'),
       { clientNo: 'CB-1', date: '2026-10-29', time: '10:00', location: 'Plant', contactIds: '["P2"]', someoneElse: '', purpose: 'Audit', send: true });
    form.elements.date.value = '2026-10-20';
    const before = s.posts().length;
    await s.run('cvPlanSubmit(__form, false)');
    ok('  a past day is caught before anything is posted', s.posts().length === before);
    const SRC = fs.readFileSync(D + 'js/client-visits.js', 'utf8');
    const posts = Array.from(new Set((SRC.match(/(?:postFlow|cvDo)\('(\w+)'/g) || []).map(x => x.replace(/.*\('/, '').replace(/'$/, '')))).sort();
    eq('the page posts only its own actions (and reads the Client Book)', posts, ['cancelVisitPlan', 'decideVisitPlans', 'getClientBook', 'getVisitPlans', 'markVisitPlanDone', 'saveVisitPlan', 'submitVisitPlans']);
    ok('  never fetchFlow (every read is private)', !/fetchFlow\(/.test(SRC));
  }

  sec('4 · before FlowAPI 186');
  {
    const o = await boot('sales', { v: 185 });
    ok('it says so, reads nothing, and hides the lists', /version 186/.test(o.els.cvNotice.innerHTML) && /weekly itinerary works as before/.test(o.els.cvNotice.innerHTML) && o.posts().length === 0 && o.els.cvBar.hidden === true && o.els.cvBody.hidden === true);
  }

  sec('5 · the guard, both navbars, the bell');
  {
    const A = fs.readFileSync(D + 'js/auth.js', 'utf8'), L = fs.readFileSync(D + 'js/ledger-nav.js', 'utf8');
    const g = A.slice(A.indexOf('function requireClientVisitsAccess'), A.indexOf('function requireProductFinderAccess'));
    ok('the guard admits sales, the director, accounting and management', /\['sales', 'director', 'accounting', 'management'\]\.includes\(session\.role\)/.test(g));
    const ctx = {}; vm.createContext(ctx); vm.runInContext(L + '\nthis.__N = LEDGER_NAV;', ctx);
    const has = (role) => JSON.stringify(ctx.__N[role]).indexOf('client-visits.html') >= 0;
    eq('the new navigation: sales, the director, accounting and management, nobody else', ['admin', 'director', 'accounting', 'management', 'sales', 'marketing', 'leadgen', 'hr'].filter(has), ['director', 'accounting', 'management', 'sales']);
    const field = ctx.__N.sales.filter(s => s[0] === 'Field')[0][2];
    eq('  a rep\'s Field: Client visits first, the weekly itinerary still there', field.slice(0, 2).map(x => x[0]), ['client-visits.html', 'weekly-itinerary.html']);
    ok('  accounting: under Pay, after the travel allowance', JSON.stringify(ctx.__N.accounting.filter(s => s[0] === 'Pay')[0][2]).indexOf('"flow-travel.html","Travel allowance"],["client-visits.html"') >= 0);
    ok('the classic navbar carries it for the four roles', (A.match(/<a href="client-visits\.html" class="\$\{activePage === 'client-visits' \? 'active' : ''\}">Client Visits<\/a>/g) || []).length === 4);
    const bell = A.slice(A.indexOf('A369 — client visits, the new itinerary: the director sees'), A.indexOf('A209 — for a role commissions'));
    ok('the bell: the director\'s waiting visits, a rep\'s visits sent back, only from 186, by a private read',
       /flowVersionAtLeast\(186\)/.test(bell) && /postFlow\('getVisitPlans', \{\}\)/.test(bell) && /isDir \? 'Pending Director' : 'Rejected'/.test(bell) &&
       /client visit' \+ \(n === 1 \? '' : 's'\) \+ ' awaiting your approval', 'client-visits\.html'/.test(bell) && /' sent back', 'client-visits\.html'/.test(bell));
  }

  sec('6 · the sheet and the markup');
  {
    const CSS = fs.readFileSync(D + 'css/client-visits.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const sels = [];
    (function walk(t) {
      let i = 0;
      while (i < t.length) {
        const open = t.indexOf('{', i); if (open < 0) break;
        const head = t.slice(i, open).trim();
        let depth = 1, j = open + 1;
        while (j < t.length && depth) { if (t[j] === '{') depth++; else if (t[j] === '}') depth--; j++; }
        if (/^@media|^@supports/.test(head)) walk(t.slice(open + 1, j - 1)); else if (!/^@keyframes/.test(head) && !/^(from|to)$/.test(head)) sels.push(head);
        i = j;
      }
    })(CSS);
    const loose = sels.filter(s => s.split(',').some(x => !/^(html\[data-motion="off"\] )?body\.dh\b/.test(x.trim())));
    ok('every rule hangs off body.dh', sels.length > 40 && loose.length === 0, loose.slice(0, 5));
    ok('tokens only: no hex, no rgb() literal', !/#[0-9a-fA-F]{3,6}\b/.test(CSS) && !/rgba?\(/.test(CSS));
    ok('reduced motion, reduced transparency, more contrast and print are handled', /prefers-reduced-motion: reduce/.test(CSS) && /prefers-reduced-transparency: reduce/.test(CSS) && /prefers-contrast: more/.test(CSS) && /@media print/.test(CSS) && /data-motion="off"/.test(CSS));
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u;
    ['client-visits.html', 'js/client-visits.js', 'js/client-visits-model.js', 'js/client-visits-week.js', 'css/client-visits.css'].forEach(f => {
      const t = fs.readFileSync(D + f, 'utf8');
      ok(f + ': no emoji, no hex colour, no inline style', !EMOJI.test(t) && !/#[0-9a-fA-F]{6}\b/.test(t) && !/style="/.test(t) && !/\.style\./.test(t));
    });
    const H = fs.readFileSync(D + 'client-visits.html', 'utf8');
    ok('the page: body.dh, theme.js first, ledger.css then apple.css last, ledger-nav.js right after auth.js', /<body class="dh cv">\s*<script src="js\/theme\.js"><\/script>/.test(H) &&
       /css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">\s*<\/head>/.test(H) && /js\/auth\.js"><\/script>\s*<script src="js\/ledger-nav\.js">/.test(H));
  }

  sec('7 · a sales rep has no trace of the estimated travel allowance');
  {
    /* Neil, 25 Oct 2026: "make sure that the sales has no trace of the estimated travel allowance". The week view and every
       word of the estimate live in js/client-visits-week.js, which the page loads for the director, accounting and
       management only; the server leaves the estimate fields out of a rep's reads (visit-plans-store.js, section 10). */
    const TRACE = /estimat|to be set|travel allowance|travel week/i;
    ['client-visits.html', 'js/client-visits.js', 'js/client-visits-model.js', 'css/client-visits.css', 'js/sales-report.js', 'js/sales-report-model.js'].forEach(f => {
      const t = fs.readFileSync(D + f, 'utf8');
      ok(f + ' (loaded by a rep) says nothing of it', !TRACE.test(t), (t.match(new RegExp('.{0,60}(' + TRACE.source + ').{0,60}', 'i')) || [])[0]);
    });
    ok('  the page does not list the week view among its scripts', !/client-visits-week/.test(fs.readFileSync(D + 'client-visits.html', 'utf8')));
    ok('  and the week view is where it all lives', /To be set/.test(fs.readFileSync(D + 'js/client-visits-week.js', 'utf8')) && /Estimated travel allowance/.test(fs.readFileSync(D + 'js/client-visits-week.js', 'utf8')));
    /* a rep's page, even if a server sent the fields anyway */
    const leaky = PLANS.map(v => Object.assign({}, v, { travelEstimate: 850, travelEstimateBasis: 'a test figure' }));
    const s = await boot('sales', { plans: leaky });
    ok('a rep\'s page never loads the week view', s.run('__made.indexOf("script")') < 0 && s.run('typeof cvWeekHtml') === 'undefined' && s.run('typeof cvTravelEstimate') === 'undefined' && s.run('typeof CV_WEEK') === 'undefined');
    const shown = [];
    ['needs', 'upcoming', 'past'].forEach(seg => { s.run('CV.seg = "' + seg + '"; cvRender();'); shown.push(s.els.cvSeg.innerHTML, s.els.cvTools.innerHTML, s.els.cvBody.innerHTML, s.els.cvLede.textContent, s.els.cvNotice.innerHTML, s.els.cvActions.innerHTML); });
    s.run('CV.plans.map(function (v) { return v.visitPlanNo; })').forEach(no => { s.run('cvDetail("' + no + '")'); shown.push(s.els.cvDlg.innerHTML); });
    s.run('cvPlanDlg(null)'); shown.push(s.els.cvDlg.innerHTML);
    s.run('CV.seg = "week"; cvRender();'); shown.push(s.els.cvSeg.innerHTML, s.els.cvTools.innerHTML);
    ok('  and nothing it shows says a word of it: the lists, every visit, the plan form, a forced week view', shown.length > 15 && !shown.some(h => TRACE.test(h) || /850|a test figure/.test(h)), shown.filter(h => TRACE.test(h)).map(h => h.slice(0, 120)));
    ok('  no Travel week segment for a rep', !/data-seg="week"/.test(s.els.cvSeg.innerHTML));
    const a = await boot('accounting');
    ok('accounting\'s page does have it (the week view was already there)', a.run('typeof cvWeekHtml') === 'function' && /Estimated travel allowance/.test(a.els.cvBody.innerHTML) && /estimated travel allowance/.test(a.els.cvLede.textContent));
  }

  console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})();
