/* A285 — the director dashboard's CONTRACT: what the redesigned markup must keep, and what it must
 * never carry again.
 *
 * Run:  node tests/flow/director-home-contract.js
 *
 * The redesign rebuilt director-home.html from scratch. director-home.js and four shared scripts
 * reach into it by id — switchPayTab toggles fourteen of them with no null guard, loadPeriod reads
 * the month select's option TEXT, the submit buttons have their textContent overwritten — so the
 * cheapest way for a rebuild to break payroll is to rename or retype one element. Section 1 pins
 * every id with the tag it must have. Section 2 boots the real director-home.js against the real
 * HTML through the pageload harness and switches every tab. Section 3 pins the things the redesign
 * removed on purpose (inline styles, emoji, the old card classes) so they do not creep back, and
 * lints the motion layer's keyframes. Section 4 runs the page's own inline script under reduced
 * motion and checks the counter degrades to a synchronous write.
 */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want),
  (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'director-home.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/director-home.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/director-home.js', 'utf8');

/** The tag an id sits on, or null when the id is absent. */
const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };

/* ── 1 · every id the JS reaches for, with the tag it expects ────────────────────────────────── */
sec('1 · the id contract');
ok('head links styles.css, flow.css, then director-home.css — in that order',
   /styles\.css[\s\S]*flow\.css[\s\S]*director-home\.css/.test(HTML));
ok('  and no shared skin', !/bento-skin|flow-screen/.test(HTML));
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('  and the new CSS imports no font (styles.css already does)', !/fonts\.googleapis/.test(CSS));
ok('<body class="dh"> — the scope every rule hangs off', /<body class="dh">/.test(HTML));

