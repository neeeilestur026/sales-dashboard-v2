/* bolting-survey.js — A177 Bolting Application Survey.
 *
 * The paper survey the reps carry, brought into the Product Finder: print it blank for a hard copy,
 * fill it on screen, get a specific tool suggested from the answers, override that suggestion, and
 * export a PDF carrying whichever was chosen.
 *
 * Split the same way A164 split the Cylinder Selector: `bsRecommend` is a PURE function over the
 * answers + the loaded JSON data, so the decision table is testable without a DOM; the `bs*` page
 * wiring below reads the form and renders. Torque is safety-critical, so the rule the whole Product
 * Finder is built on holds here too — a figure comes from verified data or it does not come at all:
 *
 *   · Inch bolts are recordable but produce NO number. Our chart is verified metric coarse only, and
 *     A167 removed the imperial options from the old form precisely because nothing backed them.
 *   · Load / Stretch / Turn-of-Nut / % of Yield are recorded verbatim and NEVER converted to torque —
 *     that needs the bolt's proof load and a friction factor, neither of which we hold.
 *   · The chart is "lightly oiled threads at 85% proof load". A stated coating, dry/PTFE lubricant or
 *     an extreme temperature changes the friction and therefore the torque, so the figure still prints
 *     but the mismatch is named on the face of the document.
 */

/* Nm per unit of the survey's three torque units. Kgm is on the paper form and pfExtractAttrs
   cannot read it, so it is converted here. */
const BS_TORQUE_TO_NM = { nm: 1, ftlb: 1.35582, kgm: 9.80665 };

/* The chart's stated basis is "lightly oiled threads at 85% proof load", so a lubricant in that family
   is no mismatch — and neither is a coating field that just says the bolt is bare. Only something that
   actually changes the friction should raise a caveat, or the warning becomes noise nobody reads. */
const BS_OILED = /\b(oil|oiled|lightly oiled|light oil|moly|molybdenum|grease|greased|lubricated)\b/i;
const BS_PLAIN = /^(plain|bare|none|no|uncoated|n\/a|na|as[- ]received|standard)\b/i;
const BS_TEMP_OK_C = { lo: -20, hi: 150 };
/* A203: hydraulic-hollow leads. It is the flange and stud tool, and it is the only family we hold a
   pump-pressure chart for — so it is the only one that can answer "what do I set the pump to".
   This is a TIE-BREAKER only: it fires when two tools sit within 0.05 of mid-range. The Match
   Finder ranks the same way, so the two tools cannot contradict each other. */
const BS_SUBTYPE_RANK = { 'hydraulic-hollow': 0, pneumatic: 1, battery: 2, 'hydraulic-square-drive': 3 };

function bsNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function bsStr(v) { return String(v == null ? '' : v).trim(); }

/** A stated torque in any of the form's units → Nm (0 when nothing usable was given). */
function bsStatedNm(value, unit) {
  const n = bsNum(value);
  if (!(n > 0)) return 0;
  const f = BS_TORQUE_TO_NM[String(unit || 'nm').toLowerCase()];
  return f ? n * f : 0;
}

/** Operating temperature in °C, whichever unit it was entered in (null when blank). */
function bsTempC(value, unit) {
  const s = bsStr(value);
  if (!s) return null;
  const n = bsNum(s);
  return String(unit).toUpperCase() === 'F' ? (n - 32) * 5 / 9 : n;
}

/** Every torque-wrench whose range actually BRACKETS the target, tightest fit first.
 *  Both bounds matter: A170's filter checks torque_max_nm only, so a wrench whose range starts
 *  ABOVE the ask still passes there — which is why torque_chart.json has to hand-code
 *  `wrench_id: null` on its four sub-270 Nm rows. Checking min as well derives that instead. */
