/* A313 — "My payslips": every cutoff the director released to THIS login, kept by month.
 *
 * The home page's ticket (my-payslip-card.js) is the day's news; this page is the drawer. The rows
 * come from getMyPayslips, whose identity is the session token alone, grouped by month (newest
 * first) and then cutoff (1st, then 2nd). A row opens the full receipt underneath it — drawn by
 * js/payslip.js from the released figures, so it is the director's payslip to the glyph — and the
 * PDF button produces the director's own file through the shared renderer.
 *
 * MOTION answers the click only: opening a receipt feeds it out with the short printer step; the
 * page itself has no entrance animation. The settled state is the base rule (reduced motion).
 */
(function () {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const CHEV = '<svg class="mp-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  let rows = [];

  function esc(v) { return hxEsc(v); }
  function when(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return String(v || '');
    return parseInt(m[3], 10) + ' ' + (MONTHS[parseInt(m[2], 10) - 1] || '').slice(0, 3) + ' ' + m[1] + (m[4] ? ', ' + m[4] + ':' + m[5] : '');
  }
  function monthLabel(ym) {
    const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    return m ? (MONTHS[parseInt(m[2], 10) - 1] || '') + ' ' + m[1] : String(ym || '');
  }
  function cssOnce() {
    if (document.getElementById('hxPayslipCss') || typeof HX_PAYSLIP_CSS !== 'string') return;
    const st = document.createElement('style');
    st.id = 'hxPayslipCss';
    st.textContent = HX_PAYSLIP_CSS;
    document.head.appendChild(st);
  }

  function item(r) {
    const s = r.slip.s, pr = r.slip.pr || { label: r.period, range: '' };
    const half = String(r.period || '').slice(-1);
    const stamp = when(r.releasedAt);
    const range = String(pr.range || '').replace(/\s+to\s+/, ' – ');
    return `
      <div class="mp-item">
        <div class="mp-line">
          <button type="button" class="mp-row" aria-expanded="false" data-period="${esc(r.period)}">
            <span class="mp-cut">${half === 'A' ? '1st cutoff' : '2nd cutoff'}</span>
            <span class="mp-range hx-dim">${esc(range)}</span>
            <span class="mp-net num">${hxPeso(s.netPay)}</span>
            <span class="mp-rel hx-meta">Released ${esc(stamp)}</span>
            ${CHEV}
          </button>
          <button type="button" class="btn btn-sm mp-pdf" data-period="${esc(r.period)}" title="Download this payslip as PDF">PDF</button>
        </div>
        <div class="hx-payslip-host mp-slip" hidden>
          <div class="hx-ticket-clip"><div class="hx-ticket">
            ${hxPayslipHtml(s, pr, { footer: 'Released ' + stamp + (r.releasedBy ? ' by ' + r.releasedBy : '') })}
            <div class="hx-stamp">Released<small>${esc(stamp)}</small></div>
          </div></div>
        </div>
      </div>`;
  }

  function render(el, list) {
    rows = (list || []).filter(r => r && r.slip && r.slip.s && !r.slip.s.isFixed);
    if (!rows.length) {
      el.innerHTML = '<div class="hx-empty">Nothing here yet. A payslip stays on your home page the day it is released and is kept here from the next day on.</div>';
      return;
    }
    cssOnce();
    const byMonth = {};
    rows.forEach(r => { const ym = String(r.period || '').slice(0, 7); (byMonth[ym] = byMonth[ym] || []).push(r); });
    const months = Object.keys(byMonth).sort().reverse();                    // newest month first
    const ordered = [];
    el.innerHTML = months.map(ym => {
      const inMonth = byMonth[ym].slice().sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));   // 1st, then 2nd
      ordered.push.apply(ordered, inMonth);
      return `<section class="mp-month"><h3>${esc(monthLabel(ym))}<span class="hx-count">${inMonth.length}</span></h3>${inMonth.map(item).join('')}</section>`;
    }).join('');
    rows = ordered;
    const toggles = el.querySelectorAll('.mp-row'), slips = el.querySelectorAll('.mp-slip'), pdfs = el.querySelectorAll('.mp-pdf');
    toggles.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const slip = slips[i];
        if (!slip) return;
        const open = !!slip.hidden;
        slip.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        const clip = slip.querySelector('.hx-ticket-clip');
        if (clip) { clip.classList.remove('feed', 'short'); if (open) { void clip.offsetWidth; clip.classList.add('feed', 'short'); } }
      });
    });
    pdfs.forEach((btn, i) => {
      btn.addEventListener('click', (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); if (typeof hxPayslipDownload === 'function') hxPayslipDownload(rows[i]); });
    });
  }

  async function load() {
    const el = document.getElementById('mpList');
    if (!el) return;
    try {
      const res = await apiGetMyPayslips();
      if (!res || !res.success) { el.innerHTML = '<div class="hx-empty">Could not load your payslips. Sign in again or try later.</div>'; return; }
      render(el, res.data || []);
    } catch (e) { el.innerHTML = '<div class="hx-empty">Could not load your payslips. Sign in again or try later.</div>'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof requireAuth === 'function' && !requireAuth()) return;
    if (typeof renderNavbar === 'function') renderNavbar('my-payslips');
    load();
  });
  window.reloadMyPayslips = load;
  window.__myPayslipsRender = render;   // tests
})();
