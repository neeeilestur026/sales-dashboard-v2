/* migrate-so-costs.js — migrate each SO's full cost breakdown from the old Profit Report
   (apiGetProfitReports) into the new flow (importSOCostDetails). Idempotent; verify-before-migrate. */

let mcSession = null;
let mcRows = [];                 // one normalized row per SO
let mcMigrated = new Set();      // soNos already in SOCostDetails
let mcSelected = new Set();

function _mn(v) { return flowNum(v); }
function _mm(v) { return flowMoney(v, 'PHP'); }
function _me(s) { return flowEsc(s); }

document.addEventListener('DOMContentLoaded', () => {
  mcSession = requireAccountingOrAdmin();
  if (!mcSession) return;
  renderNavbar('migrate-so-costs');
  document.getElementById('reloadBtn').addEventListener('click', load);
  ['search', 'statusFilter', 'mismatchFilter'].forEach(id => document.getElementById(id).addEventListener('input', render));
  document.getElementById('selAllBtn').addEventListener('click', selectAllPending);
  document.getElementById('migSelBtn').addEventListener('click', () => migrate(pending().filter(r => mcSelected.has(r.soNo))));
  document.getElementById('migAllBtn').addEventListener('click', () => migrate(pending()));
  document.getElementById('backfillBtn').addEventListener('click', backfill);
  document.getElementById('removeMigBtn').addEventListener('click', removeMigrated);
  load();
});

function _computedCOGS(e) {
  let t = _mn(e.purchaseOfGoods) + _mn(e.deliveryToOffice) + _mn(e.deliveryToClient);
  if (String(e.cogsType) === 'international') {
    t += _mn(e.bankServiceChargeCOGS) + _mn(e.dutiesAndTaxes) + _mn(e.bankServiceChargeShipping) + _mn(e.shippingCost) + _mn(e.localCharges);
  }
  return t;
}

async function load() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="dr-empty">Loading…</div>';
  try {
    const [profit, migrated] = await Promise.all([
      apiGetProfitReports().catch(e => ({ success: false, message: e.message })),
      fetchFlow('getSOCostDetails').catch(() => ({ data: [] })),
    ]);
    // flatten the old reports → one row per SO (the old API already de-dupes per SO)
    const seen = new Set();
    mcRows = [];
    ((profit && profit.data) || []).forEach(rep => (rep.entries || []).forEach(e => {
      const so = e.soNo != null ? String(e.soNo).trim() : '';
      if (!so || seen.has(so)) return;
      seen.add(so);
      mcRows.push(Object.assign({}, e, { soNo: so, soDate: e.soDate || rep.reportDate || '', computed: _computedCOGS(e) }));
    }));
    mcMigrated = new Set(((migrated && migrated.data) || []).map(r => String(r.soNo)));
    mcSelected = new Set();
    render();
  } catch (e) { c.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${_me(e.message)}</div>`; }
}

function isMigrated(r) { return mcMigrated.has(String(r.soNo)); }
function pending() { return mcRows.filter(r => !isMigrated(r)); }

function filtered() {
  const q = (document.getElementById('search').value || '').trim().toLowerCase();
  const sf = document.getElementById('statusFilter').value;
  const mf = document.getElementById('mismatchFilter').value;
  return mcRows.filter(r => {
    if (sf === 'pending' && isMigrated(r)) return false;
    if (sf === 'done' && !isMigrated(r)) return false;
    if (mf === 'warn' && Math.abs(r.computed - _mn(r.totalCOGS)) <= 0.01) return false;
    if (q && !((r.soNo + ' ' + (r.customerName || '')).toLowerCase().includes(q))) return false;
    return true;
  });
}

function selectAllPending() {
  filtered().forEach(r => { if (!isMigrated(r)) mcSelected.add(r.soNo); });
  render();
}

function render() {
  const rows = filtered();
  const total = mcRows.length, done = mcRows.filter(isMigrated).length;
  const sumSales = mcRows.reduce((s, r) => s + _mn(r.sales), 0);
  const sumCogs = mcRows.reduce((s, r) => s + _mn(r.totalCOGS), 0);
  const warn = mcRows.filter(r => Math.abs(r.computed - _mn(r.totalCOGS)) > 0.01).length;
  document.getElementById('kpis').innerHTML = [
    ['Total Sales Orders', total], ['Already migrated', done], ['Pending', total - done],
    ['Total Sales', _mm(sumSales)], ['Total COGS', _mm(sumCogs)], ['COGS mismatches', warn],
  ].map(([l, v]) => `<div class="mig-tile"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');

  const c = document.getElementById('container');
  if (!mcRows.length) { c.innerHTML = '<div class="dr-empty">No profit-report entries found in the old system.</div>'; return; }
  if (!rows.length) { c.innerHTML = '<div class="dr-empty">No sales orders match the filters.</div>'; return; }

  c.innerHTML = `<div style="overflow-x:auto;"><table class="mig-table">
    <thead><tr><th style="width:28px;"></th><th>SO No</th><th>Customer</th><th>Date</th><th>Type</th>
      <th class="num">Sales</th><th class="num">Total COGS</th><th class="num">Gross Profit</th><th>Breakdown</th><th>Status</th></tr></thead>
    <tbody>${rows.map((r, i) => rowHtml(r, i)).join('')}</tbody></table></div>`;

  c.querySelectorAll('[data-chk]').forEach(cb => cb.addEventListener('change', () => {
    const so = cb.getAttribute('data-chk');
    cb.checked ? mcSelected.add(so) : mcSelected.delete(so);
  }));
  c.querySelectorAll('[data-bd]').forEach(b => b.addEventListener('click', () => {
    const el = document.getElementById('bd-' + b.getAttribute('data-bd'));
    if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
  }));
}

