/* flow-sales-orders.js — sales orders that load from a quotation */
let soQuotations = [];
let soList = [];
let soCds = {};        // soNo → SOCostDetails record (for the COGS column + Costs editor prefill)
let soHasPO = {};      // A145: soNo → true when a purchase order references it (no-PO nudge)
let soSession = null;
let soOrigNo = '';     // A220: the number the open record had when it was loaded, so an edited SO No
                       // is recognised as a RENAME and routed to renameSalesOrder, not to an update.
let soViewer = false;  // A231: management looks, does not touch

document.addEventListener('DOMContentLoaded', async () => {
  soSession = requireFlowOperations();                  // A231 — management admitted as a viewer
  if (!soSession) return;
  soViewer = isFlowViewerRole(soSession);
  flowSetViewerOnly(soViewer);
  /* The form is also the EDIT surface — editSO fills it — so hiding it closes creation, editing and
     the A220 rename in one move, which is why the row's Edit button goes with it rather than being
     left to open a card that is not on the page. */
  if (soViewer) { const fc = document.getElementById('formCard'); if (fc) fc.style.display = 'none'; }
  renderNavbar('flow-sales-orders');
  renderFlowNav('flow-sales-orders.html');
  document.getElementById('date').value = flowToday();
  await loadQuotationOptions();
  addRow();
  await loadSOs();
});

async function loadQuotationOptions() {
  try {
    const r = await fetchFlow('getQuotations');
    soQuotations = (r && r.data) || [];
  } catch (e) { soQuotations = []; }
  // A145: only a quotation that cleared approval (Approved/Sent) should become a sales order —
  // loading a Draft/Pending/Rejected quote would bypass the entire approval workflow.
  const ready = soQuotations.filter(q => { const s = String(q.status || ''); return s === 'Approved' || s === 'Sent'; });
  document.getElementById('loadQuotation').innerHTML =
    '<option value="">— select an approved quotation —</option>' + ready.map(q =>
      // A182: the NET value. This label showed the pre-discount total, so 2026-393-KIM-THPAL-CEJN
      // HOSES read ₱370,982.88 for a quotation actually worth ₱352,433.74 — which is why it could
      // not be found here.
      `<option value="${flowEsc(q.quotationNo)}">${flowEsc(q.quotationNo)} — ${flowEsc(q.customer)} · ${flowEsc(q.status)} (${flowMoney(flowQuotationNet(q), 'PHP')})${flowQuotationDiscountTag(q)}</option>`).join('');
}

/* A205 — when the source quotation carries alternatives, ASK which one the client accepted before
   building the order. The document offered a choice; the sales order records a decision, and the
   system cannot infer which was taken. Defaults to the recommended option (what the stored total was
   built from) so the common case is one click. */
let soChosenOption = '';

function soOptionPickerHtml(q) {
  const g = (typeof flowQuotationOptions === 'function') ? flowQuotationOptions(q) : { hasOptions: false };
  if (!g.hasOptions) return '';
  const rows = g.order.map(k => {
    const net = flowQuotationNetForOption(q, k);
    const on = k === (soChosenOption || g.recommended);
    return `<label style="display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem;border-radius:8px;
              ${on ? 'background:#eef2ff;' : ''}cursor:pointer;">
        <input type="radio" name="soOpt" value="${flowEsc(k)}"${on ? ' checked' : ''}
               onchange="soPickOption(this.value)">
        <span><strong>Option ${flowEsc(k)}</strong>${k === g.recommended ? ' · recommended' : ''}</span>
        <span style="margin-left:auto;font-variant-numeric:tabular-nums;">${flowMoney(net, 'PHP')}</span>
      </label>`;
  }).join('');
  return `<div id="soOptWrap" style="margin:.5rem 0;padding:.6rem .7rem;border:1px solid #fca5a5;
            border-radius:10px;background:#fff7f7;">
      <div style="font-weight:700;color:#b91c1c;font-size:.82rem;margin-bottom:.35rem;">
        This quotation offered alternatives — which did the client accept?</div>
      ${rows}
      <div style="font-size:.74rem;color:#64748b;margin-top:.3rem;">
        Only the base items plus the option you pick are carried into this sales order.</div>
    </div>`;
}

