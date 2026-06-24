/* migrate-sales-orders.js — bulk-migrate legacy Sales Orders (production api.js) into the new
   flow SalesOrders/SalesOrderItems (FlowAPI). Reads OLD via apiGetSalesOrders(), writes NEW via
   postFlow('importSalesOrders'). Original SO numbers preserved; already-migrated SOs skipped. */

let migSession = null;
let legacySOs = [];          // normalized legacy SOs (with mapped flow items)
let migratedSet = new Set(); // SO numbers already present in the flow
let selected = new Set();    // soNos checked for migration
const CHUNK = 25;

document.addEventListener('DOMContentLoaded', async () => {
  migSession = requireAccountingOrAdmin();
  if (!migSession) return;
  renderNavbar('migrate-sales-orders');
  document.getElementById('reloadBtn').addEventListener('click', loadAll);
  document.getElementById('search').addEventListener('input', render);
  document.getElementById('statusFilter').addEventListener('change', render);
  document.getElementById('migFilter').addEventListener('change', render);
  document.getElementById('selPendingBtn').addEventListener('click', selectAllPending);
  document.getElementById('migSelBtn').addEventListener('click', () => migrate(selectedPending()));
  document.getElementById('migAllBtn').addEventListener('click', () => migrate(allPending()));
  await loadAll();
});

// ── Map a raw legacy SO into the flow shape ──
function normalize(o) {
  const soNo = o.soNo || o.soNumber || o.SONo || '';
  const rawItems = Array.isArray(o.items) ? o.items : [];
  const items = rawItems.map(it => ({
    itemNo: it.productCode || it.itemNo || it.code || '',
    itemName: it.productDescription || it.description || it.itemName || '',
    qty: flowNum(it.qty != null ? it.qty : it.quantity),
    price: flowNum(it.unitPrice != null ? it.unitPrice : it.price),
  }));
  const exVat = items.reduce((s, it) => s + it.qty * it.price, 0);
  return {
    soNo: String(soNo),
    quotationNo: o.quotationNo || o.refNo || '',
    date: o.date || o.soDate || '',
    customer: o.customerName || o.customer || o.customerId || '',
    status: o.status || '',
    createdBy: o.salesAgent || o.agentName || o.createdBy || 'Migrated (legacy)',
    items,
    exVat,
    grandTotal: flowNum(o.grandTotal != null ? o.grandTotal : (o.totalAmount != null ? o.totalAmount : exVat)),
  };
}

