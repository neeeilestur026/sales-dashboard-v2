/* product-finder.js — Hi-ESCORP Product Finder (A165)
   Plain-JS rules + JSON data (no AI, no paid services). Safety specs come ONLY from the /data
   JSON files; anything without a verified exact match answers
   "Needs engineer confirmation — Hi-ESCORP will contact you." and is logged — never guessed.
   Reuses the A164 cylinder engine (ptCapacity / ptRecommend / ptPumpSet from
   cylinder-recommender.js, loaded before this file). Catalog updates = edit dashboard/data/*.json;
   the admin screen (pf-admin.html) can also stage a replacement file per device via localStorage. */

/* A169: the old "Send to Hi-ESCORP (WhatsApp)" / "Email" buttons are gone — there is no WhatsApp
   account behind them. A result now hands off INSIDE the system: Create Purchase Request (which
   starts the real PR → sourcing → pricing → quotation flow) plus Copy details for anything else. */

const PF_CONFIRM_MSG = 'Needs engineer confirmation — Hi-ESCORP will contact you.';
const PF_DATA_FILES = ['products.json', 'synonyms.json', 'cross_reference.json', 'torque_chart.json',
                       'bolt_dimensions.json'];
const PF_INDUSTRIES = ['cement', 'mining', 'power', 'oil-gas', 'semiconductor', 'shipbuilding'];

/* ─────────────────────────── Data loading (override-aware) ─────────────────────────── */

let pfData = null;      // { products:[], synonyms:[], crossRef:[], torque:[], dims:[], bases:{}, loadErrors:[] }
let pfLoading = null;

function pfOverride(file) {
  try { const raw = localStorage.getItem('pf_override_' + file); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}

async function pfFetchFile(file) {
  const ov = pfOverride(file);
  if (ov) return ov;
  const res = await fetch('/data/' + file, { cache: 'no-cache' });
  if (!res.ok) {
    // 404 almost always means the SERVER is not serving /data — not that the file is missing.
    throw new Error(res.status === 404
      ? file + ' is not being served (404). The app needs a restart, or this deployment is older than the Product Finder.'
      : file + ' failed to load (' + res.status + ')');
  }
  return res.json();
}

/* Per-file resilient loader: one broken/missing file never kills the other three, a transient
   failure never bricks the page (pfLoading is always cleared), and a data failure is recorded in
   loadErrors so handlers can SHOW it instead of presenting it as a product miss. */
const PF_FILE_KEYS = { 'products.json': 'products', 'synonyms.json': 'synonyms',
                       'cross_reference.json': 'rows', 'torque_chart.json': 'rows',
                       'bolt_dimensions.json': 'rows' };

async function pfLoadData(force) {
  if (pfData && !force && !(pfData.loadErrors || []).length) return pfData;
  if (pfLoading && !force) return pfLoading;
  pfLoading = (async () => {
    const settled = await Promise.allSettled(PF_DATA_FILES.map(pfFetchFile));
    const loadErrors = [];
    const arr = (i) => {
      const file = PF_DATA_FILES[i], key = PF_FILE_KEYS[file];
      if (settled[i].status === 'rejected') {
        const r = settled[i].reason;
        loadErrors.push({ file, message: String((r && r.message) || r) });
        return [];
      }
      const v = settled[i].value ? settled[i].value[key] : null;
      if (!Array.isArray(v)) {
        loadErrors.push({ file, message: 'unexpected file shape — missing the "' + key + '" array' });
        return [];
      }
      return v;
    };
    /* The torque file also carries a _bases map — three different tightening bases now coexist
       (oiled 62%, oiled 90%, B7 65% yield) and a torque figure is meaningless without its basis. */
    const bases = (settled[3].status === 'fulfilled' && settled[3].value
                   && settled[3].value._bases) || {};
    pfData = { products: arr(0), synonyms: arr(1), crossRef: arr(2), torque: arr(3),
               dims: arr(4), bases, loadErrors };
    pfLoading = null;                       // errors present → next call re-fetches (auto-retry)
    return pfData;
  })();
  try { return await pfLoading; }
  catch (e) { pfLoading = null; throw e; } // never leave a rejected promise cached
}

/* ─────────────────────────── Pure helpers (unit-tested) ─────────────────────────── */

function pfNorm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
/* For model-number comparison: case/space/dash-insensitive so "RC1006" finds "RC-1006". */
function pfModelKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

/* ── Token-level matching: whole words only (no more 'ram' inside 'frame'), plural-tolerant,
      and one-typo-tolerant for words of 5+ letters ('cylnder' still finds 'cylinder'). ── */

function pfTokenize(text) {
  return pfNorm(text).split(/[^a-z0-9\/]+/).filter(Boolean);   // keeps fractions like 3/8
}

function pfStripPlural(w) {
  return (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) ? w.slice(0, -1) : w;
}

/** True when a and b are within ONE edit (substitute/insert/delete) of each other. */
function pfEdit1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) { const t = a; a = b; b = t; }      // a is the shorter (or equal)
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length === b.length) { i++; j++; }                    // substitution
    else j++;                                                   // extra char in b
  }
  return edits + (b.length - j) + (a.length - i) <= 1;
}

/** Does the (possibly multi-word) term appear in the token stream as whole words? */
function pfTermHit(tokens, term) {
  const words = pfTokenize(term);
  if (!words.length) return false;
  outer:
  for (let s = 0; s + words.length <= tokens.length; s++) {
    for (let k = 0; k < words.length; k++) {
      const tok = tokens[s + k], w = words[k];
      const exact = pfStripPlural(tok) === pfStripPlural(w);
      const fuzzy = tok.length >= 5 && w.length >= 5 && pfEdit1(pfStripPlural(tok), pfStripPlural(w));
      if (!exact && !fuzzy) continue outer;
    }
    return true;
  }
  return false;
}

