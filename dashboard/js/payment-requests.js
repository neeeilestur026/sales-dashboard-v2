/* ═══════════════════════════════════════════════
   payment-requests.js — Payment Request History
   ═══════════════════════════════════════════════ */

let prData = [];
let filteredPR = [];
let prSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  const session = (() => {
    const s = getSession();
    if (!s) { window.location.href = 'index.html'; return null; }
    if (!['admin', 'accounting', 'management', 'director'].includes(s.role)) { window.location.href = _homeForRole(s.role); return null; }
    return s;
  })();
  if (!session) return;
  prSession = session;
  renderNavbar('payment-requests');
  await loadPaymentRequests();
});

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const CURRENCY_SYMBOLS = {
  PHP: '₱', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  SGD: 'S$', AUD: 'A$', CAD: 'C$', HKD: 'HK$', CNY: '¥',
  KRW: '₩', INR: '₹', MYR: 'RM ', THB: '฿', IDR: 'Rp ',
  VND: '₫', TWD: 'NT$', BND: 'B$',
};

// FX rates → PHP (updated 2026-05-04, source: Google Finance)
const PR_FX_TO_PHP = {
  PHP: 1, USD: 61.47, EUR: 72.11, GBP: 83.54, JPY: 0.3921, SGD: 48.29, AUD: 44.30, CAD: 45.24,
  HKD: 7.85, CNY: 9.00, KRW: 0.0419, INR: 0.6478, MYR: 15.54, THB: 1.8953,
  IDR: 0.0035, VND: 0.0023, TWD: 1.9456, BND: 48.19
};

function toPHP(amount, currency) {
  var n = parseFloat(amount) || 0;
  var rate = PR_FX_TO_PHP[(currency || 'PHP').toUpperCase()];
  return n * (rate || 1);
}

