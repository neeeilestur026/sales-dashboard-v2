/* ═══════════════════════════════════════════════════════════
   accounting-billing.js — Billing feature for Accounting
   ═══════════════════════════════════════════════════════════ */

'use strict';

let _billingData   = [];   // full list from API
let _currentRecord = null; // record open in detail modal
let _slipPdfB64    = null; // cached payment slip PDF for current record
let _cvPdfB64      = null; // cached cash voucher PDF for current record
let _detailTab     = 'info';
let _session       = null;

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  _session = requireAccountingOrAdmin();
  if (!_session) return;
  renderNavbar('accounting-billing');
  // Pre-fill today's date in CV date field
  const today = new Date().toISOString().slice(0, 10);
  const cvDateEl = document.getElementById('cvDate');
  if (cvDateEl) cvDateEl.value = today;
  loadBillingRecords();
});

// ─── Load records ─────────────────────────────────────────
async function loadBillingRecords() {
  setTbodyLoading(true);
  try {
    const res = await fetchFromAPI({ action: 'getBillingRecords' });
    if (!res.success) throw new Error(res.message || 'Failed to load');
    _billingData = res.data || [];
    applyFilters();
  } catch (err) {
    setTbodyError(err.message);
  }
}

// ─── KPIs ─────────────────────────────────────────────────
function renderKpis(data) {
  const total  = data.length;
  const unpaid = data.filter(r => (r.billingStatus || 'Unpaid') === 'Unpaid').length;
  const paid   = data.filter(r => r.billingStatus === 'Paid').length;
  const amount = data.reduce((s, r) => s + (parseFloat(String(r.amount).replace(/,/g,'')) || 0), 0);

  document.getElementById('kpiTotal').textContent  = total;
  document.getElementById('kpiUnpaid').textContent = unpaid;
  document.getElementById('kpiPaid').textContent   = paid;
  document.getElementById('kpiAmount').textContent = '₱' + amount.toLocaleString('en-PH', { minimumFractionDigits: 2 });

  // Reflect the active month filter on the Total Amount KPI label/sub.
  const monthEl = document.getElementById('filterMonth');
  const labelEl = document.getElementById('kpiAmountLabel');
  const subEl   = document.getElementById('kpiAmountSub');
  if (labelEl && subEl) {
    if (monthEl && monthEl.value) {
      const [y, m] = monthEl.value.split('-');
      const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-PH', { month: 'long', year: 'numeric' });
      labelEl.textContent = 'Total Amount · ' + monthName;
      subEl.textContent = 'filtered month';
    } else {
      labelEl.textContent = 'Total Amount (All Time)';
      subEl.textContent = 'all approved PRs';
    }
  }
}

// ─── Filters ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  ['filterSearch','filterStatus','filterPriority','filterMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', applyFilters);
  });
});

