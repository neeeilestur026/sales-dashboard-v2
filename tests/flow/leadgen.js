/* A277 — the lead-generation store, counter and follow-up reader, on the FlowAPI harness.
 *
 * Run:  node tests/flow/leadgen.js
 *
 * What is pinned here is the CONTRACT the page draws from: that every count is a server stamp on
 * the row, that stamps fire once on a transition, that a deleted or replayed row counts zero, that
 * the follow-up cadence is a function of dates, and that the hand-off cannot clobber a customer.
 */
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, x) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (x === undefined ? '' : '\n         ' + JSON.stringify(x))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');

const LG = { actorRole: 'leadgen', actorName: 'Ana Reyes', actorUsername: 'ana' };
const DIR = { actorRole: 'director', actorName: 'The Director', actorUsername: 'director' };
const callp = (kind, contactNo, outcome, reached) => Object.assign({ kind, contactNo, outcome, reached: reached || 'Decision-maker' }, LG);
const save = (c, entity, rec, who, extra) => call(c, 'saveLeadgenRecord', Object.assign({ entity, record: JSON.stringify(rec) }, who || LG, extra || {}));
const settings = (c, patch) => call(c, 'setFlowSettings', Object.assign({ settings: JSON.stringify(patch) }, DIR));
const plant = (c, over, who, extra) => save(c, 'plants', Object.assign({ company: 'Holcim Philippines', plantSite: 'Bulacan', sector: 'Cement', province: 'Bulacan', territory: 'Luzon' }, over || {}), who, extra);
const contact = (c, plantNo, over, who, extra) => save(c, 'contacts', Object.assign({ plantNo, name: 'R. Santos', role: 'Maintenance / O&M Head', email: 'r.santos@holcim.example' }, over || {}), who, extra);

/* ── 1 · plumbing ─────────────────────────────────────────────────────────────────────────── */
{
  sec('1 · plumbing');
  const c = load();
  // A floor, not an equality: lead-gen needs v152+ pasted, and pinning the exact number made every
  // later feature's version bump fail this suite for no reason (it did, on A278).
  ok('FLOW_VERSION is at least 152', c.FLOW_VERSION >= 152, c.FLOW_VERSION);
  ['getLeadgen', 'getLeadgenCounts', 'getLeadgenFollowups', 'saveLeadgenRecord', 'deleteLeadgenRecord'].forEach(a =>
    ok(a + ' in HANDLERS', typeof c.HANDLERS[a] === 'function'));
  ['saveLeadgenRecord', 'deleteLeadgenRecord'].forEach(a =>
    ok(a + ' is MUTATIONS + _SECURED + _MODULE_MAP', c.MUTATIONS[a] === 1 && c._SECURED[a] === 1 && !!c._MODULE_MAP[a]));
  ['logSalesCall', 'deleteSalesCall'].forEach(a =>
    ok(a + ' takes the lock and logs, but is NOT secured — the deployed report.html calls it directly, and securing it before the client ships refuses every rep\'s call log (A277-3)',
       c.MUTATIONS[a] === 1 && !!c._MODULE_MAP[a] && c._SECURED[a] === undefined));
  ok('Clients is 12 wide and ends in Stage', c.SCHEMA.Clients.length === 12 && c.SCHEMA.Clients[11] === 'Stage');
  ok('SalesCalls is 11 wide, Kind + Contact No + Reached appended', c.SCHEMA.SalesCalls.slice(8).join() === 'Kind,Contact No,Reached');
  ok('LgTouches carries no Deleted On (it follows its batch)', c.SCHEMA.LgTouches.indexOf('Deleted On') === -1);
}

/* ── 2 · date arithmetic is parts-based and Manila ────────────────────────────────────────── */
{
  sec('2 · dates');
  const c = load();
  ok('addDays crosses a month', c._lgAddDays('2026-09-30', 1) === '2026-10-01');
  ok('addDays crosses a year backwards', c._lgAddDays('2026-01-01', -1) === '2025-12-31');
  ok('addMonths clamps Jan 31 → Feb 28', c._lgAddMonths('2026-01-31', 1) === '2026-02-28');
  ok('addMonths 3 from Sep 17 is Dec 17', c._lgAddMonths('2026-09-17', 3) === '2026-12-17');
  ok('2026-09-14 is a Monday', c._lgDow('2026-09-14') === 'Mon');
  ok('Monday of a Sunday is the previous Monday', c._lgMonday('2026-09-13') === '2026-09-07');
  ok('Monday of a Monday is itself', c._lgMonday('2026-09-14') === '2026-09-14');
  ok('ISO week: 2024-12-30 is week 1', c._lgIsoWeek('2024-12-30') === 1);
  ok('ISO week: 2026-01-01 (Thu) is week 1', c._lgIsoWeek('2026-01-01') === 1);
  ok('ISO week: 2026-09-14 is week 38', c._lgIsoWeek('2026-09-14') === 38, c._lgIsoWeek('2026-09-14'));
  const cfg = c._lgWeekCfg({ lgWorkingDays: 'Mon,Tue,Wed,Thu,Fri', lgHolidays: '2026-09-08' });
  ok('a Saturday rolls to Monday', c._lgRollForward('2026-09-05', cfg) === '2026-09-07');
  ok('a holiday Tuesday rolls to Wednesday', c._lgRollForward('2026-09-08', cfg) === '2026-09-09');
  ok('a Date-typed lone holiday is honoured', c._lgWeekCfg({ lgHolidays: new Date(2026, 11, 25) }).holidays['2026-12-25'] === 1);
  ok('_lgDayOf takes a Date, an ISO string, a plain string, a blank',
     c._lgDayOf(new Date(2026, 8, 14, 23, 59)) === '2026-09-14' && c._lgDayOf('2026-09-14') === '2026-09-14' && c._lgDayOf('') === '' && c._lgDayOf(null) === '');
  ok('23:59 and 00:01 are different days', c._lgDayOf(new Date(2026, 8, 14, 23, 59)) !== c._lgDayOf(new Date(2026, 8, 15, 0, 1)));
  ok('sector of week cycles', c._lgSectorOfWeek('2026-09-14', {}).of === 4 && ['Cement', 'Mining', 'Power', 'Water'].includes(c._lgSectorOfWeek('2026-09-14', {}).name));
}

/* ── 3 · who may write, and whose name goes on the row ────────────────────────────────────── */
{
  sec('3 · role gate');
  const c = load();
  let r = plant(c, {}, { actorRole: 'accounting', actorName: 'Acct' });
  ok('accounting cannot create a plant', !r.success && /lead-generation/.test(r.message), r);
  r = plant(c, {}, { actorRole: 'sales', actorName: 'Gerald' });
  ok('a sales rep cannot create a plant', !r.success, r);
  r = plant(c, { createdBy: 'Somebody Else' });
  ok('leadgen creates a plant', r.success && /^PLT-\d{6}-\d{3}$/.test(r.id), r);
  const row = c.__store.LgPlants[0];
  ok('Created By is the session actor, not the payload', row['Created By'] === 'Ana Reyes', row['Created By']);
  r = plant(c, { company: 'Apex Mining', plantSite: 'Maco', sector: 'Mining', territory: 'VisMin' }, DIR);
  ok('the director may write too', r.success, r);
}

/* ── 4 · plants: stamped at creation, deduped by site, enum-checked ───────────────────────── */
{
  sec('4 · plants');
  const c = load();
  const today = c._lgDay();
  let r = plant(c);
  ok('Researched On is today, as a string', c.__store.LgPlants[0]['Researched On'] === today, c.__store.LgPlants[0]['Researched On']);
  r = plant(c, { company: '  holcim   philippines ', plantSite: 'BULACAN' });
  ok('the same site spelled differently is refused', !r.success && /Already listed as PLT-/.test(r.message), r);
  r = plant(c, { plantSite: 'La Union' });
  ok('a second site of the same company is a second plant', r.success, r);
  r = plant(c, { company: 'X', plantSite: 'Y', sector: 'Cementt' });
  ok('an unknown sector is refused with the list', !r.success && /Sector must be one of/.test(r.message), r);
  r = plant(c, { company: 'X', plantSite: 'Y', territory: 'Mindanao' });
  ok('an unknown territory is refused', !r.success && /Territory must be one of/.test(r.message), r);
  r = plant(c, { company: 'X', plantSite: 'Y', status: 'Hot' });
  ok('an unknown plant status is refused', !r.success, r);
  // edit keeps the stamp
  const first = c.__store.LgPlants[0];
  first['Researched On'] = '2026-01-05';
  r = save(c, 'plants', { rowIndex: 2, plantNo: first['Plant No'], notes: 'edited' });
  ok('an edit keeps Researched On', r.success && c.__store.LgPlants[0]['Researched On'] === '2026-01-05' && c.__store.LgPlants[0]['Notes'] === 'edited', r);
  r = save(c, 'plants', { rowIndex: 2, plantNo: 'PLT-000000-999', notes: 'x' });
  ok('an id/rowIndex mismatch is refused', !r.success && /moved/.test(r.message), r);
  // clientRef replay
  const before = c.__store.LgPlants.length;
  const a = plant(c, { company: 'Eagle Cement', plantSite: 'San Ildefonso' }, LG, { clientRef: 'CR-1' });
  const b = plant(c, { company: 'Eagle Cement', plantSite: 'San Ildefonso' }, LG, { clientRef: 'CR-1' });
  ok('a replayed clientRef returns the original id and writes once', a.success && b.success && a.id === b.id && b.replayed === true && c.__store.LgPlants.length === before + 1, [a.id, b.id]);
  const g = call(c, 'getLeadgen', { entity: 'plants' });
  ok('getLeadgen maps headers to camelCase and dates to strings', g.success && g.data.plants[0].plantSite === 'Bulacan' && g.data.plants[0].researchedOn === '2026-01-05' && g.today === today, g.data.plants[0]);
}

