/* A333 — the committed Power Team data the Product Finder reads.
 *
 * What this file exists to hold down:
 *   • every C-series row on catalog PDF 14 (printed p.12) is in pt_catalog.json with the numbers
 *     printed there — typed by hand from the page, not copied from the importer's output;
 *   • the catalog is whole: counts per category, one record per model, a page on every record,
 *     family links and crossover links that point at things that exist;
 *   • no price anywhere — /data/*.json is served without a login, and Neil decided the price list
 *     stays out of the finder;
 *   • the official 2025 crossover answers the five lines A333 was asked about.
 */
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', '..', 'dashboard', 'data');
const read = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

let fail = 0;
const eq = (l, g, w) => { const o = JSON.stringify(g) === JSON.stringify(w);
  if (!o) { fail++; console.log('  FAIL', l, '\n     got ', JSON.stringify(g), '\n     want', JSON.stringify(w)); }
  else console.log('  ok  ', l); };
const ok = (l, cond, x) => { if (!cond) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
  else console.log('  ok  ', l); };

const cat = read('pt_catalog.json');
const xr = read('pt_crossover.json');
const idx = read('pt_index.json');
const M = {};
cat.models.forEach(r => { M[r.m] = r; });

console.log('== PDF 14: the C series as printed ==');
{
  // model: [cap, stroke, oil, closed, extended, tons@10k, weight]
  const P14 = {
    C51C: [5, 1.00, 1.10, 4.34, 5.44, 4.97, 2.25],     C53C: [5, 3.25, 3.20, 6.50, 9.75, 4.97, 3.26],
    C55C: [5, 5.25, 5.20, 8.50, 13.75, 4.97, 4.00],    C57C: [5, 7.25, 7.20, 10.75, 18.00, 4.97, 5.00],
    C59C: [5, 9.25, 9.20, 12.75, 22.00, 4.97, 5.80],
    C101C: [10, 1.00, 2.20, 3.63, 4.63, 11.20, 4.00],  C102C: [10, 2.13, 4.80, 4.75, 6.88, 11.20, 5.00],
    C104C: [10, 4.13, 9.20, 6.75, 10.88, 11.20, 6.70], C106C: [10, 6.13, 13.70, 9.75, 15.88, 11.20, 9.40],
    C108C: [10, 8.13, 19.90, 11.75, 19.88, 11.20, 11.00], C1010C: [10, 10.13, 22.60, 13.75, 23.88, 11.20, 13.00],
    C1012C: [10, 12.13, 27.10, 15.75, 27.88, 11.20, 14.60], C1014C: [10, 14.13, 31.60, 17.75, 31.88, 11.20, 16.20],
    C1016C: [10, 16.00, 36.10, 20.50, 36.50, 11.20, 18.50],
    C151C: [15, 1.00, 3.10, 4.88, 5.88, 15.70, 7.50],  C152C: [15, 2.13, 6.70, 5.88, 8.00, 15.70, 8.90],
    C154C: [15, 4.13, 12.90, 7.88, 12.00, 15.70, 11.50], C156C: [15, 6.13, 19.20, 10.69, 16.81, 15.70, 15.30],
    C158C: [15, 8.13, 25.50, 12.69, 20.81, 15.70, 17.90], C1510C: [15, 10.13, 31.80, 14.69, 24.81, 15.70, 20.70],
    C1512C: [15, 12.13, 38.10, 16.69, 28.81, 15.70, 23.20], C1514C: [15, 14.13, 44.40, 18.69, 32.81, 15.70, 26.00],
    C1516C: [15, 16.00, 50.30, 20.56, 36.56, 15.70, 28.20],
    C251C: [25, 1.00, 5.10, 5.50, 6.50, 25.80, 11.90], C252C: [25, 2.00, 10.30, 6.50, 8.50, 25.80, 13.90],
    C254C: [25, 4.00, 20.60, 8.50, 12.50, 25.80, 17.60], C256C: [25, 6.25, 32.20, 10.75, 17.00, 25.80, 21.70],
    C258C: [25, 8.25, 42.50, 12.75, 21.00, 25.80, 25.60], C2510C: [25, 10.25, 52.80, 14.75, 25.00, 25.80, 29.30],
    C2512C: [25, 12.25, 63.20, 16.75, 29.00, 25.80, 33.10], C2514C: [25, 14.25, 73.50, 18.75, 33.00, 25.80, 36.80],
    C308C: [30, 8.25, 53.55, 12.80, 21.05, 32.50, 36.5],
    C552C: [55, 2.00, 22.10, 6.88, 8.88, 55.20, 32.50], C554C: [55, 4.25, 46.90, 9.13, 13.38, 55.20, 41.30],
    C556C: [55, 6.25, 69.00, 11.13, 17.38, 55.20, 51.00], C5510C: [55, 10.25, 113.20, 15.13, 25.38, 55.20, 67.00],
    C5513C: [55, 13.25, 146.30, 18.13, 31.38, 55.20, 78.00],
    C756C: [75, 6.13, 97.40, 12.38, 18.50, 79.50, 73.50], C7513C: [75, 13.13, 208.70, 19.38, 32.50, 79.50, 109.50],
    C1002C: [100, 2.00, 41.20, 8.63, 10.63, 103.10, 63.00], C1006C: [100, 6.63, 137.00, 13.25, 19.88, 103.10, 91.00],
    C10010C: [100, 10.25, 211.50, 16.88, 27.13, 103.10, 113.00],
  };
  const keys = ['cap', 'stroke', 'oil', 'closed', 'ext', 't10k', 'wt'];
  Object.keys(P14).forEach(m => {
    const r = M[m] || {};
    eq(m + ' as printed on p.12', keys.map(k => r[k]), P14[m]);
  });
  eq('every one is single-acting, spring return, steel, from PDF 14 / p.12',
     Object.keys(P14).filter(m => !(M[m] && M[m].act === 'SA' && M[m].ret === 'spring' && M[m].body === 'steel' && M[m].pdf === 14 && M[m].pg === 12)), []);
  eq('and nothing else on the page is called C-series', cat.models.filter(r => r.ser === 'C' && r.pdf === 14).length, Object.keys(P14).length);
}

