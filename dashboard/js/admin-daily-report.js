/* ═══════════════════════════════════════════════
   admin-daily-report.js — Auto-feed Daily Report
   ═══════════════════════════════════════════════ */

let session = null;
let alreadySubmitted = false;
let lastSnapshot = null;

document.addEventListener('DOMContentLoaded', async () => {
  session = requireAdmin();
  if (!session) return;
  renderNavbar('admin-daily-report');

  document.getElementById('reportDate').textContent =
    new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  document.getElementById('refreshBtn').addEventListener('click', loadFeed);
  document.getElementById('submitBtn').addEventListener('click', submitReport);

  await checkAlreadySubmitted();
  await loadFeed();
  // Keep today's feed + sent emails auto-updating while the tab is visible (loadFeed never touches notes).
  const poll = setInterval(() => { if (document.visibilityState === 'visible') loadFeed(); }, 60000);
  window.addEventListener('pagehide', () => clearInterval(poll));
});

function _todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function checkAlreadySubmitted() {
  try {
    const result = await apiGetAdminDailyReports({ adminName: session.name, date: _todayISO() });
    if (result.success && result.data && result.data.length > 0) {
      alreadySubmitted = true;
      document.getElementById('submittedBanner').style.display = 'block';
      document.getElementById('submitBtn').disabled = true;
      document.getElementById('submitBtn').textContent = 'Already Submitted';
      const r = result.data[0];
      if (r && r.notes) document.getElementById('notesField').value = r.notes;
    }
  } catch (err) {
    console.error('check submitted error:', err);
  }
}

async function loadFeed() {
  const date = _todayISO();
  const [autofillRes, emailRes] = await Promise.all([
    apiGetAdminDailyAutofill(session.name, date).catch(() => ({ success: false })),
    apiFetchEmailLogToday().catch(() => ({ success: false }))
  ]);

  const data = (autofillRes && autofillRes.success && autofillRes.data) || {};
  const emails = (emailRes && emailRes.success && emailRes.emails) || (emailRes && emailRes.data) || [];

  lastSnapshot = {
    purchaseOrders: data.purchaseOrders || [],
    supplierQuotations: data.supplierQuotations || [],
    pricingSubmissions: data.pricingSubmissions || [],
    shipments: data.shipments || [],
    paymentRequests: data.paymentRequests || [],
    salesOrders: data.salesOrders || [],
    emails: Array.isArray(emails) ? emails : []
  };

  renderSummary(lastSnapshot);
  renderPO(lastSnapshot.purchaseOrders);
  renderSQ(lastSnapshot.supplierQuotations);
  renderPS(lastSnapshot.pricingSubmissions);
  renderSH(lastSnapshot.shipments);
  renderPR(lastSnapshot.paymentRequests);
  renderSO(lastSnapshot.salesOrders);
  renderEmails(lastSnapshot.emails);
}

function _escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function _fmtAmount(v) {
  const n = parseFloat(v);
  if (!isFinite(n) || n === 0) return '—';
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function _statusPill(status) {
  if (!status) return '<span class="status-pill">—</span>';
  const s = String(status).toLowerCase().replace(/\s+/g,'-');
  return `<span class="status-pill status-${_escape(s)}">${_escape(status)}</span>`;
}
function _setCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = n;
}
function _emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" class="empty-state">${msg}</td></tr>`;
}

function renderSummary(snap) {
  const totals = [
    { label: 'POs', value: snap.purchaseOrders.length },
    { label: 'Supplier Qtns', value: snap.supplierQuotations.length },
    { label: 'Pricing', value: snap.pricingSubmissions.length },
    { label: 'Shipments', value: snap.shipments.length },
    { label: 'PRs', value: snap.paymentRequests.length },
    { label: 'SOs', value: snap.salesOrders.length },
    { label: 'Emails', value: snap.emails.length }
  ];
  document.getElementById('summaryRow').innerHTML = totals.map(t =>
    `<div class="summary-tile"><div class="label">${_escape(t.label)}</div><div class="value">${t.value}</div></div>`
  ).join('');
}

