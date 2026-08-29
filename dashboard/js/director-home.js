/* ═══════════════════════════════════════════════
   director-home.js — Dynamic Payroll Dashboard
   Tabs: EE | HOURS A | PAY A | HOURS B | PAY B
   ═══════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────
let _employees = [];   // master list from sheet
let _hoursA    = {};   // { "EmployeeName|YYYY-MM-DD": { employee, date, dayType, hours } }
let _hoursB    = {};
let _registerA = {};   // { "EmployeeName": { pagibig, sss, philhealth, advances, wtax } }
let _registerB = {};
/* A229 — incentives are per CUTOFF, never per employee-master, which is what stops a one-off bonus
   repeating next month. Two shapes per cutoff: the totals the grid and the pay maths read, and the
   line items behind them for the drill-down. */
let _incentivesA = {};     // { "EmployeeName": total of ACTIVE incentives }
let _incentivesB = {};
let _incentiveRowsA = {};  // { "EmployeeName": [ row, … ] }
let _incentiveRowsB = {};
/* A259 — THE COMPANY HOLIDAY CALENDAR, one entry per DATE. A holiday belongs to the day, not to a
   person, so one toggle marks it for everyone. Keying it by date is also what makes an UNWORKED
   regular holiday payable: the per-employee alternative would need a zero-hour Payroll Hours row per
   person per holiday, and both the client filter in saveHours and handleSavePayrollHours drop those.
     { "YYYY-MM-DD": "Regular Holiday" | "Special Non-Working" } */
let _holidaysA = {};
let _holidaysB = {};
/* The three rates, named once. HOL_REG and HOL_SPE are the DOLE premiums for a worked holiday;
   UNWORKED_REG is the day's basic pay an employee receives on a regular holiday they did not work.
   A special non-working day carries no such entitlement — no work, no pay — which is why there is no
   UNWORKED_SPE. */
const _RATE_OT          = 1.25;
const _RATE_HOL_REG     = 2.00;
const _RATE_HOL_SPE     = 1.30;
const _HOL_REG          = 'Regular Holiday';
const _HOL_SPE          = 'Special Non-Working';
let _currentYear  = null;
let _currentMonth = null;

/* A260 — a fixed-salary employee is paid a set amount per cutoff whatever their hours, and takes no
   statutory contribution. Anything that is not exactly 'Fixed' is hourly, so a blank pay type on
   every row written before this feature keeps its original behaviour with no migration. */
function _isFixedPay(emp) { return String((emp || {}).payType || '') === 'Fixed'; }
function _fixedAmount(emp) { return parseFloat((emp || {}).fixedAmount) || 0; }

/** The calendar for a cutoff. One accessor so nothing has to remember which map is which. */
function _holidayMap(cutoff) { return cutoff === 'A' ? _holidaysA : _holidaysB; }

/** What kind of day this is: 'Regular Holiday', 'Special Non-Working', or '' for an ordinary day.
 *  A259 — legacy Payroll Hours rows carry dayType 'Holiday' from before the calendar existed; they
 *  keep their original x2 meaning, so no stored row changes value under this feature. */
function _dayTypeFor(cutoff, dateStr, entry) {
  const cal = _holidayMap(cutoff)[dateStr];
  if (cal === _HOL_REG || cal === _HOL_SPE) return cal;
  const legacy = String((entry || {}).dayType || '');
  if (legacy === 'Holiday' || legacy === _HOL_REG) return _HOL_REG;
  if (legacy === _HOL_SPE) return _HOL_SPE;
  return '';
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const session = requireDirector();
  if (!session) return;

  renderNavbar('director-home');
  document.getElementById('greeting').innerHTML = getGreeting(session.name);

  // Restore last used period from localStorage, fall back to current month
  const saved = _loadSavedPeriod();
  const now   = new Date();
  document.getElementById('payMonth').value = saved ? saved.month : String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('payYear').value  = saved ? saved.year  : now.getFullYear();

  await loadEmployees();
  await loadPeriod();  // auto-load on every page open
});

// ── Tab switching ─────────────────────────────────────────────
const _TAB_MAP = { ee: 'EE', hoursA: 'HoursA', payA: 'PayA', hoursB: 'HoursB', payB: 'PayB', thirteenth: 'Thirteenth' };

function switchPayTab(tab) {
  Object.keys(_TAB_MAP).forEach(t => {
    document.getElementById('panel' + _TAB_MAP[t]).classList.remove('active');
    document.getElementById('tab'   + _TAB_MAP[t]).classList.remove('active');
  });
  document.getElementById('panel' + _TAB_MAP[tab]).classList.add('active');
  document.getElementById('tab'   + _TAB_MAP[tab]).classList.add('active');

  if (tab === 'thirteenth') {
    _initThirteenthYearSelector();
    load13thMonth();
  }
}

// ── Period Load ───────────────────────────────────────────────
function _loadSavedPeriod() {
  try { return JSON.parse(localStorage.getItem('payroll_period')); } catch(e) { return null; }
}

async function loadPeriod() {
  const month = document.getElementById('payMonth').value;
  const year  = parseInt(document.getElementById('payYear').value) || 0;
  if (!year || !month) return;

  _currentYear  = year;
  _currentMonth = month;

  // Remember this period for next page load
  localStorage.setItem('payroll_period', JSON.stringify({ year, month }));

  const monthName = document.getElementById('payMonth').options[
    document.getElementById('payMonth').selectedIndex
  ].text;
  document.getElementById('periodLabel').textContent = monthName + ' ' + year;

  // Update titles to reflect actual cutoff date ranges
  const prevMonthDate = new Date(year, parseInt(month) - 1, 0); // last day of prev month
  const prevMonthName = prevMonthDate.toLocaleString('default', { month: 'short' });
  const curMonthName  = new Date(year, parseInt(month) - 1, 1).toLocaleString('default', { month: 'short' });
  document.getElementById('hoursATitle').textContent =
    `1st Cutoff Timesheet — ${prevMonthName} 26 – ${curMonthName} 10`;
  document.getElementById('hoursBTitle').textContent =
    `2nd Cutoff Timesheet — ${curMonthName} 11 – ${curMonthName} 25`;

  const periodA = year + '-' + month + '-A';
  const periodB = year + '-' + month + '-B';

  // Load hours and register for both cutoffs. A transient backend failure must render an
  // inline error, not abort as an unhandled rejection leaving the grids stuck on the intro text.
  let hA, hB, rA, rB, iA, iB, xA, xB;
  try {
    /* A229 — the two incentive reads join THIS Promise.all rather than awaiting after it. Six
       round trips to Apps Script in parallel is already slow; two more in sequence would be felt. */
    [hA, hB, rA, rB, iA, iB, xA, xB] = await Promise.all([
      apiGetPayrollHours(periodA),
      apiGetPayrollHours(periodB),
      apiGetPayrollRegister(periodA),
      apiGetPayrollRegister(periodB),
      apiGetPayrollIncentives({ period: periodA }),
      apiGetPayrollIncentives({ period: periodB }),
      /* A259 — the holiday calendars ride the same Promise.all for the reason A229 gives about the
         incentive reads: these round trips are slow, and two more in sequence would be felt. A
         backend that does not know the action yet resolves to no holidays, which is the old
         behaviour exactly. */
      apiGetPayrollHolidays(periodA).catch(() => ({ data: [] })),
      apiGetPayrollHolidays(periodB).catch(() => ({ data: [] }))
    ]);
  } catch (e) {
    ['hoursAGrid', 'payAGrid', 'hoursBGrid', 'payBGrid'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<p style="color:#ef4444;">Could not load payroll data: ${esc(e.message)} — click Load again to retry.</p>`;
    });
    return;
  }

  // Build lookup maps
  _hoursA = {};
  (hA.data || []).forEach(r => { _hoursA[r.employee + '|' + r.date] = r; });

  _hoursB = {};
  (hB.data || []).forEach(r => { _hoursB[r.employee + '|' + r.date] = r; });

  _registerA = {};
  (rA.data || []).forEach(r => { _registerA[r.employee] = r; });

  _registerB = {};
  (rB.data || []).forEach(r => { _registerB[r.employee] = r; });

  _holidaysA = {};
  (((xA && xA.data) || [])).forEach(r => { if (r && r.date && r.type) _holidaysA[r.date] = r.type; });
  _holidaysB = {};
  (((xB && xB.data) || [])).forEach(r => { if (r && r.date && r.type) _holidaysB[r.date] = r.type; });

  _applyIncentives('A', (iA && iA.data) || []);
  _applyIncentives('B', (iB && iB.data) || []);

  renderHoursGrid('A');
  renderHoursGrid('B');
  renderPayGrid('A');
  renderPayGrid('B');
}

// ── EE: Load ──────────────────────────────────────────────────
async function loadEmployees() {
  try {
    const res = await apiGetPayrollEmployees();
    _employees = (res.data || []).filter(e => e.status !== 'Inactive');
    renderEETable();
    if (typeof loadRateChanges === 'function') loadRateChanges();   // A198 — refresh the recent-changes panel
    if (typeof loadRecentIncentives === 'function') loadRecentIncentives();  // A229
    // Re-render grids in case period was already loaded (they need employee list)
    if (_currentYear && _currentMonth) {
      renderHoursGrid('A');
      renderHoursGrid('B');
      renderPayGrid('A');
      renderPayGrid('B');
    }
  } catch (err) {
    document.getElementById('eeBody').innerHTML =
      `<tr><td colspan="9" style="color:#ef4444;">Error: ${err.message}</td></tr>`;
  }
}

function renderEETable() {
  const tbody = document.getElementById('eeBody');
  if (!_employees.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);">No employees. Add one above.</td></tr>';
    return;
  }
  tbody.innerHTML = _employees.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(e.lastName)}</td>
      <td>${esc(e.firstName)}</td>
      <td>${_isFixedPay(e)
            ? `<span title="Fixed salary per cutoff — no Pag-IBIG, SSS or PhilHealth, and holiday pay does not apply" style="font-weight:700;color:#0f766e;">FIXED ${peso(e.fixedAmount)}</span>`
            : '<span style="color:var(--text-muted,#64748b);">Hourly</span>'}</td>
      <td class="num">${_isFixedPay(e) ? '—' : peso(e.dailyRate)}</td>
      <td class="num">${_isFixedPay(e) ? '—' : peso(e.hourlyRate)}</td>
      <td class="num">${peso(e.otherIncome)}</td>
      <td class="num">${peso(e.hdmfAmount)}</td>
      <td>${esc(e.status)}</td>
      <td>
        <button class="btn-sm" onclick="openEEModal(${i})">Edit</button>
        <button class="btn-sm" onclick="openRateHistory(${i})" title="Salary change history">Salary</button>
        <button class="btn-sm" onclick="openIncentiveHistory(${i})" title="Every incentive ever given">Incentives</button>
        <button class="btn-sm danger" onclick="deleteEE(${e.id})">Del</button>
      </td>
    </tr>
  `).join('');
}

// ── EE Modal ──────────────────────────────────────────────────
// A198 — the stored pay values when the modal opened, so we can tell whether the director actually
// changed the rate (and only then ask for an effective date + reason).
let _eeOrig = { dailyRate: null, otherIncome: null, hdmf: null };

function _eeToday() { return (typeof flowToday === 'function') ? flowToday() : new Date().toISOString().slice(0, 10); }
// The logged-in director's name for the audit stamp — `session` is scoped to the init handler.
function _eeActor() { try { return (JSON.parse(localStorage.getItem('session') || '{}').name) || ''; } catch (e) { return ''; } }

/* Reveal the effective-date/reason block only when a PAY field differs from what was stored. Adding a
   new employee (no original) never shows it — the starting rate is an initial record, not a change. */
/* A260 — a fixed employee's Daily Rate is not used for pay, so showing both boxes with equal weight
   invites someone to keep them in step and wonder which one counts. Only the one that decides the
   pay is shown; the other keeps its stored value untouched. */
function _eeSyncPayType() {
  const fixed = document.getElementById('eePayType').value === 'Fixed';
  const fr = document.getElementById('eeFixedRow'), dr = document.getElementById('eeDailyRow');
  if (fr) fr.style.display = fixed ? '' : 'none';
  if (dr) dr.style.display = fixed ? 'none' : '';
  _eeCheckPayChange();
}

function _eeCheckPayChange() {
  const block = document.getElementById('eePayChange');
  if (!block) return;
  if (_eeOrig.dailyRate === null) { block.style.display = 'none'; return; }
  const dr = parseFloat(document.getElementById('eeDailyRate').value) || 0;
  const oi = parseFloat(document.getElementById('eeOtherIncome').value) || 0;
  const hd = parseFloat(document.getElementById('eeHdmf').value) || 0;
  const fx = parseFloat((document.getElementById('eeFixedAmount') || {}).value) || 0;   // A260
  const changed = dr !== _eeOrig.dailyRate || oi !== _eeOrig.otherIncome || hd !== _eeOrig.hdmf
                  || (_eeOrig.fixed !== null && _eeOrig.fixed !== undefined && fx !== _eeOrig.fixed);
  block.style.display = changed ? '' : 'none';
  if (changed) {
    const parts = [];
    if (dr !== _eeOrig.dailyRate) parts.push(`daily rate ${peso(_eeOrig.dailyRate)} → ${peso(dr)}`);
    if (oi !== _eeOrig.otherIncome) parts.push(`other income ${peso(_eeOrig.otherIncome)} → ${peso(oi)}`);
    if (hd !== _eeOrig.hdmf) parts.push(`HDMF ${peso(_eeOrig.hdmf)} → ${peso(hd)}`);
    if (_eeOrig.fixed !== null && _eeOrig.fixed !== undefined && fx !== _eeOrig.fixed) {
      parts.push(`fixed salary ${peso(_eeOrig.fixed)} → ${peso(fx)}`);          // A260
    }
    document.getElementById('eePayChangeMsg').textContent = 'Pay change (' + parts.join(', ') + ') — recorded in the salary history';
  }
}

function openEEModal(idx) {
  const overlay = document.getElementById('eeOverlay');
  document.getElementById('eeEffectiveDate').value = _eeToday();
  document.getElementById('eeReason').value = '';
  if (idx === null) {
    _eeOrig = { dailyRate: null, otherIncome: null, hdmf: null, fixed: null };   // a new employee has no prior pay
    document.getElementById('eeModalTitle').textContent = 'Add Employee';
    document.getElementById('eeEditId').value     = '';
    document.getElementById('eeLastName').value   = '';
    document.getElementById('eeFirstName').value  = '';
    document.getElementById('eeDailyRate').value  = '';
    document.getElementById('eeOtherIncome').value = '';
    document.getElementById('eeHdmf').value       = '';
    document.getElementById('eeStatus').value     = 'Active';
    document.getElementById('eePayType').value    = 'Hourly';        // A260
    document.getElementById('eeFixedAmount').value = '';
  } else {
    const e = _employees[idx];
    _eeOrig = { dailyRate: e.dailyRate || 0, otherIncome: e.otherIncome || 0, hdmf: e.hdmfAmount || 0,
                fixed: e.fixedAmount || 0 };                          // A260
    document.getElementById('eeModalTitle').textContent = 'Edit Employee';
    document.getElementById('eeEditId').value     = e.id;
    document.getElementById('eeLastName').value   = e.lastName;
    document.getElementById('eeFirstName').value  = e.firstName;
    document.getElementById('eeDailyRate').value  = e.dailyRate;
    document.getElementById('eeOtherIncome').value = e.otherIncome;
    document.getElementById('eeHdmf').value       = e.hdmfAmount;
    document.getElementById('eeStatus').value     = e.status;
    document.getElementById('eePayType').value    = _isFixedPay(e) ? 'Fixed' : 'Hourly';   // A260
    document.getElementById('eeFixedAmount').value = e.fixedAmount || '';
  }
  _eeSyncPayType();                                                   // A260
  _eeCheckPayChange();
  ['eeDailyRate', 'eeOtherIncome', 'eeHdmf', 'eeFixedAmount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = _eeCheckPayChange;
  });
  overlay.classList.add('open');
}

