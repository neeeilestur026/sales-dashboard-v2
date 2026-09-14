/* A277 — "Leads for you": the qualified leads the lead-gen user has put in this rep's name, on the
 * sales home. ID-DRIVEN like salary-deduction-card.js: does nothing unless #leadsForYou is on the
 * page, so adding it to a home is one div and one script tag.
 *
 * ONE READ. getLeadgen({entity:'leads', handedTo}) is filtered server-side by the rep's LOGIN
 * USERNAME — never a display name — and each lead already carries its plant and contact, so this
 * is not a five-sheet read on every dashboard load (the A270 timeout shape). Hidden when empty.
 *
 * The rep's one write is to give a lead back with a reason; the server refuses anything else. */
(function () {
  const CARD = 'leadsForYou';
  const OPEN = ['Handed Off', 'Presentation Booked', 'Quoted'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function render(el, rows, session) {
    if (!rows.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;">
        <h3 style="font-size:0.95rem;font-weight:700;margin:0;">🎯 Leads for you</h3>
        <span style="font-size:.78rem;color:var(--text-muted,#64748b);">qualified by lead generation · ${rows.length} open</span>
      </div>
      <div style="display:grid;gap:.6rem;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));">
        ${rows.map(l => `
          <div style="border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:.8rem .9rem;background:var(--bg-card,#fff);font-size:.82rem;color:var(--text-muted,#64748b);line-height:1.5;">
            <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:baseline;">
              <div style="font-weight:700;font-size:.9rem;color:var(--text-primary,#0f172a);">${esc(l.company)}${l.plantSite ? ' — ' + esc(l.plantSite) : ''}</div>
              <span style="font-size:.68rem;font-weight:700;padding:.1rem .5rem;border-radius:999px;background:#e0e7ff;color:#3730a3;white-space:nowrap;">${esc(l.status)}</span>
            </div>
            <div>${esc(l.sector || '')}${l.province ? ' · ' + esc(l.province) : ''} · handed ${esc(l.handedOffOn || '')}</div>
            ${l.contactName ? `<div><b style="color:var(--text-primary,#0f172a);font-weight:600;">${esc(l.contactName)}</b>${l.contactRole ? ' · ' + esc(l.contactRole) : ''}${l.contactMobile ? ' · ' + esc(l.contactMobile) : ''}${l.contactEmail ? ' · ' + esc(l.contactEmail) : ''}</div>` : ''}
            ${l.pain ? `<div><b style="font-weight:600;">Pain:</b> ${esc(l.pain)}</div>` : ''}
            ${l.whatTheySaid ? `<div><b style="font-weight:600;">They said:</b> ${esc(l.whatTheySaid)}</div>` : ''}
            ${l.nextStep || l.presentationDate ? `<div><b style="font-weight:600;">Next:</b> ${esc(l.nextStep || '')}${l.presentationDate ? ' · presentation ' + esc(l.presentationDate) : ''}</div>` : ''}
            <div style="display:flex;gap:.4rem;justify-content:flex-end;margin-top:.5rem;">
              <a class="btn btn-sm btn-secondary" href="flow-pricing-request.html">Open a pricing request</a>
              <button type="button" class="btn btn-sm btn-secondary" data-return="${esc(l.leadNo)}" title="Give this lead back to lead generation">Return</button>
            </div>
          </div>`).join('')}
      </div>`;
    el.querySelectorAll('[data-return]').forEach(b => b.addEventListener('click', () => giveBack(el, rows, b.getAttribute('data-return'), session)));
  }

  async function giveBack(el, rows, leadNo, session) {
    const l = rows.find(x => x.leadNo === leadNo); if (!l) return;
    const why = prompt('Why is ' + l.company + ' coming back? (wrong territory, not a fit, no response…)');
    if (why === null) return;
    if (!why.trim()) { alert('Say why — lead generation needs the reason to re-qualify or close it.'); return; }
    try {
      const r = await postFlow('saveLeadgenRecord', { entity: 'leads', record: JSON.stringify({ rowIndex: l.rowIndex, leadNo: l.leadNo, status: 'Returned', returnReason: why.trim() }) });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not return the lead.');
      load(el, session);
    } catch (e) { alert(e.message); }
  }

  async function load(el, session) {
    try {
      const r = await fetchFlow('getLeadgen', { entity: 'leads', handedTo: session.username }, { fresh: true });
      const rows = ((r && r.data && r.data.leads) || []).filter(l => OPEN.indexOf(l.status) !== -1);
      render(el, rows, session);
    } catch (e) { el.style.display = 'none'; }
  }

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById(CARD);
    if (!el || typeof fetchFlow !== 'function' || typeof getSession !== 'function') return;
    const session = getSession();
    if (!session || session.role !== 'sales' || !session.username) return;
    load(el, session);
  });
})();
