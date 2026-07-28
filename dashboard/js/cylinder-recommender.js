/* cylinder-recommender.js — Power Team Cylinder Selector (A164)
   Hi-ESCORP is an authorized Power Team / Hydraulic Technologies distributor. This turns the
   customer's Hydraulic Cylinder Selection Survey answers into a budgetary cylinder + pump
   recommendation, implementing the selection spec as DETERMINISTIC rules (no AI):
     STEP 2  capacity  = load ÷ points × 1.25 margin, rounded UP to a standard tonnage
     STEP 3  series    = priority decision tree (pull → aluminum → tight → lock → double-acting → general)
     STEP 4  stroke    = must cover the lift; pancakes cap at 1.75"; heights confirmed by engineer
     STEP 5  pump      = matched to power source / usage / environment / acting, + accessories
   The engine half (ptRecommend) is a pure function so it is unit-testable and reusable on other
   dashboards later; the page half wires the director-recommender.html form to it.
   Cylinder model numbers are NEVER invented — series only, "final model confirmed by Hi-ESCORP
   engineer". Pump models named are only the ones the spec itself lists. */

/* ─────────────────────────── The rules engine (pure — no DOM) ─────────────────────────── */

const PT_TONNAGES = [5, 10, 15, 25, 30, 55, 60, 75, 100, 150, 200, 250, 300, 400, 500, 600];
const PT_Z_MAX = 1650;
const PT_FINAL_WARNING = 'This is a budgetary recommendation. Final selection to be confirmed by Hi-ESCORP engineer.';
const PT_IN = 25.4;                       // 1 inch in mm
const PT_PANCAKE_MAX_STROKE_MM = 1.75 * PT_IN;   // PLC max stroke
const PT_RGL_STROKES_IN = [2, 4, 6, 8, 10, 12];  // RGL stroke options

function ptNum(v) { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; }

/** STEP 2 — required capacity per lifting point, with margin, rounded UP. */
function ptCapacity(loadTons, points) {
  const perPoint = loadTons / Math.max(1, points);
  const required = perPoint * 1.25;
  const std = PT_TONNAGES.find(t => t >= required - 1e-9);
  if (std) return { perPoint, required, tonnage: std, z: false, outOfRange: false };
  if (required <= PT_Z_MAX) return { perPoint, required, tonnage: Math.ceil(required), z: true, outOfRange: false };
  return { perPoint, required, tonnage: null, z: false, outOfRange: true };
}

function ptFmtStrokeIn(inches) {
  return inches + ' in / ' + Math.round(inches * PT_IN) + ' mm';
}

/** Smallest RGL stroke option covering the need; null when beyond 12". */
function ptRglStroke(strokeMm) {
  if (!(strokeMm > 0)) return null;
  const opt = PT_RGL_STROKES_IN.find(i => i * PT_IN >= strokeMm - 1e-9);
  return opt || null;
}

/**
 * The whole spec in one pure call.
 * answers: { jobTypes:[], loadTons, liftingPoints, strokeMm, gapMm, tightSpace, longHolding,
 *            returnType('load'|'powered'|'unsure'), environment:[], power('electric'|'air'|'none'),
 *            voltage, usage('occasional'|'daily'), quantity, targetDate, existingEquipment, notes,
 *            company, contact }
 */
