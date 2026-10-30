/* quotation-status.js — A382 · Quotation status (quotation-status.html): every quotation and where it stands.
 *
 * Neil, 29 Oct 2026: "for each sales1 and sales2 … their own quotation list … a button for close/loss (reason), pending
 * (last follow up date and status), won. if pending select email for last follow up, if already follow up on the email
 * linked, you can skip that, we just need to have the status of all the quotations". A rep sees their own quotations
 * ("My quotations"); admin, management and the director see each rep's, with a switch ("Quotation status").
 *
 * Each quotation ends in one state: Won, Pending (the last follow-up — a picked email, or a date and how — and where it
 * stands) or Closed with a reason. Every change is one call, setQuotationResult (FlowAPI 191), followed by an Undo.
 * Built to the apple-design skill: a large title and a progress line; a segmented control whose indicator follows on a
 * spring; grouped rows; sheets that rise from the bottom on a phone (css/apple.css, js/apple.js); press feedback; forms
 * that say what is missing before they are sent. The decisions are js/quotation-status-model.js (pure, tested). */

const QS = { me: '', meKey: '', role: '', over: false, rep: '', all: [], so: [], hasSO: {}, links: {}, cfg: null, clients: {},
             built: null, seg: 'update', q: '', sort: 'oldest', selecting: false, sel: {}, ready: true, loaded: false, today: '',
             back: null, mail: { state: 'idle', emails: [], addr: '', truncated: false }, busy: false };

function _qsE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _qsId(id) { return document.getElementById(id); }
function _qsFirst(name) { return String(name || '').trim().split(/\s+/)[0] || 'the rep'; }
const _QS_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function _qsDay(v) {
  const s = typeof flowDate === 'function' ? flowDate(v) : String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const y = s.slice(0, 4), d = String(+s.slice(8, 10)) + ' ' + _QS_MON[+s.slice(5, 7) - 1];
  return y === String(QS.today).slice(0, 4) ? d : d + ' ' + y;
}
function _qsPeso(v) { const n = Number(v) || 0; return '₱' + n.toLocaleString('en-PH', { maximumFractionDigits: 0 }); }
function _qsAge(n) { return n == null ? '' : n <= 0 ? 'today' : n === 1 ? '1 day' : n + ' days'; }
function _qsMine(q) { return String(typeof flowQuotationOwner === 'function' ? flowQuotationOwner(q) : q.salesperson || '').trim().toLowerCase() === QS.meKey; }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireQuotationStatusAccess === 'function' ? requireQuotationStatusAccess() : null;
  if (!s) return;
  if (typeof renderNavbar === 'function') renderNavbar('quotation-status');
  QS.me = String(s.name || s.username || '').trim();
  QS.meKey = QS.me.toLowerCase();
  QS.role = String(s.role || '');
  QS.over = QS.role !== 'sales';
  const qp = new URLSearchParams(location.search || '');
  QS.rep = String(qp.get('rep') || '').trim();
  if (QS.over) {
    _qsId('qsTitle').textContent = 'Quotation status';
    _qsId('qsLede').textContent = 'Each rep’s quotations and where they stand: won, pending with the last follow-up, or closed with a reason.';
    document.title = 'Quotation status';
  }
  _qsId('qsSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-seg]'); if (b) qsSetSeg(b.getAttribute('data-seg'), true); });
  _qsId('qsSeg').addEventListener('keydown', qsSegKeys);
  _qsId('qsSearch').addEventListener('input', (e) => { QS.q = e.target.value; qsRenderList(); });
  _qsId('qsSort').addEventListener('change', (e) => { QS.sort = e.target.value; qsRenderList(); });
  _qsId('qsSelect').addEventListener('click', () => qsSelecting(!QS.selecting));
  _qsId('qsRep').addEventListener('change', (e) => { QS.rep = e.target.value; qsRepUrl(); qsBuildRows(); qsRender(); });
  _qsId('qsList').addEventListener('click', qsListClick);
  _qsId('qsList').addEventListener('change', qsListChange);
  _qsId('qsBulk').addEventListener('click', qsBulkClick);
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', qsMoveInd);
  await qsLoad(false);
  /* A385 — ?q=<quotation> arrives from the quotation list's Update: open that quotation's choices (Won, Pending, Lost). */
  const want = String(qp.get('q') || '').trim();
  if (want) {
    const q = (QS.all || []).find(x => String(x.quotationNo) === want);
    if (q && QS.over && flowQuotationOwner(q) !== QS.rep) { QS.rep = flowQuotationOwner(q); qsFillReps(); qsRepUrl(); qsBuildRows(); qsRender(); }
    const r = qsRow(want);
    if (r) qsChooser(r, null);
  }
});

/* ── load ─────────────────────────────────────────────────────────────────────────────────────── */

