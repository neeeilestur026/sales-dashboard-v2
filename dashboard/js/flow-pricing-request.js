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
/* A226 — a SIXTH step. The rail stopped at 'Quotation', which is the moment the quotation is created
   and not the moment anything reaches the client. A request whose quotation is still a draft looked
   finished here while the rep still had a move to make. 'Sent' is that move, and it is the join
   between a purchase request's life and the quotation's own — the thing the tracker was asked for.
   STEP_OF still tops out at 5 ('Quoted'), so nothing on this page advances into the new dot; it is
   the tracker that fills it in from the quotation's status. */
const STEP_LABELS = ['Request', 'Sourcing', 'Pricing', 'Verify', 'Quotation', 'Sent'];

const BADGE = {
  'Requested': 'b-open', 'Sourcing': 'b-open', 'For Mgmt Pricing': 'b-pending',
  'Mgmt Priced': 'b-pending', 'Verifying': 'b-pending', 'Returned to Sales': 'b-approved',
  'Quoted': 'b-closed'
};
// Display label only — the STORED status stays 'Returned to Sales' so existing rows,
// filters, and stage-gated logic keep working with zero migration.
function prStatusLabel(s) { return s === 'Returned to Sales' ? 'For Quotation' : s; }

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
    await Promise.all([loadInventory(), loadClients()]);
    const cust = document.getElementById('customer');
    if (cust) cust.addEventListener('change', prFillContacts);   // A145: client-master prefill
    addRow();
  }
  await loadRequests();
  if (prRole === 'management') loadFlowPricingHistory();
  // A169: ?fromInquiry=INQ-… — a Product Finder result being turned into a real request.
  // Runs LAST so loadInventory()/loadClients() above are already warm.
  const fromInquiry = new URLSearchParams(location.search).get('fromInquiry');
  if (fromInquiry) await prLoadFromInquiry(fromInquiry);
});

/* ── A169: Product Finder hand-off ────────────────────────────────────────────
   The Product Finder writes the chosen product onto its inquiry (localStorage, synchronously) and
   navigates here with just the id — the house convention: only an identifier travels in the URL.
   Resolution is LOCAL FIRST on purpose: the finder's backend sync is fire-and-forget, so navigating
   can abort it, and fetchFlow's 60-second cache may still hold a list captured before the inquiry
   existed. Reading the device's own list works on any backend version, or none at all. */

let prFromInquiry = '';

/** Read one Product Finder inquiry from this device (same localStorage key product-finder.js uses). */
function prLocalInquiry(id) {
  try {
    const list = JSON.parse(localStorage.getItem('pf_inquiries') || '[]');
    return list.find(x => x && x.id === id) || null;
  } catch (e) { return null; }
}

function prInquiryBanner(html, tone) {
  const el = document.getElementById('prInquiryBanner');   // lives OUTSIDE #salesFormCard on purpose:
  if (!el) return;                                          // that card is hidden for oversight roles
  el.style.display = '';
  el.style.borderLeftColor = tone === 'warn' ? '#f59e0b' : '#4f46e5';
  el.innerHTML = html;
}

