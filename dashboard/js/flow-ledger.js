/* flow-ledger.js — trial balance, journal, chart of accounts */
let glJournal = [];
let glSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  glSession = requireAccountingOrAdmin();
  if (!glSession) return;
  renderNavbar('flow-ledger');
  renderFlowNav('flow-ledger.html');
  await loadAll();
});

function showTab(t) {
  ['tb', 'journal', 'coa'].forEach(x => document.getElementById('tab-' + x).style.display = (x === t ? 'block' : 'none'));
  document.querySelectorAll('#glTabs .flow-tab').forEach(a => a.classList.toggle('active', a.dataset.tab === t));
}

async function loadAll() {
  await Promise.all([loadTrialBalance(), loadJournal(), loadCOA()]);
}

async function loadTrialBalance() {
  const c = document.getElementById('tbContainer');
  c.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getTrialBalance');
    const rows = (res && res.data) || [];
    const t = res.totals || { debit: 0, credit: 0, balanced: true };
    document.getElementById('tbStatus').innerHTML = t.balanced
      ? `<span style="color:#16a34a;">● Balanced</span> — Dr ${flowMoney(t.debit, 'PHP')} = Cr ${flowMoney(t.credit, 'PHP')}`
      : `<span style="color:#ef4444;">● Out of balance</span> — Dr ${flowMoney(t.debit, 'PHP')} vs Cr ${flowMoney(t.credit, 'PHP')}`;
    c.innerHTML = `<table class="flow-table"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${rows.map(a => `
      <tr><td>${flowEsc(a.code)}</td><td>${flowEsc(a.name)}</td><td>${flowEsc(a.type)}</td>
      <td class="num">${a.debitBalance ? flowMoney(a.debitBalance, 'PHP') : ''}</td>
      <td class="num">${a.creditBalance ? flowMoney(a.creditBalance, 'PHP') : ''}</td></tr>`).join('')}
      <tr style="font-weight:700;border-top:2px solid var(--border,#334155);"><td colspan="3">TOTAL</td>
      <td class="num">${flowMoney(t.debit, 'PHP')}</td><td class="num">${flowMoney(t.credit, 'PHP')}</td></tr></tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}

async function loadJournal() {
  try { const res = await fetchFlow('getJournal'); glJournal = (res && res.data) || []; }
  catch (e) { glJournal = []; }
  renderJournal();
}

function renderJournal() {
  const src = document.getElementById('srcFilter').value;
  const rows = src ? glJournal.filter(l => l.source === src) : glJournal;
  const c = document.getElementById('journalContainer');
  if (!rows.length) { c.innerHTML = '<p style="color:var(--text-muted,#64748b);">No journal entries yet.</p>'; return; }
  c.innerHTML = `<table class="flow-table"><thead><tr><th>Entry No</th><th>Date</th><th>Source</th><th>Ref</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th>Memo</th></tr></thead><tbody>${rows.map(l => `
    <tr><td>${flowEsc(l.entryNo)}</td><td>${flowDate(l.date)}</td><td>${flowEsc(l.source)}</td><td>${flowEsc(l.sourceNo)}</td>
    <td>${flowEsc(l.accountCode)} ${flowEsc(l.accountName)}</td>
    <td class="num">${l.debit ? flowMoney(l.debit, l.currency) : ''}</td>
    <td class="num">${l.credit ? flowMoney(l.credit, l.currency) : ''}</td>
    <td style="color:var(--text-muted,#64748b);">${flowEsc(l.memo)}</td></tr>`).join('')}</tbody></table>`;
}

async function loadCOA() {
  const c = document.getElementById('coaContainer');
  try {
    const res = await fetchFlow('getChartOfAccounts');
    const rows = (res && res.data) || [];
    c.innerHTML = `<table class="flow-table"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Normal Balance</th></tr></thead><tbody>${rows.map(a => `
      <tr><td>${flowEsc(a.code)}</td><td>${flowEsc(a.name)}</td><td>${flowEsc(a.type)}</td><td>${flowEsc(a.normalBalance)}</td></tr>`).join('')}</tbody></table>`;
  } catch (e) { c.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`; }
}
