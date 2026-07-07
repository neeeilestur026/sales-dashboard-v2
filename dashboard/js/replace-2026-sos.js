/* replace-2026-sos.js — one-time tool: replace ALL 2026 sales orders + cost breakdowns with the
   authoritative "2026 SO vs PO Reconciliation" file (SO P&L sheet, 37 SOs — embedded below).
   Step 1 wipes the 2026 MIGRATED records only (year-scoped deleteMigratedRecords — version-gated so it
   can't run against an old FlowAPI deployment where the year filter would be ignored).
   Step 2 imports each SO via saveSOCostDetails (creates the header with the file's status + Intl/Local
   label, writes the full cost breakdown, regenerates the migrated Invoice + Receiving).
   File totals: Revenue ₱8,535,630.46 · COGS ₱3,720,768.54 · GP ₱4,814,861.92. */

const RS_MIN_VERSION = 65;            // v64: year-scoped wipe · v65: import ALWAYS ensures the SO header
const RS_EXP_SALES = 8535630.46;
const RS_EXP_COGS  = 3720768.54;

// Source: 2026_SO_vs_PO_Reconciliation copy.xlsx · sheet "SO P&L (Completed)" (TOTAL row excluded).
const REPLACE_2026 = [
  {"soNo": "180100005858", "customer": "Philcement Corporation", "date": "2026-01-28", "status": "Delivered", "cogsType": "international", "sales": 54528.57, "purchaseOfGoods": 9544.92, "dutiesAndTaxes": 3051.8, "shippingCost": 3569.31, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 16166.03, "grossProfit": 38362.54},
  {"soNo": "2320004825", "customer": "Panabo Trucking Services, Inc.", "date": "2026-01-18", "status": "Delivered", "cogsType": "local", "sales": 8604.44, "purchaseOfGoods": 2400.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 384.0, "localCharges": 0.0, "totalCOGS": 2784.0, "grossProfit": 5820.44},
  {"soNo": "50001445", "customer": "Therma Luzon Inc.", "date": "2026-01-01", "status": "Delivered", "cogsType": "local", "sales": 53760.0, "purchaseOfGoods": 34000.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 2514.0, "localCharges": 0.0, "totalCOGS": 36514.0, "grossProfit": 17246.0},
  {"soNo": "PDC1811000000953", "customer": "Petra Cement Inc.", "date": "2026-02-17", "status": "Delivered", "cogsType": "international", "sales": 391053.91, "purchaseOfGoods": 107247.87, "dutiesAndTaxes": 25667.96, "shippingCost": 7774.4, "deliveryToClient": 2492.48, "localCharges": 2099.92, "totalCOGS": 145282.63, "grossProfit": 245771.28},
  {"soNo": "PO 000003501", "customer": "Itogon-Suyoc Resources, Inc.", "date": "2026-02-03", "status": "Delivered", "cogsType": "local", "sales": 35930.5, "purchaseOfGoods": 19570.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 19570.0, "grossProfit": 16360.5},
  {"soNo": "150003171", "customer": "Therma Marine Inc. (Aboitiz Power)", "date": "2026-03-30", "status": "Delivered", "cogsType": "local", "sales": 61600.0, "purchaseOfGoods": 33250.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 2432.44, "localCharges": 0.0, "totalCOGS": 35682.44, "grossProfit": 25917.56},
  {"soNo": "180100006027", "customer": "Philcement Corporation", "date": "2026-03-10", "status": "Delivered", "cogsType": "local", "sales": 29301.99, "purchaseOfGoods": 15470.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 15470.0, "grossProfit": 13831.99},
  {"soNo": "180100006030", "customer": "Philcement Corporation", "date": "2026-03-11", "status": "Delivered", "cogsType": "local", "sales": 58944.94, "purchaseOfGoods": 37620.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 37620.0, "grossProfit": 21324.94},
  {"soNo": "3120016966 | T16", "customer": "Taganito HPAL Nickel Corporation", "date": "2026-03-01", "status": "Delivered", "cogsType": "international", "sales": 195099.8, "purchaseOfGoods": 68055.9, "dutiesAndTaxes": 23772.38, "shippingCost": 5495.62, "deliveryToClient": 0.0, "localCharges": 4915.06, "totalCOGS": 102238.96, "grossProfit": 92860.84},
  {"soNo": "PDC1811000001042", "customer": "Petra Cement Inc.", "date": "2026-03-08", "status": "Delivered", "cogsType": "local", "sales": 78168.9, "purchaseOfGoods": 45700.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 2548.57, "localCharges": 0.0, "totalCOGS": 48248.57, "grossProfit": 29920.33},
  {"soNo": "PDC1811000001123", "customer": "Petra Cement Inc.", "date": "2026-03-30", "status": "Delivered", "cogsType": "local", "sales": 118026.06, "purchaseOfGoods": 47520.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 1683.0, "localCharges": 0.0, "totalCOGS": 49203.0, "grossProfit": 68823.06},
  {"soNo": "PO 000003643", "customer": "Itogon-Suyoc Resources, Inc.", "date": "2026-03-06", "status": "Delivered", "cogsType": "international", "sales": 348049.63, "purchaseOfGoods": 116069.2, "dutiesAndTaxes": 0.0, "shippingCost": 29357.15, "deliveryToClient": 0.0, "localCharges": 231.28, "totalCOGS": 145657.63, "grossProfit": 202392.0},
  {"soNo": "150001618", "customer": "SN Aboitiz Power-Benguet, Inc.", "date": "2026-04-12", "status": "Delivered", "cogsType": "international", "sales": 193124.57, "purchaseOfGoods": 82845.96, "dutiesAndTaxes": 19594.16, "shippingCost": 39943.7, "deliveryToClient": 0.0, "localCharges": 6567.4, "totalCOGS": 148951.22, "grossProfit": 44173.35},
  {"soNo": "180100006145", "customer": "Philcement Corporation", "date": "2026-04-07", "status": "Delivered", "cogsType": "local", "sales": 58074.06, "purchaseOfGoods": 28195.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 380.02, "localCharges": 0.0, "totalCOGS": 28575.02, "grossProfit": 29499.04},
  {"soNo": "180100006167", "customer": "Philcement Corporation", "date": "2026-04-14", "status": "Delivered", "cogsType": "international", "sales": 63762.19, "purchaseOfGoods": 18281.12, "dutiesAndTaxes": 2951.0, "shippingCost": 1578.1, "deliveryToClient": 451.0, "localCharges": 298.37, "totalCOGS": 23559.59, "grossProfit": 40202.6},
  {"soNo": "8696", "customer": "Durastress Corporation", "date": "2026-04-27", "status": "Delivered", "cogsType": "international", "sales": 117950.01, "purchaseOfGoods": 54254.2, "dutiesAndTaxes": 9014.17, "shippingCost": 4820.49, "deliveryToClient": 0.0, "localCharges": 2499.12, "totalCOGS": 70587.98, "grossProfit": 47362.03},
  {"soNo": "PDC1811000001174", "customer": "Petra Cement Inc.", "date": "2026-04-17", "status": "Pending", "cogsType": "local", "sales": 672974.6, "purchaseOfGoods": 470153.49, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 470153.49, "grossProfit": 202821.11},
  {"soNo": "PDC1811000001221", "customer": "Petra Cement Inc.", "date": "2026-04-27", "status": "Delivered", "cogsType": "local", "sales": 62950.26, "purchaseOfGoods": 26695.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 10637.73, "localCharges": 0.0, "totalCOGS": 37332.73, "grossProfit": 25617.53},
  {"soNo": "PO000003715", "customer": "Itogon-Suyoc Resources Inc.", "date": "2026-04-30", "status": "Delivered", "cogsType": "local", "sales": 11352.94, "purchaseOfGoods": 6200.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 6200.0, "grossProfit": 5152.94},
  {"soNo": "4000032615", "customer": "Eagle Cement Corporation", "date": "2026-05-19", "status": "Pending", "cogsType": "local", "sales": 1130951.09, "purchaseOfGoods": 500000.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 38968.16, "localCharges": 0.0, "totalCOGS": 538968.16, "grossProfit": 591982.93},
  {"soNo": "7200003166", "customer": "Advantage Concrete Industries Corp.", "date": "2026-05-28", "status": "Delivered", "cogsType": "local", "sales": 15079.51, "purchaseOfGoods": 7610.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 542.0, "localCharges": 0.0, "totalCOGS": 8152.0, "grossProfit": 6927.51},
  {"soNo": "PDC1811000001182", "customer": "Petra Cement Inc.", "date": "2026-05-15", "status": "Delivered", "cogsType": "international", "sales": 546899.73, "purchaseOfGoods": 146806.28, "dutiesAndTaxes": 22859.36, "shippingCost": 13221.73, "deliveryToClient": 2485.99, "localCharges": 2339.28, "totalCOGS": 187712.64, "grossProfit": 359187.09},
  {"soNo": "PDC1811000001316", "customer": "Petra Cement Inc.", "date": "2026-05-18", "status": "Delivered", "cogsType": "local", "sales": 224975.17, "purchaseOfGoods": 93854.46, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 10003.98, "localCharges": 0.0, "totalCOGS": 103858.44, "grossProfit": 121116.73},
  {"soNo": "PDC1811000001325", "customer": "Petra Cement Inc.", "date": "2026-05-20", "status": "Delivered", "cogsType": "local", "sales": 111723.29, "purchaseOfGoods": 46468.78, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 2577.77, "localCharges": 0.0, "totalCOGS": 49046.55, "grossProfit": 62676.74},
  {"soNo": "PDC1811000001337", "customer": "Petra Cement Inc.", "date": "2026-05-21", "status": "Delivered", "cogsType": "local", "sales": 134805.51, "purchaseOfGoods": 57400.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 3110.34, "localCharges": 0.0, "totalCOGS": 60510.34, "grossProfit": 74295.17},
  {"soNo": "PDC1811000001375", "customer": "Petra Cement Inc.", "date": "2026-05-28", "status": "Delivered", "cogsType": "local", "sales": 119760.36, "purchaseOfGoods": 46875.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 46875.0, "grossProfit": 72885.36},
  {"soNo": "150002447", "customer": "Therma Luzon Inc.", "date": "2026-06-01", "status": "Delivered", "cogsType": "international", "sales": 556707.29, "purchaseOfGoods": 211095.68, "dutiesAndTaxes": 35759.06, "shippingCost": 76773.15, "deliveryToClient": 6232.0, "localCharges": 5966.59, "totalCOGS": 335826.48, "grossProfit": 220880.81},
  {"soNo": "180100006416", "customer": "Philcement Corporation", "date": "2026-06-09", "status": "Delivered", "cogsType": "local", "sales": 46552.0, "purchaseOfGoods": 28842.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 499.0, "localCharges": 0.0, "totalCOGS": 29341.0, "grossProfit": 17211.0},
  {"soNo": "3120018892 | T16", "customer": "Taganito HPAL Nickel Corporation", "date": "2026-06-08", "status": "Pending", "cogsType": "local", "sales": 2440205.4, "purchaseOfGoods": 747438.6, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 747438.6, "grossProfit": 1692766.8},
  {"soNo": "51762", "customer": "FIRST FARMERS HOLDING CORPORATION", "date": "2026-06-18", "status": "Pending", "cogsType": "local", "sales": 11694.22, "purchaseOfGoods": 5720.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 5720.0, "grossProfit": 5974.22},
  {"soNo": "531051", "customer": "SPI Power Incorporated", "date": "2026-06-10", "status": "Pending", "cogsType": "local", "sales": 95884.45, "purchaseOfGoods": 46900.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 1186.21, "localCharges": 0.0, "totalCOGS": 48086.21, "grossProfit": 47798.24},
  {"soNo": "PDC1811000001421", "customer": "Petra Cement Inc.", "date": "2026-06-09", "status": "Pending", "cogsType": "local", "sales": 250450.0, "purchaseOfGoods": 84241.08, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 84241.08, "grossProfit": 166208.92},
  {"soNo": "PDC1811000001450", "customer": "Petra Cement Inc.", "date": "2026-06-18", "status": "Delivered", "cogsType": "local", "sales": 7784.5, "purchaseOfGoods": 3750.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 346.15, "localCharges": 0.0, "totalCOGS": 4096.15, "grossProfit": 3688.35},
  {"soNo": "PO000004070", "customer": "ITOGON-SUYOC RESOURCES, INC.", "date": "2026-06-21", "status": "Delivered", "cogsType": "local", "sales": 13126.42, "purchaseOfGoods": 7990.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 7990.0, "grossProfit": 5136.42},
  {"soNo": "SO-202606-005", "customer": "Philcement Corporation", "date": "2026-06-28", "status": "Open", "cogsType": "local", "sales": 63762.19, "purchaseOfGoods": 23108.6, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 23108.6, "grossProfit": 40653.59},
  {"soNo": "SO-202607-001", "customer": "Asian Aerospace Corporation", "date": "2026-06-30", "status": "Open", "cogsType": "local", "sales": 72607.2, "purchaseOfGoods": 0.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 0.0, "grossProfit": 72607.2},
  {"soNo": "SO-202607-002", "customer": "First Farmers Holding Corporation (FFHC)", "date": "2026-06-30", "status": "Open", "cogsType": "local", "sales": 79404.76, "purchaseOfGoods": 0.0, "dutiesAndTaxes": 0.0, "shippingCost": 0.0, "deliveryToClient": 0.0, "localCharges": 0.0, "totalCOGS": 0.0, "grossProfit": 79404.76}
];

