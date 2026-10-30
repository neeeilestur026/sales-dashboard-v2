/* A384 — collection details (js/collection-details-model.js, js/collection-details.js, collection-details.html) and the
 * card AR aging shows (js/flow-ar-aging.js).
 *
 * Run:  node tests/flow/collection-details.js
 *
 * A small book with the answers worked out by hand, today being Thursday 29 Oct 2026:
 *   1 · the model: keys, what is missing, the rows from the Client master + receivables + saved details, search, CSV
 *   2 · the page: rows, chips, the progress line, a client for accounting and for the director, before FlowAPI 192
 *   3 · AR aging: the card and the prefill in Record Collection, the Details sheet, and management never asking
 *   4 · who sees the page, its own actions only, and the site rules (Apple look, no emoji, hex colour or inline style)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');
/* the model escapes with flow-api.js's flowEsc, as on the page */
global.flowEsc = (function () { const c = { console }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-api.js'), 'utf8'), c); return c.flowEsc; })();
const M = require('../../dashboard/js/collection-details-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));

const CLIENTS = [
  { customer: 'Philcement Corporation', address: 'Km 23 Ortigas Ave Ext, Taytay, Rizal', contactPerson: 'Rico Tan', designation: 'Purchasing', email: 'Rico@Philcement.com', phone: '0917 555 0001' },
  { customer: 'PHILCEMENT CORP.', address: '', contactPerson: '', email: '', phone: '' },
  { customer: 'Aboitiz Power Corporation - TMI BU', address: 'Mati, Davao Oriental', contactPerson: 'Liza Go', email: 'liza@aboitiz.com', phone: '' },
  { customer: 'Aboitiz Power Corporation- SNAPB BU', address: 'Magat, Isabela', contactPerson: 'Ben Uy', email: 'ben@snapb.com', phone: '0918 000 1111' },
  { customer: 'Taganito Mining Corporation', address: 'Claver, Surigao del Norte', contactPerson: 'May Cruz', email: 'may@taganito.ph', phone: '0919 222 3333' }
];
const AR = [
  { arNo: 'AR-202610-001', invNo: '140', soNo: 'SO-1', customer: 'PHILCEMENT CORP.', outstanding: 120000, dueDate: '2026-11-15', status: 'Open' },
  { arNo: 'AR-202609-004', invNo: '131', soNo: 'SO-2', customer: 'Philcement Corporation', outstanding: 30000.5, dueDate: '2026-10-10', status: 'Partial' },
  { arNo: 'AR-202609-009', invNo: '133', soNo: 'SO-3', customer: 'THERMA SOUTH, INC.', outstanding: 451641, dueDate: '2026-09-30', status: 'Open' },
  { arNo: 'AR-202608-002', invNo: '120', soNo: 'SO-4', customer: 'Taganito Mining Corporation', outstanding: 0, dueDate: '2026-08-30', status: 'Paid' }
];
const PEOPLE = [{ id: 'P1', name: 'Joy Ramos', position: 'AP supervisor', emails: ['joy@philcement.com'], phones: ['+63 917 123 4567'], primary: true },
                { id: 'P2', name: 'Carlo Diaz', position: 'Treasury', emails: [], phones: ['(02) 8812 3456'], primary: false }];
const BOOK = {
  success: true,
  records: [
    { clientNo: 'CC-202610-001', client: 'Philcement Corporation', key: 'philcement', aliases: ['PHILCEMENT CORP.'], paysBy: 'Cheque', theirBank: 'BDO', bankNote: 'BDO Ortigas',
      paysInto: 'METRO_ZAB', address: 'Km 23 Ortigas Ave Ext, Taytay, Rizal', whenToCollect: 'Cheque release Fri 1-4 pm', contacts: PEOPLE, notes: 'Original invoice + 2307 request.',
      createdBy: 'Maria Santos', createdAt: '2026-10-20T02:00:00.000Z', updatedBy: 'Maria Santos', updatedAt: '2026-10-28T02:00:00.000Z' },
    { clientNo: 'CC-202610-002', client: 'Aboitiz Power Corporation - TMI BU', key: 'aboitiz power tmi bu', aliases: [], paysBy: 'Bank Transfer', theirBank: '', bankNote: '',
      paysInto: '', address: '', whenToCollect: '', contacts: [], notes: '', createdBy: 'Lea Cruz', createdAt: '2026-10-21T02:00:00.000Z', updatedBy: 'Lea Cruz', updatedAt: '2026-10-21T02:00:00.000Z' }
  ],
  log: [
    { logNo: 'CCL-1', clientNo: 'CC-202610-001', kind: 'created', to: 'Philcement Corporation', note: 'Cheque, BDO, 2 contacts.', by: 'Maria Santos', at: '2026-10-20T02:00:00.000Z' },
    { logNo: 'CCL-2', clientNo: 'CC-202610-001', kind: 'details', note: 'Changed when to collect.', by: 'Maria Santos', at: '2026-10-28T02:00:00.000Z' }
  ],
  chequeBanks: { philcement: [{ bank: 'BDO', date: '2026-10-20' }, { bank: 'Security Bank', date: '2026-09-12' }] },
  lists: { paysBy: ['Cheque', 'Bank Transfer', 'Online', 'Cash', 'Other'], places: [{ code: 'METRO_ZAB', name: 'Metrobank Zabarte' }, { code: 'METRO_SJDM', name: 'Metrobank SJDM' }, { code: 'AUB', name: 'AUB' }] }
};

sec('1 · the model');
eq('one key per client, the business unit kept', ['Philcement Corporation', 'PHILCEMENT CORP.', 'Aboitiz Power Corporation - TMI BU', 'Aboitiz Power Corporation- SNAPB BU', 'THERMA SOUTH, INC.'].map(M.cdKey),
   ['philcement', 'philcement', 'aboitiz power tmi bu', 'aboitiz power snapb bu', 'therma south']);
eq('what is missing, in words', [M.cdMissing(null), M.cdMissing(BOOK.records[0]), M.cdMissing(BOOK.records[1]), M.cdMissing({ paysBy: 'Cash', address: 'x', contacts: [{ phones: ['0917'] }] })],
   [['how they pay', 'their bank', 'the address', 'a contact number'], [], ['their bank', 'the address', 'a contact number'], []]);
eq('  so a status: none, missing or complete', [M.cdStatus(null), M.cdStatus(BOOK.records[1]), M.cdStatus(BOOK.records[0])], ['none', 'missing', 'complete']);
eq('days, money and what a phone link dials', [M.cdDay('2026-10-28T02:00:00.000Z'), M.cdShortDay('2026-10-28', '2026-10-29'), M.cdShortDay('2025-12-30', '2026-10-29'), M.cdMoney(30000.5), M.cdTel('+63 917 123 4567'), M.cdTel("'+63 917"), M.cdTel('(02) 8812 3456')],
   ['28 Oct 2026', '28 Oct', '30 Dec 2025', '₱30,000.50', '+639171234567', '+63917', '0288123456']);
const ROWS = M.cdBuild(CLIENTS, AR, BOOK.records, BOOK.chequeBanks);
eq('one row per client: the master\'s spellings merged, the units apart, a receivable-only customer added', ROWS.map(r => r.key),
   ['philcement', 'aboitiz power tmi bu', 'aboitiz power snapb bu', 'taganito mining', 'therma south']);
const PH = ROWS[0];
ok('  Philcement: both spellings, its two open receivables (earliest due first) and what it owes; the master\'s first contact',
   PH.names.join('|') === 'Philcement Corporation|PHILCEMENT CORP.' && PH.open.map(a => a.arNo).join() === 'AR-202609-004,AR-202610-001' && PH.owed === 150000.5 &&
   PH.master.contactPerson === 'Rico Tan' && PH.rec.clientNo === 'CC-202610-001' && PH.status === 'complete' && PH.cheques.length === 2, PH);
ok('  a paid receivable is not open; THERMA SOUTH (no master row) still lists with what it owes', ROWS[3].owed === 0 && !ROWS[3].open.length && ROWS[4].owed === 451641 && !ROWS[4].master && ROWS[4].status === 'none');
eq('the chips count', M.cdSummary(ROWS), { total: 5, owe: 2, missing: 4, complete: 1, saved: 2 });
const F = (f) => M.cdFilter(ROWS, f).map(r => r.key);
eq('sorted by what they owe (the default), by name, by last update', [F({}), F({ sort: 'name' }), F({ sort: 'updated' })],
   [['therma south', 'philcement', 'aboitiz power tmi bu', 'aboitiz power snapb bu', 'taganito mining'],
    ['aboitiz power tmi bu', 'aboitiz power snapb bu', 'philcement', 'taganito mining', 'therma south'],
    ['philcement', 'aboitiz power tmi bu', 'aboitiz power snapb bu', 'taganito mining', 'therma south']]);
eq('segments: owe us now, missing details, complete', [F({ seg: 'owe' }), F({ seg: 'missing', sort: 'name' }), F({ seg: 'complete' })],
   [['therma south', 'philcement'], ['aboitiz power tmi bu', 'aboitiz power snapb bu', 'taganito mining', 'therma south'], ['philcement']]);
eq('search: a person, a bank, phone digits, an invoice, another spelling', [F({ q: 'joy' }), F({ q: 'bdo' }), F({ q: '9171234' }), F({ q: 'AR-202609-009' }), F({ q: 'corp.' })],
   [['philcement'], ['philcement'], ['philcement'], ['therma south'], ['philcement']]);
eq('the saved details for a name: its key, or a name it is saved under', [M.cdFind(BOOK.records, 'PHILCEMENT CORP').clientNo, M.cdFind(BOOK.records, 'Aboitiz Power Corporation- SNAPB BU'), M.cdFind(BOOK.records, '')],
   ['CC-202610-001', null, null]);
eq('the Client master contact as a person', M.cdMasterPerson(CLIENTS[0]), { name: 'Rico Tan', position: 'Purchasing', emails: ['rico@philcement.com'], phones: ['0917 555 0001'], primary: false });
eq('  none when it has none; AR aging\'s prefill', [M.cdMasterPerson({}), M.cdPrefill(BOOK.records[0]), M.cdPrefill(null), M.cdPrefill({ paysBy: 'GCash' })],
   [null, { method: 'Cheque', depositedTo: 'METRO_ZAB' }, { method: '', depositedTo: '' }, { method: '', depositedTo: '' }]);
{
  const card = M.cdCardHtml(BOOK.records[0], { places: BOOK.lists.places });
  ok('the card: three groups, the bank and its note, our account by name, the address, when, the people with call links',
     /<h4 class="cd-gh">How they pay<\/h4>/.test(card) && /<h4 class="cd-gh">Where to collect<\/h4>/.test(card) && /<h4 class="cd-gh">Who to call<\/h4>/.test(card) &&
     /Their bank<\/span><span class="cd-fv">BDO<span class="cd-fsub">BDO Ortigas<\/span>/.test(card) && /Pays into<\/span><span class="cd-fv">Metrobank Zabarte/.test(card) &&
     /<a class="cd-tel" href="tel:\+639171234567">\+63 917 123 4567<\/a>/.test(card) && /Joy Ramos <span class="cd-badge">Main<\/span>/.test(card) && /<h4 class="cd-gh">Notes<\/h4>/.test(card), card);
  const mini = M.cdCardHtml(BOOK.records[0], { places: BOOK.lists.places, compact: true });
  ok('  compact, for the Record Collection form: how, the main person with a call link, where', /<p class="cd-brief-pay">Cheque · BDO · into Metrobank Zabarte<\/p>/.test(mini) &&
     /<b>Joy Ramos<\/b> <span class="cd-dim">AP supervisor<\/span> <a class="cd-tel" href="tel:\+639171234567">/.test(mini) && /Taytay, Rizal · Cheque release Fri 1-4 pm/.test(mini), mini);
  ok('  nothing saved says so in the caller\'s words; a name is escaped', M.cdCardHtml(null, { empty: 'No details yet.' }) === '<p class="cd-none">No details yet.</p>' &&
     /&lt;b&gt;/.test(M.cdCardHtml({ paysBy: 'Cash', theirBank: '<b>', contacts: [] }, {})));
  ok('  their bank reads "Not needed" for cash', /Their bank<\/span><span class="cd-fv"><span class="cd-dim">Not needed<\/span>/.test(M.cdCardHtml({ paysBy: 'Cash', contacts: [] }, {})));
}
{
  const csv = M.cdCsv(M.cdFilter(ROWS, { sort: 'name' }), BOOK.lists.places).split('\n');
  ok('CSV: a header, then one row per contact person (a client with none still has its row)', csv.length === 1 + 1 + 1 + 2 + 1 + 1 && /^Client,Other names,Pays by,Their bank/.test(csv[0]), csv);
  ok('  with our account by name, what it owes, and a quoted address', csv.some(l => /^Philcement Corporation,PHILCEMENT CORP\.,Cheque,BDO,BDO Ortigas,Metrobank Zabarte,"Km 23 Ortigas Ave Ext, Taytay, Rizal",Cheque release Fri 1-4 pm,Joy Ramos,AP supervisor,Yes,\+63 917 123 4567,joy@philcement\.com,150000\.50,2,,/.test(l)), csv);
}
eq('a history line in words, newest first', [M.cdLogText({ kind: 'created' }), M.cdLogText({ kind: 'contacts' }), M.cdLogFor(BOOK.log, 'CC-202610-001').map(l => l.logNo)], ['Details added', 'Contact people changed', ['CCL-2', 'CCL-1']]);
eq('the emails that are not emails, as typed', M.cdBadEmails('ap@x.ph\nnope\n bad@ '), ['nope', 'bad@']);

sec('2 · the page');
const stubEl = () => ({ id: '', value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, checked: false, dataset: {}, style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, focus() {}, setAttribute() {}, getAttribute: () => null,
  querySelector: () => null, querySelectorAll: () => [], closest: () => null, insertAdjacentHTML() {}, remove() {}, elements: new Proxy({}, { get: () => stubEl() }) });
async function boot(o) {
  o = o || {};
  const p = page(['js/collection-details-model.js', 'js/collection-details.js'], 'collection-details.html', o.session || { username: 'acct1', name: 'Maria Santos', role: 'accounting' },
                 { data: { getClients: CLIENTS, getARAging: AR } });
  ['cdQ', 'cdSort'].forEach(id => { p.els[id] = Object.assign(stubEl(), { id }); });
  p.ctx.__book = clone(o.book || BOOK); p.ctx.__stub = stubEl; p.ctx.__old = !!o.old;
  p.run(`requireCollectionDetailsAccess = function () { return __session; };
    flowToday = function () { return "2026-10-29"; };
    var __posted = [], __shown = '';
    postFlow = function (a, p) { __posted.push({ a: a, p: p });
      if (a === 'getCollectionBook') return Promise.resolve(__old ? { success: false, message: 'Unknown action: getCollectionBook' } : JSON.parse(JSON.stringify(__book)));
      return Promise.resolve({ success: true }); };
    cdShow = function (h, back) { __shown = h; CD.back = back || CD.back; return __stub(); };`);
  await p.boot();
  await new Promise(r => setImmediate(r));
  return p;
}
(async () => {
  const p = await boot();
  const T = p.els.cdTable.innerHTML;
  eq('reads the book privately (a secured read), the Client master and the receivables, and nothing else',
     [p.run('__posted.map(function (x) { return x.a; })'), p.calls.slice().sort()], [['getCollectionBook'], ['getARAging', 'getClients']]);
  ok('one row per client, owing most first', (T.match(/data-open="/g) || []).length === 5 && T.indexOf('therma south') < T.indexOf('"philcement"') && T.indexOf('"philcement"') < T.indexOf('taganito mining'));
  ok('  a row: the name and what it owes; how it pays and the bank; the main contact and phone, and "Complete"',
     /<span class="cd-name">Philcement Corporation<\/span><span class="cd-owed">₱150,000\.50 open<\/span><\/span><span class="cd-r2">Cheque · BDO<\/span><span class="cd-r3"><span>Joy Ramos · \+63 917 123 4567<\/span><span class="cd-badge ok">Complete<\/span>/.test(T), T.slice(0, 1200));
  ok('  a saved one that lacks things says what; one with nothing saved says so', /<span class="cd-badge warn">Missing their bank, the address and 1 more<\/span>/.test(T) &&
     /<span class="cd-name">THERMA SOUTH, INC\.<\/span><span class="cd-owed">₱451,641\.00 open<\/span><\/span><span class="cd-r2"><span class="cd-dim">No details yet<\/span>/.test(T), T);
  ok('the chips count, and All is on', /data-seg="all" aria-pressed="true">All clients <span class="n">5<\/span>/.test(p.els.cdChips.innerHTML) && /Owe us now <span class="n">2<\/span>/.test(p.els.cdChips.innerHTML) &&
     /Missing details <span class="n">4<\/span>/.test(p.els.cdChips.innerHTML) && /Complete <span class="n">1<\/span>/.test(p.els.cdChips.innerHTML), p.els.cdChips.innerHTML);
  eq('the progress line and the count', [p.els.cdProgress.innerHTML, p.els.cdFoot.textContent], ['<span class="n">1</span> of <span class="n">5</span> clients have their collection details', '5 clients']);
  p.run('CD.f.seg = "owe"; cdRender()');
  ok('a chip filters the list', (p.els.cdTable.innerHTML.match(/data-open="/g) || []).length === 2 && p.els.cdFoot.textContent === '2 clients');
  p.run('CD.f.seg = "complete"; CD.f.q = "zzz"; cdRenderTable()');
  ok('  an empty search says no match', /No client matches\./.test(p.els.cdTable.innerHTML));
  p.run('CD.f.seg = "all"; CD.f.q = ""; cdRender()');

  p.run('cdDetail("philcement", null)');
  const d1 = p.run('__shown');
  ok('a client for accounting: status, what it owes, updated by whom, its other spelling', /<h3 id="cdTitle">Philcement Corporation<\/h3>/.test(d1) && /<span class="cd-badge ok">Complete<\/span><span class="cd-badge owed">₱150,000\.50 open<\/span>/.test(d1) &&
     /Updated 28 Oct by Maria Santos · Also written "PHILCEMENT CORP\."/.test(d1), d1.slice(0, 1500));
  ok('  the card, then Edit behind it, the open receivables and the history', /How they pay/.test(d1) && /data-edit aria-expanded="false" aria-controls="cdEdit">Edit<\/button>/.test(d1) &&
     /<form class="cd-form" id="cdEdit"/.test(d1) && /<span class="cd-arno">AR-202609-004<span class="cd-dim"> · Invoice 131<\/span><\/span><span class="cd-due">Due 10 Oct<\/span><span class="cd-amt">₱30,000\.50<\/span>/.test(d1) &&
     /<span class="tm">28 Oct 2026<\/span><span>Details changed<span class="cd-sub">Changed when to collect\.<\/span>/.test(d1));
  ok('  the form: Pays by as pills (Cheque on), the bank with suggestions and the banks on their cheques, our accounts, both people',
     /<input type="radio" name="paysBy" value="Cheque" checked>/.test(d1) && /list="cdBanks"/.test(d1) && /<option value="Security Bank">/.test(d1) &&
     /data-bank="Security Bank">Security Bank <span class="cd-dim">12 Sep<\/span><\/button>/.test(d1) && /<option value="METRO_ZAB" selected>Metrobank Zabarte<\/option>/.test(d1) &&
     (d1.match(/<fieldset class="cd-person"/g) || []).length === 2 && /\+63 917 123 4567<\/textarea>/.test(d1));
  ok('  the Client master contact can be added (Rico is not one of the people yet); its address is the same, so no button', /data-addmaster>Add Rico Tan from the Client master<\/button>/.test(d1) && !/data-useaddr/.test(d1));
  p.run('cdDetail("therma south", null)');
  const d3 = p.run('__shown');
  ok('a client with nothing saved invites accounting to add them, with an empty form', /No details yet\.<\/p><p class="cd-sub">Add how THERMA SOUTH, INC\. pays and who to call\./.test(d3) && />Add details<\/button>/.test(d3) &&
     /<form class="cd-form" id="cdEdit"/.test(d3) && !/data-addmaster/.test(d3));
  p.run('cdDetail("aboitiz power snapb bu", null)');
  const d4 = p.run('__shown');
  ok('  a master address that is not saved yet can be used in one tap', /data-useaddr>Use the Client master address<\/button>/.test(d4) && /data-addmaster>Add Ben Uy from the Client master<\/button>/.test(d4));
  {
    const v = { theirBank: ' BDO ', bankNote: '', paysInto: 'AUB', address: ' 1 Main St ', whenToCollect: ' Fri ', notes: '' };
    const els = {}; Object.keys(v).forEach(k => { els[k] = { value: v[k] }; });
    p.ctx.__form = { elements: els, querySelectorAll: (sel) => /name="paysBy"/.test(sel) ? [{ checked: false, value: 'Cash' }, { checked: true, value: 'Cheque' }] : [] };
    p.run('cdReadPeople = function () { return [{ id: "P1", name: "Joy Ramos", position: "", emails: [], phones: ["+63 917 123 4567"], primary: true }]; }');
    eq('the form sends the whole card, with the version it read', clone(p.run('cdFormParams(__form, CD.rows.find(function (r) { return r.key === "philcement"; }))')),
       { client: 'Philcement Corporation', paysBy: 'Cheque', theirBank: 'BDO', bankNote: '', paysInto: 'AUB', address: '1 Main St', whenToCollect: 'Fri',
         contactsJson: '[{"id":"P1","name":"Joy Ramos","position":"","emails":[],"phones":["+63 917 123 4567"],"primary":true}]', notes: '', ifUpdatedAt: '2026-10-28T02:00:00.000Z' });
    eq('  "" for a client never saved (so a save made meanwhile is caught)', p.run('cdFormParams(__form, CD.rows.find(function (r) { return r.key === "therma south"; })).ifUpdatedAt'), '');
    eq('  a phone that is too short is said as it is typed', clone(p.run('cdBadPhones("0917 123 4567\\n12345\\n+63 2 8812 3456")')), ['12345']);
  }

  const dir = await boot({ session: { username: 'neil', name: 'Neil Estur', role: 'director' } });
  dir.run('cdDetail("philcement", null)');
  const dd = dir.run('__shown');
  ok('the director reads the same card: no Edit, no form, and who keeps it', /How they pay/.test(dd) && !/data-edit/.test(dd) && !/id="cdEdit"/.test(dd) && /Accounting and admin keep these up to date\./.test(dd));
  dir.run('cdDetail("therma south", null)');
  ok('  and with nothing saved, who adds it', /Accounting and admin add them\./.test(dir.run('__shown')) && !/Add details/.test(dir.run('__shown')));
  const adm = await boot({ session: { username: 'admin1', name: 'Admin One', role: 'admin' } });
  adm.run('cdDetail("philcement", null)');
  ok('admin edits, as accounting does', /data-edit/.test(adm.run('__shown')) && /id="cdEdit"/.test(adm.run('__shown')));

  const old = await boot({ old: true });
  ok('before FlowAPI 192 (no such action): it says what to paste, still lists the clients and what they owe, and edits nothing',
     /version 192/.test(old.els.cdNotice.innerHTML) && !/ bad/.test(old.els.cdNotice.innerHTML) && (old.els.cdTable.innerHTML.match(/data-open="/g) || []).length === 5 &&
     (old.run('cdDetail("philcement", null)'), !/data-edit/.test(old.run('__shown'))));
  const down = await boot({ book: { success: false, message: 'Request timed out.' } });
  ok('  any other failure says what went wrong, not "paste 192"', /Could not read the collection details: Request timed out\./.test(down.els.cdNotice.innerHTML) && !/version 192/.test(down.els.cdNotice.innerHTML));
  ok('while it reads, rows shaped like the list (not a spinner)', /class="cd-skel" aria-hidden="true"/.test(p.run('cdSkeleton()')) && /role="status">Reading the clients/.test(p.run('cdSkeleton()')));

  sec('3 · AR aging');
  async function ar(session, book) {
    const a = page(['js/flow-docs.js', 'js/flow-reason.js', 'js/flow-ledger-view.js', 'js/collection-details-model.js', 'js/flow-ar-aging.js'], 'flow-ar-aging.html', session,
                   { data: { getARAging: AR, getInvoices: [] } });
    a.ctx.__book = clone(book || BOOK);
    a.ctx.document.head = { appendChild() {} };   // the ledger view adds its stylesheet
    a.run(`var __posted = [];
      postFlow = function (a, p) { __posted.push(a); return Promise.resolve(a === 'getCollectionBook' ? JSON.parse(JSON.stringify(__book)) : { success: true, data: {} }); };`);
    a.els.collectDepositedTo.options = [{ value: '' }, { value: 'METRO_ZAB' }, { value: 'METRO_SJDM' }, { value: 'AUB' }, { value: '1010' }, { value: '1100' }];
    await a.boot();
    await new Promise(r => setImmediate(r));
    return a;
  }
  const acct = await ar({ username: 'acct1', name: 'Maria Santos', role: 'accounting' });
  ok('accounting: the book is read once, and each receivable gets a Details button', acct.run('__posted').join() === 'getCollectionBook' &&
     /data-cd="PHILCEMENT CORP\." style="margin-left:0\.4rem;">Details<\/button>/.test(acct.els.container.innerHTML), [acct.run('__posted'), acct.els.container.innerHTML.slice(0, 300)]);
  acct.els.collectMethod.value = 'Bank Transfer';
  acct.run('openCollect("AR-202610-001")');
  const cd = acct.els.collectCd.innerHTML;
  ok('Record Collection shows how they pay and whom to call, found under the other spelling', acct.els.collectCd.hidden === false && /<h4 class="cd-gh">Collection details<\/h4>/.test(cd) &&
     /Cheque · BDO · into Metrobank Zabarte/.test(cd) && /tel:\+639171234567/.test(cd) && /href="collection-details\.html\?client=PHILCEMENT%20CORP\.">See all<\/a>/.test(cd), cd);
  eq('  and starts Method and Deposited to from them, saying so', [acct.els.collectMethod.value, acct.els.collectDepositedTo.value, /Method and Deposited to filled from them\./.test(cd)], ['Cheque', 'METRO_ZAB', true]);
  acct.els.collectMethod.value = 'Bank Transfer';
  acct.run('openCollect("AR-202609-009")');
  ok('  a client with nothing saved: says so, links to add them, and leaves the form as it was', /No collection details yet for this client\./.test(acct.els.collectCd.innerHTML) &&
     />Add them<\/a>/.test(acct.els.collectCd.innerHTML) && acct.els.collectMethod.value === 'Bank Transfer' && acct.els.collectDepositedTo.value === '');
  {
    const box = { innerHTML: '' };
    acct.els.cdSheet = Object.assign(stubEl(), { querySelector: (q) => q === '.cd-modal' ? box : null });
    acct.run('arCdSheet("Philcement Corporation", null)');
    ok('Details: the whole card in a sheet, and the way to the page', /<h3 id="cdSheetTitle">Philcement Corporation<\/h3>/.test(box.innerHTML) && /Who to call/.test(box.innerHTML) &&
       /Updated 28 Oct 2026 by Maria Santos/.test(box.innerHTML) && /Open in Collection details<\/a>/.test(box.innerHTML), box.innerHTML.slice(0, 600));
  }
  const mgmt = await ar({ username: 'mgmt', name: 'Larry Estur', role: 'management' });
  mgmt.run('openCollect("AR-202610-001")');
  ok('management (who opens AR aging too) never asks for the book and sees no details', mgmt.run('__posted').indexOf('getCollectionBook') < 0 && !/data-cd=/.test(mgmt.els.container.innerHTML) && mgmt.els.collectCd.hidden === true);
  const oldAr = await ar({ username: 'acct1', name: 'Maria Santos', role: 'accounting' }, { success: false, message: 'Unknown action: getCollectionBook' });
  ok('  and before FlowAPI 192, AR aging is exactly as it was', !/data-cd=/.test(oldAr.els.container.innerHTML) && (oldAr.run('openCollect("AR-202610-001")'), oldAr.els.collectCd.hidden === true));
  const ARH = read('flow-ar-aging.html');
  ok('AR aging loads the model before its own script, and the stylesheet before ledger.css and apple.css', /collection-details-model\.js"><\/script>\s*<script src="js\/flow-ar-aging\.js">/.test(ARH) &&
     /css\/collection-details\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">/.test(ARH) && /<div id="collectCd" hidden><\/div>/.test(ARH));

  sec('4 · who sees it, and the site rules');
  const AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js');
  const navFor = (role) => {
    const store = { session: JSON.stringify({ username: 'u', name: 'U Ser', role, token: 't', loginTime: Date.now() }) };
    let html = '';
    const c = { console, window: {}, localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem() {}, removeItem() {} },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { href: '', pathname: '/x.html', search: '' },
      document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} },
        getElementById: (id) => { const n = { innerHTML: '', querySelectorAll: () => [], addEventListener() {}, classList: { add() {}, remove() {} } };
          if (id === 'navbar') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; } },
      fetch: () => Promise.resolve({ ok: true, json: () => ({}) }), setTimeout: () => 0, clearTimeout() {} };
    c.window = c; vm.createContext(c); require('./hxutil').load(c); vm.runInContext(AUTH, c); vm.runInContext(NAV, c);
    c.renderNavbar('collection-details');
    return { classic: /href="collection-details\.html"/.test(html), rail: vm.runInContext('ledgerPages(' + JSON.stringify(role) + ').map(p => p.href)', c).indexOf('collection-details.html') >= 0 };
  };
  const roles = ['director', 'admin', 'management', 'accounting', 'sales', 'leadgen', 'hr', 'marketing', 'warehouse'];
  eq('accounting\'s, admin\'s and the director\'s navbar and rail link it', roles.filter(r => { const n = navFor(r); return n.classic && n.rail; }), ['director', 'admin', 'accounting']);
  eq('  and no other role has it in either', roles.filter(r => { const n = navFor(r); return n.classic || n.rail; }), ['director', 'admin', 'accounting']);
  {
    const ctx = { window: {}, localStorage: { getItem: () => ctx.__s, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      location: { href: '', pathname: '/x.html', search: '' }, navigator: { userAgent: 'node' }, fetch: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
      document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} } },
      console, Date, JSON, Math, Object, Array, String, Number, Promise };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(AUTH, ctx);
    const admits = (role) => { ctx.__s = JSON.stringify({ username: 'u', name: 'U', role, token: 't', loginTime: Date.now() }); ctx.location.href = ''; return !!vm.runInContext('requireCollectionDetailsAccess()', ctx); };
    eq('the guard admits accounting, admin and the director only (the rest go home)', roles.filter(admits), ['director', 'admin', 'accounting']);
    const GSRC = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
    ok('  the same roles the server lets read; only accounting and admin may change them (page and server)', /var _CD_VIEW = \{ accounting: 1, admin: 1, director: 1 \};/.test(GSRC) &&
       /var _CD_EDIT = \{ accounting: 1, admin: 1 \};/.test(GSRC) && /CD\.canEdit = \['accounting', 'admin'\]\.indexOf/.test(read('js/collection-details.js')));
  }
  const H = read('collection-details.html'), JS = read('js/collection-details.js'), MJ = read('js/collection-details-model.js'), CSS = read('css/collection-details.css');
  ok('guarded by requireCollectionDetailsAccess, its own navbar entry', /requireCollectionDetailsAccess\(\)/.test(JS) && /renderNavbar\('collection-details'\)/.test(JS));
  eq('scripts in order', (H.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), 'theme.js,api.js,auth.js,ledger-nav.js,flow-api.js,collection-details-model.js,collection-details.js');
  ok('its own stylesheet, before ledger.css and apple.css (last)', /css\/collection-details\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">\s*<\/head>/.test(H));
  const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
  const HANDLERS = Object.keys(eval('({' + GS.match(/var HANDLERS = \{([\s\S]*?)\n\};/)[1].replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:\s*\w+/g, ': 1') + '})'));
  const named = (src) => { const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/mg, ''); return HANDLERS.filter(h => new RegExp("'" + h + "'").test(code)).sort(); };
  eq('of ' + HANDLERS.length + ' FlowAPI actions the page names its two, and the two reads it lists clients from', named(JS + MJ), ['getARAging', 'getClients', 'getCollectionBook', 'saveCollectionDetails']);
  ok('  and AR aging adds only the read', named(read('js/flow-ar-aging.js')).indexOf('saveCollectionDetails') < 0 && named(read('js/flow-ar-aging.js')).indexOf('getCollectionBook') >= 0);
  const SRC = H + JS + MJ;
  ok('no emoji, no hex colour, no inline style, no inline script', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{3,6}\b/.test(SRC.replace(/&#\d+;/g, '')) && !/style="/.test(SRC) && !/<script>/.test(H) && !/onclick=/.test(SRC));
  ok('the stylesheet uses tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));
  ok('apple-design: press feedback (scale .97 over 100ms), translucent chrome with a soft edge, a cross-fade under reduced motion',
     /:active[^{]*\{ transform: scale\(\.97\); \}/.test(CSS) && /transition: transform 100ms ease-out/.test(CSS) && /backdrop-filter: blur\(20px\) saturate\(180%\)/.test(CSS) &&
     /\.cd-count::after, \.cd-dhead::after \{ content: ''/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{\s*\.cd-sheet\.cd-enter \{ animation: cd-fade/.test(CSS));
  ok('  solid bars under reduced transparency, defined edges under more contrast, spacing in rem', /@media \(prefers-reduced-transparency: reduce\) \{ \.cd-dhead, \.cd-count \{ background: var\(--hx-card\); -webkit-backdrop-filter: none; backdrop-filter: none; \} \}/.test(CSS) &&
     /@media \(prefers-contrast: more\)/.test(CSS) && (CSS.match(/rem/g) || []).length > 100);
  ok('  phone numbers are big targets (a call link at least 2.25rem tall, 2.75rem on a phone)', /\.cd-tel \{ display: inline-flex; align-items: center; min-height: 2\.25rem;/.test(CSS) && /\.cd-tel \{ min-height: 2\.75rem;/.test(CSS));
  ok('  no confirm: a save over someone else\'s is refused with a Reload, not lost', !/confirm\(/.test(JS) && /r\.stale/.test(JS) && /data-reload/.test(JS));

  console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
