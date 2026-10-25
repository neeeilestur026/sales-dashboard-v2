/* A369 — client visits, the new itinerary (FlowAPI 186: getVisitPlans / saveVisitPlan / submitVisitPlans /
 * decideVisitPlans / cancelVisitPlan / markVisitPlanDone, and the travel week they let through).
 *
 * Run:  node tests/flow/visit-plans-store.js
 *
 * Neil, 25 Oct 2026: each sales rep plans visits to their own Client Book clients and picks who to visit; the
 * director approves first; accounting sees the approved visits with an estimated travel allowance for the day, its
 * formula "set aside first". So the store is its own two tabs; a rep reads and writes only their own visits, the
 * director decides, management reads, accounting reads only what was approved; every refusal writes nothing; every
 * change is one VisitPlanLog row; the two estimate columns stay blank; nothing goes to the ActivityLog.
 * Runs the real FlowAPI.gs through its dispatcher (gasload), so the secret and the lock are under test too.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const NEIL = { actorName: 'Neil Estur', actorRole: 'director', actorUsername: 'neil' };
const GERALD = { actorName: 'Gerald Lucena', actorRole: 'sales', actorUsername: 'sales2' };
const KIM = { actorName: 'Kim Reyes', actorRole: 'sales', actorUsername: 'kim' };
const ACCT = { actorName: 'Ana Acct', actorRole: 'accounting', actorUsername: 'acct' };
const MGMT = { actorName: 'Mia Mgmt', actorRole: 'management', actorUsername: 'mgmt' };
const CONTACTS = JSON.stringify([
  { id: 'P1', name: 'R. Cruz', position: 'Maintenance planner', emails: ['rcruz@plant-a.ph'], phones: ['0917 123 4567'] },
  { id: 'P2', name: 'M. Santos', position: 'Buyer', emails: ['buyer@plant-a.ph'], phones: [] }]);

/** A store with Gerald's two clients (one with only a plant address) and one of Kim's, one archived. */
function setup() {
  const store = {};
  const c = load(GS, store);
  const add = (o) => call(c, 'saveClientBookClient', Object.assign({ tier: 'Major', sector: 'Cement', contactsJson: CONTACTS }, o, NEIL)).clientNo;
  const ids = {
    both: add({ company: 'Both Plant Co', owner: 'Gerald Lucena', siteAddress: 'Brgy. Bigte, Norzagaray, Bulacan', headOfficeAddress: '12F Tower, Ortigas, Pasig' }),
    plant: add({ company: 'Plant Only Co', owner: 'Gerald Lucena', siteAddress: 'Limay, Bataan' }),
    kim: add({ company: 'Kim Client Co', owner: 'Kim Reyes', siteAddress: 'Calaca, Batangas' }),
    gone: add({ company: 'Gone Co', owner: 'Gerald Lucena', siteAddress: 'Somewhere' })
  };
  call(c, 'archiveClientBookClient', Object.assign({ clientNo: ids.gone, reason: 'closed' }, NEIL));
  const today = c._fieldToday();
  const day = (n) => c._vpAddDays(today, n);
  const snap = () => JSON.stringify([store.VisitPlans || [], store.VisitPlanLog || []]);
  return { c, store, ids, today, day, snap };
}

sec('1 · the version, the roles, and a read of nothing');
{
  const { c, store } = setup();
  ok('getVersion = 186', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 186);
  const g = call(c, 'getVisitPlans', GERALD);
  ok('a read of no visits answers empty, creates no tab, and gives the lists', g.success && g.data.length === 0 && !('VisitPlans' in store) && !('VisitPlanLog' in store) &&
     g.lists.statuses.join() === 'Draft,Pending Director,Approved,Done,Rejected,Cancelled' && g.lists.locations.join() === 'Plant,Head office,Other' && g.lists.ahead === 92 && !!g.today, g);
  ['admin', 'leadgen', 'hr', ''].forEach(role => {
    const r = call(c, 'getVisitPlans', { actorName: 'X', actorRole: role });
    ok('  ' + (role || 'no role') + ' is refused', !r.success && /sales, the director, accounting and management/.test(r.message), r);
  });
  ok('  and a read with no name is refused', !call(c, 'getVisitPlans', { actorRole: 'sales' }).success);
  const sec1 = call(c, 'getVisitPlans', Object.assign({ flowSecret: '' }, GERALD));
  ok('  every action is secured: no secret, no read', !sec1.success, sec1);
}

