/* director-emails.js — GoDaddy mailbox feed for the director: Inbox / Sent / Spam,
   with rule-based classification of incoming mail. Reuses the existing email IMAP backend. */

let deSession = null;
let deFolder = 'inbox';
let deEmails = [];          // current folder's emails
let deCat = '';            // active category filter (inbox/spam)
let deDays = 14;           // lookback window; the route accepts up to 60
let deFetchedAt = null;    // when the on-screen list was actually fetched

const CAT_CLASS = {
  'Sales Inquiry/RFQ': 'cat-rfq', 'Purchase Order': 'cat-po', 'Supplier/Principal': 'cat-supplier',
  'Finance/Payment': 'cat-finance', 'Internal': 'cat-internal', 'Newsletter/Promo': 'cat-promo', 'Other': 'cat-other',
};
const CAT_ORDER = ['Sales Inquiry/RFQ', 'Purchase Order', 'Supplier/Principal', 'Finance/Payment', 'Internal', 'Newsletter/Promo', 'Other'];

function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function _when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return _esc(iso || '');
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

document.addEventListener('DOMContentLoaded', async () => {
  deSession = requireAuth();
  if (!deSession) return;
  renderNavbar('sales-emails');
  seLoadQuotations();   // A208: best-effort, in parallel with the mailbox — never blocks the list
  document.getElementById('refreshBtn').addEventListener('click', () => loadFolder(deFolder, true));
  document.getElementById('search').addEventListener('input', renderList);
  document.getElementById('daysSel').addEventListener('change', (ev) => {
    deDays = parseInt(ev.target.value, 10) || 14;   // the route clamps to 1..60 server-side too
    loadFolder(deFolder, true);
  });
  document.querySelectorAll('.em-tab').forEach(t => t.addEventListener('click', () => {
    deFolder = t.getAttribute('data-folder');
    document.querySelectorAll('.em-tab').forEach(x => x.classList.toggle('active', x === t));
    loadFolder(deFolder);
  }));
  await checkSetup();
});

async function checkSetup() {
  let configured = false, who = '';
  try {
    const r = await apiGetEmailStatus();
    configured = !!(r && r.configured);
    who = (r && r.godaddyEmail) || '';
  } catch (e) { configured = false; }
  if (!configured) { showSetup(); return; }
  if (who) { const w = document.getElementById('whoTag'); w.textContent = who; w.style.display = ''; }
  document.getElementById('feedBox').style.display = '';
  document.getElementById('setupBox').style.display = 'none';
  loadFolder('inbox');
}

function showSetup() {
  document.getElementById('feedBox').style.display = 'none';
  const box = document.getElementById('setupBox');
  box.style.display = '';
  box.innerHTML = `<div class="em-card em-setup">
    <div class="ic">✉️</div>
    <h2>Connect your GoDaddy mailbox</h2>
    <p>To feed your Inbox, Sent and Spam folders here, connect your GoDaddy email once. Your password is encrypted and never shown again.</p>
    <a href="email-setup.html" class="btn btn-primary">Connect Email</a>
  </div>`;
}

/* A204: the newest message must be at the TOP. The backend now sorts (RFC 3501 lets a server return
   FETCH responses in ascending-sequence order no matter which order the ids were asked for, which is
   why the newest mail used to sit at the bottom of every folder). Sorting again here is deliberate
   belt-and-braces: a future backend change cannot silently reintroduce it. Anything without a
   parseable date keeps its server position rather than being dropped to the end. */
