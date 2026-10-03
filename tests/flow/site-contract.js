/* A289 — the SITE contract: what every page must carry now that the brand system is the base.
 *
 * Run:  node tests/flow/site-contract.js
 *
 * Section 1 walks every dashboard/*.html (the redirect stub excepted): styles.css first and once, no
 * bento skin, the theme script as the first child of <body>, no Google Fonts import outside the
 * base. Section 2 lints the shared sheets: the dark set, the self-hosted faces on disk, no hover-lift,
 * the cyan focus ring, print and reduced-motion blocks, flow-screen.css free of literal colour, the
 * semantic status classes. Section 3 pins the shared scripts' classed output. Section 4 is the
 * burn-down: literal colours, emoji and non-hidden inline styles per page — a metric that each
 * family commit lowers; the PASSED list turns it into a hard fail for the pages already done. */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', '..', 'dashboard') + '/';

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
/* Pictographs and dingbats. ✓ ✔ ✕ (2713–2715) are glyphs the UI keeps, not emoji. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u;
const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/g;

const STUB = 'director-recommender.html';
const PAGES = fs.readdirSync(D).filter(f => f.endsWith('.html') && !f.startsWith('_') && f !== STUB).sort();
const read = (f) => fs.readFileSync(D + f, 'utf8');

/* Pages that have had the full pass (hex → token, fallbacks stripped, chrome emoji gone). Each family
   commit appends its pages; the burn-down is a hard fail for these and a metric for the rest. */
const PASSED = ['index.html', 'change-password.html', 'email-setup.html', 'leave-request.html',
  'director-home.html', 'director-expenses.html', 'director-sales-orders.html', 'director-emails.html',
  'leadgen-home.html', 'leadgen-daily-report.html',
  // A290 — the sales family
  'dashboard.html', 'clients.html', 'pending-items.html', 'performance.html', 'quotation-summary.html', 'weekly-itinerary.html', 'sales-emails.html', 'product-finder.html',
  // A291 — the admin family
  'admin.html', 'admin-daily-report.html', 'admin-hr-reports.html', 'admin-import-quotation.html', 'admin-login-log.html', 'admin-reports.html', 'admin-summary.html',
  'admin-targets.html', 'admin-team.html', 'admin-users.html', 'pr-tracker.html', 'po-approvals.html', 'quotation-approvals.html', 'purchase-request-tracker.html',
  // A292 — accounting, the flow pages, the migration tools
  'accounting-home.html', 'accounting-billing.html', 'accounting.html', 'accounting-daily-report.html', 'accounting-summary.html',
  'flow-accounting.html', 'flow-ap-aging.html', 'flow-ar-aging.html', 'flow-clients.html', 'flow-collections.html', 'flow-commissions.html', 'flow-expenses.html',
  'flow-guide.html', 'flow-home.html', 'flow-inventory.html', 'flow-invoices.html', 'flow-ledger.html', 'flow-lifecycle.html', 'flow-other-payables.html',
  'flow-payment-requests.html', 'flow-payments.html', 'flow-pricing-request.html', 'flow-purchase-orders.html', 'flow-quotations.html', 'flow-receiving.html',
  'flow-sales-orders.html', 'flow-shipments.html', 'flow-suppliers.html', 'flow-travel.html',
  'migrate-collections.html', 'migrate-expenses.html', 'migrate-pricing.html', 'migrate-sales-orders.html', 'migrate-so-costs.html', 'reconcile-2026-costs.html',
  'replace-2026-sos.html', 'update-2025-costs.html', 'supplier-quotation.html', 'payment-requests.html', 'sales-orders.html', 'mi-queue.html', 'mro-queue.html',
  'pricing-submissions.html', 'quotation-board.html',
  // A293 — management
  'management-home.html', 'management-leave.html', 'management-sales-orders.html', 'management-itinerary.html', 'pricing.html',
  // A294 — marketing and HR
  'marketing-home.html', 'hr-home.html', 'hr-accreditations.html', 'hr-analytics.html', 'hr-campaigns.html', 'hr-content-calendar.html', 'hr-daily-report.html',
  'hr-employees.html', 'hr-grievances.html', 'hr-leave.html', 'hr-memos.html', 'hr-recruitment.html', 'hr-reviews.html', 'hr-tasks.html', 'hr-training.html',
  'marketing-daily-report.html',
  // A295 — reports, settings, the orphans
  'all-daily-reports.html', 'ap-aging-monthly.html', 'balance-sheet.html', 'client-tracker.html', 'commission-payout-report.html', 'commission-rates.html',
  'director-banks.html', 'director-duties.html', 'director-payables.html', 'my-reports.html', 'pf-admin.html', 'report.html', 'team-performance.html',
  // A297 — the accounting financial reports
  'financial-reports.html', 'my-payslips.html', 'scan.html', 'labels.html'];

