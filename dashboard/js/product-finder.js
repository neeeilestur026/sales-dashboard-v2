/* product-finder.js — Hi-ESCORP Product Finder (A165)
   Plain-JS rules + JSON data (no AI, no paid services). Safety specs come ONLY from the /data
   JSON files; anything without a verified exact match answers
   "Needs engineer confirmation — Hi-ESCORP will contact you." and is logged — never guessed.
   Reuses the A164 cylinder engine (ptCapacity / ptRecommend / ptPumpSet from
   cylinder-recommender.js, loaded before this file). Catalog updates = edit dashboard/data/*.json;
   the admin screen (pf-admin.html) can also stage a replacement file per device via localStorage. */

/* ── Config: set these once and every "Send to Hi-ESCORP" button uses them ── */
const PF_WHATSAPP_NUMBER = '';                       // e.g. '639171234567' (country code, digits only)
const PF_EMAIL = 'safe3.hi-escorp@hiescorp.com';

const PF_CONFIRM_MSG = 'Needs engineer confirmation — Hi-ESCORP will contact you.';
const PF_DATA_FILES = ['products.json', 'synonyms.json', 'cross_reference.json', 'torque_chart.json'];
const PF_INDUSTRIES = ['cement', 'mining', 'power', 'oil-gas', 'semiconductor', 'shipbuilding'];

/* ─────────────────────────── Data loading (override-aware) ─────────────────────────── */

let pfData = null;      // { products:[], synonyms:[], crossRef:[], torque:[] }
let pfLoading = null;