function qsSkeleton() {
  return '<div class="qs-skel" aria-hidden="true">' + Array.from({ length: 6 }, () => '<span class="qs-skrow"><span></span><span></span><span></span></span>').join('') + '</div>' +
    '<p class="qs-sr" role="status">Reading your quotations…</p>';
}
async function qsLoad(fresh) {
  _qsId('qsList').innerHTML = qsSkeleton();
  QS.today = typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10);
  const opt = fresh ? { fresh: true } : {};
  const scope = QS.over ? {} : { createdBy: QS.me };
  try {
    const [q, so, le, cf, cl] = await Promise.all([
      fetchFlow('getQuotations', scope, opt).then(r => (r && r.data) || []),
      fetchFlow('getSalesOrders', {}, opt).then(r => (r && r.data) || []).catch(() => []),
      fetchFlow('getQuotationEmails', {}, opt).then(r => (r && r.data) || []).catch(() => []),
      fetchFlow('getFlowSettings', {}, opt).then(r => (r && r.data) || null).catch(() => null),
      fetchFlow('getClients', {}, opt).then(r => (r && r.data) || []).catch(() => [])
    ]);
    /* The rows are the version check, not getVersion (c3ff795): FlowAPI 191 returns a `result` key on every quotation. */
    QS.ready = !q.length || q.some(x => Object.prototype.hasOwnProperty.call(x, 'result'));
    QS.all = QS.over ? q : q.filter(_qsMine);
    QS.so = so;
    QS.hasSO = {}; so.forEach(s => { if (s.quotationNo) QS.hasSO[String(s.quotationNo)] = true; });
    QS.links = {}; le.forEach(l => { const k = String(l.quotationNo || ''); if (k) (QS.links[k] = QS.links[k] || []).push(l); });
    QS.cfg = cf;
    QS.clients = {};
    cl.forEach(c => { const k = String(c.customer || '').toLowerCase().trim(); if (k) QS.clients[k] = { email: c.email || '', rfqRef: c.rfqRef || '' }; });
    QS.loaded = true;
    if (QS.over) qsFillReps();
    qsBuildRows();
    qsRender();
  } catch (e) {
    QS.loaded = false;
    _qsId('qsList').innerHTML = '<p class="qs-fail">Could not read the quotations: ' + _qsE(e && e.message || e) + ' Reload the page to try again.</p>';
  }
}

