/* apple.js — A344 · motion for the Apple look (css/apple.css), from Emil Kowalski's apple-design skill.
 *
 * Loaded by js/theme.js only while html[data-look="apple"] is set; does nothing otherwise.
 *
 * - A spring: damping ratio + response, integrated per frame from the LIVE value, so anything can be grabbed
 *   and reversed mid-flight; the release velocity is handed to it (skill §3–§5).
 * - The drawer (phones): drag the sidebar closed with a finger — 1:1 with the pointer (capture, grab offset
 *   kept), 10 px slop, rubber-band past fully open (0.55), momentum projection (d = 0.998) picks open or
 *   closed, the flick's velocity carries into the spring.
 * - Bottom sheets (phones): a dialog shown as a sheet (css/apple.css, ≤ 640 px) can be dragged down to dismiss
 *   the same way. Dismissing clicks the dialog's OWN close / cancel control, so each page's logic runs exactly
 *   as if the person had pressed it; a dialog with no such control just springs back.
 * - "Motion off" or reduced motion (data-motion="off"): drags still work; nothing animates, things land.
 */
(function () {
  var h = document.documentElement;
  if (!h || h.getAttribute('data-look') !== 'apple') return;
  var still = function () { return h.getAttribute('data-motion') === 'off'; };

  /* ── the spring ──────────────────────────────────────────────────────────────────────────── */
  function Spring(onUpdate) { this.x = 0; this.v = 0; this.target = 0; this.raf = 0; this.onUpdate = onUpdate; }
  Spring.prototype.stop = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; };
  Spring.prototype.set = function (x) { this.stop(); this.x = this.target = x; this.v = 0; this.onUpdate(x); };
  Spring.prototype.to = function (target, o) {
    o = o || {};
    var self = this, damping = o.damping == null ? 1 : o.damping, response = o.response || 0.4;
    if (o.velocity != null) this.v = o.velocity;
    this.target = target;
    this.stop();
    if (still()) { this.set(target); if (o.done) o.done(); return; }
    var k = Math.pow(2 * Math.PI / response, 2), c = 4 * Math.PI * damping / response, last = performance.now();
    var step = function (now) {
      var dt = Math.min(0.064, (now - last) / 1000); last = now;
      while (dt > 0) { var s = Math.min(dt, 1 / 240), a = -k * (self.x - self.target) - c * self.v; self.v += a * s; self.x += self.v * s; dt -= s; }
      self.onUpdate(self.x);
      if (Math.abs(self.x - self.target) < 0.3 && Math.abs(self.v) < 2) { self.x = self.target; self.v = 0; self.onUpdate(self.x); self.raf = 0; if (o.done) o.done(); return; }
      self.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  };
  var rubber = function (over, dim) { return (over * dim * 0.55) / (dim + 0.55 * Math.abs(over)); };
  var project = function (x, v) { var d = 0.998; return x + (v / 1000) * d / (1 - d); };
  function tracker() {
    var hist = [];
    return {
      push: function (x) { hist.push([performance.now(), x]); if (hist.length > 6) hist.shift(); },
      velocity: function () { if (hist.length < 2) return 0; var a = hist[0], b = hist[hist.length - 1]; return (b[1] - a[1]) / Math.max(1, b[0] - a[0]) * 1000; }
    };
  }
  window.hxApple = { Spring: Spring, rubber: rubber, project: project };

  /* ── the drawer: drag the sidebar closed (narrow screens only) ───────────────────────────── */
  function wireDrawer(side) {
    if (!side || side.dataset.apDrag) return;
    side.dataset.apDrag = '1';
    var drag = null, spring = new Spring(function (x) { side.style.transform = 'translate3d(' + x + 'px,0,0)'; });
    var narrow = function () { return window.matchMedia && window.matchMedia('(max-width: 899px)').matches; };
    side.addEventListener('pointerdown', function (e) {
      if (!narrow() || !side.classList.contains('open') || e.button > 0) return;
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: spring.raf ? spring.x : 0, moved: false, t: tracker() };
    });
    side.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.abs(dx) < 10 || Math.abs(dy) > Math.abs(dx)) { if (Math.abs(dy) > 10) drag = null; return; }   // a scroll, not a drag
        drag.moved = true; spring.stop(); side.style.transition = 'none';
        try { side.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var x = drag.from + dx;
      if (x > 0) x = rubber(x, side.offsetWidth);
      spring.x = x; spring.v = 0; spring.onUpdate(x); drag.t.push(x);
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var was = drag; drag = null;
      if (!was.moved) return;
      var w = side.offsetWidth, v = was.t.velocity(), close = project(spring.x, v) < -w / 2;
      spring.to(close ? -w - 12 : 0, { damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.3, velocity: v, done: function () {
        side.style.transform = ''; side.style.transition = '';
        if (close && typeof window.hxAppleDrawer === 'function') window.hxAppleDrawer(false, false);
      } });
    };
    side.addEventListener('pointerup', end);
    side.addEventListener('pointercancel', end);
  }

  /* ── bottom sheets: drag a dialog down to dismiss it (phones) ────────────────────────────── */
  var OVERLAYS = '.flow-modal-overlay, .modal-overlay', SHEETS = '.flow-modal, .modal';
  function closeControl(sheet) {
    var list = sheet.querySelectorAll('button, a, [role="button"]');
    for (var i = 0; i < list.length; i++) {
      var b = list[i], t = (b.textContent || '').replace(/\s+/g, ' ').trim(), lab = b.getAttribute('aria-label') || '', cls = String(b.className || '');
      if (/^(close|cancel|×|✕|✖|x|done)$/i.test(t) || /close|dismiss/i.test(lab) || /(^|[\s-])close([\s-]|$)/i.test(cls)) return b;
    }
    return null;
  }
  function wireSheet(overlay) {
    var sheet = overlay.querySelector(SHEETS);
    if (!sheet || sheet.dataset.apDrag) return;
    sheet.dataset.apDrag = '1';
    var drag = null, spring = new Spring(function (y) { sheet.style.transform = y ? 'translate3d(0,' + y + 'px,0)' : ''; });
    var phone = function () { return window.matchMedia && window.matchMedia('(max-width: 640px)').matches; };
    sheet.addEventListener('pointerdown', function (e) {
      if (!phone() || e.button > 0 || (e.target.closest && e.target.closest('input, select, textarea, button, a, label, [contenteditable]'))) return;
      var top = e.clientY - sheet.getBoundingClientRect().top;
      if (sheet.scrollTop > 0 && top > 44) return;          // inside scrolled content: that is a scroll, not a drag
      drag = { id: e.pointerId, y0: e.clientY, from: spring.raf ? spring.x : 0, moved: false, t: tracker() };
    });
    sheet.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = e.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.abs(dy) < 10) return;
        if (dy < 0 && drag.from === 0) { drag = null; return; }   // upward from rest: let the content scroll
        drag.moved = true; spring.stop(); sheet.style.animation = 'none';
        try { sheet.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var y = drag.from + dy;
      if (y < 0) y = rubber(y, sheet.offsetHeight);
      spring.x = y; spring.v = 0; spring.onUpdate(y); drag.t.push(y);
      e.preventDefault();
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var was = drag; drag = null;
      if (!was.moved) return;
      var hgt = sheet.offsetHeight, v = was.t.velocity(), ctl = closeControl(sheet);
      var dismiss = !!ctl && project(spring.x, v) > hgt * 0.4;
      spring.to(dismiss ? hgt + 24 : 0, { damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.3, velocity: v, done: function () {
        if (dismiss) { ctl.click(); }
        sheet.style.transform = ''; sheet.style.animation = '';
      } });
    };
    sheet.addEventListener('pointerup', end);
    sheet.addEventListener('pointercancel', end);
  }

  function scan() {
    wireDrawer(document.getElementById('aSide'));
    var list = document.querySelectorAll(OVERLAYS);
    for (var i = 0; i < list.length; i++) wireSheet(list[i]);
  }
  var queued = false;
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function () {                    // dialogs open by a class change or are added later: once per frame
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; scan(); });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();
