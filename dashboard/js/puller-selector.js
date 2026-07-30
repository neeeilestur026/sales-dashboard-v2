/* puller-selector.js — A185 Hydraulic Puller Selector.
 *
 * The sibling of the Bolting Application Survey (A177): print a blank survey for a hard copy, fill it
 * on screen, get a puller family suggested from the answers, override that suggestion, and export a PDF
 * carrying whichever was chosen. Same split as A164/A177 — `psRecommend` is a PURE function over the
 * answers + the loaded JSON, testable with no DOM; the `ps*` wiring below reads the form and renders.
 *
 * Choosing a puller wrong costs twice: one whose jaws cannot physically reach around the part is
 * useless, and one rated under the breakaway force is a safety problem. So the same rule the whole
 * Product Finder is built on holds here — a figure comes from verified data or it does not come at all:
 *
 *   · WE HOLD NO JAW GEOMETRY. There is not one spread_mm / reach_mm / jaw_count anywhere in the data;
 *     the five puller rows are FAMILY-level with a tonnage range only. So this computes and STATES what
 *     the job requires ("≥264 mm spread, ≥160 mm reach, 3-jaw") and defers fitment to the model's own
 *     dimension table. It never filters on numbers we do not have, and never invents one.
 *     If per-model dimensions are ever obtained they belong in a NEW dashboard/data/puller_geometry.json
 *     keyed by MODEL — added to PF_DATA_FILES/PF_FILE_KEYS the way torque_chart.json is — not as scalar
 *     columns on family rows, where a single spread_mm on "PTPH 50–200 t" would assert a uniformity that
 *     does not exist.
 *   · The force is a Lamé interference-fit ESTIMATE with one assumed constant (the fit's interference
 *     ratio), and it REFUSES rather than guess whenever that assumption cannot be grounded — see
 *     psForceEstimate. A confidently wrong tonnage is worse than no tonnage.
 *   · Unlike the bolting survey, INCH INPUT IS CONVERTED HERE, NOT REFUSED. A177 refused imperial bolts
 *     because there is no verified imperial torque *chart* to look up. Here nothing is looked up —
 *     length is length and ×25.4 is exact.
 */

/* ── The engineering constants. Every one of these is printed on the document when it is used. ── */
const PS_E_STEEL = 207000;      // Young's modulus, steel, N/mm²
const PS_MU = 0.15;             // steel-on-steel sliding friction, dry-ish assembled fit

/* Interference ratio δ/d by fit class — THE assumed constant, and the reason the assumption line is
   printed. Mid-range of the ISO class: press ≈ H7/s6, shrink ≈ H7/u6. A slip fit has no designed
   interference at all, so Lamé does not apply to it (handled separately below). */
const PS_FIT_RATIO = { press: 0.0006, shrink: 0.0012 };

/* Two margins, named separately and never merged into one number on the page.
   Condition: an in-service part is fretted/corroded and breaks away at 2–3× the clean static value.
   Selection: reuses the repo's OWN load-rated margin from ptCapacity (cylinder-recommender.js:26-30),
   so the two selectors cannot disagree about what "margin" means. */
const PS_COND_FACTOR = 2.0;
const PS_SEL_MARGIN = 1.25;

const PS_MIN_DD_RATIO = 1.25;   // below this K_geo is steepest and hoop yield may beat sliding — refuse
const PS_MECH_MAX_T = 10;       // nobody turns a forcing screw above ~10 t, whatever the plate says
const PS_JAW4_MIN_T = 50;       // above this, spread a heavy pull over four contacts

/* Rank on a NUMERIC tie only. Hydraulic-jaw is the workhorse: progressive force, no stick-slip, and the
   operator is not standing over a loaded part swinging a wrench. Universal (Grip-O-Matic) is excellent
   but the heavier, costlier production variant — the hard-constraint tier already promotes it when its
   conditions actually hold, so it should not also win ties by default. Mechanical is right and cheapest
   at low tonnage but unpowered. Bearing-puller is application-specific machinery that only reaches the
   sort at all if its application gate passed. */
const PS_SUBTYPE_RANK = { 'hydraulic-jaw-puller': 0, 'universal-puller': 1,
                          'mechanical-jaw-puller': 2, 'bearing-puller': 3 };
const PS_KNOWN_SUBTYPES = Object.keys(PS_SUBTYPE_RANK);

/* pt-pr3100j is a RAILROAD AXLE roller bearing puller/installer. Its 100 t "covers" a pump bearing
   arithmetically, but offering it for one is wrong. Gate it on the application actually being rail. */