function bsCandidates(targetNm, products, limitedClearance) {
  const wrenches = (products || []).filter(p => p.category === 'torque-wrench' && p.verified);
  const covers = wrenches.filter(p =>
    typeof p.torque_min_nm === 'number' && typeof p.torque_max_nm === 'number' &&
    p.torque_min_nm <= targetNm && targetNm <= p.torque_max_nm);
  /* Rank by where the target SITS in each range, not by how tight the range is. Tightest-range first
     looked reasonable and was wrong: for M24/12.9 (1,395 Nm) it picked the B-RAD Select 1400, a tool
     rated to 1,400 Nm — 99.6% of its ceiling, with no margin at all. A torque tool is used in roughly
     the middle of its span (both ends are where accuracy and headroom are worst), which is also the
     answer torque_chart.json curates by hand. */
  const pos = p => (targetNm - p.torque_min_nm) / Math.max(1, p.torque_max_nm - p.torque_min_nm);
  const inBand = p => pos(p) >= 0.2 && pos(p) <= 0.8;
  return covers.slice().sort((a, b) => {
    // A hollow-drive wrench is the one that fits where there is no room to swing — prefer it when
    // the survey says the access is tight, but never invent a clearance dimension to justify it.
    // This outranks even the fit guard: a tool that cannot physically go on the bolt is no answer.
    if (limitedClearance) {
      const ah = a.subtype === 'hydraulic-hollow' ? 0 : 1, bh = b.subtype === 'hydraulic-hollow' ? 0 : 1;
      if (ah !== bh) return ah - bh;
    }
    /* A203: the fit guard first, then the house family preference, then closeness to mid-range —
       the identical three keys pfRankWrenches uses in product-finder.js, so the Survey and the Match
       Finder cannot name different tools for the same bolt. They disagreed on 29% of bolts while the
       family preference sat above the fit guard; with this order they agree on all of them.
       Tightest-range-first, the original rule here, was wrong for the reason above. */
    const ab = inBand(a) ? 0 : 1, bb = inBand(b) ? 0 : 1;
    if (ab !== bb) return ab - bb;
    const rank = p => (BS_SUBTYPE_RANK[p.subtype] === undefined ? 9 : BS_SUBTYPE_RANK[p.subtype]);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return Math.abs(pos(a) - 0.5) - Math.abs(pos(b) - 0.5);
  });
}

/** The catalogue's overall torque-wrench window, for an honest "we don't cover that" message. */
function bsCatalogueRange(products) {
  const r = (products || []).filter(p => p.category === 'torque-wrench' &&
    typeof p.torque_min_nm === 'number' && typeof p.torque_max_nm === 'number');
  if (!r.length) return null;
  return { lo: Math.min.apply(null, r.map(p => p.torque_min_nm)),
           hi: Math.max.apply(null, r.map(p => p.torque_max_nm)) };
}

/**
 * The engine. Pure: answers + { products, torque } in, a decision out.
 * @returns {{targetNm:number, torqueSource:'stated'|'chart'|'none', chartRow:Object|null,
 *            primary:Object|null, alternates:Array, warnings:string[], missing:string[],
 *            conditionFlags:string[], needsEngineer:boolean}}
 */
