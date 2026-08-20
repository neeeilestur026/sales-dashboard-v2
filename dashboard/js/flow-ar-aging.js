/* flow-ar-aging.js — receivables generated from invoices; record collections to clear them. */
let arData = [];
let arInvoices = null;   // A248: the invoice list, or null when it could not be read
let arSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  arSession = requireOversight();
  if (!arSession) return;
  renderNavbar('flow-ar-aging');
  renderFlowNav('flow-ar-aging.html');
  await loadAR();
});

/* ── A248 — WHICH INVOICES NEVER REACHED AR AGING ─────────────────────────────────────────────────
 *
 * This page loaded ARAging and nothing else, so an invoice that produced no receivable was not merely
 * unflagged — it was UNDETECTABLE from here. The page had nothing to compare against. Its empty state
 * even read "No receivables yet. Issue an invoice to generate one.", which points the reader at
 * exactly the wrong conclusion when the real failure is an invoice that WAS issued and generated
 * nothing.
 *
 * Reconciled against the live book: every invoice created through the app has its AR row, and all 51
 * collections resolve to a real receivable. The gap is entirely migration — 65 invoices worth ₱37.3M
 * carry `Migrated (legacy)` and never got one, because backfillMigratedRecords says in its own
 * docblock that it writes "NO journals, NO inventory apply, NO AR, NO AP".
 *
 * IT REPORTS, IT DOES NOT REPAIR — deliberately. None of those 65 has any collection history, so
 * creating receivables for them would take AR outstanding from ₱1.55M to ₱38.8M and assert ₱37.3M of
 * debt the system has no evidence for. Their sales orders read Delivered/Open/Pending; there is no
 * "paid" status anywhere, so nothing here knows whether they were collected. A person does.
 *
 * The classifier is pure and lives in arReconcile() so tests/flow/ar-reconcile.js can drive it. */
function arReconcile(arRows, invRows) {
  const S = v => String(v == null ? '' : v).trim();
  const N = v => (parseFloat(v) || 0);
  const ars = (arRows || []).filter(r => r && typeof r === 'object');
  // A voided invoice is SUPPOSED to have no receivable — voidInvoice deletes it. Counting one as
  // missing is the same mistake backfillMissingAR made, and it invents debt.
  const invs = (invRows || []).filter(r => r && typeof r === 'object' && !r.voided);

  const byInv = {}, bySo = {};
  invs.forEach(v => {
    if (S(v.invNo)) byInv[S(v.invNo)] = v;
    if (S(v.soNo)) (bySo[S(v.soNo)] = bySo[S(v.soNo)] || []).push(v);
  });

  const direct = [], viaSo = [], unresolved = [];
  ars.forEach(a => {
    if (byInv[S(a.invNo)]) { direct.push(a); return; }
    /* The SO fallback. AR rows carry the legacy INV-YYYY-NNN numbering while Invoices use
       INV-YYYYMM-NNN, so the number matches nothing even though the record exists. Resolve through
       the order — but ONLY when exactly one invoice claims it. Two invoices on one order means the
       link is genuinely ambiguous, and guessing would attach a receivable to the wrong sale. */
    const m = bySo[S(a.soNo)];
    if (S(a.soNo) && m && m.length === 1) { viaSo.push(Object.assign({}, a, { _via: m[0] })); return; }
    unresolved.push(a);
  });

  const claimed = {};
  ars.forEach(a => { if (S(a.invNo)) claimed[S(a.invNo)] = 1; });
  viaSo.forEach(a => { if (a._via && S(a._via.invNo)) claimed[S(a._via.invNo)] = 1; });
  const unaged = invs.filter(v => !claimed[S(v.invNo)]);

  const year = v => S(v.date).slice(0, 4);
  return {
    direct, viaSo, unresolved, unaged,
    unagedValue: Math.round(unaged.reduce((t, v) => t + N(v.totalSales), 0) * 100) / 100,
    unagedRecent: unaged.filter(v => year(v) >= '2026'),
    unagedOlder: unaged.filter(v => year(v) < '2026'),
    unresolvedAllPaid: unresolved.length > 0 &&
      unresolved.every(a => S(a.status).toLowerCase() === 'paid')
  };
}

async function loadAR() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    /* Invoices ride along so the page can see what is NOT here. Caught separately: a convenience
       beside the ledger must never stop the ledger drawing. */
    const [res, invs] = await Promise.all([
      fetchFlow('getARAging'),
      fetchFlow('getInvoices').catch(() => null)
    ]);
    arData = (res && res.data) || [];
    arInvoices = (invs && invs.data) || null;
    render();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

