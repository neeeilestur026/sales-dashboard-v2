/* A385 — the sales lists: the organizer (js/sales-lists-model.js, js/sales-lists.js), My Requests on
 * flow-pricing-request.html, the quotation list on flow-quotations.html, the quote builder's request path
 * (js/flow-quote-configurator.js), and what left the sales side (clients.html, "What needs you", two menu entries).
 *
 * Run:  node tests/flow/sales-lists.js
 *
 * Neil, 30 Oct 2026: purchase requests and quotations "organize by month created, last follow up, by client"; the
 * redundancy and the error in For Quotation; "remove unneccessary tasks" when a quotation is made from a request; and
 * "prepare also so that we can easily revert this back" (FlowSettings switches, checked below).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');
const M = require('../../dashboard/js/sales-lists-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');
const T = '2026-10-30';

/* a host the organizer can draw into without a browser: each part it asks for by selector, kept to be read back */
function fakeHost() {
  const parts = {}, mk = () => ({ innerHTML: '', textContent: '', value: '', style: {}, hidden: false, addEventListener() {}, querySelector: () => null,
    querySelectorAll: () => [], setAttribute() {}, classList: { toggle() {} }, focus() {} });
  return { innerHTML: '', parts, querySelector: (s) => (parts[s] = parts[s] || mk()) };
}

sec('1 · the model');
eq('months: a key and a name, newest first in a grouping', [M.slmMonthKey('2026-10-03'), M.slmMonthLabel('2026-10'), M.slmMonthLabel('')], ['2026-10', 'October 2026', 'No date']);
eq('ages as of today', [M.slmAge('2026-10-29', T), M.slmAge('2026-10-20', T), M.slmAge('2026-10-05', T), M.slmAge('2026-08-01', T), M.slmAge('', T)], ['week', 'two', 'month', 'older', 'never']);
eq('  said plainly', [M.slmAgo('2026-10-30', T), M.slmAgo('2026-10-29', T), M.slmAgo('2026-10-25', T), M.slmAgo('2026-10-02', T), M.slmAgo('2026-07-30', T)], ['today', 'yesterday', '5 days ago', '4 weeks ago', '3 months ago']);
const R = [
  { key: 'A', date: '2026-10-20', client: 'Philcement Corporation', stage: 'ready', value: 100, followAt: '2026-10-28', updatedAt: '2026-10-28', rep: 'Kim', hay: 'A Philcement wrench 0917 123 4567' },
  { key: 'B', date: '2026-09-02', client: 'PHILCEMENT CORP.', stage: 'source', value: 0, followAt: '', updatedAt: '2026-09-02', rep: 'Kim', hay: 'B philcement pump' },
  { key: 'C', date: '2026-10-01', client: 'Taganito', stage: 'ready', value: 50, followAt: '2026-08-15', updatedAt: '2026-10-10', rep: 'Gerald', hay: 'C taganito' },
  { key: 'D', date: '2026-08-01', client: 'Taganito', stage: 'done', value: 25, followAt: '', updatedAt: '2026-08-01', rep: 'Gerald', hay: 'D taganito', notSent: true }];
global.crCanonKey = (n) => String(n || '').toLowerCase().replace(/\b(corporation|corp|inc)\b|[.,]/g, ' ').replace(/\s+/g, ' ').trim();
R.forEach(r => { r.clientKey = M.slmClientKey(r.client); });
const G = (by, o) => M.slmGroup(R, by, Object.assign({ today: T }, o || {})).map(g => [g.label, g.rows.map(r => r.key).join('')]);
eq('by month, newest month first, newest first inside', G('month'), [['October 2026', 'AC'], ['September 2026', 'B'], ['August 2026', 'D']]);
eq('by client: two spellings are one client, under the spelling with capitals', G('client'), [['Philcement Corporation', 'AB'], ['Taganito', 'CD']]);
eq('by stage, in the page\'s order', G('stage', { stages: [['source', 'Waiting'], ['ready', 'For Quotation'], ['done', 'Quoted']] }), [['Waiting', 'B'], ['For Quotation', 'AC'], ['Quoted', 'D']]);
eq('by last follow-up, the oldest contact first, then the page\'s own groups', G('follow', { oldestFirst: true, followGroup: r => r.notSent ? ['notsent', 'Not sent yet'] : null, followOrder: ['notsent'] }),
   [['Never followed up', 'B'], ['Over a month ago', 'C'], ['This week', 'A'], ['Not sent yet', 'D']]);
