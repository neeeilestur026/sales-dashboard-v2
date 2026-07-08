/* mro-queue.js — Admin MRO Queue (read-only) */
let mroData = [];

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAccountingOrAdmin();
  if (!session) return;
  renderNavbar('mro-queue');
  await loadMROs();
});

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

async function loadMROs() {
  try {
    const result = await fetchFromAPI({ action: 'getAllMROs' });
    if (!result.success) throw new Error(result.message);
    mroData = result.data || [];
    renderFiltered();
  } catch (err) {
    document.getElementById('queueContainer').innerHTML = '<div style="color:#ef4444;padding:1rem;">Error: ' + esc(err.message) + '</div>';
  }
}

function renderFiltered() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const range = document.getElementById('dateRange') ? document.getElementById('dateRange').value : 'all';

  const filtered = mroData.filter(r => {
    if (range !== 'all') {
      const d = new Date(r.receivingDate);
      if (isNaN(d)) return false;
      const cutoff = new Date();
      if (range === '7d') cutoff.setDate(cutoff.getDate() - 7);
      else if (range === '30d') cutoff.setDate(cutoff.getDate() - 30);
      else if (range === '90d') cutoff.setDate(cutoff.getDate() - 90);
      else if (range === 'year') { cutoff.setMonth(0); cutoff.setDate(1); }
      if (d < cutoff) return false;
    }
    if (q) {
      return (r.vendorName||'').toLowerCase().includes(q) ||
        (r.salesInvoice||'').toLowerCase().includes(q) ||
        (r.modelNo||'').toLowerCase().includes(q) ||
        (r.purchaseOrderNo||'').toLowerCase().includes(q) ||
        (r.receivedBy||'').toLowerCase().includes(q);
    }
    return true;
  });
  renderTable(filtered);
}

function renderTable(data) {
  const container = document.getElementById('queueContainer');
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No MRO records found.</div>';
    return;
  }

  let html = '<table class="queue-table"><thead><tr>' +
    '<th>Date</th><th>Vendor</th><th>Invoice</th><th>PO No.</th><th>Model</th><th>Description</th><th>Qty</th><th>Received By</th><th>PDF</th>' +
    '</tr></thead><tbody>';

  data.forEach(r => {
    html += '<tr>' +
      '<td style="white-space:nowrap;">' + esc(r.receivingDate) + '</td>' +
      '<td><strong>' + esc(r.vendorName) + '</strong></td>' +
      '<td>' + esc(r.salesInvoice) + '</td>' +
      '<td>' + esc(r.purchaseOrderNo) + '</td>' +
      '<td>' + esc(r.modelNo) + '</td>' +
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(r.itemDescription) + '</td>' +
      '<td style="text-align:center;">' + esc(String(r.quantity)) + '</td>' +
      '<td>' + esc(r.receivedBy) + '</td>' +
      '<td>' + (r.driveLink ? '<a href="' + esc(r.driveLink) + '" target="_blank" style="color:#3b82f6;">View</a>' : '—') + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem;">' + data.length + ' record(s)</div>' + html;
}
