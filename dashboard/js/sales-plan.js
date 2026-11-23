/* sales-plan.js — A403 · the Sales plan (sales-plan.html): Neil's 2027 Individual Sales Strategy Workbook in the portal.
 *
 * Neil, 23 Nov 2026: "adapt it to the sales dashboard, specially the 50 customer accounts sheet, sales log sheet, the sales
 * pipeline sheet, daily activity sheet, check what do we have that can be auto filled on that and make it easy to fill up …
 * check also the monthly sales target sheet on where we can put that". One page, five tabs, one read (getSalesPlan,
 * FlowAPI 202) that arrives filled in: the accounts from the Client Book and the follow-up ranks, the sales from the sales
 * orders, the pipeline from the quotations and purchase requests, the activity from the daily reports. What a rep types is
 * only what the portal cannot know: a tier, a target or a focus that differs, a stage, odds or a close date that differ, a
 * lead not yet in the portal. The director and management set the year target and its month split, and see every rep.
 *
 * Built to the apple-design skill: a large title, the year's number as the hero, a segmented control whose indicator slides
 * and is never rebuilt, sheets that rise from the row that opened them (bottom sheets on a phone), feedback on press,
 * validation as you type, Undo instead of a confirm, the last copy drawn at once while the fresh read runs. The arithmetic
 * is js/sales-plan-model.js. */

const SP = { me: '', role: '', user: '', year: 0, tab: 'plan', data: null, team: null, stale: false, key: '', busy: false,
             f: { acc: { q: '', seg: 'all' }, pipe: { q: '', seg: 'open' }, sale: { month: 0 }, act: { range: 'month', type: '' } },
             act: null, actKey: '', back: null, over: false };
const SP_TABS = [['plan', 'Plan'], ['accounts', 'Accounts'], ['sales', 'Sales log'], ['pipeline', 'Pipeline'], ['activity', 'Activity']];

function _spE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function _spId(id) { return document.getElementById(id); }
function _spFail(e) { return { success: false, message: String(e && e.message || e) }; }
function _spToast(text, tone) { if (typeof window.hxToast === 'function') window.hxToast(text, { tone: tone || 'ok' }); }
function _spToday() { return (SP.data && SP.data.today) || (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10)); }
function _spQs(k) { try { return new URLSearchParams(location.search || '').get(k) || ''; } catch (e) { return ''; } }
function _spFirst(name) { return String(name || '').split(' ')[0] || name; }
function _spOwn() { return !SP.user || SP.user.toLowerCase() === SP.me.toLowerCase(); }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireSalesPlanAccess === 'function' ? requireSalesPlanAccess() : null;   // sales (their own), the director, management
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('sales-plan');
  if (typeof hxDatePill === 'function') hxDatePill('long');
  SP.me = String(s.name || s.username || '').trim();
  SP.role = String(s.role || '').toLowerCase();
  SP.over = SP.role === 'director' || SP.role === 'management';
  SP.user = SP.over ? (_spQs('user') || spLastRep()) : '';
  const y = parseInt(_spQs('year'), 10), cy = parseInt(_spToday().slice(0, 4), 10);
  SP.year = y >= 2024 && y <= cy + 1 ? y : cy;
  const t = _spQs('tab');
  if (SP_TABS.some(x => x[0] === t)) SP.tab = t;
  spWire();
  spDrawHead();
  /* the director and management open on a rep: the one they looked at last, else the first of the team */
  if (SP.over && !SP.user) {
    _spId('spBody').innerHTML = spSkeleton();
    await spLoadTeam();
    SP.user = SP.team && SP.team.people.length ? SP.team.people[0].user : '';
    spDrawHead(); spDrawTeam();
  }
  const c = spFromCache();
  if (c) { SP.data = c; SP.stale = true; spDraw(); }
  else _spId('spBody').innerHTML = spSkeleton();
  await Promise.all([spLoad(), SP.over && !SP.team ? spLoadTeam() : Promise.resolve()]);
});
/** The rep the director or management looked at last (a per-viewer convenience: storage may fail). */
function spLastRep() { try { return localStorage.getItem('hx_sp_rep:' + SP.me) || ''; } catch (e) { return ''; } }
function spKeepRep() { try { if (SP.over && SP.user) localStorage.setItem('hx_sp_rep:' + SP.me, SP.user); } catch (e) { /* fine */ } }

/* ── load: one read, drawn at once from this browser's last copy (today's only) ─────────────────── */

function spCacheKey() { return 'hx_sp1:' + SP.me + ':' + (SP.user || 'me') + ':' + SP.year; }
function spFromCache() {
  try { const c = JSON.parse(localStorage.getItem(spCacheKey()) || 'null'); return c && c.success && c.today === (typeof flowToday === 'function' ? flowToday() : '') && Array.isArray(c.accounts) ? c : null; }
  catch (e) { return null; }
}
function spToCache(r) { try { localStorage.setItem(spCacheKey(), JSON.stringify(r)); } catch (e) { /* storage full or blocked: fine */ } }
function spSkeleton() {
  return '<div class="sp-skel" aria-hidden="true"><span class="sp-sk big"></span><span class="sp-sk bar"></span>' +
    Array.from({ length: 6 }, () => '<span class="sp-sk row"></span>').join('') + '</div><p class="sp-sr" role="status">Reading the plan…</p>';
}
async function spLoad() {
  const params = { year: SP.year };
  if (SP.over && SP.user) params.user = SP.user;
  const r = await postFlow('getSalesPlan', params).catch(_spFail);
  SP.stale = false;
  if (!(r && r.success)) {
    if (SP.data) { spDraw(); _spToast(r && r.message ? 'Could not refresh: ' + r.message : 'Could not refresh the plan.', 'warn'); return; }
    _spId('spBody').innerHTML = '<div class="sp-notice bad">' + _spE(r && r.message ? r.message : 'The plan could not be read.') +
      (/not a secured action|getSalesPlan/.test(String(r && r.message)) ? ' The sales plan needs FlowAPI 202.' : '') + '</div>';
    return;
  }
  SP.data = r;
  if (SP.over && !SP.user) SP.user = r.user;
  spKeepRep();
  spToCache(r);
  spDrawHead();
  spDraw();
}
async function spLoadTeam() {
  const r = await postFlow('getSalesPlan', { year: SP.year, all: true }).catch(_spFail);
  if (!(r && r.success && r.all)) { SP.team = null; spDrawTeam(); return; }
  SP.team = r;
  spDrawHead();
  spDrawTeam();
}
async function spReload(withTeam) {
  SP.act = null; SP.actKey = '';
  await Promise.all([spLoad(), withTeam && SP.over ? spLoadTeam() : Promise.resolve()]);
}

/* ── the head: title, the rep and the year, the download ─────────────────────────────────────────── */

function spDrawHead() {
  const d = SP.data, own = _spOwn() && !SP.over, who = SP.user || (d && d.user) || SP.me;
  _spId('spTitle').textContent = own ? 'Sales plan' : (SP.over ? _spFirst(who) + '\'s sales plan' : 'Sales plan');
  _spId('spLede').textContent = own
    ? 'Your ' + SP.year + ' target, accounts, sales, pipeline and activity — filled in from the portal. Change only what it cannot know.'
    : who + '\'s ' + SP.year + ' target, accounts, sales, pipeline and activity, filled in from the portal.';
  const cy = parseInt(_spToday().slice(0, 4), 10), years = [cy - 1, cy, cy + 1];
  const people = (d && d.people && d.people.length ? d.people : (SP.team ? SP.team.people.map(p => p.user) : [])).slice();
  if (who && people.indexOf(who) < 0 && SP.over) people.unshift(who);
  _spId('spControls').innerHTML =
    (SP.over && people.length ? '<label class="sp-pick"><span>Rep</span><select id="spUser">' + people.map(u => '<option' + (u === who ? ' selected' : '') + '>' + _spE(u) + '</option>').join('') + '</select></label>' : '') +
    '<label class="sp-pick"><span>Year</span><select id="spYear">' + years.map(y => '<option value="' + y + '"' + (y === SP.year ? ' selected' : '') + '>' + y + '</option>').join('') + '</select></label>' +
    '<button type="button" class="btn btn-secondary sp-download" id="spDownload">Download Excel</button>';
  _spId('spSync').textContent = SP.stale ? 'Updating…' : '';
}

