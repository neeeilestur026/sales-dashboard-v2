/* flow-ar-aging.js — receivables generated from invoices; record collections to clear them. */
let arData = [];
let arSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  arSession = requireOversight();
  if (!arSession) return;
  renderNavbar('flow-ar-aging');
  renderFlowNav('flow-ar-aging.html');
  await loadAR();
});

async function loadAR() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getARAging');
    arData = (res && res.data) || [];
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

function render() {
  const c = document.getElementById('container');
  flowLedgerInjectCss();
  if (!arData.length) {
    c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No receivables yet. Issue an invoice to generate one.</p>';
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
    `<div class="lv-sec-title">Open receivables <span class="lv-sub">· ${open.length} listed · the totals above cover exactly these</span></div>`
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
    const res = await postFlow('recordCollection', {
      arNo, amount, ewt: flowNum(document.getElementById('collectEwt').value),
      date: document.getElementById('collectDate').value,
      method: document.getElementById('collectMethod').value,
      ref: document.getElementById('collectRef').value.trim(),
      notes: document.getElementById('collectNotes').value.trim(),
      clientRef: flowClientRef()                            // idempotent create (safe retry)
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('collectMsg', `${res.message} (status: ${res.status})`, true);
    await loadAR();
    setTimeout(closeCollect, 800);
  } catch (e) { flowMsg('collectMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Record'; }
}
