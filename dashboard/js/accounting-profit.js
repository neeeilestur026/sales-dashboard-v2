/* ═══════════════════════════════════════════════
   accounting-profit.js — Monthly Profit & Loss breakdown on the Accounting home.
   Rows = each month of the selected year (Revenue · COGS · Gross Profit +margin ·
   Expenses · Net Profit +margin), expandable to a per-Sales-Order breakdown +
   expense-category breakdown + net footer, with a year grand-total row.
   Pure client-side over getInvoices / getSalesOrders / getExpenses — includes all
   sales orders (incl. migrated) and all expenses (incl. migrated). No backend change.
   ═══════════════════════════════════════════════ */

let pnlData = { invs: [], sos: [], exps: [], pos: [], recs: [] };
let pnlMonthsCache = [];   // rendered month models (for expand toggling)
let pnlEntryReg = {};      // entryId -> entry (for the cost editor)
let pnlEntrySeq = 0;

function _pnlRole() { try { return (JSON.parse(localStorage.getItem('session') || '{}').role || '').toLowerCase(); } catch (e) { return ''; } }
const pnlCanEditCost = (_pnlRole() === 'accounting' || _pnlRole() === 'admin');

/** Per-SO COGS component breakdown from the SO's receiving chain (joined via POs). */
function _pnlComps(soNo) {
  const poNos = new Set(pnlData.pos.filter(p => String(p.soNo) === String(soNo)).map(p => String(p.poNo)));
  const out = { purchaseOfGoods: 0, duties: 0, delivery: 0, other: 0 };
  pnlData.recs.forEach(r => {
    if (!poNos.has(String(r.poNo))) return;
    out.duties += _pn(r.duties); out.delivery += _pn(r.delivery); out.other += _pn(r.other);
    (r.items || []).forEach(it => { out.purchaseOfGoods += _pn(it.purchasePHP) * _pn(it.qty); });
  });
  return out;
}

/** Open the shared cost editor for a P&L entry, then reload on save. */
function pnlEditCost(id) {
  const e = pnlEntryReg[id];
  if (!e || typeof openSoCostEditor !== 'function') return;
  const cd = e.cd, c = e.comps || {};
  const prefill = cd ? {
    soNo: e.soNo, customer: e.customer, date: e.date, sales: cd.sales, cogsType: cd.cogsType || 'local',
    shippingCompany: cd.shippingCompany || '', purchaseOfGoods: cd.purchaseOfGoods, bankChargeCOGS: cd.bankChargeCOGS,
    dutiesAndTaxes: cd.dutiesAndTaxes, bankChargeShipping: cd.bankChargeShipping, shippingCost: cd.shippingCost,
    localCharges: cd.localCharges, deliveryToOffice: cd.deliveryToOffice, deliveryToClient: cd.deliveryToClient,
  } : {
    soNo: e.soNo, customer: e.customer, date: e.date, sales: e.sales,
    cogsType: (c.duties || c.other) ? 'international' : 'local', shippingCompany: '',
    purchaseOfGoods: c.purchaseOfGoods || 0, dutiesAndTaxes: c.duties || 0,
    deliveryToOffice: c.delivery || 0, localCharges: c.other || 0,
    bankChargeCOGS: 0, bankChargeShipping: 0, shippingCost: 0, deliveryToClient: 0,
  };
  openSoCostEditor(prefill, () => pnlLoad());
}

function _pe(s) { return flowEsc(s); }
function _pm(v) { return flowMoney(v, 'PHP'); }
function _pn(v) { return flowNum(v); }
function _pymd(d) { return flowDate(d); }                 // YYYY-MM-DD or ''
function _pyr(d) { const s = _pymd(d); return s ? s.slice(0, 4) : ''; }

