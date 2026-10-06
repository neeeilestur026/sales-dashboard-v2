/* A312 — "My payslip": the cutoffs the director released to THIS login, as a receipt that prints
 * out of a slot.
 *
 * ID-DRIVEN like salary-deduction-card.js: it does nothing unless #myPayslipCard is on the page,
 * so a home page carries it with one section and two script tags (js/payslip.js draws the receipt).
 * WHOSE PAYSLIP IT IS COMES FROM THE SESSION — getMyPayslips takes no username; the server resolves
 * the login from the token and ignores anything the browser claims.
 *
 * THE RECEIPT IS THE DIRECTOR'S. The figures were computed on the director's page at the moment of
 * release and stored as data; hxPayslipHtml draws them with the same stylesheet the PDF uses, so what
 * the employee sees is what the director printed — only the footer says "Released" instead of
 * "Generated". The ticket chrome around it (printer bar, perforated edge, stamp, earlier/later)
 * lives in css/payslip-card.css and never touches the payslip itself.
 *
 * A313 — THE DAY IT WAS RELEASED, ONLY. The ticket is the day's news: a cutoff shows here on the
 * calendar day (Asia/Manila, the backend's clock) the director released it, and from the next day
 * on it lives on my-payslips.html, kept by month and cutoff. Two cutoffs released the same day are
 * both here (Earlier/Later). "Download PDF" produces the director's own file through the shared
 * renderer.
 *
 * MOTION: one load moment. The paper feeds out of the slot once when the card appears (a stepped
 * transform, the way a thermal printer advances), the LED blinks while it does, then the stamp
 * lands. Earlier/Later replays a shorter feed because it answers a click. The settled state is the
 * base rule, so the global reduced-motion rule leaves the receipt fully visible with no animation.
 */
(function () {
  const CARD = 'myPayslipCard';
  let rows = [], idx = 0;

  function esc(v) { return hxEsc(v); }
  function cssOnce() {
    if (document.getElementById('hxPayslipCss') || typeof HX_PAYSLIP_CSS !== 'string') return;
    const st = document.createElement('style');
    st.id = 'hxPayslipCss';
    st.textContent = HX_PAYSLIP_CSS;
    document.head.appendChild(st);
  }
  /* '2026-09-14 10:48:12' → '14 Sep 2026, 10:48'. The stamp is read at a glance; seconds are noise. */
  function when(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return String(v || '');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parseInt(m[3], 10) + ' ' + (names[parseInt(m[2], 10) - 1] || '') + ' ' + m[1] + (m[4] ? ', ' + m[4] + ':' + m[5] : '');
  }
  /* Today in Manila, the clock releasedAt was stamped with. flowToday() is on every home page. */
  function today() {
    if (typeof flowToday === 'function') return flowToday();
    try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); } catch (e) { return hxToday(); }
  }

  function render(el, first) {
    const r = rows[idx];
    if (!r || !r.slip || !r.slip.s) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const stamp = when(r.releasedAt);
    const pr = r.slip.pr || { label: r.period, range: '' };
    el.classList.add('hx-payslip-host');
    el.innerHTML = `
      <div class="hx-head"><h2>My payslip</h2><span class="hx-meta">${esc(pr.label || r.period)}</span>
        <div class="hx-actions"><button type="button" class="btn btn-sm" data-pdf>Download PDF</button><a href="my-payslips.html" class="btn btn-sm">All my payslips</a></div></div>
      <div class="hx-printer" aria-hidden="true"><span class="hx-led"></span><span class="hx-slit"></span></div>
      <div class="hx-ticket-clip">
        <div class="hx-ticket">
          ${hxPayslipHtml(r.slip.s, pr, { footer: 'Released ' + stamp + (r.releasedBy ? ' by ' + r.releasedBy : '') })}
          <div class="hx-stamp">Released<small>${esc(stamp)}</small></div>
        </div>
      </div>
      ${rows.length > 1 ? `
      <div class="hx-ticket-nav">
        <button type="button" class="btn-sm" data-step="1"${idx >= rows.length - 1 ? ' disabled' : ''}>&lsaquo; Earlier cutoff</button>
        <span>${idx + 1} of ${rows.length}</span>
        <button type="button" class="btn-sm" data-step="-1"${idx <= 0 ? ' disabled' : ''}>Later cutoff &rsaquo;</button>
      </div>` : ''}`;
    el.querySelectorAll('.hx-ticket-nav button').forEach(b => {
      b.addEventListener('click', () => {
        const next = idx + Number(b.dataset.step);
        if (next < 0 || next >= rows.length) return;
        idx = next;
        render(el, false);
      });
    });
    el.querySelectorAll('[data-pdf]').forEach(b => {
      b.addEventListener('click', () => { if (typeof hxPayslipDownload === 'function') hxPayslipDownload(rows[idx]); });
    });
    const clip = el.querySelector('.hx-ticket-clip');
    clip.classList.add('feed');
    if (!first) clip.classList.add('short');
    el.style.display = '';
  }

  /* A313 — only what was released today; everything else belongs to the My payslips page. */
  function todays(list) {
    const d = today();
    return (list || []).filter(r => r && r.slip && r.slip.s && !r.slip.s.isFixed && String(r.releasedAt || '').slice(0, 10) === d);
  }

  async function load() {
    const el = document.getElementById(CARD);
    if (!el) return;
    if (typeof apiGetMyPayslips !== 'function' || typeof hxPayslipHtml !== 'function') { el.style.display = 'none'; return; }
    el.style.display = 'none';                       // invisible until there is a payslip to show
    try {
      const res = await apiGetMyPayslips();
      if (!res || !res.success) return;              // signed out, old backend or unreachable — silent
      rows = todays(res.data);
      idx = 0;
      if (!rows.length) return;
      cssOnce();
      render(el, true);
    } catch (e) { /* a home page must never break on a side panel */ }
  }

  document.addEventListener('DOMContentLoaded', function () { setTimeout(load, 400); });
  window.reloadMyPayslips = load;
  window.__myPayslipRender = function (el, list) { rows = todays(list); idx = 0; cssOnce(); render(el, true); };   // tests
})();
