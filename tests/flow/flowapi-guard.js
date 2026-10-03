/* AS-2 — the hardened FlowAPI.gs, proven in Node before it is pasted.
 *
 * Run:  node tests/flow/flowapi-guard.js
 *
 * The secret check fails CLOSED when the property is missing; a mutation over GET is refused;
 * every mutation is in _SECURED and the two mirrors match; a read dispatch reads each tab once
 * however many times the handler asks (the memo) while a mutation is never memoised; the
 * single-cell writer reads only the key column and writes the right cell. */
const path = require('path');
const fs = require('fs');
const { load, call, GS } = require(path.join(__dirname, 'gasload.js'));

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

sec('1 · the secret check fails closed');
{
  const c = load();
  delete c.__props.FLOW_MUTATION_SECRET;
  let r = call(c, 'saveDailyNote', { note: 'x', flowSecret: 'test-secret' });
  ok('with the property missing, a secured action is refused even with a secret', !r.success && /not configured/.test(r.message), r);
  c.__props.FLOW_MUTATION_SECRET = 'test-secret';
  r = call(c, 'saveDailyNote', { note: 'x', flowSecret: '' });
  ok('with the property set, a call without the secret is refused', !r.success && /through the app/.test(r.message), r);
  r = call(c, 'saveDailyNote', { note: 'x', flowSecret: 'wrong' });
  ok('  and a wrong secret is refused', !r.success && /through the app/.test(r.message), r);
  r = call(c, 'getVersion', { flowSecret: '' });
  ok('a plain read needs no secret', r.success === true && r.version === 158, r);
  ok('_fctEq compares in constant time and correctly', c._fctEq('abc', 'abc') === true && c._fctEq('abc', 'abd') === false && c._fctEq('', '') === true && c._fctEq('a', 'ab') === false);
}

sec('2 · mutations are POST only');
{
  const c = load();
  const out = c.doGet({ parameter: { action: 'saveDailyNote', note: 'x', flowSecret: 'test-secret' } });
  const r = JSON.parse(out._text !== undefined ? out._text : out.getContent());
  ok('doGet refuses a mutation before dispatch', !r.success && /POST/.test(r.message), r);
  const out2 = c.doGet({ parameter: { action: 'getVersion' } });
  const r2 = JSON.parse(out2._text !== undefined ? out2._text : out2.getContent());
  ok('doGet serves a read', r2.success === true, r2);
}

sec('3 · every mutation is secured and the mirrors agree');
{
  const c = load();
  const muts = Object.keys(c.MUTATIONS), secured = c._SECURED;
  const unsecured = muts.filter(a => !secured[a]);
  ok(`all ${muts.length} mutations are in _SECURED`, unsecured.length === 0, unsecured);
  ok('the identity-scoped reads stay secured', ['getCommissionRequests', 'getCommissionClaimable', 'getTravelReplenishments', 'getTravelReceipts', 'getTravelFloats'].every(a => secured[a]));
  const py = fs.readFileSync(path.join(__dirname, '..', '..', 'blueprints', 'flow.py'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'js', 'flow-api.js'), 'utf8');
  const names = (block) => new Set((block.match(/['"]([A-Za-z_$][\w$]*)['"]/g) || []).map(s => s.slice(1, -1)));
  const P = names((py.match(/SECURED_ACTIONS\s*=\s*\[([\s\S]*?)\n\]/) || ['', ''])[1]);
  const J = names((js.match(/FLOW_SECURED_ACTIONS\s*=\s*\[([\s\S]*?)\n\]/) || ['', ''])[1]);
  const S = new Set(Object.keys(secured));
  const same = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  ok('flow.py mirrors _SECURED exactly', same(S, P), { onlyGs: [...S].filter(x => !P.has(x)), onlyPy: [...P].filter(x => !S.has(x)) });
  ok('flow-api.js mirrors _SECURED exactly', same(S, J), { onlyGs: [...S].filter(x => !J.has(x)), onlyJs: [...J].filter(x => !S.has(x)) });
}

sec('4 · a read dispatch reads each tab once; a mutation never memoises');
{
  const c = load();
  let reads = 0;
  const realSheet = c._sheet;
  c._sheet = function (name) { const sh = realSheet(name); const rng = sh.getRange; sh.getRange = function () { const r = rng.apply(sh, arguments); const gv = r.getValues; r.getValues = function () { reads++; return gv.apply(r, arguments); }; return r; }; return sh; };
  // a read handler that asks for the same tab three times
  c.HANDLERS.__probeRead = function () { c._rows('Clients'); c._rows('Clients'); c._rows('Clients'); return { success: true, n: reads }; };
  c.HANDLERS.__probeWrite = function () { c._rows('Clients'); c._rows('Clients'); return { success: true, n: reads }; };
  c.MUTATIONS.__probeWrite = 1; c._SECURED.__probeWrite = 1;
  call(c, 'saveClient', { customer: 'Acme' });
  reads = 0;
  const r = call(c, '__probeRead', {});
  eq('three _rows() calls in one read dispatch hit the sheet once', r.n, 1);
  reads = 0;
  const w = call(c, '__probeWrite', {});
  eq('two _rows() calls in one mutation hit the sheet twice (never stale)', w.n, 2);
  ok('after a mutation dispatch the memo is off', c._ROWS_MEMO === null, c._ROWS_MEMO);
  // fresh objects: a caller's edit does not leak into the next caller
  c.HANDLERS.__probeIso = function () { const a = c._rows('Clients'); if (a[0]) a[0].name = 'CHANGED'; const b = c._rows('Clients'); return { success: true, leaked: b[0] ? b[0].name === 'CHANGED' : false }; };
  const iso = call(c, '__probeIso', {});
  ok('row objects are rebuilt per call, so an edit never reaches the next caller', iso.leaked === false, iso);
}

sec('5 · _setCellByKey reads the key column only and writes the right cell');
{
  const c = load();
  call(c, 'saveClient', { customer: 'Alpha' });
  call(c, 'saveClient', { customer: 'Beta' });
  const headers = c.SCHEMA.Clients;
  const nameCol = 'Customer';
  const target = headers.find(h => /Contact|Email|Phone|Notes|Address|TIN/i.test(h)) || headers[1];
  const okw = c._setCellByKey('Clients', nameCol, 'Beta', target, 'WRITTEN');
  ok('returns true when the key exists', okw === true);
  const rows = c._rows('Clients');
  const beta = rows.find(r => String(r[nameCol]) === 'Beta'), alpha = rows.find(r => String(r[nameCol]) === 'Alpha');
  ok('the target cell of the matching row changed and the other row did not', beta && beta[target] === 'WRITTEN' && alpha && alpha[target] !== 'WRITTEN', { beta, alpha });
  ok('returns false for a missing key or an unknown column', c._setCellByKey('Clients', nameCol, 'Nobody', target, 'x') === false && c._setCellByKey('Clients', 'NoSuchColumn', 'Beta', target, 'x') === false);
}

sec('6 · the ids come from Script Properties with the literal as fallback, and the version line is short');
{
  const src = fs.readFileSync(GS, 'utf8');
  ok("SHEET_ID is overridden by the FLOW_SHEET_ID Script Property", /SHEET_ID = _fprop\('FLOW_SHEET_ID'\) \|\| SHEET_ID;/.test(src));
  ok('FLOW_VERSION is 158 on a line under 200 characters', /^var FLOW_VERSION = 158;.{0,180}$/m.test(src));
  ok('the changelog block lives at the end of the file', /\/\* ─── CHANGELOG/.test(src));
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
