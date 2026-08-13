/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   A230 — the table test quotation-email-match.js has claimed since A208 but never had.

   Its header line 5 read "Everything below is exercised by a table test." There was no such file.
   Worse, quotation-worklist.js:12 cited it as the table-tested PRECEDENT, so a claim that was never
   true was propagating into other files as justification. This makes it true.

   WHY IT IS WRITTEN NOW, BEFORE ANY BEHAVIOUR CHANGES. The next commits make dismissed rows actually
   reach the matcher — today they never do, so the `-1000` branch at quotation-email-match.js:93 is
   unreachable dead code. That change is plumbing and must not move a single score. This file is the
   proof: it pins today's ranking, and it must stay BYTE-IDENTICAL in its output across that change.
   The full-ranking snapshot at the bottom is the assertion that actually carries that guarantee.

   HARNESS: plain require(), the tests/flow/client-rollup.js pattern. This module is genuinely
   standalone — qemScore calls nothing outside the file — so the vm harness qwload.js/prwload.js use
   would be ceremony here. (If it is ever forced, note their documented trap: a top-level `const` is
   LEXICAL and does not land on the vm context, so the tables must be republished by hand.)

   NO CLOCK PINNING, deliberately. qemDays reads both dates off its inputs and never calls
   flowToday(), so there is nothing here that can drift with the calendar. Said out loud so nobody
   adds a TODAY constant out of habit.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const M = require('../../dashboard/js/quotation-email-match.js');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

/* The REAL DTO shapes. This matters more than it looks: the file's own comment at :111-115 records
   that an early scorer read `q.customerDomain`, a field the live quotation DTO does not carry, so the
   second-strongest signal silently never fired — and the unit test of the day did not catch it
   BECAUSE THE TEST WAS HANDING IT A FIELD THE REAL DATA DOES NOT HAVE. So: quotations here carry only
   what getQuotations emits, and the on-file domain arrives through ctx.clientEmails, as it does live. */
const Q = (o) => Object.assign({
  quotationNo: '2026-440-NE-ECC-JACK_PALLET', customer: 'EAGLE CEMENT CORPORATION',
  subject: '', clientRefNo: '', date: '2026-08-10', approvedAt: '', salesperson: '', createdBy: ''
}, o);
const MSG = (o) => Object.assign({
  messageId: 'm1@mail', subject: '', recipients: [], recipient: '', sentAt: '2026-08-10', date: ''
}, o);
const score = (q, m, c) => M.qemScore(q, m, c || {}).score;
const reasons = (q, m, c) => M.qemScore(q, m, c || {}).reasons;

console.log('== the two short-circuits, and which one wins ==');
{
  const q = Q(), m = MSG({ messageId: 'X@mail' });
  /* Both are reachable ONLY through ctx. The dismissed map is the one that has never been populated
     in production — see the file header. Pinning it here is what lets the plumbing fix be proved. */
  eq('dismissed sinks it to -1000', score(q, m, { dismissed: { 'x@mail': true } }), -1000);
  eq('  and says why, in the rep\'s words', reasons(q, m, { dismissed: { 'x@mail': true } }),
     ['you said not this one']);
  eq('linked to ANOTHER quotation sinks it to -500',
     score(q, m, { linked: { 'x@mail': '2026-441-OTHER' } }), -500);
  eq('  naming the quotation it is on', reasons(q, m, { linked: { 'x@mail': '2026-441-OTHER' } }),
     ['already linked to 2026-441-OTHER']);

  /* THE CASE THAT MUST NOT FIRE: linked to THIS quotation is not a penalty. Getting this backwards
     would bury the message the rep is looking at underneath every unrelated one. */
  ok('linked to THIS quotation scores normally, not -500',
     score(q, m, { linked: { 'x@mail': q.quotationNo } }) > -500);

  /* PRECEDENCE. Line 93 runs before line 95. A tidy-up that reorders them turns a
     dismissed-and-linked message from -1000 into -500, changing what surfaces to the rep. */
  eq('dismissed beats linked when both apply',
     score(q, m, { dismissed: { 'x@mail': true }, linked: { 'x@mail': '2026-441-OTHER' } }), -1000);

  // The lookup is lower-cased on the way in, so a bracketed/upper id from the feed still matches.
  eq('the message id is matched case-insensitively',
     score(q, MSG({ messageId: 'ABC@Mail' }), { dismissed: { 'abc@mail': true } }), -1000);
  eq('a message with no id cannot be dismissed by accident',
     score(q, MSG({ messageId: '' }), { dismissed: { '': true } }), 20);   // 20 = same-day only
}

