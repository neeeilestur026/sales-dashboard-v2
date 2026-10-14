/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   month-check.js — A331. The page. Every rule lives in month-check-model.js.

   What accounting reviews before closing a month: anything recorded twice, invoices and receivables
   that do not meet, billing above the order, a missing VAT type, EWT that is not what the customer's
   rate gives, EWT without its 2307, balances left half-paid, every save that went through with a
   reason, and any demo record in the live data. Read-only: it lists, a person corrects.

   getMonthCheck is a secured read, so it goes through Flask (postFlow), which says who is asking.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

let mcSession = null;
let mcData = null;

const mcE = (v) => flowEsc(v);
const mcM = (v) => flowMoney(v, 'PHP');
const MC_WHERE = {   // where each kind of record is corrected
  duplicateReceivables: 'flow-ar-aging.html', duplicatePayments: 'flow-collections.html',
  invoiceNoReceivable: 'flow-invoices.html', receivableNoInvoice: 'flow-ar-aging.html',
  overBilled: 'flow-invoices.html', invoiceVatMissing: 'flow-invoices.html', orderVatMissing: 'flow-sales-orders.html', ewtOff: 'flow-collections.html',
  no2307: 'flow-collections.html', partialOld: 'flow-ar-aging.html', overrides: '', demo: ''
};

document.addEventListener('DOMContentLoaded', async () => {
  mcSession = requireOversight();
  if (!mcSession) return;
  renderNavbar('flow-month-check');
  document.getElementById('mcRefresh').addEventListener('click', () => load());
  document.getElementById('mcPrint').addEventListener('click', () => window.print());
  document.getElementById('mcMonth').addEventListener('change', (e) => { mcPicked = e.target.value; render(); });
  await load();
});

async function load() {
  const body = document.getElementById('mcBody');
  body.innerHTML = '<div class="dr-empty">Loading…</div>';
  if (typeof _flowConfigured !== 'function' || !_flowConfigured()) {
    body.innerHTML = '<div class="dr-empty">Process Flow backend is not configured.</div>';
    return;
  }
  let live = false;
  try { live = await flowVersionAtLeast(169); } catch (e) { live = false; }
  if (!live) {
    body.innerHTML = '<div class="mc-banner">The Month check needs FlowAPI 169. Paste FlowAPI.gs into Apps Script, deploy it, then reload this page.</div>';
    document.getElementById('mcMeta').textContent = '';
    return;
  }
  try {
    const r = await postFlow('getMonthCheck', {});
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load the month check.');
    mcData = r;
  } catch (e) {
    body.innerHTML = `<div class="mc-banner bad">${mcE(e.message)}</div>`;
    return;
  }
  fillMonths();
  render();
}

let mcPicked = null;   // the month the user chose ('' = the whole ledger); null until they choose

function fillMonths() {
  const sel = document.getElementById('mcMonth');
  const months = mcMonths(mcData);
  const label = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  sel.innerHTML = months.map(m => `<option value="${mcE(m)}">${mcE(label(m))}</option>`).join('') +
    '<option value="">The whole ledger</option>';
  // First visit: the last month that has ended, since that is the one being closed.
  const thisMonth = flowToday().slice(0, 7);
  sel.value = mcPicked !== null && (mcPicked === '' || months.indexOf(mcPicked) >= 0)
    ? mcPicked : (months.find(m => m < thisMonth) || months[0] || '');
}

function render() {
  if (!mcData) return;
  const month = document.getElementById('mcMonth').value;
  const res = monthCheck(mcData, month, flowToday());
  const when = month ? new Date(month + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) : 'The whole ledger';
  document.getElementById('mcMeta').textContent =
    `${when} · ${res.total ? res.total + (res.total === 1 ? ' thing' : ' things') + ' to look at' : 'nothing to look at'}` +
    (res.asOf ? ` · balances as of ${flowDate(res.asOf)}` : '');

  const banner = res.safeguards ? '' :
    '<div class="mc-banner bad">The safeguards are switched off (FlowSettings: safeguards = off), so saves are not being checked. Switch them back on once the reason for turning them off has passed.</div>';
  const index = `<ul class="mc-index" aria-label="Checks">${res.checks.map(c => `
    <li class="${c.items.length ? 'hit' : 'zero'}"><a href="#mc-${mcE(c.key)}"><span>${mcE(c.title)}</span>
      <span class="n">${c.items.length ? c.items.length : 'none'}</span></a></li>`).join('')}</ul>`;
  const sections = res.checks.map(sectionHtml).join('');
  document.getElementById('mcBody').innerHTML = banner + index + sections;
}

function sectionHtml(c) {
  const where = MC_WHERE[c.key];
  const n = c.items.length;
  const head = `<h2>${mcE(c.title)} <span class="c">${n ? n : 'none'}</span></h2>
    <p class="mc-why">${mcE(c.why)}${n && where ? ` Correct it on <a href="${mcE(where)}">${mcE(pageName(where))}</a>.` : ''}</p>`;
  if (!n) return `<section class="mc-sec" id="mc-${mcE(c.key)}">${head}<p class="mc-none">Nothing found.</p></section>`;
  const isOv = c.key === 'overrides';
  const rows = c.items.map(it => `<tr>
      <td>${mcE(it.ref)}</td>
      <td>${mcE(it.customer)}</td>
      <td class="when">${mcE(it.date)}</td>
      ${isOv ? '' : `<td class="num">${it.amount == null ? '' : mcM(it.amount)}</td>`}
      <td class="detail${isOv ? ' reason' : ''}">${mcE(it.detail)}</td></tr>`).join('');
  const sum = isOv ? '' : c.items.reduce((t, it) => t + (Number(it.amount) || 0), 0);
  return `<section class="mc-sec" id="mc-${mcE(c.key)}">${head}
    <div class="mc-wrap"><table class="flow-table mc-table"><thead><tr>
      <th>${isOv ? 'Record' : 'Ref'}</th><th>${isOv ? 'Who' : 'Customer'}</th><th>Date</th>${isOv ? '' : '<th class="num">Amount</th>'}<th>${isOv ? 'What and why' : 'What to look at'}</th>
    </tr></thead><tbody>${rows}</tbody>
    ${isOv ? '' : `<tfoot><tr><td colspan="3">${n} listed</td><td class="num">${mcM(sum)}</td><td></td></tr></tfoot>`}
    </table></div></section>`;
}

function pageName(href) {
  return { 'flow-ar-aging.html': 'AR Aging', 'flow-collections.html': 'Collections', 'flow-invoices.html': 'Invoices', 'flow-sales-orders.html': 'Sales Orders' }[href] || href;
}
