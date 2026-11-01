/* item-picker.js — A387 · "Which stock item is this?" The one dialog every page opens when the server answers a post
 * with needsItem (a receiving, an invoice, a void, the scanner): nothing was saved, and each line listed could be more
 * than one item in stock. The person picks; the page sends again with each line's pick.
 *
 *   ipPick(needs, { what: 'receiving' | 'invoice' | 'invoice void', stock: [getInventory rows] }) → Promise
 *     resolves { [need.index]: itemId | 'new' | 'none' | 'skip' } when every line has a choice, or null when cancelled.
 *
 * Built to the apple-design skill: a sheet that rises from the bottom on a phone and leaves the same way, options that
 * are whole tappable rows with feedback on press, the main button waiting until every line has an answer, Escape and
 * the backdrop cancel, focus returns where it came from. Reduced motion: a cross-fade. Tokens only.
 */

function _ipE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _ipShort(s) { return typeof slmShortItem === 'function' ? slmShortItem(s, 90) : String(s || '').slice(0, 90); }
function _ipWhy(n, label) {
  if (n.how === 'ambiguous') return (n.candidates.length || 'Several') + ' items in stock fit this line' + (n.itemNo && n.itemNo !== 'N/A' ? ' (code ' + n.itemNo + ')' : '') + '.';
  if (n.suspectId) return 'The line was marked as ' + (label[n.suspectId] || n.suspectId) + ', but its name is different.';
  if (n.how === 'badpick') return 'That choice is not one of the items in stock. Pick again.';
  return 'No item in stock has exactly this name. These are close:';
}
const IP_EXTRA = { new: ['New item', 'Add it to inventory as a new item, named as on the line'], none: ['Not a stock item', 'No stock moves and it costs nothing (freight, a service, a charge)'],
                   skip: ['Put nothing back', 'This line took nothing out of stock'] };