function rowHtml(r, i) {
  const mig = isMigrated(r);
  const mism = Math.abs(r.computed - _mn(r.totalCOGS)) > 0.01;
  const chk = mig ? '' : `<input type="checkbox" data-chk="${_me(r.soNo)}"${mcSelected.has(r.soNo) ? ' checked' : ''}>`;
  const breakdown = `<tr class="mig-bd" id="bd-${i}" style="display:none;"><td colspan="10">${bdTable(r)}</td></tr>`;
  return `<tr>
    <td>${chk}</td>
    <td><strong>${_me(r.soNo)}</strong></td>
    <td>${_me(r.customerName || '—')}</td>
    <td>${_me(r.soDate || '—')}</td>
    <td>${_me(r.cogsType || 'local')}</td>
    <td class="num">${_mm(r.sales)}</td>
    <td class="num">${_mm(r.totalCOGS)}${mism ? ' <span class="mig-warn" title="Stored ' + _mm(r.totalCOGS) + ' vs computed ' + _mm(r.computed) + '">⚠</span>' : ''}</td>
    <td class="num">${_mm(r.grossProfit)}</td>
    <td><button class="mig-link" data-bd="${i}">view ▾</button></td>
    <td><span class="mig-badge ${mig ? 'done' : 'pend'}">${mig ? 'Migrated ✓' : 'Pending'}</span></td>
  </tr>${breakdown}`;
}

function bdTable(r) {
  const intl = String(r.cogsType) === 'international';
  const line = (label, val) => `<tr><td>${label}</td><td class="num">${_mm(val)}</td></tr>`;
  let rows = `<tr><td colspan="2" style="font-weight:700;color:var(--text-primary);">Revenue</td></tr>` + line('Sales', r.sales);
  rows += `<tr><td colspan="2" style="font-weight:700;color:var(--text-primary);">Cost of Goods Sold</td></tr>`;
  rows += line('Purchase of Goods', r.purchaseOfGoods);
  if (intl) {
    rows += line('Bank Charge (COGS)', r.bankServiceChargeCOGS);
    rows += line('Duties &amp; Taxes', r.dutiesAndTaxes);
    rows += line('Bank Charge (Shipping)', r.bankServiceChargeShipping);
    rows += line('Shipping Cost' + (r.shippingCompany ? ' (' + _me(r.shippingCompany) + ')' : ''), r.shippingCost);
    rows += line('Local Charges', r.localCharges);
  }
  rows += line('Delivery to Office', r.deliveryToOffice);
  rows += line('Delivery to Client', r.deliveryToClient);
  rows += `<tr class="tot"><td>Total COGS</td><td class="num">${_mm(r.totalCOGS)}</td></tr>`;
  rows += `<tr class="tot"><td>Gross Profit</td><td class="num">${_mm(r.grossProfit)}</td></tr>`;
  return `<div style="padding:0.4rem 0.6rem;"><table>${rows}</table>
    ${Math.abs(r.computed - _mn(r.totalCOGS)) > 0.01 ? `<div class="mig-warn" style="font-size:0.74rem;">⚠ Stored Total COGS ${_mm(r.totalCOGS)} differs from the sum of components ${_mm(r.computed)} — the stored value is migrated as-is.</div>` : ''}</div>`;
}

