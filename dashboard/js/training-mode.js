/* ═══════════════════════════════════════════════════════════════
   training-mode.js — banner, tooltips, toast for trainee accounts
   Activates only when session.trainingMode === true and role === 'sales'.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  function _session() {
    try { return JSON.parse(localStorage.getItem('session') || 'null'); }
    catch (e) { return null; }
  }

  var sess = _session();
  if (!sess || sess.role !== 'sales' || sess.trainingMode !== true) return;

  // Page registry — tooltip callouts and help bullets per page.
  // Keys are page filenames (last path segment). A407 — performance, report, pending-items and quotation-summary are
  // redirect stubs now (js/page-moved.js), so their entries are gone.
  var PAGE_REGISTRY = {
    'dashboard.html': {
      title: 'Sales Home — Practice Area',
      help: [
        'This is your main sales home. Open the Quotation Generator or PR Generator from Quick Actions to practice creating documents.',
        'In training mode, anything you generate or save will NOT be recorded to the real database or Google Sheets.',
        'Use the Daily Report tile to log your practice activities — daily reports DO get sent so management can see your progress.'
      ],
      tooltips: [
        { selector: '#quotationLink', title: 'Quotation Generator', text: 'Click to open the quotation tool. Try filling in a sample client and item — saved drafts will be discarded in training mode.' },
        { selector: '#prLink', title: 'PR Generator', text: 'Open this to practice writing Purchase Requests. Submitted PRs will not reach the real records while training is on.' },
        { selector: 'a[href="my-daily-report.html"]', title: 'Daily Report', text: 'Submit your daily activities here. Reports from trainees ARE saved so your supervisor can review your day.' },
        { selector: 'a[href="director-client-book.html"]', title: 'Client Book', text: 'Your clients, their people and what you have sent them. The old Client List is retired (A385).' }
      ]
    },
    'leave-request.html': {
      title: 'Leave Request — Practice Area',
      help: [
        'Use this form to learn how to request paid leave, sick leave, or other absences.',
        'Pick the leave type, set the start and end dates — the system calculates total days automatically.',
        'Write a short reason in the notes field so HR understands the context.',
        'In training mode, the Submit button will NOT actually file the leave — your real leave balance is not affected.'
      ],
      tooltips: [
        { selector: '#leaveType', title: 'Leave Type', text: 'Choose Vacation, Sick, Emergency, etc. Each type may have its own balance and rules.' },
        { selector: '#leaveStart', title: 'Start Date', text: 'First day you will be away. The end date and total days update automatically.' },
        { selector: '#leaveReason', title: 'Reason', text: 'Briefly explain why you need leave. HR and your supervisor will see this.' },
        { selector: '#submitBtn', title: 'Submit Leave', text: 'Sends the request to HR. In training mode this is simulated — no real leave is filed.' }
      ]
    }
  };

  function _currentPageKey() {
    var path = (location.pathname || '').split('/').pop() || '';
    return PAGE_REGISTRY[path] ? path : null;
  }

  // ── Banner ─────────────────────────────────────────────────────
  function renderBanner() {
    if (document.getElementById('tm-banner')) return;
    document.body.classList.add('tm-active');
    var bar = document.createElement('div');
    bar.id = 'tm-banner';
    bar.innerHTML =
      '<span class="tm-dot"></span>' +
      '<span>Training Mode active — your changes will not be saved to records.</span>' +
      '<button type="button" class="tm-help" id="tm-help-btn">Help &amp; Tutorial</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.getElementById('tm-help-btn').addEventListener('click', toggleHelpPanel);
  }

  // ── Help Panel ─────────────────────────────────────────────────
  function renderHelpPanel() {
    if (document.getElementById('tm-help-panel')) return;
    var pageKey = _currentPageKey();
    var entry = pageKey ? PAGE_REGISTRY[pageKey] : null;
    var panel = document.createElement('div');
    panel.id = 'tm-help-panel';
    var bullets = entry && entry.help
      ? entry.help.map(function (b) { return '<li>' + _esc(b) + '</li>'; }).join('')
      : '<li>Explore the page — your actions are simulated in training mode.</li>';
    panel.innerHTML =
      '<button class="tm-help-close" type="button" aria-label="Close">&times;</button>' +
      '<h4>' + _esc(entry ? entry.title : 'Training Mode') + '</h4>' +
      '<ul>' + bullets + '</ul>' +
      '<div style="font-size:0.75rem;color:#64748b;margin-top:0.5rem;">Tip: dashed orange outlines highlight where to click first.</div>';
    document.body.appendChild(panel);
    panel.querySelector('.tm-help-close').addEventListener('click', toggleHelpPanel);
  }

  function toggleHelpPanel() {
    var p = document.getElementById('tm-help-panel');
    if (!p) { renderHelpPanel(); p = document.getElementById('tm-help-panel'); }
    p.classList.toggle('open');
  }

  // ── Tooltips ───────────────────────────────────────────────────
  var _calloutEls = [];
  var _dismissed = (function () {
    try { return JSON.parse(sessionStorage.getItem('tm.dismissed') || '[]'); }
    catch (e) { return []; }
  })();

  function _saveDismissed() {
    try { sessionStorage.setItem('tm.dismissed', JSON.stringify(_dismissed)); }
    catch (e) {}
  }

  function _esc(s) { return hxEsc(s); }

  function _placeCallout(target, conf, idx) {
    var calloutId = 'tm-cal-' + idx;
    if (_dismissed.indexOf(calloutId) !== -1) return;
    target.classList.add('tm-highlight');
    var rect = target.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'tm-callout tm-arrow-top';
    el.dataset.calId = calloutId;
    el.innerHTML =
      '<button type="button" class="tm-close" aria-label="Dismiss">&times;</button>' +
      '<span class="tm-title">' + _esc(conf.title) + '</span>' +
      _esc(conf.text);
    document.body.appendChild(el);
    var top = window.scrollY + rect.bottom + 12;
    var left = window.scrollX + rect.left;
    // Flip arrow if no room below
    if (rect.bottom + 100 > window.innerHeight) {
      top = window.scrollY + rect.top - el.offsetHeight - 12;
      el.classList.remove('tm-arrow-top');
      el.classList.add('tm-arrow-bottom');
    }
    el.style.top = top + 'px';
    el.style.left = Math.max(8, left) + 'px';
    el.querySelector('.tm-close').addEventListener('click', function () {
      _dismissed.push(calloutId);
      _saveDismissed();
      el.remove();
      target.classList.remove('tm-highlight');
    });
    _calloutEls.push({ el: el, target: target });
  }

  function renderTooltips() {
    var pageKey = _currentPageKey();
    if (!pageKey) return;
    var tips = (PAGE_REGISTRY[pageKey].tooltips) || [];
    tips.forEach(function (tip, idx) {
      var target = document.querySelector(tip.selector);
      if (!target) return;
      // Skip hidden elements
      var style = window.getComputedStyle(target);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      _placeCallout(target, tip, idx);
    });
  }

  function _reflowCallouts() {
    _calloutEls.forEach(function (rec) {
      var rect = rec.target.getBoundingClientRect();
      rec.el.style.top = (window.scrollY + rect.bottom + 12) + 'px';
      rec.el.style.left = Math.max(8, window.scrollX + rect.left) + 'px';
    });
  }

  // ── Toast (fired by api.js intercept) ──────────────────────────
  function ensureToast() {
    if (document.getElementById('tm-toast')) return;
    var t = document.createElement('div');
    t.id = 'tm-toast';
    t.textContent = 'Training mode — action not saved.';
    document.body.appendChild(t);
  }

  var _toastTimer = null;
  function showToast(msg) {
    ensureToast();
    var t = document.getElementById('tm-toast');
    t.textContent = msg || 'Training mode — action not saved.';
    t.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      t.classList.remove('show');
    }, 2400);
  }

  window.addEventListener('trainingmode:intercepted', function (e) {
    var action = (e && e.detail && e.detail.action) ? e.detail.action : '';
    showToast('Training mode — "' + action + '" was not saved.');
  });

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    renderBanner();
    ensureToast();
    // Defer tooltip placement to next frame so layouts settle
    setTimeout(renderTooltips, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('resize', _reflowCallouts);
  window.addEventListener('scroll', _reflowCallouts, { passive: true });
})();
