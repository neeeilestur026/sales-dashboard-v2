/* A217 — everything about one client, in one place. Pure, DOM-free, table-tested.
 *
 * Apex Mining has 16 quotations, Itogon-Suyoc 6, Eagle Cement 5. Today they are scattered rows in a
 * date-ordered table and no screen can answer "what is going on with Apex" — the quotations are on
 * one page, the visits on another, the orders on a third, and nothing joins them.
 *
 * ── WHO IS A CLIENT ─────────────────────────────────────────────────────────────────────────────
 *
 * The authority is the SERVER: _canonClient (FlowAPI.gs:4245) resolves a raw customer name through
 * the ClientAliases sheet first and only then falls back to the _canonKey algorithm. That order
 * matters and is not cosmetic — an alias row can deliberately SPLIT what the algorithm merged, which
 * is how "Aboitiz Power - TL" is kept apart from "- TSI BU" (FlowAPI.gs:4166-4168). No handler
 * exposes the registry to the browser yet.
 *
 * So this module mirrors the server's precedence exactly — `registry.byRaw[rawKey] || crCanonKey(raw)`
 * — and takes the registry as an optional input. crCanonKey is a faithful port of _canonKey,
 * including its suffix list and its two hard-won rules (a parenthesised abbreviation is the same firm;
 * a dash followed by whitespace starts a business-unit suffix, but a dash between two word characters
 * does not, which is what keeps "Itogon-Suyoc" intact).
 *
 * WITHOUT the registry the grouping is the algorithm's opinion alone, which means any alias-driven
 * split is not honoured. `usedRegistry` is returned so the page can say so out loud rather than
 * quietly present a merge somebody has already corrected on the sheet.
 */

/* Verbatim from FlowAPI.gs:4149. Kept identical on purpose: two different suffix lists would put the
   same client in two different folders on the server and two different rows here. */
const CR_SUFFIX_RE = /\b(corporation|corp|incorporated|inc|company|co|ltd|limited|enterprises|enterprise|ent|philippines|phils|phil|international|intl|group|holdings|resources)\b/g;

/** Faithful port of _canonKey (FlowAPI.gs:4151). */
function crCanonKey(name) {
  let s = String(name == null ? '' : name).toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' ');        // "(FFHC)" is the same firm abbreviating itself
  s = s.replace(/\s*[-–—]\s+.*$/, '');     // " - TSI BU" is a business unit; "Itogon-Suyoc" is not
  s = s.replace(/[.,]/g, ' ');
  s = s.replace(CR_SUFFIX_RE, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Port of _rawKey (FlowAPI.gs:4168) — the raw spelling, normalised only for lookup. */
function crRawKey(name) { return String(name == null ? '' : name).toLowerCase().replace(/\s+/g, ' ').trim(); }

/** name -> canonical key, honouring the alias registry first exactly as the server does. */
function crKeyFor(name, registry) {
  const raw = String(name == null ? '' : name).trim();
  if (!raw) return '';
  const byRaw = (registry && registry.byRaw) || null;
  if (byRaw) {
    const pinned = byRaw[crRawKey(raw)];
    if (pinned) return pinned;
  }
  return crCanonKey(raw);
}

/** The spelling a human should see. The registry wins; otherwise the longest raw spelling seen, which
 *  is the most complete one — mirroring _displayBetter's first test (FlowAPI.gs:4233). */
function crDisplay(names, key, registry) {
  const byKey = (registry && registry.byKey) || null;
  if (byKey && byKey[key]) return byKey[key];
  return (names || []).slice().sort((a, b) =>
    (b.length - a.length) || a.localeCompare(b))[0] || key;
}

function _crNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function _crDate(v) { return String(v == null ? '' : v).slice(0, 10); }

/* ── the repeat-price check ─────────────────────────────────────────────────────────────────────
 *
 * Of the 8 items ever quoted more than once on the live book, 4 went to the SAME client at different
 * prices — including two quotations to Petra Cement on the same day, 22% apart. Nothing in the system
 * can see that today, and a client comparing two of our quotes certainly can.
 *
 * This REPORTS, it does not judge. A price can move for honest reasons — a different supplier, a
 * currency swing, a quantity break — so the finding carries the dates and the numbers and lets a
 * person decide. What it must never do is stay silent.
 */
function crItemKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * @param {object[]} quotations one client's quotations
 * @returns {object[]} [{item, low, high, gapPct, quotes:[{quotationNo, date, price, qty}]}]
 *          worst gap first. Empty when nothing was quoted twice.
 */
function crPriceFindings(quotations) {
  const byItem = {};
  (quotations || []).forEach(q => ((q || {}).items || []).forEach(i => {
    const k = crItemKey((i || {}).itemName);
    if (!k) return;
    (byItem[k] = byItem[k] || []).push({
      quotationNo: String((q || {}).quotationNo || ''), date: _crDate(q.date),
      price: Math.round(_crNum(i.price) * 100) / 100, qty: _crNum(i.qty),
      itemName: String(i.itemName || '')
    });
  }));

  const out = [];
  Object.keys(byItem).forEach(k => {
    const rows = byItem[k];
    if (rows.length < 2) return;
    const prices = rows.map(r => r.price).filter(p => p > 0);
    if (prices.length < 2) return;
    const low = Math.min.apply(null, prices), high = Math.max.apply(null, prices);
    if (high - low <= 0.01) return;                       // quoted twice at the same price: fine
    out.push({
      item: rows[0].itemName,
      low: low, high: high,
      gapPct: Math.round((high / low - 1) * 100),
      sameDay: rows.length > 1 && rows.every(r => r.date === rows[0].date),
      quotes: rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
    });
  });
  return out.sort((a, b) => b.gapPct - a.gapPct);
}

/* ── the rollup ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Group everything by client.
 *
 * @param {object}   d  {quotations, visits, orders, links}  — links is {quotationNo: [...]}
 * @param {object} [opts] {registry, today}
 * @returns {{clients: Array, usedRegistry: boolean}} clients sorted by activity, each
 *   {key, name, names[], quotations[], visits[], orders[], value, lastTouch, priceFindings[], timeline[]}
 */
function clientRollup(d, opts) {
  const o = opts || {};
  const reg = o.registry || null;
  const data = d || {};
  const by = {};

  const bucket = (name) => {
    const key = crKeyFor(name, reg);
    if (!key) return null;
    if (!by[key]) by[key] = { key: key, names: [], quotations: [], visits: [], orders: [] };
    const raw = String(name || '').trim();
    if (raw && by[key].names.indexOf(raw) === -1) by[key].names.push(raw);
    return by[key];
  };

  (data.quotations || []).forEach(q => { const b = bucket((q || {}).customer); if (b) b.quotations.push(q); });
  (data.orders || []).forEach(s => { const b = bucket((s || {}).customer); if (b) b.orders.push(s); });
  /* A client visit names the company in free text typed on a phone — "ecc", "isri mining". It goes
     through the same canonicaliser, so a visit reaches its client whenever the name agrees; when it
     does not, the visit simply forms its own row rather than being silently attached to the wrong
     client. */
  (data.visits || []).forEach(v => { const b = bucket((v || {}).company); if (b) b.visits.push(v); });

  const clients = Object.keys(by).map(key => {
    const c = by[key];
    const value = c.quotations.reduce((s, q) =>
      s + ((typeof flowQuotationNet === 'function') ? flowQuotationNet(q) : _crNum(q.total)), 0);
    const timeline = crTimeline(c, data.links || {});
    return {
      key: key,
      name: crDisplay(c.names, key, reg),
      names: c.names.slice().sort(),
      quotations: c.quotations.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
      visits: c.visits.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
      orders: c.orders.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))),
      counts: { quotations: c.quotations.length, visits: c.visits.length, orders: c.orders.length },
      value: value,
      lastTouch: timeline.length ? timeline[0].date : '',
      priceFindings: crPriceFindings(c.quotations),
      timeline: timeline
    };
  });

  /* Busiest first: a client with sixteen quotations is the one somebody wants to open. Ties break on
     value, then name, so the order is stable rather than dependent on sheet order. */
  clients.sort((a, b) =>
    (b.counts.quotations + b.counts.orders + b.counts.visits) -
    (a.counts.quotations + a.counts.orders + a.counts.visits) ||
    (b.value - a.value) || a.name.localeCompare(b.name));

  return { clients: clients, usedRegistry: !!(reg && reg.byRaw) };
}