sec('2 · a rep plans a visit');
{
  const { c, store, ids, day } = setup();
  const r = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(2), time: '09:30', location: 'Plant', contactIds: '["P1","P2"]', purpose: 'Hose audit' }, GERALD));
  const row = (store.VisitPlans || [])[0] || {};
  ok('saved as a draft, numbered VP-, 28 wide', r.success && /^VP-\d{6}-\d{3}$/.test(r.visitPlanNo) && row['Status'] === 'Draft' && row.__arity === 28 && r.status === 'Draft', r);
  ok('  the client, the day and time, and the plant address copied from the Client Book', row['Client No'] === ids.both && row['Company'] === 'Both Plant Co' && row['Date'] === day(2) &&
     row['Time'] === '09:30' && row['Location'] === 'Plant' && row['Address'] === 'Brgy. Bigte, Norzagaray, Bulacan' && row['User'] === 'Gerald Lucena', row);
  const people = JSON.parse(row['Contacts JSON']);
  ok('  the people kept as name and position only — no emails, no phones', people.length === 2 && people[0].name === 'R. Cruz' && people[1].position === 'Buyer' &&
     !/@|0917/.test(row['Contacts JSON']), people);
  ok('  the two estimate columns are blank', row['Travel Estimate (PHP)'] === '' && row['Travel Estimate Basis'] === '' && r.plan.travelEstimate === null);
  ok('  one log row, 8 wide: created', store.VisitPlanLog.length === 1 && store.VisitPlanLog[0]['Kind'] === 'created' && store.VisitPlanLog[0].__arity === 8 &&
     /^VPL-/.test(store.VisitPlanLog[0]['Log No']));
  ok('  nothing goes to the ActivityLog, and the Client Book is not written', !(store.ActivityLog || []).length && store.ClientBook.every(x => x.__arity === 27));
  const h = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(3), location: 'head office', contactIds: '[]', someoneElse: 'The plant manager', send: true }, GERALD));
  const hr = store.VisitPlans[1];
  ok('the head office, someone else, no time, sent straight to the director', h.success && hr['Location'] === 'Head office' && hr['Address'] === '12F Tower, Ortigas, Pasig' &&
     hr['Someone Else'] === 'The plant manager' && hr['Time'] === '' && hr['Status'] === 'Pending Director' && !!hr['Submitted At'] && h.message === 'Sent to the director.', hr);
  const o = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.plant, date: day(0), location: 'Other', address: 'Warehouse 3, Mariveles', contactIds: '["P2"]' }, GERALD));
  ok('Other: the address typed, today allowed', o.success && store.VisitPlans[2]['Address'] === 'Warehouse 3, Mariveles' && store.VisitPlans[2]['Date'] === day(0));
  ok('the Time column is kept as text', c._TEXT_COLS.VisitPlans.join() === 'Time');
}

