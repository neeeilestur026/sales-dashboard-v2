/* A207 — Commission Requests, the sales rep's own page.
 *
 * A claim is made against SPECIFIC COLLECTIONS, not against a sales order. The rep ticks the payments
 * they are claiming for; the base is that cash net of withholding tax. Everything the approver will
 * see is shown here first, so nobody is surprised at approval time.
 *
 * NO COST OR MARGIN DATA APPEARS ON THIS PAGE, and none is fetched. Sales are deliberately excluded
 * from cost visibility elsewhere (requirePricingCostAccess, qCanSeeCosts) and this page must not
 * become the leak — the commission base is a purely revenue-side number.
 */

let cmSession = null;
let cmClaimable = [];      // groups from getCommissionClaimable
let cmRequests = [];       // my own commission requests
let cmPicked = {};         // soNo -> { collectionNo: true }
let cmReady = false;       // backend v112 present?

const CM_MIN_FLOW_VERSION = 112;

document.addEventListener('DOMContentLoaded', async () => {
  cmSession = requireAuth();
  if (!cmSession) return;
  renderNavbar('flow-commissions');
  if (typeof renderFlowNav === 'function') renderFlowNav('flow-commissions.html');

/* A209 — the feature is built but not open to users yet. Checked BEFORE the version gate, because
   the version gate cannot answer this question: these pages want v112 and the A208 email tracker
   wants 113, which is the same paste. Hiding the CARDS, not just their inner containers — the static
   KPI tiles would otherwise stay live behind the message. */
  if (typeof FLOW_COMMISSIONS_LIVE !== 'undefined' && !FLOW_COMMISSIONS_LIVE) {
    ['cmKpis', 'claimCard', 'cmListCard', 'gateCard'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const panel = document.getElementById('cmComingSoon');
    if (panel) {
      panel.style.display = '';
      panel.innerHTML = flowComingSoonHtml('Commission requests',
        'You will be able to claim commission here on payments a client has actually made against ' +
        'a sales order that came from one of your quotations. Each claim goes to the director, then ' +
        'to management, and an approved claim is included in a salary cutoff.');
    }
    return;
  }

  /* The Apps Script backend is pasted by hand, so the page can be live before its actions exist.
     An unknown action answers 200 with {success:false} rather than throwing, which would look like
     "you have no commissions" — say plainly what is going on instead. */
  cmReady = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(CM_MIN_FLOW_VERSION) : false;
  if (!cmReady) {
    document.getElementById('gateCard').style.display = '';
    document.getElementById('gateMsg').innerHTML =
      '<b>Commission requests are not switched on yet.</b><br>' +
      'The page is ready, but the backend still has to be updated before claims can be filed. ' +
      'Nothing is lost — check back shortly.';
    document.getElementById('claimContainer').innerHTML = '<div class="cm-empty">Waiting for the backend.</div>';
    document.getElementById('listContainer').innerHTML = '<div class="cm-empty">Waiting for the backend.</div>';
    return;
  }
  await cmLoadAll();
});

/** The name a commission is attributed to. Quotations record the rep's FULL NAME, so that is the key. */
function cmWho() { return String((cmSession && cmSession.name) || ''); }

async function cmLoadAll() {
  await Promise.all([cmLoadClaimable(), cmLoadRequests()]);
  cmRenderKpis();
}

async function cmLoadClaimable() {
  const el = document.getElementById('claimContainer');
  el.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getCommissionClaimable', { salesperson: cmWho() }, { fresh: true });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not load your collected payments.');
    cmClaimable = res.data || [];
    cmRenderClaimable();
  } catch (e) {
    el.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`;
  }
}

async function cmLoadRequests() {
  const el = document.getElementById('listContainer');
  el.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Loading...</span></div>';
  try {
    const res = await fetchFlow('getCommissionRequests', { salesperson: cmWho() }, { fresh: true });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not load your commission requests.');
    cmRequests = res.data || [];
    cmRenderRequests();
  } catch (e) {
    el.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`;
  }
}

