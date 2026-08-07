/* ═══════════════════════════════════════════════
   director-approvals.js — the director's approvals queue (A190).

   Why this file exists: director-home.html is a payroll dashboard. Before A190 a director had no
   approvals queue anywhere — their only acting surface was the payment-requests page reached from
   the navbar, and the "what needs you" strip only ever linked, never acted. The weekly itinerary is
   approved DIRECTOR FIRST, so the first step of its chain had nowhere to happen.

   Deliberately its own file rather than more code inside director-home.js, which is 1300 lines of
   payroll and shares nothing with this.

   It shows only what is genuinely the director's to act on right now — a record sitting at another
   tier's stage is somebody else's queue, and listing it here would train people to ignore the list.
   ═══════════════════════════════════════════════ */

let daItinByNo = {};
let daCommByNo = {};   // A207

function _dae(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }
function _dam(v) { return (typeof flowMoney === 'function') ? flowMoney(v, 'PHP') : '₱' + Number(v || 0).toFixed(2); }

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('dirApprovals')) return;
  const btn = document.getElementById('dirApprRefresh');
  if (btn) btn.addEventListener('click', daLoad);
  setTimeout(daLoad, 400);   // let the payroll dashboard paint first
});

async function daLoad() {
  const c = document.getElementById('dirApprovals');
  if (!c) return;
  c.innerHTML = '<div style="color:var(--text-muted,#64748b);font-size:0.85rem;">Loading…</div>';
  try {
    const [itn, pr, cm] = await Promise.all([
      fetchFlow('getWeeklyItineraries').catch(() => ({ data: [] })),
      fetchFlow('getPaymentRequests').catch(() => ({ data: [] })),
      fetchFlow('getCommissionRequests', { status: 'Pending Director' }).catch(() => ({ data: [] })),
    ]);

    // The director is the FIRST approver on an itinerary and the LAST on a payment request — hence
    // the two different pending statuses. Getting these the wrong way round would show a director
    // work that is not theirs yet.
    const itins = ((itn && itn.data) || []).filter(x => x.status === 'Pending Director');
    const prs = ((pr && pr.data) || []).filter(x => x.status === 'Pending Director');
    // A207 — the director is the FIRST approver on a commission too, same as an itinerary.
    const comms = ((cm && cm.data) || []).filter(x => x.status === 'Pending Director');
    daItinByNo = {}; itins.forEach(x => { daItinByNo[String(x.itineraryNo)] = x; });
    daCommByNo = {}; comms.forEach(x => { daCommByNo[String(x.commNo)] = x; });

    if (!itins.length && !prs.length && !comms.length) {
      c.innerHTML = '<div style="color:var(--text-muted,#64748b);font-size:0.85rem;">✓ Nothing waiting on you.</div>';
      return;
    }

    const iRows = itins.map(x => `<tr>
      <td><span class="flow-badge b-pending">Itinerary</span></td>
      <td>${_dae(x.itineraryNo)}</td>
      <td>${_dae(x.user)}</td>
      <td>${(x.items || []).length} visit(s)<div style="font-size:0.7rem;color:var(--text-muted,#64748b);">${_dae(x.weekStart)} – ${_dae(x.weekEnd)}</div></td>
      <td style="white-space:nowrap;">
        <button class="link-btn" onclick="daViewItinerary('${_dae(x.itineraryNo)}')">View plan</button>
        <button class="link-btn" onclick="daApprove('approveWeeklyItinerary','${_dae(x.itineraryNo)}','itineraryNo')">Approve</button>
        <button class="link-btn del-btn" onclick="daReject('rejectWeeklyItinerary','${_dae(x.itineraryNo)}','itineraryNo')">Reject</button></td></tr>`).join('');

    const pRows = prs.map(x => `<tr>
      <td><span class="flow-badge b-pending">Payment Req</span></td>
      <td>${_dae(x.prNo)}</td>
      <td>${_dae(x.payee || x.supplier)}</td>
      <td>${_dam(x.amount)}</td>
      <td style="white-space:nowrap;">
        <button class="link-btn" onclick="daApprove('approvePaymentRequest','${_dae(x.prNo)}','prNo')">Approve</button>
        <button class="link-btn del-btn" onclick="daReject('rejectPaymentRequest','${_dae(x.prNo)}','prNo')">Reject</button></td></tr>`).join('');

    /* A207 — the whole reason a rep can file "any time" is that the DIRECTOR judges whether the
       order is collected enough to pay on. So the coverage sentence is in the row itself, not
       hidden behind the View button, and View opens the individual payments being claimed. */
    const cRows = comms.map(x => `<tr>
      <td><span class="flow-badge b-pending">Commission</span></td>
      <td>${_dae(x.commNo)}</td>
      <td>${_dae(x.salesperson)}</td>
      <td>${_dam(x.netPayable)} <span style="color:var(--text-muted,#64748b);">on ${_dam(x.base)} collected</span>
        <div style="font-size:0.7rem;color:var(--text-muted,#64748b);">${_dae(x.soNo)} · ${_dae(x.customer)}</div>
        <div style="font-size:0.7rem;margin-top:2px;${/OVER-COLLECTED/.test(x.coverageNote || '') ? 'color:#b91c1c;font-weight:600;'
          : (/PARTIAL/.test(x.coverageNote || '') ? 'color:#b45309;font-weight:600;' : 'color:var(--text-muted,#64748b);')}">${_dae(x.coverageNote)}</div></td>
      <td style="white-space:nowrap;">
        <button class="link-btn" onclick="daViewCommission('${_dae(x.commNo)}')">View payments</button>
        <button class="link-btn" onclick="daApprove('approveCommissionRequest','${_dae(x.commNo)}','commNo')">Approve</button>
        <button class="link-btn del-btn" onclick="daReject('rejectCommissionRequest','${_dae(x.commNo)}','commNo')">Reject</button></td></tr>`).join('');

    c.innerHTML = `<div style="overflow-x:auto;"><table class="flow-table">
      <thead><tr><th>Type</th><th>No</th><th>Who</th><th>Detail</th><th></th></tr></thead>
      <tbody>${iRows}${pRows}${cRows}</tbody></table></div>`;
  } catch (e) {
    c.innerHTML = `<div style="color:#ef4444;font-size:0.85rem;">${_dae(e.message)}</div>`;
  }
}

