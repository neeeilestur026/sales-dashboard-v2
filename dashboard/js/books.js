/* A320 — the Books page (books.html): the general ledger's own screen.
 *
 *   Band      the engine switch (Off / Shadow / On — director or management), the books' start date, the
 *             Inbox count, the number of ledger lines and whether debits equal credits.
 *   Inbox     every event the books could not post with certainty, with its lines. Pick the account (and
 *             optionally remember it as a rule), or ignore it with a reason. Nothing is ever guessed.
 *   Coverage  per source type: posted, waiting, missing, changed since posting — and "post what is missing".
 *   Ledger    GL lines by date, account and source. Trial balance by date range, with an opening column.
 *   Accounts  the chart, editable by accounting/admin/director (system accounts keep code and type).
 *   Rules     which account a category / department / travel item posts to.
 *   Sync      (A321) payroll, Billing, Director Payables and the bank page live in Code.gs; the band's
 *             button asks Flask /books/sync to carry them over. Pressing it twice posts nothing twice.
 *
 * Every read is a secured read (postFlow): the books are for accounting, admin, management and the
 * director. Management sees everything and changes nothing except the engine switch.
 */
(function () {
  const MIN_VERSION = 161;
  const ACT_ROLES = ['accounting', 'admin', 'director'];
  const SWITCH_ROLES = ['director', 'management'];
  const B = { session: null, role: '', canAct: false, canSwitch: false, status: null, accounts: [], types: [], loaded: {} };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => (typeof flowEsc === 'function' ? flowEsc(v) : hxEsc(v));
  const num = (v) => (typeof flowNum === 'function' ? flowNum(v) : hxNum(v));
  const money = (v) => (Number(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  function msg(id, text, ok) { const m = $(id); if (!m) return; m.textContent = text; m.className = 'flow-msg ' + (ok ? 'ok' : 'bad'); m.hidden = !text; }
  function banner(text) { const b = $('bkBanner'); b.textContent = text || ''; b.hidden = !text; }
  async function read(action, params) {
    const r = await postFlow(action, params || {});
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not read the books.');
    return r;
  }
  const today = () => (typeof flowToday === 'function' ? flowToday() : new Date().toISOString().slice(0, 10));
  const RULE_LABEL = { 'expense.category': 'Expense category', 'pr.department': 'Payment department', 'travel.item': 'Travel item',
                       'billing.department': 'Billing department', 'dp.category': 'Director payable category' };

  /* ── the band ─────────────────────────────────────────────────────────────────────────────── */
  const MODE_HINT = {
    off: 'Off: nothing is posted and nothing changes for anyone.',
    shadow: 'Shadow: everything posts to the books alongside the old journal, for checking.',
    on: 'On: the books are the accounts.'
  };
  async function loadStatus() {
    const s = B.status = await read('getBooksStatus');
    document.querySelectorAll('.bk-pos').forEach(b => {
      const on = b.dataset.mode === s.mode;
      b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on));
      b.disabled = !B.canSwitch;
    });
    $('bkModeHint').textContent = MODE_HINT[s.mode] || '';
    $('bkStart').textContent = s.startDate;
    $('bkInboxN').textContent = s.inboxOpen;
    $('bkLines').textContent = s.glLines.toLocaleString();
    const chk = $('bkCheck');
    chk.classList.toggle('bad', !s.totals.balanced);
    chk.querySelector('b').textContent = s.totals.balanced ? 'Balanced' : 'Out by ' + money(Math.abs(s.totals.debit - s.totals.credit));
    const tabIn = document.querySelector('.bk-tab[data-tab="inbox"]');
    if (tabIn) tabIn.textContent = s.inboxOpen ? 'Inbox · ' + s.inboxOpen : 'Inbox';
    show('bkSync', B.canAct && s.mode !== 'off');
    const ls = s.lastSync;
    $('bkSyncHint').className = 'bk-hint';
    $('bkSyncHint').textContent = ls ? 'Last synced ' + ls.at + (ls.by ? ' by ' + ls.by : '') : 'Not synced yet.';
  }
  async function syncPayroll() {
    const btn = $('bkSyncBtn'), hint = $('bkSyncHint');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
      const res = await fetch('/books/sync', { method: 'POST', headers: hxAuthHeaders({ 'Content-Type': 'application/json' }), body: '{}' });
      let r = null;
      try { r = await res.json(); } catch (e) { r = null; }
      if (r && /Unknown action: ingestBookEvents/.test(r.message || '')) throw new Error('Paste the latest FlowAPI.gs (162) to sync payroll and payments.');
      if (!res.ok || !r || !r.success) throw new Error((r && r.message) || 'The sync did not finish (' + res.status + '). Press it again; nothing posts twice.');
      await loadStatus();
      hint.className = 'bk-hint bk-ok'; hint.textContent = r.message;
      B.loaded = { [currentTab()]: true };
      const t = currentTab(); if (LOADERS[t]) LOADERS[t]();
    } catch (e) { hint.className = 'bk-hint bk-bad'; hint.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Sync payroll & payments'; }
  }
  const currentTab = () => ((document.querySelector('.bk-tab.active') || {}).dataset || {}).tab || 'inbox';
  async function setMode(mode) {
    if (!B.canSwitch || !B.status || mode === B.status.mode) return;
    const warn = mode === 'on' ? '\n\nOnly switch on once the shadow months agree with the bank statements, the agings and the filed returns.' :
                 mode === 'shadow' ? '\n\nThe books will need: VAT type on 0% invoices, "deposited to" on collections, "paid from" on payments and expenses.' : '';
    if (!confirm('Switch the books engine to ' + mode.toUpperCase() + '?\n\n' + MODE_HINT[mode] + warn)) return;
    try {
      const r = await postFlow('setFlowSettings', { settings: JSON.stringify({ booksEngine: mode }) });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not switch.');
      await loadStatus();
    } catch (e) { banner(e.message); }
  }

  /* ── accounts (shared by the selects) ─────────────────────────────────────────────────────── */
  async function loadAccounts() {
    const r = await read('getAccounts');
    B.accounts = r.data; B.types = r.types || [];
    return B.accounts;
  }
  const postable = () => B.accounts.filter(a => a.active && a.postable);
  const acctOptions = (blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') +
    postable().map(a => `<option value="${esc(a.code)}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');
  const acctName = (code) => { const a = B.accounts.find(x => x.code === code); return a ? a.name : ''; };

  /* ── Inbox ────────────────────────────────────────────────────────────────────────────────── */
  async function loadInbox() {
    const box = $('inboxList');
    box.innerHTML = '<div class="hx-empty">Loading…</div>';
    try {
      const r = await read('getBooksInbox', { status: 'Open' });
      $('inboxMeta').textContent = r.data.length ? r.data.length + ' open' : '';
      if (!r.data.length) { box.innerHTML = '<div class="hx-empty">Nothing is waiting. Every event that reached the books posted.</div>'; return; }
      box.innerHTML = r.data.map(i => {
        const blank = (i.lines || []).some(l => !String(l.account || '').trim());
        // A321 — the line says which rule "remember" saves; an Inbox item from before that knew only expense categories
        const rl = (i.lines || []).find(l => !String(l.account || '').trim() && l.rule && l.rule.value);
        const legacy = (i.reason.match(/^no account for (.+)$/) || [])[1];
        const rule = rl ? rl.rule : (i.sourceType === 'Expense' && legacy ? { source: 'expense.category', value: legacy } : null);
        const cat = rule ? rule.value : '';
        const lines = (i.lines || []).length ? `<table class="bk-mini"><tbody>${i.lines.map(l => `<tr>
            <td>${l.account ? esc(l.account) + ' <span class="bk-dim">' + esc(acctName(l.account)) + '</span>' : '<span class="bk-need">' + esc(l.need ? 'needs ' + l.need : 'needs an account') + '</span>'}</td>
            <td class="num">${num(l.debit) ? money(l.debit) : ''}</td><td class="num">${num(l.credit) ? money(l.credit) : ''}</td></tr>`).join('')}</tbody></table>` : '';
        const actions = B.canAct ? `<div class="bk-act">
            ${blank ? `<select data-acct>${acctOptions('Choose the account…')}</select>` : ''}
            ${blank && rule ? `<label class="bk-remember"><input type="checkbox" data-remember checked> Remember for ${esc((RULE_LABEL[rule.source] || rule.source).toLowerCase())} "${esc(cat)}"</label>` : ''}
            ${(i.lines || []).length ? `<button type="button" class="btn btn-sm btn-primary" data-post>${blank ? 'Post' : 'Try again'}</button>` : ''}
            <button type="button" class="btn btn-sm" data-ignore>${(i.lines || []).length ? 'Ignore…' : 'Confirm…'}</button>
          </div>` : '';
        return `<article class="bk-item" data-id="${esc(i.itemId)}" data-cat="${esc(cat || '')}" data-rule-source="${esc(rule ? rule.source : '')}">
          <div class="bk-item-head">
            <div><b>${esc(i.sourceType)} ${esc(i.sourceNo)}</b><span class="bk-dim"> · ${esc(i.date)}${i.party ? ' · ' + esc(i.party) : ''}</span></div>
            <div class="bk-amt">${i.amount ? money(i.amount) : ''}</div>
          </div>
          <div class="bk-reason">${esc(i.reason)}</div>
          ${i.description ? `<div class="bk-desc">${esc(i.description)}</div>` : ''}
          ${lines}${actions}
          <div class="flow-msg" data-msg hidden></div>
        </article>`;
      }).join('');
      box.querySelectorAll('[data-post]').forEach(b => b.addEventListener('click', () => resolveItem(b.closest('.bk-item'), 'post')));
      box.querySelectorAll('[data-ignore]').forEach(b => b.addEventListener('click', () => resolveItem(b.closest('.bk-item'), 'ignore')));
    } catch (e) { box.innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; }
  }
  async function resolveItem(card, action) {
    const m = card.querySelector('[data-msg]');
    const say = (t, ok) => { m.textContent = t; m.className = 'flow-msg ' + (ok ? 'ok' : 'bad'); m.hidden = false; };
    const p = { itemId: card.dataset.id, resolution: action };
    if (action === 'ignore') {
      const why = prompt('Why is this not posted? (e.g. "duplicate of INV-…", "rate confirmed")');
      if (!why) return;
      p.reason = why;
    } else {
      const sel = card.querySelector('[data-acct]');
      if (sel) {
        if (!sel.value) { say('Choose the account first.', false); return; }
        p.account = sel.value;
        const rem = card.querySelector('[data-remember]');
        if (rem && rem.checked && card.dataset.cat && card.dataset.ruleSource) { p.remember = true; p.ruleSource = card.dataset.ruleSource; p.ruleValue = card.dataset.cat; }
      }
    }
    try {
      const r = await postFlow('resolveBooksInboxItem', p);
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not resolve it.');
      say(r.message, true);
      setTimeout(() => { loadInbox(); loadStatus(); }, 700);
    } catch (e) { say(e.message, false); }
  }

  /* ── Coverage ─────────────────────────────────────────────────────────────────────────────── */
  async function loadCoverage() {
    $('covCounts').innerHTML = '<div class="hx-empty">Checking…</div>'; $('covProblems').innerHTML = '';
    try {
      const r = await read('getBooksCoverage', { from: $('covFrom').value, to: $('covTo').value });
      const types = Object.keys(r.counts);
      $('covCounts').innerHTML = types.length ? `<table class="flow-table bk-table"><thead><tr><th>Source</th><th class="num">Records</th><th class="num">Posted</th>
          <th class="num">In the Inbox</th><th class="num">Missing</th><th class="num">Changed</th></tr></thead><tbody>${types.map(k => { const c = r.counts[k]; return `<tr>
          <td>${esc(k)}</td><td class="num">${c.total}</td><td class="num">${c.ok}</td><td class="num">${c.inbox || ''}</td>
          <td class="num ${c.missing ? 'bk-bad' : ''}">${c.missing || ''}</td><td class="num ${c.changed ? 'bk-bad' : ''}">${c.changed || ''}</td></tr>`; }).join('')}</tbody></table>
          <p class="bk-verdict ${r.complete ? 'ok' : 'bad'}">${r.complete ? 'Complete: every record in this range is in the books (or waiting in the Inbox for a decision).' : r.problemCount + ' record(s) are missing from the books or changed since they were posted.'}</p>`
        : '<div class="hx-empty">No money records in this range.</div>';
      const bad = r.problems.filter(x => x.state !== 'inbox');
      $('covProblems').innerHTML = bad.length ? `<table class="flow-table bk-table"><thead><tr><th>Date</th><th>Source</th><th class="num">Amount</th><th>State</th></tr></thead><tbody>${bad.map(x => `<tr>
          <td>${esc(x.date)}</td><td>${esc(x.sourceType)} ${esc(x.sourceNo)}</td><td class="num">${money(x.amount)}</td>
          <td>${esc(x.state === 'missing' ? 'not in the books' : x.why || 'changed')}</td></tr>`).join('')}</tbody></table>` : '';
      show('covSync', B.canAct && bad.length > 0 && B.status && B.status.mode !== 'off');
    } catch (e) { $('covCounts').innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; }
  }
  async function syncNow() {
    const btn = $('covSync');
    btn.disabled = true; btn.textContent = 'Posting…';
    try {
      const r = await postFlow('syncBooks', { from: $('covFrom').value, to: $('covTo').value });
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not post.');
      msg('covMsg', r.message, true);
      await loadCoverage(); await loadStatus();
    } catch (e) { msg('covMsg', e.message, false); }
    finally { btn.disabled = false; btn.textContent = 'Post what is missing'; }
  }

  /* ── General ledger and trial balance ─────────────────────────────────────────────────────── */
  async function loadLedger() {
    const box = $('glTable');
    box.innerHTML = '<div class="hx-empty">Loading…</div>';
    try {
      const r = await read('getGLEntries', { from: $('glFrom').value, to: $('glTo').value, account: $('glAccount').value, sourceType: $('glSource').value });
      $('glMeta').textContent = r.total > r.data.length ? 'latest ' + r.data.length + ' of ' + r.total + ' lines' : r.total + ' lines';
      if (!r.data.length) { box.innerHTML = '<div class="hx-empty">No entries for these filters.</div>'; return; }
      let dr = 0, cr = 0, prev = '';
      box.innerHTML = `<table class="flow-table bk-table"><thead><tr><th>Entry</th><th>Date</th><th>Source</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th>Memo</th></tr></thead><tbody>${
        r.data.map(l => { dr += l.debit; cr += l.credit; const first = l.entryNo !== prev; prev = l.entryNo; return `<tr class="${first ? 'bk-first' : ''}">
          <td>${first ? esc(l.entryNo) : ''}</td><td>${first ? esc(l.date) : ''}</td><td>${first ? esc(l.sourceType) + ' ' + esc(l.sourceNo) : ''}</td>
          <td>${esc(l.account)} <span class="bk-dim">${esc(l.accountName)}</span></td>
          <td class="num">${l.debit ? money(l.debit) : ''}</td><td class="num">${l.credit ? money(l.credit) : ''}</td>
          <td class="bk-memo">${esc(l.memo)}${l.party ? ' <span class="bk-dim">· ' + esc(l.party) + '</span>' : ''}</td></tr>`; }).join('')
      }</tbody><tfoot><tr><td colspan="4">Shown</td><td class="num">${money(dr)}</td><td class="num">${money(cr)}</td><td></td></tr></tfoot></table>`;
    } catch (e) { box.innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; }
  }
  let tbRows = [];
  async function loadTB() {
    const box = $('tbTable');
    box.innerHTML = '<div class="hx-empty">Loading…</div>';
    try {
      const r = await read('getGLTrialBalance', { from: $('tbFrom').value, to: $('tbTo').value });
      tbRows = r.data;
      $('tbMeta').textContent = r.totals.balanced ? 'Balanced' : 'Out of balance by ' + money(Math.abs(r.totals.debit - r.totals.credit));
      $('tbMeta').className = 'hx-meta ' + (r.totals.balanced ? 'bk-ok' : 'bk-bad');
      if (!r.data.length) { box.innerHTML = '<div class="hx-empty">Nothing posted in this range.</div>'; return; }
      box.innerHTML = `<table class="flow-table bk-table"><thead><tr><th>Account</th><th>Type</th><th class="num">Opening</th><th class="num">Debit</th><th class="num">Credit</th>
          <th class="num">Closing Dr</th><th class="num">Closing Cr</th></tr></thead><tbody>${r.data.map(a => `<tr>
          <td>${esc(a.code)} ${esc(a.name)}</td><td class="bk-dim">${esc(a.type)}</td><td class="num">${a.opening ? money(a.opening) : ''}</td>
          <td class="num">${a.debit ? money(a.debit) : ''}</td><td class="num">${a.credit ? money(a.credit) : ''}</td>
          <td class="num">${a.closingDebit ? money(a.closingDebit) : ''}</td><td class="num">${a.closingCredit ? money(a.closingCredit) : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="5">Totals</td><td class="num">${money(r.totals.debit)}</td><td class="num">${money(r.totals.credit)}</td></tr></tfoot></table>`;
    } catch (e) { box.innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; }
  }
  function tbCsv() {
    if (!tbRows.length) return;
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = [['Code', 'Account', 'Type', 'Opening', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'].map(q).join(',')]
      .concat(tbRows.map(a => [a.code, a.name, a.type, a.opening, a.debit, a.credit, a.closingDebit || 0, a.closingCredit || 0].map(q).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'trial-balance-' + ($('tbFrom').value || 'start') + '-to-' + ($('tbTo').value || today()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ── Chart of accounts and rules ──────────────────────────────────────────────────────────── */
  async function loadAccountsPane() {
    const box = $('acTable');
    try {
      await loadAccounts();
      $('acMeta').textContent = B.accounts.length + ' accounts';
      $('acType').innerHTML = B.types.map(t => `<option>${esc(t)}</option>`).join('');
      box.innerHTML = `<table class="flow-table bk-table"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Subtype</th><th>Status</th>${B.canAct ? '<th></th>' : ''}</tr></thead><tbody>${
        B.accounts.map(a => `<tr class="${a.active ? '' : 'bk-off'}"><td>${esc(a.code)}</td><td>${esc(a.name)}${a.bankCode ? ' <span class="bk-dim">· ' + esc(a.bankCode) + '</span>' : ''}</td>
          <td>${esc(a.type)}</td><td class="bk-dim">${esc(a.subtype)}</td><td>${a.active ? (a.system ? 'System' : 'Active') : 'Inactive'}</td>
          ${B.canAct ? `<td><button type="button" class="link-btn" data-edit="${esc(a.code)}">Edit</button></td>` : ''}</tr>`).join('')
      }</tbody></table>`;
      box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
        const a = B.accounts.find(x => x.code === b.dataset.edit);
        if (!a) return;
        $('acCode').value = a.code; $('acName').value = a.name; $('acType').value = a.type; $('acSubtype').value = a.subtype; $('acActive').checked = a.active;
        $('acName').focus();
      }));
    } catch (e) { box.innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; }
  }
  async function saveAccount(ev) {
    ev.preventDefault();
    try {
      const r = await postFlow('saveAccount', { code: $('acCode').value.trim(), name: $('acName').value.trim(), type: $('acType').value,
        subtype: $('acSubtype').value.trim(), active: $('acActive').checked });
      if (!r || !r.success) throw new Error((r && r.message) || 'Not saved.');
      msg('acMsg', r.message, true);
      $('acForm').reset(); $('acActive').checked = true;
      await loadAccountsPane();
    } catch (e) { msg('acMsg', e.message, false); }
  }
  async function loadRulesPane() {
    const box = $('ruTable');
    try {
      if (!B.accounts.length) await loadAccounts();
      $('ruAccount').innerHTML = acctOptions('Choose…');
      const r = await read('getAccountRules');
      const label = RULE_LABEL;
      box.innerHTML = r.data.length ? `<table class="flow-table bk-table"><thead><tr><th>When</th><th>Is</th><th>Posts to</th><th>Added by</th></tr></thead><tbody>${
        r.data.map(x => `<tr class="${x.active ? '' : 'bk-off'}"><td>${esc(label[x.source] || x.source)}</td><td>${esc(x.value)}</td>
          <td>${esc(x.account)} <span class="bk-dim">${esc(acctName(x.account))}</span></td><td class="bk-dim">${esc(x.by)}</td></tr>`).join('')
      }</tbody></table>` : '<div class="hx-empty">No rules yet.</div>';
    } catch (e) { box.innerHTML = `<div class="hx-empty">${esc(e.message)}</div>`; }
  }
  async function saveRule(ev) {
    ev.preventDefault();
    try {
      const r = await postFlow('saveAccountRule', { source: $('ruSource').value, value: $('ruValue').value.trim(), account: $('ruAccount').value });
      if (!r || !r.success) throw new Error((r && r.message) || 'Not saved.');
      msg('ruMsg', r.message, true);
      $('ruValue').value = '';
      await loadRulesPane();
    } catch (e) { msg('ruMsg', e.message, false); }
  }

  /* ── tabs and boot ────────────────────────────────────────────────────────────────────────── */
  const LOADERS = { inbox: loadInbox, coverage: loadCoverage, ledger: loadLedger, tb: loadTB, accounts: loadAccountsPane, rules: loadRulesPane };
  function openTab(name) {
    document.querySelectorAll('.bk-tab').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    Object.keys(LOADERS).forEach(k => show('pane-' + k, k === name));
    if (!B.loaded[name]) { B.loaded[name] = true; LOADERS[name](); }
  }
  async function fillAccountFilter() {
    try {
      if (!B.accounts.length) await loadAccounts();
      $('glAccount').innerHTML = '<option value="">All accounts</option>' + B.accounts.map(a => `<option value="${esc(a.code)}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');
    } catch (e) { /* the filter stays "All" */ }
  }
  document.addEventListener('DOMContentLoaded', async () => {
    B.session = (typeof requireOversight === 'function') ? requireOversight() : null;
    if (!B.session) return;
    if (typeof renderNavbar === 'function') renderNavbar('books');
    B.role = String(B.session.role || '').toLowerCase();
    B.canAct = ACT_ROLES.indexOf(B.role) !== -1;
    B.canSwitch = SWITCH_ROLES.indexOf(B.role) !== -1;
    let ok = true;
    try { ok = (typeof flowVersionAtLeast === 'function') ? await flowVersionAtLeast(MIN_VERSION) : true; } catch (e) { ok = true; }
    if (!ok) { banner('The books need FlowAPI ' + MIN_VERSION + '. Paste the latest FlowAPI.gs to switch this page on.'); show('bkBand', false); return; }
    document.querySelectorAll('.bk-pos').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
    document.querySelectorAll('.bk-tab').forEach(b => b.addEventListener('click', () => openTab(b.dataset.tab)));
    $('covRun').addEventListener('click', loadCoverage); $('covSync').addEventListener('click', syncNow);
    $('glRun').addEventListener('click', loadLedger); $('tbRun').addEventListener('click', loadTB); $('tbCsv').addEventListener('click', tbCsv);
    $('acForm').addEventListener('submit', saveAccount); $('ruForm').addEventListener('submit', saveRule);
    $('bkSyncBtn').addEventListener('click', syncPayroll);
    show('acForm', B.canAct); show('ruForm', B.canAct);
    try { await loadStatus(); } catch (e) { banner(e.message); return; }
    const start = B.status.startDate;
    $('covFrom').value = start; $('covTo').value = today();
    $('tbFrom').value = start; $('tbTo').value = today();
    $('glFrom').value = start; $('glTo').value = today();
    fillAccountFilter();
    openTab('inbox');
  });
  window.__books = { B, MODE_HINT, ACT_ROLES, SWITCH_ROLES, MIN_VERSION };   // tests
})();
