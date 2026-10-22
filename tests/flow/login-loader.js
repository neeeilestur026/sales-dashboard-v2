/* A359 — the dot-matrix pulse after Sign In.
 *
 * Run:  node tests/flow/login-loader.js
 *
 * Neil, 22 Oct 2026: "in the login page in portal add this dot matrix loading style after press login when logging in",
 * with the look pasted as a config. Pinned here:
 *   1 · the config is his, value for value
 *   2 · the look: a resting dot is red at 14%; the crest is half as big again, white-hot and glowing; rings move outward;
 *       the middle stays calm for the label and the corners fade
 *   3 · start / stop: shown on Sign In and animated; a failure hides it and stops drawing; reduced motion or
 *       "Motion off" draw one still frame; back from the next page (bfcache) it is gone
 *   4 · the page: the overlay is hidden until used, the script runs before the page's own, handleLogin starts it before
 *       asking and stops it on both failure paths but never on success; the styles cover the screen on black
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 300))); } };
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '..', '..', 'dashboard');
const read = (f) => fs.readFileSync(path.join(D, f), 'utf8');
const SRC = read('js/login-loader.js');

/* A page with just enough of a canvas to count what is drawn. */
function page(o) {
  o = o || {};
  const calls = { fill: 0, arc: 0, raf: 0, cancel: 0 }, listeners = {}, rafQ = new Map();
  const ctx = () => ({ setTransform() {}, fillRect() {}, clearRect() {}, beginPath() {}, arc() { calls.arc++; }, rect() {}, fill() { calls.fill++; }, globalAlpha: 1, fillStyle: '' });
  const canvas = () => { const c = ctx(); return { width: 0, height: 0, getContext: () => c }; };
  const label = { textContent: '' };
  const cls = new Set();
  const el = { hidden: true, props: {}, style: { setProperty(k, v) { el.props[k] = v; } }, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    parts: { '.ll-dots': canvas(), '.ll-glow': canvas(), '.ll-label': label }, querySelector(s) { return this.parts[s] || null; } };
  const w = {
    innerWidth: o.w || 1440, innerHeight: o.h || 900, devicePixelRatio: 2,
    matchMedia: (q) => ({ matches: !!o.reduced && /reduce/.test(q) }),
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
  };
  const c = vm.createContext({
    window: w, Math, Array, performance: { now: () => 0 },
    requestAnimationFrame: (f) => { calls.raf++; rafQ.set(calls.raf, f); return calls.raf; },
    cancelAnimationFrame: (id) => { calls.cancel++; rafQ.delete(id); },
    document: { getElementById: (id) => (id === 'loginLoader' ? el : null), documentElement: { getAttribute: (a) => (a === 'data-motion' ? (o.motion || null) : null) } },
  });
  vm.runInContext(SRC, c);
  const flush = () => { const q = [...rafQ.values()]; rafQ.clear(); q.forEach(f => f(16)); };
  return { L: w.LoginLoader, el, label, cls, calls, listeners, flush };
}

sec('1 · the config is Neil\'s');
{
  const PASTED = { pattern: 'pulse', speed: 0.6, wave: 40, sharp: 10, dot: 11.5, gap: 14, round: 1, minOp: 0.14, grow: 0.5,
    color: '#c42a35', peak: '#ff5a3d', glow: 22, glowAmt: 1, glowFrom: 0.25, hot: 0.6, hotColor: '#fff0e6',
    bg: 'black', vignette: 0.6, clear: 0.28, progress: false, loop: false };
  const { L } = page();
  ok('every key and value as pasted, nothing added', JSON.stringify(L.CFG) === JSON.stringify(PASTED), L.CFG);
  ok('  and the file does not draw a progress bar', !/progress\s*\(|\.progress\b(?!\s*,)/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/progress: false/, '')));
}

sec('2 · the look');
{
  const { L } = page(), C = L.CFG;
  const rest = L.shade(0, C), top = L.shade(1, C), warm = L.shade(C.hot, C);
  ok('a resting dot: the base red, at 14%, 11.5 px, no glow', rest.fill === 'rgb(196,42,53)' && rest.alpha === 0.14 && rest.size === 11.5 && rest.glow === 0, rest);
  ok('at "hot" (0.6) it has reached the peak orange', warm.fill === 'rgb(255,90,61)', warm);
  ok('the crest: white-hot, fully opaque, half as big again, full glow', top.fill === 'rgb(255,240,230)' && top.alpha === 1 && top.size === 17.25 && top.glow === 1, top);
  ok('no glow until brightness passes 0.25', L.shade(0.25, C).glow === 0 && L.shade(0.3, C).glow > 0);
  const R = 849;
  const lam = R * C.wave / 100;
  ok('the ring is bright on its crest and dark between crests', Math.abs(L.crest(lam, 0, R, C) - 1) < 1e-9 && L.crest(lam * 1.5, 0, R, C) < 1e-9);
  ok('  and thin: a quarter of the way to the next ring it is under 1%', L.crest(lam * 1.25, 0, R, C) < 0.01);
  const peakAt = (t) => { let best = 0, at = 0; for (let d = lam * 0.5; d < lam * 1.5; d += 0.5) { const v = L.crest(d, t, R, C); if (v > best) { best = v; at = d; } } return at; };
  ok('rings travel outward at speed x spacing per second', Math.abs(peakAt(0.5) - peakAt(0) - C.speed * lam * 0.5) < 1, [peakAt(0), peakAt(0.5)]);
  const half = 450;
  ok('the middle is calm (nothing drawn where the label sits)', L.mask(0, R, half, C) === 0 && L.mask(60, R, half, C) === 0);
  ok('  dots are at full strength halfway out', Math.abs(L.mask(R * 0.3, R, half, C) - 1) < 1e-9);
  ok('  and the corners fade by the vignette (0.6)', Math.abs(L.mask(R, R, half, C) - 0.4) < 1e-9);
  ok('on a phone the calm middle is still 64 px across the label (0.28 x 187 would be 52)', L.mask(34, 447, 187, C) === 0 && Math.abs(L.mask(64, 447, 187, C) - 1) < 1e-9);
}