function deSortNewestFirst(rows) {
  const parse = (e) => { const n = Date.parse(e && e.date); return isNaN(n) ? null : n; };
  const items = rows.map((e, i) => ({ e, i, t: parse(e) }));
  /* Mirror the server's rule: a row whose date is missing or garbled inherits the timestamp of its
     nearest neighbour in the order the server sent it, so it stays where it belongs. Comparing a
     null date directly would be both an invalid comparator (Array.sort's result would be
     implementation-defined) AND actively worse than the server's answer — it would drag the row to
     the bottom, undoing the placement the backend already worked out. */
  let carry = null;
  items.forEach(x => { if (x.t !== null) carry = x.t; x.fill = x.t !== null ? x.t : carry; });
  let next = null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].fill !== null) next = items[i].fill;
    else if (next !== null) items[i].fill = next;
  }
  // total order: filled time desc, then original server position — never returns 0 for distinct rows
  return items
    .sort((a, b) => ((b.fill === null ? -Infinity : b.fill) - (a.fill === null ? -Infinity : a.fill))
                    || (a.i - b.i))
    .map(x => x.e);
}

async function loadFolder(folder, force) {
  deFolder = folder;
  deCat = '';
  const box = document.getElementById('listBox');
  box.innerHTML = '<div class="dr-empty">Loading ' + _esc(folder) + '…</div>';
  document.getElementById('catFilter').style.display = 'none';
  try {
    // A208: `force` skips the server's 2-minute cache. Refresh sends it, a tab switch does not —
    // so switching folders is instant and "I just sent it" is one click away.
    const r = await apiFetchEmailFeed(folder, deDays, !!force);
    if (r && r.needsSetup) { showSetup(); return; }
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load mailbox.');
    deEmails = deSortNewestFirst(r.emails || []);
    // A208: the SERVER's fetch time, not ours — with a cache in play, "when did we last actually
    // read the mailbox" is the honest question, and it is not the same as "when did I click".
    deFetchedAt = r.fetchedAt ? new Date(r.fetchedAt) : new Date();
    deCached = !!r.cached;
    deMailbox = r.godaddyEmail || '';
    // tab counts
    const cntEl = { inbox: 'cntInbox', sent: 'cntSent', spam: 'cntSpam' }[folder];
    if (cntEl) document.getElementById(cntEl).textContent = '(' + deEmails.length + ')';
    renderCats();
    renderList();
  } catch (e) {
    deEmails = [];
    box.innerHTML = `<div class="dr-empty" style="color:#ef4444;">${_esc(e.message)}</div>`;
  }
}