function formatAmount(n, currency) {
  if (n === undefined || n === null || n === '') return '--';
  var sym = CURRENCY_SYMBOLS[(currency || 'PHP').toUpperCase()] || ((currency || 'PHP') + ' ');
  return sym + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function peso(n) {
  return formatAmount(n, 'PHP');
}

async function loadPaymentRequests() {
  const container = document.getElementById('prContainer');
  container.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';

  try {
    const result = await fetchFromAPI({ action: 'getPaymentRequests' });
    if (!result.success) throw new Error(result.message || 'Failed');
    prData = result.data || [];
    filterRequests();
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#ef4444;">Error: ' + esc(err.message) + '</div>';
  }
}

function updateKPIs(rows) {
  const src = rows || prData;
  let totalAmt = 0, pending = 0, approved = 0;
  src.forEach(r => {
    totalAmt += toPHP(r.amount, r.currency);
    const status = (r.status || 'Pending').toLowerCase();
    const billing = (r.billingStatus || '').toLowerCase();
    if (billing === 'paid' || status === 'paid' || status === 'approved') approved++;
    else if (status === 'pending') pending++;
  });
  document.getElementById('totalRequests').textContent = src.length;
  document.getElementById('pendingCount').textContent = pending;
  document.getElementById('approvedCount').textContent = approved;
  document.getElementById('totalAmount').textContent = peso(totalAmt);

  // Reflect month filter on the "Total Amount" label so the value isn't ambiguous
  const monthEl = document.getElementById('monthFilter');
  const monthLabel = document.getElementById('totalAmountLabel');
  if (monthLabel) {
    if (monthEl && monthEl.value) {
      const [y, m] = monthEl.value.split('-');
      const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-PH', { month: 'long', year: 'numeric' });
      monthLabel.textContent = 'Total Amount · ' + monthName;
    } else {
      monthLabel.textContent = 'Total Amount (All Time)';
    }
  }
}

function filterRequests() {
  const search = (document.getElementById('prSearch').value || '').trim().toLowerCase();
  const range = document.getElementById('dateRange') ? document.getElementById('dateRange').value : 'all';
  const tab = document.getElementById('archiveFilter') ? document.getElementById('archiveFilter').value : 'all';
  const monthVal = document.getElementById('monthFilter') ? document.getElementById('monthFilter').value : ''; // "YYYY-MM"

  const ARCHIVE = ['Approved', 'Paid', 'Rejected'];

  filteredPR = prData.filter(r => {
    const d = new Date(r.requestDate);
    if (monthVal) {
      if (isNaN(d)) return false;
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (ym !== monthVal) return false;
    } else if (range !== 'all') {
      if (isNaN(d)) return false;
      const cutoff = new Date();
      if (range === '7d') cutoff.setDate(cutoff.getDate() - 7);
      else if (range === '30d') cutoff.setDate(cutoff.getDate() - 30);
      else if (range === '90d') cutoff.setDate(cutoff.getDate() - 90);
      else if (range === 'year') { cutoff.setMonth(0); cutoff.setDate(1); }
      if (d < cutoff) return false;
    }
    if (tab === 'active') {
      if (ARCHIVE.includes(r.status)) return false;
    } else if (tab === 'archive') {
      if (!ARCHIVE.includes(r.status)) return false;
    }
    if (!search) return true;
    const haystack = (r.payeeName + ' ' + r.prNumber + ' ' + r.requestedBy + ' ' + r.purpose).toLowerCase();
    return haystack.indexOf(search) !== -1;
  });
  document.getElementById('prCount').textContent = filteredPR.length + ' request' + (filteredPR.length !== 1 ? 's' : '');
  updateKPIs(filteredPR);
  renderTable(filteredPR);
}

async function updatePRStatus(rowIndex, decision) {
  try {
    var role = prSession ? prSession.role : 'admin';
    const result = await fetchFromAPI({
      action: 'updatePaymentRequestStatus',
      rowIndex: String(rowIndex),
      approverRole: role,
      decision: decision
    });
    if (!result.success) throw new Error(result.message);
    clearApiCache();
    await loadPaymentRequests();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function _pickBankAccountForPR(payeeName, defaultMatch) {
  let accounts = [];
  try {
    const res = await apiGetBankAccounts();
    accounts = (res && (res.data || res.accounts || [])) || [];
  } catch (e) {
    alert('Could not load bank accounts: ' + e.message);
    return null;
  }
  accounts = accounts.filter(a => a && a.code);
  if (!accounts.length) { alert('No bank accounts configured.'); return null; }

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const defaultCode = (accounts.find(a => new RegExp(defaultMatch || 'AUB', 'i').test(a.code)) || accounts[0]).code;
    const optsHtml = accounts.map(a => {
      const bal = (a.currentBalance != null ? a.currentBalance : a.balance) || 0;
      const sel = a.code === defaultCode ? ' selected' : '';
      return `<option value="${a.code}"${sel}>${a.name || a.code} (bal: ${peso(bal)})</option>`;
    }).join('');
    overlay.innerHTML = `
      <div style="background:#fff;color:#0f172a;border-radius:12px;padding:1.25rem 1.4rem;min-width:340px;max-width:92vw;box-shadow:0 20px 40px rgba(0,0,0,0.25);">
        <div style="font-weight:700;font-size:1.05rem;margin-bottom:0.5rem;">Mark PR as Paid</div>
        <div style="color:#475569;font-size:0.88rem;margin-bottom:0.9rem;">Choose the bank account to debit for ${payeeName ? '<b>' + payeeName + '</b>' : 'this payee'}.</div>
        <label style="display:block;font-size:0.78rem;font-weight:600;color:#334155;margin-bottom:0.3rem;">Bank Account</label>
        <select id="_prBankSel" style="width:100%;padding:0.45rem 0.55rem;border:1px solid #cbd5e1;border-radius:6px;font-size:0.9rem;margin-bottom:1rem;">${optsHtml}</select>
        <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
          <button id="_prBankCancel" style="padding:0.45rem 0.9rem;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;">Cancel</button>
          <button id="_prBankOk" style="padding:0.45rem 1rem;border:none;background:#16a34a;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;">Confirm Pay</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = (val) => { document.body.removeChild(overlay); resolve(val); };
    overlay.querySelector('#_prBankCancel').onclick = () => cleanup(null);
    overlay.querySelector('#_prBankOk').onclick = () => cleanup(overlay.querySelector('#_prBankSel').value);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
  });
}

async function markPRPaid(rowIndex, payeeName) {
  const bankAccountCode = await _pickBankAccountForPR(payeeName, 'AUB');
  if (!bankAccountCode) return;
  try {
    var paidBy = prSession ? (prSession.name || prSession.fullName || prSession.role || '') : '';
    console.log('[markPRPaid] calling markBillPaid', { rowIndex, paidBy, bankAccountCode });
    const result = await fetchFromAPI({
      action: 'markBillPaid',
      rowIndex: String(rowIndex),
      paidBy: paidBy,
      bankAccountCode: bankAccountCode
    });
    console.log('[markPRPaid] response', result);
    if (!result || !result.success) {
      throw new Error((result && result.message) || 'Server did not return success');
    }
    clearApiCache();
    await loadPaymentRequests();
    alert('Marked as Paid.');
  } catch (err) {
    console.error('[markPRPaid] failed', err);
    alert('Could not mark as paid: ' + err.message + '\n\nIf this says "Unknown action", the Apps Script web app needs to be redeployed.');
  }
}

function renderTable(data) {
  const container = document.getElementById('prContainer');
  if (data.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted,#64748b);">No payment requests found.</div>';
    return;
  }

  let html = '<table class="pr-table"><thead><tr>' +
    '<th>PR #</th><th>Date</th><th>Requested By</th><th>Payee</th><th>Amount</th><th>Method</th><th>Priority</th><th>Admin</th><th>Mgmt</th><th>Status</th><th>Billing</th><th>Action</th>' +
    '</tr></thead><tbody>';

  data.forEach((r, idx) => {
    const billing = r.billingStatus || 'Unpaid';
    const isPaid = billing.toLowerCase() === 'paid';
    const status = isPaid ? 'Paid' : (r.status || 'Pending');
    const statusCls = status.toLowerCase() === 'paid' ? 'st-paid' : status.toLowerCase() === 'approved' ? 'st-approved' : status.toLowerCase() === 'rejected' ? 'st-rejected' : 'st-pending';
    const priorityCls = (r.priority || '').toLowerCase() === 'urgent' ? 'color:#ef4444;font-weight:700;' : '';
    const adminA = r.adminApproval || 'Pending';
    const mgmtA = r.mgmtApproval || 'Pending';
    const adminCls = adminA === 'Approved' ? 'st-approved' : adminA === 'Rejected' ? 'st-rejected' : 'st-pending';
    const mgmtCls = mgmtA === 'Approved' ? 'st-approved' : mgmtA === 'Rejected' ? 'st-rejected' : 'st-pending';
    const billingCls = isPaid ? 'st-paid' : 'st-pending';
    const paidMeta = isPaid && (r.paidAt || r.paidBy)
      ? '<div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">' + esc((r.paidAt || '').slice(0, 10)) + (r.paidBy ? ' · ' + esc(r.paidBy) : '') + '</div>'
      : '';

    // Determine if current user can approve or mark paid
    var canApprove = false;
    var canMarkPaid = false;
    if (prSession) {
      if ((prSession.role === 'admin' || prSession.role === 'accounting') && adminA === 'Pending') canApprove = true;
      if (prSession.role === 'management' && mgmtA === 'Pending') canApprove = true;
      if (prSession.role === 'director' && !isPaid) canMarkPaid = true;
    }

    var actionHtml = '';
    if (prSession && prSession.role === 'director') {
      if (canMarkPaid) {
        actionHtml = '<button class="pr-mark-paid-btn" data-row-index="' + r.rowIndex + '" data-payee="' + esc(r.payeeName) + '" style="background:rgba(34,197,94,0.18);color:#16a34a;border:none;border-radius:4px;padding:0.25rem 0.6rem;font-size:0.72rem;font-weight:700;cursor:pointer;">Mark Paid</button>';
      } else {
        actionHtml = '<span style="font-size:0.72rem;color:#16a34a;font-weight:600;">✓ Paid</span>';
      }
    } else if (canApprove) {
      actionHtml = '<button onclick="event.stopPropagation();updatePRStatus(' + r.rowIndex + ',\'Approved\')" style="background:rgba(34,197,94,0.15);color:#22c55e;border:none;border-radius:4px;padding:0.2rem 0.5rem;font-size:0.72rem;font-weight:700;cursor:pointer;margin-right:0.25rem;">Approve</button>' +
        '<button onclick="event.stopPropagation();updatePRStatus(' + r.rowIndex + ',\'Rejected\')" style="background:rgba(239,68,68,0.15);color:#ef4444;border:none;border-radius:4px;padding:0.2rem 0.5rem;font-size:0.72rem;font-weight:700;cursor:pointer;">Reject</button>';
    } else {
      actionHtml = '<span style="font-size:0.72rem;color:var(--text-muted);">—</span>';
    }

    html += '<tr onclick="openPreview(' + idx + ')" style="cursor:pointer;" title="Click to preview">' +
      '<td><strong>' + esc(r.prNumber) + '</strong></td>' +
      '<td style="white-space:nowrap;">' + esc(r.requestDate) + '</td>' +
      '<td>' + esc(r.requestedBy) + '</td>' +
      '<td><strong>' + esc(r.payeeName) + '</strong></td>' +
      '<td style="font-weight:600;color:var(--accent,#f97316);">' + formatAmount(r.amount, r.currency) + '</td>' +
      '<td>' + esc(r.paymentMethod) + '</td>' +
      '<td style="' + priorityCls + '">' + esc(r.priority || 'Normal') + '</td>' +
      '<td><span class="' + adminCls + '" style="font-size:0.72rem;">' + esc(adminA) + '</span></td>' +
      '<td><span class="' + mgmtCls + '" style="font-size:0.72rem;">' + esc(mgmtA) + '</span></td>' +
      '<td><span class="' + statusCls + '">' + esc(status) + '</span></td>' +
      '<td><span class="' + billingCls + '" style="font-size:0.72rem;">' + esc(billing) + '</span>' + paidMeta + '</td>' +
      '<td>' + actionHtml + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── Preview Modal ──────────────────────────────

function extractDriveFileId(url) {
  if (!url) return null;
  var match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function openPreview(idx) {
  var r = filteredPR[idx];
  if (!r) return;

  document.getElementById('previewTitle').textContent = 'Payment Request: ' + (r.prNumber || 'Preview');

  var adminA = r.adminApproval || 'Pending';
  var mgmtA = r.mgmtApproval || 'Pending';
  var billing = r.billingStatus || 'Unpaid';
  var isPaidPv = billing.toLowerCase() === 'paid';
  var status = isPaidPv ? 'Paid' : (r.status || 'Pending');
  var adminCls = adminA === 'Approved' ? 'st-approved' : adminA === 'Rejected' ? 'st-rejected' : 'st-pending';
  var mgmtCls = mgmtA === 'Approved' ? 'st-approved' : mgmtA === 'Rejected' ? 'st-rejected' : 'st-pending';
  var statusCls = status.toLowerCase() === 'paid' ? 'st-paid' : status.toLowerCase() === 'approved' ? 'st-approved' : status.toLowerCase() === 'rejected' ? 'st-rejected' : 'st-pending';

  document.getElementById('previewDetails').innerHTML =
    '<div class="dl"><span class="dl-label">PR Number</span><span class="dl-value">' + esc(r.prNumber) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Request Date</span><span class="dl-value">' + esc(r.requestDate) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Requested By</span><span class="dl-value">' + esc(r.requestedBy) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Department</span><span class="dl-value">' + esc(r.department) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Purpose</span><span class="dl-value">' + esc(r.purpose) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Priority</span><span class="dl-value">' + esc(r.priority || 'Normal') + '</span></div>' +
    '<hr style="border:none;border-top:1px solid var(--border,#334155);margin:0.75rem 0;">' +
    '<div class="dl"><span class="dl-label">Payee</span><span class="dl-value" style="font-weight:700;">' + esc(r.payeeName) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Payee Type</span><span class="dl-value">' + esc(r.payeeType) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Amount</span><span class="dl-value" style="font-weight:700;font-size:1rem;">' + formatAmount(r.amount, r.currency) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Currency</span><span class="dl-value">' + esc(r.currency) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Payment Method</span><span class="dl-value">' + esc(r.paymentMethod) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Due Date</span><span class="dl-value">' + esc(r.dueDate) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Bank</span><span class="dl-value">' + esc((r.bankName || '') + ' ' + (r.bankBranch || '')).trim() + '</span></div>' +
    '<div class="dl"><span class="dl-label">Account</span><span class="dl-value">' + esc(r.accountName) + ' — ' + esc(r.accountNumber) + '</span></div>' +
    '<div class="dl"><span class="dl-label">Remarks</span><span class="dl-value">' + esc(r.remarks || '—') + '</span></div>' +
    (function() {
      // Supporting docs now shown in the PDF panel below the iframe — omit here
      return '';
    })() +
    '<hr style="border:none;border-top:1px solid var(--border,#334155);margin:0.75rem 0;">' +
    '<div class="dl"><span class="dl-label">Admin Approval</span><span class="dl-value"><span class="st ' + adminCls + '">' + esc(adminA) + '</span></span></div>' +
    '<div class="dl"><span class="dl-label">Mgmt Approval</span><span class="dl-value"><span class="st ' + mgmtCls + '">' + esc(mgmtA) + '</span></span></div>' +
    '<div class="dl"><span class="dl-label">Status</span><span class="dl-value"><span class="st ' + statusCls + '">' + esc(status) + '</span></span></div>' +
    '<div class="dl"><span class="dl-label">Billing</span><span class="dl-value"><span class="st ' + ((r.billingStatus || 'Unpaid').toLowerCase() === 'paid' ? 'st-paid' : 'st-pending') + '">' + esc(r.billingStatus || 'Unpaid') + '</span></span></div>' +
    (r.paidAt ? '<div class="dl"><span class="dl-label">Paid At</span><span class="dl-value">' + esc(String(r.paidAt).slice(0, 19).replace('T', ' ')) + '</span></div>' : '') +
    (r.paidBy ? '<div class="dl"><span class="dl-label">Paid By</span><span class="dl-value">' + esc(r.paidBy) + '</span></div>' : '');

  // PDF embed + supporting docs strip
  var pdfContainer = document.getElementById('previewPdf');
  var pdfFrameHtml = '';
  if (r.driveLink) {
    var fileId = extractDriveFileId(r.driveLink);
    if (fileId) {
      pdfFrameHtml = '<iframe src="https://drive.google.com/file/d/' + fileId + '/preview" allowfullscreen></iframe>';
    } else {
      pdfFrameHtml = '<div class="no-pdf"><p>Could not embed PDF.</p><a href="' + esc(r.driveLink) + '" target="_blank" class="btn-preview" style="font-size:0.9rem;">Open PDF in new tab</a></div>';
    }
  } else {
    pdfFrameHtml = '<div class="no-pdf">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
      '<p>No PDF uploaded yet.</p>' +
      '<p style="font-size:0.75rem;margin-top:0.5rem;">The PDF uploads in the background — it may take up to a minute after generation.</p>' +
      '</div>';
  }

  // Supporting docs strip below the iframe
  var docsStripHtml = '';
  var docs = (r.supportingDocs || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var attLinks = (r.attachmentLinks || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (docs.length) {
    var docItems = docs.map(function(name, i) {
      var url = attLinks[i] || '';
      var ext = name.split('.').pop().toLowerCase();
      var icon = ext === 'pdf' ? '📄' : (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif') ? '🖼️' : '📎';
      return url
        ? '<a href="' + esc(url) + '" target="_blank" class="pv-doc-link" title="' + esc(name) + '">' + icon + ' ' + esc(name) + '</a>'
        : '<span class="pv-doc-nolink" title="' + esc(name) + '">' + icon + ' ' + esc(name) + '</span>';
    }).join('');
    docsStripHtml = '<div class="pv-docs-strip"><span class="pv-docs-label">Supporting Docs</span>' + docItems + '</div>';
  }

  pdfContainer.innerHTML = '<div class="pv-pdf-frame">' + pdfFrameHtml + '</div>' + docsStripHtml;

  // Action buttons in footer
  var actionsEl = document.getElementById('previewActions');
  var btns = '';
  if (r.driveLink) {
    btns += '<a href="' + esc(r.driveLink) + '" target="_blank" class="btn-preview">Open PDF in new tab</a>';
  }

  var canApproveAdmin = prSession && (prSession.role === 'admin' || prSession.role === 'accounting') && adminA === 'Pending';
  var canApproveMgmt = prSession && prSession.role === 'management' && mgmtA === 'Pending';
  var canDirectorMarkPaid = prSession && prSession.role === 'director' && (r.billingStatus || '').toLowerCase() !== 'paid';

  if (canApproveAdmin || canApproveMgmt) {
    btns += '<button onclick="approveFromPreview(' + idx + ',\'Approved\')" style="background:rgba(34,197,94,0.15);color:#22c55e;border:none;border-radius:6px;padding:0.4rem 1rem;font-size:0.82rem;font-weight:700;cursor:pointer;">Approve</button>';
    btns += '<button onclick="approveFromPreview(' + idx + ',\'Rejected\')" style="background:rgba(239,68,68,0.15);color:#ef4444;border:none;border-radius:6px;padding:0.4rem 1rem;font-size:0.82rem;font-weight:700;cursor:pointer;">Reject</button>';
  }
  if (canDirectorMarkPaid) {
    btns += '<button onclick="markPaidFromPreview(' + idx + ')" style="background:rgba(34,197,94,0.18);color:#16a34a;border:none;border-radius:6px;padding:0.4rem 1rem;font-size:0.82rem;font-weight:700;cursor:pointer;">Mark Paid</button>';
  }

  actionsEl.innerHTML = btns || '<span style="color:var(--text-muted);font-size:0.82rem;">No actions available</span>';

  document.getElementById('previewOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePreview() {
  document.getElementById('previewOverlay').classList.remove('open');
  document.body.style.overflow = '';
  document.getElementById('previewPdf').innerHTML = '<div class="pv-pdf-frame"></div>';
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closePreview();
});

document.addEventListener('click', function(e) {
  var btn = e.target.closest && e.target.closest('.pr-mark-paid-btn');
  if (!btn) return;
  e.stopPropagation();
  e.preventDefault();
  var rowIndex = btn.getAttribute('data-row-index');
  var payee = btn.getAttribute('data-payee') || '';
  markPRPaid(rowIndex, payee);
});

async function approveFromPreview(idx, decision) {
  var r = filteredPR[idx];
  if (!r) return;
  if (!confirm('Are you sure you want to ' + decision.toLowerCase() + ' this payment request for ' + (r.payeeName || '') + '?')) return;
  await updatePRStatus(r.rowIndex, decision);
  // Refresh and re-open if still exists
  if (filteredPR[idx]) openPreview(idx);
  else closePreview();
}

async function markPaidFromPreview(idx) {
  var r = filteredPR[idx];
  if (!r) return;
  await markPRPaid(r.rowIndex, r.payeeName);
  if (filteredPR[idx]) openPreview(idx);
  else closePreview();
}

// ─── Export ─────────────────────────────────────

async function exportPRExcel() {
  if (!filteredPR.length) return;
  await loadXLSX();
  const headers = ['PR #','Date','Requested By','Department','Purpose','Priority','Payee','Type','Bank','Account','Method','Currency','Amount','Due Date','Remarks','Docs','Status'];
  const rows = filteredPR.map(r => [
    r.prNumber, r.requestDate, r.requestedBy, r.department, r.purpose, r.priority,
    r.payeeName, r.payeeType, r.bankName + ' ' + r.bankBranch, r.accountName + ' ' + r.accountNumber,
    r.paymentMethod, r.currency, r.amount, r.dueDate, r.remarks, r.supportingDocs, r.status || 'Pending'
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Payment Requests');
  XLSX.writeFile(wb, 'payment-requests-' + new Date().toISOString().slice(0,10) + '.xlsx');
}
