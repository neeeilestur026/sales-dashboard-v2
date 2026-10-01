/* A294 — the HR home's CONTRACT: what the rebuilt hr-home.html must keep, and what it must never
 * carry again.
 *
 * Run:  node tests/flow/hr-home-contract.js
 *
 * hr-home.js reaches into the page by id with no null guards on the greeting and the six stat
 * figures, sets the banner's class by name, and renders the overview and the birthday list;
 * management-flow.js drives the daily-reports block by the ids the management home uses. Section
 * 1 pins the shell, 2 every id with its tag and the hidden ones, 3 what the rebuild removed on
 * purpose, 4 the sheet's scope and motion, 5 the page script under a DOM with no observers, and
 * 6 boots hr-home.js against the real markup with a fixture for each call. */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'hr-home.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/hr-home.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/hr-home.js', 'utf8');
const PJS  = fs.readFileSync(D + 'js/hr-home-page.js', 'utf8');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u;
const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/;
const tagOf = (id) => { const m = HTML.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
const tagAttrs = (id) => { const m = HTML.match(new RegExp('<\\w+[^>]*\\sid="' + id + '"[^>]*>')); return m ? m[0] : ''; };

/* ── 1 · the shell ────────────────────────────────────────────────────────────────────────────── */
sec('1 · the shell');
eq('head links, in order', (HTML.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]).join(','), 'styles.css,flow.css,daily-reports.css,payslip-card.css,hr-home.css');
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('<body class="hr"> — the scope every rule hangs off', /<body class="hr">/.test(HTML));
ok('js/theme.js is the first child of <body>', /<body class="hr">\s*<script src="js\/theme\.js"><\/script>/.test(HTML));
eq('script order', (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','),
   'theme.js,api.js,salary-deduction-card.js,payslip.js,my-payslip-card.js,auth.js,flow-api.js,hr-home.js,report-render.js,report-pdf.js,team-performance.js,management-flow.js,hr-home-page.js');
eq('zero inline <script>', (HTML.match(/<script>/g) || []).length, 0);
ok('the deck: a sticky rail with the slab and the nav, then the column', /<aside class="hx-rail" id="rail">/.test(HTML) && /<section class="hx-slab" id="spot">/.test(HTML) && /<nav class="hx-rail-nav"/.test(HTML) && /<div class="hx-col">/.test(HTML));
ok('the theme toggle is the shared class', /class="theme-toggle" id="themeToggle" aria-pressed="false"/.test(HTML));
ok('the mast keeps the daily report as the primary button and analytics as a plain one', /href="hr-daily-report\.html" class="btn btn-primary"/.test(HTML) && /href="hr-analytics\.html" class="btn"/.test(HTML));