/* ── 5 · contacts: Verified On and Replied On fire on the transition, once ────────────────── */
{
  sec('5 · contacts');
  const c = load();
  const today = c._lgDay();
  let r = contact(c, 'PLT-nope');
  ok('a contact needs a listed plant', !r.success && /not on the list/.test(r.message), r);
  const pn = plant(c).id;
  r = contact(c, pn, { introSent: '2026-01-01' });
  ok('created Unverified: no Verified On', r.success && c.__store.LgContacts[0]['Verified On'] === '' && c.__store.LgContacts[0]['Email Verified'] === 'Unverified', c.__store.LgContacts[0]);
  ok('a client-sent Intro Sent is discarded', c.__store.LgContacts[0]['Intro Sent'] === '');
  const cn = r.id;
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, emailVerified: 'Bounced' });
  ok('Unverified → Bounced does not verify', r.success && c.__store.LgContacts[0]['Verified On'] === '', r);
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, emailVerified: 'Pattern' });
  ok('→ Pattern stamps Verified On today', r.success && c.__store.LgContacts[0]['Verified On'] === today, c.__store.LgContacts[0]);
  c.__store.LgContacts[0]['Verified On'] = '2026-01-05';
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, emailVerified: 'Switchboard' });
  ok('Pattern → Switchboard keeps the first stamp', r.success && c.__store.LgContacts[0]['Verified On'] === '2026-01-05', c.__store.LgContacts[0]['Verified On']);
  r = contact(c, pn, { name: 'Direct', emailVerified: 'Switchboard' });
  ok('created already verified counts at creation', r.success && c.__store.LgContacts[1]['Verified On'] === today);
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, status: 'Replied' });
  ok('→ Replied stamps Replied On', r.success && c.__store.LgContacts[0]['Replied On'] === today);
  c.__store.LgContacts[0]['Replied On'] = '2026-02-02';
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, status: 'Replied', notes: 'again' });
  ok('a later edit keeps Replied On', c.__store.LgContacts[0]['Replied On'] === '2026-02-02');
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, status: 'Cold' });
  ok('"Cold" is not a status — it is a fact about dates', !r.success && /Status must be one of/.test(r.message), r);
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, role: 'CEO' });
  ok('an unknown role is refused', !r.success, r);
}

/* ── 6 · email batches: the count is derived, the fan-out is one touch per contact ─────────── */
{
  sec('6 · batches');
  const c = load();
  const today = c._lgDay();
  const pn = plant(c).id;
  const c1 = contact(c, pn).id, c2 = contact(c, pn, { name: 'M. Cruz', email: 'm.cruz@x.example' }).id;
  const c3 = contact(c, pn, { name: 'No Email', email: '' }).id;
  let r = save(c, 'batches', { kind: 'Intro', contactNos: [c1, c2, c1], count: 999 });
  ok('Count is derived from the contacts (dupes collapsed), the client count ignored', r.success && c.__store.LgEmailBatch[0]['Count'] === 2, c.__store.LgEmailBatch[0]);
  ok('Sent On and Date are today', c.__store.LgEmailBatch[0]['Sent On'] === today && c.__store.LgEmailBatch[0]['Date'] === today);
  ok('one touch per contact, keyed on the batch', c.__store.LgTouches.length === 2 && c.__store.LgTouches.every(t => t['Ref No'] === r.id && t['Kind'] === 'Intro' && t['Channel'] === 'Email' && t['Sent On'] === today), c.__store.LgTouches);
  ok('touch numbers are batch#seq, no counter spent', c.__store.LgTouches.map(t => t['Touch No']).join() === r.id + '#1,' + r.id + '#2');
  ok('Intro Sent set on both contacts', c.__store.LgContacts[0]['Intro Sent'] === today && c.__store.LgContacts[1]['Intro Sent'] === today);
  c.__store.LgContacts[0]['Intro Sent'] = '2026-01-10';
  r = save(c, 'batches', { kind: 'Intro', contactNos: c1 + ', ' + c2 });
  ok('a second intro does not restart a contact\'s clock', r.success && c.__store.LgContacts[0]['Intro Sent'] === '2026-01-10');
  r = save(c, 'batches', { kind: 'Intro', contactNos: [c3] });
  ok('a contact without an email is refused', !r.success && /no email/.test(r.message), r);
  r = save(c, 'batches', { kind: 'Intro', contactNos: ['CTC-000000-999'] });
  ok('an unknown contact is refused', !r.success && /not on the list/.test(r.message), r);
  r = save(c, 'batches', { kind: 'Intro', contactNos: [] });
  ok('an empty batch is refused', !r.success, r);
  r = save(c, 'batches', { kind: 'Blast', contactNos: [c1] });
  ok('an unknown kind is refused', !r.success && /Kind must be/.test(r.message), r);
  settings(c, { lgMaxBatch: 1 });
  r = save(c, 'batches', { kind: 'Follow-up', contactNos: [c1, c2] });
  ok('a batch over lgMaxBatch is refused', !r.success && /at most 1/.test(r.message), r);
  settings(c, { lgMaxBatch: 60 });
  r = save(c, 'batches', { kind: 'Follow-up', contactNos: [c1], date: c._lgAddDays(today, 1) });
  ok('a future date is refused', !r.success && /future/.test(r.message), r);
  r = save(c, 'batches', { kind: 'Follow-up', contactNos: [c1], date: c._lgAddDays(today, -2) });
  ok('two days back is refused for leadgen', !r.success && /director/.test(r.message), r);
  r = save(c, 'batches', { kind: 'Follow-up', contactNos: [c1], date: c._lgAddDays(today, -2) }, DIR);
  ok('…and allowed for the director, stamping the typed day', r.success && c.__store.LgEmailBatch[2]['Sent On'] === c._lgAddDays(today, -2), r);
  r = save(c, 'batches', { kind: 'Follow-up', contactNos: [c1], date: c._lgAddDays(today, -1), timeSlot: '08:30' });
  ok('one day back is fine', r.success, r);
  const bi = c.__store.LgEmailBatch.length + 1;
  r = save(c, 'batches', { rowIndex: bi, batchNo: c.__store.LgEmailBatch[bi - 2]['Batch No'], contactNos: [c1, c2] });
  ok('changing the contacts on a logged batch is refused', !r.success && /cannot change/.test(r.message), r);
  r = save(c, 'batches', { rowIndex: bi, batchNo: c.__store.LgEmailBatch[bi - 2]['Batch No'], notes: 'fixed', timeSlot: '09:00' });
  ok('editing notes keeps Count and Sent On', r.success && c.__store.LgEmailBatch[bi - 2]['Count'] === 1 && c.__store.LgEmailBatch[bi - 2]['Notes'] === 'fixed' && c.__store.LgEmailBatch[bi - 2]['Sent On'] === c._lgAddDays(today, -1), c.__store.LgEmailBatch[bi - 2]);
  const touchesBefore = c.__store.LgTouches.length;
  ok('an edit adds no touches', touchesBefore === 2 + 2 + 1 + 1, touchesBefore);   // two intros × 2, the director's, the one-day-back
}