function bsRecommend(answers, data) {
  const a = answers || {};
  const d = data || {};
  const products = d.products || [];
  const rows = d.torque || [];
  const out = { targetNm: 0, torqueSource: 'none', chartRow: null, primary: null, alternates: [],
                warnings: [], missing: [], conditionFlags: [], needsEngineer: false };

  const unit = String(a.unit || 'metric').toLowerCase();
  const bolt = bsStr(a.boltSize);
  const grade = bsStr(a.grade);

  // ── 1. where the torque figure comes from ────────────────────────────────
  const stated = bsStatedNm(a.torqueValue, a.torqueUnit);
  if (stated > 0) {
    // The customer's own figure outranks our chart — it is their equipment spec.
    out.targetNm = stated;
    out.torqueSource = 'stated';
  } else if (unit === 'metric' && bolt && grade) {
    const row = bsTorqueRow(bolt, grade, rows);
    if (row) {
      out.chartRow = row;
      out.targetNm = bsNum(row.torque_max_nm) || bsNum(row.torque_min_nm);
      out.torqueSource = 'chart';
      if (row.verified !== true) {
        out.needsEngineer = true;
        out.warnings.push('Our chart holds only sample figures for ' + row.bolt + ' grade ' + row.grade +
          ' — unconfirmed, so the engineer must set the final torque.');
      }
    } else {
      out.needsEngineer = true;
      out.warnings.push('No verified torque row for ' + bolt + ' grade ' + grade +
        ' in our chart. Recorded for the engineer.');
    }
  } else if (unit === 'inch') {
    // Deliberate: we hold no published imperial torque data, and deriving SAE/ASTM figures would be
    // a guess on a safety-critical number. The job is still recorded in full.
    out.needsEngineer = true;
    out.warnings.push('Inch bolts: we hold no verified imperial torque data, so no figure is given here. ' +
      'The survey is recorded in full and the engineer will specify the torque.');
  } else {
    out.missing.push(bolt ? 'Bolt grade' : 'Bolt diameter');
    if (!grade) out.missing.push('Bolt grade');
    out.missing.push('or a known torque figure');
  }

  // ── 2. preload specs we must not convert ─────────────────────────────────
  const others = [];
  if (bsNum(a.loadValue) > 0) others.push('Load (' + bsStr(a.loadValue) + ' ' + bsStr(a.loadUnit) + ')');
  if (bsStr(a.stretch)) others.push('Stretch-bolt length (' + bsStr(a.stretch) + ')');
  if (bsStr(a.turnOfNut)) others.push('Turn of nut (' + bsStr(a.turnOfNut) + ')');
  if (bsNum(a.pctYield) > 0) others.push('% of yield (' + bsStr(a.pctYield) + ')');
  if (others.length && out.torqueSource === 'none') {
    out.needsEngineer = true;
    out.warnings.push('You specified ' + others.join(', ') + ' but no torque. Converting a preload spec ' +
      'to a torque needs the bolt’s proof load and its friction factor, which we do not hold — ' +
      'those values are recorded as given for the engineer.');
  }

  // ── 3. the chart's basis vs what was actually stated ─────────────────────
  if (out.torqueSource === 'chart') {
    const coating = bsStr(a.coating), lube = bsStr(a.lubeType);
    if (coating && !BS_PLAIN.test(coating) && !BS_OILED.test(coating)) {
      out.conditionFlags.push('Bolt coating stated as "' + coating + '". Our chart assumes lightly oiled ' +
        'threads at 85% proof load — a coating changes the friction, so the required torque will differ.');
    }
    if (lube && !BS_OILED.test(lube)) {
      out.conditionFlags.push('Lubrication stated as "' + lube + '", not the lightly oiled threads our ' +
        'chart figure is based on. The required torque will differ.');
    }
    const t = bsTempC(a.tempValue, a.tempUnit);
    if (t !== null && (t < BS_TEMP_OK_C.lo || t > BS_TEMP_OK_C.hi)) {
      out.conditionFlags.push('Operating temperature ' + bsStr(a.tempValue) + '°' + bsStr(a.tempUnit) +
        ' is outside the ordinary range our reference figure assumes — relaxation and friction both shift.');
    }
    if (out.conditionFlags.length) out.needsEngineer = true;
  }

  // ── 4. the tool ──────────────────────────────────────────────────────────
  if (out.targetNm > 0) {
    const cands = bsCandidates(out.targetNm, products, !!a.limitedClearance);
    if (cands.length) {
      out.primary = cands[0];
      out.alternates = cands.slice(1);
      if (a.limitedClearance && out.primary.subtype === 'hydraulic-hollow') {
        out.warnings.push('Limited clearance / limited radius was ticked, so a hollow-drive wrench is ' +
          'suggested — confirm it against dimensions A–D and the distance to closure.');
      } else if (a.limitedClearance) {
        out.warnings.push('Limited clearance / limited radius was ticked but no hollow-drive wrench covers ' +
          Math.round(out.targetNm) + ' Nm. Check the access dimensions with the engineer.');
      }
    } else {
      out.needsEngineer = true;
      const r = bsCatalogueRange(products);
      out.warnings.push('No wrench in our catalogue covers ' + Math.round(out.targetNm) + ' Nm' +
        (r ? ' (our torque wrenches run ' + r.lo + '–' + r.hi.toLocaleString('en-US') + ' Nm)' : '') +
        '. The engineer will advise on the right tool.');
    }
  }
  return out;
}

/** Chart row lookup. Uses the Product Finder's own helper when it is loaded, else a local equal. */
function bsTorqueRow(bolt, grade, rows) {
  if (typeof pfTorqueLookup === 'function') return pfTorqueLookup(bolt, grade, rows);
  const n = s => String(s == null ? '' : s).toLowerCase().trim();
  return (rows || []).find(x => n(x.bolt) === n(bolt) && n(x.grade) === n(grade)) || null;
}

/* ─────────────────────────── page wiring ─────────────────────────── */

let bsResult = null;        // the last bsRecommend output, for the tool picker + the PDF
let bsInquiryId = '';       // the logbook row this survey created

