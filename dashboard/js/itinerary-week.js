/* A216 — one week of field plans against what actually happened. Pure, DOM-free, table-tested.
 *
 * The whole point of this module is the join, and the join is the part that can lie. There are three
 * ways a visit can relate to a planned stop and they are NOT equally trustworthy:
 *
 *   exact    the rep picked the stop from a dropdown when logging the visit, so ClientVisits carries
 *            '<Itinerary No>#<Seq>'. This is a fact. It is the only thing counted as "matched".
 *   likely   nobody linked anything, but a visit and a planned stop name the same company in the same
 *            week. This is a guess, it is labelled as one everywhere it appears, and it is counted on
 *            its own line — never folded into the matched figure.
 *   dangling the visit carries a link whose Seq no longer exists, because _writeItems (FlowAPI.gs:1174)
 *            deletes and re-appends every item row on save, so a revise that drops a stop orphans any
 *            visit already logged against it. Shown as such rather than silently counted as unplanned.
 *
 * The link column has existed since A190 and nothing in the repo has ever parsed it — every reader
 * treats it as a truthy flag. This is the first code to resolve it back to a stop, so it has to
 * tolerate every way it can be wrong.
 *
 * On today's data every match is 'likely': the visit picker only offers Approved plans
 * (report.js:359) and no plan has ever reached Approved, so the link is blank on all ten live visits.
 * That is exactly why the two kinds are kept apart — for a while the honest headline is zero.
 */

const IW_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* Rail order. A director/manager opens this page to do something, so what they can act on sorts
   first; the rep who went out with no plan at all is second, because that is the finding nobody
   gets told about today. Everything settled sinks. */
const IW_RANK = {
  'needs-you': 0,   // sitting at this viewer's approval stage
  'no-plan': 1,     // logged visits but never filed a plan
  'pending': 2,     // waiting on the OTHER approver
  'draft': 3,       // started, never submitted
  'rejected': 4,
  'approved': 5,
  'idle': 6         // no plan and no visits — present so the rail is a full roster, not a filter
};

/** Words that carry no identity in a Philippine company name. Stripped before comparing, so
 *  "Cagdianao Mining Corp." and "Cagdianao" can be seen as the same client. Descriptive words like
 *  "mining" or "power" are deliberately KEPT — they are how two clients in the same town differ. */
const IW_NOISE = { corp: 1, corporation: 1, inc: 1, incorporated: 1, co: 1, company: 1, ltd: 1,
                   limited: 1, the: 1, and: 1, of: 1, philippines: 1, phils: 1, phil: 1 };

function _iwStr(v) { return String(v == null ? '' : v).trim(); }

/** One normalisation for every person key. ActivityLog 'User', the roster's fullName, ClientVisits
 *  'User' and WeeklyItineraries 'User' all originate from session.name; any drift here splits one
 *  person into two rail cards. Same rule as _tpKey (team-performance.js:33). */
function iwKey(n) { return _iwStr(n); }

/** Free text → comparable tokens. Live company names are genuinely this messy: "ecc",
 *  "isri mining", "east coast minerals", "Cagdianao Mining Corp." */
function iwCanonCompany(s) {
  return _iwStr(s).toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()"']/g, ' ')
    .split(/\s+/)
    .filter(w => w && !IW_NOISE[w])
    .join(' ');
}

/** Do two company names plausibly mean the same client? Either identical once canonicalised, or the
 *  shorter is a whole-word prefix or suffix of the longer ("Cagdianao" of "Cagdianao Mining Corp").
 *  Containment needs 4+ characters, because "ecc" inside "eccentric" is not a client.
 *
 *  The strict `shorter.length >= longer.length` bail is load-bearing, not a tidy-up. This was first
 *  written with `longer.indexOf(' ' + shorter) === longer.length - shorter.length - 1` as the
 *  suffix test, and when the two names canonicalise to the SAME LENGTH both sides evaluate to -1:
 *  indexOf's not-found sentinel collided with the expected index, so every pair of equal-length
 *  names matched. On live data that married "Taiheiyo Cement Corporation" to a planned stop at
 *  "Taganito Mining Corporation" — both 15 characters once canonicalised — and reported it on the
 *  page as a visit that fulfilled the plan. Compare lengths first and there is no sentinel to trip
 *  over. */
function iwSameCompany(a, b) {
  const x = iwCanonCompany(a), y = iwCanonCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y, longer = x.length <= y.length ? y : x;
  if (shorter.length < 4 || shorter.length >= longer.length) return false;
  return longer.indexOf(shorter + ' ') === 0 ||
         longer.slice(longer.length - shorter.length - 1) === ' ' + shorter;
}

