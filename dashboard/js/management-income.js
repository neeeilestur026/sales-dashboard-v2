/* ═══════════════════════════════════════════════
   management-income.js — Income Statement for the management dashboard.
   Flow-native (getInvoices / getSalesOrders / getPurchaseOrders / getReceiving /
   getExpenses). Year selector + Monthly|Yearly toggle. Three levels:
     1. Period P&L summary (Revenue · COGS · Gross Profit · OpEx · Net Profit)
     2. Monthly rows → expand to that month's Sales Orders (rev/COGS/GP/exp/net)
     3. Per-SO → COGS component breakdown (Purchase of Goods · Duties · Delivery · Other)
   Mirrors the old income statement, on the new flow. No backend change.
   ═══════════════════════════════════════════════ */

let miData = { invs: [], sos: [], pos: [], recs: [], exps: [] };
let miMode = 'monthly';          // 'monthly' | 'yearly'
let miModels = [];               // current per-SO models (for drilldown)
let miMonthsCache = [];

function _ie(s) { return flowEsc(s); }
function _im(v) { return flowMoney(v, 'PHP'); }
function _in(v) { return flowNum(v); }
function _id(d) { return flowDate(d); }
const _IMN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function _miYM(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  return '';
}
function _miFmtMonth(ym) {
  const p = ym.split('-');
  return p.length === 2 ? (_IMN[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0] : ym;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('isBody')) return;       // section not on page
  const yEl = document.getElementById('isYear');
  if (yEl) yEl.addEventListener('change', miRender);
  document.querySelectorAll('[data-is-mode]').forEach(b => b.addEventListener('click', () => {
    miMode = b.getAttribute('data-is-mode');
    document.querySelectorAll('[data-is-mode]').forEach(x => x.classList.toggle('active', x === b));
    miRender();
  }));
  miLoad();
});

async function miLoad() {
  const body = document.getElementById('isBody');
  const state = document.getElementById('isState');
  if (typeof _flowConfigured === 'function' && !_flowConfigured()) {
    if (state) state.textContent = 'Flow backend not configured';
    if (body) body.innerHTML = '<div class="is-empty">Process Flow backend is not configured.</div>';
    return;
  }
  if (state) state.textContent = 'Loading…';
  try {
    const [invs, sos, pos, recs, exps, cds] = await Promise.all([
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),
      fetchFlow('getReceiving').catch(() => ({ data: [] })),
      fetchFlow('getExpenses').catch(() => ({ data: [] })),
      fetchFlow('getSOCostDetails').catch(() => ({ data: [] })),
    ]);
    miData = {
      invs: (invs && invs.data) || [], sos: (sos && sos.data) || [], pos: (pos && pos.data) || [],
      recs: (recs && recs.data) || [], exps: (exps && exps.data) || [],
      costDetails: (cds && cds.data) || [],
    };
    miBuildYears();
    miRender();
  } catch (e) {
    if (state) state.textContent = 'Unavailable';
    if (body) body.innerHTML = `<div class="is-empty" style="color:#ef4444;">${_ie(e.message)}</div>`;
  }
}

function miBuildYears() {
  const sel = document.getElementById('isYear');
  if (!sel) return;
  const years = new Set();
  [...miData.invs, ...miData.sos].forEach(r => { const y = (_id(r.date) || '').slice(0, 4); if (y) years.add(y); });
  years.add(String(new Date().getFullYear()));
  const cur = sel.value || String(new Date().getFullYear());
  sel.innerHTML = Array.from(years).sort((a, b) => b.localeCompare(a)).map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('');
}

/** Per-SO COGS component breakdown from the SO's receiving chain (joined via POs). */
function _miCogsComponents(soNo) {
  const poNos = new Set(miData.pos.filter(p => String(p.soNo) === String(soNo)).map(p => String(p.poNo)));
  const out = { purchaseOfGoods: 0, duties: 0, delivery: 0, other: 0, vat: 0 };
  miData.recs.forEach(r => {
    if (!poNos.has(String(r.poNo))) return;
    out.duties += _in(r.duties); out.delivery += _in(r.delivery); out.other += _in(r.other); out.vat += _in(r.vat);
    (r.items || []).forEach(it => { out.purchaseOfGoods += _in(it.purchasePHP) * _in(it.qty); });
  });
  return out;
}