// Migrated (legacy) AR records carry a Notes value starting with "Migrated (legacy)".
function arIsMigrated(r) { return String(r.notes || '').trim().toLowerCase().indexOf('migrated (legacy)') === 0; }
// Newest-created first; fall back to AR No (AR-YYYYMM-NNN) when Created At is missing/equal.
function arNewestFirst(a, b) {
  const t = new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  return t || String(b.arNo || '').localeCompare(String(a.arNo || ''));
}

/* The banner. Same ranking discipline as the AP anomaly banner (flow-ap-aging.js, A247): a gap that
   needs a person is red, an inferred-but-sound link is amber, settled history is a muted footnote.
   Showing all three as one list is how a warning becomes wallpaper. */
function arReconcileBanner() {
  if (!arInvoices) return '';                      // invoices could not be read — say nothing
  const r = arReconcile(arData, arInvoices);
  const money = v => flowMoney(flowNum(v), 'PHP');
  const esc = v => flowEsc(v);
  const out = [];

  if (r.unaged.length) {
    const recent = r.unagedRecent.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    out.push(`<div style="border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;
        padding:0.6rem 0.8rem;margin-bottom:0.6rem;font-size:0.8rem;">
      <div style="font-weight:700;margin-bottom:0.3rem;">
        ⚠ ${r.unaged.length} invoice(s) totalling ${money(r.unagedValue)} have no receivable here</div>
      <div style="margin-bottom:0.35rem;">They are not on this page at all, so they are in no aging
        bucket and no outstanding total. Nothing was written to fix this — none of them carries any
        collection history, so creating receivables would assert money owed that the system cannot
        evidence either way.</div>
      ${recent.length ? `<div style="margin-top:0.3rem;"><strong>${recent.length} from 2026:</strong>
        ${recent.map(v => `<div style="margin-left:0.4rem;">${esc(v.invNo)} · ${esc(String(v.customer || '').slice(0, 34))}
          · ${esc(String(v.date).slice(0, 10))} · ${money(v.totalSales)}</div>`).join('')}</div>` : ''}
      ${r.unagedOlder.length ? `<div style="margin-top:0.3rem;color:#7f1d1d;">
        and ${r.unagedOlder.length} from 2025 or earlier
        (${money(r.unagedOlder.reduce((t, v) => t + flowNum(v.totalSales), 0))}) — migration-era
        history, listed here for completeness rather than as work.</div>` : ''}
    </div>`);
  }

  if (r.viaSo.length) {
    out.push(`<div style="border:1px solid #fed7aa;background:#fffbeb;color:#92400e;border-radius:10px;
        padding:0.55rem 0.8rem;margin-bottom:0.6rem;font-size:0.78rem;">
      <strong>${r.viaSo.length} receivable(s) are matched to their invoice through the sales order,
      not the invoice number.</strong> They carry the older INV-YYYY-NNN numbering while invoices now
      use INV-YYYYMM-NNN, so the number matches nothing even though the invoice exists. The link is
      inferred, and only where exactly one invoice claims that order — never where it is ambiguous.</div>`);
  }

  if (r.unresolved.length) {
    out.push(`<div style="color:var(--text-muted,#64748b);font-size:0.75rem;margin-bottom:0.6rem;">
      ${r.unresolved.length} legacy receivable(s) name an invoice that does not exist and carry no
      sales order, so they cannot be matched to anything${r.unresolvedAllPaid
        ? ' — all of them are settled, so there is nothing to chase' : ''}.</div>`);
  }
  return out.join('');
}

