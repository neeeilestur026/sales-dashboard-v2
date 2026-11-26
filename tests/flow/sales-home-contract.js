/* A290 — the sales home's CONTRACT: what the rebuilt dashboard.html must keep, and what it must
 * never carry again.
 *
 * Run:  node tests/flow/sales-home-contract.js
 *
 * dashboard.js reaches into the page by id with no null guards on the first five (greeting,
 * prToday, quotationToday, monthQuotations, monthPRs), leads-for-you.js and
 * salary-deduction-card.js mount by id and hide themselves with display, training-mode.js points
 * its callouts at four selectors, and sales-home-page.js derives the ring, the tag, the rail and
 * the quiet card from what those wrote. Section 1 pins the shell, 2 every id with its tag and
 * the hidden ones, 3 what the redesign removed on purpose (the five mirror slots and their
 * observer, inline styles, emoji, the bento classes, colour in the scripts), 4 the stylesheet's
 * scope and motion layer, 5 the page script under a DOM with no observers, and 6 boots
 * dashboard.js against the real markup and checks what it writes.
 * A407 (Neil, 25 Nov 2026, "two of everything"): the home no longer links the retired pages (the old daily report,
 * the client tracker, Pending items, the Quotation summary, the weekly itinerary), and the overdue follow-ups card and
 * the pending-items count are gone — both read the per-rep sheets nothing writes any more; the follow-up guide card is
 * the one follow-up list. The report tag follows the daily report on my-daily-report.html (new-daily-report-card.js). */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'dashboard.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/sales-home.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/dashboard.js', 'utf8');
const PJS  = fs.readFileSync(D + 'js/sales-home-page.js', 'utf8');
const LJS  = fs.readFileSync(D + 'js/leads-for-you.js', 'utf8');
const TM   = fs.readFileSync(D + 'js/training-mode.js', 'utf8');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/;
const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
const tagAttrs = (id) => { const m = HTML.match(new RegExp('<\\w+[^>]*\\sid="' + id + '"[^>]*>')); return m ? m[0] : ''; };

