/* A396 — the client information hub store (FlowAPI 199: getClientHub, saveClientAccred, saveClientAccredFile,
 * archiveClientAccredFile, getClientHubFile).
 *
 * Run:  node tests/flow/client-hub-store.js
 *
 * Neil, 5 Nov 2026: every detail of every client in one place, information only, for management, admin, the director and
 * HR (HR without Collection details), with each client's accreditation: the reps' label, since, expiry (usually a year)
 * and the requirement files per year. Runs the real FlowAPI.gs through its dispatcher (gasload), "today" 5 Nov 2026.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const who = (role, name, user) => ({ actorRole: role, actorName: name, actorUsername: user });
const NEIL = who('director', 'Neil Estur', 'neil'), LARRY = who('management', 'Larry Estur', 'mgmt'), ANA = who('admin', 'Ana Admin', 'admin1');
const HR = who('hr', 'Jiezzel Barrios', 'hr1'), KIM = who('sales', 'Kimberlyn Blones', 'sales1');
const D = (m, d, h) => new Date(2026, m - 1, d, h || 10);

function world() {
  const store = {
    Clients: [
      { 'Customer': 'Therma South, Inc.', 'Address': 'Binugao, Toril, Davao City', 'Contact Person': 'Joe Cruz', 'Designation': 'Purchasing', 'Email': 'joe@thermasouth.test', 'Phone': '0917 123 4567',
        'Payment Terms': '30 days', 'Default VAT Type': 'VAT', 'EWT Rate': 2, 'TIN': '123-456-789-000', 'Notes': 'Gate pass needed' },
      { 'Customer': 'Aboitiz Power Corporation - TSI BU', 'Address': 'Toledo', 'Payment Terms': '60 days', 'TIN': '111' },
      { 'Customer': 'Aboitiz Power Corporation - SNAPB BU', 'Address': 'Benguet', 'Payment Terms': '60 days', 'TIN': '222' },
      { 'Customer': 'Petra Cement Inc.', 'Stage': 'Prospect' }
    ],
    ClientBook: [
      { 'Client No': 'CB-1', 'Company': 'THERMA SOUTH INC', 'Owner': 'Kimberlyn Blones', 'Accreditation': 'Accredited', 'Accreditation Updated At': D(10, 22), 'Archived At': '',
        'Contacts JSON': JSON.stringify([{ name: 'Joe Cruz', position: 'Purchasing', emails: [], phones: ['+63 917 123 4567'], primary: true }, { name: 'Ana Reyes', emails: ['ana@thermasouth.test'], phones: [] }]),
        'Sector': 'Power', 'Tier': 'Major', 'Site Address': 'Binugao plant' },
      { 'Client No': 'CB-2', 'Company': 'Therma South, Inc.', 'Owner': 'Gerald Lucena', 'Accreditation': 'On process', 'Accreditation Step': 'Documents submitted', 'Accreditation Updated At': D(11, 1), 'Archived At': '' },
      { 'Client No': 'CB-3', 'Company': 'SMC-Malita', 'Owner': 'Kimberlyn Blones', 'Accreditation': 'Accredited', 'Accredited Until': '2026-12-01', 'Accreditation Updated At': D(10, 22), 'Archived At': '' },
      { 'Client No': 'CB-4', 'Company': 'Philex Mining', 'Owner': 'Gerald Lucena', 'Accreditation': 'Accredited', 'Accredited Until': '2026-10-01', 'Accreditation Updated At': D(10, 25), 'Archived At': '' },
      { 'Client No': 'CB-5', 'Company': 'Old Archived Co', 'Owner': 'Gerald Lucena', 'Accreditation': 'Accredited', 'Archived At': D(11, 4) }
    ],
    CollectionBook: [
      { 'Client No': 'CC-1', 'Client': 'Therma South Inc.', 'Key': 'therma south', 'Pays By': 'Cheque', 'Their Bank': 'BDO', 'Pays Into': 'BPI', 'Collection Address': 'Davao office',
        'When To Collect': 'Fridays', 'Contacts JSON': JSON.stringify([{ name: 'Joe Cruz', emails: ['JOE@thermasouth.test'], phones: [] }, { name: 'May Lim', emails: ['ap@thermasouth.test'], phones: [] }]) },
      { 'Client No': 'CC-2', 'Client': 'Collection Only Co', 'Key': 'collection only', 'Pays By': 'Deposit' }
    ],
    LgAccred: [{ 'Accred No': 'LA-1', 'Plant No': 'P-1', 'Company': 'SMC-Malita', 'Status': 'Approved', 'Approved': '2025-12-01', 'Expiry': '2026-12-01' }],
    FlowSettings: []
  };
  const c = load(GS, store);
  c._now = () => D(11, 5, 10);
  return { c, store };
}
const hub = (c, a) => call(c, 'getClientHub', a || NEIL);
const cardOf = (r, name) => r.cards.find(x => x.company.toLowerCase().indexOf(name.toLowerCase()) === 0);

sec('1 · the version, and who may open it');
{
  const { c, store } = world();
  ok('getVersion = 199', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 199);
  [NEIL, LARRY, ANA, HR].forEach(a => ok(a.actorRole + ' opens it', hub(c, a).success));
  ['sales', 'accounting', 'marketing', 'leadgen', 'warehouse'].forEach(r => ok(r + ' is refused', !hub(c, who(r, 'X', r + '1')).success));
  ok('the read is secured', !call(c, 'getClientHub', Object.assign({ flowSecret: '' }, NEIL)).success);
  ok('a read creates no tab', !('ClientAccred' in store) && !('ClientAccredFiles' in store));
  const w2 = world(); w2.store.FlowSettings = [{ 'Key': 'clientHub', 'Value': 'off' }];
  ok('FlowSettings clientHub off closes it', /switched off/.test(hub(w2.c).message));
}

sec('2 · one card per client, from every source');
{
  const { c } = world(), r = hub(c);
  const t = cardOf(r, 'Therma South');
  ok('Therma South: one card from the master, both reps\' books and Collection details, the master\'s spelling first', !!t && t.company === 'Therma South, Inc.' &&
     t.names.length === 3 && t.owners.join() === 'Kimberlyn Blones,Gerald Lucena', t && t.names);
  ok('  sector, tier and every address with where it came from', t.sector === 'Power' && t.tier === 'Major' && t.addresses.map(a => a.kind).join() === 'Client master,Site', t.addresses);
  ok('  billing: terms, VAT, EWT and TIN', t.billing.terms === '30 days' && t.billing.vatType && t.billing.ewtRate === '2' && t.billing.tin === '123-456-789-000', t.billing);
  const joe = t.people.find(p => p.name === 'Joe Cruz');
  ok('  Joe is one person: the same phone (0917… / +63 917…) and the same email in another case', t.people.filter(p => p.name === 'Joe Cruz').length === 1 &&
     joe.sources.join() === 'Client master,Client Book · Kimberlyn,Collection details' && joe.primary === true && joe.emails.length === 1, joe);
  ok('  everyone from every source: Joe, Ana, May', t.people.map(p => p.name).sort().join() === 'Ana Reyes,Joe Cruz,May Lim', t.people.map(p => p.name));
  ok('  notes keep their source', t.notes[0].source === 'Client master' && t.notes[0].text === 'Gate pass needed');
  ok('  the collection details, for the director', t.collection && t.collection.paysBy === 'Cheque' && t.collection.theirBank === 'BDO' && t.collection.whenToCollect === 'Fridays');
  ok('business units stay apart: two Aboitiz cards', r.cards.filter(x => /^Aboitiz Power/.test(x.company)).length === 2);
  ok('a prospect on the master is a card, with its stage', cardOf(r, 'Petra').stage === 'Prospect');
  ok('an archived Client Book row is not a card', !cardOf(r, 'Old Archived'));
  ok('a client only in Collection details is a card for the director', !!cardOf(r, 'Collection Only'));
  ok('the reply says what the director may do', r.may.edit === true && r.may.collection === true && r.lists.requirements.length === 9 && r.renewDays === 60);
  const h = hub(c, HR), ht = cardOf(h, 'Therma South');
  ok('HR: no Collection details anywhere in the reply, not even its contacts or its clients', !('collection' in ht) && !ht.people.some(p => p.sources.indexOf('Collection details') >= 0) &&
     !cardOf(h, 'Collection Only') && h.may.collection === false && h.may.edit === true && !/BDO|Fridays/.test(JSON.stringify(h)), ht.people);
  ok('management sees them', !!cardOf(hub(c, LARRY), 'Therma South').collection);
}

sec('3 · accreditation from the reps\' labels');
{
  const { c } = world(), r = hub(c);
  const t = cardOf(r, 'Therma South').accred;
  ok('two labels; the latest (Gerald, On process) is the status, and the mismatch is flagged', t.labels.length === 2 && t.labels[0].owner === 'Gerald Lucena' && t.status === 'On process' &&
     t.state === 'On process' && t.mismatch === true && t.labels[0].step === 'Documents submitted', t);
  const m = cardOf(r, 'SMC-Malita').accred;
  ok('SMC-Malita: Accredited, expiry from the rep\'s "until", renew soon (26 days)', m.status === 'Accredited' && m.expires === '2026-12-01' && m.state === 'Renew soon' && m.daysLeft === 26, m);
  ok('  with lead gen\'s tracker line', m.lead.length === 1 && m.lead[0].status === 'Approved' && m.lead[0].expiry === '2026-12-01');
  ok('Philex: Accredited but past its expiry is Expired', cardOf(r, 'Philex').accred.state === 'Expired');
  ok('Petra (no rep has it): No label', cardOf(r, 'Petra').accred.state === 'No label');
  ok('the year in focus is this year, and every requirement but Other counts as missing', m.year === '2026' && m.missing === 8);
}

sec('4 · the hub\'s own dates');
{
  const { c, store } = world(), props0 = JSON.stringify(Object.keys(c.__props).sort());
  ok('a rep may not change them', !call(c, 'saveClientAccred', Object.assign({ company: 'SMC-Malita', since: '2026-01-10' }, KIM)).success);
  const s = call(c, 'saveClientAccred', Object.assign({ company: 'SMC-Malita', since: '2026-01-10', note: 'Renewal form from Engr. Selirio', clientRef: 'r1' }, HR));
  ok('HR sets since; the expiry defaults to a year later, the year to the start\'s', s.success && s.since === '2026-01-10' && s.expires === '2027-01-10' && s.year === '2026', s);
  ok('  one row, keyed by the client; the reps\' label is untouched', store.ClientAccred.length === 1 && store.ClientAccred[0]['Key'] === 'smc malita' && store.ClientBook[2]['Accredited Until'] === '2026-12-01');
  ok('  logged (since, expires, year, note) and in the ActivityLog', store.ClientAccredLog.length === 4 && (store.ActivityLog || []).some(l => l['Module'] === 'Client hub' && l['Action'] === 'Accreditation saved'));
  const m = cardOf(hub(c), 'SMC-Malita').accred;
  ok('the card now uses the hub\'s dates: since, expires 10 Jan 2027, Accredited (66 days left)', m.since === '2026-01-10' && m.expires === '2027-01-10' && m.state === 'Accredited' && m.note === 'Renewal form from Engr. Selirio', m);
  ok('a retry with the same Client Ref is answered once', call(c, 'saveClientAccred', Object.assign({ company: 'Petra Cement Inc.', since: '2026-03-01', clientRef: 'r1' }, ANA)).duplicate === true);
  ok('an expiry before the start is refused', /before it starts/.test(call(c, 'saveClientAccred', Object.assign({ company: 'SMC-Malita', expires: '2025-12-31' }, ANA)).message));
  ok('more than three years is refused', /three years/.test(call(c, 'saveClientAccred', Object.assign({ company: 'SMC-Malita', expires: '2029-06-01' }, ANA)).message));
  ok('a date that is not a date is refused', !call(c, 'saveClientAccred', Object.assign({ company: 'SMC-Malita', since: '10 Jan' }, ANA)).success);
  ok('a start more than five years back is refused', !call(c, 'saveClientAccred', Object.assign({ company: 'Philex Mining', since: '2019-01-01' }, ANA)).success);
  ok('saving the same again changes nothing', call(c, 'saveClientAccred', Object.assign({ company: 'SMC-Malita', since: '2026-01-10' }, ANA)).unchanged === true);
  store.ClientAccred[0]['Updated At'] = new Date(Date.now() - 3600000);
  ok('a save over someone else\'s newer one is refused', call(c, 'saveClientAccred', Object.assign({ company: 'SMC-Malita', note: 'x', ifUpdatedAt: '2020-01-01T00:00:00.000Z' }, LARRY)).stale === true);
  const re = call(c, 'saveClientAccred', Object.assign({ company: 'SMC-Malita', since: '2027-01-10', year: 2027 }, NEIL));
  ok('re-applying: next year\'s start, its own expiry, year 2027', re.success && re.expires === '2028-01-10' && re.year === '2027', re);
  ok('no Script Property was added', JSON.stringify(Object.keys(c.__props).sort()) === props0, Object.keys(c.__props));
}

sec('5 · the requirement files: private, per year, never on the Documents register');
{
  const { c, store } = world(), props0 = JSON.stringify(Object.keys(c.__props).sort());
  let shared = 0, made = 0, saved = [];
  const fold = (name) => ({ getName: () => name, getId: () => 'f-' + name, getFoldersByName: () => ({ hasNext: () => false }), createFolder: (n) => { saved.push(n); return fold(n); },
    createFile: (blob) => { made++; return { getId: () => 'file-ca-' + made, getUrl: () => 'https://drive.test/x', setSharing: () => { shared++; } }; } });
  c.DriveApp.getFolderById = () => fold('root'); c.DriveApp.getRootFolder = () => fold('root');
  c.DriveApp.getFileById = (id) => ({ getBlob: () => ({ getContentType: () => 'application/pdf', getBytes: () => [1, 2] }), getThumbnail: () => ({ getContentType: () => 'image/png', getBytes: () => [3] }) });
  const add = (o, a) => call(c, 'saveClientAccredFile', Object.assign({ company: 'SMC-Malita', year: 2025, requirement: 'Business permit', fileBase64: 'aGVsbG8gd29ybGQ=', fileName: 'Permit 2025.pdf', mimeType: 'application/pdf' }, o || {}, a || ANA));
  const f = add({ clientRef: 'f1' });
  ok('admin adds 2025\'s business permit: a row with its name, type and size', f.success && store.ClientAccredFiles.length === 1 && f.file.requirement === 'Business permit' && f.file.year === '2025' &&
     store.ClientAccredFiles[0]['File ID'] === 'file-ca-1' && store.ClientAccredFiles[0]['File Size'] > 0, f);
  ok('  in _Internal / Client accreditation / <client> / <year>', saved.slice(-4).join('/') === '_Internal/Client accreditation/SMC-Malita/2025', saved);
  ok('  private: sharing is never set, and NOT on the Documents register', shared === 0 && !(store.Documents || []).length);
  ok('  a retry with the same Client Ref is the same file', add({ clientRef: 'f1' }).duplicate === true && store.ClientAccredFiles.length === 1 && made === 1);
  ok('an SVG is refused', /picture/.test(add({ mimeType: 'image/svg+xml', fileName: 'x.svg' }).message));
  ok('over 10 MB is refused', /under 10 MB/.test(add({ fileBase64: 'A'.repeat(14000001) }).message));
  ok('a requirement not on the list is refused', /Pick one of the requirements/.test(add({ requirement: 'Birth certificate' }).message));
  ok('a year out of range is refused', /between 2020/.test(add({ year: 2019 }).message));
  ok('a rep may not add one', !add({}, KIM).success);
  const reuse = call(c, 'saveClientAccredFile', Object.assign({ company: 'SMC-Malita', year: 2026, requirement: 'Business permit', reuseFileNo: f.file.fileNo }, HR));
  ok('re-applying: last year\'s permit listed for 2026, the same Drive file, no second copy', reuse.success && store.ClientAccredFiles.length === 2 && made === 1 &&
     store.ClientAccredFiles[1]['File ID'] === 'file-ca-1' && store.ClientAccredFiles[1]['Year'] === 2026, reuse);
  let m = cardOf(hub(c), 'SMC-Malita').accred;
  ok('the card lists both files, and 2026 now misses one requirement fewer (7)', m.files.length === 2 && m.missing === 7, m);
  ok('  the card never shows the Drive file id', !/file-ca-1/.test(JSON.stringify(hub(c))));
  const got = call(c, 'getClientHubFile', Object.assign({ fileNo: f.file.fileNo }, HR));
  ok('HR reads a file back as base64', got.success && got.mimeType === 'application/pdf' && got.base64 && got.fileName === 'Permit 2025.pdf');
  ok('  a rep may not', !call(c, 'getClientHubFile', Object.assign({ fileNo: f.file.fileNo }, KIM)).success);
  const ar = call(c, 'archiveClientAccredFile', Object.assign({ fileNo: reuse.file.fileNo }, LARRY));
  ok('management archives the 2026 listing: off the card, kept in the sheet and in Drive', ar.success && store.ClientAccredFiles.length === 2 && cardOf(hub(c), 'SMC-Malita').accred.files.length === 1);
  ok('  an archived file is not served', !call(c, 'getClientHubFile', Object.assign({ fileNo: reuse.file.fileNo }, NEIL)).success);
  ok('  archiving twice is refused', /archived already/.test(call(c, 'archiveClientAccredFile', Object.assign({ fileNo: reuse.file.fileNo }, LARRY)).message));
  ok('  Undo puts it back', call(c, 'archiveClientAccredFile', Object.assign({ fileNo: reuse.file.fileNo, restore: true }, LARRY)).success && cardOf(hub(c), 'SMC-Malita').accred.files.length === 2);
  ok('  each step logged', store.ClientAccredLog.filter(l => /^file/.test(l['Kind'])).length === 4);
  ok('no Script Property was added', JSON.stringify(Object.keys(c.__props).sort()) === props0, Object.keys(c.__props));
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' passed'));
process.exit(FAIL ? 1 : 0);
