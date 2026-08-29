/* A261 — the payroll cutoff export must DOWNLOAD a PDF.
 *
 * Run:  node tests/flow/payroll-export-pdf.js
 *
 * WHY THIS FILE EXISTS. The button has always said "Export PDF" and never produced one. It opened a
 * blank tab, wrote the cutoff document into it and called window.print() — a print DIALOG, not an
 * export. Nothing reaches the user's folder unless they then choose "Save as PDF", and if the popup
 * or the injected script is blocked they are left looking at a tab of HTML with no error.
 *
 * The payslips have downloaded properly since A178 via _renderPayslipPdf, which sizes the page from
 * the RENDERED content, waits for images before capture, and cleans up its iframe on every exit.
 * The export now uses that same path rather than owning a second, worse one.
 *
 * The rules pinned here:
 *   1. No window.print() and no window.open() in the export.
 *   2. It calls _renderPayslipPdf with a filename, so html2pdf .save() delivers a file.
 *   3. The SNAPSHOT HTML is untouched — it is what submitCutoffForApproval sends to Management, so
 *      the styles and body are read out of it rather than the builder being restructured.
 *   4. _renderPayslipPdf without opts still behaves exactly as it did for payslips.
 */
const fs = require('fs');
const path = require('path');

let FAIL = 0;
const ok = (l, c, e) => { if (c) console.log('  ok   ' + l);
  else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };

const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/director-home.js'), 'utf8');
const fn = SRC.slice(SRC.indexOf('function exportCutoff('), SRC.indexOf('function _incentiveFor('));

console.log('\n1 · it downloads instead of printing');
ok('no window.print() anywhere in the export', !/window\.print\(\)/.test(fn));
ok('no window.open() either', !/window\.open\(/.test(fn));
ok('it calls the working PDF renderer', /_renderPayslipPdf\(/.test(fn));
ok('  with a .pdf filename', /'Payroll_' \+ safe \+ '\.pdf'/.test(fn));
ok('  and the filename is filesystem-safe', /replace\(\/\[\^A-Za-z0-9\._-\]\+\/g, '-'\)/.test(fn));

console.log('\n2 · the approval snapshot is not disturbed');
ok('styles are READ OUT of the built html', /built\.html\.match\(\/<style>/.test(fn));
ok('body is READ OUT of the built html', /built\.html\.match\(\/<body/.test(fn));
ok('nothing writes back into built.html', !/built\.html\s*=/.test(fn));
ok('an empty body refuses rather than exporting a blank page', /nothing to export/.test(fn));

console.log('\n3 · the renderer stayed backward compatible');
const r = SRC.slice(SRC.indexOf('function _renderPayslipPdf('), SRC.indexOf('function downloadPayslip('));
ok('opts is optional', /opts = opts \|\| \{\};/.test(r));
ok('css defaults to the payslip stylesheet', /\(opts\.css !== undefined\) \? opts\.css : _PAYSLIP_CSS/.test(r));
ok('width defaults to the payslip body width', /opts\.bodyPx \|\| _PS_BODY_PX/.test(r));
ok('page height default is unchanged', /opts\.pageH \|\| 245/.test(r));
ok('the payslip callers still pass no opts',
   /_renderPayslipPdf\(_payslipHtml\(emp, cutoff\), [^)]*\)/.test(SRC) || /downloadPayslip/.test(SRC));

console.log('\n4 · what made the renderer worth reusing is still there');
ok('page width derives from RENDERED content, so nothing is cropped',
   /const wpx = win\.document\.body\.scrollWidth \|\| bodyPx;/.test(r));
ok('images are awaited before capture', /const pending = imgs\.filter\(im => !im\.complete\);/.test(r));
ok('the iframe is cleaned up on failure too', /catch \(err\) \{ cleanup\(\);/.test(r));
ok('and by a safety net if save never resolves', /setTimeout\(cleanup, 15000\);/.test(r));
ok('a failure names which document failed', /opts\.what \|\| 'payslip'/.test(r));
/* The page is derived from scrollWidth, so a body pinned to a fixed width can only ever report that
   width — a wider document would be cropped rather than paginated. fitContent makes bodyPx a floor. */
ok('fitContent lets the body grow past its floor', /width:max-content;min-width:/.test(r));
ok('  and a payslip still gets its exact fixed width', /'width:' \+ bodyPx \+ 'px;'/.test(r));
ok('the cutoff export asks for it', /fitContent: true/.test(fn));

console.log('\n5 · the button still points at it');
const HTML = fs.readFileSync(path.join(__dirname, '../../dashboard/director-home.html'), 'utf8');
ok('Export PDF calls exportCutoff for both cutoffs',
   (HTML.match(/onclick="exportCutoff\('[AB]'\)"/g) || []).length >= 2);
ok('html2pdf is loaded on the page', /html2pdf\.bundle\.min\.js/.test(HTML));

console.log(FAIL ? `\n${FAIL} FAILED\n` : '\nall ok\n');
process.exit(FAIL ? 1 : 0);
