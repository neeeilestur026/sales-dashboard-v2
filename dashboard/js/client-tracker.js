/* ═══════════════════════════════════════════════
   client-tracker.js — one client, one timeline (A217).

   Apex Mining has 16 quotations. Until now they were 16 rows scattered through a date-ordered table
   of 85, and the only way to see the relationship was to filter, read, and remember. The visits were
   on another page, the orders on a third, and nothing joined them.

   The grouping is in client-rollup.js — pure, table-tested, and a faithful port of the SERVER's
   client canonicaliser rather than a new opinion about who a client is. Read its header before
   changing anything about identity: the ClientAliases sheet outranks the algorithm, and the browser
   cannot see that sheet yet, so the page says so out loud rather than quietly presenting a merge
   somebody has already corrected.
   ═══════════════════════════════════════════════ */

let ctSession = null;
let ctModel = null;
let ctPick = null;
let ctPhotos = {}, ctPhotoDone = {};
let ctSeq = 0;

function _cte(s) { return (typeof flowEsc === 'function') ? flowEsc(s) : String(s == null ? '' : s); }

document.addEventListener('DOMContentLoaded', () => {
  ctSession = requireQuotationAccess();
  if (!ctSession) return;
  renderNavbar('client-tracker');

  let t = null;
  document.getElementById('ctSearch').addEventListener('input', () => {
    clearTimeout(t); t = setTimeout(ctRenderRail, 180);
  });
  document.getElementById('ctRefresh').addEventListener('click', () => ctLoad(true));
  document.getElementById('ctPrint').addEventListener('click', () => window.print());

  ctLoad();
});

async function ctLoad(fresh) {
  const seq = ++ctSeq;
  document.getElementById('ctPane').innerHTML =
    '<div class="loading-overlay"><div class="spinner spinner-lg"></div><span>Loading...</span></div>';
  ctPhotos = {}; ctPhotoDone = {};
  const opt = fresh ? { fresh: true } : {};

  try {
    /* getClientVisits filters by a single date only, so a client's whole visit history would be one
       call per day for ever. Unfiltered it returns every visit in the company — 10 rows today, and
       the same call the A216 page already makes. If that ever grows, this is the first place to feel
       it, and the fix is a date-range filter on the handler rather than a cache here. */
    const [q, so, cv, le] = await Promise.all([
      fetchFlow('getQuotations', {}, opt).then(r => (r && r.data) || []),
      fetchFlow('getSalesOrders', {}, opt).then(r => (r && r.data) || []).catch(() => []),
      fetchFlow('getClientVisits', {}, opt).then(r => (r && r.data) || []).catch(() => []),
      fetchFlow('getQuotationEmails', {}, opt).then(r => (r && r.data) || []).catch(() => [])
    ]);
    if (seq !== ctSeq) return;

    const links = {};
    le.forEach(l => { const k = String(l.quotationNo || ''); if (k) (links[k] = links[k] || []).push(l); });

    ctModel = clientRollup({ quotations: q, orders: so, visits: cv, links: links });

    if (!ctPick || !ctModel.clients.some(c => c.key === ctPick)) {
      ctPick = ctModel.clients.length ? ctModel.clients[0].key : null;
    }
    ctRenderRail();
    ctRenderPane();
  } catch (e) {
    document.getElementById('ctPane').innerHTML = `<p style="color:#ef4444;">${_cte(e.message)}</p>`;
  }
}

/* ── the rail ───────────────────────────────────────────────────────────────────────────────── */

function ctRenderRail() {
  const host = document.getElementById('ctRail');
  if (!ctModel) return;
  const term = String(document.getElementById('ctSearch').value || '').toLowerCase().trim();
  const list = ctModel.clients.filter(c =>
    !term || c.name.toLowerCase().indexOf(term) !== -1 ||
    c.names.some(n => n.toLowerCase().indexOf(term) !== -1));

  if (!list.length) {
    host.innerHTML = '<div class="ct-empty" style="font-size:.78rem;">No client matches that.</div>';
    return;
  }
  host.innerHTML = list.map(c => `
    <button class="ct-who${c.key === ctPick ? ' on' : ''}" data-key="${_cte(c.key)}">
      <span class="n">${_cte(c.name)}</span>
      <span class="c">${c.counts.quotations}q · ${c.counts.orders}so · ${c.counts.visits}v
        ${c.priceFindings.length ? '<span class="warn">· price ≠</span>' : ''}</span>
    </button>`).join('');

  host.querySelectorAll('.ct-who').forEach(b => b.addEventListener('click', () => {
    ctPick = b.getAttribute('data-key');
    ctRenderRail(); ctRenderPane();
  }));
}

/* ── the pane ───────────────────────────────────────────────────────────────────────────────── */

function ctRenderPane() {
  const host = document.getElementById('ctPane');
  const c = ctModel && ctModel.clients.find(x => x.key === ctPick);
  if (!c) { host.innerHTML = '<div class="ct-empty">Pick a client on the left.</div>'; return; }

  host.innerHTML = ctHead(c) + ctIdentityNote(c) + ctPriceNote(c) + ctTimeline(c);
  ctLoadPhotos(c);
}

function ctHead(c) {
  const other = c.names.filter(n => n !== c.name);
  return `<div class="ct-head">
    <h2>${_cte(c.name)}</h2>
    ${other.length ? `<div class="alias">also written ${other.map(n => _cte(n)).join(' · ')}</div>` : ''}
    <div class="ct-stats">
      <div>Quotations<b>${c.counts.quotations}</b></div>
      <div>Quoted value<b>${flowMoney(c.value, 'PHP')}</b></div>
      <div>Sales orders<b>${c.counts.orders}</b></div>
      <div>Visits<b>${c.counts.visits}</b></div>
      <div>Last activity<b>${_cte(c.lastTouch || '—')}</b></div>
    </div>
  </div>`;
}

