/* pf-catalog-ui.js — A333 · the Product Finder page: Find a model, Choose a cylinder, Build a set,
 * and the basket.
 *
 * All matching lives in pf-engine.js (pure, tested in Node); this file only draws it. The Power Team
 * files are fetched on first use through pfFetchFile (product-finder.js), so pf-admin's per-device
 * overrides apply here too. The basket is a per-device convenience (localStorage): the shared record
 * is the inquiry the pricing request is started from, as before (A169). No prices anywhere. */

const PFC_FILES = ['pt_catalog.json', 'pt_crossover.json', 'pt_index.json'];
const PFC_BASKET_KEY = 'pf_basket_v1';
const PFC_MODES = ['find', 'select', 'set', 'tools'];
const PFC_KIND_LABEL = { lift: 'Lifting or pressing', pull: 'Pulling or tensioning', puller: 'Hydraulic puller', torque: 'Torque wrench', tool: 'Hydraulic tool' };
const PFC_ITEMS_TITLE = { lift: 'Cylinders', pull: 'Cylinders', torque: 'Torque wrenches', tool: 'Tools' };

let pfcCtx = null;
let pfcLoadingP = null;
let pfcResults = [];          // the answers on screen (after any pick by hand)
let pfcOrig = [];             // the engine's own answers, so a pick can be undone
let pfcSet = null;            // Build a set: { spec, out, resolved, items, pumpModel, pumpQuality, useKit }
let pfcSel = { model: null, useJack: false, out: null, a: null };   // Choose a cylinder
let pfcKind = 'lift';
let pfcBasket = pfcReadBasket();

const pfc$ = id => document.getElementById(id);

/* ── data ── */
async function pfcLoad() {
  if (pfcCtx) return pfcCtx;
  if (!pfcLoadingP) {
    pfcLoadingP = (async () => {
      const [catalog, crossover, index] = await Promise.all(PFC_FILES.map(f => pfFetchFile(f)));
      let crossRef = [];
      try { crossRef = (await pfLoadData()).crossRef || []; } catch (e) { /* the older table is optional */ }
      pfcCtx = pfePrepare({ catalog, crossover, crossRef, index });
      return pfcCtx;
    })();
  }
  try { return await pfcLoadingP; } catch (e) { pfcLoadingP = null; throw e; }
}

function pfcLoadError(e) {
  return '<p class="cr-warn">The Power Team catalog did not load: ' + pfEsc(e && e.message ? e.message : e)
    + '. Reload the page; if it keeps failing, the server needs a restart.</p>';
}

