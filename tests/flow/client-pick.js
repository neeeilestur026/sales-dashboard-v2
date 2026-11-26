/* A407 — the client named from the rep's Client Book: js/client-pick.js, the purchase request form
 * (js/flow-pricing-request.js) and the quote builder (js/flow-quote-configurator.js).
 *
 * Run:  node tests/flow/client-pick.js
 *
 * Neil, 25 Nov 2026: "New purchase requests and quotations must pick the client from the rep's book; a new client can be
 * added there in place." Checked here:
 *   1 · the pure part: required for sales only (and FlowSettings requireClientPick 'off'), the search, what Add a client sends
 *   2 · the picker on a stub DOM: required → says what to do; search; pick; Add a client selects the new client; a twin
 *       offers the one already there; another rep's client is refused with the server's words
 *   3 · the purchase request form, run for real (pageload): sales gets the required picker, others the A358 select; picking
 *       fills the customer as the book spells it; no client → no request; the request carries clientNo; needClient → inline
 *   4 · the quote builder: by hand → required, sends clientNo; from a request on no client → optional, sends clientNo with
 *       createQuotationFromPR; a request already on a client, a saved quotation, the director → no picker
 *   5 · the files: links and script order, tokens only, the apple-design rules
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard') + '/';
const read = (f) => fs.readFileSync(D + f, 'utf8');
const tick = () => new Promise(r => setImmediate(r));
const CP = require('../../dashboard/js/client-pick.js');

/* An element the picker can draw into without a browser: each part it asks for by selector is kept, to be read back. */
function fakeEl(id) {
  const parts = {}, attrs = {}, handlers = {}, cls = new Set();
  const el = {
    id: id || '', innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, dataset: {}, style: {}, attrs, handlers, parts, focused: 0,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
                 toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); } },
    has: (c) => cls.has(c),
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
    addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); }, removeEventListener() {},
    focus() { el.focused++; }, scrollIntoView() {}, contains: () => false, closest: () => null,
    querySelector(s) { return parts[s] || (parts[s] = fakeEl()); }, querySelectorAll: () => []
  };
  return el;
}
const part = (root, k) => root.parts['[data-cp="' + k + '"]'];

const BOOK = [
  { clientNo: 'CB-1', company: 'ACME Cement Corporation', tier: 'Major', sector: 'Cement', siteAddress: 'Teresa, Rizal', headOfficeAddress: 'Ortigas Center, Pasig',
    contacts: [{ name: 'Joy Ramos', position: 'Purchasing head', emails: ['joy@acme.example'], phones: ['0917 000 0001'], primary: true }], names: ['ACME Cement'], owner: 'Kimberlyn Blones', archivedAt: '' },
  { clientNo: 'CB-2', company: 'Taganito Mining', tier: 'Minor', sector: 'Mining', siteAddress: 'Claver, Surigao del Norte', headOfficeAddress: '', contacts: [], names: [], owner: 'Kimberlyn Blones', archivedAt: '' },
  { clientNo: 'CB-3', company: 'Old Plant Inc', tier: 'Minor', sector: 'Power', archivedAt: '2026-10-01T00:00:00.000Z', contacts: [], names: [] },
  { clientNo: 'CB-4', company: 'Batangas Power Co', tier: 'Developing', sector: 'Power', siteAddress: 'Calaca, Batangas', contacts: [], names: [], archivedAt: '' }];
const LISTS = { tiers: ['Major', 'Minor', 'Developing'], sectors: ['Oil and gas', 'Cement', 'Power', 'Aviation', 'Automotive', 'Construction', 'Mining', 'Others'] };
const NEED = 'Choose the client from your Client Book. A client that is not there yet is added first (Add a client).';

