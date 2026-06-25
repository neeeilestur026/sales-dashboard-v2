/* migrate-expenses.js — bulk-migrate the legacy Expenses ledger (production api.js) into the new
   flow Expenses tab (FlowAPI). Reads OLD via apiGetExpenses(), writes NEW via postFlow('importExpenses').
   Each old record → one flow Expense, auto-typed OpEx / G&A / Other. Already-migrated rows (matched on
   a composite Legacy Key) are skipped; no GL journals posted. */

let legacyExp = [];           // normalized legacy expense records
let migratedSet = new Set();  // legacy keys already present in the flow
let selected = new Set();     // legacy keys checked for migration
const CHUNK = 25;

// Default category → type map (mirrors FlowAPI _EXP_TYPE_MAP) for the migrated preview.
const EXP_TYPE_MAP = {
  'advertising': 'Operating', 'commission': 'Operating', 'delivery expense': 'Operating',
  'representation': 'Operating', 'transportation and travel': 'Operating', 'load allowances': 'Operating',
  'postage and communication': 'Operating', 'repairs and maintenance': 'Operating', 'supplies expense': 'Operating',
  'tools and equipment': 'Operating', 'fuel': 'Operating', 'toll': 'Operating', 'meals': 'Operating',
  'gas': 'Operating', 'transportation': 'Operating',
  'salaries and wages': 'Operating', 'payroll': 'Operating',
  'employee benefits': 'General & Administrative',
  'statutory benefits': 'General & Administrative', 'rent expense': 'General & Administrative',
  'utilities': 'General & Administrative', 'depreciation expense': 'General & Administrative',
  'legal fees': 'General & Administrative', 'professional fees': 'General & Administrative',
  'permits and licenses': 'General & Administrative', 'bank service charge': 'General & Administrative',
  'janitorial': 'General & Administrative', 'medical expenses': 'General & Administrative',
  'miscellaneous': 'General & Administrative', 'revolving fund': 'General & Administrative',
  'revolving funds': 'General & Administrative',
  'cost of goods sold': 'Other', 'inventory': 'Other', 'interest expense': 'Other', 'interest income': 'Other'
};
const TYPE_BADGE = { 'Operating': 'b-opex', 'General & Administrative': 'b-ga', 'Other': 'b-other' };
const TYPE_SHORT = { 'Operating': 'OpEx', 'General & Administrative': 'G&A', 'Other': 'Other' };
function expTypeFor(cat) { return EXP_TYPE_MAP[String(cat || '').trim().toLowerCase()] || 'Operating'; }

// Signature = date · voucher · category · amount · description (matches FlowAPI _expSig). Including the
// voucher keeps distinct vouchers that share date/amount/description from colliding. Computed identically
// for legacy source records and existing flow rows so the migrated badge + server dedupe always agree.
function expSig(date, voucher, category, amount, description) {
  return [flowDate(date) || '', String(voucher || '').trim(), String(category || '').trim(),
    flowNum(amount).toFixed(2), String(description || '').trim()].join('|');
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAccountingOrAdmin()) return;
  renderNavbar('migrate-expenses');
  document.getElementById('reloadBtn').addEventListener('click', loadAll);
  document.getElementById('search').addEventListener('input', render);
  document.getElementById('typeFilter').addEventListener('change', render);
  document.getElementById('migFilter').addEventListener('change', render);
  document.getElementById('selPendingBtn').addEventListener('click', selectAllPending);
  document.getElementById('migSelBtn').addEventListener('click', () => migrate(selectedPending()));
  document.getElementById('migAllBtn').addEventListener('click', () => migrate(allPending()));
  await loadAll();
});

// ── Map a raw legacy expense into the flow import shape + compute its Legacy Key ──
function normalize(o) {
  const toll = flowNum(o.toll), fuel = flowNum(o.fuel), meals = flowNum(o.meals),
    loadBalance = flowNum(o.loadBalance), otherAmount = flowNum(o.otherAmount);
  const amount = (o.total != null && o.total !== '') ? flowNum(o.total)
    : (toll + fuel + meals + loadBalance + otherAmount);
  const category = String(o.category || '').trim() || 'Uncategorized';
  const date = flowDate(o.date) || '';
  const description = String(o.description || '').trim();
  const createdBy = String(o.createdBy || '').trim() || 'Migrated (legacy)';
  const voucherNo = o.orderRef || o.voucherNo || '';
  return {
    date, category, voucherNo, client: o.client || '', description,
    toll, fuel, meals, loadBalance, otherAmount, amount, notes: o.notes || '', createdBy,
    type: expTypeFor(category),
    legacyKey: expSig(date, voucherNo, category, amount, description),
  };
}

