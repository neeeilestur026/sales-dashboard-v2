/* A302 — one copy of each shared helper.
 *
 * Run:  node tests/flow/no-duplicates.js
 *
 * The escape body, the section toggle, the shipment badge map, the token reader and the date pill
 * each live once, in js/api.js (flow-api.js keeps flowEsc/flowNum because it must run without
 * api.js). A page script may keep its old name as a one-line delegation; what it may not do is
 * carry the body again. The inline scripts of every page are scanned too. */
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };

const js = fs.readdirSync(D + 'js').filter(f => f.endsWith('.js')).sort();
const src = Object.fromEntries(js.map(f => [f, fs.readFileSync(D + 'js/' + f, 'utf8')]));
const pages = fs.readdirSync(D).filter(f => f.endsWith('.html') && !f.startsWith('_')).sort();
const inline = Object.fromEntries(pages.map(p => [p, (fs.readFileSync(D + p, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || []).join('\n')]));

const API = src['api.js'];
ok('api.js carries the hx-util block with its two markers', /\/\* ─── hx-util \(A302\)/.test(API) && /\/\* ─── end hx-util/.test(API));
['hxEsc', 'hxEscBlank', 'hxNum', 'hxToken', 'hxDebounce', 'hxRaf', 'hxDatePill', 'toggleForm', 'hxSmBadge'].forEach(n =>
  ok('  defines ' + n, new RegExp('^function ' + n + '\\(', 'm').test(API)));

const BODY = /\.replace\(\/&\/g/;
const ALLOWED_BODY = new Set(['api.js', 'flow-api.js']);
const bodies = js.filter(f => !ALLOWED_BODY.has(f) && BODY.test(src[f]));
ok('the HTML-escape body appears only in api.js and flow-api.js', bodies.length === 0, bodies);
const inlineBodies = pages.filter(p => BODY.test(inline[p]));
ok('  and in no inline page script', inlineBodies.length === 0, inlineBodies);

const OVERRIDES = new Set(['sales-orders-inline.js', 'supplier-quotation-inline.js']);   // A305: their richer form toggle, moved out with the page script
const toggles = js.filter(f => f !== 'api.js' && !OVERRIDES.has(f) && /^function toggleForm\(/m.test(src[f]));
ok('toggleForm is defined once, in api.js (two page scripts override it on purpose)', toggles.length === 0, toggles);
ok('  exactly those two: sales-orders-inline.js and supplier-quotation-inline.js', [...OVERRIDES].every(f => /function toggleForm\(/.test(src[f] || '')));
const inlineToggles = pages.filter(p => /function toggleForm\(/.test(inline[p]));
ok('  and no inline page script defines one', inlineToggles.length === 0, inlineToggles);

const badgeMaps = js.filter(f => f !== 'api.js' && /'awaiting confirmation': 'sbadge-awaiting'/.test(src[f]));
ok('the shipment badge map lives once', badgeMaps.length === 0, badgeMaps);
ok('  _acctSmBadge, _mgmtSmBadge and _smBadge delegate to it', /function _acctSmBadge\(status\) \{ return hxSmBadge\(status\); \}/.test(src['accounting-home.js']) && /function _mgmtSmBadge\(status\) \{ return hxSmBadge\(status\); \}/.test(src['management-home.js']) && /function _smBadge\(status\) \{ return hxSmBadge\(status\); \}/.test(src['admin.js']));

const readers = js.filter(f => f !== 'api.js' && f !== 'director-pulse.js' && /getComputedStyle\(document\.documentElement\)\.getPropertyValue/.test(src[f]));
ok('the token reader body lives once (director-pulse reads body tokens, which is a different thing)', readers.length === 0, readers);

const pills = js.filter(f => f !== 'api.js' && /getElementById\('hbMon'\)/.test(src[f]) && /weekday: 'short'/.test(src[f]));
ok('the rail date pill (hbDay/hbMon) lives once (sales-home and team-performance use their own ids)', pills.length === 0, pills);
const inlinePills = pages.filter(p => /Header date pill/.test(inline[p]) && !/hxDatePill\('long'\)/.test(inline[p]));
ok('  every inline header pill calls hxDatePill', inlinePills.length === 0, inlinePills);

const PURE_MODULES = new Set(['client-rollup.js', 'payment-register.js']);   // require()d by tests under Node: no api.js there
const numBodies = js.filter(f => !ALLOWED_BODY.has(f) && !PURE_MODULES.has(f) && /const n = parseFloat\(v\); return isNaN\(n\) \? 0 : n;/.test(src[f]));
ok('the number parser body lives once outside flow-api and the two pure modules', numBodies.length === 0, numBodies);

ok('requirePricingFlowAccess delegates to requireQuotationAccess', /function requirePricingFlowAccess\(\) \{ return requireQuotationAccess\(\); \}/.test(src['auth.js']));

/* the helpers themselves, in a bare context */
const vm = require('vm');
const ctx = { document: { getElementById: () => null }, getComputedStyle: undefined };
vm.createContext(ctx);
vm.runInContext(API.slice(API.indexOf('/* ─── hx-util (A302)'), API.indexOf('/* ─── end hx-util')), ctx);
const r = (code) => vm.runInContext(code, ctx);
ok('hxEsc escapes the five characters and keeps 0', r(`hxEsc('<a href="x">&\\'</a>')`) === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;' && r('hxEsc(0)') === '0' && r('hxEsc(null)') === '' && r('hxEsc(undefined)') === '');
ok('hxEscBlank keeps the old String(v || \'\') behaviour: 0 and false render blank', r('hxEscBlank(0)') === '' && r('hxEscBlank(false)') === '' && r("hxEscBlank('<b>')") === '&lt;b&gt;');
ok('hxNum', r("hxNum('1,5')") === 1 && r("hxNum('abc')") === 0 && r("hxNum('2.5')") === 2.5 && r('hxNum(null)') === 0);
ok('hxToken falls back when no computed style is available', r("hxToken('--hx-navy', '#2E3192')") === '#2E3192' && r("hxToken('--x')") === '');
ok('hxSmBadge classes and escaping', r("hxSmBadge('In Transit')") === '<span class="sbadge sbadge-intransit">In Transit</span>' && r("hxSmBadge('')") === '<span class="sbadge sbadge-default">—</span>' && r("hxSmBadge('<x>')") === '<span class="sbadge sbadge-default">&lt;x&gt;</span>');

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
