/* A341 — forwarding a purchase request to a sales rep (flow-pricing-request.js) and what the rep then sees.
 *
 * Run:  node tests/flow/pr-forward.js
 *
 * A website quote request becomes a purchase request owned by "Admin" (FlowAPI 174). Admin sources it as
 * usual and forwards it to the rep who will quote it. Pinned here:
 *   • the purchase request window shows who it belongs to, and the Forward control, for admin, director and
 *     accounting only (management prices from its engine and never opens the window; reps never forward);
 *   • the rep list comes from the staff roster, sales reps only, with the names on requests as a fallback;
 *   • Forward sends the existing setPricingRequestSalesperson {prNo, salesperson} and nothing else, and
 *     refuses a blank name or the current owner without asking FlowAPI;
 *   • the list row says who a website request is for;
 *   • after forwarding, the rep's own scoped read returns it, and at "For Quotation" the rep gets
 *     Create Quotation;
 *   • the purchase request PDF never offers "Website (hiescorp.com)" as who prepared it.
 */
const { page } = require('./pageload');
const { load, call } = require('./gasload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');

const PR = (o) => Object.assign({ prNo: 'PR-202610-401', date: '2026-10-18', customer: 'Acme Mining Corp.', clientLocation: 'Surigao del Norte',
  requestedBy: 'Website (hiescorp.com)', salesperson: 'Admin', salespersonSource: 'recorded', status: 'Requested', notes: 'Website request Q-261018-1010',
  docJson: JSON.stringify({ contactPerson: 'Juan Dela Cruz', preparedByName: '' }), pdfLink: '',
  items: [{ line: 1, itemNo: 'HE-01323', itemName: 'RAD Pump', qty: 2, uom: '', remarks: '', included: true, supplier: '', supplierPrice: 0, currency: 'PHP', cbm: 0, finalPrice: 0 }] }, o || {});
const ROSTER = { success: true, users: [
  { username: 'kim', fullName: 'Kimberlyn Blones', role: 'sales' }, { username: 'ger', fullName: 'Gerald C.', role: 'Sales' },
  { username: 'ana', fullName: 'Ana Admin', role: 'admin' }, { username: 'acc', fullName: 'Accounting One', role: 'accounting' }] };

async function open(role, name, row, roster) {
  const p = page(['js/flow-pricing-engine.js', 'js/flow-pricing-request.js'], 'flow-pricing-request.html',
    { username: 'u', name, role }, { withAuth: true, data: { getPricingRequests: [row] } });
  p.ctx.apiFetchEmailUsers = roster === undefined ? () => Promise.resolve(ROSTER) : roster;
  // the window's body is built with insertAdjacentHTML; the harness's is a no-op, so keep what it adds
  p.els.modalBody.insertAdjacentHTML = (pos, h) => { p.els.modalBody.innerHTML = h + p.els.modalBody.innerHTML; };
  p.els.prReps = { innerHTML: '' }; p.els.prOwnTo = { value: '' }; p.els.prOwnBtn = { disabled: false };
  await p.boot();
  p.run(`openPr(${JSON.stringify(row.prNo)})`);
  await new Promise(r => setImmediate(r));
  return p;
}

