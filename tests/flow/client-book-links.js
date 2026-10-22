/* A360 — old purchase requests and quotations can be connected to a Client Book client (FlowAPI 183).
 *
 * Run:  node tests/flow/client-book-links.js
 *
 * Neil, 22 Oct 2026: "can we do it so that even old quotation and prs can be connected to the client?" Runs the real
 * FlowAPI.gs through its dispatcher (gasload):
 *   1 · a rep connects their own old PR and quotation to their own client: one ClientBookLinks row each, a log line on the
 *       client, the PR and quotation rows untouched, and getClientBook returns the links
 *   2 · connecting again changes nothing
 *   3 · refused, with nothing written: another rep's record, an unknown one, an archived or another rep's client, a role
 *       outside the Client Book, an empty or oversized list — and one bad record in a batch stops the whole batch
 *   4 · moving a record to another of the rep's clients logs it on both
 *   5 · taking one off: the row goes blank (a quotation that followed its PR stops following it); only the client's owner
 *   6 · the director connects anything; a rep cannot take a record from another rep's client
 *   7 · each rep reads only the links on their own clients (and the blank ones)
 */
const { load, call } = require('./gasload');
const path = require('path');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const GS = path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs');

const GERALD = { actorName: 'Gerald Lucena', actorRole: 'sales' }, KIM = { actorName: 'Kimberlyn Blones', actorRole: 'sales' };
const NEIL = { actorName: 'Neil Estur', actorRole: 'director' }, ADMIN = { actorName: 'Aira Limpoco', actorRole: 'admin' };
const ITEMS = JSON.stringify([{ itemNo: '1', itemName: 'Hydraulic torque wrench', qty: 1, uom: 'set' }]);

const store = { FlowSettings: [], Quotations: [] };
const C = load(GS, store);
const client = (who, company) => call(C, 'saveClientBookClient', Object.assign({ tier: 'Major', sector: 'Cement', company }, who)).clientNo;
const pr = (who, customer, extra) => call(C, 'createPricingRequest', Object.assign({ customer, items: ITEMS, requestedBy: who.actorName }, extra || {}, who)).prNo;
const quote = (no, customer, owner, prNo) => store.Quotations.push({ 'Quotation No': no, 'Date': '2026-03-02', 'Customer': customer, 'Status': 'Sent',
  'Created By': owner, 'Salesperson': owner, 'PR No': prNo || '', __arity: 0 });
const link = (who, clientNo, recs) => call(C, 'linkClientBookRecords', Object.assign({ clientNo, records: JSON.stringify(recs) }, who));
const unlink = (who, kind, no) => call(C, 'unlinkClientBookRecord', Object.assign({ kind, no }, who));
const links = () => store.ClientBookLinks || [];
const logs = (clientNo, kind) => (store.ClientBookLog || []).filter(l => l['Client No'] === clientNo && (!kind || l['Kind'] === kind));
const snap = () => JSON.stringify([store.PricingRequests, store.Quotations]);

const gH = client(GERALD, 'Holcim Philippines'), g2 = client(GERALD, 'Plant G Two'), gOld = client(GERALD, 'Plant G Closed'), k1 = client(KIM, 'Plant K One');
call(C, 'archiveClientBookClient', Object.assign({ clientNo: gOld, reason: 'Plant closed' }, GERALD));
const prOld = pr(GERALD, 'Holcim Phils. Inc.'), prMade = pr(GERALD, 'Plant G Two', { clientNo: g2 }), prKim = pr(KIM, 'Plant K One');
quote('HX-GL-001', 'HOLCIM PHILS INC', 'Gerald Lucena'); quote('HX-GL-002', 'Plant G Two', 'Gerald Lucena', prMade); quote('HX-KB-001', 'Plant K One', 'Kimberlyn Blones');

sec('1 · a rep connects their own old PR and quotation to their own client');
{
  const before = snap();
  const r = link(GERALD, gH, [{ kind: 'pr', no: prOld }, { kind: 'quotation', no: 'HX-GL-001' }]);
  ok('both connected', r.success && r.linked === 2 && r.already === 0 && r.clientNo === gH, r);
  ok('  one ClientBookLinks row each, 5 wide, by the rep', links().length === 2 && links().every(l => l.__arity === 5 && l['Client No'] === gH && l['By'] === 'Gerald Lucena')
    && links()[0]['Kind'] === 'pr' && links()[0]['Record No'] === prOld && links()[1]['Kind'] === 'quotation', links());
  ok('  a "linked" log line on the client for each, naming the record', logs(gH, 'linked').map(l => l['Ref']).join() === prOld + ',HX-GL-001' && /Purchase request/.test(logs(gH, 'linked')[0]['Note']));
  ok('  the PR and quotation rows are not touched', snap() === before);
  const b = call(C, 'getClientBook', GERALD);
  ok('  getClientBook returns the links', b.success && b.links.length === 2 && b.links.some(l => l.kind === 'pr' && l.no === prOld && l.clientNo === gH && l.by === 'Gerald Lucena'), b.links);
}

sec('2 · connecting again changes nothing');
{
  const n = links().length, lg = (store.ClientBookLog || []).length;
  const r = link(GERALD, gH, [{ kind: 'pr', no: prOld }, { kind: 'pr', no: prOld }]);
  ok('already there: nothing written', r.success && r.linked === 0 && r.already === 1 && links().length === n && store.ClientBookLog.length === lg, r);
  ok('  a PR made for the client (A358) is already on it', link(GERALD, g2, [{ kind: 'pr', no: prMade }]).already === 1 && links().length === n);
  ok('  and so is its quotation, through the PR', link(GERALD, g2, [{ kind: 'quotation', no: 'HX-GL-002' }]).already === 1 && links().length === n);
}

