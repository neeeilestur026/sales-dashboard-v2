/* client-visits-week.js — A369 · the week of approved client visits, with the estimated travel allowance of each day
 * (client-visits.html). For the director, accounting and management only: js/client-visits.js loads this file for them
 * and never for a sales rep — Neil, 25 Oct 2026: "make sure that the sales has no trace of the estimated travel
 * allowance". The server leaves the estimate fields out of a rep's reads too. Needs js/client-visits-model.js. */

const CV_WEEK = {
  seg: { key: 'week', label: 'Travel week' },
  lede: { accounting: 'The approved client visits of each day, with the estimated travel allowance.',
          management: 'Every client visit the reps plan, and the approved ones by day with the estimated travel allowance. Read only.' }
};

/* ── the estimate ─────────────────────────────────────────────────────────────────────────── */

/* THE ONE PLACE THE ESTIMATE IS WORKED OUT. Neil, 25 Oct 2026: "in this estimated travel allowance in the accounting
   set aside first on how to be calculated, just put it there". So for now it says "To be set". The server keeps two
   empty columns for it on every visit (Travel Estimate (PHP) and Travel Estimate Basis); once the rule is decided, and
   a visit carries an estimate, the day's estimate is the sum of its visits' — a day with any visit still without one
   stays "To be set". Visits cancelled after approval are never counted. */
function cvTravelEstimate(dayVisits) {
  const live = (dayVisits || []).filter(v => _cvS(v && v.status) !== 'Cancelled');
  if (!live.length) return { amount: 0, text: '—', set: false, count: 0 };
  const set = live.every(v => v.travelEstimate !== null && v.travelEstimate !== undefined && v.travelEstimate !== '' && isFinite(Number(v.travelEstimate)));
  if (!set) return { amount: null, text: 'To be set', set: false, count: live.length };
  const amount = Math.round(live.reduce((t, v) => t + Number(v.travelEstimate), 0) * 100) / 100;
  return { amount, text: '₱' + amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), set: true, count: live.length };
}

/** The week: one row per day per rep, Monday to Sunday, of the visits accounting sees. Each row carries its visits
 *  (time order, cancelled ones kept, struck through on the page) and the day's estimate. */
function cvWeekRows(list, monday, rep) {
  const end = cvAddDays(monday, 6), rows = {}, order = [];
  (list || []).forEach(v => {
    const d = _cvS(v.date);
    if (!cvForAccounting(v) || d < monday || d > end) return;
    if (rep && !_cvSame(v.user, rep)) return;
    const key = d + '|' + _cvS(v.user).toLowerCase();
    if (!rows[key]) { rows[key] = { day: d, user: _cvS(v.user), visits: [] }; order.push(key); }
    rows[key].visits.push(v);
  });
  return order.map(k => rows[k]).sort((a, b) => (a.day === b.day ? a.user.localeCompare(b.user) : (a.day < b.day ? -1 : 1)))
    .map(r => Object.assign(r, { visits: cvSortUp(r.visits), estimate: cvTravelEstimate(r.visits) }));
}
/** The week's total: "To be set" while any day is; the sum once every day has one. */
function cvWeekTotal(rows) { return cvTravelEstimate((rows || []).reduce((a, r) => a.concat(r.visits), [])); }

/* ── on the page ──────────────────────────────────────────────────────────────────────────── */

/** The week stepper over the table. */
function cvWeekToolsHtml() {
  return '<div class="cv-week" role="group" aria-label="Week"><button type="button" class="cv-step" data-week="-7" aria-label="Week before">‹</button>' +
    '<span class="cv-wlabel">' + _cvE(cvWeekLabel(CV.week)) + '</span><button type="button" class="cv-step" data-week="7" aria-label="Week after">›</button>' +
    (CV.week === cvMonday(CV.today) ? '' : '<button type="button" class="dh-btn sm" data-week="now">This week</button>') + '</div>';
}

/** The travel week: one row per day per rep, the approved visits, and the day's estimated travel allowance. */
function cvWeekHtml() {
  const rows = cvWeekRows(CV.plans, CV.week, CV.rep), total = cvWeekTotal(rows);
  const note = '<p class="cv-note">How the estimated travel allowance is worked out is not decided yet, so each day says To be set. Visits cancelled after approval are struck through and not counted.</p>';
  if (!rows.length) return '<p class="cv-empty">No approved client visits in this week.</p>' + note;
  const body = rows.map(r => '<tr><th scope="row" class="cv-wday">' + _cvE(cvDayLabel(r.day, _cvYear())) + '</th><td class="cv-wrep">' + _cvE(r.user) + '</td><td class="cv-wvis"><ul>' +
    r.visits.map(v => '<li' + (v.status === 'Cancelled' ? ' class="off"' : '') + '><button type="button" class="cv-link" data-open="' + _cvE(v.visitPlanNo) + '">' + _cvE(v.company) + '</button>' +
      '<span class="cv-sub">' + _cvE([cvClock(v.time), cvTown(v.address)].filter(Boolean).join(' · ')) + (v.status === 'Cancelled' ? ' · cancelled' : v.status === 'Done' ? ' · done' : '') + '</span></li>').join('') +
    '</ul></td><td class="cv-west' + (r.estimate.set ? '' : ' unset') + '" data-label="Estimated travel allowance">' + _cvE(r.estimate.text) + '</td></tr>').join('');
  return '<div class="cv-tablewrap"><table class="cv-table"><caption class="cv-vh">Approved client visits, ' + _cvE(cvWeekLabel(CV.week)) + '</caption>' +
    '<thead><tr><th scope="col">Day</th><th scope="col">Rep</th><th scope="col">Approved visits</th><th scope="col" class="cv-west">Estimated travel allowance</th></tr></thead><tbody>' + body + '</tbody>' +
    '<tfoot><tr><th scope="row" colspan="3">Week total</th><td class="cv-west' + (total.set ? '' : ' unset') + '">' + _cvE(total.text) + '</td></tr></tfoot></table></div>' + note;
}

/** The estimate line on one visit, for the visit's sheet. `fact` draws a line of it. */
function cvWeekFact(v, fact) { return fact('Estimated travel allowance', '<span class="cv-unset">' + _cvE(cvTravelEstimate([v]).text) + '</span>'); }
