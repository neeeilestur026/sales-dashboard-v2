/* team-daily-reports-model.js — A366 · the team daily reports page's list and counts (pure; tested in node).
 *
 * The people who have a new daily report (sales, accounting, lead gen, admin), grouped by team, each with where their
 * report stands on a day: submitted at 4:31 PM, saved at 11:12 AM, or not started — and how many lines they typed that
 * day (voided ones left out). A saved report whose name is not in the roster is still listed, marked, so nothing saved is
 * hidden; the director's own trial rows are not anyone's report and are left out. */
const TDR_TEAMS = [['sales', 'Sales'], ['accounting', 'Accounting'], ['leadgen', 'Lead gen'], ['admin', 'Admin']];
const TDR_DUE_MIN = 16 * 60 + 30;   // 4:30 PM

function _tdrS(v) { return String(v == null ? '' : v).trim(); }
function _tdrLow(v) { return _tdrS(v).toLowerCase(); }
/** The Manila day of a line's time, as the reports count it (flowDate does the same where flow-api.js is loaded). */
function _tdrDay(v) {
  if (typeof flowDate === 'function') return flowDate(v);
  const s = _tdrS(v), t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? NaN : Date.parse(s);
  return isNaN(t) ? s.slice(0, 10) : new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
}

/** The lines a report has for a day, the voided ones left out. */
function tdrLines(report, day) {
  return ((report && report.lines) || []).filter(l => l && !l.voidedAt && _tdrDay(l.loggedAt) === day).length;
}

/** users: the roster ({fullName|name|username, username, role}); rows: getProofReports({kind:'all'}) for the day.
 *  Returns the teams that have anyone: [{ key, label, people, submitted, saved, notStarted }], each person
 *  { name, username, role, inRoster, state: 'submitted'|'saved'|'none', at, lines, late }. */
function tdrGroups(users, rows, day, today, nowMin) {
  const groups = TDR_TEAMS.map(([key, label]) => ({ key, label, people: [] }));
  const byKey = {};
  groups.forEach(g => { byKey[g.key] = g; });
  const seen = {};
  (users || []).forEach(u => {
    const role = _tdrLow(u && u.role), g = byKey[role], name = _tdrS(u && (u.fullName || u.name || u.username));
    if (!g || !name || seen[role + ':' + name.toLowerCase()]) return;
    seen[role + ':' + name.toLowerCase()] = 1;
    g.people.push({ name, username: _tdrS(u.username), role, inRoster: true });
  });
  const rowFor = {};
  (rows || []).forEach(r => {
    if (!r || _tdrS(r.date) !== day || _tdrLow(r.role) === 'director') return;
    rowFor[(_tdrLow(r.kind) || 'sales') + ':' + _tdrLow(r.user)] = r;
  });
  Object.keys(rowFor).forEach(k => {
    const r = rowFor[k], g = byKey[k.split(':')[0]];
    if (g && !g.people.some(p => _tdrLow(p.name) === _tdrLow(r.user))) g.people.push({ name: _tdrS(r.user), username: '', role: g.key, inRoster: false });
  });
  const pastDue = day < today || nowMin >= TDR_DUE_MIN;
  groups.forEach(g => {
    g.people.forEach(p => {
      const r = rowFor[g.key + ':' + p.name.toLowerCase()] || null;
      p.state = !r ? 'none' : r.submittedAt ? 'submitted' : 'saved';
      p.at = !r ? '' : _tdrS(r.submittedAt || r.updatedAt);
      p.lines = r ? tdrLines(r.report, day) : 0;
      p.late = p.state !== 'submitted' && pastDue;
    });
    g.people.sort((a, b) => a.name.localeCompare(b.name));
    g.submitted = g.people.filter(p => p.state === 'submitted').length;
    g.saved = g.people.filter(p => p.state === 'saved').length;
    g.notStarted = g.people.filter(p => p.state === 'none').length;
  });
  return groups.filter(g => g.people.length);
}

/** The totals the chips and the management home card show. */
function tdrCounts(groups) {
  const all = (groups || []).reduce((s, g) => s.concat(g.people), []);
  return { total: all.length, submitted: all.filter(p => p.state === 'submitted').length, saved: all.filter(p => p.state === 'saved').length,
           notStarted: all.filter(p => p.state === 'none').length,
           teams: (groups || []).map(g => ({ key: g.key, label: g.label, total: g.people.length, submitted: g.submitted, saved: g.saved, notStarted: g.notStarted })) };
}

/** The list as shown: a state ('submitted' | 'saved' | 'none' | '') and a search on the name. Empty teams drop out. */
function tdrFilter(groups, f) {
  const o = f || {}, q = _tdrLow(o.q);
  return (groups || []).map(g => Object.assign({}, g, { people: g.people.filter(p => (!o.state || p.state === o.state) && (!q || p.name.toLowerCase().indexOf(q) >= 0)) }))
    .filter(g => g.people.length);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { TDR_TEAMS, tdrLines, tdrGroups, tdrCounts, tdrFilter };