eq('by last update, newest first', G('update'), [['Updated this week', 'A'], ['Updated 2–4 weeks ago', 'C'], ['Updated over a month ago', 'BD']]);
eq('by rep', G('rep'), [['Gerald', 'CD'], ['Kim', 'AB']]);
eq('sorts: oldest, biggest, client', [M.slmSort(R, 'oldest').map(r => r.key).join(''), M.slmSort(R, 'biggest').map(r => r.key).join(''), M.slmSort(R, 'client').map(r => r.key).join('')], ['DBCA', 'ACDB', 'BACD']);
eq('search: words, and a phone typed as digits', [M.slmSearch(R, 'pump').map(r => r.key), M.slmSearch(R, '09171234').map(r => r.key), M.slmSearch(R, '').length], [['B'], ['A'], 4]);
{
  const rows = R.concat([{ key: 'E', stage: 'source', archived: true }]);
  const n = M.slmChipCounts(rows, r => r.archived ? 'archived' : r.stage);
  eq('chip counts: All leaves the archived out, so the stages add up to it', n, { all: 4, ready: 2, source: 1, done: 1, archived: 1 });
}
eq('a group carries its count and value', M.slmGroup(R, 'client', { today: T })[0].value, 100);
eq('the count line', [M.slmCountLine(4, 4, 175, 'request'), M.slmCountLine(2, 4, 0, 'request')], ['4 requests · ₱175.00', '2 of 4 requests']);
/* A386 — Neil, 30 Oct 2026: a request's item cell printed the whole spec sheet that was pasted into the item name */
const SPEC = 'Portable AcetyleneandOxygen tank Kit Product Name: Portable Welding Kit Brand: Greenfield Type: Portable Oxy-Acetylene Welding Kit ' +
  'Application: Suitable for welding, brazing, soldering, and heating applications Kit Components: Oxygen cylinder Acetylene cylinder Warranty: Manufacturer warranty';
eq('a list shows an item\'s name, not its spec sheet: the text before the first label ("Product Name:", "Brand:" …)',
   [M.slmShortItem(SPEC), M.slmShortItem('Hydraulic torque wrench 10,940 ft-lbs'), M.slmShortItem('Bolt tensioner Model: BT-200 Rating: 1500 bar')],
   ['Portable AcetyleneandOxygen tank Kit', 'Hydraulic torque wrench 10,940 ft-lbs', 'Bolt tensioner']);
{
  const sp = M.slmItemSpecs(SPEC);
  eq('the Open view reads the spec sheet apart: the name, then label and value (title-case values do not swallow the label)',
     [sp.title, sp.specs.map(x => x[0])], ['Portable AcetyleneandOxygen tank Kit', ['Product Name', 'Brand', 'Type', 'Application', 'Kit Components', 'Warranty']]);
  eq('  values stay whole', [sp.specs[0][1], sp.specs[1][1], sp.specs[2][1]], ['Portable Welding Kit', 'Greenfield', 'Portable Oxy-Acetylene Welding Kit']);
  eq('  "Manual Use:" and "Safety Feature:" are read right; a plain name has no specs',
     [M.slmItemSpecs('Ignition Method: Manual Use: Ideal for HVAC work Safety Feature: Check valves').specs.map(x => x[0]), M.slmItemSpecs('Hydraulic torque wrench 10,940 ft-lbs')],
     [['Ignition Method', 'Use', 'Safety Feature'], { title: 'Hydraulic torque wrench 10,940 ft-lbs', specs: [] }]);
}
eq('  a long name with no labels is cut at a word, with an ellipsis; a name that IS a label stays', [M.slmShortItem('Lifting chain grade 80 alloy steel with safety hooks and shortening clutches both ends supplied', 40), M.slmShortItem('Brand: X')],
   ['Lifting chain grade 80 alloy steel with…', 'Brand: X']);

