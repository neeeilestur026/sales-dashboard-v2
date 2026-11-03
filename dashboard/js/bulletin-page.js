/* bulletin-page.js — A390 · the bulletin board page (bulletin.html): every announcement, for everyone.
 *
 * Board (what is up now, for my role), History (what has ended), and for the writers — HR, admin, the director, management
 * — All posts: every post with who has seen it, and the tools: New, Edit, Pin, Archive (with Undo, never a confirm).
 * The composer is a sheet (a bottom sheet on phones): title, message, kind, who it is for (Everyone or roles), pin,
 * show until, one file or image. Writers also get, once, "Bring the HR memos onto the board" (the board replaced HR
 * Memos): a preview first, then the import. Posts are drawn by window.hxBoard.itemHtml (js/bulletin.js); the words and
 * rules are js/bulletin-model.js. Built to the apple-design skill on the A344 tokens (css/bulletin-page.css).
 */
const BBP = { s: null, may: {}, seg: 'board', q: '', data: {}, roster: null, today: '', back: null, file: null, editing: null, memos: null };

function _bbpE(s) { return typeof flowEsc === 'function' ? flowEsc(s) : String(s == null ? '' : s); }
function _bbpId(id) { return document.getElementById(id); }
function _bbpToast(t, tone) { if (typeof hxToast === 'function') hxToast(t, { tone: tone }); }
function _bbpOld(r) { return /unknown action|not a secured action/i.test(String(r && r.message)); }

document.addEventListener('DOMContentLoaded', async () => {
  const s = typeof requireBulletinAccess === 'function' ? requireBulletinAccess() : null;
  if (!s) return;
  BBP.s = s;
  if (typeof renderNavbar === 'function') renderNavbar('bulletin');
  _bbpId('bbpSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-seg]'); if (b) bbpSeg(b.getAttribute('data-seg')); });
  _bbpId('bbpSeg').addEventListener('keydown', bbpSegKeys);
  _bbpId('bbpQ').addEventListener('input', (e) => { BBP.q = e.target.value; bbpRender(); });
  _bbpId('bbpNew').addEventListener('click', (e) => bbpCompose(null, e.currentTarget));
  _bbpId('bbpList').addEventListener('click', bbpListClick);
  await bbpLoad();
  if (typeof hxDeepLink === 'function') hxDeepLink(() => { if (BBP.may.write) bbpCompose(null, null); });
  const id = new URLSearchParams(location.search || '').get('id');
  if (id) { const el = document.querySelector('[data-bb="' + CSS.escape(id) + '"]'); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('bbp-flash'); } }
});

async function bbpRead(view) {
  return postFlow('getBulletin', { view }).catch(e => ({ success: false, message: String(e && e.message || e) }));
}
async function bbpLoad() {
  _bbpId('bbpList').innerHTML = '<p class="bbp-empty">Reading the board…</p>';
  const board = await bbpRead('board');
  if (!board || !board.success) {
    _bbpId('bbpNotice').innerHTML = '<p class="bbp-notice' + (_bbpOld(board) ? '' : ' bad') + '">' + _bbpE(_bbpOld(board)
      ? 'The bulletin board needs FlowAPI 195. Paste it in Apps Script and make a new deployment, then reload this page.'
      : (board && board.message) || 'The board could not be read.') + '</p>';
    _bbpId('bbpList').innerHTML = '';
    return;
  }
  BBP.may = board.may || {}; BBP.today = board.today || (typeof flowToday === 'function' ? flowToday() : '');
  BBP.data.board = board.items || [];
  _bbpId('bbpNew').hidden = !BBP.may.write;
  if (BBP.may.write) {
    const [hist, all] = await Promise.all([bbpRead('history'), bbpRead('manage')]);
    BBP.data.history = (hist && hist.items) || [];
    BBP.data.manage = (all && all.items) || [];
    BBP.log = (all && all.log) || [];
    bbpImportPanel();
  } else {
    BBP.data.history = null;   // read when the tab is opened
  }
  bbpRender();
}
const BBP_SEGS = [['board', 'Board'], ['history', 'History'], ['manage', 'All posts']];
function bbpSegs() { return BBP_SEGS.filter(x => x[0] !== 'manage' || BBP.may.write); }
async function bbpSeg(k, focus) {
  BBP.seg = k;
  if (k === 'history' && !BBP.data.history) { const h = await bbpRead('history'); BBP.data.history = (h && h.items) || []; }
  bbpRender();
  if (focus) { const b = document.querySelector('#bbpSeg [data-seg="' + k + '"]'); if (b) b.focus(); }
}
function bbpSegKeys(e) {
  const ids = bbpSegs().map(x => x[0]), i = ids.indexOf(BBP.seg);
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  bbpSeg(ids[(i + step + ids.length) % ids.length], true);
}
/** The segmented control's buttons are redrawn, its indicator is kept: it slides from wherever it stands (even mid-slide),
 *  a redraw to the same segment does not move it, and the first time it is simply placed, so nothing moves on load. */
