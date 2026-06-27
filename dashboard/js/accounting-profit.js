/* ═══════════════════════════════════════════════
   accounting-profit.js — Monthly Profit & Loss breakdown on the Accounting home.
   Rows = each month of the selected year (Revenue · COGS · Gross Profit +margin ·
   Expenses · Net Profit +margin), expandable to a per-Sales-Order breakdown +
   expense-category breakdown + net footer, with a year grand-total row.
   Pure client-side over getInvoices / getSalesOrders / getExpenses — includes all
   sales orders (incl. migrated) and all expenses (incl. migrated). No backend change.
   ═══════════════════════════════════════════════ */

let pnlData = { invs: [], sos: [], exps: [] };
let pnlMonthsCache = [];   // rendered month models (for expand toggling)

function _pe(s) { return flowEsc(s); }
function _pm(v) { return flowMoney(v, 'PHP'); }
function _pn(v) { return flowNum(v); }
function _pymd(d) { return flowDate(d); }                 // YYYY-MM-DD or ''
function _pyr(d) { const s = _pymd(d); return s ? s.slice(0, 4) : ''; }

const _PNL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' from any date the flow stores (ISO, 'Wed Mar 26 2026', etc.). */
function _pnlYM(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  return '';
}
function _pnlFmtMonth(ym) {
  const p = ym.split('-');
  return p.length === 2 ? (_PNL_MONTHS[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0] : ym;
}

document.addEventListener('DOMContentLoaded', () => {
  const yEl = document.getElementById('pnlYear');
  if (!yEl) return;     // section not present
  yEl.addEventListener('change', pnlRender);
  pnlLoad();
});

async function pnlLoad() {
  const state = document.getElementById('pnlState');
  const body = document.getElementById('pnlBody');
  if (typeof _flowConfigured !== 'function' || !_flowConfigured()) {
    if (state) state.textContent = 'Flow backend not configured';
    if (body) body.innerHTML = '<div class="pnl-empty">Process Flow backend is not configured.</div>';
    return;
  }
  if (state) state.textContent = 'Loading…';
  try {
    const [invs, sos, exps] = await Promise.all([
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getExpenses').catch(() => ({ data: [] })),
    ]);
    pnlData = {
      invs: (invs && invs.data) || [],
      sos: (sos && sos.data) || [],
      exps: (exps && exps.data) || [],
    };
    pnlBuildYears();
    pnlRender();
  } catch (e) {
    if (state) state.textContent = 'Unavailable';
    if (body) body.innerHTML = `<div class="pnl-empty" style="color:#ef4444;">${_pe(e.message)}</div>`;
  }
}

function pnlBuildYears() {
  const sel = document.getElementById('pnlYear');
  const years = new Set();
  [...pnlData.invs, ...pnlData.sos].forEach(r => { const y = _pyr(r.date); if (y) years.add(y); });
  years.add(String(new Date().getFullYear()));
  const list = Array.from(years).sort((a, b) => b.localeCompare(a));
  const cur = sel.value || String(new Date().getFullYear());
  sel.innerHTML = list.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('')
    + `<option value=""${cur === '' ? ' selected' : ''}>All years</option>`;
}

/** Build month models for the selected year (or all years). */
function pnlBuildMonths(year) {
  // Revenue/COGS per SO from all invoices.
  const invBySo = {};
  const allSo = new Set();
  pnlData.sos.forEach(s => allSo.add(String(s.soNo)));
  pnlData.invs.forEach(v => {
    const k = v.soNo ? String(v.soNo) : '';
    if (!k) return;
    if (!invBySo[k]) invBySo[k] = { sales: 0, cogs: 0 };
    invBySo[k].sales += _pn(v.totalSales);
    invBySo[k].cogs += _pn(v.totalCOGS);
  });

  const inYear = ym => !year || ym.slice(0, 4) === year;
  const byMonth = {};   // ym -> { revenue, cogs, grossProfit, soCount, entries[], expTotal, expByCat{} }
  const month = ym => (byMonth[ym] = byMonth[ym] || { revenue: 0, cogs: 0, grossProfit: 0, soCount: 0, entries: [], expTotal: 0, expByCat: {} });

  // Sales-order-driven revenue (incl. migrated SOs); invoiced → invoice totals, else SO order total.
  pnlData.sos.forEach(s => {
    const ym = _pnlYM(s.date);
    if (!ym || !inYear(ym)) return;
    const inv = invBySo[String(s.soNo)];
    const sales = inv ? inv.sales : _pn(s.total);
    const cogs = inv ? inv.cogs : 0;
    const m = month(ym);
    m.revenue += sales; m.cogs += cogs; m.grossProfit += (sales - cogs); m.soCount++;
    m.entries.push({ soNo: s.soNo || '', date: s.date || '', customer: s.customer || '', sales, cogs, gp: sales - cogs });
  });
  // Orphan invoices (no SO record) → bucket by invoice month.
  pnlData.invs.forEach(v => {
    const k = v.soNo ? String(v.soNo) : '';
    if (k && allSo.has(k)) return;     // already counted under its SO
    const ym = _pnlYM(v.date);
    if (!ym || !inYear(ym)) return;
    const sales = _pn(v.totalSales), cogs = _pn(v.totalCOGS);
    const m = month(ym);
    m.revenue += sales; m.cogs += cogs; m.grossProfit += (sales - cogs); m.soCount++;
    m.entries.push({ soNo: v.soNo || '', date: v.date || '', customer: v.customer || '', sales, cogs, gp: sales - cogs });
  });
  // Expenses by month + category (incl. migrated).
  pnlData.exps.forEach(e => {
    const ym = _pnlYM(e.date);
    if (!ym || !inYear(ym)) return;
    const m = month(ym);
    const amt = _pn(e.amount);
    m.expTotal += amt;
    const cat = e.category || e.type || 'Other';
    m.expByCat[cat] = (m.expByCat[cat] || 0) + amt;
  });

  return Object.keys(byMonth).sort().reverse().map(ym => {
    const m = byMonth[ym];
    return { ym, ...m, net: m.grossProfit - m.expTotal };
  });
}

function pnlRender() {
  const state = document.getElementById('pnlState');
  const year = document.getElementById('pnlYear').value;     // '' = all years
  if (state) state.textContent = `${year || 'All years'} · live from Process Flow`;

  const months = pnlBuildMonths(year);
  pnlMonthsCache = months;

  const totRev = months.reduce((s, m) => s + m.revenue, 0);
  const totCOGS = months.reduce((s, m) => s + m.cogs, 0);
  const totGP = months.reduce((s, m) => s + m.grossProfit, 0);
  const totExp = months.reduce((s, m) => s + m.expTotal, 0);
  const totNet = totGP - totExp;
  const margin = totRev > 0 ? (totGP / totRev * 100).toFixed(1) + '%' : '—';

  // KPI strip (scope totals)
  const totals = document.getElementById('pnlTotals');
  if (totals) {
    const tiles = [
      ['Total Revenue', _pm(totRev), 'accent'],
      ['Cost of Goods Sold', _pm(totCOGS), ''],
      ['Gross Profit', _pm(totGP), totGP >= 0 ? 'pos' : 'neg'],
      ['Gross Margin', margin, ''],
      ['Total Expenses', _pm(totExp), ''],
      ['Net Income', _pm(totNet), totNet >= 0 ? 'pos' : 'neg'],
    ];
    totals.innerHTML = tiles.map(([l, v, cls]) =>
      `<div class="pnl-tile ${cls}"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  }

  const body = document.getElementById('pnlBody');
  if (!body) return;
  if (!months.length) {
    body.innerHTML = '<div class="pnl-empty">No data for this period.</div>';
    return;
  }

  const par = v => '(' + _pm(v) + ')';
  const gpColor = v => v >= 0 ? '#16a34a' : '#ef4444';

  const rowsHtml = months.map((m, i) => {
    const gpPct = m.revenue > 0 ? (m.grossProfit / m.revenue * 100).toFixed(1) + '%' : '—';
    const netPct = m.revenue > 0 ? (m.net / m.revenue * 100).toFixed(1) + '%' : '—';
    const summary = `<tr class="pnl-mrow" onclick="pnlToggleMonth(${i})">
      <td><span class="pnl-mname">${_pe(_pnlFmtMonth(m.ym))}</span>${m.soCount ? `<span class="pnl-sub">${m.soCount} SO${m.soCount !== 1 ? 's' : ''}</span>` : ''}</td>
      <td class="num">${m.revenue ? _pm(m.revenue) : '<span class="pnl-muted">—</span>'}</td>
      <td class="num" style="color:#ef4444;">${m.cogs ? par(m.cogs) : '<span class="pnl-muted">—</span>'}</td>
      <td class="num" style="color:${gpColor(m.grossProfit)};font-weight:600;">${_pm(m.grossProfit)}<span class="pnl-sub">${gpPct}</span></td>
      <td class="num" style="color:#f97316;">${m.expTotal ? par(m.expTotal) : '<span class="pnl-muted">—</span>'}</td>
      <td class="num" style="color:${gpColor(m.net)};font-weight:700;">${_pm(m.net)}<span class="pnl-sub">${netPct}</span></td>
      <td class="num"><button type="button" class="pnl-expand" id="pnlBtn${i}" aria-label="Expand">▸</button></td>
    </tr>`;
    const detail = `<tr id="pnlDetail${i}" class="pnl-detailrow" style="display:none;"><td colspan="7">${pnlDetailHtml(m)}</td></tr>`;
    return summary + detail;
  }).join('');

  const grand = `<tr class="pnl-grand">
    <td>All Periods</td>
    <td class="num">${_pm(totRev)}</td>
    <td class="num" style="color:#ef4444;">${par(totCOGS)}</td>
    <td class="num" style="color:${gpColor(totGP)};">${_pm(totGP)}</td>
    <td class="num" style="color:#f97316;">${par(totExp)}</td>
    <td class="num" style="color:${gpColor(totNet)};font-weight:800;">${_pm(totNet)}</td>
    <td></td>
  </tr>`;

  body.innerHTML = `<div style="overflow-x:auto;">
    <table class="pnl-mtable">
      <thead><tr>
        <th>Month</th><th class="num">Revenue</th><th class="num">COGS</th>
        <th class="num">Gross Profit</th><th class="num">Expenses</th><th class="num">Net Profit</th><th></th>
      </tr></thead>
      <tbody>${rowsHtml}${grand}</tbody>
    </table></div>
    <p class="pnl-note">Includes <strong>all sales orders</strong> dated in the period (new and migrated);
    revenue &amp; COGS come from linked invoices, and an order with no invoice yet recognizes revenue at its
    order total. Expenses (including migrated) are summed by category. Click a month to see its sales orders
    and expense breakdown. Net Profit = Gross Profit − Expenses.</p>`;
}

function pnlDetailHtml(m) {
  const par = v => '(' + _pm(v) + ')';
  const gpColor = v => v >= 0 ? '#16a34a' : '#ef4444';

  // Sales orders
  let so = `<div class="pnl-detail-h">${_pe(_pnlFmtMonth(m.ym))} — Sales Orders</div>
    <div style="overflow-x:auto;"><table class="pnl-subtable">
    <thead><tr><th>Sales Order</th><th>Client</th><th class="num">Revenue</th><th class="num">COGS</th><th class="num">Gross Profit</th></tr></thead><tbody>`;
  if (m.entries.length) {
    so += m.entries.slice().sort((a, b) => (_pymd(a.date) || '').localeCompare(_pymd(b.date) || '')).map(e =>
      `<tr><td><strong>${_pe(e.soNo || '—')}</strong>${e.date ? `<span class="pnl-sub2">${_pymd(e.date)}</span>` : ''}</td>
        <td>${_pe(e.customer || '—')}</td>
        <td class="num">${_pm(e.sales)}</td>
        <td class="num" style="color:#ef4444;">${e.cogs ? par(e.cogs) : '—'}</td>
        <td class="num" style="color:${gpColor(e.gp)};font-weight:600;">${_pm(e.gp)}</td></tr>`).join('');
    so += `<tr class="pnl-subtotal"><td colspan="2">Total (${m.soCount} SO${m.soCount !== 1 ? 's' : ''})</td>
      <td class="num">${_pm(m.revenue)}</td><td class="num" style="color:#ef4444;">${par(m.cogs)}</td>
      <td class="num" style="color:${gpColor(m.grossProfit)};">${_pm(m.grossProfit)}</td></tr>`;
  } else {
    so += `<tr><td colspan="5" class="pnl-muted" style="text-align:center;padding:0.6rem;">No sales orders this month.</td></tr>`;
  }
  so += `</tbody></table></div>`;

  // Expenses by category
  let ex = `<div class="pnl-detail-h">Expense Categories</div>
    <div style="overflow-x:auto;"><table class="pnl-subtable">
    <thead><tr><th>Category</th><th class="num">Amount</th></tr></thead><tbody>`;
  const cats = Object.keys(m.expByCat).sort();
  if (cats.length) {
    ex += cats.map(c => `<tr><td>${_pe(c)}</td><td class="num" style="color:#f97316;">${par(m.expByCat[c])}</td></tr>`).join('');
    ex += `<tr class="pnl-subtotal"><td>Total Expenses</td><td class="num" style="color:#f97316;">${par(m.expTotal)}</td></tr>`;
  } else {
    ex += `<tr><td colspan="2" class="pnl-muted" style="text-align:center;padding:0.6rem;">No expenses this month.</td></tr>`;
  }
  ex += `</tbody></table></div>`;

  const netPct = m.revenue > 0 ? (m.net / m.revenue * 100).toFixed(1) + '% of revenue' : '—';
  const net = `<div class="pnl-netfoot ${m.net >= 0 ? 'pos' : 'neg'}">
    <div><div class="l">Net Profit</div><div class="s">Gross Profit ${_pm(m.grossProfit)} − Expenses ${_pm(m.expTotal)}</div></div>
    <div style="text-align:right;"><div class="v" style="color:${gpColor(m.net)};">${_pm(m.net)}</div><div class="s">${netPct}</div></div>
  </div>`;

  return `<div class="pnl-detail">${so}${ex}${net}</div>`;
}

function pnlToggleMonth(i) {
  const row = document.getElementById('pnlDetail' + i);
  const btn = document.getElementById('pnlBtn' + i);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : '';
  if (btn) btn.textContent = open ? '▸' : '▾';
}
