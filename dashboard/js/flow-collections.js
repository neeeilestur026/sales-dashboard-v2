/* flow-collections.js — client payments to us: per-invoice/SO collection status + the payment ledger,
   filterable per sales order / client / month / year. (AR Aging is where collections are recorded.) */
let colData = [];   // collection ledger rows
let arData = [];    // AR (per-invoice receivable) rows
let colSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  colSession = requireAccountingOrAdmin();
  if (!colSession) return;
  renderNavbar('flow-collections');
  renderFlowNav('flow-collections.html');
  ['fSO', 'fClient', 'fYear', 'fMonth'].forEach(id => document.getElementById(id).addEventListener('change', render));
  await loadCollections();
});

async function loadCollections() {
  document.getElementById('container').innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const [cols, ars] = await Promise.all([
      fetchFlow('getCollections').catch(() => ({ data: [] })),
      fetchFlow('getARAging').catch(() => ({ data: [] })),
    ]);
    colData = (cols && cols.data) || [];
    arData = (ars && ars.data) || [];
    buildFilterOptions();
    render();
  } catch (e) {
    document.getElementById('container').innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`;
  }
}

function _yr(d) { const s = flowDate(d); return s ? s.slice(0, 4) : ''; }
function _mo(d) { const s = flowDate(d); return s ? s.slice(5, 7) : ''; }

function buildFilterOptions() {
  const fill = (id, vals) => {
    const sel = document.getElementById(id), cur = sel.value, first = sel.options[0].outerHTML;
    sel.innerHTML = first + Array.from(new Set(vals)).filter(Boolean).sort().map(v =>
      `<option value="${flowEsc(v)}"${v === cur ? ' selected' : ''}>${flowEsc(v)}</option>`).join('');
  };
  fill('fSO', [...colData.map(c => c.soNo), ...arData.map(a => a.soNo)]);
  fill('fClient', [...colData.map(c => c.customer), ...arData.map(a => a.customer)]);
  fill('fYear', [...colData.map(c => _yr(c.date)), ...arData.map(a => _yr(a.createdAt))]);
}

function resetFilters() {
  ['fSO', 'fClient', 'fYear', 'fMonth'].forEach(id => { document.getElementById(id).value = ''; });
  render();
}

function _f() {
  return {
    so: document.getElementById('fSO').value, cl: document.getElementById('fClient').value,
    yr: document.getElementById('fYear').value, mo: document.getElementById('fMonth').value,
  };
}
function _filteredCols() {
  const { so, cl, yr, mo } = _f();
  return colData.filter(c => (!so || String(c.soNo) === so) && (!cl || String(c.customer) === cl) &&
    (!yr || _yr(c.date) === yr) && (!mo || _mo(c.date) === mo));
}
function _filteredAR() {
  const { so, cl, yr, mo } = _f();
  return arData.filter(a => (!so || String(a.soNo) === so) && (!cl || String(a.customer) === cl) &&
    (!yr || _yr(a.createdAt) === yr) && (!mo || _mo(a.createdAt) === mo));
}

function render() {
  const cols = _filteredCols();
  const ars = _filteredAR();

  // ── KPIs ──
  const collected = cols.reduce((s, c) => s + flowNum(c.amount), 0);
  const outstanding = ars.reduce((s, a) => s + flowNum(a.outstanding), 0);
  const pending = ars.filter(a => (a.status || '').toLowerCase() !== 'paid').length;
  const clients = new Set([...cols.map(c => c.customer), ...ars.map(a => a.customer)].filter(Boolean));
  document.getElementById('kpiOut').textContent = flowMoney(outstanding, 'PHP');
  document.getElementById('kpiTotal').textContent = flowMoney(collected, 'PHP');
  document.getElementById('kpiPending').textContent = pending;
  document.getElementById('kpiClients').textContent = clients.size;
  document.getElementById('kpiCount').textContent = `· ${cols.length} payment(s)`;

  // ── Receivables — invoice status ──
  const arC = document.getElementById('arContainer');
  if (!ars.length) {
    arC.innerHTML = '<p style="color:var(--text-muted,#64748b);">No receivables match the filters. Issue an invoice to create one.</p>';
  } else {
    const tAmt = ars.reduce((s, a) => s + flowNum(a.amountPHP), 0);
    const tCol = ars.reduce((s, a) => s + flowNum(a.collectedPHP), 0);
    const tOut = ars.reduce((s, a) => s + flowNum(a.outstanding), 0);
    arC.innerHTML = `<table class="flow-table" style="min-width:820px;"><thead><tr>
      <th>AR No</th><th>INV</th><th>SO</th><th>Customer</th><th class="num">Amount</th><th class="num">Collected</th>
      <th class="num">Outstanding</th><th>Status</th></tr></thead><tbody>${ars.map(a => `
      <tr><td>${flowEsc(a.arNo)}</td><td>${flowEsc(a.invNo)}</td><td>${flowEsc(a.soNo)}</td><td>${flowEsc(a.customer)}</td>
      <td class="num">${flowMoney(a.amountPHP, 'PHP')}</td><td class="num">${flowMoney(a.collectedPHP, 'PHP')}</td>
      <td class="num">${flowMoney(a.outstanding, 'PHP')}</td><td>${flowStatusBadge(a.status)}</td></tr>`).join('')}
      <tr style="font-weight:700;"><td colspan="4">Total (${ars.length})</td><td class="num">${flowMoney(tAmt, 'PHP')}</td>
      <td class="num">${flowMoney(tCol, 'PHP')}</td><td class="num">${flowMoney(tOut, 'PHP')}</td><td></td></tr>
      </tbody></table>`;
  }

  // ── Collection ledger ──
  const c = document.getElementById('container');
  if (!cols.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No collections match the filters.</p>'; return; }
  c.innerHTML = `<table class="flow-table" style="min-width:880px;"><thead><tr>
    <th>Collection No</th><th>Date</th><th>AR / INV</th><th>SO</th><th>Customer</th>
    <th class="num">Amount</th><th>Method</th><th>Reference</th><th>Notes</th></tr></thead><tbody>${cols.map(r => `
    <tr><td>${flowEsc(r.collectionNo)}</td><td>${flowDate(r.date)}</td><td>${flowEsc(r.arNo)} · ${flowEsc(r.invNo)}</td>
    <td>${flowEsc(r.soNo)}</td><td>${flowEsc(r.customer)}</td>
    <td class="num">${flowMoney(r.amount, 'PHP')}</td><td>${flowEsc(r.method)}</td><td>${flowEsc(r.reference)}</td>
    <td>${flowEsc(r.notes)}</td></tr>`).join('')}
    <tr style="font-weight:700;"><td colspan="5">Total (${cols.length})</td><td class="num">${flowMoney(collected, 'PHP')}</td><td colspan="3"></td></tr>
    </tbody></table>`;
}