/* ── 1 · the shell ────────────────────────────────────────────────────────────────────────────── */
sec('1 · the shell');
ok('head links styles.css, training-mode.css, payslip-card.css, new-daily-report-card.css (A363), follow-up-guide.css (A393), sales-plan.css (A403), sales-home.css, then ledger.css (A336) and apple.css (A344), in that order and nothing else',
   (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(',') === 'styles.css,training-mode.css,payslip-card.css,new-daily-report-card.css,follow-up-guide.css,sales-plan.css,sales-home.css,ledger.css,apple.css');
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('<body class="sl"> — the scope every rule hangs off', /<body class="sl">/.test(HTML));
ok('js/theme.js is the first child of <body>', /<body class="sl">\s*<script src="js\/theme\.js"><\/script>/.test(HTML));
eq('script order', (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','),
   'theme.js,api.js,salary-deduction-card.js,payslip.js,my-payslip-card.js,new-daily-report-card.js,flow-api.js,leads-for-you.js,client-book-model.js,my-clients-card.js,shutdown-calendar-model.js,shutdowns-card.js,follow-up-guide-model.js,follow-up-guide-card.js,sales-plan-model.js,sales-plan-card.js,auth.js,ledger-nav.js,dashboard.js,training-mode.js,sales-home-page.js');   // A391 — Coming shutdowns · A403 — Sales target
eq('zero inline <script>', (HTML.match(/<script>/g) || []).length, 0);
ok('the deck: a sticky rail with the slab and the nav, then the column', /<aside class="hx-rail" id="rail">/.test(HTML) && /<section class="hx-slab" id="spot">/.test(HTML) && /<nav class="hx-rail-nav"/.test(HTML) && /<div class="hx-col">/.test(HTML));
ok('the theme toggle is the shared class (js/theme.js wires it by delegation)', /class="theme-toggle" id="themeToggle" aria-pressed="false"/.test(HTML));

/* ── 2 · every id the scripts reach for, with the tag it expects ──────────────────────────────── */
sec('2 · the id contract');
const TAGS = {
  h1: ['greeting'],
  p: ['todayLabel', 'quietMsg'],
  b: ['dateDay'],
  span: ['dateMon', 'reportPill', 'reportStatus', 'targetDonutNote', 'inboxCount'],
  dd: ['monthPRs', 'quotationToday', 'prToday', 'clientCount'],
  div: ['monthQuotations', 'flowActionCenter', 'targetBars'],
  section: ['spot', 'inbox', 'followUpGuide', 'leadsForYou', 'myClients', 'comingShutdowns', 'myDeductionCard', 'newDailyReport', 'myPayslipCard', 'today', 'targetSection', 'quietState'],
  circle: ['targetDonutRing'],
  text: ['targetDonutPct'],
  a: ['prLink', 'quotationLink', 'navTargets', 'navLeads'],
  button: ['themeToggle'],
  header: ['navbar'],
  aside: ['rail'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
// every id dashboard.js touches exists in the page
const REACHED = Array.from(new Set(JS.match(/getElementById\('([^']+)'\)/g).map(s => s.match(/'([^']+)'/)[1]))).concat(['prLink']);
REACHED.forEach(id => ok('dashboard.js reaches #' + id + ' and it exists', !!tagOf(id)));
ok('#leadsForYou, #myDeductionCard, #targetSection and the other cards start hidden (each loader reveals its own)',
   ['followUpGuide', 'leadsForYou', 'myClients', 'comingShutdowns', 'myDeductionCard', 'newDailyReport', 'myPayslipCard', 'targetSection'].every(id => /style="display:none;"/.test(tagAttrs(id))));
ok('#quietState starts shown', !/display:none/.test(tagAttrs('quietState')));
ok('the two rail links that follow a section start hidden', ['navTargets', 'navLeads'].every(id => /\shidden>/.test(tagAttrs(id))));
ok('#reportStatus sits inside the slab tag #reportPill', /<span class="tag" id="reportPill"><span id="reportStatus">/.test(HTML));
ok('the ring keeps r=52 and C=326.7 (the page script\'s maths)', /id="targetDonutRing"[^>]*r="52"[^>]*stroke-dasharray="326\.7" stroke-dashoffset="326\.7"/.test(tagAttrs('targetDonutRing')));
ok('#prLink opens in a new tab and starts at "#" (setAppLink fills it)', /href="#" target="_blank"/.test(tagAttrs('prLink')));
ok('#monthQuotations is the slab\'s value', /<div class="v" id="monthQuotations">/.test(HTML));
{
  // training-mode.js points at these; the rebuild must keep every one
  const reg = TM.slice(TM.indexOf("'dashboard.html': {"), TM.indexOf("'leave-request.html': {"));   // A407 — the next entry; performance.html is a stub now
  const sels = (reg.match(/selector: '([^']+)'/g) || []).map(s => s.match(/'([^']+)'/)[1]);
  eq('training-mode.js names four selectors on the sales home', sels.length, 4);
  sels.forEach(sel => {
    const hit = sel.startsWith('#') ? !!tagOf(sel.slice(1)) : new RegExp(sel.replace(/^a\[href="([^"]+)"\]$/, '<a href="$1"')).test(HTML);
    ok('  ' + sel + ' is in the page', hit);
  });
}

/* ── 3 · what the redesign removed on purpose ─────────────────────────────────────────────────── */
sec('3 · no regressions');
['prToday2', 'clientCount2', 'reportStatusInline', 'quotationTodayAnchor', 'monthQuotationsAnchor'].forEach(id => ok('the mirror slot #' + id + ' is gone', !tagOf(id)));
ok('no mirrorStats observer anywhere', !/mirrorStats/.test(HTML) && !/mirrorStats/.test(PJS));
const STYLES = (HTML.match(/style="[^"]*"/g) || []);
ok('every inline style is display:none;', STYLES.length > 0 && STYLES.every(s => s === 'style="display:none;"'), STYLES.filter(s => s !== 'style="display:none;"'));
ok('no literal colour in the page', !HEX.test(HTML));
ok('no emoji in the page', !EMOJI.test(HTML));
ok('no "→" in the page', !/→/.test(HTML));
ok('the bento classes are gone', !/b-card|b-pill|b-btn|b-lbl|b-ic|bento-/.test(HTML));
ok('dashboard.js writes no hex colour and no inline colour', !/#[0-9a-fA-F]{6}\b/.test(JS) && !/style="color/.test(JS) && !/style\.color/.test(JS));
ok('  A407: the report tag is plain text from the daily report\'s own read (new-daily-report-card.js), not the retired report\'s sheet',
   !/apiGetTodayCounts|reportStatus'\)/.test(JS) && /getElementById\('reportStatus'\)/.test(fs.readFileSync(D + 'js/new-daily-report-card.js', 'utf8')));
ok('  target bars carry a tone class and only a width', /class="progress-bar-fill \$\{tone\}" style="width:\$\{pct\}%"/.test(JS) && /'q'\)/.test(JS) && /'p'\)/.test(JS));
{
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
  ok('  A407: no overdue follow-ups and no pending-items count: nothing reads the frozen per-rep sheets for them',
     !/apiGetClientTracker|overdue/i.test(code(JS)) && !/apiGetPendingItems|pendingCount|overdue/i.test(code(PJS)) && !/overdue|pendingCount|navOverdue/i.test(code(HTML)));
}
{
  /* A407 — "two of everything": the home links none of the retired pages; Today keeps eight tools, the old daily report,
     Pending items, the Quotation summary, the client tracker and the weekly itinerary replaced by what took their place */
  const RETIRED = ['report.html', 'my-reports.html', 'performance.html', 'client-tracker.html', 'pending-items.html', 'quotation-summary.html', 'weekly-itinerary.html'];
  const hit = RETIRED.filter(f => new RegExp('href="' + f.replace('.', '\\.') + '"').test(HTML));
  ok('A407: the home links none of the retired pages', hit.length === 0, hit);
  const today = HTML.slice(HTML.indexOf('<section class="hx-glass" id="today">'), HTML.indexOf('<div class="sl-stages"'));
  const tools = (today.match(/<a (?:id="prLink" )?href="([^"]+)"/g) || []).map(a => a.match(/href="([^"]+)"/)[1]);
  ok('  Today\'s tools: new quotation, pricing request, daily report, PR generator, Client Book, My quotations, inventory, client visits',
     JSON.stringify(tools) === JSON.stringify(['flow-quotations.html', 'flow-pricing-request.html', 'my-daily-report.html', '#', 'director-client-book.html', 'quotation-status.html', 'flow-inventory.html', 'client-visits.html']), tools);
  ok('  the mast sends the rep to the daily report', /<a href="my-daily-report\.html" class="btn btn-primary">/.test(HTML));
  ok('  the quiet card is the month\'s target, with no follow-ups in it', /<section class="hx-glass" id="quietState">\s*<div class="hx-head"><h2>Monthly target<\/h2><\/div>\s*<p id="quietMsg">No target is set for this month yet\./.test(HTML));
}
ok('  the "(NN%)" text the ring reads survives', /\(\$\{pct\}%\)/.test(JS) && /\/\\\(\(\\d\+\)%\\\)\/g/.test(PJS));
ok('leads-for-you.js writes classes, no colour, no emoji, no inline style', /class="lfy-card"/.test(LJS) && !/#[0-9a-fA-F]{6}\b/.test(LJS) && !EMOJI.test(LJS) && !/style="/.test(LJS));
ok('sales-home-page.js writes no hex colour and defines no global', !/#[0-9a-fA-F]{6}\b/.test(PJS) && !/window\.\w+\s*=/.test(PJS));
ok('the page script never adds a postFlow/fetchFlow literal (registration.js scans it)', !/postFlow\(|fetchFlow\(/.test(PJS));

/* ── 4 · the stylesheet ───────────────────────────────────────────────────────────────────────── */
sec('4 · sales-home.css');
{
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  let depth = 0, buf = '';
  for (const ch of stripped) {
    if (ch === '{') {
      const sel = buf.trim();
      if (sel && !/^@/.test(sel) && !(depth > 0 && /^(from|to|\d+%)/.test(sel)) && !/^body\.sl/.test(sel)) bad.push(sel.slice(0, 60));
      depth++; buf = '';
    } else if (ch === '}') { depth--; buf = ''; }
    else if (ch === ';' && depth > 0) buf = '';
    else buf += ch;
  }
  ok('every selector is scoped body.sl', bad.length === 0, bad.slice(0, 5));
  // attribute-selector hooks on the shared deduction card ([style*="#16a34a"]) are selectors, not paint
  const paint = stripped.replace(/\[style\*="[^"]*"\]/g, '');
  ok('no literal colour but white on the slab', (paint.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || []).every(h => /^#fff$/i.test(h)), paint.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g));
  ok('no @font-face and no Google Fonts (styles.css owns the type)', !/@font-face|fonts\.googleapis/.test(CSS));
  ['slIn', 'slFill', 'slPop', 'slFade'].forEach(k => ok('@keyframes ' + k + ' exists', new RegExp('@keyframes ' + k + ' ').test(CSS)));
  const kf = (CSS.match(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g) || []).join('\n');
  ok('keyframes animate transform and opacity only', !/(^|[^-])(width|height|top|left|margin|padding|background)\s*:/.test(kf), kf);
  ok('the load moment is gated by body.sl.sl-load', /body\.sl\.sl-load \.hx-facts dd \{ animation: slIn/.test(CSS) && /body\.sl\.sl-load \.progress-bar-fill \{ animation: slFill/.test(CSS));
  ok('a reduced-motion block kills every transition and animation', /prefers-reduced-motion: reduce[\s\S]*body\.sl \*[\s\S]*animation: none !important/.test(CSS));
  ok('no hover-lift anywhere', !/:hover[^{]*\{[^}]*translateY\(-/.test(CSS));
  ok('the ring fills by stroke transition, the tag has two tones', /\.sl-ring \.fill \{[^}]*transition: stroke-dashoffset/.test(CSS) && /#reportPill\[data-tone="ok"\]/.test(CSS) && /#reportPill\[data-tone="warn"\]/.test(CSS));
  ok('the dashboard.js output is painted here, and nothing is left for the cards A407 removed', /\.progress-bar-fill\.p \{/.test(CSS) && !/overdue|div\.wide/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('the leads card and the deduction card are hooked', /#leadsForYou \.lfy-card \{/.test(CSS) && /#myDeductionCard div\[style\*="width:"\]\[style\*="%"\]/.test(CSS));
  ok('the training banner pushes the sticky rail (training-mode.css)', /body\.tm-active \.hx-rail \{ top: 120px/.test(fs.readFileSync(D + 'css/training-mode.css', 'utf8')));
}

/* ── 5 · the page script degrades under a DOM with no observers ──────────────────────────────── */
sec('5 · sales-home-page.js');
{
  const p = page([], 'dashboard.html', { role: 'sales', name: 'Ana Reyes', username: 'ana' });
  let threw = null;
  try { p.run(PJS); } catch (e) { threw = e.message; }
  ok('the script registers without matchMedia / MutationObserver / IntersectionObserver / setInterval', threw === null, threw);
  ok('  the date landed in the rail', /^\d{2}$/.test(p.els.dateDay.textContent) && /\w{3} \w+/.test(p.els.dateMon.textContent), [p.els.dateDay.textContent, p.els.dateMon.textContent]);
  ok('  the day line is the long date', /\w+day, \w+ \d{1,2}, \d{4}/.test(p.els.todayLabel.textContent), p.els.todayLabel.textContent);
  ok('  the quiet card stays while nothing shows', p.els.quietState.style.display === '');
  ok('  the rail links stay hidden', p.els.navTargets.hidden === true && p.els.navLeads.hidden === true);
  ok('  the ring is untouched with no target ("—")', p.els.targetDonutPct.textContent === '');
  threw = null;
  try { p.run('__pi = 0; flowActionsStrip = function (id) { __strip = id; }; apiGetPendingItems = async function () { __pi++; return { success: true, data: { prs: [1, 2], quotations: [1] } }; };'); } catch (e) { threw = e.message; }
  let booted = null;
  (async () => {
    try { await p.boot(); await new Promise(r => setImmediate(r)); } catch (e) { booted = e.message; }
    ok('  its DOMContentLoaded body runs on the stub DOM', booted === null, booted);
    eq('  the strip is mounted on #flowActionCenter', p.run('typeof __strip === "string" ? __strip : null'), 'flowActionCenter');
    eq('  A407: the retired pending-items count is not read', p.run('__pi'), 0);
    await boot6();
  })();
}

/* ── 6 · boot dashboard.js against the real markup ────────────────────────────────────────────── */
async function boot6() {
  sec('6 · dashboard.js on the new markup');
  const p = page(['js/dashboard.js'], 'dashboard.html', { role: 'sales', name: 'Ana Reyes', username: 'ana', quotationSheetId: 'q', prSheetId: 'p' });
  p.run(`clearApiCache = function(){}; getGreeting = n => 'Good morning, <span>' + n + '</span>';
         apiGetStats = async (n, ids, span) => span === 'today' ? { success: true, quotations: 3, prs: 2 } : { success: true, quotations: 27, prs: 14 };
         __old = []; apiGetTodayCounts = async () => { __old.push('getTodayCounts'); return { success: true, alreadySubmitted: true }; };
         apiGetClientCount = async () => ({ success: true, count: 148 });
         apiGetTargets = async () => ({ success: true, data: [{ quotationTarget: 40, prTarget: 20 }] });
         apiGetClientTracker = async () => { __old.push('getClientTracker'); return { success: true, data: [
           { clientName: 'Holcim', type: 'Quotation', documentNumber: 'Q-1', followUpDate: '2020-01-01', status: 'Sent' },
           { clientName: 'Won Co', type: 'Quotation', documentNumber: 'Q-2', followUpDate: '2020-01-01', status: 'Won' },
           { clientName: 'Later', type: 'PR', documentNumber: 'PR-9', followUpDate: '2999-01-01', status: 'Open' } ] }; };`);
  let threw = null;
  try { await p.boot(); } catch (e) { threw = e.stack; }
  ok('boot does not throw', threw === null, threw);
  eq('  the greeting names her', p.els.greeting.innerHTML, 'Good morning, <span>Ana Reyes</span>');
  eq('  #monthQuotations', String(p.els.monthQuotations.textContent), '27');
  eq('  #quotationToday', String(p.els.quotationToday.textContent), '3');
  eq('  #prToday', String(p.els.prToday.textContent), '2');
  eq('  #monthPRs', String(p.els.monthPRs.textContent), '14');
  eq('  #clientCount', String(p.els.clientCount.textContent), '148');
  eq('  A407: dashboard.js reads neither the retired report\'s sheet nor the old tracker', p.run('__old.join(",")'), '');
  eq('  #reportStatus is left to new-daily-report-card.js', p.els.reportStatus.textContent, '');
  ok('  two toned bars, the "(NN%)" shape intact', /class="progress-bar-fill q" style="width:68%"/.test(p.els.targetBars.innerHTML) && /class="progress-bar-fill p" style="width:70%"/.test(p.els.targetBars.innerHTML) && /27 \/ 40 \(68%\)/.test(p.els.targetBars.innerHTML), p.els.targetBars.innerHTML);
  eq('  #targetSection shown', p.els.targetSection.style.display, 'block');
  eq('  #prLink points at /pr', p.els.prLink.href, '/pr');
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
}