/* oversight: who to show — the reps whose quotations these are, the most first; the choice lives in ?rep= */
function qsFillReps() {
  const reps = qsOwners(QS.all), sel = _qsId('qsRep');
  if (!QS.rep || !reps.some(r => r.name === QS.rep)) {
    const firstSales = reps.find(r => /kimberlyn|gerald/i.test(r.name)) || reps[0];
    QS.rep = firstSales ? firstSales.name : '';
  }
  sel.innerHTML = reps.map(r => '<option value="' + _qsE(r.name) + '"' + (r.name === QS.rep ? ' selected' : '') + '>' + _qsE(r.name) + ' (' + r.count + ')</option>').join('');
  _qsId('qsRepWrap').hidden = false;
}
function qsRepUrl() {
  try { const u = new URL(location.href); u.searchParams.set('rep', QS.rep); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
}
function qsRows() { return QS.over ? QS.all.filter(q => (typeof flowQuotationOwner === 'function' ? flowQuotationOwner(q) : '') === QS.rep) : QS.all; }
function qsBuildRows() {
  QS.built = qsBuild(qsRows(), { hasSO: QS.hasSO, links: QS.links, cfg: QS.cfg, salesOrders: QS.so, today: QS.today });
}
function qsRow(no) { return (QS.built.rows || []).find(r => String(r.q.quotationNo) === String(no)) || null; }

/* ── drawing ──────────────────────────────────────────────────────────────────────────────────── */

function qsRender() {
  qsRenderProgress();
  qsRenderNotice();
  qsRenderSeg();
  qsRenderList();
}
function qsRenderProgress() {
  const p = QS.built.progress, c = QS.built.counts, pct = p.total ? Math.round(100 * p.done / p.total) : 100;
  const who = QS.over ? _qsFirst(QS.rep) + '’s' : 'Your';
  _qsId('qsProgress').innerHTML = p.total
    ? '<div class="qs-prog-top"><p class="qs-prog-n"><b>' + p.done + '</b> of ' + p.total + ' sent quotations have a status</p>' +
        '<p class="qs-prog-left">' + (c.update ? c.update + ' to update' : 'All done') + '</p></div>' +
      '<div class="qs-meter" role="progressbar" aria-label="' + _qsE(who + ' quotations with a status') + '" aria-valuemin="0" aria-valuemax="' + p.total + '" aria-valuenow="' + p.done + '">' +
        '<span class="qs-meter-won" data-w="' + (p.total ? c.won / p.total : 0) + '"></span><span class="qs-meter-pend" data-w="' + (p.total ? c.pending / p.total : 0) + '"></span>' +
        '<span class="qs-meter-closed" data-w="' + (p.total ? c.closed / p.total : 0) + '"></span></div>' +
      '<p class="qs-legend"><span class="qs-key won"></span>Won ' + c.won + '<span class="qs-key pend"></span>Pending ' + c.pending +
        '<span class="qs-key closed"></span>Closed ' + c.closed + (c.notsent ? '<span class="qs-key ns"></span>Not sent yet ' + c.notsent : '') + '<span class="qs-pct">' + pct + '%</span></p>'
    : '<p class="qs-prog-n">' + (QS.built.rows.length ? 'Nothing sent yet.' : '') + '</p>';
  _qsId('qsProgress').querySelectorAll('[data-w]').forEach(el => { el.style.flexGrow = el.getAttribute('data-w'); });
}
function qsRenderNotice() {
  _qsId('qsNotice').innerHTML = QS.ready ? '' :
    '<p class="qs-notice">The Won, Pending and Lost buttons open once the FlowAPI update (version 191) is pasted. Until then this is the list as it stands.</p>';
}
function qsRenderSeg() {
  const c = QS.built.counts;
  _qsId('qsSeg').innerHTML = '<span class="qs-seg-ind" aria-hidden="true"></span>' + QS_SEGMENTS.map(s => {
    const on = s.key === QS.seg;
    return '<button type="button" class="qs-tab" role="tab" data-seg="' + s.key + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" aria-controls="qsList">' +
      _qsE(s.label) + ' <span class="n">' + (c[s.key] || 0) + '</span></button>';
  }).join('');
  qsMoveInd();
}
/** the selected tab's pill slides to it (a spring, css/quotation-status.css); it lands at once under reduced motion */
function qsMoveInd() {
  const seg = _qsId('qsSeg'), on = seg && seg.querySelector('[aria-selected="true"]'), ind = seg && seg.querySelector('.qs-seg-ind');
  if (!on || !ind) return;
  ind.style.width = on.offsetWidth + 'px';
  ind.style.transform = 'translateX(' + (on.offsetLeft - 2) + 'px)';
}
function qsSetSeg(key, focus) {
  if (QS.seg === key) return;
  QS.seg = key;
  if (QS.selecting && !qsSelectable(key)) qsSelecting(false);
  _qsId('qsSeg').querySelectorAll('[data-seg]').forEach(b => {
    const on = b.getAttribute('data-seg') === key;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  qsMoveInd();
  qsRenderList();
}
function qsSegKeys(e) {
  const keys = QS_SEGMENTS.map(s => s.key), i = keys.indexOf(QS.seg);
  const to = e.key === 'ArrowRight' ? keys[(i + 1) % keys.length] : e.key === 'ArrowLeft' ? keys[(i - 1 + keys.length) % keys.length]
    : e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : '';
  if (to) { e.preventDefault(); qsSetSeg(to, true); }
}
function qsSelectable(seg) { return seg === 'update' || seg === 'pending' || seg === 'notsent'; }

const QS_EMPTY = {
  update: 'Nothing to update. Every sent quotation has a status.',
  pending: 'No pending quotations. A quotation you are still chasing goes here with its last follow-up.',
  won: 'No won quotations yet.',
  closed: 'Nothing closed. A quotation the client did not go ahead with goes here, with the reason.',
  notsent: 'No drafts and nothing in approval.',
  all: 'No quotations yet.'
};

function qsRenderList() {
  if (!QS.loaded) return;
  const rows = qsFilter(QS.built.rows, { seg: QS.seg, q: QS.q });
  const box = _qsId('qsList');
  _qsId('qsSelect').hidden = !QS.ready || !qsSelectable(QS.seg) || !rows.length;
  if (!rows.length) {
    box.innerHTML = '<div class="qs-empty">' + _qsE(QS.q ? 'No quotation matches “' + QS.q.trim() + '”.' : QS_EMPTY[QS.seg]) + '</div>';
    qsRenderBulk();
    return;
  }
  box.innerHTML = qsSections(rows, QS.seg, QS.sort).map(g =>
    (g.title ? '<h2 class="qs-gh">' + _qsE(g.title) + ' <span class="n">' + g.rows.length + '</span></h2>' : '') +
    '<div class="qs-group" role="list">' + g.rows.map(qsRowHtml).join('') + '</div>').join('');
  qsRenderBulk();
}

/** one quotation: the client and the amount, the subject, then the number, when, its age and the last follow-up */
function qsRowHtml(r) {
  const q = r.q, no = String(q.quotationNo), can = r.can, pick = QS.selecting && qsSelectable(r.seg) && can.lost;
  const meta = [no, q.sentAt ? 'sent ' + _qsDay(q.sentAt) : _qsDay(q.date), _qsAge(r.age)];
  if (r.seg === 'pending' || r.seg === 'update') meta.push(r.last.date ? 'last follow-up ' + _qsDay(r.last.date) + (r.last.via ? ' · ' + r.last.via.toLowerCase() : '') : 'no follow-up on record');
  const hints = [];
  if (r.dups.length) hints.push('<button type="button" class="qs-hint dup" data-find="' + _qsE(r.client + ' ' + String(q.subject || '').replace(/\brev\s*\d+\b/ig, '').trim()) + '">' +
    (r.dups.length === 1 ? 'Open twice: also ' + _qsE(r.dups[0]) : 'Open ' + (r.dups.length + 1) + ' times') + ' \u00b7 show them</button>');
  if (r.maybeWon && can.won && QS.ready) hints.push('<button type="button" class="qs-hint win" data-act="won" data-no="' + _qsE(no) + '">Possibly won: ' + _qsE(r.maybeWon.soNo || 'a sales order') + ' · ' + _qsE(_qsDay(r.maybeWon.date)) + '</button>');
  if (r.seg === 'pending' && r.due) hints.push('<span class="qs-hint due">Follow-up due</span>');
  const acts = !QS.ready || pick ? '' : qsActsHtml(r);
  return '<div class="qs-row' + (pick && QS.sel[no] ? ' on' : '') + '" role="listitem" data-no="' + _qsE(no) + '">' +
    (pick ? '<label class="qs-check"><input type="checkbox" data-pick="' + _qsE(no) + '"' + (QS.sel[no] ? ' checked' : '') + '><span class="qs-sr">Select ' + _qsE(no) + '</span></label>' : '') +
    '<div class="qs-main">' +
      '<div class="qs-r1"><span class="qs-client">' + _qsE(r.client) + '</span></div>' +
      '<div class="qs-r2">' + qsChip(r) + '<span class="qs-subj">' + _qsE(q.subject || 'No subject') + '</span></div>' +
      '<div class="qs-r3">' + meta.filter(Boolean).map(m => '<span>' + _qsE(m) + '</span>').join('') + '</div>' +
      (r.seg === 'closed' && q.approvalNote ? '<div class="qs-note">' + _qsE(q.approvalNote) + '</div>' : '') +
      (r.seg !== 'closed' && q.resultNote ? '<div class="qs-note">' + _qsE(q.resultNote) + '</div>' : '') +
      (hints.length ? '<div class="qs-hints">' + hints.join('') + '</div>' : '') +
    '</div><div class="qs-side"><span class="qs-amt">' + _qsPeso(q.total) + '</span>' + acts + '</div></div>';
}
function qsChip(r) {
  const q = r.q, seg = r.seg;
  if (seg === 'won') return '<span class="qs-chip won">' + (QS.hasSO[String(q.quotationNo)] ? 'Won · order' : 'Won') + '</span>';
  if (seg === 'closed') return '<span class="qs-chip closed">' + _qsE(QS_OUTCOME_LABEL[q.status] || q.status) + (q.resultReason ? ' · ' + _qsE(q.resultReason) : '') + '</span>';
  if (seg === 'pending') return '<span class="qs-chip pend">' + _qsE(q.followUpStatus || 'Pending') + '</span>';
  if (seg === 'notsent') return '<span class="qs-chip ns">' + _qsE(q.status === 'Rejected' ? 'Sent back' : String(q.status || 'Draft').indexOf('Pending') === 0 ? 'In approval' : q.status || 'Draft') + '</span>';
  return '<span class="qs-chip up">' + (q.status === 'Approved' ? 'Approved, not sent' : 'No status yet') + '</span>';
}
/** The three actions; on a phone one Update button opens them as a sheet (css hides one set or the other). */
function qsActsHtml(r) {
  const no = _qsE(r.q.quotationNo), can = r.can, b = [];
  if (can.won) b.push('<button type="button" class="qs-act won" data-act="won" data-no="' + no + '" aria-label="Won: ' + no + '">Won</button>');
  if (can.pending) b.push('<button type="button" class="qs-act pend" data-act="pending" data-no="' + no + '" aria-label="Pending: ' + no + '">Pending</button>');
  if (can.lost) b.push('<button type="button" class="qs-act lost" data-act="lost" data-no="' + no + '" aria-label="' + (r.seg === 'closed' ? 'Change the reason' : 'Lost') + ': ' + no + '">' + (r.seg === 'closed' ? 'Reason' : 'Lost') + '</button>');
  if (can.open) b.push('<button type="button" class="qs-act back" data-act="open" data-no="' + no + '" aria-label="Change back: ' + no + '">Change back</button>');
  if (!b.length) return '';
  return '<div class="qs-acts" role="group" aria-label="Set the status of ' + no + '">' + b.join('') + '</div>' +
    '<button type="button" class="qs-update" data-act="update" data-no="' + no + '" aria-haspopup="dialog">Update</button>';
}

function qsListClick(e) {
  const f = e.target.closest('[data-find]');
  if (f) { const v = f.getAttribute('data-find'); QS.q = v; _qsId('qsSearch').value = v; qsSetSeg('all'); qsRenderList(); return; }
  const b = e.target.closest('[data-act]');
  if (!b || !QS.ready) return;
  const r = qsRow(b.getAttribute('data-no'));
  if (!r) return;
  const act = b.getAttribute('data-act');
  if (act === 'update') qsChooser(r, b);
  else if (act === 'won') qsWonSheet(r, b);
  else if (act === 'pending') qsPendingSheet(r, b);
  else if (act === 'lost') qsLostSheet([r], b);
  else if (act === 'open') qsOpenSheet(r, b);
}
function qsListChange(e) {
  const c = e.target.closest('[data-pick]');
  if (!c) return;
  const no = c.getAttribute('data-pick');
  if (c.checked) QS.sel[no] = true; else delete QS.sel[no];
  const row = c.closest('.qs-row'); if (row) row.classList.toggle('on', c.checked);
  qsRenderBulk();
}

/* ── selecting several, to close them together ────────────────────────────────────────────────── */

function qsSelecting(on) {
  QS.selecting = !!on;
  QS.sel = {};
  const b = _qsId('qsSelect');
  b.textContent = on ? 'Done' : 'Select';
  b.setAttribute('aria-pressed', String(!!on));
  qsRenderList();
}
function qsRenderBulk() {
  const bar = _qsId('qsBulk'), n = Object.keys(QS.sel).length;
  bar.hidden = !QS.selecting;
  if (!QS.selecting) return;
  const rows = qsFilter(QS.built.rows, { seg: QS.seg, q: QS.q }).filter(r => r.can.lost);
  bar.innerHTML = '<span class="qs-bulk-n" aria-live="polite">' + (n ? n + ' selected' : 'Select quotations to close') + '</span>' +
    '<button type="button" class="btn btn-secondary" data-bulk="all">' + (n === rows.length && n ? 'Select none' : 'Select all ' + rows.length) + '</button>' +
    '<button type="button" class="btn btn-danger" data-bulk="close"' + (n ? '' : ' disabled') + '>Close ' + (n || '') + '…</button>';
}
function qsBulkClick(e) {
  const b = e.target.closest('[data-bulk]');
  if (!b) return;
  const rows = qsFilter(QS.built.rows, { seg: QS.seg, q: QS.q }).filter(r => r.can.lost);
  if (b.getAttribute('data-bulk') === 'all') {
    const all = Object.keys(QS.sel).length === rows.length && rows.length;
    QS.sel = {}; if (!all) rows.forEach(r => { QS.sel[r.q.quotationNo] = true; });
    qsRenderList();
  } else {
    const picked = rows.filter(r => QS.sel[r.q.quotationNo]);
    if (picked.length) qsLostSheet(picked, b);
  }
}

/* ── the sheet (a bottom sheet on phones: css/apple.css; drag to dismiss: js/apple.js) ─────────── */

function qsOverlay() {
  let ov = _qsId('qsOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.className = 'flow-modal-overlay qs-overlay';
  ov.id = 'qsOverlay';
  ov.innerHTML = '<div class="flow-modal qs-modal" role="dialog" aria-modal="true" aria-labelledby="qsSheetTitle"></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (ev) => {
    if (ev.target === ov) { qsClose(); return; }
    const b = ev.target.closest ? ev.target.closest('[data-close]') : null;
    if (b) qsClose();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ov.classList.contains('open')) qsClose(); });
  return ov;
}
function qsShow(title, sub, body, opener) {
  QS.back = opener || QS.back;
  const ov = qsOverlay(), box = ov.querySelector('.qs-modal');
  box.innerHTML = '<div class="qs-sheet qs-enter"><header class="qs-mhead"><div><h3 id="qsSheetTitle">' + _qsE(title) + '</h3>' +
    (sub ? '<p class="qs-msub">' + sub + '</p>' : '') + '</div><button type="button" class="qs-x" data-close aria-label="Close">' +
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></header>' + body + '</div>';
  ov.classList.add('open');
  document.body.classList.add('qs-open-dlg');
  const first = box.querySelector('[data-first]') || box.querySelector('input, select, textarea, button:not([data-close])');
  if (first) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (e) {} }, 30);
  return box.firstChild;
}
function qsClose() {
  const ov = _qsId('qsOverlay');
  if (!ov || !ov.classList.contains('open')) return;
  ov.classList.remove('open');
  document.body.classList.remove('qs-open-dlg');
  if (QS.back && QS.back.isConnected && QS.back.focus) QS.back.focus();
}
function qsSay(box, text, bad) { const m = box && box.querySelector('.qs-msg'); if (m) { m.textContent = text || ''; m.className = 'qs-msg' + (bad ? ' bad' : ''); } }
function qsHead(r) { return _qsE(r.client) + ' · ' + _qsE(r.q.quotationNo) + ' · ' + _qsPeso(r.q.total); }
function qsFoot(label, danger) {
  return '<div class="qs-foot"><span class="qs-msg" role="status"></span><button type="button" class="btn btn-secondary" data-close>Cancel</button>' +
    '<button type="submit" class="btn ' + (danger ? 'btn-danger' : 'btn-primary primary') + '">' + _qsE(label) + '</button></div>';
}