async function loadAll() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="dr-empty">Loading legacy expenses…</div>';
  selected.clear();
  try {
    const [oldRes, flowRes] = await Promise.all([
      apiGetExpenses().catch(e => ({ success: false, message: e.message })),
      fetchFlow('getExpenses').catch(() => ({ data: [] })),
    ]);
    if (!oldRes || !oldRes.success) throw new Error((oldRes && oldRes.message) || 'Could not load legacy expenses.');

    legacyExp = (oldRes.data || []).map(normalize);
    // Recompute the signature from each flow row's fields (don't trust the stored Legacy Key column),
    // so already-migrated rows match by value and the badges are correct.
    migratedSet = new Set((flowRes && flowRes.data || [])
      .map(e => expSig(e.date, e.voucherNo, e.category, e.amount, e.description)));
    render();
  } catch (e) {
    c.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`;
  }
}

function isMigrated(rec) { return migratedSet.has(rec.legacyKey); }

function filteredExp() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const tf = document.getElementById('typeFilter').value;
  const mf = document.getElementById('migFilter').value;
  return legacyExp.filter(rec => {
    if (tf && rec.type !== tf) return false;
    if (mf === 'pending' && isMigrated(rec)) return false;
    if (mf === 'migrated' && !isMigrated(rec)) return false;
    if (q) {
      const hay = (rec.voucherNo + ' ' + rec.client + ' ' + rec.description + ' ' + rec.category).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function allPending() { return legacyExp.filter(rec => !isMigrated(rec)); }
function selectedPending() { return allPending().filter(rec => selected.has(rec.legacyKey)); }

function selectAllPending() {
  filteredExp().forEach(rec => { if (!isMigrated(rec)) selected.add(rec.legacyKey); });
  render();
}

function render() {
  const total = legacyExp.length;
  const mig = legacyExp.filter(isMigrated).length;
  const amt = legacyExp.reduce((s, r) => s + r.amount, 0);
  const byType = { 'Operating': 0, 'General & Administrative': 0, 'Other': 0 };
  legacyExp.forEach(r => { byType[r.type] += r.amount; });
  document.getElementById('kTotal').textContent = total;
  document.getElementById('kMig').textContent = mig;
  document.getElementById('kPend').textContent = total - mig;
  document.getElementById('kAmt').textContent = flowMoney(amt, 'PHP');
  document.getElementById('kSplit').textContent =
    `${flowMoney(byType['Operating'], 'PHP')} · ${flowMoney(byType['General & Administrative'], 'PHP')} · ${flowMoney(byType['Other'], 'PHP')}`;

  const rows = filteredExp();
  const c = document.getElementById('container');
  if (!rows.length) { c.innerHTML = '<div class="dr-empty">No expenses match the current filters.</div>'; return; }

  c.innerHTML = `<table class="mig-table"><thead><tr>
    <th style="width:28px;"><input type="checkbox" id="selAll"></th>
    <th>Date</th><th>Type</th><th>Category</th><th>Voucher</th><th>Client</th><th>Description</th>
    <th class="num">Amount</th><th>Migration</th></tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table>`;

  const selAll = document.getElementById('selAll');
  selAll.addEventListener('change', () => {
    rows.forEach(rec => { if (!isMigrated(rec)) { selAll.checked ? selected.add(rec.legacyKey) : selected.delete(rec.legacyKey); } });
    render();
  });
  c.querySelectorAll('input[data-key]').forEach(cb => cb.addEventListener('change', () => {
    const id = cb.getAttribute('data-key');
    cb.checked ? selected.add(id) : selected.delete(id);
    updateButtons();
  }));
  c.querySelectorAll('.mig-link').forEach(btn => btn.addEventListener('click', () => {
    const box = document.getElementById('brk-' + btn.getAttribute('data-idx'));
    if (box) box.classList.toggle('open');
  }));
  updateButtons();
}

function rowHtml(rec, idx) {
  const done = isMigrated(rec);
  const checked = selected.has(rec.legacyKey) ? ' checked' : '';
  const cb = done ? '<span title="Already migrated">—</span>'
    : `<input type="checkbox" data-key="${flowEsc(rec.legacyKey)}"${checked}>`;
  const migBadge = done ? '<span class="mig-badge b-mig">Migrated ✓</span>'
    : '<span class="mig-badge b-pend">Pending</span>';
  const hasBreak = rec.toll || rec.fuel || rec.meals || rec.loadBalance || rec.otherAmount;
  const breakdown = hasBreak ? `<button class="mig-link" data-idx="${idx}">breakdown ▾</button>
    <div class="mig-items" id="brk-${idx}"><table><tbody>
      <tr><td>Toll</td><td class="num">${flowMoney(rec.toll, 'PHP')}</td><td>Fuel</td><td class="num">${flowMoney(rec.fuel, 'PHP')}</td></tr>
      <tr><td>Meals</td><td class="num">${flowMoney(rec.meals, 'PHP')}</td><td>Load</td><td class="num">${flowMoney(rec.loadBalance, 'PHP')}</td></tr>
      <tr><td>Other</td><td class="num">${flowMoney(rec.otherAmount, 'PHP')}</td><td>Notes</td><td>${flowEsc(rec.notes || '—')}</td></tr>
    </tbody></table></div>` : '';
  return `<tr>
    <td>${cb}</td>
    <td style="white-space:nowrap;">${flowEsc(rec.date || '—')}</td>
    <td><span class="mig-badge ${TYPE_BADGE[rec.type]}">${TYPE_SHORT[rec.type]}</span></td>
    <td class="ref">${flowEsc(rec.category)}</td>
    <td>${flowEsc(rec.voucherNo || '—')}</td>
    <td>${flowEsc(rec.client || '—')}</td>
    <td>${flowEsc(rec.description || '—')}<div>${breakdown}</div></td>
    <td class="num">${flowMoney(rec.amount, 'PHP')}</td>
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

async function migrate(list) {
  list = (list || []).filter(rec => !isMigrated(rec));
  if (!list.length) { flash('Nothing to migrate — all selected are already in the flow.', false); return; }
  if (!confirm(`Migrate ${list.length} expense record(s) into the new system? Each is auto-classified into OpEx / G&A / Other, existing ones are skipped, and no journals are posted.`)) return;

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
      date: rec.date, category: rec.category, voucherNo: rec.voucherNo, client: rec.client,
      description: rec.description, toll: rec.toll, fuel: rec.fuel, meals: rec.meals,
      loadBalance: rec.loadBalance, otherAmount: rec.otherAmount, total: rec.amount,
      notes: rec.notes, createdBy: rec.createdBy,
    }));
    try {
      const r = await postFlow('importExpenses', { items: JSON.stringify(payload) });
      if (r && r.success) {
        created += r.created || 0;
        skipped += r.skipped || 0;
        (r.errors || []).forEach(e => errors.push(e));
      } else {
        chunks[i].forEach(rec => errors.push({ description: rec.description, message: (r && r.message) || 'Import failed' }));
      }
    } catch (e) {
      chunks[i].forEach(rec => errors.push({ description: rec.description, message: e.message }));
    }
    const pct = Math.round(((i + 1) / chunks.length) * 100);
    bar.style.width = pct + '%';
    stat.textContent = `Batch ${i + 1}/${chunks.length} · created ${created} · skipped ${skipped} · errors ${errors.length}`;
  }

  document.getElementById('runTitle').textContent = 'Migration complete';
  stat.innerHTML = `<strong>Created ${created}</strong> · skipped ${skipped} · errors ${errors.length}` +
    (errors.length ? `<div style="margin-top:0.4rem;color:#b45309;">Failed: ${errors.slice(0, 20).map(e => flowEsc(e.description || '?') + ' (' + flowEsc(e.message) + ')').join(', ')}${errors.length > 20 ? '…' : ''}</div>` : '');

  setBusy(false);
  selected.clear();
  flash(`Migrated ${created} expense(s); skipped ${skipped}.`, errors.length === 0);
  await loadAll();
}

function setBusy(on) {
  ['reloadBtn', 'selPendingBtn', 'migSelBtn', 'migAllBtn'].forEach(id => { document.getElementById(id).disabled = on; });
}
function flash(text, ok) {
  const m = document.getElementById('msg');
  m.style.display = 'block'; m.textContent = text; m.style.color = ok ? '#0f766e' : '#b45309';
}
