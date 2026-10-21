/* A347 — the private store behind the sales daily report (FlowAPI 176: saveProofReport / getProofReports).
 *
 * Run:  node tests/flow/proof-report-store.js
 *
 * Neil, 21 Oct 2026: "save it, but only I can see it, since I'm just testing". So the store is its own tab, both
 * actions are secured, both refuse every role outside FlowSettings 'proofReportRoles' (default director), the name a
 * report is saved under is the one Flask stamps, nothing lands in the ActivityLog, and a read never creates the tab.
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
  ok('getVersion = 176', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 176);
}

sec('2 · the director saves and reads back');
{
  const store = { FlowSettings: [] };
  const c = load(GS, store);
  const r = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT, portalJson: PORTAL }, NEIL));
  ok('saved, numbered PW-', r.success && /^PW-\d{6}-\d{3}$/.test(r.reportNo), r);
  const row = (store.ProofReports || [])[0] || {};
  ok('  one row, under the stamped name and role, the form and the portal snapshot as given', (store.ProofReports || []).length === 1 &&
     row['User'] === 'Neil Estur' && row['Role'] === 'director' && row['Report JSON'] === REPORT && row['Portal JSON'] === PORTAL && row.__arity === 9, row);
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

sec('3 · only the director while it is a trial');
{
  const store = { FlowSettings: [] };
  const c = load(GS, store);
  const asSales = { actorName: 'Gerald Lucena', actorRole: 'sales', actorUsername: 'gerald' };
  const s = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT }, asSales));
  ok('a sales login cannot save', !s.success && /trial/.test(s.message) && !(store.ProofReports || []).length, s);
  call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT }, NEIL));
  ['sales', 'management', 'admin', 'accounting', ''].forEach(role => {
    const g = call(c, 'getProofReports', { actorName: 'X', actorRole: role });
    ok('  nor can ' + (role || 'no role') + ' read it', !g.success && !g.data);
  });
  const direct = c._dispatch({ action: 'getProofReports', actorName: 'Neil Estur', actorRole: 'director' });
  ok('without the app\'s secret even the director\'s read is refused (secured)', !JSON.parse(direct.getContent()).success);
  store.FlowSettings.push({ Key: 'proofReportRoles', Value: 'director, sales', 'Updated By': 'Neil', 'Updated At': '' });
  const later = call(c, 'saveProofReport', Object.assign({ date: '2026-10-20', reportJson: REPORT }, asSales));
  ok('when Neil opens it to sales (FlowSettings proofReportRoles), a rep can save their own', later.success && store.ProofReports.some(r => r['User'] === 'Gerald Lucena'), later);
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

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
