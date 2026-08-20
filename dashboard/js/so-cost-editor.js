/* ═══════════════════════════════════════════════
   so-cost-editor.js — reusable per-Sales-Order cost editor.
   openSoCostEditor(prefill, onSaved) opens a modal to edit a SO's full cost
   breakdown (Sales + COGS components), saving via FlowAPI saveSOCostDetails
   (Source='Manual (edited)'). Works for migrated SOs, new-flow SOs (prefilled
   from the Receiving chain), and SOs with no cost yet. Gated by the caller to
   accounting + admin. Depends on flow-api.js (postFlow/flowEsc/flowNum/flowMoney).
   ═══════════════════════════════════════════════ */

let _scePrefill = null;
let _sceOnSaved = null;
let _sceBank = null;      // A224: getSOBankCharges for the order currently open, or null
let _sceReadOnly = false; // A244: opened to READ the breakdown, not to change it

const _SCE_FIELDS = [
  ['purchaseOfGoods', 'Purchase of Goods', 'both'],
  ['bankChargeCOGS', 'Bank Charge (COGS)', 'intl'],
  ['dutiesAndTaxes', 'Duties &amp; Taxes', 'intl'],
  ['bankChargeShipping', 'Bank Charge (Shipping)', 'intl'],
  ['shippingCost', 'Shipping Cost', 'intl'],
  ['localCharges', 'Local Charges', 'intl'],
  ['deliveryToOffice', 'Delivery to Office', 'both'],
  ['deliveryToClient', 'Delivery to Client', 'both'],
];