console.log('\n== 1. the quotation number in the subject — decisive, and its floor ==');
{
  const q = Q({ quotationNo: '2026-440-NE-ECC' });
  eq('found, flattened past punctuation and case',
     score(q, MSG({ subject: 'Re: 2026 440 ne ecc  quote' })) - 20, 60);
  eq('absent scores nothing here', score(q, MSG({ subject: 'Lunch Friday?' })) - 20, 0);
  /* The >= 6 floor exists so a two-character quotation number cannot match half the alphabet. */
  eq('a number shorter than 6 flat chars never fires',
     score(Q({ quotationNo: 'Q-1' }), MSG({ subject: 'q1 anything' })) - 20, 0);
}

console.log('\n== 2. who it went to — learned beats on-file, and they are exclusive ==');
{
  const q = Q({ customer: 'EAGLE CEMENT CORPORATION' });
  const to = (a) => MSG({ recipients: [{ addr: a }] });
  const key = 'eagle cement corporation';

  eq('a domain CONFIRMED for this client before is worth 35',
     score(q, to('m@eagle-cement.com.ph'), { clientDomains: { [key]: ['eagle-cement.com.ph'] } }) - 20, 35);
  eq('the domain merely ON FILE is worth 25',
     score(q, to('m@eagle-cement.com.ph'), { clientEmails: { [key]: 'x@eagle-cement.com.ph' } }) - 20, 25);
  /* else-if: they must never stack, or a well-known client scores 60 on domain alone and outranks
     a message carrying the actual quotation number. */
  eq('and they do NOT stack when both are true',
     score(q, to('m@eagle-cement.com.ph'),
       { clientDomains: { [key]: ['eagle-cement.com.ph'] }, clientEmails: { [key]: 'x@eagle-cement.com.ph' } }) - 20,
     35);
  eq('a different domain earns neither',
     score(q, to('m@somewhere-else.com'), { clientDomains: { [key]: ['eagle-cement.com.ph'] } }) - 20, 0);

  // The `recipient` singular fallback is the other shape the feed can hand us.
  eq('the singular `recipient` shape is read too',
     score(q, MSG({ recipient: 'm@eagle-cement.com.ph' }), { clientEmails: { [key]: 'x@eagle-cement.com.ph' } }) - 20, 25);

  /* FREE MAILBOXES EARN NOTHING — otherwise every gmail client collides with every other. */
  M.QEM_PUBLIC_DOMAINS.forEach(d => {
    ok('  no domain points for ' + d,
       score(q, to('someone@' + d), { clientEmails: { [key]: 'boss@' + d } }) - 20 === 0);
  });
}

console.log('\n== the public-domain table against its second copy in Python ==');
{
  /* A230 — the JS comment used to say this list "mirrors" blueprints/email_log.py. It does not: the
     Python copy carries six and this one carries ten. Pinning EQUALITY here would fail; pinning the
     real relationship is the honest assertion, and it is the one that matters — JS must stay a
     SUPERSET, because the failure mode of the JS list being narrower is a wrong client matched. */
  const py = fs.readFileSync(path.resolve(__dirname, '../../blueprints/email_log.py'), 'utf8');
  const m = /if domain in \(([^)]*)\)/.exec(py);
  ok('the Python list is still where we think it is', !!m);
  const pyList = (m ? m[1] : '').split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  eq('Python still carries these six', pyList,
     ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'live.com']);
  ok('and this file is a strict SUPERSET of it — never narrower',
     pyList.every(d => M.QEM_PUBLIC_DOMAINS.indexOf(d) >= 0),
     pyList.filter(d => M.QEM_PUBLIC_DOMAINS.indexOf(d) < 0));
  eq('  the four it adds', M.QEM_PUBLIC_DOMAINS.filter(d => pyList.indexOf(d) < 0),
     ['yahoo.com.ph', 'aol.com', 'protonmail.com', 'msn.com']);
}