function soPickOption(k) {
  soChosenOption = String(k || '').trim();
  const no = document.getElementById('loadQuotation').value;
  const q = soQuotations.find(x => x.quotationNo === no);
  if (q) soApplyQuotation(q);
}

function loadFromQuotation() {
  const no = document.getElementById('loadQuotation').value;
  const q = soQuotations.find(x => x.quotationNo === no);
  if (!q) return;
  soChosenOption = '';                       // a fresh quotation clears any previous pick
  soApplyQuotation(q);
}

function soApplyQuotation(q) {
  document.getElementById('quotationNo').value = q.quotationNo;
  document.getElementById('customer').value = q.customer;
  document.getElementById('itemRows').innerHTML = '';
  /* A182: load the quotation's DISCOUNTED prices. This used to copy it.price verbatim and ignore
     discountPct entirely, so converting 2026-393-KIM-THPAL-CEJN HOSES (5%) would have created a
     sales order at ₱370,982.88 instead of ₱352,433.74 — overstating revenue, and profit with it,
     by ₱18,549.14. The sales order deliberately has no discount field of its own (a percentage
     stored beside already-discounted prices invites double-application), so the prices carry it. */
  const netItems = flowQuotationNetItems(q, soChosenOption);   // A205: base + the accepted option only
  netItems.forEach(it => addRow({ itemNo: it.itemNo, itemName: it.itemName, qty: it.qty, price: it.price, itemId: it.itemId }));
  if (!netItems.length) addRow();
  recalc();
  soShowOptionPicker(q);
  soShowDiscountNotice(q);
}

function soShowOptionPicker(q) {
  let el = document.getElementById('soOptHost');
  if (!el) {
    const anchor = document.getElementById('soDiscountNote');
    if (!anchor || !anchor.parentNode) return;
    el = document.createElement('div');
    el.id = 'soOptHost';
    anchor.parentNode.insertBefore(el, anchor);
  }
  el.innerHTML = soOptionPickerHtml(q);
}

/* A205 — the value of what is actually being ordered: base + the chosen option, discounted. Quoting
   the whole document's total here would reassure the user against a number the order does not match
   whenever alternatives are involved. */
function soQuotedNet(q) {
  const g = (typeof flowQuotationOptions === 'function') ? flowQuotationOptions(q) : { hasOptions: false };
  if (!g.hasOptions) return flowQuotationNet(q);
  return flowQuotationNetForOption(q, soChosenOption || g.recommended);
}

/** Say so when the loaded prices are not the quotation's printed unit prices — a silent price change
 *  on a money form is worse than a loud one. */
function soShowDiscountNotice(q) {
  const el = document.getElementById('soDiscountNote');
  if (!el) return;
  const pct = flowQuotationDiscountPct(q);
  if (!pct) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = `ℹ Unit prices include this quotation's <strong>${pct}%</strong> discount, so the total ` +
    `matches the quotation at <strong>${flowMoney(soQuotedNet(q), 'PHP')}</strong> ` +
    `(before discount ${flowMoney(soQuotedNet(q) / (1 - pct / 100), 'PHP')}). Do not deduct the discount again.`;
}

function addRow(item) {
  const tb = document.getElementById('itemRows');
  const tr = document.createElement('tr');
  if (item && item.itemId) tr.dataset.itemId = item.itemId;   // A159: carry the identity from the quotation
  tr.innerHTML = `
    <td><input type="text" class="itemNo" value="${item ? flowEsc(item.itemNo) : ''}" placeholder="Item No" style="width:38%;display:inline-block;">
        <input type="text" class="itemName" value="${item ? flowEsc(item.itemName) : ''}" placeholder="Description" style="width:60%;display:inline-block;"></td>
    <td class="num"><input type="number" step="any" min="0" class="qty" value="${item ? flowNum(item.qty) : 0}" oninput="recalc()"></td>
    <td class="num"><input type="number" step="any" min="0" class="price" value="${item ? flowNum(item.price) : 0}" oninput="recalc()"></td>
    <td class="num lineTotal">0.00</td>
    <td><button type="button" class="link-btn del-btn" onclick="this.closest('tr').remove();recalc();">✕</button></td>`;
  tb.appendChild(tr);
  recalc();
}

