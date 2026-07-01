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
  el.className = 'flow-modal-overlay';
  el.innerHTML = `
    <div class="flow-modal" style="max-width:640px;">
      <h3>Edit SO Costs</h3>
      <div class="sub" id="sceSub">—</div>
      <div class="flow-form" style="margin-top:0.5rem;">
        <div><label>Sales (revenue)</label><input type="number" step="any" id="sceSales" oninput="_sceRecalc()"></div>
        <div><label>COGS Type</label><select id="sceCogsType" onchange="_sceRecalc()">
          <option value="local">Local</option><option value="international">International</option></select></div>
        <div><label>Shipping Company</label><input type="text" id="sceShippingCompany"></div>
      </div>
      <div class="group-title">Cost components (PHP)</div>
      <div class="flow-form" id="sceComps"></div>
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
 */
function openSoCostEditor(prefill, onSaved) {
  _scePrefill = prefill || {};
  _sceOnSaved = onSaved || null;
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
  _sceRecalc();
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
}

async function _sceSave() {
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
