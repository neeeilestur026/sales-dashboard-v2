/* director-home-inline.js — A305 · the page's own script, moved verbatim out of director-home.html so it is
   cached like every other script. It runs at the same point in the page it always did. */
/* A288 — the page's own glue: the date, the purchase-order strip, the three panel mounts, the
   inbox (chips + count), the rail (composition bar, jumps, active link), the one load moment,
   and the tab indicator. The theme toggle is wired by js/theme.js, shared by all four
   director pages. Page-local: the only global it defines on purpose is
   dhSetNumber, which director-home.js calls when it exists. Every browser API is feature-checked
   so the script also runs inside the test harness's bare DOM. */
(function () {
  'use strict';
  document.body.classList.add('dh-js');   // the CSS shows everything without this class — scripting-off safety
  var REDUCED = false;
  try { REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  var on = function (target, ev, fn) { if (target && typeof target.addEventListener === 'function') target.addEventListener(ev, fn); };
  var later = function (fn, ms) { return setTimeout(fn, ms); };

  // ── Date ──
  (function () {
    var d = new Date();
    var dd = $('hbDay'); if (dd) dd.textContent = String(d.getDate()).padStart(2, '0');
    var dm = $('hbMon'); if (dm) dm.textContent = d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleDateString('en-US', { month: 'long' });
  })();

  // ── Numbers count up. Writes the exact final text on the last frame; synchronous under reduced motion. ──
  window.dhSetNumber = function (el, text) {
    if (!el) return;
    text = String(text);
    var num = function (s) { return parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')); };
    var to = num(text), from = num(el.textContent);
    var canAnimate = !REDUCED && typeof requestAnimationFrame === 'function' && window.performance && !isNaN(to) && !isNaN(from) && from !== to;
    if (!canAnimate) { el.textContent = text; return; }
    var prefix = (text.match(/^[^0-9\-]*/) || [''])[0];
    var decimals = ((text.split('.')[1] || '').match(/^[0-9]*/) || [''])[0].length;
    var t0 = performance.now(), dur = 650;
    if (el._dhRaf) cancelAnimationFrame(el._dhRaf);
    if (el.classList) { el.classList.remove('dh-tick'); void el.offsetWidth; el.classList.add('dh-tick'); }
    var step = function (now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      var v = from + (to - from) * e;
      el.textContent = p < 1
        ? prefix + v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : text;
      if (p < 1) el._dhRaf = requestAnimationFrame(step); else el._dhRaf = null;
    };
    el._dhRaf = requestAnimationFrame(step);
  };

  // ── Purchase-order strip (the director is part of the final approver tier) ──
  function dhLoadPoStrip() {
    var el = $('flowApprovalStrip');
    if (!el || typeof _flowConfigured !== 'function' || !_flowConfigured()) return;
    Promise.all([
      fetchFlow('getQuotations').catch(function () { return { data: [] }; }),
      fetchFlow('getPurchaseOrders').catch(function () { return { data: [] }; })
    ]).then(function (r) {
      // A271 — the director no longer approves quotations, so this stays at zero for them.
      var qn = 0;
      var po = r[1];
      var pn = ((po && po.data) || []).filter(function (x) { return x.status === 'Pending Management'; }).length;
      if (qn + pn === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
      var chip = function (n, label, href) {
        return '<a class="dh-po-chip" href="' + href + '"><span class="n">' + n + '</span>' + label + '</a>';
      };
      var chips = '';
      if (qn) chips += chip(qn, 'Quotations awaiting your approval', 'flow-quotations.html');
      if (pn) chips += chip(pn, 'Purchase orders awaiting your approval', 'flow-purchase-orders.html');
      el.innerHTML = '<div class="dh-po-chips">' + chips + '</div>';
      el.style.display = '';
    }).catch(function () {});
  }

  // ── Panel mounts (staggered, so the payroll calls go first) ──
  on(document, 'DOMContentLoaded', function () {
    dhLoadPoStrip();
    if (typeof flowActionsStrip === 'function') later(function () { flowActionsStrip('flowActionCenter'); }, 300);
    if (typeof quotationTeamWorklist === 'function') later(function () { quotationTeamWorklist('qtwPanel'); }, 500);
    if (typeof itineraryWeekPanel === 'function') later(function () { itineraryWeekPanel('iwpPanel'); }, 700);
  });

  // ── The inbox: chips filter, counts follow whatever the three loaders render ──
  (function () {
    var inbox = $('inbox'); if (!inbox) return;
    var count = $('inboxCount');
    var secs = { approve: 'dirApprovals', act: 'flowActionCenter', po: 'flowApprovalStrip' };
    var chipN = function (k) { return inbox.querySelector('.dh-chip[data-k="' + k + '"] .n'); };
    var n = function (k) {
      var c = $(secs[k]); if (!c) return 0;
      if (k === 'approve') return c.querySelectorAll('tbody tr').length;
      if (k === 'act') return c.querySelectorAll('a[href]').length;
      var s = 0; c.querySelectorAll('.dh-po-chip .n').forEach(function (x) { s += parseInt(x.textContent, 10) || 0; }); return s;
    };
    var last = null;
    function recount() {
      var a = n('approve'), b = n('act'), p = n('po'), tot = a + b + p;
      [['approve', a], ['act', b], ['po', p]].forEach(function (kv) { var e = chipN(kv[0]); if (e) dhSetNumber(e, String(kv[1])); });
      var poSec = inbox.querySelector('[data-inbox="po"]'), strip = $('flowApprovalStrip');
      if (poSec) poSec.hidden = !(strip && strip.style.display !== 'none' && strip.children.length);
      inbox.classList.toggle('zero', tot === 0);
      if (count) {
        dhSetNumber(count, String(tot));
        if (last !== null && last !== tot && count.classList) { count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop'); }
      }
      last = tot;
    }
    if (typeof MutationObserver === 'function') {
      var mo = new MutationObserver(recount);
      Object.keys(secs).forEach(function (k) {
        var c = $(secs[k]); if (c) mo.observe(c, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
      });
    }
    inbox.querySelectorAll('.dh-chip').forEach(function (ch) {
      on(ch, 'click', function () {
        inbox.setAttribute('data-filter', ch.getAttribute('data-k'));
        inbox.querySelectorAll('.dh-chip').forEach(function (x) { x.classList.toggle('on', x === ch); });
        inbox.querySelectorAll('.dh-inbox-sec').forEach(function (s) { s.classList.remove('dh-in'); void s.offsetWidth; s.classList.add('dh-in'); });
      });
    });
    on($('dirApprRefresh'), 'click', function () {
      // daLoad (director-approvals.js) has its own listener on this button; this covers the other two sources.
      if (typeof flowActionsStrip === 'function') flowActionsStrip('flowActionCenter');
      dhLoadPoStrip();
    });
    recount();
  })();

  // ── The rail: composition bar from the KPI event, and the one load moment ──
  (function () {
    var armed = false, timer = null;
    function loadMoment() {
      if (armed || REDUCED || !document.body.classList) return;
      armed = true;
      document.body.classList.add('dh-load');
      later(function () { document.body.classList.remove('dh-load'); }, 1400);
    }
    on(document, 'dh:kpis', function (ev) {
      var d = (ev && ev.detail) || {};
      var tot = (d.gross || 0) + (d.share || 0);
      var comp = document.querySelector('.dh-comp');
      if (comp && tot > 0) {
        var set = function (cls, v) { var i = comp.querySelector('i.' + cls); if (i && i.style && typeof i.style.setProperty === 'function') i.style.setProperty('--dh-w', String(Math.max(0, Math.min(1, v / tot)))); };
        set('net', d.net || 0); set('ded', d.ded || 0); set('share', d.share || 0);
      }
      if ((d.gross || 0) > 0) { clearTimeout(timer); loadMoment(); }
    });
    on(document, 'DOMContentLoaded', function () { timer = later(loadMoment, 1500); });
  })();

  // ── Rail jumps and the active section link ──
  (function () {
    var scrollTo = function (el) { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); };
    document.querySelectorAll('.dh-jump[data-tab]').forEach(function (b) {
      on(b, 'click', function () {
        if (typeof switchPayTab === 'function') switchPayTab(b.getAttribute('data-tab'));
        scrollTo($('payroll'));
      });
    });
    var links = Array.prototype.slice.call(document.querySelectorAll('.dh-rail-nav a[href^="#"]'));
    links.forEach(function (a) {
      on(a, 'click', function (ev) {
        var t = $(a.getAttribute('href').slice(1));
        if (!t) return;
        ev.preventDefault(); scrollTo(t);
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', a.getAttribute('href'));
      });
    });
    if (typeof IntersectionObserver !== 'function' || !links.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    ['inbox', 'pulse', 'team', 'payroll'].forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  })();

  // ── The tab indicator slides under whichever .dh-tab is active ──
  (function () {
    var seg = document.querySelector('.dh-seg'); var ind = seg && seg.querySelector('.dh-seg-ind');
    if (!seg || !ind) return;
    var tabs = Array.prototype.slice.call(seg.querySelectorAll('.dh-tab'));
    function place() {
      var a = seg.querySelector('.dh-tab.active'); if (!a || typeof seg.getBoundingClientRect !== 'function') return;
      /* Measured against the TRACK, not offsetLeft: the tab sits inside a group. The indicator's
         left:0 is the track's padding edge, so the border comes off and the scroll offset goes on. */
      var sr = seg.getBoundingClientRect(), ar = a.getBoundingClientRect();
      ind.style.width = ar.width + 'px';
      ind.style.transform = 'translateX(' + (ar.left - sr.left - seg.clientLeft + seg.scrollLeft) + 'px)';
      if (!seg.classList.contains('has-ind')) seg.classList.add('has-ind');
    }
    if (REDUCED) return;   // the CSS fallback paints the active tab itself
    if (typeof MutationObserver === 'function') {
      var mo = new MutationObserver(place);
      tabs.forEach(function (t) { mo.observe(t, { attributes: true, attributeFilter: ['class'] }); });
    } else {
      on(seg, 'click', function () { later(place, 0); });
    }
    var timer = null;
    on(window, 'resize', function () { clearTimeout(timer); timer = later(place, 80); });
    on(seg, 'scroll', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    on(window, 'load', place);
    place();
  })();
})();
