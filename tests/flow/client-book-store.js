/* A350 — the Client Book's private store (FlowAPI 178: getClientBook / saveClientBookClient / setClientBookStatus /
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
  ok('getVersion = 178', JSON.parse(c._dispatch({ action: 'getVersion' }).getContent()).version === 178);
  const g = call(c, 'getClientBook', NEIL);
  ok('a read of an empty book answers empty and creates no tab', g.success && g.clients.length === 0 && g.log.length === 0 && !('ClientBook' in store) && !('ClientBookLog' in store), g);
  ok('  and gives the page the server\'s lists', g.lists.accreditation.join() === 'Accredited,On process,Not accredited' && g.lists.status.length === 9 && g.lists.steps.length === 4);
}

sec('2 · adding a client');
{
  const store = { Clients: [{ Customer: 'Sample Cement Plant A' }] };
  const c = load(GS, store);
  const r = call(c, 'saveClientBookClient', Object.assign({ company: 'Sample Cement Plant A, Inc.', owner: 'Gerald Lucena', contactsJson: CONTACTS, nextStep: 'Send accreditation forms', nextStepDate: '2026-10-24' }, NEIL));
  const row = (store.ClientBook || [])[0] || {};
  ok('added, numbered CB-, not accredited to begin with', r.success && /^CB-\d{6}-\d{3}$/.test(r.clientNo) && row['Accreditation'] === 'Not accredited' && !!row['Accreditation Updated At'], r);
  ok('  the canonical key is the server\'s (_canonKey)', row['Key'] === 'sample cement plant a', row['Key']);
  ok('  every write is the full width', row.__arity === 23 && store.ClientBookLog.every(l => l.__arity === 9));
  const people = JSON.parse(row['Contacts JSON']);
  ok('  two people, each with several emails (lower-cased) and phones, the first made primary', people.length === 2 && people[0].emails.join() === 'rcruz@plant-a.ph,r.cruz@gmail.com' &&
     people[0].phones.length === 2 && people[0].primary === true && people[1].primary === false, people);
  ok('  one log row: created', store.ClientBookLog.length === 1 && store.ClientBookLog[0]['Kind'] === 'created' && store.ClientBookLog[0]['By'] === 'Neil Estur');
  ok('  the real Clients sheet is untouched, and nothing goes to the ActivityLog', store.Clients.length === 1 && !(store.ActivityLog || []).length);
  const dup = call(c, 'saveClientBookClient', Object.assign({ company: 'SAMPLE CEMENT PLANT A CORP.' }, NEIL));
  ok('the same company under another spelling is refused, naming the one already there', !dup.success && dup.duplicate === r.clientNo && /already in the Client Book/.test(dup.message), dup);
  const twin = call(c, 'saveClientBookClient', Object.assign({ company: 'SAMPLE CEMENT PLANT A CORP.', allowDuplicate: true }, NEIL));
  ok('  unless it is confirmed (a second site, say)', twin.success && store.ClientBook.length === 2);
  const acc = call(c, 'saveClientBookClient', Object.assign({ company: 'Power Plant B', accreditation: 'On process' }, NEIL));
  ok('a client can start with its accreditation', acc.success && store.ClientBook[2]['Accreditation'] === 'On process');
  const bad = call(c, 'saveClientBookClient', Object.assign({ company: 'Mine C', accreditation: 'Approved' }, NEIL));
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
  const formula = call(c, 'saveClientBookClient', Object.assign({ company: '=HYPERLINK("x")' }, NEIL));
  ok('a company typed as a formula is stored as text', formula.success && /^'=/.test(store.ClientBook[0]['Company']), store.ClientBook && store.ClientBook[0]);
}

sec('4 · accreditation and the sales status');
{
  const store = {};
  const c = load(GS, store);
  const no = call(c, 'saveClientBookClient', Object.assign({ company: 'Nickel Mine E', owner: 'Kimberlyn Blones' }, NEIL)).clientNo;
  const tooSoon = call(c, 'setClientBookStatus', Object.assign({ clientNo: no, kind: 'status', value: 'Quotation sent' }, NEIL));
  ok('a sales status is refused while the client is not accredited', !tooSoon.success && /accredited client/.test(tooSoon.message), tooSoon);
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
  ok('every change is one log row, from what it was to what it is', kinds.join(' | ') === 'created:>Nickel Mine E | accreditation:Not accredited>On process (Documents submitted) | accreditation:On process (Documents submitted)>Accredited until 2027-10-31 | status:>Quotation sent', kinds);
  ok('  the status row carries its reference', store.ClientBookLog[3]['Ref'] === '2026-574-GL-LEONIOGROUP');
}

sec('5 · editing, contacts, archive and restore');
{
  const store = {};
  const c = load(GS, store);
  const no = call(c, 'saveClientBookClient', Object.assign({ company: 'Power Plant F', contactsJson: CONTACTS }, NEIL)).clientNo;
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
  ok('  an archived client does not block adding the company again', call(c, 'saveClientBookClient', Object.assign({ company: 'Power Plant F' }, NEIL)).success);
  const back = call(c, 'archiveClientBookClient', Object.assign({ clientNo: no, restore: true }, NEIL));
  ok('restored', back.success && !store.ClientBook[0]['Archived At'] && store.ClientBookLog.some(l => l['Kind'] === 'restored'));
  const g = call(c, 'getClientBook', NEIL);
  ok('the read returns every client and the whole log, contacts parsed', g.success && g.clients.length === 2 && g.clients[0].contacts.length === 2 && g.log.length === store.ClientBookLog.length, g.clients[0]);
}

sec('6 · only the director while it is a trial');
{
  const store = { FlowSettings: [] };
  const c = load(GS, store);
  const sales = { actorName: 'Gerald Lucena', actorRole: 'sales' };
  ['getClientBook', 'saveClientBookClient', 'setClientBookStatus', 'archiveClientBookClient'].forEach(a => {
    const r = call(c, a, Object.assign({ company: 'X', clientNo: 'CB-1', reason: 'r' }, sales));
    ok(a + ' refuses a sales login', !r.success && /trial/.test(r.message));
  });
  const direct = JSON.parse(c._dispatch({ action: 'getClientBook', actorName: 'Neil Estur', actorRole: 'director' }).getContent());
  ok('without the app\'s secret even the director\'s read is refused (contact details are private)', !direct.success);
  store.FlowSettings.push({ Key: 'clientBookRoles', Value: 'director, sales', 'Updated By': 'Neil', 'Updated At': '' });
  ok('when Neil opens it to sales (FlowSettings clientBookRoles), a rep can use it', call(c, 'saveClientBookClient', Object.assign({ company: 'Rep Client' }, sales)).success);
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
