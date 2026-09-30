/* A307 — the Code.gs dispatch tables against the browser's own list of mutations.
 *
 * Run:  node tests/audit/codegs-dispatch.js
 *
 * Code.gs answers doGet and doPost with two switch statements. The hardened Code.gs (AS-1) serves
 * reads over GET only and refuses mutations there, which is safe only if the browser already POSTs
 * every mutation — and api.js decides that with NO_CACHE_ACTIONS (a mutation goes through
 * _postMutation, a read through a GET). So the invariant that must hold BEFORE that file is pasted:
 * every action that exists only in doPost is in NO_CACHE_ACTIONS. The reverse (a doGet case with a
 * mutating verb) is reported as the list AS-1 removes. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CODE = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'dashboard', 'js', 'api.js'), 'utf8');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 600))); } };

function body(fnName) {
  const m = CODE.match(new RegExp('function ' + fnName + '\\(e\\) \\{'));
  if (!m) return '';
  let i = m.index + m[0].length, depth = 1;
  while (depth && i < CODE.length) { if (CODE[i] === '{') depth++; else if (CODE[i] === '}') depth--; i++; }
  return CODE.slice(m.index, i);
}
const cases = (src) => Array.from(new Set((src.match(/case '([A-Za-z_]\w*)':/g) || []).map(s => s.slice(6, -2))));
const GET = cases(body('doGet')), POST = cases(body('doPost'));
const both = GET.filter(a => POST.includes(a));
const postOnly = POST.filter(a => !GET.includes(a));
/* A308: EVALUATE the literal rather than scraping quoted names out of it — a '//' comment dropped inside the
   line (A307) hid every name after it from the browser while the scrape still counted them. */
const vm = require('vm');
const noCacheSrc = (API.match(/const NO_CACHE_ACTIONS = [\s\S]*?\];/) || [''])[0].replace('const ', 'var ');
const noCacheCtx = {}; vm.createContext(noCacheCtx); vm.runInContext(noCacheSrc, noCacheCtx);
const noCache = new Set(noCacheCtx.NO_CACHE_ACTIONS || []);
const MUTATING = /^(add|create|save|submit|update|set|delete|remove|mark|approve|reject|reset|change|archive|backfill|migrate|decide|link|finalize|revise|send|log|clear|disconnect|record|assign|upload|import|reopen|close|void|adjust|register|dismiss|toggle|move|cancel|issue|release|apply)/i;

console.log(`doGet: ${GET.length} cases · doPost: ${POST.length} cases · in both: ${both.length} · doPost only: ${postOnly.length} · NO_CACHE_ACTIONS: ${noCache.size}`);
ok('the two switches were found and parsed', GET.length > 50 && POST.length > 50);
ok('NO_CACHE_ACTIONS evaluates to the full list (more than 100 names)', noCache.size > 100, noCache.size);
/* Only what the BROWSER sends matters here: api.js chooses GET or POST by NO_CACHE_ACTIONS alone.
   Flask's own calls to Code.gs always POST (blueprints/_upstream.py). */
const browser = new Set((API.match(/action:\s*'([A-Za-z_]\w*)'/g) || []).map(s => s.match(/'([^']+)'/)[1]));
const postOnlyBrowser = postOnly.filter(a => browser.has(a));
const missing = postOnlyBrowser.filter(a => !noCache.has(a));
ok('every doPost-only action the browser sends is in NO_CACHE_ACTIONS (so api.js POSTs it)', missing.length === 0, missing);
const unknown = [...browser].filter(a => !GET.includes(a) && !POST.includes(a));
ok('every action api.js names exists in Code.gs', unknown.length === 0, unknown);
const getMutBrowser = GET.filter(a => browser.has(a) && !noCache.has(a) && MUTATING.test(a));
ok('no mutation the browser sends goes over GET (each mutating doGet case the browser uses is in NO_CACHE_ACTIONS)', getMutBrowser.length === 0, getMutBrowser);
const getMut = GET.filter(a => MUTATING.test(a));
console.log(`  metric: ${getMut.length} doGet cases carry a mutating verb — the list AS-1 removes from doGet:`);
console.log('     ' + getMut.join(', '));
const bothMut = both.filter(a => MUTATING.test(a));
console.log(`  metric: ${bothMut.length} of them are also in doPost (the browser can already POST them)`);
const bothMutNotNoCache = bothMut.filter(a => browser.has(a) && !noCache.has(a));
ok('  every such mutation the browser sends is in NO_CACHE_ACTIONS', bothMutNotNoCache.length === 0, bothMutNotNoCache);
const getOnlyMut = getMut.filter(a => !POST.includes(a));
console.log(`  metric: ${getOnlyMut.length} mutating actions exist ONLY in doGet (AS-1 must add them to doPost before removing them from doGet):`);
console.log('     ' + (getOnlyMut.join(', ') || '(none)'));

console.log('\n' + N + ' checks, ' + (FAIL ? FAIL + ' FAILURE(S)' : 'all ok'));
process.exit(FAIL ? 1 : 0);
