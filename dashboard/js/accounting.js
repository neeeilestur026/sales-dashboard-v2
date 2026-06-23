/* ═══════════════════════════════════════════════
   accounting.js — Accounting Dashboard logic
   ═══════════════════════════════════════════════ */

let dashData = null;
let ordersData = [];
let expensesData = [];
let allExpensesData = [];   // full unfiltered set — used for client-side summaries
let expAllTime = false;     // true = ignore month filter
let collectionsData = [];
let collectionsFiltered = [];
let plChartInst = null;
let expChartInst = null;
let ordersLoaded = false;
let expensesLoaded = false;
let salesOrdersLoaded = false;
let collectionsLoaded = false;
let profitReportLoaded = false;
let arAgingLoaded = false;
let shipmentsLoaded = false;
let arAgingData = [];
let salesOrdersData = [];
let allSalesOrdersData = [];   // full unfiltered set — used for client-side month filter
let soAllTime = false;
let currentRange = 'month';
let _acctEmailType = '';
let _acctEmailRef  = '';
const _acctEmailDataMap = {};

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAccountingOrAdmin();
  if (!session) return;
  renderNavbar('accounting');
  await loadDashboard('month');
});

// ─── Helpers ─────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function peso(n) {
  if (n === undefined || n === null) return '—';
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusBadge(status) {
  var s = (status || '').toLowerCase().replace(/\s+/g, '');
  var cls = 'st-pending';
  if (s === 'paid') cls = 'st-paid';
  else if (s === 'partial') cls = 'st-partial';
  else if (s === 'overdue') cls = 'st-overdue';
  else if (s === 'processing') cls = 'st-processing';
  else if (s === 'intransit') cls = 'st-transit';
  else if (s === 'delivered') cls = 'st-delivered';
  else if (s === 'completed') cls = 'st-completed';
  return '<span class="st ' + cls + '">' + esc(status || 'Pending') + '</span>';
}

function profitClass(n) {
  if (n > 0) return 'profit-pos';
  if (n < 0) return 'profit-neg';
  return 'profit-zero';
}

// ─── Tab Switching ────────────────────────────────
function switchAcctTab(tab) {
  ['dashboard','orders','expenses','sales-orders','collections','ar-aging','profit-report','shipments'].forEach(t => {
    var tabId;
    if (t === 'sales-orders') tabId = 'tabSalesOrders';
    else if (t === 'collections') tabId = 'tabCollections';
    else if (t === 'ar-aging') tabId = 'tabArAging';
    else if (t === 'profit-report') tabId = 'tabProfitReport';
    else if (t === 'shipments') tabId = 'tabShipments';
    else tabId = 'tab' + t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(tabId).className = 'tab-btn' + (t === tab ? ' active' : '');
    document.getElementById('panel-' + t).className = 'tab-panel' + (t === tab ? ' active' : '');
  });
  // Lazy-load tabs
  if (tab === 'orders' && !ordersLoaded) { ordersLoaded = true; loadOrders(); loadPORecordsForAcct(); }
  if (tab === 'expenses' && !expensesLoaded) {
    expensesLoaded = true;
    var mf = document.getElementById('expMonthFilter');
    if (!mf.value) mf.value = new Date().toISOString().slice(0, 7);
    loadExpenses();
  }
  if (tab === 'sales-orders' && !salesOrdersLoaded) { salesOrdersLoaded = true; loadSalesOrders(); }
  if (tab === 'collections' && !collectionsLoaded) { collectionsLoaded = true; loadCollections(); }
  if (tab === 'ar-aging' && !arAgingLoaded) { arAgingLoaded = true; loadArAging(); }
  if (tab === 'profit-report' && !profitReportLoaded) {
    profitReportLoaded = true;
    loadProfitReport();
    loadSavedProfitReports();
  }
  if (tab === 'shipments' && !shipmentsLoaded) { shipmentsLoaded = true; loadShipmentsForAcct(); }
}

// ═══════════════════════════════════════════════════
// DASHBOARD TAB
// ═══════════════════════════════════════════════════

async function loadDashboard(range) {
  currentRange = range;
  // Update active range button
  document.querySelectorAll('.range-btn').forEach(b => {
    b.className = 'range-btn' + (b.textContent.toLowerCase().includes(range) || (range === 'all' && b.textContent === 'All Time') || (range === 'month' && b.textContent === 'This Month') || (range === 'quarter' && b.textContent === 'Quarter') || (range === 'year' && b.textContent === 'This Year') ? ' active' : '');
  });
  // Simple active class
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  var labels = { month: 'This Month', quarter: 'Quarter', year: 'This Year', all: 'All Time' };
  document.querySelectorAll('.range-btn').forEach(b => { if (b.textContent === labels[range]) b.classList.add('active'); });

  var container = document.getElementById('dashContent');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading financials...</span></div>';

  try {
    var [acctResult, colResult, prResult, expResult] = await Promise.all([
      apiGetAccountingDashboard(range),
      apiGetCollections(),
      apiGetProfitReports(),
      apiGetExpenses('')
    ]);
    if (!acctResult.success) throw new Error(acctResult.message || 'Failed');
    dashData = acctResult;
    renderDashboard(
      acctResult,
      (colResult && colResult.success) ? (colResult.data || []) : [],
      (prResult  && prResult.success)  ? (prResult.data  || []) : [],
      (expResult && expResult.success) ? (expResult.data || []) : []
    );
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Error: ' + esc(err.message) + '</div>';
  }
}

function renderDashboard(data, colData, prData, expData) {
  var s = data.summary;
  colData = colData || [];
  prData  = prData  || [];
  expData = expData || [];

  // ── Total Revenue: ALL Collections invoiceAmount (grand total, no range filter) ──
  var totalRevenue = colData.reduce(function(acc, r) { return acc + (r.invoiceAmount || 0); }, 0);
  var invoicedCount = colData.length;

  // ── COGS: ALL Profit Report entries (grand total, no range filter) ──
  var totalCOGS = 0;
  prData.forEach(function(report) {
    (report.entries || []).forEach(function(e) { totalCOGS += e.totalCOGS || 0; });
  });

  // ── Total Expenses: ALL Expense records (grand total, no range filter) ──
  var totalExpenses = expData.reduce(function(acc, e) { return acc + (e.total || e.amount || 0); }, 0);

  // ── Receivables: unpaid balance from all Collections ──
  var totalReceivables = colData.reduce(function(acc, r) {
    var bal = (r.totalAmountDue || 0) - (r.amountReceived || 0);
    return acc + (bal > 0 ? bal : 0);
  }, 0);

  // ── Derived KPIs ──
  var grossProfit = totalRevenue - totalCOGS;
  var grossMargin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0;
  var netProfit   = grossProfit - totalExpenses;
  var netMargin   = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

  var container = document.getElementById('dashContent');

  var html = '';

  // KPI Cards
  html += '<div class="kpi-grid">';
  html += kpiCard('Total Revenue',   peso(totalRevenue),  invoicedCount + ' invoices',         'kpi-neutral');
  html += kpiCard('Cost of Goods',   peso(totalCOGS),     'from profit reports',               'kpi-neutral');
  html += kpiCard('Gross Profit',    peso(grossProfit),   grossMargin + '% margin',            grossProfit >= 0 ? 'kpi-positive' : 'kpi-negative');
  html += kpiCard('Total Expenses',  peso(totalExpenses), 'all expenses',                      'kpi-negative');
  html += kpiCard('Net Profit',      peso(netProfit),     netMargin + '% margin',              netProfit >= 0 ? 'kpi-positive' : 'kpi-negative');
  html += kpiCard('Receivables',     peso(totalReceivables), 'outstanding',                    totalReceivables > 0 ? 'kpi-negative' : 'kpi-positive');
  html += kpiCard('Payables',        peso(s.totalPayables),  'to suppliers',                   s.totalPayables > 0 ? 'kpi-negative' : 'kpi-positive');
  html += '</div>';

  // Expense breakdown inline
  html += '<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:1.5rem;">';
  html += miniCard('Shipping', peso(s.totalShipping));
  html += miniCard('Duties & Taxes', peso(s.totalDuties));
  html += miniCard('Delivery', peso(s.totalDelivery));
  html += miniCard('Other Expenses', peso(s.totalOtherExpenses));
  html += miniCard('Total Orders', data.totalOrders);
  html += '</div>';

  // Charts row
  html += '<div class="grid-2">';
  html += '<div class="chart-box"><h3>Monthly Profit & Loss</h3><canvas id="plChart"></canvas></div>';
  html += '<div class="chart-box"><h3>Expense Breakdown</h3><canvas id="expBreakdownChart"></canvas></div>';
  html += '</div>';

  // Aging + Top Clients
  html += '<div class="grid-2">';

  // Receivables Aging
  html += '<div class="chart-box"><h3>Receivables Aging</h3>';
  html += '<div class="aging-grid">';
  html += agingItem('Current', s.aging.current, 'aging-current');
  html += agingItem('1-30 Days', s.aging.d30, 'aging-30');
  html += agingItem('31-60 Days', s.aging.d60, 'aging-60');
  html += agingItem('61-90 Days', s.aging.d90, 'aging-90');
  html += agingItem('90+ Days', s.aging.over90, 'aging-over');
  html += '</div></div>';

  // Top Clients
  html += '<div class="chart-box"><h3>Top Clients by Revenue</h3>';
  if (data.topClients.length === 0) {
    html += '<div style="text-align:center;padding:1rem;color:var(--text-muted);">No orders yet</div>';
  } else {
    data.topClients.forEach(function(c, i) {
      html += '<div class="client-row"><span class="client-rank">' + (i+1) + '</span><span class="client-name">' + esc(c.client) + '</span><span class="client-rev">' + peso(c.revenue) + '</span></div>';
    });
  }
  html += '</div>';
  html += '</div>';

  // Pipeline summary
  var statuses = s.ordersByStatus;
  var statusKeys = Object.keys(statuses);
  if (statusKeys.length > 0) {
    html += '<div class="chart-box" style="margin-top:1.25rem;"><h3>Order Pipeline</h3><div style="display:flex;gap:1rem;flex-wrap:wrap;">';
    statusKeys.forEach(function(st) {
      html += '<div style="text-align:center;padding:0.5rem 1rem;"><div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">' + statuses[st] + '</div><div style="font-size:0.72rem;color:var(--text-muted);">' + esc(st) + '</div></div>';
    });
    html += '</div></div>';
  }

  container.innerHTML = html;

  // Render charts
  renderPLChart(data.monthly);
  renderExpBreakdownChart(s.expenseByCategory, s);
}

function kpiCard(label, value, sub, cls) {
  return '<div class="kpi-card"><div class="kpi-label">' + label + '</div><div class="kpi-value ' + cls + '">' + value + '</div>' + (sub ? '<div class="kpi-sub ' + cls + '">' + sub + '</div>' : '') + '</div>';
}
function miniCard(label, value) {
  return '<div style="background:var(--surface,#ffffff);border:1px solid var(--border,#334155);border-radius:10px;padding:0.75rem 1rem;text-align:center;"><div style="font-size:0.68rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:0.15rem;">' + label + '</div><div style="font-size:1rem;font-weight:700;color:var(--text-primary);">' + value + '</div></div>';
}
function agingItem(label, val, cls) {
  return '<div class="aging-item"><div class="aging-label">' + label + '</div><div class="aging-val ' + cls + '">' + peso(val) + '</div></div>';
}

async function renderPLChart(monthly) {
  await loadLib('https://cdn.jsdelivr.net/npm/chart.js');
  if (plChartInst) plChartInst.destroy();
  var ctx = document.getElementById('plChart');
  if (!ctx) return;
  plChartInst = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: monthly.map(function(m) { return m.month; }),
      datasets: [
        { label: 'Revenue', data: monthly.map(function(m) { return m.revenue; }), backgroundColor: 'rgba(34,197,94,0.6)', borderRadius: 4 },
        { label: 'Expenses', data: monthly.map(function(m) { return m.expenses; }), backgroundColor: 'rgba(239,68,68,0.5)', borderRadius: 4 },
        { label: 'Net Profit', data: monthly.map(function(m) { return m.profit; }), type: 'line', borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)', pointBackgroundColor: '#f97316', tension: 0.3, fill: false, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: 'Inter', size: 11 } } },
        tooltip: { backgroundColor: '#ffffff', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1, cornerRadius: 8, padding: 10,
          callbacks: { label: function(ctx) { return ctx.dataset.label + ': ' + peso(ctx.raw); } }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } } },
        y: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { family: 'Inter', size: 10 }, callback: function(v) { return '₱' + (v/1000).toFixed(0) + 'k'; } } }
      }
    }
  });
}

async function renderExpBreakdownChart(expByCat, summary) {
  await loadLib('https://cdn.jsdelivr.net/npm/chart.js');
  if (expChartInst) expChartInst.destroy();
  var ctx = document.getElementById('expBreakdownChart');
  if (!ctx) return;

  var labels = ['COGS', 'Shipping', 'Duties & Taxes', 'Delivery'];
  var values = [summary.totalCOGS, summary.totalShipping, summary.totalDuties, summary.totalDelivery];
  var colors = ['rgba(239,68,68,0.7)', 'rgba(59,130,246,0.7)', 'rgba(168,85,247,0.7)', 'rgba(234,179,8,0.7)'];

  var cats = Object.keys(expByCat);
  var catColors = ['rgba(236,72,153,0.7)', 'rgba(34,197,94,0.7)', 'rgba(14,165,233,0.7)', 'rgba(249,115,22,0.7)'];
  cats.forEach(function(c, i) {
    labels.push(c);
    values.push(expByCat[c]);
    colors.push(catColors[i % catColors.length]);
  });

  expChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#94a3b8', padding: 8, font: { family: 'Inter', size: 10 }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { backgroundColor: '#ffffff', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1, cornerRadius: 8, padding: 10,
          callbacks: { label: function(ctx) { return ctx.label + ': ' + peso(ctx.raw); } }
        }
      }
    }
  });
}

// ═══════════════════════════════════════════════════
// ORDERS TAB
// ═══════════════════════════════════════════════════

function toggleOrderForm() {
  var panel = document.getElementById('orderFormPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    // Set default date to today
    var today = new Date().toISOString().slice(0, 10);
    document.querySelector('#orderForm [name="orderDate"]').value = today;
  }
}