function spWire() {
  const ctl = _spId('spControls');
  ctl.addEventListener('change', (e) => {
    if (e.target.id === 'spUser') { SP.user = e.target.value; spGo(); }
    if (e.target.id === 'spYear') { SP.year = parseInt(e.target.value, 10); SP.team = null; spGo(true); }
  });
  ctl.addEventListener('click', (e) => { if (e.target.closest('#spDownload')) spDownload(e.target.closest('#spDownload')); });
  _spId('spTeam').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rep]');
    if (b) { SP.user = b.getAttribute('data-rep'); spGo(); return; }
    const u = e.target.closest('[data-unassigned]');
    if (u) spUnassignedSheet(u);
  });
  _spId('spTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) spTab(b.getAttribute('data-tab')); });
  _spId('spTabs').addEventListener('keydown', spTabKeys);
  const body = _spId('spBody');
  body.addEventListener('click', spBodyClick);
  body.addEventListener('input', spBodyInput);
  body.addEventListener('change', spBodyChange);
  window.addEventListener('resize', () => spPlaceThumb(false));
}
/** A new rep or year: the address follows (a link can be shared), the cached copy shows at once, the read follows. */
function spGo(team) {
  try {
    const u = new URL(location.href);
    if (SP.over && SP.user) u.searchParams.set('user', SP.user); else u.searchParams.delete('user');
    u.searchParams.set('year', String(SP.year));
    history.replaceState(null, '', u.pathname + u.search);
  } catch (e) { /* no history: fine */ }
  SP.act = null; SP.actKey = '';
  const c = spFromCache();
  SP.data = c || null; SP.stale = !!c;
  spDrawHead();
  if (c) spDraw(); else _spId('spBody').innerHTML = spSkeleton();
  spLoad();
  if (team) spLoadTeam(); else spDrawTeam();
}

/* ── the team: every rep side by side (the director and management) ──────────────────────────────── */

function spDrawTeam() {
  const el = _spId('spTeam');
  if (!SP.over || !SP.team) { el.hidden = true; el.innerHTML = ''; return; }
  const t = SP.team, mi = parseInt(_spToday().slice(5, 7), 10) - 1, inYear = String(t.year) === _spToday().slice(0, 4);
  const rows = t.people.map(p => {
    const ach = spRatio(p.ytd, p.plan.annual), m = p.month;
    return '<tr class="' + (p.user === (SP.user || (SP.data && SP.data.user)) ? 'on' : '') + '"><th scope="row"><button type="button" class="sp-rep" data-rep="' + _spE(p.user) + '">' + _spE(p.user) + '</button>' +
      (p.plan.set ? '' : '<span class="sp-sub">default target</span>') + '</th>' +
      '<td class="num">' + spShort(p.plan.annual) + '</td><td class="num"><b>' + spShort(p.ytd) + '</b><span class="sp-meter"><i style="width:' + Math.min(100, Math.round((ach || 0) * 100)) + '%"></i></span></td>' +
      '<td class="num">' + spPct(ach) + '</td>' +
      (inYear ? '<td class="num">' + (m ? spShort(m.actual) + ' <span class="sp-dim">of ' + spShort(m.target) + '</span>' : '—') + '</td>' : '') +
      '<td class="num">' + spShort(p.weighted) + ' <span class="sp-dim">of ' + spShort(p.open) + '</span></td>' +
      (t.may && t.may.cost ? '<td class="num">' + (p.gp === null ? '—' : spShort(p.gp)) + '</td>' : '') +
      '<td class="num">' + p.accounts + '</td></tr>';
  }).join('');
  const none = t.unassigned || [], noneSum = none.reduce((s, x) => s + x.amount, 0);
  el.hidden = false;
  el.innerHTML = '<div class="sp-teamhead"><h2>The team in ' + t.year + '</h2>' +
    (none.length ? '<button type="button" class="sp-link" data-unassigned>' + none.length + ' order' + (none.length === 1 ? '' : 's') + ' (' + spShort(noneSum) + ') in no one\'s plan</button>' : '') + '</div>' +
    '<div class="sp-scroll"><table class="sp-table sp-teamtable"><thead><tr><th scope="col">Rep</th><th scope="col" class="num">Year target</th><th scope="col" class="num">So far</th><th scope="col" class="num">Achieved</th>' +
    (inYear ? '<th scope="col" class="num">' + SP_MONTHS_LONG[mi] + '</th>' : '') + '<th scope="col" class="num">Pipeline, weighted</th>' + (t.may && t.may.cost ? '<th scope="col" class="num">Gross profit</th>' : '') +
    '<th scope="col" class="num">Accounts</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function spUnassignedSheet(back) {
  const list = (SP.team && SP.team.unassigned) || [];
  spSheet('Orders in no one\'s plan', 'These ' + SP.team.year + ' sales orders count for no rep: the order names no rep\'s quotation and the customer is in no rep\'s Client Book, or its quotation belongs to someone with no plan. Add the customer to a rep\'s Client Book and the order counts for that rep.',
    '<ul class="sp-plain">' + list.map(x => '<li><span><b>' + _spE(x.customer) + '</b><span class="sp-sub">' + _spE([x.soNo, spDay(x.date), x.owner ? 'quotation of ' + x.owner : ''].filter(Boolean).join(' · ')) + '</span></span><span class="num">' + spMoney(x.amount) + '</span></li>').join('') + '</ul>', back);
}

/* ── the tabs: a segmented control that keeps its indicator ──────────────────────────────────────── */

function spTabsHtml() {
  return '<span class="sp-thumb now" aria-hidden="true"></span>' + SP_TABS.map(t => '<button type="button" role="tab" class="sp-tab" id="spTab-' + t[0] + '" data-tab="' + t[0] +
    '" aria-selected="' + (SP.tab === t[0]) + '" aria-controls="spBody" tabindex="' + (SP.tab === t[0] ? 0 : -1) + '">' + _spE(t[1]) + '<span class="sp-tabn" id="spTabN-' + t[0] + '"></span></button>').join('');
}
function spPlaceThumb(instant) {
  const tabs = _spId('spTabs'), th = tabs && tabs.querySelector('.sp-thumb'), on = tabs && tabs.querySelector('[aria-selected="true"]');
  if (!th || !on || typeof on.offsetLeft !== 'number') return;
  if (instant) th.classList.add('now');
  th.style.width = on.offsetWidth + 'px'; th.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  if (instant) { void th.offsetWidth; th.classList.remove('now'); }
  if (on.scrollIntoView && tabs.scrollWidth > tabs.clientWidth) on.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}
function spTab(k) {
  if (SP.tab === k) return;
  SP.tab = k;
  _spId('spTabs').querySelectorAll('[data-tab]').forEach(b => { const on = b.getAttribute('data-tab') === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  spPlaceThumb(false);
  try { const u = new URL(location.href); u.searchParams.set('tab', k); history.replaceState(null, '', u.pathname + u.search); } catch (e) { /* fine */ }
  spDrawBody(true);
}
function spTabKeys(e) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
  const i = SP_TABS.findIndex(t => t[0] === SP.tab), n = SP_TABS.length;
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
  e.preventDefault();
  spTab(SP_TABS[j][0]);
  const b = _spId('spTab-' + SP_TABS[j][0]); if (b) b.focus();
}

function spDraw() {
  const tabs = _spId('spTabs');
  if (!tabs.querySelector('.sp-thumb')) {
    tabs.innerHTML = spTabsHtml();
    /* the tabs settle as the fonts and the counts arrive: the indicator follows their size, without a slide */
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => spPlaceThumb(true)).observe(tabs);
  }
  const d = SP.data;
  if (d) {
    const open = (d.pipeline || []).filter(o => SP_OPEN_STAGES.indexOf(o.stage) >= 0 && !o.archived).length;
    const n = { accounts: d.accounts.length, sales: d.sales.length, pipeline: open };
    Object.keys(n).forEach(t => { const el = _spId('spTabN-' + t); if (el) el.textContent = n[t] ? String(n[t]) : ''; });
  }
  requestAnimationFrame(() => spPlaceThumb(true));
  _spId('spSync').textContent = SP.stale ? 'Updating…' : '';
  spDrawBody(false);
}
function spDrawBody(enter) {
  const d = SP.data, body = _spId('spBody');
  if (!d) return;
  const html = SP.tab === 'accounts' ? spAccountsHtml(d) : SP.tab === 'sales' ? spSalesHtml(d) : SP.tab === 'pipeline' ? spPipelineHtml(d) : SP.tab === 'activity' ? spActivityShell() : spPlanHtml(d);
  body.innerHTML = '<div class="sp-panel' + (enter ? ' sp-enter' : '') + '" role="tabpanel" aria-labelledby="spTab-' + SP.tab + '">' + html + '</div>';
  if (SP.tab === 'activity') spActivityLoad();
}

