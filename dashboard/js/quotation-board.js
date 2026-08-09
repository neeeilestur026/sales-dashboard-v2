/* ═══════════════════════════════════════════════
   quotation-board.js — the pipeline as a place (A217).

   A215 answered "what do I do next" with a worklist. Nobody could answer "where does everything
   stand" — 72 sent quotations worth ₱110M lived in a date-ordered table, and the only way to see the
   shape of the pipeline was to read 85 rows and hold them in your head.

   This is a PROJECTION of the worklist, not a second opinion about it. Every judgement — what state
   a quotation is in, how late it is, what it needs — was already made by quotationWorklistStep. The
   column mapping lives in quotation-board-model.js, pure and table-tested, and this file only draws
   it. If the two ever disagree about whether a deal is live, that is a bug in one place, not a
   difference of opinion between two screens. A208 is the local reason that rule exists.

   Dragging is deliberately narrow. A card moves only where the backend already has an action for the
   move, and approving is NOT one of them: approveQuotation is gated on the stale-PDF check and, for
   the tiers that can see it, on the pricing review. Letting a drag past two gates would be a second,
   weaker approval path. The board refuses out loud and says where to go instead.
   ═══════════════════════════════════════════════ */

let qbSession = null;
let qbRows = [];              // the full worklist rows for the current data
let qbHasSO = {}, qbLinks = {}, qbCfg = null;
let qbReps = [];
let qbShowAll = {};           // column key -> the reader asked to see past the first slice
let qbSeq = 0;

const QB_PAGE = 25;           // cards drawn per column before "show the rest"

function _qbe(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }

document.addEventListener('DOMContentLoaded', () => {
  qbSession = requireQuotationAccess();
  if (!qbSession) return;
  renderNavbar('quotation-board');

  ['qbRep', 'qbAge'].forEach(id => document.getElementById(id).addEventListener('change', qbRender));
  let t = null;
  document.getElementById('qbSearch').addEventListener('input', () => {
    clearTimeout(t); t = setTimeout(qbRender, 200);
  });
  document.getElementById('qbRefresh').addEventListener('click', () => qbLoad(true));
  document.getElementById('qbPrint').addEventListener('click', () => window.print());

  qbLoad();
});

/* WHO SEES EVERYONE'S QUOTATIONS.
 *
 * Exactly the rule the quotation list already uses (flow-quotations.js:41) — management, director,
 * admin and accounting see the whole book; a sales rep sees their own. Restating it as a different
 * set here would mean the board and the list disagreed about what a rep is allowed to look at, and
 * the more permissive of the two would silently become the real policy.
 *
 * It scopes the FETCH, not the filter. The first version of this page loaded every quotation and
 * merely pre-selected the rep's name in a dropdown they could change back to "Everyone" — the rows
 * were already in the browser. */
function qbIsOversight() {
  return String(qbSession.role || '').toLowerCase() !== 'sales';
}

async function qbLoad(fresh) {
  const seq = ++qbSeq;
  const wrap = document.getElementById('qbWrap');
  wrap.innerHTML = '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  const opt = fresh ? { fresh: true } : {};
  try {
    /* A sales rep's request carries their name, so the rows for other reps never reach the browser.
       getQuotations is not _SECURED, so this scoping is advisory at the API level — the same
       limitation the quotation list has always had, and the fix belongs in the backend rather than
       in a second place here. */
    const scope = qbIsOversight() ? {} : { createdBy: qbSession.name };
    const [q, so, le, cf] = await Promise.all([
      fetchFlow('getQuotations', scope, opt).then(r => (r && r.data) || []),
      fetchFlow('getSalesOrders', {}, opt).then(r => (r && r.data) || []).catch(() => []),
      fetchFlow('getQuotationEmails', {}, opt).then(r => (r && r.data) || []).catch(() => []),
      fetchFlow('getFlowSettings', {}, opt).then(r => (r && r.data) || null).catch(() => null)
    ]);
    if (seq !== qbSeq) return;

    qbHasSO = {}; so.forEach(s => { if (s.quotationNo) qbHasSO[String(s.quotationNo)] = true; });
    qbLinks = {}; le.forEach(l => {
      const k = String(l.quotationNo || ''); if (k) (qbLinks[k] = qbLinks[k] || []).push(l);
    });
    qbCfg = cf;

    /* A rep sees their own book by default; oversight sees everyone. The filter is applied to the
       ROWS rather than to the fetch, so switching rep does not cost a round trip. */
    qbRows = quotationWorklist(q, qbLinks, qbCfg, qbHasSO).rows;
    qbReps = Array.from(new Set(q.map(x => String(x.createdBy || '—')))).sort();
    qbFillRepFilter();
    qbRender();
  } catch (e) {
    wrap.innerHTML = `<p style="color:#ef4444;">${_qbe(e.message)}</p>`;
  }
}

