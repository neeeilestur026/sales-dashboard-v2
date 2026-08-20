/* A218 — whose quotation is it.
 *
 * `Created By` is who TYPED it. On the live book one person typed 46 of 85 while owning 27, because
 * creating quotations is her job. The owner lived only as initials inside the quotation number, and
 * five quotations worth ₱75.7M were attributed to the wrong person — including the largest deal in
 * the pipeline at ₱74.2M.
 *
 * What this file exists to hold down:
 *   • THE WIDTH TRAP, first and before anything else. SCHEMA.Quotations and BOTH positional writers
 *     must agree. This exact mistake has been made in A186, A193, A205 and A215;
 *   • the four malformed live numbers are READ, not skipped — a missing dash, a space for a dash,
 *     underscores throughout, and a revision suffix baked into the initials;
 *   • precedence: the stored column beats the number, the number beats the typist. Getting that
 *     order wrong would make a correction on the sheet unable to stick;
 *   • an unrecognised set of initials falls back rather than inventing an owner.
 *
 * _quoOwner lives in Apps Script, so it is lifted out of FlowAPI.gs and evaluated here — the same
 * technique tests/flow/gasload.js uses, kept local because these three functions have no
 * dependencies beyond each other.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(__dirname, '../../apps-script/FlowAPI.gs'), 'utf8');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/** Pull one top-level `function name(...) { ... }` out of the source by brace matching. */