/** Detect the category the customer's wording means. Longest matching term wins. */
function pfDetectCategory(text, synonyms) {
  const tokens = pfTokenize(text);
  let best = null;
  (synonyms || []).forEach(group => {
    (group.terms || []).forEach(term => {
      const t = pfNorm(term);
      if (pfTermHit(tokens, t)) {
        if (!best || t.length > best.term.length) best = { category: group.category, term: t };
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

/* ── Attribute extraction: load (tons/kg/kN), stroke, pressure, and subtype signals — so
      "100 ton low height double acting jack" filters on ALL of it, not just the tonnage. ── */

const pfMpaToBar = m => m * 10;

/* signal → key(s) matched as substrings of the product's `subtype` field.
   Signals only ever narrow WITHIN the matched category, so a press signal can never pull a cylinder. */
const PF_SUBTYPE_SIGNALS = [
  // cylinders
  [/double[- ]acting|powered return/, 'double-acting'],
  [/low[- ](height|profile)|flat (jack|cylinder)/, 'low-profile'],
  [/pancake/, 'pancake'],
  [/lock[- ]?nut|locking|load[- ]hold|hold the load/, 'locking'],
  [/hollow|cent(er|re)[- ]hole|through[- ]hole/, 'center-hole'],
  [/alumin(um|ium)|light[- ]?weight/, 'aluminum'],
  // jacks — "bottle jack" must land on the bottle jack, not the nearest-tonnage jack family
  [/bottle/, 'bottle-jack'],
  [/toe[- ]jack/, 'toe-jack'],
  [/stressing|post[- ]tension/, 'stressing-jack'],
  [/railroad|railway|locomotive|railcar/, 'railroad-jack'],
  // spreaders — "flange spreader" is a distinct tool from a pry spreader
  [/flange/, 'flange-spreader'],
  // pumps — "hand pump" must not answer with a tensioner pump
  [/hand[- ]pump|manual pump/, 'hand'],
  [/two[- ]speed|2[- ]speed|dual[- ]speed/, 'two-speed'],
  [/single[- ]speed/, 'single-speed'],
  [/air[- ](hydraulic[- ])?pump|pneumatic pump/, 'air'],
  [/battery|cordless/, 'battery'],
  [/electric[- ]?(al)?[- ]pump/, 'electric'],
  [/torque[- ]wrench pump|tw pump/, 'torque-wrench-pump'],
  [/tensioner pump/, 'tensioner-pump'],
  // presses
  [/h[- ]?frame/, 'h-frame-press'],
  [/c[- ]?frame/, 'c-frame-press'],
  [/bench[- ]press/, 'bench-press'],
  [/floor[- ]press/, 'floor-press'],
  // pullers
  [/mechanical/, 'mechanical'],
  [/bearing/, 'bearing-puller'],
  // air tools — handle style, grinder style, hammer style
  [/butterfly/, 'butterfly'],
  [/t[- ]handle/, 't-handle'],
  [/d[- ]handle/, 'd-handle'],
  [/angle grinder/, 'angle-grinder'],
  [/die grinder|pencil grinder|burr/, 'die-grinder'],
  [/vertical grinder/, 'vertical-grinder'],
  [/needle|scaler/, 'needle-scaler'],
  [/rivet/, 'riveting-hammer'],
  [/scaling|descal|digging/, 'scaling-hammer'],
  [/micro|pencil (hammer|chip)/, 'micro-chipper'],
  [/low[- ]vibration|anti[- ]vibration hammer/, 'low-vibration'],
  // air preparation
  [/frl|filter regulator|air preparation|air filter|regulator|lubricator/, 'frl'],
  [/hose reel|reel/, 'hose-reel'],
  [/balancer/, 'balancer'],
  [/coupling|quick connect/, 'coupling'],
  [/whip|spiral hose|air hose/, 'hose']
];
/* 'low height' honestly covers three catalog families */
const PF_SUBTYPE_EXPAND = { 'low-profile': ['low-profile', 'pancake', 'short'] };

const pfFtlbToNm = f => f * 1.35582;

/* Model/series tokens the rep typed ("RT series", "P23", "RC1006"). Kept deliberately tight:
   a bare number is a size, not a model, and a 1-letter token is noise. */
function pfModelTokens(text) {
  return pfTokenize(text).filter(t =>
    t.length >= 2 && /[a-z]/.test(t) && !PF_MODEL_STOPWORDS.has(t));
}
const PF_MODEL_STOPWORDS = new Set(['series','type','model','the','and','for','with','ton','tons','tonne',
  'mm','cm','inch','in','bar','psi','mpa','nm','kg','kn','hydraulic','pump','jack','ram','press','need',
  'want','set','sets','pcs','pc','unit','units','high','low','new','old']);

function pfExtractAttrs(text) {
  let t = ' ' + pfNorm(text) + ' ';
  // pressure first, and STRIP it, so "100 mpa" / "700 bar" numbers never read as tons
  let pressureBar = 0;
  const pr = t.match(/(\d+(?:\.\d+)?)\s*(bar|psi|mpa)\b/);
  if (pr) {
    const v = parseFloat(pr[1]);
    pressureBar = pr[2] === 'psi' ? pfPsiToBar(v) : pr[2] === 'mpa' ? pfMpaToBar(v) : v;
    t = t.replace(pr[0], ' ');
  }
  // torque, also STRIPPED — "20000 nm" must never be read as a tonnage, and a wrench that cannot
  // reach the asked figure must never be offered (the same safety rule the coupler path enforces).
  let torqueNm = 0;
  const tq = t.match(/(\d+(?:[.,]\d+)?)\s*(nm|n\.m|newton met(?:er|re)s?)\b/) ||
             t.match(/(\d+(?:[.,]\d+)?)\s*(ft[- ]?lbs?|ft\.?lbs?|foot[- ]?pounds?)\b/);
  if (tq) {
    const v = parseFloat(String(tq[1]).replace(/,/g, ''));
    torqueNm = /^n/.test(tq[2]) ? v : pfFtlbToNm(v);
    t = t.replace(tq[0], ' ');
  }
  // stroke ("160 mm stroke" / "stroke of 6 in"), stripped for the same reason
  let strokeMm = 0;
  const st = t.match(/(\d+(?:\.\d+)?)\s*(mm|in|inch|inches)\s*stroke/) ||
             t.match(/stroke\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(mm|in|inch|inches)/);
  if (st) {
    strokeMm = st[2] === 'mm' ? parseFloat(st[1]) : parseFloat(st[1]) * 25.4;
    t = t.replace(st[0], ' ');
  }
  // load: tons first, else kg (÷1000), else kN
  let tons = pfExtractTons(t);
  if (!tons) {
    const kg = t.match(/(\d+(?:\.\d+)?)\s*kgs?\b/);
    if (kg) tons = Math.round(parseFloat(kg[1]) / 10) / 100;
  }
  if (!tons) {
    const kn = t.match(/(\d+(?:\.\d+)?)\s*kn\b/);
    if (kn) tons = Math.round(pfKnToTons(parseFloat(kn[1])) * 100) / 100;
  }
  const subtypes = PF_SUBTYPE_SIGNALS.filter(([re]) => re.test(t)).map(([, k]) => k);
  return { tons, strokeMm, pressureBar, torqueNm, subtypes, modelTokens: pfModelTokens(text) };
}

/* ── Capacity helpers: a family may carry a RANGE ("presses 55–200 ton") instead of one size.
      The brochure gives ranges, so we store the range rather than invent discrete models. ── */
function pfCapMax(p) {
  if (typeof p.capacity_max_tons === 'number') return p.capacity_max_tons;
  if (typeof p.capacity_tons === 'number') return p.capacity_tons;
  return null;
}
function pfCapMin(p) {
  if (typeof p.capacity_min_tons === 'number') return p.capacity_min_tons;
  if (typeof p.capacity_tons === 'number') return p.capacity_tons;
  return null;
}
/** Plain-English capacity for a card: "100 ton" or "55–200 ton". */
function pfCapLabel(p) {
  const lo = pfCapMin(p), hi = pfCapMax(p);
  if (lo === null && hi === null) return '';
  if (lo !== null && hi !== null && lo !== hi) return lo + '–' + hi + ' t';
  return (hi !== null ? hi : lo) + ' t';
}

/** Competitor model typed inside an RFQ ("customer has Enerpac RC-1006") → surface the crossover. */
function pfXrefInText(text, rows) {
  const toks = pfTokenize(text);
  const cands = [];
  toks.forEach((w, i) => {
    if (/\d/.test(w) && pfModelKey(w).length >= 4) cands.push(pfModelKey(w));
    if (i + 1 < toks.length) {                                  // "RC-1006" tokenizes to rc + 1006
      const pair = pfModelKey(toks[i] + toks[i + 1]);
      if (/\d/.test(pair) && pair.length >= 4) cands.push(pair);
    }
  });
  if (!cands.length) return [];
  return (rows || []).filter(r => {
    const mk = pfModelKey(r.competitor_model);
    return mk.length >= 4 && cands.includes(mk);
  }).slice(0, 3);
}

/* 'high-pressure' is a wording group, not a product category — it means UHP couplers/hoses. */
const PF_CATEGORY_ALIAS = { 'high-pressure': ['coupler', 'hose'] };
/* Families whose whole point is a load rating — answering one without the load is a guess. */
const PF_LOAD_RATED = ['jack', 'press', 'puller', 'punch', 'spreader', 'vise', 'crane'];
/* The same idea for torque tools: "impact wrench" spans 102 Nm to 25,000 Nm. */
const PF_TORQUE_RATED = ['impact-wrench', 'ratchet-wrench', 'torque-wrench'];

/** RFQ matcher v2: category filter + HARD never-undersized filter + subtype narrowing +
 *  capacity-proximity / stroke / industry scoring, with fully deterministic tie-breaks.
 *  A load-rated ask with NO load returns { needTons:true } instead of guessing a size. */
function pfRfqMatch(text, industry, data) {
  const det = pfDetectCategory(text, data.synonyms);
  const attrs = pfExtractAttrs(text);
  const xref = pfXrefInText(text, data.crossRef);
  if (!det) return { miss: true, category: null, attrs, xref, results: [] };
  const cats = PF_CATEGORY_ALIAS[det.category] || [det.category];
  const uhp = det.category === 'high-pressure';
  const tons = attrs.tons;

  // A cylinder recommendation without a load would just be a guess — ask instead of answering big.
  if (det.category === 'cylinder' && !(tons > 0)) {
    return { miss: false, needTons: true, category: det.category, matchedTerm: det.term,
             attrs, xref, results: [] };
  }

  let pool = data.products.filter(p => cats.includes(p.category));

  // HARD safety-style filter: never recommend below the asked load (same rule as couplers).
  // Range-aware — a family like "H-Frame Press 55–200 t" qualifies when its MAX covers the ask.
  if (tons > 0) pool = pool.filter(p => { const m = pfCapMax(p); return m === null || m >= tons; });

  // The same line for TORQUE. A wrench that cannot reach the asked figure must never be the answer.
  if (attrs.torqueNm > 0) {
    pool = pool.filter(p => typeof p.torque_max_nm !== 'number' || p.torque_max_nm >= attrs.torqueNm);
  }

  // Subtype narrowing — filter when the catalog can satisfy the signal, else relax + say so.
  let relaxed = false;
  (attrs.subtypes || []).forEach(sig => {
    const keys = PF_SUBTYPE_EXPAND[sig] || [sig];
    const narrowed = pool.filter(p => keys.some(k => String(p.subtype || '').indexOf(k) !== -1));
    if (narrowed.length) pool = narrowed; else relaxed = true;
  });

  // Same rule as cylinders, applied after narrowing: a load-rated family spanning very different
  // sizes (presses 10–200 t, pullers 1–100 t) can't be answered from a bare "shop press" without
  // guessing — but when a signal or a small catalog leaves one obvious family, just answer.
  if (!(tons > 0) && PF_LOAD_RATED.includes(det.category) && pool.length > 1) {
    const rated = pool.filter(p => pfCapMax(p) !== null);
    const hi = Math.max(...rated.map(pfCapMax)), lo = Math.min(...rated.map(pfCapMax));
    const spread = rated.length > 1 && hi >= 4 * lo && hi >= 25;   // only when the choice really matters
    if (spread) {
      return { miss: false, needTons: true, category: det.category, matchedTerm: det.term,
               attrs, xref, relaxed, results: [] };
    }
  }

  // …and the same for torque tools, so a bare "impact wrench" doesn't answer with the 25,000 Nm one.
  if (!(attrs.torqueNm > 0) && PF_TORQUE_RATED.includes(det.category) && pool.length > 1) {
    const rated = pool.filter(p => typeof p.torque_max_nm === 'number');
    const hi = Math.max(...rated.map(p => p.torque_max_nm)), lo = Math.min(...rated.map(p => p.torque_max_nm));
    const spread = rated.length > 1 && hi >= 4 * lo && hi >= 500;  // a 21–122 Nm ratchet range needs no prompt
    if (spread) {
      return { miss: false, needTorque: true, category: det.category, matchedTerm: det.term,
               attrs, xref, relaxed, results: [] };
    }
  }

  const scored = pool
    .map(p => {
      let score = 1;
      if (p.verified === true) score += 10;                          // sample data can never outrank real data
      if (industry && (p.industries || []).includes(industry)) score += 2;
      if (tons > 0 && pfCapMax(p) !== null) {
        score += Math.max(0, 6 - (pfCapMax(p) - tons) / 25);         // closest COVERING size scores highest
      }
      if (attrs.torqueNm > 0 && typeof p.torque_max_nm === 'number') {
        score += Math.max(0, 6 - (p.torque_max_nm - attrs.torqueNm) / 5000);   // closest covering tool first
      }
      if (attrs.strokeMm > 0 && (p.stroke_options_mm || []).some(s => s >= attrs.strokeMm)) score += 3;
      // the rep named a series or model ("RT series", "P23") — that beats every soft signal
      if ((attrs.modelTokens || []).length) {
        const ser = String(p.series || '').toLowerCase();
        const mk = pfModelKey((p.model_example || '') + ' ' + p.name);
        if (attrs.modelTokens.some(t => t === ser || (/\d/.test(t) && t.length >= 3 && mk.indexOf(t) !== -1))) {
          score += 8;
        }
      }
      if (uhp && (p.features || []).some(f => /ultra high pressure|high pressure/i.test(f))) score += 3;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score
      || (tons > 0 ? ((pfCapMax(a.p) || 0) - tons) - ((pfCapMax(b.p) || 0) - tons) : 0)
      || (attrs.torqueNm > 0 ? ((a.p.torque_max_nm || 0) - attrs.torqueNm) - ((b.p.torque_max_nm || 0) - attrs.torqueNm) : 0)
      // between two RANGE families, the more general one first (a standard H-frame before the
      // roll-bed specialty). Never applied to discrete sizes — that would let any range outrank
      // the exact-size match the capacity filter just found.
      || (typeof a.p.capacity_min_tons === 'number' && typeof b.p.capacity_min_tons === 'number'
          ? a.p.capacity_min_tons - b.p.capacity_min_tons : 0)
      || ((a.p.series === 'C' ? 0 : 1) - (b.p.series === 'C' ? 0 : 1))   // generic ask → general-purpose first
      || String(a.p.name).localeCompare(String(b.p.name)));              // fully deterministic
  return { miss: scored.length === 0, category: det.category, matchedTerm: det.term,
           attrs, xref, relaxed, results: scored.slice(0, 3).map(x => x.p) };
}

/** 1–2 plain-English sentences: WHY this product fits — the actual reasons, not just feature blurb. */
function pfWhyFits(p, industry, ctx) {
  const attrs = (ctx && ctx.attrs) || {};
  const reasons = [];
  if (attrs.tons > 0 && pfCapMax(p) !== null) {
    reasons.push('Rated ' + pfCapLabel(p) + ' — covers your ' + attrs.tons + '-t load');
  }
  if (attrs.torqueNm > 0 && typeof p.torque_max_nm === 'number') {
    reasons.push('reaches ' + p.torque_max_nm + ' Nm — covers your ' + Math.round(attrs.torqueNm) + ' Nm');
  }
  (attrs.subtypes || []).forEach(sig => {
    const keys = PF_SUBTYPE_EXPAND[sig] || [sig];
    if (keys.some(k => String(p.subtype || '').indexOf(k) !== -1)) {
      reasons.push(sig.replace('-', ' ') + ', as you asked');
    }
  });
  if (attrs.strokeMm > 0 && (p.stroke_options_mm || []).some(s => s >= attrs.strokeMm)) {
    reasons.push('stroke options cover ' + attrs.strokeMm + ' mm');
  }
  let s;
  if (reasons.length) {
    s = p.name + ': ' + reasons.join('; ') + '.';
  } else {
    const feats = (p.features || []).slice(0, 3).join(', ');
    s = feats ? (p.name + ' offers ' + feats + '.') : (p.name + '.');
  }
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

/** Canonical thread key: size + family, TPI dropped — '3/8 NPT', '3/8-18 NPT', '3/8" npt'
 *  all become "3/8|npt". Unknown formats fall back to the model key. */
function pfThreadKey(s) {
  const t = pfNorm(s);
  if (!t) return '';
  const size = t.match(/\d+\s*\/\s*\d+|\d+(?:\.\d+)?/);
  const fam = t.match(/npt|bsp|unf|jic/);
  return (size ? size[0].replace(/\s+/g, '') : pfModelKey(t)) + '|' + (fam ? fam[0] : '');
}
/** Threads match when sizes agree and families agree (a missing family on either side is tolerated). */
function pfThreadMatch(a, b) {
  const ka = pfThreadKey(a), kb = pfThreadKey(b);
  if (!ka || !kb) return false;
  const [sa, fa] = ka.split('|'), [sb, fb] = kb.split('|');
  return !!sa && sa === sb && (!fa || !fb || fa === fb);
}

/** Coupler safety filter. NEVER returns a coupler rated below the entered pressure, and only
 *  VERIFIED couplers count as matches — samples are surfaced separately, greyed, confirmation-only. */
function pfCouplerMatch(thread, pressureBar, products) {
  const want = pfNorm(thread);
  const pool = (products || []).filter(p =>
    (p.category === 'coupler' || p.category === 'hose') &&
    (!want || pfThreadMatch(want, p.thread || '')) &&
    typeof p.max_pressure_bar === 'number' &&
    p.max_pressure_bar >= pressureBar);            // the hard safety line: ≥ entered pressure, always
  return {
    matches: pool.filter(p => p.verified === true),
    samples: pool.filter(p => p.verified !== true)
  };
}

/** Cross-reference search: exact key match first; fuzzy needs a 4+ char key, is RANKED by how much
 *  of the entry the query covers, and is capped at 5 (no more "R" → the whole table). */
function pfCrossRef(query, rows) {
  const q = pfModelKey(query);
  if (!q) return [];
  const keyed = (rows || []).map(r => ({ r, key: pfModelKey(r.competitor_brand + r.competitor_model), mkey: pfModelKey(r.competitor_model) }));
  const exact = keyed.filter(x => x.key === q || x.mkey === q);
  if (exact.length) return exact.map(x => x.r);
  if (q.length < 4) return [];
  return keyed
    .map(x => {
      let score = 0;
      if (x.key.indexOf(q) !== -1) score = q.length / x.key.length;
      else if (x.mkey.length >= 4 && q.indexOf(x.mkey) !== -1) score = x.mkey.length / q.length;
      return { x, score };
    })
    .filter(y => y.score > 0)
    .sort((a, b) => b.score - a.score || String(a.x.mkey).localeCompare(String(b.x.mkey)))
    .slice(0, 5)
    .map(y => y.x.r);
}

/* ── Data health: schema + cross-file reference validation (drives the pf-admin panel). ── */
function pfValidateData(data) {
  const out = [];
  const err = (file, msg) => out.push({ level: 'error', file, msg });
  const warn = (file, msg) => out.push({ level: 'warn', file, msg });
  const products = (data && data.products) || [];
  const ids = {};
  products.forEach((p, i) => {
    const label = p && (p.id || p.name) ? (p.id || p.name) : ('row ' + (i + 1));
    if (!p || !p.id || !p.name || !p.category) err('products.json', label + ': missing id/name/category');
    if (p && typeof p.verified !== 'boolean') err('products.json', label + ': "verified" must be true or false');
    if (p && p.id) { if (ids[p.id]) err('products.json', 'duplicate id ' + p.id); ids[p.id] = true; }
    (p && p.pairs_with || []).forEach(pid => {
      if (!products.some(x => x.id === pid)) err('products.json', label + ': pairs_with "' + pid + '" does not exist');
    });
    if (p && (p.category === 'coupler' || p.category === 'hose')) {
      if (!p.thread) warn('products.json', label + ': coupler/hose without a thread');
      if (typeof p.max_pressure_bar !== 'number') err('products.json', label + ': coupler/hose without max_pressure_bar — it can never be safety-matched');
    }
    if (p && p.category === 'torque-wrench' && !(typeof p.torque_min_nm === 'number' && typeof p.torque_max_nm === 'number')) {
      warn('products.json', label + ': torque wrench without a Nm range');
    }
    /* A185: the Puller Selector sizes on tonnage alone (we hold no jaw geometry), so a puller with no
       rating can never be safety-matched — and a typo'd subtype silently drops out of PS_SUBTYPE_RANK
       to rank 9 and quietly loses every tie-break, which is invisible without this. */
    if (p && p.category === 'puller') {
      if (pfCapMax(p) === null) err('products.json', label + ': puller without a tonnage rating — it can never be safety-matched');
      const knownPullerSubtypes = ['hydraulic-jaw-puller', 'universal-puller', 'mechanical-jaw-puller', 'bearing-puller'];
      if (p.subtype && knownPullerSubtypes.indexOf(p.subtype) < 0) {
        warn('products.json', label + ': unknown puller subtype "' + p.subtype + '" — it will not rank correctly');
      }
    }
  });
  ((data && data.torque) || []).forEach(r => {
    const label = (r.bolt || '?') + '/' + (r.grade || '?');
    if (r.wrench_id) {
      const w = products.find(p => p.id === r.wrench_id);
      if (!w) err('torque_chart.json', label + ': wrench_id "' + r.wrench_id + '" does not exist');
      else if (r.verified === true && typeof w.torque_min_nm === 'number' &&
               (r.torque_min_nm < w.torque_min_nm || r.torque_max_nm > w.torque_max_nm)) {
        err('torque_chart.json', label + ': torque ' + r.torque_min_nm + '–' + r.torque_max_nm +
            ' Nm is OUTSIDE the ' + w.name + ' range (' + w.torque_min_nm + '–' + w.torque_max_nm + ' Nm)');
      }
    }
  });
  ((data && data.crossRef) || []).forEach(r => {
    if (!r.competitor_model) err('cross_reference.json', 'row without a competitor_model');
    if (r.our_id && !products.some(p => p.id === r.our_id)) {
      err('cross_reference.json', (r.competitor_model || '?') + ': our_id "' + r.our_id + '" does not exist');
    }
  });
  const seenTerm = {};
  ((data && data.synonyms) || []).forEach(g => {
    if (!(g.terms || []).length) warn('synonyms.json', 'category "' + g.category + '" has no terms');
    (g.terms || []).forEach(t => {
      const k = pfNorm(t);
      if (seenTerm[k] && seenTerm[k] !== g.category) {
        warn('synonyms.json', '"' + t + '" appears under both "' + seenTerm[k] + '" and "' + g.category + '"');
      }
      seenTerm[k] = g.category;
    });
  });
  return out;
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

/* ── Miss log + inquiry logbook (localStorage + best-effort backend sync; CSV exportable) ── */

const PF_INQ_CAP = 300;                 // device cap — the backend sheet (and the CSV) hold the history
let pfStorageWarning = false;           // set when a localStorage write fails (quota) — surfaced in the UI

function pfGetList(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
function pfSetList(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; }
  catch (e) { pfStorageWarning = true; return false; }
}

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
  if (l.length > PF_INQ_CAP) l.length = PF_INQ_CAP;
  pfSetList('pf_inquiries', l);
  pfSyncRow(rec);                                   // best-effort backend save (no-op when unavailable)
  return rec;
}

function pfUpdateInquiry(id, patch) {
  const l = pfGetList('pf_inquiries');
  const i = l.findIndex(x => x.id === id);
  if (i !== -1) {
    l[i] = Object.assign({}, l[i], patch, { updatedAt: new Date().toISOString(), _synced: false });
    pfSetList('pf_inquiries', l);
    pfSyncRow(l[i]);
  }
}

/** Merge device + backend inquiry lists: union by id; the newer updatedAt/date wins a conflict. */
function pfMergeInquiries(local, remote) {
  const byId = {};
  const ts = r => new Date(r.updatedAt || r.date || 0).getTime() || 0;
  (remote || []).forEach(r => { if (r && r.id) byId[r.id] = Object.assign({}, r, { _synced: true }); });
  (local || []).forEach(l => {
    if (!l || !l.id) return;
    const r = byId[l.id];
    if (!r) byId[l.id] = l;                                        // local-only → keep (will push)
    else if (ts(l) > ts(r)) byId[l.id] = Object.assign({}, l, { _synced: false });  // local newer → re-push
  });
  return Object.values(byId).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

/** Follow-up needed: still "new" and older than 3 days. */
function pfFollowUpDue(inq, nowMs) {
  return inq.status === 'new' && ((nowMs || Date.now()) - new Date(inq.date).getTime()) > 3 * 86400000;
}

/** Logbook filtering (pure — the render and the export use the SAME rows). */
function pfFilterInquiries(rows, status, q) {
  let out = rows || [];
  if (status) out = out.filter(r => r.status === status);
  const k = pfNorm(q || '');
  if (k) out = out.filter(r => [r.client, r.industry, r.rawText, r.recommendation, r.notes].some(v => pfNorm(v).indexOf(k) !== -1));
  return out;
}

/** CSV incl. the raw text the customer typed (the future training dataset) + the record id. */
function pfInquiriesCsv(rows) {
  const esc = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['date', 'source', 'client', 'industry', 'raw_text', 'recommendation', 'status', 'notes', 'id'];
  return [head.join(',')].concat((rows || []).map(r =>
    [r.date, r.source, r.client, r.industry, r.rawText, r.recommendation, r.status, r.notes, r.id].map(esc).join(',')
  )).join('\n');
}

/** Miss-log CSV — the synonym-growth / training dataset, finally exportable. */
function pfMissesCsv(rows) {
  const esc = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  return ['date,text'].concat((rows || []).map(r => [r.date, r.text].map(esc).join(','))).join('\n');
}

/** A169: offer the saved client names. Typing the SAME name the client master holds is what lets
 *  the purchase-request form auto-fill that client's address/contact/email (it matches on the name). */
async function pfLoadClients() {
  const dl = document.getElementById('pfClientList');
  if (!dl || typeof fetchFlow !== 'function') return;
  try {
    const res = await fetchFlow('getClients', {});
    const rows = (res && res.data) || [];
    dl.innerHTML = rows.map(c => '<option value="' + pfEsc(c.customer) + '"></option>').join('');
  } catch (e) { /* no backend → the field stays a plain text input */ }
}

/** Who may start a Purchase Request — the same two roles the PR form itself is built for. */
function pfCanCreatePR() {
  try {
    const s = JSON.parse(localStorage.getItem('session') || '{}');
    return s.role === 'sales' || s.role === 'admin';
  } catch (e) { return false; }
}

/* ── Backend logbook sync (FlowAPI PFInquiries, v96+). Best-effort: the device list always works;
      the backend makes it shared + permanent. Degrades silently when flow-api.js / v96 is absent. ── */

const pfSync = { enabled: false, checked: false, msg: '' };

function pfSyncAvailable() {
  return typeof postFlow === 'function' && typeof flowVersionAtLeast === 'function';
}

/** Fire-and-forget: push one inquiry row to the backend, mark it synced on success. */
function pfSyncRow(rec) {
  if (!pfSync.enabled || !pfSyncAvailable() || !rec || !rec.id) return;
  postFlow('savePfInquiry', {
    id: rec.id, date: rec.date, source: rec.source || '', client: rec.client || '',
    industry: rec.industry || '', rawText: rec.rawText || '', recommendation: rec.recommendation || '',
    status: rec.status || 'new', notes: rec.notes || '',
    // A169 — ignored harmlessly by a pre-v97 backend
    itemsJson: rec.items ? JSON.stringify(rec.items) : '', prNo: rec.prNo || ''
  }).then(res => {
    if (res && res.success) {
      const l = pfGetList('pf_inquiries');
      const i = l.findIndex(x => x.id === rec.id);
      if (i !== -1) { l[i]._synced = true; pfSetList('pf_inquiries', l); }
      pfSyncMeta();
    }
  }).catch(() => {});
}

/** On page load: check the backend version, pull the shared list, merge, push anything unsynced. */
async function pfSyncInit() {
  if (pfSync.checked) return;
  pfSync.checked = true;
  if (!pfSyncAvailable()) { pfSync.msg = 'device-only (no backend on this page)'; pfSyncMeta(); return; }
  try {
    if (!(await flowVersionAtLeast(96))) {
      pfSync.msg = 'sync available after the next backend update'; pfSyncMeta(); return;
    }
    pfSync.enabled = true;
    const res = await fetchFlow('getPfInquiries', {});
    const remote = (res && res.success && res.data) || [];
    const merged = pfMergeInquiries(pfGetList('pf_inquiries'), remote).slice(0, PF_INQ_CAP);
    pfSetList('pf_inquiries', merged);
    pfRenderLog();
    merged.filter(r => !r._synced).forEach(pfSyncRow);          // push local-only / locally-newer rows
    pfSync.msg = 'synced with the shared logbook';
    pfSyncMeta();
  } catch (e) { pfSync.msg = 'sync unavailable — device-only for now'; pfSyncMeta(); }
}

function pfSyncMeta() {
  const meta = document.getElementById('pfLogMeta');
  if (!meta) return;
  const rows = pfGetList('pf_inquiries');
  const pending = rows.filter(r => !r._synced).length;
  let t = rows.length + ' inquiry(ies) on this device';
  if (pfSync.enabled) t += pending ? ' · ' + pending + ' waiting to sync' : ' · ' + (pfSync.msg || 'synced');
  else if (pfSync.msg) t += ' · ' + pfSync.msg;
  meta.textContent = t;
}

/* ─────────────────────────── Page wiring (Product Finder tabs) ─────────────────────────── */

const pfEsc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A data failure is shown as a DATA problem with a retry — never disguised as "no product match". */
function pfLoadErrorHtml(errors) {
  return '<div class="cr-warn cr-sect"><h3>Product data did not load</h3>'
    + (errors || []).map(e => '<p class="cr-rec-line">' + pfEsc(e.file) + ' — ' + pfEsc(e.message) + '</p>').join('')
    + '<p class="cr-rec-line">Matching cannot run on missing data. Check the connection, then reload the data and press your button again.</p>'
    + '<div class="cr-actions" style="justify-content:flex-start;margin-top:8px;">'
    + '<button class="cr-btn" onclick="pfReloadData(this)">↻ Reload data</button></div></div>';
}

async function pfReloadData(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Reloading…'; }
  pfData = null; pfLoading = null;
  try {
    const d = await pfLoadData(true);
    if (btn) {
      btn.disabled = false;
      btn.textContent = (d.loadErrors || []).length ? '↻ Still failing — try again' : '✓ Reloaded — press your button again';
    }
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = '↻ Still failing — try again'; } }
}

/** Loads data and, when the files this feature needs are broken, renders the error card. */
async function pfEnsureData(box, needs) {
  try { await pfLoadData(); }
  catch (e) {
    if (box) { box.style.display = ''; box.innerHTML = pfLoadErrorHtml([{ file: 'data', message: e.message }]); }
    return false;
  }
  const errs = (pfData.loadErrors || []).filter(e => (needs || []).includes(e.file));
  if (errs.length) {
    if (box) { box.style.display = ''; box.innerHTML = pfLoadErrorHtml(errs); }
    return false;
  }
  return true;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('pfTabs')) return;      // engine-only / admin contexts also load this file
  /* A177 — guard the PAGE, not one form. The only auth check used to live in cylinder-recommender.js
     gated on `#crForm`, so removing or renaming the Cylinder Selector would have silently un-guarded
     everything here — including the survey, which carries customer contact details. Idempotent: it
     redirects only when there is no valid session, so running alongside that check costs nothing. */
  if (typeof requireProductFinderAccess === 'function' && !requireProductFinderAccess()) return;
  // Industry options come from the one PF_INDUSTRIES constant (no HTML drift)
  const ind = document.getElementById('pfIndustry');
  if (ind && ind.options.length <= 1) {
    ind.innerHTML = '<option value="">— industry —</option>'
      + PF_INDUSTRIES.map(i => '<option value="' + pfEsc(i) + '">' + pfEsc(i) + '</option>').join('');
  }
  try {
    await pfLoadData();
    const errBox = document.getElementById('pfDataErr');
    if (errBox && (pfData.loadErrors || []).length) {
      errBox.style.display = '';
      errBox.textContent = 'Some product data failed to load: '
        + pfData.loadErrors.map(e => e.file + ' (' + e.message + ')').join(' · ') + ' — matching on those files is paused.';
    }
    // Autocomplete suggestions from every synonym term
    const dl = document.getElementById('pfSynList');
    if (dl) dl.innerHTML = pfData.synonyms.flatMap(g => g.terms).map(t => '<option value="' + pfEsc(t) + '"></option>').join('');
    pfRenderLog();
    pfLoadClients();      // A169: consistent company names → the PR form can auto-fill their contacts
  } catch (e) {
    const el = document.getElementById('pfDataErr');
    if (el) { el.style.display = ''; el.textContent = 'Product data failed to load: ' + e.message; }
  }
  pfSyncInit();                                        // best-effort backend logbook sync
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

/* ── In-system result actions (A169) ──────────────────────────────────────────
   opts = { text: <what "Copy details" puts on the clipboard>,
            inquiryId: <INQ-… when this result was logged>,
            product: { name, id, category, capacityTons } when ONE product is identifiable,
            qty }
   "Create Purchase Request" only appears when we have both an inquiry to stamp and a product to
   carry, and only for the roles whose PR form actually exists. */
function pfActionBtns(opts) {
  const o = opts || {};
  const btns = [];
  if (o.inquiryId && o.product && o.product.name && pfCanCreatePR()) {
    btns.push('<button class="cr-btn" onclick="pfCreatePR(' + pfAttr(o.inquiryId) + ',' + pfAttr(o.product) + ',' + (Number(o.qty) || 1) + ')">📝 Create Purchase Request</button>');
  }
  btns.push('<button class="cr-btn cr-btn-sec" onclick="pfCopyDetails(this,' + pfAttr(o.text || '') + ')">📋 Copy details</button>');
  return '<div class="cr-actions" style="justify-content:flex-start;margin-top:10px;">' + btns.join('') + '</div>';
}

/** JSON → a safe inline-handler argument (single-quoted attribute context). */
function pfAttr(v) {
  return pfEsc(JSON.stringify(v)).replace(/"/g, '&quot;');
}

/** Copy that also works on plain http (navigator.clipboard is undefined there, not rejecting). */
function pfCopyDetails(btn, text) {
  const done = okMsg => { if (btn) { const t = btn.textContent; btn.textContent = okMsg; setTimeout(() => { btn.textContent = t; }, 2000); } };
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      done(ok ? '✓ Copied' : '⚠ Could not copy — select the text manually');
    } catch (e) { done('⚠ Could not copy — select the text manually'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done('✓ Copied')).catch(fallback);
  } else fallback();
}

/** Hand off to the Purchase Request form: record WHICH product was chosen, then navigate. */
function pfCreatePR(inquiryId, product, qty) {
  // the localStorage write is synchronous, so it survives the navigation that follows
  pfUpdateInquiry(inquiryId, {
    items: [{ id: product.id || '', name: product.name, category: product.category || '',
              capacityTons: product.capacityTons || null, qty: Number(qty) || 1 }],
    chosenAt: new Date().toISOString()
  });
  window.location.href = 'flow-pricing-request.html?fromInquiry=' + encodeURIComponent(inquiryId);
}

function pfBadge(verified) {
  return verified
    ? '<span class="pf-badge pf-ok">verified</span>'
    : '<span class="pf-badge pf-sample">sample data — needs engineer confirmation</span>';
}

/* ── Feature 1: RFQ mode ── */
async function pfRfqSubmit() {
  const box = document.getElementById('pfRfqResult');
  if (!(await pfEnsureData(box, ['products.json', 'synonyms.json']))) return;
  const text = (document.getElementById('pfItem') || {}).value || '';
  const client = (document.getElementById('pfClient') || {}).value || '';
  const industry = (document.getElementById('pfIndustry') || {}).value || '';
  const purpose = (document.getElementById('pfPurpose') || {}).value || '';
  const qty = (document.getElementById('pfQty') || {}).value || '';
  if (!pfNorm(text)) { box.style.display = ''; box.innerHTML = '<p class="cr-hint">Type what the customer needs first.</p>'; return; }

  const m = pfRfqMatch(text, industry, pfData);
  box.style.display = '';

  // Competitor model typed into the request → show the official crossover above everything.
  const byId = {}; pfData.products.forEach(p => { byId[p.id] = p; });
  const xrefHtml = (m.xref && m.xref.length)
    ? '<div class="cr-rec" style="border-left-color:#f59e0b;"><div class="cr-rec-label">Competitor model detected</div>'
      + m.xref.map(r => '<div class="cr-rec-line">' + pfEsc(r.competitor_brand + ' ' + r.competitor_model)
        + ' → official crossover: <b>' + pfEsc(byId[r.our_id] ? byId[r.our_id].name : r.our_id) + '</b></div>').join('')
      + '</div>'
    : '';

  // Rated ask with no figure: ask for it instead of guessing a size. Nothing is logged yet.
  if (m.needTons || m.needTorque) {
    const torque = !!m.needTorque;
    const chips = torque ? [100, 500, 1000, 2500, 5000, 20000] : [5, 10, 25, 55, 100, 200];
    box.innerHTML = xrefHtml
      + '<div class="cr-sect"><h3>' + (torque ? 'What torque is needed?' : 'What is the load?') + '</h3>'
      + '<p class="cr-rec-line">This is ' + (/^[aeiou]/i.test(m.category) ? 'an' : 'a') + ' <b>' + pfEsc(m.category) + '</b> request, but without the '
      + (torque ? 'torque' : 'load') + ' we would only be guessing a size — and we never suggest an '
      + 'under-rated unit. Tap a figure or type it into the request:</p>'
      + '<div class="cr-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:8px;">'
      + chips.map(v => '<button class="cr-btn cr-btn-sec" onclick="' + (torque ? 'pfPickTorque' : 'pfPickTons')
          + '(' + v + ')">' + v.toLocaleString() + (torque ? ' Nm' : ' t') + '</button>').join('')
      + '</div></div>';
    return;
  }

  const recSummary = m.miss ? PF_CONFIRM_MSG : m.results.map(p => p.name).join(' | ');
  // The inquiry is created BEFORE the render so each card can carry its id into "Create Purchase Request".
  const inq = pfAddInquiry({ source: 'RFQ', client, industry,
    rawText: text + (purpose ? ' | purpose: ' + purpose : '') + (qty ? ' | qty: ' + qty : ''),
    recommendation: recSummary });

  if (m.miss) {
    pfLogMiss(text);
    box.innerHTML = xrefHtml + '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3>'
      + '<p class="cr-rec-line">We could not match "' + pfEsc(text) + '" to a product family. '
      + 'The request is logged so our engineer can follow up.</p></div>'
      + pfActionBtns({ text: pfRfqShareText(text, client, industry, qty, purpose, null) });
  } else {
    box.innerHTML = xrefHtml
      + '<p class="cr-capnote">Matched to <b>' + pfEsc(m.category) + '</b> (from "' + pfEsc(m.matchedTerm) + '")'
      + (m.attrs && m.attrs.tons > 0 ? ' · load ' + pfEsc(m.attrs.tons) + ' t — only sizes that COVER it are shown' : '')
      + (m.relaxed ? ' · <span style="color:#b45309;">no exact model for every requested feature — closest options shown</span>' : '')
      + '. Top options:</p>'
      + m.results.map(p => `
        <div class="cr-rec">
          <div class="cr-rec-label">${pfEsc(p.brand)} ${pfBadge(p.verified)}</div>
          <div class="cr-rec-series">${pfEsc(p.name)}</div>
          <div class="cr-rec-line">${pfEsc(pfWhyFits(p, industry, { attrs: m.attrs }))}</div>
          ${pfPairs(p, pfData.products).length ? '<div class="cr-rec-line"><b>Don’t forget:</b> ' + pfEsc(pfPairs(p, pfData.products).join(' · ')) + '</div>' : ''}
          ${pfActionBtns({ text: pfRfqShareText(text, client, industry, qty, purpose, [p]), inquiryId: inq.id, qty: qty || 1,
                           product: { id: p.id, name: p.name, category: p.category, capacityTons: p.capacity_tons } })}
        </div>`).join('')
      + '<p class="cr-hint">Budgetary matches — final model confirmed by Hi-ESCORP engineer.</p>';
  }
  pfRenderLog();
}

/** Quick-pick load chip on the "what is the load?" prompt. */
function pfPickTons(t) {
  const item = document.getElementById('pfItem');
  if (item) item.value = (item.value + ' ' + t + ' ton').replace(/\s+/g, ' ').trim();
  pfRfqSubmit();
}

function pfPickTorque(nm) {
  const item = document.getElementById('pfItem');
  if (item) item.value = (item.value + ' ' + nm + ' Nm').replace(/\s+/g, ' ').trim();
  pfRfqSubmit();
}

function pfRfqShareText(text, client, industry, qty, purpose, results) {
  return 'Hi-ESCORP Product Finder inquiry\n'
    + (client ? 'Client: ' + client + '\n' : '') + (industry ? 'Industry: ' + industry + '\n' : '')
    + 'Needs: ' + text + (qty ? ' (qty ' + qty + ')' : '') + '\n'
    + (purpose ? 'Purpose: ' + purpose + '\n' : '')
    + (results && results.length ? 'Suggested: ' + results.map(p => p.name).join('; ') : PF_CONFIRM_MSG);
}

/* ── Feature 2: Match mode ── */

/* Bolt / stud dimensions (SPX stud chart, topped up from the company torque chart's width across
   flats). Deliberately independent of torque: the charts print sizes whose torque they do not
   cover, and half an answer beats none — so the dimensions render on EVERY branch below. */
function pfDimLookup(size, rows) {
  return (rows || []).find(r => pfNorm(r.size) === pfNorm(size)) || null;
}

function pfDimBlockHtml(size) {
  const d = pfDimLookup(size, pfData.dims);
  if (!d) return '';                       // a dimension we do not hold is never guessed
  const line = (label, value) => '<div class="cr-rec-line"><b>' + label + ':</b> ' + value + '</div>';
  let out = '';
  if (d.hex_af_mm != null)
    out += line('Hex across flats', pfEsc(d.hex_af_mm) + ' mm (' + pfEsc(d.hex_af_in) + ' in)');
  if (d.stud_size_in)
    out += line('Stud size', pfEsc(d.size) + ' — ' + pfEsc(d.stud_size_in) + ' in'
                + (d.pitch_mm ? ', ' + pfEsc(d.pitch_mm) + ' mm pitch' : ''));
  else if (d.pitch_mm)
    out += line('Thread pitch', pfEsc(d.pitch_mm) + ' mm (ISO 261 coarse)');
  if (d.heavy_hex_in)
    out += line('Heavy hex nut', pfEsc(d.heavy_hex_in) + ' in (' + pfEsc(d.heavy_hex_mm) + ' mm)');
  if (d.regular_hex_in)
    out += line('Regular hex nut', pfEsc(d.regular_hex_in) + ' in (' + pfEsc(d.regular_hex_mm) + ' mm)');
  // only claim the stud half of the answer for sizes the stud chart actually covers
  if (d.stud_size_in) out += line('Stud length', 'per flange spec');
  return '<div class="cr-rec"><div class="cr-rec-label">Dimensions ' + pfBadge(d.verified) + '</div>'
    + out
    + (d.note ? '<div class="cr-rec-line" style="color:#64748b;font-size:12px;">' + pfEsc(d.note) + '</div>' : '')
    + '</div>';
}

function pfGradeLabel(g) { return pfNorm(g) === 'b7' ? 'ASTM A193 B7 stud' : 'grade ' + g; }

/* The charts run from 0.85 Nm to 361,484 Nm — six digits without separators is unreadable and
   easy to misread by a factor of ten, which is exactly the mistake this tool must not invite. */
function pfNm(n) {
  const v = Number(n);
  return isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(n);
}

/* Three tightening bases now coexist (oiled 62%, oiled 90%, B7 at 65% yield) and they are NOT
   interchangeable, so the basis travels with every figure we print. */
function pfBasisHtml(row) {
  const text = (pfData.bases || {})[row.basis];
  return text ? '<div class="cr-rec-line" style="color:#64748b;font-size:12px;">' + pfEsc(text) + '</div>' : '';
}

/* The charts reach 361,484 Nm; the largest tool we carry stops at 39,000 Nm. Say so out loud
   rather than silently omitting the wrench line. */
function pfWrenchHtml(row, byId) {
  const w = byId[row.wrench_id];
  if (w) return '<div class="cr-rec-line"><b>Matching wrench:</b> ' + pfEsc(w.name) + ' ' + pfBadge(w.verified) + '</div>';
  if (row.wrench_status === 'above_range')
    return '<div class="cr-rec-line"><b>Matching wrench:</b> beyond our current tool range — the largest'
      + ' we carry is the TWLC / TWHC hydraulic wrench at 39,000 Nm. The engineer will source a'
      + ' tensioner or a larger tool.</div>';
  if (row.wrench_status === 'below_range')
    return '<div class="cr-rec-line"><b>Matching wrench:</b> below the range of our powered wrenches'
      + ' — a hand torque wrench covers this.</div>';
  return '';
}

async function pfBoltMatch() {
  const box = document.getElementById('pfBoltResult');
  if (!(await pfEnsureData(box, ['torque_chart.json', 'bolt_dimensions.json', 'products.json']))) return;
  const bolt = (document.getElementById('pfBolt') || {}).value || '';
  const grade = (document.getElementById('pfGrade') || {}).value || '';
  box.style.display = '';
  const row = pfTorqueLookup(bolt, grade, pfData.torque);
  const byId = {}; pfData.products.forEach(p => { byId[p.id] = p; });
  const dims = pfDimBlockHtml(bolt);
  const gl = pfGradeLabel(grade);
  const inq = pfAddInquiry({ source: 'Match-bolt', client: '', industry: '', rawText: bolt + ' ' + gl,
    recommendation: row ? (row.verified ? 'torque row' : 'unverified row — confirmation') : PF_CONFIRM_MSG });
  if (!row) {
    pfLogMiss('torque: ' + bolt + ' ' + gl);
    box.innerHTML = dims + '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3><p class="cr-rec-line">Our charts print no torque for ' + pfEsc(bolt) + ' ' + pfEsc(gl) + '. Logged for the engineer.</p></div>';
  } else if (!row.verified) {
    box.innerHTML = dims + '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3>'
      + '<p class="cr-rec-line">Our chart prints ' + pfNm(row.torque_max_nm) + ' Nm for ' + pfEsc(row.bolt) + ' ' + pfEsc(gl)
      + ', but that figure is <b>disputed</b>'
      + (byId[row.wrench_id] ? '; likely tool class: ' + pfEsc(byId[row.wrench_id].name) : '') + '. '
      + 'Torque values are safety-critical, so the engineer must confirm before use.</p>'
      + (row.note ? '<p class="cr-rec-line" style="color:#64748b;font-size:12px;">' + pfEsc(row.note) + '</p>' : '')
      + '</div>';
  } else {
    const w = byId[row.wrench_id];
    const nm = row.torque_min_nm === row.torque_max_nm
      ? '≈ ' + pfNm(row.torque_min_nm)
      : pfNm(row.torque_min_nm) + '–' + pfNm(row.torque_max_nm);
    // the B7 chart prints its own ft-lb column — use it rather than re-deriving it
    const ftlb = pfNm(row.torque_ftlb != null ? row.torque_ftlb : Math.round(row.torque_max_nm * 0.7376));
    box.innerHTML = dims
      + '<div class="cr-rec"><div class="cr-rec-label">Torque ' + pfBadge(true) + '</div>'
      + '<div class="cr-rec-series">' + pfEsc(row.bolt) + ' ' + pfEsc(gl) + ' → ' + nm + ' Nm (≈ ' + ftlb + ' ft·lb)</div>'
      + pfWrenchHtml(row, byId)
      + pfBasisHtml(row)
      + (row.note ? '<div class="cr-rec-line" style="color:#64748b;font-size:12px;">' + pfEsc(row.note) + '</div>' : '')
      + '</div>'
      // the wrench IS the orderable product here — offer it straight to a Purchase Request
      + pfActionBtns({ text: 'Bolt torque: ' + row.bolt + ' ' + gl + ' → ' + pfNm(row.torque_max_nm) + ' Nm' + (w ? '\nWrench: ' + w.name : ''),
                       inquiryId: inq.id, qty: 1,
                       product: w ? { id: w.id, name: w.name, category: w.category } : null });
  }
}

async function pfHoseMatch() {
  const box = document.getElementById('pfHoseResult');
  if (!(await pfEnsureData(box, ['products.json']))) return;
  const thread = (document.getElementById('pfThread') || {}).value || '';
  const pressure = parseFloat((document.getElementById('pfPressure') || {}).value) || 0;
  const unit = (document.getElementById('pfPressureUnit') || {}).value || 'bar';
  const bar = unit === 'psi' ? pfPsiToBar(pressure) : unit === 'mpa' ? pfMpaToBar(pressure) : pressure;
  box.style.display = '';
  if (!(bar > 0)) { box.innerHTML = '<p class="cr-hint">Enter the working pressure first — the match must never be rated below it.</p>'; return; }
  const r = pfCouplerMatch(thread, bar, pfData.products);
  const inq = pfAddInquiry({ source: 'Match-hose', client: '', industry: '',
    rawText: 'thread ' + thread + ' @ ' + pressure + ' ' + unit,
    recommendation: r.matches.length ? r.matches.map(p => p.name).join('; ') : PF_CONFIRM_MSG });
  let html = '<p class="cr-capnote">Working pressure ' + pressure + ' ' + pfEsc(unit) + (unit !== 'bar' ? ' (≈ ' + bar.toFixed(0) + ' bar)' : '') + ' — only items rated <b>at or above</b> this are ever shown.</p>';
  if (r.matches.length) {
    html += r.matches.map(p => '<div class="cr-rec"><div class="cr-rec-label">' + pfEsc(p.brand) + ' ' + pfBadge(true) + '</div>'
      + '<div class="cr-rec-series">' + pfEsc(p.name) + '</div>'
      + '<div class="cr-rec-line">Thread ' + pfEsc(p.thread || '—') + ' · rated ' + pfEsc(p.max_pressure_bar) + ' bar ≥ your ' + bar.toFixed(0) + ' bar.</div>'
      + (p.source ? '<div class="cr-rec-line" style="color:#64748b;font-size:12px;">Spec source: ' + pfEsc(p.source) + '</div>' : '')
      + pfActionBtns({ text: 'Coupler/hose for thread ' + (thread || '(any)') + ' @ ' + pressure + ' ' + unit + ':\n' + p.name + ' (rated ' + p.max_pressure_bar + ' bar)',
                       inquiryId: inq.id, qty: 1,
                       product: { id: p.id, name: p.name, category: p.category } })
      + '</div>').join('');
  } else {
    pfLogMiss('coupler: thread ' + thread + ' @ ' + bar.toFixed(0) + ' bar');
    html += '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3><p class="cr-rec-line">No <b>verified</b> coupler in our data covers this thread + pressure. Logged for the engineer.'
      + (r.samples.length ? ' (Sample rows exist but sample pressure ratings are never used for safety matches.)' : '') + '</p></div>'
      + pfActionBtns({ text: 'Coupler/hose needed: thread ' + (thread || '(any)') + ' @ ' + pressure + ' ' + unit + '\n' + PF_CONFIRM_MSG });
  }
  box.innerHTML = html;
}

async function pfCylMatch() {
  try { await pfLoadData(); } catch (e) {}             // engine-only — works even if data files fail
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
    // a pump SET is several models, not one orderable line — copy only, no Create-PR
    + pfActionBtns({ text: 'Pump set for ' + tons + 't ' + acting + '-acting cylinder:\n' + pump.join('\n') });
  pfAddInquiry({ source: 'Match-cylinder', client: '', industry: '', rawText: tons + 't ' + acting + '-acting, power: ' + (power || 'unknown'), recommendation: pump[0] });
}

/* ── Feature 4: cross-reference ── */
async function pfXrefSearch() {
  const box = document.getElementById('pfXrefResult');
  if (!(await pfEnsureData(box, ['cross_reference.json', 'products.json']))) return;
  const q = (document.getElementById('pfXrefQ') || {}).value || '';
  box.style.display = '';
  const rows = pfCrossRef(q, pfData.crossRef);
  const byId = {}; pfData.products.forEach(p => { byId[p.id] = p; });
  // "what is your equivalent for <competitor model>?" is a real customer request — log it like the rest
  const inq = pfAddInquiry({ source: 'Cross-Ref', client: '', industry: '', rawText: q,
    recommendation: rows.length
      ? rows.map(r => (byId[r.our_id] ? byId[r.our_id].name : r.our_id)).join('; ')
      : PF_CONFIRM_MSG });
  if (!rows.length) {
    pfLogMiss('xref: ' + q);
    box.innerHTML = '<div class="cr-warn cr-sect"><h3>' + pfEsc(PF_CONFIRM_MSG) + '</h3><p class="cr-rec-line">"' + pfEsc(q) + '" is not in our cross-reference yet. Logged so we can add it.</p></div>'
      + pfActionBtns({ text: 'Cross-reference request: ' + q + '\n' + PF_CONFIRM_MSG });
    pfRenderLog();
    return;
  }
  box.innerHTML = rows.map(r => {
    const ours = byId[r.our_id];
    return '<div class="cr-rec"><div class="cr-rec-label">' + pfEsc(r.competitor_brand) + ' ' + pfEsc(r.competitor_model) + ' ' + pfBadge(r.verified === true) + '</div>'
      + '<div class="cr-rec-series">→ ' + pfEsc(ours ? ours.name : r.our_id) + '</div>'
      + (r.note ? '<div class="cr-rec-line">' + pfEsc(r.note) + '</div>' : '')
      + pfActionBtns({ text: 'Cross-reference: ' + r.competitor_brand + ' ' + r.competitor_model + ' → ' + (ours ? ours.name : r.our_id),
                       inquiryId: inq.id, qty: 1,
                       product: ours ? { id: ours.id, name: ours.name, category: ours.category, capacityTons: ours.capacity_tons } : null });
  }).join('');
  pfRenderLog();
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
  const q = (document.getElementById('pfLogSearch') || {}).value || '';
  const all = pfGetList('pf_inquiries');
  const rows = pfFilterInquiries(all, status, q);
  pfSyncMeta();
  let warn = '';
  if (pfStorageWarning) {
    warn = '<div class="cr-warn cr-sect"><p class="cr-rec-line">⚠ Could not save on this device — storage is full. Export the CSV now so nothing is lost.</p></div>';
  } else if (all.length >= PF_INQ_CAP - 30) {
    warn = '<div class="cr-warn cr-sect"><p class="cr-rec-line">⚠ This device keeps only the latest ' + PF_INQ_CAP + ' inquiries (' + all.length + ' stored) — export the CSV to keep the full history.</p></div>';
  }
  if (!rows.length) { box.innerHTML = warn + '<p class="cr-hint">No inquiries yet — every RFQ / Match / Cross-Ref submission is saved here automatically.</p>'; return; }
  box.innerHTML = warn + rows.map(r => `
    <div class="cr-rec" style="border-left-color:${r.status === 'won' ? '#16a34a' : r.status === 'lost' ? '#dc2626' : '#4f46e5'};">
      <div class="cr-rec-label">${pfEsc(String(r.date).slice(0, 10))} · ${pfEsc(r.source)}
        ${pfFollowUpDue(r) ? '<span class="pf-badge pf-follow">follow up!</span>' : ''}</div>
      <div class="cr-rec-line"><b>${pfEsc(r.client || '(no client)')}</b>${r.industry ? ' · ' + pfEsc(r.industry) : ''}</div>
      <div class="cr-rec-line">Asked: ${pfEsc(r.rawText)}</div>
      <div class="cr-rec-line">Shown: ${pfEsc(r.recommendation)}</div>
      ${r.prNo ? '<div class="cr-rec-line">Became: <a href="flow-pricing-request.html" style="font-weight:600;color:#4f46e5;">→ ' + pfEsc(r.prNo) + '</a></div>' : ''}
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

function pfDownloadCsv(csv, name) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Exports what the Logbook currently SHOWS (the active status filter + search). */
function pfExportLog() {
  const status = (document.getElementById('pfLogStatus') || {}).value || '';
  const q = (document.getElementById('pfLogSearch') || {}).value || '';
  const rows = pfFilterInquiries(pfGetList('pf_inquiries'), status, q);
  pfDownloadCsv(pfInquiriesCsv(rows), 'product-finder-inquiries-' + new Date().toISOString().slice(0, 10) + '.csv');
}