function closeEEModal() {
  document.getElementById('eeOverlay').classList.remove('open');
}

async function saveEE() {
  const data = {
    id:          document.getElementById('eeEditId').value,
    lastName:    document.getElementById('eeLastName').value.trim(),
    firstName:   document.getElementById('eeFirstName').value.trim(),
    dailyRate:   document.getElementById('eeDailyRate').value,
    otherIncome: document.getElementById('eeOtherIncome').value,
    hdmfAmount:  document.getElementById('eeHdmf').value,
    status:      document.getElementById('eeStatus').value,
    payType:     document.getElementById('eePayType').value,             // A260
    fixedAmount: document.getElementById('eeFixedAmount').value,
    // A198 — passed through so the backend stamps the history row; ignored when nothing pay-related changed.
    effectiveDate: document.getElementById('eeEffectiveDate').value || _eeToday(),
    reason:        document.getElementById('eeReason').value.trim(),
    actorName:     _eeActor()   // `session` is scoped to init; read the actor from localStorage instead
  };
  if (!data.lastName || !data.firstName) { alert('Last name and first name are required.'); return; }
  const res = await apiSavePayrollEmployee(data);
  if (!res.success) { alert('Error: ' + res.message); return; }
  closeEEModal();
  await loadEmployees();
  if (typeof loadRateChanges === 'function') loadRateChanges();
  if (typeof loadRecentIncentives === 'function') loadRecentIncentives();   // A229
}

// ── A198: salary-change history ───────────────────────────────
function closeRateHistory() { document.getElementById('rhOverlay').classList.remove('open'); }

