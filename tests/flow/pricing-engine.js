/* A340 — the pricing engine's rules (dashboard/js/pe-engine.js).
 *
 * Run:  node tests/flow/pricing-engine.js
 *
 * The eight cases of the build spec, held to the numbers its WRITTEN rules give (Neil, 17 Oct 2026:
 * "follow the rules exactly"). Two of the spec's examples were approximate and differ, on purpose:
 *   • the SGD 180 CEJN hose comes to ₱60,000, not "≈ ₱51k": its floor at 40% falls under ₱50k and at
 *     45% + ₱3,000 handling rises over it, so the higher margin is used;
 *   • the ₱2.22M genset comes to ₱4,057,000, not "≈ ₱3.9M": floor ₱3,687,302 + 10%, rounded up.
 * Plus the edges: forex buffer, incoterms, weight-based freight with an HS duty, class D, service lines,
 * public-price floors, cash exposure, validity, approvals, determinism and the sum checks.
 */
const PE = require('../../dashboard/js/pe-engine.js');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.01 : tol);
const section = (t) => console.log('\n== ' + t + ' ==');

const TODAY = '2026-10-17';
function tables(over) {
  const t = JSON.parse(JSON.stringify(PE.PE_DEFAULT_TABLES));
  t.version = 1;
  t.forex.USD = { rate: 58.5, asOf: '2026-10-12' };
  t.forex.SGD = { rate: 43.5, asOf: '2026-10-12' };
  return Object.assign(t, over || {});
}
const T = tables();
const line = (o) => Object.assign(PE.peBlankLine(), o);
const quote = (o) => Object.assign(PE.peBlankQuote(), { supplierTerms: '30 days' }, o);
const has = (r, code) => r.flags.some(f => f.code === code);
const sum = (a) => a.reduce((s, x) => s + x, 0);

section('1 · local hand tool');
{
  const q = quote({ destination: 'Zambales / Pampanga / Bataan', lines: [line({ description: 'Hand tool', itemType: 'trading', principal: 'Local', currency: 'PHP',
    supplierPrice: 4800, origin: 'Local', incoterm: 'EXW', freightClass: 'L', cbm: 0.25 })] });
  const r = PE.peQuote(q, T, { today: TODAY }), l = r.lines[0];
  ok('freight is 5% pickup = ₱240', near(l.freightDuty, 240));
  ok('delivery is max(0.25 × 2,700, 500) = ₱675', near(r.totals.delivery, 675) && near(l.deliveryShare, 675));
  ok('COGS before handling (4,800 + 240 + 675) × 1.01 = ₱5,772.15', near(l.baseLine, 5772.15));
  ok('net sale under ₱50k → 45% and ₱3,000 handling in COGS', r.band.margin === 0.45 && r.band.handling === 3000 && near(r.totals.cogs, 8772.15));
  ok('floor = 8,772.15 ÷ 0.48 = ₱18,275.31 (spec ≈ 18,300)', near(l.floorLine, 18275.31));
  ok('recommended = floor + 10% rounded up to ₱500 = ₱20,500', l.recommendedUnit === 20500);
  ok('decline_or_bundle is NOT raised (net sale over ₱15k)', !has(r, 'decline_or_bundle'));
  ok('the explanation shows the handling', r.explanation.some(s => /₱3,000\.00 handling added to COGS/.test(s)));
}

section('2 · public-price item');
{
  const q = quote({ lines: [line({ description: 'Makita blower', itemType: 'public_price', principal: 'Local', currency: 'PHP', supplierPrice: 43600,
    streetPrice: 46000, origin: 'Local', incoterm: 'EXW', freightClass: 'L' })] });
  const r = PE.peQuote(q, T, { today: TODAY }), l = r.lines[0];
  ok('recommended = min(cost-plus, 46,000 × 0.97) = ₱44,620', l.recommendedUnit === 44620, l.recommendedUnit);
  ok('its floor is the street price less 5% (₱43,700), so it is not below floor', near(l.floorUnit, 43700) && !has(r, 'below_floor'));
  ok('margin under 20% → decline_or_bundle', has(r, 'decline_or_bundle') && l.marginAchieved < 0.20);
  ok('decline_or_bundle needs the director', r.approval.needed && r.approval.approver === 'director');
}

