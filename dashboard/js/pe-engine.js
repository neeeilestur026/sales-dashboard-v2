/* pe-engine.js — A340 · the Hi-ESCORP pricing engine (director dashboard).
   Pure rules: no page, no network, no link to Quotations, Pricing Requests, Inventory or the older
   pricing engines (pricing.js, flow-pricing-engine.js). Same inputs and the same tables always give the
   same result. It never applies a discount and never invents a market price.

   peQuote(input, tables, opts) → { lines, totals, band, flags, approval, ready, explanation }
     input  : the quotation (order fields + lines), see PE_BLANK_LINE / peBlankQuote
     tables : the director's reference tables (PE_DEFAULT_TABLES shape, edited on the Tables tab)
     opts   : { today: 'yyyy-mm-dd' (for the forex age), approvedBy: 'director'|'president'|'' }

   Order of work (spec §3): goods in pesos → freight and duty (stock / local / weight / forwarder / CIF /
   allowance by shipment size) → the shipment's fixed cost by value → delivery by CBM (else value) → job
   costs by value → 1% contingency → the net-sale band (the band the floor actually lands in; a gap takes
   the higher margin) → floor → recommended = floor + 10%, rounded up to a clean number → flags. */
(function (root) {
  'use strict';

  var PE_CURRENCIES = ['PHP', 'USD', 'SGD', 'EUR', 'AUD', 'AED', 'CNY'];
  var PE_PRINCIPALS = ['CEJN', 'RAD', 'Snap-on', 'Blue-Point', 'Chicago Pneumatic', 'Power Team', 'Local', 'Other'];
  var PE_ITEM_TYPES = ['line', 'trading', 'public_price', 'service'];
  var PE_INCOTERMS = ['EXW', 'FOB', 'CIF', 'DDP', 'Local-delivered'];
  var PE_CLASSES = ['A', 'B', 'C', 'D', 'L'];
  var PE_TERMS = ['Advance', '30-70', '50-50', '30 days', '60 days'];
  var PE_DELIVERY_MODES = ['Courier', 'Own vehicle', 'Truck', 'Truck + crane'];

  /* Starting values. Forex is left blank on purpose: the director types this month's bank selling rates. */
  var PE_DEFAULT_TABLES = {
    version: 0, effectiveDate: '', note: 'Starting values',
    forex: { PHP: { rate: 1, asOf: '' }, USD: { rate: null, asOf: '' }, SGD: { rate: null, asOf: '' }, EUR: { rate: null, asOf: '' },
             AUD: { rate: null, asOf: '' }, AED: { rate: null, asOf: '' }, CNY: { rate: null, asOf: '' } },
    forexBuffer: 0.03, forexBufferLongTerms: 0.05, forexStaleDays: 31,
    principals: {
      'CEJN': { currency: 'SGD', freightClass: 'A' }, 'RAD': { currency: 'USD', freightClass: 'C' },
      'Snap-on': { currency: 'USD', freightClass: 'A' }, 'Blue-Point': { currency: 'USD', freightClass: 'A' },
      'Chicago Pneumatic': { currency: 'USD', freightClass: 'B' }, 'Power Team': { currency: 'USD', freightClass: 'C' },
      'Local': { currency: 'PHP', freightClass: 'L' }, 'Other': { currency: 'USD', freightClass: 'B' }
    },
    allowance: [ { upTo: 50000, normal: 0.60, consolidated: 0.30 }, { upTo: 200000, normal: 0.40, consolidated: 0.25 },
                 { upTo: 1000000, normal: 0.35, consolidated: 0.22 }, { upTo: null, normal: 0.20, consolidated: 0.18 } ],
    fixedPerShipment: 10000,
    freightRates: { courierPerKg: null, airPerKg: null, seaPerCbm: null },
    dutyVatWithoutHs: 0.14, importVat: 0.12, claimInputVat: false, localPickup: 0.05,
    bands: [ { from: 0, to: 15000, margin: null, decline: true }, { from: 15000, to: 50000, margin: 0.45, handling: 3000 },
             { from: 50000, to: 2000000, margin: 0.40 }, { from: 2000000, to: null, margin: 0.30, president: true } ],
    tenderMargin: 0.30, serviceMargin: 0.50, publicMinMargin: 0.20, publicFloorBelowStreet: 0.05, publicPriceBelowStreet: 0.03,
    commission: 0.05, localTax: 0.02, vat: 0.12, contingency: 0.01, aboveFloor: 0.10,
    directorLimit: 2000000, estimatedFreightOver: 200000, discountSpot: 0.05, discountDirector: 0.10,
    termsDeposit: { 'Advance': 1, '30-70': 0.30, '50-50': 0.50, '30 days': 0, '60 days': 0 }, longTerms: ['60 days'],
    /* copied (not linked) from the existing delivery-charge table, 17 Oct 2026; edit them on the Tables tab */
    destinations: [
      { name: "Albuera, Baybay", cbmRate: 4900, minCharge: 650 },
      { name: "Bacolod", cbmRate: 3850, minCharge: 500 },
      { name: "Baguio", cbmRate: 2500, minCharge: 440 },
      { name: "Batangas", cbmRate: 2300, minCharge: 400 },
      { name: "Bayugan, Medina, Gingoog", cbmRate: 4350, minCharge: 750 },
      { name: "Benguet / Abra / Mountain Province", cbmRate: 3000, minCharge: 560 },
      { name: "Bislig / Trento", cbmRate: 5300, minCharge: 750 },
      { name: "Bulacan (Marilao, Obando, Meycuayan)", cbmRate: 1800, minCharge: 320 },
      { name: "Butuan", cbmRate: 4250, minCharge: 550 },
      { name: "Cabanatuan", cbmRate: 2100, minCharge: 370 },
      { name: "Cabadbaran, Sibagat", cbmRate: 4350, minCharge: 750 },
      { name: "Cagayan De Oro", cbmRate: 3950, minCharge: 550 },
      { name: "Cavite & Rizal / Antipolo", cbmRate: 2100, minCharge: 360 },
      { name: "Cebu", cbmRate: 3300, minCharge: 450 },
      { name: "Compostela", cbmRate: 6500, minCharge: 750 },
      { name: "Consolacion, Lapu-Lapu", cbmRate: 3350, minCharge: 500 },
      { name: "Cotabato Via Davao", cbmRate: 7250, minCharge: 800 },
      { name: "Dagupan", cbmRate: 2400, minCharge: 420 },
      { name: "Davao", cbmRate: 4150, minCharge: 550 },
      { name: "Dipolog", cbmRate: 3800, minCharge: 550 },
      { name: "Don Carlos, Malaybalay, Maramag, Valencia", cbmRate: 5350, minCharge: 750 },
      { name: "Dumaguete", cbmRate: 4000, minCharge: 500 },
      { name: "Estancia / Balasan", cbmRate: 3900, minCharge: 550 },
      { name: "Gen Santos", cbmRate: 4150, minCharge: 550 },
      { name: "Iligan", cbmRate: 4150, minCharge: 600 },
      { name: "Ilocos Sur / Ilocos Norte", cbmRate: 3000, minCharge: 500 },
      { name: "Iloilo", cbmRate: 3750, minCharge: 500 },
      { name: "Iriga, Daet, Goa", cbmRate: 3200, minCharge: 400 },
      { name: "Irosin, Gubat, Matnog Bulan", cbmRate: 3950, minCharge: 480 },
      { name: "Isabela", cbmRate: 2600, minCharge: 470 },
      { name: "Isulan", cbmRate: 7100, minCharge: 750 },
      { name: "Kabankalan", cbmRate: 4450, minCharge: 650 },
      { name: "Kalibo", cbmRate: 3800, minCharge: 550 },
      { name: "Kidapawan", cbmRate: 6250, minCharge: 750 },
      { name: "Laguna", cbmRate: 2200, minCharge: 360 },
      { name: "Legaspi", cbmRate: 2800, minCharge: 350 },
      { name: "Ligao, Polangui, Guinobatan", cbmRate: 3200, minCharge: 400 },
      { name: "Liloy, Sindanga, Dapitan", cbmRate: 5500, minCharge: 750 },
      { name: "Lucena & Quezon Prov.", cbmRate: 2900, minCharge: 500 },
      { name: "Maasin", cbmRate: 5000, minCharge: 550 },
      { name: "Mactan, Talisay", cbmRate: 3350, minCharge: 500 },
      { name: "Maranding, Buug, Molave", cbmRate: 4400, minCharge: 750 },
      { name: "Marbel, Koronadal", cbmRate: 6100, minCharge: 750 },
      { name: "Matalom, Bato, Sogod, Hilongos, Hindang Leyte", cbmRate: 5150, minCharge: 650 },
      { name: "Merida, Isabel, Palompon, Villaba, Matag-Ob", cbmRate: 4900, minCharge: 650 },
      { name: "Metro Manila", cbmRate: 1500, minCharge: 400 },
      { name: "Mindoro", cbmRate: 3300, minCharge: 400 },
      { name: "Nabunturan, Mati", cbmRate: 6200, minCharge: 750 },
      { name: "Naga", cbmRate: 2800, minCharge: 350 },
      { name: "Nueva Vizcaya / Cagayan Valley", cbmRate: 3000, minCharge: 560 },
      { name: "Ormoc", cbmRate: 4300, minCharge: 500 },
      { name: "Ozamis", cbmRate: 4000, minCharge: 550 },
      { name: "Pagadian / Oroquieta", cbmRate: 4400, minCharge: 750 },
      { name: "Palawan", cbmRate: 3350, minCharge: 500 },
      { name: "Pangasinan / La Union", cbmRate: 2500, minCharge: 580 },
      { name: "Polomolok", cbmRate: 5700, minCharge: 750 },
      { name: "Quirino Province / Santiago / Tuguegarao", cbmRate: 2800, minCharge: 580 },
      { name: "Roxas", cbmRate: 3550, minCharge: 550 },
      { name: "San Carlos", cbmRate: 4800, minCharge: 700 },
      { name: "San Francisco, Prosperidad, Barobo, Surigao Del Sur", cbmRate: 4750, minCharge: 750 },
      { name: "Sibugay Province", cbmRate: 6500, minCharge: 750 },
      { name: "Sorsogon", cbmRate: 3250, minCharge: 420 },
      { name: "Surigao", cbmRate: 5550, minCharge: 550 },
      { name: "Tabaco, Tiwi", cbmRate: 3200, minCharge: 400 },
      { name: "Tacloban", cbmRate: 4200, minCharge: 650 },
      { name: "Tacurong, Surallah", cbmRate: 6700, minCharge: 750 },
      { name: "Tagaloan, Balingasag", cbmRate: 4050, minCharge: 750 },
      { name: "Tagbilaran", cbmRate: 3500, minCharge: 450 },
      { name: "Tagum, Panabo, Carmen, Digos, Bansalan, Padada", cbmRate: 5700, minCharge: 750 },
      { name: "Tarlac / Nueva Ecija", cbmRate: 2400, minCharge: 460 },
      { name: "Zambales / Pampanga / Bataan", cbmRate: 2700, minCharge: 500 },
      { name: "Zamboanga", cbmRate: 4800, minCharge: 550 }
    ]
  };

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function has(v) { return v !== null && v !== undefined && v !== '' && isFinite(parseFloat(v)); }
  function peso(v) {
    var n = Math.round(num(v) * 100) / 100, neg = n < 0;
    var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '−₱' : '₱') + s;
  }
  function pct(v, d) { return (num(v) * 100).toFixed(d === undefined ? 0 : d).replace(/\.0+$/, '') + '%'; }
  function short(v) {
    var n = num(v);
    if (n >= 1e6) return '₱' + (Math.round(n / 1e5) / 10) + 'M';
    if (n >= 1e3) return '₱' + Math.round(n / 1e3) + 'k';
    return '₱' + Math.round(n);
  }
  /** Round up to a clean number: ₱10 under ₱1,000; ₱50 under ₱10,000; ₱500 under ₱100,000; ₱1,000 above. */
  function peRoundUp(x) {
    var step = x < 1000 ? 10 : x < 10000 ? 50 : x < 100000 ? 500 : 1000;
    return Math.ceil(x / step - 1e-9) * step;
  }
  function daysBetween(a, b) {
    var t1 = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z'), t2 = Date.parse(String(b).slice(0, 10) + 'T00:00:00Z');
    return (isFinite(t1) && isFinite(t2)) ? Math.round((t2 - t1) / 86400000) : NaN;
  }
  function cbmOf(l) {
    if (has(l.cbm) && num(l.cbm) > 0) return num(l.cbm);
    var d = l.dims || {};
    if (has(d.l) && has(d.w) && has(d.h)) return num(d.l) * num(d.w) * num(d.h) / 1e6;
    return 0;
  }
  function bandLabel(b) {
    if (b.to === null) return 'over ' + short(b.from);
    if (!b.from) return 'under ' + short(b.to);
    return short(b.from) + '–' + short(b.to);
  }
  function allowanceTier(tables, size) {
    var tiers = tables.allowance;
    for (var i = 0; i < tiers.length; i++) if (tiers[i].upTo === null || size < tiers[i].upTo || (i > 0 && size === tiers[i].upTo)) return { tier: tiers[i], i: i };
    return { tier: tiers[tiers.length - 1], i: tiers.length - 1 };
  }
  function tierLabel(tables, i) {
    var t = tables.allowance, lo = i ? t[i - 1].upTo : 0, hi = t[i].upTo;
    return hi === null ? 'over ' + short(lo) : (lo ? short(lo) + '–' + short(hi) : 'under ' + short(hi));
  }

  function peBlankLine(tables) {
    return { description: '', itemType: 'line', principal: 'CEJN', supplierPrice: '', currency: 'SGD', incoterm: 'EXW', qty: 1,
             origin: 'International', freightClass: 'A', shipMode: 'air', weightKg: '', dims: { l: '', w: '', h: '' }, cbm: '',
             hsDutyRate: '', streetPrice: '', inStock: false, landedUnitCost: '', consolidated: false, freightPhp: '', priceOverride: '' };
  }
  function peBlankQuote() {
    return { client: '', clientClass: '', destination: '', deliveryMode: 'Truck', deliveryQuotePhp: '', jobCostsPhp: '', isTender: false,
             supplierValidity: '', quoteValidity: '', supplierTerms: '30 days', clientDownpayment: '', lines: [] };
  }

  /* ── the calculation ─────────────────────────────────────────────────────────────────────────── */
  function peQuote(input, tables, opts) {
    tables = tables || PE_DEFAULT_TABLES; opts = opts || {};
    var T = tables, today = opts.today || '', flags = [], seen = {};
    function flag(code, text, blocking, extra) {
      var key = code + '|' + text;
      if (seen[key]) return;
      seen[key] = 1;
      flags.push(Object.assign({ code: code, text: text, blocking: !!blocking }, extra || {}));
    }
    var lines = (input.lines || []).map(function (raw, i) {
      var l = Object.assign({}, raw, { index: i, qty: Math.max(0, Math.floor(num(raw.qty))), why: [] });
      l.name = String(raw.description || '').trim() || 'Line ' + (i + 1);
      return l;
    });
    var longTerms = (T.longTerms || []).indexOf(input.supplierTerms) >= 0;
    var buffer = longTerms ? T.forexBufferLongTerms : T.forexBuffer;

    // 1 · goods in pesos, per unit
    lines.forEach(function (l) {
      if (l.qty <= 0) flag('missing_inputs', l.name + ': quantity must be at least 1', true);
      if (l.inStock) {
        if (!(num(l.landedUnitCost) > 0)) flag('missing_inputs', l.name + ': enter its landed cost from stock', true);
        l.goodsUnit = num(l.landedUnitCost); l.rate = 1; l.buffer = 0; l.method = 'stock';
        return;
      }
      if (!(num(l.supplierPrice) > 0)) flag('missing_inputs', l.name + ': enter the supplier price', true);
      var cur = l.currency || 'PHP';
      if (cur === 'PHP') { l.rate = 1; l.buffer = 0; }
      else {
        var fx = (T.forex || {})[cur] || {};
        if (!(num(fx.rate) > 0)) { flag('missing_forex', 'No ' + cur + ' rate in the forex table', true); l.rate = 0; }
        else {
          l.rate = num(fx.rate);
          var age = daysBetween(fx.asOf, today);
          if (!fx.asOf || !(age <= T.forexStaleDays)) flag('forex_stale', cur + ' rate ' + (fx.asOf ? 'is from ' + fx.asOf + ' (' + age + ' days old)' : 'has no date') + ': update it before sending', true);
        }
        l.buffer = buffer;
      }
      l.goodsUnit = num(l.supplierPrice) * l.rate * (1 + l.buffer);
      if (l.itemType === 'public_price' && !(num(l.streetPrice) > 0)) flag('missing_inputs', l.name + ': a public-price item needs its street price', true);
    });

    // 2 · shipments: international lines not in stock and not delivered duty-paid, by principal and consolidation
    var groups = {};
    lines.forEach(function (l) {
      l.goodsLine = l.goodsUnit * l.qty;
      l.intl = !l.inStock && l.origin === 'International';
      l.inShipment = l.intl && l.incoterm !== 'DDP';
      if (l.inShipment) {
        var k = (l.principal || 'Other') + '|' + (l.consolidated ? 'C' : 'N');
        (groups[k] = groups[k] || { key: k, goods: 0, lines: [], consolidated: !!l.consolidated, allowance: false }).goods += l.goodsLine;
        groups[k].lines.push(l); l.group = groups[k];
      }
    });

    // 3 · freight and duty, per line
    function dutyPart(l, freightLine) {
      if (has(l.hsDutyRate)) {
        var duty = num(l.hsDutyRate) / 100 * (l.goodsLine + freightLine);
        var ivat = T.claimInputVat ? 0 : T.importVat * (l.goodsLine + freightLine + duty);
        l.why.push('duty ' + num(l.hsDutyRate) + '% = ' + peso(duty) + (ivat ? ', import VAT 12% = ' + peso(ivat) : ''));
        return duty + ivat;
      }
      var d = T.dutyVatWithoutHs * l.goodsLine;
      l.why.push('duty and import VAT ' + pct(T.dutyVatWithoutHs) + ' of goods (no HS rate) = ' + peso(d));
      return d;
    }
    lines.forEach(function (l) {
      l.freightDuty = 0;
      if (l.inStock) { l.method = 'stock'; return; }
      if (l.origin !== 'International') {
        if (l.incoterm === 'Local-delivered' || l.incoterm === 'DDP') { l.method = 'delivered'; return; }
        l.method = 'pickup'; l.freightDuty = T.localPickup * l.goodsLine; return;
      }
      if (l.incoterm === 'DDP') { l.method = 'ddp'; return; }
      if (l.freightClass === 'D' || has(l.freightPhp) && num(l.freightPhp) > 0) {
        var fq = num(l.freightPhp);
        if (l.freightClass === 'D' && l.incoterm !== 'CIF' && !(fq > 0)) flag('missing_forwarder_quote', l.name + ': outsize (class D) needs a forwarder quote in "Freight ₱"', true);
        l.method = 'forwarder'; l.freightLine = fq;
        l.freightDuty = fq + dutyPart(l, fq); return;
      }
      if (l.incoterm === 'CIF') { l.method = 'cif'; l.freightLine = 0; l.freightDuty = dutyPart(l, 0); return; }
      var d = l.dims || {}, kg = num(l.weightKg), cls = l.freightClass;
      var useWeight = (kg > 0 || (has(d.l) && has(d.w) && has(d.h))) && (cls === 'A' || cls === 'B' || cls === 'C');
      if (useWeight) {
        var vol = has(d.l) && has(d.w) && has(d.h) ? num(d.l) * num(d.w) * num(d.h) : 0;
        var R = T.freightRates || {}, rate = null, chargeable = 0, basis = '';
        if (cls === 'C' && l.shipMode === 'sea') {
          rate = R.seaPerCbm; chargeable = cbmOf(l); basis = chargeable.toFixed(3) + ' CBM by sea';
        } else {
          chargeable = Math.max(kg, vol / (cls === 'C' ? 6000 : 5000));
          rate = cls === 'A' ? R.courierPerKg : R.airPerKg; basis = chargeable.toFixed(2) + ' kg chargeable';
        }
        if (num(rate) > 0 && chargeable > 0) {
          l.method = 'weight'; l.freightLine = chargeable * num(rate) * l.qty;
          l.why.push('freight ' + basis + ' × ' + peso(rate) + ' × ' + l.qty + ' = ' + peso(l.freightLine));
          l.freightDuty = l.freightLine + dutyPart(l, l.freightLine); return;
        }
        flag('freight_rate_not_set', 'No ' + (cls === 'C' && l.shipMode === 'sea' ? 'sea ₱/CBM' : cls === 'A' ? 'courier ₱/kg' : 'air ₱/kg') + ' rate in the tables: ' + l.name + ' uses the import allowance', false);
      }
      l.method = 'allowance';
      var at = allowanceTier(T, l.group.goods), a = l.consolidated ? at.tier.consolidated : at.tier.normal;
      l.allowance = a; l.allowanceLabel = tierLabel(T, at.i); l.group.allowance = true;
      l.freightDuty = a * l.goodsLine;
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.allowance && g.goods > T.estimatedFreightOver) flag('estimated_freight', 'Freight on a ' + peso(g.goods) + ' purchase is the allowance, not a forwarder quote: get one before sending', false);
    });

    // 4 · the shipment's fixed cost, by value
    lines.forEach(function (l) {
      l.fixedShare = l.inShipment && l.group.goods > 0 ? T.fixedPerShipment * l.goodsLine / l.group.goods : 0;
      l.landedLine = l.goodsLine + l.freightDuty + l.fixedShare;
      if (l.group) { l.shipment = l.group.key; l.shipmentGoods = l.group.goods; delete l.group; }   // no cycles: the result is saved as JSON
    });

    // 5 · delivery to the client, by CBM (else by value)
    var totalLanded = lines.reduce(function (s, l) { return s + l.landedLine; }, 0);
    var dest = (T.destinations || []).filter(function (d) { return d.name === input.destination; })[0];
    var totalCbm = lines.reduce(function (s, l) { return s + cbmOf(l) * l.qty; }, 0);
    var allCbm = lines.length > 0 && lines.every(function (l) { return cbmOf(l) > 0; });
    var delivery = 0, deliveryText = 'No delivery: the client collects';
    if (input.deliveryMode === 'Truck + crane' && input.destination) {
      delivery = num(input.deliveryQuotePhp);
      if (!(delivery > 0)) flag('missing_inputs', 'Truck + crane: enter the delivery quote', true);
      deliveryText = 'Delivery by truck + crane to ' + input.destination + ': quote ' + peso(delivery);
    } else if (dest) {
      delivery = Math.max(totalCbm * dest.cbmRate, dest.minCharge);
      deliveryText = 'Delivery to ' + dest.name + ' ' + totalCbm.toFixed(2) + ' CBM × ' + peso(dest.cbmRate) + ' = ' + peso(totalCbm * dest.cbmRate) + ' (min ' + peso(dest.minCharge) + ') → ' + peso(delivery);
    } else if (input.destination) {
      flag('missing_inputs', 'Destination "' + input.destination + '" is not in the delivery table', true);
    }
    var job = num(input.jobCostsPhp);
    lines.forEach(function (l) {
      var byValue = totalLanded > 0 ? l.landedLine / totalLanded : 1 / Math.max(1, lines.length);
      l.deliveryShare = delivery * (allCbm && totalCbm > 0 ? cbmOf(l) * l.qty / totalCbm : byValue);
      l.jobShare = job * byValue;
      l.baseLine = (l.landedLine + l.deliveryShare + l.jobShare) * (1 + T.contingency);
    });

    // 6 · the band: the one the floor actually lands in (a gap takes the higher margin)
    var C = lines.reduce(function (s, l) { return s + l.baseLine; }, 0);
    function price(band) {
      var h = band.handling || 0, keep = 1 - T.commission - T.localTax, net = 0;
      var out = lines.map(function (l) {
        var m = l.itemType === 'service' ? T.serviceMargin : band.margin;
        var cogs = l.baseLine + (C > 0 ? h * l.baseLine / C : h / Math.max(1, lines.length));
        var costFloor = cogs / (keep - m), floor = costFloor;
        if (l.itemType === 'public_price' && num(l.streetPrice) > 0) floor = Math.min(costFloor, num(l.streetPrice) * (1 - T.publicFloorBelowStreet) * l.qty);
        net += floor;
        return { cogs: cogs, costFloor: costFloor, floor: floor, margin: m };
      });
      return { band: band, lines: out, net: net };
    }
    var B = T.bands, pick, gapNote = '';
    var bSmall = B[1], bMid = B[2], bBig = B[3];
    if (input.isTender) pick = price(Object.assign({}, bBig, { margin: T.tenderMargin, tender: true }));
    else {
      var p1 = price(bSmall);
      if (p1.net < bSmall.to) pick = p1;
      else {
        var p2 = price(bMid);
        if (p2.net >= bMid.from && p2.net <= bMid.to) pick = p2;
        else if (p2.net < bMid.from) { pick = p1; gapNote = 'At 40% the price falls under ' + short(bMid.from) + ' and at 45% it rises over it: the higher margin is used.'; }
        else {
          var p3 = price(bBig);
          if (p3.net > bBig.from) pick = p3;
          else { pick = p2; gapNote = 'At 30% the price falls under ' + short(bBig.from) + ' and at 40% it rises over it: the higher margin is used.'; }
        }
      }
    }

    // 7 · floor, recommended, price
    var keep = 1 - T.commission - T.localTax;
    lines.forEach(function (l, i) {
      var p = pick.lines[i];
      l.cogsLine = p.cogs; l.margin = p.margin; l.floorLine = p.floor; l.costFloorLine = p.costFloor;
      l.cogsUnit = l.qty ? l.cogsLine / l.qty : 0; l.floorUnit = l.qty ? l.floorLine / l.qty : 0;
      var rec = peRoundUp(l.qty ? l.costFloorLine / l.qty * (1 + T.aboveFloor) : 0);
      if (l.itemType === 'public_price' && num(l.streetPrice) > 0) rec = Math.min(rec, num(l.streetPrice) * (1 - T.publicPriceBelowStreet));
      l.recommendedUnit = rec;
      l.overridden = num(l.priceOverride) > 0;
      l.priceUnit = l.overridden ? num(l.priceOverride) : rec;
      l.netLine = l.priceUnit * l.qty;
      l.marginAchieved = l.netLine > 0 ? (l.netLine - l.cogsLine) / l.netLine : 0;
      if (l.priceUnit < l.floorUnit - 0.005) {
        flag('below_floor', l.name + ': ' + peso(l.priceUnit) + ' is under its floor ' + peso(l.floorUnit), false, { line: i, itemType: l.itemType });
      }
      if (l.itemType === 'public_price' && l.marginAchieved < T.publicMinMargin) {
        flag('decline_or_bundle', l.name + ': public-price item at ' + pct(l.marginAchieved, 1) + ' margin (under ' + pct(T.publicMinMargin) + '): decline or bundle it', false);
      }
    });
    var net = lines.reduce(function (s, l) { return s + l.netLine; }, 0);
    var cogs = lines.reduce(function (s, l) { return s + l.cogsLine; }, 0);
    var floorTotal = lines.reduce(function (s, l) { return s + l.floorLine; }, 0);
    if (lines.length && net < bSmall.from) flag('decline_or_bundle', 'Net sale ' + peso(net) + ' is under ' + short(bSmall.from) + ': decline or bundle it', false);
    if (input.isTender) flag('tender', 'Tender: 30% band, the president approves', false);
    else if (net > T.directorLimit) flag('over_limit', 'Net sale over ' + short(T.directorLimit) + ': the president approves', false);

    // 8 · cash and validity
    var goodsToBuy = lines.reduce(function (s, l) { return s + (l.inStock ? 0 : l.goodsLine); }, 0);
    var depositPct = (T.termsDeposit || {})[input.supplierTerms] || 0, deposit = depositPct * goodsToBuy, dp = num(input.clientDownpayment);
    if (deposit > dp + 0.005) flag('cash_exposure', 'Supplier deposit ' + peso(deposit) + ' (' + input.supplierTerms + ') is ' + peso(deposit - dp) + ' more than the client\'s downpayment ' + peso(dp), false, { gap: deposit - dp });
    if (input.quoteValidity && input.supplierValidity && input.quoteValidity > input.supplierValidity) {
      flag('validity_exceeds_supplier', 'Quote valid to ' + input.quoteValidity + ', after the supplier\'s ' + input.supplierValidity, false);
    }

    // 9 · approval
    var codes = flags.map(function (f) { return f.code; });
    var needs = codes.indexOf('below_floor') >= 0 || codes.indexOf('decline_or_bundle') >= 0 || codes.indexOf('tender') >= 0 || codes.indexOf('over_limit') >= 0;
    var presidentNeeded = !!input.isTender || net > T.directorLimit ||
      flags.some(function (f) { return f.code === 'below_floor' && f.itemType === 'line'; });
    var approver = needs ? (presidentNeeded ? 'president' : 'director') : '';
    var reasons = [];
    if (codes.indexOf('below_floor') >= 0) reasons.push('a price is under its floor');
    if (codes.indexOf('decline_or_bundle') >= 0) reasons.push('decline-or-bundle override');
    if (input.isTender) reasons.push('tender');
    if (net > T.directorLimit) reasons.push('net sale over ' + short(T.directorLimit));
    var by = opts.approvedBy || '';
    var approved = !needs || by === 'president' || (by === 'director' && approver === 'director');
    var blocking = flags.filter(function (f) { return f.blocking; });
    var ready = lines.length > 0 && !blocking.length && approved;

    var totals = { netSale: net, vat: net * T.vat, gross: net * (1 + T.vat), cogs: cogs, floor: floorTotal,
                   margin: net > 0 ? (net - cogs) / net : 0, netToCompany: net - cogs - (T.commission + T.localTax) * net,
                   delivery: delivery, job: job, handling: pick.band.handling || 0, deposit: deposit, goodsToBuy: goodsToBuy };
    var band = { label: input.isTender ? 'tender' : bandLabel(pick.band), margin: pick.band.margin, handling: pick.band.handling || 0,
                 tender: !!input.isTender, note: gapNote };

    // 10 · the explanation, from the numbers
    var ex = lines.map(function (l) {
      var s = [l.name + ', ' + l.qty + ' pc' + (l.qty === 1 ? '' : 's') + '.'];
      if (l.method === 'stock') s.push('In stock: landed ' + peso(l.goodsUnit) + ' each.');
      else if (l.currency && l.currency !== 'PHP') s.push('Supplier ' + l.currency + ' ' + num(l.supplierPrice).toLocaleString('en-US') + ' at ' + l.rate + ' + ' + pct(l.buffer) + ' = ' + peso(l.goodsUnit) + ' each.');
      else s.push('Supplier ' + peso(l.goodsUnit) + ' each.');
      if (l.method === 'pickup') s.push('Local pickup ' + pct(T.localPickup) + ' = ' + peso(l.freightDuty) + '.');
      if (l.method === 'delivered') s.push('Delivered by the supplier: no freight.');
      if (l.method === 'ddp') s.push('DDP: the supplier pays freight and duty.');
      if (l.method === 'allowance') s.push('Import allowance ' + pct(l.allowance) + ' (purchase ' + l.allowanceLabel + ', ' + (l.consolidated ? 'consolidated' : 'not consolidated') + ') = ' + peso(l.freightDuty) + '.');
      if (l.method === 'forwarder') s.push('Forwarder freight ' + peso(l.freightLine) + '; ' + l.why.join('; ') + '.');
      if (l.method === 'cif' || l.method === 'weight') s.push(l.why.join('; ') + '.');
      if (l.fixedShare) s.push('Shipment fixed cost share ' + peso(l.fixedShare) + '.');
      if (l.deliveryShare) s.push('Delivery share ' + peso(l.deliveryShare) + '.');
      if (l.jobShare) s.push('Job costs share ' + peso(l.jobShare) + '.');
      s.push('Contingency ' + pct(T.contingency) + '.');
      if (band.handling) s.push('Handling share ' + peso(l.cogsLine - l.baseLine) + '.');
      s.push('COGS ' + peso(l.cogsLine) + '.');
      s.push((l.itemType === 'service' ? 'Service → floor ' + pct(l.margin) : 'Net sale band ' + band.label + ' → floor ' + pct(l.margin)) + ' → floor ' + peso(l.floorLine) + '.');
      s.push('Recommended ' + peso(l.recommendedUnit) + ' ex-VAT, ' + peso(l.recommendedUnit * (1 + T.vat)) + ' incl. VAT' + (l.qty > 1 ? ' each' : '') + '.');
      if (l.overridden) s.push('Priced at ' + peso(l.priceUnit) + ' by hand.');
      return s.join(' ');
    });
    ex.push(deliveryText + '.');
    if (band.handling) ex.push('Net sale under ' + short(bMid.from) + ': ' + peso(band.handling) + ' handling added to COGS.');
    if (gapNote) ex.push(gapNote);
    ex.push('Quotation: net sale ' + peso(net) + ', VAT ' + peso(totals.vat) + ', total ' + peso(totals.gross) + '; COGS ' + peso(cogs) +
            '; margin ' + pct(totals.margin, 1) + '; net to the company after ' + pct(T.commission) + ' commission and ' + pct(T.localTax) + ' local tax ' + peso(totals.netToCompany) + '.');

    return { lines: lines, totals: totals, band: band, flags: flags, ready: ready,
             approval: { needed: needs, approver: approver, reasons: reasons, approvedBy: approved && needs ? by : '',
                         discountSpot: T.discountSpot, discountDirector: T.discountDirector },
             explanation: ex, tablesVersion: T.version };
  }

  /** Quantity tiers: the same quotation with this line at 1, 5 and 10 pieces (class A/B imports, not in stock). */
  function peTiers(input, tables, opts, index) {
    var l = input.lines[index];
    if (!l || l.inStock || l.origin !== 'International' || (l.freightClass !== 'A' && l.freightClass !== 'B')) return null;
    var out = {};
    [1, 5, 10].forEach(function (q) {
      var copy = Object.assign({}, input, { lines: input.lines.map(function (x, i) { return i === index ? Object.assign({}, x, { qty: q, priceOverride: '' }) : x; }) });
      out[q] = peQuote(copy, tables, opts).lines[index].recommendedUnit;
    });
    return out;
  }

  var api = { peQuote: peQuote, peTiers: peTiers, peRoundUp: peRoundUp, peBlankLine: peBlankLine, peBlankQuote: peBlankQuote, pePeso: peso,
              PE_DEFAULT_TABLES: PE_DEFAULT_TABLES, PE_CURRENCIES: PE_CURRENCIES, PE_PRINCIPALS: PE_PRINCIPALS, PE_ITEM_TYPES: PE_ITEM_TYPES,
              PE_INCOTERMS: PE_INCOTERMS, PE_CLASSES: PE_CLASSES, PE_TERMS: PE_TERMS, PE_DELIVERY_MODES: PE_DELIVERY_MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PE = api;
})(typeof window !== 'undefined' ? window : this);