sec('3 · start and stop');
{
  const p = page();
  p.L.start();
  ok('Sign In shows it and says "Signing in" to screen readers', p.el.hidden === false && p.label.textContent === 'Signing in');
  ok('  the glow blur comes from the config (22 px glow = 11 px blur)', p.el.props['--ll-blur'] === '11px', p.el.props);
  const before = p.calls.fill;
  p.flush();
  ok('  it animates: each frame draws the dots and asks for the next', p.calls.fill > before + 500 && p.calls.raf >= 3 && p.cls.has('on'), p.calls);
  ok('  and redraws on resize', (p.listeners.resize || []).length === 1);
  p.L.stop();
  const after = p.calls.fill;
  p.flush();
  ok('a failed sign-in hides it and stops drawing', p.el.hidden === true && !p.cls.has('on') && p.calls.fill === after && p.label.textContent === '' && (p.listeners.resize || []).length === 0);
  ok('  stop before start is harmless', (() => { try { page().L.stop(); return true; } catch (e) { return false; } })());

  [['reduced motion', { reduced: true }], ['"Motion off"', { motion: 'off' }]].forEach(([name, o]) => {
    const q = page(o);
    q.L.start();
    const drawn = q.calls.fill, asked = q.calls.raf;
    q.flush();
    ok(name + ': one still frame is drawn, and nothing more', drawn > 500 && asked === 1 && q.calls.fill === drawn && q.calls.raf === 1, q.calls);
  });

  const b = page();
  b.L.start();
  (b.listeners.pageshow || []).forEach(f => f({ persisted: false }));
  ok('an ordinary page load leaves a running loader alone', b.el.hidden === false);
  (b.listeners.pageshow || []).forEach(f => f({ persisted: true }));
  ok('back to sign-in from the next page (bfcache): it is gone', b.el.hidden === true);
}

sec('4 · the page');
{
  const H = read('index.html'), JS = read('js/index-inline.js'), CSS = read('css/styles.css');
  ok('the overlay is in the page, hidden, two canvases kept from screen readers and a status line',
    /<div id="loginLoader" class="login-loader" hidden>\s*<canvas class="ll-dots" aria-hidden="true"><\/canvas>\s*<canvas class="ll-glow" aria-hidden="true"><\/canvas>\s*<p class="ll-label" role="status"><\/p>\s*<\/div>/.test(H));
  ok('the loader loads after auth.js and before the page\'s own script; no inline script is left',
    /<script src="js\/auth\.js"><\/script>\s*<script src="js\/login-loader\.js"><\/script>\s*<script src="js\/index-inline\.js"><\/script>/.test(H) && !/<script>/.test(H));
  ok('handleLogin starts it after the button changes and before asking the server', /loginSpinner\.style\.display = 'block';\s*loader\.start\(\);\s*try \{\s*const result = await apiLogin/.test(JS));
  const success = (JS.match(/if \(result\.success\) \{([\s\S]*?)\} else \{/) || [])[1] || '';
  ok('  on success it stays up while the next page opens', /window\.location\.href = flowAfterLogin\(result\.role\)/.test(success) && !/loader\.stop/.test(success));
  ok('  a wrong password and a lost connection both stop it before the error shows',
    /\} else \{\s*loader\.stop\(\);\s*errorText\.textContent = result\.message/.test(JS) && /catch \(err\) \{\s*loader\.stop\(\);\s*errorText\.textContent = 'Unable to connect/.test(JS));
  ok('  and without the loader script the page still signs in', /const loader = window\.LoginLoader \|\| \{ start\(\) \{\}, stop\(\) \{\} \};/.test(JS));
  const rule = (sel) => ((CSS.match(new RegExp('\\n' + sel.replace(/[.[\]()]/g, '\\$&') + ' \\{([^}]*)\\}')) || [])[1] || '');
  const box = rule('.login-loader');
  ok('styles: it covers the whole screen above everything, on the black token', /position: fixed; inset: 0; z-index: 3000; background: var\(--hx-loader-bg\)/.test(box) && /--hx-loader-bg:#000;/.test(CSS), box);
  ok('  sets no display, so "hidden" really hides it', !/display\s*:/.test(box));
  ok('  the glow canvas is blurred by the config and screened over the dots', /filter: blur\(var\(--ll-blur, 11px\)\); mix-blend-mode: screen;/.test(rule('.login-loader .ll-glow')));
  ok('  no fade under reduced motion or "Motion off"', /@media \(prefers-reduced-motion: reduce\) \{ \.login-loader \{ transition: none; \} \}/.test(CSS) && /html\[data-motion="off"\] \.login-loader \{ transition: none; \}/.test(CSS));
}

console.log(FAIL ? `\nFAIL — ${FAIL} of ${N}\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
