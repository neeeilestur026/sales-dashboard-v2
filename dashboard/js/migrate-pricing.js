/* migrate-pricing.js — bulk-migrate the legacy pricing-engine history (production "Pricing
   Submissions" sheet) into the new flow PricingRequests / PricingRequestItems (FlowAPI). Reads OLD
   via apiGetPricingSubmissions(), writes NEW via postFlow('importPricingSubmissions'). Dedupes by the
   old PRC id (Legacy ID); the full per-item cost/pricing breakdown is preserved for the detail view. */

let migSession = null;
let legacySubs = [];          // normalized legacy submissions
let migratedSet = new Set();  // legacy ids already present in the flow
let selected = new Set();     // legacy ids checked for migration
const CHUNK = 25;

document.addEventListener('DOMContentLoaded', async () => {
  migSession = requireAccountingOrAdmin();
  if (!migSession) return;
  renderNavbar('migrate-pricing');
  document.getElementById('reloadBtn').addEventListener('click', loadAll);
  document.getElementById('search').addEventListener('input', render);
  document.getElementById('migFilter').addEventListener('change', render);
  document.getElementById('selPendingBtn').addEventListener('click', selectAllPending);
  document.getElementById('migSelBtn').addEventListener('click', () => migrate(selectedPending()));
  document.getElementById('migAllBtn').addEventListener('click', () => migrate(allPending()));
  await loadAll();
});

function _customerOf(prRefsJson) {
  try { const a = JSON.parse(prRefsJson || '[]'); return (a[0] && a[0].clientName) || ''; } catch (e) { return ''; }
}

// ── Map a raw legacy submission into the flow import shape ──
function normalize(o) {
  let items = [];
  try { items = JSON.parse(o.itemsJson || '[]'); } catch (e) { items = []; }
  return {
    legacyId: String(o.id || ''),
    date: o.date || '',
    submittedBy: o.submittedBy || '',
    principal: o.principal || '',
    destination: o.destination || '',
    customer: _customerOf(o.prRefsJson),
    commissionPct: flowNum(o.commissionPct),
    marginPct: flowNum(o.marginPct),
    status: o.status || '',
    itemsJson: String(o.itemsJson || '[]'),
    items: items,
    itemCount: items.length,
  };
}

async function loadAll() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="dr-empty">Loading legacy pricing submissions…</div>';
  selected.clear();
  try {
    const [oldRes, flowRes] = await Promise.all([
      apiGetPricingSubmissions().catch(e => ({ success: false, message: e.message })),
      fetchFlow('getPricingRequests').catch(() => ({ data: [] })),
    ]);
    if (!oldRes || !oldRes.success) throw new Error((oldRes && oldRes.message) || 'Could not load legacy pricing submissions.');

    const seen = new Set();
    legacySubs = [];
    (oldRes.data || []).forEach((raw, i) => {
      const n = normalize(raw);
      const key = n.legacyId || ('__row' + i);
      if (seen.has(key)) return;
      seen.add(key);
      legacySubs.push(n);
    });

    migratedSet = new Set((flowRes && flowRes.data || []).map(p => String(p.legacyId)).filter(Boolean));
    render();
  } catch (e) {
    c.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`;
  }
}

function isMigrated(rec) { return !!rec.legacyId && migratedSet.has(String(rec.legacyId)); }

function filteredSubs() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const mf = document.getElementById('migFilter').value;
  return legacySubs.filter(rec => {
    if (mf === 'pending' && isMigrated(rec)) return false;
    if (mf === 'migrated' && !isMigrated(rec)) return false;
    if (q) {
      const hay = (rec.principal + ' ' + rec.destination + ' ' + rec.submittedBy + ' ' + rec.customer).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function allPending() { return legacySubs.filter(rec => !isMigrated(rec)); }
function selectedPending() { return allPending().filter(rec => selected.has(rec.legacyId)); }

function selectAllPending() {
  filteredSubs().forEach(rec => { if (!isMigrated(rec) && rec.legacyId) selected.add(rec.legacyId); });
  render();
}

function render() {
  const total = legacySubs.length;
  const mig = legacySubs.filter(isMigrated).length;
  const pend = total - mig;
  const items = legacySubs.reduce((s, r) => s + r.itemCount, 0);
  document.getElementById('kTotal').textContent = total;
  document.getElementById('kMig').textContent = mig;
  document.getElementById('kPend').textContent = pend;
  document.getElementById('kItems').textContent = items;

  const rows = filteredSubs();
  const c = document.getElementById('container');
  if (!rows.length) {
    c.innerHTML = '<div class="dr-empty">No pricing submissions match the current filters.</div>';
    return;
  }

  c.innerHTML = `<table class="mig-table"><thead><tr>
    <th style="width:28px;"><input type="checkbox" id="selAll"></th>
    <th>Legacy ID</th><th>Date</th><th>Submitted By</th><th>Principal</th><th>Destination</th>
    <th class="num">Comm %</th><th class="num">Margin %</th><th class="num">Items</th>
    <th>Status</th><th>Migration</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table>`;

  const selAll = document.getElementById('selAll');
  selAll.addEventListener('change', () => {
    rows.forEach(rec => { if (!isMigrated(rec) && rec.legacyId) { selAll.checked ? selected.add(rec.legacyId) : selected.delete(rec.legacyId); } });
    render();
  });
  c.querySelectorAll('input[data-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-id');
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

function breakdownHtml(rec, idx) {
  const cols = ['modelNo', 'name', 'qty', 'buyPrice', 'landedCost', 'totalCOGS', 'commission', 'profitMargin', 'vat', 'unitPriceVatEx', 'finalPrice'];
  const head = ['Model', 'Name', 'Qty', 'Buy', 'Landed', 'COGS', 'Comm', 'Margin', 'VAT', 'Unit (VAT-ex)', 'Final'];
  const body = (rec.items || []).map(it =>
    '<tr>' + cols.map((k, i) => {
      const v = it[k];
      if (k === 'modelNo' || k === 'name') return `<td>${flowEsc(v || '—')}</td>`;
      if (k === 'qty') return `<td>${flowNum(v)}</td>`;
      return `<td>${flowMoney(flowNum(v), 'PHP')}</td>`;
    }).join('') + '</tr>').join('');
  return `<button class="mig-link" data-idx="${idx}">full breakdown ▾</button>
    <div class="mig-items" id="brk-${idx}"><table>
      <thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${cols.length}">No item detail.</td></tr>`}</tbody></table></div>`;
}

