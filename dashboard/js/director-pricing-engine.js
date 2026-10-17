/* director-pricing-engine.js — A340 · the director's pricing engine page.
   The rules live in pe-engine.js (pure); this page only collects the inputs, shows the result and keeps
   the director's tables and priced quotations in FlowAPI's own PETables / PERecords tabs. It reads and
   writes nothing else: no quotation, pricing request, inventory or order. Recalculates as you type. */
let peSession = null;
let peLive = false;          // FlowAPI 173+: tables and records can be saved
let peTables = null;         // the tables in use (the latest saved version, or the starting values)
let peDraftT = null;         // the Tables tab's working copy
let peVersions = [], peCodes = {};
let peQ = null;              // the quotation being priced
let peRef = '', peRev = 0;   // the saved record it belongs to, if any
let peRes = null, peTimer = 0;
let peDirty = false;         // the Tables tab has changes not saved yet

const PE_TYPE_LABEL = { line: 'Authorized line', trading: 'Trading (sourced)', public_price: 'Public-price item', service: 'Service' };
const PE_CLASS_LABEL = { A: 'A small, dense', B: 'B bulky, light', C: 'C heavy', D: 'D outsize', L: 'L local' };
const PE_FLAG_LABEL = { forex_stale: 'Forex out of date', missing_forex: 'No forex rate', missing_forwarder_quote: 'Forwarder quote missing',
  missing_inputs: 'Missing input', decline_or_bundle: 'Decline or bundle', below_floor: 'Below floor', tender: 'Tender', over_limit: 'Over ₱2M',
  cash_exposure: 'Cash exposure', validity_exceeds_supplier: 'Validity', estimated_freight: 'Estimated freight', freight_rate_not_set: 'Freight rate not set' };
const pp = (v) => PE.pePeso(v);
const pc = (v, d) => (Number(v || 0) * 100).toFixed(d === undefined ? 1 : d) + '%';
const clone = (o) => JSON.parse(JSON.stringify(o));

document.addEventListener('DOMContentLoaded', async () => {
  peSession = requireDirector();
  if (!peSession) return;
  renderNavbar('director-pricing-engine');
  const tabs = document.querySelector('.pe-tabs');
  if (tabs) tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) peTab(b.dataset.tab); });
  document.getElementById('peNew').addEventListener('click', peNew);
  document.getElementById('pePrint').addEventListener('click', () => window.print());
  document.getElementById('peAdd').addEventListener('click', () => { peQ.lines.push(peLineFor('CEJN')); peRenderLines(); peRecalc(); });
  const order = document.getElementById('peOrder'), lines = document.getElementById('peLines');
  ['input', 'change'].forEach(ev => { order.addEventListener(ev, peOrderInput); lines.addEventListener(ev, peLineInput); });
  lines.addEventListener('click', peLineClick);
  document.getElementById('peSummary').addEventListener('click', (e) => { if (e.target.closest('#peSave')) peSave(); });
  document.getElementById('peSavedList').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) peOpen(b.dataset.open); });
  const tf = document.getElementById('peTablesForm');
  ['input', 'change'].forEach(ev => tf.addEventListener(ev, peTableInput));
  tf.addEventListener('click', peTableClick);

  peTables = clone(PE.PE_DEFAULT_TABLES);   // so a first line gets its principal's defaults
  peQ = peLoadDraft() || peFresh();
  try { peLive = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(173) : false; } catch (e) { peLive = false; }
  await peLoadTables();
  peRenderOrder(); peRenderLines(); peRecalc();
});

/* ── tables ─────────────────────────────────────────────────────────────────────────────────────── */
async function peLoadTables() {
  peTables = clone(PE.PE_DEFAULT_TABLES);
  if (peLive) {
    try {
      const r = await postFlow('peGetTables', {});
      if (r && r.success) {
        if (r.tables) peTables = Object.assign(clone(PE.PE_DEFAULT_TABLES), r.tables);
        peVersions = r.versions || []; peCodes = r.codes || {};
      }
    } catch (e) { /* the starting values still price */ }
  }
  peDraftT = clone(peTables); peDirty = false;
  peShowStatus();
  peRenderTables();
}
function peShowStatus() {
  const today = hxToday(), parts = [];
  parts.push(peTables.version ? 'Tables <b>v' + peTables.version + '</b>, effective ' + flowEsc(peTables.effectiveDate) : 'Tables: <b>starting values</b> (not saved yet)');
  PE.PE_CURRENCIES.filter(c => c !== 'PHP').forEach(c => {
    const f = peTables.forex[c] || {};
    const age = f.asOf ? Math.round((Date.parse(today) - Date.parse(f.asOf)) / 86400000) : null;
    const stale = !f.rate || !f.asOf || age > peTables.forexStaleDays;
    parts.push('<span class="' + (stale ? 'bad' : '') + '">' + c + ' ' + (f.rate ? flowEsc(f.rate) : '—') + (f.asOf ? ' (' + flowEsc(f.asOf) + ')' : '') + '</span>');
  });
  if (peDirty) parts.push('<span class="bad">Pricing with table changes not saved yet</span>');
  if (!peLive) parts.push('<span class="bad">Saving needs FlowAPI 173: this page still prices with the values shown</span>');
  document.getElementById('peStatus').innerHTML = parts.join(' · ');
}