function _bbpSegDraw(seg, buttonsHtml) {
  let th = seg.querySelector('.bbp-thumb');
  const first = !th;
  Array.prototype.slice.call(seg.children).forEach(c => { if (c !== th) c.remove(); });
  seg.insertAdjacentHTML('beforeend', buttonsHtml);
  if (first) { th = document.createElement('span'); th.className = 'bbp-thumb now'; th.setAttribute('aria-hidden', 'true'); seg.insertBefore(th, seg.firstChild); }
  const on = seg.querySelector('[aria-selected="true"]');
  if (on && typeof on.offsetLeft === 'number') { th.style.width = on.offsetWidth + 'px'; th.style.transform = 'translateX(' + on.offsetLeft + 'px)'; }
  if (first) { void th.offsetWidth; th.classList.remove('now'); }
}
function bbpRender() {
  const seg = _bbpId('bbpSeg');
  _bbpSegDraw(seg, bbpSegs().map(x => {
    const on = x[0] === BBP.seg, n = (BBP.data[x[0]] || []).length;
    return '<button type="button" role="tab" class="bbp-segb" data-seg="' + x[0] + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + _bbpE(x[1]) +
      (BBP.data[x[0]] ? ' <span class="n">' + n + '</span>' : '') + '</button>';
  }).join(''));
  const items = bbmFilter(BBP.data[BBP.seg] || [], BBP.q);
  const write = BBP.may.write && BBP.seg !== 'history';
  const tools = (it) => !BBP.may.write ? '' : '<span class="bbp-acts">' +
    (BBP.seg === 'manage' ? '<button type="button" class="bbp-link" data-seen="' + _bbpE(it.bulletinNo) + '">' + _bbpE(bbmSeenLine(bbmSeen(it, BBP.roster))) + '</button>' : '') +
    (it.status !== 'Archived' ? '<button type="button" class="bbp-link" data-edit="' + _bbpE(it.bulletinNo) + '">Edit</button>' +
      (it.status === 'Live' ? '<button type="button" class="bbp-link" data-pin="' + _bbpE(it.bulletinNo) + '">' + (it.pinned ? 'Unpin' : 'Pin') + '</button>' : '') +
      '<button type="button" class="bbp-link" data-arch="' + _bbpE(it.bulletinNo) + '">Archive</button>'
      : '<button type="button" class="bbp-link" data-restore="' + _bbpE(it.bulletinNo) + '">Restore</button>') + '</span>';
  _bbpId('bbpList').innerHTML = !items.length
    ? '<p class="bbp-empty">' + _bbpE(BBP.q ? 'Nothing matches “' + BBP.q + '”.' : BBP.seg === 'history' ? 'Nothing has ended yet.' : BBP.seg === 'manage' ? 'Nothing posted yet.' :
        'Nothing on the board.' + (BBP.may.write ? ' Post the first announcement.' : '')) + '</p>'
    : items.map(it => window.hxBoard.itemHtml(it, { ack: BBP.seg === 'board', tools: write || BBP.seg === 'manage' ? tools(it) : '' }) +
        (BBP.seg === 'manage' ? '<p class="bbp-aud">For ' + _bbpE(bbmAudienceLabel(it.audience)) + (it.source === 'memo' ? ' · from HR Memos' : '') + '</p>' : '')).join('');
  window.hxBoard.thumbs(_bbpId('bbpList'));
  if (BBP.seg === 'manage' && !BBP.roster) bbpRoster();
}
async function bbpRoster() {
  if (BBP.roster || typeof apiGetUsers !== 'function') return;
  try { const r = await apiGetUsers(); BBP.roster = (r && (r.data || r.users)) || []; } catch (e) { BBP.roster = []; }
  if (BBP.seg === 'manage') bbpRender();
}
function bbpFind(no) { return ['board', 'manage', 'history'].map(k => (BBP.data[k] || []).find(x => x.bulletinNo === no)).filter(Boolean)[0] || null; }

