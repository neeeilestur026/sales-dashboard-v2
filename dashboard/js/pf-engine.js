/* pf-engine.js — A333 · Power Team MODEL matching and set building. Pure: no DOM, no fetch.
 *
 * The finder used to know 256 product families and no model numbers. This reads the Power Team
 * catalog itself (data/pt_catalog.json, imported page by page from PT_Catalog_0124_US by
 * tools_pt_catalog.py), the official 2025 Power Team Crossover Reference (data/pt_crossover.json)
 * and the full order-number index (data/pt_index.json), and answers a customer's line with a real
 * orderable model, the catalog page it is printed on, and why.
 *
 * ── HOW A LINE IS ANSWERED ──────────────────────────────────────────────────────────────────────
 *   1. pfeParseLine reads the line — SAP style ("JACK:HYDRAULIC;TYPE:…,LOAD CARRYING CAPACITY:10 TO")
 *      or free text — into fields, each keeping the words it came from.
 *   2. pfeDecode looks for a model in it, in this order: a Power Team model named outright; a row of
 *      the official crossover; a row of the older cross_reference.json; Enerpac's RC naming rule.
 *   3. Otherwise pfeMatch filters the catalog on what the line states (hard filters: category,
 *      action, capacity, body material, power…) and sorts what is left on a fixed, explainable key.
 *   4. Anything outside the structured tables is searched in the index and always marked "check".
 *
 * ── RULES THAT KEEP IT HONEST ───────────────────────────────────────────────────────────────────
 *   • Capacities are the catalog's US short tons (PDF 181: x 0.907 = metric tonnes). A metric figure
 *     ("10 tonne", "100 kN", "10 MT") is compared with the tons at 10,000 psi, never the nominal class,
 *     so a metric request is never under-sized.
 *   • "10 TO" with a competitor model is that model's nominal class; without one, the metric reading
 *     is checked too and the line is marked "check" if the class falls short of it.
 *   • A height of up to 16 in on a cylinder line is almost always the stroke (RC-108's "max height
 *     8 in" is its 8-1/8 in stroke; it extends to about 20 in). It is read as stroke and SAID so.
 *   • A 1.25 x margin is applied only to a stated LOAD, never to a stated capacity.
 *   • Nothing is guessed silently: every answer carries quality exact | close | check | none,
 *     the catalog page, and the notes that produced it. No prices: the price list stays out.
 */

const PFE_TONNE_TO_US = 1 / 0.907;           // catalog PDF 181
const PFE_KN_PER_TONNE = 9.80665;
const PFE_IN_PER_MM = 1 / 25.4;
const PFE_IN3_PER = { in3: 1, cc: 1 / 16.387, l: 61.024, gal: 231 };
const PFE_PH_VOLTS = '220';                   // Philippine mains: prefer the 220 V variant of a powered pump
const PFE_SPECIALTY = ['hollow', 'low', 'locking', 'pull', 'threaded'];
/* General-purpose order: the C series first, then the heavy-lift and high-tonnage families. A
   specialty series (hollow, low height, locking collar, pull, threaded) is offered only when asked. */
const PFE_SERIES_RANK = { C: 0, RGG: 1, R_C: 2, CBT: 3, RA: 4, RD: 0, R_D: 1, RDG: 2,
  RH: 5, RHA: 6, RT: 7, RLS: 5, RSS: 6, RGP: 7, RGL: 5, R_L: 6, RA_L: 7, RP: 5 };
const PFE_MANUAL_SA = ['P12', 'P55', 'P159', 'P300', 'P460'];      // the RPS sets' own pairings (p.52)
const PFE_MANUAL_DA = ['P159D', 'P300D', 'P460D'];
const PFE_MANUAL_ONE = ['P12', 'P55'];                                  // one-speed hand pumps
const PFE_MANUAL_TWO = ['P59', 'P159', 'P300', 'P460'];                  // two-speed hand pumps
const PFE_RC_TONS = ['100', '75', '55', '50', '25', '15', '10', '5'];

/* Competitor pumps whose specs were read from the maker's own page, to show the differences beside
   the crossover answer. Only confirmed rows live here. */
const PFE_COMPETITOR_SPECS = {
  P80: { brand: 'Enerpac', what: 'ULTIMA steel hand pump, two-speed, for single-acting cylinders',
         speed: 2, act: 'SA', lpVol: 1.0, lpPsi: 500, hpVol: 0.15, maxPsi: 10000, usable: 134, wt: 23.6,
         src: 'enerpac.com P80 product page, read 2026-10-15' },
};

/* Series facts printed in the catalog's feature lists, quoted where a line asks about them. */
const PFE_SERIES_FACTS = {
  C: { material: 'solid steel body and a chrome-plated piston rod', coupler: 'a 3/8 in NPTF female half coupler is standard', page: 'catalog p.11, PDF 13' },
};

const PFE_CATEGORY_WORDS = [
  ['torque-wrench', /\b(torque|hydraulic)\s+wrench(es)?\b|\btwhc|\btwlc\b/],
  ['puller', /\bpullers?\b/],
  ['tool', /\bnut\s*splitters?\b|\bflange\s*spreaders?\b|\bspreaders?\b|\bpunch(es)?\b|\bc[\s-]*clamps?\b|\bcutters?\b/],
  ['gauge', /\bgauges?\b|\bgages?\b/],
  ['hose', /\bhoses?\b/],
  ['coupler', /\bcouplers?\b|\bcouplings?\b/],
  ['manifold', /\bmanifolds?\b/],
  ['pump', /\bpumps?\b|\bpower\s*(pack|unit)s?\b/],
  ['cylinder', /\bcylinders?\b|\brams?\b/],
  ['press', /\bpress(es)?\b(?!ure)/],
  ['jack', /\bjacks?\b/],
];

/* ─────────────────────────── small readers ─────────────────────────── */

function pfeN(s) {
  const v = parseFloat(String(s == null ? '' : s).replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return isFinite(v) ? v : null;
}

/** "8", "8.13", "8-1/8", "8 1/8", "1/2" -> inches as a number. */
function pfeFrac(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d+(?:[.,]\d+)?)(?:[\s-]+(\d+)\/(\d+))?$/);
  if (m) return pfeN(m[1]) + (m[2] ? +m[2] / +m[3] : 0);
  m = t.match(/^(\d+)\/(\d+)$/);
  return m ? +m[1] / +m[2] : null;
}

