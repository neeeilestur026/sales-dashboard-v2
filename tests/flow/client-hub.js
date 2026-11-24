/* A396 — the client information hub in the browser: the model (labels, filters, the checklist, the CSV), the page per role
 * (the reply comes from the REAL FlowAPI.gs through gasload, so page and store cannot drift), who sees it, and the site rules.
 * A404 — the sales view for the director and management: the model, the second read, the list, the Sales tab, Major / Minor.
 *
 * Run:  node tests/flow/client-hub.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');
const { load, call } = require('./gasload');
const M = require('../../dashboard/js/client-hub-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, a, b) => ok(l + ' = ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
const read = (f) => fs.readFileSync(D + f, 'utf8');
const GSP = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');

/* a real hub reply: a few clients across the four sources, "today" 5 Nov 2026 */
function world() {
  const Dt = (m, d) => new Date(2026, m - 1, d, 10);
  const store = {
    Clients: [{ 'Customer': 'Therma South, Inc.', 'Address': 'Toril, Davao', 'Contact Person': 'Joe <b>Cruz</b>', 'Phone': '0917 123 4567', 'Payment Terms': '30 days', 'TIN': '123' },
              { 'Customer': 'Petra Cement Inc.', 'Stage': 'Prospect' }],
    ClientBook: [{ 'Client No': 'CB-1', 'Company': 'Therma South, Inc.', 'Owner': 'Kimberlyn Blones', 'Accreditation': 'Accredited', 'Accredited Until': '2026-12-01', 'Accreditation Updated At': Dt(10, 22), 'Archived At': '', 'Sector': 'Power' },
                 { 'Client No': 'CB-2', 'Company': 'Philex Mining', 'Owner': 'Gerald Lucena', 'Accreditation': 'On process', 'Accreditation Step': 'Site audit', 'Accreditation Updated At': Dt(10, 25), 'Archived At': '' }],
    CollectionBook: [{ 'Client No': 'CC-1', 'Client': 'Therma South Inc.', 'Pays By': 'Cheque', 'Their Bank': 'BDO' }],
    ClientAccredFiles: [{ 'File No': 'CAF-1', 'Key': 'therma south', 'Company': 'Therma South, Inc.', 'Year': 2025, 'Requirement': 'Business permit', 'File ID': 'x', 'File Name': 'Permit 2025.pdf',
                          'File Type': 'application/pdf', 'File Size': 120000, 'Uploaded By': 'Ana Admin', 'Uploaded At': Dt(1, 5) }],
    Quotations: [{ 'Quotation No': '2026-6100', 'Date': '2026-10-20', 'Customer': 'Therma South Inc.', 'Status': 'Sent', 'Sent At': Dt(10, 21), 'Total': 100000, 'Salesperson': 'Kimberlyn Blones' }],
    ProofReports: [{ 'Report No': 'R-1', 'Date': '2026-11-03', 'User': 'Kimberlyn Blones', 'Role': 'sales', 'Kind': '', 'Updated At': '2026-11-03T17:00:00',
                     'Report JSON': JSON.stringify({ lines: [{ id: 'l1', type: 'Call', company: 'Therma South', person: 'Joe', result: 'Reached', note: 'reviewing <i>it</i>', nextDate: '2026-11-10', nextAction: 'Call back' }] }) }],
    FlowSettings: []
  };
  const c = load(GSP, store);
  c._now = () => Dt(11, 5);
  return c;
}
function reply(role, name) { return call(world(), 'getClientHub', { actorRole: role, actorName: name || 'Neil Estur', actorUsername: role + '1' }); }
function salesReply(role) { return call(world(), 'getClientHubSales', { actorRole: role || 'director', actorName: 'Neil Estur', actorUsername: 'neil' }); }

