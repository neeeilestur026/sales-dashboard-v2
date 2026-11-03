/* A391 — "Coming shutdowns": the clients' plant shutdowns in the next 30 days, on the sales home. ID-DRIVEN like
 * my-clients-card.js: does nothing unless #comingShutdowns is on the page. One read (getShutdowns upcomingDays; every rep
 * sees every shutdown). Hidden when the calendar is switched off or the backend does not know it yet (before FlowAPI 195). */
(function () {
  const CARD = 'comingShutdowns', MAX = 5;

  function render(el, r) {
    const today = r.today || flowToday(), items = (r.items || []).slice(0, MAX), days = r.cardDays || 30;
    const row = (it) => '<li><a class="cs-row" href="shutdown-calendar.html?id=' + encodeURIComponent(it.shutdownNo) + '">' +
      '<span class="cs-when">' + flowEsc(shdmRangeLabel(it.start, it.end, today)) + '</span>' +
      '<span class="cs-what"><b>' + flowEsc(it.company) + '</b>' + (it.site ? ' · ' + flowEsc(it.site) : '') + '</span>' +
      '<span class="cs-meta">' + flowEsc([it.status, shdmSoon(it, today), it.mine ? 'yours' : ''].filter(Boolean).join(' · ')) + '</span></a></li>';
    el.style.display = '';
    el.innerHTML = '<div class="cs-head"><h3>Coming shutdowns</h3><span>Clients\' plants stopping in the next ' + days + ' days</span>' +
      '<a class="btn btn-sm btn-secondary" href="shutdown-calendar.html' + (items.length ? '' : '?new=1') + '">' + (items.length ? 'Open the calendar' : 'Add a shutdown') + '</a></div>' +
      (items.length ? '<ol class="cs-list">' + items.map(row).join('') + '</ol>' + ((r.items || []).length > MAX ? '<p class="cs-more"><a href="shutdown-calendar.html?view=upcoming">' +
        ((r.items || []).length - MAX) + ' more</a></p>' : '')
        : '<p class="cs-empty">No shutdowns in the next ' + days + ' days. Heard of one? Add it, so the team can prepare.</p>');
  }

  async function load(el) {
    try {
      const r = await postFlow('getShutdowns', { upcomingDays: 30 });
      if (!r || !r.success) { el.style.display = 'none'; return; }
      render(el, r);
    } catch (e) { el.style.display = 'none'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(CARD);
    if (!el || typeof postFlow !== 'function' || typeof getSession !== 'function' || typeof shdmRangeLabel !== 'function') return;
    const session = getSession();
    if (!session || session.role !== 'sales') return;
    load(el);
  });
})();
