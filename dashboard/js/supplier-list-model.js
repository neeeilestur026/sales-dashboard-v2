/* supplier-list-model.js — A374 · what the supplier list works out (supplier-list.html, and the sourcing table's hint).
 *
 * Neil, 26 Oct 2026: a suppliers list for admin — several contact people, phones and emails, the address, local or
 * international, the distributorship we hold for them, how they usually deliver, the payment terms and the items we
 * usually order — and "after the admin dashboard priced, then this product will go to under this supplier with the
 * priced and last updated price date". The prices are FlowAPI's SupplierPrices rows, one per request line forwarded
 * to management; a supplier's last price for an item is its newest row for that item.
 *
 * PURE. Everything arrives as arguments; tests/flow/supplier-list.js runs it in node. Names are matched the way the
 * server matches them: the raw spelling first (_rawKey), then crCanonKey (js/client-rollup.js, the browser twin of
 * _canonKey). An item is known by its code, or by its name when it has none (_sbItemKey).
 */

/* The page shows the server's lists when it has them (getSupplierBook returns them); these are the same lists. */
const SL_TYPES = ['Local', 'International'];
const SL_DELIVERY = ['Pickup at their warehouse', 'Delivered to our warehouse', 'Other'];
const SL_TERMS = ['COD', 'Prepaid', '50% down', '7 days', '15 days', '30 days', '60 days'];

function _slS(v) { return String(v == null ? '' : v).trim(); }
function _slRaw(name) { return _slS(name).toLowerCase().replace(/\s+/g, ' '); }
function _slKey(name) { return typeof crCanonKey === 'function' ? crCanonKey(name) : _slRaw(name); }
function _slDay(v) { return typeof flowDate === 'function' ? flowDate(v) : _slS(v).slice(0, 10); }
const _SL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Oct 2026" (blank for nothing). */
function slDay(v) {
  const d = _slDay(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return Number(d.slice(8, 10)) + ' ' + _SL_MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4);
}
/** "26 Oct" this year, "26 Oct 2025" before. */
function slShortDay(v, today) { const d = slDay(v), y = _slS(today).slice(0, 4); return y && d.slice(-4) === y ? d.slice(0, -5) : d; }
/** A buy price in its own currency: "₱12.40", "USD 1,250.00", "EUR 0.125". */
function slMoney(currency, price) {
  const n = Number(price), c = _slS(currency).toUpperCase() || 'PHP';
  if (!isFinite(n)) return '';
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return c === 'PHP' ? '₱' + s : c + ' ' + s;
}
/** The town of an address: its last two parts. */
function slPlace(addr) { return _slS(addr).split(',').map(x => x.trim()).filter(Boolean).slice(-2).join(', '); }

/** Which item a price is for — the server's _sbItemKey: its code when it has one, else its name. */
function slItemKey(itemNo, itemName) {
  const code = _slS(itemNo).toLowerCase();
  if (!code || /^(n\/?a|none|tba|-+)$/.test(code)) return 'name:' + _slRaw(itemName);
  return 'code:' + code.replace(/^0+(?=.)/, '');
}
/** The supplier a typed name is, among `suppliers` ({supplierNo, supplier, aliases}): the raw spelling first, then the
 *  comparison key. '' when it is none of them (a forward then adds it, flagged as needing details). */
function slResolve(suppliers, name) {
  const raw = _slRaw(name), key = _slKey(name);
  if (!raw) return '';
  const list = suppliers || [];
  const names = (s) => [s.supplier].concat(s.aliases || []);
  const hit = list.find(s => names(s).some(n => _slRaw(n) === raw)) || (key ? list.find(s => names(s).some(n => _slKey(n) === key)) : null);
  return hit ? hit.supplierNo : '';
}
/** The last price a supplier gave for this item, from the lite read's `latest`, or null. */
function slLastPrice(latest, supplierNo, itemNo, itemName) {
  if (!supplierNo) return null;
  const k = slItemKey(itemNo, itemName);
  return (latest || []).find(x => x.supplierNo === supplierNo && x.itemKey === k) || null;
}

/** A supplier's priced items, newest first: each with its last price and its whole history. */
function slItems(prices, supplierNo) {
  const by = {};
  (prices || []).filter(p => p.supplierNo === supplierNo).forEach(p => { (by[p.itemKey] = by[p.itemKey] || []).push(p); });
  return Object.keys(by).map(k => {
    const h = by[k].slice().sort((a, b) => _slS(b.at).localeCompare(_slS(a.at)) || _slS(b.prNo).localeCompare(_slS(a.prNo)));
    return { itemKey: k, itemNo: h[0].itemNo, itemName: h[0].itemName, uom: h[0].uom, last: h[0], history: h, count: h.length };
  }).sort((a, b) => _slS(b.last.at).localeCompare(_slS(a.last.at)) || _slS(a.itemName).localeCompare(_slS(b.itemName)));
}
/** When a supplier last priced anything ('' for never). */
function slLastPriced(prices, supplierNo) {
  return (prices || []).reduce((m, p) => (p.supplierNo === supplierNo && _slS(p.at) > m ? _slS(p.at) : m), '');
}
function slPrimary(s) { const c = (s && s.contacts) || []; return c.find(x => x.primary) || c[0] || null; }
function slArchived(s) { return _slS(s && s.status) === 'Archived'; }

