/* A333 — the Product Finder engine against the real Power Team data.
 *
 * What this file exists to hold down:
 *   • the five lines Neil sent come back as C108C, C154C, C156C, C254C and P159, each from the official
 *     2025 crossover, with the notes that explain the reading ("max height" is the stroke; "TO" is the
 *     nominal class) and the P-80's first-stage difference shown, not hidden;
 *   • a metric request is never under-sized (15 tonne -> a 25-ton cylinder; 100 kN -> 15-ton);
 *   • single-acting never returns a double-acting cylinder; specialty series only when asked;
 *   • every way of writing a stroke, a capacity or an Enerpac model reads the same;
 *   • the set builder follows the catalog: RPS pairings, p.10 oil rule, hose per cylinder (two when
 *     double-acting), coupler per hose, the gauge that reads the series in tons, a manifold for
 *     several cylinders, and the catalog's own one-part-number set when the parts are exactly one;
 *   • what leaves the page (Excel rows, purchase-request lines) carries the model and the page.
 */
const path = require('path');
const E = require('../../dashboard/js/pf-engine.js');
const DATA = path.join(__dirname, '..', '..', 'dashboard', 'data');
const rd = f => require(path.join(DATA, f));
const ctx = E.pfePrepare({ catalog: rd('pt_catalog.json'), crossover: rd('pt_crossover.json'),
  crossRef: rd('cross_reference.json').rows, index: rd('pt_index.json') });

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x).slice(0, 400)); }
  else console.log('  ok  ', l); };
const best = t => { const r = E.pfeMatch(t, ctx); return r.best ? r.best.m : null; };

console.log('== the five lines ==');
const LINES = [
  'JACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER,LOAD CARRYING CAPACITY:10 TO,MAX. HEIGHT:8 IN,MATERIAL:CHROMIUM STEEL RC-108',
  'JACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER,LOAD CARRYING CAPACITY:15 TO,MAX. HEIGHT:4 IN,MATERIAL:CHROMIUM STEEL RC-154',
  'JACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER,LOAD CARRYING CAPACITY:15 TO,MAX. HEIGHT:6 IN,MATERIAL:CHROMIUM STEEL RC-156',
  'JACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER,LOAD CARRYING CAPACITY:25 TO,MAX. HEIGHT:4 IN,MATERIAL:CHROMIUM STEEL RC-254',
  'Pump:Hydraulic;Type:Manual, P80',
];
const all = E.pfeMatchAll(LINES.join('\n'), ctx);
eq('five answers', all.map(r => r.best && r.best.m), ['C108C', 'C154C', 'C156C', 'C254C', 'P159']);
eq('all exact, from the official crossover', all.map(r => [r.quality, r.decoded.via]), Array(5).fill(['exact', 'crossover']));
eq('crossover pages 24, 24, 25, 25, 17', all.map(r => r.decoded.page), [24, 24, 25, 25, 17]);
eq('catalog pages: p.12 (PDF 14) and p.51 (PDF 53)', all.map(r => r.source),
   ['catalog p.12 (PDF 14)', 'catalog p.12 (PDF 14)', 'catalog p.12 (PDF 14)', 'catalog p.12 (PDF 14)', 'catalog p.51 (PDF 53)']);
{
  const r = all[0];
  eq('line 1 read: cylinder, SA, 10 TO, max height 8 in, steel, RC-108',
     [r.category, r.req.act, r.req.cap.text, r.req.cap.unit, r.req.height.max.in, r.req.body, r.req.modelText.RC108],
     ['cylinder', 'SA', '10 TO', 'class?', 8, 'steel', 'RC-108']);
  ok('"MAX. HEIGHT 8 IN" is said to be the stroke, with C108C\'s real heights', r.notes.some(n => /read as the stroke/.test(n) && /8\.13 in/.test(n) && /19\.88/.test(n)), r.notes);
  ok('"10 TO" is said to be RC-108\'s class, with tons and tonnes at 10,000 psi', r.notes.some(n => /10-ton class of RC-108/.test(n) && /11\.2 US tons/.test(n) && /10\.2 tonnes/.test(n)), r.notes);
  ok('chromium steel is answered from the C-series features (p.11)', r.notes.some(n => /chrome-plated piston rod/.test(n) && /p\.11/.test(n)), r.notes);
  eq('no differences on line 1', r.diffs, []);
  eq('C108C numbers as printed', ['cap', 't10k', 'stroke', 'closed', 'ext', 'oil', 'wt'].map(k => r.best[k]), [10, 11.2, 8.13, 11.75, 19.88, 19.9, 11]);
  eq('alternates are the neighbouring C-series 10 t strokes', r.alts.map(a => a.m), ['C1010C', 'C106C', 'C1012C']);
}
eq('lines 2-4 strokes 4.13, 6.13, 4.00 (read from "max height")', all.slice(1, 4).map(r => r.best.stroke), [4.13, 6.13, 4]);
ok('line 4: 25 TO is the class of RC-254, and C254C gives 23.4 tonnes — said, not hidden', all[3].notes.some(n => /25-ton class of RC-254/.test(n) && /23\.4 tonnes/.test(n)), all[3].notes);
{
  const r = all[4];
  eq('line 5 read: pump, manual, P80', [r.category, r.req.pow, r.req.models], ['pump', 'manual', ['P80']]);
  ok('the P-80 specs come from Enerpac\'s page, with the date', r.notes.some(n => /1 in³\/stroke to 500 psi/.test(n) && /134 in³ usable/.test(n) && /enerpac\.com/.test(n)), r.notes);
  eq('the first-stage difference is shown and minor', r.diffs.filter(d => d.field === '1st stage').map(d => [d.model, d.major]), [['2.6 in³/stroke to 325 psi', false]]);
  eq('no major difference on the P-80', r.diffs.filter(d => d.major), []);
  eq('P157 is the first alternate (same oil, smaller first stage)', r.alts[0].m, 'P157');
}

