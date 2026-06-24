/* migrate-collections.js — bulk-migrate the legacy Collections (invoice-level receivables) ledger
   (production api.js) into the new flow ARAging + Collections (FlowAPI). Reads OLD via
   apiGetCollections(), writes NEW via postFlow('importCollections'). Original invoice numbers
   preserved; already-migrated invoices skipped; no GL journals posted. */

let migSession = null;
let legacyCols = [];          // normalized legacy collection records
let migratedSet = new Set();  // invoice numbers already present in the flow ARAging
let selected = new Set();     // invoiceNos checked for migration
const CHUNK = 25;

document.addEventListener('DOMContentLoaded', async () => {
  migSession = requireAccountingOrAdmin();
  if (!migSession) return;
  renderNavbar('migrate-collections');
  document.getElementById('reloadBtn').addEventListener('click', loadAll);
  document.getElementById('search').addEventListener('input', render);
  document.getElementById('statusFilter').addEventListener('change', render);
  document.getElementById('migFilter').addEventListener('change', render);
  document.getElementById('selPendingBtn').addEventListener('click', selectAllPending);
  document.getElementById('migSelBtn').addEventListener('click', () => migrate(selectedPending()));
  document.getElementById('migAllBtn').addEventListener('click', () => migrate(allPending()));
  await loadAll();
});

// ── Map a raw legacy collection into the flow import shape ──
function normalize(o) {
  const due = flowNum(o.totalAmountDue);
  const recv = flowNum(o.amountReceived);
  return {
    invoiceNo: String(o.invoiceNo || ''),
    drNo: o.drNo || '',
    date: o.date || '',
    customer: o.companyName || o.customer || o.customerId || '',
    soNo: o.soNo || '',
    poNo: o.poNo || '',
    paymentTerms: o.paymentTerms || '',
    dateReceived: o.dateReceived || '',
    invoiceAmount: flowNum(o.invoiceAmount),
    netOfVat: flowNum(o.netOfVat),
    vat: flowNum(o.vat),
    ewt: flowNum(o.ewt),
    totalAmountDue: due,
    dueDate: o.dueDate || '',
    dateCollected: o.dateCollected || '',
    amountReceived: recv,
    createdBy: o.createdBy || 'Migrated (legacy)',
    outstanding: due - recv,
    status: recv >= due && due > 0 ? 'Collected' : (recv > 0 ? 'Partial' : 'Outstanding'),
  };
}

