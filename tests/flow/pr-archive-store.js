/* A385 — purchase requests archive themselves after a month with no update; a retried quote is the same quote; the next
 * quotation number (FlowAPI 193: getPricingRequests updatedAt/archived, _prTouch, restorePricingRequest,
 * createQuotationFromPR's retry, suggestQuotationNo, and the FlowSettings switches).
 *
 * Run:  node tests/flow/pr-archive-store.js
 *
 * Neil, 30 Oct 2026: "archive/hide all Purchase request from all users ... who is more than a month old", counted from the
 * last update, priced ones too, and "prepare also so that we can easily revert this back". Runs the real FlowAPI.gs
 * through its dispatcher (gasload), so the secret and the lock are under test too.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const KIM = { actorName: 'Kimberlyn Blones', actorRole: 'sales', actorUsername: 'sales1' };
const GER = { actorName: 'Gerald Lucena', actorRole: 'sales', actorUsername: 'sales2' };
const ADMIN = { actorName: 'Jiezzel Barrios-Regente', actorRole: 'admin', actorUsername: 'admin1' };
const NEIL = { actorName: 'Neil Estur', actorRole: 'director', actorUsername: 'neil' };
const MGMT = { actorName: 'Larry Estur', actorRole: 'management', actorUsername: 'mgmt' };
const DAY = 86400000, ago = (d) => new Date(Date.now() - d * DAY);
const hdr = (no, status, o) => Object.assign({ 'PR No': no, 'Date': ago(60), 'Requested By': 'Kimberlyn Blones', 'Customer': 'Philcement Corporation',
  'Status': status, 'Created At': ago(60), 'Updated At': ago(60), 'Salesperson': 'Kimberlyn Blones' }, o || {});
const line = (no, n, price, o) => Object.assign({ 'PR No': no, 'Line': n, 'Item No': 'TW-' + n, 'Item Name': 'Torque wrench ' + n, 'Qty': 1, 'UOM': 'pc',
  'Included': true, 'Final Price': price, 'Quoted On': '' }, o || {});
function store(extra) {
  return Object.assign({ ActivityLog: [], FlowSettings: [], Quotations: [], QuotationItems: [], Documents: [],
    PricingRequests: [
      hdr('PR-OLD', 'Requested'),                                                          // 60 days, never touched
      hdr('PR-NEW', 'Requested', { 'Date': ago(5), 'Created At': ago(5), 'Updated At': ago(5) }),
      hdr('PR-PRICED-OLD', 'Returned to Sales', { 'Updated At': ago(40) }),                // priced, but 40 days untouched
      hdr('PR-PRICED-NEW', 'Returned to Sales', { 'Updated At': ago(3) }),                 // created 60 days ago, priced 3 days ago
      hdr('PR-BLANK', 'Requested', { 'Updated At': '', 'Created At': ago(10), 'Date': ago(10) }),
      hdr('PR-QUOTED', 'Quoted', { 'Updated At': ago(45) }),
      hdr('PR-GER', 'Sourcing', { 'Requested By': 'Gerald Lucena', 'Salesperson': 'Gerald Lucena', 'Updated At': ago(50) })],
    PricingRequestItems: [line('PR-OLD', 1, 0), line('PR-NEW', 1, 0), line('PR-PRICED-OLD', 1, 1200), line('PR-PRICED-NEW', 1, 900), line('PR-PRICED-NEW', 2, 400),
      line('PR-BLANK', 1, 0), line('PR-QUOTED', 1, 500, { 'Quoted On': 'Q-QUOTED' }), line('PR-GER', 1, 0)]
  }, extra || {});
}
const byNo = (res) => { const m = {}; ((res && res.data) || []).forEach(r => { m[r.prNo] = r; }); return m; };

sec('1 · the version, and what getPricingRequests now says about each request');
{
  const st = store({ Quotations: [{ 'Quotation No': 'Q-QUOTED', 'Date': ago(2), 'Created At': ago(2), 'Customer': 'Philcement Corporation', 'Status': 'Sent', 'PR No': 'PR-QUOTED' }] });
  const c = load(GS, st);
  ok('getVersion = 193', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 193);
  const r = call(c, 'getPricingRequests', KIM), m = byNo(r);
  ok('every request still comes back (history and lookups are untouched)', r.success && Object.keys(m).length === 7 && r.archiveDays === 30, Object.keys(m));
  ok('no update for 60 days: archived', m['PR-OLD'].archived === true && /T/.test(m['PR-OLD'].updatedAt), m['PR-OLD']);
  ok('5 days: not archived', m['PR-NEW'].archived === false);
  ok('priced but untouched for 40 days: archived too (Neil: "hide them too")', m['PR-PRICED-OLD'].archived === true);
  ok('created 60 days ago but priced 3 days ago: the last update counts, not the date', m['PR-PRICED-NEW'].archived === false);
  ok('a blank Updated At falls back to Created At (10 days: not archived)', m['PR-BLANK'].archived === false && m['PR-BLANK'].updatedAt);
  ok('a quotation it became 2 days ago is an update: not archived', m['PR-QUOTED'].archived === false, m['PR-QUOTED']);
}

sec('2 · the switch: FlowSettings prArchiveDays');
{
  const off = load(GS, store({ FlowSettings: [{ 'Key': 'prArchiveDays', 'Value': 0 }] }));
  const r0 = call(off, 'getPricingRequests', KIM);
  ok('0 archives nothing (the revert, in seconds)', r0.archiveDays === 0 && r0.data.every(p => p.archived === false), r0.data.map(p => [p.prNo, p.archived]));
  const week = load(GS, store({ FlowSettings: [{ 'Key': 'prArchiveDays', 'Value': 7 }] }));
  const m7 = byNo(call(week, 'getPricingRequests', KIM));
  ok('7 archives the 10-day one as well', m7['PR-BLANK'].archived === true && m7['PR-NEW'].archived === false);
  const s = call(load(GS, store()), 'getFlowSettings', {});
  ok('the defaults carry the four switches', s.data.prArchiveDays === 30 && s.data.salesListsOrganizer === 'on' && s.data.quoteOneStep === 'on' && s.data.quoteNoSuggest === 'on', s.data);
}

sec('3 · every change is an update');
{
  const st = store(), c = load(GS, st);
  const before = st.PricingRequests[2]['Updated At'];
  const r = call(c, 'updatePRSourcing', Object.assign({ prNo: 'PR-PRICED-OLD', plantSite: 'Taytay plant', items: JSON.stringify([]) }, ADMIN));
  const after = st.PricingRequests[2]['Updated At'];
  ok('a sourcing edit on a request already returned stamps Updated At (it used to leave it)', r.success && new Date(after).getTime() > new Date(before).getTime(), [r, before, after]);
  ok('  and it is no longer archived', byNo(call(c, 'getPricingRequests', KIM))['PR-PRICED-OLD'].archived === false);
  ok('  its stage did not move', st.PricingRequests[2]['Status'] === 'Returned to Sales');
  const w = call(c, 'setPricingRequestSalesperson', Object.assign({ prNo: 'PR-GER', salesperson: 'Kimberlyn Blones' }, ADMIN));
  ok('a change of owner stamps it too', w.success && Date.now() - new Date(st.PricingRequests[6]['Updated At']).getTime() < 60000, w);
}

sec('4 · bringing one back, and its Undo');
{
  const st = store(), c = load(GS, st);
  const no = (actor, prNo) => call(c, 'restorePricingRequest', Object.assign({ prNo: prNo || 'PR-OLD' }, actor));
  const g = no(GER);
  ok('another rep cannot', !g.success && /Only the rep who owns PR-OLD/.test(g.message), g);
  ok('management cannot', !no(MGMT).success);
  const was = new Date(st.PricingRequests[0]['Updated At']).toISOString();
  const k = no(KIM);
  ok('its owner can: Updated At is now, so it is back for 30 days', k.success && byNo(call(c, 'getPricingRequests', KIM))['PR-OLD'].archived === false, k);
  ok('  logged once, as Pricing Request · Brought back', st.ActivityLog.filter(a => /Brought back/.test(JSON.stringify(a))).length === 1, st.ActivityLog.slice(-1));
  const u = call(c, 'restorePricingRequest', Object.assign({ prNo: 'PR-OLD', putBack: was }, KIM));
  ok('Undo puts the earlier date back, and it is archived again', u.success && byNo(call(c, 'getPricingRequests', KIM))['PR-OLD'].archived === true, u);
  const fut = call(c, 'restorePricingRequest', Object.assign({ prNo: 'PR-OLD', putBack: new Date(Date.now() + 5 * DAY).toISOString() }, KIM));
  ok('  a date in the future is refused', !fut.success && /earlier date/.test(fut.message), fut);
  ok('admin and the director can bring any back', no(ADMIN, 'PR-GER').success && no(NEIL, 'PR-QUOTED').success);
  const blocked = call(c, 'restorePricingRequest', Object.assign({ prNo: 'PR-OLD', flowSecret: '' }, KIM));
  ok('it is secured: no secret, no change', !blocked.success, blocked);
  ok('nothing was deleted: still 7 requests and 8 lines', st.PricingRequests.length === 7 && st.PricingRequestItems.length === 8);
}

sec('5 · a retried quote is the same quote');
{
  const st = store(), c = load(GS, st);
  const p = Object.assign({ prNo: 'PR-PRICED-NEW', quotationNo: '2026-604-KPB-PHILCEMENT-TORQUE WRENCH', subject: 'Torque wrenches', clientRef: 'cref-1', lines: JSON.stringify([1, 2]) }, KIM);
  const a = call(c, 'createQuotationFromPR', p);
  ok('the first call makes the quotation and quotes the request', a.success && !a.duplicate && a.status === 'Quoted' && st.Quotations.length === 1, a);
  const b = call(c, 'createQuotationFromPR', p);
  ok('the same call again (postFlow retries a lost reply) returns that quotation, not an error', b.success && b.retried === true && b.quotationNo === a.quotationNo && st.Quotations.length === 1, b);
  const fresh = call(c, 'createQuotationFromPR', Object.assign({}, p, { clientRef: 'cref-2', quotationNo: '2026-605-KPB-X' }));
  ok('a NEW press on a quoted request is still refused by the stage gate', !fresh.success && /must be Returned to Sales/.test(fresh.message), fresh);
  ok('the quotation is a Draft (the page sends it for approval after its PDF)', st.Quotations[0]['Status'] === 'Draft');
}

sec('6 · the next quotation number');
{
  const y = String(new Date().getFullYear());
  const c = load(GS, store({ Quotations: [{ 'Quotation No': y + '-603-ADM-ECC-TOOL STORAGE SET' }, { 'Quotation No': y + '-598-AL-ACCELLERON-rev1' }, { 'Quotation No': '2025-999-OLD' }, { 'Quotation No': 'QTN-202610-001' }] }));
  const r = JSON.parse(c._dispatch({ action: 'suggestQuotationNo' }).getContent());
  ok('this year\'s highest + 1, last year and other shapes ignored', r.success && r.seq === 604 && r.prefix === y + '-604', r);
  const e = JSON.parse(load(GS, store())._dispatch({ action: 'suggestQuotationNo' }).getContent());
  ok('  an empty year starts at 1', e.seq === 1 && e.prefix === y + '-1', e);
}

console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' ok') + '\n');
process.exit(FAIL ? 1 : 0);