/** Build per-SO models for the selected year. */
function miBuild(year) {
  const invBySo = {};
  const allSo = new Set(miData.sos.map(s => String(s.soNo)));
  miData.invs.forEach(v => {
    const k = v.soNo ? String(v.soNo) : '';
    if (!k) return;
    if (!invBySo[k]) invBySo[k] = { sales: 0, cogs: 0 };
    invBySo[k].sales += _in(v.totalSales); invBySo[k].cogs += _in(v.totalCOGS);
  });
  const inYear = ym => !year || ym.slice(0, 4) === year;
  // Migrated per-SO cost breakdown (old profit report). Used only when an SO has NO new-flow invoice.
  const costBySo = {};
  (miData.costDetails || []).forEach(c => { costBySo[String(c.soNo)] = c; });

  const models = [];
  miData.sos.forEach(s => {
    const ym = _miYM(s.date);
    if (!ym || !inYear(ym)) return;
    const inv = invBySo[String(s.soNo)];
    const cd = costBySo[String(s.soNo)];
    let sales, cogs, comps = null, migrated = false;
    if (inv) {                                   // new-flow data present → takes precedence
      sales = inv.sales; cogs = inv.cogs; comps = _miCogsComponents(s.soNo);
    } else if (cd) {                             // migrated old profit-report breakdown
      sales = _in(cd.sales); cogs = _in(cd.totalCOGS); migrated = true;
    } else {                                     // no costs known yet
      sales = _in(s.total); cogs = 0; comps = _miCogsComponents(s.soNo);
    }
    models.push({ soNo: s.soNo || '', customer: s.customer || '', date: s.date || '', ym,
      sales, cogs, gp: sales - cogs, comps, migrated, cd: cd || null });
  });
  // orphan invoices (no SO record) bucket by invoice month
  miData.invs.forEach(v => {
    const k = v.soNo ? String(v.soNo) : '';
    if (k && allSo.has(k)) return;
    const ym = _miYM(v.date);
    if (!ym || !inYear(ym)) return;
    const sales = _in(v.totalSales), cogs = _in(v.totalCOGS);
    models.push({ soNo: v.soNo || '(no SO)', customer: v.customer || '', date: v.date || '', ym,
      sales, cogs, gp: sales - cogs, comps: { purchaseOfGoods: cogs, duties: 0, delivery: 0, other: 0, vat: 0 } });
  });

  // expenses by month (single OpEx umbrella)
  const expByMonth = {};
  miData.exps.forEach(e => {
    const ym = _miYM(e.date);
    if (!ym || !inYear(ym)) return;
    expByMonth[ym] = (expByMonth[ym] || 0) + _in(e.amount);
  });
  return { models, expByMonth };
}