let rsSession = null;
let rsSystem = { sos: [], costs: [], version: 0 };   // current system state (2026 view)

document.addEventListener('DOMContentLoaded', () => {
  rsSession = requireAccountingOrAdmin();
  if (!rsSession) return;
  renderNavbar('replace-2026-sos');
  document.getElementById('wipeBtn').addEventListener('click', runWipe);
  document.getElementById('importBtn').addEventListener('click', runImport);
  document.getElementById('verifyBtn').addEventListener('click', runVerify);
  document.getElementById('reloadBtn').addEventListener('click', loadSystem);
  loadSystem();
});

function _n(v) { return (typeof flowNum === 'function') ? flowNum(v) : (parseFloat(v) || 0); }
function _m(v) { return '₱' + _n(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _is2026(d) { return String(flowDate(d) || '').indexOf('2026') === 0; }
function _migrated(cb) { const s = String(cb || ''); return s === 'Migrated (legacy)' || s === 'Manual (edited)'; }
function _status(id, text, ok) {
  const el = document.getElementById(id);
  el.style.display = 'block'; el.innerHTML = text;
  el.style.background = ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
  el.style.color = ok ? '#047857' : '#b91c1c';
}
function _progress(done, total, label) {
  document.getElementById('progWrap').style.display = 'block';
  document.getElementById('progBar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  document.getElementById('progText').textContent = label + ' ' + done + ' / ' + total;
}

async function loadSystem() {
  const c = document.getElementById('compareBody');
  c.innerHTML = '<tr><td colspan="8" style="color:var(--text-muted,#64748b);">Loading system state…</td></tr>';
  try {
    const [ver, so, cd] = await Promise.all([
      fetchFlow('getVersion').catch(() => ({ version: 0 })),
      fetchFlow('getSalesOrders'),
      fetchFlow('getSOCostDetails').catch(() => ({ data: [] }))
    ]);
    rsSystem.version = _n(ver && ver.version);
    rsSystem.sos = ((so && so.data) || []).filter(s => _is2026(s.date));
    rsSystem.costs = ((cd && cd.data) || []).filter(x => _is2026(x.date));
  } catch (e) {
    c.innerHTML = `<tr><td colspan="8" style="color:#ef4444;">${flowEsc(e.message)}</td></tr>`;
    return;
  }
  render();
}

function render() {
  // version gate
  const gate = document.getElementById('versionGate');
  const wipeBtn = document.getElementById('wipeBtn');
  if (rsSystem.version >= RS_MIN_VERSION) {
    gate.innerHTML = `✅ FlowAPI backend is current (version ${rsSystem.version}).`;
    gate.style.color = '#047857';
    wipeBtn.disabled = false;
  } else {
    gate.innerHTML = `⛔ FlowAPI backend is OUTDATED (version ${rsSystem.version || 'unknown'} &lt; ${RS_MIN_VERSION}). ` +
      `<b>Redeploy apps-script/FlowAPI.gs first</b> — running the wipe against the old backend would delete migrated records for ALL years, not just 2026.`;
    gate.style.color = '#b91c1c';
    wipeBtn.disabled = true;
  }

  // KPI tiles
  const costBySo = {}; rsSystem.costs.forEach(x => { costBySo[String(x.soNo)] = x; });
  const soBySo = {}; rsSystem.sos.forEach(s => { soBySo[String(s.soNo)] = s; });
  const fileSet = new Set(REPLACE_2026.map(r => String(r.soNo)));
  const extras = rsSystem.sos.filter(s => !fileSet.has(String(s.soNo)));
  const kpis = [
    ['File SOs', REPLACE_2026.length],
    ['File Revenue', _m(RS_EXP_SALES)],
    ['File COGS', _m(RS_EXP_COGS)],
    ['System 2026 SOs', rsSystem.sos.length],
    ['Extras (not in file)', extras.length]
  ];
  document.getElementById('kpiRow').innerHTML = kpis.map(k =>
    `<div class="mig-tile"><div class="lbl">${k[0]}</div><div class="val">${k[1]}</div></div>`).join('');

  // comparison table: file vs system
  document.getElementById('compareBody').innerHTML = REPLACE_2026.map(r => {
    const cd = costBySo[String(r.soNo)];
    const so = soBySo[String(r.soNo)];
    const sysSales = cd ? _n(cd.sales) : (so ? _n(so.total) : null);
    const sysCogs = cd ? _n(cd.totalCOGS) : null;
    const match = cd && Math.abs(sysSales - r.sales) < 0.01 && Math.abs(sysCogs - r.totalCOGS) < 0.01;
    const badge = !so && !cd ? '<span class="flow-badge b-pending">not in system</span>'
      : match ? '<span class="flow-badge b-approved">matches</span>'
      : '<span class="flow-badge b-rejected">will change</span>';
    return `<tr>
      <td>${flowEsc(r.soNo)}</td><td>${flowEsc(r.customer)}</td><td>${flowEsc(r.date)}</td>
      <td>${flowEsc(r.status)} · ${r.cogsType === 'international' ? 'Intl' : 'Local'}</td>
      <td class="num">${_m(r.sales)}</td><td class="num">${_m(r.totalCOGS)}</td>
      <td class="num" style="color:var(--text-muted,#64748b);">${sysSales == null ? '—' : _m(sysSales)} / ${sysCogs == null ? '—' : _m(sysCogs)}</td>
      <td>${badge}</td></tr>`;
  }).join('');

  // extras: 2026 system SOs not in the file (the wipe removes the migrated ones)
  const ex = document.getElementById('extrasBody');
  ex.innerHTML = extras.length ? extras.map(s => `<tr>
      <td>${flowEsc(s.soNo)}</td><td>${flowEsc(s.customer)}</td><td>${flowDate(s.date)}</td>
      <td class="num">${_m(s.total)}</td>
      <td>${_migrated(s.createdBy)
        ? '<span class="flow-badge b-rejected">migrated — will be removed</span>'
        : '<span class="flow-badge b-approved">flow-native — kept</span>'}</td>
    </tr>`).join('')
    : '<tr><td colspan="5" style="color:var(--text-muted,#64748b);">None — every 2026 system SO is in the file.</td></tr>';
}

// ── Step 1: wipe 2026 migrated records (version-gated) ──
async function runWipe() {
  if (rsSystem.version < RS_MIN_VERSION) { _status('wipeMsg', 'Blocked: redeploy FlowAPI first.', false); return; }
  if (!confirm('Remove ALL migrated 2026 records (sales orders, cost details, migrated invoices + receiving)?\nFlow-native records and other years are untouched.')) return;
  const btn = document.getElementById('wipeBtn');
  btn.disabled = true; btn.textContent = 'Removing…';
  try {
    const r = await postFlow('deleteMigratedRecords', { year: '2026' });
    if (!r.success) throw new Error(r.message);
    _status('wipeMsg', flowEsc(r.message), true);
    await loadSystem();
  } catch (e) { _status('wipeMsg', flowEsc(e.message), false); }
  finally { btn.disabled = false; btn.textContent = 'Step 1 — Remove migrated 2026 records'; }
}

// ── Step 2: import the 37 SOs (header + full cost breakdown + regenerated invoice/receiving each) ──
async function runImport() {
  // v65 gate: older backends only create the SO header on the FIRST cost save (upsert path skipped it),
  // which left SOs headerless and made SO counts disagree across dashboards. Refuse to repeat that.
  if (rsSystem.version < RS_MIN_VERSION) {
    _status('importMsg', `Blocked: FlowAPI backend is version ${rsSystem.version || 'unknown'} — redeploy apps-script/FlowAPI.gs (v${RS_MIN_VERSION}) first so the import also repairs missing SO headers.`, false);
    return;
  }
  if (!confirm('Import all ' + REPLACE_2026.length + ' sales orders from the reconciliation file?')) return;
  const btn = document.getElementById('importBtn');
  btn.disabled = true;
  let ok = 0; const errors = [];
  for (let i = 0; i < REPLACE_2026.length; i++) {
    const r = REPLACE_2026[i];
    _progress(i, REPLACE_2026.length, 'Importing');
    try {
      const res = await postFlow('saveSOCostDetails', { record: JSON.stringify({ ...r, source: 'import' }) });
      if (!res.success) throw new Error(res.message);
      ok++;
    } catch (e) { errors.push(r.soNo + ': ' + e.message); }
  }
  _progress(REPLACE_2026.length, REPLACE_2026.length, 'Imported');
  _status('importMsg', `Imported ${ok} / ${REPLACE_2026.length} SO(s).` +
    (errors.length ? '<br>Errors:<br>' + errors.map(flowEsc).join('<br>') : ''), !errors.length);
  btn.disabled = false;
  await loadSystem();
  runVerify();
}

// ── Verify: system 2026 totals must equal the file to the centavo ──
function runVerify() {
  const costBySo = {}; rsSystem.costs.forEach(x => { costBySo[String(x.soNo)] = x; });
  const checks = [];
  const missing = REPLACE_2026.filter(r => !costBySo[String(r.soNo)]);
  checks.push([`All ${REPLACE_2026.length} file SOs present in system cost details`, missing.length === 0,
    missing.length ? 'missing: ' + missing.map(m => m.soNo).join(', ') : '']);
  // Headers are what every SO list/count reads (accounting, admin, management) — cost details alone
  // aren't enough. This check was missing when 29 headerless SOs slipped through unnoticed.
  const hdrBySo = {}; rsSystem.sos.forEach(s => { hdrBySo[String(s.soNo)] = s; });
  const noHdr = REPLACE_2026.filter(r => !hdrBySo[String(r.soNo)]);
  checks.push([`All ${REPLACE_2026.length} file SOs have a Sales Order header (visible in every SO list)`, noHdr.length === 0,
    noHdr.length ? `${noHdr.length} missing: ` + noHdr.map(m => m.soNo).join(', ') : '']);
  let sumSales = 0, sumCogs = 0, rowBad = [];
  REPLACE_2026.forEach(r => {
    const cd = costBySo[String(r.soNo)];
    if (!cd) return;
    sumSales += _n(cd.sales); sumCogs += _n(cd.totalCOGS);
    if (Math.abs(_n(cd.sales) - r.sales) > 0.01 || Math.abs(_n(cd.totalCOGS) - r.totalCOGS) > 0.01) rowBad.push(r.soNo);
  });
  checks.push([`Σ Sales = ${_m(RS_EXP_SALES)}`, Math.abs(sumSales - RS_EXP_SALES) < 0.05, 'system: ' + _m(sumSales)]);
  checks.push([`Σ Total COGS = ${_m(RS_EXP_COGS)}`, Math.abs(sumCogs - RS_EXP_COGS) < 0.05, 'system: ' + _m(sumCogs)]);
  checks.push(['Every SO\'s sales + COGS match the file to the centavo', rowBad.length === 0,
    rowBad.length ? 'mismatched: ' + rowBad.join(', ') : '']);
  document.getElementById('verifyBody').innerHTML = checks.map(c =>
    `<tr><td>${c[1] ? '✅' : '❌'}</td><td>${c[0]}</td><td style="color:var(--text-muted,#64748b);">${flowEsc(c[2] || '')}</td></tr>`).join('');
}
