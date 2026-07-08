/* ═══════════════════════════════════════════════
   management-home.js — Management Dashboard logic
   READ-ONLY executive overview — no mutations
   ═══════════════════════════════════════════════ */

let plChartInstance = null;

var _financialAllTime = false;
var _storedCollectionsResult = null;
var _storedExpensesResult = null;
var _storedProfitReportsResult = null;
var _storedSoDataResult = null;
var _incomeStatementEntries = [];

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function fmtEmailSentAt(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (e) {
    return d.toLocaleString();
  }
}
function peso(n) { return '₱' + (parseFloat(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

// FX rates → PHP (updated 2026-05-04, source: Google Finance)
const PR_FX_TO_PHP = {
  PHP: 1, USD: 61.47, EUR: 72.11, GBP: 83.54, JPY: 0.3921, SGD: 48.29, AUD: 44.30, CAD: 45.24,
  HKD: 7.85, CNY: 9.00, KRW: 0.0419, INR: 0.6478, MYR: 15.54, THB: 1.8953,
  IDR: 0.0035, VND: 0.0023, TWD: 1.9456, BND: 48.19
};
function prToPHP(amount, currency) {
  var n = parseFloat(amount) || 0;
  var rate = PR_FX_TO_PHP[(currency || 'PHP').toUpperCase()];
  return n * (rate || 1);
}

function kpiCard(label, value, sub, subClass, metric) {
  var clickAttrs = metric ? ' style="cursor:pointer;" onclick="openFinancialModal(\'' + metric + '\')" title="Click to view records"' : '';
  return '<div class="kpi-card"' + clickAttrs + '><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + value + '</div>' +
    (sub ? '<div class="kpi-sub ' + (subClass||'') + '">' + esc(sub) + '</div>' : '') + '</div>';
}

function statItem(label, value, cls) {
  return '<div class="stat-item"><div class="stat-val ' + (cls||'') + '">' + value + '</div><div class="stat-lbl">' + esc(label) + '</div></div>';
}

function makeTargetCell(actual, target, color) {
  if (!target) return '<div class="target-cell"><span class="target-text">' + actual + '</span></div>';
  var pct = Math.min(100, Math.round((actual / target) * 100));
  return '<div class="target-cell"><span class="target-text">' + actual + '</span>' +
    '<div class="target-bar"><div class="target-bar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
    '<span style="font-size:0.7rem;color:var(--text-muted);">' + pct + '%</span></div>';
}

function makeTrendBadge(current, prev) {
  if (prev === 0 && current > 0) return '<span class="trend trend-new">NEW</span>';
  if (prev === 0 && current === 0) return '<span class="trend trend-flat">—</span>';
  var diff = current - prev;
  if (diff > 0) return '<span class="trend trend-up">▲ ' + diff + '</span>';
  if (diff < 0) return '<span class="trend trend-down">▼ ' + Math.abs(diff) + '</span>';
  return '<span class="trend trend-flat">—</span>';
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireManagement();
  if (!session) return;

  clearApiCache();

  renderNavbar('management-home');
  document.getElementById('greeting').innerHTML = getGreeting(session.name);

  // Set today's date for daily reports
  var now = new Date();
  var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  document.getElementById('drReportDate').value = todayStr;

  // Initialize Financial Overview month filter to current month
  var currentMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  document.getElementById('financialMonthFilter').value = currentMonth;

  // Show loading skeletons
  showLoading('financialKPIs', 'stats');

  // Fire all API calls in parallel
  const [acctResult, teamResult, inventoryResult, paymentResult, loginResult, dailyReportsResult, hrSummaryResult, soStatsResult, soDataResult, mroResult, miResult, collectionsResult, expensesResult, profitReportsResult, shipmentsResult, hrRecruitmentResult, hrEmployeesResult, hrLeaveResult, hrReviewsResult, hrTrainingResult, hrTasksResult, hrMemosResult, hrGrievancesResult, hrCampaignsResult, hrContentResult, hrAccredResult, hrBirthdayResult] = await Promise.allSettled([
    fetchFromAPI({ action: 'getAccountingDashboard', range: 'month' }),
    fetchFromAPI({ action: 'getTeamSummary' }),
    fetchFromAPI({ action: 'getInventory' }),
    fetchFromAPI({ action: 'getPaymentRequests' }),
    fetchFromAPI({ action: 'getLoginLog', limit: 20 }),
    fetchFromAPI({ action: 'getAllDailyReports', date: todayStr }),
    apiGetHRSummary(),
    fetchFromAPI({ action: 'getSOStats' }),
    fetchFromAPI({ action: 'getSalesOrders' }),
    fetchFromAPI({ action: 'getAllMROs' }),
    fetchFromAPI({ action: 'getAllMIs' }),
    apiGetCollections(),
    apiGetExpenses(''),
    apiGetProfitReports(),
    fetchFromAPI({ action: 'getShipments' }, { noCache: true }),
    apiGetRecruitmentPipeline(),
    apiGetEmployees(),
    apiGetLeaveRequests(),
    apiGetPerformanceReviews(),
    apiGetTrainingPrograms(),
    apiGetHRTasks(),
    apiGetMemos(),
    apiGetGrievances(),
    apiGetCampaigns(),
    apiGetContentCalendar(),
    apiGetAccreditations(),
    apiGetBirthdayAnniversary()
  ]);

  _storedCollectionsResult = collectionsResult;
  _storedExpensesResult = expensesResult;
  _storedProfitReportsResult = profitReportsResult;
  _storedSoDataResult = soDataResult;
  renderFinancialOverview(acctResult, collectionsResult, soDataResult);
  renderCollectionsFinancials(collectionsResult);
  renderArAgingMgmt(collectionsResult);
  renderIncomeStatement(profitReportsResult);
  renderMonthlyPL(profitReportsResult, expensesResult);
  renderSalesPerformance(teamResult);
  renderInventorySnapshot(inventoryResult);
  renderPaymentRequests(paymentResult);
  renderSalesOrders(soStatsResult, soDataResult);
  renderLoginActivity(loginResult);
  renderDailyReports(dailyReportsResult);
  renderHRSummary(hrSummaryResult);
  renderHRModules({
    recruitment: hrRecruitmentResult,
    employees: hrEmployeesResult,
    leave: hrLeaveResult,
    reviews: hrReviewsResult,
    training: hrTrainingResult,
    tasks: hrTasksResult,
    memos: hrMemosResult,
    grievances: hrGrievancesResult,
    campaigns: hrCampaignsResult,
    content: hrContentResult,
    accred: hrAccredResult,
    birthdays: hrBirthdayResult
  });
  renderMRORecords(mroResult);
  renderMIRecords(miResult);
  renderMgmtExpenses(expensesResult);
  renderMgmtShipments(shipmentsResult);
  renderPayrollApprovals('For Approval');
});

// ═══════════════════════════════════════════════
// Section 1: Financial Overview
// ═══════════════════════════════════════════════

async function renderFinancialOverview(result, collectionsResult, soDataResult) {
  const el = document.getElementById('financialKPIs');
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    el.innerHTML = '<div style="padding:1rem;color:#ef4444;">Could not load financial data</div>';
    return;
  }
  const data = result.value;
  const s = data.summary;

  // ── Receivables: prefer live Collections data over Orders-estimated figure ──
  var colData = (collectionsResult && collectionsResult.status === 'fulfilled' &&
                 collectionsResult.value && collectionsResult.value.success)
    ? (collectionsResult.value.data || []) : null;

  var receivablesAmt, receivablesSubtitle, receivablesClass;
  if (colData !== null) {
    var unpaid = colData.filter(function(r) {
      var due  = parseFloat(r.totalAmountDue) || 0;
      var rcvd = parseFloat(r.amountReceived) || 0;
      // Drop rows that round to zero outstanding (e.g. tiny float remainders
      // or entries with totalAmountDue == amountReceived).
      return (due - rcvd) > 0.005;
    });
    receivablesAmt      = unpaid.reduce(function(s, r) { return s + ((r.totalAmountDue || 0) - (r.amountReceived || 0)); }, 0);
    receivablesSubtitle = unpaid.length + ' unpaid invoice' + (unpaid.length !== 1 ? 's' : '');
    receivablesClass    = receivablesAmt > 0 ? 'kpi-negative' : 'kpi-positive';
  } else {
    receivablesAmt      = s.totalReceivables;
    receivablesSubtitle = 'outstanding';
    receivablesClass    = receivablesAmt > 0 ? 'kpi-negative' : 'kpi-positive';
  }

  // ── Total Revenue: sum grandTotal of Sales Orders dated in 2026 ──
  var REVENUE_YEAR = 2026;
  var soList = (soDataResult && soDataResult.status === 'fulfilled' &&
                soDataResult.value && soDataResult.value.success)
    ? (soDataResult.value.data || []) : [];
  var soInYear = soList.filter(function(o) {
    var d = new Date(o.date || o.soDate || 0);
    return !isNaN(d.getTime()) && d.getFullYear() === REVENUE_YEAR;
  });
  var totalRevenue = soInYear.reduce(function(acc, o) {
    return acc + (parseFloat(o.grandTotal || o.totalAmount || o.amount) || 0);
  }, 0);
  var revenueCount = soInYear.length;

  // ── COGS from saved Profit Reports (grand total) ──
  var totalCOGS = 0;
  if (_storedProfitReportsResult && _storedProfitReportsResult.status === 'fulfilled' &&
      _storedProfitReportsResult.value && _storedProfitReportsResult.value.success) {
    (_storedProfitReportsResult.value.data || []).forEach(function(report) {
      report.entries.forEach(function(e) { totalCOGS += e.totalCOGS || 0; });
    });
  }

  // ── Total Expenses from Expenses sheet (grand total) ──
  var totalExpenses = 0;
  if (_storedExpensesResult && _storedExpensesResult.status === 'fulfilled' &&
      _storedExpensesResult.value && _storedExpensesResult.value.success) {
    (_storedExpensesResult.value.data || []).forEach(function(e) { totalExpenses += e.total || e.amount || 0; });
  }

  // Gross Profit = Total Revenue - COGS; Net Profit = Gross Profit - Expenses
  var displayGrossProfit = totalRevenue - totalCOGS;
  var displayGrossMargin = totalRevenue > 0 ? Math.round((displayGrossProfit / totalRevenue) * 100) : 0;
  var displayNetProfit   = displayGrossProfit - totalExpenses;
  var displayNetMargin   = totalRevenue > 0 ? Math.round((displayNetProfit / totalRevenue) * 100) : 0;

  el.innerHTML =
    kpiCard('Total Revenue', peso(totalRevenue), revenueCount + ' SOs in ' + REVENUE_YEAR, 'kpi-neutral', 'revenue') +
    kpiCard('Total COGS', peso(totalCOGS), 'from profit reports', '', 'cogs') +
    kpiCard('Gross Profit', peso(displayGrossProfit), displayGrossMargin + '% margin', displayGrossProfit >= 0 ? 'kpi-positive' : 'kpi-negative', 'grossprofit') +
    kpiCard('Total Expenses', peso(totalExpenses), '', 'kpi-negative', 'expenses') +
    kpiCard('Net Profit', peso(displayNetProfit), displayNetMargin + '% margin', displayNetProfit >= 0 ? 'kpi-positive' : 'kpi-negative', 'netprofit') +
    kpiCard('AR Outstanding', peso(receivablesAmt), receivablesSubtitle, receivablesClass, 'ar') +
    kpiCard('Payables', peso(s.totalPayables), 'to suppliers', 'kpi-negative', 'payables');

  // Profit Report Summary (loaded separately)

  // P&L Chart
  var monthly = data.monthly || [];
  if (monthly.length > 0) {
    await loadLib('https://cdn.jsdelivr.net/npm/chart.js');
    var ctx = document.getElementById('plChart').getContext('2d');
    if (plChartInstance) plChartInstance.destroy();
    plChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: monthly.map(function(m) { return m.month; }),
        datasets: [
          { label: 'Revenue', data: monthly.map(function(m) { return m.revenue; }), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4, barPercentage: 0.6 },
          { label: 'Expenses', data: monthly.map(function(m) { return m.expenses; }), backgroundColor: 'rgba(239,68,68,0.5)', borderRadius: 4, barPercentage: 0.6 },
          { label: 'Profit', data: monthly.map(function(m) { return m.profit; }), type: 'line', borderColor: '#22c55e', borderWidth: 2, pointRadius: 3, fill: false, tension: 0.3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: '#64748b', font: { size: 10 }, callback: function(v) { return '₱' + (v/1000).toFixed(0) + 'k'; } }, grid: { color: '#e2e8f0' } }
        }
      }
    });
  }
}

function renderCollectionsFinancials(result) {
  var el = document.getElementById('collectionsFinancials');
  if (!el) return;
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    el.innerHTML = '<div style="padding:0.5rem;color:#ef4444;font-size:0.82rem;">Could not load collections data</div>';
    return;
  }
  var data = result.value.data || [];
  var totalInvoiced  = data.reduce(function(s, r) { return s + (r.invoiceAmount || 0); }, 0);
  var totalDue       = data.reduce(function(s, r) { return s + (r.totalAmountDue || 0); }, 0);
  var totalCollected = data.reduce(function(s, r) { return s + (r.amountReceived || 0); }, 0);
  var outstanding    = totalDue - totalCollected;
  var today          = new Date().toISOString().slice(0, 10);
  var overdueRecords = data.filter(function(r) {
    if (!r.dueDate || r.dueDate >= today) return false;
    var due  = Number(r.totalAmountDue) || Number(r.invoiceAmount) || 0;
    var paid = Number(r.amountReceived) || 0;
    return (due - paid) > 0.01;
  });
  var overdueCount = overdueRecords.length;
  var collectionRate = totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0;

  _mgmtOverdueRecords = overdueRecords;

  var overdueCardHtml = kpiCard('Overdue',
    overdueCount + (overdueCount === 1 ? ' record' : ' records'),
    overdueCount > 0 ? 'past due date · click for details' : 'none overdue',
    overdueCount > 0 ? 'kpi-negative' : 'kpi-positive');

  if (overdueCount > 0) {
    overdueCardHtml = '<div onclick="showOverdueDetails()" style="cursor:pointer;" title="View overdue invoices">' + overdueCardHtml + '</div>';
  }

  el.innerHTML =
    kpiCard('Total Invoiced',  peso(totalInvoiced),  data.length + ' records', 'kpi-neutral') +
    kpiCard('Total Collected', peso(totalCollected), collectionRate + '% collection rate', 'kpi-positive') +
    kpiCard('Outstanding',     peso(outstanding),    outstanding > 0 ? 'balance remaining' : 'fully collected', outstanding > 0 ? 'kpi-negative' : 'kpi-positive') +
    overdueCardHtml;
}

var _mgmtOverdueRecords = [];