/* ── Plan: the year as the hero, the dashboard, the months, the tiers ──────────────────────────────── */

function spPlanHtml(d) {
  const k = spKpis(d), today = _spToday(), mr = spMonthRows(d.months, d.year, today), may = d.may || {};
  const inYear = String(d.year) === today.slice(0, 4), cur = mr.rows.find(r => r.cur);
  const pace = inYear ? Math.min(100, Math.round((mr.toDate.target / (k.annual || 1)) * 100)) : null;
  const hero = '<section class="sp-hero"><div class="sp-heroline"><div><p class="sp-cap">' + (inYear ? d.year + ' so far' : d.year) + '</p>' +
      '<p class="sp-big">' + _spE(spShort(k.ytd)) + '<span> of ' + _spE(spShort(k.annual)) + '</span></p></div>' +
      '<p class="sp-ach"><b>' + spPct(k.achievement) + '</b><span>achieved</span></p></div>' +
    '<div class="sp-bar" role="img" aria-label="' + _spE(spPct(k.achievement) + ' of the year target' + (pace !== null ? '; ' + pace + '% of the year has passed in targets' : '')) + '">' +
      '<i style="width:' + Math.min(100, Math.round((k.achievement || 0) * 100)) + '%"></i>' + (pace !== null ? '<em style="left:' + pace + '%" title="Target to date"></em>' : '') + '</div>' +
    '<dl class="sp-facts">' +
      '<div><dt>Remaining</dt><dd>' + spMoney(k.remaining) + '</dd></div>' +
      (inYear ? '<div><dt>Target to date</dt><dd>' + spMoney(mr.toDate.target) + ' <span class="sp-dim">· ' + spPct(mr.toDate.achievement) + ' reached</span></dd></div>' : '') +
      (cur ? '<div><dt>' + cur.long + '</dt><dd>' + spMoney(cur.actual) + ' <span class="sp-dim">of ' + spMoney(cur.target) + '</span></dd></div>' : '') +
      '<div><dt>Orders</dt><dd>' + k.orders + '</dd></div>' +
    '</dl>' + (d.plan.set ? '' : '<p class="sp-note">' + (may.target ? 'The year target is the default (' + spShort(k.annual) + ', even months). Set it below.' : 'The year target is the default until the director sets yours.') + '</p>') + '</section>';
  const tile = (label, value, sub, tone) => '<div class="sp-tile' + (tone ? ' ' + tone : '') + '"><p class="sp-tl">' + _spE(label) + '</p><p class="sp-tv">' + value + '</p>' + (sub ? '<p class="sp-ts">' + sub + '</p>' : '') + '</div>';
  const kpis = '<section class="sp-sec"><h3>Dashboard</h3><div class="sp-tiles">' +
    tile('Open pipeline, weighted', _spE(spShort(k.weighted)), _spE(k.openCount + ' open · value × odds')) +
    tile('Open pipeline', _spE(spShort(k.openValue)), _spE(spPct(k.coverage) + ' of the year target')) +
    (may.cost ? tile('Gross profit', k.gp === null ? '—' : _spE(spShort(k.gp)), _spE(k.costedOrders + ' of ' + k.orders + ' orders have a cost')) + tile('Gross margin', _spE(spPct(k.gm)), 'on the orders with a cost') : '') +
    tile('Quotations sent', String(k.quotesSubmitted), _spE(spShort(k.quoteValue) + ' quoted')) +
    tile('Win rate', _spE(spPct(k.winRate)), _spE(k.won + ' won · ' + k.lost + ' lost')) +
    tile('Active accounts', String(k.activeAccounts), _spE('of ' + k.accounts + ' · an order in the last year')) +
    tile('Accounts with sales', String(k.accountsWithSales), _spE('this year')) +
    '</div></section>';
  const max = Math.max(1, ...mr.rows.map(r => Math.max(r.target, r.actual)));
  const months = '<section class="sp-sec"><div class="sp-sechead"><h3>Monthly targets</h3>' + (may.target ? '<button type="button" class="btn btn-secondary sp-edit" data-targets>Set the targets</button>' : '') + '</div>' +
    '<div class="sp-scroll"><table class="sp-table sp-months"><thead><tr><th scope="col">Month</th><th scope="col" class="num">Share</th><th scope="col" class="num">Target</th><th scope="col" class="num">Actual</th>' +
    '<th scope="col" class="num">Variance</th><th scope="col" class="num">Achieved</th><th scope="col" class="sp-barcol"><span class="sp-sr">Against the target</span></th></tr></thead><tbody>' +
    mr.rows.map(r => '<tr class="' + (r.cur ? 'cur' : r.future ? 'future' : '') + '"><th scope="row">' + r.long + (r.cur ? ' <span class="sp-badge mid">This month</span>' : '') + '</th>' +
      '<td class="num">' + r.share.toFixed(2).replace(/\.?0+$/, '') + '%</td><td class="num">' + spMoney(r.target) + '</td><td class="num">' + (r.future && !r.actual ? '—' : spMoney(r.actual)) + '</td>' +
      '<td class="num ' + (r.future ? '' : r.variance < 0 ? 'neg' : 'pos') + '">' + (r.future && !r.actual ? '—' : spMoney(r.variance)) + '</td><td class="num">' + (r.future && !r.actual ? '—' : spPct(r.achievement)) + '</td>' +
      '<td class="sp-barcol"><span class="sp-mbar"><i class="t" style="width:' + Math.round(r.target / max * 100) + '%"></i><i class="a" style="width:' + Math.round(r.actual / max * 100) + '%"></i></span></td></tr>').join('') +
    '</tbody><tfoot><tr><th scope="row">Year</th><td class="num">' + mr.total.share.toFixed(2).replace(/\.?0+$/, '') + '%</td><td class="num">' + spMoney(mr.total.target) + '</td><td class="num">' + spMoney(mr.total.actual) + '</td>' +
    '<td class="num">' + spMoney(mr.total.variance) + '</td><td class="num">' + spPct(mr.total.achievement) + '</td><td></td></tr></tfoot></table></div></section>';
  const tiers = spTierRows(d.accounts), at = spAccountsTotal(d.accounts, k.annual);
  const tierHtml = '<section class="sp-sec"><h3>By account tier</h3><div class="sp-scroll"><table class="sp-table"><thead><tr><th scope="col">Tier</th><th scope="col" class="num">Accounts</th>' +
    '<th scope="col" class="num">Target</th><th scope="col" class="num">Actual</th><th scope="col" class="num">Achieved</th></tr></thead><tbody>' +
    tiers.map(t => '<tr><th scope="row">' + _spE(t.label) + '</th><td class="num">' + t.accounts + '</td><td class="num">' + spMoney(t.target) + '</td><td class="num">' + spMoney(t.actual) + '</td><td class="num">' + spPct(t.achievement) + '</td></tr>').join('') +
    '</tbody></table></div><p class="sp-note">' + (at.match ? 'The accounts\' targets add up to the year target.' : 'The accounts\' targets add up to ' + spMoney(at.total) + '; the year target is ' + spMoney(at.annual) +
    (at.gap > 0 ? ' — ' + spMoney(at.gap) + ' is not on an account yet.' : ' — the accounts carry ' + spMoney(-at.gap) + ' more.')) +
    ' Tiers start from the follow-up rank: 1–' + (d.lists.ranks[0]) + ' A, ' + (d.lists.ranks[0] + 1) + '–' + d.lists.ranks[1] + ' B, ' + (d.lists.ranks[1] + 1) + '–' + d.lists.ranks[2] + ' C.</p></section>';
  return hero + kpis + months + tierHtml;
}

/* ── Accounts ───────────────────────────────────────────────────────────────────────────────────── */