(async () => {
  const R = reply('director');
  sec('1 · the model');
  ok('the reply is a real hub (3 cards, the director may edit and see collection)', R.success && R.cards.length === 3 && R.may.edit && R.may.collection, R);
  const therma = R.cards.find(c => /Therma/.test(c.company)), philex = R.cards.find(c => /Philex/.test(c.company)), petra = R.cards.find(c => /Petra/.test(c.company));
  eq('days read as "3 Feb 2026"', [M.chDay('2026-02-03'), M.chDay('2026-11-05T02:00:00.000Z'), M.chDay('')], ['3 Feb 2026', '5 Nov 2026', '']);
  eq('Therma South: renew soon, in plain words', M.chStatusLine(therma.accred), 'Accredited · expires 1 Dec 2026 · renew within 26 days');
  eq('  its list badge', M.chBadge(therma.accred), 'Renew by 1 Dec 2026');
  eq('Philex: on process, with the rep\'s step', M.chStatusLine(philex.accred), 'On process · Site audit');
  eq('Petra: no rep has it', M.chStatusLine(petra.accred), 'No rep has this client in their Client Book');
  ok('the lines for Accredited and Expired', M.chStatusLine({ state: 'Accredited', since: '2026-02-03', expires: '2027-02-03' }) === 'Accredited · since 3 Feb 2026 · expires 3 Feb 2027' &&
     M.chStatusLine({ state: 'Expired', expires: '2026-10-01' }) === 'Expired 1 Oct 2026 · time to re-apply');
  eq('tones', ['Accredited', 'Renew soon', 'Expired', 'On process', 'Not accredited', 'No label'].map(M.chTone), ['ok', 'warn', 'bad', 'mid', 'off', 'off']);
  const sum = M.chSummary(R.cards);
  ok('the chips count by state; "No rep label" is its own chip, and Missing files counts the labelled ones only', sum.all === 3 && sum.renew === 1 && sum.process === 1 && sum.nolabel === 1 && sum.missing === 2, sum);
  eq('search hits names, people and numbers', [M.chFilter(R.cards, { q: 'joe' }).length, M.chFilter(R.cards, { q: '0917' }).length, M.chFilter(R.cards, { q: 'cement prospect' }).length], [1, 1, 0]);
  const list = M.chChecklist(therma, R.lists.requirements, 2026);
  ok('the 2026 checklist: nine requirements; the permit is missing this year with 2025\'s ready to reuse', list.length === 9 && !list[3].done && list[3].last.length === 1 && list[3].last[0].fileName === 'Permit 2025.pdf' && list[8].optional, list[3]);
  ok('  in 2025 the permit is done', M.chChecklist(therma, R.lists.requirements, 2025)[3].done);
  eq('the years it can show: this year and the ones with files', M.chYears(therma, '2026-11-05'), ['2026', '2025']);
  eq('file checks, before reading', [M.chFileCheck({ type: 'image/svg+xml', size: 10 }) !== '', M.chFileCheck({ type: 'application/pdf', size: 11 * 1048576 }).indexOf('11.0 MB') >= 0, M.chFileCheck({ type: 'application/pdf', size: 100 })], [true, true, '']);
  const csv = M.chCsv(R.cards);
  ok('the CSV: a header and one row per client, quoting what needs it', csv.split('\n')[0].indexOf('Client,Also written,Sector') === 0 && csv.split('\n').length === 5 && /"Therma South, Inc\."/.test(csv));

  sec('2 · the page');
  const SR = salesReply('director');
  const boot = async (role, rep, opts) => {
    const p = page(['js/client-hub-model.js', 'js/client-hub.js'], 'client-hub.html', { role, name: 'Someone', username: role + '1' });
    p.ctx.__answer = rep;
    p.ctx.__answers = Object.assign({ getClientHubSales: SR }, (opts && opts.answers) || {});
    p.ctx.__snack = [];
    p.ctx.location.search = (opts && opts.search) || '';
    p.run('requireClientHubAccess = function () { return __session; }; postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); return Promise.resolve(a === "getClientHub" ? __answer : __answers[a]); };' +
          'hxSnackbar = function (t, o) { __snack.push({ text: t, o: o }); };' +
          'flowToday = function () { return "2026-11-05"; }; chShow = function (html) { __shown = html; return { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} }; };');
    await p.boot();
    return p;
  };
  const d = await boot('director', R, { search: '?view=accreditation' });
  const list2 = d.els.chTable.innerHTML;
  ok('the director in the Accreditation view: the hub read, then the sales read; every client listed with its accreditation badge', d.calls.join() === 'POST:getClientHub,POST:getClientHubSales' &&
     (list2.match(/class="ch-open/g) || []).length === 3 && /Renew by 1 Dec 2026/.test(list2), { calls: d.calls, list: list2.slice(0, 300) });
  ok('  names are escaped', !/<b>Cruz<\/b>/.test(list2));
  ok('  the chips and the count line', /data-seg="renew"[^>]*>Renew soon <span class="n">1<\/span>/.test(d.els.chChips.innerHTML) && /<span class="n">1<\/span> to renew soon/.test(d.els.chProgress.innerHTML), d.els.chChips.innerHTML);
  d.run('chDetail(' + JSON.stringify(therma.key) + ', null)');
  const shown = d.ctx.__shown;
  ok('the client: five tabs for the director (Sales after Overview), the accreditation line, both groups of billing and collection', (shown.match(/role="tab"/g) || []).length === 5 &&
     /data-tab="overview"[^>]*>Overview<\/button><button[^>]*data-tab="sales"/.test(shown) && /Accredited · expires 1 Dec 2026 · renew within 26 days/.test(shown) &&
     /<h4 class="ch-gh">Billing<\/h4>/.test(shown) && /<h4 class="ch-gh">Collection<\/h4>/.test(shown) && /Cheque/.test(shown), shown.slice(0, 200));
  ok('  the director can edit the dates, upload, and reuse 2025\'s permit for 2026', /data-dates/.test(shown) && /data-upload/.test(shown) && /data-reuse="CAF-1">Use for 2026/.test(shown));
  ok('  the people are escaped and calls are tap-to-call', /Joe &lt;b&gt;Cruz&lt;\/b&gt;/.test(shown) && /href="tel:09171234567"/.test(shown));
  ok('  the director opens (not edits) Collection details, and gets no Client master link (its page is not his)', /Open in Collection details/.test(shown) && !/flow-clients\.html/.test(shown));
  const HRR = reply('hr', 'Jiezzel Barrios');
  const h = await boot('hr', HRR);
  h.run('chDetail(' + JSON.stringify(therma.key) + ', null)');
  ok('HR: one read, no sales view, four tabs', h.calls.join() === 'POST:getClientHub' && h.els.chLens.hidden === true && (h.ctx.__shown.match(/role="tab"/g) || []).length === 4 && !/data-tab="sales"/.test(h.ctx.__shown));
  ok('HR: no Collection group, no Cheque, but HR keeps the accreditation dates and files', !/<h4 class="ch-gh">Collection<\/h4>/.test(h.ctx.__shown) && !/Cheque|BDO/.test(h.ctx.__shown) && /data-upload/.test(h.ctx.__shown) && /data-dates/.test(h.ctx.__shown));
  const a = await boot('admin', reply('admin', 'Ana Admin'));
  a.run('chDetail(' + JSON.stringify(therma.key) + ', null)');
  ok('admin: edit links to the Client master and Collection details', /Edit in the Client master/.test(a.ctx.__shown) && /Edit in Collection details/.test(a.ctx.__shown));
  ok('admin: no sales read, no Sales tab, the list stays the accreditation one', a.calls.join() === 'POST:getClientHub' && !/data-tab="sales"/.test(a.ctx.__shown) && /Renew by 1 Dec 2026/.test(a.els.chTable.innerHTML));
  const old = await boot('director', { success: false, message: 'Unknown action: getClientHub' });
  ok('before FlowAPI 199: a plain notice, no list', /version 199/.test(old.els.chNotice.innerHTML) && !/ch-open/.test(old.els.chTable.innerHTML));

  sec('A404 · the sales view');
  {
    ok('a real sales reply (director): Therma is Following up, both clients owned, Philex quiet', SR.success && SR.clients.length === 2, SR);
    const map = M.chSalesMap(SR), st = map[therma.key], sp = map[philex.key];
    ok('  Therma: quotation sent 21 Oct, a call on 3 Nov after it → Following up, the next call promised for 10 Nov', st.stage === 'Following up' && st.quiet === 2 && st.next.day === '2026-11-10', st);
    eq('labels in words', [M.chTierText(st), M.chTierText({ rows: [{}], tier: 'Major' }), M.chTierText({ rows: [{}, {}], tier: 'mixed' }), M.chTierText({ rows: [], tier: '' })], ['No label', 'Major', 'Reps differ', '']);
    eq('quiet, in words', [M.chQuietText(st, 30, 180), M.chQuietText(sp, 30, 180), M.chQuietText({ quiet: 31 }, 30, 180), M.chQuietText({ quiet: 1 }, 30, 180)],
       ['Last update 2 days ago', 'No update in 6 months', 'Last update 31 days ago · quiet', 'Last update yesterday']);
    eq('the next step, and an overdue one', [M.chNextText({ day: '2026-11-10', text: 'Call back' }), M.chNextText({ day: '2026-10-08', text: 'Call back', overdue: true })], ['Call back · 10 Nov 2026', 'Overdue: Call back · 8 Oct 2026']);
    const sum = M.chSalesSummary(R.cards, map, 30);
    ok('the sales chips: 2 of 3 clients owned, 1 fresh, Philex quiet, both unlabelled, Petra has no rep', sum.all === 3 && sum.owned === 2 && sum.fresh === 1 && sum.quiet === 1 && sum.nolabel === 2 && sum.norep === 1, sum);
    eq('the list sorts by the latest update (Therma), then by name', M.chSalesFilter(R.cards, map, { sseg: 'all' }, 30).map(c => c.company.split(' ')[0]), ['Therma', 'Petra', 'Philex']);
    eq('  the rep picker narrows it; "-" is no rep', [M.chSalesFilter(R.cards, map, { rep: 'Gerald Lucena' }, 30).length, M.chSalesFilter(R.cards, map, { rep: '-' }, 30).map(c => c.company)], [1, ['Petra Cement Inc.']]);
    eq('  search finds the status too', M.chSalesFilter(R.cards, map, { q: 'following' }, 30).length, 1);
    eq('every rep, for the picker', M.chReps(R.cards, map), ['Gerald Lucena', 'Kimberlyn Blones']);
    const mixed = { rows: [{ clientNo: 'CB-1', owner: 'A', tier: 'Major' }, { clientNo: 'CB-2', owner: 'B', tier: '' }], tier: 'mixed' };
    eq('Major for both, and its Undo puts each rep\'s own label back', [M.chTierApplied(mixed, 'Minor').tier, M.chTierUndo(mixed), M.chTierApplied(M.chTierApplied(mixed, 'Minor'), '', M.chTierUndo(mixed)).tier],
       ['Minor', [{ clientNo: 'CB-1', tier: 'Major' }, { clientNo: 'CB-2', tier: '' }], 'mixed']);
    const csv = M.chCsv(R.cards, map);
    ok('the CSV gains the sales columns when they are loaded', /,Major or minor,Sales status,Last update,Latest update,Days since,Next$/m.test(csv.split('\n')[0]) && /Following up,2026-11-03/.test(csv), csv.split('\n').slice(0, 2));

    const s = await boot('director', R);
    ok('the director opens in the Sales view (the hub read, then the sales read)', s.calls.join() === 'POST:getClientHub,POST:getClientHubSales' && s.els.chLens.hidden === false &&
       /data-lens="sales"/.test(s.els.chLens.innerHTML) && /<select id="chRep">/.test(s.els.chLens.innerHTML), s.calls);
    const L = s.els.chTable.innerHTML;
    ok('  rows: newest update first, the status badge, the last update and the label outline', L.indexOf('Therma South') < L.indexOf('Philex') && /class="ch-badge mid">Following up</.test(L) &&
       /Call 3 Nov · Kimberlyn/.test(L) && /class="ch-tier none">No label</.test(L), L.slice(0, 600));
    ok('  Philex reads No update; Petra has no rep', /No update<\/span>/.test(L) && /No rep/.test(L));
    ok('  the chips and the count line are the sales ones', /data-seg="quiet"[^>]*>Quiet 30\+ days <span class="n">1<\/span>/.test(s.els.chChips.innerHTML) &&
       /<span class="n">1<\/span> of the reps' <span class="n">2<\/span> clients updated in the last 30 days/.test(s.els.chProgress.innerHTML), s.els.chProgress.innerHTML);
    s.run('chDetail(' + JSON.stringify(therma.key) + ', null)');
    const sh = s.ctx.__shown;
    ok('  the client opens on its Sales tab: the status, why, and the next call', /id="chPanel-sales" aria-labelledby="chTab-sales">/.test(sh) && /<p class="ch-sline">Following up<\/p>/.test(sh) &&
       /From Kimberlyn&#39;s call on 3 Nov 2026|From Kimberlyn's call on 3 Nov 2026/.test(sh) && /Next: Call back · 10 Nov 2026/.test(sh), sh.slice(sh.indexOf('chPanel-sales'), sh.indexOf('chPanel-sales') + 900));
    ok('  the rep with a link to their sales plan, and Major | Minor to press', /sales-plan\.html\?user=Kimberlyn%20Blones&amp;tab=accounts/.test(sh) && /data-tier="Major" aria-pressed="false"/.test(sh) && /data-tier="Minor"/.test(sh));
    ok('  the updates, escaped, newest first', /reviewing &lt;i&gt;it&lt;\/i&gt;/.test(sh) && sh.indexOf('Joe · Reached') < sh.indexOf('Sent quotation 2026-6100'));
    s.ctx.__answers.saveClientHubTier = { success: true, tier: 'Major', message: 'Therma South, Inc. is Major now.' };
    await s.run('chSetTier(CH.cards.find(c => c.key === ' + JSON.stringify(therma.key) + '), "Major")');
    const last = s.params[s.params.length - 1];
    ok('pressing Major saves it with the label the page showed, shows it at once, and offers Undo', last.action === 'saveClientHubTier' && last.params.tier === 'Major' && last.params.ifTier === '' &&
       s.run('CH.sales[' + JSON.stringify(therma.key) + '].tier') === 'Major' && /class="ch-tier major">Major</.test(s.els.chTable.innerHTML) && s.ctx.__snack.length === 1 && s.ctx.__snack[0].o.action === 'Undo', last);
    s.ctx.__answers.saveClientHubTier = { success: true, tier: '', message: 'Put back.' };
    await s.ctx.__snack[0].o.onAction();
    const u = s.params[s.params.length - 1];
    ok('  Undo sends each rep\'s own label back, and the page shows No label again', u.params.rows === JSON.stringify([{ clientNo: 'CB-1', tier: '' }]) && u.params.ifTier === 'Major' &&
       s.run('CH.sales[' + JSON.stringify(therma.key) + '].tier') === '', u);
    s.ctx.__answers.saveClientHubTier = { success: false, message: 'Someone changed this client\'s label just now.' };
    await s.run('chSetTier(CH.cards.find(c => c.key === ' + JSON.stringify(therma.key) + '), "Minor")');
    ok('  a refused save puts the label back on the page', s.run('CH.sales[' + JSON.stringify(therma.key) + '].tier') === '');
    const m = await boot('management', R, { answers: { getClientHubSales: salesReply('management') } });
    ok('management gets the same view', m.calls.join() === 'POST:getClientHub,POST:getClientHubSales' && /Following up/.test(m.els.chTable.innerHTML));
    const pre = await boot('director', R, { answers: { getClientHubSales: { success: false, message: 'Unknown action: getClientHubSales' } } });
    ok('a failed sales read says so, and the accreditation view still works', /Could not read the sales updates/.test(pre.els.chNotice.innerHTML) && pre.run('chSetLens("accred"), CH.lens') === 'accred' &&
       /Renew by 1 Dec 2026/.test(pre.els.chTable.innerHTML));
  }

  sec('3 · who sees it, and the site rules');
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
    c.renderNavbar('client-hub');
    return { classic: /href="client-hub\.html"/.test(html), rail: vm.runInContext('ledgerPages(' + JSON.stringify(role) + ').map(p => p.href)', c).indexOf('client-hub.html') >= 0 };
  };
  const roles = ['director', 'admin', 'management', 'accounting', 'sales', 'leadgen', 'hr', 'marketing', 'warehouse'];
  eq('the director\'s, admin\'s, management\'s and HR\'s navbar and rail link it', roles.filter(r => { const n = navFor(r); return n.classic && n.rail; }), ['director', 'admin', 'management', 'hr']);
  eq('  and no other role has it in either', roles.filter(r => { const n = navFor(r); return n.classic || n.rail; }), ['director', 'admin', 'management', 'hr']);
  {
    const ctx = { window: {}, localStorage: { getItem: () => ctx.__s, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      location: { href: '', pathname: '/x.html', search: '' }, navigator: { userAgent: 'node' }, fetch: () => new Promise(() => {}), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
      document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, body: { appendChild() {} } },
      console, Date, JSON, Math, Object, Array, String, Number, Promise };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(AUTH, ctx);
    const admits = (role) => { ctx.__s = JSON.stringify({ username: 'u', name: 'U', role, token: 't', loginTime: Date.now() }); ctx.location.href = ''; return !!vm.runInContext('requireClientHubAccess()', ctx); };
    eq('the guard admits management, admin, the director and HR (marketing too goes home)', roles.filter(admits), ['director', 'admin', 'management', 'hr']);
    const GS = fs.readFileSync(GSP, 'utf8');
    ok('  the server opens it to the same four, and Collection details only to three of them', /var _CH_ROLES = \['management', 'admin', 'director', 'hr'\], _CH_COLLECT = \['management', 'admin', 'director'\];/.test(GS) &&
       /const FLOW_CLIENT_HUB_ROLES = \['management', 'admin', 'director', 'hr'\];/.test(AUTH));
  }
  const H = read('client-hub.html'), JS = read('js/client-hub.js'), MJ = read('js/client-hub-model.js'), CSS = read('css/client-hub.css');
  ok('guarded by requireClientHubAccess, its own navbar entry', /requireClientHubAccess\(\)/.test(JS) && /renderNavbar\('client-hub'\)/.test(JS));
  eq('scripts in order', (H.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), 'theme.js,api.js,auth.js,ledger-nav.js,flow-api.js,client-hub-model.js,client-hub.js');
  ok('its own stylesheet, before ledger.css and apple.css (last)', /css\/client-hub\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">\s*<link rel="stylesheet" href="css\/apple\.css">\s*<\/head>/.test(H));
  const GS = fs.readFileSync(GSP, 'utf8');
  const HANDLERS = Object.keys(eval('({' + GS.match(/var HANDLERS = \{([\s\S]*?)\n\};/)[1].replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:\s*\w+/g, ': 1') + '})'));
  const named = (src) => { const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/mg, ''); return HANDLERS.filter(x => new RegExp("'" + x + "'").test(code)).sort(); };
  eq('the page names only its seven actions', named(JS + MJ), ['archiveClientAccredFile', 'getClientHub', 'getClientHubFile', 'getClientHubSales', 'saveClientAccred', 'saveClientAccredFile', 'saveClientHubTier']);
  const SRC = H + JS + MJ;
  ok('no emoji, no hex colour, no inline style, no inline script', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{3,6}\b/.test(SRC.replace(/&#\d+;/g, '')) && !/style="/.test(H) && !/<script>/.test(H) && !/onclick=/.test(SRC));
  ok('the stylesheet uses tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));
  ok('apple-design: press feedback (scale .97 over 100ms), translucent chrome with a soft edge, a cross-fade under reduced motion',
     /:active[^{]*\{ transform: scale\(\.97\); \}/.test(CSS) && /transition: transform 100ms ease-out/.test(CSS) && /backdrop-filter: blur\(20px\) saturate\(180%\)/.test(CSS) &&
     /\.ch-count::after, \.ch-dhead::after \{ content: ''/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{\s*\.ch-sheet\.ch-enter \{ animation: ch-fade/.test(CSS));
  ok('  the tabs: one indicator kept between draws (it slides), arrow keys, Home and End', /\.ch-thumb\.now \{ transition: none; \}/.test(CSS) && /function chPlaceThumb\(tabs, instant\)/.test(JS) && /'ArrowRight'/.test(JS) && /'Home'/.test(JS));
  ok('  solid bars under reduced transparency, defined edges under more contrast, and a print layout', /prefers-reduced-transparency: reduce/.test(CSS) && /prefers-contrast: more/.test(CSS) && /@media print/.test(CSS));
  ok('  no confirm: archiving a file has an Undo', !/confirm\(/.test(JS) && /hxSnackbar\('Taken off the checklist\.', \{ action: 'Undo'/.test(JS));
  ok('A404: the Sales | Accreditation switch keeps one sliding indicator, arrow keys move it, reduced motion stops it, Major | Minor presses scale',
     /\.ch-lthumb\.now \{ transition: none; \}/.test(CSS) && /function chLensThumb\(box, slide\)/.test(JS) && /'ArrowLeft' && e\.key !== 'ArrowRight'/.test(JS) &&
     /prefers-reduced-motion: reduce\) \{ \.ch-lthumb, \.ch-segbtn \{ transition: none; \}/.test(CSS) && /\.ch-segbtn:active \{ transform: scale\(\.97\); \}/.test(CSS));
  ok('  phone: the switch and the label buttons fill the width with 40px targets', /@media \(max-width: 640px\) \{\s*\.ch-lensrow[\s\S]*?\.ch-lbtn \{ flex: 1; min-width: 0; min-height: 2\.5rem; \}/.test(CSS));
  ok('the file opens in a window opened on the press (not blocked), else downloads', /window\.open\('', '_blank'\)/.test(JS) && /a\.download = r\.fileName/.test(JS));

  console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' passed'));
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