const BS_FIELDS = ['bsRequestBy', 'bsRequestDate', 'bsIndustry', 'bsCustomer', 'bsApplication',
  'bsContact', 'bsVisitDate', 'bsPhone', 'bsInstallDate', 'bsEmail',
  'bsUnit', 'bsQuantity', 'bsBoltSize', 'bsBoltSizeInch', 'bsTpi', 'bsGrade', 'bsCoating',
  'bsGasket', 'bsTempValue', 'bsTempUnit', 'bsPosition', 'bsLimitedClearance',
  'bsLoadValue', 'bsLoadUnit', 'bsStretch', 'bsTurnOfNut', 'bsTorqueValue', 'bsTorqueUnit',
  'bsPctYield', 'bsDimA', 'bsDimB', 'bsDimC', 'bsDimD', 'bsDistClosure',
  'bsLubeType', 'bsLubeBrand', 'bsOpportunity', 'bsNotes'];

function bsVal(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  return el.value || '';
}

/** Read the whole form into one answers object (the crCollect pattern from A164). */
function bsCollect() {
  const unit = bsVal('bsUnit') || 'metric';
  return {
    requestBy: bsVal('bsRequestBy'), requestDate: bsVal('bsRequestDate'),
    industry: bsVal('bsIndustry'), customer: bsVal('bsCustomer'),
    application: bsVal('bsApplication'), contact: bsVal('bsContact'),
    visitDate: bsVal('bsVisitDate'), phone: bsVal('bsPhone'),
    installDate: bsVal('bsInstallDate'), email: bsVal('bsEmail'),
    unit,
    quantity: bsVal('bsQuantity'),
    // one field on the paper form, two controls on screen: a verified metric list vs free-typed inch
    boltSize: unit === 'inch' ? bsVal('bsBoltSizeInch') : bsVal('bsBoltSize'),
    tpi: bsVal('bsTpi'), grade: bsVal('bsGrade'), coating: bsVal('bsCoating'),
    gasket: bsVal('bsGasket'), tempValue: bsVal('bsTempValue'), tempUnit: bsVal('bsTempUnit') || 'C',
    position: bsVal('bsPosition'), limitedClearance: !!bsVal('bsLimitedClearance'),
    loadValue: bsVal('bsLoadValue'), loadUnit: bsVal('bsLoadUnit') || 'lbs',
    stretch: bsVal('bsStretch'), turnOfNut: bsVal('bsTurnOfNut'),
    torqueValue: bsVal('bsTorqueValue'), torqueUnit: bsVal('bsTorqueUnit') || 'nm',
    pctYield: bsVal('bsPctYield'),
    dimA: bsVal('bsDimA'), dimB: bsVal('bsDimB'), dimC: bsVal('bsDimC'), dimD: bsVal('bsDimD'),
    distClosure: bsVal('bsDistClosure'),
    lubeType: bsVal('bsLubeType'), lubeBrand: bsVal('bsLubeBrand'),
    opportunity: bsVal('bsOpportunity'), notes: bsVal('bsNotes')
  };
}

/** INCH/METRIC toggle: swap which bolt-size control is live. */
function bsSyncUnit() {
  const inch = (bsVal('bsUnit') || 'metric') === 'inch';
  const m = document.getElementById('bsMetricSize'), i = document.getElementById('bsInchSize');
  if (m) m.style.display = inch ? 'none' : '';
  if (i) i.style.display = inch ? '' : 'none';
  const note = document.getElementById('bsInchNote');
  if (note) note.style.display = inch ? '' : 'none';
}

/** One-line reason the suggested wrench fits, from the actual numbers. */
function bsWhy(p, targetNm) {
  const bits = ['rated ' + p.torque_min_nm.toLocaleString('en-US') + '–' +
    p.torque_max_nm.toLocaleString('en-US') + ' Nm — covers your ' + Math.round(targetNm) + ' Nm'];
  if (p.subtype === 'hydraulic-hollow') bits.push('hollow drive for tight access');
  else if (p.subtype === 'battery') bits.push('cordless');
  else if (p.subtype === 'pneumatic') bits.push('pneumatic, continuous rotation');
  return bits.join(' · ');
}

