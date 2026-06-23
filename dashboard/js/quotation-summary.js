/* ═══════════════════════════════════════════════
   quotation-summary.js — Read-only quotation summary display
   ═══════════════════════════════════════════════ */

let session = null;
let allRows = [];

document.addEventListener('DOMContentLoaded', async () => {
  session = requireAuth();
  if (!session) return;

  if (session.role !== 'sales' && session.role !== 'admin') {
    window.location.href = session.role === 'management' ? 'management-home.html' : 'accounting-home.html';
    return;
  }

  renderNavbar('quotation-summary');

  // Show agent filter for admin
  if (session.role === 'admin') {
    document.getElementById('agentFilter').style.display = '';
  }

  await loadSummary();
});

async function loadSummary() {
  const container = document.getElementById('trackerContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  document.getElementById('trackerCount').textContent = '';

  try {
    const agentName = session.role === 'admin' ? '' : session.name;
    const result = await apiGetQuotationSummary(agentName);
    if (!result.success) throw new Error(result.message || 'Failed to load');

    allRows = result.data || [];

    // Populate agent filter (admin)
    if (session.role === 'admin') {
      const select = document.getElementById('agentFilter');
      const agents = [...new Set(allRows.map(r => r.agentName).filter(Boolean))].sort();
      select.length = 1;
      agents.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      });
    }

    // Populate month filter
    const monthSelect = document.getElementById('monthFilter');
    const months = [...new Set(allRows.map(r => r.month).filter(Boolean))].sort().reverse();
    monthSelect.length = 1;
    months.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      monthSelect.appendChild(opt);
    });

    applyFilters();
  } catch (err) {
    console.error('Quotation summary error:', err);
    container.innerHTML = '<div class="no-results"><p>Error: ' + esc(err.message) + '</p></div>';
    updateKPIs([]);
  }
}

function applyFilters() {
  const search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const agent = document.getElementById('agentFilter').value;
  const month = document.getElementById('monthFilter').value;

  const filtered = allRows.filter(r => {
    if (agent && r.agentName !== agent) return false;
    if (month && r.month !== month) return false;
    if (search) {
      const hay = [r.companyName, r.quotationNo, r.prNo, r.product, r.description, r.agentName, r.remarks].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Sort by year desc, then sequential counter (NNN) desc
  filtered.sort((a, b) => {
    const parse = q => {
      const m = String(q || '').match(/^(\d{4})-(\d+)/);
      return m ? [parseInt(m[1]), parseInt(m[2])] : [0, 0];
    };
    const [ay, an] = parse(a.prNo);
    const [by, bn] = parse(b.prNo);
    if (by !== ay) return by - ay;
    return bn - an;
  });

  updateKPIs(filtered);
  renderTable(filtered);
}

function updateKPIs(records) {
  const totalCount = records.length;
  let totalAmount = 0;
  let poCount = 0;
  let totalPOAmount = 0;

  records.forEach(r => {
    totalAmount += Number(r.total) || 0;
    if (r.poNo) {
      poCount++;
      totalPOAmount += Number(r.poAmount) || 0;
    }
  });

  document.getElementById('kpiTotal').textContent = totalCount;
  document.getElementById('kpiAmount').textContent = formatCurrency(totalAmount);
  document.getElementById('kpiPOCount').textContent = poCount;
  document.getElementById('kpiPOAmount').textContent = formatCurrency(totalPOAmount);
}

function renderTable(records) {
  const container = document.getElementById('trackerContainer');
  const countEl = document.getElementById('trackerCount');
  countEl.textContent = 'Showing ' + records.length + ' record' + (records.length !== 1 ? 's' : '');

  if (records.length === 0) {
    container.innerHTML = '<div class="no-results"><p>No records found.</p></div>';
    return;
  }

  const isAdmin = session.role === 'admin';

  let rows = records.map(r => {
    const amount = r.amount ? formatCurrency(r.amount) : '--';
    const total = r.total ? formatCurrency(r.total) : '--';
    const poAmount = r.poAmount ? formatCurrency(r.poAmount) : '--';

    return '<tr>' +
      '<td style="white-space:nowrap">' + esc(r.month) + '</td>' +
      '<td style="white-space:nowrap;color:var(--text-muted)">' + esc(r.dueDate) + '</td>' +
      (isAdmin ? '<td style="font-size:0.78rem;color:var(--text-muted)">' + esc(r.agentName) + '</td>' : '') +
      '<td><strong>' + esc(r.companyName) + '</strong></td>' +
      '<td style="color:var(--text-muted)">' + esc(r.prNo) + '</td>' +
      '<td style="color:var(--text-muted)">' + esc(r.quotationNo) + '</td>' +
      '<td>' + esc(r.product) + '</td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.description) + '">' + esc(r.description) + '</td>' +
      '<td style="white-space:nowrap">' + amount + '</td>' +
      '<td style="white-space:nowrap;font-weight:600">' + total + '</td>' +
      '<td style="color:var(--text-muted)">' + esc(r.poNo) + '</td>' +
      '<td style="white-space:nowrap">' + poAmount + '</td>' +
      '<td style="font-size:0.78rem;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(r.remarks) + '">' + esc(r.remarks) + '</td>' +
      '</tr>';
  }).join('');

  container.innerHTML = '<table class="tracker-table"><thead><tr>' +
    '<th>Month</th><th>Due Date</th>' +
    (isAdmin ? '<th>Agent</th>' : '') +
    '<th>Company</th><th>PR No.</th><th>Quotation No.</th><th>Product</th><th>Description</th>' +
    '<th>Amount</th><th>Total</th><th>PO No.</th><th>PO Amount</th><th>Remarks</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function exportSummaryExcel() {
  if (!allRows.length) return;
  try { await loadXLSX(); } catch (e) { alert('Failed to load Excel library'); return; }

  const isAdmin = session.role === 'admin';
  var headers = ['Month', 'Due Date'];
  if (isAdmin) headers.push('Agent');
  headers = headers.concat(['Company', 'PR No.', 'Quotation No.', 'Product', 'Description', 'Amount', 'Total', 'PO No.', 'PO Amount', 'Remarks']);

  var rows = allRows.map(r => {
    var row = [r.month, r.dueDate];
    if (isAdmin) row.push(r.agentName);
    row = row.concat([r.companyName, r.prNo, r.quotationNo, r.product, r.description, r.amount || '', r.total || '', r.poNo, r.poAmount || '', r.remarks]);
    return row;
  });

  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Quotation Summary');
  XLSX.writeFile(wb, 'quotation-summary-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

// ─── Helpers ───────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatCurrency(val) {
  var n = Number(val);
  if (isNaN(n)) return String(val);
  return '\u20B1' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
