/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   purchase-request-tracker.js — A226. The rep's own view of every request they raised.

   READ-ONLY BY CONSTRUCTION, and that is deliberate. Sourcing, pricing, verification and Create
   Quotation all stay on flow-pricing-request.html; this page links to them. Two pages that can both
   advance a request would eventually disagree with the server's stage gates. Same shape as
   flow-payments.html (A223): it reports, and every action happens in the record that owns it.

   NOT pr-tracker.html — that name belongs to the old pre-flow admin page on the legacy Code.gs
   backend. Different auth, different fields, different status vocabulary. It is not touched here.

   COMMISSION AND MARGIN ARE NEVER RENDERED. getPricingRequests carries both on every row (they are
   margin components priced into the selling price — a company cost), which is why the fetch below
   passes { noStore: true }: without it the payload sits in sessionStorage for 60s and survives
   navigation. A191 took cost visibility away from admin and this must not put it back.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

let prtSession = null;
let prtPRs = [], prtQuoByNo = {}, prtList = null, prtBoard = null, prtCfg = {};
let prtView = 'worklist';
let prtPicked = '';
let prtSearch = '';
let prtHasQuotationNo = false;   // does the backend emit it, or must we join client-side?

/* A228 — the icon set, inline Feather at the sizes the design calls for.
 *
 * Inline SVG is this codebase's convention everywhere (auth.js carries 75 of them, every KPI chip on
 * flow-invoices / flow-shipments / flow-quotations is one). No icon font, no sprite — so these live
 * beside the markup that uses them rather than being fetched. `stroke="currentColor"` throughout, so
 * a chip's colour is set once in CSS and the glyph follows it. */
const PRT_ICON = {
  warn: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  chat: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  findingWarn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
};

/** Oversight sees everyone; sales sees their own. The same rule flow-quotations.js:123,
 *  quotation-board.js:71 and client-tracker.js:62 all state — written the same way so the most
 *  permissive copy can never quietly become the policy. */
function prtIsOversight() {
  return String((prtSession || {}).role || '').toLowerCase() !== 'sales';
}

document.addEventListener('DOMContentLoaded', async () => {
  prtSession = requirePricingFlowAccess();
  if (!prtSession) return;
  renderNavbar('purchase-request-tracker');
  if (typeof renderFlowNav === 'function') renderFlowNav('purchase-request-tracker.html');
  const pb = document.getElementById('prtPrint');
  if (pb) pb.addEventListener('click', () => window.print());
  document.querySelectorAll('#prtViews button').forEach(b => {
    b.addEventListener('click', () => {
      prtView = b.getAttribute('data-view');
      document.querySelectorAll('#prtViews button').forEach(x => x.classList.toggle('on', x === b));
      prtRender();
    });
  });
  if (prtIsOversight()) prtView = 'stage';          // oversight wants the summary, not one rep's list
  document.querySelectorAll('#prtViews button').forEach(x =>
    x.classList.toggle('on', x.getAttribute('data-view') === prtView));
  await prtReload();
});

async function prtReload() {
  const body = document.getElementById('prtBody');
  body.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading…</span></div>';
  try {
    const mine = prtIsOversight() ? {} : { requestedBy: prtSession.name };
    /* noStore: the payload carries commission and margin whether or not this page renders them.
       Same reason admin.js:160 does it. */
    const [pr, quo, cfg] = await Promise.all([
      fetchFlow('getPricingRequests', mine, { fresh: true, noStore: true }),
      fetchFlow('getQuotations', {}, { fresh: true }),
      fetchFlow('getFlowSettings', {}).catch(() => ({ data: {} }))
    ]);
    prtPRs = (pr && pr.data) || [];
    prtCfg = (cfg && cfg.data) || {};
    prtQuoByNo = {};
    ((quo && quo.data) || []).forEach(q => { prtQuoByNo[String(q.quotationNo)] = q; });

    /* A226 — does the deployed backend emit quotationNo yet?
       Below v130 it does not, and the client join can only see Quotations['PR No'] — blind to the
       prose fallback that resolves 41 of the 76 live Quoted requests. So the page falls back, and
       SAYS it is falling back, rather than reporting 41 live deals as unquoted. */
    prtHasQuotationNo = prtPRs.some(p => p.quotationNo !== undefined);
    if (!prtHasQuotationNo) {
      /* A227 — a LIVE quotation beats a retired one, the same rule _quoPickForPR applies on the
         server. First-wins handed a revised request its own cancelled document, because Close
         leaves the retired one as the EARLIER sheet row and the replacement is written after it. */
      const cands = {};
      ((quo && quo.data) || []).forEach(q => {
        const k = String(q.prNo || '');
        if (k) (cands[k] = cands[k] || []).push(q);
      });
      const byPR = {};
      Object.keys(cands).forEach(k => {
        const live = cands[k].filter(q => FLOW_Q_CLOSED_STATUSES.indexOf(String(q.status)) === -1);
        const pool = live.length ? live : cands[k];
        byPR[k] = String(pool[pool.length - 1].quotationNo);
      });
      prtPRs.forEach(p => {
        p.quotationNo = byPR[String(p.prNo)] || '';
        p.quotationNoSource = p.quotationNo ? 'column' : '';
        p.salesperson = p.salesperson || p.requestedBy || '';
      });
    }

    /* A226 — tell the engine when the quotation link is UNVERIFIABLE rather than absent. Without
       this the fallback path reported 30 of one rep's requests as "quotation missing" on first load,
       when in truth the page simply could not see the server's Notes fallback. */
    if (!prtHasQuotationNo) prtCfg = Object.assign({}, prtCfg, { prQuotationLinkUnverified: true });
    prtList = pricingRequestWorklist(prtPRs, {}, prtQuoByNo, prtCfg, flowToday());
    /* The four lanes, derived from that one list rather than re-filtered. Splitting `now` into what
       the rep can finish and what they can only chase is the change the live data forced: 61 of one
       rep's 67 "needs you now" were somebody else's queue. */
    prtBoard = pricingRequestWorklistBoard(prtList);
    /* Open on the rep's OWN top item, not merely the top of `now` — with 61 chases sorted above her
       six real jobs on some boards, "the first row" is the wrong thing to land on. */
    const first = prtBoard.lanes.yours[0] || prtBoard.lanes.chase[0] || prtList.rows[0];
    if (!prtPicked && first) prtPicked = first.prNo;
    prtRender();
  } catch (e) {
    body.innerHTML = `<div class="prt-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`;
  }
}