async function loadOrders() {
  var status = document.getElementById('orderStatusFilter').value;
  var client = document.getElementById('orderClientSearch').value.trim();
  var container = document.getElementById('ordersContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading orders...</span></div>';

  try {
    var result = await apiGetOrders(status, client);
    if (!result.success) throw new Error(result.message || 'Failed');
    ordersData = result.data || [];
    renderOrdersTable(ordersData);
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Error: ' + esc(err.message) + '</div>';
  }
}

function renderOrdersTable(data) {
  var container = document.getElementById('ordersContainer');
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No orders found. Click "+ Add Order" to create one.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto;"><table class="acct-table"><thead><tr>';
  html += '<th>Date</th><th>Voucher Number</th><th>Type</th><th>Client</th><th>Product</th><th>Selling (PHP)</th><th>Cost (PHP)</th><th>Profit</th><th>Client Pay</th><th>Order Status</th><th>Actions</th>';
  html += '</tr></thead><tbody>';

  data.forEach(function(o) {
    var totalCost = o.purchaseCostPHP + o.shippingCost + o.dutiesTaxes + o.deliveryCost;
    var profit = o.sellingPrice - totalCost;
    var balance = o.sellingPrice - o.amountReceived;

    html += '<tr>';
    html += '<td style="white-space:nowrap;">' + esc(o.date) + '</td>';
    html += '<td style="font-weight:600;">' + esc(o.orderNumber) + '</td>';
    html += '<td><span class="st ' + (o.type === 'International' ? 'st-transit' : 'st-processing') + '">' + esc(o.type) + '</span></td>';
    html += '<td style="font-weight:600;">' + esc(o.client) + '</td>';
    html += '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(o.product) + '</td>';
    html += '<td style="font-weight:600;">' + peso(o.sellingPrice) + '</td>';
    html += '<td>' + peso(totalCost) + '</td>';
    html += '<td class="' + profitClass(profit) + '">' + peso(profit) + '</td>';
    html += '<td>' + statusBadge(o.clientPayStatus) + (balance > 0 ? '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px;">Bal: ' + peso(balance) + '</div>' : '') + '</td>';
    html += '<td>' + statusBadge(o.orderStatus) + '</td>';
    html += '<td style="white-space:nowrap;">';
    html += '<select onchange="updateOrderField(' + o.rowIndex + ',\'clientPayStatus\',this.value)" style="font-size:0.72rem;padding:0.15rem 0.3rem;border-radius:4px;border:1px solid var(--border);background:var(--bg);color:var(--text-primary);cursor:pointer;">';
    ['Pending','Partial','Paid','Overdue'].forEach(function(st) {
      html += '<option value="' + st + '"' + (o.clientPayStatus === st ? ' selected' : '') + '>' + st + '</option>';
    });
    html += '</select>';
    html += ' <select onchange="updateOrderField(' + o.rowIndex + ',\'orderStatus\',this.value)" style="font-size:0.72rem;padding:0.15rem 0.3rem;border-radius:4px;border:1px solid var(--border);background:var(--bg);color:var(--text-primary);cursor:pointer;">';
    ['Processing','In Transit','Delivered','Completed'].forEach(function(st) {
      html += '<option value="' + st + '"' + (o.orderStatus === st ? ' selected' : '') + '>' + st + '</option>';
    });
    html += '</select>';
    html += ' <button onclick="deleteOrder(' + o.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.35rem;border-radius:4px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;" title="Delete">Del</button>';
    html += '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ─── Purchase Orders (read-only, sourced from Admin) ───────────
var _acctPORecords = [];

async function loadPORecordsForAcct() {
  var container = document.getElementById('poRecordsContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">Loading purchase orders…</div>';
  try {
    var res = await apiGetPORecords();
    if (!res || !res.success) throw new Error((res && res.message) || 'Failed');
    _acctPORecords = Array.isArray(res.data) ? res.data : [];
    renderPOTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderPOTable() {
  var container = document.getElementById('poRecordsContainer');
  if (!container) return;
  var search = (document.getElementById('poSearch').value || '').toLowerCase().trim();
  var statusFilter = document.getElementById('poStatusFilter').value || '';

  var rows = _acctPORecords.filter(function (p) {
    if (statusFilter) {
      var s = String(p.overallStatus || p.status || '');
      if (s.toLowerCase().indexOf(statusFilter.toLowerCase()) < 0) return false;
    }
    if (search) {
      var hay = ((p.poNo || '') + ' ' + (p.vendorName || '') + ' ' + (p.referenceNo || '') + ' ' + (p.itemsSummary || '')).toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  });

  if (!rows.length) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No purchase orders match these filters.</div>';
    return;
  }

  rows.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });

  var html = '<div style="overflow-x:auto;"><table class="acct-table"><thead><tr>';
  html += '<th>Date</th><th>PO No</th><th>Vendor</th><th>Items</th><th style="text-align:right;">Total</th><th>Cur</th><th>Status</th><th>Approval</th><th>Created By</th><th>PDF</th>';
  html += '</tr></thead><tbody>';

  rows.forEach(function (p) {
    var amt = Number(p.totalAmount || 0);
    var cur = String(p.currency || 'PHP');
    var amtStr = cur === 'PHP' ? peso(amt) :
      (cur + ' ' + amt.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    var status = p.overallStatus || p.status || '';
    var approval = [p.mgmtApproval, p.adminApproval].filter(Boolean).join(' / ') || '—';
    var pdf = p.driveLink
      ? '<a href="' + esc(p.driveLink) + '" target="_blank" style="color:#60a5fa;text-decoration:none;font-size:0.78rem;">View</a>'
      : '<span style="color:var(--text-muted);font-size:0.78rem;">—</span>';

    html += '<tr>';
    html += '<td style="white-space:nowrap;">' + esc(_fmtPODate(p.date)) + '</td>';
    html += '<td style="font-weight:600;white-space:nowrap;">' + esc(p.poNo || '—') + '</td>';
    html += '<td style="font-weight:600;">' + esc(p.vendorName || '—') + '</td>';
    html += '<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(p.itemsSummary || '') + '">' + esc(p.itemsSummary || '—') + '</td>';
    html += '<td style="text-align:right;font-weight:600;white-space:nowrap;">' + esc(amtStr) + '</td>';
    html += '<td>' + esc(cur) + '</td>';
    html += '<td>' + statusBadge(status) + '</td>';
    html += '<td style="font-size:0.76rem;color:var(--text-muted);white-space:nowrap;">' + esc(approval) + '</td>';
    html += '<td style="font-size:0.76rem;color:var(--text-muted);">' + esc(p.createdBy || '—') + '</td>';
    html += '<td style="white-space:nowrap;">' + pdf + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function _fmtPODate(d) {
  if (!d) return '';
  var dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
}

async function submitOrder(e) {
  e.preventDefault();
  var form = document.getElementById('orderForm');
  var btn = document.getElementById('orderSubmitBtn');
  var fd = new FormData(form);
  var data = {};
  fd.forEach(function(v, k) { data[k] = v; });
  var _ses = (typeof getSession === 'function') ? getSession() : null;
  if (_ses && _ses.name) data.createdBy = _ses.name;

  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    var result = await apiAddOrder(data);
    if (!result.success) throw new Error(result.message);
    form.reset();
    toggleOrderForm();
    clearApiCache();
    await loadOrders();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Order';
  }
}

async function updateOrderField(rowIndex, field, value) {
  try {
    var result = await apiUpdateOrder(rowIndex, field, value);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteOrder(rowIndex) {
  if (!confirm('Delete this order? This cannot be undone.')) return;
  try {
    var result = await apiDeleteOrder(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadOrders();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function exportOrdersExcel() {
  if (!ordersData.length) return;
  await loadXLSX();
  var headers = ['Date','Voucher Number','Type','Client','Product','Qty','Selling Price (PHP)','Payee','Purchase Cost (PHP)','Shipping','Duties & Taxes','Delivery Cost','Total Cost','Profit','Payment Terms','Amount Received','Balance','Client Pay Status','Payee Pay Status','Order Status'];
  var rows = ordersData.map(function(o) {
    var tc = o.purchaseCostPHP + o.shippingCost + o.dutiesTaxes + o.deliveryCost;
    return [o.date, o.orderNumber, o.type, o.client, o.product, o.qty, o.sellingPrice, o.supplier, o.purchaseCostPHP, o.shippingCost, o.dutiesTaxes, o.deliveryCost, tc, o.sellingPrice - tc, o.paymentTerms, o.amountReceived, o.sellingPrice - o.amountReceived, o.clientPayStatus, o.supplierPayStatus, o.orderStatus];
  });
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');
  XLSX.writeFile(wb, 'orders-' + new Date().toISOString().slice(0,10) + '.xlsx');
}

// ═══════════════════════════════════════════════════
// EXPENSES TAB
// ═══════════════════════════════════════════════════

function toggleExpenseForm() {
  var panel = document.getElementById('expenseFormPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    document.querySelector('#expenseForm [name="date"]').value = new Date().toISOString().slice(0, 10);
  }
}

function cancelExpenseForm() {
  var form = document.getElementById('expenseForm');
  form.reset();
  document.getElementById('expenseEditRowIndex').value = '';
  document.getElementById('expenseFormTitle').textContent = 'Log Expense';
  document.getElementById('expenseSubmitBtn').textContent = 'Save Expense';
  document.getElementById('expenseFormPanel').classList.add('hidden');
}

function editExpense(rowIndex) {
  var e = expensesData.find(function(x) { return x.rowIndex == rowIndex; });
  if (!e) return;
  var form = document.getElementById('expenseForm');
  form.querySelector('[name="date"]').value = e.date || '';
  form.querySelector('[name="category"]').value = e.category || '';
  form.querySelector('[name="orderRef"]').value = e.orderRef || '';
  form.querySelector('[name="client"]').value = e.client || '';
  form.querySelector('[name="description"]').value = e.description || '';
  form.querySelector('[name="toll"]').value = e.toll || 0;
  form.querySelector('[name="fuel"]').value = e.fuel || 0;
  form.querySelector('[name="meals"]').value = e.meals || 0;
  form.querySelector('[name="loadBalance"]').value = e.loadBalance || 0;
  form.querySelector('[name="otherAmount"]').value = e.otherAmount || 0;
  form.querySelector('[name="notes"]').value = e.notes || '';
  document.getElementById('expenseEditRowIndex').value = rowIndex;
  document.getElementById('expenseFormTitle').textContent = 'Edit Expense';
  document.getElementById('expenseSubmitBtn').textContent = 'Update Expense';
  document.getElementById('expenseFormPanel').classList.remove('hidden');
  document.getElementById('expenseFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadExpenses() {
  var container = document.getElementById('expensesContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading expenses...</span></div>';
  document.getElementById('expenseSummary').innerHTML = '';
  document.getElementById('expenseCategoryBreakdown').innerHTML = '';

  try {
    var result = await apiGetExpenses(''); // fetch ALL — filter client-side
    if (!result.success) throw new Error(result.message || 'Failed');
    allExpensesData = result.data || [];
    applyExpenseFilters();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Error: ' + esc(err.message) + '</div>';
  }
}

function toggleExpAllTime() {
  expAllTime = !expAllTime;
  var btn = document.getElementById('expAllTimeBtn');
  var mf  = document.getElementById('expMonthFilter');
  btn.style.background   = expAllTime ? 'var(--accent)'  : '';
  btn.style.color        = expAllTime ? '#fff'            : '';
  mf.disabled            = expAllTime;
  mf.style.opacity       = expAllTime ? '0.4' : '1';
  applyExpenseFilters();
}

function applyExpenseFilters() {
  var month    = document.getElementById('expMonthFilter').value;  // 'YYYY-MM' or ''
  var category = document.getElementById('expCatFilter').value;

  var filtered = allExpensesData.filter(function(e) {
    if (!expAllTime && month && !String(e.date || '').startsWith(month)) return false;
    if (category && e.category !== category) return false;
    return true;
  });

  expensesData = filtered;
  renderExpensesSummary(filtered, month);
  renderExpensesTable(filtered);
}

function renderExpensesSummary(data, month) {
  var summaryEl    = document.getElementById('expenseSummary');
  var breakdownEl  = document.getElementById('expenseCategoryBreakdown');
  var currentYM    = new Date().toISOString().slice(0, 7); // YYYY-MM
  var currentY     = new Date().getFullYear().toString();

  // KPI totals
  var totalFiltered = 0, totalMonth = 0, totalYear = 0, totalAllTime = 0;
  allExpensesData.forEach(function(e) {
    totalAllTime += e.total || 0;
    if (String(e.date || '').startsWith(currentYM)) totalMonth  += e.total || 0;
    if (String(e.date || '').startsWith(currentY))  totalYear   += e.total || 0;
  });
  data.forEach(function(e) { totalFiltered += e.total || 0; });

  var label = expAllTime ? 'All Time' : (month ? monthLabel(month) : 'Filtered');
  summaryEl.innerHTML =
    expKpiCard('₱' + fmt(totalFiltered), label + ' Total', '#f97316') +
    expKpiCard('₱' + fmt(totalMonth),    monthLabel(currentYM) + ' Total', '#ef4444') +
    expKpiCard('₱' + fmt(totalYear),     new Date().getFullYear() + ' Total', '#8b5cf6') +
    expKpiCard('₱' + fmt(totalAllTime),  'All-Time Total', '#14b8a6');

  // Category breakdown for filtered set
  var catMap = {};
  data.forEach(function(e) {
    var c = e.category || 'Uncategorized';
    catMap[c] = (catMap[c] || 0) + (e.total || 0);
  });
  var cats = Object.keys(catMap).sort(function(a, b) { return catMap[b] - catMap[a]; });

  if (cats.length === 0) { breakdownEl.innerHTML = ''; return; }

  var html = '<div class="card" style="margin-bottom:0;padding:1rem;">' +
    '<div style="font-size:0.78rem;font-weight:700;color:var(--text-secondary);letter-spacing:.05em;margin-bottom:0.75rem;">EXPENSES BY CATEGORY</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0.5rem;">';

  cats.forEach(function(cat) {
    var amt   = catMap[cat];
    var pct   = totalFiltered > 0 ? (amt / totalFiltered * 100) : 0;
    html += '<div style="background:var(--surface-2);border-radius:8px;padding:0.5rem 0.75rem;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">' +
        '<span style="font-size:0.78rem;color:var(--text-primary);font-weight:500;">' + esc(cat) + '</span>' +
        '<span style="font-size:0.78rem;font-weight:700;color:var(--accent);">₱' + fmt(amt) + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.4rem;">' +
        '<div style="flex:1;height:5px;border-radius:999px;background:var(--surface-3,#ffffff);overflow:hidden;">' +
          '<div style="width:' + pct.toFixed(1) + '%;height:100%;border-radius:999px;background:#f97316;"></div>' +
        '</div>' +
        '<span style="font-size:0.7rem;color:var(--text-muted);min-width:32px;text-align:right;">' + pct.toFixed(1) + '%</span>' +
      '</div>' +
    '</div>';
  });
  html += '</div></div>';
  breakdownEl.innerHTML = html;
}

function expKpiCard(value, label, color, sublabel) {
  return '<div style="background:var(--surface-2);border-radius:10px;padding:0.75rem 1rem;border-left:3px solid ' + color + ';">' +
    '<div style="font-size:1.15rem;font-weight:700;color:' + color + ';">' + value + '</div>' +
    '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.15rem;">' + (sublabel || label) + '</div>' +
  '</div>';
}

function monthLabel(ym) {
  if (!ym) return '';
  try {
    var d = new Date(ym + '-01');
    return d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  } catch(e) { return ym; }
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderExpensesTable(data) {
  var container = document.getElementById('expensesContainer');
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No expenses recorded. Click "+ Add Expense" to log one.</div>';
    return;
  }

  var grandTotal = 0;
  var html = '<div style="overflow-x:auto;"><table class="acct-table"><thead><tr>';
  html += '<th>Date</th><th>Category</th><th>Voucher Number</th><th>Client</th><th>Description</th><th>Toll</th><th>Fuel</th><th>Meals</th><th>Load Bal</th><th>Other</th><th>Total</th><th>Actions</th>';
  html += '</tr></thead><tbody>';

  data.forEach(function(e) {
    grandTotal += e.total;
    html += '<tr>';
    html += '<td style="white-space:nowrap;">' + esc(e.date) + '</td>';
    html += '<td>' + statusBadge(e.category) + '</td>';
    html += '<td>' + esc(e.orderRef) + '</td>';
    html += '<td>' + esc(e.client) + '</td>';
    html += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(e.description) + '</td>';
    html += '<td>' + (e.toll ? peso(e.toll) : '<span class="kpi-neutral">—</span>') + '</td>';
    html += '<td>' + (e.fuel ? peso(e.fuel) : '<span class="kpi-neutral">—</span>') + '</td>';
    html += '<td>' + (e.meals ? peso(e.meals) : '<span class="kpi-neutral">—</span>') + '</td>';
    html += '<td>' + (e.loadBalance ? peso(e.loadBalance) : '<span class="kpi-neutral">—</span>') + '</td>';
    html += '<td>' + (e.otherAmount ? peso(e.otherAmount) : '<span class="kpi-neutral">—</span>') + '</td>';
    html += '<td style="font-weight:700;color:var(--accent);">' + peso(e.total) + '</td>';
    html += '<td><button onclick="editExpense(' + e.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.35rem;border-radius:4px;border:1px solid rgba(59,130,246,0.3);background:rgba(59,130,246,0.12);color:#3b82f6;cursor:pointer;margin-right:0.2rem;" title="Edit">Edit</button><button onclick="deleteExpense(' + e.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.35rem;border-radius:4px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;" title="Delete">Del</button></td>';
    html += '</tr>';
  });

  html += '</tbody><tfoot><tr>';
  html += '<td colspan="11" style="text-align:right;font-weight:700;color:var(--text-muted);">GRAND TOTAL</td>';
  html += '<td style="font-weight:700;color:var(--accent);">' + peso(grandTotal) + '</td>';
  html += '</tr></tfoot></table></div>';

  container.innerHTML = html;
}

async function submitExpense(e) {
  e.preventDefault();
  var form = document.getElementById('expenseForm');
  var btn = document.getElementById('expenseSubmitBtn');
  var fd = new FormData(form);
  var data = {};
  fd.forEach(function(v, k) { data[k] = v; });

  var editRowIndex = document.getElementById('expenseEditRowIndex').value;
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    var result;
    if (editRowIndex) {
      data.rowIndex = editRowIndex;
      result = await apiUpdateExpense(data);
    } else {
      var _ses = (typeof getSession === 'function') ? getSession() : null;
      if (_ses && _ses.name) data.createdBy = _ses.name;
      result = await apiAddExpense(data);
    }
    if (!result.success) throw new Error(result.message);
    cancelExpenseForm();
    clearApiCache();
    await loadExpenses();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = editRowIndex ? 'Update Expense' : 'Save Expense';
  }
}

async function exportExpensesExcel() {
  if (!expensesData.length) return;
  await loadXLSX();
  var headers = ['Date','Category','Voucher Number','Client','Description','Toll','Fuel','Meals','Load Balance','Other','Total','Notes'];
  var rows = expensesData.map(function(e) {
    return [e.date, e.category, e.orderRef, e.client, e.description, e.toll, e.fuel, e.meals, e.loadBalance, e.otherAmount, e.total, e.notes];
  });
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
  XLSX.writeFile(wb, 'expenses-' + new Date().toISOString().slice(0,10) + '.xlsx');
}

async function deleteExpense(rowIndex) {
  if (!confirm('Delete this expense? This cannot be undone.')) return;
  try {
    var result = await apiDeleteExpense(rowIndex);
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadExpenses();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════
// SALES ORDERS TAB
// ═══════════════════════════════════════════════════

function toggleSOAllTime() {
  soAllTime = !soAllTime;
  var btn = document.getElementById('soAllTimeBtn');
  var mf  = document.getElementById('soMonthFilter');
  btn.style.background = soAllTime ? 'var(--accent)' : '';
  btn.style.color      = soAllTime ? '#fff'           : '';
  mf.disabled          = soAllTime;
  mf.style.opacity     = soAllTime ? '0.4' : '1';
  applySalesOrderFilters();
}

function applySalesOrderFilters() {
  var month = document.getElementById('soMonthFilter').value;
  var filtered = allSalesOrdersData.filter(function(so) {
    if (!soAllTime && month && !String(so.date || '').startsWith(month)) return false;
    return true;
  });
  salesOrdersData = filtered;
  renderSOTable(filtered);
  loadSOStats();
}

async function loadSalesOrders() {
  var status = document.getElementById('soStatusFilter').value;
  var search = document.getElementById('soSearch').value.trim();
  var container = document.getElementById('salesOrdersContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading sales orders...</span></div>';

  try {
    var result = await apiGetSalesOrders(status, search);
    if (!result.success) throw new Error(result.message || 'Failed');
    allSalesOrdersData = result.data || [];
    applySalesOrderFilters();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Error: ' + esc(err.message) + '</div>';
  }
}

async function loadSOStats() {
  var bar = document.getElementById('soStatsBar');
  try {
    var result = await apiGetSOStats();
    if (!result.success) { bar.innerHTML = ''; return; }
    var html = '<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:1rem;">';
    html += miniCard('Total SOs', result.total || 0);
    html += miniCard('Pending', result.pending || 0);
    html += miniCard('Delivered', result.delivered || 0);
    html += miniCard('Total Revenue', peso(result.totalRevenue || 0));
    html += '</div>';
    bar.innerHTML = html;
  } catch (err) {
    bar.innerHTML = '';
  }
}

function renderSOTable(data) {
  var container = document.getElementById('salesOrdersContainer');
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No sales orders found.</div>';
    return;
  }

  // Build a quick SO -> Collection lookup so we can show AR status per SO
  var arBySo = {};
  (collectionsData || []).forEach(function(c) {
    if (c.soNo) arBySo[c.soNo] = c;
  });

  var html = '<div style="overflow-x:auto;"><table class="acct-table"><thead><tr>';
  html += '<th>SO #</th><th>Date</th><th>Customer</th><th>Items</th><th>Total Amount</th><th>Grand Total</th><th>Status</th><th>Invoice #</th><th>AR Status</th>';
  html += '</tr></thead><tbody>';

  data.forEach(function(so) {
    var itemsSummary = (so.items || []).map(function(it) {
      return esc(it.productDescription || it.productCode || '') + ' x' + it.qty;
    }).join('; ');
    if (itemsSummary.length > 80) itemsSummary = itemsSummary.substring(0, 77) + '...';

    var ar = arBySo[so.soNo];
    var arCell;
    if (!ar) {
      arCell = '<span style="color:var(--text-muted);font-size:0.72rem;">—</span>';
    } else {
      var bal = (parseFloat(ar.totalAmountDue) || 0) - (parseFloat(ar.amountReceived) || 0);
      var collected = bal <= 0 && (parseFloat(ar.totalAmountDue) || 0) > 0;
      var pdd = _arPastDueDays(ar.dueDate, collected);
      if (collected) {
        arCell = '<span style="background:rgba(34,197,94,0.15);color:#22c55e;padding:0.12rem 0.5rem;border-radius:4px;font-size:0.72rem;font-weight:700;">Paid</span>';
      } else if (pdd > 0) {
        arCell = '<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:0.12rem 0.5rem;border-radius:4px;font-size:0.72rem;font-weight:700;" title="Past due ' + pdd + ' days">Overdue ' + pdd + 'd · ' + peso(bal) + '</span>';
      } else {
        arCell = '<span style="background:rgba(234,179,8,0.15);color:#eab308;padding:0.12rem 0.5rem;border-radius:4px;font-size:0.72rem;font-weight:700;">Outstanding ' + peso(bal) + '</span>';
      }
    }

    html += '<tr>';
    html += '<td style="font-weight:600;">' + esc(so.soNo) + '</td>';
    html += '<td style="white-space:nowrap;">' + esc(so.date) + '</td>';
    html += '<td style="font-weight:600;">' + esc(so.customerName) + '</td>';
    html += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(itemsSummary) + '">' + itemsSummary + '</td>';
    html += '<td>' + peso(so.totalAmount) + '</td>';
    html += '<td style="font-weight:700;color:var(--accent);">' + peso(so.grandTotal) + '</td>';
    html += '<td>' + statusBadge(so.status) + '</td>';
    html += '<td>' + esc(so.invoiceNo || '') + '</td>';
    html += '<td>' + arCell + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function exportSOExcel() {
  if (!salesOrdersData.length) return;
  await loadXLSX();
  var headers = ['SO #','Date','Customer ID','Customer','Items','Total Amount','Sales','VAT','Grand Total','Status','Invoice #'];
  var rows = salesOrdersData.map(function(so) {
    var items = (so.items || []).map(function(it) { return (it.productDescription || it.productCode || '') + ' x' + it.qty; }).join('; ');
    return [so.soNo, so.date, so.customerId, so.customerName, items, so.totalAmount, so.sales, so.vat, so.grandTotal, so.status, so.invoiceNo || ''];
  });
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sales Orders');
  XLSX.writeFile(wb, 'sales-orders-' + new Date().toISOString().slice(0,10) + '.xlsx');
}

// ═══════════════════════════════════════════════════
// COLLECTIONS TAB
// ═══════════════════════════════════════════════════

function toggleCollectionForm(record) {
  var panel = document.getElementById('collectionFormPanel');
  var form  = document.getElementById('collectionForm');
  var title = document.getElementById('collectionFormTitle');
  var btn   = document.getElementById('collectionSubmitBtn');

  populateCollectionSoDropdown();

  if (record) {
    // Edit mode — always show
    panel.classList.remove('hidden');
    if (title) title.textContent = 'Edit Record';
    btn.textContent = 'Update Record';
    document.getElementById('collectionRowIndex').value = record.rowIndex;
    form.querySelector('[name="soNo"]').value             = record.soNo || '';
    form.querySelector('[name="invoiceNo"]').value        = record.invoiceNo || '';
    form.querySelector('[name="drNo"]').value             = record.drNo || '';
    form.querySelector('[name="date"]').value             = record.date || '';
    form.querySelector('[name="siDate"]').value           = record.siDate || '';
    form.querySelector('[name="customerId"]').value       = record.customerId || '';
    form.querySelector('[name="companyName"]').value      = record.companyName || '';
    form.querySelector('[name="poNo"]').value             = record.poNo || '';
    form.querySelector('[name="dateReceived"]').value     = record.dateReceived || '';
    form.querySelector('[name="paymentTerms"]').value     = record.paymentTerms || 'COD';
    form.querySelector('[name="invoiceAmount"]').value    = record.invoiceAmount || '';
    form.querySelector('[name="netOfVat"]').value         = record.netOfVat || '';
    form.querySelector('[name="vat"]').value              = record.vat || '';
    form.querySelector('[name="ewt"]').value              = record.ewt || '';
    form.querySelector('[name="totalAmountDue"]').value   = record.totalAmountDue || '';
    form.querySelector('[name="dueDate"]').value          = record.dueDate || '';
    form.querySelector('[name="dateCollected"]').value    = record.dateCollected || '';
    form.querySelector('[name="amountReceived"]').value   = record.amountReceived || 0;
    form.querySelector('[name="remarks"]').value          = record.remarks || '';
    form.querySelector('[name="lastFollowUpDate"]').value = record.lastFollowUpDate || '';
    form.querySelector('[name="notes"]').value            = record.notes || '';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    // Add mode — toggle
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      if (title) title.textContent = 'Invoice Details';
      btn.textContent = 'Save Record';
      form.reset();
      document.getElementById('collectionRowIndex').value = '';
      var today = new Date().toISOString().slice(0, 10);
      form.querySelector('[name="date"]').value = today;
      form.querySelector('[name="dateReceived"]').value = today;
    }
  }
}

async function populateCollectionSoDropdown() {
  var sel = document.getElementById('collectionSoNo');
  if (!sel || sel.dataset.loaded === '1') return;
  try {
    if (!salesOrdersData || !salesOrdersData.length) {
      var r = await apiGetSalesOrders();
      if (r && r.success) { allSalesOrdersData = r.data || []; salesOrdersData = allSalesOrdersData; }
    }
    var opts = '<option value="">— None / manual entry —</option>';
    (salesOrdersData || []).forEach(function(so) {
      var label = (so.soNo || '') + ' — ' + (so.customerName || '') + ' (' + peso(so.grandTotal || so.totalAmount || 0) + ')';
      opts += '<option value="' + esc(so.soNo) + '">' + esc(label) + '</option>';
    });
    sel.innerHTML = opts;
    sel.dataset.loaded = '1';
  } catch (err) { /* keep manual-entry-only fallback */ }
}

function onCollectionSoSelect() {
  var sel  = document.getElementById('collectionSoNo');
  var soNo = sel.value;
  if (!soNo) return;
  var so = (salesOrdersData || []).find(function(x) { return x.soNo === soNo; });
  if (!so) return;
  var form = document.getElementById('collectionForm');
  if (!form.querySelector('[name="customerId"]').value)   form.querySelector('[name="customerId"]').value   = so.customerId || '';
  if (!form.querySelector('[name="companyName"]').value)  form.querySelector('[name="companyName"]').value  = so.customerName || '';
  if (!form.querySelector('[name="poNo"]').value)         form.querySelector('[name="poNo"]').value         = so.customerPoNo || so.poNo || '';
  if (!form.querySelector('[name="invoiceNo"]').value && so.invoiceNo) form.querySelector('[name="invoiceNo"]').value = so.invoiceNo;
  var amtField = form.querySelector('[name="invoiceAmount"]');
  if (!amtField.value) {
    amtField.value = so.grandTotal || so.totalAmount || '';
    autoCalcCollection();
  }
}

function autoCalcCollection() {
  var form = document.getElementById('collectionForm');
  var invoiceAmt = parseFloat(form.querySelector('[name="invoiceAmount"]').value) || 0;
  var netOfVat   = invoiceAmt ? +(invoiceAmt / 1.12).toFixed(2) : 0;
  var vat        = invoiceAmt ? +(invoiceAmt - netOfVat).toFixed(2) : 0;
  var ewt        = netOfVat ? +(netOfVat * 0.01).toFixed(2) : 0;
  var totalDue   = invoiceAmt ? +(invoiceAmt - ewt).toFixed(2) : 0;
  form.querySelector('[name="netOfVat"]').value       = netOfVat ? netOfVat.toFixed(2) : '';
  form.querySelector('[name="vat"]').value            = vat      ? vat.toFixed(2)      : '';
  form.querySelector('[name="ewt"]').value            = ewt      ? ewt.toFixed(2)      : '';
  form.querySelector('[name="totalAmountDue"]').value = totalDue ? totalDue.toFixed(2) : '';
}

async function loadCollections() {
  var container = document.getElementById('collectionsContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading collections...</span></div>';
  document.getElementById('colKPIs').innerHTML = '';
  try {
    var result = await apiGetCollections();
    if (!result.success) throw new Error(result.message || 'Failed');
    collectionsData = result.data || [];
    collectionsFiltered = collectionsData.slice();
    renderCollectionsKPIs(collectionsData);
    renderCollectionsTable(collectionsFiltered);
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Error: ' + esc(err.message) + '</div>';
  }
}

function renderCollectionsKPIs(data) {
  var totalInvoiced  = data.reduce(function(s,r) { return s + (r.invoiceAmount || 0); }, 0);
  var totalDue       = data.reduce(function(s,r) { return s + (r.totalAmountDue || 0); }, 0);
  var totalCollected = data.reduce(function(s,r) { return s + (r.amountReceived || 0); }, 0);
  var outstanding    = totalDue - totalCollected;
  var collectedCount = data.filter(function(r) { return r.amountReceived >= r.totalAmountDue && r.totalAmountDue > 0; }).length;

  var kpiEl = document.getElementById('colKPIs');
  kpiEl.innerHTML = [
    ['Total Invoiced',  peso(totalInvoiced),  ''],
    ['Total Amount Due', peso(totalDue),       ''],
    ['Total Collected', peso(totalCollected),  'kpi-positive'],
    ['Outstanding',     peso(outstanding),     outstanding > 0 ? 'kpi-negative' : 'kpi-positive'],
    ['Fully Collected', collectedCount + ' of ' + data.length, '']
  ].map(function(c) {
    return '<div class="kpi-card"><div class="kpi-label">' + c[0] + '</div><div class="kpi-value ' + c[2] + '">' + c[1] + '</div></div>';
  }).join('');
}

function filterCollections() {
  var search = (document.getElementById('colSearch').value || '').toLowerCase();
  var status = document.getElementById('colStatusFilter').value;
  collectionsFiltered = collectionsData.filter(function(r) {
    if (search) {
      var haystack = (r.companyName + ' ' + r.invoiceNo + ' ' + r.drNo + ' ' + r.customerId + ' ' + r.poNo).toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (status === 'collected') {
      return r.amountReceived >= r.totalAmountDue && r.totalAmountDue > 0;
    }
    if (status === 'outstanding') {
      return r.amountReceived < r.totalAmountDue;
    }
    return true;
  });
  renderCollectionsTable(collectionsFiltered);
}

function renderCollectionsTable(data) {
  var container = document.getElementById('collectionsContainer');
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No records found. Click "+ Add Record" to create one.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto;"><table class="acct-table"><thead><tr>';
  html += '<th>Invoice No.</th><th>DR No.</th><th>Date</th><th>Company</th><th>PO No.</th><th>Date Rcvd</th><th>Terms</th>';
  html += '<th>Invoice Amt</th><th>Net of VAT</th><th>VAT</th><th>EWT</th><th>Total Due</th>';
  html += '<th>Due Date</th><th>Date Collected</th><th>Amt Received</th><th>Status</th><th>Actions</th>';
  html += '</tr></thead><tbody>';

  data.forEach(function(r) {
    var balance = r.totalAmountDue - r.amountReceived;
    var isCollected = r.amountReceived >= r.totalAmountDue && r.totalAmountDue > 0;
    _acctEmailDataMap[r.rowIndex] = {
      ref: r.invoiceNo, name: r.companyName || '', email: '',
      dueDate: r.dueDate || '', amount: peso(r.totalAmountDue), balance: peso(balance > 0 ? balance : 0)
    };
    var statusHtml = isCollected
      ? '<span class="st st-paid">Collected</span>'
      : (balance > 0
          ? '<span class="st st-overdue">Outstanding</span>'
          : '<span class="st st-pending">Pending</span>');

    html += '<tr>';
    html += '<td style="font-weight:600;">' + esc(r.invoiceNo) + '</td>';
    html += '<td>' + esc(r.drNo || '—') + '</td>';
    html += '<td style="white-space:nowrap;">' + esc(r.date) + '</td>';
    html += '<td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.companyName) + '">' + esc(r.companyName) + '</td>';
    html += '<td>' + esc(r.poNo || '—') + '</td>';
    html += '<td style="white-space:nowrap;color:var(--text-muted);">' + esc(r.dateReceived || '—') + '</td>';
    html += '<td>' + esc(r.paymentTerms || '—') + '</td>';
    html += '<td>' + peso(r.invoiceAmount) + '</td>';
    html += '<td>' + peso(r.netOfVat) + '</td>';
    html += '<td>' + peso(r.vat) + '</td>';
    html += '<td>' + peso(r.ewt) + '</td>';
    html += '<td style="font-weight:700;">' + peso(r.totalAmountDue) + '</td>';
    html += '<td style="white-space:nowrap;' + (balance > 0 && r.dueDate && r.dueDate < new Date().toISOString().slice(0,10) ? 'color:#ef4444;' : '') + '">' + esc(r.dueDate || '—') + '</td>';
    html += '<td style="white-space:nowrap;">' + esc(r.dateCollected || '—') + '</td>';
    html += '<td style="font-weight:700;color:#22c55e;">' + peso(r.amountReceived) + '</td>';
    html += '<td>' + statusHtml + (balance > 0 && !isCollected ? '<div style="font-size:0.68rem;color:#ef4444;margin-top:2px;">Bal: ' + peso(balance) + '</div>' : '') + '</td>';
    html += '<td style="white-space:nowrap;">';
    html += '<button onclick="editCollection(' + r.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.45rem;border-radius:4px;border:1px solid rgba(59,130,246,0.3);background:rgba(59,130,246,0.12);color:#60a5fa;cursor:pointer;margin-right:4px;">Edit</button>';
    html += '<button onclick="deleteCollection(' + r.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.35rem;border-radius:4px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;margin-right:4px;">Del</button>';
    html += '<button onclick="openAcctFollowUpEmail(' + r.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.45rem;border-radius:4px;border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.12);color:#818cf8;cursor:pointer;margin-right:4px;">Follow Up</button>';
    html += '<button onclick="openAcctCollectionEmail(' + r.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.45rem;border-radius:4px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.12);color:#fbbf24;cursor:pointer;">Collection</button>';
    html += '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function submitCollection(e) {
  e.preventDefault();
  var form = document.getElementById('collectionForm');
  var btn  = document.getElementById('collectionSubmitBtn');
  var fd   = new FormData(form);
  var data = {};
  fd.forEach(function(v, k) { data[k] = v; });

  var isEdit = !!parseInt(data.rowIndex);
  btn.disabled = true; btn.textContent = isEdit ? 'Updating...' : 'Saving...';
  try {
    if (!isEdit) {
      var _ses = (typeof getSession === 'function') ? getSession() : null;
      if (_ses && _ses.name) data.createdBy = _ses.name;
    }
    var result = isEdit ? await apiUpdateCollection(data) : await apiAddCollection(data);
    if (!result.success) throw new Error(result.message);
    form.reset();
    document.getElementById('collectionFormPanel').classList.add('hidden');
    collectionsLoaded = false;
    await loadCollections();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Record';
  }
}

async function deleteCollection(rowIndex) {
  if (!confirm('Delete this collection record? This cannot be undone.')) return;
  try {
    var result = await apiDeleteCollection(rowIndex);
    if (!result.success) throw new Error(result.message);
    collectionsLoaded = false;
    await loadCollections();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function editCollection(rowIndex) {
  var record = collectionsData.find(function(r) { return r.rowIndex === rowIndex; });
  if (!record) return;
  // Ensure the Collections tab is visible before opening the form
  var collectionsPanel = document.getElementById('panel-collections');
  if (!collectionsPanel.classList.contains('active')) {
    switchAcctTab('collections');
  }
  toggleCollectionForm(record);
}

async function exportCollectionsExcel() {
  if (!collectionsFiltered.length) return;
  await loadXLSX();
  var headers = ['Invoice No.','DR No.','Date','Customer ID','Company Name','PO No.','Date Received','Payment Terms','Invoice Amount','Net of VAT','VAT','EWT','Total Amount Due','Due Date','Date Collected','Amount Received'];
  var rows = collectionsFiltered.map(function(r) {
    return [r.invoiceNo, r.drNo, r.date, r.customerId, r.companyName, r.poNo, r.dateReceived, r.paymentTerms, r.invoiceAmount, r.netOfVat, r.vat, r.ewt, r.totalAmountDue, r.dueDate, r.dateCollected, r.amountReceived];
  });
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Collections');
  XLSX.writeFile(wb, 'collections-' + new Date().toISOString().slice(0,10) + '.xlsx');
}

// ═══════════════════════════════════════════════════
// PROFIT REPORT TAB
// ═══════════════════════════════════════════════════

var _prEntries    = [];   // [ { soNo, customerName, sales, cogsType, purchaseOfGoods, ... } ]
var _prAllSOs     = [];   // cached SO list from API
var _prReportSaved = false; // prevents duplicate saves of the same entry set

async function loadProfitReport() {
  var clientSel = document.getElementById('prClientSelect');
  clientSel.innerHTML = '<option value="">Loading...</option>';
  try {
    var result = await fetchFromAPI({ action: 'getSalesOrders' });
    if (!result.success) throw new Error(result.message || 'Failed');
    _prAllSOs = result.data || [];

    // Unique client list
    var clients = {};
    _prAllSOs.forEach(function(so) {
      var n = so.customerName || so.customerId || '';
      if (n) clients[n] = true;
    });
    var opts = '<option value="">-- Select Client --</option>';
    Object.keys(clients).sort().forEach(function(c) {
      opts += '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    });
    clientSel.innerHTML = opts;
    document.getElementById('prSOSelect').innerHTML = '<option value="">-- Select client first --</option>';
  } catch (err) {
    clientSel.innerHTML = '<option value="">Error loading clients</option>';
  }
}

function prFilterSOs() {
  var client = document.getElementById('prClientSelect').value;
  var soSel = document.getElementById('prSOSelect');
  if (!client) {
    soSel.innerHTML = '<option value="">-- Select client first --</option>';
    return;
  }
  var added = _prEntries.map(function(e) { return e.soNo; });
  var filtered = _prAllSOs.filter(function(so) {
    return (so.customerName || so.customerId) === client && added.indexOf(so.soNo) === -1;
  });
  var opts = '<option value="">-- Select SO --</option>';
  filtered.forEach(function(so) {
    var amt = parseFloat(so.grandTotal) || parseFloat(so.totalAmount) || 0;
    opts += '<option value="' + esc(so.soNo) + '">' + esc(so.soNo) + '  ₱' + fmt(amt) + '</option>';
  });
  soSel.innerHTML = opts;
}

function prAddSO() {
  var soNo = document.getElementById('prSOSelect').value;
  if (!soNo) return;
  var soData = _prAllSOs.find(function(s) { return s.soNo === soNo; });
  if (!soData) return;

  _prEntries.push({
    soNo:                     soNo,
    soDate:                   soData.date || new Date().toISOString().slice(0, 10),
    customerName:             soData.customerName || soData.customerId || '',
    sales:                    parseFloat(soData.grandTotal) || parseFloat(soData.totalAmount) || parseFloat(soData.sales) || 0,
    cogsType:                 'local',
    purchaseOfGoods:          0,
    bankServiceChargeCOGS:    0,
    dutiesAndTaxes:           0,
    bankServiceChargeShipping:0,
    shippingCompany:          'DHL',
    shippingCost:             0,
    localCharges:             0,
    deliveryToOffice:         0,
    deliveryToClient:         0
  });
  _prReportSaved = false;

  _prRenderEntries();
  prFilterSOs();
}

function prRemoveEntry(idx) {
  _prEntries.splice(idx, 1);
  _prReportSaved = false;
  _prRenderEntries();
  prFilterSOs();
}

function prUpdateField(idx, field, value) {
  if (!_prEntries[idx]) return;
  var num = parseFloat(value);
  _prEntries[idx][field] = isNaN(num) ? value : num;
  _prReportSaved = false;
  if (field === 'cogsType') _prRenderEntries();
}

function prClearAll() {
  _prEntries = [];
  _prReportSaved = false;
  _prRenderEntries();
  document.getElementById('profitReportContainer').innerHTML = '';
  prFilterSOs();
}

function _prRenderEntries() {
  var list    = document.getElementById('prSOEntriesList');
  var calcBar = document.getElementById('prCalculateBar');

  if (!_prEntries.length) {
    list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted,#64748b);">No SOs added. Select a client and SO above, then click + Add SO.</div>';
    calcBar.style.display = 'none';
    return;
  }
  calcBar.style.display = 'flex';

  var html = '';
  _prEntries.forEach(function(e, idx) {
    var isIntl = e.cogsType === 'international';
    html +=
      '<div style="background:var(--surface,#ffffff);border:1px solid var(--border,#334155);border-radius:12px;padding:1.25rem;margin-bottom:1rem;">' +

      // ── card header ──
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">' +
        '<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">' +
          '<span style="font-size:0.88rem;font-weight:700;color:var(--text-primary,#f1f5f9);">' + esc(e.soNo) + '</span>' +
          '<span style="color:var(--text-muted,#64748b);">|</span>' +
          '<span style="font-size:0.82rem;color:var(--text-secondary,#94a3b8);">' + esc(e.customerName) + '</span>' +
          '<span style="color:var(--text-muted,#64748b);">|</span>' +
          '<span style="font-size:0.82rem;font-weight:700;color:#22c55e;">SALES: ₱' + fmt(e.sales) + '</span>' +
          '<span style="color:var(--text-muted,#64748b);">|</span>' +
          '<input type="date" value="' + esc(e.soDate || '') + '" onchange="prUpdateField(' + idx + ',\'soDate\',this.value)" title="SO Date" ' +
          'style="padding:0.2rem 0.4rem;border-radius:6px;border:1px solid var(--border,#334155);background:var(--bg,#f8fafc);color:var(--text-primary,#f1f5f9);font-size:0.75rem;">' +
        '</div>' +
        '<button onclick="prRemoveEntry(' + idx + ')" style="padding:0.2rem 0.55rem;font-size:0.72rem;border-radius:4px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.1);color:#ef4444;cursor:pointer;white-space:nowrap;">Remove</button>' +
      '</div>' +

      // ── COGS type radio ──
      '<div style="display:flex;gap:1.5rem;margin-bottom:1rem;">' +
        _prRadio(idx, 'local',          !isIntl) +
        _prRadio(idx, 'international',   isIntl) +
      '</div>' +

      // ── Cost of Goods Sold ──
      '<div style="font-size:0.72rem;font-weight:800;color:var(--accent,#f97316);letter-spacing:.05em;margin-bottom:0.6rem;">COST OF GOODS SOLD</div>' +
      '<div style="display:grid;grid-template-columns:1fr' + (isIntl ? ' 1fr' : '') + ';gap:0.75rem;margin-bottom:0.75rem;">' +
        _prInput(idx, 'purchaseOfGoods', 'Purchase of Goods', e.purchaseOfGoods) +
        (isIntl ? _prInput(idx, 'bankServiceChargeCOGS', 'Bank Service Charge', e.bankServiceChargeCOGS) : '') +
      '</div>';

    // ── Shipping / Logistics (international only) ──
    if (isIntl) {
      html +=
        '<div style="font-size:0.72rem;font-weight:800;color:#6366f1;letter-spacing:.05em;margin-bottom:0.6rem;margin-top:0.25rem;">SHIPPING / LOGISTICS COSTS</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.75rem;">' +
          _prInput(idx, 'dutiesAndTaxes',            'Duties & Taxes',             e.dutiesAndTaxes) +
          _prInput(idx, 'bankServiceChargeShipping', 'Bank Service Charge',        e.bankServiceChargeShipping) +
        '</div>' +
        // Shipping cost with company selector
        '<div style="display:grid;grid-template-columns:auto 1fr;gap:0.75rem;margin-bottom:0.75rem;align-items:end;">' +
          '<div>' +
            '<div style="font-size:0.72rem;font-weight:600;color:var(--text-muted,#64748b);margin-bottom:0.25rem;">Shipping Company</div>' +
            '<select onchange="prUpdateField(' + idx + ',\'shippingCompany\',this.value)" ' +
              'style="background:var(--surface-2,#f8fafc);border:1px solid var(--border,#334155);color:var(--text-primary,#f1f5f9);border-radius:8px;padding:0.45rem 0.6rem;font-size:0.82rem;">' +
              ['DHL','FourEleven','FedEx','Others'].map(function(co) {
                return '<option value="' + co + '"' + (e.shippingCompany === co ? ' selected' : '') + '>' + co + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          _prInput(idx, 'shippingCost', 'Shipping Cost', e.shippingCost) +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.75rem;">' +
          _prInput(idx, 'localCharges', 'Local Charges', e.localCharges) +
          '<div></div>' +
        '</div>';
    }

    // ── Delivery (both local & international) ──
    html +=
      '<div style="font-size:0.72rem;font-weight:800;color:var(--text-secondary,#94a3b8);letter-spacing:.05em;margin-bottom:0.6rem;margin-top:0.25rem;">DELIVERY</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">' +
        _prInput(idx, 'deliveryToOffice', 'Delivery to Office', e.deliveryToOffice) +
        _prInput(idx, 'deliveryToClient', 'Delivery to Client', e.deliveryToClient) +
      '</div>' +
      '</div>'; // end card
  });

  list.innerHTML = html;
}

function _prRadio(idx, value, checked) {
  var label = value.charAt(0).toUpperCase() + value.slice(1);
  return '<label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.82rem;color:var(--text-primary,#f1f5f9);">' +
    '<input type="radio" name="cogsType_' + idx + '" value="' + value + '"' + (checked ? ' checked' : '') +
    ' onchange="prUpdateField(' + idx + ',\'cogsType\',\'' + value + '\')">' +
    label + '</label>';
}

function _prInput(idx, field, label, value) {
  return '<div>' +
    '<div style="font-size:0.72rem;font-weight:600;color:var(--text-muted,#64748b);margin-bottom:0.25rem;">' + label + '</div>' +
    '<input type="number" min="0" step="0.01" value="' + (value || '') + '" ' +
    'oninput="prUpdateField(' + idx + ',\'' + field + '\',this.value)" ' +
    'style="width:100%;background:var(--surface-2,#f8fafc);border:1px solid var(--border,#334155);color:var(--text-primary,#f1f5f9);border-radius:8px;padding:0.45rem 0.6rem;font-size:0.82rem;box-sizing:border-box;">' +
    '</div>';
}

function calculateProfitReport() {
  if (!_prEntries.length) return;
  var rows = _prEntries.map(function(e) {
    var cogs = e.purchaseOfGoods;
    if (e.cogsType === 'international') {
      cogs += e.bankServiceChargeCOGS + e.dutiesAndTaxes +
              e.bankServiceChargeShipping + e.shippingCost + e.localCharges;
    }
    cogs += e.deliveryToOffice + e.deliveryToClient;
    return Object.assign({}, e, { totalCOGS: cogs, grossProfit: e.sales - cogs });
  });
  _prRenderMatrix(rows);
}

function _prRenderMatrix(rows) {
  var container  = document.getElementById('profitReportContainer');
  var totalRev   = rows.reduce(function(s,r){ return s + r.sales; }, 0);
  var totalCOGS  = rows.reduce(function(s,r){ return s + r.totalCOGS; }, 0);
  var totalGP    = rows.reduce(function(s,r){ return s + r.grossProfit; }, 0);
  var hasIntl    = rows.some(function(r){ return r.cogsType === 'international'; });
  var colCount   = rows.length + 1;

  // ── KPI cards ──
  var kpiHtml =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.75rem;margin-bottom:1.25rem;">' +
    _prKpi('Total Revenue',      totalRev,  '#22c55e') +
    _prKpi('Total COGS',         totalCOGS, '#ef4444') +
    _prKpi('Total Gross Profit', totalGP,   '#f97316') +
    '</div>';

  // ── Matrix table ──
  var tbl = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.8rem;">';

  function blankRow()       { return '<tr><td colspan="' + colCount + '" style="height:8px;"></td></tr>'; }
  function sectionRow(lbl, color) {
    return '<tr style="background:#f8fafc;">' +
      '<td colspan="' + colCount + '" style="padding:0.35rem 0.75rem;font-size:0.7rem;font-weight:800;color:' + color + ';letter-spacing:.06em;">' + lbl + '</td></tr>';
  }
  function labelCell(lbl, bold) {
    return '<td style="padding:0.4rem 0.75rem;font-size:0.74rem;white-space:nowrap;color:var(--text-muted,#64748b);font-weight:' + (bold ? '700' : '600') + ';">' + lbl + '</td>';
  }
  function moneyCell(n, accent, bold, intlOnly, row) {
    if (intlOnly && row.cogsType !== 'international') {
      return '<td style="padding:0.4rem 0.75rem;white-space:nowrap;color:var(--text-muted,#64748b);">—</td>';
    }
    var style = 'padding:0.4rem 0.75rem;white-space:nowrap;';
    style += accent ? 'color:var(--accent,#f97316);font-weight:700;font-size:0.85rem;' :
             bold   ? 'color:var(--text-primary,#f1f5f9);font-weight:700;' :
                      'color:var(--text-primary,#f1f5f9);';
    var display = (n !== null && n !== undefined && n !== '') ? '₱' + fmt(n) : '<span style="color:var(--text-muted);">—</span>';
    return '<td style="' + style + '">' + display + '</td>';
  }
  function textCell(val) {
    return '<td style="padding:0.4rem 0.75rem;white-space:nowrap;color:var(--text-primary,#f1f5f9);font-weight:600;">' + esc(String(val||'—')) + '</td>';
  }

  function dataRow(lbl, bold, cellFn) {
    var r = '<tr style="border-bottom:1px solid #e2e8f0;">' + labelCell(lbl, bold);
    rows.forEach(function(row) { r += cellFn(row); });
    return r + '</tr>';
  }

  tbl += blankRow();
  tbl += dataRow('CLIENT',        false, function(r){ return textCell(r.customerName); });
  tbl += dataRow('SO NO.',        false, function(r){ return textCell(r.soNo); });
  tbl += blankRow();
  tbl += dataRow('SALES',         false, function(r){ return moneyCell(r.sales, false, false, false, r); });
  tbl += dataRow('TOTAL REVENUE', true,  function(r){ return moneyCell(r.sales, false, true,  false, r); });
  tbl += blankRow();
  tbl += sectionRow('COST OF GOODS SOLD', 'var(--accent,#f97316)');
  tbl += dataRow('Purchase of Goods',   false, function(r){ return moneyCell(r.purchaseOfGoods,       false, false, false, r); });

  if (hasIntl) {
    tbl += dataRow('Bank Service Charge', false, function(r){ return moneyCell(r.bankServiceChargeCOGS, false, false, true, r); });
    tbl += blankRow();
    tbl += sectionRow('SHIPPING / LOGISTICS COSTS', '#6366f1');
    tbl += dataRow('Duties & Taxes',      false, function(r){ return moneyCell(r.dutiesAndTaxes,              false, false, true, r); });
    tbl += dataRow('Bank Service Charge', false, function(r){ return moneyCell(r.bankServiceChargeShipping,   false, false, true, r); });
    tbl += dataRow('Shipping Cost',       false, function(r){
      if (r.cogsType !== 'international') return '<td style="padding:0.4rem 0.75rem;color:var(--text-muted);">—</td>';
      var val = r.shippingCost ? '₱' + fmt(r.shippingCost) + ' <span style="font-size:0.68rem;color:var(--text-muted);">(' + esc(r.shippingCompany) + ')</span>' : '<span style="color:var(--text-muted);">—</span>';
      return '<td style="padding:0.4rem 0.75rem;white-space:nowrap;color:var(--text-primary,#f1f5f9);">' + val + '</td>';
    });
    tbl += dataRow('Local Charges',       false, function(r){ return moneyCell(r.localCharges,                false, false, true, r); });
  }

  tbl += dataRow('Delivery to Office', false, function(r){ return moneyCell(r.deliveryToOffice, false, false, false, r); });
  tbl += dataRow('Delivery to Client', false, function(r){ return moneyCell(r.deliveryToClient, false, false, false, r); });
  tbl += blankRow();
  tbl += dataRow('TOTAL COGS',    true, function(r){ return moneyCell(r.totalCOGS,   false, true,  false, r); });
  tbl += blankRow();
  tbl += dataRow('GROSS PROFIT',  true, function(r){ return moneyCell(r.grossProfit, true,  true,  false, r); });

  // Total gross profit footer
  tbl += '<tr style="border-top:2px solid var(--accent,#f97316);">' +
    '<td style="padding:0.6rem 0.75rem;font-size:0.74rem;font-weight:800;color:var(--accent,#f97316);letter-spacing:.04em;white-space:nowrap;">TOTAL GROSS PROFIT</td>' +
    '<td colspan="' + rows.length + '" style="padding:0.6rem 0.75rem;font-weight:800;color:var(--accent,#f97316);font-size:0.95rem;">₱' + fmt(totalGP) + '</td>' +
    '</tr>';

  tbl += '</table></div>';
  container.innerHTML = kpiHtml + tbl;
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Show Save Report button now that a result exists
  document.getElementById('prSaveBtn').style.display = '';
}

function _prKpi(label, value, color) {
  return '<div style="background:var(--surface,#ffffff);border:1px solid var(--border,#334155);border-radius:10px;padding:0.75rem 1rem;border-left:3px solid ' + color + ';">' +
    '<div style="font-size:1.15rem;font-weight:700;color:' + color + ';">₱' + fmt(value) + '</div>' +
    '<div style="font-size:0.72rem;color:var(--text-muted,#64748b);margin-top:0.15rem;">' + label + '</div>' +
  '</div>';
}

async function exportProfitReportExcel() {
  if (!_prEntries.length) return;
  await loadXLSX();
  var headers = ['SO No','Client','COGS Type','Sales','Purchase of Goods',
    'Bank Svc Charge (COGS)','Duties & Taxes','Bank Svc Charge (Shipping)',
    'Shipping Company','Shipping Cost','Local Charges',
    'Delivery to Office','Delivery to Client','Total COGS','Gross Profit'];
  var dataRows = _prEntries.map(function(e) {
    var isIntl = e.cogsType === 'international';
    var cogs = e.purchaseOfGoods + e.deliveryToOffice + e.deliveryToClient;
    if (isIntl) cogs += e.bankServiceChargeCOGS + e.dutiesAndTaxes + e.bankServiceChargeShipping + e.shippingCost + e.localCharges;
    return [e.soNo, e.customerName, e.cogsType, e.sales, e.purchaseOfGoods,
      isIntl ? e.bankServiceChargeCOGS : '', isIntl ? e.dutiesAndTaxes : '',
      isIntl ? e.bankServiceChargeShipping : '', isIntl ? e.shippingCompany : '',
      isIntl ? e.shippingCost : '', isIntl ? e.localCharges : '',
      e.deliveryToOffice, e.deliveryToClient, cogs, e.sales - cogs];
  });
  var totalGP = dataRows.reduce(function(s,r){ return s + r[14]; }, 0);
  dataRows.push(['','','TOTAL GROSS PROFIT','','','','','','','','','','','',totalGP]);
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(dataRows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Profit Report');
  XLSX.writeFile(wb, 'profit-report-' + new Date().toISOString().slice(0,7) + '.xlsx');
}

// ── Save current report ──────────────────────────────────────────
async function saveProfitReport() {
  if (!_prEntries.length) return;
  if (_prReportSaved) {
    alert('This report has already been saved. Add, remove, or edit entries to save a new version.');
    return;
  }
  var btn = document.getElementById('prSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  // Compute totals before saving
  var entries = _prEntries.map(function(e) {
    var cogs = e.purchaseOfGoods + e.deliveryToOffice + e.deliveryToClient;
    if (e.cogsType === 'international') {
      cogs += e.bankServiceChargeCOGS + e.dutiesAndTaxes +
              e.bankServiceChargeShipping + e.shippingCost + e.localCharges;
    }
    return Object.assign({}, e, { totalCOGS: cogs, grossProfit: e.sales - cogs });
  });

  var now = new Date();
  var reportId   = now.getFullYear() + ('0'+(now.getMonth()+1)).slice(-2) + ('0'+now.getDate()).slice(-2) +
                   '-' + ('0'+now.getHours()).slice(-2) + ('0'+now.getMinutes()).slice(-2) + ('0'+now.getSeconds()).slice(-2);
  var reportDate = now.toISOString().slice(0, 10);

  try {
    var result = await apiSaveProfitReport(reportId, reportDate, entries);
    if (!result.success) throw new Error(result.message || 'Save failed');
    _prReportSaved = true;
    btn.textContent = 'Saved ✓';
    btn.style.color = '#22c55e';
    setTimeout(function() {
      btn.textContent = 'Save Report';
      btn.style.color = '';
      btn.disabled = false;
    }, 2000);
    loadSavedProfitReports(); // refresh saved list
  } catch (err) {
    alert('Error saving: ' + err.message);
    btn.textContent = 'Save Report';
    btn.disabled = false;
  }
}

// ── Load & render saved reports ──────────────────────────────────
async function loadSavedProfitReports() {
  var el = document.getElementById('savedProfitReportsList');
  el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted,#64748b);">Loading...</div>';
  try {
    var result = await apiGetProfitReports();
    if (!result.success) throw new Error(result.message || 'Failed');
    renderSavedProfitReports(result.data || []);
  } catch (err) {
    el.innerHTML = '<div style="color:#ef4444;padding:0.5rem;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderSavedProfitReports(reports) {
  var el = document.getElementById('savedProfitReportsList');
  el._savedReports = reports;

  if (!reports.length) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted,#64748b);">No saved reports yet.</div>';
    return;
  }

  // Filter bar
  var filterHtml =
    '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;margin-bottom:0.75rem;">' +
      '<input type="month" id="prSavedMonthFilter" oninput="_prApplySavedFilters()" ' +
        'style="padding:0.35rem 0.6rem;border-radius:8px;border:1px solid var(--border,#334155);background:var(--bg,#f8fafc);color:var(--text-primary,#f1f5f9);font-size:0.8rem;">' +
      '<input type="text" id="prSavedClientFilter" placeholder="Filter by client..." oninput="_prApplySavedFilters()" ' +
        'style="flex:1;min-width:140px;padding:0.35rem 0.6rem;border-radius:8px;border:1px solid var(--border,#334155);background:var(--bg,#f8fafc);color:var(--text-primary,#f1f5f9);font-size:0.8rem;">' +
      '<button onclick="_prClearSavedFilters()" style="padding:0.35rem 0.65rem;border-radius:8px;border:1px solid var(--border,#334155);background:transparent;color:var(--text-muted,#64748b);font-size:0.78rem;cursor:pointer;">Clear</button>' +
    '</div>' +
    '<div id="prSavedTableContainer"></div>';

  el.innerHTML = filterHtml;
  _prRenderSavedTable(reports);
}

function _prApplySavedFilters() {
  var el = document.getElementById('savedProfitReportsList');
  var reports = el._savedReports || [];
  var month  = (document.getElementById('prSavedMonthFilter')  || {}).value || '';
  var client = ((document.getElementById('prSavedClientFilter') || {}).value || '').toLowerCase().trim();

  var filtered = reports.map(function(report) {
    var entries = report.entries.filter(function(e) {
      var dateMatch  = !month  || String(e.soDate || report.reportDate).slice(0, 7) === month;
      var clientMatch = !client || (e.customerName || '').toLowerCase().indexOf(client) !== -1;
      return dateMatch && clientMatch;
    });
    return Object.assign({}, report, { entries: entries });
  }).filter(function(r) { return r.entries.length > 0; });

  _prRenderSavedTable(filtered);
}

function _prClearSavedFilters() {
  var mf = document.getElementById('prSavedMonthFilter');
  var cf = document.getElementById('prSavedClientFilter');
  if (mf) mf.value = '';
  if (cf) cf.value = '';
  var el = document.getElementById('savedProfitReportsList');
  _prRenderSavedTable(el._savedReports || []);
}

function _prRenderSavedTable(reports) {
  var container = document.getElementById('prSavedTableContainer');
  if (!container) return;
  if (!reports.length) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted,#64748b);font-size:0.82rem;">No records match the filter.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.82rem;">' +
    '<thead><tr style="border-bottom:1px solid var(--border,#334155);">' +
    ['SO Date','Client','SO No','Revenue','COGS','Gross Profit',''].map(function(h) {
      return '<th style="text-align:left;padding:0.5rem 0.75rem;font-size:0.74rem;font-weight:600;color:var(--text-muted,#64748b);white-space:nowrap;">' + h + '</th>';
    }).join('') +
    '</tr></thead><tbody>';

  reports.forEach(function(report) {
    // Report header row
    html += '<tr style="background:#f8fafc;border-top:2px solid var(--border,#334155);">' +
      '<td colspan="6" style="padding:0.35rem 0.75rem;font-size:0.72rem;font-weight:700;color:var(--text-muted,#64748b);text-transform:uppercase;letter-spacing:0.04em;">' +
        'Report: ' + esc(report.reportDate) +
      '</td>' +
      '<td style="padding:0.35rem 0.75rem;">' +
        '<button onclick=\'prViewSaved(' + JSON.stringify(report.reportId) + ')\' ' +
        'style="padding:0.18rem 0.55rem;font-size:0.7rem;border-radius:4px;border:1px solid var(--border,#334155);background:transparent;color:var(--text-primary,#f1f5f9);cursor:pointer;white-space:nowrap;">View Matrix</button>' +
      '</td>' +
    '</tr>';

    // One row per SO entry
    report.entries.forEach(function(e) {
      var gpColor = (e.grossProfit || 0) >= 0 ? '#22c55e' : '#ef4444';
      html += '<tr style="border-bottom:1px solid #e2e8f0;">' +
        '<td style="padding:0.45rem 0.75rem;white-space:nowrap;color:var(--text-muted,#64748b);font-size:0.78rem;">' + esc(e.soDate || report.reportDate) + '</td>' +
        '<td style="padding:0.45rem 0.75rem;color:var(--text-primary,#f1f5f9);font-weight:600;">' + esc(e.customerName || '') + '</td>' +
        '<td style="padding:0.45rem 0.75rem;color:var(--text-muted,#64748b);font-size:0.78rem;">' + esc(e.soNo || '') + '</td>' +
        '<td style="padding:0.45rem 0.75rem;white-space:nowrap;">₱' + fmt(e.sales || 0) + '</td>' +
        '<td style="padding:0.45rem 0.75rem;white-space:nowrap;color:#ef4444;">₱' + fmt(e.totalCOGS || 0) + '</td>' +
        '<td style="padding:0.45rem 0.75rem;white-space:nowrap;font-weight:700;color:' + gpColor + ';">₱' + fmt(e.grossProfit || 0) + '</td>' +
        '<td style="padding:0.45rem 0.75rem;">' +
          '<button onclick=\'prEditEntry(' + JSON.stringify(report.reportId) + ',' + JSON.stringify(e.soNo) + ')\' ' +
          'style="padding:0.18rem 0.55rem;font-size:0.7rem;border-radius:4px;border:1px solid rgba(59,130,246,0.3);background:rgba(59,130,246,0.1);color:#3b82f6;cursor:pointer;">Edit</button>' +
        '</td>' +
      '</tr>';
    });

    // Report total row
    var totRev  = report.entries.reduce(function(s,e){ return s + (e.sales || 0); }, 0);
    var totCOGS = report.entries.reduce(function(s,e){ return s + (e.totalCOGS || 0); }, 0);
    var totGP   = report.entries.reduce(function(s,e){ return s + (e.grossProfit || 0); }, 0);
    var totGPColor = totGP >= 0 ? '#22c55e' : '#ef4444';
    html += '<tr style="border-bottom:2px solid var(--border,#334155);background:#f8fafc;">' +
      '<td style="padding:0.35rem 0.75rem;"></td>' +
      '<td style="padding:0.35rem 0.75rem;font-size:0.72rem;font-weight:700;color:var(--text-muted,#64748b);text-transform:uppercase;letter-spacing:0.04em;" colspan="2">Report Total</td>' +
      '<td style="padding:0.35rem 0.75rem;white-space:nowrap;font-weight:700;">₱' + fmt(totRev) + '</td>' +
      '<td style="padding:0.35rem 0.75rem;white-space:nowrap;font-weight:700;color:#ef4444;">₱' + fmt(totCOGS) + '</td>' +
      '<td style="padding:0.35rem 0.75rem;white-space:nowrap;font-weight:700;color:' + totGPColor + ';">₱' + fmt(totGP) + '</td>' +
      '<td></td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function prViewSaved(reportId) {
  var el = document.getElementById('savedProfitReportsList');
  var reports = el._savedReports || [];
  var report = reports.find(function(r){ return r.reportId === reportId; });
  if (!report) return;
  _prRenderMatrix(report.entries);
  document.getElementById('profitReportContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Profit Report Entry Edit Modal ─────────────────
var _prEditCurrent = null;

function prEditToggleIntl(isIntl) {
  var intlSection = document.getElementById('prEditIntlSection');
  var bscWrap = document.getElementById('prEditBscCogsWrap');
  if (intlSection) intlSection.style.display = isIntl ? '' : 'none';
  if (bscWrap) bscWrap.style.display = isIntl ? '' : 'none';
}

function prEditEntry(reportId, soNo) {
  var el = document.getElementById('savedProfitReportsList');
  var reports = el._savedReports || [];
  var entry = null;
  var foundReport = null;
  reports.forEach(function(r) {
    r.entries.forEach(function(e) {
      if (r.reportId === reportId && e.soNo === soNo) { entry = e; foundReport = r; }
    });
  });
  if (!entry) return;
  _prEditCurrent = { reportId: reportId, soNo: soNo };

  var soLabel = document.getElementById('prEditSOLabel');
  if (soLabel) soLabel.textContent = soNo;

  document.getElementById('prEditSODate').value = entry.soDate || (foundReport ? foundReport.reportDate : '') || '';
  document.getElementById('prEditSales').value = entry.sales || 0;

  var isIntl = entry.cogsType === 'international';
  document.querySelectorAll('[name="prEditCogsType"]').forEach(function(r) { r.checked = r.value === (entry.cogsType || 'local'); });
  prEditToggleIntl(isIntl);

  document.getElementById('prEditPurchaseOfGoods').value = entry.purchaseOfGoods || 0;
  document.getElementById('prEditBankServiceChargeCOGS').value = entry.bankServiceChargeCOGS || 0;
  document.getElementById('prEditDutiesAndTaxes').value = entry.dutiesAndTaxes || 0;
  document.getElementById('prEditBankServiceChargeShipping').value = entry.bankServiceChargeShipping || 0;
  var shipSel = document.getElementById('prEditShippingCompany');
  if (shipSel) shipSel.value = entry.shippingCompany || 'DHL';
  document.getElementById('prEditShippingCost').value = entry.shippingCost || 0;
  document.getElementById('prEditLocalCharges').value = entry.localCharges || 0;
  document.getElementById('prEditDeliveryToOffice').value = entry.deliveryToOffice || 0;
  document.getElementById('prEditDeliveryToClient').value = entry.deliveryToClient || 0;

  document.getElementById('prEditOverlay').style.display = 'flex';
}

function closePrEditModal() {
  document.getElementById('prEditOverlay').style.display = 'none';
  _prEditCurrent = null;
}

async function prSaveEdit() {
  if (!_prEditCurrent) return;
  var btn = document.getElementById('prEditSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  var isIntl = (document.querySelector('[name="prEditCogsType"]:checked') || {}).value === 'international';
  var entry = {
    soDate:                    document.getElementById('prEditSODate').value,
    sales:                     parseFloat(document.getElementById('prEditSales').value) || 0,
    cogsType:                  isIntl ? 'international' : 'local',
    purchaseOfGoods:           parseFloat(document.getElementById('prEditPurchaseOfGoods').value) || 0,
    bankServiceChargeCOGS:     parseFloat(document.getElementById('prEditBankServiceChargeCOGS').value) || 0,
    dutiesAndTaxes:            parseFloat(document.getElementById('prEditDutiesAndTaxes').value) || 0,
    bankServiceChargeShipping: parseFloat(document.getElementById('prEditBankServiceChargeShipping').value) || 0,
    shippingCompany:           document.getElementById('prEditShippingCompany').value,
    shippingCost:              parseFloat(document.getElementById('prEditShippingCost').value) || 0,
    localCharges:              parseFloat(document.getElementById('prEditLocalCharges').value) || 0,
    deliveryToOffice:          parseFloat(document.getElementById('prEditDeliveryToOffice').value) || 0,
    deliveryToClient:          parseFloat(document.getElementById('prEditDeliveryToClient').value) || 0
  };
  try {
    var result = await apiUpdateProfitReportEntry(_prEditCurrent.reportId, _prEditCurrent.soNo, entry);
    if (!result.success) throw new Error(result.message || 'Update failed');
    closePrEditModal();
    clearApiCache();
    await loadSavedProfitReports();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

// ─── AR Aging Tab ─────────────────────────────────

function _arBucketOf(pastDueDays, balance, isCollected) {
  if (isCollected) return 'paid';
  if (pastDueDays <= 0) return 'current';
  if (pastDueDays <= 30) return '1-30';
  if (pastDueDays <= 60) return '31-60';
  if (pastDueDays <= 90) return '61-90';
  return '90+';
}

function _arBucketLabel(b) {
  return { 'current':'Current', '1-30':'1–30 days', '31-60':'31–60 days', '61-90':'61–90 days', '90+':'90+ days', 'paid':'Paid' }[b] || b;
}

function _arBucketColor(b) {
  return { 'current':'#22c55e', '1-30':'#eab308', '31-60':'#f97316', '61-90':'#ef4444', '90+':'#991b1b', 'paid':'#94a3b8' }[b] || '#94a3b8';
}

function _arPastDueDays(dueDate, isCollected) {
  if (!dueDate || isCollected) return 0;
  var due = new Date(dueDate);
  if (isNaN(due)) return 0;
  var today = new Date(); today.setHours(0,0,0,0);
  due.setHours(0,0,0,0);
  return Math.max(0, Math.round((today - due) / 86400000));
}

async function loadArAging(force) {
  if (force) collectionsLoaded = false;
  var container = document.getElementById('arAgingContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading AR aging...</span></div>';
  try {
    if (!collectionsData.length || force) {
      var r = await apiGetCollections();
      if (r && r.success) collectionsData = r.data || [];
      collectionsLoaded = true;
    }
    arAgingData = collectionsData.map(function(c) {
      var balance = (parseFloat(c.totalAmountDue) || 0) - (parseFloat(c.amountReceived) || 0);
      var isCollected = balance <= 0 && (parseFloat(c.totalAmountDue) || 0) > 0;
      var pdd = _arPastDueDays(c.dueDate, isCollected);
      return Object.assign({}, c, {
        _balance: balance,
        _pastDueDays: pdd,
        _bucket: _arBucketOf(pdd, balance, isCollected),
        _isCollected: isCollected,
      });
    });
    renderArAging();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderArAging() {
  var bucketFilter = document.getElementById('arBucketFilter').value;
  var search = (document.getElementById('arSearch').value || '').toLowerCase();
  var filtered = arAgingData.filter(function(r) {
    if (bucketFilter && r._bucket !== bucketFilter) return false;
    if (search) {
      var hay = ((r.invoiceNo || '') + ' ' + (r.companyName || '') + ' ' + (r.customerId || '') + ' ' + (r.soNo || '') + ' ' + (r.poNo || '')).toLowerCase();
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  });
  renderArKpis(arAgingData);
  renderArTable(filtered);
}

function renderArKpis(data) {
  var buckets = { 'current':{n:0,t:0}, '1-30':{n:0,t:0}, '31-60':{n:0,t:0}, '61-90':{n:0,t:0}, '90+':{n:0,t:0} };
  data.forEach(function(r) {
    if (r._isCollected) return;
    if (buckets[r._bucket]) { buckets[r._bucket].n++; buckets[r._bucket].t += r._balance; }
  });
  var html = '';
  ['current','1-30','31-60','61-90','90+'].forEach(function(b) {
    var c = _arBucketColor(b);
    html += '<div onclick="document.getElementById(\'arBucketFilter\').value=\'' + b + '\';renderArAging();" style="cursor:pointer;background:var(--surface,#1e293b);border:1px solid var(--border,#334155);border-left:4px solid ' + c + ';border-radius:10px;padding:0.85rem 1rem;">'
      + '<div style="font-size:0.7rem;font-weight:700;color:' + c + ';text-transform:uppercase;letter-spacing:.05em;">' + _arBucketLabel(b) + '</div>'
      + '<div style="font-size:1.25rem;font-weight:800;margin-top:0.2rem;">' + peso(buckets[b].t) + '</div>'
      + '<div style="font-size:0.72rem;color:var(--text-muted,#64748b);margin-top:0.15rem;">' + buckets[b].n + ' invoice' + (buckets[b].n === 1 ? '' : 's') + '</div>'
      + '</div>';
  });
  document.getElementById('arKpiBar').innerHTML = html;
}

function renderArTable(data) {
  var container = document.getElementById('arAgingContainer');
  if (!data.length) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No matching AR records.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto;"><table class="acct-table"><thead><tr>'
    + '<th>Invoice No.</th><th>DR No.</th><th>S.I. Date</th><th>Customer</th><th>SO #</th><th>PO No.</th>'
    + '<th>Terms</th><th>Total Sales</th><th>EWT</th><th>Less EWT</th><th>Due Date</th><th>Paid</th>'
    + '<th>Balance</th><th>Past Due</th><th>Last Follow-Up</th><th>Remarks</th><th>Notes</th><th>Actions</th>'
    + '</tr></thead><tbody>';
  data.forEach(function(r) {
    var bColor = _arBucketColor(r._bucket);
    var totalSales = parseFloat(r.totalAmountDue) || 0;
    var ewt = parseFloat(r.ewt) || 0;
    var lessEwt = totalSales - ewt;
    var pddCell = r._isCollected
      ? '<span style="color:#22c55e;font-weight:600;">Paid</span>'
      : (r._pastDueDays > 0
          ? '<span style="background:' + bColor + ';color:#fff;padding:0.1rem 0.5rem;border-radius:4px;font-weight:700;">' + r._pastDueDays + 'd</span>'
          : '<span style="color:var(--text-muted);">—</span>');
    var soCell = r.soNo
      ? '<a href="javascript:void(0)" onclick="jumpToSo(\'' + esc(r.soNo) + '\')" style="color:#60a5fa;text-decoration:underline;">' + esc(r.soNo) + '</a>'
      : '<span style="color:var(--text-muted);">—</span>';
    var notesShort = r.notes ? esc(String(r.notes).slice(0, 40)) + (String(r.notes).length > 40 ? '…' : '') : '—';
    html += '<tr style="border-left:3px solid ' + bColor + ';">';
    html += '<td style="font-weight:600;">' + esc(r.invoiceNo) + '</td>';
    html += '<td>' + esc(r.drNo || '—') + '</td>';
    html += '<td style="white-space:nowrap;">' + esc(r.siDate || r.date || '—') + '</td>';
    html += '<td style="font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.companyName) + '">' + esc(r.companyName) + '</td>';
    html += '<td>' + soCell + '</td>';
    html += '<td>' + esc(r.poNo || '—') + '</td>';
    html += '<td>' + esc(r.paymentTerms || '—') + '</td>';
    html += '<td>' + peso(totalSales) + '</td>';
    html += '<td>' + peso(ewt) + '</td>';
    html += '<td>' + peso(lessEwt) + '</td>';
    html += '<td style="white-space:nowrap;' + (r._pastDueDays > 0 && !r._isCollected ? 'color:#ef4444;font-weight:600;' : '') + '">' + esc(r.dueDate || '—') + '</td>';
    html += '<td style="color:#22c55e;font-weight:600;">' + peso(r.amountReceived || 0) + '</td>';
    html += '<td style="font-weight:700;">' + peso(r._balance > 0 ? r._balance : 0) + '</td>';
    html += '<td>' + pddCell + '</td>';
    html += '<td style="white-space:nowrap;color:var(--text-muted);">' + esc(r.lastFollowUpDate || '—') + '</td>';
    html += '<td>' + esc(r.remarks || '—') + '</td>';
    html += '<td title="' + esc(r.notes || '') + '" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);">' + notesShort + '</td>';
    html += '<td style="white-space:nowrap;">';
    html += '<button onclick="editCollection(' + r.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.45rem;border-radius:4px;border:1px solid rgba(59,130,246,0.3);background:rgba(59,130,246,0.12);color:#60a5fa;cursor:pointer;margin-right:4px;">Edit</button>';
    html += '<button onclick="openAcctFollowUpEmail(' + r.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.45rem;border-radius:4px;border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.12);color:#818cf8;cursor:pointer;margin-right:4px;">Follow Up</button>';
    html += '<button onclick="openAcctCollectionEmail(' + r.rowIndex + ')" style="font-size:0.68rem;padding:0.12rem 0.45rem;border-radius:4px;border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.12);color:#fbbf24;cursor:pointer;">Collection</button>';
    html += '</td></tr>';
    // Also stash data so the email modal can pre-fill from AR rows
    _acctEmailDataMap[r.rowIndex] = {
      ref: r.invoiceNo, name: r.companyName || '', email: '',
      dueDate: r.dueDate || '', amount: peso(totalSales), balance: peso(r._balance > 0 ? r._balance : 0)
    };
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function jumpToSo(soNo) {
  switchAcctTab('sales-orders');
  setTimeout(function() {
    var s = document.getElementById('soSearch');
    if (s) { s.value = soNo; loadSalesOrders(); }
  }, 50);
}

async function exportArAgingExcel() {
  if (!arAgingData.length) { alert('No data to export.'); return; }
  await loadXLSX();
  var headers = ['INVOICE NO.','DR NO.','DATE RECEIVED','CUSTOMER ID','COMPANY NAME','SO #','PO NO.','S.I. Date','PAYMENT TERMS',
    'NET OF VAT','LESS VAT','TOTAL SALES (VAT INC.)','EWT','AMOUNT LESS EWT','DUE DATE','PAID AMOUNT','BALANCE','PAST DUE (DAYS)','LAST FOLLOW-UP DATE','REMARKS','NOTES'];
  var rows = arAgingData.map(function(r) {
    var totalSales = parseFloat(r.totalAmountDue) || 0;
    var ewt = parseFloat(r.ewt) || 0;
    return [r.invoiceNo || '', r.drNo || '', r.dateReceived || '', r.customerId || '', r.companyName || '',
      r.soNo || '', r.poNo || '', r.siDate || '', r.paymentTerms || '',
      r.netOfVat || '', r.vat || '', totalSales, ewt, totalSales - ewt,
      r.dueDate || '', r.amountReceived || 0, r._balance > 0 ? r._balance : 0,
      r._pastDueDays || 0, r.lastFollowUpDate || '', r.remarks || (r._isCollected ? 'PAID' : 'UNPAID'), r.notes || ''];
  });
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FOR COLLECTION');
  XLSX.writeFile(wb, 'ar-aging-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

// ─── Accounting Email Modal (Follow Up / Collection) ─────────────

function openAcctFollowUpEmail(rowIdx) {
  const d = _acctEmailDataMap[rowIdx] || {};
  _acctEmailType = 'followup';
  _acctEmailRef  = String(rowIdx);
  document.getElementById('acctEmailTitle').textContent   = 'Send Follow-Up Email';
  document.getElementById('acctEmailTo').value            = d.email || '';
  document.getElementById('acctEmailSubject').value       = `Follow-Up: Invoice ${d.ref || ''}`;
  document.getElementById('acctEmailBody').value          =
    `Dear ${d.name || 'Sir/Ma\'am'},\n\n` +
    `I hope this message finds you well. I am following up regarding Invoice No. ${d.ref || ''}` +
    (d.dueDate ? ` with a due date of ${d.dueDate}` : '') + `.\n\n` +
    (d.balance && d.balance !== '₱0.00' ? `Outstanding Balance: ${d.balance}\n\n` : '') +
    `Kindly let us know the status of the payment or if you need any clarification.\n\n` +
    `Best regards,\nHi-Escorp Accounting Team`;
  document.getElementById('acctEmailModal').classList.add('open');
}

function openAcctCollectionEmail(rowIdx) {
  const d = _acctEmailDataMap[rowIdx] || {};
  _acctEmailType = 'collection';
  _acctEmailRef  = String(rowIdx);
  document.getElementById('acctEmailTitle').textContent   = 'Send Collection Notice';
  document.getElementById('acctEmailTo').value            = d.email || '';
  document.getElementById('acctEmailSubject').value       = `Collection Notice: Invoice ${d.ref || ''}`;
  document.getElementById('acctEmailBody').value          =
    `Dear ${d.name || 'Sir/Ma\'am'},\n\n` +
    `This is a formal collection notice for the following outstanding account:\n\n` +
    `Invoice No.  : ${d.ref || ''}\n` +
    (d.amount ? `Total Amount : ${d.amount}\n` : '') +
    (d.balance ? `Balance Due  : ${d.balance}\n` : '') +
    (d.dueDate ? `Due Date     : ${d.dueDate}\n` : '') +
    `\nWe kindly request that the outstanding balance be settled at your earliest convenience. ` +
    `If payment has already been made, please disregard this notice and provide proof of payment.\n\n` +
    `For any concerns, please do not hesitate to contact us.\n\n` +
    `Best regards,\nHi-Escorp Accounting Team`;
  document.getElementById('acctEmailModal').classList.add('open');
}

function closeAcctEmailModal() {
  document.getElementById('acctEmailModal').classList.remove('open');
  _acctEmailType = '';
  _acctEmailRef  = '';
}

async function sendAcctEmail() {
  const to      = document.getElementById('acctEmailTo').value.trim();
  const subject = document.getElementById('acctEmailSubject').value.trim();
  const body    = document.getElementById('acctEmailBody').value.trim();
  if (!to)      { alert('Recipient email is required.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { alert('Please enter a valid email address.'); return; }
  if (!subject) { alert('Subject is required.'); return; }
  if (!body)    { alert('Message body is required.'); return; }
  const btn = document.getElementById('acctBtnSend');
  btn.disabled = true;
  btn.textContent = 'Sending\u2026';
  try {
    const sentType = _acctEmailType;
    const sentRef  = _acctEmailRef;
    const res = await apiSendAcctEmail({ ref: sentRef, type: sentType, to, subject, body });
    if (!res.success) throw new Error(res.message);
    if (sentType === 'followup' && sentRef) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        await apiUpdateCollection({ rowIndex: sentRef, lastFollowUpDate: today });
        if (arAgingLoaded) await loadArAging(true);
        if (typeof loadCollections === 'function' && document.getElementById('panel-collections')?.classList.contains('active')) {
          await loadCollections();
        }
      } catch (e) { console.warn('lastFollowUpDate stamp failed:', e); }
    }
    alert('Email sent successfully to ' + to);
    closeAcctEmailModal();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Email';
  }
}

// ═══════════════════════════════════════════════════
// SHIPMENTS TAB (read-only mirror of Admin shipment monitoring)
// ═══════════════════════════════════════════════════

var _acctShipments = [];

async function loadShipmentsForAcct() {
  var container = document.getElementById('shipmentsContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">Loading shipments…</div>';
  try {
    var res = await apiGetShipments();
    if (!res || !res.success) throw new Error((res && res.message) || 'Failed to load shipments');
    _acctShipments = Array.isArray(res.data) ? res.data : [];
    renderShipmentsTable();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function _shipBadge(status) {
  var s = String(status || 'Pending');
  var color = '#94a3b8', bg = 'rgba(148,163,184,0.15)';
  var key = s.toLowerCase();
  if (key === 'delivered')              { color = '#22c55e'; bg = 'rgba(34,197,94,0.15)'; }
  else if (key === 'in transit')        { color = '#3b82f6'; bg = 'rgba(59,130,246,0.15)'; }
  else if (key === 'arrived')           { color = '#10b981'; bg = 'rgba(16,185,129,0.15)'; }
  else if (key === 'customs clearance') { color = '#a855f7'; bg = 'rgba(168,85,247,0.15)'; }
  else if (key === 'booked')            { color = '#6366f1'; bg = 'rgba(99,102,241,0.15)'; }
  else if (key === 'goods ready')       { color = '#14b8a6'; bg = 'rgba(20,184,166,0.15)'; }
  else if (key === 'payment processing'){ color = '#f59e0b'; bg = 'rgba(245,158,11,0.15)'; }
  else if (key === 'awaiting confirmation') { color = '#eab308'; bg = 'rgba(234,179,8,0.15)'; }
  else if (key === 'pending')           { color = '#f97316'; bg = 'rgba(249,115,22,0.15)'; }
  return '<span style="display:inline-block;padding:0.18rem 0.55rem;border-radius:999px;font-size:0.72rem;font-weight:600;background:' + bg + ';color:' + color + ';">' + esc(s) + '</span>';
}

function renderShipmentsTable() {
  var container = document.getElementById('shipmentsContainer');
  if (!container) return;
  var search = (document.getElementById('shipSearch').value || '').toLowerCase().trim();
  var statusFilter = document.getElementById('shipStatusFilter').value || '';

  var rows = _acctShipments.filter(function (s) {
    if (statusFilter && String(s.status || '').toLowerCase() !== statusFilter.toLowerCase()) return false;
    if (search) {
      var hay = ((s.shipmentId || '') + ' ' + (s.poNo || '') + ' ' + (s.client || '') + ' ' + (s.principal || '') + ' ' + (s.item || '') + ' ' + (s.awb || '')).toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  });

  if (!rows.length) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No shipments match these filters.</div>';
    return;
  }

  var html = '<div style="overflow-x:auto;"><table class="acct-table"><thead><tr>';
  html += '<th>Shipment ID</th><th>PO #</th><th>Client</th><th>Principal</th><th>Mode</th><th>ETD</th><th>ETA</th><th>Status</th><th style="text-align:right;">Total</th><th style="text-align:right;">Paid</th>';
  html += '</tr></thead><tbody>';

  rows.forEach(function (s) {
    var idx = _acctShipments.indexOf(s);
    html += '<tr style="cursor:pointer;" onclick="openShipmentDetails(' + idx + ')">';
    html += '<td style="font-weight:600;white-space:nowrap;color:#60a5fa;">' + esc(s.shipmentId || '—') + '</td>';
    html += '<td style="white-space:nowrap;">' + esc(s.poNo || '—') + '</td>';
    html += '<td>' + esc(s.client || '—') + '</td>';
    html += '<td style="color:var(--text-muted);font-size:0.78rem;">' + esc(s.principal || '—') + '</td>';
    html += '<td>' + (s.mode ? '<span style="font-size:0.72rem;padding:0.1rem 0.45rem;border-radius:4px;background:rgba(148,163,184,0.15);">' + esc(s.mode) + '</span>' : '—') + '</td>';
    html += '<td style="white-space:nowrap;">' + esc(s.etd || '—') + '</td>';
    html += '<td style="white-space:nowrap;">' + esc(s.eta || '—') + '</td>';
    html += '<td>' + _shipBadge(s.status) + '</td>';
    html += '<td style="text-align:right;font-weight:600;white-space:nowrap;">' + (s.totalAmount ? peso(s.totalAmount) : '—') + '</td>';
    html += '<td style="text-align:right;white-space:nowrap;color:var(--text-muted);">' + (s.amountPaid ? peso(s.amountPaid) : '—') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function _shipParseJSON(str) {
  if (!str || typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch (e) { return null; }
}

function _shipKV(label, value, opts) {
  opts = opts || {};
  var v = (value === '' || value == null) ? '—' : value;
  var color = opts.muted ? 'var(--text-muted,#94a3b8)' : 'var(--text-primary,#e2e8f0)';
  return '<div><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#94a3b8);margin-bottom:0.2rem;">' + esc(label) + '</div>' +
         '<div style="font-size:0.85rem;color:' + color + ';font-weight:' + (opts.bold ? '600' : '500') + ';">' + (opts.html ? v : esc(v)) + '</div></div>';
}

function _shipSection(title, bodyHtml) {
  return '<div style="margin-bottom:1.25rem;">' +
    '<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#94a3b8);margin-bottom:0.5rem;padding-bottom:0.3rem;border-bottom:1px solid var(--border,#334155);">' + esc(title) + '</div>' +
    bodyHtml +
    '</div>';
}

function openShipmentDetails(idx) {
  var s = _acctShipments[idx];
  if (!s) return;

  document.getElementById('shipDetailSubtitle').textContent =
    (s.shipmentId || '—') + ' · PO ' + (s.poNo || '—') + ' · ' + (s.client || '—');

  var html = '';

  // Shipment Info
  html += _shipSection('Shipment', '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.85rem;">' +
    _shipKV('Shipment ID', s.shipmentId, { bold: true }) +
    _shipKV('Status', _shipBadge(s.status), { html: true }) +
    _shipKV('Mode', s.mode) +
    _shipKV('PO #', s.poNo) +
    _shipKV('Client', s.client) +
    _shipKV('Principal / Supplier', s.principal) +
    _shipKV("Client's PO #", s.clientsPO) +
    _shipKV('HI-ESCORP PO #', s.hiescorpPO) +
    _shipKV('Item', s.item) +
    _shipKV('Linked SOs', s.linkedSOs) +
    _shipKV('Created', s.createdDate, { muted: true }) +
  '</div>');

  // Logistics
  html += _shipSection('Logistics', '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.85rem;">' +
    _shipKV('Shipment Date', s.shipmentDate) +
    _shipKV('ETD', s.etd) +
    _shipKV('ETA', s.eta) +
    _shipKV('Date Arrived', s.dateArrived) +
    _shipKV('AWB / Tracking', s.awb) +
    _shipKV('Logistics', s.logistics) +
  '</div>');

  // Costs
  html += _shipSection('Costs', '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.85rem;">' +
    _shipKV('Freight-In', s.freightIn ? peso(s.freightIn) : '—') +
    _shipKV('Import Duties', s.importDuties ? peso(s.importDuties) : '—') +
    _shipKV('Customs / Brokerage', s.brokerage ? peso(s.brokerage) : '—') +
    _shipKV('Handling', s.handling ? peso(s.handling) : '—') +
    _shipKV('Delivery Expense', s.deliveryExpense ? peso(s.deliveryExpense) : '—') +
  '</div>');

  // Payment
  html += _shipSection('Payment', '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.85rem;">' +
    _shipKV('Total Amount', s.totalAmount ? peso(s.totalAmount) : '—', { bold: true }) +
    _shipKV('Amount Paid', s.amountPaid ? peso(s.amountPaid) : '—') +
    _shipKV('Balance', s.balance !== '' && s.balance != null ? peso(s.balance) : '—') +
    _shipKV('Date of Payment', s.dateOfPayment) +
    _shipKV('Payment Status', s.paymentStatus) +
    _shipKV('Payment Method', s.paymentMethod) +
    _shipKV('Sales Invoice', s.salesInvoice) +
    _shipKV('Delivery Receipt', s.deliveryReceipt) +
  '</div>');

  // Stages
  var stagesObj = _shipParseJSON(s.stages);
  var stagesHtml = '<div style="color:var(--text-muted);font-size:0.8rem;">No stage data.</div>';
  if (stagesObj && typeof stagesObj === 'object') {
    var keys = Object.keys(stagesObj);
    if (keys.length) {
      stagesHtml = '<div style="display:flex;flex-direction:column;gap:0.4rem;">' + keys.map(function (k) {
        var st = stagesObj[k] || {};
        var status = st.status || st.state || (st.done ? 'done' : 'pending');
        var done = String(status).toLowerCase() === 'done' || st.done === true;
        var skipped = String(status).toLowerCase() === 'skipped';
        var color = done ? '#22c55e' : (skipped ? '#94a3b8' : '#f59e0b');
        var bg    = done ? 'rgba(34,197,94,0.1)' : (skipped ? 'rgba(148,163,184,0.08)' : 'rgba(245,158,11,0.08)');
        var when = st.completedAt || st.doneAt || st.timestamp || '';
        var who  = st.completedBy || st.doneBy || st.actor || st.by || '';
        var note = st.note || st.remarks || '';
        return '<div style="display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0.6rem;background:' + bg + ';border-left:3px solid ' + color + ';border-radius:4px;">' +
          '<div style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0;"></div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:0.82rem;font-weight:600;color:var(--text-primary);">' + esc(st.label || k) + '</div>' +
            (note ? '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.15rem;">' + esc(note) + '</div>' : '') +
            ((when || who) ? '<div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.15rem;">' + esc(when) + (who ? ' · ' + esc(who) : '') + '</div>' : '') +
          '</div>' +
          '<div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;color:' + color + ';">' + esc(status) + '</div>' +
        '</div>';
      }).join('') + '</div>';
    }
  }
  html += _shipSection('Stage Timeline', stagesHtml);

  // Documents
  var docsObj = _shipParseJSON(s.documents);
  var docsHtml = '<div style="color:var(--text-muted);font-size:0.8rem;">No documents uploaded.</div>';
  if (docsObj && typeof docsObj === 'object') {
    var docKeys = Object.keys(docsObj);
    var rowsHtml = [];
    docKeys.forEach(function (stageKey) {
      var list = docsObj[stageKey];
      if (!Array.isArray(list)) list = [list];
      list.forEach(function (d) {
        if (!d) return;
        var name = d.fileName || d.name || '(unnamed)';
        var url  = d.fileUrl || d.url || d.driveLink || '';
        var when = d.uploadedAt || d.timestamp || '';
        var who  = d.uploadedBy || d.actor || '';
        rowsHtml.push('<tr>' +
          '<td style="padding:0.35rem 0.5rem;color:var(--text-muted);font-size:0.74rem;white-space:nowrap;">' + esc(stageKey) + '</td>' +
          '<td style="padding:0.35rem 0.5rem;">' + (url ? '<a href="' + esc(url) + '" target="_blank" style="color:#60a5fa;text-decoration:none;">' + esc(name) + '</a>' : esc(name)) + '</td>' +
          '<td style="padding:0.35rem 0.5rem;color:var(--text-muted);font-size:0.74rem;white-space:nowrap;">' + esc(who) + '</td>' +
          '<td style="padding:0.35rem 0.5rem;color:var(--text-muted);font-size:0.74rem;white-space:nowrap;">' + esc(when) + '</td>' +
        '</tr>');
      });
    });
    if (rowsHtml.length) {
      docsHtml = '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">' +
        '<thead><tr><th style="text-align:left;padding:0.3rem 0.5rem;font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border);">Stage</th>' +
        '<th style="text-align:left;padding:0.3rem 0.5rem;font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border);">File</th>' +
        '<th style="text-align:left;padding:0.3rem 0.5rem;font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border);">By</th>' +
        '<th style="text-align:left;padding:0.3rem 0.5rem;font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border);">When</th></tr></thead>' +
        '<tbody>' + rowsHtml.join('') + '</tbody></table>';
    }
  }
  html += _shipSection('Documents', docsHtml);

  // Remarks
  if (s.remarks) {
    html += _shipSection('Remarks', '<div style="white-space:pre-wrap;font-size:0.83rem;color:var(--text-primary);background:rgba(148,163,184,0.05);padding:0.6rem 0.8rem;border-radius:6px;border:1px solid var(--border,#334155);">' + esc(s.remarks) + '</div>');
  }

  document.getElementById('shipDetailBody').innerHTML = html;
  document.getElementById('shipDetailOverlay').style.display = '';
}

function closeShipmentDetails() {
  document.getElementById('shipDetailOverlay').style.display = 'none';
}
