/* flow-quotations.js — quotations that load items from inventory */
let qInventory = [];
let qList = [];
let qHasSO = {};   // A145: quotationNo → true when a sales order references it (Sent-with-no-SO nudge)
let qSession = null;

let qIsOversight = false;   // admin/accounting/management/director see ALL reps, grouped
/* A191: WHO MAY SEE COST FIGURES — deliberately NOT the same set as qIsOversight.
   qIsOversight answers "may this person see everyone's quotations?" and gates the unscoped load
   (:106) and the grouped-by-rep render (:177). Admin needs both of those. It was also being used
   to gate the cost/margin breakdown, which is a different question with a different answer:
   admin must see the FINAL PRICE ONLY, never the buy price, landed cost, COGS, commission or
   margin. Reusing one flag for both is what exposed the breakdown to admin. */
let qCanSeeCosts = false;   // A191: accounting/management/director only — never admin, never sales
let qAdmin = false;         // admin: free-typed item rows (incl. new items) auto-added to inventory on save
let qCanClose = false;      // A152: the Close/Reopen actions need FlowAPI v91
let qPrByNo = {};           // A183: prNo → pricing-request record, for the approval pricing review
let qrGate = { block: false, needTick: false };   // A183: state the tick uses to re-enable Approve
const Q_CLOSED = ['Not Pursued', 'Lost', 'Cancelled'];   // A152 soft-close outcomes
let qRoll = null;        // A208: the current flowQuotationRollup — tiles, counter and rep headers share it
let qDupPairs = [];      // A208: same document number + same customer on two rows
let qLinks = {};         // A208: quotationNo → its email link rows
let qCfg = null;         // A208: the follow-up thresholds (director-set, with built-in defaults)
let qCanTrack = false;   // A208: the email/follow-up backend needs FlowAPI v113
let qClientEmails = {}; // A208: customer -> the address on file, for the domain signal
let qClientRefs = {};   // A208: customer -> their own RFQ reference

/* A175 — one quotation page. The Quote Configurator (flow-quote-configurator.js) is the CREATE half
 * above; everything below — the list, review, approval, close/reopen — is this file's.
 *
 * The boot order is deliberate and load-bearing. The old boot set `#date` and called `addRow()`
 * BEFORE loadQuotations(), unguarded, inside an async handler: the moment the create form went away
 * those lines threw, the throw aborted the rest of the handler, and the history sat on its "Loading…"
 * spinner forever with all four KPIs blank — a dead list caused entirely by the create half. So the
 * history loads FIRST, and every create-side call sits behind its own try/catch. Nothing in the
 * builder can stop the list from rendering.
 */
document.addEventListener('DOMContentLoaded', async () => {
  qSession = requireQuotationAccess();
  if (!qSession) return;
  qIsOversight = qSession.role !== 'sales';
  qCanSeeCosts = ['accounting', 'management', 'director'].indexOf(qSession.role) >= 0;   // A191
  qAdmin = qSession.role === 'admin';
  renderNavbar('flow-quotations');
  // Only admin/accounting can open the rest of the flow — show the sub-nav to them.
  if (qSession.role === 'admin' || qSession.role === 'accounting') renderFlowNav('flow-quotations.html');

  const params = new URLSearchParams(location.search);

  // ── the history, first and unconditionally ────────────────────────────────
  try {
    await loadQuotations();
    if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) {
    const c = document.getElementById('listContainer');
    if (c) c.innerHTML = `<p style="color:#ef4444;">Could not load quotations — ${flowEsc(e.message || 'unknown error')}</p>`;
  }
  /* A183/A191: the pricing behind each quotation, for the review breakdown. Fetched only for roles
     allowed to SEE cost figures — so admin and sales never pay this call and, just as importantly,
     the commission and margin never land in their sessionStorage read-cache. Best-effort: the modal
     degrades to no-breakdown. */
  if (qCanSeeCosts) { try { await qLoadPricingRefs(); } catch (e) { /* modal falls back to hasPr:false */ } }
  // Deep-link: ?review=<quotationNo> opens the review modal directly (e.g. from the admin dashboard).
  const reviewNo = params.get('review');
  if (reviewNo) { try { openReviewModal(reviewNo); } catch (e) { /* the list still stands */ } }

  // ── the create half — guarded, so a fault here costs the builder, not the list ──
  try {
    await loadInventory();                       // still needed by the PDF dialog's descriptions
    if (typeof qcInit === 'function') qcInit({ session: qSession });
    // Deep-link: ?fromPR=<prNo> opens the builder with that returned request's final-priced items.
    const fromPr = params.get('fromPR');
    if (fromPr && typeof qcLoadFromPR === 'function') {
      qcToggleCreate(true);
      await qcLoadFromPR(fromPr);
    }
  } catch (e) {
    console.error('Quote builder failed to start:', e);
    const msg = document.getElementById('qcMsg');
    if (msg) msg.innerHTML = '<div style="margin:.5rem 0 1rem;padding:.6rem .85rem;border-radius:10px;font-size:.86rem;' +
      'background:#fef2f2;color:#991b1b;border:1px solid #fecaca;">The quotation builder could not start — reload the page. ' +
      'The list below is unaffected.</div>';
  }
});

async function loadInventory() {
  try { const r = await fetchFlow('getInventory'); qInventory = (r && r.data) || []; }
  catch (e) { qInventory = []; }
}

// Read a discount-% input, clamped to 0–100 (blank/invalid → 0).
function qDiscountVal(id) {
  const el = document.getElementById(id);
  const n = flowNum(el && el.value);
  return Math.max(0, Math.min(100, n || 0));
}

/** Overwrite (or insert) the qList entry with the values we KNOW were just saved. The refetch after
 *  a write can serve the pre-save record (Sheets read-after-write staleness), and that stale response
 *  is cached for 60s — so the saved values are authoritative here (same class of fix as the A80
 *  pdfLink patch). Recomputes line totals + the gross total; clears the flow cache so the stale
 *  response can't resurface on the next page load. `oldNo` handles a rename (replace in place). */
function qPatchLocal(no, saved, oldNo) {
  let i = qList.findIndex(q => String(q.quotationNo) === String(no));
  if (i < 0 && oldNo) i = qList.findIndex(q => String(q.quotationNo) === String(oldNo));
  const base = i >= 0 ? qList[i] : { quotationNo: no, status: 'Draft', createdBy: qSession.name, items: [] };
  const rec = Object.assign({}, base, saved, { quotationNo: no });
  if (saved.items) {
    rec.items = saved.items.map(it => Object.assign({}, it, { lineTotal: flowNum(it.qty) * flowNum(it.price) }));
    rec.total = rec.items.reduce((s, it) => s + it.lineTotal, 0);
  }
  if (i >= 0) qList[i] = rec; else qList.push(rec);
  try { _flowCacheClear(); } catch (e) { /* cache clear is best-effort */ }
  qBuildMonthOptions();
  renderQuotationList();
}