function renderCats() {
  const wrap = document.getElementById('catFilter');
  if (deFolder === 'sent') { wrap.style.display = 'none'; return; }
  const counts = {};
  deEmails.forEach(e => { const c = e.category || 'Other'; counts[c] = (counts[c] || 0) + 1; });
  const cats = CAT_ORDER.filter(c => counts[c]);
  if (!cats.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  wrap.innerHTML = `<span class="em-chip ${deCat === '' ? 'active' : ''}" data-cat="">All <b>${deEmails.length}</b></span>` +
    cats.map(c => `<span class="em-chip ${deCat === c ? 'active' : ''}" data-cat="${_esc(c)}">${_esc(c)} <b>${counts[c]}</b></span>`).join('');
  wrap.querySelectorAll('.em-chip').forEach(ch => ch.addEventListener('click', () => {
    deCat = ch.getAttribute('data-cat');
    renderCats(); renderList();
  }));
}

function renderList() {
  const q = (document.getElementById('search').value || '').trim().toLowerCase();
  const isSent = deFolder === 'sent';
  let rows = deEmails;
  if (!isSent && deCat) rows = rows.filter(e => (e.category || 'Other') === deCat);
  if (q) rows = rows.filter(e => ((e.name || '') + ' ' + (e.from || e.recipient || '') + ' ' + (e.subject || '')).toLowerCase().includes(q));

  const stamp = deFetchedAt
    ? deFetchedAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';
  document.getElementById('metaLine').textContent =
    `${rows.length} message${rows.length === 1 ? '' : 's'} · last ${deDays} days · newest first · ` +
    `mailbox read ${stamp}${deCached ? ' (cached — press Refresh for live)' : ' (live)'}`;

  const box = document.getElementById('listBox');
  if (!rows.length) { box.innerHTML = '<div class="dr-empty">No messages.</div>'; return; }

  /* A217 — Sent is a SPLIT VIEW, not a table. See seRenderSplit. */
  if (isSent && seReady) { seRenderSplit(rows, box); return; }

  // A208: the Sent tab gains a Quotation column, so a message can be attached from this end too.
  const head = isSent
    ? '<th>To</th><th>Subject</th><th>Sent</th><th>Quotation</th>'
    : '<th>From</th><th>Subject</th><th>Category</th><th>Received</th>';
  box.innerHTML = `<table class="em-table"><thead><tr>${head}</tr></thead><tbody>${rows.map(e => {
    const who = e.name || e.from || e.recipient || '';
    const addr = isSent ? (e.recipient || '') : (e.from || '');
    const whoCell = `<td class="em-from"><div>${_esc(who)}</div>${addr && addr !== who ? `<div class="addr">${_esc(addr)}</div>` : ''}</td>`;
    const subj = `<td class="subj">${_esc(e.subject || '(no subject)')}</td>`;
    const date = `<td class="em-date">${_when(e.date)}</td>`;
    if (isSent) return `<tr>${whoCell}${subj}${date}<td>${seQuotationCell(e)}</td></tr>`;
    const cat = e.category || 'Other';
    return `<tr>${whoCell}${subj}<td><span class="cat-badge ${CAT_CLASS[cat] || 'cat-other'}">${_esc(cat)}</span></td>${date}</tr>`;
  }).join('')}</tbody></table>`;
}


/* ── A208: attach a sent message to a quotation, from the message end ────────────────────────── */
let deCached = false, deMailbox = '';
let seQuotes = [], seLinks = [], seLinkByMsg = {}, seReady = false;
let seReplyReady = false;      // A217: setQuotationEmailReply exists on the deployed backend

/** Loaded once, alongside the mailbox. Both degrade to empty — the mailbox still lists. */
async function seLoadQuotations() {
  try {
    seReady = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(113) : false;
    if (!seReady) return;
    seReplyReady = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(122) : false;
    const [q, l] = await Promise.all([
      fetchFlow('getQuotations', deSession.role === 'sales' ? { createdBy: deSession.name } : {}).catch(() => ({ data: [] })),
      fetchFlow('getQuotationEmails').catch(() => ({ data: [] })),
    ]);
    seQuotes = (q && q.data) || [];
    seLinks = (l && l.data) || [];
    seLinkByMsg = {};
    seLinks.forEach(x => {
      const id = String(x.messageId || '').toLowerCase();
      if (id && String(x.status || 'Active') === 'Active') seLinkByMsg[id] = x;
    });
  } catch (e) { seReady = false; }
}

function seQuotationCell(e) {
  if (!seReady) return '<span style="color:#94a3b8;">—</span>';
  const hit = seLinkByMsg[String(e.messageId || '').toLowerCase()];
  if (hit) {
    return `<a class="link-btn" href="flow-quotations.html?review=${encodeURIComponent(hit.quotationNo)}">${_esc(hit.quotationNo)}</a>`;
  }
  if (!e.messageId) return '<span style="color:#94a3b8;" title="This message has no Message-ID, so it cannot be attached">—</span>';
  return `<button class="link-btn" onclick='seAttach("${_esc(e.messageId)}")'>Attach…</button>`;
}

/* ── A217: the split view ────────────────────────────────────────────────────────────────────────
   Messages on the left, the quotation each one most likely carried on the right.

   Zero links have ever been made on the live book. The scorer that ranks these candidates has
   existed since A208 and is good — quotation number in the subject is +60, a confirmed client domain
   +35, same-day +20 — but it only ever ran INSIDE a dialog the rep had to think to open, from a page
   that is not the one the mail is on. Nothing about the ranking changes here. The only change is that
   nobody has to go looking for it: select a message and the answer is already beside it.

   The dialog is kept for the long tail — "see all candidates" — so the two paths agree and neither
   is dead code. */

let seSelected = null;      // messageId of the message whose candidates are on screen

/** The ranking, shared by the side pane and the dialog so they can never disagree. */
function seRankFor(m) {
  if (!m || typeof qemRankQuotations !== 'function') return [];
  const byNo = {}; seQuotes.forEach(q => { byNo[String(q.quotationNo)] = q; });
  const ctx = {
    clientDomains: (typeof qemLearnDomains === 'function') ? qemLearnDomains(seLinks, byNo) : {},
    dismissed: {}, linked: {}
  };
  seLinks.forEach(l => {
    const id = String(l.messageId || '').toLowerCase();
    if (id && String(l.status) === 'Active') ctx.linked[id] = String(l.quotationNo);
  });
  /* Only a quotation that has actually gone out can have been carried by a sent message. The same
     filter the dialog uses. */
  return qemRankQuotations(m, seQuotes.filter(q => {
    const st = String(q.status || '');
    return st === 'Approved' || st === 'Sent' || ['Not Pursued', 'Lost', 'Cancelled'].indexOf(st) !== -1;
  }), ctx);
}

function seRenderSplit(rows, box) {
  if (!seSelected || !rows.some(r => String(r.messageId) === String(seSelected))) {
    // Open on the first message that is NOT yet linked — that is the one with work on it.
    const first = rows.filter(r => r.messageId && !seLinkByMsg[String(r.messageId).toLowerCase()])[0]
               || rows.filter(r => r.messageId)[0];
    seSelected = first ? String(first.messageId) : null;
  }

  const linked = rows.filter(r => r.messageId && seLinkByMsg[String(r.messageId).toLowerCase()]).length;
  /* setQuotationEmailReply arrives with FLOW_VERSION 122. Offering the button against an older
     backend would dispatch an unknown action and fail after two round trips — the deploy trails this
     repo by design, so the control simply is not drawn until it would work. */
  const canCheck = linked && seReplyReady;
  box.innerHTML =
    `<div style="margin:0 0 .5rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;">
       ${seReplyReady ? `<button class="btn btn-sm btn-secondary" id="seCheckReplies" ${linked ? '' : 'disabled'}>
         Check for replies${linked ? ' (' + linked + ')' : ''}</button>` : ''}
       <span style="font-size:.74rem;color:var(--text-muted,#64748b);">
         ${canCheck ? 'Asks the mailbox whether the client answered any attached message.'
          : linked ? 'Reply checking arrives with the next backend update.'
                   : 'Attach a message to a quotation first — replies are tracked per attached message.'}</span>
     </div>
     <div class="se-split">
      <div class="se-msgs">${rows.map(seMsgRow).join('')}</div>
      <div class="se-side" id="seSide"></div>
    </div>`;

  box.querySelectorAll('.se-msg').forEach(b => b.addEventListener('click', () => {
    seSelected = b.getAttribute('data-id');
    renderList();
  }));
  const chk = document.getElementById('seCheckReplies');
  if (chk) chk.addEventListener('click', seCheckReplies);
  seRenderSide();
}

/** A217 — ask the mailbox whether the client answered, and write down what it said.
 *
 *  Two halves that both already existed and had never been joined: /api/email/quotation-threads does
 *  the RFC thread matching (and had no caller at all), and QuotationEmails has had Reply At / Reply
 *  From / Reply Checked At since A208 with nothing ever writing them.
 *
 *  THE SUBTLE PART: Flask returns only the messages that DID get a reply — a message with no answer
 *  is simply absent from the map. But "we looked on Tuesday and there was nothing" is a different
 *  fact from "nobody has ever looked", and flowFollowUp already tells them apart. So every id we
 *  checked is sent back, the un-replied ones as an empty object, and the handler stamps the check
 *  date on all of them. Sending only the hits would leave every un-replied quotation permanently
 *  indistinguishable from an unchecked one — which is exactly the state the whole feature is in
 *  today. */
async function seCheckReplies() {
  const btn = document.getElementById('seCheckReplies');
  const ids = deEmails.map(e => String(e.messageId || ''))
                      .filter(id => id && seLinkByMsg[id.toLowerCase()]);
  if (!ids.length) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const r = await apiFetchQuotationThreads(ids, deDays > 60 ? 60 : Math.max(deDays, 30));
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not read the mailbox.');
    if (r.needsSetup) throw new Error('Reconnect your mailbox first.');

    const replies = {};
    ids.forEach(id => { replies[id] = (r.replies && r.replies[id]) || {}; });

    const res = await postFlow('setQuotationEmailReply',
                               { replies: JSON.stringify(replies), checkedAt: r.checkedAt || '' });
    if (!res || !res.success) throw new Error((res && res.message) || 'Could not record the result.');
    await seLoadQuotations();
    renderList();
    seToast(res.message, true);
  } catch (e) {
    seToast(e.message, false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Check for replies'; }
  }
}

function seMsgRow(e) {
  const id = String(e.messageId || '');
  const hit = id && seLinkByMsg[id.toLowerCase()];
  const to = (e.recipients || []).map(x => x.addr).join(', ') || e.recipient || e.name || '—';
  return `<button class="se-msg${id && id === seSelected ? ' on' : ''}" data-id="${_esc(id)}">
      <span class="top"><span class="to">${_esc(to)}</span><span class="dt">${_when(e.date)}</span></span>
      <span class="sj">${_esc(e.subject || '(no subject)')}</span>
      ${hit ? `<span class="tag linked">✓ ${_esc(hit.quotationNo)}</span>`
            : (id ? '<span class="tag none">not attached</span>'
                  : '<span class="tag none" title="No Message-ID — it cannot be attached">no id</span>')}
    </button>`;
}

function seRenderSide() {
  const side = document.getElementById('seSide');
  if (!side) return;
  const m = deEmails.filter(x => String(x.messageId) === String(seSelected))[0];
  if (!m) { side.innerHTML = '<div class="m">Pick a message on the left.</div>'; return; }

  const to = (m.recipients || []).map(x => x.addr).join(', ') || m.recipient || '';
  const head = `<h4>${_esc(m.subject || '(no subject)')}</h4>
    <div class="m">to ${_esc(to || '—')}${m.date ? ' · ' + _esc(_when(m.date)) : ''}</div>`;

  const hit = seLinkByMsg[String(m.messageId || '').toLowerCase()];
  if (hit) {
    side.innerHTML = head + `<div class="hint">Attached to
      <a href="flow-quotations.html?review=${encodeURIComponent(hit.quotationNo)}"><b>${_esc(hit.quotationNo)}</b></a>.
      The follow-up clock for that quotation runs from this message.</div>
      <button class="btn btn-sm btn-secondary" onclick="seUnlink('${_esc(hit.quotationNo)}','${_esc(m.messageId)}')">Detach</button>`;
    return;
  }

  const ranked = seRankFor(m);
  if (!ranked.length) {
    side.innerHTML = head + `<div class="hint">There is no approved or sent quotation this could
      belong to. A quotation becomes attachable once it has been approved.</div>`;
    return;
  }

  /* Confidence decides EMPHASIS, never the action. qemIsConfident wants a strong top score and a
     clear gap; without it nothing is highlighted, because a merely least-bad guess arriving as "the
     answer" is how a link register fills up with wrong links. */
  const sure = (typeof qemIsConfident === 'function') && qemIsConfident(ranked);
  const top = ranked.slice(0, 3);
  side.innerHTML = head +
    `<div class="hint">${sure
      ? 'The first one below matches strongly — attach it and this quotation starts being tracked.'
      : 'Nothing matches strongly enough to be sure, so nothing is highlighted. Pick the right one, or leave it.'}</div>` +
    top.map((r, i) => {
      const q = r.quotation;
      const why = r.reasons.length ? r.reasons.map(x => `<span>${_esc(x)}</span>`).join('')
                                   : '<span class="none">no strong signal</span>';
      const value = (typeof flowQuotationNet === 'function' && typeof flowMoney === 'function')
        ? flowMoney(flowQuotationNet(q), q.currency || 'PHP') : '';
      return `<div class="se-cand${sure && i === 0 ? ' best' : ''}">
          <div class="b">
            <span class="no">${_esc(q.quotationNo)}</span>
            <span class="cu">${_esc(q.customer || '—')}</span>
            <span class="me">${_esc(q.status || '')}${q.date ? ' · ' + _esc(String(q.date).slice(0, 10)) : ''}${value ? ' · ' + _esc(value) : ''}</span>
            <div class="why">${why}</div>
          </div>
          <button class="btn btn-sm ${sure && i === 0 ? 'btn-primary' : 'btn-secondary'}"
                  onclick="seLinkNow('${_esc(q.quotationNo)}')">Attach</button>
        </div>`;
    }).join('') +
    (ranked.length > top.length
      ? `<button class="link-btn" onclick='seAttach("${_esc(m.messageId)}")'>See all ${ranked.length} candidates…</button>`
      : '');
}

async function seLinkNow(quotationNo) {
  const m = deEmails.filter(x => String(x.messageId) === String(seSelected))[0];
  if (!m) return;
  await seDoLink(quotationNo, m);
}

async function seUnlink(quotationNo, messageId) {
  if (!confirm(`Detach this message from ${quotationNo}?\n\nThe quotation keeps its send date; only the link goes.`)) return;
  try {
    const res = await postFlow('unlinkQuotationEmail', { quotationNo: quotationNo, messageId: messageId });
    if (!res.success) throw new Error(res.message);
    await seLoadQuotations();
    renderList();
    seToast(res.message || 'Detached.', true);
  } catch (e) { seToast(e.message, false); }
}

/* ── The attach picker ──────────────────────────────────────────────────────────────────────────
   The ranking is the whole point of this feature, and a native prompt() could only show it as a
   numbered list to read and a digit to type. The same ranked list is now a list of choices, with
   the reasons behind each one shown as chips — the rep sees WHY a quotation is being suggested and
   can disagree with it, which they cannot do with a number.

   Nothing is pre-selected unless qemIsConfident says the top match is both strong and unambiguous;
   a merely least-bad guess must not arrive looking like an answer. */
let atRanked = [];
let atPick = -1;
let atMsg = null;

/** The same scorer as the quotation-side modal, arguments reversed: message fixed, quotations ranked. */
function seAttach(messageId) {
  const m = deEmails.filter(x => String(x.messageId) === String(messageId))[0];
  if (!m || typeof qemRankQuotations !== 'function') return;
  // A217: one ranking, shared with the side pane — two copies would eventually rank differently and
  // the dialog would contradict the list the rep is looking at.
  atRanked = seRankFor(m).slice(0, 6);
  atMsg = m;
  /* Only pre-select a genuinely confident top match — see qemIsConfident. */
  atPick = (typeof qemIsConfident === 'function' && qemIsConfident(atRanked)) ? 0 : -1;
  atRender();
  atOpen(true);
}

function atOpen(on) {
  const ov = document.getElementById('atOverlay');
  if (!ov) return;
  ov.classList.toggle('open', !!on);
  if (on) {
    const first = ov.querySelector('.at-opt');
    if (first) first.focus();
  } else { atRanked = []; atPick = -1; atMsg = null; }
}

function atRender() {
  const m = atMsg || {};
  const to = (m.recipients || []).map(x => x.addr).join(', ') || m.recipient || '';
  document.getElementById('atMail').innerHTML =
    `<div class="s">${_esc(m.subject || '(no subject)')}</div>` +
    `<div class="m">to ${_esc(to || '—')}${m.date ? ' · ' + _esc(_when(m.date)) : ''}</div>`;

  const list = document.getElementById('atList');
  if (!atRanked.length) {
    list.innerHTML = '<div class="at-empty">No approved or sent quotation to attach this to.<br>' +
      'A quotation becomes attachable once it has been approved.</div>';
    document.getElementById('atNote').textContent = '';
    document.getElementById('atConfirm').disabled = true;
    return;
  }
  list.innerHTML = atRanked.map((r, i) => {
    const q = r.quotation;
    const why = r.reasons.length
      ? r.reasons.map(x => `<span>${_esc(x)}</span>`).join('')
      : '<span class="none">no strong signal — check this one</span>';
    const value = (typeof flowQuotationNet === 'function' && typeof flowMoney === 'function')
      ? flowMoney(flowQuotationNet(q), q.currency || 'PHP') : '';
    return `<button type="button" class="at-opt${i === atPick ? ' on' : ''}" data-i="${i}"
              onclick="atSelect(${i})" onkeydown="atKey(event,${i})">
        <span class="tick">${i === atPick ? '&#10003;' : ''}</span>
        <span class="body">
          <span class="no">${_esc(q.quotationNo)}</span>
          <span class="cust">${_esc(q.customer || '—')}</span>
          <span class="meta">${_esc(q.status || '')}${q.date ? ' · ' + _esc(String(q.date).slice(0, 10)) : ''}${value ? ' · ' + _esc(value) : ''}</span>
          <span class="at-why">${why}</span>
        </span>
        ${i === 0 && atPick === 0 ? '<span class="at-best">best match</span>' : ''}
      </button>`;
  }).join('');
  document.getElementById('atNote').textContent = atPick < 0
    ? 'No single quotation stands out, so none is pre-selected — pick the right one.'
    : '';
  document.getElementById('atConfirm').disabled = atPick < 0;
}

function atSelect(i) { atPick = i; atRender(); document.querySelectorAll('.at-opt')[i].focus(); }

/** Arrow keys move through the list, Enter attaches. A picker you have to reach for the mouse to
 *  use is slower than the prompt() it replaced. */
function atKey(ev, i) {
  const n = atRanked.length;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const next = (i + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
    document.querySelectorAll('.at-opt')[next].focus();
  } else if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault(); atSelect(i);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const cancel = document.getElementById('atCancel'), ok = document.getElementById('atConfirm'),
        ov = document.getElementById('atOverlay');
  if (cancel) cancel.addEventListener('click', () => atOpen(false));
  if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) atOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ov && ov.classList.contains('open')) atOpen(false);
  });
  if (ok) ok.addEventListener('click', async () => {
    if (atPick < 0 || !atMsg) return;
    ok.disabled = true; ok.textContent = 'Attaching…';
    const done = await seDoLink(atRanked[atPick].quotation.quotationNo, atMsg);
    ok.textContent = 'Attach';
    if (done) atOpen(false); else ok.disabled = false;
  });
});

