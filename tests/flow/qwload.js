/* A215 — load the two browser modules the worklist needs into one Node context.
 *
 * flow-api.js and quotation-worklist.js are plain browser scripts with no module system: they share
 * a global scope in the page and the worklist calls flowFollowUp / flowQuotationBucket / flowDate
 * directly. Evaluating both in ONE vm context reproduces exactly that, so the test exercises the real
 * wiring rather than a set of stubs that could drift from it.
 *
 * Neither file does anything at load time beyond declaring functions (checked), so the browser stubs
 * below only have to exist, not work.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DASH = path.resolve(__dirname, '../../dashboard/js');

/** @param {string} [today] pin 'yyyy-MM-dd' so the tests do not drift with the calendar. */
function load(today) {
  const ctx = {
    console: console,
    // Present but inert: nothing under test performs I/O.
    fetch: () => Promise.reject(new Error('no network in the table test')),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null, querySelector: () => null,
                querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({}) },
    window: {}, navigator: { userAgent: 'node' }, location: { href: '', pathname: '/' },
    setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date, Math: Math, JSON: JSON
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  vm.runInContext(fs.readFileSync(path.join(DASH, 'flow-api.js'), 'utf8'), ctx, { filename: 'flow-api.js' });
  vm.runInContext(fs.readFileSync(path.join(DASH, 'quotation-worklist.js'), 'utf8'), ctx,
                  { filename: 'quotation-worklist.js' });

  /* `const` at the top level of a vm script lives in LEXICAL scope, not on the context object — the
     same trap gasload.js documents for FlowAPI.gs. Function declarations land on the context, so the
     handlers are reachable, but the constant tables are not. Publish the ones a test needs to assert
     against rather than changing the module to `var` to suit its harness. */
  vm.runInContext('this.QW_STEPS = QW_STEPS; this.QW_GROUPS = QW_GROUPS;' +
                  'this.FLOW_FOLLOWUP_DEFAULTS = FLOW_FOLLOWUP_DEFAULTS;', ctx);

  /* Pin "today". flowToday() is what every age in the worklist is measured from, so a floating
     clock would make these assertions quietly seasonal. */
  if (today) vm.runInContext('flowToday = function () { return ' + JSON.stringify(today) + '; };', ctx);
  return ctx;
}

module.exports = { load };
