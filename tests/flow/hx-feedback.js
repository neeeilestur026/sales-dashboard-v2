/* A375 — toasts, the snackbar, alert() as a toast (js/hx-feedback.js, css/hx-feedback.css, loaded by js/theme.js) and
 * the bottom sheets for the rest of the dialogs (css/apple.css, js/apple.js).
 *
 * Run:  node tests/flow/hx-feedback.js
 *
 * Neil, 26 Oct 2026: "add these — toast notifications, snackbar, bottom sheet — across all the whole systems pages, only
 * the applicable ones … use apple design skill". The real file runs over a small stand-in DOM (enough for what it
 * builds), with the clock in the suite's hands:
 *   1 · what a message says (its tone) and how long it stays
 *   2 · toasts: built, announced, the same words twice = one toast with a count, at most three, they leave in time
 *   3 · the snackbar: one at a time, its action runs once, it leaves in time (and a sticky one does not)
 *   4 · alert() is a toast; confirm() and prompt() are left alone; a toast carried over a page change; offline
 *   5 · flowMsg raises a toast only when its box is out of sight
 *   6 · the site rules: theme.js loads it on every page; the sheets; tokens only; reduced motion and transparency
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let FAIL = 0, N = 0;
const ok = (l, c, e) => { N++; if (c) console.log('  ok   ' + l); else { FAIL++; console.log('  FAIL ' + l + (e === undefined ? '' : '\n     ' + JSON.stringify(e).slice(0, 400))); } };
const eq = (l, got, want) => ok(l + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), { got, want });
const sec = (t) => console.log('\n== ' + t + ' ==');
const D = path.join(__dirname, '../../dashboard/');
const read = (f) => fs.readFileSync(D + f, 'utf8');

/* ── a stand-in DOM: elements, classes, attributes, children, events; innerHTML makes one child per class="…" ── */
function El(tag) {
  const el = { tagName: String(tag || 'div').toUpperCase(), className: '', attrs: {}, children: [], parentNode: null, style: {}, listeners: {}, dataset: {}, _text: '', disabled: false, hidden: false };
  el.classList = { add: (c) => { if (!el.classList.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove: (c) => { el.className = el.className.split(' ').filter(x => x !== c).join(' '); },
                   contains: (c) => el.className.split(' ').indexOf(c) >= 0, toggle: () => {} };
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  el.appendChild = (c) => { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = el; el.children.push(c); return c; };
  el.insertBefore = (c, ref) => { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = el; const i = el.children.indexOf(ref); if (i < 0) el.children.push(c); else el.children.splice(i, 0, c); return c; };
  el.removeChild = (c) => { el.children = el.children.filter(x => x !== c); c.parentNode = null; return c; };
  el.contains = (c) => { for (let x = c; x; x = x.parentNode) if (x === el) return true; return false; };
  el.addEventListener = (t, f) => { (el.listeners[t] = el.listeners[t] || []).push(f); };
  el.fire = (t, ev) => (el.listeners[t] || []).forEach(f => f(Object.assign({ target: el, button: 0, pointerId: 1, preventDefault() {} }, ev || {})));
  el.click = () => el.fire('click');
  el.closest = () => null;
  const all = () => el.children.reduce((a, c) => a.concat([c], c.querySelectorAll('*')), []);
  el.querySelectorAll = (sel) => { const m = /^\.([\w-]+)$/.exec(sel); return sel === '*' ? all() : m ? all().filter(x => x.classList.contains(m[1])) : []; };
  el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
  Object.defineProperty(el, 'textContent', { get: () => el._text, set: (v) => { el._text = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get: () => el._html || '', set: (v) => {
    el._html = String(v); el.children = [];
    (el._html.match(/<(\w+)[^>]*class="([^"]+)"[^>]*>/g) || []).forEach(tag => {
      const t = /<(\w+)[^>]*class="([^"]+)"/.exec(tag), c = El(t[1]); c.className = t[2];
      if (/\shidden(\s|>)/.test(tag)) c.hidden = true;
      const txt = new RegExp('class="' + t[2] + '"[^>]*>([^<]*)<').exec(el._html); if (txt) c._text = txt[1];
      el.appendChild(c);
    });
  } });
  Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
  el.offsetHeight = 56;
  return el;
}
function world(o) {
  o = o || {};
  let t = 0; const timers = [];
  const store = Object.assign({}, o.session || {});
  const body = El('body'), head = El('head'), docEl = El('html'), winL = {};
  const doc = { body, head, documentElement: docEl, readyState: 'complete', createElement: El, addEventListener() {}, getElementById: () => null };
  const ctx = { console, JSON, Math, Date: { now: () => t }, String, Number, Array, Object, RegExp,
    document: doc, sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    setTimeout: (f, ms) => { timers.push({ f, at: t + (ms || 0), id: timers.length + 1 }); return timers.length; },
    clearTimeout: (id) => { const x = timers.find(y => y.id === id); if (x) x.f = null; },
    getComputedStyle: () => ({ transform: 'none' }), matchMedia: () => ({ matches: !!o.reduced }),
    addEventListener: (k, f) => { (winL[k] = winL[k] || []).push(f); } };
  ctx.window = ctx;
  ctx.alert = o.noAlert ? undefined : function nativeAlert() { ctx.__native = (ctx.__native || 0) + 1; };
  ctx.confirm = function nativeConfirm() { return true; }; ctx.prompt = function nativePrompt() { return 'x'; };
  vm.createContext(ctx);
  vm.runInContext(read('js/hx-feedback.js'), ctx, { filename: 'hx-feedback.js' });
  /* the clock walks through the timers in order, so one a timer starts (a toast's 240 ms leaving) runs too */
  const tick = (ms) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter(x => x.f && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      t = Math.max(t, next.at); const f = next.f; next.f = null; f();
    }
    t = end;
  };
  return { ctx, body, store, winL, tick,
           toasts: () => { const s = body.querySelector('.hx-toasts'); return s ? s.children.filter(c => c.classList.contains('hx-toast')) : []; },
           snacks: () => { const s = body.querySelector('.hx-toasts'); return s ? s.children.filter(c => c.classList.contains('hx-snack')) : []; },
           dock: () => { const s = body.querySelector('.hx-toasts'); return s ? s.children.map(c => c.className) : []; } };
}

