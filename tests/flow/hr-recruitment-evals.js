/* A400 — the recruitment page's evaluation forms (dashboard/hr-recruitment.html + js/hr-recruitment.js).
 *
 * Run:  node tests/flow/hr-recruitment-evals.js
 *
 * Pinned here, with the real page script in a stub DOM:
 *   1. the candidate key from Created At, in both shapes Code.gs hands it over
 *   2. before FlowAPI 201 is pasted (the read refused) the table is exactly as it was: no Evaluation column
 *   3. HR: "N forms" on a candidate with forms, "+ Add form" on one without; admin: the count, else a dash
 *   4. the sheet: the forms (type, name, stage, who, when), the stage defaulting to the candidate's, the upload
 *      only for those who may add; a form filed under a key nobody has any more falls back to the same name
 *   5. upload: the payload; a wrong type or > 10 MB is refused inline, nothing sent
 *   6. archive with an Undo snackbar (no confirm); open a file in a window opened on the press
 *   7. the markup and the Apple-design CSS rules
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '../../dashboard/');
const JS = fs.readFileSync(D + 'js/hr-recruitment.js', 'utf8');
const HTML = fs.readFileSync(D + 'hr-recruitment.html', 'utf8');
const CSS = fs.readFileSync(D + 'css/hr-recruitment.css', 'utf8');

const CANDS = [
  { rowIndex: 2, candidateName: 'Juan Dela Cruz', position: 'Sales Engineer', stage: 'Initial Interview', dateApplied: '2026-05-06', assignedHR: 'Jiezzel', notes: '', createdAt: 'Wed May 06 2026 17:25:20 GMT+0800 (Philippine Standard Time)' },
  { rowIndex: 3, candidateName: 'Maria Santos', position: 'Accountant', stage: 'Final Interview', dateApplied: '2026-11-10', assignedHR: 'Jiezzel', notes: '', createdAt: '2026-11-10 09:30:11' },
  { rowIndex: 4, candidateName: 'Pedro Reyes', position: 'Driver', stage: 'Resume Screening', dateApplied: '2026-11-12', assignedHR: '', notes: '', createdAt: 'Thu Nov 12 2026 14:00:00 GMT+0800 (Philippine Standard Time)' },
  { rowIndex: 5, candidateName: 'No Date', position: 'X', stage: 'Job Posted', dateApplied: '', assignedHR: '', notes: '', createdAt: '' },
];
const FORMS = [
  { evalNo: 'CEV-1', candidateKey: 'C20260506172520', candidate: 'Juan Dela Cruz', stage: 'Initial Interview', fileName: 'juan-initial.pdf', fileType: 'application/pdf', uploadedBy: 'Jiezzel', uploadedAt: '2026-11-16T02:00:00.000Z', note: 'Panel' },
  { evalNo: 'CEV-2', candidateKey: 'C20260506172520', candidate: 'Juan Dela Cruz', stage: 'Final Interview', fileName: 'juan-final.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', uploadedBy: 'Larry', uploadedAt: '2026-11-16T03:00:00.000Z', note: '' },
  { evalNo: 'CEV-3', candidateKey: 'C20260101000000', candidate: 'pedro reyes', stage: 'Resume Screening', fileName: 'pedro.jpg', fileType: 'image/jpeg', uploadedBy: 'Jiezzel', uploadedAt: '2026-11-15T03:00:00.000Z', note: '' },
];

function page(role, evalReply) {
  const els = {}, sent = [], toasts = [], snacks = [], opened = [];
  const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: id === 'filterStage' ? '' : '', hidden: false, disabled: false, style: {}, dataset: {},
    className: '', classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle() {} },
    focus() { ctx.__focused = id; }, click() { ctx.__clicked = id; }, reset() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] });
  const ctx = {
    console, JSON, Math, Date, Promise, String, Number, Array, Object, Set, Uint8Array, URLSearchParams, isNaN, parseInt,
    setTimeout: (f) => { if (typeof f === 'function') f(); return 0; }, clearTimeout() {},
    localStorage: { getItem: (k) => k === 'session' ? JSON.stringify({ role, name: role === 'hr' ? 'Jiezzel Barrios' : 'Ana Admin', token: 't' }) : null, setItem() {}, removeItem() {} },
    document: { getElementById: el, addEventListener() {}, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {}, contains: () => true } },
    window: {}, location: { origin: 'http://localhost' }, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    requireHROrAdmin: () => ({ role, name: role === 'hr' ? 'Jiezzel Barrios' : 'Ana Admin' }), getSession: () => ({ role }), renderNavbar() {}, toggleForm() {}, clearApiCache() {},
    apiGetRecruitmentPipeline: async () => ({ success: true, data: CANDS }), apiGetRecruitmentStats: async () => ({ success: true, data: { total: 4, byStage: {} } }),
    flowClientRef: () => 'ref-1', fileToDataURL: async () => 'data:application/pdf;base64,aGVsbG8=', flowDownscaleImage: async () => 'data:image/jpeg;base64,aW1n',
    postFlow: async (a, p) => { sent.push({ a, p }); if (a === 'getCandidateEvals') return evalReply; if (a === 'getCandidateEvalFile') return { success: true, base64: 'aGVsbG8=', mimeType: 'application/pdf', fileName: 'x.pdf' };
      return { success: true, message: a === 'saveCandidateEval' ? 'Evaluation form added for ' + p.candidate + '.' : 'Archived.' }; },
  };
  ctx.window = ctx;
  ctx.window.open = () => { const w = { location: {}, close() { w.closed = true; } }; opened.push(w); return w; };
  ctx.window.hxToast = (t, o) => toasts.push([t, o && o.tone]);
  ctx.window.hxSnackbar = (t, o) => snacks.push([t, o]);
  vm.createContext(ctx);
  require('./hxutil').load(ctx);
  vm.runInContext(JS + '\nthis.__t = { key: recCandKey, load: loadPipeline, loadEvals: loadEvals, render: renderTable, open: openEvalForms, close: closeEvalForms, upload: uploadEvalForm, archive: archiveEvalForm, openFile: openEvalFile, problem: evalFileProblem, formsFor: evalFormsFor, get ready() { return evalReady; } };', ctx);
  return { ctx, T: ctx.__t, els, el, sent, toasts, snacks, opened };
}
const READY = { success: true, data: FORMS, stages: ['Job Posted', 'Resume Screening', 'Initial Interview', 'Final Interview', 'Job Offer', 'Onboarding', 'Complete'], may: { edit: true } };

(async () => {
  sec('1 · the candidate key');
  const { T } = page('hr', READY);
  eq('"Wed May 06 2026 17:25:20 GMT+0800 (…)"', T.key('Wed May 06 2026 17:25:20 GMT+0800 (Philippine Standard Time)'), 'C20260506172520');
  eq('the same without a zone (Philippine time)', T.key('Wed May 06 2026 17:25:20'), 'C20260506172520');
  eq('"2026-05-06 17:25:20"', T.key('2026-05-06 17:25:20'), 'C20260506172520');
  eq('an ISO time in UTC', T.key('2026-05-06T09:25:20.000Z'), 'C20260506172520');
  eq('another zone is turned into Philippine time', T.key('Wed May 06 2026 11:25:20 GMT+0200'), 'C20260506172520');
  eq('blank', T.key(''), '');
  eq('junk', T.key('not a date'), '');

  sec('2 · before FlowAPI 201: the table as it was');
  {
    const p = page('hr', { success: false, message: 'Unknown action: getCandidateEvals' });
    await p.T.load(); await p.T.loadEvals();
    const h = p.el('recContainer').innerHTML;
    ok('no Evaluation column, no chip', !/Evaluation<\/th>/.test(h) && !/rec-eval-chip/.test(h) && /<th>Assigned HR<\/th><th>Actions<\/th>/.test(h), h.slice(0, 300));
    ok('  and the read was the secured one', p.sent[0].a === 'getCandidateEvals');
  }

  sec('3 · the Evaluation column');
  {
    const p = page('hr', READY);
    await p.T.load(); await p.T.loadEvals();
    const h = p.el('recContainer').innerHTML;
    ok('the column is there', /<th>Assigned HR<\/th><th>Evaluation<\/th><th>Actions<\/th>/.test(h));
    ok('Juan: "2 forms"', /onclick="openEvalForms\(2, this\)"[^>]*>.*?2 forms<\/button>/.test(h), h);
    ok('Maria (none yet): "+ Add form" for HR', /class="rec-eval-chip add" onclick="openEvalForms\(3, this\)"[^>]*>\+ Add form<\/button>/.test(h));
    ok('Pedro: the form filed under an old key, found by his name', /onclick="openEvalForms\(4, this\)"[^>]*>.*?1 form<\/button>/.test(h));
    ok('a candidate with no date added: a dash, no button', !/openEvalForms\(5,/.test(h));
    ok('the chips are named for screen readers', /aria-label="2 evaluation forms for Juan Dela Cruz"/.test(h) && /aria-label="Add an evaluation form for Maria Santos"/.test(h));
    const a = page('admin', Object.assign({}, READY, { may: { edit: false } }));
    await a.T.load(); await a.T.loadEvals();
    const ha = a.el('recContainer').innerHTML;
    ok('admin: the count, but no "+ Add form"', /2 forms/.test(ha) && !/Add form/.test(ha));
  }

  sec('4 · the sheet');
  {
    const p = page('hr', READY);
    await p.T.load(); await p.T.loadEvals();
    p.T.open(2, { focus() {} });
    ok('it opens', p.el('evalModal').classList.contains('open'));
    eq('titled with the candidate', p.el('evalTitle').textContent, 'Evaluation forms — Juan Dela Cruz');
    eq('  position and stage underneath', p.el('evalSub').textContent, 'Sales Engineer · Initial Interview');
    const L = p.el('evalList').innerHTML;
    ok('both forms, as Settings rows: type, name, stage, who', (L.match(/class="rec-eval-item"/g) || []).length === 2 && />PDF</.test(L) && />DOC</.test(L) &&
       /juan-initial\.pdf/.test(L) && /Initial Interview · added 16 Nov 2026 by Jiezzel · Panel/.test(L), L);
    ok('  HR can archive each', (L.match(/archiveEvalForm\(/g) || []).length === 2);
    ok('the stage list defaults to the candidate\'s stage', /<option selected>Initial Interview<\/option>/.test(p.el('evalStage').innerHTML));
    ok('the upload is shown to HR', p.el('evalAdd').hidden === false && p.el('evalEmpty').hidden === true);
    ok('focus goes into the sheet', p.ctx.__focused === 'evalPick');
    p.T.close();
    ok('it closes', !p.el('evalModal').classList.contains('open'));
    p.T.open(3, { focus() {} });
    ok('Maria: the empty state says what to do', p.el('evalEmpty').hidden === false && /Upload the one filled in after the interview/.test(p.el('evalEmpty').textContent));
    const a = page('admin', Object.assign({}, READY, { may: { edit: false } }));
    await a.T.load(); await a.T.loadEvals();
    a.T.open(2, { focus() {} });
    ok('admin: the forms, no upload, no archive', a.el('evalAdd').hidden === true && !/archiveEvalForm/.test(a.el('evalList').innerHTML) && a.ctx.__focused === 'evalClose');
  }

  sec('5 · upload');
  {
    const p = page('hr', READY);
    await p.T.load(); await p.T.loadEvals();
    p.T.open(3, { focus() {} });
    p.el('evalStage').value = 'Final Interview'; p.el('evalNote').value = '  with Larry ';
    const inp = { value: 'x', files: [{ name: 'maria-final.pdf', type: 'application/pdf', size: 2048 }] };
    await p.T.upload(inp);
    const s = p.sent.find(x => x.a === 'saveCandidateEval');
    ok('the form goes up under Maria\'s key, with her name, position, stage and note', s && s.p.candidateKey === 'C20261110093011' && s.p.candidate === 'Maria Santos' &&
       s.p.position === 'Accountant' && s.p.stage === 'Final Interview' && s.p.note === 'with Larry' && s.p.mimeType === 'application/pdf' && s.p.fileName === 'maria-final.pdf' &&
       s.p.fileBase64 === 'aGVsbG8=' && s.p.clientRef === 'ref-1', s && s.p);
    ok('  a toast says so and the list is read again', p.toasts.some(t => /Evaluation form added for Maria Santos/.test(t[0])) && p.sent.filter(x => x.a === 'getCandidateEvals').length === 2);
    ok('  the input is cleared, the button is back', inp.value === '' && p.el('evalPick').disabled === false);
    const n = p.sent.length;
    await p.T.upload({ value: 'x', files: [{ name: 'evil.html', type: 'text/html', size: 10 }] });
    ok('an HTML file is refused inline, nothing sent', p.sent.length === n && /Upload a PDF/.test(p.el('evalMsg').innerHTML));
    await p.T.upload({ value: 'x', files: [{ name: 'big.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 }] });
    ok('over 10 MB is refused inline, nothing sent', p.sent.length === n && /under 10 MB/.test(p.el('evalMsg').innerHTML));
    await p.T.upload({ value: 'x', files: [{ name: 'photo.png', type: 'image/png', size: 4000 }] });
    const img = p.sent.filter(x => x.a === 'saveCandidateEval').pop();
    ok('a photo is shrunk and sent as a JPEG', img.p.mimeType === 'image/jpeg' && img.p.fileName === 'photo.jpg' && img.p.fileBase64 === 'aW1n', img.p);
  }

  sec('6 · archive with an Undo; opening a form');
  {
    const p = page('hr', READY);
    await p.T.load(); await p.T.loadEvals();
    await p.T.archive('CEV-1', false);
    ok('archive is one press: no confirm, the archive call', p.sent.some(x => x.a === 'archiveCandidateEval' && x.p.evalNo === 'CEV-1' && x.p.restore === false));
    ok('  with an Undo snackbar', p.snacks.length === 1 && /archived/.test(p.snacks[0][0]) && p.snacks[0][1].action === 'Undo');
    await p.snacks[0][1].onAction();
    ok('  the Undo restores it', p.sent.some(x => x.a === 'archiveCandidateEval' && x.p.evalNo === 'CEV-1' && x.p.restore === true));
    ok('no confirm() anywhere in the evaluation code', !/confirm\(/.test(JS.slice(JS.indexOf('A400 — evaluation forms'))));
    await p.T.openFile('CEV-1');
    ok('a form opens in a window opened on the press', p.opened.length === 1 && p.opened[0].location.href === 'blob:x' && p.sent.some(x => x.a === 'getCandidateEvalFile' && x.p.evalNo === 'CEV-1'));
  }

  sec('7 · markup and the Apple-design rules');
  ok('flow-api.js loads before the page script', HTML.indexOf('<script src="js/flow-api.js">') > 0 && HTML.indexOf('<script src="js/flow-api.js">') < HTML.indexOf('<script src="js/hr-recruitment.js">'));
  ok('the sheet is a dialog, labelled by its title', /class="modal rec-eval" role="dialog" aria-modal="true" aria-labelledby="evalTitle"/.test(HTML));
  ok('it is the shared .modal-overlay (a bottom sheet on phones)', /<div class="modal-overlay" id="evalModal"/.test(HTML));
  ok('upload progress is announced', /id="evalMsg" aria-live="polite"/.test(HTML));
  ok('the file picker is a real button (keyboard reachable)', /<button type="button" class="btn btn-primary rec-eval-btn" id="evalPick"/.test(HTML));
  ok('the styles are their own file, linked after styles.css (the page\'s inline style does not grow)', /<link rel="stylesheet" href="css\/styles\.css">\n  <link rel="stylesheet" href="css\/hr-recruitment\.css">/.test(HTML) && !/rec-eval-chip/.test(HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'))));
  ok('press feedback: scale .97 over 100 ms', /\.rec-eval-chip:active, \.rec-eval-btn:active, \.rec-eval-file:active \{ transform: scale\(0\.97\); \}/.test(CSS) && /transition: transform 100ms ease-out/.test(CSS));
  ok('reduced motion and more contrast are handled', /@media \(prefers-reduced-motion: reduce\) \{ \.rec-eval-chip/.test(CSS) && /@media \(prefers-contrast: more\) \{ \.rec-eval-chip/.test(CSS));
  ok('tokens only (no hex colours in the A400 styles)', !/#[0-9a-fA-F]{3,6}\b/.test(CSS));
  ok('no invalid "font: … inherit" shorthand', !/font: [0-9]{3} [^;]*inherit;/.test(CSS));
  ok('Escape closes the sheet', /e\.key === 'Escape' && evalOpenKey\) closeEvalForms\(\)/.test(JS));

  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
