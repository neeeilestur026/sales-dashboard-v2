/* flow-suppliers.js — supplier master (A145). Bank/payment details prefill the payment request. */
let supData = [];
let supSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  supSession = requireAccountingOrAdmin();
  if (!supSession) return;
  renderNavbar('flow-suppliers');
  renderFlowNav('flow-suppliers.html');
  const s = document.getElementById('sSearch');
  if (s) s.addEventListener('input', render);
  await loadSuppliers();
});

async function loadSuppliers() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const r = await fetchFlow('getSuppliers');
    supData = ((r && r.data) || []).slice().sort((a, b) => String(a.supplier).localeCompare(String(b.supplier)));
    render();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function render() {
  const c = document.getElementById('container');
  const q = (document.getElementById('sSearch').value || '').toLowerCase();
  const rows = supData.filter(s => !q || String(s.supplier).toLowerCase().includes(q) || String(s.bankName).toLowerCase().includes(q));
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No suppliers yet. Add one above (or it fills in when you save a payment request).</p>'; return; }
  c.innerHTML = `<table class="flow-table" style="min-width:820px;"><thead><tr>
    <th>Supplier</th><th>Bank</th><th>Account Name</th><th>Account No</th><th>Method</th><th>Cur</th><th></th></tr></thead><tbody>${rows.map(s => `
    <tr>
      <td>${flowEsc(s.supplier)}</td><td>${flowEsc(s.bankName)}</td><td>${flowEsc(s.accountName)}</td>
      <td>${flowEsc(s.accountNumber)}</td><td>${flowEsc(s.paymentMethod)}</td><td>${flowEsc(s.currency)}</td>
      <td style="white-space:nowrap;">
        <button class="link-btn" onclick='editSupplier(${JSON.stringify(s.supplier)})'>Edit</button>
        <button class="link-btn del-btn" onclick='deleteSupplierRec(${JSON.stringify(s.supplier)})' style="margin-left:0.4rem;">Delete</button>
      </td></tr>`).join('')}</tbody></table>`;
}

function editSupplier(name) {
  const s = supData.find(x => String(x.supplier) === String(name));
  if (!s) return;
  document.getElementById('sName').value = s.supplier || '';
  document.getElementById('sBank').value = s.bankName || '';
  document.getElementById('sAcctName').value = s.accountName || '';
  document.getElementById('sAcctNo').value = s.accountNumber || '';
  document.getElementById('sMethod').value = s.paymentMethod || '';
  document.getElementById('sCurrency').value = s.currency || '';
  document.getElementById('sTin').value = s.tin || '';
  document.getElementById('sAddress').value = s.address || '';
  document.getElementById('sNotes').value = s.notes || '';
  document.getElementById('formTitle').textContent = 'Edit ' + s.supplier;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  ['sName','sBank','sAcctName','sAcctNo','sMethod','sCurrency','sTin','sAddress','sNotes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('formTitle').textContent = 'New Supplier';
  document.getElementById('formMsg').style.display = 'none';
}

async function saveSupplierRec() {
  const supplier = document.getElementById('sName').value.trim();
  if (!supplier) { flowMsg('formMsg', 'Supplier name is required.', false); document.getElementById('sName').focus(); return; }
  const btn = document.getElementById('saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow('saveSupplier', {
      supplier, bankName: document.getElementById('sBank').value.trim(),
      accountName: document.getElementById('sAcctName').value.trim(),
      accountNumber: document.getElementById('sAcctNo').value.trim(),
      paymentMethod: document.getElementById('sMethod').value.trim(),
      currency: document.getElementById('sCurrency').value.trim(),
      tin: document.getElementById('sTin').value.trim(),
      address: document.getElementById('sAddress').value.trim(),
      notes: document.getElementById('sNotes').value.trim()
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', 'Supplier saved.', true);
    resetForm();
    await loadSuppliers();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Save Supplier'; }
}

async function deleteSupplierRec(name) {
  if (!confirm('Delete supplier ' + name + '?')) return;
  try {
    const res = await postFlow('deleteSupplier', { supplier: name });
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', 'Supplier removed.', true);
    await loadSuppliers();
  } catch (e) { flowMsg('msg', e.message, false); }
}