sec('2 · the organizer draws');
const SL = (function () { const c = { console, localStorage: { getItem: () => null, setItem() {} }, flowEsc: (s) => String(s), JSON, Math, Number, String, Object, Array, Date };
  vm.createContext(c); vm.runInContext(read('js/sales-lists-model.js') + '\n' + read('js/sales-lists.js'), c); return c; })();
{
  const host = fakeHost();
  SL.__h = host; SL.__rows = R.map(r => Object.assign({ raw: r }, r)).concat([{ key: 'E', date: '2026-06-01', client: 'Old Co', stage: 'source', archived: true, raw: { key: 'E' } }]);
  vm.runInContext(`var org = sl2Organizer({ id: 't', host: __h, noun: 'request', chips: [['source', 'Waiting'], ['ready', 'For Quotation', 'keep'], ['done', 'Quoted'], ['archived', 'Archived']],
    chipOf: r => r.archived ? 'archived' : r.stage, groups: [['month', 'Month'], ['client', 'Client']], sorts: [['newest', 'Newest']], today: '${T}',
    table: rows => '<table>' + rows.map(r => '<tr>' + r.key + '</tr>').join('') + '</table>', empty: c => 'Nothing for ' + c });
    org.set(__rows);`, SL);
  const chips = host.parts['.sl2-chips'].innerHTML, groups = host.parts['.sl2-groups'].innerHTML;
  ok('chips name the stage and count it; All is on and leaves the archived out', /data-chip="all" aria-pressed="true">All <span class="n">4<\/span>/.test(chips) &&
     /For Quotation <span class="n">2<\/span>/.test(chips) && /Archived <span class="n">1<\/span>/.test(chips), chips);
  ok('the groups are sections that fold, each with its count and value', /<details class="sl2-group" data-g="m:2026-10" open><summary class="sl2-gh"><span class="sl2-gl">October 2026<\/span><span class="sl2-gm">2 requests · ₱150\.00<\/span><\/summary>/.test(groups) &&
     /<tr>A<\/tr><tr>C<\/tr>/.test(groups) && !/<tr>E<\/tr>/.test(groups), groups.slice(0, 400));
  eq('the count line', host.parts['.sl2-count'].textContent, '4 requests · ₱175.00');
  vm.runInContext(`org.pick('archived')`, SL);
  ok('a chip shows only its rows', /<tr>E<\/tr>/.test(host.parts['.sl2-groups'].innerHTML) && !/<tr>A<\/tr>/.test(host.parts['.sl2-groups'].innerHTML));
  vm.runInContext(`org.pick('done'); org.state.q = 'zzz'; org.draw()`, SL);
  ok('a search with no match says so', /Nothing matches “zzz”/.test(host.parts['.sl2-groups'].innerHTML));
  eq('the switch: on unless FlowSettings says off', [SL.sl2On({}), SL.sl2On({ salesListsOrganizer: 'on' }), SL.sl2On({ salesListsOrganizer: 'OFF' }), SL.sl2On(null)], [true, true, false, true]);
}

sec('3 · My Requests');
const it = (line, price, o) => Object.assign({ line, itemNo: 'TW-' + line, itemName: 'Torque wrench ' + line, qty: 1, included: true, finalPrice: price, quotedOn: '', quotable: true }, o || {});
const PRS = [
  { prNo: 'PR-OLD', date: '2026-07-10', customer: 'Philcement Corporation', requestedBy: 'Kimberlyn Blones', salesperson: 'Kimberlyn Blones', status: 'Requested', items: [it(1, 0)], archived: true, updatedAt: '2026-07-10T02:00:00Z', quotationNos: [] },
  { prNo: 'PR-READY', date: '2026-10-20', customer: 'Philcement Corporation', requestedBy: 'Kimberlyn Blones', status: 'Returned to Sales', items: [it(1, 1200), it(2, 300)], archived: false, updatedAt: '2026-10-28T02:00:00Z', quotationNos: [] },
  { prNo: 'PR-PART', date: '2026-10-05', customer: 'Taganito Mining', requestedBy: 'Kimberlyn Blones', status: 'Partly Quoted', items: [it(1, 900, { quotedOn: 'Q-1', quotable: false }), it(2, 450)], archived: false, updatedAt: '2026-10-25T02:00:00Z', quotationNos: ['Q-1'] },
  { prNo: 'PR-PART-DONE', date: '2026-10-02', customer: 'Taganito Mining', requestedBy: 'Kimberlyn Blones', status: 'Partly Quoted', items: [it(1, 900, { quotedOn: 'Q-2', quotable: false })], archived: false, updatedAt: '2026-10-22T02:00:00Z', quotationNos: ['Q-2'] },
  { prNo: 'PR-SRC', date: '2026-10-27', customer: 'Apex Mining', requestedBy: 'Kimberlyn Blones', status: 'Sourcing', items: [it(1, 0)], archived: false, updatedAt: '2026-10-27T02:00:00Z', quotationNos: [] },
  { prNo: 'PR-Q', date: '2026-09-12', customer: 'Apex Mining', requestedBy: 'Kimberlyn Blones', status: 'Quoted', items: [it(1, 700, { quotedOn: 'Q-3', quotable: false })], archived: false, updatedAt: '2026-10-15T02:00:00Z', quotationNos: ['Q-3'] },
  { prNo: 'PR-LONG', date: '2026-10-29', customer: 'ACEN - One Subic Power', requestedBy: 'Kimberlyn Blones', status: 'Requested', archived: false, updatedAt: '2026-10-29T02:00:00Z', quotationNos: [],
    items: [it(1, 0, { itemName: 'Portable AcetyleneandOxygen tank Kit Product Name: Portable Welding Kit Brand: Greenfield Type: Portable Oxy-Acetylene Welding Kit' })] }];