async function loadQuotations() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    // Sales see only their own; oversight roles (admin/accounting/management/director) see all.
    const params = qIsOversight ? {} : { createdBy: qSession.name };
    /* A208 — the email links and the follow-up thresholds ride along with the existing two fetches.
       Both degrade to empty: the tracker then measures purely on Quotations['Sent At'], which is
       still three of the four things it watches. No IMAP is touched here, ever. */
    const [res, soRes, linkRes, cfgRes, cliRes] = await Promise.all([
      fetchFlow('getQuotations', params),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),   // A145: which quotations became SOs
      fetchFlow('getQuotationEmails').catch(() => ({ data: [] })),
      fetchFlow('getFlowSettings').catch(() => ({ data: null })),
      fetchFlow('getClients').catch(() => ({ data: [] })),   // A208: the client's own email domain
    ]);
    qList = (res && res.data) || [];
    qHasSO = {};
    ((soRes && soRes.data) || []).forEach(s => { if (s.quotationNo) qHasSO[String(s.quotationNo)] = true; });
    qLinks = {};
    ((linkRes && linkRes.data) || []).forEach(l => {
      const k = String(l.quotationNo || '');
      if (k) (qLinks[k] = qLinks[k] || []).push(l);
    });
    qCfg = (cfgRes && cfgRes.data) || null;
    qClientEmails = {}; qClientRefs = {};
    ((cliRes && cliRes.data) || []).forEach(c => {
      const k = String(c.customer || '').toLowerCase().trim();
      if (!k) return;
      if (c.email) qClientEmails[k] = c.email;
      if (c.rfqRef) qClientRefs[k] = c.rfqRef;
    });
    try { qCanClose = await flowVersionAtLeast(91); } catch (e) { qCanClose = false; }  // A152: Close/Reopen need v91
    try { qCanTrack = await flowVersionAtLeast(113); } catch (e) { qCanTrack = false; } // A208
    if (!qList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No quotations yet.</p>'; return; }
    qBuildMonthOptions();
    renderQuotationList();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

/** 'yyyy-MM' of the month a quotation was created in. */
function qMonthKey(q) { return String(flowDate(q.date) || '').slice(0, 7); }

/* A208 — one colour per follow-up state. 'unknown' is deliberately grey, not red: we are saying we
   cannot see, which is not the same as saying the client ignored us. */
const QFU_STYLE = {
  'not-sent': 'background:rgba(99,102,241,0.14);color:#4338ca;',
  'ok':       'background:rgba(16,185,129,0.12);color:#047857;',
  'due':      'background:rgba(245,158,11,0.16);color:#b45309;',
  'overdue':  'background:rgba(239,68,68,0.14);color:#b91c1c;',
  'replied':  'background:rgba(59,130,246,0.14);color:#1d4ed8;',
  'unknown':  'background:rgba(100,116,139,0.12);color:#475569;'
};

/** The Follow-ups card — what needs chasing, worst first. Deliberately on this page rather than a
 *  page of its own: a separate page would need its own copy of the money and bucket helpers, and
 *  three copies of those is what A182 and A208 Part A were both written to undo. */
/* ── A215 · the worklist ──────────────────────────────────────────────────────────────────────────
   The table below this card is ordered by DATE, which is exactly backwards for tracking: the row
   that needs attention most has sat longest, so it lands furthest down the page. This renders the
   same quotations in the order they need DOING, with the action for each one on its own row.

   The engine (quotation-worklist.js) decides what the step is; everything here is presentation. */
let qwGroup = 'now';          // which tab is open
let qwOpenStory = '';         // which row has its history expanded
let qwList = null;            // the last computed worklist, so a tab switch does not recompute

/** Colour per step. Reuses the follow-up palette where the meaning matches, so a rep who has learned
 *  the badge colours on the table does not have to learn a second language here. */
const QW_STYLE = {
  answer:         'background:rgba(59,130,246,0.14);color:#1d4ed8;',
  fix:            'background:rgba(239,68,68,0.14);color:#b91c1c;',
  send:           'background:rgba(99,102,241,0.14);color:#4338ca;',
  chase:          'background:rgba(245,158,11,0.16);color:#b45309;',
  'no-send-date': 'background:rgba(100,116,139,0.12);color:#475569;',
  'wait-approval':'background:rgba(100,116,139,0.12);color:#475569;',
  'wait-client':  'background:rgba(16,185,129,0.12);color:#047857;',
  snoozed:        'background:rgba(100,116,139,0.12);color:#475569;',
  draft:          'background:rgba(100,116,139,0.12);color:#475569;',
  won:            'background:rgba(16,185,129,0.12);color:#047857;',
  closed:         'background:rgba(100,116,139,0.12);color:#475569;'
};

function qRenderFollowUps(rows) {
  const el = document.getElementById('qFollowUps');
  if (!el || typeof quotationWorklist !== 'function') return;

  qwList = quotationWorklist(rows || [], qLinks, qCfg, qHasSO);
  qwRenderTabs();
  qwRenderBanner();

  const list = qwList.groups[qwGroup] || [];
  if (!list.length) {
    el.innerHTML = '<div class="qw-empty">' + (qwGroup === 'now'
      ? '✓ Nothing is waiting on you. Anything with the client or in approval is under “Waiting”.'
      : 'Nothing here.') + '</div>';
    return;
  }
  /* The no-send-date rows are collapsed into the banner above rather than listed: there are 60 of
     them on live data, and 60 identical rows would bury the four things a rep can actually act on. */
  const shown = list.filter(r => r.step !== 'no-send-date');
  if (!shown.length) {
    el.innerHTML = '<div class="qw-empty">✓ Nothing else needs you — just the send dates above.</div>';
    return;
  }
  el.innerHTML = shown.map(qwRow).join('');
}

function qwRenderTabs() {
  const el = document.getElementById('qWorkTabs');
  if (!el || !qwList) return;
  const label = { now: 'Needs you', waiting: 'Waiting', done: 'Done' };
  el.innerHTML = ['now', 'waiting', 'done'].map(g =>
    `<button class="qw-tab${g === qwGroup ? ' active' : ''}" onclick="qwSetGroup('${g}')">${label[g]}<span class="n">${qwList.counts[g]}</span></button>`
  ).join('');
  const sub = document.getElementById('qWorkSub');
  if (sub) {
    sub.textContent = qwGroup === 'now'
      ? (qwList.counts.now
          ? 'In the order they need doing — the most overdue first, then the largest.'
          : 'Your quotations, in the order they need doing.')
      : qwGroup === 'waiting'
        ? 'With the client, in approval, or parked. Nothing for you to do yet.'
        : 'Won, closed, or not pursued.';
  }
}

function qwSetGroup(g) { qwGroup = g; qwOpenStory = ''; qRenderFollowUps(qwLastRows()); }
/* Re-render from the same filtered set the list is showing, so the tabs and the table below can
   never disagree about which quotations are in scope. */
function qwLastRows() { return (qwList && qwList.rows.map(r => r.quotation)) || []; }

/** The one banner: the send dates nobody recorded. It is the single biggest reason the worklist
 *  cannot rank most of the pipeline, so it says the number and offers the fix rather than leaving
 *  60 rows saying "sent date not recorded". */
function qwRenderBanner() {
  const el = document.getElementById('qWorkBanner');
  if (!el || !qwList) return;
  const n = qwList.rows.filter(r => r.step === 'no-send-date').length;
  if (!n || qwGroup !== 'now') { el.innerHTML = ''; return; }
  const canFix = ['director', 'management', 'admin', 'accounting'].indexOf(
    String((qSession && qSession.role) || '').toLowerCase()) >= 0;
  el.innerHTML = `<div class="qw-banner">
      <div><b>${n} quotation${n === 1 ? '' : 's'} ${n === 1 ? 'was' : 'were'} marked sent before the system
        recorded when.</b> Until that is filled in ${n === 1 ? 'it' : 'they'} cannot be ranked by how long
        ${n === 1 ? 'it has' : 'they have'} been quiet, so ${n === 1 ? 'it is' : 'they are'} not listed below.</div>
      ${canFix ? '<button class="btn btn-sm" onclick="qwOpenBackfill()">Estimate the dates…</button>'
               : '<span style="font-size:.74rem;">Ask management to estimate them.</span>'}
    </div>`;
}

function qwRow(r) {
  const q = r.quotation;
  const no = String(q.quotationNo || '');
  const esc = flowEsc(no);
  const canAct = !!r.verb;
  /* Every action here already exists on the page — this only puts it where the instruction is,
     instead of two clicks inside a modal. */
  const onClick = { fix: `openReviewModal("${esc}")`, send: `sendQuotationAction("${esc}")`,
                    answer: `qOpenEmailLink("${esc}")`, chase: `qOpenEmailLink("${esc}")`,
                    draft: `openReviewModal("${esc}")` }[r.step] || `openReviewModal("${esc}")`;
  const est = String(q.sentAtBasis || '').trim();
  return `<div class="qw-row">
      <div class="act">${canAct
        ? `<button class="btn btn-sm ${r.step === 'fix' || r.step === 'answer' ? 'btn-primary' : ''}"
             onclick='${onClick}'>${flowEsc(r.verb)}</button>`
        : `<span class="qw-pill" style="${QW_STYLE[r.step] || ''}">${flowEsc(r.title)}</span>`}</div>
      <div class="body">
        <div class="no">${esc}</div>
        <div class="cust">${flowEsc(q.customer || '—')}</div>
        <div class="why">${flowEsc(r.line)}${r.detail ? ' · ' + flowEsc(r.detail) : ''}${
          est ? ` <span class="qw-pill qw-est" title="This date was estimated, not recorded">${flowEsc(est)}</span>` : ''}</div>
        ${qwOpenStory === no ? qwStory(q, r) : ''}
      </div>
      <div class="money">${flowMoney(r.value, 'PHP')}</div>
      <div class="extra">
        <button class="link-btn" onclick='qwToggleStory("${esc}")'>${qwOpenStory === no ? 'Hide' : 'History'}</button>
        ${r.group !== 'done' ? `<button class="link-btn" onclick='qwPark("${esc}")'>${
          r.step === 'snoozed' ? 'Unpark' : 'Park'}</button>` : ''}
      </div>
    </div>`;
}

function qwToggleStory(no) { qwOpenStory = (qwOpenStory === no) ? '' : no; qRenderFollowUps(qwLastRows()); }

/** What happened to this quotation, in order. Everything here is already loaded — this is a render,
 *  not a fetch. Answering "what happened with this one" used to mean opening five pages. */
function qwStory(q, r) {
  /* Each event carries a sort key as well as a label. An event with no recorded date INHERITS the
     key of the one before it, so "Sent back (date not recorded)" stays where it belongs — after
     "Created" — instead of sorting to the top of the story on a literal string compare. */
  const ev = [];
  const add = (when, what) => {
    if (!what) return;
    const d = flowDate(when);
    ev.push({ when: d || '—', what: what, key: d || (ev.length ? ev[ev.length - 1].key : '') });
  };
  add(q.date, 'Created' + (q.createdBy ? ' by ' + q.createdBy : ''));
  /* State it even when there is no timestamp. rejectQuotation did not stamp who or when until A215,
     so every quotation sent back before that has the status and nothing else — and a history that
     silently omits the most important event is worse than one that admits the date is missing. */
  const decided = (q.status === 'Rejected') ? 'Sent back' :
                  (q.approvedAt || q.approvedBy) ? 'Approved' : '';
  if (decided) {
    const lbl = decided + (q.approvedBy ? ' by ' + q.approvedBy : '') +
                (q.approvalNote ? ' — ' + q.approvalNote : '');
    if (flowDate(q.approvedAt)) add(q.approvedAt, lbl);
    else ev.push({ when: '(not recorded)', what: lbl,
                   key: ev.length ? ev[ev.length - 1].key : '' });
  }
  if (q.sentAt) {
    add(q.sentAt, 'Sent to the client' + (q.sentTo ? ' (' + q.sentTo + ')' : '') +
        (String(q.sentAtBasis || '').trim() ? ' — ' + q.sentAtBasis : ''));
  }
  (qLinks[String(q.quotationNo)] || []).forEach(l => {
    if (String(l.status || 'Active') !== 'Active') return;
    add(l.sentAt, (String(l.kind || 'Initial') === 'Initial' ? 'Email: ' : 'Chase: ') +
        (l.subject || '(no subject)'));
    if (l.replyAt) add(l.replyAt, 'Client replied' + (l.replyFrom ? ' — ' + l.replyFrom : ''));
  });
  if (q.snoozeUntil) add(q.snoozeUntil, 'Parked until then' + (q.snoozeReason ? ' — ' + q.snoozeReason : ''));
  if (qHasSO[String(q.quotationNo)]) {
    ev.push({ when: '', what: 'Became a sales order',
              key: ev.length ? ev[ev.length - 1].key : '' });
  }

  // Array.prototype.sort is stable, so equal keys keep the order they were added in.
  ev.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  if (!ev.length) return '<div class="qw-story">Nothing recorded yet.</div>';
  return '<div class="qw-story">' + ev.map(e =>
    `<div class="ev"><span class="when">${flowEsc(e.when)}</span><span>${flowEsc(e.what)}</span></div>`).join('') +
    '</div>';
}

/** Park a deal off the worklist, or bring it back. The reason is required by the handler and asked
 *  for here, because six weeks later "why is this parked?" is the only question anybody asks. */
async function qwPark(no) {
  const row = (qwList && qwList.rows.filter(r => String(r.quotation.quotationNo) === String(no))[0]) || null;
  const parked = row && row.step === 'snoozed';
  try {
    if (parked) {
      if (!confirm('Put ' + no + ' back on your list?')) return;
      const r = await postFlow('snoozeQuotation', { quotationNo: no });
      if (!r.success) throw new Error(r.message);
      flowMsg('qMsg', r.message, true);
    } else {
      const until = prompt('Park ' + no + ' until when? (YYYY-MM-DD)\n\n' +
        'It leaves your list and comes back on that date.', qwDefaultPark());
      if (!until) return;
      const why = prompt('Why? One line — future you will want to know.');
      if (!why || !why.trim()) return;
      const r = await postFlow('snoozeQuotation', { quotationNo: no, until: until.trim(), reason: why.trim() });
      if (!r.success) throw new Error(r.message);
      flowMsg('qMsg', r.message, true);
    }
    await loadQuotations();
  } catch (e) { flowMsg('qMsg', e.message, false); }
}
/** A fortnight out — far enough to be worth parking, near enough that nothing is forgotten. */
function qwDefaultPark() {
  const d = new Date(flowToday() + 'T00:00:00');
  d.setDate(d.getDate() + 14);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

/** Preview the send-date backfill, then apply it — never the other way round. The whole point of the
 *  two steps is that somebody reads what would change before 60 rows do. */
async function qwOpenBackfill() {
  try {
    const pv = await postFlow('previewQuotationSentAt', {});
    if (!pv.success) throw new Error(pv.message);
    if (!pv.count) { flowMsg('qMsg', pv.message, true); return; }
    const sample = (pv.data || []).slice(0, 8)
      .map(r => `  ${r.quotationNo} → ${r.estimatedSentAt}  (${r.basis})`).join('\n');
    const ok = confirm(pv.message + '\n\n' + sample +
      (pv.count > 8 ? `\n  …and ${pv.count - 8} more` : '') +
      '\n\nThese are ESTIMATES, and each one is stored saying so. Quotations that already have a real ' +
      'send date are not touched.\n\nApply?');
    if (!ok) return;
    const r = await postFlow('runQuotationSentAtBackfill', {});
    if (!r.success) throw new Error(r.message);
    flowMsg('qMsg', r.message, true);
    await loadQuotations();
  } catch (e) { flowMsg('qMsg', e.message, false); }
}

/** Narrow to the selected period. 'last90' is Manila-explicit at both ends — flowToday()/flowDate()
 *  rather than a naive ISO slice, which shifts the boundary by a day for an evening page load. */
function qFilterPeriod(list, month) {
  if (month === 'last90') {
    const cut = qDaysAgo(90);
    return list.filter(q => String(flowDate(q.date) || '') >= cut);
  }
  if (month) return list.filter(q => qMonthKey(q) === month);
  return list;
}

/** 'yyyy-MM-dd' N days before today, Manila. */
function qDaysAgo(n) {
  const t = flowToday();                       // 'yyyy-MM-dd' in Asia/Manila
  const d = new Date(t + 'T00:00:00Z');        // parse as UTC so the arithmetic cannot drift a day
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/* A208 — the tiles. Every figure comes from the rollup over the SAME filtered rows the list shows,
   so what the tiles say and what the table below contains are the same thing. The previous tiles
   ran their own unfiltered fetch, which is how the screen ended up reporting two different numbers
   for one rep. */
function qRenderKpiTiles(roll, shown, month, sview, periodRoll) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  if (!roll) return;
  const M = (v) => flowMoney(v, 'PHP');
  const N = (b, noun) => `${roll[b].n} ${noun}${roll[b].n === 1 ? '' : 's'}`;

  set('kqInternal', M(roll.internal.value));
  set('kqInternalN', `${N('internal', 'quotation')} · drafting, in approval, or sent back for rework`);
  set('kqApproved', M(roll.approved.value));
  set('kqApprovedN', `${N('approved', 'quotation')} · approved, not yet sent to the client`);
  set('kqSent', M(roll.sent.value));
  set('kqSentN', `${N('sent', 'quotation')} · sent, awaiting their decision`);
  set('kqClosed', M(roll.closed.value));
  /* When the Show filter is hiding closed rows, say so on the tile rather than showing a bare zero
     that looks like "nothing was ever lost". */
  const hiddenClosed = periodRoll ? periodRoll.closed.n - roll.closed.n : 0;
  set('kqClosedN', hiddenClosed > 0
    ? `${hiddenClosed} hidden by the “${sview === 'active' ? 'Active' : sview}” filter — worth ${M(periodRoll.closed.value)}`
    : `${N('closed', 'quotation')} · closed without an order`);

  /* Two honesty notes under the headline figure.
     The won count is deliberately NOT its own tile: only ~6% of sales orders record which quotation
     they came from, so any "won" figure is a floor, and a tile beside the others would read as a
     conversion rate that the data cannot support. */
  const note = document.getElementById('kqSentNote');
  if (note) {
    const bits = [];
    if (roll.won.n) {
      bits.push(`${roll.won.n} became an order (${M(roll.won.value)}) — undercounts, few orders record their quotation`);
    }
    if (roll.top && roll.top.share >= 0.4) {
      bits.push(`top deal ${M(roll.top.value)} is ${Math.round(roll.top.share * 100)}% of this`);
    }
    note.textContent = bits.join(' · ');
    note.title = (roll.top && roll.top.share >= 0.4)
      ? `${roll.top.quotationNo} — ${roll.top.customer}` : '';
  }

  // Say in words exactly what is being counted, so no one has to infer it from the controls.
  const scope = document.getElementById('kqScope');
  if (scope) {
    const period = month === 'last90' ? 'Last 90 days'
      : (month ? qMonthLabel(month) : 'All time');
    const show = sview === 'closed' ? 'closed only'
      : (sview === 'rework' ? 'rejected, needing rework' : (sview === 'all' ? 'every status' : 'active'));
    const who = qIsOversight ? 'all reps' : 'your quotations';
    scope.textContent = `Showing ${shown} of ${qList.length} · ${period} · ${show} · ${who}` +
      ` · values are net of discount`;
  }

  // Same document number AND same customer on two rows. Reported, never merged.
  const dup = document.getElementById('kqDup');
  if (dup) {
    if (!qDupPairs.length) { dup.style.display = 'none'; dup.textContent = ''; }
    else {
      dup.style.display = '';
      dup.textContent = `${qDupPairs.length} possible duplicate${qDupPairs.length === 1 ? '' : 's'} — ` +
        qDupPairs.map(p => `${p.prefix} (${p.customer}) appears on ${p.rows.length} rows`).join('; ') +
        ` · both are still counted; check whether it is one deal or a re-quote.`;
    }
  }
}

/** Public entry point for the four post-save call sites that say flowRefreshKpis(). */
function qRefreshKpis() { renderQuotationList(); }

const Q_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function qMonthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? `${Q_MONTH_NAMES[+m[2] - 1]} ${m[1]}` : key;
}

/** Month options built from the quotations actually present, newest first. */
function qBuildMonthOptions() {
  const sel = document.getElementById('qMonthFilter');
  if (!sel) return;
  const counts = {};
  qList.forEach(q => { const k = qMonthKey(q); if (k) counts[k] = (counts[k] || 0) + 1; });
  const keys = Object.keys(counts).sort().reverse();
  const keep = sel.value;
  // A208: 'Last 90 days' is the default so the headline cannot silently become an all-time number.
  sel.innerHTML = `<option value="last90">Last 90 days</option><option value="">All time</option>` +
    keys.map(k => `<option value="${k}">${qMonthLabel(k)} (${counts[k]})</option>`).join('');
  sel.value = (keep && (keep === '' || keep === 'last90' || keys.indexOf(keep) >= 0)) ? keep : 'last90';
}

/** Filter by month + free text, then render. Old quotations keep every action — the filter only
 *  narrows which rows are shown, never what can be done with them. */
function renderQuotationList() {
  const c = document.getElementById('listContainer');
  if (!c) return;
  const month = (document.getElementById('qMonthFilter') || {}).value || '';
  const term = ((document.getElementById('qSearch') || {}).value || '').trim().toLowerCase();
  // A152: status filter — Active (default, hides closed), Closed (win/loss review), or All.
  const sview = (document.getElementById('qStatusFilter') || {}).value || 'active';
  let rows = qList;
  /* A208 — keep a copy filtered by PERIOD only, before the status filter narrows it. The tiles
     describe the rows actually listed (so nothing on screen disagrees), but a "Lost" tile that
     always reads zero under the default Active filter is dead furniture — this is what lets it say
     how many it is hiding instead. */
  const periodRows = qFilterPeriod(qList, month);
  if (sview === 'active') rows = rows.filter(q => Q_CLOSED.indexOf(String(q.status)) === -1);
  else if (sview === 'closed') rows = rows.filter(q => Q_CLOSED.indexOf(String(q.status)) !== -1);
  else if (sview === 'rework') rows = rows.filter(q => String(q.status) === 'Rejected');
  rows = qFilterPeriod(rows, month);
  if (term) {
    rows = rows.filter(q => [q.quotationNo, q.customer, q.subject, q.createdBy]
      .some(v => String(v == null ? '' : v).toLowerCase().includes(term)));
  }
  // Newest first so the most recent work is at the top of whichever month is selected.
  rows = rows.slice().sort((a, b) => String(flowDate(b.date)).localeCompare(String(flowDate(a.date))) ||
    String(b.quotationNo).localeCompare(String(a.quotationNo)));

  /* A208 — ONE rollup drives the tiles, this counter and the per-rep headers. They used to be three
     separate computations and they disagreed by 8 million pesos on the same screen. */
  qRoll = flowQuotationRollup(rows, qHasSO);
  qDupPairs = flowQuotationDupPairs(rows);
  qRenderKpiTiles(qRoll, rows.length, month, sview, flowQuotationRollup(periodRows, qHasSO));
  qRenderFollowUps(rows);

  const count = document.getElementById('qListCount');
  if (count) {
    count.textContent = rows.length
      ? `${rows.length} of ${qList.length} · with client ${flowMoney(qRoll.sent.value, 'PHP')}` +
        ` · ready ${flowMoney(qRoll.approved.value, 'PHP')}`
      : `0 of ${qList.length} quotation(s)`;
  }
  if (!rows.length) {
    c.innerHTML = `<p style="color:var(--text-muted,#64748b);">No quotations match this filter${
      month ? ` — nothing in ${flowEsc(qMonthLabel(month))}` : ''}.</p>`;
    return;
  }
  c.innerHTML = qIsOversight ? renderGroupedByRep(rows) : renderQuotationTable(rows);
}

function quotationActions(q) {
  const no = flowEsc(q.quotationNo);
  const role = qSession.role, st = q.status || 'Draft';
  const isSales = role === 'sales', isAdmin = role === 'admin';
  const isCreator = String(q.createdBy) === String(qSession.name);
  const editable = st === 'Draft' || st === 'Rejected';
  // Approved/Sent are finished states — the way back in is Revise (audited, and re-enters approval),
  // never a silent Edit. The backend enforces the same rule.
  const reopenable = st === 'Sent' || st === 'Approved';
  const B = (fn, label, cls) => `<button class="link-btn ${cls || ''}" onclick='${fn}' style="margin-left:0.5rem;">${label}</button>`;
  // Everyone can Review (read-only details + PDF). Approvers get Approve/Reject inside the modal.
  let a = `<button class="link-btn" onclick='openReviewModal("${no}")'>Review</button>`
    + B(`openDocsModal("Quotation","${no}")`, 'Docs');
  // Submit / re-submit while Draft or Rejected — the creator, admin, or accounting.
  if (editable && (isCreator || isAdmin || isSales || role === 'accounting'))
    a += B(`submitQuotationAction("${no}")`, st === 'Rejected' ? 'Re-submit' : 'Submit');
  /* A176 — Edit and PDF were two buttons doing different jobs on the same row, which read as
     duplication. They are now ONE surface: whoever may change the quotation gets Edit (record +
     document); everyone else gets PDF, which opens the same builder with the figures locked and
     rebuilds the document only. Never both — and never neither, because an approver staring at a
     stale PDF must always be able to regenerate it (A123 blocks Approve until they do). */
  if (editable && (isSales || isAdmin)) a += B(`editQuotation("${no}")`, 'Edit');
  else a += B(`qcOpen("${no}","document")`, 'PDF');
  if ((isSales || isAdmin) && editable) a += B(`deleteQuotation("${no}")`, 'Delete', 'del-btn');
  // Client came back asking for a different price? Reopen it — creator, sales or admin.
  if (reopenable && (isCreator || isSales || isAdmin)) a += B(`reviseQuotationAction("${no}")`, 'Revise');
  // A145: Send-to-Client is offered to the CREATOR and to admin/management/director — not sales-only —
  // so an admin- or management-created quotation doesn't strand at Approved with no one able to send it.
  const canSend = isCreator || isSales || isAdmin || role === 'management' || role === 'director';
  if (canSend && st === 'Approved') a += B(`sendQuotationAction("${no}")`, 'Send to Client');
  // A152: close a quotation the client never pursued (soft) — or reopen a closed one.
  const closed = Q_CLOSED.indexOf(st) !== -1;
  const canClose = isCreator || isSales || isAdmin || role === 'management' || role === 'director';
  const wonHasSO = qHasSO[String(q.quotationNo)];   // pursued into an SO → can't be "not pursued"
  if (qCanClose && canClose) {
    if (closed) a += B(`reopenQuotationAction("${no}")`, 'Reopen', 'reopen-btn');
    else if (!wonHasSO) a += B(`openCloseModal("${no}")`, 'Close', 'del-btn');
  }
  /* A208 — attach the GoDaddy message that carried this. Only from Approved onward: there is
     nothing to have emailed before that, and the version gate keeps it hidden until the backend
     that stores links is actually live. */
  if (qCanTrack && (st === 'Approved' || st === 'Sent' || Q_CLOSED.indexOf(st) !== -1)) {
    const n = (qLinks[String(q.quotationNo)] || []).filter(l => String(l.status || 'Active') === 'Active').length;
    a += B(`qOpenEmailLink("${no}")`, n ? `Email (${n})` : 'Email');
  }
  return a;
}

/* A182: these were correct but private to this page, which is exactly why four other screens read
   q.total raw and overstated every discounted quotation. The bodies now live in flow-api.js so every
   page shares them; these stay as delegates so this page's call sites are untouched. */
function qtnGross(q) { return flowQuotationGross(q); }
function qtnTotal(q) { return flowQuotationNet(q); }

function quotationRow(q) {
  const st = q.status || 'Draft';
  const noteTip = (st === 'Rejected' && q.approvalNote) ? ` title="Reason: ${flowEsc(q.approvalNote)}"` : '';
  const noteLine = (st === 'Rejected' && q.approvalNote) ? `<div style="font-size:0.72rem;color:#dc2626;margin-top:0.2rem;">✗ ${flowEsc(q.approvalNote)}</div>` : '';
  // A145: a Sent quotation with no sales order yet — nudge to create the SO.
  const soNudge = (st === 'Sent' && !qHasSO[String(q.quotationNo)])
    ? ` <span class="flow-badge" style="background:rgba(245,158,11,0.14);color:#b45309;" title="Sent to the client but no sales order created yet">no SO</span>` : '';
  // A208: the same document number AND the same customer on another row. Flagged, never merged —
  // the two rows differ in amount and status and may be a legitimate re-quote by a second rep.
  const dupPair = (qDupPairs || []).filter(p =>
    p.rows.some(r => String(r.quotationNo) === String(q.quotationNo)))[0];
  const dupBadge = dupPair
    ? ` <span class="flow-badge" style="background:rgba(239,68,68,0.12);color:#b91c1c;" title="${flowEsc(
        dupPair.rows.filter(r => String(r.quotationNo) !== String(q.quotationNo))
          .map(r => r.quotationNo + ' — ' + r.status + ' — ' + flowMoney(flowQuotationNet(r), 'PHP')).join(' · ')
      )}">dup?</span>` : '';
  // A208: how long this has been sitting with the client, on the row itself.
  const fu = (typeof flowFollowUp === 'function') ? flowFollowUp(q, qLinks[String(q.quotationNo)] || [], qCfg, qHasSO) : null;
  const fuBadge = (fu && fu.label) ? ` <span class="flow-badge" style="${QFU_STYLE[fu.state] || ''}" title="${flowEsc(fu.reason || fu.label)}">${flowEsc(fu.label)}</span>` : '';
  return `<tr><td>${flowEsc(q.quotationNo)}${soNudge}${dupBadge}${fuBadge}</td><td>${flowDate(q.date)}</td><td>${flowEsc(q.customer)}</td>
    <td${noteTip}>${flowStatusBadge(st)}${noteLine}</td>
    <td class="num">${flowMoney(qtnTotal(q), 'PHP')}${flowNum(q.discountPct) > 0 ? `<div style="font-size:0.68rem;color:#0f766e;">−${flowNum(q.discountPct)}% disc</div>` : ''}</td><td>${q.items.length}</td>
    <td>${q.pdfLink ? `<a href="${flowEsc(q.pdfLink)}" target="_blank" class="link-btn"${qPdfState(q) === 'fresh'
        ? ' title="The saved PDF matches this quotation."'
        : ` style="color:#b91c1c;" title="${qPdfState(q) === 'stale'
            ? 'This saved PDF no longer matches the quotation — click PDF to regenerate.'
            : 'This PDF predates change-tracking, so it can\'t be confirmed to match — click PDF to regenerate.'}"`
      }>${qPdfState(q) === 'fresh' ? '' : '⚠ '}View saved</a>` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    <td style="white-space:nowrap;">${quotationActions(q)}</td></tr>`;
}

// ─── Approval actions ─────────────────────────────
async function _qAction(action, no, extra) {
  try {
    let res = await postFlow(action, Object.assign({ quotationNo: no }, extra || {}));
    /* A158: the quotation's prices differ from what management set on the pricing request. Discounting
       to win a deal is legitimate, so this is surfaced for an explicit decision rather than blocked —
       the point is that an approver can no longer sign it off without being told. */
    if (!res.success && res.needsConfirm === 'prDeviation') {
      if (!confirm(res.message)) return;
      res = await postFlow(action, Object.assign({ quotationNo: no, acknowledgeDeviation: true }, extra || {}));
    }
    if (!res.success) throw new Error(res.message);
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
}
function submitQuotationAction(no) {
  if (!confirm('Submit quotation ' + no + ' for approval?')) return;
  _qAction('submitQuotationApproval', no);
}
function approveQuotationAction(no) { _qAction('approveQuotation', no); }
function rejectQuotationAction(no) {
  const reason = prompt('Reason for rejecting ' + no + ' (optional):', '');
  if (reason === null) return;
  _qAction('rejectQuotation', no, { reason });
}
function sendQuotationAction(no) {
  if (!confirm('Mark quotation ' + no + ' as sent to the client?')) return;
  _qAction('sendQuotation', no);
}

// A152: close a not-pursued quotation (soft). A small modal lets the user pick the outcome + a reason.
function openCloseModal(no) {
  document.getElementById('qCloseNo').textContent = no;
  document.getElementById('qCloseModal').dataset.no = no;
  document.getElementById('qCloseOutcome').value = 'Not Pursued';
  document.getElementById('qCloseReason').value = '';
  document.getElementById('qCloseModal').style.display = 'flex';
}
function closeCloseModal() { document.getElementById('qCloseModal').style.display = 'none'; }
async function confirmCloseQuotation() {
  const modal = document.getElementById('qCloseModal');
  const no = modal.dataset.no;
  const outcome = document.getElementById('qCloseOutcome').value;
  const reason = document.getElementById('qCloseReason').value.trim();
  const btn = document.getElementById('qCloseConfirmBtn');
  btn.disabled = true; btn.textContent = 'Closing…';
  try {
    const res = await postFlow('closeQuotation', { quotationNo: no, outcome, reason });
    if (!res.success) throw new Error(res.message);
    closeCloseModal();
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Close quotation'; }
}
function reopenQuotationAction(no) {
  if (!confirm(`Reopen ${no}?\n\nIt returns to Draft so you can revise and re-send it (the client came back).`)) return;
  _qAction('reopenQuotation', no);
}

/** Reopen an Approved/Sent quotation and drop the user straight into the edit form, so revising is
 *  one action rather than "unlock, then go find it again". Re-priced quotations go back through
 *  approval before they can be re-sent. */
async function reviseQuotationAction(no) {
  if (!confirm(`Reopen ${no} for revision?\n\nIt returns to Draft so you can change the items, prices or discount. It will need approval again before it can be sent.`)) return;
  const reason = prompt('Reason for the revision (optional — e.g. "client requested re-pricing"):', '');
  if (reason === null) return;
  try {
    const r = await postFlow('reviseQuotation', { quotationNo: no, reason });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not reopen this quotation.');
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
    editQuotation(no);            // land in the form, prefilled and ready to re-price
  } catch (e) { alert(e.message); }
}

// ─── Review modal (see details + PDF before approving) ─────────────
/** A183: prNo → pricing-request record, so the review can show the cost/margin behind a quotation. */
async function qLoadPricingRefs() {
  const r = await fetchFlow('getPricingRequests');
  qPrByNo = {};
  ((r && r.data) || []).forEach(p => { if (p && p.prNo) qPrByNo[String(p.prNo)] = p; });
}

function openReviewModal(no) {
  const q = qList.find(x => String(x.quotationNo) === String(no));
  if (!q) return;
  const role = qSession.role, st = q.status || 'Draft';
  const isApprover = (role === 'admin' && st === 'Pending Admin') ||
    ((role === 'management' || role === 'director') && st === 'Pending Management');
  document.getElementById('qrTitle').textContent = q.quotationNo;
  document.getElementById('qrSub').innerHTML =
    `${flowEsc(q.customer)} · ${flowDate(q.date)} · ${flowStatusBadge(st)} · by ${flowEsc(q.createdBy || '—')}`;
  const items = q.items || [];
  const qDisc = Math.max(0, Math.min(100, flowNum(q.discountPct) || 0));
  const discRows = qDisc > 0
    ? `<tr><td colspan="3">Subtotal</td><td class="num">${flowMoney(qtnGross(q), 'PHP')}</td></tr>
       <tr style="color:#0f766e;"><td colspan="3">Less: Discount (${flowNum(q.discountPct)}%)</td><td class="num">− ${flowMoney(qtnGross(q) * qDisc / 100, 'PHP')}</td></tr>` : '';
  document.getElementById('qrItems').innerHTML = `<table class="flow-table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line Total</th></tr></thead><tbody>${items.map(it => `<tr><td>${flowEsc(it.itemNo)} ${flowEsc(it.itemName)}</td><td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.price, 'PHP')}</td><td class="num">${flowMoney(flowNum(it.qty) * flowNum(it.price), 'PHP')}</td></tr>`).join('')}${discRows}<tr style="font-weight:700;background:var(--bg-inset,#f8fafc);"><td colspan="3">Total${qDisc > 0 ? ' (after discount, before VAT)' : ''}</td><td class="num">${flowMoney(qtnTotal(q), 'PHP')}</td></tr></tbody></table>`;
  const pv = document.getElementById('qrPdf');
  const fid = q.pdfLink ? ((q.pdfLink.match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1]) : null;
  // The panel below is a FILE saved on Drive, not a live render — say so loudly when it no longer
  // matches the figures above, because that mismatch is exactly what an approver must not miss.
  const pdfState = qPdfState(q);
  const regenBtn = `<button class="btn btn-sm btn-primary" style="margin-top:0.5rem;" onclick="qrRegenerate('${flowEsc(q.quotationNo)}')">Regenerate PDF</button>`;
  let warn = '';
  if (pdfState === 'stale') {
    const was = qPdfSavedTotals(q);
    warn = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-left:4px solid #dc2626;border-radius:8px;padding:0.7rem 0.85rem;margin-bottom:0.6rem;">
      <div style="font-weight:700;color:#b91c1c;font-size:0.85rem;">⚠ This document is out of date</div>
      <div style="font-size:0.8rem;color:#7f1d1d;margin-top:0.25rem;">
        It shows <b>${flowMoney(was.net, 'PHP')}</b>${was.discountPct ? ` (${was.discountPct}% discount)` : ''} —
        the quotation is now <b>${flowMoney(qtnTotal(q), 'PHP')}</b>${flowNum(q.discountPct) ? ` (${flowNum(q.discountPct)}% discount)` : ''}.
        ${qPdfInfo(q).hasImages ? 'Its product photos are restored automatically.' : ''}
      </div>${regenBtn}</div>`;
  } else if (pdfState === 'unverified') {
    warn = `<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:0.7rem 0.85rem;margin-bottom:0.6rem;">
      <div style="font-weight:700;color:#92400e;font-size:0.85rem;">⚠ This document can't be verified</div>
      <div style="font-size:0.8rem;color:#78350f;margin-top:0.25rem;">It was generated before change-tracking, so it may not match the figures above. Regenerate it to confirm.</div>
      ${regenBtn}</div>`;
  }
  if (fid) pv.innerHTML = warn + `<iframe src="https://drive.google.com/file/d/${fid}/preview" style="width:100%;height:440px;border:1px solid var(--border,#e2e8f0);border-radius:8px;" allowfullscreen></iframe>`;
  else if (q.pdfLink) pv.innerHTML = warn + `<a href="${flowEsc(q.pdfLink)}" target="_blank" class="link-btn">Open PDF in Drive →</a>`;
  else pv.innerHTML = `<div style="color:var(--text-muted,#64748b);font-size:0.85rem;">No PDF generated yet — review the details above, or <button class="link-btn" onclick="closeReviewModal();qcOpen('${flowEsc(q.quotationNo)}','document')">generate the PDF</button> first.</div>`;
  /* A183/A191: the pricing this quotation was built from. Accounting, management and director see
     the cost/margin breakdown; a loud banner fires when the quoted total no longer matches what
     management priced; and when that viewer is the approver, a tick "I've reviewed the pricing"
     gates Approve. Cost figures are shown to neither sales NOR admin.
     Consequence worth knowing: admin approving at Pending Admin gets no tick, because needTick
     depends on a review they cannot see. qrSyncApprove treats an absent tick requirement as
     satisfied, so admin can still approve — on the commercial terms, while management approves on
     the pricing. That split is the point of the change, not a gap in it. */
  const bd = document.getElementById('qrBreakdown');
  const pr = (qCanSeeCosts && q.prNo) ? qPrByNo[String(q.prNo)] : null;
  const review = pr ? flowQuotationPricingReview(q, pr) : null;
  const needTick = !!(isApprover && review && review.hasPr);
  if (bd) {
    if (review && review.hasPr) {
      bd.innerHTML =
        `<div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#64748b);margin-bottom:0.3rem;">Pricing management set</div>` +
        flowDeviationBanner(review) + flowOptionReviewHtml(review) + review.breakdownHtml +
        (needTick
          ? `<label style="display:flex;align-items:center;gap:0.45rem;margin-top:0.6rem;font-size:0.82rem;font-weight:600;cursor:pointer;">
               <input type="checkbox" id="qrTick" onchange="qrSyncApprove()"> I've reviewed the pricing above and confirm it.</label>`
          : '');
    } else if (qCanSeeCosts && q.prNo) {
      bd.innerHTML = `<div style="font-size:0.78rem;color:#b45309;">Pricing record for ${flowEsc(q.prNo)} not found — approval is governed by the server's pricing check.</div>`;
    } else {
      bd.innerHTML = '';
    }
  }

  const foot = document.getElementById('qrFoot');
  // Approving a quotation whose attached document shows different figures is the failure this guards
  // against — so Approve waits for a matching PDF. A183 adds a second, independent gate: the pricing
  // tick. Reject always stays available.
  const blockApprove = pdfState === 'stale' || pdfState === 'unverified';
  qrGate = { block: blockApprove, needTick: needTick };
  foot.innerHTML = `<button type="button" class="btn btn-secondary" onclick="closeReviewModal()">Close</button>` +
    (isApprover
      ? `<button type="button" class="btn btn-secondary" style="color:#dc2626;border-color:#fca5a5;" onclick="qrReject('${flowEsc(q.quotationNo)}')">Reject</button>` +
        `<button type="button" class="btn btn-primary" id="qrApproveBtn" onclick="qrApprove('${flowEsc(q.quotationNo)}')">Approve</button>`
      : `<span style="font-size:0.78rem;color:var(--text-muted,#64748b);margin-left:auto;">${st.indexOf('Pending') === 0 ? 'Awaiting ' + st.replace('Pending ', '') + ' approval' : ''}</span>`);
  qrSyncApprove();
  document.getElementById('qrModal').classList.add('open');
}