sec('1 · what a message says, and how long it stays');
{
  const w = world(), tone = (s) => w.ctx.hxFeedback.tone(s);
  eq('the portal\'s own alerts, by their words', [
    tone('Error: Network request failed'), tone('Failed to update: Unknown error'), tone('Saved, but the email could not be sent'), tone('Could not change that cutoff.'),
    tone('Supplier added.'), tone('Quotation sent to the client.'), tone('Copied!'),
    tone('Please enter a valid email address.'), tone('Enter the pesos the bank debited — the books need what actually left the account.'), tone('Load a period first.'), tone('No data to export.'),
    tone('All selected items must be from the same PR.'), tone('The report for Monday 26 Oct')],
    ['error', 'error', 'error', 'error', 'ok', 'ok', 'ok', 'warn', 'warn', 'warn', 'warn', 'warn', 'info']);
  const L = w.ctx.hxFeedback.lasts;
  ok('done is quick; something to read stays as long as it takes, 6 to 14 seconds', L('Saved.', 'ok') < 3200 && L('x'.repeat(40), 'error') === 6000 && L('x'.repeat(200), 'warn') === 13000 && L('x'.repeat(900), 'error') === 14000);
}

sec('2 · toasts');
{
  const w = world();
  w.ctx.hxToast('Saved.');
  const box = w.body.querySelector('.hx-toasts');
  ok('the first toast makes one notifications region', box && box.getAttribute('role') === 'region' && box.getAttribute('aria-label') === 'Notifications');
  const t1 = w.toasts()[0];
  ok('  a done toast: polite, its outlined icon tile, the title Success over its words, a dismiss button', t1.className === 'hx-toast hx-ok' && t1.getAttribute('role') === 'status' && t1.getAttribute('aria-live') === 'polite' &&
     /<span class="hx-ticon"><svg[^>]*><rect /.test(t1.innerHTML) && t1.querySelector('.hx-ttitle').textContent === 'Success' && t1.querySelector('.hx-ttext').textContent === 'Saved.' && /aria-label="Dismiss"/.test(t1.innerHTML));
  w.ctx.hxToast('Failed: <b>the sheet</b>');
  const t2 = w.toasts()[w.toasts().length - 1];
  ok('  an error is assertive, titled Error, the newest nearest the corner, and its words are text (no markup)', t2.className === 'hx-toast hx-error' && t2.getAttribute('role') === 'alert' &&
     t2.querySelector('.hx-ttitle').textContent === 'Error' && /Failed: &lt;b&gt;the sheet&lt;\/b&gt;/.test(t2.innerHTML));
  {
    const w2 = world();
    w2.ctx.alert('Error: the sheet is busy');
    ok('  "Error: …" under the title Error says just what went wrong', w2.toasts()[0].querySelector('.hx-ttext').textContent === 'the sheet is busy');
    w2.ctx.hxToast('Note this.', { tone: 'info', title: 'Heads up' });
    ok('  a title can be given', w2.toasts()[1].querySelector('.hx-ttitle').textContent === 'Heads up');
  }
  w.ctx.hxToast('Saved.');
  ok('the same words again: still one toast, now with a count', w.toasts().length === 2 && t1.querySelector('.hx-tcount').textContent === '×2' && t1.querySelector('.hx-tcount').hidden === false);
  w.ctx.hxToast('One.', { tone: 'info' }); w.ctx.hxToast('Two.', { tone: 'info' });
  w.tick(300);
  ok('at most three are up; the oldest goes first', w.toasts().length === 3 && w.toasts().every(x => x !== t1) && w.toasts()[2].querySelector('.hx-ttext').textContent === 'Two.');
  w.tick(20000);
  ok('they leave in time', w.toasts().length === 0);
  const h = world();
  const e = h.ctx.hxToast('Could not save the client.');
  h.tick(5000);
  ok('an error stays longer than a done toast (still up after 5 s), and a handle closes it', h.toasts().length === 1 && (e.close(), h.tick(300), h.toasts().length === 0));
  const m = world();
  m.ctx.hxToast('Saved.'); const el = m.toasts()[0];
  el.fire('mouseenter'); m.tick(60000);
  ok('hovering holds a toast', m.toasts().length === 1);
  el.fire('mouseleave'); m.tick(4000);
  ok('  and it goes once let go', m.toasts().length === 0);
  const r = world({ reduced: true });
  r.ctx.hxToast('Saved.'); r.toasts()[0].querySelector('.hx-tclose').click();
  ok('under reduced motion a dismissed toast simply goes (no slide)', r.toasts().length === 0);
}