/* ── the quotation form ─────────────────────────────────────────────────────────────────────────── */
function peFresh() { const q = PE.peBlankQuote(); q.lines = [peLineFor('CEJN')]; return q; }
function peLineFor(principal) {
  const l = PE.peBlankLine(), d = (peTables && peTables.principals[principal]) || {};
  l.principal = principal; l.currency = d.currency || 'USD'; l.freightClass = d.freightClass || 'B';
  if (principal === 'Local') { l.origin = 'Local'; l.incoterm = 'EXW'; l.itemType = 'trading'; }
  return l;
}
function peNew() {
  if (!window.confirm('Start a new quotation? The current one stays in Saved only if you saved it.')) return;
  peQ = peFresh(); peRef = ''; peRev = 0; peRenderOrder(); peRenderLines(); peRecalc(); peTab('price');
}
const opt = (vals, cur, labels) => vals.map(v => `<option value="${flowEsc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${flowEsc(labels ? labels[v] || v : v)}</option>`).join('');
function peRenderOrder() {
  const q = peQ, dests = [''].concat((peTables.destinations || []).map(d => d.name));
  const f = (label, html, cls) => `<div class="${cls || ''}"><label>${label}</label>${html}</div>`;
  document.getElementById('peOrder').innerHTML =
    f('Client', `<input type="text" data-o="client" maxlength="120" value="${flowEsc(q.client)}">`, 'wide') +
    f('Delivery to', `<select data-o="destination">${opt(dests, q.destination, { '': 'No delivery (client collects)' })}</select>`, 'wide') +
    f('Delivery by', `<select data-o="deliveryMode">${opt(PE.PE_DELIVERY_MODES, q.deliveryMode)}</select>`) +
    f('Truck + crane quote (₱)', `<input type="number" min="0" step="any" data-o="deliveryQuotePhp" value="${flowEsc(q.deliveryQuotePhp)}">`) +
    f('Job costs (₱)', `<input type="number" min="0" step="any" data-o="jobCostsPhp" value="${flowEsc(q.jobCostsPhp)}"><div class="pe-help">Testing, commissioning, trips, spares</div>`) +
    f('Supplier terms', `<select data-o="supplierTerms">${opt(PE.PE_TERMS, q.supplierTerms)}</select>`) +
    f('Client downpayment (₱)', `<input type="number" min="0" step="any" data-o="clientDownpayment" value="${flowEsc(q.clientDownpayment)}">`) +
    f('Supplier quote valid to', `<input type="date" data-o="supplierValidity" value="${flowEsc(q.supplierValidity)}">`) +
    f('Our quote valid to', `<input type="date" data-o="quoteValidity" value="${flowEsc(q.quoteValidity)}">`) +
    `<label class="check"><input type="checkbox" data-o="isTender"${q.isTender ? ' checked' : ''}>Tender</label>`;
}
function peRenderLines() {
  document.getElementById('peLines').innerHTML = peQ.lines.map((l, i) => {
    const v = (k) => flowEsc(l[k] === undefined || l[k] === null ? '' : l[k]);
    const d = l.dims || {};
    const fld = (label, html, cls) => `<div class="${cls || ''}"><label>${label}</label>${html}</div>`;
    const num = (k, label, help) => fld(label, `<input type="number" min="0" step="any" data-l="${i}" data-f="${k}" value="${v(k)}">${help ? `<div class="pe-help">${help}</div>` : ''}`);
    const more = ['weightKg', 'cbm', 'hsDutyRate', 'freightPhp', 'streetPrice', 'landedUnitCost', 'priceOverride'].some(k => String(l[k] || '') !== '') || d.l || l.inStock;
    return `<div class="pe-line" data-line="${i}">
      <div class="pe-line-head">Item ${i + 1}<span class="sp"></span>
        <button type="button" class="btn btn-sm btn-secondary" data-act="dup" data-i="${i}">Duplicate</button>
        <button type="button" class="btn btn-sm btn-secondary" data-act="del" data-i="${i}"${peQ.lines.length < 2 ? ' disabled' : ''}>Remove</button></div>
      <div class="pe-form">
        ${fld('Description', `<input type="text" maxlength="160" data-l="${i}" data-f="description" value="${v('description')}">`, 'wide')}
        ${fld('Type', `<select data-l="${i}" data-f="itemType">${opt(PE.PE_ITEM_TYPES, l.itemType, PE_TYPE_LABEL)}</select>`)}
        ${fld('Principal', `<select data-l="${i}" data-f="principal">${opt(PE.PE_PRINCIPALS, l.principal)}</select>`)}
        ${num('qty', 'Qty')}
        ${num('supplierPrice', 'Supplier price (each)')}
        ${fld('Currency', `<select data-l="${i}" data-f="currency">${opt(PE.PE_CURRENCIES, l.currency)}</select>`)}
        ${fld('Incoterm', `<select data-l="${i}" data-f="incoterm">${opt(PE.PE_INCOTERMS, l.incoterm)}</select>`)}
        ${fld('Origin', `<select data-l="${i}" data-f="origin">${opt(['International', 'Local'], l.origin)}</select>`)}
        ${fld('Freight class', `<select data-l="${i}" data-f="freightClass">${opt(PE.PE_CLASSES, l.freightClass, PE_CLASS_LABEL)}</select>`)}
        ${fld('Heavy by', `<select data-l="${i}" data-f="shipMode">${opt(['air', 'sea'], l.shipMode)}</select>`)}
        <label class="check"><input type="checkbox" data-l="${i}" data-f="consolidated"${l.consolidated ? ' checked' : ''}>Monthly shipment</label>
        <label class="check"><input type="checkbox" data-l="${i}" data-f="inStock"${l.inStock ? ' checked' : ''}>In stock</label>
      </div>
      <details${more ? ' open' : ''}><summary>Weight, size, duty, street price, price by hand</summary>
        <div class="pe-form">
          ${num('weightKg', 'Weight (kg each)')}
          ${fld('Carton L × W × H (cm)', `<div class="pe-mini"><input type="number" min="0" step="any" data-l="${i}" data-f="dims.l" value="${flowEsc(d.l || '')}" aria-label="Length"><input type="number" min="0" step="any" data-l="${i}" data-f="dims.w" value="${flowEsc(d.w || '')}" aria-label="Width"><input type="number" min="0" step="any" data-l="${i}" data-f="dims.h" value="${flowEsc(d.h || '')}" aria-label="Height"></div>`, 'wide')}
          ${num('cbm', 'CBM (each)', 'For delivery to the client')}
          ${num('hsDutyRate', 'HS duty (%)')}
          ${num('freightPhp', 'Forwarder freight (₱, line)', 'Required for class D')}
          ${num('streetPrice', 'Street price (₱ each)', 'Public-price items')}
          ${num('landedUnitCost', 'Landed cost from stock (₱ each)', 'When "In stock"')}
          ${num('priceOverride', 'Price by hand (₱ each)', 'Leave empty to use the recommended price')}
        </div>
      </details>
    </div>`;
  }).join('');
}
function peSet(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  ks.slice(0, -1).forEach(k => { if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[ks[ks.length - 1]] = val;
}
function peGet(obj, path) { return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj); }
function peValue(el) { return el.type === 'checkbox' ? el.checked : el.value; }
function peOrderInput(e) {
  const el = e.target.closest('[data-o]'); if (!el) return;
  peQ[el.dataset.o] = peValue(el); peSoon();
}
function peLineInput(e) {
  const el = e.target.closest('[data-l]'); if (!el) return;
  const i = +el.dataset.l, f = el.dataset.f, l = peQ.lines[i];
  peSet(l, f, peValue(el));
  if (f === 'principal' && e.type === 'change') {
    const d = peTables.principals[l.principal] || {};
    l.currency = d.currency || l.currency; l.freightClass = d.freightClass || l.freightClass;
    l.origin = l.principal === 'Local' ? 'Local' : 'International';
    peRenderLines();
  }
  peSoon();
}
function peLineClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const i = +b.dataset.i;
  if (b.dataset.act === 'dup') peQ.lines.splice(i + 1, 0, clone(peQ.lines[i]));
  if (b.dataset.act === 'del' && peQ.lines.length > 1) peQ.lines.splice(i, 1);
  peRenderLines(); peRecalc();
}
function peSoon() { clearTimeout(peTimer); peTimer = setTimeout(peRecalc, 120); }