function ptRecommend(a) {
  a = a || {};
  const jobs = (a.jobTypes || []).map(j => String(j).toLowerCase());
  const env = (a.environment || []).map(e => String(e).toLowerCase());
  const warnings = [];
  const missing = [];

  const loadTons = ptNum(a.loadTons);
  const points = ptNum(a.liftingPoints) || (loadTons ? 1 : 0);
  const strokeMm = ptNum(a.strokeMm);
  const gapMm = ptNum(a.gapMm);
  const tight = a.tightSpace === true;
  const holding = a.longHolding === true;
  const powered = a.returnType === 'powered';
  const explosive = env.includes('explosive');
  const carried = env.includes('carried');
  const airPower = a.power === 'air';
  const electric = a.power === 'electric';
  const noPower = a.power === 'none';
  const daily = a.usage === 'daily';
  const pulling = jobs.includes('pulling') || jobs.includes('tensioning');

  const extracted = {
    job_type: jobs.length ? jobs.join(', ') : 'not provided',
    load_weight_tons: loadTons || 'not provided',
    lifting_points: ptNum(a.liftingPoints) || 'not provided',
    stroke_needed_mm: strokeMm || 'not provided',
    gap_height_mm: gapMm || 'not provided',
    tight_space: a.tightSpace === true ? 'yes' : (a.tightSpace === false ? 'no' : 'not provided'),
    needs_long_holding: a.longHolding === true ? 'yes' : (a.longHolding === false ? 'no' : 'not provided'),
    return_type: a.returnType === 'powered' ? 'powered return needed'
      : (a.returnType === 'load' ? 'load-return ok' : (a.returnType === 'unsure' ? 'not sure' : 'not provided')),
    environment: env.length ? env.join(', ') : 'not provided',
    power_available: electric ? ('electric' + (a.voltage ? ' ' + a.voltage : ''))
      : (airPower ? 'compressed air' : (noPower ? 'none' : 'not provided')),
    usage_frequency: a.usage === 'daily' ? 'daily production' : (a.usage === 'occasional' ? 'occasional' : 'not provided'),
    quantity: a.quantity || 'not provided',
    target_date: a.targetDate || 'not provided',
    existing_equipment: a.existingEquipment || 'not provided',
    notes: a.notes || 'not provided'
  };

  /* Missing-info questions (spec: ask instead of guessing). */
  if (!jobs.length) missing.push('What will the cylinder do — lifting, pressing, pulling, holding, tensioning or spreading?');
  if (!loadTons) missing.push('How heavy is the load, in tons (or kg)?');
  if (!ptNum(a.liftingPoints)) missing.push('How many cylinders will share the load (lifting points)?');
  if (!strokeMm) missing.push('How far must the load move (stroke), in mm or inches?');
  if (!gapMm) missing.push('How tall is the gap where the cylinder will sit, in mm?');
  if (a.tightSpace === undefined || a.tightSpace === null) missing.push('Is the space very tight (flat cylinder needed)?');
  if (a.longHolding === undefined || a.longHolding === null) missing.push('Does the load need to stay up for hours or days (lock nut)?');
  if (!a.returnType) missing.push('Should the load push the piston back (normal) or is a powered return needed?');
  if (!a.power) missing.push('What power is available at the site — electricity (what voltage), compressed air, or none?');
  if (!a.usage) missing.push('Will it be used occasionally (maintenance) or daily (production)?');

  /* The two must-haves. Without them we don't guess (spec rule). */
  if (!loadTons || !jobs.length) {
    return {
      extracted_answers: extracted,
      required_capacity_tons: null,
      primary_recommendation: null,
      alternative_recommendation: null,
      pump_and_accessories: [],
      warnings: [(!loadTons ? 'The load weight is required before any cylinder can be sized. '
        : 'The job type is required before a series can be chosen. ') + PT_FINAL_WARNING],
      missing_info: missing,
      confidence: 'low'
    };
  }

  /* STEP 2 — capacity */
  const cap = ptCapacity(loadTons, points);
  if (cap.outOfRange) {
    return {
      extracted_answers: extracted,
      required_capacity_tons: Math.ceil(cap.required),
      primary_recommendation: null,
      alternative_recommendation: null,
      pump_and_accessories: [],
      warnings: ['The required capacity (about ' + Math.ceil(cap.required) + ' tons per point) is beyond the '
        + 'Power Team cylinder range (up to 1650 tons). Please contact Hi-ESCORP directly to engineer this job. '
        + PT_FINAL_WARNING],
      missing_info: missing,
      confidence: 'low'
    };
  }
  const T = cap.tonnage;
  const capNote = loadTons + ' tons on ' + Math.max(1, points) + ' point(s) = '
    + (Math.round(cap.perPoint * 100) / 100) + ' tons each; with a 25% safety margin that needs at least '
    + (Math.round(cap.required * 100) / 100) + ' tons, so we size up to ' + T + ' tons.';

  /* Stroke strings (never invent dimensions we don't have). */
  const strokeNeed = strokeMm ? ('to cover ' + strokeMm + ' mm (' + (Math.round(strokeMm / PT_IN * 100) / 100) + ' in) — options confirmed by Hi-ESCORP engineer') : 'to be confirmed with the customer';

  /* STEP 3 — series, in the spec's priority order, enforcing each series' tonnage range.
     When the preferred series can't cover the tonnage, we SAY so and fall through. */
  let primary = null, alternative = null;

  const mk = (series, stroke, why) => ({
    series, model_example: null, capacity_tons: T,
    stroke: stroke || strokeNeed,
    why: why + ' Final model to be confirmed by Hi-ESCORP engineer.'
  });

  // Rule 5's note, checked up front because it spans two rules:
  const dualAsk = holding && powered;
  if (dualAsk) {
    warnings.push('Power Team lock-nut cylinders are single-acting only — no model has BOTH a lock nut and '
      + 'powered (double-acting) return. Two options are offered: RGL (mechanical lock, single-acting) '
      + 'or RD (powered return, no lock).');
  }

  if (!primary && pulling) {                                    // 1. pulling / tensioning
    const saOk = !powered && T <= 100;
    const daOk = powered && T >= 30 && T <= 200;
    if (saOk || daOk) {
      primary = mk('RH (center-hole)', null,
        'Pulling or tensioning through a rod or cable needs a center-hole cylinder so the rod passes through the piston.');
      alternative = mk('RT', null, 'Center-hole alternative to the RH series for the same pulling work.');
    } else {
      warnings.push('A center-hole (RH) cylinder was indicated for pulling/tensioning, but ' + T + ' tons is outside '
        + 'the RH range (' + (powered ? '30–200T double-acting' : 'up to 100T single-acting') + ') — '
        + 'contact Hi-ESCORP to engineer the pulling setup; the recommendation below covers the pushing equivalent.');
    }
  }

  if (!primary && (explosive || carried)) {                     // 2. aluminum
    if (T >= 20 && T <= 100) {
      if (holding) {
        if (T <= 55) {
          primary = mk('RA_L (aluminum, lock nut)', null,
            'Aluminum for ' + (explosive ? 'a no-spark area' : 'easy carrying') + ', with a lock nut because the load stays up. RA_L comes in 55 and 100 tons; 55T covers this job.');
          primary.capacity_tons = 55;
        } else {
          primary = mk('RA_L (aluminum, lock nut)', null,
            'Aluminum for ' + (explosive ? 'a no-spark area' : 'easy carrying') + ', with a lock nut because the load stays up.');
          primary.capacity_tons = 100;
        }
      } else {
        primary = mk('RA (aluminum)', null,
          explosive ? 'Aluminum is non-sparking, required for an explosive/flammable area.'
                    : 'Aluminum is much lighter, right for a cylinder that is carried around often.');
      }
    } else {
      warnings.push('An aluminum (RA) cylinder was indicated for ' + (explosive ? 'the no-spark area' : 'frequent carrying')
        + ', but the RA series covers 20–100 tons and this job needs ' + T + ' tons — '
        + 'a steel cylinder is recommended below; discuss spark/weight precautions with Hi-ESCORP.');
    }
  }

  if (!primary && tight) {                                      // 3. very tight space
    const flatLift = strokeMm && strokeMm <= PT_PANCAKE_MAX_STROKE_MM;
    if (flatLift && T >= 67 && T <= 565) {
      primary = mk(holding ? 'RGP (pancake, locking collar)' : 'PLC (pancake)',
        'up to 1.75 in / 44 mm',
        'The gap is very tight and the lift is short, so a flat pancake cylinder fits where a normal one cannot.');
      alternative = mk('RLS (low profile)', null, 'Low-profile option if a little more height is available.');
    } else if (T <= 150) {
      primary = mk('RLS (low profile)', null,
        'The space is tight, so a low-profile cylinder keeps the collapsed height down.');
      alternative = mk('RA Shorty', null, 'Short-body alternative, available 10–250 tons.');
      if (strokeMm > PT_PANCAKE_MAX_STROKE_MM && flatLiftNeeded(gapMm, strokeMm)) {
        warnings.push('If the gap turns out too low even for a low-profile cylinder, the lift can be done in stages with cribbing.');
      }
    } else if (T <= 250) {
      primary = mk('RA Shorty', null,
        'The space is tight and the tonnage is above the RLS low-profile range, so the short-body RA Shorty (10–250T) is the fit.');
    } else {
      warnings.push('The space is tight but ' + T + ' tons is beyond the low-profile ranges (RLS to 150T, Shorty to 250T, '
        + 'pancake strokes max 1.75 in) — consider lifting in stages with cribbing; the standard series is recommended below.');
    }
  }

  if (!primary && holding) {                                    // 4. long holding → lock
    if (T <= 600) {
      const rglT = Math.max(T, 55);   // RGL starts at 55T; rounding up is always safe
      const opt = ptRglStroke(strokeMm);
      const p = mk('RGL (locking collar)', opt ? ptFmtStrokeIn(opt) : null,
        'The load stays up for a long time, so a mechanical lock nut carries it safely with no hydraulic pressure.');
      p.capacity_tons = rglT;
      if (rglT !== T) warnings.push('Lock-nut RGL cylinders start at 55 tons, so the ' + T + '-ton requirement rounds up to 55T — never undersized.');
      if (strokeMm && !opt) warnings.push('RGL strokes run 2–12 in (51–305 mm); the ' + strokeMm + ' mm lift needs staged lifting or a different arrangement — Hi-ESCORP engineer to confirm.');
      primary = p;
    } else {
      primary = mk('ZCL (locking collar, Z-series)', null,
        'The load stays up for a long time and the tonnage is in the Z-series range, so ZCL (550–1100T) provides the mechanical lock.');
      if (T > 1100) warnings.push('ZCL locking cylinders top out at 1100 tons — above that, holding must be engineered with Hi-ESCORP.');
    }
    if (dualAsk) alternative = mk('RD (double-acting)', null,
      'Powered-return option WITHOUT a lock nut, if fast retraction matters more than mechanical holding.');
  }

  if (!primary && powered) {                                    // 5. powered return
    if (T <= 500) primary = mk('RD (double-acting)', null,
      'A powered return pushes the piston back fast instead of waiting for the load — the RD series is the general-purpose double-acting line.');
    else if (T <= 600) primary = mk('RDG (double-acting, construction)', null,
      'Double-acting at this tonnage points to the construction-duty RDG series.');
    else primary = mk('ZDD (double-acting, Z-series)', null,
      'Double-acting in the Z-series range (550–1650T).');
    if (!alternative && T >= 100 && T <= 565) alternative = mk('R_D', null, 'Double-acting alternative covering 100–565 tons.');
  }

  if (!primary) {                                               // 6. general lifting / pressing
    if (T <= 100) {
      primary = mk('C series', null, 'Straightforward lifting or pressing at light-to-medium tonnage — the standard C-series single-acting cylinder.');
      if (T >= 55) alternative = mk('RGG (construction)', null, 'Heavier construction-duty option at the same tonnage.');
    } else if (T <= 600) {
      primary = mk('RGG (construction)', null, 'General heavy lifting at this tonnage is the RGG construction series.');
      alternative = mk('R_C', null, 'Budget alternative to the RGG at the same tonnage.');
    } else {
      primary = mk('ZCC (Z-series)', null, 'General lifting in the Z-series range (550–1650T).');
    }
  }

  if (cap.z && primary) {
    primary.why += ' Z-series frames cover 550–1650 tons; the exact frame is picked by the engineer.';
  }

  /* STEP 4 — gap honesty: we have no retracted-height tables, so we never claim a fit. */
  if (gapMm) {
    warnings.push('Available gap is ' + gapMm + ' mm — the chosen cylinder\'s retracted height must be confirmed '
      + 'against it by the Hi-ESCORP engineer (switching to a low-profile/pancake model or staged lifting if it does not fit).');
  }

  /* STEP 5 — the matching pump + accessories */
  const isDA = powered || (primary && /double-acting/i.test(primary.series));
  const multi = points > 1;
  const pump = [];
  if (explosive || airPower) {
    pump.push((multi ? 'PA60 air hydraulic pump — one air pump can drive the multiple cylinders'
      : (isDA ? 'PA6D air hydraulic pump — air-driven, with the valve a double-acting cylinder needs'
              : 'PA6 or PA9 air hydraulic pump — air-driven, no electric sparks'))
      + (explosive ? ' (air power is the safe choice in a no-spark area)' : ''));
  } else if (electric) {
    if (daily) pump.push('PE21 or PQ60 electric pump — built for daily production use'
      + (T >= 150 || multi ? '; step up to PE400 for high tonnage or several cylinders' : '')
      + (a.voltage ? ' (site voltage: ' + a.voltage + ')' : ''));
    else pump.push('PE46 or PE55 portable electric pump — easy to move around the site'
      + (a.voltage ? ' (site voltage: ' + a.voltage + ')' : ''));
  } else if (noPower) {
    if (daily) pump.push('PB10 or PB43 battery pump — no site power, but daily use needs more speed than a hand pump');
    else pump.push('P157, P300 or P460 two-speed hand pump — no power needed for occasional jobs'
      + (isDA ? ' (use the "D" version, e.g. P460D, for the double-acting cylinder)' : ''));
  } else {
    pump.push('Pump to be chosen once the site power is known — hand pump (no power), PA air pump, or PE electric pump.');
  }
  if (isDA) pump.push('4-way directional valve + TWO hoses — a double-acting cylinder always needs both');
  if (multi) pump.push('Manifold for ' + points + ' lifting points + pressure gauge — one pump feeds all cylinders evenly');
  pump.push('Hydraulic hose' + (isDA ? 's' : '') + ', pressure gauge and coupler — included in every set');
  pump.push('Swivel cap — suggested in case the load bears unevenly on the saddle');

  warnings.push(PT_FINAL_WARNING);

  /* Confidence: 'low' is handled above (missing must-haves); anything else missing → 'medium'. */
  const confidence = missing.length === 0 ? 'high' : 'medium';

  return {
    extracted_answers: extracted,
    required_capacity_tons: Math.round(cap.required * 100) / 100,
    capacity_note: capNote,
    primary_recommendation: primary,
    alternative_recommendation: alternative,
    pump_and_accessories: pump,
    warnings,
    missing_info: missing,
    confidence
  };
}

