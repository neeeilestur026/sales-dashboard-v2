/* A316 — print our own QR labels (labels.html?items=ITM-00001:3,ITM-00007:1).
 *
 * The QR carries HXI:<Item ID> — the item's permanent internal identity, never its item number, which
 * is not unique. The scanner reads it as that item on any document and on any phone. Names come from
 * the inventory read; an id that is not in inventory is listed and skipped, not guessed. */
(function () {
  const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  const MAX_EACH = 200;
  let items = [];
  const $ = (id) => document.getElementById(id);
  const esc = (v) => hxEsc(v);

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
  function svg(text) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  function render() {
    const ok = items.filter(i => i.found);
    $('lbControls').innerHTML = items.length ? items.map((i, n) => `
      <div class="lb-row">
        <div><b>${esc(i.name || i.id)}</b><small>${i.found ? esc((i.itemNo || '') + ' · ' + i.id) : esc(i.id) + ' is not in inventory; skipped'}</small></div>
        ${i.found ? `<label>Labels <input type="number" min="0" max="${MAX_EACH}" value="${i.qty}" data-n="${n}" aria-label="How many labels"></label>` : '<span></span>'}
      </div>`).join('') : '<div class="hx-empty">No items were chosen. Open this page from the scanner or the inventory list.</div>';
    $('lbControls').querySelectorAll('input[data-n]').forEach(inp => inp.addEventListener('input', () => {
      items[parseInt(inp.dataset.n, 10)].qty = Math.min(MAX_EACH, Math.max(0, parseInt(inp.value || '0', 10) || 0));
      sheet();
    }));
    sheet();
    $('lbPrint').disabled = !ok.length;
  }
  function sheet() {
    const out = [];
    items.filter(i => i.found && i.qty > 0).forEach(i => {
      const code = svg('HXI:' + i.id);
      for (let k = 0; k < i.qty; k++) {
        out.push(`<div class="lb-label"><div class="lb-qr">${code}</div><div class="lb-text"><span class="lb-name">${esc(i.name)}</span>` +
                 `<span class="lb-no">${esc(i.itemNo || '')}</span><span class="lb-id">${esc(i.id)}</span></div></div>`);
      }
    });
    $('lbSheet').innerHTML = out.join('');
    $('lbPrint').disabled = !out.length;
  }
  async function load() {
    items = parse(location.search);
    if (!items.length) { render(); return; }
    try {
      await loadLib(QR_CDN);
      const res = await fetchFlow('getInventory', {});
      const byId = {};
      ((res && res.data) || []).forEach(r => { if (r.itemId) byId[String(r.itemId)] = r; });
      items.forEach(i => { const r = byId[i.id]; i.found = !!r; i.name = r ? String(r.description || '') : ''; i.itemNo = r ? String(r.itemNo || '') : ''; });
      render();
    } catch (e) { $('lbControls').innerHTML = `<div class="hx-empty">${esc(e.message || 'Could not load the items.')}</div>`; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const s = (typeof requireScanAccess === 'function') ? requireScanAccess() : null;
    if (!s) return;
    if (typeof renderNavbar === 'function') renderNavbar('scan');
    $('lbPrint').addEventListener('click', () => window.print());
    load();
  });
  window.__labels = { parse };   // tests
})();