/* ── the result ─────────────────────────────────────────────────────────────────────────────────── */
function peRecalc() {
  const opts = { today: hxToday() };
  peRes = PE.peQuote(peQ, peTables, opts);
  peRes.lines.forEach((l, i) => { l.tiers = PE.peTiers(peQ, peTables, opts, i); });
  peRenderSummary(); peRenderTable(); peRenderExplain(); peSaveDraft();
}
function peRenderSummary() {
  const r = peRes, t = r.totals, a = r.approval;
  const blocking = r.flags.filter(f => f.blocking);
  const state = !peQ.lines.length ? '' : blocking.length ? '<span class="pe-badge not">Not ready: fix the red flags</span>'
    : a.needed ? `<span class="pe-badge not">Needs the ${flowEsc(a.approver)}'s code</span>` : '<span class="pe-badge ready">Ready to send</span>';
  const kv = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  const flags = r.flags.map(f => `<li class="${f.blocking ? 'block' : (f.code === 'freight_rate_not_set' || f.code === 'estimated_freight') ? 'info' : ''}"><b>${flowEsc(PE_FLAG_LABEL[f.code] || f.code)}:</b> ${flowEsc(f.text)}</li>`).join('');
  const who = a.needed ? `<p><b>The ${flowEsc(a.approver)} approves</b>: ${flowEsc(a.reasons.join('; '))}.</p>` : '<p>No approval needed.</p>';
  document.getElementById('peSummary').innerHTML = `
    <div class="pe-actions">${state}</div>
    <div class="pe-total">${pp(t.netSale)}</div>
    <div class="pe-sub">ex-VAT · ${pp(t.gross)} incl. VAT</div>
    <dl class="pe-kv">
      ${kv('COGS', pp(t.cogs))}${kv('Margin achieved', pc(t.margin))}${kv('Net to the company', pp(t.netToCompany))}
      ${kv('Band', flowEsc(r.band.label) + ' → floor ' + pc(r.band.margin, 0) + (r.band.handling ? ' + ' + pp(r.band.handling) + ' handling' : ''))}
      ${kv('Floor (lowest an approver may sign)', pp(t.floor))}${kv('VAT 12%', pp(t.vat))}
      ${t.delivery ? kv('Delivery', pp(t.delivery)) : ''}${t.job ? kv('Job costs', pp(t.job)) : ''}
    </dl>
    ${r.band.note ? `<p class="pe-help">${flowEsc(r.band.note)}</p>` : ''}
    ${flags ? `<ul class="pe-flags">${flags}</ul>` : ''}
    <div class="pe-approve">
      ${who}
      <p class="pe-help">Discount room: ${pc(a.discountSpot, 0)} on the spot, ${pc(a.discountDirector, 0)} with the director, below the floor only with the president. Never applied by the engine.</p>
      <div class="pe-form">
        <div><label for="peStatusSel">Save as</label><select id="peStatusSel"><option value="Draft">Draft</option><option value="Ready">Ready to send</option></select></div>
        <div><label for="peCode">Approval code</label><input type="password" id="peCode" autocomplete="off"${a.needed ? '' : ' disabled'}></div>
      </div>
      <div class="pe-actions pe-msg"><button type="button" class="btn btn-primary" id="peSave"${peLive && peQ.lines.length && !peDirty ? '' : ' disabled'}>Save</button>
        <span class="pe-help">${peDirty ? 'Save or undo the table changes first' : peRef ? flowEsc(peRef) + (peRev ? ', revision ' + peRev : '') : (peLive ? 'Not saved yet' : 'Saving needs FlowAPI 173')}</span></div>
    </div>`;
  document.getElementById('pePrintHead').innerHTML = `<h2>${flowEsc(peQ.client || 'Quotation')}</h2><p>${flowEsc(peRef || 'Not saved')} · ${flowEsc(hxToday())} · tables v${flowEsc(peTables.version || 0)}</p>`;
}
function peRenderTable() {
  const r = peRes;
  if (!r.lines.length) { document.getElementById('peTable').innerHTML = '<div class="pe-empty">Add an item.</div>'; return; }
  // the decision first (floor, recommended, price, total, tiers), then how the cost was built
  const rows = r.lines.map(l => {
    const tiers = l.tiers ? [1, 5, 10].map(q => pp(l.tiers[q])).join(' / ') : '';
    return `<tr class="${l.priceUnit < l.floorUnit - 0.005 ? 'below' : ''}"><td class="desc">${flowEsc(l.name)}</td><td class="num">${flowEsc(l.qty)}</td>
      <td class="num">${pp(l.cogsUnit)}</td><td class="num">${pp(l.floorUnit)}</td><td class="num">${pp(l.recommendedUnit)}</td>
      <td class="num">${pp(l.priceUnit)}${l.overridden ? ' (by hand)' : ''}</td><td class="num">${pp(l.netLine)}</td><td class="num">${tiers}</td>
      <td class="num">${pp(l.goodsLine)}</td><td class="num">${pp(l.freightDuty)}</td><td class="num">${pp(l.fixedShare)}</td>
      <td class="num">${pp(l.deliveryShare)}</td><td class="num">${pp(l.jobShare)}</td></tr>`;
  }).join('');
  const s = (k) => pp(r.lines.reduce((a, l) => a + l[k], 0));
  document.getElementById('peTable').innerHTML = `<table class="pe-table"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">COGS / unit</th>
    <th class="num">Floor / unit</th><th class="num">Recommended / unit</th><th class="num">Price / unit</th><th class="num">Line total ex-VAT</th>
    <th class="num">Each at 1 / 5 / 10 pcs</th><th class="num">Goods ₱ (line)</th><th class="num">Freight + duty ₱</th><th class="num">Shipment fixed ₱</th>
    <th class="num">Delivery ₱</th><th class="num">Job ₱</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td></td><td class="num">COGS ${pp(r.totals.cogs)}</td><td class="num">${pp(r.totals.floor)}</td><td></td><td></td>
    <td class="num">${pp(r.totals.netSale)}</td><td></td><td class="num">${s('goodsLine')}</td><td class="num">${s('freightDuty')}</td>
    <td class="num">${s('fixedShare')}</td><td class="num">${s('deliveryShare')}</td><td class="num">${s('jobShare')}</td></tr></tfoot></table>`;
}
function peRenderExplain() {
  document.getElementById('peExplain').innerHTML = peRes.explanation.map(s => `<li>${flowEsc(s)}</li>`).join('');
}
function peSaveDraft() { try { localStorage.setItem('pe_draft', JSON.stringify({ q: peQ, ref: peRef, rev: peRev })); } catch (e) { /* convenience only */ } }
function peLoadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem('pe_draft') || 'null');
    if (d && d.q && Array.isArray(d.q.lines)) { peRef = d.ref || ''; peRev = d.rev || 0; return Object.assign(PE.peBlankQuote(), d.q); }
  } catch (e) { /* none */ }
  return null;
}

