/* flow-expenses.js — redesigned Expenses ledger on the FlowAPI.
   Records grouped into Operating / General & Administrative / Other with per-type subtotals,
   per-category breakdowns, and an overall total. Add/edit/delete + per-record Docs. */

let expSession = null;
let allExp = [];                 // all expense records (camelCase from getExpenses)
let collapsed = {};              // type → collapsed?

const EXP_TYPES = ['Operating', 'General & Administrative', 'Other'];
const TYPE_LABEL = { 'Operating': 'Operating Expenses (OpEx)', 'General & Administrative': 'General & Administrative', 'Other': 'Other / Non-Operating' };
const TYPE_BADGE = { 'Operating': 'b-opex', 'General & Administrative': 'b-ga', 'Other': 'b-other' };

// Default category → type map (mirrors FlowAPI _EXP_TYPE_MAP) for the Add/Edit auto-fill.
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
const EXP_CATEGORIES = ['Advertising', 'Bank service charge', 'Commission', 'Cost of Goods Sold',
  'Delivery Expense', 'Depreciation expense', 'Employee benefits', 'Interest expense', 'Interest income',
  'Inventory', 'Janitorial', 'Legal fees', 'Load allowances', 'Medical expenses', 'Miscellaneous',
  'Permits and licenses', 'Postage and communication', 'Professional fees', 'Rent expense',
  'Repairs and maintenance', 'Representation', 'Revolving fund', 'Salaries and wages', 'Statutory benefits',
  'Supplies expense', 'Tools and equipment', 'Transportation and travel', 'Utilities'];

function expTypeFor(cat) { return EXP_TYPE_MAP[String(cat || '').trim().toLowerCase()] || 'Operating'; }

document.addEventListener('DOMContentLoaded', async () => {
  expSession = requireAccountingOrAdmin();
  if (!expSession) return;
  renderNavbar('flow-expenses');
  renderFlowNav('flow-expenses.html');
  document.getElementById('reloadBtn').addEventListener('click', loadExpenses);
  document.getElementById('addBtn').addEventListener('click', () => openExpModal());
  const reclassBtn = document.getElementById('reclassSalariesBtn');
  if (reclassBtn) reclassBtn.addEventListener('click', reclassSalaries);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  ['search', 'yearSel', 'monthSel', 'typeFilter', 'catFilter'].forEach(id =>
    document.getElementById(id).addEventListener('input', render));
  document.getElementById('fCategory').addEventListener('input', e => {
    // auto-pick the type from the category unless the user already changed it
    document.getElementById('fType').value = expTypeFor(e.target.value);
  });
  // populate category datalist
  document.getElementById('catList').innerHTML = EXP_CATEGORIES.map(c => `<option value="${flowEsc(c)}">`).join('');
  await loadExpenses();
});

