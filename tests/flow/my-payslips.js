/* A313 — the My payslips page, the day rule on the home ticket, and the navbar link.
 *
 * Run:  node tests/flow/my-payslips.js
 *
 * The rules pinned here:
 *   1. The page obeys the site rules: styles.css first, theme.js first in body, the ticket sheet
 *      linked, no inline style or script, the script guards with requireAuth and renders the navbar.
 *   2. Grouping: months newest first, 1st cutoff before 2nd inside a month, net pay and the release
 *      stamp on every row, a receipt holder per row carrying the ticket host class, a PDF button per
 *      row; fixed-salary slips are never shown; the empty state names the day rule.
 *   3. A row opens its receipt with the short feed and closes it again; the PDF button hands that
 *      row to the shared renderer.
 *   4. The six roles with hourly staff get "My payslips" in the navbar, highlighted on the page;
 *      management and director do not.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });

const D = path.join(__dirname, '../../dashboard/');
const HTML = fs.readFileSync(D + 'my-payslips.html', 'utf8');
const JS = fs.readFileSync(D + 'js/my-payslips.js', 'utf8');
const CSS = fs.readFileSync(D + 'css/my-payslips.css', 'utf8');

console.log('\n1 · the page');
eq('head links, in order', (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(','), 'styles.css,payslip-card.css,my-payslips.css');
eq('scripts, in order', (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), 'theme.js,api.js,auth.js,flow-api.js,payslip.js,my-payslips.js');
ok('theme.js is the first child of body', /<body[^>]*>\s*<script src="js\/theme\.js"><\/script>/.test(HTML));
ok('no inline style or script', !/<style[\s>]/.test(HTML) && !/<script>/.test(HTML) && !/style="/.test(HTML));
ok('the list mounts in a glass section', /<section class="hx-glass" id="mpList">/.test(HTML));
ok('the script guards with requireAuth and renders the navbar for this page', /requireAuth\(\)/.test(JS) && /renderNavbar\('my-payslips'\)/.test(JS));
ok('every rule in the page sheet is scoped to body.mp', CSS.split('\n').filter(l => /^\S.*\{/.test(l) && !/^@/.test(l)).every(l => /^body\.mp /.test(l)), CSS.split('\n').filter(l => /^\S.*\{/.test(l) && !/^@/.test(l) && !/^body\.mp /.test(l)));
ok('no keyframes of its own (the feed comes from payslip-card.css)', !/@keyframes/.test(CSS));

console.log('\n2 · grouping, by month then cutoff');
function mkClip() { const c = { _cls: new Set() }; c.classList = { add: (...a) => a.forEach(x => c._cls.add(x)), remove: (...a) => a.forEach(x => c._cls.delete(x)), contains: (x) => c._cls.has(x) }; c.offsetWidth = 1; return c; }
function mkList() {
  const node = { innerHTML: '', _rows: [], _slips: [], _pdfs: [], _cache: {}, _cacheHtml: null };
  node.querySelectorAll = (sel) => {
    // the same objects for the same markup, as a real DOM would give — the script wires listeners on them
    if (node._cacheHtml !== node.innerHTML) { node._cache = {}; node._cacheHtml = node.innerHTML; }
    if (node._cache[sel]) return node._cache[sel];
    return (node._cache[sel] = build(sel));
  };
  const build = (sel) => {
    if (sel === '.mp-row') { node._rows = (node.innerHTML.match(/class="mp-row"[^>]*data-period="([^"]+)"/g) || []).map(m => ({ period: m.match(/data-period="([^"]+)"/)[1], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(ev, fn) { this.fn = fn; } })); return node._rows; }
    if (sel === '.mp-slip') { node._slips = (node.innerHTML.match(/class="hx-payslip-host mp-slip" hidden/g) || []).map(() => { const clip = mkClip(); return { hidden: true, querySelector: () => clip, clip }; }); return node._slips; }
    if (sel === '.mp-pdf') { node._pdfs = (node.innerHTML.match(/class="btn btn-sm mp-pdf" data-period="([^"]+)"/g) || []).map(m => ({ period: m.match(/data-period="([^"]+)"/)[1], addEventListener(ev, fn) { this.fn = fn; } })); return node._pdfs; }
    return [];
  };
  return node;
}
const head = { _kids: [], appendChild(n) { this._kids.push(n); } };
const ctx = { console, HX_PAYSLIP_CSS: 'x', hxPayslipDownload: (row) => { ctx.__pdf = row; },
  hxPayslipHtml: (s, pr, o) => `<div class="payslip">${s.empName}|${pr.label}|${o.footer}</div>`,
  hxPeso: (v) => '₱' + (Number(v) || 0).toFixed(2),
  document: { addEventListener() {}, getElementById: (id) => (id === 'hxPayslipCss' ? head._kids.find(k => k.id === 'hxPayslipCss') || null : null),
              createElement: () => ({ id: '', textContent: '' }), head }, window: {} };
vm.createContext(ctx); require('./hxutil').load(ctx);
vm.runInContext(JS, ctx);
const row = (period, releasedAt, net, extra) => ({ period, employee: 'Lucena, Gerald', releasedAt, releasedBy: 'Neil Estur',
  slip: Object.assign({ s: { empName: 'LUCENA, GERALD', netPay: net }, pr: { label: period, range: '2026-01-01  to  2026-01-15' } }, extra || {}) });
const list = [
  row('2026-09-B', '2026-09-28 17:00:00', 6204.69),
  row('2026-10-B', '2026-10-28 17:05:00', 6300),
  row('2026-09-A', '2026-09-13 09:00:00', 5550),
  row('2026-10-A', '2026-10-13 09:12:00', 5600),
  { period: '2026-10-A', employee: 'Estur, Neil', releasedAt: '2026-10-13 09:12:00', slip: { s: { empName: 'ESTUR, NEIL', netPay: 9000, isFixed: true }, pr: { label: 'x', range: '' } } },
];
const el = mkList();
ctx.window.__myPayslipsRender(el, []);
ok('empty state names the day rule', /Nothing here yet\. A payslip stays on your home page the day it is released/.test(el.innerHTML));
ctx.window.__myPayslipsRender(el, list);
const months = (el.innerHTML.match(/<section class="mp-month"><h3>([^<]+)/g) || []).map(m => m.replace(/.*<h3>/, ''));
eq('months, newest first', months.join(' | '), 'October 2026 | September 2026');
const periods = el.querySelectorAll('.mp-row').map(r => r.period);
eq('1st cutoff before 2nd inside each month', periods.join(','), '2026-10-A,2026-10-B,2026-09-A,2026-09-B');
ok('the fixed-salary slip is not listed', !/ESTUR, NEIL/.test(el.innerHTML));
ok('each row shows the cutoff, the range, the net pay and the release stamp',
   /1st cutoff<\/span>[\s\S]*?2026-01-01 – 2026-01-15[\s\S]*?₱5600\.00[\s\S]*?Released 13 Oct 2026, 09:12/.test(el.innerHTML), el.innerHTML.slice(0, 600));
eq('a receipt holder per row, hidden until opened', el.querySelectorAll('.mp-slip').length, 4);
eq('a PDF button per row', el.querySelectorAll('.mp-pdf').length, 4);
ok('the receipt is the shared render with the Released footer', /LUCENA, GERALD\|2026-10-A\|Released 13 Oct 2026, 09:12 by Neil Estur/.test(el.innerHTML));
ok('the stylesheet was injected once', head._kids.length === 1 && head._kids[0].id === 'hxPayslipCss');

console.log('\n3 · opening a receipt, and the PDF');
const rows3 = el._rows, slips3 = el._slips;
rows3[1].fn();
ok('clicking the 2nd-cutoff row opens its receipt with the short feed', slips3[1].hidden === false && rows3[1].attrs['aria-expanded'] === 'true' && slips3[1].clip._cls.has('feed') && slips3[1].clip._cls.has('short'));
ok('  the other receipts stay closed', slips3[0].hidden === true && slips3[2].hidden === true);
rows3[1].fn();
ok('clicking again closes it', slips3[1].hidden === true && rows3[1].attrs['aria-expanded'] === 'false' && !slips3[1].clip._cls.has('feed'));
el._pdfs[3].fn({ stopPropagation() {} });
eq('the PDF button hands that row to the shared renderer', ctx.__pdf && ctx.__pdf.period, '2026-09-B');
ok('the shared renderer names the file like the director does', /'Payslip_' \+ safe \+ '_' \+ String\(row\.period \|\| ''\) \+ '\.pdf'/.test(fs.readFileSync(D + 'js/payslip.js', 'utf8')));

console.log('\n4 · the navbar');
const AUTH = fs.readFileSync(D + 'js/auth.js', 'utf8');
function nav(role, active) {
  const c = { console, localStorage: { getItem: (k) => k === 'session' ? JSON.stringify({ username: 'u', name: 'U', role, token: 't', loginTime: Date.now() }) : null, setItem() {}, removeItem() {} },
    document: { getElementById: () => ({ innerHTML: '', querySelectorAll: () => [], addEventListener() {} }), querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    window: {}, location: { href: '', pathname: '/x.html' }, fetch: () => Promise.resolve({ ok: true, json: () => ({}) }), setTimeout: () => 0, clearTimeout() {} };
  c.window = c;
  vm.createContext(c); require('./hxutil').load(c);
  let html = '';
  c.document.getElementById = (id) => { const n = { innerHTML: '', querySelectorAll: () => [], addEventListener() {}, classList: { add() {}, remove() {} } }; if (id === 'navbar') Object.defineProperty(n, 'innerHTML', { set(v) { html = v; }, get() { return html; } }); return n; };
  try { vm.runInContext(AUTH, c); c.renderNavbar(active); } catch (e) { return 'ERR ' + e.message; }
  return html;
}
['sales', 'admin', 'accounting', 'hr', 'marketing', 'leadgen'].forEach(role => {
  const h = nav(role, 'my-payslips');
  ok(`${role}: the navbar links to my-payslips.html, highlighted on the page`, /href="my-payslips\.html" class="active"/.test(h) && /My payslips/.test(h), String(h).slice(0, 200));
});
['management', 'director'].forEach(role => {
  const h = nav(role, 'director-home');
  ok(`${role}: no payslip link (fixed-salary managers)`, typeof h === 'string' && !/my-payslips\.html/.test(h), String(h).slice(0, 120));
});
ok('sales: not highlighted elsewhere', /href="my-payslips\.html" class=""/.test(nav('sales', 'dashboard')));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
