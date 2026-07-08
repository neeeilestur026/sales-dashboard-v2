/* director-emails.js — GoDaddy mailbox feed for the director: Inbox / Sent / Spam,
   with rule-based classification of incoming mail. Reuses the existing email IMAP backend. */

let deSession = null;
let deFolder = 'inbox';
let deEmails = [];          // current folder's emails
let deCat = '';            // active category filter (inbox/spam)

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

async function loadFolder(folder, force) {
  deFolder = folder;
  deCat = '';
  const box = document.getElementById('listBox');
  box.innerHTML = '<div class="dr-empty">Loading ' + _esc(folder) + '…</div>';
  document.getElementById('catFilter').style.display = 'none';
  try {
    const r = await apiFetchEmailFeed(folder, 14);
    if (r && r.needsSetup) { showSetup(); return; }
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load mailbox.');
    deEmails = r.emails || [];
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

  document.getElementById('metaLine').textContent = `${rows.length} message${rows.length === 1 ? '' : 's'} · last 14 days`;

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