/* ── 7 · the counter: the nine daily items ────────────────────────────────────────────────── */
{
  sec('7 · getLeadgenCounts');
  const c = load();
  const today = c._lgDay();
  settings(c, { lgRepLuzon: 'gerald', lgRepVisMin: 'kim' });
  const p1 = plant(c).id, p2 = plant(c, { plantSite: 'La Union' }).id, p3 = plant(c, { plantSite: 'Davao', territory: 'VisMin' }).id;
  const c1 = contact(c, p1, { emailVerified: 'Pattern' }).id, c2 = contact(c, p1, { name: 'B', email: 'b@x.example' }).id;
  save(c, 'batches', { kind: 'Intro', contactNos: [c1, c2] });                       // 2 email touches
  save(c, 'batches', { kind: 'Follow-up', contactNos: [c1] });                       // 1
  call(c, 'logSalesCall', callp('Cold', c1, 'No answer', 'Voicemail / no answer'));
  call(c, 'logSalesCall', callp('Cold', c2, 'Interested', 'Decision-maker'));
  call(c, 'logSalesCall', callp('Follow-up', c1, 'Referred', 'Gatekeeper'));
  call(c, 'logSalesCall', Object.assign({ contact: 'Rep call', outcome: 'Connected' }, { actorRole: 'sales', actorName: 'Gerald' }));
  save(c, 'linkedin', { contactNo: c2, kind: 'Connection request' });
  save(c, 'linkedin', { contactNo: c1, kind: 'Message' });
  save(c, 'suppliers', { company: 'Bulacan Bolts Trading', category: 'Fasteners', location: 'Bulacan' });
  save(c, 'contacts', { rowIndex: 2, contactNo: c1, nextCallDate: c._lgAddDays(today, 2) });   // a call booked
  const lead = save(c, 'leads', { plantNo: p1, contactNo: c1, rightPerson: true, ownMaintenance: 'Yes', flangedOrHydraulic: 1, saidYes: 'yes', pain: 'leaks' });
  ok('lead handed off', lead.success && lead.handedTo === 'gerald', lead);
  save(c, 'leads', { rowIndex: 2, leadNo: lead.id, status: 'Presentation Booked', presentationDate: '2026-12-01' });
  call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'plants', id: p3, rowIndex: 4 }, LG));
  save(c, 'plants', { rowIndex: 2, plantNo: p1, notes: 'edited twice' });
  save(c, 'plants', { rowIndex: 2, plantNo: p1, notes: 'edited thrice' });
  call(c, 'submitDailyReport', { user: 'Ana Reyes', role: 'leadgen', date: today, clientRef: 'DR-1', actorName: 'Ana Reyes', actorRole: 'leadgen' });
  const k = call(c, 'getLeadgenCounts', {});
  ok('attempts = 3 calls + 3 emails + 2 LinkedIn = 8; the rep\'s plain call counts nowhere', k.success && k.day.attempts === 8, k.day);
  ok('conversations = the one call that reached the decision-maker', k.day.conversations === 1, k.day);
  ok('emails 3 (intro + follow-up alike), linkedin 2', k.day.emails === 3 && k.day.linkedin === 2, k.day);
  ok('suppliers 1, accounts 2 (one deleted; one edited twice counts once)', k.day.suppliers === 1 && k.day.accounts === 2, k.day);
  ok('crm: something was logged', k.day.crm > 0, k.day);
  ok('eod: the report was submitted', k.day.eod === 1, k.day);
  ok('scheduled = 1 call booked + 1 presentation booked = 2', k.day.scheduled === 2, k.day);
  ok('the weekly items ride along per day: leads 1, meetings 1, intel updates 1', k.day.leads === 1 && k.day.meetings === 1 && k.day.intelUpdates === 1, k.day);
  ok('quotas are ranges from settings', k.quotas.attempts === 40 && k.quotasMax.attempts === 50 && k.quotas.eod === 1, [k.quotas, k.quotasMax]);
  ok('server date and hour are returned', k.today === today && /^\d\d:\d\d$/.test(k.hour));
  ok('reps by username', k.reps.Luzon === 'gerald' && k.reps.VisMin === 'kim');
  ok('the week starts on a Monday', k.week.days.length === 7 && c._lgDow(k.week.start) === 'Mon');
  ok('the weekly panel: active accounts is a state, leads a range', k.week.weekly.activeAccounts.value === 2 && k.week.weekly.activeAccounts.min === 20 && k.week.weekly.leads.min === 10 && k.week.weekly.leads.max === 20, k.week.weekly);
  const k2 = call(c, 'getLeadgenCounts', { user: 'Nobody' });
  ok('a user filter scopes everything, the report included', k2.day.accounts === 0 && k2.day.attempts === 0 && k2.day.eod === 0, k2.day);
}

/* ── 8 · the week: working days, holidays, Saturday, reply rate ──────────────────────────── */
{
  sec('8 · the week');
  const c = load();
  const seed = (sheet, obj) => (c.__store[sheet] = c.__store[sheet] || []).push(obj);
  ['LgPlants', 'LgContacts', 'LgTouches', 'LgEmailBatch', 'LgLeads', 'LgSuppliers', 'SalesCalls'].forEach(x => c._sheet(x));
  ['2026-09-07', '2026-09-07', '2026-09-09', '2026-09-12', '2026-09-13'].forEach((d, i) =>
    seed('LgPlants', { 'Plant No': 'PLT-' + i, 'Company': 'C' + i, 'Status': 'Active', 'Researched On': d, 'Deleted On': '', 'Created By': 'Ana' }));
  seed('LgEmailBatch', { 'Batch No': 'B3', 'Kind': 'Intro', 'Sent On': '2026-09-08', 'Deleted On': '2026-09-08', 'Created By': 'Ana' });
  for (let i = 0; i < 40; i++) seed('LgTouches', { 'Touch No': 'B1#' + i, 'Contact No': 'K' + i, 'Channel': 'Email', 'Kind': 'Intro', 'Ref No': 'B1', 'Sent On': '2026-09-08', 'Created By': 'Ana' });
  for (let i = 0; i < 10; i++) seed('LgTouches', { 'Touch No': 'B2#' + i, 'Contact No': 'K' + i, 'Channel': 'Email', 'Kind': 'Intro', 'Ref No': 'B2', 'Sent On': '2026-09-12', 'Created By': 'Ana' });   // Saturday
  for (let i = 0; i < 5; i++) seed('LgTouches', { 'Touch No': 'B3#' + i, 'Contact No': 'K' + i, 'Channel': 'Email', 'Kind': 'Intro', 'Ref No': 'B3', 'Sent On': '2026-09-08', 'Created By': 'Ana' });   // removed batch
  seed('LgTouches', { 'Touch No': 'LI-1', 'Contact No': 'K1', 'Channel': 'LinkedIn', 'Kind': 'Message', 'Ref No': 'LI-1', 'Sent On': '2026-09-10', 'Created By': 'Ana' });
  seed('LgContacts', { 'Contact No': 'C1', 'Replied On': '2026-09-10', 'Deleted On': '', 'Created By': 'Ana' });
  seed('LgContacts', { 'Contact No': 'C2', 'Replied On': '2026-09-11', 'Deleted On': '', 'Created By': 'Ana' });
  seed('LgContacts', { 'Contact No': 'C3', 'Replied On': '2026-09-14', 'Deleted On': '', 'Created By': 'Ana' });      // next week
  seed('LgSuppliers', { 'Supplier No': 'S1', 'Company': 'X', 'Handed Off On': '2026-09-10', 'Deleted On': '', 'Created By': 'Ana' });
  let w = call(c, 'getLeadgenCounts', { weekStart: '2026-09-07' });
  ok('five working days by default', w.week.workingDays.length === 5, w.week.workingDays);
  ok('weekly targets are daily min × working days, with a max beside them', w.week.targets.attempts === 200 && w.week.targetsMax.attempts === 250, [w.week.targets, w.week.targetsMax]);
  ok('accounts: Mon 2 + Wed 1 = 3; Saturday and Sunday count toward nothing', w.week.totals.accounts === 3, w.week.totals);
  ok('Saturday is still drawn on the strip', w.week.byDay['2026-09-12'].accounts === 1 && w.week.byDay['2026-09-12'].working === false);
  ok('emails 40 — the Saturday 10 and the removed batch\'s 5 are out; attempts adds the LinkedIn message', w.week.totals.emails === 40 && w.week.totals.attempts === 41, w.week.totals);
  ok('reply rate = 2 replies ÷ 40 intros = 5%', w.week.replies === 2 && w.week.replyRate === 5, w.week);
  ok('suppliers handed off this week: 1 of 25–50', w.week.weekly.suppliersHandedOff.value === 1 && w.week.weekly.suppliersHandedOff.min === 25, w.week.weekly);
  settings(c, { lgHolidays: '2026-09-09', lgWorkingDays: 'Mon,Tue,Wed,Thu,Fri' });
  w = call(c, 'getLeadgenCounts', { weekStart: '2026-09-07' });
  ok('a holiday drops a working day and the target', w.week.workingDays.length === 4 && w.week.targets.accounts === 40, w.week);
  ok('…and the holiday\'s row counts toward nothing', w.week.totals.accounts === 2, w.week.totals);
  ok('no intros → reply rate null, not NaN', call(c, 'getLeadgenCounts', { weekStart: '2026-10-05' }).week.replyRate === null);
}