sec('3 · what saveVisitPlan refuses — and writes nothing');
{
  const { c, store, ids, day, snap } = setup();
  call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(5), location: 'Plant', contactIds: '["P1"]' }, GERALD));
  const before = snap();
  const base = { clientNo: ids.both, date: day(6), location: 'Plant', contactIds: '["P1"]' };
  const cases = [
    ['the director does not plan visits', Object.assign({}, base, NEIL), /Only a sales rep/],
    ['accounting does not plan visits', Object.assign({}, base, ACCT), /Only a sales rep/],
    ['another rep\'s client', Object.assign({}, base, { clientNo: ids.kim }, GERALD), /not in your Client Book/],
    ['an archived client', Object.assign({}, base, { clientNo: ids.gone }, GERALD), /live client/],
    ['no client', Object.assign({}, base, { clientNo: '' }, GERALD), /live client/],
    ['a day that has passed', Object.assign({}, base, { date: day(-1) }, GERALD), /has passed/],
    ['more than 92 days ahead', Object.assign({}, base, { date: day(93) }, GERALD), /up to 92 days ahead/],
    ['no day', Object.assign({}, base, { date: '25/10/2026' }, GERALD), /Choose the day/],
    ['a time not like 09:30', Object.assign({}, base, { time: '9.30am' }, GERALD), /like 09:30/],
    ['a place not on the list', Object.assign({}, base, { location: 'Office' }, GERALD), /Say where/],
    ['the head office when the client has none', Object.assign({}, base, { clientNo: ids.plant, location: 'Head office' }, GERALD), /no head office address in the Client Book/],
    ['Other with no address', Object.assign({}, base, { location: 'Other', address: '  ' }, GERALD), /Type the address/],
    ['a person not among the client\'s contacts', Object.assign({}, base, { contactIds: '["P9"]' }, GERALD), /no longer among this client's contacts/],
    ['nobody to visit', Object.assign({}, base, { contactIds: '[]', someoneElse: '' }, GERALD), /Choose who you will visit/],
    ['contacts that cannot be read', Object.assign({}, base, { contactIds: '{bad' }, GERALD), /could not be read/],
    ['the same client on the same day twice', Object.assign({}, base, { date: day(5) }, GERALD), /already have a visit to Both Plant Co that day/],
  ];
  cases.forEach(([label, params, re]) => {
    const r = call(c, 'saveVisitPlan', params);
    ok(label, !r.success && re.test(r.message || ''), r);
  });
  ok('  and not one of them wrote a row or a log line', snap() === before);
  const dup = call(c, 'saveVisitPlan', Object.assign({}, base, { date: day(5) }, GERALD));
  ok('  the duplicate names the visit already there', dup.duplicate === store.VisitPlans[0]['Visit Plan No']);
  const kimEdit = call(c, 'saveVisitPlan', Object.assign({}, base, { visitPlanNo: store.VisitPlans[0]['Visit Plan No'], clientNo: ids.kim }, KIM));
  ok('another rep cannot edit Gerald\'s visit', !kimEdit.success && /not yours/.test(kimEdit.message) && snap() === before, kimEdit);
  const ghost = call(c, 'saveVisitPlan', Object.assign({}, base, { visitPlanNo: 'VP-000000-999' }, GERALD));
  ok('a visit that does not exist', !ghost.success && /was not found/.test(ghost.message));
}

sec('4 · who reads what');
{
  const { c, store, ids, day } = setup();
  const g1 = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(1), location: 'Plant', contactIds: '["P1"]', send: true }, GERALD)).visitPlanNo;
  const g2 = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.plant, date: day(2), location: 'Plant', contactIds: '["P1"]' }, GERALD)).visitPlanNo;
  const k1 = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.kim, date: day(1), location: 'Plant', contactIds: '["P2"]', send: true }, KIM)).visitPlanNo;
  call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([g1]), decision: 'approve' }, NEIL));
  const nos = (who, extra) => call(c, 'getVisitPlans', Object.assign({}, extra || {}, who)).data.map(v => v.visitPlanNo).sort();
  ok('a rep reads only their own visits', nos(GERALD).join() === [g1, g2].sort().join() && nos(KIM).join() === k1, [nos(GERALD), nos(KIM)]);
  ok('  even when they ask for someone else', nos(GERALD, { user: 'Kim Reyes' }).join() === [g1, g2].sort().join());
  ok('the director and management read every visit', nos(NEIL).length === 3 && nos(MGMT).length === 3);
  ok('accounting reads only the approved one', nos(ACCT).join() === g1, nos(ACCT));
  const a = call(c, 'getVisitPlans', ACCT);
  ok('  and gets no log; the others get theirs', a.log.length === 0 && call(c, 'getVisitPlans', GERALD).log.length >= 2 && call(c, 'getVisitPlans', NEIL).log.length >= 4);
  ok('  the people come as name and position', a.data[0].contacts[0].name === 'R. Cruz' && a.data[0].contacts[0].emails === undefined);
  ok('a date range narrows it', nos(NEIL, { from: day(2), to: day(2) }).join() === g2 && nos(NEIL, { from: day(1), to: day(1) }).length === 2);
  ok('management cannot write anything', ['saveVisitPlan', 'submitVisitPlans', 'decideVisitPlans', 'cancelVisitPlan', 'markVisitPlanDone'].every(a =>
     !call(c, a, Object.assign({ visitPlanNo: g2, visitPlanNos: JSON.stringify([g2]), decision: 'approve', reason: 'x', result: 'x', clientNo: ids.both, date: day(9), location: 'Plant', contactIds: '["P1"]' }, MGMT)).success));
  ok('  nor accounting', ['saveVisitPlan', 'submitVisitPlans', 'decideVisitPlans', 'cancelVisitPlan', 'markVisitPlanDone'].every(a =>
     !call(c, a, Object.assign({ visitPlanNo: g2, visitPlanNos: JSON.stringify([g2]), decision: 'approve', reason: 'x', result: 'x', clientNo: ids.both, date: day(9), location: 'Plant', contactIds: '["P1"]' }, ACCT)).success) &&
     store.VisitPlans.find(v => v['Visit Plan No'] === g2)['Status'] === 'Draft');
}