/* ── 1 · every page ───────────────────────────────────────────────────────────────────────────── */
sec('1 · every page (' + PAGES.length + ')');
{
  const bad = { first: [], once: [], skin: [], theme: [], fonts: [], flowScreen: [] };
  PAGES.forEach(f => {
    const h = read(f);
    const links = (h.match(/<link rel="stylesheet" href="css\/([^"]+)"/g) || []).map(s => s.match(/css\/([^"]+)/)[1]);
    if (links[0] !== 'styles.css') bad.first.push(f);
    if (links.filter(l => l === 'styles.css').length !== 1) bad.once.push(f);
    if (/bento-skin/.test(h)) bad.skin.push(f);
    if (!/<body[^>]*>\s*<script src="js\/theme\.js"><\/script>/.test(h)) bad.theme.push(f);
    if (/fonts\.googleapis/.test(h)) bad.fonts.push(f);
    if (/flow-screen\.css/.test(h) !== /<body class="[^"]*\bflow-screen\b/.test(h)) bad.flowScreen.push(f);
  });
  ok('styles.css is the first stylesheet on every page', bad.first.length === 0, bad.first);
  ok('  and linked exactly once', bad.once.length === 0, bad.once);
  ok('no page links a bento skin', bad.skin.length === 0, bad.skin);
  ok('js/theme.js is the first child of <body> on every page', bad.theme.length === 0, bad.theme);
  ok('no page imports Google Fonts itself (styles.css does, once)', bad.fonts.length === 0, bad.fonts);
  ok('flow-screen.css is linked exactly by the body.flow-screen pages', bad.flowScreen.length === 0, bad.flowScreen);
  ok('the three skins are gone from disk', !['bento-skin.css', 'bento-skin-v2.css', 'bento-skin-director.css'].some(f => fs.existsSync(D + 'css/' + f)));
  ok('director-theme.js is gone (theme.js replaced it)', !fs.existsSync(D + 'js/director-theme.js') && fs.existsSync(D + 'js/theme.js'));
}