/* ── the headline ──────────────────────────────────────────────────────────────────────────────
   Every tile comes from ONE rollup, now read through ONE board. A208 found a tile reading P10.7M
   above a counter reading P18.4M for the same rep, because each filtered separately.

   THE TILES ANSWER "WHAT CAN I FINISH MYSELF" FIRST. The first cut led with a single "needs you
   now" number, and on live data that number was 67 for one rep - of which 6 were hers and 61 were
   other people's queues gone past their threshold. Nobody reads a to-do list of 67 things twice,
   and 61 of them she could not have finished anyway. */
function prtKpis() {
  const L = prtList, B = prtBoard;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const money = v => flowMoney(v, 'PHP');
  const live = L.rows.filter(r => r.step !== 'migrated');
  const mig = L.counts.total - live.length;

  const bad = L.rows.filter(r => r.step === 'quotation-gone');
  const quoted = L.rows.filter(r => r.step === 'quoted' || r.step === 'send-quote');
  const unsent = L.rows.filter(r => r.step === 'send-quote');

  set('kYours', String(B.counts.yours));
  set('kYoursSub', B.value.yours > 0 ? money(B.value.yours) + ' in play' : 'nothing priced yet');
  set('kChase', String(B.counts.chase));
  set('kChaseSub', B.counts.chase ? ('with admin / management, oldest ' + B.oldest.chase + 'd')
                                  : 'nobody is sitting on your work');
  set('kWait', String(B.counts.waiting));
  set('kWaitSub', B.counts.waiting ? ('oldest ' + B.oldest.waiting + 'd, still inside the agreed time')
                                   : 'nothing in flight');
  set('kQuoted', String(quoted.length));
  set('kQuotedSub', unsent.length ? (unsent.length + ' not sent yet') : 'all sent');
  set('kBad', String(bad.length));
  /* A red zero claims an alarm that is not there. The colour is earned by there being something to
     check, so it is applied here rather than baked into the markup — the same rule that makes an
     unpriced request show a dash instead of ₱0.00. */
  const badEl = document.getElementById('kBad');
  if (badEl) badEl.classList.toggle('k-bad', bad.length > 0);

  const cap = document.getElementById('prtCap');
  if (cap) {
    /* The exclusion is STATED, never silent. 45% of this book is imported history; a tracker that
       quietly drops it is a tracker nobody can reconcile. */
    cap.innerHTML = live.length + ' live request' + (live.length === 1 ? '' : 's')
      + (mig ? ' · <a onclick="prtGo(\'history\')">' + mig + ' imported records excluded</a>' : '')
      + (prtHasQuotationNo ? ''
         : ' · <span style="color:#b45309;">the backend has not been updated yet, so a request whose '
           + 'quotation is only recorded in its notes will read as unquoted</span>');
  }
  prtFinding();
}
/* THE ONE SENTENCE WORTH A BANNER. When a single step holds most of what is open, the rep is not
   looking at 58 problems — they are looking at ONE problem 58 times, and those read completely
   differently. Silent unless prwConcentration finds something: a banner that always fires is
   wallpaper, and this page already asks for enough attention. */
function prtFinding() {
  const box = document.getElementById('prtFinding');
  if (!box) return;
  const c = prwConcentration(prtList);
  if (!c) { box.innerHTML = ''; return; }
  const mine = !prtIsOversight();
  const whose = c.hands === 'them'
    ? (mine ? 'None of them moves until somebody else acts — that is one conversation, not ' + c.n + '.'
            : 'These sit in admin and management queues, not with the rep.')
    : (mine ? 'Every one of these is yours to finish.' : 'These are the reps\' own to finish.');
  box.innerHTML = `<div class="prt-finding"><span class="ic">${PRT_ICON.findingWarn}</span><span class="tx">
      <b>${c.n} of the ${c.of} open request${c.of === 1 ? '' : 's'}</b> are the same thing:
      <b>${flowEsc(String(c.title).toLowerCase())}</b> — ${c.share}% of everything open, the oldest
      sitting <b>${c.oldest} days</b>${c.value > 0 ? ', ' + flowMoney(c.value, 'PHP') + ' between them' : ''}.
      ${flowEsc(whose)} <a onclick="prtGo('stage')">See it by stage</a></span></div>`;
}

function prtGo(v) {
  prtView = v;
  document.querySelectorAll('#prtViews button').forEach(x =>
    x.classList.toggle('on', x.getAttribute('data-view') === v));
  prtRender();
}