sec('5 · sending, and the director deciding — all or none');
{
  const { c, store, ids, day, snap } = setup();
  const d1 = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(1), location: 'Plant', contactIds: '["P1"]' }, GERALD)).visitPlanNo;
  const d2 = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.plant, date: day(1), location: 'Plant', contactIds: '["P2"]' }, GERALD)).visitPlanNo;
  const k1 = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.kim, date: day(1), location: 'Plant', contactIds: '["P2"]' }, KIM)).visitPlanNo;
  const by = (no) => store.VisitPlans.find(v => v['Visit Plan No'] === no);
  let before = snap();
  const mixed = call(c, 'submitVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d1, k1]) }, GERALD));
  ok('sending a list with another rep\'s visit sends none of them', !mixed.success && /not yours\. Nothing was sent/.test(mixed.message) && snap() === before, mixed);
  ok('  the director does not send a rep\'s visits', !call(c, 'submitVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d1]) }, NEIL)).success && snap() === before);
  const s = call(c, 'submitVisitPlans', Object.assign({ visitPlanNos: d1 + ', ' + d2 }, GERALD));
  ok('two drafts sent at once (a comma list works too)', s.success && s.sent === 2 && by(d1)['Status'] === 'Pending Director' && by(d2)['Status'] === 'Pending Director' && !!by(d1)['Submitted At'], s);
  before = snap();
  ok('  sending again is refused (already with the director)', !call(c, 'submitVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d1]) }, GERALD)).success && snap() === before);
  ok('a rep cannot decide', !call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d1]), decision: 'approve' }, GERALD)).success && snap() === before);
  const noNote = call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d1]), decision: 'reject', note: '  ' }, NEIL));
  ok('sending back needs a note', !noNote.success && /Say why/.test(noNote.message) && snap() === before, noNote);
  const notWaiting = call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d1, k1]), decision: 'approve' }, NEIL));
  ok('a list holding a draft approves none of them', !notWaiting.success && /not waiting for you\. Nothing was changed/.test(notWaiting.message) && snap() === before, notWaiting);
  const ap = call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d1]), decision: 'approve' }, NEIL));
  ok('approved: the status, the decision, who and when', ap.success && by(d1)['Status'] === 'Approved' && by(d1)['Decision'] === 'Approved' && by(d1)['Decided By'] === 'Neil Estur' && !!by(d1)['Decided At'], by(d1));
  const rj = call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d2]), decision: 'reject', note: 'Go on Thursday with the CEJN demo' }, NEIL));
  ok('sent back with the note', rj.success && by(d2)['Status'] === 'Rejected' && by(d2)['Decision Note'] === 'Go on Thursday with the CEJN demo', by(d2));
  ok('  each decision is one log row', store.VisitPlanLog.filter(l => l['Kind'] === 'approved').length === 1 && store.VisitPlanLog.filter(l => l['Kind'] === 'sent back' && l['Note'] === 'Go on Thursday with the CEJN demo').length === 1);
  const re = call(c, 'saveVisitPlan', Object.assign({ visitPlanNo: d2, clientNo: ids.plant, date: day(4), location: 'Plant', contactIds: '["P2"]' }, GERALD));
  ok('a visit sent back can be changed and stays with the rep', re.success && by(d2)['Status'] === 'Rejected' && by(d2)['Date'] === day(4));
  const rs = call(c, 'submitVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d2]) }, GERALD));
  ok('  and sent again: the old decision is cleared', rs.success && by(d2)['Status'] === 'Pending Director' && by(d2)['Decision'] === '' && by(d2)['Decision Note'] === '', by(d2));
  const k2 = call(c, 'submitVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([k1]) }, KIM));
  const bulk = call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([d2, k1]), decision: 'approve' }, NEIL));
  ok('the director approves two reps\' visits at once', k2.success && bulk.success && bulk.decided === 2 && by(d2)['Status'] === 'Approved' && by(k1)['Status'] === 'Approved');
  ok('every row still 28 wide, every log row 8', store.VisitPlans.every(v => v.__arity === 28) && store.VisitPlanLog.every(l => l.__arity === 8));
}