function spAccountsHtml(d) {
  const f = SP.f.acc, counts = spAccountCounts(d.accounts), list = spAccountsFilter(d.accounts, f), today = _spToday();
  const chips = SP_ACCOUNT_SEGS.filter(([k]) => k === 'all' || counts[k]).map(([k, l]) => '<button type="button" class="sp-chip' + (f.seg === k ? ' on' : '') + '" data-aseg="' + k + '" aria-pressed="' + (f.seg === k) + '">' +
    _spE(l) + ' <span class="n">' + counts[k] + '</span></button>').join('');
  const at = spAccountsTotal(d.accounts, d.plan.annual);
  const rows = list.map(a => {
    const ach = spRatio(a.actual, a.target), c = a.contact;
    return '<tr data-acct="' + _spE(a.clientNo) + '" tabindex="0"><td class="sp-rank">' + (a.rank || '') + '</td>' +
      '<th scope="row"><b>' + _spE(a.company) + '</b><span class="sp-sub">' + _spE([a.sector, a.nextStep && 'Next: ' + a.nextStep].filter(Boolean).join(' · ')) + '</span></th>' +
      '<td>' + (a.tier ? '<span class="sp-tier t' + a.tier + '">' + a.tier + '</span>' : '<span class="sp-dim">—</span>') + (a.tierSet ? '<span class="sp-set" title="Changed by hand">•</span>' : '') + '</td>' +
      '<td class="num">' + (a.target ? spMoney(a.target) : '—') + '</td>' +
      '<td class="num"><b>' + (a.actual ? spMoney(a.actual) : '—') + '</b>' + (a.target ? '<span class="sp-meter"><i style="width:' + Math.min(100, Math.round((ach || 0) * 100)) + '%"></i></span>' : '') + '</td>' +
      '<td>' + (c ? _spE(c.name || '—') + (c.position ? '<span class="sp-sub">' + _spE(c.position) + '</span>' : '') : '<span class="sp-dim">No contact</span>') + '</td>' +
      '<td>' + _spE(spVisitText(a, today)) + '</td>' +
      '<td class="sp-focus">' + (a.focus ? _spE(a.focus) : a.focusHints.length ? '<span class="sp-dim">' + _spE(a.focusHints[0]) + '?</span>' : '<span class="sp-dim">—</span>') + '</td>' +
      '<td><span class="sp-badge ' + spStatusTone(a.status) + '">' + _spE(a.status) + '</span></td></tr>';
  }).join('');
  return '<div class="sp-bar2"><label class="sp-search"><span class="sp-sr">Search the accounts</span><input type="search" class="sp-in" id="spAccQ" placeholder="Search accounts, contacts, focus" value="' + _spE(f.q) + '"></label></div>' +
    '<div class="sp-chips" role="group" aria-label="Show">' + chips + '</div>' +
    '<p class="sp-count">' + list.length + ' of ' + d.accounts.length + ' accounts · targets add up to ' + spMoney(at.total) + ' of ' + spMoney(at.annual) + '</p>' +
    (d.accounts.length ? '<div class="sp-scroll"><table class="sp-table sp-acc sp-rows"><thead><tr><th scope="col" class="sp-rank">#</th><th scope="col">Customer</th><th scope="col">Tier</th><th scope="col" class="num">Target</th>' +
      '<th scope="col" class="num">Sales</th><th scope="col">Main contact</th><th scope="col">Visits</th><th scope="col">Focus</th><th scope="col">Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9" class="sp-empty">No account matches.</td></tr>') + '</tbody></table></div>'
      : '<div class="sp-start"><p class="sp-start-t">No accounts yet</p><p class="sp-sub">The accounts are the clients in ' + (_spOwn() && !SP.over ? 'your' : _spFirst(d.user) + '\'s') +
        ' Client Book. <a href="director-client-book.html">Open the Client Book</a> to add them.</p></div>') +
    '<p class="sp-note">Rank and tier come from the follow-up guide\'s ranking; sales from the sales orders; contact and visits from the Client Book and the visit plans. Tap an account to change its tier, target, focus or status.</p>';
}
function spStatusTone(s) { return s === 'Active' ? 'ok' : s === 'Dormant' ? 'warn' : s === 'On Hold' ? 'off' : 'mid'; }

function spAccountSheet(no, back) {
  const d = SP.data, a = d.accounts.find(x => x.clientNo === no);
  if (!a) return;
  const auto = (v) => 'Automatic' + (v ? ': ' + v : '');
  const tierOpts = [['', auto(a.tierAuto || 'no tier')]].concat(d.lists.tiers.map(t => [t, 'Tier ' + t + ' · ' + spShort(d.plan.tierTargets[t])])).concat([['-', 'No tier']]);
  const cur = a.tierSet ? (a.tier || '-') : '';
  const c = a.contact;
  const facts = '<dl class="sp-dl">' +
    '<div><dt>Follow-up rank</dt><dd>' + (a.rank || '—') + '</dd></div>' +
    '<div><dt>Sales this year</dt><dd>' + spMoney(a.actual) + ' · ' + a.orders + ' order' + (a.orders === 1 ? '' : 's') + '</dd></div>' +
    '<div><dt>Last order</dt><dd>' + (a.lastSale ? _spE(spDay(a.lastSale, String(d.year))) : 'None yet') + '</dd></div>' +
    '<div><dt>Main contact</dt><dd>' + (c ? _spE(c.name) + (c.position ? ', ' + _spE(c.position) : '') + (c.phone ? '<br><a class="sp-tel" href="tel:' + _spE(String(c.phone).replace(/[^\d+]/g, '')) + '">' + _spE(c.phone) + '</a>' : '') +
      (c.email ? '<br><a href="mailto:' + _spE(c.email) + '">' + _spE(c.email) + '</a>' : '') : 'None in the Client Book') + '</dd></div>' +
    '<div><dt>Visits</dt><dd>' + _spE(spVisitText(a, _spToday())) + '</dd></div>' +
    (a.nextStep ? '<div><dt>Client Book next step</dt><dd>' + _spE(a.nextStep) + '</dd></div>' : '') + '</dl>';
  const hints = a.focusHints.length ? '<div class="sp-hints" role="group" aria-label="From their quotations">' + a.focusHints.map(h => '<button type="button" class="sp-hint" data-hint="' + _spE(h) + '">+ ' + _spE(h) + '</button>').join('') + '</div>' : '';
  const form = '<form class="sp-form" id="spAccForm" data-no="' + _spE(no) + '" autocomplete="off">' +
    '<div class="sp-grid2"><label>Tier<select class="sp-in" name="tier">' + tierOpts.map(([v, l]) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + _spE(l) + '</option>').join('') + '</select></label>' +
    '<label>Year target (₱)<input type="text" class="sp-in" name="target" inputmode="decimal" value="' + (a.targetSet ? a.target : '') + '" placeholder="' + _spE(auto(spMoney(a.targetAuto))) + '"></label></div>' +
    '<label>Products / opportunity focus<textarea class="sp-in" name="focus" rows="2" maxlength="300" placeholder="What to sell them this year">' + _spE(a.focus) + '</textarea></label>' + hints +
    '<label>Account status<select class="sp-in" name="status">' + [['', auto(a.statusAuto)]].concat(d.lists.statuses.map(s => [s, s])).map(([v, l]) => '<option value="' + v + '"' + (a.statusSet && v === a.status ? ' selected' : '') + '>' + _spE(l) + '</option>').join('') + '</select></label>' +
    '<p class="sp-err" id="spAccErr" role="alert" hidden></p>' +
    '<div class="sp-formfoot"><span class="sp-sub">' + (a.updatedBy ? 'Changed by ' + _spE(a.updatedBy) : 'Nothing changed by hand yet') + '</span><button type="submit" class="btn btn-primary primary">Save</button></div></form>';
  spSheet(a.company, [a.sector, a.tier ? 'Tier ' + a.tier : '', a.status].filter(Boolean).join(' · '), facts + form, back);
  const f = _spId('spAccForm');
  f.addEventListener('submit', (e) => { e.preventDefault(); spSaveAccount(f, a); });
  f.addEventListener('click', (e) => {
    const h = e.target.closest('[data-hint]');
    if (!h) return;
    const ta = f.elements.focus, add = h.getAttribute('data-hint');
    ta.value = ta.value.trim() ? ta.value.trim().replace(/[;,.]?$/, '') + '; ' + add : add;
    h.disabled = true;
    ta.focus();
  });
  f.elements.target.addEventListener('input', () => { const v = f.elements.target.value.replace(/,/g, '').trim(); spErr('spAccErr', v && !(isFinite(Number(v)) && Number(v) >= 0) ? 'The target is an amount in pesos.' : ''); });
}
async function spSaveAccount(f, a) {
  const el = f.elements, t = el.target.value.replace(/,/g, '').trim();
  if (t && !(isFinite(Number(t)) && Number(t) >= 0)) { spErr('spAccErr', 'The target is an amount in pesos.'); el.target.focus(); return; }
  const p = { year: SP.year, clientNo: a.clientNo, tier: el.tier.value, target: t, focus: el.focus.value.trim(), status: el.status.value };
  if (SP.over) p.user = SP.data.user;
  if (a.updatedAt) p.ifUpdatedAt = a.updatedAt;
  const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
  const r = await postFlow('saveSalesPlanAccount', p).catch(_spFail);
  btn.disabled = false;
  if (!r.success) { spErr('spAccErr', r.message || 'Not saved.'); return; }
  spClose();
  _spToast(r.message || 'Saved.');
  spReload(false);
}