/** On a phone: the row's choices as one sheet */
function qsChooser(r, opener) {
  const can = r.can, items = [];
  if (can.won) items.push(['won', 'Won', r.maybeWon ? 'Possibly ' + (r.maybeWon.soNo || 'a sales order') : 'The client went ahead']);
  if (can.pending) items.push(['pending', 'Pending', r.last.date ? 'Last follow-up ' + _qsDay(r.last.date) : 'Record the last follow-up']);
  if (can.lost) items.push(['lost', r.seg === 'closed' ? 'Change the reason' : 'Lost', r.seg === 'closed' ? 'Why it was closed' : 'Close it, with the reason']);
  if (can.open) items.push(['open', 'Change back', r.seg === 'closed' ? 'Back to ' + (can.restoreTo || 'where it was') : 'Back to no status']);
  const box = qsShow('Update ' + r.q.quotationNo, qsHead(r), '<div class="qs-choose">' + items.map((it, i) =>
    '<button type="button" class="qs-choice ' + it[0] + '" data-pick-act="' + it[0] + '"' + (i ? '' : ' data-first') + '><b>' + _qsE(it[1]) + '</b><span>' + _qsE(it[2]) + '</span></button>').join('') +
    '</div><div class="qs-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button></div>', opener);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick-act]');
    if (!b) return;
    const a = b.getAttribute('data-pick-act');
    if (a === 'won') qsWonSheet(r, opener); else if (a === 'pending') qsPendingSheet(r, opener); else if (a === 'lost') qsLostSheet([r], opener); else qsOpenSheet(r, opener);
  });
}