/** A183: keep Approve disabled until BOTH gates pass — a matching PDF (qrGate.block) and, for a
 *  from-PR quotation, the pricing tick. Rendered once; called on open and on each tick change. */
function qrSyncApprove() {
  const btn = document.getElementById('qrApproveBtn');
  if (!btn) return;
  const ticked = !qrGate.needTick || !!(document.getElementById('qrTick') || {}).checked;
  const ok = !qrGate.block && ticked;
  btn.disabled = !ok;
  btn.style.opacity = ok ? '' : '0.5';
  btn.style.cursor = ok ? '' : 'not-allowed';
  btn.title = qrGate.block
    ? 'Regenerate the PDF first — the attached document does not match the figures above.'
    : (!ticked ? 'Tick “I’ve reviewed the pricing” to approve.' : '');
}
function closeReviewModal() { document.getElementById('qrModal').classList.remove('open'); }
/** From the out-of-date banner: straight into the PDF dialog, prefilled from the stored doc fields
 *  so nothing has to be retyped (qcLoadExisting restores them). */
function qrRegenerate(no) { closeReviewModal(); qcOpen(no, 'document'); }
/* A183: the pricing tick in the modal IS the deviation acknowledgement, so approving from here passes
   acknowledgeDeviation — the server's per-line message (which is unreliable when reps rewrite item
   descriptions) is replaced by the visual banner + tick the approver just cleared. Harmless when
   nothing deviates: the server only consults it to skip the deviation gate. */