function _rhRowsHtml(rows) {
  if (!rows.length) return '<div style="color:var(--text-muted);padding:0.6rem 0;">No changes recorded yet.</div>';
  return `<table class="pay-table" style="width:100%;font-size:0.82rem;"><thead>
    <tr><th>Effective</th><th>Field</th><th class="num">Old</th><th class="num">New</th><th class="num">Change</th><th>Reason</th><th>By</th><th>Recorded</th></tr></thead><tbody>
    ${rows.map(h => {
      const chg = h.change === '' ? '—' : (h.change >= 0 ? '+' : '') + peso(h.change);
      const chgCol = h.change === '' ? '' : (h.change >= 0 ? 'color:#15803d;' : 'color:#ef4444;');
      return `<tr>
        <td>${esc(h.effectiveDate || '—')}</td>
        <td>${esc(h.field || 'Daily Rate')}</td>
        <td class="num">${h.oldValue === '' ? '—' : peso(h.oldValue)}</td>
        <td class="num">${peso(h.newValue)}</td>
        <td class="num" style="${chgCol}">${chg}</td>
        <td>${esc(h.reason || '')}</td>
        <td>${esc(h.changedBy || '')}</td>
        <td style="color:var(--text-muted);">${esc(String(h.recordedAt || '').slice(0, 10))}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

async function openRateHistory(idx) {
  const e = _employees[idx];
  const name = e.lastName + ', ' + e.firstName;
  document.getElementById('rhTitle').textContent = 'Salary History — ' + name;
  document.getElementById('rhBody').innerHTML = '<div style="color:var(--text-muted);padding:0.6rem 0;">Loading…</div>';
  document.getElementById('rhOverlay').classList.add('open');
  try {
    const res = await apiGetPayrollRateHistory(name);
    document.getElementById('rhBody').innerHTML = _rhRowsHtml((res && res.data) || []);
  } catch (err) {
    document.getElementById('rhBody').innerHTML = `<div style="color:#ef4444;">${esc(err.message)}</div>`;
  }
}

/* ── A229: every incentive this employee has ever been given ────────────────────────────────────
   Mirrors the salary-history modal above deliberately — same overlay classes, same shape, so anyone
   who has used one already knows this one.

   VOIDED ROWS ARE SHOWN, struck through, not hidden. "Every incentive ever given" includes the ones
   that were given and then withdrawn; hiding them would make the ledger a summary rather than a
   record, and the withdrawal is exactly the thing somebody will later want to explain. */
let _ihEmpName = '';
function closeIncentiveHistory() { document.getElementById('ihOverlay').classList.remove('open'); }

function _ihRowsHtml(rows) {
  if (!rows.length) return '<div style="color:var(--text-muted);padding:0.6rem 0;">No incentives recorded for this employee yet.</div>';
  const live = rows.filter(r => String(r.status || 'Active') !== 'Voided');
  const total = live.reduce((t, r) => t + (parseFloat(r.amount) || 0), 0);
  return `<div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.5rem;">
      ${live.length} incentive${live.length === 1 ? '' : 's'} paid, ${peso(total)} in total${
      rows.length > live.length ? ` · ${rows.length - live.length} voided` : ''}
    </div>
    <table class="pay-table" style="width:100%;font-size:0.82rem;"><thead>
    <tr><th>Cutoff</th><th class="num">Amount</th><th>What for</th><th>Reason</th><th>Given by</th><th>Recorded</th><th></th></tr>
    </thead><tbody>
    ${rows.map(r => {
      const voided = String(r.status || 'Active') === 'Voided';
      const style = voided ? 'text-decoration:line-through;color:var(--text-muted);' : '';
      return `<tr style="${style}">
        <td>${esc(r.period || '')}</td>
        <td class="num">${peso(r.amount)}</td>
        <td>${esc(r.category || '')}</td>
        <td>${esc(r.reason || '')}</td>
        <td>${esc(r.givenBy || '')}</td>
        <td style="color:var(--text-muted);">${esc(String(r.recordedAt || '').slice(0, 10))}</td>
        <td>${voided
          ? `<span title="Voided by ${esc(r.voidedBy || '')}" style="font-size:.72rem;">voided</span>`
          : `<button class="btn-sm" title="Void this incentive — it stays in the history"
               onclick="voidIncentive('${esc(r.incentiveId)}','${esc(String(r.period || '').slice(-1))}')">Void</button>`}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

async function openIncentiveHistory(idx) {
  const e = _employees[idx];
  openIncentiveHistoryByName(e.lastName + ', ' + e.firstName);
}

async function openIncentiveHistoryByName(name) {
  _ihEmpName = name;
  document.getElementById('ihTitle').textContent = 'Incentive History — ' + name;
  document.getElementById('ihBody').innerHTML = '<div style="color:var(--text-muted);padding:0.6rem 0;">Loading…</div>';
  document.getElementById('ihOverlay').classList.add('open');
  try {
    const res = await apiGetPayrollIncentives({ employee: name });
    document.getElementById('ihBody').innerHTML = _ihRowsHtml((res && res.data) || []);
  } catch (err) {
    document.getElementById('ihBody').innerHTML = `<div style="color:#ef4444;">${esc(err.message)}</div>`;
  }
}

/** The last few incentives across everyone, so the cutoff's bonuses read without opening each person. */
async function loadRecentIncentives() {
  const box = document.getElementById('incentivesBox');
  if (!box) return;
  try {
    const res = await apiGetPayrollIncentives({});
    const rows = ((res && res.data) || []).slice(0, 12);
    if (!rows.length) { box.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No incentives recorded yet.</div>'; return; }
    box.innerHTML = `<table class="pay-table" style="width:100%;font-size:0.82rem;"><thead>
      <tr><th>Employee</th><th>Cutoff</th><th class="num">Amount</th><th>What for</th><th>Reason</th><th>Given by</th></tr></thead><tbody>
      ${rows.map(r => {
        const voided = String(r.status || 'Active') === 'Voided';
        return `<tr style="${voided ? 'text-decoration:line-through;color:var(--text-muted);' : ''}">
          <td>${esc(r.employee || '')}</td>
          <td>${esc(r.period || '')}</td>
          <td class="num">${peso(r.amount)}</td>
          <td>${esc(r.category || '')}</td>
          <td>${esc(r.reason || '')}</td>
          <td>${esc(r.givenBy || '')}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  } catch (e) { box.innerHTML = ''; }
}

/* The last few changes across everyone, so the raise is visible without opening each person. Mounted
   into #rateChangesBox if the page provides it; silent if it does not (older markup). */
async function loadRateChanges() {
  const box = document.getElementById('rateChangesBox');
  if (!box) return;
  try {
    const res = await apiGetPayrollRateHistory('');
    const rows = ((res && res.data) || []).filter(h => h.oldValue !== '').slice(0, 12);   // real changes, not initial records
    if (!rows.length) { box.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No salary changes recorded yet.</div>'; return; }
    box.innerHTML = `<table class="pay-table" style="width:100%;font-size:0.82rem;"><thead>
      <tr><th>Employee</th><th>Effective</th><th class="num">Old</th><th class="num">New</th><th class="num">Change</th><th>Reason</th><th>By</th></tr></thead><tbody>
      ${rows.map(h => {
        const chgCol = h.change >= 0 ? 'color:#15803d;' : 'color:#ef4444;';
        return `<tr><td>${esc(h.employee)}</td><td>${esc(h.effectiveDate || '—')}</td>
          <td class="num">${peso(h.oldValue)}</td><td class="num">${peso(h.newValue)}</td>
          <td class="num" style="${chgCol}">${(h.change >= 0 ? '+' : '') + peso(h.change)}</td>
          <td>${esc(h.reason || '')}</td><td>${esc(h.changedBy || '')}</td></tr>`;
      }).join('')}</tbody></table>`;
  } catch (e) { box.innerHTML = ''; }
}

async function deleteEE(id) {
  if (!confirm('Delete this employee?')) return;
  const res = await apiDeletePayrollEmployee(id);
  if (!res.success) { alert('Error: ' + res.message); return; }
  await loadEmployees();
}

// ── Hours grid ───────────────────────────────────────────────
// 1st cutoff (A): 26th of PREVIOUS month → 10th of SELECTED month
// 2nd cutoff (B): 11th → 25th of SELECTED month
//
// A207: those four boundary numbers used to be literals here, and this was the ONLY place in the
// codebase that knew them. Commission payouts have to land in the same windows, so the definition
// now lives in flowCutoffRange() (js/flow-api.js) and is read back here. The grid itself — the day
// labels and the 'p'/'c' uniqueKeys the hours data is keyed on — is deliberately unchanged.
function _buildDateRange(cutoff) {
  const year  = _currentYear;
  const month = parseInt(_currentMonth);
  const dates = [];
  // Read the boundaries from the shared definition, falling back to the literals if flow-api.js
  // somehow has not loaded — payroll must never render a blank grid.
  let firstDay = (cutoff === 'A') ? 26 : 11, lastDay = (cutoff === 'A') ? 10 : 25;
  if (typeof flowCutoffRange === 'function' && typeof flowCutoffKey === 'function') {
    const rng = flowCutoffRange(flowCutoffKey(year, month, cutoff === 'A' ? 'A' : 'B'));
    if (rng && rng.from && rng.to) {
      firstDay = parseInt(rng.from.slice(8, 10), 10);
      lastDay  = parseInt(rng.to.slice(8, 10), 10);
    }
  }

  if (cutoff === 'A') {
    let prevMonth = month - 1, prevYear = year;
    if (prevMonth === 0) { prevMonth = 12; prevYear--; }
    const daysInPrev = new Date(prevYear, prevMonth, 0).getDate();
    for (let d = firstDay; d <= daysInPrev; d++) {
      const dt = new Date(prevYear, prevMonth - 1, d);
      dates.push({ label: d + ' ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()],
        dateStr: prevYear + '-' + String(prevMonth).padStart(2,'0') + '-' + String(d).padStart(2,'0'),
        isSunday: dt.getDay() === 0, uniqueKey: 'p' + d });
    }
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(year, month - 1, d);
      dates.push({ label: d + ' ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()],
        dateStr: year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0'),
        isSunday: dt.getDay() === 0, uniqueKey: 'c' + d });
    }
  } else {
    for (let d = firstDay; d <= lastDay; d++) {
      const dt = new Date(year, month - 1, d);
      dates.push({ label: d + ' ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()],
        dateStr: year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0'),
        isSunday: dt.getDay() === 0, uniqueKey: 'c' + d });
    }
  }
  return dates;
}

function renderHoursGrid(cutoff) {
  const containerId = 'hours' + cutoff + 'Grid';
  const container   = document.getElementById(containerId);

  if (!_currentYear || !_currentMonth) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">Load a period first.</div>';
    return;
  }

  const dates    = _buildDateRange(cutoff);
  const hoursMap = cutoff === 'A' ? _hoursA : _hoursB;
  const activeEE = _employees;

  if (!activeEE.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">No employees found. Add employees in the EE tab first.</div>';
    return;
  }

  // Quick-fill toolbar
  let html = `
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem;align-items:center;">
      <span style="font-size:0.75rem;color:var(--text-muted);">Quick fill:</span>
      <button class="btn-sm" onclick="fillAllHours('${cutoff}',8)">8h All Weekdays</button>
      <button class="btn-sm" onclick="fillAllHours('${cutoff}',9)">9h All Weekdays</button>
      <button class="btn-sm" onclick="fillAllHours('${cutoff}',0)">Clear All</button>
      <span style="font-size:0.73rem;color:var(--text-muted);margin-left:0.5rem;">Enter hours per day (e.g. 8, 8.5, 10). Reg = up to 8hrs, OT = beyond 8hrs. Sundays auto-skip.
        <strong>Click a date heading</strong> to mark it <span style="color:#fde68a;">Special 130%</span> or <span style="color:#fecaca;">Regular 200%</span>; a regular holiday nobody works still pays one day.</span>
    </div>`;

  html += `<table class="pay-table" id="hoursTable${cutoff}">
    <thead><tr>
      <th class="sticky" style="min-width:140px;">Employee</th>`;

  /* A259 — each date header is a toggle: ordinary -> Special 130% -> Regular 200% -> ordinary.
     Company-wide, because a holiday belongs to the day. Sundays keep their non-input cells but can
     still be toggled — an unworked regular holiday falling on a Sunday is still payable. */
  const cal = _holidayMap(cutoff);
  dates.forEach(dt => {
    const type = cal[dt.dateStr] || '';
    const tint = type === _HOL_REG ? 'background:rgba(239,68,68,0.22);color:#fecaca;'
               : type === _HOL_SPE ? 'background:rgba(245,158,11,0.22);color:#fde68a;'
               : (dt.isSunday ? 'color:#64748b;background:rgba(0,0,0,0.15);' : '');
    const tag = type === _HOL_REG ? '<div style="font-size:0.6rem;font-weight:700;">REG 200%</div>'
              : type === _HOL_SPE ? '<div style="font-size:0.6rem;font-weight:700;">SPE 130%</div>'
              : '';
    const tip = type ? 'Marked ' + type + ' — click to change'
                     : 'Ordinary day — click to mark a holiday';
    html += `<th style="text-align:center;${tint}min-width:52px;cursor:pointer;user-select:none;"
      title="${tip}" onclick="toggleHoliday('${cutoff}','${dt.dateStr}')">${dt.label}${tag}</th>`;
  });

  html += `<th class="num" style="min-width:60px;">Reg Hrs</th>
           <th class="num" style="min-width:55px;">OT Hrs</th>
           <th class="num" style="min-width:58px;" title="Hours worked on a holiday">Hol Hrs</th>
           <th class="num" style="min-width:80px;">Basic Pay</th>
           <th class="num" style="min-width:85px;" title="Regular 200% + Special 130% + unworked regular holidays">Holiday Pay</th>
           <th class="num" style="min-width:75px;">OT Pay</th>
           <th style="min-width:60px;">Fill</th>
    </tr></thead><tbody>`;

  activeEE.forEach(emp => {
    const empName    = emp.lastName + ', ' + emp.firstName;
    const hourlyRate = emp.dailyRate / 8;
    let rowRegHrs = 0, rowOTHrs = 0;

    html += `<tr data-emp="${esc(empName)}">
      <td class="sticky"><strong style="font-size:0.78rem;">${esc(empName)}</strong></td>`;

    dates.forEach(dt => {
      const key    = empName + '|' + dt.dateStr;
      const stored = hoursMap[key] || {};
      const hrs    = parseFloat(stored.hours) || 0;
      /* A259 — DEFECT FIX. This split hours into regular/OT with no regard for the day type while
         _payEarnings diverted holiday hours away entirely, so the grid would have shown Basic Pay
         for hours the payslip pays as Holiday. Invisible until holidays existed; wrong the moment
         they did. */
      if (!_dayTypeFor(cutoff, dt.dateStr, stored)) {
        rowRegHrs += Math.min(hrs, 8);
        rowOTHrs  += Math.max(hrs - 8, 0);
      }
      const val    = hrs > 0 ? hrs : '';

      if (dt.isSunday) {
        html += `<td style="background:rgba(0,0,0,0.12);text-align:center;color:#475569;font-size:0.7rem;">—</td>`;
      } else {
        html += `<td style="padding:0.3rem 0.2rem;">
          <input type="number" min="0" max="16" step="0.5" value="${val}"
            data-emp="${esc(empName)}" data-date="${dt.dateStr}" data-cutoff="${cutoff}"
            onchange="_onHoursInput(this)"
            style="width:100%;text-align:center;background:var(--bg,#f8fafc);border:1px solid var(--border,#334155);color:var(--text-primary,#f1f5f9);border-radius:6px;padding:0.3rem 0.2rem;font-size:0.82rem;">
        </td>`;
      }
    });

    const k = _empKey(empName);
    const e = _payEarnings(emp, cutoff);      // A259 — one definition, so the grid cannot drift
    html += `
      <td class="num computed" id="regHrs_${cutoff}_${k}">${rowRegHrs > 0 ? rowRegHrs.toFixed(1) : '—'}</td>
      <td class="num computed" id="otHrs_${cutoff}_${k}">${rowOTHrs > 0 ? rowOTHrs.toFixed(1) : '—'}</td>
      <td class="num computed" id="holHrs_${cutoff}_${k}" title="Hours worked on a holiday">${e.holidayHrs > 0 ? e.holidayHrs.toFixed(1) : '—'}</td>
      <td class="num computed highlight" id="basicPay_${cutoff}_${k}">${peso(e.basicPay)}</td>
      <td class="num computed highlight" id="holPay_${cutoff}_${k}" title="Regular 200% + Special 130% + unworked regular holidays">${e.holidayPay > 0 ? peso(e.holidayPay) : '—'}</td>
      <td class="num computed highlight" id="otPay_${cutoff}_${k}">${e.otHrs > 0 ? peso(e.otPay) : '—'}</td>
      <td><button class="btn-sm" onclick="fillRowHours('${cutoff}','${esc(empName)}',8)" style="font-size:0.7rem;padding:0.2rem 0.5rem;">8h</button></td>
    </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function _empKey(name) {
  return name.replace(/[^a-z0-9]/gi, '_');
}

// ─── Per-employee payslip PDF (per cutoff, full breakdown, downloadable) ───────────
// Thermal-receipt style (80mm): monospace, dashed separators, label/value rows.
const _PAYSLIP_CSS = `
.payslip { font-family:'Courier New', Courier, monospace; color:#000; width:100%; box-sizing:border-box; padding:8px 12px; font-size:11px; line-height:1.4; }
.payslip .ps-head { text-align:center; margin-bottom:4px; }
.payslip .ps-co { font-size:13px; font-weight:800; letter-spacing:0.3px; }
.payslip .ps-logo { display:block; margin:5px auto 2px; height:48px; max-width:70%; object-fit:contain; }
.payslip .ps-doc { font-size:11px; font-weight:700; letter-spacing:3px; margin-top:2px; }
.payslip .ps-sep { border-top:1px dashed #000; margin:6px 0; }
.payslip .ps-kv { font-size:10px; margin:1px 0; word-break:break-word; }
.payslip .ps-kv b { font-weight:700; }
.payslip .ps-sec { font-weight:700; text-transform:uppercase; font-size:10px; letter-spacing:0.05em; margin:2px 0; }
.payslip .ps-t { width:100%; border-collapse:collapse; table-layout:fixed; }
.payslip .ps-t td { padding:1px 0; font-size:11px; vertical-align:top; }
.payslip .ps-t td.l { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px; }
.payslip .ps-t td.r { width:42%; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.payslip .ps-t tr.sub td { font-weight:800; }
.payslip .ps-net-t td { font-weight:800; font-size:14px; padding:3px 0; }
.payslip .ps-net-t td.r { width:50%; }
.payslip .ps-sign { margin-top:22px; font-size:9px; text-align:center; }
.payslip .ps-sign .ln { border-top:1px solid #000; margin:0 6px; padding-top:2px; }
.payslip .ps-foot { text-align:center; font-size:8px; color:#333; margin-top:8px; }
`;

// Period label + date range for a cutoff (reuses the existing date-range builder).
function _payslipPeriod(cutoff) {
  const dates = _buildDateRange(cutoff);
  const monthName = new Date(_currentYear, parseInt(_currentMonth) - 1, 1)
    .toLocaleString('default', { month: 'long' });
  const first = dates.length ? dates[0].dateStr : '';
  const last = dates.length ? dates[dates.length - 1].dateStr : '';
  return {
    label: (cutoff === 'A' ? '1st' : '2nd') + ' Cutoff — ' + monthName + ' ' + _currentYear,
    range: first + '  to  ' + last,
  };
}

// Compute one employee's full payslip breakdown — identical math to renderPayGrid,
// reading the same hours/register maps (so it reflects on-screen deduction edits).
function _computePaySlip(emp, cutoff) {
  const e = _payEarnings(emp, cutoff);                 // A229 — one definition of the earnings half
  const empName = e.empName;
  const grossPay = e.grossPay;
  const d = _payDeductions(emp, cutoff);          // A260 — one definition of the deduction half
  const { pagibig, sss, philhealth, advances, wtax, totalDed } = d;
  return {
    empName, hourlyRate: e.hourlyRate, dailyRate: emp.dailyRate,
    isFixed: e.isFixed, fixedAmount: e.fixedAmount, recordedHrs: e.recordedHrs,  // A260
    regHrs: e.regHrs, otHrs: e.otHrs, holidayHrs: e.holidayHrs,
    basicPay: e.basicPay, holidayPay: e.holidayPay, otPay: e.otPay,
    // A259 — the breakdown, so the payslip can name the rate it applied instead of guessing
    regHolHrs: e.regHolHrs, regHolPay: e.regHolPay,
    speHolHrs: e.speHolHrs, speHolPay: e.speHolPay,
    unworkedHolDays: e.unworkedHolDays, unworkedHolPay: e.unworkedHolPay,
    otherIncome: e.otherIncome, incentive: e.incentive, grossPay,
    pagibig, sss, philhealth, advances, wtax, totalDed, netPay: grossPay - totalDed,
  };
}

// One employee's payslip block, thermal-receipt style (styled by _PAYSLIP_CSS).
function _payslipHtml(emp, cutoff) {
  const s = _computePaySlip(emp, cutoff);
  const pr = _payslipPeriod(cutoff);
  const hn = n => (Math.round((n || 0) * 10) / 10).toFixed(1) + ' hrs';
  const totalHrs = s.regHrs + s.otHrs + s.holidayHrs;
  // Fixed 2-column table rows: the amount column has a set width so it can never run off the page edge.
  const row = (label, val, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td class="l">${esc(label)}</td><td class="r">${val}</td></tr>`;
  const money = (label, val, cls) => row(label, peso(val), cls);
  /* A259 — the rate is no longer hard-coded into the label. This said "Holiday (Nh x2)" whatever
     had actually been applied, which is wrong on every special non-working day. Only the lines that
     carry money are printed; a period with no holidays shows a single zero Holiday line exactly as
     it always did, so nothing changes on an ordinary payslip. */
  /* The label column is nowrap with an ellipsis at 58% of a 296px receipt — about 26 characters at
     11px Courier. "Regular Holiday (8.0 hrs x2)" overflows it and renders as "Regular Holiday (8.0
     hr…", which hides the very rate the line exists to state. A compact hour form keeps every label
     inside the column instead of widening a rule that ~100 filed payslips lay out against. */
  const hc = n => (Math.round((n || 0) * 10) / 10).toFixed(1) + 'h';
  const holidayRows = (s.regHolPay || s.speHolPay || s.unworkedHolPay)
    ? [
        s.regHolPay      ? money('Reg Holiday (' + hc(s.regHolHrs) + ' x2)', s.regHolPay) : '',
        s.speHolPay      ? money('Spcl Holiday (' + hc(s.speHolHrs) + ' x1.3)', s.speHolPay) : '',
        s.unworkedHolPay ? money('Unworked Holiday (' + s.unworkedHolDays + ' day'
                                 + (s.unworkedHolDays === 1 ? '' : 's') + ')', s.unworkedHolPay) : ''
      ].filter(Boolean).join('')
    : money('Holiday', s.holidayPay);
  return `<div class="payslip">
    <div class="ps-head"><div class="ps-co">H.O ESTUR CORPORATION</div>
      <img class="ps-logo" src="${location.origin}/images/logo-login.png" alt="" onerror="this.style.display='none'">
      <div class="ps-doc">PAYSLIP</div></div>
    <div class="ps-sep"></div>
    <div class="ps-kv"><b>Employee:</b> ${esc(s.empName)}</div>
    <div class="ps-kv"><b>Period:</b> ${esc(pr.label)}</div>
    <div class="ps-kv"><b>Coverage:</b> ${esc(pr.range)}</div>
    ${s.isFixed
      ? `<div class="ps-kv"><b>Rate:</b> ${peso(s.fixedAmount)} fixed / cutoff</div>
         <div class="ps-kv" style="font-weight:700;">FIXED SALARY &mdash; hours not applied</div>`
      : `<div class="ps-kv"><b>Rate:</b> ${peso(s.dailyRate)}/day &middot; ${peso(s.hourlyRate)}/hr</div>`}
    <div class="ps-sep"></div>
    <div class="ps-sec">Hours Worked</div>
    <table class="ps-t"><tbody>
      ${s.isFixed
        ? row('Hours Recorded', hn(s.recordedHrs), 'sub')
        : `${row('Regular', hn(s.regHrs))}
           ${row('Overtime', hn(s.otHrs))}
           ${row('Holiday', hn(s.holidayHrs))}
           ${row('Total Hours', hn(totalHrs), 'sub')}`}
    </tbody></table>
    <div class="ps-sep"></div>
    <div class="ps-sec">Earnings</div>
    <table class="ps-t"><tbody>
      ${s.isFixed ? money('Fixed Salary', s.basicPay) : money('Basic Pay (' + hn(s.regHrs) + ')', s.basicPay)}
      ${money('Overtime (' + hn(s.otHrs) + ' x1.25)', s.otPay)}
      ${holidayRows}
      ${money('Other Income', s.otherIncome)}
      ${money('Incentive', s.incentive)}
      ${money('GROSS PAY', s.grossPay, 'sub')}
    </tbody></table>
    <div class="ps-sep"></div>
    <div class="ps-sec">Deductions</div>
    <table class="ps-t"><tbody>
      ${money('Pag-IBIG', s.pagibig)}
      ${money('SSS', s.sss)}
      ${money('PhilHealth', s.philhealth)}
      ${money('Advances', s.advances)}
      ${money('Withholding Tax', s.wtax)}
      ${money('TOTAL DEDUCTIONS', s.totalDed, 'sub')}
    </tbody></table>
    <div class="ps-sep"></div>
    <table class="ps-t ps-net-t"><tbody><tr><td class="l">NET PAY</td><td class="r">${peso(s.netPay)}</td></tr></tbody></table>
    <div class="ps-sep"></div>
    <div class="ps-sign"><div class="ln">Received by &mdash; ${esc(s.empName)}</div></div>
    <div class="ps-foot">Generated ${esc(new Date().toLocaleString('en-PH'))}<br>System-generated payslip</div>
  </div>`;
}

// Load html2pdf on demand (same CDN as the payroll-approval PDF), then run cb.
// Render the payslip HTML in a hidden same-origin iframe, then run html2pdf INSIDE that iframe
// (waiting two animation frames so it's laid out/painted) and download. Mirrors the working
// _renderPayrollSnapshotPdfBase64 pattern in management-home.js — the off-screen <div> approach
// produced blank pages because html2canvas captured before layout/paint.
const _HTML2PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

// Receipt size: 80mm wide. singleMeasure=true fits the page height to one receipt (no trailing
// whitespace); false uses a fixed page with page-breaks (one receipt per page for "all").
const _PS_BODY_PX = 400;   // receipt render width in px (~106mm at 96dpi — "a little wider" than 80mm)

/* A261 — `opts` lets a caller supply its own stylesheet and body width so the payroll cutoff can
   reuse this instead of owning a second, worse PDF path. Everything that makes this function worth
   reusing stays: the page is sized from the RENDERED content so nothing is cropped, images are
   waited for before capture, and the iframe is cleaned up on every exit including failure.
   Omitting opts reproduces the payslip behaviour byte for byte. */
function _renderPayslipPdf(innerHtml, filename, singleMeasure, opts) {
  opts = opts || {};
  const css    = (opts.css !== undefined) ? opts.css : _PAYSLIP_CSS;
  const bodyPx = opts.bodyPx || _PS_BODY_PX;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:' + (bodyPx + 40) + 'px;height:1600px;opacity:0;border:0;z-index:-1;';
  document.body.appendChild(iframe);
  let done = false;
  const cleanup = () => { if (!done) { done = true; try { document.body.removeChild(iframe); } catch (e) {} } };

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  /* A261 — `fitContent` treats bodyPx as a MINIMUM and lets the body grow to whatever the content
     actually needs, so the page derived from scrollWidth below can never be narrower than the
     document. A payslip is a fixed-width receipt and keeps the exact width it asks for. */
  const widthCss = opts.fitContent
    ? 'width:max-content;min-width:' + bodyPx + 'px;'
    : 'width:' + bodyPx + 'px;';
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css +
    ' body{margin:0;background:#fff;' + widthCss + '}</style></head><body>' + innerHtml + '</body></html>');
  doc.close();
  const win = iframe.contentWindow;

  const run = () => win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
    try {
      // Derive the PDF page from the ACTUAL rendered content size (1px = 1/96in) so the page is exactly
      // as wide as the content — html2pdf renders unscaled, so a too-narrow page crops the right column.
      const px2mm = 25.4 / 96, margin = 6;
      const wpx = win.document.body.scrollWidth || bodyPx;
      const hpx = win.document.body.scrollHeight || 1000;
      const pageW = Math.round(wpx * px2mm) + margin * 2;
      const pageH = singleMeasure ? Math.max(120, Math.round(hpx * px2mm) + margin * 2) : (opts.pageH || 245);
      win.html2pdf().set({
        margin: margin, filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 3, useCORS: true, backgroundColor: '#ffffff', logging: false },
        jsPDF: { unit: 'mm', format: [pageW, pageH], orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(win.document.body).save()
        .then(() => setTimeout(cleanup, 1500))
        .catch((err) => { cleanup(); alert('Failed to generate the ' + (opts.what || 'payslip') + ' PDF: ' + (err && err.message || err)); });
    } catch (err) { cleanup(); alert('Failed to generate the ' + (opts.what || 'payslip') + ' PDF.'); }
  }));

  // Wait for images (the logo) to finish loading before capturing, else html2canvas paints them blank.
  const gate = () => {
    const imgs = Array.prototype.slice.call(win.document.images || []);
    const pending = imgs.filter(im => !im.complete);
    if (!pending.length) { run(); return; }
    let left = pending.length, fired = false;
    const go = () => { if (!fired) { fired = true; run(); } };
    pending.forEach(im => { im.addEventListener('load', () => { if (--left <= 0) go(); });
      im.addEventListener('error', () => { if (--left <= 0) go(); }); });
    setTimeout(go, 3000);   // fallback so a slow/failed image never blocks the download
  };

  if (win.html2pdf) { gate(); }
  else {
    const sc = doc.createElement('script');
    sc.src = _HTML2PDF_CDN;
    sc.onload = gate;
    sc.onerror = () => { cleanup(); alert('Could not load the PDF library — check your connection and try again.'); };
    doc.head.appendChild(sc);
  }
  // Safety net if save() never resolves.
  setTimeout(cleanup, 15000);
}

// Download one employee's payslip PDF for a cutoff.
function downloadPayslip(empName, cutoff) {
  if (!_currentYear || !_currentMonth) { alert('Load a period first.'); return; }
  const emp = _employees.find(e => (e.lastName + ', ' + e.firstName) === empName);
  if (!emp) { alert('Employee not found.'); return; }
  const fn = 'Payslip_' + (emp.lastName + '_' + emp.firstName).replace(/[^a-z0-9]/gi, '_') +
    '_' + _currentYear + '-' + _currentMonth + '_' + cutoff + '.pdf';
  _renderPayslipPdf(_payslipHtml(emp, cutoff), fn, true);
}

// Download all active employees' payslips for a cutoff as one multi-page PDF (one per page).
function downloadAllPayslips(cutoff) {
  if (!_currentYear || !_currentMonth) { alert('Load a period first.'); return; }
  const list = _employees || [];
  if (!list.length) { alert('No employees to generate payslips for.'); return; }
  const html = list.map((emp, i) =>
    `<div style="${i < list.length - 1 ? 'page-break-after:always;' : ''}">${_payslipHtml(emp, cutoff)}</div>`).join('');
  const fn = 'Payslips_' + _currentYear + '-' + _currentMonth + '_' + cutoff + '.pdf';
  _renderPayslipPdf(html, fn, false);
}

function _onHoursInput(input) {
  const empName  = input.dataset.emp;
  const date     = input.dataset.date;
  const cutoff   = input.dataset.cutoff;
  const hoursMap = cutoff === 'A' ? _hoursA : _hoursB;
  const hrs      = parseFloat(input.value) || 0;
  const key      = empName + '|' + date;

  if (hrs > 0) {
    if (!hoursMap[key]) hoursMap[key] = { employee: empName, date, dayType: 'Regular' };
    hoursMap[key].hours = hrs;
  } else {
    delete hoursMap[key];
  }
  _recomputeEmpTotals(empName, cutoff);
}

/* A259 — cycle a date through ordinary -> Special 130% -> Regular 200% -> ordinary.
   Re-renders the whole grid rather than patching one column: every employee's Reg/OT/Holiday totals
   change when a day changes type, and patching a subset is how a grid comes to disagree with the
   payslip. The calendar is saved with the hours, so nothing is written until the user saves. */
function toggleHoliday(cutoff, dateStr) {
  const cal = _holidayMap(cutoff);
  const cur = cal[dateStr] || '';
  if (cur === '') cal[dateStr] = _HOL_SPE;
  else if (cur === _HOL_SPE) cal[dateStr] = _HOL_REG;
  else delete cal[dateStr];
  renderHoursGrid(cutoff);
  try { renderPayGrid(cutoff); } catch (e) { /* pay grid refreshes on its own tab */ }
}

// Fill a single employee's row for all non-Sunday days
function fillRowHours(cutoff, empName, hrs) {
  const hoursMap = cutoff === 'A' ? _hoursA : _hoursB;
  const dates    = _buildDateRange(cutoff);
  const container = document.getElementById('hours' + cutoff + 'Grid');

  dates.forEach(dt => {
    if (dt.isSunday) return;
    const key = empName + '|' + dt.dateStr;
    if (hrs > 0) {
      if (!hoursMap[key]) hoursMap[key] = { employee: empName, date: dt.dateStr, dayType: 'Regular' };
      hoursMap[key].hours = hrs;
    } else {
      delete hoursMap[key];
    }
    // Update the input in the DOM
    const input = container.querySelector(`input[data-emp="${empName}"][data-date="${dt.dateStr}"]`);
    if (input) input.value = hrs > 0 ? hrs : '';
  });
  _recomputeEmpTotals(empName, cutoff);
}

// Fill ALL employees' non-Sunday days
function fillAllHours(cutoff, hrs) {
  _employees.forEach(emp => {
    fillRowHours(cutoff, emp.lastName + ', ' + emp.firstName, hrs);
  });
}

function _recomputeEmpTotals(empName, cutoff) {
  const emp = _employees.find(e => (e.lastName + ', ' + e.firstName) === empName);
  if (!emp) return;

  /* A259 — DEFECT FIX, the live half of the one in renderHoursGrid. This recomputed reg/OT from
     every stored row with no regard for the day type, so typing hours into a holiday column moved
     the money into Basic Pay on screen while the payslip paid it as Holiday. Both now read the same
     _payEarnings, so the grid cannot say one thing and the payslip another. */
  const e = _payEarnings(emp, cutoff);
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const k = _empKey(empName);
  set(`regHrs_${cutoff}_${k}`,   e.regHrs     > 0 ? e.regHrs.toFixed(1)     : '—');
  set(`otHrs_${cutoff}_${k}`,    e.otHrs      > 0 ? e.otHrs.toFixed(1)      : '—');
  set(`holHrs_${cutoff}_${k}`,   e.holidayHrs > 0 ? e.holidayHrs.toFixed(1) : '—');
  set(`basicPay_${cutoff}_${k}`, peso(e.basicPay));
  set(`holPay_${cutoff}_${k}`,   e.holidayPay > 0 ? peso(e.holidayPay)      : '—');
  set(`otPay_${cutoff}_${k}`,    e.otHrs      > 0 ? peso(e.otPay)           : '—');
}

// ── Save Hours ────────────────────────────────────────────────
async function saveHours(cutoff) {
  if (!_currentYear || !_currentMonth) { alert('Load a period first.'); return; }
  const period   = _currentYear + '-' + _currentMonth + '-' + cutoff;
  const hoursMap = cutoff === 'A' ? _hoursA : _hoursB;

  const rows = Object.values(hoursMap).filter(r => (parseFloat(r.hours) || 0) > 0);
  try {
    const res = await apiSavePayrollHours(period, rows);
    if (!res.success) { alert('Error saving hours: ' + (res.message || 'Unknown error')); return; }
    /* A259 — the holiday calendar saves with the hours, so one button means one consistent state.
       Sent whole: the server replaces the period, so a holiday the user un-toggled disappears.
       An older backend that does not know the action leaves the calendar unsaved and says so
       rather than reporting a success the sheet does not have. */
    const holRows = Object.keys(_holidayMap(cutoff)).map(d => ({ date: d, type: _holidayMap(cutoff)[d] }));
    try {
      const hres = await apiSavePayrollHolidays(period, holRows);
      if (!hres || !hres.success) {
        alert('Hours saved, but the holiday markings did not: ' + ((hres && hres.message) || 'unknown error'));
      }
    } catch (err2) {
      alert('Hours saved, but the holiday markings did not: ' + err2.message);
    }
  } catch (err) {
    alert('Error saving hours: ' + err.message);
    return;
  }

  const msgEl = document.getElementById('saveHours' + cutoff + 'Msg');
  msgEl.style.display = 'inline';
  setTimeout(() => { msgEl.style.display = 'none'; }, 2000);

  // Auto-refresh pay grid
  try {
    await _refreshRegister(cutoff);
    renderPayGrid(cutoff);
  } catch (e) { /* non-critical — grid will refresh on next load */ }
}

// ── Pay grid ─────────────────────────────────────────────────
async function _refreshRegister(cutoff) {
  const period = _currentYear + '-' + _currentMonth + '-' + cutoff;
  const res = await apiGetPayrollRegister(period);
  const map = cutoff === 'A' ? _registerA : _registerB;
  Object.keys(map).forEach(k => delete map[k]);
  (res.data || []).forEach(r => { map[r.employee] = r; });
}

function renderPayGrid(cutoff) {
  const containerId = 'pay' + cutoff + 'Grid';
  const container   = document.getElementById(containerId);

  if (!_currentYear || !_currentMonth) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">Load a period first.</div>';
    return;
  }

  const hoursMap  = cutoff === 'A' ? _hoursA : _hoursB;
  const registerMap = cutoff === 'A' ? _registerA : _registerB;
  const activeEE  = _employees;

  if (!activeEE.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1rem;">No employees. Add employees in the EE tab.</div>';
    return;
  }

  let html = `<table class="pay-table">
    <thead><tr>
      <th class="sticky">Employee</th>
      <th class="num">Basic Pay</th>
      <th class="num">Holiday Pay</th>
      <th class="num">OT Pay</th>
      <th class="num">Other Income</th>
      <th class="num">Incentive</th>
      <th class="num">Gross Pay</th>
      <th class="num">Pag-IBIG</th>
      <th class="num">SSS</th>
      <th class="num">PhilHealth</th>
      <th class="num">Advances</th>
      <th class="num">WTax</th>
      <th class="num">Total Ded.</th>
      <th class="num highlight">Net Pay</th>
      <th>Slip</th>
    </tr></thead>
    <tbody>`;

  let totBasic=0, totHol=0, totOT=0, totOther=0, totInc=0, totGross=0,
      totPag=0, totSSS=0, totPHIC=0, totAdv=0, totWTax=0, totDed=0, totNet=0;

  activeEE.forEach(emp => {
    const e = _payEarnings(emp, cutoff);            // A229 — one definition of the earnings half
    const empName = e.empName, hourlyRate = e.hourlyRate;
    const regHrs = e.regHrs, otHrs = e.otHrs, holidayHrs = e.holidayHrs;
    const basicPay = e.basicPay, holidayPay = e.holidayPay, otPay = e.otPay;
    const otherIncome = e.otherIncome, incentive = e.incentive, grossPay = e.grossPay;

    // A260 — one definition of the deduction half, waiver included.
    const { pagibig, sss, philhealth, advances, wtax, totalDed } = _payDeductions(emp, cutoff);
    const netPay   = grossPay - totalDed;

    totBasic += basicPay; totHol += holidayPay; totOT += otPay; totOther += otherIncome;
    totInc += incentive;
    totGross += grossPay; totPag += pagibig; totSSS += sss; totPHIC += philhealth;
    totAdv += advances; totWTax += wtax; totDed += totalDed; totNet += netPay;

    const k = _empKey(empName);

    /* A229 — the Incentive cell is a TOTAL plus a "+", never a bare input like Advances beside it.
       An inline number box would say "type it and it saves with the register", which is the opposite
       of how this works, and it has nowhere to put the category or the reason that make the
       per-employee record worth having. */
    const incCell = `<td class="num computed" style="white-space:nowrap;">
        ${incentive > 0 ? `<span style="font-weight:700;">${peso(incentive)}</span>` : '<span style="color:var(--text-muted);">—</span>'}
        <button class="btn-sm" title="Add an incentive for this cutoff"
          onclick="openIncentiveAdd('${esc(empName)}','${cutoff}')"
          style="margin-left:6px;padding:1px 7px;">+</button>
      </td>`;

    html += `<tr data-emp="${esc(empName)}">
      <td class="sticky"><strong>${esc(empName)}</strong></td>
      <td class="num computed">${peso(basicPay)}</td>
      <td class="num computed">${peso(holidayPay)}</td>
      <td class="num computed">${peso(otPay)}</td>
      <td class="num computed">${peso(otherIncome)}</td>
      ${incCell}
      <td class="num computed highlight">${peso(grossPay)}</td>
      ${/* A260 — a fixed-salary employee takes no statutory contribution. The cells are shown
             READ-ONLY at zero rather than left editable: an input the maths ignores is a trap, and
             typing into it would look like it had been applied. */''}
      ${_isFixedPay(emp)
        ? `<td class="num" title="Waived — fixed salary">0.00</td>
           <td class="num" title="Waived — fixed salary">0.00</td>
           <td class="num" title="Waived — fixed salary">0.00</td>`
        : `<td class="num"><input type="number" min="0" step="0.01" value="${pagibig.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="pagibig" onchange="_updateRegCell(this)" style="width:75px;"></td>
           <td class="num"><input type="number" min="0" step="0.01" value="${sss.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="sss" onchange="_updateRegCell(this)" style="width:75px;"></td>
           <td class="num"><input type="number" min="0" step="0.01" value="${philhealth.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="philhealth" onchange="_updateRegCell(this)" style="width:75px;"></td>`}
      <td class="num"><input type="number" min="0" step="0.01" value="${advances.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="advances" onchange="_updateRegCell(this)" style="width:75px;"></td>
      <td class="num"><input type="number" min="0" step="0.01" value="${wtax.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="wtax" onchange="_updateRegCell(this)" style="width:75px;"></td>
      <td class="num computed" id="totalDed_${cutoff}_${k}">${peso(totalDed)}</td>
      <td class="num highlight" id="netPay_${cutoff}_${k}">${peso(netPay)}</td>
      <td><button class="btn-sm" title="Download payslip PDF" onclick="downloadPayslip('${esc(empName)}','${cutoff}')">⬇</button></td>
    </tr>`;
  });

  html += `<tr class="total-row">
    <td class="sticky">TOTAL</td>
    <td class="num">${peso(totBasic)}</td>
    <td class="num">${peso(totHol)}</td>
    <td class="num">${peso(totOT)}</td>
    <td class="num">${peso(totOther)}</td>
    <td class="num">${peso(totInc)}</td>
    <td class="num">${peso(totGross)}</td>
    <td class="num">${peso(totPag)}</td>
    <td class="num">${peso(totSSS)}</td>
    <td class="num">${peso(totPHIC)}</td>
    <td class="num">${peso(totAdv)}</td>
    <td class="num">${peso(totWTax)}</td>
    <td class="num">${peso(totDed)}</td>
    <td class="num">${peso(totNet)}</td>
    <td></td>
  </tr></tbody></table>`;

  container.innerHTML = html;
}

function _updateRegCell(input) {
  const empName = input.dataset.emp;
  const cutoff  = input.dataset.cutoff;
  const field   = input.dataset.field;
  const regMap  = cutoff === 'A' ? _registerA : _registerB;

  if (!regMap[empName]) regMap[empName] = {};
  regMap[empName][field] = parseFloat(input.value) || 0;

  // Recompute totals for this row
  const emp = _employees.find(e => (e.lastName + ', ' + e.firstName) === empName);
  if (!emp) return;

  const grossPay = _payEarnings(emp, cutoff).grossPay;   // A229 — one definition

  /* NOTE this block deliberately keeps its own deduction idiom: `parseFloat(x) || 0` with NO
     `!== undefined` fallback, unlike the other four sites. That is correct here — by the time this
     runs the row has been rendered, so regMap already holds every field. Folding it into a shared
     helper would have changed it. */
  const saved = regMap[empName];
  const pag  = parseFloat(saved.pagibig)    || 0;
  const sss  = parseFloat(saved.sss)        || 0;
  const phic = parseFloat(saved.philhealth) || 0;
  const adv  = parseFloat(saved.advances)   || 0;
  const wt   = parseFloat(saved.wtax)       || 0;
  const totDed = pag + sss + phic + adv + wt;
  const netPay = grossPay - totDed;

  const k = _empKey(empName);
  const tdEl  = document.getElementById(`totalDed_${cutoff}_${k}`);
  const npEl  = document.getElementById(`netPay_${cutoff}_${k}`);
  if (tdEl) tdEl.textContent = peso(totDed);
  if (npEl) npEl.textContent = peso(netPay);
}

// ── Save Register ─────────────────────────────────────────────
async function saveRegister(cutoff) {
  if (!_currentYear || !_currentMonth) { alert('Load a period first.'); return; }
  const period   = _currentYear + '-' + _currentMonth + '-' + cutoff;
  const hoursMap  = cutoff === 'A' ? _hoursA : _hoursB;
  const registerMap = cutoff === 'A' ? _registerA : _registerB;

  const rows = _employees.map(emp => {
    /* A229 — one definition of the earnings half. The statutory defaults must match exactly what was
       displayed, so saving never changes a number on screen — which is why both this and the grid
       pass `statBase`, not gross. The incentive is NOT sent: the server recomputes it from the
       ledger and discards anything the client claims. */
    const e = _payEarnings(emp, cutoff);
    const saved = registerMap[e.empName] || {};
    const d = _payDeductions(emp, cutoff);        // A260 — one definition, and computed once

    return {
      employee:    e.empName,
      basicPay:    e.basicPay,
      holidayPay:  e.holidayPay,
      otPay:       e.otPay,
      otherIncome: e.otherIncome,
      pagibig:     d.pagibig,
      sss:         d.sss,
      philhealth:  d.philhealth,
      advances:    saved.advances   || 0,
      wtax:        saved.wtax       || 0
    };
  });

  try {
    const res = await apiSavePayrollRegister(period, rows);
    if (!res.success) { alert('Error saving pay register: ' + (res.message || 'Unknown error')); return; }
  } catch (err) {
    alert('Error saving pay register: ' + err.message);
    return;
  }

  // Reload saved state back into memory so edits reflect what's actually stored
  try {
    await _refreshRegister(cutoff);
    renderPayGrid(cutoff);
  } catch (e) { /* non-critical */ }

  const msgEl = document.getElementById('savePay' + cutoff + 'Msg');
  msgEl.style.display = 'inline';
  setTimeout(() => { msgEl.style.display = 'none'; }, 2000);
}

// ── Export to PDF ─────────────────────────────────────────────
/* A261 — this DOWNLOADS a PDF, which is what the button has always claimed to do.
   It used to open a blank tab, write the document into it and call window.print(). That is a print
   dialog, not an export: nothing reaches the user's folder unless they then choose "Save as PDF",
   and if the popup or the injected script is blocked they are left looking at a tab of HTML with no
   idea what went wrong. The payslips have downloaded properly since A178 through _renderPayslipPdf;
   this now uses the same path, with the cutoff document's own stylesheet.

   The snapshot HTML itself is UNTOUCHED — it is what submitCutoffForApproval sends to Management,
   so the styles and body are read out of it rather than the builder being restructured. */
function exportCutoff(cutoff) {
  const built = _buildCutoffHtml(cutoff);
  if (!built) return;
  const css  = (built.html.match(/<style>([\s\S]*?)<\/style>/i) || [, ''])[1];
  const body = (built.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, ''])[1];
  if (!body) { alert('Could not build the payroll document — nothing to export.'); return; }
  const safe = (built.period || 'payroll').replace(/[^A-Za-z0-9._-]+/g, '-');
  _renderPayslipPdf(body, 'Payroll_' + safe + '.pdf', true, {
    css: css,
    /* Wide enough that the timesheet's date columns lay out at their natural width — the page is
       then sized from the RENDERED width, so a wider cutoff simply produces a wider page instead of
       a cropped one. */
    bodyPx: 1400,
    fitContent: true,     // a wider cutoff makes a wider page rather than a cropped one
    what: 'payroll'
  });
}

// ── Submit for Approval ───────────────────────────────────────
async function submitCutoffForApproval(cutoff) {
  if (!_currentYear || !_currentMonth) { alert('Load a period first.'); return; }
  const built = _buildCutoffHtml(cutoff);
  if (!built) return;
  if (!confirm('Submit ' + built.cutoffLabel + ' (' + built.period + ') to Management for approval?')) return;
  const session = (typeof getSession === 'function') ? getSession() : null;
  const submittedBy = (session && (session.name || session.username)) || 'Director';
  const btn = document.getElementById('submitApproval' + cutoff + 'Btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  try {
    const res = await apiSubmitPayrollForApproval({
      period: built.period,
      cutoffLabel: built.cutoffLabel,
      submittedBy: submittedBy,
      totals: built.totals,
      snapshotHtml: built.html
    });
    if (res && res.success) {
      if (btn) btn.textContent = 'Submitted ✓';
      alert('Submitted to Management for approval.');
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit for Approval'; }
      alert('Submit failed: ' + ((res && res.message) || 'unknown error'));
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit for Approval'; }
    alert('Error: ' + err.message);
  }
}

function _buildCutoffHtml(cutoff) {
  if (!_currentYear || !_currentMonth) { alert('Load a period first.'); return null; }

  const monthName = new Date(_currentYear, parseInt(_currentMonth) - 1, 1)
    .toLocaleString('default', { month: 'long' });
  const cutoffLabel = cutoff === 'A' ? '1st Cutoff' : '2nd Cutoff';
  const hoursMap    = cutoff === 'A' ? _hoursA : _hoursB;
  const registerMap = cutoff === 'A' ? _registerA : _registerB;
  const dates       = _buildDateRange(cutoff);
  const company     = 'HI-ESCORP';
  const period      = _currentYear + '-' + _currentMonth + '-' + cutoff;
  const employerShareEl = document.getElementById('employerShare' + cutoff);
  const employerShare = employerShareEl ? (parseFloat(employerShareEl.value) || 0) : 0;

  const p = v => '₱' + (Number(v)||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* A259 — the approval document must SHOW which days were holidays, or an approver is asked to
     sign off a Holiday Pay figure with nothing on the page explaining where it came from. */
  const calS = _holidayMap(cutoff);
  let tsHead = `<tr><th>Employee</th>`;
  dates.forEach(dt => {
    const t = calS[dt.dateStr] || '';
    const mark = t === _HOL_REG ? '<br><span style="font-size:8px;">REG 200%</span>'
               : t === _HOL_SPE ? '<br><span style="font-size:8px;">SPE 130%</span>' : '';
    tsHead += `<th${dt.isSunday ? ' class="sun"' : ''}>${dt.label}${mark}</th>`;
  });
  tsHead += `<th>Reg Hrs</th><th>OT Hrs</th><th>Hol Hrs</th><th>Basic Pay</th><th>Holiday Pay</th><th>OT Pay</th></tr>`;

  let tsBody = '';
  let totReg = 0, totOT = 0, totHol = 0, totBasic = 0, totHolPay = 0, totOTPay = 0;

  _employees.forEach(emp => {
    const empName = emp.lastName + ', ' + emp.firstName;
    /* A259 — DEFECT FIX, the third copy of it. This split reg/OT with Math.min(hrs,8) regardless of
       the day type, so the approval document would have shown Basic Pay for hours the payslip and
       the register pay as Holiday — the one page an approver signs. It now reads the same
       _payEarnings as everything else. */
    const te = _payEarnings(emp, cutoff);

    /* A260 — an approver reading this timesheet must not be left wondering why a manager's Basic
       Pay does not follow from the hours beside it. */
    let row = `<tr><td class="name">${empName}${_isFixedPay(emp)
      ? ' <span style="font-size:8px;font-weight:700;">FIXED</span>' : ''}</td>`;
    dates.forEach(dt => {
      const key  = empName + '|' + dt.dateStr;
      const hrs  = parseFloat((hoursMap[key] || {}).hours) || 0;
      row       += dt.isSunday
        ? `<td class="sun">—</td>`
        : `<td class="num">${hrs > 0 ? hrs : ''}</td>`;
    });
    totReg    += te.regHrs;    totOT     += te.otHrs;    totHol    += te.holidayHrs;
    totBasic  += te.basicPay;  totHolPay += te.holidayPay; totOTPay += te.otPay;
    row += `<td class="num">${te.regHrs     > 0 ? te.regHrs.toFixed(1)     : '—'}</td>
            <td class="num">${te.otHrs      > 0 ? te.otHrs.toFixed(1)      : '—'}</td>
            <td class="num">${te.holidayHrs > 0 ? te.holidayHrs.toFixed(1) : '—'}</td>
            <td class="num">${p(te.basicPay)}</td>
            <td class="num">${te.holidayPay > 0 ? p(te.holidayPay) : '—'}</td>
            <td class="num">${te.otHrs      > 0 ? p(te.otPay)      : '—'}</td></tr>`;
    tsBody += row;
  });

  tsBody += `<tr class="total">
    <td colspan="${dates.length + 1}">TOTAL</td>
    <td class="num">${totReg.toFixed(1)}</td>
    <td class="num">${totOT.toFixed(1)}</td>
    <td class="num">${totHol.toFixed(1)}</td>
    <td class="num">${p(totBasic)}</td>
    <td class="num">${totHolPay > 0 ? p(totHolPay) : '—'}</td>
    <td class="num">${totOTPay > 0 ? p(totOTPay) : '—'}</td>
  </tr>`;

  let prBody = '';
  let gBasic=0,gHol=0,gOT=0,gOther=0,gInc=0,gGross=0,gPag=0,gSSS=0,gPHIC=0,gAdv=0,gWTax=0,gDed=0,gNet=0;
  let employeeCount = 0;

  _employees.forEach(emp => {
    const e = _payEarnings(emp, cutoff);            // A229 — one definition of the earnings half
    const empName = e.empName;
    const basicPay = e.basicPay, holidayPay = e.holidayPay, otPay = e.otPay;
    const otherIncome = e.otherIncome, incentive = e.incentive, grossPay = e.grossPay;
    const regHrs = e.regHrs, otHrs = e.otHrs;
    const saved       = registerMap[empName] || {};
    // A260 — one definition, so the page management signs cannot disagree with the payslip.
    const dd = _payDeductions(emp, cutoff);
    const pagibig = dd.pagibig, sss = dd.sss, philhealth = dd.philhealth;
    const advances    = saved.advances   || 0;
    const wtax        = saved.wtax       || 0;
    const totalDed    = pagibig + sss + philhealth + advances + wtax;
    const netPay      = grossPay - totalDed;

    employeeCount++;
    gBasic+=basicPay; gHol+=holidayPay; gOT+=otPay; gOther+=otherIncome; gInc+=incentive;
    gGross+=grossPay; gPag+=pagibig; gSSS+=sss; gPHIC+=philhealth;
    gAdv+=advances; gWTax+=wtax; gDed+=totalDed; gNet+=netPay;

    prBody += `<tr>
      <td class="name">${empName}</td>
      <td class="num">${p(basicPay)}</td>
      <td class="num">${holidayPay > 0 ? p(holidayPay) : '—'}</td>
      <td class="num">${otPay > 0 ? p(otPay) : '—'}</td>
      <td class="num">${otherIncome > 0 ? p(otherIncome) : '—'}</td>
      <td class="num">${incentive > 0 ? p(incentive) : '—'}</td>
      <td class="num bold">${p(grossPay)}</td>
      <td class="num">${pagibig > 0 ? p(pagibig) : '—'}</td>
      <td class="num">${sss > 0 ? p(sss) : '—'}</td>
      <td class="num">${philhealth > 0 ? p(philhealth) : '—'}</td>
      <td class="num">${advances > 0 ? p(advances) : '—'}</td>
      <td class="num">${wtax > 0 ? p(wtax) : '—'}</td>
      <td class="num">${p(totalDed)}</td>
      <td class="num bold green">${p(netPay)}</td>
    </tr>`;
  });

  prBody += `<tr class="total">
    <td>TOTAL</td>
    <td class="num">${p(gBasic)}</td>
    <td class="num">${gHol > 0 ? p(gHol) : '—'}</td>
    <td class="num">${gOT > 0 ? p(gOT) : '—'}</td>
    <td class="num">${gOther > 0 ? p(gOther) : '—'}</td>
    <td class="num">${gInc > 0 ? p(gInc) : '—'}</td>
    <td class="num bold">${p(gGross)}</td>
    <td class="num">${p(gPag)}</td>
    <td class="num">${p(gSSS)}</td>
    <td class="num">${p(gPHIC)}</td>
    <td class="num">${gAdv > 0 ? p(gAdv) : '—'}</td>
    <td class="num">${gWTax > 0 ? p(gWTax) : '—'}</td>
    <td class="num">${p(gDed)}</td>
    <td class="num bold green">${p(gNet)}</td>
  </tr>`;

  let prevMonth = parseInt(_currentMonth) - 1, prevYear = _currentYear;
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }
  const prevName = new Date(prevYear, prevMonth - 1, 1).toLocaleString('default', { month: 'long' });
  const dateRangeA = `${prevName} 26, ${prevYear} – ${monthName} 10, ${_currentYear}`;
  const dateRangeB = `${monthName} 11–25, ${_currentYear}`;
  const dateRange  = cutoff === 'A' ? dateRangeA : dateRangeB;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${company} Payroll — ${monthName} ${_currentYear} ${cutoffLabel}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #111; background: #fff; padding: 12mm 10mm; }
  h1 { font-size: 13pt; text-align: center; margin-bottom: 2px; }
  .subtitle { font-size: 9pt; text-align: center; color: #555; margin-bottom: 12px; }
  h2 { font-size: 10pt; margin: 14px 0 6px; border-bottom: 1.5px solid #333; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  th { background: #1e3a5f; color: #fff; padding: 4px 5px; text-align: left; white-space: nowrap; }
  th.num, td.num { text-align: right; }
  td { padding: 3px 5px; border-bottom: 1px solid #ddd; white-space: nowrap; }
  tr:nth-child(even) td { background: #f5f8ff; }
  tr.total td { font-weight: bold; border-top: 2px solid #333; background: #eef2ff !important; }
  td.sun, th.sun { color: #999; background: #f5f5f5 !important; }
  td.bold { font-weight: bold; }
  td.green { color: #16612a; font-weight: bold; }
  td.name { min-width: 120px; }
  table.summary { width: 360px; margin-top: 4px; }
  table.summary td { border-bottom: 1px solid #e5e7eb; }
  table.summary tr.total td { font-weight: bold; border-top: 2px solid #333; background: #eef2ff !important; }
  .sig-block { margin-top: 30px; display: flex; gap: 40px; }
  .sig-line { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 8pt; text-align: center; }
  .meta { font-size: 7.5pt; color: #777; text-align: right; margin-top: 4px; }
  @media print {
    body { padding: 8mm 6mm; }
    @page { size: landscape; margin: 8mm; }
  }
</style>
</head>
<body>
<h1>${company} — Payroll ${cutoffLabel}</h1>
<div class="subtitle">${monthName} ${_currentYear} &nbsp;|&nbsp; ${dateRange}</div>

<h2>Section 1 — Timesheet (Hours Worked)</h2>
<table>
  <thead>${tsHead}</thead>
  <tbody>${tsBody}</tbody>
</table>

<h2>Section 2 — Payroll Register</h2>
<table>
  <thead>
    <tr>
      <th>Employee</th>
      <th>Basic Pay</th><th>Hol. Pay</th><th>OT Pay</th><th>Other Inc.</th><th>Incentive</th>
      <th>Gross Pay</th>
      <th>Pag-IBIG</th><th>SSS</th><th>PhilHealth</th><th>Advances</th><th>WTax</th>
      <th>Total Ded.</th><th>Net Pay</th>
    </tr>
  </thead>
  <tbody>${prBody}</tbody>
</table>

<h2>Section 3 — Cutoff Cost Summary</h2>
<table class="summary">
  <tbody>
    <tr><td>Employees</td><td class="num">${employeeCount}</td></tr>
    <tr><td>Gross Pay (salaries expense)</td><td class="num">${p(gGross)}</td></tr>
    <tr><td>Total Deductions</td><td class="num">${p(gDed)}</td></tr>
    <tr><td>Net Pay (cash to employees)</td><td class="num green">${p(gNet)}</td></tr>
    <tr><td>Employer Share (SSS / PhilHealth / Pag-IBIG)</td><td class="num">${p(employerShare)}</td></tr>
    <tr class="total"><td>TOTAL PAYROLL COST (Gross + Employer Share)</td><td class="num bold">${p(gGross + employerShare)}</td></tr>
  </tbody>
</table>

<div class="sig-block">
  <div class="sig-line">Prepared by</div>
  <div class="sig-line">Checked by</div>
  <div class="sig-line">Approved by</div>
</div>
<div class="meta">Generated: ${new Date().toLocaleString()}</div>
</body>
</html>`;

  return {
    period: period,
    cutoffLabel: cutoffLabel,
    dateRange: dateRange,
    monthName: monthName,
    year: _currentYear,
    html: html,
    totals: {
      employeeCount: employeeCount,
      totalRegHours: totReg,
      totalOTHours: totOT,
      /* A259 — the approval record carried no holiday figure at all, so the totals stored against a
         submitted cutoff could not explain their own gross once holidays existed. */
      totalHolidayHours: totHol,
      totalHolidayPay: gHol,
      grossPay: gGross,
      totalDeductions: gDed,
      netPay: gNet,
      employerShare: employerShare,
      totalPayrollCost: gGross + employerShare
    }
  };
}

// ── Philippine statutory computation helpers ──────────────────
/* ── A229 — ONE definition of what an employee earns in a cutoff ────────────────────────────────
 *
 * The earnings arithmetic used to be copy-pasted at five call sites (the payslip, the on-screen grid,
 * the live per-row recompute, the save, and the export/approval snapshot). They agreed, but only by
 * luck — nothing made them agree, and adding a sixth earnings component to five places by hand is how
 * a payslip ends up disagreeing with the PDF it was printed from.
 *
 * ONLY THE EARNINGS HALF IS SHARED. The deduction half is deliberately left at each call site,
 * because those five sites are NOT identical there — they use four different default idioms
 * (`+(saved.advances !== undefined ? … : 0)`, a bare `saved.advances || 0`, and one with no default
 * at all). Folding those together would silently change behaviour while pretending to be a refactor.
 *
 * `statBase` IS THE POINT, not a convenience. SSS and PhilHealth are computed from it, and it EXCLUDES
 * the incentive: a one-off bonus must not drag somebody into a higher SSS bracket. Without it a
 * ₱2,000 bonus would climb four brackets and add roughly ₱230 to that employee's own deductions —
 * they would take home ₱1,770 of their ₱2,000 and nobody would be able to explain why. Confirmed with
 * the director; it is also the ordinary PH treatment, a one-off bonus sitting outside the monthly
 * salary credit. `grossPay` still carries the incentive, so pay, the payslip and the P&L are right.
 */
function _incentiveFor(empName, cutoff) {
  const map = cutoff === 'A' ? _incentivesA : _incentivesB;
  return (map && map[empName]) || 0;
}

/* Build both shapes for one cutoff from the handler's rows: the totals the pay maths reads, and the
   line items behind them. VOIDED ROWS ARE KEPT in the line items and excluded from the totals —
   the history has to show the mistake and the correction, but only live money may be paid. */
function _applyIncentives(cutoff, rows) {
  const totals = {}, byEmp = {};
  (rows || []).forEach(r => {
    const name = String(r.employee || '');
    if (!name) return;
    (byEmp[name] = byEmp[name] || []).push(r);
    if (String(r.status || 'Active') === 'Voided') return;
    totals[name] = (totals[name] || 0) + (parseFloat(r.amount) || 0);
  });
  if (cutoff === 'A') { _incentivesA = totals; _incentiveRowsA = byEmp; }
  else                { _incentivesB = totals; _incentiveRowsB = byEmp; }
}

/* ── Adding one ─────────────────────────────────────────────────────────────────────────────────
   This writes to the ledger IMMEDIATELY, on its own round trip — it is not staged into the register
   payload the way a deduction edit is. That is deliberate: money somebody has been promised should
   not depend on remembering to press "Save Pay" afterwards. */
let _incAddCutoff = 'A';
let _incAddEmp = '';

function openIncentiveAdd(empName, cutoff) {
  _incAddCutoff = cutoff; _incAddEmp = empName;
  document.getElementById('incAddTitle').textContent = 'Add incentive — ' + empName;
  document.getElementById('incAddPeriod').textContent =
    (cutoff === 'A' ? '1st' : '2nd') + ' cutoff · ' + _currentYear + '-' + _currentMonth;
  document.getElementById('incAmount').value = '';
  document.getElementById('incCategory').value = 'Performance Bonus';
  document.getElementById('incReason').value = '';
  document.getElementById('incAddMsg').textContent = '';
  document.getElementById('incAddOverlay').classList.add('open');
  setTimeout(() => { const a = document.getElementById('incAmount'); if (a) a.focus(); }, 50);
}
function closeIncentiveAdd() { document.getElementById('incAddOverlay').classList.remove('open'); }

async function saveIncentiveAdd() {
  const msg = document.getElementById('incAddMsg');
  const amount = parseFloat(document.getElementById('incAmount').value) || 0;
  if (!(amount > 0)) { msg.textContent = 'Enter an amount greater than zero.'; return; }
  const btn = document.getElementById('incSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await apiSavePayrollIncentive({
      period: _currentYear + '-' + _currentMonth + '-' + _incAddCutoff,
      employee: _incAddEmp,
      amount: amount,
      category: document.getElementById('incCategory').value,
      reason: document.getElementById('incReason').value,
      actorName: _eeActor()
    });
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    closeIncentiveAdd();
    await _refreshIncentives(_incAddCutoff);
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Add incentive'; }
  }
}

/** Re-read one cutoff's ledger and repaint that grid. Also refreshes the recent panel. */
async function _refreshIncentives(cutoff) {
  const period = _currentYear + '-' + _currentMonth + '-' + cutoff;
  const res = await apiGetPayrollIncentives({ period: period });
  _applyIncentives(cutoff, (res && res.data) || []);
  renderPayGrid(cutoff);
  if (typeof loadRecentIncentives === 'function') loadRecentIncentives();
}

async function voidIncentive(incentiveId, cutoff) {
  if (!confirm('Void this incentive?\n\nIt stops being paid, but stays in the employee\'s history as a record that it was given and then withdrawn.')) return;
  try {
    const res = await apiVoidPayrollIncentive(incentiveId, _eeActor());
    if (!res || !res.success) throw new Error((res && res.message) || 'Void failed.');
    await _refreshIncentives(cutoff);
    // The open history modal, if any, is re-rendered by its own caller below.
    if (document.getElementById('ihOverlay').classList.contains('open') && _ihEmpName) {
      openIncentiveHistoryByName(_ihEmpName);
    }
  } catch (e) { alert(e.message); }
}

/* A259 — EARNINGS, INCLUDING HOLIDAYS. Walks the cutoff's DATES rather than only the hours rows,
   because a regular holiday nobody worked still has to be paid and has no hours row to find.

     Regular Holiday, worked     hrs x hourly x 2.00
     Regular Holiday, NOT worked          dailyRate  (the entitlement; no hours exist to multiply)
     Special Non-Working, worked  hrs x hourly x 1.30
     Special Non-Working, not     nothing — no work, no pay
     ordinary day                 min(hrs,8) regular, the rest at 1.25

   Hours on a holiday are paid at the flat premium with no 8-hour split, which is what the original
   x2 code did and what the user confirmed. `holidayHrs` and `holidayPay` keep their old meaning as
   the COMBINED totals, so the payslip, the pay grid, the approval snapshot and saveRegister all keep
   working untouched; the breakdown rides alongside for the payslip that wants to name the rates. */
function _payEarnings(emp, cutoff) {
  const empName = emp.lastName + ', ' + emp.firstName;
  const hourlyRate = emp.dailyRate / 8;
  const hoursMap = cutoff === 'A' ? _hoursA : _hoursB;

  /* A260 — A FIXED SALARY IS THE WHOLE EARNING. Hours may still be recorded for attendance and
     simply do not affect pay, and EVERY holiday figure is forced to zero rather than left
     uncomputed: a fixed salary already covers the holiday, so a premium on top would pay it twice,
     and the pay grid and approval document print holidayPay directly. */
  if (_isFixedPay(emp)) {
    const fixed = _fixedAmount(emp);
    /* Attendance is still recorded for a fixed employee, and the payslip must not claim they worked
       nothing. `recordedHrs` is shown in the Hours Worked block and used NOWHERE in the arithmetic —
       reporting 0.0 hrs to someone who worked eight is a false statement on a document they keep. */
    let recordedHrs = 0;
    _buildDateRange(cutoff).forEach(dt => {
      recordedHrs += parseFloat((hoursMap[empName + '|' + dt.dateStr] || {}).hours) || 0;
    });
    const otherIncomeF = cutoff === 'B' ? (emp.otherIncome || 0) : 0;
    const incentiveF = _incentiveFor(empName, cutoff);
    const statBaseF = fixed + otherIncomeF;
    return {
      empName, hourlyRate, regHrs: 0, otHrs: 0, holidayHrs: 0,
      basicPay: fixed, holidayPay: 0, otPay: 0,
      otherIncome: otherIncomeF, incentive: incentiveF,
      regHolHrs: 0, regHolPay: 0, speHolHrs: 0, speHolPay: 0,
      unworkedHolDays: 0, unworkedHolPay: 0,
      isFixed: true, fixedAmount: fixed, recordedHrs,
      statBase: statBaseF,
      grossPay: statBaseF + incentiveF
    };
  }

  let regHrs = 0, otHrs = 0;
  let regHolHrs = 0, regHolPay = 0, speHolHrs = 0, speHolPay = 0;
  let unworkedHolDays = 0, unworkedHolPay = 0;

  _buildDateRange(cutoff).forEach(dt => {
    const entry = hoursMap[empName + '|' + dt.dateStr];
    const hrs = parseFloat((entry || {}).hours) || 0;
    const type = _dayTypeFor(cutoff, dt.dateStr, entry);
    if (type === _HOL_REG) {
      if (hrs > 0) { regHolHrs += hrs; regHolPay += hrs * hourlyRate * _RATE_HOL_REG; }
      else { unworkedHolDays += 1; unworkedHolPay += emp.dailyRate; }
    } else if (type === _HOL_SPE) {
      if (hrs > 0) { speHolHrs += hrs; speHolPay += hrs * hourlyRate * _RATE_HOL_SPE; }
    } else {
      regHrs += Math.min(hrs, 8);
      otHrs  += Math.max(hrs - 8, 0);
    }
  });

  /* A holiday row outside the rendered range would otherwise be dropped silently. There should be
     none — the grid only writes dates it drew — but a stale row from an edited cutoff definition
     must still be paid as ordinary time rather than vanish from the total. */
  const seen = {};
  _buildDateRange(cutoff).forEach(dt => { seen[dt.dateStr] = 1; });
  Object.keys(hoursMap).forEach(key => {
    if (!key.startsWith(empName + '|')) return;
    const d = key.slice(empName.length + 1);
    if (seen[d]) return;
    const hrs = parseFloat(hoursMap[key].hours) || 0;
    regHrs += Math.min(hrs, 8);
    otHrs  += Math.max(hrs - 8, 0);
  });

  const holidayHrs = regHolHrs + speHolHrs;
  const basicPay = regHrs * hourlyRate;
  const holidayPay = regHolPay + speHolPay + unworkedHolPay;
  const otPay = otHrs * hourlyRate * _RATE_OT;
  // Other Income is the STANDING allowance on the employee row, and it is 2nd-cutoff only. Untouched.
  const otherIncome = cutoff === 'B' ? (emp.otherIncome || 0) : 0;
  const incentive = _incentiveFor(empName, cutoff);
  const statBase = basicPay + holidayPay + otPay + otherIncome;
  return {
    empName, hourlyRate, regHrs, otHrs, holidayHrs,
    basicPay, holidayPay, otPay, otherIncome, incentive,
    // A259 — the breakdown behind `holidayPay`, so a payslip can name the rate it actually applied
    regHolHrs, regHolPay, speHolHrs, speHolPay, unworkedHolDays, unworkedHolPay,
    isFixed: false, fixedAmount: 0, recordedHrs: 0,                              // A260
    statBase,                       // what SSS / PhilHealth are computed from — no incentive
    grossPay: statBase + incentive  // what the employee is actually paid
  };
}

/* ── A260 — ONE definition of what is deducted from an employee in a cutoff ─────────────────────
 *
 * This arithmetic was copy-pasted at FOUR call sites — the payslip, the on-screen grid, the register
 * save and the approval snapshot — which is the same shape as the defect A259 had to fix in three
 * places for hours. It is also exactly where the fixed-salary waiver applies, and waiving it in
 * three of four would put a deduction on the payslip that the register does not have.
 *
 * A FIXED-SALARY employee takes no statutory contribution: Pag-IBIG, SSS and PhilHealth are zero.
 * A stored register override for those three is deliberately IGNORED rather than trusted — a figure
 * saved while the employee was still hourly would otherwise keep being deducted after the switch.
 * Withholding tax and cash advances are read exactly as before: an advance is a loan being repaid
 * and tax is a legal obligation, neither of which a pay type changes. */
function _payDeductions(emp, cutoff) {
  const empName = emp.lastName + ', ' + emp.firstName;
  const registerMap = cutoff === 'A' ? _registerA : _registerB;
  const saved = registerMap[empName] || {};
  const advances = +(saved.advances !== undefined ? saved.advances : 0);
  const wtax     = +(saved.wtax     !== undefined ? saved.wtax     : 0);
  if (_isFixedPay(emp)) {
    return { pagibig: 0, sss: 0, philhealth: 0, advances, wtax, totalDed: advances + wtax };
  }
  const e = _payEarnings(emp, cutoff);
  const pagibig    = +(saved.pagibig    !== undefined ? saved.pagibig    : (emp.hdmfAmount || 100));
  const sss        = +(saved.sss        !== undefined ? saved.sss        : _calcSSS(e.statBase));
  const philhealth = +(saved.philhealth !== undefined ? saved.philhealth : _calcPHIC(e.statBase));
  return { pagibig, sss, philhealth, advances, wtax,
           totalDed: pagibig + sss + philhealth + advances + wtax };
}

/** @param monthlyBasic the STATUTORY base (_payEarnings().statBase) — deliberately not gross. */
function _calcSSS(monthlyBasic) {
  // Simplified SSS table (EE share), based on 2023+ table
  const compensation = Math.max(0, monthlyBasic);
  if (compensation < 4250)  return 180;
  if (compensation < 4750)  return 202.50;
  if (compensation < 5250)  return 225;
  if (compensation < 5750)  return 247.50;
  if (compensation < 6250)  return 270;
  if (compensation < 6750)  return 292.50;
  if (compensation < 7250)  return 315;
  if (compensation < 7750)  return 337.50;
  if (compensation < 8250)  return 360;
  if (compensation < 8750)  return 382.50;
  if (compensation < 9250)  return 405;
  if (compensation < 9750)  return 427.50;
  if (compensation < 10250) return 450;
  if (compensation < 10750) return 472.50;
  if (compensation < 11250) return 495;
  if (compensation < 11750) return 517.50;
  if (compensation < 12250) return 540;
  if (compensation < 12750) return 562.50;
  if (compensation < 13250) return 585;
  if (compensation < 13750) return 607.50;
  if (compensation < 14250) return 630;
  if (compensation < 14750) return 652.50;
  if (compensation < 15250) return 675;
  if (compensation < 15750) return 697.50;
  if (compensation < 16250) return 720;
  if (compensation < 16750) return 742.50;
  if (compensation < 17250) return 765;
  if (compensation < 17750) return 787.50;
  if (compensation < 18250) return 810;
  if (compensation < 18750) return 832.50;
  if (compensation < 19250) return 855;
  if (compensation < 19750) return 877.50;
  if (compensation < 20250) return 900;
  return 900; // max for most cases; actual cap may differ
}

function _calcPHIC(monthlyBasic) {
  // PhilHealth: 5% of basic salary, split 50/50 EE and ER
  // Monthly premium = 5% * monthly basic, EE share = half
  const rate = 0.05;
  const monthly = monthlyBasic * rate;
  const ee = monthly / 2;
  // Floor ₱500, cap ₱5000 (monthly total), EE share floor ₱250
  return Math.min(Math.max(ee, 250), 2500);
}

// ── Formatting helpers ────────────────────────────────────────
function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function peso(value) {
  return '₱' + (Number(value) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

// ═══════════════════════════════════════════════════════════════
// 13th Month Pay
// ═══════════════════════════════════════════════════════════════
let _thirteenthData = [];
let _thirteenthYear = null;

function _initThirteenthYearSelector() {
  const sel = document.getElementById('thirteenthYear');
  if (!sel || sel.options.length > 0) return;
  const now = new Date().getFullYear();
  for (let y = now + 1; y >= now - 5; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === now) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function load13thMonth() {
  const sel = document.getElementById('thirteenthYear');
  const year = parseInt(sel ? sel.value : new Date().getFullYear(), 10);
  _thirteenthYear = year;
  const body = document.getElementById('thirteenthBody');
  body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);">Computing 13th month pay…</td></tr>';
  try {
    const res = await fetchFromAPI({ action: 'get13thMonthPay', year: year }, { noCache: true });
    if (!res.success) throw new Error(res.message || 'Failed to compute');
    _thirteenthData = res.data || [];
    render13thMonth();
  } catch (err) {
    body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#ef4444;">' + esc(err.message) + '</td></tr>';
    document.getElementById('thirteenthFoot').innerHTML = '';
  }
}

function render13thMonth() {
  const body = document.getElementById('thirteenthBody');
  const foot = document.getElementById('thirteenthFoot');
  if (!_thirteenthData.length) {
    body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);">No payroll records for ' + _thirteenthYear + '.</td></tr>';
    foot.innerHTML = '';
    return;
  }
  let totalBasic = 0, total13 = 0;
  body.innerHTML = _thirteenthData.map((r, i) => {
    totalBasic += r.totalBasicPay;
    total13    += r.thirteenthMonth;
    const statusCls = (r.status||'').toLowerCase() === 'active'
      ? 'color:#16a34a;font-weight:600;'
      : 'color:#d97706;font-weight:600;';
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td>' + esc(r.lastName) + '</td>' +
      '<td>' + esc(r.firstName) + '</td>' +
      '<td><span style="' + statusCls + '">' + esc(r.status) + '</span></td>' +
      '<td class="num">' + r.monthsWorked + '</td>' +
      '<td class="num">' + r.periodsCount + '</td>' +
      '<td class="num">' + peso(r.totalBasicPay) + '</td>' +
      '<td class="num" style="font-weight:700;color:#16a34a;">' + peso(r.thirteenthMonth) + '</td>' +
      '</tr>';
  }).join('');
  foot.innerHTML = '<tr style="font-weight:700;border-top:2px solid var(--border,#334155);">' +
    '<td colspan="6" style="text-align:right;">TOTAL (' + _thirteenthData.length + ' employees)</td>' +
    '<td class="num">' + peso(totalBasic) + '</td>' +
    '<td class="num" style="color:#16a34a;">' + peso(total13) + '</td>' +
    '</tr>';
}

async function export13thMonthExcel() {
  if (!_thirteenthData.length) { alert('Nothing to export — load a year first.'); return; }
  if (typeof loadXLSX === 'function') await loadXLSX();
  if (typeof XLSX === 'undefined') { alert('Excel library failed to load.'); return; }
  const headers = ['#', 'Last Name', 'First Name', 'Status', 'Months Worked', 'Cutoffs', 'Total Basic Pay (PHP)', '13th Month Pay (PHP)'];
  const rows = _thirteenthData.map((r, i) => [
    i + 1, r.lastName, r.firstName, r.status, r.monthsWorked, r.periodsCount,
    Number(r.totalBasicPay.toFixed(2)), Number(r.thirteenthMonth.toFixed(2))
  ]);
  const totalBasic = _thirteenthData.reduce((s, r) => s + r.totalBasicPay, 0);
  const total13    = _thirteenthData.reduce((s, r) => s + r.thirteenthMonth, 0);
  rows.push(['', '', '', 'TOTAL', '', '', Number(totalBasic.toFixed(2)), Number(total13.toFixed(2))]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '13th Month ' + _thirteenthYear);
  XLSX.writeFile(wb, '13th-month-pay-' + _thirteenthYear + '.xlsx');
}

function print13thMonth() {
  if (!_thirteenthData.length) { alert('Nothing to print — load a year first.'); return; }
  let totalBasic = 0, total13 = 0;
  const rowsHtml = _thirteenthData.map((r, i) => {
    totalBasic += r.totalBasicPay;
    total13    += r.thirteenthMonth;
    return '<tr><td>' + (i+1) + '</td><td>' + esc(r.lastName) + '</td><td>' + esc(r.firstName) + '</td>' +
      '<td>' + esc(r.status) + '</td><td style="text-align:right;">' + r.monthsWorked + '</td>' +
      '<td style="text-align:right;">' + r.periodsCount + '</td>' +
      '<td style="text-align:right;">' + peso(r.totalBasicPay) + '</td>' +
      '<td style="text-align:right;font-weight:700;">' + peso(r.thirteenthMonth) + '</td></tr>';
  }).join('');
  const html = '<!doctype html><html><head><title>13th Month Pay ' + _thirteenthYear + '</title>' +
    '<style>body{font-family:Arial,sans-serif;padding:24px;color:#111;}h1{font-size:1.2rem;margin:0 0 4px;}' +
    'p.sub{margin:0 0 16px;color:#666;font-size:0.85rem;}' +
    'table{width:100%;border-collapse:collapse;font-size:0.85rem;}' +
    'th,td{border:1px solid #999;padding:6px 8px;}th{background:#f1f5f9;text-align:left;}' +
    'tfoot td{font-weight:700;background:#fafafa;}</style></head><body>' +
    '<h1>13th Month Pay — ' + _thirteenthYear + '</h1>' +
    '<p class="sub">Formula: total Basic Pay earned ÷ 12. Inactive/resigned employees prorated automatically.</p>' +
    '<table><thead><tr><th>#</th><th>Last Name</th><th>First Name</th><th>Status</th>' +
    '<th>Months</th><th>Cutoffs</th><th>Total Basic Pay</th><th>13th Month Pay</th></tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody>' +
    '<tfoot><tr><td colspan="6" style="text-align:right;">TOTAL (' + _thirteenthData.length + ' employees)</td>' +
    '<td style="text-align:right;">' + peso(totalBasic) + '</td>' +
    '<td style="text-align:right;">' + peso(total13) + '</td></tr></tfoot></table>' +
    '<script>window.onload=function(){window.print();};<\/script></body></html>';
  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked. Allow pop-ups to print.'); return; }
  win.document.write(html);
  win.document.close();
}