section('3 · small import (CEJN hose, SGD 180)');
{
  const base = { description: 'CEJN hose', itemType: 'line', principal: 'CEJN', currency: 'SGD', supplierPrice: 180, origin: 'International', incoterm: 'EXW', freightClass: 'A' };
  const q = quote({ lines: [line(base)] });
  const r = PE.peQuote(q, T, { today: TODAY }), l = r.lines[0];
  ok('goods = 180 × 43.5 × 1.03 = ₱8,064.90', near(l.goodsUnit, 8064.9));
  ok('allowance 60% (purchase under ₱50k, not consolidated) = ₱4,838.94', l.allowance === 0.60 && near(l.freightDuty, 4838.94));
  ok('the whole ₱10,000 shipment fixed cost sits on the one line', near(l.fixedShare, 10000));
  ok('COGS before handling = ₱23,132.88', near(l.baseLine, 23132.88));
  ok('the band gap takes the higher margin: 45% + handling, floor ₱54,443.50', r.band.margin === 0.45 && near(l.floorLine, 54443.5) && /higher margin/.test(r.band.note));
  ok('recommended ₱60,000 (spec said ≈ ₱51k: see the header)', l.recommendedUnit === 60000, l.recommendedUnit);
  const t = PE.peTiers(q, T, { today: TODAY }, 0);
  ok('tiers: 10 pieces cost far less each than 1 (₱' + t[10] + ' vs ₱' + t[1] + ')', t && t[1] === 60000 && t[10] < t[1] * 0.5 && t[5] > t[10]);
  const rc = PE.peQuote(quote({ lines: [line(Object.assign({}, base, { consolidated: true }))] }), T, { today: TODAY });
  ok('consolidated drops the allowance to 30%', rc.lines[0].allowance === 0.30 && rc.lines[0].recommendedUnit < l.recommendedUnit);
}

section('4 · big import (Power Team, USD 25,000, consolidated)');
{
  const q = quote({ lines: [line({ description: 'Power Team order', itemType: 'line', principal: 'Power Team', currency: 'USD', supplierPrice: 25000,
    origin: 'International', incoterm: 'FOB', freightClass: 'C', shipMode: 'air', consolidated: true })] });
  const r = PE.peQuote(q, T, { today: TODAY }), l = r.lines[0];
  ok('goods = 25,000 × 58.5 × 1.03 = ₱1,506,375', near(l.goodsUnit, 1506375));
  ok('consolidated allowance over ₱1M = 18%', l.allowance === 0.18);
  ok('net sale over ₱2M → the 30% band', r.band.margin === 0.30 && r.totals.netSale > 2000000);
  ok('over ₱2M needs the president', r.approval.approver === 'president' && has(r, 'over_limit'));
  ok('allowance on a purchase over ₱200k → estimated_freight', has(r, 'estimated_freight'));
}

section('5 · genset (class D, tender)');
{
  const q = quote({ isTender: true, jobCostsPhp: 80000, lines: [line({ description: 'Genset', itemType: 'trading', principal: 'Local', currency: 'PHP',
    supplierPrice: 2220000, origin: 'Local', incoterm: 'Local-delivered', freightClass: 'D' })] });
  const r = PE.peQuote(q, T, { today: TODAY }), l = r.lines[0];
  ok('no allowance or freight (delivered by the supplier)', l.method === 'delivered' && l.freightDuty === 0 && !has(r, 'missing_forwarder_quote'));
  ok('COGS = (2,220,000 + 80,000 job) × 1.01 = ₱2,323,000', near(r.totals.cogs, 2323000));
  ok('tender → 30%: floor ₱3,687,301.59 (spec ≈ ₱3.69M)', r.band.margin === 0.30 && near(l.floorLine, 3687301.59));
  ok('recommended ₱4,057,000 (spec said ≈ ₱3.9M: see the header)', l.recommendedUnit === 4057000, l.recommendedUnit);
  ok('tender needs the president', has(r, 'tender') && r.approval.approver === 'president');
  ok('not ready without the president\'s approval; ready with it', !r.ready && PE.peQuote(q, T, { today: TODAY, approvedBy: 'president' }).ready
     && !PE.peQuote(q, T, { today: TODAY, approvedBy: 'director' }).ready);
}

section('6 · forex stale');
{
  const t = tables(); t.forex.USD = { rate: 58.5, asOf: '2026-09-07' };
  const q = quote({ lines: [line({ description: 'Wrench', principal: 'Snap-on', currency: 'USD', supplierPrice: 300, origin: 'International', freightClass: 'A' })] });
  const r = PE.peQuote(q, t, { today: TODAY });
  ok('a USD rate 40 days old → forex_stale, blocking', has(r, 'forex_stale') && r.flags.find(f => f.code === 'forex_stale').blocking);
  ok('so the quote is not ready, even approved', !r.ready && !PE.peQuote(q, t, { today: TODAY, approvedBy: 'president' }).ready);
  const t2 = tables(); t2.forex.EUR = { rate: null, asOf: '' };
  ok('a currency with no rate → missing_forex, blocking', has(PE.peQuote(quote({ lines: [line({ description: 'x', currency: 'EUR', supplierPrice: 10, origin: 'International' })] }), t2, { today: TODAY }), 'missing_forex'));
}

