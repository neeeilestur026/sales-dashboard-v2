/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   ap-monthly-model.js — A245. The pure engine behind the Monthly AP Aging report.

   No DOM, no fetch, no formatting: it takes the two row sets and answers two questions, so the
   arithmetic can be tested directly the way quotation-board-model.js and pr-worklist.js are.

   ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────────────────────────
   APAging['Paid (PHP)'] is a single CUMULATIVE scalar with no date of its own, and 'Updated At' is
   bumped by any write at all. So AP Aging alone cannot say which month a payment fell in, and every
   existing surface that appears to answer it does not: accounting-summary.js captions a tile "AP Paid
   (period)" while bucketing by 'Created At', which means "payables RAISED this month, and their
   lifetime paid total" — a different number from cash paid this month.

   The only per-payment dated record is the PaymentRequests row. The Journal cannot substitute:
   _postJournal is idempotent per (source, sourceNo) and posts the RUNNING TOTAL at _now(), so a July
   partial followed by an August one leaves a single August entry and July is erased.

   ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
   Per payable, the AP row's Paid (PHP) stays authoritative and is never recomputed. It is SPLIT for
   dating only:
       explained  — each PAID PaymentRequest of Type 'PO' for this PO, at its own recorded date
       remainder  — whatever Paid (PHP) exceeds that, dated by 'Updated At' and marked INFERRED
   Across all months the slices sum exactly to Σ Paid (PHP). That identity is the point, and it is
   asserted in tests/flow/ap-monthly.js against the live book.

   On the live book at the time of writing, 75% of the paid total is inferred (₱551,978 of ₱737,944):
   of 8 settled payables 3 have no linked request at all and 2 link to one not itself marked paid.
   Reporting a confident monthly figure over that would be lying by omission, which is why every
   slice carries its basis and the caller is expected to show it.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

var APM_EPS = 0.005;                 // same tolerance payment-register.js uses; a bank charge can be small

function _apmNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
function _apmStr(v) { return String(v == null ? '' : v).trim(); }