/* Won */
function qsWonSheet(r, opener) {
  const so = r.maybeWon;
  const body = '<form class="qs-form" novalidate>' +
    (so ? '<p class="qs-card">A sales order for this client may be the one: <b>' + _qsE(so.soNo || 'no number') + '</b>, ' + _qsE(_qsDay(so.date)) + ', ' + _qsPeso(so.total) + '.' +
      ' <button type="button" class="qs-link" data-sofill="' + _qsE(so.soNo) + '">Put it in the note</button></p>' : '') +
    '<label>Note (optional)<input type="text" class="qs-in" name="note" maxlength="300" placeholder="Their PO number, or the sales order" data-first></label>' +
    '<p class="qs-hint-t">The quotation counts as won. When its sales order is made, the order is linked as usual.</p>' +
    qsFoot('Mark won') + '</form>';
  const box = qsShow('Mark ' + r.q.quotationNo + ' won', qsHead(r), body, opener);
  const form = box.querySelector('form');
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-sofill]'); if (b) { form.note.value = 'Sales order ' + b.getAttribute('data-sofill'); form.note.focus(); } });
  form.addEventListener('submit', (e) => { e.preventDefault(); qsSave(box, { quotationNo: r.q.quotationNo, result: 'won', note: form.note.value.trim() }, 'won'); });
}

/* Lost (one, or several selected) */
function qsLostSheet(rows, opener) {
  const one = rows.length === 1 ? rows[0] : null;
  const pills = QS_LOST_REASONS.map(([reason, outcome], i) =>
    '<label class="qs-pill"><input type="radio" name="reason" value="' + _qsE(reason) + '"' + (one && one.q.resultReason === reason ? ' checked' : '') + (i ? '' : ' data-first') + '>' +
    '<span>' + _qsE(reason) + '</span></label>').join('');
  const body = '<form class="qs-form" novalidate><fieldset class="qs-pills"><legend>Why</legend>' + pills + '</fieldset>' +
    '<p class="qs-outcome" aria-live="polite"></p>' +
    '<label>Note' + ' <span class="qs-opt">(needed for Other)</span><textarea class="qs-in" name="note" rows="2" maxlength="300" placeholder="What happened"></textarea></label>' +
    qsFoot(one ? (one.seg === 'closed' ? 'Save the reason' : 'Close quotation') : 'Close ' + rows.length + ' quotations', true) + '</form>';
  const title = one ? (one.seg === 'closed' ? 'Why ' + one.q.quotationNo + ' was closed' : 'Close ' + one.q.quotationNo) : 'Close ' + rows.length + ' quotations';
  const sub = one ? qsHead(one) : _qsE(rows.slice(0, 3).map(r => r.q.quotationNo).join(', ') + (rows.length > 3 ? ' and ' + (rows.length - 3) + ' more' : ''));
  const box = qsShow(title, sub, body, opener);
  const form = box.querySelector('form');
  const tell = () => { const v = (form.querySelector('input[name="reason"]:checked') || {}).value, o = qsOutcomeFor(v);
    box.querySelector('.qs-outcome').textContent = o ? 'It will be recorded as ' + QS_OUTCOME_LABEL[o].toLowerCase() + '.' : ''; };
  form.addEventListener('change', tell); tell();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = { reason: (form.querySelector('input[name="reason"]:checked') || {}).value || '', note: form.note.value.trim() };
    const bad = qsValidate('lost', f);
    if (bad) { qsSay(box, bad, true); return; }
    if (one) { qsSave(box, { quotationNo: one.q.quotationNo, result: 'lost', reason: f.reason, note: f.note }, 'lost'); return; }
    await qsBulkSave(box, rows.map(r => r.q.quotationNo), f);
  });
}

