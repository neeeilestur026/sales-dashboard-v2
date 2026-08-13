/* A239 — previewCommissionAttribution. Run: node tests/flow/commission-attribution.js
 *
 * WHY THIS FILE EXISTS. Commission money reaches a rep down one chain, and it can break at any of
 * four links:
 *
 *     Collection → (its AR row, or its invoice) → Sales Order → Quotation → owner
 *
 * A234's live-book report found 8 of 107 claims attributable, and answering "why not the other 99?"
 * meant reading five sheets by hand. The diagnostic answers it per order. What this file holds down
 * is that it names the RIGHT link: a report that says "no salesperson" when the truth is "no
 * collection" sends somebody to fix the wrong sheet, which is worse than saying nothing.
 *
 * The fixture is Gerald Lucena's real order — quotation QTN-202607-005, MINCON ENTERPRISES,
 * PHP 38,607.93 ex-VAT, collected 42,854.8023 — the same one commission-soa-mincon.js pins the
 * arithmetic for. Its quotation number deliberately does NOT match the house YYYY-NNN-XX pattern,
 * because that is what the real document looks like and it is exactly why attribution has to fall
 * back to the Salesperson column.
 */
const { load } = require('./gasload');

let fail = 0;
const ok = (l, c, x) => { if (!c) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
                          else console.log('  ok  ', l); };
const eq = (l, g, w) => ok(l + ' = ' + JSON.stringify(g), JSON.stringify(g) === JSON.stringify(w), { want: w });

const QUO = 'QTN-202607-005';
const SO  = 'SO-MINCON-1';
const COLLECTED = 42854.8023;

/** The whole chain, intact. `over` lets one link be broken without touching the others. */
function book(over) {
  const o = over || {};
  return {
    Quotations: o.noQuote ? [] : [{ 'Quotation No': QUO, 'Customer': 'MINCON ENTERPRISES',
      'Total': 38607.93, 'Salesperson': o.salesperson !== undefined ? o.salesperson : 'Gerald Lucena',
      'Created By': o.createdBy !== undefined ? o.createdBy : 'Gerald Lucena' }],
    SalesOrders: o.noSo ? [] : [{ 'SO No': SO, 'Customer': 'MINCON ENTERPRISES',
      'Quotation No': o.unlinkQuote ? '' : QUO, 'Total': 38607.93 }],
    Collections: o.noCollection ? [] : [{ 'Collection No': 'COL-1', 'SO No': o.unlinkSo ? '' : SO,
      'AR No': '', 'INV No': '', 'Customer': 'MINCON ENTERPRISES',
      'Date': '2026-08-05', 'Amount (PHP)': COLLECTED, 'EWT (PHP)': 0 }],
    Invoices: [], ARAging: [],
    CommissionRequests: [], CommissionItems: [], CommissionRates: [], ActivityLog: []
  };
}
const run = (over, params) => load(null, book(over)).previewCommissionAttribution(params || {});

console.log('== the chain intact: Gerald can be paid for the Mincon order ==');
{
  const r = run();
  eq('one collection examined', r.totals.collections, 1);
  eq('it resolves', r.resolved.length, 1);
  eq('nothing is unresolved', r.unresolved.length, 0);
  eq('nothing is unattributed', r.unattributed.length, 0);
  eq('to Gerald Lucena', r.resolved[0].salesperson, 'Gerald Lucena');
  eq('through the sales order', r.resolved[0].soNo, SO);
  eq('and the quotation', r.resolved[0].quotationNo, QUO);
  eq('the cash is the SOA figure', r.totals.resolved, 42854.8);
  eq('and it says HOW the owner was decided', r.resolved[0].ownerBasis, 'Salesperson column');
}

console.log('\n== break ONE link at a time — each must name ITS OWN link ==');
{
  const noColl = run({ noCollection: true });
  eq('no collection at all: nothing to examine', noColl.totals.collections, 0);
  ok('  and it does not invent a problem elsewhere',
     noColl.unresolved.length === 0 && noColl.unattributed.length === 0);

  const unlinked = run({ unlinkSo: true });
  eq('collection reaching no sales order: 1 unresolved', unlinked.unresolved.length, 1);
  eq('  named as the sales-order link', unlinked.unresolved[0].link, 'sales order');
  ok('  with the reason, not a code', /No sales order can be resolved/.test(unlinked.unresolved[0].reason),
     unlinked.unresolved[0].reason);
  eq('  and NOT blamed on the owner', unlinked.unattributed.length, 0);

  const noSo = run({ noSo: true });
  eq('sales order missing from the book: unresolved', noSo.unresolved.length, 1);
  ok('  and it names the missing SO number', /SO-MINCON-1 does not exist/.test(noSo.unresolved[0].reason),
     noSo.unresolved[0].reason);

  const noQuo = run({ unlinkQuote: true });
  eq('sales order with no quotation: unattributed', noQuo.unattributed.length, 1);
  eq('  named as the quotation link', noQuo.unattributed[0].link, 'quotation');
  ok('  with the reason', /no quotation linked/.test(noQuo.unattributed[0].reason),
     noQuo.unattributed[0].reason);
  eq('  and NOT blamed on the sales order', noQuo.unresolved.length, 0);

  const nobody = run({ salesperson: '', createdBy: '' });
  eq('quotation naming nobody: unattributed', nobody.unattributed.length, 1);
  eq('  named as the OWNER link, not the quotation', nobody.unattributed[0].link, 'owner');
  ok('  with the reason', /names nobody/.test(nobody.unattributed[0].reason),
     nobody.unattributed[0].reason);
}

