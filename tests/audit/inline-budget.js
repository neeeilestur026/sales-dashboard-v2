/* A305 — inline <style> and <script> only ever shrink.
 *
 * Run:  node tests/audit/inline-budget.js            fail if any page's inline style bytes or inline
 *                                                    script lines grew over the baseline
 *       node tests/audit/inline-budget.js --write    rewrite tests/audit/inline-budget.json
 *
 * Inline blocks are not cached between pages and cannot be shared; every page that still carries
 * them is listed in the baseline with its current size, and a commit may only lower a number
 * (refreshing the baseline in the same commit). A page with none of either stays at zero. */
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
const BASE = path.join(__dirname, 'inline-budget.json');
const WRITE = process.argv.includes('--write');

const pages = fs.readdirSync(D).filter(f => f.endsWith('.html') && !f.startsWith('_')).sort();
const now = {};
for (const p of pages) {
  const html = fs.readFileSync(D + p, 'utf8');
  const styleBytes = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).reduce((s, b) => s + b.length, 0);
  const scriptLines = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).reduce((s, b) => s + b.split('\n').length - 1, 0);
  now[p] = { styleBytes, scriptLines };
}
const totals = (m) => Object.values(m).reduce((t, v) => ({ styleBytes: t.styleBytes + v.styleBytes, scriptLines: t.scriptLines + v.scriptLines }), { styleBytes: 0, scriptLines: 0 });

if (WRITE) {
  fs.writeFileSync(BASE, JSON.stringify(now, null, 1) + '\n');
  const t = totals(now);
  console.log(`baseline written: ${pages.length} pages, ${(t.styleBytes / 1024).toFixed(0)} KB inline style, ${t.scriptLines} inline script lines`);
  process.exit(0);
}
let FAIL = 0;
const base = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : {};
const grown = [];
for (const p of pages) {
  const b = base[p] || { styleBytes: 0, scriptLines: 0 };
  if (now[p].styleBytes > b.styleBytes) grown.push(`${p}: inline style ${b.styleBytes} → ${now[p].styleBytes} bytes`);
  if (now[p].scriptLines > b.scriptLines) grown.push(`${p}: inline script ${b.scriptLines} → ${now[p].scriptLines} lines`);
}
const t = totals(now), tb = totals(base);
console.log(`${pages.length} pages: ${(t.styleBytes / 1024).toFixed(0)} KB inline style (baseline ${(tb.styleBytes / 1024).toFixed(0)} KB), ${t.scriptLines} inline script lines (baseline ${tb.scriptLines})`);
if (grown.length) { FAIL = 1; console.log('  FAIL inline blocks grew:\n     ' + grown.join('\n     ')); }
else console.log('  ok   no page carries more inline style or script than its baseline');
process.exit(FAIL);
