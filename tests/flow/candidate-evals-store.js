/* A400 — recruitment evaluation forms (FlowAPI 201: getCandidateEvals, saveCandidateEval, archiveCandidateEval,
 * getCandidateEvalFile).
 *
 * Run:  node tests/flow/candidate-evals-store.js
 *
 * Neil, 16 Nov 2026: "an option to upload evaluation form under the recruitment" on the HR dashboard. Runs the real
 * FlowAPI.gs through its dispatcher (gasload), "today" 16 Nov 2026. Pinned here:
 *   1. the version, who sees the forms (hr, admin, management, director) and who adds them (hr, management); the
 *      reads are secured; a read creates no tab; FlowSettings switch and role lists
 *   2. a form: a private Drive file under _Internal/Recruitment evaluations/<candidate>, never shared, never on the
 *      Documents register; the candidate's key, name, position, stage; the allow-list, 10 MB, a bad key or stage
 *   3. a retry with the same Client Ref is answered once; several forms per candidate
 *   4. archive takes it off the list (kept in the sheet and Drive) and restore puts it back; an archived form is not served
 *   5. the file read checks the type again, and a file gone from Drive is said so
 *   6. no Script Property; every action registered
 */
const { load, call } = require('./gasload');
const fs = require('fs');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const SRC = fs.readFileSync(GS, 'utf8');
const who = (role, name, user) => ({ actorRole: role, actorName: name, actorUsername: user });
const NEIL = who('director', 'Neil Estur', 'neil'), LARRY = who('management', 'Larry Estur', 'mgmt'), ANA = who('admin', 'Ana Admin', 'admin1');
const HR = who('hr', 'Jiezzel Barrios', 'hr1'), KIM = who('sales', 'Kimberlyn Blones', 'sales1'), ACCT = who('accounting', 'Acct', 'acct1');
const KEY = 'C20260506172520', KEY2 = 'C20261110093011';

function world() {
  const store = { FlowSettings: [] };
  const c = load(GS, store);
  c._now = () => new Date(2026, 10, 16, 10);
  const drive = { made: 0, shared: 0, folders: [], blobs: [] };
  const fold = (name) => ({ getName: () => name, getId: () => 'f-' + name, getFoldersByName: () => ({ hasNext: () => false }),
    createFolder: (n) => { drive.folders.push(n); return fold(n); },
    createFile: (blob) => { drive.made++; drive.blobs.push(blob); const id = 'file-ev-' + drive.made;
      return { getId: () => id, getUrl: () => 'https://drive.test/x', setSharing: () => { drive.shared++; } }; } });
  c.DriveApp.getFolderById = () => fold('root'); c.DriveApp.getRootFolder = () => fold('root');
  c.DriveApp.getFileById = (id) => { if (id === 'gone') throw new Error('No item with the given ID'); return { getBlob: () => ({ getContentType: () => 'application/pdf', getBytes: () => [1, 2, 3] }) }; };
  return { c, store, drive };
}
const add = (c, o, a) => call(c, 'saveCandidateEval', Object.assign({ candidateKey: KEY, candidate: 'Juan Dela Cruz', position: 'Sales Engineer', stage: 'Initial Interview',
  fileBase64: 'aGVsbG8gd29ybGQ=', fileName: 'Juan - initial interview.pdf', mimeType: 'application/pdf' }, o || {}, a || HR));
const list = (c, a) => call(c, 'getCandidateEvals', a || HR);

sec('1 · the version, and who may see and add forms');
{
  const { c, store } = world();
  ok('getVersion = 201', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 201);
  [HR, ANA, LARRY, NEIL].forEach(a => ok(a.actorRole + ' sees the forms', list(c, a).success));
  [KIM, ACCT, who('marketing', 'M', 'm1'), who('leadgen', 'L', 'l1'), who('warehouse', 'W', 'w1')].forEach(a => ok(a.actorRole + ' is refused', !list(c, a).success));
  ok('the read is secured (no secret, no answer)', !call(c, 'getCandidateEvals', Object.assign({ flowSecret: '' }, HR)).success);
  ok('a read creates no tab', !('CandidateEvals' in store));
  ok('HR may add; management too', list(c, HR).may.edit === true && list(c, LARRY).may.edit === true);
  ok('admin and the director only read', list(c, ANA).may.edit === false && list(c, NEIL).may.edit === false);
  ok('the stages come with the read', list(c).stages.join('|') === 'Job Posted|Resume Screening|Initial Interview|Final Interview|Job Offer|Onboarding|Complete');
  ok('admin may not add', /Only hr, management/.test(add(c, {}, ANA).message));
  ok('the director may not add either', !add(c, {}, NEIL).success);
  ok('a sales login may not add', !add(c, {}, KIM).success);
  ok('no name, no save', /Sign in again/.test(add(c, {}, who('hr', '', 'hr1')).message));
  const w2 = world(); w2.store.FlowSettings = [{ 'Key': 'candidateEvals', 'Value': 'off' }];
  ok('FlowSettings candidateEvals off closes it', /switched off/.test(list(w2.c).message) && /switched off/.test(add(w2.c).message));
  const w3 = world(); w3.store.FlowSettings = [{ 'Key': 'candidateEvalRoles', 'Value': 'hr' }, { 'Key': 'candidateEvalEditRoles', 'Value': 'hr' }];
  ok('the role lists come from FlowSettings', list(w3.c, HR).success && !list(w3.c, ANA).success && !add(w3.c, {}, LARRY).success);
}

