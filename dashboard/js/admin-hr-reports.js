/* ═══════════════════════════════════════════════
   admin-hr-reports.js — Admin viewer for HR daily reports
   ═══════════════════════════════════════════════ */

let reportsData = [];

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;
  renderNavbar('admin-hr-reports');
  setToday();
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('filterDate').value = `${yyyy}-${mm}-${dd}`;
  loadReports();
}

async function loadReports() {
  const container = document.getElementById('reportsContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  const dateInput = document.getElementById('filterDate').value;
  let dateStr = '';
  if (dateInput) {
    const parts = dateInput.split('-');
    dateStr = parts[1] + '/' + parts[2] + '/' + parts[0];
  }

  try {
    const result = await apiGetHRDailyReports(dateStr ? { date: dateStr } : {});
    if (!result.success) throw new Error(result.message || 'Failed');
    reportsData = result.data || [];
    renderReports();
  } catch (err) {
    container.innerHTML = '<div class="no-data">Error: ' + esc(err.message) + '</div>';
  }
}

function renderReports() {
  const container = document.getElementById('reportsContainer');

  if (reportsData.length === 0) {
    container.innerHTML = '<div class="no-data">No HR reports found for this date.</div>';
    return;
  }

  let html = '';
  reportsData.forEach((r, idx) => {
    html += '<div class="hr-report-card">' +
      '<div class="hr-report-header" onclick="toggleReport(' + idx + ')">' +
      '<h4>' + esc(r.hrName) + '</h4>' +
      '<div class="hr-report-meta">' + esc(r.date) + ' &middot; ' + esc(r.submittedAt) + '</div>' +
      '</div>' +
      '<div class="hr-report-body" id="reportBody' + idx + '">';

    html += renderSection('Recruitment Activity', safeParseJSON(r.recruitmentActivity), ['type', 'description', 'notes']);
    html += renderSection('Onboarding Activity', safeParseJSON(r.onboardingActivity), ['employeeName', 'activity', 'status', 'notes']);
    html += renderSection('Employee Administration', safeParseJSON(r.employeeAdmin), ['type', 'description', 'notes']);
    html += renderSection('Marketing Activity', safeParseJSON(r.marketingActivity), ['type', 'description', 'notes']);

    html += '</div></div>';
  });

  container.innerHTML = html;

  // Auto-expand if only one report
  if (reportsData.length === 1) toggleReport(0);
}

function renderSection(title, items, fields) {
  if (!items || items.length === 0) return '';
  let html = '<div class="section-label">' + esc(title) + '</div>';
  items.forEach(item => {
    let parts = [];
    fields.forEach(f => {
      if (item[f]) {
        if (f === 'type' || f === 'activity' || f === 'status') {
          parts.push('<span class="tag">' + esc(item[f]) + '</span>');
        } else if (f === 'employeeName') {
          parts.push('<strong>' + esc(item[f]) + '</strong>');
        } else {
          parts.push(esc(item[f]));
        }
      }
    });
    html += '<div class="activity-item">' + parts.join(' ') + '</div>';
  });
  return html;
}

function safeParseJSON(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}

function toggleReport(idx) {
  const body = document.getElementById('reportBody' + idx);
  if (body) body.classList.toggle('open');
}

async function exportExcel() {
  if (reportsData.length === 0) { alert('No data to export.'); return; }

  await loadXLSX();

  const rows = [['Date', 'HR Name', 'Section', 'Type', 'Description', 'Notes', 'Status', 'Submitted At']];

  reportsData.forEach(r => {
    const sections = [
      { name: 'Recruitment', data: safeParseJSON(r.recruitmentActivity) },
      { name: 'Onboarding', data: safeParseJSON(r.onboardingActivity) },
      { name: 'Employee Admin', data: safeParseJSON(r.employeeAdmin) },
      { name: 'Marketing', data: safeParseJSON(r.marketingActivity) }
    ];

    sections.forEach(sec => {
      sec.data.forEach(item => {
        rows.push([
          r.date, r.hrName, sec.name,
          item.type || item.activity || '',
          item.description || item.employeeName || '',
          item.notes || '',
          item.status || '',
          r.submittedAt
        ]);
      });
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HR Daily Reports');
  XLSX.writeFile(wb, 'HR_Daily_Reports.xlsx');
}
