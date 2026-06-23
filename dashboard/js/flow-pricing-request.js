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
  if (prRole === 'sales') {
    document.getElementById('date').value = new Date().toISOString().slice(0, 10);
    await loadInventory();
    addRow();
  }
  await loadRequests();
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
    listTitle.textContent = 'Sourcing & Verification Queue';
    blurb.textContent = 'Source suppliers and prices for each item, then forward to management. After management prices it, verify and return to sales.';
    seg.innerHTML = segBtns(['Requested,Sourcing', 'Mgmt Priced', ''], ['To Source', 'To Verify', 'All']);
    prFilter = 'Requested,Sourcing';
  } else { // management
    listTitle.textContent = 'Pricing Queue';
    blurb.textContent = 'Set destination, commission and margin. The pricing engine computes the final price per item, then returns it to admin.';
    seg.innerHTML = segBtns(['For Mgmt Pricing', ''], ['To Price', 'All']);
    prFilter = 'For Mgmt Pricing';
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
  const payload = {
    customer, date: document.getElementById('date').value, notes: document.getElementById('notes').value.trim(),
    requestedBy: prSession.name, items: JSON.stringify(items)
  };
  btn.disabled = true; btn.textContent = 'Submitting...';
  try {
    const res = await postFlow('createPricingRequest', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message} (${res.prNo})`, true);
    resetForm();
    await loadRequests();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Submit to Admin'; }
}

function resetForm() {
  document.getElementById('prNo').value = '';
  document.getElementById('customer').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
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

function renderList() {
  const c = document.getElementById('listContainer');
  const rows = filteredList();
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">Nothing here.</p>'; return; }
  if (prOversight) {
    // Group by sales rep for clear oversight.
    const groups = {};
    rows.forEach(r => { const k = r.requestedBy || 'Unassigned'; (groups[k] = groups[k] || []).push(r); });
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    c.innerHTML = names.map((name, i) => `<details class="rep-group"${i === 0 ? ' open' : ''}>
      <summary><span class="rep-name">${flowEsc(name)}</span>
        <span class="rep-meta">${groups[name].length} request(s)</span></summary>
      <div style="overflow-x:auto;margin-top:0.5rem;">${prTableHtml(groups[name])}</div>
    </details>`).join('');
    return;
  }
  c.innerHTML = prTableHtml(rows);
}

function rowActions(r) {
  const open = `<button class="link-btn" onclick='openPr("${flowEsc(r.prNo)}")'>Open</button>`;
  const docs = ` <button class="link-btn" onclick='openDocsModal("Pricing Request","${flowEsc(r.prNo)}")' style="margin-left:0.5rem;">Docs</button>`;
  if (prRole === 'sales' && r.status === 'Returned to Sales')
    return open + docs + ` <button class="link-btn" onclick='openPdf("${flowEsc(r.prNo)}")' style="margin-left:0.5rem;">PR PDF</button>`;
  if (prRole === 'sales' && r.status === 'Quoted' && r.pdfLink)
    return open + docs + ` <a class="link-btn" href="${flowEsc(r.pdfLink)}" target="_blank" style="margin-left:0.5rem;">View PDF</a>`;
  return open + docs;
}

// ─── Detail / action modal ───────────────────────
function curPr(no) { return prList.find(r => String(r.prNo) === String(no)); }

function openPr(no) {
  const r = curPr(no);
  if (!r) return;
  document.getElementById('modalPrNo').value = no;
  document.getElementById('modalTitle').textContent = r.prNo;
  document.getElementById('modalSub').textContent = `${r.customer} · requested by ${r.requestedBy} · ${flowDate(r.date)} · ${r.status}`;
  document.getElementById('modalMsg').style.display = 'none';
  const body = document.getElementById('modalBody');
  const foot = document.getElementById('modalFoot');

  if (canSource && (r.status === 'Requested' || r.status === 'Sourcing')) {
    body.innerHTML = sourcingTable(r);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      <button class="btn btn-secondary" onclick="saveSourcing(false)">Save Draft</button>
      <button class="btn btn-primary" onclick="saveSourcing(true)">Forward to Management</button>`;
  } else if (canPrice && r.status === 'For Mgmt Pricing') {
    body.innerHTML = pricingPanel(r);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      <button class="btn btn-primary" onclick="savePricing()">Return to Admin (priced)</button>`;
    setTimeout(recalcPricing, 0);
  } else if (canSource && r.status === 'Mgmt Priced') {
    body.innerHTML = verifyTable(r);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      <button class="btn btn-primary" onclick="verifyReturn()">Verify &amp; Return to Sales</button>`;
  } else if (prRole === 'sales' && r.status === 'Returned to Sales') {
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
  return `<p class="pr-meta">Set the supplier, principal, currency, supplier price (FC) and CBM per item. Untick items that won't be quoted.</p>
    <div style="overflow-x:auto;"><table class="flow-table" id="srcTable" style="min-width:760px;"><thead><tr>
      <th>Item</th><th class="num">Qty</th><th>Supplier</th><th>Principal</th><th>Cur</th>
      <th class="num">Price (FC)</th><th class="num">CBM</th><th>Incl</th></tr></thead><tbody>${r.items.map(i =>
      `<tr data-line="${i.line}">
        <td>${flowEsc(i.itemNo)} — ${flowEsc(i.itemName)}</td><td class="num">${flowNum(i.qty)}</td>
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
  try {
    const res = await postFlow('updatePRSourcing', { prNo, items: JSON.stringify(collectSourcing()) });
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

function pricingPanel(r) {
  const destOpts = '<option value="">— select —</option>' + FLOW_DESTINATIONS.map(d =>
    `<option value="${flowEsc(d.name)}"${d.name === r.destination ? ' selected' : ''}>${flowEsc(d.name)}</option>`).join('');
  const inc = r.items.filter(i => i.included);
  const cards = inc.map(i => {
    const p = flowPrincipalByName(i.principal);
    const forex = p ? p.forex : 1, duties = p ? p.dutiesPct : 0;
    return `<div class="pe-card" data-line="${i.line}">
      <div class="pe-card-head">
        <span class="pe-name">${flowEsc(i.itemNo)} — ${flowEsc(i.itemName)}</span>
        <label style="font-size:0.68rem;font-weight:700;text-transform:uppercase;color:var(--text-muted,#64748b);display:flex;align-items:center;gap:0.4rem;">Principal
          <select class="pe-prin" onchange="peOnPrincipal(this)">${pePrincipalSelect(i.principal)}</select></label>
      </div>
      <div class="pe-inputs">
        <div><label>Buy Price (FC)</label><input type="number" step="any" min="0" class="pe-buy" value="${i.supplierPrice || 0}" oninput="recalcPricing()"></div>
        <div><label>Discount %</label><input type="number" step="any" min="0" class="pe-disc" value="0" oninput="recalcPricing()"></div>
        <div><label>Qty</label><input type="number" step="any" min="0" class="pe-qty" value="${flowNum(i.qty)}" oninput="recalcPricing()"></div>
        <div><label>CBM</label><input type="number" step="any" min="0" class="pe-cbm" value="${i.cbm || 0}" oninput="recalcPricing()"></div>
        <div><label>Forex (₱)</label><input type="number" step="any" min="0" class="pe-forex" value="${forex}" oninput="recalcPricing()"></div>
        <div><label>Duties %</label><input type="number" step="any" min="0" class="pe-duties" value="${duties}" oninput="recalcPricing()"></div>
      </div>
      <div class="pe-breakdown">
        <div class="pe-bd"><span class="l">Buy (PHP)</span><span class="v b-buyphp">—</span></div>
        <div class="pe-bd"><span class="l">Brokerage</span><span class="v b-brok">—</span></div>
        <div class="pe-bd"><span class="l">Landed</span><span class="v b-landed">—</span></div>
        <div class="pe-bd"><span class="l">Delivery</span><span class="v b-deliv">—</span></div>
        <div class="pe-bd"><span class="l">COGS</span><span class="v b-cogs">—</span></div>
        <div class="pe-bd"><span class="l">Commission</span><span class="v b-comm">—</span></div>
        <div class="pe-bd"><span class="l">Profit</span><span class="v b-prof">—</span></div>
        <div class="pe-bd final"><span class="l">Unit (VAT-ex)</span><span class="v b-unitex">—</span></div>
        <div class="pe-bd final"><span class="l">Unit (VAT-inc)</span><span class="v b-unitinc">—</span></div>
        <div class="pe-bd final"><span class="l">Line Total +VAT</span><span class="v b-linetot">—</span></div>
      </div>
    </div>`;
  }).join('');
  return `<div class="group-title">Pricing configuration</div>
    <div class="flow-form">
      <div><label>Destination</label><select id="mDest" onchange="recalcPricing()">${destOpts}</select></div>
      <div><label>Commission %</label><input type="number" step="any" id="mComm" value="${r.commission || 10}" oninput="recalcPricing()"></div>
      <div><label>Margin %</label><input type="number" step="any" id="mMarg" value="${r.margin || 20}" oninput="recalcPricing()"></div>
    </div>
    <div class="group-title">Items &amp; supplier cost</div>
    <div id="peCards">${cards || '<p class="pr-meta">No included items to price.</p>'}</div>
    <div class="group-title">Profitability (P&amp;L)</div>
    <div id="pePnl"></div>
    <p class="pr-meta">Final price is VAT-exclusive per unit; the quotation applies its own VAT.</p>`;
}

// When the principal changes, refresh the row's forex/duties defaults then recompute.
function peOnPrincipal(sel) {
  const card = sel.closest('.pe-card');
  const p = flowPrincipalByName(sel.value);
  if (card && p) {
    card.querySelector('.pe-forex').value = p.forex;
    card.querySelector('.pe-duties').value = p.dutiesPct;
  }
  recalcPricing();
}

function _peNum(card, cls) { return flowNum(card.querySelector(cls).value); }

function recalcPricing() {
  const destEl = document.getElementById('mDest');
  if (!destEl) return;
  const dest = flowDestinationByName(destEl.value);
  const comm = flowNum(document.getElementById('mComm').value);
  const marg = flowNum(document.getElementById('mMarg').value);
  const t = { revenue: 0, vat: 0, netSales: 0, cogs: 0, commission: 0, localTax: 0, delivery: 0 };
  document.querySelectorAll('#peCards .pe-card').forEach(card => {
    const principal = flowPrincipalByName(card.querySelector('.pe-prin').value);
    const out = flowCalcItem(
      { buyPrice: _peNum(card, '.pe-buy'), discount: _peNum(card, '.pe-disc'), qty: _peNum(card, '.pe-qty'), cbm: _peNum(card, '.pe-cbm') },
      principal, dest, comm, marg,
      { forex: _peNum(card, '.pe-forex'), dutiesPct: _peNum(card, '.pe-duties') }
    );
    const set = (cls, val) => { const el = card.querySelector(cls); if (el) el.textContent = flowMoney(val, 'PHP'); };
    set('.b-buyphp', out.buyPricePHP); set('.b-brok', out.brokerage); set('.b-landed', out.landedCost);
    set('.b-deliv', out.deliveryCost); set('.b-cogs', out.totalCOGS); set('.b-comm', out.commission);
    set('.b-prof', out.profitMargin); set('.b-unitex', out.unitPriceVatEx); set('.b-unitinc', out.unitPrice);
    set('.b-linetot', out.finalPrice);
    card.setAttribute('data-final', out.unitPriceVatEx);
    t.revenue += out.finalPrice; t.vat += out.vat; t.netSales += out.netSellingPrice;
    t.cogs += out.landedCost; t.commission += out.commission; t.localTax += out.localTax; t.delivery += out.deliveryCost;
  });
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
  const prNo = document.getElementById('modalPrNo').value;
  const dest = document.getElementById('mDest').value;
  if (!dest) { flowMsg('modalMsg', 'Select a destination.', false); return; }
  const items = [];
  document.querySelectorAll('#peCards .pe-card').forEach(card => {
    const principal = flowPrincipalByName(card.querySelector('.pe-prin').value);
    items.push({
      line: flowNum(card.getAttribute('data-line')),
      finalPrice: flowNum(card.getAttribute('data-final')),
      principal: card.querySelector('.pe-prin').value,
      currency: principal ? principal.currency : 'PHP',
      supplierPrice: _peNum(card, '.pe-buy'),
      cbm: _peNum(card, '.pe-cbm'),
      qty: _peNum(card, '.pe-qty')
    });
  });
  try {
    const res = await postFlow('setMgmtPricing', {
      prNo, destination: dest, commission: flowNum(document.getElementById('mComm').value),
      margin: flowNum(document.getElementById('mMarg').value), items: JSON.stringify(items)
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('modalMsg', 'Priced and returned to admin.', true);
    await loadRequests();
    setTimeout(closePr, 800);
  } catch (e) { flowMsg('modalMsg', e.message, false); }
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
async function makeQuotation(no) {
  if (!confirm('Create a quotation from the included, priced items of ' + no + '?')) return;
  try {
    const res = await postFlow('createQuotationFromPR', { prNo: no });
    if (!res.success) throw new Error(res.message);
    alert(res.message);
    window.location.href = 'flow-quotations.html';
  } catch (e) { flowMsg('modalMsg', e.message, false); }
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