function pfOverride(file) {
  try { const raw = localStorage.getItem('pf_override_' + file); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}

async function pfFetchFile(file) {
  const ov = pfOverride(file);
  if (ov) return ov;
  const res = await fetch('/data/' + file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(file + ' failed to load (' + res.status + ')');
  return res.json();
}

async function pfLoadData(force) {
  if (pfData && !force) return pfData;
  if (pfLoading && !force) return pfLoading;
  pfLoading = (async () => {
    const [p, s, x, t] = await Promise.all(PF_DATA_FILES.map(pfFetchFile));
    pfData = {
      products: p.products || [],
      synonyms: s.synonyms || [],
      crossRef: x.rows || [],
      torque: t.rows || []
    };
    return pfData;
  })();
  return pfLoading;
}

/* ─────────────────────────── Pure helpers (unit-tested) ─────────────────────────── */

function pfNorm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
/* For model-number comparison: case/space/dash-insensitive so "RC1006" finds "RC-1006". */
function pfModelKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Detect the category the customer's wording means. Longest matching term wins. */
function pfDetectCategory(text, synonyms) {
  const t = ' ' + pfNorm(text) + ' ';
  let best = null;
  (synonyms || []).forEach(group => {
    (group.terms || []).forEach(term => {
      const needle = ' ' + pfNorm(term) + ' ';
      // whole-word-ish containment; also catch term at string edges
      if (t.indexOf(pfNorm(term)) !== -1) {
        if (!best || pfNorm(term).length > best.term.length) best = { category: group.category, term: pfNorm(term) };
      }
    });
  });
  return best;   // {category, term} | null
}

/** Pull a tonnage out of free text ("100 ton jack", "55t") for capacity-proximity ranking. */
function pfExtractTons(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(?:ton(?:s)?\b|t\b)/i);
  return m ? parseFloat(m[1]) : 0;
}

/* 'high-pressure' is a wording group, not a product category — it means UHP couplers/hoses. */
const PF_CATEGORY_ALIAS = { 'high-pressure': ['coupler', 'hose'] };

/** RFQ matcher: category filter + industry boost + capacity proximity. Verified rank above sample. */
function pfRfqMatch(text, industry, data) {
  const det = pfDetectCategory(text, data.synonyms);
  if (!det) return { miss: true, category: null, results: [] };
  const cats = PF_CATEGORY_ALIAS[det.category] || [det.category];
  const wantTons = pfExtractTons(text);
  const uhp = det.category === 'high-pressure';
  const scored = data.products
    .filter(p => cats.includes(p.category))
    .map(p => {
      let score = 1;
      if (p.verified) score += 10;                                   // sample data can never outrank real data
      if (industry && (p.industries || []).includes(industry)) score += 2;
      if (wantTons && p.capacity_tons) {
        const diff = Math.abs(p.capacity_tons - wantTons);
        if (p.capacity_tons >= wantTons) score += Math.max(0, 4 - diff / 25);   // prefer covering the need
        else score -= 2;                                             // below the asked tonnage ranks down
      }
      if (uhp && (p.features || []).some(f => /ultra high pressure|high pressure/i.test(f))) score += 3;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score || (b.p.capacity_tons || 0) - (a.p.capacity_tons || 0));
  return { miss: scored.length === 0, category: det.category, matchedTerm: det.term,
           results: scored.slice(0, 3).map(x => x.p) };
}

/** 1–2 plain-English sentences: why this product fits. */
function pfWhyFits(p, industry) {
  const feats = (p.features || []).slice(0, 3).join(', ');
  let s = feats ? (p.name + ' offers ' + feats + '.') : (p.name + '.');
  if (industry && (p.industries || []).includes(industry)) {
    s += ' It is commonly used in ' + industry.replace('-', ' & ') + ' work like yours.';
  }
  if (!p.verified) s += ' (Sample data — the engineer will confirm the exact item.)';
  return s;
}

/** Resolve pairs_with ids → names for the "Don't forget" cross-sell list. */
function pfPairs(p, products) {
  const byId = {}; products.forEach(x => { byId[x.id] = x; });
  return (p.pairs_with || []).map(id => (byId[id] ? byId[id].name : null)).filter(Boolean);
}

/** Torque lookup — exact bolt+grade row only. Unverified rows go the confirmation path. */
function pfTorqueLookup(bolt, grade, rows) {
  const r = (rows || []).find(x => pfNorm(x.bolt) === pfNorm(bolt) && pfNorm(x.grade) === pfNorm(grade));
  return r || null;
}

/** Coupler safety filter. NEVER returns a coupler rated below the entered pressure, and only
 *  VERIFIED couplers count as matches — samples are surfaced separately, greyed, confirmation-only. */
function pfCouplerMatch(thread, pressureBar, products) {
  const want = pfNorm(thread);
  const pool = (products || []).filter(p =>
    (p.category === 'coupler' || p.category === 'hose') &&
    (!want || pfNorm(p.thread || '') === want) &&
    typeof p.max_pressure_bar === 'number' &&
    p.max_pressure_bar >= pressureBar);            // the hard safety line: ≥ entered pressure, always
  return {
    matches: pool.filter(p => p.verified === true),
    samples: pool.filter(p => p.verified !== true)
  };
}

/** Cross-reference search: exact key match first, then fuzzy containment either way. */
function pfCrossRef(query, rows) {
  const q = pfModelKey(query);
  if (!q) return [];
  const keyed = (rows || []).map(r => ({ r, key: pfModelKey(r.competitor_brand + r.competitor_model), mkey: pfModelKey(r.competitor_model) }));
  const exact = keyed.filter(x => x.key === q || x.mkey === q);
  if (exact.length) return exact.map(x => x.r);
  return keyed.filter(x => x.key.indexOf(q) !== -1 || q.indexOf(x.mkey) !== -1).map(x => x.r);
}

/* ── Calculators (pure math on user inputs — no invented product dimensions) ── */
const pfPsiToBar = psi => psi * 0.0689476;
const pfBarToPsi = bar => bar / 0.0689476;
const pfTonsToKn = t => t * 9.80665;
const pfKnToTons = kn => kn / 9.80665;
/** Oil needed: effective area (cm²) × stroke (cm) → litres. Bore Ø mm → area if area not given. */
function pfOilLitres(boreMm, areaCm2, strokeMm) {
  const area = areaCm2 > 0 ? areaCm2 : (boreMm > 0 ? Math.PI * Math.pow(boreMm / 20, 2) : 0); // (mm/2 → cm)
  if (!(area > 0) || !(strokeMm > 0)) return null;
  return { areaCm2: area, litres: (area * (strokeMm / 10)) / 1000 };
}

/* ── Miss log + inquiry logbook (localStorage; the CSV is the future training dataset) ── */

function pfGetList(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
function pfSetList(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

function pfLogMiss(text) {
  const l = pfGetList('pf_misses');
  l.unshift({ date: new Date().toISOString(), text: String(text || '') });
  pfSetList('pf_misses', l.slice(0, 500));
}

function pfAddInquiry(inq) {
  const l = pfGetList('pf_inquiries');
  const rec = Object.assign({
    id: 'INQ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    date: new Date().toISOString(), status: 'new', notes: ''
  }, inq);
  l.unshift(rec);
  pfSetList('pf_inquiries', l);
  return rec;
}

function pfUpdateInquiry(id, patch) {
  const l = pfGetList('pf_inquiries');
  const i = l.findIndex(x => x.id === id);
  if (i !== -1) { l[i] = Object.assign({}, l[i], patch); pfSetList('pf_inquiries', l); }
}

/** Follow-up needed: still "new" and older than 3 days. */
function pfFollowUpDue(inq, nowMs) {
  return inq.status === 'new' && ((nowMs || Date.now()) - new Date(inq.date).getTime()) > 3 * 86400000;
}

/** CSV incl. the raw text the customer typed (the future training dataset). */
function pfInquiriesCsv(rows) {
  const esc = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['date', 'source', 'client', 'industry', 'raw_text', 'recommendation', 'status', 'notes'];
  return [head.join(',')].concat((rows || []).map(r =>
    [r.date, r.source, r.client, r.industry, r.rawText, r.recommendation, r.status, r.notes].map(esc).join(',')
  )).join('\n');
}

/** "Send to Hi-ESCORP" prefill links. */
function pfShareLinks(text) {
  const t = encodeURIComponent(text);
  const wa = PF_WHATSAPP_NUMBER
    ? 'https://wa.me/' + PF_WHATSAPP_NUMBER + '?text=' + t
    : 'https://api.whatsapp.com/send?text=' + t;
  const mail = 'mailto:' + PF_EMAIL + '?subject=' + encodeURIComponent('Product Finder inquiry') + '&body=' + t;
  return { wa, mail };
}

/* ─────────────────────────── Page wiring (Product Finder tabs) ─────────────────────────── */

const pfEsc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('pfTabs')) return;      // engine-only / admin contexts also load this file
  try {
    await pfLoadData();
    // Autocomplete suggestions from every synonym term
    const dl = document.getElementById('pfSynList');
    if (dl) dl.innerHTML = pfData.synonyms.flatMap(g => g.terms).map(t => '<option value="' + pfEsc(t) + '"></option>').join('');
    pfRenderLog();
  } catch (e) {
    const el = document.getElementById('pfDataErr');
    if (el) { el.style.display = ''; el.textContent = 'Product data failed to load: ' + e.message; }
  }
});

function pfTab(name, btn) {
  document.querySelectorAll('.pf-pane').forEach(p => { p.style.display = p.id === 'pane-' + name ? '' : 'none'; });
  document.querySelectorAll('#pfTabs .pf-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'log') pfRenderLog();
}

function pfMatchTab(name, btn) {
  document.querySelectorAll('.pf-mpane').forEach(p => { p.style.display = p.id === 'mpane-' + name ? '' : 'none'; });
  document.querySelectorAll('.pf-mtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function pfShareBtns(text) {
  const l = pfShareLinks(text);
  return '<div class="cr-actions" style="justify-content:flex-start;margin-top:10px;">'
    + '<a class="cr-btn" style="text-decoration:none;" target="_blank" href="' + pfEsc(l.wa) + '">📱 Send to Hi-ESCORP (WhatsApp)</a>'
    + '<a class="cr-btn cr-btn-sec" style="text-decoration:none;" href="' + pfEsc(l.mail) + '">✉️ Email</a></div>';
}

function pfBadge(verified) {
  return verified
    ? '<span class="pf-badge pf-ok">verified</span>'
    : '<span class="pf-badge pf-sample">sample data — needs engineer confirmation</span>';
}

/* ── Feature 1: RFQ mode ── */
async function pfRfqSubmit() {
  await pfLoadData();
  const text = (document.getElementById('pfItem') || {}).value || '';
  const client = (document.getElementById('pfClient') || {}).value || '';
  const industry = (document.getElementById('pfIndustry') || {}).value || '';
  const purpose = (document.getElementById('pfPurpose') || {}).value || '';
  const qty = (document.getElementById('pfQty') || {}).value || '';
  const box = document.getElementById('pfRfqResult');
  if (!pfNorm(text)) { box.style.display = ''; box.innerHTML = '<p class="cr-hint">Type what the customer needs first.</p>'; return; }

  const m = pfRfqMatch(text, industry, pfData);
  box.style.display = '';
  let recSummary;
  if (m.miss) {
    recSummary = PF_CONFIRM_MSG;
    pfLogMiss(text);
    box.innerHTML = '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3>'
      + '<p class="cr-rec-line">We could not match "' + pfEsc(text) + '" to a product family. '
      + 'The request is logged so our engineer can follow up.</p></div>' + pfShareBtns(pfRfqShareText(text, client, industry, qty, null));
  } else {
    recSummary = m.results.map(p => p.name).join(' | ');
    box.innerHTML = '<p class="cr-capnote">Matched to <b>' + pfEsc(m.category) + '</b> (from "' + pfEsc(m.matchedTerm) + '"). Top options:</p>'
      + m.results.map(p => `
        <div class="cr-rec">
          <div class="cr-rec-label">${pfEsc(p.brand)} ${pfBadge(p.verified)}</div>
          <div class="cr-rec-series">${pfEsc(p.name)}</div>
          <div class="cr-rec-line">${pfEsc(pfWhyFits(p, industry))}</div>
          ${pfPairs(p, pfData.products).length ? '<div class="cr-rec-line"><b>Don’t forget:</b> ' + pfEsc(pfPairs(p, pfData.products).join(' · ')) + '</div>' : ''}
        </div>`).join('')
      + '<p class="cr-hint">Budgetary matches — final model confirmed by Hi-ESCORP engineer.</p>'
      + pfShareBtns(pfRfqShareText(text, client, industry, qty, m.results));
  }
  pfAddInquiry({ source: 'RFQ', client, industry, rawText: text + (purpose ? ' | purpose: ' + purpose : '') + (qty ? ' | qty: ' + qty : ''), recommendation: recSummary });
  pfRenderLog();
}

function pfRfqShareText(text, client, industry, qty, results) {
  return 'Hi-ESCORP Product Finder inquiry\n'
    + (client ? 'Client: ' + client + '\n' : '') + (industry ? 'Industry: ' + industry + '\n' : '')
    + 'Needs: ' + text + (qty ? ' (qty ' + qty + ')' : '') + '\n'
    + (results && results.length ? 'Suggested: ' + results.map(p => p.name).join('; ') : PF_CONFIRM_MSG);
}

/* ── Feature 2: Match mode ── */
async function pfBoltMatch() {
  await pfLoadData();
  const bolt = (document.getElementById('pfBolt') || {}).value || '';
  const grade = (document.getElementById('pfGrade') || {}).value || '';
  const box = document.getElementById('pfBoltResult');
  box.style.display = '';
  const row = pfTorqueLookup(bolt, grade, pfData.torque);
  const byId = {}; pfData.products.forEach(p => { byId[p.id] = p; });
  if (!row) {
    pfLogMiss('torque: ' + bolt + ' grade ' + grade);
    box.innerHTML = '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3><p class="cr-rec-line">No torque data for ' + pfEsc(bolt) + ' grade ' + pfEsc(grade) + ' in our chart yet. Logged for the engineer.</p></div>';
  } else if (!row.verified) {
    box.innerHTML = '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3>'
      + '<p class="cr-rec-line">Our chart holds only <b>sample</b> figures for ' + pfEsc(row.bolt) + ' grade ' + pfEsc(row.grade)
      + ' (~' + pfEsc(row.torque_min_nm) + '–' + pfEsc(row.torque_max_nm) + ' Nm, unconfirmed'
      + (byId[row.wrench_id] ? '; likely tool class: ' + pfEsc(byId[row.wrench_id].name) : '') + '). '
      + 'Torque values are safety-critical, so the engineer must confirm before use.</p></div>';
  } else {
    const w = byId[row.wrench_id];
    const nm = row.torque_min_nm === row.torque_max_nm
      ? '≈ ' + pfEsc(row.torque_min_nm)
      : pfEsc(row.torque_min_nm) + '–' + pfEsc(row.torque_max_nm);
    box.innerHTML = '<div class="cr-rec"><div class="cr-rec-label">Torque ' + pfBadge(true) + '</div>'
      + '<div class="cr-rec-series">' + pfEsc(row.bolt) + ' grade ' + pfEsc(row.grade) + ' → ' + nm + ' Nm</div>'
      + (w ? '<div class="cr-rec-line"><b>Matching wrench:</b> ' + pfEsc(w.name) + ' ' + pfBadge(w.verified) + '</div>' : '')
      + (row.note ? '<div class="cr-rec-line" style="color:#64748b;font-size:12px;">' + pfEsc(row.note) + '</div>' : '')
      + '</div>';
  }
  pfAddInquiry({ source: 'Match-bolt', client: '', industry: '', rawText: bolt + ' grade ' + grade, recommendation: row ? (row.verified ? 'torque row' : 'unverified row — confirmation') : PF_CONFIRM_MSG });
}

async function pfHoseMatch() {
  await pfLoadData();
  const thread = (document.getElementById('pfThread') || {}).value || '';
  const pressure = parseFloat((document.getElementById('pfPressure') || {}).value) || 0;
  const unit = (document.getElementById('pfPressureUnit') || {}).value || 'bar';
  const bar = unit === 'psi' ? pfPsiToBar(pressure) : pressure;
  const box = document.getElementById('pfHoseResult');
  box.style.display = '';
  if (!(bar > 0)) { box.innerHTML = '<p class="cr-hint">Enter the working pressure first — the match must never be rated below it.</p>'; return; }
  const r = pfCouplerMatch(thread, bar, pfData.products);
  let html = '<p class="cr-capnote">Working pressure ' + pressure + ' ' + pfEsc(unit) + (unit === 'psi' ? ' (≈ ' + bar.toFixed(0) + ' bar)' : '') + ' — only items rated <b>at or above</b> this are ever shown.</p>';
  if (r.matches.length) {
    html += r.matches.map(p => '<div class="cr-rec"><div class="cr-rec-label">' + pfEsc(p.brand) + ' ' + pfBadge(true) + '</div>'
      + '<div class="cr-rec-series">' + pfEsc(p.name) + '</div>'
      + '<div class="cr-rec-line">Thread ' + pfEsc(p.thread || '—') + ' · rated ' + pfEsc(p.max_pressure_bar) + ' bar ≥ your ' + bar.toFixed(0) + ' bar.</div></div>').join('');
  } else {
    pfLogMiss('coupler: thread ' + thread + ' @ ' + bar.toFixed(0) + ' bar');
    html += '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3><p class="cr-rec-line">No <b>verified</b> coupler in our data covers this thread + pressure. Logged for the engineer.'
      + (r.samples.length ? ' (Sample rows exist but sample pressure ratings are never used for safety matches.)' : '') + '</p></div>';
  }
  box.innerHTML = html;
  pfAddInquiry({ source: 'Match-hose', client: '', industry: '', rawText: 'thread ' + thread + ' @ ' + pressure + ' ' + unit, recommendation: r.matches.length ? r.matches.map(p => p.name).join('; ') : PF_CONFIRM_MSG });
}

async function pfCylMatch() {
  await pfLoadData();
  const tons = parseFloat((document.getElementById('pfCylTons') || {}).value) || 0;
  const acting = (document.getElementById('pfCylActing') || {}).value || 'single';
  const power = (document.getElementById('pfCylPower') || {}).value || '';
  const usage = (document.getElementById('pfCylUsage') || {}).value || 'occasional';
  const box = document.getElementById('pfCylResult');
  box.style.display = '';
  if (!(tons > 0)) { box.innerHTML = '<p class="cr-hint">Enter the cylinder tonnage first.</p>'; return; }
  const pump = ptPumpSet({ tonnage: tons, doubleActing: acting === 'double', points: 1, power, usage, explosive: false });
  box.innerHTML = '<div class="cr-sect"><h3>Pump set for a ' + tons + '-ton ' + (acting === 'double' ? 'double-acting' : 'single-acting') + ' cylinder</h3>'
    + '<ul>' + pump.map(p => '<li>' + pfEsc(p) + '</li>').join('') + '</ul>'
    + '<p class="cr-hint">Budgetary pairing — final set confirmed by Hi-ESCORP engineer.</p></div>'
    + pfShareBtns('Pump set for ' + tons + 't ' + acting + '-acting cylinder:\n' + pump.join('\n'));
  pfAddInquiry({ source: 'Match-cylinder', client: '', industry: '', rawText: tons + 't ' + acting + '-acting, power: ' + (power || 'unknown'), recommendation: pump[0] });
}

/* ── Feature 4: cross-reference ── */
async function pfXrefSearch() {
  await pfLoadData();
  const q = (document.getElementById('pfXrefQ') || {}).value || '';
  const box = document.getElementById('pfXrefResult');
  box.style.display = '';
  const rows = pfCrossRef(q, pfData.crossRef);
  const byId = {}; pfData.products.forEach(p => { byId[p.id] = p; });
  if (!rows.length) {
    pfLogMiss('xref: ' + q);
    box.innerHTML = '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3><p class="cr-rec-line">"' + pfEsc(q) + '" is not in our cross-reference yet. Logged so we can add it.</p></div>';
    return;
  }
  box.innerHTML = rows.map(r => {
    const ours = byId[r.our_id];
    return '<div class="cr-rec"><div class="cr-rec-label">' + pfEsc(r.competitor_brand) + ' ' + pfEsc(r.competitor_model) + ' ' + pfBadge(r.verified === true) + '</div>'
      + '<div class="cr-rec-series">→ ' + pfEsc(ours ? ours.name : r.our_id) + '</div>'
      + (r.note ? '<div class="cr-rec-line">' + pfEsc(r.note) + '</div>' : '')
      + '<div class="cr-actions" style="justify-content:flex-start;margin-top:8px;">'
      + '<button class="cr-btn cr-btn-sec" onclick="pfQuoteFromXref(' + pfEsc(JSON.stringify(ours ? ours.name : r.our_id)).replace(/"/g, '&quot;') + ')">Request quote</button></div></div>';
  }).join('');
}

function pfQuoteFromXref(name) {
  const item = document.getElementById('pfItem');
  if (item) item.value = name;
  pfTab('rfq', document.querySelector('#pfTabs .pf-tab[data-tab="rfq"]'));
  if (item) item.focus();
}

/* ── Feature 5: calculators ── */
function pfCalcTonnage() {
  const load = parseFloat((document.getElementById('pfCalcLoad') || {}).value) || 0;
  const pts = parseFloat((document.getElementById('pfCalcPts') || {}).value) || 1;
  const out = document.getElementById('pfCalcTonOut');
  if (!(load > 0)) { out.textContent = '—'; return; }
  const c = ptCapacity(load, pts);                       // the same engine the selector uses
  out.textContent = c.outOfRange
    ? 'Beyond the 1650-ton range — contact Hi-ESCORP.'
    : ('Required ' + (Math.round(c.required * 100) / 100) + ' t per point → recommend ' + c.tonnage + '-ton' + (c.z ? ' (Z-series)' : ''));
}

function pfCalcOil() {
  const bore = parseFloat((document.getElementById('pfCalcBore') || {}).value) || 0;
  const area = parseFloat((document.getElementById('pfCalcArea') || {}).value) || 0;
  const stroke = parseFloat((document.getElementById('pfCalcStroke') || {}).value) || 0;
  const resv = parseFloat((document.getElementById('pfCalcResv') || {}).value) || 0;
  const out = document.getElementById('pfCalcOilOut');
  const r = pfOilLitres(bore, area, stroke);
  if (!r) { out.textContent = 'Enter bore (or area) and stroke.'; return; }
  let t = 'Oil needed ≈ ' + r.litres.toFixed(2) + ' L (area ' + r.areaCm2.toFixed(1) + ' cm²).';
  if (resv > 0) t += r.litres <= resv ? ' Fits the ' + resv + ' L reservoir.' : ' ⚠ MORE than the ' + resv + ' L reservoir — a bigger pump is needed.';
  out.textContent = t;
}

function pfCalcConvert() {
  const v = parseFloat((document.getElementById('pfConvVal') || {}).value) || 0;
  const kind = (document.getElementById('pfConvKind') || {}).value;
  const out = document.getElementById('pfConvOut');
  if (!v) { out.textContent = '—'; return; }
  const f = {
    'psi-bar': () => v + ' psi = ' + pfPsiToBar(v).toFixed(2) + ' bar',
    'bar-psi': () => v + ' bar = ' + pfBarToPsi(v).toFixed(0) + ' psi',
    'tons-kn': () => v + ' t = ' + pfTonsToKn(v).toFixed(1) + ' kN',
    'kn-tons': () => v + ' kN = ' + pfKnToTons(v).toFixed(2) + ' t',
    'mm-in':   () => v + ' mm = ' + (v / 25.4).toFixed(2) + ' in',
    'in-mm':   () => v + ' in = ' + (v * 25.4).toFixed(1) + ' mm'
  }[kind];
  out.textContent = f ? f() : '—';
}

/* ── Feature 6: inquiry logbook ── */
function pfRenderLog() {
  const box = document.getElementById('pfLogBody');
  if (!box) return;
  const status = (document.getElementById('pfLogStatus') || {}).value || '';
  const q = pfNorm((document.getElementById('pfLogSearch') || {}).value || '');
  let rows = pfGetList('pf_inquiries');
  if (status) rows = rows.filter(r => r.status === status);
  if (q) rows = rows.filter(r => [r.client, r.industry, r.rawText, r.recommendation, r.notes].some(v => pfNorm(v).indexOf(q) !== -1));
  const meta = document.getElementById('pfLogMeta');
  if (meta) meta.textContent = rows.length + ' inquiry(ies) on this device';
  if (!rows.length) { box.innerHTML = '<p class="cr-hint">No inquiries yet — every RFQ / Match / Cross-Ref submission is saved here automatically.</p>'; return; }
  box.innerHTML = rows.map(r => `
    <div class="cr-rec" style="border-left-color:${r.status === 'won' ? '#16a34a' : r.status === 'lost' ? '#dc2626' : '#4f46e5'};">
      <div class="cr-rec-label">${pfEsc(String(r.date).slice(0, 10))} · ${pfEsc(r.source)}
        ${pfFollowUpDue(r) ? '<span class="pf-badge pf-follow">follow up!</span>' : ''}</div>
      <div class="cr-rec-line"><b>${pfEsc(r.client || '(no client)')}</b>${r.industry ? ' · ' + pfEsc(r.industry) : ''}</div>
      <div class="cr-rec-line">Asked: ${pfEsc(r.rawText)}</div>
      <div class="cr-rec-line">Shown: ${pfEsc(r.recommendation)}</div>
      <div class="cr-actions" style="justify-content:flex-start;gap:8px;margin-top:6px;">
        <select onchange="pfUpdateInquiry('${pfEsc(r.id)}', {status:this.value}); pfRenderLog();" style="padding:4px 8px;border-radius:8px;border:1px solid #d7dce3;">
          ${['new', 'quoted', 'won', 'lost'].map(s => `<option value="${s}"${r.status === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
        <input type="text" value="${pfEsc(r.notes)}" placeholder="notes"
          onchange="pfUpdateInquiry('${pfEsc(r.id)}', {notes:this.value});"
          style="flex:1;min-width:160px;padding:4px 8px;border-radius:8px;border:1px solid #d7dce3;">
      </div>
    </div>`).join('');
}

function pfExportLog() {
  const csv = pfInquiriesCsv(pfGetList('pf_inquiries'));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'product-finder-inquiries-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