/* ── Sales log ──────────────────────────────────────────────────────────────────────────────────── */

function spSalesHtml(d) {
  const may = d.may || {}, m = SP.f.sale.month, list = d.sales.filter(s => !m || parseInt(s.date.slice(5, 7), 10) === m);
  const months = Array.from(new Set(d.sales.map(s => parseInt(s.date.slice(5, 7), 10)))).sort((a, b) => a - b);
  const sum = (k) => list.reduce((t, s) => t + (Number(s[k]) || 0), 0);
  const gpRows = list.filter(s => s.gp !== null && s.gp !== undefined);
  const viaBook = list.filter(s => s.via === 'client book').length;
  const pay = (s) => '<span class="sp-badge ' + (s.payment === 'Paid' ? 'ok' : s.payment === 'Overdue' ? 'bad' : s.payment === 'Not invoiced' ? 'off' : 'warn') + '">' + _spE(s.payment) + '</span>' +
    (s.outstanding ? '<span class="sp-sub">' + spMoney(s.outstanding) + ' to collect</span>' : '');
  const rows = list.map(s => '<tr><td class="tm">' + _spE(spDay(s.date)) + '</td><th scope="row"><b>' + _spE(s.customer) + '</b>' + (s.shared ? '<span class="sp-sub">in two reps\' books · credited by the last quotation</span>' : '') + '</th>' +
    '<td>' + _spE(s.soNo) + (s.poNo && s.poNo !== s.soNo ? '<span class="sp-sub">PO ' + _spE(s.poNo) + '</span>' : '') + '</td><td>' + (s.invNos.length ? _spE(s.invNos.join(', ')) : '<span class="sp-dim">—</span>') + '</td>' +
    '<td class="sp-prod">' + _spE(s.products || '—') + '</td><td class="num"><b>' + spMoney(s.amount) + '</b></td>' +
    (may.cost ? '<td class="num">' + (s.cost === null ? '<span class="sp-dim">—</span>' : spMoney(s.cost)) + '</td><td class="num">' + (s.gp === null ? '<span class="sp-dim">—</span>' : spMoney(s.gp)) + '</td>' +
      '<td class="num">' + (s.gp === null ? '—' : spPct(spRatio(s.gp, s.amount))) + '</td>' : '') + '<td>' + pay(s) + '</td></tr>').join('');
  const chips = '<button type="button" class="sp-chip' + (!m ? ' on' : '') + '" data-smonth="0" aria-pressed="' + (!m) + '">All <span class="n">' + d.sales.length + '</span></button>' +
    months.map(x => '<button type="button" class="sp-chip' + (m === x ? ' on' : '') + '" data-smonth="' + x + '" aria-pressed="' + (m === x) + '">' + SP_MONTHS[x - 1] + ' <span class="n">' + d.sales.filter(s => parseInt(s.date.slice(5, 7), 10) === x).length + '</span></button>').join('');
  return '<div class="sp-chips" role="group" aria-label="Month">' + chips + '</div>' +
    '<p class="sp-count">' + list.length + ' order' + (list.length === 1 ? '' : 's') + ' · ' + spMoney(sum('amount')) + (may.cost && gpRows.length ? ' · gross profit ' + spMoney(gpRows.reduce((t, s) => t + s.gp, 0)) : '') + '</p>' +
    (list.length ? '<div class="sp-scroll"><table class="sp-table sp-sales sp-rows"><thead><tr><th scope="col">Date</th><th scope="col">Customer</th><th scope="col">Sales order</th><th scope="col">Invoice</th>' +
      '<th scope="col">Products</th><th scope="col" class="num">Amount</th>' + (may.cost ? '<th scope="col" class="num">Cost</th><th scope="col" class="num">Gross profit</th><th scope="col" class="num">Margin</th>' : '') +
      '<th scope="col">Payment</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="sp-start"><p class="sp-start-t">No sales yet in ' + d.year + '</p><p class="sp-sub">A sales order for one of these clients, or on one of these quotations, shows here by itself.</p></div>') +
    '<p class="sp-note">Nothing to type here: every sales order of the year is counted on its date, at its total as recorded (before VAT; VAT is added on the invoice). An order counts for the rep whose quotation it names; with no quotation, for the rep whose Client Book has the customer' +
    (viaBook ? ' (' + viaBook + ' here)' : '') + '. Payment comes from AR aging.' + (may.cost ? ' Cost is the cost sheet, else the invoice\'s cost.' : '') + '</p>';
}

/* ── Pipeline ───────────────────────────────────────────────────────────────────────────────────── */

