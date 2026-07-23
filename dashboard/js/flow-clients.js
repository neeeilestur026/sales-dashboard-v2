/* flow-clients.js — client master (A145). Contact/address details prefill the purchase request. */
let cliData = [];
let cliSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  cliSession = requireAccountingOrAdmin();
  if (!cliSession) return;
  renderNavbar('flow-clients');
  renderFlowNav('flow-clients.html');
  const s = document.getElementById('cSearch');
  if (s) s.addEventListener('input', render);
  await loadClients();
});

async function loadClients() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const r = await fetchFlow('getClients');
    cliData = ((r && r.data) || []).slice().sort((a, b) => String(a.customer).localeCompare(String(b.customer)));
    render();
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

function render() {
  const c = document.getElementById('container');
  const q = (document.getElementById('cSearch').value || '').toLowerCase();
  const rows = cliData.filter(x => !q || String(x.customer).toLowerCase().includes(q) || String(x.contactPerson).toLowerCase().includes(q));
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No clients yet. Add one above (or it fills in when you save a purchase request).</p>'; return; }
  c.innerHTML = `<table class="flow-table" style="min-width:820px;"><thead><tr>
    <th>Customer</th><th>Contact</th><th>Email</th><th>Phone</th><th>Terms</th><th></th></tr></thead><tbody>${rows.map(x => `
    <tr>
      <td>${flowEsc(x.customer)}</td><td>${flowEsc(x.contactPerson)}${x.designation ? ' · ' + flowEsc(x.designation) : ''}</td>
      <td>${flowEsc(x.email)}</td><td>${flowEsc(x.phone)}</td><td>${flowEsc(x.paymentTerms)}</td>
      <td style="white-space:nowrap;">
        <button class="link-btn" onclick='editClient(${JSON.stringify(x.customer)})'>Edit</button>
        <button class="link-btn del-btn" onclick='deleteClientRec(${JSON.stringify(x.customer)})' style="margin-left:0.4rem;">Delete</button>
      </td></tr>`).join('')}</tbody></table>`;
}

function editClient(name) {
  const x = cliData.find(c => String(c.customer) === String(name));
  if (!x) return;
  document.getElementById('cName').value = x.customer || '';
  document.getElementById('cContact').value = x.contactPerson || '';
  document.getElementById('cDesignation').value = x.designation || '';
  document.getElementById('cEmail').value = x.email || '';
  document.getElementById('cPhone').value = x.phone || '';
  document.getElementById('cRfq').value = x.rfqRef || '';
  document.getElementById('cTerms').value = x.paymentTerms || '';
  document.getElementById('cAddress').value = x.address || '';
  document.getElementById('cNotes').value = x.notes || '';
  document.getElementById('formTitle').textContent = 'Edit ' + x.customer;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  ['cName','cContact','cDesignation','cEmail','cPhone','cRfq','cTerms','cAddress','cNotes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('formTitle').textContent = 'New Client';
  document.getElementById('formMsg').style.display = 'none';
}

async function saveClientRec() {
  const customer = document.getElementById('cName').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer name is required.', false); document.getElementById('cName').focus(); return; }
  const btn = document.getElementById('saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow('saveClient', {
      customer, contactPerson: document.getElementById('cContact').value.trim(),
      designation: document.getElementById('cDesignation').value.trim(),
      email: document.getElementById('cEmail').value.trim(),
      phone: document.getElementById('cPhone').value.trim(),
      rfqRef: document.getElementById('cRfq').value.trim(),
      paymentTerms: document.getElementById('cTerms').value.trim(),
      address: document.getElementById('cAddress').value.trim(),
      notes: document.getElementById('cNotes').value.trim()
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('formMsg', 'Client saved.', true);
    resetForm();
    await loadClients();
  } catch (e) { flowMsg('formMsg', e.message, false); }
  finally { btn.disabled = false; btn.textContent = 'Save Client'; }
}

async function deleteClientRec(name) {
  if (!confirm('Delete client ' + name + '?')) return;
  try {
    const res = await postFlow('deleteClient', { customer: name });
    if (!res.success) throw new Error(res.message);
    flowMsg('msg', 'Client removed.', true);
    await loadClients();
  } catch (e) { flowMsg('msg', e.message, false); }
}
