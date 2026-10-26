/* hx-feedback.js — A375 · toasts, the snackbar, and alert() as a toast, on every page (js/theme.js loads it, both looks).
 *
 * Neil, 26 Oct 2026: "add these — toast notifications, snackbar, bottom sheet — across all the whole systems pages, only
 * the applicable ones … use apple design skill". Bottom sheets already were the phone shape of a dialog (css/apple.css,
 * js/apple.js); A375 gives the rest of the dialogs that shape. This file is the other two:
 *
 * - hxToast(text, {tone, duration}) — a banner that drops in at the top, says one thing and goes. Tones: ok, info, warn,
 *   error. It can be flicked up to dismiss (1:1 with the finger, the release velocity projected), hovering or focusing it
 *   holds it, an error or warning keeps a close button and stays longer the more it says. The same words twice make one
 *   toast with a count, at most three are up at once.
 * - hxSnackbar(text, {action, onAction, duration, sticky}) — one bar at the bottom with one action (Undo, Retry, View);
 *   a new one takes the old one's place. Flick it down to dismiss.
 * - window.alert — becomes a toast, its tone read from its words, so the portal's 267 alerts stop stopping the page.
 *   confirm() and prompt() stay the browser's own: they ask a question and the page waits for the answer.
 *   A toast still up when the page navigates comes back on the next one (an alert before a redirect is not lost).
 * - Going offline shows a snackbar that stays until the connection is back; coming back is a toast.
 *
 * From the apple-design skill: springs (damping 1.0, response 0.4; 0.8 after a flick), animation from the live on-screen
 * value so a toast can be grabbed mid-flight, rubber-banding against the wrong direction (0.55), projection d = 0.998,
 * no motion under reduced motion (it cross-fades), solid surfaces under reduced transparency. */