/* Would a flat cylinder genuinely be forced by the gap? (helper for a nicer warning only) */
function flatLiftNeeded(gapMm, strokeMm) { return gapMm > 0 && gapMm < 180 && strokeMm > 0; }

/* ─────────────────────────── Page wiring (director-recommender.html) ─────────────────────────── */

let crSession = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('crForm')) return;   // engine-only contexts (tests) load this file too
  crSession = requireDirector();
  if (!crSession) return;
  renderNavbar('director-recommender');
});

function crChecked(name) {
  return Array.from(document.querySelectorAll('input[name="' + name + '"]:checked')).map(el => el.value);
}
function crVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function crRadio(name) {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : '';
}

/** Read the survey form into the engine's answers object (the "reading right" half). */
function crCollect() {
  const loadRaw = ptNum(crVal('crLoad'));
  const loadTons = crVal('crLoadUnit') === 'kg' ? loadRaw / 1000 : loadRaw;
  const strokeRaw = ptNum(crVal('crStroke'));
  const strokeMm = crVal('crStrokeUnit') === 'in' ? strokeRaw * PT_IN : strokeRaw;
  const tight = crRadio('crTight');
  const hold = crRadio('crHold');
  return {
    company: crVal('crCompany'), contact: crVal('crContact'),
    jobTypes: crChecked('crJob'),
    loadTons: loadTons || 0,
    liftingPoints: ptNum(crVal('crPoints')),
    strokeMm: strokeMm || 0,
    gapMm: ptNum(crVal('crGap')),
    tightSpace: tight === 'yes' ? true : (tight === 'no' ? false : undefined),
    longHolding: hold === 'yes' ? true : (hold === 'no' ? false : undefined),
    returnType: crRadio('crReturn') || '',
    environment: crChecked('crEnv'),
    power: crRadio('crPower') || '',
    voltage: crVal('crVoltage'),
    usage: crRadio('crUsage') || '',
    quantity: crVal('crQty'), targetDate: crVal('crDate'),
    existingEquipment: crVal('crExisting'), notes: crVal('crNotes')
  };
}