async function daApprove(action, no, key, extra) {
  try {
    const r = await postFlow(action, Object.assign({ [key]: no }, extra || {}));
    if (!r || !r.success) {
      /* A207 — a collection can be voided or corrected between submission and signature. The server
         refuses rather than approving a figure that has quietly gone stale; show what moved and let
         the director decide. */
      if (r && r.needsConfirm === 'evidenceChanged') {
        if (confirm(r.message)) return daApprove(action, no, key, { confirmEvidenceChanged: true });
        return;
      }
      throw new Error((r && r.message) || 'Could not approve.');
    }
    daLoad();
    if (r.message) alert(r.message);
  } catch (e) { alert(e.message); }
}

/** The payments behind a commission claim. The director is being asked to sign for this cash, so it
 *  has to be readable before they do — the same principle as daViewItinerary below. */
function daViewCommission(no) {
  const x = daCommByNo[String(no)];
  if (!x) return;
  const lines = (x.items || []).map(i =>
    '  ' + i.collectionNo + '   ' + (typeof flowDate === 'function' ? flowDate(i.date) : i.date) +
    '   received ' + _dam(i.amount) + (i.ewt ? '   less tax ' + _dam(i.ewt) : '') +
    '   counts as ' + _dam(i.netCash) + (i.voidedAtClaim ? '   [VOIDED SINCE]' : ''));
  alert(
    x.commNo + ' — ' + x.salesperson + '\n' +
    x.soNo + '  ' + x.customer + (x.quotationNo ? '  (from quotation ' + x.quotationNo + ')' : '') + '\n' +
    '-'.repeat(56) + '\n' +
    'Payments claimed:\n' + lines.join('\n') + '\n\n' +
    'Order value            ' + _dam(x.soTotal) + '\n' +
    'Invoiced to date       ' + _dam(x.invoicedToDate) + '\n' +
    'Already claimed        ' + _dam(x.priorClaimed) + '\n' +
    'This claim (net cash)  ' + _dam(x.base) + '\n' +
    'Rate                   ' + x.rate + '%   (' + x.rateBasis + ')\n' +
    'Commission             ' + _dam(x.netPayable) + '\n\n' +
    x.coverageNote + '\n'
  );
}

async function daReject(action, no, key) {
  const reason = prompt('Reason for sending ' + no + ' back (optional):', '');
  if (reason === null) return;
  try {
    const r = await postFlow(action, { [key]: no, reason });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not reject.');
    daLoad();
  } catch (e) { alert(e.message); }
}

/** Read the week before signing it — the same principle as the A183 pricing review. */
function daViewItinerary(no) {
  const it = daItinByNo[String(no)];
  if (!it) return;
  const rows = (it.items || []).slice().sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.plannedTime || '').localeCompare(String(b.plannedTime || '')));
  const body = rows.length ? rows.map(r => `<tr>
      <td>${_dae(r.day || '')}<div style="font-size:0.7rem;color:#64748b;">${_dae(r.date || '')}</div></td>
      <td>${_dae(r.plannedTime || '—')}</td>
      <td><strong>${_dae(r.company || '—')}</strong><div style="font-size:0.72rem;color:#64748b;">${_dae(r.personToMeet || '')}</div></td>
      <td>${_dae(r.cityArea || '—')}</td>
      <td>${_dae(r.purpose || '')}</td>
      <td>${_dae(r.agenda || '')}</td>
      <td>${_dae(r.expectedOutcome || '')}</td></tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;padding:1rem;color:#64748b;">No planned visits.</td></tr>';

  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:3000;overflow-y:auto;padding:2rem 1rem;';
  el.innerHTML = `<div style="max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;padding:1.2rem 1.4rem;">
    <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.8rem;">
      <h3 style="margin:0;font-size:1rem;">${_dae(it.itineraryNo)} — ${_dae(it.user)}</h3>
      <span style="font-size:0.8rem;color:#64748b;">${_dae(it.weekStart)} – ${_dae(it.weekEnd)}</span>
      <button class="btn btn-sm btn-secondary" style="margin-left:auto;">Close</button>
    </div>
    ${it.objectives ? `<p style="margin:0 0 0.5rem;font-size:0.85rem;"><strong>Objectives:</strong> ${_dae(it.objectives)}</p>` : ''}
    ${it.notes ? `<p style="margin:0 0 0.6rem;font-size:0.85rem;color:#64748b;">${_dae(it.notes)}</p>` : ''}
    <p style="margin:0 0 0.7rem;font-size:0.78rem;color:#b45309;">You are the first approver — management reviews it after you.</p>
    <div style="overflow-x:auto;"><table class="flow-table"><thead><tr>
      <th>Day</th><th>Time</th><th>Company / who</th><th>City / area</th><th>Purpose</th><th>Agenda</th><th>Expected outcome</th>
    </tr></thead><tbody>${body}</tbody></table></div>
  </div>`;
  const close = () => el.remove();
  el.querySelector('button').addEventListener('click', close);
  el.addEventListener('click', ev => { if (ev.target === el) close(); });
  document.body.appendChild(el);
}