function spPipelineHtml(d) {
  const f = SP.f.pipe, today = _spToday(), counts = spPipeCounts(d.pipeline, today), list = spPipeFilter(d.pipeline, f, today), stages = spStageSummary(d.pipeline);
  const maxV = Math.max(1, ...stages.map(s => s.value));
  const strip = '<ol class="sp-stages" aria-label="The open pipeline by stage">' + stages.map(s => '<li><button type="button" class="sp-stage' + (f.seg === s.stage ? ' on' : '') + '" data-pseg="' + _spE(s.stage) + '">' +
    '<span class="sp-sname">' + _spE(s.stage) + '</span><span class="sp-sv">' + _spE(spShort(s.value)) + '</span><span class="sp-sub">' + s.count + ' · ' + _spE(spShort(s.weighted)) + ' weighted' + (s.unpriced ? ' · ' + s.unpriced + ' unpriced' : '') + '</span>' +
    '<span class="sp-meter"><i style="width:' + Math.round(s.value / maxV * 100) + '%"></i></span></button></li>').join('') + '</ol>';
  const chips = SP_PIPE_SEGS.filter(([k]) => k === 'open' || counts[k]).map(([k, l]) => '<button type="button" class="sp-chip' + (f.seg === k ? ' on' : '') + '" data-pseg="' + _spE(k) + '" aria-pressed="' + (f.seg === k) + '">' +
    _spE(l) + ' <span class="n">' + counts[k] + '</span></button>').join('');
  const ref = (o) => o.source === 'quotation' ? '<a href="quotation-status.html?q=' + encodeURIComponent(o.recordNo) + '">' + _spE(o.recordNo) + '</a>'
    : o.source === 'request' ? '<a href="flow-pricing-request.html?pr=' + encodeURIComponent(o.recordNo) + '">' + _spE(o.recordNo) + '</a>' : '<span class="sp-badge mid">Lead</span>';
  const rows = list.map(o => {
    const cs = spCloseState(o, today), due = o.nextActionDate && o.nextActionDate <= today && SP_OPEN_STAGES.indexOf(o.stage) >= 0;
    return '<tr data-opp="' + _spE(o.source + '|' + o.recordNo) + '" tabindex="0"><td>' + ref(o) + '</td>' +
      '<th scope="row"><b>' + _spE(o.company) + '</b><span class="sp-sub">' + _spE(o.project || (o.source === 'request' ? 'Purchase request' : '—')) + '</span></th>' +
      '<td class="num">' + (o.value === null ? '<span class="sp-dim">unpriced</span>' : spMoney(o.value)) + '</td>' +
      '<td><span class="sp-stagechip">' + _spE(o.stage) + '</span>' + (o.stage !== o.stageAuto && o.stage.indexOf('Closed') !== 0 ? '<span class="sp-set" title="Changed by hand">•</span>' : '') + '</td>' +
      '<td class="num">' + o.probability + '%' + (o.probSet ? '<span class="sp-set" title="Changed by hand">•</span>' : '') + '</td><td class="num">' + (o.weighted === null ? '—' : spMoney(o.weighted)) + '</td>' +
      '<td class="' + cs + '">' + (o.stage.indexOf('Closed') === 0 ? _spE(spDay(o.closedAt)) : o.expectedClose ? _spE(spDay(o.expectedClose)) + (o.closeSet ? '' : '<span class="sp-sub">estimate</span>') : '—') + '</td>' +
      '<td>' + (o.decisionMaker ? _spE(o.decisionMaker) : '<span class="sp-dim">—</span>') + '</td>' +
      '<td' + (due ? ' class="due"' : '') + '>' + (o.nextAction ? _spE(o.nextAction) : '<span class="sp-dim">—</span>') + (o.nextActionDate ? '<span class="sp-sub">' + _spE(spDay(o.nextActionDate)) + '</span>' : '') + '</td></tr>';
  }).join('');
  return strip + '<div class="sp-bar2"><label class="sp-search"><span class="sp-sr">Search the pipeline</span><input type="search" class="sp-in" id="spPipeQ" placeholder="Search customers, projects, numbers" value="' + _spE(f.q) + '"></label>' +
    '<button type="button" class="btn btn-primary primary" data-lead>Add a lead</button></div>' +
    '<div class="sp-chips" role="group" aria-label="Show">' + chips + '</div>' +
    '<p class="sp-count">' + list.length + ' shown · weighted ' + spMoney(list.reduce((t, o) => t + (o.weighted || 0), 0)) + '</p>' +
    (list.length ? '<div class="sp-scroll"><table class="sp-table sp-pipe sp-rows"><thead><tr><th scope="col">Record</th><th scope="col">Customer · project</th><th scope="col" class="num">Value</th><th scope="col">Stage</th>' +
      '<th scope="col" class="num">Odds</th><th scope="col" class="num">Weighted</th><th scope="col">Close</th><th scope="col">Decision maker</th><th scope="col">Next action</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="sp-start"><p class="sp-start-t">Nothing here</p><p class="sp-sub">Open quotations and purchase requests show by themselves. Add a lead for an opportunity not yet in the portal.</p></div>') +
    '<p class="sp-note">Quotations (sent or approved, not won or closed) and purchase requests not yet quoted show by themselves, at the quotation\'s value after discount. Odds start from the stage; the close date from the day sent + ' +
    '30 days; the next action from the follow-up days (3, 5, 7, 14, then weekly). Tap a row to change any of them. Won and lost are marked on <a href="quotation-status.html">Quotation status</a>.</p>';
}
function spOppOf(key) { const [src, ...rest] = String(key).split('|'), no = rest.join('|'); return (SP.data.pipeline || []).find(o => o.source === src && o.recordNo === no) || null; }
function spOppSheet(o, back) {
  const d = SP.data, lead = !o || o.source === 'lead', isNew = !o;
  const v = o || { source: 'lead', stage: 'Lead', stageAuto: 'Lead', probAuto: d.lists.odds.Lead, probability: d.lists.odds.Lead, probSet: false, value: null, company: '', project: '', category: '', decisionMaker: '',
                   nextAction: '', nextActionDate: '', expectedClose: '', closeAuto: '', notes: '', recordNo: '', clientNo: '' };
  const stages = lead ? d.lists.stages : v.source === 'quotation' ? ['Quotation', 'Negotiation'] : ['Qualified', 'Technical Review'];
  const closed = v.stage.indexOf('Closed') === 0 && !lead;
  const acc = d.accounts.map(a => '<option value="' + _spE(a.company) + '">').join('');
  const people = Array.from(new Set(d.accounts.filter(a => a.contact && a.contact.name && (!v.clientNo || a.clientNo === v.clientNo)).map(a => a.contact.name))).map(n => '<option value="' + _spE(n) + '">').join('');
  const auto = (x) => 'Automatic' + (x !== '' && x !== null && x !== undefined ? ': ' + x : '');
  const fields = (lead ? '<div class="sp-grid2"><label>Company<input type="text" class="sp-in" name="company" list="spAccList" required value="' + _spE(v.company) + '" placeholder="One of your accounts, or a new name"></label>' +
      '<label>Category<select class="sp-in" name="category"><option value="">—</option>' + d.lists.categories.map(c => '<option' + (v.category === c ? ' selected' : '') + '>' + _spE(c) + '</option>').join('') + '</select></label></div>' +
      '<label>Opportunity / project<input type="text" class="sp-in" name="project" required maxlength="200" value="' + _spE(v.project) + '" placeholder="Mill relining tools for the March shutdown"></label>' : '') +
    (v.source !== 'quotation' ? '<label>' + (lead ? 'Value (₱)' : 'Estimated value (₱)') + '<input type="text" class="sp-in" name="value" inputmode="decimal" value="' + (v.value === null || v.value === undefined ? '' : v.value) + '" placeholder="Before VAT"></label>' : '') +
    (closed ? '' : '<div class="sp-grid2"><label>Stage<select class="sp-in" name="stage">' + (lead ? '' : '<option value="">' + _spE(auto(v.stageAuto)) + '</option>') +
      stages.map(s => '<option' + ((lead ? v.stage === s : v.stage !== v.stageAuto && v.stage === s) ? ' selected' : '') + '>' + _spE(s) + '</option>').join('') + '</select></label>' +
      '<label>Odds (%)<input type="text" class="sp-in" name="probability" inputmode="numeric" value="' + (v.probSet ? v.probability : '') + '" placeholder="' + _spE(auto(v.probAuto + '%')) + '"></label></div>' +
      '<div class="sp-grid2"><label>Expected close' + (!v.closeSet && v.closeAuto ? ' <span class="sp-auto">automatic: ' + _spE(spDay(v.closeAuto)) + '</span>' : '') +
        '<input type="date" class="sp-in" name="expectedClose" value="' + _spE(v.closeSet ? v.expectedClose : '') + '"></label>' +
      '<label>Decision maker<input type="text" class="sp-in" name="decisionMaker" list="spPeople" maxlength="120" value="' + _spE(v.decisionMaker) + '"></label></div>' +
      '<div class="sp-grid2"><label>Next action<input type="text" class="sp-in" name="nextAction" maxlength="200" value="' + _spE(v.nextActionSet ? v.nextAction : '') + '" placeholder="' + _spE(v.nextActionSet || !v.nextAction ? '' : auto(v.nextAction)) + '"></label>' +
      '<label>Next action date' + (!v.nextActionSet && v.nextActionDate ? ' <span class="sp-auto">automatic: ' + _spE(spDay(v.nextActionDate)) + '</span>' : '') +
        '<input type="date" class="sp-in" name="nextActionDate" value="' + _spE(v.nextActionSet ? v.nextActionDate : '') + '"></label></div>') +
    '<label>Notes<textarea class="sp-in" name="notes" rows="2" maxlength="500">' + _spE(v.notes) + '</textarea></label>' +
    '<datalist id="spAccList">' + acc + '</datalist><datalist id="spPeople">' + people + '</datalist>';
  const facts = isNew ? '' : '<dl class="sp-dl">' + (v.source === 'quotation' ? '<div><dt>Quotation</dt><dd><a href="quotation-status.html?q=' + encodeURIComponent(v.recordNo) + '">' + _spE(v.recordNo) + '</a> · ' + _spE(v.quoteStatus) +
      (v.result ? ' · ' + _spE(v.result) : '') + '</dd></div><div><dt>Sent</dt><dd>' + (v.sentAt ? _spE(spDay(v.sentAt)) + ' · ' + v.age + ' days ago' : 'Not sent yet') + '</dd></div>' +
      (v.lastFollowUp ? '<div><dt>Last follow-up</dt><dd>' + _spE(spDay(v.lastFollowUp)) + '</dd></div>' : '') : v.source === 'request' ? '<div><dt>Purchase request</dt><dd>' + _spE(v.recordNo) + ' · ' + _spE(v.quoteStatus) + '</dd></div>' : '') +
    (v.value !== null && v.value !== undefined ? '<div><dt>Value</dt><dd>' + spMoney(v.value) + (v.source === 'quotation' ? ' <span class="sp-dim">after discount, before VAT</span>' : '') + '</dd></div>' : '') +
    (closed ? '<div><dt>Closed</dt><dd>' + _spE(v.stage) + ' · ' + _spE(spDay(v.closedAt)) + (v.reason ? ' · ' + _spE(v.reason) : '') + (v.soNo ? ' · ' + _spE(v.soNo) : '') + '</dd></div>' : '') + '</dl>';
  const foot = '<p class="sp-err" id="spOppErr" role="alert" hidden></p><div class="sp-formfoot">' +
    (lead && !isNew ? '<button type="button" class="sp-link bad" data-archive="' + _spE(v.recordNo) + '">Take off the pipeline</button>' : v.source === 'quotation' && !closed ? '<a class="sp-link" href="quotation-status.html?q=' + encodeURIComponent(v.recordNo) + '">Mark won or lost</a>' : '<span></span>') +
    '<button type="submit" class="btn btn-primary primary">' + (isNew ? 'Add the lead' : 'Save') + '</button></div>';
  spSheet(isNew ? 'New lead' : (v.company || v.recordNo), isNew ? 'An opportunity not yet in the portal as a purchase request or quotation.' : [v.project, v.stage].filter(Boolean).join(' · '),
    facts + '<form class="sp-form" id="spOppForm" autocomplete="off">' + fields + foot + '</form>', back);
  const f = _spId('spOppForm');
  f.dataset.ref = 'L' + Date.now().toString(36);
  f.addEventListener('submit', (e) => { e.preventDefault(); spSaveOpp(f, o); });
  f.addEventListener('click', (e) => { const a = e.target.closest('[data-archive]'); if (a) spArchiveLead(a.getAttribute('data-archive'), false); });
  /* the odds' hint follows the stage chosen (Qualified 20%, Negotiation 60% …) */
  if (f.elements.stage && f.elements.probability) f.elements.stage.addEventListener('change', () => {
    const st = f.elements.stage.value || v.stageAuto, o = d.lists.odds[st];
    if (o !== undefined) f.elements.probability.placeholder = 'Automatic: ' + o + '%';
  });
  if (f.elements.probability) f.elements.probability.addEventListener('input', () => { const s = f.elements.probability.value.replace('%', '').trim(); spErr('spOppErr', s && !(isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 100) ? 'Odds are 0 to 100%.' : ''); });
  if (f.elements.value) f.elements.value.addEventListener('input', () => { const s = f.elements.value.value.replace(/,/g, '').trim(); spErr('spOppErr', s && !(isFinite(Number(s)) && Number(s) >= 0) ? 'The value is an amount in pesos.' : ''); });
}
async function spSaveOpp(f, o) {
  const el = f.elements, d = SP.data, val = (k) => (el[k] ? String(el[k].value || '').trim() : undefined);
  const p = { source: o ? o.source : 'lead' };
  if (SP.over) p.user = d.user;
  if (o && o.source !== 'lead') p.recordNo = o.recordNo;
  if (o && o.source === 'lead') p.oppNo = o.recordNo;
  ['stage', 'probability', 'expectedClose', 'decisionMaker', 'nextAction', 'nextActionDate', 'notes', 'value', 'category', 'project'].forEach(k => { const x = val(k); if (x !== undefined) p[k] = k === 'value' ? x.replace(/,/g, '') : k === 'probability' ? x.replace('%', '') : x; });
  if (p.source === 'lead') {
    p.company = val('company');
    const hit = d.accounts.find(a => a.company.toLowerCase() === String(p.company || '').toLowerCase());
    p.clientNo = hit ? hit.clientNo : '';
    if (!o) p.clientRef = f.dataset.ref;
    if (!p.stage) p.stage = 'Lead';
  }
  if (o && o.updatedAt) p.ifUpdatedAt = o.updatedAt;
  const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
  const r = await postFlow('saveSalesOpp', p).catch(_spFail);
  btn.disabled = false;
  if (!r.success) { spErr('spOppErr', r.message || 'Not saved.'); return; }
  spClose();
  _spToast(r.message || 'Saved.');
  spReload(SP.over);
}
async function spArchiveLead(no, restore) {
  const p = { oppNo: no, restore: !!restore };
  const r = await postFlow('archiveSalesOpp', p).catch(_spFail);
  if (!r.success) { _spToast(r.message || 'Not changed.', 'warn'); return; }
  if (!restore) { spClose(); if (typeof hxSnackbar === 'function') hxSnackbar('Taken off the pipeline.', { action: 'Undo', onAction: () => spArchiveLead(no, true) }); else _spToast(r.message); }
  else _spToast('Back on the pipeline.');
  spReload(SP.over);
}