async function loadAll() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="dr-empty">Loading legacy collections…</div>';
  selected.clear();
  try {
    const [oldRes, flowRes] = await Promise.all([
      apiGetCollections().catch(e => ({ success: false, message: e.message })),
      fetchFlow('getARAging').catch(() => ({ data: [] })),
    ]);
    if (!oldRes || !oldRes.success) throw new Error((oldRes && oldRes.message) || 'Could not load legacy collections.');

    // de-dupe legacy by invoiceNo (records without an invoice number are kept individually)
    const seen = new Set();
    legacyCols = [];
    (oldRes.data || []).forEach((raw, i) => {
      const n = normalize(raw);
      const key = n.invoiceNo || ('__row' + i);
      if (seen.has(key)) return;
      seen.add(key);
      legacyCols.push(n);
    });

    // an AR row's INV No marks the source invoice as already migrated
    migratedSet = new Set((flowRes && flowRes.data || []).map(a => String(a.invNo)).filter(Boolean));

    render();
  } catch (e) {
    c.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`;
  }
}

function isMigrated(rec) { return !!rec.invoiceNo && migratedSet.has(String(rec.invoiceNo)); }

function filteredCols() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const st = document.getElementById('statusFilter').value;
  const mf = document.getElementById('migFilter').value;
  return legacyCols.filter(rec => {
    if (st && rec.status !== st) return false;
    if (mf === 'pending' && isMigrated(rec)) return false;
    if (mf === 'migrated' && !isMigrated(rec)) return false;
    if (q) {
      const hay = (rec.invoiceNo + ' ' + rec.customer + ' ' + rec.poNo).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function allPending() { return legacyCols.filter(rec => !isMigrated(rec)); }
function selectedPending() { return allPending().filter(rec => selected.has(rec.invoiceNo)); }

function selectAllPending() {
  filteredCols().forEach(rec => { if (!isMigrated(rec) && rec.invoiceNo) selected.add(rec.invoiceNo); });
  render();
}

function render() {
  // KPIs
  const total = legacyCols.length;
  const mig = legacyCols.filter(isMigrated).length;
  const pend = total - mig;
  const recv = legacyCols.reduce((s, r) => s + r.amountReceived, 0);
  const out = legacyCols.reduce((s, r) => s + Math.max(0, r.outstanding), 0);
  document.getElementById('kTotal').textContent = total;
  document.getElementById('kMig').textContent = mig;
  document.getElementById('kPend').textContent = pend;
  document.getElementById('kRecv').textContent = flowMoney(recv, 'PHP');
  document.getElementById('kOut').textContent = flowMoney(out, 'PHP');

  const rows = filteredCols();
  const c = document.getElementById('container');
  if (!rows.length) {
    c.innerHTML = '<div class="dr-empty">No collections match the current filters.</div>';
    return;
  }

  c.innerHTML = `<table class="mig-table"><thead><tr>
    <th style="width:28px;"><input type="checkbox" id="selAll"></th>
    <th>Invoice No</th><th>Date</th><th>Customer</th><th>PO / DR</th><th>Terms</th>
    <th class="num">Total Due</th><th class="num">Received</th><th class="num">Outstanding</th>
    <th>Status</th><th>Migration</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table>`;

  const selAll = document.getElementById('selAll');
  selAll.addEventListener('change', () => {
    rows.forEach(rec => { if (!isMigrated(rec) && rec.invoiceNo) { selAll.checked ? selected.add(rec.invoiceNo) : selected.delete(rec.invoiceNo); } });
    render();
  });
  c.querySelectorAll('input[data-inv]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-inv');
      cb.checked ? selected.add(id) : selected.delete(id);
      updateButtons();
    });
  });
  c.querySelectorAll('.mig-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = document.getElementById('brk-' + btn.getAttribute('data-idx'));
      if (box) box.classList.toggle('open');
    });
  });
  updateButtons();
}

function statusBadge(rec) {
  if (rec.status === 'Collected') return '<span class="mig-badge b-mig">Collected</span>';
  if (rec.status === 'Partial') return '<span class="mig-badge b-pend">Partial</span>';
  return '<span class="mig-badge b-pend" style="background:rgba(239,68,68,0.14);color:#b91c1c;">Outstanding</span>';
}

function rowHtml(rec, idx) {
  const done = isMigrated(rec);
  const checked = selected.has(rec.invoiceNo) ? ' checked' : '';
  const cb = done
    ? '<span title="Already migrated">—</span>'
    : (rec.invoiceNo ? `<input type="checkbox" data-inv="${flowEsc(rec.invoiceNo)}"${checked}>` : '<span title="No invoice number — cannot dedupe">!</span>');
  const migBadge = done
    ? '<span class="mig-badge b-mig">Migrated ✓</span>'
    : '<span class="mig-badge b-pend">Pending</span>';
  const breakdown = `<button class="mig-link" data-idx="${idx}">details ▾</button>
    <div class="mig-items" id="brk-${idx}"><table>
      <tbody>
        <tr><td>Invoice Amount</td><td class="num">${flowMoney(rec.invoiceAmount, 'PHP')}</td>
            <td>Net of VAT</td><td class="num">${flowMoney(rec.netOfVat, 'PHP')}</td></tr>
        <tr><td>VAT</td><td class="num">${flowMoney(rec.vat, 'PHP')}</td>
            <td>EWT</td><td class="num">${flowMoney(rec.ewt, 'PHP')}</td></tr>
        <tr><td>Due Date</td><td>${flowEsc(rec.dueDate || '—')}</td>
            <td>Date Collected</td><td>${flowEsc(rec.dateCollected || '—')}</td></tr>
      </tbody></table></div>`;
  const poDr = [rec.poNo, rec.drNo].filter(Boolean).join(' / ') || '—';
  return `<tr>
    <td>${cb}</td>
    <td class="ref">${flowEsc(rec.invoiceNo || '(none)')}</td>
    <td>${flowEsc(flowDate(rec.date) || rec.date || '—')}</td>
    <td>${flowEsc(rec.customer || '(unknown)')}</td>
    <td>${flowEsc(poDr)}</td>
    <td>${flowEsc(rec.paymentTerms || '—')}</td>
    <td class="num">${flowMoney(rec.totalAmountDue, 'PHP')}<div>${breakdown}</div></td>
    <td class="num">${flowMoney(rec.amountReceived, 'PHP')}</td>
    <td class="num">${flowMoney(Math.max(0, rec.outstanding), 'PHP')}</td>
    <td>${statusBadge(rec)}</td>
    <td>${migBadge}</td></tr>`;
}

function updateButtons() {
  const selCount = selectedPending().length;
  const pendCount = allPending().length;
  document.getElementById('migSelBtn').textContent = `Migrate selected${selCount ? ' (' + selCount + ')' : ''}`;
  document.getElementById('migSelBtn').disabled = !selCount;
  document.getElementById('migAllBtn').textContent = `Migrate all pending${pendCount ? ' (' + pendCount + ')' : ''}`;
  document.getElementById('migAllBtn').disabled = !pendCount;
}

// ── Run the chunked import ──
async function migrate(list) {
  list = (list || []).filter(rec => !isMigrated(rec));
  if (!list.length) { flash('Nothing to migrate — all selected are already in the flow.', false); return; }
  if (!confirm(`Migrate ${list.length} collection record(s) into the new system? Original invoice numbers are preserved, existing ones are skipped, and no journals are posted.`)) return;

  const box = document.getElementById('runBox');
  const bar = document.getElementById('progBar');
  const stat = document.getElementById('runStat');
  box.style.display = 'block';
  document.getElementById('runTitle').textContent = 'Migrating…';
  setBusy(true);

  let createdAR = 0, createdPayments = 0, skipped = 0;
  const errors = [];
  const chunks = [];
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));

  for (let i = 0; i < chunks.length; i++) {
    const payload = chunks[i].map(rec => ({
      invoiceNo: rec.invoiceNo, drNo: rec.drNo, date: rec.date, customer: rec.customer,
      soNo: rec.soNo, poNo: rec.poNo, paymentTerms: rec.paymentTerms, dateReceived: rec.dateReceived,
      invoiceAmount: rec.invoiceAmount, netOfVat: rec.netOfVat, vat: rec.vat, ewt: rec.ewt,
      totalAmountDue: rec.totalAmountDue, dueDate: rec.dueDate, dateCollected: rec.dateCollected,
      amountReceived: rec.amountReceived, createdBy: rec.createdBy,
    }));
    try {
      const r = await postFlow('importCollections', { items: JSON.stringify(payload) });
      if (r && r.success) {
        createdAR += r.createdAR || 0;
        createdPayments += r.createdPayments || 0;
        skipped += r.skipped || 0;
        (r.errors || []).forEach(e => errors.push(e));
      } else {
        chunks[i].forEach(rec => errors.push({ invoiceNo: rec.invoiceNo, message: (r && r.message) || 'Import failed' }));
      }
    } catch (e) {
      chunks[i].forEach(rec => errors.push({ invoiceNo: rec.invoiceNo, message: e.message }));
    }
    const pct = Math.round(((i + 1) / chunks.length) * 100);
    bar.style.width = pct + '%';
    stat.textContent = `Batch ${i + 1}/${chunks.length} · receivables ${createdAR} · payments ${createdPayments} · skipped ${skipped} · errors ${errors.length}`;
  }

  document.getElementById('runTitle').textContent = 'Migration complete';
  stat.innerHTML = `<strong>Receivables ${createdAR}</strong> · payments ${createdPayments} · skipped ${skipped} · errors ${errors.length}` +
    (errors.length ? `<div style="margin-top:0.4rem;color:#b45309;">Failed: ${errors.slice(0, 20).map(e => flowEsc(e.invoiceNo) + ' (' + flowEsc(e.message) + ')').join(', ')}${errors.length > 20 ? '…' : ''}</div>` : '');

  setBusy(false);
  selected.clear();
  flash(`Migrated ${createdAR} receivable(s) and ${createdPayments} payment(s); skipped ${skipped}.`, errors.length === 0);
  await loadAll(); // refresh badges from the flow
}

function setBusy(on) {
  ['reloadBtn', 'selPendingBtn', 'migSelBtn', 'migAllBtn'].forEach(id => { document.getElementById(id).disabled = on; });
}

function flash(text, ok) {
  const m = document.getElementById('msg');
  m.style.display = 'block';
  m.textContent = text;
  m.style.color = ok ? '#0f766e' : '#b45309';
}