async function prPage(session, settings) {
  const p = page(['js/sales-lists-model.js', 'js/sales-lists.js', 'js/client-rollup.js', 'js/supplier-list-model.js', 'js/flow-pricing-engine.js', 'js/flow-pricing-request.js'], 'flow-pricing-request.html',
    session || { username: 'sales1', name: 'Kimberlyn Blones', role: 'sales' },
    { withAuth: true, data: { getPricingRequests: JSON.parse(JSON.stringify(PRS)), getFlowSettings: settings || { prArchiveDays: 30 }, getQuotations: [{ quotationNo: 'Q-1', status: 'Sent' }], getInventory: [], getClients: [] } });
  p.els.prOrgHost = fakeHost();
  p.els.prOrgNote = { innerHTML: '', querySelector: () => null };
  p.run('flowToday = function () { return "' + T + '"; };');
  await p.boot();
  await new Promise(r => setImmediate(r));
  return p;
}
(async () => {
  const p = await prPage();
  const host = p.els.prOrgHost, chips = host.parts['.sl2-chips'].innerHTML, groups = host.parts['.sl2-groups'].innerHTML;
  ok('the list reads fresh (Refresh served a minute-old copy)', p.paramsFor('getPricingRequests') && true);
  ok('chips: Waiting for price, For Quotation, Quoted and Archived, adding up to All', /All <span class="n">6<\/span>/.test(chips) && /Waiting for price <span class="n">2<\/span>/.test(chips) &&
     /For Quotation <span class="n">2<\/span>/.test(chips) && /Quoted <span class="n">2<\/span>/.test(chips) && /Archived <span class="n">1<\/span>/.test(chips), chips);
  eq('the stage each request is really in (a Partly Quoted with nothing left is Quoted, whatever its status)',
     PRS.map(r => p.run('prStageOf(' + JSON.stringify(r) + ', flowPrRemaining(' + JSON.stringify(r) + '))')), ['source', 'ready', 'ready', 'done', 'source', 'done', 'source']);
  ok('the archived request is not in the list, and the note says how to see it', !/PR-OLD/.test(groups) && /1 request archived — no update in 30 days/.test(p.els.prOrgNote.innerHTML), p.els.prOrgNote.innerHTML);
  ok('a ready request: Create quotation on the row itself', /PR-READY[\s\S]*?Create quotation<\/button>/.test(groups), groups.slice(0, 800));
  ok('a partly quoted request: "Quote the 1 left" (it had no button anywhere), and what it already became', /Quote the 1 left<\/button>/.test(groups) &&
     /href="flow-quotations\.html\?review=Q-1">Q-1<\/a><span class="sl2-sub">Sent<\/span>/.test(groups) && /1 of 2 already quoted/.test(groups));
  ok('a long item name shows as its name (the whole text is on hover), not forty lines of spec', /<span class="sl2-item" title="Portable AcetyleneandOxygen tank Kit Product Name: Portable Welding Kit Brand: Greenfield Type: Portable Oxy-Acetylene Welding Kit">Portable AcetyleneandOxygen tank Kit<\/span>/.test(groups), groups.slice(0, 400));
  ok('the row shows the first item, how many more, and when it was last updated', /<span class="sl2-item" title="Torque wrench 1">Torque wrench 1<\/span><span class="sl2-more">\+1 more<\/span>/.test(groups) &&
     /updated 2 days ago/.test(groups), groups.slice(0, 600));
  p.run('prOrg.pick("archived")');
  ok('Archived: the old request, with Bring back', /PR-OLD[\s\S]*Bring back<\/button>/.test(host.parts['.sl2-groups'].innerHTML));
  p.run('openPr("PR-LONG")');
  ok('Open shows the item as its name with its specs laid out as label and value, not one sideways-scrolling line',
     /<td class="sl2-itemcell"><span class="sl2-code">TW-1<\/span><b class="sl2-ititle">Portable AcetyleneandOxygen tank Kit<\/b><dl class="sl2-specs"><div><dt>Product Name<\/dt><dd>Portable Welding Kit<\/dd><\/div><div><dt>Brand<\/dt><dd>Greenfield<\/dd><\/div>/.test(p.els.modalBody.innerHTML),
     p.els.modalBody.innerHTML.slice(0, 500));
  p.run('openPr("PR-PART")');
  ok('opening a partly quoted request offers Create Quotation for what is left', /makeQuotation\('PR-PART'\)/.test(p.els.modalFoot.innerHTML), p.els.modalFoot.innerHTML.slice(0, 300));

  const off = await prPage(null, { salesListsOrganizer: 'off' });
  ok('switched off (FlowSettings salesListsOrganizer = off): the old flat table, still without the archived request',
     /<table class="flow-table">/.test(off.els.listContainer.innerHTML) && /PR-READY/.test(off.els.listContainer.innerHTML) && !/PR-OLD/.test(off.els.listContainer.innerHTML) &&
     !off.els.prOrgHost.parts['.sl2-chips'], off.els.listContainer.innerHTML.slice(0, 200));

  const adm = await prPage({ username: 'admin1', name: 'Admin One', role: 'admin' });
  const ac = adm.els.prOrgHost.parts['.sl2-chips'].innerHTML;
  ok('admin: To source is the default chip, and the chips keep each stage', /data-chip="source" aria-pressed="true">To source <span class="n">2<\/span>/.test(ac) && /To verify|With management|For Quotation/.test(ac), ac);

  sec('4 · the quotation list');
  const Q = [
    { quotationNo: 'Q-SENT-OLD', date: '2026-10-01', customer: 'Philcement Corporation', status: 'Sent', sentAt: '2026-10-02', total: 1000, items: [{ itemName: 'Wrench' }], createdBy: 'Kimberlyn Blones', prNo: 'PR-READY', subject: 'Wrenches' },
    { quotationNo: 'Q-SENT-NEW', date: '2026-10-20', customer: 'PHILCEMENT CORP.', status: 'Sent', sentAt: '2026-10-21', lastFollowUp: '2026-10-28', followUpVia: 'Call', total: 500, items: [], createdBy: 'Kimberlyn Blones' },
    { quotationNo: 'Q-DRAFT', date: '2026-10-25', customer: 'Apex Mining', status: 'Draft', total: 200, items: [], createdBy: 'Kimberlyn Blones' },
    { quotationNo: 'Q-LOST', date: '2026-09-10', customer: 'Apex Mining', status: 'Lost', total: 300, items: [], createdBy: 'Kimberlyn Blones' }];
  const qp = page(['js/client-rollup.js', 'js/sales-lists-model.js', 'js/sales-lists.js', 'js/flow-pricing-engine.js', 'js/flow-quote-configurator.js', 'js/flow-quotations.js'], 'flow-quotations.html',
    { username: 'sales1', name: 'Kimberlyn Blones', role: 'sales' }, { withAuth: true, data: { getQuotations: Q, getFlowSettings: {}, getSalesOrders: [], getQuotationEmails: [], getClients: [], getInventory: [] } });
  qp.els.qOrgHost = fakeHost();
  qp.run('flowToday = function () { return "' + T + '"; };');
  await qp.boot(); await new Promise(r => setImmediate(r));
  const qh = qp.els.qOrgHost, qc = qh.parts['.sl2-chips'].innerHTML, qg = qh.parts['.sl2-groups'].innerHTML;
  ok('chips: Not sent yet, With the client, Lost or closed, adding up to All', /All <span class="n">4<\/span>/.test(qc) && /Not sent yet <span class="n">1<\/span>/.test(qc) &&
     /With the client <span class="n">2<\/span>/.test(qc) && /Lost or closed <span class="n">1<\/span>/.test(qc), qc);
  ok('a row: the request it came from, its subject and its last follow-up with how', /from <a class="sl2-link" href="flow-pricing-request\.html\?pr=PR-READY">PR-READY<\/a>/.test(qg) &&
     /<span class="sl2-item" title="Wrenches">Wrenches<\/span>/.test(qg) && /2026-10-28<span class="sl2-sub">2 days ago · Call<\/span>/.test(qg), qg.slice(0, 900));
  ok('  Update (Won / Pending / Lost on My quotations) and Park on a sent quotation', /href="quotation-status\.html\?q=Q-SENT-OLD">Update<\/a>/.test(qg) && /qPark\("Q-SENT-OLD"\)/.test(qg));
  qp.run('qOrg.state.group = "follow"; qOrg.draw()');
  const fg = qh.parts['.sl2-groups'].innerHTML;
  ok('by last follow-up: the one chased longest ago first, then not sent, then lost', fg.indexOf('2–4 weeks ago') >= 0 && fg.indexOf('2–4 weeks ago') < fg.indexOf('This week') && fg.indexOf('This week') < fg.indexOf('Not sent yet') && fg.indexOf('Not sent yet') < fg.indexOf('Lost or closed'), fg.slice(0, 400));
  const QH = read('flow-quotations.html'), QJ = read('js/flow-quotations.js');
  ok('"What needs you" is gone: no card, no worklist script, no qw- code', !/qWorkCard|What needs you|In the order they need doing/.test(QH) && !/qWorkCard|qRenderFollowUps|qw-|qwRow|QW_STYLE/.test(QH + QJ) && !/quotation-worklist\.js/.test(QH));
  ok('  its engine stays for the homes that use it', fs.existsSync(D + 'js/quotation-worklist.js') && /quotation-worklist\.js/.test(read('director-home.html')));
  ok('  Park and the send-date estimate kept a home', /async function qPark\(no\)/.test(QJ) && /id="qBackfillBtn"[^>]*onclick="qOpenBackfill\(\)"/.test(QH) && /<div id="qMsg"/.test(QH));

  sec('5 · a quotation from a request: fewer steps, no error');
  const cp = page(['js/client-rollup.js', 'js/flow-pricing-engine.js', 'js/flow-quote-configurator.js'], 'flow-quotations.html', { username: 'sales1', name: 'Kimberlyn Blones', role: 'sales' }, { withAuth: true });
  cp.ctx.__pr = { prNo: 'PR-READY', customer: 'Philcement Corporation', status: 'Returned to Sales', docJson: JSON.stringify({ companyAddress: 'Km 23 Ortigas Ave, Taytay', contactPerson: 'Joy Ramos' }), items: [it(1, 1200), it(2, 300)] };
  cp.ctx.__posts = [];
  cp.run(`var qCfg = {}; var qList = [{ quotationNo: '2026-590-KPB-PHILCEMENT-PUMP', createdBy: 'Kimberlyn Blones', date: '2026-10-01' }];
    qcSession = { name: 'Kimberlyn Blones', role: 'sales' }; qcRole = 'sales';
    fetchFlow = function (a) { if (a === 'suggestQuotationNo') return Promise.resolve({ success: true, prefix: '2026-604' }); return Promise.resolve({ success: true, data: [__pr] }); };
    postFlow = function (a, p) { __posts.push(a); return Promise.resolve({ success: true, status: 'Pending Admin' }); };
    flowLoadDefaults = function () { return { address: 'OLD CLIENT ADDRESS', attention: 'Old Person', validity: '45 days', sigName: 'Kim B' }; };
    qcRenderItems = function () {}; qcOnChange = function () {}; qcSchedulePreview = function () {}; qcSyncBlocks = function () {};`);
  cp.els.qcAddress.value = ''; cp.els.qcAttention.value = '';
  cp.run('qcPrefillDoc()');
  eq('the remembered defaults no longer bring the last client\'s address or attention; the rep\'s own terms still come', [cp.els.qcAddress.value, cp.els.qcAttention.value, cp.els.qcValidity.value], ['', '', '45 days']);
  cp.els.qcAddress.value = 'SOMEONE ELSE'; cp.els.qcAttention.value = 'Wrong Person'; cp.els.qcDesignation.value = 'Wrong title';
  cp.els.qcSubmitWrap.hidden = true;
  await cp.run('qcLoadFromPR("PR-READY")'); await new Promise(r => setImmediate(r));
  eq('from a request, the client\'s details are the request\'s, and blank where it has none', [cp.els.qcAddress.value, cp.els.qcAttention.value, cp.els.qcDesignation.value], ['Km 23 Ortigas Ave, Taytay', 'Joy Ramos', '']);
  eq('the number is suggested: next in the year, the rep\'s initials, the client, the item', cp.els.qcNo.value, '2026-604-KPB-PHILCEMENT-TORQUE WRENCH 1');
  ok('  "Send for approval now" is offered and ticked; More details is folded', cp.els.qcSubmitWrap.hidden === false && cp.els.qcSubmitNow.checked === true && cp.els.qcMore.open === false);
  eq('  the button says what it will do', cp.run('qcFinalizeLabel()'), 'Finalize and send for approval');
  ok('  the item scope is the rep\'s to write on this path (the prices stay locked)', cp.run('qcScopeLocked()') === false && cp.run('qcLocked') === true);
  cp.run('qcMode = "document"'); ok('  but not on a saved document', cp.run('qcScopeLocked()') === true); cp.run('qcMode = "edit"');
  /* the PDF failed after the quotation saved: the next press makes only the PDF, and sends it */
  cp.run(`qcPdfPendingNo = '2026-604-KPB-PHILCEMENT-TORQUE WRENCH 1'; qcSavePdf = function () { return Promise.resolve(''); }; qcAfterSave = function () { return Promise.resolve(); };`);
  eq('after a PDF failure the button reads', cp.run('qcFinalizeLabel()'), 'Make the PDF again');
  await cp.run('qcFinalize()'); await new Promise(r => setImmediate(r));
  eq('  pressing it makes the PDF and sends it — no updateQuotation over the server\'s lines, no second create', cp.ctx.__posts, ['submitQuotationApproval']);
  ok('  and the quotation is no longer pending a PDF', cp.run('qcPdfPendingNo') === '');
  cp.run('qCfg = { quoteNoSuggest: "off", quoteOneStep: "off" }');
  cp.els.qcNo.value = '';
  await cp.run('qcSuggestNo("Philcement", "Wrench", false)');
  eq('switched off (quoteNoSuggest / quoteOneStep): the number box stays empty and a Draft is saved', [cp.els.qcNo.value, cp.run('qcOneStepOn()')], ['', false]);
  const H = read('flow-quotations.html'), CJ = read('js/flow-quote-configurator.js');
  ok('the scope box has no pre-written text in it, and a short hint instead', /<textarea id="qcScopeText" oninput="qcScopeTick\(\)"><\/textarea>/.test(H) && !/Baudouin/.test(H) && /One entry per line\./.test(H));
  ok('a quotation by hand for a client with a priced request waiting is offered that request instead', /async function qcReadyPrHint\(\)/.test(CJ) && /Quote from it instead/.test(CJ));
  ok('the request is read fresh on this path', /fetchFlow\('getPricingRequests', scoped, \{ fresh: true \}\)/.test(CJ));
  ok('the success line says Quoted or partly quoted', /is partly quoted — /.test(CJ) && /is now Quoted/.test(CJ));

  sec('6 · what left, and who sees what');
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
    c.renderNavbar('dashboard');
    const rail = vm.runInContext('ledgerPages(' + JSON.stringify(role) + ').map(p => p.href)', c);
    return { html, rail };
  };
  const roles = ['director', 'admin', 'management', 'accounting', 'sales', 'leadgen', 'hr', 'marketing', 'warehouse'];
  eq('no role links clients.html, in either nav', roles.filter(r => { const n = navFor(r); return /href="clients\.html"/.test(n.html) || n.rail.indexOf('clients.html') >= 0; }), []);
  const s = navFor('sales');
  ok('the sales menus no longer list PR tracker or Quotation board', !/purchase-request-tracker\.html|quotation-board\.html/.test(s.html) && s.rail.indexOf('purchase-request-tracker.html') < 0 && s.rail.indexOf('quotation-board.html') < 0, s.rail);
  ok('  they stay for those who oversee', navFor('director').rail.indexOf('quotation-board.html') >= 0 && navFor('admin').rail.indexOf('purchase-request-tracker.html') >= 0);
  ok('the sales home\'s Clients tile opens the Client Book', /<a href="director-client-book\.html" class="sl-link">/.test(read('dashboard.html')) && !/href="clients\.html"/.test(read('dashboard.html')));
  {
    const C = read('clients.html'), J = read('js/clients.js');
    ok('clients.html is a redirect page: no inline script, nothing read or written', /<script src="js\/clients\.js"><\/script>/.test(C) && !/<script>/.test(C) && !/fetchFromAPI|postToAPI|fetchFlow|postFlow/.test(J));
    const go = (role) => { let to = ''; const c = { localStorage: { getItem: () => role ? JSON.stringify({ role }) : null }, window: { location: { replace: (u) => { to = u; } } }, JSON, String };
      c.window.window = c.window; vm.createContext(c); vm.runInContext(J.replace(/window\.location/g, 'window.location'), c); return to; };
    eq('  it sends each role on', ['sales', 'director', 'admin', 'accounting', 'management', 'leadgen', ''].map(go),
       ['director-client-book.html', 'director-client-book.html', 'flow-clients.html', 'flow-clients.html', 'flow-clients.html', 'index.html', 'index.html']);
  }
  ok('"Needs you" counts no archived request, and only requests with priced lines left as ready', /filter\(p => !p\.archived && p\.status === 'For Mgmt Pricing'\)/.test(AUTH) &&
     /filter\(p => !p\.archived\);   \/\/ A385/.test(AUTH) && /flowPrRemaining\(p\)\.ready\.length/.test(AUTH));
  ok('the PR tracker, the admin home and the admin report hide them too', /filter\(p => !p\.archived\)/.test(read('js/purchase-request-tracker.js')) &&
     (read('js/admin.js').match(/!p\.archived/g) || []).length === 2 && /got\.prs\.filter\(p => !p\.archived\)/.test(read('js/team-report.js')));

  sec('7 · the site rules');
  const NEW = read('js/sales-lists-model.js') + read('js/sales-lists.js'), CSS = read('css/sales-lists.css');
  ok('no emoji, no hex colour, no inline style in the new scripts', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(NEW) && !/#[0-9a-fA-F]{3,6}\b/.test(NEW) && !/style="/.test(NEW));
  ok('the stylesheet uses tokens only', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));
  ok('apple-design: press .97 over 100ms, translucent sticky headings, a sliding indicator, reduced motion / transparency / more contrast',
     /:active[^{]*\{ transform: scale\(\.97\); \}/.test(CSS) && /transition: transform 100ms ease-out/.test(CSS) && /backdrop-filter: blur\(20px\) saturate\(180%\)/.test(CSS) &&
     /\.sl2-thumb \{[^}]*transition: transform/.test(CSS) && /@media \(prefers-reduced-motion: reduce\)/.test(CSS) && /@media \(prefers-reduced-transparency: reduce\)/.test(CSS) && /@media \(prefers-contrast: more\)/.test(CSS));
  ok('Group by is a radio group the arrow keys move through', /role="radiogroup" aria-label="Group by"/.test(read('js/sales-lists.js')) && /ArrowRight/.test(read('js/sales-lists.js')));
  ok('both pages load the organizer before their own script, and its stylesheet before ledger.css and apple.css', ['flow-pricing-request.html', 'flow-quotations.html'].every(f => {
    const h = read(f); return h.indexOf('<script src="js/sales-lists.js">') > 0 && h.indexOf('<script src="js/sales-lists.js">') < h.indexOf(f === 'flow-quotations.html' ? '<script src="js/flow-quotations.js">' : '<script src="js/flow-pricing-request.js">') &&
      /css\/sales-lists\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">/.test(h); }));

  console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