function showOverdueDetails() {
  var recs = _mgmtOverdueRecords || [];
  var today = new Date(); today.setHours(0,0,0,0);

  var rowsHtml = recs.map(function(r) {
    var due = (Number(r.totalAmountDue) || Number(r.invoiceAmount) || 0);
    var paid = Number(r.amountReceived) || 0;
    var bal = due - paid;
    var dueDate = r.dueDate ? new Date(r.dueDate) : null;
    var daysPast = dueDate && !isNaN(dueDate) ? Math.floor((today - dueDate) / 86400000) : 0;
    return '<tr style="border-bottom:1px solid var(--border,#334155);">' +
      '<td style="padding:0.55rem 0.6rem;font-weight:600;">' + esc(r.invoiceNo || '—') + '</td>' +
      '<td style="padding:0.55rem 0.6rem;">' + esc(r.companyName || '—') + '</td>' +
      '<td style="padding:0.55rem 0.6rem;">' + esc(r.poNo || '—') + '</td>' +
      '<td style="padding:0.55rem 0.6rem;">' + esc(r.dueDate || '—') + '</td>' +
      '<td style="padding:0.55rem 0.6rem;color:#ef4444;font-weight:600;">' + daysPast + ' d</td>' +
      '<td style="padding:0.55rem 0.6rem;text-align:right;">' + peso(due) + '</td>' +
      '<td style="padding:0.55rem 0.6rem;text-align:right;color:#10b981;">' + peso(paid) + '</td>' +
      '<td style="padding:0.55rem 0.6rem;text-align:right;font-weight:700;color:#ef4444;">' + peso(bal) + '</td>' +
    '</tr>';
  }).join('');

  var totalBal = recs.reduce(function(s, r) {
    return s + ((Number(r.totalAmountDue) || Number(r.invoiceAmount) || 0) - (Number(r.amountReceived) || 0));
  }, 0);

  var html =
    '<div id="overdueModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;" onclick="if(event.target===this)closeOverdueModal()">' +
      '<div style="max-width:1080px;width:100%;max-height:90vh;background:var(--surface,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,0.6);display:flex;flex-direction:column;overflow:hidden;">' +
        '<div style="padding:1rem 1.25rem;border-bottom:1px solid var(--border,#334155);display:flex;align-items:center;justify-content:space-between;">' +
          '<div>' +
            '<h3 style="margin:0;font-size:1rem;color:var(--text-primary,#f1f5f9);">Overdue Invoices · ' + recs.length + '</h3>' +
            '<div style="font-size:0.8rem;color:var(--text-muted,#94a3b8);margin-top:0.2rem;">Total outstanding past due: <strong style="color:#ef4444;">' + peso(totalBal) + '</strong></div>' +
          '</div>' +
          '<button onclick="closeOverdueModal()" style="background:transparent;border:none;color:var(--text-muted,#94a3b8);font-size:1.4rem;cursor:pointer;line-height:1;padding:0.2rem 0.5rem;">×</button>' +
        '</div>' +
        '<div style="flex:1;overflow:auto;">' +
          (recs.length === 0
            ? '<div style="padding:2rem;text-align:center;color:var(--text-muted,#94a3b8);">No overdue invoices.</div>'
            : '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">' +
                '<thead style="position:sticky;top:0;background:var(--surface,#1e293b);">' +
                  '<tr style="border-bottom:2px solid var(--border,#334155);color:var(--text-muted,#94a3b8);text-transform:uppercase;letter-spacing:0.04em;font-size:0.72rem;">' +
                    '<th style="padding:0.6rem;text-align:left;">Invoice</th>' +
                    '<th style="padding:0.6rem;text-align:left;">Customer</th>' +
                    '<th style="padding:0.6rem;text-align:left;">PO No.</th>' +
                    '<th style="padding:0.6rem;text-align:left;">Due Date</th>' +
                    '<th style="padding:0.6rem;text-align:left;">Days Past</th>' +
                    '<th style="padding:0.6rem;text-align:right;">Amount Due</th>' +
                    '<th style="padding:0.6rem;text-align:right;">Paid</th>' +
                    '<th style="padding:0.6rem;text-align:right;">Balance</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody>' + rowsHtml + '</tbody>' +
              '</table>'
          ) +
        '</div>' +
      '</div>' +
    '</div>';

  closeOverdueModal();
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeOverdueModal() {
  var m = document.getElementById('overdueModal');
  if (m) m.remove();
}

// ── AR Aging buckets (mgmt view) ─────────────────────────────
function renderArAgingMgmt(result) {
  var el = document.getElementById('arAgingContainer');
  if (!el) return;
  if (!result || result.status === 'rejected' || !result.value || !result.value.success) {
    el.innerHTML = '<div style="padding:0.75rem;color:#ef4444;font-size:0.82rem;">Could not load AR data</div>';
    return;
  }
  var data = result.value.data || [];
  var today = new Date(); today.setHours(0,0,0,0);
  var todayStr = today.toISOString().slice(0,10);
  var buckets = {
    current:   { label: 'Current',     count: 0, amt: 0, color: '#10b981' },
    b30:       { label: '1-30 days',   count: 0, amt: 0, color: '#facc15' },
    b60:       { label: '31-60 days',  count: 0, amt: 0, color: '#fb923c' },
    b90:       { label: '61-90 days',  count: 0, amt: 0, color: '#ef4444' },
    over:      { label: '90+ days',    count: 0, amt: 0, color: '#b91c1c' }
  };
  var totalOutstanding = 0, openCount = 0;
  data.forEach(function(r) {
    var due  = Number(r.totalAmountDue) || Number(r.invoiceAmount) || 0;
    var paid = Number(r.amountReceived) || 0;
    var bal  = due - paid;
    if (!(bal > 0.01)) return;
    openCount++;
    totalOutstanding += bal;
    var b = 'current';
    if (r.dueDate && r.dueDate < todayStr) {
      var dueDate = new Date(r.dueDate);
      var daysPast = isNaN(dueDate) ? 0 : Math.floor((today - dueDate) / 86400000);
      b = daysPast <= 30 ? 'b30' : daysPast <= 60 ? 'b60' : daysPast <= 90 ? 'b90' : 'over';
    }
    buckets[b].count++; buckets[b].amt += bal;
  });

  var rows = '';
  Object.keys(buckets).forEach(function(k) {
    var b = buckets[k];
    var pct = totalOutstanding > 0 ? (b.amt / totalOutstanding * 100) : 0;
    rows +=
      '<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;font-size:0.82rem;">' +
        '<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + b.color + ';flex:0 0 auto;"></span>' +
        '<span style="flex:0 0 90px;color:var(--text-muted,#94a3b8);">' + b.label + '</span>' +
        '<div style="flex:1;background:rgba(148,163,184,0.12);height:8px;border-radius:4px;overflow:hidden;">' +
          '<div style="width:' + pct.toFixed(1) + '%;height:100%;background:' + b.color + ';"></div>' +
        '</div>' +
        '<span style="flex:0 0 110px;text-align:right;font-weight:600;color:var(--text-primary,#f1f5f9);">' + peso(b.amt) + '</span>' +
        '<span style="flex:0 0 38px;text-align:right;color:var(--text-muted,#94a3b8);">' + b.count + '</span>' +
      '</div>';
  });

  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;margin-bottom:0.6rem;font-size:0.78rem;color:var(--text-muted,#94a3b8);">' +
      '<span>' + openCount + ' open invoice' + (openCount !== 1 ? 's' : '') + '</span>' +
      '<span>Total outstanding: <strong style="color:var(--text-primary,#f1f5f9);">' + peso(totalOutstanding) + '</strong></span>' +
    '</div>' +
    rows;
}

function renderIncomeStatement(result) {
  var el = document.getElementById('incomeStatementContainer');
  if (!el) return;
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    el.innerHTML = '<div style="padding:1rem;color:#ef4444;font-size:0.82rem;">Could not load profit reports</div>';
    return;
  }

  // Flatten all entries with reportDate
  _incomeStatementEntries = [];
  (result.value.data || []).forEach(function(report) {
    report.entries.forEach(function(e) {
      _incomeStatementEntries.push({
        reportDate:                report.reportDate,
        soDate:                    e.soDate || report.reportDate,
        customerName:              e.customerName,
        soNo:                      e.soNo,
        sales:                     e.sales,
        cogsType:                  e.cogsType,
        purchaseOfGoods:           e.purchaseOfGoods,
        bankServiceChargeCOGS:     e.bankServiceChargeCOGS,
        dutiesAndTaxes:            e.dutiesAndTaxes,
        bankServiceChargeShipping: e.bankServiceChargeShipping,
        shippingCompany:           e.shippingCompany,
        shippingCost:              e.shippingCost,
        localCharges:              e.localCharges,
        deliveryToOffice:          e.deliveryToOffice,
        deliveryToClient:          e.deliveryToClient,
        totalCOGS:                 e.totalCOGS,
        grossProfit:               e.grossProfit
      });
    });
  });

  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap;">' +
      '<input type="text" id="isClientFilter" placeholder="Filter by client..." oninput="applyIncomeStatementFilter()" ' +
        'style="flex:1;min-width:140px;padding:0.35rem 0.6rem;border-radius:8px;border:1px solid var(--border,#334155);background:var(--bg-primary,#f8fafc);color:var(--text-primary,#f1f5f9);font-size:0.8rem;">' +
      '<input type="month" id="isDateFilter" oninput="applyIncomeStatementFilter()" ' +
        'style="padding:0.35rem 0.6rem;border-radius:8px;border:1px solid var(--border,#334155);background:var(--bg-primary,#f8fafc);color:var(--text-primary,#f1f5f9);font-size:0.8rem;">' +
      '<button onclick="clearIncomeStatementFilters()" style="padding:0.35rem 0.65rem;border-radius:8px;border:1px solid var(--border,#334155);background:transparent;color:var(--text-muted,#64748b);font-size:0.78rem;cursor:pointer;">Clear</button>' +
    '</div>' +
    '<div id="isTableContainer" style="overflow-x:auto;max-height:340px;overflow-y:auto;"></div>';

  _renderIncomeStatementTable(_incomeStatementEntries);
}

function applyIncomeStatementFilter() {
  var clientVal = (document.getElementById('isClientFilter').value || '').toLowerCase().trim();
  var monthVal  = document.getElementById('isDateFilter').value || '';
  var filtered  = _incomeStatementEntries.filter(function(e) {
    if (clientVal && e.customerName.toLowerCase().indexOf(clientVal) === -1) return false;
    if (monthVal  && String(e.soDate || e.reportDate || '').slice(0, 7) !== monthVal) return false;
    return true;
  });
  _renderIncomeStatementTable(filtered);
}

function clearIncomeStatementFilters() {
  var cf = document.getElementById('isClientFilter');
  var df = document.getElementById('isDateFilter');
  if (cf) cf.value = '';
  if (df) df.value = '';
  _renderIncomeStatementTable(_incomeStatementEntries);
}

// ─── Monthly P&L Summary ─────────────────────────

function _toYearMonth(dateStr) {
  if (!dateStr) return '';
  var s = String(dateStr).trim();
  // Already YYYY-MM or YYYY-MM-DD
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  // Try native Date parse (handles "Wed Mar 26 2026", "March 26 2026", ISO, etc.)
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  return '';
}

function renderMonthlyPL(profitReportsResult, expensesResult) {
  var el = document.getElementById('monthlyPLContainer');
  if (!el) return;

  // ── Build revenue & COGS by month from profit reports ──
  var revenueByMonth = {};  // { 'YYYY-MM': { revenue, cogs, grossProfit, soCount, entries[] } }

  if (profitReportsResult && profitReportsResult.status === 'fulfilled' &&
      profitReportsResult.value && profitReportsResult.value.success) {
    (profitReportsResult.value.data || []).forEach(function(report) {
      (report.entries || []).forEach(function(e) {
        var month = _toYearMonth(e.soDate || report.reportDate || '');
        if (!month) return;
        if (!revenueByMonth[month]) revenueByMonth[month] = { revenue: 0, cogs: 0, grossProfit: 0, soCount: 0, entries: [] };
        revenueByMonth[month].revenue     += parseFloat(e.sales)       || 0;
        revenueByMonth[month].cogs        += parseFloat(e.totalCOGS)   || 0;
        revenueByMonth[month].grossProfit += parseFloat(e.grossProfit) || 0;
        revenueByMonth[month].soCount++;
        revenueByMonth[month].entries.push({
          soDate:       e.soDate || report.reportDate || '',
          customerName: e.customerName || '',
          soNo:         e.soNo || '',
          sales:        parseFloat(e.sales)       || 0,
          totalCOGS:    parseFloat(e.totalCOGS)   || 0,
          grossProfit:  parseFloat(e.grossProfit) || 0
        });
      });
    });
  }

  // ── Build expenses by month (total + by category) ──
  var expByMonth = {};  // { 'YYYY-MM': { total, byCategory: { cat: amount } } }

  if (expensesResult && expensesResult.status === 'fulfilled' &&
      expensesResult.value && expensesResult.value.success) {
    (expensesResult.value.data || []).forEach(function(e) {
      var month = _toYearMonth(e.date || '');
      if (!month) return;
      if (!expByMonth[month]) expByMonth[month] = { total: 0, byCategory: {} };
      var amt = parseFloat(e.total) || parseFloat(e.amount) || 0;
      expByMonth[month].total += amt;
      var cat = e.category || 'Other';
      expByMonth[month].byCategory[cat] = (expByMonth[month].byCategory[cat] || 0) + amt;
    });
  }

  // ── Merge months ──
  var allMonths = {};
  Object.keys(revenueByMonth).forEach(function(m) { allMonths[m] = true; });
  Object.keys(expByMonth).forEach(function(m) { allMonths[m] = true; });
  var months = Object.keys(allMonths).sort().reverse();

  if (!months.length) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted,#64748b);font-size:0.82rem;">No data available yet.</div>';
    return;
  }

  // ── Compute grand totals ──
  var grandRev = 0, grandCOGS = 0, grandGP = 0, grandExp = 0, grandNet = 0;
  months.forEach(function(m) {
    var r = revenueByMonth[m] || { revenue: 0, cogs: 0, grossProfit: 0 };
    var x = expByMonth[m]    || { total: 0 };
    grandRev  += r.revenue;
    grandCOGS += r.cogs;
    grandGP   += r.grossProfit;
    grandExp  += x.total;
    grandNet  += (r.grossProfit - x.total);
  });

  // ── Style helpers ──
  var thS  = 'padding:0.45rem 0.6rem;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#64748b);white-space:nowrap;border-bottom:2px solid var(--border,#334155);';
  var tdS  = 'padding:0.42rem 0.6rem;border-bottom:1px solid #e2e8f0;font-size:0.8rem;white-space:nowrap;';
  var tdN  = tdS + 'text-align:right;font-variant-numeric:tabular-nums;';
  var dthS = 'padding:0.28rem 0.5rem;font-size:0.67rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted,#64748b);white-space:nowrap;border-bottom:1px solid #e2e8f0;';
  var dtdS = 'padding:0.3rem 0.5rem;border-bottom:1px solid #e2e8f0;font-size:0.76rem;white-space:nowrap;';
  var dtdN = dtdS + 'text-align:right;font-variant-numeric:tabular-nums;';

  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtMonth(m) {
    var p = m.split('-');
    return p.length === 2 ? (monthNames[parseInt(p[1], 10) - 1] || p[1]) + ' ' + p[0] : m;
  }

  // ── Render summary table ──
  var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:640px;">' +
    '<thead><tr>' +
    '<th style="' + thS + 'text-align:left;">Month</th>' +
    '<th style="' + thS + 'text-align:right;">Revenue</th>' +
    '<th style="' + thS + 'text-align:right;">COGS</th>' +
    '<th style="' + thS + 'text-align:right;">Gross Profit</th>' +
    '<th style="' + thS + 'text-align:right;">Expenses</th>' +
    '<th style="' + thS + 'text-align:right;">Net Profit</th>' +
    '<th style="' + thS + '"></th>' +
    '</tr></thead><tbody>';

  months.forEach(function(m, mi) {
    var r  = revenueByMonth[m] || { revenue: 0, cogs: 0, grossProfit: 0, soCount: 0, entries: [] };
    var xd = expByMonth[m]     || { total: 0, byCategory: {} };
    var net       = r.grossProfit - xd.total;
    var netColor  = net           >= 0 ? '#22c55e' : '#ef4444';
    var gpColor   = r.grossProfit >= 0 ? '#22c55e' : '#ef4444';
    var gpPct     = r.revenue > 0 ? ((r.grossProfit / r.revenue) * 100).toFixed(1) + '%' : '—';
    var netPct    = r.revenue > 0 ? ((net / r.revenue) * 100).toFixed(1) + '%' : '—';

    // ── Summary row ──
    html += '<tr style="cursor:pointer;" onclick="_toggleMonthDetail(' + mi + ')">' +
      '<td style="' + tdS + 'font-weight:700;color:var(--text-primary,#f1f5f9);">' + esc(fmtMonth(m)) +
        (r.soCount ? '<span style="font-size:0.68rem;font-weight:400;color:var(--text-muted,#64748b);margin-left:0.4rem;">' + r.soCount + ' SO' + (r.soCount !== 1 ? 's' : '') + '</span>' : '') +
      '</td>' +
      '<td style="' + tdN + '">' + (r.revenue ? peso(r.revenue) : '<span style="color:var(--text-muted);">—</span>') + '</td>' +
      '<td style="' + tdN + 'color:#ef4444;">' + (r.cogs ? '(' + peso(r.cogs) + ')' : '<span style="color:var(--text-muted);">—</span>') + '</td>' +
      '<td style="' + tdN + 'font-weight:600;color:' + gpColor + ';">' + peso(r.grossProfit) +
        '<span style="font-size:0.68rem;font-weight:400;color:var(--text-muted,#64748b);margin-left:0.3rem;">' + gpPct + '</span></td>' +
      '<td style="' + tdN + 'color:#f97316;">' + (xd.total ? '(' + peso(xd.total) + ')' : '<span style="color:var(--text-muted);">—</span>') + '</td>' +
      '<td style="' + tdN + 'font-weight:700;font-size:0.85rem;color:' + netColor + ';">' + peso(net) +
        '<span style="font-size:0.68rem;font-weight:400;margin-left:0.3rem;">' + netPct + '</span></td>' +
      '<td style="' + tdS + 'text-align:center;">' +
        '<button style="background:none;border:1px solid var(--border,#334155);color:var(--text-muted,#64748b);border-radius:4px;padding:0.15rem 0.45rem;font-size:0.7rem;cursor:pointer;" id="mplBtn' + mi + '">▸</button>' +
      '</td>' +
    '</tr>';

    // ── Expandable detail ──
    html += '<tr id="mplDetail' + mi + '" style="display:none;">' +
      '<td colspan="7" style="padding:0;border-bottom:2px solid var(--border,#334155);">' +
      '<div style="background:#f8fafc;padding:0.75rem 0.85rem;">';

    // Section label
    html += '<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#64748b);margin-bottom:0.45rem;">' + esc(fmtMonth(m)) + ' — Detail</div>';

    // ── Left: SO breakdown table ──
    html += '<div style="overflow-x:auto;margin-bottom:0.75rem;">' +
      '<table style="width:100%;border-collapse:collapse;min-width:520px;">' +
      '<thead><tr>' +
        '<th style="' + dthS + 'text-align:left;">Sales Orders</th>' +
        '<th style="' + dthS + 'text-align:left;">Client</th>' +
        '<th style="' + dthS + 'text-align:right;">Revenue</th>' +
        '<th style="' + dthS + 'text-align:right;">COGS</th>' +
        '<th style="' + dthS + 'text-align:right;">Gross Profit</th>' +
      '</tr></thead><tbody>';

    if (r.entries.length) {
      // Sort entries by date
      var sortedEntries = r.entries.slice().sort(function(a, b) {
        return String(a.soDate).localeCompare(String(b.soDate));
      });
      sortedEntries.forEach(function(entry, ei) {
        var egpColor = entry.grossProfit >= 0 ? '#22c55e' : '#ef4444';
        var rowBg = ei % 2 === 0 ? 'transparent' : '#f8fafc';
        html += '<tr style="background:' + rowBg + ';">' +
          '<td style="' + dtdS + 'font-weight:600;color:var(--text-primary,#f1f5f9);">' + esc(entry.soNo || '—') +
            (entry.soDate ? '<span style="display:block;font-size:0.67rem;font-weight:400;color:var(--text-muted,#64748b);">' + esc(entry.soDate) + '</span>' : '') +
          '</td>' +
          '<td style="' + dtdS + 'color:var(--text-secondary,#94a3b8);max-width:160px;overflow:hidden;text-overflow:ellipsis;">' + esc(entry.customerName || '—') + '</td>' +
          '<td style="' + dtdN + '">' + peso(entry.sales) + '</td>' +
          '<td style="' + dtdN + 'color:#ef4444;">(' + peso(entry.totalCOGS) + ')</td>' +
          '<td style="' + dtdN + 'font-weight:600;color:' + egpColor + ';">' + peso(entry.grossProfit) + '</td>' +
        '</tr>';
      });

      // SO subtotal row
      html += '<tr style="border-top:2px solid var(--border,#334155);background:#f8fafc;">' +
        '<td style="' + dtdS + 'font-weight:700;color:var(--text-muted,#64748b);font-size:0.72rem;text-transform:uppercase;" colspan="2">Total (' + r.soCount + ' SO' + (r.soCount !== 1 ? 's' : '') + ')</td>' +
        '<td style="' + dtdN + 'font-weight:700;">' + peso(r.revenue) + '</td>' +
        '<td style="' + dtdN + 'font-weight:700;color:#ef4444;">(' + peso(r.cogs) + ')</td>' +
        '<td style="' + dtdN + 'font-weight:700;color:' + gpColor + ';">' + peso(r.grossProfit) + '</td>' +
      '</tr>';
    } else {
      html += '<tr><td colspan="5" style="padding:0.5rem;color:var(--text-muted,#64748b);font-size:0.78rem;text-align:center;">No sales orders recorded this month.</td></tr>';
    }
    html += '</tbody></table></div>';

    // ── Right: Expense category breakdown ──
    html += '<div style="overflow-x:auto;">' +
      '<table style="width:100%;border-collapse:collapse;min-width:340px;">' +
      '<thead><tr>' +
        '<th style="' + dthS + 'text-align:left;">Expense Category</th>' +
        '<th style="' + dthS + 'text-align:right;">Amount</th>' +
      '</tr></thead><tbody>';

    if (Object.keys(xd.byCategory).length) {
      Object.keys(xd.byCategory).sort().forEach(function(cat, ci) {
        var rowBg = ci % 2 === 0 ? 'transparent' : '#f8fafc';
        html += '<tr style="background:' + rowBg + ';">' +
          '<td style="' + dtdS + 'color:var(--text-secondary,#94a3b8);">' + esc(cat) + '</td>' +
          '<td style="' + dtdN + 'color:#f97316;">(' + peso(xd.byCategory[cat]) + ')</td>' +
        '</tr>';
      });
      html += '<tr style="border-top:2px solid var(--border,#334155);background:#f8fafc;">' +
        '<td style="' + dtdS + 'font-weight:700;color:var(--text-muted,#64748b);font-size:0.72rem;text-transform:uppercase;">Total Expenses</td>' +
        '<td style="' + dtdN + 'font-weight:700;color:#f97316;">(' + peso(xd.total) + ')</td>' +
      '</tr>';
    } else {
      html += '<tr><td colspan="2" style="padding:0.5rem;color:var(--text-muted,#64748b);font-size:0.78rem;text-align:center;">No expenses recorded this month.</td></tr>';
    }
    html += '</tbody></table></div>';

    // ── Net profit footer ──
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.65rem;padding:0.55rem 0.65rem;border-radius:8px;border:1px solid ' + (net >= 0 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)') + ';background:' + (net >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)') + ';">' +
      '<div>' +
        '<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#64748b);">Net Profit</div>' +
        '<div style="font-size:0.7rem;color:var(--text-muted,#64748b);">Gross Profit ' + peso(r.grossProfit) + ' − Expenses ' + peso(xd.total) + '</div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-size:1.1rem;font-weight:800;color:' + netColor + ';">' + peso(net) + '</div>' +
        '<div style="font-size:0.7rem;color:' + netColor + ';opacity:0.75;">' + netPct + ' of revenue</div>' +
      '</div>' +
    '</div>';

    html += '</div></td></tr>';
  });

  // ── Grand totals row ──
  var totGPColor  = grandGP  >= 0 ? '#22c55e' : '#ef4444';
  var totNetColor = grandNet >= 0 ? '#22c55e' : '#ef4444';
  html += '<tr style="border-top:2px solid var(--border,#334155);background:#f8fafc;">' +
    '<td style="' + tdS + 'font-weight:700;color:var(--text-muted,#64748b);font-size:0.72rem;text-transform:uppercase;">All Periods</td>' +
    '<td style="' + tdN + 'font-weight:700;">' + peso(grandRev) + '</td>' +
    '<td style="' + tdN + 'font-weight:700;color:#ef4444;">(' + peso(grandCOGS) + ')</td>' +
    '<td style="' + tdN + 'font-weight:700;color:' + totGPColor + ';">' + peso(grandGP) + '</td>' +
    '<td style="' + tdN + 'font-weight:700;color:#f97316;">(' + peso(grandExp) + ')</td>' +
    '<td style="' + tdN + 'font-weight:800;font-size:0.9rem;color:' + totNetColor + ';">' + peso(grandNet) + '</td>' +
    '<td></td>' +
  '</tr>';

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function _toggleMonthDetail(idx) {
  var row = document.getElementById('mplDetail' + idx);
  var btn = document.getElementById('mplBtn' + idx);
  if (!row) return;
  var isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : '';
  if (btn) btn.textContent = isOpen ? '▸' : '▾';
}

function _renderIncomeStatementTable(entries) {
  var el = document.getElementById('isTableContainer');
  if (!el) return;
  if (!entries.length) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted,#64748b);font-size:0.82rem;">No records match the filter.</div>';
    return;
  }

  // Sort by date (newest first). Falls back to reportDate when soDate is missing.
  entries = entries.slice().sort(function(a, b) {
    var da = new Date(a.soDate || a.reportDate || 0).getTime();
    var db = new Date(b.soDate || b.reportDate || 0).getTime();
    if (isNaN(da)) da = 0;
    if (isNaN(db)) db = 0;
    return db - da;
  });

  var totalRev = 0, totalCOGS = 0, totalGP = 0;
  var html = '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">' +
    '<thead><tr style="border-bottom:1px solid var(--border,#334155);position:sticky;top:0;background:var(--surface,#ffffff);z-index:1;">' +
    ['Date','Client','SO No','Revenue','COGS','Gross Profit'].map(function(h) {
      return '<th style="text-align:left;padding:0.4rem 0.6rem;font-size:0.72rem;font-weight:600;color:var(--text-muted,#64748b);white-space:nowrap;">' + h + '</th>';
    }).join('') +
    '</tr></thead><tbody>';

  entries.forEach(function(e, idx) {
    totalRev  += e.sales;
    totalCOGS += e.totalCOGS;
    totalGP   += e.grossProfit;
    var gpColor = e.grossProfit >= 0 ? '#22c55e' : '#ef4444';
    // Find index in master array for detail lookup
    var masterIdx = _incomeStatementEntries.indexOf(e);
    if (masterIdx === -1) masterIdx = idx;
    html += '<tr style="border-bottom:1px solid #e2e8f0;">' +
      '<td style="padding:0.4rem 0.6rem;white-space:nowrap;color:var(--text-muted,#64748b);">' + esc(e.soDate || e.reportDate) + '</td>' +
      '<td style="padding:0.4rem 0.6rem;font-weight:600;color:var(--text-primary,#f1f5f9);">' + esc(e.customerName) + '</td>' +
      '<td style="padding:0.4rem 0.6rem;">' +
        '<button onclick="showSOCOGSDetail(' + masterIdx + ')" style="background:none;border:none;padding:0;color:#3b82f6;font-size:0.78rem;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">' + esc(e.soNo) + '</button>' +
      '</td>' +
      '<td style="padding:0.4rem 0.6rem;white-space:nowrap;color:var(--text-primary,#f1f5f9);">₱' + _expFmt(e.sales) + '</td>' +
      '<td style="padding:0.4rem 0.6rem;white-space:nowrap;color:#ef4444;">₱' + _expFmt(e.totalCOGS) + '</td>' +
      '<td style="padding:0.4rem 0.6rem;white-space:nowrap;font-weight:700;color:' + gpColor + ';">₱' + _expFmt(e.grossProfit) + '</td>' +
      '</tr>';
  });

  var totalGpColor = totalGP >= 0 ? '#22c55e' : '#ef4444';
  html += '<tr style="border-top:2px solid var(--border,#334155);font-weight:700;">' +
    '<td colspan="3" style="padding:0.5rem 0.6rem;color:var(--text-muted,#64748b);font-size:0.72rem;text-transform:uppercase;">Total (' + entries.length + ' records)</td>' +
    '<td style="padding:0.5rem 0.6rem;white-space:nowrap;">₱' + _expFmt(totalRev) + '</td>' +
    '<td style="padding:0.5rem 0.6rem;white-space:nowrap;color:#ef4444;">₱' + _expFmt(totalCOGS) + '</td>' +
    '<td style="padding:0.5rem 0.6rem;white-space:nowrap;color:' + totalGpColor + ';">₱' + _expFmt(totalGP) + '</td>' +
    '</tr>';

  html += '</tbody></table>';
  el.innerHTML = html;
}

function showSOCOGSDetail(idx) {
  var e = _incomeStatementEntries[idx];
  if (!e) return;
  var isIntl = (e.cogsType || '').toLowerCase() === 'international';
  var gpColor = e.grossProfit >= 0 ? '#22c55e' : '#ef4444';

  function row(label, val, color) {
    return '<tr>' +
      '<td style="padding:0.4rem 0;color:var(--text-muted,#64748b);font-size:0.82rem;">' + label + '</td>' +
      '<td style="padding:0.4rem 0;text-align:right;white-space:nowrap;color:' + (color || 'var(--text-primary,#f1f5f9)') + ';font-size:0.82rem;">₱' + _expFmt(val) + '</td>' +
    '</tr>';
  }
  function divider() {
    return '<tr><td colspan="2" style="border-top:1px solid var(--border,#334155);padding:0;"></td></tr>';
  }

  var html =
    '<div style="margin-bottom:1rem;">' +
      '<div style="font-size:0.72rem;color:var(--text-muted,#64748b);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.2rem;">' + esc(e.soDate || e.reportDate) + ' · ' + esc(e.customerName) + '</div>' +
      '<div style="font-size:1.1rem;font-weight:700;color:var(--text-primary,#f1f5f9);">' + esc(e.soNo) + '</div>' +
      '<div style="display:inline-block;margin-top:0.3rem;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.72rem;font-weight:600;background:' + (isIntl ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.15)') + ';color:' + (isIntl ? '#a78bfa' : '#60a5fa') + ';">' + (isIntl ? 'International' : 'Local') + '</div>' +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;">' +
      '<thead><tr style="border-bottom:1px solid var(--border,#334155);"><th style="text-align:left;padding:0.3rem 0;font-size:0.72rem;font-weight:600;color:var(--text-muted,#64748b);">Item</th><th style="text-align:right;padding:0.3rem 0;font-size:0.72rem;font-weight:600;color:var(--text-muted,#64748b);">Amount</th></tr></thead>' +
      '<tbody>' +
      '<tr><td colspan="2" style="padding:0.35rem 0;font-size:0.72rem;font-weight:700;color:var(--text-muted,#64748b);text-transform:uppercase;letter-spacing:0.04em;">Revenue</td></tr>' +
      row('Sales', e.sales) +
      divider() +
      '<tr><td colspan="2" style="padding:0.35rem 0;font-size:0.72rem;font-weight:700;color:var(--text-muted,#64748b);text-transform:uppercase;letter-spacing:0.04em;">Cost of Goods Sold</td></tr>' +
      row('Purchase of Goods', e.purchaseOfGoods) +
      (isIntl ? row('Bank Service Charge (COGS)', e.bankServiceChargeCOGS) : '') +
      (isIntl ? row('Duties & Taxes', e.dutiesAndTaxes) : '') +
      (isIntl ? row('Bank Service Charge (Shipping)', e.bankServiceChargeShipping) : '') +
      (isIntl ? row('Shipping Cost' + (e.shippingCompany ? ' (' + e.shippingCompany + ')' : ''), e.shippingCost) : '') +
      (isIntl ? row('Local Charges', e.localCharges) : '') +
      row('Delivery to Office', e.deliveryToOffice) +
      row('Delivery to Client', e.deliveryToClient) +
      divider() +
      '<tr><td style="padding:0.45rem 0;font-weight:700;color:var(--text-primary,#f1f5f9);">Total COGS</td><td style="text-align:right;white-space:nowrap;font-weight:700;color:#ef4444;">₱' + _expFmt(e.totalCOGS) + '</td></tr>' +
      divider() +
      '<tr><td style="padding:0.45rem 0;font-weight:700;color:var(--text-primary,#f1f5f9);">Gross Profit</td><td style="text-align:right;white-space:nowrap;font-weight:700;color:' + gpColor + ';">₱' + _expFmt(e.grossProfit) + '</td></tr>' +
      '</tbody>' +
    '</table>';

  document.getElementById('cogsDetailContent').innerHTML = html;
  var modal = document.getElementById('cogsDetailModal');
  modal.style.display = 'flex';
}

