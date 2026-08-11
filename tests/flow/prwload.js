/* A226 — load the three browser modules pr-worklist.js needs into one Node context.
 *
 * Same technique and the same reasons as qwload.js: these are plain browser scripts with no module
 * system, sharing a global scope in the page. pr-worklist.js calls flowDate / flowDaysBetween /
 * flowQuotationBucket from flow-api.js and qwOverdue / qwAgo from quotation-worklist.js DIRECTLY,
 * so evaluating all three in ONE vm context exercises the real wiring rather than stubs that could
 * drift from it. The qwOverdue/qwAgo reuse is the whole point — a second copy would drift in wording
 * and both lists appear on one screen.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DASH = path.resolve(__dirname, '../../dashboard/js');

/** @param {string} [today] pin 'yyyy-MM-dd' so the assertions do not drift with the calendar. */
function load(today) {
  const ctx = {
    console: console,
    fetch: () => Promise.reject(new Error('no network in the table test')),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null, querySelector: () => null,
                querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({}) },
    window: {}, navigator: { userAgent: 'node' }, location: { href: '', pathname: '/' },
    setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date, Math: Math, JSON: JSON,
    Object: Object, String: String, Number: Number, Array: Array
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  ['flow-api.js', 'quotation-worklist.js', 'pr-worklist.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(DASH, f), 'utf8'), ctx, { filename: f });
  });

  /* `const` at the top level of a vm script lives in LEXICAL scope, not on the context object — the
     trap gasload.js and qwload.js both document. Function declarations land on the context, so the
     engines are reachable, but the constant tables are not. Publish the ones the tests assert
     against rather than changing the module to `var` to suit its harness. */
  vm.runInContext('this.PRW_STEPS = PRW_STEPS; this.PRW_GROUPS = PRW_GROUPS;' +
                  'this.PRW_DEFAULTS = PRW_DEFAULTS; this.PRW_STAGE = PRW_STAGE;' +
                  'this.PRW_LANES = PRW_LANES; this.PRW_LANE_LABEL = PRW_LANE_LABEL;' +
                  'this.QW_STEPS = QW_STEPS;', ctx);

  /* Pin "today". Every age in the worklist is measured from flowToday(), so a floating clock would
     make these assertions quietly seasonal. */
  if (today) vm.runInContext('flowToday = function () { return ' + JSON.stringify(today) + '; };', ctx);
  return ctx;
}

module.exports = { load };
