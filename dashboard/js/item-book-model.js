/* item-book-model.js — A387 · the Item Book's numbers and words (item-book.html), pure and tested in node
 * (tests/flow/item-book-page.js). No DOM, no network: the page (js/item-book.js) draws what these return.
 *
 * An item's title is its card's display name, else the short name taken off a pasted spec sheet (slmShortItem, A386),
 * else its code. Its specs are the card's own, else the ones read out of the description (slmItemSpecs).
 */

const IBM_CHIPS = [['all', 'All'], ['stock', 'Stock'], ['catalog', 'Catalog'], ['photos', 'With photos'], ['tracked', 'Tracked'], ['bare', 'No details']];
const IBM_SORTS = [['name', 'Name'], ['stock', 'Most on hand'], ['recent', 'Recently moved']];
const IBM_KIND = { request: 'Purchase request', quotation: 'Quotation', order: 'Sales order', invoice: 'Invoice', po: 'Purchase order', receiving: 'Receiving',
                   'supplier price': 'Supplier price', dispatch: 'Dispatch', rental: 'Rental' };
const IBM_PARTS = [['sell', 'Sold & quoted'], ['buy', 'Bought'], ['move', 'Moves']];
const IBM_ORDER = { sell: ['invoice', 'order', 'quotation', 'request'], buy: ['receiving', 'po', 'supplier price'], move: ['dispatch', 'rental'] };

function _ibmShort(s, n) { return typeof slmShortItem === 'function' ? slmShortItem(s, n || 70) : String(s || '').slice(0, n || 70); }
function _ibmRaw(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

/** What the list and the card call an item. */
function ibmTitle(it) {
  it = it || {};
  return String(it.displayName || '').trim() || _ibmShort(it.name || it.description) || String(it.itemNo || it.itemId || 'Item');
}
/** The card's specs, else the ones a pasted spec sheet carries: [[label, value]]. */
function ibmSpecs(it) {
  if (it && Array.isArray(it.specs) && it.specs.length) return { specs: it.specs, fromCard: true };
  const t = typeof slmItemSpecs === 'function' ? slmItemSpecs(it && it.description) : { specs: [] };
  return { specs: (t && t.specs) || [], fromCard: false };
}
/** Is a real code worth showing (not N/A, TBA, none, a dash)? */
function ibmHasCode(no) { const s = _ibmRaw(no); return !!s && !/^(n\/?a|na|none|tba|-+)$/.test(s); }

function ibmChipOf(it) {
  const c = { all: 1 };
  if (it.type === 'Stock') c.stock = 1; else c.catalog = 1;
  if (it.photos > 0) c.photos = 1;
  if (it.tracked) c.tracked = 1;
  if (!it.details && !it.photos && !it.barcodes) c.bare = 1;
  return c;
}
function ibmCounts(items) {
  const n = {};
  (items || []).forEach(it => Object.keys(ibmChipOf(it)).forEach(k => { n[k] = (n[k] || 0) + 1; }));
  return n;
}
/** Search: every word must appear in the title, the full name, the code, the brand, model, type, id or a barcode. */
function ibmFilter(items, f) {
  f = f || {};
  const words = _ibmRaw(f.q).split(' ').filter(Boolean), chip = f.chip || 'all';
  const out = (items || []).filter(it => {
    if (chip !== 'all' && !ibmChipOf(it)[chip]) return false;
    if (!words.length) return true;
    const hay = _ibmRaw([ibmTitle(it), it.name, it.itemNo, it.brand, it.model, it.category, it.itemId].concat(it.codes || []).join(' '));
    return words.every(w => hay.indexOf(w) >= 0);
  });
  const sort = f.sort || 'name';
  out.sort((a, b) => sort === 'stock' ? (b.balance - a.balance) || ibmTitle(a).localeCompare(ibmTitle(b))
    : sort === 'recent' ? String(b.updated || '').localeCompare(String(a.updated || '')) || ibmTitle(a).localeCompare(ibmTitle(b))
    : ibmTitle(a).localeCompare(ibmTitle(b), undefined, { sensitivity: 'base' }));
  return out;
}
function ibmCountLine(shown, total) {
  return shown === total ? total + ' item' + (total === 1 ? '' : 's') : shown + ' of ' + total + ' items';
}
/** History lines grouped by kind, in reading order for the part. */
function ibmGroups(part, lines) {
  const by = {};
  (lines || []).forEach(l => { (by[l.kind] = by[l.kind] || []).push(l); });
  return (IBM_ORDER[part] || Object.keys(by)).filter(k => by[k] && by[k].length).map(k => ({ kind: k, label: IBM_KIND[k] || k, lines: by[k] }));
}
/** One line in words: what sold or was quoted, to whom, at what. Prices are the client's (cost roles see more). */
function ibmSellSay(lines) {
  const q = (lines || []).filter(l => l.kind === 'quotation'), inv = (lines || []).filter(l => l.kind === 'invoice' && l.status !== 'Voided');
  const clients = {};
  (lines || []).forEach(l => { if (l.party) clients[_ibmRaw(l.party)] = 1; });
  const bits = [];
  if (q.length) bits.push('quoted ' + q.length + ' time' + (q.length === 1 ? '' : 's'));
  if (inv.length) bits.push('invoiced ' + inv.length + ' time' + (inv.length === 1 ? '' : 's'));
  const n = Object.keys(clients).length;
  if (n) bits.push('to ' + n + ' client' + (n === 1 ? '' : 's'));
  return bits.length ? bits.join(', ').replace(/^./, c => c.toUpperCase()) + '.' : '';
}
function ibmLast(lines, kind) {
  return (lines || []).filter(l => l.kind === kind && l.price > 0 && l.status !== 'Voided').sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}
/** How a line was matched, in words, when it is worth saying. */
function ibmHowSay(l) {
  if (l && l.suspect) return 'Its line was marked as another item (' + l.suspect + '); its name says it is this one.';
  return '';
}
function ibmPeso(v) {
  const n = Number(v) || 0;
  return '₱' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function ibmMoney(v, cur) {
  const c = String(cur || 'PHP').toUpperCase();
  return c === 'PHP' ? ibmPeso(v) : c + ' ' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** The specs editor's rows from a form: drop empty rows, trim. */
function ibmSpecRows(rows) {
  return (rows || []).map(r => [String(r[0] || '').trim(), String(r[1] || '').trim()]).filter(r => r[0] || r[1]).slice(0, 40);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { IBM_CHIPS, IBM_SORTS, IBM_KIND, IBM_PARTS, ibmTitle, ibmSpecs, ibmHasCode, ibmChipOf, ibmCounts,
  ibmFilter, ibmCountLine, ibmGroups, ibmSellSay, ibmLast, ibmHowSay, ibmPeso, ibmMoney, ibmSpecRows };