async function bbpListClick(e) {
  const g = e.target.closest('[data-got]');
  if (g) return window.hxBoard.gotIt(g, () => { const it = bbpFind(g.getAttribute('data-got')); if (it) it.gotIt = new Date().toISOString(); bbpRender(); });
  const f = e.target.closest('[data-file]'); if (f) return window.hxBoard.openFile(f.getAttribute('data-file'));
  const ed = e.target.closest('[data-edit]'); if (ed) return bbpCompose(bbpFind(ed.getAttribute('data-edit')), ed);
  const pn = e.target.closest('[data-pin]');
  if (pn) { const it = bbpFind(pn.getAttribute('data-pin')); return bbpSaveQuick(it, { pinned: !it.pinned }, it.pinned ? 'Unpinned.' : 'Pinned to the top.'); }
  const ar = e.target.closest('[data-arch]'); if (ar) return bbpArchive(ar.getAttribute('data-arch'), false);
  const rs = e.target.closest('[data-restore]'); if (rs) return bbpArchive(rs.getAttribute('data-restore'), true);
  const sn = e.target.closest('[data-seen]'); if (sn) return bbpSeenSheet(bbpFind(sn.getAttribute('data-seen')), sn);
}
async function bbpSaveQuick(it, fields, msg) {
  const r = await postFlow('saveBulletin', Object.assign({ bulletinNo: it.bulletinNo, ifUpdatedAt: it.updatedAt }, fields)).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (!r || !r.success) return _bbpToast((r && r.message) || 'Not saved.', 'error');
  _bbpToast(msg, 'ok');
  bbpLoad();
}
/** Archive with an Undo (restore), never a confirm. */
async function bbpArchive(no, restore) {
  const r = await postFlow('archiveBulletin', { bulletinNo: no, restore }).catch(e => ({ success: false, message: String(e && e.message || e) }));
  if (!r || !r.success) return _bbpToast((r && r.message) || 'Not saved.', 'error');
  await bbpLoad();
  if (!restore && typeof hxSnackbar === 'function') hxSnackbar('Taken off the board.', { action: 'Undo', onAction: () => bbpArchive(no, true) });
  else _bbpToast(r.message, 'ok');
}

/* ── the sheets ───────────────────────────────────────────────────────────────────────────────── */

