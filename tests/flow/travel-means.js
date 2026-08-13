/* A237 — what a travel leg WAS decides where it prints. Run: node tests/flow/travel-means.js
 *
 * WHY THIS FILE EXISTS. The COENRR is a signed certification that these specific expenses CANNOT
 * produce an official receipt. Before A237 the page put a leg on it whenever no receipt PHOTO was
 * attached — so every leg landed there the moment it was added, and a bus fare or a hotel bill went
 * out certified, by the rep, approved by the director, as needing no receipt. That is a false
 * statement on an audited document, not a cosmetic default.
 *
 * The vocabulary below is therefore a domain fact, not a preference, and this pins it. It also pins
 * `kind`, because the same one choice decides whether the leg prints on the Travel Itinerary — which
 * is why a lunch used to appear there as a journey leg (every creation site hardcoded 'Transport').
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'dashboard', 'js', 'flow-travel.js'), 'utf8');

/* Everything above the DOMContentLoaded listener is DOM-free by construction; evaluating only that
   prefix is what lets the real shipped table be tested rather than a copy of it that can drift. */
const cut = SRC.indexOf("document.addEventListener('DOMContentLoaded'");
if (cut < 0) { console.log('  FAIL could not find the DOMContentLoaded boundary'); process.exit(1); }
const ctx = { flowEsc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
vm.createContext(ctx);
vm.runInContext(SRC.slice(0, cut) + '\n;this.TV_MEANS=TV_MEANS;this.TV_KINDS=TV_KINDS;' +
                'this.tvMeansSpec=tvMeansSpec;this.tvMeansOptions=tvMeansOptions;', ctx);
const { TV_MEANS, TV_KINDS, tvMeansSpec, tvMeansOptions } = ctx;

let fail = 0;
const ok = (l, c, x) => { if (!c) { fail++; console.log('  FAIL', l, x === undefined ? '' : JSON.stringify(x)); }
                          else console.log('  ok  ', l); };
const eq = (l, g, w) => ok(l + ' = ' + JSON.stringify(g), JSON.stringify(g) === JSON.stringify(w), { want: w });

console.log('== the certificate carries informal transport, and nothing else ==');
// The answer to "which means genuinely never issue an OR", pinned so it cannot drift silently.
const CERT = ['Tricycle', 'Jeepney', 'Pedicab', 'Habal-habal'];
eq('exactly these default to the certificate',
   TV_MEANS.filter(m => m.cert).map(m => m.v).sort(), CERT.slice().sort());

console.log('\n== the things that DO issue a receipt never default onto it ==');
['Bus', 'Taxi / Grab', 'UV Express / Van', 'Ferry / Boat', 'Plane', 'Fuel',
 'Parking / Toll', 'Meals', 'Lodging', 'Other'].forEach(v => {
  const s = tvMeansSpec(v);
  ok(v + ' expects a receipt', !!s && s.cert === false, s);
});

console.log('\n== one choice drives the OTHER page too ==');
// page 2 of the pack is `[i for i in items if i["kind"] == "Transport"]`, so a lunch tagged
// Transport prints as a journey leg. That is the bug the hardcoded kind produced.
ok('every kind is one page 2 understands', TV_MEANS.every(m => TV_KINDS.indexOf(m.kind) >= 0),
   TV_MEANS.filter(m => TV_KINDS.indexOf(m.kind) < 0));
eq('a lunch is not a journey', tvMeansSpec('Meals').kind, 'Meals');
eq('lodging is not a journey', tvMeansSpec('Lodging').kind, 'Other');
eq('parking is not a journey', tvMeansSpec('Parking / Toll').kind, 'Parking/Toll');
eq('a tricycle is', tvMeansSpec('Tricycle').kind, 'Transport');
eq('and so is a plane', tvMeansSpec('Plane').kind, 'Transport');

console.log('\n== lookup is forgiving about what the rep typed ==');
eq('case does not matter', tvMeansSpec('tricycle').v, 'Tricycle');
eq('surrounding space does not matter', tvMeansSpec('  Jeepney  ').v, 'Jeepney');
eq('an unknown legacy value resolves to nothing', tvMeansSpec('Trike'), null);
eq('so does blank', tvMeansSpec(''), null);
eq('and so does undefined', tvMeansSpec(undefined), null);

console.log('\n== a legacy free-text leg is never silently rewritten ==');
// 'Trike' is what some rep actually typed. Dropping it would quietly change a filed record.
const legacy = tvMeansOptions('Trike');
ok('the typed value survives as its own option', legacy.indexOf('>Trike (as typed)<') > -1);
ok('  and it is the selected one', /<option value="Trike" selected>/.test(legacy));
ok('  while the real vocabulary is still offered', legacy.indexOf('>Tricycle<') > -1);

const known = tvMeansOptions('Bus');
ok('a known value selects its own option', /<option value="Bus" selected>/.test(known));
ok('  and adds no as-typed duplicate', known.indexOf('(as typed)') === -1);
eq('  selecting exactly one option', (known.match(/ selected/g) || []).length, 1);

const blank = tvMeansOptions('');
ok('a new leg starts on the em dash', /<option value="" selected>/.test(blank));
eq('  and nothing else is selected', (blank.match(/ selected/g) || []).length, 1);

console.log('\n== the client and the server agree on what a kind IS ==');
// A238 — saveTravelReplenishment refuses any kind outside _TRAV_KINDS ("Unknown expense kind ..."),
// so a list that drifts on one side breaks EVERY save on that path. The three _SECURED mirrors are
// pinned the same way for the same reason; this one was not, and it is one edit away from a live
// outage. Read out of the .gs rather than duplicated here, so the test cannot drift either.
{
  const gs = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'FlowAPI.gs'), 'utf8');
  const m = gs.match(/var _TRAV_KINDS\s*=\s*\[([\s\S]*?)\]/);
  ok('_TRAV_KINDS was found in FlowAPI.gs', !!m);
  if (m) {
    const server = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    eq('server _TRAV_KINDS === client TV_KINDS', server, TV_KINDS);
    ok('every means maps to a kind the SERVER will accept',
       TV_MEANS.every(x => server.indexOf(x.kind) >= 0),
       TV_MEANS.filter(x => server.indexOf(x.kind) < 0).map(x => x.v + ' -> ' + x.kind));
  }
}

console.log('\n== the vocabulary itself is well formed ==');
ok('no duplicate labels', new Set(TV_MEANS.map(m => m.v)).size === TV_MEANS.length);
ok('every entry has all three fields',
   TV_MEANS.every(m => typeof m.v === 'string' && m.v && typeof m.kind === 'string' &&
                       typeof m.cert === 'boolean'));
ok('Other exists, so a rep is never stuck', !!tvMeansSpec('Other'));

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
