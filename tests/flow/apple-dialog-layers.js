/* A414 — no dialog is drawn under the Apple sidebar.
 *
 * Run:  node tests/flow/apple-dialog-layers.js
 *
 * The Apple look's sidebar sits at z-index 1010 (css/apple.css). A347 lifted the standard dialogs
 * (.modal-overlay, .flow-modal-overlay, .dh-overlay) to 1020, but page-own dialogs kept their 1000 and
 * were drawn UNDER it — management's payroll approval view showed the sidebar over the payroll PDF
 * (Neil, 27 Nov 2026). This scans every stylesheet, page and script for a full-screen fixed layer
 * (an overlay / modal / sheet / scrim covering the window) below 1020, and requires apple.css to lift
 * it to 1020, unless it is one of the skin's own layers.
 */
const fs = require('fs');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };

const D = path.join(__dirname, '../../dashboard/');
const APPLE = fs.readFileSync(D + 'css/apple.css', 'utf8');
const SIDEBAR_Z = +(APPLE.match(/position:\s*fixed;\s*top:\s*0;\s*left:\s*0;\s*bottom:\s*0;\s*z-index:\s*(\d+)/) || [])[1];
ok('the Apple sidebar layer is found (1010)', SIDEBAR_Z === 1010, SIDEBAR_Z);

/* The skin's own layers manage themselves (the drawer scrim must sit BELOW the sidebar it dims for). */
const OWN = new Set(['a-scrim', 'ap-scrim']);

const files = [].concat(
  fs.readdirSync(D + 'css').filter(f => f.endsWith('.css')).map(f => 'css/' + f),
  fs.readdirSync(D).filter(f => f.endsWith('.html')),
  fs.readdirSync(D + 'js').filter(f => f.endsWith('.js')).map(f => 'js/' + f));
const low = [];
files.forEach(f => {
  const s = fs.readFileSync(D + f, 'utf8');
  const re = /([^{};\n`]*?)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(s))) {
    const sel = m[1].trim(), body = m[2];
    if (!/position\s*:\s*fixed/.test(body)) continue;
    const z = +((body.match(/z-index\s*:\s*(\d+)/) || [])[1] || 0);
    if (!(z >= 100 && z < 1020)) continue;
    if (!/(overlay|modal|scrim|sheet|backdrop|lightbox|viewer|dialog|popup|drawer)/i.test(sel)) continue;
    if (!/inset\s*:\s*0|width\s*:\s*100vw/.test(body)) continue;            // full-window layers only
    const cls = (sel.match(/\.([A-Za-z0-9_-]+)\s*$/) || [])[1];
    if (!cls || OWN.has(cls)) continue;
    low.push({ file: f, sel, z, cls });
  }
});
ok('the scan finds the page-own dialogs (sanity)', low.some(x => x.cls === 'payappr-modal-overlay'), low.map(x => x.cls));
const lifted = (cls) => new RegExp('html\\[data-skin="ledger"\\]\\[data-look="apple"\\] \\.' + cls + '\\b[^{]*\\{[^}]*z-index:\\s*1020').test(APPLE)
  || new RegExp('html\\[data-skin="ledger"\\]\\[data-look="apple"\\] \\.' + cls + '\\s*,[^{]*\\{\\s*z-index:\\s*1020').test(APPLE);
low.forEach(x => ok('  ' + x.cls + ' (' + x.file + ', z ' + x.z + ') is lifted above the sidebar', lifted(x.cls)));
ok('the payroll approval view is lifted (the reported case)', lifted('payappr-modal-overlay'));

console.log('\n' + (FAIL ? FAIL + ' FAILED' : 'all ' + N + ' passed'));
process.exit(FAIL ? 1 : 0);
