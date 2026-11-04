/* A393 — the follow-up guide in the browser: the model (groups, lines, the week strip), the card on the rep's home, the
 * week page, the director's and management's card, the daily report's "Log call" links, the menus and the styles.
 * The reply the card draws comes from the REAL FlowAPI.gs (gasload), so the page and the store cannot drift apart.
 *
 * Run:  node tests/flow/follow-up-guide-page.js
 */
const fs = require('fs');
const path = require('path');
const { page } = require('./pageload');
const { load, call } = require('./gasload');
const M = require('../../dashboard/js/follow-up-guide-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
const read = (f) => fs.readFileSync(D + f, 'utf8');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const who = (role, name) => ({ role, name: name || 'Gerald Lucena', username: role + '1' });

/* a real guide: Gerald on Wednesday 4 Nov 2026, two clients a day */
function guide(user, actor) {
  const Dt = (m, d, h) => new Date(2026, m - 1, d, h || 10);
  const cos = ['Alpha Power <b>Corp</b>', 'Bravo Cement', 'Charlie Mining', 'Delta Steel', 'Echo Shipyard', 'Foxtrot Hydro'];
  const store = {
    FlowSettings: [{ 'Key': 'followUpPerDay', 'Value': 2 }],
    ClientBook: cos.map((co, i) => ({ 'Client No': 'CB-' + (i + 1), 'Company': co, 'Owner': 'Gerald Lucena', 'Archived At': '' })),
    Quotations: [{ 'Quotation No': 'Q1', 'Customer': 'Charlie Mining', 'Status': 'Sent', 'Total': 245000, 'Salesperson': 'Gerald Lucena', 'Sent At': Dt(10, 28), 'Created At': Dt(9, 1) }],
    ClientBookLog: [{ 'Client No': 'CB-1', 'Kind': 'status', 'By': 'Gerald Lucena', 'At': Dt(11, 2, 9) }],
    SalesOrders: [], PricingRequests: [], ClientBookLinks: [], ProofReports: [], QuotationEmails: [], VisitPlans: [], SalesCalls: [], ClientVisits: []
  };
  const c = load(GS, store);
  c._now = () => Dt(11, 4, 10);
  call(c, 'setFollowUpPlan', { owner: 'Gerald Lucena', items: cos.map((_, i) => ({ rank: i + 1, clientNo: 'CB-' + (i + 1), nextStep: i === 3 ? 'Ask "Q4" & the outage list' : '' })), actorRole: 'director', actorName: 'Neil Estur' });
  return call(c, 'getFollowUpGuide', Object.assign(user ? { user } : {}, actor || { actorRole: 'sales', actorName: 'Gerald Lucena', actorUsername: 'sales2' }));
}

(async () => {
  const G = guide();
  sec('1 · the model');
  ok('the reply is a real guide (Wednesday, 6 clients, Q1 quoted)', G.success && G.today === '2026-11-04' && G.live === 6 && G.summary.quoted === 1, G.summary);
  ok('day labels and money', M.fugDayLabel('2026-11-04') === 'Wed 4 Nov' && M.fugShort('2026-10-28') === '28 Oct' && M.fugMoney(245000) === '₱245,000');
  ok('the ranks a weekday holds', M.fugRanks(G, 0) === 'ranks 1–2' && M.fugRanks(G, 2) === 'ranks 5–6' && M.fugRanks(G, 4) === '');
  ok('the day shown first is today', M.fugDefaultDay(G) === '2026-11-04');
  const gr = M.fugGroups(G, '2026-11-04');
  ok('Wednesday: the quotation first, then what is still open from earlier, then today\'s clients', gr.map(x => x.key).join() === 'quotes,carry,clients', gr.map(x => x.key));
  ok('  Q1 is due (day 7), with its value and sent date', gr[0].items[0].quotationNo === 'Q1' && /^Day 7 · ₱245,000 · sent 28 Oct$/.test(M.fugLine(gr[0].items[0], G.today)), M.fugLine(gr[0].items[0], G.today));
  ok('  carried: rank 2 (Monday) and 4 (Tuesday; 3 is quoted), each "Open since …"', gr[1].items.map(x => x.rank).join() === '2,4' && M.fugLine(gr[1].items[1], G.today) === 'Open since Tue · Ask "Q4" & the outage list');
  const mon = M.fugGroups(G, '2026-11-02');
  const r1 = mon.find(x => x.key === 'clients').items.find(x => x.rank === 1);
  ok('Monday: rank 1 done by a Client Book change, at its time, and sunk below the open one', r1.status === 'done' && M.fugLine(r1, G.today) === 'Done · Client updated · Mon · 9:00 AM' &&
     mon.find(x => x.key === 'clients').items.map(x => x.rank).join() === '2,1', M.fugLine(r1, G.today));
  const rows = M.fugGroupsHtml(gr, G.today, {});
  ok('rows escape what the reps typed', !/<b>Corp<\/b>/.test(M.fugGroupsHtml(mon, G.today, {})) && /Alpha Power &lt;b&gt;Corp&lt;\/b&gt;/.test(M.fugGroupsHtml(mon, G.today, {})) && /Ask &quot;Q4&quot; &amp; the outage list/.test(rows));
  ok('an open quotation offers Log call (the call form, linked) and Update (Quotation status)', /href="my-daily-report\.html\?call=Q1">Log call/.test(rows) && /href="quotation-status\.html\?q=Q1">Update/.test(rows));
  ok('an open client offers Log call and Open (the Client Book)', /href="my-daily-report\.html\?client=CB-2">Log call/.test(rows) && /href="director-client-book\.html\?client=CB-2">Open/.test(rows));
  ok('read only: no buttons at all', !/fg-btn/.test(M.fugGroupsHtml(gr, G.today, { readOnly: true })));
  const folded = M.fugGroupsHtml(mon, G.today, { foldDone: true });
  ok('the home folds a group\'s done rows into one line ("1 done · Alpha …"); the page lists each', /class="fg-row done fg-fold"[\s\S]*1 done · Alpha Power &lt;b&gt;Corp&lt;\/b&gt;/.test(folded) &&
     !/aria-label="#1 Alpha/.test(folded) && /aria-label="#1 Alpha/.test(M.fugGroupsHtml(mon, G.today, {})));
  const strip = M.fugStripHtml(G, '2026-11-04');
  ok('the week strip: five tabs, today selected and focusable, each with done of total', (strip.match(/role="tab"/g) || []).length === 5 && /data-day="2026-11-04" aria-selected="true" tabindex="0"/.test(strip) &&
     /class="fg-day now"/.test(strip) && /aria-label="Wednesday 4 Nov, 0 of 5 done"/.test(strip), strip.slice(0, 400));
  ok('the subtitle: the day and its ranks', M.fugSubtitle(G, '2026-11-04', true) === 'Wednesday · ranks 5–6 of your top 6' && M.fugSubtitle(G, '2026-11-02', false) === 'Mon 2 Nov · ranks 1–2 of the top 6');

  sec('2 · the card on the rep\'s home');
  const card = (role, answer, html, search) => {
    const p = page(['js/follow-up-guide-model.js', 'js/follow-up-guide-card.js'], html || 'dashboard.html', who(role));
    p.ctx.__answer = answer;
    if (search) p.ctx.location.search = search;
    p.run('postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); return Promise.resolve(__answer || { success: false, message: "Unknown action: " + a }); };' +
          'getSession = function () { return __session; };');
    return p;
  };
  const c = card('sales', G);
  await c.boot();
  const h = c.els.followUpGuide.innerHTML;
  ok('a rep\'s home: one read, the card shown with today\'s title and count', c.calls.join() === 'POST:getFollowUpGuide' && JSON.stringify(c.paramsFor('getFollowUpGuide')) === '{}' &&
     c.els.followUpGuide.style.display === '' && /<h3>Today&#39;s follow-ups<\/h3>/.test(h) && /<b>0<\/b> of 5 done/.test(h), h.slice(0, 300));
  ok('  the groups, the week line and the way to the week page', /Quotations to follow up/.test(h) && /Still open from earlier this week/.test(h) && /This week: 1 of 6 clients followed up · 1 quotation follow-up due/.test(h) && /href="follow-up-guide\.html">See the week/.test(h));
  ok('  a live region carries the count', /class="fg-count" role="status" aria-live="polite"/.test(h));
  const old = card('sales', null);
  await old.boot();
  ok('hidden before FlowAPI 196', old.els.followUpGuide.style.display === 'none');
  const empty = card('sales', Object.assign({}, G, { live: 0 }));
  await empty.boot();
  ok('hidden for a rep with no plan', empty.els.followUpGuide.style.display === 'none');
  const dir = card('director', G);
  await dir.boot();
  ok('not on anyone else\'s home (the director)', dir.calls.length === 0);
  ok('dashboard.html: the card sits right after Needs you, hidden until filled, with its stylesheet and two scripts',
     /<section class="hx-glass" id="inbox">[\s\S]*?<\/section>\s*<!--[^>]*-->\s*<section class="hx-glass" id="followUpGuide" style="display:none;"><\/section>/.test(read('dashboard.html')) &&
     /css\/follow-up-guide\.css/.test(read('dashboard.html')) && /js\/shutdowns-card\.js[\s\S]*js\/follow-up-guide-model\.js[\s\S]*js\/follow-up-guide-card\.js[\s\S]*js\/auth\.js/.test(read('dashboard.html')));

  sec('2b · A394: drawn at once from this browser\'s last copy');
  const cached = (answer, copy) => {
    const p = card('sales', answer);
    p.run('flowToday = function () { return "2026-11-04"; };');
    p.ctx.__copy = copy;
    p.run('localStorage = { getItem: function (k) { return /^hx_fug1:/.test(k) ? (__copy ? JSON.stringify(__copy) : null) : JSON.stringify(__session); }, setItem: function (k, v) { __saved = [k, v]; }, removeItem: function () {} }; __saved = null;');
    return p;
  };
  const slow = cached(null, G);
  slow.run('postFlow = function () { return new Promise(function () {}); };');
  await slow.boot();
  ok('today\'s copy is drawn before the read answers, marked "Updating…"', slow.els.followUpGuide.style.display === '' && /<b>0<\/b> of 5 done/.test(slow.els.followUpGuide.innerHTML) &&
     /<span class="fg-sync">Updating…<\/span>/.test(slow.els.followUpGuide.innerHTML), slow.els.followUpGuide.innerHTML.slice(0, 200));
  const fresh = cached(G, G);
  await fresh.boot(); await new Promise(r => setImmediate(r));
  ok('  the fresh read replaces it (no "Updating…") and is kept for next time', !/fg-sync/.test(fresh.els.followUpGuide.innerHTML) && fresh.ctx.__saved && /^hx_fug1:sales1:me$/.test(fresh.ctx.__saved[0]), fresh.ctx.__saved && fresh.ctx.__saved[0]);
  const failed = cached({ success: false, message: 'Read timed out' }, G);
  await failed.boot(); await new Promise(r => setImmediate(r));
  ok('  a failed refresh keeps what is on screen', failed.els.followUpGuide.style.display === '' && /Today&#39;s follow-ups/.test(failed.els.followUpGuide.innerHTML) && !/fg-sync/.test(failed.els.followUpGuide.innerHTML));
  const old2 = cached(null, Object.assign({}, G, { today: '2026-11-03' }));
  old2.run('postFlow = function () { return new Promise(function () {}); };');
  await old2.boot();
  ok('  yesterday\'s copy is not used', old2.els.followUpGuide.style.display === 'none');

  sec('3 · the week page');
  const GD = guide('Gerald Lucena', { actorRole: 'director', actorName: 'Neil Estur', actorUsername: 'neil' });
  const pg = card('director', GD, 'follow-up-guide.html', '?user=Gerald%20Lucena');
  pg.run('URLSearchParams = function () { return { get: function (k) { return k === "user" ? "Gerald Lucena" : null; } }; };');
  pg.els.followUpGuide.getAttribute = (k) => (k === 'data-mode' ? 'page' : null);
  await pg.boot();
  const ph = pg.els.followUpGuide.innerHTML;
  ok('the director reads Gerald\'s week, read only: his name, the rep picker, no buttons', JSON.stringify(pg.paramsFor('getFollowUpGuide')) === '{"user":"Gerald Lucena"}' &&
     /Gerald Lucena&#39;s follow-ups/.test(ph) && /<select id="fgUser"><option selected>Gerald Lucena<\/option><\/select>/.test(ph) && !/fg-btn/.test(ph), ph.slice(0, 400));
  ok('  the top 6 this week, each with its day and where it stands', /The top 6 this week/.test(ph) && /<td class="n">3<\/td><td>Charlie Mining<\/td><td>Quoted<\/td>/.test(ph) && /<tr class="done"><td class="n">1<\/td>/.test(ph));
  ok('  and no "See the week" link on the week itself', !/See the week/.test(ph));
  const html = read('follow-up-guide.html');
  ok('the page: its guard and navbar script, the card in page mode, a skeleton while it loads', /<section class="fgp-card" id="followUpGuide" data-mode="page">\s*<div class="fg-skel"/.test(html) &&
     /js\/follow-up-guide-model\.js[\s\S]*js\/follow-up-guide-card\.js[\s\S]*js\/follow-up-guide\.js/.test(html) && /requireFollowUpGuideAccess\(\)/.test(read('js/follow-up-guide.js')) && /renderNavbar\('follow-up-guide'\)/.test(read('js/follow-up-guide.js')));
  const auth = read('js/auth.js'), nav = read('js/ledger-nav.js');
  ok('the guard admits sales, the director and management', /const FLOW_FOLLOW_UP_ROLES = \['sales', 'director', 'management'\];/.test(auth));
  ok('the classic navbar links it for sales (Clients), the director (Team) and management', (auth.match(/href="follow-up-guide\.html"/g) || []).length === 3 && (auth.match(/'follow-up-guide'\]/g) || []).length + (auth.match(/'follow-up-guide'\]\.includes/g) || []).length >= 3);
  ok('the Apple sidebar links it for the same three', (nav.match(/\['follow-up-guide\.html', 'Follow-up guide'\]/g) || []).length === 3);

  sec('4 · the director\'s and management\'s card');
  const all = guide('', { actorRole: 'management', actorName: 'Larry Estur', actorUsername: 'mgmt' });
  const allReply = (() => {
    const Dt = (m, d, h) => new Date(2026, m - 1, d, h || 10);
    const st = { ClientBook: [{ 'Client No': 'CB-1', 'Company': 'Alpha', 'Owner': 'Gerald Lucena', 'Archived At': '' }, { 'Client No': 'CB-9', 'Company': 'Kilo', 'Owner': 'Kimberlyn Blones', 'Archived At': '' }] };
    const c = load(GS, st); c._now = () => Dt(11, 4);
    call(c, 'setFollowUpPlan', { owner: 'Gerald Lucena', items: [{ rank: 1, clientNo: 'CB-1' }], actorRole: 'director', actorName: 'Neil Estur' });
    call(c, 'setFollowUpPlan', { owner: 'Kimberlyn Blones', items: [{ rank: 1, clientNo: 'CB-9' }], actorRole: 'director', actorName: 'Neil Estur' });
    return call(c, 'getFollowUpGuide', { all: true, actorRole: 'director', actorName: 'Neil Estur' });
  })();
  ok('getFollowUpGuide {all} gives one summary per rep', allReply.success && allReply.people.map(p => p.user).join() === 'Gerald Lucena,Kimberlyn Blones' && all.success, allReply);
  for (const [role, file] of [['director', 'director-home.html'], ['management', 'management-home.html']]) {
    const t = page(['js/follow-up-team-card.js'], file, who(role, 'Neil Estur'));
    t.ctx.__answer = allReply;
    t.run('postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); return Promise.resolve(__answer); }; getSession = function () { return __session; };');
    await t.boot();
    const th = t.els.followUpTeam.innerHTML;
    ok(file + ': one read for all, one row per rep opening their week', JSON.stringify(t.paramsFor('getFollowUpGuide')) === '{"all":true}' && t.els.followUpTeam.style.display === '' &&
       /href="follow-up-guide\.html\?user=Gerald%20Lucena"/.test(th) && /href="follow-up-guide\.html\?user=Kimberlyn%20Blones"/.test(th) && /Follow-ups this week/.test(th), th.slice(0, 300));
  }
  const tc = page(['js/follow-up-team-card.js'], 'director-home.html', who('director', 'Neil Estur'));
  tc.ctx.__copy = { today: '2026-11-04', people: allReply.people };
  tc.run('flowToday = function () { return "2026-11-04"; }; getSession = function () { return __session; }; postFlow = function () { return new Promise(function () {}); };' +
         'localStorage = { getItem: function (k) { return /^hx_fut1:/.test(k) ? JSON.stringify(__copy) : JSON.stringify(__session); }, setItem: function () {}, removeItem: function () {} };');
  await tc.boot();
  ok('A394: the director\'s card is drawn at once from this browser\'s last copy', tc.els.followUpTeam.style.display === '' && /Gerald Lucena/.test(tc.els.followUpTeam.innerHTML));
  const t0 = page(['js/follow-up-team-card.js'], 'director-home.html', who('director', 'Neil Estur'));
  t0.run('postFlow = function () { return Promise.resolve({ success: false, message: "Unknown action: getFollowUpGuide" }); }; getSession = function () { return __session; };');
  await t0.boot();
  ok('  hidden before FlowAPI 196', t0.els.followUpTeam.style.display === 'none');
  const t1 = page(['js/follow-up-team-card.js'], 'director-home.html', who('sales'));
  t1.run('getSession = function () { return __session; };');
  await t1.boot();
  ok('  and never for a rep', t1.calls.length === 0);

  sec('5 · the daily report\'s Log call, the styles');
  const sr = read('js/sales-report.js'), mdr = read('js/my-daily-report.js');
  ok('my-daily-report.html?call= / ?client= opens the call form, filled in (srOpenCallFor)', /function srOpenCallFor\(o\)/.test(sr) && /_srPrefillCall\(qno\)/.test(sr) && /srOpenCallFor\(\{ quotationNo: qno, clientNo: cno \}\)/.test(mdr));
  const css = read('css/follow-up-guide.css');
  ok('every card rule hangs off .fg (page rules off body.fgp)', css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.split('{')[0].trim()).filter(s => s && !/^@|^from|^to|^50%/.test(s))
     .every(sel => sel.split(',').every(x => /^\s*(\.fg\b|body\.fgp|html\[data-motion="off"\] \.fg)/.test(x))), css.slice(0, 0));
  ok('tokens only: no colour but #fff', !/#(?!fff\b)[0-9a-f]{3,8}\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('the phone rule is a real phone width (the Apple shell is on at every width)', /@media screen and \(max-width: 640px\)/.test(css));
  ok('reduced motion, more contrast and print are handled', /prefers-reduced-motion: reduce/.test(css) && /prefers-contrast: more/.test(css) && /@media print/.test(css));
  ok('press feedback is a .97 scale, and the indicator keeps its element between draws', /transform: scale\(\.97\)/.test(css) && /\.fg-thumb\.now \{ transition: none; \}/.test(css) && /let th = seg\.querySelector\('\.fg-thumb'\)/.test(read('js/follow-up-guide-card.js')));

  console.log('\n' + (FAIL ? FAIL + ' of ' + N + ' FAILED' : 'all ' + N + ' passed'));
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