const PS_RAIL_RE = /\b(rail|railcar|railroad|railway|locomotive|axle|wheelset|bogie|traction motor)\b/i;

function psNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function psStr(v) { return String(v == null ? '' : v).trim(); }

/** A length in the form's unit → mm. Exact: inch is defined as 25.4 mm. */
function psMm(value, unit) {
  const n = psNum(value);
  if (!(n > 0)) return 0;
  return String(unit || 'mm').toLowerCase() === 'in' ? n * 25.4 : n;
}

/* Local fallbacks for the two product-finder helpers this engine needs, so psRecommend runs in a bare
   Node context with no DOM and no product-finder.js — the same trick bsTorqueRow uses at
   bolting-survey.js:210-214, and what lets the test harness drive the decision table directly. */
function psCapMax(p) {
  if (typeof pfCapMax === 'function') return pfCapMax(p);
  if (typeof p.capacity_max_tons === 'number') return p.capacity_max_tons;
  if (typeof p.capacity_tons === 'number') return p.capacity_tons;
  return null;
}
function psCapMin(p) {
  if (typeof pfCapMin === 'function') return pfCapMin(p);
  if (typeof p.capacity_min_tons === 'number') return p.capacity_min_tons;
  if (typeof p.capacity_tons === 'number') return p.capacity_tons;
  return null;
}

/** Lamé geometry factor for a solid shaft in a hollow hub of the same material: (D²−d²)/(2D²).
 *  The Poisson terms cancel in the same-material case, so no ν has to be assumed. This is why part OD
 *  does real work in the estimate: 0.20 at D/d=1.25, 0.375 at D/d=2 — a thin hub genuinely pulls easier. */
function psGeomFactor(D, d) {
  if (!(D > 0) || !(d > 0) || D <= d) return 0;
  return (D * D - d * d) / (2 * D * D);
}

/* Required pulling force. Returns {tons, designTons, source, assumption, blockers[]}.
 *
 * source 'stated'    — the customer gave a tonnage; it is used as-is and NOT re-marginned. Their figure
 *                      already carries whatever margin they intended (mirrors bolting-survey.js:121-124).
 * source 'estimated' — computed below, with `assumption` naming every constant used.
 * source 'none'      — REFUSED. `blockers` names each missing/ungroundable input. No number is produced.
 */
function psForceEstimate(a) {
  const out = { tons: 0, designTons: 0, source: 'none', assumption: '', blockers: [] };

  const stated = psNum(a.knownTons);
  if (stated > 0) {
    out.tons = stated; out.designTons = stated; out.source = 'stated';
    out.assumption = 'Pulling force supplied by the customer (' + stated + ' t) — used as given, not re-marginned.';
    return out;
  }

  const D = psMm(a.partOd, a.dimUnit);
  const d = psMm(a.shaftDia, a.dimUnit);
  const L = psMm(a.contactLen, a.dimUnit);
  const fit = psStr(a.fitType).toLowerCase();

  if (!fit || fit === 'unknown') out.blockers.push('Fit type (slip / press / shrink)');
  if (!(d > 0)) out.blockers.push('Shaft diameter');
  if (!(L > 0)) out.blockers.push('Hub / bearing width (contact length along the shaft)');
  if (fit !== 'slip') {
    if (!(D > 0)) out.blockers.push('Part outside diameter');
    else if (d > 0 && D <= d) out.blockers.push('Part OD must be larger than the shaft diameter');
    else if (d > 0 && D / d < PS_MIN_DD_RATIO) {
      out.blockers.push('Hub is very thin (OD/shaft = ' + (D / d).toFixed(2) + ', under ' +
        PS_MIN_DD_RATIO + ') — the hub may yield before the fit slides, so this needs the engineer');
    }
  }
  if (out.blockers.length) return out;

  if (fit === 'slip') {
    /* No designed interference, so Lamé does not apply. This is a corrosion/seizure allowance, not a
       calculation — and it says so on the page, because a number with no theory behind it must not be
       mistaken for one that has. */
    out.tons = Math.max(1, (d * L) / 4000);
    out.source = 'estimated';
    out.assumption = 'Slip fit — no designed interference, so no interference-fit calculation applies. ' +
      'The figure below is a corrosion/seizure ALLOWANCE (from the contact area), not a calculation, ' +
      'with a ×' + PS_COND_FACTOR + ' in-service condition factor and a ×' + PS_SEL_MARGIN + ' selection margin.';
  } else {
    const ratio = PS_FIT_RATIO[fit];
    if (!ratio) { out.blockers.push('Fit type (slip / press / shrink)'); return out; }
    const kGeo = psGeomFactor(D, d);
    const p = PS_E_STEEL * ratio * kGeo;          // contact pressure, N/mm²
    const f = PS_MU * Math.PI * d * L * p;        // axial breakaway, N
    out.tons = f / 9806.65;                       // tonnes-force
    out.source = 'estimated';
    out.assumption = 'Estimated from the interference fit: ' + fit + ' fit assumed at ' +
      (ratio * 1000).toFixed(1) + '‰ interference (mid ISO ' + (fit === 'shrink' ? 'H7/u6' : 'H7/s6') +
      '), steel on steel (E ' + PS_E_STEEL.toLocaleString() + ' N/mm², friction ' + PS_MU + '), ' +
      'contact area Ø' + Math.round(d) + ' × ' + Math.round(L) + ' mm. ' +
      'Then ×' + PS_COND_FACTOR + ' for an in-service (fretted/corroded) part and ×' + PS_SEL_MARGIN +
      ' selection margin.';
  }
  out.designTons = out.tons * PS_COND_FACTOR * PS_SEL_MARGIN;
  return out;
}

