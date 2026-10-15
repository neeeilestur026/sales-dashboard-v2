/* A333 — the Product Finder page and its hand-off to the pricing request.
 *
 * What this file exists to hold down:
 *   • product-finder.html's real scripts load in order without throwing, and Find answers RC-108 on
 *     the page itself with C108C and its catalog page (the data read from dashboard/data as served);
 *   • pf-admin.html, which loads product-finder.js alone, still loads;
 *   • prLoadFromInquiry puts a Power Team model in Item No and keeps the finder's remark, while an
 *     older family pick (no model) still arrives as N/A with the old remark.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { page, D } = require('./pageload');

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x).slice(0, 300)); }
  else console.log('  ok  ', l); };

(async () => {
  console.log('== product-finder.html ==');
  const html = fs.readFileSync(D + 'product-finder.html', 'utf8');
  const scripts = (html.match(/<script src="(js\/[^"]+)"/g) || []).map(t => t.match(/src="([^"]+)"/)[1]);
  ok('the engine loads after product-finder.js and before the page UI',
     scripts.indexOf('js/product-finder.js') < scripts.indexOf('js/pf-engine.js') && scripts.indexOf('js/pf-engine.js') < scripts.indexOf('js/pf-catalog-ui.js'), scripts);
  ok('the page links css/product-finder.css right after styles.css and carries no <style>',
     /css\/styles\.css">\s*<link rel="stylesheet" href="css\/product-finder\.css">/.test(html) && !/<style/.test(html));
  const own = scripts.filter(s => !['js/theme.js', 'js/api.js', 'js/auth.js', 'js/flow-api.js'].includes(s));
  let p;
  try { p = page(own, 'product-finder.html', { role: 'sales', name: 'Test Sales', username: 'ts' }); ok('every page script loads without throwing', true); }
  catch (e) { ok('every page script loads without throwing', false, String(e && e.stack || e)); }
  if (p) {
    /* pageload's localStorage answers every key with the session; the finder reads per-device data
       overrides and lists from it, so this page gets a real key-value store holding only the session. */
    const store = { session: JSON.stringify({ role: 'sales', name: 'Test Sales', username: 'ts' }) };
    p.ctx.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    p.ctx.fetch = url => {
      const f = path.join(D, String(url).replace(/^\//, ''));
      return Promise.resolve(fs.existsSync(f) ? { ok: true, status: 200, json: () => Promise.resolve(JSON.parse(fs.readFileSync(f, 'utf8'))) } : { ok: false, status: 404 });
    };
    p.els.pfcQ.value = 'RC-108';
    await p.run('pfcFind()');
    const out = p.els.pfcFindOut.innerHTML;
    ok('Find answers RC-108 with C108C, Exact, on catalog p.12 (PDF 14)', /pfc-model">C108C</.test(out) && />Exact</.test(out) && /catalog p\.12 \(PDF 14\)/.test(out), out.slice(0, 400));
    ok('...and says what it read: the model as typed', /<b>model<\/b>RC-108/.test(out));
    p.els.pfcQ.value = 'zzqx unknown widget';
    await p.run('pfcFind()');
    eq('a line with no answer is logged for the engineer (the miss list)', JSON.parse(store.pf_misses || '[]').map(m => m.text), ['zzqx unknown widget']);
    p.els.pfcQ.value = '';
    await p.run('pfcFind()');
    ok('an empty search asks for text instead of searching', /Type or paste what the customer needs first/.test(p.els.pfcFindOut.innerHTML));
  }

  console.log('\n== pf-admin.html (loads product-finder.js alone) ==');
  try { page(['js/product-finder.js', 'js/pf-admin-inline.js'], 'pf-admin.html', { role: 'admin', name: 'Test Admin', username: 'ta' }); ok('pf-admin.html loads', true); }
  catch (e) { ok('pf-admin.html loads', false, String(e && e.stack || e)); }

  console.log('\n== prLoadFromInquiry ==');
  const src = fs.readFileSync(D + 'js/flow-pricing-request.js', 'utf8');
  const start = src.indexOf('async function prLoadFromInquiry(');
  let depth = 0, end = start;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const rows = [];
  const el = { innerHTML: '', value: '' };
  const ctx = { rows, document: { getElementById: () => el }, window: { scrollTo() {} },
    prIsRequester: true, prRole: 'sales', prSession: { name: 'T' }, prFromInquiry: null,
    addRow: r => rows.push(r), countLines() {}, prFillContacts() {}, prInquiryBanner() {},
    flowEsc: s => String(s), flowNum: v => Number(v) || 0, fetchFlow: () => Promise.resolve({ data: [] }) };
  ctx.prLocalInquiry = id => (id === 'INQ-1' ? { id, client: 'Philcement Corporation', items: [
    { model: 'C108C', name: 'Power Team C108C — 10 t single-acting cylinder, 8.13 in stroke', qty: 2, remarks: 'Product Finder: Power Team C108C, catalog p.12' },
    { id: 'pt-c-10', name: 'C Series Cylinder 10 ton', qty: 1 }] } : null);
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end), ctx);
  await vm.runInContext('prLoadFromInquiry("INQ-1")', ctx);
  eq('a model goes into Item No with the finder\'s remark', rows[0] && [rows[0].itemNo, rows[0].qty, rows[0].remarks],
     ['C108C', 2, 'Product Finder: Power Team C108C, catalog p.12']);
  eq('an older family pick still arrives as N/A with the old remark', rows[1] && [rows[1].itemNo, rows[1].remarks], ['N/A', 'From Product Finder — confirm exact model']);

  console.log(fail ? `\n${fail} FAILED` : '\nall good');
  process.exit(fail ? 1 : 0);
})();
