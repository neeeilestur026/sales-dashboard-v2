/* A215 — the send-date backfill, and parking.
 *
 * The properties this holds down:
 *   • PREVIEW WRITES NOTHING — the whole point of a two-step migration is that somebody reads the
 *     list before 60 rows change;
 *   • an estimated date is never mistaken for a recorded one — it carries its basis, and a real
 *     date is never overwritten;
 *   • running twice writes nothing the second time;
 *   • parking needs a future date AND a reason, because six weeks later "why is this parked?" is
 *     the only question anyone asks;
 *   • the width trap: Quotations went 23 -> 26 and BOTH positional writers moved with it.
 */
const { load } = require('./gasload');
const store = () => ({ Quotations: [], QuotationItems: [], SalesOrders: [], ActivityLog: [],
  QuotationEmails: [], FlowSettings: [] });
const DIR = { actorName: 'Neil M. Estur', actorRole: 'director' };
const REP = { actorName: 'Crystal Gayle', actorRole: 'sales' };
const w = (a,b) => Object.assign({}, a, b);
let bad = 0;
const check = (l,c,d)=>{ if(!c){bad++;console.log('  FAIL',l,d===undefined?'':JSON.stringify(d));} else console.log('  ok  ',l,d===undefined?'':JSON.stringify(d)); };

const c = load(null, store());
// Shaped like the real thing: some Sent with no date, one with a real date, one non-sent.
c.__store.Quotations.push(
  { 'Quotation No':'Q1', 'Date':'2026-07-01', 'Customer':'A', 'Status':'Sent', 'Approved At':'2026-07-03', 'Sent At':'' },
  { 'Quotation No':'Q2', 'Date':'2026-06-20', 'Customer':'B', 'Status':'Sent', 'Approved At':'', 'Sent At':'' },
  { 'Quotation No':'Q3', 'Date':'2026-07-10', 'Customer':'C', 'Status':'Sent', 'Approved At':'2026-07-11', 'Sent At':'2026-07-12' },
  { 'Quotation No':'Q4', 'Date':'2026-07-05', 'Customer':'D', 'Status':'Approved', 'Approved At':'2026-07-06', 'Sent At':'' },
  { 'Quotation No':'Q5', 'Date':'', 'Customer':'E', 'Status':'Sent', 'Approved At':'', 'Sent At':'' });

console.log('preview writes nothing and explains itself');
const before = JSON.stringify(c.__store.Quotations);
const pv = c.previewQuotationSentAt({});
check('two rows can be estimated', pv.count === 2, pv.data.map(r=>r.quotationNo));
check('the one with a real date is left alone', pv.alreadyRecorded === 1);
check('the one with nothing to estimate from is reported, not guessed', pv.cannotEstimate === 1);
check('an Approved (not sent) quotation is not touched', !pv.data.some(r=>r.quotationNo==='Q4'));
check('each row carries its basis', pv.data.every(r=>/^Estimated from/.test(r.basis)), pv.data.map(r=>r.basis));
check('oldest first, so the worst is read first', pv.data.map(r=>r.quotationNo).join()==='Q2,Q1', pv.data.map(r=>r.quotationNo));
check('PREVIEW WROTE NOTHING', JSON.stringify(c.__store.Quotations) === before);

console.log('\napply');
check('a rep cannot rewrite 60 send dates', !c.runQuotationSentAtBackfill(w(REP,{})).success);
const run = c.runQuotationSentAtBackfill(w(DIR,{}));
check('the director can', run.success === true && run.updated === 2, run.message);
const q1 = c.__store.Quotations.find(q=>q['Quotation No']==='Q1');
check('Q1 got the approval date', String(q1['Sent At']) === '2026-07-03', String(q1['Sent At']));
check('and is labelled an ESTIMATE', String(q1['Sent At Basis']) === 'Estimated from approval');
const q2 = c.__store.Quotations.find(q=>q['Quotation No']==='Q2');
check('Q2 fell back to its quotation date', String(q2['Sent At']) === '2026-06-20', String(q2['Sent At']));
check('labelled accordingly', String(q2['Sent At Basis']) === 'Estimated from quotation date');
const q3 = c.__store.Quotations.find(q=>q['Quotation No']==='Q3');
check('the REAL date was never overwritten', String(q3['Sent At']) === '2026-07-12');
check('and it has no basis, so it still reads as recorded', String(q3['Sent At Basis']||'') === '');