/* ── 2 · every id the scripts reach for, with the tag it expects ──────────────────────────────── */
sec('2 · the id contract');
const TAGS = {
  h1: ['greeting'],
  p: ['todayLabel'],
  b: ['hbDay'],
  span: ['hbMon', 'pipelineCount', 'empCount', 'leaveCount', 'taskCount', 'campaignCount', 'mgmtDrMeta', 'mfTwRange'],
  dd: ['statOpen', 'statTasksPending', 'statTasksDone', 'statCampaigns', 'statLeave'],
  div: ['statEmployees', 'alertBanner', 'todayOverview', 'birthdayList', 'mgmtDrUsers', 'mgmtDrMovements', 'mgmtDrDocs', 'mgmtDrSales', 'mgmtDrPdfs', 'mgmtDrBody', 'mfTwBody'],
  section: ['spot', 'myDeductionCard', 'myPayslipCard', 'today', 'hrmods', 'mkmods', 'newsec-daily-reports'],
  button: ['themeToggle', 'mfTwReset', 'mfTwNext', 'mfTwPdfBtn'],
  input: ['mgmtDrDate', 'mgmtDrSearch'],
  header: ['navbar'], aside: ['rail'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
const reached = (src) => Array.from(new Set((src.match(/getElementById\('([^']+)'\)/g) || []).map(s => s.match(/'([^']+)'/)[1])));
reached(JS).forEach(id => ok('hr-home.js reaches #' + id + ' and it exists', !!tagOf(id)));
ok('#statEmployees is the slab\'s value and the five facts are in the rail', /<div class="v" id="statEmployees">/.test(HTML) && HTML.indexOf('id="statLeave"') < HTML.indexOf('<div class="hx-col">'));
ok('#alertBanner keeps class alert-banner (hr-home.js sets alert-banner success | warning) and starts hidden', /class="alert-banner" style="display:none;"/.test(tagAttrs('alertBanner')));
ok('#myDeductionCard and #mfTwReset start hidden', ['myDeductionCard', 'myPayslipCard', 'mfTwReset'].every(id => /style="display:none;"/.test(tagAttrs(id))));
ok('twelve module cards keep .module-card with an iconed head and the four stat ids', (HTML.match(/class="module-card"/g) || []).length === 12 && (HTML.match(/class="module-card-icon/g) || []).length === 12 && ['pipelineCount', 'empCount', 'leaveCount', 'taskCount', 'campaignCount'].every(id => /class="module-stat"><span class="num" id="/.test(HTML) && !!tagOf(id)));
ok('the weekly report keeps its four inline handlers', ['mfTwNav(-1)', 'mfTwNav(0)', 'mfTwNav(1)', 'mfTwPdf()'].every(h => HTML.includes('onclick="' + h + '"')));

/* ── 3 · what the rebuild removed on purpose ──────────────────────────────────────────────────── */
sec('3 · no regressions');
const STYLES = (HTML.match(/style="[^"]*"/g) || []);
ok('every inline style is display:none;', STYLES.length > 0 && STYLES.every(s => s === 'style="display:none;"'), STYLES.filter(s => s !== 'style="display:none;"'));
ok('no literal colour in the page', !HEX.test(HTML));
ok('no emoji in the page', !EMOJI.test(HTML));
ok('no "→" in the page', !/→/.test(HTML));
ok('the hero, the quick-actions grid, the kpi cards, the info cards and the newsec chrome are gone', !/class="hero|hero-pill|quick-actions|qa-btn|kpi-grid|kpi-card|info-card|bottom-grid|mgmt-newsec|mgmtToggleNewsec|newsec-chevron/.test(HTML));
ok('hr-home.js writes no hex colour, no rgba and no inline style', !/#[0-9a-fA-F]{6}\b/.test(JS) && !/rgba\(/.test(JS) && !/style="/.test(JS));
ok('  the avatars are classed by type and the empties are .hx-empty', /class="bday-avatar ' \+ \(e\.type === 'Birthday' \? 'bd' : 'an'\) \+ '"/.test(JS) && (JS.match(/class="hx-empty"/g) || []).length === 2);
ok('  the banner link is classed', /class="alert-link"/.test(JS) && !/style="color/.test(JS));
ok('hr-home-page.js writes no hex colour and defines no global', !/#[0-9a-fA-F]{6}\b/.test(PJS) && !/window\.\w+\s*=/.test(PJS));

/* ── 4 · the sheet ────────────────────────────────────────────────────────────────────────────── */
sec('4 · hr-home.css');
{
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = []; let depth = 0, buf = '';
  for (const ch of stripped) {
    if (ch === '{') { const sel = buf.trim(); if (sel && !/^@/.test(sel) && !(depth > 0 && /^(from|to|\d+%)/.test(sel)) && !/^body\.hr/.test(sel)) bad.push(sel.slice(0, 60)); depth++; buf = ''; }
    else if (ch === '}') { depth--; buf = ''; } else if (ch === ';' && depth > 0) buf = ''; else buf += ch;
  }
  ok('every selector is scoped body.hr', bad.length === 0, bad.slice(0, 5));
  ok('no literal colour and no dark-era fallback', !HEX.test(stripped) && !/var\(--[\w-]+,\s*#/.test(stripped), stripped.match(HEX));
  ok('@keyframes hrIn / hrFade exist and animate transform and opacity only', /@keyframes hrIn /.test(CSS) && /@keyframes hrFade /.test(CSS) && !/(^|[^-])(width|height|top|left|margin|padding|background)\s*:/.test((CSS.match(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g) || []).join('\n')));
  ok('no hover-lift', !/:hover[^{]*\{[^}]*translateY\(-/.test(CSS));
  ok('the load moment is gated by body.hr.hr-load', /body\.hr\.hr-load \.hx-facts dd \{ animation: hrIn/.test(CSS) && /body\.hr\.hr-load \.module-card \{ animation: hrIn/.test(CSS));
  ok('a reduced-motion block', /prefers-reduced-motion: reduce[\s\S]*body\.hr \*[\s\S]*animation: none !important/.test(CSS));
  ok('the banner tones, the module cards, the avatars and the overview rows are styled', ['.alert-banner.warning', '.alert-banner.success', '.module-card', '.module-card-icon.t-cyan', '.bday-avatar.an', '.bday-today', '.overview-item', '.dr-tiles .dr-tile'].every(c => CSS.includes(c + ' {') || CSS.includes(c + ',')));
}

/* ── 5 · the page script degrades under a DOM with no observers ──────────────────────────────── */
sec('5 · hr-home-page.js');
{
  const p = page([], 'hr-home.html', { role: 'hr', name: 'Ana Reyes', username: 'ana' });
  let threw = null;
  try { p.run(PJS); } catch (e) { threw = e.message; }
  ok('the script registers without matchMedia / MutationObserver / IntersectionObserver', threw === null, threw);
  ok('  the date landed in the rail and the day line is the long date', /^\d{2}$/.test(p.els.hbDay.textContent) && /\w+day, \w+ \d{1,2}, \d{4}/.test(p.els.todayLabel.textContent), [p.els.hbDay.textContent, p.els.todayLabel.textContent]);
  (async () => {
    try { await p.boot(); } catch (e) { threw = e.message; }
    ok('  its DOMContentLoaded body runs on the stub DOM', threw === null, threw);
    await boot6();
  })();
}

/* ── 6 · boot hr-home.js against the real markup ──────────────────────────────────────────────── */
async function boot6() {
  sec('6 · hr-home.js on the new markup');
  const p = page(['js/hr-home.js'], 'hr-home.html', { role: 'hr', name: 'Ana Reyes', fullName: 'Ana Reyes', username: 'ana' });
  p.run(`requireHR = function(){ return __session; };
         apiGetHRSummary = async () => ({ success: true, data: { totalEmployees: 24, openPositions: 2, onboarding: 1 } });
         apiGetHRTaskStats = async () => ({ success: true, data: { pending: 3, inProgress: 2, completed: 9 } });
         apiGetRecruitmentStats = async () => ({ success: true, data: { total: 6, byStage: { Complete: 2 } } });
         apiGetLeaveStats = async () => ({ success: true, data: { total: 5, pending: 1 } });
         apiGetCampaignStats = async () => ({ success: true, data: { active: 2, totalLeads: 40 } });
         apiGetBirthdayAnniversary = async () => ({ success: true, data: [{ name: 'Kim Reyes', type: 'Birthday', daysAway: 0, date: 'Sep 28', detail: '' }, { name: 'Gerald Cruz', type: 'Anniversary', daysAway: 4, date: 'Oct 2', detail: '3 years' }] });
         apiGetHRDailyReports = async () => ({ success: true, data: [] });`);
  let threw = null;
  try { await p.boot(); await new Promise(r => setImmediate(r)); } catch (e) { threw = e.stack; }
  ok('boot does not throw', threw === null, threw);
  eq('  the greeting names her', p.els.greeting.textContent, 'Welcome to Hi-Escorp, Ana Reyes!');
  ok('  the slab filled: employees, open positions, tasks pending and done, campaigns, leave', String(p.els.statEmployees.textContent) === '24' && String(p.els.statOpen.textContent) === '2' && String(p.els.statTasksPending.textContent) === '5' && String(p.els.statTasksDone.textContent) === '9' && String(p.els.statCampaigns.textContent) === '2' && String(p.els.statLeave.textContent) === '1',
     [p.els.statEmployees.textContent, p.els.statOpen.textContent, p.els.statTasksPending.textContent, p.els.statTasksDone.textContent, p.els.statCampaigns.textContent, p.els.statLeave.textContent]);
  ok('  the module stats filled', String(p.els.pipelineCount.textContent) === '4' && String(p.els.empCount.textContent) === '24' && String(p.els.leaveCount.textContent) === '1' && String(p.els.taskCount.textContent) === '5' && String(p.els.campaignCount.textContent) === '2');
  eq('  the overview lists eight rows', (p.els.todayOverview.innerHTML.match(/class="overview-item"/g) || []).length, 8);
  ok('  the birthdays render classed avatars and badges', /class="bday-avatar bd">KR</.test(p.els.birthdayList.innerHTML) && /class="bday-avatar an">GC</.test(p.els.birthdayList.innerHTML) && /class="bday-badge bday-today">Today!</.test(p.els.birthdayList.innerHTML) && /bday-soon">4 days</.test(p.els.birthdayList.innerHTML) && !/style="/.test(p.els.birthdayList.innerHTML), p.els.birthdayList.innerHTML.slice(0, 300));
  ok('  the banner warns that today\'s report is not in, with a classed link', p.els.alertBanner.className === 'alert-banner warning' && /class="alert-link">Submit now<\/a>/.test(p.els.alertBanner.innerHTML) && p.els.alertBanner.style.display === 'flex');
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
}