/* ── 9 · follow-ups are a function of dates ───────────────────────────────────────────────── */
{
  sec('9 · getLeadgenFollowups');
  const c = load();
  const seed = (sheet, obj) => (c.__store[sheet] = c.__store[sheet] || []).push(obj);
  ['LgPlants', 'LgContacts', 'LgTouches', 'LgEmailBatch'].forEach(s => c._sheet(s));
  seed('LgPlants', { 'Plant No': 'P1', 'Company': 'Holcim', 'Plant / Site': 'Bulacan', 'Status': 'Active', 'Deleted On': '' });
  seed('LgContacts', { 'Contact No': 'K1', 'Plant No': 'P1', 'Name': 'R. Santos', 'Status': 'New', 'Intro Sent': '2026-09-03', 'Deleted On': '' });   // Thursday
  seed('LgEmailBatch', { 'Batch No': 'B1', 'Kind': 'Intro', 'Sent On': '2026-09-03', 'Deleted On': '' });
  seed('LgTouches', { 'Touch No': 'B1#1', 'Contact No': 'K1', 'Channel': 'Email', 'Kind': 'Intro', 'Ref No': 'B1', 'Sent On': '2026-09-03' });
  const due = (d) => call(c, 'getLeadgenFollowups', { date: d }).data;
  ok('day 3 lands on Sunday 09-06 → not due Friday', due('2026-09-04').length === 0);
  ok('…not due on the Saturday or the Sunday either', due('2026-09-05').length === 0 && due('2026-09-06').length === 0);
  let d = due('2026-09-07');
  ok('due on Monday 09-07 as Day 3', d.length === 1 && d[0].stage === 'Day 3' && d[0].due === '2026-09-07' && d[0].overdue === 0 && d[0].company === 'Holcim', d);
  ok('a day later it is overdue by one', due('2026-09-08')[0].overdue === 1);
  seed('LgTouches', { 'Touch No': 'B2#1', 'Contact No': 'K1', 'Channel': 'Email', 'Kind': 'Follow-up', 'Ref No': 'B2', 'Sent On': '2026-09-09' });
  seed('LgEmailBatch', { 'Batch No': 'B2', 'Kind': 'Follow-up', 'Sent On': '2026-09-09', 'Deleted On': '' });
  ok('a touch today removes the row', due('2026-09-09').length === 0);
  ok('day 7 = 09-10 (Thu) is due on 09-10', due('2026-09-10')[0] && due('2026-09-10')[0].stage === 'Day 7');
  seed('LgTouches', { 'Touch No': 'CALL-1#1', 'Contact No': 'K1', 'Channel': 'Call', 'Kind': 'Follow-up', 'Ref No': 'CALL-1', 'Sent On': '2026-09-10' });
  ok('day 14 = 09-17 (Thu)', due('2026-09-16').length === 0 && due('2026-09-17')[0].stage === 'Day 14');
  seed('LgTouches', { 'Touch No': 'B3#1', 'Contact No': 'K1', 'Channel': 'Email', 'Kind': 'Follow-up', 'Ref No': 'B3', 'Sent On': '2026-09-17' });
  seed('LgEmailBatch', { 'Batch No': 'B3', 'Kind': 'Follow-up', 'Sent On': '2026-09-17', 'Deleted On': '' });
  ok('three touches, no reply → cold: nothing due next week', due('2026-09-24').length === 0);
  ok('…not due the day before the revisit', due('2026-12-16').length === 0);
  d = due('2026-12-17');
  ok('…comes back three months after the last touch', d.length === 1 && d[0].stage === 'Revisit' && d[0].due === '2026-12-17', d);
  seed('LgTouches', { 'Touch No': 'CALL-2#1', 'Contact No': 'K1', 'Channel': 'Call', 'Kind': 'Cold', 'Ref No': 'CALL-2', 'Sent On': '2026-12-17' });
  ok('a touch on the revisit day clears it', due('2026-12-18').length === 0);
  // a deleted batch takes its touches with it
  c.__store.LgEmailBatch.find(b => b['Batch No'] === 'B3')['Deleted On'] = '2026-09-17';
  ok('deleting B3 un-colds the contact: Day 14 is due again', due('2026-09-18')[0] && due('2026-09-18')[0].stage === 'Day 14', due('2026-09-18'));
  // replied / wrong person
  seed('LgContacts', { 'Contact No': 'K2', 'Plant No': 'P1', 'Name': 'J. Reyes', 'Status': 'Replied', 'Replied On': '2026-09-10', 'Intro Sent': '2026-09-03', 'Deleted On': '' });
  d = due('2026-09-11').filter(r => r.contactNo === 'K2');
  ok('a reply becomes a call-back, not a day-7 email', d.length === 1 && d[0].stage === 'Replied' && d[0].action === 'Call back', d);
  seed('LgTouches', { 'Touch No': 'CALL-3#1', 'Contact No': 'K2', 'Channel': 'Call', 'Kind': 'Follow-up', 'Ref No': 'CALL-3', 'Sent On': '2026-09-11' });
  ok('a call after the reply ends it', due('2026-09-12').filter(r => r.contactNo === 'K2').length === 0);
  seed('LgContacts', { 'Contact No': 'K3', 'Plant No': 'P1', 'Name': 'W', 'Status': 'Wrong Person', 'Intro Sent': '2026-09-01', 'Deleted On': '' });
  seed('LgContacts', { 'Contact No': 'K4', 'Plant No': 'P1', 'Name': 'D', 'Status': 'Do Not Contact', 'Intro Sent': '2026-09-01', 'Deleted On': '' });
  seed('LgContacts', { 'Contact No': 'K5', 'Plant No': 'P1', 'Name': 'Gone', 'Status': 'New', 'Intro Sent': '2026-09-01', 'Deleted On': '2026-09-02' });
  seed('LgContacts', { 'Contact No': 'K6', 'Plant No': 'P1', 'Name': 'No intro', 'Status': 'New', 'Intro Sent': '', 'Deleted On': '' });
  const ids = due('2026-10-01').map(r => r.contactNo);
  ok('wrong person, do-not-contact, deleted and never-introduced contacts are never due', !ids.includes('K3') && !ids.includes('K4') && !ids.includes('K5') && !ids.includes('K6'), ids);
}

/* ── 10 · the hand-off ────────────────────────────────────────────────────────────────────── */
{
  sec('10 · leads and the hand-off');
  const c = load();
  const today = c._lgDay();
  settings(c, { lgRepLuzon: 'gerald', lgRepVisMin: 'kim' });
  // an existing customer with payment terms and no email
  c._sheet('Clients');
  c.__store.Clients.push({ 'Customer': 'Holcim Philippines', 'Address': '', 'Contact Person': '', 'Designation': '', 'Email': '', 'Phone': '',
    'RFQ Ref': '', 'Payment Terms': '30 days', 'Notes': 'VIP', 'Updated By': 'acct', 'Updated At': 'x', 'Stage': '' });
  const p1 = plant(c).id, p2 = plant(c, { company: 'Apex Mining', plantSite: 'Maco', sector: 'Mining', territory: 'VisMin' }).id;
  const c1 = contact(c, p1, { mobile: '0917' }).id;
  let r = save(c, 'leads', { plantNo: p1, contactNo: c1, rightPerson: true, ownMaintenance: true });
  ok('two of four flags is refused, naming the missing two', !r.success && /flanged or hydraulic/.test(r.message) && /said yes/.test(r.message) && !/right person/.test(r.message), r);
  ok('…and no client row was touched', c.__store.Clients.length === 1 && c.__store.Clients[0]['Email'] === '');
  r = save(c, 'leads', { plantNo: p1, contactNo: c1, rightPerson: true, ownMaintenance: true, flangedOrHydraulic: true, saidYes: true, pain: 'leaks', whatTheySaid: 'send a deck', status: 'Won' }, LG, { clientRef: 'CR-L1' });
  ok('all four → handed off, status forced to Handed Off', r.success && r.handedTo === 'gerald' && r.territory === 'Luzon' && c.__store.LgLeads[0]['Status'] === 'Handed Off', r);
  ok('Handed Off On is today; Client Created = Existing', c.__store.LgLeads[0]['Handed Off On'] === today && c.__store.LgLeads[0]['Client Created'] === 'Existing', c.__store.LgLeads[0]);
  const cl = c.__store.Clients[0];
  ok('the existing customer keeps payment terms and notes, gains the email, stays a customer', cl['Payment Terms'] === '30 days' && cl['Notes'] === 'VIP' && cl['Email'] === 'r.santos@holcim.example' && cl['Contact Person'] === 'R. Santos' && cl['Stage'] === '' && c.__store.Clients.length === 1, cl);
  const again = save(c, 'leads', { plantNo: p1, contactNo: c1, rightPerson: true, ownMaintenance: true, flangedOrHydraulic: true, saidYes: true }, LG, { clientRef: 'CR-L1' });
  ok('a replay is one lead, one client', again.success && again.id === r.id && c.__store.LgLeads.length === 1 && c.__store.Clients.length === 1, again);
  // a brand-new prospect
  r = save(c, 'leads', { plantNo: p2, rightPerson: 'Yes', ownMaintenance: 'Yes', flangedOrHydraulic: 'Yes', saidYes: 'Yes' });
  ok('VisMin → kim', r.success && r.handedTo === 'kim' && r.clientCreated === true, r);
  const np = c.__store.Clients[1];
  ok('a new client row is a Prospect with the province as address', np && np['Stage'] === 'Prospect' && np['Customer'] === 'Apex Mining' && np['Updated By'] === 'Ana Reyes', np);
  ok('the lead says Client Created = Yes', c.__store.LgLeads[1]['Client Created'] === 'Yes');
  // transitions
  const l1 = r.id, ri = 3;
  r = save(c, 'leads', { rowIndex: ri, leadNo: l1, status: 'Presentation Booked', presentationDate: '2026-12-01' });
  ok('→ Presentation Booked stamps Booked On today, not the presentation date', r.success && c.__store.LgLeads[1]['Booked On'] === today && c.__store.LgLeads[1]['Presentation Date'] === '2026-12-01', c.__store.LgLeads[1]);
  c.__store.LgLeads[1]['Booked On'] = '2026-01-01';
  r = save(c, 'leads', { rowIndex: ri, leadNo: l1, status: 'Presentation Booked', notes: 'moved' });
  ok('a re-save keeps the first Booked On', c.__store.LgLeads[1]['Booked On'] === '2026-01-01');
  r = save(c, 'leads', { rowIndex: ri, leadNo: l1, status: 'Handed Off' });
  ok('Presentation Booked → Handed Off is refused', !r.success && /not a move/.test(r.message), r);
  r = save(c, 'leads', { rowIndex: ri, leadNo: l1, status: 'Won' });
  ok('→ Won', r.success);
  r = save(c, 'leads', { rowIndex: ri, leadNo: l1, status: 'Returned' });
  ok('Won → Returned is refused', !r.success, r);
  r = save(c, 'leads', { rowIndex: ri, leadNo: l1, status: 'Hot' });
  ok('an unknown status is refused', !r.success && /Status must be one of/.test(r.message), r);
  // the rep's return
  const l0 = c.__store.LgLeads[0]['Lead No'];
  const KIM = { actorRole: 'sales', actorName: 'Kim', actorUsername: 'kim' }, GER = { actorRole: 'sales', actorName: 'Gerald', actorUsername: 'gerald' };
  r = save(c, 'leads', { rowIndex: 2, leadNo: l0, status: 'Returned', returnReason: 'not mine' }, KIM);
  ok('a rep cannot return someone else\'s lead', !r.success && /not handed to you/.test(r.message), r);
  r = save(c, 'leads', { rowIndex: 2, leadNo: l0, status: 'Quoted' }, GER);
  ok('a rep can only return', !r.success && /only return/.test(r.message), r);
  r = save(c, 'leads', { rowIndex: 2, leadNo: l0, status: 'Returned' }, GER);
  ok('a return needs a reason', !r.success && /why/.test(r.message), r);
  r = save(c, 'leads', { rowIndex: 2, leadNo: l0, status: 'Returned', returnReason: 'wrong territory', pain: 'hacked' }, GER);
  ok('the rep returns their lead; only status, reason and date change', r.success && c.__store.LgLeads[0]['Status'] === 'Returned' && c.__store.LgLeads[0]['Returned On'] === today && c.__store.LgLeads[0]['Return Reason'] === 'wrong territory' && c.__store.LgLeads[0]['Pain'] === 'leaks', c.__store.LgLeads[0]);
  r = save(c, 'leads', { plantNo: p1, rightPerson: true, ownMaintenance: true, flangedOrHydraulic: true, saidYes: true }, GER);
  ok('a rep cannot create a lead', !r.success, r);
  // re-hand
  c.__store.LgLeads[0]['Handed Off On'] = '2026-09-01';
  r = save(c, 'leads', { rowIndex: 2, leadNo: l0, status: 'Handed Off', rightPerson: true, ownMaintenance: true, flangedOrHydraulic: true, saidYes: true, territory: 'VisMin' });
  ok('Returned → Handed Off is a re-hand: Rehanded On today, Handed Off On kept, rep re-derived', r.success && c.__store.LgLeads[0]['Rehanded On'] === today && c.__store.LgLeads[0]['Handed Off On'] === '2026-09-01' && c.__store.LgLeads[0]['Handed To'] === 'kim', c.__store.LgLeads[0]);
  const k = call(c, 'getLeadgenCounts', {});
  ok('the re-hand is not counted as today\'s lead', k.day.leads === 1, k.day);
  const g = call(c, 'getLeadgen', { entity: 'leads', handedTo: 'kim' });
  ok('getLeadgen filters leads by rep username', g.data.leads.length === 2 && g.data.leads.every(l => l.handedTo === 'kim') && g.data.leads[0].rightPerson === true, g.data.leads.map(l => l.leadNo));
  const hl = g.data.leads.find(l => l.contactNo);
  ok('a lead carries its plant and contact for the rep\'s panel', hl && hl.company === 'Holcim Philippines' && hl.plantSite === 'Bulacan' && hl.contactName === 'R. Santos' && hl.contactMobile === '0917' && hl.sector === 'Cement', hl);
  r = save(c, 'leads', { plantNo: p1, contactNo: 'CTC-000000-000', rightPerson: true, ownMaintenance: true, flangedOrHydraulic: true, saidYes: true });
  ok('an unknown contact on a lead is refused', !r.success, r);
}

