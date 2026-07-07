/* flow-pricing-request.js — role-aware pricing/purchase-request flow.
   Sales request → Admin sourcing → Management pricing → Admin verify → Sales quotation. */

let prSession = null;
let prInventory = [];
let prList = [];
let prRole = '';          // 'sales' | 'admin' | 'management' | 'accounting' | 'director'
let prFilter = '';        // active status filter for the list
let prOversight = false;  // accounting/director: see all reps (grouped) + act on any stage
let canSource = false;    // may run sourcing + verification
let canPrice = false;     // may run management pricing

// status → 5-step index (0=Request,1=Sourcing,2=Pricing,3=Verify,4=Quotation)
const STEP_OF = {
  'Requested': 1, 'Sourcing': 1, 'For Mgmt Pricing': 2, 'Mgmt Priced': 3,
  'Verifying': 3, 'Returned to Sales': 4, 'Quoted': 5
};
const STEP_LABELS = ['Request', 'Sourcing', 'Pricing', 'Verify', 'Quotation'];

const BADGE = {
  'Requested': 'b-open', 'Sourcing': 'b-open', 'For Mgmt Pricing': 'b-pending',
  'Mgmt Priced': 'b-pending', 'Verifying': 'b-pending', 'Returned to Sales': 'b-approved',
  'Quoted': 'b-closed'
};

document.addEventListener('DOMContentLoaded', async () => {
  prSession = requirePricingFlowAccess();
  if (!prSession) return;
  prRole = prSession.role;
  // Capabilities: accounting & director are full-access oversight (can act on any stage + see all reps).
  prOversight = prRole === 'accounting' || prRole === 'director';
  canSource = prRole === 'admin' || prOversight;       // sourcing + verification (admin side)
  canPrice = prRole === 'management' || prOversight;    // management final pricing
  renderNavbar('flow-pricing-request');
  renderSteps(prRole === 'sales' ? 0 : prRole === 'management' ? 2 : 1);
  setupRoleUI();
  if (prRole === 'sales' || prRole === 'admin') {
    document.getElementById('date').value = flowToday();
    await loadInventory();
    addRow();
  }
  await loadRequests();
  if (prRole === 'management') loadFlowPricingHistory();
});

function renderSteps(activeIdx) {
  document.getElementById('prSteps').innerHTML = STEP_LABELS.map((lbl, i) => {
    const cls = i < activeIdx ? 'done' : i === activeIdx ? 'active' : '';
    return `<div class="pr-step ${cls}"><div class="dot">${i + 1}</div><div class="lbl">${lbl}</div></div>`;
  }).join('');
}

function setupRoleUI() {
  const blurb = document.getElementById('roleBlurb');
  const listTitle = document.getElementById('listTitle');
  const seg = document.getElementById('filterSeg');
  if (prRole === 'sales') {
    document.getElementById('salesFormCard').style.display = '';
    listTitle.textContent = 'My Requests';
    blurb.textContent = 'Create a purchase request from inventory items. Admin sources suppliers and management prices it; when it returns you can build the quotation.';
    seg.innerHTML = segBtns(['', 'Returned to Sales', 'Quoted'], ['All', 'Ready to Quote', 'Quoted']);
  } else if (prOversight) {
    listTitle.textContent = 'All Purchase Requests (by sales rep)';
    blurb.textContent = 'Full oversight of every rep’s pricing requests across all stages. Open any request to review or act on its current stage.';
    seg.innerHTML = segBtns(['', 'Requested,Sourcing', 'For Mgmt Pricing', 'Mgmt Priced', 'Returned to Sales,Quoted'],
      ['All', 'Sourcing', 'Pricing', 'Verify', 'Done']);
    prFilter = '';
  } else if (prRole === 'admin') {
    document.getElementById('salesFormCard').style.display = '';   // admin can also start a purchase request
    listTitle.textContent = 'Sourcing & Verification Queue';
    blurb.textContent = 'Create a purchase request below, or source suppliers and prices for each item then forward to management. After management prices it, verify and return to sales.';
    seg.innerHTML = segBtns(['Requested,Sourcing', 'Mgmt Priced', ''], ['To Source', 'To Verify', 'All']);
    prFilter = 'Requested,Sourcing';
  } else { // management
    listTitle.textContent = 'Pricing Queue';
    blurb.textContent = 'The pricing engine is always available below — open a request to price it, or reload a past pricing to re-price. Final prices return to admin.';
    seg.innerHTML = segBtns(['For Mgmt Pricing', ''], ['To Price', 'All']);
    prFilter = 'For Mgmt Pricing';
    // Show the always-on pricing engine + pricing history (management only).
    const eng = document.getElementById('mgmtEngineCard'), hist = document.getElementById('pricingHistoryCard');
    if (eng) eng.style.display = '';
    if (hist) hist.style.display = '';
    renderMgmtEngineShell();
  }
}

function segBtns(values, labels) {
  return values.map((v, i) =>
    `<button class="${v === prFilter ? 'active' : ''}" data-f="${flowEsc(v)}" onclick="setFilter(this)">${flowEsc(labels[i])}</button>`).join('');
}
function setFilter(btn) {
  prFilter = btn.getAttribute('data-f');
  document.querySelectorAll('#filterSeg button').forEach(b => b.classList.toggle('active', b === btn));
  renderList();
}

async function loadInventory() {
  try { const r = await fetchFlow('getInventory'); prInventory = (r && r.data) || []; }
  catch (e) { prInventory = []; }
}

// ─── Sales: request form ─────────────────────────
function itemOptions(selected) {
  return '<option value="">— select item —</option>' + prInventory.map(i =>
    `<option value="${flowEsc(i.itemNo)}"${String(i.itemNo) === String(selected) ? ' selected' : ''}>${flowEsc(i.itemNo)} — ${flowEsc(i.description)}</option>`).join('');
}

