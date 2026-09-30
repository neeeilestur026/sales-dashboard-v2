/* pricing-submissions-inline.js — A305 · the page's own script, moved verbatim out of pricing-submissions.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
let allSubmissions = [];

document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAdmin();
  if (!session) return;
  renderNavbar('pricing-submissions');
  await loadSubmissions();
});

async function loadSubmissions() {
  const container = document.getElementById('subsContainer');
  try {
    const res = await apiGetPricingSubmissions();
    if (!res.success) throw new Error(res.message || 'Failed to load');
    allSubmissions = res.data || [];
    applyFilter();
  } catch (err) {
    container.innerHTML = `<div class="no-results"><p>Error: ${esc(err.message)}</p></div>`;
  }
}

function applyFilter() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const statusVal = document.getElementById('statusFilter').value;
  const filtered = allSubmissions.filter(s => {
    if (statusVal && s.status !== statusVal) return false;
    if (!search) return true;
    const hay = [s.id, s.submittedBy, s.principal, s.destination, s.itemsJson, s.forwardedBy || ''].join(' ').toLowerCase();
    return hay.includes(search);
  });
  renderSubmissions(filtered);
}

function statusBadgeClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'forwarded': return 'badge-forwarded';
    case 'priced': return 'badge-priced';
    case 'applied': return 'badge-applied';
    case 'sent to sales': return 'badge-sent';
    default: return 'badge-pending';
  }
}

function renderSubmissions(subs) {
  const container = document.getElementById('subsContainer');
  document.getElementById('subCount').textContent = `${subs.length} submission${subs.length !== 1 ? 's' : ''}`;

  if (subs.length === 0) {
    container.innerHTML = `<div class="no-results"><p>No pricing submissions found.</p></div>`;
    return;
  }

  container.innerHTML = subs.map(s => {
    let items = [];
    try { items = JSON.parse(s.itemsJson); } catch {}

    const hasPrRefs = s.prRefsJson && s.prRefsJson !== '' && s.prRefsJson !== '[]';
    const showApply = s.status === 'Priced' && hasPrRefs;
    const showForwardSales = (s.status === 'Applied' && hasPrRefs) || ((s.status === 'Priced' || s.status === 'Pending') && !hasPrRefs);

    let prRefs = [];
    try { prRefs = JSON.parse(s.prRefsJson || '[]'); } catch {}
    const clients = [...new Set(prRefs.map(r => r.clientName).filter(Boolean))];
    const agents = [...new Set(prRefs.map(r => r.agentName).filter(Boolean))];
    const clientLine = clients.length
      ? `<div style="font-size:0.85rem;font-weight:600;color: var(--text-primary);margin-bottom:0.35rem;">Client: ${clients.map(c => esc(c)).join(', ')}${agents.length ? ` <span style="font-weight:400;color: var(--text-secondary);">(Agent: ${agents.map(a => esc(a)).join(', ')})</span>` : ''}</div>`
      : '';

    const itemRows = items.map((it, idx) => `
      <tr>
        <td style="text-align:center;color: var(--text-muted);">${idx + 1}</td>
        <td style="font-weight:600;">${esc(it.modelNo || it.modelPartNo) || '—'}</td>
        <td>${esc(it.name || it.itemDescription) || '—'}</td>
        <td class="td-num">${Number(it.qty || it.quantity || 0)}</td>
        <td class="td-num" style="font-weight:700;color: var(--hx-ok);">${peso(it.unitPriceVatEx)}</td>
      </tr>
    `).join('');

    return `
      <div class="sub-card">
        <div class="sub-header">
          <span class="sub-id">${esc(s.id)}</span>
          <div class="sub-meta">
            <span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
              ${esc(s.submittedBy || '—')}
            </span>
            <span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${esc(s.date)}${s.updatedDate ? ` (edited ${esc(s.updatedDate)})` : ''}
            </span>
            <span>${esc(s.principal)}</span>
            <span>${s.destination ? esc(s.destination) : 'Local Pickup'}</span>
            ${s.forwardedBy ? `<span style="color: var(--hx-cyan-ink);">Fwd by: ${esc(s.forwardedBy)}</span>` : ''}
            <span class="${statusBadgeClass(s.status)}">${esc(s.status)}</span>
          </div>
        </div>
        ${clientLine}
        <table class="items-table">
          <thead>
            <tr>
              <th style="width:36px;">#</th>
              <th>Model No.</th>
              <th>Item Description</th>
              <th style="width:60px;">Qty</th>
              <th>Unit Price (VAT Excl.)</th>
            </tr>
          </thead>
          <tbody>${itemRows || '<tr><td colspan="5" style="color: var(--text-muted);text-align:center;">No items</td></tr>'}</tbody>
        </table>
        ${(showApply || showForwardSales) ? `
          <div style="margin-top:0.75rem;text-align:right;">
            ${showApply ? `
              <button class="btn-apply" onclick="applyToPR('${esc(s.id)}', this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                Apply Pricing to PR
              </button>
            ` : ''}
            ${showForwardSales ? `
              <button class="btn-forward-sales" onclick="forwardToSales('${esc(s.id)}', this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                Forward to Sales
              </button>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

async function applyToPR(submissionId, btn) {
  if (!confirm('Apply the VAT-exclusive unit prices from this submission to the original PR items?')) return;
  btn.disabled = true;
  btn.textContent = 'Applying...';
  try {
    const res = await apiApplyPricingToPR(submissionId);
    if (res.success) {
      alert('Pricing applied to ' + res.applied + ' PR item(s)!' + (res.errors && res.errors.length ? '\nErrors: ' + res.errors.join('; ') : ''));
      await loadSubmissions();
    } else {
      alert('Failed: ' + (res.message || 'Unknown error'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Apply Pricing to PR';
  }
}

async function forwardToSales(submissionId, btn) {
  const sub = allSubmissions.find(s => s.id === submissionId);
  let prRefs = [];
  try { prRefs = JSON.parse((sub && sub.prRefsJson) || '[]'); } catch {}
  const agents = [...new Set(prRefs.map(r => r.agentName).filter(Boolean))];
  const agentStr = agents.length ? agents.join(', ') : 'the sales agent';
  if (!confirm(`Mark this submission as sent to ${agentStr}? The agent will see updated pricing in their Pending Items.`)) return;
  btn.disabled = true;
  btn.textContent = 'Forwarding...';
  try {
    const res = await apiMarkSentToSales(submissionId);
    if (res.success) {
      await loadSubmissions();
    } else {
      alert('Failed: ' + (res.message || 'Unknown error'));
      btn.disabled = false;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Forward to Sales';
    }
  } catch (err) {
    alert('Error: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Forward to Sales';
  }
}

function esc(s) { return hxEscBlank(s); }
function peso(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt(n) { return Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
