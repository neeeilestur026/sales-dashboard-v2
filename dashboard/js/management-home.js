/* ═══════════════════════════════════════════════
   management-home.js — Management Dashboard logic
   READ-ONLY executive overview — no mutations
   ═══════════════════════════════════════════════ */
// A293 — Chart.js paints on a canvas, so it needs real colours, not var() strings.
function _hx(name, fallback) { return hxToken(name, fallback || ''); }

let plChartInstance = null;

var _financialAllTime = false;
var _storedCollectionsResult = null;
var _storedExpensesResult = null;
var _storedProfitReportsResult = null;
var _storedSoDataResult = null;
var _incomeStatementEntries = [];

function esc(s) { return hxEscBlank(s); }

function peso(n) { return '₱' + (parseFloat(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

// FX rates → PHP (updated 2026-05-04, source: Google Finance)
const PR_FX_TO_PHP = {
  PHP: 1, USD: 61.47, EUR: 72.11, GBP: 83.54, JPY: 0.3921, SGD: 48.29, AUD: 44.30, CAD: 45.24,
  HKD: 7.85, CNY: 9.00, KRW: 0.0419, INR: 0.6478, MYR: 15.54, THB: 1.8953,
  IDR: 0.0035, VND: 0.0023, TWD: 1.9456, BND: 48.19
};
function kpiCard(label, value, sub, subClass, metric) {
  var clickAttrs = metric ? ' style="cursor:pointer;" onclick="openFinancialModal(\'' + metric + '\')" title="Click to view records"' : '';
  return '<div class="kpi-card"' + clickAttrs + '><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + value + '</div>' +
    (sub ? '<div class="kpi-sub ' + (subClass||'') + '">' + esc(sub) + '</div>' : '') + '</div>';
}

function makeTargetCell(actual, target, color) {
  if (!target) return '<div class="target-cell"><span class="target-text">' + actual + '</span></div>';
  var pct = Math.min(100, Math.round((actual / target) * 100));
  return '<div class="target-cell"><span class="target-text">' + actual + '</span>' +
    '<div class="target-bar"><div class="target-bar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
    '<span style="font-size:0.7rem;color:var(--hx-ink-3);">' + pct + '%</span></div>';
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

  // A154: the 12 superseded legacy sections were deleted from management-home.html (their topics are
  // covered by the flow sections above them and by dedicated flow pages). Only the sections with NO
  // flow replacement still load here: HR Insights, HR-Marketing Summary, Payroll Approvals, Shipment
  // Monitoring. That drops this boot from 27 API calls to 14.
  // NOTE: the old `drReportDate` / `financialMonthFilter` initialisers were UNGUARDED getElementById
  // calls into markup this change removes — leaving them would have thrown here and killed the whole
  // boot (including HR/Payroll/Shipments). They are gone with their sections.
  const [hrSummaryResult, shipmentsResult, hrRecruitmentResult, hrEmployeesResult, hrLeaveResult, hrReviewsResult, hrTrainingResult, hrTasksResult, hrMemosResult, hrGrievancesResult, hrCampaignsResult, hrContentResult, hrAccredResult, hrBirthdayResult] = await Promise.allSettled([
    apiGetHRSummary(),
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
  renderMgmtShipments(shipmentsResult);
  renderPayrollApprovals('For Approval');
});

var _mgmtOverdueRecords = [];

// ═══════════════════════════════════════════════
// Section 3b: MRO Records (Materials Received)
// ═══════════════════════════════════════════════

var MRO_DRIVE_FOLDER = 'https://drive.google.com/drive/folders/1tnN3-m9NXxB6_EoGGhdZCeLBtThR4c0i?usp=sharing';

// ═══════════════════════════════════════════════
// Section 3b: MI Records (Materials Issued)
// ═══════════════════════════════════════════════

var MI_DRIVE_FOLDER = 'https://drive.google.com/drive/folders/11iyASbSLAfn6DKpte9j_J3QlllWN7nOs?usp=drive_link';

// ═══════════════════════════════════════════════
// Section 4b: Sales Orders
// ═══════════════════════════════════════════════

var _allSalesOrders = [];

// ═══════════════════════════════════════════════
// Section 7: Team Daily Reports
// ═══════════════════════════════════════════════

var drLastData = [];
var drAdminData = [];
var drAcctData = [];
var drHRData = [];
var drActiveTab = 'sales';
var DR_TRUNCATE_LEN = 120;

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

// ═══════════════════════════════════════════════
// Shipment Monitoring (read-only view for management)
// ═══════════════════════════════════════════════

let _mgmtSmAll = [];

function renderMgmtShipments(result) {
  const container = document.getElementById('mgmtSmContainer');
  if (result.status === 'rejected' || !result.value || !result.value.success) {
    container.innerHTML = '<div style="padding:1rem;color:var(--hx-red);">Could not load shipments.</div>';
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

function _mgmtSmBadge(status) { return hxSmBadge(status); }
function mgmtSmFilter(status, btn) {
  document.querySelectorAll('.sm-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _mgmtSmRender(status);
}

function _mgmtSmRender(filter) {
  const container = document.getElementById('mgmtSmContainer');
  const rows = filter === 'All' ? _mgmtSmAll : _mgmtSmAll.filter(s => s.status === filter);

  if (!rows.length) {
    container.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--hx-ink-3);">No shipments found.</div>';
    return;
  }

  container.innerHTML = rows.map((s, idx) => {
    const docsObj = _mgmtSmParseDocs(s.documents);
    const docCount = Object.values(docsObj).reduce((n, arr) => n + arr.length, 0);
    return `<div class="sm-row" onclick="_mgmtSmOpenDetail(${idx})">
      <div class="sm-row-left">
        <div class="sm-row-po">
          ${esc(s.poNo || '—')}
          ${_mgmtSmBadge(s.status)}
        </div>
        <div class="sm-row-sub">${esc(s.principal || '')}${s.item ? ' · ' + s.item : ''}${s.eta ? ' · ETA: ' + s.eta : ''}</div>
      </div>
      <div class="sm-row-right">
        ${docCount > 0 ? `<span style="font-size:0.7rem;color:var(--hx-ink-3);">${docCount} doc${docCount !== 1 ? 's' : ''}</span>` : ''}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--hx-ink-3);"><polyline points="9 18 15 12 9 6"/></svg>
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

  const badgeHtml = _mgmtSmBadge(s.status);

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
        `<div style="padding:2rem;text-align:center;color:var(--hx-red);">${esc((r && r.message) || 'Failed to load timeline.')}</div>`;
    }
  } catch (err) {
    document.getElementById('mgmtSmTlContent').innerHTML =
      `<div style="padding:2rem;text-align:center;color:var(--hx-red);">Error: ${esc(err.message)}</div>`;
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
    const cntColor = allComplete ? 'var(--hx-ok)' : anyDone ? 'var(--hx-warn)' : 'var(--hx-ink-3)';
    const lblColor = allComplete ? 'var(--hx-ink)' : 'var(--hx-ink-2)';
    const numBg    = allComplete ? 'var(--hx-ok-soft)' : 'var(--hx-inset)';
    const numBorder= allComplete ? 'var(--hx-ok-line)' : 'var(--hx-hair)';

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
      <div class="sm-tl-next-up-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="sm-tl-next-up-body">
        <div class="sm-tl-next-up-kicker">All complete</div>
        <div class="sm-tl-next-up-stage"><strong>All ${_SM_LIFECYCLE_STAGES.length} stages done!</strong></div>
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

  const icon   = blocked ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
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
          ${skipReason ? `<span style="color:var(--hx-warn);font-style:italic;font-size:0.64rem;">– ${esc(skipReason)}</span>` : ''}
        </div>
        ${dateNote ? `<div class="sm-tl-card-date">${dateNote}</div>` : ''}
      </div>
      <div class="sm-tl-card-right">
        ${docs.length > 0 ? `<span class="doc-badge">${docs.length}</span>` : ''}
        ${isBlocked ? '<span class="blocked-icon" title="Prerequisites not yet met (advisory)">⚠</span>' : ''}
        <span style="font-size:0.7rem;color:var(--hx-ink-3);">${isOpen ? '▾' : '▸'}</span>
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
      <div style="font-size:0.76rem;color:var(--hx-ink-2);line-height:1.5;">${esc(meta.description)}</div>
      ${isAuto && apiStage.autoderivedNote
        ? `<div style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem;">
            <span class="auto-badge">AUTO</span>
            <span style="font-size:0.7rem;color:var(--hx-ink-3);">${esc(apiStage.autoderivedNote)}</span>
           </div>` : ''}
    </div>`;
  }

  if (status === 'skipped' && apiStage.skippedReason) {
    html += `<div class="sm-tl-detail-section">
      <div style="font-size:0.76rem;color:var(--hx-warn);background:var(--hx-warn-soft);border:1px solid var(--hx-warn-line);border-radius:5px;padding:0.4rem 0.6rem;">
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
      if (requires.length > 0) html += `<span style="font-size:0.65rem;color:var(--hx-ink-3);align-self:center;">→ unlocks:</span>`;
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
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
           </div>`;
      html += `<div class="sm-mgmt-doc-file">
        ${thumbImg}
        <span class="sm-mgmt-doc-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <button class="sm-mgmt-doc-btn" onclick="openDocViewer('${esc(f.name)}','${esc(viewUrl)}')">View ↗</button>
      </div>`;
    });
    html += '</div>';
  } else {
    html += `<div style="font-size:0.73rem;color:var(--hx-ink-3);">No documents attached${def.docLabel ? '' : '.'}.</div>`;
  }
  html += '</div>';

  // ── E: Activity ──────────────────────────────────────
  if (status !== 'pending') {
    html += `<div class="sm-tl-detail-section">
      <div class="sm-tl-section-label">Activity</div>
      <div style="font-size:0.73rem;color:var(--hx-ink-2);line-height:1.55;">`;
    if (apiStage.completedAt || apiStage.completedBy) {
      const verb = status === 'skipped' ? 'Skipped' : 'Completed';
      html += `<div>• ${verb}${apiStage.completedAt ? ' on <strong>' + esc(apiStage.completedAt) + '</strong>' : ''}${apiStage.completedBy ? ' by <strong>' + esc(apiStage.completedBy) + '</strong>' : ''}</div>`;
    }
    if (apiStage.notes) {
      html += `<div style="margin-top:0.25rem;padding:0.35rem 0.5rem;background:var(--hx-inset);border-radius:4px;border:1px solid var(--hx-hair);">${esc(apiStage.notes)}</div>`;
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

/* ── AR Outstanding mini modal — uses local Collections data ── */
function openUnpaidInvoicesModal() {
  var existing = document.getElementById('unpaidInvoicesOverlay');
  if (existing) existing.remove();

  var colData = (_storedCollectionsResult && _storedCollectionsResult.status === 'fulfilled' &&
                 _storedCollectionsResult.value && _storedCollectionsResult.value.success)
    ? (_storedCollectionsResult.value.data || []) : null;

  var overlay = document.createElement('div');
  overlay.id = 'unpaidInvoicesOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--hx-scrim);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem;';

  var bodyHtml;
  if (colData === null) {
    bodyHtml = '<div style="color:var(--hx-red);padding:1rem;">Collections data not available.</div>';
  } else {
    var unpaid = colData.filter(function(r) {
      var due  = parseFloat(r.totalAmountDue) || 0;
      var rcvd = parseFloat(r.amountReceived) || 0;
      // Drop rows that round to zero outstanding (e.g. tiny float remainders
      // or entries with totalAmountDue == amountReceived).
      return (due - rcvd) > 0.005;
    });
    if (unpaid.length === 0) {
      bodyHtml = '<div style="padding:1.5rem;text-align:center;color:var(--hx-ink-3);">No unpaid invoices. All caught up.</div>';
    } else {
      var totalOut = 0;
      var rowsHtml = unpaid.map(function(r) {
        var due  = parseFloat(r.totalAmountDue) || 0;
        var rcvd = parseFloat(r.amountReceived) || 0;
        var out  = due - rcvd;
        totalOut += out;
        return '<tr>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink);">' + esc(r.invoiceNumber || r.orderNumber || '—') + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink);">' + esc(r.customer || r.customerName || '—') + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink-2);white-space:nowrap;">' + esc(r.invoiceDate || r.date || '—') + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--hx-hair);text-align:right;color:var(--hx-ink);">' + peso(due) + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--hx-hair);text-align:right;color:var(--hx-ok);">' + peso(rcvd) + '</td>' +
          '<td style="padding:0.55rem 0.6rem;border-bottom:1px solid var(--hx-hair);text-align:right;color:var(--hx-red);font-weight:600;">' + peso(out) + '</td>' +
          '</tr>';
      }).join('');

      bodyHtml =
        '<div style="margin-bottom:0.85rem;font-size:0.85rem;color:var(--hx-ink-2);">' +
          unpaid.length + ' unpaid invoice' + (unpaid.length !== 1 ? 's' : '') +
          ' &middot; total outstanding: <strong style="color:var(--hx-red);">' + peso(totalOut) + '</strong>' +
        '</div>' +
        '<div style="border:1px solid var(--hx-hair);border-radius:8px;overflow:hidden;background:var(--hx-card);">' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">' +
          '<thead><tr style="background:var(--hx-page);">' +
            '<th style="text-align:left;padding:0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink-2);font-weight:600;">Invoice #</th>' +
            '<th style="text-align:left;padding:0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink-2);font-weight:600;">Customer</th>' +
            '<th style="text-align:left;padding:0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink-2);font-weight:600;">Date</th>' +
            '<th style="text-align:right;padding:0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink-2);font-weight:600;">Invoiced</th>' +
            '<th style="text-align:right;padding:0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink-2);font-weight:600;">Received</th>' +
            '<th style="text-align:right;padding:0.6rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink-2);font-weight:600;">Outstanding</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
        '</div>';
    }
  }

  overlay.innerHTML =
    '<div style="background:var(--hx-card);border:1px solid var(--hx-hair);border-radius:12px;max-width:900px;width:100%;max-height:85vh;overflow:auto;padding:1.5rem;color:var(--hx-ink);box-shadow:var(--hx-sh-2);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid var(--hx-hair);">' +
        '<h3 style="margin:0;font-size:1.05rem;color:var(--hx-ink);">AR Outstanding — Unpaid Invoices</h3>' +
        '<button id="unpaidInvClose" style="background:none;border:none;color:var(--hx-ink-3);font-size:1.5rem;cursor:pointer;line-height:1;">&times;</button>' +
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
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--hx-scrim);z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem;';
  overlay.innerHTML = '<div style="background:var(--hx-slab);border:1px solid var(--hx-hair);border-radius:12px;max-width:900px;width:100%;max-height:85vh;overflow:auto;padding:1.5rem;color:var(--hx-inset);">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">' +
      '<h3 id="finDrillTitle" style="margin:0;font-size:1.1rem;">Loading…</h3>' +
      '<button id="finDrillClose" style="background:none;border:none;color:var(--hx-ink-3);font-size:1.5rem;cursor:pointer;">&times;</button>' +
    '</div>' +
    '<div id="finDrillBody" style="font-size:0.85rem;"><div style="text-align:center;padding:2rem;color:var(--hx-ink-3);">Loading records…</div></div>' +
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
      body.innerHTML = '<div style="color:var(--hx-red);">Error: ' + esc((res && res.message) || 'Failed to load') + '</div>';
      return;
    }
    body.innerHTML = _renderFinDrill(metric, res.data || {});
  } catch (err) {
    document.getElementById('finDrillBody').innerHTML = '<div style="color:var(--hx-red);">Error: ' + esc(err.message) + '</div>';
  }
}

function _renderFinDrill(metric, data) {
  function tbl(headers, rows, totalLabel, totalValue) {
    if (!rows || rows.length === 0) {
      return '<div style="padding:1rem;text-align:center;color:var(--hx-ink-3);">No records.</div>';
    }
    var h = '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr>';
    headers.forEach(function(c) { h += '<th style="text-align:left;padding:0.5rem;border-bottom:1px solid var(--hx-hair);color:var(--hx-ink-3);font-weight:600;">' + esc(c) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(function(r) {
      h += '<tr>';
      r.forEach(function(c) { h += '<td style="padding:0.45rem 0.5rem;border-bottom:1px solid var(--hx-hair);">' + (c == null ? '' : esc(String(c))) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody>';
    if (totalLabel) {
      h += '<tfoot><tr><td colspan="' + (headers.length - 1) + '" style="padding:0.6rem 0.5rem;text-align:right;font-weight:700;border-top:2px solid var(--hx-hair);">' + esc(totalLabel) + '</td><td style="padding:0.6rem 0.5rem;font-weight:700;border-top:2px solid var(--hx-hair);">' + esc(totalValue) + '</td></tr></tfoot>';
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
    html += '<div style="margin-bottom:1rem;"><h4 style="margin:0 0 0.5rem 0;font-size:0.9rem;color:var(--hx-ink-3);">Revenue</h4>' +
      tbl(['Order #', 'Date', 'Customer', 'Amount'], (data.revenue && data.revenue.rows || []).map(function(r) { return [r.orderNumber, r.date, r.customer, peso(r.amount)]; }), 'Subtotal:', peso((data.revenue && data.revenue.total) || 0)) + '</div>';
    html += '<div style="margin-bottom:1rem;"><h4 style="margin:0 0 0.5rem 0;font-size:0.9rem;color:var(--hx-ink-3);">COGS</h4>' +
      tbl(['PO #', 'Date', 'Supplier', 'Amount'], (data.cogs && data.cogs.rows || []).map(function(r) { return [r.poNumber || r.orderNumber, r.date, r.supplier || r.customer, peso(r.amount)]; }), 'Subtotal:', peso((data.cogs && data.cogs.total) || 0)) + '</div>';
    if (metric === 'netprofit') {
      html += '<div style="margin-bottom:1rem;"><h4 style="margin:0 0 0.5rem 0;font-size:0.9rem;color:var(--hx-ink-3);">Expenses</h4>' +
        tbl(['Date', 'Category', 'Vendor', 'Amount'], (data.expenses && data.expenses.rows || []).map(function(r) { return [r.date, r.category, r.vendor, peso(r.amount)]; }), 'Subtotal:', peso((data.expenses && data.expenses.total) || 0)) + '</div>';
    }
    html += '<div style="padding:0.75rem;background:var(--hx-slab);border-radius:8px;font-weight:700;">' + (metric === 'grossprofit' ? 'Gross Profit' : 'Net Profit') + ': ' + peso(data.total || 0) + '</div>';
    return html;
  }
  return '<pre style="color:var(--hx-ink-3);">' + esc(JSON.stringify(data, null, 2)) + '</pre>';
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
    var decided = r.decidedAt ? (esc(r.decidedAt) + (r.approvedBy ? '<br><span style="color:var(--hx-ink-3);font-size:0.7rem;">by ' + esc(r.approvedBy) + '</span>' : '')) : '—';
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
  if (decision === 'Approved' && rec.snapshotHtml) {   // A301: _renderPayrollSnapshotPdfBase64 loads html2pdf itself
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
    var res = await apiDecidePayrollApproval(rec.rowIndex, decision, approvedBy, notes, pdfBase64, rec.period);
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
    /* A229 — WARN LOUDLY IF THIS PERIOD IS ALREADY IN EXPENSES AT A DIFFERENT AMOUNT.
     *
     * importExpenses de-duplicates on a signature that INCLUDES the amount. So the normal
     * submit -> reject -> correct -> resubmit -> approve path creates a SECOND Expenses row under the
     * same PAYROLL-<period> voucher, because the corrected gross no longer matches the first
     * signature. That was already true; incentives make amount-changing resubmits routine rather
     * than rare, so it will now fire in ordinary use.
     *
     * The real fix (refuse, and require the first row to be reversed) has to change the shared
     * Expenses import and belongs in its own task. What must not happen is the double-post landing
     * silently and surfacing at month-end close — so this checks first and says so. */
    var priorWarning = '';
    try {
      var ex = await fetchFlow('getExpenses', {}, { fresh: true });
      var prior = (((ex && ex.data) || []).filter(function (x) {
        return String(x.voucherNo || '') === rec2.voucherNo;
      }));
      var clash = prior.filter(function (x) { return Math.abs((Number(x.amount) || 0) - amount) > 0.005; });
      if (clash.length) {
        priorWarning = 'WARNING: ' + rec2.voucherNo + ' is already in Expenses at ' +
          clash.map(function (x) { return '₱' + (Number(x.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }); }).join(', ') +
          ', and this approval is ₱' + amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) +
          '. Both rows will sit in the ledger — reverse the old one or payroll is counted twice for this cutoff.';
      }
    } catch (e) { /* the check is a courtesy; never block the posting on it */ }

    var r = await postFlow('importExpenses', { items: JSON.stringify([rec2]) });
    if (r && r.success) {
      var msg = (r.created ? 'Logged ' : 'Already logged ') + '₱' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
        ' to Expenses (Operating · Salaries and wages).';
      if (typeof showToast === 'function') showToast(msg); else console.log(msg);
      if (priorWarning) {
        console.warn(priorWarning);
        alert(priorWarning);          // deliberately blocking: a double-booked payroll must be seen
      }
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
  modal.style.cssText = 'position:fixed;inset:0;background:var(--hx-scrim);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

  var body = '';
  if (!data) {
    body = '<div style="padding:2rem;text-align:center;color:var(--hx-ink-3);">Loading…</div>';
  } else if (data.error) {
    body = '<div style="padding:1rem;color:var(--hx-red);">Error: ' + esc(data.error) + '</div>';
  } else {
    body = renderAgentActivityBody(data, focus);
  }

  modal.innerHTML =
    '<div style="background:var(--hx-card);border-radius:10px;width:min(960px,96vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:0.85rem 1rem;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--hx-hair);">' +
        '<strong>' + esc(agentName) + ' — ' + esc(dateVal) + '</strong>' +
        '<button onclick="document.getElementById(\'agentActivityModal\').remove()" style="background:transparent;border:1px solid var(--hx-hair);border-radius:6px;padding:4px 12px;cursor:pointer;">Close</button>' +
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
    return '<button class="act-tab" data-tab="' + key + '" onclick="switchAgentActivityTab(\'' + key + '\')" style="padding:0.4rem 0.85rem;border:1px solid var(--hx-hair);border-radius:6px;background:' + (active ? 'var(--hx-navy)' : 'transparent') + ';color:' + (active ? '#fff' : 'inherit') + ';cursor:pointer;font-size:0.85rem;font-weight:600;">' + label + ' <span style="opacity:0.75;">(' + count + ')</span></button>';
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
  if (!rows.length) return '<div style="padding:1.5rem;text-align:center;color:var(--hx-ink-3);">No quotations created on this date.</div>';
  var body = rows.map(function(q) {
    var pdf = q.driveLink
      ? '<a href="' + esc(q.driveLink) + '" target="_blank" style="color:var(--hx-cyan-ink);text-decoration:none;font-size:0.78rem;">View PDF</a>'
      : '<span style="color:var(--hx-ink-3);font-size:0.78rem;">—</span>';
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
    '<thead><tr style="background:var(--hx-inset);"><th>Ref No</th><th>Client</th><th>Subject</th><th style="text-align:right;">Amount</th><th>Admin</th><th>Mgmt</th><th>Overall</th><th>PDF</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table>';
}

function renderMgmtPRsList(rows) {
  if (!rows.length) return '<div style="padding:1.5rem;text-align:center;color:var(--hx-ink-3);">No PRs sent on this date.</div>';
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
    '<thead><tr style="background:var(--hx-inset);"><th>PR #</th><th>Client</th><th>Item</th><th>Model/Part#</th><th>Qty</th><th>Status</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Total</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table>';
}

function switchAgentActivityTab(key) {
  document.getElementById('actPaneQuotations').style.display = key === 'quotations' ? 'block' : 'none';
  document.getElementById('actPanePrs').style.display = key === 'prs' ? 'block' : 'none';
  document.querySelectorAll('#agentActivityModal .act-tab').forEach(function(btn) {
    var active = btn.getAttribute('data-tab') === key;
    btn.style.background = active ? 'var(--hx-navy)' : 'transparent';
    btn.style.color = active ? '#fff' : 'inherit';
  });
}