async function migrate(list) {
  list = (list || []).filter(r => !isMigrated(r));
  if (!list.length) { flash('Nothing pending to migrate.', false); return; }
  const prog = document.getElementById('prog'), bar = document.getElementById('progBar');
  prog.style.display = 'block'; bar.style.width = '0';
  [document.getElementById('migSelBtn'), document.getElementById('migAllBtn')].forEach(b => b.disabled = true);
  const chunks = [];
  for (let i = 0; i < list.length; i += 25) chunks.push(list.slice(i, i + 25));
  let created = 0, headers = 0, skipped = 0, mism = 0; const errors = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const payload = chunks[i].map(r => ({
        soNo: r.soNo, customerName: r.customerName, soDate: r.soDate, sales: r.sales, cogsType: r.cogsType,
        purchaseOfGoods: r.purchaseOfGoods, bankServiceChargeCOGS: r.bankServiceChargeCOGS,
        dutiesAndTaxes: r.dutiesAndTaxes, bankServiceChargeShipping: r.bankServiceChargeShipping,
        shippingCompany: r.shippingCompany, shippingCost: r.shippingCost, localCharges: r.localCharges,
        deliveryToOffice: r.deliveryToOffice, deliveryToClient: r.deliveryToClient,
        totalCOGS: r.totalCOGS, grossProfit: r.grossProfit,
      }));
      const res = await postFlow('importSOCostDetails', { items: JSON.stringify(payload) });
      if (res && res.success) {
        created += res.created || 0; headers += res.headersCreated || 0; skipped += res.skipped || 0;
        mism += (res.mismatches || []).length;
      } else { errors.push((res && res.message) || 'chunk failed'); }
      bar.style.width = Math.round(((i + 1) / chunks.length) * 100) + '%';
    }
    await load();
    flash(`Migrated ${created} cost detail(s); created ${headers} SO header(s); skipped ${skipped}.` +
      (mism ? ` ${mism} had a COGS mismatch (stored value kept).` : '') +
      (errors.length ? ` Errors: ${errors.join('; ')}` : ''), !errors.length);
  } catch (e) { flash(e.message, false); }
  finally {
    [document.getElementById('migSelBtn'), document.getElementById('migAllBtn')].forEach(b => b.disabled = false);
    setTimeout(() => { prog.style.display = 'none'; }, 600);
  }
}

// Create migrated Invoice + Receiving records for every migrated SO so the invoice-/receiving-driven
// widgets (Financial Snapshot, Summary, Balance Sheet) include them. Idempotent, safe to re-run.
async function backfill() {
  const btn = document.getElementById('backfillBtn');
  btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Backfilling…';
  try {
    const r = await postFlow('backfillMigratedRecords', {});
    if (!r || !r.success) throw new Error((r && r.message) || 'Backfill failed');
    flash(`Backfilled ${r.invoicesCreated || 0} invoice(s) and ${r.receivingsCreated || 0} receiving record(s). The Financial Snapshot now includes migrated sales orders.`, true);
  } catch (e) { flash(e.message, false); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

// Remove all migrated SO records (cost details, header SOs, invoices, receiving) for a clean re-migrate.
async function removeMigrated() {
  if (!confirm('Remove ALL migrated sales orders and their cost details, invoices and receiving records? Real new-flow records are kept. You can then Migrate all pending to re-migrate cleanly.')) return;
  const btn = document.getElementById('removeMigBtn');
  btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Removing…';
  try {
    const r = await postFlow('deleteMigratedRecords', {});
    if (!r || !r.success) throw new Error((r && r.message) || 'Remove failed');
    flash(r.message + ' You can now Migrate all pending to re-migrate.', true);
    await load();
  } catch (e) { flash(e.message, false); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

function flash(msg, ok) {
  const el = document.getElementById('msg');
  el.style.display = 'block'; el.textContent = msg;
  el.style.background = ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
  el.style.color = ok ? '#16a34a' : '#ef4444';
}