/** Say plainly that the grouping is the algorithm's opinion when the alias registry was unavailable.
 *  Only shown where it could actually matter — a client with more than one spelling. */
function ctIdentityNote(c) {
  if (ctModel.usedRegistry || c.names.length < 2) return '';
  return `<div class="ct-note info">These ${c.names.length} spellings were merged by name.
    The reviewed client registry is not readable from this page yet, so a split recorded there —
    one business unit filed apart from another — would not be reflected here.</div>`;
}

function ctPriceNote(c) {
  if (!c.priceFindings.length) return '';
  const rows = c.priceFindings.slice(0, 6).map(f => `<tr>
      <td>${_cte(f.item.slice(0, 60))}${f.sameDay ? ' <b>· same day</b>' : ''}</td>
      <td class="num">${flowMoney(f.low, 'PHP')} → ${flowMoney(f.high, 'PHP')}</td>
      <td class="num"><b>${f.gapPct}%</b></td>
      <td class="num" style="color:var(--text-muted,#94a3b8);">${f.quotes.map(x => _cte(x.date)).join(' · ')}</td>
    </tr>`).join('');
  /* Reported, not judged. A price moves for honest reasons — another supplier, a currency swing, a
     quantity break — so this shows the numbers and the dates and lets a person decide. What it must
     not do is stay silent while a client compares two of our own quotes. */
  return `<div class="ct-note warn">
    <b>The same item was quoted to this client at more than one price.</b>
    There may be a good reason — a different supplier, a rate change, a quantity break — but they can
    see both quotes, so it is worth knowing.
    <table>${rows}</table>
    ${c.priceFindings.length > 6 ? `<div style="margin-top:.3rem;">…and ${c.priceFindings.length - 6} more.</div>` : ''}
  </div>`;
}

function ctTimeline(c) {
  if (!c.timeline.length) return '<div class="ct-empty">Nothing recorded for this client yet.</div>';
  return '<div class="ct-tl">' + c.timeline.map(e => {
    const money = e.value ? `<span class="v">${flowMoney(e.value, 'PHP')}</span>` : '';
    let sub = '';
    if (e.kind === 'quotation') {
      sub = `${_cte(e.ref)}${e.status ? ' · ' + _cte(e.status) : ''}${e.who ? ' · ' + _cte(e.who) : ''}` +
            (e.emails ? ` · ${e.emails} email${e.emails === 1 ? '' : 's'} linked` : '');
    } else if (e.kind === 'sent') {
      sub = e.who ? 'to ' + _cte(e.who) : 'recipient not recorded';
    } else if (e.kind === 'visit') {
      sub = `${_cte(e.who)}${e.note ? ' — ' + _cte(String(e.note).slice(0, 220)) : ''}`;
    } else if (e.kind === 'order') {
      sub = `${_cte(e.ref)}${e.quotationNo ? ' · from ' + _cte(e.quotationNo)
                                            : ' · <span style="color:#b45309;">no quotation recorded</span>'}`;
    }
    return `<div class="ct-ev ${_cte(e.kind)}">
        <div class="top">
          <span class="d">${_cte(e.date || '—')}</span>
          <span class="ct-kind">${_cte(e.kind)}</span>
          <span class="t">${_cte(e.title || '')}</span>
          ${money}
        </div>
        <div class="sub">${sub}</div>
        ${e.kind === 'visit' && e.photoDocId ? `<div class="sub" data-ctphoto="${_cte(e.ref)}">📷</div>` : ''}
      </div>`;
  }).join('') + '</div>';
}

/* ── visit photos ───────────────────────────────────────────────────────────────────────────── */

/* Each photo is a Drive round trip returned as base64 (getVisitPhotos, FlowAPI.gs:5689), so they are
   fetched only for the client on screen, only for the days that have one, and only once. */
async function ctLoadPhotos(c) {
  if (ctPhotoDone[c.key]) { ctPatchPhotos(c); return; }
  const days = Array.from(new Set(c.visits.filter(v => v.photoDocId).map(v => String(v.date).slice(0, 10))));
  if (!days.length) { ctPhotoDone[c.key] = true; return; }
  ctPhotoDone[c.key] = true;
  const seq = ctSeq;
  try {
    const packs = await Promise.all(days.map(d =>
      fetchFlow('getVisitPhotos', { date: d }).then(x => (x && x.data) || []).catch(() => [])));
    if (seq !== ctSeq || ctPick !== c.key) return;
    packs.forEach(p => p.forEach(ph => {
      ctPhotos[String(ph.visitNo)] = 'data:' + (ph.mimeType || 'image/jpeg') + ';base64,' + ph.base64;
    }));
    ctPatchPhotos(c);
  } catch (e) { ctPhotoDone[c.key] = false; }
}

function ctPatchPhotos(c) {
  document.querySelectorAll('[data-ctphoto]').forEach(el => {
    const src = ctPhotos[el.getAttribute('data-ctphoto')];
    if (src) el.innerHTML = `<img class="ct-photo" src="${src}" alt="Visit photo"
      onclick="ctZoom('${_cte(el.getAttribute('data-ctphoto'))}')">`;
  });
}

function ctZoom(visitNo) {
  const src = ctPhotos[String(visitNo)];
  if (!src) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:4000;display:flex;' +
                     'align-items:center;justify-content:center;padding:2rem;cursor:zoom-out;';
  el.innerHTML = `<img src="${src}" alt="Visit photo" style="max-width:100%;max-height:100%;border-radius:8px;">`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}