async function loadAll() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="dr-empty">Loading legacy sales orders…</div>';
  selected.clear();
  try {
    const [oldRes, flowRes] = await Promise.all([
      apiGetSalesOrders().catch(e => ({ success: false, message: e.message })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
    ]);
    if (!oldRes || !oldRes.success) throw new Error((oldRes && oldRes.message) || 'Could not load legacy sales orders.');

    // de-dupe legacy by soNo
    const seen = new Set();
    legacySOs = [];
    (oldRes.data || []).forEach(raw => {
      const n = normalize(raw);
      if (!n.soNo || seen.has(n.soNo)) return;
      seen.add(n.soNo);
      legacySOs.push(n);
    });

    migratedSet = new Set((flowRes && flowRes.data || []).map(s => String(s.soNo)));

    // populate status filter
    const statuses = Array.from(new Set(legacySOs.map(s => s.status).filter(Boolean))).sort();
    const sf = document.getElementById('statusFilter');
    sf.innerHTML = '<option value="">All statuses</option>' +
      statuses.map(s => `<option value="${flowEsc(s)}">${flowEsc(s)}</option>`).join('');

    render();
  } catch (e) {
    c.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`;
  }
}

function isMigrated(so) { return migratedSet.has(String(so.soNo)); }

function filteredSOs() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const st = document.getElementById('statusFilter').value;
  const mf = document.getElementById('migFilter').value;
  return legacySOs.filter(so => {
    if (st && so.status !== st) return false;
    if (mf === 'pending' && isMigrated(so)) return false;
    if (mf === 'migrated' && !isMigrated(so)) return false;
    if (q) {
      const hay = (so.soNo + ' ' + so.customer + ' ' + so.quotationNo).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function allPending() { return legacySOs.filter(so => !isMigrated(so)); }
function selectedPending() { return allPending().filter(so => selected.has(so.soNo)); }

function selectAllPending() {
  filteredSOs().forEach(so => { if (!isMigrated(so)) selected.add(so.soNo); });
  render();
}

function render() {
  // KPIs
  const total = legacySOs.length;
  const mig = legacySOs.filter(isMigrated).length;
  const pend = total - mig;
  const value = legacySOs.reduce((s, so) => s + so.exVat, 0);
  document.getElementById('kTotal').textContent = total;
  document.getElementById('kMig').textContent = mig;
  document.getElementById('kPend').textContent = pend;
  document.getElementById('kValue').textContent = flowMoney(value, 'PHP');

  const rows = filteredSOs();
  const c = document.getElementById('container');
  if (!rows.length) {
    c.innerHTML = '<div class="dr-empty">No sales orders match the current filters.</div>';
    return;
  }

  c.innerHTML = `<table class="mig-table"><thead><tr>
    <th style="width:28px;"><input type="checkbox" id="selAll"></th>
    <th>SO No</th><th>Date</th><th>Customer</th><th>Status</th><th>Items</th>
    <th class="num">Amount (ex-VAT)</th><th>Migration</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table>`;

  // checkbox wiring
  const selAll = document.getElementById('selAll');
  selAll.addEventListener('change', () => {
    rows.forEach(so => { if (!isMigrated(so)) { selAll.checked ? selected.add(so.soNo) : selected.delete(so.soNo); } });
    render();
  });
  c.querySelectorAll('input[data-so]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-so');
      cb.checked ? selected.add(id) : selected.delete(id);
      updateButtons();
    });
  });
  c.querySelectorAll('.mig-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = document.getElementById('items-' + btn.getAttribute('data-idx'));
      if (box) box.classList.toggle('open');
    });
  });
  updateButtons();
}

function rowHtml(so, idx) {
  const done = isMigrated(so);
  const checked = selected.has(so.soNo) ? ' checked' : '';
  const cb = done
    ? '<span title="Already migrated">—</span>'
    : `<input type="checkbox" data-so="${flowEsc(so.soNo)}"${checked}>`;
  const badge = done
    ? '<span class="mig-badge b-mig">Migrated ✓</span>'
    : '<span class="mig-badge b-pend">Pending</span>';
  const itemsRows = so.items.map(it => `<tr>
      <td>${flowEsc(it.itemNo)}</td><td>${flowEsc(it.itemName)}</td>
      <td class="num">${flowNum(it.qty)}</td><td class="num">${flowMoney(it.price, 'PHP')}</td>
      <td class="num">${flowMoney(it.qty * it.price, 'PHP')}</td></tr>`).join('');
  const itemDetail = so.items.length
    ? `<button class="mig-link" data-idx="${idx}">${so.items.length} item(s) ▾</button>
       <div class="mig-items" id="items-${idx}"><table>
         <thead><tr><th>Code</th><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr></thead>
         <tbody>${itemsRows}</tbody></table></div>`
    : '<span style="color:var(--text-muted);">no items</span>';
  const grand = so.grandTotal && Math.abs(so.grandTotal - so.exVat) > 0.005
    ? `<div style="font-size:0.7rem;color:var(--text-muted);">incl-VAT ${flowMoney(so.grandTotal, 'PHP')}</div>` : '';
  return `<tr>
    <td>${cb}</td>
    <td class="ref">${flowEsc(so.soNo)}</td>
    <td>${flowEsc(flowDate(so.date) || so.date || '—')}</td>
    <td>${flowEsc(so.customer || '(unknown)')}</td>
    <td>${flowEsc(so.status || '—')}</td>
    <td>${itemDetail}</td>
    <td class="num">${flowMoney(so.exVat, 'PHP')}${grand}</td>
    <td>${badge}</td></tr>`;
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
  list = (list || []).filter(so => !isMigrated(so));
  if (!list.length) { flash('Nothing to migrate — all selected are already in the flow.', false); return; }
  if (!confirm(`Migrate ${list.length} sales order(s) into the new system? Original numbers are preserved and existing ones are skipped.`)) return;

  const box = document.getElementById('runBox');
  const bar = document.getElementById('progBar');
  const stat = document.getElementById('runStat');
  box.style.display = 'block';
  document.getElementById('runTitle').textContent = 'Migrating…';
  setBusy(true);

  let created = 0, skipped = 0;
  const errors = [];
  const chunks = [];
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));

  for (let i = 0; i < chunks.length; i++) {
    const payload = chunks[i].map(so => ({
      soNo: so.soNo, quotationNo: so.quotationNo, date: so.date, customer: so.customer,
      status: so.status, createdBy: so.createdBy,
      items: so.items.map(it => ({ itemNo: it.itemNo, itemName: it.itemName, qty: it.qty, price: it.price })),
    }));
    try {
      const r = await postFlow('importSalesOrders', { items: JSON.stringify(payload) });
      if (r && r.success) {
        created += r.created || 0;
        skipped += r.skipped || 0;
        (r.errors || []).forEach(e => errors.push(e));
      } else {
        chunks[i].forEach(so => errors.push({ soNo: so.soNo, message: (r && r.message) || 'Import failed' }));
      }
    } catch (e) {
      chunks[i].forEach(so => errors.push({ soNo: so.soNo, message: e.message }));
    }
    const pct = Math.round(((i + 1) / chunks.length) * 100);
    bar.style.width = pct + '%';
    stat.textContent = `Batch ${i + 1}/${chunks.length} · created ${created} · skipped ${skipped} · errors ${errors.length}`;
  }

  document.getElementById('runTitle').textContent = 'Migration complete';
  stat.innerHTML = `<strong>Created ${created}</strong> · skipped ${skipped} · errors ${errors.length}` +
    (errors.length ? `<div style="margin-top:0.4rem;color:#b45309;">Failed: ${errors.slice(0, 20).map(e => flowEsc(e.soNo) + ' (' + flowEsc(e.message) + ')').join(', ')}${errors.length > 20 ? '…' : ''}</div>` : '');

  setBusy(false);
  selected.clear();
  flash(`Migrated ${created} sales order(s); skipped ${skipped}.`, errors.length === 0);
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