async function loadExpenses() {
  const c = document.getElementById('container');
  c.innerHTML = '<div class="dr-empty">Loading expenses…</div>';
  try {
    const res = await fetchFlow('getExpenses');
    allExp = (res && res.data) || [];
    buildYearOptions();
    buildCatOptions();
    render();
  } catch (e) {
    c.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${flowEsc(e.message)}</div>`;
  }
}

function _yr(d) { const s = flowDate(d); return s ? s.slice(0, 4) : ''; }
function _mo(d) { const s = flowDate(d); return s ? s.slice(5, 7) : ''; }

function buildYearOptions() {
  const sel = document.getElementById('yearSel');
  const years = new Set();
  allExp.forEach(r => { const y = _yr(r.date); if (y) years.add(y); });
  years.add(String(new Date().getFullYear()));
  const list = Array.from(years).sort((a, b) => b.localeCompare(a));
  const cur = sel.value || String(new Date().getFullYear());
  sel.innerHTML = '<option value="">All years</option>' +
    list.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('');
}

function buildCatOptions() {
  const sel = document.getElementById('catFilter');
  const cats = Array.from(new Set(allExp.map(r => r.category).filter(Boolean))).sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' +
    cats.map(c => `<option value="${flowEsc(c)}"${c === cur ? ' selected' : ''}>${flowEsc(c)}</option>`).join('');
}

function filtered() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const y = document.getElementById('yearSel').value;
  const m = document.getElementById('monthSel').value;
  const tf = document.getElementById('typeFilter').value;
  const cf = document.getElementById('catFilter').value;
  return allExp.filter(r => {
    if (y && _yr(r.date) !== y) return false;
    if (m && _mo(r.date) !== m) return false;
    if (tf && r.type !== tf) return false;
    if (cf && r.category !== cf) return false;
    if (q) {
      const hay = (r.voucherNo + ' ' + r.client + ' ' + r.description + ' ' + r.category).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function render() {
  const rows = filtered();

  // ── KPI totals ──
  const byType = { 'Operating': 0, 'General & Administrative': 0, 'Other': 0 };
  rows.forEach(r => { byType[r.type] = (byType[r.type] || 0) + flowNum(r.amount); });
  const total = byType['Operating'] + byType['General & Administrative'] + byType['Other'];
  document.getElementById('kTotal').textContent = flowMoney(total, 'PHP');
  document.getElementById('kOpex').textContent = flowMoney(byType['Operating'], 'PHP');
  document.getElementById('kGa').textContent = flowMoney(byType['General & Administrative'], 'PHP');
  document.getElementById('kOther').textContent = flowMoney(byType['Other'], 'PHP');
  document.getElementById('kCount').textContent = rows.length;

  const y = document.getElementById('yearSel').value;
  const m = document.getElementById('monthSel').value;
  const mLabel = m ? new Date(2000, parseInt(m, 10) - 1, 1).toLocaleString('en-US', { month: 'long' }) + ' ' : '';
  document.getElementById('metaLine').textContent =
    `Period: ${mLabel}${y || 'All years'} · ${rows.length} record(s) · sorted by type with subtotals.`;

  const c = document.getElementById('container');
  if (!rows.length) { c.innerHTML = '<div class="dr-empty">No expenses match the current filters.</div>'; return; }

  let html = '';
  EXP_TYPES.forEach(type => {
    const list = rows.filter(r => r.type === type)
      .sort((a, b) => (a.category || '').localeCompare(b.category || '') || flowDate(b.date).localeCompare(flowDate(a.date)));
    if (!list.length) return;
    const subtotal = list.reduce((s, r) => s + flowNum(r.amount), 0);

    // per-category breakdown
    const catMap = {};
    list.forEach(r => { catMap[r.category || 'Uncategorized'] = (catMap[r.category || 'Uncategorized'] || 0) + flowNum(r.amount); });
    const catBar = Object.keys(catMap).sort((a, b) => catMap[b] - catMap[a])
      .map(cat => `<span>${flowEsc(cat)} <b>${flowMoney(catMap[cat], 'PHP')}</b></span>`).join('');

    const isCol = collapsed[type];
    html += `<div class="ex-group${isCol ? ' collapsed' : ''}" data-type="${flowEsc(type)}">
      <div class="ex-group-head" data-toggle="${flowEsc(type)}">
        <span class="gt">${flowEsc(TYPE_LABEL[type])}</span>
        <span class="gc">${list.length} record(s)</span>
        <span class="gsub">${flowMoney(subtotal, 'PHP')}</span>
      </div>
      <div class="ex-group-body">
        <div class="ex-catbar">${catBar}</div>
        <div style="overflow-x:auto;"><table class="ex-table"><thead><tr>
          <th>Date</th><th>Category</th><th>Voucher</th><th>Client</th><th>Description</th>
          <th class="num">Toll</th><th class="num">Fuel</th><th class="num">Meals</th><th class="num">Load</th><th class="num">Other</th>
          <th class="num">Amount</th><th></th></tr></thead><tbody>
          ${list.map(rowHtml).join('')}
        </tbody></table></div>
      </div></div>`;
  });

  html += `<div class="ex-grand"><span class="gl">Total Overall Expenses</span><span class="gv">${flowMoney(total, 'PHP')}</span></div>`;
  c.innerHTML = html;

  c.querySelectorAll('[data-toggle]').forEach(h => h.addEventListener('click', () => {
    const t = h.getAttribute('data-toggle'); collapsed[t] = !collapsed[t]; render();
  }));
  c.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openExpModal(b.getAttribute('data-edit'))));
  c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delExpense(b.getAttribute('data-del'))));
  c.querySelectorAll('[data-docs]').forEach(b => b.addEventListener('click', () =>
    openDocsModal('Expense', b.getAttribute('data-docs'), 'Expense ' + b.getAttribute('data-docs'))));
}

function rowHtml(r) {
  const c = v => v ? flowMoney(v, 'PHP') : '—';
  return `<tr>
    <td style="white-space:nowrap;">${flowEsc(flowDate(r.date) || r.date || '—')}</td>
    <td>${flowEsc(r.category || '—')}</td>
    <td>${flowEsc(r.voucherNo || '—')}</td>
    <td>${flowEsc(r.client || '—')}</td>
    <td>${flowEsc(r.description || '—')}</td>
    <td class="num">${c(r.toll)}</td><td class="num">${c(r.fuel)}</td><td class="num">${c(r.meals)}</td>
    <td class="num">${c(r.loadBalance)}</td><td class="num">${c(r.other)}</td>
    <td class="num amt">${flowMoney(r.amount, 'PHP')}</td>
    <td style="white-space:nowrap;">
      <button class="ex-act" data-edit="${r.rowIndex}">Edit</button>
      <button class="ex-act" data-docs="${flowEsc(r.expNo)}">Docs</button>
      <button class="ex-act" data-del="${r.rowIndex}">✕</button>
    </td></tr>`;
}

// ── Add / Edit modal ──
function openExpModal(rowIndex) {
  const rec = rowIndex ? allExp.find(r => String(r.rowIndex) === String(rowIndex)) : null;
  document.getElementById('expModalTitle').textContent = rec ? 'Edit Expense' : 'Add Expense';
  document.getElementById('expRowIndex').value = rec ? rec.rowIndex : '';
  document.getElementById('fDate').value = rec ? flowDate(rec.date) : new Date().toISOString().slice(0, 10);
  document.getElementById('fType').value = rec ? rec.type : 'Operating';
  document.getElementById('fCategory').value = rec ? (rec.category || '') : '';
  document.getElementById('fVoucher').value = rec ? (rec.voucherNo || '') : '';
  document.getElementById('fClient').value = rec ? (rec.client || '') : '';
  document.getElementById('fDescription').value = rec ? (rec.description || '') : '';
  document.getElementById('fAmount').value = rec ? rec.amount : '';
  document.getElementById('fToll').value = rec && rec.toll ? rec.toll : '';
  document.getElementById('fFuel').value = rec && rec.fuel ? rec.fuel : '';
  document.getElementById('fMeals').value = rec && rec.meals ? rec.meals : '';
  document.getElementById('fLoad').value = rec && rec.loadBalance ? rec.loadBalance : '';
  document.getElementById('fOther').value = rec && rec.other ? rec.other : '';
  document.getElementById('fNotes').value = rec ? (rec.notes || '') : '';
  document.getElementById('expFormMsg').style.display = 'none';
  document.getElementById('expModal').classList.add('open');
}
function closeExpModal() { document.getElementById('expModal').classList.remove('open'); }

async function submitExpense() {
  const ri = document.getElementById('expRowIndex').value;
  const category = document.getElementById('fCategory').value.trim();
  const description = document.getElementById('fDescription').value.trim();
  if (!category) return formErr('Category is required.');
  if (!description) return formErr('Description is required.');
  const num = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? 0 : v; };
  const amtRaw = document.getElementById('fAmount').value.trim();
  const payload = {
    date: document.getElementById('fDate').value, type: document.getElementById('fType').value,
    category, voucherNo: document.getElementById('fVoucher').value.trim(),
    client: document.getElementById('fClient').value.trim(), description,
    toll: num('fToll'), fuel: num('fFuel'), meals: num('fMeals'), loadBalance: num('fLoad'), other: num('fOther'),
    notes: document.getElementById('fNotes').value.trim(),
  };
  if (amtRaw !== '') payload.amount = parseFloat(amtRaw);
  const btn = document.getElementById('expSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    let res;
    if (ri) { payload.rowIndex = ri; res = await postFlow('updateExpense', payload); }
    else res = await postFlow('addExpense', payload);
    if (!res || !res.success) throw new Error((res && res.message) || 'Save failed.');
    closeExpModal();
    flash(res.message || 'Saved.', true);
    await loadExpenses();
  } catch (e) {
    formErr(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

// One-time: move every "Salaries and wages" expense to the Operating type (payroll = OpEx).
async function reclassSalaries() {
  if (!confirm('Move ALL "Salaries and wages" expenses to the Operating type? This is safe to run once.')) return;
  const btn = document.getElementById('reclassSalariesBtn');
  btn.disabled = true; btn.textContent = 'Reclassifying…';
  try {
    const r = await postFlow('reclassifyExpenses', { category: 'Salaries and wages', type: 'Operating' });
    if (!r || !r.success) throw new Error((r && r.message) || 'Reclassify failed.');
    flash(r.message || 'Reclassified.', true);
    await loadExpenses();
  } catch (e) {
    flash(e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Salaries → Operating';
  }
}

async function delExpense(rowIndex) {
  const rec = allExp.find(r => String(r.rowIndex) === String(rowIndex));
  if (!rec) return;
  if (!confirm(`Delete expense ${rec.expNo} (${rec.category} · ${flowMoney(rec.amount, 'PHP')})?`)) return;
  try {
    const res = await postFlow('deleteExpense', { rowIndex });
    if (!res || !res.success) throw new Error((res && res.message) || 'Delete failed.');
    flash('Expense deleted.', true);
    await loadExpenses();
  } catch (e) { flash(e.message, false); }
}

function formErr(msg) {
  const m = document.getElementById('expFormMsg');
  m.style.display = 'block'; m.textContent = msg; m.style.color = '#b45309';
}
function flash(text, ok) {
  const m = document.getElementById('msg');
  m.style.display = 'block'; m.textContent = text; m.style.color = ok ? '#0f766e' : '#b45309';
}