/* ── saving and the saved list ──────────────────────────────────────────────────────────────────── */
async function peSave() {
  const btn = document.getElementById('peSave'); btn.disabled = true;
  const status = document.getElementById('peStatusSel').value, code = (document.getElementById('peCode') || {}).value || '';
  const r = peRes;
  const slim = { totals: r.totals, flags: r.flags, approval: r.approval, band: r.band, tablesVersion: peTables.version || 0, explanation: r.explanation,
    lines: r.lines.map(l => ({ name: l.name, qty: l.qty, method: l.method, goodsLine: l.goodsLine, freightDuty: l.freightDuty, fixedShare: l.fixedShare,
      deliveryShare: l.deliveryShare, jobShare: l.jobShare, cogsLine: l.cogsLine, cogsUnit: l.cogsUnit, floorUnit: l.floorUnit,
      recommendedUnit: l.recommendedUnit, priceUnit: l.priceUnit, netLine: l.netLine, tiers: l.tiers })) };
  try {
    const res = await postFlow('peSaveRecord', { ref: peRef, client: peQ.client, status, approvalCode: code, inputs: JSON.stringify(peQ), result: JSON.stringify(slim) });
    if (!res || !res.success) throw new Error((res && res.message) || 'Not saved.');
    peRef = res.ref; peRev = res.revision;
    flowMsg('peMsg', res.message, true);
    peSaveDraft(); peRenderSummary(); peLoadSaved();
  } catch (e) { flowMsg('peMsg', e.message, false); }
  finally { const b = document.getElementById('peSave'); if (b) b.disabled = !peLive || peDirty; }
}
async function peLoadSaved() {
  const box = document.getElementById('peSavedList');
  if (!peLive) { box.innerHTML = '<div class="pe-empty">Saved quotations appear here once FlowAPI 173 is pasted.</div>'; return; }
  let r;
  try { r = await postFlow('peListRecords', {}); } catch (e) { r = { success: false, message: e.message }; }
  if (!r || !r.success) { box.innerHTML = `<div class="pe-empty">${flowEsc((r && r.message) || 'Could not load the saved quotations.')}</div>`; return; }
  if (!r.data.length) { box.innerHTML = '<div class="pe-empty">Nothing saved yet.</div>'; return; }
  box.innerHTML = `<table class="pe-table"><thead><tr><th>Ref</th><th>Saved</th><th>Client</th><th class="num">Net sale</th><th class="num">Margin</th>
    <th>Status</th><th>Approved by</th><th>Flags</th><th>Tables</th><th></th></tr></thead><tbody>${r.data.map(x => `<tr>
    <td>${flowEsc(x.ref)}${x.revision > 1 ? ' (rev ' + flowEsc(x.revision) + ')' : ''}</td><td>${flowEsc(String(x.savedAt || '').slice(0, 10))}</td>
    <td class="desc">${flowEsc(x.client)}</td><td class="num">${pp(x.netSale)}</td><td class="num">${pc(x.margin)}</td><td>${flowEsc(x.status)}</td>
    <td>${flowEsc(x.approvedBy || '')}</td><td class="desc">${flowEsc(x.flags)}</td><td>v${flowEsc(x.tablesVersion)}</td>
    <td><button type="button" class="btn btn-sm btn-secondary" data-open="${flowEsc(x.ref)}">Open</button></td></tr>`).join('')}</tbody></table>`;
}
async function peOpen(ref) {
  try {
    const r = await postFlow('peGetRecord', { ref });
    if (!r || !r.success || !r.inputs) throw new Error((r && r.message) || 'Not found.');
    peQ = Object.assign(PE.peBlankQuote(), r.inputs); peRef = r.ref; peRev = r.revision;
    peRenderOrder(); peRenderLines(); peRecalc(); peTab('price');
    const changed = r.tablesVersion !== (peTables.version || 0);
    flowMsg('peMsg', 'Opened ' + r.ref + ' (revision ' + r.revision + ', saved ' + r.status.toLowerCase() + ')' +
      (changed ? '. It was priced with tables v' + r.tablesVersion + '; it is now repriced with v' + (peTables.version || 0) + '.' : '.'), true);
  } catch (e) { flowMsg('peMsg', e.message, false); }
}
function peTab(name) {
  document.querySelectorAll('.pe-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.getElementById('pePrice').hidden = name !== 'price';
  document.getElementById('peSaved').hidden = name !== 'saved';
  document.getElementById('peTables').hidden = name !== 'tables';
  if (name === 'saved') peLoadSaved();
}

/* ── the Tables tab ─────────────────────────────────────────────────────────────────────────────── */
function peRenderTables() {
  const t = peDraftT;
  const n = (path, isPct, attrs) => {
    const v = peGet(t, path);
    const shown = v === null || v === undefined || v === '' ? '' : isPct ? Math.round(v * 10000) / 100 : v;
    return `<input type="number" step="any" min="0" data-t="${flowEsc(path)}"${isPct ? ' data-pct="1"' : ''} value="${flowEsc(shown)}"${attrs || ''}>`;
  };
  const cell = (label, html) => `<div><label>${label}</label>${html}</div>`;
  const fx = PE.PE_CURRENCIES.filter(c => c !== 'PHP').map(c => `<tr><td>${c}</td><td>${n('forex.' + c + '.rate')}</td>
    <td><input type="date" data-t="forex.${c}.asOf" value="${flowEsc((t.forex[c] || {}).asOf || '')}"></td></tr>`).join('');
  const alw = t.allowance.map((a, i) => `<tr><td>${i === t.allowance.length - 1 ? 'over the last' : n('allowance.' + i + '.upTo')}</td><td>${n('allowance.' + i + '.normal', true)}</td><td>${n('allowance.' + i + '.consolidated', true)}</td></tr>`).join('');
  const bands = t.bands.map((b, i) => `<tr><td>${n('bands.' + i + '.from')}</td><td>${b.to === null ? 'and over' : n('bands.' + i + '.to')}</td>
    <td>${b.margin === null ? 'decline or bundle' : n('bands.' + i + '.margin', true)}</td><td>${b.handling !== undefined ? n('bands.' + i + '.handling') : ''}</td></tr>`).join('');
  const terms = PE.PE_TERMS.map(k => cell(k, n('termsDeposit.' + k, true))).join('');
  const princ = PE.PE_PRINCIPALS.map(p => `<tr><td>${flowEsc(p)}</td><td><select data-t="principals.${flowEsc(p)}.currency">${opt(PE.PE_CURRENCIES, (t.principals[p] || {}).currency)}</select></td>
    <td><select data-t="principals.${flowEsc(p)}.freightClass">${opt(PE.PE_CLASSES, (t.principals[p] || {}).freightClass, PE_CLASS_LABEL)}</select></td></tr>`).join('');
  const dest = t.destinations.map((d, i) => `<tr><td><input type="text" data-t="destinations.${i}.name" value="${flowEsc(d.name)}"></td><td>${n('destinations.' + i + '.cbmRate')}</td>
    <td>${n('destinations.' + i + '.minCharge')}</td><td><button type="button" class="btn btn-sm btn-secondary" data-tact="deldest" data-i="${i}">Remove</button></td></tr>`).join('');
  const hist = peVersions.length ? peVersions.map(v => `<li>v${flowEsc(v.version)}, effective ${flowEsc(v.effectiveDate)}${v.note ? ': ' + flowEsc(v.note) : ''} (${flowEsc(v.savedBy)}, ${flowEsc(String(v.savedAt || '').slice(0, 10))})</li>`).join('') : '<li>No version saved yet: the engine uses its starting values.</li>';
  document.getElementById('peTablesForm').innerHTML = `
    <p class="pe-help">Each save is a new version with its effective date; saved quotations keep the version they were priced with.</p>
    <h3>Forex: bank selling rate</h3>
    <table class="pe-table"><thead><tr><th>Currency</th><th>₱ per unit</th><th>As of</th></tr></thead><tbody>${fx}</tbody></table>
    <div class="pe-form">${cell('Buffer (%)', n('forexBuffer', true))}${cell('Buffer, terms over 30 days (%)', n('forexBufferLongTerms', true))}${cell('Out of date after (days)', n('forexStaleDays'))}</div>
    <h3>Import allowance by purchase size (per shipment)</h3>
    <table class="pe-table"><thead><tr><th>Purchase up to (₱)</th><th>Allowance (%)</th><th>Consolidated (%)</th></tr></thead><tbody>${alw}</tbody></table>
    <div class="pe-form">${cell('Fixed cost per shipment (₱)', n('fixedPerShipment'))}${cell('Duty + VAT without an HS rate (%)', n('dutyVatWithoutHs', true))}${cell('Import VAT (%)', n('importVat', true))}${cell('Local pickup (%)', n('localPickup', true))}
      <label class="check"><input type="checkbox" data-t="claimInputVat"${t.claimInputVat ? ' checked' : ''}>Claim import VAT as input VAT</label></div>
    <h3>Freight rates by weight</h3>
    <div class="pe-form">${cell('Courier ₱/kg (class A)', n('freightRates.courierPerKg'))}${cell('Air ₱/kg (classes B, C)', n('freightRates.airPerKg'))}${cell('Sea ₱/CBM (class C)', n('freightRates.seaPerCbm'))}</div>
    <h3>Margin floor by net sale</h3>
    <table class="pe-table"><thead><tr><th>From (₱)</th><th>To (₱)</th><th>Floor margin (%)</th><th>Handling (₱)</th></tr></thead><tbody>${bands}</tbody></table>
    <div class="pe-form">${cell('Tender (%)', n('tenderMargin', true))}${cell('Service lines (%)', n('serviceMargin', true))}${cell('Public price: least margin (%)', n('publicMinMargin', true))}
      ${cell('Public price: floor below street (%)', n('publicFloorBelowStreet', true))}${cell('Public price: quote below street (%)', n('publicPriceBelowStreet', true))}</div>
    <h3>Fixed rates and limits</h3>
    <div class="pe-form">${cell('Commission (%)', n('commission', true))}${cell('Local tax (%)', n('localTax', true))}${cell('VAT (%)', n('vat', true))}${cell('Contingency (%)', n('contingency', true))}
      ${cell('Recommended above floor (%)', n('aboveFloor', true))}${cell('Director approves up to (₱)', n('directorLimit'))}${cell('Ask a forwarder above (₱)', n('estimatedFreightOver'))}
      ${cell('Discount on the spot (%)', n('discountSpot', true))}${cell('Discount with the director (%)', n('discountDirector', true))}</div>
    <h3>Supplier deposit by payment terms (%)</h3>
    <div class="pe-form">${terms}</div>
    <h3>Principal defaults</h3>
    <table class="pe-table"><thead><tr><th>Principal</th><th>Currency</th><th>Freight class</th></tr></thead><tbody>${princ}</tbody></table>
    <h3>Delivery to the client</h3>
    <table class="pe-table"><thead><tr><th>Destination</th><th>₱ per CBM</th><th>Minimum ₱</th><th></th></tr></thead><tbody>${dest}</tbody></table>
    <div class="pe-actions pe-msg"><button type="button" class="btn btn-sm btn-secondary" data-tact="adddest">Add destination</button></div>
    <h3>Save these tables</h3>
    <div class="pe-form"><div><label for="peEff">Effective date</label><input type="date" id="peEff" value="${flowEsc(hxToday())}"></div>
      <div class="wide"><label for="peNote">Note</label><input type="text" id="peNote" maxlength="200" placeholder="e.g. October forex"></div></div>
    <div class="pe-actions pe-msg"><button type="button" class="btn btn-primary" data-tact="save"${peLive ? '' : ' disabled'}>Save as a new version</button>
      <button type="button" class="btn btn-secondary" data-tact="reset">Undo my changes</button>
      <span class="pe-help">${peLive ? 'Changes price the open quotation straight away; save to keep them.' : 'Saving needs FlowAPI 173; changes still price the open quotation.'}</span></div>
    <h3>Approval codes</h3>
    <p class="pe-help">Kept only as a fingerprint; nobody can read them back. The president's code also covers the director's approvals.</p>
    <div class="pe-form">
      <div><label for="peCodeDir">Director's code (${peCodes.director ? 'set' : 'not set'})</label><input type="password" id="peCodeDir" autocomplete="new-password"></div>
      <div class="check"><button type="button" class="btn btn-sm btn-secondary" data-tact="code" data-who="director"${peLive ? '' : ' disabled'}>Set</button></div>
      <div><label for="peCodePres">President's code (${peCodes.president ? 'set' : 'not set'})</label><input type="password" id="peCodePres" autocomplete="new-password"></div>
      <div class="check"><button type="button" class="btn btn-sm btn-secondary" data-tact="code" data-who="president"${peLive ? '' : ' disabled'}>Set</button></div>
    </div>
    <h3>Versions</h3><ul class="pe-explain">${hist}</ul>`;
}
function peTableInput(e) {
  const el = e.target.closest('[data-t]'); if (!el) return;
  let v = peValue(el);
  if (el.type === 'number') v = v === '' ? null : el.dataset.pct ? Number(v) / 100 : Number(v);
  peSet(peDraftT, el.dataset.t, v);
  peTables = clone(peDraftT); peDirty = true;
  peShowStatus(); peSoon();
}
async function peTableClick(e) {
  const b = e.target.closest('[data-tact]'); if (!b) return;
  const act = b.dataset.tact;
  if (act === 'adddest') { peDraftT.destinations.push({ name: 'New destination', cbmRate: 0, minCharge: 0 }); peTables = clone(peDraftT); peDirty = true; peRenderTables(); peRenderOrder(); peShowStatus(); peRecalc(); return; }
  if (act === 'deldest') { peDraftT.destinations.splice(+b.dataset.i, 1); peTables = clone(peDraftT); peDirty = true; peRenderTables(); peRenderOrder(); peShowStatus(); peRecalc(); return; }
  if (act === 'reset') { await peLoadTables(); peRenderOrder(); peRecalc(); flowMsg('peMsg', 'Back to the saved tables.', true); return; }
  if (act === 'code') {
    const who = b.dataset.who, input = document.getElementById(who === 'director' ? 'peCodeDir' : 'peCodePres');
    try {
      const r = await postFlow('peSetApprovalCode', { who, code: input.value });
      if (!r || !r.success) throw new Error((r && r.message) || 'Not set.');
      input.value = ''; peCodes[who] = true; flowMsg('peMsg', r.message, true); peRenderTables();
    } catch (err) { flowMsg('peMsg', err.message, false); }
    return;
  }
  if (act === 'save') {
    b.disabled = true;
    try {
      const r = await postFlow('peSaveTables', { tables: JSON.stringify(peDraftT), effectiveDate: document.getElementById('peEff').value, note: document.getElementById('peNote').value });
      if (!r || !r.success) throw new Error((r && r.message) || 'Not saved.');
      flowMsg('peMsg', r.message, true);
      await peLoadTables(); peRenderOrder(); peRecalc();
    } catch (err) { flowMsg('peMsg', err.message, false); b.disabled = false; }
  }
}