/** One client's history as dated events, newest first. Undated rows are kept — they are still part of
 *  the relationship — and sort last rather than being dropped. */
function crTimeline(c, links) {
  const ev = [];
  (c.quotations || []).forEach(q => {
    ev.push({ kind: 'quotation', date: _crDate(q.date), ref: String(q.quotationNo || ''),
              title: String(q.subject || '') || 'Quotation',
              status: String(q.status || ''), who: String(q.createdBy || ''),
              value: (typeof flowQuotationNet === 'function') ? flowQuotationNet(q) : _crNum(q.total),
              /* A230 — count ACTIVE links only. This is a no-op today, and that is exactly why it
                 goes in now: it was the ONE link counter in the codebase without the filter (every
                 other consumer reaches links through flowFollowUp, which already applies it), so it
                 was the single line that would have started counting "not this" rows as real emails
                 the moment anything handed it an inactive one. */
              emails: ((links || {})[String(q.quotationNo)] || [])
                        .filter(l => String((l || {}).status || 'Active') === 'Active').length });
    if (q.sentAt) ev.push({ kind: 'sent', date: _crDate(q.sentAt), ref: String(q.quotationNo || ''),
                            title: 'Sent to the client', who: String(q.sentTo || '') });
  });
  (c.visits || []).forEach(v => ev.push({ kind: 'visit', date: _crDate(v.date),
    ref: String(v.visitNo || ''), title: String(v.personVisited || 'Client visit'),
    who: String(v.user || ''), note: String(v.summaryOfAgenda || v.agenda || ''),
    photoDocId: String(v.photoDocId || '') }));
  (c.orders || []).forEach(s => ev.push({ kind: 'order', date: _crDate(s.date),
    ref: String(s.soNo || s.salesOrderNo || ''), title: 'Sales order',
    value: _crNum(s.total || s.amount), quotationNo: String(s.quotationNo || '') }));

  return ev.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return String(b.date).localeCompare(String(a.date));
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { crCanonKey, crRawKey, crKeyFor, crDisplay, crItemKey, crPriceFindings,
                     clientRollup, crTimeline, CR_SUFFIX_RE };
}