function qbFillRepFilter() {
  const sel = document.getElementById('qbRep');
  /* A rep has nobody to filter between — the only rows they can load are their own. The control is
     removed rather than disabled, because a greyed-out "Everyone" invites the question of what is
     behind it. */
  // Set BOTH ways round, never just the hiding one: a function that can only hide leaves the control
  // invisible for the next caller, and "it works because the page reloads" is not a reason.
  sel.style.display = qbIsOversight() ? '' : 'none';
  if (!qbIsOversight()) return;
  if (sel.options.length) return;                       // keep the reader's choice across refreshes
  sel.innerHTML = '<option value="">Everyone</option>' +
    qbReps.map(r => `<option value="${_qbe(r)}">${_qbe(r)}</option>`).join('');
}

/* ── drawing ────────────────────────────────────────────────────────────────────────────────── */

function qbFiltered() {
  const rep = document.getElementById('qbRep').value;
  const minAge = parseInt(document.getElementById('qbAge').value, 10) || 0;
  const term = String(document.getElementById('qbSearch').value || '').toLowerCase().trim();
  return qbRows.filter(r => {
    const q = r.quotation || {};
    if (rep && String(q.createdBy || '—') !== rep) return false;
    if (minAge && !(Number(r.days) >= minAge)) return false;
    if (term) {
      const hay = (String(q.customer || '') + ' ' + String(q.quotationNo || '') + ' ' +
                   String(q.subject || '')).toLowerCase();
      if (hay.indexOf(term) === -1) return false;
    }
    return true;
  });
}

function qbRender() {
  const rows = qbFiltered();
  const board = quotationBoard({ rows: rows });
  const wrap = document.getElementById('qbWrap');

  wrap.innerHTML = board.columns.map(col => `
    <div class="qb-col" data-col="${_qbe(col.key)}">
      <div class="qb-head">
        <div class="l">${_qbe(col.label)}</div>
        <div class="s">${_qbe(col.sub)}</div>
        <div class="n"><b>${col.count}</b><span>${col.value ? flowMoney(col.value, 'PHP') : ''}</span></div>
      </div>
      <div class="qb-cards" data-drop="${_qbe(col.key)}">
        ${col.rows.length
          ? col.rows.slice(0, qbShowAll[col.key] ? col.rows.length : QB_PAGE).map(qbCard).join('') +
            (col.rows.length > QB_PAGE && !qbShowAll[col.key]
              ? `<div class="qb-more"><button data-more="${_qbe(col.key)}">show the other ${col.rows.length - QB_PAGE}</button></div>` : '')
          : '<div class="qb-empty">nothing here</div>'}
      </div>
    </div>`).join('');

  qbRenderNote(rows, board);
  qbWire();
}

/** The honest caption. The Won column is built from whether a SALES ORDER records the quotation, and
 *  only ~7 of 106 orders do — so "Won" is a floor, not a conversion rate, and the board has to say so
 *  rather than let someone read a win rate off it. The same warning already sits on the list page
 *  (flow-quotations.js:451); this is the second place it is needed. */
function qbRenderNote(rows, board) {
  const won = board.columns.find(c => c.key === 'won');
  const client = board.columns.find(c => c.key === 'client');
  const noDate = rows.filter(r => r.step === 'no-send-date').length;
  const bits = [];
  if (client && client.count) {
    bits.push(`<b>${flowMoney(client.value, 'PHP')}</b> is sitting with clients across ${client.count}
      quotation${client.count === 1 ? '' : 's'}.`);
  }
  if (noDate) {
    bits.push(`${noDate} of them <b>have no send date</b>, so their age is unknown and they sort as if
      new. <a href="flow-quotations.html">Estimate the dates →</a>`);
  }
  if (won) {
    bits.push(`<b>Won</b> counts only quotations a sales order actually names — most orders do not
      record one, so treat it as a floor, never as a conversion rate.`);
  }
  document.getElementById('qbNote').innerHTML = bits.length
    ? `<div class="qb-note">${bits.join(' ')}</div>` : '';
}