/* ── 11 · saveClient survives its own width; getClients shows Stage ───────────────────────── */
{
  sec('11 · saveClient');
  const c = load();
  let r = call(c, 'saveClient', { customer: 'Eagle Cement', paymentTerms: '45 days', actorName: 'acct', actorRole: 'accounting' });
  ok('saveClient no longer throws with Stage in the schema', r.success, r);
  ok('a client saved from the clients page has no stage', c.__store.Clients[0]['Stage'] === '' && c.__store.Clients[0].__arity === 12, c.__store.Clients[0]);
  c.__store.Clients[0]['Stage'] = 'Prospect';
  r = call(c, 'saveClient', { customer: 'Eagle Cement', paymentTerms: '60 days', actorName: 'acct', actorRole: 'accounting' });
  ok('a re-save keeps Stage unless the caller sets it', c.__store.Clients[0]['Stage'] === 'Prospect' && c.__store.Clients[0]['Payment Terms'] === '60 days');
  r = call(c, 'saveClient', { customer: 'Eagle Cement', stage: '', actorName: 'acct', actorRole: 'accounting' });
  ok('…and clears it when told to', c.__store.Clients[0]['Stage'] === '');
  ok('getClients exposes stage', call(c, 'getClients', {}).data[0].stage === '');
  c.__store.Clients[0]['Payment Terms'] = '60 days';
  const u = c._upsertClientFields('eagle cement', { email: 'e@x.example', paymentTerms: 'COD' }, 'ana');
  ok('_upsertClientFields matches case-insensitively and fills blanks only', !u.created && c.__store.Clients[0]['Email'] === 'e@x.example' && c.__store.Clients[0]['Payment Terms'] === '60 days', c.__store.Clients[0]);
}

/* ── 12 · the activity log carries a Ref No for the generic stores ────────────────────────── */
{
  sec('12 · _logActivity');
  const c = load();
  call(c, 'saveMarketingRecord', { entity: 'leads', record: JSON.stringify({ company: 'Cemex' }), actorName: 'Mkt', actorRole: 'marketing' });
  let log = c.__store.ActivityLog || [];
  ok('a marketing save now logs its LEAD- id as Ref No (was blank since it shipped)', log.length === 1 && /^LEAD-/.test(log[0]['Ref No']) && log[0]['Module'] === 'Marketing', log[0]);
  plant(c);
  log = c.__store.ActivityLog;
  ok('a lead-gen save logs module Lead Gen with the PLT- id', log.length === 2 && log[1]['Module'] === 'Lead Gen' && /^PLT-/.test(log[1]['Ref No']) && log[1]['User'] === 'Ana Reyes', log[1]);
  const g = call(c, 'getActivityLog', { user: 'Ana Reyes' });
  ok('getActivityLog returns it for the daily report', g.data.length === 1 && g.data[0].module === 'Lead Gen');
}

/* ── 13 · calls ───────────────────────────────────────────────────────────────────────────── */
{
  sec('13 · logSalesCall / deleteSalesCall');
  const c = load();
  const today = c._lgDay();
  const pn = plant(c).id, cn = contact(c, pn).id;
  let r = call(c, 'logSalesCall', Object.assign({ kind: 'Warm', contactNo: cn, outcome: 'No answer' }, LG));
  ok('an unknown kind is refused', !r.success && /Cold or Follow-up/.test(r.message), r);
  r = call(c, 'logSalesCall', Object.assign({ kind: 'Cold', contactNo: cn, outcome: 'Connected' }, LG));
  ok('a lead-gen call needs an outcome from the closed list', !r.success && /Outcome must be/.test(r.message), r);
  r = call(c, 'logSalesCall', Object.assign({ kind: 'Cold', contactNo: 'CTC-x', outcome: 'No answer' }, LG));
  ok('an unknown contact is refused', !r.success, r);
  r = call(c, 'logSalesCall', Object.assign({ kind: 'Cold', contactNo: cn, outcome: 'No answer' }, LG));
  ok('a lead-gen call must say who was reached (A279)', !r.success && /who you reached/.test(r.message), r);
  r = call(c, 'logSalesCall', callp('Cold', cn, 'No answer', 'Voicemail / no answer'));
  const row = c.__store.SalesCalls[0];
  ok('the call row is 11 wide, named from the contact, dated today, with who was reached', r.success && row.__arity === 11 && row['Kind'] === 'Cold' && row['Contact No'] === cn && row['Contact'] === 'R. Santos' && row['Company'] === 'Holcim Philippines' && row['Date'] === today && row['Reached'] === 'Voicemail / no answer', row);
  ok('one touch, keyed on the call', c.__store.LgTouches.length === 1 && c.__store.LgTouches[0]['Ref No'] === r.callNo && c.__store.LgTouches[0]['Channel'] === 'Call');
  r = call(c, 'logSalesCall', callp('Follow-up', cn, 'Wrong person', 'Gatekeeper'));
  ok('"Wrong person" flips a New contact to Wrong Person', c.__store.LgContacts[0]['Status'] === 'Wrong Person', c.__store.LgContacts[0]);
  r = call(c, 'logSalesCall', Object.assign(callp('Cold', cn, 'No answer', 'Voicemail / no answer'), { date: c._lgAddDays(today, 1) }));
  ok('a future call date is refused', !r.success && /future/.test(r.message), r);
  r = call(c, 'logSalesCall', { contact: 'Somebody', company: 'Somewhere', outcome: 'Connected', actorRole: 'sales', actorName: 'Gerald' });
  ok('a rep\'s plain call is unchanged: free outcome, blank kind, no reached, no touch', r.success && c.__store.SalesCalls[2]['Kind'] === '' && c.__store.SalesCalls[2]['Reached'] === '' && c.__store.SalesCalls[2].__arity === 11 && c.__store.LgTouches.length === 2, c.__store.SalesCalls[2]);
  const g = call(c, 'getSalesCalls', { kind: 'Cold' });
  ok('getSalesCalls filters by kind and exposes it', g.data.length === 1 && g.data[0].kind === 'Cold' && g.data[0].contactNo === cn, g.data);
  const first = c.__store.SalesCalls[0]['Call No'];
  r = call(c, 'deleteSalesCall', Object.assign({ rowIndex: 2, callNo: 'CALL-000000-999' }, LG));
  ok('a stale rowIndex with the wrong callNo is refused', !r.success && /moved/.test(r.message) && c.__store.SalesCalls.length === 3, r);
  r = call(c, 'deleteSalesCall', Object.assign({ rowIndex: 2, callNo: first }, LG));
  ok('the right callNo deletes the call and its touch', r.success && c.__store.SalesCalls.length === 2 && c.__store.LgTouches.every(t => t['Ref No'] !== first), c.__store.LgTouches);
  r = call(c, 'deleteSalesCall', { rowIndex: 3, actorRole: 'sales', actorName: 'Gerald' });
  ok('the rep\'s page, which sends no callNo, still deletes', r.success && c.__store.SalesCalls.length === 1, r);
  r = call(c, 'deleteSalesCall', { rowIndex: 9, actorRole: 'sales', actorName: 'Gerald' });
  ok('a rowIndex past the end is refused rather than a silent no-op', !r.success, r);
}

