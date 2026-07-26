/* ═══════════════════════════════════════════════════════════════════════════
   flow-ledger-view.js — shared open/history split, period filter and reconciliation
   for the ledger-style pages: AP Aging, AR Aging, Payment Requests, Other Payables.

   The rule these pages must obey (A157): THE HEADLINE TOTALS COVER EXACTLY THE OPEN ROWS
   THE TABLE LISTS. Settled and legacy records are still listed — inside a collapsed history
   block carrying its own subtotal — but they never enter the headline. Every open table also
   prints a totals footer, so the column visibly adds up to the KPI instead of being taken on
   trust. Before this, each page computed its cards in a one-shot inline script that did its
   own second fetch and never re-ran after an edit, so the cards could sit stale and disagree
   with the very rows underneath them.

   The period filter runs on the field each page actually populates — that differs per page
   (AR's createdAt is only the import stamp, AP's dueDate is mostly blank), so the caller
   passes the field and the label says which one it is.
   ═══════════════════════════════════════════════════════════════════════════ */

function _lvNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _lvEsc(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _lvMoney(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + _lvNum(v).toFixed(2); }

/** 'YYYY-MM' for a date cell, tolerating ISO strings, Date objects and blanks. */
function flowLedgerYM(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[0];
  const d = new Date(s);
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** Build the Year/Month <select> options from the rows themselves, newest first. */
function flowLedgerBuildPeriod(rows, dateField, yearId, monthId) {
  const ySel = document.getElementById(yearId), mSel = document.getElementById(monthId);
  if (!ySel) return;
  const years = {};
  (rows || []).forEach(r => { const ym = flowLedgerYM(r[dateField]); if (ym) years[ym.slice(0, 4)] = 1; });
  const list = Object.keys(years).sort((a, b) => b.localeCompare(a));
  const keepY = ySel.value;
  ySel.innerHTML = '<option value="">All years</option>' + list.map(y => `<option value="${y}">${y}</option>`).join('');
  if (keepY && (keepY === '' || list.indexOf(keepY) >= 0)) ySel.value = keepY;
  if (mSel && !mSel.options.length) {
    const M = ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const N = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    mSel.innerHTML = '<option value="">All months</option>' + M.map((m, i) => `<option value="${m}">${N[i]}</option>`).join('');
  }
}

/** Apply the period filter. Rows with no date survive an "All years" view but are excluded
 *  once a specific period is chosen — hiding them silently would break total-equals-list. */
function flowLedgerFilterPeriod(rows, dateField, yearId, monthId) {
  const y = (document.getElementById(yearId) || {}).value || '';
  const m = (document.getElementById(monthId) || {}).value || '';
  if (!y && !m) return (rows || []).slice();
  return (rows || []).filter(r => {
    const ym = flowLedgerYM(r[dateField]);
    if (!ym) return false;
    if (y && ym.slice(0, 4) !== y) return false;
    if (m && ym.slice(5, 7) !== m) return false;
    return true;
  });
}

/** Split into what is still in play and what is finished, using the page's own predicate. */
function flowLedgerSplit(rows, isOpen) {
  const open = [], history = [];
  (rows || []).forEach(r => (isOpen(r) ? open : history).push(r));
  return { open, history };
}

/**
 * The collapsed history block. Kept a <details> so it is one click away and prints expanded,
 * and its summary carries the count and subtotal so the money is never invisible — just
 * deliberately outside the headline.
 */
function flowLedgerHistoryBlock(opts) {
  const { title, count, subtotalLabel, subtotal, tableHtml } = opts;
  if (!count) return '';
  return `<details class="lv-hist">
    <summary class="lv-hist-sum">
      <span class="lv-hist-t">${_lvEsc(title)}</span>
      <span class="lv-hist-n">${count} record${count === 1 ? '' : 's'}</span>
      ${subtotalLabel ? `<span class="lv-hist-v">${_lvEsc(subtotalLabel)} ${_lvMoney(subtotal)}</span>` : ''}
      <span class="lv-hist-note">not included in the totals above</span>
    </summary>
    <div class="lv-hist-body">${tableHtml}</div>
  </details>`;
}

/** Totals footer for an open table: the on-screen proof that the column equals the KPI. */
function flowLedgerFootRow(cells, colCount) {
  // cells: [{ at: <0-based column index>, value: '<html>' }]
  const tds = [];
  for (let i = 0; i < colCount; i++) {
    const hit = cells.find(c => c.at === i);
    tds.push(hit ? `<td class="num lv-foot-v">${hit.value}</td>` : (i === 0 ? '<td class="lv-foot-l">Total (listed above)</td>' : '<td></td>'));
  }
  return `<tr class="lv-foot">${tds.join('')}</tr>`;
}

/** Shared styles, injected once. */
function flowLedgerInjectCss() {
  if (document.getElementById('lvCss')) return;
  const s = document.createElement('style');
  s.id = 'lvCss';
  s.textContent = [
    '.lv-filter{display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;margin-bottom:0.75rem;}',
    '.lv-filter label{font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted,#8b93a1);}',
    '.lv-filter select{padding:0.35rem 0.55rem;border-radius:8px;border:1px solid var(--border,#d7dce3);background:var(--bg-card,#fff);font-size:0.82rem;}',
    '.lv-filter .lv-basis{font-size:0.72rem;color:var(--text-muted,#8b93a1);}',
    '.lv-sec-title{font-size:0.78rem;font-weight:700;color:var(--text-primary,#111827);margin:0 0 0.4rem;}',
    '.lv-sec-title .lv-sub{font-weight:500;color:var(--text-muted,#8b93a1);}',
    '.lv-foot td{font-weight:800;background:#eef2ff;color:#3730a3;border-top:2px solid #4f46e5;}',
    '.lv-foot .lv-foot-l{text-transform:uppercase;font-size:0.7rem;letter-spacing:0.05em;}',
    '.lv-hist{margin-top:1rem;border:1px solid var(--border,#e2e8f0);border-radius:10px;overflow:hidden;background:var(--bg-card,#fff);}',
    '.lv-hist-sum{cursor:pointer;list-style:none;display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;padding:0.6rem 0.85rem;background:var(--bg-inset,#f8fafc);font-size:0.82rem;}',
    '.lv-hist-sum::-webkit-details-marker{display:none;}',
    '.lv-hist-sum::before{content:"▸";color:var(--text-muted,#94a3b8);transition:transform .15s;}',
    'details[open] .lv-hist-sum::before{transform:rotate(90deg);}',
    '.lv-hist-t{font-weight:700;color:var(--text-primary,#111827);}',
    '.lv-hist-n{font-size:0.72rem;font-weight:700;color:#b45309;background:#fffbeb;border-radius:999px;padding:0.05rem 0.5rem;}',
    '.lv-hist-v{font-weight:700;font-variant-numeric:tabular-nums;color:var(--text-secondary,#475569);}',
    '.lv-hist-note{margin-left:auto;font-size:0.72rem;color:var(--text-muted,#94a3b8);font-style:italic;}',
    '.lv-hist-body{padding:0.5rem 0.6rem 0.7rem;overflow-x:auto;}',
    '.lv-warn{color:#b91c1c;font-weight:700;}',
    '@media print{.lv-hist-body{display:block !important;}}',
  ].join('');
  document.head.appendChild(s);
}
