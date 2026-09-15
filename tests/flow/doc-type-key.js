/* A251 — a document that IS attached must be seen as attached.
 *
 * PRF-2026-93 (COMER, SO 150001774) was refused at the pay gate for "TT form / bank remittance slip"
 * while "Telegraphic Transfer Application Form PO 2026-46 COMER.pdf" sat on the request, filed under
 * Doc Type "Telegraphic Transfer Form". _DOC_TYPE_ALIASES carried 'telegraphic transfer' — and matched
 * the whole string exactly, so the trailing word "Form" was enough to miss it. The document was there,
 * correctly named, and the gate could not see it.
 *
 * What this file holds down:
 *   • THE REGRESSION ITSELF, by name — the exact string on the exact request;
 *   • THE ROUND TRIP. A refusal message quotes the rule's label, so the label is what the next person
 *     types into the Doc Type box. Every label must resolve to its own rule's type, or the app is
 *     asking for a document under a name it will then refuse;
 *   • IDEMPOTENCE. _docTypeKey runs over both the stored value and the rule's type in the same
 *     comparison (_docGaps: `have[_docTypeKey(r.type)]`), so a type that does not resolve to itself
 *     silently breaks its own rule;
 *   • NO WIDENING. The fallback may only reach a name some rule or alias already owns, it must never
 *     collapse two different documents onto one key, and free text it does not recognise must stay
 *     free text — 'Bank details' is not evidence of anything.
 */
const fs = require('fs');
const path = require('path');

const GAS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/** Lift a contiguous run of source between two markers — the alias table and its four functions are
 *  one unit, and _DOC_TYPE_NOISE is a regex literal that no bracket-matching lift can find. */
function liftBetween(src, from, toEndOf) {
  const i = src.indexOf(from);
  if (i < 0) throw new Error('not found: ' + from);
  const j = src.indexOf(toEndOf, i);
  if (j < 0) throw new Error('not found: ' + toEndOf);
  return src.slice(i, j + toEndOf.length);
}

const _DOC_RULES = eval(
  (() => { const m = /(?:var|const)\s+_DOC_RULES\s*=\s*\[/.exec(GAS);
    const s = GAS.indexOf('[', m.index); let d = 0;
    for (let k = s; k < GAS.length; k++) { if (GAS[k] === '[') d++; else if (GAS[k] === ']') { d--; if (!d) return GAS.slice(s, k + 1); } }
    throw new Error('unbalanced _DOC_RULES'); })());

eval(liftBetween(GAS, 'var _DOC_TYPE_ALIASES = {', 'return t;                                                           // unknown: still free text\n}'));

console.log('== the regression ==');
{
  eq('the document PRF-2026-93 actually carries is the TT the pay gate asks for',
     _docTypeKey('Telegraphic Transfer Form'), 'tt_sent');
  eq('so is the form under its full name on the file',
     _docTypeKey('Telegraphic Transfer Application Form'), 'tt_sent');
  /* The refusal said: attach "TT form / bank remittance slip". Typing back exactly what you were
     asked for is the one wording that must never miss. */
  eq('and so is the wording the refusal message itself quotes',
     _docTypeKey('TT form / bank remittance slip'), 'tt_sent');
  eq('the bare alias that used to be the only hit still works', _docTypeKey('TT'), 'tt_sent');
  eq('and the other half of that label, on its own', _docTypeKey('Bank remittance slip'), 'tt_sent');
}

console.log('\n== the round trip: every label resolves to its own rule ==');
_DOC_RULES.forEach(r => {
  eq('  "' + r.label + '" → ' + r.type, _docTypeKey(r.label), r.type);
});

console.log('\n== idempotence: a rule type resolves to itself ==');
_DOC_RULES.forEach(r => {
  eq('  ' + r.type, _docTypeKey(r.type), r.type);
});
{
  /* _docGaps compares _docTypeKey(stored) against _docTypeKey(r.type); if a second pass moved the
     value the two sides would drift apart on documents that had already matched once. */
  const sample = ['Telegraphic Transfer Form', 'Proforma Invoice', 'Client PO (stamped)',
                  'Delivery receipt', 'Signed delivery receipt (customer copy)', 'Bank details'];
  sample.forEach(s => ok('  a second pass over "' + s + '" changes nothing',
     _docTypeKey(_docTypeKey(s)) === _docTypeKey(s), [s, _docTypeKey(s), _docTypeKey(_docTypeKey(s))]));
}

console.log('\n== the alias table still says what it says ==');
Object.keys(_DOC_TYPE_ALIASES).forEach(k => {
  eq('  ' + k, _docTypeKey(k), _DOC_TYPE_ALIASES[k]);
});

console.log('\n== no widening ==');
{
  /* Every name the fallback index knows must be owned by exactly one target. A label or alias that
     normalises onto a key another document already holds is a silent collapse of two documents into
     one — put() would skip it and the loser would quietly start satisfying the winner's rule. */
  const claims = {};
  const claim = (text, target, src) => {
    const n = _docTypeNorm(text);
    if (!n) return;
    if (claims[n] && claims[n].target !== target) {
      fail++;
      console.log('  FAIL two documents share the normalised name', JSON.stringify(n),
                  '\n     ', claims[n].src, '→', claims[n].target, '\n     ', src, '→', target);
    } else if (!claims[n]) claims[n] = { target, src };
  };
  _DOC_RULES.forEach(r => claim(r.type, r.type, 'type ' + r.type));
  Object.keys(_DOC_TYPE_ALIASES).forEach(k => claim(k, _DOC_TYPE_ALIASES[k], 'alias ' + k));
  _DOC_RULES.forEach(r => {
    claim(r.label, r.type, 'label ' + r.label);
    String(r.label).split('/').forEach(p => claim(p, r.type, 'label half ' + p));
  });
  ok('  every name in the fallback index belongs to one document', true);

  /* The other documents on SO 150001774. Two of them must stay free text: recognising 'Bank details'
     or a PO copy as evidence would close a gate nobody satisfied. */
  eq('the proforma is the proforma',        _docTypeKey('Proforma Invoice'), 'proforma_received');
  eq('a superseded one is still the proforma', _docTypeKey('Proforma Invoice (superseded)'), 'proforma_received');
  eq('"Bank details" is not evidence',      _docTypeKey('Bank details'), 'bank details');
  eq('nor is a copy of our own PO',         _docTypeKey('Purchase Order to Supplier'), 'purchase order to supplier');
  eq('a record\'s own PDF is not a document type either', _docTypeKey('Generated PDF'), 'generated pdf');
  eq('an item photo stays an item photo',   _docTypeKey('Item Photo'), 'item photo');
  eq('blank stays blank',                   _docTypeKey(''), '');
  eq('null does not throw',                 _docTypeKey(null), '');

  /* A slash means one document written two ways. "and" joins two names and is left alone: whether one
     of them is enough is _DOC_RULES' call. (An alias already lets a packing list stand for the pair —
     that is a decision the table makes out loud, not one this function makes for it.) */
  eq('the delivery receipt and the signed customer copy stay two different documents',
     [_docTypeKey('Delivery receipt'), _docTypeKey('Signed delivery receipt')],
     ['delivered', 'delivered_client']);
  eq('a debit memo is not a TT: one is asked for before the money moves, the other after',
     [_docTypeKey('Bank debit memo'), _docTypeKey('Telegraphic transfer form')],
     ['debit_memo', 'tt_sent']);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
