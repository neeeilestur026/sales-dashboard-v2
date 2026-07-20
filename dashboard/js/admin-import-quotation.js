/* admin-import-quotation.js — admin-only Import Quotation (PDF) → editable Draft flow quotation.
   Imports an existing quotation PDF (exact via embedded /QuoData, else pdfplumber parse),
   lets the admin edit everything, saves via createQuotation (status Draft, bypassing the PR
   process), and auto-adds each item to Inventory at balance 0. */

let aiqSession = null;

document.addEventListener('DOMContentLoaded', () => {
  aiqSession = requireAdmin();
  if (!aiqSession) return;
  renderNavbar('admin-import-quotation');
  document.getElementById('date').value = (typeof flowToday === 'function') ? flowToday() : new Date().toISOString().slice(0, 10);
});

function _esc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _num(v) { return (typeof flowNum === 'function') ? flowNum(v) : (parseFloat(v) || 0); }
function _money(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + _num(v).toFixed(2); }
function _msg(id, text, ok) {
  const el = document.getElementById(id);
  el.style.display = 'block';
  el.textContent = text;
  el.style.background = ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
  el.style.color = ok ? '#047857' : '#b91c1c';
}

async function doImport() {
  const f = document.getElementById('pdfFile').files[0];
  if (!f) { _msg('importMsg', 'Choose a PDF file first.', false); return; }
  const btn = document.getElementById('importBtn');
  btn.disabled = true; btn.textContent = 'Importing...';
  document.getElementById('importMsg').style.display = 'none';
  try {
    const fd = new FormData();
    fd.append('pdf', f);
    const res = await fetch('/flow/import-quotation-pdf', { method: 'POST', body: fd });
    const d = await res.json();
    if (!d.success) throw new Error(d.message || 'Import failed.');
    fillForm(d);
    const badge = document.getElementById('importSource');
    badge.style.display = 'inline-block';
    if (d.source === 'exact') { badge.textContent = 'Exact import'; badge.className = 'flow-badge b-approved'; }
    else { badge.textContent = 'Parsed — please review'; badge.className = 'flow-badge b-pending'; }
    const warn = document.getElementById('importWarnings');
    if (d.warnings && d.warnings.length) {
      warn.style.display = 'block';
      warn.innerHTML = '⚠ ' + d.warnings.map(_esc).join('<br>⚠ ');
    } else { warn.style.display = 'none'; }
    document.getElementById('editCard').style.display = 'block';
    _msg('importMsg', 'Imported. Review and edit below, then save.', true);
    document.getElementById('editCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    _msg('importMsg', e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Import & Edit';
  }
}

function fillForm(d) {
  document.getElementById('customer').value = d.customer || '';
  document.getElementById('quotationNo').value = d.quotationNo || '';
  document.getElementById('date').value = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date
    : (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10));
  document.getElementById('vatOption').value = d.vatOption || 'inclusive';
  const doc = d.doc || {};
  document.getElementById('docSubject').value = doc.subject || '';
  document.getElementById('docAddress').value = doc.address || '';
  document.getElementById('docAttention').value = doc.attention || '';
  document.getElementById('docDesignation').value = doc.designation || '';
  document.getElementById('docEmail').value = doc.email || '';
  document.getElementById('docRfqNo').value = doc.rfqNo || '';
  document.getElementById('docValidity').value = doc.validity || '';
  document.getElementById('docDelivery').value = doc.delivery || '';
  document.getElementById('docPayment').value = doc.payment || '';
  document.getElementById('docWarranty').value = doc.warranty || '1 year warranty against factory defect';
  const tb = document.getElementById('itemRows');
  tb.innerHTML = '';
  (d.items || []).forEach(it => addRow(it));
  if (!(d.items || []).length) addRow();
}

function addRow(it) {
  it = it || {};
  const tr = document.createElement('tr');
  tr.innerHTML =
    `<td><input type="text" class="i-no" value="${_esc(it.itemNo)}"></td>
     <td><input type="text" class="i-desc" value="${_esc(it.itemName || it.description)}"></td>
     <td class="num"><input type="number" step="any" class="i-qty" value="${it.qty != null ? it.qty : ''}" oninput="recalc()"></td>
     <td class="num"><input type="number" step="any" class="i-price" value="${it.price != null ? it.price : ''}" oninput="recalc()"></td>
     <td class="num i-total">${_money(_num(it.qty) * _num(it.price))}</td>
     <td><button type="button" class="btn btn-sm btn-secondary" onclick="this.closest('tr').remove();recalc()">✕</button></td>`;
  document.getElementById('itemRows').appendChild(tr);
}

function recalc() {
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const q = _num(tr.querySelector('.i-qty').value);
    const p = _num(tr.querySelector('.i-price').value);
    tr.querySelector('.i-total').textContent = _money(q * p);
  });
}

function collectRows() {
  const rows = [];
  document.querySelectorAll('#itemRows tr').forEach(tr => {
    const itemNo = tr.querySelector('.i-no').value.trim();
    const desc = tr.querySelector('.i-desc').value.trim();
    const qty = _num(tr.querySelector('.i-qty').value);
    const price = _num(tr.querySelector('.i-price').value);
    if (!itemNo && !desc) return;
    rows.push({ itemNo: itemNo || 'N/A', description: desc, qty, price });
  });
  return rows;
}

async function saveImported() {
  const customer = document.getElementById('customer').value.trim();
  const rows = collectRows();
  if (!customer) { _msg('saveMsg', 'Customer is required.', false); return; }
  if (!rows.length) { _msg('saveMsg', 'Add at least one item.', false); return; }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  document.getElementById('saveMsg').style.display = 'none';
  try {
    const items = rows.map(r => ({ itemNo: r.itemNo, itemName: r.description || r.itemNo, qty: r.qty, price: r.price }));
    const res = await postFlow('createQuotation', {
      customer,
      date: document.getElementById('date').value,
      status: 'Draft',
      quotationNo: document.getElementById('quotationNo').value.trim(),
      createdBy: aiqSession.name,
      actorRole: 'admin',
      items: JSON.stringify(items)
    });
    if (!res.success) throw new Error(res.message || 'Save failed.');
    const qno = res.quotationNo || document.getElementById('quotationNo').value.trim();

    // Auto-add each imported item to Inventory (balance 0). Ignore "already exists".
    let added = 0, existed = 0, failed = 0;
    for (const r of rows) {
      try {
        const inv = await postFlow('addInventoryItem', {
          itemNo: r.itemNo, description: r.description || r.itemNo,
          balance: 0, currency: 'PHP',
          type: 'Catalog'   // imported quotation item — not yet purchased
        });
        if (inv.success) added++;
        else if (/already exists/i.test(inv.message || '')) existed++;
        else failed++;
      } catch (e) { failed++; }
    }

    _msg('saveMsg', `Quotation ${qno} created (Draft).`, true);
    const rz = document.getElementById('saveResult');
    rz.style.display = 'block';
    rz.innerHTML =
      `<b>Quotation ${_esc(qno)}</b> created as <b>Draft</b> · ${added} item(s) added to inventory` +
      (existed ? `, ${existed} already existed` : '') + (failed ? `, ${failed} failed` : '') + '.'
      + `<div style="margin-top:0.5rem;">`
      + `<a class="btn btn-sm btn-secondary" href="flow-quotations.html?review=${encodeURIComponent(qno)}">Open in Quotations</a> `
      + `</div>`;
  } catch (e) {
    _msg('saveMsg', e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Save as Draft Quotation';
  }
}
