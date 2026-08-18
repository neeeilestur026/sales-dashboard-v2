/* A243 — THE REGISTRATION AUDIT, over the WHOLE action surface.
 *
 * Run:  node tests/audit/registration.js
 *
 * WHY THIS FILE EXISTS. An action in this system has to be registered in up to five separate places,
 * and each one buys it something different:
 *
 *   HANDLERS      — reachability. _dispatch refuses anything not here. The only MANDATORY list.
 *   MUTATIONS     — the script lock, AND the only branch from which _logActivity is ever called.
 *   _MODULE_MAP   — the audit row in ActivityLog, which the Accounting Daily Report reads.
 *   _SECURED      — the write must arrive through Flask, which stamps the caller's REAL role.
 *   _COMM_ACTIONS — the commission rollout hold.
 *
 * Every registration assertion that existed before this file was scoped to the two or three actions
 * its own A-number happened to touch. Nothing walked the surface, so an action could be added to
 * four lists and missed off the fifth and no test anywhere would notice — which is exactly what had
 * happened by the time this was written:
 *
 *   • reverseReceiving — in HANDLERS, _SECURED and _MODULE_MAP, but NOT in MUTATIONS. It unwinds
 *     COGS and inventory with no script lock, and because _logActivity is only reached from inside
 *     the MUTATIONS branch, the audit row it declares can never be written. Both consequences were
 *     invisible: nothing fails, the money just moves unserialised and unlogged.
 *   • eight more writers that take the lock but leave no audit trail, two of them on money.
 *
 * The point of this file is that the NEXT such omission fails here instead of shipping. Anything
 * deliberately absent from a list must say so in EXCEPTIONS below, with its reason — an undocumented
 * gap is a failure, and "documented" means a human wrote down why.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GAS = fs.readFileSync(path.join(ROOT, 'apps-script/FlowAPI.gs'), 'utf8');

let FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) console.log('  ok   ' + label);
  else { FAIL++; console.log('  FAIL ' + label + (extra === undefined ? '' : '\n         ' + extra)); }
};

/* ── lifting the five lists ────────────────────────────────────────────────────────────────────
   Brace-balanced, the same technique tests/flow/pr-owner.js:280-289 uses. Comments are interleaved
   through every one of these declarations, so strip them before extracting names — otherwise a
   commented-out entry reads as a live registration. */