/** Another live supplier with this name, a spelling of it, or the same comparison key (the server refuses it). */
function slTwin(suppliers, name, exceptNo) {
  const raw = _slRaw(name), key = _slKey(name);
  if (!raw) return null;
  return (suppliers || []).find(s => !slArchived(s) && s.supplierNo !== exceptNo &&
    ([s.supplier].concat(s.aliases || []).some(n => _slRaw(n) === raw) || (key && _slKey(s.supplier) === key))) || null;
}

/** f = { q, type, distributor, delivery, needs, archived, sort ('name'|'priced'|'updated') } */
function slFilter(suppliers, prices, f) {
  const o = f || {}, q = _slS(o.q).toLowerCase(), qd = q.replace(/\D/g, '');
  const itemsOf = {};
  (prices || []).forEach(p => { (itemsOf[p.supplierNo] = itemsOf[p.supplierNo] || []).push(p.itemName, p.itemNo); });
  const rows = (suppliers || []).filter(s => {
    if (slArchived(s) !== !!o.archived) return false;
    if (o.type && s.type !== (o.type === 'none' ? '' : o.type)) return false;
    if (o.distributor && !s.distributor) return false;
    if (o.delivery && s.delivery !== o.delivery) return false;
    if (o.needs && !s.needsDetails) return false;
    if (!q) return true;
    const hay = [s.supplier, s.supplierNo, s.type, s.address, s.delivery, s.deliveryNote, s.terms, s.tin, s.notes].concat(s.aliases || [], s.brands || [], s.usualItems || [], itemsOf[s.supplierNo] || [])
      .concat((s.contacts || []).reduce((a, p) => a.concat([p.name, p.position, p.note]).concat(p.emails || []).concat(p.phones || []).concat((p.phones || []).map(x => String(x).replace(/\D/g, ''))), []))
      .join(' ').toLowerCase();
    return hay.indexOf(q) >= 0 || (qd.length >= 4 && hay.indexOf(qd) >= 0);
  });
  const sort = o.sort || 'name', last = {};
  rows.forEach(s => { last[s.supplierNo] = slLastPriced(prices, s.supplierNo); });
  rows.sort((a, b) => sort === 'priced' ? (last[b.supplierNo] || '').localeCompare(last[a.supplierNo] || '') || a.supplier.localeCompare(b.supplier)
    : sort === 'updated' ? _slS(b.updatedAt).localeCompare(_slS(a.updatedAt)) || a.supplier.localeCompare(b.supplier)
    : a.supplier.localeCompare(b.supplier));
  return rows;
}

/** The counts the chips show (archived suppliers left out of everything but their own). */
function slSummary(suppliers) {
  const live = (suppliers || []).filter(s => !slArchived(s));
  return { total: live.length, local: live.filter(s => s.type === 'Local').length, international: live.filter(s => s.type === 'International').length,
           noType: live.filter(s => !s.type).length, distributor: live.filter(s => s.distributor).length, needs: live.filter(s => s.needsDetails).length,
           archived: (suppliers || []).length - live.length };
}

/** The filtered list as CSV: one row per contact person (a supplier with none still has its row). */
function slCsv(rows, prices) {
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Supplier No', 'Supplier', 'Other spellings', 'Local or international', 'We distribute for them', 'Brands', 'Address', 'Delivery', 'Delivery note',
                'Payment terms', 'TIN', 'Usual items', 'Contact', 'Position', 'Main contact', 'Emails', 'Phones', 'Items priced', 'Last priced', 'Needs details'];
  const lines = [];
  (rows || []).forEach(s => {
    const items = slItems(prices, s.supplierNo).length, last = _slDay(slLastPriced(prices, s.supplierNo));
    const base = [s.supplierNo, s.supplier, (s.aliases || []).join('; '), s.type, s.distributor ? 'Yes' : 'No', (s.brands || []).join('; '), s.address, s.delivery, s.deliveryNote,
                  s.terms, s.tin, (s.usualItems || []).join('; ')];
    const tail = [items, last, s.needsDetails ? 'Yes' : ''];
    const people = (s.contacts || []).length ? s.contacts : [null];
    people.forEach(p => lines.push(base.concat(p ? [p.name, p.position, p.primary ? 'Yes' : '', (p.emails || []).join('; '), (p.phones || []).join('; ')] : ['', '', '', '', '']).concat(tail).map(q).join(',')));
  });
  return [head.join(',')].concat(lines).join('\n');
}

/** One history line in words. */
function slLogText(l) {
  const k = _slS(l && l.kind);
  return k === 'created' ? 'Added' : k === 'details' ? 'Details changed' : k === 'contacts' ? 'Contact people changed'
    : k === 'priced' ? 'Priced ' + (l.to || '') + ' item' + (l.to === '1' ? '' : 's') : k === 'merged' ? 'Merged'
    : k === 'archived' ? 'Archived' : k === 'restored' ? 'Restored' : k === 'imported' ? 'Filled from past requests' : k === 'file' ? 'From the supplier file' : k;
}
function slLogFor(log, supplierNo) { return (log || []).filter(l => l.supplierNo === supplierNo).sort((a, b) => _slS(b.at).localeCompare(_slS(a.at))); }
/** One line per email that is not one, for the form to say as it is typed. */
function slBadEmails(text) { return String(text == null ? '' : text).split(/[\n,;]+/).map(x => x.trim()).filter(x => x && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SL_TYPES, SL_DELIVERY, SL_TERMS, slDay, slShortDay, slMoney, slPlace, slItemKey, slResolve, slLastPrice, slItems, slLastPriced, slPrimary, slArchived,
                     slTwin, slFilter, slSummary, slCsv, slLogText, slLogFor, slBadEmails };
}