function _sceEl() {
  let el = document.getElementById('soCostEditorModal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'soCostEditorModal';
  /* flow.css:49-50 makes .flow-modal-overlay display:none and only .open reveals it, so the
     class alone builds an invisible modal. */
  el.className = 'flow-modal-overlay open';
  el.innerHTML = `
    <div class="flow-modal" style="max-width:640px;">
      <h3 id="sceTitle">Edit SO Costs</h3>
      <div class="sub" id="sceSub">—</div>
      <div class="flow-form" style="margin-top:0.5rem;">
        <div><label>Sales (revenue)</label><input type="number" step="any" id="sceSales" oninput="_sceRecalc()"></div>
        <div><label>COGS Type</label><select id="sceCogsType" onchange="_sceRecalc()">
          <option value="local">Local</option><option value="international">International</option></select></div>
        <div><label>Shipping Company</label><input type="text" id="sceShippingCompany"></div>
      </div>
      <div class="group-title">Cost components (PHP)</div>
      <div class="flow-form" id="sceComps"></div>
      <!-- A224: what the bank actually charged on this order's payments. It REPORTS; the buckets
           above stay hand-entered. See getSOBankCharges for why nothing here writes. -->
      <div id="sceBank" style="display:none;font-size:0.76rem;line-height:1.55;margin-top:0.6rem;
           border:1px solid var(--border);border-radius:7px;padding:0.5rem 0.7rem;
           background:var(--bg-subtle,#f8fafc);"></div>
      <div style="display:flex;justify-content:space-between;gap:1rem;margin-top:0.75rem;font-weight:700;">
        <span>Total COGS: <span id="sceTotalCogs" style="color:#ef4444;">0.00</span></span>
        <span>Gross Profit: <span id="sceGross" style="color:#16a34a;">0.00</span></span>
      </div>
      <div id="sceMsg" class="flow-msg" style="display:none;"></div>
      <div class="flow-modal-foot">
        <button type="button" class="btn btn-secondary" onclick="closeSoCostEditor()">Cancel</button>
        <button type="button" class="btn btn-primary" id="sceSaveBtn" onclick="_sceSave()">Save costs</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

/**
 * prefill: { soNo, customer, date, sales, cogsType, purchaseOfGoods, bankChargeCOGS,
 *   dutiesAndTaxes, bankChargeShipping, shippingCompany, shippingCost, localCharges,
 *   deliveryToOffice, deliveryToClient }
 * onSaved: callback(result) after a successful save.
 * opts:    { readOnly: true } opens the same breakdown to READ.
 *
 * A244 — WHY A READ-ONLY MODE EXISTS. flow-sales-orders.js rendered the Costs button only when the
 * viewer flag was false, so management — who are viewer-only on every flow page by A231 — had no way
 * to see a cost breakdown at all. But A231's rule is "management looks, does not touch"; it was never
 * "management cannot look". Removing the button denied the looking as well as the touching.
 *
 * Hiding the button is not what enforces the rule and never was: postFlow refuses any non-get action
 * while viewer-only (flow-api.js), so the save is already blocked at the door whatever the markup
 * says. This mode simply stops offering an edit that would be refused, while letting the numbers be
 * read — which is what somebody reviewing gross profit actually needs.
 */
function openSoCostEditor(prefill, onSaved, opts) {
  _scePrefill = prefill || {};
  _sceOnSaved = onSaved || null;
  _sceReadOnly = !!(opts && opts.readOnly);
  const el = _sceEl();
  document.getElementById('sceSub').textContent =
    `${flowEsc(_scePrefill.soNo || '')}${_scePrefill.customer ? ' · ' + flowEsc(_scePrefill.customer) : ''}`;
  document.getElementById('sceMsg').style.display = 'none';
  document.getElementById('sceSales').value = flowNum(_scePrefill.sales) || '';
  document.getElementById('sceCogsType').value = String(_scePrefill.cogsType || 'local') === 'international' ? 'international' : 'local';
  document.getElementById('sceShippingCompany').value = _scePrefill.shippingCompany || '';
  // Build the component inputs.
  document.getElementById('sceComps').innerHTML = _SCE_FIELDS.map(f =>
    `<div data-scope="${f[2]}"><label>${f[1]}</label><input type="number" step="any" id="sce_${f[0]}" value="${flowNum(_scePrefill[f[0]]) || ''}" oninput="_sceRecalc()"></div>`
  ).join('');
  el.classList.add('open');
  /* Applied on EVERY open, not at build time: _sceEl() constructs the modal once and caches it, so a
     read-only open followed by an editable one would otherwise leave the inputs disabled. */
  _sceApplyMode();
  _sceRecalc();
  _sceLoadBankCharges(_scePrefill.soNo);
}

/** Put the modal into read or edit mode. Everything here is presentation — the write itself is
 *  refused by postFlow when viewer-only, and by _sceSave's own guard below. */
function _sceApplyMode() {
  const ro = _sceReadOnly;
  const el = document.getElementById('soCostEditorModal');
  if (!el) return;
  const t = document.getElementById('sceTitle');
  if (t) t.textContent = ro ? 'SO Costs' : 'Edit SO Costs';
  el.querySelectorAll('.flow-form input, .flow-form select').forEach(i => {
    i.disabled = ro;
    // A disabled field still has to be legible — this is the whole point of the mode.
    i.style.opacity = ro ? '1' : '';
    i.style.background = ro ? 'var(--bg-inset, #f8fafc)' : '';
    i.style.cursor = ro ? 'default' : '';
  });
  const save = document.getElementById('sceSaveBtn');
  if (save) save.style.display = ro ? 'none' : '';
  const cancel = el.querySelector('.flow-modal-foot .btn-secondary');
  if (cancel) cancel.textContent = ro ? 'Close' : 'Cancel';
}

/* ── A224 — the bank charges this order's payments actually recorded ───────────────────────────────
 *
 * A222 captures what the bank did at the moment it is known — actual debited, bank charge, value date
 * — on the payment request. The charge is deliberately kept out of the payable (it is our cost, not
 * the supplier's) and out of landed cost. So it is a real, known cost of this order that the COGS
 * record has never been told about, and until now the only way to find it was to open each payment
 * request and read it off.
 *
 * IT IS SHOWN, NOT WRITTEN, and that is a decision rather than an omission — there are TWO buckets
 * for the same fee and nothing in the data says which one a supplier wire belongs in, a local order
 * excludes both from Total COGS entirely, saveSOCostDetails overwrites the whole row, and several
 * payments on one order would each have to accumulate. Any one of those would move gross profit
 * silently. So: the system reports the figure and the person who knows which bucket puts it there.
 *
 * Best-effort throughout. This is a convenience beside the form, and it must never be able to stop
 * somebody editing costs — an older backend simply has no such handler. */
async function _sceLoadBankCharges(soNo) {
  _sceBank = null;
  const box = document.getElementById('sceBank');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  if (!soNo || typeof fetchFlow !== 'function') return;
  let r = null;
  try { r = await fetchFlow('getSOBankCharges', { soNo: String(soNo) }, { fresh: true }); }
  catch (e) { return; }
  if (!r || !r.success || !r.count) return;
  // The dialog may have been closed, or reopened on a different order, while that was in flight.
  if (String((_scePrefill || {}).soNo || '') !== String(soNo)) return;
  _sceBank = r;
  _sceRenderBank();
}

/** Re-rendered on every recalc, because flipping COGS Type changes what the advice HAS to say. */
function _sceRenderBank() {
  const box = document.getElementById('sceBank');
  const r = _sceBank;
  if (!box) return;
  if (!r || !r.count) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const intl = document.getElementById('sceCogsType').value === 'international';
  box.innerHTML =
    `<b>₱${flowNum(r.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</b> of bank charges `
    + `was recorded on this order's payments:`
    + '<ul style="margin:0.35rem 0 0.4rem 1.1rem;padding:0;">'
    + r.rows.map(x => `<li>${flowEsc(x.prNo)}${x.valueDate ? ' · ' + flowEsc(x.valueDate) : ''} — `
        + `${flowMoney(x.charge, 'PHP')}${x.currency && x.currency !== 'PHP' ? ' on a ' + flowEsc(x.currency) + ' wire' : ''}</li>`).join('')
    + '</ul>'
    + (intl
        ? 'It is <b>not</b> entered for you: it belongs either in Bank Charge (COGS) or in Bank Charge '
          + '(Shipping), and only you know which — writing to the wrong one would double-count against '
          + 'whichever you have been using.'
        : '<span style="color:#b45309;">This order is <b>Local</b>, and both bank-charge buckets are '
          + 'excluded from Total COGS on a local order — so entering it above would store it without '
          + 'counting it. Reclassify the order first if this charge belongs in its cost.</span>');
  box.style.display = '';
}

function closeSoCostEditor() {
  const el = document.getElementById('soCostEditorModal');
  if (el) el.classList.remove('open');
}

function _sceVal(id) { const e = document.getElementById(id); return e ? flowNum(e.value) : 0; }

function _sceRecalc() {
  const intl = document.getElementById('sceCogsType').value === 'international';
  // Show/hide international-only rows.
  document.querySelectorAll('#sceComps [data-scope="intl"]').forEach(d => { d.style.display = intl ? '' : 'none'; });
  let total = _sceVal('sce_purchaseOfGoods') + _sceVal('sce_deliveryToOffice') + _sceVal('sce_deliveryToClient');
  if (intl) {
    total += _sceVal('sce_bankChargeCOGS') + _sceVal('sce_dutiesAndTaxes') + _sceVal('sce_bankChargeShipping')
      + _sceVal('sce_shippingCost') + _sceVal('sce_localCharges');
  }
  const sales = _sceVal('sceSales');
  document.getElementById('sceTotalCogs').textContent = flowMoney(total, 'PHP');
  const gp = sales - total;
  const g = document.getElementById('sceGross');
  g.textContent = flowMoney(gp, 'PHP');
  g.style.color = gp < 0 ? '#ef4444' : '#16a34a';
  _sceRenderBank();     // A224: the advice differs for a local order, so it follows the COGS Type
}

async function _sceSave() {
  // A244 — the button is hidden in read-only mode, so reaching here means the DOM was tampered with
  // or a stale handler fired. postFlow would refuse it anyway; refusing here too keeps the reason
  // legible instead of surfacing as a generic viewer-only error.
  if (_sceReadOnly) return;
  const btn = document.getElementById('sceSaveBtn');
  const msg = document.getElementById('sceMsg');
  const rec = {
    soNo: _scePrefill.soNo, customer: _scePrefill.customer || '', date: _scePrefill.date || '',
    sales: _sceVal('sceSales'), cogsType: document.getElementById('sceCogsType').value,
    shippingCompany: document.getElementById('sceShippingCompany').value,
  };
  _SCE_FIELDS.forEach(f => { rec[f[0]] = _sceVal('sce_' + f[0]); });
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow('saveSOCostDetails', { record: JSON.stringify(rec) });
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed');
    closeSoCostEditor();
    if (_sceOnSaved) _sceOnSaved(res);
  } catch (e) {
    msg.style.display = 'block'; msg.style.color = '#ef4444'; msg.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Save costs';
  }
}
