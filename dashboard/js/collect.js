/* A323 — Collect (collect.html): the director's phone for collecting receivables.
 *
 *   To collect   open receivables, most overdue first; search; Overdue / Due this week / All.
 *   An invoice   Collected or Not collected.
 *   Collected    cheque (number, date, bank) / cash / bank transfer; where the money is now; which of
 *                the customer's invoices it pays and how much of each (tax withheld folded in); date;
 *                note; an optional photo. Review, then Record.
 *   Not collected  a reason, an optional promised date, a note.
 *   Recent       his last payments: waiting for accounting, acknowledged, or undone — Undo the same
 *                day while accounting has not acknowledged it.
 *
 * FlowAPI enforces every rule (recordFieldCollection and friends); this page makes them easy. A tap
 * that loses its connection keeps its clientRef, so pressing Record again can never record twice.
 */
(function () {
  const MIN_VERSION = 164;
  const MAX_PHOTOS = 4;
  const C = { session: null, q: null, filter: 'overdue', ar: null, method: '', place: '', lines: [], photoIds: [], clientRef: '',
              notRef: '', reason: '', last: null, busy: false, confirm: {}, afterPhoto: null };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => flowEsc(v);
  const peso = (v) => flowMoney(v, 'PHP');
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  function say(id, text, ok) { const m = $(id); if (!m) return; m.textContent = text || ''; m.className = 'cl-msg' + (text ? (ok ? ' ok' : ' bad') : ''); }
  function banner(text) { $('clBanner').textContent = text || ''; show('clBanner', !!text); }
  const lostLink = (e) => e && (e.name === 'TypeError' || /fetch|network|load failed/i.test(String(e.message || '')));
  const shortDate = (d) => { const t = new Date(String(d).slice(0, 10) + 'T00:00:00'); return isNaN(t) ? String(d || '') : t.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }); };

  /* ── panes ───────────────────────────────────────────────────────────────────────────────────── */
  const PANES = { list: 'clList', recent: 'clRecent', invoice: 'clInvoice', pay: 'clPay', confirm: 'clConfirm', not: 'clNot', done: 'clDone' };
  function go(name) {
    Object.keys(PANES).forEach(k => show(PANES[k], k === name));
    document.querySelector('.cl-tabs').hidden = !(name === 'list' || name === 'recent');
    document.querySelectorAll('.cl-tab').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    window.scrollTo(0, 0);
  }

  /* ── the queue ───────────────────────────────────────────────────────────────────────────────── */
  async function loadQueue() {
    try {
      const r = await postFlow('getCollectorQueue', {});
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not load the receivables.');
      C.q = r;
      banner('');
      const open = r.receivables, total = open.reduce((s, x) => s + x.balance, 0);
      $('clWho').textContent = open.length + ' open · ' + peso(total);
      renderList(); renderRecent();
    } catch (e) {
      banner(lostLink(e) ? 'Can\'t reach the server. Check your signal, then tap Refresh.' : e.message);
      if (!C.q) $('clCards').innerHTML = '';
    }
  }
  function dueText(x) {
    if (x.daysOverdue == null) return { t: 'No due date', late: false };
    if (x.daysOverdue > 0) return { t: x.daysOverdue + (x.daysOverdue === 1 ? ' day' : ' days') + ' overdue', late: true };
    if (x.daysOverdue === 0) return { t: 'Due today', late: false };
    return { t: 'Due in ' + (-x.daysOverdue) + (x.daysOverdue === -1 ? ' day' : ' days'), late: false };
  }
  function flagHtml(f) {
    if (!f) return '';
    const promise = f.promiseDate ? (f.missed ? 'Promise missed · ' + shortDate(f.promiseDate) : 'Promised ' + shortDate(f.promiseDate)) : '';
    return `<span class="cl-flag${f.missed ? ' missed' : ''}">${esc(f.reason)} · ${esc(shortDate(f.date))}${promise ? ' · ' + esc(promise) : ''}</span>`;
  }
  function headHtml(x) {
    const d = dueText(x);
    return `<span class="cl-cust">${esc(x.customer)}</span><span class="cl-amt">${peso(x.balance)}</span>
      <span class="cl-meta">${esc(x.invNo)}${x.soNo ? ' · SO ' + esc(x.soNo) : ''}</span><span class="cl-due${d.late ? ' late' : ''}">${esc(d.t)}</span>${flagHtml(x.followUp)}`;
  }
  function renderList() {
    if (!C.q) return;
    const s = $('clSearch').value.trim().toLowerCase();
    const rows = C.q.receivables.filter(x => {
      if (C.filter === 'overdue' && !(x.daysOverdue > 0)) return false;
      if (C.filter === 'week' && !(x.daysOverdue != null && x.daysOverdue >= -7)) return false;
      return !s || (x.customer + ' ' + x.invNo + ' ' + x.soNo).toLowerCase().includes(s);
    });
    const total = rows.reduce((t, x) => t + x.balance, 0);
    $('clSum').textContent = rows.length ? rows.length + ' invoice' + (rows.length === 1 ? '' : 's') + ' · ' + peso(total) : '';
    $('clCards').innerHTML = rows.length ? rows.map(x => `<button type="button" class="cl-card" data-ar="${esc(x.arNo)}">${headHtml(x)}</button>`).join('')
      : `<div class="cl-empty">${C.filter === 'overdue' && !s ? 'Nothing is overdue.' : 'No invoices match.'}</div>`;
  }
  function renderRecent() {
    const list = (C.q && C.q.recent) || [];
    $('clRecentList').innerHTML = list.length ? list.map(b => {
      const when = new Date(b.at);
      const time = isNaN(when) ? b.date : when.toLocaleString('en-PH', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      const how = b.method === 'Cheque' ? 'Cheque #' + b.chequeNo : b.method;
      const state = b.status === 'New' ? 'Waiting for accounting' : b.status === 'Acknowledged' ? 'Acknowledged by ' + b.acknowledgedBy : 'Undone';
      const undo = b.status === 'New' && C.q && b.date === C.q.today ? `<button type="button" class="btn btn-sm" data-undo="${esc(b.batchNo)}">Undo</button>` : '';
      return `<div class="cl-card cl-head"><span class="cl-cust">${esc(b.customer)}</span><span class="cl-amt">${peso(b.received)}</span>
        <span class="cl-meta">${esc(how)} · ${esc(b.lines.map(l => l.invNo).join(', '))}</span><span class="cl-due">${esc(time)}</span>
        <div class="cl-status"><span class="cl-flag${b.status === 'Acknowledged' ? ' ok' : ''}">${esc(state)}</span>${undo}</div></div>`;
    }).join('') : '<div class="cl-empty">Nothing recorded from this phone yet.</div>';
  }

  /* ── one invoice ─────────────────────────────────────────────────────────────────────────────── */
  function openInvoice(arNo) {
    const x = C.q && C.q.receivables.find(r => r.arNo === arNo);
    if (!x) return;
    C.ar = x;
    $('clInvHead').innerHTML = headHtml(x);
    go('invoice');
  }

  /* ── collected ───────────────────────────────────────────────────────────────────────────────── */
  function startPay() {
    const x = C.ar;
    C.clientRef = flowClientRef(); C.method = ''; C.place = ''; C.photoIds = []; C.confirm = {};
    const mine = C.q.receivables.filter(r => r.customer === x.customer);
    mine.sort((a, b) => (a.arNo === x.arNo ? -1 : b.arNo === x.arNo ? 1 : (b.daysOverdue || 0) - (a.daysOverdue || 0)));
    C.lines = mine.map(r => ({ ar: r, on: r.arNo === x.arNo, amount: r.arNo === x.arNo ? r.balance : 0, ewt: 0, touched: false }));
    $('clPayHead').innerHTML = headHtml(x);
    document.querySelectorAll('.cl-method').forEach(b => b.setAttribute('aria-pressed', 'false'));
    ['clChequeNo', 'clChequeBank', 'clRef', 'clNotes'].forEach(id => { $(id).value = ''; });
    $('clChequeDate').value = C.q.today;
    $('clDate').value = C.q.today; $('clDate').max = C.q.today;
    show('clPayRest', false); say('clPayMsg', '');
    renderPhotos(); renderLines(); validate();
    go('pay');
  }
  function pickMethod(m) {
    C.method = m;
    document.querySelectorAll('.cl-method').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.method === m)));
    show('clPayRest', true);
    show('clChequeBox', m === 'Cheque');
    show('clRefBox', m === 'Bank Transfer');
    $('clDateLabel').textContent = m === 'Bank Transfer' ? 'Date it reached our account' : 'Date received';
    $('clPlaceLegend').textContent = m === 'Bank Transfer' ? 'Which of our accounts received it?' : m === 'Cheque' ? 'Where is the cheque now?' : 'Where is the cash now?';
    // a held cheque or cash is honestly "not yet deposited"; a transfer must be told which bank — no guess
    C.place = m === 'Cheque' ? C.q.undeposited.code : m === 'Cash' ? C.q.cashOnHand.code : '';
    renderPlaces(); pdcNote(); validate();
  }
  function renderPlaces() {
    const opts = [];
    if (C.method === 'Cheque') opts.push({ code: C.q.undeposited.code, label: 'With me or in the office — not yet deposited' });
    if (C.method === 'Cash') opts.push({ code: C.q.cashOnHand.code, label: 'With me or in the office — cash on hand' });
    C.q.banks.forEach(b => opts.push({ code: b.code, label: (C.method === 'Bank Transfer' ? '' : 'Deposited to ') + b.name }));
    $('clPlaces').innerHTML = opts.map(o => `<label class="cl-opt"><input type="radio" name="clPlace" value="${esc(o.code)}"${o.code === C.place ? ' checked' : ''}> ${esc(o.label)}</label>`).join('');
  }
  function renderLines() {
    $('clLines').innerHTML = C.lines.map((l, i) => `
      <div class="cl-line${l.on ? '' : ' off'}" data-i="${i}">
        <div class="cl-line-top">
          <input type="checkbox" data-on="${i}"${l.on ? ' checked' : ''} aria-label="Pays ${esc(l.ar.invNo)}">
          <span class="cl-line-name">${i === 0 ? '' : 'Also pays '}${esc(l.ar.invNo)}</span>
          <span class="cl-line-bal">balance ${peso(l.ar.balance)}</span>
        </div>
        ${l.on ? `<div class="cl-line-amts">
          <div><label class="cl-label" for="clAmt${i}">Received</label><input type="number" class="cl-input" id="clAmt${i}" data-amt="${i}" min="0" step="0.01" inputmode="decimal" value="${l.amount || ''}"></div>
          <div><label class="cl-label" for="clEwt${i}">Tax withheld (2307)</label><input type="number" class="cl-input" id="clEwt${i}" data-ewt="${i}" min="0" step="0.01" inputmode="decimal" value="${l.ewt || ''}" placeholder="0.00"></div>
        </div><p class="cl-line-left" id="clLeft${i}"></p>` : ''}
      </div>`).join('');
    lineTotals();
  }
  function lineTotals() {
    let total = 0;
    C.lines.forEach((l, i) => {
      if (!l.on) return;
      total += r2(l.amount);
      const left = r2(l.ar.balance - r2(l.amount) - r2(l.ewt)), el = $('clLeft' + i);
      if (el) el.textContent = left > 0.005 ? 'Balance left after this: ' + peso(left) : left < -0.005 ? peso(-left) + ' more than the balance' : 'Pays it in full';
    });
    const word = C.method === 'Cheque' ? 'the cheque' : C.method === 'Cash' ? 'the cash' : C.method === 'Bank Transfer' ? 'the transfer' : 'what you received';
    $('clTotal').textContent = 'Total received: ' + peso(total);
    $('clTotalHint').textContent = 'It should match ' + word + '.';
  }
  function pdcNote() { show('clPdcNote', C.method === 'Cheque' && $('clChequeDate').value > $('clDate').value); }
  function payProblem() {
    if (!C.method) return 'Choose how it was paid.';
    if (C.method === 'Cheque' && !$('clChequeNo').value.trim()) return 'Enter the cheque number.';
    if (!C.place) return C.method === 'Bank Transfer' ? 'Choose which of our accounts received it.' : 'Say where it is now.';
    const on = C.lines.filter(l => l.on);
    if (!on.length) return 'Choose at least one invoice.';
    if (on.some(l => !(r2(l.amount) > 0))) return 'Enter the amount received for every invoice ticked.';
    if (on.some(l => r2(l.ewt) < 0)) return 'Tax withheld cannot be negative.';
    const d = $('clDate').value;
    if (!d) return 'Enter the date.';
    if (d > C.q.today) return 'The date cannot be in the future.';
    return '';
  }
  function validate() { $('clReview').disabled = !!payProblem(); }

  function review() {
    const p = payProblem();
    if (p) { say('clPayMsg', p, false); return; }
    say('clPayMsg', '');
    C.confirm = {};                      // a fresh review asks every question again: an earlier "record anyway" was for other figures
    const on = C.lines.filter(l => l.on), total = on.reduce((s, l) => s + r2(l.amount), 0), ewt = on.reduce((s, l) => s + r2(l.ewt), 0);
    const placeName = C.place === C.q.undeposited.code ? 'Not yet deposited' : C.place === C.q.cashOnHand.code ? 'Cash on hand'
      : ((C.q.banks.find(b => b.code === C.place) || {}).name || C.place);
    const rows = [['Customer', esc(C.ar.customer)],
      ['Paid by', C.method === 'Cheque' ? 'Cheque #' + esc($('clChequeNo').value.trim()) + ($('clChequeBank').value.trim() ? ' · ' + esc($('clChequeBank').value.trim()) : '') +
        ($('clChequeDate').value ? ' · dated ' + esc(shortDate($('clChequeDate').value)) : '') : esc(C.method)],
      [C.method === 'Bank Transfer' ? 'Received in' : 'Where it is', esc(placeName)],
      ['Date', esc(shortDate($('clDate').value))]];
    on.forEach(l => rows.push([esc(l.ar.invNo), peso(l.amount) + (r2(l.ewt) ? ' + ' + peso(l.ewt) + ' withheld' : '')]));
    if (ewt) rows.push(['Tax withheld', peso(ewt)]);
    rows.push(['Total received', `<span class="big">${peso(total)}</span>`]);
    if (C.photoIds.length) rows.push(['Photos', String(C.photoIds.length)]);
    if ($('clNotes').value.trim()) rows.push(['Note', esc($('clNotes').value.trim())]);
    $('clReviewList').innerHTML = rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('');
    say('clConfirmMsg', C.method === 'Cheque' && $('clChequeDate').value > $('clDate').value ? 'Post-dated cheque: recorded as received today and held until it is deposited.' : '', true);
    go('confirm');
  }
  function payload() {
    const on = C.lines.filter(l => l.on);
    return Object.assign({ method: C.method, date: $('clDate').value, depositedTo: C.place, notes: $('clNotes').value.trim(),
      chequeNo: C.method === 'Cheque' ? $('clChequeNo').value.trim() : '', chequeDate: C.method === 'Cheque' ? $('clChequeDate').value : '',
      chequeBank: C.method === 'Cheque' ? $('clChequeBank').value.trim() : '', ref: C.method === 'Bank Transfer' ? $('clRef').value.trim() : '',
      photoIds: C.photoIds.join(','), clientRef: C.clientRef,
      lines: JSON.stringify(on.map(l => ({ arNo: l.ar.arNo, amount: r2(l.amount), ewt: r2(l.ewt) }))) }, C.confirm);
  }
  async function record() {
    if (C.busy) return;
    C.busy = true; $('clRecord').disabled = true; $('clRecord').textContent = 'Recording…';
    say('clConfirmMsg', '');
    try {
      const r = await postFlow('recordFieldCollection', payload());
      if (r && r.success) return done(r);
      if (r && r.needsConfirm === 'overCollect') return ask('More than the balance', r.message,
        [['Record it anyway', () => { C.confirm.confirmOver = true; record(); }, true], ['Go back and change it', () => go('pay')]]);
      if (r && r.needsConfirm === 'duplicateCheque') return ask('This cheque was used before', r.message,
        [['The same cheque pays these too — record', () => { C.confirm.confirmDupCheque = true; record(); }, true], ['Go back', () => go('pay')]]);
      if (r && r.missingDocs) {
        const which = r.missingDocs.map(m => m.invNo).join(', ');
        return ask('Photo needed', 'The order for ' + which + ' needs proof of collection on file: a photo of the official receipt, the cheque or the deposit slip.',
          [['Take the photo', () => { C.afterPhoto = record; $('clPhotoIn').click(); }, true],
           ['Record without it — accounting will ask for it', () => { C.confirm.confirmNoDocs = true; record(); }],
           ['Go back', () => go('confirm')]]);
      }
      say('clConfirmMsg', (r && r.message) || 'Not recorded.', false);
    } catch (e) {
      say('clConfirmMsg', lostLink(e) ? 'The connection dropped before the answer came back. Tap Record again — it will not be recorded twice.' : e.message, false);
    } finally {
      C.busy = false; $('clRecord').disabled = false; $('clRecord').textContent = 'Record';
    }
  }
  function done(r) {
    C.last = r.batch || { batchNo: r.batchNo };
    $('clDoneTitle').textContent = 'Recorded';
    const nos = r.collectionNos || [];
    const bits = [(nos.length === 1 ? 'Collection ' : 'Collections ') + nos.join(', ') + '.', 'Accounting and admin have been told.'];
    if (r.postDated) bits.push('Post-dated cheque: held until deposited.');
    if (r.noProof) bits.push('No proof of collection yet — accounting will ask for it.');
    $('clDoneText').textContent = bits.join(' ');
    show('clUndo', true); say('clDoneMsg', '');
    go('done');
    loadQueue();
  }

  /* ── photos ──────────────────────────────────────────────────────────────────────────────────── */
  function renderPhotos() {
    const n = C.photoIds.length;
    $('clPhotoNote').textContent = n ? n + ' photo' + (n === 1 ? '' : 's') + ' added' : 'Optional. Needed for orders from 1 Aug 2026 that have no official receipt on file yet.';
    $('clPhotoBtn').disabled = n >= MAX_PHOTOS;
  }
  async function takePhotos(files) {
    const arNos = C.lines.filter(l => l.on).map(l => l.ar.arNo);
    if (!arNos.length) { say('clPayMsg', 'Choose the invoice first.', false); return; }
    closeSheet();
    for (const f of Array.from(files || []).slice(0, MAX_PHOTOS - C.photoIds.length)) {
      say(C.afterPhoto ? 'clConfirmMsg' : 'clPayMsg', 'Saving the photo…', true);
      try {
        const data = await flowDownscaleImage(f, 1280, 0.75);
        const r = await postFlow('uploadCollectionPhoto', { arNos: arNos.join(','), base64: data, mimeType: 'image/jpeg' });
        if (!r || !r.success) throw new Error((r && r.message) || 'The photo was not saved.');
        C.photoIds.push(r.docId);
      } catch (e) {
        say(C.afterPhoto ? 'clConfirmMsg' : 'clPayMsg', lostLink(e) ? 'The photo did not go through. Check your signal and try again.' : e.message, false);
        C.afterPhoto = null; renderPhotos(); return;
      }
    }
    say(C.afterPhoto ? 'clConfirmMsg' : 'clPayMsg', '');
    renderPhotos();
    const next = C.afterPhoto; C.afterPhoto = null;
    if (next) next();
  }

  /* ── not collected ───────────────────────────────────────────────────────────────────────────── */
  function startNot() {
    C.notRef = flowClientRef(); C.reason = '';
    $('clNotHead').innerHTML = headHtml(C.ar);
    $('clReasons').innerHTML = C.q.reasons.map(r => `<label class="cl-opt"><input type="radio" name="clReason" value="${esc(r)}"> ${esc(r)}</label>`).join('');
    $('clPromise').value = ''; $('clPromise').min = C.q.today; $('clNotNote').value = '';
    say('clNotMsg', '');
    go('not');
  }
  async function saveNot() {
    if (C.busy) return;
    if (!C.reason) { say('clNotMsg', 'Choose a reason.', false); return; }
    if (C.reason === 'Other' && !$('clNotNote').value.trim()) { say('clNotMsg', 'Say what happened in the note.', false); return; }
    C.busy = true; $('clNotSave').disabled = true;
    try {
      const r = await postFlow('recordNotCollected', { arNo: C.ar.arNo, reason: C.reason, promiseDate: $('clPromise').value, notes: $('clNotNote').value.trim(), clientRef: C.notRef });
      if (!r || !r.success) throw new Error((r && r.message) || 'Not saved.');
      C.last = null;
      $('clDoneTitle').textContent = 'Saved';
      $('clDoneText').textContent = C.ar.customer + ' · ' + C.ar.invNo + ': ' + r.message;
      show('clUndo', false); say('clDoneMsg', '');
      go('done');
      loadQueue();
    } catch (e) {
      say('clNotMsg', lostLink(e) ? 'The connection dropped. Tap Save again — it will not be saved twice.' : e.message, false);
    } finally { C.busy = false; $('clNotSave').disabled = false; }
  }

  /* ── undo ────────────────────────────────────────────────────────────────────────────────────── */
  function askUndo(batchNo, msgId) {
    ask('Undo this payment?', 'Its collections are voided and the invoices are open again. Accounting and admin will no longer see it.',
      [['Undo — it was recorded by mistake', () => undo(batchNo, msgId), true], ['Keep it', closeSheet]]);
  }
  async function undo(batchNo, msgId) {
    closeSheet();
    try {
      const r = await postFlow('undoFieldCollection', { batchNo, reason: 'recorded by mistake' });
      if (!r || !r.success) throw new Error((r && r.message) || 'Not undone.');
      say(msgId, r.message, true);
      if (msgId === 'clDoneMsg') { show('clUndo', false); $('clDoneTitle').textContent = 'Undone'; $('clDoneText').textContent = 'The invoices are open again.'; }
      loadQueue();
    } catch (e) { say(msgId, lostLink(e) ? 'The connection dropped. Try Undo again.' : e.message, false); }
  }

  /* ── the question sheet ──────────────────────────────────────────────────────────────────────── */
  function ask(title, text, actions) {
    $('clSheetTitle').textContent = title; $('clSheetText').textContent = text;
    $('clSheetActs').innerHTML = actions.map((a, i) => `<button type="button" class="btn${a[2] ? ' btn-primary primary' : ''}" data-act="${i}">${esc(a[0])}</button>`).join('');
    $('clSheetActs').querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { const a = actions[+b.dataset.act]; closeSheet(); a[1](); }));
    show('clSheet', true);
  }
  function closeSheet() { show('clSheet', false); }

  /* ── wiring ──────────────────────────────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    C.session = requireCollectAccess();
    if (!C.session) return;
    if (typeof renderNavbar === 'function') renderNavbar('collect');
    $('clRefresh').addEventListener('click', () => location.reload());   // a home-screen app has no pull-to-refresh
    let v = 0;
    try { const r = await fetchFlow('getVersion', {}, { fresh: true }); v = Number(r && r.version) || 0; }
    catch (e) { banner('Can\'t reach the server. Check your signal, then tap Refresh — nothing has been recorded.'); return; }
    if (v < MIN_VERSION) { banner('Collect needs the latest FlowAPI (' + MIN_VERSION + '). Paste FlowAPI.gs, then reload.'); $('clWho').textContent = ''; return; }

    document.querySelectorAll('.cl-tab').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => go(b.dataset.back)));
    document.querySelectorAll('.cl-chip').forEach(b => b.addEventListener('click', () => {
      C.filter = b.dataset.filter;
      document.querySelectorAll('.cl-chip').forEach(x => x.classList.toggle('active', x === b));
      renderList();
    }));
    $('clSearch').addEventListener('input', renderList);
    $('clCards').addEventListener('click', (e) => { const c = e.target.closest('[data-ar]'); if (c) openInvoice(c.dataset.ar); });
    $('clRecentList').addEventListener('click', (e) => { const u = e.target.closest('[data-undo]'); if (u) askUndo(u.dataset.undo, 'clRecentMsg'); });
    $('clYes').addEventListener('click', startPay);
    $('clNo').addEventListener('click', startNot);
    document.querySelectorAll('.cl-method').forEach(b => b.addEventListener('click', () => pickMethod(b.dataset.method)));
    $('clPlaces').addEventListener('change', (e) => { if (e.target.name === 'clPlace') { C.place = e.target.value; validate(); } });
    $('clLines').addEventListener('change', (e) => {
      const i = e.target.dataset.on;
      if (i === undefined) return;
      const l = C.lines[+i]; l.on = e.target.checked;
      if (l.on && !l.amount) l.amount = l.ar.balance;
      renderLines(); validate();
    });
    $('clLines').addEventListener('input', (e) => {
      if (e.target.dataset.amt !== undefined) { const l = C.lines[+e.target.dataset.amt]; l.amount = parseFloat(e.target.value) || 0; l.touched = true; }
      if (e.target.dataset.ewt !== undefined) {
        const i = +e.target.dataset.ewt, l = C.lines[i];
        l.ewt = parseFloat(e.target.value) || 0;
        /* a customer who withholds pays the balance LESS the tax: until the amount received was typed
           by hand, it follows, so the cheque amount and the 2307 add up to the invoice */
        if (!l.touched) { l.amount = r2(Math.max(0, l.ar.balance - l.ewt)); const a = $('clAmt' + i); if (a) a.value = l.amount; }
      }
      lineTotals(); validate();
    });
    ['clChequeNo', 'clDate'].forEach(id => $(id).addEventListener('input', () => { pdcNote(); validate(); }));
    $('clChequeDate').addEventListener('input', pdcNote);
    $('clReview').addEventListener('click', review);
    $('clRecord').addEventListener('click', record);
    $('clPhotoBtn').addEventListener('click', () => { C.afterPhoto = null; $('clPhotoIn').click(); });
    $('clPhotoIn').addEventListener('change', (e) => { const f = e.target.files; takePhotos(f).then(() => { e.target.value = ''; }); });
    $('clReasons').addEventListener('change', (e) => { if (e.target.name === 'clReason') { C.reason = e.target.value; say('clNotMsg', ''); } });
    $('clNotSave').addEventListener('click', saveNot);
    $('clUndo').addEventListener('click', () => { if (C.last && C.last.batchNo) askUndo(C.last.batchNo, 'clDoneMsg'); });
    $('clSheet').addEventListener('click', (e) => { if (e.target === $('clSheet')) closeSheet(); });
    await loadQueue();
  });
  window.__collect = { C, MIN_VERSION, dueText, payProblem };   // tests
})();