function qrApprove(no) { closeReviewModal(); _qAction('approveQuotation', no, { acknowledgeDeviation: true }); }
function qrReject(no) {
  const reason = prompt('Reason for rejecting ' + no + ' (optional):', '');
  if (reason === null) return;
  closeReviewModal();
  _qAction('rejectQuotation', no, { reason });
}

function renderQuotationTable(rows) {
  return `<table class="flow-table"><thead><tr><th>Quotation No</th><th>Date</th><th>Customer</th><th>Status</th><th class="num">Total</th><th>Items</th><th>PDF</th><th></th></tr></thead><tbody>${rows.map(quotationRow).join('')}</tbody></table>`;
}

// Oversight: group the (filtered) quotations into collapsible sections (one per Created By).
function renderGroupedByRep(rows) {
  const groups = {};
  // A218 — grouped by whose deal it is, not who typed it.
  (rows || qList).forEach(q => { const k = flowQuotationOwner(q) || 'Unassigned'; (groups[k] = groups[k] || []).push(q); });
  const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  return names.map((name, i) => {
    const rows = groups[name];
    // A208: the same rollup the tiles use, over this rep's slice. A single undifferentiated total
    // here is what read as "Crystal has 18 million" when 10.7M of it had never been sent.
    const r = flowQuotationRollup(rows, qHasSO);
    const conc = (r.top && r.top.share >= 0.4)
      ? ` · top deal ${Math.round(r.top.share * 100)}%` : '';
    return `<details class="rep-group"${i === 0 ? ' open' : ''}>
      <summary><span class="rep-name">${flowEsc(name)}</span>
        <span class="rep-meta">${rows.length} quotation(s) · with client ${flowMoney(r.sent.value, 'PHP')}` +
        ` · ready ${flowMoney(r.approved.value, 'PHP')}${conc}</span></summary>
      <div style="overflow-x:auto;margin-top:0.5rem;">${renderQuotationTable(rows)}</div>
    </details>`;
  }).join('');
}

