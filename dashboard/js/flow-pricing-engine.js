/* flow-pricing-engine.js — standalone port of the legacy pricing engine (no DOM deps).
   Used by the Pricing-Request flow (management final pricing). Mirrors dashboard/js/pricing.js
   calculateItem(): landed = buyPHP + duties; + CBM freight; net = COGS / (1 - commission - margin - 2%);
   + 12% VAT. Final Price = unitPriceVatEx = net / qty (VAT-exclusive — the flow quotation adds VAT). */

const FLOW_PRINCIPALS = [
  { name: 'CEJN',              origin: 'Singapore',   currency: 'SGD', forex: 52, dutiesPct: 35 },
  { name: 'Snap-on',           origin: 'Singapore',   currency: 'USD', forex: 62, dutiesPct: 35 },
  { name: 'Blue-point',        origin: 'Singapore',   currency: 'USD', forex: 62, dutiesPct: 35 },
  { name: 'Local',             origin: 'Philippines',  currency: 'PHP', forex: 1,  dutiesPct: 7.5 },
  { name: 'SPX Powerteam',     origin: 'Singapore',   currency: 'USD', forex: 62, dutiesPct: 35 },
  { name: 'ABASCO',            origin: 'UAE',          currency: 'AED', forex: 17, dutiesPct: 35 },
  { name: 'RTS',               origin: 'Australia',    currency: 'AUD', forex: 45, dutiesPct: 35 },
  { name: 'Chicago Pneumatic', origin: 'Belgium',      currency: 'EUR', forex: 72, dutiesPct: 35 },
];

const FLOW_DESTINATIONS = [
  { name: 'Albuera, Baybay', cbmRate: 4900, minCharge: 650 },
  { name: 'Bacolod', cbmRate: 3850, minCharge: 500 },
  { name: 'Baguio', cbmRate: 2500, minCharge: 440 },
  { name: 'Batangas', cbmRate: 2300, minCharge: 400 },
  { name: 'Bayugan, Medina, Gingoog', cbmRate: 4350, minCharge: 750 },
  { name: 'Benguet / Abra / Mountain Province', cbmRate: 3000, minCharge: 560 },
  { name: 'Bislig / Trento', cbmRate: 5300, minCharge: 750 },
  { name: 'Bulacan (Marilao, Obando, Meycuayan)', cbmRate: 1800, minCharge: 320 },
  { name: 'Butuan', cbmRate: 4250, minCharge: 550 },
  { name: 'Cabanatuan', cbmRate: 2100, minCharge: 370 },
  { name: 'Cabadbaran, Sibagat', cbmRate: 4350, minCharge: 750 },
  { name: 'Cagayan De Oro', cbmRate: 3950, minCharge: 550 },
  { name: 'Cavite & Rizal / Antipolo', cbmRate: 2100, minCharge: 360 },
  { name: 'Cebu', cbmRate: 3300, minCharge: 450 },
  { name: 'Compostela', cbmRate: 6500, minCharge: 750 },
  { name: 'Consolacion, Lapu-Lapu', cbmRate: 3350, minCharge: 500 },
  { name: 'Cotabato Via Davao', cbmRate: 7250, minCharge: 800 },
  { name: 'Dagupan', cbmRate: 2400, minCharge: 420 },
  { name: 'Davao', cbmRate: 4150, minCharge: 550 },
  { name: 'Dipolog', cbmRate: 3800, minCharge: 550 },
  { name: 'Don Carlos, Malaybalay, Maramag, Valencia', cbmRate: 5350, minCharge: 750 },
  { name: 'Dumaguete', cbmRate: 4000, minCharge: 500 },
  { name: 'Estancia / Balasan', cbmRate: 3900, minCharge: 550 },
  { name: 'Gen Santos', cbmRate: 4150, minCharge: 550 },
  { name: 'Iligan', cbmRate: 4150, minCharge: 600 },
  { name: 'Ilocos Sur / Ilocos Norte', cbmRate: 3000, minCharge: 500 },
  { name: 'Iloilo', cbmRate: 3750, minCharge: 500 },
  { name: 'Iriga, Daet, Goa', cbmRate: 3200, minCharge: 400 },
  { name: 'Irosin, Gubat, Matnog Bulan', cbmRate: 3950, minCharge: 480 },
  { name: 'Isabela', cbmRate: 2600, minCharge: 470 },
  { name: 'Isulan', cbmRate: 7100, minCharge: 750 },
  { name: 'Kabankalan', cbmRate: 4450, minCharge: 650 },
  { name: 'Kalibo', cbmRate: 3800, minCharge: 550 },
  { name: 'Kidapawan', cbmRate: 6250, minCharge: 750 },
  { name: 'Laguna', cbmRate: 2200, minCharge: 360 },
  { name: 'Legaspi', cbmRate: 2800, minCharge: 350 },
  { name: 'Ligao, Polangui, Guinobatan', cbmRate: 3200, minCharge: 400 },
  { name: 'Liloy, Sindanga, Dapitan', cbmRate: 5500, minCharge: 750 },
  { name: 'Lucena & Quezon Prov.', cbmRate: 2900, minCharge: 500 },
  { name: 'Maasin', cbmRate: 5000, minCharge: 550 },
  { name: 'Mactan, Talisay', cbmRate: 3350, minCharge: 500 },
  { name: 'Maranding, Buug, Molave', cbmRate: 4400, minCharge: 750 },
  { name: 'Marbel, Koronadal', cbmRate: 6100, minCharge: 750 },
  { name: 'Matalom, Bato, Sogod, Hilongos, Hindang Leyte', cbmRate: 5150, minCharge: 650 },
  { name: 'Merida, Isabel, Palompon, Villaba, Matag-Ob', cbmRate: 4900, minCharge: 650 },
  { name: 'Metro Manila', cbmRate: 1500, minCharge: 400 },
  { name: 'Mindoro', cbmRate: 3300, minCharge: 400 },
  { name: 'Nabunturan, Mati', cbmRate: 6200, minCharge: 750 },
  { name: 'Naga', cbmRate: 2800, minCharge: 350 },
  { name: 'Nueva Vizcaya / Cagayan Valley', cbmRate: 3000, minCharge: 560 },
  { name: 'Ormoc', cbmRate: 4300, minCharge: 500 },
  { name: 'Ozamis', cbmRate: 4000, minCharge: 550 },
  { name: 'Pagadian / Oroquieta', cbmRate: 4400, minCharge: 750 },
  { name: 'Palawan', cbmRate: 3350, minCharge: 500 },
  { name: 'Pangasinan / La Union', cbmRate: 2500, minCharge: 580 },
  { name: 'Polomolok', cbmRate: 5700, minCharge: 750 },
  { name: 'Quirino Province / Santiago / Tuguegarao', cbmRate: 2800, minCharge: 580 },
  { name: 'Roxas', cbmRate: 3550, minCharge: 550 },
  { name: 'San Carlos', cbmRate: 4800, minCharge: 700 },
  { name: 'San Francisco, Prosperidad, Barobo, Surigao Del Sur', cbmRate: 4750, minCharge: 750 },
  { name: 'Sibugay Province', cbmRate: 6500, minCharge: 750 },
  { name: 'Sorsogon', cbmRate: 3250, minCharge: 420 },
  { name: 'Surigao', cbmRate: 5550, minCharge: 550 },
  { name: 'Tabaco, Tiwi', cbmRate: 3200, minCharge: 400 },
  { name: 'Tacloban', cbmRate: 4200, minCharge: 650 },
  { name: 'Tacurong, Surallah', cbmRate: 6700, minCharge: 750 },
  { name: 'Tagaloan, Balingasag', cbmRate: 4050, minCharge: 750 },
  { name: 'Tagbilaran', cbmRate: 3500, minCharge: 450 },
  { name: 'Tagum, Panabo, Carmen, Digos, Bansalan, Padada', cbmRate: 5700, minCharge: 750 },
  { name: 'Tarlac / Nueva Ecija', cbmRate: 2400, minCharge: 460 },
  { name: 'Zambales / Pampanga / Bataan', cbmRate: 2700, minCharge: 500 },
  { name: 'Zamboanga', cbmRate: 4800, minCharge: 550 },
];

