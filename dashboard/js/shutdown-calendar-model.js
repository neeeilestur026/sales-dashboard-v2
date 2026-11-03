/* shutdown-calendar-model.js — A391 · the shutdown calendar's dates, grid and words (shutdown-calendar.html, the sales
 * home card), pure and tested in node (tests/flow/shutdown-calendar.js). Dates are yyyy-MM-dd strings and every sum is
 * done on UTC midnights, so no timezone can move a day. */

const SHDM_STATUSES = ['Tentative', 'Confirmed', 'Postponed', 'Done'];
const SHDM_OFFERS = ['Sale', 'Rental', 'Service'];
const SHDM_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHDM_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function _shdmUtc(ymd) { return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)); }
function shdmIsDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(_shdmUtc(String(s))); }
function shdmAddDays(ymd, n) { return new Date(_shdmUtc(ymd) + n * 86400000).toISOString().slice(0, 10); }
function shdmDiff(a, b) { return Math.round((_shdmUtc(b) - _shdmUtc(a)) / 86400000); }
/** The Monday on or before a day. */
function shdmMonday(ymd) { const dow = new Date(_shdmUtc(ymd)).getUTCDay(); return shdmAddDays(ymd, -((dow + 6) % 7)); }
function shdmStepMonth(ym, n) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n, d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 7); }
function shdmMonthLabel(ym) { return SHDM_MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
/** "Tue 10 Nov", with the year when it is not this year's. */
function shdmDay(ymd, today) {
  if (!shdmIsDate(ymd)) return '';
  const d = new Date(_shdmUtc(ymd));
  return SHDM_DOW[(d.getUTCDay() + 6) % 7] + ' ' + d.getUTCDate() + ' ' + SHDM_MONTHS[d.getUTCMonth()].slice(0, 3) + (today && ymd.slice(0, 4) !== today.slice(0, 4) ? ' ' + ymd.slice(0, 4) : '');
}
/** "10–17 Nov", "28 Nov – 3 Dec", "10 Nov" (one day), with the year when it is not this year's. */
function shdmRangeLabel(s, e, today) {
  if (!shdmIsDate(s)) return '';
  e = shdmIsDate(e) && e >= s ? e : s;
  const ds = new Date(_shdmUtc(s)), de = new Date(_shdmUtc(e)), mon = (d) => SHDM_MONTHS[d.getUTCMonth()].slice(0, 3);
  const yr = today && (s.slice(0, 4) !== today.slice(0, 4) || e.slice(0, 4) !== today.slice(0, 4)) ? ' ' + e.slice(0, 4) : '';
  if (s === e) return ds.getUTCDate() + ' ' + mon(ds) + yr;
  if (s.slice(0, 7) === e.slice(0, 7)) return ds.getUTCDate() + '–' + de.getUTCDate() + ' ' + mon(de) + yr;
  return ds.getUTCDate() + ' ' + mon(ds) + ' – ' + de.getUTCDate() + ' ' + mon(de) + yr;
}
/** How far off it is, in words: "under way", "today", "tomorrow", "in 5 days", "ended". */
function shdmSoon(it, today) {
  if (!it || !shdmIsDate(it.start)) return '';
  const end = shdmIsDate(it.end) ? it.end : it.start;
  if (end < today) return 'ended';
  if (it.start <= today) return 'under way';
  const n = shdmDiff(today, it.start);
  return n === 1 ? 'tomorrow' : 'in ' + n + ' days';
}

/**
 * The month grid with multi-day bars. Rows are weeks, Monday first, from the Monday on or before the 1st to the Sunday on
 * or after the last day (4–6 rows). Each entry is clipped to each row it crosses and put in the first lane free from its
 * first column (greedy lane packing per row, as a calendar app does); lanes past maxLanes count into more[day].
 * Returns { ym, label, weeks: [{ start, days: [{date, day, inMonth, today, count}], bars: [{no, lane, col, span, contL, contR, item}], more, lanes }] }.
 */
function shdmMonthGrid(ym, items, o) {
  o = o || {};
  const maxLanes = o.maxLanes || 3, today = o.today || '';
  const first = ym + '-01', last = shdmAddDays(shdmStepMonth(ym, 1) + '-01', -1);
  const gridStart = shdmMonday(first), gridEnd = shdmAddDays(shdmMonday(last), 6);
  const live = (items || []).filter(it => it && shdmIsDate(it.start) && (o.archived || !it.archived))
    .map(it => ({ it, s: it.start, e: shdmIsDate(it.end) && it.end >= it.start ? it.end : it.start }))
    .filter(x => x.s <= gridEnd && x.e >= gridStart)
    .sort((a, b) => a.s.localeCompare(b.s) || b.e.localeCompare(a.e) || String(a.it.company || '').localeCompare(String(b.it.company || '')) ||
                    String(a.it.shutdownNo || '').localeCompare(String(b.it.shutdownNo || '')));
  const weeks = [];
  for (let ws = gridStart; ws <= gridEnd; ws = shdmAddDays(ws, 7)) {
    const we = shdmAddDays(ws, 6), days = [], laneEnd = [], bars = [], more = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 7; i++) { const d = shdmAddDays(ws, i); days.push({ date: d, day: +d.slice(8, 10), inMonth: d.slice(0, 7) === ym, today: d === today, count: 0 }); }
    live.filter(x => x.s <= we && x.e >= ws).forEach(x => {
      const cs = x.s > ws ? x.s : ws, ce = x.e < we ? x.e : we, col = shdmDiff(ws, cs), span = shdmDiff(cs, ce) + 1;
      let lane = laneEnd.findIndex(end => end < col);
      if (lane < 0) lane = laneEnd.length;
      laneEnd[lane] = col + span - 1;
      for (let c = col; c < col + span; c++) days[c].count++;
      if (lane < maxLanes) bars.push({ no: x.it.shutdownNo, lane, col, span, contL: x.s < ws, contR: x.e > we, item: x.it });
      else for (let c = col; c < col + span; c++) more[c]++;
    });
    weeks.push({ start: ws, days, bars, more, lanes: Math.min(laneEnd.length, maxLanes) });
  }
  return { ym, label: shdmMonthLabel(ym), weeks };
}

