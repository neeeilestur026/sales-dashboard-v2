/* A321 — Payroll in the books (payroll-books.html). Everything here lives in Code.gs (v5); the Books page
 * reads it through /books/sync.
 *
 *   Cutoffs to pay   the approved cutoffs (the LAST decision per period wins, as Code.gs reads it), each
 *                    with its net pay; director or accounting marks one paid with the bank's date and
 *                    the account it left, or undoes a mistaken mark.
 *   Tables           SSS / PhilHealth / Pag-IBIG, effective-dated. The editor starts from the latest
 *                    table so a new circular is an edit, not retyping; Code.gs validates the brackets.
 *   Shares           the employer shares for a month, per employee, computed from the tables — what
 *                    cutoff B will post. A missing table is said out loud: that cutoff waits in the Inbox.
 */
(function () {
  const PAGE_ROLES = ['admin', 'accounting', 'management', 'director', 'hr'];
  const PAY_ROLES = ['director', 'accounting'];
  const TABLE_ROLES = ['director', 'accounting', 'admin', 'hr'];
  const MIN_CODE_VERSION = 5;
  /* What each agency's table holds. `pct` columns are percentages; the others are pesos. */
  const COLS = {
    'SSS': [['from', 'Pay from'], ['to', 'Pay to (blank: and above)'], ['ee', 'Employee ₱'], ['er', 'Employer ₱'], ['ec', 'EC ₱']],
    'PhilHealth': [['rate', 'Premium rate %', 'pct'], ['eeShare', 'Employee share %', 'pct'], ['floor', 'Floor ₱'], ['ceiling', 'Ceiling ₱']],
    'Pag-IBIG': [['from', 'Pay from'], ['to', 'Pay to (blank: and above)'], ['ee', 'Employee %', 'pct'], ['er', 'Employer %', 'pct'], ['ceiling', 'Pay ceiling ₱']]
  };
  const BASIS_DEFAULT = { 'SSS': 'gross', 'PhilHealth': 'basic', 'Pag-IBIG': 'basic' };
  const P = { session: null, role: '', canPay: false, canEdit: false, banks: [], tables: [], agency: 'SSS', version: '', loaded: {} };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => hxEsc(v);
  const money = (v) => (Number(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function msg(id, text, ok) { const m = $(id); if (!m) return; m.textContent = text; m.className = 'flow-msg ' + (ok ? 'ok' : 'bad'); m.hidden = !text; }
  function banner(text) { const b = $('pbBanner'); b.textContent = text || ''; b.hidden = !text; }
  async function need(promise, what) {
    const r = await promise;
    if (!r || r.success === false) throw new Error((r && r.message) || ('Could not read ' + what + '.'));
    return r;
  }

  /* ── cutoffs to pay ──────────────────────────────────────────────────────────────────────────── */
  function latestPerPeriod(rows) {
    const last = {};
    rows.slice().sort((a, b) => a.rowIndex - b.rowIndex).forEach(r => { last[r.period] = r; });
    return Object.keys(last).map(k => last[k]).filter(r => r.status === 'Approved').sort((a, b) => b.period.localeCompare(a.period));
  }
  async function loadPay() {
    $('payTable').innerHTML = '<div class="hx-empty">Loading…</div>';
    try {
      const [ap, banks] = await Promise.all([need(apiGetPayrollApprovals(), 'the approvals'), P.canPay ? apiGetBankAccounts().catch(() => ({})) : Promise.resolve({})]);
      P.banks = ((banks && (banks.data || banks.accounts)) || []).filter(a => a && a.code);
      const rows = latestPerPeriod(ap.data || []);
      const unpaid = rows.filter(r => !r.paidDate).length;
      $('payMeta').textContent = rows.length ? (unpaid ? unpaid + ' not marked paid' : 'All marked paid') : '';
      if (!rows.length) { $('payTable').innerHTML = '<div class="hx-empty">No approved cutoffs yet. They appear here once management approves them.</div>'; return; }
      const opts = P.banks.map(a => `<option value="${esc(a.code)}"${/AUB/i.test(a.code) ? ' selected' : ''}>${esc(a.name || a.code)}</option>`).join('');
      $('payTable').innerHTML = `<table class="bk-table"><thead><tr><th>Period</th><th>Cutoff</th><th class="num">Employees</th><th class="num">Net pay</th><th>Approved</th><th>Paid</th></tr></thead><tbody>` +
        rows.map(r => {
          const t = r.totals || {};
          let paid;
          if (r.paidDate) {
            paid = `<span class="bk-ok">${esc(r.paidDate)}</span> <span class="bk-dim">from ${esc(r.paidBank)}${r.paidBy ? ' · ' + esc(r.paidBy) : ''}</span>` +
                   (P.canPay ? ` <button type="button" class="btn btn-sm pb-undo" data-period="${esc(r.period)}">Undo</button>` : '');
          } else if (P.canPay && P.banks.length) {
            paid = `<span class="pb-pay"><input type="date" class="pb-date" value="${today()}" max="${today()}" aria-label="Date the bank paid ${esc(r.period)}">` +
                   `<select class="pb-bank" aria-label="Paid from">${opts}</select>` +
                   `<button type="button" class="btn btn-sm btn-primary primary pb-mark" data-period="${esc(r.period)}">Mark paid</button></span>`;
          } else paid = '<span class="bk-dim">Not marked paid</span>';
          return `<tr><td>${esc(r.period)}</td><td>${esc(r.cutoffLabel)}</td><td class="num">${esc(t.employeeCount || 0)}</td><td class="num">${money(t.netPay)}</td>` +
                 `<td>${esc(String(r.decidedAt || '').slice(0, 10))}${r.approvedBy ? ' <span class="bk-dim">' + esc(r.approvedBy) + '</span>' : ''}</td><td>${paid}</td></tr>`;
        }).join('') + '</tbody></table>';
      if (P.canPay && !P.banks.length) msg('payMsg', 'No bank accounts could be loaded, so nothing can be marked paid. Add them on the Banks page.', false);
    } catch (e) { $('payTable').innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; }
  }
  async function markPaid(btn) {
    const row = btn.closest('tr'), period = btn.dataset.period;
    const date = row.querySelector('.pb-date').value, bank = row.querySelector('.pb-bank').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return msg('payMsg', 'Enter the date the bank paid ' + period + '.', false);
    if (date > today()) return msg('payMsg', 'The bank date cannot be in the future.', false);
    btn.disabled = true;
    try {
      const r = await need(apiMarkPayrollPaid(period, date, bank), 'the answer');
      msg('payMsg', r.message || (period + ' marked paid.'), true);
      await loadPay();
    } catch (e) { msg('payMsg', e.message, false); btn.disabled = false; }
  }
  async function undoPaid(btn) {
    const period = btn.dataset.period;
    if (!confirm('Clear the paid mark on ' + period + '? Do this only if it was marked by mistake; the books reverse the payment on the next sync.')) return;
    btn.disabled = true;
    try { const r = await need(apiMarkPayrollPaid(period, '', '', true), 'the answer'); msg('payMsg', r.message, true); await loadPay(); }
    catch (e) { msg('payMsg', e.message, false); btn.disabled = false; }
  }

  /* ── contribution tables ─────────────────────────────────────────────────────────────────────── */
  const versionsOf = (agency) => Array.from(new Set(P.tables.filter(r => r.agency === agency).map(r => r.effectiveFrom))).sort().reverse();
  const rowsOf = (agency, eff) => P.tables.filter(r => r.agency === agency && r.effectiveFrom === eff).sort((a, b) => a.from - b.from);
  const cell = (c, v) => (c[2] === 'pct' ? (Number(v) || 0) + '%' : (c[0] === 'to' && !Number(v) ? 'and above' : money(v)));
  async function loadTables() {
    try { P.tables = (await need(apiGetPayrollContributionTables(), 'the tables')).data || []; }
    catch (e) { $('tblCurrent').innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; return; }
    renderAgency();
  }
  function renderAgency() {
    const a = P.agency, vs = versionsOf(a);
    document.querySelectorAll('.pb-agency .bk-pos').forEach(b => { const on = b.dataset.agency === a; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
    if (!vs.includes(P.version)) P.version = vs[0] || '';
    $('tblMeta').textContent = vs.length ? vs.length + ' table' + (vs.length === 1 ? '' : 's') + ' on file' : '';
    $('tblVersions').innerHTML = vs.length ? 'Effective from: ' + vs.map(v => `<button type="button" class="pb-ver${v === P.version ? ' active' : ''}" data-ver="${esc(v)}">${esc(v)}</button>`).join(' ') : '';
    const rows = P.version ? rowsOf(a, P.version) : [];
    if (!rows.length) {
      $('tblCurrent').innerHTML = `<div class="bk-verdict bad">No ${esc(a)} table yet. Until one is entered, cutoff B waits in the Books Inbox instead of posting a guessed employer share.</div>`;
    } else {
      const cols = COLS[a], r0 = rows[0];
      $('tblCurrent').innerHTML = `<p class="bk-dim">Read against <b>${r0.basis === 'basic' ? 'basic pay' : 'gross pay'}</b>${r0.notes ? ' · ' + esc(r0.notes) : ''}${r0.updatedBy ? ' · saved by ' + esc(r0.updatedBy) : ''}</p>` +
        `<table class="bk-table"><thead><tr>${cols.map(c => `<th class="num">${esc(c[1])}</th>`).join('')}</tr></thead><tbody>` +
        rows.map(r => '<tr>' + cols.map(c => `<td class="num">${esc(cell(c, r[c[0]]))}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
    }
    if (P.canEdit) startEditor(rows);
  }
  function startEditor(rows) {
    const a = P.agency, cols = COLS[a];
    show('tblForm', true); msg('tblMsg', '');
    $('tblFormTitle').textContent = rows.length ? 'New ' + a + ' table, starting from the one above' : 'First ' + a + ' table';
    $('tblFrom').value = '';
    $('tblBasis').value = (rows[0] && rows[0].basis) || BASIS_DEFAULT[a];
    $('tblSource').value = '';
    show('tblAddRow', a !== 'PhilHealth');
    const start = rows.length ? rows : (a === 'PhilHealth' ? [{}] : [{}, {}, {}]);
    $('tblGrid').innerHTML = `<thead><tr>${cols.map(c => `<th>${esc(c[1])}</th>`).join('')}<th></th></tr></thead><tbody>` + start.map(r => gridRow(cols, r)).join('') + '</tbody>';
  }
  function gridRow(cols, r) {
    return '<tr>' + cols.map(c => {
      const v = r[c[0]];
      return `<td><input type="number" step="0.01" min="0" inputmode="decimal" data-k="${c[0]}" value="${v === undefined || (c[0] === 'to' && !Number(v)) ? '' : esc(v)}" aria-label="${esc(c[1])}"></td>`;
    }).join('') + (P.agency === 'PhilHealth' ? '<td></td>' : '<td><button type="button" class="btn btn-sm pb-del" aria-label="Remove this bracket">Remove</button></td>') + '</tr>';
  }
  async function saveTable(ev) {
    ev.preventDefault();
    const a = P.agency, eff = $('tblFrom').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) return msg('tblMsg', 'Enter the date this table takes effect.', false);
    const rows = Array.from($('tblGrid').querySelectorAll('tbody tr')).map(tr => {
      const o = { basis: $('tblBasis').value, notes: $('tblSource').value.trim() };
      tr.querySelectorAll('input[data-k]').forEach(i => { o[i.dataset.k] = i.value === '' ? 0 : parseFloat(i.value); });
      return o;
    }).filter(o => COLS[a].some(c => o[c[0]]));
    if (!rows.length) return msg('tblMsg', 'Enter at least one row.', false);
    if (versionsOf(a).includes(eff) && !confirm('A ' + a + ' table from ' + eff + ' is already on file. Replace it?')) return;
    $('tblSave').disabled = true;
    try {
      const r = await need(apiSavePayrollContributionTables(a, eff, rows), 'the answer');
      P.version = eff;
      await loadTables();
      msg('tblMsg', r.message, true);
    } catch (e) { msg('tblMsg', e.message, false); }
    $('tblSave').disabled = false;
  }

  /* ── employer shares ─────────────────────────────────────────────────────────────────────────── */
  async function loadShares() {
    const m = $('shMonth').value;
    if (!/^\d{4}-\d{2}$/.test(m)) return msg('shMsg', 'Choose a month.', false);
    msg('shMsg', '');
    $('shTable').innerHTML = '<div class="hx-empty">Loading…</div>';
    try {
      const d = (await need(apiGetPayrollEmployerShares(m), 'the shares')).data;
      if (d.missing && d.missing.length) msg('shMsg', 'No ' + d.missing.join(' or ') + ' table in force for ' + m + '. Cutoff B of this month waits in the Books Inbox until one is entered.', false);
      if (!d.perEmployee.length) { $('shTable').innerHTML = '<div class="hx-empty">No payroll register rows for ' + esc(m) + '.</div>'; return; }
      const tot = (e) => e.sssER + e.sssEC + e.phER + e.hdmfER;
      const t = d.totals;
      $('shTable').innerHTML = `<table class="bk-table"><thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">Basic</th><th class="num">SSS employer</th><th class="num">SSS EC</th>` +
        `<th class="num">PhilHealth employer</th><th class="num">Pag-IBIG employer</th><th class="num">Total</th></tr></thead><tbody>` +
        d.perEmployee.map(e => `<tr${tot(e) ? '' : ' class="bk-off"'}><td>${esc(e.employee)}</td><td class="num">${money(e.gross)}</td><td class="num">${money(e.basic)}</td>` +
          `<td class="num">${money(e.sssER)}</td><td class="num">${money(e.sssEC)}</td><td class="num">${money(e.phER)}</td><td class="num">${money(e.hdmfER)}</td><td class="num">${money(tot(e))}</td></tr>`).join('') +
        `</tbody><tfoot><tr><td>Month</td><td></td><td></td><td class="num">${money(t.sssER)}</td><td class="num">${money(t.sssEC)}</td><td class="num">${money(t.phER)}</td>` +
        `<td class="num">${money(t.hdmfER)}</td><td class="num">${money(t.sssER + t.sssEC + t.phER + t.hdmfER)}</td></tr></tfoot></table>` +
        '<p class="bk-dim">A share is owed only where the employee\'s own contribution was deducted that month; greyed rows had none.</p>';
    } catch (e) { $('shTable').innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; }
  }

  const LOADERS = { pay: loadPay, tables: loadTables, shares: loadShares };
  function openTab(name) {
    document.querySelectorAll('.bk-tab').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    Object.keys(LOADERS).forEach(k => show('pane-' + k, k === name));
    if (!P.loaded[name]) { P.loaded[name] = true; LOADERS[name](); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    P.session = requireAuth();
    if (!P.session) return;
    P.role = String(P.session.role || '').toLowerCase();
    if (PAGE_ROLES.indexOf(P.role) === -1) { window.location.href = _homeForRole(P.session.role); return; }
    if (typeof renderNavbar === 'function') renderNavbar('payroll-books');
    P.canPay = PAY_ROLES.indexOf(P.role) !== -1;
    P.canEdit = TABLE_ROLES.indexOf(P.role) !== -1;
    try {
      const v = await fetchFromAPI({ action: 'getCodeVersion' }, { noCache: true });
      if (!v || !(Number(v.version) >= MIN_CODE_VERSION)) {
        banner('This page needs the main backend (Code.gs) version ' + MIN_CODE_VERSION + '. Paste the latest Code.gs to switch it on.');
        return;
      }
    } catch (e) { /* a failed probe is not a verdict: let the reads say what is wrong */ }
    document.querySelectorAll('.bk-tab').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));
    document.querySelectorAll('.pb-agency .bk-pos').forEach(b => b.addEventListener('click', () => { P.agency = b.dataset.agency; P.version = ''; renderAgency(); }));
    $('tblVersions').addEventListener('click', (e) => { const b = e.target.closest('.pb-ver'); if (b) { P.version = b.dataset.ver; renderAgency(); } });
    $('tblAddRow').addEventListener('click', () => $('tblGrid').querySelector('tbody').insertAdjacentHTML('beforeend', gridRow(COLS[P.agency], {})));
    $('tblGrid').addEventListener('click', (e) => { const b = e.target.closest('.pb-del'); if (b) b.closest('tr').remove(); });
    $('tblForm').addEventListener('submit', saveTable);
    $('payTable').addEventListener('click', (e) => {
      const m = e.target.closest('.pb-mark'); if (m) return markPaid(m);
      const u = e.target.closest('.pb-undo'); if (u) return undoPaid(u);
    });
    $('shRun').addEventListener('click', loadShares);
    $('shMonth').value = today().slice(0, 7);
    if (!P.canPay) $('payHint').textContent = 'Director or accounting marks a cutoff paid.';
    openTab('pay');
  });
  window.__payrollBooks = { P, COLS, BASIS_DEFAULT, latestPerPeriod, PAY_ROLES, TABLE_ROLES, PAGE_ROLES };   // tests
})();