sec('3 · refused, and nothing written');
{
  const n = links().length, lg = store.ClientBookLog.length, before = snap();
  const cases = [
    ['another rep\'s PR', link(GERALD, gH, [{ kind: 'pr', no: prKim }]), /not yours/],
    ['another rep\'s quotation', link(GERALD, gH, [{ kind: 'quotation', no: 'HX-KB-001' }]), /not yours/],
    ['an unknown record', link(GERALD, gH, [{ kind: 'pr', no: 'PR-209901-999' }]), /not a purchase request or quotation/],
    ['a record of another kind', link(GERALD, gH, [{ kind: 'so', no: prOld }]), /not a purchase request or quotation/],
    ['an archived client', link(GERALD, gOld, [{ kind: 'pr', no: prOld }]), /not a live client/],
    ['another rep\'s client', link(GERALD, k1, [{ kind: 'pr', no: prOld }]), /not in your Client Book/],
    ['a role outside the Client Book (admin)', link(ADMIN, gH, [{ kind: 'pr', no: prOld }]), /trial/],
    ['an empty list', link(GERALD, gH, []), /Pick the purchase requests/],
    ['more than 100 at once', link(GERALD, gH, Array.from({ length: 101 }, (_, i) => ({ kind: 'pr', no: 'X' + i }))), /at most 100/],
    ['one bad record in a batch stops the batch', link(GERALD, g2, [{ kind: 'quotation', no: 'HX-GL-001' }, { kind: 'pr', no: prKim }]), /Nothing was connected: .*not yours/],
  ];
  cases.forEach(([l, r, re]) => ok(l, r && !r.success && re.test(r.message), r));
  ok('  no link row, no log line, no PR or quotation change', links().length === n && store.ClientBookLog.length === lg && snap() === before);
  ok('  and the good record in the refused batch stayed where it was', links().find(l => l['Record No'] === 'HX-GL-001')['Client No'] === gH);
}

sec('4 · moving a record to another of the rep\'s clients');
{
  const r = link(GERALD, g2, [{ kind: 'quotation', no: 'HX-GL-001' }]);
  const row = links().filter(l => l['Record No'] === 'HX-GL-001');
  ok('moved: the same row now names the new client', r.success && r.linked === 1 && row.length === 1 && row[0]['Client No'] === g2, row);
  ok('  logged on both clients', logs(g2, 'linked').some(l => l['Ref'] === 'HX-GL-001' && /moved from/.test(l['Note'])) && logs(gH, 'unlinked').some(l => l['Ref'] === 'HX-GL-001' && /moved to/.test(l['Note'])));
}

sec('5 · taking one off');
{
  const r = unlink(GERALD, 'quotation', 'HX-GL-002');
  const row = links().find(l => l['Record No'] === 'HX-GL-002');
  ok('a quotation that followed its PR: taken off, its row blank', r.success && r.clientNo === g2 && row && row['Client No'] === '' && row['Kind'] === 'quotation', r);
  ok('  so connecting its PR again does not bring it back', link(GERALD, g2, [{ kind: 'pr', no: prMade }]).already === 1 && links().find(l => l['Record No'] === 'HX-GL-002')['Client No'] === '');
  ok('  logged on the client it left', logs(g2, 'unlinked').some(l => l['Ref'] === 'HX-GL-002'));
  ok('  taking it off again: it is not on a client', /not connected to a client/.test(unlink(GERALD, 'quotation', 'HX-GL-002').message));
  ok('  another rep cannot take Gerald\'s record off his client', /not in your Client Book/.test(unlink(KIM, 'pr', prOld).message));
  ok('  a bad kind or an unknown record', /purchase request or a quotation/.test(unlink(GERALD, 'so', prOld).message) && /is not a purchase request in the portal/.test(unlink(GERALD, 'pr', 'PR-209901-999').message));
  ok('  and it can be connected again', link(GERALD, g2, [{ kind: 'quotation', no: 'HX-GL-002' }]).linked === 1 && links().find(l => l['Record No'] === 'HX-GL-002')['Client No'] === g2);
}

sec('6 · the director');
{
  const r = link(NEIL, gH, [{ kind: 'pr', no: prKim }]);
  ok('connects any record to any client', r.success && r.linked === 1 && links().find(l => l['Record No'] === prKim)['Client No'] === gH, r);
  const kim = link(KIM, k1, [{ kind: 'pr', no: prKim }]);
  ok('  then Kim cannot take her PR back from Gerald\'s client herself', !kim.success && /another rep's client/.test(kim.message), kim);
  ok('  the director moves it back', link(NEIL, k1, [{ kind: 'pr', no: prKim }]).linked === 1 && links().find(l => l['Record No'] === prKim)['Client No'] === k1);
  ok('  and may take anything off', unlink(NEIL, 'pr', prKim).success && link(KIM, k1, [{ kind: 'pr', no: prKim }]).linked === 1);
}

sec('7 · each rep reads the links on their own clients');
{
  unlink(GERALD, 'pr', prOld);
  const g = call(C, 'getClientBook', GERALD).links, k = call(C, 'getClientBook', KIM).links, n = call(C, 'getClientBook', NEIL).links;
  ok('Gerald: his clients\' links and the blank ones, none of Kim\'s', g.every(l => [gH, g2, ''].indexOf(l.clientNo) >= 0) && g.some(l => l.no === prOld && l.clientNo === '') && !g.some(l => l.clientNo === k1), g);
  ok('Kim: only hers (and the blank ones)', k.every(l => [k1, ''].indexOf(l.clientNo) >= 0) && k.some(l => l.no === prKim && l.clientNo === k1), k);
  ok('the director: all of them', n.length === links().length);
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
