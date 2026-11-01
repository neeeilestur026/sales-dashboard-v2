/* item-match.js — A387 · the browser's copy of FlowAPI's item resolver (_ibResolve), so a page decides which stock row a
 * line is by the same rules the server posts by. tests/flow/item-match.js keeps the two identical.
 *
 * The rules, never the first match: a pick; the line's Item ID unless it is SUSPECT (a no-code or shared-code row whose
 * name is not the line's — the quote builder used to stamp the first N/A row's id on every N/A line); a real code only
 * one row has; a code plus the exact name; a no-code line whose exact name only one row has; otherwise unresolved.
 * Rows are the getInventory shape: { itemId, itemNo, description, balance, type }. Pure: no DOM, no network.
 */

function imNormNo(v) {
  const s = String(v == null ? '' : v).trim();
  return (!s || /^(n\/a|na)$/i.test(s) || /^[-–—]+$/.test(s)) ? 'N/A' : s;
}
/** A number that names no product: blank, N/A, NA, dashes, TBA, none. */
function imPlaceholder(no) {
  const s = String(no == null ? '' : no).trim().toLowerCase();
  return imNormNo(no) === 'N/A' || !s || /^(n\/?a|none|tba|-+)$/.test(s);
}
function imIdNorm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/^0+(?=.)/, ''); }
function imRawKey(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function imWords(s) {
  const out = [], seen = {};
  imRawKey(s).slice(0, 80).split(/[^a-z0-9]+/).forEach(w => { if (w.length > 1 && !seen[w]) { seen[w] = 1; out.push(w); } });
  return out;
}
/** A row with no Item ID yet is picked by its sheet row plus a checksum of its name (FlowAPI _ibRowKey). */
function imHash(s) { let h = 5381; const t = imRawKey(s); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); }
function imRowKey(r) { const id = String(r.itemId || '').trim(); return id || 'row:' + r.rowIndex + ':' + imHash(r.description); }
/** Lookups over the rows: by id, by real code, by exact name. `alt` maps an id to its card's display name. */
function imIndex(rows, alt) {
  const ix = { rows: [], byId: {}, byCode: {}, byName: {}, alt: alt || {} };
  (rows || []).forEach(r => {
    ix.rows.push(r);
    const id = String(r.itemId || '').trim(), k = imRawKey(r.description);
    if (id) ix.byId[id] = r;
    if (!imPlaceholder(r.itemNo)) { const c = imIdNorm(r.itemNo); (ix.byCode[c] = ix.byCode[c] || []).push(r); }
    if (k) (ix.byName[k] = ix.byName[k] || []).push(r);
  });
  return ix;
}
/** Rows whose names share most of the line's words (first 80 characters), best first; `first` leads. */
function imCandidates(ix, name, n, first) {
  const want = imWords(name), set = {}, scored = [];
  want.forEach(w => { set[w] = 1; });
  if (want.length) ix.rows.forEach(r => {
    if (first && r === first) return;
    const w = r._imw || (r._imw = imWords(r.description));
    if (!w.length) return;
    let hit = 0;
    const small = Math.min(w.length, want.length);
    w.forEach(x => { if (set[x]) hit++; });
    if (hit >= Math.min(2, small) && hit / small >= 0.5) scored.push({ r, s: hit / small + hit / Math.max(w.length, want.length) });
  });
  scored.sort((a, b) => b.s - a.s);
  return (first ? [first] : []).concat(scored.map(x => x.r)).slice(0, n || 6);
}
/** Which row a line is. q = { itemId, itemNo, name, pick }; o.trustId takes the id as it is (an invoice line).
 *  Returns { row, how, suspect, candidates }. */
function imResolve(ix, q, o) {
  q = q || {}; o = o || {};
  const pick = String(q.pick || '').trim();
  if (pick === 'new' || pick === 'none' || pick === 'skip') return { row: null, how: pick, suspect: '', candidates: [] };
  if (pick) {
    const picked = ix.byId[pick] || (/^row:/.test(pick) ? ix.rows.filter(x => imRowKey(x) === pick)[0] : null);
    return picked ? { row: picked, how: 'pick', suspect: '', candidates: [] } : { row: null, how: 'badpick', suspect: '', candidates: [] };
  }
  const name = imRawKey(q.name), id = String(q.itemId || '').trim(), byId = id ? ix.byId[id] : null;
  let suspect = null;
  if (byId) {
    if (o.trustId) return { row: byId, how: 'id', suspect: '', candidates: [] };
    const shared = imPlaceholder(byId.itemNo) || (ix.byCode[imIdNorm(byId.itemNo)] || []).length > 1;
    if (!shared || !name || name === imRawKey(byId.description) || name === ix.alt[id]) return { row: byId, how: 'id', suspect: '', candidates: [] };
    suspect = byId;
  }
  const done = (row, how) => ({ row, how, suspect: suspect ? id : '', candidates: [] });
  const open = (how, list) => {
    let c = list ? list.slice(0, 6) : imCandidates(ix, q.name, 6, suspect);
    if (list && suspect && c.indexOf(suspect) < 0) c = [suspect].concat(c).slice(0, 6);
    return { row: null, how, suspect: suspect ? id : '', candidates: c };
  };
  if (!imPlaceholder(q.itemNo)) {
    const byCode = ix.byCode[imIdNorm(q.itemNo)] || [];
    if (byCode.length === 1) return done(byCode[0], 'code');
    if (byCode.length > 1) {
      const same = byCode.filter(x => imRawKey(x.description) === name);
      return same.length === 1 ? done(same[0], 'code+name') : open('ambiguous', byCode);
    }
    return open('unknown', null);
  }
  const byName = name ? (ix.byName[name] || []) : [];
  if (byName.length === 1) return done(byName[0], 'name');
  return byName.length > 1 ? open('ambiguous', byName) : open('unmatched', null);
}
/** Search for the picker: every word typed must appear in the code, the name or the id. */
function imSearch(rows, q, n) {
  const words = imRawKey(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  return (rows || []).filter(r => {
    const hay = imRawKey([r.itemNo, r.description, r.itemId, r.displayName].join(' '));
    return words.every(w => hay.indexOf(w) >= 0);
  }).slice(0, n || 8);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { imNormNo, imPlaceholder, imIdNorm, imRawKey, imWords, imHash, imRowKey, imIndex, imCandidates, imResolve, imSearch };