/* ── the rail ────────────────────────────────────────────────────────────────────────────────────
   FOUR LANES, NOT THREE. `now` splits on whose move it is; `waiting` and `done` pass through. The
   sub-line under each heading is the whole argument in one clause — two lanes can both be urgent
   and still need completely different behaviour from the reader. */
const PRT_LANE_SUB = {
  yours:   'you can finish these without anybody else',
  chase:   'past the agreed time, in somebody else\'s queue',
  waiting: 'with admin or management, not yet late',
  done:    'quoted, or imported history'
};

function prtMatches(r) {
  if (!prtSearch) return true;
  const q = prtSearch.toLowerCase();
  return String(r.prNo).toLowerCase().indexOf(q) !== -1 ||
         String(r.customer).toLowerCase().indexOf(q) !== -1 ||
         String(r.quotationNo).toLowerCase().indexOf(q) !== -1 ||
         String(r.owner).toLowerCase().indexOf(q) !== -1;
}

function prtRailRow(r, lane) {
  const s = PRW_STEPS[r.step] || {};
  /* AGE TRAVELS WITH EVERY ROW. Without it, finding the one 41-day-old request among 58 identical
     "stuck in sourcing" lines means opening all 58. `overdueBy` says how far past the threshold;
     `days` says how long in total. Both are facts the engine already carries. */
  const age = (r.days === null || r.days === undefined) ? ''
    : ` <span class="age${r.overdueBy > 0 ? ' hot' : ''}">· ${r.days}d</span>`;
  return `<button class="prt-row${r.prNo === prtPicked ? ' on' : ''}" onclick="prtPick('${flowEsc(r.prNo)}')">
    <div class="t"><span class="no">${flowEsc(r.prNo)}</span>
      <span class="v">${r.priced ? flowMoney(r.value, 'PHP') : '—'}</span></div>
    <div class="c">${flowEsc(String(r.customer || '(no client)').slice(0, 40))}</div>
    <div class="s ${lane}">${flowEsc(s.title || r.step)}${age}</div>
  </button>`;
}

function prtRail() {
  const B = prtBoard;
  /* WHICH LANES OPEN. `yours` always — it is the reason to come here. `chase` opens only when there
     is nothing of your own left, because 61 open rows above your own six would bury them. */
  const open = { yours: true, chase: !B.counts.yours, waiting: false, done: false };
  const lanes = PRW_LANES.map(k => {
    const rows = B.lanes[k].filter(prtMatches);
    if (!rows.length) return '';
    return `<details class="prt-grp ${k}"${open[k] ? ' open' : ''}>
      <summary><span class="lane-t">${flowEsc(PRW_LANE_LABEL[k])}
          <span class="lane-h">${flowEsc(PRT_LANE_SUB[k] || '')}</span></span>
        <span class="n">${rows.length}</span></summary>
      ${rows.map(r => prtRailRow(r, k)).join('')}
    </details>`;
  }).join('');
  return `<aside class="prt-rail">
    <div class="prt-searchbox">
      ${PRT_ICON.search}
      <input class="prt-search" type="search" placeholder="Search PR no. or client…"
             value="${flowEsc(prtSearch)}" oninput="prtFind(this.value)">
    </div>
    ${lanes || '<div class="prt-empty">Nothing matches.</div>'}
  </aside>`;
}
function prtFind(v) { prtSearch = v; prtRender(); }
function prtPick(no) { prtPicked = no; prtRender(); }

/* ── the pane: one request, in full ───────────────────────────────────────────────────────────── */
const PRT_DOTS = ['Request', 'Sourcing', 'Pricing', 'Verify', 'Quotation', 'Sent'];
/* Which dot a stored status has REACHED — the stage now in progress, with everything before it done.
 *
 * These agree with STEP_OF on flow-pricing-request.js:15, shifted to 0-based for six labels. The one
 * worth stating: 'Returned to Sales' (displayed "For Quotation") sits at QUOTATION, not Verify —
 * verification is finished and the request is back with the rep. Marking it at Verify reads as
 * "still being checked", which is exactly the confusion this tracker exists to end. */
const PRT_AT = {
  'Requested': 0, 'Sourcing': 1, 'For Mgmt Pricing': 2, 'Mgmt Priced': 3,
  'Returned to Sales': 4, 'Quoted': 5, 'Migrated': 0
};

function prtDots(r) {
  let at = PRT_AT[r.status];
  if (at === undefined) at = 0;
  /* The sixth dot is the QUOTATION'S own life, which is the join this tracker was asked for. A
     quotation that has reached the client completes the chain; one still sitting internally leaves
     'Sent' as the outstanding step. */
  if (r.step === 'quoted') at = PRT_DOTS.length;      // every dot done
  return `<div class="prt-rail6">${PRT_DOTS.map((l, i) => {
    const cls = i < at ? 'done' : (i === at ? 'at' : '');
    return `<div class="prt-dot ${cls}"><div class="b"></div><div class="l">${l}</div></div>`;
  }).join('')}</div>`;
}

/* Every table on this page scrolls inside its own box.
 *
 * A four-column flow-table is about 540px and a five-column one about 740px; the pane is 317px on a
 * phone. Without this the columns run off the side of the card and the reader cannot reach them —
 * the page itself does not scroll sideways, so there is no clue that anything was cut. Measured, not
 * assumed: the items table hit 1077px in a 317px column before it got the same wrapper. */