function bbpSheet(html, back) {
  BBP.back = back || document.activeElement;
  let ov = _bbpId('bbpOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'modal-overlay bbp-overlay'; ov.id = 'bbpOverlay';
    ov.innerHTML = '<div class="modal wide bbp-modal" role="dialog" aria-modal="true" aria-labelledby="bbpSheetTitle"></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || (e.target.closest && e.target.closest('[data-close]'))) bbpClose(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('open')) bbpClose(); });
  }
  const box = ov.querySelector('.bbp-modal');
  box.innerHTML = html;
  ov.classList.add('open');
  const first = box.querySelector('input, textarea, button');
  if (first) first.focus();
  return box;
}
function bbpClose() {
  const ov = _bbpId('bbpOverlay');
  if (ov) ov.classList.remove('open');
  if (BBP.back && BBP.back.focus) BBP.back.focus();
}
function bbpSeenSheet(it, back) {
  if (!it) return;
  const s = bbmSeen(it, BBP.roster);
  const roleName = (r) => (BBM_ROLES.find(x => x[0] === r) || [r, r || 'Other'])[1];
  bbpSheet('<h3 id="bbpSheetTitle">' + _bbpE(it.title) + '</h3><p class="bbp-sub">' + _bbpE(bbmSeenLine(s)) + ' · for ' + _bbpE(bbmAudienceLabel(it.audience)) + '</p>' +
    '<div class="bbp-cols"><section><h4>Got it</h4>' + (s.seen.length ? '<ol class="bbp-people">' + s.seen.map(p => '<li><b>' + _bbpE(p.name) + '</b><span>' +
      _bbpE([roleName(p.role), window.hxBoard.dayLabel(p.at)].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ol>' : '<p class="bbp-empty">Nobody yet.</p>') + '</section>' +
    '<section><h4>Not yet</h4>' + (!BBP.roster || !BBP.roster.length ? '<p class="bbp-empty">The staff list could not be read, so only who has seen it is shown.</p>'
      : Object.keys(s.byRole).length ? Object.keys(s.byRole).map(r => '<p class="bbp-role">' + _bbpE(roleName(r)) + '</p><ol class="bbp-people">' + s.byRole[r].map(n => '<li><b>' + _bbpE(n) + '</b></li>').join('') + '</ol>').join('')
      : '<p class="bbp-empty">Everyone has seen it.</p>') + '</section></div>' +
    '<div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Close</button></div>', back);
}
/** New or edit. A field left as it was is not sent, so a save never overwrites someone else's change to it. */
function bbpCompose(it, back) {
  if (!BBP.may.write) return;
  BBP.editing = it; BBP.file = null;
  const aud = (it && it.audience) || ['all'], every = aud.indexOf('all') >= 0;
  const html = '<form class="bbp-form" novalidate><h3 id="bbpSheetTitle">' + (it ? 'Edit the announcement' : 'New announcement') + '</h3>' +
    '<label>Title <span class="bbp-count" data-count="title"></span><input type="text" class="bbp-in" name="title" maxlength="120" value="' + _bbpE(it ? it.title : '') + '" required></label>' +
    '<label>Message <span class="bbp-count" data-count="body"></span><textarea class="bbp-in" name="body" rows="6" maxlength="3000">' + _bbpE(it ? it.body : '') + '</textarea></label>' +
    '<fieldset class="bbp-field"><legend>Kind</legend><div class="bbp-chips" role="radiogroup">' + BBM_KINDS.map(k => '<label class="bbp-chip"><input type="radio" name="kind" value="' + _bbpE(k) + '"' +
      ((it ? it.kind : 'Announcement') === k ? ' checked' : '') + '><span>' + _bbpE(k) + '</span></label>').join('') + '</div></fieldset>' +
    '<fieldset class="bbp-field"><legend>Who it is for</legend><div class="bbp-chips">' +
      '<label class="bbp-chip"><input type="checkbox" name="everyone"' + (every ? ' checked' : '') + '><span>Everyone</span></label>' +
      BBM_ROLES.map(r => '<label class="bbp-chip"><input type="checkbox" name="role" value="' + r[0] + '"' + (!every && aud.indexOf(r[0]) >= 0 ? ' checked' : '') + '><span>' + _bbpE(r[1]) + '</span></label>').join('') +
    '</div></fieldset>' +
    '<div class="bbp-row"><label class="bbp-switch"><input type="checkbox" name="pinned"' + (it && it.pinned ? ' checked' : '') + '><span>Pin to the top</span></label>' +
      '<label>Show until <input type="date" class="bbp-in" name="showUntil" min="' + _bbpE(BBP.today) + '" value="' + _bbpE(it ? it.showUntil : '') + '"></label></div>' +
    '<div class="bbp-file" data-filebox>' + (it && it.file ? '<span class="bbp-fname">' + _bbpE(it.file.name) + '</span><button type="button" class="bbp-link" data-rmfile>Remove the file</button>' : '') +
      '<label class="btn btn-secondary btn-sm bbp-pick">' + (it && it.file ? 'Replace the file' : 'Attach a file or picture') +
      '<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.docx,.xlsx,.pptx,.txt,.csv" hidden></label></div>' +
    '<p class="bbp-msg" aria-live="polite"></p><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button>' +
    '<button type="submit" class="btn btn-primary primary">' + (it ? 'Save' : 'Post') + '</button></div></form>';
  const box = bbpSheet(html, back), form = box.querySelector('form'), msg = box.querySelector('.bbp-msg');
  let removeFile = false;
  const fld = (n) => form.elements.namedItem(n);   // form.title is the form's own title attribute, not the field
  const read = () => {
    const roles = Array.from(form.querySelectorAll('input[name="role"]:checked')).map(x => x.value);
    return { title: fld('title').value, body: fld('body').value, kind: (form.querySelector('input[name="kind"]:checked') || {}).value || 'Announcement',
             everyone: fld('everyone').checked, roles, pinned: fld('pinned').checked, showUntil: fld('showUntil').value,
             hasFile: !!BBP.file || (!!(it && it.file) && !removeFile) };
  };
  const counts = () => {
    form.querySelector('[data-count="title"]').textContent = fld('title').value.length + ' / 120';
    form.querySelector('[data-count="body"]').textContent = fld('body').value.length + ' / 3000';
  };
  counts();
  form.addEventListener('input', () => { counts(); msg.textContent = ''; msg.className = 'bbp-msg'; });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'everyone' && e.target.checked) form.querySelectorAll('input[name="role"]').forEach(x => { x.checked = false; });
    if (e.target.name === 'role' && e.target.checked) fld('everyone').checked = false;
    if (e.target.name === 'file' && e.target.files && e.target.files[0]) {
      const f = e.target.files[0], bad = bbmFileCheck(f);
      if (bad) { msg.textContent = bad; msg.className = 'bbp-msg bad'; e.target.value = ''; return; }
      BBP.file = f; removeFile = false;
      const shown = form.querySelector('.bbp-fname');
      if (shown) shown.textContent = f.name;
      else form.querySelector('[data-filebox]').insertAdjacentHTML('afterbegin', '<span class="bbp-fname">' + _bbpE(f.name) + '</span>');
    }
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-rmfile]')) { removeFile = true; BBP.file = null; const n = form.querySelector('.bbp-fname'); if (n) n.remove(); e.target.remove(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = read(), bad = bbmFormCheck(f, BBP.today);
    if (bad) { msg.textContent = bad; msg.className = 'bbp-msg bad'; return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; msg.textContent = 'Saving…'; msg.className = 'bbp-msg';
    try {
      const p = bbmParams(f);
      if (it) { ['title', 'body', 'kind', 'showUntil'].forEach(k => { if (String(p[k]) === String(it[k] || '')) delete p[k]; });
                if (p.pinned === !!it.pinned) delete p.pinned;
                if (p.audience === ((it.audience || []).indexOf('all') >= 0 ? 'all' : (it.audience || []).join(','))) delete p.audience;
                p.bulletinNo = it.bulletinNo; p.ifUpdatedAt = it.updatedAt; }
      else p.clientRef = typeof flowClientRef === 'function' ? flowClientRef() : String(Date.now());
      if (BBP.file) {
        const isImg = /^image\/(jpeg|png|webp)$/.test(BBP.file.type) && typeof flowDownscaleImage === 'function';
        const url = isImg ? await flowDownscaleImage(BBP.file, 1600, 0.82) : await fileToDataURL(BBP.file);
        p.fileBase64 = String(url).replace(/^data:[^,]*,/, ''); p.fileName = BBP.file.name; p.mimeType = isImg ? 'image/jpeg' : BBP.file.type;
      } else if (removeFile) p.removeFile = true;
      const r = await postFlow('saveBulletin', p);
      if (!r || !r.success) throw new Error((r && r.message) || 'Not saved.');
      bbpClose();
      _bbpToast(r.unchanged ? 'Nothing changed.' : it ? 'Saved.' : 'Posted.', 'ok');
      bbpLoad();
    } catch (err) { msg.textContent = String(err && err.message || err); msg.className = 'bbp-msg bad'; btn.disabled = false; }
  });
}