/** '<Itinerary No>#<Seq>' → {itineraryNo, seq}, or null when the cell is blank or malformed.
 *  Malformed is treated as blank rather than thrown: this string is free-form in the sheet. */
function iwParseLink(v) {
  const s = _iwStr(v);
  if (!s) return null;
  const i = s.lastIndexOf('#');
  if (i <= 0 || i === s.length - 1) return null;
  const seq = Number(s.slice(i + 1));
  if (!isFinite(seq)) return null;
  return { itineraryNo: s.slice(0, i), seq: seq };
}

/** Sheets time cells and typed strings both end up in 'Planned Time'. Render either as 3:30 PM.
 *
 *  Three inputs, because the backend deploy trails this repo by design and the page has to be right
 *  on both sides of the next paste:
 *    'HH:mm'                     what _timeOfDay returns from FLOW_VERSION 121 (A216)
 *    '1899-12-30T02:00:00.000Z'  what an older backend sends — Sheets anchors a time-only cell to
 *                                1899-12-30 and JSON.stringify hands over the whole Date. The +8 is
 *                                applied to the UTC parts directly, because Manila's 1899 tzdata
 *                                entry is Local Mean Time (+08:04) and would shift every time by
 *                                four minutes.
 *  Anything else is passed through untouched, so a rep who typed "after lunch" still sees it. */
function iwTime12(v) {
  const s = _iwStr(v);
  let h, mm;
  const hm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  const iso = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(s);
  if (hm) { h = Number(hm[1]); mm = hm[2]; }
  else if (iso) { h = (Number(iso[1]) + 8) % 24; mm = iso[2]; }
  else return s;
  if (h > 23) return s;
  const ampm = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ':' + mm + ' ' + ampm;
}

/* ── the week ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Merge one Mon–Sun week of plans and visits into something a page can render directly.
 *
 * @param {string[]} week   seven 'yyyy-MM-dd', Mon first — from flowWeekDates()
 * @param {object[]} itins  getWeeklyItineraries rows (any weeks; filtered here to week[0])
 * @param {object[]} visits getClientVisits rows (any dates; filtered here to the week)
 * @param {object[]} roster apiFetchEmailUsers().users — [{fullName, username, role}]
 * @param {object}  [opts]  {viewerRole, roles:['sales'], sameDayOnly:false}
 * @returns {{week, weekStart, weekEnd, reps, totals}}
 */
function itineraryWeek(week, itins, visits, roster, opts) {
  const w = (week || []).slice(0, 7);
  const o = opts || {};
  const viewerRole = String(o.viewerRole || '').toLowerCase();
  const wantRoles = o.roles || ['sales'];
  const inWeek = {}; w.forEach(d => { inWeek[d] = true; });

  const plans = {};                       // rep → itinerary for THIS week
  (itins || []).forEach(it => {
    if (!it || it.weekStart !== w[0]) return;
    const k = iwKey(it.user);
    // Two rows for one rep and one week should be impossible (saveWeeklyItinerary upserts on
    // user+weekStart) — if it ever happens, keep the one furthest along rather than the last read.
    if (!plans[k] || _iwStage(it) > _iwStage(plans[k])) plans[k] = it;
  });

  const byRep = {};                       // rep → visits inside the week
  (visits || []).forEach(v => {
    if (!v || !inWeek[_iwStr(v.date)]) return;
    (byRep[iwKey(v.user)] = byRep[iwKey(v.user)] || []).push(v);
  });

  // The roster has to be a union. A rep who filed nothing appears in neither plans nor visits, and
  // the rail exists partly to show that; a rep who left the company still owns last week's visits.
  const names = {};
  (roster || []).forEach(u => {
    const role = String(u && u.role || '').toLowerCase();
    if (wantRoles.indexOf(role) < 0) return;
    // getUsers calls it 'name'; the email roster calls it 'fullName'. Accept either rather than
    // caring which endpoint fed us.
    const k = iwKey(u.fullName || u.name || u.username);
    if (k) names[k] = true;
  });
  Object.keys(plans).forEach(k => { names[k] = true; });
  Object.keys(byRep).forEach(k => { names[k] = true; });

  const reps = Object.keys(names).sort().map(rep =>
    _iwRep(rep, w, plans[rep] || null, byRep[rep] || [], viewerRole, !!o.sameDayOnly));

  reps.sort((a, b) => (IW_RANK[a.bucket] - IW_RANK[b.bucket]) || a.rep.localeCompare(b.rep));

  const totals = { reps: reps.length, plansFiled: 0, needsYou: 0, noPlanButVisited: 0,
                   planned: 0, logged: 0, matched: 0, likely: 0, unplanned: 0, dangling: 0, missed: 0 };
  reps.forEach(r => {
    if (r.itinerary) totals.plansFiled++;
    if (r.needsYou) totals.needsYou++;
    if (r.bucket === 'no-plan') totals.noPlanButVisited++;
    ['planned', 'logged', 'matched', 'likely', 'unplanned', 'dangling', 'missed']
      .forEach(k => { totals[k] += r.counts[k]; });
  });

  return { week: w, weekStart: w[0], weekEnd: w[6], reps, totals };
}

