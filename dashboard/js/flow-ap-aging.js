/* flow-ap-aging.js — edit PHP amount / status / payment on PO-generated payables */
let apData = [];
let apSession = null;
let apCanDelete = false;   // A145: only admin/accounting may remove a stale AP row

document.addEventListener('DOMContentLoaded', async () => {
  apSession = requireOversight();
  if (!apSession) return;
  apCanDelete = apSession.role === 'admin' || apSession.role === 'accounting';
  renderNavbar('flow-ap-aging');
  renderFlowNav('flow-ap-aging.html');
  await loadAP();
});

async function loadAP() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getAPAging');
    apData = (res && res.data) || [];
    render();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function badgeClass(s) {
  s = (s || '').toLowerCase();
  if (s === 'paid') return 'b-paid';
  if (s === 'partial') return 'b-partial';
  return 'b-unpaid';
}

function render() {
  const c = document.getElementById('container');
  flowLedgerInjectCss();
  if (!apData.length) {
    c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No payables yet. Create a Purchase Order to generate one.</p>';
    updateKpis([]); return;
  }
  flowLedgerBuildPeriod(apData, 'createdAt', 'apYear', 'apMonth');
  // A157: the period filter runs on Created At — AP due dates are mostly blank, so filtering on them
  // would silently hide most of the ledger.
  const rows = flowLedgerFilterPeriod(apData, 'createdAt', 'apYear', 'apMonth');
  const { open, history } = flowLedgerSplit(rows, apIsOpen);

  const openTable = open.length
    ? `<table class="flow-table flow-items">${apHead()}<tbody>${open.map(rowHtml).join('')}${apFoot(open)}</tbody></table>`
    : '<p style="color:var(--text-muted,#64748b);">No open payables in this period.</p>';
  const histTable = history.length
    ? `<table class="flow-table flow-items">${apHead()}<tbody>${history.map(rowHtml).join('')}</tbody></table>` : '';

  c.innerHTML =
    `<div class="lv-sec-title">Open payables <span class="lv-sub">· ${open.length} listed · the totals above cover exactly these</span></div>`
    + openTable
    + flowLedgerHistoryBlock({
        title: 'Settled payables',
        count: history.length,
        subtotalLabel: 'paid',
        subtotal: history.reduce((t, r) => t + flowNum(r.amountPHP), 0),
        tableHtml: histTable
      });
  updateKpis(open);
}

/** Still in play: anything not fully settled. */
function apIsOpen(r) { return String(r.status || '').toLowerCase() !== 'paid'; }
function apOutstanding(r) { return flowNum(r.amountPHP) - flowNum(r.paidPHP); }

function apHead() {
  return `<thead><tr>
    <th>AP No</th><th>PO</th><th>Supplier</th><th>Cur</th><th class="num">Amount (FC)</th>
    <th class="num" style="width:130px;">Amount (PHP)</th><th style="width:110px;">Status</th>
    <th style="width:140px;">Due Date</th><th class="num" style="width:120px;">Paid (PHP)</th>
    <th style="width:160px;">Notes</th><th style="width:150px;">Payment Request</th><th></th></tr></thead>`;
}

/** The on-screen proof that the Unpaid KPI is the sum of the Outstanding actually listed. */
function apFoot(open) {
  const amt = open.reduce((t, r) => t + flowNum(r.amountPHP), 0);
  const paid = open.reduce((t, r) => t + flowNum(r.paidPHP), 0);
  return flowLedgerFootRow([
    { at: 5, value: flowMoney(amt, 'PHP') },
    { at: 8, value: flowMoney(paid, 'PHP') }
  ], 12);
}