console.log('\n== 3. subject overlap — its threshold, and the blank-subject guarantee ==');
{
  const q = Q({ subject: 'Jack Pallet 2.5 Tons Hydraulic' });
  eq('a strong overlap scores round(20 x jaccard)',
     score(q, MSG({ subject: 'Jack Pallet 2.5 Tons Hydraulic' })) - 20, 20);   // jaccard 1.0
  ok('a weak overlap under the 0.15 threshold scores nothing',
     score(q, MSG({ subject: 'Hydraulic something entirely different altogether' })) - 20 === 0);

  /* THE HONEST LIMIT the header promises: 22 of 77 live quotations have no subject. A blank must
     score NOTHING here — never a penalty, never a spurious match. */
  eq('a quotation with no subject scores nothing, and is not penalised',
     score(Q({ subject: '' }), MSG({ subject: 'anything at all here' })) - 20, 0);
  eq('  and neither is a message with no subject',
     score(q, MSG({ subject: '' })) - 20, 0);
  eq('qemOverlap returns 0 when either side is empty', [M.qemOverlap('', 'a b c'), M.qemOverlap('a b c', '')], [0, 0]);
  // Stopwords must not manufacture an overlap out of "Re: quotation for your request".
  eq('stopwords alone do not overlap', M.qemOverlap('Re: quotation request', 'FW: quote inquiry'), 0);
}

console.log('\n== 4. the client\'s OWN reference, scored separately from our subject ==');
{
  /* This is the signal that makes the common case work: the rep REPLIES to the client's RFQ, so the
     subject is the client's wording, not ours. Folded into (3) it would lose exactly those. */
  const q = Q({ clientRefNo: 'AKLPRQ/01003908' });
  eq('the exact reference in the subject is worth 15',
     score(q, MSG({ subject: 'RE: AKLPRQ/01003908 jack pallet' })) - 20, 15);
  eq('  and it works off the ref ON FILE too, not only the quotation\'s',
     score(Q({ clientRefNo: '' }), MSG({ subject: 'RE: AKLPRQ/01003908' }),
       { clientRefs: { 'eagle cement corporation': 'AKLPRQ/01003908' } }) - 20, 15);
  eq('a reference shorter than 4 flat chars never fires exact-match',
     score(Q({ clientRefNo: 'A-1' }), MSG({ subject: 'a1 something' })) - 20, 0);
  eq('no reference at all scores nothing', score(Q({ clientRefNo: '' }), MSG({ subject: 'anything' })) - 20, 0);
}

console.log('\n== 5. the date bands, at every boundary ==');
{
  /* A quotation cannot be emailed before it exists — that is what the -30 is for. The bands are
     asserted AT their edges because an off-by-one here silently reorders every suggestion list. */
  const q = Q({ approvedAt: '2026-08-10', date: '2026-08-01' });
  const at = (d) => score(q, MSG({ sentAt: d }));
  eq('2 days before approval  -> -30', at('2026-08-08'), -30);
  eq('1 day before (tolerated) -> +20', at('2026-08-09'), 20);
  eq('same day                 -> +20', at('2026-08-10'), 20);
  eq('+1 day                   -> +20', at('2026-08-11'), 20);
  eq('+2 days                  -> +12', at('2026-08-12'), 12);
  eq('+3 days  (edge)          -> +12', at('2026-08-13'), 12);
  eq('+4 days                  -> +6',  at('2026-08-14'), 6);
  eq('+7 days  (edge)          -> +6',  at('2026-08-17'), 6);
  eq('+8 days                  -> +2',  at('2026-08-18'), 2);
  eq('+14 days (edge)          -> +2',  at('2026-08-24'), 2);
  eq('+15 days                 -> 0',   at('2026-08-25'), 0);

  eq('approvedAt is the anchor, falling back to date',
     score(Q({ approvedAt: '', date: '2026-08-10' }), MSG({ sentAt: '2026-08-10' })), 20);
  eq('an unreadable date scores nothing rather than guessing',
     score(q, MSG({ sentAt: 'not a date' })), 0);
  eq('qemDays is null on either side unusable', [M.qemDays('x', '2026-08-10'), M.qemDays('2026-08-10', '')], [null, null]);
}