/* ── 14 · soft delete ─────────────────────────────────────────────────────────────────────── */
{
  sec('14 · deleteLeadgenRecord');
  const c = load();
  const today = c._lgDay();
  const p1 = plant(c).id, p2 = plant(c, { plantSite: 'Davao' }).id;
  let r = call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'plants', id: p2, rowIndex: 2 }, LG));
  ok('id must match the row', !r.success && /moved/.test(r.message), r);
  r = call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'plants', id: p1, rowIndex: 2 }, { actorRole: 'sales', actorName: 'G' }));
  ok('a rep cannot delete', !r.success, r);
  r = call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'plants', id: p1, rowIndex: 2 }, LG));
  ok('today\'s plant is soft-deleted', r.success && c.__store.LgPlants[0]['Deleted On'] === today && c.__store.LgPlants.length === 2, c.__store.LgPlants[0]);
  ok('…gone from getLeadgen and from the count', call(c, 'getLeadgen', { entity: 'plants' }).data.plants.length === 1 && call(c, 'getLeadgenCounts', {}).day.accounts === 1);
  r = call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'plants', id: p1, rowIndex: 2 }, LG));
  ok('deleting twice is a no-op, not an error', r.success && /already/.test(r.message), r);
  c.__store.LgPlants[1]['Researched On'] = c._lgAddDays(today, -1);
  r = call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'plants', id: p2, rowIndex: 3 }, LG));
  ok('yesterday\'s row needs the director', !r.success && /director/.test(r.message), r);
  r = call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'plants', id: p2, rowIndex: 3 }, DIR));
  ok('…who can', r.success && c.__store.LgPlants[1]['Deleted On'] === today, r);
  r = save(c, 'plants', { rowIndex: 2, plantNo: p1, notes: 'zombie' });
  ok('a deleted row cannot be edited', !r.success && /deleted/.test(r.message), r);
  r = call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'touches', id: 'x', rowIndex: 2 }, LG));
  ok('touches are not deletable by hand', !r.success, r);
}

/* ── 15 · settings coercion ───────────────────────────────────────────────────────────────── */
{
  sec('15 · getFlowSettings');
  const c = load();
  settings(c, { lgHolidays: '2026-12-25', lgQuotaPlants: '12', lgWorkingDays: 'Mon,Tue,Wed,Thu,Fri,Sat' });
  const d = call(c, 'getFlowSettings', {}).data;
  ok('a date string stays a string (parseFloat would have made it 2026)', d.lgHolidays === '2026-12-25', d.lgHolidays);
  ok('a numeric string becomes a number', d.lgQuotaPlants === 12);
  ok('a list stays a list', d.lgWorkingDays === 'Mon,Tue,Wed,Thu,Fri,Sat');
  ok('defaults are merged', d.lgQuotaEod === 1 && d.lgQuotaAttemptsMax === 50 && d.lgMaxBatch === 60 && d.quotationFollowUpDays === 7);
  const k = call(c, 'getLeadgenCounts', { weekStart: '2026-12-21' });
  ok('the counter sees the six-day week minus Christmas', k.week.workingDays.length === 5 && k.week.workingDays.indexOf('2026-12-25') === -1 && k.week.workingDays.indexOf('2026-12-26') !== -1, k.week.workingDays);
}

/* ── 16 · adversarial: the shapes a retrying browser, a stale tab or a curious user can send ─── */
{
  sec('16 · adversarial');
  const c = load();
  const today = c._lgDay();
  let r = call(c, 'saveLeadgenRecord', Object.assign({ entity: 'plants', record: '[]' }, LG));
  ok('a JSON array as the record is refused, not written', !r.success, r);
  r = call(c, 'saveLeadgenRecord', Object.assign({ entity: 'plants', record: '5' }, LG));
  ok('a JSON number as the record is refused', !r.success, r);
  r = call(c, 'saveLeadgenRecord', Object.assign({ entity: 'plants', record: '{bad' }, LG));
  ok('broken JSON is refused', !r.success && /JSON/.test(r.message), r);
  r = call(c, 'saveLeadgenRecord', Object.assign({ entity: 'touches', record: '{}' }, LG));
  ok('the touches sheet cannot be written by hand', !r.success, r);
  r = call(c, 'saveLeadgenRecord', Object.assign({ entity: 'plants', record: JSON.stringify({ company: '   ', sector: 'Cement', territory: 'Luzon' }) }, LG));
  ok('a whitespace company is "required"', !r.success && /Company is required/.test(r.message), r);
  r = plant(c, {}, { actorRole: 'LEADGEN', actorName: 'Ana Reyes' });
  ok('role comparison is case-insensitive', r.success, r);
  const pn = r.id;
  r = save(c, 'contacts', { rowIndex: 2, contactNo: 'CTC-x', plantNo: pn, name: 'X' });
  ok('a contact update aimed at a plant row (rowIndex 2 of the wrong sheet) is refused', !r.success, r);
  r = save(c, 'contacts', { plantNo: pn, name: '<script>alert(1)</script>', email: 'a@b.example', role: 'Other' });
  ok('markup is stored verbatim (the page escapes on render)', r.success && c.__store.LgContacts[0]['Name'] === '<script>alert(1)</script>');
  const cn = r.id;
  r = save(c, 'batches', { kind: 'Intro', contactNos: '  ' + cn + ' ,, ' + cn + '\n ' + cn + '  ' });
  ok('a messy contact list still dedupes to one', r.success && c.__store.LgEmailBatch[0]['Count'] === 1, c.__store.LgEmailBatch[0]);
  r = save(c, 'batches', { kind: 'Intro', contactNos: { a: 1 } });
  ok('an object where a list was expected is refused', !r.success, r);
  r = save(c, 'batches', { kind: 'Intro', contactNos: [cn], date: '2026-9-1' });
  ok('a malformed date is refused, not silently today', !r.success && /not a date/.test(r.message), r);
  r = save(c, 'batches', { kind: 'Intro', contactNos: [cn], date: new Date(2026, 8, 14, 23, 59).toISOString() });
  ok('an ISO datetime typed as a date is accepted through _lgDayOf or refused as future — never a crash', typeof r.success === 'boolean', r);
  r = call(c, 'getLeadgenCounts', { date: 'garbage', weekStart: 'x', user: 12 });
  ok('garbage filters fall back to today and no user filter', r.success && r.date === today, r);
  r = call(c, 'getLeadgenFollowups', { date: '2026-13-45' });
  ok('an impossible date still answers', r.success, r);
  r = call(c, 'getLeadgen', { entity: 'nope' });
  ok('an unknown entity returns an empty map, not an error', r.success && Object.keys(r.data).length === 0, r);
  r = call(c, 'deleteLeadgenRecord', Object.assign({ entity: 'plants', id: pn, rowIndex: '2; DROP' }, LG));
  ok('a non-numeric rowIndex that parseInt salvages still has to match the id', r.success, r);
  // sixty contacts in one batch: within the limit, sixty touches, sixty intro stamps
  const c2 = load();
  const p2 = plant(c2).id;
  const nos = [];
  for (let i = 0; i < 60; i++) nos.push(contact(c2, p2, { name: 'C' + i, email: 'c' + i + '@x.example' }).id);
  r = save(c2, 'batches', { kind: 'Intro', contactNos: nos });
  ok('a full 60-contact batch: 60 touches, 60 intro stamps, Count 60', r.success && c2.__store.LgTouches.length === 60 && c2.__store.LgContacts.every(x => x['Intro Sent'] === c2._lgDay()) && c2.__store.LgEmailBatch[0]['Count'] === 60, r);
  nos.push(contact(c2, p2, { name: 'C61', email: 'c61@x.example' }).id);
  r = save(c2, 'batches', { kind: 'Intro', contactNos: nos });
  ok('61 is refused', !r.success && /at most 60/.test(r.message), r);
}

