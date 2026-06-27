/* ═══════════════════════════════════════════════
   balance-sheet.js — roll-forward Balance Sheet over the Process Flow.
   Current-snapshot (all-time), computed client-side from the flow getters per the
   confirmed guide. Equity = Total Assets − Total Liabilities (balancing figure).
   Opening Cash/Inventory balances are editable and persisted via setOpeningBalance.
   Oversight roles only. No GL dependency.
   ═══════════════════════════════════════════════ */

let bsSession = null;
let bsData = { opening: { cash: 0, inventory: 0 }, cols: [], ars: [], aps: [], recs: [], invs: [], exps: [] };

function _bm(v) { return flowMoney(v, 'PHP'); }
function _bn(v) { return flowNum(v); }
function _be(s) { return flowEsc(s); }

document.addEventListener('DOMContentLoaded', () => {
  bsSession = requireOversight();
  if (!bsSession) return;
  renderNavbar('balance-sheet');
  document.getElementById('refreshBtn').addEventListener('click', loadBS);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
  loadBS();
});

async function loadBS() {
  const body = document.getElementById('bsBody');
  body.innerHTML = '<div class="dr-empty">Loading…</div>';
  if (typeof _flowConfigured !== 'function' || !_flowConfigured()) {
    body.innerHTML = '<div class="dr-empty">Process Flow backend is not configured.</div>';
    return;
  }
  try {
    const [open, cols, ars, aps, recs, invs, exps] = await Promise.all([
      fetchFlow('getOpeningBalances').catch(() => ({ data: { cash: 0, inventory: 0 } })),
      fetchFlow('getCollections').catch(() => ({ data: [] })),
      fetchFlow('getARAging').catch(() => ({ data: [] })),
      fetchFlow('getAPAging').catch(() => ({ data: [] })),
      fetchFlow('getReceiving').catch(() => ({ data: [] })),
      fetchFlow('getInvoices').catch(() => ({ data: [] })),
      fetchFlow('getExpenses').catch(() => ({ data: [] })),
    ]);
    bsData = {
      opening: (open && open.data) || { cash: 0, inventory: 0 },
      cols: (cols && cols.data) || [], ars: (ars && ars.data) || [], aps: (aps && aps.data) || [],
      recs: (recs && recs.data) || [], invs: (invs && invs.data) || [], exps: (exps && exps.data) || [],
    };
    renderBS();
  } catch (e) {
    body.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${_be(e.message)}</div>`;
  }
}

/** PHP payable for an AP row: prefer Amount (PHP); fall back to FC amount for PHP-currency POs. */
function _apPHP(a) {
  const php = _bn(a.amountPHP);
  if (php > 0) return php;
  return (a.currency || 'PHP') === 'PHP' ? _bn(a.amountFC) : 0;
}

function renderBS() {
  const d = bsData;
  const openCash = _bn(d.opening.cash);
  const openInv = _bn(d.opening.inventory);

  // Collections (net cash + EWT)
  const netCollections = d.cols.reduce((s, c) => s + (_bn(c.amount) - _bn(c.ewt)), 0);
  const ewtTotal = d.cols.reduce((s, c) => s + _bn(c.ewt), 0);

  // AP
  const apPaid = d.aps.reduce((s, a) => s + _bn(a.paidPHP), 0);
  const apOutstanding = d.aps.reduce((s, a) => s + (_apPHP(a) - _bn(a.paidPHP)), 0);

  // Receiving
  const shipTotal = d.recs.reduce((s, r) => s + _bn(r.totalShipping), 0);
  const shipExclVat = d.recs.reduce((s, r) => s + _bn(r.duties) + _bn(r.delivery) + _bn(r.other), 0);
  const vatTotal = d.recs.reduce((s, r) => s + _bn(r.vat), 0);

  // Invoices / AR / Expenses
  const cogs = d.invs.reduce((s, v) => s + _bn(v.totalCOGS), 0);
  const arOutstanding = d.ars.reduce((s, a) => s + _bn(a.outstanding), 0);
  const expenses = d.exps.reduce((s, e) => s + _bn(e.amount), 0);

  // ── Lines ──
  const cash = openCash + netCollections - (apPaid + shipTotal + expenses);
  const ar = arOutstanding;
  const inventory = openInv + shipExclVat + apPaid - cogs;
  const purchClearing = apOutstanding;
  const inputVat = vatTotal;
  const creditableTax = ewtTotal;
  const otherAssets = inputVat + creditableTax;
  const totalAssets = cash + ar + inventory + purchClearing + otherAssets;

  const ap = apOutstanding;
  const totalLiabilities = ap;
  const equity = totalAssets - totalLiabilities;

  document.getElementById('bsMeta').textContent =
    `Current snapshot · as of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${_be(bsSession.name)}`;

  const sub = (label, val, neg) => `<tr class="bs-sub"><td>${label}</td><td class="n">${neg ? '(' + _bm(val) + ')' : _bm(val)}</td></tr>`;
  const line = (label, val) => `<tr class="bs-line"><td>${label}</td><td class="n">${_bm(val)}</td></tr>`;

  const balanced = Math.abs(totalAssets - (totalLiabilities + equity)) < 0.005;

  document.getElementById('bsBody').innerHTML = `
    <div class="bs-kpis">
      <div class="bs-kpi assets"><div class="l">Total Assets</div><div class="v">${_bm(totalAssets)}</div></div>
      <div class="bs-kpi"><div class="l">Total Liabilities</div><div class="v">${_bm(totalLiabilities)}</div></div>
      <div class="bs-kpi equity"><div class="l">Equity</div><div class="v">${_bm(equity)}</div></div>
    </div>

    <div class="bs-opening no-print">
      <h3>Opening Balances</h3>
      <div class="bs-opening-row">
        <div class="fld"><label>Cash (beginning, PHP)</label><input type="number" step="any" id="openCash" value="${openCash || ''}"></div>
        <div class="fld"><label>Inventory on hand (beginning, PHP)</label><input type="number" step="any" id="openInv" value="${openInv || ''}"></div>
        <button class="btn btn-sm btn-primary" id="saveOpenBtn" onclick="bsSaveOpening()">Save opening balances</button>
        <span id="openMsg" style="font-size:0.78rem;color:var(--text-muted);"></span>
      </div>
    </div>

    <table class="bs-stmt"><tbody>
      <tr><td class="bs-section" colspan="2">Assets</td></tr>

      ${line('Cash', cash)}
      ${sub('Opening balance', openCash)}
      ${sub('Add: Net collections (invoice − EWT)', netCollections)}
      ${sub('Less: AP payments', apPaid, true)}
      ${sub('Less: Receiving shipping (incl. VAT)', shipTotal, true)}
      ${sub('Less: Expenses', expenses, true)}

      ${line('Accounts Receivable', ar)}
      ${sub('Outstanding receivables (AR aging)', arOutstanding)}

      ${line('Inventory', inventory)}
      ${sub('Opening balance (landed cost)', openInv)}
      ${sub('Add: Shipping capitalized (excl. VAT)', shipExclVat)}
      ${sub('Add: AP payments (purchase cost)', apPaid)}
      ${sub('Less: Cost of goods sold (invoices)', cogs, true)}

      ${line('Purchases Clearing', purchClearing)}
      ${sub('Unpaid PO purchase value (PHP)', purchClearing)}

      ${line('Other Assets', otherAssets)}
      ${sub('Input VAT Receivable (from receiving)', inputVat)}
      ${sub('Creditable Tax — 2307 (from collections)', creditableTax)}

      <tr class="bs-total"><td>TOTAL ASSETS</td><td class="n">${_bm(totalAssets)}</td></tr>

      <tr><td class="bs-section" colspan="2">Liabilities</td></tr>
      ${line('Accounts Payable', ap)}
      ${sub('Outstanding payables (AP aging, PHP)', apOutstanding)}
      <tr class="bs-total"><td>TOTAL LIABILITIES</td><td class="n">${_bm(totalLiabilities)}</td></tr>

      <tr><td class="bs-section" colspan="2">Equity</td></tr>
      <tr class="bs-equity"><td>Equity (Total Assets − Total Liabilities)</td><td class="n">${_bm(equity)}</td></tr>
    </tbody></table>

    <div class="bs-check ${balanced ? 'ok' : 'bad'}">
      ${balanced ? '✓' : '✕'} Assets ${_bm(totalAssets)} = Liabilities ${_bm(totalLiabilities)} + Equity ${_bm(equity)}
    </div>

    <p style="font-size:0.72rem;color:var(--text-muted);margin-top:1rem;line-height:1.5;">
      Current all-time snapshot from the Process Flow. Purchases Clearing offsets Accounts Payable
      (both = unpaid PO purchase value in PHP), so ordering/paying a PO leaves equity unchanged; equity
      moves only with realized profit (Sales − COGS − Expenses). PHP payables rely on the AP aging
      <em>Amount (PHP)</em> entered per row (PHP-currency POs fall back to the FC amount). EWT (2307) is
      captured on the AR-aging Collect action.
    </p>`;
}

async function bsSaveOpening() {
  const btn = document.getElementById('saveOpenBtn');
  const msg = document.getElementById('openMsg');
  const cash = flowNum(document.getElementById('openCash').value);
  const inv = flowNum(document.getElementById('openInv').value);
  btn.disabled = true; msg.textContent = 'Saving…';
  try {
    const r1 = await postFlow('setOpeningBalance', { key: 'cash', amount: cash });
    const r2 = await postFlow('setOpeningBalance', { key: 'inventory', amount: inv });
    if (!r1.success || !r2.success) throw new Error((r1.message || '') + ' ' + (r2.message || ''));
    msg.textContent = 'Saved.';
    await loadBS();
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}