function recalc() {
  let total = 0;
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const qty = flowNum(tr.querySelector('.qty').value);
    const price = flowNum(tr.querySelector('.price').value);
    const lt = qty * price;
    tr.querySelector('.lineTotal').textContent = lt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    total += lt;
  });
  document.getElementById('grandTotal').textContent = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function collectItems() {
  const items = [];
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const itemNo = tr.querySelector('.itemNo').value.trim();
    const itemName = tr.querySelector('.itemName').value.trim();
    const qty = flowNum(tr.querySelector('.qty').value);
    const price = flowNum(tr.querySelector('.price').value);
    // A145: keep any line that carries a description or a quantity — DON'T silently drop a real line
    // just because its item code is blank (that undershot the SO total vs the quotation). Blank code
    // falls back to the shared 'N/A' key, consistent with the rest of the flow.
    if (!itemNo && !itemName && !(qty > 0)) return;   // skip only fully-empty rows
    items.push({ itemId: tr.dataset.itemId || '', itemNo: itemNo || 'N/A', itemName: itemName || itemNo, qty, price });
  });
  return items;
}

function soVal(id) { const e = document.getElementById(id); return e ? (e.value || '').trim() : ''; }

/* A186 — how late their PO reached us, in whole days. Null when either date is missing, so the
   caller shows nothing rather than a confident "0 days". */
function soReceiptGap(clientPoDate, poReceivedDate) {
  const a = flowDate(clientPoDate), b = flowDate(poReceivedDate);
  if (!a || !b) return null;
  const ms = Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00');
  return isNaN(ms) ? null : Math.round(ms / 86400000);
}

/* A186 — stamp the client's PO RECEIVED and file both copies.

   Order matters: the ORIGINAL is filed first. If the stamped upload then fails, the customer's
   document is already safely on the record — the reverse order risks losing the only copy we were
   sent. The received date is required here rather than defaulted, because a stamp carrying an
   invented date is worse than no stamp at all. */