sec('6 · a change after approval goes back to the director');
{
  const { c, store, ids, day } = setup();
  const v = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(2), location: 'Plant', contactIds: '["P1"]', send: true }, GERALD)).visitPlanNo;
  call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([v]), decision: 'approve' }, NEIL));
  ok('accounting sees it once approved', call(c, 'getVisitPlans', ACCT).data.length === 1);
  const e = call(c, 'saveVisitPlan', Object.assign({ visitPlanNo: v, clientNo: ids.both, date: day(2), time: '14:00', location: 'Head office', contactIds: '["P1","P2"]' }, GERALD));
  const row = store.VisitPlans[0];
  ok('edited after approval: pending again, the decision cleared, logged as reopened', e.success && row['Status'] === 'Pending Director' && row['Decision'] === '' && row['Decided By'] === '' &&
     row['Address'] === '12F Tower, Ortigas, Pasig' && store.VisitPlanLog.some(l => l['Kind'] === 'reopened' && l['From'] === 'Approved' && /back with the director/.test(l['Note'])), row);
  ok('  and accounting no longer sees it', call(c, 'getVisitPlans', ACCT).data.length === 0);
  ok('  still one row, 28 wide', store.VisitPlans.length === 1 && row.__arity === 28);
}

sec('7 · cancelling');
{
  const { c, store, ids, day, snap } = setup();
  const v = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(1), location: 'Plant', contactIds: '["P1"]', send: true }, GERALD)).visitPlanNo;
  const w = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.plant, date: day(1), location: 'Plant', contactIds: '["P1"]' }, GERALD)).visitPlanNo;
  call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([v]), decision: 'approve' }, NEIL));
  const before = snap();
  ok('a reason is required', !call(c, 'cancelVisitPlan', Object.assign({ visitPlanNo: v, reason: ' ' }, GERALD)).success && snap() === before);
  ok('another rep cannot cancel it', /not yours/.test(call(c, 'cancelVisitPlan', Object.assign({ visitPlanNo: v, reason: 'x' }, KIM)).message) && snap() === before);
  const x = call(c, 'cancelVisitPlan', Object.assign({ visitPlanNo: v, reason: 'Plant shutdown' }, GERALD));
  const row = store.VisitPlans.find(r => r['Visit Plan No'] === v);
  ok('the rep cancels an approved visit: who, when, why, and the approval kept on record', x.success && row['Status'] === 'Cancelled' && row['Cancel Reason'] === 'Plant shutdown' &&
     row['Cancelled By'] === 'Gerald Lucena' && row['Decision'] === 'Approved', row);
  const a = call(c, 'getVisitPlans', ACCT).data;
  ok('  accounting still sees it, as cancelled after approval', a.length === 1 && a[0].status === 'Cancelled' && a[0].decision === 'Approved');
  ok('  it cannot be cancelled twice, edited, or marked done', !call(c, 'cancelVisitPlan', Object.assign({ visitPlanNo: v, reason: 'again' }, GERALD)).success &&
     /cancelled and can no longer be changed/.test(call(c, 'saveVisitPlan', Object.assign({ visitPlanNo: v, clientNo: ids.both, date: day(1), location: 'Plant', contactIds: '["P1"]' }, GERALD)).message) &&
     !call(c, 'markVisitPlanDone', Object.assign({ visitPlanNo: v, result: 'x' }, GERALD)).success);
  const dx = call(c, 'cancelVisitPlan', Object.assign({ visitPlanNo: w, reason: 'Not needed' }, NEIL));
  ok('the director can cancel a rep\'s draft; accounting never sees a visit that was not approved', dx.success && call(c, 'getVisitPlans', ACCT).data.length === 1);
  ok('  a cancelled visit frees the day for a new plan', call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.plant, date: day(1), location: 'Plant', contactIds: '["P1"]' }, GERALD)).success);
}