function closeSOCOGSDetail() {
  document.getElementById('cogsDetailModal').style.display = 'none';
}


// ═══════════════════════════════════════════════

function toggleFinancialAllTime() {
  _financialAllTime = !_financialAllTime;
  var btn = document.getElementById('financialAllTimeBtn');
  var mf  = document.getElementById('financialMonthFilter');
  btn.style.background  = _financialAllTime ? 'var(--accent,#3b82f6)' : 'transparent';
  btn.style.color       = _financialAllTime ? '#fff' : 'var(--text-muted,#64748b)';
  btn.style.borderColor = _financialAllTime ? 'var(--accent,#3b82f6)' : 'var(--border,#334155)';
  mf.disabled           = _financialAllTime;
  mf.style.opacity      = _financialAllTime ? '0.4' : '1';
  _refetchFinancialOverview(_financialAllTime ? 'alltime' : (mf.value || 'month'));
}

async function applyFinancialFilter() {
  _financialAllTime = false;
  var btn = document.getElementById('financialAllTimeBtn');
  btn.style.background  = 'transparent';
  btn.style.color       = 'var(--text-muted,#64748b)';
  btn.style.borderColor = 'var(--border,#334155)';
  var mf = document.getElementById('financialMonthFilter');
  mf.disabled     = false;
  mf.style.opacity = '1';
  await _refetchFinancialOverview(mf.value || 'month');
}

async function _refetchFinancialOverview(range) {
  var el = document.getElementById('financialKPIs');
  el.innerHTML = '<div class="loading-overlay" style="position:static;background:none;min-height:60px;"><div class="spinner"></div></div>';
  try {
    var result = await fetchFromAPI({ action: 'getAccountingDashboard', range: range });
    renderFinancialOverview({ status: 'fulfilled', value: result }, _storedCollectionsResult);
  } catch (err) {
    el.innerHTML = '<div style="padding:1rem;color:#ef4444;">Could not load financial data</div>';
  }
}

// ═══════════════════════════════════════════════
// Section 2: Sales Performance
// ═══════════════════════════════════════════════

function renderSalesPerformance(result) {
  var container = document.getElementById('leaderboardContainer');
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    container.innerHTML = '<div style="padding:1rem;color:#ef4444;">Could not load team data</div>';
    return;
  }
  var data = result.value.data || [];
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No team data yet</div>';
    return;
  }

  // Team totals
  var tQ = 0, tP = 0, tO = 0;
  data.forEach(function(a) { tQ += a.quotations||0; tP += a.prs||0; tO += a.pos||0; });
  document.getElementById('totalQ').textContent = tQ;
  document.getElementById('totalPR').textContent = tP;
  document.getElementById('totalPO').textContent = tO;

  // Sort by total descending
  data.sort(function(a, b) { return (b.total||0) - (a.total||0); });

  var html = '<table class="lb-table"><thead><tr>' +
    '<th>#</th><th>Agent</th><th>Quotations</th><th>PRs</th><th>POs</th><th>Conversion</th><th>Total</th><th>Trend</th>' +
    '</tr></thead><tbody>';

  data.forEach(function(agent, i) {
    var conv = agent.quotations > 0 ? Math.round((agent.pos / agent.quotations) * 100) : 0;
    var convClass = conv >= 30 ? 'kpi-positive' : conv >= 15 ? 'text-warning' : 'kpi-negative';

    html += '<tr>' +
      '<td style="font-weight:700;color:var(--text-muted);">' + (i+1) + '</td>' +
      '<td style="font-weight:600;">' + esc(agent.name) + '</td>' +
      '<td>' + makeTargetCell(agent.quotations||0, agent.quotationTarget, '#3b82f6') + '</td>' +
      '<td>' + makeTargetCell(agent.prs||0, agent.prTarget, '#8b5cf6') + '</td>' +
      '<td style="font-weight:600;">' + (agent.pos||0) + '</td>' +
      '<td><span class="conv-rate ' + convClass + '">' + conv + '%</span></td>' +
      '<td style="font-weight:700;">' + (agent.total||0) + '</td>' +
      '<td>' + makeTrendBadge(agent.total||0, agent.prevTotal||0) + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ═══════════════════════════════════════════════
// Section 3: Inventory Snapshot
// ═══════════════════════════════════════════════

function renderInventorySnapshot(result) {
  var kpiEl = document.getElementById('inventoryKPIs');
  var listEl = document.getElementById('lowStockList');

  if (result.status === 'rejected' || !result.value || !result.value.success) {
    kpiEl.innerHTML = '<div style="color:#ef4444;">Could not load inventory</div>';
    listEl.innerHTML = '';
    return;
  }

  var items = result.value.data || [];
  var totalItems = items.length;
  var totalQty = items.reduce(function(s, i) { return s + (parseInt(i.qty)||0); }, 0);
  var lowStock = items.filter(function(i) { var q = parseInt(i.qty)||0; return q > 0 && q < 10; });
  var outOfStock = items.filter(function(i) { return (parseInt(i.qty)||0) === 0; });

  kpiEl.innerHTML =
    statItem('Total Items', totalItems, '') +
    statItem('Total Qty', totalQty.toLocaleString(), '') +
    statItem('Low Stock', lowStock.length, lowStock.length > 0 ? 'text-warning' : '') +
    statItem('Out of Stock', outOfStock.length, outOfStock.length > 0 ? 'text-danger' : '');

  var display = items;
  if (display.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);">No inventory items found</div>';
    return;
  }

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">' +
    '<h3 style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin:0;">All Items (' + items.length + ')</h3>' +
    '<a href="flow-inventory.html" style="font-size:0.78rem;color:#f59e0b;text-decoration:none;">View All &rarr;</a></div>' +
    '<div style="overflow-x:auto;"><table class="lb-table"><thead><tr><th>Model No.</th><th>Description</th><th>Qty</th><th>Last Updated</th></tr></thead><tbody>';
  display.forEach(function(item) {
    var qty = parseInt(item.qty) || 0;
    var qtyCls = qty === 0 ? 'text-danger' : qty < 10 ? 'text-warning' : '';
    html += '<tr>' +
      '<td style="font-weight:600;">' + esc(item.modelNo) + '</td>' +
      '<td>' + esc(item.description) + '</td>' +
      '<td class="' + qtyCls + '" style="font-weight:700;">' + qty + '</td>' +
      '<td style="color:var(--text-muted);font-size:0.78rem;white-space:nowrap;">' + esc(item.lastUpdated || '—') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  listEl.innerHTML = html;
}

// ═══════════════════════════════════════════════
// Section 3b: MRO Records (Materials Received)
// ═══════════════════════════════════════════════

var MRO_DRIVE_FOLDER = 'https://drive.google.com/drive/folders/1tnN3-m9NXxB6_EoGGhdZCeLBtThR4c0i?usp=sharing';

function renderMRORecords(result) {
  var el = document.getElementById('mroQueueContainer');
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    el.innerHTML = '<div style="color:#ef4444;font-size:0.82rem;">Could not load MRO records</div>';
    return;
  }
  var rows = (result.value.data || []).slice(0, 30);
  if (rows.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.82rem;">No materials received yet</div>';
    return;
  }
  var html = '<table class="lb-table"><thead><tr>' +
    '<th>Date</th><th>Vendor</th><th>SI No.</th><th>PO No.</th><th>Model No.</th><th>Description</th><th style="text-align:right;">Qty</th><th>Received By</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var poCell;
    if (r.driveLink) {
      poCell = '<button onclick=\'openDocViewer("MRO – ' + esc(r.purchaseOrderNo || '').replace(/'/g, "\\'") + '",' + JSON.stringify(r.driveLink) + ')\' style="background:none;border:none;padding:0;color:#3b82f6;cursor:pointer;font-size:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px;">' + esc(r.purchaseOrderNo || '—') + '</button>';
    } else {
      poCell = esc(r.purchaseOrderNo || '—');
    }
    html += '<tr>' +
      '<td style="white-space:nowrap;color:var(--text-muted);">' + esc(r.receivingDate || '—') + '</td>' +
      '<td style="font-weight:600;">' + esc(r.vendorName || '—') + '</td>' +
      '<td>' + esc(r.salesInvoice || '—') + '</td>' +
      '<td>' + poCell + '</td>' +
      '<td style="font-weight:600;">' + esc(r.modelNo || '—') + '</td>' +
      '<td>' + esc(r.itemDescription || '—') + '</td>' +
      '<td style="text-align:right;font-weight:700;color:#22c55e;">+' + (r.quantity || 0) + '</td>' +
      '<td style="color:var(--text-muted);">' + esc(r.receivedBy || '—') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  if ((result.value.data || []).length > 30) {
    html += '<div style="text-align:right;margin-top:0.5rem;font-size:0.75rem;color:var(--text-muted);">Showing 30 of ' + result.value.data.length + ' records</div>';
  }
  el.innerHTML = html;
}

// ═══════════════════════════════════════════════
// Section 3b: MI Records (Materials Issued)
// ═══════════════════════════════════════════════

var MI_DRIVE_FOLDER = 'https://drive.google.com/drive/folders/11iyASbSLAfn6DKpte9j_J3QlllWN7nOs?usp=drive_link';

function renderMIRecords(result) {
  var el = document.getElementById('miQueueContainer');
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    el.innerHTML = '<div style="color:#ef4444;font-size:0.82rem;">Could not load MI records</div>';
    return;
  }
  var rows = (result.value.data || []).slice(0, 30);
  if (rows.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.82rem;">No materials issued yet</div>';
    return;
  }
  var html = '<table class="lb-table"><thead><tr>' +
    '<th>Date</th><th>Recipient</th><th>Issuance No.</th><th>Req. No.</th><th>Model No.</th><th>Description</th><th style="text-align:right;">Qty</th><th>Issued By</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var issuanceCell;
    if (r.driveLink) {
      issuanceCell = '<button onclick=\'openDocViewer("MI – ' + esc(r.issuanceNo || '').replace(/'/g, "\\'") + '",' + JSON.stringify(r.driveLink) + ')\' style="background:none;border:none;padding:0;color:#3b82f6;cursor:pointer;font-size:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px;">' + esc(r.issuanceNo || '—') + '</button>';
    } else {
      issuanceCell = esc(r.issuanceNo || '—');
    }
    html += '<tr>' +
      '<td style="white-space:nowrap;color:var(--text-muted);">' + esc(r.issuanceDate || '—') + '</td>' +
      '<td style="font-weight:600;">' + esc(r.recipientName || '—') + '</td>' +
      '<td>' + issuanceCell + '</td>' +
      '<td>' + esc(r.requisitionNo || '—') + '</td>' +
      '<td style="font-weight:600;">' + esc(r.modelNo || '—') + '</td>' +
      '<td>' + esc(r.itemDescription || '—') + '</td>' +
      '<td style="text-align:right;font-weight:700;color:#ef4444;">−' + (r.quantity || 0) + '</td>' +
      '<td style="color:var(--text-muted);">' + esc(r.issuedBy || '—') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  if ((result.value.data || []).length > 30) {
    html += '<div style="text-align:right;margin-top:0.5rem;font-size:0.75rem;color:var(--text-muted);">Showing 30 of ' + result.value.data.length + ' records</div>';
  }
  el.innerHTML = html;
}

// ═══════════════════════════════════════════════
// Section 4: Payment Requests
// ═══════════════════════════════════════════════

function renderPaymentRequests(result) {
  var kpiEl = document.getElementById('paymentKPIs');
  var listEl = document.getElementById('recentPayments');

  if (result.status === 'rejected' || !result.value || !result.value.success) {
    kpiEl.innerHTML = '<div style="color:#ef4444;">Could not load payments</div>';
    listEl.innerHTML = '';
    return;
  }

  var payments = result.value.data || [];
  var totalAmt = 0, pending = 0, approved = 0;
  payments.forEach(function(r) {
    totalAmt += prToPHP(r.amount, r.currency);
    var st = (r.status||'Pending').toLowerCase();
    if (st === 'pending') pending++;
    if (st === 'approved' || st === 'paid') approved++;
  });

  kpiEl.innerHTML =
    statItem('Total Requests', payments.length, '') +
    statItem('Pending', pending, pending > 0 ? 'text-warning' : '') +
    statItem('Approved/Paid', approved, 'kpi-positive') +
    statItem('Total Amount (All Time)', peso(totalAmt), '');

  var recentPending = payments.filter(function(r) { return (r.status||'Pending').toLowerCase() === 'pending'; }).slice(0, 5);
  if (recentPending.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);">No pending requests</div>';
    return;
  }

  var html = '<h3 style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.75rem;">Recent Pending</h3>' +
    '<table class="lb-table"><thead><tr><th>Date</th><th>Payee</th><th>Amount</th><th>Requested By</th></tr></thead><tbody>';
  recentPending.forEach(function(r) {
    html += '<tr><td>' + esc(r.requestDate) + '</td><td style="font-weight:600;">' + esc(r.payeeName) + '</td><td style="font-weight:600;">' + peso(prToPHP(r.amount, r.currency)) + '</td><td>' + esc(r.requestedBy) + '</td></tr>';
  });
  html += '</tbody></table>';
  listEl.innerHTML = html;
}

// ═══════════════════════════════════════════════
// Section 4b: Sales Orders
// ═══════════════════════════════════════════════

var _allSalesOrders = [];

function _soDateValue(o) {
  return new Date(o.date || o.soDate || 0);
}

function _populateSoYearFilter(orders) {
  var sel = document.getElementById('soYearFilter');
  if (!sel) return;
  var years = {};
  orders.forEach(function (o) {
    var d = _soDateValue(o);
    if (!isNaN(d.getTime())) years[d.getFullYear()] = true;
  });
  var current = sel.value;
  var list = Object.keys(years).sort(function (a, b) { return b - a; });
  sel.innerHTML = '<option value="">All</option>' + list.map(function (y) {
    return '<option value="' + y + '"' + (y === current ? ' selected' : '') + '>' + y + '</option>';
  }).join('');
}

function _filterSalesOrders(orders) {
  var month = (document.getElementById('soMonthFilter') || {}).value || '';
  var year = (document.getElementById('soYearFilter') || {}).value || '';
  return orders.filter(function (o) {
    var d = _soDateValue(o);
    if (isNaN(d.getTime())) return !month && !year;
    if (month) {
      var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (ym !== month) return false;
    }
    if (year && String(d.getFullYear()) !== String(year)) return false;
    return true;
  });
}

function applySoFilter() {
  _renderSoTable(_filterSalesOrders(_allSalesOrders));
}

function _renderSoTable(orders) {
  var listEl = document.getElementById('recentSalesOrders');
  if (!listEl) return;
  if (!orders.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);">No sales orders match this filter.</div>' +
      '<div style="text-align:right;margin-top:0.75rem;"><a href="management-sales-orders.html" style="color:#3b82f6;font-size:0.8rem;text-decoration:none;">Open Full Sales Orders Page &rarr;</a></div>';
    return;
  }
  orders.sort(function (a, b) { return _soDateValue(b) - _soDateValue(a); });
  var recent = orders.slice(0, 10);

  var month = (document.getElementById('soMonthFilter') || {}).value || '';
  var year = (document.getElementById('soYearFilter') || {}).value || '';
  var label = 'Recent Sales Orders';
  if (month) {
    var parts = month.split('-');
    var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    label = 'Sales Orders · ' + monthNames[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
  } else if (year) {
    label = 'Sales Orders · ' + year;
  }

  var html = '<h3 style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.75rem;">' + esc(label) + ' (' + orders.length + ')</h3>';
  html += '<table class="lb-table"><thead><tr><th>SO No</th><th>Date</th><th>Customer</th><th>Status</th><th>Invoice #</th><th>Amount</th></tr></thead><tbody>';
  recent.forEach(function (o) {
    var st = (o.status || 'Pending').toLowerCase();
    var stCls = st === 'delivered' ? 'color:#22c55e' : 'color:#f97316';
    var amount = o.grandTotal || o.totalAmount || o.amount || 0;
    html += '<tr>' +
      '<td><strong>' + esc(o.soNumber || o.soNo || '') + '</strong></td>' +
      '<td style="white-space:nowrap;color:var(--text-muted);">' + esc(o.date || o.soDate || '') + '</td>' +
      '<td>' + esc(o.customer || o.customerName || '') + '</td>' +
      '<td style="' + stCls + ';font-weight:600;font-size:0.78rem;">' + esc(o.status || 'Pending') + '</td>' +
      '<td style="color:var(--text-muted);font-size:0.82rem;">' + esc(o.invoiceNo || '—') + '</td>' +
      '<td style="font-weight:600;">' + peso(amount) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  html += '<div style="text-align:right;margin-top:0.75rem;"><a href="management-sales-orders.html" style="color:#3b82f6;font-size:0.8rem;text-decoration:none;">View All ' + orders.length + ' Orders &rarr;</a></div>';
  listEl.innerHTML = html;
}

function renderSalesOrders(statsResult, dataResult) {
  var kpiEl = document.getElementById('soKPIs');
  var listEl = document.getElementById('recentSalesOrders');

  var pending = 0, delivered = 0, totalSO = 0, totalRev = 0;
  if (statsResult.status === 'fulfilled' && statsResult.value && statsResult.value.success) {
    var st = statsResult.value;
    pending = st.pending || 0;
    delivered = st.delivered || 0;
    totalSO = st.total || 0;
    totalRev = st.totalRevenue || 0;
  }
  kpiEl.innerHTML =
    '<div class="stat-item"><div class="stat-val" style="color:#f97316;">' + pending + '</div><div class="stat-lbl">Pending</div></div>' +
    '<div class="stat-item"><div class="stat-val" style="color:#22c55e;">' + delivered + '</div><div class="stat-lbl">Delivered</div></div>' +
    '<div class="stat-item"><div class="stat-val">' + totalSO + '</div><div class="stat-lbl">Total SOs</div></div>' +
    '<div class="stat-item"><div class="stat-val" style="color:#3b82f6;">' + peso(totalRev) + '</div><div class="stat-lbl">Total Revenue</div></div>';

  if (dataResult.status !== 'fulfilled' || !dataResult.value || !dataResult.value.success) {
    listEl.innerHTML = '<div style="color:#ef4444;padding:1rem;">Could not load sales orders</div>';
    return;
  }

  _allSalesOrders = dataResult.value.data || [];
  _populateSoYearFilter(_allSalesOrders);
  _renderSoTable(_filterSalesOrders(_allSalesOrders));
}

// ═══════════════════════════════════════════════
// Section 6: Recent Activity
// ═══════════════════════════════════════════════

function renderLoginActivity(result) {
  var container = document.getElementById('loginLogContainer');
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    container.innerHTML = '<div style="color:#ef4444;">Could not load activity log</div>';
    return;
  }
  var logs = (result.value.data || []).slice(0, 10);
  if (logs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);">No login activity yet</div>';
    return;
  }

  var html = '<h3 style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.75rem;">Recent Logins</h3>';
  logs.forEach(function(log) {
    var roleClass = 'badge-' + (log.role || 'sales');
    html += '<div class="activity-item">' +
      '<div class="activity-icon" style="background:rgba(59,130,246,0.12);color:#3b82f6;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></div>' +
      '<div style="flex:1;color:var(--text-secondary);"><strong>' + esc(log.fullName) + '</strong> logged in</div>' +
      '<span class="badge-role ' + roleClass + '">' + esc(log.role) + '</span>' +
      '<div style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;">' + esc((log.timestamp||'').slice(0, 16).replace('T', ' ')) + '</div>' +
      '</div>';
  });

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════
// Section 7: Team Daily Reports
// ═══════════════════════════════════════════════

var drLastData = [];
var drAdminData = [];
var drAcctData = [];
var drHRData = [];
var drActiveTab = 'sales';
var DR_TRUNCATE_LEN = 120;

function drTruncate(text, id) {
  var s = String(text || '');
  if (s.length <= DR_TRUNCATE_LEN) return esc(s);
  return '<span class="dr-truncated" id="' + id + '">' +
    '<span class="dr-short">' + esc(s.substring(0, DR_TRUNCATE_LEN)) + '... <span class="dr-show-toggle" onclick="drToggleText(\'' + id + '\')">Show more</span></span>' +
    '<span class="dr-full">' + esc(s) + ' <span class="dr-show-toggle" onclick="drToggleText(\'' + id + '\')">Show less</span></span>' +
    '</span>';
}

function drToggleText(id) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('expanded');
}

function setDrToday() {
  var now = new Date();
  var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  document.getElementById('drReportDate').value = todayStr;
  loadManagementReports();
}