function addRow(item) {
  const tb = document.getElementById('itemRows');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select>${itemOptions(item && item.itemNo)}</select></td>
    <td class="num"><input type="number" step="any" min="0" value="${item ? flowNum(item.qty) : 1}"></td>
    <td><input type="text" value="${item ? flowEsc(item.uom || '') : ''}" placeholder="pc"></td>
    <td><input type="text" value="${item ? flowEsc(item.remarks || '') : ''}" placeholder="optional"></td>
    <td><button type="button" class="link-btn del-btn" onclick="this.closest('tr').remove();countLines();">✕</button></td>`;
  tb.appendChild(tr);
  countLines();
}
function countLines() {
  document.getElementById('lineCount').textContent = document.querySelectorAll('#itemRows tr').length;
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const itemNo = tr.children[0].querySelector('select').value;
    if (!itemNo) return;
    const inv = prInventory.find(i => String(i.itemNo) === String(itemNo));
    items.push({
      itemNo, itemName: inv ? inv.description : itemNo,
      qty: flowNum(tr.children[1].querySelector('input').value),
      uom: tr.children[2].querySelector('input').value.trim(),
      remarks: tr.children[3].querySelector('input').value.trim()
    });
  });
  return items;
}

async function saveRequest() {
  const items = collectItems();
  const customer = document.getElementById('customer').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer is required.', false); return; }
  if (!items.length) { flowMsg('formMsg', 'Add at least one item.', false); return; }
  const btn = document.getElementById('saveBtn');
  const date = document.getElementById('date').value;
  const payload = {
    customer, date, notes: document.getElementById('notes').value.trim(),
    requestedBy: prSession.name, items: JSON.stringify(items)
  };
  btn.disabled = true; btn.textContent = 'Submitting...';
  try {
    const res = await postFlow('createPricingRequest', payload);
    if (!res.success) throw new Error(res.message);
    resetForm();
    // Auto-generate the branded PR PDF and save it to Drive + the PDF Link column (best-effort,
    // never blocks creation). No tab pops open (background) — it's an automatic archive on creation.
    let extra = '';
    try {
      btn.textContent = 'Saving PDF...';
      const { link } = await generateFlowPdf('/flow/pr-pdf',
        { prNo: res.prNo, customer, date, requestedBy: prSession.name,
          items: items.map(i => ({ itemNo: i.itemNo, itemName: i.itemName, qty: i.qty, uom: i.uom, remarks: i.remarks })) },
        'savePRPDF', 'prNo', res.prNo, `Purchase_Request_${res.prNo}.pdf`, { background: true });
      extra = link ? ' · PDF saved to Drive' : ' · PDF pending (generate later if needed)';
    } catch (e) { extra = ' · PDF could not be generated (you can generate it later)'; }
    flowMsg('formMsg', `${res.message} (${res.prNo})${extra}`, true);
    await loadRequests();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Submit to Admin'; }
}

function resetForm() {
  document.getElementById('prNo').value = '';
  document.getElementById('customer').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('date').value = flowToday();
  document.getElementById('itemRows').innerHTML = '';
  document.getElementById('formMsg').style.display = 'none';
  addRow();
}

// ─── List / queue ────────────────────────────────
async function loadRequests() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const params = prRole === 'sales' ? { requestedBy: prSession.name } : {};
    const res = await fetchFlow('getPricingRequests', params);
    prList = (res && res.data) || [];
    renderList();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function filteredList() {
  if (!prFilter) return prList;
  const wanted = prFilter.split(',');
  return prList.filter(r => wanted.includes(r.status));
}

function prRowHtml(r) {
  const incl = r.items.filter(i => i.included).length;
  return `<tr><td>${flowEsc(r.prNo)}</td><td>${flowDate(r.date)}</td><td>${flowEsc(r.customer)}</td>
    <td>${flowEsc(r.requestedBy)}</td><td class="num">${incl}/${r.items.length}</td>
    <td><span class="flow-badge ${BADGE[r.status] || 'b-open'}">${flowEsc(r.status)}</span></td>
    <td style="white-space:nowrap;">${rowActions(r)}</td></tr>`;
}

function prTableHtml(rows) {
  return `<table class="flow-table"><thead><tr>
    <th>PR No</th><th>Date</th><th>Customer</th><th>Requested By</th><th class="num">Items</th><th>Stage</th><th></th></tr></thead>
    <tbody>${rows.map(prRowHtml).join('')}</tbody></table>`;
}

// Migrated / imported pricing history (old records) — kept separate from live requests.
function prIsMigrated(r) { return r.status === 'Migrated' || !!r.legacyId; }
// Newest-first: by date desc, then PR No desc (same ordering as the Pricing History section).
function prSortNewest(rows) {
  return rows.slice().sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) || String(b.prNo).localeCompare(String(a.prNo)));
}

// A collapsible section (reuses .rep-group) with a title, count, and a PR table.
function prGroupSection(title, rows, opts) {
  opts = opts || {};
  if (!rows.length) return '';
  return `<details class="${opts.history ? 'rep-group pr-history-group' : 'rep-group'}"${opts.open ? ' open' : ''}>
    <summary><span class="rep-name">${flowEsc(title)}</span>
      <span class="rep-meta">${rows.length} request(s)</span></summary>
    <div style="overflow-x:auto;margin-top:0.5rem;">${prTableHtml(prSortNewest(rows))}</div>
  </details>`;
}

// Admin "All": stage-grouped sections (newest-first), migrated/old history separated to the bottom.
function renderAdminAllGrouped(rows) {
  const active = rows.filter(r => !prIsMigrated(r));
  const migrated = rows.filter(prIsMigrated);
  const GROUPS = [
    ['For Supplier Pricing', ['Requested', 'Sourcing', 'For Mgmt Pricing']],
    ['Final Pricing — from Management', ['Mgmt Priced']],
    ['Forwarded to Sales', ['Returned to Sales', 'Quoted']],
  ];
  const known = GROUPS.reduce((a, g) => a.concat(g[1]), []);
  let html = GROUPS.map(g => prGroupSection(g[0], active.filter(r => g[1].includes(r.status)), { open: true })).join('');
  const other = active.filter(r => !known.includes(r.status));
  html += prGroupSection('Other', other, { open: true });
  html += prGroupSection('Migrated / Old History', migrated, { history: true });
  return html || '<p style="color:var(--text-muted,#64748b);">Nothing here.</p>';
}

function renderList() {
  const c = document.getElementById('listContainer');
  const rows = filteredList();
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">Nothing here.</p>'; return; }
  // Admin "All": organize by stage + separate migrated/old history.
  if (prRole === 'admin' && !prFilter) { c.innerHTML = renderAdminAllGrouped(rows); return; }
  if (prOversight) {
    // Group by sales rep; within each, newest-first with migrated rows pushed to the bottom.
    const groups = {};
    rows.forEach(r => { const k = r.requestedBy || 'Unassigned'; (groups[k] = groups[k] || []).push(r); });
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    c.innerHTML = names.map((name, i) => {
      const g = prSortNewest(groups[name].filter(r => !prIsMigrated(r)))
        .concat(prSortNewest(groups[name].filter(prIsMigrated)));
      return `<details class="rep-group"${i === 0 ? ' open' : ''}>
      <summary><span class="rep-name">${flowEsc(name)}</span>
        <span class="rep-meta">${g.length} request(s)</span></summary>
      <div style="overflow-x:auto;margin-top:0.5rem;">${prTableHtml(g)}</div>
    </details>`;
    }).join('');
    return;
  }
  c.innerHTML = prTableHtml(prSortNewest(rows));
}

function rowActions(r) {
  const open = `<button class="link-btn" onclick='openPr("${flowEsc(r.prNo)}")'>Open</button>`;
  const docs = ` <button class="link-btn" onclick='openDocsModal("Pricing Request","${flowEsc(r.prNo)}")' style="margin-left:0.5rem;">Docs</button>`;
  // PR PDFs are auto-saved to Drive on creation — show the View link on ANY row that has one
  // (sales "My Requests" and the admin/oversight lists alike).
  const view = r.pdfLink
    ? ` <a class="link-btn" href="${flowEsc(r.pdfLink)}" target="_blank" style="margin-left:0.5rem;">View PDF</a>` : '';
  if (prRole === 'sales' && r.status === 'Returned to Sales')
    return open + docs + ` <button class="link-btn" onclick='openPdf("${flowEsc(r.prNo)}")' style="margin-left:0.5rem;">PR PDF</button>` + view;
  return open + docs + view;
}

// ─── Detail / action modal ───────────────────────
function curPr(no) { return prList.find(r => String(r.prNo) === String(no)); }

function openPr(no) {
  const r = curPr(no);
  if (!r) return;
  // Management uses the always-on page-level pricing engine (not the modal) to price / re-price.
  if (prRole === 'management') { loadFlowPricing(no); return; }
  document.getElementById('modalPrNo').value = no;
  document.getElementById('modalTitle').textContent = r.prNo;
  document.getElementById('modalSub').textContent = `${r.customer}${r.clientLocation ? ' (' + r.clientLocation + ')' : ''} · requested by ${r.requestedBy} · ${flowDate(r.date)} · ${r.status}`;
  document.getElementById('modalMsg').style.display = 'none';
  const body = document.getElementById('modalBody');
  const foot = document.getElementById('modalFoot');

  if (canSource && (r.status === 'Requested' || r.status === 'Sourcing')) {
    body.innerHTML = sourcingTable(r);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      <button class="btn btn-secondary" onclick="openDocsModal('Pricing Request','${flowEsc(r.prNo)}','Supplier quotation · ${flowEsc(r.prNo)}')">📎 Supplier Quotation (PDF)</button>
      <button class="btn btn-secondary" onclick="saveSourcing(false)">Save Draft</button>
      <button class="btn btn-primary" onclick="saveSourcing(true)">Forward to Management</button>`;
  } else if (canPrice && r.status === 'For Mgmt Pricing') {
    body.innerHTML = pricingPanel(r);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      <button class="btn btn-primary" onclick="savePricing()">Return to Admin (priced)</button>`;
    // Seed forex/duties from the principal once on open (mUpdateReadouts no longer auto-seeds on empty).
    setTimeout(() => { mUpdateReadouts(true); recalcPricing(); }, 0);
    peLoadPriceHistory(r.customer);
  } else if (canSource && r.status === 'Mgmt Priced') {
    body.innerHTML = verifyTable(r);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      <button class="btn btn-primary" onclick="verifyReturn()">Verify &amp; Return to Sales</button>`;
  } else if (r.status === 'Returned to Sales' &&
             (prRole === 'sales' || (prRole === 'admin' && String(r.requestedBy) === String(prSession.name)))) {
    // Sales, or the admin who created this PR, can build the quotation from the returned (priced) request.
    body.innerHTML = readonlyTable(r, true);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      <button class="btn btn-secondary" onclick="openPdf('${flowEsc(no)}')">Generate PR PDF</button>
      <button class="btn btn-primary" onclick="makeQuotation('${flowEsc(no)}')">Create Quotation</button>`;
  } else {
    body.innerHTML = readonlyTable(r, false);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>`;
  }
  document.getElementById('prModal').classList.add('open');
}
function closePr() { document.getElementById('prModal').classList.remove('open'); }

