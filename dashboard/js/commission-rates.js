/* A207 — the commission rate table. Director only.
 *
 * The company percentage is set HERE, not in code. A sheet row always beats the built-in default, so
 * plugging in the real number is a one-screen job with no deploy. Until a rate exists, the backend
 * refuses to accept a submission — see submitCommissionRequest's `configured` guard.
 */

let crSession = null;
let crRates = [];

document.addEventListener('DOMContentLoaded', async () => {
  crSession = requireDirector ? requireDirector() : requireAuth();
  if (!crSession) return;
  renderNavbar('commission-rates');

  const ready = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(112) : false;
  if (!ready) {
    document.getElementById('crList').innerHTML =
      '<div class="cp-empty">Commission requests are not switched on yet — the backend still has to be updated.</div>';
    return;
  }
  crScopeChanged();
  await crLoad();
});

function crScopeChanged() {
  const scope = document.getElementById('crScope').value;
  const hint = document.getElementById('crScopeHint');
  const val = document.getElementById('crScopeValue');
  if (scope === 'salesperson') {
    hint.textContent = '(the rep’s full name, exactly as it appears on their quotations)';
    val.placeholder = 'e.g. Juan Dela Cruz';
    val.disabled = false;
  } else if (scope === 'customer') {
    hint.textContent = '(the customer name as it appears on the sales order)';
    val.placeholder = 'e.g. EAGLE CEMENT CORPORATION';
    val.disabled = false;
  } else {
    hint.textContent = '';
    val.placeholder = 'leave blank for Everyone';
    val.value = '';
    val.disabled = true;
  }
}

async function crLoad() {
  const el = document.getElementById('crList');
  el.innerHTML = '<div class="cp-empty">Loading…</div>';
  try {
    const res = await fetchFlow('getCommissionRates', {}, { fresh: true });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not load the rates.');
    crRates = res.data || [];
    document.getElementById('crNone').style.display = crRates.length ? 'none' : '';
    crRender(res);
  } catch (e) {
    el.innerHTML = `<p style="color:#ef4444;">${flowEsc(e.message)}</p>`;
  }
}

function crRender(res) {
  const el = document.getElementById('crList');
  if (!crRates.length) { el.innerHTML = ''; return; }
  const SCOPE = { 'default': 'Everyone', 'salesperson': 'Salesperson', 'customer': 'Customer' };
  const band = (r) => {
    if (!r.minBase && !r.maxBase) return 'any amount';
    return (r.minBase ? flowMoney(r.minBase, 'PHP') : 'PHP 0.00') +
           (r.maxBase ? ' to under ' + flowMoney(r.maxBase, 'PHP') : ' and above');
  };
  const when = (r) => {
    if (!r.effectiveFrom && !r.effectiveTo) return 'always';
    return (r.effectiveFrom || 'any time') + ' → ' + (r.effectiveTo || 'ongoing');
  };
  el.innerHTML = `<table class="cr"><thead><tr>
      <th>Name</th><th>Applies to</th><th>Claim size</th><th class="num">Rate</th><th>In force</th><th></th>
    </tr></thead><tbody>` +
    crRates.map(r => `<tr>
      <td><b>${flowEsc(r.rateKey)}</b>${r.notes ? `<div style="font:400 11.5px 'Inter',sans-serif;color:#64748b;margin-top:3px;">${flowEsc(r.notes)}</div>` : ''}</td>
      <td>${flowEsc(SCOPE[r.scope] || r.scope)}${r.scopeValue ? '<br><span style="font:500 12px \'Inter\',sans-serif;color:#475569;">' + flowEsc(r.scopeValue) + '</span>' : ''}</td>
      <td>${flowEsc(band(r))}</td>
      <td class="num"><b>${flowNum(r.rate)}%</b></td>
      <td>${flowEsc(when(r))}</td>
      <td style="white-space:nowrap;">
        <button class="link-btn" onclick="crEdit('${flowEsc(r.rateKey)}')">Edit</button>
        <button class="link-btn del-btn" onclick="crDelete('${flowEsc(r.rateKey)}')">Delete</button></td>
    </tr>`).join('') +
    `</tbody></table>
    <p style="font:400 11.5px 'Inter',sans-serif;color:#8b93a1;margin-top:10px;">
      Brackets are combined in <b>${flowEsc(res.tierMode)}</b> mode${res.tierMode === 'flat'
        ? ' — the whole claim is charged at the matching bracket’s rate.'
        : ' — each slice of the claim is charged at its own bracket’s rate.'}
    </p>`;
}

function crEdit(key) {
  const r = crRates.filter(x => String(x.rateKey) === String(key))[0];
  if (!r) return;
  document.getElementById('crFormTitle').textContent = 'Edit ' + r.rateKey;
  document.getElementById('crKey').value = r.rateKey;
  document.getElementById('crScope').value = r.scope || 'default';
  crScopeChanged();
  document.getElementById('crScopeValue').value = r.scopeValue || '';
  document.getElementById('crRate').value = r.rate;
  document.getElementById('crMin').value = r.minBase || '';
  document.getElementById('crMax').value = r.maxBase || '';
  document.getElementById('crFrom').value = r.effectiveFrom || '';
  document.getElementById('crTo').value = r.effectiveTo || '';
  document.getElementById('crNotes').value = r.notes || '';
  document.getElementById('crFormTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function crReset() {
  document.getElementById('crFormTitle').textContent = 'Add a rate';
  ['crKey', 'crScopeValue', 'crRate', 'crMin', 'crMax', 'crFrom', 'crTo', 'crNotes']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('crScope').value = 'default';
  crScopeChanged();
  flowMsg('crMsg', '', true);
  document.getElementById('crMsg').style.display = 'none';
}

async function crSave() {
  const v = (id) => String(document.getElementById(id).value || '').trim();
  if (!v('crKey')) return flowMsg('crMsg', 'Give the rate a name.', false);
  if (v('crRate') === '') return flowMsg('crMsg', 'Enter the rate percentage.', false);
  const scope = v('crScope');
  if (scope !== 'default' && !v('crScopeValue')) {
    return flowMsg('crMsg', 'Say who or which customer this rate applies to.', false);
  }
  try {
    const res = await postFlow('setCommissionRate', {
      rateKey: v('crKey'), scope: scope, scopeValue: v('crScopeValue'),
      rate: v('crRate'), minBase: v('crMin'), maxBase: v('crMax'),
      effectiveFrom: v('crFrom'), effectiveTo: v('crTo'), notes: v('crNotes')
    });
    if (!res.success) throw new Error(res.message);
    flowMsg('crMsg', res.message, true);
    crReset();
    await crLoad();
  } catch (e) { flowMsg('crMsg', e.message, false); }
}

async function crDelete(key) {
  if (!confirm('Delete the rate "' + key + '"?\n\nClaims already approved keep the rate they were approved at.')) return;
  try {
    const res = await postFlow('deleteCommissionRate', { rateKey: key });
    if (!res.success) throw new Error(res.message);
    await crLoad();
  } catch (e) { alert(e.message); }
}
