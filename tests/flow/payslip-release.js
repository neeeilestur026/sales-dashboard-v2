/* A312 — released payslips: the director files the on-screen figures, the employee reads only their own.
 *
 * Run:  node tests/flow/payslip-release.js
 *
 * The rules pinned here:
 *   1. The receipt is drawn in ONE place: director-home's _payslipHtml and js/payslip.js's hxPayslipHtml
 *      produce the same HTML for the same figures (only the footer line is the caller's).
 *   2. releasePayslips: a director upserts one row per (period, employee); a second release overwrites;
 *      a fixed-salary employee is skipped; a sales login is refused; GET is refused.
 *   3. Which login gets it: the Username column wins; else the ONE roster name made of the same words;
 *      ambiguous or unknown names come back as unlinked, never guessed.
 *   4. getMyPayslips: the owner's rows only, newest cutoff first; a spoofed username param changes
 *      nothing; no session is an authError.
 *   5. getPayrollRegister says who already has the cutoff (released map).
 *   6. The card: hidden with nothing to show; renders the ticket chrome around hxPayslipHtml output;
 *      Earlier/Later walks the cutoffs; no inline style= in its markup.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeCtx, seedSession } = require('./gasload-code');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });

const D = path.join(__dirname, '../../dashboard/');
const DH = fs.readFileSync(D + 'js/director-home.js', 'utf8');
const PS = fs.readFileSync(D + 'js/payslip.js', 'utf8');
const CARD = fs.readFileSync(D + 'js/my-payslip-card.js', 'utf8');

/* ── 1 · one renderer ─────────────────────────────────────────────────────────────────────────── */
console.log('\n1 · the director page and the ticket draw the same receipt');
const el = () => ({ innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, disabled: false,
  classList: { add() {}, remove() {}, contains: () => false },
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, addEventListener() {},
  setAttribute() {}, getAttribute: () => null });
const ctx = { console,
  document: { addEventListener() {}, getElementById: () => el(), querySelectorAll: () => [], createElement: () => el(), body: el() },
  localStorage: { getItem: () => null, setItem() {} }, location: { origin: 'http://localhost' }, window: {} };
vm.createContext(ctx);
require('./hxutil').load(ctx);
vm.runInContext(PS, ctx);
vm.runInContext(DH + `
this.__t = { set(emps, hours, reg, y, m) { _employees = emps; _hoursA = hours; _hoursB = hours; _holidaysA = {}; _holidaysB = {};
  _registerA = reg; _registerB = reg; _currentYear = y; _currentMonth = m; },
  slipHtml: _payslipHtml, compute: _computePaySlip, period: _payslipPeriod, shared: hxPayslipHtml, css: _PAYSLIP_CSS };`, ctx);
