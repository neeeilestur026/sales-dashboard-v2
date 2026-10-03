/* A316 / A318 — the label library (labels.html).
 *
 *   labels.html                      every label code we have made, newest first
 *   labels.html?codes=HX…,HX…        those labels, selected (the scanner's "Print piece labels")
 *   labels.html?items=ITM-00001:3    make the item's label code if it has none (ensureItemLabels), then
 *                                    select it with 3 copies (the scanner's and Inventory's "Label")
 *
 * THE CODE MEANS NOTHING ON ITS OWN. The QR carries only the label's opaque code (HX + 12 characters,
 * made by the server). No item ID, no name, no web address: any other phone or scanner sees those
 * characters and nothing more. The scanner, signed in, turns it into details through secured reads.
 * The name printed beside the QR is for the people handling the box.
 *
 * Printing records how many were sent (logLabelPrint), so "Never printed" finds the new ones. */
(function () {
  const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  const MAX_EACH = 200;
  const CODE_RE = /^HX[0-9A-HJKMNP-TV-Z]{12}$/;
  const L = { rows: [], filter: 'all', q: '', sel: {}, copies: {}, only: null };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => hxEsc(v);

  /** ?items=ID:qty,ID — strict: junk dropped, repeats ignored, quantity 1..200. */
  function parse(q) {
    const raw = new URLSearchParams(q || '').get('items') || '';
    const seen = {};
    return raw.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.match(/^([A-Za-z0-9-]{3,40})(?::(\d{1,4}))?$/);
      if (!m || seen[m[1]]) return null;
      seen[m[1]] = 1;
      return { id: m[1], qty: Math.min(MAX_EACH, Math.max(1, parseInt(m[2] || '1', 10))) };
    }).filter(Boolean);
  }
  /** ?codes=HX…,HX… — only well-formed label codes, each once. */
  function parseCodes(q) {
    const raw = new URLSearchParams(q || '').get('codes') || '';
    const out = [];
    raw.split(',').map(s => s.trim().toUpperCase()).forEach(c => { if (CODE_RE.test(c) && out.indexOf(c) === -1) out.push(c); });
    return out.slice(0, 500);
  }
  /** The QR payload is the bare code and nothing else. */
  function qrPayload(row) { return row.code; }
  function svg(text) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }

  function shown() {
    const t = L.q.trim().toLowerCase();
    return L.rows.filter(r => {
      if (L.only && L.only.indexOf(r.code) === -1) return false;
      if (L.filter === 'waiting' && r.printed > 0) return false;
      if (L.filter === 'items' && r.kind !== 'ITEM') return false;
      if (L.filter === 'pieces' && r.kind !== 'PIECE') return false;
      return !t || (r.name + ' ' + r.itemNo + ' ' + r.assetNo + ' ' + r.code).toLowerCase().indexOf(t) !== -1;
    });
  }
  function render() {
    const list = shown();
    const nSel = Object.keys(L.sel).filter(c => L.sel[c]).length;
    $('lbMeta').textContent = list.length + ' shown' + (nSel ? ' · ' + nSel + ' selected' : '') + (L.only ? ' · from the scanner' : '');
    $('lbAll').checked = list.length > 0 && list.every(r => L.sel[r.code]);
    $('lbList').innerHTML = list.length ? list.slice(0, 300).map(r => `
      <div class="lb-row${L.sel[r.code] ? ' lb-row-on' : ''}" data-code="${esc(r.code)}">
        <label class="lb-pick"><input type="checkbox" data-pick="1" ${L.sel[r.code] ? 'checked' : ''} aria-label="Select ${esc(r.code)}"></label>
        <div class="lb-what">
          <b>${esc(r.kind === 'PIECE' ? r.assetNo : (r.name || r.itemId))}</b>
          <small>${r.kind === 'PIECE' ? esc(r.name) + (r.status ? ' · ' + esc(r.status) : '') : esc(r.itemNo || '')}</small>
          <small class="lb-code">${esc(r.code)} · ${r.printed ? 'printed ' + r.printed + '×' + (r.lastPrinted ? ', last ' + esc(r.lastPrinted.slice(0, 10)) : '') : 'never printed'}</small>
        </div>
        <label class="lb-copies">Copies <input type="number" min="1" max="${MAX_EACH}" value="${L.copies[r.code] || 1}" data-copies="1" aria-label="Copies of ${esc(r.code)}"></label>
      </div>`).join('') : `<div class="hx-empty">${L.rows.length ? 'Nothing matches.' : 'No labels yet. They are made when pieces are received or registered, or from an item\'s Label link.'}</div>`;
    $('lbList').querySelectorAll('[data-pick]').forEach(cb => cb.addEventListener('change', () => {
      L.sel[cb.closest('.lb-row').dataset.code] = cb.checked; render();
    }));
    $('lbList').querySelectorAll('[data-copies]').forEach(inp => inp.addEventListener('input', () => {
      L.copies[inp.closest('.lb-row').dataset.code] = Math.min(MAX_EACH, Math.max(1, parseInt(inp.value || '1', 10) || 1));
      sheet();
    }));
    sheet();
  }
  function picked() { return L.rows.filter(r => L.sel[r.code]); }
  function sheet() {
    const out = [];
    picked().forEach(r => {
      const code = svg(qrPayload(r)), n = L.copies[r.code] || 1;
      const title = r.kind === 'PIECE' ? r.assetNo : r.name;
      const sub = r.kind === 'PIECE' ? r.name : r.itemNo;
      for (let k = 0; k < n; k++) {
        out.push(`<div class="lb-label"><div class="lb-qr">${code}</div><div class="lb-text"><span class="lb-name">${esc(title || '')}</span>` +
                 `<span class="lb-no">${esc(sub || '')}</span><span class="lb-id">${esc(r.code)}</span></div></div>`);
      }
    });
    $('lbSheet').innerHTML = out.join('');
    $('lbPrint').disabled = !out.length;
    $('lbPrint').textContent = out.length ? 'Print ' + out.length + ' label' + (out.length === 1 ? '' : 's') : 'Print';
  }
  async function print() {
    const rows = picked();
    if (!rows.length) return;
    window.print();
    try {
      const res = await postFlow('logLabelPrint', { codes: JSON.stringify(rows.map(r => ({ code: r.code, count: L.copies[r.code] || 1 }))) });
      if (res && res.success) {
        rows.forEach(r => { r.printed += (L.copies[r.code] || 1); r.lastPrinted = (typeof flowToday === 'function') ? flowToday() : ''; });
        render();
      }
    } catch (e) { /* the labels printed; only the count is missing */ }
  }
  async function load() {
    const items = parse(location.search), codes = parseCodes(location.search);
    try {
      await loadLib(QR_CDN);
      let made = [];
      if (items.length) {
        const res = await postFlow('ensureItemLabels', { itemIds: JSON.stringify(items.map(i => i.id)) });
        if (!res || !res.success) throw new Error((res && res.message) || 'Could not make the item labels.');
        made = res.labels || [];
        made.forEach(m => { const i = items.filter(x => x.id === m.itemId)[0]; L.sel[m.code] = true; L.copies[m.code] = i ? i.qty : 1; });
      }
      codes.forEach(c => { L.sel[c] = true; });
      if (items.length || codes.length) L.only = codes.concat(made.map(m => m.code));
      const res = await postFlow('getLabels', {});
      if (!res || !res.success) throw new Error((res && res.message) || 'Could not load the labels.');
      L.rows = res.data || [];
      render();
    } catch (e) { $('lbList').innerHTML = `<div class="hx-empty">${esc(e.message || 'Could not load the labels.')}</div>`; $('lbMeta').textContent = ''; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const s = (typeof requireScanAccess === 'function') ? requireScanAccess() : null;
    if (!s) return;
    if (typeof renderNavbar === 'function') renderNavbar('scan');
    $('lbPrint').addEventListener('click', print);
    $('lbSearch').addEventListener('input', (e) => { L.q = e.target.value || ''; L.only = null; render(); });
    document.querySelectorAll('.lb-filter').forEach(b => b.addEventListener('click', () => {
      L.filter = b.dataset.filter; L.only = null;
      document.querySelectorAll('.lb-filter').forEach(x => x.classList.toggle('active', x === b));
      render();
    }));
    $('lbAll').addEventListener('change', (e) => { shown().forEach(r => { L.sel[r.code] = e.target.checked; }); render(); });
    load();
  });
  window.__labels = { parse, parseCodes, qrPayload, L, shown };   // tests
})();