function applyFilters() {
  const search   = (document.getElementById('filterSearch')?.value   || '').toLowerCase();
  const status   = (document.getElementById('filterStatus')?.value   || '');
  const priority = (document.getElementById('filterPriority')?.value || '');
  const monthVal = (document.getElementById('filterMonth')?.value    || ''); // YYYY-MM

  const filtered = _billingData.filter(r => {
    const bs = r.billingStatus || 'Unpaid';
    if (status   && bs !== status) return false;
    if (priority && (r.priority || '') !== priority) return false;
    if (monthVal) {
      const d = new Date(r.requestDate);
      if (isNaN(d)) return false;
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (ym !== monthVal) return false;
    }
    if (search) {
      const hay = [r.prNumber, r.payeeName, r.purpose, r.requestedBy, r.department]
                    .join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  renderKpis(filtered);
  renderTable(filtered);
}

// ─── Table render ─────────────────────────────────────────
function renderTable(data) {
  const tbody = document.getElementById('billingTbody');
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="11">
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>No billing records found.</p>
      </div></td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(r => {
    const bs     = r.billingStatus || 'Unpaid';
    const bsCls  = bs === 'Paid' ? 'badge-paid' : 'badge-unpaid';
    const priCls = (r.priority||'').toLowerCase() === 'high' ? 'pri-high'
                 : (r.priority||'').toLowerCase() === 'medium' ? 'pri-medium'
                 : 'pri-low';
    const amt    = r.amount ? '₱' + parseFloat(String(r.amount).replace(/,/g,'')).toLocaleString('en-PH',{minimumFractionDigits:2}) : '—';
    return `
      <tr onclick="openDetailOverlay('${esc(r.prNumber)}')">
        <td><span style="font-weight:600;color:var(--accent,#fb923c)">${esc(r.prNumber)}</span></td>
        <td>${esc(r.requestDate||'—')}</td>
        <td>${esc(r.requestedBy||'—')}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.purpose||'—')}</td>
        <td>${esc(r.payeeName||'—')}</td>
        <td style="font-weight:600">${amt}</td>
        <td>${esc(r.dueDate||'—')}</td>
        <td><span class="badge ${priCls}">${esc(r.priority||'—')}</span></td>
        <td><span class="badge ${bsCls}">${bs}</span></td>
        <td style="font-size:0.78rem;color:var(--text-muted,#94a3b8)">${esc(r.cvNumber||'—')}</td>
        <td onclick="event.stopPropagation()">
          ${bs === 'Unpaid'
            ? `<button class="btn btn-primary btn-sm" onclick="quickMarkPaid('${esc(r.prNumber)}')">Mark Paid</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="openDetailOverlay('${esc(r.prNumber)}')">View</button>`
          }
        </td>
      </tr>`;
  }).join('');
}

// ─── Detail overlay ───────────────────────────────────────
async function openDetailOverlay(prNumber) {
  const record = _billingData.find(r => r.prNumber === prNumber);
  if (!record) return;
  _currentRecord = record;
  _slipPdfB64    = null;
  _cvPdfB64      = null;

  const paid = (record.billingStatus || 'Unpaid') === 'Paid';

  // Header
  document.getElementById('detailTitle').textContent   = `PR ${record.prNumber}`;
  document.getElementById('detailSubtitle').textContent = `${record.purpose || ''} · ${record.payeeName || ''}`;

  // Tab visibility
  document.getElementById('tabDocuments').style.display  = '';
  document.getElementById('tabCvForm').style.display     = paid ? '' : 'none';

  // Info tab
  _populateInfoTab(record);

  // Documents tab
  _refreshDocumentsTab(record);

  // Buttons
  document.getElementById('btnMarkPaid').style.display   = paid ? 'none' : '';
  document.getElementById('btnGenerateCv').style.display = paid ? '' : 'none';

  // CV form pre-fills
  if (_session) {
    document.getElementById('cvPreparedBy').value = _session.name || '';
  }
  document.getElementById('cvBankName').value   = record.bankName    || '';
  document.getElementById('cvParticulars').value = record.purpose    || '';
  document.getElementById('cvPaymentMode').value = record.paymentMethod || '';

  switchDetailTab('info');
  document.getElementById('detailOverlay').classList.add('open');
}

function _populateInfoTab(r) {
  const fmt = v => v || '—';
  const peso = v => v ? '₱' + parseFloat(String(v).replace(/,/g,'')).toLocaleString('en-PH',{minimumFractionDigits:2}) : '—';

  document.getElementById('infoGrid').innerHTML = [
    ['PR Number',   r.prNumber],
    ['Request Date',r.requestDate],
    ['Requested By',r.requestedBy],
    ['Department',  r.department],
    ['Purpose',     r.purpose],
    ['Priority',    r.priority],
    ['Due Date',    r.dueDate],
    ['Submitted At',r.submittedAt ? r.submittedAt.slice(0,10) : '—'],
  ].map(([l,v]) => `<div class="info-item"><div class="info-label">${l}</div><div class="info-val">${esc(fmt(v))}</div></div>`).join('');

  document.getElementById('payeeGrid').innerHTML = [
    ['Payee Name',    r.payeeName],
    ['Payee Type',    r.payeeType],
    ['Payment Method',r.paymentMethod],
    ['Currency',      r.currency],
    ['Bank Name',     r.bankName],
    ['Bank Branch',   r.bankBranch],
    ['Account Name',  r.accountName],
    ['Account Number',r.accountNumber],
  ].map(([l,v]) => `<div class="info-item"><div class="info-label">${l}</div><div class="info-val">${esc(fmt(v))}</div></div>`).join('');

  document.getElementById('detailAmt').textContent = `${r.currency||'PHP'} ${peso(r.amount)}`;

  const rm = (r.remarks||'').trim();
  document.getElementById('remarkSection').style.display = rm ? '' : 'none';
  document.getElementById('detailRemark').textContent = rm;

  const paid = (r.billingStatus||'Unpaid') === 'Paid';
  document.getElementById('billingInfoGrid').innerHTML = [
    ['Billing Status', `<span class="badge ${paid ? 'badge-paid' : 'badge-unpaid'}">${r.billingStatus||'Unpaid'}</span>`],
    ['Paid At',  r.paidAt  ? r.paidAt.slice(0,10) : '—'],
    ['Paid By',  r.paidBy  || '—'],
    ['CV Number',r.cvNumber || '—'],
  ].map(([l,v]) => `<div class="info-item"><div class="info-label">${l}</div><div class="info-val">${v}</div></div>`).join('');
}

function _refreshDocumentsTab(r) {
  const hasSlip = !!(r.paymentSlipLink || _slipPdfB64);
  const hasCv   = !!(r.cashVoucherLink || _cvPdfB64);

  document.getElementById('noPdfsMsg').style.display = (!hasSlip && !hasCv) ? '' : 'none';
  document.getElementById('cvPlaceholderTxt').textContent =
    (r.billingStatus === 'Paid') ? 'Fill the Cash Voucher form to generate' : 'Mark as Paid first';

  // Payment Slip
  const slipBody = document.getElementById('slipPdfBody');
  const btnSlip  = document.getElementById('btnDownloadSlip');
  if (_slipPdfB64) {
    slipBody.innerHTML = `<iframe src="data:application/pdf;base64,${_slipPdfB64}"></iframe>`;
    btnSlip.style.display = '';
  } else if (r.paymentSlipLink) {
    slipBody.innerHTML = `<iframe src="${r.paymentSlipLink}"></iframe>`;
    btnSlip.style.display = '';
  } else {
    slipBody.innerHTML = `<div class="pdf-placeholder">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>Mark as Paid to generate</p></div>`;
    btnSlip.style.display = 'none';
  }

  // Cash Voucher
  const cvBody  = document.getElementById('cvPdfBody');
  const btnCv   = document.getElementById('btnDownloadCv');
  if (_cvPdfB64) {
    cvBody.innerHTML = `<iframe src="data:application/pdf;base64,${_cvPdfB64}"></iframe>`;
    btnCv.style.display = '';
  } else if (r.cashVoucherLink) {
    cvBody.innerHTML = `<iframe src="${r.cashVoucherLink}"></iframe>`;
    btnCv.style.display = '';
  } else {
    cvBody.innerHTML = `<div class="pdf-placeholder">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
      <p id="cvPlaceholderTxt">${(r.billingStatus==='Paid') ? 'Fill the Cash Voucher form to generate' : 'Mark as Paid first'}</p></div>`;
    btnCv.style.display = 'none';
  }

  // CV form note
  const cvFormNote = document.getElementById('cvFormNote');
  if (cvFormNote) {
    if (r.billingStatus === 'Paid') {
      cvFormNote.style.display = 'none';
      document.getElementById('btnGenerateCv').disabled = false;
    } else {
      cvFormNote.style.display = '';
      document.getElementById('btnGenerateCv').disabled = true;
    }
  }
}

function closeDetailOverlay() {
  document.getElementById('detailOverlay').classList.remove('open');
  _currentRecord = null;
  _slipPdfB64    = null;
  _cvPdfB64      = null;
}

function _overlayBgClick(event) {
  if (event.target === document.getElementById('detailOverlay')) closeDetailOverlay();
}

function switchDetailTab(tab) {
  _detailTab = tab;
  ['info','documents','cv-form'].forEach(t => {
    const btn   = document.querySelector(`.detail-tab-btn[onclick*="'${t}'"]`);
    const panel = document.getElementById('panel' + t.split('-').map((w,i) => i===0 ? w.charAt(0).toUpperCase()+w.slice(1) : w.charAt(0).toUpperCase()+w.slice(1)).join(''));
    if (btn)   btn.classList.toggle('active',   t === tab);
    if (panel) panel.classList.toggle('active', t === tab);
  });

  // Show/hide Generate CV button only on cv-form tab
  const genBtn = document.getElementById('btnGenerateCv');
  if (genBtn) genBtn.style.display = (tab === 'cv-form' && _currentRecord?.billingStatus === 'Paid') ? '' : 'none';
  const markBtn = document.getElementById('btnMarkPaid');
  if (markBtn) markBtn.style.display = ((_currentRecord?.billingStatus||'Unpaid') === 'Unpaid' && tab !== 'cv-form') ? '' : 'none';
}

// ─── Mark as Paid ─────────────────────────────────────────
function quickMarkPaid(prNumber) {
  const record = _billingData.find(r => r.prNumber === prNumber);
  if (!record) return;
  _currentRecord = record;
  _confirmAndPay();
}

function confirmMarkPaid() {
  if (!_currentRecord) return;
  _confirmAndPay();
}

function _confirmAndPay() {
  const r = _currentRecord;
  const amt = r.amount ? `₱${parseFloat(String(r.amount).replace(/,/g,'')).toLocaleString('en-PH',{minimumFractionDigits:2})}` : '';
  document.getElementById('confirmMsg').textContent =
    `Mark "${r.prNumber}" (${r.payeeName}, ${amt}) as Paid? A Payment Slip PDF will be auto-generated.`;
  document.getElementById('confirmOverlay').classList.add('open');
}

async function doMarkPaid() {
  document.getElementById('confirmOverlay').classList.remove('open');
  if (!_currentRecord) return;

  const r = _currentRecord;
  const btn = document.getElementById('btnMarkPaid');
  const origLabel = btn?.innerHTML;
  if (btn) btn.innerHTML = '<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M21 12c0-4.97-4.03-9-9-9"/></svg> Processing…';
  if (btn) btn.disabled = true;

  try {
    // Convert keys to snake_case for the PDF generator
    const details = _recordToPdfDetails(r);
    const res = await fetch('/billing/mark-paid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rowIndex:  r.rowIndex,
        prNumber:  r.prNumber,
        paidBy:    _session?.name || '',
        details:   details,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed');

    // Update local record
    r.billingStatus    = 'Paid';
    r.paidAt           = data.paidAt;
    r.paidBy           = data.paidBy;
    r.paymentSlipLink  = data.driveLink || '';
    _slipPdfB64        = data.pdfBase64 || null;

    // Refresh table & modal
    renderKpis(_billingData);
    applyFilters();
    if (document.getElementById('detailOverlay').classList.contains('open')) {
      _populateInfoTab(r);
      _refreshDocumentsTab(r);
      document.getElementById('tabCvForm').style.display = '';
      document.getElementById('btnMarkPaid').style.display   = 'none';
      document.getElementById('btnGenerateCv').style.display = 'none';
      // Auto-switch to documents tab to show the slip
      switchDetailTab('documents');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) { btn.innerHTML = origLabel; btn.disabled = false; }
  }
}

// ─── Generate Cash Voucher ────────────────────────────────
async function generateCashVoucher() {
  if (!_currentRecord || _currentRecord.billingStatus !== 'Paid') return;

  const r = _currentRecord;
  const cvNo  = document.getElementById('cvNumber').value.trim();
  const cvDt  = document.getElementById('cvDate').value;
  const cvPrp = document.getElementById('cvPreparedBy').value.trim();

  if (!cvNo || !cvDt || !cvPrp) {
    alert('CV Number, CV Date and Prepared By are required.');
    return;
  }

  const btn = document.getElementById('btnGenerateCv');
  const origLabel = btn?.innerHTML;
  if (btn) btn.innerHTML = '<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M21 12c0-4.97-4.03-9-9-9"/></svg> Generating…';
  if (btn) btn.disabled = true;

  const cvDetails = {
    cv_number:       cvNo,
    cv_date:         cvDt,
    prepared_by:     cvPrp,
    approved_by:     document.getElementById('cvApprovedBy').value.trim(),
    account_charged: document.getElementById('cvAccountCharged').value.trim(),
    credit_account:  document.getElementById('cvCreditAccount').value.trim() || 'Cash / Bank',
    payment_mode:    document.getElementById('cvPaymentMode').value,
    cheque_number:   document.getElementById('cvChequeNumber').value.trim(),
    cheque_date:     document.getElementById('cvChequeDate').value,
    bank_name:       document.getElementById('cvBankName').value.trim(),
    particulars:     document.getElementById('cvParticulars').value.trim(),
    additional_notes:document.getElementById('cvNotes').value.trim(),
  };

  try {
    const res = await fetch('/billing/generate-cash-voucher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rowIndex:  r.rowIndex,
        prNumber:  r.prNumber,
        prDetails: _recordToPdfDetails(r),
        cvDetails: cvDetails,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed');

    r.cashVoucherLink = data.driveLink || '';
    r.cvNumber        = data.cvNumber;
    _cvPdfB64         = data.pdfBase64 || null;

    // Refresh
    renderKpis(_billingData);
    applyFilters();
    _populateInfoTab(r);
    _refreshDocumentsTab(r);
    switchDetailTab('documents');
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) { btn.innerHTML = origLabel; btn.disabled = false; }
  }
}

// ─── Download helpers ─────────────────────────────────────
function downloadSlip() {
  if (!_currentRecord) return;
  if (_slipPdfB64) {
    _downloadB64(_slipPdfB64, `PaymentSlip_${_currentRecord.prNumber}.pdf`);
    return;
  }
  if (_currentRecord.paymentSlipLink) {
    window.open(_currentRecord.paymentSlipLink, '_blank');
    return;
  }
  // Re-generate on demand
  fetch('/billing/download-payment-slip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      details: _recordToPdfDetails(_currentRecord),
      paidAt:  _currentRecord.paidAt  || '',
      paidBy:  _currentRecord.paidBy  || '',
    }),
  }).then(r => r.blob()).then(b => {
    const url = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = url;
    a.download = `PaymentSlip_${_currentRecord.prNumber}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  });
}

function downloadCv() {
  if (!_currentRecord) return;
  if (_cvPdfB64) {
    _downloadB64(_cvPdfB64, `CashVoucher_${_currentRecord.cvNumber||_currentRecord.prNumber}.pdf`);
    return;
  }
  if (_currentRecord.cashVoucherLink) {
    window.open(_currentRecord.cashVoucherLink, '_blank');
  }
}

function _downloadB64(b64, filename) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: 'application/pdf' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a'); a.href = url;
  a.download  = filename; a.click(); URL.revokeObjectURL(url);
}

// ─── Helpers ──────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Convert camelCase record to snake_case dict for PDF generators. */
function _recordToPdfDetails(r) {
  return {
    pr_number:      r.prNumber      || '',
    request_date:   r.requestDate   || '',
    requested_by:   r.requestedBy   || '',
    department:     r.department    || '',
    purpose:        r.purpose       || '',
    priority:       r.priority      || '',
    payee_name:     r.payeeName     || '',
    payee_type:     r.payeeType     || '',
    bank_name:      r.bankName      || '',
    bank_branch:    r.bankBranch    || '',
    account_name:   r.accountName   || '',
    account_number: r.accountNumber || '',
    payment_method: r.paymentMethod || '',
    currency:       r.currency      || 'PHP',
    amount:         r.amount        || '',
    due_date:       r.dueDate       || '',
    remarks:        r.remarks       || '',
    paid_at:        r.paidAt        || '',
    paid_by:        r.paidBy        || '',
  };
}

function setTbodyLoading(yes) {
  if (!yes) return;
  document.getElementById('billingTbody').innerHTML =
    `<tr><td colspan="11"><div class="empty-state"><p>Loading billing records…</p></div></td></tr>`;
}

function setTbodyError(msg) {
  document.getElementById('billingTbody').innerHTML =
    `<tr><td colspan="11"><div class="empty-state" style="color:#dc2626"><p>Error: ${esc(msg)}</p></div></td></tr>`;
}
