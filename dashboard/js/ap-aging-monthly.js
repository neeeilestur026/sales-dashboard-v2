/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   ap-aging-monthly.js — A245. The page. All arithmetic lives in ap-monthly-model.js.

   Two sections for a chosen month: what SETTLED during it, and what was still OWED at its end.
   Neither figure existed anywhere before — flow-ap-aging.html is a live worklist filtered by when a
   payable was RAISED, and accounting-summary's "AP Paid (period)" tile buckets the same way, so it
   actually reports "payables raised this month and their lifetime paid total".

   THE ONE RULE THIS PAGE MUST NOT BREAK (A157, flow-ledger-view.js:3-16): the headline totals cover
   exactly the rows the tables list, and every table prints a totals footer so the column visibly adds
   up to the KPI instead of being taken on trust.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

let apmSession = null;
let apmBuilt = null;              // apmSlices() output, rebuilt only on load
let apmRaw = { ap: [], pr: [] };

const _e = s => (typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s));
const _m = v => (typeof flowMoney === 'function' ? flowMoney(v, 'PHP') : '₱' + Number(v || 0).toFixed(2));
const _fc = (v, cur) => (typeof flowMoney === 'function' ? flowMoney(v, cur || 'PHP')
                                                         : (cur || '') + ' ' + Number(v || 0).toFixed(2));

document.addEventListener('DOMContentLoaded', async () => {
  apmSession = requireOversight();
  if (!apmSession) return;
  renderNavbar('ap-aging-monthly');
  document.getElementById('apmRefresh').addEventListener('click', () => load(true));
  document.getElementById('apmPrint').addEventListener('click', () => window.print());
  document.getElementById('apmMonth').addEventListener('change', render);
  await load(false);
});