function renderPO(rows) {
  _setCount('poCount', rows.length);
  const html = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.poNo)}</td><td>${_escape(r.vendor)}</td><td>${_fmtAmount(r.amount)}</td><td>${_statusPill(r.status)}</td></tr>`
  ).join('') : _emptyRow(4, 'No purchase orders created today.');
  document.getElementById('poBody').innerHTML = html;
}
function renderSQ(rows) {
  _setCount('sqCount', rows.length);
  const html = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.supplier)}</td><td>${_escape(r.item)}</td><td>${_fmtAmount(r.amount)}</td><td>${_escape(r.prNumber)}</td></tr>`
  ).join('') : _emptyRow(4, 'No supplier quotations received today.');
  document.getElementById('sqBody').innerHTML = html;
}
function renderPS(rows) {
  _setCount('psCount', rows.length);
  const html = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.id)}</td><td>${_escape(r.submittedBy || '—')}</td><td>${_escape(r.principal)}</td><td>${_escape(r.destination)}</td><td>${_statusPill(r.status)}</td></tr>`
  ).join('') : _emptyRow(5, 'No pricing submissions today.');
  document.getElementById('psBody').innerHTML = html;
}
function renderSH(rows) {
  _setCount('shCount', rows.length);
  const html = rows.length ? rows.map(r => {
    // Activity-log entries have {action, summary, amount, shipmentId};
    // legacy/fallback rows have {shipmentId, poNo, client, mode, eta, status}.
    if (r.action || r.summary) {
      return `<tr>
        <td>${_escape(r.shipmentId || '—')}</td>
        <td colspan="3">${_escape(r.summary || '')}</td>
        <td>${_fmtAmount(r.amount)}</td>
        <td>${_statusPill(r.action)}</td>
      </tr>`;
    }
    return `<tr><td>${_escape(r.shipmentId)}</td><td>${_escape(r.poNo)}</td><td>${_escape(r.client)}</td><td>${_escape(r.mode)}</td><td>${_escape(r.eta)}</td><td>${_statusPill(r.status)}</td></tr>`;
  }).join('') : _emptyRow(6, 'No shipment activity from you today.');
  document.getElementById('shBody').innerHTML = html;
}
function renderPR(rows) {
  _setCount('prCount', rows.length);
  const html = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.prNo)}</td><td>${_escape(r.payee)}</td><td>${_fmtAmount(r.amount)}</td><td>${_statusPill(r.status)}</td></tr>`
  ).join('') : _emptyRow(4, 'No payment requests today.');
  document.getElementById('prBody').innerHTML = html;
}
function renderSO(rows) {
  _setCount('soCount', rows.length);
  const html = rows.length ? rows.map(r =>
    `<tr><td>${_escape(r.soNo)}</td><td>${_escape(r.customer)}</td><td>${_fmtAmount(r.amount)}</td><td>${_statusPill(r.status)}</td></tr>`
  ).join('') : _emptyRow(4, 'No sales orders today.');
  document.getElementById('soBody').innerHTML = html;
}
function renderEmails(rows) {
  _setCount('emailCount', rows.length);
  const html = rows.length ? rows.map(r => {
    const t = r.sentAt ? new Date(r.sentAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—';
    const cat = r.category || 'Follow up';
    const opts = ['Follow up', 'Supplier Inquiry', 'Client Inquiry', 'Ongoing Shipment', 'Pending Shipment'];
    const selOpts = opts.map(o => `<option${cat===o?' selected':''}>${o}</option>`).join('');
    return `<tr><td>${_escape(t)}</td><td>${_escape(r.recipient || '')}</td><td>${_escape(r.subject || '')}</td><td><select class="email-cat" data-msgid="${_escape(r.messageId||'')}">${selOpts}</select></td></tr>`;
  }).join('') : _emptyRow(4, 'No emails sent from GoDaddy today.');
  document.getElementById('emailBody').innerHTML = html;
}

async function submitReport() {
  if (alreadySubmitted) return;
  const msgEl = document.getElementById('formMsg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';

  if (!lastSnapshot) {
    msgEl.textContent = 'No data loaded yet. Click Refresh first.';
    msgEl.className = 'form-msg error';
    return;
  }

  // Capture email categories from dropdowns
  const catSelectors = document.querySelectorAll('.email-cat');
  const catByMsgId = {};
  catSelectors.forEach(el => { catByMsgId[el.dataset.msgid] = el.value; });
  const emailsWithCat = (lastSnapshot.emails || []).map(e => ({
    ...e, category: catByMsgId[e.messageId || ''] || 'Follow up'
  }));

  const notes = document.getElementById('notesField').value.trim();
  const snapshot = {
    version: 2,
    capturedAt: new Date().toISOString(),
    purchaseOrders: lastSnapshot.purchaseOrders,
    supplierQuotations: lastSnapshot.supplierQuotations,
    pricingSubmissions: lastSnapshot.pricingSubmissions,
    shipments: lastSnapshot.shipments,
    paymentRequests: lastSnapshot.paymentRequests,
    salesOrders: lastSnapshot.salesOrders,
    emails: emailsWithCat,
    notes: notes
  };

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const result = await apiSubmitAdminDailyReport({
      adminName: session.name,
      snapshotData: JSON.stringify(snapshot),
      notes: notes,
      // Legacy fields kept empty so backend stays compatible
      poStatus: '[]',
      internationalShipment: '[]',
      localShipment: '[]',
      deliveryForClient: '[]',
      pendingInquiry: '[]',
      receivedQuotation: '[]',
      otherTasks: '[]'
    });

    if (result.success) {
      alreadySubmitted = true;
      msgEl.textContent = 'Report submitted successfully!';
      msgEl.className = 'form-msg success';
      document.getElementById('submittedBanner').style.display = 'block';
      btn.textContent = 'Already Submitted';
    } else {
      msgEl.textContent = result.message || 'Failed to submit.';
      msgEl.className = 'form-msg error';
      btn.disabled = false;
      btn.textContent = 'Submit Daily Report';
    }
  } catch (err) {
    msgEl.textContent = 'Error: ' + err.message;
    msgEl.className = 'form-msg error';
    btn.disabled = false;
    btn.textContent = 'Submit Daily Report';
  }
}