/** How far along the approval chain a plan is — only used to break an impossible duplicate. */
function _iwStage(it) {
  const s = _iwStr(it && it.status) || 'Draft';
  return { 'Draft': 0, 'Rejected': 1, 'Pending Director': 2, 'Pending Management': 3, 'Approved': 4 }[s] || 0;
}

function _iwRep(rep, week, itin, visits, viewerRole, sameDayOnly) {
  const status = itin ? (_iwStr(itin.status) || 'Draft') : '';
  const items = (itin && itin.items ? itin.items : []).map(it => Object.assign({}, it, { match: null }));
  const vs = visits.map(v => Object.assign({}, v, { match: null }));

  // 1 — exact links first, so a real link always wins a stop that a guess might also have claimed.
  const bySeq = {};
  items.forEach(it => { bySeq[String(Number(it.seq) || 0)] = it; });
  vs.forEach(v => {
    const link = iwParseLink(v.itineraryItem);
    if (!link) return;
    if (itin && link.itineraryNo === itin.itineraryNo && bySeq[String(link.seq)]) {
      const it = bySeq[String(link.seq)];
      // One stop, one visit: a second link to the same Seq is a duplicate log, not a second match.
      if (it.match) { v.match = { kind: 'duplicate', seq: link.seq }; return; }
      it.match = { kind: 'exact', visitNo: v.visitNo, date: v.date };
      v.match = { kind: 'exact', seq: link.seq, plannedDate: it.date };
    } else {
      v.match = { kind: 'dangling', ref: _iwStr(v.itineraryItem) };
    }
  });

  // 2 — then the guess, over what is left on both sides. Ordered by seq so the result does not
  //     depend on the order the sheet happened to return rows in.
  vs.filter(v => !v.match).forEach(v => {
    const hit = items.filter(it => !it.match)
      .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0))
      .find(it => (!sameDayOnly || it.date === v.date) && iwSameCompany(it.company, v.company));
    if (!hit) return;
    hit.match = { kind: 'likely', visitNo: v.visitNo, date: v.date };
    v.match = { kind: 'likely', seq: hit.seq, plannedDate: hit.date };
  });

  const days = week.map((date, i) => ({
    date, day: IW_DAYS[i],
    planned: items.filter(it => _iwStr(it.date) === date)
      .sort((a, b) => _iwStr(a.plannedTime).localeCompare(_iwStr(b.plannedTime)) ||
                      (Number(a.seq) || 0) - (Number(b.seq) || 0)),
    visits: vs.filter(v => _iwStr(v.date) === date)
      .sort((a, b) => _iwStr(a.time).localeCompare(_iwStr(b.time)))
  }));

  /* Stops planned on a day outside the week they belong to would vanish from every day card, so
     they are collected rather than dropped — a plan is not allowed to be partly invisible. */
  const inWeek = {}; week.forEach(d => { inWeek[d] = true; });
  const strays = items.filter(it => !inWeek[_iwStr(it.date)]);

  const counts = {
    planned: items.length,
    logged: vs.length,
    matched: items.filter(it => it.match && it.match.kind === 'exact').length,
    likely: items.filter(it => it.match && it.match.kind === 'likely').length,
    unplanned: vs.filter(v => !v.match).length,
    dangling: vs.filter(v => v.match && v.match.kind === 'dangling').length,
    missed: items.filter(it => !it.match).length
  };

  const needsYou = !!itin && (
    (status === 'Pending Director' && viewerRole === 'director') ||
    (status === 'Pending Management' && viewerRole === 'management'));

  let bucket;
  if (needsYou) bucket = 'needs-you';
  else if (!itin) bucket = vs.length ? 'no-plan' : 'idle';
  else if (status.indexOf('Pending') === 0) bucket = 'pending';
  else if (status === 'Rejected') bucket = 'rejected';
  else if (status === 'Approved') bucket = 'approved';
  else bucket = 'draft';

  return { rep, itinerary: itin, status, items, visits: vs, days, strays, counts, needsYou, bucket };
}

/* Node/tests reach these through the vm context; the browser gets them as globals. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { itineraryWeek, iwCanonCompany, iwSameCompany, iwParseLink, iwTime12, iwKey,
                     IW_DAYS, IW_RANK };
}
