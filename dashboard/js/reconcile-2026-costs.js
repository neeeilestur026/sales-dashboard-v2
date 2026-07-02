/* reconcile-2026-costs.js — import the actual 2026 purchase costs (Summary of Purchase sheet)
   into each 2026 sales order's cost detail via saveSOCostDetails (which regenerates the SO's
   migrated invoice/receiving, so the income statement & summaries reflect real COGS).
   Revenue is always kept from the system — the sheet has no selling prices. */

let rcSession = null;
let rcOrders = [];      // sheet purchase orders: {poId, client, norm, vendor, goods, ship, duties, deliv, intl, status, lines, soNo}
let rcStock = [];       // Warehouse rows (inventory, never written to an SO)
let rcSos = [];         // 2026 sales orders (with current sales/cogs resolved)
let rcSelected = new Set();

document.addEventListener('DOMContentLoaded', () => {
  rcSession = requireAccountingOrAdmin();
  if (!rcSession) return;
  renderNavbar('reconcile-2026-costs');
  document.getElementById('loadBtn').addEventListener('click', loadAll);
  document.getElementById('selAllBtn').addEventListener('click', () => {
    rcOrders.forEach((o, i) => { if (o.soNo) rcSelected.add(i); });
    render();
  });
  document.getElementById('applySelBtn').addEventListener('click', () => apply([...rcSelected]));
  document.getElementById('applyAllBtn').addEventListener('click', () => apply(rcOrders.map((o, i) => o.soNo ? i : -1).filter(i => i >= 0)));
});

