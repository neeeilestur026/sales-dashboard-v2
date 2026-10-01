/* A287 — the lead-generation dashboard's CONTRACT: what the redesigned markup must keep, and what
 * it must never carry again.
 *
 * Run:  node tests/flow/leadgen-contract.js
 *
 * leadgen-home.js reaches into leadgen-home.html by id with no null guards (boot wires eleven
 * listeners before the first fetch), management-flow.js drives the oversight block by the same ids
 * the management home uses, and the leadgen boot REMOVES that block synchronously — so the cheapest
 * way for a rebuild to break the page is to rename, retype or move one element. Section 1 pins the
 * shell, 2 every id with its tag, 3 the things the redesign removed on purpose (inline styles,
 * emoji, the old card classes, colour in the script), 4 the stylesheet's scope and its motion layer,
 * 5 the report page's nesting (the old markup closed the sheet early), 6 the inline script under a
 * DOM with no observers, and 7 boots both roles against the real HTML. */
const fs = require('fs');
const path = require('path');
const { page, D } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), got === want, { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');

const HTML = fs.readFileSync(D + 'leadgen-home.html', 'utf8');
const RPT  = fs.readFileSync(D + 'leadgen-daily-report.html', 'utf8');
const CSS  = fs.readFileSync(D + 'css/leadgen.css', 'utf8');
const JS   = fs.readFileSync(D + 'js/leadgen-home.js', 'utf8');
const RJS  = fs.readFileSync(D + 'js/leadgen-daily-report.js', 'utf8');

/* Pictographs and dingbats — except ✓ ✕ ✉, which the UI test pins in the script's own output. */
const EMOJI_HTML = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const EMOJI_JS = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2708}\u{270A}-\u{2712}\u{2714}\u{2716}-\u{27BF}]/u;
const tagIn = (html, id) => { const m = html.match(new RegExp('<(\\w+)[^>]*\\sid="' + id + '"')); return m ? m[1].toLowerCase() : null; };
const tagOf = (id) => tagIn(HTML, id);
const tagAttrs = (html, id) => { const m = html.match(new RegExp('<\\w+[^>]*\\sid="' + id + '"[^>]*>')); return m ? m[0] : ''; };

/* ── 1 · the shell ────────────────────────────────────────────────────────────────────────────── */
sec('1 · the shell');
ok('head links styles.css, flow.css, daily-reports.css, then leadgen.css, in that order',
   /styles\.css[\s\S]*flow\.css[\s\S]*daily-reports\.css[\s\S]*leadgen\.css/.test(HTML));
ok('  and no shared skin', !/bento-skin|flow-screen/.test(HTML));
ok('the page carries NO <style> block', !/<style[\s>]/i.test(HTML));
ok('<body class="lg"> — the scope every rule hangs off', /<body class="lg">/.test(HTML));
const SCRIPTS = (HTML.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]);
eq('script order unchanged', SCRIPTS.join(','), 'theme.js,api.js,salary-deduction-card.js,payslip.js,my-payslip-card.js,auth.js,flow-api.js,leadgen-home.js,report-render.js,report-pdf.js,team-performance.js,management-flow.js');
eq('exactly one inline <script>', (HTML.match(/<script>/g) || []).length, 1);
ok('the oversight block keeps its inline handlers (management-flow.js calls them by name)',
   /onclick="mgmtToggleNewsec\('newsec-daily-reports'\)"/.test(HTML) && /onclick="mfTwNav\(-1\)"/.test(HTML) && /onclick="mfTwNav\(0\)"/.test(HTML) && /onclick="mfTwNav\(1\)"/.test(HTML) && /onclick="mfTwPdf\(\)"/.test(HTML));

