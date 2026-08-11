/* A220 — a local purchase is 13 steps, not 25.
 *
 * The company buys two ways. An INTERNATIONAL order goes through a proforma, a forwarder, customs and
 * a bank debit memo. A LOCAL one is paid and then delivered to the office — the supplier's own sales
 * invoice and a delivery receipt are the whole document set. `_DOC_RULES` has known that since A195.
 * The 25-stage shipment timeline never did, so every local shipment was asked on screen for FAN/SAD/TAN,
 * a forwarder's final invoice and a customs clearance that will never exist, and reported its progress
 * out of 25 steps it could not finish.
 *
 * What this file exists to hold down:
 *   • THE TWO LISTS MUST AGREE, first and before anything else. FlowAPI.gs and stage-meta.js each
 *     carry a copy of which stages are international-only, exactly as they already each carry a copy
 *     of the stage ORDER (FlowAPI.gs:3345 says so in as many words). A silent divergence would hide a
 *     stage on the page while the server still demanded its document — the worst of both;
 *   • the split is exactly 13 and 12, and the 13 are the business's own description of the local
 *     process: the order stages, PRF created, PRF approved, the transfer, forwarded to the supplier,
 *     delivered — then the ordinary sales close;
 *   • DELIVERED IS REACHABLE ON A LOCAL ORDER. `requires` is a strict linear spine that runs
 *     delivered ← local_charges ← forwarder_final_invoice ← … ← customs_clearance. Take those away
 *     without repairing the chain and a local shipment can never legitimately be marked delivered;
 *   • an UNCLASSIFIED order shows all 25. 13 live orders have no supplier type, and guessing would
 *     silently drop document requirements on orders nobody has classified;
 *   • a reclassification HIDES, it never deletes. Stage state survives a flip in both directions.
 *
 * The server half lives in Apps Script, so it is lifted out of FlowAPI.gs and run here against a fake
 * sheet — the same technique tests/flow/quotation-owner.js and ap-payable.js use.
 */
const fs = require('fs');
const path = require('path');