function listOf(name) {
  const s = GAS.indexOf('var ' + name + ' = {');
  if (s < 0) throw new Error('no ' + name + ' in FlowAPI.gs');
  let d = 0;
  for (let k = s; k < GAS.length; k++) {
    if (GAS[k] === '{') d++;
    else if (GAS[k] === '}') { d--; if (!d) return GAS.slice(s, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const keysOf = name => {
  const body = strip(listOf(name));
  const out = new Set();
  const re = /(^|[\s{,])([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = re.exec(body))) out.add(m[2]);
  return out;
};

const HANDLERS = keysOf('HANDLERS');
const MUTATIONS = keysOf('MUTATIONS');
const MODULE_MAP = keysOf('_MODULE_MAP');
const SECURED = keysOf('_SECURED');
const COMM = keysOf('_COMM_ACTIONS');

console.log('== the five lists were lifted ==');
[['HANDLERS', HANDLERS, 150], ['MUTATIONS', MUTATIONS, 100], ['_MODULE_MAP', MODULE_MAP, 100],
 ['_SECURED', SECURED, 40], ['_COMM_ACTIONS', COMM, 10]]
  .forEach(([n, s, floor]) => ok(n + ' parsed (' + s.size + ' entries)', s.size >= floor,
                                'only ' + s.size + ' — the parser probably broke, not the code'));

/* ── DELIBERATE EXCEPTIONS ─────────────────────────────────────────────────────────────────────
   Every entry needs a reason a person wrote. This is the whole mechanism by which an intentional
   gap stays distinguishable from an oversight. */
const EXCEPTIONS = {
  noAuditRow: {                       // in MUTATIONS, deliberately absent from _MODULE_MAP
    saveDailyNote:      '_dispatch excludes it by name — the note IS the daily report, not an event in it',
    submitDailyReport:  'documented at FlowAPI.gs — the report is the log, logging it would be circular',
    savePfInquiry:      'documented at FlowAPI.gs — a Product Finder inquiry is not a daily-report task'
  },
  noLock: {                           // in _MODULE_MAP or _SECURED, deliberately absent from MUTATIONS
    previewReceivingReversal:      'a preview: reads and reports, writes nothing, so it takes no lock',
    previewOtherPaymentExpenses:   'a preview: reads and reports, writes nothing, so it takes no lock',
    previewDriveMigration:         'a preview',
    previewDriveMigrationReport:   'a preview',
    verifyDriveIntegrity:          'a read-only integrity report',
    previewAPAgingAnomalies:       'a read-only sweep',
    previewQuotationSentAt:        'a preview — pinned as writing nothing by quotation-backfill.js',
    previewCommissionAttribution:  'A239 — a read-only diagnostic',
    previewCommissionOwnerShift:   'a preview',
    previewQuotationOwners:        'a preview',
    previewPricingRequestOwners:   'a preview — pinned by pr-owner.js',
    previewReceivingReversalReport:'a preview',
    getCommissionRequests:         'A207 — a secured READ, deliberately; reads take no lock',
    getCommissionClaimable:        'A207 — a secured READ, deliberately',
    getCommissionPreview:          'a secured READ',
    getTravelReplenishments:       'A212 — a secured READ, deliberately',
    getTravelReceipts:             'A214 — a secured READ, deliberately',
    getTravelFloats:               'A212 — a secured READ; travel-money.js pins it out of MUTATIONS',
    getCommissionPayoutReport:     'a secured READ',
    auditCommissionIntegrity:      'a read-only audit',
    getSODocCompliance:            'a read',
    getDocComplianceReport:        'a read'
  }
};

/* ── 1 · HANDLERS is the universe ──────────────────────────────────────────────────────────── */
console.log('\n== every other list is a subset of HANDLERS ==');
[['MUTATIONS', MUTATIONS], ['_MODULE_MAP', MODULE_MAP], ['_SECURED', SECURED], ['_COMM_ACTIONS', COMM]]
  .forEach(([n, s]) => {
    const orphans = [...s].filter(a => !HANDLERS.has(a));
    ok(n + ' ⊆ HANDLERS', orphans.length === 0,
       'unreachable — registered but _dispatch has no handler: ' + orphans.join(', '));
  });

/* ── 2 · THE DEFECT THIS FILE WAS WRITTEN FOR ──────────────────────────────────────────────────
   _logActivity is called ONLY from inside the MUTATIONS branch of _dispatch. An action carrying a
   _MODULE_MAP row but no MUTATIONS membership has declared an audit row that can never be written —
   and, far worse, is a writer running with no script lock. */
console.log('\n== an audit row is only reachable from inside the MUTATIONS branch ==');
{
  const dead = [...MODULE_MAP].filter(a => !MUTATIONS.has(a) && !EXCEPTIONS.noLock[a]);
  ok('_MODULE_MAP ⊆ MUTATIONS (or documented)', dead.length === 0,
     'declares an audit row that can NEVER be written, and takes no lock: ' + dead.join(', '));
}

/* ── 3 · every secured writer takes the lock ───────────────────────────────────────────────────
   _SECURED means "this decides or moves money". Anything in it that is not a documented read must
   be serialised, or two approvals can interleave on the same row. */
console.log('\n== every _SECURED action either takes the lock or is a documented read ==');
{
  const unlocked = [...SECURED].filter(a => !MUTATIONS.has(a) && !EXCEPTIONS.noLock[a]);
  ok('_SECURED writers ⊆ MUTATIONS (or documented)', unlocked.length === 0,
     'moves money with NO script lock: ' + unlocked.join(', '));
}

/* ── 4 · every writer leaves a trail ───────────────────────────────────────────────────────────
   The Accounting Daily Report is built from ActivityLog. A writer with no row is a change nobody
   can see afterwards. */
console.log('\n== every writer leaves an audit row, or says why not ==');
{
  const silent = [...MUTATIONS].filter(a => !MODULE_MAP.has(a) && !EXCEPTIONS.noAuditRow[a]);
  ok('MUTATIONS ⊆ _MODULE_MAP (or documented)', silent.length === 0,
     'writes with no audit row and no stated reason: ' + silent.join(', '));
}

/* ── 5 · the three _SECURED mirrors ────────────────────────────────────────────────────────────
   FlowAPI.gs decides, blueprints/flow.py enforces, flow-api.js routes. If the client's copy omits
   an action the other two secure, the POST goes direct and the server rejects it — the feature
   simply stops working, with no clue why. travel-receipts.js already compares these, but with a
   [A-Za-z]+ name pattern that silently drops any action containing a digit or underscore. Widened. */
console.log('\n== the three _SECURED copies agree ==');
{
  const py = fs.readFileSync(path.join(ROOT, 'blueprints/flow.py'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'dashboard/js/flow-api.js'), 'utf8');
  const pyBlock = (py.match(/SECURED_ACTIONS\s*=\s*\[([\s\S]*?)\n\]/) || [])[1];
  const jsBlock = (js.match(/FLOW_SECURED_ACTIONS\s*=\s*\[([\s\S]*?)\n\]/) || [])[1];
  ok('both mirrors were found', !!pyBlock && !!jsBlock);
  const names = (block, com) => new Set(
    (block || '').split('\n').map(l => l.replace(com, '')).join(' ')
      .match(/['"]([A-Za-z_$][\w$]*)['"]/g)?.map(s => s.slice(1, -1)) || []);
  const P = names(pyBlock, /#.*$/), J = names(jsBlock, /\/\/.*$/);
  const diff = (a, b) => [...a].filter(x => !b.has(x));
  ok('FlowAPI.gs vs blueprints/flow.py', diff(SECURED, P).length === 0 && diff(P, SECURED).length === 0,
     'only in .gs: [' + diff(SECURED, P) + ']  only in .py: [' + diff(P, SECURED) + ']');
  ok('FlowAPI.gs vs dashboard/js/flow-api.js', diff(SECURED, J).length === 0 && diff(J, SECURED).length === 0,
     'only in .gs: [' + diff(SECURED, J) + ']  only in .js: [' + diff(J, SECURED) + ']');
}

/* ── 6 · every action the browser calls actually exists ────────────────────────────────────────
   Three call shapes, and missing any one of them makes this check lie. The plain literal is the
   easy 134; the ternary form hides 7 more (a naive scan reports those as unused handlers); and 15
   sites pass `action` as a PARAMETER, so their literals live at the caller of a small local helper
   and only a second pass over the helper name finds them. */
console.log('\n== every action the browser can call resolves in HANDLERS ==');
{
  const dir = path.join(ROOT, 'dashboard');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name === 'js') walk(p); }
      else if (e.name.endsWith('.js') || e.name.endsWith('.html')) files.push(p);
    }
  })(dir);
  const src = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');

  const called = new Set();
  const add = re => { let m; while ((m = re.exec(src))) { for (let i = 1; i < m.length; i++) if (m[i]) called.add(m[i]); } };
  add(/\b(?:postFlow|fetchFlow)\(\s*['"]([A-Za-z_$][\w$]*)['"]/g);                       // literal
  add(/\b(?:postFlow|fetchFlow)\(\s*[\w$.]+\s*\?\s*['"]([A-Za-z_$][\w$]*)['"]\s*:\s*['"]([A-Za-z_$][\w$]*)['"]/g); // ternary
  // the dynamic-dispatch helpers: their first argument is the action name
  ['_qAction', '_poAction', '_prAct', 'tvAct', 'daApprove', 'daReject', 'mfApprove', 'mfReject',
   'miDecide', 'llBackfill', 'grab'].forEach(h =>
    add(new RegExp('\\b' + h + '\\(\\s*[\'"]([A-Za-z_$][\\w$]*)[\'"]', 'g')));
  add(/generateFlowPdf\([^,]+,[^,]+,\s*['"]([A-Za-z_$][\w$]*)['"]/g);
  /* quotation-board-model.js drives its moves from a table of `action: 'X'` literals. That key shape
     is ALSO the legacy Code.gs call form used all over api.js, and Code.gs has its own switch-based
     registry that this audit deliberately does not cover — so read it from that one file only,
     rather than sweeping `action:` everywhere and reporting 170 legacy actions as broken. */
  {
    const board = fs.readFileSync(path.join(dir, 'js/quotation-board-model.js'), 'utf8');
    let m; const re = /action:\s*['"]([A-Za-z_$][\w$]*)['"]/g;
    while ((m = re.exec(board))) called.add(m[1]);
  }

  const unknown = [...called].filter(a => !HANDLERS.has(a));
  console.log('     Flow action names seen: ' + called.size +
              ' · resolved in HANDLERS: ' + (called.size - unknown.length));
  ok('every action the browser sends to the Flow backend resolves in HANDLERS', unknown.length === 0,
     '_dispatch would answer "Unknown action" for: ' + unknown.join(', '));
}

console.log('\n' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