console.log('\n== the catalog is whole ==');
{
  const count = {};
  cat.models.forEach(r => { count[r.cat] = (count[r.cat] || 0) + 1; });
  const sorted = o => Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {});
  eq('models per category', sorted(count), { coupler: 15, cylinder: 423, fitting: 26, gauge: 15, hose: 40, jack: 42, 'jack-accessory': 1,
     manifold: 12, press: 48, puller: 122, pump: 188, set: 30, shop: 1, tool: 66, 'torque-wrench': 14, valve: 54 });
  eq('one record per model', cat.models.length, new Set(cat.models.map(r => r.m)).size);
  const noPage = cat.models.filter(r => !r.pdf || !r.pg).map(r => r.m);
  ok('a PDF page on every record and a printed page on 95%+ (' + noPage.length + ' without)',
     cat.models.every(r => r.pdf) && noPage.length <= cat.models.length * 0.05, noPage.slice(0, 10));
  eq('every cylinder has capacity, stroke, oil and a series', cat.models.filter(r => r.cat === 'cylinder' && !(r.cap && r.stroke && r.oil && r.ser)).map(r => r.m), []);
  eq('every series named by a cylinder is described', cat.models.filter(r => r.cat === 'cylinder' && !cat.series[r.ser]).map(r => r.m), []);
  eq('hand pumps carry both stages and usable oil (P55/P12 are one-speed)',
     cat.models.filter(r => r.cat === 'pump' && r.pow === 'manual' && !(r.usable && r.maxPsi && r.hpVol && (r.speed === 1 || r.lpVol))).map(r => r.m), []);
  const fams = new Set(read('products.json').products.map(p => p.id));
  eq('every family link exists in products.json', cat.models.filter(r => r.fam && !fams.has(r.fam)).map(r => r.m), []);
  eq('C108C belongs to pt-c-10 and P157 to pt-p157', [M.C108C.fam, M.P157.fam], ['pt-c-10', 'pt-p157']);
  /* Kit tables (IM10, SK10T) also list loose order numbers — saddles, bases, extensions — that have no
     row of their own; a lettered part must exist somewhere in the book. */
  const inBook = p => M[p] || idx.rows.some(x => x[0] === p);
  eq('a set names only parts that exist', cat.models.filter(r => r.parts && r.parts.some(p => !/^\d{4,7}$/.test(p) && !inBook(p))).map(r => r.m), []);
  eq('RPS154 is C154C + P55 + 9756 + 9798 (p.52)', M.RPS154.parts, ['C154C', 'P55', '9756', '9798']);
  eq('the units say the tons are US short tons', /short ton/.test(cat._units.tons) && /0\.907/.test(cat._units.tons), true);
  ok('the index covers every structured model', cat.models.every(r => idx.rows.some(x => x[0] === r.m) || r.cat === 'cylinder'),
     cat.models.filter(r => r.cat !== 'cylinder' && !idx.rows.some(x => x[0] === r.m)).map(r => r.m).slice(0, 10));
}

