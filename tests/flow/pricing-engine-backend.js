/* A340 — the pricing engine's storage in FlowAPI 173 (PETables, PERecords).
 *
 * Run:  node tests/flow/pricing-engine-backend.js
 *
 * Pinned: director only and secured; the tables are versioned; approval codes are stored only as salted
 * hashes and never come back; a quotation is "Ready" only with no blocking flag and, when needed, the right
 * code (the president's covers the director's); revisions keep the same ref; and nothing outside the
 * engine's own two tabs (plus the activity log) is touched.
 */
const { load, call } = require('./gasload');
const PE = require('../../dashboard/js/pe-engine.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const section = (t) => console.log('\n== ' + t + ' ==');

const DIR = { actorRole: 'director', actorName: 'Neil Estur' };
const store = { ActivityLog: [], Quotations: [], PricingRequests: [], Inventory: [], SalesOrders: [] };
const before = JSON.stringify({ q: store.Quotations, p: store.PricingRequests, i: store.Inventory, s: store.SalesOrders });
const c = load(undefined, store);

const T = JSON.parse(JSON.stringify(PE.PE_DEFAULT_TABLES));
T.forex.USD = { rate: 58.5, asOf: '2026-10-12' }; T.forex.SGD = { rate: 43.5, asOf: '2026-10-12' };
const priced = (q, opts) => { const r = PE.peQuote(q, T, Object.assign({ today: '2026-10-17' }, opts || {}));
  return { inputs: JSON.stringify(q), result: JSON.stringify({ totals: r.totals, flags: r.flags, approval: r.approval, band: r.band, tablesVersion: 1, lines: r.lines.map(l => ({ name: l.name, cogsLine: l.cogsLine, priceUnit: l.priceUnit })) }), r }; };
const line = (o) => Object.assign(PE.peBlankLine(), o);
const clean = Object.assign(PE.peBlankQuote(), { client: 'Acme', lines: [line({ description: 'Snap-on set', principal: 'Snap-on', currency: 'USD', supplierPrice: 640, qty: 3 })] });

section('who may use it');
['sales', 'admin', 'management', 'accounting', ''].forEach(role => {
  const who = { actorRole: role, actorName: 'X' };
  const all = ['peGetTables', 'peSaveTables', 'peSetApprovalCode', 'peSaveRecord', 'peListRecords', 'peGetRecord'].map(a => call(c, a, Object.assign({ tables: JSON.stringify(T), who: 'director', code: '123456' }, who)));
  ok('  ' + (role || 'no role') + ': every pricing-engine action is refused', all.every(x => x.success === false), all.map(x => x.message));
});
ok('the reads are secured too (no secret, nothing)', !call(c, 'peGetTables', Object.assign({ flowSecret: '' }, DIR)).success);

section('tables, versioned');
let r = call(c, 'peGetTables', DIR);
ok('nothing saved yet: no tables, no codes', r.success && r.tables === null && !r.codes.director && !r.codes.president, r);
r = call(c, 'peSaveTables', Object.assign({ tables: JSON.stringify(T), effectiveDate: '2026-10-17', note: 'October rates' }, DIR));
ok('the first save is version 1', r.success && r.version === 1, r);
const T2 = JSON.parse(JSON.stringify(T)); T2.forex.USD.rate = 59.1;
r = call(c, 'peSaveTables', Object.assign({ tables: JSON.stringify(T2), effectiveDate: '2026-10-20' }, DIR));
ok('the next is version 2', r.success && r.version === 2);
const bad = JSON.parse(JSON.stringify(T)); bad.forex.USD.rate = -5;
ok('a negative rate is refused', !call(c, 'peSaveTables', Object.assign({ tables: JSON.stringify(bad) }, DIR)).success);
const bad2 = JSON.parse(JSON.stringify(T)); delete bad2.bands;
ok('missing bands are refused', /bands/.test(call(c, 'peSaveTables', Object.assign({ tables: JSON.stringify(bad2) }, DIR)).message));
r = call(c, 'peGetTables', DIR);
ok('the latest version comes back, with the history', r.tables.version === 2 && r.tables.forex.USD.rate === 59.1 && r.versions.length === 2 && r.versions[0].version === 2 && r.versions[0].effectiveDate === '2026-10-20');

section('approval codes');
ok('a short code is refused', !call(c, 'peSetApprovalCode', Object.assign({ who: 'director', code: '123' }, DIR)).success);
ok('the director\'s code is set', call(c, 'peSetApprovalCode', Object.assign({ who: 'director', code: 'dir-4821' }, DIR)).success);
ok('the president\'s code is set', call(c, 'peSetApprovalCode', Object.assign({ who: 'president', code: 'pres-7710' }, DIR)).success);
r = call(c, 'peGetTables', DIR);
const raw = JSON.stringify(r) + JSON.stringify(store.ActivityLog);
ok('the reads say only that the codes are set', r.codes.director && r.codes.president && !/dir-4821|pres-7710/.test(raw) && !/pe_code/.test(raw));
ok('the stored value is a salted hash, not the code', /^[0-9a-f-]{36}:[0-9a-f]{64}$/.test(c.__props.pe_code_director) && c.__props.pe_code_director.indexOf('dir-4821') < 0);

section('saving priced quotations');
let s = priced(clean);
r = call(c, 'peSaveRecord', Object.assign({ client: 'Acme', status: 'Draft', inputs: s.inputs, result: s.result }, DIR));
ok('a draft gets a PE number, revision 1', r.success && /^PE-\d{6}-\d{3}$/.test(r.ref) && r.revision === 1 && r.status === 'Draft', r);
const ref = r.ref;
r = call(c, 'peSaveRecord', Object.assign({ ref, client: 'Acme', status: 'Ready', inputs: s.inputs, result: s.result }, DIR));
ok('a clean quotation with nothing to approve is saved ready, as revision 2 of the same ref', r.success && r.ref === ref && r.revision === 2 && r.status === 'Ready' && !r.approvedBy, r);
r = call(c, 'peListRecords', DIR);
ok('the list shows each ref once, at its latest revision', r.success && r.data.length === 1 && r.data[0].revision === 2 && r.data[0].status === 'Ready');
r = call(c, 'peGetRecord', Object.assign({ ref }, DIR));
ok('a record comes back with its inputs and result', r.success && r.inputs.client === 'Acme' && r.result.totals.netSale > 0);

const stale = JSON.parse(JSON.stringify(clean)); stale.lines[0].currency = 'EUR';
s = priced(stale);
r = call(c, 'peSaveRecord', Object.assign({ client: 'Acme', status: 'Ready', inputs: s.inputs, result: s.result }, DIR));
ok('a blocking flag keeps it from "Ready"', !r.success && /Not ready: No EUR rate/.test(r.message), r);

const below = JSON.parse(JSON.stringify(clean)); below.lines[0].itemType = 'trading';
const fl = PE.peQuote(below, T, { today: '2026-10-17' }).lines[0].floorUnit; below.lines[0].priceOverride = Math.round(fl * 0.9);
s = priced(below);
ok('(a trading item below floor needs the director)', s.r.approval.approver === 'director');
ok('no code: refused', !call(c, 'peSaveRecord', Object.assign({ status: 'Ready', inputs: s.inputs, result: s.result }, DIR)).success);
ok('a wrong code: refused', !call(c, 'peSaveRecord', Object.assign({ status: 'Ready', approvalCode: 'nope-000', inputs: s.inputs, result: s.result }, DIR)).success);
r = call(c, 'peSaveRecord', Object.assign({ status: 'Ready', approvalCode: 'dir-4821', inputs: s.inputs, result: s.result }, DIR));
ok('the director\'s code: ready, approved by the director', r.success && r.approvedBy === 'Director', r);
r = call(c, 'peSaveRecord', Object.assign({ status: 'Ready', approvalCode: 'pres-7710', inputs: s.inputs, result: s.result }, DIR));
ok('the president\'s code also covers it', r.success && r.approvedBy === 'President');

const big = Object.assign(PE.peBlankQuote(), { isTender: true, lines: [line({ description: 'Genset', itemType: 'trading', principal: 'Local', currency: 'PHP', supplierPrice: 2220000, origin: 'Local', incoterm: 'Local-delivered', freightClass: 'D' })] });
s = priced(big);
ok('a tender with the director\'s code: refused (the president approves)', /president/.test(call(c, 'peSaveRecord', Object.assign({ status: 'Ready', approvalCode: 'dir-4821', inputs: s.inputs, result: s.result }, DIR)).message));
ok('with the president\'s code: ready', call(c, 'peSaveRecord', Object.assign({ status: 'Ready', approvalCode: 'pres-7710', inputs: s.inputs, result: s.result }, DIR)).success);
ok('a draft needs no code', call(c, 'peSaveRecord', Object.assign({ status: 'Draft', inputs: s.inputs, result: s.result }, DIR)).success);
ok('an unknown ref is refused', !call(c, 'peSaveRecord', Object.assign({ ref: 'PE-209901-999', status: 'Draft', inputs: s.inputs, result: s.result }, DIR)).success);
ok('an oversized record is refused', /Too many lines/.test(call(c, 'peSaveRecord', Object.assign({ status: 'Draft', inputs: JSON.stringify({ x: 'y'.repeat(50000) }), result: s.result }, DIR)).message));
const f = Object.assign({}, JSON.parse(JSON.stringify(clean)), { client: '=HYPERLINK("x")' }); s = priced(f);
call(c, 'peSaveRecord', Object.assign({ client: f.client, status: 'Draft', inputs: s.inputs, result: s.result }, DIR));
ok('a client name typed as a formula is stored as text', store.PERecords[store.PERecords.length - 1]['Client'].startsWith("'="));

section('separate from everything else');
ok('quotations, pricing requests, inventory and sales orders are untouched', JSON.stringify({ q: store.Quotations, p: store.PricingRequests, i: store.Inventory, s: store.SalesOrders }) === before);
const tabs = Object.keys(store).filter(k => store[k] && store[k].length);
ok('it only ever writes its own two tabs (and the daily-report log): ' + tabs.join(', '), tabs.every(k => ['PETables', 'PERecords', 'ActivityLog'].indexOf(k) >= 0));
ok('the daily report gets one task per save, never a code', store.ActivityLog.length > 0 && !/dir-4821|pres-7710/.test(JSON.stringify(store.ActivityLog)));

console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