sec('3 · the snackbar');
{
  const w = world();
  let undone = 0;
  w.ctx.hxSnackbar('Archived Yale Hardware.', { action: 'Undo', onAction: () => { undone++; } });
  const s = w.snacks()[0];
  ok('one dark bar in the corner, polite, a solid icon, its action and a dismiss button', w.snacks().length === 1 && s.className === 'hx-snack hx-ok' && s.getAttribute('role') === 'status' && !!s.querySelector('.hx-sicon') &&
     s.querySelector('.hx-stext').textContent === 'Archived Yale Hardware.' && s.querySelector('.hx-sact').textContent === 'Undo' && !!s.querySelector('.hx-sclose'));
  w.ctx.hxToast('Saved.');
  eq('  toasts stack above it, in the same corner', w.dock(), ['hx-toast hx-ok', 'hx-snack hx-ok']);
  s.querySelector('.hx-sact').click(); s.querySelector('.hx-sact').click();
  w.tick(300);
  ok('  its action runs once and the bar leaves', undone === 1 && w.snacks().length === 0);
  w.ctx.hxSnackbar('First.'); w.ctx.hxSnackbar('Second.', { action: 'View', onAction() {} });
  ok('a new snackbar takes the old one\'s place', w.snacks().length === 1 && w.snacks()[0].querySelector('.hx-stext').textContent === 'Second.');
  w.tick(8500);
  ok('  and leaves in time (8 s with an action)', w.snacks().length === 0);
  w.ctx.hxSnackbar('Stays.', { sticky: true }); w.tick(600000);
  ok('a sticky one stays', w.snacks().length === 1);
}

sec('4 · alert(), confirm(), prompt(), a page change, offline');
{
  const w = world();
  w.ctx.alert('Error: ' + 'Network request failed');
  ok('alert() is a toast now, its tone from its words; nothing stops the page', w.toasts().length === 1 && w.toasts()[0].className === 'hx-toast hx-error' && !w.ctx.__native);
  ok('  the browser\'s own alert is kept as hxNativeAlert', typeof w.ctx.hxNativeAlert === 'function');
  ok('confirm() and prompt() are the browser\'s own still (the page waits for their answer)', w.ctx.confirm.name === 'nativeConfirm' && w.ctx.prompt.name === 'nativePrompt');
  w.ctx.alert(''); w.ctx.alert(undefined);
  ok('  an empty alert shows nothing', w.toasts().length === 1);
  (w.winL.pagehide || []).forEach(f => f());
  const carried = JSON.parse(w.store.hx_toast_carry || '[]');
  ok('a toast up when the page goes is carried to the next page', carried.length === 1 && carried[0].tone === 'error');
  const next = world({ session: { hx_toast_carry: w.store.hx_toast_carry } });
  ok('  and shown there, once', next.toasts().length === 1 && !next.store.hx_toast_carry);
  const o = world();
  (o.winL.offline || []).forEach(f => f());
  ok('offline: a snackbar that stays', o.snacks().length === 1 && /offline/.test(o.snacks()[0].querySelector('.hx-stext').textContent));
  o.tick(600000);
  (o.winL.online || []).forEach(f => f());
  o.tick(300);
  ok('  back online: it goes, and a toast says so', o.snacks().length === 0 && o.toasts().length === 1 && o.toasts()[0].className === 'hx-toast hx-ok');
}

