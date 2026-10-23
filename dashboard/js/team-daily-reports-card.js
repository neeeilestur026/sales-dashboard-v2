/* team-daily-reports-card.js — A366 · the "New daily reports" card on the management home.
 * ID-DRIVEN like new-daily-report-card.js: does nothing unless #teamDailyReports is on the page. Two reads (the roster,
 * and every new daily report of today — FlowAPI 185 lets management read them all) say where each team stands: how many
 * submitted their 4:30 report, saved one, or have not started; after 4:30 the ones not in show in the warning colour.
 * Hidden before FlowAPI 185 or when a read fails. The old Daily reports card below it is untouched. */
(function () {
  const CARD = 'teamDailyReports';
  const esc = (v) => (typeof flowEsc === 'function' ? flowEsc(v) : String(v == null ? '' : v));
  const nowMin = () => { const d = new Date(); return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes(); };   // Manila, UTC+8
  const ROLES = ['sales', 'accounting', 'leadgen', 'admin'];

  async function roster() {
    const keep = (list) => (list || []).filter(u => ROLES.indexOf(String(u.role || '').toLowerCase()) >= 0);
    let users = typeof apiGetUsers === 'function' ? await apiGetUsers().then(r => keep((r && (r.data || r.users)) || [])).catch(() => []) : [];
    if (!users.length && typeof apiFetchEmailUsers === 'function') users = await apiFetchEmailUsers().then(r => keep(r && r.success ? r.users : [])).catch(() => []);
    return users;
  }

  function render(el, c, late) {
    const team = (t) => {
      if (t.submitted === t.total) return '<li><b>' + esc(t.label) + '</b><span class="ok">All ' + t.total + ' submitted</span></li>';
      const rest = [t.saved ? t.saved + ' saved' : '', t.notStarted ? t.notStarted + ' not started' : ''].filter(Boolean).join(' · ');
      return '<li><b>' + esc(t.label) + '</b><span>' + t.submitted + ' of ' + t.total + ' submitted · <span class="' + (late ? 'due' : '') + '">' + rest + '</span></span></li>';
    };
    el.style.display = '';
    el.innerHTML = '<div class="hx-head"><h2>New daily reports</h2><span class="hx-meta">Today · ' + c.submitted + ' of ' + c.total + ' submitted</span></div>' +
      '<ul class="hx-tdr-teams">' + c.teams.map(team).join('') + '</ul>' +
      '<div class="hx-tdr-foot"><a class="btn btn-sm btn-primary" href="team-daily-reports.html">Open new daily reports</a></div>';
  }

  async function load(el) {
    try {
      if (typeof flowVersionAtLeast === 'function' && !(await flowVersionAtLeast(185))) return;
      const today = typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10);
      const [users, r] = await Promise.all([roster(), postFlow('getProofReports', { kind: 'all', from: today, to: today })]);
      if (!r || !r.success) return;
      const groups = tdrGroups(users, r.data || [], today, today, nowMin());
      if (!groups.length) return;
      render(el, tdrCounts(groups), nowMin() >= 16 * 60 + 30);
    } catch (e) { el.style.display = 'none'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(CARD);
    if (!el || typeof postFlow !== 'function' || typeof getSession !== 'function' || typeof tdrGroups !== 'function') return;
    const s = getSession(), role = String((s && s.role) || '').toLowerCase();
    if (role !== 'management' && role !== 'director') return;
    load(el);
  });
})();