/* ── the HR memos, brought over once ──────────────────────────────────────────────────────────── */

async function bbpImportPanel() {
  const host = _bbpId('bbpImport');
  if (!host || typeof apiGetMemos !== 'function') return;
  let memos = [];
  try { const r = await apiGetMemos(); memos = (r && (r.data || r.memos)) || []; } catch (e) { return; }
  if (!memos.length) { host.innerHTML = ''; return; }
  const pv = await postFlow('previewBulletinMemos', { memos: JSON.stringify(memos) }).catch(() => null);
  if (!pv || !pv.success || !pv.toImport) { host.innerHTML = ''; return; }
  BBP.memos = memos;
  const rows = pv.plan.filter(x => !x.skip);
  host.innerHTML = '<section class="bbp-import"><div><h2>Bring the HR memos onto the board</h2><p>The board replaces HR Memos. ' + rows.length + ' memo' + (rows.length === 1 ? ' is' : 's are') +
    ' still active there. They come over once, keeping who wrote them and when; the old memos stay as they were.</p>' +
    '<ul class="bbp-plan">' + rows.slice(0, 8).map(x => '<li><b>' + _bbpE(x.title) + '</b> <span>' + _bbpE([x.kind, 'for ' + bbmAudienceLabel(x.audience), x.pinned ? 'pinned' : '', x.note].filter(Boolean).join(' · ')) +
    '</span></li>').join('') + (rows.length > 8 ? '<li>and ' + (rows.length - 8) + ' more</li>' : '') + '</ul></div>' +
    '<button type="button" class="btn btn-primary primary" id="bbpImportGo">Bring ' + rows.length + ' over</button></section>';
  _bbpId('bbpImportGo').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const r = await postFlow('importBulletinMemos', { memos: JSON.stringify(BBP.memos) }).catch(err => ({ success: false, message: String(err && err.message || err) }));
    if (!r || !r.success) { e.currentTarget.disabled = false; return _bbpToast((r && r.message) || 'Not imported.', 'error'); }
    _bbpToast(r.message, 'ok');
    host.innerHTML = '';
    bbpLoad();
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { BBP, bbpRender };