sec('8 · marking a visit done');
{
  const { c, store, ids, day } = setup();
  const now = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(0), location: 'Plant', contactIds: '["P1"]', send: true }, GERALD)).visitPlanNo;
  const later = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.plant, date: day(3), location: 'Plant', contactIds: '["P1"]', send: true }, GERALD)).visitPlanNo;
  ok('a visit not yet approved cannot be marked done', /Only an approved visit/.test(call(c, 'markVisitPlanDone', Object.assign({ visitPlanNo: now, result: 'Met R. Cruz' }, GERALD)).message));
  call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([now, later]), decision: 'approve' }, NEIL));
  ok('  nor one whose day has not come', /has not come yet/.test(call(c, 'markVisitPlanDone', Object.assign({ visitPlanNo: later, result: 'x' }, GERALD)).message));
  ok('  nor without a line on how it went', /how the visit went/.test(call(c, 'markVisitPlanDone', Object.assign({ visitPlanNo: now, result: '' }, GERALD)).message));
  ok('  nor by another rep, or the director', /not yours/.test(call(c, 'markVisitPlanDone', Object.assign({ visitPlanNo: now, result: 'x' }, KIM)).message) &&
     !call(c, 'markVisitPlanDone', Object.assign({ visitPlanNo: now, result: 'x' }, NEIL)).success);
  const d = call(c, 'markVisitPlanDone', Object.assign({ visitPlanNo: now, result: 'Met R. Cruz; RFQ for 40 hoses next week' }, GERALD));
  const row = store.VisitPlans.find(r => r['Visit Plan No'] === now);
  ok('done, with the result and when', d.success && row['Status'] === 'Done' && row['Result'] === 'Met R. Cruz; RFQ for 40 hoses next week' && !!row['Done At'] && row['Decision'] === 'Approved', row);
  ok('  accounting still sees it', call(c, 'getVisitPlans', ACCT).data.some(v => v.visitPlanNo === now && v.status === 'Done'));
  ok('  a done visit can no longer be changed', /done and can no longer be changed/.test(call(c, 'saveVisitPlan', Object.assign({ visitPlanNo: now, clientNo: ids.both, date: day(0), location: 'Plant', contactIds: '["P1"]' }, GERALD)).message));
  ok('the estimate columns are never written, whatever happened', store.VisitPlans.every(v => v['Travel Estimate (PHP)'] === '' && v['Travel Estimate Basis'] === ''));
}

sec('9 · the travel week: approved visits stand for the itinerary');
{
  const { c, ids, day } = setup();
  const a = call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.both, date: day(1), location: 'Plant', contactIds: '["P1"]', send: true }, GERALD)).visitPlanNo;
  call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.plant, date: day(1), location: 'Plant', contactIds: '["P1"]', send: true }, GERALD));
  call(c, 'saveVisitPlan', Object.assign({ clientNo: ids.kim, date: day(1), location: 'Plant', contactIds: '["P1"]', send: true }, KIM));
  call(c, 'decideVisitPlans', Object.assign({ visitPlanNos: JSON.stringify([a]), decision: 'approve' }, NEIL));
  const wk = c._travMonday(day(1));
  const found = c._travVisitsFor('Gerald Lucena', wk).map(r => r['Visit Plan No']);
  ok('only the rep\'s own approved visit in that week counts (not a pending one, not another rep\'s)', found.join() === a, found);
  ok('  any case of the name', c._travVisitsFor('gerald lucena', wk).length === 1);
  ok('  and none in another week', c._travVisitsFor('Gerald Lucena', c._vpAddDays(wk, 14)).length === 0 && c._travVisitsFor('Gerald Lucena', '').length === 0);
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