/* ── 17 · getLeadgenDay: the evidence under each of the nine is exactly the rows that made it ── */
{
  sec('17 · getLeadgenDay');
  const c = load();
  const today = c._lgDay(), yday = c._lgAddDays(today, -1);
  settings(c, { lgRepLuzon: 'gerald' });
  const p1 = plant(c).id, p2 = plant(c, { company: 'Apex Mining', plantSite: 'Maco', sector: 'Mining', territory: 'VisMin' }).id;
  const c1 = contact(c, p1, { emailVerified: 'Pattern' }).id, c2 = contact(c, p1, { name: 'M. Cruz', email: 'm.cruz@x.example' }).id;
  c.__store.LgPlants[1]['Researched On'] = yday;
  save(c, 'batches', { kind: 'Intro', contactNos: [c1, c2], timeSlot: '08:30' });
  call(c, 'logSalesCall', Object.assign(callp('Cold', c2, 'Interested', 'Decision-maker'), { notes: 'asked for a deck' }));
  call(c, 'logSalesCall', callp('Follow-up', c1, 'Referred', 'Gatekeeper'));
  save(c, 'linkedin', { contactNo: c2, kind: 'Connection request' });
  save(c, 'suppliers', { company: 'Bulacan Bolts Trading', category: 'Fasteners', location: 'Bulacan', contact: 'Mr. Reyes' });
  save(c, 'contacts', { rowIndex: 2, contactNo: c1, nextCallDate: c._lgAddDays(today, 1) });
  const lead = save(c, 'leads', { plantNo: p1, contactNo: c1, rightPerson: true, ownMaintenance: true, flangedOrHydraulic: true, saidYes: true, pain: 'leaks' });
  save(c, 'leads', { rowIndex: 2, leadNo: lead.id, status: 'Presentation Booked', presentationDate: '2026-12-01', attendees: 'R. Santos, plant manager, Gerald' });
  call(c, 'submitDailyReport', { user: 'Ana Reyes', role: 'leadgen', date: today, highlights: 'good day', clientRef: 'DR-2', actorName: 'Ana Reyes', actorRole: 'leadgen' });
  const d = call(c, 'getLeadgenDay', {});
  ok('accounts: today\'s one, with its details; yesterday\'s excluded', d.success && d.accounts.length === 1 && d.accounts[0].company === 'Holcim Philippines' && d.accounts[0].sector === 'Cement', d.accounts);
  ok('suppliers researched today, with contact and location', d.suppliers.length === 1 && d.suppliers[0].company === 'Bulacan Bolts Trading' && d.suppliers[0].contact === 'Mr. Reyes' && d.suppliers[0].location === 'Bulacan', d.suppliers);
  ok('the intro batch lists both contacts with name, email and company', d.introBatches.length === 1 && d.introBatches[0].contacts.length === 2 && d.introBatches[0].contacts[1].email === 'm.cruz@x.example', d.introBatches);
  ok('every call, with who was reached', d.calls.length === 2 && d.calls.every(x => x.reached) && d.calls[0].company === 'Holcim Philippines', d.calls);
  ok('conversations: only the decision-maker call, with its note', d.conversations.length === 1 && d.conversations[0].contact === 'M. Cruz' && d.conversations[0].notes === 'asked for a deck', d.conversations);
  ok('linkedin: the request, with the contact and company', d.linkedin.length === 1 && d.linkedin[0].kind === 'Connection request' && d.linkedin[0].name === 'M. Cruz' && d.linkedin[0].company === 'Holcim Philippines', d.linkedin);
  ok('scheduled calls: the contact and the day booked', d.scheduledCalls.length === 1 && d.scheduledCalls[0].nextCallDate === c._lgAddDays(today, 1) && d.scheduledCalls[0].name === 'R. Santos', d.scheduledCalls);
  ok('presentation booked today: plant, date, attendees', d.meetings.length === 1 && d.meetings[0].plantSite === 'Bulacan' && d.meetings[0].attendees === 'R. Santos, plant manager, Gerald', d.meetings);
  ok('the end-of-day report: submitted, once', d.eod && d.eod.status === 'Submitted' && d.eod.submitCount === 1, d.eod);
  ok('crm: things were logged', d.crm > 0, d.crm);
  const dy = call(c, 'getLeadgenDay', { date: yday });
  ok('yesterday shows yesterday\'s account and nothing else', dy.accounts.length === 1 && dy.accounts[0].plantNo === p2 && dy.calls.length === 0 && dy.linkedin.length === 0 && dy.eod === null, dy);
  const k = call(c, 'getLeadgenCounts', {});
  ok('the evidence counts match the counter exactly',
     k.day.accounts === d.accounts.length && k.day.suppliers === d.suppliers.length && k.day.conversations === d.conversations.length &&
     k.day.linkedin === d.linkedin.length && k.day.emails === d.introBatches[0].contacts.length && k.day.attempts === d.calls.length + k.day.emails + k.day.linkedin &&
     k.day.scheduled === d.scheduledCalls.length + d.meetings.length && k.day.eod === 1, [k.day, d]);
}

/* ── 18 · the live break: what the DEPLOYED browser sends, against a script that enforces ───── */
{
  sec('18 · a direct post from the deployed client (A277-3)');
  const c = load();
  c.__props.FLOW_MUTATION_SECRET = 's3cret';        // enforcement ON, as it is in production
  const pn = plant(c, {}, LG, { flowSecret: 's3cret' }).id;
  const cn = contact(c, pn, {}, LG, { flowSecret: 's3cret' }).id;

  /* report.html posts straight to /exec with actorName from localStorage and NO flowSecret — it
     has no idea the action was secured, because only its own FLOW_SECURED_ACTIONS decides. This is
     the exact call that alerted "This action must be performed through the app (signed in)". */
  let r = call(c, 'logSalesCall', { contact: 'Somebody', company: 'Local Supply', outcome: 'Connected', actorName: 'Gerald', actorRole: 'sales' });
  ok('a rep\'s plain call log goes through again', r.success, r);
  r = call(c, 'logSalesCall', callp('Cold', cn, 'No answer', 'Voicemail / no answer'));
  ok('…and so does the lead-gen call', r.success, r);
  r = call(c, 'deleteSalesCall', { rowIndex: 2, actorRole: 'sales', actorName: 'Gerald' });
  ok('…and removing one', r.success, r);

  // The new actions stay shut: nothing deployed calls them, so there is no one to break.
  r = call(c, 'saveLeadgenRecord', { entity: 'plants', record: JSON.stringify({ company: 'Spoof', sector: 'Cement', territory: 'Luzon' }), actorName: 'Not Ana', actorRole: 'leadgen' });
  ok('saveLeadgenRecord without the secret is still refused', !r.success && /through the app/.test(r.message), r);
  r = call(c, 'deleteLeadgenRecord', { entity: 'plants', id: pn, rowIndex: 2, actorName: 'x', actorRole: 'leadgen' });
  ok('deleteLeadgenRecord without the secret is still refused', !r.success && /through the app/.test(r.message), r);
  r = call(c, 'saveLeadgenRecord', Object.assign({ entity: 'plants', record: JSON.stringify({ company: 'Via Flask', sector: 'Cement', territory: 'Luzon' }) }, LG, { flowSecret: 's3cret' }));
  ok('…and go through when Flask stamps the secret', r.success, r);
}

/* ── 19 · LinkedIn is a logged channel ─────────────────────────────────────────────────────── */
{
  sec('19 · LinkedIn');
  const c = load();
  const today = c._lgDay();
  const pn = plant(c).id, cn = contact(c, pn, { linkedin: 'https://linkedin.com/in/rsantos' }).id;
  let r = save(c, 'linkedin', { contactNo: 'CTC-x', kind: 'Message' });
  ok('an unknown contact is refused', !r.success, r);
  r = save(c, 'linkedin', { contactNo: cn, kind: 'Poke' });
  ok('an unknown kind is refused with the list', !r.success && /Connection request/.test(r.message), r);
  r = save(c, 'linkedin', { contactNo: cn, kind: 'Connection request' }, LG, { clientRef: 'LI-1' });
  ok('a request is one touch on the contact, dated today', r.success && c.__store.LgTouches.length === 1 && c.__store.LgTouches[0]['Channel'] === 'LinkedIn' && c.__store.LgTouches[0]['Kind'] === 'Connection request' && c.__store.LgTouches[0]['Sent On'] === today, c.__store.LgTouches);
  const again = save(c, 'linkedin', { contactNo: cn, kind: 'Connection request' }, LG, { clientRef: 'LI-1' });
  ok('a replayed clientRef logs once', again.success && again.replayed === true && c.__store.LgTouches.length === 1);
  r = save(c, 'linkedin', { contactNo: cn, kind: 'Message' }, { actorRole: 'sales', actorName: 'G' });
  ok('a rep cannot log a lead-gen touch', !r.success, r);
  r = save(c, 'linkedin', { contactNo: cn, kind: 'Message', date: c._lgAddDays(today, 1) });
  ok('a future date is refused', !r.success && /future/.test(r.message), r);
  c.__store.LgContacts[0]['Intro Sent'] = c._lgAddDays(today, -10);
  const due = call(c, 'getLeadgenFollowups', {}).data;
  ok('a LinkedIn touch counts as a follow-up in the cadence', due.length === 1 && due[0].stage === 'Day 7', due);
}