/** 'YYYY-MM' from anything date-ish, or ''. Mirrors flowLedgerYM. */
function apmYM(v) {
  var s = _apmStr(v);
  if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  var d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** 'YYYY-MM-DD' from anything date-ish, or ''. */
function apmDay(v) {
  var s = _apmStr(v);
  if (!s) return '';
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  var d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

/* What a paid request actually SETTLED, in pesos.
   The bank charge is subtracted because it is OUR cost and must never count as settling the supplier
   — A219 found ₱2,070.60 and ₱465.77 of exactly this folded into "paid" with nowhere else to go.
   Same rule payment-register.js already implements. */
function apmSettled(pr) {
  var debited = _apmNum(pr.actualDebitedPHP);
  var charge = _apmNum(pr.bankChargePHP);
  return debited > 0 ? (debited - charge) : _apmNum(pr.amount);
}

/**
 * Every dated slice of AP money, and the payables they belong to.
 *
 * @param apRows getAPAging().data
 * @param prRows getPaymentRequests().data
 * @return {{slices: Array, payables: Array, totalPaid: number}}
 */
function apmSlices(apRows, prRows) {
  apRows = apRows || []; prRows = prRows || [];

  /* GUARD 1 — key payables by their PO, because that is what a payment names. A blank PO can never
     be a join key: a Type:'Other' request has no PO either, and '' === '' would attach every one of
     them to every unkeyed payable. _prTargetAp refuses an empty poNo for the same reason. Blank-PO
     payables therefore get a key of their own that no request can match. */
  var payables = apRows.filter(function (a) { return a && typeof a === 'object'; }).map(function (a) {
    var po = _apmStr(a.poNo);
    return {
      apNo: _apmStr(a.apNo), poNo: po, supplier: _apmStr(a.supplier) || '(no supplier)',
      currency: _apmStr(a.currency) || 'PHP',
      amountFC: _apmNum(a.amountFC), amountPHP: _apmNum(a.amountPHP), paidPHP: _apmNum(a.paidPHP),
      status: _apmStr(a.status), dueDate: apmDay(a.dueDate), createdAt: apmDay(a.createdAt),
      updatedAt: apmDay(a.updatedAt),
      key: po ? ('PO:' + po) : ('AP:' + _apmStr(a.apNo)),
      joinable: !!po, flags: []
    };
  });

  /* GUARD 2 — one payment is attributed ONCE. _linkPrToAp stamps a request onto EVERY AP row for its
     PO and _prTargetAp only refuses multi-row POs when Amount (PHP) > 0, so a zero-amount sibling
     escapes. Walking payables and pulling in matching requests would fan one payment across them all,
     doubling the month. So requests are walked ONCE and land on a single owner: the first payable for
     that PO, ordered by AP No. Any sibling is flagged rather than silently ignored. */
  var owner = {}, siblings = {};
  payables.slice().sort(function (x, y) { return x.apNo < y.apNo ? -1 : x.apNo > y.apNo ? 1 : 0; })
    .forEach(function (p) {
      if (!p.joinable) { owner[p.key] = p; return; }
      if (owner[p.key]) { (siblings[p.key] = siblings[p.key] || []).push(p); }
      else owner[p.key] = p;
    });
  Object.keys(siblings).forEach(function (k) {
    owner[k].flags.push('shares-po');
    siblings[k].forEach(function (p) { p.flags.push('shares-po'); });
  });

  var slices = [], explained = {};
  prRows.forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    if (_apmStr(r.status) !== 'Paid') return;
    // GUARD 3 — only a PO request ever reaches AP. A Type:'Other' payment writes an Expenses row and
    // never touches a payable; counting it here would also count it twice against that sheet.
    if (_apmStr(r.type) !== 'PO') return;
    var po = _apmStr(r.poNo);
    if (!po) return;                                   // no key, no attribution — never guess
    var p = owner['PO:' + po];
    if (!p) return;                                    // a payment for a PO with no payable row
    var amt = apmSettled(r);
    if (Math.abs(amt) < APM_EPS) return;
    /* GUARD 4 — keep BOTH dates. Value Date is sent only for FX and the control is prefilled with
       today, so most "bank dates" are the click date wearing another label. Value Date still wins
       when present — it is the bank's — but a payment clicked 31 Jul with a 2 Aug value date sits
       genuinely astride a month boundary, and both are kept so that choice stays auditable. */
    var when = apmDay(r.valueDate) || apmDay(r.paidAt);
    var s = {
      key: p.key, apNo: p.apNo, poNo: po, supplier: p.supplier, prNo: _apmStr(r.prNo),
      amount: amt, day: when, ym: apmYM(when), basis: 'recorded',
      paidAt: apmDay(r.paidAt), valueDate: apmDay(r.valueDate), flags: []
    };
    // GUARD 5 — under confirmNoActual `settles` falls back to Amount, which on an FX request is
    // FOREIGN units sitting in a peso column. AP and the request still agree so the split balances,
    // but the month would be understated ~60x. Flag it rather than trust it.
    if (_apmStr(r.currency) && _apmStr(r.currency) !== 'PHP' && !(_apmNum(r.actualDebitedPHP) > 0)) {
      s.flags.push('fc-amount-unconverted');
    }
    if (!when) s.flags.push('no-date');
    slices.push(s);
    explained[p.key] = (explained[p.key] || 0) + amt;
  });

  /* The remainder: what the AP row says was paid, beyond what any request explains. This is the money
     recorded straight onto the AP page — ₱431,029.51 of the live book, which a report reading only
     PaymentRequests would miss entirely while looking authoritative. */
  payables.forEach(function (p) {
    var exp = explained[p.key] || 0;
    // Only the OWNER of a shared PO carries the group's paid total, or the remainder is counted twice.
    var apPaid = p.paidPHP;
    if (p.joinable && owner[p.key] !== p) { return; }
    var rem = Math.round((apPaid - exp) * 100) / 100;
    if (Math.abs(rem) < APM_EPS) return;
    /* GUARD 6 — a NEGATIVE remainder is reachable and must not be clamped. revisePaymentRequest
       refuses a paid request and directs the user to "record a correction on AP Aging instead";
       updateAPAging then OVERWRITES Paid (PHP) with no floor. Clamping to zero would quietly break
       the slices-sum-to-total identity, which is the one thing making this report trustworthy. It is
       surfaced instead, with both figures, so a person can see the correction rather than absorb it. */
    var s = {
      key: p.key, apNo: p.apNo, poNo: p.poNo, supplier: p.supplier, prNo: '',
      amount: rem, day: p.updatedAt, ym: apmYM(p.updatedAt), basis: 'inferred',
      paidAt: '', valueDate: '', flags: []
    };
    if (rem < 0) { s.flags.push('over-explained'); s.explained = exp; s.apPaid = apPaid; }
    if (!p.updatedAt) s.flags.push('no-date');
    slices.push(s);
  });

  var totalPaid = payables.reduce(function (t, p) { return t + p.paidPHP; }, 0);
  return { slices: slices, payables: payables,
           totalPaid: Math.round(totalPaid * 100) / 100 };
}