function _msg(t, ok) { const el = document.getElementById('msg'); el.textContent = t; el.style.color = ok ? '#15803d' : '#dc2626'; }
function _n(x) { const v = parseFloat(String(x == null ? '' : x).replace(/,/g, '')); return isFinite(v) ? v : 0; }
function _norm(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(incorporated|corporation|corp|inc|company|co|ltd|opc|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function _yr(d) { const m = /20\d\d/.exec(String(d || '')); return m ? m[0] : ''; }

// ── CSV parser (quoted cells, embedded newlines) ──────────────────────────────
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

// ── Load: sheet (via Flask proxy) + flow data, group + auto-match ─────────────
async function loadAll() {
  const id = (document.getElementById('sheetId').value || '').trim();
  const c = document.getElementById('container');
  c.innerHTML = '<div class="dr-empty">Loading sheet + flow data…</div>';
  _msg('', true);
  try {
    const [csvResp, soRes, cdRes, invRes] = await Promise.all([
      fetch('/flow/sheet-csv?id=' + encodeURIComponent(id) + '&gid=0'),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getSOCostDetails').catch(() => ({ data: [] })),
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
    ]);
    if (!csvResp.ok) { const j = await csvResp.json().catch(() => ({})); throw new Error(j.message || 'Sheet fetch failed.'); }
    const rows = parseCsv(await csvResp.text());
    buildOrders(rows);
    buildSos((soRes && soRes.data) || [], (cdRes && cdRes.data) || [], (invRes && invRes.data) || []);
    autoMatch();
    rcSelected = new Set();
    render();
  } catch (e) { c.innerHTML = `<div class="dr-empty" style="color:#dc2626;">${flowEsc(e.message)}</div>`; }
}

// Sheet columns: 0 Client, 2 PO NUMBER, 3 Vendor, 10 Peso Amount, 13 Air/Sea,
// 17 Shipment Cost, 18 Import Duties, 19 Logistics, 21 Delivery Expenses, 24 Status.
function buildOrders(rows) {
  const groups = {};
  rcStock = [];
  rows.slice(1).forEach(r => {
    const g = k => (k < r.length ? String(r[k] || '').trim() : '');
    const m = /^\s*(2026-\d+)/.exec(g(2));
    if (!m) return;
    const client = g(0).replace(/\s+/g, ' ').trim();
    const isWh = client.toLowerCase().startsWith('warehouse');
    const key = (isWh ? 'WH|' : '') + m[1];
    const o = groups[key] = groups[key] || {
      poId: m[1], client: '', vendor: g(3), goods: 0, ship: 0, duties: 0, deliv: 0,
      intl: false, status: '', lines: 0, logistics: '', soNo: '', wh: isWh,
    };
    if (client && !o.client) o.client = client;
    o.goods += _n(g(10)); o.ship += _n(g(17)); o.duties += _n(g(18)); o.deliv += _n(g(21));
    if (/INTERNATIONAL/i.test(g(13))) o.intl = true;
    if (g(19) && !/^n\/?a$/i.test(g(19))) o.logistics = g(19);
    if (g(24)) o.status = g(24);
    o.lines++;
  });
  const all = Object.values(groups);
  all.forEach(o => { if (o.ship > 0 || o.duties > 0) o.intl = true; o.norm = _norm(o.client); });
  rcStock = all.filter(o => o.wh);
  rcOrders = all.filter(o => !o.wh).sort((a, b) => a.poId.localeCompare(b.poId, undefined, { numeric: true }));
}

// 2026 SOs with their current (system) sales + COGS resolved.
function buildSos(sos, cds, invs) {
  const cdBySo = {}; cds.forEach(cd => { cdBySo[String(cd.soNo)] = cd; });
  const invBySo = {}; invs.forEach(v => { const k = String(v.soNo || ''); if (!k) return; invBySo[k] = (invBySo[k] || 0) + _n(v.totalSales); });
  rcSos = sos.filter(s => _yr(s.date) === '2026').map(s => {
    const k = String(s.soNo), cd = cdBySo[k];
    return {
      soNo: k, customer: String(s.customer || '').trim(), norm: _norm(s.customer), date: s.date,
      cogs: cd ? _n(cd.totalCOGS) : 0,
      sales: cd && _n(cd.sales) > 0 ? _n(cd.sales) : (invBySo[k] || _n(s.total)),
      hasCd: !!cd,
    };
  }).sort((a, b) => String(flowDate(a.date)).localeCompare(String(flowDate(b.date))));
}

// Pair each sheet order to a 2026 SO of the same normalized customer, in date order.
function autoMatch() {
  const byNorm = {};
  rcSos.forEach(s => { (byNorm[s.norm] = byNorm[s.norm] || []).push(s); });
  const used = {};
  rcOrders.forEach(o => {
    if (!o.norm) { o.soNo = ''; return; }
    let list = byNorm[o.norm];
    if (!list) {   // loose contains-match for name variants
      const hit = Object.keys(byNorm).find(k => k && (k.includes(o.norm) || o.norm.includes(k)));
      list = hit ? byNorm[hit] : null;
    }
    if (!list || !list.length) { o.soNo = ''; return; }
    const idx = used[o.norm] || 0;
    o.soNo = String((list[Math.min(idx, list.length - 1)]).soNo);
    used[o.norm] = idx + 1;
  });
}

function soByNo(no) { return rcSos.find(s => s.soNo === String(no)); }
function orderActual(o) { return o.goods + o.ship + o.duties + o.deliv; }

// System COGS shown per order: the assigned SO's COGS split across all orders assigned to it? No —
// show the SO's full COGS on the first order for that SO and note "+" on subsequent (they sum on apply).
function render() {
  const c = document.getElementById('container');
  if (!rcOrders.length) { c.innerHTML = '<div class="dr-empty">No 2026 purchase orders found in the sheet.</div>'; return; }
  const actualTot = rcOrders.reduce((s, o) => s + orderActual(o), 0);
  const sysTot = rcSos.reduce((s, x) => s + x.cogs, 0);
  const matched = rcOrders.filter(o => o.soNo).length;
  document.getElementById('kOrders').textContent = rcOrders.length + (rcStock.length ? ` (+${rcStock.length} stock)` : '');
  document.getElementById('kActual').textContent = flowMoney(actualTot, 'PHP');
  document.getElementById('kSystem').textContent = flowMoney(sysTot, 'PHP');
  document.getElementById('kGap').textContent = flowMoney(actualTot - sysTot, 'PHP');
  document.getElementById('kMatch').textContent = `${matched} / ${rcOrders.length - matched}`;

  // group orders by assigned SO so we can show the summed actual vs SO COGS gap
  const sumBySo = {};
  rcOrders.forEach(o => { if (o.soNo) sumBySo[o.soNo] = (sumBySo[o.soNo] || 0) + orderActual(o); });

  const opts = o => {
    const own = rcSos.filter(s => s.norm && (s.norm === o.norm || s.norm.includes(o.norm) || o.norm.includes(s.norm)));
    const rest = rcSos.filter(s => !own.includes(s));
    const opt = s => `<option value="${flowEsc(s.soNo)}"${s.soNo === o.soNo ? ' selected' : ''}>${flowEsc(s.soNo)} — ${flowEsc(s.customer)}</option>`;
    return `<option value="">— unassigned —</option>` +
      (own.length ? `<optgroup label="Same client">${own.map(opt).join('')}</optgroup>` : '') +
      `<optgroup label="All 2026 SOs">${rest.map(opt).join('')}</optgroup>`;
  };

  c.innerHTML = `<table class="mig-table"><thead><tr>
    <th></th><th>PO</th><th>Client (sheet)</th><th>Vendor</th>
    <th class="num">Goods</th><th class="num">Ship</th><th class="num">Duties</th><th class="num">Deliv</th>
    <th class="num">Actual COGS</th><th>Type</th><th>Sales Order</th><th class="num">System COGS</th><th class="num">Gap</th>
  </tr></thead><tbody>${rcOrders.map((o, i) => {
    const so = o.soNo ? soByNo(o.soNo) : null;
    const sysC = so ? so.cogs : 0;
    const assignedSum = o.soNo ? sumBySo[o.soNo] : 0;
    const gap = so ? assignedSum - sysC : 0;
    const gapCls = !so ? '' : Math.abs(gap) < 1 ? 'gap-ok' : (gap > 0 ? 'gap-pos' : 'gap-neg');
    return `<tr>
      <td><input type="checkbox" data-i="${i}" ${rcSelected.has(i) ? 'checked' : ''} ${o.soNo ? '' : 'disabled'}></td>
      <td><strong>${flowEsc(o.poId)}</strong><div style="font-size:0.66rem;color:var(--text-muted);">${o.lines} line(s)</div></td>
      <td>${flowEsc(o.client) || '<span class="mig-badge pend">blank client</span>'}</td>
      <td style="font-size:0.72rem;color:var(--text-secondary);">${flowEsc(o.vendor)}</td>
      <td class="num">${flowMoney(o.goods, 'PHP')}</td><td class="num">${o.ship ? flowMoney(o.ship, 'PHP') : '—'}</td>
      <td class="num">${o.duties ? flowMoney(o.duties, 'PHP') : '—'}</td><td class="num">${o.deliv ? flowMoney(o.deliv, 'PHP') : '—'}</td>
      <td class="num" style="font-weight:700;">${flowMoney(orderActual(o), 'PHP')}</td>
      <td><span class="mig-badge ${o.intl ? 'intl' : 'local'}">${o.intl ? 'Intl' : 'Local'}</span></td>
      <td><select data-so="${i}">${opts(o)}</select></td>
      <td class="num">${so ? flowMoney(sysC, 'PHP') : '—'}</td>
      <td class="num ${gapCls}">${so ? (Math.abs(gap) < 1 ? '✓' : flowMoney(gap, 'PHP')) : '—'}</td>
    </tr>`;
  }).join('')}</tbody></table>`;

  c.querySelectorAll('input[type="checkbox"][data-i]').forEach(cb => cb.addEventListener('change', () => {
    const i = +cb.dataset.i; if (cb.checked) rcSelected.add(i); else rcSelected.delete(i);
  }));
  c.querySelectorAll('select[data-so]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.so; rcOrders[i].soNo = sel.value; if (!sel.value) rcSelected.delete(i); render();
  }));
  renderExtra();
}

