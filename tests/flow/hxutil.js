/* A302 — the shared helpers for a test context.
 *
 * Every page script now delegates its escape, number, token, date-pill and badge helpers to the
 * hx-util block in dashboard/js/api.js, which is on every page before any page script. A test that
 * evaluates a page script in its own vm context therefore needs that block too; loading all of
 * api.js is not an option (it polls). `load(ctx)` evaluates only the block between the markers.
 *
 *   const hx = require('./hxutil');   hx.load(ctx);
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API = path.join(__dirname, '..', '..', 'dashboard', 'js', 'api.js');

function src() {
  const s = fs.readFileSync(API, 'utf8');
  const a = s.indexOf('/* ─── hx-util (A302)'), b = s.indexOf('/* ─── end hx-util');
  if (a < 0 || b < 0) throw new Error('hxutil: the hx-util block was not found in js/api.js');
  return s.slice(a, b);
}

function load(ctx) {
  vm.runInContext(src(), ctx);
  return ctx;
}

module.exports = { src, load };