console.log('\n== the fallback ladder is reported honestly ==');
{
  // The stored column wins; then the initials in the number; then whoever typed it. A wrong name
  // has to be traceable to the rule that produced it, or nobody can tell a bad rule from bad data.
  eq('stored column wins', run().resolved[0].ownerBasis, 'Salesperson column');
  eq('blank column falls back to the typist',
     run({ salesperson: '' }).resolved[0].ownerBasis, 'assumed from who created it');
  ok('and the typist still gets attributed',
     run({ salesperson: '' }).resolved[0].salesperson === 'Gerald Lucena');
}

console.log('\n== asking about ONE order ==');
{
  const r = run({}, { quotationNo: QUO });
  eq('the Mincon quotation answers for itself', r.resolved.length, 1);
  eq('  and says what it was scoped to', r.scope, 'quotation ' + QUO);
  eq('a quotation nobody sold returns nothing', run({}, { quotationNo: 'QTN-NOPE' }).totals.collections, 0);
  eq('by sales order works too', run({}, { soNo: SO }).resolved.length, 1);
  eq('  and a wrong SO returns nothing', run({}, { soNo: 'SO-NOPE' }).totals.collections, 0);

}

console.log('\n== THE REAL QUESTION: "why can Gerald not claim QTN-202607-005?" ==');
{
  /* This is the case that made the first cut of this handler wrong. Filtering collections and
     reporting only those returns an EMPTY list for an order nobody has paid yet — and an empty list
     is indistinguishable from "no such order". The answer has to walk the chain from the top and
     name the first link that is missing. */
  const paid = run({}, { quotationNo: QUO });
  eq('fully paid: nothing is blocking it', paid.order.blockedAt, '');
  ok('  and it says so with the cash and the name',
     /attributable to Gerald Lucena/.test(paid.order.summary), paid.order.summary);

  const unpaid = run({ noCollection: true }, { quotationNo: QUO });
  eq('no collection yet: blocked at the collection', unpaid.order.blockedAt, 'collection');
  ok('  and it does NOT say the order is missing',
     /no collection has been recorded/.test(unpaid.order.summary), unpaid.order.summary);
  ok('  it confirms the order and the owner ARE fine',
     unpaid.order.soExists === true && unpaid.order.salesperson === 'Gerald Lucena');

  const noSo = run({ noSo: true }, { quotationNo: QUO });
  eq('no sales order: blocked there instead', noSo.order.blockedAt, 'sales order');
  ok('  and says why that is terminal',
     /no collection can ever reach it/.test(noSo.order.summary), noSo.order.summary);

  const nobody = run({ salesperson: '', createdBy: '' }, { quotationNo: QUO });
  eq('nobody named: blocked at the owner', nobody.order.blockedAt, 'owner');
  ok('  and says there is nobody to pay',
     /nobody to pay/.test(nobody.order.summary), nobody.order.summary);

  const absent = run({ noQuote: true }, { quotationNo: QUO });
  eq('quotation not in the book at all', absent.order.blockedAt, 'quotation');

  // Asking by sales order finds its way to the same quotation and the same answer.
  const bySo = run({ noCollection: true }, { soNo: SO });
  eq('asking by sales order reaches the quotation', bySo.order.quotationNo, QUO);
  eq('  and gives the same verdict', bySo.order.blockedAt, 'collection');
}

console.log('\n== it writes nothing ==');
{
  const c = load(null, book());
  const before = JSON.stringify(c.__store);
  c.previewCommissionAttribution({});
  eq('the book is untouched', JSON.stringify(c.__store) === before, true);
}

console.log('\n== the commission hold covers it, like every other commission read ==');
{
  const c = load(null, book());
  ok('a role outside _COMM_ROLES is refused',
     !!c._featureBlocked('previewCommissionAttribution', { actorRole: 'accounting' }));
  ok('  and the director is let through',
     c._featureBlocked('previewCommissionAttribution', { actorRole: 'director' }) === null);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