/** Suggest a tool from the answers, render the card, and log the survey to the inquiry logbook. */
async function bsSuggest() {
  const box = document.getElementById('bsResult');
  if (!box) return;
  if (typeof pfEnsureData === 'function' &&
      !(await pfEnsureData(box, ['torque_chart.json', 'products.json']))) return;

  const a = bsCollect();
  const data = (typeof pfData !== 'undefined' && pfData) ? pfData : { products: [], torque: [] };
  const r = bsRecommend(a, data);
  bsResult = { answers: a, rec: r };
  box.style.display = '';

  const esc = (typeof pfEsc === 'function') ? pfEsc : (s => String(s == null ? '' : s));
  const confirmMsg = (typeof PF_CONFIRM_MSG === 'string')
    ? PF_CONFIRM_MSG : 'Needs engineer confirmation — Hi-ESCORP will contact you.';

  // Log it like every other Product Finder path, so the survey is tracked and can spawn a PR.
  if (typeof pfAddInquiry === 'function') {
    const inq = pfAddInquiry({
      source: 'Bolting Survey', client: a.customer, industry: a.industry,
      rawText: bsSummaryText(a, r),
      recommendation: r.primary ? r.primary.name : confirmMsg
    });
    bsInquiryId = inq && inq.id ? inq.id : '';
  }
  if (typeof pfLogMiss === 'function' && r.needsEngineer && r.torqueSource !== 'stated') {
    pfLogMiss('bolting survey: ' + (a.unit === 'inch' ? 'inch ' : '') +
      (a.boltSize || '?') + ' grade ' + (a.grade || '?'));
  }

  let html = '';
  if (r.missing.length) {
    html += '<div class="cr-warn cr-sect"><h3>A little more is needed</h3><p class="cr-rec-line">' +
      'To suggest a tool we need: <b>' + esc(r.missing.join(', ')) + '</b>. ' +
      'Everything else you have entered is kept and will print on the PDF.</p></div>';
  }
  if (r.targetNm > 0) {
    const ftlb = Math.round(r.targetNm / BS_TORQUE_TO_NM.ftlb);
    const src = r.torqueSource === 'stated'
      ? 'from the torque you specified'
      : 'from our reference chart for ' + esc(r.chartRow.bolt) + ' '
        + esc(typeof pfGradeLabel === 'function' ? pfGradeLabel(r.chartRow.grade)
                                                 : 'grade ' + r.chartRow.grade);
    html += '<div class="cr-rec"><div class="cr-rec-label">Target torque</div>' +
      '<div class="cr-rec-series">' + Math.round(r.targetNm).toLocaleString('en-US') +
      ' Nm (≈ ' + ftlb.toLocaleString('en-US') + ' ft·lb)</div>' +
      '<div class="cr-rec-line">' + src + '.</div></div>';
  }
  r.conditionFlags.forEach(f => {
    html += '<div class="cr-warn cr-sect" style="margin-top:8px;"><h3>Check this before tightening</h3>' +
      '<p class="cr-rec-line">' + esc(f) + '</p></div>';
  });
  if (r.primary) {
    html += '<div class="cr-rec" style="margin-top:8px;"><div class="cr-rec-label">Suggested tool ' +
      ((typeof pfBadge === 'function') ? pfBadge(r.primary.verified) : '') + '</div>' +
      '<div class="cr-rec-series">' + esc(r.primary.name) + '</div>' +
      '<div class="cr-rec-line">' + esc(bsWhy(r.primary, r.targetNm)) + '</div></div>';
    html += bsToolPickerHtml(r);
  }
  r.warnings.forEach(w => {
    html += '<p class="cr-rec-line" style="color:#92400e;background:#fffbeb;border:1px solid #fcd34d;' +
      'border-radius:8px;padding:8px 10px;margin-top:8px;">' + esc(w) + '</p>';
  });
  if (r.needsEngineer) {
    html += '<p class="cr-rec-line" style="margin-top:8px;font-weight:700;">' + esc(confirmMsg) + '</p>';
  }
  html += '<div class="cr-actions" style="justify-content:flex-start;margin-top:12px;">' +
    '<button type="button" class="cr-btn" onclick="bsExportPdf()">📄 Export filled PDF</button>' +
    '</div>';
  if (typeof pfActionBtns === 'function' && r.primary) {
    html += pfActionBtns({ text: bsSummaryText(a, r), inquiryId: bsInquiryId,
      qty: bsNum(a.quantity) || 1,
      product: { id: r.primary.id, name: r.primary.name, category: r.primary.category } });
  }
  box.innerHTML = html;
  if (typeof pfRenderLog === 'function') pfRenderLog();
}