function render() {
  const c = document.getElementById('container');
  flowLedgerInjectCss();
  if (!arData.length) {
    /* A248 — this used to say "Issue an invoice to generate one", which is the wrong instruction in
       the one case that matters: an invoice WAS issued and produced nothing. The banner runs first,
       so if that is what happened the reader is told so instead of being sent to do it again. */
    c.innerHTML = arReconcileBanner() +
      '<p style="color:var(--text-muted,#64748b);">No receivables recorded' +
      (arInvoices && arInvoices.length ? ' — even though there are invoices on the book.' : ' yet.') +
      '</p>';
    updateKpis([]); return;
  }
  // A157: filter on Due Date — every AR carries one and it spreads across the real business months,
  // whereas Created At is only the import stamp (the 52 migrated rows all share it).
  flowLedgerBuildPeriod(arData, 'dueDate', 'arYear', 'arMonth');
  const rows = flowLedgerFilterPeriod(arData, 'dueDate', 'arYear', 'arMonth');
  // Open = still owed. History = settled receivables AND the migrated legacy ledger.
  const { open, history } = flowLedgerSplit(rows, arIsOpen);
  open.sort(arNewestFirst); history.sort(arNewestFirst);

  const openTable = open.length
    ? `<table class="flow-table flow-items" style="min-width:880px;">${arHead()}<tbody>${open.map(rowHtml).join('')}${arFoot(open)}</tbody></table>`
    : '<p style="color:var(--text-muted,#64748b);">No open receivables in this period.</p>';
  const histTable = history.length
    ? `<table class="flow-table flow-items" style="min-width:880px;">${arHead()}<tbody>${history.map(rowHtml).join('')}</tbody></table>` : '';

  c.innerHTML =
    arReconcileBanner()
    + `<div class="lv-sec-title">Open receivables <span class="lv-sub">· ${open.length} listed · the totals above cover exactly these</span></div>`
    + openTable
    + flowLedgerHistoryBlock({
        title: 'Settled & migrated (legacy) receivables',
        count: history.length,
        subtotalLabel: 'collected',
        subtotal: history.reduce((t, r) => t + flowNum(r.collectedPHP), 0),
        tableHtml: histTable
      });
  updateKpis(open);
}

/** Still owed: anything not fully collected. */
function arIsOpen(r) { return String(r.status || '').toLowerCase() !== 'paid'; }
/** Collected more than the amount due — always worth explaining rather than quietly excluding. */
function arOverCollected(r) { return Math.max(0, flowNum(r.collectedPHP) - flowNum(r.amountPHP)); }

function arHead() {
  return `<thead><tr>
    <th>AR No</th><th>INV</th><th>SO</th><th>Customer</th><th class="num">Amount</th><th class="num">Collected</th>
    <th class="num">Outstanding</th><th>Status</th><th style="width:140px;">Due Date</th><th style="width:150px;">Notes</th><th></th></tr></thead>`;
}

/** Totals footer — the Outstanding column visibly adds to the Outstanding KPI. */
function arFoot(open) {
  return flowLedgerFootRow([
    { at: 4, value: flowMoney(open.reduce((t, r) => t + flowNum(r.amountPHP), 0), 'PHP') },
    { at: 5, value: flowMoney(open.reduce((t, r) => t + flowNum(r.collectedPHP), 0), 'PHP') },
    { at: 6, value: flowMoney(open.reduce((t, r) => t + flowNum(r.outstanding), 0), 'PHP') }
  ], 11);
}

function rowHtml(r) {
  const done = r.status === 'Paid';
  // A157: an over-collected row is why a total can stop matching its column — say so on the row.
  const over = arOverCollected(r);
  const warn = over > 0.005
    ? ` <span class="lv-warn" title="Collected ${flowMoney(over, 'PHP')} more than the amount due — usually withholding tax recorded as cash. Correct the collection split.">⚠ over ${flowMoney(over, 'PHP')}</span>` : '';
  return `<tr data-ar="${flowEsc(r.arNo)}">
    <td>${flowEsc(r.arNo)}</td><td>${flowEsc(r.invNo)}</td><td>${flowEsc(r.soNo)}</td><td>${flowEsc(r.customer)}</td>
    <td class="num">${flowMoney(r.amountPHP, 'PHP')}</td>
    <td class="num">${flowMoney(r.collectedPHP, 'PHP')}${warn}</td>
    <td class="num">${flowMoney(r.outstanding, 'PHP')}</td>
    <td>${flowStatusBadge(r.status)}</td>
    <td><input type="date" class="f-due" value="${flowDate(r.dueDate)}"></td>
    <td><input type="text" class="f-notes" value="${flowEsc(r.notes)}"></td>
    <td style="white-space:nowrap;">
      ${done ? '' : `<button class="link-btn" onclick='openCollect("${flowEsc(r.arNo)}")'>Collect</button>`}
      <button class="link-btn" onclick="saveRow('${flowEsc(r.arNo)}', this)" style="margin-left:0.4rem;">Save</button>
      <button class="link-btn" onclick='openDocsModal("AR Aging","${flowEsc(r.arNo)}")' style="margin-left:0.4rem;">Docs</button>
    </td></tr>`;
}

/* A157: computed from the SAME open rows the table lists, so the Outstanding KPI is by construction
   the sum of the Outstanding column — the discrepancy that started this was a Paid row carrying a
   negative outstanding, counted by the column but skipped by the headline. Over-collection is now
   surfaced as its own figure instead of silently vanishing. */