(async () => {
  sec('1 · the pure part');
  eq('required for a sales rep, and only for a sales rep', ['sales', 'Sales', 'director', 'admin', 'leadgen', 'management', ''].map(r => CP.cpRequired(r, {})), [true, true, false, false, false, false, false]);
  eq('  FlowSettings requireClientPick "off" makes it optional again (any case); anything else keeps it on',
     [CP.cpRequired('sales', { requireClientPick: 'off' }), CP.cpRequired('sales', { requireClientPick: ' OFF ' }), CP.cpRequired('sales', { requireClientPick: 'on' }), CP.cpRequired('sales', null)], [false, false, true, true]);
  eq('live clients only, A to Z', CP.cpLive(BOOK).map(c => c.clientNo), ['CB-1', 'CB-4', 'CB-2']);
  eq('search: by another spelling, a plant, an industry; a name that starts with the text first',
     [CP.cpSearch(BOOK, 'acme cement').map(c => c.clientNo), CP.cpSearch(BOOK, 'surigao').map(c => c.clientNo), CP.cpSearch(BOOK, 'power').map(c => c.clientNo), CP.cpSearch(BOOK, 'old').map(c => c.clientNo)],
     [['CB-1'], ['CB-2'], ['CB-4'], []]);
  eq('  every word must be there; punctuation and "&" do not matter', [CP.cpSearch(BOOK, 'mining claver').map(c => c.clientNo), CP.cpSearch(BOOK, 'Taganito, Mining!').map(c => c.clientNo)], [['CB-2'], ['CB-2']]);
  eq('the one client a name means (company or another spelling), or nothing', [CP.cpExact(BOOK, 'acme cement').clientNo, CP.cpExact(BOOK, 'ACME CEMENT CORPORATION.').clientNo, CP.cpExact(BOOK, 'Acme'), CP.cpExact(BOOK, 'Old Plant Inc')], ['CB-1', 'CB-1', null, null]);
  eq('Add a client says what is missing, in the order the sheet asks',
     [CP.cpNewPayload({}).error, CP.cpNewPayload({ company: 'X' }).error, CP.cpNewPayload({ company: 'X', tier: 'Major' }).error, CP.cpNewPayload({ company: 'X', tier: 'Major', sector: 'Others' }).error,
      CP.cpNewPayload({ company: 'X', tier: 'Developing', sector: 'Mining' }, ['Major', 'Minor']).error],
     ['Type the company name.', 'Choose Major, Minor or Developing.', 'Choose the industry.', 'Type the industry you meant by Others.', 'Choose Major or Minor.']);
  eq('  and what it sends: the label, the industry (Others as typed), the plant when given, no contacts yet',
     CP.cpNewPayload({ company: '  Subic  Shipyard ', tier: 'Developing', sector: 'Others', sectorOther: ' Shipbuilding ', siteAddress: 'Subic, Zambales' }).payload,
     { company: 'Subic Shipyard', tier: 'Developing', sector: 'Shipbuilding', contactsJson: '[]', notes: '', nextStep: '', nextStepDate: '', siteAddress: 'Subic, Zambales' });
  {
    const posts = [];
    const post = (a, p) => { posts.push([a, p]); return Promise.resolve(a === 'getClientBook' ? { success: true, clients: BOOK, lists: LISTS } : { success: false }); };
    const b = await CP.cpLoadBook({ post });
    ok('cpLoadBook reads the book once and keeps the live clients', b.ok && b.clients.length === 3 && posts.length === 1 && posts[0][0] === 'getClientBook', b);
    const c = vm.createContext({ console, flowVersionAtLeast: (n) => Promise.resolve(n < 204) });
    vm.runInContext(read('js/client-pick.js'), c);
    const old = await vm.runInContext('cpLoadBook({ post: function () { throw new Error("must not be asked"); } })', c);
    ok('  before FlowAPI 204 it reads nothing and answers not ok, so the page stays as it was', old.ok === false && old.old === true, old);
    const bad = await CP.cpLoadBook({ post: () => Promise.reject(new Error('offline')) });
    ok('  an error is not ok either (never a scary message)', bad.ok === false && !bad.message);
  }

  sec('2 · the picker');
  {
    const byId = { pickNo: fakeEl('pickNo'), why: fakeEl('why'), go: fakeEl('go') };
    const C = vm.createContext({ console, setTimeout, document: { getElementById: (id) => byId[id] || null } });
    const API = read('js/api.js');                    // the one escape, hxEsc, as the pages have it (js/api.js's hx-util block)
    vm.runInContext(API.slice(API.indexOf('/* ─── hx-util (A302)'), API.indexOf('/* ─── end hx-util')), C);
    vm.runInContext(read('js/client-pick.js'), C);
    const MISSING = vm.runInContext('CP_MISSING', C);
    const root = fakeEl('row'), picked = [], posts = [];
    C.__answers = {};
    C.__post = (a, p) => { posts.push([a, p]); const x = C.__answers[a]; return Promise.resolve(typeof x === 'function' ? x(p) : (x || { success: false, message: 'no answer' })); };
    C.__root = root; C.__book = BOOK; C.__lists = LISTS; C.__picked = picked;
    const pk = vm.runInContext('cpMount(__root, { inputId: "pickNo", required: true, clients: __book, lists: __lists, what: "request", onPick: function (c) { __picked.push(c.company); }, submitId: "go", whyId: "why", post: __post })', C);
    const q = part(root, 'q'), list = part(root, 'list'), msg = part(root, 'msg');
    ok('it draws a labelled combobox, a hidden Client No and the Add a client link', /role="combobox"/.test(root.innerHTML) && /<input type="hidden" id="pickNo" value="">/.test(root.innerHTML) &&
       /data-cp="add">Add a client<\/button>/.test(root.innerHTML) && root.has('cp-row'), root.innerHTML.slice(0, 300));
    eq('  "Client *", and the button\'s note says what is missing', [part(root, 'label').textContent, part(root, 'mark').textContent, byId.why.hidden, byId.why.textContent, byId.go.attrs['aria-describedby']],
       ['Client', '*', false, 'Choose the client first.', 'why']);
    ok('nothing chosen: check() refuses and says what to do, in red, at the field', pk.check() === false && pk.error() === MISSING && msg.textContent === MISSING && msg.has('bad') && q.attrs['aria-invalid'] === 'true' && q.focused > 0);
    pk.search('acm');
    ok('typing lists the matches and still offers to add what was typed', list.hidden === false && /data-cp-pick="CB-1"/.test(list.innerHTML) && !/CB-2/.test(list.innerHTML) &&
       /Add “acm” as a new client/.test(list.innerHTML) && q.attrs['aria-expanded'] === 'true', list.innerHTML);
    ok('  and the red goes while they answer it', pk.error() === '' && !msg.has('bad'));
    pk.search('zzz');
    ok('  no match says so, with Add a client right under it', /No client in your book matches “zzz”/.test(list.innerHTML) && /data-cp-add/.test(list.innerHTML));
    pk.search('');
    ok('  an empty search lists the live clients A to Z, each with its label and where it is', /CB-1[\s\S]*CB-4[\s\S]*CB-2/.test(list.innerHTML) && !/CB-3/.test(list.innerHTML) &&
       /<span class="cp-tier" data-tier="major">Major<\/span>/.test(list.innerHTML) && /Teresa, Rizal · Cement/.test(list.innerHTML));
    ok('pick: the Client No is the form\'s, the card shows the client, the page is told', pk.pick('CB-1') && byId.pickNo.value === 'CB-1' && pk.value() === 'CB-1' && q.hidden === true &&
       part(root, 'chosen').hidden === false && /ACME Cement Corporation/.test(part(root, 'chosen').innerHTML) && /data-cp="change"/.test(part(root, 'chosen').innerHTML) && picked.join() === 'ACME Cement Corporation');
    ok('  check() passes, and the button\'s note goes', pk.check() === true && byId.why.hidden === true && byId.go.attrs['aria-describedby'] === undefined);
    pk.clear();
    ok('clear: nothing chosen again', pk.value() === '' && byId.pickNo.value === '' && q.hidden === false);

    C.__answers.saveClientBookClient = (p) => ({ success: true, clientNo: 'CB-9', client: { clientNo: 'CB-9', company: p.company, tier: p.tier, sector: p.sector, siteAddress: p.siteAddress || '' } });
    const added = await pk.saveNew({ company: 'Subic Shipyard', tier: 'Developing', sector: 'Others', sectorOther: 'Shipbuilding', siteAddress: 'Subic, Zambales' });
    const sent = (posts.filter(x => x[0] === 'saveClientBookClient')[0] || [])[1] || {};
    eq('Add a client calls saveClientBookClient with the label and the industry', [sent.company, sent.tier, sent.sector, sent.siteAddress, sent.contactsJson], ['Subic Shipyard', 'Developing', 'Shipbuilding', 'Subic, Zambales', '[]']);
    ok('  and the new client is chosen (and searchable from now on)', added.ok && pk.value() === 'CB-9' && byId.pickNo.value === 'CB-9' && picked[picked.length - 1] === 'Subic Shipyard' &&
       pk.clients().some(c => c.clientNo === 'CB-9'));
    const before = posts.length;
    const incomplete = await pk.saveNew({ company: 'No Label Co', sector: 'Mining' });
    ok('  an incomplete one is not sent', incomplete.error === 'Choose Major, Minor or Developing.' && posts.length === before);

    pk.clear();
    C.__answers.saveClientBookClient = { success: false, duplicate: 'CB-1', message: '"ACME Cement Corporation" (CB-1) is already in the Client Book.' };
    const dup = await pk.saveNew({ company: 'Acme Cement Corp', tier: 'Major', sector: 'Cement' });
    ok('a twin: the client already there is offered', dup.duplicate === 'CB-1' && dup.existing && dup.existing.company === 'ACME Cement Corporation' && pk.value() === '', dup);
    const dh = vm.runInContext('cpDuplicateHtml', C)(dup);
    ok('  "Use ACME Cement Corporation", under the server\'s words', /is already in the Client Book\./.test(dh) && /data-cp="use">Use ACME Cement Corporation<\/button>/.test(dh), dh);
    ok('  using it chooses it', pk.pick(dup.existing, true) && pk.value() === 'CB-1');
    pk.clear();
    C.__answers.saveClientBookClient = { success: false, duplicate: 'CB-77', message: '"Far Plant" (CB-77) is already in the Client Book.' };
    C.__answers.getClientBook = { success: true, clients: BOOK.concat([{ clientNo: 'CB-77', company: 'Far Plant', tier: 'Minor', sector: 'Power', archivedAt: '' }]), lists: LISTS };
    const dup2 = await pk.saveNew({ company: 'Far Plant', tier: 'Minor', sector: 'Power' });
    ok('  a twin this page had not loaded is found in a fresh read of the book', dup2.existing && dup2.existing.clientNo === 'CB-77' && pk.clients().some(c => c.clientNo === 'CB-77'), dup2);
    C.__answers.saveClientBookClient = { success: false, message: '"Holcim Davao" is already in the Client Book under Gerald Lucena — ask the director.' };
    const theirs = await pk.saveNew({ company: 'Holcim Davao', tier: 'Major', sector: 'Cement' });
    ok('another rep\'s client: refused with the server\'s words, nothing chosen', theirs.error === '"Holcim Davao" is already in the Client Book under Gerald Lucena — ask the director.' && pk.value() === '');

    pk.showError(NEED, true);
    ok('showError: the server\'s needClient words at the field, in red', pk.error() === NEED && msg.textContent === NEED && msg.has('bad'));
    pk.setMode({ required: false, label: 'Put this request on a client' });
    ok('optional: "Optional", no note at the button, and check() lets it go', part(root, 'mark').textContent === 'Optional' && part(root, 'label').textContent === 'Put this request on a client' &&
       byId.why.hidden === true && pk.check() === true);
    pk.setMode({ hidden: true, required: true });
    ok('hidden: the row hides and nothing is asked', root.hidden === true && pk.check() === true && byId.why.hidden === true);
    pk.setMode({ hidden: false, required: true, label: 'Client' });
    ok('suggest: a name that is exactly one client chooses it; any other waits in the search', pk.suggest('acme cement') === true && pk.value() === 'CB-1');
    pk.clear();
    ok('  (a partial name only fills the search box)', pk.suggest('Acme') === false && pk.value() === '' && q.value === 'Acme');

    const sh = vm.runInContext('cpSheetHtml', C)({ uid: 'cpX', what: 'request', company: 'Subic & Co', lists: LISTS });
    ok('the sheet: a dialog with a grabber, the company typed so far, the three labels as a segmented radio group, the industries, an optional plant',
       /role="dialog" aria-modal="true"/.test(sh) && /data-cp-grab/.test(sh) && /value="Subic &amp; Co"/.test(sh) && /role="radiogroup"/.test(sh) &&
       (sh.match(/type="radio" name="cpXtier"/g) || []).length === 3 && /<option>Others<\/option>/.test(sh) && /data-cp-other hidden/.test(sh) && /Plant address <span class="cp-opt-w">Optional<\/span>/.test(sh) &&
       /this request is put on it/.test(sh) && /data-cp="save" disabled>Add client<\/button>/.test(sh), sh.slice(0, 300));
  }

  sec('3 · the purchase request form');
  const prPage = async (session, o) => {
    o = o || {};
    const p = page(['js/flow-pricing-engine.js', 'js/client-pick.js', 'js/flow-pricing-request.js'], 'flow-pricing-request.html', session,
      { withAuth: true, data: { getFlowSettings: o.settings || {}, getPricingRequests: [], getQuotations: [], getInventory: [], getClients: [] } });
    p.els.prClientBookRow = fakeEl('prClientBookRow'); p.els.prClientBookRow.hidden = true;
    p.ctx.__answers = Object.assign({ getClientBook: { success: true, clients: BOOK, lists: LISTS } }, o.answers || {});
    p.run('postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); var x = __answers[a]; ' +
          'return Promise.resolve(typeof x === "function" ? x(q) : (x || { success: true, data: [] })); };');
    if (o.version) p.run('flowVersionAtLeast = function (n) { return Promise.resolve(n <= ' + o.version + '); };');
    await p.boot(); await tick();
    p.run('collectItems = function () { return [{ itemId: "", itemNo: "TW-1", itemName: "Torque wrench", qty: 1, uom: "set", remarks: "" }]; };');
    return p;
  };
  const KIM = { username: 'sales1', name: 'Kimberlyn Blones', role: 'sales' };
  {
    const p = await prPage(KIM, { answers: { createPricingRequest: { success: true, prNo: 'PR-9', message: 'Purchase request submitted to admin.' } } });
    const row = p.els.prClientBookRow;
    ok('a sales rep on FlowAPI 204: the shared picker, shown and required', p.run('!!prPick') && p.run('prPick.isRequired()') === true && row.hidden === false && /role="combobox"/.test(row.innerHTML));
    ok('  in place of the A358 select, keeping its id for the Client No', /<input type="hidden" id="prClientBook" value="">/.test(row.innerHTML) && !/<select/.test(row.innerHTML));
    p.els.customer.value = 'acme cement';
    p.run('prPick.pick("CB-1")');
    eq('picking fills the customer as the book spells it, and the empty contact fields from the book',
       [p.els.customer.value, p.els.prClientBook.value, p.els.prAddress.value, p.els.prContact.value, p.els.prEmail.value], ['ACME Cement Corporation', 'CB-1', 'Teresa, Rizal', 'Joy Ramos', 'joy@acme.example']);
    p.run('prPick.clear()');
    const n0 = p.calls.length;
    await p.run('saveRequest()'); await tick();
    ok('no client: nothing is sent, and the picker says what to do', p.calls.slice(n0).indexOf('POST:createPricingRequest') < 0 && p.run('prPick.error()') === CP.CP_MISSING);
    ok('  the Submit button\'s note says it too', p.els.prSaveWhy.hidden === false && p.els.prSaveWhy.textContent === 'Choose the client first.');
    p.run('prPick.pick("CB-2")');
    await p.run('saveRequest()'); await tick();
    const sent = p.paramsFor('createPricingRequest') || {};
    eq('with a client: the request carries its Client No, and the customer is the book\'s', [sent.clientNo, sent.customer], ['CB-2', 'Taganito Mining']);
    ok('  the form resets to no client afterwards', p.run('prPick.value()') === '' && p.els.prClientBook.value === '');

    p.ctx.__answers.saveClientBookClient = (q) => ({ success: true, clientNo: 'CB-10', client: { clientNo: 'CB-10', company: q.company, tier: q.tier, sector: q.sector, siteAddress: q.siteAddress || '' } });
    p.els.customer.value = ''; p.els.prAddress.value = '';
    await p.run('prPick.saveNew({ company: "Mariveles Refinery", tier: "Major", sector: "Oil and gas", siteAddress: "Mariveles, Bataan" })');
    const add = p.paramsFor('saveClientBookClient') || {};
    eq('Add a client from the form: saveClientBookClient with the label and industry', [add.company, add.tier, add.sector, add.siteAddress], ['Mariveles Refinery', 'Major', 'Oil and gas', 'Mariveles, Bataan']);
    eq('  and the new client is the request\'s, the customer and address filled', [p.run('prPick.value()'), p.els.customer.value, p.els.prAddress.value], ['CB-10', 'Mariveles Refinery', 'Mariveles, Bataan']);
  }
  {
    const p = await prPage(KIM, { settings: { requireClientPick: 'off' }, answers: { createPricingRequest: { success: false, needClient: true, message: NEED } } });
    ok('requireClientPick off: the picker is there but optional', p.run('prPick.isRequired()') === false && p.els.prClientBookRow.hidden === false);
    p.els.customer.value = 'Some Plant';
    await p.run('saveRequest()'); await tick();
    ok('  the server still says needClient: its words show at the picker, which becomes required', p.calls.indexOf('POST:createPricingRequest') >= 0 && p.run('prPick.error()') === NEED && p.run('prPick.isRequired()') === true);
    ok('  not as a failure at the bottom of the form', p.els.formMsg.textContent !== NEED);
  }
  {
    /* the director has no create form on this page (oversight); admin and lead gen do. Neither is asked for a client: should
       FlowSettings clientBookRoles ever let them read a book, they get the optional A358 select, as today. */
    const p = await prPage({ username: 'admin1', name: 'Aira Limpoco', role: 'admin' });
    ok('admin keeps the optional A358 select (no picker)', p.run('prPick') === null && /<option value="">— not linked —<\/option>/.test(p.els.prClientBook.innerHTML) &&
       /value="CB-1"/.test(p.els.prClientBook.innerHTML) && p.els.prClientBookRow.hidden === false);
    p.els.customer.value = 'Some Plant';
    await p.run('saveRequest()'); await tick();
    ok('  and a request without a client is sent as before', !('clientNo' in (p.paramsFor('createPricingRequest') || { clientNo: 1 })));
  }
  {
    const p = await prPage({ username: 'lg1', name: 'Ana Reyes', role: 'leadgen' }, { answers: { getClientBook: { success: false, message: 'The Client Book is in a trial; only director, sales can use it.' } } });
    p.els.customer.value = 'Some Plant';
    await p.run('saveRequest()'); await tick();
    ok('lead gen: no picker and nothing asked; the request goes as before', p.run('prPick') === null && p.calls.indexOf('POST:createPricingRequest') >= 0 && !('clientNo' in (p.paramsFor('createPricingRequest') || {})));
  }
  {
    const p = await prPage(KIM, { version: 203 });
    ok('a sales rep on an older FlowAPI: no picker, the A358 select as before (optional, nothing scary)', p.run('prPick') === null && /— not linked —/.test(p.els.prClientBook.innerHTML));
  }
  {
    const p = await prPage(KIM, { answers: { getClientBook: { success: false, message: 'The Client Book is in a trial.' } } });
    ok('a book that cannot be read: no picker, the row stays hidden, the form is not blocked', p.run('prPick') === null && p.els.prClientBookRow.hidden === true);
  }
  {
    const p = await prPage(KIM, { answers: { getClientBook: { success: true, clients: [], lists: LISTS } } });
    ok('an empty book: the picker still shows, so the rep can add the first client', p.run('!!prPick') && p.els.prClientBookRow.hidden === false);
  }

  sec('4 · the quote builder');
  const it = (line, price, o) => Object.assign({ line, itemNo: 'TW-' + line, itemName: 'Torque wrench ' + line, qty: 1, included: true, finalPrice: price, quotedOn: '', quotable: true }, o || {});
  const qbPage = async (session, cfg) => {
    const p = page(['js/client-rollup.js', 'js/flow-pricing-engine.js', 'js/client-pick.js', 'js/flow-quote-configurator.js'], 'flow-quotations.html', session, { withAuth: true });
    p.els.qcClientPickRow = fakeEl('qcClientPickRow'); p.els.qcClientPickRow.hidden = true;
    p.ctx.__answers = { getClientBook: { success: true, clients: BOOK, lists: LISTS }, createQuotation: { success: true, quotationNo: 'Q-1' } };
    p.ctx.__pr = null;
    p.run('var qCfg = ' + JSON.stringify(cfg || {}) + '; qcSession = ' + JSON.stringify(session) + '; qcRole = ' + JSON.stringify(session.role) + ';' +
      'postFlow = function (a, q) { __calls.push("POST:" + a); __params.push({ action: a, params: q || {} }); var x = __answers[a]; return Promise.resolve(typeof x === "function" ? x(q) : (x || { success: true })); };' +
      'fetchFlow = function (a) { if (a === "getPricingRequests") return Promise.resolve({ success: true, data: __pr ? [__pr] : [] }); return Promise.resolve({ success: false, data: [] }); };' +
      'qcRenderItems = function () {}; qcOnChange = function () {}; qcSchedulePreview = function () {}; qcSyncBlocks = function () {};' +
      'qcSavePdf = function () { return Promise.resolve(""); }; qcAfterSave = function () { return Promise.resolve(); };');
    await p.run('qcEnsureClientPick()'); await tick();
    return p;
  };
  const finalize = async (p, no) => {
    p.run('qcQuotationNo = ""; qcPdfPendingNo = ""; qcItems = [{ lineKey: "k1", itemNo: "P-1", itemName: "Pump", qty: 1, price: 100 }];');
    p.els.qcNo.value = no; p.els.qcSubject.value = 'Pump';
    const n = p.params.length;
    await p.run('qcFinalize()'); await tick();
    return p.params.slice(n);
  };
  {
    const p = await qbPage(KIM);
    ok('a sales rep, a quotation by hand: the picker is shown and required', p.run('!!qcPick') && p.run('qcPick.isRequired()') === true && p.els.qcClientPickRow.hidden === false && p.run('qcPickFor') === 'new');
    p.els.qcCustomer.value = 'Acme';
    const none = await finalize(p, '2026-700-KPB-ACME');
    ok('  no client: no quotation is created, and the builder says what to do', !none.some(x => x.action === 'createQuotation') && /Choose the client from your Client Book/.test(p.els.qcMsg.innerHTML) &&
       p.run('qcPick.error()') === CP.CP_MISSING);
    p.els.qcAddress.value = ''; p.els.qcAttention.value = ''; p.els.qcPlantSite.value = '';
    p.run('qcPick.pick("CB-1")');
    eq('  picking fills the customer as the book spells it, the head office, the plant and the main contact',
       [p.els.qcCustomer.value, p.els.qcAddress.value, p.els.qcPlantSite.value, p.els.qcAttention.value, p.els.qcEmail.value],
       ['ACME Cement Corporation', 'Ortigas Center, Pasig', 'Teresa, Rizal', 'Joy Ramos', 'joy@acme.example']);
    const made = (await finalize(p, '2026-701-KPB-ACME')).filter(x => x.action === 'createQuotation')[0];
    eq('  the hand-made quotation sends clientNo, with the book\'s spelling as the customer', made && [made.params.clientNo, made.params.customer], ['CB-1', 'ACME Cement Corporation']);
    p.run('qcResetClientPick()');
    ok('  a new quotation starts with no client, and the details a pick filled are cleared', p.run('qcPick.value()') === '' && p.els.qcAddress.value === '' && p.els.qcAttention.value === '');
    p.run('qcQuotationNo = "Q-1"; qcSyncClientPick();');
    ok('editing a saved quotation: no picker, nothing asked', p.els.qcClientPickRow.hidden === true && p.run('qcPick.check()') === true && p.run('JSON.stringify(qcClientParam())') === '{}');
    p.run('qcQuotationNo = ""; qcSyncClientPick();');
  }
  {
    const p = await qbPage(KIM, { requireClientPick: 'off' });
    p.ctx.__answers.createQuotation = { success: false, needClient: true, message: NEED };
    p.els.qcCustomer.value = 'Someone';
    ok('requireClientPick off: the picker is optional', p.run('qcPick.isRequired()') === false && p.els.qcClientPickRow.hidden === false);
    const sent = (await finalize(p, '2026-702-KPB-X')).filter(x => x.action === 'createQuotation')[0];
    ok('  so the quotation is sent without a client', sent && !('clientNo' in sent.params), sent);
    ok('  needClient from the server: shown at the picker (now required) and at the top, nothing thrown',
       p.run('qcPick.error()') === NEED && p.run('qcPick.isRequired()') === true && p.els.qcMsg.innerHTML.indexOf('Choose the client from your Client Book.') >= 0 &&
       p.els.qcFinalizeBtn.disabled === false);
  }
  {
    const p = await qbPage(KIM);
    p.ctx.__pr = { prNo: 'PR-7', customer: 'Taganito Mining', status: 'Returned to Sales', clientNo: '', docJson: '{}', items: [it(1, 1200)] };
    p.ctx.__answers.createQuotationFromPR = { success: true, quotationNo: 'Q-7', status: 'Quoted', remaining: 0 };
    await p.run('qcLoadFromPR("PR-7")'); await tick();
    ok('a quotation from a request on no client: the picker is optional, "Put this request on a client"', p.run('qcPickFor') === 'pr' && p.run('qcPick.isRequired()') === false &&
       p.els.qcClientPickRow.hidden === false && p.els.qcClientPickRow.parts['[data-cp="label"]'].textContent === 'Put this request on a client');
    p.run('qcPick.pick("CB-2")');
    ok('  picking does not touch the request\'s customer', p.els.qcCustomer.value === 'Taganito Mining');
    p.els.qcNo.value = 'Q-7'; p.run('qcQuotationNo = ""; qcPdfPendingNo = "";');
    const n = p.params.length;
    await p.run('qcFinalize()'); await tick();
    const fromPr = p.params.slice(n).filter(x => x.action === 'createQuotationFromPR')[0];
    eq('  createQuotationFromPR carries the chosen clientNo', fromPr && [fromPr.params.prNo, fromPr.params.clientNo], ['PR-7', 'CB-2']);
  }
  {
    const p = await qbPage(KIM);
    p.ctx.__pr = { prNo: 'PR-8', customer: 'ACME Cement Corporation', status: 'Returned to Sales', clientNo: 'CB-1', docJson: '{}', items: [it(1, 900)] };
    p.ctx.__answers.createQuotationFromPR = { success: true, quotationNo: 'Q-8', status: 'Quoted', remaining: 0 };
    await p.run('qcLoadFromPR("PR-8")'); await tick();
    ok('a request already on a client: no picker', p.run('qcPickFor') === '' && p.els.qcClientPickRow.hidden === true);
    p.els.qcNo.value = 'Q-8'; p.run('qcQuotationNo = ""; qcPdfPendingNo = "";');
    const n = p.params.length;
    await p.run('qcFinalize()'); await tick();
    const fromPr = p.params.slice(n).filter(x => x.action === 'createQuotationFromPR')[0];
    ok('  and its create carries no clientNo', fromPr && !('clientNo' in fromPr.params), fromPr);
  }
  {
    const p = await qbPage({ username: 'neil', name: 'Neil Estur', role: 'director' });
    ok('the director: no picker, the builder as it was', p.run('qcPick') === null && p.calls.indexOf('POST:getClientBook') < 0);
    p.els.qcCustomer.value = 'Anyone Inc';
    const made = (await finalize(p, 'Q-D')).filter(x => x.action === 'createQuotation')[0];
    ok('  a hand-made quotation goes without a clientNo', made && !('clientNo' in made.params), made);
  }

  sec('5 · the files');
  {
    const PH = read('flow-pricing-request.html'), QH = read('flow-quotations.html'), JS = read('js/client-pick.js'), CSS = read('css/client-pick.css');
    ok('both pages link client-pick.css before sales-lists.css (so ledger.css and apple.css stay last)', [PH, QH].every(h => /<link rel="stylesheet" href="css\/client-pick\.css">\s*<link rel="stylesheet" href="css\/sales-lists\.css">/.test(h)));
    ok('  and load js/client-pick.js before the page\'s own script', /<script src="js\/client-pick\.js"><\/script>[\s\S]*<script src="js\/flow-pricing-request\.js">/.test(PH) &&
       /<script src="js\/client-pick\.js"><\/script>\s*<script src="js\/flow-quote-configurator\.js">/.test(QH));
    ok('the picker\'s rows: the PR row above Customer, the builder\'s row above Customer, each Submit with its note',
       /<div class="full" id="qcClientPickRow" hidden><\/div>\s*<div class="full"><label>Customer \*<\/label>/.test(QH) && /id="prSaveWhy" aria-live="polite" hidden>/.test(PH) && /id="qcClientWhy" aria-live="polite" hidden>/.test(QH));
    ok('no emoji, no hex colour, no inline style in the script', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2712}\u{2716}-\u{27BF}]/u.test(JS) && !/#[0-9a-fA-F]{3,6}\b/.test(JS) && !/style="/.test(JS));
    ok('the stylesheet uses tokens only', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));
    ok('apple-design: press .97 over 100ms; a phone bottom sheet with a grabber at 640px; reduced motion is a fade; reduced transparency; more contrast',
       /:active \{ transform: scale\(\.97\); \}/.test(CSS) && /transition: transform 100ms ease-out/.test(CSS) && /@media \(max-width: 640px\) \{[\s\S]*\.cp-sheet \{[^}]*translateY\(100%\)[\s\S]*\.cp-grab \{ display: flex; \}/.test(CSS) &&
       /@media \(prefers-reduced-motion: reduce\) \{\s*\.cp-sheet, \.cp-overlay\.in \.cp-sheet \{ transform: none; transition: none; \}/.test(CSS) && /\.cp-overlay \{[^}]*transition: opacity/.test(CSS) &&
       /@media \(prefers-reduced-transparency: reduce\)/.test(CSS) && /@media \(prefers-contrast: more\)/.test(CSS));
    ok('the sheet moves focus in and back, traps Tab, closes on Escape and the backdrop', /first\.focus\(\)/.test(JS) && /const to = picked \|\| !back \|\| back === document\.body \? ctl\.focusTarget\(\) : back;/.test(JS) && /e\.key === 'Escape'/.test(JS) &&
       /if \(e\.key !== 'Tab'\) return;/.test(JS) && /if \(e\.target === ov\) \{ close\(false\); return; \}/.test(JS));
  }

  console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