const _PNL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' from any date the flow stores (ISO, 'Wed Mar 26 2026', etc.). */
function _pnlYM(dateStr) {
  // Manila-safe (see management-income _miYM): raw UTC prefixes mis-bucket midnight-boundary dates.
  const s = flowDate(dateStr);
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
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
    const [invs, sos, exps, cds, pos, recs] = await Promise.all([
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getExpenses').catch(() => ({ data: [] })),
      fetchFlow('getSOCostDetails').catch(() => ({ data: [] })),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getReceiving').catch(() => ({ data: [] })),
    ]);
    pnlData = {
      invs: (invs && invs.data) || [],
      sos: (sos && sos.data) || [],
      exps: (exps && exps.data) || [],
      costDetails: (cds && cds.data) || [],
      pos: (pos && pos.data) || [],
      recs: (recs && recs.data) || [],
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

  // Migrated per-SO cost breakdown (old profit report) — used only when no new-flow invoice exists.
  const costBySo = {};
  (pnlData.costDetails || []).forEach(c => { costBySo[String(c.soNo)] = c; });

  const inYear = ym => !year || ym.slice(0, 4) === year;
  const byMonth = {};   // ym -> { revenue, cogs, grossProfit, soCount, entries[], expTotal, expByCat{} }
  const month = ym => (byMonth[ym] = byMonth[ym] || { revenue: 0, cogs: 0, grossProfit: 0, soCount: 0, entries: [], expTotal: 0, expByCat: {} });

  // Sales-order-driven revenue (incl. migrated SOs): invoiced → invoice totals; else migrated cost detail; else SO order total.
  pnlData.sos.forEach(s => {
    const ym = _pnlYM(s.date);
    if (!ym || !inYear(ym)) return;
    const inv = invBySo[String(s.soNo)];
    const cd = costBySo[String(s.soNo)];
    const edited = cd && String(cd.source) === 'Manual (edited)';
    let sales, cogs, comps = null, costNotSet = false;
    // SOCostDetails (migrated or edited) is authoritative — equals the migrated invoice, no double count.
    if (cd) { sales = _pn(cd.sales); cogs = _pn(cd.totalCOGS); }
    else if (inv) { sales = inv.sales; cogs = inv.cogs; comps = _pnlComps(s.soNo); }
    else { sales = _pn(s.total); cogs = 0; comps = _pnlComps(s.soNo); costNotSet = true; }
    const m = month(ym);
    m.revenue += sales; m.cogs += cogs; m.grossProfit += (sales - cogs); m.soCount++;
    m.entries.push({ soNo: s.soNo || '', date: s.date || '', customer: s.customer || '', sales, cogs, gp: sales - cogs,
      cd: cd || null, comps, costNotSet, edited });
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
  pnlEntryReg = {};     // rebuilt as detail rows render

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
  const editCol = pnlCanEditCost ? '<th></th>' : '';
  let so = `<div class="pnl-detail-h">${_pe(_pnlFmtMonth(m.ym))} — Sales Orders</div>
    <div style="overflow-x:auto;"><table class="pnl-subtable">
    <thead><tr><th>Sales Order</th><th>Client</th><th class="num">Revenue</th><th class="num">COGS</th><th class="num">Gross Profit</th>${editCol}</tr></thead><tbody>`;
  if (m.entries.length) {
    so += m.entries.slice().sort((a, b) => (_pymd(a.date) || '').localeCompare(_pymd(b.date) || '')).map(e => {
      const id = 'pe' + (pnlEntrySeq++);
      pnlEntryReg[id] = e;
      const chip = e.costNotSet ? ' <span class="pnl-warn" title="No cost recorded yet">⚠ cost not set</span>'
        : (e.edited ? ' <span class="pnl-edited" title="Cost edited by accounting">edited</span>' : '');
      const editCell = pnlCanEditCost ? `<td class="num"><button type="button" class="pnl-editcost" onclick="pnlEditCost('${id}')">✎ Edit</button></td>` : '';
      return `<tr><td><strong>${_pe(e.soNo || '—')}</strong>${chip}${e.date ? `<span class="pnl-sub2">${_pymd(e.date)}</span>` : ''}</td>
        <td>${_pe(e.customer || '—')}</td>
        <td class="num">${_pm(e.sales)}</td>
        <td class="num" style="color:#ef4444;">${e.cogs ? par(e.cogs) : '—'}</td>
        <td class="num" style="color:${gpColor(e.gp)};font-weight:600;">${_pm(e.gp)}</td>${editCell}</tr>`;
    }).join('');
    so += `<tr class="pnl-subtotal"><td colspan="2">Total (${m.soCount} SO${m.soCount !== 1 ? 's' : ''})</td>
      <td class="num">${_pm(m.revenue)}</td><td class="num" style="color:#ef4444;">${par(m.cogs)}</td>
      <td class="num" style="color:${gpColor(m.grossProfit)};">${_pm(m.grossProfit)}</td>${pnlCanEditCost ? '<td></td>' : ''}</tr>`;
  } else {
    so += `<tr><td colspan="${pnlCanEditCost ? 6 : 5}" class="pnl-muted" style="text-align:center;padding:0.6rem;">No sales orders this month.</td></tr>`;
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
