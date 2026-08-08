/* A215 — the team's quotation worklist, for management and the director.
 *
 * Before this, those two roles saw exactly ONE line about quotations anywhere in the system: an
 * Action Center row reading "N quotations across the team past follow-up". No breakdown, no names,
 * and no way to tell which rep was sitting on which deal — the only route to that was opening the
 * quotation list and reading badges off a date-ordered table.
 *
 * This is the SAME engine the rep sees (quotation-worklist.js), grouped by whose work it is. That is
 * deliberate and it is the point: a director asking "why has this not moved" and the rep looking at
 * their own list are reading the same rows, in the same order, with the same instruction on them.
 * Two separate computations of "what needs chasing" would disagree within a week — A208 already
 * learned that lesson here, where three copies of one KPI differed by eight million pesos on one
 * screen.
 *
 * Read-only. Every action still belongs to the rep who owns the deal.
 */

let qtwRows = null;

/** Mount into `containerId` if it exists. Silent when the page has no such element, so the two homes
 *  can adopt it independently. */
async function quotationTeamWorklist(containerId) {
  const el = document.getElementById(containerId || 'qtwPanel');
  if (!el || typeof quotationWorklist !== 'function') return;

  el.innerHTML = '<div class="qtw-empty">Reading the team\'s quotations…</div>';
  let qs = [], hasSO = {}, links = {}, cfg = null;
  try {
    const [q, so, le, cf] = await Promise.all([
      fetchFlow('getQuotations').catch(() => ({ data: [] })),
      fetchFlow('getSalesOrders').catch(() => ({ data: [] })),
      fetchFlow('getQuotationEmails').catch(() => ({ data: [] })),
      fetchFlow('getFlowSettings').catch(() => ({ data: null }))
    ]);
    qs = (q && q.data) || [];
    ((so && so.data) || []).forEach(s => { if (s.quotationNo) hasSO[String(s.quotationNo)] = true; });
    ((le && le.data) || []).forEach(l => {
      const k = String(l.quotationNo || ''); if (k) (links[k] = links[k] || []).push(l);
    });
    cfg = (cf && cf.data) || null;
  } catch (e) {
    el.innerHTML = '<div class="qtw-empty">Could not read the quotations — ' + flowEsc(e.message) + '</div>';
    return;
  }

  const list = quotationWorklist(qs, links, cfg, hasSO);
  qtwRows = list;

  /* The missing send dates are separated out BEFORE anything is grouped. There are 60 of them on
     live data, so leaving them in makes every rep read "Check 38" and buries the one rejection and
     one unsent quotation that are the actual work. They are counted once, at the bottom, with the
     fix — not repeated 60 times. */
  const blind = list.groups.now.filter(r => r.step === 'no-send-date');
  const actionable = Object.assign({}, list, {
    rows: list.rows.filter(r => r.step !== 'no-send-date')
  });
  const byRep = quotationWorklistByRep(actionable).filter(r => r.now.length);

  const blindNote = blind.length
    ? `<div class="qtw-blind">${blind.length} quotation${blind.length === 1 ? '' : 's'} across the team
         ${blind.length === 1 ? 'has' : 'have'} no send date, so ${blind.length === 1 ? 'it' : 'they'}
         cannot be ranked by how long ${blind.length === 1 ? 'it has' : 'they have'} been quiet.
         <a href="flow-quotations.html">Estimate them →</a></div>`
    : '';

  if (!byRep.length) {
    el.innerHTML = '<div class="qtw-empty">✓ Nothing across the team is waiting on a rep right now.</div>' +
      blindNote;
    return;
  }

  /* The headline is EXPOSURE, not a count: "11 quotations" is a number, "₱18.4M waiting on someone"
     is a decision. */
  const total = byRep.reduce((s, r) => s + r.nowValue, 0);
  const n = byRep.reduce((s, r) => s + r.now.length, 0);

  el.innerHTML =
    `<div class="qtw-head"><b>${n} quotation${n === 1 ? '' : 's'}</b> waiting on a rep
       · <b>${flowMoney(total, 'PHP')}</b></div>` +
    byRep.map(rep => {
      /* What kind of work, not just how much: a rep with three rejections has a different problem
         from one with three quiet clients. */
      const kinds = {};
      rep.now.forEach(r => { kinds[r.verb || r.title] = (kinds[r.verb || r.title] || 0) + 1; });
      const chips = Object.keys(kinds).map(k =>
        `<span class="qtw-chip">${flowEsc(k)} ${kinds[k]}</span>`).join('');
      const top = rep.now.slice(0, 4);
      return `<div class="qtw-rep">
          <div class="qtw-rephead">
            <span class="who">${flowEsc(rep.rep)}</span>
            <span class="chips">${chips}</span>
            <span class="val">${flowMoney(rep.nowValue, 'PHP')}</span>
          </div>
          ${top.map(r => `<div class="qtw-item">
              <span class="step">${flowEsc(r.verb || r.title)}</span>
              <span class="no">${flowEsc(r.quotation.quotationNo)}</span>
              <span class="cust">${flowEsc(r.quotation.customer || '—')}</span>
              <span class="why">${flowEsc(r.line)}</span>
              <span class="money">${flowMoney(r.value, 'PHP')}</span>
            </div>`).join('')}
          ${rep.now.length > top.length
            ? `<div class="qtw-more">…and ${rep.now.length - top.length} more</div>` : ''}
        </div>`;
    }).join('') + blindNote +
    `<div class="qtw-foot"><a href="flow-quotations.html">Open the full list →</a></div>`;
}