console.log('\nidempotent');
const again = c.runQuotationSentAtBackfill(w(DIR,{}));
check('a second run writes nothing', again.updated === 0, again.message);

console.log('\nselective');
{
  const c2 = load(null, store());
  c2.__store.Quotations.push(
    { 'Quotation No':'X1','Date':'2026-07-01','Status':'Sent','Approved At':'2026-07-02','Sent At':'' },
    { 'Quotation No':'X2','Date':'2026-07-01','Status':'Sent','Approved At':'2026-07-02','Sent At':'' });
  const r = c2.runQuotationSentAtBackfill(w(DIR,{ quotationNos: JSON.stringify(['X1']) }));
  check('only the named one is written', r.updated === 1);
  check('the other is untouched', String(c2.__store.Quotations.find(q=>q['Quotation No']==='X2')['Sent At'])==='');
  check('bad JSON is refused, not ignored', !c2.runQuotationSentAtBackfill(w(DIR,{quotationNos:'{{'})).success);
}

console.log('\nthe width trap');
{
  const c3 = load(null, store());
  check('SCHEMA.Quotations is 26 wide', c3.SCHEMA.Quotations.length === 26, c3.SCHEMA.Quotations.length);
  check('Sent At Basis is on it', c3.SCHEMA.Quotations.indexOf('Sent At Basis') >= 0);
  check('Snooze Until is on it', c3.SCHEMA.Quotations.indexOf('Snooze Until') >= 0);
}

console.log('\nsnooze');
{
  const c4 = load(null, store());
  c4.__store.Quotations.push({ 'Quotation No':'S1','Date':'2026-07-01','Status':'Sent','Sent At':'2026-07-01' });
  check('a date in the past is refused', !c4.snoozeQuotation({quotationNo:'S1',until:'2020-01-01',reason:'x'}).success);
  check('a reason is required', !c4.snoozeQuotation({quotationNo:'S1',until:'2026-10-01'}).success);
  check('garbage date refused', !c4.snoozeQuotation({quotationNo:'S1',until:'nope',reason:'x'}).success);
  const s = c4.snoozeQuotation({quotationNo:'S1',until:'2026-10-01',reason:'Client said call in October'});
  check('a proper park works', s.success === true, s.message);
  const row = c4.__store.Quotations[0];
  check('stored with its reason', String(row['Snooze Until'])==='2026-10-01' && /October/.test(String(row['Snooze Reason'])));
  const u = c4.snoozeQuotation({quotationNo:'S1'});
  check('un-parking is one action', u.success === true && String(c4.__store.Quotations[0]['Snooze Until'])==='');
  check('an unknown quotation is a message, not a crash', !c4.snoozeQuotation({quotationNo:'NOPE',until:'2026-10-01',reason:'x'}).success);
}

console.log('\nregistration');
{
  const c5 = load(null, store());
  ['snoozeQuotation','previewQuotationSentAt','runQuotationSentAtBackfill'].forEach(a =>
    check(a + ' is in HANDLERS', typeof c5.HANDLERS[a] === 'function'));
  check('the backfill takes the lock', !!c5.MUTATIONS.runQuotationSentAtBackfill);
  check('and leaves an audit row', !!c5._MODULE_MAP.runQuotationSentAtBackfill);
  check('snooze takes the lock', !!c5.MUTATIONS.snoozeQuotation);
  check('preview is a READ — no lock, no audit row',
        !c5.MUTATIONS.previewQuotationSentAt && !c5._MODULE_MAP.previewQuotationSentAt);
  check('the backfill is _SECURED', !!c5._SECURED.runQuotationSentAtBackfill);
}

console.log(bad ? '\n' + bad + ' FAILED' : '\nall good');
process.exit(bad?1:0);