console.log('\n== 6. A218 — whose quotation, against whose mailbox ==');
{
  const m = MSG({ sentAt: '2026-08-10' });
  eq('my own quotation, +18',
     score(Q({ salesperson: 'Kimberlyn Blones' }), m, { mailboxOwner: 'Kimberlyn Blones' }) - 20, 18);
  eq('a colleague\'s, -8 — it reorders, it does not veto',
     score(Q({ salesperson: 'Gerald Lucena' }), m, { mailboxOwner: 'Kimberlyn Blones' }) - 20, -8);
  eq('no mailbox owner supplied -> the signal is off entirely',
     score(Q({ salesperson: 'Gerald Lucena' }), m, {}) - 20, 0);
  eq('an unowned quotation is neither rewarded nor punished',
     score(Q({ salesperson: '', createdBy: '' }), m, { mailboxOwner: 'Kimberlyn Blones' }) - 20, 0);
  eq('createdBy stands in when salesperson is blank',
     score(Q({ salesperson: '', createdBy: 'Kimberlyn Blones' }), m, { mailboxOwner: 'Kimberlyn Blones' }) - 20, 18);

  /* The gentleness is the design: the quotation number stays decisive on its own, because somebody
     who wrote it in the subject has told us the answer and may be sending for a colleague. */
  ok('the number (+60) still beats a colleague penalty (-8)',
     score(Q({ quotationNo: '2026-440-NE-ECC', salesperson: 'Gerald Lucena' }),
           MSG({ subject: '2026-440-NE-ECC' }), { mailboxOwner: 'Kimberlyn Blones' }) > 60);
}

console.log('\n== qemIsConfident — both halves, each failing on its own ==');
{
  const r = (...s) => s.map(x => ({ score: x }));
  ok('70 with a 25 gap is confident', M.qemIsConfident(r(70, 45)));
  ok('  69 is not, however clear the gap', !M.qemIsConfident(r(69, 10)));
  ok('  a 24 gap is not, however high the top', !M.qemIsConfident(r(100, 76)));
  ok('a single qualifying candidate is confident', M.qemIsConfident(r(80)));
  ok('a single NON-qualifying one is not', !M.qemIsConfident(r(50)));
  ok('an empty list is never confident', !M.qemIsConfident([]));
  ok('and neither is null', !M.qemIsConfident(null));
}

console.log('\n== ranking order and the date tiebreak ==');
{
  /* The side pane offers the top 3 and the dialog the top 6, so a tiebreak flip silently changes
     what the rep is shown. Equal scores must fall back to NEWEST first. */
  const q = Q({ approvedAt: '2026-08-10' });
  const ranked = M.qemRank(q, [
    MSG({ messageId: 'old@m', sentAt: '2026-08-10' }),
    MSG({ messageId: 'new@m', sentAt: '2026-08-10' })
  ], {});
  eq('equal scores tie-break to the newest', ranked.map(r => r.msg.messageId).length, 2);
  eq('  and both carry the same score', [ranked[0].score, ranked[1].score], [20, 20]);

  const byScore = M.qemRank(Q({ quotationNo: '2026-440-NE-ECC', approvedAt: '2026-08-10' }), [
    MSG({ messageId: 'weak@m', sentAt: '2026-08-10' }),
    MSG({ messageId: 'strong@m', sentAt: '2026-08-10', subject: '2026-440-NE-ECC' })
  ], {});
  eq('score wins over date', byScore.map(r => r.msg.messageId), ['strong@m', 'weak@m']);
  eq('nothing is ever filtered out — a low score is still offered', byScore.length, 2);

  const rq = M.qemRankQuotations(MSG({ subject: '2026-441-XX', sentAt: '2026-08-10' }),
    [Q({ quotationNo: '2026-440-NE-ECC' }), Q({ quotationNo: '2026-441-XX' })], {});
  eq('the reverse direction ranks quotations for one message',
     rq[0].quotation.quotationNo, '2026-441-XX');
}