function ipPick(needs, o) {
  o = o || {};
  needs = (needs || []).filter(Boolean);
  if (!needs.length || typeof document === 'undefined') return Promise.resolve(null);
  const back = document.activeElement, label = {};
  needs.forEach(n => (n.candidates || []).forEach(c => { label[c.itemId] = _ipShort(c.name) + (c.itemNo && c.itemNo !== 'N/A' ? ' (' + c.itemNo + ')' : ''); }));
  const opt = (n, value, title, sub, tag) => '<label class="ip-opt"><input type="radio" name="ip' + n.index + '" value="' + _ipE(value) + '">' +
    '<span class="ip-ot"><span class="ip-on">' + _ipE(title) + (tag ? ' <span class="ip-tag">' + _ipE(tag) + '</span>' : '') + '</span>' +
    (sub ? '<span class="ip-os">' + _ipE(sub) + '</span>' : '') + '</span></label>';
  // an item with no id yet (the oldest rows) is chosen by its row key: c.pick
  const cand = (n, c) => opt(n, c.pick || c.itemId, _ipShort(c.name), [c.itemNo && c.itemNo !== 'N/A' ? c.itemNo : 'No code', c.itemId,
    (Number(c.balance) || 0) + ' on hand', c.type].filter(Boolean).join(' · '), c.itemId && c.itemId === n.suspectId ? 'Marked on the line' : '');
  const block = (n) => '<fieldset class="ip-line" data-i="' + n.index + '"><legend class="ip-lh"><span class="ip-ln">Line ' + _ipE(n.line) + '</span>' +
    '<span class="ip-lname">' + _ipE(_ipShort(n.itemName) || n.itemNo || 'No name') + '</span>' + (n.qty ? '<span class="ip-lq">× ' + _ipE(n.qty) + '</span>' : '') + '</legend>' +
    '<p class="ip-why">' + _ipE(_ipWhy(n, label)) + '</p><div class="ip-opts" role="radiogroup">' +
    (n.candidates || []).map(c => cand(n, c)).join('') +
    (n.allow || []).map(a => IP_EXTRA[a] ? opt(n, a, IP_EXTRA[a][0], IP_EXTRA[a][1]) : '').join('') + '</div>' +
    (o.stock && o.stock.length ? '<label class="ip-find"><span class="ip-sr">Search all items for line ' + _ipE(n.line) + '</span>' +
      '<input type="search" class="ip-q" data-q="' + n.index + '" placeholder="Search all items: code or name" autocomplete="off"></label><div class="ip-found" data-found="' + n.index + '"></div>' : '') +
    '</fieldset>';
  const ov = document.createElement('div');
  ov.className = 'ip-overlay';
  ov.innerHTML = '<div class="ip-sheet" role="dialog" aria-modal="true" aria-labelledby="ipTitle">' +
    '<header class="ip-head"><h2 id="ipTitle">' + (needs.length === 1 ? 'Which stock item is this?' : 'Which stock items are these?') + '</h2>' +
    '<p class="ip-lede">Nothing on this ' + _ipE(o.what || 'document') + ' has been saved yet. ' + (needs.length === 1 ? 'This line' : 'Each line below') +
    ' could be more than one item in stock, so say which, and it is sent again.</p></header>' +
    '<div class="ip-body">' + needs.map(block).join('') + '</div>' +
    '<footer class="ip-foot"><span class="ip-count" aria-live="polite"></span><button type="button" class="btn btn-secondary" data-ip="cancel">Cancel</button>' +
    '<button type="button" class="btn btn-primary primary" data-ip="ok" disabled>Use these items</button></footer></div>';
  document.body.appendChild(ov);
  document.body.classList.add('ip-open');
  const okBtn = ov.querySelector('[data-ip="ok"]'), count = ov.querySelector('.ip-count');
  const chosen = () => { const out = {}; needs.forEach(n => { const r = ov.querySelector('input[name="ip' + n.index + '"]:checked'); if (r) out[n.index] = r.value; }); return out; };
  const sync = () => {
    const n = Object.keys(chosen()).length;
    okBtn.disabled = n < needs.length;
    count.textContent = needs.length > 1 ? n + ' of ' + needs.length + ' chosen' : '';
  };
  return new Promise(resolve => {
    const done = (v) => {
      ov.classList.remove('in');
      document.body.classList.remove('ip-open');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 220);
      if (back && back.focus) try { back.focus(); } catch (e) { /* the opener is gone */ }
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('change', sync);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) return done(null);
      const b = e.target.closest ? e.target.closest('[data-ip]') : null;
      if (!b) return;
      if (b.getAttribute('data-ip') === 'cancel') done(null);
      else if (!okBtn.disabled) done(chosen());
    });
    ov.addEventListener('input', (e) => {
      const q = e.target.getAttribute && e.target.getAttribute('data-q');
      if (q === null || q === undefined) return;
      const n = needs.find(x => String(x.index) === String(q)), box = ov.querySelector('[data-found="' + q + '"]');
      const shown = {}; (n.candidates || []).forEach(c => { shown[c.pick || c.itemId] = 1; });
      const key = (r) => typeof imRowKey === 'function' ? imRowKey(r) : r.itemId;
      const hits = typeof imSearch === 'function' ? imSearch(o.stock, e.target.value, 8).filter(r => key(r) && !shown[key(r)]) : [];
      const keep = ov.querySelector('input[name="ip' + n.index + '"]:checked');
      box.innerHTML = hits.length ? hits.map(r => cand(n, { itemId: r.itemId, pick: key(r), itemNo: r.itemNo, name: r.description, balance: r.balance, type: r.type })).join('')
        : (e.target.value.trim() ? '<p class="ip-none">No item matches “' + _ipE(e.target.value.trim()) + '”.</p>' : '');
      if (keep && !keep.isConnected) sync();
    });
    requestAnimationFrame(() => {
      ov.classList.add('in');
      const first = ov.querySelector('.ip-opt input');
      if (first) first.focus();
      sync();
    });
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ipPick };