function updateKpis(open) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const today = new Date();
  const b = { cur: 0, b30: 0, b60: 0, b60p: 0 };
  let out = 0;
  (open || []).forEach(r => {
    const o = flowNum(r.outstanding);
    out += o;
    const due = r.dueDate ? new Date(flowDate(r.dueDate)) : null;
    const days = due && !isNaN(due) ? Math.floor((today - due) / 86400000) : 0;
    if (days <= 0) b.cur += o; else if (days <= 30) b.b30 += o;
    else if (days <= 60) b.b60 += o; else b.b60p += o;
  });
  set('kpiCount', (open || []).length);
  set('kpiOut', flowMoney(out, 'PHP'));
  set('kpiCollected', flowMoney((open || []).reduce((t, r) => t + flowNum(r.collectedPHP), 0), 'PHP'));
  set('arCur', flowMoney(b.cur, 'PHP'));
  set('arB30', flowMoney(b.b30, 'PHP'));
  set('arB60', flowMoney(b.b60, 'PHP'));
  set('arB60p', flowMoney(b.b60p, 'PHP'));

  // Over-collected across the WHOLE ledger, not just the open rows: it is a credit owed back /
  // unrecorded withholding tax, and it must be explainable wherever it sits.
  const over = arData.reduce((t, r) => t + arOverCollected(r), 0);
  const el = document.getElementById('arOverWrap');
  if (el) {
    el.style.display = over > 0.005 ? '' : 'none';
    const v = document.getElementById('arOver');
    if (v) v.textContent = flowMoney(over, 'PHP');
  }
}

function arApplyFilter() { render(); }

async function saveRow(arNo, btn) {
  const tr = btn.closest('tr');
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await postFlow('updateARAging', {
      arNo, dueDate: tr.querySelector('.f-due').value, notes: tr.querySelector('.f-notes').value
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', 'AR entry saved.', true);
    await loadAR();
  } catch (e) { flowMsg('msg', e.message, false); btn.disabled = false; btn.textContent = 'Save'; }
}

// ─── Collection modal ─────────────────────────────
function openCollect(arNo) {
  const r = arData.find(x => x.arNo === arNo);
  if (!r) return;
  document.getElementById('collectArNo').value = arNo;
  document.getElementById('collectSub').textContent = `${arNo} · ${r.customer} · outstanding ${flowMoney(r.outstanding, 'PHP')}`;
  document.getElementById('collectAmount').value = r.outstanding > 0 ? r.outstanding : '';
  document.getElementById('collectEwt').value = '';
  document.getElementById('collectDate').value = flowToday();
  document.getElementById('collectRef').value = '';
  document.getElementById('collectNotes').value = '';
  document.getElementById('collectMsg').style.display = 'none';
  collectRecalcNet();
  document.getElementById('collectModal').classList.add('open');
}
function closeCollect() { document.getElementById('collectModal').classList.remove('open'); }

function collectRecalcNet() {
  const amount = flowNum(document.getElementById('collectAmount').value);
  const ewt = flowNum(document.getElementById('collectEwt').value);
  const net = amount - ewt;
  document.getElementById('collectNet').textContent =
    `Net cash = ${flowMoney(net, 'PHP')}  (Amount ${flowMoney(amount, 'PHP')} − EWT ${flowMoney(ewt, 'PHP')})`;
}

async function submitCollection() {
  const arNo = document.getElementById('collectArNo').value;
  const amount = flowNum(document.getElementById('collectAmount').value);
  if (!(amount > 0)) { flowMsg('collectMsg', 'Enter an amount greater than zero.', false); return; }
  const btn = document.getElementById('collectBtn');
  btn.disabled = true; btn.textContent = 'Recording...';
  try {
    const payload = {
      arNo, amount, ewt: flowNum(document.getElementById('collectEwt').value),
      date: document.getElementById('collectDate').value,
      method: document.getElementById('collectMethod').value,
      ref: document.getElementById('collectRef').value.trim(),
      notes: document.getElementById('collectNotes').value.trim(),
      clientRef: flowClientRef()                            // idempotent create (safe retry)
    };
    let res = await postFlow('recordCollection', payload);
    // A158: this would collect more than the receivable is due — a real overpayment happens, but it
    // should be a decision rather than a silent entry that only gets flagged afterwards.
    if (!res.success && res.needsConfirm === 'overCollect') {
      if (!confirm(res.message)) { flowMsg('collectMsg', 'Not recorded — check the amount.', false); return; }
      res = await postFlow('recordCollection', Object.assign({}, payload, { confirmOver: true }));
    }
    if (!res.success) throw new Error(res.message);
    flowMsg('collectMsg', `${res.message} (status: ${res.status})`, true);
    await loadAR();
    setTimeout(closeCollect, 800);
  } catch (e) { flowMsg('collectMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Record'; }
}
