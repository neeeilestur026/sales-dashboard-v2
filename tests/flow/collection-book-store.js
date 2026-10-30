/* A384 — the collection details store (FlowAPI 192: getCollectionBook / saveCollectionDetails), and the "+" phone fix
 * in _cbContacts that the Client Book and the supplier list share.
 *
 * Run:  node tests/flow/collection-book-store.js
 *
 * Neil, 29 Oct 2026: "each company or client has a collection details, what bank, address, contact person, and contact
 * number. the accounting, and admin dashboard can see this and they will be only ones to update this, but this will be
 * seen by director, accounting and admin". Runs the real FlowAPI.gs through its dispatcher (gasload), so the secret,
 * the roles and the lock are under test too.
 */
const { load, call } = require('./gasload');
const path = require('path');
const model = require('../../dashboard/js/collection-details-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const NEIL = { actorName: 'Neil Estur', actorRole: 'director', actorUsername: 'neil' };
const ADMIN = { actorName: 'Jiezzel Barrios-Regente', actorRole: 'admin', actorUsername: 'admin1' };
const ACCT = { actorName: 'Maria Santos', actorRole: 'accounting', actorUsername: 'acct1' };
const ACCT2 = { actorName: 'Lea Cruz', actorRole: 'accounting', actorUsername: 'acct2' };
const MGMT = { actorName: 'Larry Estur', actorRole: 'management', actorUsername: 'mgmt' };
const SALES = { actorName: 'Gerald Lucena', actorRole: 'sales', actorUsername: 'sales2' };
const PEOPLE = JSON.stringify([
  { id: 'P1', name: 'Joy Ramos', position: 'AP supervisor', emails: ['Joy.Ramos@Philcement.com'], phones: ['+63 917 123 4567', '(02) 8812 3456'] },
  { id: 'P2', name: 'Carlo Diaz', position: 'Treasury', emails: ['carlo@philcement.com'], phones: ['0918 222 3333'] }]);
const PHIL = { client: 'Philcement Corporation', paysBy: 'Cheque', theirBank: 'BDO', bankNote: 'BDO Ortigas', paysInto: 'METRO_ZAB',
               address: 'Km 23 Ortigas Ave Ext, Taytay, Rizal', whenToCollect: 'Cheque release Fri 1-4 pm', contactsJson: PEOPLE,
               notes: 'Needs the original invoice and the 2307 request.' };

sec('1 · the version, an empty book, and who may read it');
{
  const store = {};
  const c = load(GS, store);
  ok('getVersion = 192', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 192);
  const g = call(c, 'getCollectionBook', ACCT);
  ok('a read of an empty book answers empty and creates no tab', g.success && g.records.length === 0 && g.log.length === 0 &&
     !('CollectionBook' in store) && !('CollectionBookLog' in store), g);
  ok('  with the server\'s lists: Pays By in AR aging\'s Method words', g.lists.paysBy.join() === 'Cheque,Bank Transfer,Online,Cash,Other', g.lists);
  ok('  and our banks to pay into, from the chart (never cash on hand or undeposited)', g.lists.places.map(x => x.code).join() === 'METRO_ZAB,METRO_SJDM,AUB', g.lists.places);
  ok('admin reads it', call(c, 'getCollectionBook', ADMIN).success);
  ok('the director reads it', call(c, 'getCollectionBook', NEIL).success);
  const m = call(c, 'getCollectionBook', MGMT), s = call(c, 'getCollectionBook', SALES);
  ok('management and a rep are refused', !m.success && !s.success && /accounting, admin and the director/.test(m.message), [m, s]);
  const blocked = call(c, 'getCollectionBook', Object.assign({ flowSecret: '' }, ACCT));
  ok('the read is secured: no secret, no book', !blocked.success, blocked);
}

sec('2 · adding a client\'s details');
{
  const store = {};
  const c = load(GS, store);
  const r = call(c, 'saveCollectionDetails', Object.assign({}, PHIL, ACCT));
  const row = (store.CollectionBook || [])[0] || {};
  ok('added, numbered CC-, the full width', r.success && /^CC-\d{6}-\d{3}$/.test(r.clientNo) && row.__arity === 16, r);
  ok('  keyed by _cdKey', row['Key'] === 'philcement', row);
  ok('  every field stored', row['Pays By'] === 'Cheque' && row['Their Bank'] === 'BDO' && row['Bank Note'] === 'BDO Ortigas' && row['Pays Into'] === 'METRO_ZAB' &&
     /Taytay/.test(row['Collection Address']) && row['When To Collect'] === 'Cheque release Fri 1-4 pm' && /2307/.test(row['Notes']), row);
  const people = JSON.parse(row['Contacts JSON']);
  ok('  two people, the email lower-cased, the first made main', people.length === 2 && people[0].emails[0] === 'joy.ramos@philcement.com' && people[0].primary === true, people);
  ok('  "+63 917 123 4567" is stored as typed: no apostrophe inside the JSON', people[0].phones[0] === '+63 917 123 4567', people[0].phones);
  ok('  one log row, created, the full width', store.CollectionBookLog.length === 1 && store.CollectionBookLog[0]['Kind'] === 'created' &&
     store.CollectionBookLog[0].__arity === 8 && /Cheque, BDO, 2 contacts/.test(store.CollectionBookLog[0]['Note']), store.CollectionBookLog);
  ok('  the Clients sheet and the activity log are untouched', !('Clients' in store) && !(store.ActivityLog || []).length);
  ok('  the reply carries the record the page draws', r.record && r.record.client === 'Philcement Corporation' && r.record.contacts.length === 2 && r.record.updatedAt);
  const g = call(c, 'getCollectionBook', NEIL);
  ok('the director reads it back', g.success && g.records.length === 1 && g.records[0].theirBank === 'BDO' && g.records[0].contacts[0].phones[0] === '+63 917 123 4567', g.records);
}

sec('3 · one client per business unit, one client per spelling');
{
  const store = {};
  const c = load(GS, store);
  const a = call(c, 'saveCollectionDetails', Object.assign({ client: 'Aboitiz Power Corporation - TMI BU', paysBy: 'Bank Transfer' }, ACCT));
  const b = call(c, 'saveCollectionDetails', Object.assign({ client: 'Aboitiz Power Corporation- SNAPB BU', paysBy: 'Cheque' }, ACCT));
  ok('two Aboitiz units are two clients (each pays on its own)', a.success && b.success && a.clientNo !== b.clientNo && store.CollectionBook.length === 2,
     store.CollectionBook.map(r => r['Key']));
  const t = call(c, 'saveCollectionDetails', Object.assign({ client: 'ABOITIZ POWER CORPORATION TMI BU', theirBank: 'BPI' }, ACCT));
  const tmi = store.CollectionBook[0];
  ok('  the same unit typed another way is the same row', t.success && t.clientNo === a.clientNo && store.CollectionBook.length === 2, t);
  ok('  that spelling joins its other spellings, the first name stays', tmi['Client'] === 'Aboitiz Power Corporation - TMI BU' && tmi['Aliases'] === 'ABOITIZ POWER CORPORATION TMI BU', tmi);
  ok('  a field not sent keeps its value', tmi['Pays By'] === 'Bank Transfer' && tmi['Their Bank'] === 'BPI', tmi);
  call(c, 'saveCollectionDetails', Object.assign({ client: 'ABOITIZ POWER CORPORATION TMI BU', theirBank: 'BPI Makati' }, ACCT));
  ok('  a spelling already there is not added twice', store.CollectionBook[0]['Aliases'] === 'ABOITIZ POWER CORPORATION TMI BU');
  ok('"THERMA LUZON INC" and "THERMA LUZON, INC." are one client', c._cdKey('THERMA LUZON INC') === c._cdKey('THERMA LUZON, INC.') && c._cdKey('THERMA LUZON, INC') === 'therma luzon');
  ok('  while _canonKey would have merged the units (why _cdKey exists)', c._canonKey('Aboitiz Power Corporation - TMI BU') === c._canonKey('Aboitiz Power Corporation- SNAPB BU'));
}

sec('4 · what it refuses');
{
  const store = {};
  const c = load(GS, store);
  const no = (label, actor, params, re) => { const r = call(c, 'saveCollectionDetails', Object.assign({}, actor, params)); ok(label, !r.success && re.test(r.message), r); };
  no('the director reads but does not change', NEIL, PHIL, /Only accounting and admin/);
  no('management cannot', MGMT, PHIL, /accounting, admin and the director/);
  no('a rep cannot', SALES, PHIL, /accounting, admin and the director/);
  no('no client', ACCT, { client: '  ', paysBy: 'Cash' }, /which client/);
  no('a way to pay not on the list', ACCT, { client: 'X Corp', paysBy: 'GCash' }, /How they pay is one of/);
  no('an account that is not ours', ACCT, { client: 'X Corp', paysInto: 'BDO_X' }, /one of our bank accounts/);
  no('an email that is not one', ACCT, { client: 'X Corp', contactsJson: JSON.stringify([{ name: 'X', emails: ['nope'] }]) }, /not an email/);
  no('nothing at all to save', ACCT, { client: 'X Corp', contactsJson: '[]' }, /Nothing to save yet/);
  no('no name to save it under', { actorRole: 'accounting', actorName: '' }, PHIL, /Sign in again/);
  ok('nothing was written by any of them', !(store.CollectionBook || []).length && !(store.CollectionBookLog || []).length, store.CollectionBook);
  const blocked = call(c, 'saveCollectionDetails', Object.assign({ flowSecret: '' }, PHIL, ACCT));
  ok('the save is secured: no secret, no write', !blocked.success && !(store.CollectionBook || []).length, blocked);
  const f = call(c, 'saveCollectionDetails', Object.assign({ client: 'Y Corp', theirBank: '=HYPERLINK("x")' }, ACCT));
  ok('a bank typed as a formula is stored as text', f.success && /^'=/.test(store.CollectionBook[0]['Their Bank']), store.CollectionBook[0]);
  const long = call(c, 'saveCollectionDetails', Object.assign({ client: 'Z Corp', theirBank: 'B'.repeat(90), whenToCollect: 'W'.repeat(400), notes: 'N'.repeat(900) }, ADMIN));
  const z = store.CollectionBook[1];
  ok('admin saves too; long text is cut to its limit (bank 60, schedule 160, notes 500)', long.success && z['Their Bank'].length === 60 && z['When To Collect'].length === 160 && z['Notes'].length === 500);
}

sec('5 · an edit, the stale-save guard, and the log');
{
  const store = {};
  const c = load(GS, store);
  const first = call(c, 'saveCollectionDetails', Object.assign({ ifUpdatedAt: '' }, PHIL, ACCT));
  ok('a first save that read no record ("") goes through', first.success, first);
  /* the saves below run in one millisecond; the first is put back an hour so each save has its own time, as in life */
  store.CollectionBook[0]['Updated At'] = new Date(Date.now() - 3600e3);
  const seen = new Date(store.CollectionBook[0]['Updated At']).toISOString();
  const race = call(c, 'saveCollectionDetails', Object.assign({ client: 'Philcement Corporation', theirBank: 'Metrobank', ifUpdatedAt: '' }, ACCT2));
  ok('a second "first" save is refused: someone saved meanwhile', !race.success && race.stale === true && /Maria Santos saved this client's details/.test(race.message), race);
  const e = call(c, 'saveCollectionDetails', Object.assign({ client: 'Philcement Corporation', theirBank: 'Metrobank', paysInto: '', ifUpdatedAt: seen }, ACCT2));
  const row = store.CollectionBook[0];
  ok('an edit from the version it read goes through', e.success && row['Their Bank'] === 'Metrobank' && row['Pays Into'] === '' && row['Updated By'] === 'Lea Cruz', row);
  ok('  the rest is kept', row['Pays By'] === 'Cheque' && JSON.parse(row['Contacts JSON']).length === 2 && row['Created By'] === 'Maria Santos');
  const stale = call(c, 'saveCollectionDetails', Object.assign({ client: 'Philcement Corporation', notes: 'x', ifUpdatedAt: seen }, ACCT));
  ok('  and the old version it replaced can no longer save over it', !stale.success && stale.stale === true && /Lea Cruz/.test(stale.message), stale);
  const log = store.CollectionBookLog;
  ok('the edit is one details row naming what changed', log.length === 2 && log[1]['Kind'] === 'details' && log[1]['Note'] === 'Changed their bank, which of our accounts.', log);
  const p = call(c, 'saveCollectionDetails', Object.assign({ client: 'Philcement Corporation', contactsJson: JSON.stringify([{ name: 'Joy Ramos', phones: ['+63 917 123 4567'] }, { name: 'Ana Lim', phones: ['0919 444 5555'] }]) }, ACCT));
  ok('changing the people is a contacts row: who was added and who removed', p.success && log[2]['Kind'] === 'contacts' && log[2]['Note'] === 'Added Ana Lim. Removed Carlo Diaz.', log[2]);
  const same = call(c, 'saveCollectionDetails', Object.assign({ client: 'Philcement Corporation', theirBank: 'Metrobank' }, ACCT));
  ok('a save that changes nothing logs nothing', same.success && log.length === 3, log.length);
  const g = call(c, 'getCollectionBook', ADMIN);
  ok('the log reads back per client, newest last', g.log.length === 3 && g.log.every(l => l.clientNo === first.clientNo) && g.log[0].kind === 'created', g.log);
}

sec('6 · the banks seen on each client\'s cheques');
{
  /* dates as the sheet's yyyy-MM-dd text: a Date made here is not the vm's Date, so _dateStr would not format it */
  const fc = (cust, bank, d, status) => ({ 'Line No': 'FC-' + d, 'Customer': cust, 'Cheque Bank': bank, 'Date': '2026-10-' + String(d).padStart(2, '0'), 'Status': status || 'Recorded' });
  const store = { FieldCollections: [fc('PHILCEMENT CORP.', 'BDO', 3), fc('Philcement Corporation', 'bdo', 20), fc('Philcement Corporation', 'Security Bank', 12),
    fc('Philcement Corporation', 'PNB', 8), fc('Philcement Corporation', 'Landbank', 2), fc('Philcement Corporation', 'UnionBank', 25, 'Undone'),
    fc('Taganito Mining', '', 10), fc('Aboitiz Power Corporation - TMI BU', 'BPI', 5)] };
  const c = load(GS, store);
  const g = call(c, 'getCollectionBook', ACCT);
  const ph = g.chequeBanks.philcement || [];
  ok('newest first, one per bank in any case, three at most, an undone payment left out', ph.map(x => x.bank).join() === 'bdo,Security Bank,PNB' && ph[0].date === '2026-10-20', ph);
  ok('  keyed like the records (the unit kept)', (g.chequeBanks['aboitiz power tmi bu'] || [])[0].bank === 'BPI' && !g.chequeBanks.taganito, g.chequeBanks);
}

sec('7 · the "+" phone fix in the Client Book and the supplier list');
{
  const old = JSON.stringify([{ id: 'P1', name: 'Ana', phones: ["'+65 9643 0027", '0917 111 2222'], emails: [], primary: true }]);
  const store = {
    SupplierBook: [{ 'Supplier No': 'SB-202610-001', 'Supplier': 'CEJN AB', 'Key': 'cejn ab', 'Contacts JSON': old, 'Status': 'Active' }],
    ClientBook: [{ 'Client No': 'CB-202610-001', 'Company': 'Petra Cement', 'Key': 'petra cement', 'Owner': 'Neil Estur', 'Contacts JSON': old, 'Status': 'Active' }]
  };
  const c = load(GS, store);
  const sb = call(c, 'getSupplierBook', ADMIN);
  ok('a supplier phone stored with the old apostrophe reads without it (no data rewritten)', sb.success && sb.suppliers[0].contacts[0].phones[0] === '+65 9643 0027' &&
     store.SupplierBook[0]['Contacts JSON'] === old, sb.suppliers && sb.suppliers[0].contacts);
  const cb = call(c, 'getClientBook', NEIL);
  const cbp = cb.success && (cb.clients || cb.data || [])[0];
  ok('  and a Client Book phone too', cbp && cbp.contacts[0].phones[0] === '+65 9643 0027', cb);
  const s = call(c, 'saveSupplierBookSupplier', Object.assign({ supplierNo: 'SB-202610-001', supplier: 'CEJN AB', contactsJson: JSON.stringify([{ name: 'Ana', phones: ['+65 9643 0027'] }]) }, ADMIN));
  ok('a supplier saved with "+65" stores it without the apostrophe now', s.success && JSON.parse(store.SupplierBook[0]['Contacts JSON'])[0].phones[0] === '+65 9643 0027', store.SupplierBook[0]['Contacts JSON']);
  const re = call(c, 'saveSupplierBookSupplier', Object.assign({ supplierNo: 'SB-202610-001', supplier: 'CEJN AB', contactsJson: JSON.stringify([{ name: 'Ana', phones: ["'+65 9643 0027"] }]) }, ADMIN));
  ok('  and one a page sends back with the apostrophe is cleaned on the way in', re.success && JSON.parse(store.SupplierBook[0]['Contacts JSON'])[0].phones[0] === '+65 9643 0027');
  ok('  while a plain cell keeps its guard (a name typed as a formula)', c._webCell('=1+1') === "'=1+1" && c._cbCell('=1+1') === '=1+1');
}

sec('8 · the page\'s key is the server\'s key');
{
  const c = load(GS, {});
  const names = ['Philcement Corporation', 'PHILCEMENT CORP.', 'Aboitiz Power Corporation - TMI BU', 'Aboitiz Power Corporation- SNAPB BU', 'ABOITIZ POWER CORP HI _BU',
    'Aboitiz Power Corporation - TLI-GEN BU', 'Mariveles Power Generation Corporation (MPGC)', 'SMC-Malita Power Inc.', 'ONE SUBIC POWER GENERATION CORP`',
    'GNPower Dinginin Ltd. Co.', 'THERMA SOUTH, INC.', 'TAIHEIYO CEMENT PHILIPPINES, INC.', 'ACEN - South Luzon Thermal Energy (SLTEC)', 'Itogon-Suyoc Resources', '', '  '];
  const bad = names.filter(n => c._cdKey(n) !== model.cdKey(n));
  ok('cdKey (collection-details-model.js) = _cdKey on ' + names.length + ' live-style names', !bad.length, bad.map(n => [n, c._cdKey(n), model.cdKey(n)]));
  ok('  and the server\'s Pays By list is the page\'s', model.CD_PAYS_BY.join() === c.CD_PAYS_BY.join());
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
process.exit(FAIL ? 1 : 0);