function prtScroll(tableHtml) { return '<div style="overflow-x:auto;">' + tableHtml + '</div>'; }

/* A228 — WHO MAY SEE A BUY PRICE. Verbatim the list flow-quotations.js:14 declares for A191:
   "accounting/management/director only — never admin, never sales". The tracker's main reader is the
   rep, and a supplier price sitting beside the selling price already on screen hands them the margin —
   the one thing this file's own header promises never to render. So the design's price column stays
   exactly where it is and only its MEANING changes with the reader. */
const PRT_COST_ROLES = ['accounting', 'management', 'director'];
function prtCanSeeCosts() {
  return PRT_COST_ROLES.indexOf(String((prtSession || {}).role || '').toLowerCase()) >= 0;
}

function prtItems(pr) {
  const items = pr.items || [];
  if (!items.length) return '<div class="prt-note">No lines on this request.</div>';
  const cost = prtCanSeeCosts();
  /* THE TOTAL MUST SUM THE COLUMN ABOVE IT. prValue() sums qty x finalPrice — the selling value — so
     under the cost view it would print a selling total beneath a column of buy prices, labelled
     "estimated cost". Same shape, same honesty rule as prValue: `priced` stays false when nothing
     carries a figure, so the footer shows a dash rather than a 0 nobody agreed. */
  const v = cost ? (function () {
    let t = 0, any = false;
    items.filter(i => i && i.included).forEach(i => {
      const p = Number(i.supplierPrice) || 0;
      if (p > 0) any = true;
      t += (Number(i.qty) || 0) * p;
    });
    return { value: Math.round(t * 100) / 100, priced: any };
  })() : prValue(pr);
  /* Four columns, not eight. Description, UOM, Supplier and Principal were reference detail that
     pushed the table to 1077px inside a 317px column on a phone; the three numbers that answer "what
     is this and has it come back" are what the pane is for. The rest stays one click away on the
     pricing request itself.

     STATE IS THE LAST COLUMN on purpose: the total row's colspan then needs no arithmetic, which is
     exactly the silent misalignment a mid-table insert causes. */
  return `<div class="prt-tw"><div>
  <table class="flow-table flow-items"><thead><tr>
      <th>Item</th><th class="num">Qty</th>
      <th class="num">${cost ? 'Supplier price' : 'Unit price'}</th><th>State</th></tr></thead><tbody>
    ${items.map(i => {
      /* The badge must agree with the number in its own row, so both read the same field. An EXCLUDED
         line is nobody's outstanding work — it gets a dash, never an amber "awaiting", which would
         invent a chore for a line somebody deliberately dropped. */
      const shown = cost ? flowNum(i.supplierPrice) : flowNum(i.finalPrice);
      const state = !i.included ? '<span class="flow-badge b-draft">Not included</span>'
        : shown > 0 ? '<span class="flow-badge b-paid">Priced</span>'
                    : '<span class="flow-badge b-pending">Awaiting price</span>';
      return `<tr${i.included ? '' : ' style="opacity:.5;"'}>
      <td>${flowEsc(String(i.itemName || i.itemNo || '—').slice(0, 52))}</td>
      <td class="num">${flowNum(i.qty)}${i.uom ? ' ' + flowEsc(i.uom) : ''}</td>
      <td class="num"${shown > 0 ? '' : ' style="color:#8b93a1;"'}>${shown > 0 ? flowMoney(shown, 'PHP') : '—'}</td>
      <td>${state}</td></tr>`;
    }).join('')}
    <tr class="tot"><td colspan="2">${cost ? 'Estimated cost' : 'Estimated value'}</td>
        <td class="num">${v.priced ? flowMoney(v.value, 'PHP') : '—'}</td><td></td></tr>
  </tbody></table></div></div>
  ${v.priced ? '' : '<div class="prt-note">Nothing has been priced yet, so no total is shown — a zero here would state a cost nobody has agreed.</div>'}`;
}

/* The quotation as a CARD rather than a paragraph — it is a different record with its own life, and
   the sixth dot on the rail is exactly this join. */
function prtQuotationBlock(r, q) {
  if (!r.quotationNo) {
    /* Two different blanks, and conflating them was the A215/A217 mistake: a request that has not
       been quoted yet, versus one marked Quoted whose link this page cannot resolve. Only the
       second deserves the backend caveat — putting it on the first reads as though the page is
       broken when in fact there is simply no quotation. */
    const unresolved = r.status === 'Quoted' && !prtHasQuotationNo;
    return `<div class="prt-card"><div class="mt">${unresolved
      ? 'Marked quoted, but this page cannot yet say which quotation — the link lives in the request\'s '
        + 'notes and only the updated backend reads those.'
      : 'No quotation yet. It appears here the moment one is created from this request.'}</div></div>`;
  }
  if (!q) {
    return `<div class="prt-card" style="border-color:#fca5a5;background:#fef2f2;">
      <div class="hd"><b>${flowEsc(r.quotationNo)}</b></div>
      <div class="prt-warn" style="margin-top:.3rem;">No quotation of that number exists any more — it was
      deleted or renumbered after the link was written. The link is the only trace left.</div></div>`;
  }
  const net = (typeof flowQuotationNet === 'function') ? flowQuotationNet(q) : flowNum(q.total);
  const sent = flowDate(q.sentAt);
  const est = String(q.sentAtBasis || '').trim();
  return `<div class="prt-card">
    <div class="hd">
      <a class="link-btn" href="flow-quotations.html" title="Open Quotations"><b>${flowEsc(r.quotationNo)}</b></a>
      ${typeof flowStatusBadge === 'function' ? flowStatusBadge(q.status) : flowEsc(q.status)}
      <span style="margin-left:auto;font-weight:800;font-variant-numeric:tabular-nums;">${flowMoney(net, 'PHP')}</span>
    </div>
    <div class="mt">${sent
      ? 'Sent to the client ' + flowEsc(sent) + (est ? ' <span style="color:#b45309;">(estimated — no send date was recorded)</span>' : '')
      : 'Not sent to the client yet.'}</div>
    ${r.quotationNoSource === 'notes'
      ? '<div class="mt">This link comes from the request\'s own notes rather than from the quotation, so it is a weaker claim than a stored link.</div>'
      : ''}
  </div>`;
}

