/* follow-up-team-card.js — A393 · "Follow-ups this week" on the director's and management's homes.
 * ID-DRIVEN: does nothing unless #followUpTeam is on the page. One read (getFollowUpGuide {all}, FlowAPI 196) gives
 * each rep with a plan: today's done of due, the week's clients followed up, the quotation follow-ups due. A row opens
 * that rep's week on follow-up-guide.html, read only. Hidden before FlowAPI 196, with no plan, or when the read fails.
 * Drawn with the home's own card head (dh- on the director's, hx- on management's). */
(function () {
  const CARD = 'followUpTeam';
  const esc = (v) => (typeof flowEsc === 'function' ? flowEsc(v) : String(v == null ? '' : v));
  // A395 — 'Monday, 9 November' (the homes do not load the guide's model, so the label is made here)
  const startLabel = (ymd) => {
    const s = String(ymd || ''), d = new Date(s + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(d.getTime())) return s;
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' +
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()];
  };

  function render(el, people) {
    const b = document.body, dh = !!(b && b.classList && b.classList.contains('dh')), h = dh ? 'dh' : 'hx';
    const row = (p) => {
      const s = p.summary || {}, share = s.weekTotal ? s.weekDone / s.weekTotal : 0;
      if (p.notStarted) return '<li><a class="fut-row" href="follow-up-guide.html?user=' + encodeURIComponent(p.user) + '"><span class="fut-who"><b>' + esc(p.user) + '</b>' +
        '<span>Top ' + p.planSize + ', ' + p.perDay + ' a day</span></span><span class="fut-soon">Starts ' + esc(startLabel(p.startsOn)) + '</span></a></li>';   // A395
      return '<li><a class="fut-row" href="follow-up-guide.html?user=' + encodeURIComponent(p.user) + '">' +
        '<span class="fut-who"><b>' + esc(p.user) + '</b><span>Today ' + s.todayDone + ' of ' + s.todayTotal + (s.quotesDue ? ' · ' + s.quotesDue + ' quotation follow-up' + (s.quotesDue === 1 ? '' : 's') + ' due' : '') + '</span></span>' +
        '<span class="fut-week"><span class="fut-n">' + s.weekDone + '<small> of ' + s.weekTotal + '</small></span><span class="fut-bar" aria-hidden="true"><i style="transform: scaleX(' + share.toFixed(3) + ')"></i></span></span></a></li>';
    };
    el.style.display = '';
    el.innerHTML = '<div class="' + h + '-head"><h2>Follow-ups this week</h2><span class="' + h + '-meta">' + (people.every(p => p.notStarted) ? 'Each rep\'s ranked clients. The guide starts counting ' + esc(startLabel(people[0].startsOn)) + '.' : 'Each rep\'s top clients: followed up this week, and today\'s list.') + '</span></div>' +
      '<ul class="fut-list">' + people.map(row).join('') + '</ul>';
  }

  /* A394 — the last list this browser saw is drawn at once, then the fresh read replaces it (only today's copy). */
  let KEY = '';
  const today = () => (typeof flowToday === 'function' ? flowToday() : '');
  function fromCache() { try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && Array.isArray(c.people) && c.today === today() ? c.people : null; } catch (e) { return null; } }
  function toCache(people) { try { localStorage.setItem(KEY, JSON.stringify({ today: today(), people })); } catch (e) { /* fine */ } }

  async function load(el, shown) {
    try {
      const r = await postFlow('getFollowUpGuide', { all: true });
      if (!r || !r.success) { if (!shown) el.style.display = 'none'; return; }   // a failed refresh keeps what is on screen
      const people = (r.people || []).filter(p => p.live > 0);
      toCache(people);
      if (!people.length) { el.style.display = 'none'; return; }
      render(el, people);
    } catch (e) { if (!shown) el.style.display = 'none'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(CARD);
    if (!el || typeof postFlow !== 'function' || typeof getSession !== 'function') return;
    const s = getSession();
    if (!s || (s.role !== 'director' && s.role !== 'management')) return;
    KEY = 'hx_fut1:' + (s.username || s.name);
    const cached = fromCache();
    if (cached && cached.length) render(el, cached);
    load(el, !!(cached && cached.length));
  });
})();
