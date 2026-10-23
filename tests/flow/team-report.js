/* A351 — the accounting, lead gen and admin daily reports (js/team-report-model.js + js/team-report.js, first on director-home).
 *
 * Run:  node tests/flow/team-report.js
 *
 * A small world with the answers worked out by hand, today being Thursday 22 Oct 2026. The model and the page run on the
 * real flow-api.js and sales-report-model.js / sales-report.js (whose helpers and tile renderer they reuse) in one vm context.
 *
 *   1 · accounting: its tiles from the person's ActivityLog only; events vs records; links; the week
 *   2 · lead gen: the server's counts and quotas, met at the first number; red only once the day has ended; the week
 *   3 · admin: PRs moved on, documents on PRs only, PRs past their stage limit (and the FlowSettings override)
 *   4 · typed lines: the role's own types, edit and void with a reason, never deleted; the snapshot; the queue order
 *   5 · the page: whose records, the reads it makes, the queue for the chosen person, saving with a kind, and before 179
 *   6 · the site rules: only the store's three actions plus plain reads; no emoji, hex colour or inline style
 * A352 adds the sent mail: accounting's collection follow-up emails and admin's price requests to suppliers (4b, 5b).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DASH = path.resolve(__dirname, '../../dashboard/js');
let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const R = 'Rojan Leo Francisco', A = 'Ana Admin', L = 'Lea Gen';
const ts = (day, hhmm) => day + 'T' + String((Number(hhmm.slice(0, 2)) + 16) % 24).padStart(2, '0') + ':' + hhmm.slice(3) + ':00.000Z';   // Manila hh:mm → UTC (the day before for early hours is not used here)
const act = (user, day, hhmm, module, action, refNo, amount, summary) => ({ timestamp: ts(day, hhmm), date: day, user, module, action, refNo, amount: amount || 0, summary: summary || '' });
const ACT = [
  act(R, '2026-10-22', '09:10', 'Invoice', 'Issued', 'INV-126', 100000), act(R, '2026-10-22', '09:40', 'Invoice', 'Issued', 'INV-127', 50000),
  act(R, '2026-10-22', '10:05', 'Collection', 'Recorded', 'AR-1', 30000), act(R, '2026-10-22', '11:30', 'Collection', 'Recorded', 'AR-1', 20000),
  act(R, '2026-10-22', '13:00', 'Payment Request', 'Created', 'PAY-1'), act(R, '2026-10-22', '13:05', 'Payment Request', 'Submitted', 'PAY-1'),
  act(R, '2026-10-22', '14:00', 'Payment Request', 'Paid', 'PAY-0', 75000), act(R, '2026-10-22', '15:00', 'Books', 'Synced', ''),
  act(R, '2026-10-21', '10:00', 'Invoice', 'Issued', 'INV-120', 40000), act(R, '2026-10-21', '10:20', 'Invoice', 'Issued', 'INV-121', 0), act(R, '2026-10-21', '10:25', 'Invoice', 'Voided', 'INV-121'), act(R, '2026-10-20', '10:00', 'Payment Request', 'Paid', 'PAY-9', 10000),
  act('Kim Reyes', '2026-10-22', '09:00', 'Invoice', 'Issued', 'INV-200', 999999),
  act(A, '2026-10-22', '09:00', 'Pricing Request', 'Sourced', 'PR-10'), act(A, '2026-10-22', '09:30', 'Pricing Request', 'Verified', 'PR-11'),
  act(A, '2026-10-22', '10:00', 'Pricing Request', 'Reattributed', 'PR-12', 0, 'Sent to Gerald Lucena'),
  act(A, '2026-10-22', '10:10', 'Document', 'Attached', 'PR-10'), act(A, '2026-10-22', '10:20', 'Document', 'Attached', 'SO-5'),
  act(A, '2026-10-22', '11:00', 'Purchase Order', 'Created', 'PO-7'), act(A, '2026-10-22', '11:05', 'Purchase Order', 'Submitted', 'PO-7'),
  act(A, '2026-10-22', '12:00', 'Quotation', 'Sent', 'Q-1')
];
const AR = [{ arNo: 'AR-1', customer: 'Philcement Corp', outstanding: 50000, dueDate: '2026-10-30', status: 'Partial' },
            { arNo: 'AR-2', customer: 'Zeta Mining', outstanding: 120000, dueDate: '2026-10-01', status: 'Unpaid' },
            { arNo: 'AR-3', customer: 'Paid Co', outstanding: 0, dueDate: '2026-09-01', status: 'Paid' }];
const PRS = [{ prNo: 'PR-20', customer: 'Old Plant', status: 'Requested', date: '2026-10-15' }, { prNo: 'PR-21', customer: 'Fresh Co', status: 'Mgmt Priced', date: '2026-10-21' },
             { prNo: 'PR-22', customer: 'Mid Co', status: 'Sourcing', date: '2026-10-18' }, { prNo: 'PR-23', customer: 'Done Co', status: 'Returned to Sales', date: '2026-10-01' }];
const POS = [{ poNo: 'PO-7', supplier: 'Enerpac', status: 'Submitted' }, { poNo: 'PO-6', supplier: 'Old Supplier', status: 'Received' }];
const SOS = [{ soNo: 'SO-5', customer: 'Taiheiyo', status: 'Open' }, { soNo: 'DEMO-1', customer: 'Demo', status: 'Open' }];
const LGC = { success: true, date: '2026-10-22',
  day: { attempts: 42, conversations: 3, emails: 30, linkedin: 5, suppliers: 0, accounts: 12, crm: 1, scheduled: 1 },
  quotas: { attempts: 40, conversations: 5, emails: 25, linkedin: 5, suppliers: 5, accounts: 10, crm: 1, scheduled: 1 },
  quotasMax: { attempts: 50, conversations: 10, emails: 30, linkedin: 10, suppliers: 10, accounts: 15, crm: 1, scheduled: 3 },
  week: { byDay: { '2026-10-19': { attempts: 40, conversations: 5, emails: 25 }, '2026-10-20': { attempts: 45, conversations: 6, emails: 26 },
                   '2026-10-21': { attempts: 38, conversations: 4, emails: 20 }, '2026-10-22': { attempts: 42, conversations: 3, emails: 30 } },
          weekly: { leads: { value: 4, min: 10, max: 20 }, suppliersHandedOff: { value: 30, min: 25, max: 50 }, meetings: { value: 1, min: 0, max: 0 } },
          replyRate: 8.5, replyRateAim: 8 } };
const LGDATA = { accred: [{ accredNo: 'ACR-1', company: 'Philcement Corp', status: 'Pending' }, { accredNo: 'ACR-2', company: 'Gone', status: 'Approved', deletedOn: '2026-10-01' }],
                 leads: [{ leadNo: 'QLD-1', company: 'Zeta Mining', status: 'Handed Off', handedTo: 'gerald' }, { leadNo: 'QLD-2', company: 'Won Co', status: 'Won' }] };

function world() {
  const store = {};
  const ctx = {
    console, Date, Math, JSON, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: (id) => ctx.__els[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}), activeElement: null,
                body: { classList: { add() {}, remove() {} }, appendChild() {} } },
    navigator: { userAgent: 'node' }, location: { href: '', pathname: '/' }, __els: {}
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  require('./hxutil').load(ctx);
  ['flow-api.js', 'itinerary-week.js', 'sales-report-model.js', 'sales-report.js', 'team-report-model.js', 'team-report.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(DASH, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext('flowToday = function () { return "2026-10-22"; };', ctx);
  ctx.__store = store;
  return ctx;
}
const C = world();
const run = (code) => vm.runInContext(code, C);
const J = (code) => JSON.parse(run('JSON.stringify(' + code + ')'));
Object.assign(C, { __act: ACT, __ar: AR, __prs: PRS, __pos: POS, __sos: SOS, __lgc: LGC, __lgdata: LGDATA });
run('var IX = trIndex({ today: "2026-10-22", activity: __act, ar: __ar, prs: __prs, pos: __pos, sos: __sos, lgCounts: __lgc, lgData: __lgdata, settings: {} });');
const tile = (list, key) => list.find(t => t.key === key) || {};

sec('1 · accounting');
{
  const T = J('trTiles("accounting", IX, "Rojan Leo Francisco", "2026-10-22", 600)').portal;
  eq('invoices issued: two, ₱150,000 — Kim\'s invoice is not his', [tile(T, 'invoices').value, tile(T, 'invoices').text], [2, '2 · ₱150,000']);
  eq('two payments on one receivable are two collections, ₱50,000', [tile(T, 'collections').value, tile(T, 'collections').money], [2, 50000]);
  eq('a payment request created and submitted is one request; one transfer paid, ₱75,000', [tile(T, 'payReqs').value, tile(T, 'paid').text], [1, '1 · ₱75,000']);
  ok('A353: books work is not a tile, and travel reports are typed, not counted', !T.some(t => t.key === 'books' || t.key === 'travel') &&
     J('TR_ROLES.accounting.lines.map(function (x) { return x.type; })').indexOf('Travel report') >= 0);
  ok('  the rest are zero, with no made-up target', ['acknowledged', 'ap', 'received', 'expenses'].every(k => tile(T, k).value === 0 && tile(T, k).status === 'none'));
  ok('every tile opens its records', tile(T, 'invoices').items.length === 2 && tile(T, 'invoices').items[0].ref === 'INV-126' && tile(T, 'invoices').items[0].time === '9:10 AM', tile(T, 'invoices').items);
  const d21 = J('trTiles("accounting", IX, "Rojan Leo Francisco", "2026-10-21", 600)').portal[0];
  ok('another day is another day; an invoice issued and voided that day is not counted, and the tile says so', d21.value === 1 && d21.text === '1 · ₱40,000' && /1 voided the same day, not counted/.test(d21.target), d21);
  const links = J('trLinkOptions("accounting", IX)').ar;
  eq('a collection call links to an open receivable, the most overdue first; a paid one is not offered', links.map(x => x.id), ['AR-2', 'AR-1']);
  ok('  labelled with the customer, the balance and the due date', links[0].label === 'AR-2 — Zeta Mining, ₱120,000, past due 2026-10-01' && links[1].label === 'AR-1 — Philcement Corp, ₱50,000, due 2026-10-30', links);
  const W = J('trWeek("accounting", IX, "Rojan Leo Francisco", "2026-10-22", { "2026-10-21": { submittedAt: "2026-10-21T08:31:00.000Z" } })');
  eq('the week: invoices, collections and transfers paid a day (and the mail column, still unread here)', W.rows.slice(0, 4).map(r => r.vals), [[0, 0, 0, 'loading'], [0, 0, 1, 'loading'], [1, 0, 0, 'loading'], [2, 2, 1, 'loading']]);
  eq('  Wednesday\'s 4:30 report went in; Monday, Tuesday and today are due; Friday on is still to come', W.rows.map(r => r.future ? 'future' : r.report.state), ['due', 'due', 'done', 'due', 'future', 'future', 'future']);
  eq('  the totals and the reports', [W.totals, W.reports, W.reportDays, W.heads], [[3, 2, 2, null], 1, 4, ['Invoices issued', 'Collections recorded', 'Transfers paid', 'Collection emails']]);
}

sec('2 · lead gen');
{
  const day = J('trTiles("leadgen", IX, "Lea Gen", "2026-10-22", 600)'), late = J('trTiles("leadgen", IX, "Lea Gen", "2026-10-22", 17 * 60)');
  eq('the server\'s counts, against the server\'s quotas', [tile(day.portal, 'attempts').text, tile(day.portal, 'attempts').target, tile(day.portal, 'crm').target], ['42', '40–50 a day', '1 a day']);
  ok('a quota is met at its first number', tile(day.portal, 'attempts').status === 'ok' && tile(day.portal, 'emails').status === 'ok' && tile(day.portal, 'linkedin').status === 'ok');
  ok('  below it is not red while the day is still on', tile(day.portal, 'conversations').status === 'none' && tile(day.portal, 'suppliers').status === 'none');
  ok('  and red once the day has ended (4:30)', tile(late.portal, 'conversations').status === 'red' && tile(late.portal, 'suppliers').status === 'red' && tile(late.portal, 'attempts').status === 'ok');
  ok('the end-of-day report is not a tile (the 4:30 report is)', !day.portal.some(t => t.key === 'eod'));
  eq('this week so far: leads, suppliers handed off, presentations, reply rate', day.weekly.map(t => [t.key, t.text, t.status]),
     [['w_leads', '4', 'none'], ['w_suppliersHandedOff', '30', 'ok'], ['w_meetings', '1', 'none'], ['w_replyRate', '8.5%', 'none']]);
  const none = J('trTiles("leadgen", trIndex({ today: "2026-10-22" }), "Lea Gen", "2026-10-22", 600)');
  ok('without the counts, the tiles say so instead of showing zeros', none.portal.every(t => t.text === '—' && t.status === 'nr'));
  const links = J('trLinkOptions("leadgen", IX)');
  eq('links: live accreditations, and leads still with a rep', [links.accred.map(x => x.id), links.lead.map(x => x.id)], [['ACR-1'], ['QLD-1']]);
  const W = J('trWeek("leadgen", IX, "Lea Gen", "2026-10-22", {})');
  eq('the week comes from the server\'s own day counts', W.rows.slice(0, 4).map(r => r.vals), [[40, 5, 25], [45, 6, 26], [38, 4, 20], [42, 3, 30]]);
}

sec('3 · admin');
{
  const T = J('trTiles("admin", IX, "Ana Admin", "2026-10-22", 600)').portal;
  eq('PRs sourced, verified and sent to a rep', [tile(T, 'sourced').value, tile(T, 'verified').value, tile(T, 'toRep').value, tile(T, 'forwarded').value], [1, 1, 1, 0]);
  eq('documents count on PRs only (not the SO\'s)', tile(T, 'docs').value, 1);
  eq('a PO created and submitted is one PO; a quotation sent', [tile(T, 'pos').value, tile(T, 'quotesSent').value], [1, 1]);
  const st = tile(T, 'stuck');
  eq('PRs past their stage limit: PR-20 (7 days at sourcing) and PR-22 (4), not PR-21 (1 day at verify)', [st.value, st.status, st.items.map(i => i.ref)], [2, 'red', ['PR-20', 'PR-22']]);
  eq('  with the limits it used', st.target, 'sourcing 3 days · verify 2 days');
  run('var IX5 = trIndex({ today: "2026-10-22", prs: __prs, settings: { prSourcingDays: "5" } });');
  eq('FlowSettings moves the limit (sourcing 5 days: only PR-20)', J('trStuckPrs(IX5)').map(x => x.ref), ['PR-20']);
  ok('a past day has no stage-limit tile (it is a live state)', !J('trTiles("admin", IX, "Ana Admin", "2026-10-21", 600)').portal.some(t => t.key === 'stuck'));
  const links = J('trLinkOptions("admin", IX)');
  eq('links: PRs in admin\'s stages, open POs, live SOs (no demo)', [links.pr.map(x => x.id), links.po.map(x => x.id), links.so.map(x => x.id)], [['PR-20', 'PR-21', 'PR-22'], ['PO-7'], ['SO-5']]);
}

sec('4 · typed lines, the snapshot, the queue');
{
  run('var REP = trBlank("accounting", "Rojan Leo Francisco");');
  run('REP.lines.push(trNewLine("accounting", { type: "Collection call", what: "Zeta Mining", result: "Promised to pay", nextDate: "2026-10-29", linkType: "ar", linkId: "AR-2", linkLabel: "AR-2 — Zeta Mining" }, "Neil Estur", "2026-10-22T02:00:00.000Z"));');
  run('REP.lines.push(trNewLine("accounting", { type: "Visit", what: "not an accounting line" }, "Neil Estur", "2026-10-22T03:00:00.000Z"));');
  run('REP.lines.push(trNewLine("accounting", { type: "Billing", what: "PS-0091", result: "Payment slip" }, "Neil Estur", "2026-10-22T04:00:00.000Z"));');
  eq('a line keeps the role\'s types only (anything else is an Other task)', J('REP.lines.map(function (l) { return l.type; })'), ['Collection call', 'Other task', 'Billing']);
  const e1 = J('trEditLine(REP.lines[0], { result: "Paid already" }, "", "2026-10-22T05:00:00.000Z")');
  ok('an edit needs a reason', !!e1.error && J('REP.lines[0].result') === 'Promised to pay');
  run('trEditLine(REP.lines[0], { result: "Paid already", type: "Billing" }, "She called back", "2026-10-22T05:00:00.000Z");');
  const l0 = J('REP.lines[0]');
  ok('  and keeps what the line said before, and why; its type stays', l0.result === 'Paid already' && l0.type === 'Collection call' && l0.history[0].before.result === 'Promised to pay' && l0.editReason === 'She called back', l0);
  ok('a void needs a reason, and keeps the line', !!J('trVoidLine(REP.lines[1], "", "x")').error && !J('REP.lines[1]').voidedAt);
  run('trVoidLine(REP.lines[1], "Logged by mistake", "2026-10-22T06:00:00.000Z");');
  ok('  struck through, never deleted', J('REP.lines.length') === 3 && J('REP.lines[1].voidReason') === 'Logged by mistake');
  const mine = J('trMineTiles("accounting", REP, "2026-10-22")');
  eq('the typed tiles count each type, voided lines left out', mine.map(t => [t.label, t.value]), [['Collection call', 1], ['Collection email', 0], ['Billing', 1], ['Bank reconciliation', 0], ['Month check', 0], ['Travel report', 0], ['Other tasks', 0]]);
  eq('lines with a link: of the lines that can take one', J('trLinked("accounting", REP, "2026-10-22")'), { linked: 1, total: 1 });
  const T = J('trTiles("accounting", IX, "Rojan Leo Francisco", "2026-10-22", 600)').portal;
  const snap = J('trSnapshot(' + JSON.stringify(T) + ', trMineTiles("accounting", REP, "2026-10-22"), "2026-10-22", "Rojan Leo Francisco")');
  ok('the snapshot keeps every number, and whose records they were', snap.person === R && snap.invoices.text === '2 · ₱150,000' && snap.m_Collectioncall.value === 1, snap);
  eq('the queue: urgent first, then overdue, to do, ready', J('trQueue([{ text: "a", tone: "ok" }, { text: "b", tone: "urgent" }, { text: "c", tone: "info" }, { text: "d", tone: "warn" }]).map(function (q) { return q.text; })'), ['b', 'd', 'c', 'a']);
  eq('a saved report is read safely, with its person, only true/false email marks, and only PR numbers (or "none") as email links', J('trFill({ person: "X", lines: [{ id: "a" }, null, {}], pm: { blocker: " no blocker " }, mailMarks: { m1: true, m2: false, m3: "yes" }, mailPrs: { m1: "pr-202610-067", m2: "", m3: "nonsense", m4: 7, m5: "PR-2025-014" } }, "admin", "Y")'),
     { v: 1, kind: 'admin', person: 'X', lines: [{ id: 'a' }], pm: { blocker: 'no blocker' }, mailMarks: { m1: true, m2: false }, mailPrs: { m1: 'PR-202610-067', m2: '', m5: 'PR-2025-014' } });
}

sec('4b · A352: the sent mail — collection follow-ups (accounting), price requests to suppliers (admin)');
{
  const mail = (id, subject, recipient, hhmm) => ({ messageId: id, subject, recipient, name: recipient.split('@')[0], sentAt: '2026-10-22T' + (hhmm || '09:00') + ':00+08:00' });
  C.__acctMail = [mail('a1', 'Statement of Account - October', 'ap@unknownbuyer.com', '09:00'), mail('a2', 'Hello from Hi-Escorp', 'juan@zetamining.com', '09:30'),
                  mail('a3', 'Invoice 139', 'buyer@philcement.ph', '10:00'), mail('a4', 'Lunch', 'friend@gmail.com', '11:00'), mail('a5', 'Following up', 'pay@zm-group.com', '11:30')];
  C.__clients = [{ customer: 'Zeta Mining', email: 'pay@zm-group.com' }];
  run('var IXM = trIndex({ today: "2026-10-22", activity: __act, ar: __ar, prs: __prs, pos: __pos.concat([{ poNo: "PO-8", supplier: "Enerpac Asia Pte Ltd", status: "Draft" }]), sos: __sos.concat([{ soNo: "SO-9", customer: "Taiheiyo Cement Philippines Inc.", status: "Open" }]), clients: __clients, suppliers: [{ supplier: "Hytorc Philippines" }] });');
  const A = J('trMail("accounting", IXM, __acctMail, {})');
  eq('accounting: a payment subject counts; so does mail to a customer with a past-due receivable (by its domain, or its address on file)', A.map(r => [r.id, r.counted]),
     [['a1', true], ['a2', true], ['a3', false], ['a4', false], ['a5', true]]);
  eq('  and each says why, with the receivable it is about', [A[0].why, A[1].why, A[1].ref, A[4].org], ['the subject is about payment', 'to Zeta Mining, who has a past-due receivable', 'AR-2', 'Zeta Mining']);
  ok('  an invoice to a customer whose receivable is not yet due is not a follow-up', !A[2].counted && A[2].org === 'Philcement Corp' && !A[2].why);
  const Am = J('trMail("accounting", IXM, __acctMail, { a1: false, a3: true })');
  ok('the director\'s correction wins over the guess, either way', !Am[0].counted && Am[0].marked && Am[2].counted && Am[2].marked);
  C.__admMail = [mail('p1', 'RFQ - hydraulic torque wrench PR-202610-067', 'sales@enerpac.com', '08:30'), mail('p2', 'Price and availability, 1" impact wrench', 'info@newvendor.ph', '09:00'),
                 mail('p3', 'Purchase Order PO-7', 'sales@enerpac.com', '09:10'), mail('p4', 'Quotation 2026-543-ADM', 'buyer@taiheiyo.com.ph', '09:20'),
                 mail('p5', 'Stock availability - flange spreader', 'sg@hytorc.com', '09:40'), mail('p6', 'Request for quotation', 'x@taiheiyo.com.ph', '10:00'),
                 mail('p7', 'Quotation 2026-560-ADM', 'buyer@notonfile.ph', '10:30')];
  const P = J('trMail("admin", IXM, __admMail, {})');
  eq('admin: an RFQ subject is a price request, and so is a price or stock question to anyone who is not a customer; never a PO, our own quotation, nor mail to a customer', P.map(r => [r.id, r.price]),
     [['p1', true], ['p2', true], ['p3', false], ['p4', false], ['p5', true], ['p6', false], ['p7', false]]);
  eq('A365: but it COUNTS only with its PR — the one whose subject names PR-202610-067; the others wait for theirs', P.map(r => [r.id, r.counted, r.needsPr]),
     [['p1', true, false], ['p2', false, true], ['p3', false, false], ['p4', false, false], ['p5', false, true], ['p6', false, false], ['p7', false, false]]);
  const Pl = J('trMail("admin", IXM, __admMail, {}, { p2: "PR-202610-070", p1: "", p4: "PR-202610-071" })');
  eq('  a PR picked by hand links it (and counts it); "none" takes the subject\'s off; any other email can carry a PR without counting', Pl.map(r => [r.id, r.pr, r.prHow, r.counted]).filter(x => ['p1', 'p2', 'p4'].indexOf(x[0]) >= 0),
     [['p1', '', '', false], ['p2', 'PR-202610-070', 'picked', true], ['p4', 'PR-202610-071', 'picked', false]]);
  eq('  the subject\'s PR is said so', [P[0].pr, P[0].prHow, P[0].subjPr], ['PR-202610-067', 'subject', 'PR-202610-067']);
  ok('accounting\'s mail carries no PR (its emails are about receivables)', A.every(r => r.pr === '' && !r.needsPr) && A[1].ref === 'AR-2');
  eq('  a new vendor not on file is said so', P[1].why, 'asks about price or stock, not to a customer');
  eq('  with why, the supplier, and the PR number in the subject', [P[0].why, P[0].org, P[0].ref, P[4].why], ['the subject asks for a price', 'Enerpac', 'PR-202610-067', 'to supplier Hytorc Philippines, about price or stock']);
  const T = J('trMailTiles("admin", trMail("admin", IXM, __admMail, { p3: true }, { p3: "PR-202610-072", p2: "PR-202610-070" }), "ok")');
  eq('the tiles: price requests with their PR (a missed one counted by hand), then every email sent', T.map(t => [t.key, t.label, t.text]), [['mailPrice', 'Price requests to suppliers', '3'], ['mailSent', 'Emails sent', '7']]);
  ok('  the one still without its PR is said under the count, in the watch colour', T[0].target === '1 more waiting for a PR' && T[0].status === 'watch', T[0]);
  ok('  the records behind it say why each counts, with its PR', T[0].items.length === 3 && T[0].items.some(i => i.result === 'counted by you') && T[0].items.every(i => /^PR-/.test(i.ref)));
  ok('  with every price request linked: "each with its PR"', J('trMailTiles("admin", trMail("admin", IXM, __admMail.slice(0, 1)), "ok")')[0].target === 'from the sent mail, each with its PR');
  ok('the typed "Price request email" line is gone (the mailbox counts them, with their PR); an old one stays editable', !J('TR_ROLES.admin.lines.map(function (l) { return l.type; })').includes('Price request email') &&
     J('TR_ROLES.admin.retired.map(function (l) { return l.type; })').includes('Price request email') && !J('trMineTiles("admin", trBlank("admin", "X"), "2026-10-22").map(function (t) { return t.label; })').includes('Price request email'));
  const T0 = J('trMailTiles("accounting", [], "setup")');
  ok('a mailbox that is not connected shows "—" and says so, instead of a zero', T0.every(t => t.text === '—' && t.status === 'nr' && t.target === 'the mailbox is not connected'));
  ok('lead gen has no mail tiles', J('trMailTiles("leadgen", [], "ok")').length === 0);
  C.__wm = { '2026-10-19': [], '2026-10-20': null, '2026-10-21': [mail('w1', 'Payment reminder', 'ap@x.com')] };
  const W = J('trWeek("accounting", IXM, "Rojan Leo Francisco", "2026-10-22", {}, __wm)');
  eq('the week gains a collection-email column: counted, unreadable, and still being read', [W.heads[3], W.rows.slice(0, 4).map(r => r.vals[3]), W.totals[3]], ['Collection emails', [0, null, 1, 'loading'], 1]);
  const W2 = J('trWeek("accounting", IXM, "Rojan Leo Francisco", "2026-10-22", { "2026-10-21": { report: { mailMarks: { w1: false } } } }, __wm)');
  ok('  and a day\'s own corrections count in it', W2.rows[2].vals[3] === 0);
  C.__wa = { '2026-10-19': [], '2026-10-20': [mail('w2', 'RFQ - torque wrench', 'sales@enerpac.com')], '2026-10-21': [] };
  const Wa = J('trWeek("admin", IXM, "Ana Admin", "2026-10-22", { "2026-10-20": { report: { mailPrs: { w2: "PR-202610-067" } } } }, __wa)');
  const Wb = J('trWeek("admin", IXM, "Ana Admin", "2026-10-22", {}, __wa)');
  eq('A365: the week\'s price-request column counts a day\'s request only with the PR linked that day', [Wa.rows[1].vals[Wa.heads.length - 1], Wb.rows[1].vals[Wb.heads.length - 1]], [1, 0]);
}

sec('5 · the page');
function fakeSection() {
  const parts = {};
  const part = (sel) => (parts[sel] = parts[sel] || { sel, innerHTML: '', textContent: '', className: '', value: '', disabled: false, dataset: {}, style: { setProperty() {} },
    contains: () => false, focus() {}, setAttribute() {}, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  return { parts, dataset: {}, addEventListener() {}, querySelector: (sel) => part(sel), querySelectorAll: () => [] };
}
const WHO = { accounting: { name: 'Rojan Leo Francisco', username: 'acct2' }, leadgen: { name: 'Lea Gen', username: 'lea' }, admin: { name: 'Ana Admin', username: 'ana' } };
async function boot(roleKey, o) {
  o = o || {};
  const P = world(), me = o.own ? Object.assign({ role: roleKey }, WHO[roleKey]) : { name: 'Neil Estur', username: 'neil', role: 'director' };
  const id = { accounting: 'acctReport', leadgen: 'lgReport', admin: 'adminReport' }[roleKey];
  P.__els[id] = fakeSection();
  Object.assign(P, { __act: ACT, __ar: AR, __prs: PRS, __pos: POS, __sos: SOS, __lgc: LGC, __lgdata: LGDATA, __has179: o.v179 !== false, __mailMode: o.mail || 'ok',
    __mailToday: o.mailToday || [{ messageId: 'm1', subject: 'SOA as of October', recipient: 'ap@zetamining.com', name: 'Zeta AP', sentAt: '2026-10-22T09:15:00+08:00' },
                                 { messageId: 'm2', subject: 'Lunch', recipient: 'friend@gmail.com', name: 'Friend', sentAt: '2026-10-22T12:00:00+08:00' }],
    __me: me, __usersRead: 0,
    __saved: o.saved || [{ date: '2026-10-21', user: WHO[roleKey].name, kind: roleKey, submittedAt: '2026-10-21T08:31:00.000Z', updatedAt: '2026-10-21T08:31:00.000Z', report: { v: 1, kind: roleKey, lines: [] } },
                          { date: '2026-10-19', user: 'Neil Estur', kind: roleKey, updatedAt: '2026-10-19T08:31:00.000Z', report: { v: 1, kind: roleKey, lines: [] } },
                          { date: '2026-10-20', user: WHO[roleKey].name, kind: 'sales', submittedAt: '2026-10-20T08:31:00.000Z', report: { v: 2, lines: [] } }] });
  vm.runInContext(`
    getSession = function () { return __me; };
    apiGetUsers = function () { __usersRead++; return Promise.resolve({ data: [{ username: 'acct2', fullName: 'Rojan Leo Francisco', role: 'accounting' }, { username: 'kim', fullName: 'Kim Reyes', role: 'sales' },
      { username: 'ana', fullName: 'Ana Admin', role: 'admin' }, { username: 'lea', fullName: 'Lea Gen', role: 'leadgen' }, { username: 'neil', fullName: 'Neil Estur', role: 'director' }] }); };
    flowVersionAtLeast = function (n) { return Promise.resolve(__has179 && n <= 179); };
    var __reads = [], __posts = [], __queueFor = [];
    fetchFlow = function (a, p) { __reads.push({ a: a, p: p || {} });
      var d = { getActivityLog: __act, getFlowSettings: {}, getARAging: __ar, getPricingRequests: __prs, getPurchaseOrders: __pos, getSalesOrders: __sos, getLeadgen: __lgdata,
                getLeadgenFollowups: [{ name: 'R. Cruz', company: 'Philcement Corp', stage: 'Day 7', action: 'Call', overdue: 0 }],
                getClients: [{ customer: 'Zeta Mining', email: '' }], getSuppliers: [{ supplier: 'Enerpac' }] };
      if (a === 'getLeadgenCounts') return Promise.resolve(__lgc);
      return Promise.resolve({ success: true, data: d[a] === undefined ? [] : d[a] }); };
    postFlow = function (a, p) { __posts.push({ a: a, p: p });
      if (a === 'getProofReports') return Promise.resolve({ success: true, data: __saved });
      return Promise.resolve({ success: true, reportNo: 'PW-202610-009', updatedAt: '2026-10-22T05:00:00.000Z', submittedAt: a === 'submitProofReport' ? '2026-10-22T08:35:00.000Z' : '' }); };
    var __mailReads = [];
    apiFetchEmailLogToday = function (user, date) { __mailReads.push({ user: user, date: date });
      if (__mailMode === 'setup') return Promise.resolve({ success: true, needsSetup: true, emails: [] });
      return Promise.resolve({ success: true, emails: date === '2026-10-22' ? __mailToday : [] }); };
    flowComputeActions = function (s) { __queueFor.push(s); return Promise.resolve([{ icon: 'report', tone: 'info', text: '2 receivable(s) past due — collect', link: 'flow-ar-aging.html', amt: 120000 },
      { icon: 'urgent', tone: 'urgent', text: '1 approved transfer to pay', link: 'flow-payment-requests.html' }]); };`, P);
  await vm.runInContext('teamReport(' + JSON.stringify(id) + ', ' + JSON.stringify(roleKey) + (o.own ? ', { own: true }' : '') + ')', P);
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  return { P, el: P.__els[id], run: (c) => vm.runInContext(c, P), part: (sel) => P.__els[id].parts[sel] || { innerHTML: '' } };
}
(async () => {
  const a = await boot('accounting');
  const S = (x) => a.run('TR_UI.accounting.' + x);
  eq('whose records: the accounting logins only, the first by default', [S('people'), S('person')], [[R], R]);
  const reads = a.run('__reads.map(function (r) { return r.a; })').slice().sort();
  ok('it reads the activity log with the sales report\'s exact parameters (one read for both), settings and receivables',
     reads.indexOf('getActivityLog') >= 0 && JSON.stringify(a.run('__reads.filter(function (r) { return r.a === "getActivityLog"; })[0].p')) === JSON.stringify({ from: '2026-09-10', to: '2026-10-22' }) &&
     reads.indexOf('getARAging') >= 0, reads);
  eq('A363: its saved days are the chosen person\'s own, from the store with its kind (the director\'s old trial rows and another kind ignored)', [a.run('JSON.stringify(__posts[0])') && a.run('__posts[0].p.kind'), Object.keys(S('saved'))], ['accounting', ['2026-10-21']]);
  eq('the queue is the chosen person\'s own home-page list', a.run('JSON.stringify(__queueFor[0])'), JSON.stringify({ role: 'accounting', name: R, username: 'acct2' }));
  const tiles = a.part('[data-tiles="portal"]').innerHTML;
  ok('the tiles are drawn like the sales report\'s, each opening its records', /data-rec="invoices"/.test(tiles) && /<span class="v">2 · ₱150,000<\/span>/.test(tiles) && /sr-tile s-none/.test(tiles), tiles.slice(0, 300));
  const q = a.part('[data-queue]').innerHTML;
  ok('waiting on him: urgent first, linked to the page, with the amount', q.indexOf('1 approved transfer to pay') < q.indexOf('receivable') && /href="flow-ar-aging\.html"/.test(q) && /₱120,000/.test(q), q);
  const feed = a.part('[data-feedlist]').innerHTML;
  ok('logged by the portal: his rows that day only, with filter pills by module', /INV-126/.test(feed) && !/INV-200/.test(feed) && !/INV-120/.test(feed) &&
     /data-feed="Invoice"/.test(a.part('[data-pills]').innerHTML) && /data-feed="Books"/.test(a.part('[data-pills]').innerHTML), feed.slice(0, 300));
  const head = a.run('_trHeadHtml(TR_UI.accounting)');
  ok('  the head: the title, Read only, "Whose report" and the day', /<h2>Accounting Daily Report<\/h2>/.test(head) && /<span class="sr-chip">Read only<\/span>/.test(head) && /<span>Whose report<\/span>/.test(head) &&
     /<option selected>Rojan Leo Francisco<\/option>/.test(head) && /data-date value="2026-10-22"/.test(head) && !/Trial/.test(head), head);
  const body = a.run('_trBodyHtml(TR_UI.accounting)');
  ok('  the body: the numbers, the queue, their log, the portal feed, the 4:30 report, the week — and nothing to type', ['data-tiles="portal"', 'data-queue', 'data-feedlist', 'data-pm', 'data-week'].every(s => body.includes(s)) &&
     !/data-new=/.test(body) && /Read only — Rojan Leo Francisco&#39;s own report|Read only — Rojan Leo Francisco's own report/.test(body) && /Rojan's log/.test(body), body.slice(0, 600));
  a.run(`TR_UI.accounting.state.lines.push(trNewLine('accounting', { type: 'Other task', what: '<img src=x onerror=alert(1)>' }, 'Rojan Leo Francisco', '2026-10-22T02:00:00.000Z'));`);
  const log = a.run('_trLogRows(TR_UI.accounting)');
  ok('what was typed is shown as text, never markup, and cannot be edited or voided from here', !/<img src=x/.test(log) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(log) && !/data-edit|data-void/.test(log));
  await a.run('_trSave(TR_UI.accounting)');
  a.run('_trSubmitPm(TR_UI.accounting)');
  ok('  and nothing is ever saved or submitted from the director\'s view', !a.run('__posts.some(function (x) { return x.a === "saveProofReport" || x.a === "submitProofReport"; })'));
  const pmRo = a.run('_trPmHtml(TR_UI.accounting, TR_UI.accounting.nums, {})');
  ok('  a 4:30 report not yet in says so, with no Submit', /Not submitted yet/.test(pmRo) && !/data-submitpm|data-blocker/.test(pmRo));
  const pmIn = a.run('_trPmHtml(TR_UI.accounting, TR_UI.accounting.nums, TR_UI.accounting.saved["2026-10-21"])');
  ok('  a submitted one shows its time', /Submitted/.test(pmIn) && !/data-submitpm/.test(pmIn));

  sec('5a · A363: the person\'s own report on their own page');
  const own = await boot('accounting', { own: true });
  const O = (x) => own.run('TR_UI.accounting.' + x);
  ok('their own day: no roster read, no picker, their name in the head', O('own') === true && O('ro') === false && O('person') === R && own.run('__usersRead') === 0 &&
     /<h2>My daily report<\/h2><span class="sr-who">Rojan Leo Francisco<\/span>/.test(own.run('_trHeadHtml(TR_UI.accounting)')) && !/data-person/.test(own.run('_trHeadHtml(TR_UI.accounting)')));
  ok('  their queue and mail are read with their own login', own.run('JSON.stringify(__queueFor[0])') === JSON.stringify({ role: 'accounting', name: R, username: 'acct2' }) &&
     own.run('__mailReads[0].user') === 'acct2');
  const ob = own.run('_trBodyHtml(TR_UI.accounting)');
  ok('  my log with the role\'s line types, and the words for their own report', ['data-new="Collection call"', 'data-new="Bank reconciliation"'].every(s => ob.includes(s)) && !/data-new="Call"/.test(ob) &&
     /Your new daily report\. Only you and the director see it, and your old daily report still works as before\./.test(ob));
  own.run(`TR_UI.accounting.state.lines.push(trNewLine('accounting', { type: 'Other task', what: 'Filed the 2307s' }, 'Rojan Leo Francisco', '2026-10-22T02:00:00.000Z'));`);
  ok('  their own lines can be edited and voided', /data-edit=/.test(own.run('_trLogRows(TR_UI.accounting)')));
  await own.run('_trSave(TR_UI.accounting)');
  const save = own.run('__posts.filter(function (x) { return x.a === "saveProofReport"; })[0]');
  ok('saving sends the kind, the day, the report with whose records, and the numbers', save && save.p.kind === 'accounting' && save.p.date === '2026-10-22' &&
     JSON.parse(save.p.reportJson).person === R && JSON.parse(save.p.portalJson).invoices.text === '2 · ₱150,000', save && save.p);
  own.run('_trSubmitPm(TR_UI.accounting)');
  ok('the 4:30 report needs one line of blocker first', !own.run('__posts.some(function (x) { return x.a === "submitProofReport"; })') && /blocker/.test(own.part('[data-state]').textContent));
  own.el.querySelector('[data-blocker]').value = 'no blocker';
  own.run('_trSubmitPm(TR_UI.accounting)');
  await own.run('TR_UI.accounting.chain');
  const sub = own.run('__posts.filter(function (x) { return x.a === "submitProofReport"; })[0]');
  ok('the 4:30 report submits the numbers once, with whose records they were', sub && sub.p.kind === 'accounting' && JSON.parse(sub.p.snapshotJson).person === R &&
     JSON.parse(sub.p.snapshotJson).paid.text === '1 · ₱75,000' && !!own.run('TR_UI.accounting.saved["2026-10-22"].submittedAt'), sub && sub.p);
  const pm = own.run('_trPmHtml(TR_UI.accounting, TR_UI.accounting.nums, TR_UI.accounting.saved["2026-10-22"])');
  ok('  and afterwards shows them as submitted, with no Submit', /Submitted/.test(pm) && !/data-submitpm/.test(pm) && /Rojan Leo Francisco&#39;s records|Rojan Leo Francisco's records/.test(pm), pm.slice(0, 400));

  a.run('TR_UI.accounting.person = "Someone Else";');
  await a.run('_trOpenDay(TR_UI.accounting, "2026-10-22")');
  ok('choosing another person reads their queue', a.run('__queueFor[__queueFor.length - 1].name') === 'Someone Else');
  await a.run('_trOpenDay(TR_UI.accounting, "2026-10-21")');
  ok('a past day has no live queue and no queue read', !/data-queue/.test(a.run('_trBodyHtml(TR_UI.accounting)')) && a.run('TR_UI.accounting.queue.length') === 0);

  sec('5b · A352: the mail on the page');
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  ok('it reads the chosen person\'s sent mail by their login, for the day', a.run('JSON.stringify(__mailReads[0])') === JSON.stringify({ user: 'acct2', date: '2026-10-22' }));
  const m0 = await boot('accounting', { own: true });
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  const mt = m0.part('[data-tiles="portal"]').innerHTML;
  ok('the collection follow-up and emails-sent tiles come first', mt.indexOf('data-rec="mailCollect"') >= 0 && mt.indexOf('data-rec="mailCollect"') < mt.indexOf('data-rec="invoices"') &&
     /Collection follow-up emails<\/span><span class="v">1<\/span>/.test(mt) && /Emails sent<\/span><span class="v">2<\/span>/.test(mt), mt.slice(0, 500));
  const ml = m0.part('[data-mail]').innerHTML;
  const md = await boot('accounting');
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  ok('A363: on the director\'s view the same list has no buttons', /SOA as of October/.test(md.part('[data-mail]').innerHTML) && !/data-mailmark/.test(md.part('[data-mail]').innerHTML), md.part('[data-mail]').innerHTML.slice(0, 300));
  ok('the mail list on their own page: each email, its tag and why, and a button to correct it', /SOA as of October/.test(ml) && /Collection follow-up<\/span> the subject is about payment/.test(ml) &&
     /data-mailmark="m1">Not a collection follow-up/.test(ml) && /data-mailmark="m2">Count as collection follow-up/.test(ml), ml.slice(0, 800));
  m0.run('_trMailMark(TR_UI.accounting, "m2")');
  await m0.run('TR_UI.accounting.chain');
  const ms = m0.run('__posts.filter(function (x) { return x.a === "saveProofReport"; }).pop()');
  ok('correcting one saves the mark with the report, and the count follows', ms && JSON.parse(ms.p.reportJson).mailMarks.m2 === true &&
     /Collection follow-up emails<\/span><span class="v">2<\/span>/.test(m0.part('[data-tiles="portal"]').innerHTML), ms && ms.p.reportJson);
  const weekReads = m0.run('__mailReads.map(function (r) { return r.date; })').slice().sort();
  ok('the week reads each past day of the week once (Mon–Wed) besides today', JSON.stringify(weekReads) === JSON.stringify(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']), weekReads);
  ok('  and shows the column', /Collection emails/.test(m0.part('[data-weekhead]').innerHTML));
  const ms2 = await boot('accounting', { mail: 'setup' });
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  ok('a mailbox that is not connected says so, and the tiles show "—"', /mailbox is not connected/.test(ms2.part('[data-mail]').innerHTML) && /Collection follow-up emails<\/span><span class="v">—<\/span>/.test(ms2.part('[data-tiles="portal"]').innerHTML));
  const ma = await boot('admin', { own: true, mailToday: [{ messageId: 'q1', subject: 'RFQ: torque wrench', recipient: 'sales@enerpac.com', name: 'Enerpac', sentAt: '2026-10-22T09:00:00+08:00' }] });
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  ok('admin: reads the supplier list; a price request without its PR does not count yet, and nothing offers to type one', ma.run('__reads.map(function (r) { return r.a; })').indexOf('getSuppliers') >= 0 &&
     /Price requests to suppliers<\/span><span class="v">0<\/span>/.test(ma.part('[data-tiles="portal"]').innerHTML) && /1 more waiting for a PR/.test(ma.part('[data-tiles="portal"]').innerHTML) &&
     !/data-new="Price request email"/.test(ma.run('_trBodyHtml(TR_UI.admin)')), ma.part('[data-tiles="portal"]').innerHTML.slice(0, 400));
  const mlA = ma.part('[data-mail]').innerHTML;
  ok('  the email says it needs its PR, and offers Link a PR beside the count button', /Needs its PR to count/.test(mlA) && /data-mailpr="q1">Link a PR</.test(mlA) && /data-mailmark="q1"/.test(mlA), mlA.slice(0, 600));
  const dlgPr = ma.run(`(function () { var h = '', f = null; _trDialog = function (S, t, s, inner, back, onSubmit) { h = inner; f = onSubmit; }; _trMailPrDialog(TR_UI.admin, 'q1', null);
    f({ elements: { pr: { value: 'PR-20' } } }); return h; })()`);
  ok('  Link a PR: the PRs being sourced or priced first, then the last 90 days\'; "No PR" first', /<option value="" selected>No PR<\/option>/.test(dlgPr) && /<optgroup label="Being sourced or priced">/.test(dlgPr), dlgPr.slice(0, 500));
  await ma.run('TR_UI.admin.chain');
  const svPr = ma.run('__posts.filter(function (x) { return x.a === "saveProofReport"; }).pop()');
  ok('  picking one saves it with the report, and the request counts', svPr && JSON.parse(svPr.p.reportJson).mailPrs.q1 === 'PR-20' &&
     /Price requests to suppliers<\/span><span class="v">1<\/span>/.test(ma.part('[data-tiles="portal"]').innerHTML) && /PR <a href="flow-pricing-request\.html\?pr=PR-20">PR-20<\/a>/.test(ma.part('[data-mail]').innerHTML), svPr && svPr.p.reportJson);

  const l = await boot('leadgen');
  const lc = l.run('__reads.filter(function (r) { return r.a === "getLeadgenCounts"; })[0]');
  ok('lead gen reads the server counts for the chosen person and day', lc && lc.p.user === L && lc.p.date === '2026-10-22', lc);
  ok('  and lists the follow-ups due under the queue', /Follow-ups due today/.test(l.part('[data-queue]').innerHTML) && /R\. Cruz, Philcement Corp/.test(l.part('[data-queue]').innerHTML));
  ok('  with this week\'s tiles', /data-rec="w_leads"/.test(l.part('[data-tiles="weekly"]').innerHTML));
  ok('  and no mailbox: no mail section and no mail read', !/data-mail/.test(l.run('_trBodyHtml(TR_UI.leadgen)')) && l.run('__mailReads.length') === 0);

  const ad = await boot('admin');
  ok('admin reads PRs, POs and SOs for its links and the stage limits', ['getPricingRequests', 'getPurchaseOrders', 'getSalesOrders'].every(x => ad.run('__reads.map(function (r) { return r.a; })').indexOf(x) >= 0));
  ok('  and shows PRs past their stage limit today', /data-rec="stuck"/.test(ad.part('[data-tiles="portal"]').innerHTML));
  const dlg = ad.run(`(function () { var h = ''; _trDialog = function (S, t, s, inner) { h = inner; }; _trLineDialog(TR_UI.admin, 'Shipment', null, null); return h; })()`);
  const fillFor = (type, linkIdx) => ad.run(`(function () { var form = null; _trDialog = function (S, t, s, inner, back, onSubmit) { form = onSubmit; }; _trLineDialog(TR_UI.admin, ${JSON.stringify(type)}, null, null);
    var n0 = TR_UI.admin.state.lines.length; form({ elements: { what: { value: '' }, note: { value: 'x' }, link: { value: ${JSON.stringify(linkIdx)} }, result: [] } }); return TR_UI.admin.state.lines[n0].what; })()`);
  eq('  an empty "what" takes the PO\'s supplier on a PO line, but never the PR\'s client on a supplier follow-up', [fillFor('PO status', 'po|PO-7'), fillFor('Supplier follow-up', 'pr|PR-20')], ['Enerpac', '']);
  ok('  a Shipment line: international or local, linked to an open PO, with its results', /<option>International<\/option><option>Local<\/option>/.test(dlg) && /value="po\|PO-7"/.test(dlg) && !/PO-6/.test(dlg) && /value="Cleared"/.test(dlg), dlg.slice(0, 600));

  const old = await boot('accounting', { v179: false, own: true });
  ok('before FlowAPI 179: the store is not read at all (178 would hand back the sales report\'s days)', !old.run('__posts.some(function (x) { return x.a === "getProofReports"; })'));
  await old.run('_trSave(TR_UI.accounting)');
  ok('  nothing is sent to it (178 would replace the sales report of that day), and the page names the update it needs (184 for their own report)', !old.run('__posts.some(function (x) { return /ProofReport/.test(x.a); })') &&
     /184/.test(old.part('[data-state]').textContent) && /version 184/.test(old.run('_trBodyHtml(TR_UI.accounting)')), old.part('[data-state]').textContent);
  const oldD = await boot('accounting', { v179: false });
  ok('  the director\'s view says the saved reports need 184 to be read', /version 184\) before it can be read here/.test(oldD.run('_trBodyHtml(TR_UI.accounting)')));
  ok('  what was typed is kept on this computer', !!old.P.__store['hx_tr_draft:accounting:2026-10-22']);

  sec('6 · the site rules');
  const SRC = fs.readFileSync(path.join(DASH, 'team-report.js'), 'utf8') + fs.readFileSync(path.join(DASH, 'team-report-model.js'), 'utf8');
  const posts = Array.from(new Set((SRC.match(/postFlow\('(\w+)'/g) || []).map(x => x.slice(10, -1)))).sort();
  eq('the only private calls are the store\'s own three', posts, ['getProofReports', 'saveProofReport', 'submitProofReport']);
  const GS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
  const HANDLERS = Object.keys(eval('({' + GS.match(/var HANDLERS = \{([\s\S]*?)\n\};/)[1].replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:\s*\w+/g, ': 1') + '})'));
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/mg, '');
  const named = HANDLERS.filter(h => new RegExp("'" + h + "'").test(code)).sort();
  eq('of ' + HANDLERS.length + ' FlowAPI actions it names only reads and the store', named, ['getARAging', 'getActivityLog', 'getClients', 'getFlowSettings', 'getLeadgen', 'getLeadgenCounts', 'getLeadgenFollowups',
     'getProofReports', 'getPurchaseOrders', 'getPricingRequests', 'getSalesOrders', 'getSuppliers', 'saveProofReport', 'submitProofReport'].sort());
  ok('no emoji, no hex colour, no inline style', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{6}\b/.test(SRC) && !/style="/.test(SRC));
  ok('the sales report is untouched by kind (it still names none)', !/kind:/.test(fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8')));
  ok('a clicked Submit button does not hold the 4:30 card back, in either report (only a field being typed in does)',
     /el\.contains\(a\) && \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(a\.tagName/.test(fs.readFileSync(path.join(DASH, 'sales-report.js'), 'utf8')) &&
     /pm\.contains\(a\) && \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(a\.tagName/.test(fs.readFileSync(path.join(DASH, 'team-report.js'), 'utf8')));

  console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