/** The Upcoming list: under way, this week (to Sunday), the next 30 days, later. Ended and archived ones are left out. */
function shdmUpcoming(items, today) {
  const sunday = shdmAddDays(shdmMonday(today), 6), d30 = shdmAddDays(today, 30);
  const groups = [['now', 'Under way', []], ['week', 'This week', []], ['month', 'Next 30 days', []], ['later', 'Later', []]];
  (items || []).filter(it => it && !it.archived && shdmIsDate(it.start)).forEach(it => {
    const end = shdmIsDate(it.end) && it.end >= it.start ? it.end : it.start;
    if (end < today) return;
    const g = it.start <= today ? 0 : it.start <= sunday ? 1 : it.start <= d30 ? 2 : 3;
    groups[g][2].push(it);
  });
  groups.forEach(g => g[2].sort((a, b) => a.start.localeCompare(b.start) || String(a.company).localeCompare(String(b.company))));
  return groups.filter(g => g[2].length).map(g => ({ key: g[0], label: g[1], items: g[2] }));
}
/** Search and chips: every word in the client, site, scope, opportunity, contact or the follow-up rep. */
function shdmFilter(items, f) {
  f = f || {};
  const words = String(f.q || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean), chip = f.chip || 'all';
  return (items || []).filter(it => {
    if (chip === 'archived' ? !it.archived : it.archived) return false;
    if (chip === 'mine' && !it.mine) return false;
    if ((chip === 'Tentative' || chip === 'Confirmed') && it.status !== chip) return false;
    if (!words.length) return true;
    const hay = [it.company, it.site, it.scope, it.opportunity, it.contact, it.followUpBy, it.createdBy, it.notes].join(' ').toLowerCase();
    return words.every(w => hay.indexOf(w) >= 0);
  });
}
/** The add/edit form's checks, as the person types (the server checks the same and decides). */
function shdmCheck(f, today) {
  if (!String(f.company || '').trim()) return 'Say which client is shutting down.';
  if (!shdmIsDate(f.start)) return 'Give the day the shutdown starts.';
  if (f.end && !shdmIsDate(f.end)) return 'The end is a date.';
  if (f.end && f.end < f.start) return 'The shutdown ends before it starts.';
  if (shdmDiff(f.start, f.end || f.start) + 1 > 120) return 'A shutdown longer than 120 days is probably a typo in the dates.';
  return '';
}
/** The site choices for a Client Book client: its plant and head office, then Other (shaped like cvPlaces, A369). */
function shdmPlaces(client) {
  const out = [];
  if (client && String(client.siteAddress || '').trim()) out.push({ kind: 'Plant', label: 'Plant', text: String(client.siteAddress).trim() });
  if (client && String(client.headOfficeAddress || '').trim()) out.push({ kind: 'Head office', label: 'Head office', text: String(client.headOfficeAddress).trim() });
  out.push({ kind: 'Other', label: 'Other', text: '' });
  return out;
}
/** Company suggestions: the person's own Client Book first (with its number and sites), then the Client master's names. */
function shdmSuggest(book, master) {
  const seen = {}, out = [];
  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  (book || []).filter(c => !c.archivedAt).forEach(c => { const k = key(c.company); if (k && !seen[k]) { seen[k] = 1; out.push({ name: c.company, clientNo: c.clientNo, book: c }); } });
  (master || []).forEach(c => { const n = c.customer || c.name; const k = key(n); if (k && !seen[k]) { seen[k] = 1; out.push({ name: n, clientNo: '', book: null }); } });
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SHDM_STATUSES, SHDM_OFFERS, shdmIsDate, shdmAddDays, shdmDiff, shdmMonday, shdmStepMonth, shdmMonthLabel,
  shdmDay, shdmRangeLabel, shdmSoon, shdmMonthGrid, shdmUpcoming, shdmFilter, shdmCheck, shdmPlaces, shdmSuggest };