function readonlyTable(r, priced) {
  return `<div style="overflow-x:auto;"><table class="flow-table"><thead><tr><th>Item</th><th class="num">Qty</th><th>UOM</th>
    <th>Supplier</th><th>Principal</th>${priced ? '<th class="num">Final Price</th>' : ''}<th>Incl?</th></tr></thead><tbody>${r.items.map(i =>
    `<tr><td>${flowEsc(i.itemNo)} — ${flowEsc(i.itemName)}</td><td class="num">${flowNum(i.qty)}</td><td>${flowEsc(i.uom)}</td>
      <td>${flowEsc(i.supplier || '—')}</td><td>${flowEsc(i.principal || '—')}</td>
      ${priced ? `<td class="num">${i.finalPrice ? flowMoney(i.finalPrice, 'PHP') : '—'}</td>` : ''}
      <td>${i.included ? '✓' : '—'}</td></tr>`).join('')}</tbody></table></div>
    ${r.clientLocation ? `<p class="pr-meta" style="margin-top:0.5rem;">Client Location: <b>${flowEsc(r.clientLocation)}</b></p>` : ''}
    ${r.notes ? `<p class="pr-meta" style="margin-top:0.5rem;">Notes: <b>${flowEsc(r.notes)}</b></p>` : ''}`;
}

// ── Admin sourcing ──
function principalSelect(sel) {
  return '<option value="">—</option>' + FLOW_PRINCIPALS.map(p =>
    `<option value="${flowEsc(p.name)}"${p.name === sel ? ' selected' : ''}>${flowEsc(p.name)} (${flowEsc(p.currency)})</option>`).join('');
}
function currencySelect(sel) {
  const cur = sel || 'PHP';
  return FLOW_CURRENCIES.map(c => `<option value="${c}"${c === cur ? ' selected' : ''}>${c}</option>`).join('');
}

function sourcingTable(r) {
  return `<div style="margin-bottom:0.75rem;">
      <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.25rem;">Client Location</label>
      <input type="text" id="srcLocation" value="${flowEsc(r.clientLocation || '')}" placeholder="e.g. Cebu City, Cebu"
        style="width:100%;max-width:420px;padding:0.45rem 0.6rem;border:1px solid var(--border,#e2e8f0);border-radius:8px;">
    </div>
    <p class="pr-meta">Set the supplier, principal, currency, supplier price (FC) and CBM per item. You can also correct the product description — it updates the quotation. Untick items that won't be quoted.</p>
    <div style="overflow-x:auto;"><table class="flow-table" id="srcTable" style="min-width:860px;"><thead><tr>
      <th>Item No</th><th>Product Description</th><th class="num">Qty</th><th>Supplier</th><th>Principal</th><th>Cur</th>
      <th class="num">Price (FC)</th><th class="num">CBM</th><th>Incl</th></tr></thead><tbody>${r.items.map(i =>
      `<tr data-line="${i.line}">
        <td>${flowEsc(i.itemNo)}</td>
        <td><input type="text" class="s-name" value="${flowEsc(i.itemName || '')}" style="min-width:200px;"></td>
        <td class="num">${flowNum(i.qty)}</td>
        <td><input type="text" class="s-sup" value="${flowEsc(i.supplier || '')}"></td>
        <td><select class="s-prin">${principalSelect(i.principal)}</select></td>
        <td><select class="s-cur">${currencySelect(i.currency)}</select></td>
        <td class="num"><input type="number" step="any" min="0" class="s-price" value="${i.supplierPrice || 0}"></td>
        <td class="num"><input type="number" step="any" min="0" class="s-cbm" value="${i.cbm || 0}"></td>
        <td><input type="checkbox" class="s-incl"${i.included ? ' checked' : ''}></td></tr>`).join('')}</tbody></table></div>`;
}

function collectSourcing() {
  const updates = [];
  document.querySelectorAll('#srcTable tbody tr').forEach(tr => {
    updates.push({
      line: flowNum(tr.getAttribute('data-line')),
      itemName: tr.querySelector('.s-name').value.trim(),
      included: tr.querySelector('.s-incl').checked,
      supplier: tr.querySelector('.s-sup').value.trim(),
      principal: tr.querySelector('.s-prin').value,
      currency: tr.querySelector('.s-cur').value,
      supplierPrice: flowNum(tr.querySelector('.s-price').value),
      cbm: flowNum(tr.querySelector('.s-cbm').value)
    });
  });
  return updates;
}