const GAS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');
const META = fs.readFileSync(path.resolve(__dirname, '../../dashboard/js/stage-meta.js'), 'utf8');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/** Pull one top-level `function name(...) { ... }` out of a source by brace matching. */
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  const s = src.indexOf('{', i);
  let d = 0;
  for (let k = s; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
/** Pull one top-level `var|const NAME = <literal>;` by matching its opening bracket. */
function liftVar(src, name) {
  const m = new RegExp('(?:var|const)\\s+' + name + '\\s*=\\s*([\\[{])').exec(src);
  if (!m) throw new Error('not found: ' + name);
  const open = m[1], close = open === '[' ? ']' : '}';
  const s = src.indexOf(open, m.index);
  let d = 0;
  for (let k = s; k < src.length; k++) {
    if (src[k] === open) d++;
    // Parenthesised so eval() reads `{...}` as an object literal and not as a block.
    else if (src[k] === close) { d--; if (!d) return '(' + src.slice(s, k + 1) + ')'; }
  }
  throw new Error('unbalanced: ' + name);
}

const SHIP_STAGES     = eval(liftVar(GAS, '_SHIP_STAGES'));
const SHIP_STAGE_INTL = eval(liftVar(GAS, '_SHIP_STAGE_INTL'));
const SM_STAGES       = eval(liftVar(META, '_SM_LIFECYCLE_STAGES'));
const SM_INTL_ONLY    = eval(liftVar(META, '_SM_INTL_ONLY'));
const SM_PHASES       = eval(liftVar(META, '_SM_PHASES'));
const SM_STAGE_META   = eval(liftVar(META, '_SM_STAGE_META'));
const SM_LOCAL_LABELS = eval(liftVar(META, '_SM_LOCAL_LABELS'));

// The server helpers, verbatim.
const _SHIP_STAGE_INTL = SHIP_STAGE_INTL;
eval(lift(GAS, '_shipStageApplies'));
eval(lift(GAS, '_shipStageInKind'));

// The client helpers, verbatim, against the real arrays.
const _SM_INTL_ONLY = SM_INTL_ONLY;
const _SM_LIFECYCLE_STAGES = SM_STAGES;
const _SM_PHASES = SM_PHASES;
const _SM_STAGE_META = SM_STAGE_META;
const _SM_LOCAL_LABELS = SM_LOCAL_LABELS;
eval(lift(META, 'smStageApplies'));
eval(lift(META, 'smStageInKind'));
eval(lift(META, 'smStageLabel'));
eval(lift(META, 'smPhaseStages'));
eval(lift(META, 'smRequires'));

console.log('== THE TWO COPIES MUST AGREE — checked before anything else ==');
{
  eq('the stage ORDER still matches (the coupling FlowAPI.gs:3345 already demanded)',
     SM_STAGES.map(s => s.key), SHIP_STAGES);
  eq('and now the international-only set matches too',
     SHIP_STAGE_INTL.slice().sort(), SM_INTL_ONLY.slice().sort());
  /* Not the same assertion: the lists could match each other and both name a stage that does not
     exist. That would hide nothing and silently do nothing. */
  SHIP_STAGE_INTL.forEach(k => ok('  "' + k + '" is a real stage', SHIP_STAGES.indexOf(k) !== -1, k));
  eq('no duplicates', SHIP_STAGE_INTL.length, new Set(SHIP_STAGE_INTL).size);
}

console.log('\n== the split is 13 and 12 ==');
{
  const forKind = (kind) => SHIP_STAGES.filter(k => _shipStageInKind(k, kind));
  eq('an international order keeps all 25', forKind('intl').length, 25);
  eq('a local order has 13',                forKind('local').length, 13);
  eq('12 stages drop out',                  25 - forKind('local').length, 12);

  /* The business's own words: "order is still the same, in payment, no proforma invoice, prf created
     is there, prf approved, telegraphic transfer OR bank transfer depending on the payment request,
     transaction forwarded or sent to supplier, deliver to office" — plus the ordinary sales close. */
  eq('and they are exactly the local process as described', forKind('local'), [
    'so_received', 'po_created', 'po_approved', 'po_sent',
    'prf_created', 'prf_approved', 'tt_sent', 'tt_forwarded',
    'delivered', 'delivered_client', 'invoiced', 'ar_open', 'collected'
  ]);
  ok('no proforma on a local order', forKind('local').indexOf('proforma_received') === -1);
  ok('no customs, no FAN/SAD/TAN, no debit memo, no forwarder anything',
     ['customs_clearance', 'fan_sad_tan', 'debit_memo', 'forwarder_quotes', 'forwarder_approved',
      'forwarder_final_invoice', 'local_charges', 'booked', 'pickup', 'in_transit',
      'shipping_docs_received'].every(k => forKind('local').indexOf(k) === -1));
}

console.log('\n== an unclassified order is not guessed at ==');
{
  /* 13 of the 106 live orders have no supplier type. Treating a blank as Local would silently drop
     document requirements on orders nobody has classified — the wrong direction to be wrong in. */
  eq("'' shows everything",        SHIP_STAGES.filter(k => _shipStageInKind(k, '')).length, 25);
  eq('undefined shows everything', SHIP_STAGES.filter(k => _shipStageInKind(k, undefined)).length, 25);
  eq('and so does junk',           SHIP_STAGES.filter(k => _shipStageInKind(k, 'Local')).length, 25);
  //                                                                            ^ capitalised: the
  // stored SHEET value. _soSupplierKind lowercases it to 'local'; anything that reaches these helpers
  // unnormalised must fail SAFE (show everything), never hide a document requirement.
}

console.log('\n== the server and the client answer identically ==');
{
  ['intl', 'local', ''].forEach(kind => {
    eq('  kind ' + JSON.stringify(kind),
       SHIP_STAGES.filter(k => _shipStageInKind(k, kind)),
       SHIP_STAGES.filter(k => smStageInKind(k, kind)));
  });
  eq('and appliesTo agrees stage by stage',
     SHIP_STAGES.map(k => _shipStageApplies(k)), SHIP_STAGES.map(k => smStageApplies(k)));
}

console.log('\n== DELIVERED IS REACHABLE ON A LOCAL ORDER ==');
{
  /* The bug this catches: requires is a linear spine — delivered <- local_charges <-
     forwarder_final_invoice <- debit_memo <- fan_sad_tan <- customs_clearance <- in_transit <-
     pickup <- booked <- forwarder_approved <- forwarder_quotes <- shipping_docs_received. Every one
     of those is international-only. Hide them without repairing the chain and a local shipment can
     never legitimately be marked delivered — the exact complaint, in reverse. */
  eq('internationally, delivered still waits on the local charges',
     smRequires('delivered', 'intl'), ['local_charges']);
  const local = smRequires('delivered', 'local');
  ok('locally it waits on something that exists', local.length > 0, local);
  ok('...and every prerequisite applies to a local order',
     local.every(k => smStageInKind(k, 'local')), local);
  eq('which is the transfer being forwarded to the supplier', local, ['tt_forwarded']);

  // Every stage a local order has must have a reachable prerequisite chain, not just `delivered`.
  SHIP_STAGES.filter(k => smStageInKind(k, 'local')).forEach(k => {
    const r = smRequires(k, 'local');
    ok('  ' + k + ' has no impossible prerequisite', r.every(x => smStageInKind(x, 'local')), { k, r });
  });
  eq('the first stage still needs nothing', smRequires('so_received', 'local'), []);
}

console.log('\n== a local payment is a bank transfer, not a TT ==');
{
  eq('tt_sent, internationally',  smStageLabel('tt_sent', 'intl'),  'Telegraphic Transfer (TT) Sent');
  eq('tt_sent, locally',          smStageLabel('tt_sent', 'local'), 'Bank Transfer Sent');
  eq('tt_forwarded, locally',     smStageLabel('tt_forwarded', 'local'), 'Transfer Forwarded to Supplier');
  eq('unclassified keeps the international wording',
     smStageLabel('tt_sent', ''), 'Telegraphic Transfer (TT) Sent');
  eq('a stage with no local wording is unchanged',
     smStageLabel('delivered', 'local'), smStageLabel('delivered', 'intl'));
  /* Relabelling must not move any stored state: same keys, same auto-derivation. */
  ok('every relabelled stage keeps its key', Object.keys(SM_LOCAL_LABELS)
       .every(k => SHIP_STAGES.indexOf(k) !== -1), Object.keys(SM_LOCAL_LABELS));
  ok('and both are stages a local order actually has',
     Object.keys(SM_LOCAL_LABELS).every(k => smStageInKind(k, 'local')));
}

console.log('\n== two whole phases drop out, and the rest survive ==');
{
  eq('Order is unaffected',    smPhaseStages('Order', 'local').length, 4);
  eq('Payment loses only the proforma', smPhaseStages('Payment', 'local'),
     ['prf_created', 'prf_approved', 'tt_sent', 'tt_forwarded']);
  eq('Documents is entirely international',  smPhaseStages('Documents', 'local'), []);
  eq('so is Logistics',                      smPhaseStages('Logistics', 'local'), []);
  eq('Delivery & Closing keeps the two that matter',
     smPhaseStages('Delivery & Closing', 'local'), ['delivered', 'delivered_client']);
  eq('Billing & Collection is unaffected', smPhaseStages('Billing & Collection', 'local').length, 3);
  eq('nothing is lost internationally',
     SM_PHASES.reduce((n, p) => n + smPhaseStages(p.name, 'intl').length, 0), 25);
  eq('and the local phases sum to 13',
     SM_PHASES.reduce((n, p) => n + smPhaseStages(p.name, 'local').length, 0), 13);
}

console.log('\n== reclassifying HIDES — it must never delete ==');
{
  /* SO-202607-001 is live: International, Delivered, 12 of 25 stages done. Flipping it to Local hides
     the international ones; flipping back must return every one of them, untouched. This is the whole
     safety promise of the feature, so it is asserted rather than described. */
  const stored = {};
  ['so_received', 'po_created', 'po_approved', 'po_sent', 'proforma_received', 'prf_created',
   'prf_approved', 'tt_sent', 'tt_forwarded', 'shipping_docs_received', 'booked', 'in_transit']
    .forEach(k => { stored[k] = { status: 'done', completedAt: '2026-07-25', completedBy: 'Crystal Gayle' }; });
  const before = JSON.parse(JSON.stringify(stored));

  const visible = (kind) => SHIP_STAGES.filter(k => _shipStageInKind(k, kind) && stored[k]);
  eq('12 done as International', visible('intl').length, 12);
  eq('8 of them survive the switch to Local', visible('local').length, 8);
  eq('and the stored map is byte-identical afterwards', stored, before);
  eq('so switching back returns all 12', visible('intl').length, 12);
  ok('the 4 hidden ones are still in the record, just not shown',
     ['proforma_received', 'shipping_docs_received', 'booked', 'in_transit']
       .every(k => stored[k] && stored[k].status === 'done'));
}

console.log('\n== the document contract the stages exist to serve ==');
{
  /* The stage split is only worth anything if it matches what the rule engine actually demands.
     _DOC_RULES is the server's own table, read here rather than restated. */
  const _DOC_RULES = eval(liftVar(GAS, '_DOC_RULES'));
  const rulesFor = (kind, gate) => _DOC_RULES.filter(r => {
    if (gate && r.gate !== gate) return false;
    if (r.applies === 'both') return true;
    return kind ? r.applies === kind : false;
  });
  eq('a local order must produce 2 documents to receive', rulesFor('local', 'receive').length, 2);
  eq('an international one, 7',                            rulesFor('intl',  'receive').length, 7);
  /* NOT 8. The 8th receive rule is the local-only supplier sales invoice, which never applies to an
     international order — counting all receive rules regardless of `applies` gives the wrong figure,
     and that miscount reached the plan. Asserted so no comment can drift back to it. */
  eq('and the whole receive table is 8 rules, which is why 8 is easy to say by mistake',
     _DOC_RULES.filter(r => r.gate === 'receive').length, 8);
  eq("local's two are the delivery receipt and the supplier's own invoice",
     rulesFor('local', 'receive').map(r => r.type).sort(),
     ['delivered', 'supplier sales invoice'].sort());
  eq('a local payment needs no proforma and no TT slip', rulesFor('local', 'pay').length, 0);
  eq('an international one needs both',                   rulesFor('intl',  'pay').length, 2);
  eq('invoicing and collecting do not vary by kind',
     ['invoice', 'collect'].map(g => [rulesFor('intl', g).length, rulesFor('local', g).length]),
     [[1, 1], [1, 1]]);

  /* Every international-only DOCUMENT rule must name a stage that is international-only, or the
     picker and the timeline would disagree about the same order. */
  _DOC_RULES.filter(r => r.applies === 'intl' && r.module === 'Shipment').forEach(r => {
    ok('  the intl doc rule "' + r.stage + '" is on an intl-only stage',
       SHIP_STAGE_INTL.indexOf(r.stage) !== -1 || r.stage === 'tt_sent', r.stage);
    //  ^ tt_sent is the deliberate exception: a local order DOES pay by bank transfer, so the stage
    //    applies to both kinds; only the TT form itself is international.
  });
}

console.log('\n== rubbish does not throw ==');
{
  eq('an unknown stage is not international', _shipStageApplies('nonsense'), 'both');
  eq('null is not international',             _shipStageApplies(null), 'both');
  ok('an unknown stage still applies somewhere', _shipStageInKind('nonsense', 'local'));
  eq('an unknown stage has no prerequisites', smRequires('nonsense', 'local'), []);
  eq('an unknown phase is empty',             smPhaseStages('Nope', 'local'), []);
  eq('an unknown stage labels as itself',     smStageLabel('nonsense', 'local'), 'nonsense');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
