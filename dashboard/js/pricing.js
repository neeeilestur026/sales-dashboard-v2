/* ═══════════════════════════════════════════════
   pricing.js — Pricing Engine
   Client-side pricing calculator for management.
   Submit computed pricing to admin for review.
   ═══════════════════════════════════════════════ */

// ─── Static Data ────────────────────────────────

const PRINCIPALS = [
  { name: 'CEJN',              origin: 'Singapore',   currency: 'SGD', forex: 52, dutiesPct: 35 },
  { name: 'Snap-on',           origin: 'Singapore',   currency: 'USD', forex: 62, dutiesPct: 35 },
  { name: 'Blue-point',        origin: 'Singapore',   currency: 'USD', forex: 62, dutiesPct: 35 },
  { name: 'Local',             origin: 'Philippines',  currency: 'PHP', forex: 1,  dutiesPct: 7.5 },
  { name: 'SPX Powerteam',     origin: 'Singapore',   currency: 'USD', forex: 62, dutiesPct: 35 },
  { name: 'ABASCO',            origin: 'UAE',          currency: 'AED', forex: 17, dutiesPct: 35 },
  { name: 'RTS',               origin: 'Australia',    currency: 'AUD', forex: 45, dutiesPct: 35 },
  { name: 'Chicago Pneumatic', origin: 'Belgium',      currency: 'EUR', forex: 72, dutiesPct: 35 },
];

const DESTINATIONS = [
  { name: 'Albuera, Baybay', cbmRate: 4900, minCharge: 650 },
  { name: 'Bacolod', cbmRate: 3850, minCharge: 500 },
  { name: 'Baguio', cbmRate: 2500, minCharge: 440 },
  { name: 'Batangas', cbmRate: 2300, minCharge: 400 },
  { name: 'Bayugan, Medina, Gingoog', cbmRate: 4350, minCharge: 750 },
  { name: 'Benguet / Abra / Mountain Province', cbmRate: 3000, minCharge: 560 },
  { name: 'Bislig / Trento', cbmRate: 5300, minCharge: 750 },
  { name: 'Bulacan (Marilao, Obando, Meycuayan)', cbmRate: 1800, minCharge: 320 },
  { name: 'Butuan', cbmRate: 4250, minCharge: 550 },
  { name: 'Cabanatuan', cbmRate: 2100, minCharge: 370 },
  { name: 'Cabadbaran, Sibagat', cbmRate: 4350, minCharge: 750 },
  { name: 'Cagayan De Oro', cbmRate: 3950, minCharge: 550 },
  { name: 'Cavite & Rizal / Antipolo', cbmRate: 2100, minCharge: 360 },
  { name: 'Cebu', cbmRate: 3300, minCharge: 450 },
  { name: 'Compostela', cbmRate: 6500, minCharge: 750 },
  { name: 'Consolacion, Lapu-Lapu', cbmRate: 3350, minCharge: 500 },
  { name: 'Cotabato Via Davao', cbmRate: 7250, minCharge: 800 },
  { name: 'Dagupan', cbmRate: 2400, minCharge: 420 },
  { name: 'Davao', cbmRate: 4150, minCharge: 550 },
  { name: 'Dipolog', cbmRate: 3800, minCharge: 550 },
  { name: 'Don Carlos, Malaybalay, Maramag, Valencia', cbmRate: 5350, minCharge: 750 },
  { name: 'Dumaguete', cbmRate: 4000, minCharge: 500 },
  { name: 'Estancia / Balasan', cbmRate: 3900, minCharge: 550 },
  { name: 'Gen Santos', cbmRate: 4150, minCharge: 550 },
  { name: 'Iligan', cbmRate: 4150, minCharge: 600 },
  { name: 'Ilocos Sur / Ilocos Norte', cbmRate: 3000, minCharge: 500 },
  { name: 'Iloilo', cbmRate: 3750, minCharge: 500 },
  { name: 'Iriga, Daet, Goa', cbmRate: 3200, minCharge: 400 },
  { name: 'Irosin, Gubat, Matnog Bulan', cbmRate: 3950, minCharge: 480 },
  { name: 'Isabela', cbmRate: 2600, minCharge: 470 },
  { name: 'Isulan', cbmRate: 7100, minCharge: 750 },
  { name: 'Kabankalan', cbmRate: 4450, minCharge: 650 },
  { name: 'Kalibo', cbmRate: 3800, minCharge: 550 },
  { name: 'Kidapawan', cbmRate: 6250, minCharge: 750 },
  { name: 'Laguna', cbmRate: 2200, minCharge: 360 },
  { name: 'Legaspi', cbmRate: 2800, minCharge: 350 },
  { name: 'Ligao, Polangui, Guinobatan', cbmRate: 3200, minCharge: 400 },
  { name: 'Liloy, Sindanga, Dapitan', cbmRate: 5500, minCharge: 750 },
  { name: 'Lucena & Quezon Prov.', cbmRate: 2900, minCharge: 500 },
  { name: 'Maasin', cbmRate: 5000, minCharge: 550 },
  { name: 'Mactan, Talisay', cbmRate: 3350, minCharge: 500 },
  { name: 'Maranding, Buug, Molave', cbmRate: 4400, minCharge: 750 },
  { name: 'Marbel, Koronadal', cbmRate: 6100, minCharge: 750 },
  { name: 'Matalom, Bato, Sogod, Hilongos, Hindang Leyte', cbmRate: 5150, minCharge: 650 },
  { name: 'Merida, Isabel, Palompon, Villaba, Matag-Ob', cbmRate: 4900, minCharge: 650 },
  { name: 'Metro Manila', cbmRate: 1500, minCharge: 400 },
  { name: 'Mindoro', cbmRate: 3300, minCharge: 400 },
  { name: 'Nabunturan, Mati', cbmRate: 6200, minCharge: 750 },
  { name: 'Naga', cbmRate: 2800, minCharge: 350 },
  { name: 'Nueva Vizcaya / Cagayan Valley', cbmRate: 3000, minCharge: 560 },
  { name: 'Ormoc', cbmRate: 4300, minCharge: 500 },
  { name: 'Ozamis', cbmRate: 4000, minCharge: 550 },
  { name: 'Pagadian / Oroquieta', cbmRate: 4400, minCharge: 750 },
  { name: 'Palawan', cbmRate: 3350, minCharge: 500 },
  { name: 'Pangasinan / La Union', cbmRate: 2500, minCharge: 580 },
  { name: 'Polomolok', cbmRate: 5700, minCharge: 750 },
  { name: 'Quirino Province / Santiago / Tuguegarao', cbmRate: 2800, minCharge: 580 },
  { name: 'Roxas', cbmRate: 3550, minCharge: 550 },
  { name: 'San Carlos', cbmRate: 4800, minCharge: 700 },
  { name: 'San Francisco, Prosperidad, Barobo, Surigao Del Sur', cbmRate: 4750, minCharge: 750 },
  { name: 'Sibugay Province', cbmRate: 6500, minCharge: 750 },
  { name: 'Sorsogon', cbmRate: 3250, minCharge: 420 },
  { name: 'Surigao', cbmRate: 5550, minCharge: 550 },
  { name: 'Tabaco, Tiwi', cbmRate: 3200, minCharge: 400 },
  { name: 'Tacloban', cbmRate: 4200, minCharge: 650 },
  { name: 'Tacurong, Surallah', cbmRate: 6700, minCharge: 750 },
  { name: 'Tagaloan, Balingasag', cbmRate: 4050, minCharge: 750 },
  { name: 'Tagbilaran', cbmRate: 3500, minCharge: 450 },
  { name: 'Tagum, Panabo, Carmen, Digos, Bansalan, Padada', cbmRate: 5700, minCharge: 750 },
  { name: 'Tarlac / Nueva Ecija', cbmRate: 2400, minCharge: 460 },
  { name: 'Zambales / Pampanga / Bataan', cbmRate: 2700, minCharge: 500 },
  { name: 'Zamboanga', cbmRate: 4800, minCharge: 550 },
];