async function saveSourcing(forward) {
  const prNo = document.getElementById('modalPrNo').value;
  const locEl = document.getElementById('srcLocation');
  const clientLocation = locEl ? locEl.value.trim() : '';
  try {
    const res = await postFlow('updatePRSourcing', { prNo, clientLocation, items: JSON.stringify(collectSourcing()) });
    if (!res.success) throw new Error(res.message);
    if (forward) {
      const f = await postFlow('submitForPricing', { prNo });
      if (!f.success) throw new Error(f.message);
      flowMsg('modalMsg', 'Forwarded to management.', true);
    } else {
      flowMsg('modalMsg', 'Sourcing saved.', true);
    }
    await loadRequests();
    if (forward) setTimeout(closePr, 800);
  } catch (e) { flowMsg('modalMsg', e.message, false); }
}

// ── Management pricing (full engine: editable inputs + breakdown + P&L) ──
function pePrincipalSelect(sel) {
  return '<option value="">— none —</option>' + FLOW_PRINCIPALS.map(p =>
    `<option value="${flowEsc(p.name)}"${p.name === sel ? ' selected' : ''}>${flowEsc(p.name)} (${flowEsc(p.currency)})</option>`).join('');
}

// Management pricing step rendered in the ORIGINAL pricing-engine design (config grid + readouts +
// line-item input table + wide breakdown table + P&L), driven by the identical flowCalcItem math and the
// existing flow wiring (loads the PR's included items, saves via setMgmtPricing).
let _pePriceHist = {};

// One editable line row for the calculator (old-engine layout: Model / Desc / Buy / Disc / Qty / CBM).
// `i` is a PR item (carries `line`/`itemNo` for save) or a blank added row; `pf` prefills on re-price.
function peRowHtml(i, idx, pf) {
  i = i || {}; pf = pf || {};
  const line = (i.line != null && i.line !== '') ? i.line : '';   // blank = calculator-only (Add Item)
  const model = i.itemNo != null ? i.itemNo : (i.modelNo || '');
  const name = i.itemName != null ? i.itemName : (i.name || '');
  const buy = pf.buyPrice != null ? pf.buyPrice : (i.supplierPrice != null ? i.supplierPrice : (i.buyPrice || 0));
  const disc = pf.discount != null ? pf.discount : (i.discount || 0);
  const qty = pf.qty != null ? pf.qty : (i.qty != null ? flowNum(i.qty) : 1);
  const cbm = pf.cbm != null ? pf.cbm : (i.cbm || 0);
  return `<tr${line !== '' ? ` data-line="${line}"` : ''}>
      <td style="text-align:center;color:var(--text-muted);">${idx + 1}</td>
      <td><input type="text" class="pe-model" value="${flowEsc(model)}" placeholder="Model No." oninput="recalcPricing()"></td>
      <td><input type="text" class="pe-name" value="${flowEsc(name)}" placeholder="Item description" oninput="recalcPricing()"></td>
      <td><input type="number" step="any" min="0" class="pe-buy" value="${buy}" placeholder="0.00" oninput="recalcPricing()"></td>
      <td><input type="number" step="any" min="0" class="pe-disc" value="${disc}" placeholder="0" oninput="recalcPricing()"></td>
      <td><input type="number" step="any" min="0" class="pe-qty" value="${qty}" placeholder="1" oninput="recalcPricing()"></td>
      <td><input type="number" step="any" min="0" class="pe-cbm" value="${cbm}" placeholder="0" oninput="recalcPricing()"></td>
      <td style="text-align:center;"><button type="button" class="pe-remove" title="Remove" onclick="this.closest('tr').remove();recalcPricing();">✕</button></td>
    </tr>`;
}

function pricingPanel(r) {
  const inc = (r.items || []).filter(i => i.included);
  const gPrin = r._principal || (inc.find(i => i.principal) || {}).principal || '';
  const prinOpts = pePrincipalSelect(gPrin);
  const destOpts = '<option value="">— None (Local Pickup) —</option>' + FLOW_DESTINATIONS.map(d =>
    `<option value="${flowEsc(d.name)}"${d.name === r.destination ? ' selected' : ''}>${flowEsc(d.name)}</option>`).join('');
  const rows = inc.map((i, idx) => peRowHtml(i, idx)).join('');
  return `
    <div class="group-title">Configuration</div>
    <div class="pe-config-grid">
      <div><label>Principal / Supplier</label><select id="mPrincipal" onchange="mUpdateReadouts(true);recalcPricing();">${prinOpts}</select></div>
      <div><label>Delivery Destination</label><select id="mDest" onchange="mUpdateReadouts();recalcPricing();">${destOpts}</select></div>
      <div><label>Commission Rate (%)</label><input type="number" step="0.1" min="0" max="99" id="mComm" value="${r.commission || 5}" oninput="recalcPricing()"></div>
      <div><label>Profit Margin Rate (%)</label><input type="number" step="0.1" min="0" max="99" id="mMarg" value="${r.margin || 30}" oninput="recalcPricing()"></div>
    </div>
    <div class="pe-readout">
      <div class="pe-ro-item"><span class="pe-ro-label">Currency</span><span class="pe-ro-value" id="mCurrency">—</span></div>
      <div class="pe-ro-item"><span class="pe-ro-label">Forex Rate</span><span class="pe-ro-value" style="display:flex;align-items:center;gap:0.35rem;">
        <span id="mForexPrefix">1 — = ₱</span>
        <input type="number" id="mForex" step="0.0001" min="0" value="" placeholder="—" oninput="recalcPricing()"
               style="width:5.5rem;padding:0.2rem 0.4rem;border:1px solid var(--border,#cbd5e1);border-radius:4px;font-size:0.85rem;font-weight:600;"></span></div>
      <div class="pe-ro-item"><span class="pe-ro-label">Shipping &amp; Duties</span><span class="pe-ro-value" style="display:flex;align-items:center;gap:0.25rem;">
        <input type="number" id="mDuties" step="0.1" min="0" max="100" value="" placeholder="—" oninput="recalcPricing()"
               style="width:4.5rem;padding:0.2rem 0.4rem;border:1px solid var(--border,#cbd5e1);border-radius:4px;font-size:0.85rem;font-weight:600;"><span>%</span></span></div>
      <div class="pe-ro-item"><span class="pe-ro-label">Origin</span><span class="pe-ro-value" id="mOrigin">—</span></div>
      <div class="pe-ro-item"><span class="pe-ro-label">CBM Rate</span><span class="pe-ro-value" id="peCbmRate">—</span></div>
      <div class="pe-ro-item"><span class="pe-ro-label">Min Delivery</span><span class="pe-ro-value" id="peMinDeliv">—</span></div>
    </div>
    <div class="group-title">Line Items</div>
    <div style="overflow-x:auto;"><table class="pe-line-table"><thead><tr>
      <th style="width:30px;">#</th><th style="width:130px;">Model No.</th><th>Item Description</th>
      <th style="width:110px;">Buy Price</th><th style="width:80px;">Discount %</th><th style="width:64px;">Qty</th>
      <th style="width:74px;">CBM</th><th style="width:36px;"></th>
    </tr></thead><tbody id="peRows">${rows || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:1rem;">No items. Click “Add Item” to begin.</td></tr>'}</tbody></table></div>
    <div style="margin-top:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
      <button type="button" class="btn btn-sm btn-secondary" onclick="mAddItem()">+ Add Item</button>
      <button type="button" class="btn btn-sm btn-secondary" onclick="mClearItems()">Clear All</button>
    </div>
    <div class="group-title">Pricing Breakdown</div>
    <div class="pe-results-wrap"><table class="pe-results-table"><thead><tr>
      <th>#</th><th>Model No.</th><th>Item</th><th>Qty</th><th>Disc.</th><th>Buy (PHP)</th><th>Brokerage</th>
      <th>Landed</th><th>Delivery</th><th>COGS</th><th>Commission</th><th>Profit</th>
      <th>Unit (VAT Excl.)</th><th>Unit (VAT Incl.)</th><th>Total + VAT</th><th>Last Price</th>
    </tr></thead><tbody id="peResults"></tbody></table></div>
    <div class="group-title">Profit &amp; Loss Summary</div>
    <div id="pePnl"></div>
    <p class="pr-meta">Final price is VAT-exclusive per unit; the quotation applies its own VAT. Added items (no PR line) are calculator-only — they show in the breakdown but are not saved to the request.</p>`;
}