async function prLoadFromInquiry(id) {
  if (prRole !== 'sales' && prRole !== 'admin') {
    prInquiryBanner('This Product Finder result can only be turned into a purchase request by sales or admin.', 'warn');
    return;
  }
  let inq = prLocalInquiry(id);
  if (!inq) {                                   // different device / cleared storage → ask the backend
    try {
      const res = await fetchFlow('getPfInquiries', prRole === 'sales' ? { user: prSession.name } : {}, { fresh: true });
      inq = ((res && res.data) || []).find(x => x && x.id === id) || null;
      if (inq && typeof inq.itemsJson === 'string' && inq.itemsJson) {
        try { inq.items = JSON.parse(inq.itemsJson); } catch (e) { inq.items = []; }
      }
    } catch (e) { /* offline / old backend — the banner below explains it */ }
  }
  if (!inq) {
    prInquiryBanner('Could not find Product Finder inquiry <b>' + flowEsc(id) + '</b> on this device. '
      + 'Fill the request in manually, or run the search again in the Product Finder.', 'warn');
    return;
  }

  const items = (inq.items || []).filter(it => it && it.name);
  // Clear the blank starter row first — its qty defaults to 1, so collectItems() would keep it and
  // save a phantom "N/A" line on every handed-off request.
  const rows = document.getElementById('itemRows');
  if (rows) rows.innerHTML = '';
  const cust = document.getElementById('customer');
  if (cust && inq.client) { cust.value = inq.client; prFillContacts(); }   // fills blanks from the client master
  items.forEach(it => addRow({
    itemNo: 'N/A',                          // finder products are catalog names, not part numbers
    itemName: it.name,
    qty: flowNum(it.qty) || 1,
    uom: 'pc',
    remarks: 'From Product Finder — confirm exact model'
  }));
  if (!items.length) addRow();
  countLines();
  prFromInquiry = id;
  prInquiryBanner('Started from Product Finder inquiry <b>' + flowEsc(id) + '</b>'
    + (items.length ? ' · ' + items.length + ' item(s) filled in' : '')
    + '. Check the details and add anything else before submitting.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

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
    seg.innerHTML = segBtns(['', 'Returned to Sales', 'Quoted'], ['All', 'For Quotation', 'Quoted']);
  } else if (prOversight) {
    const sqc = document.getElementById('sqSummaryCard'); if (sqc) sqc.style.display = '';   // A161b
    listTitle.textContent = 'All Purchase Requests (by sales rep)';
    blurb.textContent = 'Full oversight of every rep’s pricing requests across all stages. Open any request to review or act on its current stage.';
    seg.innerHTML = segBtns(['', 'Requested,Sourcing', 'For Mgmt Pricing', 'Mgmt Priced', 'Returned to Sales,Quoted'],
      ['All', 'Sourcing', 'Pricing', 'Verify', 'Done']);
    prFilter = '';
  } else if (prRole === 'admin') {
    document.getElementById('salesFormCard').style.display = '';   // admin can also start a purchase request
    const rb = document.getElementById('resyncBtn'); if (rb) rb.style.display = '';   // numbering maintenance (admin only)
    const sqc = document.getElementById('sqSummaryCard'); if (sqc) sqc.style.display = '';   // A161b: saved supplier quotations
    listTitle.textContent = 'Sourcing & Verification Queue';
    blurb.textContent = 'Create a purchase request below, or source suppliers and prices for each item then forward to management. After management prices it, verify and return to sales.';
    /* A192: admin had no chip for the returned stage, so a request an ADMIN raised became
       invisible the moment it came back — sales cannot see it (their list is scoped to their own
       name) and admin's default filter excluded it. Two live records sat stranded this way. */
    seg.innerHTML = segBtns(['Requested,Sourcing', 'Mgmt Priced', 'Returned to Sales', ''],
                            ['To Source', 'To Verify', 'For Quotation', 'All']);
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
    // A201 — reveal Reject only when the backend supports rejectMgmtPricing (v110), so it can never
    // be clicked against an older deployment that would answer "unknown action".
    if (typeof flowVersionAtLeast === 'function') {
      flowVersionAtLeast(110).then(ok => { const rb = document.getElementById('peRejectBtn'); if (rb && ok) rb.style.display = ''; });
    }
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
  if (typeof fillPrDatalist === 'function') fillPrDatalist();   // A146: autocomplete suggestions
}

// A145: client master → prefill the PR contact block when the customer is chosen (blank fields only).
let prClients = {};
async function loadClients() {
  prClients = {};
  try {
    const r = await fetchFlow('getClients');
    ((r && r.data) || []).forEach(c => { prClients[String(c.customer).toLowerCase()] = c; });
  } catch (e) { /* prefill is best-effort */ }
}
function prFillContacts() {
  const custEl = document.getElementById('customer');
  const c = prClients[String((custEl && custEl.value) || '').trim().toLowerCase()];
  if (!c) return;
  const fill = (id, v) => { const el = document.getElementById(id); if (el && !el.value && v) el.value = v; };
  fill('prAddress', c.address); fill('prContact', c.contactPerson); fill('prDesignation', c.designation);
  fill('prEmail', c.email); fill('prPhone', c.phone); fill('prClientNo', c.rfqRef);
}

// ─── Sales: request form ─────────────────────────
// A146: free-type item entry with an inventory autocomplete (datalist), mirroring the admin quotation
// (A63). A brand-new item is added to inventory (Catalog, balance 0) on submit — no separate step. The
// datalist is keyed on Item No; picking one auto-fills the description from the first matching inventory
// row (an exact code is unique; the shared "N/A" is a rare edge the user can override).
/* A159: 92 catalogue items share the item number 'N/A', so a datalist keyed on the NUMBER resolved
   every one of them to the first match (the reported bug: picking a bladder yielded a plier set).
   The option value is now a unique label; picking one stamps the row with the item's permanent
   Item ID, and the visible Item No box still shows the plain 'N/A' that documents print. */
let prInvByLabel = {};

function prInvLabel(i, seen) {
  let label = `${i.itemNo} — ${i.description || ''}`.trim();
  if (seen[label]) { seen[label]++; label += ` (${seen[label]})`; }   // identical descriptions stay distinguishable
  else seen[label] = 1;
  return label;
}

function fillPrDatalist() {
  const dl = document.getElementById('prInvList');
  const seen = {};
  prInvByLabel = {};
  const opts = prInventory.map(i => {
    const label = prInvLabel(i, seen);
    prInvByLabel[label] = i;
    return `<option value="${flowEsc(label)}"></option>`;
  });
  if (dl) dl.innerHTML = opts.join('');
}
function prFillDesc(inp) {
  const tr = inp.closest('tr');
  const desc = tr.querySelector('.pr-desc');
  const typed = String(inp.value || '').trim();

  // 1. An exact datalist pick — the only unambiguous case. Stamp the id, then put the plain item
  //    number back in the box so the rep sees (and the document prints) 'N/A', not an internal id.
  const picked = prInvByLabel[typed];
  if (picked) {
    tr.dataset.itemId = picked.itemId || '';
    inp.value = picked.itemNo || '';
    if (desc) desc.value = picked.description || '';
    return;
  }

  // 2. Free-typed text: the stamp can no longer be trusted to match what's in the box.
  delete tr.dataset.itemId;

  // 3. Convenience — a typed number that matches exactly ONE item is still unambiguous, so adopt it.
  //    A number shared by several products (N/A) deliberately stamps nothing; the server then
  //    resolves by description and flags the line if it still can't tell them apart.
  const hits = prInventory.filter(i => String(i.itemNo).toLowerCase() === typed.toLowerCase());
  if (hits.length === 1) {
    tr.dataset.itemId = hits[0].itemId || '';
    if (desc && !desc.value) desc.value = hits[0].description || '';
  }
}

/* Editing the description by hand also invalidates a stamped id — the row may no longer be the
   product that was picked. */
function prDescEdited(inp) {
  const tr = inp.closest('tr');
  if (tr && tr.dataset.itemId) delete tr.dataset.itemId;
}

function addRow(item) {
  const tb = document.getElementById('itemRows');
  const tr = document.createElement('tr');
  if (item && item.itemId) tr.dataset.itemId = item.itemId;   // A159: keep the identity on edit/reload
  tr.innerHTML = `
    <td><input type="text" class="pr-itemno" list="prInvList" value="${item ? flowEsc(item.itemNo) : ''}" placeholder="Item No" oninput="prFillDesc(this)" style="width:100%;"></td>
    <td><input type="text" class="pr-desc" value="${item ? flowEsc(item.itemName || item.description || '') : ''}" placeholder="Description" oninput="prDescEdited(this)" style="width:100%;"></td>
    <td class="num"><input type="number" step="any" min="0" class="pr-qty" value="${item ? flowNum(item.qty) : 1}"></td>
    <td><input type="text" class="pr-uom" value="${item ? flowEsc(item.uom || '') : ''}" placeholder="pc"></td>
    <td><input type="text" class="pr-remarks" value="${item ? flowEsc(item.remarks || '') : ''}" placeholder="optional"></td>
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
    const itemNo = (tr.querySelector('.pr-itemno').value || '').trim();
    const desc = (tr.querySelector('.pr-desc').value || '').trim();
    const qty = flowNum(tr.querySelector('.pr-qty').value);
    // Keep any line with a code, a description or a quantity; blank code → shared 'N/A' key (flow convention).
    if (!itemNo && !desc && !(qty > 0)) return;
    items.push({
      itemId: tr.dataset.itemId || '',   // A159: which catalogue item this actually is
      itemNo: itemNo || 'N/A', itemName: desc || itemNo,
      qty: qty,
      uom: tr.querySelector('.pr-uom').value.trim(),
      remarks: tr.querySelector('.pr-remarks').value.trim()
    });
  });
  return items;
}

async function saveRequest() {
  let items = collectItems();
  // Drop EXACT duplicate lines (same item/qty/uom/remarks) — ordering the identical line twice is
  // always accidental; a real repeat order bumps the qty instead.
  const seen = new Set();
  const before = items.length;
  items = items.filter(i => {
    const k = [i.itemNo, i.itemName, i.qty, i.uom, i.remarks].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const droppedDupes = before - items.length;
  const customer = document.getElementById('customer').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer is required.', false); return; }
  if (!items.length) { flowMsg('formMsg', 'Add at least one item.', false); return; }
  const btn = document.getElementById('saveBtn');
  const date = document.getElementById('date').value;
  // Client contact details — printed on the PR PDF's COMPANY INFORMATION block and persisted on the
  // request (Doc JSON) so a later re-generation prefills them.
  const gv = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const doc = {
    companyName: customer, companyAddress: gv('prAddress'),
    contactPerson: gv('prContact'), designation: gv('prDesignation'),
    contactEmail: gv('prEmail'), contactPhone: gv('prPhone'),
    dateNeeded: gv('prDateNeeded'), urgency: gv('prUrgency'), prNumberClient: gv('prClientNo'),
    preparedByName: prSession.name
  };
  const payload = {
    customer, date, notes: document.getElementById('notes').value.trim(),
    requestedBy: prSession.name, items: JSON.stringify(items),
    docJson: JSON.stringify(doc),
    // Idempotency key: if the network bounces and postFlow retries, the backend returns the
    // already-created PR instead of writing a duplicate.
    clientRef: 'CR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  };
  btn.disabled = true; btn.textContent = 'Submitting...';
  try {
    const res = await postFlow('createPricingRequest', payload);
    if (!res.success) throw new Error(res.message);
    // A169: close the loop — stamp the PR number back on the Product Finder inquiry so the rep can
    // see which searches became real business. Never allowed to break the request that just saved.
    if (prFromInquiry) {
      try {
        const list = JSON.parse(localStorage.getItem('pf_inquiries') || '[]');
        const i = list.findIndex(x => x && x.id === prFromInquiry);
        if (i !== -1) {
          list[i] = Object.assign({}, list[i], { prNo: res.prNo, status: 'quoted', updatedAt: new Date().toISOString(), _synced: false });
          localStorage.setItem('pf_inquiries', JSON.stringify(list));
        }
        postFlow('savePfInquiry', { id: prFromInquiry, prNo: res.prNo, status: 'quoted' }).catch(() => {});
      } catch (e) { /* the PR is already saved — a logbook stamp must never undo that */ }
    }
    // A145: self-populate the client master with any newly-typed contact details (best-effort).
    if (customer && (doc.companyAddress || doc.contactPerson || doc.contactEmail || doc.contactPhone)) {
      const prev = prClients[String(customer).toLowerCase()] || {};
      postFlow('saveClient', {
        customer, address: doc.companyAddress || prev.address || '',
        contactPerson: doc.contactPerson || prev.contactPerson || '',
        designation: doc.designation || prev.designation || '',
        email: doc.contactEmail || prev.email || '',
        phone: doc.contactPhone || prev.phone || '',
        rfqRef: doc.prNumberClient || prev.rfqRef || ''
      }).catch(() => {});
    }
    // A146: free-typed items not yet in inventory → add them as Catalog products (balance 0), so the
    // request's items become real inventory records (mirrors the admin A63 quotation auto-add).
    const known = new Set(prInventory.map(i => String(i.itemNo).toLowerCase()));
    const knownDesc = new Set(prInventory.map(i => String(i.description || '').trim().toLowerCase()));
    for (const it of items) {
      if (it.itemId) continue;                       // already a catalogue item — nothing to add
      const code = String(it.itemNo || '').trim();
      const desc = String(it.itemName || '').trim();
      if (!code) continue;
      const isNA = code.toUpperCase() === 'N/A';
      // A159: an item without a part number can now own its own row, because identity no longer
      // depends on the number. Match on description so re-typing an existing no-code product
      // doesn't spawn a duplicate; genuinely new ones finally get a record.
      if (isNA) {
        if (!desc || knownDesc.has(desc.toLowerCase())) continue;
        knownDesc.add(desc.toLowerCase());
      } else {
        if (known.has(code.toLowerCase())) continue;
        known.add(code.toLowerCase());
      }
      try {
        await postFlow('addInventoryItem', { itemNo: code, description: desc || code, balance: 0, currency: 'PHP', type: 'Catalog' });
      } catch (e) { /* ignore "already exists" and transient errors */ }
    }
    await loadInventory();
    resetForm();
    // Auto-generate the branded PR PDF and save it to Drive + the PDF Link column (best-effort,
    // never blocks creation). No tab pops open (background) — it's an automatic archive on creation.
    let extra = '', savedLink = '', lastErr = '';
    btn.textContent = 'Saving PDF...';
    const pdfPayload = { prNo: res.prNo, customer, date, requestedBy: prSession.name, doc,
      items: items.map(i => ({ itemNo: i.itemNo, itemName: i.itemName, qty: i.qty, uom: i.uom, remarks: i.remarks })) };
    // Best-effort, never blocks creation — but retry once, since a single transient Drive/upload blip
    // otherwise strands the PR with no PDF (the Generate PR PDF button on the row is the manual backstop).
    for (let attempt = 0; attempt < 2 && !savedLink; attempt++) {
      try {
        if (attempt) await new Promise(r => setTimeout(r, 800));
        const { link, saveError } = await generateFlowPdf('/flow/pr-pdf', pdfPayload,
          'savePRPDF', 'prNo', res.prNo, `Purchase_Request_${res.prNo}.pdf`, { background: true });
        savedLink = link || '';
        if (saveError) lastErr = saveError;
      } catch (e) { lastErr = (e && e.message) || 'render failed'; }
    }
    extra = savedLink ? ' · PDF saved to Drive'
      : ' · ⚠ PDF not saved' + (lastErr ? ' (' + lastErr + ')' : '') + ' — use “Generate PR PDF” on the row';
    if (droppedDupes) extra += ` · ${droppedDupes} duplicate line(s) removed`;
    flowMsg('formMsg', `${res.message} (${res.prNo})${extra}`, true);
    await loadRequests();
    // The PDF Link cell was just written; a re-read can be momentarily stale (empty), so the "View PDF"
    // link wouldn't show until a later refresh. We already have the link in memory — patch the row now.
    if (savedLink) {
      const row = prList.find(x => String(x.prNo) === String(res.prNo));
      if (row && !row.pdfLink) { row.pdfLink = savedLink; renderList(); }
    }
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Submit to Admin'; }
}

function resetForm() {
  document.getElementById('prNo').value = '';
  document.getElementById('customer').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('date').value = flowToday();
  ['prContact', 'prDesignation', 'prEmail', 'prPhone', 'prAddress', 'prDateNeeded', 'prUrgency', 'prClientNo']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('itemRows').innerHTML = '';
  document.getElementById('formMsg').style.display = 'none';
  prFromInquiry = '';                                   // A169: a second Save must not re-stamp the inquiry
  const banner = document.getElementById('prInquiryBanner');
  if (banner) banner.style.display = 'none';
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

// Admin maintenance: after deleting PR rows in the sheet, resync the monotonic numbering counter so the
// next PR resumes from the current highest number (fills the gap left by the deletion).
async function resyncNumbering() {
  if (!confirm('Resync PR numbering to the current sheet?\n\nDo this only AFTER deleting the unwanted PR rows in the sheet — the next purchase request will then continue from the highest remaining PR number.')) return;
  const btn = document.getElementById('resyncBtn');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Resyncing…'; }
  try {
    const res = await postFlow('resetSequenceCounters', { prefix: 'PR' });
    alert(res && res.success ? (res.message || 'Numbering resynced.') : (res.message || 'Failed to resync.'));
  } catch (e) { alert(e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = orig || 'Resync numbering'; } }
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
    <td><span class="flow-badge ${BADGE[r.status] || 'b-open'}">${flowEsc(prStatusLabel(r.status))}</span></td>
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
    ['For Quotation / Quoted', ['Returned to Sales', 'Quoted']],
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
  // Recovery: if the auto-save on creation missed (no pdfLink), let the owner / admin regenerate it
  // from any status — otherwise a transient Drive blip strands the PR without a PDF until it returns.
  const canRegen = canSource || (prRole === 'sales' && String(r.requestedBy) === String(prSession.name));
  if (!r.pdfLink && canRegen)
    return open + docs + ` <button class="link-btn" onclick='openPdf("${flowEsc(r.prNo)}")' style="margin-left:0.5rem;">Generate PR PDF</button>`;
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
  document.getElementById('modalSub').textContent = `${r.customer}${r.clientLocation ? ' (' + r.clientLocation + ')' : ''} · requested by ${r.requestedBy} · ${flowDate(r.date)} · ${prStatusLabel(r.status)}`;
  document.getElementById('modalMsg').style.display = 'none';
  const body = document.getElementById('modalBody');
  const foot = document.getElementById('modalFoot');

  if (canSource && (r.status === 'Requested' || r.status === 'Sourcing')) {
    body.innerHTML = sourcingTable(r);
    sqDecorateSourcing();   // A161: fill in each row's past supplier prices (async, best-effort)
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      <button class="btn btn-secondary" onclick="openDocsModal('Pricing Request','${flowEsc(r.prNo)}','Supplier quotation · ${flowEsc(r.prNo)}','Supplier Quotation')">📎 Supplier Quotation (PDF)</button>
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
      ${srcEditBtn(no)}
      <button class="btn btn-primary" onclick="verifyReturn()">Verify &amp; Return to Sales</button>`;
  } else if (r.status === 'Returned to Sales' && (prRole === 'sales' || prRole === 'admin')) {
    /* A192: was `prRole === 'admin' && r.requestedBy === prSession.name`. Tying the only
       Create-Quotation button in the system to one exact name string is what stranded
       PR-202607-242 and PR-202607-295: rename the user, add a trailing space, or have them leave,
       and the record becomes permanently unactionable with nobody able to rescue it. Any admin can
       now finish an admin-raised request. This grants no new capability — createQuotationFromPR
       (FlowAPI.gs) gates on STATUS only and has no role check — it just stops the UI hiding a
       button from people the backend already accepts. */
    body.innerHTML = readonlyTable(r, true);
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      ${prRole === 'admin' ? srcEditBtn(no) : ''}
      <button class="btn btn-secondary" onclick="openPdf('${flowEsc(no)}')">Generate PR PDF</button>
      <button class="btn btn-primary" onclick="makeQuotation('${flowEsc(no)}')">Create Quotation</button>`;
  } else {
    body.innerHTML = readonlyTable(r, false);
    // Same recovery affordance as the list: regenerate a missing PDF from any status.
    const canRegen = canSource || (prRole === 'sales' && String(r.requestedBy) === String(prSession.name));
    foot.innerHTML = `<button class="btn btn-secondary" onclick="closePr()">Close</button>
      ${canSource ? srcEditBtn(no) : ''}
      ${!r.pdfLink && canRegen ? `<button class="btn btn-secondary" onclick="openPdf('${flowEsc(no)}')">Generate PR PDF</button>` : ''}
      ${r.pdfLink ? `<a class="btn btn-secondary" href="${flowEsc(r.pdfLink)}" target="_blank">View PDF</a>` : ''}`;
  }
  document.getElementById('prModal').classList.add('open');
}

// Admin (and oversight) can correct the supplier pricing at ANY stage — the button swaps the modal
// to the editable sourcing table; saving never touches the PR's status (updatePRSourcing is a pure
// item/header write, and this path never calls submitForPricing).
function srcEditBtn(no) {
  return `<button class="btn btn-secondary" onclick="openSourcingEdit('${flowEsc(no)}')">✎ Edit Supplier Pricing</button>`;
}

function openSourcingEdit(no) {
  const r = curPr(no);
  if (!r) return;
  const body = document.getElementById('modalBody');
  const foot = document.getElementById('modalFoot');
  document.getElementById('modalMsg').style.display = 'none';
  // Past the pricing stage, management's final prices are already set — editing supplier costs here
  // won't move them; the request must be re-priced by management if the final price should change.
  const late = ['Mgmt Priced', 'Returned to Sales', 'Quoted'].includes(r.status);
  const hint = late
    ? `<p class="pr-meta" style="margin-bottom:0.5rem;color:#b45309;">⚠ Editing supplier prices here does <b>not</b> change management's final prices — use <b>Save &amp; Send for Re-pricing</b> so management re-prices with the new costs.</p>`
    : (r.status === 'For Mgmt Pricing'
      ? `<p class="pr-meta" style="margin-bottom:0.5rem;color:#b45309;">⚠ This request is already queued for management pricing — the engine will pick up the updated supplier prices when management opens it.</p>`
      : '');
  body.innerHTML = hint + sourcingTable(r);
  sqDecorateSourcing();   // A161: same history on the edit-anytime sourcing view
  // Post-pricing stages get a one-click "save + send back to management" so the final price
  // is recomputed from the corrected costs (submitForPricing just flips the status back).
  foot.innerHTML = `<button class="btn btn-secondary" onclick="openPr('${flowEsc(no)}')">← Back</button>
    <!-- A195: this button was missing its presetType, so a quotation attached from the post-pricing
         sourcing view did not satisfy the Supplier Quotation gate that demands one. -->
    <button class="btn btn-secondary" onclick="openDocsModal('Pricing Request','${flowEsc(r.prNo)}','Supplier quotation · ${flowEsc(r.prNo)}','supplier quotation')">📎 Supplier Quotation (PDF)</button>
    <button class="btn ${late ? 'btn-secondary' : 'btn-primary'}" onclick="saveSourcing(false)">Save Changes</button>
    ${late ? `<button class="btn btn-primary" onclick="saveSourcing(true)">Save &amp; Send for Re-pricing</button>` : ''}`;
}
function closePr() { document.getElementById('prModal').classList.remove('open'); }

/* A158: an included line priced at 0 used to render as "—", which reads as "not priced yet" — so a
   line that will print on the client's quotation as FREE looked like missing data. Say what it is. */
function _prFinalCell(i) {
  if (!i.included) return flowNum(i.finalPrice) ? flowMoney(i.finalPrice, 'PHP') : '—';
  return flowNum(i.finalPrice) > 0
    ? flowMoney(i.finalPrice, 'PHP')
    : '<span style="color:#b45309;font-weight:700;" title="This item will print on the quotation at zero — a freebie.">₱0.00 (free)</span>';
}

function readonlyTable(r, priced) {
  return `<div style="overflow-x:auto;"><table class="flow-table"><thead><tr><th>Item</th><th class="num">Qty</th><th>UOM</th>
    <th>Supplier</th><th>Principal</th><th class="num">Price (FC)</th><th>VAT</th>${priced ? '<th class="num">Final Price</th>' : ''}<th>Incl?</th></tr></thead><tbody>${r.items.map(i =>
    `<tr><td>${flowEsc(i.itemNo)} — ${flowEsc(i.itemName)}</td><td class="num">${flowNum(i.qty)}</td><td>${flowEsc(i.uom)}</td>
      <td>${flowEsc(i.supplier || '—')}</td><td>${flowEsc(i.principal || '—')}</td>
      <td class="num">${i.supplierPrice ? flowNum(i.supplierPrice) : '—'}</td><td>${flowEsc(i.vat || '—')}</td>
      ${priced ? `<td class="num">${_prFinalCell(i)}</td>` : ''}
      <td>${i.included ? '✓' : '—'}</td></tr>`).join('')}</tbody></table></div>
    ${r.plantSite ? `<p class="pr-meta" style="margin-top:0.5rem;">Plant Site: <b>${flowEsc(r.plantSite)}</b></p>` : ''}
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

function svatSelect(v) {
  const cur = String(v || '');
  return `<option value=""${cur === '' ? ' selected' : ''}>—</option>` +
    `<option value="Exclusive"${cur === 'Exclusive' ? ' selected' : ''}>Ex</option>` +
    `<option value="Inclusive"${cur === 'Inclusive' ? ' selected' : ''}>Incl</option>`;
}

function sourcingTable(r) {
  const inp = 'width:100%;max-width:420px;padding:0.45rem 0.6rem;border:1px solid var(--border,#e2e8f0);border-radius:8px;';
  return `<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;">
      <div style="flex:1;min-width:220px;">
        <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.25rem;">Client Location</label>
        <input type="text" id="srcLocation" value="${flowEsc(r.clientLocation || '')}" placeholder="e.g. Cebu City, Cebu" style="${inp}">
      </div>
      <div style="flex:1;min-width:220px;">
        <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.25rem;">Plant Site / Delivery Destination <span style="color:#dc2626;">*</span></label>
        <input type="text" id="srcPlantSite" value="${flowEsc(r.plantSite || '')}" placeholder="e.g. Ambuklao Plant, Bokod" style="${inp}">
      </div>
    </div>
    <p class="pr-meta">Set the supplier, principal, currency, supplier price (FC), CBM and whether the supplier price is <b>VAT&nbsp;Inclusive/Exclusive</b> per item. You can replace the <b>item code</b> and <b>product description</b> with the supplier's own — the updated code/description carries through management pricing and into the quotation. (Leave the code as-is to keep yours.) Untick items that won't be quoted.</p>
    <div style="overflow-x:auto;"><table class="flow-table" id="srcTable" style="min-width:960px;"><thead><tr>
      <th>Item No</th><th>Product Description</th><th class="num">Qty</th><th>Supplier</th><th>Principal</th><th>Cur</th>
      <th class="num">Price (FC)</th><th>VAT</th><th class="num">CBM</th><th>Incl</th></tr></thead><tbody>${r.items.map(i =>
      `<tr data-line="${i.line}">
        <td><input type="text" class="s-no" value="${flowEsc(i.itemNo)}" style="min-width:110px;"></td>
        <td><input type="text" class="s-name" value="${flowEsc(i.itemName || '')}" style="min-width:200px;"></td>
        <td class="num">${flowNum(i.qty)}</td>
        <td><input type="text" class="s-sup" value="${flowEsc(i.supplier || '')}"></td>
        <td><select class="s-prin">${principalSelect(i.principal)}</select></td>
        <td><select class="s-cur">${currencySelect(i.currency)}</select></td>
        <td class="num"><input type="number" step="any" min="0" class="s-price" value="${i.supplierPrice || 0}"></td>
        <td><select class="s-vat" title="Is the supplier price VAT Inclusive or Exclusive?">${svatSelect(i.vat)}</select></td>
        <td class="num"><input type="number" step="any" min="0" class="s-cbm" value="${i.cbm || 0}"></td>
        <td><input type="checkbox" class="s-incl"${i.included ? ' checked' : ''}></td></tr>
      <tr data-sq-for="${i.line}"><td colspan="10" style="padding:0 0 0.5rem 0;border-top:none;">
        <button type="button" class="link-btn" id="sqBtn_${i.line}" disabled
          onclick="sqToggle(${i.line})" title="Previous supplier quotations recorded for this item">⟲ checking history…</button>
        <div id="sqHist_${i.line}" style="display:none;margin:0.4rem 0 0.2rem;padding:0.6rem;border:1px solid var(--border,#e2e8f0);border-radius:8px;overflow-x:auto;">
          <div data-sq-body></div>
        </div>
      </td></tr>`).join('')}</tbody></table></div>
    <div style="margin-top:0.75rem;">
      <button type="button" class="link-btn" onclick="sqToggleBrowse()">📚 Browse all saved supplier quotations</button>
      <div id="sqBrowse" style="display:none;margin-top:0.5rem;padding:0.6rem;border:1px solid var(--border,#e2e8f0);border-radius:8px;">
        <input type="text" id="sqSearch" placeholder="Search supplier, item, reference or PR no..." oninput="sqRenderBrowse()"
          style="width:100%;max-width:460px;padding:0.4rem 0.6rem;border:1px solid var(--border,#e2e8f0);border-radius:8px;margin-bottom:0.5rem;">
        <div id="sqBrowseBody" style="overflow-x:auto;"></div>
      </div>
    </div>
    <label style="display:flex;align-items:center;gap:0.5rem;margin-top:0.75rem;font-size:0.85rem;">
      <input type="checkbox" id="srcVerified"> I have <b>verified the supplier prices are correct</b> before forwarding to management.
    </label>`;
}

function collectSourcing() {
  const updates = [];
  // Item rows carry data-line; the A161 supplier-price history rows (data-sq-for) sit between them and
  // hold no inputs. Key on data-line, and skip anything without the expected fields, so injecting a
  // row into this table can never silently break saving again.
  document.querySelectorAll('#srcTable tbody tr[data-line]').forEach(tr => {
    if (!tr.querySelector('.s-no')) return;
    updates.push({
      line: flowNum(tr.getAttribute('data-line')),
      itemNo: tr.querySelector('.s-no').value.trim(),      // supplier's own code (blank = keep original)
      itemName: tr.querySelector('.s-name').value.trim(),
      included: tr.querySelector('.s-incl').checked,
      supplier: tr.querySelector('.s-sup').value.trim(),
      principal: tr.querySelector('.s-prin').value,
      currency: tr.querySelector('.s-cur').value,
      supplierPrice: flowNum(tr.querySelector('.s-price').value),
      vat: tr.querySelector('.s-vat').value,               // Inclusive|Exclusive note (display only)
      cbm: flowNum(tr.querySelector('.s-cbm').value)
    });
  });
  return updates;
}

async function saveSourcing(forward) {
  const prNo = document.getElementById('modalPrNo').value;
  const locEl = document.getElementById('srcLocation');
  const clientLocation = locEl ? locEl.value.trim() : '';
  const psEl = document.getElementById('srcPlantSite');
  const plantSite = psEl ? psEl.value.trim() : '';
  // Reading the form runs before any try below, so an exception here used to escape as an unhandled
  // promise rejection — no message, both buttons apparently dead. Surface it instead.
  let items;
  try { items = collectSourcing(); }
  catch (e) {
    flowMsg('modalMsg', 'Could not read the sourcing table: ' + e.message + ' — reload the page and try again.', false);
    return;
  }
  // A144 Forward-to-Management gates (client-side; the backend backstops each one):
  if (forward) {
    if (!plantSite) { flowMsg('modalMsg', 'Enter a plant-site destination before forwarding.', false); if (psEl) psEl.focus(); return; }
    const included = items.filter(i => i.included);
    const bad = included.find(i => !(i.supplierPrice > 0) || !i.principal || !i.currency);
    if (bad) { flowMsg('modalMsg', 'Every included item needs a supplier price, principal and currency.', false); return; }
    const verEl = document.getElementById('srcVerified');
    if (verEl && !verEl.checked) { flowMsg('modalMsg', 'Tick the box to confirm you have verified the supplier prices.', false); return; }
    // Require the supplier's quotation attached (Doc Type "Supplier Quotation"). Save the sourcing
    // first so the plant site / VAT flags persist even if the attachment is still missing — and
    // surface any failure instead of forwarding on top of a save that didn't stick.
    try {
      const sv = await postFlow('updatePRSourcing', { prNo, clientLocation, plantSite, items: JSON.stringify(items) });
      if (!sv.success) throw new Error(sv.message);
    } catch (e) { flowMsg('modalMsg', 'Could not save the sourcing: ' + e.message, false); return; }
    const hasQuote = await flowHasDoc('Pricing Request', prNo, 'Supplier Quotation');
    if (!hasQuote) {
      flowMsg('modalMsg', "Attach the supplier's quotation first (📎 Supplier Quotation button) — it must be tagged “Supplier Quotation”.", false);
      return;
    }
  }
  try {
    if (!forward) {
      const res = await postFlow('updatePRSourcing', { prNo, clientLocation, plantSite, items: JSON.stringify(items) });
      if (!res.success) throw new Error(res.message);
      flowMsg('modalMsg', 'Sourcing saved.', true);
    } else {
      const f = await postFlow('submitForPricing', { prNo });
      if (!f.success) throw new Error(f.message);
      flowMsg('modalMsg', 'Forwarded to management.', true);
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
  const ctx = document.getElementById('peContext'); if (ctx) ctx.style.display = 'none';   // A156
  const sb = document.getElementById('peSaveBtn'); if (sb) sb.disabled = true;
  const db = document.getElementById('peDocsBtn'); if (db) db.disabled = true;
  const rb = document.getElementById('peRejectBtn'); if (rb) rb.disabled = true;   // A201
  const msg = document.getElementById('peMsg'); if (msg) msg.style.display = 'none';
}

// View the supplier-quotation PDF(s) the admin attached to the loaded request (forwarded via Docs).
function peViewDocs() {
  if (!pePrNo) return;
  openDocsModal('Pricing Request', pePrNo, 'Supplier quotation · ' + pePrNo);
}

// Load a request's items + saved pricing into the calculator (to price, or re-price a past one).
/* A156: management prices the freight but never saw where the goods have to land — openPr sends
   management straight into the engine, so the request detail (the only place Plant Site appeared)
   was never rendered for them. Show the sourcing context right above the Configuration grid.
   Plant Site is the DELIVERY destination admin captured at sourcing; it is deliberately separate
   from the engine's Destination, which drives CBM freight and the minimum charge. */
function peRenderContext(r) {
  const el = document.getElementById('peContext');
  if (!el) return;
  const chip = (k, v, cls) =>
    `<span class="pe-ctx ${cls || ''}"><span class="k">${k}</span><span class="v">${flowEsc(v)}</span></span>`;
  const bits = [];
  if (r.plantSite) bits.push(chip('Plant site', r.plantSite, 'site'));
  if (r.clientLocation) bits.push(chip('Client location', r.clientLocation));
  if (!bits.length) {
    // Say so rather than render an empty strip — a missing plant site is worth noticing, since
    // A144 requires one before admin can forward a request for pricing.
    el.innerHTML = '<span class="pe-ctx-note">No plant site recorded on this request.</span>';
    el.style.display = 'flex';
    return;
  }
  bits.push('<span class="pe-ctx-note">Delivery destination from sourcing — the freight Destination below is set separately.</span>');
  el.innerHTML = bits.join('');
  el.style.display = 'flex';
}

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
  // A159: key the saved breakdown by LINE, not item number. Two 'N/A' lines on one request
  // overwrote each other, so re-pricing a multi-line no-code PR prefilled the second line with the
  // first's buy price and CBM. Line is unique per request; fall back to the number for legacy
  // breakdowns written before the line was stored.
  const bdByLine = {}, bdByNo = {};
  bd.forEach((b, bi) => {
    if (!b) return;
    const line = (b.line != null && b.line !== '') ? String(b.line) : String(bi + 1);
    bdByLine[line] = b;
    const k = String((b.modelNo || b.itemNo) || '');
    if (k && !bdByNo[k]) bdByNo[k] = b;   // first wins; only used when the line lookup misses
  });
  // Seed Forex/Duties from the principal; if re-pricing, override from the saved breakdown.
  mUpdateReadouts(true);
  if (bd.length && bd[0]) {
    if (bd[0].forex != null) set('mForex', bd[0].forex);
    if (bd[0].dutiesPct != null) set('mDuties', bd[0].dutiesPct);
  }
  const rowsHtml = inc.map((i, idx) => {
    const b = bdByLine[String(i.line != null ? i.line : idx + 1)] || bdByNo[String(i.itemNo)] || {};
    // Buy price + CBM come from the item's CURRENT sourcing values — admin re-sourcing updates them,
    // and setMgmtPricing writes management's own edits back there too, so they are always the latest.
    // The saved breakdown is only a fallback for legacy/migrated rows that carry no supplier price
    // (seeding from the breakdown made re-pricing show the STALE buy price after an admin edit).
    return peRowHtml(i, idx, {
      buyPrice: (flowNum(i.supplierPrice) ? i.supplierPrice : (b.buyPrice != null ? b.buyPrice : 0)),
      discount: b.discount, qty: i.qty,
      cbm: (flowNum(i.cbm) ? i.cbm : (b.cbm != null ? b.cbm : 0))
    });
  }).join('');
  const rowsEl = document.getElementById('peRows');
  if (rowsEl) rowsEl.innerHTML = rowsHtml || '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:1rem;">No included items to price.</td></tr>';
  const banner = document.getElementById('peEditBanner');
  if (banner) { banner.style.display = 'flex'; const id = document.getElementById('peEditId'); if (id) id.textContent = `${r.prNo} · ${r.customer || ''} · ${flowEsc(prStatusLabel(r.status || ''))}`; }
  peRenderContext(r);
  const sb = document.getElementById('peSaveBtn'); if (sb) sb.disabled = false;
  const db = document.getElementById('peDocsBtn'); if (db) db.disabled = false;
  // A201 — only a request still awaiting first-time pricing can be rejected; a re-price of an
  // already-priced/quoted request cannot (mirrors the backend gate).
  const rb = document.getElementById('peRejectBtn'); if (rb) rb.disabled = (r.status !== 'For Mgmt Pricing');
  recalcPricing();
  peRenderRepriceWarn(peRepriceGuard(r));   // A183: warn before a stray-margin re-price can inflate
  peLoadPriceHistory(r.customer);
  const card = document.getElementById('mgmtEngineCard');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* A183 — before a re-price can silently inflate lines, compare each saved line price against what the
   record's OWN stored margin/commission/duties would now produce. When a request was priced across two
   runs at different margins (PR-202607-210: lines 1-4 at 25%/7.5%, line 5 at 35%/10%), the record keeps
   only the last run's single margin, so reloading recomputes every line at that stray margin — inflating
   the others ~20%. A reload+save+re-quote would then overcharge, and the approval deviation gate can't
   catch it (quotation and PR would agree on the inflated number). This is the only place to catch it.

   Read-only: recomputes with flowCalcItem using the SAME prefilled inputs the reload used (record
   commission/margin, breakdown[0] forex/duties override, current supplier price / cbm). Returns the
   lines whose recomputed VAT-ex unit differs from the stored Final Price. */
function peRepriceGuard(r) {
  r = r || {};
  const inc = (r.items || []).filter(i => i.included);
  let bd = [];
  try { bd = JSON.parse(r.pricedItemsJson || r.legacyItemsJson || '[]') || []; } catch (e) { bd = []; }
  const bd0 = bd[0] || {};
  const bdByLine = {}, bdByNo = {};
  bd.forEach((b, bi) => {
    if (!b) return;
    const line = (b.line != null && b.line !== '') ? String(b.line) : String(bi + 1);
    bdByLine[line] = b;
    const k = String((b.modelNo || b.itemNo) || '');
    if (k && !bdByNo[k]) bdByNo[k] = b;
  });
  const gPrin = (inc.find(i => i.principal) || {}).principal || '';
  const principal = (typeof flowPrincipalByName === 'function') ? flowPrincipalByName(gPrin) : null;
  const dest = (typeof flowDestinationByName === 'function') ? flowDestinationByName(r.destination || '') : null;
  const comm = flowNum(r.commission), marg = flowNum(r.margin);
  // Mirror the reload: forex/duties override ONLY when the saved breakdown carries them, else the
  // principal's own defaults apply (flowCalcItem treats a missing opt as "use the principal").
  const override = {};
  if (bd0.forex != null) override.forex = flowNum(bd0.forex);
  if (bd0.dutiesPct != null) override.dutiesPct = flowNum(bd0.dutiesPct);

  const changed = [];
  inc.forEach((i, idx) => {
    const stored = flowNum(i.finalPrice);
    if (!(stored > 0)) return;                         // nothing recorded to compare against
    const b = bdByLine[String(i.line != null ? i.line : idx + 1)] || bdByNo[String(i.itemNo)] || {};
    const buyPrice = flowNum(i.supplierPrice) ? flowNum(i.supplierPrice) : flowNum(b.buyPrice);
    const cbm = flowNum(i.cbm) ? flowNum(i.cbm) : flowNum(b.cbm);
    const out = flowCalcItem({ buyPrice, discount: flowNum(b.discount), qty: flowNum(i.qty), cbm },
                             principal, dest, comm, marg, override);
    const now = Math.round(out.unitPriceVatEx * 100) / 100;
    if (Math.abs(now - stored) > 0.005) {
      changed.push({ line: i.line, name: i.itemName || i.itemNo || ('line ' + i.line), was: stored, now });
    }
  });
  return changed;
}

/** Render (or clear) the stray-margin warning banner. */
function peRenderRepriceWarn(changed) {
  const el = document.getElementById('peRepriceWarn');
  if (!el) return;
  if (!changed || !changed.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const rows = changed.map(c => {
    const pct = c.was > 0 ? Math.round((c.now - c.was) / c.was * 100) : 0;
    return `<div>Line ${flowEsc(String(c.line))} — ${flowEsc(String(c.name).slice(0, 40))}: ` +
      `<strong>${flowMoney(c.was, 'PHP')}</strong> → <strong>${flowMoney(c.now, 'PHP')}</strong> ` +
      `<span>(${pct >= 0 ? '+' : ''}${pct}%)</span></div>`;
  }).join('');
  el.style.display = '';
  el.innerHTML = `<div style="border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:0.6rem 0.75rem;margin:0.5rem 0;font-size:0.8rem;color:#991b1b;">
    <div style="font-weight:700;margin-bottom:0.35rem;">⚠ This request's saved margin/commission no longer reproduce ${changed.length} of its saved line price${changed.length > 1 ? 's' : ''}</div>
    <div style="margin-bottom:0.35rem;">Re-pricing and saving now will change ${changed.length > 1 ? 'these lines' : 'this line'} to the figures below — different from what was already quoted. Review each line and the margin before saving.</div>
    ${rows}</div>`;
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
  /* A158: the engine divides by (1 − commission − margin − 2% local tax). At 100% that denominator hits
     zero and every price silently came out ₱0; just under it (say 48 + 49) it explodes to ~100× cost.
     Neither was caught anywhere — the HTML max="99" is per-field and unenforced. */
  if (comm + marg + 2 >= 100) {
    flowMsg(msgEl, `Commission ${comm}% + margin ${marg}% + 2% local tax = ${(comm + marg + 2).toFixed(1)}%. ` +
      'At 100% or more the selling price cannot be computed — lower the commission or margin.', false);
    return;
  }
  if (comm + marg + 2 >= 90 &&
      !confirm(`Commission ${comm}% + margin ${marg}% + 2% local tax = ${(comm + marg + 2).toFixed(1)}%.\n\n` +
               'That multiplies the cost by roughly ' + (1 / (1 - (comm + marg + 2) / 100)).toFixed(1) + '×. Continue?')) {
    return;
  }
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
      line: (line != null && line !== '') ? flowNum(line) : '',   // A159: unique per request — two 'N/A' lines no longer overwrite each other
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
    /* A158: lines the user removed from the engine. Deleting a row left the item still flagged Included
       with a Final Price of 0, so it printed on the client's quotation at ₱0.00 — un-include them
       explicitly instead. */
    const kept = {};
    items.forEach(i => { kept[String(i.line)] = 1; });
    const src = (prList || []).find(r => String(r.prNo) === String(prNo));
    const excluded = ((src && src.items) || [])
      .filter(i => i.included && !kept[String(i.line)])
      .map(i => flowNum(i.line));

    const res = await postFlow('setMgmtPricing', {
      prNo, destination: dest, commission: comm, margin: marg,
      items: JSON.stringify(items), pricedItemsJson: JSON.stringify(breakdown),
      excludedLines: JSON.stringify(excluded),
      // A158: re-pricing something already priced/quoted is a deliberate act, and the server refuses it
      // outright when the client already holds an approved or sent quotation for it.
      reprice: !!(src && src.status && src.status !== 'For Mgmt Pricing')
    });
    if (!res.success) throw new Error(res.message);
    flowMsg(msgEl, 'Priced and returned to admin.', true);
    await loadRequests();
    if (usingEngine) { loadFlowPricingHistory(); setTimeout(clearFlowPricing, 900); }
    else { setTimeout(closePr, 800); }
  } catch (e) { flowMsg(msgEl, e.message, false); }
}

/* A201 — management rejects the forwarded sourcing. Clears the sourced prices and returns the request
   to admin for re-sourcing; the request itself is kept. Only enabled for a For-Mgmt-Pricing request. */
async function rejectPricing() {
  if (!pePrNo) { flowMsg('peMsg', 'Load a request to reject first.', false); return; }
  const reason = prompt('Reject this pricing and send it back to admin for re-sourcing?\n\n' +
    'The sourced supplier prices will be CLEARED and admin must re-enter them. The request is kept.\n\n' +
    'Reason (optional):');
  if (reason === null) return;                          // cancelled
  const rb = document.getElementById('peRejectBtn'); if (rb) rb.disabled = true;
  try {
    const res = await postFlow('rejectMgmtPricing', { prNo: pePrNo, reason: reason || '' });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not reject the pricing.');
    flowMsg('peMsg', 'Pricing rejected — sent back to admin for re-sourcing.', true);
    await loadRequests();
    loadFlowPricingHistory();
    setTimeout(clearFlowPricing, 900);
  } catch (e) {
    flowMsg('peMsg', e.message, false);
    if (rb) rb.disabled = false;                        // let them retry
  }
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
    // A179: via flowDate — a raw slice puts a Manila 1st-of-month into the previous month.
    if (month && flowDate(r.date).slice(0, 7) !== month) return false;
    if (cl && !String(r.customer || '').toLowerCase().includes(cl)) return false;
    return true;
  });
  if (!list.length) { el.innerHTML = '<p style="color:var(--text-muted,#64748b);font-size:0.82rem;">No pricing history matches.</p>'; return; }
  const rows = list.map((r, i) => {
    const badge = r.status === 'Migrated' || r.legacyId
      ? '<span class="flow-badge" style="background:rgba(13,148,136,0.14);color:#0f766e;">Migrated</span>'
      : `<span class="flow-badge ${BADGE[r.status] || 'b-pending'}">${flowEsc(prStatusLabel(r.status))}</span>`;
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
  const head = `<div style="font-size:0.72rem;color:var(--text-muted,#64748b);margin:0.4rem 0;">
    Destination: <strong>${flowEsc(r.destination || '—')}</strong> · Commission: <strong>${flowNum(r.commission)}%</strong> · Margin: <strong>${flowNum(r.margin)}%</strong></div>`;
  /* A181: one row per ITEM, each joined to its saved breakdown. This used to render the breakdown
     rows alone, so a request whose breakdown covered fewer lines than it had items showed only those
     lines — PR-202607-210 listed 1 of 5. When nothing was ever priced there is no breakdown to join,
     so the narrow item table below stays as it was rather than showing eight empty cost columns. */
  const rows = flowPricingRows(r);
  if (rows.some(x => x.hasBd)) return head + flowPricingBreakdownTable(rows);
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
  // A175: the Configurator IS the quotations page's create half now — same ?fromPR contract, same
  // createQuotationFromPR save, so the process flow is unchanged.
  window.location.href = 'flow-quotations.html?fromPR=' + encodeURIComponent(no);
}

// ─── PR PDF (identical legacy layout) ────────────
function openPdf(no) {
  const r = curPr(no);
  if (!r) return;
  document.getElementById('pdfPrNo').value = no;
  document.getElementById('pdfModalSub').textContent = `${r.prNo} · ${r.customer} · ${r.items.length} item(s)`;
  const d = flowLoadDefaults('pr');
  // The PR's own stored contact details (captured on the create form) take precedence over the
  // browser-remembered defaults — re-generating reproduces the original document.
  let stored = {};
  try { stored = JSON.parse(r.docJson || '{}') || {}; } catch (e) { stored = {}; }
  const sv = (field, key) => {
    const el = document.getElementById('pdf' + field);
    if (!el) return;
    if (stored[key] !== undefined && stored[key] !== '') el.value = stored[key];
    else if (d[field] !== undefined && d[field] !== '') el.value = d[field];
  };
  document.getElementById('pdfCompanyName').value = stored.companyName || d.CompanyName || r.customer || '';
  sv('CompanyAddress', 'companyAddress'); sv('ContactPerson', 'contactPerson');
  sv('Designation', 'designation'); sv('ContactEmail', 'contactEmail'); sv('ContactPhone', 'contactPhone');
  sv('DateNeeded', 'dateNeeded'); sv('Urgency', 'urgency'); sv('PrNumberClient', 'prNumberClient');
  sv('PreparedByName', 'preparedByName'); sv('PreparedByPosition', 'preparedByPosition');
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
    const { link, saveError, configured } = await generateFlowPdf('/flow/pr-pdf', payload, 'savePRPDF', 'prNo', r.prNo, `Purchase_Request_${r.prNo}.pdf`);
    if (link) flowMsg('pdfModalMsg', 'PDF generated and saved to Drive.', true);
    else if (!configured) flowMsg('pdfModalMsg', 'PDF generated (Drive save skipped — backend not configured).', true);
    else flowMsg('pdfModalMsg', 'PDF generated, but the Drive save failed' + (saveError ? ' (' + saveError + ')' : '') + ' — try Generate again to retry.', false);
    await loadRequests();
    if (link) setTimeout(closePdfModal, 900);
  } catch (e) { flowMsg('pdfModalMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Generate & Save'; }
}

/* ─── A161 · Supplier-quotation price history in the sourcing view ─────────────────────────
   358 supplier quotations are recorded on the legacy Supplier Quotation page, but admin had no
   way to see what a supplier previously charged while sourcing a request — the prices had to be
   looked up on another page, in another tab. This surfaces the matching history inline on each
   item row, plus a searchable browse panel for everything else.
   Read-only, best-effort: the legacy backend occasionally returns a Google error page (A82), so a
   failure degrades to a quiet "unavailable" note and never blocks sourcing.                     */

let sqHistory = null;        // cached for the page lifetime; null = not loaded yet
let sqHistoryErr = '';
let sqLoading = null;        // in-flight promise, so concurrent opens share one fetch

async function sqLoadHistory() {
  if (sqHistory) return sqHistory;
  if (sqLoading) return sqLoading;
  sqLoading = (async () => {
    try {
      if (typeof apiGetSupplierQuotations !== 'function') throw new Error('Supplier quotations unavailable here.');
      const r = await apiGetSupplierQuotations('');
      sqHistory = ((r && (r.data || r.quotations)) || []).filter(Boolean);
      sqHistoryErr = '';
    } catch (e) {
      sqHistory = [];
      sqHistoryErr = e.message || 'Could not load supplier quotations.';
    } finally { sqLoading = null; }
    return sqHistory;
  })();
  return sqLoading;
}

/* Tokenise for matching: lowercase words of 3+ chars, minus boilerplate that appears in nearly
   every description and would otherwise make everything "match" everything. */
const SQ_STOP = new Set(['the','and','for','with','from','pcs','pcs.','set','sets','x','mm','inc','ltd','pte','corp',
                         'inclusive','exclusive','total','lead','time','estimated','working','days','after','payment',
                         'received','test','certificate','included','length','end','and2','php','sgd','usd']);
function sqTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(t => t.length >= 3 && !SQ_STOP.has(t));
}

/* Score a history record against a sourcing line. Item CODE appearing anywhere is the strongest
   signal; otherwise it's shared-token overlap against the supplier's description AND the original
   PR item text (the latter is what usually matches, since it's the same request wording). */
function sqScore(rec, itemNo, itemName) {
  const hay = (String(rec.itemDescription || '') + ' ' + String(rec.prItemDescription || '')).toLowerCase();
  const code = String(itemNo || '').trim().toLowerCase();
  let score = 0;
  if (code && code !== 'n/a' && code.length >= 4 && hay.indexOf(code) !== -1) score += 10;
  const want = sqTokens(itemName);
  if (!want.length) return score;
  const have = new Set(sqTokens(hay));
  const hits = want.filter(t => have.has(t)).length;
  score += hits * 2;
  if (hits / want.length >= 0.6) score += 3;      // most of the item's words are present
  return score;
}

function sqMatches(itemNo, itemName, limit) {
  const list = (sqHistory || []).map(r => ({ r, s: sqScore(r, itemNo, itemName) }))
    .filter(x => x.s >= 4)                          // 2 shared words, or a code hit
    .sort((a, b) => b.s - a.s || String(b.r.date || '').localeCompare(String(a.r.date || '')));
  return (limit ? list.slice(0, limit) : list).map(x => x.r);
}

const sqMoney = (n, c) => (typeof flowMoney === 'function' && c ? flowMoney(n, c) : flowNum(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function sqRowsHtml(recs, line) {
  if (!recs.length) return '<p class="pr-meta" style="margin:0;">No earlier quotation recorded for this item.</p>';
  return `<table class="flow-table" style="min-width:640px;margin:0;"><thead><tr>
      <th>Date</th><th>Supplier</th><th>Item as quoted</th><th class="num">Qty</th>
      <th class="num">Price/Unit</th><th>Cur</th><th>Ref / PR</th><th></th></tr></thead><tbody>
    ${recs.map(r => `<tr>
      <td style="white-space:nowrap;">${flowEsc(flowDate(r.date))}</td>
      <td><b>${flowEsc(r.supplierCompany || '')}</b>${r.contactPerson ? `<br><span class="pr-meta">${flowEsc(r.contactPerson)}</span>` : ''}</td>
      <td style="max-width:280px;font-size:0.8rem;">${flowEsc(String(r.itemDescription || '').slice(0, 160))}</td>
      <td class="num">${flowNum(r.qty)}</td>
      <td class="num"><b>${sqMoney(r.pricePerUnit, r.currency)}</b></td>
      <td>${flowEsc(r.currency || '')}</td>
      <td class="pr-meta">${flowEsc(r.referenceNo || '')}${r.prNumber ? '<br>' + flowEsc(r.prNumber) : ''}</td>
      <td>${line != null ? `<button type="button" class="link-btn" title="Copy this supplier and price into the row"
        onclick="sqUse(${line}, ${JSON.stringify(String(r.supplierCompany || '')).replace(/"/g, '&quot;')}, ${flowNum(r.pricePerUnit)}, ${JSON.stringify(String(r.currency || '')).replace(/"/g, '&quot;')})">use</button>` : ''}</td>
    </tr>`).join('')}</tbody></table>`;
}

/** Copy a past supplier + price (and currency, when it's one we offer) into the sourcing row. */
function sqUse(line, supplier, price, currency) {
  const tr = document.querySelector(`#srcTable tr[data-line="${line}"]`);
  if (!tr) return;
  const sup = tr.querySelector('.s-sup'), pr = tr.querySelector('.s-price'), cur = tr.querySelector('.s-cur');
  if (sup) sup.value = supplier;
  if (pr) pr.value = price;
  if (cur && currency && Array.from(cur.options).some(o => o.value === currency)) cur.value = currency;
  if (typeof flowMsg === 'function') flowMsg('modalMsg', `Copied ${supplier} @ ${sqMoney(price, currency)} into the row — adjust if this quotation is out of date.`, true);
}

function sqToggle(line) {
  const box = document.getElementById('sqHist_' + line);
  if (!box) return;
  box.style.display = box.style.display === 'none' ? '' : 'none';
}

/** Fill in the per-row history after the sourcing table is in the DOM (the fetch is async). */
async function sqDecorateSourcing() {
  const table = document.getElementById('srcTable');
  if (!table) return;
  await sqLoadHistory();
  table.querySelectorAll('tr[data-line]').forEach(tr => {
    const line = tr.getAttribute('data-line');
    const btn = document.getElementById('sqBtn_' + line);
    const box = document.getElementById('sqHist_' + line);
    if (!btn || !box) return;
    if (sqHistoryErr) { btn.textContent = '— history unavailable'; btn.disabled = true; btn.title = sqHistoryErr; return; }
    const itemNo = (tr.querySelector('.s-no') || {}).value || '';
    const itemName = (tr.querySelector('.s-name') || {}).value || '';
    const recs = sqMatches(itemNo, itemName, 8);
    btn.textContent = recs.length ? `⟲ ${recs.length} past price${recs.length === 1 ? '' : 's'}` : '⟲ no history';
    btn.disabled = false;
    box.querySelector('[data-sq-body]').innerHTML = sqRowsHtml(recs, line);
  });
  sqRenderBrowse();
}

/* The browse-everything panel — for when the automatic match misses, or admin just wants to look
   a supplier up. Searches supplier, item text, reference and PR number. */
function sqRenderBrowse() {
  const box = document.getElementById('sqBrowseBody');
  if (!box) return;
  if (sqHistoryErr) { box.innerHTML = `<p class="pr-meta" style="color:#b45309;">${flowEsc(sqHistoryErr)} — the Supplier Quotation page has the full list.</p>`; return; }
  const q = ((document.getElementById('sqSearch') || {}).value || '').trim().toLowerCase();
  let recs = sqHistory || [];
  if (q) {
    recs = recs.filter(r => [r.supplierCompany, r.itemDescription, r.prItemDescription, r.referenceNo, r.prNumber, r.contactPerson]
      .some(v => String(v || '').toLowerCase().indexOf(q) !== -1));
  }
  recs = recs.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const shown = recs.slice(0, 40);
  box.innerHTML = `<p class="pr-meta" style="margin:0 0 0.4rem;">${recs.length} record${recs.length === 1 ? '' : 's'}${
    recs.length > shown.length ? ` · showing the ${shown.length} most recent — narrow the search to see others` : ''}</p>`
    + sqRowsHtml(shown, null);
}

function sqToggleBrowse() {
  const b = document.getElementById('sqBrowse');
  if (!b) return;
  b.style.display = b.style.display === 'none' ? '' : 'none';
  if (b.style.display === '') sqRenderBrowse();
}

/* ─── A161b · Page-level Supplier Quotations summary (admin + oversight) ───────────────────
   The per-item history lives inside the sourcing modal, which means opening a request first.
   This is the standalone summary: the whole saved list, searchable, on the sourcing page. */

function sqToggleSummary() {
  const c = document.getElementById('sqSummaryContent');
  const ic = document.getElementById('sqToggleIcon');
  if (!c) return;
  const open = c.style.display === 'none';
  c.style.display = open ? '' : 'none';
  if (ic) ic.style.transform = open ? 'rotate(180deg)' : '';
  if (open) sqLoadSummary();
}

async function sqLoadSummary() {
  const body = document.getElementById('sqSummaryBody');
  if (!body) return;
  if (!sqHistory) body.innerHTML = '<p class="pr-meta">Loading…</p>';
  await sqLoadHistory();
  // Supplier filter options, most-quoted first (matches how admin actually looks things up).
  const sel = document.getElementById('sqSumSupplier');
  if (sel && sel.options.length <= 1 && (sqHistory || []).length) {
    const counts = {};
    sqHistory.forEach(r => { const k = String(r.supplierCompany || '').trim(); if (k) counts[k] = (counts[k] || 0) + 1; });
    sel.innerHTML = '<option value="">All suppliers</option>' + Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
      .map(k => `<option value="${flowEsc(k)}">${flowEsc(k)} (${counts[k]})</option>`).join('');
  }
  sqRenderSummary();
}

function sqReloadSummary() { sqHistory = null; sqHistoryErr = ''; sqLoadSummary(); }

function sqClearSummary() {
  const a = document.getElementById('sqSumSearch'), b = document.getElementById('sqSumSupplier');
  if (a) a.value = ''; if (b) b.value = '';
  sqRenderSummary();
}

function sqRenderSummary() {
  const body = document.getElementById('sqSummaryBody');
  const kpis = document.getElementById('sqSummaryKpis');
  const cnt = document.getElementById('sqSummaryCount');
  if (!body) return;
  if (sqHistoryErr) {
    body.innerHTML = `<p class="pr-meta" style="color:#b45309;">${flowEsc(sqHistoryErr)} — the Supplier Quotation page has the full list.</p>`;
    if (kpis) kpis.innerHTML = '';
    return;
  }
  const all = sqHistory || [];
  const q = ((document.getElementById('sqSumSearch') || {}).value || '').trim().toLowerCase();
  const sup = ((document.getElementById('sqSumSupplier') || {}).value || '').trim();

  let recs = all;
  if (sup) recs = recs.filter(r => String(r.supplierCompany || '').trim() === sup);
  if (q) recs = recs.filter(r => [r.supplierCompany, r.itemDescription, r.prItemDescription, r.referenceNo, r.prNumber, r.contactPerson]
    .some(v => String(v || '').toLowerCase().indexOf(q) !== -1));
  recs = recs.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  if (cnt) cnt.textContent = all.length ? `· ${all.length} recorded` : '';
  if (kpis) {
    const suppliers = new Set(all.map(r => String(r.supplierCompany || '').trim()).filter(Boolean));
    // A179: flowDate, not a raw slice — a Manila-midnight value truncates to the day before.
    // Still YYYY-MM-DD, so the lexical sort still finds the most recent.
    const latest = all.map(r => flowDate(r.date)).filter(Boolean).sort().pop() || '—';
    const tile = (label, val) => `<div style="flex:1;min-width:130px;padding:0.5rem 0.7rem;border:1px solid var(--border,#e2e8f0);border-radius:8px;">
      <div class="pr-meta" style="margin:0;">${label}</div><div style="font-weight:700;font-size:1.05rem;">${val}</div></div>`;
    kpis.innerHTML = tile('Quotations', all.length) + tile('Suppliers', suppliers.size)
      + tile('Most recent', latest) + tile('Showing', recs.length);
  }

  const shown = recs.slice(0, 60);
  body.innerHTML = (recs.length > shown.length
      ? `<p class="pr-meta" style="margin:0 0 0.4rem;">Showing the ${shown.length} most recent of ${recs.length} — narrow the search to see others.</p>` : '')
    + sqRowsHtml(shown, null);
}