/** A175 — Edit (and Revise, which calls this) now opens the Configurator above with the record
 *  loaded, so the surface that creates a quotation is also the one that revises it. The whole
 *  quotation number stays editable — changing it RENAMES the record (items, SO link and attached
 *  docs follow; the backend rejects duplicates). */
function editQuotation(no) {
  if (typeof qcOpen !== 'function') {
    alert('The quotation builder did not load — reload the page and try again.');
    return;
  }
  qcOpen(no, 'edit');
}

async function deleteQuotation(no) {
  if (!confirm('Delete quotation ' + no + '?')) return;
  try {
    const res = await postFlow('deleteQuotation', { quotationNo: no });
    if (!res.success) throw new Error(res.message);
    await loadQuotations(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
}

// ─── Saved-PDF freshness ──────────────────────────
// The row's PDF is a file on Drive; it only changes when someone regenerates. These helpers record
// what a PDF was rendered from, so the UI can tell whether the saved document still matches.

/** Everything that changes the document's contents, as a comparable object. */
function qPdfStamp(q, vatOption) {
  return {
    customer: String(q.customer || ''), date: flowDate(q.date) || '',
    subject: String(q.subject || ''), discountPct: flowNum(q.discountPct) || 0,
    vatOption: vatOption || '',
    items: (q.items || []).map(it => `${it.itemNo}|${flowNum(it.qty)}|${flowNum(it.price)}`)
  };
}

/** 'none' (no PDF) · 'fresh' · 'stale' (proven different) · 'unverified' (PDF predates stamping). */
function qPdfState(q) {
  if (!q || !q.pdfLink) return 'none';
  let data = null;
  try { data = q.pdfData ? JSON.parse(q.pdfData) : null; } catch (e) { data = null; }
  if (!data || !data.stamp) return 'unverified';
  const now = qPdfStamp(q, data.stamp.vatOption || data.vatOption || '');
  return JSON.stringify(now) === JSON.stringify(data.stamp) ? 'fresh' : 'stale';
}
function qPdfInfo(q) { try { return q.pdfData ? (JSON.parse(q.pdfData) || {}) : {}; } catch (e) { return {}; } }

/** What the saved document shows, for the out-of-date banner (from its own stamp). */
function qPdfSavedTotals(q) {
  const s = (qPdfInfo(q).stamp) || {};
  const gross = (s.items || []).reduce((t, x) => {
    const f = String(x).split('|'); return t + flowNum(f[1]) * flowNum(f[2]);
  }, 0);
  const d = Math.max(0, Math.min(100, flowNum(s.discountPct) || 0));
  return { gross, discountPct: d, net: gross * (1 - d / 100) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   A208 — attach the email that carried a quotation.

   The system cannot SEND mail (no SMTP anywhere in the repo), so this does not pretend to. The rep
   sends from GoDaddy webmail as they always have; here they point at the message. That pointer is
   the only durable record — /api/email/feed keeps nothing — and it is what makes "sent 9 days ago,
   no reply" answerable.

   The mailbox is read ONCE per modal open, from the cached feed. Nothing on the quotations page
   touches IMAP on load.
   ═══════════════════════════════════════════════════════════════════════════ */
let qeQuotationNo = '';
let qeMail = [];          // the rep's sent messages
let qeMailLoaded = false;
let qeCtx = { clientDomains: {}, dismissed: {}, linked: {} };

function qeClose() { const m = document.getElementById('qeModal'); if (m) m.style.display = 'none'; }

async function qOpenEmailLink(no) {
  qeQuotationNo = String(no);
  const q = qList.filter(x => String(x.quotationNo) === qeQuotationNo)[0];
  const m = document.getElementById('qeModal');
  if (!m || !q) return;
  document.getElementById('qeNo').textContent = qeQuotationNo;
  const fu = flowFollowUp(q, qLinks[qeQuotationNo] || [], qCfg, qHasSO);
  document.getElementById('qeSub').textContent =
    `${q.customer} · ${flowMoney(flowQuotationNet(q), 'PHP')} · ${q.status}` +
    (q.sentAt ? ` · sent ${flowDate(q.sentAt)}` : ' · not recorded as sent yet') +
    (fu.label ? ` · ${fu.label}` : '');
  m.style.display = 'flex';
  flowMsg('qeMsg', '', true);
  document.getElementById('qeMsg').style.display = 'none';
  qeRenderLinked();
  document.getElementById('qeSuggest').innerHTML =
    '<div style="padding:1.2rem;color:var(--text-muted,#64748b);font-size:0.85rem;">Reading your sent mail…</div>';
  await qeLoadMail(false);
}

/** Learned client domains + what is already linked or dismissed anywhere. */
function qeBuildCtx() {
  const byNo = {};
  qList.forEach(q => { byNo[String(q.quotationNo)] = q; });
  const all = [];
  Object.keys(qLinks).forEach(k => (qLinks[k] || []).forEach(l => all.push(l)));
  qeCtx = {
    clientDomains: (typeof qemLearnDomains === 'function') ? qemLearnDomains(all, byNo) : {},
    clientEmails: qClientEmails, clientRefs: qClientRefs,
    dismissed: {}, linked: {}
  };
  all.forEach(l => {
    const id = String(l.messageId || '').toLowerCase();
    if (!id) return;
    if (String(l.status) === 'Dismissed' && String(l.quotationNo) === qeQuotationNo) qeCtx.dismissed[id] = true;
    if (String(l.status) === 'Active') qeCtx.linked[id] = String(l.quotationNo);
  });
}

async function qeLoadMail(force) {
  const box = document.getElementById('qeSuggest');
  if (qeMailLoaded && !force) { qeRenderSuggest(); return; }
  box.innerHTML = '<div style="padding:1.2rem;color:var(--text-muted,#64748b);font-size:0.85rem;">Reading your sent mail…</div>';
  try {
    const r = await apiFetchEmailFeed('sent', 60, !!force);
    if (r && r.needsSetup) {
      box.innerHTML = '<div style="padding:1rem;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;' +
        'color:#92400e;font-size:0.85rem;">Your GoDaddy mailbox is not connected' +
        (r.reconnect ? ' any more (the stored password could not be read)' : '') +
        '. <a href="email-setup.html">Connect it</a> to attach the emails you sent.</div>';
      return;
    }
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not read your mailbox.');
    qeMail = r.emails || [];
    qeMailboxAddr = r.godaddyEmail || '';
    qeMailLoaded = true;
    qeFetchedAt = r.fetchedAt || '';
    qeCached = !!r.cached;
    qeRenderSuggest();
  } catch (e) {
    box.innerHTML = `<div style="padding:1rem;color:#b91c1c;font-size:0.85rem;">${flowEsc(e.message)}</div>`;
  }
}
let qeFetchedAt = '', qeCached = false;

function qeRenderLinked() {
  const el = document.getElementById('qeLinked');
  const links = (qLinks[qeQuotationNo] || []).filter(l => String(l.status || 'Active') === 'Active');
  if (!links.length) {
    el.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted,#64748b);padding:0.5rem 0;">' +
      'No email attached yet.</div>';
    return;
  }
  el.innerHTML = '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#64748b);margin-bottom:0.3rem;">Attached</div>' +
    links.map(l => `<div style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.5rem 0.6rem;border:1px solid var(--border,#e2e8f0);border-radius:9px;margin-bottom:0.35rem;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.85rem;font-weight:600;">${flowEsc(l.subject || '(no subject)')}</div>
        <div style="font-size:0.74rem;color:var(--text-muted,#64748b);margin-top:0.15rem;">
          ${flowEsc(l.to || '')} · ${flowEsc(flowDate(l.sentAt))} · ${flowEsc(l.kind || 'Initial')}
          ${l.replyAt ? ` · <span style="color:#1d4ed8;font-weight:600;">client replied ${flowEsc(flowDate(l.replyAt))}</span>`
            : (l.replyCheckedAt ? ' · no reply yet' : ' · reply not checked')}
        </div>
      </div>
      <button class="link-btn del-btn" onclick='qeUnlink("${flowEsc(l.linkId)}")'>remove</button>
    </div>`).join('');
}

function qeRenderSuggest() {
  const box = document.getElementById('qeSuggest');
  const q = qList.filter(x => String(x.quotationNo) === qeQuotationNo)[0];
  if (!q || typeof qemRank !== 'function') return;
  qeBuildCtx();
  const term = (document.getElementById('qeSearch') || {}).value || '';
  let pool = qeMail;
  if (term.trim()) {
    const t = term.trim().toLowerCase();
    pool = pool.filter(m => (String(m.subject || '') + ' ' + String(m.recipient || '') +
      ' ' + (m.recipients || []).map(r => r.addr).join(' ')).toLowerCase().includes(t));
  }
  const ranked = qemRank(q, pool, qeCtx).slice(0, term.trim() ? 40 : 8);
  const confident = !term.trim() && qemIsConfident(qemRank(q, qeMail, qeCtx));

  if (!ranked.length) {
    box.innerHTML = '<div style="padding:1.2rem;color:var(--text-muted,#64748b);font-size:0.85rem;">' +
      (qeMail.length ? 'Nothing matches that search.' : 'No sent mail in the last 60 days.') + '</div>';
    return;
  }
  const stamp = qeFetchedAt
    ? `<div style="font-size:0.7rem;color:var(--text-muted,#94a3b8);margin-bottom:0.4rem;">Mailbox read ${flowEsc(String(qeFetchedAt).slice(11, 16))}${qeCached ? ' (cached — Refresh for live)' : ' (live)'}</div>`
    : '';
  box.innerHTML = stamp + ranked.map((r, i) => {
    const m = r.msg, id = flowEsc(m.messageId || '');
    const top = (i === 0 && confident);
    const already = qeCtx.linked[String(m.messageId || '').toLowerCase()];
    return `<div style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.55rem 0.65rem;border:1px solid ${top ? 'var(--accent,#4f46e5)' : 'var(--border,#e2e8f0)'};border-radius:9px;margin-bottom:0.35rem;${top ? 'box-shadow:0 0 0 3px rgba(79,70,229,0.10);' : ''}">
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.85rem;font-weight:600;">${flowEsc(m.subject || '(no subject)')}</div>
        <div style="font-size:0.74rem;color:var(--text-muted,#64748b);margin-top:0.15rem;">
          ${flowEsc((m.recipients || []).map(x => x.addr).join(', ') || m.recipient || '')} · ${flowEsc(flowDate(m.sentAt || m.date))}
        </div>
        <div style="font-size:0.72rem;color:${already ? '#b45309' : '#475569'};margin-top:0.2rem;">
          ${already ? 'already attached to ' + flowEsc(already) : flowEsc(r.reasons.join(' · ') || 'no strong signal')}
        </div>
      </div>
      <div style="white-space:nowrap;">
        <button class="link-btn" onclick='qeLink("${id}")'>${top ? 'Link (suggested)' : 'Link'}</button>
        <button class="link-btn del-btn" onclick='qeDismiss("${id}")'>not this</button>
      </div>
    </div>`;
  }).join('');
}

function qeFind(messageId) {
  return qeMail.filter(m => String(m.messageId) === String(messageId))[0];
}

async function qeLink(messageId) {
  const m = qeFind(messageId);
  if (!m) return;
  try {
    const res = await postFlow('linkQuotationEmail', {
      quotationNo: qeQuotationNo, messageId: m.messageId,
      sentAt: m.sentAt || m.date || '', subject: m.subject || '',
      to: (m.recipients || []).map(x => x.addr).join(', ') || m.recipient || '',
      threadRoot: m.threadRoot || m.messageId, mailboxAddr: qeMailboxAddr || ''
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('qeMsg', res.message, true);
    await loadQuotations();
    qeRenderLinked(); qeRenderSuggest();
  } catch (e) { flowMsg('qeMsg', e.message, false); }
}
let qeMailboxAddr = '';

async function qeDismiss(messageId) {
  const m = qeFind(messageId);
  if (!m) return;
  try {
    const res = await postFlow('dismissQuotationEmail', {
      quotationNo: qeQuotationNo, messageId: m.messageId,
      subject: m.subject || '', sentAt: m.sentAt || m.date || ''
    });
    if (!res.success) throw new Error(res.message);
    await loadQuotations();
    qeRenderSuggest();
  } catch (e) { flowMsg('qeMsg', e.message, false); }
}

async function qeUnlink(linkId) {
  if (!confirm('Detach this email from ' + qeQuotationNo + '?')) return;
  try {
    const res = await postFlow('unlinkQuotationEmail', { linkId: linkId });
    if (!res.success) throw new Error(res.message);
    await loadQuotations();
    qeRenderLinked(); qeRenderSuggest();
  } catch (e) { flowMsg('qeMsg', e.message, false); }
}
