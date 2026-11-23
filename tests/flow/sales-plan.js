/* A403 — the Sales plan page: its arithmetic (js/sales-plan-model.js) and its wiring (page, guard, both menus, the rep's home
 * card, the daily report's new lines).
 *
 * Run:  node tests/flow/sales-plan.js
 */
const fs = require('fs');
const path = require('path');
const M = require('../../dashboard/js/sales-plan-model.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const DASH = path.join(__dirname, '..', '..', 'dashboard');
const read = (f) => fs.readFileSync(path.join(DASH, f), 'utf8');

sec('1 · money, shares and days as the page writes them');
ok('₱25,000,000 · ₱1,234.50 · −₱5', M.spMoney(25000000) === '₱25,000,000' && M.spMoney(1234.5) === '₱1,234.50' && M.spMoney(-5) === '−₱5');
ok('₱25M · ₱2.08M · ₱600k · ₱950', M.spShort(25000000) === '₱25M' && M.spShort(2083333.33) === '₱2.08M' && M.spShort(600000) === '₱600k' && M.spShort(950) === '₱950', [M.spShort(2083333.33)]);
ok('43% · 4.5% · 100% · —', M.spPct(0.4321) === '43%' && M.spPct(0.045) === '4.5%' && M.spPct(1) === '100%' && M.spPct(null) === '—');
ok('23 Nov · 3 Jan 2027 in another year', M.spDay('2026-11-23', '2026') === '23 Nov' && M.spDay('2027-01-03', '2026') === '3 Jan 2027');

sec('2 · the KPI dashboard (the workbook\'s rules)');
const R = {
  plan: { annual: 1000000 },
  sales: [{ amount: 200000, cost: 120000, gp: 80000 }, { amount: 100000, cost: null, gp: null }],
  pipeline: [{ stage: 'Quotation', value: 100000, weighted: 40000 }, { stage: 'Lead', value: null, weighted: null }, { stage: 'Negotiation', value: 50000, weighted: 30000, archived: true },
             { stage: 'Closed Won', value: 999, weighted: 999 }],
  quotes: [{ state: 'Submitted', value: 10 }, { state: 'Won', value: 20 }, { state: 'Lost', value: 30 }, { state: 'Lost', value: 40 }, { state: 'Draft', value: 999 }],
  accounts: [{ status: 'Active', actual: 5, tier: 'A', target: 600000 }, { status: 'Prospect', actual: 0, tier: 'B', target: 300000 }, { status: 'Active', actual: 0, tier: '', target: 0 }]
};
const k = M.spKpis(R);
ok('year so far, achievement, remaining', k.ytd === 300000 && k.achievement === 0.3 && k.remaining === 700000);
ok('open pipeline: open stages only, archived and closed left out', k.openValue === 100000 && k.weighted === 40000 && k.openCount === 2 && k.coverage === 0.1);
ok('gross profit on the orders with a cost, margin on those orders\' sales', k.gp === 80000 && k.gm === 0.4 && k.costedOrders === 1);
ok('a rep\'s reply (no cost at all) has no gross profit', M.spKpis(Object.assign({}, R, { sales: [{ amount: 5 }] })).gp === null);
ok('quotations submitted (not drafts), value, win rate on decided', k.quotesSubmitted === 4 && k.quoteValue === 100 && k.decided === 3 && Math.abs(k.winRate - 1 / 3) < 1e-9);
ok('active accounts and accounts with sales', k.activeAccounts === 2 && k.accountsWithSales === 1);
const tiers = M.spTierRows(R.accounts);
ok('by tier: A, B, C and the accounts with no tier', tiers.map(t => t.label).join() === 'Tier A,Tier B,Tier C,No tier' && tiers[0].target === 600000 && tiers[3].accounts === 1);
ok('the accounts\' targets against the year', M.spAccountsTotal(R.accounts, 1000000).gap === 100000 && !M.spAccountsTotal(R.accounts, 1000000).match);

sec('3 · the months');
const months = M.spEvenSplit().map((s, i) => ({ share: s, target: 100000, actual: i === 0 ? 150000 : i === 10 ? 50000 : 0 }));
const mr = M.spMonthRows(months, 2026, '2026-11-23');
ok('an even split adds up to 100', Math.abs(M.spEvenSplit().reduce((t, x) => t + x, 0) - 100) < 1e-9);
ok('this month, past and future months', mr.rows[10].cur && mr.rows[0].past && mr.rows[11].future);
ok('variance and achievement', mr.rows[0].variance === 50000 && Math.abs(mr.rows[0].achievement - 1.5) < 1e-6);
ok('to date: the months up to this one', mr.toDate.months === 11 && Math.round(mr.toDate.target) === 1100000 && mr.toDate.achievement === 200000 / 1100000);
ok('a split that is not 100% is named', !M.spSplitCheck([10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 2, 2]).ok && /add up to 99%/.test(M.spSplitCheck([10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 2, 2]).error));
ok('a split of 12 that is 100% passes; a blank is 0', M.spSplitCheck(['50', '50', '', '', '', '', '', '', '', '', '', '']).ok);
ok('a negative share is refused', !M.spSplitCheck([-10, 110, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).ok);
const sh = M.spSharesFromAmounts(Array(12).fill('1,000,000'), 12000000);
ok('shares from pesos per month', sh.length === 12 && Math.abs(sh.reduce((t, x) => t + x, 0) - 100) < 1e-9 && M.spSharesFromAmounts([1], 0) === null);

sec('4 · filters and counts');
const accts = [{ company: 'Therma South', tier: 'A', status: 'Active', focus: 'Torque tools', contact: { name: 'Joe Cruz' } }, { company: 'Philex', tier: '', status: 'Prospect' }, { company: 'Holcim', tier: 'C', status: 'On Hold' }];
ok('by tier, no tier, status', M.spAccountsFilter(accts, { seg: 'A' }).length === 1 && M.spAccountsFilter(accts, { seg: 'none' })[0].company === 'Philex' && M.spAccountsFilter(accts, { seg: 'On Hold' }).length === 1);
ok('search across name, focus and contact', M.spAccountsFilter(accts, { q: 'joe' }).length === 1 && M.spAccountsFilter(accts, { q: 'torque' }).length === 1);
ok('chip counts', M.spAccountCounts(accts).all === 3 && M.spAccountCounts(accts).C === 1);
const pipe = [{ stage: 'Quotation', age: 120, nextActionDate: '2026-11-20', recordNo: 'Q-1', company: 'A' }, { stage: 'Negotiation', age: 5, nextActionDate: '2026-12-01', recordNo: 'Q-2', company: 'B' },
              { stage: 'Closed Won', recordNo: 'Q-3' }, { stage: 'Lead', archived: true, recordNo: 'L-1' }];
ok('open (archived and closed left out), stage, older than 90, due, won', M.spPipeFilter(pipe, { seg: 'open' }, '2026-11-23').length === 2 && M.spPipeFilter(pipe, { seg: 'old' }, '2026-11-23')[0].recordNo === 'Q-1'
   && M.spPipeFilter(pipe, { seg: 'due' }, '2026-11-23').length === 1 && M.spPipeFilter(pipe, { seg: 'won' }, '2026-11-23').length === 1 && M.spPipeFilter(pipe, { seg: 'Lead' }, '2026-11-23').length === 0);
const st = M.spStageSummary([{ stage: 'Quotation', value: 100, weighted: 40 }, { stage: 'Technical Review', value: null, weighted: null }]);
ok('the stage strip: five open stages, unpriced counted', st.length === 5 && st[3].value === 100 && st[2].unpriced === 1);
ok('a close date passed is overdue; within 14 days soon', M.spCloseState({ stage: 'Quotation', expectedClose: '2026-11-01' }, '2026-11-23') === 'overdue' && M.spCloseState({ stage: 'Quotation', expectedClose: '2026-12-01' }, '2026-11-23') === 'soon'
   && M.spCloseState({ stage: 'Closed Won', expectedClose: '2026-11-01' }, '2026-11-23') === '');
const ac = M.spActivityCounts([{ type: 'Phone call' }, { type: 'Email', count: 12 }, { type: 'Site survey' }, { type: 'Mystery' }]);
ok('activity: an email row counts its emails; an unknown kind is an other task', ac['Phone call'] === 1 && ac.Email === 12 && ac['Site survey'] === 1 && ac['Other task'] === 1);
ok('periods: this week from Monday, this month, last month, 90 days', JSON.stringify(M.spActivityRange('week', '2026-11-26')) === '{"from":"2026-11-23","to":"2026-11-26"}'
   && M.spActivityRange('month', '2026-11-26').from === '2026-11-01' && JSON.stringify(M.spActivityRange('last', '2026-11-26')) === '{"from":"2026-10-01","to":"2026-10-31"}'
   && M.spDaysBetween(M.spActivityRange('quarter', '2026-11-26').from, '2026-11-26') === 89);

sec('5 · the rep\'s home card');
const h = M.spHomeLines({ success: true, year: 2026, plan: { annual: 12000000, set: true }, ytd: 5400000, orders: 11, months: Array.from({ length: 12 }, (_, i) => ({ target: 1000000, actual: i === 10 ? 210900 : 0 })) }, '2026-11-23');
ok('this month and the year', h.month.label === 'November' && h.month.actual === 210900 && h.year.target === 12000000 && h.year.share === 0.45);
ok('  and the target to date', h.pace.target === 11000000 && h.orders === 11 && h.set);
ok('another year: no month line', M.spHomeLines({ success: true, year: 2027, plan: { annual: 1 }, ytd: 0, months: [] }, '2026-11-23').month === null);
ok('a failed read: nothing', M.spHomeLines({ success: false }, '2026-11-23') === null);

sec('6 · wired');
const html = read('sales-plan.html'), js = read('js/sales-plan.js'), auth = read('js/auth.js'), nav = read('js/ledger-nav.js'), home = read('dashboard.html');
ok('the page: theme.js first, the model before the page script, its own stylesheet before ledger and apple',
   /<body class="flow-screen">\s*<script src="js\/theme\.js"><\/script>/.test(html) && /js\/sales-plan-model\.js[\s\S]*js\/sales-plan\.js/.test(html) && /css\/sales-plan\.css[\s\S]*css\/ledger\.css[\s\S]*css\/apple\.css/.test(html));
ok('the guard admits sales, the director and management', /const FLOW_SALES_PLAN_ROLES = \['sales', 'director', 'management'\];/.test(auth) && /requireSalesPlanAccess\(\)/.test(js) && /renderNavbar\('sales-plan'\)/.test(js));
ok('the classic navbar links it for sales, the director and management', (auth.match(/href="sales-plan\.html"/g) || []).length === 3);
ok('the Apple sidebar links it for the same three', (nav.match(/\['sales-plan\.html', 'Sales plan'\]/g) || []).length === 3);
ok('the rep\'s home: the card, hidden until read, its model and script', /id="salesPlanCard" style="display:none;"/.test(home) && /js\/sales-plan-model\.js[\s\S]*js\/sales-plan-card\.js[\s\S]*js\/auth\.js/.test(home));
ok('the page reads through the secured actions only', /postFlow\('getSalesPlan'/.test(js) && /postFlow\('getSalesActivity'/.test(js) && !/fetchFlow\(/.test(js));
ok('cost columns only when the server sends them (may.cost)', /may\.cost \?/.test(js));
ok('no confirm(): taking a lead off has an Undo', !/confirm\(/.test(js) && /hxSnackbar\('Taken off the pipeline\.', \{ action: 'Undo'/.test(js));
const css = read('css/sales-plan.css');
ok('the stylesheet: tokens only, reduced motion, reduced transparency, more contrast, phones', !/#[0-9a-fA-F]{3,6}\b/.test(css) && /prefers-reduced-motion/.test(css) && /prefers-reduced-transparency/.test(css)
   && /prefers-contrast: more/.test(css) && /max-width: 640px/.test(css));
const srm = read('js/sales-report-model.js'), sr = read('js/sales-report.js');
ok('the daily report: four new kinds, a next action on every line', /'Online meeting', 'Technical meeting', 'Site survey', 'Collection follow-up'/.test(srm) && /'nextDate', 'nextAction'/.test(srm)
   && /data-new="Meeting">\+ Meeting or survey/.test(sr) && (sr.match(/name="nextAction"/g) || []).length >= 3);

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
process.exit(FAIL ? 1 : 0);
