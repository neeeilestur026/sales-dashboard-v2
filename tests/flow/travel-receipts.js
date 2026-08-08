/* A214 step i — getTravelReceipts.
 *
 * Four properties this file exists to hold down:
 *   • the LEG a receipt belongs to comes from its FILE NAME, not from a column a failed write-back
 *     could have left blank;
 *   • a duplicate left behind by a half-failed replacement resolves to the NEWEST, so the annex never
 *     prints the photo the rep replaced;
 *   • a receipt whose Drive file is gone is reported as a HOLE, never dropped silently — an approval
 *     pack that is quietly one receipt short is the worst outcome available;
 *   • the read is scoped from the SESSION and secured in all three mirrors, because a TRAV number is
 *     guessable and the payload is photographs of somebody's week.
 */
const fs = require('fs');
const path = require('path');
const { load, call } = require('./gasload');

const ROOT = path.resolve(__dirname, '../..');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, c, x) => { if (!c) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

const store = () => ({ TravelReplenishments: [], TravelReplenishmentItems: [], TravelFloats: [],
  Documents: [], ActivityLog: [], PaymentRequests: [], Expenses: [] });

const GAYLE = { actorName: 'Crystal Gayle', actorRole: 'sales' };
const OTHER = { actorName: 'Other Rep', actorRole: 'sales' };
const ACCT  = { actorName: 'Rojan Leo R. Francisco Jr.', actorRole: 'accounting' };
const with_ = (a, b) => Object.assign({}, a, b);

const SAMPLE = JSON.stringify([
  { seq: 1, date: '2026-07-27', kind: 'Transport', description: 'Residence to Terminal',
    means: 'Tricycle', amount: 35, hasReceipt: false },
  { seq: 2, date: '2026-07-27', kind: 'Transport', description: 'Terminal to MRT Kamuning',
    means: 'Bus', amount: 70, hasReceipt: true }
]);

const c = load(null, store());

/* Drive is a black hole in the harness by design, so the files this suite reads are declared here.
   `dead` makes getFileById throw, which is exactly what a trashed file does in production. */
const FILES = {};
c.DriveApp.getFileById = (id) => {
  const f = FILES[id];
  if (!f || f.dead) throw new Error('File not found: ' + id);
  return { getBlob: () => ({ getContentType: () => f.mime || 'image/jpeg',
                             getBytes: () => Buffer.from(f.body || 'JPEGBYTES') }) };
};
let docSeq = 0;
function putDoc(refNo, fileName, opts) {
  const o = opts || {};
  const id = 'file-' + (++docSeq);
  FILES[id] = { mime: o.mime, body: o.body, dead: !!o.dead };
  c.__store.Documents.push({ 'Doc ID': 'DOC-' + docSeq, 'Module': o.module || 'Travel Replenishment',
    'Ref No': refNo, 'Doc Type': 'Travel Receipt', 'File Name': fileName,
    'Drive Link': 'https://drive.test/' + id, 'File ID': o.noFile ? '' : id,
    'Uploaded By': 'Crystal Gayle', 'Uploaded At': o.at || '2026-07-28 09:00:00' });
  return 'DOC-' + docSeq;
}

console.log('== the file name is the key, not the column ==');
eq('receipt-3.jpg', c._travReceiptSeq('receipt-3.jpg'), 3);
eq('two digits', c._travReceiptSeq('receipt-12.png'), 12);
eq('case does not matter', c._travReceiptSeq('RECEIPT-4.JPG'), 4);
eq('a quotation photo is not a receipt', c._travReceiptSeq('photo-a1b2.jpg'), 0);
eq('no extension, no key', c._travReceiptSeq('receipt-5'), 0);
eq('blank', c._travReceiptSeq(''), 0);
eq('null', c._travReceiptSeq(null), 0);
eq('an unrelated document', c._travReceiptSeq('Quotation_2026-001.pdf'), 0);

console.log('\n== a report with two receipts reads back as bytes ==');
const rec = c.saveTravelReplenishment(with_(GAYLE, {
  weekStart: '2026-07-27', purpose: 'Client visit in Makati, City', items: SAMPLE }));
eq('the report saved', rec.success, true);
const NO = rec.travNo;
putDoc(NO, 'receipt-2.jpg', { body: 'BUSRECEIPT' });
{
  const r = c.getTravelReceipts(with_(GAYLE, { travNo: NO }));
  eq('read', r.success, true);
  eq('one receipt', r.data.length, 1);
  eq('attributed to leg 2', r.data[0].seq, 2);
  eq('and it is BYTES, not a Drive link',
     Buffer.from(r.data[0].base64, 'base64').toString(), 'BUSRECEIPT');
  eq('with a mime type the client can build a data: URI from', r.data[0].mimeType, 'image/jpeg');
  ok('and no link field to tempt anyone', r.data[0].link === undefined, r.data[0]);
}

console.log('\n== a half-failed replacement resolves to the NEWEST, never to both ==');
{
  putDoc(NO, 'receipt-2.jpg', { body: 'REPLACEMENT', at: '2026-07-29 11:00:00' });
  const r = c.getTravelReceipts(with_(GAYLE, { travNo: NO }));
  eq('still ONE receipt for leg 2', r.data.length, 1);
  eq('and it is the one that replaced the other',
     Buffer.from(r.data[0].base64, 'base64').toString(), 'REPLACEMENT');
}

console.log('\n== an unattributable file is kept, because there is nothing to choose between them ==');
{
  putDoc(NO, 'scan of the whole day.jpg', { body: 'LOOSE' });
  const r = c.getTravelReceipts(with_(GAYLE, { travNo: NO }));
  eq('two entries now', r.data.length, 2);
  eq('sorted, the unattributable one first', r.data.map(x => x.seq), [0, 2]);
}

console.log('\n== a trashed file is a HOLE, never a silent omission ==');
{
  const id = putDoc(NO, 'receipt-1.jpg', { body: 'TRICYCLE', dead: true });
  const r = c.getTravelReceipts(with_(GAYLE, { travNo: NO }));
  eq('it still comes back', r.data.filter(x => x.docId === id).length, 1);
  const hole = r.data.filter(x => x.docId === id)[0];
  eq('flagged missing', hole.missing, true);
  ok('with no bytes to pretend with', hole.base64 === undefined, hole);
  eq('and the read did not throw', r.success, true);
}

console.log('\n== a row with no File ID is skipped ==');
{
  const before = c.getTravelReceipts(with_(GAYLE, { travNo: NO })).data.length;
  putDoc(NO, 'receipt-9.jpg', { noFile: true });
  eq('nothing was added', c.getTravelReceipts(with_(GAYLE, { travNo: NO })).data.length, before);
}

console.log('\n== the seq filter ==');
{
  const r = c.getTravelReceipts(with_(GAYLE, { travNo: NO, seq: 2 }));
  eq('just that leg', r.data.map(x => x.seq), [2]);
}

console.log('\n== documents belonging to something else never leak in ==');
{
  const before = c.getTravelReceipts(with_(GAYLE, { travNo: NO })).data.length;
  putDoc(NO, 'receipt-3.jpg', { module: 'Quotation' });       // right ref, wrong module
  putDoc('TRAV-9999', 'receipt-3.jpg', {});                   // right module, wrong ref
  eq('neither reached the pack', c.getTravelReceipts(with_(GAYLE, { travNo: NO })).data.length, before);
}

console.log('\n== the read is scoped from the SESSION ==');
{
  eq('travNo is required', c.getTravelReceipts(GAYLE).success, false);
  eq('an unknown report is a message, not a crash',
     c.getTravelReceipts(with_(GAYLE, { travNo: 'TRAV-0404' })).success, false);

  const mine = c.getTravelReceipts(with_(OTHER, { travNo: NO }));
  ok('another rep is REFUSED, not quietly given their own', !mine.success, mine);
  eq('and told whose it is', /belongs to another employee/.test(mine.message), true);

  eq('accounting may read it', c.getTravelReceipts(with_(ACCT, { travNo: NO })).success, true);
  eq('the director may read it',
     c.getTravelReceipts({ actorName: 'Neil M. Estur', actorRole: 'director', travNo: NO }).success, true);

  const anon = c.getTravelReceipts({ travNo: NO });
  ok('signed out, nothing comes back', !anon.success, anon);
  eq('and it says why', /signed in/.test(anon.message), true);
}

console.log('\n== deleting the report takes its photographs with it ==');
{
  const h = load(null, store());
  const HFILES = {};
  h.DriveApp.getFileById = (id) => {
    if (!HFILES[id]) throw new Error('gone');
    HFILES[id].trashed = false;
    return { setTrashed: (v) => { HFILES[id].trashed = v; },
             getBlob: () => ({ getContentType: () => 'image/jpeg', getBytes: () => Buffer.from('X') }) };
  };
  const made = h.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: SAMPLE }));
  HFILES['f1'] = { trashed: false };
  HFILES['f2'] = { trashed: false };
  h.__store.Documents.push(
    { 'Doc ID': 'D1', 'Module': 'Travel Replenishment', 'Ref No': made.travNo,
      'File Name': 'receipt-1.jpg', 'File ID': 'f1', 'Uploaded At': '2026-07-28' },
    { 'Doc ID': 'D2', 'Module': 'Travel Replenishment', 'Ref No': made.travNo,
      'File Name': 'receipt-2.jpg', 'File ID': 'f2', 'Uploaded At': '2026-07-28' },
    { 'Doc ID': 'D3', 'Module': 'Quotation', 'Ref No': made.travNo,
      'File Name': 'photo-a1.jpg', 'File ID': 'f2', 'Uploaded At': '2026-07-28' });

  const del = h.deleteTravelReplenishment(with_(GAYLE, { travNo: made.travNo }));
  eq('the report went', del.success, true);
  eq('and both receipts with it', del.receiptsRemoved, 2);
  eq('the registry rows are gone', h.__store.Documents.filter(d =>
     String(d['Module']) === 'Travel Replenishment').length, 0);
  eq('the Drive files were trashed, not merely unlinked',
     [HFILES.f1.trashed, HFILES.f2.trashed], [true, true]);
  eq('a quotation photo that happened to share the ref was left alone',
     h.__store.Documents.length, 1);
}

