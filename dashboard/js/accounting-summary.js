/* ═══════════════════════════════════════════════
   accounting-summary.js — detailed financial summary over the Process Flow.
   Profit report (P&L), costs & expenses, payables, and full SO/PO/Invoice/
   Receiving/AP detail — filterable by Year + Month. Oversight roles only.
   No backend change: pure client-side over existing getters.
   ═══════════════════════════════════════════════ */

let asSession = null;
let asData = { sos: [], pos: [], recs: [], invs: [], aps: [] };

function _e(s) { return flowEsc(s); }
function _m(v) { return flowMoney(v, 'PHP'); }
function _n(v) { return flowNum(v); }
function _ymd(d) { return flowDate(d); }                 // YYYY-MM-DD or ''
function _yr(d) { const s = _ymd(d); return s ? s.slice(0, 4) : ''; }
function _mo(d) { const s = _ymd(d); return s ? s.slice(5, 7) : ''; }

document.addEventListener('DOMContentLoaded', async () => {
  asSession = requireOversight();
  if (!asSession) return;
  renderNavbar('accounting-summary');
  document.getElementById('refreshBtn').addEventListener('click', loadAll);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  document.getElementById('yearSel').addEventListener('change', render);
  document.getElementById('monthSel').addEventListener('change', render);
  await loadAll();
});