// System 2026 SOs with no purchase backing in the sheet + warehouse stock note.
function renderExtra() {
  const assigned = new Set(rcOrders.map(o => o.soNo).filter(Boolean));
  const orphans = rcSos.filter(s => !assigned.has(s.soNo));
  let html = '';
  if (orphans.length) {
    html += `<div class="sect-title">System 2026 sales orders with NO purchase in the sheet — verify their cost manually</div>
      <table class="mig-table"><thead><tr><th>SO</th><th>Customer</th><th class="num">Sales</th><th class="num">System COGS</th><th></th></tr></thead><tbody>` +
      orphans.map(s => `<tr><td><strong>${flowEsc(s.soNo)}</strong></td><td>${flowEsc(s.customer)}</td>
        <td class="num">${flowMoney(s.sales, 'PHP')}</td><td class="num">${flowMoney(s.cogs, 'PHP')}</td>
        <td>${s.cogs > 0 ? '<span class="mig-badge pend">estimated / unverified</span>' : '<span class="mig-badge pend">no cost</span>'}</td></tr>`).join('') +
      `</tbody></table>`;
  }
  if (rcStock.length) {
    const t = rcStock.reduce((s, o) => s + orderActual(o), 0);
    html += `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.8rem;">
      ${rcStock.length} Warehouse stock purchase(s) totalling ${flowMoney(t, 'PHP')} are inventory — not written to any sales order.</p>`;
  }
  document.getElementById('extra').innerHTML = html;
}