section('7 · below floor');
{
  const base = quote({ lines: [line({ description: 'RAD wrench', itemType: 'line', principal: 'RAD', currency: 'USD', supplierPrice: 4200, origin: 'International', freightClass: 'C' })] });
  const r0 = PE.peQuote(base, T, { today: TODAY }), floor = r0.lines[0].floorUnit;
  const q = JSON.parse(JSON.stringify(base)); q.lines[0].priceOverride = Math.round(floor * 0.95 * 100) / 100;
  const r = PE.peQuote(q, T, { today: TODAY }), l = r.lines[0];
  ok('a price 5% under the floor → below_floor', has(r, 'below_floor') && l.overridden);
  ok('an authorized-line item below floor needs the president', r.approval.needed && r.approval.approver === 'president');
  ok('net to the company is recalculated from the typed price', near(r.totals.netToCompany, l.netLine - l.cogsLine - 0.07 * l.netLine));
  ok('the recommended price is still shown', l.recommendedUnit === r0.lines[0].recommendedUnit);
  const t = JSON.parse(JSON.stringify(q)); t.lines[0].itemType = 'trading';
  ok('a trading item below floor (under ₱2M) needs only the director', PE.peQuote(t, T, { today: TODAY }).approval.approver === 'director');
}

section('8 · sum checks, on a mixed quotation');
{
  const q = quote({ destination: 'Batangas', jobCostsPhp: 12000, supplierTerms: '50-50', clientDownpayment: 20000, lines: [
    line({ description: 'CEJN coupling', principal: 'CEJN', currency: 'SGD', supplierPrice: 95, qty: 6, cbm: 0.01 }),
    line({ description: 'CEJN hose', principal: 'CEJN', currency: 'SGD', supplierPrice: 180, qty: 2, cbm: 0.02 }),
    line({ description: 'Snap-on set', principal: 'Snap-on', currency: 'USD', supplierPrice: 640, qty: 1, cbm: 0.05 }),
    line({ description: 'Gauge', itemType: 'trading', principal: 'Local', currency: 'PHP', supplierPrice: 3500, qty: 3, origin: 'Local', freightClass: 'L', cbm: 0.004 }),
    line({ description: 'Calibration', itemType: 'service', principal: 'Local', currency: 'PHP', supplierPrice: 8000, qty: 1, origin: 'Local', incoterm: 'Local-delivered', freightClass: 'L', cbm: 0.001 }),
    line({ description: 'Pump in stock', itemType: 'trading', principal: 'Other', inStock: true, landedUnitCost: 15400, qty: 1, cbm: 0.08 })] });
  const r = PE.peQuote(q, T, { today: TODAY });
  ok('Σ line COGS = quotation COGS to the peso', near(sum(r.lines.map(l => l.cogsLine)), r.totals.cogs, 0.5));
  ok('Σ line price = quotation net sale', near(sum(r.lines.map(l => l.netLine)), r.totals.netSale, 0.5));
  ok('the delivery is spread by CBM and adds up', near(sum(r.lines.map(l => l.deliveryShare)), r.totals.delivery) && near(r.totals.delivery, Math.max(0.243 * 2300, 400), 0.01));   // 0.06 + 0.04 + 0.05 + 0.012 + 0.001 + 0.08 CBM
  ok('job costs add up', near(sum(r.lines.map(l => l.jobShare)), 12000));
  ok('the two CEJN lines share one shipment fixed cost; Snap-on has its own', near(r.lines[0].fixedShare + r.lines[1].fixedShare, 10000) && near(r.lines[2].fixedShare, 10000));
  ok('the CEJN allowance uses the shipment\'s whole purchase, not each line', r.lines[0].allowance === r.lines[1].allowance);
  ok('the in-stock pump adds no freight or fixed cost', r.lines[5].freightDuty === 0 && r.lines[5].fixedShare === 0);
  ok('the service line is floored at 50%', r.lines[4].margin === 0.50);
  ok('a 50-50 deposit over the ₱20,000 downpayment → cash_exposure with the gap', has(r, 'cash_exposure') && r.flags.find(f => f.code === 'cash_exposure').gap > 0);
  ok('VAT is 12% and the total adds up', near(r.totals.vat, r.totals.netSale * 0.12) && near(r.totals.gross, r.totals.netSale * 1.12));
  ok('the same inputs give the same result', JSON.stringify(PE.peQuote(q, T, { today: TODAY })) === JSON.stringify(r));
}

