/* A391 — the shutdown calendar store (FlowAPI 195: getShutdowns, saveShutdown, archiveShutdown).
 *
 * Run:  node tests/flow/shutdown-store.js
 *
 * Neil, 2 Nov 2026: client plant shutdowns, so the reps prepare quotes, rentals and tools before they start. Sales, the
 * director and management add them; EVERY rep sees every entry; only the rep who added one, the director and management
 * change it. Runs the real FlowAPI.gs through its dispatcher (gasload).
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const who = (role, name, user) => ({ actorRole: role, actorName: name, actorUsername: user });
const NEIL = who('director', 'Neil Estur', 'neil'), LARRY = who('management', 'Larry Estur', 'mgmt');
const KIM = who('sales', 'Kimberlyn Blones', 'sales1'), GER = who('sales', 'Gerald Lucena', 'sales2');
const day = (n) => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const add = (c, p, actor) => call(c, 'saveShutdown', Object.assign({ company: 'Petra Cement Inc.', site: 'Palimbang plant', siteKind: 'Plant', start: day(10), end: day(17),
  scope: 'Kiln 2 relining; mill gearbox overhaul', offer: 'Rental,Service', opportunity: 'Torque tools rental for 2 weeks', contact: 'Engr. Dela Rosa', status: 'Confirmed',
  clientRef: 'cr-' + Math.random() }, p || {}, actor || KIM));

sec('1 · the version, an empty calendar, and who may open it');
{
  const store = {}, c = load(GS, store);
  ok('getVersion = 196', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 196);
  [KIM, NEIL, LARRY].forEach(a => ok(a.actorRole + ' opens it', call(c, 'getShutdowns', a).success));
  ['hr', 'admin', 'accounting', 'warehouse', 'marketing', 'leadgen'].forEach(r => ok(r + ' is refused', !call(c, 'getShutdowns', who(r, 'X', r + '1')).success));
  ok('a read creates no tab', !('Shutdowns' in store));
  ok('the read is secured', !call(c, 'getShutdowns', Object.assign({ flowSecret: '' }, KIM)).success);
  const off = load(GS, { FlowSettings: [{ 'Key': 'shutdowns', 'Value': 'off' }] });
  ok('FlowSettings shutdowns off closes it', /switched off/.test(call(off, 'getShutdowns', NEIL).message));
}

sec('2 · adding, and everyone seeing it');
{
  const store = {}, c = load(GS, store), props0 = JSON.stringify(Object.keys(load(GS, {}).__props).sort());
  const r = add(c);
  const row = store.Shutdowns[0];
  ok('a rep adds one: a 24-wide row, a clock id, the dates as text, the client key', r.success && row.__arity === 24 && /^SH-\d{14}-[0-9A-F]{4}$/.test(row['Shutdown No']) &&
     row['Start'] === day(10) && row['End'] === day(17) && row['Client Key'] === 'petra cement' && row['Follow Up By'] === 'Kimberlyn Blones' && row['Created By User'] === 'sales1', [r, row]);
  ok('  one log row', store.ShutdownLog.length === 1 && store.ShutdownLog[0].__arity === 8 && store.ShutdownLog[0]['Kind'] === 'added');
  const g = call(c, 'getShutdowns', GER);
  ok('ANOTHER rep sees it (one shared calendar), and may not change it', g.items.length === 1 && g.items[0].company === 'Petra Cement Inc.' && g.items[0].canEdit === false && g.items[0].mine === false, g.items);
  ok('  its author sees canEdit', call(c, 'getShutdowns', KIM).items[0].canEdit === true && call(c, 'getShutdowns', KIM).items[0].mine === true);
  ok('  the director and management may change it', call(c, 'getShutdowns', NEIL).items[0].canEdit && call(c, 'getShutdowns', LARRY).items[0].canEdit);
  ok('a retry with the same Client Ref is the same entry', call(c, 'saveShutdown', Object.assign({ company: 'Petra Cement Inc.', start: day(10), clientRef: row['Client Ref'] }, KIM)).duplicate === true && store.Shutdowns.length === 1);
  ok('management adds one too', add(c, { company: 'Taganito HPAL', site: 'Taganito', start: day(3), end: day(5), clientRef: 'x1' }, LARRY).success);
  ok('no Script Property was added', JSON.stringify(Object.keys(c.__props).sort()) === props0, Object.keys(c.__props));
}

sec('3 · who may change it');
{
  const store = {}, c = load(GS, store), r = add(c);
  const no = call(c, 'saveShutdown', Object.assign({ shutdownNo: r.shutdownNo, status: 'Postponed' }, GER));
  ok('another rep is refused, and told who can', !no.success && /Only Kimberlyn Blones, the director or management/.test(no.message), no);
  const k = call(c, 'saveShutdown', Object.assign({ shutdownNo: r.shutdownNo, end: day(20), ifUpdatedAt: r.updatedAt }, KIM));
  ok('the rep who added it changes the end; the start is kept', k.success && store.Shutdowns[0]['End'] === day(20) && store.Shutdowns[0]['Start'] === day(10), k);
  ok('  logged as the end, from and to', store.ShutdownLog.some(l => l['Kind'] === 'end' && l['From'] === day(17) && l['To'] === day(20)));
  store.Shutdowns[0]['Updated At'] = new Date(Date.now() - 60000);
  ok('a save over a newer one is refused', call(c, 'saveShutdown', Object.assign({ shutdownNo: r.shutdownNo, notes: 'x', ifUpdatedAt: k.updatedAt }, NEIL)).stale === true);
  ok('the director changes it', call(c, 'saveShutdown', Object.assign({ shutdownNo: r.shutdownNo, status: 'Tentative' }, NEIL)).success);
  ok('management changes it', call(c, 'saveShutdown', Object.assign({ shutdownNo: r.shutdownNo, notes: 'Ask for the turnaround plan' }, LARRY)).success);
  const renamed = Object.assign({}, KIM, { actorName: 'Kim Blones' });
  ok('ownership goes by the username, so a changed display name still owns it', call(c, 'saveShutdown', Object.assign({ shutdownNo: r.shutdownNo, notes: 'y' }, renamed)).success);
  const twin = Object.assign({}, GER, { actorUsername: 'sales1x' });
  ok('  and a different login with the same-looking name does not', !call(c, 'saveShutdown', Object.assign({ shutdownNo: r.shutdownNo, notes: 'z' }, Object.assign(twin, { actorName: 'Kimberlyn Blones' }))).success);
}

sec('4 · the rules an entry must keep');
{
  const c = load(GS, {});
  ok('a client is needed', !add(c, { company: ' ' }).success);
  ok('a start is needed', !add(c, { start: '' }).success);
  ok('the end defaults to the start', add(c, { company: 'One Day Co', start: day(4), end: '' }).item.end === day(4));
  ok('an end before the start is refused', /ends before it starts/.test(add(c, { company: 'A', start: day(5), end: day(4) }).message));
  ok('more than 120 days is refused', !add(c, { company: 'B', start: day(1), end: day(140) }).success);
  ok('a start two years out is refused', !add(c, { company: 'C', start: day(800), end: day(801) }).success);
  ok('an unknown status is refused', !add(c, { company: 'D', status: 'Maybe' }).success);
  ok('an unknown offer is refused', !add(c, { company: 'E', offer: 'Sale,Cake' }).success);
  ok('an unknown site kind is refused', !add(c, { company: 'F', siteKind: 'Moon' }).success);
}

sec('5 · twins, archive and its Undo');
{
  const store = {}, c = load(GS, store), r = add(c);
  const t = add(c, { company: 'PETRA CEMENT INC', start: day(12), end: day(14), clientRef: 'g1' }, GER);
  ok('the same client and site on overlapping days is refused, with the existing entry', !t.success && t.duplicate && t.duplicate.shutdownNo === r.shutdownNo && /already added/.test(t.message), t);
  ok('  the same client at another site is fine', add(c, { site: 'Head office', siteKind: 'Head office', clientRef: 'g2' }, GER).success);
  ok('  the same site later in the year is fine', add(c, { start: day(60), end: day(65), clientRef: 'g3' }, GER).success);
  const a = call(c, 'archiveShutdown', Object.assign({ shutdownNo: r.shutdownNo, reason: 'Client cancelled the turnaround' }, KIM));
  ok('the rep archives their own: off the calendar, kept', a.success && store.Shutdowns.find(x => x['Shutdown No'] === r.shutdownNo)['Archived At'] &&
     !call(c, 'getShutdowns', GER).items.some(x => x.shutdownNo === r.shutdownNo), a);
  ok('  the archived list still has it', call(c, 'getShutdowns', Object.assign({ archived: true }, GER)).items.some(x => x.shutdownNo === r.shutdownNo && x.archived));
  ok('  another rep cannot archive or restore it', !call(c, 'archiveShutdown', Object.assign({ shutdownNo: r.shutdownNo, restore: true }, GER)).success);
  ok('Undo puts it back', call(c, 'archiveShutdown', Object.assign({ shutdownNo: r.shutdownNo, restore: true }, KIM)).success &&
     call(c, 'getShutdowns', GER).items.some(x => x.shutdownNo === r.shutdownNo));
  ok('nothing is ever deleted', store.Shutdowns.length === 3);
}

sec('6 · what is coming: the sales card and the bell');
{
  const store = {}, c = load(GS, store);
  add(c, { company: 'Soon Co', start: day(3), end: day(6), clientRef: 'a' }, KIM);
  add(c, { company: 'Under Way Co', start: day(-2), end: day(2), clientRef: 'b' }, GER);
  add(c, { company: 'Later Co', start: day(40), end: day(42), clientRef: 'c' }, GER);
  add(c, { company: 'Done Co', start: day(5), end: day(6), status: 'Done', clientRef: 'd' }, GER);
  add(c, { company: 'Gerald for Kim', start: day(6), end: day(7), followUpBy: 'Kimberlyn Blones', clientRef: 'e' }, GER);
  const u = call(c, 'getShutdowns', Object.assign({ upcomingDays: 30 }, KIM));
  ok('the next 30 days: under way and coming, not later, not done', u.items.map(x => x.company).join('|') === 'Under Way Co|Soon Co|Gerald for Kim', u.items.map(x => x.company));
  const b = call(c, 'getShutdowns', Object.assign({ countOnly: true }, KIM));
  ok('the bell: 2 start within 7 days, 2 of them Kim\'s (added, or hers to follow up)', b.count === 2 && b.mine === 2 && b.days === 7, b);
  ok('  Gerald\'s count of his own is 0 (he handed his one to Kim)', call(c, 'getShutdowns', Object.assign({ countOnly: true }, GER)).mine === 0);
  const wide = load(GS, { FlowSettings: [{ 'Key': 'shutdownRemindDays', 'Value': 14 }] });
  add(wide, { company: 'Ten Days Co', start: day(10), end: day(11), clientRef: 'f' }, KIM);
  ok('shutdownRemindDays widens the bell', call(wide, 'getShutdowns', Object.assign({ countOnly: true }, KIM)).count === 1);
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
process.exit(FAIL ? 1 : 0);