/* ── Activity: the daily reports, read for a period ─────────────────────────────────────────────── */

function spActivityShell() {
  const a = SP.f.act, ranges = [['week', 'This week'], ['month', 'This month'], ['last', 'Last month'], ['quarter', 'Last 90 days']];
  return '<div class="sp-bar2"><div class="sp-seg" role="group" aria-label="Period">' + ranges.map(([k, l]) => '<button type="button" class="sp-segbtn' + (a.range === k ? ' on' : '') + '" data-range="' + k + '" aria-pressed="' + (a.range === k) + '">' + l + '</button>').join('') + '</div>' +
    (_spOwn() && !SP.over || (SP.data && SP.data.user === SP.me) ? '<a class="btn btn-secondary" href="my-daily-report.html">Log today\'s work</a>' : '') + '</div>' +
    '<div id="spAct">' + spSkeleton() + '</div>';
}
async function spActivityLoad() {
  const d = SP.data, rg = spActivityRange(SP.f.act.range, _spToday()), key = (d.user || '') + '|' + rg.from + '|' + rg.to;
  if (SP.act && SP.actKey === key) { spActivityDraw(); return; }
  const p = { from: rg.from, to: rg.to };
  if (SP.over) p.user = d.user;
  const r = await postFlow('getSalesActivity', p).catch(_spFail);
  if (SP.tab !== 'activity') return;
  if (!r.success) { const el = _spId('spAct'); if (el) el.innerHTML = '<div class="sp-notice bad">' + _spE(r.message || 'The activity could not be read.') + '</div>'; return; }
  SP.act = r; SP.actKey = key;
  spActivityDraw();
}
function spActivityDraw() {
  const el = _spId('spAct'), r = SP.act;
  if (!el || !r) return;
  const counts = spActivityCounts(r.rows), t = SP.f.act.type, rows = r.rows.filter(x => !t || x.type === t);
  const chips = '<button type="button" class="sp-chip' + (!t ? ' on' : '') + '" data-atype="" aria-pressed="' + (!t) + '">All <span class="n">' + r.rows.length + '</span></button>' +
    SP_ACTIVITY_TYPES.filter(k => counts[k]).map(k => '<button type="button" class="sp-chip' + (t === k ? ' on' : '') + '" data-atype="' + _spE(k) + '" aria-pressed="' + (t === k) + '">' + _spE(k) + ' <span class="n">' + counts[k] + '</span></button>').join('');
  const body = rows.map(x => '<tr><td class="tm">' + _spE(spDay(x.date)) + '</td><td>' + _spE(x.type) + (x.source !== 'Daily report' ? '<span class="sp-sub">' + _spE(x.source) + '</span>' : '') + '</td>' +
    '<th scope="row"><b>' + _spE(x.company || '—') + '</b>' + (x.person ? '<span class="sp-sub">' + _spE(x.person) + '</span>' : '') + '</th>' +
    '<td>' + _spE(x.purpose || '—') + (x.linkLabel || x.linkId ? '<span class="sp-sub">' + _spE(x.linkLabel || x.linkId) + '</span>' : '') + '</td><td>' + _spE(x.outcome || '—') + '</td>' +
    '<td>' + (x.nextAction ? _spE(x.nextAction) : '<span class="sp-dim">—</span>') + (x.nextDate ? '<span class="sp-sub">' + _spE(spDay(x.nextDate)) + '</span>' : '') + '</td>' +
    '<td class="num">' + (x.value === null || x.value === undefined ? '' : spMoney(x.value)) + '</td></tr>').join('');
  el.innerHTML = '<div class="sp-chips" role="group" aria-label="Kind">' + chips + '</div>' +
    '<p class="sp-count">' + _spE(spDay(r.from) + ' – ' + spDay(r.to)) + ' · ' + rows.length + ' line' + (rows.length === 1 ? '' : 's') + '</p>' +
    (rows.length ? '<div class="sp-scroll"><table class="sp-table sp-act sp-rows"><thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Customer</th><th scope="col">Purpose / need</th>' +
      '<th scope="col">Outcome</th><th scope="col">Next action</th><th scope="col" class="num">Opportunity</th></tr></thead><tbody>' + body + '</tbody></table></div>'
      : '<div class="sp-start"><p class="sp-start-t">No activity in this period</p><p class="sp-sub">Calls, visits, meetings and follow-ups logged in the daily report show here by themselves.</p></div>') +
    '<p class="sp-note">Nothing to type here: this is the daily report — calls, visits, meetings, site surveys, collection and quotation follow-ups, with their next action — plus each day\'s sent emails, visit plans marked done and the older call log.</p>';
}

/* ── the targets (the director and management) ──────────────────────────────────────────────────── */

