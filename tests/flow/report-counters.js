/* A280 — the counters on a submitted daily report, as the management and HR cards show them.
 *
 * Run:  node tests/flow/report-counters.js
 *
 * 'Counts JSON' IS NOT ONE SHAPE, and that is the whole reason this is a per-role map rather than
 * an Object.entries() dump:
 *
 *   sales / admin      flowActivityCounts().byModule — {"Quotation":3,"Pricing Request":1}
 *                      Those exact numbers are ALREADY on the card as mod-badges two lines up, so a
 *                      generic renderer prints them twice.
 *   accounting         metrics are PESO AMOUNTS. As bare integers they read as counts of things.
 *   leadgen            fifteen keys, of which nine are the quotas, five are weekly figures returned
 *                      per-day so the week can be summed, and one — 'working' — is a BOOLEAN.
 *
 * So the map decides, and a role with no entry renders nothing. That silence is the feature: a role
 * that starts sending counts shows none until somebody writes down what its keys mean, which is the
 * right default for a number on a manager's screen.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');

const SRC = path.join(__dirname, '..', '..', 'dashboard', 'js', 'report-render.js');
const ctx = { console, document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: () => null }, setTimeout: () => 0 };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);
const counters = ctx.flowReportCounters, html = ctx.flowReportCountersHtml;

/* The real payload getLeadgenCounts puts in countsJson — quotas, weekly extras, and `working`. */
const LEADGEN_DAY = {
  attempts: 45, conversations: 6, emails: 28, linkedin: 7, suppliers: 4, accounts: 12,
  crm: 31, eod: 1, scheduled: 2,
  leads: 3, meetings: 1, suppliersHandedOff: 0, intelUpdates: 2, introEmails: 20, replies: 1,
  working: true
};

/* ── 1 · a lead-gen report ─────────────────────────────────────────────────────────────────── */
{
  sec('1 · a lead-gen report');
  const rows = counters({ role: 'leadgen', counts: LEADGEN_DAY });
  ok('eight chips', rows.length === 8, rows);
  ok('in map order, starting with the headline number', rows[0][0] === 'Outbound attempts' && rows[0][1] === 45, rows[0]);
  ok('decision-makers reached is second', rows[1][0] === 'Decision-makers reached' && rows[1][1] === 6);
  const labels = rows.map(r => r[0]).join(' | ');
  ok('the eight are the nine minus the report itself', labels ===
     'Outbound attempts | Decision-makers reached | Prospecting emails | LinkedIn touches | ' +
     'Suppliers researched | Target accounts researched | CRM records touched | Meetings / calls scheduled', labels);
  /* 'eod' is 1 by definition on a card that exists, and the card's header already says when. */
  ok('eod is NOT rendered — it is a tautology on a submitted report', !/report submitted/i.test(labels) && rows.every(r => r[1] !== undefined));
  ok('`working` — a BOOLEAN — is never rendered', rows.every(r => typeof r[1] === 'number'), rows);
  ['leads', 'meetings', 'suppliersHandedOff', 'intelUpdates', 'introEmails', 'replies'].forEach(k =>
    ok('the weekly figure `' + k + '` is not on a DAILY card', !rows.some(r => r[1] === LEADGEN_DAY[k] && /week/i.test(r[0]))));
  ok('a zero renders as a zero, not as a gap', counters({ role: 'leadgen', counts: Object.assign({}, LEADGEN_DAY, { linkedin: 0 }) })[3][1] === 0);
}

/* ── 2 · every other role renders NOTHING ──────────────────────────────────────────────────── */
{
  sec('2 · the roles whose counts are already on the card, or are not counts');
  // report-submit.js sends flowActivityCounts().byModule — the mod-badges the card already draws.
  ok('a SALES report renders nothing', counters({ role: 'sales', counts: { Quotation: 3, 'Pricing Request': 1 } }).length === 0);
  ok('an ADMIN report renders nothing', counters({ role: 'admin', counts: { 'Purchase Order': 2, Shipment: 1 } }).length === 0);
  // accounting-daily-report.js sends peso amounts — integers that would read as counts of things.
  ok('an ACCOUNTING report renders nothing', counters({ role: 'accounting', counts: { Invoice: 4 },
      metrics: { salesInvoiced: 120000, apPaid: 43000, received: 88000 } }).length === 0);
  ok('a role with no map entry renders nothing rather than dumping its keys',
     counters({ role: 'marketing', counts: { anything: 9, atAll: 4 } }).length === 0);
  ok('and so does a role invented later', counters({ role: 'procurement-2027', counts: { x: 1 } }).length === 0);
}

/* ── 3 · the shapes a real sheet actually produces ─────────────────────────────────────────── */
{
  sec('3 · missing, empty and broken payloads');
  ok('a key absent from the payload is skipped, not shown as 0',
     counters({ role: 'leadgen', counts: { attempts: 40 } }).length === 1);
  ok('counts:{} renders nothing', counters({ role: 'leadgen', counts: {} }).length === 0);
  ok('counts:null renders nothing', counters({ role: 'leadgen', counts: null }).length === 0);
  ok('no sub at all renders nothing', counters(null).length === 0 && counters(undefined).length === 0);
  ok('no role renders nothing', counters({ counts: LEADGEN_DAY }).length === 0);
  ok('the role is matched case-insensitively', counters({ role: 'LeadGen', counts: LEADGEN_DAY }).length === 8);
  ok('a null value is skipped', counters({ role: 'leadgen', counts: Object.assign({}, LEADGEN_DAY, { crm: null }) }).length === 7);
}

/* ── 4 · the chip row both cards share ─────────────────────────────────────────────────────── */
{
  sec('4 · the rendered row');
  const h = html({ role: 'leadgen', counts: LEADGEN_DAY });
  ok('eight chips in the markup', (h.match(/<span style="display:inline-flex/g) || []).length === 8);
  ok('the number leads, the label follows', /<b[^>]*>45<\/b><span[^>]*>Outbound attempts<\/span>/.test(h), h.slice(0, 220));
  ok('a role with nothing to show renders an EMPTY STRING, not an empty div',
     html({ role: 'sales', counts: { Quotation: 3 } }) === '');
  ok('the label is escaped', /&amp;|&lt;/.test(ctx.flowReportCountersHtml({ role: 'leadgen', counts: { attempts: 1 } })) === false);
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