/* Change back: a closed quotation to the status it was closed from; a won or pending one to no status */
function qsOpenSheet(r, opener) {
  const to = r.seg === 'closed' ? (r.can.restoreTo || 'where it was') : 'no status';
  const body = '<form class="qs-form"><p class="qs-card">' + (r.seg === 'closed'
      ? 'It goes back to <b>' + _qsE(to) + '</b>, as it was before it was closed.'
      : 'It goes back to the list to update. Its follow-up record stays.') + '</p>' + qsFoot('Change back') + '</form>';
  const box = qsShow('Change ' + r.q.quotationNo + ' back', qsHead(r), body, opener);
  box.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); qsSave(box, { quotationNo: r.q.quotationNo, result: 'open' }, 'open'); });
}

/* Pending: the last follow-up (a linked email, a picked email, or a date and how) and where it stands */
function qsPendingSheet(r, opener) {
  const q = r.q, mine = _qsMine(q), linked = r.linked;
  const via = linked ? 'Email' : (q.followUpVia || (mine ? 'Email' : 'Call'));
  const status = QS_FOLLOWUP_STATUSES.map((s, i) => '<label class="qs-pill"><input type="radio" name="status" value="' + _qsE(s) + '"' +
    (q.followUpStatus === s ? ' checked' : '') + '><span>' + _qsE(s) + '</span></label>').join('');
  const ways = QS_FOLLOWUP_VIA.map(w => '<label class="qs-pill"><input type="radio" name="via" value="' + w + '"' + (w === via ? ' checked' : '') + '><span>' + w + '</span></label>').join('');
  const body = '<form class="qs-form" novalidate>' +
    (linked
      ? '<p class="qs-card qs-linked"><b>Last follow-up: ' + _qsE(_qsDay(linked.sentAt)) + ', by email</b><span>' + _qsE(linked.subject || '(no subject)') + '</span>' +
        '<span class="qs-dim">Already linked to this quotation, so there is nothing to pick.</span></p>'
      : '<fieldset class="qs-pills qs-via"><legend>How you followed up</legend>' + ways + '</fieldset>' +
        '<div class="qs-pick" data-pickbox></div>' +
        '<label class="qs-datel" data-datebox>Date of the last follow-up<input type="date" class="qs-in" name="date" max="' + _qsE(QS.today) + '" min="' + _qsE(flowDate(q.date) || '') + '" value="' + _qsE(flowDate(q.lastFollowUp) || '') + '"></label>') +
    '<fieldset class="qs-pills"><legend>Where it stands</legend>' + status + '</fieldset>' +
    '<label>Note <span class="qs-opt">(needed for Other)</span><input type="text" class="qs-in" name="note" maxlength="300" value="' + _qsE(q.resultNote || '') + '" placeholder="Buyer on leave until 5 Nov"></label>' +
    qsFoot('Save') + '</form>';
  const box = qsShow('Pending: ' + q.quotationNo, qsHead(r), body, opener);
  const form = box.querySelector('form');
  const st = { email: null };
  const syncVia = () => {
    if (linked) return;
    const v = (form.querySelector('input[name="via"]:checked') || {}).value;
    const pick = box.querySelector('[data-pickbox]'), date = box.querySelector('[data-datebox]');
    const usePick = v === 'Email' && mine;
    date.hidden = usePick && !!st.email;
    if (v === 'Email' && !mine) {   // the picker reads only the viewer's own mailbox
      pick.hidden = false;
      pick.innerHTML = '<p class="qs-dim">Emails can be picked only from ' + _qsE(_qsFirst(r.owner)) + '’s own mailbox. Give the date instead.</p>';
    } else {
      pick.hidden = !usePick;
      if (usePick) qsPickRender(box, r, st);
    }
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'via') { st.email = null; syncVia(); }
    if (e.target.name === 'mail') {
      const m = QS.mail.emails.find(x => String(x.messageId) === e.target.value) || null;
      st.email = m;
      box.querySelector('[data-datebox]').hidden = !!m;
    }
  });
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-older]'); if (b) qsMailOlder(box, r, st); });
  box.addEventListener('input', (e) => { if (e.target.name === 'mailq') qsPickRender(box, r, st); });
  syncVia();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = linked ? 'Email' : (form.querySelector('input[name="via"]:checked') || {}).value || '';
    const f = { via: v, email: linked ? null : st.email, date: linked ? flowDate(linked.sentAt) : (st.email ? '' : (form.date ? form.date.value : '')),
                status: (form.querySelector('input[name="status"]:checked') || {}).value || '', note: form.note.value.trim() };
    const bad = qsValidate('pending', f, q, QS.today);
    if (bad) { qsSay(box, bad, true); return; }
    const p = { quotationNo: q.quotationNo, result: 'pending', followUpStatus: f.status, note: f.note };
    if (f.email) p.email = JSON.stringify({ messageId: f.email.messageId, sentAt: f.email.sentAt || f.email.date || '', subject: f.email.subject || '',
      to: (f.email.recipients || []).map(x => x.addr).filter(Boolean).join(', ') || f.email.recipient || '', threadRoot: f.email.threadRoot || '', mailboxAddr: QS.mail.addr || '' });
    else { p.followUpVia = f.via; p.followUpDate = f.date; }
    qsSave(box, p, 'pending');
  });
}

