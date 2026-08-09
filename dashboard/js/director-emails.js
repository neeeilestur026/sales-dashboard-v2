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
  deSession = requireDirector();
  if (!deSession) return;
  renderNavbar('director-emails');
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
    /* A217 — `force` was being dropped here. loadFolder takes it and the Refresh button passes true
       (line 32), but the call omitted it, so Refresh silently re-served the server's 2-minute cache:
       the director pressed it, the list did not change, and nothing said why. sales-emails.js has
       always passed it. */
    const r = await apiFetchEmailFeed(folder, deDays, !!force);
    if (r && r.needsSetup) { showSetup(); return; }
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load mailbox.');
    deEmails = deSortNewestFirst(r.emails || []);
    /* The SERVER's fetch time, not ours. With a cache in play "when was the mailbox last actually
       read" is the honest question, and it is not the same as "when did I click". */
    deFetchedAt = r.fetchedAt ? new Date(r.fetchedAt) : new Date();
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

  // /api/email/feed has no server cache, so the fetch time IS the freshness of what is on screen
  const stamp = deFetchedAt
    ? deFetchedAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';
  document.getElementById('metaLine').textContent =
    `${rows.length} message${rows.length === 1 ? '' : 's'} · last ${deDays} days · newest first · updated ${stamp}`;

  const box = document.getElementById('listBox');
  if (!rows.length) { box.innerHTML = '<div class="dr-empty">No messages.</div>'; return; }

  const head = isSent
    ? '<th>To</th><th>Subject</th><th>Sent</th>'
    : '<th>From</th><th>Subject</th><th>Category</th><th>Received</th>';
  box.innerHTML = `<table class="em-table"><thead><tr>${head}</tr></thead><tbody>${rows.map(e => {
    const who = e.name || e.from || e.recipient || '';
    const addr = isSent ? (e.recipient || '') : (e.from || '');
    const whoCell = `<td class="em-from"><div>${_esc(who)}</div>${addr && addr !== who ? `<div class="addr">${_esc(addr)}</div>` : ''}</td>`;
    const subj = `<td class="subj">${_esc(e.subject || '(no subject)')}</td>`;
    const date = `<td class="em-date">${_when(e.date)}</td>`;
    if (isSent) return `<tr>${whoCell}${subj}${date}</tr>`;
    const cat = e.category || 'Other';
    return `<tr>${whoCell}${subj}<td><span class="cat-badge ${CAT_CLASS[cat] || 'cat-other'}">${_esc(cat)}</span></td>${date}</tr>`;
  }).join('')}</tbody></table>`;
}