function rowHtml(r) {
  return `<tr data-row="${r.rowIndex}">
    <td>${flowEsc(r.apNo)}</td><td>${flowEsc(r.poNo)}</td><td>${flowEsc(r.supplier)}</td><td>${flowEsc(r.currency)}</td>
    <td class="num">${flowMoney(r.amountFC, r.currency)}</td>
    <td class="num"><input type="number" step="any" min="0" class="f-php" value="${r.amountPHP || ''}" placeholder="0.00"></td>
    <td><select class="f-status">${['Unpaid','Partial','Paid'].map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
    <td><input type="date" class="f-due" value="${flowDate(r.dueDate)}"></td>
    <td class="num"><input type="number" step="any" min="0" class="f-paid" value="${r.paidPHP || ''}" placeholder="0.00"></td>
    <td><input type="text" class="f-notes" value="${flowEsc(r.notes)}"></td>
    <td>${r.prNo ? `<a class="link-btn" href="flow-payment-requests.html" title="Open Payment Requests">${flowEsc(r.prNo)}</a>${r.prStatus ? ' ' + (typeof flowStatusBadge === 'function' ? flowStatusBadge(r.prStatus) : flowEsc(r.prStatus)) : ''}` : '<span style="color:var(--text-muted,#64748b);">—</span>'}</td>
    <td style="white-space:nowrap;"><button class="link-btn" onclick="saveRow(${r.rowIndex}, this)">Save</button>
    <button class="link-btn" onclick='openDocsModal("AP Aging","${flowEsc(r.apNo)}")' style="margin-left:0.4rem;">Docs</button>
    ${apCanDelete ? `<button class="link-btn del-btn" onclick='deleteAP("${flowEsc(r.apNo)}")' style="margin-left:0.4rem;">Delete</button>` : ''}</td></tr>`;
}

/* A157: every card is computed from the SAME open rows the table just rendered — one fetch, one rule.
   The aging buckets used to live in a one-shot inline script with their own fetch that never re-ran
   after a save, so they could disagree with the list underneath them. */
function updateKpis(open) {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  let unpaid = 0;
  const today = new Date();
  const b = { cur: 0, b30: 0, b60: 0, b60p: 0 };
  (open || []).forEach(r => {
    const out = apOutstanding(r);
    unpaid += out;
    // Same rule as the headline (no `out <= 0` skip), so the four buckets always add back to it.
    const due = r.dueDate ? new Date(flowDate(r.dueDate)) : null;
    const days = due && !isNaN(due) ? Math.floor((today - due) / 86400000) : 0;
    if (days <= 0) b.cur += out; else if (days <= 30) b.b30 += out;
    else if (days <= 60) b.b60 += out; else b.b60p += out;
  });
  set('kpiCount', (open || []).length);
  set('kpiUnpaid', flowMoney(unpaid, 'PHP'));
  set('kpiPaid', flowMoney(apData.filter(r => !apIsOpen(r)).reduce((t, r) => t + flowNum(r.amountPHP), 0), 'PHP'));
  set('kpiCurrent', flowMoney(b.cur, 'PHP'));
  set('kpiB30', flowMoney(b.b30, 'PHP'));
  set('kpiB60', flowMoney(b.b60, 'PHP'));
  set('kpiB60p', flowMoney(b.b60p, 'PHP'));
}

function apApplyFilter() { render(); }

async function saveRow(rowIndex, btn) {
  const tr = btn.closest('tr');
  const payload = {
    rowIndex,
    amountPHP: tr.querySelector('.f-php').value || 0,
    status: tr.querySelector('.f-status').value,
    dueDate: tr.querySelector('.f-due').value,
    paidPHP: tr.querySelector('.f-paid').value || 0,
    notes: tr.querySelector('.f-notes').value
  };
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await postFlow('updateAPAging', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', `AP entry saved.`, true);
    await loadAP();
  } catch (e) { flowMsg('msg', e.message, false); btn.disabled = false; btn.textContent = 'Save'; }
}

// A145: remove a stale/duplicate AP row (the A114 cleanup, now reachable). The backend refuses when a
// payment has been recorded, so a genuine payable can't be deleted out from under a payment request.
async function deleteAP(apNo) {
  if (!confirm('Delete AP entry ' + apNo + '? Use this only to clear a stale duplicate — a payable with a recorded payment cannot be deleted.')) return;
  try {
    const res = await postFlow('deleteAPEntry', { apNo });
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', 'AP entry removed.', true);
    await loadAP();
  } catch (e) { flowMsg('msg', e.message, false); }
}