function qbCard(r) {
  const q = r.quotation || {};
  /* `days` is null when the age is genuinely UNKNOWN — 60 of the 72 sent quotations have no send
     date. It must not be coerced: Number(null) is 0 and isFinite(0) is true, so an unknown age
     rendered as "today", i.e. the freshest possible card, on exactly the rows nobody can date. The
     whole point of the board is age, so the one state it must never fake is this one. */
  const known = r.days !== null && r.days !== undefined && isFinite(Number(r.days));
  const d = known ? Number(r.days) : null;
  /* Banding is by how long it has SAT, not by which column it is in — a young card in a late column
     should not look alarming, and an old one anywhere should. */
  const band = r.step === 'snoozed' ? 'parked'
             : !known ? 'a0' : d >= 30 ? 'a3' : d >= 14 ? 'a2' : d >= 7 ? 'a1' : 'a0';
  /* '?' means "this should have an age and does not" — it is a prompt to fix the record. A won or
     closed deal has no clock running at all, so it gets nothing rather than a question mark that
     reads as a data problem. */
  const age = r.step === 'snoozed' ? 'parked'
            : r.group === 'done' ? ''
            : !known ? '?' : (d <= 0 ? 'today' : d + 'd');
  return `<div class="qb-card ${band}" draggable="true" data-no="${_qbe(q.quotationNo)}"
              data-col="${_qbe(quotationBoardColumn(r))}" title="${_qbe(r.title + ' · ' + r.line)}">
      <div class="cust">${_qbe(q.customer || '—')}</div>
      <div class="no">${_qbe(q.quotationNo)}</div>
      <div class="foot">
        <span class="val">${flowMoney(r.value, 'PHP')}</span>
        <span class="age">${_qbe(age)}</span>
      </div>
      <div class="who">${_qbe(q.createdBy || '')}${r.line ? ' · ' + _qbe(r.line) : ''}</div>
    </div>`;
}

/* ── dragging ───────────────────────────────────────────────────────────────────────────────── */

let qbDrag = null;             // { no, from }

function qbWire() {
  const wrap = document.getElementById('qbWrap');

  wrap.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => {
    qbShowAll[b.getAttribute('data-more')] = true; qbRender();
  }));

  wrap.querySelectorAll('.qb-card').forEach(el => {
    el.addEventListener('click', ev => {
      if (ev.target.closest('button')) return;
      // The card is a way in, not a replacement for the real screen.
      window.location.href = 'flow-quotations.html#q=' + encodeURIComponent(el.getAttribute('data-no'));
    });
    el.addEventListener('dragstart', ev => {
      qbDrag = { no: el.getAttribute('data-no'), from: el.getAttribute('data-col') };
      el.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag without payload, even when nothing reads it.
      try { ev.dataTransfer.setData('text/plain', qbDrag.no); } catch (e) {}
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); qbDrag = null;
      wrap.querySelectorAll('.qb-col').forEach(c => c.classList.remove('over', 'no')); });
  });

  wrap.querySelectorAll('[data-drop]').forEach(zone => {
    const col = zone.closest('.qb-col');
    zone.addEventListener('dragover', ev => {
      if (!qbDrag) return;
      const move = quotationBoardMove(qbDrag.from, zone.getAttribute('data-drop'));
      if (!move) return;
      // Paint the answer BEFORE the drop, so a refused move is obvious while the card is still in hand.
      col.classList.toggle('over', !!move.ok);
      col.classList.toggle('no', !move.ok);
      if (move.ok) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; }
    });
    zone.addEventListener('dragleave', () => col.classList.remove('over', 'no'));
    zone.addEventListener('drop', ev => {
      ev.preventDefault();
      col.classList.remove('over', 'no');
      if (!qbDrag) return;
      qbDrop(qbDrag.no, qbDrag.from, zone.getAttribute('data-drop'));
    });
  });
}

async function qbDrop(no, from, to) {
  const move = quotationBoardMove(from, to);
  if (!move) return;
  if (!move.ok) { flowMsg('qbMsg', move.reason, false); return; }

  const row = qbRows.find(r => String((r.quotation || {}).quotationNo) === String(no));
  const cust = row ? (row.quotation.customer || no) : no;

  let extra = {};
  if (move.needsReason) {
    /* The parameter is `outcome`, not `status` — closeQuotation (FlowAPI.gs:5356) silently falls back
       to 'Not Pursued' for anything it does not recognise, so sending the wrong key would close every
       lost deal as not-pursued and look like it worked. Same three outcomes the close modal offers. */
    const why = prompt(`Close ${cust}'s quotation ${no}.\n\nType one of: Not Pursued · Lost · Cancelled`,
                       'Not Pursued');
    if (why === null) return;
    const clean = String(why).trim();
    if (['Not Pursued', 'Lost', 'Cancelled'].indexOf(clean) === -1) {
      flowMsg('qbMsg', 'A quotation can be closed as Not Pursued, Lost or Cancelled.', false); return;
    }
    extra.outcome = clean;
    extra.reason = 'Closed from the board';
  } else if (!confirm(`${move.verb}: ${cust} — ${no}?`)) return;

  try {
    const res = await postFlow(move.action, Object.assign({ quotationNo: no }, extra));
    if (!res || !res.success) throw new Error((res && res.message) || 'That did not go through.');
    flowMsg('qbMsg', res.message || move.verb + ' — done.', true);
    await qbLoad(true);        // fresh: the move must not be read back out of the 60s cache
  } catch (e) {
    flowMsg('qbMsg', e.message, false);
  }
}