(async () => {
  sec('who sees it');
  for (const [role, want] of [['admin', true], ['director', true], ['accounting', true], ['sales', false], ['leadgen', false]]) {
    const p = await open(role, role === 'sales' || role === 'leadgen' ? 'Admin' : 'Some One', PR());
    const body = p.els.modalBody.innerHTML;
    ok(role + (want ? ': the window shows who it belongs to and Forward' : ': no Forward control'),
      want ? /<label>Belongs to<\/label><div class="pr-own-who"><b>Admin<\/b>/.test(body) && /onclick="forwardPr\('PR-202610-401'\)"/.test(body) && /id="prOwnTo"/.test(body)
           : !/forwardPr|Belongs to/.test(body), body.slice(0, 400));
  }
  {
    const p = await open('management', 'Mgmt User', PR({ status: 'For Mgmt Pricing' }));
    ok('management prices from its engine: the window never opens, so no Forward either', !/forwardPr/.test(p.els.modalBody.innerHTML));
  }

  sec('the rep list');
  {
    const p = await open('admin', 'Ana Admin', PR());
    const dl = p.els.prReps.innerHTML;
    ok('sales reps from the staff roster only, sorted', dl === '<option value="Gerald C."><option value="Kimberlyn Blones">', dl);
    ok('  asked for once, not per window', (() => { let n = 0; p.ctx.apiFetchEmailUsers = () => { n++; return Promise.resolve(ROSTER); }; p.run("openPr('PR-202610-401')"); return n === 0; })());
    const q = await open('admin', 'Ana Admin', PR(), () => Promise.reject(new Error('403')));
    ok('  without the roster: the names already on requests, never "Admin" or the website', q.els.prReps.innerHTML === '', q.els.prReps.innerHTML);
    const r = await open('admin', 'Ana Admin', PR({ salesperson: 'Kimberlyn Blones' }), () => Promise.resolve({ success: false }));
    ok('  (a request already with a rep offers that rep)', r.els.prReps.innerHTML === '<option value="Kimberlyn Blones">', r.els.prReps.innerHTML);
    const s = page(['js/flow-pricing-engine.js', 'js/flow-pricing-request.js'], 'flow-pricing-request.html', { name: 'Ana', role: 'admin' }, { withAuth: true });
    ok('  the "Belongs to" text is escaped', !/<img/.test(s.run(`prOwnerBlock(${JSON.stringify(PR({ salesperson: '<img src=x onerror=alert(1)>' }))})`)));
  }

  sec('Forward sends the existing action');
  {
    const p = await open('admin', 'Ana Admin', PR());
    const before = p.params.length;
    p.els.prOwnTo.value = '   ';
    await p.run("forwardPr('PR-202610-401')");
    ok('a blank name is refused without asking FlowAPI', p.params.length === before && /Enter the sales rep/.test(p.els.modalMsg.textContent), p.els.modalMsg.textContent);
    p.els.prOwnTo.value = ' admin ';
    await p.run("forwardPr('PR-202610-401')");
    ok('  so is the current owner', p.params.length === before && /already belongs to admin/.test(p.els.modalMsg.textContent), p.els.modalMsg.textContent);
    p.els.prOwnTo.value = '  Kimberlyn   Blones ';
    await p.run("forwardPr('PR-202610-401')");
    const sent = p.params.slice(before).filter(x => !/^get/.test(x.action));
    ok('Forward: setPricingRequestSalesperson {prNo, salesperson}, nothing else', JSON.stringify(sent) === JSON.stringify([{ action: 'setPricingRequestSalesperson', params: { prNo: 'PR-202610-401', salesperson: 'Kimberlyn Blones' } }]), sent);
    ok('  the list is read again', p.params.slice(before).some(x => x.action === 'getPricingRequests'));
    ok('  and it says where it went and what comes next', /PR-202610-401 now belongs to Kimberlyn Blones\. It is in their Purchase Requests, and they can create the quotation once it is priced\./.test(p.els.modalMsg.textContent), p.els.modalMsg.textContent);
    const q = await open('admin', 'Ana Admin', PR({ status: 'Returned to Sales' }));
    q.els.prOwnTo.value = 'Gerald C.';
    await q.run("forwardPr('PR-202610-401')");
    ok('  at "For Quotation" it says they can create it now', /create the quotation now\./.test(q.els.modalMsg.textContent), q.els.modalMsg.textContent);
  }

  sec('the list and the PDF');
  {
    const p = await open('admin', 'Ana Admin', PR());
    const row = p.run(`prRowHtml(${JSON.stringify(PR())})`);
    ok('a website request\'s row says who it is for', /Website \(hiescorp\.com\)<div class="fc-dim">for Admin<\/div>/.test(row), row);
    ok('  a rep\'s own request shows no extra line', !/for /.test(p.run(`prRowHtml(${JSON.stringify(PR({ requestedBy: 'Gerald C.', salesperson: ' gerald c. ' }))})`).replace(/<td>[^<]*<\/td>/g, '')));
    p.els.pdfPreparedByName = { value: '' };
    p.run("openPdf('PR-202610-401')");
    ok('the PR PDF\'s "Prepared by" is the person printing it, never the website', p.els.pdfPreparedByName.value === 'Ana Admin', p.els.pdfPreparedByName.value);
  }

  sec('after forwarding, the rep has it');
  {
    const store = { ActivityLog: [], Clients: [], PricingRequests: [], PricingRequestItems: [], Inventory: [], FlowSettings: [] };
    const c = load(undefined, store);
    const made = call(c, 'createPricingRequest', { customer: 'Acme Mining Corp.', clientRef: 'web:Q-261018-1010', requestedBy: 'Website (hiescorp.com)', salesperson: 'Admin',
      actorName: 'Website', items: JSON.stringify([{ itemNo: 'HE-01323', itemName: 'RAD Pump', qty: 2 }]) });
    const mine = () => (call(c, 'getPricingRequests', { requestedBy: 'Kimberlyn Blones' }).data || []).map(x => x.prNo);
    ok('before: not in the rep\'s list', made.success && mine().length === 0, made);
    const f = call(c, 'setPricingRequestSalesperson', { prNo: made.prNo, salesperson: 'Kimberlyn Blones', actorRole: 'admin', actorName: 'Ana Admin' });
    ok('after: in the rep\'s own scoped read', f.success && mine().join() === made.prNo, f);
    ok('  the stage is untouched (forwarding is not pricing)', store.PricingRequests[0]['Status'] === 'Requested');
    ok('  a rep cannot forward one themselves', !call(c, 'setPricingRequestSalesperson', { prNo: made.prNo, salesperson: 'Gerald C.', actorRole: 'sales', actorName: 'Kimberlyn Blones' }).success);
    const p = await open('sales', 'Kimberlyn Blones', PR({ salesperson: 'Kimberlyn Blones', status: 'Returned to Sales' }));
    ok('at "For Quotation" the rep gets Create Quotation', /makeQuotation\('PR-202610-401'\)">Create Quotation/.test(p.els.modalFoot.innerHTML), p.els.modalFoot.innerHTML);
  }

  console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