/* What the job physically requires of the tool. Computed and STATED — never matched against catalogue
 * data, because we hold none. Returns {spreadMm, reachMm, travelMm, jaws, jawReason, notes[]}. */
function psGeometryReq(a, designTons) {
  const D = psMm(a.partOd, a.dimUnit);
  const reach = psMm(a.reach, a.dimUnit);
  const L = psMm(a.contactLen, a.dimUnit);
  const out = { spreadMm: 0, reachMm: 0, travelMm: 0, jaws: 0, jawReason: '', notes: [] };

  /* The jaw leg has to pass OUTSIDE the part's largest diameter and then hook back in, so the spread
     must exceed the OD by a leg's thickness each side. Legs run ~12–25 mm on this class of puller —
     hence a 20 mm floor with a proportional term above it. */
  if (D > 0) out.spreadMm = Math.round(D + 2 * Math.max(20, 0.10 * D));
  if (reach > 0) out.reachMm = Math.round(Math.max(reach + 10, reach * 1.05));
  /* Travel is STROKE and is deliberately separate from reach, which is static geometry. The part has to
     move its full engagement length to come free — on a long hub that may mean re-setting the puller. */
  if (L > 0) out.travelMm = Math.round(L);

  if (psStr(a.accessObstructed) === 'true' || a.accessObstructed === true) {
    out.jaws = 2;
    out.jawReason = 'access is obstructed on two opposing sides, so a third jaw has nowhere to sit';
  } else if (designTons > PS_JAW4_MIN_T) {
    out.jaws = 4;
    out.jawReason = 'above ' + PS_JAW4_MIN_T + ' t, spreading the pull over four contacts avoids ' +
      'point-loading and crushing the rim';
  } else {
    out.jaws = 3;
    out.jawReason = 'three points self-centre on a round part, which keeps the pull axial — off-axis ' +
      'pull is the main cause of jaw slip';
  }

  const endCond = psStr(a.shaftEndCond).toLowerCase();
  if (/thread|centre|center|drill|damag|burr|chew/.test(endCond)) {
    out.notes.push('Shaft end is threaded/centre-drilled/damaged — use a centre protector, the ram or ' +
      'screw bears directly on it.');
  }
  if (psStr(a.location) === 'vertical-shaft') {
    out.notes.push('Shaft axis is vertical — confirm the vertical model variant of the chosen family.');
  }
  out.notes.push('Confirm jaw spread, reach and stroke against the selected model’s dimension table ' +
    'before ordering — we hold family ratings only, not per-model jaw geometry.');
  return out;
}

/** True when the family's VERIFIED features prose claims an n-jaw configuration. Read the prose rather
 *  than duplicating it into a jaw_count column that could drift out of step with it. */
function psHasJaw(p, n) {
  const txt = ((p && p.features) || []).join(' ');
  return new RegExp('(^|[^0-9])' + n + '([^0-9]|$)').test(txt) && /jaw/i.test(txt);
}

/** Every puller family whose rating covers the design load, best fit first.
 *  ctx = {needSelfCentring, noPower, railApp} */
