/* A350 — the Client Book's private store (FlowAPI 178; A354 adds the Major / Minor label in 180: getClientBook / saveClientBookClient / setClientBookStatus /
 * archiveClientBookClient).
 *
 * Run:  node tests/flow/client-book-store.js
 *
 * Neil, 21 Oct 2026: a client list for testing, first for the director and "not connected to anything else". So the
 * store is its own two tabs, every action is secured and refuses every role outside FlowSettings 'clientBookRoles'
 * (default director), the lists are enforced by the server, every change is one log row, nothing is deleted, nothing
 * goes to the ActivityLog, and it never writes the real Clients sheet, LgAccred, PRs or quotations.
 * Runs the real FlowAPI.gs through its dispatcher (gasload), so the secret and the lock are under test too.
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');
const NEIL = { actorName: 'Neil Estur', actorRole: 'director', actorUsername: 'neil' };
const CONTACTS = JSON.stringify([
  { id: 'P1', name: 'R. Cruz', position: 'Maintenance planner', emails: ['rcruz@plant-a.ph', 'R.Cruz@Gmail.com'], phones: ['0917 123 4567', '(02) 8123 4567'] },
  { id: 'P2', name: 'M. Santos', position: 'Buyer', emails: ['buyer@plant-a.ph'], phones: ['0918 765 4321'] }]);

sec('1 · the version, and nothing else is touched');
{
  const store = {};
  const c = load(GS, store);
  ok('getVersion = 192', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 192);
  const g = call(c, 'getClientBook', NEIL);
  ok('a read of an empty book answers empty and creates no tab', g.success && g.clients.length === 0 && g.log.length === 0 && !('ClientBook' in store) && !('ClientBookLog' in store), g);
  ok('  and gives the page the server\'s lists', g.lists.accreditation.join() === 'Accredited,On process,Not accredited' && g.lists.status.length === 9 && g.lists.steps.length === 4);
}

sec('2 · adding a client');
{
  const store = { Clients: [{ Customer: 'Sample Cement Plant A' }] };
  const c = load(GS, store);
  const r = call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'Sample Cement Plant A, Inc.', owner: 'Gerald Lucena', contactsJson: CONTACTS, nextStep: 'Send accreditation forms', nextStepDate: '2026-10-24' }, NEIL));
  const row = (store.ClientBook || [])[0] || {};
  ok('added, numbered CB-, not accredited to begin with', r.success && /^CB-\d{6}-\d{3}$/.test(r.clientNo) && row['Accreditation'] === 'Not accredited' && !!row['Accreditation Updated At'], r);
  ok('  the canonical key is the server\'s (_canonKey)', row['Key'] === 'sample cement plant a', row['Key']);
  ok('  every write is the full width', row.__arity === 27 && store.ClientBookLog.every(l => l.__arity === 9));
  const people = JSON.parse(row['Contacts JSON']);
  ok('  two people, each with several emails (lower-cased) and phones, the first made primary', people.length === 2 && people[0].emails.join() === 'rcruz@plant-a.ph,r.cruz@gmail.com' &&
     people[0].phones.length === 2 && people[0].primary === true && people[1].primary === false, people);
  ok('  one log row: created', store.ClientBookLog.length === 1 && store.ClientBookLog[0]['Kind'] === 'created' && store.ClientBookLog[0]['By'] === 'Neil Estur');
  ok('  the real Clients sheet is untouched, and nothing goes to the ActivityLog', store.Clients.length === 1 && !(store.ActivityLog || []).length);
  const dup = call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'SAMPLE CEMENT PLANT A CORP.' }, NEIL));
  ok('the same company under another spelling is refused, naming the one already there', !dup.success && dup.duplicate === r.clientNo && /already in the Client Book/.test(dup.message), dup);
  const twin = call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'SAMPLE CEMENT PLANT A CORP.', allowDuplicate: true }, NEIL));
  ok('  unless it is confirmed (a second site, say)', twin.success && store.ClientBook.length === 2);
  const acc = call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'Power Plant B', accreditation: 'On process' }, NEIL));
  ok('a client can start with its accreditation', acc.success && store.ClientBook[2]['Accreditation'] === 'On process');
  const bad = call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'Mine C', accreditation: 'Approved' }, NEIL));
  ok('  but only from the list', !bad.success && /Accreditation must be one of/.test(bad.message));
}

sec('3 · what it refuses');
{
  const store = {};
  const c = load(GS, store);
  const no = (label, params, re) => { const r = call(c, 'saveClientBookClient', Object.assign({}, NEIL, params)); ok(label, !r.success && re.test(r.message), r); };
  no('no company', { company: '  ' }, /company name/);
  no('an email that is not one', { company: 'Mine D', contactsJson: JSON.stringify([{ name: 'X', emails: ['not-an-email'] }]) }, /not an email/);
  no('contacts that are not a list', { company: 'Mine D', contactsJson: '{"a":1}' }, /could not be read/);
  no('contacts over 20,000 characters', { company: 'Mine D', contactsJson: JSON.stringify([{ name: 'x'.repeat(100), note: 'y'.repeat(20000) }]) }, /too long/);
  no('a next step date that is not a date', { company: 'Mine D', nextStepDate: '24/10/2026' }, /must be a date/);
  ok('nothing was written by any of them', !(store.ClientBook || []).length);
  const formula = call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: '=HYPERLINK("x")' }, NEIL));
  ok('a company typed as a formula is stored as text', formula.success && /^'=/.test(store.ClientBook[0]['Company']), store.ClientBook && store.ClientBook[0]);
}

sec('4 · accreditation and the sales status');
{
  const store = {};
  const c = load(GS, store);
  const no = call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'Nickel Mine E', owner: 'Kimberlyn Blones' }, NEIL)).clientNo;
  const tooSoon = call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'status', value: 'RFQ pending' }, NEIL));
  ok('A354: a sales status can be set before the client is accredited (they are separate labels)', tooSoon.success && store.ClientBook[0]['Status'] === 'RFQ pending' && store.ClientBook[0]['Accreditation'] === 'Not accredited', tooSoon);
  const step = call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'accreditation', value: 'On process', step: 'Documents submitted', note: 'Sent the vendor forms' }, NEIL));
  const row = () => store.ClientBook[0];
  ok('on process, with its step and note, and its own "last update" time', step.success && row()['Accreditation'] === 'On process' && row()['Accreditation Step'] === 'Documents submitted' &&
     !!row()['Accreditation Updated At'] && step.client.accreditationNote === 'Sent the vendor forms', step);
  ok('  a step that is not on the list, or with another status, is refused',
     !call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'accreditation', value: 'On process', step: 'Waiting' }, NEIL)).success &&
     !call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'accreditation', value: 'Not accredited', step: 'Site audit' }, NEIL)).success);
  ok('  an until-date only goes with Accredited', !call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'accreditation', value: 'On process', until: '2027-10-01' }, NEIL)).success);
  const accd = call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'accreditation', value: 'Accredited', until: '2027-10-31' }, NEIL));
  ok('accredited until a date', accd.success && row()['Accreditation'] === 'Accredited' && row()['Accredited Until'] === '2027-10-31' && row()['Accreditation Step'] === '');
  const st = call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'status', value: 'Quotation sent', note: 'Hose and fittings', ref: '2026-574-GL-LEONIOGROUP' }, NEIL));
  ok('then the sales status, linked to the quotation, with its time', st.success && row()['Status'] === 'Quotation sent' && row()['Status Ref'] === '2026-574-GL-LEONIOGROUP' && !!row()['Status Updated At'], st);
  ok('  a status not on the list is refused', !call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'status', value: 'Hot lead' }, NEIL)).success);
  ok('  so is a change of neither kind', !call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'stage', value: 'x' }, NEIL)).success);
  const kinds = store.ClientBookLog.map(l => l['Kind'] + ':' + l['From'] + '>' + l['To']);
  ok('every change is one log row, from what it was to what it is', kinds.join(' | ') === 'created:>Nickel Mine E | status:>RFQ pending | accreditation:Not accredited>On process (Documents submitted) | accreditation:On process (Documents submitted)>Accredited until 2027-10-31 | status:RFQ pending>Quotation sent', kinds);
  ok('  the status row carries its reference', store.ClientBookLog[4]['Ref'] === '2026-574-GL-LEONIOGROUP');
}

sec('5 · editing, contacts, archive and restore');
{
  const store = {};
  const c = load(GS, store);
  const no = call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'Power Plant F', contactsJson: CONTACTS }, NEIL)).clientNo;
  const two = JSON.parse(CONTACTS);
  const ed = call(c, 'saveClientBookClient', Object.assign({ clientNo: no, company: 'Power Plant F', owner: 'Gerald Lucena', contactsJson: JSON.stringify([two[0], { id: 'P3', name: 'L. Reyes', emails: ['lreyes@pp-f.ph'] }]) }, NEIL));
  const kinds = store.ClientBookLog.map(l => l['Kind']);
  ok('an edit logs what changed: the owner, and the contacts (who was added, who removed)', ed.success && kinds.join() === 'created,details,contacts' &&
     /owner — to Gerald Lucena/.test(store.ClientBookLog[1]['Note']) && /Added L\. Reyes\. Removed M\. Santos/.test(store.ClientBookLog[2]['Note']), store.ClientBookLog);
  ok('  and keeps the accreditation and creation it did not touch, in place (one row)', store.ClientBook.length === 1 && store.ClientBook[0]['Accreditation'] === 'Not accredited' && store.ClientBook[0]['Created By'] === 'Neil Estur' && store.ClientBook[0]['Owner'] === 'Gerald Lucena');
  const noReason = call(c, 'archiveClientBookClient', Object.assign({ clientNo: no }, NEIL));
  ok('archiving needs a reason', !noReason.success && /why/.test(noReason.message));
  const ar = call(c, 'archiveClientBookClient', Object.assign({ clientNo: no, reason: 'Plant closed' }, NEIL));
  ok('archived, not deleted: the row stays, with its reason', ar.success && store.ClientBook.length === 1 && !!store.ClientBook[0]['Archived At'] && store.ClientBook[0]['Archive Reason'] === 'Plant closed');
  ok('  an archived client cannot be edited or updated', !call(c, 'saveClientBookClient', Object.assign({ clientNo: no, company: 'Power Plant F' }, NEIL)).success &&
     !call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'accreditation', value: 'Accredited' }, NEIL)).success);
  ok('  an archived client does not block adding the company again', call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'Power Plant F' }, NEIL)).success);
  const back = call(c, 'archiveClientBookClient', Object.assign({ clientNo: no, restore: true }, NEIL));
  ok('restored', back.success && !store.ClientBook[0]['Archived At'] && store.ClientBookLog.some(l => l['Kind'] === 'restored'));
  const g = call(c, 'getClientBook', NEIL);
  ok('the read returns every client and the whole log, contacts parsed', g.success && g.clients.length === 2 && g.clients[0].contacts.length === 2 && g.log.length === store.ClientBookLog.length, g.clients[0]);
}

sec('6 · A358: the director and the sales reps by default; every other role refused');
{
  const store = { FlowSettings: [] };
  const c = load(GS, store);
  const sales = { actorName: 'Gerald Lucena', actorRole: 'sales' }, acct = { actorName: 'Rojan Leo Francisco', actorRole: 'accounting' };
  ['getClientBook', 'saveClientBookClient', 'setClientBookStatus', 'archiveClientBookClient'].forEach(a => {
    const r = call(c, a, Object.assign({ company: 'X', clientNo: 'CB-1', reason: 'r' }, acct));
    ok(a + ' refuses an accounting login', !r.success && /only director, sales/.test(r.message), r);
  });
  const direct = JSON.parse(c._dispatch({ action: 'getClientBook', actorName: 'Neil Estur', actorRole: 'director' }).getContent());
  ok('without the app\'s secret even the director\'s read is refused (contact details are private)', !direct.success);
  ok('a rep can use it from the start', call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company: 'Rep Client' }, sales)).success);
  store.FlowSettings.push({ Key: 'clientBookRoles', Value: 'director', 'Updated By': 'Neil', 'Updated At': '' });
  ok('and Neil can close it to them again (FlowSettings clientBookRoles = director)', !call(c, 'getClientBook', sales).success);
}

sec('10 · A358: each rep keeps their own clients; the director sees and changes all');
{
  const store = { FlowSettings: [] };
  const c = load(GS, store);
  const gerald = { actorName: 'Gerald Lucena', actorRole: 'sales' }, kim = { actorName: 'Kimberlyn Blones', actorRole: 'sales' };
  const add = (who, company, extra) => call(c, 'saveClientBookClient', Object.assign({ tier: 'Minor', sector: 'Cement', company }, extra || {}, who));
  const g1 = add(gerald, 'Plant G One', { owner: 'Kimberlyn Blones' });
  const k1 = add(kim, 'Plant K One');
  ok('a rep\'s new client is theirs, whatever owner is sent', g1.success && g1.client.owner === 'Gerald Lucena' && k1.client.owner === 'Kimberlyn Blones', g1.client);
  const gRead = call(c, 'getClientBook', gerald), kRead = call(c, 'getClientBook', { actorName: 'kimberlyn blones', actorRole: 'sales' });
  ok('each rep reads only their own clients, and only their log (any case of the name)', gRead.clients.map(x => x.company).join() === 'Plant G One' && gRead.log.every(l => l.clientNo === g1.clientNo) &&
     kRead.clients.map(x => x.company).join() === 'Plant K One' && kRead.log.every(l => l.clientNo === k1.clientNo), [gRead.clients.map(x => x.company), kRead.clients.map(x => x.company)]);
  const n0 = store.ClientBookLog.length;
  const edit = call(c, 'saveClientBookClient', Object.assign({ clientNo: k1.clientNo, company: 'Plant K One', notes: 'mine now' }, gerald));
  const st = call(c, 'setClientBookStatus', Object.assign({ clientNo: k1.clientNo, kind: 'status', value: 'RFQ pending' }, gerald));
  const ar = call(c, 'archiveClientBookClient', Object.assign({ clientNo: k1.clientNo, reason: 'x' }, gerald));
  ok('another rep\'s client cannot be edited, re-statused or archived, and nothing is written', !edit.success && !st.success && !ar.success && /not in your Client Book/.test(edit.message) &&
     store.ClientBookLog.length === n0 && !store.ClientBook.find(r => r['Client No'] === k1.clientNo)['Notes'], [edit.message, st.message, ar.message]);
  const give = call(c, 'saveClientBookClient', Object.assign({ clientNo: g1.clientNo, company: 'Plant G One', owner: 'Kimberlyn Blones' }, gerald));
  ok('a rep cannot hand their client to someone else', give.success && store.ClientBook.find(r => r['Client No'] === g1.clientNo)['Owner'] === 'Gerald Lucena');
  const twin = add(gerald, 'PLANT K ONE INC.', { allowDuplicate: true });
  ok('a company already under another rep is refused, even with allowDuplicate, naming who has it', !twin.success && /already in the Client Book under Kimberlyn Blones — ask the director/.test(twin.message) && !twin.duplicate, twin);
  const own = add(gerald, 'PLANT G ONE CORP.', { allowDuplicate: true });
  ok('  while a rep may add a second site of their own client', own.success);
  const dir = { actorName: 'Neil Estur', actorRole: 'director' };
  const all = call(c, 'getClientBook', dir);
  ok('the director reads every client', all.clients.length === 3);
  const move = call(c, 'saveClientBookClient', Object.assign({ clientNo: k1.clientNo, company: 'Plant K One', owner: 'Gerald Lucena' }, dir));
  ok('  and can move a client to another rep, which then reads it', move.success && call(c, 'getClientBook', gerald).clients.some(x => x.clientNo === k1.clientNo) &&
     !call(c, 'getClientBook', kim).clients.some(x => x.clientNo === k1.clientNo));
}

sec('9 · A354: every client is Major or Minor, with its industry and site address');
{
  const store = {};
  const c = load(GS, store);
  const none = call(c, 'saveClientBookClient', Object.assign({ company: 'No Label Co', sector: 'Power' }, NEIL));
  ok('a new client without a label is refused, and nothing is written', !none.success && /Major or Minor/.test(none.message) && !(store.ClientBook || []).length, none);
  const odd = call(c, 'saveClientBookClient', Object.assign({ company: 'Odd Label Co', tier: 'Medium', sector: 'Power' }, NEIL));
  const nosec = call(c, 'saveClientBookClient', Object.assign({ company: 'No Sector Co', tier: 'Minor' }, NEIL));
  ok('a new client without its industry is refused', !nosec.success && /which industry/.test(nosec.message) && !(store.ClientBook || []).length, nosec);
  ok('  only Major or Minor', !odd.success && /Major or Minor/.test(odd.message));
  const maj = call(c, 'saveClientBookClient', Object.assign({ company: 'Big Plant Co', tier: 'major', sector: 'cement', siteAddress: 'Brgy. Bigte, Norzagaray, Bulacan' }, NEIL));
  const row = store.ClientBook[0];
  ok('saved as Major and Cement (any case), with the site address, every write 27 wide', maj.success && row['Tier'] === 'Major' && row['Sector'] === 'Cement' &&
     row['Site Address'] === 'Brgy. Bigte, Norzagaray, Bulacan' && row.__arity === 27 && maj.client.tier === 'Major' && maj.client.sector === 'Cement' && maj.client.siteAddress === row['Site Address'], row);
  ok('  the created line names both', /^Major, Cement\. Not accredited\.$/.test(store.ClientBookLog[0]['Note']), store.ClientBookLog[0]['Note']);
  const keep = call(c, 'saveClientBookClient', Object.assign({ clientNo: maj.clientNo, company: 'Big Plant Co', notes: 'x' }, NEIL));
  ok('an edit that sends no label, sector or site keeps them', keep.success && store.ClientBook[0]['Tier'] === 'Major' && store.ClientBook[0]['Sector'] === 'Cement' &&
     store.ClientBook[0]['Site Address'] === 'Brgy. Bigte, Norzagaray, Bulacan');
  const down = call(c, 'saveClientBookClient', Object.assign({ clientNo: maj.clientNo, company: 'Big Plant Co', notes: 'x', tier: 'Minor', sector: 'Geothermal drilling', siteAddress: 'Plant 2, Bataan' }, NEIL));
  ok('a change of label, sector and site is saved and logged', down.success && store.ClientBook[0]['Tier'] === 'Minor' && store.ClientBook[0]['Sector'] === 'Geothermal drilling' &&
     store.ClientBookLog.some(l => l['Kind'] === 'details' && /the label Major to Minor, the sector Cement to Geothermal drilling, the plant address/.test(l['Note'])), store.ClientBookLog.map(l => l['Note']));
  ok('  a sector not on the list is kept as typed (an "Others" industry)', down.client.sector === 'Geothermal drilling');
  call(c, 'setClientBookStatus', Object.assign({ clientNo: maj.clientNo, kind: 'accreditation', value: 'On process', step: 'Documents submitted' }, NEIL));
  call(c, 'archiveClientBookClient', Object.assign({ clientNo: maj.clientNo, reason: 'test' }, NEIL));
  ok('  and an accreditation update or an archive keeps them', store.ClientBook[0]['Tier'] === 'Minor' && store.ClientBook[0]['Sector'] === 'Geothermal drilling' && store.ClientBook[0].__arity === 27);
  const g = call(c, 'getClientBook', NEIL);
  ok('the read returns the labels and the lists', g.clients[0].tier === 'Minor' && g.clients[0].siteAddress === 'Plant 2, Bataan' && g.lists.tiers.join() === 'Major,Minor' &&
     g.lists.sectors.join() === 'Oil and gas,Cement,Power,Aviation,Automotive,Construction,Mining,Others' && g.lists.status[0] === 'RFQ pending');
}

sec('11 · A369: a plant address and a head office address');
{
  const store = {};
  const c = load(GS, store);
  const a = call(c, 'saveClientBookClient', Object.assign({ company: 'Two Sites Co', tier: 'Major', sector: 'Power', siteAddress: 'Plant, Limay, Bataan', headOfficeAddress: '  12F Tower One,   Makati City ' }, NEIL));
  const row = store.ClientBook[0];
  ok('a new client keeps both (trimmed, like the plant address), still one row 27 wide', a.success && row['Site Address'] === 'Plant, Limay, Bataan' && row['Head Office Address'] === '12F Tower One,   Makati City' &&
     row.__arity === 27 && a.client.headOfficeAddress === '12F Tower One,   Makati City', row);
  const keep = call(c, 'saveClientBookClient', Object.assign({ clientNo: a.clientNo, company: 'Two Sites Co', notes: 'x' }, NEIL));
  ok('an edit that sends no head office keeps it', keep.success && store.ClientBook[0]['Head Office Address'] === '12F Tower One,   Makati City');
  const move = call(c, 'saveClientBookClient', Object.assign({ clientNo: a.clientNo, company: 'Two Sites Co', notes: 'x', headOfficeAddress: 'Ortigas, Pasig' }, NEIL));
  ok('a change is saved and logged as the head office address', move.success && store.ClientBook[0]['Head Office Address'] === 'Ortigas, Pasig' &&
     store.ClientBookLog.some(l => l['Kind'] === 'details' && /the head office address/.test(l['Note'])), store.ClientBookLog.map(l => l['Note']));
  const clear = call(c, 'saveClientBookClient', Object.assign({ clientNo: a.clientNo, company: 'Two Sites Co', notes: 'x', headOfficeAddress: '' }, NEIL));
  ok('  an empty one clears it, and the plant address stays', clear.success && store.ClientBook[0]['Head Office Address'] === '' && store.ClientBook[0]['Site Address'] === 'Plant, Limay, Bataan');
  call(c, 'saveClientBookClient', Object.assign({ clientNo: a.clientNo, company: 'Two Sites Co', notes: 'x', headOfficeAddress: 'H'.repeat(400) }, NEIL));
  ok('  at most 300 characters', store.ClientBook[0]['Head Office Address'].length === 300);
  const g = call(c, 'getClientBook', NEIL);
  ok('the read returns it', g.clients[0].headOfficeAddress === 'H'.repeat(300));
}

sec('12 · A369: the run-once tidy moves "Head office:" lines out of the notes');
{
  const store = {};
  const c = load(GS, store);
  const mk = (company, notes, ho) => call(c, 'saveClientBookClient', Object.assign({ company, tier: 'Minor', sector: 'Cement', notes, headOfficeAddress: ho }, NEIL)).clientNo;
  const nMove = mk('Move Co', 'Buys hoses.\nHead office: 5F Alpha Bldg, Ortiz St., Cebu City. From Gerald\'s masterlist (Oct 2026).', '');
  const nSame = mk('Same Co', 'Head Office Address: Pasig City', 'pasig  city');
  const nDiff = mk('Diff Co', 'Head office: Quezon City', 'Taguig City');
  const nTwo = mk('Two Co', 'Head office: A\nHead office: B', '');
  const nNone = mk('Plain Co', 'Head office is in Manila (no colon), keep me', '');
  const nArch = mk('Old Co', 'Head office: Davao City', '');
  call(c, 'archiveClientBookClient', Object.assign({ clientNo: nArch, reason: 'test' }, NEIL));
  const before = JSON.stringify(store.ClientBook), logs = store.ClientBookLog.length;
  const by = (no) => store.ClientBook.find(r => r['Client No'] === no);

  const pv = c.previewClientBookHeadOffices();
  ok('the preview counts and writes nothing', pv.dry && pv.moved === 2 && pv.deduped === 1 && pv.conflicts.length === 1 && pv.several.length === 1 && pv.none === 1 &&
     JSON.stringify(store.ClientBook) === before && store.ClientBookLog.length === logs, pv);
  ok('  and names the clients to settle by hand', /Diff Co — notes: "Quezon City", field: "Taguig City"/.test(pv.text) && /Two Co/.test(pv.text) && /^PREVIEW/.test(pv.text), pv.text);

  const r = c.tidyClientBookHeadOffices();
  ok('the tidy does it', !r.dry && r.moved === 2 && r.deduped === 1 && r.conflicts.length === 1, r);
  ok('  moved: the address into the field, the import tail kept in the notes', by(nMove)['Head Office Address'] === '5F Alpha Bldg, Ortiz St., Cebu City' &&
     by(nMove)['Notes'] === 'Buys hoses.\nFrom Gerald\'s masterlist (Oct 2026).', by(nMove));
  ok('  already in the field: the line is dropped, the field left as it was', by(nSame)['Head Office Address'] === 'pasig  city' && by(nSame)['Notes'] === '', by(nSame));
  ok('  different, several, or no colon: untouched', by(nDiff)['Notes'] === 'Head office: Quezon City' && by(nDiff)['Head Office Address'] === 'Taguig City' &&
     by(nTwo)['Notes'] === 'Head office: A\nHead office: B' && by(nNone)['Notes'] === 'Head office is in Manila (no colon), keep me');
  ok('  an archived client too, and it stays archived', by(nArch)['Head Office Address'] === 'Davao City' && !!by(nArch)['Archived At']);
  ok('  every row still 27 wide, Updated By left alone, one details log row per client changed', store.ClientBook.every(x => x.__arity === 27) &&
     store.ClientBookLog.length === logs + 3 && store.ClientBookLog.slice(logs).every(l => l['Kind'] === 'details' && l['By'] === 'Neil Estur') &&
     by(nMove)['Updated By'] === 'Neil Estur');
  const after = JSON.stringify(store.ClientBook), logs2 = store.ClientBookLog.length;
  const again = c.tidyClientBookHeadOffices();
  ok('a second run changes nothing', again.moved === 0 && again.deduped === 0 && JSON.stringify(store.ClientBook) === after && store.ClientBookLog.length === logs2, again);
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