console.log('\n== registration ==');
ok('getTravelReceipts is in HANDLERS', typeof c.HANDLERS.getTravelReceipts === 'function');
ok('but NOT in MUTATIONS — a read takes no lock', !c.MUTATIONS.getTravelReceipts);
ok('and NOT in _MODULE_MAP — a read is not an activity', !c._MODULE_MAP.getTravelReceipts);

console.log('\n== the three secured lists still agree ==');
{
  const gs = fs.readFileSync(path.join(ROOT, 'apps-script/FlowAPI.gs'), 'utf8');
  const py = fs.readFileSync(path.join(ROOT, 'blueprints/flow.py'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'dashboard/js/flow-api.js'), 'utf8');

  const gsList = Object.keys(c._SECURED).sort();
  const pyList = (py.match(/SECURED_ACTIONS\s*=\s*\[([\s\S]*?)\n\]/) || [])[1]
    .split('\n').map(l => l.replace(/#.*$/, '')).join(' ')
    .match(/"([A-Za-z]+)"/g).map(s => s.replace(/"/g, '')).sort();
  const jsList = (js.match(/FLOW_SECURED_ACTIONS\s*=\s*\[([\s\S]*?)\n\]/) || [])[1]
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join(' ')
    .match(/'([A-Za-z]+)'/g).map(s => s.replace(/'/g, '')).sort();

  ok('all three were parsed', gsList.length > 40 && pyList.length > 40 && jsList.length > 40,
     [gsList.length, pyList.length, jsList.length]);
  eq('FlowAPI.gs === flow.py', gsList.join('|') === pyList.join('|'), true);
  eq('FlowAPI.gs === flow-api.js', gsList.join('|') === jsList.join('|'), true);
  ok('and getTravelReceipts is in all three',
     gsList.indexOf('getTravelReceipts') >= 0 && pyList.indexOf('getTravelReceipts') >= 0 &&
     jsList.indexOf('getTravelReceipts') >= 0);
}

console.log('\n== the dispatcher enforces it ==');
{
  const h = load(null, store());
  h.__props['FLOW_MUTATION_SECRET'] = 's3cret';
  h.saveTravelReplenishment(with_(GAYLE, { weekStart: '2026-07-27', items: SAMPLE }));
  const r = call(h, 'getTravelReceipts', with_(GAYLE, { travNo: 'TRAV-202608-001' }));
  eq('the browser calling it directly is turned away',
     /must be performed through the app/.test(r.message || ''), true);
  eq('and with the secret it reads',
     call(h, 'getTravelReceipts', with_(GAYLE,
       { travNo: h.__store.TravelReplenishments[0]['Trav No'], flowSecret: 's3cret' })).success, true);
}

console.log('\n== travel documents file OUTSIDE the client tree ==');
{
  const segs = c._docFolderPath('Travel Replenishment', NO, 'Travel Receipt', '2026-08-08');
  eq('one folder per report, under _Internal', segs,
     ['2026', '07 July', '_Internal', 'Travel Allowance', NO]);
  ok('and nothing about a client appears in the path',
     segs.indexOf('_Unknown Client') < 0 && segs.indexOf('_Pre-Sales Order') < 0, segs);

  const q = c._docFolderPath('Quotation', 'QUO-0001', 'Item Photo', '2026-08-08');
  ok('while a quotation still files exactly as it did', q.indexOf('_Internal') < 0, q);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall good');
process.exit(fail ? 1 : 0);
