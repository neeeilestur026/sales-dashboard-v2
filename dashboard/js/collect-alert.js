/* A323 — the live alert on the accounting and admin homes.
 *
 * When the director records a collection on his phone (collect.html), accounting and admin should see
 * it without reloading. While this page is visible it asks every minute, and again the moment the tab
 * comes back, for payments recorded since the last look (getFieldCollectionNotices with `since`):
 *   · each new one is a toast — "Neil Estur recorded ₱420,000.00 · cheque #001234 · ABOITIZ" · View;
 *   · then the bell and the "Needs you" strip are recomputed (flowRefreshActions).
 * The last look is kept per user, so payments that arrived while the page was closed show once on
 * the next visit; the very first visit only sets the mark. It stops quietly while FlowAPI is older
 * than 164 ("Unknown action"), and a failed check simply waits for the next one.
 */
(function () {
  const ROLES = ['accounting', 'admin'];
  const EVERY = 60000, MAX_TOASTS = 3;
  let since = '', stopped = false, busy = false;
  const session = (typeof getSession === 'function') ? getSession() : null;
  if (!session || ROLES.indexOf(String(session.role || '').toLowerCase()) === -1) return;
  const KEY = 'hx_fc_seen_' + String(session.username || session.name || '');
  const readMark = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const writeMark = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: the mark lives for this page only */ } };

  function box() {
    let b = document.getElementById('fcToasts');
    if (!b) { b = document.createElement('div'); b.id = 'fcToasts'; b.className = 'fc-toasts'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite'); document.body.appendChild(b); }
    return b;
  }
  function toast(html) {
    const b = box();
    while (b.children.length >= MAX_TOASTS) b.removeChild(b.firstChild);
    const t = document.createElement('div');
    t.className = 'fc-toast';
    t.innerHTML = html + '<button type="button" class="fc-x" aria-label="Dismiss">&times;</button>';
    t.querySelector('.fc-x').addEventListener('click', () => t.remove());
    b.appendChild(t);
  }
  function say(items) {
    const esc = (v) => (typeof hxEsc === 'function' ? hxEsc(v) : '');
    const money = (v) => (typeof flowMoney === 'function' ? flowMoney(v, 'PHP') : String(v));
    items.slice(0, MAX_TOASTS).forEach(b => {
      const how = b.method === 'Cheque' ? 'cheque #' + b.chequeNo : String(b.method || '').toLowerCase();
      toast(`<span class="fc-t"><b>${esc(b.by || 'The director')}</b> recorded <b>${esc(money(b.received))}</b> · ${esc(how)} · ${esc(b.customer)}</span>` +
            `<a class="fc-go" href="flow-collections.html#field">View</a>`);
    });
    if (items.length > MAX_TOASTS) toast(`<span class="fc-t">and ${items.length - MAX_TOASTS} more collection${items.length - MAX_TOASTS === 1 ? '' : 's'}</span><a class="fc-go" href="flow-collections.html#field">View</a>`);
  }
  async function check() {
    if (stopped || busy || document.visibilityState !== 'visible' || typeof postFlow !== 'function') return;
    busy = true;
    try {
      const mark = since || readMark();
      const r = await postFlow('getFieldCollectionNotices', mark ? { since: mark } : {});
      if (!r || !r.success) { if (r && /Unknown action/i.test(r.message || '')) stopped = true; return; }
      if (mark && r.items && r.items.length) {
        say(r.items.slice().reverse());   // oldest first, so the newest ends up at the bottom of the stack
        if (typeof flowRefreshActions === 'function') flowRefreshActions('flowActionCenter');
      }
      since = r.serverNow || since;
      if (since) writeMark(since);
    } catch (e) { /* offline or a hiccup: the next check tries again */ }
    finally { busy = false; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setTimeout(check, 2500);              // after the page's own first reads
  setInterval(check, EVERY);
  window.__collectAlert = { check, KEY };   // tests
})();
