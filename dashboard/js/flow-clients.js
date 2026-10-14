/* flow-clients.js — client master (A145). Contact/address details prefill the purchase request. */
let cliData = [];
let cliSession = null;
let cliViewer = false;    // A231: management looks, does not touch
/* A331 — FlowAPI 168: the client's tax defaults. Shown to everyone once live; editable only by the
   roles the server lets change them (saveClient refuses anyone else). */
let cliSg = false;
const cliMayTax = () => cliSg && ['accounting', 'admin', 'director'].includes(String((cliSession && cliSession.role) || '').toLowerCase());
const CLI_EWT_LABEL = { '': '—', auto: '1% goods / 2% services', '1': '1%', '2': '2%', none: 'none' };
const CLI_VAT_LABEL = { 'VAT-12': '12%', 'VAT-0': 'zero-rated', 'VAT-EX': 'exempt' };

document.addEventListener('DOMContentLoaded', async () => {
  cliSession = requireFlowOperations();                 // A231 — management admitted as a viewer
  if (!cliSession) return;
  cliViewer = isFlowViewerRole(cliSession);
  flowSetViewerOnly(cliViewer);
  /* Hide the whole add/edit card — see flow-suppliers.js for why the Save button alone is not enough. */
  if (cliViewer) { const fc = document.getElementById('formCard'); if (fc) fc.style.display = 'none'; }
  renderNavbar('flow-clients');
  renderFlowNav('flow-clients.html');
  const s = document.getElementById('cSearch');
  if (s) s.addEventListener('input', render);
  try { cliSg = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(168) : false; }
  catch (e) { cliSg = false; }
  if (cliSg) {
    document.getElementById('cTaxBlock').hidden = false;
    if (!cliMayTax()) {
      ['cVatType', 'cZeroRef', 'cEwtRate', 'cTin'].forEach(id => { document.getElementById(id).disabled = true; });
      document.getElementById('cTaxNote').textContent = 'Set by accounting, admin or the director. New sales orders take this VAT type, and payments are checked against this EWT rate.';
    }
  }
  await loadClients();
});

async function loadClients() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const r = await fetchFlow('getClients');
    cliData = ((r && r.data) || []).slice().sort((a, b) => String(a.customer).localeCompare(String(b.customer)));
    render();
  } catch (e) { c.innerHTML = `<p style="color:var(--hx-red);">${flowEsc(e.message)}</p>`; }
}

function render() {
  const c = document.getElementById('container');
  const q = (document.getElementById('cSearch').value || '').toLowerCase();
  const rows = cliData.filter(x => !q || String(x.customer).toLowerCase().includes(q) || String(x.contactPerson).toLowerCase().includes(q));
  if (!rows.length) { c.innerHTML = `<p style="color:var(--hx-ink-3);">No clients yet.${cliViewer ? '' : ' Add one above (or it fills in when you save a purchase request).'}</p>`; return; }
  c.innerHTML = `<table class="flow-table" style="min-width:820px;"><thead><tr>
    <th>Customer</th><th>Contact</th><th>Email</th><th>Phone</th><th>Terms</th>${cliSg ? '<th>VAT</th><th>EWT</th>' : ''}<th></th></tr></thead><tbody>${rows.map(x => `
    <tr>
      <td>${flowEsc(x.customer)}</td><td>${flowEsc(x.contactPerson)}${x.designation ? ' · ' + flowEsc(x.designation) : ''}</td>
      <td>${flowEsc(x.email)}</td><td>${flowEsc(x.phone)}</td><td>${flowEsc(x.paymentTerms)}</td>
      ${cliSg ? `<td>${flowEsc(CLI_VAT_LABEL[x.vatType] || '—')}</td><td>${flowEsc(CLI_EWT_LABEL[x.ewtRate || ''] || x.ewtRate)}</td>` : ''}
      <td style="white-space:nowrap;">${cliViewer ? '' : `
        <button class="link-btn" onclick='editClient(${JSON.stringify(x.customer)})'>Edit</button>
        <button class="link-btn del-btn" onclick='deleteClientRec(${JSON.stringify(x.customer)})' style="margin-left:0.4rem;">Delete</button>`}
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
  if (cliSg) {                                             // A331
    document.getElementById('cVatType').value = x.vatType || '';
    document.getElementById('cZeroRef').value = x.zeroRatingRef || '';
    document.getElementById('cEwtRate').value = x.ewtRate || '';
    document.getElementById('cTin').value = x.tin || '';
    cliTaxChanged();
  }
  document.getElementById('formTitle').textContent = 'Edit ' + x.customer;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  ['cName','cContact','cDesignation','cEmail','cPhone','cRfq','cTerms','cAddress','cNotes','cVatType','cZeroRef','cEwtRate','cTin'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const zb = document.getElementById('cZeroBlock'); if (zb) zb.hidden = true;
  document.getElementById('formTitle').textContent = 'New Client';
  document.getElementById('formMsg').style.display = 'none';
}

function cliTaxChanged() {
  document.getElementById('cZeroBlock').hidden = document.getElementById('cVatType').value !== 'VAT-0';
}

async function saveClientRec() {
  const customer = document.getElementById('cName').value.trim();
  if (!customer) { flowMsg('formMsg', 'Customer name is required.', false); document.getElementById('cName').focus(); return; }
  const tax = {};
  if (cliMayTax()) {                                       // A331 — only sent by the roles that may set them
    tax.vatType = document.getElementById('cVatType').value;
    tax.zeroRatingRef = tax.vatType === 'VAT-0' ? document.getElementById('cZeroRef').value.trim() : '';
    tax.ewtRate = document.getElementById('cEwtRate').value;
    tax.tin = document.getElementById('cTin').value.trim();
    if (tax.vatType === 'VAT-0' && !tax.zeroRatingRef) {
      flowMsg('formMsg', 'A zero-rated client needs its zero-rating reference.', false); document.getElementById('cZeroRef').focus(); return;
    }
  }
  const btn = document.getElementById('saveBtn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await postFlow('saveClient', Object.assign(tax, {
      customer, contactPerson: document.getElementById('cContact').value.trim(),
      designation: document.getElementById('cDesignation').value.trim(),
      email: document.getElementById('cEmail').value.trim(),
      phone: document.getElementById('cPhone').value.trim(),
      rfqRef: document.getElementById('cRfq').value.trim(),
      paymentTerms: document.getElementById('cTerms').value.trim(),
      address: document.getElementById('cAddress').value.trim(),
      notes: document.getElementById('cNotes').value.trim()
    }));
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