async function loadManagementReports() {
  var container = document.getElementById('drReportsContainer');
  var dateVal = document.getElementById('drReportDate').value;
  container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

  var d = new Date(dateVal + 'T00:00:00');
  document.getElementById('drDateLabel').textContent = d.toLocaleDateString('en-PH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  try {
    var result = await fetchFromAPI({ action: 'getAllDailyReports', date: dateVal });
    if (!result || !result.success) throw new Error((result && result.message) || 'Failed to load');
    updateDailyReportKPIs(result);
    drLastData = (result.sales && result.sales.data) || [];
    drAdminData = (result.admin && result.admin.data) || [];
    drAcctData = (result.accounting && result.accounting.data) || [];
    drHRData = (result.hr && result.hr.data) || [];
    renderDrActiveTab();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderDailyReports(result) {
  var dateVal = document.getElementById('drReportDate').value;
  var d = new Date(dateVal + 'T00:00:00');
  document.getElementById('drDateLabel').textContent = d.toLocaleDateString('en-PH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  if (result.status === 'rejected' || !result.value || !result.value.success) {
    document.getElementById('drReportsContainer').innerHTML =
      '<div style="text-align:center;padding:1.5rem;color:#ef4444;">Could not load daily reports</div>';
    return;
  }
  var allData = result.value;
  updateDailyReportKPIs(allData);
  drLastData = (allData.sales && allData.sales.data) || [];
  drAdminData = (allData.admin && allData.admin.data) || [];
  drAcctData = (allData.accounting && allData.accounting.data) || [];
  drHRData = (allData.hr && allData.hr.data) || [];
  renderDailyReportsTable(drLastData);
}

function updateDailyReportKPIs(allData) {
  var sales = allData.sales || {};
  var admin = allData.admin || {};
  var accounting = allData.accounting || {};
  var hr = allData.hr || {};

  var salesData = sales.data || [];
  var salesSubmitted = salesData.filter(function(r) { return r.submitted; }).length;
  var salesTotal = salesData.length;
  document.getElementById('drSalesCount').textContent = salesSubmitted + '/' + salesTotal;

  var adminData = admin.data || [];
  var adminSubmitted = adminData.filter(function(r) { return r.submitted; }).length;
  var adminTotal = adminData.length;
  document.getElementById('drAdminCount').textContent = adminSubmitted + '/' + adminTotal;

  var acctData = accounting.data || [];
  document.getElementById('drAcctCount').textContent = acctData.length;

  var hrData = hr.data || [];
  var hrSubmitted = hrData.filter(function(r) { return r.submitted; }).length;
  var hrTotal = hrData.length;
  document.getElementById('drHRCount').textContent = hrSubmitted + '/' + hrTotal;
}

function renderDailyReportsTable(reports) {
  var container = document.getElementById('drReportsContainer');
  if (reports.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No sales agents found.</div>';
    return;
  }

  var submittedCount = reports.filter(function(r) { return r.submitted; }).length;
  var totalAgents = reports.length;

  var rows = '';
  reports.forEach(function(r, idx) {
    if (!r.submitted) {
      rows += '<tr class="dr-not-submitted">' +
        '<td><strong>' + esc(r.agentName) + '</strong></td>' +
        '<td colspan="12" style="text-align:center;"><span class="dr-status-missing">Not Submitted</span></td>' +
        '</tr>';
      return;
    }

    var callCount = (r.callDetails || []).length;
    var callsBtn = callCount > 0
      ? '<button class="dr-details-btn" onclick="toggleReportDetails(\'dr-calls-' + idx + '\')">View (' + callCount + ')</button>'
      : '<span class="dr-badge-muted">None</span>';

    var leadsCount = (r.leadsEmailDetails || []).length;
    var leadsBtn = leadsCount > 0
      ? '<button class="dr-details-btn" onclick="toggleReportDetails(\'dr-leads-' + idx + '\')">View (' + leadsCount + ')</button>'
      : '<span class="dr-badge-muted">None</span>';

    var followUpCount = (r.followUpEmailDetails || []).length;
    var followUpBtn = followUpCount > 0
      ? '<button class="dr-details-btn" onclick="toggleReportDetails(\'dr-followup-' + idx + '\')">View (' + followUpCount + ')</button>'
      : '<span class="dr-badge-muted">None</span>';

    var totalEmailsCount = leadsCount + followUpCount;
    var totalEmailsBtn = totalEmailsCount > 0
      ? '<button class="dr-details-btn" onclick="toggleReportDetails(\'dr-allemails-' + idx + '\')">View (' + totalEmailsCount + ')</button>'
      : '<span class="dr-badge-muted">None</span>';

    var urgentCount = (r.urgentIssues || []).length;
    var urgentBtn = urgentCount > 0
      ? '<button class="dr-details-btn" style="background:rgba(239,68,68,0.15);color:#ef4444;" onclick="toggleReportDetails(\'dr-urgent-' + idx + '\')">View (' + urgentCount + ')</button>'
      : '<span class="dr-badge-muted">None</span>';

    var otherTaskText = (r.otherTask || '').trim();
    var otherTaskBtn = otherTaskText
      ? '<button class="dr-details-btn" style="background:rgba(245,158,11,0.18);color:#b45309;" onclick="toggleReportDetails(\'dr-other-' + idx + '\')">View</button>'
      : '<span class="dr-badge-muted">None</span>';

    var pdfBtn = r.pdfLink
      ? '<button class="dr-details-btn" onclick="openSalesReportPDF(\'' + esc(r.pdfLink) + '\', \'' + esc(r.agentName) + '\')">View PDF</button>'
      : '<span class="dr-badge-muted">None</span>';

    rows += '<tr>' +
      '<td><strong>' + esc(r.agentName) + '</strong></td>' +
      '<td style="text-align:center;">' + (r.quotationsSent > 0 ? '<button class="dr-details-btn" onclick="openAgentDayActivity(\'' + esc(r.agentName) + '\',\'quotations\')">' + r.quotationsSent + '</button>' : '<span class="dr-badge-muted">0</span>') + '</td>' +
      '<td style="text-align:center;">' + (r.prsSent > 0 ? '<button class="dr-details-btn" onclick="openAgentDayActivity(\'' + esc(r.agentName) + '\',\'prs\')">' + r.prsSent + '</button>' : '<span class="dr-badge-muted">0</span>') + '</td>' +
      '<td style="text-align:center;">' + leadsBtn + '</td>' +
      '<td style="text-align:center;">' + followUpBtn + '</td>' +
      '<td style="text-align:center;font-weight:600;">' + totalEmailsBtn + '</td>' +
      '<td style="text-align:center;font-weight:600;">' + r.totalCalls + '</td>' +
      '<td style="text-align:center;"><span class="dr-badge-success">' + r.successfulCalls + '</span></td>' +
      '<td style="text-align:center;"><span class="dr-badge-fail">' + r.unsuccessfulCalls + '</span></td>' +
      '<td>' + callsBtn + '</td>' +
      '<td>' + urgentBtn + '</td>' +
      '<td style="text-align:center;">' + otherTaskBtn + '</td>' +
      '<td style="text-align:center;">' + pdfBtn + '</td>' +
      '</tr>';

    // Leads email details — card layout
    if (leadsCount > 0) {
      var cards = r.leadsEmailDetails.map(function(e, i) {
        var meta = [];
        if (e.type) meta.push('<span style="background:rgba(59,130,246,0.15);color:#3b82f6;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">' + esc(e.type) + '</span>');
        if (e.response) meta.push('<span style="background:rgba(148,163,184,0.18);color:var(--text-muted);padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">Response: ' + esc(e.response) + '</span>');
        var sentLabel = fmtEmailSentAt(e.sentAt);
        var head = (sentLabel ? '<span style="color:var(--text-muted);font-size:0.72rem;margin-right:0.5rem;">' + esc(sentLabel) + '</span>' : '');
        return '<div class="dr-card">' +
          '<div class="dr-card-label">' + head + esc(e.recipient || '—') + (e.company ? ' <span style="color:var(--text-muted);font-weight:500;">· ' + esc(e.company) + '</span>' : '') + '</div>' +
          '<div class="dr-card-body">' +
            '<div style="margin-bottom:0.35rem;"><strong style="color:var(--text-primary);">Subject:</strong> ' + drTruncate(e.detail || '—', 'dr-lead-txt-' + idx + '-' + i) + '</div>' +
            (meta.length ? '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' + meta.join('') + '</div>' : '') +
          '</div></div>';
      }).join('');
      rows += '<tr class="dr-expand-row" id="dr-leads-' + idx + '"><td colspan="13">' +
        '<div class="dr-expand-label">Leads Emails (Introduction)</div>' +
        '<div class="dr-card-list">' + cards + '</div></td></tr>';
    }

    // Follow up email details — card layout
    if (followUpCount > 0) {
      var cards2 = r.followUpEmailDetails.map(function(e, i) {
        var meta = [];
        if (e.type) meta.push('<span style="background:rgba(59,130,246,0.15);color:#3b82f6;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">' + esc(e.type) + '</span>');
        if (e.response) meta.push('<span style="background:rgba(148,163,184,0.18);color:var(--text-muted);padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">Response: ' + esc(e.response) + '</span>');
        var sentLabel = fmtEmailSentAt(e.sentAt);
        var head = (sentLabel ? '<span style="color:var(--text-muted);font-size:0.72rem;margin-right:0.5rem;">' + esc(sentLabel) + '</span>' : '');
        return '<div class="dr-card">' +
          '<div class="dr-card-label">' + head + esc(e.recipient || '—') + (e.company ? ' <span style="color:var(--text-muted);font-weight:500;">· ' + esc(e.company) + '</span>' : '') + '</div>' +
          '<div class="dr-card-body">' +
            '<div style="margin-bottom:0.35rem;"><strong style="color:var(--text-primary);">Subject:</strong> ' + drTruncate(e.detail || '—', 'dr-fu-txt-' + idx + '-' + i) + '</div>' +
            (meta.length ? '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' + meta.join('') + '</div>' : '') +
          '</div></div>';
      }).join('');
      rows += '<tr class="dr-expand-row" id="dr-followup-' + idx + '"><td colspan="13">' +
        '<div class="dr-expand-label">Follow Up Emails</div>' +
        '<div class="dr-card-list">' + cards2 + '</div></td></tr>';
    }

    // All emails (leads + follow-up combined) — card layout
    if (totalEmailsCount > 0) {
      var allEmails = (r.leadsEmailDetails || []).map(function(e) { return Object.assign({}, e, { _bucket: 'Leads' }); })
        .concat((r.followUpEmailDetails || []).map(function(e) { return Object.assign({}, e, { _bucket: 'Follow Up' }); }));
      var cardsAll = allEmails.map(function(e, i) {
        var bucketColor = e._bucket === 'Leads' ? '#3b82f6' : '#22c55e';
        var bucketBg = e._bucket === 'Leads' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.15)';
        var meta = [];
        meta.push('<span style="background:' + bucketBg + ';color:' + bucketColor + ';padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;">' + e._bucket + '</span>');
        if (e.type) meta.push('<span style="background:rgba(59,130,246,0.15);color:#3b82f6;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">' + esc(e.type) + '</span>');
        if (e.response) meta.push('<span style="background:rgba(148,163,184,0.18);color:var(--text-muted);padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:600;">Response: ' + esc(e.response) + '</span>');
        var sentLabel = fmtEmailSentAt(e.sentAt);
        var head = (sentLabel ? '<span style="color:var(--text-muted);font-size:0.72rem;margin-right:0.5rem;">' + esc(sentLabel) + '</span>' : '');
        return '<div class="dr-card">' +
          '<div class="dr-card-label">' + head + esc(e.recipient || '—') + (e.company ? ' <span style="color:var(--text-muted);font-weight:500;">· ' + esc(e.company) + '</span>' : '') + '</div>' +
          '<div class="dr-card-body">' +
            '<div style="margin-bottom:0.35rem;"><strong style="color:var(--text-primary);">Subject:</strong> ' + drTruncate(e.detail || '—', 'dr-all-txt-' + idx + '-' + i) + '</div>' +
            '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' + meta.join('') + '</div>' +
          '</div></div>';
      }).join('');
      rows += '<tr class="dr-expand-row" id="dr-allemails-' + idx + '"><td colspan="13">' +
        '<div class="dr-expand-label">All Emails (' + totalEmailsCount + ')</div>' +
        '<div class="dr-card-list">' + cardsAll + '</div></td></tr>';
    }

    // Call details — card layout
    if (callCount > 0) {
      var cards3 = r.callDetails.map(function(c, i) {
        var cls = c.status === 'Successful' ? 'dr-call-ok' : 'dr-call-fail';
        var label = c.status === 'Successful' ? 'Successful' : 'Unsuccessful';
        var lines = [];
        if (c.topic) lines.push('<div><strong style="color:var(--text-primary);">Topic:</strong> ' + esc(c.topic) + '</div>');
        if (c.outcome) lines.push('<div><strong style="color:var(--text-primary);">Outcome:</strong> ' + esc(c.outcome) + '</div>');
        if (c.notes) lines.push('<div style="margin-top:0.25rem;color:var(--text-muted);"><strong style="color:var(--text-primary);">Notes:</strong> ' + drTruncate(c.notes, 'dr-call-notes-' + idx + '-' + i) + '</div>');
        var head = (c.time ? '<span style="color:var(--text-muted);font-size:0.75rem;margin-right:0.5rem;">' + esc(c.time) + '</span>' : '');
        return '<div class="dr-card">' +
          '<div class="dr-card-label">' + head + esc(c.contact || '—') + (c.company ? ' <span style="color:var(--text-muted);font-weight:500;">· ' + esc(c.company) + '</span>' : '') +
            ' <span class="dr-call-status ' + cls + '" style="margin-left:0.4rem;">' + label + '</span></div>' +
          (lines.length ? '<div class="dr-card-body">' + lines.join('') + '</div>' : '') +
          '</div>';
      }).join('');
      rows += '<tr class="dr-expand-row" id="dr-calls-' + idx + '"><td colspan="13">' +
        '<div class="dr-expand-label">Call Details</div>' +
        '<div class="dr-card-list">' + cards3 + '</div></td></tr>';
    }

    // Urgent issues — full-width card layout with category tags
    if (urgentCount > 0) {
      var cards4 = r.urgentIssues.map(function(issue, i) {
        return '<div class="dr-urgent-card">' +
          '<div class="dr-urgent-tag">' + esc(issue.category) + '</div>' +
          '<div class="dr-urgent-desc">' + drTruncate(issue.description, 'dr-urg-txt-' + idx + '-' + i) + '</div>' +
          '</div>';
      }).join('');
      rows += '<tr class="dr-expand-row" id="dr-urgent-' + idx + '"><td colspan="13">' +
        '<div class="dr-expand-label urgent">Urgent Issues</div>' +
        '<div class="dr-card-list">' + cards4 + '</div></td></tr>';
    }

    // Other task — full-width readable note
    if (otherTaskText) {
      rows += '<tr class="dr-expand-row" id="dr-other-' + idx + '"><td colspan="13">' +
        '<div class="dr-expand-label" style="color:#b45309;">Other Task / Notes</div>' +
        '<div style="padding:0.6rem 0.8rem;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;white-space:pre-wrap;font-size:0.85rem;line-height:1.45;color:var(--text-primary);">' + esc(otherTaskText) + '</div>' +
        '</td></tr>';
    }
  });

  container.innerHTML =
    '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem;">' + submittedCount + '/' + totalAgents + ' agents submitted</div>' +
    '<table class="dr-table"><thead><tr>' +
    '<th>Agent</th><th style="text-align:center;">Quotations</th><th style="text-align:center;">Purchase Requests</th>' +
    '<th style="text-align:center;">Leads Emails</th><th style="text-align:center;">Follow Up Emails</th><th style="text-align:center;">Total Emails</th>' +
    '<th style="text-align:center;">Total Calls</th><th style="text-align:center;">Successful</th><th style="text-align:center;">Unsuccessful</th>' +
    '<th>Call Details</th><th>Urgent Issues</th><th style="text-align:center;">Other Task</th><th style="text-align:center;">Report PDF</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function openSalesReportPDF(driveLink, agentName) {
  if (!driveLink) return;
  var embedLink = driveLink.replace('/view', '/preview');
  var existing = document.getElementById('salesReportPdfModal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'salesReportPdfModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML =
    '<div style="background:var(--bg-card,#fff);border-radius:8px;width:min(900px,95vw);height:min(85vh,800px);display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border,#ddd);">' +
        '<strong>' + esc(agentName) + ' — Daily Report PDF</strong>' +
        '<div>' +
          '<a href="' + esc(driveLink) + '" target="_blank" style="margin-right:12px;color:var(--accent);text-decoration:none;">Open in Drive</a>' +
          '<button onclick="document.getElementById(\'salesReportPdfModal\').remove()" style="background:transparent;border:1px solid var(--border,#ccc);border-radius:4px;padding:4px 10px;cursor:pointer;">Close</button>' +
        '</div>' +
      '</div>' +
      '<iframe src="' + esc(embedLink) + '" style="flex:1;border:none;width:100%;"></iframe>' +
    '</div>';
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function toggleReportDetails(id) {
  var row = document.getElementById(id);
  if (row) row.classList.toggle('open');
}

function switchDrTab(tab) {
  drActiveTab = tab;
  var tabs = ['sales', 'admin', 'accounting', 'hr'];
  var ids = { sales: 'drTabSales', admin: 'drTabAdmin', accounting: 'drTabAccounting', hr: 'drTabHR' };
  tabs.forEach(function(t) {
    var el = document.getElementById(ids[t]);
    if (!el) return;
    if (t === tab) {
      el.style.borderBottomColor = 'var(--accent)';
      el.style.color = 'var(--accent)';
      el.classList.add('active');
    } else {
      el.style.borderBottomColor = 'transparent';
      el.style.color = 'var(--text-muted)';
      el.classList.remove('active');
    }
  });
  renderDrActiveTab();
}

function renderDrActiveTab() {
  switch (drActiveTab) {
    case 'admin': renderAdminDailyReportsTable(drAdminData); break;
    case 'accounting': renderAccountingDailyReportsTable(drAcctData); break;
    case 'hr': renderHRDailyReportsTable(drHRData); break;
    default: renderDailyReportsTable(drLastData); break;
  }
}

function _parseSnapshot(r) {
  if (!r || !r.snapshotData) return null;
  try { return JSON.parse(r.snapshotData); } catch (e) { return null; }
}

function _drSnapshotSectionsCards(snapshot, sections) {
  // sections: [{key, label}]
  return sections.map(function(sec) {
    var items = (snapshot && Array.isArray(snapshot[sec.key])) ? snapshot[sec.key] : [];
    return { key: sec.key, label: sec.label, count: items.length, items: items };
  });
}

function _drRenderItemCards(items) {
  return items.map(function(item) {
    var lines = [];
    for (var k in item) {
      if (item.hasOwnProperty(k)) {
        var val = item[k];
        if (val === null || val === undefined) continue;
        if (typeof val === 'object') continue;
        var s = String(val).trim();
        if (s) lines.push('<strong>' + esc(k) + ':</strong> ' + esc(s));
      }
    }
    return '<div class="dr-card"><div class="dr-card-body">' + lines.join('<br>') + '</div></div>';
  }).join('');
}

function _drRenderNotes(notesText) {
  if (!notesText) return '';
  var formatted = String(notesText).split('\n').map(function(line) {
    return line === '' ? '<br>' : '<span>' + esc(line) + '</span>';
  }).join('<br>');
  return '<div class="dr-card-list"><div class="dr-card"><div class="dr-card-body" style="white-space:normal;line-height:1.6;">' + formatted + '</div></div></div>';
}

function renderAdminDailyReportsTable(reports) {
  var container = document.getElementById('drReportsContainer');
  if (reports.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No admin users found.</div>';
    return;
  }

  var submittedCount = reports.filter(function(r) { return r.submitted; }).length;
  var totalAdmins = reports.length;

  // New snapshot sections
  var newSections = [
    { key: 'purchaseOrders', label: 'POs' },
    { key: 'supplierQuotations', label: 'Supplier Qtns' },
    { key: 'pricingSubmissions', label: 'Pricing' },
    { key: 'shipments', label: 'Shipments' },
    { key: 'paymentRequests', label: 'PRs' },
    { key: 'salesOrders', label: 'SOs' },
    { key: 'emails', label: 'Emails' }
  ];

  // Legacy sections (fallback when snapshotData is missing)
  var legacySections = [
    { key: 'poStatus', label: 'PO Status' },
    { key: 'internationalShipment', label: "Int'l Shipment" },
    { key: 'localShipment', label: 'Local Shipment' },
    { key: 'deliveryForClient', label: 'Delivery' },
    { key: 'pendingInquiry', label: 'Inquiries' },
    { key: 'receivedQuotation', label: 'Quotations Recv' },
    { key: 'otherTasks', label: 'Other Tasks' }
  ];

  var rows = '';
  var anyHasSnapshot = reports.some(function(r) { return r.submitted && r.snapshotData; });
  var sections = anyHasSnapshot ? newSections : legacySections;
  var totalCols = sections.length + 2; // name + sections + notes

  reports.forEach(function(r, idx) {
    if (!r.submitted) {
      rows += '<tr class="dr-not-submitted">' +
        '<td><strong>' + esc(r.adminName) + '</strong></td>' +
        '<td colspan="' + (totalCols - 1) + '" style="text-align:center;"><span class="dr-status-missing">Not Submitted</span></td>' +
        '</tr>';
      return;
    }

    var snap = _parseSnapshot(r);
    var sectionData;
    if (snap) {
      sectionData = _drSnapshotSectionsCards(snap, newSections);
    } else {
      sectionData = legacySections.map(function(sec) {
        var items = [];
        try { items = JSON.parse(r[sec.key] || '[]'); } catch (e) {}
        return { key: sec.key, label: sec.label, count: items.length, items: items };
      });
    }

    var cells = sectionData.map(function(sd, i) {
      var prefix = 'adm-' + idx + '-' + i;
      if (sd.count > 0) {
        return '<td style="text-align:center;"><button class="dr-details-btn" onclick="toggleReportDetails(\'' + prefix + '\')">' + sd.count + '</button></td>';
      }
      return '<td style="text-align:center;"><span class="dr-badge-muted">0</span></td>';
    }).join('');

    var notesText = (snap && snap.notes) || r.notes || '';
    var notesCell = notesText
      ? '<td style="text-align:center;"><button class="dr-details-btn" onclick="toggleReportDetails(\'adm-notes-' + idx + '\')">View</button></td>'
      : '<td style="text-align:center;"><span class="dr-badge-muted">—</span></td>';

    rows += '<tr>' +
      '<td><strong>' + esc(r.adminName) + '</strong></td>' +
      cells + notesCell + '</tr>';

    sectionData.forEach(function(sd, i) {
      if (sd.count === 0) return;
      var prefix = 'adm-' + idx + '-' + i;
      rows += '<tr class="dr-expand-row" id="' + prefix + '"><td colspan="' + totalCols + '">' +
        '<div class="dr-expand-label">' + esc(sd.label) + '</div>' +
        '<div class="dr-card-list">' + _drRenderItemCards(sd.items) + '</div></td></tr>';
    });

    if (notesText) {
      rows += '<tr class="dr-expand-row" id="adm-notes-' + idx + '"><td colspan="' + totalCols + '">' +
        '<div class="dr-expand-label">Notes</div>' + _drRenderNotes(notesText) + '</td></tr>';
    }
  });

  var headerCells = sections.map(function(sec) {
    return '<th style="text-align:center;">' + esc(sec.label) + '</th>';
  }).join('');

  container.innerHTML =
    '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem;">' + submittedCount + '/' + totalAdmins + ' submitted</div>' +
    '<table class="dr-table"><thead><tr>' +
    '<th>Admin</th>' + headerCells + '<th style="text-align:center;">Notes</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderAccountingDailyReportsTable(reports) {
  var container = document.getElementById('drReportsContainer');
  if (reports.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No accounting users found.</div>';
    return;
  }

  var submittedCount = reports.filter(function(r) { return r.submitted; }).length;
  var total = reports.length;

  var newSections = [
    { key: 'orders', label: 'Orders' },
    { key: 'collections', label: 'Collections' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'paymentRequests', label: 'PRs' },
    { key: 'salesOrders', label: 'SOs' },
    { key: 'emails', label: 'Emails' }
  ];

  var rows = '';
  var anyHasSnapshot = reports.some(function(r) { return r.submitted && r.snapshotData; });
  var totalCols = newSections.length + 2;

  reports.forEach(function(r, idx) {
    if (!r.submitted) {
      rows += '<tr class="dr-not-submitted">' +
        '<td><strong>' + esc(r.accountantName) + '</strong></td>' +
        '<td colspan="' + (totalCols - 1) + '" style="text-align:center;"><span class="dr-status-missing">Not Submitted</span></td>' +
        '</tr>';
      return;
    }

    var snap = _parseSnapshot(r);
    var sectionData;
    if (snap) {
      sectionData = _drSnapshotSectionsCards(snap, newSections);
    } else {
      // Legacy fallback
      sectionData = [
        { key: 'paymentsProcessed', label: 'Orders', count: (Array.isArray(r.paymentsProcessed)?r.paymentsProcessed.length:0), items: r.paymentsProcessed||[] },
        { key: 'collectionsReceived', label: 'Collections', count: (Array.isArray(r.collectionsReceived)?r.collectionsReceived.length:0), items: r.collectionsReceived||[] },
        { key: 'expensesProcessed', label: 'Expenses', count: (Array.isArray(r.expensesProcessed)?r.expensesProcessed.length:0), items: r.expensesProcessed||[] },
        { key: 'invoicesIssued', label: 'PRs', count: (Array.isArray(r.invoicesIssued)?r.invoicesIssued.length:0), items: r.invoicesIssued||[] },
        { key: 'salesOrders', label: 'SOs', count: 0, items: [] },
        { key: 'emails', label: 'Emails', count: 0, items: [] }
      ];
    }

    var cells = sectionData.map(function(sd, i) {
      var prefix = 'acct-' + idx + '-' + i;
      if (sd.count > 0) {
        return '<td style="text-align:center;"><button class="dr-details-btn" onclick="toggleReportDetails(\'' + prefix + '\')">' + sd.count + '</button></td>';
      }
      return '<td style="text-align:center;"><span class="dr-badge-muted">0</span></td>';
    }).join('');

    var notesText = (snap && snap.notes) || r.notes || r.otherTasks || r.bankReconciliation || '';
    var notesCell = notesText
      ? '<td style="text-align:center;"><button class="dr-details-btn" onclick="toggleReportDetails(\'acct-notes-' + idx + '\')">View</button></td>'
      : '<td style="text-align:center;"><span class="dr-badge-muted">—</span></td>';

    rows += '<tr>' +
      '<td><strong>' + esc(r.accountantName) + '</strong></td>' +
      cells + notesCell + '</tr>';

    sectionData.forEach(function(sd, i) {
      if (sd.count === 0) return;
      var prefix = 'acct-' + idx + '-' + i;
      rows += '<tr class="dr-expand-row" id="' + prefix + '"><td colspan="' + totalCols + '">' +
        '<div class="dr-expand-label">' + esc(sd.label) + '</div>' +
        '<div class="dr-card-list">' + _drRenderItemCards(sd.items) + '</div></td></tr>';
    });

    if (notesText) {
      rows += '<tr class="dr-expand-row" id="acct-notes-' + idx + '"><td colspan="' + totalCols + '">' +
        '<div class="dr-expand-label">Notes</div>' + _drRenderNotes(notesText) + '</td></tr>';
    }
  });

  var headerCells = newSections.map(function(sec) {
    return '<th style="text-align:center;">' + esc(sec.label) + '</th>';
  }).join('');

  container.innerHTML =
    '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem;">' + submittedCount + '/' + total + ' submitted</div>' +
    '<table class="dr-table"><thead><tr>' +
    '<th>Accountant</th>' + headerCells + '<th style="text-align:center;">Notes</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderHRDailyReportsTable(reports) {
  var container = document.getElementById('drReportsContainer');
  if (reports.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted);">No HR/Marketing users found.</div>';
    return;
  }

  var submittedCount = reports.filter(function(r) { return r.submitted; }).length;
  var total = reports.length;

  var newSections = [
    { key: 'recruitment', label: 'Recruitment' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'hrTasks', label: 'HR Tasks' },
    { key: 'memos', label: 'Memos' },
    { key: 'campaigns', label: 'Campaigns' },
    { key: 'content', label: 'Content' },
    { key: 'emails', label: 'Emails' }
  ];

  var rows = '';
  var totalCols = newSections.length + 2;

  reports.forEach(function(r, idx) {
    if (!r.submitted) {
      rows += '<tr class="dr-not-submitted">' +
        '<td><strong>' + esc(r.hrName) + '</strong></td>' +
        '<td colspan="' + (totalCols - 1) + '" style="text-align:center;"><span class="dr-status-missing">Not Submitted</span></td>' +
        '</tr>';
      return;
    }

    var snap = _parseSnapshot(r);
    var sectionData;
    if (snap) {
      sectionData = _drSnapshotSectionsCards(snap, newSections);
    } else {
      var legacyParse = function(key) { try { return JSON.parse(r[key] || '[]'); } catch (e) { return []; } };
      var recr = legacyParse('recruitmentActivity');
      var onb = legacyParse('onboardingActivity');
      var emp = legacyParse('employeeAdmin');
      var mkt = legacyParse('marketingActivity');
      sectionData = [
        { key: 'recruitment', label: 'Recruitment', count: recr.length, items: recr },
        { key: 'onboarding', label: 'Onboarding', count: onb.length, items: onb },
        { key: 'hrTasks', label: 'HR Tasks', count: emp.length, items: emp },
        { key: 'memos', label: 'Memos', count: 0, items: [] },
        { key: 'campaigns', label: 'Campaigns', count: mkt.length, items: mkt },
        { key: 'content', label: 'Content', count: 0, items: [] },
        { key: 'emails', label: 'Emails', count: 0, items: [] }
      ];
    }

    var cells = sectionData.map(function(sd, i) {
      var prefix = 'hr-' + idx + '-' + i;
      if (sd.count > 0) {
        return '<td style="text-align:center;"><button class="dr-details-btn" onclick="toggleReportDetails(\'' + prefix + '\')">' + sd.count + '</button></td>';
      }
      return '<td style="text-align:center;"><span class="dr-badge-muted">0</span></td>';
    }).join('');

    var notesText = (snap && snap.notes) || r.notes || r.otherTaskParagraph || '';
    var notesCell = notesText
      ? '<td style="text-align:center;"><button class="dr-details-btn" onclick="toggleReportDetails(\'hr-notes-' + idx + '\')">View</button></td>'
      : '<td style="text-align:center;"><span class="dr-badge-muted">—</span></td>';

    rows += '<tr>' +
      '<td><strong>' + esc(r.hrName) + '</strong></td>' +
      cells + notesCell + '</tr>';

    sectionData.forEach(function(sd, i) {
      if (sd.count === 0) return;
      var prefix = 'hr-' + idx + '-' + i;
      rows += '<tr class="dr-expand-row" id="' + prefix + '"><td colspan="' + totalCols + '">' +
        '<div class="dr-expand-label">' + esc(sd.label) + '</div>' +
        '<div class="dr-card-list">' + _drRenderItemCards(sd.items) + '</div></td></tr>';
    });

    if (notesText) {
      rows += '<tr class="dr-expand-row" id="hr-notes-' + idx + '"><td colspan="' + totalCols + '">' +
        '<div class="dr-expand-label">Notes</div>' + _drRenderNotes(notesText) + '</td></tr>';
    }
  });

  var headerCells = newSections.map(function(sec) {
    return '<th style="text-align:center;">' + esc(sec.label) + '</th>';
  }).join('');

  container.innerHTML =
    '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.75rem;">' + submittedCount + '/' + total + ' submitted</div>' +
    '<table class="dr-table"><thead><tr>' +
    '<th>HR/Marketing</th>' + headerCells + '<th style="text-align:center;">Notes</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function exportDailyReportsExcel() {
  if (!drLastData || drLastData.length === 0) return;
  await loadXLSX();
  var dateVal = document.getElementById('drReportDate').value;
  var headers = ['Agent', 'Quotations', 'PRs', 'Leads Emails', 'Follow Up Emails', 'Total Calls', 'Successful', 'Unsuccessful', 'Status'];
  var dataRows = drLastData.map(function(r) {
    return [
      r.agentName,
      r.submitted ? r.quotationsSent : '',
      r.submitted ? r.prsSent : '',
      r.submitted ? r.leadsEmails : '',
      r.submitted ? r.followUpEmails : '',
      r.submitted ? r.totalCalls : '',
      r.submitted ? r.successfulCalls : '',
      r.submitted ? r.unsuccessfulCalls : '',
      r.submitted ? 'Submitted' : 'Not Submitted'
    ];
  });
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(dataRows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Daily Reports');
  XLSX.writeFile(wb, 'daily-reports-' + dateVal + '.xlsx');
}

// ═══════════════════════════════════════════════
// Section 8: HR-Marketing Summary
// ═══════════════════════════════════════════════

function renderHRSummary(result) {
  if (result.status === 'rejected' || !result.value || !result.value.success) return;
  var d = result.value.data;
  document.getElementById('hrOpenPositions').textContent = d.openPositions || 0;
  document.getElementById('hrOnboarding').textContent = d.onboarding || 0;
  document.getElementById('hrTasksDone').textContent = d.tasksCompleted || 0;
  document.getElementById('hrTasksPending').textContent = d.tasksPending || 0;
  document.getElementById('hrTotalEmp').textContent = d.totalEmployees || 0;
}

// ═══════════════════════════════════════════════
// HR Module Cards (HR Insights section detail)
// ═══════════════════════════════════════════════

function _hrData(result) {
  if (!result || result.status !== 'fulfilled') return [];
  var v = result.value;
  if (!v || !v.success) return [];
  var d = v.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return Object.values(d);
  return [];
}

function _hrPill(label, kind) {
  if (label == null || label === '') return '<span class="hr-pill">—</span>';
  var cls = 'hr-pill';
  var s = String(label).toLowerCase();
  if (kind === 'status') {
    if (/(complete|approved|done|paid|active|hired|published|closed|resolved)/.test(s)) cls += ' hr-pill-green';
    else if (/(pending|in[- ]?progress|draft|scheduled|review|onboarding|open)/.test(s)) cls += ' hr-pill-amber';
    else if (/(reject|cancel|overdue|fail|terminated)/.test(s)) cls += ' hr-pill-red';
    else cls += ' hr-pill-blue';
  } else if (kind === 'priority') {
    if (/(high|urgent|critical)/.test(s)) cls += ' hr-pill-red';
    else if (/(medium|normal)/.test(s)) cls += ' hr-pill-amber';
    else cls += ' hr-pill-green';
  }
  return '<span class="' + cls + '">' + esc(label) + '</span>';
}

function _hrFmtDate(v) {
  if (!v) return '';
  try {
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) { return String(v); }
}

function _hrTable(headers, rows, emptyMsg) {
  if (!rows.length) return '<div class="hr-mod-empty">' + esc(emptyMsg) + '</div>';
  var thead = '<thead><tr>' + headers.map(function(h){ return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead>';
  var tbody = '<tbody>' + rows.map(function(r){ return '<tr>' + r.map(function(c){ return '<td>' + (c == null ? '' : c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>';
  return '<table class="hr-mod-table">' + thead + tbody + '</table>';
}

function _hrSet(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
function _hrCount(id, n) { var el = document.getElementById(id); if (el) el.textContent = n; }

function renderHRModules(results) {
  var recruitment = _hrData(results.recruitment);
  var employees = _hrData(results.employees);
  var leave = _hrData(results.leave);
  var reviews = _hrData(results.reviews);
  var training = _hrData(results.training);
  var tasks = _hrData(results.tasks);
  var memos = _hrData(results.memos);
  var grievances = _hrData(results.grievances);
  var campaigns = _hrData(results.campaigns);
  var content = _hrData(results.content);
  var accred = _hrData(results.accred);
  var birthdays = _hrData(results.birthdays);

  // Recruitment Pipeline
  _hrCount('hrModCountRecr', recruitment.length);
  _hrSet('hrModRecruitment', _hrTable(
    ['Candidate', 'Position', 'Stage', 'Applied', 'Assigned'],
    recruitment.map(function(r){
      return [esc(r.candidateName || r.name || ''), esc(r.position || ''), _hrPill(r.stage || r.status, 'status'),
              esc(_hrFmtDate(r.dateApplied || r.appliedDate)), esc(r.assignedHR || r.assignedTo || '')];
    }), 'No candidates in pipeline.'
  ));
  var openRecr = recruitment.filter(function(r){ var s = String(r.stage || r.status || '').toLowerCase(); return s && !/(hired|rejected|withdrawn|closed)/.test(s); });
  var hrOpenRec = document.getElementById('hrOpenRecruitment'); if (hrOpenRec) hrOpenRec.textContent = openRecr.length;

  // Employees
  _hrCount('hrModCountEmp', employees.length);
  _hrSet('hrModEmployees', _hrTable(
    ['Name', 'Position', 'Department', 'Hired', 'Status'],
    employees.map(function(e){
      return [esc(e.employeeName || e.name || ''), esc(e.position || ''), esc(e.department || ''),
              esc(_hrFmtDate(e.dateHired || e.hireDate)), _hrPill(e.onboardingStatus || e.status, 'status')];
    }), 'No employees.'
  ));

  // Leave Requests
  _hrCount('hrModCountLeave', leave.length);
  _hrSet('hrModLeave', _hrTable(
    ['Employee', 'Type', 'Dates', 'Days', 'Status'],
    leave.map(function(l){
      var dates = (_hrFmtDate(l.startDate || l.dateFrom) || '') + (l.endDate || l.dateTo ? ' – ' + _hrFmtDate(l.endDate || l.dateTo) : '');
      return [esc(l.employee || l.employeeName || ''), esc(l.type || l.leaveType || ''), esc(dates),
              esc(l.days || l.totalDays || ''), _hrPill(l.status, 'status')];
    }), 'No leave requests.'
  ));
  var pendingLeave = leave.filter(function(l){ return String(l.status || '').toLowerCase() === 'pending'; }).length;
  var hrPL = document.getElementById('hrPendingLeave'); if (hrPL) hrPL.textContent = pendingLeave;

  // Performance Reviews
  _hrCount('hrModCountReviews', reviews.length);
  _hrSet('hrModReviews', _hrTable(
    ['Employee', 'Reviewer', 'Period', 'Rating', 'Status'],
    reviews.map(function(rv){
      return [esc(rv.employee || rv.employeeName || ''), esc(rv.reviewer || ''),
              esc(rv.period || rv.reviewPeriod || ''), esc(rv.rating || rv.overallRating || ''),
              _hrPill(rv.status, 'status')];
    }), 'No reviews.'
  ));
  var overdueReviews = reviews.filter(function(rv){ var s = String(rv.status || '').toLowerCase(); return /(overdue|pending)/.test(s); }).length;
  var hrOR = document.getElementById('hrOverdueReviews'); if (hrOR) hrOR.textContent = overdueReviews;

  // Training Programs
  _hrCount('hrModCountTraining', training.length);
  _hrSet('hrModTraining', _hrTable(
    ['Title', 'Type', 'Date', 'Department', 'Status'],
    training.map(function(t){
      return [esc(t.title || ''), esc(t.type || ''), esc(_hrFmtDate(t.date || t.startDate)),
              esc(t.department || ''), _hrPill(t.status, 'status')];
    }), 'No training programs.'
  ));
  var trainingDone = training.filter(function(t){ return /(complete|done)/i.test(String(t.status || '')); }).length;
  var trainingPct = training.length ? Math.round((trainingDone / training.length) * 100) + '%' : '—';
  var hrTP = document.getElementById('hrTrainingPct'); if (hrTP) hrTP.textContent = trainingPct;

  // HR Tasks
  _hrCount('hrModCountTasks', tasks.length);
  _hrSet('hrModTasks', _hrTable(
    ['Title', 'Type', 'Assigned', 'Due', 'Status'],
    tasks.map(function(t){
      return [esc(t.title || ''), esc(t.type || ''), esc(t.assignedTo || ''),
              esc(_hrFmtDate(t.dueDate)), _hrPill(t.status, 'status')];
    }), 'No HR tasks.'
  ));

  // Memos
  _hrCount('hrModCountMemos', memos.length);
  _hrSet('hrModMemos', _hrTable(
    ['Title', 'Type', 'Target', 'Priority', 'Status'],
    memos.map(function(m){
      return [esc(m.title || ''), esc(m.type || ''), esc(m.target || ''),
              _hrPill(m.priority, 'priority'), _hrPill(m.status, 'status')];
    }), 'No memos.'
  ));
  var activeMemos = memos.filter(function(m){ return /active/i.test(String(m.status || '')); }).length;
  var hrAM = document.getElementById('hrActiveMemos'); if (hrAM) hrAM.textContent = activeMemos;

  // Grievances
  _hrCount('hrModCountGrv', grievances.length);
  _hrSet('hrModGrievances', _hrTable(
    ['Subject', 'Category', 'Submitted By', 'Assigned', 'Status'],
    grievances.map(function(g){
      var by = g.anonymous ? 'Anonymous' : (g.submittedBy || '');
      return [esc(g.subject || ''), esc(g.category || ''), esc(by),
              esc(g.assignedTo || ''), _hrPill(g.status, 'status')];
    }), 'No grievances.'
  ));
  var activeGrv = grievances.filter(function(g){ var s = String(g.status || '').toLowerCase(); return s && !/(resolved|closed)/.test(s); }).length;
  var hrAG = document.getElementById('hrActiveGrievances'); if (hrAG) hrAG.textContent = activeGrv;

  // Campaigns
  _hrCount('hrModCountCamp', campaigns.length);
  _hrSet('hrModCampaigns', _hrTable(
    ['Name', 'Channel', 'Dates', 'Leads', 'Status'],
    campaigns.map(function(c){
      var dates = (_hrFmtDate(c.startDate) || '') + (c.endDate ? ' – ' + _hrFmtDate(c.endDate) : '');
      return [esc(c.name || ''), esc(c.channel || ''), esc(dates),
              esc(c.leads || 0), _hrPill(c.status, 'status')];
    }), 'No campaigns.'
  ));

  // Content Calendar
  _hrCount('hrModCountContent', content.length);
  _hrSet('hrModContent', _hrTable(
    ['Title', 'Platform', 'Type', 'Scheduled', 'Status'],
    content.map(function(c){
      return [esc(c.title || ''), esc(c.platform || ''), esc(c.type || ''),
              esc(_hrFmtDate(c.scheduledDate)), _hrPill(c.status, 'status')];
    }), 'No content scheduled.'
  ));

  // Accreditations
  _hrCount('hrModCountAccred', accred.length);
  _hrSet('hrModAccreditations', _hrTable(
    ['Name', 'Issuing Body', 'Issued', 'Expires', 'Status'],
    accred.map(function(a){
      return [esc(a.name || ''), esc(a.issuingBody || ''), esc(_hrFmtDate(a.dateIssued)),
              esc(_hrFmtDate(a.expiryDate)), _hrPill(a.status, 'status')];
    }), 'No accreditations.'
  ));

  // Birthdays & Anniversaries
  _hrCount('hrModCountBday', birthdays.length);
  _hrSet('hrModBirthdays', _hrTable(
    ['Employee', 'Event', 'Date'],
    birthdays.map(function(b){
      var event = b.eventType || (b.birthdate ? 'Birthday' : (b.anniversary ? 'Anniversary' : ''));
      var date = b.eventDate || b.birthdate || b.anniversary || b.dateHired || '';
      return [esc(b.employeeName || b.name || ''), esc(event), esc(_hrFmtDate(date))];
    }), 'No upcoming events.'
  ));
}

// ═══════════════════════════════════════════════
// Expense Summary Panel
// ═══════════════════════════════════════════════

var _allExpenseData = [];
var _mgmtExpAllTime = false;

function renderMgmtExpenses(result) {
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    document.getElementById('expenseCatContainer').innerHTML = '<div style="padding:1rem;color:#ef4444;">Could not load expenses</div>';
    return;
  }
  _allExpenseData = result.value.data || [];

  // Default to All Time so data is always visible on load
  _mgmtExpAllTime = true;
  var btn = document.getElementById('mgmtExpAllTimeBtn');
  btn.style.background  = 'var(--accent,#f97316)';
  btn.style.color       = '#fff';
  btn.style.borderColor = 'var(--accent,#f97316)';
  document.getElementById('mgmtExpMonthFilter').disabled = true;
  document.getElementById('mgmtExpMonthFilter').style.opacity = '0.4';

  // Still set the month input to current month for when user toggles off All Time
  var now = new Date();
  document.getElementById('mgmtExpMonthFilter').value =
    now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  mgmtApplyExpenseFilters();
}

function toggleMgmtExpAllTime() {
  _mgmtExpAllTime = !_mgmtExpAllTime;
  var btn = document.getElementById('mgmtExpAllTimeBtn');
  var mf  = document.getElementById('mgmtExpMonthFilter');
  btn.style.background   = _mgmtExpAllTime ? 'var(--accent,#f97316)' : 'transparent';
  btn.style.color        = _mgmtExpAllTime ? '#fff' : 'var(--text-muted,#64748b)';
  btn.style.borderColor  = _mgmtExpAllTime ? 'var(--accent,#f97316)' : 'var(--border,#334155)';
  mf.disabled            = _mgmtExpAllTime;
  mf.style.opacity       = _mgmtExpAllTime ? '0.4' : '1';
  mgmtApplyExpenseFilters();
}

function mgmtApplyExpenseFilters() {
  if (!_mgmtExpAllTime) {
    // If toggling off all-time via month input, reset button
    var btn = document.getElementById('mgmtExpAllTimeBtn');
    btn.style.background  = 'transparent';
    btn.style.color       = 'var(--text-muted,#64748b)';
    btn.style.borderColor = 'var(--border,#334155)';
    _mgmtExpAllTime = false;
    document.getElementById('mgmtExpMonthFilter').disabled = false;
    document.getElementById('mgmtExpMonthFilter').style.opacity = '1';
  }

  var month    = document.getElementById('mgmtExpMonthFilter').value;
  var category = document.getElementById('mgmtExpCatFilter').value;

  var filtered = _allExpenseData.filter(function(e) {
    if (!_mgmtExpAllTime && month && !String(e.date || '').startsWith(month)) return false;
    if (category && e.category !== category) return false;
    return true;
  });

  _renderMgmtExpensePanel(filtered, month);
}

function _renderMgmtExpensePanel(filtered, month) {
  var currentYM  = new Date().toISOString().slice(0, 7);
  var currentY   = new Date().getFullYear().toString();

  // KPI totals
  var totalFiltered = 0, totalMonth = 0, totalYear = 0, totalAllTime = 0;
  _allExpenseData.forEach(function(e) {
    var amt = e.total || e.amount || 0;
    totalAllTime += amt;
    if (String(e.date || '').startsWith(currentYM)) totalMonth += amt;
    if (String(e.date || '').startsWith(currentY))  totalYear  += amt;
  });
  filtered.forEach(function(e) { totalFiltered += e.total || e.amount || 0; });

  function _expKpiCard(value, label, color) {
    return '<div style="background:var(--surface,#ffffff);border:1px solid var(--border,#334155);border-radius:10px;padding:0.75rem 1rem;border-left:3px solid ' + color + ';">' +
      '<div style="font-size:1.15rem;font-weight:700;color:' + color + ';">₱' + _expFmt(value) + '</div>' +
      '<div style="font-size:0.72rem;color:var(--text-muted,#64748b);margin-top:0.15rem;">' + label + '</div>' +
    '</div>';
  }

  var label = _mgmtExpAllTime ? 'All Time' : (month ? _mgmtMonthLabel(month) : 'Filtered');
  document.getElementById('expenseSummaryKPIs').innerHTML =
    _expKpiCard(totalFiltered, label + ' Total',   '#f97316') +
    _expKpiCard(totalMonth,    _mgmtMonthLabel(currentYM) + ' Total', '#ef4444') +
    _expKpiCard(totalYear,     new Date().getFullYear() + ' Total',   '#8b5cf6') +
    _expKpiCard(totalAllTime,  'All-Time Total',   '#14b8a6');

  // Category breakdown
  var catMap = {};
  filtered.forEach(function(e) {
    var c = e.category || 'Uncategorized';
    catMap[c] = (catMap[c] || 0) + (e.total || e.amount || 0);
  });
  var cats = Object.keys(catMap).sort(function(a, b) { return catMap[b] - catMap[a]; });

  if (cats.length === 0) {
    document.getElementById('expenseCatContainer').innerHTML =
      '<div style="text-align:center;padding:1rem;color:var(--text-muted,#64748b);">No expenses for this period.</div>';
    document.getElementById('expensesTableContainer').innerHTML = '';
    return;
  }

  var html = '<div style="background:var(--surface,#ffffff);border:1px solid var(--border,#334155);border-radius:10px;padding:1rem;">' +
    '<div style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#64748b);letter-spacing:.05em;margin-bottom:0.75rem;">EXPENSES BY CATEGORY</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.5rem;">';

  cats.forEach(function(cat) {
    var amt = catMap[cat];
    var pct = totalFiltered > 0 ? (amt / totalFiltered * 100) : 0;
    html += '<div style="background:var(--surface-2,#f8fafc);border-radius:8px;padding:0.5rem 0.75rem;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">' +
        '<span style="font-size:0.78rem;color:var(--text-primary,#f1f5f9);font-weight:500;">' + esc(cat) + '</span>' +
        '<span style="font-size:0.78rem;font-weight:700;color:var(--accent,#f97316);">₱' + _expFmt(amt) + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:0.4rem;">' +
        '<div style="flex:1;height:5px;border-radius:999px;background:var(--border,#334155);overflow:hidden;">' +
          '<div style="width:' + pct.toFixed(1) + '%;height:100%;border-radius:999px;background:#f97316;"></div>' +
        '</div>' +
        '<span style="font-size:0.7rem;color:var(--text-muted,#64748b);min-width:32px;text-align:right;">' + pct.toFixed(1) + '%</span>' +
      '</div>' +
    '</div>';
  });

  html += '</div></div>';
  document.getElementById('expenseCatContainer').innerHTML = html;

  // ── Full expense table ──
  var grandTotal = 0;
  var tbl = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.8rem;">' +
    '<thead><tr style="border-bottom:1px solid var(--border,#334155);">' +
    ['Date','Category','Voucher #','Client','Description','Toll','Fuel','Meals','Load Bal','Other','Total']
      .map(function(h){ return '<th style="text-align:left;padding:0.5rem 0.6rem;color:var(--text-muted,#64748b);font-size:0.74rem;font-weight:600;white-space:nowrap;">' + h + '</th>'; }).join('') +
    '</tr></thead><tbody>';

  filtered.forEach(function(e) {
    grandTotal += e.total || 0;
    tbl += '<tr style="border-bottom:1px solid #e2e8f0;">';
    tbl += '<td style="padding:0.5rem 0.6rem;white-space:nowrap;color:var(--text-primary,#f1f5f9);">' + esc(e.date) + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;"><span style="display:inline-block;padding:0.15rem 0.55rem;border-radius:6px;font-size:0.7rem;font-weight:600;background:rgba(249,115,22,0.12);color:#f97316;">' + esc(e.category) + '</span></td>';
    tbl += '<td style="padding:0.5rem 0.6rem;color:var(--text-primary,#f1f5f9);">' + esc(e.orderRef || '—') + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;color:var(--text-primary,#f1f5f9);">' + esc(e.client || '—') + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary,#f1f5f9);" title="' + esc(e.description) + '">' + esc(e.description || '—') + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;color:var(--text-primary,#f1f5f9);">' + (e.toll ? '₱' + _expFmt(e.toll) : '<span style="color:var(--text-muted,#64748b);">—</span>') + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;color:var(--text-primary,#f1f5f9);">' + (e.fuel ? '₱' + _expFmt(e.fuel) : '<span style="color:var(--text-muted,#64748b);">—</span>') + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;color:var(--text-primary,#f1f5f9);">' + (e.meals ? '₱' + _expFmt(e.meals) : '<span style="color:var(--text-muted,#64748b);">—</span>') + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;color:var(--text-primary,#f1f5f9);">' + (e.loadBalance ? '₱' + _expFmt(e.loadBalance) : '<span style="color:var(--text-muted,#64748b);">—</span>') + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;color:var(--text-primary,#f1f5f9);">' + (e.otherAmount ? '₱' + _expFmt(e.otherAmount) : '<span style="color:var(--text-muted,#64748b);">—</span>') + '</td>';
    tbl += '<td style="padding:0.5rem 0.6rem;font-weight:700;color:var(--accent,#f97316);">₱' + _expFmt(e.total) + '</td>';
    tbl += '</tr>';
  });

  tbl += '<tr style="border-top:2px solid var(--border,#334155);">';
  tbl += '<td colspan="10" style="padding:0.5rem 0.6rem;text-align:right;font-weight:700;color:var(--text-muted,#64748b);font-size:0.74rem;">GRAND TOTAL</td>';
  tbl += '<td style="padding:0.5rem 0.6rem;font-weight:700;color:var(--accent,#f97316);">₱' + _expFmt(grandTotal) + '</td>';
  tbl += '</tr>';
  tbl += '</tbody></table></div>';

  document.getElementById('expensesTableContainer').innerHTML = tbl;
}

function _mgmtMonthLabel(ym) {
  if (!ym) return '';
  try {
    var d = new Date(ym + '-01');
    return d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  } catch(e) { return ym; }
}

function _expFmt(n) {
  return (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ═══════════════════════════════════════════════
// Shipment Monitoring (read-only view for management)
// ═══════════════════════════════════════════════

let _mgmtSmAll = [];

function renderMgmtShipments(result) {
  const container = document.getElementById('mgmtSmContainer');
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    container.innerHTML = '<div style="padding:1rem;color:#ef4444;">Could not load shipments.</div>';
    document.getElementById('summary-shipments').textContent = 'Error loading';
    return;
  }
  _mgmtSmAll = result.value.data || [];

  // Summary chip
  const total     = _mgmtSmAll.length;
  const inTransit = _mgmtSmAll.filter(s => s.status === 'In Transit').length;
  const arrived   = _mgmtSmAll.filter(s => s.status === 'Arrived').length;
  document.getElementById('summary-shipments').textContent =
    total + ' shipments · ' + inTransit + ' in transit · ' + arrived + ' arrived';

  _mgmtSmRender('All');
}

function mgmtSmFilter(status, btn) {
  document.querySelectorAll('.sm-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _mgmtSmRender(status);
}

function _mgmtSmRender(filter) {
  const container = document.getElementById('mgmtSmContainer');
  const rows = filter === 'All' ? _mgmtSmAll : _mgmtSmAll.filter(s => s.status === filter);

  if (!rows.length) {
    container.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text-muted,#64748b);">No shipments found.</div>';
    return;
  }

  const statusColor = { Pending: '#f59e0b', 'In Transit': '#3b82f6', Arrived: '#22c55e', Delivered: '#8b5cf6', Cancelled: '#ef4444' };

  container.innerHTML = rows.map((s, idx) => {
    const color = statusColor[s.status] || '#64748b';
    const docsObj = _mgmtSmParseDocs(s.documents);
    const docCount = Object.values(docsObj).reduce((n, arr) => n + arr.length, 0);
    return `<div class="sm-row" onclick="_mgmtSmOpenDetail(${idx})">
      <div class="sm-row-left">
        <div class="sm-row-po">
          ${esc(s.poNo || '—')}
          <span style="margin-left:0.4rem;font-size:0.7rem;font-weight:600;padding:0.1rem 0.5rem;border-radius:10px;background:${color}22;color:${color};border:1px solid ${color}44;">${esc(s.status)}</span>
        </div>
        <div class="sm-row-sub">${esc(s.principal || '')}${s.item ? ' · ' + s.item : ''}${s.eta ? ' · ETA: ' + s.eta : ''}</div>
      </div>
      <div class="sm-row-right">
        ${docCount > 0 ? `<span style="font-size:0.7rem;color:var(--text-muted,#64748b);">📎 ${docCount} doc${docCount !== 1 ? 's' : ''}</span>` : ''}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted,#64748b);"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
  }).join('');
}

function _mgmtSmParseDocs(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch(e) { return {}; }
}

// ── Shipment Timeline (read-only) ────────────────────────────

let _mgmtSmTlData         = null;
let _mgmtSmTlCurrentStage = '';
let _mgmtSmTlOpenPhases   = new Set();

function _mgmtSmGetFilteredRows() {
  const active = document.querySelector('.sm-filter-btn.active');
  const filter = active ? active.textContent.trim() : 'All';
  return filter === 'All' ? _mgmtSmAll : _mgmtSmAll.filter(s => s.status === filter);
}

async function _mgmtSmOpenDetail(idx) {
  const s = _mgmtSmGetFilteredRows()[idx];
  if (!s) return;

  _mgmtSmTlData         = null;
  _mgmtSmTlCurrentStage = '';
  _mgmtSmTlOpenPhases   = new Set();

  const statusColor = { Pending: '#f59e0b', 'In Transit': '#3b82f6', Arrived: '#22c55e', Delivered: '#8b5cf6', Cancelled: '#ef4444' };
  const color = statusColor[s.status] || '#64748b';
  const badgeHtml = `<span style="font-size:0.72rem;font-weight:600;padding:0.1rem 0.5rem;border-radius:10px;background:${color}22;color:${color};border:1px solid ${color}44;">${esc(s.status)}</span>`;

  document.getElementById('mgmtSmTlHeader').textContent    = s.shipmentId || s.poNo || '—';
  document.getElementById('mgmtSmTlSubtitle').textContent  = `PO ${s.poNo || '—'} · ${s.client || '—'}`;
  document.getElementById('mgmtSmTlStatusBadge').innerHTML = badgeHtml;
  document.getElementById('mgmtSmTlContent').innerHTML     = '<div style="padding:3rem;text-align:center;"><div class="spinner"></div></div>';
  document.getElementById('mgmtSmTlRibbon').innerHTML      = '<div style="height:52px;"></div>';

  const overlay = document.getElementById('mgmtSmOverlay');
  overlay.style.display = 'block';

  try {
    const r = await fetchFromAPI({ action: 'getShipmentTimeline', shipmentId: s.shipmentId });
    if (r && r.success) {
      _mgmtSmTlData = r;
      // Auto-expand the phase with the first pending stage
      const apiMap = {};
      r.timeline.forEach(st => { apiMap[st.key] = st; });
      let activated = false;
      for (let pi = 0; pi < _SM_PHASES.length; pi++) {
        if (_SM_PHASES[pi].stages.some(k => !['done','skipped'].includes((apiMap[k] || {}).status))) {
          _mgmtSmTlOpenPhases.add(pi); activated = true; break;
        }
      }
      if (!activated) _mgmtSmTlOpenPhases.add(_SM_PHASES.length - 1);
      _mgmtSmTlRender();
    } else {
      document.getElementById('mgmtSmTlContent').innerHTML =
        `<div style="padding:2rem;text-align:center;color:#ef4444;">${esc((r && r.message) || 'Failed to load timeline.')}</div>`;
    }
  } catch (err) {
    document.getElementById('mgmtSmTlContent').innerHTML =
      `<div style="padding:2rem;text-align:center;color:#ef4444;">Error: ${esc(err.message)}</div>`;
  }
}

function closeMgmtSm() {
  document.getElementById('mgmtSmOverlay').style.display = 'none';
  _mgmtSmTlData = null; _mgmtSmTlCurrentStage = ''; _mgmtSmTlOpenPhases = new Set();
}

// ── Render ───────────────────────────────────────────────────

function _mgmtSmTlRender() {
  if (!_mgmtSmTlData || !_mgmtSmTlData.timeline) return;

  const apiMap = {};
  _mgmtSmTlData.timeline.forEach(st => { apiMap[st.key] = st; });

  let nextKey = null;
  for (const def of _SM_LIFECYCLE_STAGES) {
    if (!['done','skipped'].includes((apiMap[def.key] || {}).status)) { nextKey = def.key; break; }
  }

  document.getElementById('mgmtSmTlRibbon').innerHTML = _mgmtSmTlRenderRibbon(apiMap);

  let html = _mgmtSmTlRenderNextUp(apiMap, nextKey);

  _SM_PHASES.forEach((phase, pi) => {
    const phaseDefs    = _SM_LIFECYCLE_STAGES.filter(def => phase.stages.includes(def.key));
    const phaseDone    = phaseDefs.filter(def => (apiMap[def.key] || {}).status === 'done').length;
    const phaseSkipped = phaseDefs.filter(def => (apiMap[def.key] || {}).status === 'skipped').length;
    const phaseTotal   = phaseDefs.length;
    const allComplete  = (phaseDone + phaseSkipped) === phaseTotal;
    const anyDone      = (phaseDone + phaseSkipped) > 0;
    const isOpen       = _mgmtSmTlOpenPhases.has(pi);

    const hdrState = allComplete ? 'done' : isOpen ? 'open' : anyDone ? 'partial' : 'pending';
    const cntColor = allComplete ? '#22c55e' : anyDone ? '#f59e0b' : 'var(--text-muted,#64748b)';
    const lblColor = allComplete ? 'var(--text-primary,#f1f5f9)' : 'var(--text-secondary,#94a3b8)';
    const numBg    = allComplete ? 'rgba(34,197,94,0.15)' : '#e2e8f0';
    const numBorder= allComplete ? 'rgba(34,197,94,0.5)' : '#e2e8f0';

    html += `<div class="sm-tl-phase-wrap" id="mgmtSmPhase${pi}">
      <div class="sm-tl-phase-hdr ${hdrState}" onclick="_mgmtSmTlTogglePhase(${pi})"
           role="button" tabindex="0" aria-expanded="${isOpen}"
           aria-label="Phase ${pi+1}: ${esc(phase.name)}, ${phaseDone}/${phaseTotal} complete"
           onkeydown="if(event.key==='Enter'||event.key===' ')_mgmtSmTlTogglePhase(${pi})">
        <div class="sm-tl-phase-left">
          <div class="sm-tl-phase-num" style="background:${numBg};color:${cntColor};border:1px solid ${numBorder};">
            ${allComplete ? '✓' : _SM_PHASE_ICONS[pi]}
          </div>
          <span class="sm-tl-phase-name" style="color:${lblColor};">Phase ${pi + 1}: ${esc(phase.name)}</span>
        </div>
        <div class="sm-tl-phase-right">
          <span class="sm-tl-phase-cnt" style="color:${cntColor};">${phaseDone}/${phaseTotal}</span>
          <span class="sm-tl-phase-chevron">${isOpen ? '▾' : '▸'}</span>
        </div>
      </div>`;

    if (isOpen) {
      const bodyState = allComplete ? 'done' : anyDone ? 'partial' : '';
      html += `<div class="sm-tl-phase-body ${bodyState}">`;
      phaseDefs.forEach(def => {
        html += _mgmtSmTlRenderStageRow(def, apiMap[def.key] || { status: 'pending', docs: [] }, nextKey, apiMap);
      });
      html += '</div>';
    }
    html += '</div>';
  });

  document.getElementById('mgmtSmTlContent').innerHTML = html;
}

function _mgmtSmTlTogglePhase(pi) {
  if (_mgmtSmTlOpenPhases.has(pi)) _mgmtSmTlOpenPhases.delete(pi); else _mgmtSmTlOpenPhases.add(pi);
  _mgmtSmTlRender();
}

function _mgmtSmTlToggleStage(key) {
  _mgmtSmTlCurrentStage = (_mgmtSmTlCurrentStage === key) ? '' : key;
  _mgmtSmTlRender();
}

function _mgmtSmTlScrollToPhase(pi) {
  _mgmtSmTlOpenPhases.add(pi);
  _mgmtSmTlRender();
  const el = document.getElementById('mgmtSmPhase' + pi);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _mgmtSmTlScrollToStage(key) {
  const pi = _SM_PHASES.findIndex(p => p.stages.includes(key));
  if (pi >= 0) _mgmtSmTlOpenPhases.add(pi);
  _mgmtSmTlCurrentStage = key;
  _mgmtSmTlRender();
  const el = document.getElementById('mgmtSmCard_' + key);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Phase Ribbon ─────────────────────────────────────────────

function _mgmtSmTlRenderRibbon(apiMap) {
  const total     = _SM_LIFECYCLE_STAGES.length;
  const totalDone = _SM_LIFECYCLE_STAGES.filter(d => ['done','skipped'].includes((apiMap[d.key]||{}).status)).length;

  let html = '<div class="sm-tl-ribbon" role="tablist">';
  _SM_PHASES.forEach((phase, pi) => {
    const defs    = _SM_LIFECYCLE_STAGES.filter(d => phase.stages.includes(d.key));
    const done    = defs.filter(d => ['done','skipped'].includes((apiMap[d.key]||{}).status)).length;
    const allDone = done === defs.length;
    const partial = done > 0 && !allDone;
    const pct     = Math.round(done / defs.length * 100);
    const cls     = allDone ? 'done' : partial ? 'partial' : '';
    html += `<button class="sm-tl-ribbon-seg ${cls}" onclick="_mgmtSmTlScrollToPhase(${pi})"
      role="tab" tabindex="0"
      aria-label="Phase ${pi+1}: ${esc(phase.name)}, ${done} of ${defs.length} complete"
      title="Phase ${pi+1}: ${esc(phase.name)} — ${done}/${defs.length}">
      <div class="sm-tl-ribbon-fill" style="width:${pct}%"></div>
      <span class="sm-tl-ribbon-icon">${_SM_PHASE_ICONS[pi]}</span>
      <span class="sm-tl-ribbon-label">${esc(phase.name)}</span>
      <span class="sm-tl-ribbon-count">${done}/${defs.length}</span>
    </button>`;
  });
  html += '</div>';
  html += `<div class="sm-tl-ribbon-overall">${totalDone} / ${total} stages complete</div>`;
  return html;
}

// ── Next-Up Callout Card ──────────────────────────────────────

function _mgmtSmTlRenderNextUp(apiMap, nextKey) {
  if (!nextKey) {
    return `<div class="sm-tl-next-up done">
      <div class="sm-tl-next-up-icon">🎉</div>
      <div class="sm-tl-next-up-body">
        <div class="sm-tl-next-up-kicker">All complete</div>
        <div class="sm-tl-next-up-stage"><strong>All 21 stages done!</strong></div>
        <div class="sm-tl-next-up-sub">This shipment has completed all lifecycle stages.</div>
      </div>
    </div>`;
  }

  const def      = _SM_LIFECYCLE_STAGES.find(d => d.key === nextKey);
  if (!def) return '';

  const meta     = (_SM_STAGE_META && _SM_STAGE_META[nextKey]) || {};
  const requires = meta.requires || [];
  const blocked  = requires.some(rk => !['done','skipped'].includes((apiMap[rk]||{}).status));
  const phaseIdx = _SM_PHASES.findIndex(p => p.stages.includes(nextKey));
  const phaseLabel = phaseIdx >= 0 ? `Phase ${phaseIdx+1}: ${_SM_PHASES[phaseIdx].name}` : '';
  const ownerCls = _SM_OWNER_BADGE_CLASS[def.owner] || 'sm-owner-admin';

  const icon   = blocked ? '⚠️' : '➡️';
  const cls    = blocked ? 'blocked' : '';
  const kicker = blocked ? 'Waiting on prerequisites' : 'Next up';

  return `<div class="sm-tl-next-up ${cls}" role="status">
    <div class="sm-tl-next-up-icon">${icon}</div>
    <div class="sm-tl-next-up-body">
      <div class="sm-tl-next-up-kicker">${kicker}</div>
      <div class="sm-tl-next-up-stage">
        <strong>${esc(def.label)}</strong>
        <span class="sm-owner-badge ${ownerCls}">${esc(def.owner)}</span>
        ${def.autoDerive ? '<span class="auto-badge">AUTO</span>' : ''}
      </div>
      <div class="sm-tl-next-up-sub">${phaseLabel}${blocked ? ' — prerequisites not yet met (advisory)' : ''}</div>
    </div>
  </div>`;
}

// ── Stage Card Row ────────────────────────────────────────────

function _mgmtSmTlRenderStageRow(def, apiStage, nextKey, apiMap) {
  const status    = apiStage.status || 'pending';
  const isAuto    = apiStage.autoderived || false;
  const docs      = apiStage.docs || [];
  const isOpen    = _mgmtSmTlCurrentStage === def.key;
  const globalIdx = _SM_LIFECYCLE_STAGES.indexOf(def);

  const meta     = (_SM_STAGE_META && _SM_STAGE_META[def.key]) || {};
  const requires = meta.requires || [];
  const isBlocked = status === 'pending' && requires.some(rk => !['done','skipped'].includes((apiMap[rk]||{}).status));
  const isNext    = def.key === nextKey;

  let cardState, dotState;
  if (status === 'done')         { cardState = 'done';    dotState = 'done';    }
  else if (status === 'skipped') { cardState = 'skipped'; dotState = 'skipped'; }
  else if (isBlocked)            { cardState = 'blocked'; dotState = 'blocked'; }
  else if (isNext)               { cardState = 'next';    dotState = 'next';    }
  else                           { cardState = 'pending'; dotState = 'pending'; }

  const dotContent = status === 'done' ? '✓' : status === 'skipped' ? '–' : isBlocked ? '!' : (globalIdx + 1);
  const dateNote   = status !== 'pending' && apiStage.completedAt
    ? `${esc(apiStage.completedAt)}${apiStage.completedBy ? ' · ' + esc(apiStage.completedBy) : ''}` : '';
  const skipReason = status === 'skipped' && apiStage.skippedReason ? apiStage.skippedReason : '';
  const ownerCls   = _SM_OWNER_BADGE_CLASS[def.owner] || 'sm-owner-admin';

  return `<div class="sm-tl-card ${cardState}${isOpen ? ' open' : ''}" id="mgmtSmCard_${def.key}">
    <div class="sm-tl-card-hdr" onclick="_mgmtSmTlToggleStage('${def.key}')"
         role="button" tabindex="0" aria-expanded="${isOpen}"
         aria-label="${esc(def.label)}, ${status}"
         onkeydown="if(event.key==='Enter'||event.key===' ')_mgmtSmTlToggleStage('${def.key}')">
      <div class="sm-tl-card-dot ${dotState}">${dotContent}</div>
      <div class="sm-tl-card-main">
        <div class="sm-tl-card-label">${esc(def.label)}</div>
        <div class="sm-tl-card-meta">
          <span class="sm-owner-badge ${ownerCls}">${esc(def.owner)}</span>
          ${isAuto ? '<span class="auto-badge">AUTO</span>' : ''}
          ${skipReason ? `<span style="color:#f59e0b;font-style:italic;font-size:0.64rem;">– ${esc(skipReason)}</span>` : ''}
        </div>
        ${dateNote ? `<div class="sm-tl-card-date">${dateNote}</div>` : ''}
      </div>
      <div class="sm-tl-card-right">
        ${docs.length > 0 ? `<span class="doc-badge">${docs.length}</span>` : ''}
        ${isBlocked ? '<span class="blocked-icon" title="Prerequisites not yet met (advisory)">⚠</span>' : ''}
        <span style="font-size:0.7rem;color:var(--text-muted,#64748b);">${isOpen ? '▾' : '▸'}</span>
      </div>
    </div>
    ${isOpen ? `<div class="sm-tl-detail">${_mgmtSmTlStageDetail(def, apiStage, apiMap)}</div>` : ''}
  </div>`;
}

// ── Stage Detail Panel (read-only) ────────────────────────────

function _mgmtSmTlStageDetail(def, apiStage, apiMap) {
  const status = apiStage.status || 'pending';
  const docs   = apiStage.docs   || [];
  const isAuto = apiStage.autoderived || false;
  const meta   = (_SM_STAGE_META && _SM_STAGE_META[def.key]) || {};
  const ship   = (_mgmtSmTlData && _mgmtSmTlData.shipment) || {};
  let html = '';

  // ── A: Description ───────────────────────────────────
  if (meta.description) {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">About this stage</div>
      <div style="font-size:0.76rem;color:var(--text-secondary,#94a3b8);line-height:1.5;">${esc(meta.description)}</div>
      ${isAuto && apiStage.autoderivedNote
        ? `<div style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem;">
            <span class="auto-badge">AUTO</span>
            <span style="font-size:0.7rem;color:var(--text-muted,#64748b);">${esc(apiStage.autoderivedNote)}</span>
           </div>` : ''}
    </div>`;
  }

  if (status === 'skipped' && apiStage.skippedReason) {
    html += `<div class="sm-tl-detail-section">
      <div style="font-size:0.76rem;color:#f59e0b;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25);border-radius:5px;padding:0.4rem 0.6rem;">
        <strong>Skip reason:</strong> ${esc(apiStage.skippedReason)}
      </div>
    </div>`;
  }

  // ── B: Fields ────────────────────────────────────────
  if (meta.fields && meta.fields.length > 0) {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">Fields at this stage</div>
      <table class="sm-tl-fields">`;
    meta.fields.forEach(f => {
      let val = ship[f.field];
      if (val === undefined || val === null || val === '') {
        val = ship[f.field.replace(/([A-Z])/g, '_$1').toLowerCase()];
      }
      const hasVal = val !== undefined && val !== null && String(val).trim() !== '';
      let displayVal = hasVal ? esc(String(val)) : '';
      if (hasVal && f.format === 'currency' && !isNaN(parseFloat(val))) {
        displayVal = '₱ ' + parseFloat(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      html += `<tr>
        <td class="fl">${esc(f.label)}</td>
        <td class="${hasVal ? 'fv' : 'fv empty'}">${hasVal ? displayVal : '— not yet set —'}</td>
      </tr>`;
    });
    html += '</table></div>';
  }

  // ── C: Dependencies ──────────────────────────────────
  const requires = meta.requires || [];
  const unlocks  = meta.unlocks  || [];
  if (requires.length > 0 || unlocks.length > 0) {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">Stage dependencies <span style="font-size:0.6rem;font-weight:400;font-style:italic;text-transform:none;letter-spacing:0;">(advisory)</span></div>
      <div class="sm-dep-chips">`;
    requires.forEach(rk => {
      const rDef = _SM_LIFECYCLE_STAGES.find(d => d.key === rk);
      if (!rDef) return;
      const rSt = (apiMap[rk] || {}).status || 'pending';
      const cls  = rSt === 'done' ? 'done' : rSt === 'skipped' ? 'skipped' : 'blocked';
      const icon = rSt === 'done' ? '✓' : rSt === 'skipped' ? '–' : '○';
      html += `<span class="sm-dep-chip ${cls}" onclick="_mgmtSmTlScrollToStage('${rk}')"
               title="Required: ${esc(rDef.label)}" tabindex="0" role="button"
               onkeydown="if(event.key==='Enter')_mgmtSmTlScrollToStage('${rk}')">${icon} ${esc(rDef.label)}</span>`;
    });
    if (unlocks.length > 0) {
      if (requires.length > 0) html += `<span style="font-size:0.65rem;color:var(--text-muted,#64748b);align-self:center;">→ unlocks:</span>`;
      unlocks.forEach(uk => {
        const uDef = _SM_LIFECYCLE_STAGES.find(d => d.key === uk);
        if (!uDef) return;
        const uSt = (apiMap[uk] || {}).status || 'pending';
        const cls = uSt === 'done' ? 'done' : uSt === 'skipped' ? 'skipped' : '';
        html += `<span class="sm-dep-chip ${cls}" onclick="_mgmtSmTlScrollToStage('${uk}')"
                 title="Unlocks: ${esc(uDef.label)}" tabindex="0" role="button"
                 onkeydown="if(event.key==='Enter')_mgmtSmTlScrollToStage('${uk}')">↓ ${esc(uDef.label)}</span>`;
      });
    }
    html += '</div></div>';
  }

  // ── D: Documents (inline thumbnail level 1 + expand to iframe level 2) ──
  html += `<div class="sm-tl-detail-section">
    <div class="sm-tl-section-label">Documents${def.docLabel ? ` <span style="font-size:0.6rem;font-weight:400;font-style:italic;text-transform:none;letter-spacing:0;">· Expected: ${esc(def.docLabel)}</span>` : ''}</div>`;
  if (docs.length) {
    html += '<div>';
    docs.forEach(f => {
      const viewUrl    = f.url || f.driveUrl || '';
      const thumbUrl   = f.thumbnailUrl || f.previewUrl || '';
      const thumbImg   = thumbUrl
        ? `<img src="${esc(thumbUrl)}" class="sm-mgmt-doc-thumb" onclick="openDocViewer('${esc(f.name)}','${esc(viewUrl)}')" alt="Preview" title="Click to expand">`
        : `<div class="sm-mgmt-doc-thumb" onclick="openDocViewer('${esc(f.name)}','${esc(viewUrl)}')" style="display:flex;align-items:center;justify-content:center;cursor:pointer;" title="Click to view">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
           </div>`;
      html += `<div class="sm-mgmt-doc-file">
        ${thumbImg}
        <span class="sm-mgmt-doc-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <button class="sm-mgmt-doc-btn" onclick="openDocViewer('${esc(f.name)}','${esc(viewUrl)}')">View ↗</button>
      </div>`;
    });
    html += '</div>';
  } else {
    html += `<div style="font-size:0.73rem;color:var(--text-muted,#64748b);">No documents attached${def.docLabel ? '' : '.'}.</div>`;
  }
  html += '</div>';

  // ── E: Activity ──────────────────────────────────────
  if (status !== 'pending') {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">Activity</div>
      <div style="font-size:0.73rem;color:var(--text-secondary,#94a3b8);line-height:1.55;">`;
    if (apiStage.completedAt || apiStage.completedBy) {
      const verb = status === 'skipped' ? 'Skipped' : 'Completed';
      html += `<div>• ${verb}${apiStage.completedAt ? ' on <strong>' + esc(apiStage.completedAt) + '</strong>' : ''}${apiStage.completedBy ? ' by <strong>' + esc(apiStage.completedBy) + '</strong>' : ''}</div>`;
    }
    if (apiStage.notes) {
      html += `<div style="margin-top:0.25rem;padding:0.35rem 0.5rem;background:#f8fafc;border-radius:4px;border:1px solid #e2e8f0;">${esc(apiStage.notes)}</div>`;
    }
    html += '</div></div>';
  }

  return html;
}

// ════════════════════════════════════════════════════════════
// AUDIT LOG — MANAGEMENT DASHBOARD
// ════════════════════════════════════════════════════════════

let _mgmtAuditPage              = 1;
let _mgmtAuditTotal             = 0;
let _mgmtAuditHasMore           = false;
let _mgmtAuditFilterValuesLoaded = false;
const _MGMT_AUDIT_PAGE_SIZE      = 100;

async function loadMgmtAuditLog(reset, page) {
  if (reset) {
    _mgmtAuditPage = 1;
    if (!_mgmtAuditFilterValuesLoaded) _mgmtAuditLoadFilterValues();
  }
  if (page != null) _mgmtAuditPage = page;
  const tbody   = document.getElementById('auditLogBody');
  const pagerEl = document.getElementById('auditLogPager');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted,#64748b);padding:1.5rem;">Loading…</td></tr>`;
  if (pagerEl) pagerEl.style.display = 'none';
  const df  = document.getElementById('auditDateFrom');
  const dt  = document.getElementById('auditDateTo');
  const cl  = document.getElementById('auditClient');
  const et  = document.getElementById('auditEventType');
  const ac  = document.getElementById('auditActor');
  const sid = document.getElementById('auditShipmentId');
  if (!df || !df.value) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted,#64748b);padding:1.5rem;">Please set a start date (From) to search.</td></tr>`;
    return;
  }
  try {
    const params = {
      action:   'getGlobalAuditLog',
      dateFrom: df.value,
      page:     _mgmtAuditPage,
      pageSize: _MGMT_AUDIT_PAGE_SIZE,
    };
    if (dt  && dt.value)  params.dateTo     = dt.value;
    if (cl  && cl.value)  params.client     = cl.value;
    if (et  && et.value)  params.eventTypes = et.value;
    if (ac  && ac.value)  params.actor      = ac.value.trim();
    if (sid && sid.value) params.shipmentId = sid.value.trim();
    const r = await fetchFromAPI(params);
    if (!r || !r.success) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:1.5rem;">${esc(r && r.message ? r.message : 'Failed to load audit log.')}</td></tr>`;
      return;
    }
    _mgmtAuditTotal   = r.totalCount || 0;
    _mgmtAuditHasMore = r.hasMore    || false;
    const events       = r.events    || [];
    if (!events.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted,#64748b);padding:1.5rem;">No events found for the selected filters.</td></tr>`;
      return;
    }
    tbody.innerHTML = events.map(_mgmtAuditLogRenderRow).join('');
    if (pagerEl) {
      const totalPages = Math.ceil(_mgmtAuditTotal / _MGMT_AUDIT_PAGE_SIZE);
      if (totalPages > 1) {
        pagerEl.style.display = 'flex';
        const prevBtn = document.getElementById('auditPrevBtn');
        const nextBtn = document.getElementById('auditNextBtn');
        const infoEl  = document.getElementById('auditPageInfo');
        if (prevBtn) prevBtn.disabled = (_mgmtAuditPage <= 1);
        if (nextBtn) nextBtn.disabled = !_mgmtAuditHasMore;
        if (infoEl)  infoEl.textContent = `Page ${_mgmtAuditPage} of ${totalPages} (${_mgmtAuditTotal.toLocaleString()} events)`;
      }
    }
    // Update section summary
    if (typeof setSectionSummary === 'function') {
      setSectionSummary('section-audit-log', `${_mgmtAuditTotal.toLocaleString()} event${_mgmtAuditTotal === 1 ? '' : 's'} found`);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:1.5rem;">Error: ${esc(err.message)}</td></tr>`;
  }
}

function _mgmtAuditLogRenderRow(ev) {
  const cat      = ev.event_category || 'system';
  const catLabel = { field:'Field', stage:'Stage', document:'Document', lifecycle:'Lifecycle', system:'System' }[cat] || cat;
  const ts       = ev.event_timestamp ? ev.event_timestamp.replace('T',' ').slice(0,16) : '—';
  const actor    = ev.actor_name || ev.actor_email || '—';
  const what     = _mgmtAuditEventDesc(ev);
  return `<tr>
    <td class="at-ts">${esc(ts)}</td>
    <td class="at-ref">${esc(ev.shipment_id || '—')}</td>
    <td class="at-client">${esc(ev.client_name || '—')}</td>
    <td><span class="at-actor">${esc(actor)}</span></td>
    <td><span class="at-evt ${esc(cat)}">${esc(catLabel)}: ${esc(ev.event_type || '')}</span></td>
    <td class="at-what">${what}</td>
  </tr>`;
}

function _mgmtAuditEventDesc(ev) {
  const who = esc(ev.actor_name || ev.actor_email || 'Someone');
  const sNum = ev.stage_number ? ` (stage ${ev.stage_number})` : '';
  switch (ev.event_type) {
    case 'SHIPMENT_CREATED':   return `<strong>${who}</strong> created shipment`;
    case 'SHIPMENT_CLOSED':    return `<strong>${who}</strong> closed shipment`;
    case 'FIELD_CHANGE': {
      const label = esc((ev.field_name || 'field').replace(/_/g,' '));
      if (!ev.old_value && ev.new_value)
        return `<strong>${who}</strong> set ${label} → <em>${esc(ev.new_value)}</em>`;
      if (ev.old_value && !ev.new_value)
        return `<strong>${who}</strong> cleared ${label}`;
      return `<strong>${who}</strong> changed ${label}: <span style="text-decoration:line-through;opacity:0.6;">${esc(ev.old_value)}</span> → <strong>${esc(ev.new_value)}</strong>`;
    }
    case 'STAGE_DONE':    return `<strong>${who}</strong> marked stage${sNum} done`;
    case 'STAGE_SKIPPED': return `<strong>${who}</strong> skipped stage${sNum}${ev.context_note ? `: "${esc(ev.context_note)}"` : ''}`;
    case 'STAGE_RESET':   return `<strong>${who}</strong> reset stage${sNum} to pending`;
    case 'DOC_UPLOAD':    return `<strong>${who}</strong> uploaded <em>${esc(ev.new_value || 'file')}</em> to stage${sNum}`;
    case 'DOC_DELETE':    return `<strong>${who}</strong> removed <em>${esc(ev.old_value || 'file')}</em> from stage${sNum}`;
    case 'DOC_RESTORE':   return `<strong>${who}</strong> restored <em>${esc(ev.new_value || 'file')}</em> to stage${sNum}`;
    case 'AUTO_DERIVATION': return `System auto-derived stage${sNum}`;
    case 'CORRECTION':    return `<strong>${who}</strong> corrected field in sheet`;
    default:              return esc(ev.event_type || '—');
  }
}

async function _mgmtAuditLoadFilterValues() {
  _mgmtAuditFilterValuesLoaded = true;
  try {
    const r = await fetchFromAPI({ action: 'getAuditLogFilterValues' });
    if (!r || !r.success) return;
    const clientSel = document.getElementById('auditClient');
    const actorSel  = document.getElementById('auditActor');
    if (clientSel && Array.isArray(r.clients)) {
      const cur = clientSel.value;
      while (clientSel.options.length > 1) clientSel.remove(1);
      r.clients.forEach(function(c) {
        const o = document.createElement('option');
        o.value = c; o.textContent = c;
        clientSel.appendChild(o);
      });
      if (cur) clientSel.value = cur;
    }
    if (actorSel && Array.isArray(r.actors)) {
      const cur = actorSel.value;
      while (actorSel.options.length > 1) actorSel.remove(1);
      r.actors.forEach(function(a) {
        const o = document.createElement('option');
        o.value = a; o.textContent = a;
        actorSel.appendChild(o);
      });
      if (cur) actorSel.value = cur;
    }
  } catch (_) { /* non-critical */ }
}

function _mgmtAuditClearFilters() {
  const ids = ['auditDateFrom','auditDateTo','auditShipmentId'];
  ids.forEach(function(id) { const el = document.getElementById(id); if (el) el.value = ''; });
  const sels = ['auditClient','auditEventType','auditActor'];
  sels.forEach(function(id) { const el = document.getElementById(id); if (el) el.value = ''; });
  _mgmtAuditDateRangeDefault();
}

function _mgmtAuditDateRangeDefault() {
  const df = document.getElementById('auditDateFrom');
  if (!df) return;
  const d = new Date();
  d.setDate(d.getDate() - 30);
  // Manila-local date (toISOString is UTC → off-by-one before 8 AM PH)
  df.value = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

async function mgmtAuditLogExportCsv() {
  const df  = document.getElementById('auditDateFrom');
  const dt  = document.getElementById('auditDateTo');
  const cl  = document.getElementById('auditClient');
  const et  = document.getElementById('auditEventType');
  const ac  = document.getElementById('auditActor');
  const sid = document.getElementById('auditShipmentId');
  if (!df || !df.value) { alert('Please set a start date before exporting.'); return; }
  try {
    const body = { action: 'exportAuditLogCsv', dateFrom: df.value };
    if (dt  && dt.value)  body.dateTo     = dt.value;
    if (cl  && cl.value)  body.client     = cl.value;
    if (et  && et.value)  body.eventTypes = et.value;
    if (ac  && ac.value)  body.actor      = ac.value.trim();
    if (sid && sid.value) body.shipmentId = sid.value.trim();
    const r = await fetchFromAPI(body);
    if (!r || !r.success || !r.csv) { alert(r && r.message ? r.message : 'Export failed.'); return; }
    const blob = new Blob([r.csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0,10);
    a.href = url; a.download = `audit-log-${date}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch (err) { alert('Export error: ' + err.message); }
}

/* ── AR Outstanding mini modal — uses local Collections data ── */
function openUnpaidInvoicesModal() {
  var existing = document.getElementById('unpaidInvoicesOverlay');
  if (existing) existing.remove();

  var colData = (_storedCollectionsResult && _storedCollectionsResult.status === 'fulfilled' &&
                 _storedCollectionsResult.value && _storedCollectionsResult.value.success)
    ? (_storedCollectionsResult.value.data || []) : null;

  var overlay = document.createElement('div');
  overlay.id = 'unpaidInvoicesOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem;';

  var bodyHtml;
  if (colData === null) {
    bodyHtml = '<div style="color:#dc2626;padding:1rem;">Collections data not available.</div>';
  } else {
    var unpaid = colData.filter(function(r) {
      var due  = parseFloat(r.totalAmountDue) || 0;
      var rcvd = parseFloat(r.amountReceived) || 0;
      // Drop rows that round to zero outstanding (e.g. tiny float remainders
      // or entries with totalAmountDue == amountReceived).
      return (due - rcvd) > 0.005;
    });
    if (unpaid.length === 0) {
      bodyHtml = '<div style="padding:1.5rem;text-align:center;color:var(--text-muted,#94a3b8);">No unpaid invoices. All caught up.</div>';
    } else {
      var totalOut = 0;
      var rowsHtml = unpaid.map(function(r) {
        var due  = parseFloat(r.totalAmountDue) || 0;
        var rcvd = parseFloat(r.amountReceived) || 0;
        var out  = due - rcvd;
        totalOut += out;
        return '<tr>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-primary,#0f172a);">' + esc(r.invoiceNumber || r.orderNumber || '—') + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-primary,#0f172a);">' + esc(r.customer || r.customerName || '—') + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-secondary,#475569);white-space:nowrap;">' + esc(r.invoiceDate || r.date || '—') + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--border,#cbd5e1);text-align:right;color:var(--text-primary,#0f172a);">' + peso(due) + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--border,#cbd5e1);text-align:right;color:#16a34a;">' + peso(rcvd) + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--border,#cbd5e1);text-align:right;color:#dc2626;font-weight:600;">' + peso(out) + '</td>' +
          '</tr>';
      }).join('');

      bodyHtml =
        '<div style="margin-bottom:0.85rem;font-size:0.85rem;color:var(--text-secondary,#475569);">' +
          unpaid.length + ' unpaid invoice' + (unpaid.length !== 1 ? 's' : '') +
          ' &middot; total outstanding: <strong style="color:#dc2626;">' + peso(totalOut) + '</strong>' +
        '</div>' +
        '<div style="border:1px solid var(--border,#cbd5e1);border-radius:8px;overflow:hidden;background:var(--bg-card,#ffffff);">' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">' +
          '<thead><tr style="background:var(--bg-primary,#eef2f6);">' +
            '<th style="text-align:left;padding:0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-secondary,#475569);font-weight:600;">Invoice #</th>' +
            '<th style="text-align:left;padding:0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-secondary,#475569);font-weight:600;">Customer</th>' +
            '<th style="text-align:left;padding:0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-secondary,#475569);font-weight:600;">Date</th>' +
            '<th style="text-align:right;padding:0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-secondary,#475569);font-weight:600;">Invoiced</th>' +
            '<th style="text-align:right;padding:0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-secondary,#475569);font-weight:600;">Received</th>' +
            '<th style="text-align:right;padding:0.6rem;border-bottom:1px solid var(--border,#cbd5e1);color:var(--text-secondary,#475569);font-weight:600;">Outstanding</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
        '</div>';
    }
  }

  overlay.innerHTML =
    '<div style="background:var(--bg-card,#ffffff);border:1px solid var(--border,#cbd5e1);border-radius:12px;max-width:900px;width:100%;max-height:85vh;overflow:auto;padding:1.5rem;color:var(--text-primary,#0f172a);box-shadow:0 12px 32px rgba(15,23,42,0.18);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid var(--border,#cbd5e1);">' +
        '<h3 style="margin:0;font-size:1.05rem;color:var(--text-primary,#0f172a);">AR Outstanding — Unpaid Invoices</h3>' +
        '<button id="unpaidInvClose" style="background:none;border:none;color:var(--text-muted,#94a3b8);font-size:1.5rem;cursor:pointer;line-height:1;">&times;</button>' +
      '</div>' +
      '<div>' + bodyHtml + '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('unpaidInvClose').addEventListener('click', function() { overlay.remove(); });
}

/* ── Financial drill-down modal ── */
async function openFinancialModal(metric) {
  // AR Outstanding uses the already-fetched Collections data — instant,
  // no extra API call, guaranteed to match the tile's unpaid count.
  if (metric === 'ar') { openUnpaidInvoicesModal(); return; }

  var existing = document.getElementById('financialDrilldownOverlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'financialDrilldownOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem;';
  overlay.innerHTML = '<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;max-width:900px;width:100%;max-height:85vh;overflow:auto;padding:1.5rem;color:#f1f5f9;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">' +
      '<h3 id="finDrillTitle" style="margin:0;font-size:1.1rem;">Loading…</h3>' +
      '<button id="finDrillClose" style="background:none;border:none;color:#94a3b8;font-size:1.5rem;cursor:pointer;">&times;</button>' +
    '</div>' +
    '<div id="finDrillBody" style="font-size:0.85rem;"><div style="text-align:center;padding:2rem;color:#94a3b8;">Loading records…</div></div>' +
  '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('finDrillClose').addEventListener('click', function() { overlay.remove(); });

  var titles = {
    revenue: 'Total Revenue — Invoices',
    cogs: 'Total COGS — Cost Entries',
    grossprofit: 'Gross Profit Breakdown',
    expenses: 'Total Expenses',
    netprofit: 'Net Profit Breakdown',
    ar: 'AR Outstanding — Unpaid Invoices',
    payables: 'Payables — Unpaid Supplier Bills'
  };
  document.getElementById('finDrillTitle').textContent = titles[metric] || metric;

  try {
    var res = await apiGetFinancialBreakdown(metric, 'all');
    var body = document.getElementById('finDrillBody');
    if (!res || !res.success) {
      body.innerHTML = '<div style="color:#ef4444;">Error: ' + esc((res && res.message) || 'Failed to load') + '</div>';
      return;
    }
    body.innerHTML = _renderFinDrill(metric, res.data || {});
  } catch (err) {
    document.getElementById('finDrillBody').innerHTML = '<div style="color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function _renderFinDrill(metric, data) {
  function tbl(headers, rows, totalLabel, totalValue) {
    if (!rows || rows.length === 0) {
      return '<div style="padding:1rem;text-align:center;color:#94a3b8;">No records.</div>';
    }
    var h = '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr>';
    headers.forEach(function(c) { h += '<th style="text-align:left;padding:0.5rem;border-bottom:1px solid #334155;color:#94a3b8;font-weight:600;">' + esc(c) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function(r) {
      h += '<tr>';
      r.forEach(function(c) { h += '<td style="padding:0.45rem 0.5rem;border-bottom:1px solid #1e293b;">' + (c == null ? '' : esc(String(c))) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody>';
    if (totalLabel) {
      h += '<tfoot><tr><td colspan="' + (headers.length - 1) + '" style="padding:0.6rem 0.5rem;text-align:right;font-weight:700;border-top:2px solid #334155;">' + esc(totalLabel) + '</td><td style="padding:0.6rem 0.5rem;font-weight:700;border-top:2px solid #334155;">' + esc(totalValue) + '</td></tr></tfoot>';
    }
    h += '</table>';
    return h;
  }

  if (metric === 'revenue') {
    var rows = (data.rows || []).map(function(r) { return [r.orderNumber, r.date, r.customer, peso(r.amount)]; });
    return tbl(['Order #', 'Date', 'Customer', 'Amount'], rows, 'Total Revenue:', peso(data.total || 0));
  }
  if (metric === 'cogs') {
    var rows2 = (data.rows || []).map(function(r) { return [r.poNumber || r.orderNumber, r.date, r.supplier || r.customer, peso(r.amount)]; });
    return tbl(['PO #', 'Date', 'Supplier', 'Amount'], rows2, 'Total COGS:', peso(data.total || 0));
  }
  if (metric === 'expenses') {
    var rows3 = (data.rows || []).map(function(r) { return [r.date, r.category, r.vendor, peso(r.amount)]; });
    return tbl(['Date', 'Category', 'Vendor', 'Amount'], rows3, 'Total Expenses:', peso(data.total || 0));
  }
  if (metric === 'ar') {
    var rows4 = (data.rows || []).map(function(r) { return [r.invoiceNumber || r.orderNumber, r.customer, peso(r.invoiceAmount || r.amount), peso(r.amountReceived || 0), peso(r.outstanding || ((r.invoiceAmount||0) - (r.amountReceived||0)))]; });
    return tbl(['Invoice', 'Customer', 'Invoiced', 'Received', 'Outstanding'], rows4, 'Total Outstanding:', peso(data.total || 0));
  }
  if (metric === 'payables') {
    var rows5 = (data.rows || []).map(function(r) { return [r.reference || r.id, r.date, r.supplier, peso(r.amount)]; });
    return tbl(['Reference', 'Date', 'Supplier', 'Amount'], rows5, 'Total Payables:', peso(data.total || 0));
  }
  if (metric === 'grossprofit' || metric === 'netprofit') {
    var html = '';
    html += '<div style="margin-bottom:1rem;"><h4 style="margin:0 0 0.5rem 0;font-size:0.9rem;color:#94a3b8;">Revenue</h4>' +
      tbl(['Order #', 'Date', 'Customer', 'Amount'], (data.revenue && data.revenue.rows || []).map(function(r) { return [r.orderNumber, r.date, r.customer, peso(r.amount)]; }), 'Subtotal:', peso((data.revenue && data.revenue.total) || 0)) + '</div>';
    html += '<div style="margin-bottom:1rem;"><h4 style="margin:0 0 0.5rem 0;font-size:0.9rem;color:#94a3b8;">COGS</h4>' +
      tbl(['PO #', 'Date', 'Supplier', 'Amount'], (data.cogs && data.cogs.rows || []).map(function(r) { return [r.poNumber || r.orderNumber, r.date, r.supplier || r.customer, peso(r.amount)]; }), 'Subtotal:', peso((data.cogs && data.cogs.total) || 0)) + '</div>';
    if (metric === 'netprofit') {
      html += '<div style="margin-bottom:1rem;"><h4 style="margin:0 0 0.5rem 0;font-size:0.9rem;color:#94a3b8;">Expenses</h4>' +
        tbl(['Date', 'Category', 'Vendor', 'Amount'], (data.expenses && data.expenses.rows || []).map(function(r) { return [r.date, r.category, r.vendor, peso(r.amount)]; }), 'Subtotal:', peso((data.expenses && data.expenses.total) || 0)) + '</div>';
    }
    html += '<div style="padding:0.75rem;background:#0f172a;border-radius:8px;font-weight:700;">' + (metric === 'grossprofit' ? 'Gross Profit' : 'Net Profit') + ': ' + peso(data.total || 0) + '</div>';
    return html;
  }
  return '<pre style="color:#94a3b8;">' + esc(JSON.stringify(data, null, 2)) + '</pre>';
}

// ═══════════════════════════════════════════════
// Payroll Approvals
// ═══════════════════════════════════════════════

var _payrollApprovalsCache = [];
var _currentPayrollApproval = null;

async function renderPayrollApprovals(status, btn) {
  if (btn) {
    document.querySelectorAll('.payappr-tab').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
  }
  var container = document.getElementById('payrollApprovalsContainer');
  if (!container) return;
  container.innerHTML = '<div class="payappr-empty">Loading...</div>';
  try {
    var params = status ? { status: status } : {};
    var res = await apiGetPayrollApprovals(params);
    var rows = (res && res.success && Array.isArray(res.data)) ? res.data : [];
    _payrollApprovalsCache = rows;
    _renderPayrollApprovalsTable(rows);
    _updatePayrollApprovalsSummary();
  } catch (err) {
    container.innerHTML = '<div class="payappr-empty">Error: ' + esc(err.message) + '</div>';
  }
}

function _renderPayrollApprovalsTable(rows) {
  var container = document.getElementById('payrollApprovalsContainer');
  if (!rows.length) {
    container.innerHTML = '<div class="payappr-empty">No payroll submissions in this view.</div>';
    return;
  }
  var peso = function(v) { return '₱' + (Number(v)||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var html = '<table class="payappr-table"><thead><tr>' +
    '<th>Period</th><th>Cutoff</th><th>Submitted By</th><th>Submitted At</th>' +
    '<th>Employees</th><th>Gross Pay</th><th>Net Pay</th><th>Status</th><th>Decided</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function(r) {
    var totals = r.totals || {};
    var statusCls = 'pending';
    if (/approved/i.test(r.status)) statusCls = 'approved';
    else if (/rejected/i.test(r.status)) statusCls = 'rejected';
    var decided = r.decidedAt ? (esc(r.decidedAt) + (r.approvedBy ? '<br><span style="color:var(--text-muted,#94a3b8);font-size:0.7rem;">by ' + esc(r.approvedBy) + '</span>' : '')) : '—';
    html += '<tr class="payappr-row" onclick="openPayrollApprovalModal(' + r.rowIndex + ')">' +
      '<td><strong>' + esc(r.period) + '</strong></td>' +
      '<td>' + esc(r.cutoffLabel || '') + '</td>' +
      '<td>' + esc(r.submittedBy) + '</td>' +
      '<td>' + esc(r.submittedAt) + '</td>' +
      '<td>' + esc(totals.employeeCount || 0) + '</td>' +
      '<td>' + peso(totals.grossPay) + '</td>' +
      '<td>' + peso(totals.netPay) + '</td>' +
      '<td><span class="payappr-status ' + statusCls + '">' + esc(r.status) + '</span></td>' +
      '<td>' + decided + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function _updatePayrollApprovalsSummary() {
  var summary = document.getElementById('summary-payroll-approvals');
  if (!summary) return;
  var pending = _payrollApprovalsCache.filter(function(r){ return r.status === 'For Approval'; }).length;
  summary.textContent = pending + ' awaiting approval';
}

async function openPayrollApprovalModal(rowIndex) {
  var overlay = document.getElementById('payapprModal');
  var iframe = document.getElementById('payapprIframe');
  var titleEl = document.getElementById('payapprModalTitle');
  var metaEl = document.getElementById('payapprModalMeta');
  var approveBtn = document.getElementById('payapprApproveBtn');
  var rejectBtn = document.getElementById('payapprRejectBtn');
  titleEl.textContent = 'Loading...';
  metaEl.textContent = '';
  iframe.srcdoc = '<div style="padding:2rem;font-family:sans-serif;color:#666;">Loading snapshot...</div>';
  overlay.classList.add('open');
  try {
    var res = await apiGetPayrollApprovalSnapshot(rowIndex);
    if (!res || !res.success) {
      iframe.srcdoc = '<div style="padding:2rem;color:#c00;font-family:sans-serif;">Failed to load snapshot: ' + esc((res && res.message) || 'unknown') + '</div>';
      return;
    }
    var d = res.data;
    _currentPayrollApproval = d;
    titleEl.textContent = (d.cutoffLabel || 'Payroll Cutoff') + ' — ' + d.period;
    metaEl.textContent = 'Submitted by ' + d.submittedBy + ' on ' + d.submittedAt + ' · Status: ' + d.status;
    iframe.srcdoc = d.snapshotHtml || '<div style="padding:2rem;color:#999;">No snapshot stored.</div>';
    var canDecide = d.status === 'For Approval';
    approveBtn.disabled = !canDecide;
    rejectBtn.disabled = !canDecide;
  } catch (err) {
    iframe.srcdoc = '<div style="padding:2rem;color:#c00;font-family:sans-serif;">Error: ' + esc(err.message) + '</div>';
  }
}

function closePayrollApprovalModal() {
  document.getElementById('payapprModal').classList.remove('open');
  document.getElementById('payapprIframe').srcdoc = '';
  _currentPayrollApproval = null;
}

function printPayrollApprovalSnapshot() {
  var iframe = document.getElementById('payapprIframe');
  try {
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }
  } catch (e) { alert('Print failed: ' + e.message); }
}

async function decidePayrollApproval(decision) {
  if (!_currentPayrollApproval) return;
  var rec = _currentPayrollApproval;
  if (rec.status !== 'For Approval') { alert('This submission has already been decided.'); return; }
  var notes = '';
  if (decision === 'Rejected') {
    notes = prompt('Reason for rejection (optional):', '') || '';
  } else if (!confirm('Approve ' + (rec.cutoffLabel || '') + ' ' + rec.period + '?')) {
    return;
  }
  var session = (typeof getSession === 'function') ? getSession() : null;
  var approvedBy = (session && (session.name || session.username)) || 'Management';
  var approveBtn = document.getElementById('payapprApproveBtn');
  var rejectBtn = document.getElementById('payapprRejectBtn');
  approveBtn.disabled = true; rejectBtn.disabled = true;

  var pdfBase64 = '';
  if (decision === 'Approved' && rec.snapshotHtml && typeof html2pdf !== 'undefined') {
    try {
      approveBtn.textContent = 'Rendering PDF...';
      pdfBase64 = await _renderPayrollSnapshotPdfBase64(rec.snapshotHtml);
    } catch (e) {
      console.warn('PDF render failed, falling back to server-side conversion:', e);
      pdfBase64 = '';
    }
    approveBtn.textContent = 'Approve';
  }

  try {
    var res = await apiDecidePayrollApproval(rec.rowIndex, decision, approvedBy, notes, pdfBase64);
    if (res && res.success) {
      // On approval, auto-log the cutoff to the flow Expenses (Operating · Salaries and wages).
      if (decision === 'Approved') { _logPayrollExpense(rec, approvedBy); }
      alert(decision + ' recorded.');
      closePayrollApprovalModal();
      var activeTab = document.querySelector('.payappr-tab.active');
      var statusFilter = '';
      if (activeTab) {
        var id = activeTab.id;
        statusFilter = id === 'payapprTabPending' ? 'For Approval'
                     : id === 'payapprTabApproved' ? 'Approved'
                     : id === 'payapprTabRejected' ? 'Rejected' : '';
      }
      renderPayrollApprovals(statusFilter);
    } else {
      approveBtn.disabled = false; rejectBtn.disabled = false;
      alert('Failed: ' + ((res && res.message) || 'unknown'));
    }
  } catch (err) {
    approveBtn.disabled = false; rejectBtn.disabled = false;
    alert('Error: ' + err.message);
  }
}

// Pick a representative expense date for a cutoff: 1st cutoff → mid-month, 2nd cutoff → month end.
function _payrollExpenseDate(period, cutoff) {
  var m = String(period || '').match(/(\d{4})-(\d{2})/);
  if (!m) return new Date().toISOString().slice(0, 10);
  var y = +m[1], mo = +m[2];
  if (cutoff === 'B') { var last = new Date(y, mo, 0).getDate(); return m[1] + '-' + m[2] + '-' + String(last).padStart(2, '0'); }
  return m[1] + '-' + m[2] + '-15';
}

// Auto-log an approved payroll cutoff into the flow Expenses as an Operating "Salaries and wages"
// expense. Amount = gross pay + employer share. Idempotent (importExpenses dedupes on the voucher-
// inclusive signature, so re-runs/retries never duplicate). Best-effort — never blocks the approval.
async function _logPayrollExpense(rec, approvedBy) {
  try {
    if (typeof postFlow !== 'function') return;
    var listRow = (_payrollApprovalsCache || []).filter(function (x) { return x.rowIndex === rec.rowIndex; })[0];
    var t = rec.totals || (listRow && listRow.totals) || {};
    var amount = (Number(t.grossPay) || 0) + (Number(t.employerShare) || 0);
    if (amount <= 0) return;
    var cutoff = /2nd|B$|-B/i.test(String(rec.cutoffLabel || rec.period || '')) ? 'B' : 'A';
    var rec2 = {
      date: _payrollExpenseDate(rec.period, cutoff),
      voucherNo: 'PAYROLL-' + rec.period,
      category: 'Salaries and wages', type: 'Operating',
      client: 'HI-ESCORP', createdBy: approvedBy || 'Management',
      description: 'Payroll ' + (rec.cutoffLabel || '') + ' — ' + rec.period + ' (' + (t.employeeCount || 0) + ' employees)',
      amount: amount
    };
    var r = await postFlow('importExpenses', { items: JSON.stringify([rec2]) });
    if (r && r.success) {
      var msg = (r.created ? 'Logged ' : 'Already logged ') + '₱' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
        ' to Expenses (Operating · Salaries and wages).';
      if (typeof showToast === 'function') showToast(msg); else console.log(msg);
    }
  } catch (e) {
    console.warn('Payroll expense logging failed (approval still recorded):', e);
  }
}

// Render the payroll snapshot PDF from the approval modal's existing iframe.
// The iframe already has the snapshot loaded via srcdoc (same-origin), so
// html2canvas can paint it without popup/CORS issues.
async function _renderPayrollSnapshotPdfBase64(snapshotHtml) {
  var HTML2PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

  // Prefer the already-loaded iframe — it's same-origin (srcdoc) and already painted.
  var iframe = document.getElementById('payapprIframe');
  var iframeWin = iframe && (iframe.contentWindow || (iframe.contentDocument && iframe.contentDocument.defaultView));
  var iframeDoc = iframeWin && iframeWin.document;

  // If the iframe body has real content use it; otherwise fall through to a fresh iframe.
  var useExisting = iframeDoc && iframeDoc.body && iframeDoc.body.children.length > 0;

  return new Promise(function (resolve, reject) {
    var done = false;
    var tempFrame = null;

    function runHtml2pdf(targetWin, targetDoc) {
      // Inject html2pdf into the target window so html2canvas is in the same context.
      if (targetWin.html2pdf) {
        render(targetWin, targetDoc);
        return;
      }
      var script = targetDoc.createElement('script');
      script.src = HTML2PDF_CDN;
      script.onload  = function () { render(targetWin, targetDoc); };
      script.onerror = function () { finish(null, 'Failed to load html2pdf library.'); };
      targetDoc.head.appendChild(script);
    }

    function render(targetWin, targetDoc) {
      targetWin.requestAnimationFrame(function () {
        targetWin.requestAnimationFrame(function () {
          var opt = {
            margin:      [8, 6, 8, 6],
            filename:    'payroll.pdf',
            image:       { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff',
                           windowWidth: 1400, logging: false },
            jsPDF:       { unit: 'mm', format: 'a4', orientation: 'landscape' },
            pagebreak:   { mode: ['css', 'legacy'] }
          };
          targetWin.html2pdf().set(opt).from(targetDoc.body).outputPdf('datauristring')
            .then(function (dataUri) {
              var idx = dataUri.indexOf('base64,');
              finish(idx >= 0 ? dataUri.substring(idx + 7) : '');
            })
            .catch(function (err) { finish(null, err.message); });
        });
      });
    }

    function finish(base64, err) {
      if (done) return;
      done = true;
      if (tempFrame) { try { document.body.removeChild(tempFrame); } catch (e) {} }
      if (err) { reject(new Error(err)); } else { resolve(base64 || ''); }
    }

    if (useExisting) {
      // Resize the hidden iframe to 1400 px wide so html2canvas gets the full layout.
      var prevWidth = iframe.style.width;
      iframe.style.width = '1400px';
      runHtml2pdf(iframeWin, iframeDoc);
      // Restore width after render resolves (finish is async, so wrap)
      var origFinish = finish;
      finish = function (b, e) { iframe.style.width = prevWidth; origFinish(b, e); };
      return;
    }

    // Fallback: create a hidden same-document iframe and load the snapshot into it.
    tempFrame = document.createElement('iframe');
    tempFrame.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:900px;' +
                              'z-index:999999;border:none;visibility:hidden;';
    document.body.appendChild(tempFrame);

    tempFrame.onload = function () {
      var fw = tempFrame.contentWindow;
      var fd = tempFrame.contentDocument || fw.document;
      if (!fd || !fd.body) { finish(null, 'iframe did not load'); return; }
      // Make visible just for html2canvas render pass, then hide again.
      tempFrame.style.visibility = 'visible';
      runHtml2pdf(fw, fd);
      var origF = finish;
      finish = function (b, e) { tempFrame.style.visibility = 'hidden'; origF(b, e); };
    };

    tempFrame.srcdoc = snapshotHtml;

    setTimeout(function () { finish(null, 'PDF render timed out.'); }, 60000);
  });
}

// ─── Agent day activity modal (quotations / PRs drill-in) ──
async function openAgentDayActivity(agentName, focus) {
  var dateVal = document.getElementById('drReportDate').value;
  showAgentActivityModal(agentName, dateVal, focus, null);
  try {
    var res = await apiGetAgentDayActivity(agentName, dateVal);
    if (!res || !res.success) throw new Error(res && res.message || 'Failed to load activity');
    showAgentActivityModal(agentName, dateVal, focus, res);
  } catch (err) {
    showAgentActivityModal(agentName, dateVal, focus, { error: err.message });
  }
}

function showAgentActivityModal(agentName, dateVal, focus, data) {
  var existing = document.getElementById('agentActivityModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'agentActivityModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

  var body = '';
  if (!data) {
    body = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">Loading…</div>';
  } else if (data.error) {
    body = '<div style="padding:1rem;color:#ef4444;">Error: ' + esc(data.error) + '</div>';
  } else {
    body = renderAgentActivityBody(data, focus);
  }

  modal.innerHTML =
    '<div style="background:var(--bg-card,#fff);border-radius:10px;width:min(960px,96vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:0.85rem 1rem;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border,#e2e8f0);">' +
        '<strong>' + esc(agentName) + ' — ' + esc(dateVal) + '</strong>' +
        '<button onclick="document.getElementById(\'agentActivityModal\').remove()" style="background:transparent;border:1px solid var(--border,#cbd5e1);border-radius:6px;padding:4px 12px;cursor:pointer;">Close</button>' +
      '</div>' +
      '<div style="padding:1rem;overflow:auto;">' + body + '</div>' +
    '</div>';
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function renderAgentActivityBody(data, focus) {
  var quotations = data.quotations || [];
  var prs = data.prs || [];
  var initial = focus === 'prs' ? 'prs' : 'quotations';
  function tabBtn(key, label, count) {
    var active = key === initial;
    return '<button class="act-tab" data-tab="' + key + '" onclick="switchAgentActivityTab(\'' + key + '\')" style="padding:0.4rem 0.85rem;border:1px solid var(--border,#cbd5e1);border-radius:6px;background:' + (active ? '#3b82f6' : 'transparent') + ';color:' + (active ? '#fff' : 'inherit') + ';cursor:pointer;font-size:0.85rem;font-weight:600;">' + label + ' <span style="opacity:0.75;">(' + count + ')</span></button>';
  }

  return '<div style="display:flex;gap:0.5rem;margin-bottom:0.85rem;">' +
      tabBtn('quotations', 'Quotations', quotations.length) +
      tabBtn('prs', 'PRs', prs.length) +
    '</div>' +
    '<div id="actPaneQuotations" style="display:' + (initial === 'quotations' ? 'block' : 'none') + ';">' +
      renderMgmtQuotationsList(quotations) +
    '</div>' +
    '<div id="actPanePrs" style="display:' + (initial === 'prs' ? 'block' : 'none') + ';">' +
      renderMgmtPRsList(prs) +
    '</div>';
}

function renderMgmtQuotationsList(rows) {
  if (!rows.length) return '<div style="padding:1.5rem;text-align:center;color:var(--text-muted);">No quotations created on this date.</div>';
  var body = rows.map(function(q) {
    var pdf = q.driveLink
      ? '<a href="' + esc(q.driveLink) + '" target="_blank" style="color:#3b82f6;text-decoration:none;font-size:0.78rem;">View PDF</a>'
      : '<span style="color:var(--text-muted);font-size:0.78rem;">—</span>';
    var amount = (q.amount === '' || q.amount == null) ? '—' : Number(q.amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '<tr>' +
      '<td>' + esc(q.refNo) + '</td>' +
      '<td><strong>' + esc(q.clientName) + '</strong></td>' +
      '<td>' + esc(q.subject) + '</td>' +
      '<td style="text-align:right;">' + amount + '</td>' +
      '<td>' + esc(q.adminApproval) + '</td>' +
      '<td>' + esc(q.managementApproval) + '</td>' +
      '<td>' + esc(q.overallStatus) + '</td>' +
      '<td>' + pdf + '</td>' +
    '</tr>';
  }).join('');
  return '<table class="mini-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
    '<thead><tr style="background:#f1f5f9;"><th>Ref No</th><th>Client</th><th>Subject</th><th style="text-align:right;">Amount</th><th>Admin</th><th>Mgmt</th><th>Overall</th><th>PDF</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table>';
}

function renderMgmtPRsList(rows) {
  if (!rows.length) return '<div style="padding:1.5rem;text-align:center;color:var(--text-muted);">No PRs sent on this date.</div>';
  var body = rows.map(function(p) {
    var unit = (p.unitPrice === '' || p.unitPrice == null) ? '—' : Number(p.unitPrice).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var total = (p.totalPrice === '' || p.totalPrice == null) ? '—' : Number(p.totalPrice).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '<tr>' +
      '<td>' + esc(p.prNumber) + '</td>' +
      '<td><strong>' + esc(p.clientName) + '</strong></td>' +
      '<td>' + esc(p.itemDescription) + '</td>' +
      '<td>' + esc(p.modelPartNo) + '</td>' +
      '<td style="text-align:center;">' + esc(String(p.quantity)) + '</td>' +
      '<td>' + esc(p.status) + '</td>' +
      '<td style="text-align:right;">' + unit + '</td>' +
      '<td style="text-align:right;">' + total + '</td>' +
    '</tr>';
  }).join('');
  return '<table class="mini-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
    '<thead><tr style="background:#f1f5f9;"><th>PR #</th><th>Client</th><th>Item</th><th>Model/Part#</th><th>Qty</th><th>Status</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Total</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table>';
}

function switchAgentActivityTab(key) {
  document.getElementById('actPaneQuotations').style.display = key === 'quotations' ? 'block' : 'none';
  document.getElementById('actPanePrs').style.display = key === 'prs' ? 'block' : 'none';
  document.querySelectorAll('#agentActivityModal .act-tab').forEach(function(btn) {
    var active = btn.getAttribute('data-tab') === key;
    btn.style.background = active ? '#3b82f6' : 'transparent';
    btn.style.color = active ? '#fff' : 'inherit';
  });
}