/** Returns true when the link was made. The caller keeps the dialog open on a refusal so the rep can
 *  read it and try another quotation, rather than losing their place to a dismissed alert. */
async function seDoLink(quotationNo, m) {
  try {
    const res = await postFlow('linkQuotationEmail', {
      quotationNo: quotationNo, messageId: m.messageId,
      sentAt: m.sentAt || m.date || '', subject: m.subject || '',
      to: (m.recipients || []).map(x => x.addr).join(', ') || m.recipient || '',
      threadRoot: m.threadRoot || m.messageId, mailboxAddr: deMailbox
    });
    if (!res.success) throw new Error(res.message);
    await seLoadQuotations();
    renderList();
    seToast(res.message, true);
    return true;
  } catch (e) {
    seToast(e.message, false);
    return false;
  }
}

/** A message that does not need dismissing. The page has no flow-msg element and one banner at the
 *  top would be invisible with the dialog open over it. */
function seToast(text, ok) {
  let t = document.getElementById('seToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'seToast';
    t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:1200;' +
      'padding:.6rem 1rem;border-radius:10px;font:600 .82rem/1.5 Inter,sans-serif;color:#fff;' +
      'box-shadow:0 8px 26px rgba(15,23,42,.28);max-width:min(520px,92vw);text-align:center;';
    document.body.appendChild(t);
  }
  t.style.background = ok ? '#0f766e' : '#b91c1c';
  t.textContent = text;
  t.style.display = '';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.display = 'none'; }, ok ? 3200 : 6000);
}
