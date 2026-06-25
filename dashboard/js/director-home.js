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
let _currentYear  = null;
let _currentMonth = null;

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

  // Load hours and register for both cutoffs
  const [hA, hB, rA, rB] = await Promise.all([
    apiGetPayrollHours(periodA),
    apiGetPayrollHours(periodB),
    apiGetPayrollRegister(periodA),
    apiGetPayrollRegister(periodB)
  ]);

  // Build lookup maps
  _hoursA = {};
  (hA.data || []).forEach(r => { _hoursA[r.employee + '|' + r.date] = r; });

  _hoursB = {};
  (hB.data || []).forEach(r => { _hoursB[r.employee + '|' + r.date] = r; });

  _registerA = {};
  (rA.data || []).forEach(r => { _registerA[r.employee] = r; });

  _registerB = {};
  (rB.data || []).forEach(r => { _registerB[r.employee] = r; });

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
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);">No employees. Add one above.</td></tr>';
    return;
  }
  tbody.innerHTML = _employees.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(e.lastName)}</td>
      <td>${esc(e.firstName)}</td>
      <td class="num">${peso(e.dailyRate)}</td>
      <td class="num">${peso(e.hourlyRate)}</td>
      <td class="num">${peso(e.otherIncome)}</td>
      <td class="num">${peso(e.hdmfAmount)}</td>
      <td>${esc(e.status)}</td>
      <td>
        <button class="btn-sm" onclick="openEEModal(${i})">Edit</button>
        <button class="btn-sm danger" onclick="deleteEE(${e.id})">Del</button>
      </td>
    </tr>
  `).join('');
}

// ── EE Modal ──────────────────────────────────────────────────
function openEEModal(idx) {
  const overlay = document.getElementById('eeOverlay');
  if (idx === null) {
    document.getElementById('eeModalTitle').textContent = 'Add Employee';
    document.getElementById('eeEditId').value     = '';
    document.getElementById('eeLastName').value   = '';
    document.getElementById('eeFirstName').value  = '';
    document.getElementById('eeDailyRate').value  = '';
    document.getElementById('eeOtherIncome').value = '';
    document.getElementById('eeHdmf').value       = '';
    document.getElementById('eeStatus').value     = 'Active';
  } else {
    const e = _employees[idx];
    document.getElementById('eeModalTitle').textContent = 'Edit Employee';
    document.getElementById('eeEditId').value     = e.id;
    document.getElementById('eeLastName').value   = e.lastName;
    document.getElementById('eeFirstName').value  = e.firstName;
    document.getElementById('eeDailyRate').value  = e.dailyRate;
    document.getElementById('eeOtherIncome').value = e.otherIncome;
    document.getElementById('eeHdmf').value       = e.hdmfAmount;
    document.getElementById('eeStatus').value     = e.status;
  }
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
    status:      document.getElementById('eeStatus').value
  };
  if (!data.lastName || !data.firstName) { alert('Last name and first name are required.'); return; }
  const res = await apiSavePayrollEmployee(data);
  if (!res.success) { alert('Error: ' + res.message); return; }
  closeEEModal();
  await loadEmployees();
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
function _buildDateRange(cutoff) {
  const year  = _currentYear;
  const month = parseInt(_currentMonth);
  const dates = [];

  if (cutoff === 'A') {
    let prevMonth = month - 1, prevYear = year;
    if (prevMonth === 0) { prevMonth = 12; prevYear--; }
    const daysInPrev = new Date(prevYear, prevMonth, 0).getDate();
    for (let d = 26; d <= daysInPrev; d++) {
      const dt = new Date(prevYear, prevMonth - 1, d);
      dates.push({ label: d + ' ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()],
        dateStr: prevYear + '-' + String(prevMonth).padStart(2,'0') + '-' + String(d).padStart(2,'0'),
        isSunday: dt.getDay() === 0, uniqueKey: 'p' + d });
    }
    for (let d = 1; d <= 10; d++) {
      const dt = new Date(year, month - 1, d);
      dates.push({ label: d + ' ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()],
        dateStr: year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0'),
        isSunday: dt.getDay() === 0, uniqueKey: 'c' + d });
    }
  } else {
    for (let d = 11; d <= 25; d++) {
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
      <span style="font-size:0.73rem;color:var(--text-muted);margin-left:0.5rem;">Enter hours per day (e.g. 8, 8.5, 10). Reg = up to 8hrs, OT = beyond 8hrs. Sundays auto-skip.</span>
    </div>`;

  html += `<table class="pay-table" id="hoursTable${cutoff}">
    <thead><tr>
      <th class="sticky" style="min-width:140px;">Employee</th>`;

  dates.forEach(dt => {
    const style = dt.isSunday ? 'color:#64748b;background:rgba(0,0,0,0.15);' : '';
    html += `<th style="text-align:center;${style}min-width:52px;">${dt.label}</th>`;
  });

  html += `<th class="num" style="min-width:60px;">Reg Hrs</th>
           <th class="num" style="min-width:55px;">OT Hrs</th>
           <th class="num" style="min-width:80px;">Basic Pay</th>
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
      rowRegHrs   += Math.min(hrs, 8);
      rowOTHrs    += Math.max(hrs - 8, 0);
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
    html += `
      <td class="num computed" id="regHrs_${cutoff}_${k}">${rowRegHrs > 0 ? rowRegHrs.toFixed(1) : '—'}</td>
      <td class="num computed" id="otHrs_${cutoff}_${k}">${rowOTHrs > 0 ? rowOTHrs.toFixed(1) : '—'}</td>
      <td class="num computed highlight" id="basicPay_${cutoff}_${k}">${peso(rowRegHrs * hourlyRate)}</td>
      <td class="num computed highlight" id="otPay_${cutoff}_${k}">${rowOTHrs > 0 ? peso(rowOTHrs * hourlyRate * 1.25) : '—'}</td>
      <td><button class="btn-sm" onclick="fillRowHours('${cutoff}','${esc(empName)}',8)" style="font-size:0.7rem;padding:0.2rem 0.5rem;">8h</button></td>
    </tr>`;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function _empKey(name) {
  return name.replace(/[^a-z0-9]/gi, '_');
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
  const hourlyRate = emp.dailyRate / 8;
  const hoursMap   = cutoff === 'A' ? _hoursA : _hoursB;

  let regHrs = 0, otHrs = 0;
  Object.keys(hoursMap).forEach(key => {
    if (!key.startsWith(empName + '|')) return;
    const hrs = parseFloat(hoursMap[key].hours) || 0;
    regHrs += Math.min(hrs, 8);
    otHrs  += Math.max(hrs - 8, 0);
  });

  const k  = _empKey(empName);
  const rh = document.getElementById(`regHrs_${cutoff}_${k}`);
  const oh = document.getElementById(`otHrs_${cutoff}_${k}`);
  const bp = document.getElementById(`basicPay_${cutoff}_${k}`);
  const op = document.getElementById(`otPay_${cutoff}_${k}`);

  if (rh) rh.textContent = regHrs > 0 ? regHrs.toFixed(1) : '—';
  if (oh) oh.textContent = otHrs  > 0 ? otHrs.toFixed(1)  : '—';
  if (bp) bp.textContent = peso(regHrs * hourlyRate);
  if (op) op.textContent = otHrs > 0 ? peso(otHrs * hourlyRate * 1.25) : '—';
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
      <th class="num">Gross Pay</th>
      <th class="num">Pag-IBIG</th>
      <th class="num">SSS</th>
      <th class="num">PhilHealth</th>
      <th class="num">Advances</th>
      <th class="num">WTax</th>
      <th class="num">Total Ded.</th>
      <th class="num highlight">Net Pay</th>
    </tr></thead>
    <tbody>`;

  let totBasic=0, totHol=0, totOT=0, totOther=0, totGross=0,
      totPag=0, totSSS=0, totPHIC=0, totAdv=0, totWTax=0, totDed=0, totNet=0;

  activeEE.forEach(emp => {
    const empName = emp.lastName + ', ' + emp.firstName;
    const hourlyRate = emp.dailyRate / 8;

    // Compute from hours
    let regHrs = 0, otHrs = 0, holidayHrs = 0;
    Object.keys(hoursMap).forEach(key => {
      if (!key.startsWith(empName + '|')) return;
      const entry = hoursMap[key];
      const hrs = parseFloat(entry.hours) || 0;
      if (entry.dayType === 'Holiday') {
        holidayHrs += hrs;
      } else {
        regHrs += Math.min(hrs, 8);
        otHrs  += Math.max(hrs - 8, 0);
      }
    });

    const basicPay   = regHrs * hourlyRate;
    const holidayPay = holidayHrs * hourlyRate * 2; // double time
    const otPay      = otHrs * hourlyRate * 1.25;
    // Other income only in 2nd cutoff (PAY B) per payroll convention
    const otherIncome = cutoff === 'B' ? (emp.otherIncome || 0) : 0;
    const grossPay   = basicPay + holidayPay + otPay + otherIncome;

    // Statutory deductions — use stored overrides if present
    const saved = registerMap[empName] || {};
    const pagibig    = saved.pagibig    !== undefined ? saved.pagibig    : (emp.hdmfAmount || 100);
    const sss        = saved.sss        !== undefined ? saved.sss        : _calcSSS(grossPay);
    const philhealth = saved.philhealth !== undefined ? saved.philhealth : _calcPHIC(grossPay);
    const advances   = saved.advances   !== undefined ? saved.advances   : 0;
    const wtax       = saved.wtax       !== undefined ? saved.wtax       : 0;

    const totalDed = pagibig + sss + philhealth + advances + wtax;
    const netPay   = grossPay - totalDed;

    totBasic += basicPay; totHol += holidayPay; totOT += otPay; totOther += otherIncome;
    totGross += grossPay; totPag += pagibig; totSSS += sss; totPHIC += philhealth;
    totAdv += advances; totWTax += wtax; totDed += totalDed; totNet += netPay;

    const k = _empKey(empName);

    html += `<tr data-emp="${esc(empName)}">
      <td class="sticky"><strong>${esc(empName)}</strong></td>
      <td class="num computed">${peso(basicPay)}</td>
      <td class="num computed">${peso(holidayPay)}</td>
      <td class="num computed">${peso(otPay)}</td>
      <td class="num computed">${peso(otherIncome)}</td>
      <td class="num computed highlight">${peso(grossPay)}</td>
      <td class="num"><input type="number" min="0" step="0.01" value="${pagibig.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="pagibig" onchange="_updateRegCell(this)" style="width:75px;"></td>
      <td class="num"><input type="number" min="0" step="0.01" value="${sss.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="sss" onchange="_updateRegCell(this)" style="width:75px;"></td>
      <td class="num"><input type="number" min="0" step="0.01" value="${philhealth.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="philhealth" onchange="_updateRegCell(this)" style="width:75px;"></td>
      <td class="num"><input type="number" min="0" step="0.01" value="${advances.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="advances" onchange="_updateRegCell(this)" style="width:75px;"></td>
      <td class="num"><input type="number" min="0" step="0.01" value="${wtax.toFixed(2)}" data-emp="${esc(empName)}" data-cutoff="${cutoff}" data-field="wtax" onchange="_updateRegCell(this)" style="width:75px;"></td>
      <td class="num computed" id="totalDed_${cutoff}_${k}">${peso(totalDed)}</td>
      <td class="num highlight" id="netPay_${cutoff}_${k}">${peso(netPay)}</td>
    </tr>`;
  });

  html += `<tr class="total-row">
    <td class="sticky">TOTAL</td>
    <td class="num">${peso(totBasic)}</td>
    <td class="num">${peso(totHol)}</td>
    <td class="num">${peso(totOT)}</td>
    <td class="num">${peso(totOther)}</td>
    <td class="num">${peso(totGross)}</td>
    <td class="num">${peso(totPag)}</td>
    <td class="num">${peso(totSSS)}</td>
    <td class="num">${peso(totPHIC)}</td>
    <td class="num">${peso(totAdv)}</td>
    <td class="num">${peso(totWTax)}</td>
    <td class="num">${peso(totDed)}</td>
    <td class="num">${peso(totNet)}</td>
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

  const hourlyRate = emp.dailyRate / 8;
  const hoursMap   = cutoff === 'A' ? _hoursA : _hoursB;
  let regHrs = 0, otHrs = 0, holidayHrs = 0;
  Object.keys(hoursMap).forEach(key => {
    if (!key.startsWith(empName + '|')) return;
    const entry = hoursMap[key];
    const hrs = parseFloat(entry.hours) || 0;
    if (entry.dayType === 'Holiday') holidayHrs += hrs;
    else { regHrs += Math.min(hrs, 8); otHrs += Math.max(hrs - 8, 0); }
  });

  const basicPay   = regHrs * hourlyRate;
  const holidayPay = holidayHrs * hourlyRate * 2;
  const otPay      = otHrs * hourlyRate * 1.25;
  const otherIncome = cutoff === 'B' ? (emp.otherIncome || 0) : 0;
  const grossPay   = basicPay + holidayPay + otPay + otherIncome;

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
    const empName = emp.lastName + ', ' + emp.firstName;
    const hourlyRate = emp.dailyRate / 8;

    let regHrs = 0, otHrs = 0, holidayHrs = 0;
    Object.keys(hoursMap).forEach(key => {
      if (!key.startsWith(empName + '|')) return;
      const entry = hoursMap[key];
      const hrs = parseFloat(entry.hours) || 0;
      if (entry.dayType === 'Holiday') holidayHrs += hrs;
      else { regHrs += Math.min(hrs, 8); otHrs += Math.max(hrs - 8, 0); }
    });

    const basicPay   = regHrs * hourlyRate;
    const holidayPay = holidayHrs * hourlyRate * 2;
    const otPay      = otHrs * hourlyRate * 1.25;
    const otherIncome = cutoff === 'B' ? (emp.otherIncome || 0) : 0;
    const saved = registerMap[empName] || {};

    return {
      employee:    empName,
      basicPay:    basicPay,
      holidayPay:  holidayPay,
      otPay:       otPay,
      otherIncome: otherIncome,
      pagibig:     saved.pagibig    !== undefined ? saved.pagibig    : (emp.hdmfAmount || 100),
      sss:         saved.sss        !== undefined ? saved.sss        : _calcSSS(basicPay + otPay + otherIncome),
      philhealth:  saved.philhealth !== undefined ? saved.philhealth : _calcPHIC(basicPay + otPay + otherIncome),
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
function exportCutoff(cutoff) {
  var built = _buildCutoffHtml(cutoff);
  if (!built) return;
  var html = built.html.replace('</body>', '<script>window.onload = function(){ window.print(); }<\/script></body>');
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
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

  let tsHead = `<tr><th>Employee</th>`;
  dates.forEach(dt => { tsHead += `<th${dt.isSunday ? ' class="sun"' : ''}>${dt.label}</th>`; });
  tsHead += `<th>Reg Hrs</th><th>OT Hrs</th><th>Basic Pay</th><th>OT Pay</th></tr>`;

  let tsBody = '';
  let totReg = 0, totOT = 0, totBasic = 0, totOTPay = 0;

  _employees.forEach(emp => {
    const empName    = emp.lastName + ', ' + emp.firstName;
    const hourlyRate = emp.dailyRate / 8;
    let regHrs = 0, otHrs = 0;

    let row = `<tr><td class="name">${empName}</td>`;
    dates.forEach(dt => {
      const key  = empName + '|' + dt.dateStr;
      const hrs  = parseFloat((hoursMap[key] || {}).hours) || 0;
      regHrs    += Math.min(hrs, 8);
      otHrs     += Math.max(hrs - 8, 0);
      row       += dt.isSunday
        ? `<td class="sun">—</td>`
        : `<td class="num">${hrs > 0 ? hrs : ''}</td>`;
    });
    const basic = regHrs * hourlyRate;
    const otPay = otHrs  * hourlyRate * 1.25;
    totReg   += regHrs; totOT    += otHrs;
    totBasic += basic;  totOTPay += otPay;
    row += `<td class="num">${regHrs > 0 ? regHrs.toFixed(1) : '—'}</td>
            <td class="num">${otHrs  > 0 ? otHrs.toFixed(1)  : '—'}</td>
            <td class="num">${p(basic)}</td>
            <td class="num">${otHrs > 0 ? p(otPay) : '—'}</td></tr>`;
    tsBody += row;
  });

  tsBody += `<tr class="total">
    <td colspan="${dates.length + 1}">TOTAL</td>
    <td class="num">${totReg.toFixed(1)}</td>
    <td class="num">${totOT.toFixed(1)}</td>
    <td class="num">${p(totBasic)}</td>
    <td class="num">${totOTPay > 0 ? p(totOTPay) : '—'}</td>
  </tr>`;

  let prBody = '';
  let gBasic=0,gHol=0,gOT=0,gOther=0,gGross=0,gPag=0,gSSS=0,gPHIC=0,gAdv=0,gWTax=0,gDed=0,gNet=0;
  let employeeCount = 0;

  _employees.forEach(emp => {
    const empName    = emp.lastName + ', ' + emp.firstName;
    const hourlyRate = emp.dailyRate / 8;
    let regHrs=0, otHrs=0, holidayHrs=0;

    Object.keys(hoursMap).forEach(key => {
      if (!key.startsWith(empName + '|')) return;
      const entry = hoursMap[key];
      const hrs   = parseFloat(entry.hours) || 0;
      if (entry.dayType === 'Holiday') holidayHrs += hrs;
      else { regHrs += Math.min(hrs,8); otHrs += Math.max(hrs-8,0); }
    });

    const basicPay    = regHrs * hourlyRate;
    const holidayPay  = holidayHrs * hourlyRate * 2;
    const otPay       = otHrs * hourlyRate * 1.25;
    const otherIncome = cutoff === 'B' ? (emp.otherIncome || 0) : 0;
    const grossPay    = basicPay + holidayPay + otPay + otherIncome;
    const saved       = registerMap[empName] || {};
    const pagibig     = saved.pagibig    !== undefined ? saved.pagibig    : (emp.hdmfAmount || 100);
    const sss         = saved.sss        !== undefined ? saved.sss        : _calcSSS(grossPay);
    const philhealth  = saved.philhealth !== undefined ? saved.philhealth : _calcPHIC(grossPay);
    const advances    = saved.advances   || 0;
    const wtax        = saved.wtax       || 0;
    const totalDed    = pagibig + sss + philhealth + advances + wtax;
    const netPay      = grossPay - totalDed;

    employeeCount++;
    gBasic+=basicPay; gHol+=holidayPay; gOT+=otPay; gOther+=otherIncome;
    gGross+=grossPay; gPag+=pagibig; gSSS+=sss; gPHIC+=philhealth;
    gAdv+=advances; gWTax+=wtax; gDed+=totalDed; gNet+=netPay;

    prBody += `<tr>
      <td class="name">${empName}</td>
      <td class="num">${p(basicPay)}</td>
      <td class="num">${holidayPay > 0 ? p(holidayPay) : '—'}</td>
      <td class="num">${otPay > 0 ? p(otPay) : '—'}</td>
      <td class="num">${otherIncome > 0 ? p(otherIncome) : '—'}</td>
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
      <th>Basic Pay</th><th>Hol. Pay</th><th>OT Pay</th><th>Other Inc.</th>
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
      grossPay: gGross,
      totalDeductions: gDed,
      netPay: gNet,
      employerShare: employerShare,
      totalPayrollCost: gGross + employerShare
    }
  };
}

// ── Philippine statutory computation helpers ──────────────────
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
    .replace(/"/g, '&quot;');
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
