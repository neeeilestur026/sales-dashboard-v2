/* A220 — renaming a sales order without orphaning anything.
 *
 * The SO number is the join key for FOURTEEN sheets, the Drive folder name, and the commission
 * prior-claim check, which is why flow-sales-orders.js has always disabled the field on edit with the
 * comment "the SO number is the record key — not renameable here". That was honest. This test exists
 * to make it stop being true safely.
 *
 * What this file exists to hold down:
 *   • EVERY SHEET WITH AN 'SO No' COLUMN IS RE-KEYED, discovered from SCHEMA rather than a hand-kept
 *     list — miss one and the order silently splits in two. MaterialsReceiving keeps 'SO No' in its
 *     LAST column and Collections in its 4th, so a hard-coded index (which updateQuotation's block
 *     uses for Documents) would corrupt the wrong cell rather than fail loudly;
 *   • THE WIDTH TRAP is untouched: the header write is a single cell, not a positional row rewrite.
 *     The positional trap has been sprung in A186, A193, A205, A215 and A218, and updateSalesOrder —
 *     which this handler deliberately does NOT reuse — is where it lives;
 *   • updateSalesOrder's THREE defects are the reason for a separate handler, and they are asserted
 *     here rather than described: an omitted p.items deletes every line, an omitted p.customer blanks
 *     the customer, and it is not secured;
 *   • the DEMO- guard. clearCommissionDemo finds demo rows by PREFIX, and SalesOrderItems is
 *     recognised ONLY by 'SO No', so a rename out of the prefix makes those rows unclearable for good;
 *   • collision, case-insensitively AND by Drive folder name — live SO numbers contain pipes, and
 *     _safeName maps '/' to '-', so two distinct numbers can collapse onto one folder;
 *   • a live commission claim blocks the rename, because _commPriorClaimed matches on the SO No
 *     string and a half-moved order resets the prior-claimed total to zero.
 *
 * The handler lives in Apps Script, so it is lifted out of FlowAPI.gs and run against a fake sheet —
 * the same technique tests/flow/quotation-owner.js and ap-payable.js use.
 */
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

