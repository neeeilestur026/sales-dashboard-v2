/* A347 — the private store behind the sales daily report (FlowAPI 176: saveProofReport / getProofReports).
 *
 * Run:  node tests/flow/proof-report-store.js
 *
 * Neil, 21 Oct 2026: "save it, but only I can see it, since I'm just testing". A348 (FlowAPI 177) adds the 4:30 submit with
 * its numbers fixed, the 8:00 time stamped by the server, and keeps a day the A347 form saved. So the store is its own tab, both
 * actions are secured, both refuse every role outside FlowSettings 'proofReportRoles' (default director), the name a
 * report is saved under is the one Flask stamps, nothing lands in the ActivityLog, and a read never creates the tab.
 * A351 (FlowAPI 179) adds Kind: the accounting, lead gen and admin reports keep their own row per day; a blank Kind is
 * the sales report, so the sales report and the Client Book read exactly what they read before.
 * Runs the real FlowAPI.gs through its dispatcher (gasload), so the secret and the lock are under test too.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');

const NEIL = { actorName: 'Neil Estur', actorRole: 'director', actorUsername: 'neil' };
const REPORT = JSON.stringify({ v: 1, huddle: { booked: { n: '2', proof: 'Plant A accepted the invite' }, plan: 'Plant A 10:00', blocker: 'no blocker' },
                                log: [{ time: '10:15', type: 'Visit', what: 'Plant A, R. Cruz', result: 'RFQ promised 29 Oct', ref: 'Recap email 27 Oct' }] });
const PORTAL = JSON.stringify({ followDue: '3', openQuotes: '₱3.8M' });

sec('1 · the version');
{
  const c = load(GS, {});
  ok('getVersion = 188', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 188);
}

sec('2 · the director saves and reads back');
{
  const store = { FlowSettings: [] };
  const c = load(GS, store);
  const r = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT, portalJson: PORTAL }, NEIL));
  ok('saved, numbered PW-', r.success && /^PW-\d{6}-\d{3}$/.test(r.reportNo), r);
  const row = (store.ProofReports || [])[0] || {};
  ok('  one row, under the stamped name and role, the form and the portal snapshot as given', (store.ProofReports || []).length === 1 &&
     row['User'] === 'Neil Estur' && row['Role'] === 'director' && row['Report JSON'] === REPORT && row['Portal JSON'] === PORTAL && row.__arity === 12, row);
  const again = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT.replace('Plant A 10:00', 'Plant A 9:00'), portalJson: PORTAL }, NEIL));
  ok('saving the same day again replaces it (one row, count 2, same number)', again.success && again.saveCount === 2 && again.reportNo === r.reportNo &&
     store.ProofReports.length === 1 && /Plant A 9:00/.test(store.ProofReports[0]['Report JSON']), again);
  call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: REPORT, portalJson: '{}' }, NEIL));
  const g = call(c, 'getProofReports', Object.assign({ from: '2026-10-19', to: '2026-10-23' }, NEIL));
  ok('read back newest first, the form parsed', g.success && g.data.length === 2 && g.data[0].date === '2026-10-21' && g.data[1].report.huddle.plan === 'Plant A 9:00', g);
  const one = call(c, 'getProofReports', Object.assign({ from: '2026-10-20', to: '2026-10-20' }, NEIL));
  ok('  a date range narrows it', one.success && one.data.length === 1 && one.data[0].saveCount === 2);
  ok('nothing written to the ActivityLog', !(store.ActivityLog || []).length);
}

sec('3 · A363: each person their own report; the director reads them all');
{
  const store = { FlowSettings: [] };
  const c = load(GS, store);
  const asSales = { actorName: 'Gerald Lucena', actorRole: 'sales', actorUsername: 'gerald' }, asKim = { actorName: 'Kim Reyes', actorRole: 'sales', actorUsername: 'kim' };
  const asAcct = { actorName: 'Rojan Leo Francisco', actorRole: 'accounting', actorUsername: 'acct2' };
  const s = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT }, asSales));
  ok('a rep saves their own sales report, under the name Flask stamps', s.success && s.user === 'Gerald Lucena' && s.kind === 'sales' && store.ProofReports.length === 1 && store.ProofReports[0]['User'] === 'Gerald Lucena', s);
  const wrong = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', kind: 'accounting', reportJson: REPORT }, asSales));
  ok('  but not another kind', !wrong.success && /Your daily report is the sales one/.test(wrong.message) && store.ProofReports.length === 1, wrong);
  call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT }, NEIL));
  call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', kind: 'accounting', reportJson: REPORT }, asAcct));
  const mine = call(c, 'getProofReports', asSales), peek = call(c, 'getProofReports', Object.assign({ user: 'Neil Estur' }, asSales));
  ok('  and reads only their own — asking for someone else\'s changes nothing', mine.success && mine.data.length === 1 && mine.data[0].user === 'Gerald Lucena' && peek.data.length === 1 && peek.data[0].user === 'Gerald Lucena', [mine, peek]);
  ok('  another rep reads none of it', call(c, 'getProofReports', asKim).data.length === 0);
  const acct = call(c, 'getProofReports', Object.assign({ kind: 'accounting' }, asAcct)), acctSales = call(c, 'getProofReports', asAcct);
  ok('accounting saves and reads its own accounting report, and cannot read the sales ones', acct.success && acct.data.length === 1 && acct.data[0].user === 'Rojan Leo Francisco' &&
     !acctSales.success && /Your daily report is the accounting one/.test(acctSales.message), [acct, acctSales]);
  const all = call(c, 'getProofReports', NEIL), one = call(c, 'getProofReports', Object.assign({ user: 'gerald lucena' }, NEIL));
  ok('the director reads every report of a kind, and can narrow it to one person', all.data.length === 2 && one.data.length === 1 && one.data[0].user === 'Gerald Lucena', [all.data.length, one.data.length]);
  ['hr', 'marketing', ''].forEach(role => {
    const g = call(c, 'getProofReports', { actorName: 'X', actorRole: role }), w = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT }, { actorName: 'X', actorRole: role }));
    ok('  ' + (role || 'no role') + ' has no report: no read, no save', !g.success && !g.data && !w.success);
  });
  const MG = { actorName: 'Mara Manager', actorRole: 'management' };
  const mgSales = call(c, 'getProofReports', MG), mgAcct = call(c, 'getProofReports', Object.assign({ kind: 'accounting' }, MG));
  const mgAll = call(c, 'getProofReports', Object.assign({ kind: 'all' }, MG)), mgOne = call(c, 'getProofReports', Object.assign({ kind: 'all', user: 'rojan leo francisco' }, MG));
  ok('A366: management reads every person\'s report of any kind (read only)', mgSales.success && mgSales.data.length === 2 && mgAcct.success && mgAcct.data.length === 1 && mgAcct.data[0].user === 'Rojan Leo Francisco', [mgSales, mgAcct]);
  ok('  kind "all" reads every kind at once, each row with its kind; user narrows it', mgAll.data.length === 3 && mgAll.data.some(r => r.kind === 'accounting') && mgAll.data.some(r => r.kind === 'sales') &&
     mgOne.data.length === 1 && mgOne.data[0].user === 'Rojan Leo Francisco', [mgAll.data.length, mgOne.data.length]);
  const mgSave = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT }, MG)), mgSub = call(c, 'submitProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT, snapshotJson: '{"calls":1}' }, MG));
  ok('  but never saves or submits one (it has no report of its own)', !mgSave.success && !mgSub.success && /no daily report for your role/.test(mgSave.message), [mgSave, mgSub]);
  ok('  "all" is only for the readers: a rep asking for it is refused', !call(c, 'getProofReports', Object.assign({ kind: 'all' }, asSales)).success);
  ok('  nothing was written by them', store.ProofReports.length === 3);
  const direct = c._dispatch({ action: 'getProofReports', actorName: 'Neil Estur', actorRole: 'director' });
  ok('without the app\'s secret even the director\'s read is refused (secured)', !JSON.parse(direct.getContent()).success);
  store.FlowSettings.push({ Key: 'proofReportRoles', Value: 'director, sales', 'Updated By': 'Neil', 'Updated At': '' });
  const outMg = call(c, 'getProofReports', { actorName: 'M', actorRole: 'management' });
  ok('FlowSettings proofReportRoles can still narrow it: a list without management refuses it', !outMg.success && /trial/.test(outMg.message), outMg);
  store.FlowSettings[store.FlowSettings.length - 1].Value = 'director, management';
  const narrowed = call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: REPORT }, asSales)), mg = call(c, 'getProofReports', { actorName: 'M', actorRole: 'management' });
  ok('  and a list naming management lets it read, while a rep left out is refused', !narrowed.success && /trial/.test(narrowed.message) && mg.success, [narrowed, mg]);
}

sec('4 · what it refuses');
{
  const store = {};
  const c = load(GS, store);
  const bad = (label, params, re) => { const r = call(c, 'saveProofReport', Object.assign({ reportJson: REPORT }, NEIL, params)); ok(label, !r.success && re.test(r.message), r); };
  bad('no date', { date: '' }, /date/);
  bad('a date in the wrong shape', { date: '20/10/2026' }, /date/);
  bad('a day that has not come yet', { date: '2099-01-01' }, /not come/);
  bad('a report that is not JSON', { date: '2026-10-20', reportJson: '{oops' }, /not a valid report/);
  bad('a list instead of a report', { date: '2026-10-20', reportJson: '[1,2]' }, /not a valid report/);
  bad('a report over 40,000 characters', { date: '2026-10-20', reportJson: JSON.stringify({ x: 'y'.repeat(40001) }) }, /too long/);
  const nameless = call(c, 'saveProofReport', { date: '2026-10-20', reportJson: REPORT, actorRole: 'director', actorName: '' });
  ok('no stamped name, no save', !nameless.success && /Sign in/.test(nameless.message));
  ok('nothing was written by any of them', !(store.ProofReports || []).length);
  const empty = call(c, 'getProofReports', NEIL);
  ok('a read before anything is saved answers empty and does not create the tab', empty.success && empty.data.length === 0 && !('ProofReports' in store), empty);
}

sec('5 · A348: the 8:00 time is the server\'s, stamped once');
{
  const store = {};
  const c = load(GS, store);
  const v2 = (o) => JSON.stringify(Object.assign({ v: 2, dayType: 'desk', am: { plan: 'Calls to 20 plants' }, pm: { blocker: '' }, lines: [] }, o || {}));
  const s1 = call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: v2({ am: { plan: 'x', givenAt: '2026-10-21T00:00:00.000Z' } }) }, NEIL));
  ok('a time the page sends is not taken: no 8:00 report given yet', s1.success && JSON.parse(store.ProofReports[0]['Report JSON']).am.givenAt === '', store.ProofReports[0]);
  const s2 = call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: v2(), giveAm: true }, NEIL));
  const given = JSON.parse(store.ProofReports[0]['Report JSON']).am.givenAt;
  ok('giving the 8:00 report stamps the server time', s2.success && /^\d{4}-\d{2}-\d{2}T/.test(given) && s2.givenAt === given, s2);
  call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: v2({ am: { plan: 'changed', givenAt: '' } }), giveAm: true }, NEIL));
  const after = JSON.parse(store.ProofReports[0]['Report JSON']).am;
  ok('  once: a later save (even with giveAm, even sending a blank time) keeps the first stamp', after.givenAt === given && after.plan === 'changed', after);
}

sec('6 · A348: the 4:30 report is submitted once, its numbers fixed');
{
  const store = {};
  const c = load(GS, store);
  const v2 = (lines) => JSON.stringify({ v: 2, dayType: 'desk', am: {}, pm: { blocker: 'no blocker' }, lines: lines || [] });
  const SNAP = JSON.stringify({ emailsSent: 42, callsLogged: 16, followUps: '3 of 3' });
  const nope = call(c, 'submitProofReport', Object.assign({ date: '2026-10-21', reportJson: v2(), snapshotJson: '{}' }, NEIL));
  ok('a submit with no numbers is refused', !nope.success && /no numbers/.test(nope.message));
  const sub = call(c, 'submitProofReport', Object.assign({ date: '2026-10-21', reportJson: v2([{ id: 'L1', type: 'Call', note: 'first' }]), snapshotJson: SNAP }, NEIL));
  const row = store.ProofReports[0];
  ok('submitted: the report saved, the numbers and the time fixed', sub.success && row['Snapshot JSON'] === SNAP && !!row['Submitted At'] && /^\d{4}-/.test(sub.submittedAt) && row.__arity === 12, sub);
  const at = row['Submitted At'];
  const later = call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: v2([{ id: 'L1', type: 'Call', note: 'edited after' }]) }, NEIL));
  ok('editing a line afterwards saves the line and leaves the snapshot and its time alone', later.success && store.ProofReports[0]['Snapshot JSON'] === SNAP &&
     store.ProofReports[0]['Submitted At'] === at && /edited after/.test(store.ProofReports[0]['Report JSON']), store.ProofReports[0]);
  const again = call(c, 'submitProofReport', Object.assign({ date: '2026-10-21', reportJson: v2(), snapshotJson: JSON.stringify({ emailsSent: 99 }) }, NEIL));
  ok('a second submit is refused and changes nothing', !again.success && again.alreadySubmitted && /already submitted/.test(again.message) && store.ProofReports[0]['Snapshot JSON'] === SNAP, again);
  const g = call(c, 'getProofReports', NEIL);
  ok('the read returns the submitted time and the fixed numbers', g.success && g.data[0].submittedAt && g.data[0].snapshot && g.data[0].snapshot.callsLogged === 16, g.data[0]);
  const asSales = call(c, 'submitProofReport', Object.assign({ date: '2026-10-21', reportJson: v2(), snapshotJson: SNAP }, { actorName: 'Gerald Lucena', actorRole: 'sales' }));
  ok('A363: a rep submits their own 4:30 report; the director\'s stays as it was', asSales.success && store.ProofReports.length === 2 && store.ProofReports[1]['User'] === 'Gerald Lucena' &&
     store.ProofReports[0]['Snapshot JSON'] === SNAP && store.ProofReports[0]['User'] === 'Neil Estur', asSales);
}

sec('7 · A348: a day saved by the A347 form is kept, not lost');
{
  const store = {};
  const c = load(GS, store);
  call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: REPORT }, NEIL));            // the A347 shape (no v)
  call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: JSON.stringify({ v: 2, am: {}, lines: [] }) }, NEIL));
  const kept = JSON.parse(store.ProofReports[0]['Report JSON']);
  ok('the old form\'s content is kept under legacy', kept.v === 2 && kept.legacy && kept.legacy.huddle.plan === 'Plant A 10:00', kept);
  call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: JSON.stringify({ v: 2, am: {}, lines: [] }) }, NEIL));
  ok('  and stays there when the page saves again without it', JSON.parse(store.ProofReports[0]['Report JSON']).legacy.huddle.plan === 'Plant A 10:00');
}

sec('8 · A351: one row per person per day per kind; a blank Kind is the sales report');
{
  const store = {};
  const c = load(GS, store);
  const rep = (kind, note) => JSON.stringify({ v: 1, kind, person: 'Rojan Leo Francisco', lines: [{ id: 'L1', type: 'Other task', note }], pm: { blocker: '' } });
  const sales = call(c, 'saveProofReport', Object.assign({ date: '2026-10-22', reportJson: JSON.stringify({ v: 2, am: {}, lines: [] }) }, NEIL));
  const acct = call(c, 'saveProofReport', Object.assign({ date: '2026-10-22', kind: 'accounting', reportJson: rep('accounting', 'bank rec') }, NEIL));
  const lg = call(c, 'saveProofReport', Object.assign({ date: '2026-10-22', kind: 'leadgen', reportJson: rep('leadgen', 'accreditation docs') }, NEIL));
  const adm = call(c, 'saveProofReport', Object.assign({ date: '2026-10-22', kind: 'admin', reportJson: rep('admin', 'PO status') }, NEIL));
  const rows = store.ProofReports || [];
  ok('four reports on one day are four rows, each with its own number', [sales, acct, lg, adm].every(x => x.success) && rows.length === 4 &&
     new Set(rows.map(r => r['Report No'])).size === 4, rows.map(r => [r['Report No'], r['Kind']]));
  ok('  the sales row keeps a blank Kind; the others name theirs; every write is 12 wide', rows.map(r => r['Kind']).join() === ',accounting,leadgen,admin' && rows.every(r => r.__arity === 12), rows.map(r => r.__arity));
  ok('  the answers say which kind was saved', sales.kind === 'sales' && acct.kind === 'accounting' && adm.kind === 'admin');
  const again = call(c, 'saveProofReport', Object.assign({ date: '2026-10-22', kind: 'accounting', reportJson: rep('accounting', 'bank rec, balanced') }, NEIL));
  ok('saving the accounting report again replaces only that row', again.success && again.saveCount === 2 && again.reportNo === acct.reportNo && store.ProofReports.length === 4 &&
     /balanced/.test(store.ProofReports[1]['Report JSON']) && !/balanced/.test(store.ProofReports[0]['Report JSON']));
  const g0 = call(c, 'getProofReports', NEIL), gA = call(c, 'getProofReports', Object.assign({ kind: 'accounting' }, NEIL)), gL = call(c, 'getProofReports', Object.assign({ kind: 'LeadGen' }, NEIL));
  ok('a read that names no kind returns the sales report only (the sales report and the Client Book see what they saw)', g0.success && g0.data.length === 1 && g0.data[0].kind === 'sales' && g0.data[0].report.v === 2, g0.data.map(x => x.kind));
  ok('  a read for a kind returns that kind only, in any case', gA.data.length === 1 && gA.data[0].kind === 'accounting' && gA.data[0].report.person === 'Rojan Leo Francisco' &&
     gL.data.length === 1 && gL.data[0].kind === 'leadgen', [gA.data.length, gL.data.length]);
  const subA = call(c, 'submitProofReport', Object.assign({ date: '2026-10-22', kind: 'accounting', reportJson: rep('accounting', 'x'), snapshotJson: JSON.stringify({ invoices: { text: '2' } }) }, NEIL));
  const subS = call(c, 'submitProofReport', Object.assign({ date: '2026-10-22', reportJson: JSON.stringify({ v: 2, am: {}, lines: [] }), snapshotJson: JSON.stringify({ calls: { text: '3' } }) }, NEIL));
  ok('submitting the accounting 4:30 report leaves the sales one free to submit', subA.success && subS.success && !!store.ProofReports[1]['Submitted At'] && !!store.ProofReports[0]['Submitted At'] &&
     /invoices/.test(store.ProofReports[1]['Snapshot JSON']) && /calls/.test(store.ProofReports[0]['Snapshot JSON']));
  const bad = call(c, 'saveProofReport', Object.assign({ date: '2026-10-22', kind: 'payroll', reportJson: rep('payroll', 'x') }, NEIL));
  const badRead = call(c, 'getProofReports', Object.assign({ kind: 'payroll' }, NEIL));
  ok('an unknown kind is refused, to save and to read', !bad.success && /one of: sales, accounting, leadgen, admin/.test(bad.message) && !badRead.success && store.ProofReports.length === 4, bad);
  const rep2 = call(c, 'saveProofReport', Object.assign({ date: '2026-10-22', kind: 'admin', reportJson: rep('admin', 'x') }, { actorName: 'Ana Admin', actorRole: 'admin' }));
  const read2 = call(c, 'getProofReports', Object.assign({ kind: 'admin' }, { actorName: 'Ana Admin', actorRole: 'admin' }));
  ok('A363: an admin saves and reads only their own admin report', rep2.success && read2.success && read2.data.length === 1 && read2.data[0].user === 'Ana Admin' && store.ProofReports.length === 5, [rep2, read2]);
  ok('nothing lands in the ActivityLog', !(store.ActivityLog || []).length);
}
{
  const store = { ProofReports: [{ 'Report No': 'PW-202610-001', 'Date': '2026-10-21', 'User': 'Neil Estur', 'Role': 'director', 'Report JSON': JSON.stringify({ v: 2, am: {}, lines: [] }),
                                   'Portal JSON': '{}', 'Created At': '2026-10-21T01:00:00.000Z', 'Updated At': '2026-10-21T01:00:00.000Z', 'Save Count': 1, 'Submitted At': '', 'Snapshot JSON': '' }] };
  const c = load(GS, store);
  const g = call(c, 'getProofReports', NEIL);
  ok('a row saved before 179 (no Kind at all) reads as the sales report', g.success && g.data.length === 1 && g.data[0].kind === 'sales' && g.data[0].reportNo === 'PW-202610-001', g.data);
  const s2 = call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', reportJson: JSON.stringify({ v: 2, am: {}, lines: [{ id: 'L9', type: 'Call', note: 'later' }] }) }, NEIL));
  ok('  and saving the sales day again replaces it, not a second row', s2.success && s2.reportNo === 'PW-202610-001' && store.ProofReports.length === 1 && store.ProofReports[0]['Kind'] === '', store.ProofReports.length);
  const a2 = call(c, 'saveProofReport', Object.assign({ date: '2026-10-21', kind: 'admin', reportJson: JSON.stringify({ v: 1, kind: 'admin', lines: [] }) }, NEIL));
  ok('  while an admin report that day is a row of its own', a2.success && a2.reportNo !== 'PW-202610-001' && store.ProofReports.length === 2);
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
