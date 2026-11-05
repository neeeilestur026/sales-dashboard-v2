/* A396 — the client information hub in the browser: the model (labels, filters, the checklist, the CSV), the page per role
 * (the reply comes from the REAL FlowAPI.gs through gasload, so page and store cannot drift), who sees it, and the site rules.
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
function reply(role, name) {
  const Dt = (m, d) => new Date(2026, m - 1, d, 10);
  const store = {
    Clients: [{ 'Customer': 'Therma South, Inc.', 'Address': 'Toril, Davao', 'Contact Person': 'Joe <b>Cruz</b>', 'Phone': '0917 123 4567', 'Payment Terms': '30 days', 'TIN': '123' },
              { 'Customer': 'Petra Cement Inc.', 'Stage': 'Prospect' }],
    ClientBook: [{ 'Client No': 'CB-1', 'Company': 'Therma South, Inc.', 'Owner': 'Kimberlyn Blones', 'Accreditation': 'Accredited', 'Accredited Until': '2026-12-01', 'Accreditation Updated At': Dt(10, 22), 'Archived At': '', 'Sector': 'Power' },
                 { 'Client No': 'CB-2', 'Company': 'Philex Mining', 'Owner': 'Gerald Lucena', 'Accreditation': 'On process', 'Accreditation Step': 'Site audit', 'Accreditation Updated At': Dt(10, 25), 'Archived At': '' }],
    CollectionBook: [{ 'Client No': 'CC-1', 'Client': 'Therma South Inc.', 'Pays By': 'Cheque', 'Their Bank': 'BDO' }],
    ClientAccredFiles: [{ 'File No': 'CAF-1', 'Key': 'therma south', 'Company': 'Therma South, Inc.', 'Year': 2025, 'Requirement': 'Business permit', 'File ID': 'x', 'File Name': 'Permit 2025.pdf',
                          'File Type': 'application/pdf', 'File Size': 120000, 'Uploaded By': 'Ana Admin', 'Uploaded At': Dt(1, 5) }],
    FlowSettings: []
  };
  const c = load(GSP, store);
  c._now = () => Dt(11, 5);
  return call(c, 'getClientHub', { actorRole: role, actorName: name || 'Neil Estur', actorUsername: role + '1' });
}

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
  const boot = async (role, rep) => {
    const p = page(['js/client-hub-model.js', 'js/client-hub.js'], 'client-hub.html', { role, name: 'Someone', username: role + '1' });
    p.ctx.__answer = rep;
    p.run('requireClientHubAccess = function () { return __session; }; postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); return Promise.resolve(__answer); };' +
          'flowToday = function () { return "2026-11-05"; }; chShow = function (html) { __shown = html; return { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} }; };');
    await p.boot();
    return p;
  };
  const d = await boot('director', R);
  const list2 = d.els.chTable.innerHTML;
  ok('one read; every client listed with its accreditation badge', d.calls.join() === 'POST:getClientHub' && (list2.match(/class="ch-open/g) || []).length === 3 && /Renew by 1 Dec 2026/.test(list2), list2.slice(0, 300));
  ok('  names are escaped', !/<b>Cruz<\/b>/.test(list2));
  ok('  the chips and the count line', /data-seg="renew"[^>]*>Renew soon <span class="n">1<\/span>/.test(d.els.chChips.innerHTML) && /<span class="n">1<\/span> to renew soon/.test(d.els.chProgress.innerHTML), d.els.chChips.innerHTML);
  d.run('chDetail(' + JSON.stringify(therma.key) + ', null)');
  const shown = d.ctx.__shown;
  ok('the client: four tabs, the accreditation line, both groups of billing and collection', (shown.match(/role="tab"/g) || []).length === 4 && /Accredited · expires 1 Dec 2026 · renew within 26 days/.test(shown) &&
     /<h4 class="ch-gh">Billing<\/h4>/.test(shown) && /<h4 class="ch-gh">Collection<\/h4>/.test(shown) && /Cheque/.test(shown), shown.slice(0, 200));
  ok('  the director can edit the dates, upload, and reuse 2025\'s permit for 2026', /data-dates/.test(shown) && /data-upload/.test(shown) && /data-reuse="CAF-1">Use for 2026/.test(shown));
  ok('  the people are escaped and calls are tap-to-call', /Joe &lt;b&gt;Cruz&lt;\/b&gt;/.test(shown) && /href="tel:09171234567"/.test(shown));
  ok('  the director opens (not edits) Collection details, and gets no Client master link (its page is not his)', /Open in Collection details/.test(shown) && !/flow-clients\.html/.test(shown));
  const HRR = reply('hr', 'Jiezzel Barrios');
  const h = await boot('hr', HRR);
  h.run('chDetail(' + JSON.stringify(therma.key) + ', null)');
  ok('HR: no Collection group, no Cheque, but HR keeps the accreditation dates and files', !/<h4 class="ch-gh">Collection<\/h4>/.test(h.ctx.__shown) && !/Cheque|BDO/.test(h.ctx.__shown) && /data-upload/.test(h.ctx.__shown) && /data-dates/.test(h.ctx.__shown));
  const a = await boot('admin', reply('admin', 'Ana Admin'));
  a.run('chDetail(' + JSON.stringify(therma.key) + ', null)');
  ok('admin: edit links to the Client master and Collection details', /Edit in the Client master/.test(a.ctx.__shown) && /Edit in Collection details/.test(a.ctx.__shown));
  const old = await boot('director', { success: false, message: 'Unknown action: getClientHub' });
  ok('before FlowAPI 199: a plain notice, no list', /version 199/.test(old.els.chNotice.innerHTML) && !/ch-open/.test(old.els.chTable.innerHTML));

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
  eq('the page names only its five actions', named(JS + MJ), ['archiveClientAccredFile', 'getClientHub', 'getClientHubFile', 'saveClientAccred', 'saveClientAccredFile']);
  const SRC = H + JS + MJ;
  ok('no emoji, no hex colour, no inline style, no inline script', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(SRC) && !/#[0-9a-fA-F]{3,6}\b/.test(SRC.replace(/&#\d+;/g, '')) && !/style="/.test(H) && !/<script>/.test(H) && !/onclick=/.test(SRC));
  ok('the stylesheet uses tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));
  ok('apple-design: press feedback (scale .97 over 100ms), translucent chrome with a soft edge, a cross-fade under reduced motion',
     /:active[^{]*\{ transform: scale\(\.97\); \}/.test(CSS) && /transition: transform 100ms ease-out/.test(CSS) && /backdrop-filter: blur\(20px\) saturate\(180%\)/.test(CSS) &&
     /\.ch-count::after, \.ch-dhead::after \{ content: ''/.test(CSS) && /@media \(prefers-reduced-motion: reduce\) \{\s*\.ch-sheet\.ch-enter \{ animation: ch-fade/.test(CSS));
  ok('  the tabs: one indicator kept between draws (it slides), arrow keys, Home and End', /\.ch-thumb\.now \{ transition: none; \}/.test(CSS) && /function chPlaceThumb\(tabs, instant\)/.test(JS) && /'ArrowRight'/.test(JS) && /'Home'/.test(JS));
  ok('  solid bars under reduced transparency, defined edges under more contrast, and a print layout', /prefers-reduced-transparency: reduce/.test(CSS) && /prefers-contrast: more/.test(CSS) && /@media print/.test(CSS));
  ok('  no confirm: archiving a file has an Undo', !/confirm\(/.test(JS) && /hxSnackbar\('Taken off the checklist\.', \{ action: 'Undo'/.test(JS));
  ok('the file opens in a window opened on the press (not blocked), else downloads', /window\.open\('', '_blank'\)/.test(JS) && /a\.download = r\.fileName/.test(JS));

  console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' passed'));
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