function psCandidates(designTons, products, ctx) {
  ctx = ctx || {};
  const pullers = (products || []).filter(p => p.category === 'puller' && p.verified);

  const covers = pullers.filter(p => {
    const lo = psCapMin(p), hi = psCapMax(p);
    if (hi === null) return false;
    /* pt-pr3100j carries a DISCRETE capacity_tons, so pfCapMin and pfCapMax both return 100 and a naive
       lo <= t <= hi would pass only at exactly 100.0 t. A discrete rating covers anything up to it. */
    if (lo === hi) {
      if (designTons > hi) return false;
    } else if (!(lo <= designTons && designTons <= hi)) return false;
    // Application gate: the rail-axle machine is only offered for rail work.
    if (p.subtype === 'bearing-puller' && !ctx.railApp) return false;
    return true;
  });

  // Math.max(1, …) mirrors bolting-survey.js:69 and is what stops the discrete row producing NaN.
  const pos = p => (designTons - psCapMin(p)) / Math.max(1, psCapMax(p) - psCapMin(p));
  const inBand = p => pos(p) >= 0.2 && pos(p) <= 0.8;

  return covers.slice().sort((a, b) => {
    /* 1 — hard type constraints. ORDER MATTERS AND IS LOAD-BEARING.
       Self-centring is tested BEFORE jaw count: the Grip-O-Matic is picked for its grip MECHANISM (it
       self-tightens as the pull rises, and the family carries a hydraulic lift for positioning), which
       is what makes it the repeat-duty and awkward-part answer. Jaw count is a property of jaw pullers
       and is not a competing virtue against a different mechanism. Testing jaw-count first inverted
       this — at 70 t repeat duty the 4-jaw clause fired and the self-centring clause was never reached,
       so PTPH beat the ENFORCER on a job the ENFORCER exists for. */
    if (ctx.needSelfCentring) {
      const au = a.subtype === 'universal-puller' ? 0 : 1, bu = b.subtype === 'universal-puller' ? 0 : 1;
      if (au !== bu) return au - bu;
    }
    if (designTons > PS_JAW4_MIN_T) {
      const a4 = psHasJaw(a, 4) ? 0 : 1, b4 = psHasJaw(b, 4) ? 0 : 1;
      if (a4 !== b4) return a4 - b4;
    }
    if (ctx.noPower && designTons <= 40) {
      const am = a.subtype === 'mechanical-jaw-puller' ? 0 : 1, bm = b.subtype === 'mechanical-jaw-puller' ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    // 2 — a family working in the middle of its range beats one at an extreme. A 200 t machine on a
    //     5 t bearing is unwieldy to mobilise and its jaws will not close on a small part.
    const ab = inBand(a) ? 0 : 1, bb = inBand(b) ? 0 : 1;
    if (ab !== bb) return ab - bb;
    // 3 — near-tie on position → break on subtype.
    const da = Math.abs(pos(a) - 0.5), db = Math.abs(pos(b) - 0.5);
    if (Math.abs(da - db) < 0.05) {
      const rank = p => PS_SUBTYPE_RANK[p.subtype] === undefined ? 9 : PS_SUBTYPE_RANK[p.subtype];
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
    }
    // 4 — otherwise closest to mid-range.
    return da - db;
  });
}

/** The catalogue's overall tonnage window, for the honest "we don't cover that" message. */
function psCatalogueRange(products) {
  const r = (products || []).filter(p => p.category === 'puller' && psCapMax(p) !== null);
  if (!r.length) return null;
  return { lo: Math.min.apply(null, r.map(p => psCapMin(p))),
           hi: Math.max.apply(null, r.map(p => psCapMax(p))) };
}

/* ── The pure engine ───────────────────────────────────────────────────────────────────────────────
   psRecommend(answers, data) → everything the page and the PDF need, with no DOM touched. */
function psRecommend(answers, data) {
  const a = answers || {};
  const products = (data && data.products) || [];
  const r = {
    designTons: 0, estTons: 0, forceSource: 'none', forceAssumption: '',
    geometry: null, primary: null, alternates: [],
    warnings: [], missing: [], conditionFlags: [], needsEngineer: false
  };

  // 1 ── the force
  const f = psForceEstimate(a);
  r.estTons = f.tons;
  r.designTons = f.designTons;
  r.forceSource = f.source;
  r.forceAssumption = f.assumption;
  if (f.source === 'none') {
    f.blockers.forEach(b => r.missing.push(b));
  }

  // 2 ── the geometry requirement. Needs only OD / reach / contact length, so it still computes and
  //      still prints even when the force refused — which keeps the sheet useful either way.
  r.geometry = psGeometryReq(a, r.designTons);
  if (!psMm(a.partOd, a.dimUnit)) r.missing.push('Part outside diameter (for the jaw spread)');
  if (!psMm(a.reach, a.dimUnit)) r.missing.push('Reach — pulling face to the shaft end');

  // 3 ── the conditions that change the METHOD, not just the number
  const fit = psStr(a.fitType).toLowerCase();
  if (fit === 'shrink') {
    r.conditionFlags.push('A shrink fit is designed to be released with heat. Pulling it cold ' +
      'multiplies the force required and risks cracking the hub or brinelling the bearing — confirm ' +
      'with the engineer whether induction heating is the correct method.');
    r.needsEngineer = true;
  }

  // 4 ── the tool
  const loc = psStr(a.location);
  if (loc === 'blind-bore' || psStr(a.jobType) === 'blind-hole') {
    /* A jaw puller has nothing to hook behind a blind-bore inner race. Downgrading to one would be
       wrong, so refuse outright — and record the catalogue gap, which is what pfLogMiss is for. */
    r.warnings.push('This needs an internal / blind-hole puller (slide-hammer or bearing separator) — ' +
      'there is no accessible outer rim for a jaw puller to grip. Our catalogue does not hold one.');
    r.needsEngineer = true;
    return r;
  }

  if (r.forceSource === 'none') return r;   // no load → nothing to size against; geometry already stated

  const duty = psStr(a.duty);
  const ctx = {
    needSelfCentring: (duty === 'repeat' || psStr(a.awkwardPosition) === 'true' || a.awkwardPosition === true),
    noPower: (psStr(a.noPower) === 'true' || a.noPower === true),
    railApp: PS_RAIL_RE.test(psStr(a.application) + ' ' + psStr(a.industry) + ' ' + psStr(a.jobType))
  };
  const cands = psCandidates(r.designTons, products, ctx);

  if (!cands.length) {
    const range = psCatalogueRange(products);
    r.warnings.push('No puller in our catalogue covers ' + r.designTons.toFixed(1) + ' t' +
      (range ? ' (ours run ' + range.lo + '–' + range.hi + ' t)' : '') +
      '. Induction heating or a multi-point arrangement may be the correct method — the engineer will advise.');
    r.needsEngineer = true;
    return r;
  }

  r.primary = cands[0];
  r.alternates = cands.slice(1);

  /* A mechanical screw puller is rated well above what anyone can actually turn by hand. Keep it as a
     valid alternate up to its plate rating, but never let it lead above the practical ceiling. */
  if (r.primary.subtype === 'mechanical-jaw-puller' && r.designTons > PS_MECH_MAX_T) {
    const hyd = cands.find(p => p.subtype !== 'mechanical-jaw-puller');
    if (hyd) {
      r.alternates = cands.filter(p => p !== hyd);
      r.primary = hyd;
    }
    r.warnings.push('Above about ' + PS_MECH_MAX_T + ' t a mechanical screw puller is impractical to ' +
      'turn by hand and stick-slip shock-loads the jaws — a hydraulic puller is the working answer.');
  }
  if (r.forceSource === 'estimated') {
    r.warnings.push('The pulling force is an ESTIMATE from the stated fit, not a measured value. ' +
      'Confirm it before committing to the tool.');
  }
  return r;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
   Page wiring. Everything below reads the form and renders; nothing above it touches the DOM.
   ══════════════════════════════════════════════════════════════════════════════════════════════════ */

let psResult = null;
let psInquiryId = '';

/* Must stay in step with the ids in #pane-puller. */
const PS_FIELDS = ['psRequestBy', 'psRequestDate', 'psIndustry', 'psCustomer', 'psApplication',
  'psContact', 'psVisitDate', 'psPhone', 'psEmail', 'psQuantity',
  'psJobType', 'psLocation', 'psDuty', 'psAccessObstructed', 'psAwkwardPosition', 'psNoPower',
  'psDimUnit', 'psPartOd', 'psShaftDia', 'psReach', 'psContactLen', 'psShaftEndCond',
  'psFitType', 'psKnownTons', 'psOpportunity', 'psNotes'];

function psVal(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  return el.value || '';
}

function psCollect() {
  return {
    requestBy: psVal('psRequestBy'), requestDate: psVal('psRequestDate'),
    industry: psVal('psIndustry'), customer: psVal('psCustomer'),
    application: psVal('psApplication'), contact: psVal('psContact'),
    visitDate: psVal('psVisitDate'), phone: psVal('psPhone'), email: psVal('psEmail'),
    quantity: psVal('psQuantity'),
    jobType: psVal('psJobType'), location: psVal('psLocation'), duty: psVal('psDuty'),
    accessObstructed: psVal('psAccessObstructed'), awkwardPosition: psVal('psAwkwardPosition'),
    noPower: psVal('psNoPower'),
    dimUnit: psVal('psDimUnit') || 'mm', partOd: psVal('psPartOd'), shaftDia: psVal('psShaftDia'),
    reach: psVal('psReach'), contactLen: psVal('psContactLen'), shaftEndCond: psVal('psShaftEndCond'),
    fitType: psVal('psFitType'), knownTons: psVal('psKnownTons'),
    opportunity: psVal('psOpportunity'), notes: psVal('psNotes')
  };
}

/** Re-label the measurement fields when the unit changes — the numbers are not touched. */
function psSyncUnit() {
  const u = psVal('psDimUnit') === 'in' ? 'in' : 'mm';
  ['psPartOdUnit', 'psShaftDiaUnit', 'psReachUnit', 'psContactLenUnit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = u;
  });
}

function psWhy(p, designTons) {
  const lo = psCapMin(p), hi = psCapMax(p);
  const range = (lo === hi) ? (hi + ' t') : (lo + '–' + hi + ' t');
  return p.series + ' covers ' + range + ', so a ' + designTons.toFixed(1) + ' t pull sits inside its rating.';
}

async function psSuggest() {
  const box = document.getElementById('psResult');
  if (!box) return;
  if (typeof pfEnsureData === 'function' && !(await pfEnsureData(box, ['products.json']))) return;

  const a = psCollect();
  const data = (typeof pfData !== 'undefined' && pfData) ? pfData : { products: [] };
  const r = psRecommend(a, data);
  psResult = { answers: a, rec: r };
  box.style.display = '';

  const esc = (typeof pfEsc === 'function') ? pfEsc : (s => String(s == null ? '' : s));
  const confirmMsg = (typeof PF_CONFIRM_MSG === 'string')
    ? PF_CONFIRM_MSG : 'Needs engineer confirmation — Hi-ESCORP will contact you.';

  // Log it like every other Product Finder path, so the survey is tracked and can spawn a PR.
  if (typeof pfAddInquiry === 'function' && !psInquiryId) {
    psInquiryId = pfAddInquiry({
      source: 'Puller Selector', customer: a.customer, industry: a.industry,
      text: psSummaryText(a, r), qty: psNum(a.quantity) || 1,
      product: r.primary ? { id: r.primary.id, name: r.primary.name, category: r.primary.category } : null
    }) || '';
  }
  if (typeof pfLogMiss === 'function' && !r.primary) {
    // A refusal is intelligence about a real catalogue gap — record what was asked for.
    pfLogMiss((psStr(a.location) === 'blind-bore' || psStr(a.jobType) === 'blind-hole')
      ? 'puller: internal / blind-hole puller (slide-hammer or bearing separator)'
      : 'puller: ' + (r.designTons > 0 ? r.designTons.toFixed(0) + ' t' : 'unsized'));
  }

  let html = '';
  if (r.missing.length) {
    html += '<div class="cr-warn cr-sect"><h3>A little more is needed</h3><p class="cr-rec-line">' +
      'To size the puller we need: <b>' + esc(r.missing.join(', ')) + '</b>. ' +
      'Everything else you have entered is kept and will print on the PDF.</p></div>';
  }

  if (r.forceSource !== 'none') {
    const label = r.forceSource === 'stated' ? 'Pulling force (as supplied)' : 'Estimated pulling force';
    html += '<div class="cr-rec"><div class="cr-rec-label">' + label + '</div>' +
      '<div class="cr-rec-series">' + r.designTons.toFixed(1) + ' t design load</div>' +
      (r.forceSource === 'estimated'
        ? '<div class="cr-rec-line">Breakaway ≈ ' + r.estTons.toFixed(1) + ' t × ' + PS_COND_FACTOR +
          ' (in-service condition) × ' + PS_SEL_MARGIN + ' (selection margin) = ' +
          r.designTons.toFixed(1) + ' t.</div>' : '') +
      '<div class="cr-rec-line">' + esc(r.forceAssumption) + '</div></div>';
  }

  const g = r.geometry;
  if (g && (g.spreadMm || g.reachMm || g.jaws)) {
    const bits = [];
    if (g.spreadMm) bits.push('jaw spread <b>≥ ' + g.spreadMm + ' mm</b>');
    if (g.reachMm) bits.push('reach <b>≥ ' + g.reachMm + ' mm</b>');
    if (g.travelMm) bits.push('travel <b>≥ ' + g.travelMm + ' mm</b>');
    if (g.jaws) bits.push('<b>' + g.jaws + '-jaw</b>');
    html += '<div class="cr-rec" style="margin-top:8px;"><div class="cr-rec-label">Tool geometry the job needs</div>' +
      '<div class="cr-rec-line">' + bits.join(' · ') + '</div>' +
      (g.jawReason ? '<div class="cr-rec-line">' + g.jaws + '-jaw because ' + esc(g.jawReason) + '.</div>' : '') +
      g.notes.map(n => '<div class="cr-rec-line">' + esc(n) + '</div>').join('') + '</div>';
  }

  r.conditionFlags.forEach(f => {
    html += '<div class="cr-warn cr-sect" style="margin-top:8px;"><h3>Check this before pulling</h3>' +
      '<p class="cr-rec-line">' + esc(f) + '</p></div>';
  });

  if (r.primary) {
    html += '<div class="cr-rec" style="margin-top:8px;"><div class="cr-rec-label">Suggested puller' +
      ((typeof pfBadge === 'function') ? ' ' + pfBadge(r.primary.verified) : '') + '</div>' +
      '<div class="cr-rec-series">' + esc(r.primary.name) + '</div>' +
      '<div class="cr-rec-line">' + esc(psWhy(r.primary, r.designTons)) + '</div></div>';
  }
  /* A185, deliberately unlike bsSuggest (bolting-survey.js:339, which renders the picker only when a
     primary exists): puller refusals are common — blind-hole jobs and anything over the catalogue —
     and that is exactly when a rep who knows the answer needs to put a tool on the document. So the
     picker is always offered; with no suggestion it carries only the "Other" option and the PDF then
     reads "Specified by <name>" against a system that admitted it had none. */
  html += psToolPickerHtml(r);

  r.warnings.forEach(w => {
    html += '<p class="cr-rec-line" style="color:#92400e;background:#fffbeb;border:1px solid #fcd34d;' +
      'border-radius:8px;padding:8px 10px;margin-top:8px;">' + esc(w) + '</p>';
  });
  if (r.needsEngineer) {
    html += '<p class="cr-rec-line" style="margin-top:8px;font-weight:700;">' + esc(confirmMsg) + '</p>';
  }
  html += '<div class="cr-actions" style="justify-content:flex-start;margin-top:12px;">' +
    '<button type="button" class="cr-btn" onclick="psExportPdf()">📄 Export filled PDF</button></div>';
  if (typeof pfActionBtns === 'function' && r.primary) {
    html += pfActionBtns({ text: psSummaryText(a, r), inquiryId: psInquiryId,
      qty: psNum(a.quantity) || 1,
      product: { id: r.primary.id, name: r.primary.name, category: r.primary.category } });
  }
  box.innerHTML = html;
  if (typeof pfRenderLog === 'function') pfRenderLog();
}

/** The override control: the suggestion, its alternates, or the rep's own text. */
function psToolPickerHtml(r) {
  const esc = (typeof pfEsc === 'function') ? pfEsc : (s => String(s == null ? '' : s));
  const list = [r.primary].concat(r.alternates || []).filter(Boolean);
  const opts = list.map((p, i) =>
    '<option value="' + esc(p.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  const noneHint = list.length ? '' :
    '<p class="bs-hint">We could not suggest a puller for this job — if you know the right one, name it here ' +
    'and the PDF will record it as your specification.</p>';
  return '<div class="bs-pick"><label for="psTool">Puller on the document</label>' +
    '<select id="psTool" onchange="psToolChanged()">' + opts +
    '<option value="__other"' + (list.length ? '' : ' selected') + '>Other — I’ll specify</option></select>' +
    '<input type="text" id="psToolOther" placeholder="Type the puller you want on the document"' +
    (list.length ? ' style="display:none;"' : '') + '>' + noneHint +
    '<p class="bs-hint">The PDF records whether this was the system’s suggestion or your own choice, ' +
    'so whoever reads it can tell.</p></div>';
}

function psToolChanged() {
  const sel = document.getElementById('psTool'), other = document.getElementById('psToolOther');
  if (!sel || !other) return;
  other.style.display = sel.value === '__other' ? '' : 'none';
  if (sel.value === '__other') other.focus();
}

/** What actually goes on the document: {name, source:'system'|'user'} — or null when nothing was named. */
function psChosenTool() {
  const r = psResult && psResult.rec;
  const sel = document.getElementById('psTool');
  if (!sel || !r) return r && r.primary ? { name: r.primary.name, source: 'system' } : null;
  if (sel.value === '__other') {
    const t = psStr(psVal('psToolOther'));
    return t ? { name: t, source: 'user' } : (r.primary ? { name: r.primary.name, source: 'system' } : null);
  }
  const all = [r.primary].concat(r.alternates || []).filter(Boolean);
  const p = all.find(x => String(x.id) === String(sel.value));
  if (!p) return r.primary ? { name: r.primary.name, source: 'system' } : null;
  // Still one of ours, but not the one we put first — that is the rep's call, so say so.
  return { name: p.name, source: (r.primary && p.id === r.primary.id) ? 'system' : 'user' };
}

/** A one-paragraph summary for the logbook row and the Copy-details button. */
function psSummaryText(a, r) {
  const L = [];
  L.push('Puller selector' + (a.customer ? ' — ' + a.customer : ''));
  if (a.application) L.push('Application: ' + a.application);
  const job = [a.jobType, a.location, a.duty].filter(Boolean).join(' / ');
  if (job) L.push('Job: ' + job);
  const dims = [a.partOd ? 'OD ' + a.partOd : '', a.shaftDia ? 'shaft ' + a.shaftDia : '',
                a.reach ? 'reach ' + a.reach : '', a.contactLen ? 'hub width ' + a.contactLen : '']
                .filter(Boolean).join(', ');
  if (dims) L.push('Dimensions (' + (a.dimUnit || 'mm') + '): ' + dims);
  if (a.fitType) L.push('Fit: ' + a.fitType);
  if (r.forceSource !== 'none') {
    L.push('Design pulling force: ' + r.designTons.toFixed(1) + ' t (' + r.forceSource + ')');
  }
  if (r.geometry && r.geometry.spreadMm) {
    L.push('Needs: spread ≥ ' + r.geometry.spreadMm + ' mm, reach ≥ ' + r.geometry.reachMm +
           ' mm, ' + r.geometry.jaws + '-jaw');
  }
  if (r.primary) L.push('Suggested puller: ' + r.primary.name);
  r.warnings.concat(r.conditionFlags).forEach(w => L.push('! ' + w));
  return L.join('\n');
}

/** The blank hard copy — the same generator, so it can never drift from the filled output. */
function psPrintBlank() {
  window.open('/flow/puller-survey-pdf?blank=1', '_blank');
}

async function psExportPdf() {
  if (!psResult) { await psSuggest(); }
  if (!psResult) return;
  const a = psResult.answers, r = psResult.rec;
  const btn = document.activeElement;
  if (btn && btn.tagName === 'BUTTON') { btn.disabled = true; btn.textContent = 'Building…'; }
  try {
    const payload = {
      answers: a,
      recommendation: {
        designTons: r.designTons, estTons: r.estTons,
        forceSource: r.forceSource, forceAssumption: r.forceAssumption,
        geometry: r.geometry,
        warnings: r.warnings, conditionFlags: r.conditionFlags, needsEngineer: r.needsEngineer,
        tool: psChosenTool(),
        alternates: (r.alternates || []).map(p => p.name)
      },
      preparedBy: psSessionName()
    };
    const res = await fetch('/flow/puller-survey-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let msg = 'Could not build the PDF.';
      try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (e) { /* keep the default */ }
      alert(msg);
      return;
    }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
    if (typeof pfUpdateInquiry === 'function' && psInquiryId) {
      pfUpdateInquiry(psInquiryId, { surveyPdfAt: new Date().toISOString() });
    }
  } catch (e) {
    alert('Could not build the PDF: ' + (e.message || e));
  } finally {
    if (btn && btn.tagName === 'BUTTON') { btn.disabled = false; btn.textContent = '📄 Export filled PDF'; }
  }
}

function psSessionName() {
  try { const s = JSON.parse(localStorage.getItem('session') || '{}'); return (s && s.name) || ''; }
  catch (e) { return ''; }
}

function psReset() {
  PS_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = false;
    else if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
  psResult = null;
  psInquiryId = '';
  const box = document.getElementById('psResult');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  psSyncUnit();
}