function spTargetSheet(back) {
  const d = SP.data, p = d.plan;
  const rows = p.months.map((s, i) => '<tr><th scope="row">' + SP_MONTHS_LONG[i] + '</th><td><input type="text" class="sp-in sp-share" name="m' + i + '" inputmode="decimal" value="' + s + '" aria-label="' + SP_MONTHS_LONG[i] + ' share (%)"></td>' +
    '<td class="num" id="spTm' + i + '">' + spMoney(p.annual * s / 100) + '</td></tr>').join('');
  spSheet(_spFirst(d.user) + '\'s ' + d.year + ' target', 'The year target, how it spreads over the months, and what each account tier carries by default.',
    '<form class="sp-form" id="spTgtForm" autocomplete="off"><label>Year target (₱)<input type="text" class="sp-in" name="annual" inputmode="decimal" required value="' + p.annual + '"></label>' +
    '<fieldset class="sp-fs"><legend>Each account\'s default target by tier</legend><div class="sp-grid3">' + d.lists.tiers.map(t => '<label>Tier ' + t + '<input type="text" class="sp-in" name="t' + t + '" inputmode="decimal" value="' + p.tierTargets[t] + '"></label>').join('') + '</div></fieldset>' +
    '<div class="sp-sechead"><h4>The months</h4><button type="button" class="sp-link" data-even>Spread evenly</button></div>' +
    '<div class="sp-scroll"><table class="sp-table sp-split"><thead><tr><th scope="col">Month</th><th scope="col">Share (%)</th><th scope="col" class="num">Target</th></tr></thead><tbody>' + rows +
    '</tbody><tfoot><tr><th scope="row">Year</th><td id="spTotal"></td><td class="num" id="spTotalAmt"></td></tr></tfoot></table></div>' +
    '<p class="sp-err" id="spTgtErr" role="alert" hidden></p>' +
    '<div class="sp-formfoot"><span class="sp-sub">' + (p.set ? 'Last set by ' + _spE(p.updatedBy) : 'Not set yet — the default is showing') + '</span><button type="submit" class="btn btn-primary primary">Save the target</button></div></form>', back);
  const f = _spId('spTgtForm');
  const recalc = () => {
    const annual = Number(String(f.elements.annual.value).replace(/,/g, '')), chk = spSplitCheck(Array.from({ length: 12 }, (_, i) => f.elements['m' + i].value));
    chk.shares.forEach((s, i) => { const c = _spId('spTm' + i); if (c) c.textContent = isFinite(annual) && isFinite(s) ? spMoney(annual * s / 100) : '—'; });
    _spId('spTotal').innerHTML = '<b class="' + (chk.ok ? 'pos' : 'neg') + '">' + chk.total + '%</b>';
    _spId('spTotalAmt').textContent = isFinite(annual) ? spMoney(annual * chk.total / 100) : '—';
    spErr('spTgtErr', !(isFinite(annual) && annual >= 0) ? 'The year target is an amount in pesos.' : chk.error);
    return chk.ok && isFinite(annual) && annual >= 0 ? { annual, shares: chk.shares } : null;
  };
  f.addEventListener('input', recalc);
  f.addEventListener('click', (e) => { if (e.target.closest('[data-even]')) { spEvenSplit().forEach((s, i) => { f.elements['m' + i].value = s; }); recalc(); } });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = recalc();
    if (!ok) return;
    const tiers = {};
    for (const t of d.lists.tiers) { const v = Number(String(f.elements['t' + t].value).replace(/,/g, '')); if (!(isFinite(v) && v >= 0)) { spErr('spTgtErr', 'Tier ' + t + '\'s target is an amount in pesos.'); return; } tiers[t] = v; }
    const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
    const r = await postFlow('saveSalesPlanTarget', { user: d.user, year: d.year, annual: ok.annual, months: ok.shares, tierTargets: tiers, ifUpdatedAt: p.updatedAt || undefined }).catch(_spFail);
    btn.disabled = false;
    if (!r.success) { spErr('spTgtErr', r.message || 'Not saved.'); return; }
    spClose();
    _spToast(r.message || 'Saved.');
    spReload(true);
  });
  recalc();
}

/* ── the body's clicks, typing and choices ──────────────────────────────────────────────────────── */

function spBodyClick(e) {
  const t = e.target;
  if (t.closest('a')) return;
  let b;
  if ((b = t.closest('[data-aseg]'))) { SP.f.acc.seg = b.getAttribute('data-aseg'); spDrawBody(false); return; }
  if ((b = t.closest('[data-pseg]'))) { const k = b.getAttribute('data-pseg'); SP.f.pipe.seg = SP.f.pipe.seg === k && b.classList.contains('sp-stage') ? 'open' : k; spDrawBody(false); return; }
  if ((b = t.closest('[data-smonth]'))) { SP.f.sale.month = parseInt(b.getAttribute('data-smonth'), 10) || 0; spDrawBody(false); return; }
  if ((b = t.closest('[data-range]'))) { SP.f.act.range = b.getAttribute('data-range'); SP.f.act.type = ''; spDrawBody(false); return; }
  if ((b = t.closest('[data-atype]'))) { SP.f.act.type = b.getAttribute('data-atype'); spActivityDraw(); return; }
  if ((b = t.closest('[data-targets]'))) { spTargetSheet(b); return; }
  if ((b = t.closest('[data-lead]'))) { spOppSheet(null, b); return; }
  if ((b = t.closest('[data-acct]'))) { spAccountSheet(b.getAttribute('data-acct'), b); return; }
  if ((b = t.closest('[data-opp]'))) { const o = spOppOf(b.getAttribute('data-opp')); if (o) spOppSheet(o, b); }
}
function spBodyInput(e) {
  const id = e.target.id;
  if (id !== 'spAccQ' && id !== 'spPipeQ') return;
  (id === 'spAccQ' ? SP.f.acc : SP.f.pipe).q = e.target.value;
  const pos = e.target.selectionStart;
  spDrawBody(false);
  const el = _spId(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { /* fine */ } }
}
function spBodyChange() { /* every choice on the body is a button; nothing to do */ }
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const r = e.target && e.target.closest ? e.target.closest('tr[data-acct], tr[data-opp]') : null;
  if (!r || e.target !== r) return;
  e.preventDefault();
  r.click();
});

/* ── the sheet (a bottom sheet on phones, from apple.css / apple.js) ────────────────────────────── */

function spOverlay() {
  let ov = _spId('spOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay sp-overlay';
  ov.id = 'spOverlay';
  ov.innerHTML = '<div class="flow-modal sp-modal" role="dialog" aria-modal="true" aria-labelledby="spSheetTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (ev) => {
    if (ev.target === ov) { spClose(); return; }
    const b = ev.target.closest ? ev.target.closest('button') : null;
    if (b && b.hasAttribute('data-close')) spClose();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) spClose(); });
  return ov;
}
function spSheet(title, sub, html, back) {
  SP.back = back || null;
  const ov = spOverlay(), box = ov.querySelector('.sp-modal');
  box.innerHTML = '<div class="sp-sheet"><header class="sp-shead"><div><h3 id="spSheetTitle">' + _spE(title) + '</h3>' + (sub ? '<p class="sp-sub">' + _spE(sub) + '</p>' : '') + '</div>' +
    '<button type="button" class="btn btn-secondary sp-close" data-close>Close</button></header><div class="sp-sbody">' + html + '</div></div>';
  ov.classList.add('open');
  document.body.classList.add('sp-open-dlg');
  const first = box.querySelector('input:not([type="hidden"]), select, textarea');
  if (first && window.matchMedia && !window.matchMedia('(max-width: 600px)').matches) first.focus(); else { const c = box.querySelector('.sp-close'); if (c) c.focus(); }
}
function spClose() {
  const ov = _spId('spOverlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('sp-open-dlg');
  if (SP.back && SP.back.focus && document.body.contains(SP.back)) SP.back.focus();
}
function spErr(id, msg) { const el = _spId(id); if (!el) return; el.textContent = msg || ''; el.hidden = !msg; }

/* ── the workbook: the same nine sheets as Neil's file, filled in (Flask builds it from the same reads) ── */

async function spDownload(btn) {
  const d = SP.data;
  if (!d) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Preparing…';
  try {
    const res = await fetch('/flow/sales-plan-xlsx', { method: 'POST', headers: hxAuthHeaders({ 'Content-Type': 'application/json' }),
                                                       body: JSON.stringify({ user: SP.over ? d.user : '', year: d.year }) });
    if (!res.ok) { let m = 'HTTP ' + res.status; try { const j = await res.json(); if (j && j.message) m = j.message; } catch (e) { /* not JSON */ } throw new Error(m); }
    const blob = await res.blob(), u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = 'Sales plan ' + d.year + ' - ' + d.user + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
    _spToast('Downloaded the ' + d.year + ' workbook.');
  } catch (e) { _spToast('Download: ' + (e && e.message || e), 'warn'); }
  finally { btn.disabled = false; btn.textContent = label; }
}