console.log('\n== ways of writing it ==');
eq('"10-ton" class', best('10-ton cylinder 6 in stroke'), 'C106C');
eq('"10 tonne" (11.2 US t at 10k psi covers 11.0)', best('10 tonne single acting cylinder stroke 6"'), 'C106C');
eq('"15 tonne" is never under-sized: the 15-ton class gives 14.2 t, so 25-ton', best('15 tonne cylinder 6 in stroke'), 'C256C');
eq('"100 kN" = 10.2 t: the 10-ton class gives 10.16 t, so 15-ton', best('100 kN cylinder stroke 150 mm'), 'C156C');
eq('"10 MT"', best('10 MT cylinder 8" stroke'), 'C108C');
eq('"stroke: 8 in"', best('cylinder 25 ton stroke: 8 in'), 'C258C');
eq('8" stroke, 8-1/8", 200 mm stroke all read the same', [best('25 ton cylinder 8" stroke'), best('cylinder 25t 8-1/8" stroke'), best('25 ton cylinder 200 mm stroke')], ['C258C', 'C258C', 'C258C']);
eq('a load gets the 1.25 x margin: 20 t load -> 25-ton class', best('cylinder to lift a load of 20 ton, 4 in stroke'), 'C254C');
eq('pfeFrac', [E.pfeFrac('8-1/8'), E.pfeFrac('8 1/8'), E.pfeFrac('1/2'), E.pfeFrac('8.13')], [8.125, 8.125, 0.5, 8.13]);
eq('pfeCapacity units', ['10 TO', '10 ton', '10 tonne', '10 MT', '100 kN', '10,000 kg', '4,000 lbs'].map(t => { const c = E.pfeCapacity(t); return [c.unit, c.us]; }),
   [['class?', 10], ['class', 10], ['metric', 11.03], ['metric', 11.03], ['metric', 11.24], ['metric', 11.03], ['us', 2]]);
eq('"10,000 PSI" is a pressure, not a capacity', E.pfeParseLine('cylinder 10 ton, 10,000 PSI').psi, 10000);
eq('SAP pairs split only before KEY:', E.pfeSapPairs('A:B;C:10,000 PSI,D:E').pairs.map(p => p.k + '=' + p.v), ['A=B', 'C=10,000 PSI', 'D=E']);