async function loadAll() {
  const body = document.getElementById('reportBody');
  body.innerHTML = '<div class="dr-empty">Loading…</div>';
  try {
    const [invs, sos, pos, recs, aps, ars, cols, exps] = await Promise.all([
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getReceiving').catch(() => ({ data: [] })),
      fetchFlow('getAPAging').catch(() => ({ data: [] })),
      fetchFlow('getARAging').catch(() => ({ data: [] })),
      fetchFlow('getCollections').catch(() => ({ data: [] })),
      fetchFlow('getExpenses').catch(() => ({ data: [] })),
    ]);
    asData = {
      invs: (invs && invs.data) || [], sos: (sos && sos.data) || [], pos: (pos && pos.data) || [],
      recs: (recs && recs.data) || [], aps: (aps && aps.data) || [],
      ars: (ars && ars.data) || [], cols: (cols && cols.data) || [], exps: (exps && exps.data) || [],
    };
    buildYearOptions();
    render();
  } catch (e) {
    body.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${_e(e.message)}</div>`;
  }
}

function buildYearOptions() {
  const sel = document.getElementById('yearSel');
  const years = new Set();
  [...asData.invs, ...asData.sos, ...asData.pos, ...asData.recs].forEach(r => { const y = _yr(r.date); if (y) years.add(y); });
  years.add(String(new Date().getFullYear()));
  const list = Array.from(years).sort((a, b) => b.localeCompare(a));
  const cur = sel.value || String(new Date().getFullYear());
  sel.innerHTML = list.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('');
}

function _inPeriod(d) {
  const y = document.getElementById('yearSel').value;
  const m = document.getElementById('monthSel').value;
  if (_yr(d) !== y) return false;
  if (m && _mo(d) !== m) return false;
  return true;
}

function render() {
  const y = document.getElementById('yearSel').value;
  const m = document.getElementById('monthSel').value;
  const monthLabel = m ? new Date(2000, parseInt(m, 10) - 1, 1).toLocaleString('en-US', { month: 'long' }) + ' ' : '';
  document.getElementById('reportMeta').textContent =
    `Period: ${monthLabel}${y} · Prepared ${new Date().toLocaleString('en-US')} · ${_e(asSession.name)}`;

  // ── Period-filtered datasets ──
  const invs = asData.invs.filter(r => _inPeriod(r.date));
  const sos = asData.sos.filter(r => _inPeriod(r.date));
  const pos = asData.pos.filter(r => _inPeriod(r.date));
  const recs = asData.recs.filter(r => _inPeriod(r.date));
  const aps = asData.aps.filter(r => _inPeriod(r.createdAt || r.date));
  const ars = (asData.ars || []).filter(r => _inPeriod(r.createdAt || r.date));
  const cols = (asData.cols || []).filter(r => _inPeriod(r.date));
  const exps = (asData.exps || []).filter(r => _inPeriod(r.date));

  // ── P&L ──
  const revenue = invs.reduce((s, v) => s + _n(v.totalSales), 0);
  const cogs = invs.reduce((s, v) => s + _n(v.totalCOGS), 0);
  const grossProfit = revenue - cogs;
  const margin = revenue > 0 ? (grossProfit / revenue * 100).toFixed(1) + '%' : '—';

  // ── Costs / expenses (from receiving) ──
  const duties = recs.reduce((s, r) => s + _n(r.duties), 0);
  const vat = recs.reduce((s, r) => s + _n(r.vat), 0);
  const delivery = recs.reduce((s, r) => s + _n(r.delivery), 0);
  const other = recs.reduce((s, r) => s + _n(r.other), 0);
  const shipping = recs.reduce((s, r) => s + _n(r.totalShipping), 0);

  // ── Purchases by currency ──
  const purByCur = {};
  pos.forEach(p => { const c = p.currency || 'PHP'; purByCur[c] = (purByCur[c] || 0) + _n(p.total); });
  const purStr = Object.keys(purByCur).length
    ? Object.keys(purByCur).sort().map(c => flowMoney(purByCur[c], c)).join(' · ') : '—';

  // ── Payables snapshot (all-open) + period AP ──
  const apOutAll = asData.aps.filter(a => (a.status || '').toLowerCase() !== 'paid')
    .reduce((s, a) => s + (_n(a.amountPHP) - _n(a.paidPHP)), 0);
  const apPaidPeriod = aps.reduce((s, a) => s + _n(a.paidPHP), 0);

  // ── Receivables snapshot (all-open) + collections in period ──
  const arOutAll = (asData.ars || []).filter(a => (a.status || '').toLowerCase() !== 'paid')
    .reduce((s, a) => s + _n(a.outstanding), 0);
  const collectedPeriod = cols.reduce((s, c) => s + _n(c.amount), 0);

  // ── Expenses (OpEx / G&A / Other) in period ──
  const expOpex = exps.filter(e => e.type === 'Operating').reduce((s, e) => s + _n(e.amount), 0);
  const expGa = exps.filter(e => e.type === 'General & Administrative').reduce((s, e) => s + _n(e.amount), 0);
  const expOther = exps.filter(e => e.type === 'Other').reduce((s, e) => s + _n(e.amount), 0);
  const expTotal = expOpex + expGa + expOther;
  const operatingIncome = grossProfit - expOpex - expGa;     // Other is non-operating, excluded
  const netIncome = operatingIncome - expOther;

  const pct = v => revenue > 0 ? (v / revenue * 100).toFixed(1) + '%' : '—';

  // ── KPI strip ──
  const kpis = [
    ['Revenue (Sales)', _m(revenue)], ['COGS', _m(cogs)], ['Gross Profit', _m(grossProfit)],
    ['Gross Margin', margin], ['Total Expenses', _m(expTotal)], ['Operating (OpEx)', _m(expOpex)],
    ['General & Admin', _m(expGa)], ['Other / Non-Op', _m(expOther)], ['Operating Income', _m(operatingIncome)],
    ['Collected (period)', _m(collectedPeriod)], ['AR Outstanding (open)', _m(arOutAll)],
    ['Total Purchases', purStr], ['Total Shipping', _m(shipping)],
    ['VAT Input', _m(vat)], ['AP Outstanding (open)', _m(apOutAll)],
    ['Sales Orders', String(sos.length)], ['Purchase Orders', String(pos.length)], ['Invoices', String(invs.length)],
  ];

  // AP period totals
  const apAmt = aps.reduce((s, a) => s + _n(a.amountPHP), 0);
  const apPaid = aps.reduce((s, a) => s + _n(a.paidPHP), 0);
  const apOut = apAmt - apPaid;

  document.getElementById('reportBody').innerHTML = `
    <div class="as-kpis">${kpis.map(([l, v]) => `<div class="as-kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>

    <div class="as-grid2">
      <div>
        <div class="as-sect-title">Profit Report (P&amp;L)</div>
        <table class="as-pl"><tbody>
          <tr class="bold"><td>Revenue (Sales)</td><td class="n">${_m(revenue)}</td><td class="n">100.0%</td></tr>
          <tr><td>Less: Cost of Goods Sold</td><td class="n" style="color:#f97316;">(${_m(cogs)})</td><td class="n">${pct(cogs)}</td></tr>
          <tr class="bold final"><td>Gross Profit</td><td class="n" style="color:#16a34a;">${_m(grossProfit)}</td><td class="n">${margin}</td></tr>
          <tr><td>Less: Operating Expenses (OpEx)</td><td class="n" style="color:#f97316;">(${_m(expOpex)})</td><td class="n">${pct(expOpex)}</td></tr>
          <tr><td>Less: General &amp; Administrative</td><td class="n" style="color:#f97316;">(${_m(expGa)})</td><td class="n">${pct(expGa)}</td></tr>
          <tr class="bold final"><td>Operating Income</td><td class="n" style="color:${operatingIncome >= 0 ? '#16a34a' : '#ef4444'};">${_m(operatingIncome)}</td><td class="n">${pct(operatingIncome)}</td></tr>
          <tr><td>Less: Other / Non-Operating</td><td class="n" style="color:#f97316;">(${_m(expOther)})</td><td class="n">${pct(expOther)}</td></tr>
          <tr class="bold final"><td>Net Income</td><td class="n" style="color:${netIncome >= 0 ? '#16a34a' : '#ef4444'};">${_m(netIncome)}</td><td class="n">${pct(netIncome)}</td></tr>
        </tbody></table>
        <p style="font-size:0.74rem;color:var(--text-muted);margin-top:0.5rem;">Revenue &amp; COGS come from issued invoices in the period. The flow capitalizes duties/delivery into inventory cost (recovered through COGS) and routes VAT to Input&nbsp;VAT, so operating costs appear under Costs &amp; Expenses.</p>
      </div>
      <div>
        <div class="as-sect-title">Costs &amp; Expenses</div>
        <table class="as-pl"><tbody>
          <tr><td>Cost of Goods Sold</td><td class="n">${_m(cogs)}</td></tr>
          <tr><td>Customs Duties</td><td class="n">${_m(duties)}</td></tr>
          <tr><td>Delivery</td><td class="n">${_m(delivery)}</td></tr>
          <tr><td>Other Charges</td><td class="n">${_m(other)}</td></tr>
          <tr class="bold"><td>Total Shipping (Receiving)</td><td class="n">${_m(shipping)}</td></tr>
          <tr><td>VAT Input (recoverable)</td><td class="n">${_m(vat)}</td></tr>
          <tr><td>AP Paid (period)</td><td class="n">${_m(apPaidPeriod)}</td></tr>
          <tr class="bold"><td>AP Outstanding (open, all)</td><td class="n">${_m(apOutAll)}</td></tr>
        </tbody></table>
      </div>
    </div>

    ${_tbl('Sales Orders', ['SO No', 'Date', 'Customer', 'Status', 'Total'], [4],
      sos.map(s => [_e(s.soNo), _ymd(s.date), _e(s.customer), _e(s.status), _m(s.total)]),
      ['Total', '', '', '', _m(sos.reduce((t, s) => t + _n(s.total), 0))])}

    ${_tbl('Purchase Orders', ['PO No', 'Date', 'Supplier', 'Cur', 'Status', 'Total (FC)'], [5],
      pos.map(p => [_e(p.poNo), _ymd(p.date), _e(p.supplier), _e(p.currency), _e(p.status), flowMoney(p.total, p.currency)]),
      ['Total', '', '', '', '', purStr])}

    ${_tbl('Invoices (Sales · COGS · Gross Profit)', ['INV No', 'Date', 'Customer', 'Sales', 'COGS', 'Gross Profit'], [3, 4, 5],
      invs.map(v => [_e(v.invNo), _ymd(v.date), _e(v.customer), _m(v.totalSales), _m(v.totalCOGS), _m(_n(v.totalSales) - _n(v.totalCOGS))]),
      ['Total', '', '', _m(revenue), _m(cogs), _m(grossProfit)])}

    ${_tbl('Materials Receiving (cost breakdown)', ['MR No', 'Date', 'Supplier', 'Duties', 'VAT', 'Delivery', 'Other', 'Total Shipping'], [3, 4, 5, 6, 7],
      recs.map(r => [_e(r.mrNo), _ymd(r.date), _e(r.supplier), _m(r.duties), _m(r.vat), _m(r.delivery), _m(r.other), _m(r.totalShipping)]),
      ['Total', '', '', _m(duties), _m(vat), _m(delivery), _m(other), _m(shipping)])}

    ${_tbl('AP Aging (period)', ['AP No', 'PO', 'Supplier', 'Amount (PHP)', 'Paid', 'Outstanding', 'Status'], [3, 4, 5],
      aps.map(a => [_e(a.apNo), _e(a.poNo), _e(a.supplier), _m(a.amountPHP), _m(a.paidPHP), _m(_n(a.amountPHP) - _n(a.paidPHP)), _e(a.status)]),
      ['Total', '', '', _m(apAmt), _m(apPaid), _m(apOut), ''])}

    ${_tbl('AR Aging (period)', ['AR No', 'INV', 'SO', 'Customer', 'Amount (PHP)', 'Collected', 'Outstanding', 'Status'], [4, 5, 6],
      ars.map(a => [_e(a.arNo), _e(a.invNo), _e(a.soNo), _e(a.customer), _m(a.amountPHP), _m(a.collectedPHP), _m(a.outstanding), _e(a.status)]),
      ['Total', '', '', '', _m(ars.reduce((t, a) => t + _n(a.amountPHP), 0)), _m(ars.reduce((t, a) => t + _n(a.collectedPHP), 0)), _m(ars.reduce((t, a) => t + _n(a.outstanding), 0)), ''])}

    ${_tbl('Collections (period)', ['Collection No', 'Date', 'SO', 'Customer', 'Method', 'Amount (PHP)'], [5],
      cols.map(c => [_e(c.collectionNo), _ymd(c.date), _e(c.soNo), _e(c.customer), _e(c.method), _m(c.amount)]),
      ['Total', '', '', '', '', _m(collectedPeriod)])}

    ${_tbl('Expenses (period · OpEx / G&A / Other)', ['Exp No', 'Date', 'Type', 'Category', 'Voucher', 'Description', 'Amount (PHP)'], [6],
      exps.slice().sort((a, b) => (a.type || '').localeCompare(b.type || '') || (a.category || '').localeCompare(b.category || ''))
        .map(e => [_e(e.expNo), _ymd(e.date), _e(e.type), _e(e.category), _e(e.voucherNo), _e(e.description), _m(e.amount)]),
      ['Total', '', '', '', '', '', _m(expTotal)])}
  `;
}

// Detail table: headers[], numCols = array of right-aligned column indices, rows[][] (pre-formatted),
// totals = optional footer row (array same length as headers; '' for blank cells).
function _tbl(title, headers, numCols, rows, totals) {
  const isNum = i => numCols.indexOf(i) !== -1;
  const th = headers.map((h, i) => `<th${isNum(i) ? ' class="num"' : ''}>${h}</th>`).join('');
  const body = rows.length
    ? rows.map(cols => `<tr>${cols.map((c, i) => `<td${isNum(i) ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="dr-empty">None in this period.</td></tr>`;
  const foot = (rows.length && totals)
    ? `<tr class="bold">${totals.map((t, i) => `<td${isNum(i) ? ' class="num"' : ''}>${t == null ? '' : t}</td>`).join('')}</tr>` : '';
  return `<div class="as-sect">
    <div class="as-sect-title">${title} <span class="pill">${rows.length}</span></div>
    <div style="overflow-x:auto;"><table class="flow-table"><thead><tr>${th}</tr></thead><tbody>${body}${foot}</tbody></table></div></div>`;
}