/* ── modes ── */
function pfcTop(name) {
  PFC_MODES.forEach(n => { const pane = pfc$('pfc-' + n); if (pane) pane.hidden = n !== name; });
  document.querySelectorAll('[data-top]').forEach(b => {
    const on = b.getAttribute('data-top') === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  if (name === 'set') pfc$('pfcFromFind').hidden = !pfcResults.some(r => r.best && (r.best.cat === 'cylinder' || r.best.cat === 'torque-wrench'));
  if (name === 'select') pfcSelUpdate();
}

/* ── Find a model ── */
async function pfcFind() {
  const q = (pfc$('pfcQ') || {}).value || '';
  const out = pfc$('pfcFindOut');
  pfcTop('find');
  if (!q.trim()) { out.innerHTML = '<p class="pfc-status">Type or paste what the customer needs first.</p>'; pfc$('pfcQ').focus(); return; }
  out.innerHTML = '<p class="pfc-status">Reading the Power Team catalog…</p>';
  let ctx;
  try { ctx = await pfcLoad(); } catch (e) { out.innerHTML = pfcLoadError(e); return; }
  pfcOrig = pfeMatchAll(q, ctx);
  pfcResults = pfcOrig.slice();
  pfcOrig.filter(r => r.quality === 'none').forEach(r => pfLogMiss(r.line));   // the miss log is the finder's training list
  pfcRenderFind();
}

function pfcRenderFind() {
  const out = pfc$('pfcFindOut');
  const R = pfcResults;
  if (!R.length) { out.innerHTML = '<p class="pfc-status">Nothing to read in that text.</p>'; return; }
  const n = { exact: 0, close: 0, check: 0, none: 0 };
  R.forEach(r => { n[r.quality]++; });
  const pills = ['exact', 'close', 'check', 'none'].filter(q => n[q])
    .map(q => '<span class="pfc-pill pfc-q-' + q + '">' + n[q] + ' ' + pfEsc(PFE_QUALITY_LABEL[q].split(':')[0].toLowerCase()) + '</span>').join('');
  const hasSet = R.some(r => r.best && (r.best.cat === 'cylinder' || r.best.cat === 'torque-wrench'));
  out.innerHTML = '<div class="pfc-sum"><span class="cnt">' + R.length + (R.length === 1 ? ' line' : ' lines') + '</span>' + pills
    + '<span class="acts">'
    + (R.filter(r => r.best).length > 1 ? '<button type="button" class="pfc-btn-sm" data-act="add-all">Add all to basket</button>' : '')
    + (R.length > 1 ? '<button type="button" class="pfc-btn-sm" data-act="xlsx-find">Download Excel</button>' : '')
    + (hasSet ? '<button type="button" class="pfc-btn-sm" data-act="to-set">Build a set from ' + (R.length > 1 ? 'these' : 'this') + '</button>' : '')
    + '</span></div>'
    + R.map((r, i) => pfcCard(r, i)).join('');
}

function pfcReadChips(r) {
  const q = r.req, c = [];
  const chip = (k, v, warn) => c.push('<span class="pfc-chip' + (warn ? ' warn' : '') + '"><b>' + pfEsc(k) + '</b>' + pfEsc(v) + '</span>');
  if (r.category) chip('type', r.category.replace('-', ' '));
  (q.models || []).forEach(m => chip('model', (q.modelText && q.modelText[m]) || m));
  if (q.act) chip('action', q.act === 'SA' ? 'single-acting' : 'double-acting');
  if (q.cap) chip(q.cap.kind === 'load' ? 'load' : 'capacity', q.cap.text + (q.cap.unit === 'metric' ? ' (metric)' : ''));
  if (q.stroke) chip('stroke', q.stroke.text);
  if (q.height.max) chip('height', q.height.max.text.replace(/^.*?:\s*/, '') + ' (max)');
  if (q.height.closed) chip('height', q.height.closed.text.replace(/^.*?:\s*/, '') + ' (closed)');
  if (q.body) chip('material', q.src.body || q.body);
  if (q.pow) chip('power', q.pow);
  if (q.speed) chip('speed', q.speed + '-speed');
  if (q.psi) chip('pressure', q.src.psi);
  if (q.oil) chip('oil', q.src.oil);
  if (q.torque) chip('torque', q.src.torque);
  (q.signals || []).forEach(s => chip('feature', s));
  (q.unused || []).forEach(u => chip('not used', u, true));
  return c.join('');
}

function pfcSpecsHtml(rec) {
  const s = pfeSpecs(rec);
  return s.length ? '<div class="pfc-specs">' + s.map(([k, v]) => '<div><span>' + pfEsc(k) + '</span><strong>' + pfEsc(v) + '</strong></div>').join('') + '</div>' : '';
}

function pfcCard(r, i) {
  const b = r.best;
  const tag = '<div class="pfc-tag"><span class="no">Line ' + (r.n || i + 1) + '</span>'
    + '<span class="pfc-model' + (b ? '' : ' none') + '">' + (b ? pfEsc(b.m) : 'No model yet') + '</span>'
    + '<span class="pfc-pill pfc-q-' + r.quality + '">' + pfEsc(PFE_QUALITY_LABEL[r.quality]) + '</span>'
    + (r.source ? '<span class="pfc-page" title="Printed catalog page, with the PDF page in brackets">' + pfEsc(r.source) + '</span>' : '')
    + '</div>';
  const ladder = r.ladder && r.ladder.length > 1
    ? '<table class="pfc-ladder"><thead><tr><th>Model</th><th class="num">Stroke (in)</th><th class="num">Closed / extended (in)</th><th class="num">Oil (in³)</th><th></th></tr></thead><tbody>'
      + r.ladder.map(x => '<tr><td><b>' + pfEsc(x.m) + '</b></td><td class="num">' + pfEsc(x.stroke) + '</td><td class="num">' + pfEsc(x.closed + ' / ' + x.ext)
        + '</td><td class="num">' + pfEsc(x.oil) + '</td><td><button type="button" class="pfc-btn-sm" data-act="pick" data-i="' + i + '" data-m="' + pfEsc(x.m) + '">Use</button></td></tr>').join('')
      + '</tbody></table>'
    : '';
  const hits = r.hits && r.hits.length
    ? '<ul class="pfc-hits">' + r.hits.map((h, k) => '<li><span class="m">' + pfEsc(h.m) + '</span><span class="h">' + pfEsc(h.head) + (h.text ? ': ' + pfEsc(h.text.slice(0, 110)) : '')
        + '</span><span class="pfc-page">' + pfEsc(h.pg ? 'p.' + h.pg + ' (PDF ' + h.pdf + ')' : 'PDF ' + h.pdf) + '</span>'
        + '<button type="button" class="pfc-btn-sm" data-act="add-hit" data-i="' + i + '" data-k="' + k + '">Add</button></li>').join('') + '</ul>'
    : '';
  const notes = r.notes.length ? '<ul class="pfc-notes">' + r.notes.map(n => '<li>' + pfEsc(n) + '</li>').join('') + '</ul>' : '';
  const diffs = r.diffs.length
    ? '<table class="pfc-diffs"><thead><tr><th>Differs on</th><th>Asked for</th><th>' + pfEsc(b ? b.m : '') + '</th></tr></thead><tbody>'
      + r.diffs.map(d => '<tr' + (d.major ? ' class="major"' : '') + '><td>' + pfEsc(d.field) + (d.major ? ' (check)' : '') + '</td><td>' + pfEsc(d.line) + '</td><td>' + pfEsc(d.model) + '</td></tr>').join('')
      + '</tbody></table>'
    : '';
  const opts = b ? [b].concat(r.alts || []) : [];
  const act = b
    ? '<div class="pfc-act">'
      + '<span class="lbl">Qty</span><input type="number" min="1" value="' + (Number(r.qty) || 1) + '" data-qty="' + i + '" aria-label="Quantity">'
      + (opts.length > 1 ? '<select data-alt="' + i + '" aria-label="Choose another model">' + opts.map(o => '<option value="' + pfEsc(o.m) + '"' + (o.m === b.m ? ' selected' : '') + '>'
          + pfEsc(o.m + (o.cat === 'cylinder' ? ' — ' + o.cap + ' t, ' + o.stroke + ' in' : o.usable ? ' — ' + o.usable + ' in³' : '')) + '</option>').join('') + '</select>' : '')
      + '<button type="button" class="pfc-btn-sm primary" data-act="add" data-i="' + i + '">Add to basket</button>'
      + '<span class="pfc-added" id="pfcAdded' + i + '" aria-live="polite"></span>'
      + '</div>'
    : '';
  return '<article class="pfc-card pfc-q-' + r.quality + '" id="pfcCard' + i + '">' + tag
    + '<div class="pfc-body"><p class="pfc-line">' + pfEsc(r.line) + '</p>'
    + '<div class="pfc-read">' + pfcReadChips(r) + '</div>'
    + (r.basis ? '<div class="pfc-basis">' + pfEsc(r.basis) + '</div>' : '')
    + (r.why.length ? '<p class="pfc-desc">' + pfEsc(r.why.join(' ')) + '</p>' : '')
    + (b ? pfcSpecsHtml(b) : '') + ladder + hits + diffs + notes + act
    + '</div></article>';
}

function pfcRerenderCard(i) {
  const el = pfc$('pfcCard' + i);
  if (el) el.outerHTML = pfcCard(pfcResults[i], i);
}

/* ── the set sheet (Choose a cylinder and Build a set) ── */
/** o = { title, sub, need: [[label, value]], parts: [{ model, qty, role, why, whys, page }], leadFirst,
 *        extra (html), warnings, notes, acts: [[act, label, primary]], addedId } */
function pfcSheetHtml(o) {
  const ctx = pfcCtx;
  const li = (p, lead) => {
    const rec = ctx && ctx.M[p.model];
    const short = rec ? pfeShort(rec) : (p.desc || '');
    const whys = p.whys && p.whys.length ? '<ul class="w">' + p.whys.map(w => '<li>' + pfEsc(w) + '</li>').join('') + '</ul>'
      : p.why ? '<p class="w">' + pfEsc(p.why) + '</p>' : '';
    return '<li' + (lead ? ' class="lead"' : '') + '><span class="q">' + p.qty + ' ×</span>'
      + '<span class="m">' + pfEsc(p.model) + '<small>' + pfEsc(p.role) + '</small></span>'
      + (p.page ? '<span class="pfc-page">' + pfEsc(String(p.page).replace(/^catalog /, '')) + '</span>' : '<span></span>')
      + (short ? '<span class="d">' + pfEsc(short) + '</span>' : '') + whys + '</li>';
  };
  return '<div class="pfc-sheet-head"><h2>' + pfEsc(o.title) + '</h2>' + (o.sub ? '<p>' + pfEsc(o.sub) + '</p>' : '') + '</div>'
    + (o.need && o.need.length ? '<div class="pfc-need">' + o.need.map(([k, v]) => '<div><span>' + pfEsc(k) + '</span><strong>' + pfEsc(v) + '</strong></div>').join('') + '</div>' : '')
    + (o.parts.length ? '<ol class="pfc-plist">' + o.parts.map((p, i) => li(p, o.leadFirst && i === 0)).join('') + '</ol>' : '')
    + (o.extra || '')
    + (o.warnings && o.warnings.length ? '<div class="pfc-warn"><b>Check</b><ul>' + o.warnings.map(w => '<li>' + pfEsc(w) + '</li>').join('') + '</ul></div>' : '')
    + (o.notes && o.notes.length ? '<ul class="pfc-notes">' + o.notes.map(n => '<li>' + pfEsc(n) + '</li>').join('') + '</ul>' : '')
    + (o.acts && o.acts.length && o.parts.length ? '<div class="pfc-act">' + o.acts.map(([a, l, primary]) => '<button type="button" class="pfc-btn-sm' + (primary ? ' primary' : '')
        + '" data-act="' + a + '">' + pfEsc(l) + '</button>').join('') + '<span class="pfc-added" id="' + o.addedId + '" aria-live="polite"></span></div>' : '');
}

function pfcNextSetNo() {
  return 1 + pfcBasket.reduce((a, b) => Math.max(a, Number((String(b.set).match(/^Set (\d+)/) || [])[1]) || 0), 0);
}

/* ── Choose a cylinder ── */
function pfcRadio(name) { const el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }

function pfcSelAnswers() {
  return {
    job: pfcRadio('pfcJob') || 'lift', load: pfc$('pfcSelLoad').value, loadUnit: pfc$('pfcSelLoadU').value,
    points: pfc$('pfcSelPoints').value, travel: pfc$('pfcSelTravel').value, travelUnit: pfc$('pfcSelTravelU').value,
    space: pfc$('pfcSelSpace').value, spaceUnit: pfc$('pfcSelSpaceU').value, power: pfcRadio('pfcPower') || 'manual',
    powered: pfc$('pfcSelPowered').checked, light: pfc$('pfcSelLight').checked, hoseLen: pfc$('pfcSelHose').value,
    model: pfcSel.model, useJack: pfcSel.useJack,
  };
}

let pfcSelTimer = null;
function pfcSelUpdate(resetPick) {
  if (resetPick) { pfcSel.model = null; pfcSel.useJack = false; }
  clearTimeout(pfcSelTimer);
  pfcSelTimer = setTimeout(pfcSelRun, 160);
}

async function pfcSelRun() {
  const sheet = pfc$('pfcSelSheet');
  const a = pfcSelAnswers();
  if (!(Number(a.load) > 0) || !(Number(a.travel) > 0)) {
    const miss = [!(Number(a.load) > 0) ? 'how heavy the load is' : '', !(Number(a.travel) > 0) ? 'how far it must move' : ''].filter(Boolean);
    sheet.innerHTML = '<div class="pfc-sheet-empty"><b>Your set appears here</b>Answer ' + pfEsc(miss.join(' and ')) + '.</div>';
    pfcSel.out = null;
    return;
  }
  let ctx;
  try { ctx = await pfcLoad(); } catch (e) { sheet.innerHTML = pfcLoadError(e); return; }
  const o = pfeSelect(a, ctx);
  pfcSel.out = o; pfcSel.a = a;
  const loadTxt = pfeFmt(Number(a.load)) + ' ' + ({ t: 't', kg: 'kg', ton: 'US tons' }[a.loadUnit] || 't');
  const n = Math.max(1, Math.round(Number(a.points) || 1));
  const sub = loadTxt + (n > 1 ? ' shared by ' + n + ' cylinders' : '') + ', ' + pfeFmt(Number(a.travel)) + ' ' + a.travelUnit + ' of travel'
    + (Number(a.space) > 0 ? ', ' + pfeFmt(Number(a.space)) + ' ' + a.spaceUnit + ' of space' : '');
  if (!o.ok) {
    sheet.innerHTML = pfcSheetHtml({ title: 'No cylinder fits yet', sub, parts: [], warnings: o.warnings });
    return;
  }
  const need = [['Force per cylinder', pfeFmt(o.need.needUs, 1) + ' t at 10,000 psi'], ['Stroke for 80% use', pfeFmt(o.need.wantIn, 2) + ' in or more']];
  if (o.need.spaceIn) need.push(['Space', pfeFmt(o.need.spaceIn, 2) + ' in']);
  const parts = o.set.parts.map((p, i) => Object.assign({}, p, i === 0 ? { whys: o.usingJack ? [o.jack.why] : o.why, why: '' } : {}));
  let extra = '';
  if (!o.usingJack && o.alts.length) {
    extra += '<div class="pfc-alt"><h3>Other cylinders that fit</h3><div class="pfc-swap">'
      + o.alts.map(r => '<button type="button" data-sel-model="' + pfEsc(r.m) + '">' + pfEsc(r.m) + '<small>' + pfEsc(pfeFmt(r.cap) + ' t, ' + pfeFmt(r.stroke) + ' in stroke, '
        + pfeFmt(r.closed) + ' in closed') + '</small></button>').join('')
      + (o.chosen ? '<button type="button" data-sel-model="">Back to the first choice</button>' : '') + '</div></div>';
  }
  if (o.jack) {
    extra += '<div class="pfc-alt">' + (o.usingJack
      ? '<h3>Or a cylinder with a separate pump</h3><button type="button" class="pfc-btn-sm" data-act="sel-cyl">Use ' + pfEsc(o.cylinder.m) + ' and its set instead</button>'
      : '<h3>Or one tool instead</h3><b>' + pfEsc(o.jack.rec.m) + '</b> ' + pfEsc(o.jack.why) + ' <span class="pfc-page">' + pfEsc(o.jack.page.replace(/^catalog /, '')) + '</span>'
        + '<div class="pfc-swap"><button type="button" data-act="sel-jack">Use the jack</button></div>') + '</div>';
  }
  if (o.set.kit && o.set.kit.replaces) {
    extra += '<div class="pfc-kit"><b>' + pfEsc(o.set.kit.model) + '</b>: ' + pfEsc(o.set.kit.why) + ' (' + pfEsc(o.set.kit.page) + ').</div>';
  }
  sheet.innerHTML = pfcSheetHtml({
    title: o.usingJack ? 'Your jack' : 'Your set', sub, need, parts, leadFirst: true, extra,
    warnings: o.warnings.concat(o.set.warnings || []), notes: o.notes.concat(o.set.notes || []),
    acts: [['sel-add', 'Add to basket', true], ['sel-xlsx', 'Download Excel'], ['sel-edit', 'Edit in Build a set']], addedId: 'pfcSelAdded',
  });
}

function pfcSelBasketItems(name) {
  const o = pfcSel.out;
  if (!o || !o.ok) return [];
  return o.set.parts.map((p, i) => ({ model: p.model, qty: p.qty, line: '', quality: 'close',
    basis: i === 0 ? (o.usingJack ? o.jack.why : o.why.join(' ')) : p.why, source: p.page, notes: [], set: name, role: p.role }));
}

/* ── basket ── */
function pfcReadBasket() {
  try { const v = JSON.parse(localStorage.getItem(PFC_BASKET_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function pfcSaveBasket() {
  try { localStorage.setItem(PFC_BASKET_KEY, JSON.stringify(pfcBasket)); } catch (e) { /* private window: the basket lasts this visit */ }
  const n = pfc$('pfcBasketN');
  if (n) n.textContent = String(pfcBasket.length);
  if (pfc$('pfcDrawer') && pfc$('pfcDrawer').classList.contains('open')) pfcRenderBasket();
}

function pfcAddItem(item) {
  const same = pfcBasket.find(b => b.model === item.model && !b.set && !item.set && b.line === item.line);
  if (same) same.qty = (Number(same.qty) || 1) + (Number(item.qty) || 1);
  else pfcBasket.push(Object.assign({ key: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }, item));
}

function pfcItemFrom(r, qty) {
  return { model: r.best.m, qty: Math.max(1, Number(qty) || 1), line: r.line, quality: r.quality, basis: r.basis, source: r.source,
           notes: (r.notes || []).slice(0, 3), set: '', role: '' };
}

function pfcOpenBasket() {
  pfcRenderBasket();
  pfc$('pfcDrawer').classList.add('open');
  pfc$('pfcScrim').hidden = false;
  pfc$('pfcDrawerClose').focus();
}
function pfcCloseBasket() {
  pfc$('pfcDrawer').classList.remove('open');
  pfc$('pfcScrim').hidden = true;
  const btn = pfc$('pfcBasketBtn');
  if (btn) btn.focus();
}

function pfcRenderBasket() {
  const body = pfc$('pfcBasketBody');
  const canPR = pfCanCreatePR();
  pfc$('pfcBasketPR').disabled = !pfcBasket.length || !canPR;
  pfc$('pfcBasketXlsx').disabled = !pfcBasket.length;
  pfc$('pfcBasketHint').textContent = !canPR ? 'Only sales and admin can start a pricing request. Download the Excel and send it to them.'
    : pfcBasket.length ? 'The pricing request opens with these lines filled in: model as the item number, the catalog page in the remarks.' : '';
  if (!pfcBasket.length) { body.innerHTML = '<p class="pfc-empty">The basket is empty. Add answers from Find a model, or a whole set from Choose a cylinder or Build a set.</p>'; return; }
  const groups = [];
  pfcBasket.forEach(b => { const g = b.set || ''; let G = groups.find(x => x.name === g); if (!G) { G = { name: g, items: [] }; groups.push(G); } G.items.push(b); });
  body.innerHTML = groups.map(G => (G.name ? '<div class="pfc-bgroup">' + pfEsc(G.name) + '</div>' : (groups.length > 1 ? '<div class="pfc-bgroup">Single items</div>' : ''))
    + G.items.map(b => {
      const rec = pfcCtx && pfcCtx.M[b.model];
      const d = (b.role ? b.role + ': ' : '') + (rec ? pfeShort(rec) : b.desc || '') + (!b.role && b.line ? ' · from "' + b.line.slice(0, 60) + (b.line.length > 60 ? '…' : '') + '"' : '');
      return '<div class="pfc-bitem"><span class="m">' + pfEsc(b.model) + '</span>'
        + '<input type="number" min="1" value="' + (Number(b.qty) || 1) + '" data-bqty="' + pfEsc(b.key) + '" aria-label="Quantity of ' + pfEsc(b.model) + '">'
        + '<button type="button" class="pfc-x" data-bdel="' + pfEsc(b.key) + '" aria-label="Remove ' + pfEsc(b.model) + '">Remove</button>'
        + '<span class="d">' + pfEsc(String(d).slice(0, 140)) + '</span></div>';
    }).join('')).join('');
}

function pfcCompany() { return ((pfc$('pfcCompany') || {}).value || '').trim(); }

/** Excel through api.js's loadXLSX (SheetJS from the CDN); a CSV of the same rows if that fails. */
async function pfcExcel(items) {
  let ctx;
  try { ctx = await pfcLoad(); } catch (e) { return; }
  const rows = pfeExcelRows(items, ctx);
  const company = pfcCompany();
  const day = new Date().toISOString().slice(0, 10);
  const name = 'Power Team request' + (company ? ' - ' + company.replace(/[\\/:*?"<>|]/g, ' ') : '') + ' - ' + day;
  try {
    await loadXLSX();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [4, 48, 6, 16, 64, 16, 14, 24, 52, 22, 64].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Request');
    const src = ctx.source || {}, xs = ctx.xrefSource || {};
    const about = [
      ['About this file'], [],
      ['Made by', 'Hi-ESCORP Product Finder'], ['Company', company || 'not given'], ['Date', day],
      ['Catalog', (src.file || 'Power Team catalog') + (src.pages ? ', ' + src.pages + ' pages' : '') + (src.sha256 ? ', sha256 ' + src.sha256.slice(0, 12) : '')],
      ['Crossover', (xs.title || '2025 Power Team Crossover Reference') + (xs.url ? ', ' + xs.url : '')],
      [],
      ['Match', 'What it means'],
      [PFE_QUALITY_LABEL.exact, 'The line names this model, or the official crossover gives it.'],
      [PFE_QUALITY_LABEL.close, 'Fits what the line states; read the notes for small differences.'],
      [PFE_QUALITY_LABEL.check, 'Something in the line does not fit or is missing: confirm with the customer or the engineer.'],
      [PFE_QUALITY_LABEL.none, 'Not found: the line is logged for the engineer.'],
      [],
      ['Sizing', 'Cylinders are chosen at 80% of rated capacity and stroke, as the catalog advises (p.7).'],
      ['Capacities', 'US short tons as printed in the catalog; multiply by 0.907 for metric tonnes.'],
      ['Prices', 'Not included. Ask purchasing for current prices.'],
    ];
    const wa = XLSX.utils.aoa_to_sheet(about);
    wa['!cols'] = [{ wch: 30 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wa, 'About');
    XLSX.writeFile(wb, name + '.xlsx');
  } catch (e) {
    const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
    pfDownloadCsv(csv, name + '.csv');
  }
}

/** Start a pricing request from the basket: an inquiry is logged (A169's hand-off), then the PR form. */
function pfcCreatePR() {
  if (!pfcBasket.length || !pfCanCreatePR() || !pfcCtx) return;
  const items = pfePrItems(pfcBasket, pfcCtx);
  const lines = pfcBasket.map(b => b.line).filter((l, i, a) => l && a.indexOf(l) === i);
  const inq = pfAddInquiry({ source: 'Finder', client: pfcCompany(), industry: '',
    rawText: lines.join(' | ').slice(0, 2000) || 'Product Finder basket',
    recommendation: items.map(it => it.qty + ' x ' + it.model).join(', ') });
  pfCreatePR(inq.id, items);
}

/* ── Build a set ── */
function pfcSetKind(kind) {
  pfcKind = kind;
  document.querySelectorAll('#pfcKinds [data-kind]').forEach(b => {
    const on = b.getAttribute('data-kind') === kind;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  document.querySelectorAll('#pfcSetForm [data-for]').forEach(el => { el.hidden = !el.getAttribute('data-for').split(' ').includes(kind); });
  const t = pfc$('pfcItemsTitle');
  if (t) t.textContent = PFC_ITEMS_TITLE[kind] || 'Items';
  const len = pfc$('pfcHoseLen');
  if (len && kind === 'torque' && Number(len.value) < 15) len.value = '15';
  const pow = pfc$('pfcPow');
  if (pow) Array.from(pow.options).forEach(o => { o.disabled = kind === 'torque' && !['electric', 'air'].includes(o.value); });
  if (pow && kind === 'torque' && !['electric', 'air'].includes(pow.value)) pow.value = 'electric';
}

function pfcItemRow(model, qty) {
  return '<div class="pfc-item"><input type="text" value="' + pfEsc(model || '') + '" placeholder="Model, e.g. C108C or RC-108" aria-label="Model">'
    + '<input type="number" min="1" value="' + (Number(qty) || 1) + '" aria-label="Quantity">'
    + '<button type="button" class="pfc-x" data-act="del-item">Remove</button></div>';
}

function pfcSetItems(list) {
  pfc$('pfcItems').innerHTML = (list && list.length ? list : [{ model: '', qty: 1 }]).map(it => pfcItemRow(it.model, it.qty)).join('');
}

function pfcReadItems() {
  return Array.from(document.querySelectorAll('#pfcItems .pfc-item')).map(row => {
    const [m, q] = row.querySelectorAll('input');
    return { text: (m.value || '').trim(), qty: Math.max(1, parseInt(q.value, 10) || 1) };
  }).filter(it => it.text);
}

/** A typed model -> a catalog model: Power Team as is, a competitor's through the crossover. */
function pfcResolve(text, ctx) {
  const up = String(text || '').toUpperCase().trim();
  if (ctx.M[up]) return { model: up, quality: 'exact' };
  const r = pfeMatch(text, ctx);
  if (r.best && r.quality !== 'none') return { model: r.best.m, quality: r.quality, note: text + ' → ' + r.best.m + (r.basis ? ' (' + r.basis + ')' : '') };
  const ix = pfeLookup(up, ctx);
  if (ix) return { model: ix.m, quality: 'check', note: ix.m + ' is in the catalog index only: check its details' };
  return { model: up, quality: 'none' };
}

async function pfcBuild() {
  const out = pfc$('pfcSetOut');
  out.innerHTML = '<p class="pfc-status">Building the set…</p>';
  let ctx;
  try { ctx = await pfcLoad(); } catch (e) { out.innerHTML = pfcLoadError(e); return; }
  const resolved = [];
  const items = pfcKind === 'puller' ? [] : pfcReadItems().map(it => { const r = pfcResolve(it.text, ctx); resolved.push(r); return { model: r.model, qty: it.qty, quality: r.quality }; });
  const pumpText = ((pfc$('pfcPump') || {}).value || '').trim();
  let pumpModel = '', pumpQuality = 'close';
  if (pumpText && (pfcKind === 'lift' || pfcKind === 'pull')) { const r = pfcResolve(pumpText, ctx); resolved.push(r); pumpModel = r.model; pumpQuality = r.quality; }
  const together = (document.querySelector('input[name="pfcTogether"]:checked') || {}).value !== '0';
  const spec = {
    kind: pfcKind, items, pumpPow: pfc$('pfcPow').value, pumpModel, speed: Number(pfc$('pfcSpeed').value) || null,
    hoseLen: Number(pfc$('pfcHoseLen').value) || 6, hoseType: pfc$('pfcHoseType').value, highFlow: pfc$('pfcHighFlow').checked,
    together, gauge: pfc$('pfcGauge').checked, tons: Number(pfc$('pfcTons').value) || null, jaws: pfc$('pfcJaws').value || null,
  };
  if (pfcKind === 'puller' && !spec.tons) { out.innerHTML = '<div class="pfc-sheet-empty"><b>How strong a puller?</b>Type the puller capacity in tons.</div>'; return; }
  if (pfcKind !== 'puller' && !items.length) { out.innerHTML = '<div class="pfc-sheet-empty"><b>Name at least one model</b>A Power Team model such as C108C, or a competitor\'s such as RC-108.</div>'; return; }
  pfcSet = { spec, out: pfeBuildSet(spec, ctx), resolved: resolved.filter(r => r.note), items, pumpModel, pumpQuality, useKit: false };
  pfcRenderSet();
}

function pfcSetParts() {
  const S = pfcSet;
  if (!S) return [];
  if (S.useKit && S.out.kit && S.out.kit.replaces) {
    const k = pfcCtx.M[S.out.kit.model];
    return [{ model: k.m, qty: 1, role: 'catalog set', why: S.out.kit.why, page: pfeSource(k) }]
      .concat(S.out.parts.filter(p => !S.out.kit.replaces.includes(p.model)));
  }
  return S.out.parts;
}

function pfcRenderSet() {
  const S = pfcSet, o = S.out;
  const kit = o.kit && o.kit.replaces
    ? '<div class="pfc-kit"><b>' + pfEsc(o.kit.model) + '</b>: ' + pfEsc(o.kit.why) + ' (' + pfEsc(o.kit.page) + '). '
      + '<button type="button" class="pfc-btn-sm" data-act="use-kit">' + (S.useKit ? 'List the parts separately' : 'Use ' + pfEsc(o.kit.model) + ' instead') + '</button></div>'
    : '';
  const given = ['cylinder', 'torque wrench', 'tool'];
  pfc$('pfcSetOut').innerHTML = pfcSheetHtml({
    title: (PFC_KIND_LABEL[o.kind] || 'Set') + ' set',
    sub: S.resolved.map(r => r.note).join(' · '),
    need: o.oilNeeded ? [['Oil the cylinders take', pfeFmt(o.oilNeeded, 1) + ' in³'], ['Pump holds', o.pump && o.pump.usable ? pfeFmt(o.pump.usable) + ' in³ usable' : 'see the pump']] : [],
    parts: pfcSetParts().map(p => (given.includes(p.role) ? Object.assign({}, p, { why: '' }) : p)),
    extra: kit, warnings: o.warnings, notes: o.notes,
    acts: [['set-add', 'Add set to basket', true], ['set-xlsx', 'Download Excel']], addedId: 'pfcSetAdded',
  });
}

function pfcSetBasketItems(name) {
  const S = pfcSet;
  const q = m => { const it = S.items.find(x => x.model === m); return (it && it.quality === 'exact') || (m === S.pumpModel && S.pumpQuality === 'exact') ? 'exact' : 'close'; };
  const given = ['cylinder', 'torque wrench', 'tool'];
  return pfcSetParts().map(p => ({ model: p.model, qty: p.qty, line: '', quality: q(p.model), basis: given.includes(p.role) ? 'given for this set' : p.why,
    source: p.page, notes: [], set: name, role: p.role }));
}

function pfcFromFind() {
  const items = [], pumps = [];
  pfcResults.forEach(r => {
    if (!r.best) return;
    if (r.best.cat === 'cylinder' || r.best.cat === 'torque-wrench') items.push({ model: r.best.m, qty: Number(r.qty) || 1, cat: r.best.cat });
    else if (r.best.cat === 'pump' && r.best.use !== 'torque-wrench') pumps.push(r.best.m);
  });
  if (!items.length) return false;
  pfcSetKind(items.every(i => i.cat === 'torque-wrench') ? 'torque' : 'lift');
  pfcSetItems(items.filter(i => i.cat === (pfcKind === 'torque' ? 'torque-wrench' : 'cylinder')));
  const pump = pfc$('pfcPump');
  if (pump) pump.value = pumps[0] || '';
  if (pumps[0]) { const p = pfcCtx && pfcCtx.M[pumps[0]]; if (p && p.pow) pfc$('pfcPow').value = p.pow; }
  return true;
}

/** Choose a cylinder -> Build a set, with the same cylinder, count, power and hose. */
function pfcSelToBuild() {
  const o = pfcSel.out, a = pfcSel.a;
  if (!o || !o.ok) return;
  pfcSetKind(a.job === 'pull' ? 'pull' : 'lift');
  pfcSetItems([{ model: o.usingJack ? o.jack.rec.m : o.cylinder.m, qty: o.need.points }]);
  pfc$('pfcPow').value = a.power || 'manual';
  pfc$('pfcPump').value = '';
  pfc$('pfcHoseLen').value = String(a.hoseLen || 6);
  pfcTop('set');
  pfcBuild();
}

/* ── wiring (scripts load at the end of <body>, so the markup is there) ── */
function pfcInit() {
  if (!pfc$('pfcQ')) return;                       // pf-admin.html and engine-only contexts
  pfcSaveBasket();
  pfcSetKind('lift');
  pfcSetItems([]);
  pfc$('pfcFindBtn').addEventListener('click', pfcFind);
  pfc$('pfcQ').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pfcFind(); } });
  document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { pfc$('pfcQ').value = b.getAttribute('data-ex'); pfcFind(); }));

  const modes = Array.from(document.querySelectorAll('[data-top]'));
  modes.forEach((b, i) => {
    b.addEventListener('click', () => pfcTop(b.getAttribute('data-top')));
    b.addEventListener('keydown', e => {                       // arrow keys move along the tab list
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = modes[(i + d + modes.length) % modes.length];
      next.focus(); pfcTop(next.getAttribute('data-top'));
    });
  });

  /* Choose a cylinder: every answer redraws the set */
  const sel = pfc$('pfcSelForm');
  sel.addEventListener('input', () => pfcSelUpdate(true));
  sel.addEventListener('change', () => pfcSelUpdate(true));
  sel.addEventListener('submit', e => e.preventDefault());
  pfc$('pfcSelSheet').addEventListener('click', e => {
    const m = e.target.closest('[data-sel-model]');
    if (m) { pfcSel.model = m.getAttribute('data-sel-model') || null; pfcSel.useJack = false; pfcSelRun(); return; }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.getAttribute('data-act');
    if (act === 'sel-jack') { pfcSel.useJack = true; pfcSelRun(); }
    else if (act === 'sel-cyl') { pfcSel.useJack = false; pfcSelRun(); }
    else if (act === 'sel-add') {
      const n = pfcNextSetNo();
      pfcSelBasketItems('Set ' + n + ': ' + (pfcSel.out.usingJack ? 'jack' : 'cylinder set')).forEach(pfcAddItem);
      pfcSaveBasket();
      const s = pfc$('pfcSelAdded'); if (s) s.textContent = 'Added as set ' + n;
    } else if (act === 'sel-xlsx') pfcExcel(pfcSelBasketItems('Cylinder set'));
    else if (act === 'sel-edit') pfcSelToBuild();
  });

  /* Build a set */
  document.querySelectorAll('#pfcKinds [data-kind]').forEach(b => b.addEventListener('click', () => pfcSetKind(b.getAttribute('data-kind'))));
  pfc$('pfcAddItem').addEventListener('click', () => { pfc$('pfcItems').insertAdjacentHTML('beforeend', pfcItemRow('', 1)); });
  pfc$('pfcFromFind').addEventListener('click', pfcFromFind);
  pfc$('pfcSetForm').addEventListener('submit', e => { e.preventDefault(); pfcBuild(); });
  pfc$('pfcItems').addEventListener('click', e => {
    if (e.target.getAttribute('data-act') !== 'del-item') return;
    const row = e.target.closest('.pfc-item');
    if (row) row.remove();
    if (!document.querySelector('#pfcItems .pfc-item')) pfcSetItems([]);
  });
  pfc$('pfcSetOut').addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || !pfcSet) return;
    const act = t.getAttribute('data-act');
    if (act === 'use-kit') { pfcSet.useKit = !pfcSet.useKit; pfcRenderSet(); }
    else if (act === 'set-add') {
      const n = pfcNextSetNo();
      pfcSetBasketItems('Set ' + n + ': ' + (PFC_KIND_LABEL[pfcSet.out.kind] || 'set')).forEach(pfcAddItem);
      pfcSaveBasket();
      const s = pfc$('pfcSetAdded'); if (s) s.textContent = 'Added as set ' + n;
    } else if (act === 'set-xlsx') pfcExcel(pfcSetBasketItems('Set'));
  });

  /* basket */
  pfc$('pfcBasketBtn').addEventListener('click', pfcOpenBasket);
  pfc$('pfcDrawerClose').addEventListener('click', pfcCloseBasket);
  pfc$('pfcScrim').addEventListener('click', pfcCloseBasket);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pfc$('pfcDrawer').classList.contains('open')) pfcCloseBasket(); });
  pfc$('pfcBasketXlsx').addEventListener('click', () => pfcExcel(pfcBasket));
  pfc$('pfcBasketPR').addEventListener('click', pfcCreatePR);
  let armed = 0;
  pfc$('pfcBasketClear').addEventListener('click', e => {
    if (!pfcBasket.length) return;
    if (Date.now() - armed > 3000) { armed = Date.now(); e.target.textContent = 'Tap again to empty the basket'; setTimeout(() => { e.target.textContent = 'Empty the basket'; }, 3000); return; }
    pfcBasket = []; pfcSaveBasket(); pfcRenderBasket(); e.target.textContent = 'Empty the basket';
  });
  pfc$('pfcBasketBody').addEventListener('change', e => {
    const k = e.target.getAttribute('data-bqty');
    const b = k && pfcBasket.find(x => x.key === k);
    if (b) { b.qty = Math.max(1, parseInt(e.target.value, 10) || 1); pfcSaveBasket(); }
  });
  pfc$('pfcBasketBody').addEventListener('click', e => {
    const k = e.target.getAttribute('data-bdel');
    if (k) { pfcBasket = pfcBasket.filter(x => x.key !== k); pfcSaveBasket(); pfcRenderBasket(); }
  });

  /* Find a model */
  const find = pfc$('pfcFindOut');
  find.addEventListener('change', e => {
    const ai = e.target.getAttribute('data-alt');
    if (ai != null) { pfcResults[ai] = pfeChoose(pfcOrig[ai], e.target.value, pfcCtx); pfcResults[ai].qty = pfcOrig[ai].qty; pfcRerenderCard(+ai); return; }
    const qi = e.target.getAttribute('data-qty');
    if (qi != null) pfcResults[qi].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
  });
  find.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.getAttribute('data-act'), i = Number(t.getAttribute('data-i'));
    if (act === 'add') {
      const r = pfcResults[i];
      pfcAddItem(pfcItemFrom(r, r.qty)); pfcSaveBasket();
      const s = pfc$('pfcAdded' + i); if (s) s.textContent = 'Added';
    } else if (act === 'pick') {
      pfcResults[i] = pfeChoose(pfcOrig[i], t.getAttribute('data-m'), pfcCtx); pfcResults[i].qty = pfcOrig[i].qty; pfcRerenderCard(i);
    } else if (act === 'add-hit') {
      const r = pfcResults[i], h = r.hits[Number(t.getAttribute('data-k'))];
      pfcAddItem({ model: h.m, qty: Number(r.qty) || 1, line: r.line, quality: 'check', basis: 'Picked from the catalog index', source: h.pg ? 'catalog p.' + h.pg + ' (PDF ' + h.pdf + ')' : 'catalog PDF ' + h.pdf,
                   notes: [], set: '', role: '', desc: h.head + (h.text ? ': ' + h.text.slice(0, 120) : '') });
      pfcSaveBasket(); t.textContent = 'Added'; t.disabled = true;
    } else if (act === 'add-all') {
      pfcResults.filter(r => r.best).forEach(r => pfcAddItem(pfcItemFrom(r, r.qty))); pfcSaveBasket();
      t.textContent = 'Added to basket'; t.disabled = true;
    } else if (act === 'xlsx-find') {
      pfcExcel(pfcResults.filter(r => r.best).map(r => pfcItemFrom(r, r.qty)));
    } else if (act === 'to-set') {
      if (pfcFromFind()) { pfcTop('set'); pfc$('pfcFromFind').hidden = false; pfcBuild(); }
    }
  });
}

pfcInit();