const crEsc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function crRecommend() {
  const a = crCollect();
  const r = ptRecommend(a);
  const box = document.getElementById('crResult');
  if (!box) return;
  box.style.display = '';

  const confColor = r.confidence === 'high' ? '#16a34a' : (r.confidence === 'medium' ? '#d97706' : '#dc2626');
  const recCard = (rec, label) => !rec ? '' : `
    <div class="cr-rec">
      <div class="cr-rec-label">${label}</div>
      <div class="cr-rec-series">${crEsc(rec.series)} · ${crEsc(rec.capacity_tons)} tons</div>
      <div class="cr-rec-line"><b>Stroke:</b> ${crEsc(rec.stroke)}</div>
      <div class="cr-rec-line">${crEsc(rec.why)}</div>
    </div>`;

  box.innerHTML = `
    <div class="cr-result-head">
      <h2>Recommendation${a.company ? ' — ' + crEsc(a.company) : ''}</h2>
      <span class="cr-conf" style="background:${confColor}1a;color:${confColor};border:1px solid ${confColor}55;">
        confidence: ${r.confidence}</span>
      <button class="cr-btn cr-btn-sec no-print" onclick="window.print()">🖨 Print</button>
    </div>
    ${r.required_capacity_tons ? `<p class="cr-capnote"><b>Required capacity: ${crEsc(r.required_capacity_tons)} tons per point.</b> ${crEsc(r.capacity_note || '')}</p>` : ''}
    ${recCard(r.primary_recommendation, 'Recommended cylinder')}
    ${recCard(r.alternative_recommendation, 'Alternative')}
    ${r.pump_and_accessories.length ? `
      <div class="cr-sect"><h3>Matching pump &amp; accessories</h3>
        <ul>${r.pump_and_accessories.map(p => '<li>' + crEsc(p) + '</li>').join('')}</ul></div>` : ''}
    ${r.warnings.length ? `
      <div class="cr-sect cr-warn"><h3>Please note</h3>
        <ul>${r.warnings.map(w => '<li>' + crEsc(w) + '</li>').join('')}</ul></div>` : ''}
    ${r.missing_info.length ? `
      <div class="cr-sect cr-miss"><h3>Ask the customer</h3>
        <ul>${r.missing_info.map(m => '<li>' + crEsc(m) + '</li>').join('')}</ul></div>` : ''}
  `;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function crReset() {
  const f = document.getElementById('crForm');
  if (f) f.reset();
  const box = document.getElementById('crResult');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}