(function () {
  if (typeof window === 'undefined' || window.hxToast) return;
  var doc = document, h = doc.documentElement;
  var still = function () {
    try { return h.getAttribute('data-motion') === 'off' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  };
  var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };

  /* ── the spring (as js/apple.js, which loads only under the Apple look) ─────────────────────── */
  function Spring(onUpdate) { this.x = 0; this.v = 0; this.target = 0; this.raf = 0; this.onUpdate = onUpdate; }
  Spring.prototype.stop = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; };
  Spring.prototype.to = function (target, o) {
    o = o || {};
    var self = this, damping = o.damping == null ? 1 : o.damping, response = o.response || 0.4;
    if (o.velocity != null) this.v = o.velocity;
    this.target = target;
    this.stop();
    if (still() || typeof requestAnimationFrame !== 'function') { this.x = target; this.v = 0; this.onUpdate(target); if (o.done) o.done(); return; }
    var k = Math.pow(2 * Math.PI / response, 2), c = 4 * Math.PI * damping / response, last = now();
    var step = function (t) {
      var dt = Math.min(0.064, (t - last) / 1000); last = t;
      while (dt > 0) { var s = Math.min(dt, 1 / 240), a = -k * (self.x - self.target) - c * self.v; self.v += a * s; self.x += self.v * s; dt -= s; }
      self.onUpdate(self.x);
      if (Math.abs(self.x - self.target) < 0.3 && Math.abs(self.v) < 2) { self.x = self.target; self.v = 0; self.onUpdate(self.x); self.raf = 0; if (o.done) o.done(); return; }
      self.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  };
  var rubber = function (over, dim) { return (over * dim * 0.55) / (dim + 0.55 * Math.abs(over)); };
  var project = function (x, v) { var d = 0.998; return x + (v / 1000) * d / (1 - d); };
  /** The element's live vertical offset, read off the screen — so a grab mid-animation starts where it is. */
  function liveY(el) {
    try { var m = getComputedStyle(el).transform; if (!m || m === 'none') return 0; var p = m.match(/matrix(3d)?\(([^)]+)\)/); if (!p) return 0; var n = p[2].split(',').map(Number); return p[1] ? n[13] : n[5]; } catch (e) { return 0; }
  }

  /** Drag an element along y to dismiss it: `dir` -1 = up (toasts), 1 = down (the snackbar). Returns nothing; calls
   *  dismiss(velocity) when the release projects past half its height in that direction. */
  function draggable(el, dir, dismiss, hold) {
    var drag = null, spring = new Spring(function (y) { el.style.transform = y ? 'translate3d(0,' + y + 'px,0)' : ''; });
    el.__spring = spring;
    el.addEventListener('pointerdown', function (e) {
      if (e.button > 0 || (e.target.closest && e.target.closest('button, a, input, select, textarea'))) return;
      var y = spring.raf ? spring.x : liveY(el);
      spring.stop(); el.style.animation = 'none'; el.style.transform = y ? 'translate3d(0,' + y + 'px,0)' : ''; spring.x = y;
      drag = { id: e.pointerId, y0: e.clientY, from: y, moved: false, hist: [[now(), y]] };
      if (hold) hold(true);
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = e.clientY - drag.y0;
      if (!drag.moved) { if (Math.abs(dy) < 6) return; drag.moved = true; try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      var y = drag.from + dy;
      if (y * dir < 0) y = rubber(y, el.offsetHeight);                     // against the way out: it resists
      spring.x = y; spring.onUpdate(y);
      drag.hist.push([now(), y]); if (drag.hist.length > 6) drag.hist.shift();
      e.preventDefault();
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var was = drag; drag = null;
      if (hold) hold(false);
      if (!was.moved) { if (spring.x) spring.to(0); return; }
      var a = was.hist[0], b = was.hist[was.hist.length - 1], v = (b[1] - a[1]) / Math.max(1, b[0] - a[0]) * 1000;
      if (project(spring.x, v) * dir > el.offsetHeight * 0.5) dismiss(v, spring);
      else spring.to(0, { damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.3, velocity: v });
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /* ── what a message says ──────────────────────────────────────────────────────────────────── */
  var ERR = /\b(error|errors|fail|failed|failure|could ?n[o']t|cannot|can't|unable|denied|refused|forbidden|not allowed|not permitted|invalid|exceeds?|timed out|wrong|problem)\b/i;
  var OK = /\b(saved|success|successful|successfully|done|sent|approved|created|updated|deleted|removed|copied|added|submitted|recorded|uploaded|marked|imported|exported|restored|archived|cleared|posted|forwarded|linked|attached|generated|paid|completed?)\b/i;
  var WARN = /^\s*(please|enter|select|choose|pick|type|fill|add|set|load|attach|tick|give|say|fix)\b|\b(required|must|missing|needs?|first|no data|nothing to|not found|already|only|at least)\b/i;
  /** The tone of a message from its words: an error first (a "saved, but the email failed" is an error), then done,
   *  then something to do; anything else is information. */
  function tone(text) { var t = String(text == null ? '' : text); return ERR.test(t) ? 'error' : OK.test(t) ? 'ok' : WARN.test(t) ? 'warn' : 'info'; }
  /** How long it stays: done is quick, something to read stays as long as it takes to read (to 14 s). */
  function lasts(t, kind) {
    var n = String(t || '').length;
    if (kind === 'ok') return Math.min(6000, 2800 + n * 25);
    if (kind === 'info') return Math.min(9000, 3800 + n * 35);
    return Math.max(6000, Math.min(14000, 4000 + n * 45));
  }
  var ICON = {
    ok: '<path d="M7 12.5l3.2 3.2L17 9" />',
    info: '<path d="M12 11v5.5M12 7.6v.1" />',
    warn: '<path d="M12 7.5v5.5M12 16.4v.1" />',
    error: '<path d="M9 9l6 6M15 9l-6 6" />'
  };
  function icon(kind) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.25" />' + (ICON[kind] || ICON.info) + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function whenBody(fn) { if (doc.body) fn(); else doc.addEventListener('DOMContentLoaded', fn); }

  /* ── toasts ───────────────────────────────────────────────────────────────────────────────── */
  var stack = null, live = [];
  function box() {
    if (stack && doc.body.contains(stack)) return stack;
    stack = doc.createElement('div');
    stack.className = 'hx-toasts';
    stack.setAttribute('role', 'region');
    stack.setAttribute('aria-label', 'Notifications');
    doc.body.appendChild(stack);
    return stack;
  }
  /** Show a toast. o = { tone: 'ok'|'info'|'warn'|'error' (default: from the words), duration (ms) }. */
  function toast(text, o) {
    o = o || {};
    var t = String(text == null ? '' : text).trim();
    if (!t) return { close: function () {} };
    var kind = { ok: 1, info: 1, warn: 1, error: 1 }[o.tone] ? o.tone : tone(t), handle = { close: function () {} };
    whenBody(function () {
      var same = live.filter(function (x) { return x.text === t && x.kind === kind; })[0];
      if (same) { same.count++; same.el.querySelector('.hx-tcount').textContent = '×' + same.count; same.el.querySelector('.hx-tcount').hidden = false; same.restart(); handle.close = same.close; return; }
      var el = doc.createElement('div'), loud = kind === 'error' || kind === 'warn';
      el.className = 'hx-toast hx-' + kind;
      el.setAttribute('role', loud ? 'alert' : 'status');
      el.setAttribute('aria-live', loud ? 'assertive' : 'polite');
      el.innerHTML = '<span class="hx-ticon">' + icon(kind) + '</span><span class="hx-ttext">' + esc(t) + '</span><span class="hx-tcount" hidden></span>' +
        '<button type="button" class="hx-tclose" aria-label="Dismiss">' + '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg></button>';
      var rec = { el: el, text: t, kind: kind, count: 1, at: Date.now(), left: o.duration || lasts(t, kind), timer: 0, started: 0, running: false, held: 0 };
      var gone = false;
      rec.close = function (v, spring) {
        if (gone) return; gone = true;
        clearTimeout(rec.timer);
        live = live.filter(function (x) { return x !== rec; });
        var bye = function () { if (el.parentNode) el.parentNode.removeChild(el); };
        if (spring) spring.to(-(el.offsetHeight + 40), { velocity: v, response: 0.3, done: bye });
        else if (still()) bye();
        else { el.style.animation = ''; el.classList.add('hx-out'); setTimeout(bye, 240); }   // out the way it came in: up
      };
      rec.run = function () { if (gone || rec.held) return; rec.started = Date.now(); rec.running = true; clearTimeout(rec.timer); rec.timer = setTimeout(function () { rec.close(); }, rec.left); };
      rec.pause = function () { if (!rec.running) return; clearTimeout(rec.timer); rec.left = Math.max(1200, rec.left - (Date.now() - rec.started)); rec.running = false; };
      rec.restart = function () { rec.left = o.duration || lasts(t, kind); rec.pause(); rec.run(); };
      var hold = function (on) { rec.held += on ? 1 : -1; if (rec.held < 0) rec.held = 0; if (rec.held) rec.pause(); else rec.run(); };
      el.addEventListener('mouseenter', function () { hold(true); });
      el.addEventListener('mouseleave', function () { hold(false); });
      el.addEventListener('focusin', function () { hold(true); });
      el.addEventListener('focusout', function () { hold(false); });
      el.querySelector('.hx-tclose').addEventListener('click', function () { rec.close(); });
      draggable(el, -1, function (v, spring) { rec.close(v, spring); }, hold);
      var s = box();
      s.insertBefore(el, s.firstChild);
      live.unshift(rec);
      while (live.length > 3) live[live.length - 1].close();
      rec.run();
      handle.close = function () { rec.close(); };
    });
    return handle;
  }

  /* ── the snackbar ─────────────────────────────────────────────────────────────────────────── */
  var bar = null;
  /** One bar at the bottom. o = { action: 'Undo', onAction: fn, duration (ms, default 7 s), sticky: true (stays),
   *  tone }. The action runs once; the bar closes when it is pressed. A new snackbar takes this one's place. */
  function snackbar(text, o) {
    o = o || {};
    var t = String(text == null ? '' : text).trim(), handle = { close: function () {} };
    if (!t) return handle;
    whenBody(function () {
      if (bar) bar.close(true);
      var el = doc.createElement('div'), gone = false, timer = 0, started = 0, running = false, left = o.duration || (o.action ? 8000 : 6000), held = 0;
      el.className = 'hx-snack' + (o.tone ? ' hx-' + o.tone : '');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.innerHTML = '<span class="hx-stext">' + esc(t) + '</span>' + (o.action ? '<button type="button" class="hx-sact">' + esc(o.action) + '</button>' : '') +
        '<button type="button" class="hx-sclose" aria-label="Dismiss"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg></button>';
      var rec = {};
      rec.close = function (now, v, spring) {
        if (gone) return; gone = true;
        clearTimeout(timer);
        if (bar === rec) bar = null;
        var bye = function () { if (el.parentNode) el.parentNode.removeChild(el); };
        if (spring) spring.to(el.offsetHeight + 40, { velocity: v, response: 0.3, done: bye });
        else if (now === true || still()) bye();
        else { el.style.animation = ''; el.classList.add('hx-out'); setTimeout(bye, 240); }   // down, the way it came up
      };
      var run = function () { if (gone || held || o.sticky) return; started = Date.now(); running = true; clearTimeout(timer); timer = setTimeout(function () { rec.close(); }, left); };
      var pause = function () { if (!running) return; clearTimeout(timer); left = Math.max(1500, left - (Date.now() - started)); running = false; };
      var hold = function (on) { held += on ? 1 : -1; if (held < 0) held = 0; if (held) pause(); else run(); };
      el.addEventListener('mouseenter', function () { hold(true); });
      el.addEventListener('mouseleave', function () { hold(false); });
      el.addEventListener('focusin', function () { hold(true); });
      el.addEventListener('focusout', function () { hold(false); });
      el.querySelector('.hx-sclose').addEventListener('click', function () { rec.close(); });
      var act = el.querySelector('.hx-sact');
      if (act) act.addEventListener('click', function () {
        if (act.disabled) return;   // once
        act.disabled = true;
        rec.close();
        try { var r = o.onAction && o.onAction(); if (r && typeof r.catch === 'function') r.catch(function () {}); } catch (e) {}
      });
      draggable(el, 1, function (v, spring) { rec.close(false, v, spring); }, hold);
      doc.body.appendChild(el);
      bar = rec;
      run();
      handle.close = function () { rec.close(); };
    });
    return handle;
  }

  /* ── alert() as a toast, and a toast carried over a page change ──────────────────────────── */
  var CARRY = 'hx_toast_carry';
  try {
    window.hxNativeAlert = typeof window.alert === 'function' ? window.alert.bind(window) : null;
    window.alert = function (m) { toast(m == null ? '' : String(m)); };
  } catch (e) {}
  window.addEventListener('pagehide', function () {
    try {
      var fresh = live.filter(function (x) { return Date.now() - x.at < 4000; }).map(function (x) { return { text: x.text, tone: x.kind, at: x.at }; });
      if (fresh.length) sessionStorage.setItem(CARRY, JSON.stringify(fresh)); else sessionStorage.removeItem(CARRY);
    } catch (e) {}
  });
  whenBody(function () {
    try {
      var c = JSON.parse(sessionStorage.getItem(CARRY) || '[]');
      sessionStorage.removeItem(CARRY);
      c.reverse().forEach(function (x) { if (x && Date.now() - x.at < 15000) toast(x.text, { tone: x.tone }); });
    } catch (e) {}
  });

  /* ── offline ──────────────────────────────────────────────────────────────────────────────── */
  var off = null;
  window.addEventListener('offline', function () { off = snackbar('You are offline. Changes will not save until the connection is back.', { sticky: true, tone: 'warn' }); });
  window.addEventListener('online', function () { if (off) { off.close(); off = null; } toast('Back online.', { tone: 'ok' }); });

  window.hxToast = toast;
  window.hxSnackbar = snackbar;
  window.hxFeedback = { toast: toast, snackbar: snackbar, tone: tone, lasts: lasts };
})();