/** Aging bucket for a number of days overdue. */
function apmBucket(days) {
  if (days === null || days === undefined) return 'no-date';
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

var APM_BUCKETS = ['Current', '1-30', '31-60', '61-90', '90+', 'no-date'];

function _apmDaysBetween(fromDay, toDay) {
  if (!fromDay || !toDay) return null;
  var a = new Date(fromDay + 'T00:00:00Z'), b = new Date(toDay + 'T00:00:00Z');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

/** Last calendar day of a 'YYYY-MM'. */
function apmMonthEnd(ym) {
  var m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2], 0));       // day 0 of the NEXT month = last of this one
  return m[1] + '-' + m[2] + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/**
 * One month's report.
 *
 * `paid` is what settled DURING the month. `open` is what was still owed AT ITS END — reconstructed
 * from the same slices rather than read off Status, because Status is a LIVE label: filtering on
 * `status !== 'Paid'` to ask "what was open at 31 July" wrongly drops everything settled in August,
 * since it reads as settled today. One engine drives both halves so they cannot disagree.
 */
function apmMonth(built, ym) {
  var slices = (built && built.slices) || [], payables = (built && built.payables) || [];
  var end = apmMonthEnd(ym);

  var paidRows = slices.filter(function (s) { return ym ? s.ym === ym : true; });
  var paidTotal = paidRows.reduce(function (t, s) { return t + s.amount; }, 0);
  var inferredTotal = paidRows.filter(function (s) { return s.basis === 'inferred'; })
    .reduce(function (t, s) { return t + s.amount; }, 0);

  // Paid, grouped by supplier.
  var bySup = {};
  paidRows.forEach(function (s) {
    var g = bySup[s.supplier] || (bySup[s.supplier] = { supplier: s.supplier, total: 0, inferred: 0, rows: [] });
    g.total += s.amount;
    if (s.basis === 'inferred') g.inferred += s.amount;
    g.rows.push(s);
  });

  /* Outstanding AT MONTH END = the payable less everything paid on or before that date. */
  var paidByKeyToDate = {};
  slices.forEach(function (s) {
    if (!end || (s.day && s.day <= end)) paidByKeyToDate[s.key] = (paidByKeyToDate[s.key] || 0) + s.amount;
  });

  var openRows = [], openTotal = 0, buckets = {}, estimateGaps = [];
  APM_BUCKETS.forEach(function (b) { buckets[b] = 0; });
  payables.forEach(function (p) {
    if (end && p.createdAt && p.createdAt > end) return;              // not raised yet
    var settled = paidByKeyToDate[p.key] || 0;
    // A shared PO's paid total sits on its owner; a sibling would otherwise look wholly unpaid.
    var outstanding = Math.round((p.amountPHP - settled) * 100) / 100;
    if (outstanding <= APM_EPS) return;
    /* A222 — A FOREIGN PAYABLE IS SETTLED WHEN THE OBLIGATION IS, NOT WHEN THE PESO ESTIMATE IS MET.
       Amount (PHP) on a foreign row is an ESTIMATE typed at PO time; the pesos that actually left are
       whatever the bank gave on the day. Judging "still open" by subtracting one from the other gets
       it wrong in both directions — a better rate leaves a fully settled order looking permanently
       part-paid, a worse one closes it early. On this book that alone invented ₱400,000 of debt on an
       order already marked Paid. So a foreign payable whose status says Paid, and whose payments had
       all happened by the month-end being asked about, is settled — and the peso gap is reported as
       an estimate discrepancy rather than as money owed. A PHP payable is unaffected: there the
       payable IS the obligation, so the arithmetic above is exactly right. */
    if (p.currency !== 'PHP' && p.status === 'Paid' && settled > APM_EPS) {
      estimateGaps.push({ apNo: p.apNo, supplier: p.supplier, poNo: p.poNo, currency: p.currency,
        amountFC: p.amountFC, amountPHP: p.amountPHP, paidToDate: settled, gap: outstanding,
        impliedRate: (p.amountFC > 0 && p.amountPHP > 0)
          ? Math.round((p.amountPHP / p.amountFC) * 100) / 100 : null });
      return;
    }
    /* Aging basis: the due date when somebody recorded one, otherwise the date the payable was
       raised — Due Date is populated on 1 of 11 live rows, so bucketing on it alone says nothing.
       The row records which basis it used so the page can state it rather than imply it. */
    var basisDay = p.dueDate || p.createdAt;
    var row = {
      apNo: p.apNo, poNo: p.poNo, supplier: p.supplier, currency: p.currency,
      amountFC: p.amountFC, amountPHP: p.amountPHP, paidToDate: settled, outstanding: outstanding,
      ageBasis: p.dueDate ? 'due' : 'raised', ageDay: basisDay,
      days: _apmDaysBetween(basisDay, end), flags: p.flags.slice()
    };
    row.bucket = apmBucket(row.days);
    /* The implied rate, shown rather than validated — there is no defined rate to check against, but
       a person spots ₱619.99/USD instantly when it is on the screen and never when it is not. */
    if (p.currency !== 'PHP' && p.amountFC > 0 && p.amountPHP > 0) {
      row.impliedRate = Math.round((p.amountPHP / p.amountFC) * 100) / 100;
      if (row.impliedRate < 20 || row.impliedRate > 200) row.flags.push('rate-out-of-band');
    }
    if (p.currency !== 'PHP' && !(p.amountPHP > 0)) row.flags.push('no-peso-figure');
    openRows.push(row);
    openTotal += outstanding;
    buckets[row.bucket] += outstanding;
  });

  var openBySup = {};
  openRows.forEach(function (r) {
    var g = openBySup[r.supplier] || (openBySup[r.supplier] = { supplier: r.supplier, total: 0, rows: [] });
    g.total += r.outstanding; g.rows.push(r);
  });

  var r2 = function (n) { return Math.round(n * 100) / 100; };
  return {
    ym: ym || '', monthEnd: end,
    paid: { total: r2(paidTotal), inferred: r2(inferredTotal),
            recorded: r2(paidTotal - inferredTotal),
            inferredCount: paidRows.filter(function (s) { return s.basis === 'inferred'; }).length,
            rows: paidRows,
            groups: Object.keys(bySup).sort().map(function (k) {
              bySup[k].total = r2(bySup[k].total); bySup[k].inferred = r2(bySup[k].inferred);
              return bySup[k];
            }) },
    /* Foreign payables settled on the obligation whose peso estimate does not match what was paid.
       Not debt, and not an error either — a bank rate moved. Shown so a person can see the gap, and
       so an implausible one (AP-202607-001 at ₱619.99/USD) is impossible to miss. */
    estimateGaps: estimateGaps,
    open: { total: r2(openTotal), rows: openRows, buckets: buckets,
            groups: Object.keys(openBySup).sort().map(function (k) {
              openBySup[k].total = r2(openBySup[k].total); return openBySup[k];
            }) }
  };
}

/** Every 'YYYY-MM' the slices touch, newest first — the month selector's options. */
function apmMonths(built) {
  var seen = {};
  ((built && built.slices) || []).forEach(function (s) { if (s.ym) seen[s.ym] = 1; });
  ((built && built.payables) || []).forEach(function (p) {
    var m = apmYM(p.createdAt); if (m) seen[m] = 1;
  });
  return Object.keys(seen).sort().reverse();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { apmSlices: apmSlices, apmMonth: apmMonth, apmMonths: apmMonths,
                     apmYM: apmYM, apmDay: apmDay, apmSettled: apmSettled, apmBucket: apmBucket,
                     apmMonthEnd: apmMonthEnd, APM_BUCKETS: APM_BUCKETS, APM_EPS: APM_EPS };
}