/* ── 2 · every id the scripts reach for, with the tag it expects ──────────────────────────────── */
sec('2 · the id contract');
const TAGS = {
  form:   ['dockForm', 'recForm2', 'setForm'],
  select: ['setRepLuzon', 'setRepVisMin'],
  input:  ['setMaxBatch', 'setReplyAim', 'setHolidays', 'setCycle', 'dockKeep', 'recEntity', 'recRowIndex', 'recId', 'mgmtDrDate', 'mgmtDrSearch'],
  button: ['logBtn', 'settingsBtn', 'fridayPdfBtn', 'dockClose', 'dockSave', 'recCancel', 'recSaveBtn', 'setCancel', 'setSave', 'mfTwReset', 'mfTwNext', 'mfTwPdfBtn'],
  div:    ['tiles', 'week', 'followups', 'tabs', 'panels', 'dockTabs', 'dockFields', 'recForm', 'setQuotas', 'setDays', 'flowActionCenter',
           'mgmtDrBody', 'mfTwBody', 'dock', 'recModal', 'setModal', 'msg', 'dockMsg', 'recFormMsg', 'setMsg', 'tiles-anchor', 'tabsSeg'],
  section: ['myDeductionCard', 'myPayslipCard', 'followups-anchor', 'trackers', 'newsec-daily-reports', 'flowActionCenterCard'],
  h1:     ['greeting'],
  h3:     ['recModalTitle'],
};
Object.keys(TAGS).forEach(tag => TAGS[tag].forEach(id => eq('#' + id, tagOf(id), tag)));
['navbar', 'subline', 'roTag', 'dateDay', 'dateDow', 'dateMon', 'weekPill', 'weekPillText', 'tilesMeta', 'fuCount', 'weekMeta', 'dockHint', 'mgmtDrMeta',
 'mgmtDrUsers', 'mgmtDrMovements', 'mgmtDrDocs', 'mgmtDrSales', 'mgmtDrPdfs', 'mfTwRange'].forEach(id => ok('#' + id + ' exists', !!tagOf(id)));
ok('#roTag and #settingsBtn start hidden — the JS reveals them with display=""', /style="display:none;"/.test(tagAttrs(HTML, 'roTag')) && /style="display:none;"/.test(tagAttrs(HTML, 'settingsBtn')));
ok('#myDeductionCard, #msg, #mfTwReset start hidden', ['myDeductionCard', 'myPayslipCard', 'msg', 'mfTwReset'].every(id => /style="display:none;"/.test(tagAttrs(HTML, id))));
ok('the drawer and both modals keep flow-modal-overlay (the JS toggles .open on them)', ['dock', 'recModal', 'setModal'].every(id => /class="flow-modal-overlay"/.test(tagAttrs(HTML, id))));
ok('#dockSave and #recSaveBtn read exactly "Save" (the JS restores that text after saving)', /id="dockSave">Save</.test(HTML) && /id="recSaveBtn">Save</.test(HTML));
ok('#tiles carries the board class and #tabs sits inside #tabsSeg next to the indicator',
   /class="lg-board" id="tiles"/.test(HTML) && /id="tabsSeg"><span class="lg-seg-ind"><\/span><div class="lg-seg-track" id="tabs">/.test(HTML));
const OVERSIGHT = HTML.slice(HTML.indexOf('id="newsec-daily-reports"'), HTML.indexOf('</main>'));
ok('#mgmtDrDate and #mfTwBody live INSIDE the oversight block (the leadgen boot removes it whole)', /id="mgmtDrDate"/.test(OVERSIGHT) && /id="mfTwBody"/.test(OVERSIGHT) && /id="mgmtDrBody"/.test(OVERSIGHT));
ok('  and #tiles, #followups, #week do not', !/id="tiles"/.test(OVERSIGHT) && !/id="followups"/.test(OVERSIGHT) && !/id="week"/.test(OVERSIGHT));
ok('the three hash anchors the action strip links to', tagOf('tiles-anchor') && tagOf('followups-anchor') && tagOf('trackers'));