sec('2 · a form is a private Drive file under the candidate');
{
  const { c, store, drive } = world();
  const r = add(c, { clientRef: 'r1', note: 'Panel: Larry and Jiezzel' });
  ok('HR adds Juan\'s initial-interview form', r.success && store.CandidateEvals.length === 1 && /Juan Dela Cruz/.test(r.message), r);
  const row = store.CandidateEvals[0];
  ok('  the row: key, name, position, stage, file, type, size, note, who and when',
     row['Candidate Key'] === KEY && row['Candidate'] === 'Juan Dela Cruz' && row['Position'] === 'Sales Engineer' && row['Stage'] === 'Initial Interview' &&
     row['File ID'] === 'file-ev-1' && row['File Name'] === 'Juan - initial interview.pdf' && row['File Type'] === 'application/pdf' && row['File Size'] > 0 &&
     row['Note'] === 'Panel: Larry and Jiezzel' && row['Uploaded By'] === 'Jiezzel Barrios' && !!row['Uploaded At'] && /^CEV-\d{14}-/.test(row['Eval No']), row);
  ok('  filed under _Internal / Recruitment evaluations / Juan Dela Cruz', drive.folders.join(' / ').indexOf('_Internal / Recruitment evaluations / Juan Dela Cruz') >= 0, drive.folders);
  ok('  never shared', drive.shared === 0 && !/setSharing\(/.test(SRC.slice(SRC.indexOf('function saveCandidateEval('), SRC.indexOf('function archiveCandidateEval('))));
  ok('  not on the Documents register', !('Documents' in store) || store.Documents.length === 0);
  ok('  the reply carries the form, never the Drive id', r.form && r.form.evalNo === row['Eval No'] && !/file-ev-1/.test(JSON.stringify(r)), r.form);
  const l = list(c);
  ok('the list shows it, without the Drive id', l.data.length === 1 && l.data[0].candidateKey === KEY && l.data[0].stage === 'Initial Interview' && !/file-ev-1/.test(JSON.stringify(l)), l.data);
  ok('a slash in the name cannot make a folder path', (() => { add(c, { candidate: 'Ana/Reyes', candidateKey: KEY2 }); return drive.folders.indexOf('Ana-Reyes') >= 0; })(), drive.folders);
  ok('a bad key is refused', /could not be identified/.test(add(c, { candidateKey: '5' }).message) && /could not be identified/.test(add(c, { candidateKey: '' }).message));
  ok('no name is refused', /Say which candidate/.test(add(c, { candidate: '' }).message));
  ok('a stage not on the list is refused', /Pick one of the stages/.test(add(c, { stage: 'Coffee chat' }).message));
  ok('no stage is allowed (left blank)', add(c, { stage: '' }).success);
  ok('no file is refused', /Choose the evaluation form/.test(add(c, { fileBase64: '' }).message));
  ok('an HTML file is refused', /Add a PDF/.test(add(c, { mimeType: 'text/html', fileName: 'x.html' }).message));
  ok('an SVG is refused', /Add a PDF/.test(add(c, { mimeType: 'image/svg+xml', fileName: 'x.svg' }).message));
  ok('a Word file is fine', add(c, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'eval.docx' }).success);
  ok('a photo of the form is fine', add(c, { mimeType: 'image/jpeg', fileName: 'eval.jpg' }).success);
  ok('over 10 MB is refused', /under 10 MB/.test(add(c, { fileBase64: 'A'.repeat(14000001) }).message));
  ok('a name like =HYPERLINK( is stored as text', (() => { add(c, { candidate: '=HYPERLINK("x")', candidateKey: KEY2 }); return !/^=/.test(String(store.CandidateEvals[store.CandidateEvals.length - 1]['Candidate'])); })());
}

sec('3 · a retry is answered once; several forms per candidate');
{
  const { c, store, drive } = world();
  add(c, { clientRef: 'same' });
  const again = add(c, { clientRef: 'same' });
  ok('the same Client Ref is answered once, no second file', again.success && again.duplicate === true && store.CandidateEvals.length === 1 && drive.made === 1, again);
  add(c, { stage: 'Final Interview', fileName: 'final.pdf', clientRef: 'f2' }, LARRY);
  add(c, { candidateKey: KEY2, candidate: 'Maria Santos', clientRef: 'm1' });
  const l = list(c);
  ok('Juan has two forms (HR\'s and management\'s), Maria one', l.data.filter(f => f.candidateKey === KEY).length === 2 && l.data.filter(f => f.candidateKey === KEY2).length === 1);
  ok('oldest first', l.data[0].fileName === 'Juan - initial interview.pdf');
}

