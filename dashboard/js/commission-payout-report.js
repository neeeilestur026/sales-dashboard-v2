/* A207 — Commissions for Payroll.
 *
 * What the director opens while preparing a cutoff. One line per person, one number to key into the
 * payroll register's Other Income column.
 *
 * Deliberately NOT automated: nothing here writes into the payroll spreadsheet, and nothing tries to
 * match a commission name to a payroll employee. Those are two different Google Sheets with three
 * unrelated name formats between them, and a silent mis-match pays the wrong person.
 */

let cpSession = null;
let cpReport = null;

document.addEventListener('DOMContentLoaded', async () => {
  /* The director prepares payroll; management can read the same page to see what was approved. */
  cpSession = requireAuth();
  if (!cpSession) return;
  const role = String(cpSession.role || '').toLowerCase();
  if (role !== 'director' && role !== 'management') {
    document.body.innerHTML = '<p style="padding:2rem;font-family:Inter,sans-serif;">This page is for the director.</p>';
    return;
  }
  renderNavbar('commission-payout-report');

/* A209 — the feature is built but not open to users yet. Checked BEFORE the version gate, because
   the version gate cannot answer this question: these pages want v112 and the A208 email tracker
   wants 113, which is the same paste. Hiding the CARDS, not just their inner containers — the static
   period selector, Refresh and Print buttons and the payroll warning would otherwise stay live behind the message. */
  if (typeof flowCommissionsLiveFor === 'function' && !flowCommissionsLiveFor(role)) {
    ['cpMainCard', 'cpAuditCard'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const panel = document.getElementById('cpComingSoon');
    if (panel) {
      panel.style.display = '';
      panel.innerHTML = flowComingSoonHtml('Commissions for payroll',
        'This will group approved sales commissions by salary cutoff, so you have one figure per ' +
        'person to enter as Other Income while preparing payroll.');
    }
    return;
  }

  const ready = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(112) : false;
  if (!ready) {
    document.getElementById('cpBody').innerHTML =
      '<div class="cp-empty">Commission requests are not switched on yet — the backend still has to be updated.</div>';
    return;
  }
  await cpLoad();
  if (role === 'director') cpAudit();
});

function cpCanRelease() { return String(cpSession.role || '').toLowerCase() === 'director'; }

async function cpLoad() {
  const body = document.getElementById('cpBody');
  body.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Loading...</span></div>';
  try {
    const sel = document.getElementById('cpPeriod');
    /* A211 — the rollout gate on the backend reads actorRole, and a GET does not carry one. Not a
       security check: this read is unsecured, and what it returns is already director/management
       territory. Sending it stops the page refusing itself. */
    const wanted = { actorRole: String(cpSession.role || '') };
    if (sel && sel.value) wanted.payoutPeriod = sel.value;
    const res = await fetchFlow('getCommissionPayoutReport', wanted, { fresh: true });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not load the report.');
    cpReport = res;
    cpFillPeriods(res);
    cpRenderWindow(res);
    cpRender(res);
  } catch (e) {
    body.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`;
  }
}

function cpFillPeriods(res) {
  const sel = document.getElementById('cpPeriod');
  if (!sel) return;
  const periods = (res.periods || []).slice();
  if (res.payoutPeriod && periods.indexOf(res.payoutPeriod) < 0) periods.push(res.payoutPeriod);
  periods.sort().reverse();
  sel.innerHTML = periods.map(p => {
    const r = flowCutoffRange(p);
    const label = r && r.label ? r.label : p;
    return `<option value="${flowEsc(p)}"${p === res.payoutPeriod ? ' selected' : ''}>${flowEsc(label)}</option>`;
  }).join('');
}

function cpRenderWindow(res) {
  const el = document.getElementById('cpWindow');
  if (!el) return;
  el.style.display = '';
  el.innerHTML = `<b>${flowEsc(res.periodLabel || res.payoutPeriod)}</b> · covers ` +
    `${flowEsc(res.periodFrom)} to ${flowEsc(res.periodTo)}.` +
    (res.periodMode === 'next-B'
      ? ` Commissions are always paid in a 2nd cutoff, because payroll only applies Other Income in the 2nd cutoff.`
      : '');
}

function cpRender(res) {
  const body = document.getElementById('cpBody');
  const rows = res.data || [];
  const payable = rows.filter(g => g.payable > 0 || (g.payableClaims || []).length);
  const released = rows.filter(g => (g.releasedClaims || []).length);

  if (!payable.length && !released.length) {
    body.innerHTML = '<div class="cp-empty">No approved commissions fall in this cutoff.</div>';
    return;
  }

  let html = '';
  if (payable.length) {
    html += `<table class="cp"><thead><tr>
      <th>Salesperson</th><th class="num">Claims</th><th class="num">Net of taxes</th>
      <th class="num">Commission</th><th class="num">Adjustments</th>
      <th class="num">Enter as Other Income</th><th class="cp-noprint"></th></tr></thead><tbody>`;
    html += payable.map(cpPersonRow).join('');
    html += `</tbody><tfoot><tr>
      <td colspan="5">Total to add to this cutoff</td>
      <td class="num">${flowMoney(res.totalPayable, 'PHP')}</td><td class="cp-noprint"></td>
    </tr></tfoot></table>`;
    if (cpCanRelease()) {
      html += `<div class="cp-noprint" style="margin-top:14px;">
        <button class="btn btn-primary btn-sm" onclick="cpReleaseAll()">Mark all as entered into payroll</button>
        <span style="font:400 11.5px 'Inter',sans-serif;color:#8b93a1;margin-left:8px;">
          Do this once the figures are keyed in — it stops the same commission being paid again next cutoff.</span>
      </div>`;
    }
  } else {
    html += '<div class="cp-empty">Nothing left to pay in this cutoff.</div>';
  }

  if (released.length) {
    const total = released.reduce((s, g) => s + flowNum(g.released), 0);
    html += `<details style="margin-top:18px;"><summary style="cursor:pointer;font:600 12.5px 'Inter',sans-serif;color:#475569;">
      Already entered into payroll for this cutoff — ${flowMoney(total, 'PHP')} (${released.length} person(s))</summary>
      <table class="cp"><thead><tr><th>Salesperson</th><th class="num">Claims</th><th class="num">Amount</th></tr></thead><tbody>` +
      released.map(g => `<tr><td class="cp-name">${flowEsc(g.salesperson)}</td>
        <td class="num">${(g.releasedClaims || []).length}</td>
        <td class="num">${flowMoney(g.released, 'PHP')}</td></tr>`).join('') +
      `</tbody></table></details>`;
  }
  body.innerHTML = html;
}

function cpPersonRow(g) {
  const claims = g.payableClaims || [];
  const base = claims.reduce((s, r) => s + flowNum(r.netOfTaxes), 0);   // A210: what the rate multiplies
  /* A210 — spell out the deductions, so a line here can be checked against a printed SOA without
     anyone having to remember that the rate does not apply to the collected cash. */
  const detail = claims.map(r =>
    `${flowEsc(r.commNo)} · ${flowEsc(r.soNo)} ${flowEsc(r.customer)} · ` +
    `collected ${flowMoney(r.base, 'PHP')} − VAT ${flowMoney(r.vatDeduction, 'PHP')} − tax ${flowMoney(r.localTax, 'PHP')}` +
    ` = ${flowMoney(r.netOfTaxes, 'PHP')} @ ${flowNum(r.rate)}% = ${flowMoney(r.amount, 'PHP')}` +
    (flowNum(r.commissionEwt) ? ` − ${flowMoney(r.commissionEwt, 'PHP')} withheld` : '') +
    (flowNum(r.adjustment) ? ` <span class="cp-flag">adjusted ${flowMoney(r.adjustment, 'PHP')}</span>` : '') +
    (r.integrityFlag ? `<br><span class="cp-flag">⚠ ${flowEsc(r.integrityFlag)}</span>` : '')
  ).join('<br>');
  const name = flowEsc(g.salesperson);
  return `<tr>
    <td><span class="cp-name">${name}</span>
        <button class="cp-copy cp-noprint" onclick="cpCopy('${name.replace(/'/g, "\\'")}')">copy</button>
        <div class="cp-detail">${detail}</div></td>
    <td class="num">${claims.length}</td>
    <td class="num">${flowMoney(base, 'PHP')}</td>
    <td class="num">${flowMoney(claims.reduce((s, r) => s + flowNum(r.amount) - flowNum(r.commissionEwt), 0), 'PHP')}</td>
    <td class="num">${g.adjustments ? flowMoney(g.adjustments, 'PHP') : '—'}</td>
    <td class="num cp-key">${flowMoney(g.payable, 'PHP')}</td>
    <td class="num cp-noprint">${cpCanRelease()
      ? `<button class="btn btn-sm" onclick="cpRelease('${name.replace(/'/g, "\\'")}')">Mark entered</button>` : ''}</td>
  </tr>`;
}

function cpCopy(name) {
  try { navigator.clipboard.writeText(name); } catch (e) { /* clipboard blocked — the name is on screen anyway */ }
}

async function cpRelease(salesperson) {
  const g = (cpReport.data || []).filter(x => String(x.salesperson) === String(salesperson))[0];
  if (!g || !(g.payableClaims || []).length) return;
  if (!confirm('Mark ' + flowMoney(g.payable, 'PHP') + ' for ' + salesperson +
               ' as entered into payroll for ' + cpReport.payoutPeriod + '?\n\n' +
               'This is what stops it being paid again next cutoff.')) return;
  await cpReleaseMany(g.payableClaims);
}

async function cpReleaseAll() {
  const all = (cpReport.data || []).reduce((a, g) => a.concat(g.payableClaims || []), []);
  if (!all.length) return;
  if (!confirm('Mark all ' + all.length + ' commission(s) — ' + flowMoney(cpReport.totalPayable, 'PHP') +
               ' — as entered into payroll for ' + cpReport.payoutPeriod + '?')) return;
  await cpReleaseMany(all);
}

/* One at a time, deliberately: there is no bulk write path, so a failure part-way through leaves an
   honest partial state rather than a silent half-write. */
async function cpReleaseMany(claims) {
  const note = 'Keyed into payroll for ' + cpReport.payoutPeriod;
  const failed = [];
  for (let i = 0; i < claims.length; i++) {
    try {
      const r = await postFlow('markCommissionReleased', { commNo: claims[i].commNo, note: note });
      if (!r.success) failed.push(claims[i].commNo + ': ' + r.message);
    } catch (e) { failed.push(claims[i].commNo + ': ' + e.message); }
  }
  await cpLoad();
  if (failed.length) alert('Some could not be marked:\n\n' + failed.join('\n'));
}

async function cpAudit() {
  const card = document.getElementById('cpAuditCard');
  const el = document.getElementById('cpAudit');
  try {
    const res = await fetchFlow('auditCommissionIntegrity', { actorRole: String(cpSession.role || '') }, { fresh: true });
    if (!res || !res.success) return;
    if (res.clean) {
      card.style.display = '';
      el.innerHTML = '<div style="color:#047857;font:600 13px \'Inter\',sans-serif;">✓ Nothing wrong found.</div>';
      return;
    }
    card.style.display = '';
    el.innerHTML = res.findings.map(f =>
      `<div style="padding:8px 11px;margin-bottom:6px;border-radius:8px;font:500 12.5px 'Inter',sans-serif;
        background:${f.level === 'error' ? '#fef2f2' : '#fffbeb'};color:${f.level === 'error' ? '#991b1b' : '#92400e'};">
        <b>${flowEsc(f.commNo || '')}</b> ${flowEsc(f.message)}</div>`).join('');
  } catch (e) { /* the audit is advisory — never let it blank the report */ }
}