sec('5 · flowMsg: a toast only when its box is out of sight');
{
  const ctx = { console, JSON, Math, Date, Promise, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {}, location: { search: '' }, innerHeight: 800 };
  const box = (top) => ({ style: {}, textContent: '', classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ top, bottom: top + 40, height: 40 }) });
  const els = { onScreen: box(300), above: box(-200), below: box(1200) };
  ctx.document = { getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
  ctx.window = ctx;
  const shown = [];
  ctx.hxToast = (t, o) => shown.push([t, o.tone]);
  ctx.hxFeedback = { tone: (t) => /could not/i.test(t) ? 'error' : 'warn' };
  vm.createContext(ctx); vm.runInContext(read('js/flow-api.js'), ctx);
  vm.runInContext("flowMsg('onScreen', 'Saved.', true); flowMsg('above', 'Saved.', true); flowMsg('below', 'Could not save.', false); flowMsg('below', 'Enter a plant site.', false);", ctx);
  eq('in sight: the box only; out of sight: the box and a toast (done, error, or something to do)', shown, [['Saved.', 'ok'], ['Could not save.', 'error'], ['Enter a plant site.', 'warn']]);
  ok('  the box still says it either way', els.onScreen.textContent === 'Saved.' && els.below.textContent === 'Enter a plant site.');
}