// ── Claimable ───────────────────────────────────────────────────────────────
function cmRenderClaimable() {
  const el = document.getElementById('claimContainer');
  const live = cmClaimable.filter(g => (g.available || []).length);
  if (!live.length) {
    el.innerHTML = '<div class="cm-empty">Nothing to claim right now.<br>' +
      '<span style="font-size:12px;">A payment becomes claimable once the customer has actually paid ' +
      'against a sales order that came from one of your quotations.</span></div>';
    return;
  }
  el.innerHTML = live.map(cmOrderCard).join('');
}

function cmCovClass(note) {
  const s = String(note || '');
  if (/OVER-COLLECTED/.test(s)) return 'cm-cov over';
  if (/PARTIAL/.test(s)) return 'cm-cov warn';
  return 'cm-cov';
}

function cmOrderCard(g) {
  const so = flowEsc(g.soNo);
  const picked = cmPicked[g.soNo] || {};
  const pickedList = (g.available || []).filter(l => picked[l.collectionNo]);
  const pickedBase = pickedList.reduce((s, l) => s + flowNum(l.netCash), 0);
  const anyPicked = pickedList.length > 0;

  const rows = (g.available || []).map(l => `
    <tr>
      <td><input type="checkbox" ${picked[l.collectionNo] ? 'checked' : ''}
           onchange="cmToggle('${so}','${flowEsc(l.collectionNo)}',this.checked)"></td>
      <td>${flowEsc(l.collectionNo)}</td>
      <td>${flowEsc(flowDate(l.date))}</td>
      <td>${flowEsc(l.reference || l.method || '—')}</td>
      <td class="num">${flowMoney(l.amount, 'PHP')}</td>
      <td class="num">${l.ewt ? '−' + flowMoney(l.ewt, 'PHP') : '—'}</td>
      <td class="num"><b>${flowMoney(l.netCash, 'PHP')}</b></td>
    </tr>`).join('');

  /* Already-claimed payments stay visible, greyed, naming the claim that holds them. Hiding them
     would leave the rep wondering where their money went. */
  const taken = (g.alreadyClaimed || []).map(l => `
    <tr class="taken">
      <td></td>
      <td>${flowEsc(l.collectionNo)}</td>
      <td>${flowEsc(flowDate(l.date))}</td>
      <td class="why">already on ${flowEsc(l.claimedOn)}</td>
      <td class="num">${flowMoney(l.amount, 'PHP')}</td>
      <td class="num">${l.ewt ? '−' + flowMoney(l.ewt, 'PHP') : '—'}</td>
      <td class="num">${flowMoney(l.netCash, 'PHP')}</td>
    </tr>`).join('');

  return `
  <div class="cm-order ${anyPicked ? 'picked' : ''}">
    <div class="cm-order-head">
      <div>
        <div class="who">${flowEsc(g.customer)}</div>
        <div class="sub">${so}${g.quotationNo ? ' · from quotation ' + flowEsc(g.quotationNo) : ''} · ${flowEsc(flowDate(g.soDate))}</div>
      </div>
      <div class="amt">${flowMoney(g.availableBase, 'PHP')}<small>claimable cash (net of tax)</small></div>
    </div>
    <div class="${cmCovClass(g.coveragePreview)}">${flowEsc(g.coveragePreview)}</div>
    <table class="cm-cols">
      <thead><tr>
        <th style="width:34px;"></th><th>Payment</th><th>Date</th><th>Reference</th>
        <th class="num">Received</th><th class="num">Tax withheld</th><th class="num">Counts as</th>
      </tr></thead>
      <tbody>${rows}${taken}</tbody>
    </table>
    <div class="cm-sum">
      <div>Selected<b>${flowMoney(pickedBase, 'PHP')}</b></div>
      <div style="flex:1;"></div>
      <button class="btn btn-primary btn-sm" ${anyPicked ? '' : 'disabled'}
              onclick="cmFile('${so}')">File commission request</button>
    </div>
  </div>`;
}

function cmToggle(soNo, collectionNo, on) {
  const bag = cmPicked[soNo] || (cmPicked[soNo] = {});
  if (on) bag[collectionNo] = true; else delete bag[collectionNo];
  cmRenderClaimable();
}