/* the follow-up email picker: the rep's own Sent mail, ranked for this quotation as a follow-up (quotation-email-match) */
async function qsMailLoad(force) {
  if (QS.mail.state === 'loading' || (QS.mail.state === 'ready' && !force)) return;
  QS.mail.state = 'loading';
  try {
    const r = await apiFetchEmailFeed('sent', 120, !!force);
    if (r && r.needsSetup) { QS.mail.state = 'setup'; QS.mail.reconnect = !!r.reconnect; return; }
    if (!r || r.success === false) { QS.mail.state = 'error'; QS.mail.msg = (r && r.message) || 'Could not read your sent mail.'; return; }
    QS.mail.emails = r.emails || []; QS.mail.addr = r.godaddyEmail || ''; QS.mail.truncated = !!r.truncated; QS.mail.state = 'ready';
  } catch (e) { QS.mail.state = 'error'; QS.mail.msg = String(e && e.message || e); }
}
async function qsMailOlder(box, r, st) {
  const pick = box.querySelector('[data-pickbox]'), btn = pick && pick.querySelector('[data-older]');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching older mail…'; }
  const cl = QS.clients[String(r.q.customer || '').toLowerCase().trim()] || {};
  try {
    const res = await apiFindSentEmails(qsMailMatch(r.q, cl.email), 180);
    const have = {}; QS.mail.emails.forEach(m => { have[String(m.messageId)] = true; });
    ((res && res.emails) || []).forEach(m => { if (!have[String(m.messageId)]) QS.mail.emails.push(m); });
    st.searched = true;
  } catch (e) { st.searched = true; }
  qsPickRender(box, r, st);
}
function qsPickCtx(r) {
  const byNo = {}; QS.all.forEach(q => { byNo[String(q.quotationNo)] = q; });
  const all = []; Object.keys(QS.links).forEach(k => (QS.links[k] || []).forEach(l => all.push(l)));
  const linked = {}, threads = {};
  all.forEach(l => { const id = String(l.messageId || '').toLowerCase(); if (id && String(l.status || 'Active') === 'Active') linked[id] = String(l.quotationNo); });
  (QS.links[String(r.q.quotationNo)] || []).forEach(l => { if (l.threadRoot) threads[String(l.threadRoot).toLowerCase()] = true; });
  const emails = {}, refs = {};
  Object.keys(QS.clients).forEach(k => { if (QS.clients[k].email) emails[k] = QS.clients[k].email; if (QS.clients[k].rfqRef) refs[k] = QS.clients[k].rfqRef; });
  return { clientDomains: typeof qemLearnDomains === 'function' ? qemLearnDomains(all, byNo) : {}, clientEmails: emails, clientRefs: refs,
           dismissed: {}, linked: linked, mailboxOwner: QS.me, followUp: { sentAt: r.q.sentAt, threads: threads, today: QS.today } };
}
async function qsPickRender(box, r, st) {
  const pick = box.querySelector('[data-pickbox]');
  if (!pick || pick.hidden) return;
  if (QS.mail.state !== 'ready') {
    pick.innerHTML = '<p class="qs-dim" role="status">Reading your sent mail…</p>';
    await qsMailLoad(false);
    if (!box.isConnected) return;
  }
  if (QS.mail.state === 'setup') {
    pick.innerHTML = '<p class="qs-card">Your mailbox is ' + (QS.mail.reconnect ? 'no longer connected' : 'not connected') + '. <a href="email-setup.html">Connect it</a>, or choose Call, Viber or Visit and give the date.</p>';
    return;
  }
  if (QS.mail.state === 'error') { pick.innerHTML = '<p class="qs-card bad">' + _qsE(QS.mail.msg) + ' Give the date instead, or try again later.</p>'; return; }
  const term = String((pick.querySelector('input[name="mailq"]') || {}).value || '').trim().toLowerCase();
  let ranked = typeof qemRank === 'function' ? qemRank(r.q, QS.mail.emails, qsPickCtx(r)) : QS.mail.emails.map(m => ({ msg: m, score: 0, reasons: [] }));
  ranked = ranked.filter(x => x.score > -400);
  if (term) ranked = ranked.filter(x => (String(x.msg.subject || '') + ' ' + (x.msg.recipients || []).map(p => p.addr + ' ' + p.name).join(' ') + ' ' + (x.msg.recipient || '')).toLowerCase().indexOf(term) >= 0);
  const show = ranked.slice(0, term ? 40 : 8);
  const chosen = st.email ? String(st.email.messageId) : '';
  pick.innerHTML = '<label class="qs-mailq"><span class="qs-sr">Search your sent mail</span><input type="search" class="qs-in" name="mailq" value="' + _qsE(term) + '" placeholder="Search your sent mail" autocomplete="off"></label>' +
    (show.length ? '<div class="qs-mails" role="radiogroup" aria-label="The email that was the last follow-up">' + show.map(x => {
      const m = x.msg, id = String(m.messageId || ''), to = (m.recipients && m.recipients[0] && (m.recipients[0].name || m.recipients[0].addr)) || m.recipient || '';
      return '<label class="qs-mail' + (id === chosen ? ' on' : '') + '"><input type="radio" name="mail" value="' + _qsE(id) + '"' + (id === chosen ? ' checked' : '') + '>' +
        '<span class="qs-mail-t"><b>' + _qsE(m.subject || '(no subject)') + '</b><span>' + _qsE(to) + ' · ' + _qsE(_qsDay(m.sentAt || m.date)) + '</span>' +
        (x.reasons && x.reasons.length ? '<span class="qs-why">' + _qsE(x.reasons.slice(0, 2).join(' · ')) + '</span>' : '') + '</span></label>';
    }).join('') + '</div>' : '<p class="qs-dim">' + (term ? 'No sent email matches.' : 'No sent email found for this quotation in the last 120 days.') + '</p>') +
    (st.searched ? '' : '<button type="button" class="qs-link" data-older>Search older mail to this client</button>') +
    '<p class="qs-dim">Not by email? Choose Call, Viber or Visit above.</p>';
  const inp = pick.querySelector('input[name="mailq"]');
  if (term && inp) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} }
}