function miRender() {
  const state = document.getElementById('isState');
  const year = document.getElementById('isYear') ? document.getElementById('isYear').value : String(new Date().getFullYear());
  if (state) state.textContent = `${year} · ${miMode === 'monthly' ? 'Monthly' : 'Yearly'} · live from Process Flow`;

  const { models, expByMonth } = miBuild(year);
  miModels = models;

  const totRev = models.reduce((s, m) => s + m.sales, 0);
  const totCOGS = models.reduce((s, m) => s + m.cogs, 0);
  const totGP = totRev - totCOGS;
  const totExp = Object.values(expByMonth).reduce((s, v) => s + v, 0);
  const totNet = totGP - totExp;
  const margin = totRev > 0 ? (totGP / totRev * 100).toFixed(1) + '%' : '—';

  const tEl = document.getElementById('isTotals');
  if (tEl) {
    const tiles = [
      ['Revenue', _im(totRev), 'accent'], ['Cost of Goods Sold', _im(totCOGS), ''],
      ['Gross Profit', _im(totGP), totGP >= 0 ? 'pos' : 'neg'], ['Gross Margin', margin, ''],
      ['Operating Expenses', _im(totExp), ''], ['Net Profit', _im(totNet), totNet >= 0 ? 'pos' : 'neg'],
    ];
    tEl.innerHTML = tiles.map(([l, v, c]) => `<div class="is-tile ${c}"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  }

  const body = document.getElementById('isBody');
  if (!body) return;
  if (!models.length) { body.innerHTML = '<div class="is-empty">No sales orders in this period.</div>'; return; }

  body.innerHTML = miMode === 'monthly' ? miRenderMonthly(models, expByMonth) : miRenderYearly(models, totExp, totRev);
}

const _miPar = v => '(' + _im(v) + ')';
const _miCol = v => v >= 0 ? '#16a34a' : '#ef4444';

function miRenderMonthly(models, expByMonth) {
  // group models by month
  const byMonth = {};
  models.forEach(m => { (byMonth[m.ym] = byMonth[m.ym] || []).push(m); });
  const months = Object.keys(byMonth).sort().reverse();
  miMonthsCache = months;

  let gRev = 0, gCOGS = 0, gExp = 0;
  const rows = months.map((ym, i) => {
    const list = byMonth[ym];
    const rev = list.reduce((s, m) => s + m.sales, 0);
    const cogs = list.reduce((s, m) => s + m.cogs, 0);
    const gp = rev - cogs;
    const exp = expByMonth[ym] || 0;
    const net = gp - exp;
    gRev += rev; gCOGS += cogs; gExp += exp;
    const gpPct = rev > 0 ? (gp / rev * 100).toFixed(1) + '%' : '—';
    const netPct = rev > 0 ? (net / rev * 100).toFixed(1) + '%' : '—';
    const sumRow = `<tr class="is-mrow" onclick="miToggleMonth(${i})">
      <td><span class="is-mname">${_ie(_miFmtMonth(ym))}</span><span class="is-sub">${list.length} SO${list.length !== 1 ? 's' : ''}</span></td>
      <td class="num">${rev ? _im(rev) : '—'}</td>
      <td class="num" style="color:#ef4444;">${cogs ? _miPar(cogs) : '—'}</td>
      <td class="num" style="color:${_miCol(gp)};font-weight:600;">${_im(gp)}<span class="is-sub">${gpPct}</span></td>
      <td class="num" style="color:#f97316;">${exp ? _miPar(exp) : '—'}</td>
      <td class="num" style="color:${_miCol(net)};font-weight:700;">${_im(net)}<span class="is-sub">${netPct}</span></td>
      <td class="num"><button type="button" class="is-exp" id="isMBtn${i}">▸</button></td>
    </tr>`;
    const detail = `<tr id="isMDetail${i}" class="is-detailrow" style="display:none;"><td colspan="7">${miSoTable(list, exp, rev, 'm' + i)}</td></tr>`;
    return sumRow + detail;
  }).join('');

  const gGP = gRev - gCOGS, gNet = gGP - gExp;
  const grand = `<tr class="is-grand"><td>All Periods</td><td class="num">${_im(gRev)}</td>
    <td class="num" style="color:#ef4444;">${_miPar(gCOGS)}</td><td class="num" style="color:${_miCol(gGP)};">${_im(gGP)}</td>
    <td class="num" style="color:#f97316;">${_miPar(gExp)}</td><td class="num" style="color:${_miCol(gNet)};font-weight:800;">${_im(gNet)}</td><td></td></tr>`;

  return `<div style="overflow-x:auto;"><table class="is-table">
    <thead><tr><th>Month</th><th class="num">Revenue</th><th class="num">COGS</th><th class="num">Gross Profit</th><th class="num">Expenses</th><th class="num">Net Profit</th><th></th></tr></thead>
    <tbody>${rows}${grand}</tbody></table></div>
    <p class="is-note">Click a month to see its sales orders; click a sales order to see its revenue & COGS component breakdown (Purchase of Goods · Duties &amp; Taxes · Delivery · Other). Expenses are allocated to each sales order by its revenue share.</p>`;
}

function miRenderYearly(models, totExp, totRev) {
  return `<div style="overflow-x:auto;">${miSoTable(models, totExp, totRev, 'y')}</div>
    <p class="is-note">Each sales order for the year. Click one to see its revenue & COGS component breakdown. Expenses are allocated by revenue share.</p>`;
}

/** Per-SO table (used by both monthly-expand and yearly). `tag` namespaces row ids. */
function miSoTable(list, periodExp, periodRev, tag) {
  const rows = list.slice().sort((a, b) => (_id(b.date) || '').localeCompare(_id(a.date) || '')).map((m, j) => {
    const alloc = periodRev > 0 ? periodExp * (m.sales / periodRev) : 0;
    const net = m.gp - alloc;
    const rid = tag + '_' + j;
    const idx = miModels.indexOf(m);
    const sumRow = `<tr class="is-sorow" onclick="miToggleSo('${rid}')">
      <td><strong>${_ie(m.soNo)}</strong>${m.date ? `<span class="is-sub2">${_ie(_id(m.date))}</span>` : ''}</td>
      <td>${_ie(m.customer) || '—'}</td>
      <td class="num">${_im(m.sales)}</td>
      <td class="num" style="color:#ef4444;">${m.cogs ? _miPar(m.cogs) : '—'}</td>
      <td class="num" style="color:${_miCol(m.gp)};font-weight:600;">${_im(m.gp)}</td>
      <td class="num" style="color:#f97316;">${alloc ? _miPar(alloc) : '—'}</td>
      <td class="num" style="color:${_miCol(net)};font-weight:700;">${_im(net)}</td>
      <td class="num"><button type="button" class="is-exp" id="isSBtn_${rid}">▸</button></td>
    </tr>`;
    const detail = `<tr id="isSDetail_${rid}" class="is-detailrow" style="display:none;"><td colspan="8">${miSoBreakdown(m, alloc, net)}</td></tr>`;
    return sumRow + detail;
  }).join('');
  const tRev = list.reduce((s, m) => s + m.sales, 0), tCogs = list.reduce((s, m) => s + m.cogs, 0);
  const foot = `<tr class="is-subtotal"><td colspan="2">Total (${list.length} SO${list.length !== 1 ? 's' : ''})</td>
    <td class="num">${_im(tRev)}</td><td class="num" style="color:#ef4444;">${_miPar(tCogs)}</td>
    <td class="num" style="color:${_miCol(tRev - tCogs)};">${_im(tRev - tCogs)}</td>
    <td class="num" style="color:#f97316;">${_miPar(periodExp)}</td>
    <td class="num" style="color:${_miCol(tRev - tCogs - periodExp)};">${_im(tRev - tCogs - periodExp)}</td><td></td></tr>`;
  return `<table class="is-subtable"><thead><tr><th>Sales Order</th><th>Client</th><th class="num">Revenue</th><th class="num">COGS</th><th class="num">Gross Profit</th><th class="num">Expenses</th><th class="num">Net Profit</th><th></th></tr></thead><tbody>${rows}${foot}</tbody></table>`;
}

/** Level 3: revenue + COGS component breakdown for one SO. */
function miSoBreakdown(m, alloc, net) {
  const line = (label, val, neg, bold) => `<tr${bold ? ' class="b"' : ''}><td>${label}</td><td class="num"${neg ? ' style="color:#ef4444;"' : ''}>${neg ? _miPar(val) : _im(val)}</td></tr>`;
  let cogsRows, note;
  if (m.migrated && m.cd) {
    // Migrated from the old Profit Report — show the exact recorded cost lines.
    const cd = m.cd, intl = String(cd.cogsType) === 'international';
    cogsRows = line('Purchase of Goods', cd.purchaseOfGoods, true)
      + (intl ? line('Bank Charge (COGS)', cd.bankChargeCOGS, true) : '')
      + (intl ? line('Duties &amp; Taxes', cd.dutiesAndTaxes, true) : '')
      + (intl ? line('Bank Charge (Shipping)', cd.bankChargeShipping, true) : '')
      + (intl ? line('Shipping Cost' + (cd.shippingCompany ? ' (' + _ie(cd.shippingCompany) + ')' : ''), cd.shippingCost, true) : '')
      + (intl ? line('Local Charges', cd.localCharges, true) : '')
      + line('Delivery to Office', cd.deliveryToOffice, true)
      + line('Delivery to Client', cd.deliveryToClient, true);
    note = 'Cost breakdown migrated from the old Profit Report (' + _ie(cd.cogsType || 'local') + ').';
  } else {
    const c = m.comps || { purchaseOfGoods: 0, duties: 0, delivery: 0, other: 0, vat: 0 };
    const procurement = c.purchaseOfGoods + c.duties + c.delivery + c.other;
    cogsRows = line('Purchase of Goods', c.purchaseOfGoods, true)
      + line('Duties &amp; Taxes', c.duties, true)
      + line('Delivery to Office', c.delivery, true)
      + line('Other Charges', c.other, true)
      + `<tr class="sub"><td>Procurement landed cost</td><td class="num" style="color:#ef4444;">${_miPar(procurement)}</td></tr>`;
    note = `COGS components come from the order's Materials Receiving (Input VAT ${_im(c.vat)} is a recoverable asset, excluded from COGS). Total COGS is the landed cost actually issued on the invoice.`;
  }
  return `<div class="is-bd">
    <div class="is-bd-h">${_ie(m.soNo)} — Income breakdown${m.migrated ? ' · <span style="color:#0f766e;">migrated</span>' : ''}</div>
    <table class="is-bd-table"><tbody>
      <tr class="sect"><td colspan="2">Revenue</td></tr>
      ${line('Sales', m.sales)}
      <tr class="sect"><td colspan="2">Cost of Goods Sold</td></tr>
      ${cogsRows}
      ${line('Total COGS', m.cogs, true, true)}
      <tr class="tot"><td>Gross Profit</td><td class="num" style="color:${_miCol(m.gp)};">${_im(m.gp)}</td></tr>
      ${line('Less: Operating Expenses (allocated)', alloc, true)}
      <tr class="tot"><td>Net Profit</td><td class="num" style="color:${_miCol(net)};">${_im(net)}</td></tr>
    </tbody></table>
    <p class="is-note" style="margin:0.5rem 0 0;">${note}</p>
  </div>`;
}

function miToggleMonth(i) {
  const row = document.getElementById('isMDetail' + i), btn = document.getElementById('isMBtn' + i);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : '';
  if (btn) btn.textContent = open ? '▸' : '▾';
}
function miToggleSo(rid) {
  const row = document.getElementById('isSDetail_' + rid), btn = document.getElementById('isSBtn_' + rid);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : '';
  if (btn) btn.textContent = open ? '▸' : '▾';
}