console.log('\n== no prices, small enough ==');
{
  const priceKey = /price|cost|usd|php|list|net|amount/i;
  const keysOf = o => (o && typeof o === 'object') ? Object.keys(o).concat(...Object.values(o).map(keysOf)) : [];
  ['pt_catalog.json', 'pt_index.json', 'pt_crossover.json'].forEach(f => {
    const raw = fs.readFileSync(path.join(DATA, f), 'utf8');
    eq(f + ': no price-like field', keysOf(JSON.parse(raw)).filter(k => priceKey.test(k) && !/^_?(notInCatalog)$/.test(k)), []);
    eq(f + ': no currency amount in the text', (raw.match(/\$\s?\d|\b(?:USD|PHP)\s\d|₱/g) || []), []);
  });
  const kb = f => fs.statSync(path.join(DATA, f)).size / 1024;
  ok('pt_catalog.json under 260 KB (' + kb('pt_catalog.json').toFixed(0) + ')', kb('pt_catalog.json') < 260);
  ok('pt_index.json under 360 KB (' + kb('pt_index.json').toFixed(0) + ')', kb('pt_index.json') < 360);
  ok('pt_crossover.json under 90 KB (' + kb('pt_crossover.json').toFixed(0) + ')', kb('pt_crossover.json') < 90);
}

console.log('\n== the official crossover ==');
{
  const X = {};
  xr.rows.forEach(r => { (X[r[0]] = X[r[0]] || []).push(r); });
  const first = e => X[e] && X[e][0][1][0][0];
  eq('the five A333 lines: RC108, RC154, RC156, RC254, P80',
     ['RC108', 'RC154', 'RC156', 'RC254', 'P80'].map(first), ['C108C', 'C154C', 'C156C', 'C254C', 'P159']);
  eq('each of those is in the catalog', ['C108C', 'C154C', 'C156C', 'C254C', 'P159'].filter(m => !M[m]), []);
  const cr = read('cross_reference.json').rows;
  eq('the 13 older cross_reference rows agree with the official table', cr.filter(r => r.our_model !== first(r.competitor_model)).map(r => r.competitor_model), []);
  eq('...and name catalog models', cr.filter(r => !M[r.our_model]).map(r => r.competitor_model), []);
  const lettered = xr.rows.filter(r => !/^\d+$/.test(r[1][0][0]) && /^[A-Z]/.test(r[1][0][0]));
  const missing = lettered.filter(r => !M[r[1][0][0]] && !idx.rows.some(x => x[0] === r[1][0][0]));
  ok('most lettered Power Team numbers in the crossover are in this catalog (' + missing.length + ' of ' + lettered.length + ' are not)',
     missing.length <= lettered.length * 0.12, missing.map(r => r[1][0][0]).slice(0, 20));
  eq('match letters are E, S or blank', [...new Set(xr.rows.map(r => r[5]))].sort(), ['', 'E', 'S']);
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