// ── Apply: sum the selected orders per SO and write the real cost breakdown ───
async function apply(idxs) {
  const orders = idxs.map(i => rcOrders[i]).filter(o => o && o.soNo);
  if (!orders.length) { _msg('Nothing selected (assign a Sales Order first).', false); return; }
  const bySo = {};
  orders.forEach(o => {
    const b = bySo[o.soNo] = bySo[o.soNo] || { goods: 0, ship: 0, duties: 0, deliv: 0, intl: false, logistics: '' };
    b.goods += o.goods; b.ship += o.ship; b.duties += o.duties; b.deliv += o.deliv;
    if (o.intl) b.intl = true;
    if (o.logistics) b.logistics = o.logistics;
  });
  const soNos = Object.keys(bySo);
  if (!confirm(`Write the actual purchase costs into ${soNos.length} sales order(s)? This replaces their current COGS with the sheet figures (revenue is kept).`)) return;
  const prog = document.getElementById('prog'), bar = document.getElementById('progBar');
  prog.style.display = 'block';
  let done = 0, errs = [];
  for (const soNo of soNos) {
    const so = soByNo(soNo), b = bySo[soNo];
    const rec = {
      soNo, customer: so.customer, date: flowDate(so.date), sales: so.sales,
      cogsType: b.intl ? 'international' : 'local',
      purchaseOfGoods: Math.round(b.goods * 100) / 100,
      dutiesAndTaxes: Math.round(b.duties * 100) / 100,
      shippingCost: Math.round(b.ship * 100) / 100,
      deliveryToClient: Math.round(b.deliv * 100) / 100,
      deliveryToOffice: 0, localCharges: 0, bankChargeCOGS: 0, bankChargeShipping: 0,
      shippingCompany: b.logistics || '',
    };
    try {
      const res = await postFlow('saveSOCostDetails', { record: JSON.stringify(rec) });
      if (!res.success) throw new Error(res.message);
    } catch (e) { errs.push(soNo + ': ' + e.message); }
    done++; bar.style.width = Math.round(done / soNos.length * 100) + '%';
  }
  prog.style.display = 'none'; bar.style.width = '0';
  _msg(errs.length ? `Applied ${soNos.length - errs.length}/${soNos.length} — errors: ${errs.join('; ')}` : `Applied actual costs to ${soNos.length} sales order(s).`, !errs.length);
  // Refresh the system side so the GAP column reflects the writes.
  try {
    const [soRes, cdRes, invRes] = await Promise.all([
      fetchFlow('getSalesOrders'), fetchFlow('getSOCostDetails'), fetchFlow('getInvoices'),
    ]);
    const keep = rcOrders.map(o => ({ poId: o.poId, soNo: o.soNo }));
    buildSos((soRes && soRes.data) || [], (cdRes && cdRes.data) || [], (invRes && invRes.data) || []);
    keep.forEach(k => { const o = rcOrders.find(x => x.poId === k.poId); if (o) o.soNo = k.soNo; });
    rcSelected = new Set();
    render();
  } catch (e) { /* leave as-is */ }
}
