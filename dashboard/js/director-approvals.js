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
    const [itn, pr] = await Promise.all([
      fetchFlow('getWeeklyItineraries').catch(() => ({ data: [] })),
      fetchFlow('getPaymentRequests').catch(() => ({ data: [] })),
    ]);

    // The director is the FIRST approver on an itinerary and the LAST on a payment request — hence
    // the two different pending statuses. Getting these the wrong way round would show a director
    // work that is not theirs yet.
    const itins = ((itn && itn.data) || []).filter(x => x.status === 'Pending Director');
    const prs = ((pr && pr.data) || []).filter(x => x.status === 'Pending Director');
    daItinByNo = {}; itins.forEach(x => { daItinByNo[String(x.itineraryNo)] = x; });

    if (!itins.length && !prs.length) {
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

    c.innerHTML = `<div style="overflow-x:auto;"><table class="flow-table">
      <thead><tr><th>Type</th><th>No</th><th>Who</th><th>Detail</th><th></th></tr></thead>
      <tbody>${iRows}${pRows}</tbody></table></div>`;
  } catch (e) {
    c.innerHTML = `<div style="color:#ef4444;font-size:0.85rem;">${_dae(e.message)}</div>`;
  }
}

async function daApprove(action, no, key) {
  try {
    const r = await postFlow(action, { [key]: no });
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not approve.');
    daLoad();
  } catch (e) { alert(e.message); }
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
