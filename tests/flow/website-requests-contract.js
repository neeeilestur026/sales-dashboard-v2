/* A338 — the website requests inbox (website-requests.html), its "Needs you" line and its links.
 *
 * Run:  node tests/flow/website-requests-contract.js
 *
 * Every field on the page was typed by a stranger on hiescorp.com, and the portal keeps its session in
 * localStorage with 'unsafe-inline' scripts allowed, so one unescaped field would hand an admin account
 * to anyone on the internet. Pinned:
 *   1. The page follows the site rules and loads its scripts in order.
 *   2. Only the admin and the director get in, and only their navbars and rails link it.
 *   3. "Needs you" carries a COUNT and a link, never a name; an urgent line when the bridge is down;
 *      nothing for other roles (they never even ask).
 *   4. A hostile request renders as text: no tag, no attribute break-out, no pre-filled mailto.
 *   5. Before FlowAPI 172 the page says "Not connected yet" and asks nothing.
 *   6. Each button sends the action FlowAPI expects.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');
const H = read('website-requests.html'), JS = read('js/website-requests.js'), AUTH = read('js/auth.js'), NAV = read('js/ledger-nav.js');

console.log('\n1 · the page');
const scripts = (h) => (h.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(',');
eq('scripts in order', scripts(H), 'theme.js,api.js,auth.js,ledger-nav.js,flow-api.js,website-requests.js');
ok('theme.js first in body; one one-line inline script; no <style>, no style=""',
  /<body class="flow-screen">\s*<script src="js\/theme\.js"><\/script>/.test(H) && (H.match(/<script>/g) || []).length === 1
  && /<script>hxDatePill\('long'\);<\/script>/.test(H) && !/<style[\s>]/.test(H) && !/style="/.test(H));
ok('the guard and the navbar', /wrSession = requireWebRequestsAccess\(\);/.test(JS) && /renderNavbar\('website-requests'\)/.test(JS));
ok('no inline onclick: the buttons are wired by delegation', !/onclick=/.test(H) && !/onclick=/.test(JS));
ok('every visitor field goes through flowEsc (no raw ${q.…} or ${it.…})',
  !/\$\{q\.[a-zA-Z]+\}/.test(JS) && !/\$\{it\.[a-zA-Z]+\}/.test(JS));

console.log('\n2 · who gets in, who links it');
function authCtx(role) {
  const store = { session: role ? JSON.stringify({ username: 'u', name: 'U Ser', role, token: 't', loginTime: Date.now() }) : null };
  let html = '';
  const c = { console, window: {},
    localStorage: { getItem: (k) => store[k] === undefined ? null : store[k], setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: '', pathname: '/website-requests.html', search: '' },
    document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} },
      getElementById: (id) => { const n = { innerHTML: '', querySelectorAll: () => [], addEventListener() {}, classList: { add() {}, remove() {} } };
        if (id === 'navbar') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; } },
    fetch: () => Promise.resolve({ ok: true, json: () => ({}) }), setTimeout: () => 0, clearTimeout() {} };
  c.window = c;
  vm.createContext(c); require('./hxutil').load(c);
  vm.runInContext(AUTH, c);
  vm.runInContext(NAV, c);
  return { c, html: () => html };
}
const ROLES = ['admin', 'director', 'management', 'accounting', 'sales', 'leadgen', 'hr', 'marketing', 'warehouse'];
ROLES.forEach(role => {
  const a = authCtx(role);
  const want = role === 'admin' || role === 'director';
  const s = a.c.requireWebRequestsAccess();
  ok(role + (want ? ' gets in' : ' is sent home'), want ? !!s : (s === null && a.c.location.href !== ''), a.c.location.href);
  a.c.renderNavbar('x');
  eq('  ' + role + ' classic navbar links it', /href="website-requests\.html"/.test(a.html()), want);
  const pages = vm.runInContext('typeof ledgerPages === "function" ? ledgerPages(' + JSON.stringify(role) + ').map(p => p.href) : []', a.c);
  eq('  ' + role + ' Ledger rail links it', pages.indexOf('website-requests.html') >= 0, want);
});
{
  const a = authCtx('admin');
  a.c.renderNavbar('website-requests');
  ok('the admin\'s Process Flow menu lights up on the page', /nav-dropdown-btn active[\s\S]{0,400}Process Flow/.test(a.html()));
  const d = authCtx('director');
  d.c.renderNavbar('website-requests');
  ok('the director\'s Quotations menu lights up on the page', /nav-dropdown-btn active[\s\S]{0,400}Quotations/.test(d.html()));
  const verb = vm.runInContext("(LEDGER_VERBS.find(v => v[0].test('3 website requests to answer')) || [])[1]", a.c);
  eq('the Ledger verb for the line', verb, 'Answer');
  const PRJ = read('js/flow-pricing-request.js');
  ok('sourcing marks a website product family (HE-#####) to be swapped for the exact model',
    /\/\^HE-\\d\{5\}\$\/\.test\(String\(i\.itemNo \|\| ''\)\.trim\(\)\) \? '<div class="fc-dim">Website product family/.test(PRJ));
}

console.log('\n3 · "Needs you": a count, never a name');
async function strip(role, answer) {
  const a = authCtx(role);
  const asked = [];
  a.c.fetchFlow = () => Promise.resolve({ success: true, data: [] });
  a.c.postFlow = (action, params) => { asked.push([action, params]);
    return action === 'getWebRequests' ? (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)) : Promise.resolve({ success: true, data: [], items: [] }); };
  const items = await a.c.flowComputeActions(JSON.parse(a.c.localStorage.getItem('session')));
  return { items, asked: asked.filter(x => x[0] === 'getWebRequests') };
}
const three = { success: true, count: 3, health: { stale: false }, data: [{ name: '<img src=x onerror=alert(1)>Juan', company: 'Acme' }] };
(async () => {
  for (const role of ['admin', 'director']) {
    const r = await strip(role, three);
    const line = r.items.find(i => /website request/.test(i.text));
    ok(role + ': "3 website requests to answer" → the inbox', line && line.text === '3 website requests to answer' && line.link === 'website-requests.html', r.items);
    ok('  asked for the count only', r.asked.length === 1 && r.asked[0][1].countOnly === true, r.asked);
    ok('  and no visitor text reaches the strip', !r.items.some(i => /Juan|Acme|img/.test(i.text)));
  }
  let r = await strip('director', { success: true, count: 1, health: { stale: false } });
  ok('one request reads in the singular', r.items.some(i => i.text === '1 website request to answer'));
  r = await strip('admin', { success: true, count: 0, health: { stale: true } });
  ok('the bridge down for 30+ minutes: an urgent line, even with nothing waiting', r.items.some(i => i.tone === 'urgent' && /not reaching the portal/.test(i.text) && i.link === 'website-requests.html')
    && !r.items.some(i => /to answer/.test(i.text)), r.items);
  r = await strip('admin', { success: false, message: 'Unknown action: getWebRequests' });
  ok('before FlowAPI 172 it adds nothing', !r.items.some(i => /website/i.test(i.text)));
  r = await strip('admin', new Error('offline'));
  ok('a failed read adds nothing and breaks nothing', !r.items.some(i => /website/i.test(i.text)));
  for (const role of ['management', 'accounting', 'sales', 'leadgen']) {
    r = await strip(role, three);
    ok(role + ' never asks for website requests', r.asked.length === 0 && !r.items.some(i => /website/i.test(i.text)));
  }
  await render();
  finish();
})().catch(e => { FAIL++; console.log('  FAIL threw: ' + (e && e.stack || e)); finish(); });

async function render() {
  console.log('\n4 · a hostile request renders as text');
  const evil = { ref: 'Q-261016-4821', kind: 'quote', status: 'New', receivedAt: new Date().toISOString(), sentAt: new Date().toISOString(),
    name: '"><img src=x onerror=alert(1)>', company: "Acme' onmouseover='alert(1)", email: 'x@y.ph?subject=Hi&body=<script>alert(1)</script>',
    phone: '+63 917 <b>000</b> 0000', location: '<svg onload=alert(1)>', subject: '', message: '</div><script>alert(1)</script>',
    items: [{ sku: 'HE-01323', name: '<iframe src=x>', brand: 'RAD', category: '<b>c</b>', range: '', qty: 2 }], itemCount: 1, unitCount: 2, note: '' };
  const contact = { ref: 'C-261016-1177', kind: 'contact', status: 'New', receivedAt: new Date().toISOString(), name: 'Maria', email: 'm@x.ph', items: [], unitCount: 0, message: 'Hello', note: '' };
  const p = page(['js/website-requests.js'], 'website-requests.html', { username: 'u', name: 'Ana Admin', role: 'admin' }, { data: { getWebRequests: [evil, contact] } });
  p.run('requireWebRequestsAccess = function(){ return __session; };');
  await p.boot();
  const html = p.els.wrList.innerHTML;
  ok('it rendered both requests', /Q-261016-4821/.test(html) && /C-261016-1177/.test(html), html.slice(0, 300));
  ok('no tag a visitor typed survives', !/<img|<svg|<script|<iframe|<b>000|<b>c</i.test(html) && /&lt;b&gt;000&lt;\/b&gt;/.test(html), (html.match(/<(img|svg|script|iframe)\b[^>]*>/gi) || []).slice(0, 3));
  ok('no attribute break-out (quotes escaped)', !/' onmouseover='|" onerror/.test(html) && /&#39; onmouseover=&#39;/.test(html));
  ok('the mailto link never carries a pre-filled subject or body', /href="mailto:x@y\.ph"/.test(html) && !/mailto:[^"]*\?/.test(html));
  ok('the tel link keeps digits and + only', /href="tel:\+639170000000"/.test(html));
  ok('a quote with products offers "Make pricing request"; a message without products does not',
    (html.match(/data-act="convert"/g) || []).length === 1);
  ok('the health line is written as text, never HTML', /el\.textContent = text;/.test(JS));

  console.log('\n4b · A341: quote lists become purchase requests by themselves');
  const now = new Date().toISOString();
  p.ctx.wrShowHealth({ configured: true, okAt: now, auto: true, autoWaiting: 2 });
  ok('the health line says so, and how many are still to make', /become purchase requests by themselves\. 2 still to make on the next check\./.test(p.els.wrHealth.textContent), p.els.wrHealth.textContent);
  p.ctx.wrShowHealth({ configured: true, okAt: now, auto: false });
  ok('  and when it is switched off, what to do instead', /WEBSITE_AUTO_PR_OFF\): use Make pricing request/.test(p.els.wrHealth.textContent), p.els.wrHealth.textContent);
  p.ctx.wrShowHealth({ configured: true, okAt: now });
  ok('  FlowAPI before 174 says nothing about it', !/purchase request/.test(p.els.wrHealth.textContent), p.els.wrHealth.textContent);
  const made = p.ctx.wrCard({ ref: 'Q-261018-1010', kind: 'quote', status: 'Converted', prNo: 'PR-261018-001', customer: 'Acme', salesperson: 'Admin', handledBy: 'Website',
    handledAt: now, receivedAt: now, name: 'Juan', items: [{ sku: 'HE-1', name: 'Pump', qty: 1 }], unitCount: 1, note: '' });
  ok('a request made automatically links its purchase request and says what happens next',
    /Purchase request <a href="flow-pricing-request\.html\?pr=PR-261018-001">PR-261018-001<\/a> for Acme, made automatically/.test(made) && /forwards it to a sales rep/.test(made)
    && !/quoted by Admin/.test(made) && !/data-act="convert"/.test(made), made);
  const failed = p.ctx.wrCard(Object.assign({}, evil, { note: 'Automatic purchase request failed: Customer is required.' }));
  ok('  one the automatic step could not make keeps its note and the button', /Automatic purchase request failed/.test(failed) && /data-act="convert"/.test(failed));

  console.log('\n5 · before FlowAPI 172');
  const q = page(['js/website-requests.js'], 'website-requests.html', { username: 'u', name: 'N', role: 'director' }, { data: {} });
  q.run('requireWebRequestsAccess = function(){ return __session; }; flowVersionAtLeast = function(){ return Promise.resolve(false); };');
  await q.boot();
  ok('it says "Not connected yet" and asks nothing', /Not connected yet/.test(q.els.wrHealth.textContent) && q.calls.length === 0 && q.els.wrCheck.disabled === true, q.calls);

  console.log('\n6 · the buttons send what FlowAPI expects');
  const click = async (act, ref, setup) => {
    const r = page(['js/website-requests.js'], 'website-requests.html', { username: 'u', name: 'Ana Admin', role: 'admin' }, { data: { getWebRequests: [evil] } });
    r.run('requireWebRequestsAccess = function(){ return __session; };');
    await r.boot();
    if (setup) setup(r);
    r.calls.length = 0; r.params.length = 0;
    const btn = { dataset: { act, ref }, disabled: false };
    await r.ctx.wrClick({ target: { closest: () => btn } });
    return r.params.filter(x => !/^get/.test(x.action));
  };
  let sent = await click('spam', 'Q-261016-4821');
  eq('Spam', sent.map(x => [x.action, x.params]), [['setWebRequestStatus', { ref: 'Q-261016-4821', status: 'Spam' }]]);
  sent = await click('reopen', 'Q-261016-4821');
  eq('Reopen', sent.map(x => [x.action, x.params]), [['setWebRequestStatus', { ref: 'Q-261016-4821', status: 'New' }]]);
  sent = await click('close', 'Q-261016-4821', r => { r.ctx.prompt = () => '  Replied by email '; });
  eq('Close, with the note', sent.map(x => [x.action, x.params]), [['setWebRequestStatus', { ref: 'Q-261016-4821', status: 'Closed', note: 'Replied by email' }]]);
  sent = await click('close', 'Q-261016-4821', r => { r.ctx.prompt = () => null; });
  eq('Close, cancelled: nothing sent', sent.length, 0);
  sent = await click('erase', 'Q-261016-4821', r => { r.ctx.confirm = () => false; });
  eq('Erase, not confirmed: nothing sent', sent.length, 0);
  sent = await click('erase', 'Q-261016-4821', r => { r.ctx.confirm = () => true; });
  eq('Erase, confirmed', sent.map(x => x.action), ['eraseWebRequest']);
  sent = await click('convert-go', 'Q-261016-4821', r => { r.els.wrCust = { value: ' Acme Mining Corp. ' }; r.els.wrSales = { value: 'Kimberlyn Blones' }; });
  eq('Make it: the customer and salesperson as typed, trimmed', sent.map(x => [x.action, x.params]),
    [['convertWebRequest', { ref: 'Q-261016-4821', customer: 'Acme Mining Corp.', salesperson: 'Kimberlyn Blones' }]]);
  sent = await click('convert-go', 'Q-261016-4821', r => { r.els.wrCust = { value: '  ' }; r.els.wrSales = { value: '' }; });
  eq('Make it with no customer: nothing sent', sent.length, 0);
}

function finish() {
  console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
  process.exit(FAIL ? 1 : 0);
}
