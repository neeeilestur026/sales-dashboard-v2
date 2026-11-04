/* follow-up-guide-card.js — A393 · "Today's follow-ups", on the rep's home and (data-mode="page") the week page.
 * ID-DRIVEN like shutdowns-card.js: does nothing unless #followUpGuide is on the page. One read (getFollowUpGuide,
 * FlowAPI 196) gives the week; js/follow-up-guide-model.js draws it. On the home it is the sales rep's own and hidden
 * before FlowAPI 196, with no plan, or when the read fails. On follow-up-guide.html the director and management pick a
 * rep (?user=) and read it without the buttons. It re-reads when the tab comes back and every 3 minutes while open, so a
 * call logged in the daily report shows up on return. The week strip keeps one indicator and only redraws its buttons,
 * so it slides from where it is (the A390 segmented-control pattern). */
(function () {
  const CARD = 'followUpGuide', EVERY = 3 * 60 * 1000;
  const S = { g: null, day: '', user: '', page: false, seen: {}, timer: 0, busy: false };
  const qs = (k) => { try { return new URLSearchParams(location.search || '').get(k) || ''; } catch (e) { return ''; } };
  const keyOf = (x) => x.quotationNo ? x.quotationNo + '@' + x.date : 'c' + x.clientNo;

  function stripDraw(seg) {
    let th = seg.querySelector('.fg-thumb');
    const first = !th;
    Array.prototype.slice.call(seg.children).forEach(c => { if (c !== th) c.remove(); });
    seg.insertAdjacentHTML('beforeend', fugStripHtml(S.g, S.day));
    if (first) { th = document.createElement('span'); th.className = 'fg-thumb now'; th.setAttribute('aria-hidden', 'true'); seg.insertBefore(th, seg.firstChild); }
    place(seg, first);
  }
  /** Puts the indicator under the selected day. `instant` skips the slide (the first draw, and a resize). */
  function place(seg, instant) {
    const th = seg && seg.querySelector('.fg-thumb'), on = seg && seg.querySelector('[aria-selected="true"]');
    if (!th || !on || typeof on.offsetLeft !== 'number') return;
    if (instant) th.classList.add('now');
    th.style.width = on.offsetWidth + 'px'; th.style.transform = 'translateX(' + on.offsetLeft + 'px)';
    if (instant) { void th.offsetWidth; th.classList.remove('now'); }
  }

  function bodyHtml() {
    const g = S.g, ro = !!g.readOnly, groups = fugGroups(g, S.day);
    if (!(g.weekend && !S.day)) return fugGroupsHtml(groups, S.day, { readOnly: ro, foldDone: !S.page });
    // a weekend: what is left of the week (the home shows the first 8), then Monday's first clients
    const left = fugLeft(g), cap = S.page ? 999 : 8;
    const sec = (k, t, list, day) => list.length ? '<section class="fg-sec" data-k="' + k + '"><h4>' + fugEsc(t) + ' <span>' + list.length + '</span></h4><ul class="fg-list">' +
      list.slice(0, cap).map(x => fugRowHtml(x, day, { readOnly: ro })).join('') + '</ul>' +
      (list.length > cap ? '<p class="fg-more"><a href="follow-up-guide.html">' + (list.length - cap) + ' more on the week page</a></p>' : '') + '</section>' : '';
    return (sec('left', 'Left this week', left.quotes.concat(left.clients), g.today) +
            (g.next ? sec('next', 'Monday, ' + fugShort(g.next.date), g.next.quotes.concat(g.next.clients), g.next.date) : '')) || '<p class="fg-empty">Every client was followed up this week.</p>';
  }

  function tableHtml() {
    const g = S.g, rows = (g.clients || []).map(c => {
      const day = c.quoted ? 'Quoted' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][c.bucket];
      const st = c.done ? 'Done · ' + fugHow(c.done, g.today) : c.quoted ? 'Followed by its quotation' : 'Not yet';
      return '<tr class="' + (c.done ? 'done' : '') + '"><td class="n">' + c.rank + '</td><td>' + fugEsc(c.company) + '</td><td>' + day + '</td><td>' + fugEsc(st) + '</td></tr>';
    }).join('');
    return '<section class="fg-top"><h3>The top ' + (g.planSize || 0) + ' this week</h3><div class="fg-tablewrap"><table class="fg-table"><thead><tr><th class="n">#</th><th>Client</th><th>Day</th><th>This week</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' + (g.notLive && g.notLive.length ? '<p class="fg-note">' + g.notLive.length + ' in the plan ' + (g.notLive.length === 1 ? 'is' : 'are') + ' no longer a live client: ' +
      g.notLive.map(x => fugEsc(x.company)).join(', ') + '.</p>' : '') + '</section>';
  }

  function draw(el) {
    const g = S.g, own = !g.readOnly, sm = g.summary || {}, week = g.weekend && !S.day;
    const p = week ? { done: sm.weekDone, total: sm.weekTotal, share: sm.weekTotal ? sm.weekDone / sm.weekTotal : 0 } : fugProgress(g, S.day);
    const sel = (g.days || []).filter(d => d.date === S.day)[0];
    const title = S.page ? (own ? 'Your follow-ups' : g.user + '\'s follow-ups') : week ? 'This week\'s follow-ups' : sel && sel.today ? 'Today\'s follow-ups' : FUG_DOW_LONG[sel.dow] + '\'s follow-ups';
    const sub = week ? 'Clients followed up this week, and what is left' : fugSubtitle(g, S.day, own);
    const picker = S.page && g.people && g.people.length ? '<label class="fg-pick"><span>Rep</span><select id="fgUser">' +
      g.people.map(u => '<option' + (u === g.user ? ' selected' : '') + '>' + fugEsc(u) + '</option>').join('') + '</select></label>' : '';
    el.style.display = '';
    el.classList.add('fg');
    const prev = S.seen;
    el.innerHTML = '<div class="fg-head"><div class="fg-ttl"><h3>' + fugEsc(title) + '</h3><span class="fg-sub">' + fugEsc(sub) + '</span></div>' + picker +
      '<div class="fg-count" role="status" aria-live="polite"><b>' + p.done + '</b> of ' + p.total + (week ? ' clients' : ' done') + '</div></div>' +
      '<div class="fg-bar" aria-hidden="true"><i style="transform: scaleX(' + p.share.toFixed(3) + ')"></i></div>' +
      '<div class="fg-week" role="tablist" aria-label="This week"></div>' +
      '<div class="fg-body">' + bodyHtml() + '</div>' +
      '<div class="fg-foot"><span>This week: ' + sm.weekDone + ' of ' + sm.weekTotal + ' clients followed up' + (sm.quotesDue ? ' · ' + sm.quotesDue + ' quotation follow-up' + (sm.quotesDue === 1 ? '' : 's') + ' due' : '') + '</span>' +
      (S.page ? '' : '<a href="follow-up-guide.html">See the week</a>') + '</div>' + (S.page ? tableHtml() : '');
    const seg = el.querySelector('.fg-week');
    if (seg) stripDraw(seg);
    // a row that became done since the last read cross-fades in (reduced motion: it simply lands)
    S.seen = {};
    (g.days || []).forEach(d => d.quotes.concat(d.carryQuotes || [], d.clients, d.carryClients || []).forEach(x => { S.seen[keyOf(x)] = x.status; }));
    el.querySelectorAll('.fg-row.done').forEach(r => { r.classList.add('settled'); });
    Object.keys(S.seen).forEach(k => { if (S.seen[k] === 'done' && prev[k] && prev[k] !== 'done') el.classList.add('fg-fresh'); });
  }

  async function load(el) {
    if (S.busy) return;
    S.busy = true;
    try {
      const r = await postFlow('getFollowUpGuide', S.user ? { user: S.user } : {});
      if (!r || !r.success || (!S.page && !r.live)) { if (!S.page) el.style.display = 'none'; else if (r && !r.success) el.innerHTML = '<p class="fg-empty">' + fugEsc(/unknown action|not a secured action/i.test(String(r.message)) ? 'The follow-up guide opens with the next FlowAPI update (version 196).' : r.message) + '</p>'; return; }
      const keep = S.g && S.g.user === r.user && (r.days || []).some(d => d.date === S.day);
      S.g = r;
      if (!keep) S.day = fugDefaultDay(r);
      draw(el);
    } catch (e) { if (!S.page) el.style.display = 'none'; }
    finally { S.busy = false; }
  }

  function wire(el) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.fg-day');
      if (!b || !S.g) return;
      S.day = b.getAttribute('data-day');
      draw(el);
      const f = el.querySelector('.fg-day[aria-selected="true"]'); if (f && f.focus) f.focus({ preventScroll: true });
    });
    el.addEventListener('keydown', (e) => {
      if (!S.g || !e.target.closest || !e.target.closest('.fg-week') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      const days = S.g.days.map(d => d.date), i = days.indexOf(S.day), n = Math.max(0, Math.min(days.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      S.day = days[n]; draw(el);
      const f = el.querySelector('.fg-day[aria-selected="true"]'); if (f && f.focus) f.focus({ preventScroll: true });
    });
    el.addEventListener('change', (e) => {
      if (!e.target || e.target.id !== 'fgUser') return;
      S.user = e.target.value; S.g = null;
      try { history.replaceState(null, '', 'follow-up-guide.html?user=' + encodeURIComponent(S.user)); } catch (x) { /* fine */ }
      load(el);
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(el); });
    // the days change width with the window (or the column): the indicator follows at once, without sliding
    let raf = 0;
    if (typeof window.addEventListener === 'function') window.addEventListener('resize', () => {
      if (raf || typeof requestAnimationFrame !== 'function') return;
      raf = requestAnimationFrame(() => { raf = 0; place(el.querySelector('.fg-week'), true); });
    });
    if (typeof setInterval === 'function') S.timer = setInterval(() => { if (document.visibilityState !== 'hidden') load(el); }, EVERY);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(CARD);
    if (!el || typeof postFlow !== 'function' || typeof getSession !== 'function' || typeof fugGroups !== 'function') return;
    const session = getSession();
    if (!session) return;
    S.page = el.getAttribute('data-mode') === 'page';
    const over = session.role === 'director' || session.role === 'management';
    if (!S.page && session.role !== 'sales') return;
    if (S.page && session.role !== 'sales' && !over) return;
    S.user = S.page && over ? qs('user') : '';
    wire(el);
    load(el);
  });
})();
