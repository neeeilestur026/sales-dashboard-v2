/* A382 — Quotation status (quotation-status.html, js/quotation-status-model.js, js/quotation-status.js) and the shared
 * rules it changes (flowQuotationBucket, flowFollowUp, the follow-up ranking in quotation-email-match.js).
 *
 * Run:  node tests/flow/quotation-status.js
 *
 * Neil, 29 Oct 2026: each rep's own list of every quotation, each one set to Won, Pending (the last follow-up and where
 * it stands) or Lost with a reason — "we just need to have the status of all the quotations".
 *   1 · the lists match the server's (FlowAPI 191)
 *   2 · the shared rules: won by hand, a recorded follow-up is contact
 *   3 · the model: segments add up, what may be done, sections, the hints, validation, Undo
 *   4 · the follow-up email ranking
 *   5 · the page: whose quotations it reads, the switch for oversight, the notice before 191, the only write it makes
 *   6 · the site rules
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load: loadQW } = require('./qwload');
const { load: loadGS } = require('./gasload');
const { page } = require('./pageload');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 500))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');
const TODAY = '2026-10-29';

const ctx = loadQW(TODAY);
['js/client-rollup.js', 'js/quotation-email-match.js', 'js/quotation-status-model.js'].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
const V = (code) => vm.runInContext(code, ctx);

function q(no, o) {
  return Object.assign({ quotationNo: no, date: '2026-08-01', customer: 'Apex Mining Co., Inc.', status: 'Sent', total: 100000, subject: 'Hydraulic jack',
    salesperson: 'Kimberlyn Blones', createdBy: 'Crystal Gayle', sentAt: '2026-08-02', approvedAt: '2026-08-02', result: '', lastFollowUp: '', followUpVia: '',
    followUpStatus: '', resultReason: '', closedFrom: '', approvalNote: '' }, o || {});
}
const Q = [
  q('2026-401-KPB-A'),                                                                             // update, 88 days
  q('2026-402-KPB-B', { result: 'Pending', lastFollowUp: '2026-10-27', followUpVia: 'Call', followUpStatus: 'Waiting for their PO' }),
  q('2026-403-KPB-C', { result: 'Pending', lastFollowUp: '2026-09-01', followUpVia: 'Viber', followUpStatus: 'Client is evaluating' }),   // pending, due again
  q('2026-404-KPB-D', { result: 'Won', resultNote: 'PO 77' }),
  q('2026-405-KPB-E', { status: 'Lost', resultReason: 'Price', closedFrom: 'Sent' }),
  q('2026-406-KPB-F', { status: 'Draft', sentAt: '', approvedAt: '' }),
  q('2026-407-KPB-G', { status: 'Pending Admin', sentAt: '', approvedAt: '' }),
  q('2026-408-KPB-H', { status: 'Approved', sentAt: '' }),
  q('2026-409-KPB-I', { date: '2026-06-01', customer: 'APEX MINING CO., INC', subject: 'Hydraulic jack rev1' }),   // the same deal again, 150 days
  q('2026-410-KPB-J', { customer: 'Taiheiyo Cement', total: 50000, date: '2026-10-10' }),
  q('2026-411-KPB-K', { status: 'Not Pursued', sentAt: '', approvedAt: '' })                      // closed before 191, never sent
];
const SO = [{ soNo: 'SO-90', quotationNo: '2026-404-KPB-D', customer: 'Apex', date: '2026-09-01', total: 1 },
            { soNo: 'SMPO-1', quotationNo: '', customer: 'TAIHEIYO CEMENT', date: '2026-10-20', total: 56000 }];
const hasSO = { '2026-404-KPB-D': true };
const LINKS = { '2026-401-KPB-A': [{ quotationNo: '2026-401-KPB-A', messageId: 'init@x', sentAt: '2026-08-02T09:00:00+08:00', kind: 'Initial', status: 'Active', threadRoot: 'root-a' },
                                   { quotationNo: '2026-401-KPB-A', messageId: 'fu@x', sentAt: '2026-10-20T09:00:00+08:00', kind: 'Follow-up', status: 'Active', threadRoot: 'root-a' }] };

sec('1 · the lists match the server\'s');
{
  const g = loadGS(path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs'), {});
  eq('lost reasons and their outcomes', JSON.parse(V('JSON.stringify(QS_LOST_REASONS)')), JSON.parse(JSON.stringify(g._QUOTE_LOST_REASONS)));
  eq('follow-up statuses', JSON.parse(V('JSON.stringify(QS_FOLLOWUP_STATUSES)')), JSON.parse(JSON.stringify(g._QUOTE_FOLLOWUP_STATUSES)));
  eq('ways of following up', JSON.parse(V('JSON.stringify(QS_FOLLOWUP_VIA)')), JSON.parse(JSON.stringify(g._QUOTE_FOLLOWUP_VIA)));
  eq('the bulk size is the server\'s', V('QS_BULK_MAX'), g._QUOTE_RESULT_MAX);
  eq('the outcome of a reason', ['Price', 'No budget', 'No reply from the client', 'Duplicate quotation', 'Other', 'Nope'].map(r => ctx.qsOutcomeFor(r)), ['Lost', 'Not Pursued', 'Not Pursued', 'Cancelled', 'Lost', '']);
}

sec('2 · the shared rules');
{
  eq('Result Won on a sent quotation is won', ctx.flowQuotationBucket(q('x', { result: 'Won' }), {}), 'won');
  eq('  and on an approved one', ctx.flowQuotationBucket(q('x', { result: 'Won', status: 'Approved' }), {}), 'won');
  eq('  but not on a draft, and a close beats it', [ctx.flowQuotationBucket(q('x', { result: 'Won', status: 'Draft' }), {}), ctx.flowQuotationBucket(q('x', { result: 'Won', status: 'Lost' }), {})], ['internal', 'closed']);
  eq('an order still wins first', ctx.flowQuotationBucket(q('x', { status: 'Lost' }), { x: true }), 'won');
  const fu = ctx.flowFollowUp(q('x', { lastFollowUp: '2026-10-27' }), [], { quotationFollowUpDays: 7 }, {}, TODAY);
  ok('a recorded follow-up is the last contact, so the clock restarts', fu.lastContactAt === '2026-10-27' && fu.state === 'ok' && fu.days === 2, fu);
  const fu2 = ctx.flowFollowUp(q('x', { sentAt: '', lastFollowUp: '2026-10-20' }), [], {}, {}, TODAY);
  ok('  and starts it when the send date is missing', fu2.state !== 'unknown' && fu2.lastContactAt === '2026-10-20', fu2);
  const old = ctx.flowFollowUp(q('x'), [], {}, {}, TODAY);
  ok('  without one, nothing changes (sent 2 Aug: overdue)', old.lastContactAt === '2026-08-02' && old.state === 'overdue', old);
  const step = ctx.quotationWorklistStep(q('x', { result: 'Won', resultNote: 'PO 77' }), [], {}, {}, TODAY);
  ok('the worklist says "Marked won, no sales order yet" for a hand-won one', step.step === 'won' && step.line === 'Marked won, no sales order yet' && step.detail === 'PO 77', step);
}

sec('3 · the model');
{
  const b = ctx.qsBuild(Q, { hasSO, links: LINKS, cfg: {}, salesOrders: SO, today: TODAY });
  const seg = {}; b.rows.forEach(r => { seg[r.q.quotationNo] = r.seg; });
  eq('each quotation in one segment', ['401', '402', '403', '404', '405', '406', '407', '408', '409', '410', '411'].map(n => seg['2026-' + n + '-KPB-' + 'ABCDEFGHIJK'[+n - 401]]),
     ['update', 'pending', 'pending', 'won', 'closed', 'notsent', 'notsent', 'update', 'update', 'update', 'closed']);
  eq('the counts add up to every row', ['update', 'pending', 'won', 'closed', 'notsent'].reduce((s, k) => s + b.counts[k], 0), Q.length);
  eq('progress: decided of the ones sent', b.progress, { done: 5, total: 9 });
  const r = (no) => b.rows.find(x => x.q.quotationNo === no);
  ok('a pending one whose follow-up came due again says so', r('2026-403-KPB-C').due === true && r('2026-402-KPB-B').due === false);
  eq('what may be done: open sent / approved', [r('2026-401-KPB-A').can, r('2026-408-KPB-H').can].map(c => [c.won, c.pending, c.lost, c.open]), [[true, true, true, false], [true, true, true, false]]);
  eq('  a draft can only be closed; one with an order, nothing', [r('2026-406-KPB-F').can, r('2026-404-KPB-D').can].map(c => [c.won, c.pending, c.lost, c.open]), [[false, false, true, false], [false, false, false, false]]);
  eq('  a closed one: back to Sent, then won or pending; one never sent goes nowhere', [r('2026-405-KPB-E').can, r('2026-411-KPB-K').can].map(c => [c.won, c.pending, c.lost, c.open, c.restoreTo]),
     [[true, true, true, true, 'Sent'], [false, false, true, false, '']]);
  eq('  won by hand can be changed back', r('2026-402-KPB-B').can.open && !r('2026-404-KPB-D').can.open, true);
  ok('one client spelled two ways shows one spelling', r('2026-409-KPB-I').client === r('2026-401-KPB-A').client, [r('2026-409-KPB-I').client, r('2026-401-KPB-A').client]);
  ok('the same deal open twice is flagged both ways (rev1 set aside, the other spelling folded in)', r('2026-401-KPB-A').dups.indexOf('2026-409-KPB-I') >= 0 && r('2026-409-KPB-I').dups.indexOf('2026-401-KPB-A') >= 0);
  ok('  never a closed or won one, nor another client', r('2026-401-KPB-A').dups.indexOf('2026-405-KPB-E') < 0 && r('2026-401-KPB-A').dups.indexOf('2026-404-KPB-D') < 0 && r('2026-410-KPB-J').dups.length === 0, r('2026-401-KPB-A').dups);
  eq('possibly won: an order for the client after it, about the amount (VAT allowed)', r('2026-410-KPB-J').maybeWon, { soNo: 'SMPO-1', date: '2026-10-20', total: 56000 });
  ok('  but not an order that names another quotation', !r('2026-401-KPB-A').maybeWon);
  eq('the last follow-up: the linked email when newer than the rep\'s own', r('2026-401-KPB-A').last.date + ' ' + r('2026-401-KPB-A').last.via, '2026-10-20 Email');
  ok('the linked follow-up is found, so Pending skips the pick (an Initial email alone is not one)', !!r('2026-401-KPB-A').linked && r('2026-401-KPB-A').linked.messageId === 'fu@x' &&
     !ctx.qsLinkedFollowUp(q('y'), [LINKS['2026-401-KPB-A'][0]]));
  eq('search: every word must match (client, number, subject)', [ctx.qsFilter(b.rows, { seg: 'all', q: 'apex jack' }).length, ctx.qsFilter(b.rows, { seg: 'all', q: 'apex taiheiyo' }).length], [10, 0]);
  eq('  a segment narrows it', ctx.qsFilter(b.rows, { seg: 'update', q: 'taiheiyo' }).map(x => x.q.quotationNo), ['2026-410-KPB-J']);
  eq('sections, To update by age', ctx.qsSections(ctx.qsFilter(b.rows, { seg: 'update' }), 'update', 'oldest').map(g => g.title + ':' + g.rows.length), ['Over 90 days:1', '30 to 90 days:2', 'Under 30 days:1']);
  eq('  Pending: the due ones first, then where they stand', ctx.qsSections(ctx.qsFilter(b.rows, { seg: 'pending' }), 'pending', 'oldest').map(g => g.title), ['Follow-up due', 'Waiting for their PO']);
  eq('  Closed by reason', ctx.qsSections(ctx.qsFilter(b.rows, { seg: 'closed' }), 'closed', 'oldest').map(g => g.title), ['Price', 'Not pursued']);
  eq('  By client: one group each, by name', ctx.qsSections(ctx.qsFilter(b.rows, { seg: 'update' }), 'update', 'client').length, 2);
  eq('sort biggest first', ctx.qsSort(b.rows, 'biggest')[0].q.total >= ctx.qsSort(b.rows, 'biggest')[1].q.total, true);
  eq('owners for the switch, most first', ctx.qsOwners([q('a'), q('b'), q('c', { salesperson: 'Gerald Lucena' })]).map(o => o.name + ' ' + o.count), ['Kimberlyn Blones 2', 'Gerald Lucena 1']);
  const v = (k, f, qq) => ctx.qsValidate(k, f, qq || q('x'), TODAY);
  eq('validation, the same as the server says it', [v('lost', {}), v('lost', { reason: 'Other' }), v('lost', { reason: 'Price' }),
    v('pending', { via: 'Call', date: '2026-11-02', status: 'Waiting for reply' }), v('pending', { via: 'Call', date: '2026-07-01', status: 'Waiting for reply' }),
    v('pending', { via: 'Call', date: '2026-10-01' }), v('pending', { via: 'Email', status: 'Waiting for reply' }), v('pending', { via: 'Call', date: '2026-10-01', status: 'Will call back' }),
    v('pending', { email: { sentAt: '2026-10-21T09:00:00+08:00' }, status: 'Waiting for reply' })],
    ['Choose why it was lost.', 'Say what happened — "Other" needs a note.', '', 'The follow-up date is in the future.', 'That is before the quotation itself (2026-08-01).',
     'Choose where it stands.', 'Pick the email, or give its date.', '', '']);
  const prevOpen = { quotationNo: 'x', status: 'Sent', result: '', approvalNote: '' };
  eq('Undo of a close: back to open, keeping the result, with the old note', ctx.qsUndo(prevOpen, { quotationNo: 'x', status: 'Not Pursued', resultAt: 'T1' }),
     { quotationNo: 'x', ifResultAt: 'T1', result: 'open', keep: true, approvalNote: '' });
  eq('Undo of a new Won or Pending: back to no result', ctx.qsUndo(prevOpen, { quotationNo: 'x', status: 'Sent', result: 'Won', resultAt: 'T2' }).result, 'open');
  eq('Undo of a changed Pending: the previous follow-up again', ctx.qsUndo({ quotationNo: 'x', status: 'Sent', result: 'Pending', lastFollowUp: '2026-10-01', followUpVia: 'Call', followUpStatus: 'Will call back', resultNote: 'n' },
     { quotationNo: 'x', status: 'Sent', result: 'Pending', resultAt: 'T3' }), { quotationNo: 'x', ifResultAt: 'T3', result: 'pending', followUpDate: '2026-10-01', followUpVia: 'Call', followUpStatus: 'Will call back', note: 'n' });
  eq('Undo of reopening one closed before 191 (no reason code): none, rather than a guess', ctx.qsUndo({ quotationNo: 'x', status: 'Lost', resultReason: '' }, { quotationNo: 'x', status: 'Sent' }), null);
  eq('a bulk Undo carries each quotation\'s own note', ctx.qsUndoBulk([{ quotationNo: 'a', previous: { approvalNote: 'n1' } }, { quotationNo: 'b', previous: { approvalNote: '' } }]),
     { quotationNos: ['a', 'b'], result: 'open', keep: true, approvalNotes: { a: 'n1', b: '' } });
  eq('the returned state is laid over the row', ctx.qsApply(q('x'), { status: 'Lost', resultReason: 'Price', closedFrom: 'Sent' }).status + ' ' + ctx.qsApply(q('x'), { status: 'Lost' }).subject, 'Lost Hydraulic jack');
  eq('what to search older mail for', ctx.qsMailMatch(q('2026-431-KPB-APEX', { clientRefNo: 'RFQ-778' }), 'Buyer@Apex.ph'), { to: ['buyer@apex.ph', 'apex.ph'], subject: ['2026-431', 'RFQ-778'] });
}

sec('4 · the follow-up email ranking');
{
  const quo = q('2026-431-KPB-APEX', { approvedAt: '2026-08-02', sentAt: '2026-08-02' });
  const msgs = [
    { messageId: 'send', subject: 'Quotation 2026-431-KPB-APEX', sentAt: '2026-08-02T10:00:00+08:00', threadRoot: 'root-a', recipients: [{ addr: 'buyer@apex.ph' }] },
    { messageId: 'chase', subject: 'Re: Quotation 2026-431-KPB-APEX', sentAt: '2026-10-25T10:00:00+08:00', threadRoot: 'root-a', recipients: [{ addr: 'buyer@apex.ph' }] },
    { messageId: 'other', subject: 'Lunch Friday?', sentAt: '2026-10-28T10:00:00+08:00', threadRoot: 'z', recipients: [{ addr: 'friend@gmail.com' }] }
  ];
  const plain = ctx.qemRank(quo, msgs, {});
  const fu = ctx.qemRank(quo, msgs, { followUp: { sentAt: '2026-08-02', threads: { 'root-a': true }, today: TODAY } });
  eq('the default ranking still puts the send first (unchanged)', plain[0].msg.messageId, 'send');
  eq('follow-up mode puts the chase in the same thread first', fu[0].msg.messageId, 'chase');
  ok('  and says why', fu[0].reasons.indexOf('in the thread the quotation went out in') >= 0 && fu[0].reasons.indexOf('sent in the last week') >= 0, fu[0].reasons);
}

sec('5 · the page');
const stubEl = () => ({ id: '', value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, checked: false, dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, focus() {}, setAttribute() {}, getAttribute: () => null,
  querySelector: () => null, querySelectorAll: () => [], closest: () => null, remove() {} });
async function boot(o) {
  o = o || {};
  let rows = Q.concat([q('2026-499-GL-X', { salesperson: 'Gerald Lucena', createdBy: 'Kimberlyn Blones' })]);
  if (o.v190) rows = rows.map(x => { const y = Object.assign({}, x); delete y.result; return y; });   // FlowAPI 190 returns no result key
  const p = page(['js/client-rollup.js', 'js/quotation-email-match.js', 'js/quotation-status-model.js', 'js/quotation-status.js'], 'quotation-status.html',
    o.session || { username: 'sales1', name: 'Kimberlyn Blones', role: 'sales' },
    { data: { getQuotations: rows, getSalesOrders: SO, getQuotationEmails: [], getClients: [] } });
  p.run('requireQuotationStatusAccess = function () { return __session; }; flowToday = function () { return "' + TODAY + '"; };');
  await p.boot();
  await new Promise(r => setImmediate(r));
  return p;
}
(async () => {
  const p = await boot();
  eq('a rep reads their own quotations (owner or typist, as the server scopes it)', p.paramsFor('getQuotations'), { createdBy: 'Kimberlyn Blones' });
  eq('  and keeps only the ones they own (not one they typed for Gerald)', p.run('QS.all.length'), Q.length);
  eq('  the five reads, and no write', p.calls.filter(c => !/^POST:/.test(c)).sort(), ['getClients', 'getFlowSettings', 'getQuotationEmails', 'getQuotations', 'getSalesOrders']);
  ok('  no write on load', !p.calls.some(c => /^POST:/.test(c)));
  ok('  the list is drawn, To update first, oldest first', /Over 90 days/.test(p.els.qsList.innerHTML) && p.els.qsList.innerHTML.indexOf('2026-409-KPB-I') < p.els.qsList.innerHTML.indexOf('2026-401-KPB-A'));
  ok('  each open row has Won, Pending and Lost, and Update for a phone', /data-act="won" data-no="2026-401-KPB-A"/.test(p.els.qsList.innerHTML) && /data-act="pending" data-no="2026-401-KPB-A"/.test(p.els.qsList.innerHTML) &&
     /data-act="lost" data-no="2026-401-KPB-A"/.test(p.els.qsList.innerHTML) && /class="qs-update" data-act="update" data-no="2026-401-KPB-A"/.test(p.els.qsList.innerHTML));
  ok('  the progress line', /<b>5<\/b> of 9 sent quotations have a status/.test(p.els.qsProgress.innerHTML), p.els.qsProgress.innerHTML.slice(0, 200));
  ok('  the segments with their counts', /data-seg="update" aria-selected="true"[^>]*>To update <span class="n">4<\/span>/.test(p.els.qsSeg.innerHTML), p.els.qsSeg.innerHTML.slice(0, 300));
  ok('  no notice once 191 is pasted', p.els.qsNotice.innerHTML === '');
  ok('  the rep switch stays hidden for a rep', p.els.qsRepWrap.hidden !== false);
  const d = await boot({ session: { username: 'neil', name: 'Neil Estur', role: 'director' } });
  eq('the director reads everyone', d.paramsFor('getQuotations'), {});
  ok('  sees "Quotation status" and a switch between reps', d.els.qsTitle.textContent === 'Quotation status' && d.els.qsRepWrap.hidden === false && /Kimberlyn Blones \(11\)/.test(d.els.qsRep.innerHTML) && /Gerald Lucena \(1\)/.test(d.els.qsRep.innerHTML), d.els.qsRep.innerHTML);
  const o = await boot({ v190: true });
  ok('before 191: a notice, and no buttons', /version 191/.test(o.els.qsNotice.innerHTML) && !/data-act="won"/.test(o.els.qsList.innerHTML));
  const src = read('js/quotation-status.js');
  eq('the only write the page makes is setQuotationResult', (src.match(/postFlow\('([A-Za-z]+)'/g) || []).map(s => s.slice(10, -1)).filter((x, i, a) => a.indexOf(x) === i), ['setQuotationResult']);
  ok('the mailbox picker is offered only to the quotation\'s own rep', /const q = r\.q, mine = _qsMine\(q\)/.test(src) && /Emails can be picked only from/.test(src));
  ok('the page does not gate on getVersion (the rows tell)', !/flowVersionAtLeast/.test(src) && /hasOwnProperty\.call\(x, 'result'\)/.test(src));

  /* the guard itself: sales, admin, management, the director; accounting and lead gen go home */
  const guard = (role) => { const g = page([], 'quotation-status.html', { username: 'u', name: 'U', role }, { withAuth: true }); let to = '';
    g.ctx.window.location = g.ctx.location = { set href(v) { to = v; }, get href() { return to; }, search: '', pathname: '/quotation-status.html' };
    const s = g.run('requireQuotationStatusAccess()'); return s ? 'in' : 'out'; };
  eq('who the guard lets in', ['sales', 'admin', 'management', 'director', 'accounting', 'leadgen', 'hr'].map(guard), ['in', 'in', 'in', 'in', 'out', 'out', 'out']);

  sec('6 · the site rules');
  const html = read('quotation-status.html'), css = read('css/quotation-status.css');
  ok('the page links the stylesheets in the house order and its scripts after flow-api', /flow-screen\.css">\s*<link rel="stylesheet" href="css\/quotation-status\.css">\s*<link rel="stylesheet" href="css\/ledger\.css">/.test(html) &&
     /flow-api\.js"><\/script>\s*<script src="js\/client-rollup\.js"><\/script>\s*<script src="js\/quotation-email-match\.js"><\/script>\s*<script src="js\/quotation-status-model\.js"><\/script>\s*<script src="js\/quotation-status\.js"><\/script>/.test(html));
  ok('no inline style, onclick, hex colour or emoji in the page or its script', !/style="(?!display:none)/.test(html) && !/onclick=/.test(html + src) && !/#[0-9a-fA-F]{3,6}\b/.test(html) &&
     !/[\u{1F300}-\u{1FAFF}]/u.test(html + src) && !/style="/.test(src));
  ok('the stylesheet uses tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
  ok('press feedback at .97, and the three accessibility blocks', /scale\(\.97\)/.test(css) && /prefers-reduced-motion: reduce/.test(css) && /prefers-reduced-transparency: reduce/.test(css) && /prefers-contrast: more/.test(css));
  ok('a phone gets one Update button instead of three', /@media \(max-width: 640px\)[\s\S]*\.qs-acts \{ display: none; \}[\s\S]*\.qs-update \{ display: inline-block; \}/.test(css));
  ok('the sheets are .flow-modal (a bottom sheet with drag to dismiss on a phone) with a Close control', /flow-modal-overlay qs-overlay/.test(src) && /class="flow-modal qs-modal" role="dialog" aria-modal="true"/.test(src) && /aria-label="Close"/.test(src));
  ok('the rows are the page\'s own (never the phone shell\'s .ap-row)', !/ap-row/.test(src + css));

  console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
  process.exit(FAIL ? 1 : 0);
})();