/* ── saving, and Undo ─────────────────────────────────────────────────────────────────────────── */

async function qsPost(params) {
  return postFlow('setQuotationResult', params).catch(e => ({ success: false, message: String(e && e.message || e) }));
}
function qsMissing(res) { return !!(res && !res.success && /Unknown action|not a secured action/i.test(String(res.message || ''))); }

/** Lay the server's returned states over the rows the page holds and redraw, without a reload. */
function qsTakeResults(results) {
  const by = {}; (results || []).forEach(s => { by[String(s.quotationNo)] = s; });
  QS.all = QS.all.map(q => by[String(q.quotationNo)] ? qsApply(q, by[String(q.quotationNo)]) : q);
  qsBuildRows();
  qsRender();
}

async function qsSave(box, params, kind) {
  const btn = box.querySelector('button[type="submit"]');
  if (QS.busy) return;
  QS.busy = true;
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Saving…'; }
  const res = await qsPost(params);
  QS.busy = false;
  if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Save'; }
  if (qsMissing(res)) { QS.ready = false; qsSay(box, 'This needs the FlowAPI update (version 191), which is not pasted yet.', true); qsRender(); return; }
  if (!res || !res.success) { qsSay(box, (res && res.message) || 'Could not save. Try again.', true); return; }
  if (res.linkId) {   // the picked email is now linked: keep it in the page's own copy, so the next Pending skips the pick
    const no = String(params.quotationNo), e = JSON.parse(params.email || '{}');
    (QS.links[no] = QS.links[no] || []).push({ linkId: res.linkId, quotationNo: no, messageId: e.messageId, sentAt: e.sentAt, subject: e.subject, threadRoot: e.threadRoot, kind: 'Follow-up', status: 'Active' });
  }
  qsClose();
  qsTakeResults(res.results);
  const now = (res.results || [])[0];
  const undo = now && !now.alreadyWon && !now.unchanged ? qsUndo(now.previous, now) : null;
  if (undo && typeof window.hxSnackbar === 'function') {
    window.hxSnackbar(res.message || 'Saved.', { action: 'Undo', onAction: () => qsUndoRun(undo) });
  } else if (typeof window.hxToast === 'function') window.hxToast(res.message || 'Saved.', { tone: 'ok' });
}
async function qsUndoRun(p) {
  const res = await qsPost(p);
  if (!res || !res.success) { if (typeof window.hxToast === 'function') window.hxToast((res && res.message) || 'Could not undo.', { tone: 'error' }); return; }
  qsTakeResults(res.results);
  if (typeof window.hxToast === 'function') window.hxToast('Put back as it was.', { tone: 'ok' });
}

/** Several at once: QS_BULK_MAX per call, in turn; one Undo for them all */
async function qsBulkSave(box, nos, f) {
  const btn = box.querySelector('button[type="submit"]');
  if (QS.busy) return;
  QS.busy = true;
  if (btn) btn.disabled = true;
  const done = [], refused = [];
  for (let i = 0; i < nos.length; i += QS_BULK_MAX) {
    const part = nos.slice(i, i + QS_BULK_MAX);
    if (btn) btn.textContent = 'Closing ' + Math.min(i + part.length, nos.length) + ' of ' + nos.length + '…';
    const res = await qsPost({ quotationNos: JSON.stringify(part), result: 'lost', reason: f.reason, note: f.note });
    if (qsMissing(res)) { QS.ready = false; break; }
    if (!res || !res.success) { refused.push({ message: (res && res.message) || 'Could not close.' }); continue; }
    (res.results || []).forEach(x => done.push(x));
    (res.refused || []).forEach(x => refused.push(x));
  }
  QS.busy = false;
  if (btn) { btn.disabled = false; btn.textContent = 'Close ' + nos.length + ' quotations'; }
  if (!done.length) { qsSay(box, refused.length ? refused[0].message : 'This needs the FlowAPI update (version 191).', true); return; }
  qsClose();
  qsSelecting(false);
  qsTakeResults(done);
  const undo = qsUndoBulk(done);
  const say = 'Closed ' + done.length + ' quotation' + (done.length === 1 ? '' : 's') + (refused.length ? '; ' + refused.length + ' could not be' : '') + '.';
  if (undo && typeof window.hxSnackbar === 'function') window.hxSnackbar(say, { action: 'Undo', onAction: () => qsUndoBulkRun(undo) });
  else if (typeof window.hxToast === 'function') window.hxToast(say, { tone: 'ok' });
}
async function qsUndoBulkRun(undo) {
  const back = [];
  for (let i = 0; i < undo.quotationNos.length; i += QS_BULK_MAX) {
    const part = undo.quotationNos.slice(i, i + QS_BULK_MAX), notes = {};
    part.forEach(n => { notes[n] = undo.approvalNotes[n]; });
    const res = await qsPost({ quotationNos: JSON.stringify(part), result: 'open', keep: true, approvalNotes: JSON.stringify(notes) });
    if (res && res.success) (res.results || []).forEach(x => back.push(x));
  }
  qsTakeResults(back);
  if (typeof window.hxToast === 'function') window.hxToast(back.length ? 'Put ' + back.length + ' back as they were.' : 'Could not undo.', { tone: back.length ? 'ok' : 'error' });
}