/* THE CLIENT CARD — the contact half only, and that is a decision rather than an omission.
 *
 * Contact details are free: the create form writes them onto the request itself as Doc JSON
 * (flow-pricing-request.js:339-345), so they arrive in the payload this page already fetches.
 *
 * The design also shows "7 orders · ₱1.21M lifetime · last quote won Feb 14". That is NOT built, for
 * three reasons worth keeping written down:
 *   • getSalesOrders takes no parameters — it returns every order in the company. A sales rep would
 *     read other reps' order counts and peso totals for the client, on a page whose scoping rule is
 *     that sales sees only their own;
 *   • clientRollup().value sums quotations INCLUDING lost ones. It is not lifetime order value, and
 *     printing it as one would put a second, unreconciled money figure on a page whose tiles all come
 *     from a single rollup by design;
 *   • "last quote won" is produced by no existing code at all.
 * The Client Tracker already owns the relationship view and labels its own client-name guessing; a
 * link there beats a number this page cannot stand behind. */
function prtClientBlock(r, pr) {
  let doc = {};
  try { doc = JSON.parse(pr.docJson || '{}') || {}; } catch (e) { doc = {}; }
  const who = String(doc.contactPerson || '').trim();
  const role = String(doc.designation || '').trim();
  const mail = String(doc.contactEmail || '').trim();
  const tel = String(doc.contactPhone || '').trim();
  const where = [pr.plantSite, pr.clientLocation].filter(Boolean).join(' · ');
  const link = 'client-tracker.html';

  /* Doc JSON is written only by the current create form, so imported and older requests carry none.
     Say that, rather than rendering a card that looks broken. */
  const body = who
    ? `${flowEsc(who)}${role ? ', ' + flowEsc(role) : ''}${
        mail || tel ? '<br>' + flowEsc([mail, tel].filter(Boolean).join(' · ')) : ''}`
    : 'No contact was recorded on this request.';

  return `<div class="prt-card">
    <div class="hd"><b>${flowEsc(r.customer || '(no client named)')}</b>
      <span class="flow-badge prt-b-client">Client</span></div>
    <div class="mt">${body}${where ? '<br>' + flowEsc(where) : ''}</div>
    <div class="mt"><a class="link-btn" href="${link}">See this client's full history &rarr;</a></div>
  </div>`;
}

/* WHAT HAPPENED — built only from facts this page already holds.
 *
 * The plan called for flowLedgerHistoryBlock here. That helper is for LEDGER history: it hard-codes
 * the note "not included in the totals above", which is meaningless under an activity list, and it
 * would need an ActivityLog fetch this page does not make. There are no per-stage timestamps on a
 * request either — only the date it was raised — so a stage-by-stage timeline would be invented.
 *
 * So this shows the three moments that ARE recorded, and says plainly that it is not the full log.
 * An empty rung is left visible rather than dropped: "not sent yet" is information. */
function prtTimeline(r, pr, q) {
  const raised = flowDate(pr.date);
  const li = (on, when, what) =>
    `<li class="${on ? 'on' : ''}"><b>${flowEsc(what)}</b><br><span class="w">${flowEsc(when)}</span></li>`;
  let out = li(true, raised || 'date not readable', 'Request raised by ' + (r.owner || 'somebody unnamed'));
  if (r.quotationNo) {
    out += li(!!q, q ? 'quotation ' + r.quotationNo : r.quotationNo + ' — no longer exists',
              q ? 'Became a quotation' : 'Linked to a quotation that is gone');
    const sent = q ? flowDate(q.sentAt) : '';
    out += li(!!sent, sent || 'not yet', sent ? 'Sent to the client' : 'Not sent to the client');
  } else {
    out += li(false, 'nothing recorded', 'No quotation yet');
  }
  return `<ul class="prt-tl">${out}</ul>
    <div class="prt-note" style="margin-top:.4rem;">These are the moments this page can see. Sourcing,
    pricing and verification are not timestamped on the request, so they are shown as stages above
    rather than as dated events here.</div>`;
}

/* THE STATUS PILL — the answer to "what is this waiting on", beside the name.
 *
 * Its words come from PRW_STEPS[step].title and nowhere else. The vocabulary already runs to four
 * names for one stage — stored status 'Mgmt Priced', step title 'Waiting on verification', dot label
 * 'Verify', pipeline column 'Verify' — and inventing a fifth here is precisely the confusion this
 * page was built to end. flowStatusBadge() is deliberately NOT used: it maps QUOTATION statuses and
 * would stamp a blue "Sent" on a purchase request.
 *
 * Colour reads the two axes the engine already publishes: `group` says how urgent, `hands` says whose
 * move. Red is reserved for what the reader can finish themselves. */