/** The styles travel with the module, so a page adopts the panel by adding one div and one script
 *  rather than a block of CSS it then has to keep in step. */
(function qtwStyle() {
  if (typeof document === 'undefined' || document.getElementById('qtwCss')) return;
  const s = document.createElement('style');
  s.id = 'qtwCss';
  s.textContent = `
    .qtw-head { font-size:.86rem; color:var(--text-secondary,#475569); margin-bottom:.6rem; }
    .qtw-empty { padding:.8rem 0; color:var(--text-muted,#64748b); font-size:.86rem; }
    .qtw-rep { border-top:1px solid var(--border,#e2e8f0); padding:.6rem 0; }
    .qtw-rep:first-of-type { border-top:0; }
    .qtw-rephead { display:flex; gap:.6rem; align-items:center; flex-wrap:wrap; margin-bottom:.3rem; }
    .qtw-rephead .who { font:700 .86rem 'Inter',sans-serif; color:var(--text-primary,#0f172a); }
    .qtw-rephead .val { margin-left:auto; font:600 .82rem 'Inter',sans-serif;
      font-variant-numeric:tabular-nums; color:var(--text-primary,#0f172a); }
    .qtw-chip { display:inline-block; padding:.08rem .45rem; border-radius:999px; margin-right:.25rem;
      background:var(--bg-inset,#f1f5f9); color:var(--text-secondary,#475569);
      font:700 .66rem 'Inter',sans-serif; }
    .qtw-item { display:flex; gap:.55rem; align-items:baseline; padding:.16rem 0 .16rem .3rem;
      font-size:.78rem; color:var(--text-secondary,#475569); }
    .qtw-item .step { flex:none; width:44px; font-weight:700; color:var(--text-primary,#0f172a); }
    .qtw-item .no { flex:none; max-width:210px; overflow:hidden; text-overflow:ellipsis;
      white-space:nowrap; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.72rem; }
    .qtw-item .cust { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .qtw-item .why { flex:none; color:var(--text-muted,#64748b); }
    .qtw-item .money { flex:none; font-variant-numeric:tabular-nums; min-width:96px; text-align:right; }
    .qtw-more { font-size:.74rem; color:var(--text-muted,#64748b); padding:.1rem 0 0 .3rem; }
    .qtw-blind { margin-top:.6rem; padding:.5rem .7rem; border-radius:9px; background:var(--bg-inset,#f8fafc);
      border-left:3px solid #94a3b8; font-size:.76rem; line-height:1.6; color:var(--text-secondary,#475569); }
    .qtw-blind a { color:var(--accent-dark,#0f766e); font-weight:600; text-decoration:none; }
    .qtw-foot { margin-top:.6rem; font-size:.8rem; }
    .qtw-foot a { color:var(--accent-dark,#0f766e); font-weight:600; text-decoration:none; }
    @media (max-width:760px) {
      .qtw-item { flex-wrap:wrap; }
      .qtw-item .no { max-width:100%; }
      .qtw-item .money { min-width:0; }
    }`;
  document.head.appendChild(s);
})();