async function cmFile(soNo) {
  const picked = Object.keys(cmPicked[soNo] || {});
  if (!picked.length) return;
  try {
    const res = await postFlow('createCommissionRequest', {
      soNo: soNo, collectionNos: JSON.stringify(picked), clientRef: flowClientRef()
    });
    if (!res.success) throw new Error(res.message);
    delete cmPicked[soNo];
    /* Saved as a draft, then submitted separately, so the rep can see the computed figure before it
       goes to the director. If the rate is not configured yet, say so instead of failing at submit. */
    if (res.rateConfigured === false) {
      flowMsg('claimMsg', `${res.commNo} saved as a draft. The commission rate has not been set up yet, ` +
        `so it cannot be submitted for approval until the director configures it.`, false);
    } else {
      flowMsg('claimMsg', `${res.commNo} saved as a draft for ${flowMoney(res.amount, 'PHP')} ` +
        `— review it below, then submit it for approval.`, true);
    }
    await cmLoadAll();
  } catch (e) {
    flowMsg('claimMsg', e.message, false);
  }
}

// ── My requests ─────────────────────────────────────────────────────────────
const CM_COLS = 8;
function cmHead() {
  return `<thead><tr><th>Request</th><th>Sales order</th><th>Customer</th><th class="num">Claimed cash</th>` +
         `<th class="num">Rate</th><th class="num">Commission</th><th>Status</th><th></th></tr></thead>`;
}

function cmRenderRequests() {
  const el = document.getElementById('listContainer');
  if (!cmRequests.length) {
    el.innerHTML = '<div class="cm-empty">You have not filed any commission requests yet.</div>';
    return;
  }
  const isOpen = r => r.status !== 'Released' && r.status !== 'Rejected';
  const open = cmRequests.filter(isOpen), done = cmRequests.filter(r => !isOpen(r));
  let html = `<table class="flow-table">${cmHead()}<tbody>${open.map(cmRow).join('')}</tbody></table>`;
  if (done.length) {
    html += `<details style="margin-top:14px;"><summary style="cursor:pointer;font:600 12.5px 'Inter',sans-serif;color:#475569;">` +
            `History (${done.length})</summary>` +
            `<table class="flow-table" style="margin-top:8px;">${cmHead()}<tbody>${done.map(cmRow).join('')}</tbody></table></details>`;
  }
  el.innerHTML = html;
}

function cmRow(r) {
  const adj = flowNum(r.adjustment);
  return `<tr>
    <td><b>${flowEsc(r.commNo)}</b><br><span style="font:400 11px 'Inter',sans-serif;color:#8b93a1;">${flowEsc(flowDate(r.date))} · ${r.collectionCount} payment(s)</span></td>
    <td>${flowEsc(r.soNo)}</td>
    <td>${flowEsc(r.customer)}</td>
    <td class="num">${flowMoney(r.base, 'PHP')}</td>
    <td class="num">${flowNum(r.rate)}%</td>
    <td class="num"><b>${flowMoney(r.netPayable, 'PHP')}</b>${
      adj ? `<br><span style="font:500 11px 'Inter',sans-serif;color:#b45309;">adjusted by ${flowMoney(adj, 'PHP')}</span>` : ''}</td>
    <td>${cmStatusCell(r)}</td>
    <td style="white-space:nowrap;">${cmActions(r)}</td>
  </tr>`;
}

function cmStatusCell(r) {
  const badge = (typeof flowStatusBadge === 'function')
    ? flowStatusBadge(r.status) : `<span class="cm-badge">${flowEsc(r.status)}</span>`;
  const bits = [];
  if (r.dirApprovedBy) bits.push('Director ✓');
  if (r.mgmtApprovedBy) bits.push('Management ✓');
  if (r.payoutPeriod) {
    const rng = (typeof flowCutoffRange === 'function') ? flowCutoffRange(r.payoutPeriod) : null;
    bits.push(rng && rng.label ? rng.label : r.payoutPeriod);
  }
  if (r.releasedAt) bits.push('released to payroll');
  let out = badge;
  if (bits.length) out += `<br><span style="font:500 11px 'Inter',sans-serif;color:#64748b;">${flowEsc(bits.join(' · '))}</span>`;
  if (r.status === 'Rejected' && r.approvalNote) {
    out += `<br><span style="font:500 11px 'Inter',sans-serif;color:#dc2626;">${flowEsc(r.approvalNote)}</span>`;
  }
  return out;
}

