/* A216 — the plan-vs-actual join.
 *
 * What this file exists to hold down:
 *   • an exact link and a name guess are NEVER added together — the moment "matched" includes a
 *     guess, an approver is reading an invented number and cannot tell;
 *   • nothing is dropped: every visit is matched, likely, dangling, duplicate or unplanned, and
 *     every planned stop is matched, likely or missed;
 *   • a rep who logged visits and filed no plan is visible, because that is the one finding the
 *     system cannot tell anyone today;
 *   • a link pointing at a Seq that no longer exists degrades to "dangling", not to a crash and not
 *     to a silent "unplanned" — _writeItems re-appends every row on save, so this WILL happen.
 *
 * itinerary-week.js is pure and dependency-free, so it is required directly rather than through the
 * vm harness the flow-api-coupled modules need.
 */
const E = require('../../dashboard/js/itinerary-week.js');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l, '=', JSON.stringify(g)); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];

let _seq = 0;
const ITEM = (o) => Object.assign({ seq: ++_seq, day: 'Mon', date: WEEK[0], plannedTime: '09:00',
  company: 'A Client Corp', personToMeet: 'Sir X', cityArea: 'Makati', purpose: 'Client visit',
  agenda: '', expectedOutcome: '' }, o);
const ITIN = (o) => Object.assign({ itineraryNo: 'ITIN-202608-001', weekStart: WEEK[0], weekEnd: WEEK[6],
  user: 'Kimberlyn Blones', status: 'Pending Management', objectives: '', notes: '', items: [] }, o);
let _v = 0;
const VISIT = (o) => Object.assign({ visitNo: 'CV-' + (++_v), date: WEEK[0], user: 'Kimberlyn Blones',
  time: '10:00', personVisited: 'Sir X', company: 'A Client Corp', cityAddress: 'Makati',
  agenda: '', summaryOfAgenda: '', photoDocId: 'doc1', itineraryItem: '' }, o);

const run = (itins, visits, roster, opts) => E.itineraryWeek(WEEK, itins, visits, roster || [], opts || {});
const rep = (r, name) => r.reps.find(x => x.rep === name);

console.log('== company names, the messy free text this has to survive ==');
{
  eq('legal suffixes are noise', E.iwCanonCompany('Cagdianao Mining Corp.'), 'cagdianao mining');
  eq('descriptive words are NOT noise', E.iwCanonCompany('FDC Misamis Power Corporation'), 'fdc misamis power');
  eq('blank stays blank', E.iwCanonCompany('   '), '');
  ok('a suffix-only difference is the same client', E.iwSameCompany('Mabuhay Vinyl Corporation', 'mabuhay vinyl'));
  ok('the short live name matches the long planned one',
     E.iwSameCompany('Cagdianao Mining Corp', 'Cagdianao'));
  ok('a leading-word match counts', E.iwSameCompany('Apex', 'Apex Mining Co'));
  ok('two different clients in one town do not collide',
     !E.iwSameCompany('FDC Misamis Power Corp', 'Misamis Oriental Cement'));
  /* The live pair that caught the sentinel bug. Both canonicalise to 15 characters, and the old
     suffix test compared indexOf's -1 against a computed -1, so it said yes — putting "Taiheiyo
     Cement visited as planned" on an approver's screen against a Taganito stop. Any two distinct
     names of equal canonical length were matching. */
  ok('two unrelated names of the SAME canonical length do not match',
     !E.iwSameCompany('Taganito Mining Corporation ', 'Taiheiyo Cement Corporation'));
  eq('...and they really are the same length',
     [E.iwCanonCompany('Taganito Mining Corporation ').length,
      E.iwCanonCompany('Taiheiyo Cement Corporation').length], [15, 15]);
  ok('the general case: equal length and not identical is never a match',
     !E.iwSameCompany('alpha beta', 'gamma delta'));
  /* "ecc" is a real live company name. Three letters inside a longer name is a coincidence, not a
     client, so containment is refused below four characters. */
  ok('a 3-letter name never matches by containment', !E.iwSameCompany('ecc', 'eccentric holdings'));
  ok('...but still matches itself exactly', E.iwSameCompany('ECC', 'ecc corp'));
  ok('blank matches nothing', !E.iwSameCompany('', 'Anything'));
}