function rowHtml(rec, idx) {
  const done = isMigrated(rec);
  const checked = selected.has(rec.legacyId) ? ' checked' : '';
  const cb = done
    ? '<span title="Already migrated">—</span>'
    : (rec.legacyId ? `<input type="checkbox" data-id="${flowEsc(rec.legacyId)}"${checked}>` : '<span title="No legacy id — cannot dedupe">!</span>');
  const migBadge = done
    ? '<span class="mig-badge b-mig">Migrated ✓</span>'
    : '<span class="mig-badge b-pend">Pending</span>';
  return `<tr>
    <td>${cb}</td>
    <td class="ref">${flowEsc(rec.legacyId || '(none)')}</td>
    <td>${flowEsc(flowDate(rec.date) || rec.date || '—')}</td>
    <td>${flowEsc(rec.submittedBy || '—')}</td>
    <td>${flowEsc(rec.principal || '—')}</td>
    <td>${flowEsc(rec.destination || '—')}</td>
    <td class="num">${rec.commissionPct || 0}</td>
    <td class="num">${rec.marginPct || 0}</td>
    <td class="num">${rec.itemCount}<div style="text-align:left;">${breakdownHtml(rec, idx)}</div></td>
    <td>${flowEsc(rec.status || '—')}</td>
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
  if (!confirm(`Migrate ${list.length} pricing submission(s) into the new system? The full breakdown is preserved and existing ones are skipped.`)) return;

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
    const payload = chunks[i].map(rec => ({
      id: rec.legacyId, date: rec.date, submittedBy: rec.submittedBy, principal: rec.principal,
      destination: rec.destination, customer: rec.customer, commissionPct: rec.commissionPct,
      marginPct: rec.marginPct, status: rec.status, itemsJson: rec.itemsJson,
    }));
    try {
      const r = await postFlow('importPricingSubmissions', { items: JSON.stringify(payload) });
      if (r && r.success) {
        created += r.created || 0;
        skipped += r.skipped || 0;
        (r.errors || []).forEach(e => errors.push(e));
      } else {
        chunks[i].forEach(rec => errors.push({ legacyId: rec.legacyId, message: (r && r.message) || 'Import failed' }));
      }
    } catch (e) {
      chunks[i].forEach(rec => errors.push({ legacyId: rec.legacyId, message: e.message }));
    }
    const pct = Math.round(((i + 1) / chunks.length) * 100);
    bar.style.width = pct + '%';
    stat.textContent = `Batch ${i + 1}/${chunks.length} · created ${created} · skipped ${skipped} · errors ${errors.length}`;
  }

  document.getElementById('runTitle').textContent = 'Migration complete';
  stat.innerHTML = `<strong>Created ${created}</strong> · skipped ${skipped} · errors ${errors.length}` +
    (errors.length ? `<div style="margin-top:0.4rem;color:#b45309;">Failed: ${errors.slice(0, 20).map(e => flowEsc(e.legacyId) + ' (' + flowEsc(e.message) + ')').join(', ')}${errors.length > 20 ? '…' : ''}</div>` : '');

  setBusy(false);
  selected.clear();
  flash(`Migrated ${created} pricing submission(s); skipped ${skipped}.`, errors.length === 0);
  await loadAll();
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