function prtStatusPill(r, s) {
  const hands = s.hands || 'unclear';
  const cls = r.group === 'now' ? (hands === 'you' ? 'prt-b-hot' : 'b-pending')
            : r.group === 'waiting' ? 'b-draft'
            : (r.step === 'migrated' ? 'b-lost' : 'b-paid');
  const age = (r.days === null || r.days === undefined) ? ''
            : ' · ' + r.days + (r.days === 1 ? ' day' : ' days');
  return `<span class="flow-badge ${cls}">${flowEsc(s.title || r.step)}${age}</span>`;
}

/* SOURCED — how many included lines carry a supplier price yet.
 *
 * Shown ONLY at Requested and Sourcing, and that restriction is the whole point. _sourcingGaps
 * (FlowAPI.gs) refuses to let a request leave sourcing until every included line has a price, so from
 * 'For Mgmt Pricing' onward this can only ever read "N of N" — a stat that cannot vary is furniture.
 * Where it CAN vary is exactly where the board is jammed: the 61 chases.
 *
 * Called SOURCED, not "supplier replies": there is no reply timestamp and no per-line status anywhere
 * in the schema. The number is what admin typed, and the label should not claim to know more.
 * Costs nothing — supplierPrice is already in the payload and is used here only as a count. */
function prtSourcedStat(pr, r) {
  if (r.status !== 'Requested' && r.status !== 'Sourcing') return '';
  const inc = (pr.items || []).filter(i => i && i.included);
  if (!inc.length) return '';
  const got = inc.filter(i => Number(i.supplierPrice) > 0).length;
  return `<div>Sourced<b>${got} of ${inc.length}</b></div>`;
}

function prtPane() {
  const r = prtList.rows.filter(x => x.prNo === prtPicked)[0];
  if (!r) return '<section class="prt-pane"><div class="prt-empty">Pick a request from the list.</div></section>';
  const pr = prtPRs.filter(x => String(x.prNo) === String(r.prNo))[0] || {};
  const q = prtQuoByNo[String(r.quotationNo)] || null;
  const s = PRW_STEPS[r.step] || {};
  const hands = s.hands || 'unclear';
  const loc = [pr.plantSite, pr.clientLocation].filter(Boolean).join(' · ');

  const raised = flowDate(pr.date);
  const sub = [
    loc,
    raised ? 'raised ' + raised : '',
    hands === 'you' ? 'yours to do' : hands === 'them' ? 'with somebody else' : ''
  ].filter(Boolean).join(' · ');

  return `<section class="prt-pane">
    <div class="prt-head">
      <div class="ttl">
        <div>
          <h2>${flowEsc(r.prNo)} &mdash; ${flowEsc(r.customer || '(no client named)')}</h2>
          <div class="sub">${flowEsc(sub)}</div>
        </div>
        ${prtStatusPill(r, s)}
      </div>
      <div class="prt-stats">
        <div>Value<b>${r.priced ? flowMoney(r.value, 'PHP') : '—'}</b></div>
        <div>Lines<b>${r.included === r.lines ? r.lines : r.included + ' of ' + r.lines}</b></div>
        ${prtSourcedStat(pr, r)}
        <div>Age<b>${r.days === null || r.days === undefined ? '—' : r.days + (r.days === 1 ? ' day' : ' days')}</b></div>
        ${prtIsOversight() ? `<div>Owner<b>${flowEsc(r.owner || '—')}</b></div>` : ''}
      </div>
    </div>

    ${prtDots(r)}

    <div class="prt-next ${hands === 'you' ? 'now' : r.group}">
      <div class="k">${hands === 'you' ? 'Yours to do'
                     : hands === 'them' ? (r.group === 'now' ? 'Chase — it is late' : 'Waiting on')
                     : 'Outcome'}</div>
      <div class="t">${flowEsc(s.title || r.step)}</div>
      <div class="d">${flowEsc(r.detail || '')}</div>
      ${s.verb ? `<div style="margin-top:.5rem;">
        <a class="btn btn-sm btn-primary" href="flow-pricing-request.html">${flowEsc(s.verb)} &rarr;</a>
      </div>` : ''}
    </div>

    <!-- Two columns where there is room. LEFT is the request itself — its lines, then how it got
         here. RIGHT is everything it connects to: what it becomes, who it is for, what is attached.
         Stacked, this was a long scroll beside 500px of unused width. -->
    <div class="prt-cols">
      <div>
        <div class="prt-sec"><h3>Request lines</h3>${prtItems(pr)}</div>
        <div class="prt-sec"><h3>What happened</h3>${prtTimeline(r, pr, q)}</div>
      </div>
      <div>
        <div class="prt-sec"><h3>Becomes</h3>${prtQuotationBlock(r, q)}</div>
        <div class="prt-sec"><h3>Client</h3>${prtClientBlock(r, pr)}</div>
        <div class="prt-sec"><h3>Documents</h3>
          <div class="prt-card">
            <div class="mt" style="margin-top:0;">
              ${pr.pdfLink ? `<a class="link-btn" href="${flowEsc(pr.pdfLink)}" target="_blank" rel="noopener">${flowEsc(r.prNo)} request form (PDF)</a><br>` : ''}
              <button class="link-btn" onclick='openDocsModal("Pricing Request","${flowEsc(r.prNo)}")'>Open the document folder &rarr;</button>
            </div>
          </div>
        </div>
        ${pr.notes ? `<div class="prt-sec"><h3>Notes</h3><div class="prt-card"><div class="mt" style="margin-top:0;">${flowEsc(pr.notes)}</div></div></div>` : ''}
      </div>
    </div>
  </section>`;
}