sec('4 · archive, and the Undo');
{
  const { c, store, drive } = world();
  const f = add(c).form;
  ok('admin may not archive', !call(c, 'archiveCandidateEval', Object.assign({ evalNo: f.evalNo }, ANA)).success);
  const a = call(c, 'archiveCandidateEval', Object.assign({ evalNo: f.evalNo }, HR));
  ok('HR archives it: off the list, kept in the sheet', a.success && list(c).data.length === 0 && store.CandidateEvals.length === 1 &&
     store.CandidateEvals[0]['Archived By'] === 'Jiezzel Barrios' && !!store.CandidateEvals[0]['Archived At'], a);
  ok('  and in Drive (nothing removed)', drive.made === 1 && !/setTrashed|\.remove\(/.test(SRC.slice(SRC.indexOf('function archiveCandidateEval('), SRC.indexOf('function getCandidateEvalFile('))));
  ok('  an archived form is not served', !call(c, 'getCandidateEvalFile', Object.assign({ evalNo: f.evalNo }, HR)).success);
  ok('  archiving twice says so', /archived already/.test(call(c, 'archiveCandidateEval', Object.assign({ evalNo: f.evalNo }, HR)).message));
  const u = call(c, 'archiveCandidateEval', Object.assign({ evalNo: f.evalNo, restore: true }, LARRY));
  ok('the Undo puts it back', u.success && list(c).data.length === 1 && !store.CandidateEvals[0]['Archived At'], u);
  ok('  restoring one that is not archived says so', /not archived/.test(call(c, 'archiveCandidateEval', Object.assign({ evalNo: f.evalNo, restore: true }, HR)).message));
  ok('an unknown form says so', /not found/.test(call(c, 'archiveCandidateEval', Object.assign({ evalNo: 'CEV-x' }, HR)).message));
}

sec('5 · opening a form');
{
  const { c, store } = world();
  const f = add(c).form;
  const got = call(c, 'getCandidateEvalFile', Object.assign({ evalNo: f.evalNo }, ANA));
  ok('admin opens it: base64, its type and name', got.success && got.base64 && got.mimeType === 'application/pdf' && got.fileName === 'Juan - initial interview.pdf', got);
  ok('a sales login may not', !call(c, 'getCandidateEvalFile', Object.assign({ evalNo: f.evalNo }, KIM)).success);
  ok('the read is secured', !call(c, 'getCandidateEvalFile', Object.assign({ evalNo: f.evalNo, flowSecret: '' }, HR)).success);
  store.CandidateEvals[0]['File Type'] = 'text/html';
  ok('the type is checked again on the way out', /cannot be shown/.test(call(c, 'getCandidateEvalFile', Object.assign({ evalNo: f.evalNo }, HR)).message));
  store.CandidateEvals[0]['File Type'] = 'application/pdf'; store.CandidateEvals[0]['File ID'] = 'gone';
  const miss = call(c, 'getCandidateEvalFile', Object.assign({ evalNo: f.evalNo }, HR));
  ok('a file gone from Drive is said so, not an error', miss.success === true && miss.missing === true && /no longer in Drive/.test(miss.message), miss);
}

sec('6 · no Script Property; every action registered');
{
  const { c } = world(), props0 = JSON.stringify(Object.keys(c.__props).sort());
  add(c, { clientRef: 'p1' }); list(c);
  ok('no Script Property was added', JSON.stringify(Object.keys(c.__props).sort()) === props0, Object.keys(c.__props));
  const FL = fs.readFileSync(path.join(__dirname, '..', '..', 'blueprints', 'flow.py'), 'utf8');
  const FA = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', 'js', 'flow-api.js'), 'utf8');
  ['getCandidateEvals', 'getCandidateEvalFile', 'saveCandidateEval', 'archiveCandidateEval'].forEach(a => {
    ok(a + ' is secured in FlowAPI, Flask and the browser', new RegExp('\\b' + a + ': 1').test(SRC) && FL.indexOf('"' + a + '"') >= 0 && FA.indexOf("'" + a + "'") >= 0);
  });
  ok('the two writes are mutations and logged under Recruitment', /saveCandidateEval: 1, archiveCandidateEval: 1,/.test(SRC) && /saveCandidateEval: \['Recruitment', 'Evaluation form added'\]/.test(SRC));
  ok('FLOW_VERSION 201 with a CHANGELOG line', /^var FLOW_VERSION = 201;/m.test(SRC) && /^A400 RECRUITMENT EVALUATION FORMS \(201/m.test(SRC));
}

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILED' : 'all ok'));
process.exit(FAIL ? 1 : 0);
