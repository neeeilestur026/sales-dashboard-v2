/* A275 — "what I still owe the company", on whichever home page the employee lands on.
 *
 * ID-DRIVEN, like management-flow.js: it does nothing at all unless #myDeductionCard is on the page,
 * so adding it to a new home is one div and one script tag and there is no per-role branching to
 * keep in step. Seven home pages already load api.js, which is all this needs.
 *
 * A SIBLING OF flowActionsStrip, NOT PART OF IT. The action strip is built on fetchFlow (FlowAPI);
 * this reads Code.gs, where payroll lives. Folding it into flowComputeActions would have meant one
 * function talking to two different Apps Script deployments, and the strip's whole contract is that a
 * transient failure in one source silently drops one item rather than the card.
 *
 * WHOSE RECORD IT IS COMES FROM THE SESSION. getMySalaryDeductions takes no username: the server
 * resolves it from the token and ignores anything the browser claims. That is deliberate — the card
 * shows someone their own debt, and a client-supplied name would let any signed-in user read
 * anyone's. The card renders nothing at all when there is no deduction, so it costs an employee with
 * none a single request and no visual noise.
 */
(function () {
  const CARD = 'myDeductionCard';

  function peso(n) {
    return '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /* '2026-09-A' → '1st cutoff, September 2026'. Written out rather than shown as a key, because the
     employee reading this has never seen a period key and should not have to learn one. */
  function label(period) {
    if (!/^\d{4}-\d{2}-[AB]$/.test(String(period || ''))) return '';
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    return (period.slice(-1) === 'A' ? '1st' : '2nd') + ' cutoff, ' +
      (names[parseInt(period.slice(5, 7), 10) - 1] || '') + ' ' + period.slice(0, 4);
  }

  function render(el, rows) {
    /* Nothing owed means nothing shown. A permanently empty "You have no salary deductions" panel on
       every home page is noise that trains people to skip the whole column. */
    if (!rows.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

    el.style.display = '';
    el.innerHTML = `
      <h3 style="font-size:0.95rem;font-weight:700;margin:0 0 0.7rem;">💳 My salary deduction${rows.length > 1 ? 's' : ''}</h3>
      <div style="display:grid;gap:0.75rem;">
        ${rows.map(d => {
          const pct = d.totalAmount > 0 ? Math.min(100, Math.round((d.paid / d.totalAmount) * 100)) : 0;
          const done = d.remaining <= 0;
          const bar = done ? '#16a34a' : '#0f766e';
          return `
          <div style="border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:0.8rem 0.9rem;background:var(--bg-card,#fff);">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.6rem;flex-wrap:wrap;">
              <div style="font-weight:700;font-size:0.9rem;">${esc(d.item || 'Salary deduction')}</div>
              <div style="font-size:0.78rem;color:var(--text-muted,#64748b);">${esc(d.deductionNo)}</div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:0.45rem;font-size:0.86rem;">
              <span>Paid <strong>${peso(d.paid)}</strong> of ${peso(d.totalAmount)}</span>
              <span style="font-weight:700;color:${done ? '#16a34a' : 'inherit'};">
                ${done ? 'Fully paid' : peso(d.remaining) + ' left'}</span>
            </div>
            <div style="height:6px;background:var(--border,#e2e8f0);border-radius:4px;margin-top:0.45rem;overflow:hidden;">
              <div style="height:6px;width:${pct}%;background:${bar};border-radius:4px;"></div>
            </div>
            <div style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-muted,#64748b);line-height:1.5;">
              ${d.status === 'Draft'
                ? 'Not yet active — nothing is being deducted.'
                : done
                  ? `Settled after ${d.postingCount} deduction${d.postingCount === 1 ? '' : 's'}.`
                  : `${peso(d.perCutoffAmount)} ${d.cadence === 'First Cutoff Only' ? 'every 1st cutoff' : 'every cutoff'}` +
                    (d.nextPeriod ? ` · next on the ${esc(label(d.nextPeriod))}` : '') +
                    (d.instalmentsLeft ? ` · about ${d.instalmentsLeft} to go` : '')}
              ${d.formDocLink
                ? `<br><a href="${esc(d.formDocLink)}" target="_blank" rel="noopener" style="color:inherit;">View the form I signed</a>`
                : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  async function load() {
    const el = document.getElementById(CARD);
    if (!el) return;
    if (typeof apiGetMySalaryDeductions !== 'function') { el.style.display = 'none'; return; }
    el.style.display = 'none';                       // stay invisible until there is something to say
    try {
      const res = await apiGetMySalaryDeductions();
      if (!res || !res.success) return;              // signed out or unreachable — silent, not an error card
      render(el, res.data || []);
    } catch (e) { /* a home page must never break on a side panel */ }
  }

  document.addEventListener('DOMContentLoaded', function () { setTimeout(load, 400); });
  window.reloadMySalaryDeductions = load;
})();