sec('6 · the site rules');
{
  /* theme.js on a page: it appends the stylesheet and the script once */
  const appended = [];
  const el = (tag) => ({ tagName: tag, style: {}, setAttribute() {}, appendChild() {} });
  const ctx = { console, JSON, Math, Date, window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hostname: 'x', pathname: '/x.html', search: '' }, URLSearchParams: function () { return { get: () => null }; }, matchMedia: () => ({ matches: false }), setTimeout: () => 0,
    document: { documentElement: { setAttribute() {}, getAttribute: () => null, classList: { add() {}, remove() {} } }, body: { setAttribute() {}, classList: { add() {}, remove() {} } },
      head: { appendChild: (n) => appended.push(n) }, createElement: el, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('js/theme.js'), ctx);
  eq('theme.js (on 125 pages) adds css/hx-feedback.css and js/hx-feedback.js, once each', [appended.filter(n => n.href === 'css/hx-feedback.css').length, appended.filter(n => n.src === 'js/hx-feedback.js').length], [1, 1]);
  const pages = fs.readdirSync(D).filter(f => /\.html$/.test(f)), direct = pages.filter(f => /hx-feedback\.(js|css)/.test(read(f)));
  ok('no page links them itself', direct.length === 0, direct);
  const CSS = read('css/hx-feedback.css'), JS = read('js/hx-feedback.js'), APPLE = read('css/apple.css'), AJS = read('js/apple.js');
  ok('the stylesheet uses tokens only (no hex, rgb or named colours)', !/#[0-9a-fA-F]{3,6}\b|rgba?\(|\b(white|black|red|green|blue)\b\s*[;}]/.test(CSS));
  ok('  no hex colour, emoji or inline style in the script', !/#[0-9a-fA-F]{3,6}\b/.test(JS) && !/[\u{1F300}-\u{1FAFF}]/u.test(JS) && !/style="/.test(JS));
  ok('A376: the soft tinted card (pale tone over the page\'s card, the tone\'s line, coloured title), bottom right', /background: linear-gradient\(var\(--t-soft\), var\(--t-soft\)\), var\(--hx-card\); border: 1px solid var\(--t-line\)/.test(CSS) &&
     /\.hx-toast\.hx-ok \{ --t-c: var\(--hx-ok\); --t-soft: var\(--hx-ok-soft\); --t-line: var\(--hx-ok-line\); \}/.test(CSS) && /\.hx-toasts \{ position: fixed; right: max\(1\.25rem, env\(safe-area-inset-right\)\); bottom: max\(1\.25rem/.test(CSS));
  ok('  the dark snackbar with its solid icon disc', /\.hx-snack \{[^}]*background: var\(--hx-ink\); color: var\(--hx-card\)/.test(CSS) && /\.hx-sicon \{[^}]*border-radius: 50%; background: var\(--s-c\)/.test(CSS));
  ok('apple-design: press feedback (.97 over 100ms), the snackbar glass under the Apple look, in and out the same way (from the right)', /:active[^{]*\{ transform: scale\(\.97\); \}/.test(CSS) && /transition: transform 100ms ease-out/.test(CSS) &&
     /\[data-look="apple"\] \.hx-snack \{ background: color-mix\(in srgb, var\(--hx-ink\) 92%, transparent\); -webkit-backdrop-filter: var\(--a-blur\)/.test(CSS) &&
     /@keyframes hx-t-in \{ from \{ opacity: 0; transform: translate3d\(28px, 0, 0\)/.test(CSS) && /@keyframes hx-t-out \{[^}]*\} to \{ opacity: 0; transform: translate3d\(28px, 0, 0\)/.test(CSS));
  ok('  a cross-fade under reduced motion, solid under reduced transparency, defined edges under more contrast, hidden in print',
     /@media \(prefers-reduced-motion: reduce\) \{\s*\.hx-toast, \.hx-snack \{ animation: hx-fade/.test(CSS) && /@media \(prefers-reduced-transparency: reduce\)/.test(CSS) && /@media \(prefers-contrast: more\)/.test(CSS) && /@media print \{ \.hx-toasts \{ display: none; \} \}/.test(CSS));
  ok('  the spring and the flick (right, to dismiss): damping 1.0 / 0.8, response 0.3–0.4, rubber band 0.55, projection 0.998, grabbed from the live value', /damping: Math\.abs\(v\) > 300 \? 0\.8 : 1, response: 0\.3/.test(JS) &&
     /0\.55/.test(JS) && /var d = 0\.998/.test(JS) && /function liveX\(el\)/.test(JS) && /if \(project\(spring\.x, v\) > el\.offsetWidth \* 0\.5\) dismiss\(v, spring\);/.test(JS));
  ['.dh-overlay.open .dh-modal', '.modal-overlay.open .modal-box', '.bk-modal-bg.open .bk-modal', '.dp-modal-bg.open .dp-modal', '.sm-overlay:not(.sm-pdf) > .sm-dialog', '.sh-overlay > .sh-modal'].forEach(sel =>
    ok('phones: ' + sel + ' is a bottom sheet with a grabber', APPLE.indexOf('html[data-skin="ledger"][data-look="apple"] ' + sel + ' {') < 0 ? APPLE.indexOf('html[data-skin="ledger"][data-look="apple"] ' + sel + ', ') >= 0 && APPLE.indexOf('html[data-skin="ledger"][data-look="apple"] ' + sel + '::before') >= 0
      : APPLE.indexOf('html[data-skin="ledger"][data-look="apple"] ' + sel + '::before') >= 0));
  ok('  and js/apple.js drags them all down to dismiss (a shipments sheet scrolls its overlay)', /var OVERLAYS = '\.flow-modal-overlay, \.modal-overlay, \.dh-overlay, \.bk-modal-bg, \.dp-modal-bg, \.sm-overlay:not\(\.sm-pdf\), \.sh-overlay'/.test(AJS) &&
     /SHEETS = '\.flow-modal, \.modal, \.modal-box, \.dh-modal, \.bk-modal, \.dp-modal, \.sm-dialog, \.sh-modal'/.test(AJS) && /var scroller = sheet\.scrollHeight > sheet\.clientHeight \+ 1 \? sheet : overlay;/.test(AJS));
  ok('  a document viewer (the PDF overlays) stays full screen, not a sheet', APPLE.replace(/:not\(\.sm-pdf\)/g, '').indexOf('.sm-pdf') < 0 && !/preview-modal/.test(APPLE));
  const SL = read('js/supplier-list.js'), CB = read('js/client-book.js');
  ok('Undo where there is a way back: archiving a supplier, archiving a client, taking a record off a client', /window\.hxSnackbar\('Archived ' \+ s\.supplier \+ '\.', \{ action: 'Undo', onAction: \(\) => slRestore\(s\) \}\)/.test(SL) &&
     /window\.hxSnackbar\('Archived ' \+ c\.company \+ '\.', \{ action: 'Undo'/.test(CB) && /was taken off ' \+ c\.company \+ '\.', \{ action: 'Undo', onAction: \(\) => cbPost\(null, 'linkClientBookRecords'/.test(CB));
}

console.log(FAIL ? `\n${FAIL} of ${N} FAILED\n` : `\nall ${N} passed\n`);
process.exit(FAIL ? 1 : 0);
