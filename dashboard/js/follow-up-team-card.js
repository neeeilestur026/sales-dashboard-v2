/* follow-up-team-card.js — A393 · "Follow-ups this week" on the director's and management's homes.
 * ID-DRIVEN: does nothing unless #followUpTeam is on the page. One read (getFollowUpGuide {all}, FlowAPI 196) gives
 * each rep with a plan: today's done of due, the week's clients followed up, the quotation follow-ups due. A row opens
 * that rep's week on follow-up-guide.html, read only. Hidden before FlowAPI 196, with no plan, or when the read fails.
 * Drawn with the home's own card head (dh- on the director's, hx- on management's). */
(function () {
  const CARD = 'followUpTeam';
  const esc = (v) => (typeof flowEsc === 'function' ? flowEsc(v) : String(v == null ? '' : v));

  function render(el, people) {
    const b = document.body, dh = !!(b && b.classList && b.classList.contains('dh')), h = dh ? 'dh' : 'hx';
    const row = (p) => {
      const s = p.summary || {}, share = s.weekTotal ? s.weekDone / s.weekTotal : 0;
      return '<li><a class="fut-row" href="follow-up-guide.html?user=' + encodeURIComponent(p.user) + '">' +
        '<span class="fut-who"><b>' + esc(p.user) + '</b><span>Today ' + s.todayDone + ' of ' + s.todayTotal + (s.quotesDue ? ' · ' + s.quotesDue + ' quotation follow-up' + (s.quotesDue === 1 ? '' : 's') + ' due' : '') + '</span></span>' +
        '<span class="fut-week"><span class="fut-n">' + s.weekDone + '<small> of ' + s.weekTotal + '</small></span><span class="fut-bar" aria-hidden="true"><i style="transform: scaleX(' + share.toFixed(3) + ')"></i></span></span></a></li>';
    };
    el.style.display = '';
    el.innerHTML = '<div class="' + h + '-head"><h2>Follow-ups this week</h2><span class="' + h + '-meta">Each rep\'s top 50: clients followed up this week, and today\'s list.</span></div>' +
      '<ul class="fut-list">' + people.map(row).join('') + '</ul>';
  }

  async function load(el) {
    try {
      const r = await postFlow('getFollowUpGuide', { all: true });
      const people = (r && r.success && r.people || []).filter(p => p.live > 0);
      if (!people.length) { el.style.display = 'none'; return; }
      render(el, people);
    } catch (e) { el.style.display = 'none'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(CARD);
    if (!el || typeof postFlow !== 'function' || typeof getSession !== 'function') return;
    const s = getSession();
    if (!s || (s.role !== 'director' && s.role !== 'management')) return;
    load(el);
  });
})();