/* ── 20 · local suppliers, and handing one to procurement ─────────────────────────────────── */
{
  sec('20 · suppliers');
  const c = load();
  const today = c._lgDay();
  c._sheet('Suppliers');
  c.__store.Suppliers.push({ 'Supplier': 'Bulacan Bolts Trading', 'Bank Name': 'BDO', 'Account Name': 'BBT', 'Account Number': '123', 'Payment Method': 'TT', 'Currency': 'PHP', 'TIN': '', 'Address': '', 'Notes': '', 'Updated By': 'acct', 'Updated At': 'x' });
  let r = save(c, 'suppliers', { company: '', category: 'Fasteners' });
  ok('a company is required', !r.success, r);
  r = save(c, 'suppliers', { company: 'Bulacan Bolts Trading', category: 'Fasteners', location: 'Bulacan', status: 'Hot' });
  ok('an unknown status is refused', !r.success && /Status must be one of/.test(r.message), r);
  r = save(c, 'suppliers', { company: 'Bulacan Bolts Trading', category: 'Fasteners', location: 'Bulacan', contact: 'Mr. Reyes' }, LG, { clientRef: 'S-1' });
  ok('researched today, status Researching, nothing qualified yet', r.success && c.__store.LgSuppliers[0]['Researched On'] === today && c.__store.LgSuppliers[0]['Status'] === 'Researching' && c.__store.LgSuppliers[0]['Qualified On'] === '' && c.__store.LgSuppliers[0]['Handed Off On'] === '', c.__store.LgSuppliers[0]);
  const id = r.id;
  r = save(c, 'suppliers', { company: '  bulacan bolts  trading ', category: 'x' });
  ok('the same supplier spelled differently is refused', !r.success && /Already listed as/.test(r.message), r);
  r = save(c, 'suppliers', { rowIndex: 2, supplierNo: id, status: 'Qualified' });
  ok('→ Qualified stamps Qualified On', r.success && c.__store.LgSuppliers[0]['Qualified On'] === today && c.__store.LgSuppliers[0]['Handed Off On'] === '', c.__store.LgSuppliers[0]);
  ok('…and touches nothing in the Suppliers master yet', c.__store.Suppliers.length === 1 && c.__store.Suppliers[0]['Address'] === '');
  c.__store.LgSuppliers[0]['Qualified On'] = '2026-01-05';
  r = save(c, 'suppliers', { rowIndex: 2, supplierNo: id, status: 'Handed Off' });
  ok('→ Handed Off stamps Handed Off On and keeps the first Qualified On', r.success && c.__store.LgSuppliers[0]['Handed Off On'] === today && c.__store.LgSuppliers[0]['Qualified On'] === '2026-01-05', c.__store.LgSuppliers[0]);
  const sup = c.__store.Suppliers[0];
  ok('the hand-off fills the blank address in the Suppliers master and leaves the bank details alone', sup['Address'] === 'Bulacan' && sup['Bank Name'] === 'BDO' && sup['Account Number'] === '123' && /Lead-gen prospect/.test(sup['Notes']) && c.__store.Suppliers.length === 1, sup);
  ok('the result says so', r.supplier === 'Bulacan Bolts Trading' && r.supplierCreated === false, r);
  r = save(c, 'suppliers', { company: 'Cebu Hydraulics', location: 'Cebu', status: 'Handed Off' });
  ok('a brand-new supplier handed off straight away lands in the master as a new row', r.success && r.supplierCreated === true && c.__store.Suppliers.length === 2 && c.__store.Suppliers[1]['Supplier'] === 'Cebu Hydraulics' && c.__store.Suppliers[1]['Address'] === 'Cebu', c.__store.Suppliers[1]);
  ok('…and counts as both qualified and handed off today', c.__store.LgSuppliers[1]['Qualified On'] === today && c.__store.LgSuppliers[1]['Handed Off On'] === today);
  const k = call(c, 'getLeadgenCounts', {});
  ok('the counter: 2 researched today, 2 handed off this week', k.day.suppliers === 2 && k.week.weekly.suppliersHandedOff.value === 2, [k.day, k.week.weekly]);
  const g = call(c, 'getLeadgen', { entity: 'suppliers' });
  ok('getLeadgen lists them with dates as strings', g.data.suppliers.length === 2 && g.data.suppliers[0].handedOffOn === today);
}

/* ── 21 · scheduled calls and intel updates ────────────────────────────────────────────────── */
{
  sec('21 · scheduling and research updates');
  const c = load();
  const today = c._lgDay(), tmrw = c._lgAddDays(today, 1);
  const pn = plant(c).id, cn = contact(c, pn).id;
  let r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, nextCallDate: tmrw });
  ok('booking a call stamps Scheduled On today and keeps the date', r.success && c.__store.LgContacts[0]['Scheduled On'] === today && c.__store.LgContacts[0]['Next Call Date'] === tmrw, c.__store.LgContacts[0]);
  c.__store.LgContacts[0]['Scheduled On'] = '2026-01-05';
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, notes: 'unrelated edit' });
  ok('an unrelated edit does not re-stamp it', c.__store.LgContacts[0]['Scheduled On'] === '2026-01-05');
  r = save(c, 'contacts', { rowIndex: 2, contactNo: cn, nextCallDate: c._lgAddDays(today, 3) });
  ok('moving the call re-stamps — it is a new act of scheduling', c.__store.LgContacts[0]['Scheduled On'] === today);
  ok('not due before the day', call(c, 'getLeadgenFollowups', { date: c._lgAddDays(today, 2) }).data.length === 0);
  let due = call(c, 'getLeadgenFollowups', { date: c._lgAddDays(today, 3) }).data;
  ok('on the day it is the first thing listed', due.length === 1 && due[0].stage === 'Scheduled call' && due[0].nextCallDate === c._lgAddDays(today, 3), due);
  ok('…and still listed if missed', call(c, 'getLeadgenFollowups', { date: c._lgAddDays(today, 5) }).data[0].overdue === 2);
  c.__store.LgTouches = c.__store.LgTouches || [];
  c.__store.LgTouches.push({ 'Touch No': 'x', 'Contact No': cn, 'Channel': 'Call', 'Kind': 'Follow-up', 'Ref No': 'x', 'Sent On': c._lgAddDays(today, 3), 'Created By': 'Ana' });
  ok('the call, once made, clears it', call(c, 'getLeadgenFollowups', { date: c._lgAddDays(today, 5) }).data.length === 0);
  ok('a fresh account has no intel update', c.__store.LgPlants[0]['Intel Updated On'] === '');
  r = save(c, 'plants', { rowIndex: 2, plantNo: pn, province: 'Bulacan' });
  ok('an edit that is not research does not stamp it', c.__store.LgPlants[0]['Intel Updated On'] === '');
  r = save(c, 'plants', { rowIndex: 2, plantNo: pn, equipment: 'Kiln line 2 due for overhaul Q1' });
  ok('new intelligence on an existing account stamps Intel Updated On', c.__store.LgPlants[0]['Intel Updated On'] === today, c.__store.LgPlants[0]);
  ok('…and the counter sees it', call(c, 'getLeadgenCounts', {}).day.intelUpdates === 1);
}

/* ── 22 · the end-of-day report is the reps' own submit flow ───────────────────────────────── */
{
  sec('22 · end-of-day report');
  const c = load();
  const today = c._lgDay();
  ok('before submitting, eod is 0', call(c, 'getLeadgenCounts', {}).day.eod === 0);
  const r = call(c, 'submitDailyReport', { user: 'Ana Reyes', role: 'leadgen', date: today, highlights: 'Two decision-makers reached', plan: 'Call Holcim back', countsJson: '{"attempts":41}', clientRef: 'DR-9', actorName: 'Ana Reyes', actorRole: 'leadgen' });
  ok('it submits through the same flow the reps use', r.success && r.submitCount === 1, r);
  ok('eod is 1', call(c, 'getLeadgenCounts', {}).day.eod === 1);
  ok('a second submission is an update, still one report', call(c, 'submitDailyReport', { user: 'Ana Reyes', role: 'leadgen', date: today, clientRef: 'DR-10', actorName: 'Ana Reyes', actorRole: 'leadgen' }).submitCount === 2 && c.__store.DailyReports.length === 1);
  ok('the Director sees it in the reports list', call(c, 'getDailyReports', { date: today }).data.length === 1);
  ok('a sales rep\'s report does not count as the lead-gen one', (() => { call(c, 'submitDailyReport', { user: 'Gerald', role: 'sales', date: today, clientRef: 'DR-11', actorName: 'Gerald', actorRole: 'sales' }); return call(c, 'getLeadgenCounts', { user: 'Gerald' }).day.eod === 0; })());
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
