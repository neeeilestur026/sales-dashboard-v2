/* sales-plan-card.js — A403 · "Sales target" on the rep's home (dashboard.html): this month and the year so far, against the
 * targets the director set on the Sales plan. ID-DRIVEN like follow-up-guide-card.js: does nothing unless #salesPlanCard is
 * on the page. One small read (getSalesPlan with summary, FlowAPI 202); js/sales-plan-model.js does the arithmetic. Hidden
 * before FlowAPI 202, for anyone but a sales rep, and when the read fails. Today's last copy is drawn at once ("Updating…")
 * while the fresh read runs — a per-viewer convenience, so every storage access may fail. */
(function () {
  const CARD = 'salesPlanCard';
  const esc = (s) => (typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const today = () => (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10));
  let KEY = '';
  function fromCache() { try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.success && c.summary && c.today === today() ? c : null; } catch (e) { return null; } }
  function toCache(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) { /* storage full or blocked: fine */ } }

  function block(label, actual, target, share) {
    return '<div class="sp-cblock"><p class="sp-cl">' + esc(label) + '</p><p class="sp-cv">' + esc(spShort(actual)) + '</p><p class="sp-cof">of ' + esc(spShort(target)) + ' · ' + esc(spPct(share)) + '</p>' +
      '<span class="sp-meter" role="img" aria-label="' + esc(spPct(share) + ' of ' + label + '\'s target') + '"><i style="width:' + Math.min(100, Math.round((share || 0) * 100)) + '%"></i></span></div>';
  }
  function draw(el, r, stale) {
    const h = spHomeLines(r, today());
    if (!h) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.classList.add('sp-card');
    el.innerHTML = '<div class="hx-head"><h2>Sales target</h2><span class="hx-meta">' + esc(stale ? 'Updating…' : 'From your sales orders, before VAT') + '</span></div>' +
      '<div class="sp-crow">' + (h.month ? block(h.month.label, h.month.actual, h.month.target, h.month.share) : '') + block(h.year.label, h.year.actual, h.year.target, h.year.share) + '</div>' +
      '<p class="sp-cfoot">' + esc(h.orders + ' order' + (h.orders === 1 ? '' : 's') + ' this year · ' + spPct(h.pace.share) + ' of the target to date' + (h.set ? '' : ' · default target')) +
      ' · <a href="sales-plan.html">Open the sales plan</a></p>';
  }
  async function run() {
    const el = document.getElementById(CARD);
    if (!el || typeof postFlow !== 'function' || typeof spHomeLines !== 'function') return;
    let s = null;
    try { s = typeof getSession === 'function' ? getSession() : null; } catch (e) { s = null; }
    if (!s || String(s.role || '').toLowerCase() !== 'sales') return;
    KEY = 'hx_spc1:' + (s.username || s.name);
    const c = fromCache();
    if (c) draw(el, c, true);
    const r = await postFlow('getSalesPlan', { summary: true }).catch(() => null);
    if (r && r.success && r.summary) { toCache(r); draw(el, r, false); }
    else if (!c) el.style.display = 'none';
    else draw(el, c, false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