async function load(fresh) {
  const body = document.getElementById('apmBody');
  body.innerHTML = '<div class="dr-empty">Loading…</div>';
  // Same guard balance-sheet.js opens with: an unconfigured backend is a sentence, not a stack trace.
  if (typeof _flowConfigured !== 'function' || !_flowConfigured()) {
    body.innerHTML = '<div class="dr-empty">Process Flow backend is not configured.</div>';
    return;
  }
  try {
    const opt = fresh ? { fresh: true } : {};
    const [ap, pr] = await Promise.all([
      fetchFlow('getAPAging', {}, opt).catch(() => ({ data: [] })),
      fetchFlow('getPaymentRequests', {}, opt).catch(() => ({ data: [] })),
    ]);
    apmRaw = { ap: (ap && ap.data) || [], pr: (pr && pr.data) || [] };
    apmBuilt = apmSlices(apmRaw.ap, apmRaw.pr);
    buildMonths();
    render();
  } catch (e) {
    body.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${_e(e.message || 'Could not load')}</div>`;
  }
}

/* Months come FROM THE DATA, newest first — the same rule flowLedgerBuildPeriod follows, and for the
   same reason: a hardcoded list offers months that never happened and hides ones that did. */
function buildMonths() {
  const sel = document.getElementById('apmMonth');
  const keep = sel.value;
  const months = apmMonths(apmBuilt);
  sel.innerHTML = months.map(m => `<option value="${_e(m)}">${_e(monthLabel(m))}</option>`).join('')
                || '<option value="">No data</option>';
  if (keep && months.indexOf(keep) >= 0) sel.value = keep;
}

function monthLabel(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym || '—';
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
  return names[+m[2] - 1] + ' ' + m[1];
}

function render() {
  const ym = document.getElementById('apmMonth').value;
  const body = document.getElementById('apmBody');
  if (!apmBuilt || !ym) { body.innerHTML = '<div class="dr-empty">No AP records to report.</div>'; return; }
  const r = apmMonth(apmBuilt, ym);

  document.getElementById('apmMeta').textContent =
    `${monthLabel(ym)} · settled during the month, and still owed at ${r.monthEnd} · ` +
    `${apmRaw.ap.length} payables on the book`;

  body.innerHTML = kpis(r) + honesty(r) + paidSection(r) + openSection(r) + gapSection(r);
}

/* ── the headline figures ─────────────────────────────────────────────────────────────────────── */
function kpis(r) {
  const b = r.open.buckets;
  const overdue = (b['1-30'] || 0) + (b['31-60'] || 0) + (b['61-90'] || 0) + (b['90+'] || 0);
  return `<div class="apm-kpis">
    <div class="apm-kpi paid"><div class="l">Paid this month</div><div class="v">${_m(r.paid.total)}</div>
      <div class="d">${r.paid.rows.length} payment(s)</div></div>
    <div class="apm-kpi"><div class="l">of which recorded</div><div class="v">${_m(r.paid.recorded)}</div>
      <div class="d">has a real payment date</div></div>
    <div class="apm-kpi"><div class="l">of which inferred</div><div class="v">${_m(r.paid.inferred)}</div>
      <div class="d">${r.paid.inferredCount} row(s) dated by inference</div></div>
    <div class="apm-kpi open"><div class="l">Open at ${_e(r.monthEnd)}</div><div class="v">${_m(r.open.total)}</div>
      <div class="d">${r.open.rows.length} payable(s)</div></div>
    <div class="apm-kpi open"><div class="l">of which overdue</div><div class="v">${_m(overdue)}</div>
      <div class="d">past its aging basis</div></div>
  </div>`;
}

/* ── the caveat, stated up front rather than discovered ───────────────────────────────────────── */
function honesty(r) {
  const out = [];
  if (r.paid.inferred > 0.005) {
    const pct = r.paid.total ? Math.round((r.paid.inferred / r.paid.total) * 100) : 0;
    out.push(`<div class="apm-banner"><strong>${pct}% of this month's paid total has an inferred date.</strong>
      AP Aging records a running total with no date of its own, so a payment is dated precisely only
      when a Payment Request records it. ${r.paid.inferredCount} row(s) here fall back to the date the
      payable was last updated, and are marked <span class="apm-inferred">inferred</span> below.</div>`);
  }
  const neg = r.paid.rows.filter(s => (s.flags || []).indexOf('over-explained') >= 0);
  if (neg.length) {
    out.push(`<div class="apm-banner bad"><strong>${neg.length} payable(s) show more paid through
      Payment Requests than AP Aging records.</strong> That happens when a payment is corrected
      directly on the AP page. Shown as a negative amount rather than hidden, so the correction is
      visible: ${neg.map(s => `${_e(s.apNo)} (requests ${_m(s.explained)} vs AP ${_m(s.apPaid)})`).join(', ')}.</div>`);
  }
  const fcFlag = r.paid.rows.filter(s => (s.flags || []).indexOf('fc-amount-unconverted') >= 0);
  if (fcFlag.length) {
    out.push(`<div class="apm-banner bad"><strong>${fcFlag.length} payment(s) may be recorded in
      foreign units in a peso column.</strong> The request is not in pesos and no actual debited
      amount was captured, so the figure could understate the month substantially. Check
      ${fcFlag.map(s => _e(s.apNo)).join(', ')}.</div>`);
  }
  return out.join('');
}

/* ── section 1 · what settled during the month ────────────────────────────────────────────────── */
function paidSection(r) {
  if (!r.paid.groups.length) {
    return sec('Paid during the month', 'by supplier',
      '<p class="apm-muted">Nothing was recorded as paid in this month.</p>');
  }
  const groups = r.paid.groups.slice().sort((a, b) => b.total - a.total).map(g => `
    <details class="apm-grp">
      <summary><span class="g-name">${_e(g.supplier)}</span>
        <span class="g-n">${g.rows.length} payment(s)${g.inferred > 0.005
          ? ` · <span class="apm-inferred">${_m(g.inferred)} inferred</span>` : ''}</span>
        <span class="g-v">${_m(g.total)}</span></summary>
      <div class="apm-grp-body">
        <table class="flow-table flow-items">
          <thead><tr><th>AP No</th><th>PO</th><th>Payment Ref</th><th>Date</th>
            <th class="num">Amount</th></tr></thead>
          <tbody>${g.rows.slice().sort((a, b) => String(a.day).localeCompare(String(b.day)))
            .map(paidRow).join('')}
            ${footRow(4, g.total)}
          </tbody>
        </table>
      </div>
    </details>`).join('');
  return sec('Paid during the month', 'by supplier · click a supplier for its payments',
    groups + `<div class="apm-note">Total ${_m(r.paid.total)} across ${r.paid.groups.length} supplier(s)
      — the same rows listed above, nothing excluded.</div>`);
}

function paidRow(s) {
  const inferred = s.basis === 'inferred';
  const dateCell = inferred
    ? `${_e(s.day) || '—'} <span class="apm-inferred">inferred</span>`
    : `${_e(s.day)}${s.valueDate && s.paidAt && s.valueDate !== s.paidAt
        ? ` <span class="apm-muted" title="Bank value date; clicked ${_e(s.paidAt)}">bank date</span>` : ''}`;
  const warn = (s.flags || []).indexOf('over-explained') >= 0
    ? ' <span class="apm-warn">correction</span>' : '';
  return `<tr>
    <td>${_e(s.apNo)}${warn}</td>
    <td class="apm-muted">${_e(s.poNo) || '—'}</td>
    <td class="apm-muted">${_e(s.prNo) || (inferred ? 'recorded on AP Aging' : '—')}</td>
    <td>${dateCell}</td>
    <td class="num">${_m(s.amount)}</td></tr>`;
}

/* ── section 2 · what was still owed at month-end ─────────────────────────────────────────────── */
function openSection(r) {
  const buckets = APM_BUCKETS.filter(b => (r.open.buckets[b] || 0) > 0.005)
    .map(b => `<div class="apm-kpi"><div class="l">${_e(b)}</div>
      <div class="v">${_m(r.open.buckets[b])}</div></div>`).join('');
  if (!r.open.groups.length) {
    return sec('Still open at month-end', 'aged by due date where recorded, else the date raised',
      '<p class="apm-muted">Nothing was outstanding at the end of this month.</p>');
  }
  const groups = r.open.groups.slice().sort((a, b) => b.total - a.total).map(g => `
    <details class="apm-grp">
      <summary><span class="g-name">${_e(g.supplier)}</span>
        <span class="g-n">${g.rows.length} payable(s)</span>
        <span class="g-v">${_m(g.total)}</span></summary>
      <div class="apm-grp-body">
        <table class="flow-table flow-items">
          <thead><tr><th>AP No</th><th>PO</th><th>Owed (original)</th><th class="num">Payable ₱</th>
            <th class="num">Paid to date</th><th class="num">Outstanding</th>
            <th>Age</th><th>Bucket</th></tr></thead>
          <tbody>${g.rows.slice().sort((a, b) => (b.days || 0) - (a.days || 0)).map(openRow).join('')}
            ${footRow(5, g.total)}
          </tbody>
        </table>
      </div>
    </details>`).join('');
  return sec('Still open at month-end', 'aged by due date where recorded, else the date raised',
    (buckets ? `<div class="apm-kpis" style="margin-bottom:0.8rem;">${buckets}</div>` : '') + groups +
    `<div class="apm-note">Total ${_m(r.open.total)} across ${r.open.groups.length} supplier(s).
      Reconstructed from the payments themselves, not from today's Paid/Unpaid label — a payable
      settled after this month-end was still open then.</div>`);
}

function openRow(o) {
  const fx = o.currency && o.currency !== 'PHP';
  const rate = o.impliedRate != null
    ? ` <span class="${(o.flags || []).indexOf('rate-out-of-band') >= 0 ? 'apm-warn' : 'apm-muted'}"
         title="Implied rate = peso amount ÷ foreign amount. Shown, not validated.">@${o.impliedRate}</span>`
    : '';
  const noPeso = (o.flags || []).indexOf('no-peso-figure') >= 0;
  return `<tr>
    <td>${_e(o.apNo)}</td>
    <td class="apm-muted">${_e(o.poNo) || '—'}</td>
    <td>${fx ? _e(_fc(o.amountFC, o.currency)) + rate : '<span class="apm-muted">—</span>'}</td>
    <td class="num">${noPeso ? '<span class="apm-warn" title="No peso figure recorded — not converted">—</span>' : _m(o.amountPHP)}</td>
    <td class="num">${_m(o.paidToDate)}</td>
    <td class="num">${_m(o.outstanding)}</td>
    <td class="apm-muted">${o.days == null ? '—' : o.days + 'd'}
      <span class="apm-muted" title="${o.ageBasis === 'due' ? 'from the recorded due date' : 'no due date recorded — aged from when the payable was raised'}">
        ${o.ageBasis === 'due' ? '' : '(raised)'}</span></td>
    <td>${_e(o.bucket)}</td></tr>`;
}

/* ── section 3 · foreign payables settled on the obligation, with a peso gap ───────────────────── */
function gapSection(r) {
  if (!r.estimateGaps || !r.estimateGaps.length) return '';
  const rows = r.estimateGaps.map(g => `<tr>
    <td>${_e(g.apNo)}</td><td class="apm-muted">${_e(g.supplier)}</td>
    <td>${_e(_fc(g.amountFC, g.currency))}</td>
    <td class="num">${_m(g.amountPHP)}</td>
    <td class="num">${_m(g.paidToDate)}</td>
    <td class="num">${_m(g.gap)}</td>
    <td>${g.impliedRate == null ? '—'
      : `<span class="${(g.impliedRate < 20 || g.impliedRate > 200) ? 'apm-warn' : 'apm-muted'}">@${g.impliedRate}</span>`}</td>
  </tr>`).join('');
  return sec('Foreign payables — estimate vs what was paid',
    'settled on the obligation, so not counted as outstanding',
    `<table class="flow-table flow-items">
      <thead><tr><th>AP No</th><th>Supplier</th><th>Owed</th><th class="num">Peso estimate</th>
        <th class="num">Paid</th><th class="num">Gap</th><th>Implied rate</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="apm-note">A foreign payable is settled when the obligation is, not when the peso
      estimate happens to be met — the estimate is typed at PO time and the pesos that left are
      whatever the bank gave that day. The gap is reported rather than treated as debt. An implied
      rate outside ₱20–₱200 per unit is highlighted: there is no rate to validate against, but a
      person spots an impossible one instantly when it is on the screen.</div>`);
}

/* ── shared bits ──────────────────────────────────────────────────────────────────────────────── */
function sec(title, sub, inner) {
  return `<div class="apm-sec"><div class="apm-sec-title">${_e(title)}
    <span class="apm-sec-sub">${_e(sub)}</span></div>${inner}</div>`;
}

/* The A157 footer: the column visibly adds up to the figure above it. */
function footRow(spanCols, total) {
  return `<tr style="font-weight:700;border-top:2px solid var(--border,#e2e8f0);">
    <td colspan="${spanCols}">Total</td><td class="num">${_m(total)}</td></tr>`;
}
