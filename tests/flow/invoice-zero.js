/* A343 — the invoice form never issues a ₱0 invoice, and a line left at 0 is not on the invoice.
 *
 * Run:  node tests/flow/invoice-zero.js
 *
 * 20 Oct 2026: invoice 126 (Therma South, SO 150005851) was saved with both lines at quantity 0, so it was
 * issued for ₱0.00 and took the number. Pinned here, on the real page script:
 *   • all lines at 0 → nothing is sent, and the form says to enter the quantity delivered;
 *   • a part delivery (one line at 1, one at 0) sends only the delivered line;
 *   • quantities with every price at 0 → nothing is sent (₱0.00);
 *   • a normal invoice still sends every line, with its hire shape.
 */
const fs = require('fs');
const path = require('path');
const { page } = require('./pageload');
const SRC = fs.readFileSync(path.join(__dirname, '../../dashboard/js/flow-invoices.js'), 'utf8');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };

const SO = { soNo: '150005851', customer: 'THERMA SOUTH, INC.', total: 403250.88, vatType: '', items: [
  { itemId: '', itemNo: 'N/A', itemName: '1-TORCH; HAND; TOMAHAWK 625', qty: 2, price: 175193.09 },
  { itemId: '', itemNo: 'N/A', itemName: 'CLAMP; WORK AND CABLE; FOR TOMAHAWK 625', qty: 2, price: 26432.35 }] };

async function attempt(lines) {
  const p = page([], 'flow-invoices.html', { username: 'r', name: 'Rojan Leo Francisco', role: 'accounting' });
  p.ctx.addEventListener = () => {};                 // the page sizes its list on window resize
  p.run(SRC);
  const rows = lines.map(([q, pr]) => ({ querySelector: (sel) => ({ value: sel === '.qty' ? String(q) : String(pr), textContent: '' }) }));
  p.ctx.document.querySelectorAll = (sel) => (sel === '#itemRows tr' ? rows : []);
  p.run('ivSession = __session; ivCurrent = ' + JSON.stringify(SO) + ';');   // what the page sets on load
  p.els.customer.value = SO.customer;
  p.els.invNo.value = '126';
  p.els.date.value = '2026-10-20';
  p.calls.length = 0; p.params.length = 0;
  try { await p.run('saveInvoice()'); } catch (e) { /* after a save the page reloads its lists; the stub DOM may not have every element */ }
  const sent = p.params.filter(x => x.action === 'createInvoice');
  return { sent, items: sent.length ? JSON.parse(sent[0].params.items) : null, msg: p.els.formMsg.textContent };
}

(async () => {
  let r = await attempt([[0, 175193.09], [0, 26432.35]]);
  ok('both lines at 0: nothing is issued', r.sent.length === 0, r);
  ok('  and it says what to do', /Enter the quantity delivered on at least one line/.test(r.msg), r.msg);

  r = await attempt([[1, 175193.09], [0, 26432.35]]);
  ok('a part delivery sends only the delivered line', r.sent.length === 1 && r.items.length === 1 && r.items[0].itemName.indexOf('TORCH') >= 0 && r.items[0].qty === 1, r.items);

  r = await attempt([[1, 0], [1, 0]]);
  ok('quantities with no prices: nothing is issued (₱0.00)', r.sent.length === 0 && /comes to ₱0\.00/.test(r.msg), r);

  r = await attempt([[1, 175193.09], [1, 26432.35]]);
  ok('one torch and one clamp: both lines are sent, ₱201,625.44 before VAT', r.sent.length === 1 && r.items.length === 2
    && Math.round(r.items.reduce((t, it) => t + it.qty * it.price, 0) * 100) / 100 === 201625.44, r.items);
  ok('  with the invoice number and the order', r.sent[0].params.invNo === '126' && r.sent[0].params.soNo === '150005851', r.sent[0] && r.sent[0].params);

  console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
