/* A311 — every browser fetch to a Flask route carries the session token.
 *
 * Run:  node tests/audit/flask-fetch-headers.js
 *
 * A299 gated every Flask data route behind require_session, and flask-routes.py proves the SERVER
 * side. This proves the CLIENT side: a fetch() aimed at a Flask route (a '/flow/…', '/billing/…',
 * '/api/…' literal, or the `route` / `url` argument of a PDF helper) must build its headers with
 * hxAuthHeaders(...) or name X-Session-Token within the call. generateFlowPdf in flow-api.js was the
 * one that did not, and Generate & Save on a purchase request answered 401 on Render.
 *
 * The Apps Script GET in api.js (fetch(url …) to script.google.com) is not a Flask route and is
 * listed as the one allowed exception. */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'dashboard', 'js');
const ALLOWED = new Set(['api.js:fetchFromAPI']);   // the Apps Script GET, identified by its enclosing function
const FLASK = /fetch\(\s*(['"`])\/(flow|api|billing|po|pr|mro|mi|quotation|payment-request)\//;
const HELPER = /fetch\((route|url),\s*\{/;          // generateFlowPdf / fetchPdf take the route as an argument

let FAIL = 0, seen = 0;
const missing = [];
for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.js')).sort()) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (!FLASK.test(l) && !HELPER.test(l)) return;
    // the enclosing function name, for the allow-list
    let fn = '';
    for (let j = i; j >= 0 && !fn; j--) { const m = lines[j].match(/function\s+([A-Za-z_$][\w$]*)\s*\(/); if (m) fn = m[1]; }
    if (ALLOWED.has(f + ':' + fn)) return;
    seen++;
    const win = lines.slice(i, i + 9).join('\n');
    if (!/hxAuthHeaders\(|X-Session-Token/.test(win)) missing.push(`${f}:${i + 1}  ${l.trim().slice(0, 80)}`);
  });
}
console.log(`${seen} Flask fetch sites checked`);
if (missing.length) { FAIL = 1; console.log('  FAIL fetch to a Flask route without the session header:\n     ' + missing.join('\n     ')); }
else console.log('  ok   every one sends the session token');
process.exit(FAIL);