console.log('\n== the link, in every shape the sheet can hold it ==');
{
  eq('the documented format', E.iwParseLink('ITIN-202608-001#3'), { itineraryNo: 'ITIN-202608-001', seq: 3 });
  eq('blank is not a link', E.iwParseLink(''), null);
  eq('no hash is not a link', E.iwParseLink('ITIN-202608-001'), null);
  eq('a trailing hash is not a link', E.iwParseLink('ITIN-202608-001#'), null);
  eq('a non-numeric seq is not a link', E.iwParseLink('ITIN-202608-001#abc'), null);
  eq('a leading hash is not a link', E.iwParseLink('#3'), null);
}

console.log('\n== exact links are the only thing counted as matched ==');
{
  const it = ITIN({ items: [ITEM({ seq: 1, company: 'Taganito Mining Corp' }),
                            ITEM({ seq: 2, company: 'Hinatuan Mining Corp' })] });
  const r = run([it], [VISIT({ company: 'Taganito Mining Corp', itineraryItem: 'ITIN-202608-001#1' })]);
  const k = rep(r, 'Kimberlyn Blones');
  eq('one stop matched', k.counts.matched, 1);
  eq('and nothing was guessed', k.counts.likely, 0);
  eq('the other stop is missed', k.counts.missed, 1);
  eq('no visit is left unplanned', k.counts.unplanned, 0);
  eq('the item knows how', k.items[0].match.kind, 'exact');
}

console.log('\n== a name guess is reported separately and never added in ==');
{
  const it = ITIN({ items: [ITEM({ seq: 1, company: 'Cagdianao Mining Corp' })] });
  const r = run([it], [VISIT({ date: WEEK[3], company: 'Cagdianao' })]);   // planned Mon, visited Thu
  const k = rep(r, 'Kimberlyn Blones');
  eq('matched stays at zero — nobody linked anything', k.counts.matched, 0);
  eq('the guess is counted on its own line', k.counts.likely, 1);
  eq('and the visit is not also called unplanned', k.counts.unplanned, 0);
  eq('the visit carries the planned date so the page can say "planned Mon, visited Thu"',
     k.visits[0].match.plannedDate, WEEK[0]);
  eq('the stop is not counted as missed either', k.counts.missed, 0);
}

console.log('\n== an exact link outranks a guess competing for the same stop ==');
{
  const it = ITIN({ items: [ITEM({ seq: 1, company: 'Taganito Mining Corp' })] });
  const r = run([it], [
    VISIT({ visitNo: 'CV-A', company: 'Taganito' }),                                    // would guess
    VISIT({ visitNo: 'CV-B', company: 'Somewhere Else', itineraryItem: 'ITIN-202608-001#1' })
  ]);
  const k = rep(r, 'Kimberlyn Blones');
  eq('the linked visit takes the stop', k.items[0].match.visitNo, 'CV-B');
  eq('it counts as matched', k.counts.matched, 1);
  eq('nothing is double counted', k.counts.likely, 0);
  eq('and the guess falls back to unplanned', k.counts.unplanned, 1);
}

console.log('\n== a link whose stop was deleted by a later revise ==');
{
  const it = ITIN({ items: [ITEM({ seq: 1 })] });                       // seq 7 is long gone
  const r = run([it], [VISIT({ company: 'Nothing Alike', itineraryItem: 'ITIN-202608-001#7' })]);
  const k = rep(r, 'Kimberlyn Blones');
  eq('it is dangling, not matched', k.counts.dangling, 1);
  eq('and it does not quietly become unplanned', k.counts.unplanned, 0);
  eq('nothing was matched', k.counts.matched, 0);
  eq('the ref is kept so the page can show what it pointed at', k.visits[0].match.ref, 'ITIN-202608-001#7');
}
{
  const it = ITIN({ items: [ITEM({ seq: 1 })] });
  const r = run([it], [VISIT({ itineraryItem: 'ITIN-202607-009#1' })]);  // another week's plan
  eq('a link to a different itinerary is dangling too',
     rep(r, 'Kimberlyn Blones').counts.dangling, 1);
}
{
  const r = run([], [VISIT({ itineraryItem: 'ITIN-202608-001#1' })]);    // link but no plan at all
  eq('a link with no itinerary behind it does not throw',
     rep(r, 'Kimberlyn Blones').counts.dangling, 1);
}