/* ── 2 · the shared sheets ────────────────────────────────────────────────────────────────────── */
sec('2 · the shared sheets');
{
  const S = read('css/styles.css'), F = read('css/flow.css'), FS = read('css/flow-screen.css');
  ok('styles.css carries the light set on :root and the dark set on html[data-theme="dark"]', /:root \{[\s\S]*--hx-navy:#2E3192/.test(S) && /html\[data-theme="dark"\] \{/.test(S));
  ok('  the old app names are aliases of hx tokens', /--accent:var\(--hx-navy\)/.test(S) && /--bg-card:var\(--hx-card\)/.test(S) && /--border:var\(--hx-hair\)/.test(S) && /--text-primary:var\(--hx-ink\)/.test(S));
  const faces = S.match(/@font-face\s*\{[^}]*\}/g) || [];
  ok('  A301: four self-hosted WOFF2 faces (Inter latin + latin-ext, Archivo 800 + 700), all on disk', faces.length === 4 && faces.every(f => { const u = (f.match(/url\('\/static\/fonts\/([^']+\.woff2)'\)/) || [])[1]; return u && fs.existsSync(path.join(__dirname, '../../static/fonts/' + u)); }), faces.map(f => (f.match(/url\('([^']+)'\)/) || [])[1]));
  ok('  no Google Fonts import anywhere in the shared sheets', ![S, F, FS].some(c => /fonts\.googleapis/.test(c)));
  ok('  no hover-lift anywhere in the base or the flow sheets', ![S, F, FS].some(c => /:hover[^{]*\{[^}]*translateY\(-/.test(c)));
  ok('  the focus ring is cyan', /:focus-visible \{ outline: 2px solid var\(--hx-cyan\)/.test(S));
  ok('  print and reduced-motion blocks', /@media print/.test(S) && /@media \(prefers-reduced-motion: reduce\)/.test(S));
  ok('  the aurora, the glass, the deck and the modal exist', /body::before \{/.test(S) && /\.hx-glass/.test(S) && /\.hx-rail \{/.test(S) && /\.modal-overlay\.open/.test(S));
  ok('  the navbar bell, dropdown and toggle are classed', /\.notif-badge \{/.test(S) && /\.notif-dropdown \{/.test(S) && /\.theme-toggle \{/.test(S) && /\.fa-row \{/.test(S));
  const fsLits = (FS.replace(/\/\*[\s\S]*?\*\//g, '').match(HEX) || []).filter(h => !/^#f{3}(f{3})?$/i.test(h));
  ok('flow-screen.css has no literal colour left (white on navy allowed)', fsLits.length === 0, fsLits.slice(0, 8));
  ok('flow.css defines the semantic status map', ['b-draft', 'b-pending', 'b-approved', 'b-paid', 'b-rejected', 'b-lost', 'b-sent', 'b-needs-you', 'b-no-plan', 'b-idle'].every(c => new RegExp('\\.' + c + '\\b').test(F)));
  ok('  and .flow-msg.ok / .bad', /\.flow-msg\.ok/.test(F) && /\.flow-msg\.bad/.test(F));
  ['daily-reports.css', 'pnl-report.css', 'training-mode.css'].forEach(f => {
    const c = read('css/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
    ok(f + ' carries no dark-era fallback and no slate/indigo/teal literal', !/var\(--[\w-]+,\s*#/.test(c) && !/#1e293b|#334155|#0f172a|#4f46e5|#0f766e|#0d9488/i.test(c));
  });
}

/* ── 3 · the shared scripts ───────────────────────────────────────────────────────────────────── */
sec('3 · the shared scripts');
{
  const A = read('js/auth.js'), X = read('js/flow-api.js'), TH = read('js/theme.js');
  ok('auth.js renders the bell, badge and dropdown with classes, and the theme toggle', /class="notif-badge" id="notifBadge" style="display:none;"/.test(A) && /class="notif-dropdown" id="notifDropdown" style="display:none;"/.test(A) && /class="theme-toggle nav-theme" id="navThemeToggle"/.test(A));
  ok('  the action strip is classed rows on a tone', /class="fa-row" data-tone=/.test(A) && /class="fa-empty"/.test(A) && !/>→</.test(A));
  ok('  action items carry a tone, never a hex colour', /const add = \(icon, tone, text, link\)/.test(A) && !/add\('\w+', '#/.test(A) && !/#ef4444/.test(A));
  ok('  the navbar labels the commission pages "SOON" still (commission-hold.js pins them)', /Commission Requests/.test(A) && /flowSoonTag\(\)/.test(A));
  ok('flow-api.js: flowMsg writes classes, flowSoonTag a class, the banners classed', /classList\.add\(ok \? 'ok' : 'bad'\)/.test(X) && /class="soon-tag"/.test(X) && /class="flow-banner bad"/.test(X) && /class="flow-soon"/.test(X));
  ok('  flowComingSoonHtml keeps its wording', /— coming soon/.test(X));
  ok('theme.js sets html and body, validates storage, keeps the director key, wires .theme-toggle by delegation', /setAttr\(document\.documentElement, t\)/.test(TH) && /setAttr\(document\.body, t\)/.test(TH) && /v === 'dark' \|\| v === 'light'/.test(TH) && /'dh_theme'/.test(TH) && /closest\('\.theme-toggle'\)/.test(TH) && /getElementById\('themeToggle'\)/.test(TH));
  const D_CSS = read('css/director.css'), L_CSS = read('css/leadgen.css');
  ok('director.css and leadgen.css hook the classed strip, not inline hex', /body\.dh \.fa-row/.test(D_CSS) && !/#flowActionCenter a \{/.test(D_CSS) && /body\.lg \.fa-row/.test(L_CSS) && !/#flowActionCenter a \{/.test(L_CSS));
  ok('leadgen.css carries a dark set now that the toggle reaches it', /body\.lg\[data-theme="dark"\] \{/.test(L_CSS));
}

/* ── 4 · the burn-down ────────────────────────────────────────────────────────────────────────── */
sec('4 · the burn-down (hard for PASSED pages, a metric for the rest)');
{
  let hex = 0, emoji = 0, notHidden = 0, dark = 0; const hard = [];
  PAGES.forEach(f => {
    const h = read(f);
    const blocks = (h.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n');
    const attrs = h.match(/style="[^"]*"/g) || [];
    const hx = (blocks.match(HEX) || []).length + (attrs.join(' ').match(HEX) || []).length;
    const em = (h.match(new RegExp(EMOJI.source, 'gu')) || []).length;
    const nh = attrs.filter(s => !/^style="\s*display\s*:\s*none;?\s*"$/.test(s)).length;
    const dk = ((blocks + attrs.join(' ')).match(/#1e293b|#334155|#0f172a/gi) || []).length;
    hex += hx; emoji += em; notHidden += nh; dark += dk;
    if ((hx || em || dk)) hard.push({ f, hx, em, dk });
  });
  console.log('     metric: literal colours in style blocks/attrs = ' + hex + ', emoji = ' + emoji + ', non-hidden inline styles = ' + notHidden + ', dark-era literals = ' + dark);
  // A295 — every page is done, so the burn-down is a hard fail for all of them (PASSED stays as the record of the order).
  ok('every page (' + PAGES.length + ') carries no literal colour, emoji or dark-era literal', hard.length === 0, hard);
  ok('  and PASSED lists every page', PAGES.every(f => PASSED.includes(f)), PAGES.filter(f => !PASSED.includes(f)));
}

/* ── 5 · the scripts ──────────────────────────────────────────────────────────────────────────── */
sec('5 · the scripts (chrome emoji is a hard fail; hex is a metric — two writers are pinned inline)');
{
  /* ✓ ✔ ✕ ✉ ✎ ⚠ ▸ ▾ ▲ ▼ are glyphs the UI keeps; everything else in the pictograph and dingbat blocks is emoji. */
  const EMOJI_JS = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{269F}\u{26A1}-\u{2708}\u{270A}-\u{270D}\u{270F}-\u{2712}\u{2716}-\u{27BF}]/u;
  const JS_FILES = fs.readdirSync(D + 'js').filter(f => f.endsWith('.js')).sort();
  const withEmoji = JS_FILES.filter(f => EMOJI_JS.test(read('js/' + f)));
  ok('no script emits chrome emoji', withEmoji.length === 0, withEmoji);
  const PINNED = ['report-render.js', 'flow-ap-aging.js', 'report-pdf.js'];   // report-render and the AP banner are pinned by tests; report-pdf paints a PDF
  let hexJs = 0; const per = [];
  JS_FILES.forEach(f => { if (PINNED.includes(f)) return; const n = (read('js/' + f).match(/#[0-9a-fA-F]{6}\b/g) || []).length; if (n) { hexJs += n; per.push(f + ':' + n); } });
  console.log('     metric: hex colours in scripts (unpinned) = ' + hexJs + ' in ' + per.length + ' files' + (per.length ? ' — ' + per.slice(0, 12).join(', ') : ''));
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
