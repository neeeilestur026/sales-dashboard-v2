/* flow-invoices.js — invoice/issuance from a sales order; COGS from landed cost; deduct inventory */
let ivSOs = [];
let ivInventory = [];
let ivCurrent = null;
let ivSession = null;
let ivCanVoid = false;   // A158: the void action needs FlowAPI v94
let ivCanVat = false;    // A278: storing a VAT rate needs FlowAPI v153
let ivCanRename = false; // A252: renaming the invoice number needs FlowAPI v142
let ivViewer = false;    // A231: management looks, does not touch

document.addEventListener('DOMContentLoaded', async () => {
  /* A268 — collapse the form so the list below can own the screen and be the only thing that
     scrolls. Without this the list starts below the fold and there is no height to give it. */
  flowFormToggleInit('New Invoice', () => flowFitScroll('listContainer'));

  ivSession = requireFlowOperations();                  // A231 — management admitted as a viewer
  if (!ivSession) return;
  ivViewer = isFlowViewerRole(ivSession);
  flowSetViewerOnly(ivViewer);
  if (ivViewer) {
    /* Issuing deducts inventory and books COGS — the heaviest write in the whole flow. Both the form
       and the CTA that scrolls to it go, or the button leads somewhere that is no longer there. */
    ['formCard', 'newInvCta'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  }
  renderNavbar('flow-invoices');
  renderFlowNav('flow-invoices.html');
  // A158: voiding an invoice needs the v94 backend — gate it so it can't fail with 'Unknown action'.
  try { ivCanVoid = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(94) : false; }
  catch (e) { ivCanVoid = false; }
  /* A252 — same gate, same reason: against an older backend renameInvoice is an unknown action, so
     the button must not be offered at all rather than fail after the user has typed a number. */
  try { ivCanRename = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(142) : false; }
  catch (e) { ivCanRename = false; }
  /* A278 — same gate, and here it is what makes the deploy safe in either order. Against a v152
     backend the VAT field stays hidden and saveInvoice sends no rate, so shipping this page before
     FlowAPI.gs is pasted changes nothing at all on screen or on the sheet. */
  try { ivCanVat = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(153) : false; }
  catch (e) { ivCanVat = false; }
  if (ivCanVat) ['vatBlock', 'vatRow', 'dueRow'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = '';
  });
  vatRepairVisible();
  if (ivViewer) ivCanVoid = false;   // A231 — one flag decides the button, as on flow-collections
  if (ivViewer) ivCanRename = false;
  document.getElementById('date').value = flowToday();
  await Promise.all([loadSOOptions(), loadInventory()]);
  await loadInvoices(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
});

async function loadSOOptions() {
  try { const r = await fetchFlow('getSalesOrders'); ivSOs = (r && r.data) || []; }
  catch (e) { ivSOs = []; }
  // Most recent sales order first (by date, then SO number).
  ivSOs.sort((a, b) =>
    (flowDate(b.date) || '').localeCompare(flowDate(a.date) || '') ||
    String(b.soNo).localeCompare(String(a.soNo)));
  document.getElementById('loadSO').innerHTML = '<option value="">— select a sales order —</option>' +
    ivSOs.map(s => `<option value="${flowEsc(s.soNo)}">${flowEsc(s.soNo)} — ${flowEsc(s.customer)}</option>`).join('');
}

async function loadInventory() {
  try { const r = await fetchFlow('getInventory'); ivInventory = (r && r.data) || []; }
  catch (e) { ivInventory = []; }
}

/* A159: resolve the line to ONE catalogue item. Matching on itemNo alone showed the first 'N/A'
   row's cost and stock for all 92 no-part-number products — the same phantom-item bug the pickers
   had, surfacing here as a wrong "low stock" / "no cost" badge and a wrong landed cost on screen. */
function ivFind(it) {
  if (!it) return null;
  if (it.itemId) {
    const byId = ivInventory.find(x => String(x.itemId) === String(it.itemId));
    if (byId) return byId;
  }
  const byNo = ivInventory.filter(x => String(x.itemNo) === String(it.itemNo));
  if (byNo.length === 1) return byNo[0];
  if (byNo.length > 1) {                                   // shared number → disambiguate by name
    const d = String(it.itemName || '').trim().toLowerCase();
    const byDesc = byNo.filter(x => String(x.description || '').trim().toLowerCase() === d);
    if (byDesc.length === 1) return byDesc[0];
  }
  return byNo[0] || null;
}
function landedFor(it) { const i = ivFind(it); return i ? flowNum(i.landedCost) : 0; }
function onHand(it)    { const i = ivFind(it); return i ? flowNum(i.balance) : 0; }

function loadFromSO() {
  const no = document.getElementById('loadSO').value;
  const s = ivSOs.find(x => String(x.soNo) === String(no));   // migrated SOs may have numeric ids
  ivCurrent = s || null;
  if (!s) { document.getElementById('itemRows').innerHTML = ''; recalc(); return; }
  document.getElementById('soNo').value = s.soNo;
  document.getElementById('customer').value = s.customer;
  renderItems();
}

function renderItems() {
  const tb = document.getElementById('itemRows');
  if (!ivCurrent) { tb.innerHTML = ''; return; }
  tb.innerHTML = (ivCurrent.items || []).map((it, i) => {
    const stock = onHand(it);
    const warn = flowNum(it.qty) > stock ? ` <span class="flow-badge b-unpaid" title="On hand: ${stock}">low stock</span>` : '';
    // A145: a line with no landed cost books COGS 0 (usually not yet received / AP not paid) — flag it.
    const noCost = flowNum(it.qty) > 0 && !(landedFor(it) > 0)
      ? ` <span class="flow-badge b-unpaid" title="No landed cost recorded — COGS will be ₱0. Receive this item (after paying its AP) first.">no cost</span>` : '';
    return `<tr data-i="${i}">
      <td>${flowEsc(it.itemNo)} — ${flowEsc(it.itemName)}${warn}${noCost}</td>
      <td class="num"><input type="number" step="any" min="0" class="qty" value="${flowNum(it.qty)}" oninput="recalc()"></td>
      <td class="num"><input type="number" step="any" min="0" class="price" value="${flowNum(it.price)}" oninput="recalc()"></td>
      <td class="num lineSales">0.00</td>
      <td class="num">${flowMoney(landedFor(it), 'PHP')}</td>
      <td class="num lineCOGS">0.00</td></tr>`;
  }).join('');
  recalc();
}

/** A278 — the same rounding rule as createInvoice: once, on the total, to the centavo. */
function ivVatOf(net) {
  if (!ivCanVat) return 0;
  const el = document.getElementById('vatRate');
  const rate = el ? flowNum(el.value) : 0;
  return Math.round(net * (rate / 100) * 100) / 100;
}

function recalc() {
  let sales = 0, cogs = 0;
  document.querySelectorAll('#itemRows tr').forEach((tr, i) => {
    const it = ivCurrent.items[i];
    const qty = flowNum(tr.querySelector('.qty').value);
    const price = flowNum(tr.querySelector('.price').value);
    // A282 — a hire line is qty x rate x DURATION. COGS is deliberately NOT spanned: it costs the
    // units issued, and a hire issues nothing at all (kind !== goods books no cost).
    const ls = qty * price * flowLineSpan(it);
    const lc = qty * landedFor(it);
    tr.querySelector('.lineSales').textContent = ls.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    tr.querySelector('.lineCOGS').textContent = lc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    sales += ls; cogs += lc;
  });
  const money2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vat = ivVatOf(sales);
  document.getElementById('totalVat').textContent = money2(vat);
  document.getElementById('totalDue').textContent = money2(sales + vat);
  document.getElementById('totalSales').textContent = sales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('totalCOGS').textContent = cogs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('grossProfit').textContent = (sales - cogs).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#itemRows tr').forEach((tr, i) => {
    const src = ivCurrent.items[i];
    items.push({ itemId: src.itemId || '', itemNo: src.itemNo, itemName: src.itemName,
      qty: flowNum(tr.querySelector('.qty').value), price: flowNum(tr.querySelector('.price').value),
      /* A282 — THE HIRE SHAPE, carried from the sales order and never rebuilt. Dropping it here
         cost real money in three ways at once: `chargeKind` is what tells createInvoice a REFUNDABLE
         DEPOSIT is a liability rather than revenue, and what stops a rental line deducting the tool
         from stock and booking COGS against a tool that is coming back; `duration` is the span the
         line amount is multiplied by, so a seven-day hire billed at one day. None of the three is
         editable on this form — the terms belong to the quotation — so they pass straight through. */
      chargeKind: src.chargeKind || '', rateBasis: src.rateBasis || '', duration: src.duration || '' });
  });
  return items;
}