// Update the Configuration readouts from the selected principal/destination (mirror old updateReadouts).
function mUpdateReadouts(resetRates) {
  const p = flowPrincipalByName((document.getElementById('mPrincipal') || {}).value || '');
  const dEl = document.getElementById('mDest');
  const d = flowDestinationByName(dEl ? dEl.value : '');
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('mCurrency', p ? p.currency : '—');
  set('mOrigin', p ? p.origin : '—');
  const pfx = document.getElementById('mForexPrefix'); if (pfx) pfx.textContent = p ? `1 ${p.currency} = ₱` : '1 — = ₱';
  const fx = document.getElementById('mForex'), du = document.getElementById('mDuties');
  // Only (re)seed the editable rate inputs on an intentional reset (principal change / load) — NOT on
  // every recalc, otherwise clearing the field to empty snaps it back to the default and the last digit
  // can never be deleted.
  if (fx && resetRates) fx.value = p ? p.forex : '';
  if (du && resetRates) du.value = p ? p.dutiesPct : '';
  set('peCbmRate', d ? flowMoney(d.cbmRate, 'PHP') + '/CBM' : '—');
  set('peMinDeliv', d ? flowMoney(d.minCharge, 'PHP') : '—');
}

// Add a blank calculator row (no PR line — informational only) / clear all rows.
function mAddItem() {
  const tb = document.getElementById('peRows'); if (!tb) return;
  if (tb.querySelector('td[colspan]')) tb.innerHTML = '';
  const idx = tb.querySelectorAll('tr').length;
  tb.insertAdjacentHTML('beforeend', peRowHtml({}, idx));
  recalcPricing();
}
function mClearItems() {
  const tb = document.getElementById('peRows'); if (!tb) return;
  tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:1rem;">No items. Click “Add Item” to begin.</td></tr>';
  recalcPricing();
}

function _peNum(row, cls) { const el = row.querySelector(cls); return el ? flowNum(el.value) : 0; }

// Load the last quoted unit price (VAT-ex) per model — the old engine's price-history hint. Best-effort:
// needs the legacy Price History backend (apiGetPriceHistory). Stored in a map and painted by recalc.
async function peLoadPriceHistory(clientName) {
  _pePriceHist = {};
  if (typeof apiGetPriceHistory !== 'function') return;
  try {
    const r = await apiGetPriceHistory(clientName || '');
    const list = (r && r.success && r.data) || (r && r.data) || [];
    list.forEach(h => { if (h && h.modelNo) _pePriceHist[String(h.modelNo)] = h; });
  } catch (e) { return; }
  recalcPricing();
}

// ─── Always-on management pricing engine (page-level, load a request to price / re-price) ───
let pePrNo = null;               // the PR currently loaded into the calculator (null = blank)
let _pricingHistory = [];        // priced/migrated requests shown in the Pricing History section

// Render the empty calculator shell (config + readouts + empty line table + results + P&L).
function renderMgmtEngineShell() {
  const body = document.getElementById('mgmtEngineBody');
  if (body) body.innerHTML = pricingPanel({ items: [], commission: 5, margin: 30, destination: '' });
}

// Reset the engine to a blank state.
function clearFlowPricing() {
  pePrNo = null;
  renderMgmtEngineShell();
  const banner = document.getElementById('peEditBanner'); if (banner) banner.style.display = 'none';
  const sb = document.getElementById('peSaveBtn'); if (sb) sb.disabled = true;
  const db = document.getElementById('peDocsBtn'); if (db) db.disabled = true;
  const msg = document.getElementById('peMsg'); if (msg) msg.style.display = 'none';
}

// View the supplier-quotation PDF(s) the admin attached to the loaded request (forwarded via Docs).
function peViewDocs() {
  if (!pePrNo) return;
  openDocsModal('Pricing Request', pePrNo, 'Supplier quotation · ' + pePrNo);
}