/* ── 3 · what the redesign removed on purpose ─────────────────────────────────────────────────── */
sec('3 · no regressions');
const STYLES = (HTML.match(/style="[^"]*"/g) || []);
ok('every inline style on the home page is display:none;', STYLES.length > 0 && STYLES.every(s => s === 'style="display:none;"'), STYLES.filter(s => s !== 'style="display:none;"'));
ok('no inline style at all on the report page', !/style="/.test(RPT));
ok('no emoji in either page', !EMOJI_HTML.test(HTML) && !EMOJI_HTML.test(RPT));
ok('no "→" in either page', !/→/.test(HTML) && !/→/.test(RPT));
ok('the old card classes are gone from the home page', !/lg-hero|b-card|lg-tiles|mkt-tabs|b-pill|b-btn|b-lbl/.test(HTML));
ok('leadgen-home.js writes no hex colour', !/#[0-9a-fA-F]{6}\b/.test(JS));
ok('leadgen-home.js writes no emoji (✓ ✕ stay: the UI test pins them)', !EMOJI_JS.test(JS), (JS.match(EMOJI_JS) || [])[0]);
ok('leadgen-daily-report.js writes no emoji and no inline colour', !EMOJI_JS.test(RJS) && !/style="color/.test(RJS));
ok('tiles carry data-st after data-dock (the pinned button prefix survives)', /data-dock="\$\{dock\}" data-st="\$\{st\}"/.test(JS));
ok('the week heading is class="wk-head" (no d-prefixed class inside #week but the seven day boxes)', /class="wk-head"/.test(JS) && !/class="b-lbl" style=/.test(JS));
ok('bars are classed, not painted', /class="\$\{state\}" style="width:/.test(JS) && !/stColor/.test(JS));
ok('the table host scrolls: id="pBody" class="lg-scroll"', /id="pBody" class="lg-scroll"/.test(JS));
ok('every message writes a class, never a colour', !/style\.color\s*=/.test(JS) && /className = 'flow-msg bad'/.test(JS) && /'lg-toast ' \+ \(ok \? 'ok' : 'bad'\)/.test(JS));
ok('the icon map exists and every tile, tracker and dock tab names a key in it', (() => {
  const m = JS.match(/const LG_ICON = \{([\s\S]*?)\n\};/); if (!m) return false;
  const keys = (m[1].match(/^\s*(\w+):/gm) || []).map(s => s.trim().replace(':', ''));
  const used = [];
  const tiles = (JS.match(/const LG_TILES = \[([\s\S]*?)\];/) || [])[1] || '';
  (tiles.match(/\['\w+', '[^']+', '(\w+)', '\w+'\]/g) || []).forEach(t => used.push(t.match(/', '(\w+)', '\w+'\]$/)[1]));
  (JS.match(/icon: '(\w+)'/g) || []).forEach(t => used.push(t.match(/'(\w+)'/)[1]));
  const dock = (JS.match(/const DOCK_TABS = \[(.*)\];/) || [])[1] || '';
  (dock.match(/\['\w+', '(\w+)', '[A-Za-z]+'\]/g) || []).forEach(t => used.push(t.match(/', '(\w+)', '/)[1]));
  return used.length === 20 && used.every(k => keys.includes(k));
})());

/* ── 4 · the stylesheet ───────────────────────────────────────────────────────────────────────── */
sec('4 · leadgen.css');
{
  // every top-level selector starts with body.lg; @font-face / @keyframes / @media / @supports are the only other blocks
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  let depth = 0, buf = '';
  for (const ch of stripped) {
    if (ch === '{') {
      const sel = buf.trim();
      if (sel && !/^@/.test(sel) && !(depth > 0 && /^(from|to|\d+%)/.test(sel)) && !/^body\.lg/.test(sel)) bad.push(sel.slice(0, 60));
      depth++; buf = '';
    } else if (ch === '}') { depth--; buf = ''; }
    else if (ch === ';' && depth > 0) buf = '';
    else buf += ch;
  }
  ok('every selector is scoped body.lg', bad.length === 0, bad.slice(0, 5));
  const faces = CSS.match(/@font-face\s*\{[^}]*\}/g) || [];
  eq('A301: no @font-face of its own (styles.css owns the type)', faces.length, 0);
  faces.forEach(f => {
    const u = (f.match(/url\('\/static\/fonts\/([^']+)'\)/) || [])[1];
    ok('  ' + u + ' exists on disk', !!u && fs.existsSync(path.join(__dirname, '../../static/fonts/' + u)));
  });
  ok('the two keyframes exist', /@keyframes lgFill/.test(CSS) && /@keyframes lgIn/.test(CSS));
  const kf = (CSS.match(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g) || []).join('\n');
  ok('keyframes animate transform and opacity only', !/(^|[^-])(width|height|top|left|margin|padding)\s*:/.test(kf), kf);
  ok('the one load moment is gated by body.lg.lg-animate', /body\.lg\.lg-animate #tiles \.lg-bar > i \{ animation:lgFill/.test(CSS));
  ok('a reduced-motion block kills every transition and animation', /prefers-reduced-motion:reduce[\s\S]*body\.lg \*[\s\S]*animation:none !important/.test(CSS));
  ok('a solid fallback when backdrop-filter is unsupported', /@supports not \(\(backdrop-filter/.test(CSS));
  ok('the drawer opens on #dock.open', /body\.lg #dock\.open \.flow-modal/.test(CSS));
  ok('no hover-lift anywhere', !/:hover[^{]*\{[^}]*translateY\(-/.test(CSS));
  ok('the app-wide accent names are remapped for the injected navbar', /--accent:#2E3192/.test(CSS) && /--accent-ring:rgba\(0,174,239/.test(CSS));
  ok('both pages link the stylesheet', /css\/leadgen\.css/.test(HTML) && /css\/leadgen\.css/.test(RPT));
}

/* ── 5 · the report page ──────────────────────────────────────────────────────────────────────── */
sec('5 · leadgen-daily-report.html');
eq('exactly one <article> — the sheet', (RPT.match(/<article/g) || []).length, 1);
const SHEET = RPT.slice(RPT.indexOf('<article'), RPT.indexOf('</article>'));
eq('four sections inside it', (SHEET.match(/class="dr-sect"/g) || []).length, 5);
eq('  balanced <section> / </section>', (SHEET.match(/<section/g) || []).length, (SHEET.match(/<\/section>/g) || []).length);
['sumAttempts', 'sumConversations', 'sumEmails', 'sumLinkedin', 'sumSuppliers', 'sumAccounts', 'sumScheduled', 'sumEod', 'sumMovements', 'sumEmailsMailbox',
 'summaryRow', 'taskList', 'timelineBody', 'emailBody', 'notesField', 'notesMsg', 'reportMeta', 'tlCount', 'emailCount'].forEach(id => ok('#' + id + ' is inside the sheet', new RegExp('id="' + id + '"').test(SHEET)));
eq('#datePicker', tagIn(RPT, 'datePicker'), 'input');
eq('#notesField', tagIn(RPT, 'notesField'), 'textarea');
eq('#timelineBody', tagIn(RPT, 'timelineBody'), 'tbody');
eq('#emailBody', tagIn(RPT, 'emailBody'), 'tbody');
['refreshBtn', 'printBtn', 'saveNotesBtn', 'submitBtn'].forEach(id => eq('#' + id, tagIn(RPT, id), 'button'));
ok('the two button labels the JS restores after saving are exact', /id="saveNotesBtn">Save Notes</.test(RPT) && /id="submitBtn">Submit to Management</.test(RPT));
ok('<body class="lg lg-report">', /<body class="lg lg-report">/.test(RPT));
eq('scripts', (RPT.match(/<script src="js\/([^"]+)"/g) || []).map(s => s.match(/js\/([^"]+)/)[1]).join(','), 'theme.js,api.js,auth.js,flow-api.js,leadgen-daily-report.js');
ok('the summary is a board of ten', /class="lg-board lg-board-5" id="summaryRow"/.test(RPT) && (SHEET.match(/class="dr-tile"/g) || []).length === 10);
ok('the timeline error is no longer overwritten by render()', /document\.getElementById\('taskList'\)\.innerHTML = `<div class="dr-empty">/.test(RJS) && /return;\n  \}\n  render\(\);/.test(RJS));
ok('saveNotes is null-safe on the response', /\(\(r && r\.message\) \|\| /.test(RJS));

/* ── 6 · the inline script degrades under a DOM with no observers ─────────────────────────────── */
sec('6 · the inline script');
{
  const inline = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  const p = page([], 'leadgen-home.html', { role: 'leadgen', name: 'Ana Reyes' });
  let threw = null;
  try { p.run(inline); } catch (e) { threw = e.message; }
  ok('the script parses and registers without matchMedia / MutationObserver', threw === null, threw);
  eq('mgmtToggleNewsec is defined', p.run('typeof mgmtToggleNewsec'), 'function');
  threw = null;
  try { p.run('(function(){ var f = null; ' + inline.replace(/document\.addEventListener\('DOMContentLoaded', /, 'f = (') + '; return f; })()()'); } catch (e) { threw = e.message; }
  ok('its DOMContentLoaded body runs to completion on the stub DOM', threw === null, threw);
}

/* ── 7 · boot both roles against the real HTML ────────────────────────────────────────────────── */
sec('7 · boot');
const DAYS = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
const Q = { attempts: 40, conversations: 5, emails: 25, linkedin: 5, suppliers: 5, accounts: 10, crm: 1, eod: 1, scheduled: 1 };
const dayOf = (o) => Object.assign({ attempts: 0, conversations: 0, emails: 0, linkedin: 0, suppliers: 0, accounts: 0, crm: 0, eod: 0, scheduled: 0, working: true }, o);
const COUNTS = {
  success: true, today: '2026-09-16', hour: '10:00', day: dayOf({ attempts: 12, conversations: 1, emails: 8, linkedin: 2, suppliers: 1, accounts: 4, crm: 9, scheduled: 1 }),
  quotas: Q, quotasMax: Q,
  week: { start: DAYS[0], end: DAYS[6], days: DAYS, workingDays: DAYS.slice(0, 5), targets: {}, targetsMax: {}, totals: dayOf({}), byDay: {}, weekly: {}, replyRate: 4.2, replyRateAim: 8 },
  sector: { name: 'Power', index: 3, of: 4 }, reps: { Luzon: 'gerald', VisMin: 'kim' }, workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], holidays: [], maxBatch: 60,
};
async function bootAs(session) {
  const p = page(['js/leadgen-home.js'], 'leadgen-home.html', session);
  p.run(`setInterval = function(){ return 0; }; clearInterval = function(){}; window.addEventListener = function(){};
         requireLeadgenAccess = function(){ return __session; };
         if (typeof flowSetViewerOnly !== 'function') flowSetViewerOnly = function(){};
         apiFetchEmailLogToday = async function(){ return { success: true, emails: [] }; };
         apiGetUsers = async function(){ return { users: [] }; };
         fetchFlow = function(a, p){ __calls.push(a); __params.push({ action: a, params: p || {} });
           if (a === 'getLeadgenCounts') return Promise.resolve(${JSON.stringify(COUNTS)});
           if (a === 'getLeadgenFollowups') return Promise.resolve({ success: true, data: [{ contactNo: 'C1', name: 'R. Santos', company: 'Holcim', plantSite: 'Bulacan', stage: 'Day 7', due: '2026-09-15', action: 'Follow-up call', overdue: 1 }] });
           if (a === 'getLeadgen') return Promise.resolve({ success: true, data: { plants: [{ rowIndex: 2, plantNo: 'P-1', company: 'Holcim', plantSite: 'Bulacan', sector: 'Cement', territory: 'Luzon', status: 'Active' }], contacts: [], leads: [], accred: [], suppliers: [] } });
           return Promise.resolve({ success: true, data: [] }); };`);
  let threw = null;
  try { await p.boot(); } catch (e) { threw = e.stack; }
  return { p, threw };
}
(async () => {
  {
    const { p, threw } = await bootAs({ role: 'leadgen', name: 'Ana Reyes', username: 'ana' });
    ok('leadgen: boot does not throw', threw === null, threw);
    ok('  the greeting names her', /Ana\.$/.test(p.els.greeting.textContent), p.els.greeting.textContent);
    eq('  the board draws nine cells', (p.els.tiles.innerHTML.match(/class="b-card lg-tile"/g) || []).length, 9);
    ok('  each cell carries data-st and an svg icon', (p.els.tiles.innerHTML.match(/data-st="/g) || []).length === 9 && /<svg/.test(p.els.tiles.innerHTML));
    ok('  the meta line is the server hour', p.els.tilesMeta.textContent === 'Counted at server time 10:00', p.els.tilesMeta.textContent);
    ok('  the follow-up reads "Follow-up call, due 2026-09-15, 1 day late"', /Follow-up call, due 2026-09-15<span class="late">, 1 day late<\/span>/.test(p.els.followups.innerHTML), p.els.followups.innerHTML.slice(0, 300));
    ok('  the tracker tabs carry icons and counts', /class="mkt-tab active" data-tab="plants" role="tab" tabindex="0"><span class="ico"><svg/.test(p.els.tabs.innerHTML) && /<span class="cnt">1<\/span>/.test(p.els.tabs.innerHTML), p.els.tabs.innerHTML.slice(0, 200));
    ok('  the panel toolbar offers "Add plant" and a search named for the tab', /id="pAdd">Add plant</.test(p.els.panels.innerHTML) && /placeholder="Search plants"/.test(p.els.panels.innerHTML));
    ok('  the oversight block was removed', p.calls.every(c => !/getActivityLog|getDailyReports/.test(c)));
    ok('  the read-only tag stays hidden and the log button shows', p.els.roTag.style.display === 'none' && p.els.logBtn.style.display !== 'none');
  }
  {
    const { p, threw } = await bootAs({ role: 'director', name: 'Neil Estur', username: 'neil' });
    ok('director: boot does not throw', threw === null, threw);
    ok('  read-only: the tag shows, the log button hides, settings shows', p.els.roTag.style.display === '' && p.els.logBtn.style.display === 'none' && p.els.settingsBtn.style.display === '');
    ok('  the board draws divs, not buttons', (p.els.tiles.innerHTML.match(/class="b-card lg-tile"/g) || []).length === 9 && !/<button/.test(p.els.tiles.innerHTML));
    eq('  the subline says oversight', p.els.subline.textContent, 'Lead generation, oversight view');
  }
  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
})();