/* A228 — prtStatusLabel is gone. It translated the stored 'Returned to Sales' into "For Quotation"
   for the pane's Stage field, and that field no longer exists: the status pill and the six dots both
   carry the stage now, in the step vocabulary. Keeping a fifth name for one stage alive in dead code
   is how the vocabulary drifted in the first place. flow-pricing-request.js:27 keeps its own copy for
   its own screens. */

/* ── the other three views ─────────────────────────────────────────────────────────────────────── */
/* THE PIPELINE — six stages, read in one pass.
 *
 * This is the "summary" the tracker was asked for, and a ten-row table was the wrong shape for it: a
 * reader had to add rows up to see where the book is jammed. Here the count, the money and the bar
 * are on one card per stage, and the stage holding the largest share is marked. The stages are the
 * six dots from the pane, so the summary and the detail use one vocabulary.
 *
 * Counted on LIVE requests only — imported history is excluded everywhere else on this page and a
 * pipeline that silently re-admitted 142 records would not reconcile with the tiles above it. */
const PRT_PIPE = [
  { l: 'Request',   steps: ['chase-admin', 'wait-sourcing'],  statuses: ['Requested'] },
  { l: 'Sourcing',  steps: [],                                statuses: ['Sourcing'] },
  { l: 'Pricing',   steps: ['chase-pricing', 'wait-pricing'], statuses: ['For Mgmt Pricing'] },
  { l: 'Verify',    steps: ['chase-verify', 'wait-verify'],   statuses: ['Mgmt Priced'] },
  { l: 'Quotation', steps: ['quote'],                         statuses: ['Returned to Sales'] },
  { l: 'Sent',      steps: ['quoted', 'send-quote'],          statuses: ['Quoted'] }
];

function prtPipeline() {
  const live = prtList.rows.filter(r => r.step !== 'migrated' && prtMatches(r));
  /* Grouped by the request's STORED STATUS, not by worklist step: a stage is where the request IS,
     while a step is what to do about it, and 'stuck in sourcing' and 'with sourcing' are the same
     stage. The steps list above is what each stage's chase/wait pair is called, kept beside it so
     the two vocabularies stay visibly tied. */
  const cells = PRT_PIPE.map(p => {
    const rows = live.filter(r => p.statuses.indexOf(r.status) !== -1);
    return { l: p.l, n: rows.length,
             value: Math.round(rows.reduce((t, r) => t + (r.priced ? r.value : 0), 0) * 100) / 100,
             you: rows.filter(r => (PRW_STEPS[r.step] || {}).hands === 'you').length,
             late: rows.filter(r => r.overdueBy > 0).length };
  });
  const seen = cells.reduce((t, c) => t + c.n, 0);
  const most = cells.reduce((m, c) => Math.max(m, c.n), 0);
  /* Any live status the six stages do not cover — reported, never dropped. */
  const other = live.length - seen;
  return `<div class="chart-card">
    <div class="lv-sec-title">The pipeline
      <span class="lv-sub">· ${live.length} live request${live.length === 1 ? '' : 's'} · imported history excluded</span></div>
    <div class="prt-pipe">${cells.map(c => `
      <div class="prt-stage${c.n && c.n === most && most > 1 ? ' hot' : ''}">
        <div class="l">${flowEsc(c.l)}</div>
        <div class="n">${c.n || '—'}</div>
        <div class="v">${c.value > 0 ? flowMoney(c.value, 'PHP') : '&nbsp;'}</div>
        <div class="who ${c.you ? 'you' : (c.n ? 'them' : '')}">${
          c.you ? c.you + ' yours' : (c.n ? (c.late ? c.late + ' late' : 'in time') : '&nbsp;')}</div>
        <div class="bar"><i style="width:${most ? Math.round(c.n / most * 100) : 0}%;"></i></div>
      </div>`).join('')}</div>
    ${other > 0 ? `<div class="prt-note" style="margin-top:.6rem;color:#b45309;">${other} live request${
      other === 1 ? ' carries a status' : 's carry statuses'} none of these six stages covers — see the
      table below.</div>` : ''}
  </div>`;
}

function prtByStage() {
  const cols = [
    ['quote', 'Ready to quote'], ['send-quote', 'Quoted, not sent'], ['quotation-gone', 'Needs checking'],
    ['chase-verify', 'Chase verification'], ['chase-pricing', 'Chase pricing'], ['chase-admin', 'Chase sourcing'],
    ['wait-verify', 'With verification'], ['wait-pricing', 'With pricing'], ['wait-sourcing', 'With sourcing'],
    ['quoted', 'Quoted']
  ];
  return prtPipeline() + `<div class="chart-card" style="margin-top:1rem;">
    <div class="lv-sec-title">What to do about each <span class="lv-sub">· the same requests, by next step</span></div>
    <div style="overflow-x:auto;"><table class="flow-table"><thead><tr>
      <th>Next step</th><th class="num">Requests</th><th class="num">Value (PHP)</th><th>Whose move</th></tr></thead><tbody>
    ${cols.map(([k, label]) => {
      const rows = prtList.rows.filter(r => r.step === k && prtMatches(r));
      if (!rows.length) return '';
      const v = rows.reduce((t, r) => t + (r.priced ? r.value : 0), 0);
      const s = PRW_STEPS[k] || {};
      return `<tr><td><b>${flowEsc(label)}</b></td>
        <td class="num">${rows.length}</td>
        <td class="num">${v > 0 ? flowMoney(v, 'PHP') : '—'}</td>
        <td>${s.hands === 'you' ? '<span style="color:#b91c1c;font-weight:700;">the sales rep</span>'
              : s.hands === 'them' ? '<span style="color:#b45309;">admin / management</span>'
              : s.hands === 'nobody' ? '—' : 'unclear'}</td></tr>`;
    }).join('')}
  </tbody></table></div></div>
  ${prtIsOversight() ? prtByRep() : ''}`;
}