// Load a request's items + saved pricing into the calculator (to price, or re-price a past one).
function loadFlowPricing(prNo) {
  const r = curPr(prNo) || _pricingHistory.find(x => String(x.prNo) === String(prNo));
  if (!r) return;
  pePrNo = String(prNo);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  // Global principal: from the PR's sourcing (first included item), else blank.
  const inc = (r.items || []).filter(i => i.included);
  const gPrin = (inc.find(i => i.principal) || {}).principal || '';
  set('mPrincipal', gPrin);
  set('mDest', r.destination || '');
  set('mComm', r.commission || 5);
  set('mMarg', r.margin || 30);
  // Prefill rows from the saved breakdown when re-pricing (buy/discount/qty/cbm).
  let bd = [];
  try { bd = JSON.parse(r.pricedItemsJson || r.legacyItemsJson || '[]'); } catch (e) { bd = []; }
  const bdBy = {}; bd.forEach(b => { const k = String((b && (b.modelNo || b.itemNo)) || ''); if (k) bdBy[k] = b; });
  // Seed Forex/Duties from the principal; if re-pricing, override from the saved breakdown.
  mUpdateReadouts(true);
  if (bd.length && bd[0]) {
    if (bd[0].forex != null) set('mForex', bd[0].forex);
    if (bd[0].dutiesPct != null) set('mDuties', bd[0].dutiesPct);
  }
  const rowsHtml = inc.map((i, idx) => {
    const b = bdBy[String(i.itemNo)] || {};
    return peRowHtml(i, idx, {
      buyPrice: (b.buyPrice != null ? b.buyPrice : i.supplierPrice),
      discount: b.discount, qty: i.qty, cbm: (b.cbm != null ? b.cbm : i.cbm)
    });
  }).join('');
  const rowsEl = document.getElementById('peRows');
  if (rowsEl) rowsEl.innerHTML = rowsHtml || '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:1rem;">No included items to price.</td></tr>';
  const banner = document.getElementById('peEditBanner');
  if (banner) { banner.style.display = 'flex'; const id = document.getElementById('peEditId'); if (id) id.textContent = `${r.prNo} · ${r.customer || ''} · ${flowEsc(r.status || '')}`; }
  const sb = document.getElementById('peSaveBtn'); if (sb) sb.disabled = false;
  const db = document.getElementById('peDocsBtn'); if (db) db.disabled = false;
  recalcPricing();
  peLoadPriceHistory(r.customer);
  const card = document.getElementById('mgmtEngineCard');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function recalcPricing() {
  const destEl = document.getElementById('mDest');
  if (!destEl) return;
  mUpdateReadouts();
  const principal = flowPrincipalByName((document.getElementById('mPrincipal') || {}).value || '');
  const dest = flowDestinationByName(destEl.value);
  const comm = flowNum(document.getElementById('mComm').value);
  const marg = flowNum(document.getElementById('mMarg').value);
  const override = { forex: flowNum(document.getElementById('mForex').value), dutiesPct: flowNum(document.getElementById('mDuties').value) };
  const M = v => flowMoney(v, 'PHP');
  const t = { revenue: 0, vat: 0, netSales: 0, cogs: 0, commission: 0, localTax: 0, delivery: 0 };
  let html = '';
  document.querySelectorAll('#peRows tr').forEach((tr, idx) => {
    if (!tr.querySelector('.pe-buy')) return;   // skip the placeholder row
    const out = flowCalcItem(
      { buyPrice: _peNum(tr, '.pe-buy'), discount: _peNum(tr, '.pe-disc'), qty: _peNum(tr, '.pe-qty'), cbm: _peNum(tr, '.pe-cbm') },
      principal, dest, comm, marg, override
    );
    tr.setAttribute('data-final', out.unitPriceVatEx);
    const mEl = tr.querySelector('.pe-model'), nEl = tr.querySelector('.pe-name');
    const modelNo = mEl ? mEl.value : '', name = nEl ? nEl.value : '';
    const disc = _peNum(tr, '.pe-disc'), qty = _peNum(tr, '.pe-qty');
    const hist = _pePriceHist[String(modelNo)];
    const histCell = hist
      ? `<td class="td-num" style="color:#7c3aed;white-space:nowrap;" title="${flowEsc(hist.client || '')}">${M(hist.unitPriceVatEx)}</td>`
      : '<td class="td-num" style="color:var(--text-muted);">—</td>';
    html += `<tr>
      <td>${idx + 1}</td>
      <td class="td-name" title="${flowEsc(modelNo)}">${flowEsc(modelNo) || '—'}</td>
      <td class="td-name" title="${flowEsc(name)}">${flowEsc(name) || '—'}</td>
      <td class="td-num">${flowNum(qty)}</td>
      <td class="td-num">${disc > 0 ? disc + '%' : '—'}</td>
      <td class="td-num">${M(out.buyPricePHP)}</td>
      <td class="td-num">${M(out.brokerage)}</td>
      <td class="td-num">${M(out.landedCost)}</td>
      <td class="td-num">${M(out.deliveryCost)}</td>
      <td class="td-num" style="font-weight:600;">${M(out.totalCOGS)}</td>
      <td class="td-num">${M(out.commission)}</td>
      <td class="td-num">${M(out.profitMargin)}</td>
      <td class="td-num" style="font-weight:600;color:#16a34a;">${M(out.unitPriceVatEx)}</td>
      <td class="td-num" style="font-weight:700;color:var(--accent,#0f766e);">${M(out.unitPrice)}</td>
      <td class="td-num">${M(out.finalPrice)}</td>
      ${histCell}
    </tr>`;
    t.revenue += out.finalPrice; t.vat += out.vat; t.netSales += out.netSellingPrice;
    t.cogs += out.landedCost; t.commission += out.commission; t.localTax += out.localTax; t.delivery += out.deliveryCost;
  });
  const body = document.getElementById('peResults');
  if (body) body.innerHTML = html || '<tr><td colspan="16" style="text-align:center;color:var(--text-muted);padding:1rem;">Add supplier prices to see results.</td></tr>';
  renderPePnl(t, comm);
}

function renderPePnl(t, commPct) {
  const grossProfit = t.netSales - t.cogs;
  const totalExpenses = t.commission + t.localTax + t.delivery;
  const operatingIncome = grossProfit - totalExpenses;
  const incomeTax = operatingIncome * 0.25;
  const netIncome = operatingIncome - incomeTax;
  const pct = v => t.netSales > 0 ? ((v / t.netSales) * 100).toFixed(1) + '%' : '—';
  const M = v => flowMoney(v, 'PHP');
  const kpi = (l, v, p, color) => `<div class="pe-kpi"><span class="l">${l}</span><span class="v"${color ? ` style="color:${color};"` : ''}>${v}</span><span class="l" style="font-weight:600;">${p}</span></div>`;
  document.getElementById('pePnl').innerHTML = `
    <div class="pe-pnl-kpis">
      ${kpi('Gross Revenue (incl. VAT)', M(t.revenue), '112%')}
      ${kpi('Net Sales (excl. VAT)', M(t.netSales), '100%')}
      ${kpi('Total COGS', M(t.cogs), pct(t.cogs), '#f97316')}
      ${kpi('Gross Profit', M(grossProfit), pct(grossProfit), '#16a34a')}
      ${kpi('Operating Income', M(operatingIncome), pct(operatingIncome), '#2563eb')}
      ${kpi('Net Income', M(netIncome), pct(netIncome), '#9333ea')}
    </div>
    <table class="pe-pnl-table"><tbody>
      <tr><td>Sales, Gross of VAT</td><td class="n">${M(t.revenue)}</td><td class="n">112.0%</td></tr>
      <tr><td>Less: VAT (12%)</td><td class="n" style="color:#ef4444;">(${M(t.vat)})</td><td class="n">12.0%</td></tr>
      <tr class="bold"><td>Sales, Net of VAT</td><td class="n">${M(t.netSales)}</td><td class="n">100.0%</td></tr>
      <tr><td>Cost of Goods Sold</td><td class="n" style="color:#f97316;">(${M(t.cogs)})</td><td class="n">${pct(t.cogs)}</td></tr>
      <tr class="bold"><td>Gross Profit</td><td class="n" style="color:#16a34a;">${M(grossProfit)}</td><td class="n">${pct(grossProfit)}</td></tr>
      <tr><td>Commission (${flowNum(commPct)}%)</td><td class="n">(${M(t.commission)})</td><td class="n">${pct(t.commission)}</td></tr>
      <tr><td>Local Tax (2%)</td><td class="n">(${M(t.localTax)})</td><td class="n">${pct(t.localTax)}</td></tr>
      <tr><td>Delivery</td><td class="n">(${M(t.delivery)})</td><td class="n">${pct(t.delivery)}</td></tr>
      <tr class="bold"><td>Operating Income</td><td class="n" style="color:#2563eb;">${M(operatingIncome)}</td><td class="n">${pct(operatingIncome)}</td></tr>
      <tr><td>Income Tax (25%)</td><td class="n">(${M(incomeTax)})</td><td class="n">${pct(incomeTax)}</td></tr>
      <tr class="bold"><td>NET INCOME</td><td class="n" style="color:#9333ea;">${M(netIncome)}</td><td class="n">${pct(netIncome)}</td></tr>
    </tbody></table>`;
}

async function savePricing() {
  // Engine mode (always-on management page) uses pePrNo; the oversight modal uses #modalPrNo.
  const usingEngine = !!pePrNo;
  const msgEl = usingEngine ? 'peMsg' : 'modalMsg';
  const prNo = usingEngine ? pePrNo : document.getElementById('modalPrNo').value;
  const dest = document.getElementById('mDest').value;   // optional — blank = no delivery (local pickup)
  if (!prNo) { flowMsg(msgEl, 'Load a request to price first.', false); return; }
  const destObj = flowDestinationByName(dest);
  const comm = flowNum(document.getElementById('mComm').value);
  const marg = flowNum(document.getElementById('mMarg').value);
  const round2 = n => Math.round((flowNum(n)) * 100) / 100;   // match the old engine's 2-decimal rounding
  const prinName = (document.getElementById('mPrincipal') || {}).value || '';
  const principal = flowPrincipalByName(prinName);
  const override = { forex: flowNum(document.getElementById('mForex').value), dutiesPct: flowNum(document.getElementById('mDuties').value) };
  const items = [];
  const breakdown = [];   // full engine breakdown per item, preserved for the pricing history
  document.querySelectorAll('#peRows tr').forEach(tr => {
    if (!tr.querySelector('.pe-buy')) return;                 // skip placeholder
    const out = flowCalcItem(
      { buyPrice: _peNum(tr, '.pe-buy'), discount: _peNum(tr, '.pe-disc'), qty: _peNum(tr, '.pe-qty'), cbm: _peNum(tr, '.pe-cbm') },
      principal, destObj, comm, marg, override
    );
    const mEl = tr.querySelector('.pe-model'), nEl = tr.querySelector('.pe-name');
    const line = tr.getAttribute('data-line');
    // Only PR-line rows write back a Final Price; Add-Item rows are calculator-only.
    if (line != null && line !== '') items.push({
      line: flowNum(line),
      finalPrice: round2(out.unitPriceVatEx),
      principal: prinName,
      currency: principal ? principal.currency : 'PHP',
      supplierPrice: round2(_peNum(tr, '.pe-buy')),
      cbm: _peNum(tr, '.pe-cbm'),
      qty: _peNum(tr, '.pe-qty')
    });
    breakdown.push({
      modelNo: mEl ? mEl.value : '', name: nEl ? nEl.value : '',
      qty: _peNum(tr, '.pe-qty'), buyPrice: round2(_peNum(tr, '.pe-buy')), discount: _peNum(tr, '.pe-disc'),
      cbm: _peNum(tr, '.pe-cbm'), forex: out.forexRate, dutiesPct: out.dutiesPct,
      buyPricePHP: round2(out.buyPricePHP), brokerage: round2(out.brokerage), landedCost: round2(out.landedCost),
      deliveryCost: round2(out.deliveryCost), totalCOGS: round2(out.totalCOGS), netSellingPrice: round2(out.netSellingPrice),
      commission: round2(out.commission), profitMargin: round2(out.profitMargin), localTax: round2(out.localTax),
      vat: round2(out.vat), finalPrice: round2(out.finalPrice), unitPrice: round2(out.unitPrice), unitPriceVatEx: round2(out.unitPriceVatEx)
    });
  });
  try {
    const res = await postFlow('setMgmtPricing', {
      prNo, destination: dest, commission: comm, margin: marg,
      items: JSON.stringify(items), pricedItemsJson: JSON.stringify(breakdown)
    });
    if (!res.success) throw new Error(res.message);
    flowMsg(msgEl, 'Priced and returned to admin.', true);
    await loadRequests();
    if (usingEngine) { loadFlowPricingHistory(); setTimeout(clearFlowPricing, 900); }
    else { setTimeout(closePr, 800); }
  } catch (e) { flowMsg(msgEl, e.message, false); }
}

// ─── Pricing History (new-flow: priced + migrated requests) with reload-to-re-price ───
function loadFlowPricingHistory() {
  const priced = ['Mgmt Priced', 'Verifying', 'Returned to Sales', 'Quoted'];
  _pricingHistory = (prList || []).filter(r => priced.includes(r.status) || r.legacyId || r.status === 'Migrated')
    .slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.prNo).localeCompare(String(a.prNo)));
  renderPricingHistoryTable();
}