async function saveInvoice() {
  if (!ivCurrent) { flowMsg('formMsg', 'Select a sales order first.', false); return; }
  const items = collectItems();
  const customer = document.getElementById('customer').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer is required.', false); return; }
  if (!items.length) { flowMsg('formMsg', 'Nothing to invoice.', false); return; }
  // A145: warn before issuing lines with no landed cost — they book COGS 0 (100% gross profit).
  const noCostLines = items.filter(it => flowNum(it.qty) > 0 && !(landedFor(it) > 0)).length;
  if (noCostLines > 0 &&
      !confirm(`${noCostLines} item(s) have no landed cost — their COGS will be ₱0 (full gross profit). This usually means the goods aren't received yet. Issue the invoice anyway?`)) {
    return;
  }
  const btn = document.getElementById('saveBtn');
  const payload = {
    soNo: ivCurrent.soNo, customer, date: document.getElementById('date').value,
    invNo: document.getElementById('invNo').value.trim(),
    createdBy: ivSession.name, items: JSON.stringify(items),
    clientRef: flowClientRef()                              // idempotent create (safe retry)
  };
  // A278 — omitted entirely against an older backend, where it would be an unread parameter.
  if (ivCanVat) payload.vatRate = flowNum(document.getElementById('vatRate').value);
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    let res = await postFlow('createInvoice', payload);
    const extra = {};
    // A158: issuing more than is on hand — stock clamps at zero and the shortfall is untracked.
    if (!res.success && res.needsConfirm === 'shortStock') {
      if (!confirm(res.message)) { flowMsg('formMsg', 'Invoice cancelled — check the stock first.', false); return; }
      extra.confirmShort = true;
      res = await postFlow('createInvoice', Object.assign({}, payload, extra));
    }
    // A158: the sales order already carries an invoice — a second one bills the customer twice.
    if (!res.success && res.needsConfirm === 'alreadyInvoiced') {
      if (!confirm(res.message)) { flowMsg('formMsg', 'Invoice cancelled.', false); return; }
      extra.confirmReinvoice = true;
      res = await postFlow('createInvoice', Object.assign({}, payload, extra));
    }
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message} (${res.invNo})`, true);
    resetForm();
    await loadInventory();
    await loadInvoices(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Issue Invoice & Deduct Inventory'; }
}

function resetForm() {
  ivCurrent = null;
  document.getElementById('loadSO').value = '';
  document.getElementById('soNo').value = '';
  document.getElementById('customer').value = '';
  const ivn = document.getElementById('invNo'); if (ivn) ivn.value = '';
  document.getElementById('date').value = flowToday();
  document.getElementById('itemRows').innerHTML = '';
  const vr = document.getElementById('vatRate'); if (vr) vr.value = '12';   // A278
  ['totalSales', 'totalCOGS', 'grossProfit', 'totalVat', 'totalDue']
    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0.00'; });
  document.getElementById('formMsg').style.display = 'none';
}

async function loadInvoices() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getInvoices');
    const list = (res && res.data) || [];
    if (!list.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No invoices yet.</p>'; return; }
    c.innerHTML = `<table class="flow-table"><thead><tr><th>INV No</th><th>SO</th><th>Date</th><th>Customer</th><th class="num">Net Sales</th><th class="num">VAT</th><th class="num">Total Due</th><th class="num">COGS</th><th class="num">Gross Profit</th><th>Items</th><th></th></tr></thead><tbody>${list.map(v => `
      <tr><td>${flowEsc(v.invNo)}</td><td>${flowEsc(v.soNo)}</td><td>${flowDate(v.date)}</td><td>${flowEsc(v.customer)}</td>
      <td class="num">${flowMoney(v.totalSales, 'PHP')}</td>
      <td class="num">${flowMoney(v.vat || 0, 'PHP')}</td>
      <td class="num">${flowMoney(v.totalDue != null ? v.totalDue : v.totalSales, 'PHP')}</td>
      <td class="num">${flowMoney(v.totalCOGS, 'PHP')}</td>
      <td class="num">${flowMoney(v.totalSales - v.totalCOGS, 'PHP')}</td><td>${v.items.length}</td>
      <td style="white-space:nowrap;"><button class="link-btn" onclick='openDocsModal("Invoice","${flowEsc(v.invNo)}")'>Docs</button>${
        ivCanRename ? `<button class="link-btn" style="margin-left:0.4rem;" title="Put your own invoice number on this record" onclick='renameInvoiceAction(${JSON.stringify(String(v.invNo))})'>Edit No</button>` : ''
      }${
        ivCanVoid ? `<button class="link-btn del-btn" style="margin-left:0.4rem;" onclick='voidInvoiceAction(${JSON.stringify(String(v.invNo))})'>Void</button>` : ''
      }</td></tr>`).join('')}</tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
  finally { setTimeout(() => flowFitScroll('listContainer'), 0); }   // A268: size the list to the window
}

