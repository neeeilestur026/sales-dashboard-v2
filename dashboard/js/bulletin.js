/* bulletin.js — A390 · the bulletin board on each person's own home, and the post renderer bulletin.html shares.
 *
 * Neil, 2 Nov 2026: announcements on every user's dashboard. theme.js loads this file (and css/bulletin.css) only on the
 * signed-in person's own home page, so no home's pinned script list changes. It draws one card right after the home's
 * top bar — above "Needs you" where a home has it: the pinned posts and the ones this person has not marked "Got it",
 * at most three, then "See all". Writers (HR, admin, the director, management) also get "New". With nothing new it is one
 * quiet line, so the board is always one tap away.
 *
 * Quiet when it should be: no session, not this person's home, the server's switch off, or a backend that does not know
 * the action yet (before FlowAPI 195 is pasted, or before Flask deploys) — remembered for ten minutes so no page load
 * keeps asking. Built to the apple-design skill: "Got it" collapses on press (instantly under reduced motion) and comes
 * back with a toast if the save fails; feedback on press; tokens only (css/bulletin.css).
 */
(function () {
  /* mirrors auth.js _homeForRole (tests/flow/bulletin-page.js keeps them equal); everyone else's home is dashboard.html */
  var HOMES = { admin: 'admin.html', accounting: 'accounting-home.html', management: 'management-home.html', director: 'director-home.html',
                hr: 'hr-home.html', marketing: 'marketing-home.html', leadgen: 'leadgen-home.html', warehouse: 'scan.html' };
  /* where the card goes on each home: [the column, the top bar it follows, the host's own card class] */
  var HOST = { hx: ['.hx-col', '.hx-mast', 'hx-glass'], dh: ['.dh-col', '.dh-mast', 'dh-glass'], lg: ['.lg-main', '.lg-top', 'bb-solo'], sc: ['.sc-main', '.sc-top', 'bb-solo'] };
  var OFF_KEY = 'hx_bb_off', OFF_MS = 600000, MAX = 3;
  function hostFor(page) { return page === 'director-home.html' ? 'dh' : page === 'leadgen-home.html' ? 'lg' : page === 'scan.html' ? 'sc' : 'hx'; }
  function esc(s) { return typeof hxEsc === 'function' ? hxEsc(s) : typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
  function dayLabel(iso) {
    var d = new Date(String(iso || ''));
    if (isNaN(d.getTime())) return '';
    var m = new Date(d.getTime() + 8 * 3600000), now = new Date(Date.now() + 8 * 3600000);
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m.getUTCMonth()];
    return m.getUTCDate() + ' ' + mon + (m.getUTCFullYear() !== now.getUTCFullYear() ? ' ' + m.getUTCFullYear() : '');
  }
  function sizeLabel(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function untilLabel(ymd) { return ymd ? 'Until ' + dayLabel(ymd + 'T00:00:00+08:00') : ''; }
  /** One post. o.ack: offer "Got it"; o.clamp: a short body (the home card); o.compact: one line, the title opens the post
   *  (the scanner, where scanning comes first); o.tools: html for the writers' buttons. */
  function itemHtml(it, o) {
    o = o || {};
    var f = it.file, meta = [dayLabel(it.createdAt), it.createdBy].filter(Boolean).join(' · ');
    var file = !f ? '' : f.kind === 'image'
      ? '<button type="button" class="bb-thumb" data-file="' + esc(it.bulletinNo) + '" aria-label="Open the picture: ' + esc(f.name) + '"><span class="bb-img" data-thumb="' + esc(it.bulletinNo) + '"></span></button>'
      : '<button type="button" class="bb-file" data-file="' + esc(it.bulletinNo) + '"><span class="bb-fn">' + esc(f.name) + '</span><span class="bb-fs">' + esc(sizeLabel(f.size)) + '</span></button>';
    var ack = !o.ack ? '' : it.gotIt ? '<span class="bb-seen">Seen</span>'
      : '<button type="button" class="bb-got" data-got="' + esc(it.bulletinNo) + '" aria-label="Got it: ' + esc(it.title) + '">Got it</button>';
    if (o.compact) return '<article class="bb-item bb-compact' + (it.pinned ? ' pinned' : '') + '" data-bb="' + esc(it.bulletinNo) + '">' +
      '<a class="bb-title" href="bulletin.html?id=' + encodeURIComponent(it.bulletinNo) + '">' + esc(it.title) + '</a>' +
      (it.pinned ? '<span class="bb-pin">Pinned</span>' : '') + ack + '</article>';
    return '<article class="bb-item' + (it.pinned ? ' pinned' : '') + (it.status && it.status !== 'Live' ? ' ' + it.status.toLowerCase() : '') + '" data-bb="' + esc(it.bulletinNo) + '">' +
      '<div class="bb-it-top"><span class="bb-kind">' + esc(it.kind || 'Announcement') + '</span>' + (it.pinned && it.status === 'Live' ? '<span class="bb-pin">Pinned</span>' : '') +
      (it.status && it.status !== 'Live' ? '<span class="bb-state">' + esc(it.status) + '</span>' : '') + '<span class="bb-when">' + esc(meta) + '</span></div>' +
      '<h3 class="bb-title">' + esc(it.title) + '</h3>' +
      (it.body ? '<p class="bb-body' + (o.clamp ? ' clamp' : '') + '">' + esc(it.body).replace(/\n/g, '<br>') + '</p>' : '') + (o.clamp ? '' : file) +
      // the home card keeps a post short: its file shares the bottom row with "Got it"
      '<div class="bb-it-foot">' + (o.clamp ? file : '') + '<span class="bb-until">' + esc(untilLabel(it.showUntil)) + '</span>' + (o.tools || '') + ack + '</div></article>';
  }
  /** Fill each [data-thumb] with the picture's thumbnail (audience-checked by the server). */
  function thumbs(box) {
    if (!box || typeof postFlow !== 'function') return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-thumb]'), function (el) {
      if (el.getAttribute('data-done')) return;
      el.setAttribute('data-done', '1');
      postFlow('getBulletinFile', { bulletinNo: el.getAttribute('data-thumb'), size: 'thumb' }).then(function (r) {
        if (!r || !r.success || !r.base64) return;
        var img = document.createElement('img'); img.alt = ''; img.src = 'data:' + r.mimeType + ';base64,' + r.base64; el.appendChild(img);
      }).catch(function () {});
    });
  }
  /** Open an attachment: a picture or a PDF in a new tab, anything else is saved. */
  function openFile(no) {
    if (typeof postFlow !== 'function') return;
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    postFlow('getBulletinFile', { bulletinNo: no, size: 'full' }).then(function (r) {
      if (!r || !r.success || !r.base64) { if (w) w.close(); if (typeof hxToast === 'function') hxToast((r && r.message) || 'The file could not be opened.', { tone: 'error' }); return; }
      var bin = atob(r.base64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
      if (/^image\/|^application\/pdf$/.test(r.mimeType) && w) w.location.href = url;
      else { if (w) w.close(); var a = document.createElement('a'); a.href = url; a.download = r.fileName || 'file'; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }).catch(function () { if (w) w.close(); });
  }
  /** "Got it": collapse at once, save, bring it back if the save fails. */
  function gotIt(btn, onDone) {
    var no = btn.getAttribute('data-got'), item = btn.closest('.bb-item');
    if (item) item.classList.add('bb-out');
    postFlow('ackBulletin', { bulletinNo: no }).then(function (r) {
      if (!r || !r.success) throw new Error((r && r.message) || 'Not saved.');
      try { sessionStorage.removeItem('hx_bb_n'); } catch (e) {}
      if (typeof flowRefreshActions === 'function') flowRefreshActions();
      var live = document.getElementById('bbLive');
      if (live) live.textContent = 'Marked as read.';
      setTimeout(function () { if (item && item.parentNode) item.parentNode.removeChild(item); if (onDone) onDone(); }, 260);
    }).catch(function (e) {
      if (item) item.classList.remove('bb-out');
      if (typeof hxToast === 'function') hxToast(String(e && e.message || e), { tone: 'error' });
    });
  }
  function quiet(msg) {
    try { localStorage.setItem(OFF_KEY, String(Date.now())); } catch (e) {}
    return msg;
  }
  window.hxBoard = { HOMES: HOMES, HOST: HOST, hostFor: hostFor, itemHtml: itemHtml, dayLabel: dayLabel, sizeLabel: sizeLabel, thumbs: thumbs, openFile: openFile, gotIt: gotIt };

  function mount() {
    var s = typeof getSession === 'function' ? getSession() : null;
    if (!s || !s.role || typeof postFlow !== 'function') return;
    var page = (location.pathname.split('/').pop() || 'index.html');
    if (page !== (HOMES[s.role] || 'dashboard.html')) return;
    try { if (Date.now() - (parseInt(localStorage.getItem(OFF_KEY), 10) || 0) < OFF_MS) return; } catch (e) { /* private window: just ask */ }
    var h = HOST[hostFor(page)], col = document.querySelector(h[0]), after = col && col.querySelector(h[1]);
    if (!col || document.getElementById('hxBoard')) return;
    var sec = document.createElement('section');
    sec.id = 'hxBoard'; sec.className = h[2] + ' bb-card'; sec.setAttribute('aria-labelledby', 'bbH'); sec.hidden = true;
    if (after && after.parentNode === col) col.insertBefore(sec, after.nextSibling); else col.insertBefore(sec, col.firstChild);
    var draw = function (r) {
      var mine = (r.items || []).filter(function (it) { return it.pinned || !it.gotIt; }), all = (r.items || []).length;
      sec.innerHTML = '<header class="bb-head"><h2 id="bbH">Bulletin board</h2><div class="bb-acts">' +
        (r.may && r.may.write ? '<a class="bb-new" href="bulletin.html?new=1">New</a>' : '') +
        '<a class="bb-all" href="bulletin.html">See all' + (all ? ' (' + all + ')' : '') + '</a></div></header>' +
        (mine.length ? '<div class="bb-list">' + mine.slice(0, MAX).map(function (it) { return itemHtml(it, { ack: true, clamp: true, compact: hostFor(page) === 'sc' }); }).join('') + '</div>' +
          (mine.length > MAX ? '<p class="bb-more"><a href="bulletin.html">' + (mine.length - MAX) + ' more on the board</a></p>' : '')
          : '<p class="bb-quiet">' + (all ? 'Nothing new on the board.' : 'Nothing on the board yet.') + '</p>') +
        '<p class="bb-sr" id="bbLive" aria-live="polite"></p>';
      sec.hidden = false;
      thumbs(sec);
    };
    sec.addEventListener('click', function (e) {
      var g = e.target.closest('[data-got]');
      if (g) { gotIt(g, function () { if (!sec.querySelector('.bb-item')) load(); }); return; }
      var f = e.target.closest('[data-file]');
      if (f) openFile(f.getAttribute('data-file'));
    });
    var load = function () {
      postFlow('getBulletin', { view: 'board' }).then(function (r) {
        if (!r || !r.success) { if (/unknown action|not a secured action|switched off|not open to your role/i.test(String(r && r.message))) quiet(); sec.remove(); return; }
        if (r.home === false) { quiet(); sec.remove(); return; }
        draw(r);
      }).catch(function (e) {
        if (/unknown action|not a secured action/i.test(String(e && e.message || e))) quiet();
        sec.remove();
      });
    };
    load();
  }
  var ready = function (f) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', f); else f(); };
  ready(function () { try { mount(); } catch (e) { /* the board never breaks a home */ } });
})();