console.log('\n== qemLearnDomains — only confirmed links teach ==');
{
  const qByNo = { 'Q1': { customer: 'EAGLE CEMENT CORPORATION' }, 'Q2': { customer: 'ACEN' } };
  const learned = M.qemLearnDomains([
    { quotationNo: 'Q1', to: 'a@eagle-cement.com.ph', status: 'Active' },
    { quotationNo: 'Q1', to: 'b@eagle-cement.com.ph; c@eagle-cement.com.ph', status: 'Active' },
    { quotationNo: 'Q1', to: 'd@gmail.com', status: 'Active' },          // free host, ignored
    { quotationNo: 'Q2', to: 'e@acenergy.com.ph', status: 'Unlinked' },  // not confirmed
    { quotationNo: 'Q2', to: 'f@acenergy.com.ph', status: 'Dismissed' }, // not confirmed
    { quotationNo: 'ZZ', to: 'g@nowhere.com', status: 'Active' }         // unknown quotation
  ], qByNo);
  eq('one entry per client, deduped', learned, { 'eagle cement corporation': ['eagle-cement.com.ph'] });
  eq('  a comma/semicolon list is split', M.qemLearnDomains(
     [{ quotationNo: 'Q1', to: 'a@one.com, b@two.com; c@three.com', status: 'Active' }], qByNo),
     { 'eagle cement corporation': ['one.com', 'two.com', 'three.com'] });
  eq('a missing status defaults to Active', M.qemLearnDomains(
     [{ quotationNo: 'Q1', to: 'a@one.com' }], qByNo), { 'eagle cement corporation': ['one.com'] });
}

console.log('\n== the honest limit the header states, pinned so nobody "improves" it ==');
{
  /* First email to a brand-new client, quotation with no subject, no client email on record: there
     is nothing to score but the date. The header says so; this is the number. If a later change
     makes this confident, it is inventing evidence. */
  const bare = M.qemRank(Q({ subject: '', clientRefNo: '', approvedAt: '2026-08-10' }),
    [MSG({ subject: 'Good day sir', sentAt: '2026-08-10', recipients: [{ addr: 'new@brandnew.com' }] })], {});
  eq('it scores on the date alone', bare[0].score, 20);
  ok('and is NOT presented as an answer', !M.qemIsConfident(bare));
}

console.log('\n== rubbish does not throw ==');
{
  [[null, null, null], [undefined, undefined, undefined], [{}, {}, {}],
   [Q(), null, {}], [null, MSG(), {}], [Q({ date: {} }), MSG({ sentAt: [] }), {}]
  ].forEach((args, i) => {
    let threw = false;
    try { M.qemScore.apply(null, args); } catch (e) { threw = true; console.log('    ', e.message); }
    ok('input ' + i + ' does not throw', !threw);
  });
  let threw = false;
  try { M.qemRank(null, null, null); M.qemRankQuotations(null, null, null); M.qemLearnDomains(null, null); }
  catch (e) { threw = true; }
  ok('and neither do the three list helpers', !threw);
}