function lift(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  const s = SRC.indexOf('{', i);
  let d = 0;
  for (let k = s; k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
/** The initials table, lifted the same way. */
function liftVar(name) {
  const i = SRC.indexOf('var ' + name + ' = {');
  const s = SRC.indexOf('{', i);
  let d = 0;
  for (let k = s; k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced: ' + name);
}

eval(liftVar('_QUO_INITIALS'));
eval(lift('_quoInitials'));
eval(lift('_quoOwner'));

console.log('== THE WIDTH TRAP — checked before anything else ==');
{
  const i = SRC.indexOf('var SCHEMA');
  const s = SRC.indexOf('{', i);
  let d = 0, e = -1;
  for (let k = s; k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (!d) { e = k; break; } }
  }
  const SCHEMA = eval('(' + SRC.slice(s, e + 1) + ')');

  const countArgs = (fnName) => {
    const f = SRC.indexOf('function ' + fnName);
    const a = SRC.indexOf("_append('Quotations', [", f);
    const st = SRC.indexOf('[', a);
    let dd = 0, en = -1;
    for (let k = st; k < SRC.length; k++) {
      if (SRC[k] === '[') dd++;
      else if (SRC[k] === ']') { dd--; if (!dd) { en = k; break; } }
    }
    let body = SRC.slice(st + 1, en).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    let depth = 0, n = 1, inStr = null;
    for (const c of body) {
      if (inStr) { if (c === inStr) inStr = null; continue; }
      if (c === "'" || c === '"') inStr = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 0) n++;
    }
    return body.trim() ? n : 0;
  };

  eq('the schema is 27 wide', SCHEMA.Quotations.length, 27);
  eq('Salesperson is the last column', SCHEMA.Quotations[SCHEMA.Quotations.length - 1], 'Salesperson');
  eq('createQuotation appends exactly that many', countArgs('createQuotation'), SCHEMA.Quotations.length);
  eq('and so does the commission demo seed', countArgs('seedCommissionDemo'), SCHEMA.Quotations.length);
}

console.log('\n== the initials the live book actually contains ==');
{
  eq('the ordinary form',            _quoInitials('2026-386-KIM-APEX'), 'KIM');
  eq('with an item suffix',          _quoInitials('2026-391-KIM-APEX-CROSS WRENCH'), 'KIM');
  eq('lower case is normalised',     _quoInitials('2026-405-adm-hytec'), 'ADM');
  /* The four malformed live numbers. All are recoverable and all four MUST be read — a parser that
     skipped them would leave real deals attributed to the typist for ever. */
  eq('a missing dash after the year', _quoInitials('2026408-KIM-APEX'), 'KIM');
  eq('a space where a dash belongs',  _quoInitials('2026-396-GL BULACAN THERMAL'), 'GL');
  eq('underscores throughout',        _quoInitials('2026-191-ADM_SMGPH_HORIZONTAL BAND SAW REV0806'), 'ADM');
  eq('a revision baked into the initials',
     _quoInitials('2026-418-GLrev2-ABOITIZPOWERCORP-SNAPBU'), 'GL');
  eq('...and the simple revision form too', _quoInitials('2026-273-GLrev-ABOITIZ'), 'GL');
}
{
  eq('a system-minted number has none',  _quoInitials('QTN-202607-004'), '');
  eq('demo data has none',               _quoInitials('DEMO-QTN-001'), '');
  eq('a bare year-number has none',      _quoInitials('2026-374'), '');
  eq('blank is blank',                   _quoInitials(''), '');
  eq('null does not throw',              _quoInitials(null), '');
}

console.log('\n== the mapping, as the business stated it ==');
{
  const owner = (no) => _quoOwner({ 'Quotation No': no, 'Created By': 'Somebody Else' });
  eq('KIM  -> Kimberlyn', owner('2026-386-KIM-APEX'), 'Kimberlyn Blones');
  eq('KPB  -> Kimberlyn', owner('2026-401-KPB-CLIENT'), 'Kimberlyn Blones');
  eq('ADM  -> Crystal',   owner('2026-405-ADM-HYTEC'), 'Crystal Gayle');
  eq('NE   -> Crystal',   owner('2026-437-NE-SMGPH-SHAPING MACHINE'), 'Crystal Gayle');
  eq('NEIL -> Crystal',   owner('2026-404-NEIL-ECC-GENSET'), 'Crystal Gayle');
  eq('GL   -> Gerald',    owner('2026-384-GL-FCFMINERALS'), 'Gerald Lucena');
  eq('GLrev-> Gerald',    owner('2026-418-GLrev2-ABOITIZ'), 'Gerald Lucena');
}

console.log('\n== precedence: the column wins, then the number, then the typist ==');
{
  eq('a recorded salesperson beats the number',
     _quoOwner({ 'Quotation No': '2026-386-KIM-APEX', 'Salesperson': 'Gerald Lucena',
                 'Created By': 'Kimberlyn Blones' }), 'Gerald Lucena');
  eq('...which is what makes a correction on the sheet stick',
     _quoOwner({ 'Quotation No': '2026-405-ADM-HYTEC', 'Salesperson': 'Marc Khent Julian',
                 'Created By': 'Kimberlyn Blones' }), 'Marc Khent Julian');
  eq('with no column, the number decides',
     _quoOwner({ 'Quotation No': '2026-405-ADM-HYTEC', 'Created By': 'Kimberlyn Blones' }),
     'Crystal Gayle');
  eq('with neither, the typist is the honest answer',
     _quoOwner({ 'Quotation No': 'QTN-202607-004', 'Created By': 'Kimberlyn Blones' }),
     'Kimberlyn Blones');
  eq('initials nobody recognises fall back rather than inventing an owner',
     _quoOwner({ 'Quotation No': '2026-500-ZZZ-CLIENT', 'Created By': 'Kimberlyn Blones' }),
     'Kimberlyn Blones');
  eq('a blank column is not a value',
     _quoOwner({ 'Quotation No': 'QTN-202607-004', 'Salesperson': '   ',
                 'Created By': 'Kimberlyn Blones' }), 'Kimberlyn Blones');
}
{
  eq('the DTO shape works too, not just the sheet row',
     _quoOwner({ quotationNo: '2026-404-NEIL-ECC-GENSET', createdBy: 'Kimberlyn Blones' }),
     'Crystal Gayle');
  eq('nothing at all is empty, not a crash', _quoOwner({}), '');
  eq('null is empty', _quoOwner(null), '');
}

console.log('\n== the five real mismatches from the live book ==');
{
  /* These are the quotations whose attribution actually moves. The largest is ₱74.2M — the biggest
     deal in the pipeline, recorded against the wrong person until now. */
  const live = [
    ['2026-404-NEIL-ECC-GENSET',                'Kimberlyn Blones', 'Crystal Gayle'],
    ['2026-405-ADM-HYTEC',                      'Kimberlyn Blones', 'Crystal Gayle'],
    ['2026-407-ADM-THPAL-TORQUE WRENCH',        'Kimberlyn Blones', 'Crystal Gayle'],
    ['2026-408-ADM-PETRA CEMENT-UNINTERRUPTIBLE','Kimberlyn Blones', 'Crystal Gayle'],
    ['2026-273-GL-ABOITIZ POWER_HYDRAULIC PUMP REV1', 'Crystal Gayle', 'Gerald Lucena']
  ];
  live.forEach(([no, typist, owner]) => {
    eq('  ' + no.slice(0, 34), _quoOwner({ 'Quotation No': no, 'Created By': typist }), owner);
  });
}
{
  // And one that must NOT move: typed and owned by the same person.
  eq('a quotation someone filed for themselves does not move',
     _quoOwner({ 'Quotation No': '2026-406-KIM-ABOITIZ_TSI_BU_CUTTINGKIT',
                 'Created By': 'Kimberlyn Blones' }), 'Kimberlyn Blones');
}

/* ── A243 — CORRECTING AN OWNER THAT WAS RECORDED WRONGLY ──────────────────────────────────────
 *
 * The precedence above is what makes a correction on the sheet stick: a recorded Salesperson beats
 * the initials in the number. The flip side is that a WRONG recorded value is equally sticky, and
 * until A243 nothing in the app could change it — previewQuotationOwners skips any row that already
 * carries one ("a recorded owner is never touched", which is right for a backfill), and there was no
 * per-quotation setter, only the pricing-request twin.
 *
 * The live case: both rows numbered 2026-457 were typed by Kimberlyn Blones and carried the owner
 * "Neil", a bare first name matching no account. getQuotations scopes a rep's list by OWNER, so they
 * were invisible to every sales rep — including Neil Estur, whose account name is not "Neil" — and
 * visible only to oversight roles, which send no filter at all. Nothing warned anybody. */
console.log('\n== A243: a recorded owner is sticky, which is why it must be correctable ==');
{
  const SET = (() => {
    const a = SRC.indexOf('function setQuotationSalesperson(');
    let d = 0;
    for (let k = a; k < SRC.length; k++) {
      if (SRC[k] === '{') d++;
      else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(a, k + 1); }
    }
    return '';
  })();
  ok('setQuotationSalesperson exists at all', SET.length > 0);

  /* The bug, restated as an assertion: a recorded owner wins over the initials, so "Neil" on a
     -NE- numbered quotation stays "Neil" and no backfill will ever move it. */
  eq('a wrongly recorded owner beats the initials and the typist',
     _quoOwner({ 'Quotation No': '2026-457-NE-ECC-WELDING_OUTFIT',
                 'Created By': 'Kimberlyn Blones', 'Salesperson': 'Neil' }), 'Neil');
  eq('  clearing it falls back to the initials, not to the typist',
     _quoOwner({ 'Quotation No': '2026-457-NE-ECC-WELDING_OUTFIT',
                 'Created By': 'Kimberlyn Blones', 'Salesperson': '' }),
     _quoOwner({ 'Quotation No': '2026-457-NE-ECC-WELDING_OUTFIT', 'Created By': 'Kimberlyn Blones' }));

  // The guard is the same one its pricing-request twin uses: oversight only, role from the session.
  ['director', 'management', 'admin', 'accounting'].forEach(r =>
    ok('  ' + r + ' may reattribute', SET.includes("'" + r + "'")));
  ok('  a sales rep may not reattribute their own deal', !/'sales'/.test(SET));
  ok('  it refuses without a quotationNo', SET.includes('quotationNo required'));
  ok('  it refuses a quotation that does not exist', SET.includes('not found'));
  ok('  and it reports what the owner WAS, so a wrong correction can be undone',
     SET.includes('previous: was'));
}