/* A252 — put the business's own invoice number on the record. The number is a key, not a label:
   the receivable, the collections against it, the line items, any commission claim, the filed
   documents and the GL entry all point at the string. The server re-keys them together, refuses a
   number already in use (case-insensitively) and refuses outright while a commission claim is in
   flight — so this asks, then reports exactly what moved. */
async function renameInvoiceAction(invNo) {
  const next = prompt(
    `Invoice number for this record?\n\nCurrently: ${invNo}\n\n`
    + 'Everything that points at this invoice moves with it — the receivable, its collections, the\n'
    + 'line items, filed documents and the journal entry.', invNo);
  if (next === null) return;
  const newInvNo = String(next).trim();
  if (!newInvNo) { alert('An invoice number is required.'); return; }
  if (newInvNo === String(invNo)) return;
  try {
    let res = await postFlow('renameInvoice', { invNo, newInvNo });
    /* Documents filed against the invoice get their own confirm from the server, so the person
       renaming is told what follows the number before it moves. */
    if (res && !res.success && res.needsConfirm === 'renameDocs') {
      if (!confirm(res.message)) return;
      res = await postFlow('renameInvoice', { invNo, newInvNo, confirmDocs: 'true' });
    }
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not rename this invoice.');
    alert(res.message);
    await loadInvoices(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
}

/* A158 — reverse an invoice issued in error. Refused once anything has been collected against it,
   because that payment has to be dealt with first. Puts the stock back, removes the receivable it
   raised and clears its journal, so the sale stops counting in revenue and COGS. */
async function voidInvoiceAction(invNo) {
  const reason = prompt(`Void invoice ${invNo}?\n\nStock is restored, the receivable is removed and the journal is cleared. The invoice is kept, marked voided.\n\nReason:`, '');
  if (reason === null) return;
  if (!reason.trim()) { alert('A reason is required to void an invoice.'); return; }
  try {
    const res = await postFlow('voidInvoice', { invNo, reason: reason.trim() });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not void this invoice.');
    alert(res.message);
    await loadInventory();
    await loadInvoices(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { alert(e.message); }
}

// A268 — keep the locked list sized when the window changes.
window.addEventListener('resize', () => flowFitScroll('listContainer'));

/* ── A278 · repairing receivables raised before output VAT ───────────────────────────────────────
   Preview first, always. The server IMPUTES the rate — those invoices never recorded one — so the
   assumption is shown per row and the apply step names the invoices explicitly rather than offering
   a "fix everything" button on a money ledger. */
let vrRows = [];

function vatRepairVisible() {
  const card = document.getElementById('vatRepairCard');
  if (!card) return;
  const mayFix = ivSession && ['admin', 'accounting', 'director'].indexOf(String(ivSession.role)) !== -1;
  if (ivCanVat && mayFix && !ivViewer) card.style.display = '';
}

async function vatRepairPreview() {
  const btn = document.getElementById('vrPreviewBtn'), body = document.getElementById('vrBody');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const rate = flowNum(document.getElementById('vrRate').value);
    const res = await fetchFlow('previewInvoiceVatRepair', { rate }, { fresh: true });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not read the receivables.');
    vrRows = res.rows || [];
    if (!vrRows.length) {
      body.innerHTML = `<div style="font-size:0.85rem;color:var(--text-muted,#64748b);">Nothing to repair — no receivable matches an invoice that was booked net of VAT.${
        (res.skipped || []).length ? ` (${res.skipped.length} row(s) are out of scope.)` : ''}</div>`;
      return;
    }
    const cat = { unpaid: 'Unpaid', overCollected: 'Over-collected', partial: 'Part-paid' };
    body.innerHTML = `
      <div style="font-size:0.82rem;color:#b45309;font-weight:600;margin-bottom:.5rem;">${flowEsc(res.message)}</div>
      <div style="overflow-x:auto;"><table class="flow-table">
        <thead><tr><th style="width:2rem;"><input type="checkbox" id="vrAll" onclick="vrToggleAll(this)"></th>
          <th>Invoice</th><th>Customer</th><th>Date</th><th>State</th>
          <th class="num">Receivable now</th><th class="num">+ VAT (imputed)</th><th class="num">After</th><th class="num">Outstanding after</th></tr></thead>
        <tbody>${vrRows.map((r, i) => `<tr${r.ambiguous ? ' style="background:rgba(245,158,11,0.10);"' : ''}>
          <td><input type="checkbox" class="vr-pick" data-i="${i}"></td>
          <td>${flowEsc(r.invNo)}${r.ambiguous ? ` <span class="lv-warn" title="${flowEsc(r.ambiguousWhy.join('; '))}">⚠</span>` : ''}</td>
          <td>${flowEsc(r.customer)}</td><td>${flowEsc(String(r.date).slice(0, 10))}</td>
          <td>${flowEsc(cat[r.category] || r.category)}</td>
          <td class="num">${flowMoney(r.amountNow, 'PHP')}</td>
          <td class="num">${flowMoney(r.imputedVat, 'PHP')} <span style="color:var(--text-muted,#64748b);">@${r.imputedRate}%</span></td>
          <td class="num">${flowMoney(r.amountAfter, 'PHP')}</td>
          <td class="num">${flowMoney(r.outstandingAfter, 'PHP')}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="flow-actions" style="margin-top:.6rem;">
        <button type="button" class="btn btn-sm btn-primary primary" id="vrApplyBtn" onclick="vatRepairApply()">Repair the ticked invoices</button>
        <span style="font-size:0.78rem;color:var(--text-muted,#64748b);">Rows shaded amber need confirming — the sales order carries more than one live invoice, or the invoice more than one receivable.</span>
      </div>`;
  } catch (e) { flowMsg('vrMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Preview'; }
}

function vrToggleAll(cb) {
  document.querySelectorAll('.vr-pick').forEach(x => { x.checked = cb.checked; });
}

async function vatRepairApply() {
  const picked = Array.from(document.querySelectorAll('.vr-pick:checked')).map(x => vrRows[Number(x.getAttribute('data-i'))]);
  if (!picked.length) { flowMsg('vrMsg', 'Tick the invoices to repair.', false); return; }
  const amb = picked.filter(r => r.ambiguous);
  const total = picked.reduce((s, r) => s + flowNum(r.imputedVat), 0);
  if (!confirm(`Repair ${picked.length} invoice(s)?\n\nTheir receivables rise by ${flowMoney(total, 'PHP')} in total, the VAT is stamped on each invoice, and each journal entry is corrected.\n\nThis IMPUTES the rate — these invoices never recorded one.${
      amb.length ? `\n\n${amb.length} of them need confirming: ${amb.map(r => r.invNo).join(', ')}.` : ''}`)) return;
  const btn = document.getElementById('vrApplyBtn');
  btn.disabled = true; btn.textContent = 'Repairing…';
  try {
    const res = await postFlow('applyInvoiceVatRepair', {
      invNos: JSON.stringify(picked.map(r => r.invNo)),
      rate: flowNum(document.getElementById('vrRate').value),
      confirmAmbiguous: amb.length > 0
    });
    if (!res || !res.success) throw new Error((res && res.message) || 'The repair failed.');
    flowMsg('vrMsg', res.message, true);
    await vatRepairPreview();
    await loadInvoices(); if (typeof flowRefreshKpis === 'function') flowRefreshKpis();
  } catch (e) { flowMsg('vrMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Repair the ticked invoices'; }
}