/**
 * Compute one item's final VAT-exclusive unit price.
 * @param {{buyPrice:number, discount?:number, qty:number, cbm?:number}} item
 * @param {{forex:number, dutiesPct:number}} principal  (forex/duties overridable via opts)
 * @param {{cbmRate:number, minCharge:number}|null} destination
 * @param {number} commissionPct
 * @param {number} marginPct
 * @param {{forex?:number, dutiesPct?:number}} [opts]  optional rate overrides
 */
function flowCalcItem(item, principal, destination, commissionPct, marginPct, opts) {
  opts = opts || {};
  const LOCAL_TAX_PCT = 0.02;
  const VAT_PCT = 0.12;

  const buyPrice = parseFloat(item.buyPrice) || 0;
  const discount = parseFloat(item.discount) || 0;
  const qty = parseFloat(item.qty) || 0;
  const cbm = parseFloat(item.cbm) || 0;

  const effectiveBuyPrice = buyPrice * (1 - discount / 100);
  const buyPriceTotal = effectiveBuyPrice * qty;
  const forexRate = (isFinite(opts.forex) && opts.forex > 0) ? opts.forex : (principal && principal.forex ? principal.forex : 1);
  const buyPricePHP = buyPriceTotal * forexRate;
  const dutiesPct = (isFinite(opts.dutiesPct) && opts.dutiesPct >= 0) ? opts.dutiesPct : (principal && isFinite(principal.dutiesPct) ? principal.dutiesPct : 0);
  const brokerage = buyPricePHP * (dutiesPct / 100);
  const landedCost = buyPricePHP + brokerage;

  let deliveryCost = 0;
  if (cbm > 0 && destination) {
    deliveryCost = Math.max(cbm * destination.cbmRate, destination.minCharge);
  }

  const totalCOGS = landedCost + deliveryCost;
  const denom = 1 - (commissionPct / 100) - (marginPct / 100) - LOCAL_TAX_PCT;
  const netSellingPrice = denom > 0 ? totalCOGS / denom : 0;
  // Breakdown components of the net selling price (match legacy calculateItem).
  const commission = netSellingPrice * (commissionPct / 100);
  const profitMargin = netSellingPrice * (marginPct / 100);
  const localTax = netSellingPrice * LOCAL_TAX_PCT;
  const vat = netSellingPrice * VAT_PCT;
  const finalPrice = netSellingPrice + vat;
  const unitPrice = qty > 0 ? finalPrice / qty : 0;
  const unitPriceVatEx = qty > 0 ? netSellingPrice / qty : 0;

  return {
    qty, effectiveBuyPrice, buyPriceTotal, buyPricePHP, brokerage, landedCost, deliveryCost, totalCOGS,
    netSellingPrice, commission, profitMargin, localTax, vat, finalPrice, unitPrice, unitPriceVatEx,
    forexRate, dutiesPct
  };
}

function flowPrincipalByName(name) {
  return FLOW_PRINCIPALS.find(p => p.name === name) || null;
}
function flowDestinationByName(name) {
  return FLOW_DESTINATIONS.find(d => d.name === name) || null;
}