/** The override control: the suggestion, its alternates, or the rep's own text. */
function bsToolPickerHtml(r) {
  const esc = (typeof pfEsc === 'function') ? pfEsc : (s => String(s == null ? '' : s));
  const opts = [r.primary].concat(r.alternates).map((p, i) =>
    '<option value="' + esc(p.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  return '<div class="bs-pick"><label for="bsTool">Tool on the document</label>' +
    '<select id="bsTool" onchange="bsToolChanged()">' + opts +
    '<option value="__other">Other — I’ll specify</option></select>' +
    '<input type="text" id="bsToolOther" placeholder="Type the tool you want on the document" style="display:none;">' +
    '<p class="bs-hint">The PDF records whether this was the system’s suggestion or your own choice, ' +
    'so whoever reads it can tell.</p></div>';
}

function bsToolChanged() {
  const sel = document.getElementById('bsTool'), other = document.getElementById('bsToolOther');
  if (!sel || !other) return;
  other.style.display = sel.value === '__other' ? '' : 'none';
  if (sel.value === '__other') other.focus();
}

/** What actually goes on the document: {name, source:'system'|'user'}. */
function bsChosenTool() {
  const r = bsResult && bsResult.rec;
  const sel = document.getElementById('bsTool');
  if (!sel || !r) return r && r.primary ? { name: r.primary.name, source: 'system' } : null;
  if (sel.value === '__other') {
    const t = bsStr(bsVal('bsToolOther'));
    return t ? { name: t, source: 'user' } : (r.primary ? { name: r.primary.name, source: 'system' } : null);
  }
  const all = [r.primary].concat(r.alternates).filter(Boolean);
  const p = all.find(x => String(x.id) === String(sel.value));
  if (!p) return r.primary ? { name: r.primary.name, source: 'system' } : null;
  // Still one of ours, but not the one we put first — that is the rep's call, so say so.
  return { name: p.name, source: (r.primary && p.id === r.primary.id) ? 'system' : 'user' };
}

/** A one-paragraph summary for the logbook row and the Copy-details button. */
function bsSummaryText(a, r) {
  const L = [];
  L.push('Bolting survey' + (a.customer ? ' — ' + a.customer : ''));
  if (a.application) L.push('Application: ' + a.application);
  const b = [a.unit === 'inch' ? 'inch' : 'metric', a.boltSize, a.tpi ? 'TPI ' + a.tpi : '',
             a.grade ? 'grade ' + a.grade : ''].filter(Boolean).join(' ');
  if (b) L.push('Bolt: ' + b);
  if (a.quantity) L.push('Quantity: ' + a.quantity);
  if (r.targetNm > 0) L.push('Target torque: ' + Math.round(r.targetNm) + ' Nm (' + r.torqueSource + ')');
  if (a.limitedClearance) L.push('Limited clearance / limited radius');
  if (r.primary) L.push('Suggested tool: ' + r.primary.name);
  r.warnings.concat(r.conditionFlags).forEach(w => L.push('! ' + w));
  return L.join('\n');
}

/** The blank hard copy — the same generator, so it can never drift from the filled output. */
function bsPrintBlank() {
  window.open('/flow/bolting-survey-pdf?blank=1', '_blank');
}

/** Render + open the filled survey. Suggest first if the rep hasn't yet, so the PDF is never empty. */
async function bsExportPdf() {
  if (!bsResult) { await bsSuggest(); }
  const a = bsResult ? bsResult.answers : bsCollect();
  const r = bsResult ? bsResult.rec : bsRecommend(a, { products: [], torque: [] });
  const btns = document.querySelectorAll('#bsResult .cr-btn');
  const payload = {
    answers: a,
    recommendation: {
      targetNm: r.targetNm, torqueSource: r.torqueSource,
      chartNote: r.chartRow ? (r.chartRow.note || '') : '',
      warnings: r.warnings, conditionFlags: r.conditionFlags, needsEngineer: r.needsEngineer,
      tool: bsChosenTool(),
      alternates: (r.alternates || []).map(p => p.name)
    },
    preparedBy: bsSessionName()
  };
  try {
    const res = await fetch('/flow/bolting-survey-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (e) {}
      throw new Error(msg);
    }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank');
    if (bsInquiryId && typeof pfUpdateInquiry === 'function') {
      pfUpdateInquiry(bsInquiryId, { surveyPdfAt: new Date().toISOString() });
    }
  } catch (e) {
    const box = document.getElementById('bsResult');
    if (box) {
      const p = document.createElement('p');
      p.className = 'cr-rec-line';
      p.style.color = '#b91c1c';
      p.textContent = 'The PDF could not be generated — ' + (e.message || 'unknown error');
      box.appendChild(p);
    }
  }
  if (btns.length) { /* nothing to restore — the buttons were never disabled */ }
}

function bsSessionName() {
  try { return (JSON.parse(localStorage.getItem('session') || '{}').name) || ''; } catch (e) { return ''; }
}

/** Clear the form back to empty. */
function bsReset() {
  BS_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = false;
    else if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
  bsResult = null; bsInquiryId = '';
  const box = document.getElementById('bsResult');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  bsSyncUnit();
}