function lift(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  const s = SRC.indexOf('{', i);
  let d = 0;
  for (let k = s; k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function liftVar(name) {
  const m = new RegExp('(?:var|const)\\s+' + name + '\\s*=\\s*([\\[{])').exec(SRC);
  if (!m) throw new Error('not found: ' + name);
  const open = m[1], close = open === '[' ? ']' : '}';
  const s = SRC.indexOf(open, m.index);
  let d = 0;
  for (let k = s; k < SRC.length; k++) {
    if (SRC[k] === open) d++;
    else if (SRC[k] === close) { d--; if (!d) return '(' + SRC.slice(s, k + 1) + ')'; }
  }
  throw new Error('unbalanced: ' + name);
}

const SCHEMA = eval(liftVar('SCHEMA'));
const _COMM_LOCKING = eval(liftVar('_COMM_LOCKING'));
const _COMM_DEMO_PREFIX = 'DEMO-';

/* ── The fake sheet ─────────────────────────────────────────────────────────────────────────────
   A cell write goes to CELLS so the test can prove exactly which cells moved and that nothing else
   was touched — a re-key that also clobbered a neighbouring column would pass a row-count check. */
let DB = {}, CELLS = [];
const _rows = (name) => (DB[name] || []).map((r, i) => Object.assign({}, r, { rowIndex: i + 2 }));
const _sheet = (name) => ({
  getRange: (row, col, nr, nc) => ({
    setValues: (vals) => {
      CELLS.push({ sheet: name, row, col, value: vals[0][0] });
      const r = (DB[name] || [])[row - 2];
      if (r) r[SCHEMA[name][col - 1]] = vals[0][0];
    }
  })
});
const _safeName = eval('(' + lift('_safeName') + ')');
const _rawKey = eval('(' + lift('_rawKey') + ')');
const _soFolderName = (n) => String(n || '');
const _docFolderPath = () => ['2026', '07', 'Client', String('folder')];
const _soDocChain = (soNo) => [['Sales Order', soNo]];
const _flowFilingReset = () => {};
const _adoptSoDocs = () => { adopted++; };
const SpreadsheetApp = { flush: () => {} };
let adopted = 0;

eval(lift('renameSalesOrder'));

const reset = () => {
  adopted = 0; CELLS = [];
  DB = {
    SalesOrders: [
      { 'SO No': 'SO-202607-002', 'Quotation No': '', 'Date': '2026-06-30', 'Customer': 'FFHC',
        'Status': 'Delivered', 'Total': 79404.76, 'Created By': 'Crystal Gayle', 'Created At': '2026-07-01',
        'Supplier Type': 'Local', 'Client PO Date': '', 'PO Received Date': '', 'Client PO No': '' },
      { 'SO No': 'SO-202607-001', 'Customer': 'Asian Aerospace', 'Client PO No': '' },
      { 'SO No': 'DEMO-SO-001', 'Customer': 'DEMO — Mincon', 'Client PO No': '' }
    ],
    SalesOrderItems: [{ 'SO No': 'SO-202607-002' }, { 'SO No': 'SO-202607-002' }, { 'SO No': 'SO-202607-001' }],
    PurchaseOrders:   [{ 'SO No': 'SO-202607-002', 'PO No': 'PO-009' }],
    MaterialsReceiving: [{ 'SO No': 'SO-202607-002' }],
    Invoices:   [{ 'SO No': 'SO-202607-002' }],
    ARAging:    [{ 'SO No': 'SO-202607-002' }],
    Collections:[{ 'SO No': 'SO-202607-002' }],
    SONotes:    [{ 'SO No': 'SO-202607-002' }],
    SOCostDetails: [{ 'SO No': 'SO-202607-002', 'COGS Type': 'local' }],
    Shipments:  [{ 'SO No': 'SO-202607-002', 'Shipment ID': 'SHM-202607-002' }],
    PaymentRequests: [{ 'SO No': 'SO-202607-002' }],
    MktgLeads:  [{ 'SO No': 'SO-202607-002' }],
    CommissionRequests: [], CommissionRequestItems: [],
    Documents: [
      { 'Module': 'Sales Order', 'Ref No': 'SO-202607-002', 'Doc Type': 'Client PO' },
      { 'Module': 'Shipment',    'Ref No': 'SHM-202607-002', 'Doc Type': 'delivered' }
    ]
  };
};
const go = (p) => renameSalesOrder(p);
const OK = { soNo: 'SO-202607-002', newSoNo: 'SO-2026-FFHC-01', confirmDocs: true };

console.log('== THE FOURTEEN SHEETS — discovered from SCHEMA, not from a list ==');
{
  const carriers = Object.keys(SCHEMA).filter(n => SCHEMA[n].indexOf('SO No') >= 0);
  eq('how many sheets carry an SO No column', carriers.length, 14);
  ok('SalesOrders is one of them', carriers.indexOf('SalesOrders') >= 0);
  /* The two that would break a hard-coded column index — the exact mistake updateQuotation's block
     makes for Documents and that this handler deliberately does not copy. */
  eq('MaterialsReceiving keeps it LAST',
     SCHEMA.MaterialsReceiving.indexOf('SO No') + 1, SCHEMA.MaterialsReceiving.length);
  eq('and Collections in the 4th', SCHEMA.Collections.indexOf('SO No') + 1, 4);
  ok('they are not the same index, so one literal cannot serve both',
     SCHEMA.MaterialsReceiving.indexOf('SO No') !== SCHEMA.Collections.indexOf('SO No'));
  ok('the handler derives every index from SCHEMA',
     /SCHEMA\[name\]\.indexOf\('SO No'\)/.test(lift('renameSalesOrder')));
}

console.log('\n== THE WIDTH TRAP — the header write must not be positional ==');
{
  const fn = lift('renameSalesOrder');
  ok('the header is written as a SINGLE CELL (row, col, 1, 1), never a full-width row',
     /getRange\(so\.rowIndex, soCol, 1, 1\)/.test(fn));
  ok('and nothing in the handler writes SCHEMA.SalesOrders.length wide',
     !/SCHEMA\.SalesOrders\.length/.test(fn));
  /* updateSalesOrder DOES, and must keep doing so — this is the neighbouring trap, asserted so a
     future edit to either function cannot quietly desynchronise them. */
  const upd = lift('updateSalesOrder');
  ok('updateSalesOrder is still the positional one', /SCHEMA\.SalesOrders\.length/.test(upd));
}

console.log('\n== why this is not updateSalesOrder ==');
{
  const upd = lift('updateSalesOrder');
  ok('an omitted p.items becomes an EMPTY LIST — it deletes every line on the order',
     /JSON\.parse\(p\.items \|\| '\[\]'\)/.test(upd));
  ok('and p.customer is written straight through, blanking it when omitted',
     /1, 1, SCHEMA\.SalesOrders\.length\)\.setValues\(\[\[no, [\s\S]{0,200}p\.customer,/.test(upd));
  const sec = liftVar('_SECURED');
  ok('updateSalesOrder is NOT secured', !/\bupdateSalesOrder: 1/.test(sec));
  ok('renameSalesOrder IS', /\brenameSalesOrder: 1/.test(sec), sec.slice(0, 80));
}

console.log('\n== the re-key moves everything, and only what it should ==');
{
  reset();
  const r = go(OK);
  ok('it succeeds', r.success, r.message);
  eq('and reports the rename', r.renamed, true);

  const stillOld = [];
  Object.keys(DB).forEach(n => (DB[n] || []).forEach(row => {
    if (String(row['SO No']) === 'SO-202607-002') stillOld.push(n);
    if (n === 'Documents' && row['Module'] === 'Sales Order' && row['Ref No'] === 'SO-202607-002') stillOld.push('Documents/RefNo');
  }));
  eq('NOTHING still points at the old number', stillOld, []);

  // Second path (the A187 rule): count by the new number rather than trusting the first count.
  let n = 0;
  Object.keys(DB).forEach(k => (DB[k] || []).forEach(row => {
    if (String(row['SO No']) === 'SO-2026-FFHC-01') n++;
    if (k === 'Documents' && row['Module'] === 'Sales Order' && row['Ref No'] === 'SO-2026-FFHC-01') n++;
  }));
  eq('and 14 rows now carry the new one', n, 14);

  eq('the two OTHER sales orders are untouched',
     DB.SalesOrders.filter(r2 => /^(SO-202607-001|DEMO-SO-001)$/.test(r2['SO No'])).length, 2);
  eq("so is another order's line item",
     DB.SalesOrderItems.filter(r2 => r2['SO No'] === 'SO-202607-001').length, 1);
  eq("and a shipment document, which is keyed by shipment id and not by SO",
     DB.Documents[1]['Ref No'], 'SHM-202607-002');

  eq('the line items survive — the updateSalesOrder defect this handler exists to avoid',
     DB.SalesOrderItems.filter(r2 => r2['SO No'] === 'SO-2026-FFHC-01').length, 2);
  eq('and so does the total', DB.SalesOrders[0]['Total'], 79404.76);
  eq('and the customer', DB.SalesOrders[0]['Customer'], 'FFHC');
  eq('and Created At', DB.SalesOrders[0]['Created At'], '2026-07-01');

  eq('every write was a single cell in an SO No / Ref No column', CELLS.filter(c => {
    const want = c.sheet === 'Documents' ? SCHEMA.Documents.indexOf('Ref No') + 1
                                         : SCHEMA[c.sheet].indexOf('SO No') + 1;
    return c.col !== want;
  }), []);
  eq('the documents are re-filed in Drive exactly once', adopted, 1);
  eq('and the orphaned folder is reported rather than silently left',
     typeof r.orphanedFolder === 'string' && r.orphanedFolder.length > 0, true);
}

console.log('\n== collisions ==');
{
  reset();
  eq('an existing number is refused', go({ soNo: 'SO-202607-002', newSoNo: 'SO-202607-001', confirmDocs: true }).success, false);
  reset();
  const ci = go({ soNo: 'SO-202607-002', newSoNo: 'so-202607-001', confirmDocs: true });
  ok('and so is the same number in a different case', !ci.success, ci.message);
  //  ^ updateQuotation's own clash test is case-SENSITIVE and would allow this. Deliberately not copied.
  reset();
  /* _safeName maps BOTH '/' and '\' to '-', so these two are distinct SO numbers whose Drive folders
     would be the same folder — and the documents of two orders would mingle in it. Live SO numbers
     really do carry separator characters ("3120001511 | T21", "3120020234 | T16"), which is why this
     is a real hazard and not a contrived one. A plain case-insensitive name check does not catch it. */
  DB.SalesOrders.push({ 'SO No': '3120001511 / T21', 'Client PO No': '' });
  eq('  the two names really do collapse to one folder name',
     [_safeName('3120001511 / T21'), _safeName('3120001511 \\ T21')],
     ['3120001511 - T21', '3120001511 - T21']);
  const fc = go({ soNo: 'SO-202607-002', newSoNo: '3120001511 \\ T21', confirmDocs: true });
  ok('so a number that maps onto ANOTHER order\'s Drive folder is refused', !fc.success, fc.message);
  ok('...and the message says why', /share a Drive folder name/i.test(fc.message || ''), fc.message);
  eq('  and nothing was written', CELLS.length, 0);

  reset();
  /* The same trap by a different route: _safeName collapses runs of whitespace. */
  DB.SalesOrders.push({ 'SO No': 'SO-2026 FFHC', 'Client PO No': '' });
  const ws = go({ soNo: 'SO-202607-002', newSoNo: 'SO-2026  FFHC', confirmDocs: true });
  ok('a double space is not a different order either', !ws.success, ws.message);
}

console.log('\n== the DEMO- guard ==');
{
  reset();
  const r1 = go({ soNo: 'DEMO-SO-001', newSoNo: 'SO-2026-REAL-01', confirmDocs: true });
  ok('renaming the demo order OUT of the prefix is refused first', !r1.success, r1.message);
  eq('with a confirm the caller must answer', r1.needsConfirm, 'demoRename');
  ok('and the message names the actual consequence',
     /never be cleared|unclear|permanent/i.test(r1.message), r1.message);
  ok('it warns that Seed would then produce a duplicate', /two demo orders/i.test(r1.message), r1.message);

  reset();
  const r2 = go({ soNo: 'DEMO-SO-001', newSoNo: 'SO-2026-REAL-01', confirmDocs: true, confirmDemo: true });
  ok('...but the user may go ahead, having been told', r2.success, r2.message);
  eq('and it really moves', DB.SalesOrders[2]['SO No'], 'SO-2026-REAL-01');

  reset();
  const r3 = go({ soNo: 'DEMO-SO-001', newSoNo: 'DEMO-SO-009', confirmDocs: true });
  ok('renaming WITHIN the prefix still asks, because seed/clear depend on it', !r3.success, r3.message);
  reset();
  ok('and proceeds once confirmed',
     go({ soNo: 'DEMO-SO-001', newSoNo: 'DEMO-SO-009', confirmDocs: true, confirmDemo: true }).success);

  reset();
  const r4 = go({ soNo: 'SO-202607-002', newSoNo: 'DEMO-SO-042', confirmDocs: true });
  ok('and renaming a REAL order INTO the prefix asks too — it would become clearable', !r4.success, r4.message);
}

console.log('\n== a live commission claim blocks it ==');
{
  Object.keys(_COMM_LOCKING).forEach(status => {
    reset();
    DB.CommissionRequests = [{ 'SO No': 'SO-202607-002', 'Status': status, 'Comm No': 'COMM-001' }];
    const r = go(OK);
    ok('  refused while a claim is ' + status, !r.success, r.message);
    ok('  ...and the claim is named', /COMM-001/.test(r.message || ''), r.message);
  });
  reset();
  DB.CommissionRequests = [{ 'SO No': 'SO-202607-002', 'Status': 'Draft', 'Comm No': 'COMM-002' }];
  const d = go(OK);
  ok('a DRAFT claim does not block — it holds no money', d.success, d.message);
  eq('and the draft follows the rename', DB.CommissionRequests[0]['SO No'], 'SO-2026-FFHC-01');
  //  ^ if it did NOT follow, _commPriorClaimed would stop seeing it and the same collection
  //    could be claimed a second time.
}

console.log('\n== documents are confirmed, and a stamped PDF is called out ==');
{
  reset();
  const r = go({ soNo: 'SO-202607-002', newSoNo: 'SO-2026-FFHC-01' });
  ok('filed documents require a confirm', !r.success, r.message);
  eq('with the right key', r.needsConfirm, 'renameDocs');
  eq('and the count', r.docCount, 1);

  reset();
  DB.Documents[0]['Doc Type'] = 'Client PO (stamped)';
  const s = go({ soNo: 'SO-202607-002', newSoNo: 'SO-2026-FFHC-01' });
  eq('a stamped document is counted separately', s.stampedCount, 1);
  ok('and the message says re-keying cannot fix it',
     /re-stamp|inside the file/i.test(s.message), s.message);
  //  ^ po_stamp_pdf.py burns the SO number into the image; no amount of re-keying changes pixels.
}

console.log('\n== rubbish does not throw ==');
{
  reset();
  eq('no soNo',            go({ newSoNo: 'X' }).success, false);
  eq('no newSoNo',         go({ soNo: 'SO-202607-002' }).success, false);
  eq('blank newSoNo',      go({ soNo: 'SO-202607-002', newSoNo: '   ' }).success, false);
  eq('unknown order',      go({ soNo: 'NOPE', newSoNo: 'X', confirmDocs: true }).success, false);
  eq('nothing at all',     go({}).success, false);
  eq('null does not throw', go(null).success, false);
  const same = go({ soNo: 'SO-202607-002', newSoNo: 'SO-202607-002' });
  ok('renaming to the same number is a no-op, not an error', same.success && !same.renamed, same.message);
  eq('and it wrote nothing', CELLS.length, 0);
  const pad = go({ soNo: 'SO-202607-002', newSoNo: '  SO-202607-002  ' });
  ok('...including when only whitespace differs', pad.success && !pad.renamed, pad.message);
}

console.log('\n== registration ==');
{
  ['renameSalesOrder: renameSalesOrder', 'renameSalesOrder: 1', "renameSalesOrder: ['Sales Order', 'Renamed']"]
    .forEach(w => ok('  ' + w, SRC.indexOf(w) > 0));
  const py = fs.readFileSync(path.resolve(__dirname, '../../blueprints/flow.py'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../../dashboard/js/flow-api.js'), 'utf8');
  ok('  mirrored into flow.py SECURED_ACTIONS', py.indexOf('"renameSalesOrder"') > 0);
  ok('  mirrored into flow-api.js FLOW_SECURED_ACTIONS', js.indexOf("'renameSalesOrder'") > 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
