/* A358 — "My clients": the rep's own Client Book on the sales home. ID-DRIVEN like leads-for-you.js: does nothing
 * unless #myClients is on the page. One read (getClientBook — the server returns only this rep's clients); the counts
 * come from cbSummary (js/client-book-model.js). Hidden before FlowAPI 182 or when the book is closed to the reps. */
(function () {
  const CARD = 'myClients';

  function render(el, book) {
    const s = cbSummary(book.clients || [], book.log || [], flowToday());
    const tile = (n, label, warn) => '<div class="mc-tile' + (warn && n ? ' warn' : '') + '"><span class="v">' + n + '</span><span class="l">' + label + '</span></div>';
    el.style.display = '';
    el.innerHTML = '<div class="mc-head"><h3>My clients</h3><span>Your Client Book — pick a client on a new purchase request to keep it with them</span>' +
      '<a class="btn btn-sm btn-secondary" href="director-client-book.html">' + (s.total ? 'Open my Client Book' : 'Add my first client') + '</a></div>' +
      (s.total ? '<div class="mc-tiles">' + tile(s.total, s.total === 1 ? 'Client' : 'Clients') + tile(s.major, 'Major') + tile(s.accredited, 'Accredited') +
        tile(s.needsUpdate, s.needsUpdate === 1 ? 'Needs an update' : 'Need an update', true) + '</div>'
        : '<p class="mc-empty">No clients yet. Add the companies you look after, with their contact people.</p>');
  }

  async function load(el) {
    try {
      if (typeof flowVersionAtLeast === 'function' && !(await flowVersionAtLeast(182))) return;
      const r = await postFlow('getClientBook', {});
      if (!r || !r.success) return;
      render(el, r);
    } catch (e) { el.style.display = 'none'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(CARD);
    if (!el || typeof postFlow !== 'function' || typeof getSession !== 'function' || typeof cbSummary !== 'function') return;
    const session = getSession();
    if (!session || session.role !== 'sales') return;
    load(el);
  });
})();