const T = ctx.__t;
const EMP = { firstName: 'Gerald', lastName: 'Lucena', dailyRate: 575, otherIncome: 0, hdmfAmount: 200, sssAmount: 600, philhealthAmount: 200 };
const H = (who, d, hrs) => ({ [who + '|2026-10-' + d]: { employee: who, date: '2026-10-' + d, dayType: 'Regular', hours: hrs } });
T.set([EMP], Object.assign({}, H('Lucena, Gerald', '12', 8), H('Lucena, Gerald', '13', 9)), {}, 2026, '10');
const s = T.compute(EMP, 'B'), pr = T.period('B');
const strip = (h) => h.replace(/<div class="ps-foot">[\s\S]*?<\/div>/, '');
ok('same HTML above the footer', strip(T.slipHtml(EMP, 'B')) === strip(T.shared(s, pr)));
ok('the footer is the caller\'s', /Released 1 Oct 2026, 10:48<br>/.test(T.shared(s, pr, { footer: 'Released 1 Oct 2026, 10:48' })));
ok('  and defaults to "Generated"', /ps-foot">Generated /.test(T.shared(s, pr)));
ok('the pinned stylesheet name still resolves to the shared sheet', T.css.length > 500 && /\.payslip \{/.test(T.css));
ok('_PAYSLIP_CSS is no longer defined in director-home.js', !/const _PAYSLIP_CSS = `/.test(DH) && /var _PAYSLIP_CSS = \(typeof HX_PAYSLIP_CSS/.test(DH));
ok('hxPayslipHtml is defined exactly once, in payslip.js', (PS.match(/function hxPayslipHtml\(/g) || []).length === 1 && !/function hxPayslipHtml\(/.test(DH));
ok('the release button sits beside download, hourly rows only', /_isFixedPay\(emp\) \? '' : _releaseBtn\(empName, cutoff\)/.test(DH) && /const _ICO_SEND = '<svg/.test(DH));
ok('a release sends the computed figures and the period labels', /slip: \{ s: _computePaySlip\(e, cutoff\), pr: _payslipPeriod\(cutoff\) \}/.test(DH));

/* ── 2–5 · Code.gs ────────────────────────────────────────────────────────────────────────────── */
console.log('\n2 · Code.gs: who may release, and what is stored');
const b64 = (x) => Buffer.from(x).toString('base64');
function boot() {
  const store = {
    Users: [
      ['Username', 'Password', 'Role', 'Full Name', 'Quotation Sheet ID', 'PR Sheet ID', 'PO Sheet ID', '', '', '', 'MRO Sheet ID', '', 'Training Mode'],
      ['neil',   b64('x'), 'director', 'Neil Estur',     '', '', '', '', '', '', '', '', 'FALSE'],
      ['gerald', b64('x'), 'sales',    'Gerald Lucena',  '', '', '', '', '', '', '', '', 'FALSE'],
      ['kim',    b64('x'), 'sales',    'Kimberlyn Blones', '', '', '', '', '', '', '', '', 'FALSE'],
      ['jay',    b64('x'), 'sales',    'Jay Ralph Jepollo', '', '', '', '', '', '', '', '', 'FALSE'],
      ['jay2',   b64('x'), 'sales',    'Jepollo Jay Ralph', '', '', '', '', '', '', '', '', 'FALSE'],   // the same words → ambiguous
    ],
    Sessions: [['Token', 'Username', 'FullName', 'Role', 'CreatedAt', 'ExpiresAt']],
    'Payroll Employees': [
      ['Last Name', 'First Name', 'Daily Rate', 'Other Income', 'HDMF Amount', 'Status', 'Pay Type', 'Fixed Amount', 'SSS Amount', 'PhilHealth Amount', 'Date Hired', 'Username'],
      ['Estur', 'Neil', 692, 0, 0, 'Active', 'Fixed', 9000, 0, 0, '', ''],
      ['Lucena', 'Gerald', 575, 0, 200, 'Active', 'Hourly', 0, 600, 200, '', ''],          // linked by name
      ['Blones', 'Kimberlyn', 575, 0, 200, 'Active', 'Hourly', 0, 600, 200, '', 'kim'],    // linked by column
      ['Jepollo', 'Jay Ralph', 675, 0, 200, 'Active', 'Hourly', 0, 600, 200, '', ''],      // two roster matches
      ['Limpoco', 'Aira', 550, 0, 200, 'Active', 'Hourly', 0, 600, 200, '2026-09-14', ''],  // nobody on the roster
    ],
  };
  seedSession(store, 'T-dir', 'neil', 'Neil Estur', 'director');
  seedSession(store, 'T-gerald', 'gerald', 'Gerald Lucena', 'sales');
  seedSession(store, 'T-kim', 'kim', 'Kimberlyn Blones', 'sales');
  const c = makeCtx(store, { USERS_SHEET_ID: 'users-sheet', INTERNAL_SHARED_SECRET: 'server-secret' });
  c.__store = store;
  return c;
}
const post = (c, body) => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const get = (c, params) => JSON.parse(c.doGet({ parameter: params }).getContent());
const slipFor = (name, net) => ({ s: Object.assign({}, s, { empName: name, netPay: net }), pr: { label: '2nd Cutoff — October 2026', range: '2026-10-11  to  2026-10-25' } });
const rowsOf = (list) => JSON.stringify(list.map(([n, net]) => ({ employee: n, slip: slipFor(n, net) })));

const c = boot();
let r = post(c, { action: 'releasePayslips', token: 'T-gerald', period: '2026-10-B', rows: rowsOf([['Lucena, Gerald', 1]]) });
ok('a sales login may not release (the door says Forbidden; the handler itself says Not permitted)', r.success === false && /Not permitted|Forbidden/.test(r.message), r);
r = get(c, { action: 'releasePayslips', token: 'T-dir', period: '2026-10-B', rows: rowsOf([['Lucena, Gerald', 1]]) });
ok('GET is refused — it is a mutation', /POST/.test(r.message || ''), r);
r = post(c, { action: 'releasePayslips', token: 'T-dir', period: '2026-10-X', rows: rowsOf([['Lucena, Gerald', 1]]) });
ok('a malformed period is refused', r.success === false && /Period/.test(r.message), r);
r = post(c, { action: 'releasePayslips', token: 'T-dir', period: '2026-10-B',
  rows: rowsOf([['Lucena, Gerald', 5000], ['Blones, Kimberlyn', 5100], ['Jepollo, Jay Ralph', 5200], ['Limpoco, Aira', 5300], ['Estur, Neil', 9000], ['Nobody, Here', 1]]) });
ok('the director releases', r.success === true, r);
eq('  Lucena linked by name, Blones by column', (r.released || []).map(x => x.employee + '=' + x.username).join(' | '), 'Lucena, Gerald=gerald | Blones, Kimberlyn=kim');
eq('  the ambiguous and the unknown names come back unlinked', (r.unlinked || []).join(' | '), 'Jepollo, Jay Ralph | Limpoco, Aira | Nobody, Here');
eq('  the fixed-salary manager is skipped', (r.skipped || []).join('|'), 'Estur, Neil');
const sheet = () => c.__store.Payslips || [];
eq('two rows filed', sheet().length - 1, 2);
eq('  under the period, the employee and the login', sheet()[1].slice(0, 3).join('|'), '2026-10-B|Lucena, Gerald|gerald');
ok('  stamped with who released it', sheet()[1][4] === 'Neil Estur' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(sheet()[1][3])), sheet()[1].slice(3, 5));
ok('  the slip is stored as JSON with the figures and the labels', JSON.parse(sheet()[1][5]).s.netPay === 5000 && /October 2026/.test(JSON.parse(sheet()[1][5]).pr.label));
r = post(c, { action: 'releasePayslips', token: 'T-dir', period: '2026-10-B', rows: rowsOf([['Lucena, Gerald', 5555]]) });
eq('releasing again overwrites rather than appends', sheet().length - 1, 2);
eq('  with the new figures', JSON.parse(sheet()[1][5]).s.netPay, 5555);
r = post(c, { action: 'releasePayslips', token: 'T-dir', period: '2026-10-A', rows: rowsOf([['Lucena, Gerald', 4000]]) });
eq('another cutoff is a new row', sheet().length - 1, 3);

console.log('\n3 · getMyPayslips: your own, newest first, nobody else\'s');
r = get(c, { action: 'getMyPayslips', token: 'T-gerald' });
ok('the owner sees both cutoffs', r.success === true && r.data.length === 2, r);
eq('  newest first', r.data.map(x => x.period).join(','), '2026-10-B,2026-10-A');
eq('  with the released figures', r.data[0].slip.s.netPay, 5555);
ok('  and the stamp', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(r.data[0].releasedAt) && r.data[0].releasedBy === 'Neil Estur', r.data[0]);
r = get(c, { action: 'getMyPayslips', token: 'T-kim' });
eq('another employee sees only her own', r.data.map(x => x.employee).join(','), 'Blones, Kimberlyn');
r = get(c, { action: 'getMyPayslips', token: 'T-kim', username: 'gerald' });
eq('  a spoofed username param changes nothing', r.data.map(x => x.employee).join(','), 'Blones, Kimberlyn');
r = get(c, { action: 'getMyPayslips', token: 'T-dir' });
eq('the director, who was never released to, sees none', r.data.length, 0);
r = get(c, { action: 'getMyPayslips' });
ok('no session → authError', r.success === false && r.authError === true, r);

console.log('\n4 · the register says who already has the cutoff');
r = get(c, { action: 'getPayrollRegister', token: 'T-dir', period: '2026-10-B' });
ok('released map present', r.success === true && r.released && typeof r.released === 'object', r);
eq('  Lucena and Blones for B', Object.keys(r.released).sort().join(' | '), 'Blones, Kimberlyn | Lucena, Gerald');
r = get(c, { action: 'getPayrollRegister', token: 'T-dir', period: '2026-11-A' });
eq('  nothing for an untouched cutoff', Object.keys(r.released || {}).length, 0);
const c2 = boot();
r = get(c2, { action: 'getPayrollRegister', token: 'T-dir', period: '2026-10-B' });
ok('a backend with no Payslips sheet yet answers an empty map, and does not create the sheet', r.success === true && Object.keys(r.released).length === 0 && !c2.__store.Payslips, r);

console.log('\n5 · the employee record carries the login');
r = get(c, { action: 'getPayrollEmployees', token: 'T-dir' });
eq('username read from column 12', r.data.find(e => e.lastName === 'Blones').username, 'kim');
r = post(c, { action: 'savePayrollEmployee', token: 'T-dir', id: 2, lastName: 'Lucena', firstName: 'Gerald', dailyRate: 575, otherIncome: 0, hdmfAmount: 200, status: 'Active', payType: 'Hourly', sssAmount: 600, philhealthAmount: 200, username: 'gerald' });
ok('saving the employee stores it', r.success === true && c.__store['Payroll Employees'][2][11] === 'gerald', r);
ok('  without a rate-history row for it', !(c.__store['Payroll Rate History'] || []).slice(1).some(h => /Username/i.test(String(h[2]))));
r = post(c, { action: 'releasePayslips', token: 'T-dir', period: '2026-11-A', rows: rowsOf([['Jepollo, Jay Ralph', 1]]) });
eq('an ambiguous name stays unlinked until the director picks', (r.unlinked || []).join(','), 'Jepollo, Jay Ralph');
post(c, { action: 'savePayrollEmployee', token: 'T-dir', id: 4, lastName: 'Jepollo', firstName: 'Jay Ralph', dailyRate: 675, otherIncome: 0, hdmfAmount: 200, status: 'Active', payType: 'Hourly', sssAmount: 600, philhealthAmount: 200, username: 'jay' });
r = post(c, { action: 'releasePayslips', token: 'T-dir', period: '2026-11-A', rows: rowsOf([['Jepollo, Jay Ralph', 1]]) });
eq('  then the column wins', (r.released || []).map(x => x.username).join(','), 'jay');

/* ── 6 · the card ─────────────────────────────────────────────────────────────────────────────── */
console.log('\n6 · the ticket on the employee\'s home');
ok('no inline style attributes in the card markup', !/style="/.test(CARD) && !/style=\\"/.test(CARD));
ok('the card asks only for its own payslips and draws them with the shared renderer', /apiGetMyPayslips\(\)/.test(CARD) && /hxPayslipHtml\(r\.slip\.s, pr,/.test(CARD));
ok('fixed-salary slips are filtered out even if one were stored', /!r\.slip\.s\.isFixed/.test(CARD));
// a tiny DOM: enough for render() — innerHTML, querySelector(All), classList, style
function mkEl() {
  const node = { innerHTML: '', style: {}, _cls: new Set(), children: [],
    classList: { add: (...a) => a.forEach(x => node._cls.add(x)), remove: (x) => node._cls.delete(x), contains: (x) => node._cls.has(x) },
    querySelector: (sel) => (sel === '.hx-ticket-clip' && /hx-ticket-clip/.test(node.innerHTML)) ? node._clip : null,
    querySelectorAll: (sel) => (sel === '.hx-ticket-nav button') ? (node.innerHTML.match(/data-step="(-?1)"[^>]*>/g) || []).map(m => ({ dataset: { step: m.match(/-?1/)[0] }, addEventListener: (ev, fn) => { node._btns = node._btns || []; node._btns.push({ step: m.match(/-?1/)[0], disabled: / disabled/.test(m), fn }); } }))
      : (sel === '[data-pdf]') ? (node.innerHTML.match(/data-pdf/g) || []).map(() => ({ addEventListener: (ev, fn) => { node._pdf = node._pdf || []; node._pdf.push(fn); } })) : [],
    appendChild() {}, _clip: null };
  node._clip = mkClip();
  return node;
}
function mkClip() { const c = { _cls: new Set() }; c.classList = { add: (...a) => a.forEach(x => c._cls.add(x)), remove: (x) => c._cls.delete(x), contains: (x) => c._cls.has(x) }; return c; }
const head = { _kids: [], appendChild(n) { this._kids.push(n); } };
const cctx = { console, HX_PAYSLIP_CSS: 'x', flowToday: () => '2026-10-28', hxPayslipDownload: (row) => { cctx.__pdf = row; }, hxPayslipHtml: (s2, pr2, o) => `<div class="payslip">${s2.empName}|${pr2.label}|${o.footer}</div>`,
  document: { addEventListener() {}, getElementById: (id) => (id === 'hxPayslipCss' ? head._kids.find(k => k.id === 'hxPayslipCss') || null : null),
              createElement: () => ({ id: '', textContent: '' }), head }, window: {} };
vm.createContext(cctx); require('./hxutil').load(cctx);
vm.runInContext(CARD, cctx);
const mount = mkEl();
cctx.window.__myPayslipRender(mount, []);
eq('nothing released → hidden', mount.style.display, 'none');
const list = [
  { period: '2026-10-B', employee: 'Lucena, Gerald', releasedAt: '2026-10-28 17:05:00', releasedBy: 'Neil Estur', slip: { s: { empName: 'Lucena, Gerald' }, pr: { label: '2nd Cutoff — October 2026', range: '' } } },
  { period: '2026-10-A', employee: 'Lucena, Gerald', releasedAt: '2026-10-28 09:00:00', releasedBy: 'Neil Estur', slip: { s: { empName: 'Lucena, Gerald' }, pr: { label: '1st Cutoff — October 2026', range: '' } } },
  // A313 — released on another day: belongs to the My payslips page, not the home ticket
  { period: '2026-09-B', employee: 'Lucena, Gerald', releasedAt: '2026-10-13 09:00:00', releasedBy: 'Neil Estur', slip: { s: { empName: 'Lucena, Gerald' }, pr: { label: '2nd Cutoff — September 2026', range: '' } } },
];
cctx.window.__myPayslipRender(mount, list);
ok('rendered and shown', mount.style.display === '' && /class="hx-ticket"/.test(mount.innerHTML));
ok('  A313: only the cutoffs released TODAY are on the ticket (the September one is not)', /1 of 2/.test(mount.innerHTML) && !/September 2026/.test(mount.innerHTML), mount.innerHTML.slice(0, 300));
ok('  the header links to the archive page and offers the PDF', /href="my-payslips.html"/.test(mount.innerHTML) && /data-pdf/.test(mount.innerHTML));
ok('  the mount carries the ticket-style host class', mount._cls.has('hx-payslip-host'));
ok('  the latest cutoff first, with the released footer', /2nd Cutoff — October 2026\|Released 28 Oct 2026, 17:05 by Neil Estur/.test(mount.innerHTML), mount.innerHTML);
ok('  printer bar, LED, stamp and perforated paper chrome', /hx-printer/.test(mount.innerHTML) && /hx-led/.test(mount.innerHTML) && /hx-stamp">Released<small>28 Oct 2026, 17:05/.test(mount.innerHTML));
ok('  the feed starts once, in full', mount._clip._cls.has('feed') && !mount._clip._cls.has('short'));
ok('  earlier/later shown for two cutoffs, Later disabled on the latest', /1 of 2/.test(mount.innerHTML) && (mount._btns || []).some(b => b.step === '-1' && b.disabled) && (mount._btns || []).some(b => b.step === '1' && !b.disabled));
ok('  the stylesheet was injected once', head._kids.length === 1 && head._kids[0].id === 'hxPayslipCss' && head._kids[0].textContent === 'x');
(mount._pdf || []).forEach(fn => fn()); ok('  Download PDF hands the cutoff on screen to the shared renderer', cctx.__pdf && cctx.__pdf.period === '2026-10-B', cctx.__pdf);
const earlier = (mount._btns || []).find(b => b.step === '1'); mount._clip = mkClip(); mount._btns = [];
earlier.fn();
ok('Earlier flips to the previous cutoff with a short feed', /1st Cutoff — October 2026/.test(mount.innerHTML) && /2 of 2/.test(mount.innerHTML) && mount._clip._cls.has('feed') && mount._clip._cls.has('short'), mount.innerHTML.slice(0, 200));
ok('  with Earlier now disabled', (mount._btns || []).some(b => b.step === '1' && b.disabled));
cctx.window.__myPayslipRender(mount, list);
eq('the stylesheet is not injected twice', head._kids.length, 1);
cctx.window.__myPayslipRender(mount, [list[2]]);
eq('a payslip released on another day leaves the home card hidden', mount.style.display, 'none');
const CSS = fs.readFileSync(D + 'css/payslip-card.css', 'utf8');
ok('the ticket sheet animates transform and opacity only', !/@keyframes[^{]*\{[^}]*(width|height|top|left|margin|padding|background|box-shadow)\s*:/.test(CSS.replace(/\n/g, ' ')));
ok('  the paper is white with black ink whatever the theme', /\.hx-ticket \{[^}]*background:#fff; color:#000/.test(CSS));
ok('  A313: the ticket styles are scoped to the host class, not the home card id', /\.hx-payslip-host \.hx-ticket \{/.test(CSS) && !/#myPayslipCard/.test(CSS));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