console.log('\n== two visits linked to one stop ==');
{
  const it = ITIN({ items: [ITEM({ seq: 1 })] });
  const r = run([it], [VISIT({ visitNo: 'CV-A', itineraryItem: 'ITIN-202608-001#1' }),
                       VISIT({ visitNo: 'CV-B', itineraryItem: 'ITIN-202608-001#1' })]);
  const k = rep(r, 'Kimberlyn Blones');
  eq('the stop is matched once, not twice', k.counts.matched, 1);
  eq('the second is flagged a duplicate', k.visits[1].match.kind, 'duplicate');
  eq('and is not miscounted as unplanned', k.counts.unplanned, 0);
}

console.log('\n== the rep who filed nothing — the live Gerald case ==');
{
  const r = run([], [VISIT({ user: 'Gerald Lucena', date: WEEK[2] }),
                     VISIT({ user: 'Gerald Lucena', date: WEEK[3] })]);
  const g = rep(r, 'Gerald Lucena');
  ok('he is on the rail at all', !!g);
  eq('flagged, not filed', g.bucket, 'no-plan');
  eq('his visits are still all there', g.counts.logged, 2);
  eq('all of them unplanned', g.counts.unplanned, 2);
  eq('and the week total says so once', r.totals.noPlanButVisited, 1);
}

console.log('\n== a rep on the roster who did nothing at all ==');
{
  const r = run([], [], [{ fullName: 'Crystal Gayle', role: 'sales' }]);
  const c = rep(r, 'Crystal Gayle');
  ok('still on the rail — a full roster, not a filter', !!c);
  eq('but at the bottom', c.bucket, 'idle');
  eq('no plan', c.itinerary, null);
  eq('no visits', c.counts.logged, 0);
}
{
  const r = run([], [], [{ fullName: 'Aida Cruz', role: 'accounting' }]);
  eq('non-sales roles are not on a field-plan rail', r.reps.length, 0);
}

console.log('\n== a plan with no visits against it ==');
{
  const it = ITIN({ status: 'Approved', items: [ITEM({ seq: 1 }), ITEM({ seq: 2 })] });
  const k = rep(run([it], []), 'Kimberlyn Blones');
  eq('every stop is missed', k.counts.missed, 2);
  eq('nothing matched', k.counts.matched, 0);
  eq('nothing logged', k.counts.logged, 0);
}

console.log('\n== the rail order — what the viewer can act on comes first ==');
{
  const mine = ITIN({ itineraryNo: 'ITIN-A', user: 'Dave', status: 'Pending Management' });
  const theirs = ITIN({ itineraryNo: 'ITIN-B', user: 'Bea', status: 'Pending Director' });
  const done = ITIN({ itineraryNo: 'ITIN-C', user: 'Ann', status: 'Approved' });
  const r = run([mine, theirs, done], [VISIT({ user: 'Cy' })], [], { viewerRole: 'management' });
  eq('acts-on-me, then no-plan, then someone else\'s queue, then settled',
     r.reps.map(x => x.rep), ['Dave', 'Cy', 'Bea', 'Ann']);
  eq('and the count of what is waiting on this viewer', r.totals.needsYou, 1);
  eq('only that rep is flagged', rep(r, 'Dave').needsYou, true);
  ok('the director\'s stage is not this viewer\'s work', rep(r, 'Bea').needsYou === false);
}
{
  const theirs = ITIN({ user: 'Bea', status: 'Pending Director' });
  const r = run([theirs], [], [], { viewerRole: 'director' });
  eq('the same plan IS the director\'s work', rep(r, 'Bea').bucket, 'needs-you');
}
{
  const r = run([ITIN({ user: 'Bea', status: 'Pending Director' })], [], [], { viewerRole: 'admin' });
  eq('a read-only viewer is never told to act', rep(r, 'Bea').bucket, 'pending');
  eq('and the banner count stays at zero', r.totals.needsYou, 0);
}

