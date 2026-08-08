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

/** Loaded once, alongside the mailbox. Both degrade to empty — the mailbox still lists. */
async function seLoadQuotations() {
  try {
    seReady = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(113) : false;
    if (!seReady) return;
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
  const byNo = {}; seQuotes.forEach(q => { byNo[String(q.quotationNo)] = q; });
  const ctx = {
    clientDomains: (typeof qemLearnDomains === 'function') ? qemLearnDomains(seLinks, byNo) : {},
    dismissed: {}, linked: {}
  };
  seLinks.forEach(l => {
    const id = String(l.messageId || '').toLowerCase();
    if (id && String(l.status) === 'Active') ctx.linked[id] = String(l.quotationNo);
  });
  atRanked = qemRankQuotations(m, seQuotes.filter(q => {
    const st = String(q.status || '');
    return st === 'Approved' || st === 'Sent' || ['Not Pursued', 'Lost', 'Cancelled'].indexOf(st) !== -1;
  }), ctx).slice(0, 6);
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