console.log('\n== THE SNAPSHOT — one quotation, eight messages, the exact order ==');
{
  /* THIS is the assertion that makes the dismissed-plumbing change provable. It must be
     byte-identical before and after. If it moves, the change touched ranking, not plumbing. */
  const q = Q({
    quotationNo: '2026-440-NE-ECC', customer: 'EAGLE CEMENT CORPORATION',
    subject: 'Jack Pallet 2.5 Tons', clientRefNo: 'AKLPRQ/01003908',
    approvedAt: '2026-08-10', salesperson: 'Kimberlyn Blones'
  });
  const ctx = {
    clientDomains: { 'eagle cement corporation': ['eagle-cement.com.ph'] },
    clientEmails:  { 'eagle cement corporation': 'proc@eagle-cement.com.ph' },
    clientRefs:    { 'eagle cement corporation': 'AKLPRQ/01003908' },
    mailboxOwner:  'Kimberlyn Blones',
    dismissed:     { 'noise@m': true },
    linked:        { 'taken@m': '2026-441-OTHER' }
  };
  const to = (a) => [{ addr: a }];
  const msgs = [
    MSG({ messageId: 'number@m',  subject: 'RE: 2026-440-NE-ECC jack pallet', sentAt: '2026-08-10', recipients: to('p@eagle-cement.com.ph') }),
    MSG({ messageId: 'ref@m',     subject: 'RE: AKLPRQ/01003908',             sentAt: '2026-08-11', recipients: to('p@eagle-cement.com.ph') }),
    MSG({ messageId: 'subj@m',    subject: 'Jack Pallet 2.5 Tons',            sentAt: '2026-08-12', recipients: to('p@eagle-cement.com.ph') }),
    MSG({ messageId: 'domain@m',  subject: 'Good day',                        sentAt: '2026-08-13', recipients: to('p@eagle-cement.com.ph') }),
    MSG({ messageId: 'stranger@m',subject: 'Lunch Friday?',                   sentAt: '2026-08-14', recipients: to('mate@gmail.com') }),
    MSG({ messageId: 'early@m',   subject: 'Draft for review',                sentAt: '2026-08-01', recipients: to('p@eagle-cement.com.ph') }),
    MSG({ messageId: 'taken@m',   subject: 'RE: 2026-440-NE-ECC',             sentAt: '2026-08-10', recipients: to('p@eagle-cement.com.ph') }),
    MSG({ messageId: 'noise@m',   subject: 'RE: 2026-440-NE-ECC',             sentAt: '2026-08-10', recipients: to('p@eagle-cement.com.ph') })
  ];
  const ranked = M.qemRank(q, msgs, ctx);
  eq('the order', ranked.map(r => r.msg.messageId),
     ['number@m', 'ref@m', 'subj@m', 'domain@m', 'stranger@m', 'early@m', 'taken@m', 'noise@m']);
  /* Traced by hand, every one, rather than pasted from the output — a snapshot nobody can explain is
     a snapshot that pins a bug as correct:
       number@m 140 = 60 number + 35 learned domain + 7 subject(33%) + 20 same-day + 18 mine
       ref@m     88 = 35 + 15 client ref in subject + 20 (+1 day) + 18
       subj@m    85 = 35 + 20 subject(100%) + 12 (+2 days) + 18
       domain@m  65 = 35 + 12 (+3 days) + 18          — "Good day" is all stopwords, so 0 for subject
       stranger@m 24 =      6 (+4 days) + 18          — gmail earns no domain points
       early@m   23 = 35 - 30 sent before approval + 18                                            */
  eq('the scores', ranked.map(r => r.score), [140, 88, 85, 65, 24, 23, -500, -1000]);
  /* THE INTERESTING PAIR, and the reason it is asserted rather than left implicit: a message to a
     STRANGER on a free mailbox outranks one to the real client, because the client one predates
     approval. That is the -30 doing exactly its job — "a quotation cannot be emailed before it
     exists" — and it is a one-point margin, so any reweighting will trip this line. */
  eq('  a pre-approval email sinks below an unrelated one, by design',
     [ranked[4].msg.messageId, ranked[5].msg.messageId], ['stranger@m', 'early@m']);
  ok('the top one is confident enough to pre-select', M.qemIsConfident(ranked));
  eq('  and the reasons the rep is shown for it', ranked[0].reasons,
     ['quotation number in the subject', 'you have emailed EAGLE CEMENT CORPORATION here before',
      'subject matches (33%)', 'sent the same day', 'your quotation']);
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall ok');
process.exit(fail ? 1 : 0);