console.log('\n== hard filters ==');
const sa = E.pfeMatch('single acting cylinder 55 ton 6 in stroke', ctx);
eq('single-acting never returns double-acting', [sa.best.act].concat(sa.alts.map(a => a.act)).filter(a => a !== 'SA'), []);
eq('double-acting -> RD', best('double acting cylinder 55 ton 6 in stroke'), 'RD556');
eq('hollow -> RH', best('hollow cylinder 30 ton 2 in stroke'), 'RH302');
eq('aluminium -> RA', best('aluminium cylinder 55 ton 6 in stroke'), 'RA556');
eq('steel keeps aluminium out', E.pfeMatch('steel cylinder 55 ton 6 in stroke', ctx).alts.concat(E.pfeMatch('steel cylinder 55 ton 6 in stroke', ctx).best).filter(r => r.body !== 'steel').length, 0);
eq('no specialty series unless asked', [E.pfeMatch('cylinder 30 ton 2 in stroke', ctx).best].concat(E.pfeMatch('cylinder 30 ton 2 in stroke', ctx).alts).filter(r => (r.flags || []).length).map(r => r.m), []);
{
  const r = E.pfeMatch('cylinder 20 ton', ctx);
  eq('no stroke: a ladder of strokes, marked check', [r.quality, r.ladder.map(x => x.m)], ['check', ['C251C', 'C252C', 'C254C', 'C256C', 'C258C', 'C2510C', 'C2512C', 'C2514C']]);
  ok('...and says there is no 20 t C cylinder', r.notes.some(n => /no 20 t size: 25 t is the next one up/.test(n)), r.notes);
}
{
  const r = E.pfeMatch('JACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER,LOAD CARRYING CAPACITY:10 TO,MAX. HEIGHT:8 IN', ctx);
  eq('no model: 8 in is read as stroke; a 10 t cylinder can be 8 in tall, so check', [r.best.m, r.quality], ['C108C', 'check']);
  ok('...and names what fits if it is the extended height', r.notes.some(n => /If it is the extended height, only C102C \(extends to 6\.88 in\) or C101C \(extends to 4\.63 in\) fits under it/.test(n)), r.notes);
  ok('...without contradicting itself', !r.notes.some(n => /is not C108C's stroke/.test(n)), r.notes);
}
{
  const r = E.pfeMatch('JACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER,LOAD CARRYING CAPACITY:25 TON,MAX. HEIGHT:4 IN', ctx);
  eq('no model: 4 in on a 25 t cylinder can only be the stroke (the shortest closes at 5.5 in)', [r.best.m, r.quality], ['C254C', 'close']);
  ok('...and says why', r.notes.some(n => /can only be the stroke/.test(n) && /5\.5 in/.test(n)), r.notes);
}
eq('25 TO with no model: the class gives 23.4 t, so check', E.pfeMatch('JACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER,LOAD CARRYING CAPACITY:25 TO,MAX. HEIGHT:4 IN', ctx).quality, 'check');

console.log('\n== models ==');
eq('RC-1006, RC-55, RC-2514, RC50 through the crossover', ['RC-1006', 'RC-55', 'RC-2514', 'RC50'].map(best), ['C1006C', 'C55C', 'C2514C', 'RLS50']);
eq('"P-80", "P80", "Enerpac P 80", "p80 hand pump" agree', ['P-80', 'P80', 'Enerpac P 80', 'p80 hand pump'].map(best), ['P159', 'P159', 'P159', 'P159']);
eq('RR-1006 -> RD1006, RCH-302 -> RH302', [best('RR-1006'), best('RCH-302')], ['RD1006', 'RH302']);
eq('a Power Team model named outright', [best('C1006C'), best('RPS154'), best('9756')], ['C1006C', 'RPS154', '9756']);
eq('RC naming rule', [E.pfeRcRule('RC108'), E.pfeRcRule('RC1006'), E.pfeRcRule('RC55'), E.pfeRcRule('RC2514'), E.pfeRcRule('RC50'), E.pfeRcRule('RC1080')],
   [{ cap: 10, stroke: 8 }, { cap: 100, stroke: 6 }, { cap: 5, stroke: 5 }, { cap: 25, stroke: 14 }, null, null]);
{
  const r = E.pfeMatch('RC-1080', ctx);
  eq('"RC-1080" is not mistaken for order number 1080', [r.best, r.quality], [null, 'none']);
  ok('...and the line says to check the number', r.notes.some(n => /RC-1080/.test(n)), r.notes);
}
{
  const r = E.pfeMatch('RC-1010', ctx);
  ok('RC-1010 names both crossover sources (official table first)', r.decoded.via === 'crossover' && r.best.m === 'C1010C');
}

console.log('\n== other categories ==');
eq('hose 10 ft -> 9758 (1/4" rubber)', best('hose 10 ft'), '9758');
eq('3/8 hose 20 ft -> 9778', best('hydraulic hose 3/8 20 ft'), '9778');
eq('gauge for a 10 ton cylinder -> 9055', best('gauge for 10 ton cylinder'), '9055');
eq('bottle jack 20 ton -> 9120A', best('bottle jack 20 ton'), '9120A');
eq('toe jack 5 ton -> J55T', best('toe jack 5 ton'), 'J55T');
eq('electric pump stating 220V -> the 220 V variant', best('electric pump 220V for double acting cylinder'), 'PE104-220');
eq('torque wrench 6000 ft-lb -> TWHC6', best('hydraulic torque wrench 6000 ft-lb'), 'TWHC6');
eq('torque in Nm converts: 8000 Nm = 5900 lb-ft -> TWHC6', best('hydraulic torque wrench 8000 Nm'), 'TWHC6');
eq('hydraulic puller 10 ton -> the PTPHC-108 kit', best('puller 10 ton hydraulic'), 'PTPHC-108');
{
  const r = E.pfeMatch('nut splitter 15 ton', ctx);
  eq('nut splitter: found in the index, marked check', [r.best, r.quality, r.hits[0].m], [null, 'check', 'HNS150']);
}

console.log('\n== bulk ==');
{
  const b = E.pfeSplitBulk('1. 2 x RC-108\n2) RC-154 qty 3\nP80 - 2 pcs\n\n4\tJACK RC-156\t5\tPC\nRC-254 x4');
  eq('numbering, "2 x", "qty 3", "2 pcs", Excel cells, "x4"', b.map(l => [l.text, l.qty]),
     [['RC-108', 2], ['RC-154', 3], ['P80', 2], ['JACK RC-156', 5], ['RC-254', 4]]);
  eq('200-line cap', E.pfeSplitBulk(Array(250).fill('RC-108').join('\n')).length, 200);
}

console.log('\n== sets ==');
const set = s => E.pfeBuildSet(s, ctx);
const parts = o => o.parts.map(p => p.qty + ' ' + p.model);
{
  const o = set({ kind: 'lift', items: [{ model: 'C108C' }] });
  eq('C108C + manual: P55, 9756, 9798, gauge 9055 + tee 9670', parts(o), ['1 C108C', '1 P55', '1 9756', '1 9798', '1 9055', '1 9670']);
  eq('C108C has no RPS set', o.kit, null);
  ok('the pump says why: oil, reserve, p.10', /19\.9 in³/.test(o.parts[1].why) && /p\.10/.test(o.parts[1].why), o.parts[1].why);
}
{
  const o = set({ kind: 'lift', items: [{ model: 'C154C' }] });
  eq('C154C + manual: the RPS154 pairing, a psi gauge (no 15 t scale in this catalog)', parts(o), ['1 C154C', '1 P55', '1 9756', '1 9798', '1 9040', '1 9670']);
  eq('offered as the catalog set RPS154 plus the gauge and tee', [o.kit.model, o.kit.extra], ['RPS154', ['9040', '9670']]);
  ok('the pump cites RPS154 and its page', /RPS154/.test(o.parts[1].why) && /p\.52/.test(o.parts[1].why), o.parts[1].why);
}
{
  const o = set({ kind: 'lift', items: ['C108C', 'C154C', 'C156C', 'C254C'].map(m => ({ model: m })), together: true });
  eq('4 cylinders together: 72.6 in³', o.oilNeeded, 72.6);
  eq('-> P159 (137 in³), 4 hoses + 1 feed, 4 couplers, LM4S, psi gauge', parts(o),
     ['1 C108C', '1 C154C', '1 C156C', '1 C254C', '1 P159', '5 9756', '4 9798', '1 LM4S', '1 9040', '1 9670']);
  ok('pump usable covers the oil', ctx.M.P159.usable >= o.oilNeeded);
  ok('mixed sizes: valve note', o.notes.some(n => /different speeds/.test(n)), o.notes);
}
{
  const o = set({ kind: 'lift', items: ['C108C', 'C154C', 'C156C', 'C254C'].map(m => ({ model: m })), together: false });
  eq('4 cylinders one at a time: oil of the largest, one hose and coupler, no manifold', [o.oilNeeded, parts(o).filter(p => /9756|9798|LM4S|9691/.test(p))], [20.6, ['1 9756', '1 9798']]);
}
{
  const o = set({ kind: 'lift', items: [{ model: 'RD106' }] });
  eq('double-acting: a D pump and two hoses + two couplers', parts(o), ['1 RD106', '1 P159D', '2 9756', '2 9798', '1 9055', '1 9670']);
}
{
  const o = set({ kind: 'lift', items: [{ model: 'C556C', qty: 2 }], together: true });
  eq('two identical cylinders: Y manifold 9691, the 55 t gauge, P300', parts(o), ['2 C556C', '1 P300', '3 9756', '2 9798', '1 9691', '1 9069', '1 9670']);
}
{
  const o = set({ kind: 'lift', items: [{ model: 'C254C' }], pumpPow: 'electric' });
  eq('electric: the 220 V pump, flagged for confirmation', [o.pump.m, o.warnings.some(w => /220 V/.test(w))], ['PE102-220', true]);
}
{
  const o = set({ kind: 'lift', items: [{ model: 'C1006C' }] });
  eq('C1006C keeps the catalog\'s RPS1006 pairing (P460)', [o.pump.m, o.kit && o.kit.model], ['P460', 'RPS1006']);
}
{
  const o = set({ kind: 'lift', items: [{ model: 'C2514C' }], pumpModel: 'P55' });
  ok('a pump too small for the cylinder is warned about', o.warnings.some(w => /P55 holds 45/.test(w)), o.warnings);
}
{
  const o = set({ kind: 'torque', items: [{ model: 'TWHC6' }] });
  eq('torque-wrench set: PE55TWP 220 V + one TWH twin hose', parts(o), ['1 TWHC6', '1 PE55TWP-E220', '1 TWH15']);
  const o2 = set({ kind: 'torque', items: [{ model: 'TWHC6', qty: 2 }], pumpPow: 'air' });
  eq('two wrenches on air: the 4-outlet RWP55 and two hoses', parts(o2), ['2 TWHC6', '1 RWP55-4-BS', '2 TWH15']);
}
{
  const o = set({ kind: 'puller', tons: 10 });
  eq('10 t puller set: the PTPHC-108 kit, 2-jaw PTPHC-208 offered', [o.kit.model, o.kits], ['PTPHC-108', ['PTPHC-108', 'PTPHC-208']]);
}
{
  const o = set({ kind: 'tool', items: [{ model: 'HNS150' }] });
  eq('nut splitter set: HNS150 + P59 + 9764 + 9051 + 9670 (the crossover\'s STN pattern)', parts(o), ['1 HNS150', '1 P59', '1 9764', '1 9051', '1 9670']);
}
eq('an unknown model is reported, not invented', set({ kind: 'lift', items: [{ model: 'C999C' }] }).warnings[0], 'C999C is not in the catalog: it was left out of the set.');

console.log('\n== the cylinder selector (five questions, catalog p.7) ==');
{
  const sel = a => E.pfeSelect(a, ctx);
  const parts = o => o.set.parts.map(p => p.qty + ' ' + p.model);
  eq('load and travel are required, and named when missing', sel({ job: 'lift', load: 10 }).missing, ['how far it must move']);
  {
    const o = sel({ job: 'lift', load: 8, travel: 150 });
    eq('8 t, 150 mm: 8.8 US tons / 0.8 = 11.0 t -> C108C (11.2 t), 8.13 in keeps 5.9 in within 80%', [o.cylinder.m, o.need.needUs, o.need.wantIn], ['C108C', 11.03, 7.38]);
    eq('...with its pump, hose, coupler, gauge and tee', parts(o), ['1 C108C', '1 P55', '1 9756', '1 9798', '1 9055', '1 9670']);
    ok('...and says the 80% rule and the page', /80% of rated capacity \(catalog p\.7\)/.test(o.why[0]), o.why);
    eq('a self-contained jack is offered for a single lift', o.jack && o.jack.rec.m, '9013X');
    const j = sel({ job: 'lift', load: 8, travel: 150, useJack: true });
    eq('...and can replace the whole set', parts(j), ['1 9013X']);
  }
  eq('80 t on one cylinder: the 80% rule passes 100 t (103.1 t < 110.3 t) -> the 150 t heavy-lift RGG1508', sel({ job: 'lift', load: 80, travel: 150 }).cylinder.m, 'RGG1508');
  {
    const o = sel({ job: 'lift', load: 80, points: 4, travel: 100 });
    eq('80 t over 4 cylinders -> 4 x C308C, a manifold, 4 hoses + the feed', [o.cylinder.m, parts(o).filter(p => /C308C|9756|9798|LM4S/.test(p))], ['C308C', ['4 C308C', '5 9756', '4 9798', '1 LM4S']]);
    eq('...no jack when several cylinders share the load', o.jack, null);
  }
  eq('a tight space (150 mm) picks a low-height series that fits: RSS302 closes at 4.63 in', [sel({ job: 'lift', load: 20, travel: 50, space: 150 }).cylinder.m], ['RSS302']);
  {
    const o = sel({ job: 'lift', load: 10, travel: 20, space: 80 });
    eq('nothing fits 80 mm: the lowest that does the job, and a warning', [o.cylinder.m, o.warnings.some(w => /does not fit the space/.test(w))], ['RSS202', true]);
  }
  eq('pull or tension -> a centre-hole cylinder', sel({ job: 'pull', load: 20, travel: 50 }).cylinder.ser, 'RH');
  eq('hold for days -> a locking collar', (sel({ job: 'hold', load: 150, travel: 150 }).cylinder.flags || []).includes('locking'), true);
  {
    const o = sel({ job: 'lift', load: 30, travel: 100, powered: true });
    eq('powered return -> double-acting RD556 with the P159D pump and two hoses', parts(o), ['1 RD556', '1 P159D', '2 9756', '2 9798', '1 9069', '1 9670']);
  }
  eq('light to carry -> aluminium RA556', sel({ job: 'lift', load: 30, travel: 100, light: true }).cylinder.m, 'RA556');
  eq('kg and inches convert: 8,000 kg and 5.9 in -> C108C', sel({ job: 'lift', load: 8000, loadUnit: 'kg', travel: 5.9, travelUnit: 'in' }).cylinder.m, 'C108C');
  eq('electric power: the set gets an electric pump', sel({ job: 'lift', load: 8, travel: 150, power: 'electric' }).set.pump.pow, 'electric');
  {
    const o = sel({ job: 'lift', load: 8, travel: 150, model: 'C106C' });
    eq('a cylinder picked by hand is used, and warned about when its stroke is short of 80%', [o.cylinder.m, o.chosen, o.why[1].includes('uses')], ['C106C', true, true]);
  }
  eq('too heavy for any cylinder: a clear message, no guess', [sel({ job: 'lift', load: 500, travel: 100 }).ok, /Split the load/.test(sel({ job: 'lift', load: 500, travel: 100 }).warnings[0])], [false, true]);
}

console.log('\n== Choose a cylinder from a rating (the spec lines Neil sent) ==');
{
  const sel = x => E.pfeSelect(Object.assign({ job: 'lift', basis: 'rating', act: 'SA', loadUnit: 't', travelUnit: 'in' }, x), ctx);
  eq('10 t / 8 in, 15 t / 4 in, 15 t / 6 in, 25 t / 4 in give the equivalents of RC-108, RC-154, RC-156, RC-254',
     [[10, 8], [15, 4], [15, 6], [25, 4]].map(([t, st]) => sel({ load: t, travel: st }).cylinder.m), ['C108C', 'C154C', 'C156C', 'C254C']);
  eq('...the same as Find gives for the lines themselves', LINES.slice(0, 4).map(l => best(l)), ['C108C', 'C154C', 'C156C', 'C254C']);
  const r = sel({ load: 10, travel: 8 });
  ok('the rating is matched as given, and the 80% rule is named for the other way in', r.notes.some(n => /Matched to the rating as given/.test(n) && /80%/.test(n)), r.notes);
  ok('the class is explained with tons and tonnes', /10 t class/.test(r.why[0]) && /11\.2 US tons, 10\.2 tonnes/.test(r.why[0]), r.why);
  eq('alternates: the next strokes of the same class first', r.alts.slice(0, 2).map(x => x.m), ['C106C', 'C1010C']);
  ok('15 t: the metric shortfall is said', sel({ load: 15, travel: 4 }).notes.some(n => /14\.2 tonnes/.test(n)));
  eq('a stroke in mm: 205 mm (8.07 in) is still C108C', sel({ load: 10, travel: 205, travelUnit: 'mm' }).cylinder.m, 'C108C');
  eq('the load way in is unchanged: 10 t load over 8 in needs more than a 10-ton cylinder', E.pfeSelect({ job: 'lift', load: 10, travel: 8, travelUnit: 'in' }, ctx).cylinder.m, 'C1510C');
}
{
  const sel = x => E.pfeSelect(Object.assign({ job: 'lift', basis: 'rating', load: 10, travel: 6, travelUnit: 'in' }, x), ctx);
  eq('double-acting chosen: an RD cylinder and a D pump with two hoses', (o => [o.cylinder.m, o.cylinder.act, o.set.pump.m, o.set.parts.find(p => p.role === 'hose').qty])(sel({ act: 'DA' })), ['RD106', 'DA', 'P159D', 2]);
  eq('single-acting chosen', sel({ act: 'SA' }).cylinder.act, 'SA');
  eq('double-acting 10 t / 8 in: RD1010, never a 55 t cylinder just because its stroke is 8 in', (o => [o.cylinder.m, o.alts[0].m])(sel({ act: 'DA', travel: 8 })), ['RD1010', 'RD106']);
  ok('...and it says the 8 in stroke is not made in this class', sel({ act: 'DA', travel: 8 }).notes.some(n => /strokes 8 in exactly; RD1010 is the nearest longer one/.test(n)));
  ok('double-acting 10 t / 14 in: a bigger class that has the stroke (RD2514), said so', (o => o.cylinder.m === 'RD2514' && o.notes.some(n => /bigger class that does/.test(n)))(sel({ act: 'DA', travel: 14 })));
  eq('30 t / 6 in: RA306 (the C series has no 30 t 6 in), C308C offered', (o => [o.cylinder.m, o.alts.map(x => x.m).includes('C308C')])(sel({ act: 'SA', load: 30, travel: 6 })), ['RA306', true]);
  ok('not sure: single-acting, and it says so', sel({ act: '' }).cylinder.act === 'SA' && sel({ act: '' }).notes.some(n => /Single-acting was assumed/.test(n)));
  ok('double-acting cannot hold a load on a locking collar: kept single-acting, with a warning', (o => o.cylinder.act === 'SA' && o.warnings.some(w => /Locking-collar cylinders are single-acting/.test(w)))(E.pfeSelect({ job: 'hold', basis: 'rating', act: 'DA', load: 100, travel: 6, travelUnit: 'in' }, ctx)));
  eq('the old "powered" flag still means double-acting', E.pfeSelect({ job: 'lift', load: 30, travel: 100, powered: true }, ctx).cylinder.act, 'DA');
}
{
  const pump = x => E.pfeSelect(Object.assign({ job: 'lift', basis: 'rating', act: 'SA', load: 10, travel: 8, travelUnit: 'in' }, x), ctx).set.pump;
  eq('hand pump, either: the catalog pairing (P55, one-speed)', [pump({}).m, pump({}).speed], ['P55', 1]);
  eq('hand pump, one-speed: P55', pump({ speed: 1 }).m, 'P55');
  eq('hand pump, two-speed: P59 (the same 45 in³, two-speed)', [pump({ speed: 2 }).m, pump({ speed: 2 }).speed], ['P59', 2]);
  const big = E.pfeBuildSet({ kind: 'lift', items: ['C108C', 'C154C', 'C156C', 'C254C'].map(m => ({ model: m })), together: true, speed: 1 }, ctx);
  ok('one-speed asked but no one-speed pump holds the oil: two-speed P159, and it says so', big.pump.m === 'P159' && big.notes.some(n => /No one-speed hand pump holds/.test(n)), [big.pump.m, big.notes]);
  eq('four cylinders together, two-speed: P159, the P-80 equivalent', E.pfeBuildSet({ kind: 'lift', items: ['C108C', 'C154C', 'C156C', 'C254C'].map(m => ({ model: m })), together: true, speed: 2 }, ctx).pump.m, 'P159');
  eq('C154C one-speed keeps its RPS154 pairing; two-speed moves to P59', [E.pfeBuildSet({ kind: 'lift', items: [{ model: 'C154C' }], speed: 1 }, ctx).pump.m, E.pfeBuildSet({ kind: 'lift', items: [{ model: 'C154C' }], speed: 2 }, ctx).pump.m], ['P55', 'P59']);
  eq('short names say one-speed and two-speed', [E.pfeShort(ctx.M.P55), E.pfeShort(ctx.M.P159)], ['hand pump, one-speed, 45 in³ usable oil', 'hand pump, two-speed, 137 in³ usable oil']);
}
eq('Find reads the first line even with its J missing ("ACK:HYDRAULIC…")', best('ACK:HYDRAULIC;TYPE:SINGLE ACTING CYLINDER,LOAD CARRYING CAPACITY:10 TO,MAX. HEIGHT:8 IN,MATERIAL:CHROMIUM STEEL RC-108'), 'C108C');

console.log('\n== what leaves the page ==');
{
  const basket = [{ model: 'C108C', qty: 2, line: LINES[0], quality: 'exact', basis: all[0].basis, source: all[0].source },
                  { model: 'P159', qty: 1, line: LINES[4], quality: 'close', set: 'Lifting set 1', role: 'pump' }];
  const rows = E.pfeExcelRows(basket, ctx);
  eq('Excel header', rows[0], ['#', 'Customer line', 'Qty', 'Power Team model', 'Description', 'Set', 'Role', 'Match', 'Basis', 'Catalog page', 'Notes']);
  eq('Excel row: model, qty, page', [rows[1][2], rows[1][3], rows[1][9], rows[1][7]], [2, 'C108C', 'catalog p.12 (PDF 14)', 'Exact']);
  const pr = E.pfePrItems(basket, ctx);
  eq('PR lines carry the model as item number and the page in the remark',
     pr.map(p => [p.model, p.qty, p.remarks]),
     [['C108C', 2, 'Product Finder: Power Team C108C, catalog p.12'], ['P159', 1, 'Product Finder: Power Team P159, catalog p.51, confirm · Lifting set 1 (pump)']]);
  eq('PR line names say what the model is', pr.map(p => p.name),
     ['Power Team C108C — 10 t single-acting cylinder, 8.13 in stroke', 'Power Team P159 — hand pump, two-speed, 137 in³ usable oil']);
}
eq('short names: a manifold stops before its dimensions, a tee at its full stop', [E.pfeShort(ctx.M.LM4S), E.pfeShort(ctx.M['9670'])],
   ['Lifting Manifold, 4 Port, Single Acting', 'Tee adapter']);
eq('describe a hose with coupler', E.pfeDescribe(ctx.M['9754'], ctx), 'Hose, rubber, 1/4" I.D., 6 ft, 20,000 psi burst, with 9798 half coupler and 9800 dust cap');
eq('nothing for nothing', [E.pfeMatch('', ctx).quality, E.pfeSplitBulk('').length, E.pfeBuildSet(null, ctx).warnings[0]], ['none', 0, 'Add at least one cylinder.']);

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