section('the other rules');
{
  ok('clean rounding: ₱10 / ₱50 / ₱500 / ₱1,000', PE.peRoundUp(991) === 1000 && PE.peRoundUp(984.2) === 990 && PE.peRoundUp(1001) === 1050
     && PE.peRoundUp(10001) === 10500 && PE.peRoundUp(100001) === 101000 && PE.peRoundUp(20000) === 20000);
  const usd = (terms) => PE.peQuote(quote({ supplierTerms: terms, lines: [line({ description: 'x', principal: 'RAD', currency: 'USD', supplierPrice: 100 })] }), T, { today: TODAY }).lines[0];
  ok('forex buffer 3%, or 5% on terms longer than 30 days', near(usd('30 days').goodsUnit, 100 * 58.5 * 1.03) && near(usd('60 days').goodsUnit, 100 * 58.5 * 1.05));
  const d = PE.peQuote(quote({ lines: [line({ description: 'outsize', principal: 'Other', currency: 'USD', supplierPrice: 5000, freightClass: 'D' })] }), T, { today: TODAY });
  ok('class D import with no forwarder quote → missing_forwarder_quote, blocking', has(d, 'missing_forwarder_quote') && !d.ready);
  const d2 = PE.peQuote(quote({ lines: [line({ description: 'outsize', principal: 'Other', currency: 'USD', supplierPrice: 5000, freightClass: 'D', freightPhp: 45000, hsDutyRate: 10 })] }), T, { today: TODAY }).lines[0];
  const g = 5000 * 58.5 * 1.03, duty = 0.10 * (g + 45000), ivat = 0.12 * (g + 45000 + duty);
  ok('class D with a forwarder quote and HS 10%: freight + duty + import VAT', near(d2.freightDuty, 45000 + duty + ivat) && d2.method === 'forwarder');
  const ddp = PE.peQuote(quote({ lines: [line({ description: 'ddp', currency: 'USD', supplierPrice: 1000, incoterm: 'DDP' })] }), T, { today: TODAY }).lines[0];
  ok('DDP: no freight, duty or fixed cost', ddp.freightDuty === 0 && ddp.fixedShare === 0);
  const cif = PE.peQuote(quote({ lines: [line({ description: 'cif', currency: 'USD', supplierPrice: 1000, incoterm: 'CIF' })] }), T, { today: TODAY }).lines[0];
  ok('CIF: no freight, the 14% duty-and-VAT part, plus the fixed cost', near(cif.freightDuty, 0.14 * cif.goodsLine) && near(cif.fixedShare, 10000));
  const t = tables({ freightRates: { courierPerKg: 450, airPerKg: 320, seaPerCbm: 4000 } });
  const w = PE.peQuote(quote({ lines: [line({ description: 'w', currency: 'SGD', supplierPrice: 200, qty: 2, weightKg: 3, dims: { l: 40, w: 30, h: 20 } })] }), t, { today: TODAY }).lines[0];
  ok('weight given: chargeable max(3 kg, 40×30×20 ÷ 5000 = 4.8) × ₱450 × 2 + 14%', w.method === 'weight' && near(w.freightLine, 4.8 * 450 * 2) && near(w.freightDuty, 4.8 * 450 * 2 + 0.14 * w.goodsLine));
  const nw = PE.peQuote(quote({ lines: [line({ description: 'w', currency: 'SGD', supplierPrice: 200, weightKg: 3 })] }), T, { today: TODAY });
  ok('weight given but no ₱/kg rate set: the allowance, and a note', nw.lines[0].method === 'allowance' && has(nw, 'freight_rate_not_set'));
  const tiny = PE.peQuote(quote({ lines: [line({ description: 'washer', itemType: 'trading', principal: 'Local', currency: 'PHP', supplierPrice: 120, origin: 'Local', freightClass: 'L' })] }), T, { today: TODAY });
  ok('a tiny order under ₱15k → decline_or_bundle', has(tiny, 'decline_or_bundle') && tiny.totals.netSale < 15000);
  const v = PE.peQuote(quote({ quoteValidity: '2026-12-31', supplierValidity: '2026-11-30', lines: [line({ description: 'x', currency: 'USD', supplierPrice: 100 })] }), T, { today: TODAY });
  ok('quote valid past the supplier\'s validity → flagged', has(v, 'validity_exceeds_supplier'));
  const crane = PE.peQuote(quote({ destination: 'Batangas', deliveryMode: 'Truck + crane', lines: [line({ description: 'x', currency: 'USD', supplierPrice: 100 })] }), T, { today: TODAY });
  ok('truck + crane without its quote → missing input, blocking', has(crane, 'missing_inputs') && !crane.ready);
  ok('a clean quotation with nothing to approve is ready', PE.peQuote(quote({ lines: [line({ description: 'Snap-on set', principal: 'Snap-on', currency: 'USD', supplierPrice: 640, qty: 3 })] }), T, { today: TODAY }).ready);
  ok('the engine never reaches outside itself', !/fetch\(|XMLHttpRequest|postFlow|fetchFlow|document\.|localStorage|flowCalcItem|calculateItem/.test(require('fs').readFileSync(require.resolve('../../dashboard/js/pe-engine.js'), 'utf8')));
}

console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