function prtByRep() {
  const reps = pricingRequestWorklistByRep(prtList);
  return `<div class="chart-card" style="margin-top:1rem;">
    <div class="lv-sec-title">By sales rep <span class="lv-sub">· busiest first · imported history is in "done"</span></div>
    <div style="overflow-x:auto;"><table class="flow-table"><thead><tr>
      <th>Rep</th><th class="num">Needs them now</th><th class="num">Value in play</th>
      <th class="num">Waiting</th><th class="num">Done</th></tr></thead><tbody>
    ${reps.map(r => `<tr><td><b>${flowEsc(r.rep)}</b></td>
      <td class="num"${r.now.length ? ' style="font-weight:800;color:#b91c1c;"' : ''}>${r.now.length}</td>
      <td class="num">${r.nowValue > 0 ? flowMoney(r.nowValue, 'PHP') : '—'}</td>
      <td class="num">${r.waiting.length}</td><td class="num">${r.done.length}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}

function prtByClient() {
  const by = {};
  prtList.rows.filter(r => r.step !== 'migrated' && prtMatches(r)).forEach(r => {
    const k = r.customer || '(no client named)';
    if (!by[k]) by[k] = { client: k, n: 0, value: 0, now: 0, quoted: 0 };
    by[k].n++;
    if (r.priced) by[k].value += r.value;
    if (r.group === 'now') by[k].now++;
    if (r.step === 'quoted' || r.step === 'send-quote') by[k].quoted++;
  });
  const rows = Object.keys(by).map(k => by[k]).sort((a, b) => (b.now - a.now) || (b.value - a.value));
  return `<div class="chart-card">
    <div class="lv-sec-title">By client <span class="lv-sub">· live requests only · spellings are not merged</span></div>
    <div style="overflow-x:auto;"><table class="flow-table"><thead><tr>
      <th>Client</th><th class="num">Requests</th><th class="num">Needs action</th>
      <th class="num">Quoted</th><th class="num">Value (PHP)</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${flowEsc(r.client)}</td><td class="num">${r.n}</td>
      <td class="num"${r.now ? ' style="font-weight:800;color:#b91c1c;"' : ''}>${r.now || '—'}</td>
      <td class="num">${r.quoted || '—'}</td>
      <td class="num">${r.value > 0 ? flowMoney(r.value, 'PHP') : '—'}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="prt-note" style="margin-top:.5rem;">Clients are grouped by the name exactly as typed —
  this page does not merge different spellings of the same company.</div></div>`;
}

function prtHistory() {
  const rows = prtList.rows.filter(r => r.step === 'migrated' && prtMatches(r));
  const byYm = {};
  rows.forEach(r => {
    const pr = prtPRs.filter(x => String(x.prNo) === String(r.prNo))[0] || {};
    const ym = (flowDate(pr.date) || '____-__').slice(0, 7);
    (byYm[ym] = byYm[ym] || []).push({ r: r, pr: pr });
  });
  const keys = Object.keys(byYm).sort().reverse();
  return `<div class="chart-card">
    <div class="lv-sec-title">Imported history <span class="lv-sub">· ${rows.length} records from the old system</span></div>
    <div class="prt-note" style="margin-bottom:.6rem;">These came across from the previous system. They
      cannot become quotations here — the flow only converts a request that has been priced and verified
      in this system — so they are kept out of the worklist and out of every figure above. They are still
      the price history for a client, which is what you want before quoting that client again.</div>
    ${keys.map(k => `<details class="prt-grp"><summary>${flowEsc(k)}<span class="n">${byYm[k].length}</span></summary>
      <div style="overflow-x:auto;"><table class="flow-table"><thead><tr><th>PR No</th><th>Client</th><th>Raised</th>
        <th class="num">Value (PHP)</th><th>Requested by</th></tr></thead><tbody>
      ${byYm[k].map(x => `<tr><td>${flowEsc(x.r.prNo)}</td>
        <td>${flowEsc(String(x.r.customer || '—').slice(0, 40))}</td>
        <td>${flowEsc(flowDate(x.pr.date) || '—')}</td>
        <td class="num">${x.r.priced ? flowMoney(x.r.value, 'PHP') : '—'}</td>
        <td>${flowEsc(x.r.owner || '—')}</td></tr>`).join('')}
      </tbody></table></div></details>`).join('')}
  </div>`;
}

function prtRender() {
  if (!prtList) return;
  prtKpis();
  const scope = document.getElementById('prtScope');
  if (scope) scope.textContent = prtIsOversight() ? 'every rep' : 'your requests';
  const body = document.getElementById('prtBody');
  if (prtView === 'worklist') body.innerHTML = `<div class="prt-wrap">${prtRail()}${prtPane()}</div>`;
  else if (prtView === 'stage') body.innerHTML = prtByStage();
  else if (prtView === 'client') body.innerHTML = prtByClient();
  else body.innerHTML = prtHistory();
}