async function soAttachClientPo() {
  const btn = document.getElementById('clientPoBtn');
  const input = document.getElementById('clientPoFile');
  const file = input && input.files && input.files[0];
  const soNo = document.getElementById('soNo').value || soVal('soNoInput');
  const received = soVal('poReceivedDate');

  if (!soNo) { flowMsg('clientPoMsg', 'Enter the SO No first — the document is filed against it.', false); return; }
  if (!file) { flowMsg('clientPoMsg', 'Choose the client\'s PO file first.', false); return; }
  if (!received) {
    flowMsg('clientPoMsg', 'Pick the date the PO was received before stamping.', false);
    const e = document.getElementById('poReceivedDate'); if (e) e.focus();
    return;
  }
  if (file.size > FLOW_DOC_MAX_MB * 1024 * 1024) {
    flowMsg('clientPoMsg', `That file is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${FLOW_DOC_MAX_MB} MB.`, false);
    return;
  }

  btn.disabled = true; btn.textContent = 'Stamping...';
  try {
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('receivedDate', received);
    fd.append('receivedBy', soSession.name || '');
    fd.append('soNumber', soNo);
    fd.append('poNumber', soNo);          // in this system the SO No IS the client's PO number
    const res = await fetch('/flow/stamp-po-received', { method: 'POST', body: fd });
    const out = await res.json().catch(() => ({ success: false, message: 'Server did not answer with JSON.' }));
    if (!out.success) throw new Error(out.message || 'The PO could not be stamped.');

    const original = await fileToDataURL(file);
    await postFlow('addDocument', {
      module: 'Sales Order', refNo: soNo, docType: 'Client PO',
      fileName: file.name, fileBase64: String(original).split(',')[1] || '',
      mimeType: file.type || 'application/pdf'
    });
    await postFlow('addDocument', {
      module: 'Sales Order', refNo: soNo, docType: 'Client PO (stamped)',
      fileName: file.name.replace(/\.pdf$/i, '') + '_RECEIVED.pdf',
      fileBase64: out.pdf, mimeType: 'application/pdf'
    });

    const warn = (out.report && out.report.warnings) || [];
    flowMsg('clientPoMsg',
      'Stamped and attached — their original is filed unchanged alongside it.' +
      (warn.length ? ' ' + warn.join(' ') : ''), !warn.length);
    if (warn.length) {                     // a warning must not read as an error, but must be seen
      const m = document.getElementById('clientPoMsg');
      if (m) { m.style.display = 'block'; m.style.color = '#b45309'; }
    }
    input.value = '';
  } catch (e) {
    flowMsg('clientPoMsg', e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Stamp & attach';
  }
}

async function saveSO() {
  const items = collectItems();
  const customer = document.getElementById('customer').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer is required.', false); return; }
  if (!items.length) { flowMsg('formMsg', 'Add at least one item.', false); return; }
  const btn = document.getElementById('saveBtn');
  let soNo = document.getElementById('soNo').value;
  /* A220 — the visible field is editable on an edit now, so it carries the number the user INTENDS,
     while the hidden field stays the lookup key for the record being edited. Reading only the hidden
     one (as before) would silently discard a rename. */
  const soTyped = (document.getElementById('soNoInput').value || '').trim();
  if (soNo && !soTyped) {
    flowMsg('formMsg', 'SO No cannot be blank.', false);
    document.getElementById('soNoInput').focus();
    return;
  }
  if (soNo && soTyped !== soNo &&
      soList.some(x => String(x.soNo).toLowerCase() === soTyped.toLowerCase())) {
    flowMsg('formMsg', 'SO No "' + soTyped + '" already belongs to another sales order.', false);
    document.getElementById('soNoInput').focus();
    return;
  }
  // Creating: the SO No must be typed manually (it is the client's PO number) and be unique.
  if (!soNo) {
    const typed = (document.getElementById('soNoInput').value || '').trim();
    if (!typed) {
      flowMsg('formMsg', 'SO No is required — type the client\'s PO number.', false);
      document.getElementById('soNoInput').focus();
      return;
    }
    if (soList.some(x => String(x.soNo).toLowerCase() === typed.toLowerCase())) {
      flowMsg('formMsg', 'SO No "' + typed + '" already exists — open it with Edit instead.', false);
      document.getElementById('soNoInput').focus();
      return;
    }
    soNo = '';   // stays empty so the create/update branch below is unchanged
    var soNoTyped = typed;
  }
  const payload = {
    soNo: soNo ? soTyped : soNoTyped, quotationNo: document.getElementById('quotationNo').value, customer,
    date: document.getElementById('date').value, status: document.getElementById('status').value,
    supplierType: document.getElementById('soSupplierType').value,
    clientPoDate: soVal('clientPoDate'), poReceivedDate: soVal('poReceivedDate'),   // A186
    clientPoNo: soVal('clientPoNo'),                                                // A193
    createdBy: soSession.name, items: JSON.stringify(items)
  };
  if (!soNo) payload.clientRef = flowClientRef();          // idempotent create (safe retry)
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    /* A220 — a changed SO No on an EXISTING record is a rename, and must go through its own handler
       BEFORE the ordinary update: updateSalesOrder uses p.soNo as both the lookup key and the value
       it writes, so it could only ever find the old row and write the old number back. Do the rename
       first, then let the update run against the new key. */
    if (soNo && soOrigNo && String(payload.soNo) !== soOrigNo) {
      const renamed = await soRename(soOrigNo, String(payload.soNo));
      if (!renamed) { flowMsg('formMsg', 'Rename cancelled — nothing was saved.', false); return; }
      soNo = renamed;                        // everything below now refers to the new number
      payload.soNo = renamed;
      document.getElementById('soNo').value = renamed;
      soOrigNo = renamed;
    }
    const res = await postFlow(soNo ? 'updateSalesOrder' : 'createSalesOrder', payload);
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', `${res.message} (${res.soNo || soNo})`, true);
    resetForm();
    await loadSOs();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Save Sales Order'; }
}

/* A220 — run the rename, answering the server's two confirms. Returns the new number on success, or
   '' if the user backed out or it was refused. Both confirms are real decisions, not formalities:
   one is about documents that cannot be corrected by re-keying, the other about permanently
   un-clearable demo data. Shaped like the prDeviation / evidenceChanged handlers elsewhere. */
async function soRename(oldNo, newNo) {
  const opts = {};
  for (let i = 0; i < 3; i++) {                       // at most: docs confirm, demo confirm, then done
    const r = await postFlow('renameSalesOrder', Object.assign({ soNo: oldNo, newSoNo: newNo }, opts));
    if (r.success) {
      if (r.stamped) {
        alert(r.stamped + ' stamped document(s) still show "' + oldNo + '" printed inside the file.\n\n'
            + 'Re-keying cannot change what is drawn on a page — re-stamp them to correct it.');
      }
      return r.soNo || newNo;
    }
    if (r.needsConfirm === 'renameDocs') { if (!confirm(r.message)) return ''; opts.confirmDocs = true; continue; }
    if (r.needsConfirm === 'demoRename') { if (!confirm(r.message)) return ''; opts.confirmDemo = true; continue; }
    flowMsg('formMsg', r.message, false);
    return '';
  }
  return '';
}

function resetForm() {
  document.getElementById('soNo').value = '';
  const ni = document.getElementById('soNoInput');
  if (ni) { ni.value = ''; ni.disabled = false; ni.title = ''; }
  soOrigNo = '';
  document.getElementById('quotationNo').value = '';
  document.getElementById('loadQuotation').value = '';
  document.getElementById('customer').value = '';
  document.getElementById('status').value = 'Open';
  const st = document.getElementById('soSupplierType'); if (st) st.value = '';
  document.getElementById('date').value = flowToday();
  // A186 — deliberately NOT defaulted to today. The received date has to be a date someone
  // actually chose; pre-filling it invites accepting today's date without thinking, which is the
  // exact habit this feature exists to break.
  ['clientPoDate', 'poReceivedDate', 'clientPoNo'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const cf = document.getElementById('clientPoFile'); if (cf) cf.value = '';
  const cm = document.getElementById('clientPoMsg'); if (cm) cm.style.display = 'none';
  document.getElementById('itemRows').innerHTML = '';
  const dn = document.getElementById('soDiscountNote');
  if (dn) { dn.style.display = 'none'; dn.innerHTML = ''; }   // A182
  document.getElementById('formTitle').textContent = 'New Sales Order';
  document.getElementById('formMsg').style.display = 'none';
  addRow();
}

async function loadSOs() {
  const c = document.getElementById('listContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const [res, cdRes, poRes] = await Promise.all([
      fetchFlow('getSalesOrders'),
      fetchFlow('getSOCostDetails').catch(() => ({ data: [] })),
      fetchFlow('getPurchaseOrders').catch(() => ({ data: [] })),   // A145: which SOs have a PO
    ]);
    soList = (res && res.data) || [];
    soCds = {};
    ((cdRes && cdRes.data) || []).forEach(cd => { soCds[String(cd.soNo)] = cd; });
    soHasPO = {};
    ((poRes && poRes.data) || []).forEach(po => { if (po.soNo) soHasPO[String(po.soNo)] = true; });
    // Most recent sales order first (by date, then SO number).
    soList.sort((a, b) =>
      (flowDate(b.date) || '').localeCompare(flowDate(a.date) || '') ||
      String(b.soNo).localeCompare(String(a.soNo)));
    buildSOFilters();
    renderSOs();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function buildSOFilters() {
  // Year options from SO dates (newest first) + All years.
  const years = new Set();
  soList.forEach(s => { const y = (flowDate(s.date) || '').slice(0, 4); if (y) years.add(y); });
  const ySel = document.getElementById('soYear');
  if (ySel && !ySel.dataset.bound) {
    ['soSearch', 'soYear', 'soMonth', 'soCustomer'].forEach(id => {
      const el = document.getElementById(id); if (el) el.addEventListener('input', renderSOs);
    });
    ySel.dataset.bound = '1';
  }
  if (ySel) {
    const cur = ySel.value;
    ySel.innerHTML = '<option value="">All years</option>' +
      Array.from(years).sort((a, b) => b.localeCompare(a)).map(y => `<option value="${y}">${y}</option>`).join('');
    ySel.value = cur;
  }
  // Customer options.
  const custs = Array.from(new Set(soList.map(s => s.customer).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  const cSel = document.getElementById('soCustomer');
  if (cSel) {
    const cur = cSel.value;
    cSel.innerHTML = '<option value="">All customers</option>' +
      custs.map(c => `<option value="${flowEsc(c)}">${flowEsc(c)}</option>`).join('');
    cSel.value = cur;
  }
}

// International / Local supplier label badge (blank → em dash).
function soTypeBadge(t) {
  const v = String(t || '');
  if (v === 'International') return '<span class="flow-badge" style="background:rgba(37,99,235,0.12);color:#1d4ed8;">International</span>';
  if (v === 'Local') return '<span class="flow-badge" style="background:rgba(100,116,139,0.14);color:#475569;">Local</span>';
  return '<span style="color:var(--text-muted,#64748b);">—</span>';
}

/* A186 — the received date, with the lag flagged when their PO sat somewhere before reaching us.
   Three days is the threshold: shorter is ordinary post/email latency, longer is worth seeing. */
function soReceivedCell(s) {
  const got = flowDate(s.poReceivedDate);
  if (!got) return '<span style="color:var(--text-muted,#64748b);">—</span>';
  const gap = soReceiptGap(s.clientPoDate, s.poReceivedDate);
  if (gap === null || gap < 3) return flowEsc(got);
  return `${flowEsc(got)} <span class="flow-badge" style="background:rgba(245,158,11,0.14);color:#b45309;" ` +
         `title="Their PO is dated ${flowEsc(flowDate(s.clientPoDate))} but only reached us ${gap} days later">+${gap}d</span>`;
}

function renderSOs() {
  const c = document.getElementById('listContainer');
  const q = (document.getElementById('soSearch').value || '').trim().toLowerCase();
  const y = document.getElementById('soYear').value;
  const m = document.getElementById('soMonth').value;
  const cust = document.getElementById('soCustomer').value;
  const rows = soList.filter(s => {
    const d = flowDate(s.date) || '';
    if (y && d.slice(0, 4) !== y) return false;
    if (m && d.slice(5, 7) !== m) return false;
    if (cust && String(s.customer) !== cust) return false;
    if (q && !((s.soNo + ' ' + (s.quotationNo || '') + ' ' + (s.customer || '')).toLowerCase().includes(q))) return false;
    return true;
  });
  const meta = document.getElementById('soFilterMeta');
  if (meta) meta.textContent = `${rows.length} of ${soList.length} sales order${soList.length === 1 ? '' : 's'}`;
  if (!soList.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No sales orders yet.</p>'; return; }
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No sales orders match the filters.</p>'; return; }
  c.innerHTML = `<table class="flow-table"><thead><tr><th>SO No</th><th>Quotation</th><th>Date</th><th>PO received</th><th>Customer</th><th>Status</th><th>Supplier</th><th class="num">Total</th><th class="num">COGS</th><th>Items</th><th></th></tr></thead><tbody>${rows.map(s => `
    <tr><td>${flowEsc(s.soNo)}${!soHasPO[String(s.soNo)] ? ` <span class="flow-badge" style="background:rgba(245,158,11,0.14);color:#b45309;" title="No purchase order raised for this sales order yet">no PO</span>` : ''}</td><td>${flowEsc(s.quotationNo)}</td><td>${flowDate(s.date)}</td><td>${soReceivedCell(s)}</td><td>${flowEsc(s.customer)}</td>
    <td><span class="flow-badge b-open">${flowEsc(s.status)}</span></td><td>${soTypeBadge(s.supplierType)}</td><td class="num">${flowMoney(s.total, 'PHP')}</td><td class="num">${soCogsCell(s)}</td><td>${s.items.length}</td>
    <td style="white-space:nowrap;">${soViewer ? '' : `<button class="link-btn" onclick='soEditCost("${flowEsc(s.soNo)}")'>Costs</button>`}
    <button class="link-btn" onclick='openDocsModal("Sales Order","${flowEsc(s.soNo)}")' style="margin-left:0.5rem;">Docs</button>${soViewer ? '' : `
    <button class="link-btn" onclick='editSO("${flowEsc(s.soNo)}")' style="margin-left:0.5rem;">Edit</button>
    <button class="link-btn del-btn" onclick='deleteSO("${flowEsc(s.soNo)}")' style="margin-left:0.5rem;">Delete</button>`}</td></tr>`).join('')}</tbody></table>`;
}

function editSO(no) {
  // String-compare: migrated SOs have numeric SO numbers (stored as numbers by Sheets),
  // while `no` arrives as a string from the inline onclick — strict === would miss them.
  const s = soList.find(x => String(x.soNo) === String(no));
  if (!s) return;
  document.getElementById('soNo').value = s.soNo;
  const ni = document.getElementById('soNoInput');
  /* A220 — the SO number IS the record key (fourteen sheets, the Drive folder, the commission
     prior-claim check), which is why this was disabled. It is editable now because renameSalesOrder
     re-keys all of it; soOrigNo remembers what it was so save() can tell a rename from an edit. */
  if (ni) { ni.value = s.soNo; ni.disabled = false; ni.title = 'Editing this renames the order and re-keys every record on it.'; }
  soOrigNo = String(s.soNo);
  document.getElementById('quotationNo').value = s.quotationNo || '';
  document.getElementById('customer').value = s.customer;
  document.getElementById('date').value = flowDate(s.date);
  document.getElementById('status').value = s.status || 'Open';
  document.getElementById('soSupplierType').value = s.supplierType || '';
  // A186 — flowDate() returns '' for an empty cell, which is what a date input wants.
  ['clientPoDate', 'poReceivedDate'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.value = flowDate(id === 'clientPoDate' ? s.clientPoDate : s.poReceivedDate) || '';
  });
  const cpn = document.getElementById('clientPoNo'); if (cpn) cpn.value = s.clientPoNo || '';   // A193
  const cf = document.getElementById('clientPoFile'); if (cf) cf.value = '';
  const cm = document.getElementById('clientPoMsg'); if (cm) cm.style.display = 'none';
  document.getElementById('formTitle').textContent = 'Edit ' + s.soNo;
  document.getElementById('itemRows').innerHTML = '';
  (s.items || []).forEach(addRow);
  if (!s.items || !s.items.length) addRow();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteSO(no) {
  if (!confirm('Delete sales order ' + no + '?')) return;
  try {
    const res = await postFlow('deleteSalesOrder', { soNo: no });
    if (!res.success) throw new Error(res.message);
    await loadSOs();
  } catch (e) { alert(e.message); }
}


// ─── Cost breakdown (COGS column + inline editor) ─────────────────────────────
// COGS cell: the recorded Total COGS, or an amber "no cost" badge (same gap the audits flag).
function soCogsCell(s) {
  const cd = soCds[String(s.soNo)];
  if (!cd) return '<span class="flow-badge" style="background:rgba(245,158,11,0.14);color:#b45309;">no cost</span>';
  const gp = flowNum(cd.sales) - flowNum(cd.totalCOGS);
  return `<span title="Gross profit ₱${gp.toLocaleString('en-US', { minimumFractionDigits: 2 })}">${flowMoney(cd.totalCOGS, 'PHP')}</span>`;
}

// Open the shared cost editor (so-cost-editor.js) for any SO — historical or new.
// Prefills from the existing cost record; otherwise a blank record seeded from the SO
// (sales = SO total, type from the Supplier label). Saving upserts SOCostDetails,
// recomputes COGS, regenerates the SO's migrated invoice/receiving and re-syncs the label.
function soEditCost(no) {
  if (typeof openSoCostEditor !== 'function') { alert('Cost editor not loaded.'); return; }
  const s = soList.find(x => String(x.soNo) === String(no));
  if (!s) return;
  const cd = soCds[String(no)];
  const prefill = cd ? {
    soNo: String(s.soNo), customer: s.customer, date: flowDate(s.date), sales: cd.sales,
    cogsType: cd.cogsType || 'local', shippingCompany: cd.shippingCompany || '',
    purchaseOfGoods: cd.purchaseOfGoods, bankChargeCOGS: cd.bankChargeCOGS,
    dutiesAndTaxes: cd.dutiesAndTaxes, bankChargeShipping: cd.bankChargeShipping,
    shippingCost: cd.shippingCost, localCharges: cd.localCharges,
    deliveryToOffice: cd.deliveryToOffice, deliveryToClient: cd.deliveryToClient,
  } : {
    soNo: String(s.soNo), customer: s.customer, date: flowDate(s.date), sales: flowNum(s.total),
    cogsType: s.supplierType === 'International' ? 'international' : 'local', shippingCompany: '',
    purchaseOfGoods: 0, bankChargeCOGS: 0, dutiesAndTaxes: 0, bankChargeShipping: 0,
    shippingCost: 0, localCharges: 0, deliveryToOffice: 0, deliveryToClient: 0,
  };
  openSoCostEditor(prefill, () => loadSOs());
}