// ─── State ──────────────────────────────────────

let session = null;
let lineItems = [];
let nextId = 1;
let results = [];
let currentSubmissionId = null;
let currentPrRefsJson = '';
let _priceHistoryMap = {};    // { modelNo: {unitPriceVatEx, date, client, principal} }
let _currentClientName = '';
let _allHistorySubs = [];     // cached for filtering

// ─── Helpers ────────────────────────────────────

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function peso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt(n) { return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function getSelectedPrincipal() {
  const idx = document.getElementById('principalSelect').value;
  return idx !== '' ? PRINCIPALS[idx] : null;
}

function getSelectedDestination() {
  const idx = document.getElementById('destSelect').value;
  return idx !== '' ? DESTINATIONS[idx] : null;
}

function getRate(id, fallback) {
  return parseFloat(document.getElementById(id).value) || fallback;
}

function getForexRate(principal) {
  const el = document.getElementById('forexRateInput');
  const v = el ? parseFloat(el.value) : NaN;
  if (isFinite(v) && v > 0) return v;
  return principal && principal.forex ? principal.forex : 1;
}

function getDutiesPct(principal) {
  const el = document.getElementById('dutiesPctInput');
  const v = el ? parseFloat(el.value) : NaN;
  if (isFinite(v) && v >= 0) return v;
  return principal && isFinite(principal.dutiesPct) ? principal.dutiesPct : 0;
}

// ─── Calculation Engine ─────────────────────────

function calculateItem(item, principal, destination, commissionPct, marginPct) {
  const LOCAL_TAX_PCT = 0.02;
  const VAT_PCT = 0.12;

  const buyPrice = parseFloat(item.buyPrice) || 0;
  const discount = parseFloat(item.discount) || 0;
  const qty = parseFloat(item.qty) || 0;
  const cbm = parseFloat(item.cbm) || 0;

  const effectiveBuyPrice = buyPrice * (1 - discount / 100);
  const buyPriceTotal = effectiveBuyPrice * qty;
  const forexRate = getForexRate(principal);
  const buyPricePHP = buyPriceTotal * forexRate;
  const dutiesPct = getDutiesPct(principal);
  const brokerage = buyPricePHP * (dutiesPct / 100);
  const landedCost = buyPricePHP + brokerage;

  let deliveryCost = 0;
  if (cbm > 0 && destination) {
    deliveryCost = Math.max(cbm * destination.cbmRate, destination.minCharge);
  }

  const totalCOGS = landedCost + deliveryCost;

  const denom = 1 - (commissionPct / 100) - (marginPct / 100) - LOCAL_TAX_PCT;
  const netSellingPrice = denom > 0 ? totalCOGS / denom : 0;

  const commission = netSellingPrice * (commissionPct / 100);
  const profitMargin = netSellingPrice * (marginPct / 100);
  const localTax = netSellingPrice * LOCAL_TAX_PCT;
  const vat = netSellingPrice * VAT_PCT;
  const finalPrice = netSellingPrice + vat;
  const unitPrice = qty > 0 ? finalPrice / qty : 0;
  const unitPriceVatEx = qty > 0 ? netSellingPrice / qty : 0;

  return {
    modelNo: item.modelNo, name: item.name, qty, buyPrice, discount, cbm,
    effectiveBuyPrice, buyPriceTotal, buyPricePHP, brokerage, landedCost, deliveryCost,
    totalCOGS, netSellingPrice, commission, profitMargin, localTax,
    vat, finalPrice, unitPrice, unitPriceVatEx
  };
}

// ─── UI: Config Panel ───────────────────────────

function initConfig() {
  const pSelect = document.getElementById('principalSelect');
  const dSelect = document.getElementById('destSelect');

  PRINCIPALS.forEach((p, i) => {
    pSelect.innerHTML += `<option value="${i}">${esc(p.name)} (${esc(p.currency)})</option>`;
  });

  DESTINATIONS.forEach((d, i) => {
    dSelect.innerHTML += `<option value="${i}">${esc(d.name)}</option>`;
  });

  pSelect.addEventListener('change', () => { updateReadouts(true); recalculate(); });
  dSelect.addEventListener('change', () => { updateReadouts(); recalculate(); });
  document.getElementById('commissionRate').addEventListener('input', recalculate);
  document.getElementById('marginRate').addEventListener('input', recalculate);
  const forexInput = document.getElementById('forexRateInput');
  if (forexInput) forexInput.addEventListener('input', recalculate);
  const dutiesInput = document.getElementById('dutiesPctInput');
  if (dutiesInput) dutiesInput.addEventListener('input', recalculate);

  updateReadouts(true);
}

function updateReadouts(resetForex) {
  const p = getSelectedPrincipal();
  const d = getSelectedDestination();

  document.getElementById('rdCurrency').textContent = p ? p.currency : '—';
  const forexInput = document.getElementById('forexRateInput');
  const forexPrefix = document.getElementById('rdForexPrefix');
  if (forexPrefix) forexPrefix.textContent = p ? `1 ${p.currency} = ₱` : '1 — = ₱';
  if (forexInput) {
    if (resetForex || !forexInput.value) {
      forexInput.value = p ? p.forex : '';
    }
    forexInput.disabled = !p;
  }
  document.getElementById('rdDuties') && (document.getElementById('rdDuties').textContent = p ? `${p.dutiesPct}%` : '—');
  const dutiesInput = document.getElementById('dutiesPctInput');
  if (dutiesInput) {
    if (resetForex || dutiesInput.value === '') {
      dutiesInput.value = p ? p.dutiesPct : '';
    }
    dutiesInput.disabled = !p;
  }
  document.getElementById('rdOrigin').textContent = p ? p.origin : '—';
  document.getElementById('rdCbmRate').textContent = d ? peso(d.cbmRate) + '/CBM' : '—';
  document.getElementById('rdMinCharge').textContent = d ? peso(d.minCharge) : '—';
}

// ─── UI: Line Items ─────────────────────────────

function addItem() {
  lineItems.push({ id: nextId++, modelNo: '', name: '', buyPrice: '', discount: 0, qty: 1, cbm: 0 });
  renderLineItems();
}

function removeItem(id) {
  lineItems = lineItems.filter(i => i.id !== id);
  renderLineItems();
  recalculate();
}

function syncItemFromRow(id) {
  const item = lineItems.find(i => i.id === id);
  if (!item) return;
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;
  item.modelNo = row.querySelector('.inp-model').value;
  item.name = row.querySelector('.inp-name').value;
  item.buyPrice = row.querySelector('.inp-price').value;
  item.discount = row.querySelector('.inp-discount').value;
  item.qty = row.querySelector('.inp-qty').value;
  item.cbm = row.querySelector('.inp-cbm').value;
}

function syncAllItems() {
  lineItems.forEach(item => syncItemFromRow(item.id));
}

function renderLineItems() {
  const tbody = document.getElementById('itemsBody');
  if (lineItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No items added. Click "Add Item" to begin.</td></tr>`;
    return;
  }

  tbody.innerHTML = lineItems.map((item, idx) => `
    <tr data-id="${item.id}">
      <td style="text-align:center;color:var(--text-muted);">${idx + 1}</td>
      <td><input type="text" class="inp-model" value="${esc(item.modelNo)}" placeholder="Model No." oninput="syncItemFromRow(${item.id})" onchange="recalculate()"></td>
      <td><input type="text" class="inp-name" value="${esc(item.name)}" placeholder="Item description" oninput="syncItemFromRow(${item.id})" onchange="recalculate()">${item.prItemDescription && item.prItemDescription !== item.name ? `<div style="font-size:0.7rem;color:#94a3b8;margin-top:0.15rem;" title="Original PR description">PR: ${esc(item.prItemDescription)}</div>` : ''}${item.supplierCompany ? `<div style="font-size:0.68rem;color:#f97316;margin-top:0.1rem;">Supplier: ${esc(item.supplierCompany)}</div>` : ''}${item.driveFolderLink ? `<a href="#" onclick="openDocPreview('${esc(item.driveFolderLink)}');return false;" style="font-size:0.68rem;color:#3b82f6;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;margin-top:0.15rem;cursor:pointer;" title="View supporting documents"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> View Docs</a>` : ''}</td>
      <td><input type="number" class="inp-price" value="${esc(item.buyPrice)}" placeholder="0.00" min="0" step="any" oninput="syncItemFromRow(${item.id})" onchange="recalculate()"></td>
      <td><input type="number" class="inp-discount" value="${esc(item.discount)}" placeholder="0" min="0" max="100" step="any" oninput="syncItemFromRow(${item.id})" onchange="recalculate()"></td>
      <td><input type="number" class="inp-qty" value="${esc(item.qty)}" placeholder="1" min="0" step="any" oninput="syncItemFromRow(${item.id})" onchange="recalculate()"></td>
      <td><input type="number" class="inp-cbm" value="${esc(item.cbm)}" placeholder="0" min="0" step="any" oninput="syncItemFromRow(${item.id})" onchange="recalculate()"></td>
      <td style="text-align:center;">
        <button class="btn-remove" onclick="removeItem(${item.id})" title="Remove item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

// ─── UI: Results Table ──────────────────────────

function recalculate() {
  syncAllItems();
  const p = getSelectedPrincipal();
  const d = getSelectedDestination();
  const commPct = getRate('commissionRate', 5);
  const margPct = getRate('marginRate', 30);

  const resultsEl = document.getElementById('resultsBody');
  const plEl = document.getElementById('plSummary');
  const emptyMsg = 16; // colspan count

  if (!p) {
    resultsEl.innerHTML = `<tr><td colspan="${emptyMsg}" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Select a principal to see results.</td></tr>`;
    plEl.innerHTML = '';
    return;
  }

  const validItems = lineItems.filter(i => (parseFloat(i.buyPrice) || 0) > 0);
  if (validItems.length === 0) {
    resultsEl.innerHTML = `<tr><td colspan="${emptyMsg}" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Add items with buy prices to see results.</td></tr>`;
    plEl.innerHTML = '';
    return;
  }

  if ((commPct / 100) + (margPct / 100) + 0.02 > 1) {
    resultsEl.innerHTML = `<tr><td colspan="${emptyMsg}" style="text-align:center;color:#ef4444;padding:1.5rem;">Commission + Profit Margin + 2% Local Tax must be less than 100%.</td></tr>`;
    plEl.innerHTML = '';
    return;
  }

  results = validItems.map(item => calculateItem(item, p, d, commPct, margPct));

  resultsEl.innerHTML = results.map((r, idx) => {
    const hist = _priceHistoryMap[r.modelNo];
    const histCell = hist
      ? `<td class="td-num last-price-hint" title="Client: ${esc(hist.client)} · ${esc(hist.date.slice(0,10))}">${peso(hist.unitPriceVatEx)}<br><span style="font-size:0.62rem;opacity:0.7;">${esc(hist.date.slice(0,10))}</span></td>`
      : '<td class="td-num" style="color:var(--text-muted);font-size:0.75rem;">—</td>';
    return `
    <tr>
      <td>${idx + 1}</td>
      <td class="td-name">${esc(r.modelNo) || '<em>—</em>'}</td>
      <td class="td-name">${esc(r.name) || '<em>—</em>'}</td>
      <td class="td-num">${fmt(r.qty)}</td>
      <td class="td-num">${r.discount > 0 ? r.discount + '%' : '—'}</td>
      <td class="td-num">${peso(r.buyPricePHP)}</td>
      <td class="td-num">${peso(r.brokerage)}</td>
      <td class="td-num">${peso(r.landedCost)}</td>
      <td class="td-num">${peso(r.deliveryCost)}</td>
      <td class="td-num" style="font-weight:600;">${peso(r.totalCOGS)}</td>
      <td class="td-num">${peso(r.commission)}</td>
      <td class="td-num">${peso(r.profitMargin)}</td>
      <td class="td-num" style="font-weight:600;color:#22c55e;">${peso(r.unitPriceVatEx)}</td>
      <td class="td-num" style="font-weight:700;color:var(--accent);">${peso(r.unitPrice)}</td>
      <td class="td-num">${peso(r.finalPrice)}</td>
      ${histCell}
    </tr>`;
  }).join('');

  renderPL(results, commPct, margPct);
}

// ─── UI: P&L Summary ───────────────────────────

function renderPL(results, commPct, margPct) {
  const plEl = document.getElementById('plSummary');
  if (!results.length) { plEl.innerHTML = ''; return; }

  const totals = {
    revenue: 0, vat: 0, netSales: 0, cogs: 0, grossProfit: 0,
    commission: 0, localTax: 0, delivery: 0, totalExpenses: 0,
    operatingIncome: 0, incomeTax: 0, netIncome: 0
  };

  results.forEach(r => {
    totals.revenue += r.finalPrice;
    totals.vat += r.vat;
    totals.netSales += r.netSellingPrice;
    totals.cogs += r.landedCost;
    totals.commission += r.commission;
    totals.localTax += r.localTax;
    totals.delivery += r.deliveryCost;
  });

  totals.grossProfit = totals.netSales - totals.cogs;
  totals.totalExpenses = totals.commission + totals.localTax + totals.delivery;
  totals.operatingIncome = totals.grossProfit - totals.totalExpenses;
  totals.incomeTax = totals.operatingIncome * 0.25;
  totals.netIncome = totals.operatingIncome - totals.incomeTax;

  const pctOf = (val) => totals.netSales > 0 ? ((val / totals.netSales) * 100).toFixed(1) + '%' : '—';

  plEl.innerHTML = `
    <div class="pl-kpis">
      <div class="pl-kpi">
        <span class="pl-kpi-label">Gross Revenue (incl. VAT)</span>
        <span class="pl-kpi-value">${peso(totals.revenue)}</span>
        <span class="pl-kpi-pct">112%</span>
      </div>
      <div class="pl-kpi">
        <span class="pl-kpi-label">Net Sales (excl. VAT)</span>
        <span class="pl-kpi-value">${peso(totals.netSales)}</span>
        <span class="pl-kpi-pct">100%</span>
      </div>
      <div class="pl-kpi">
        <span class="pl-kpi-label">Total COGS</span>
        <span class="pl-kpi-value" style="color:#f97316;">${peso(totals.cogs)}</span>
        <span class="pl-kpi-pct">${pctOf(totals.cogs)}</span>
      </div>
      <div class="pl-kpi">
        <span class="pl-kpi-label">Gross Profit</span>
        <span class="pl-kpi-value" style="color:#22c55e;">${peso(totals.grossProfit)}</span>
        <span class="pl-kpi-pct">${pctOf(totals.grossProfit)}</span>
      </div>
      <div class="pl-kpi">
        <span class="pl-kpi-label">Operating Income</span>
        <span class="pl-kpi-value" style="color:#3b82f6;">${peso(totals.operatingIncome)}</span>
        <span class="pl-kpi-pct">${pctOf(totals.operatingIncome)}</span>
      </div>
      <div class="pl-kpi">
        <span class="pl-kpi-label">Net Income</span>
        <span class="pl-kpi-value" style="color:#a855f7;">${peso(totals.netIncome)}</span>
        <span class="pl-kpi-pct">${pctOf(totals.netIncome)}</span>
      </div>
    </div>

    <table class="pl-table">
      <thead><tr><th>Line Item</th><th>Amount</th><th>% of Net Sales</th></tr></thead>
      <tbody>
        <tr><td>Sales, Gross of VAT</td><td class="td-num">${peso(totals.revenue)}</td><td class="td-num">112.0%</td></tr>
        <tr><td>Less: VAT (12%)</td><td class="td-num" style="color:#ef4444;">(${peso(totals.vat)})</td><td class="td-num">12.0%</td></tr>
        <tr class="pl-bold"><td>Sales, Net of VAT</td><td class="td-num">${peso(totals.netSales)}</td><td class="td-num">100.0%</td></tr>
        <tr><td>Cost of Goods Sold</td><td class="td-num" style="color:#f97316;">(${peso(totals.cogs)})</td><td class="td-num">${pctOf(totals.cogs)}</td></tr>
        <tr class="pl-bold"><td>Gross Profit</td><td class="td-num" style="color:#22c55e;">${peso(totals.grossProfit)}</td><td class="td-num">${pctOf(totals.grossProfit)}</td></tr>
        <tr><td>Commission (${commPct}%)</td><td class="td-num">(${peso(totals.commission)})</td><td class="td-num">${pctOf(totals.commission)}</td></tr>
        <tr><td>Local Tax (2%)</td><td class="td-num">(${peso(totals.localTax)})</td><td class="td-num">${pctOf(totals.localTax)}</td></tr>
        <tr><td>Delivery</td><td class="td-num">(${peso(totals.delivery)})</td><td class="td-num">${pctOf(totals.delivery)}</td></tr>
        <tr class="pl-bold"><td>Operating Income</td><td class="td-num" style="color:#3b82f6;">${peso(totals.operatingIncome)}</td><td class="td-num">${pctOf(totals.operatingIncome)}</td></tr>
        <tr><td>Income Tax (25%)</td><td class="td-num">(${peso(totals.incomeTax)})</td><td class="td-num">${pctOf(totals.incomeTax)}</td></tr>
        <tr class="pl-bold pl-final"><td>NET INCOME</td><td class="td-num" style="color:#a855f7;">${peso(totals.netIncome)}</td><td class="td-num">${pctOf(totals.netIncome)}</td></tr>
      </tbody>
    </table>
  `;
}

// ─── Submit to Admin ────────────────────────────

async function submitToAdmin() {
  if (!results.length) { alert('Calculate items first before submitting.'); return; }
  const isUpdate = !!currentSubmissionId;
  const msg = isUpdate
    ? 'Update this pricing submission? The previous version will be overwritten.'
    : 'Submit this pricing to admin? Admin will see model numbers, descriptions, and final prices.';
  if (!confirm(msg)) return;

  const p = getSelectedPrincipal();
  const d = getSelectedDestination();
  const commPct = getRate('commissionRate', 5);
  const margPct = getRate('marginRate', 30);

  const items = results.map(r => {
    const round2 = n => Math.round((n || 0) * 100) / 100;
    return {
      modelNo:         r.modelNo || '',
      name:            r.name || '',
      qty:             r.qty,
      buyPrice:        round2(r.buyPrice),
      discount:        r.discount || 0,
      cbm:             r.cbm || 0,
      buyPricePHP:     round2(r.buyPricePHP),
      brokerage:       round2(r.brokerage),
      landedCost:      round2(r.landedCost),
      deliveryCost:    round2(r.deliveryCost),
      totalCOGS:       round2(r.totalCOGS),
      netSellingPrice: round2(r.netSellingPrice),
      commission:      round2(r.commission),
      profitMargin:    round2(r.profitMargin),
      localTax:        round2(r.localTax),
      vat:             round2(r.vat),
      finalPrice:      round2(r.finalPrice),
      unitPrice:       round2(r.unitPrice),
      unitPriceVatEx:  round2(r.unitPriceVatEx)
    };
  });

  const payload = {
    principal: p ? p.name : '',
    destination: d ? d.name : '',
    submittedBy: session ? session.name : '',
    itemsJson: JSON.stringify(items),
    commissionPct: String(commPct),
    marginPct: String(margPct)
  };

  if (isUpdate) {
    payload.existingId = currentSubmissionId;
  }
  if (currentPrRefsJson) {
    payload.prRefsJson = currentPrRefsJson;
  }

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.textContent = isUpdate ? 'Updating...' : 'Submitting...';

  try {
    const res = await apiSavePricingSubmission(payload);
    if (res.success) {
      alert(isUpdate ? 'Pricing updated successfully!' : 'Pricing submitted to admin successfully!');
      currentSubmissionId = null;
      currentPrRefsJson = '';
      updateEditBanner();
      loadMySubmissions();
    } else {
      alert('Failed: ' + (res.message || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Submit to Admin`;
  }
}

// ─── Clear All ──────────────────────────────────

function clearAll() {
  if (lineItems.length && !confirm('Clear all items and reset?')) return;
  lineItems = [];
  results = [];
  nextId = 1;
  currentSubmissionId = null;
  currentPrRefsJson = '';
  document.getElementById('principalSelect').value = '';
  document.getElementById('destSelect').value = '';
  document.getElementById('commissionRate').value = 5;
  document.getElementById('marginRate').value = 30;
  updateReadouts();
  renderLineItems();
  updateEditBanner();
  document.getElementById('resultsBody').innerHTML = `<tr><td colspan="15" style="text-align:center;color:var(--text-muted);padding:1.5rem;">Select a principal and add items to begin.</td></tr>`;
  document.getElementById('plSummary').innerHTML = '';
}

// ─── Edit Banner ───────────────────────────────

function updateEditBanner() {
  const banner = document.getElementById('editBanner');
  if (!banner) return;
  if (currentSubmissionId) {
    banner.style.display = 'flex';
    banner.querySelector('.edit-banner-id').textContent = currentSubmissionId;
  } else {
    banner.style.display = 'none';
  }
}

function cancelEdit() {
  currentSubmissionId = null;
  currentPrRefsJson = '';
  updateEditBanner();
}

// ─── Forwarded from Admin ──────────────────────

// localStorage key for IDs the current management user has hidden locally.
// Hiding does NOT delete the submission on the backend — it only filters
// the list rendered in this dashboard for this browser.
const FWD_HIDDEN_KEY = 'pricing.forwardedHiddenIds';

function _getHiddenForwardedIds() {
  try {
    var raw = localStorage.getItem(FWD_HIDDEN_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function _setHiddenForwardedIds(ids) {
  try { localStorage.setItem(FWD_HIDDEN_KEY, JSON.stringify(ids || [])); } catch (e) {}
}

async function loadForwarded() {
  const container = document.getElementById('forwardedList');
  if (!container) return;
  try {
    const res = await apiGetPricingSubmissions('Forwarded');
    if (!res.success) { container.innerHTML = '<p style="color:var(--text-muted);">Failed to load.</p>'; return; }
    const allSubs = res.data || [];
    const hiddenIds = _getHiddenForwardedIds();
    const subs = hiddenIds.length
      ? allSubs.filter(s => hiddenIds.indexOf(String(s.id)) === -1)
      : allSubs;
    if (subs.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">No forwarded items from admin.</p>';
      return;
    }
    container.innerHTML = subs.map(s => {
      let items = [];
      try { items = JSON.parse(s.itemsJson); } catch {}
      let prRefs = [];
      try { prRefs = JSON.parse(s.prRefsJson || '[]'); } catch {}
      const clients = [...new Set(prRefs.map(r => r.clientName).filter(Boolean))];
      const agents = [...new Set(prRefs.map(r => r.agentName).filter(Boolean))];
      const clientLabel = clients.length ? clients.join(', ') : 'Unknown client';
      const agentLabel = agents.length ? agents.join(', ') : '';
      const suppliers = [...new Set(items.map(it => it.supplierCompany).filter(Boolean))];
      const supplierLabel = suppliers.length ? suppliers.join(', ') : '';
      const driveLinks = [...new Set(items.map(it => it.driveFolderLink).filter(Boolean))];
      return `
        <div class="fwd-card" id="fwd-card-${esc(s.id)}">
          <div class="fwd-header">
            <span class="fwd-id">${esc(s.id)}</span>
            <span class="fwd-meta">${esc(s.forwardedBy)} &middot; ${esc(s.date)} &middot; ${esc(s.principal || 'No principal')}</span>
          </div>
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary,#f1f5f9);margin-bottom:0.25rem;">Client: ${esc(clientLabel)}${agentLabel ? ' <span style="font-weight:400;color:var(--text-secondary,#94a3b8);">(Agent: ' + esc(agentLabel) + ')</span>' : ''}</div>
          ${supplierLabel ? '<div style="font-size:0.8rem;color:#f97316;margin-bottom:0.25rem;">Supplier: ' + esc(supplierLabel) + '</div>' : ''}
          ${driveLinks.length ? '<div style="margin-bottom:0.25rem;">' + driveLinks.map(link => '<a href="#" onclick="openDocPreview(\'' + esc(link) + '\');return false;" style="font-size:0.78rem;color:#3b82f6;text-decoration:none;display:inline-flex;align-items:center;gap:0.2rem;margin-right:0.5rem;cursor:pointer;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> View Docs</a>').join('') + '</div>' : ''}
          <div class="fwd-items">${items.length} item${items.length !== 1 ? 's' : ''}: ${items.map(it => esc(it.modelPartNo || it.modelNo || it.name || 'Item')).join(', ')}</div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;">
            <button class="btn-add" onclick="loadSubmission('${esc(s.id)}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Load into Calculator
            </button>
            <button class="btn-add" onclick="removeForwardedCard('${esc(s.id)}')" style="background:#ef4444;border-color:#ef4444;" title="Hide this entry from the list">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Remove
            </button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p style="color:#ef4444;font-size:0.82rem;">Error loading forwarded items.</p>';
  }
}

// Local-only removal: hides the forwarded entry from this dashboard's view so
// the list looks clean. Persists the hidden ID in localStorage so it stays
// hidden after refresh. Does NOT delete the submission on the backend — admin
// records and Google Sheet rows are untouched.
function removeForwardedCard(id) {
  var sid = String(id);
  var hidden = _getHiddenForwardedIds();
  if (hidden.indexOf(sid) === -1) {
    hidden.push(sid);
    _setHiddenForwardedIds(hidden);
  }
  var card = document.getElementById('fwd-card-' + sid);
  if (card) card.remove();
  var container = document.getElementById('forwardedList');
  if (container && !container.querySelector('.fwd-card')) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">No forwarded items from admin.</p>';
  }
}

// ─── My Past Submissions ───────────────────────

async function loadMySubmissions() {
  const container = document.getElementById('mySubmissionsList');
  if (!container) return;
  try {
    const res = await apiGetPricingSubmissions();
    if (!res.success) { container.innerHTML = '<p style="color:var(--text-muted);">Failed to load.</p>'; return; }
    const myName = session ? session.name : '';
    const subs = (res.data || []).filter(s => s.submittedBy === myName && (s.status === 'Pending' || s.status === 'Priced'));
    if (subs.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">No editable submissions.</p>';
      return;
    }
    container.innerHTML = subs.map(s => {
      let items = [];
      try { items = JSON.parse(s.itemsJson); } catch {}
      let prRefs = [];
      try { prRefs = JSON.parse(s.prRefsJson || '[]'); } catch {}
      const clients = [...new Set(prRefs.map(r => r.clientName).filter(Boolean))];
      const clientLabel = clients.length ? 'Client: ' + clients.join(', ') : '';
      const badge = s.status === 'Priced' ? 'badge-priced' : 'badge-pending';
      return `
        <div class="fwd-card">
          <div class="fwd-header">
            <span class="fwd-id">${esc(s.id)} <span class="${badge}">${esc(s.status)}</span></span>
            <span class="fwd-meta">${esc(s.date)}${s.updatedDate ? ' (edited ' + esc(s.updatedDate) + ')' : ''} &middot; ${esc(s.principal || '')}</span>
          </div>
          ${clientLabel ? `<div style="font-size:0.82rem;font-weight:600;color:var(--text-primary,#f1f5f9);margin-bottom:0.15rem;">${esc(clientLabel)}</div>` : ''}
          <div class="fwd-items">${items.length} item${items.length !== 1 ? 's' : ''}</div>
          <button class="btn-add" onclick="loadSubmission('${esc(s.id)}')" style="margin-top:0.5rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit / Revise
          </button>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p style="color:#ef4444;font-size:0.82rem;">Error loading submissions.</p>';
  }
}

// ─── Load Submission into Calculator ───────────

async function loadSubmission(id) {
  try {
    const res = await apiGetPricingSubmissions();
    if (!res.success) { alert('Failed to load submission'); return; }
    const sub = (res.data || []).find(s => s.id === id);
    if (!sub) { alert('Submission not found'); return; }

    // Set editing state
    currentSubmissionId = sub.id;
    currentPrRefsJson = sub.prRefsJson || '';

    // Load price history for client from prRefs
    _priceHistoryMap = {};
    _currentClientName = '';
    try {
      const refs = JSON.parse(sub.prRefsJson || '[]');
      const clients = [...new Set(refs.map(r => r.clientName).filter(Boolean))];
      if (clients.length) {
        _currentClientName = clients[0];
        const histRes = await apiGetPriceHistory(_currentClientName);
        if (histRes.success) {
          (histRes.data || []).forEach(h => { _priceHistoryMap[h.modelNo] = h; });
        }
      }
    } catch (e) {}

    // Set principal
    const pIdx = PRINCIPALS.findIndex(p => p.name === sub.principal);
    document.getElementById('principalSelect').value = pIdx >= 0 ? pIdx : '';

    // Set destination
    const dIdx = DESTINATIONS.findIndex(d => d.name === sub.destination);
    document.getElementById('destSelect').value = dIdx >= 0 ? dIdx : '';

    // Set rates
    if (sub.commissionPct) document.getElementById('commissionRate').value = sub.commissionPct;
    if (sub.marginPct) document.getElementById('marginRate').value = sub.marginPct;

    updateReadouts(true);

    // Parse items
    let items = [];
    try { items = JSON.parse(sub.itemsJson); } catch {}

    lineItems = items.map((it, i) => ({
      id: i + 1,
      modelNo: it.modelPartNo || it.modelNo || '',
      name: it.itemDescription || it.name || '',
      buyPrice: it.buyPrice || '',
      discount: it.discount || 0,
      qty: it.quantity || it.qty || 1,
      cbm: it.cbm || 0,
      supplierDescription: it.supplierDescription || '',
      supplierCompany: it.supplierCompany || '',
      prItemDescription: it.prItemDescription || '',
      driveFolderLink: it.driveFolderLink || ''
    }));
    nextId = lineItems.length + 1;

    renderLineItems();
    recalculate();
    updateEditBanner();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    alert('Error loading submission: ' + err.message);
  }
}

// ─── Init ───────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  session = requireAdminOrManagement();
  if (!session) return;
  renderNavbar('pricing');
  initConfig();
  renderLineItems();
  loadForwarded();
  loadMySubmissions();
  loadPricingHistory();
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeDocPreview(); });
});

// ─── Pricing History Section ─────────────────────

function toggleHistorySection() {
  const content = document.getElementById('pricingHistoryContent');
  const icon = document.getElementById('histToggleIcon');
  if (!content) return;
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : '';
  if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
}

async function loadPricingHistory() {
  const container = document.getElementById('pricingHistoryList');
  if (!container) return;
  try {
    const res = await apiGetPricingSubmissions();
    if (!res.success) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">Failed to load.</p>'; return; }
    _allHistorySubs = (res.data || []).filter(s => ['Priced','Applied','Sent to Sales'].includes(s.status));
    _renderHistoryTable(_allHistorySubs);
  } catch (err) {
    container.innerHTML = '<p style="color:#ef4444;font-size:0.82rem;">Error loading history.</p>';
  }
}

function applyHistoryFilter() {
  const client = (document.getElementById('histClientFilter').value || '').toLowerCase().trim();
  const month  = document.getElementById('histMonthFilter').value || '';
  const status = document.getElementById('histStatusFilter').value || '';
  const filtered = _allHistorySubs.filter(s => {
    if (status && s.status !== status) return false;
    if (month  && String(s.date || '').slice(0, 7) !== month) return false;
    if (client) {
      let prRefs = [];
      try { prRefs = JSON.parse(s.prRefsJson || '[]'); } catch {}
      const clients = prRefs.map(r => (r.clientName || '').toLowerCase());
      if (!clients.some(c => c.includes(client))) return false;
    }
    return true;
  });
  _renderHistoryTable(filtered);
}

function clearHistoryFilters() {
  ['histClientFilter','histMonthFilter','histStatusFilter'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  _renderHistoryTable(_allHistorySubs);
}

function _histBadge(status) {
  const map = {
    'Priced': 'badge-priced', 'Applied': 'badge-applied',
    'Sent to Sales': 'badge-sent', 'Pending': 'badge-pending', 'Forwarded': 'badge-forwarded'
  };
  return '<span class="' + (map[status] || 'badge-pending') + '">' + esc(status) + '</span>';
}

function _renderHistoryTable(subs) {
  const container = document.getElementById('pricingHistoryList');
  if (!container) return;
  if (!subs.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:1rem;">No pricing history found.</p>';
    return;
  }

  const thStyle = 'text-align:left;padding:0.3rem 0.5rem;color:var(--text-muted,#64748b);font-size:0.67rem;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0;white-space:nowrap;';
  const tdBase = 'padding:0.35rem 0.5rem;border-bottom:1px solid #e2e8f0;font-size:0.76rem;';
  const tdNum = tdBase + 'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;';

  let html = '<div style="overflow-x:auto;"><table class="hist-table"><thead><tr>' +
    ['Date','Client','Principal','Destination','Items','Comm.','Margin','Status',''].map(h =>
      '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>';

  subs.forEach(function(s, si) {
    let items = [];
    try { items = JSON.parse(s.itemsJson); } catch {}
    let prRefs = [];
    try { prRefs = JSON.parse(s.prRefsJson || '[]'); } catch {}
    const clients = [...new Set(prRefs.map(r => r.clientName).filter(Boolean))];
    const clientLabel = clients.length ? clients.join(', ') : '—';
    const commPct = parseFloat(s.commissionPct) || 0;
    const margPct = parseFloat(s.marginPct) || 0;

    // Compute P&L totals from stored item fields
    let totRevenue = 0, totVat = 0, totNetSales = 0, totCOGS = 0;
    let totCommission = 0, totLocalTax = 0, totDelivery = 0;
    items.forEach(function(it) {
      totRevenue   += parseFloat(it.finalPrice)      || ((parseFloat(it.unitPriceVatEx) || 0) * (parseFloat(it.qty) || 1) * 1.12);
      totVat       += parseFloat(it.vat)             || 0;
      totNetSales  += parseFloat(it.netSellingPrice) || 0;
      totCOGS      += parseFloat(it.landedCost)      || 0;
      totCommission += parseFloat(it.commission)     || 0;
      totLocalTax  += parseFloat(it.localTax)        || 0;
      totDelivery  += parseFloat(it.deliveryCost)    || 0;
    });
    const totGP   = totNetSales - totCOGS;
    const totOpInc = totGP - totCommission - totLocalTax - totDelivery;
    const totTax  = totOpInc * 0.25;
    const totNet  = totOpInc - totTax;
    const hasFull = items.some(function(it) { return parseFloat(it.buyPrice) > 0 || parseFloat(it.landedCost) > 0; });

    // Summary row
    html += '<tr style="cursor:pointer;" onclick="_toggleHistItems(' + si + ')">' +
      '<td style="white-space:nowrap;color:var(--text-muted);font-size:0.78rem;">' + esc(String(s.date || '').slice(0,16)) + '</td>' +
      '<td style="font-weight:600;color:var(--text-primary,#f1f5f9);">' + esc(clientLabel) + '</td>' +
      '<td style="color:var(--text-secondary,#94a3b8);">' + esc(s.principal || '—') + '</td>' +
      '<td style="color:var(--text-secondary,#94a3b8);font-size:0.78rem;">' + esc(s.destination || '—') + '</td>' +
      '<td style="color:var(--text-muted);font-size:0.78rem;">' + items.length + ' item' + (items.length !== 1 ? 's' : '') +
        (totRevenue > 0 ? '<br><span style="color:#22c55e;font-size:0.72rem;">' + peso(totRevenue) + '</span>' : '') + '</td>' +
      '<td style="color:var(--text-muted);font-size:0.78rem;">' + (commPct || '—') + (commPct ? '%' : '') + '</td>' +
      '<td style="color:var(--text-muted);font-size:0.78rem;">' + (margPct || '—') + (margPct ? '%' : '') + '</td>' +
      '<td>' + _histBadge(s.status) + '</td>' +
      '<td><button class="hist-expand-btn" id="histBtn' + si + '">▸</button></td>' +
    '</tr>';

    // Expanded detail row
    html += '<tr class="hist-items-row" id="histItems' + si + '" style="display:none;"><td colspan="9" style="padding:0;">' +
      '<div class="hist-items-inner" style="padding:0.75rem 1rem;">';

    // Config strip
    html += '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;padding:0.5rem 0.75rem;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">' +
      _histChip('Supplier', s.principal || '—') +
      _histChip('Destination', s.destination || '—') +
      _histChip('Commission', (commPct || '—') + (commPct ? '%' : '')) +
      _histChip('Profit Margin', (margPct || '—') + (margPct ? '%' : '')) +
      _histChip('Client', clientLabel) +
    '</div>';

    if (items.length) {
      // Pricing breakdown table
      html += '<div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#64748b);margin-bottom:0.35rem;">Pricing Breakdown</div>';
      html += '<div style="overflow-x:auto;margin-bottom:0.9rem;">' +
        '<table style="width:100%;border-collapse:collapse;min-width:' + (hasFull ? '900px' : '420px') + ';">' +
        '<thead><tr>' +
        ['#','Model No.','Description','Qty','Discount','Buy Price','Buy (PHP)','Brokerage','Landed','Delivery','COGS','Commission','Profit Margin','Unit (VAT-Ex)','Unit (VAT-Incl.)','Total+VAT'].map(function(h) {
          return '<th style="' + thStyle + '">' + h + '</th>';
        }).join('') +
        '</tr></thead><tbody>';

      items.forEach(function(it, ii) {
        const bp  = parseFloat(it.buyPrice)     || 0;
        const disc = parseFloat(it.discount)    || 0;
        const qty = parseFloat(it.qty)          || 1;
        const bpPHP = parseFloat(it.buyPricePHP)|| 0;
        const brok  = parseFloat(it.brokerage)  || 0;
        const land  = parseFloat(it.landedCost) || 0;
        const deliv = parseFloat(it.deliveryCost)|| 0;
        const cogs  = parseFloat(it.totalCOGS)  || 0;
        const comm  = parseFloat(it.commission) || 0;
        const marg  = parseFloat(it.profitMargin)|| 0;
        const uvex  = parseFloat(it.unitPriceVatEx) || 0;
        const uvinc = parseFloat(it.unitPrice)  || 0;
        const tot   = parseFloat(it.finalPrice) || (uvex * qty * 1.12);

        html += '<tr style="background:' + (ii % 2 === 0 ? 'transparent' : '#f8fafc') + ';">' +
          '<td style="' + tdBase + 'color:var(--text-muted);">' + (ii+1) + '</td>' +
          '<td style="' + tdBase + 'font-weight:600;color:var(--text-primary,#f1f5f9);">' + esc(it.modelPartNo || it.modelNo || '—') + '</td>' +
          '<td style="' + tdBase + 'color:var(--text-secondary,#94a3b8);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(it.itemDescription || it.name || '—') + '</td>' +
          '<td style="' + tdNum + '">' + qty + '</td>' +
          '<td style="' + tdNum + '">' + (disc ? disc + '%' : '—') + '</td>' +
          '<td style="' + tdNum + '">' + (bp ? peso(bp) : '—') + '</td>' +
          '<td style="' + tdNum + '">' + (bpPHP ? peso(bpPHP) : '—') + '</td>' +
          '<td style="' + tdNum + '">' + (brok ? peso(brok) : '—') + '</td>' +
          '<td style="' + tdNum + '">' + (land ? peso(land) : '—') + '</td>' +
          '<td style="' + tdNum + '">' + (deliv ? peso(deliv) : '—') + '</td>' +
          '<td style="' + tdNum + 'font-weight:600;">' + (cogs ? peso(cogs) : '—') + '</td>' +
          '<td style="' + tdNum + '">' + (comm ? peso(comm) : '—') + '</td>' +
          '<td style="' + tdNum + '">' + (marg ? peso(marg) : '—') + '</td>' +
          '<td style="' + tdNum + 'font-weight:700;color:#22c55e;">' + peso(uvex) + '</td>' +
          '<td style="' + tdNum + 'font-weight:700;color:#3b82f6;">' + peso(uvinc) + '</td>' +
          '<td style="' + tdNum + 'font-weight:700;">' + peso(tot) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';

      // P&L Summary (only if full data available)
      if (hasFull && totNetSales > 0) {
        const pctOf = function(v) { return totNetSales > 0 ? ((v / totNetSales) * 100).toFixed(1) + '%' : '—'; };
        const gpColor = totGP >= 0 ? '#22c55e' : '#ef4444';
        const opColor = totOpInc >= 0 ? '#3b82f6' : '#ef4444';
        const netColor = totNet >= 0 ? '#a855f7' : '#ef4444';

        html += '<div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#64748b);margin-bottom:0.35rem;">Profit & Loss Summary</div>';

        // KPI chips
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0.5rem;margin-bottom:0.65rem;">' +
          _histKPI('Revenue (incl. VAT)', peso(totRevenue), '112%') +
          _histKPI('Net Sales', peso(totNetSales), '100%') +
          _histKPI('Gross Profit', peso(totGP), pctOf(totGP), gpColor) +
          _histKPI('Operating Income', peso(totOpInc), pctOf(totOpInc), opColor) +
          _histKPI('Net Income', peso(totNet), pctOf(totNet), netColor) +
        '</div>';

        // P&L table
        html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.78rem;max-width:460px;">' +
          '<thead><tr><th style="' + thStyle + '">Line Item</th><th style="' + thStyle + 'text-align:right;">Amount</th><th style="' + thStyle + 'text-align:right;">% of Net Sales</th></tr></thead>' +
          '<tbody>' +
          _plRow('Sales, Gross of VAT',  peso(totRevenue),  '112%') +
          _plRow('Less: VAT (12%)',      '(' + peso(totVat) + ')', '12%', '#ef4444') +
          _plRow('Sales, Net of VAT',    peso(totNetSales),  '100%', null, true) +
          _plRow('Cost of Goods Sold',   '(' + peso(totCOGS) + ')', pctOf(totCOGS), '#f97316') +
          _plRow('Gross Profit',         peso(totGP),    pctOf(totGP), gpColor, true) +
          _plRow('Commission (' + commPct + '%)', '(' + peso(totCommission) + ')', pctOf(totCommission)) +
          _plRow('Local Tax (2%)',       '(' + peso(totLocalTax) + ')', pctOf(totLocalTax)) +
          _plRow('Delivery',             '(' + peso(totDelivery) + ')', pctOf(totDelivery)) +
          _plRow('Operating Income',     peso(totOpInc),  pctOf(totOpInc), opColor, true) +
          _plRow('Income Tax (25%)',     '(' + peso(totTax) + ')', pctOf(totTax)) +
          _plRow('NET INCOME',           peso(totNet),    pctOf(totNet), netColor, true, true) +
          '</tbody></table></div>';
      }
    } else {
      html += '<p style="color:var(--text-muted);font-size:0.78rem;">No item details stored.</p>';
    }

    html += '</div></td></tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function _histChip(label, value) {
  return '<div style="display:flex;flex-direction:column;gap:0.1rem;">' +
    '<span style="font-size:0.62rem;font-weight:700;text-transform:uppercase;color:var(--text-muted,#64748b);">' + esc(label) + '</span>' +
    '<span style="font-size:0.8rem;font-weight:600;color:var(--text-primary,#f1f5f9);">' + esc(value) + '</span>' +
  '</div>';
}

function _histKPI(label, value, pct, color) {
  return '<div style="background:#f8fafc;border:1px solid var(--border,#334155);border-radius:8px;padding:0.6rem 0.75rem;">' +
    '<div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;color:var(--text-muted,#64748b);margin-bottom:0.15rem;">' + esc(label) + '</div>' +
    '<div style="font-size:0.95rem;font-weight:700;color:' + (color || 'var(--text-primary,#f1f5f9)') + ';">' + value + '</div>' +
    (pct ? '<div style="font-size:0.68rem;color:var(--text-muted,#64748b);">' + pct + '</div>' : '') +
  '</div>';
}

function _plRow(label, value, pct, color, bold, final) {
  const tdS = 'padding:0.35rem 0.5rem;' + (bold ? 'font-weight:700;' : '') + (final ? 'border-top:2px solid var(--border,#334155);font-size:0.88rem;padding-top:0.5rem;' : 'border-bottom:1px solid #e2e8f0;');
  return '<tr>' +
    '<td style="' + tdS + '">' + label + '</td>' +
    '<td style="' + tdS + 'text-align:right;white-space:nowrap;' + (color ? 'color:' + color + ';' : '') + '">' + value + '</td>' +
    '<td style="' + tdS + 'text-align:right;color:var(--text-muted,#64748b);font-size:0.72rem;">' + pct + '</td>' +
  '</tr>';
}

function _toggleHistItems(idx) {
  const row = document.getElementById('histItems' + idx);
  const btn = document.getElementById('histBtn' + idx);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : '';
  if (btn) btn.textContent = isOpen ? '▸' : '▾';
}

// ─── Document Preview Modal ──────────────────

async function openDocPreview(folderUrl) {
  var overlay = document.getElementById('docOverlay');
  var sidebar = document.getElementById('docSidebar');
  var viewer = document.getElementById('docViewer');

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  sidebar.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);"><div class="spinner spinner-sm" style="margin:0 auto 0.5rem;"></div>Loading files...</div>';
  viewer.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Select a file to preview</div>';

  try {
    var res = await apiListSQFolderFiles(folderUrl);
    if (!res.success) throw new Error(res.message || 'Failed to load files');
    var files = res.files || [];
    if (res.folderName) document.getElementById('docModalTitle').textContent = 'Documents — ' + res.folderName;

    if (files.length === 0) {
      sidebar.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.82rem;">No files found in this folder.</div>';
      return;
    }

    sidebar.innerHTML = files.map(function(f, i) {
      var icon = f.mimeType && f.mimeType.indexOf('image') >= 0
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      return '<div class="doc-file-item' + (i === 0 ? ' active' : '') + '" onclick="selectDocFile(\'' + esc(f.id) + '\',this)" title="' + esc(f.name) + '">' + icon + ' ' + esc(f.name) + '</div>';
    }).join('');

    // Auto-load first file
    selectDocFile(files[0].id, sidebar.querySelector('.doc-file-item'));
  } catch (err) {
    sidebar.innerHTML = '<div style="text-align:center;padding:1.5rem;color:#ef4444;font-size:0.82rem;">Error: ' + esc(err.message) + '</div>';
  }
}

function selectDocFile(fileId, el) {
  // Update active state
  var items = document.querySelectorAll('.doc-file-item');
  items.forEach(function(item) { item.classList.remove('active'); });
  if (el) el.classList.add('active');

  var viewer = document.getElementById('docViewer');
  viewer.innerHTML = '<iframe src="https://drive.google.com/file/d/' + fileId + '/preview" allowfullscreen></iframe>';
}

function closeDocPreview() {
  var overlay = document.getElementById('docOverlay');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  document.getElementById('docViewer').innerHTML = '';
  document.getElementById('docModalTitle').textContent = 'Supporting Documents';
}
