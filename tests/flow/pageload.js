/* Run a REAL dashboard page's scripts in Node, with a stub DOM, and record every backend call.
 *
 * The point is that a missed call site shows up as a NAME IN A LIST rather than as a silent leak in
 * production. Role gating is the main thing this proves: "sales sees nothing" is only true if no
 * fetch was attempted, and only the real page script can tell you that.
 *
 * Two things it gets right that a naive stub does not:
 *   1. Elements start at the display the MARKUP gives them. Without that, "hidden for this role"
 *      cannot be told apart from "hidden in the HTML and never shown".
 *   2. boot() is ASYNC. Pages await flowVersionAtLeast before fetching anything, so a synchronous
 *      call returns before a single backend call has been recorded — and the suite passes for the
 *      wrong reason.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const D = path.join(__dirname, '..', '..', 'dashboard') + '/';

function page(jsFiles, htmlFile, session, opts) {
  opts = opts || {};
  const calls = [];
  const params = [];   // A280 — {action, params} per backend call
  const els = {};
  const html = fs.readFileSync(D + htmlFile, 'utf8');

  (html.match(/<[^>]*\sid="[^"]+"[^>]*>/g) || []).forEach(tag => {
    const id = tag.match(/\sid="([^"]+)"/)[1];
    const hidden = /style="[^"]*display\s*:\s*none/.test(tag);
    els[id] = { id, textContent: '', innerHTML: '', innerText: '', value: '', title: '', checked: false,
                disabled: false, style: { display: hidden ? 'none' : '' },
                classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                getAttribute: () => null, setAttribute: () => {}, addEventListener: () => {},
                scrollIntoView: () => {}, querySelector: () => null, querySelectorAll: () => [],
                /* A280 — a page that BUILDS something needs these. They landed the moment the create
                   form started being built for a role that had never reached it, which is the point:
                   a stub that cannot append is a stub that can only test pages doing nothing. */
                appendChild() {}, removeChild() {}, remove() {}, insertAdjacentHTML() {},
                closest: () => null, focus() {}, click() {}, children: [], rows: [], options: [],
                dataset: {} };
  });

  const ctx = {
    console,
    document: {
      getElementById: id => els[id] || null,
      /* A280 — BY EVENT NAME. auth.js registers a module-level 'click' listener, so an unguarded
         capture makes THAT the page's boot and the suite tests nothing. */
      addEventListener: (e, f) => { if (e === 'DOMContentLoaded') ctx.__boot = f; },
      querySelectorAll: () => [], querySelector: () => null,
      createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                              innerHTML: '', textContent: '', value: '', appendChild() {}, removeChild() {}, remove() {},
                              insertAdjacentHTML() {}, setAttribute() {}, getAttribute: () => null,
                              addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }),
      body: { innerHTML: '', appendChild() {} }
    },
    /* Reads ctx.__session on EVERY call, not the value captured at construction. A suite that renders
       three role navbars in a row from one context would otherwise get the first role's markup three
       times and pass for the wrong reason. */
    localStorage: { getItem: () => (ctx.__session ? JSON.stringify(ctx.__session) : null),
                    setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 },
    location: { search: '', href: '' },
    URLSearchParams: function () { return { get: () => null }; },
    alert: () => {}, confirm: () => true, prompt: () => null,
    setTimeout: (f) => { if (typeof f === 'function') f(); },
    clearTimeout: () => {},
    navigator: {}, FileReader: function () {},
    fetch: () => Promise.reject(new Error('no network'))
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(D + 'js/flow-api.js', 'utf8'), ctx);

  vm.runInContext(
    /* A280 — the calls list records PARAMS too. "sales sees only their own" is a claim about the
       scope a page asked for, and until now the harness recorded only the action name, so the one
       thing worth proving was the one thing it could not say. __calls stays an array of strings so
       every existing assertion keeps working; __params is the parallel record. */
    'fetchFlow = function(a,p){ __calls.push(a); __params.push({action:a, params:p||{}}); return Promise.resolve({success:true,data:(__data&&__data[a])||[]}); };' +
    'postFlow  = function(a,p){ __calls.push("POST:"+a); __params.push({action:a, params:p||{}}); return Promise.resolve({success:true,data:(__data&&__data[a])||[]}); };' +
    'flowVersionAtLeast = function(){ return Promise.resolve(true); };' +
    '_flowConfigured = function(){ return true; };' +
    'requireAuth = function(){ return __session; };' +
    'requireDirector = function(){ return __session; };' +
    'requireSales = function(){ return __session; };' +
    'requireOversight = function(){ return __session; };' +
    'requireTravelAccess = function(){ return __session; };' +
    'requireQuotationAccess = function(){ return __session; };' +
    'requirePricingFlowAccess = function(){ return __session; };' +
    'renderNavbar = function(){}; renderFlowNav = function(){};', ctx);

  ctx.__calls = calls; ctx.__params = params; ctx.__session = session; ctx.__data = opts.data || {};

  /* A280 — opts.withAuth loads the REAL dashboard/js/auth.js, for pages that now call a predicate
     defined there (flowOwnsRecordsOnly / flowIsOversightRole). Opt-in, because auth.js also defines
     the require* guards and would replace the stubs above — which is exactly what a role-scope suite
     wants and exactly what an existing suite does not. It has two module-level side effects, a click
     listener and a 2s notification poll; the listener is handled by the event-name guard above, and
     the poll is discarded by clearing the call lists immediately after. */
  if (opts.withAuth) {
    vm.runInContext(fs.readFileSync(D + 'js/auth.js', 'utf8'), ctx);
    vm.runInContext('renderNavbar = function(){}; renderFlowNav = function(){};', ctx);
    calls.length = 0; params.length = 0;
  }

  (jsFiles || []).forEach(f => vm.runInContext(fs.readFileSync(D + f, 'utf8'), ctx));

  return {
    ctx, els, calls, params,
    /* A281 — evaluate an expression INSIDE the page's own scope. A page script's module-level
       `let` bindings are not properties of the context object, so a suite that wants to drive one
       function directly (rather than through boot()) cannot reach them from the outside. */
    run: (code) => vm.runInContext(code, ctx),
    /** The params a given action was called with, or null. */
    paramsFor: (action) => (params.filter(x => x.action === action)[0] || {}).params || null,
    boot: async () => {
      if (ctx.__boot) await ctx.__boot();
      await new Promise(r => setImmediate(r));      // let the awaited loads actually run
    }
  };
}

/** The role list the BROWSER half carries, read from source rather than duplicated in a test. */
function commissionRoster() {
  const js = fs.readFileSync(D + 'js/flow-api.js', 'utf8');
  return JSON.parse(js.match(/const FLOW_COMMISSIONS_ROLES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
}

module.exports = { page, commissionRoster, D };