function applyPricingHistoryFilter() { renderPricingHistoryTable(); }
function clearPricingHistoryFilters() {
  ['phClient', 'phMonth', 'phStatus'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderPricingHistoryTable();
}
function togglePricingHistory() {
  const c = document.getElementById('pricingHistoryContent'), ic = document.getElementById('phToggleIcon');
  if (!c) return;
  const open = c.style.display !== 'none';
  c.style.display = open ? 'none' : '';
  if (ic) ic.style.transform = open ? '' : 'rotate(180deg)';
}

function renderPricingHistoryTable() {
  const el = document.getElementById('pricingHistoryList');
  if (!el) return;
  const client = (document.getElementById('phClient') || {}).value || '';
  const month = (document.getElementById('phMonth') || {}).value || '';
  const status = (document.getElementById('phStatus') || {}).value || '';
  const cl = client.toLowerCase().trim();
  const list = _pricingHistory.filter(r => {
    if (status && String(r.status) !== status) return false;
    if (month && String(r.date || '').slice(0, 7) !== month) return false;
    if (cl && !String(r.customer || '').toLowerCase().includes(cl)) return false;
    return true;
  });
  if (!list.length) { el.innerHTML = '<p style="color:var(--text-muted,#64748b);font-size:0.82rem;">No pricing history matches.</p>'; return; }
  const rows = list.map((r, i) => {
    const badge = r.status === 'Migrated' || r.legacyId
      ? '<span class="flow-badge" style="background:rgba(13,148,136,0.14);color:#0f766e;">Migrated</span>'
      : `<span class="flow-badge ${BADGE[r.status] || 'b-pending'}">${flowEsc(r.status)}</span>`;
    return `<tr class="ph-row">
        <td><strong>${flowEsc(r.prNo)}</strong>${r.legacyId ? `<div style="font-size:0.68rem;color:var(--text-muted,#64748b);">${flowEsc(r.legacyId)}</div>` : ''}</td>
        <td>${flowEsc(flowDate(r.date) || '')}</td>
        <td>${flowEsc(r.customer || '—')}</td>
        <td class="num">${(r.items || []).length}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap;">
          <button class="link-btn" onclick="togglePhDetail(${i})">Breakdown</button>
          <button class="link-btn" style="margin-left:0.5rem;" onclick="loadFlowPricing('${flowEsc(r.prNo)}')">Reload / Re-price</button>
        </td></tr>
      <tr id="phDetail${i}" style="display:none;"><td colspan="6" style="background:var(--bg-inset,#f8fafc);">${phDetailHtml(r)}</td></tr>`;
  }).join('');
  el.innerHTML = `<div style="overflow-x:auto;"><table class="flow-table"><thead><tr>
    <th>PR No</th><th>Date</th><th>Customer</th><th class="num">Items</th><th>Status</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function togglePhDetail(i) {
  const row = document.getElementById('phDetail' + i);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

// Full per-item breakdown for a history row (from the saved priced/legacy breakdown JSON).
function phDetailHtml(r) {
  let bd = [];
  try { bd = JSON.parse(r.pricedItemsJson || r.legacyItemsJson || '[]'); } catch (e) { bd = []; }
  const head = `<div style="font-size:0.72rem;color:var(--text-muted,#64748b);margin:0.4rem 0;">
    Destination: <strong>${flowEsc(r.destination || '—')}</strong> · Commission: <strong>${flowNum(r.commission)}%</strong> · Margin: <strong>${flowNum(r.margin)}%</strong></div>`;
  if (bd.length) {
    const M = v => flowMoney(flowNum(v), 'PHP');
    const cols = [['modelNo', 'Model'], ['name', 'Name'], ['qty', 'Qty'], ['buyPrice', 'Buy'], ['landedCost', 'Landed'], ['totalCOGS', 'COGS'], ['commission', 'Comm'], ['profitMargin', 'Margin'], ['vat', 'VAT'], ['unitPriceVatEx', 'Unit (VAT-ex)'], ['finalPrice', 'Final']];
    const body = bd.map(it => '<tr>' + cols.map(([k]) => {
      if (k === 'modelNo' || k === 'name') return `<td>${flowEsc(it[k] || '—')}</td>`;
      if (k === 'qty') return `<td class="num">${flowNum(it[k])}</td>`;
      return `<td class="num">${M(it[k])}</td>`;
    }).join('') + '</tr>').join('');
    return head + `<div style="overflow-x:auto;"><table class="flow-table" style="font-size:0.76rem;">
      <thead><tr>${cols.map(([, l]) => `<th${l === 'Model' || l === 'Name' ? '' : ' class="num"'}>${l}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }
  const items = (r.items || []);
  const body = items.map(it => `<tr><td>${flowEsc(it.itemNo || '—')}</td><td>${flowEsc(it.itemName || '—')}</td>
    <td class="num">${flowNum(it.qty)}</td><td>${flowEsc(it.principal || '—')}</td><td class="num">${flowMoney(flowNum(it.finalPrice), 'PHP')}</td></tr>`).join('');
  return head + `<div style="overflow-x:auto;"><table class="flow-table" style="font-size:0.78rem;">
    <thead><tr><th>Item No</th><th>Name</th><th class="num">Qty</th><th>Principal</th><th class="num">Final Price</th></tr></thead>
    <tbody>${body || '<tr><td colspan="5">No item detail.</td></tr>'}</tbody></table></div>`;
}

// ── Admin verify ──
function verifyTable(r) {
  return `<p class="pr-meta">Review the final prices from management. Confirm to return the request to sales.</p>
    ${readonlyTable(r, true)}
    <div class="full" style="margin-top:0.6rem;"><label>Verification note (optional)</label><input type="text" id="vNote" placeholder="e.g. Checked OK"></div>`;
}
async function verifyReturn() {
  const prNo = document.getElementById('modalPrNo').value;
  const noteEl = document.getElementById('vNote');
  try {
    const res = await postFlow('verifyReturnToSales', { prNo, notes: noteEl ? noteEl.value.trim() : '' });
    if (!res.success) throw new Error(res.message);
    flowMsg('modalMsg', 'Returned to sales.', true);
    await loadRequests();
    setTimeout(closePr, 800);
  } catch (e) { flowMsg('modalMsg', e.message, false); }
}

// ── Sales: create quotation ──
// Open the quotation form pre-loaded with this PR's included items + management final prices so the
// rep can see/review the prices before creating (the form's Save routes through createQuotationFromPR).
function makeQuotation(no) {
  window.location.href = 'flow-quotations.html?fromPR=' + encodeURIComponent(no);
}

// ─── PR PDF (identical legacy layout) ────────────
function openPdf(no) {
  const r = curPr(no);
  if (!r) return;
  document.getElementById('pdfPrNo').value = no;
  document.getElementById('pdfModalSub').textContent = `${r.prNo} · ${r.customer} · ${r.items.length} item(s)`;
  const d = flowLoadDefaults('pr');
  document.getElementById('pdfCompanyName').value = d.CompanyName || r.customer || '';
  ['CompanyAddress', 'ContactPerson', 'Designation', 'ContactEmail', 'ContactPhone',
   'PreparedByName', 'PreparedByPosition'].forEach(f => {
    const el = document.getElementById('pdf' + f);
    if (el && d[f] !== undefined && d[f] !== '') el.value = d[f];
  });
  if (!document.getElementById('pdfPreparedByName').value) document.getElementById('pdfPreparedByName').value = r.requestedBy || prSession.name;
  document.getElementById('pdfModalMsg').style.display = 'none';
  document.getElementById('pdfModal').classList.add('open');
}
function closePdfModal() { document.getElementById('pdfModal').classList.remove('open'); }

async function submitPrPdf() {
  const no = document.getElementById('pdfPrNo').value;
  const r = curPr(no);
  if (!r) return;
  const btn = document.getElementById('pdfGenBtn');
  const g = id => { const el = document.getElementById('pdf' + id); return el ? el.value.trim() : ''; };
  const doc = {
    companyName: g('CompanyName'), companyAddress: g('CompanyAddress'), contactPerson: g('ContactPerson'),
    designation: g('Designation'), contactEmail: g('ContactEmail'), contactPhone: g('ContactPhone'),
    dateNeeded: g('DateNeeded'), urgency: g('Urgency'), prNumberClient: g('PrNumberClient'),
    preparedByName: g('PreparedByName'), preparedByPosition: g('PreparedByPosition'),
    referenceNumber: r.prNo, descMode: document.getElementById('pdfDescMode').value
  };
  flowSaveDefaults('pr', {
    CompanyName: doc.companyName, CompanyAddress: doc.companyAddress, ContactPerson: doc.contactPerson,
    Designation: doc.designation, ContactEmail: doc.contactEmail, ContactPhone: doc.contactPhone,
    PreparedByName: doc.preparedByName, PreparedByPosition: doc.preparedByPosition
  });
  const payload = {
    prNo: r.prNo, customer: r.customer, date: flowDate(r.date), requestedBy: r.requestedBy,
    descMode: doc.descMode, doc,
    items: r.items.map(i => ({ itemNo: i.itemNo, itemName: i.itemName, modelNo: i.itemNo, qty: i.qty, uom: i.uom, remarks: i.remarks }))
  };
  btn.disabled = true; btn.textContent = 'Generating...';
  try {
    const { link } = await generateFlowPdf('/flow/pr-pdf', payload, 'savePRPDF', 'prNo', r.prNo, `Purchase_Request_${r.prNo}.pdf`);
    flowMsg('pdfModalMsg', link ? 'PDF generated and saved to Drive.' : 'PDF generated (Drive save skipped — backend not configured).', true);
    await loadRequests();
    if (link) setTimeout(closePdfModal, 900);
  } catch (e) { flowMsg('pdfModalMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Generate & Save'; }
}