function cmActions(r) {
  const no = flowEsc(r.commNo);
  const B = (fn, label, cls) => `<button class="link-btn ${cls || ''}" onclick='${fn}' style="margin-left:.4rem;">${label}</button>`;
  let a = B(`cmDetail("${no}")`, 'Details');
  const editable = r.status === 'Draft' || r.status === 'Rejected';
  if (editable) {
    a += B(`cmSubmit("${no}")`, 'Submit');
    a += B(`cmDelete("${no}")`, 'Delete', 'del-btn');
  }
  return a;
}

async function cmSubmit(no, confirmBaseChanged) {
  try {
    const params = { commNo: no };
    if (confirmBaseChanged) params.confirmBaseChanged = true;
    const res = await postFlow('submitCommissionRequest', params);
    if (!res.success) {
      /* The collections may have moved since the draft was saved — accounting corrects things. Show
         both figures and let the rep decide, rather than submitting a stale number silently. */
      if (res.needsConfirm === 'baseChanged') {
        if (confirm(res.message)) return cmSubmit(no, true);
        return;
      }
      throw new Error(res.message);
    }
    await cmLoadAll();
    alert(res.message);
  } catch (e) { alert(e.message); }
}

async function cmDelete(no) {
  if (!confirm('Delete commission request ' + no + '?')) return;
  try {
    const res = await postFlow('deleteCommissionRequest', { commNo: no });
    if (!res.success) throw new Error(res.message);
    await cmLoadAll();
  } catch (e) { alert(e.message); }
}

function cmDetail(no) {
  const r = cmRequests.filter(x => String(x.commNo) === String(no))[0];
  if (!r) return;
  const lines = (r.items || []).map(i =>
    `  ${i.collectionNo}  ${flowDate(i.date)}  received ${flowMoney(i.amount, 'PHP')}` +
    (i.ewt ? `  less tax ${flowMoney(i.ewt, 'PHP')}` : '') +
    `  counts as ${flowMoney(i.netCash, 'PHP')}` + (i.voidedAtClaim ? '   [VOIDED SINCE]' : ''));
  alert(
    `${r.commNo} — ${r.customer} (${r.soNo})\n` +
    `${'-'.repeat(52)}\n` +
    `Payments claimed:\n${lines.join('\n')}\n\n` +
    `Claimed cash (net of tax)  ${flowMoney(r.base, 'PHP')}\n` +
    `Rate                       ${flowNum(r.rate)}%  (${r.rateBasis})\n` +
    `Commission                 ${flowMoney(r.amount, 'PHP')}\n` +
    (flowNum(r.adjustment) ? `Adjustment                 ${flowMoney(r.adjustment, 'PHP')}\n` : '') +
    `Net payable                ${flowMoney(r.netPayable, 'PHP')}\n\n` +
    `${r.coverageNote}\n` +
    (r.payoutPeriodBasis ? `\n${r.payoutPeriodBasis}\n` : '') +
    (r.integrityFlag ? `\nNOTE: ${r.integrityFlag}\n` : '')
  );
}

// ── KPIs ────────────────────────────────────────────────────────────────────
function cmRenderKpis() {
  const claimable = cmClaimable.reduce((s, g) => s + flowNum(g.availableBase), 0);
  const pending = cmRequests.filter(r => String(r.status).indexOf('Pending') === 0);
  const approved = cmRequests.filter(r => r.status === 'Approved');
  const released = cmRequests.filter(r => r.status === 'Released');
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpiClaimable', flowMoney(claimable, 'PHP'));
  set('kpiPending', String(pending.length));
  set('kpiApproved', flowMoney(approved.reduce((s, r) => s + flowNum(r.netPayable), 0), 'PHP'));
  set('kpiReleased', flowMoney(released.reduce((s, r) => s + flowNum(r.netPayable), 0), 'PHP'));
}