console.log('\n== the week boundary ==');
{
  const other = ITIN({ weekStart: '2026-07-27', items: [ITEM({ date: '2026-07-27' })] });
  const roster = [{ fullName: 'Kimberlyn Blones', role: 'sales' }];
  const r = run([other], [VISIT({ date: '2026-07-28' })], roster);
  eq('another week\'s plan is not shown here', rep(r, 'Kimberlyn Blones').itinerary, null);
  eq('nor its visits', rep(r, 'Kimberlyn Blones').counts.logged, 0);
  // With nothing of hers inside the week she is on the rail only because the roster carries her.
  eq('and without the roster she would not appear at all', run([other], [VISIT({ date: '2026-07-28' })]).reps.length, 0);
}
{
  // A stop dated outside its own week would otherwise render on no day card at all.
  const it = ITIN({ items: [ITEM({ seq: 1, date: WEEK[0] }), ITEM({ seq: 2, date: '2026-08-20' })] });
  const k = rep(run([it], []), 'Kimberlyn Blones');
  eq('the out-of-week stop is still counted', k.counts.planned, 2);
  eq('and collected rather than dropped', k.strays.length, 1);
  eq('the day cards hold only the rest',
     k.days.reduce((s, d) => s + d.planned.length, 0), 1);
}
{
  const r = run([], []);
  eq('an empty week is an empty rail, not a crash', r.reps.length, 0);
  eq('and every total is zero',
     [r.totals.planned, r.totals.logged, r.totals.matched, r.totals.likely], [0, 0, 0, 0]);
}

console.log('\n== every day of the week is present, in order, even when empty ==');
{
  const it = ITIN({ items: [ITEM({ date: WEEK[4] })] });
  const k = rep(run([it], []), 'Kimberlyn Blones');
  eq('seven day cards', k.days.length, 7);
  eq('Monday first', k.days[0].day, 'Mon');
  eq('the stop lands on its own day', k.days[4].planned.length, 1);
  eq('the empty ones are still there', k.days[1].planned.length, 0);
}

console.log('\n== nothing is lost: the parts add up to the whole ==');
{
  const it = ITIN({ items: [ITEM({ seq: 1, company: 'Taganito Mining Corp' }),
                            ITEM({ seq: 2, company: 'Cagdianao Mining Corp' }),
                            ITEM({ seq: 3, company: 'Mabuhay Vinyl Corporation' })] });
  const k = rep(run([it], [
    VISIT({ company: 'Taganito', itineraryItem: 'ITIN-202608-001#1' }),   // exact
    VISIT({ company: 'Cagdianao', date: WEEK[2] }),                       // likely
    VISIT({ company: 'Walk-in Trader' }),                                 // unplanned
    VISIT({ company: 'Anyone', itineraryItem: 'ITIN-202608-001#9' })      // dangling
  ]), 'Kimberlyn Blones');
  eq('every visit is accounted for exactly once',
     k.counts.matched + k.counts.likely + k.counts.unplanned + k.counts.dangling, k.counts.logged);
  eq('every planned stop is accounted for exactly once',
     k.counts.matched + k.counts.likely + k.counts.missed, k.counts.planned);
  eq('and the day cards hold every visit',
     k.days.reduce((s, d) => s + d.visits.length, 0), k.counts.logged);
}

console.log('\n== planned times render for a human, whatever the sheet returned ==');
{
  eq('24-hour becomes 12-hour', E.iwTime12('15:30'), '3:30 PM');
  eq('midnight', E.iwTime12('00:05'), '12:05 AM');
  eq('noon', E.iwTime12('12:00'), '12:00 PM');
  eq('a single-digit hour', E.iwTime12('9:00'), '9:00 AM');
  eq('seconds are ignored', E.iwTime12('15:30:00'), '3:30 PM');
  eq('blank stays blank', E.iwTime12(''), '');
  eq('free text the rep typed is left alone', E.iwTime12('after lunch'), 'after lunch');
  eq('and an impossible hour is not dressed up as a time', E.iwTime12('99:00'), '99:00');
  /* Until FLOW_VERSION 121 is pasted the live backend still sends the whole 1899 Date. The page has
     to be right on BOTH sides of that deploy, so the anchor date is recognised and +8 applied to the
     UTC parts — 02:00Z is 10:00 in Manila, which is what the sheet cell actually says. */
  eq('an older backend\'s 1899 timestamp', E.iwTime12('1899-12-30T02:00:00.000Z'), '10:00 AM');
  eq('and one that wraps past midnight', E.iwTime12('1899-12-30T17:30:00.000Z'), '1:30 AM');
}

console.log('\n== nulls and rubbish from the sheet do not take the page down ==');
{
  const r = E.itineraryWeek(WEEK, [null, ITIN({ items: null })], [null, VISIT({})], null, null);
  ok('a null itinerary row is skipped', !!rep(r, 'Kimberlyn Blones'));
  eq('a null items array reads as no stops', rep(r, 'Kimberlyn Blones').counts.planned, 0);
  eq('the real visit survives', rep(r, 'Kimberlyn Blones').counts.logged, 1);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
