/* A301/A307 — every page's local payload is budgeted.
 *
 * Run:  node tests/audit/page-budget.js            fail if any page grew more than 2% over its baseline
 *       node tests/audit/page-budget.js --write    rewrite tests/audit/page-budget.json from the tree
 *
 * A page's payload is its HTML plus every local stylesheet and script it links (css/…, js/…),
 * uncompressed, as the repository holds them. The baseline is refreshed on purpose, in the commit
 * that changes it, with the deltas in the commit message — so a script that quietly doubles shows
 * up here rather than in a user's first paint. Pages that are new since the baseline pass and are
 * reported, so the baseline can be refreshed. */
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
const BASE = path.join(__dirname, 'page-budget.json');
const WRITE = process.argv.includes('--write');
const TOLERANCE = 0.02;

const size = (rel) => { try { return fs.statSync(D + rel).size; } catch (e) { return 0; } };
const pages = fs.readdirSync(D).filter(f => f.endsWith('.html') && !f.startsWith('_')).sort();
const now = {};
for (const p of pages) {
  const html = fs.readFileSync(D + p, 'utf8');
  const css = (html.match(/<link[^>]+href="(css\/[^"]+)"/g) || []).map(t => t.match(/href="([^"]+)"/)[1]);
  const js = (html.match(/<script[^>]+src="(js\/[^"]+)"/g) || []).map(t => t.match(/src="([^"]+)"/)[1]);
  now[p] = size(p) + css.reduce((s, f) => s + size(f), 0) + js.reduce((s, f) => s + size(f), 0);
}
const total = Object.values(now).reduce((s, v) => s + v, 0);

if (WRITE) {
  fs.writeFileSync(BASE, JSON.stringify(now, null, 1) + '\n');
  console.log(`baseline written: ${pages.length} pages, ${(total / 1024).toFixed(0)} KB in total`);
  process.exit(0);
}

let FAIL = 0;
const base = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : {};
const grown = [], fresh = [], shrunk = [];
for (const p of pages) {
  if (!(p in base)) { fresh.push(p); continue; }
  const d = now[p] - base[p];
  if (d > base[p] * TOLERANCE) grown.push(`${p}: ${(base[p] / 1024).toFixed(0)} → ${(now[p] / 1024).toFixed(0)} KB (+${(d / base[p] * 100).toFixed(1)}%)`);
  else if (d < 0) shrunk.push(p);
}
const baseTotal = Object.values(base).reduce((s, v) => s + v, 0);
console.log(`${pages.length} pages, ${(total / 1024).toFixed(0)} KB local payload in total (baseline ${(baseTotal / 1024).toFixed(0)} KB)`);
if (shrunk.length) console.log(`  ${shrunk.length} page(s) lighter than the baseline`);
if (fresh.length) console.log(`  new since the baseline (refresh with --write): ${fresh.join(', ')}`);
if (grown.length) { FAIL = 1; console.log('  FAIL grew more than 2% over the baseline:\n     ' + grown.join('\n     ')); }
else console.log('  ok   no page grew more than 2% over its baseline');
process.exit(FAIL);
