/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   month-check-model.js — A331. The pure engine behind the Month check page.

   No DOM, no fetch, no formatting: it takes what getMonthCheck returns (sales orders, invoices,
   receivables, payments with the EWT each should have carried, and the overrides used) and lists what
   accounting must look at before closing a month. tests/flow/month-check-model.js drives it with
   fixtures and with a snapshot of the live book.

   ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
   The 14 Oct 2026 reconciliation found, by hand, every kind of problem listed here: receivables
   imported twice (June and September), invoices at 0% VAT with nothing saying why, EWT taken on the
   total with VAT or left out, a real payment saved as a DEMO record, and invoices on one order billing
   ₱404,731 more than the order. FlowAPI 168 now blocks each of these unless a reason is given; this
   is the second half — what got through, and every reason that let it through, in one place.

   ── THE RULES (each matches the server's, so the page and a save never disagree) ─────────────────
   • Two receivables are one invoice recorded twice when they carry the same invoice number and the
     same amount — or the same number read without its prefix (INV-2026-0100 / 100) for the same
     customer, whatever the amounts: there is one invoice series, and a portal entry imported again
     usually carries a different basis (live: Philcement #100 at 63,192.88 and 63,762.19).
   • Two payments are one payment recorded twice when they settle the same receivable with the same
     amount on the same day, or carry the same cheque/reference for the same customer.
   • An invoice and its receivable are joined by number, then through the sales order only when
     exactly one invoice claims it — arReconcile()'s join (flow-ar-aging.js). And arReconcile's
     baseline (A249): an invoice dated before the AR ledger began is history, not a missing
     receivable, unless the app itself created it.
   • Billing is compared before VAT and without deposits, as createInvoice does, with ₱1 tolerance.
   • Expected EWT is the server's figure (_sgExpectedEwt); a difference above ₱1 is reported.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

var MC_EPS = 1;   // pesos — the server's tolerance (_sgEwtProblems, the billing cap)
var MC_PARTIAL_DAYS = 60;

var MC_RULE_LABEL = {
  ewtMissing: 'No EWT entered', ewtMismatch: 'EWT not as the rate gives', overCollect: 'More than the balance',
  zeroReceivable: 'Nothing was due', duplicatePayment: 'Payment looked recorded already',
  duplicateReference: 'Cheque or reference used before', overBilling: 'Billed above the order',
  duplicateInvoice: 'Invoice looked raised already', reinvoice: 'Order already invoiced',
  vatTypeMismatch: 'VAT type differs from the order', unknownCustomer: 'Customer not on the Clients list',
  bulkImport: 'Bulk import of payments'
};

function mcS(v) { return String(v == null ? '' : v).trim(); }
function mcN(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function mcR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function mcDay(d) { var s = mcS(d); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; }
function mcYM(d) { var s = mcDay(d); return s ? s.slice(0, 7) : ''; }
/** True when the date falls in the month; an empty month means the whole ledger. */
function mcInMonth(d, month) { return !month || mcYM(d) === month; }
function mcMonthEnd(month) {
  var y = +month.slice(0, 4), m = +month.slice(5, 7);
  var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return month + '-' + (last < 10 ? '0' : '') + last;
}
function mcAddDays(ymd, n) {
  var t = new Date(ymd + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** The invoice number read without its prefix: 'INV-2026-014' → '14', '00123' → '123'. */
function mcInvTail(no) { var p = mcS(no).split(/[-\s/]/); return (p[p.length - 1] || '').replace(/^0+/, '') || (mcS(no) ? '0' : ''); }
function mcCustKey(name) { return mcS(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 18); }
/** A cheque or reference exactly as the server compares it (_idNorm: case and leading zeros ignored);
 *  '' for one with no digit ("Per master AR ledger", "cash"), which identifies nothing. */
function mcRefKey(ref) { var k = mcS(ref).toLowerCase().replace(/^0+(?=.)/, ''); return /\d/.test(k) ? k : ''; }
function mcIsDemo() {
  for (var i = 0; i < arguments.length; i++) if (mcS(arguments[i]).toUpperCase().indexOf('DEMO-') === 0) return true;
  return false;
}
function mcMigrated(inv) { return mcS(inv.createdBy).indexOf('Migrated') === 0; }

/* Groups of two or more rows sharing a key; each group once, its rows in the order given. */
function mcGroups(rows, keyOf) {
  var by = {}, order = [];
  rows.forEach(function (r) {
    var k = keyOf(r);
    if (!k) return;
    if (!by[k]) { by[k] = []; order.push(k); }
    by[k].push(r);
  });
  return order.map(function (k) { return by[k]; }).filter(function (g) { return g.length > 1; });
}
/* Merge groups that share a member (by id), so one duplicate pair found two ways is listed once. */
function mcMerge(groups, idOf) {
  var out = [];
  groups.forEach(function (g) {
    var ids = g.map(idOf);
    var hit = out.filter(function (o) { return o.some(function (r) { return ids.indexOf(idOf(r)) >= 0; }); })[0];
    if (!hit) { out.push(g.slice()); return; }
    g.forEach(function (r) { if (!hit.some(function (x) { return idOf(x) === idOf(r); })) hit.push(r); });
  });
  return out;
}

/**
 * The checks for one month ('YYYY-MM'), or for the whole ledger when month is ''.
 * today ('YYYY-MM-DD') dates the 60-day test for the whole ledger and for a month not yet ended.
 * Returns { month, safeguards, checks: [{ key, title, why, items: [...] }], total }.
 */
function monthCheck(data, month, today) {
  data = data || {};
  month = mcS(month);
  var SO = (data.salesOrders || []).filter(Boolean);
  var INV = (data.invoices || []).filter(Boolean);
  var AR = (data.receivables || []).filter(Boolean);
  var COL = (data.collections || []).filter(Boolean);
  var OV = (data.overrides || []).filter(Boolean);
  var liveInv = INV.filter(function (v) { return !v.voided; });
  var liveCol = COL.filter(function (c) { return !c.voided; });
  var realAr = AR.filter(function (a) { return !mcIsDemo(a.arNo, a.soNo, a.invNo); });
  var realCol = liveCol.filter(function (c) { return !mcIsDemo(c.collectionNo, c.arNo, c.soNo); });
  var checks = [];
  var add = function (key, title, why, items) { checks.push({ key: key, title: title, why: why, items: items }); };

  /* 1 · receivables recorded twice */
  var arGroups = mcMerge(
    mcGroups(realAr, function (a) { return mcS(a.invNo) ? mcS(a.invNo) + '|' + mcR2(a.amount) : ''; })
      .concat(mcGroups(realAr, function (a) { return mcInvTail(a.invNo) ? mcInvTail(a.invNo) + '|' + mcCustKey(a.customer) : ''; })),
    function (a) { return a.arNo; });
  add('duplicateReceivables', 'Receivables recorded twice',
    'The same invoice and amount owed twice: the customer appears to owe it twice, and a payment can settle the wrong copy.',
    arGroups.filter(function (g) { return g.some(function (a) { return mcInMonth(a.createdAt, month); }); }).map(function (g) {
      return { ref: g.map(function (a) { return a.arNo; }).join(' and '), customer: g[0].customer, amount: mcR2(g[0].amount),
        date: g.map(function (a) { return mcDay(a.createdAt); }).join(' and '),
        detail: 'Invoice ' + g.map(function (a) { return a.invNo || '(none)'; }).join(' / ') +
          (g.every(function (a) { return mcR2(a.amount) === mcR2(g[0].amount); }) ? ', the same amount on each.'
            : ', for ' + g.map(function (a) { return mcR2(a.amount).toFixed(2); }).join(' and ') + ': the same invoice on a different basis?'),
        rows: g.map(function (a) { return a.arNo; }) };
    }));

  /* 2 · payments recorded twice */
  var colGroups = mcMerge(
    mcGroups(realCol, function (c) { return mcS(c.arNo) && mcDay(c.date) ? mcS(c.arNo) + '|' + mcR2(c.amount) + '|' + mcDay(c.date) : ''; })
      .concat(mcGroups(realCol, function (c) { return mcRefKey(c.ref) ? mcCustKey(c.customer) + '|' + mcRefKey(c.ref) : ''; })),
    function (c) { return c.collectionNo; });
  add('duplicatePayments', 'Payments recorded twice',
    'The same receivable, amount and day, or the same cheque or reference for the same customer. One of them may be counted twice.',
    colGroups.filter(function (g) { return g.some(function (c) { return mcInMonth(c.date, month); }); }).map(function (g) {
      var sameRef = mcRefKey(g[0].ref) && g.every(function (c) { return mcRefKey(c.ref) === mcRefKey(g[0].ref); });
      return { ref: g.map(function (c) { return c.collectionNo; }).join(' and '), customer: g[0].customer, amount: mcR2(g[0].amount),
        date: g.map(function (c) { return mcDay(c.date); }).join(' and '),
        detail: sameRef ? 'Reference ' + g[0].ref + ' on each.' : 'Receivable ' + g[0].arNo + ', the same amount and day.',
        rows: g.map(function (c) { return c.collectionNo; }) };
    }));

  /* 3 / 4 · invoices and receivables that do not meet (arReconcile's join) */
  var invByNo = {}, invBySo = {};
  liveInv.forEach(function (v) {
    if (mcS(v.invNo)) invByNo[mcS(v.invNo)] = v;
    if (mcS(v.soNo)) (invBySo[mcS(v.soNo)] = invBySo[mcS(v.soNo)] || []).push(v);
  });
  // arReconcile's baseline (A249): the AR ledger begins on its first receivable
  var baseline = realAr.map(function (a) { return mcDay(a.createdAt); }).filter(Boolean).sort()[0] || '';
  var claimed = {}, orphanAr = [];
  realAr.forEach(function (a) {
    if (invByNo[mcS(a.invNo)]) { claimed[mcS(a.invNo)] = 1; return; }
    var m = invBySo[mcS(a.soNo)];
    if (mcS(a.soNo) && m && m.length === 1) { claimed[mcS(m[0].invNo)] = 1; return; }
    orphanAr.push(a);
  });
  add('invoiceNoReceivable', 'Invoices with no receivable',
    'Billed, but nothing says the customer owes it, so it can never be collected or chased.',
    liveInv.filter(function (v) {
      return mcInMonth(v.date, month) && !claimed[mcS(v.invNo)] && !mcIsDemo(v.invNo, v.soNo) &&
             (!mcMigrated(v) || (baseline && mcDay(v.date) >= baseline));
    })
      .map(function (v) {
        return { ref: v.invNo, customer: v.customer, date: mcDay(v.date), amount: mcR2(mcN(v.totalSales) + mcN(v.vat) + mcN(v.deposit)),
          detail: 'Sales order ' + (v.soNo || '(none)') + '.' };
      }));
  add('receivableNoInvoice', 'Receivables with no invoice',
    'A balance that no invoice on file supports. The EWT on its payments cannot be checked either.',
    orphanAr.filter(function (a) { return mcInMonth(a.createdAt, month); }).map(function (a) {
      return { ref: a.arNo, customer: a.customer, date: mcDay(a.createdAt), amount: mcR2(a.amount),
        detail: a.invNo ? 'Invoice ' + a.invNo + ' is not on file (or was voided).' : 'No invoice number.' };
    }));

  /* 5 · orders invoiced above their total (before VAT, deposits aside — createInvoice's sum) */
  var soByNo = {};
  SO.forEach(function (o) { soByNo[mcS(o.soNo)] = o; });
  var over = [];
  Object.keys(invBySo).forEach(function (soNo) {
    var o = soByNo[soNo], list = invBySo[soNo];
    if (!o || mcIsDemo(soNo)) return;
    var total = mcN(o.total), billed = mcR2(list.reduce(function (t, v) { return t + mcN(v.totalSales); }, 0));
    if (!(total > 0) || billed <= total + MC_EPS) return;
    if (!list.some(function (v) { return mcInMonth(v.date, month); })) return;
    over.push({ ref: soNo, customer: o.customer, date: list.map(function (v) { return mcDay(v.date); }).sort().pop(), amount: mcR2(billed - total),
      detail: 'Order ' + mcR2(total).toFixed(2) + ', invoiced ' + billed.toFixed(2) + ' on ' + list.map(function (v) { return v.invNo; }).join(', ') + ' (before VAT).' });
  });
  add('overBilled', 'Orders invoiced above their total', 'The customer has been billed more than the order they placed.', over);

  /* 6 · VAT type missing — invoices, then orders */
  var vatInv = [], vatSo = [];
  liveInv.forEach(function (v) {
    if (!mcInMonth(v.date, month) || mcS(v.vatType) || mcIsDemo(v.invNo)) return;
    var rate = v.vatRate == null || v.vatRate === '' ? null : mcN(v.vatRate);
    if (rate !== null && rate > 0) return;   // 12% charged: the type is plain from the rate
    vatInv.push({ ref: v.invNo, customer: v.customer, date: mcDay(v.date), amount: mcR2(v.totalSales),
      detail: (rate === 0 ? '0% VAT' : 'No VAT rate') + ' and no VAT type: zero-rated, exempt, or VAT left out?' });
  });
  SO.forEach(function (o) {
    if (!mcInMonth(o.date, month) || mcS(o.vatType) || mcIsDemo(o.soNo)) return;
    vatSo.push({ ref: o.soNo, customer: o.customer, date: mcDay(o.date), amount: mcR2(o.total),
      detail: 'Is this total before VAT or with VAT? Set the VAT type on the order.' });
  });
  add('invoiceVatMissing', 'Invoices at 0% with no VAT type',
    'Nobody can tell whether 0% means zero-rated, exempt, or a VAT that was never charged, and the VAT return needs to know.', vatInv);
  add('orderVatMissing', 'Sales orders with no VAT type',
    'Without it an order\u2019s total can be read as before or after VAT, which is how orders and invoices stopped agreeing.', vatSo);

  /* 7 · EWT not what the customer's rate gives */
  var ovBy = {};
  OV.forEach(function (o) { var k = mcS(o.refNo) + '|' + mcS(o.rule); (ovBy[k] = ovBy[k] || []).push(o); });
  var reasonFor = function (ref, rules) {
    var hit = [];
    String(ref || '').split(/,\s*/).forEach(function (r) { rules.forEach(function (rule) { hit = hit.concat(ovBy[mcS(r) + '|' + rule] || []); }); });
    return hit.length ? hit[hit.length - 1].reason : '';
  };
  add('ewtOff', 'EWT different from the customer’s rate',
    'Withholding tax on the total with VAT, or none at all, leaves the receivable or the 2307 claim wrong.',
    realCol.filter(function (c) {
      if (!mcInMonth(c.date, month) || c.expectedEwt == null) return false;
      var exp = mcN(c.expectedEwt), ewt = mcN(c.ewt);
      return (exp > MC_EPS && !(ewt > 0.005)) || Math.abs(ewt - exp) > MC_EPS;
    }).map(function (c) {
      var why = reasonFor(c.arNo, ['ewtMissing', 'ewtMismatch']);
      return { ref: c.collectionNo, customer: c.customer, date: mcDay(c.date), amount: mcR2(c.amount),
        expected: mcR2(c.expectedEwt), entered: mcR2(c.ewt),
        detail: 'Expected EWT ' + mcR2(c.expectedEwt).toFixed(2) + ', recorded ' + mcR2(c.ewt).toFixed(2) + '.' + (why ? ' Reason given: ' + why : '') };
    }));

  /* 8 · EWT with no 2307 on file */
  add('no2307', 'EWT with no 2307 on file', 'The tax credit is claimed only with the customer’s BIR Form 2307. Attach it to the payment or the receivable.',
    realCol.filter(function (c) { return mcInMonth(c.date, month) && mcN(c.ewt) > 0.005 && !c.has2307; }).map(function (c) {
      return { ref: c.collectionNo, customer: c.customer, date: mcDay(c.date), amount: mcR2(c.ewt), detail: 'Receivable ' + c.arNo + '.' };
    }));

  /* 9 · partly paid, and left that way for more than 60 days (as of the month's end, or today) */
  var asOf = month ? mcMonthEnd(month) : mcDay(today);
  if (today && mcDay(today) && asOf > mcDay(today)) asOf = mcDay(today);
  var cutoff = asOf ? mcAddDays(asOf, -MC_PARTIAL_DAYS) : '';
  add('partialOld', 'Partly paid for more than ' + MC_PARTIAL_DAYS + ' days',
    'Part of the invoice was paid long ago and the rest never came: a short payment, a missed EWT, or a duplicate.',
    cutoff ? realAr.filter(function (a) {
      var paid = mcN(a.collected), left = mcN(a.amount) - paid, since = mcDay(a.dueDate) || mcDay(a.createdAt);
      return paid > 0.005 && left > MC_EPS && since && since <= cutoff;
    }).map(function (a) {
      return { ref: a.arNo, customer: a.customer, date: mcDay(a.dueDate) || mcDay(a.createdAt), amount: mcR2(mcN(a.amount) - mcN(a.collected)),
        detail: 'Paid ' + mcR2(a.collected).toFixed(2) + ' of ' + mcR2(a.amount).toFixed(2) + ' (invoice ' + (a.invNo || '—') + ').' };
    }) : []);

  /* 10 · every override used */
  add('overrides', 'Saved with a reason', 'Each save that broke a check, with who did it and why. Confirm each reason holds.',
    OV.filter(function (o) { return mcInMonth(o.at, month); }).map(function (o) {
      var num = function (v) { return typeof v === 'number' || (mcS(v) !== '' && !isNaN(+v)) ? mcR2(v).toFixed(2) : mcS(v); };
      return { ref: o.refNo, customer: o.user + (o.role ? ' (' + o.role + ')' : ''), date: mcDay(o.at), amount: null,
        rule: o.rule, reason: o.reason,
        detail: (MC_RULE_LABEL[o.rule] || o.rule) + (mcS(o.expected) !== '' || mcS(o.entered) !== '' ? ': expected ' + num(o.expected) + ', entered ' + num(o.entered) : '') +
                '. Reason: ' + (o.reason || '—') };
    }));

  /* 11 · demo records in the live data (any month: there should be none at all) */
  var demo = [];
  SO.forEach(function (o) { if (mcIsDemo(o.soNo)) demo.push({ ref: o.soNo, customer: o.customer, date: mcDay(o.date), amount: mcR2(o.total), detail: 'Sales order.' }); });
  INV.forEach(function (v) { if (mcIsDemo(v.invNo, v.soNo)) demo.push({ ref: v.invNo, customer: v.customer, date: mcDay(v.date), amount: mcR2(v.totalSales), detail: 'Invoice on ' + v.soNo + '.' }); });
  AR.forEach(function (a) { if (mcIsDemo(a.arNo, a.soNo, a.invNo)) demo.push({ ref: a.arNo, customer: a.customer, date: mcDay(a.createdAt), amount: mcR2(a.amount), detail: 'Receivable.' }); });
  COL.forEach(function (c) { if (!c.voided && mcIsDemo(c.collectionNo, c.arNo, c.soNo)) demo.push({ ref: c.collectionNo, customer: c.customer, date: mcDay(c.date), amount: mcR2(c.amount), detail: 'Payment. If it is real, record it again properly and void this one.' }); });
  add('demo', 'Demo records in the live data', 'Demo data counts as real money in totals, the books and commissions.', demo);

  var total = checks.reduce(function (t, c) { return t + c.items.length; }, 0);
  return { month: month, asOf: asOf, safeguards: data.safeguards !== false, checks: checks, total: total };
}

/** Months that have any order, invoice, receivable, payment or override, newest first. */
function mcMonths(data) {
  data = data || {};
  var seen = {};
  (data.salesOrders || []).forEach(function (o) { var m = mcYM(o.date); if (m) seen[m] = 1; });
  (data.invoices || []).forEach(function (v) { var m = mcYM(v.date); if (m) seen[m] = 1; });
  (data.receivables || []).forEach(function (a) { var m = mcYM(a.createdAt); if (m) seen[m] = 1; });
  (data.collections || []).forEach(function (c) { var m = mcYM(c.date); if (m) seen[m] = 1; });
  (data.overrides || []).forEach(function (o) { var m = mcYM(o.at); if (m) seen[m] = 1; });
  return Object.keys(seen).sort().reverse();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { monthCheck: monthCheck, mcMonths: mcMonths, mcInvTail: mcInvTail, mcRefKey: mcRefKey, mcCustKey: mcCustKey,
                     mcMonthEnd: mcMonthEnd, mcAddDays: mcAddDays, MC_EPS: MC_EPS, MC_RULE_LABEL: MC_RULE_LABEL };
}