/* ── A246 — A REP CAN FIND WHAT THEY TYPED ─────────────────────────────────────────────────────
 *
 * A218 scoped a rep's quotation list on the OWNER because filtering on 'Created By' hid their own
 * deals whenever somebody else typed one. Owner ALONE has the mirror fault, and it is just as bad:
 * A218's own measurement says one person typed 46 of 85 while owning 27, so ~19 quotations were
 * invisible to the only person who could correct them.
 *
 * It surfaced looking like a different bug. A rep could not find quotation 2026-457, retyped it, and
 * got "Quotation No already exists" with nothing explaining why she could not see a record she had
 * created herself — both rows carried an owner of "Neil", a bare first name matching no account, so
 * they belonged to nobody and showed for nobody.
 *
 * The scope is now owner OR creator. It exposes nothing new: a person gains sight only of rows they
 * typed. Attribution is untouched — the owner still decides whose tracker, whose commission, whose
 * number on the board. */
console.log('\n== A246: scoped to owner OR creator ==');
{
  const { load, call } = require('./gasload.js');
  const store = {
    Quotations: [
      { 'Quotation No': 'Q-OWN',  'Customer': 'A', 'Status': 'Draft', 'Total': 100,
        'Created By': 'Gerald Lucena',    'Salesperson': 'Kimberlyn Blones' },
      { 'Quotation No': 'Q-TYPED','Customer': 'B', 'Status': 'Draft', 'Total': 200,
        'Created By': 'Kimberlyn Blones', 'Salesperson': 'Crystal Gayle' },
      { 'Quotation No': 'Q-NEITHER','Customer': 'C', 'Status': 'Draft', 'Total': 300,
        'Created By': 'Gerald Lucena',    'Salesperson': 'Gerald Lucena' },
      /* The live shape that caused the report: typed by her, owned by a name that is nobody. */
      { 'Quotation No': '2026-457-NE-ECC-OUTFIT_CUTTING', 'Customer': 'EAGLE CEMENT',
        'Status': 'Pending Admin', 'Total': 27377.78,
        'Created By': 'Kimberlyn Blones', 'Salesperson': 'Neil' }
    ],
    QuotationItems: []
  };
  const ctx = load(null, store);
  const seen = call(ctx, 'getQuotations', { createdBy: 'Kimberlyn Blones' })
                 .data.map(q => q.quotationNo).sort();
  eq('she sees the one she OWNS', seen.includes('Q-OWN'), true);
  eq('  and the one she TYPED for somebody else', seen.includes('Q-TYPED'), true);
  eq('  and the one owned by a name that is nobody', seen.includes('2026-457-NE-ECC-OUTFIT_CUTTING'), true);
  eq('  but NOT one that is neither hers nor typed by her', seen.includes('Q-NEITHER'), false);

  // The owner's own view is unchanged — A218's fix still stands.
  const gl = call(ctx, 'getQuotations', { createdBy: 'Gerald Lucena' })
               .data.map(q => q.quotationNo).sort();
  eq('the other rep still sees his own deal', gl.includes('Q-NEITHER'), true);
  eq('  and the one he typed for her', gl.includes('Q-OWN'), true);
  eq('  but not hers that he never touched', gl.includes('Q-TYPED'), false);

  /* The clash message is the other half: when a number IS taken, say by whom and in what state,
     so a rep who cannot see it is not left guessing. */
  const clash = call(ctx, 'createQuotation', {
    quotationNo: '2026-457-NE-ECC-OUTFIT_CUTTING', customer: 'EAGLE CEMENT',
    items: JSON.stringify([{ itemName: 'x', qty: 1, price: 1 }]), createdBy: 'Kimberlyn Blones' });
  eq('a duplicate number is still refused', clash.success, false);
  ok('  and the message names the owner', /belongs to Neil/.test(clash.message || ''), clash.message);
  ok('  and the status', /Pending Admin/.test(clash.message || ''), clash.message);
  ok('  and says what to do instead', /edit it rather than creating a second/.test(clash.message || ''),
     clash.message);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