const PFE_LEN = /(\d+(?:[.,]\d+)?(?:[\s-]+\d+\/\d+)?|\d+\/\d+)\s*(inch(?:es)?|in\b\.?|"|”|''|mm\b|cm\b|ft\b|feet\b|foot\b|'|m\b)/i;

/** First length in the text -> { in, text } (feet and metres converted). */
function pfeLength(text) {
  const m = String(text || '').match(PFE_LEN);
  if (!m) return null;
  const v = pfeFrac(m[1]);
  if (v == null) return null;
  const u = m[2].toLowerCase();
  const inches = /^mm/.test(u) ? v * PFE_IN_PER_MM : /^cm/.test(u) ? v * 10 * PFE_IN_PER_MM
    : /^m$/.test(u) ? v * 1000 * PFE_IN_PER_MM : /^(ft|feet|foot|')$/.test(u) ? v * 12 : v;
  return { in: Math.round(inches * 1000) / 1000, text: m[0].trim() };
}

/* ─────────────────────────── 1 · reading a line ─────────────────────────── */

/** Split "KEY:VALUE" pairs: separators are ';' always, ',' only before another KEY: (so 10,000 stays). */
function pfeSapPairs(text) {
  const s = String(text || '');
  const parts = s.split(/;|,(?=\s*[A-Za-z][A-Za-z .\/()-]{0,40}:)/);
  const pairs = [], rest = [];
  parts.forEach(p => {
    const m = p.match(/^\s*([A-Za-z][A-Za-z .\/()-]{0,40}?)\s*:\s*(.*)$/);
    if (m) pairs.push({ k: m[1].trim().toUpperCase().replace(/\s+/g, ' '), v: m[2].trim() });
    else if (p.trim()) rest.push(p.trim());
  });
  return { pairs, rest };
}

/** Candidate model codes in the text, normalised ("RC-108" -> "RC108", "P 80" -> "P80"). */
function pfeModelTokens(text) {
  const out = [];
  const s = String(text || '').toUpperCase();
  const re = /(?:^|[^A-Z0-9])([A-Z]{1,6})[\s-]?(\d[\dA-Z]*(?:[.-][\dA-Z]+)*)(?![A-Z0-9])/g;
  let m;
  while ((m = re.exec(s))) {
    const code = m[1] + m[2];
    if (!out.includes(code)) out.push(code);
    re.lastIndex = m.index + m[0].length - m[2].length;   // a code may follow straight on
  }
  /* a bare order number stands alone: not the tail of "RC-1080", not a quantity like "8000 Nm" */
  const num = /(?:^|[\s,;:(\/])(\d{4,7}[A-Z]{0,3})(?![A-Z0-9-])/g;
  while ((m = num.exec(s))) {
    const after = s.slice(m.index + m[0].length);
    if (/^\s*(?:N\.?\s?M|FT|LBS?|PSI|BAR|MPA|KGS?|KN|MM|CM|IN\b|TONS?|TONNES?|T\b|V\b|VOLTS?|CC|L\b|GAL|RPM|HP|KW|W\b|PCS?|UNITS?)/.test(after)) continue;
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Capacity / load with its unit. unit: 'class' (ton/TO/T), 'metric' (tonne/MT/kN/kg), 'us' (lb). */
function pfeCapacity(text, key) {
  const s = String(text || '');
  const m = s.match(/(\d+(?:[.,]\d+)*)\s*-?\s*(metric\s+tons?|short\s+tons?|tonnes?|tons?|mt|to|t|kn|kgs?|kilograms?|lbs?|pounds?)\b/i);
  if (!m) return null;
  const v = pfeN(m[1]);
  if (v == null || v <= 0) return null;
  const u = m[2].toLowerCase();
  let unit, us;
  if (/^(metric|tonne|mt)/.test(u)) { unit = 'metric'; us = v * PFE_TONNE_TO_US; }
  else if (/^kn/.test(u)) { unit = 'metric'; us = v / PFE_KN_PER_TONNE * PFE_TONNE_TO_US; }
  else if (/^(kg|kilo)/.test(u)) { unit = 'metric'; us = v / 1000 * PFE_TONNE_TO_US; }
  else if (/^(lb|pound)/.test(u)) { unit = 'us'; us = v / 2000; }
  else { unit = u === 'to' || u === 't' ? 'class?' : 'class'; us = v; }
  const kind = /load|lift|weigh/i.test(key || '') && !/capacity|rated|cap\b/i.test(key || '') ? 'load' : 'capacity';
  return { val: v, unit, us: Math.round(us * 100) / 100, text: m[0].trim(), kind };
}

/** Read a customer line into fields. Every field keeps `src` — the words it was read from. */
function pfeParseLine(text) {
  const raw = String(text == null ? '' : text).trim();
  const req = { raw, category: null, act: null, cap: null, stroke: null, height: {}, body: null, pow: null,
    speed: null, psi: null, oil: null, torque: null, volts: null, hose: {}, signals: [], models: [], brand: null, src: {}, unused: [] };
  if (!raw) return req;
  const low = raw.toLowerCase();
  const { pairs } = pfeSapPairs(raw);
  const head = pairs[0];
  const typePair = pairs.find(p => p.k === 'TYPE');

  /* category: the TYPE field beats the noun ("JACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER" is a cylinder) */
  const catOf = t => { const hit = PFE_CATEGORY_WORDS.find(([, re]) => re.test(String(t || '').toLowerCase())); return hit ? hit[0] : null; };
  req.category = (typePair && catOf(typePair.v)) || catOf(head ? head.k + ' ' + head.v : '') || catOf(low);
  if (req.category) req.src.category = typePair && catOf(typePair.v) ? 'TYPE: ' + typePair.v : (head ? head.k : raw.slice(0, 40));

  const used = new Set();
  const take = (p, field) => { used.add(p); req.src[field] = p.k + ': ' + p.v; };
  pairs.forEach(p => {
    const k = p.k, v = p.v;
    if (/CAPACITY|LOAD|TONNAGE|^CAP\b|FORCE/.test(k)) { const c = pfeCapacity(v, k); if (c) { req.cap = c; take(p, 'cap'); } }
    else if (/STROKE/.test(k)) { const l = pfeLength(v) || (pfeN(v) != null ? { in: pfeN(v), text: v } : null); if (l) { req.stroke = { in: l.in, text: l.text, from: 'stroke' }; take(p, 'stroke'); } }
    else if (/HEIGHT|LENGTH/.test(k)) {
      const l = pfeLength(v) || (pfeN(v) != null ? { in: pfeN(v), text: v } : null);
      if (l) {
        const which = /CLOSED|RETRACT|COLLAPS|MIN/.test(k) ? 'closed' : /EXTEND/.test(k) ? 'ext' : 'max';
        req.height[which] = { in: l.in, text: p.k + ': ' + l.text };
        take(p, 'height');
      }
    } else if (/MATERIAL|BODY/.test(k)) { used.add(p); }
    else if (/PRESSURE/.test(k)) { used.add(p); }
    else if (/HOSE|LENGTH/.test(k)) { used.add(p); }
  });

  if (!req.cap) {
    const c = pfeCapacity(raw, /load|lift/i.test(low) && !/capacity/i.test(low) ? 'load' : 'capacity');
    if (c) { req.cap = c; req.src.cap = c.text; }
  }
  if (!req.stroke) {
    const m = raw.match(new RegExp('stroke\\s*(?:of|:|=)?\\s*' + PFE_LEN.source, 'i')) || raw.match(new RegExp(PFE_LEN.source + '\\s*stroke', 'i'));
    if (m) { const l = pfeLength(m[0]); if (l) { req.stroke = { in: l.in, text: m[0].trim(), from: 'stroke' }; req.src.stroke = m[0].trim(); } }
  }
  if (!req.height.max && !req.height.closed) {
    const m = raw.match(new RegExp('(closed|retracted|collapsed|min(?:imum)?|max(?:imum)?|extended)\\.?\\s*height\\s*(?:of|:|=)?\\s*' + PFE_LEN.source, 'i'));
    if (m) {
      const l = pfeLength(m[0].replace(/^[^\d]*/, ''));
      const w = /closed|retract|collaps|min/i.test(m[1]) ? 'closed' : /extend/i.test(m[1]) ? 'ext' : 'max';
      if (l) { req.height[w] = { in: l.in, text: m[0].trim() }; req.src.height = m[0].trim(); }
    }
  }

  if (/\bsingle[\s-]*acting\b|\bs\/a\b|\bspring[\s-]*return/.test(low)) { req.act = 'SA'; req.src.act = (low.match(/single[\s-]*acting|s\/a|spring[\s-]*return/) || [])[0]; }
  else if (/\bdouble[\s-]*acting\b|\bd\/a\b/.test(low)) { req.act = 'DA'; req.src.act = (low.match(/double[\s-]*acting|d\/a/) || [])[0]; }

  if (/alumin(i)?um\b|\balu\b/.test(low)) { req.body = 'aluminum'; req.src.body = 'aluminium'; }
  else if (/\bsteel\b/.test(low)) { req.body = 'steel'; req.src.body = (raw.match(/[a-z]*\s*steel/i) || ['steel'])[0].trim(); }

  const POW = [['manual', /\b(manual|hand|foot)\b/], ['electric', /\b(electric|elec|motori[sz]ed|\d{3}\s?v\b|volts?)\b/],
               ['air', /\b(air|pneumatic)\b/], ['gas', /\b(gas|gasoline|petrol|engine)\b/], ['battery', /\b(battery|cordless)\b/]];
  const pw = POW.find(([, re]) => re.test(low));
  if (pw) { req.pow = pw[0]; req.src.pow = (low.match(pw[1]) || [])[0]; }
  if (/\b(two|2)[\s-]*(speed|stage)/.test(low)) req.speed = 2;
  else if (/\b(single|one|1)[\s-]*(speed|stage)/.test(low)) req.speed = 1;

  const pm = raw.match(/(\d[\d,]*(?:\.\d+)?)\s*(psi|bar|mpa)\b/i);
  if (pm) { const v = pfeN(pm[1]); const u = pm[2].toLowerCase(); req.psi = Math.round(u === 'psi' ? v : u === 'bar' ? v * 14.5038 : v * 145.038); req.src.psi = pm[0]; }
  const tq = raw.match(/(\d[\d,]*(?:\.\d+)?)\s*(ft[\s.-]*lbs?\.?|lbs?[\s.-]*ft|n[\s.·-]*m)\b/i);
  if (tq) { const v = pfeN(tq[1]); req.torque = Math.round(/^n/i.test(tq[2]) ? v / 1.35582 : v); req.src.torque = tq[0]; }
  const vm = raw.match(/\b(110|115|220|230|240|380|440|460)\s*v(?:olts?|ac)?\b/i);
  if (vm) { req.volts = vm[1]; req.src.volts = vm[0]; }
  const om = raw.match(/(\d[\d,]*(?:\.\d+)?)\s*(in3|in³|cu\.?\s?in\.?|cubic\s+inch(?:es)?|cc|cm3|cm³|l|lt|liters?|litres?|gal(?:lons?)?)\b/i);
  if (om) {
    const u = om[2].toLowerCase();
    const f = /^(in|cu|cubic)/.test(u) ? PFE_IN3_PER.in3 : /^(cc|cm)/.test(u) ? PFE_IN3_PER.cc : /^gal/.test(u) ? PFE_IN3_PER.gal : PFE_IN3_PER.l;
    req.oil = Math.round(pfeN(om[1]) * f * 10) / 10; req.src.oil = om[0];
  }

  const SIG = [['hollow', /\bhollow\b|cent(er|re)[\s-]*hole|through[\s-]*hole/], ['low', /\blow[\s-]*(height|profile)\b|\bpancake\b|\bshorty\b/],
               ['locking', /\block[\s-]*(nut|ring|collar)\b|\blocking\b/], ['pull', /\bpull(ing)?[\s-]*(cylinder|type|ram)\b/],
               ['threaded', /\bthreaded\s+(rod|base|plunger)\b/], ['bottle', /\bbottle\b/], ['toe', /\btoe\b/], ['telescoping', /\btelescop/]];
  req.signals = SIG.filter(([, re]) => re.test(low)).map(([k]) => k);

  const hl = req.category === 'hose' ? pfeLength(raw) : null;
  if (hl) req.hose.len = Math.round(hl.in / 12 * 10) / 10;
  if (/3\/8/.test(raw)) req.hose.id = '3/8"'; else if (/1\/4/.test(raw)) req.hose.id = '1/4"';
  if (/poly|urethane|thermoplastic/.test(low)) req.hose.type = 'polyurethane';
  else if (/non[\s-]*conductive/.test(low)) req.hose.type = 'non-conductive';
  else if (/rubber|wire[\s-]*braid/.test(low)) req.hose.type = 'rubber';

  req.models = pfeModelTokens(raw);
  req.modelText = {};
  req.models.forEach(c => {
    const re = new RegExp('(^|[^A-Za-z0-9])(' + c.replace(/^([A-Z]+)(\d)/, '$1[\\s-]?$2').replace(/\./g, '\\.') + ')(?![A-Za-z0-9])', 'i');
    const m = raw.match(re);
    req.modelText[c] = m ? m[2].toUpperCase() : c;
  });
  const bm = low.match(/\b(enerpac|power\s*team|spx|simplex|larzep|holmatro|yale|tangye)\b/);
  if (bm) req.brand = bm[1].replace(/\s+/g, ' ');
  pairs.forEach(p => { if (!used.has(p) && p !== head && p !== typePair) req.unused.push(p.k + ': ' + p.v); });
  return req;
}

/** A pasted list -> lines with quantities. Numbering, "2 x …", "qty 2", "2 pcs" and Excel cells. */
function pfeSplitBulk(text) {
  const out = [];
  const UOM = /^(pcs?|pieces?|units?|sets?|ea|each|lots?|nos?\.?)$/i;
  String(text || '').split(/\r?\n/).forEach(line => {
    if (out.length >= 200 || !line.trim()) return;
    let t = line, qty = null;
    if (t.includes('\t')) {
      const cells = t.split('\t').map(c => c.trim()).filter(Boolean);
      const isInt = c => /^\d{1,4}(\.0+)?$/.test(c);
      const nums = cells.map((c, i) => (isInt(c) ? i : -1)).filter(i => i >= 0);
      const byUom = nums.find(i => UOM.test(cells[i + 1] || '') || UOM.test(cells[i - 1] || ''));
      const qi = byUom !== undefined ? byUom : nums.length >= 2 ? nums[1] : (nums.length === 1 && nums[0] > 0 ? nums[0] : -1);
      if (qi >= 0) qty = parseInt(cells[qi], 10);
      t = cells.filter((c, i) => !nums.includes(i) && !UOM.test(c)).sort((a, b) => b.length - a.length)[0] || '';
    }
    t = t.replace(/^\s*(?:item\s*)?(?:#|no\.?\s*)?\d{1,3}\s*[.):\]-]\s+/i, '');
    let m = t.match(/^\s*(\d{1,4})\s*(?:x|×|pcs?\.?|units?|sets?|ea)\s+(.+)$/i);
    if (m) { qty = qty || +m[1]; t = m[2]; }
    m = t.match(/^(.+?)[\s,;-]+(?:qty\.?\s*:?\s*|x\s*|×\s*)(\d{1,4})\s*(?:pcs?|units?|sets?|ea)?\.?\s*$/i)
      || t.match(/^(.+?)[\s,;-]+(\d{1,4})\s*(?:pcs?|units?|sets?|ea)\.?\s*$/i);
    if (m) { qty = qty || +m[2]; t = m[1]; }
    t = t.trim();
    if (t) out.push({ n: out.length + 1, text: t, qty: qty && qty > 0 ? qty : 1 });
  });
  return out;
}

/* ─────────────────────────── 2 · the data ─────────────────────────── */

/** Index the loaded files once. Any of them may be missing; the engine degrades to what it has. */
function pfePrepare(files) {
  const f = files || {};
  const ctx = { M: {}, X: {}, L: {}, rps: [], idx: null, heads: [], series: {}, source: null };
  const cat = f.catalog || {};
  (cat.models || []).forEach(r => { ctx.M[r.m] = r; if (r.sub === 'cylinder-pump') ctx.rps.push(r); });
  ctx.series = cat.series || {};
  ctx.source = cat._source || null;
  ((f.crossover || {}).rows || []).forEach(r => { (ctx.X[r[0]] = ctx.X[r[0]] || []).push(r); });
  ctx.xrefSource = (f.crossover || {})._source || null;
  (f.crossRef || []).forEach(r => { if (r && r.competitor_model) ctx.L[String(r.competitor_model).toUpperCase().replace(/[^A-Z0-9]/g, '')] = r; });
  if (f.index) { ctx.idx = f.index.rows || []; ctx.heads = f.index.heads || []; }
  return ctx;
}

const pfeFmt = (v, d) => (v == null ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 2 : d }));

/** "catalog p.12 (PDF 14)" */
function pfeSource(rec) {
  if (!rec) return '';
  return rec.pg ? 'catalog p.' + rec.pg + ' (PDF ' + rec.pdf + ')' : 'catalog PDF ' + rec.pdf;
}

/** One plain sentence describing a model, from its own numbers. */
function pfeDescribe(rec, ctx) {
  if (!rec) return '';
  const S = (ctx && ctx.series) || {};
  const r = rec;
  if (r.cat === 'cylinder') {
    const t = (S[r.ser] && S[r.ser].title) || 'Cylinder';
    return t.charAt(0).toUpperCase() + t.slice(1) + ' cylinder, ' + pfeFmt(r.cap) + ' t'
      + (r.t10k ? ' (' + pfeFmt(r.t10k, 1) + ' t at 10,000 psi)' : '')
      + ', stroke ' + pfeFmt(r.stroke) + ' in'
      + (r.closed ? ', closed ' + pfeFmt(r.closed) + ' / extended ' + pfeFmt(r.ext) + ' in' : '')
      + (r.oil ? ', oil ' + pfeFmt(r.oil, 1) + ' in³' : '') + (r.wt ? ', ' + pfeFmt(r.wt, 1) + ' lb' : '');
  }
  if (r.cat === 'pump') {
    const kind = r.pow === 'manual' ? 'Hand pump' : r.pow.charAt(0).toUpperCase() + r.pow.slice(1) + ' pump';
    return kind + (r.speed === 2 ? ', two-speed' : r.speed === 1 ? ', one-speed' : '')
      + ', for ' + (r.act === 'DA' ? 'double' : 'single') + '-acting ' + (r.use === 'torque-wrench' ? 'torque wrenches' : 'cylinders')
      + (r.lpVol ? ': ' + pfeFmt(r.lpVol) + ' in³/stroke to ' + pfeFmt(r.lpPsi) + ' psi, then ' + pfeFmt(r.hpVol, 3) + ' in³/stroke to ' + pfeFmt(r.maxPsi) + ' psi'
        : r.hpVol ? ': ' + pfeFmt(r.hpVol, 3) + ' in³/stroke to ' + pfeFmt(r.maxPsi) + ' psi' : '')
      + (r.usable ? '; ' + pfeFmt(r.usable) + ' in³ usable oil' : '') + (r.flow ? '; ' + pfeFmt(r.flow) + ' in³/min' : '')
      + (r.valve ? '; ' + r.valve + ' valve' : '') + (r.wt ? '; ' + pfeFmt(r.wt, 1) + ' lb' : '')
      + (r.partial ? ' (series figures: confirm the variant)' : '');
  }
  if (r.cat === 'hose') {
    return 'Hose, ' + r.type + ', ' + r.id + ' I.D., ' + pfeFmt(r.len) + ' ft' + (r.burst ? ', ' + pfeFmt(r.burst) + ' psi burst' : '')
      + (r.highFlow ? ', high flow' : '') + (r.withCoupler ? ', with 9798 half coupler and 9800 dust cap' : '');
  }
  if (r.cat === 'gauge') {
    return 'Pressure gauge, ' + pfeFmt(r.face, 1) + ' in face, ' + r.range + (r.tonScale ? ', 0-' + pfeFmt(r.tonScale) + ' ton scale for ' + r.series : '');
  }
  if (r.cat === 'jack') {
    return (r.sub ? r.sub.charAt(0).toUpperCase() + r.sub.slice(1) + ' jack' : 'Jack') + ', ' + pfeFmt(r.cap) + ' t'
      + (r.stroke ? ', stroke ' + pfeFmt(r.stroke) + ' in' : '') + (r.closed ? ', closed ' + pfeFmt(r.closed) + ' in' : '')
      + (r.maxH ? ', max height ' + pfeFmt(r.maxH) + ' in' : '');
  }
  if (r.cat === 'torque-wrench') {
    return 'Hydraulic torque wrench, ' + pfeFmt(r.minTq) + '-' + pfeFmt(r.maxTq) + ' lb-ft' + (r.drive ? ', ' + r.drive.replace(/\s+/g, ' ') + ' drive' : '');
  }
  if (r.parts) return (r.sub ? r.sub.replace(/-/g, ' ') + ': ' : 'Set: ') + r.parts.join(' + ');
  return String(r.desc || '').replace(/\s+/g, ' ').slice(0, 160);
}

/** A few words for a list line or a purchase-request item name: "10 t cylinder, 8.13 in stroke". */
function pfeShort(rec) {
  if (!rec) return '';
  const r = rec;
  if (r.cat === 'cylinder') return pfeFmt(r.cap) + ' t ' + (r.act === 'DA' ? 'double' : 'single') + '-acting cylinder, ' + pfeFmt(r.stroke) + ' in stroke';
  if (r.cat === 'pump') return (r.pow === 'manual' ? 'hand' : r.pow) + ' pump' + (r.speed === 2 ? ', two-speed' : r.speed === 1 ? ', one-speed' : '') + (r.usable ? ', ' + pfeFmt(r.usable) + ' in³ usable oil' : '')
    + (r.use === 'torque-wrench' ? ', for torque wrenches' : '');
  if (r.cat === 'hose') return pfeFmt(r.len) + ' ft ' + r.id + ' ' + r.type + ' hose' + (r.withCoupler ? ' with coupler' : '');
  if (r.cat === 'gauge') return 'gauge, ' + pfeFmt(r.face, 1) + ' in' + (r.tonScale ? ', 0-' + pfeFmt(r.tonScale) + ' t scale' : ', psi');
  if (r.cat === 'jack') return pfeFmt(r.cap) + ' t ' + (r.sub || '') + ' jack';
  if (r.cat === 'torque-wrench') return 'torque wrench, up to ' + pfeFmt(r.maxTq) + ' lb-ft';
  if (r.parts) return (r.sub ? r.sub.replace(/-/g, ' ') : 'set') + ': ' + r.parts.join(' + ');
  /* a description's first phrase: up to its first full stop or its first dimension ("10.65 in / 27.05 cm") */
  return String(r.desc || '').replace(/\s+/g, ' ').split(/(?<=\.)\s|\s(?=\d+(?:\.\d+)?\s?(?:in|cm|mm|lb|kg)\b)/)[0].replace(/\.$/, '').slice(0, 90);
}

/** The spec chips a result card shows (also the Excel columns). */
function pfeSpecs(rec) {
  if (!rec) return [];
  const r = rec, c = [];
  const add = (k, v) => { if (v != null && v !== '') c.push([k, v]); };
  if (r.cat === 'cylinder') {
    add('Capacity', pfeFmt(r.cap) + ' t'); add('At 10,000 psi', r.t10k ? pfeFmt(r.t10k, 1) + ' t' : null);
    add('Stroke', pfeFmt(r.stroke) + ' in'); add('Closed / extended', r.closed ? pfeFmt(r.closed) + ' / ' + pfeFmt(r.ext) + ' in' : null);
    add('Oil', r.oil ? pfeFmt(r.oil, 1) + ' in³' : null); add('Weight', r.wt ? pfeFmt(r.wt, 1) + ' lb' : null);
    add('Action', r.act === 'DA' ? 'double-acting' : 'single-acting'); add('Body', r.body);
  } else if (r.cat === 'pump') {
    add('Power', r.pow); add('Speed', r.speed ? r.speed + '-speed' : null); add('For', r.act === 'DA' ? 'double-acting' : 'single-acting');
    add('1st stage', r.lpVol ? pfeFmt(r.lpVol) + ' in³ to ' + pfeFmt(r.lpPsi) + ' psi' : null);
    add('2nd stage', r.hpVol ? pfeFmt(r.hpVol, 3) + ' in³ to ' + pfeFmt(r.maxPsi) + ' psi' : null);
    add('Usable oil', r.usable ? pfeFmt(r.usable) + ' in³' : null); add('Weight', r.wt ? pfeFmt(r.wt, 1) + ' lb' : null);
  } else if (r.cat === 'hose') {
    add('Type', r.type); add('I.D.', r.id); add('Length', pfeFmt(r.len) + ' ft'); add('Burst', r.burst ? pfeFmt(r.burst) + ' psi' : null);
  } else if (r.cat === 'gauge') {
    add('Face', pfeFmt(r.face, 1) + ' in'); add('Range', r.range); add('Ton scale', r.tonScale ? '0-' + pfeFmt(r.tonScale) + ' t' : null); add('For', r.series);
  } else if (r.cat === 'jack') {
    add('Capacity', pfeFmt(r.cap) + ' t'); add('Stroke', r.stroke ? pfeFmt(r.stroke) + ' in' : null); add('Closed', r.closed ? pfeFmt(r.closed) + ' in' : null);
  } else if (r.cat === 'torque-wrench') {
    add('Torque', pfeFmt(r.minTq) + '-' + pfeFmt(r.maxTq) + ' lb-ft'); add('Drive', r.drive);
  }
  return c;
}

/* ─────────────────────────── 3 · decoding a model ─────────────────────────── */

/** Enerpac RC naming: tonnage then stroke in inches, no leading zero (RC-108 = 10 t, 8 in). */
function pfeRcRule(code) {
  const m = String(code || '').match(/^RC(\d{2,5})$/);
  if (!m) return null;
  for (const t of PFE_RC_TONS) {
    if (!m[1].startsWith(t)) continue;
    const rest = m[1].slice(t.length);
    if (/^[1-9]\d?$/.test(rest) && +rest <= 14) return { cap: +t, stroke: +rest };
  }
  return null;
}

/** The model a line names, directly or through a crossover. */
function pfeDecode(req, ctx) {
  const codes = (req && req.models) || [];
  for (const c of codes) if (ctx.M[c]) return { code: c, via: 'power-team', rec: ctx.M[c], model: c };
  for (const c of codes) {
    const rows = ctx.X[c];
    if (!rows) continue;
    const r = rows[0];
    const pt = r[1][0] && r[1][0][0];
    return { code: c, via: 'crossover', rec: ctx.M[pt] || null, model: pt, row: r, rows, match: r[5], page: r[6],
      rule: pfeRcRule(c), comp: PFE_COMPETITOR_SPECS[c] || null };
  }
  for (const c of codes) {
    const r = ctx.L[c];
    if (r && r.our_model) return { code: c, via: 'cross_reference', rec: ctx.M[r.our_model] || null, model: r.our_model, legacy: r, rule: pfeRcRule(c) };
  }
  for (const c of codes) {
    const rule = pfeRcRule(c);
    if (rule) return { code: c, via: 'rule', rec: null, model: null, rule };
  }
  return null;
}

/* ─────────────────────────── 4 · matching ─────────────────────────── */

const pfeMetric = us => Math.round(us * 0.907 * 10) / 10;

/** Required tons at 10,000 psi for a stated capacity / load, or null. */
function pfeNeedTons(cap) {
  if (!cap) return null;
  const base = cap.unit === 'class' || cap.unit === 'class?' ? null : cap.us;
  if (base == null) return null;
  return cap.kind === 'load' ? base * 1.25 : base;
}

function pfeCylinderFilter(req, ctx, opts) {
  const o = opts || {};
  const asked = PFE_SPECIALTY.filter(s => (req.signals || []).includes(s));
  return Object.values(ctx.M).filter(r => {
    if (r.cat !== 'cylinder') return false;
    const flags = r.flags || [];
    if (req.act && r.act !== req.act) return false;
    if (req.body === 'steel' && r.body !== 'steel') return false;
    if (req.body === 'aluminum' && r.body !== 'aluminum') return false;
    if (asked.length) { if (!asked.every(s => flags.includes(s))) return false; }
    else if (flags.some(f => PFE_SPECIALTY.includes(f))) return false;
    if (req.cap && !o.ignoreCap) {
      const need = pfeNeedTons(req.cap);
      if (need != null) { if ((r.t10k || r.cap) < need - 1e-9) return false; }
      else if (r.cap < req.cap.val * (req.cap.kind === 'load' ? 1.25 : 1) - 1e-9) return false;
    }
    if (req.height.closed && r.closed && r.closed > req.height.closed.in + 0.05) return false;
    return true;
  });
}

function pfeCylinderSort(list, stroke) {
  const key = r => [
    stroke == null ? 0 : Math.abs(r.stroke - stroke) <= 0.5 ? 0 : r.stroke > stroke ? 1 : 2,
    PFE_SERIES_RANK[r.ser] == null ? 9 : PFE_SERIES_RANK[r.ser],
    r.cap,
    stroke == null ? 0 : Math.abs(r.stroke - stroke),
    r.wt || 999,
  ];
  return list.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.m < b.m ? -1 : 1;
  });
}

function pfePumpCandidates(req, ctx) {
  return Object.values(ctx.M).filter(r => r.cat === 'pump' && r.use !== 'torque-wrench'
    && (!req.pow || r.pow === req.pow) && (!req.act || r.act === req.act)
    && !(r.maxPsi && r.maxPsi > 10500 && !(req.psi && req.psi > 10500))
    && (!req.speed || !r.speed || r.speed === req.speed)
    && (!req.oil || !r.usable || r.usable >= req.oil));
}

/** 220 V first in the Philippines unless the line asks for 110/115 V. */
function pfeVoltRank(r, volts) {
  if (r.pow !== 'electric') return 0;
  const is220 = /-(220|230)\b|-E220|220-BS/.test(r.m);
  const low = volts && /^11/.test(volts);
  return (low ? !is220 : is220) ? 0 : 1;
}

function pfePumpSort(list, want) {
  const lu = v => Math.abs(Math.log((v || 1) / (want.usable || 1)));
  return list.slice().sort((a, b) =>
    (a.pow === 'manual' ? 0 : 1) - (b.pow === 'manual' ? 0 : 1)
    || (want.usable ? lu(a.usable) - lu(b.usable) : (a.usable || 1e6) - (b.usable || 1e6))
    || pfeVoltRank(a, want.volts) - pfeVoltRank(b, want.volts)
    || (want.lpVol ? Math.abs(Math.log((a.lpVol || 0.01) / want.lpVol)) - Math.abs(Math.log((b.lpVol || 0.01) / want.lpVol)) : 0)
    || (a.m < b.m ? -1 : 1));
}

/** Compare what the line states with the model's own numbers. */
function pfeDiffs(req, rec, dec) {
  const d = [];
  if (!rec) return d;
  if (rec.cat === 'cylinder') {
    if (req.act && rec.act !== req.act) d.push({ field: 'action', line: req.act, model: rec.act, major: true });
    if (req.body && rec.body !== req.body) d.push({ field: 'body', line: req.body, model: rec.body, major: true });
    if (req.cap) {
      const need = pfeNeedTons(req.cap);
      if (need != null && (rec.t10k || rec.cap) < need - 1e-9) d.push({ field: 'capacity', line: req.cap.text, model: pfeFmt(rec.t10k || rec.cap, 1) + ' t at 10,000 psi', major: true });
      if (need == null && rec.cap < req.cap.val - 1e-9) d.push({ field: 'capacity', line: req.cap.text, model: pfeFmt(rec.cap) + ' t', major: true });
    }
    const named = dec && dec.code && dec.via !== 'power-team';
    if (req.cap && req.cap.unit === 'class?' && !named && pfeMetric(rec.t10k || rec.cap) < req.cap.val) {
      d.push({ field: 'capacity if metric', line: req.cap.text, model: pfeFmt(pfeMetric(rec.t10k || rec.cap), 1) + ' tonnes at 10,000 psi', major: true });
    }
    const s = req.stroke ? req.stroke.in : null;
    if (s != null && Math.abs(rec.stroke - s) > 0.5) d.push({ field: 'stroke', line: req.stroke.text, model: pfeFmt(rec.stroke) + ' in', major: true });
    if (req.height.closed && rec.closed > req.height.closed.in + 0.05) d.push({ field: 'closed height', line: req.height.closed.text, model: pfeFmt(rec.closed) + ' in', major: true });
  }
  if (rec.cat === 'pump') {
    if (req.pow && rec.pow !== req.pow) d.push({ field: 'power', line: req.pow, model: rec.pow, major: true });
    if (req.act && rec.act !== req.act) d.push({ field: 'action', line: req.act, model: rec.act, major: true });
    if (req.speed && rec.speed && rec.speed !== req.speed) d.push({ field: 'speed', line: req.speed + '-speed', model: rec.speed + '-speed', major: false });
    if (req.oil && rec.usable && rec.usable < req.oil) d.push({ field: 'usable oil', line: req.src.oil, model: pfeFmt(rec.usable) + ' in³', major: true });
    const comp = dec && dec.comp;
    if (comp) {
      if (comp.usable && rec.usable && rec.usable < comp.usable * 0.9) d.push({ field: 'usable oil', line: comp.brand + ' ' + dec.code + ' ' + comp.usable + ' in³', model: pfeFmt(rec.usable) + ' in³', major: true });
      else if (comp.usable && rec.usable && rec.usable !== comp.usable) d.push({ field: 'usable oil', line: comp.brand + ' ' + dec.code + ' ' + comp.usable + ' in³', model: pfeFmt(rec.usable) + ' in³', major: false });
      if (comp.lpVol && rec.lpVol && (Math.abs(rec.lpVol - comp.lpVol) > 0.2 || rec.lpPsi !== comp.lpPsi)) {
        d.push({ field: '1st stage', line: comp.brand + ' ' + dec.code + ' ' + comp.lpVol + ' in³/stroke to ' + pfeFmt(comp.lpPsi) + ' psi',
          model: pfeFmt(rec.lpVol) + ' in³/stroke to ' + pfeFmt(rec.lpPsi) + ' psi', major: false });
      }
      if (comp.act && rec.act !== comp.act) d.push({ field: 'action', line: comp.act, model: rec.act, major: true });
      if (comp.maxPsi && rec.maxPsi && rec.maxPsi !== comp.maxPsi) d.push({ field: 'pressure', line: pfeFmt(comp.maxPsi) + ' psi', model: pfeFmt(rec.maxPsi) + ' psi', major: true });
    }
  }
  return d;
}

/** Notes that explain how the line was read. */
function pfeNotes(req, rec, dec) {
  const n = [];
  if (!rec) return n;
  const shown = dec && dec.code ? (req.modelText && req.modelText[dec.code]) || dec.code : null;
  if (rec.cat === 'cylinder') {
    const named = dec && (dec.rule || dec.via === 'power-team') ? (dec.rule ? dec.rule.stroke : rec.stroke) : null;
    const h = req.height.max;
    if (h && !req.stroke) {
      if (named != null && Math.abs(h.in - named) <= 0.5) {
        n.push('"' + h.text + '" is read as the stroke: it equals ' + (shown || rec.m) + '\'s ' + pfeFmt(named) + ' in stroke. '
          + rec.m + ' strokes ' + pfeFmt(rec.stroke) + ' in and extends to ' + pfeFmt(rec.ext) + ' in (closed ' + pfeFmt(rec.closed) + ' in).');
      } else if (named == null && Math.abs(h.in - rec.stroke) <= 0.5) {
        /* read as the stroke by pfeMatch, which says why */
      } else if (Math.abs(h.in - rec.ext) <= 0.5) {
        n.push('"' + h.text + '" matches ' + rec.m + '\'s extended height (' + pfeFmt(rec.ext) + ' in).');
      } else {
        n.push('"' + h.text + '" is not ' + rec.m + '\'s stroke (' + pfeFmt(rec.stroke) + ' in) or extended height (' + pfeFmt(rec.ext) + ' in): confirm what the customer means.');
      }
    }
    if (req.cap && (req.cap.unit === 'class?' || req.cap.unit === 'class')) {
      const tm = pfeMetric(rec.t10k || rec.cap);
      if (dec && dec.code && dec.via !== 'power-team') {
        n.push('"' + req.cap.text + '" is read as the ' + pfeFmt(req.cap.val) + '-ton class of ' + shown + '. ' + rec.m + ' gives '
          + pfeFmt(rec.t10k || rec.cap, 1) + ' US tons (' + pfeFmt(tm, 1) + ' tonnes) at 10,000 psi.');
      } else if (req.cap.unit === 'class?' && tm < req.cap.val) {
        n.push('If "' + req.cap.text + '" means metric tonnes, ' + rec.m + ' gives only ' + pfeFmt(tm, 1) + ' t at 10,000 psi: confirm the unit.');
      }
    }
    if (req.cap && req.cap.kind === 'load') n.push('A 1.25 x margin was applied to the stated load.');
    if (req.cap && /^class/.test(req.cap.unit) && req.cap.kind !== 'load' && rec.cap > req.cap.val && !(dec && dec.code)) {
      n.push('The ' + rec.ser.replace(/_.*$/, '') + ' series has no ' + pfeFmt(req.cap.val) + ' t size: ' + pfeFmt(rec.cap) + ' t is the next one up.');
    }
    const f = PFE_SERIES_FACTS[rec.ser];
    if (req.body && f) n.push('Material: the ' + rec.ser + ' series has a ' + f.material + ' (' + f.page + ').');
  }
  if (rec.cat === 'pump' && dec && dec.comp) {
    n.push(dec.comp.brand + ' ' + shown + ': ' + dec.comp.what + '; ' + dec.comp.lpVol + ' in³/stroke to ' + pfeFmt(dec.comp.lpPsi) + ' psi, '
      + dec.comp.hpVol + ' in³/stroke to ' + pfeFmt(dec.comp.maxPsi) + ' psi, ' + dec.comp.usable + ' in³ usable (' + dec.comp.src + ').');
  }
  if (rec.partial) n.push('Powered-pump figures are series-level in the catalog: confirm voltage, valve and reservoir for the exact variant.');
  if (rec.note) n.push(rec.note);
  return n;
}

/** A stroke ladder when the line gives no stroke: one row per stroke in the best series. */
function pfeLadder(list) {
  if (!list.length) return [];
  const top = list[0];
  return list.filter(r => r.ser === top.ser && r.cap === top.cap).sort((a, b) => a.stroke - b.stroke)
    .map(r => ({ m: r.m, stroke: r.stroke, closed: r.closed, ext: r.ext, oil: r.oil }));
}

/** Score the index for a free-text query. */
function pfeSearchIndex(q, ctx, limit) {
  if (!ctx.idx) return [];
  const s = String(q || '').toUpperCase();
  const words = (s.match(/[A-Z]{3,}/g) || []).filter(w => !/^(THE|AND|FOR|WITH|TON|TONS|TYPE|HYDRAULIC|POWER|TEAM)$/.test(w));
  const codes = pfeModelTokens(s);
  const tons = (s.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:TONS?|T)\b/) || [])[1];
  const best = {};
  ctx.idx.forEach(row => {
    const [m, pdf, pg, h, sec, text] = row;
    const head = ctx.heads[h] || '';
    const hay = (head + ' ' + (text || '')).toUpperCase();
    let sc = 0;
    if (codes.includes(m)) sc += 100;
    else if (codes.some(c => c.length >= 3 && m.startsWith(c))) sc += 30;
    words.forEach(w => { if (head.toUpperCase().includes(w)) sc += 6; else if (hay.includes(w)) sc += 2; });
    if (tons && new RegExp('\\b' + tons + '\\s*(?:-\\s*)?TON').test(hay)) sc += 8;
    if (sc > (best[m] ? best[m].score : 0)) best[m] = { m, pdf, pg, head, section: sec, text: String(text || '').replace(/[■•]\s*/g, ''), score: sc };
  });
  return Object.values(best).filter(x => x.score >= 6).sort((a, b) => b.score - a.score || (a.m < b.m ? -1 : 1)).slice(0, limit || 8);
}

/** Answer one line. */
function pfeMatch(input, ctx) {
  const req = typeof input === 'string' ? pfeParseLine(input) : input;
  const res = { line: req.raw, req, best: null, alts: [], quality: 'none', basis: '', why: [], notes: [], diffs: [],
    source: '', decoded: null, ladder: null, hits: null, category: req.category };
  if (!req.raw) return res;
  const dec = pfeDecode(req, ctx);
  res.decoded = dec;
  const cat = (dec && dec.rec && dec.rec.cat) || (dec && dec.rule ? 'cylinder' : null) || req.category;
  res.category = cat;

  if (dec && dec.rec) {
    const rec = dec.rec;
    res.best = rec;
    if (dec.via === 'power-team') { res.quality = 'exact'; res.basis = 'Power Team ' + rec.m + ' named in the line'; }
    else if (dec.via === 'crossover') {
      res.quality = dec.match === 'S' ? 'close' : 'exact';
      res.basis = 'Official crossover: Enerpac ' + ((req.modelText && req.modelText[dec.code]) || dec.code) + ' → ' + dec.model + (dec.match === 'E' ? ' (equivalent)' : dec.match === 'S' ? ' (similar)' : '')
        + ', 2025 Power Team Crossover Reference p.' + dec.page;
      if (dec.rows.length > 1) res.notes.push('The crossover lists ' + dec.rows.length + ' Power Team answers for ' + dec.code + ': '
        + dec.rows.map(r => r[1].map(x => (x[1] > 1 ? x[1] + ' x ' : '') + x[0]).join(' + ') + ' (' + r[4] + ')').join('; ') + '.');
      const r0 = dec.row;
      if (r0[1].length > 1 || r0[2].length || r0[3].length) {
        res.notes.push('The crossover answer is a combination: ' + r0[1].map(x => (x[1] > 1 ? x[1] + ' x ' : '') + x[0]).join(' + ')
          + (r0[2].length ? ', less ' + r0[2].join(', ') : '') + (r0[3].length ? ', plus ' + r0[3].map(x => x[0]).join(', ') : '') + '.');
      }
    } else { res.quality = 'exact'; res.basis = 'Cross-reference: ' + dec.code + ' → ' + dec.model + ' (' + (dec.legacy.source || 'cross_reference.json') + ')'; }
    res.why.push(pfeDescribe(rec, ctx) + '.');
  } else if (dec && dec.via === 'crossover' && !dec.rec) {
    res.quality = 'check';
    res.basis = 'Official crossover: ' + dec.code + ' → ' + dec.model + ' (p.' + dec.page + '), but ' + dec.model + ' is not in the 2024 catalog';
    res.notes.push('Ask Power Team for ' + dec.model + ': it is newer or older than this catalog.');
    res.hits = pfeSearchIndex(dec.model, ctx, 5);
  } else if (cat === 'cylinder') {
    const r2 = Object.assign({}, req);
    if (dec && dec.rule) {
      if (!r2.stroke) r2.stroke = { in: dec.rule.stroke, text: dec.code + ' (' + dec.rule.stroke + ' in)', from: 'rule' };
      if (!r2.cap) r2.cap = { val: dec.rule.cap, unit: 'class', us: dec.rule.cap, text: dec.code + ' (' + dec.rule.cap + ' t)', kind: 'capacity' };
    }
    let heightAsStroke = false;
    if (!r2.stroke && r2.height.max && r2.height.max.in <= 16) {
      r2.stroke = { in: r2.height.max.in, text: r2.height.max.text, from: 'height' };
      heightAsStroke = true;
    }
    const list = pfeCylinderSort(pfeCylinderFilter(r2, ctx), r2.stroke ? r2.stroke.in : null);
    if (!list.length) {
      res.quality = 'none';
      res.notes.push('No cylinder in the catalog meets every stated value: ' + Object.keys(req.src).join(', ') + '.');
    } else if (!r2.stroke) {
      res.best = list[0];
      res.ladder = pfeLadder(list);
      res.quality = 'check';
      res.basis = 'No stroke in the line: the ' + list[0].ser + '-series ' + pfeFmt(list[0].cap) + ' t strokes are listed to choose from';
      res.why.push(pfeDescribe(list[0], ctx) + '.');
    } else {
      res.best = list[0];
      res.quality = dec && dec.rule ? 'close' : 'close';
      res.basis = dec && dec.rule ? 'Enerpac naming rule: ' + dec.code + ' = ' + dec.rule.cap + ' t, ' + dec.rule.stroke + ' in stroke (not in the crossover table)'
        : 'Catalog search on the stated values';
      res.why.push(pfeDescribe(list[0], ctx) + '.');
      if (heightAsStroke) {
        const h = r2.height.max;
        const minClosed = Math.min(...list.filter(r => r.cap === list[0].cap).map(r => r.closed || 99));
        const byExt = Object.values(ctx.M).filter(r => r.cat === 'cylinder' && r.ser === list[0].ser && r.cap === list[0].cap && r.ext && r.ext <= h.in + 0.25)
          .sort((a, b) => b.ext - a.ext).slice(0, 2).map(r => r.m + ' (extends to ' + pfeFmt(r.ext) + ' in)');
        if (h.in < minClosed) {
          res.notes.push('"' + h.text + '" can only be the stroke: no ' + pfeFmt(list[0].cap) + ' t cylinder here is that short even closed (the shortest closes at '
            + pfeFmt(minClosed) + ' in).');
        } else {
          res.quality = 'check';
          res.notes.push('"' + h.text + '" was read as the stroke. If it is the extended height, only ' + (byExt.join(' or ') || 'a shorter cylinder') + ' fits under it.');
        }
      }
    }
    res.alts = list.slice(1, 5);
  } else if (cat === 'pump') {
    const want = { usable: req.oil, lpVol: null, volts: req.volts };
    const list = pfePumpSort(pfePumpCandidates(req, ctx), want);
    if (list.length) {
      res.best = list[0]; res.alts = list.slice(1, 5);
      res.quality = req.pow && (req.oil || req.speed) ? 'close' : 'check';
      res.basis = 'Catalog search on the stated values' + (req.pow ? '' : ' (no power source stated: manual first)');
      res.why.push(pfeDescribe(list[0], ctx) + '.');
    }
  } else if (cat === 'hose') {
    const h = Object.values(ctx.M).filter(r => r.cat === 'hose' && (!req.hose.type || r.type === req.hose.type) && (!req.hose.id || r.id === req.hose.id) && r.use !== 'torque-wrench')
      .sort((a, b) => (req.hose.len ? (a.len >= req.hose.len ? 0 : 1) - (b.len >= req.hose.len ? 0 : 1) || Math.abs(a.len - req.hose.len) - Math.abs(b.len - req.hose.len) : a.len - b.len)
        || (a.highFlow ? 1 : 0) - (b.highFlow ? 1 : 0) || (a.withCoupler ? 1 : 0) - (b.withCoupler ? 1 : 0) || (a.m < b.m ? -1 : 1));
    if (h.length) { res.best = h[0]; res.alts = h.slice(1, 4); res.quality = req.hose.len ? 'close' : 'check'; res.basis = 'Catalog search on the stated values'; res.why.push(pfeDescribe(h[0], ctx) + '.'); }
  } else if (cat === 'gauge') {
    const t = req.cap ? req.cap.val : null;
    const g = Object.values(ctx.M).filter(r => r.cat === 'gauge' && (!t || !r.tonScale || r.tonScale >= t))
      .sort((a, b) => (t ? (a.tonScale === t ? 0 : a.tonScale ? 1 : 2) - (b.tonScale === t ? 0 : b.tonScale ? 1 : 2) || (a.tonScale || 0) - (b.tonScale || 0) : (a.tonScale ? 1 : 0) - (b.tonScale ? 1 : 0))
        || (a.m < b.m ? -1 : 1));
    if (g.length) {
      res.best = g[0]; res.alts = g.slice(1, 4); res.quality = t && g[0].tonScale === t ? 'close' : 'check';
      res.basis = t ? 'Gauge with a ' + pfeFmt(t) + ' t scale, if the cylinder series matches' : 'Gauges: pick by the cylinder it reads';
      res.why.push(pfeDescribe(g[0], ctx) + '.');
      if (g[0].tonScale) res.notes.push('A ton scale reads correctly only on the cylinder series printed for it: ' + g[0].series + '.');
    }
  } else if (cat === 'torque-wrench' && req.torque) {
    const w = Object.values(ctx.M).filter(r => r.cat === 'torque-wrench' && r.maxTq >= req.torque && (!r.minTq || r.minTq <= req.torque))
      .sort((a, b) => a.maxTq - b.maxTq || (a.m < b.m ? -1 : 1));
    if (w.length) {
      res.best = w[0]; res.alts = w.slice(1, 4); res.quality = 'check';
      res.basis = 'Torque wrenches that reach ' + pfeFmt(req.torque) + ' lb-ft (choose the drive and the nut size with the engineer)';
      res.why.push(pfeDescribe(w[0], ctx) + '.');
      res.notes.push('Run it near 80% of its maximum: ' + w[0].m + ' tops out at ' + pfeFmt(w[0].maxTq) + ' lb-ft.');
    }
  } else if (cat === 'puller' && /hydraulic/i.test(req.raw)) {
    const t = req.cap ? (pfeNeedTons(req.cap) || req.cap.val) : null;
    const k = Object.values(ctx.M).filter(r => r.sub === 'puller-kit' && (!t || r.cap >= t)).sort((a, b) => a.cap - b.cap || b.jaws - a.jaws || (a.m < b.m ? -1 : 1));
    if (k.length) {
      res.best = k[0]; res.alts = k.slice(1, 4); res.quality = t ? 'close' : 'check';
      res.basis = 'Power Team hydraulic puller kits (puller, cylinder, pump, gauge and hose)';
      res.why.push(pfeDescribe(k[0], ctx) + ', ' + k[0].jaws + '-jaw, reach ' + pfeFmt(k[0].reach) + ' in.');
    }
  } else if (cat === 'jack') {
    const want = req.cap ? (pfeNeedTons(req.cap) || req.cap.val) : null;
    const j = Object.values(ctx.M).filter(r => r.cat === 'jack' && (!want || r.cap >= want - 1e-9)
      && (!req.signals.includes('toe') || r.sub === 'toe') && (!req.signals.includes('bottle') || r.sub === 'bottle'))
      .sort((a, b) => a.cap - b.cap || (a.sub === 'bottle' ? 0 : 1) - (b.sub === 'bottle' ? 0 : 1) || (a.m < b.m ? -1 : 1));
    if (j.length) { res.best = j[0]; res.alts = j.slice(1, 4); res.quality = want ? 'close' : 'check'; res.basis = 'Catalog search on the stated values'; res.why.push(pfeDescribe(j[0], ctx) + '.'); }
  }

  if (!res.best && !res.hits) {
    res.hits = pfeSearchIndex(req.raw, ctx, 8);
    if (res.hits.length) { res.quality = 'check'; res.basis = 'Found in the catalog index: pick the right one'; }
    else if (req.models.length && !dec) res.notes.push('Not in the catalog or the crossover: ' + req.models.map(c => req.modelText[c] || c).join(', ') + '. Check the model number.');
  }
  if (res.best) {
    res.source = pfeSource(res.best);
    res.diffs = pfeDiffs(req, res.best, dec);
    res.notes = res.notes.concat(pfeNotes(req, res.best, dec));
    if (res.diffs.some(d => d.major)) res.quality = 'check';
    if (res.best.partial && res.quality === 'exact') res.quality = 'close';
    if (!res.alts.length) res.alts = pfeAlternates(res.best, ctx);
  }
  return res;
}

/** Neighbours of a model: the next strokes in its series, or the pumps either side of it. */
function pfeAlternates(rec, ctx) {
  if (rec.cat === 'cylinder') {
    return Object.values(ctx.M).filter(r => r.cat === 'cylinder' && r.ser === rec.ser && r.cap === rec.cap && r.m !== rec.m)
      .sort((a, b) => Math.abs(a.stroke - rec.stroke) - Math.abs(b.stroke - rec.stroke)).slice(0, 3);
  }
  if (rec.cat === 'pump') {
    return Object.values(ctx.M).filter(r => r.cat === 'pump' && r.pow === rec.pow && r.act === rec.act && r.m !== rec.m && r.use === rec.use
      && !(r.maxPsi && r.maxPsi > 10500) && r.usable)
      .sort((a, b) => Math.abs(Math.log(a.usable / (rec.usable || 1))) - Math.abs(Math.log(b.usable / (rec.usable || 1)))
        || Math.abs((a.lpVol || 0) - (rec.lpVol || 0)) - Math.abs((b.lpVol || 0) - (rec.lpVol || 0))).slice(0, 3);
  }
  return [];
}

/** The user picked another model for a line: same reading, the chosen model's numbers and notes. */
function pfeChoose(res, model, ctx) {
  const rec = ctx.M[model];
  if (!res || !rec || (res.best && res.best.m === model)) return res;
  const out = Object.assign({}, res, { best: rec, chosen: true, source: pfeSource(rec), why: [pfeDescribe(rec, ctx) + '.'],
    basis: 'Chosen by hand from the alternatives' + (res.best ? ' (the finder suggested ' + res.best.m + ')' : '') });
  out.diffs = pfeDiffs(res.req, rec, res.decoded && res.decoded.rec ? null : res.decoded);
  out.notes = pfeNotes(res.req, rec, null);
  out.quality = out.diffs.some(d => d.major) ? 'check' : 'close';
  out.alts = [res.best].concat(res.alts || []).filter(r => r && r.m !== model);
  return out;
}

/** Many lines at once. */
function pfeMatchAll(text, ctx) {
  return pfeSplitBulk(text).map(l => Object.assign(pfeMatch(l.text, ctx), { n: l.n, qty: l.qty }));
}

/* ─────────────────────────── 5 · building a set ─────────────────────────── */

/** A model from the structured catalog, or — for order numbers that only the index knows (nut
    splitters, spreaders…) — a minimal record built from the index row, marked partial. */
function pfeLookup(model, ctx) {
  const m = String(model || '').toUpperCase().trim();
  if (ctx.M[m]) return ctx.M[m];
  const row = (ctx.idx || []).find(r => r[0] === m);
  if (!row) return null;
  const sec = row[4];
  return { m, cat: sec === 'tools' ? 'tool' : sec === 'pullers' ? 'puller' : 'part', desc: (ctx.heads[row[3]] || '') + ': ' + (row[5] || ''),
    pdf: row[1], pg: row[2], partial: true, fromIndex: true };
}

function pfeHose(ctx, len, type, highFlow) {
  const t = type || 'rubber', id = highFlow ? '3/8"' : '1/4"';
  const hs = Object.values(ctx.M).filter(r => r.cat === 'hose' && r.type === t && r.id === id && !r.withCoupler && r.use !== 'torque-wrench');
  const pool = hs.length ? hs : Object.values(ctx.M).filter(r => r.cat === 'hose' && r.type === 'rubber' && r.id === id && !r.withCoupler);
  return pool.sort((a, b) => (a.len >= len ? 0 : 1) - (b.len >= len ? 0 : 1) || Math.abs(a.len - len) - Math.abs(b.len - len) || (a.m < b.m ? -1 : 1))[0] || null;
}

function pfeGaugeFor(ctx, cyls) {
  const one = cyls.every(c => c.ser === cyls[0].ser && c.cap === cyls[0].cap) ? cyls[0] : null;
  if (one) {
    const letter = one.ser.replace(/_.*$/, '');
    const g = Object.values(ctx.M).find(r => r.cat === 'gauge' && r.tonScale === one.cap
      && String(r.series || '').replace(/[†*]/g, '').split(/,|&/).map(s => s.trim()).includes(letter));
    if (g) return { rec: g, why: 'reads the load in tons for ' + letter + '-series ' + pfeFmt(one.cap) + ' t cylinders (0-' + pfeFmt(g.tonScale) + ' t scale)' };
  }
  const g = ctx.M['9040'];
  return g ? { rec: g, why: one ? 'no tonnage gauge for ' + one.ser.replace(/_.*$/, '') + '-series ' + pfeFmt(one.cap) + ' t in this catalog: a psi gauge'
    : 'mixed cylinder sizes read differently in tons, so a psi gauge' } : null;
}

/** The hand pump for `needed` in³: the catalog's own pairings, or one-speed / two-speed when asked
 *  (p.49-51: P12 and P55 are one-speed; P59, P159, P300 and P460 two-speed; every D pump is two-speed). */
function pfePickManual(ctx, act, needed, maxCap, speed) {
  const ok = m => ctx.M[m] && !(m === 'P12' && maxCap > 5);
  const first = l => l.filter(ok).find(m => ctx.M[m].usable >= needed) || null;
  if (act === 'DA') {
    const m = first(PFE_MANUAL_DA) || PFE_MANUAL_DA[PFE_MANUAL_DA.length - 1];
    return { m, note: speed === 1 ? 'No one-speed hand pump drives a double-acting cylinder: ' + m + ' is two-speed.' : '' };
  }
  if (speed === 1) {
    const m = first(PFE_MANUAL_ONE);
    if (m) return { m, note: '' };
    const t = first(PFE_MANUAL_TWO) || 'P460';
    return { m: t, note: 'No one-speed hand pump holds ' + pfeFmt(needed, 1) + ' in³: ' + t + ' is two-speed.' };
  }
  if (speed === 2) return { m: first(PFE_MANUAL_TWO) || 'P460', note: '' };
  const l = PFE_MANUAL_SA.filter(ok);
  return { m: l.find(m => ctx.M[m].usable >= needed) || l[l.length - 1], note: '' };
}

function pfePickPowered(ctx, pow, act, needed) {
  const cand = Object.values(ctx.M).filter(r => r.cat === 'pump' && r.pow === pow && r.use !== 'torque-wrench'
    && (r.valve ? (/4-Way/i.test(r.valve) ? 'DA' : 'SA') === act : r.act === act));
  const ok = cand.filter(r => r.usable && r.usable >= needed);
  const pool = ok.length ? ok : cand;
  return pool.sort((a, b) => ((a.usable || 1e6) - (b.usable || 1e6))
    || pfeVoltRank(a) - pfeVoltRank(b)
    || (a.m.length - b.m.length) || (a.m < b.m ? -1 : 1))[0] || null;
}

/**
 * spec = { kind: 'lift'|'pull'|'puller'|'torque'|'tool', items: [{ model, qty }], pumpPow, pumpModel,
 *          speed, hoseLen (ft), hoseType, highFlow, together (bool), gauge (bool), tons (puller), jaws }
 * -> { kind, parts: [{ model, qty, role, why, page }], kit, warnings, notes, oilNeeded, pump }
 */
function pfeBuildSet(spec, ctx) {
  const s = Object.assign({ kind: 'lift', items: [], pumpPow: 'manual', hoseLen: 6, hoseType: 'rubber', highFlow: false, together: true, gauge: true }, spec || {});
  const out = { kind: s.kind, parts: [], kit: null, kits: [], warnings: [], notes: [], oilNeeded: null, pump: null };
  const add = (rec, qty, role, why) => {
    if (!rec || !qty) return;
    const have = out.parts.find(p => p.model === rec.m && p.role === role);
    if (have) { have.qty += qty; return; }
    out.parts.push({ model: rec.m, qty, role, why, page: pfeSource(rec), desc: pfeDescribe(rec, ctx) });
  };
  const items = (s.items || []).map(it => ({ rec: pfeLookup(it.model, ctx), model: it.model, qty: Math.max(1, Number(it.qty) || 1) }));
  items.filter(it => !it.rec).forEach(it => out.warnings.push(String(it.model) + ' is not in the catalog: it was left out of the set.'));
  const known = items.filter(it => it.rec);

  if (s.kind === 'puller') {
    const tons = Number(s.tons) || (known[0] && known[0].rec.cap) || null;
    const kits = Object.values(ctx.M).filter(r => r.sub === 'puller-kit' && (!tons || r.cap >= tons) && (!s.jaws || r.jaws === Number(s.jaws)))
      .sort((a, b) => a.cap - b.cap || b.jaws - a.jaws || (a.m < b.m ? -1 : 1));
    if (kits.length) {
      const k = kits[0];
      out.kit = { model: k.m, why: 'Power Team\'s own hydraulic puller kit: ' + k.parts.join(' + ') + ', with gauge and 10 ft hose', page: pfeSource(k) };
      add(k, 1, 'puller kit', pfeDescribe(k, ctx));
      out.kits = kits.filter(x => x.cap === k.cap).map(x => x.m);
      if (out.kits.length > 1) out.notes.push('Same capacity, ' + out.kits.join(' / ') + ': 3-jaw and 2-jaw versions.');
    } else out.warnings.push('No catalog puller kit covers ' + tons + ' t: ask the engineer.');
    return out;
  }

  if (s.kind === 'torque') {
    const n = known.reduce((a, it) => a + it.qty, 0);
    known.forEach(it => add(it.rec, it.qty, 'torque wrench', pfeDescribe(it.rec, ctx)));
    const four = n > 1;
    const air = s.pumpPow === 'air';
    if (!air && s.pumpPow !== 'electric') out.notes.push('Torque-wrench pumps in this catalog are electric or air: the electric one is used.');
    const pumpM = air ? (four ? 'RWP55-4-BS' : 'RWP55-BS') : (four ? 'PE55TWP-4-E' + PFE_PH_VOLTS : 'PE55TWP-E' + PFE_PH_VOLTS);
    const pump = ctx.M[pumpM];
    if (pump) { add(pump, 1, 'pump', (air ? 'air' : 'electric ' + PFE_PH_VOLTS + ' V') + ' torque-wrench pump' + (four ? ' with 4 outlets for ' + n + ' wrenches' : '')); out.pump = pump; }
    const twh = Object.values(ctx.M).filter(r => r.cat === 'hose' && r.use === 'torque-wrench').sort((a, b) => (a.len >= s.hoseLen ? 0 : 1) - (b.len >= s.hoseLen ? 0 : 1) || a.len - b.len)[0];
    if (twh) add(twh, Math.max(1, n), 'twin hose', 'one twin hose per wrench, ' + pfeFmt(twh.len) + ' ft');
    if (n > 4) out.warnings.push(n + ' wrenches: a 4-outlet pump runs 4 at a time.');
    out.notes.push('Torque-wrench pumps are 10,000 psi double-acting units with their own twin hoses; they are not for lifting.');
    return out;
  }

  if (s.kind === 'tool') {
    known.forEach(it => add(it.rec, it.qty, 'tool', pfeDescribe(it.rec, ctx)));
    const pm = { manual: 'P59', air: 'PA6', battery: 'PB102-1' }[s.pumpPow] || 'P59';
    if (ctx.M[pm]) { add(ctx.M[pm], 1, 'pump', 'the pump the crossover pairs with nut splitters, spreaders and punches'); out.pump = ctx.M[pm]; }
    if (ctx.M['9764']) add(ctx.M['9764'], known.length ? known.reduce((a, it) => a + it.qty, 0) : 1, 'hose', '6 ft hose with 9798 coupler and dust cap');
    if (s.gauge && ctx.M['9051']) { add(ctx.M['9051'], 1, 'gauge', 'psi gauge'); if (ctx.M['9670']) add(ctx.M['9670'], 1, 'gauge tee', 'fits the gauge between pump and hose'); }
    return out;
  }

  /* lift / pull */
  const cyls = known.filter(it => it.rec.cat === 'cylinder');
  known.filter(it => it.rec.cat !== 'cylinder').forEach(it => out.warnings.push(it.rec.m + ' is a ' + it.rec.cat + ', not a cylinder: add it separately.'));
  if (!cyls.length) { out.warnings.push('Add at least one cylinder.'); return out; }
  const n = cyls.reduce((a, it) => a + it.qty, 0);
  const act = cyls.some(it => it.rec.act === 'DA') ? 'DA' : 'SA';
  if (s.kind === 'pull' && !cyls.some(it => (it.rec.flags || []).some(f => f === 'hollow' || f === 'pull'))) {
    out.warnings.push('A pulling or tensioning set normally uses a hollow (RH) or pull (RP) cylinder.');
  }
  if (act === 'DA' && cyls.some(it => it.rec.act === 'SA')) out.warnings.push('Single- and double-acting cylinders on one pump: the double-acting pump is used for all.');
  cyls.forEach(it => add(it.rec, it.qty, 'cylinder', pfeDescribe(it.rec, ctx)));
  const oil = (s.together && n > 1) ? cyls.reduce((a, it) => a + (it.rec.oil || 0) * it.qty, 0) : Math.max(...cyls.map(it => it.rec.oil || 0));
  out.oilNeeded = Math.round(oil * 10) / 10;
  const needed = oil * 1.2;
  const maxCap = Math.max(...cyls.map(it => it.rec.cap || 0));

  let pump = null, pumpWhy = '';
  if (s.pumpModel) {
    pump = ctx.M[String(s.pumpModel).toUpperCase()] || null;
    if (!pump) out.warnings.push(s.pumpModel + ' is not in the catalog.');
    else {
      pumpWhy = 'the pump given for this set' + (pump.usable ? '; holds ' + pfeFmt(pump.usable) + ' in³ usable against the ' + pfeFmt(oil, 1) + ' in³ the cylinders take' + (s.together && n > 1 ? ' together' : '') : '');
      if (pump.usable && pump.usable < oil) out.warnings.push(pump.m + ' holds ' + pfeFmt(pump.usable) + ' in³ usable, less than the ' + pfeFmt(oil, 1) + ' in³ the cylinders take (p.10).');
      if (pump.act !== act) out.warnings.push(pump.m + ' is for ' + (pump.act === 'DA' ? 'double' : 'single') + '-acting cylinders.');
      if (pump.use === 'torque-wrench') out.warnings.push(pump.m + ' is a torque-wrench pump, not for cylinders.');
    }
  } else if (s.pumpPow === 'manual') {
    const rps = n === 1 && act === 'SA' ? ctx.rps.find(k => k.parts[0] === cyls[0].rec.m) : null;
    const rpsPump = rps && rps.parts.find(p => ctx.M[p] && ctx.M[p].cat === 'pump');
    if (rpsPump && !(s.speed && ctx.M[rpsPump].speed && ctx.M[rpsPump].speed !== s.speed)) {
      pump = ctx.M[rpsPump];
      pumpWhy = 'Power Team pairs ' + cyls[0].rec.m + ' with ' + pump.m + ' in its own set ' + rps.m + ' (' + pfeSource(rps) + ')';
    } else {
      const pk = pfePickManual(ctx, act, needed, maxCap, s.speed);
      pump = ctx.M[pk.m];
      if (pk.note) out.notes.push(pk.note);
      pumpWhy = 'the cylinders take ' + pfeFmt(oil, 1) + ' in³' + (s.together && n > 1 ? ' together' : '') + '; with a 20% reserve that is '
        + pfeFmt(needed, 1) + ' in³, and ' + (pump ? pump.m + ' holds ' + pfeFmt(pump.usable) + ' in³ usable' : 'no hand pump is big enough')
        + ' (p.10: the pump\'s usable oil must exceed the cylinders\')';
    }
  } else {
    pump = pfePickPowered(ctx, s.pumpPow, act, needed);
    pumpWhy = s.pumpPow + ' pump for ' + (act === 'DA' ? 'double' : 'single') + '-acting cylinders, ' + pfeFmt(needed, 1) + ' in³ needed with a 20% reserve';
    out.warnings.push('Powered-pump figures are series-level: confirm voltage (' + PFE_PH_VOLTS + ' V here), valve and reservoir with the engineer.');
  }
  if (pump) { add(pump, 1, 'pump', pumpWhy); out.pump = pump; }
  else if (!s.pumpModel) out.warnings.push('No ' + s.pumpPow + ' pump in the catalog holds ' + pfeFmt(needed, 1) + ' in³: ask the engineer.');

  const lines = (s.together || n === 1) ? n : 1;
  const perCyl = act === 'DA' ? 2 : 1;
  const hose = pfeHose(ctx, s.hoseLen, s.hoseType, s.highFlow);
  const manifold = s.together && n > 1;
  if (hose) {
    add(hose, lines * perCyl + (manifold ? perCyl : 0), 'hose', (act === 'DA' ? 'two per cylinder (advance and return)' : 'one per cylinder')
      + (manifold ? ', plus ' + (perCyl === 2 ? 'two' : 'one') + ' from the pump to the manifold' : '')
      + (!s.together && n > 1 ? ' — one hose moved from cylinder to cylinder' : '') + '; ' + pfeFmt(hose.len) + ' ft ' + hose.id + ' ' + hose.type);
    const female = cyls.every(it => PFE_SERIES_FACTS[it.rec.ser]);
    if (ctx.M['9798']) add(ctx.M['9798'], lines * perCyl, 'coupler', 'male half coupler on the cylinder end of each hose, as in the RPS sets (p.52)'
      + (female ? '; the cylinder\'s female half is standard (' + PFE_SERIES_FACTS.C.page + ')' : ''));
  }
  if (s.highFlow) out.notes.push('3/8 in high-flow hose returns big cylinders about 3-4 times faster than 1/4 in (p.135).');
  if (manifold) {
    const same = cyls.length === 1;
    const mm = n === 2 ? (same ? '9691' : '9642') : n <= 4 ? (act === 'DA' ? 'LM4D' : 'LM4S') : null;
    if (mm && ctx.M[mm]) {
      add(ctx.M[mm], 1, 'manifold', n === 2 ? (same ? 'Y manifold: two identical cylinders on one line' : 'two needle valves to balance two different cylinders')
        : 'lifting manifold with a valve per cylinder, so each one can be levelled');
    } else out.warnings.push(n + ' cylinders together: split them over two manifolds or ask the engineer.');
    if (!same) out.notes.push('Different cylinders on one pump extend at different speeds: control each with its valve.');
  }
  if (s.gauge) {
    const g = pfeGaugeFor(ctx, cyls.map(it => it.rec));
    if (g) { add(g.rec, 1, 'gauge', g.why); if (ctx.M['9670']) add(ctx.M['9670'], 1, 'gauge tee', 'fits the gauge between pump and hose (p.143)'); }
  }

  /* the catalog's own set, when the parts are exactly one */
  if (n === 1) {
    const core = out.parts.filter(p => ['cylinder', 'pump', 'hose', 'coupler'].includes(p.role)).map(p => p.model).sort().join(',');
    const k = ctx.rps.find(r => r.parts.slice().sort().join(',') === core);
    if (k) {
      const extra = out.parts.filter(p => !k.parts.includes(p.model)).map(p => p.model);
      out.kit = { model: k.m, why: 'the cylinder, pump, hose and coupler are Power Team\'s set ' + k.m + ': order it as one part number'
        + (extra.length ? ', plus ' + extra.join(' and ') : ''), page: pfeSource(k), replaces: k.parts.slice(), extra };
    }
  }
  return out;
}

/* ─────────────────────────── 6 · the cylinder selector ─────────────────────────── */

const PFE_JACK_KINDS = ['bottle', 'low-profile', 'telescoping', 'toe'];
const PFE_JOB_SERIES = {
  lift: 'general-purpose cylinder',
  pull: 'centre-hole or pull cylinder: the rod or cable passes through the piston',
  hold: 'locking-collar cylinder: the collar holds the load with no pressure in the cylinder',
};

/**
 * Power Team's own questions (catalog p.7, PDF 9) cut to five: what the cylinder does, the load and
 * how many cylinders share it, how far it moves, the space it must fit, and the power at the site.
 * Two ways in (`basis`):
 *   'load'   — the weight to move and how far. "Use 80% of the rated capacity and stroke" (p.7): the
 *              load per cylinder is divided by 0.8, and a stroke that leaves the 20% is preferred;
 *   'rating' — the cylinder's own rating, as a spec line or a competitor's model states it ("10 TO,
 *              8 IN"): the nominal ton class and the nearest stroke, matched as stated, like Find.
 *
 * a = { job: 'lift'|'pull'|'hold', basis: 'load'|'rating', load, loadUnit: 't'|'kg'|'ton', points, travel,
 *       travelUnit: 'mm'|'in', space, spaceUnit, act: 'SA'|'DA'|'' (not sure: single-acting),
 *       power: 'manual'|'electric'|'air', speed: 1|2|'' (hand pump), light, hoseLen,
 *       model (use this cylinder instead of the first choice), useJack (the jack instead of a set) }
 * -> { ok, missing[], need, cylinder, why[], alts[], jack, set, notes[], warnings[] }
 */
function pfeSelect(a, ctx) {
  const q = Object.assign({ job: 'lift', basis: 'load', loadUnit: 't', points: 1, travelUnit: 'mm', spaceUnit: 'mm', power: 'manual', hoseLen: 6 }, a || {});
  const rating = q.basis === 'rating';
  const out = { ok: false, missing: [], need: null, cylinder: null, why: [], alts: [], jack: null, set: null, notes: [], warnings: [] };
  const load = Number(q.load) || 0, travel = Number(q.travel) || 0, space = Number(q.space) || 0;
  const n = Math.max(1, Math.round(Number(q.points) || 1));
  if (!(load > 0)) out.missing.push(rating ? 'the capacity' : 'the load');
  if (!(travel > 0)) out.missing.push(rating ? 'the stroke' : 'how far it must move');
  if (out.missing.length) return out;

  const toUs = { t: PFE_TONNE_TO_US, kg: PFE_TONNE_TO_US / 1000, ton: 1 }[q.loadUnit] || PFE_TONNE_TO_US;
  /* a rating is a ton class: "10 t", "10 TO" and "10 US tons" all mean the 10-ton class */
  const classT = rating ? (q.loadUnit === 'kg' ? load / 1000 : load) : null;
  const perUs = rating ? null : load * toUs / n;
  const needUs = rating ? null : perUs / 0.8;
  const tIn = q.travelUnit === 'in' ? travel : travel * PFE_IN_PER_MM;
  const wantIn = rating ? tIn : tIn / 0.8;
  const spaceIn = space > 0 ? (q.spaceUnit === 'in' ? space : space * PFE_IN_PER_MM) : null;
  const unitTxt = { t: 't', kg: 'kg', ton: 'US tons' }[q.loadUnit] || 't';
  const travelTxt = pfeFmt(travel) + ' ' + (q.travelUnit === 'in' ? 'in' : 'mm');
  const spaceTxt = pfeFmt(space) + ' ' + (q.spaceUnit === 'in' ? 'in' : 'mm');
  const r2 = v => Math.round(v * 100) / 100;
  out.need = rating
    ? { basis: 'rating', classT: r2(classT), strokeIn: r2(tIn), spaceIn: spaceIn && r2(spaceIn), points: n }
    : { basis: 'load', perUs: r2(perUs), needUs: r2(needUs), travelIn: r2(tIn), wantIn: r2(wantIn), spaceIn: spaceIn && r2(spaceIn), points: n };

  const wantDA = q.act === 'DA' || (!q.act && !!q.powered);
  const act = wantDA && q.job !== 'hold' ? 'DA' : 'SA';
  if (wantDA && q.job === 'hold') out.warnings.push('Locking-collar cylinders are single-acting: none has a powered return. The lock was kept; the load lowers the cylinder.');
  const strong = r => (rating ? r.cap >= classT - 1e-9 : (r.t10k || r.cap) >= needUs - 1e-9);
  const fits = (r, o) => {
    if (r.cat !== 'cylinder' || r.act !== act) return false;
    const f = r.flags || [];
    if (q.job === 'pull') { if (!f.includes('hollow') && !f.includes('pull')) return false; }
    else if (q.job === 'hold') { if (!f.includes('locking')) return false; }
    else if (f.some(x => PFE_SPECIALTY.includes(x) && !(o.low && x === 'low'))) return false;
    if (o.light && r.body !== 'aluminum') return false;
    if (!strong(r)) return false;
    if (o.space && spaceIn && !(r.closed && r.closed <= spaceIn + 0.01)) return false;
    return true;
  };
  const bucket = rating
    ? r => (Math.abs(r.stroke - tIn) <= 0.5 ? 0 : r.stroke > tIn ? 1 : 2)
    : r => (r.stroke >= wantIn - 0.01 ? 0 : r.stroke >= tIn - 0.01 ? 1 : 2);
  const rankOf = r => (PFE_SERIES_RANK[r.ser] == null ? 9 : PFE_SERIES_RANK[r.ser]);
  const over = rating ? r => (r.cap > classT * 1.6 ? 1 : 0) : r => ((r.t10k || r.cap) > needUs * 1.6 ? 1 : 0);   // far bigger than asked sorts after a close fit
  const strokeKey = rating ? r => Math.abs(r.stroke - tIn) : r => r.stroke;
  /* a rating: the class asked, then a bigger class with the stroke; a shorter stroke last, since it cannot do the job */
  const tier = rating ? r => (bucket(r) === 2 ? 3 : over(r) ? 2 : bucket(r)) : r => bucket(r) * 2 + over(r);
  const rank = list => list.sort((x, y) => tier(x) - tier(y) || rankOf(x) - rankOf(y)
    || (rating ? x.cap - y.cap : (x.t10k || x.cap) - (y.t10k || y.cap)) || strokeKey(x) - strokeKey(y) || (x.wt || 999) - (y.wt || 999) || (x.m < y.m ? -1 : 1));
  const all = Object.values(ctx.M);
  /* relax one thing at a time, and say which */
  const tries = [{ light: !!q.light, space: true, low: q.job === 'lift' && !!spaceIn }];   // a tight space is what low-height series are for
  if (q.job === 'lift' && !spaceIn) tries.push({ light: !!q.light, space: true, low: true });
  if (q.light) tries.push({ space: true, low: q.job === 'lift', dropLight: true });
  tries.push({ light: !!q.light, space: false, low: q.job === 'lift', dropSpace: !!spaceIn });
  tries.push({ space: false, low: q.job === 'lift', dropLight: !!q.light, dropSpace: !!spaceIn });
  let list = [], used = tries[0];
  for (const t of tries) {
    list = rank(all.filter(r => fits(r, t)));
    used = t;
    if (list.length && bucket(list[0]) < 2) break;
  }
  if (!list.length) {
    out.warnings.push('No ' + (act === 'DA' ? 'double-acting ' : '') + PFE_JOB_SERIES[q.job].split(':')[0] + ' in the catalog '
      + (rating ? 'comes in the ' + pfeFmt(classT) + ' t class or above.' : 'gives ' + pfeFmt(needUs, 1) + ' t at 10,000 psi. Split the load over more cylinders, or ask the engineer.'));
    return out;
  }
  if (used.dropSpace) list.sort((x, y) => bucket(x) - bucket(y) || (x.closed || 99) - (y.closed || 99));   // then the lowest that does the job
  const forced = q.model && ctx.M[q.model] && ctx.M[q.model].cat === 'cylinder' ? ctx.M[q.model] : null;
  const best = forced || list[0];
  out.ok = true;
  out.cylinder = best;
  out.chosen = !!forced && forced !== list[0];
  out.alts = list.filter(r => r !== best && bucket(r) <= Math.max(1, bucket(list[0]))).slice(0, 3);
  if (rating) {   /* the neighbouring strokes of the same class first, then the next class up */
    const same = all.filter(r => r.cat === 'cylinder' && r !== best && r.ser === best.ser && r.cap === best.cap && r.act === best.act)
      .sort((x, y) => Math.abs(x.stroke - tIn) - Math.abs(y.stroke - tIn)).slice(0, 2);
    out.alts = same.concat(out.alts.filter(r => !same.includes(r))).slice(0, 3);
  }
  if (forced) {
    if (!strong(forced)) out.warnings.push(rating ? forced.m + ' is a ' + pfeFmt(forced.cap) + ' t cylinder: below the ' + pfeFmt(classT) + ' t class asked.'
      : forced.m + ' gives ' + pfeFmt(forced.t10k || forced.cap, 1) + ' t: less than the ' + pfeFmt(needUs, 1) + ' t the 80% rule asks for.');
    if (bucket(forced) === 2) out.warnings.push(forced.m + ' strokes ' + pfeFmt(forced.stroke) + ' in: shorter than the ' + travelTxt + ' asked.');
    if (spaceIn && forced.closed > spaceIn + 0.01) out.warnings.push(forced.m + ' closes at ' + pfeFmt(forced.closed) + ' in: taller than the space.');
  }

  const b = bucket(best);
  if (rating) {
    const tm = Math.round((best.t10k || best.cap) * 0.907 * 10) / 10;
    out.why.push('Capacity: the ' + pfeFmt(classT) + ' t class' + (n > 1 ? ', ' + n + ' cylinders' : '') + '. ' + best.m + ' is a ' + pfeFmt(best.cap) + ' t cylinder ('
      + pfeFmt(best.t10k || best.cap, 1) + ' US tons, ' + pfeFmt(tm, 1) + ' tonnes, at 10,000 psi).');
    if (tm < classT) out.notes.push('If the ' + pfeFmt(classT) + ' t is metric tonnes rather than the ton class, ' + best.m + ' gives only ' + pfeFmt(tm, 1) + ' tonnes: confirm with the customer.');
    out.why.push('Stroke: ' + travelTxt + (q.travelUnit === 'in' ? '' : ' (' + pfeFmt(tIn, 2) + ' in)') + ' asked; ' + best.m + ' strokes ' + pfeFmt(best.stroke) + ' in'
      + (best.closed ? ' (closed ' + pfeFmt(best.closed) + ' in, extended ' + pfeFmt(best.ext) + ' in).' : '.'));
    if (b < 2 && over(best)) out.notes.push('No ' + (act === 'DA' ? 'double-acting ' : '') + 'cylinder near the ' + pfeFmt(classT) + ' t class strokes ' + travelTxt + '; ' + best.m + ' is a bigger class that does.');
    else if (b === 1) out.notes.push('No cylinder of this class strokes ' + travelTxt + ' exactly; ' + best.m + ' is the nearest longer one.');
    if (b === 2) out.warnings.push('No cylinder of this class strokes ' + travelTxt + '; ' + best.m + ' is the nearest.');
    out.notes.push('Matched to the rating as given. To size from the weight instead, start from "the load and how far it moves": Power Team advises using 80% of rated capacity and stroke (catalog p.7).');
  } else {
    out.why.push(pfeFmt(load) + ' ' + unitTxt + (n > 1 ? ' over ' + n + ' cylinders is ' + pfeFmt(perUs, 1) + ' US tons each' : ' is ' + pfeFmt(perUs, 1) + ' US tons')
      + '. At 80% of rated capacity (catalog p.7) that needs ' + pfeFmt(needUs, 1) + ' t at 10,000 psi; ' + best.m + ' gives ' + pfeFmt(best.t10k || best.cap, 1) + ' t.');
    out.why.push('Travel ' + travelTxt + (q.travelUnit === 'in' ? '' : ' (' + pfeFmt(tIn, 2) + ' in)') + ': ' + best.m + ' strokes ' + pfeFmt(best.stroke) + ' in'
      + (b === 0 ? ', so the move stays within 80% of it.' : b === 1 ? '. It covers the move but uses ' + Math.round(tIn / best.stroke * 100) + '% of the stroke.' : '.'));
    if (b === 1) out.notes.push('A longer stroke would keep the move within 80% of it, but none fits ' + (spaceIn ? 'the space' : 'this choice') + '.');
    if (b === 2) out.warnings.push('No cylinder this strong strokes ' + travelTxt + ': lift in stages with cribbing, or ask the engineer.');
  }
  if (spaceIn) {
    if (used.dropSpace) {
      out.why.push('Nothing ' + (rating ? 'of this class' : 'this strong') + ' closes under ' + spaceTxt + '; ' + best.m + ' is the lowest that does the job, closing at ' + pfeFmt(best.closed) + ' in.');
      out.warnings.push('The cylinder does not fit the space given: lift in stages with cribbing, or measure the space again.');
    } else out.why.push(best.m + ' closes at ' + pfeFmt(best.closed) + ' in, inside the ' + spaceTxt + (q.spaceUnit === 'in' ? '' : ' (' + pfeFmt(spaceIn, 2) + ' in)') + ' space.');
  }
  const S = (ctx.series || {})[best.ser];
  out.why.push((S ? S.title.charAt(0).toUpperCase() + S.title.slice(1) : PFE_JOB_SERIES[q.job]) + ' (' + best.ser.replace('_', '…') + ' series)'
    + ((best.flags || []).includes('low') ? ': a low-height series, for the space available' : '')
    + (q.job !== 'lift' ? ': ' + PFE_JOB_SERIES[q.job].split(': ')[1] : '') + '.');
  if (!q.act && !q.powered && q.job !== 'hold') out.notes.push('Single-acting was assumed (the load or a spring returns it). Choose double-acting if it must be pulled back under power.');
  if (used.dropLight) out.warnings.push('No aluminium cylinder covers this, so a steel one is suggested.');
  else if (q.light && best.body === 'aluminum') out.notes.push('Aluminium is about half the weight of steel: ' + best.m + ' weighs ' + pfeFmt(best.wt, 1) + ' lb.');
  if (n > 1) out.notes.push('With ' + n + ' cylinders on one load, the set uses a manifold so each cylinder can be controlled and the load kept level.');

  /* an all-in-one jack, when one single-acting cylinder lifts the load */
  if (q.job === 'lift' && n === 1 && act === 'SA') {
    const jStrong = r => (rating ? r.cap >= classT - 1e-9 : r.cap >= needUs - 1e-9);
    const jacks = all.filter(r => r.cat === 'jack' && PFE_JACK_KINDS.includes(r.sub) && jStrong(r) && r.stroke >= tIn - (rating ? 0.5 : 0.01)
      && (!spaceIn || (r.closed && r.closed <= spaceIn + 0.01) || r.sub === 'toe'))
      .sort((x, y) => (x.stroke >= wantIn - 0.01 ? 0 : 1) - (y.stroke >= wantIn - 0.01 ? 0 : 1) || x.cap - y.cap || (x.closed || 0) - (y.closed || 0) || (x.m < y.m ? -1 : 1));
    if (jacks.length) {
      const j = jacks[0];
      out.jack = { rec: j, page: pfeSource(j),
        why: 'Self-contained ' + j.sub + ' jack with the pump built in: no hose, coupler or gauge. ' + pfeFmt(j.cap) + ' t, stroke ' + pfeFmt(j.stroke) + ' in'
          + (j.closed ? ', ' + pfeFmt(j.closed) + ' in closed' : '') + (j.screw ? ', with a ' + pfeFmt(j.screw) + ' in extension screw' : '')
          + (j.sub === 'toe' ? '; it lifts from a toe near the floor' : '') + '.' };
    }
  }

  if (q.useJack && out.jack) {
    const j = out.jack.rec;
    out.usingJack = true;
    out.set = { kind: 'lift', kit: null, kits: [], warnings: [], notes: [], oilNeeded: null, pump: null,
      parts: [{ model: j.m, qty: 1, role: 'jack', why: out.jack.why, page: out.jack.page, desc: pfeDescribe(j, ctx) }] };
    return out;
  }
  out.set = pfeBuildSet({ kind: q.job === 'pull' ? 'pull' : 'lift', items: [{ model: best.m, qty: n }], pumpPow: q.power || 'manual',
    speed: Number(q.speed) || null, hoseLen: Number(q.hoseLen) || 6, together: true, gauge: true }, ctx);
  return out;
}

/* ─────────────────────────── 7 · what leaves the page ─────────────────────────── */

const PFE_QUALITY_LABEL = { exact: 'Exact', close: 'Close: check the differences', check: 'Needs checking', none: 'No match' };

/** Basket -> rows for the "Request" sheet. Basket item: { model, qty, line, quality, basis, source, notes, set, role } */
function pfeExcelRows(basket, ctx) {
  const head = ['#', 'Customer line', 'Qty', 'Power Team model', 'Description', 'Set', 'Role', 'Match', 'Basis', 'Catalog page', 'Notes'];
  const rows = (basket || []).map((b, i) => [i + 1, b.line || '', Number(b.qty) || 1, b.model || '', pfeDescribe(ctx.M[b.model], ctx) || b.desc || '',
    b.set || '', b.role || '', PFE_QUALITY_LABEL[b.quality] || '', b.basis || '', b.source || pfeSource(ctx.M[b.model]), (b.notes || []).join(' ')]);
  return [head].concat(rows);
}

/** Basket -> purchase-request lines (itemNo = the model). */
function pfePrItems(basket, ctx) {
  return (basket || []).filter(b => b && b.model).map(b => {
    const rec = ctx.M[b.model];
    const page = rec && rec.pg ? 'catalog p.' + rec.pg : '';
    return {
      id: b.model, model: b.model, name: 'Power Team ' + b.model + (rec ? ' — ' + pfeShort(rec) : b.desc ? ' — ' + String(b.desc).slice(0, 80) : ''),
      category: rec ? rec.cat : '', capacityTons: rec && rec.cap ? rec.cap : null, qty: Number(b.qty) || 1,
      remarks: 'Product Finder: Power Team ' + b.model + (page ? ', ' + page : '') + (b.quality === 'exact' ? '' : ', confirm')
        + (b.set ? ' · ' + b.set + (b.role ? ' (' + b.role + ')' : '') : ''),
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pfeParseLine, pfeSplitBulk, pfeSapPairs, pfeModelTokens, pfeCapacity, pfeLength, pfeFrac,
    pfeShort, pfePrepare, pfeDecode, pfeRcRule, pfeMatch, pfeMatchAll, pfeChoose, pfeLookup, pfeSelect, pfeSearchIndex, pfeBuildSet, pfeDescribe, pfeSpecs,
    pfeSource, pfeExcelRows, pfePrItems, PFE_COMPETITOR_SPECS, PFE_QUALITY_LABEL };
}