const TAGS = {
  select: ['payMonth', 'thirteenthYear', 'eeStatus', 'eePayType', 'incCategory'],
  input:  ['payYear', 'employerShareA', 'employerShareB', 'eeEditId', 'eeLastName', 'eeFirstName', 'eeDailyRate',
           'eeOtherIncome', 'eeHdmf', 'eeFixedAmount', 'eeEffectiveDate', 'eeReason', 'incAmount', 'incReason'],
  tbody:  ['eeBody', 'thirteenthBody'],
  tfoot:  ['thirteenthFoot'],
  button: ['dirApprRefresh', 'incSaveBtn', 'submitApprovalABtn', 'submitApprovalBBtn'],
  div:    ['sdBody', 'sdModal', 'hoursAGrid', 'hoursBGrid', 'payAGrid', 'payBGrid', 'rhBody', 'ihBody', 'eeFixedRow',
           'eeDailyRow', 'eePayChange', 'flowActionCenter', 'dirApprovals', 'qtwPanel', 'iwpPanel'],
  section: ['myDeductionCard', 'flowApprovalStrip', 'inbox', 'spot'],
  h3:     ['hoursATitle', 'hoursBTitle', 'eeModalTitle', 'rhTitle', 'ihTitle', 'incAddTitle'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
['navbar', 'greeting', 'hbDay', 'hbMon', 'periodLabel', 'inboxCount', 'spotTotal', 'spotGross', 'spotDed', 'spotTag',
 'kpiActive', 'kpiNet', 'kpiShare', 'kpi13', 'eePayChangeMsg', 'incAddPeriod', 'incAddMsg', 'rateChangesBox', 'incentivesBox',
 'saveHoursAMsg', 'saveHoursBMsg', 'savePayAMsg', 'savePayBMsg'].forEach(id => ok('#' + id + ' exists', !!tagOf(id)));

sec('1b · the seven tabs and their panels');
const KEYS = { ee: 'EE', hoursA: 'HoursA', payA: 'PayA', hoursB: 'HoursB', payB: 'PayB', thirteenth: 'Thirteenth', deductions: 'Deductions' };
Object.keys(KEYS).forEach(k => {
  const tab = HTML.match(new RegExp('<button[^>]*id="tab' + KEYS[k] + '"[^>]*>')) || HTML.match(new RegExp('<button[^>]*onclick="switchPayTab\\(\'' + k + '\'\\)"[^>]*id="tab' + KEYS[k] + '"'));
  ok('#tab' + KEYS[k] + ' calls switchPayTab(\'' + k + '\')', !!tab && tab[0].indexOf("switchPayTab('" + k + "')") !== -1, tab && tab[0]);
  const panel = HTML.match(new RegExp('<section[^>]*id="panel' + KEYS[k] + '"[^>]*>'));
  ok('#panel' + KEYS[k] + ' is a .dh-panel', !!panel && /\bdh-panel\b/.test(panel[0]), panel && panel[0]);
});
ok('#panelEE is the one born active', /<section[^>]*\bactive\b[^>]*id="panelEE"|<section[^>]*id="panelEE"[^>]*\bactive\b/.test(HTML));
ok('  and it is the only one', (HTML.match(/<section[^>]*id="panel\w+"[^>]*\bactive\b/g) || []).length + (HTML.match(/<section[^>]*\bactive\b[^>]*id="panel\w+"/g) || []).length === 1);
ok('#payMonth has all twelve months (loadPeriod reads the option text)', (HTML.match(/<option value="\d\d">/g) || []).length === 12);
ok('#thirteenthYear reloads on change', /id="thirteenthYear"[^>]*onchange="load13thMonth\(\)"|onchange="load13thMonth\(\)"[^>]*id="thirteenthYear"/.test(HTML));

sec('1c · the details a rebuild gets wrong');
ok('#incSaveBtn is btn-sm primary (was btn-sm btn-primary, which styles.css painted teal)',
   /<button[^>]*class="btn-sm primary"[^>]*id="incSaveBtn"/.test(HTML));
ok('#incCategory still offers Performance Bonus', /<option>Performance Bonus<\/option>/.test(HTML));
ok('#eeStatus has value="Active"', /<option value="Active">/.test(HTML));
['submitApprovalABtn', 'submitApprovalBBtn'].forEach(id => {
  const m = HTML.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>([^<]*)<\\/button>'));
  ok('#' + id + ' is text-only (its textContent is overwritten while saving)', !!m && m[1].trim() === 'Submit for Approval', m && m[0]);
});
ok('Export PDF still calls exportCutoff for both cutoffs (payroll-export-pdf.js pins this too)',
   (HTML.match(/onclick="exportCutoff\('[AB]'\)"/g) || []).length >= 2);
ok('html2pdf is still loaded', /html2pdf\.bundle\.min\.js/.test(HTML));
ok('the scripts load in the same order as before',
   /js\/api\.js[\s\S]*salary-deduction-card\.js[\s\S]*js\/auth\.js[\s\S]*flow-api\.js[\s\S]*flow-docs\.js[\s\S]*quotation-worklist\.js[\s\S]*quotation-team-worklist\.js[\s\S]*director-home\.js[\s\S]*itinerary-week\.js[\s\S]*itinerary-week-panel\.js[\s\S]*director-approvals\.js/.test(HTML));

/* ── 2 · boot the real page script against the real markup ──────────────────────────────────── */
sec('2 · director-home.js boots on the new markup and every tab switches');
(async () => {
  const p = page(['js/director-home.js'], 'director-home.html', { role: 'director', name: 'Test Director', username: 'td' });
  // Every backend name the page calls, stubbed to an empty success. Read from the source so a new
  // call site cannot boot against a missing stub and fail for the wrong reason.
  const apis = Array.from(new Set(JS.match(/\bapi[A-Z]\w+/g)));
  p.run(apis.map(a => `${a} = async () => ({ success: true, data: [] });`).join('') +
        `fetchFromAPI = async () => ({ success: true, data: [] }); getGreeting = n => 'Hi ' + n;`);
  // loadPeriod reads the month select's option text; the stub DOM has no options until told.
  p.els.payMonth.options = [{ text: 'September' }]; p.els.payMonth.selectedIndex = 0;
  let booted = true;
  try { await p.boot(); } catch (e) { booted = false; ok('boot threw', false, String(e && e.stack || e)); }
  ok('the page booted', booted);
  const threw = (fn) => { try { fn(); return null; } catch (e) { return String(e); } };
  Object.keys(KEYS).forEach(k => { const err = threw(() => p.run(`switchPayTab('${k}')`)); ok("switchPayTab('" + k + "')", err === null, err); });
  ok('_updateKpis exists', p.run('typeof _updateKpis') === 'function');
  ok('  and dhSetNumber does NOT (it lives in the page, not the script — the script must degrade)', p.run('typeof dhSetNumber') === 'undefined');

  // THE BUG THIS REPLACES: the old inline mirror read Status out of column 7, which is HDMF.
  p.run(`_employees = [{ status: 'Active', lastName: 'A', firstName: 'a' }, { status: 'Active', lastName: 'B', firstName: 'b' }, { status: 'Inactive', lastName: 'C', firstName: 'c' }]; renderEETable();`);
  eq('Active employees comes from the data, not a scraped column', p.els.kpiActive.textContent, '2');
  p.run(`_thirteenthData = [{ thirteenthMonth: 1000, totalBasicPay: 12000, status: 'Active', lastName: 'A', firstName: 'a', monthsWorked: 12, periodsCount: 24 }]; _thirteenthYear = 2026; render13thMonth();`);
  ok('the 13th-month accrual reaches its KPI', /1,000\.00/.test(p.els.kpi13.textContent), p.els.kpi13.textContent);
  ok('  and the footer is a .total-row now', /class="total-row"/.test(p.els.thirteenthFoot.innerHTML));

  /* ── 4 · the page's own inline script, under reduced motion ────────────────────────────────── */
  sec('4 · the inline script degrades: reduced motion means a synchronous write');
  const inline = (HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
  ok('the page has exactly one inline <script>', (HTML.match(/<script>/g) || []).length === 1 && !!inline);
  p.run(`matchMedia = () => ({ matches: true }); document.body.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };`);
  const err4 = threw(() => p.run(inline));
  ok('it runs in the stub DOM without throwing', err4 === null, err4);
  ok('dhSetNumber is now defined', p.run('typeof dhSetNumber') === 'function');
  p.run(`dhSetNumber(document.getElementById('kpiNet'), '₱1,234.00')`);
  eq('  under reduced motion it writes the final text at once', p.els.kpiNet.textContent, '₱1,234.00');
  p.run(`renderEETable();`);
  eq('  and _updateKpis routes through it', p.els.kpiActive.textContent, '2');

  console.log('\n' + (FAIL ? FAIL + ' FAILURE(S) of ' + N : 'all ok (' + N + ')'));
  process.exit(FAIL ? 1 : 0);
})();

/* ── 3 · what the redesign removed must stay removed; the motion layer lints clean ───────────── */
sec('3 · no regressions to the old look');
const styles = HTML.match(/style="[^"]*"/g) || [];
ok('every style= in the markup is display:none (state, never styling) — ' + styles.length + ' found',
   styles.length > 0 && styles.every(s => s === 'style="display:none;"'), styles.filter(s => s !== 'style="display:none;"'));
['chart-card', 'pay-card', 'pay-spot', 'pay-headband', 'pay-tabs', 'form-row', 'form-group', 'ee-overlay', 'sd-overlay', 'ee-modal']
  .forEach(c => ok('no .' + c, !new RegExp('\\b' + c + '\\b').test(HTML)));
ok('no emoji anywhere in the page', !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(HTML));
ok('the old DOM-scraping KPI mirror is gone', !/payrollKpiMirror|tds\[7\]|sumCells/.test(HTML));

sec('3b · the stylesheet');
ok('.dh-panel hides and .dh-panel.active shows', /\.dh-panel\s*\{\s*display:\s*none/.test(CSS) && /\.dh-panel\.active\s*\{\s*display:\s*block/.test(CSS));
ok('prefers-reduced-motion block present', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(CSS));
ok('#flowDocsModal sits above the deduction modal', /#flowDocsModal\s*\{\s*z-index:\s*1200/.test(CSS));
{
  const noComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  const re = /(?:^|[{}])\s*([^{}@]+?)\s*\{/g; let m;
  while ((m = re.exec(noComments))) {
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(sel => {
      if (/^(from|to|\d+%)$/.test(sel)) return;                 // keyframe steps
      if (!/^body\.dh\b/.test(sel)) bad.push(sel);
    });
  }
  ok('every selector starts with body.dh (' + (bad.length ? bad.length + ' do not' : 'all of them') + ')', bad.length === 0, bad.slice(0, 8));
}
{
  const names = ['dhIn', 'dhPanelIn', 'dhPop', 'dhGlow', 'dhDrift', 'dhSheen', 'dhFill', 'dhShimmer', 'dhFade'];
  names.forEach(n => ok('@keyframes ' + n, new RegExp('@keyframes\\s+' + n + '\\s*\\{').test(CSS)));
  const blocks = CSS.match(/@keyframes\s+\w+\s*\{[\s\S]*?\}\s*\}/g) || [];
  const layout = blocks.filter(b => /\b(width|height|top|left|margin|padding)\s*:/.test(b)).map(b => b.match(/@keyframes\s+(\w+)/)[1]);
  ok('no keyframe animates a layout property (transform/opacity only)', layout.length === 0, layout);
}
ok('the inline script checks prefers-reduced-motion', /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(HTML));
ok('  and director-home.js calls dhSetNumber when it exists', /typeof dhSetNumber === 'function'/.test(JS));
ok('director-home.js no longer paints teal', !/#0f766e/.test(JS.replace(/_PAYSLIP_CSS[\s\S]*?`;/, '')));
